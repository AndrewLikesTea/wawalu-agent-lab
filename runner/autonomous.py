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
import urllib.error
import urllib.parse
import urllib.request
import uuid
import hashlib
from contextlib import contextmanager
from typing import Any
from zoneinfo import ZoneInfo

from runner.delivery import enable_auto_merge
from runner.github_app import installation_token, reviewer_token
from runner.layers import consult_next_steps, propose_directive_plan, propose_task, review_pull_request
from runner.orchestrator import load_personas, load_runtime_env, safe_slug
from runner.simulation import choose_collaborator, load_behaviors
from scripts.check_reviewer_approval import REVIEWER_LOGINS, approved_current_head

ROOT = pathlib.Path(__file__).resolve().parents[1]
AUTONOMY = ROOT / ".agent" / "autonomy"
CONFIG = ROOT / ".secrets" / "autonomy.json"
STOP = AUTONOMY / "STOP"
REPOSITORY = "AndrewLikesTea/wawalu-agent-lab"
OWNER = REPOSITORY.split("/")[0]
PERSONAS = {"backend", "frontend", "infrastructure", "staff"}
PERSONA_NAMES = {"backend": "Rowan", "frontend": "Mina",
                 "infrastructure": "Ellis", "staff": "Priya"}
DIRECTIVE = AUTONOMY / "directive.json"
PACIFIC = ZoneInfo("America/Los_Angeles")


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
        self.value.setdefault("persona_submissions", {})
        self.value.setdefault("pr_reviews", {})
        self.value.setdefault("pr_updates", {})

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

    def persona_available(self, persona: str, interval_seconds: int,
                          now: dt.datetime | None = None) -> bool:
        submitted_at = self.value["persona_submissions"].get(persona)
        if not submitted_at:
            return True
        return dt.datetime.fromisoformat(submitted_at) + dt.timedelta(seconds=interval_seconds) <= (now or utc_now())

    def record_submission(self, persona: str, now: dt.datetime | None = None) -> None:
        self.value["persona_submissions"][persona] = (now or utc_now()).isoformat()
        self.save()


