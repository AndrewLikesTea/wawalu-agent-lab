"""Single-machine autonomous manager for the synthetic engineering team."""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import uuid
from contextlib import contextmanager
from typing import Any

from runner.github_app import installation_token
from runner.layers import propose_task
from runner.orchestrator import safe_slug

ROOT = pathlib.Path(__file__).resolve().parents[1]
AUTONOMY = ROOT / ".agent" / "autonomy"
CONFIG = ROOT / ".secrets" / "autonomy.json"
STOP = AUTONOMY / "STOP"
REPOSITORY = "AndrewLikesTea/wawalu-agent-lab"
PERSONAS = {"backend", "frontend", "infrastructure", "staff"}


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


class Journal:
    def __init__(self, path: pathlib.Path = AUTONOMY / "events.jsonl"):
        self.path = path

    def emit(self, event: str, **fields: Any) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        entry = {"at": utc_now().isoformat(), "event": event, **fields}
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, separators=(",", ":")) + "\n")
        self.path.chmod(0o600)


class State:
    def __init__(self, path: pathlib.Path = AUTONOMY / "state.json"):
        self.path = path
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            self.value = value if isinstance(value, dict) else {}
        except (OSError, ValueError):
            self.value = {}
        self.value.setdefault("issues", {})
        self.value.setdefault("daily_runs", {})

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.value, indent=2) + "\n", encoding="utf-8")
        temporary.chmod(0o600)
        temporary.replace(self.path)

    def runs_today(self, now: dt.datetime | None = None) -> int:
        return int(self.value["daily_runs"].get((now or utc_now()).date().isoformat(), 0))

    def record_run(self, now: dt.datetime | None = None) -> None:
        day = (now or utc_now()).date().isoformat()
        self.value["daily_runs"][day] = self.runs_today(now) + 1
        self.save()


def load_config(path: pathlib.Path = CONFIG) -> dict[str, Any]:
    if not path.exists():
        raise RuntimeError(f"missing {path}; copy config/autonomy.example.json first")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("autonomy config must be an object")
    return value


@contextmanager
def singleton(path: pathlib.Path = AUTONOMY / "daemon.lock"):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open("a+", encoding="utf-8") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("autonomous orchestrator is already running") from error
        handle.seek(0); handle.truncate(); handle.write(str(os.getpid())); handle.flush()
        yield


def github(path: str, token: str, method: str = "GET", data: dict | None = None) -> Any:
    request = urllib.request.Request(
        "https://api.github.com" + path,
        data=json.dumps(data).encode() if data is not None else None,
        method=method,
        headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "wawalu-autonomous-team"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response) if response.length != 0 else None


def issue_label(issue: dict[str, Any], prefix: str) -> str | None:
    for label in issue.get("labels", []):
        name = label.get("name", "") if isinstance(label, dict) else str(label)
        if name.startswith(prefix):
            return name.removeprefix(prefix)
    return None


def list_ready_issues(token: str, label: str) -> list[dict[str, Any]]:
    query = urllib.parse.urlencode({"state": "open", "labels": label, "sort": "created", "direction": "asc", "per_page": 100})
    value = github(f"/repos/{REPOSITORY}/issues?{query}", token)
    return [item for item in value if "pull_request" not in item]


def recent_issue_titles(token: str) -> list[str]:
    query = urllib.parse.urlencode({"state": "all", "sort": "updated", "direction": "desc", "per_page": 30})
    return [item.get("title", "") for item in github(f"/repos/{REPOSITORY}/issues?{query}", token)
            if "pull_request" not in item]


def comment(token: str, number: int, state: str, detail: str) -> None:
    body = f"<!-- wawalu-agent-state -->\n**Synthetic team · {state}**\n\n{detail}"
    github(f"/repos/{REPOSITORY}/issues/{number}/comments", token, "POST", {"body": body})


def ensure_labels(token: str, ready_label: str) -> None:
    labels = {
        ready_label: ("2f81f7", "Queued for the autonomous synthetic team"),
        "agent-running": ("d4a72c", "A synthetic worker is executing this issue"),
        "agent-blocked": ("d73a4a", "Autonomous execution needs attention"),
        "persona:backend": ("6f42c1", "Assigned to Rowan"),
        "persona:frontend": ("9b59b6", "Assigned to Mina"),
        "persona:infrastructure": ("596b31", "Assigned to Ellis"),
        "persona:staff": ("245a8d", "Assigned to Priya"),
    }
    existing = {item["name"] for item in github(f"/repos/{REPOSITORY}/labels?per_page=100", token)}
    for name, (color, description) in labels.items():
        if name not in existing:
            github(f"/repos/{REPOSITORY}/labels", token, "POST",
                   {"name": name, "color": color, "description": description})


