---
name: effort-stats
description: Show Claude Effort Router stats (effort chosen per Opus step) as aligned markdown tables. Use when the user asks for effort router stats.
argument-hint: "[today | 7d | all]"
allowed-tools: Bash(python3:*)
---

Run `python3 <this skill's base directory>/stats.py $ARGUMENTS` and reply with its output exactly as printed: no text before or after, no code fence.