class DirectiveStore:
    def __init__(self, path: pathlib.Path | None = None):
        self.path = path or DIRECTIVE

    def read(self) -> dict[str, Any] | None:
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) and value.get("status") == "pending" else None
        except (OSError, ValueError):
            return None

    def read_any(self) -> dict[str, Any] | None:
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else None
        except (OSError, ValueError):
            return None

    def set(self, text: str) -> dict[str, Any]:
        text = " ".join(text.split()).strip()
        if not text:
            raise ValueError("manager directive cannot be empty")
        if len(text) > 4000:
            raise ValueError("manager directive cannot exceed 4,000 characters")
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        value = {"status": "pending", "text": text, "created_at": utc_now().isoformat()}
        self.path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
        self.path.chmod(0o600)
        return value

    def consume(self, issue: int) -> None:
        value = self.read()
        if not value:
            return
        value.update({"status": "consumed", "issue": issue, "consumed_at": utc_now().isoformat()})
        self.path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
        self.path.chmod(0o600)

    def _write(self, value: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
        self.path.chmod(0o600)

    def read_migrated(self) -> dict[str, Any] | None:
        """Read the directive, converting the pre-round single-consultation record."""
        value = self.read_any()
        if value and "consultation" in value and not value.get("consultations"):
            legacy = value.pop("consultation")
            value["consultations"] = [{
                "worker": legacy.get("worker"), "created_at": legacy.get("created_at"),
                "plan": [{"title": "migrated single follow-up"}],
                "created_issues": [{"index": 0, "issue": int(legacy["issue"])}],
            }]
            self._write(value)
        return value

    def begin_consultation(self, worker: str) -> dict[str, Any]:
        value = self.read_any()
        if not value:
            raise RuntimeError("no directive to update")
        rounds = list(value.get("consultations", []))
        rounds.append({"worker": worker, "created_at": utc_now().isoformat(),
                       "created_issues": []})
        value["consultations"] = rounds
        self._write(value)
        return rounds[-1]

    def update_consultation(self, **fields: Any) -> dict[str, Any]:
        value = self.read_any()
        rounds = value.get("consultations") if value else None
        if not rounds:
            raise RuntimeError("no consultation round to update")
        rounds[-1].update(fields)
        self._write(value)
        return rounds[-1]

    def record_consultation_issue(self, index: int, issue: int) -> dict[str, Any]:
        value = self.read_any()
        rounds = value.get("consultations") if value else None
        if not rounds:
            raise RuntimeError("no consultation round to update")
        created = list(rounds[-1].get("created_issues", []))
        created.append({"index": index, "issue": issue})
        rounds[-1]["created_issues"] = created
        self._write(value)
        return rounds[-1]

    def save_plan(self, tasks: list[dict[str, Any]]) -> dict[str, Any]:
        value = self.read()
        if not value:
            raise RuntimeError("no pending directive")
        value.update({"plan": tasks, "created_issues": value.get("created_issues", [])})
        self.path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
        self.path.chmod(0o600)
        return value

    def record_created_issue(self, index: int, issue: int) -> dict[str, Any]:
        value = self.read()
        if not value:
            raise RuntimeError("no pending directive")
        created = list(value.get("created_issues", []))
        created.append({"index": index, "issue": issue})
        value["created_issues"] = created
        self.path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
        self.path.chmod(0o600)
        return value

    def clear(self) -> None:
        self.path.unlink(missing_ok=True)


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


def recent_issue_context(token: str) -> list[str]:
    query = urllib.parse.urlencode({"state": "all", "sort": "updated", "direction": "desc", "per_page": 30})
    context = []
    for item in github(f"/repos/{REPOSITORY}/issues?{query}", token):
        if "pull_request" in item:
            continue
        persona = issue_label(item, "persona:")
        assignment = (f"{PERSONA_NAMES.get(persona, persona)} ({persona})"
                      if persona else "unassigned")
        context.append(f"[{assignment}] {item.get('title', '')}")
    return context


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


def create_generated_issue(token: str, proposal: dict[str, Any], ready_label: str,
                           depends_on: int | None = None) -> dict[str, Any]:
    criteria = "\n".join(f"- [ ] {item}" for item in proposal["acceptance_criteria"])
    dependency = f"\n\n## Dependency\n\nDepends on #{depends_on}." if depends_on else ""
    body = (f"Generated by Sam, the synthetic engineering manager, from `PRODUCT.md`.\n\n"
            f"## Outcome\n\n{proposal['outcome']}\n\n## Acceptance criteria\n\n{criteria}\n\n"
            f"This is a bounded demo-team task. Normal review and production controls apply.{dependency}")
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
                            recent_issue_context(token), run_dir / "qwen-task.json")
    issue = create_generated_issue(token, proposal, config["issue_label"])
    journal.emit("task_generated", issue=issue["number"], persona=proposal["persona"], title=proposal["title"])
    return issue


def generate_directive_backlog(token: str, config: dict[str, Any], journal: Journal,
                               directive: dict[str, Any]) -> list[dict[str, Any]]:
    store = DirectiveStore()
    run_dir = AUTONOMY / "manager" / (utc_now().strftime("%Y%m%dT%H%M%SZ") + "-directive")
    run_dir.mkdir(parents=True, exist_ok=False)
    tasks = directive.get("plan")
    if not isinstance(tasks, list):
        tasks = propose_directive_plan(
            (ROOT / "personas" / "manager.md").read_text(encoding="utf-8"),
            (ROOT / "PRODUCT.md").read_text(encoding="utf-8"), recent_issue_context(token),
            directive["text"], run_dir / "qwen-directive-plan.json")
        directive = store.save_plan(tasks)
    created = {int(item["index"]): int(item["issue"]) for item in directive.get("created_issues", [])}
    issues = []
    for index, task in enumerate(tasks):
        if index in created:
            issues.append(github(f"/repos/{REPOSITORY}/issues/{created[index]}", token))
            continue
        dependency = issues[-1]["number"] if issues else None
        issue = create_generated_issue(token, task, config["issue_label"], dependency)
        store.record_created_issue(index, issue["number"])
        issues.append(issue)
        journal.emit("directive_task_generated", issue=issue["number"], order=index + 1,
                     persona=task["persona"], title=task["title"])
    store.consume(issues[0]["number"])
    journal.emit("directive_backlog_created", issues=[item["number"] for item in issues],
                 directive_sha256=hashlib.sha256(directive["text"].encode()).hexdigest())
    return issues


def consultation_complete(consultation: dict[str, Any]) -> bool:
    plan = consultation.get("plan")
    return isinstance(plan, list) and len(consultation.get("created_issues", [])) >= len(plan)


