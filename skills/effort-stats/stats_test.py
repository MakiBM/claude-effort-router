import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

STATS = Path(__file__).with_name("stats.py")


def run(log_dir, *args):
    env = {**os.environ, "EFFORT_ROUTER_LOG_DIR": str(log_dir)}
    return subprocess.run([sys.executable, str(STATS), *args], env=env, capture_output=True, text=True)


def test_tables_count_steps_per_effort_and_project():
    with tempfile.TemporaryDirectory() as tmp:
        rows = [
            {"at": "2026-10-29T10:00:00.000Z", "project": "/repo/a", "effort": "high", "reason": "first step", "classifyMs": 0, "cacheRead": 90, "cacheWrite": 10},
            {"at": "2026-10-29T10:00:05.000Z", "project": "/repo/a", "effort": "low", "reason": "haiku", "classifyMs": 1200, "cacheRead": 95, "cacheWrite": 5},
            {"at": "2026-10-29T10:01:00.000Z", "project": "/w/multica_workspaces/acme-0123456789ab/ac-7-0123456789ab/worktree", "effort": "low", "reason": "haiku", "classifyMs": 1400, "cacheRead": 0, "cacheWrite": 0},
        ]
        Path(tmp, "s1.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
        out = run(tmp, "all").stdout
        assert "| Steps                    |     3 |" in out
        assert "| low    |     2 |   67% |" in out
        assert "| multica acme ac-7 |" in out


def test_unknown_range_fails():
    with tempfile.TemporaryDirectory() as tmp:
        assert run(tmp, "yesterday").returncode != 0


if __name__ == "__main__":
    test_tables_count_steps_per_effort_and_project()
    test_unknown_range_fails()
    print("ok")
