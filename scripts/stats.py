#!/usr/bin/env python3
"""Aligned markdown tables of the Claude Effort Router logs (~/.claude/effort-router/logs/*.jsonl).

Usage: stats.py [all | session | today | week | month | projects] [--session <id>]
Periods are calendar based, in local time: today from midnight, week from Monday, month from the 1st.
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

LOG_DIR = Path(os.environ.get("EFFORT_ROUTER_LOG_DIR", Path.home() / ".claude/effort-router/logs"))
LEVELS = ["low", "medium", "high", "xhigh"]
LABELS = {"all": "all time", "session": "this session", "today": "today", "week": "this week",
          "month": "this month", "projects": "projects, all time"}


def period_start(period):
    midnight = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "today":
        return midnight
    if period == "week":
        return midnight - timedelta(days=midnight.weekday())
    if period == "month":
        return midnight.replace(day=1)
    return None


def repo_of(row):
    if row.get("repo"):
        return row["repo"]
    parts = Path(row.get("project") or "?").parts
    for i, part in enumerate(parts):
        if part.startswith("multica_workspaces") and i + 1 < len(parts):
            return re.sub(r"-[0-9a-f]{8,}$", "", parts[i + 1])
        if part == "workspaces" and i > 0 and parts[i - 1] == "orca" and i + 1 < len(parts):
            return parts[i + 1]
        if part.endswith(".worktrees"):
            return part[: -len(".worktrees")]
        if part == "worktrees" and i > 1 and parts[i - 1] == ".claude":
            return parts[i - 2]
    return parts[-1] if parts else "?"


def percent(part, whole):
    return f"{100 * part / whole:.0f}%" if whole else "-"


def table(headers, rows, numeric_from=1):
    cells = [headers] + [[str(c) for c in row] for row in rows]
    widths = [max(len(row[i]) for row in cells) for i in range(len(headers))]

    def line(row):
        return "| " + " | ".join(c.rjust(w) if i >= numeric_from else c.ljust(w) for i, (c, w) in enumerate(zip(row, widths))) + " |"

    rule = "| " + " | ".join(("-" * (w - 1) + ":") if i >= numeric_from else "-" * w for i, w in enumerate(widths)) + " |"
    return "\n".join([line(cells[0]), rule] + [line(r) for r in cells[1:]])


def load(start, session):
    rows = []
    for file in sorted(LOG_DIR.glob("*.jsonl")):
        if session and file.stem != session:
            continue
        for raw in file.read_text().splitlines():
            if not raw.strip():
                continue
            row = json.loads(raw)
            at = datetime.fromisoformat(row["at"].replace("Z", "+00:00"))
            if start is None or at >= start:
                row["session"] = file.stem
                rows.append(row)
    return rows


def summary_tables(rows):
    efforts = Counter(r["effort"] for r in rows)
    reasons = Counter(r["reason"] for r in rows)
    timings = sorted(r["classifyMs"] for r in rows if r["reason"] == "haiku")
    cache_read = sum(r.get("cacheRead") or 0 for r in rows)
    cache_write = sum(r.get("cacheWrite") or 0 for r in rows)
    summary = [
        ["Steps", len(rows)],
        ["Sessions", len({r["session"] for r in rows})],
        ["Decided by Haiku", reasons["haiku"]],
        ["First step (high)", reasons["first step"]],
        ["Classifier failed (high)", reasons["classifier failed"]],
        ["Classify time p50", f"{timings[len(timings) // 2] / 1000:.1f} s" if timings else "-"],
        ["Classify time p90", f"{timings[int(len(timings) * 0.9)] / 1000:.1f} s" if timings else "-"],
        ["Input from cache", percent(cache_read, cache_read + cache_write)],
    ]
    levels = [[level, efforts[level], percent(efforts[level], len(rows))] for level in LEVELS]
    return table(["Metric", "Value"], summary) + "\n\n" + table(["Effort", "Steps", "Share"], levels)


def projects_table(rows):
    per_repo = defaultdict(list)
    for r in rows:
        per_repo[repo_of(r)].append(r)
    lines = []
    for name, items in sorted(per_repo.items(), key=lambda kv: -len(kv[1])):
        count = Counter(r["effort"] for r in items)
        read = sum(r.get("cacheRead") or 0 for r in items)
        write = sum(r.get("cacheWrite") or 0 for r in items)
        lines.append([name, len(items)] + [count[level] for level in LEVELS] + [percent(read, read + write)])
    return table(["Project", "Steps", "low", "medium", "high", "xhigh", "Cache"], lines)


def main(argv):
    period = argv[0] if argv and not argv[0].startswith("--") else "all"
    session = argv[argv.index("--session") + 1] if "--session" in argv else None
    if period not in LABELS:
        sys.exit(f"Unknown period '{period}'. Use one of: {', '.join(LABELS)}.")
    if period == "session" and not session:
        sys.exit("The session period needs --session <id>.")
    rows = load(period_start(period), session if period == "session" else None)
    if not rows:
        print(f"No steps logged ({LABELS[period]}). Logs: {LOG_DIR}")
        return
    body = projects_table(rows) if period == "projects" else summary_tables(rows)
    print(f"**Claude Effort Router** ({LABELS[period]})\n\n{body}")


if __name__ == "__main__":
    main(sys.argv[1:])
