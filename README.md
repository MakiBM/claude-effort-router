# auto-effort

Claude Code mod that sets the reasoning effort of every Opus step. The first step after a prompt runs at `high`; before each later step Haiku 5.5 reads the task, the previous step and its tool results and picks `low`, `medium`, `high` or `xhigh`. Steps on other models are left alone. `/effort <level>` turns it off for the session until `/effort auto`; a prompt with `ultrathink` turns it off for that turn. Each decision is logged to `logs/<session-id>.jsonl` in the plugin folder.

## Install

At the prompt of a terminal session:

`/plugin install auto-effort --marketplace MakiBM/auto-effort`

From a shell:

`claude plugin install auto-effort --marketplace MakiBM/auto-effort`
