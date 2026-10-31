import type { EngineInterface, Register } from 'claude-code'

type Level = 'low' | 'medium' | 'high' | 'xhigh'
type LoopContext = { task: string; lastStep: string; toolResults: string[] }
type Decision = { level: Level; reason: string; classifierInput?: string; classifierReply?: string }

const LEVELS: readonly Level[] = ['low', 'medium', 'high', 'xhigh']
const DEFAULT_FIRST_STEP: Level = 'high'
const FALLBACK: Level = 'high'
const ROUTED_MODEL = /opus/i
const CLASSIFIER = 'claude-haiku-5-5'
const CLASSIFIER_TIMEOUT_MS = 8000
const CONTEXT_CHARS = 1500
const COMMAND = 'effort-router'
const STATS_PERIODS = ['session', 'today', 'week', 'month', 'projects']
const DISABLED_KEY = 'disabled'
const FIRST_STEP_KEY = 'firstStep'

const SYSTEM = [
  'You set the reasoning effort for the NEXT step of a coding agent.',
  'You see the task, what the agent did in its last step and the tool results it got back.',
  'low: trivial follow-up, reading a result, one obvious command.',
  'medium: routine single change or simple next action.',
  'high: multi-step or non-obvious work, interpreting failures.',
  'xhigh: hard design, root-cause debugging, risky or subtle change.',
  'Reply with exactly one word: low, medium, high or xhigh.',
].join('\n')

const USAGE = [
  `Usage: /${COMMAND} [stats | ${STATS_PERIODS.map(period => `stats:${period}`).join(' | ')} | start [${LEVELS.join('|')}] | unpause | disable | enable]`,
  '- stats: all steps; session: this session; today, week, month: calendar periods; projects: steps per repository',
  `- start <level>: effort of the first step after each prompt, in every session (default ${DEFAULT_FIRST_STEP})`,
  '- disable / enable: turn the router off or on in every session',
  '- a manual effort change (/effort <level>, or the effort picker in an app such as Zeron) pauses the router in this session only',
  '- unpause (or /effort auto): route this session again',
].join('\n')

const loops = new Map<string, LoopContext>()
let isUltrathinkTurn = false
let repo: string | undefined
let logQueue: Promise<unknown> = Promise.resolve()

const clip = (text: string) => (text.length > CONTEXT_CHARS ? `${text.slice(0, CONTEXT_CHARS)}…` : text)