def consult_after_directive_mvp(token: str, config: dict[str, Any], journal: Journal,
                                worker: str = "auto") -> list[dict[str, Any]] | None:
    store = DirectiveStore()
    directive = store.read_migrated()
    if not directive or directive.get("status") != "consumed" or not directive.get("created_issues"):
        return None
    rounds = list(directive.get("consultations", []))
    current = rounds[-1] if rounds else None
    if current is None or consultation_complete(current):
        latest = current.get("created_issues", []) if current else directive["created_issues"]
        for reference in latest:
            issue = github(f"/repos/{REPOSITORY}/issues/{int(reference['issue'])}", token)
            if issue.get("state") != "closed":
                return None
        max_rounds = int(config.get("max_consultation_rounds", 0))
        if max_rounds and len(rounds) >= max_rounds:
            return None
        if worker == "auto":
            digest = hashlib.sha256(f"{directive['text']}:{len(rounds)}".encode()).hexdigest()
            worker = "codex" if int(digest, 16) % 2 == 0 else "claude"
        if worker not in {"codex", "claude"}:
            raise ValueError("consultation worker must be auto, codex, or claude")
        current = store.begin_consultation(worker)
        rounds.append(current)
    round_number = len(rounds)
    worker = current["worker"]
    run_dir = AUTONOMY / "manager" / (utc_now().strftime("%Y%m%dT%H%M%SZ") + "-consultation")
    run_dir.mkdir(parents=True, exist_ok=True)
    idea = current.get("idea")
    if not idea:
        personas, runtime = load_personas(), load_runtime_env()
        idea = consult_next_steps(
            worker, directive["text"], (ROOT / "PRODUCT.md").read_text(encoding="utf-8"),
            ROOT, run_dir, personas["manager"]["wawalu_token"],
            runtime["WAWALU_INGEST_ENDPOINT"].rstrip("/"))
        current = store.update_consultation(idea=idea)
    tasks = current.get("plan")
    if not isinstance(tasks, list):
        tasks = propose_directive_plan(
            (ROOT / "personas" / "manager.md").read_text(encoding="utf-8"),
            (ROOT / "PRODUCT.md").read_text(encoding="utf-8"), recent_issue_context(token),
            directive["text"], run_dir / "qwen-followup-plan.json", advisory=idea)
        current = store.update_consultation(plan=tasks)
    created = {int(item["index"]): int(item["issue"]) for item in current.get("created_issues", [])}
    issues = []
    for index, task in enumerate(tasks):
        if index in created:
            issues.append(github(f"/repos/{REPOSITORY}/issues/{created[index]}", token))
            continue
        dependency = issues[-1]["number"] if issues else None
        issue = create_generated_issue(token, task, config["issue_label"], dependency)
        store.record_consultation_issue(index, issue["number"])
        issues.append(issue)
        journal.emit("directive_followup_task_generated", issue=issue["number"], order=index + 1,
                     round=round_number, persona=task["persona"], title=task["title"])
    journal.emit("directive_followup_consulted", worker=worker, round=round_number,
                 issues=[item["number"] for item in issues],
                 directive_sha256=hashlib.sha256(directive["text"].encode()).hexdigest())
    return issues


def fetch_pull_diff(number: int, token: str) -> str:
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPOSITORY}/pulls/{number}",
        headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github.v3.diff",
                 "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "wawalu-autonomous-team"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", "replace")


def review_owner_pull(pull: dict[str, Any], token: str, config: dict[str, Any],
                      journal: Journal) -> dict[str, Any]:
    number = int(pull["number"])
    head_sha = pull["head"]["sha"]
    run_dir = AUTONOMY / "manager" / (utc_now().strftime("%Y%m%dT%H%M%SZ") + f"-review-pr{number}")
    run_dir.mkdir(parents=True, exist_ok=True)
    diff = fetch_pull_diff(number, token)
    reviewer_prompt = (ROOT / "personas" / "reviewer.md").read_text(encoding="utf-8")
    verdict = review_pull_request(reviewer_prompt, pull, diff, run_dir / "qwen-pr-review.json")
    if verdict["approved"]:
        github(f"/repos/{REPOSITORY}/pulls/{number}/reviews", reviewer_token(), "POST",
               {"commit_id": head_sha, "event": "APPROVE",
                "body": f"Approved by the synthetic reviewer persona. Qwen review: {verdict['summary']}"})
        journal.emit("owner_pr_approved", pull=number, sha=head_sha)
        if (pull.get("user") or {}).get("login") == OWNER and config.get("auto_merge_owner_prs", True):
            try:
                enable_auto_merge(REPOSITORY, pull["head"]["ref"], token, ROOT)
                journal.emit("owner_pr_auto_merge_enabled", pull=number)
            except Exception as error:
                journal.emit("owner_pr_auto_merge_failed", pull=number,
                             error=type(error).__name__, detail=str(error)[:300])
    else:
        comment(token, number, "changes requested",
                f"Marcus reviewed `{head_sha[:10]}` and did not approve:\n\n{verdict['feedback'][:2000]}")
        journal.emit("owner_pr_rejected", pull=number, sha=head_sha)
    return verdict


