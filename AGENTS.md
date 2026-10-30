# Claude Effort Router: notes for agents

A Claude Code mod (plugin with a hooks module) that sets the effort of every Opus step. Read `README.md` first.

## Layout

- `.claude-plugin/plugin.json`: manifest. The plugin id is `effort-router`: names that start with `claude-` are reserved for Anthropic.
- `.claude-plugin/marketplace.json`: makes this repository its own marketplace (`source: "./"`).
- `hooks/hooks.json`, `hooks/register.ts`: the hooks module. Hooks:
  - `turn.step`: before each request to the model; sets `effort` on Opus steps (first step `FIRST_STEP`, later steps from the classifier).
  - `tool.call`: keeps the last tool results per agent for the classifier.
  - `prompt.submit`, `turn.complete`: the task text and the `ultrathink` turn.
  - `command.run` on `effort`: a manual `/effort` pauses routing for the session; `/effort auto` resumes it.
  - `command.run` on `effort-router`: the `/effort-router` command (stats, disable, enable). Stats run `scripts/stats.py`; `disable` sets a flag in `$.store` that every session reads.
- `scripts/stats.py`, `scripts/stats_test.py`: the stats tables (Python 3, standard library only).

## Rules

- The module has no Node.js APIs. Everything outside it goes through `$` (the mods API): `$.model.complete`, `$.fs`, `$.store`, `$.env`, `$.session`.
- Never block a step: on any classifier error the step runs at `FALLBACK`.
- Leave steps alone when they are not on Opus, when the user set effort by hand, or in an `ultrathink` turn.
- Logs live outside the plugin folder (`~/.claude/effort-router/logs`), so an update does not delete them. Never write logs into the repository. Append with `$.process.run` (`cat >>`): `$.fs.read` stops at 4 MiB, so a read-then-write would cut a long log.
- Keep the README "Measured" section true: change a number only after measuring it again.

## Check a change

```
claude plugin validate .
python3 scripts/stats_test.py
```

Type-check `hooks/register.ts` against the mods API types: once the plugin has loaded, `.claude-plugin/types/` holds them and `tsc -p .` works.

Run it in one session without installing it (`--setting-sources ""` keeps an installed copy out):

```
claude --plugin-dir . --setting-sources "" --model claude-opus-5-5
```

Then read the newest file in `~/.claude/effort-router/logs`: one line per step, with `effort` and `reason`.