const stringify = (value: unknown) => {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const toLevel = (text: string): Level | undefined => {
  const word = text.trim().toLowerCase().split(/\W+/)[0]
  return LEVELS.find(level => level === word)
}

const loopOf = (agentId?: string) => {
  const key = agentId ?? 'main'
  const existing = loops.get(key)
  if (existing) return existing
  const created: LoopContext = { task: '', lastStep: '', toolResults: [] }
  loops.set(key, created)
  return created
}

const logDirOf = async ($: EngineInterface) => `${await $.env.get('HOME')}/.claude/effort-router/logs`
const manualKey = async ($: EngineInterface) => `manual:${await $.session.id()}`
const baselineKey = async ($: EngineInterface) => `baseline:${await $.session.id()}`
const manualEffortOf = async ($: EngineInterface) => (await $.store.get(await manualKey($))) as string | undefined
const isDisabled = async ($: EngineInterface) => (await $.store.get(DISABLED_KEY)) === true
const unpause = async ($: EngineInterface) => {
  await $.store.delete(await manualKey($))
  await $.store.delete(await baselineKey($))
}

const noticeManualChange = async ($: EngineInterface, agent: string, effort: string) => {
  const key = await baselineKey($)
  const baselines = ((await $.store.get(key)) ?? {}) as Record<string, string>
  if (baselines[agent] === undefined) await $.store.set(key, { ...baselines, [agent]: effort })
  else if (baselines[agent] !== effort) await $.store.set(await manualKey($), effort)
}

const firstStepOf = async ($: EngineInterface) => toLevel(String((await $.store.get(FIRST_STEP_KEY)) ?? '')) ?? DEFAULT_FIRST_STEP

const repoOf = async ($: EngineInterface, root: string) => {
  if (repo === undefined) {
    const git = await $.process
      .run(['git', '-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
      .catch(() => undefined)
    const commonDir = git?.exitCode === 0 ? git.stdout.trim().replace(/\/\.git$/, '') : ''
    repo = commonDir.split('/').filter(Boolean).at(-1) ?? ''
  }
  return repo || undefined
}

const appendLog = async ($: EngineInterface, entry: Record<string, unknown>) => {
  const dir = await logDirOf($)
  const path = `${dir}/${await $.session.id()}.jsonl`
  logQueue = logQueue
    .then(() => $.process.run(['sh', '-c', 'mkdir -p "$1" && cat >> "$2"', 'sh', dir, path], { stdin: `${JSON.stringify(entry)}\n` }))
    .catch(() => undefined)
  await logQueue
}

const classify = async ($: EngineInterface, loop: LoopContext): Promise<Decision> => {
  const prompt = `Task:\n${loop.task}\n\nAgent's last step:\n${loop.lastStep}\n\nTool results:\n${loop.toolResults.join('\n')}`
  const reply = await $.model
    .complete({ model: CLASSIFIER, system: SYSTEM, prompt, effort: 'low', maxTokens: 256, timeoutMs: CLASSIFIER_TIMEOUT_MS })
    .catch(() => undefined)
  const replyText = reply?.isAnswered ? reply.text : undefined
  const picked = replyText === undefined ? undefined : toLevel(replyText)
  return {
    level: picked ?? FALLBACK,
    reason: picked ? 'haiku' : 'classifier failed',
    classifierInput: prompt,
    classifierReply: replyText,
  }
}

const stats = async ($: EngineInterface, period: string) => {
  const script = `${$.plugin.root}/scripts/stats.py`
  const run = await $.process
    .run(['python3', script, period, '--session', await $.session.id()], { env: { EFFORT_ROUTER_LOG_DIR: await logDirOf($) } })
    .catch((error: unknown) => ({ exitCode: 1, stdout: '', stderr: String(error) }))
  return run.exitCode === 0 ? run.stdout.trim() : `Stats failed: ${'stderr' in run ? run.stderr : ''}`.trim()
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: 'Claude Effort Router: stats, stats:session|today|week|month|projects, start <level>, unpause, disable, enable' })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'disable' || arg === 'enable') {
      await $.store.set(DISABLED_KEY, arg === 'disable')
      return { text: `Claude Effort Router ${arg === 'disable' ? 'disabled' : 'enabled'} in every session.` }
    }
    if (arg === 'start') return { text: `First step effort: ${await firstStepOf($)}.` }
    if (arg.startsWith('start ')) {
      const level = toLevel(arg.slice('start '.length))
      if (!level) return { text: `Unknown level. Use one of: ${LEVELS.join(', ')}.` }
      await $.store.set(FIRST_STEP_KEY, level)
      return { text: `First step effort set to ${level} in every session.` }
    }
    if (arg === 'unpause') {
      await unpause($)
      return { text: 'Claude Effort Router routes this session again.' }
    }
    if (arg === 'stats') return { text: await stats($, 'all') }
    const period = arg.startsWith('stats:') ? arg.slice('stats:'.length) : undefined
    if (period && STATS_PERIODS.includes(period)) return { text: await stats($, period) }
    const state = (await isDisabled($)) ? 'disabled' : (await manualEffortOf($)) ? 'paused in this session by a manual effort change' : 'on'
    return { text: `Claude Effort Router: ${state}, first step ${await firstStepOf($)}.\n${USAGE}` }
  })

  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const result = await next(e)
    const level = e.args.trim().toLowerCase()
    if (level === 'auto') await unpause($)
    else if (level) await $.store.set(await manualKey($), level)
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    if (!e.command) {
      isUltrathinkTurn = /\bultrathink\b/i.test(e.text)
      loops.set('main', { task: clip(e.text), lastStep: '', toolResults: [] })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const outcome = ran.deny !== undefined ? `denied: ${ran.deny}` : `${ran.isError ? 'ERROR ' : ''}${stringify(ran.result)}`
    loopOf(e.agentId).toolResults.push(clip(`${e.tool}: ${outcome}`))
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) isUltrathinkTurn = false
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (!ROUTED_MODEL.test(e.model) || typeof e.effort !== 'string') return yield* next(e)
    if (isUltrathinkTurn || (await isDisabled($))) return yield* next(e)
    await noticeManualChange($, e.agentId ?? 'main', String(e.effort))
    if (await manualEffortOf($)) return yield* next(e)

    const loop = loopOf(e.agentId)
    if (e.agentId && !loop.task) {
      const messages = await $.session.messages({ agentId: e.agentId }).catch(() => undefined)
      if (Array.isArray(messages)) loop.task = clip(messages[0]?.text ?? '')
    }

    const startedAt = await $.clock.now()
    const decision: Decision = e.index === 0 ? { level: await firstStepOf($), reason: 'first step' } : await classify($, loop)
    const classifyMs = (await $.clock.now()) - startedAt
    loop.toolResults = []

    const result = yield* next({ ...e, effort: decision.level })

    const calls = result.toolUses.map(use => `${use.name} ${stringify(use.input)}`).join('\n')
    loop.lastStep = clip(`${result.answer}\n${calls}`.trim())
    const project = await $.session.root()
    await appendLog($, {
      at: new Date(startedAt).toISOString(),
      project,
      repo: await repoOf($, project),
      agent: e.agentId ?? 'main',
      model: e.model,
      step: e.index,
      sessionEffort: e.effort,
      effort: decision.level,
      reason: decision.reason,
      classifyMs,
      classifierInput: decision.classifierInput,
      classifierReply: decision.classifierReply,
      cacheRead: result.usage?.cache_read_input_tokens,
      cacheWrite: result.usage?.cache_creation_input_tokens,
    })
    return result
  })
}
