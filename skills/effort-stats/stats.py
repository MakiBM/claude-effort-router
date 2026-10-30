#!/usr/bin/env python3
"""Aligned markdown tables of the Claude Effort Router logs (~/.claude/effort-router/logs/*.jsonl).

Usage: stats.py [today | <N>d | all]   (default: all)
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

LOG_DIR = Path(os.environ.get("EFFORT_ROUTER_LOG_DIR", Path.home() / ".claude/effort-router/logs"))
LEVELS = ["low", "medium", "high", "xhigh"]


def since(arg):
    now = datetime.now().astimezone()
    if arg in ("", "all"):
        return None, "all"
    if arg == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0), "today"
    match = re.fullmatch(r"(\d+)d", arg)
    if match:
        return now - timedelta(days=int(match.group(1))), f"last {match.group(1)} days"
    sys.exit(f"Unknown range '{arg}'. Use: today, <N>d (e.g. 7d) or all.")


def project_name(path):
    parts = Path(path or "?").parts
    root = next((i for i, part in enumerate(parts) if part.startswith("multica_workspaces")), None)
    if root is not None:
        rest = parts[root + 1:]
        workspace = re.sub(r"-[0-9a-f]{8,}$", "", rest[0]) if rest else "?"
        issue = re.sub(r"-[0-9a-f]{8,}$", "", rest[1]) if len(rest) > 1 else ""
        return f"multica {workspace} {issue}".strip()
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


def load(start):
    rows = []
    for file in sorted(LOG_DIR.glob("*.jsonl")):
        for raw in file.read_text().splitlines():
            if not raw.strip():
                continue
            row = json.loads(raw)
            at = datetime.fromisoformat(row["at"].replace("Z", "+00:00"))
            if start is None or at >= start:
                row["session"] = file.stem
                rows.append(row)
    return rows


def main():
    start, label = since(sys.argv[1].strip().lower() if len(sys.argv) > 1 else "")
    rows = load(start)
    if not rows:
        print(f"No steps logged ({label}). Logs: {LOG_DIR}")
        return

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

    per_project = defaultdict(list)
    for r in rows:
        per_project[project_name(r.get("project"))].append(r)
    projects = []
    for name, items in sorted(per_project.items(), key=lambda kv: -len(kv[1])):
        count = Counter(r["effort"] for r in items)
        read = sum(r.get("cacheRead") or 0 for r in items)
        write = sum(r.get("cacheWrite") or 0 for r in items)
        projects.append([name, len(items)] + [count[level] for level in LEVELS] + [percent(read, read + write)])

    print(f"**Claude Effort Router** ({label})\n")
    print(table(["Metric", "Value"], summary))
    print()
    print(table(["Effort", "Steps", "Share"], levels))
    print()
    print(table(["Project", "Steps", "low", "medium", "high", "xhigh", "Cache"], projects))


if __name__ == "__main__":
    main()