def create_generated_issue(token: str, proposal: dict[str, Any], ready_label: str) -> dict[str, Any]:
    criteria = "\n".join(f"- [ ] {item}" for item in proposal["acceptance_criteria"])
    body = (f"Generated by Sam, the synthetic engineering manager, from `PRODUCT.md`.\n\n"
            f"## Outcome\n\n{proposal['outcome']}\n\n## Acceptance criteria\n\n{criteria}\n\n"
            "This is a bounded demo-team task. Normal review and production controls apply.")
    return github(f"/repos/{REPOSITORY}/issues", token, "POST", {
        "title": proposal["title"], "body": body,
        "labels": [ready_label, f"persona:{proposal['persona']}"]})


def replace_state_label(token: str, issue: dict[str, Any], ready_label: str,
                        add: str | None, keep_ready: bool) -> None:
    labels = [item.get("name", "") if isinstance(item, dict) else str(item)
              for item in issue.get("labels", [])]
    labels = [label for label in labels if label not in {"agent-running", "agent-blocked"}]
    if not keep_ready:
        labels = [label for label in labels if label != ready_label]
    if add and add not in labels:
        labels.append(add)
    github(f"/repos/{REPOSITORY}/issues/{issue['number']}", token, "PATCH", {"labels": labels})


def generate_work(token: str, config: dict[str, Any], journal: Journal) -> dict[str, Any]:
    run_dir = AUTONOMY / "manager" / utc_now().strftime("%Y%m%dT%H%M%SZ")
    run_dir.mkdir(parents=True, exist_ok=False)
    manager = (ROOT / "personas" / "manager.md").read_text(encoding="utf-8")
    proposal = propose_task(manager, (ROOT / "PRODUCT.md").read_text(encoding="utf-8"),
                            recent_issue_titles(token), run_dir / "qwen-task.json")
    issue = create_generated_issue(token, proposal, config["issue_label"])
    journal.emit("task_generated", issue=issue["number"], persona=proposal["persona"], title=proposal["title"])
    return issue


def scenario_from_issue(issue: dict[str, Any], persona: str) -> dict[str, Any]:
    title = str(issue.get("title", "")).strip()
    body = str(issue.get("body") or "").strip()
    return {"id": f"issue-{issue['number']}-{title}", "issue": issue["number"], "title": title,
            "outcome": body[:12000] or title,
            "acceptance_criteria": ["The issue outcome is implemented", "Relevant automated tests pass",
                                    "The production build succeeds"], "assigned_persona": persona}


def choose_issue(issues: list[dict[str, Any]], state: State, config: dict[str, Any], now: dt.datetime) -> dict[str, Any] | None:
    cooldown = int(config["retry_cooldown_seconds"])
    max_attempts = int(config["max_attempts"])
    for issue in issues:
        record = state.value["issues"].get(str(issue["number"]), {})
        if record.get("status") in {"submitted", "blocked"}:
            continue
        if int(record.get("attempts", 0)) >= max_attempts:
            continue
        retry_at = record.get("retry_at")
        if retry_at and dt.datetime.fromisoformat(retry_at) > now:
            continue
        return issue
    return None


def sync_main() -> None:
    branch = subprocess.check_output(["git", "branch", "--show-current"], cwd=ROOT, text=True).strip()
    if branch != "main":
        raise RuntimeError(f"autonomous checkout must be on main, found {branch!r}")
    subprocess.run(["git", "fetch", "origin", "main", "--prune"], cwd=ROOT, check=True)
    subprocess.run(["git", "merge", "--ff-only", "origin/main"], cwd=ROOT, check=True)


def cleanup_worktree(path: pathlib.Path, journal: Journal) -> None:
    subprocess.run(["git", "worktree", "prune"], cwd=ROOT, check=True)
    if path.is_dir():
        subprocess.run(["git", "worktree", "remove", "--force", str(path)], cwd=ROOT, check=False)
        if not path.exists():
            journal.emit("worktree_cleaned", path=path.name)


