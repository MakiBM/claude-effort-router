import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

STATS = Path(__file__).with_name("stats.py")
NOW = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def run(log_dir, *args):
    env = {**os.environ, "EFFORT_ROUTER_LOG_DIR": str(log_dir)}
    return subprocess.run([sys.executable, str(STATS), *args], env=env, capture_output=True, text=True)


def write_logs(folder):
    rows = {
        "s1": [
            {"at": NOW, "project": "/p/app", "effort": "high", "reason": "first step", "classifyMs": 0, "cacheRead": 90, "cacheWrite": 10},
            {"at": NOW, "project": "/p/app.worktrees/fix-1", "effort": "low", "reason": "haiku", "classifyMs": 1200, "cacheRead": 95, "cacheWrite": 5},
        ],
        "s2": [
            {"at": "2020-01-01T00:00:00Z", "project": "/w/multica_workspaces/app-0123456789ab/ap-7-0123456789ab/worktree", "effort": "low", "reason": "haiku", "classifyMs": 1400, "cacheRead": 0, "cacheWrite": 0},
            {"at": NOW, "project": "/x/orca/workspaces/app/branch-9", "repo": "app", "effort": "xhigh", "reason": "haiku", "classifyMs": 900, "cacheRead": 0, "cacheWrite": 0},
        ],
    }
    for session, lines in rows.items():
        Path(folder, f"{session}.jsonl").write_text("".join(json.dumps(r) + "\n" for r in lines))


def test_all_counts_every_step():
    with tempfile.TemporaryDirectory() as tmp:
        write_logs(tmp)
        out = run(tmp, "all").stdout
        assert "| Steps                    |     4 |" in out
        assert "| low    |     2 |   50% |" in out


def test_today_skips_old_steps_and_session_keeps_one_session():
    with tempfile.TemporaryDirectory() as tmp:
        write_logs(tmp)
        assert "| Steps                    |     3 |" in run(tmp, "today").stdout
        assert "| Steps                    |     2 |" in run(tmp, "session", "--session", "s1").stdout


def test_projects_merge_worktrees_into_one_repo():
    with tempfile.TemporaryDirectory() as tmp:
        write_logs(tmp)
        assert "| app     |     4 |" in run(tmp, "projects").stdout


def test_unknown_period_fails():
    with tempfile.TemporaryDirectory() as tmp:
        assert run(tmp, "yesterday").returncode != 0


if __name__ == "__main__":
    test_all_counts_every_step()
    test_today_skips_old_steps_and_session_keeps_one_session()
    test_projects_merge_worktrees_into_one_repo()
    test_unknown_period_fails()
    print("ok")
