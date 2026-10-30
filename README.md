# Claude Effort Router

Per-step reasoning effort for Claude Code. Your agents stay on Opus for the whole thread, and the effort follows the work: a careful first step, then a light touch for routine steps and a deep one where it counts.

A Claude Code [mod](https://code.claude.com/docs/en/plugins/mods/overview) (a plugin with a hooks module). No proxy, no gateway, no API key: it runs inside Claude Code and uses your own login.

## How it works

A Claude Code turn is a loop of steps. Each step is one request to the model, which then calls tools or answers. Before every step on an Opus model the router sets that step's effort:

| Step | Effort |
| --- | --- |
| First step after your prompt | `high` |
| Every later step | Haiku 5.5 reads the task, the previous step and its tool results, and picks `low`, `medium`, `high` or `xhigh` |
| Classifier fails or times out (8 s) | `high` |

- Only steps on an Opus model are routed. A session or subagent you put on Haiku or Sonnet is left alone.
- Every agent decides for itself: each session and each subagent has its own context.
- Your choice wins. `/effort <level>` pauses the router in that session until `/effort auto`. A prompt that contains `ultrathink` pauses it for that turn.

Opus 5.5 also adapts its thinking inside each step; the router sets the ceiling the step works under.

## Measured

On the author's Mac, Claude Code 2.1.306, Max subscription, October 2026:

- Prompt cache: an effort change between steps keeps the cache. Every step read the full history from cache and wrote only the new tool result (checked on the wire). In daily use 98% of input tokens came from cache.
- Classifier latency: about 1.4 s per step (p50), 2.2 s (p90). The first step of each prompt has no classifier call.
- Classifier quality: Haiku 5.5 at effort `low` picked the same level as a hand label in 86% of 40 coding tasks, and was at most one level off in 99%.

Effort changes keep the cache on the Claude API with a subscription or an API key. They do not on Amazon Bedrock, Google Cloud's Agent Platform, a Claude apps gateway, or with `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` set ([prompt caching](https://code.claude.com/docs/en/prompt-caching#changing-effort-level)).

## Install

Requires Claude Code 2.1.287 or later, and access to Opus and Haiku 5.5.

At the prompt of a terminal session:

```
/plugin install effort-router --marketplace MakiBM/claude-effort-router
```

From a shell:

```
claude plugin install effort-router --marketplace MakiBM/claude-effort-router
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `MakiBM/claude-effort-router`, then Add plugin.

The router loads when a session starts. Restart running sessions to pick it up.

## Commands

```
/effort-router                  state and usage
/effort-router stats            all steps
/effort-router stats:session    this session
/effort-router stats:today      today, from midnight
/effort-router stats:week       this calendar week, from Monday
/effort-router stats:month      this calendar month
/effort-router stats:projects   steps per repository
/effort-router disable          turn the router off in every session
/effort-router enable           turn it back on in every session
/effort <level>                 pause the router in this session only, until /effort auto
```

Stats print as markdown tables: a summary and the share of each effort level, or for `stats:projects` the steps per repository. Worktrees (git worktrees, Multica and Orca workspaces) count under their main repository.

Every routed step is logged to `~/.claude/effort-router/logs/<session-id>.jsonl`: time, project, repository, agent, model, step, effort, reason, classifier time, what the classifier saw and answered, and cache tokens. The logs stay on your machine and survive plugin updates. Stats need `python3`.

## Cost

Each routed step after the first one makes one small Haiku 5.5 call on your account (a few hundred tokens) and waits for it.

## Turn it off

```
claude plugin disable effort-router@effort-router
claude plugin uninstall effort-router@effort-router
```

## Change it

The levels, the first-step effort, the classifier model and its prompt are constants at the top of `hooks/register.ts`. See `AGENTS.md` for how to work on the code.

## License

MIT