def execute_issue(issue: dict[str, Any], config: dict[str, Any], state: State,
                  journal: Journal, token: str) -> int:
    number = int(issue["number"])
    persona = issue_label(issue, "persona:") or "staff"
    if persona not in PERSONAS:
        persona = "staff"
    record = state.value["issues"].setdefault(str(number), {})
    record.update({"status": "running", "persona": persona,
                   "attempts": int(record.get("attempts", 0)) + 1, "started_at": utc_now().isoformat()})
    state.record_run()
    scenario_dir = AUTONOMY / "scenarios"
    scenario_dir.mkdir(parents=True, exist_ok=True)
    scenario_path = scenario_dir / f"issue-{number}-{uuid.uuid4().hex[:6]}.json"
    scenario = scenario_from_issue(issue, persona)
    scenario_path.write_text(json.dumps(scenario, indent=2) + "\n", encoding="utf-8")
    scenario_slug = safe_slug(scenario["id"])
    worktree = ROOT / ".agent" / "worktrees" / f"{persona}-{scenario_slug}"
    replace_state_label(token, issue, config["issue_label"], "agent-running", keep_ready=True)
    comment(token, number, "planning", f"Sam assigned this issue to **{persona}**. Qwen is preparing the implementation handoff.")
    journal.emit("run_started", issue=number, persona=persona)
    command = [sys.executable, "-m", "runner.orchestrator", "run", persona,
               str(scenario_path.relative_to(ROOT)), "--push", "--worker", config["default_worker"]]
    result = subprocess.run(command, cwd=ROOT)
    scenario_path.unlink(missing_ok=True)
    if result.returncode == 0:
        record.update({"status": "submitted", "finished_at": utc_now().isoformat()})
        comment(token, number, "submitted", "The worker completed its run and opened a reviewed pull request. If it requested merge, GitHub will deliver it after required checks.")
        replace_state_label(token, issue, config["issue_label"], "agent-running", keep_ready=False)
        journal.emit("run_submitted", issue=number, persona=persona)
    else:
        attempts = int(record["attempts"])
        if attempts >= int(config["max_attempts"]):
            record["status"] = "blocked"
            comment(token, number, "blocked", f"The run failed {attempts} times and needs human attention. Exit code: `{result.returncode}`.")
            replace_state_label(token, issue, config["issue_label"], "agent-blocked", keep_ready=False)
        else:
            record["status"] = "retry"
            record["retry_at"] = (utc_now() + dt.timedelta(seconds=int(config["retry_cooldown_seconds"]))).isoformat()
            comment(token, number, "retry scheduled", f"The run exited with `{result.returncode}`. It will retry after the configured cooldown.")
            replace_state_label(token, issue, config["issue_label"], None, keep_ready=True)
        journal.emit("run_failed", issue=number, persona=persona, exit_code=result.returncode, attempts=attempts)
    state.save()
    cleanup_worktree(worktree, journal)
    return result.returncode


def within_hours(config: dict[str, Any], now: dt.datetime | None = None) -> bool:
    hour = (now or dt.datetime.now().astimezone()).astimezone().hour
    window = config["working_hours"]
    return int(window["start"]) <= hour < int(window["end"])


def tick(config: dict[str, Any], state: State, journal: Journal, token: str | None = None) -> str:
    if STOP.exists() or not config.get("enabled", False):
        return "stopped"
    if not within_hours(config):
        return "outside-working-hours"
    if state.runs_today() >= int(config["max_runs_per_day"]):
        return "daily-run-limit"
    token = token or installation_token()
    sync_main()
    ensure_labels(token, config["issue_label"])
    issues = list_ready_issues(token, config["issue_label"])
    issue = choose_issue(issues, state, config, utc_now())
    if issue is None and config.get("generate_when_idle", False):
        issue = generate_work(token, config, journal)
    if issue is None:
        return "idle"
    execute_issue(issue, config, state, journal, token)
    return "executed"


def command_loop(once: bool = False) -> int:
    config = load_config()
    journal = Journal()
    state = State()
    with singleton():
        journal.emit("daemon_started", once=once)
        while True:
            try:
                result = tick(config, state, journal)
                journal.emit("tick", result=result)
            except Exception as error:
                journal.emit("daemon_error", error=type(error).__name__, detail=str(error)[:500])
            if once or STOP.exists():
                break
            time.sleep(max(30, int(config["poll_seconds"])))
        journal.emit("daemon_stopped")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Autonomous Wawalu synthetic-team manager")
    sub = parser.add_subparsers(dest="command", required=True)
    loop = sub.add_parser("loop"); loop.add_argument("--once", action="store_true")
    sub.add_parser("stop"); sub.add_parser("resume"); sub.add_parser("status")
    args = parser.parse_args()
    AUTONOMY.mkdir(parents=True, exist_ok=True)
    if args.command == "stop":
        STOP.touch(mode=0o600, exist_ok=True); print("autonomous team stopped"); return 0
    if args.command == "resume":
        STOP.unlink(missing_ok=True); print("autonomous team resumed"); return 0
    if args.command == "status":
        config = load_config(); state = State()
        print(json.dumps({"enabled": config.get("enabled"), "stopped": STOP.exists(),
                          "runs_today": state.runs_today(), "max_runs_per_day": config.get("max_runs_per_day"),
                          "state": state.value}, indent=2)); return 0
    return command_loop(args.once)


if __name__ == "__main__":
    raise SystemExit(main())
