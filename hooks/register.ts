import type { EngineInterface, Register } from 'claude-code'

type Level = 'low' | 'medium' | 'high' | 'xhigh'
type LoopContext = { task: string; lastStep: string; toolResults: string[] }
type Decision = { level: Level; reason: string; classifierInput?: string; classifierReply?: string }

const LEVELS: readonly Level[] = ['low', 'medium', 'high', 'xhigh']
const FIRST_STEP: Level = 'high'
const FALLBACK: Level = 'high'
const ROUTED_MODEL = /opus/i
const CLASSIFIER = 'claude-haiku-5-5'
const CLASSIFIER_TIMEOUT_MS = 8000
const CONTEXT_CHARS = 1500

const SYSTEM = [
  'You set the reasoning effort for the NEXT step of a coding agent.',
  'You see the task, what the agent did in its last step and the tool results it got back.',
  'low: trivial follow-up, reading a result, one obvious command.',
  'medium: routine single change or simple next action.',
  'high: multi-step or non-obvious work, interpreting failures.',
  'xhigh: hard design, root-cause debugging, risky or subtle change.',
  'Reply with exactly one word: low, medium, high or xhigh.',
].join('\n')

const loops = new Map<string, LoopContext>()
let isUltrathinkTurn = false
let logQueue: Promise<void> = Promise.resolve()

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

const manualKey = async ($: EngineInterface) => `manual:${await $.session.id()}`
const manualEffortOf = async ($: EngineInterface) => (await $.store.get(await manualKey($))) as string | undefined

const appendLog = async ($: EngineInterface, entry: Record<string, unknown>) => {
  const path = `${await $.env.get('HOME')}/.claude/effort-router/logs/${await $.session.id()}.jsonl`
  logQueue = logQueue
    .then(async () => {
      const previous = await $.fs.read(path).catch(() => '')
      await $.fs.write(path, `${previous}${JSON.stringify(entry)}\n`)
    })
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

export const register: Register = on => {
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const result = await next(e)
    const level = e.args.trim().toLowerCase()
    if (level === 'auto') await $.store.delete(await manualKey($))
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
    if (isUltrathinkTurn || (await manualEffortOf($))) return yield* next(e)

    const loop = loopOf(e.agentId)
    if (e.agentId && !loop.task) {
      const messages = await $.session.messages({ agentId: e.agentId }).catch(() => undefined)
      if (Array.isArray(messages)) loop.task = clip(messages[0]?.text ?? '')
    }

    const startedAt = await $.clock.now()
    const decision: Decision = e.index === 0 ? { level: FIRST_STEP, reason: 'first step' } : await classify($, loop)
    const classifyMs = (await $.clock.now()) - startedAt
    loop.toolResults = []

    const result = yield* next({ ...e, effort: decision.level })

    const calls = result.toolUses.map(use => `${use.name} ${stringify(use.input)}`).join('\n')
    loop.lastStep = clip(`${result.answer}\n${calls}`.trim())
    await appendLog($, {
      at: new Date(startedAt).toISOString(),
      project: await $.session.root(),
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