def update_pull_branch(pull: dict[str, Any], token: str, state: State,
                       journal: Journal) -> None:
    """Unstick an approved, auto-merging pull request whose branch fell behind main."""
    number = int(pull["number"])
    head_sha = pull["head"]["sha"]
    record = state.value["pr_updates"].get(str(number), {})
    if record.get("sha") == head_sha:
        return
    detail = github(f"/repos/{REPOSITORY}/pulls/{number}", token)
    mergeable_state = str(detail.get("mergeable_state") or "unknown")
    if mergeable_state == "dirty":
        state.value["pr_updates"][str(number)] = {
            "sha": head_sha, "result": "conflict", "at": utc_now().isoformat()}
        state.save()
        comment(token, number, "merge conflict",
                f"This pull request conflicts with `main` at `{head_sha[:10]}` and cannot be "
                "updated automatically. It needs a manual rebase or a fresh implementation.")
        journal.emit("pr_update_conflict", pull=number, sha=head_sha)
        return
    if mergeable_state != "behind":
        return
    try:
        github(f"/repos/{REPOSITORY}/pulls/{number}/update-branch", token, "PUT",
               {"expected_head_sha": head_sha})
    except urllib.error.HTTPError as error:
        detail_body = error.read().decode("utf-8", "replace")[:300]
        journal.emit("pr_update_failed", pull=number, sha=head_sha,
                     code=error.code, detail=detail_body)
        if error.code != 422:
            raise
        return
    state.value["pr_updates"][str(number)] = {
        "sha": head_sha, "result": "updated", "at": utc_now().isoformat()}
    state.save()
    journal.emit("pr_branch_updated", pull=number, sha=head_sha)


def review_outstanding_prs(token: str, config: dict[str, Any], state: State,
                           journal: Journal) -> list[int]:
    """Marcus reviews open PRs from the owner, or team-approved PRs whose head moved."""
    approved = []
    pulls = github(f"/repos/{REPOSITORY}/pulls?state=open&per_page=50", token)
    for pull in pulls or []:
        if pull.get("draft"):
            continue
        number = int(pull["number"])
        head_sha = pull["head"]["sha"]
        reviews = github(f"/repos/{REPOSITORY}/pulls/{number}/reviews?per_page=100", token) or []
        author = (pull.get("user") or {}).get("login", "")
        team_approved_before = any(
            isinstance(item, dict) and item.get("state") == "APPROVED"
            and (item.get("user") or {}).get("login") in REVIEWER_LOGINS
            for item in reviews)
        if author != OWNER and not team_approved_before:
            continue
        if approved_current_head(reviews, head_sha):
            if pull.get("auto_merge") and config.get("update_stuck_prs", True):
                update_pull_branch(pull, token, state, journal)
            continue
        record = state.value["pr_reviews"].get(str(number), {})
        if record.get("sha") == head_sha:
            continue
        try:
            verdict = review_owner_pull(pull, token, config, journal)
        except Exception as error:
            journal.emit("owner_review_error", pull=number,
                         error=type(error).__name__, detail=str(error)[:300])
            continue
        state.value["pr_reviews"][str(number)] = {
            "sha": head_sha, "approved": verdict["approved"], "at": utc_now().isoformat()}
        state.save()
        if verdict["approved"]:
            approved.append(number)
    return approved


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
    open_numbers = {int(issue["number"]) for issue in issues}
    for issue in issues:
        dependency = __import__("re").search(r"Depends on #(\d+)", str(issue.get("body") or ""))
        if dependency and int(dependency.group(1)) in open_numbers:
            continue
        persona = issue_label(issue, "persona:") or "staff"
        if not state.persona_available(persona, int(config["min_pr_interval_seconds"]), now):
            continue
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


def cleanup_worktree(path: pathlib.Path, branch: str, journal: Journal) -> None:
    subprocess.run(["git", "worktree", "prune"], cwd=ROOT, check=True)
    if path.is_dir():
        subprocess.run(["git", "worktree", "remove", "--force", str(path)], cwd=ROOT, check=False)
        if not path.exists():
            journal.emit("worktree_cleaned", path=path.name)
    deleted = subprocess.run(["git", "branch", "--delete", "--force", branch], cwd=ROOT,
                             text=True, capture_output=True)
    if deleted.returncode == 0:
        journal.emit("local_branch_cleaned", branch=branch)


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
    behaviors = load_behaviors()
    eligible = [candidate for candidate in PERSONAS
                if state.persona_available(candidate, int(config["min_pr_interval_seconds"]))]
    collaborator = choose_collaborator(persona, scenario["id"], eligible, behaviors)
    if collaborator:
        scenario["collaborators"] = [collaborator]
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
        state.record_submission(persona)
        for collaborator in scenario.get("collaborators", []):
            state.record_submission(collaborator)
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
    cleanup_worktree(worktree, f"agent/{persona}/{scenario_slug}", journal)
    return result.returncode


def within_hours(config: dict[str, Any], now: dt.datetime | None = None) -> bool:
    hour = (now or dt.datetime.now(PACIFIC)).astimezone(PACIFIC).hour
    window = config["working_hours"]
    return int(window["start"]) <= hour < int(window["end"])


def tick(config: dict[str, Any], state: State, journal: Journal, token: str | None = None) -> str:
    if STOP.exists() or not config.get("enabled", False):
        return "stopped"
    if not within_hours(config):
        return "outside-working-hours"
    token = token or installation_token()
    sync_main()
    ensure_labels(token, config["issue_label"])
    if config.get("review_owner_prs", True):
        review_outstanding_prs(token, config, state, journal)
    issues = list_ready_issues(token, config["issue_label"])
    directive = DirectiveStore().read()
    issue = None
    if directive:
        generated = generate_directive_backlog(token, config, journal, directive)
        issue = choose_issue(generated, state, config, utc_now())
        if issue is None:
            return "persona-pr-rate-limit"
    if issue is None:
        issue = choose_issue(issues, state, config, utc_now())
    if issue is None and issues:
        return "queued-personas-rate-limited"
    if issue is None and config.get("consult_after_directive_mvp", False):
        generated = consult_after_directive_mvp(token, config, journal)
        if generated:
            issue = choose_issue(generated, state, config, utc_now())
            if issue is None:
                return "persona-pr-rate-limit"
    if issue is None and config.get("generate_when_idle", False):
        generated = generate_work(token, config, journal)
        issue = choose_issue([generated], state, config, utc_now())
        if issue is None:
            return "persona-pr-rate-limit"
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
    sub.add_parser("review-prs")
    directive = sub.add_parser("directive")
    directive.add_argument("text", nargs="*")
    directive.add_argument("--clear", action="store_true")
    args = parser.parse_args()
    AUTONOMY.mkdir(parents=True, exist_ok=True)
    if args.command == "stop":
        STOP.touch(mode=0o600, exist_ok=True); print("autonomous team stopped"); return 0
    if args.command == "resume":
        STOP.unlink(missing_ok=True); print("autonomous team resumed"); return 0
    if args.command == "directive":
        store = DirectiveStore()
        if args.clear:
            store.clear(); print("manager directive cleared"); return 0
        if args.text:
            value = store.set(" ".join(args.text))
            print(json.dumps({"status": value["status"], "text": value["text"]}, indent=2)); return 0
        print(json.dumps(store.read(), indent=2)); return 0
    if args.command == "review-prs":
        approved = review_outstanding_prs(installation_token(), load_config(), State(), Journal())
        print(json.dumps({"approved_pulls": approved}, indent=2)); return 0
    if args.command == "status":
        config = load_config(); state = State()
        print(json.dumps({"enabled": config.get("enabled"), "stopped": STOP.exists(),
                          "attempts_today": state.runs_today(),
                          "min_pr_interval_seconds": config.get("min_pr_interval_seconds"),
                          "directive": DirectiveStore().read(), "state": state.value}, indent=2)); return 0
    return command_loop(args.once)


if __name__ == "__main__":
    raise SystemExit(main())
