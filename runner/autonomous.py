"""Single-machine autonomous manager for the synthetic engineering team."""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import threading
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
from runner.github_app import (current_token, installation_token, refresh_token,
                               reviewer_token)
from runner.layers import (CAPACITY_EXIT_CODES, PROVIDER_OVERLOAD_EXIT_CODE, WORKERS,
                           ConsultantCapacityExhausted, capacity_reset_at,
                           consult_next_steps, propose_directive_plan, propose_task,
                           review_pull_request, snapshot_live_site, stakeholder_review)
from runner.orchestrator import (BUDGET, DIFF_BUDGET_EXIT_CODE, PRODUCT_ROOT, REPOSITORY,
                                 checkout_lock, load_personas, load_runtime_env, safe_slug)
from runner.simulation import choose_collaborator, load_behaviors
from scripts.check_reviewer_approval import REVIEWER_LOGINS, approved_current_head

ROOT = pathlib.Path(__file__).resolve().parents[1]
AUTONOMY = ROOT / ".agent" / "autonomy"
CONFIG = ROOT / ".secrets" / "autonomy.json"
STOP = AUTONOMY / "STOP"
OWNER = REPOSITORY.split("/")[0]
PERSONA_NAMES = {"backend": "Rowan", "frontend": "Mina",
                 "infrastructure": "Ellis", "staff": "Priya",
                 "product": "Noor", "design": "Iris",
                 "evaluation": "Theo", "integrations": "Anya",
                 "copywriter": "Jude", "graphics": "Kai",
                 "fullstack": "Remy", "qa": "Tess",
                 "security": "Vera", "platform": "Omar"}
# Stakeholders speak (feedback + filed tasks) but never receive assignments or
# run workers themselves, so they live outside PERSONA_NAMES.
STAKEHOLDER_NAMES = {"sales": "Sasha"}
# Assignable engineers, in the order they are shown to the planner. Derived from
# PERSONA_NAMES so a roster change lands in one place: an earlier split between
# this set, the planner's schema, and the label map is how a persona ends up
# assignable but unlabelled, or named but never assigned.
PERSONAS = set(PERSONA_NAMES)
ASSIGNABLE_PERSONAS = tuple(PERSONA_NAMES)
CAPACITY_WORKERS = {code: worker for worker, code in CAPACITY_EXIT_CODES.items()}
DELIVERY_ATTEMPT_LIMIT = 3
PAUSED_LABEL = "paused"                        # owner parks an issue: never queue or requeue it
DIRECTIVE = AUTONOMY / "directive.json"        # legacy single-slot record, read once and carried forward
DIRECTIVES = AUTONOMY / "directives.json"
PACIFIC = ZoneInfo("America/Los_Angeles")


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


class Journal:
    """Append-only record of what the team did, written from every run thread.

    One ``write`` per line under a shared lock keeps entries whole: a partially
    flushed line would corrupt the only durable account of a run's outcome.
    """

    _write_lock = threading.Lock()

    def __init__(self, path: pathlib.Path = AUTONOMY / "events.jsonl"):
        self.path = path

    def emit(self, event: str, **fields: Any) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        entry = {"at": utc_now().isoformat(), "event": event, **fields}
        line = json.dumps(entry, separators=(",", ":")) + "\n"
        with self._write_lock, self.path.open("a", encoding="utf-8") as handle:
            handle.write(line)
        self.path.chmod(0o600)


class State:
    """The manager's durable memory, mutated by the tick thread and every run thread.

    Writes go through :meth:`mutate`, which holds an exclusive ``flock`` on a sidecar
    file across load→change→save. Re-reading inside that lock is the point of it: a
    run that started an hour ago must not save the snapshot it loaded back then over
    a newer run's record — or over the owner's requeue edit, made by hand while the
    daemon was working. Reads stay lock-free, because :meth:`save` swaps the file in
    by rename, so a reader always sees one whole version.
    """

    BUCKETS = ("issues", "daily_runs", "persona_submissions", "pr_reviews", "pr_updates",
               "pr_deliveries", "standups", "handoffs", "worker_cooldowns")

    def __init__(self, path: pathlib.Path = AUTONOMY / "state.json"):
        self.path = path
        self.lock_path = path.with_name(path.name + ".lock")
        self._guard = threading.RLock()
        self._held = 0
        self.value: dict[str, Any] = {}
        self._adopt(self._read())

    def _read(self) -> dict[str, Any] | None:
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return value if isinstance(value, dict) else {}

    def _adopt(self, value: dict[str, Any] | None) -> None:
        if value is not None:
            self.value = value
        for bucket in self.BUCKETS:
            self.value.setdefault(bucket, {})

    def reload(self) -> None:
        """Re-read the file, keeping the in-memory value when there is nothing on disk yet."""
        self._adopt(self._read())

    @contextmanager
    def mutate(self):
        """Hold an exclusive lock across load→mutate→save, so no write lands on stale data.

        Re-entrant, so a helper such as ``record_submission`` can be called from inside
        a larger locked section without deadlocking on its own lock; the whole section
        then lands as a single write. Never wrap long work (a worker subprocess, a
        GitHub call) in this — the lock is for the read-modify-write, nothing more.
        """
        with self._guard:
            if self._held:
                self._held += 1
                try:
                    yield self
                finally:
                    self._held -= 1
                return
            self.lock_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with self.lock_path.open("a+", encoding="utf-8") as handle:
                fcntl.flock(handle, fcntl.LOCK_EX)
                self.lock_path.chmod(0o600)
                self._held = 1
                try:
                    self.reload()
                    yield self
                    self.save()
                finally:
                    self._held = 0
                    fcntl.flock(handle, fcntl.LOCK_UN)

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        # The scratch name carries the writer's identity: two runs saving at once must
        # not hand each other a half-written temporary file to rename into place.
        temporary = self.path.with_name(f"{self.path.name}.{os.getpid()}-{threading.get_ident()}.tmp")
        temporary.write_text(json.dumps(self.value, indent=2) + "\n", encoding="utf-8")
        temporary.chmod(0o600)
        temporary.replace(self.path)

    def runs_today(self, now: dt.datetime | None = None) -> int:
        return int(self.value["daily_runs"].get((now or utc_now()).date().isoformat(), 0))

    def record_run(self, now: dt.datetime | None = None) -> None:
        with self.mutate():
            day = (now or utc_now()).date().isoformat()
            self.value["daily_runs"][day] = self.runs_today(now) + 1

    def persona_available(self, persona: str, interval_seconds: int,
                          now: dt.datetime | None = None) -> bool:
        submitted_at = self.value["persona_submissions"].get(persona)
        if not submitted_at:
            return True
        return dt.datetime.fromisoformat(submitted_at) + dt.timedelta(seconds=interval_seconds) <= (now or utc_now())

    def record_submission(self, persona: str, now: dt.datetime | None = None) -> None:
        with self.mutate():
            self.value["persona_submissions"][persona] = (now or utc_now()).isoformat()

    def worker_available(self, worker: str, now: dt.datetime | None = None) -> bool:
        entry = self.value["worker_cooldowns"].get(worker)
        until = entry.get("until") if isinstance(entry, dict) else entry
        if not until:
            return True
        try:
            return dt.datetime.fromisoformat(str(until)) <= (now or utc_now())
        except ValueError:
            return True

    def record_worker_capacity(self, worker: str, delay_seconds: int,
                               now: dt.datetime | None = None,
                               maximum_seconds: int | None = None,
                               reset_at: dt.datetime | None = None) -> int:
        """Hold an exhausted provider out for longer each time it reports exhaustion.

        A session limit outlives one issue's backoff, so a flat cooldown lets the
        next issue re-pick the dead provider and burn another plan/worktree cycle
        before failing. The streak restarts once the provider has been quiet for a
        full ``maximum_seconds``, so a recovered provider is tried again cheaply.

        ``reset_at`` is the provider's own stated recovery time ("resets 8:50am").
        It only ever SHORTENS the cooldown: a blind exponential backoff that outlives
        the real reset idles the whole lab for nothing, which has cost this team
        hours of dead time. It never lengthens the hold past the configured cap,
        so a far-future reset claim cannot pin a provider out indefinitely.
        """
        now = now or utc_now()
        maximum = int(maximum_seconds or delay_seconds)
        with self.mutate():
            previous = self.value["worker_cooldowns"].get(worker)
            streak = 1
            if isinstance(previous, dict):
                try:
                    last = dt.datetime.fromisoformat(str(previous.get("at")))
                except (TypeError, ValueError):
                    last = None
                if last and last + dt.timedelta(seconds=maximum) > now:
                    streak = int(previous.get("streak", 1)) + 1
            delay = min(int(delay_seconds) * (2 ** (streak - 1)), maximum)
            if reset_at is not None:
                stated = max(int((reset_at - now).total_seconds()), 0)
                delay = min(delay, stated)
            self.value["worker_cooldowns"][worker] = {
                "until": (now + dt.timedelta(seconds=delay)).isoformat(),
                "streak": streak, "at": now.isoformat()}
        return delay


class RunRegistry:
    """The runs currently in flight, so the tick thread can keep working while they last.

    A run used to occupy the tick for its whole 10–60 minutes, which is why the team
    could only ever do one thing at a time: no sweep, no stakeholder review, and no
    planning happened while an engineer was implementing. Runs now execute on their
    own threads and this registry is what the tick consults instead.

    Two claims are taken together, and both matter. The issue, so a slow tick never
    starts a second run for work already underway. And the persona, because a persona
    is one person: two simultaneous runs under one name would put the same engineer on
    two pull requests at once, break the per-persona submission spacing, and make the
    team's story incoherent to anyone reading the repository.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._active: dict[int, tuple[str, threading.Thread]] = {}

    def start(self, issue: int, persona: str, body) -> bool:
        """Claim an issue and its persona, then run ``body`` on a daemon thread.

        Returns False when either claim is already held. Daemon threads are
        deliberate: a STOP must never wait on a run that has an hour left in it.
        """
        issue = int(issue)
        with self._lock:
            if issue in self._active or any(name == persona for name, _ in self._active.values()):
                return False
            thread = threading.Thread(target=self._run, args=(issue, body),
                                      name=f"run-issue-{issue}", daemon=True)
            self._active[issue] = (persona, thread)
        thread.start()
        return True

    def _run(self, issue: int, body) -> None:
        try:
            body()
        finally:
            with self._lock:
                self._active.pop(issue, None)

    def active(self) -> dict[int, str]:
        with self._lock:
            return {issue: persona for issue, (persona, _) in self._active.items()}

    def join(self, timeout: float | None = None) -> None:
        with self._lock:
            threads = [thread for _, thread in self._active.values()]
        for thread in threads:
            thread.join(timeout)

    def __len__(self) -> int:
        with self._lock:
            return len(self._active)


def max_concurrent_runs(config: dict[str, Any]) -> int:
    """How many issues may be implemented at once; 1 keeps the historical one-at-a-time team."""
    return max(1, int(config.get("max_concurrent_runs", 1)))


class DirectiveBook:
    """Every owner directive, each with its own program, persona scope, and lineage.

    The team runs more than one product line, so one directive slot is not enough:
    setting a second directive used to overwrite the first, discarding a live
    program's issue list and its consultation history. Directives are held as an
    ordered list instead, each independently pending, consumed, and consulted.
    """

    def __init__(self, path: pathlib.Path | None = None, legacy: pathlib.Path | None = None):
        self.path = path or DIRECTIVES
        self.legacy = legacy if legacy is not None else DIRECTIVE

    def _load(self) -> list[dict[str, Any]]:
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return self._adopt_legacy()
        directives = value.get("directives") if isinstance(value, dict) else None
        return [item for item in directives if isinstance(item, dict)] if isinstance(directives, list) else []

    def _adopt_legacy(self) -> list[dict[str, Any]]:
        """Carry a single-slot directive forward the first time the book is read.

        The upgrade must not strand a directive whose program is mid-flight, so the
        old record keeps its issues, plan, and consultation rounds and simply becomes
        the first entry. The legacy file is left untouched as a backup.
        """
        try:
            value = json.loads(self.legacy.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
        if not isinstance(value, dict) or not value.get("text"):
            return []
        value.setdefault("id", slug_for_directive(value["text"], value.get("created_at", "")))
        directives = [value]
        self._write(directives)
        return directives

    def write(self, directives: list[dict[str, Any]]) -> None:
        """Replace the whole book. Private to the owner, like every other autonomy file."""
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path.write_text(json.dumps({"directives": directives}, indent=2) + "\n", encoding="utf-8")
        self.path.chmod(0o600)

    _write = write

    def read(self) -> list[dict[str, Any]]:
        """All directives, with legacy single-consultation records converted."""
        directives, changed = self._load(), False
        for value in directives:
            if "consultation" in value and not value.get("consultations"):
                legacy = value.pop("consultation")
                value["consultations"] = [{
                    "worker": legacy.get("worker"), "created_at": legacy.get("created_at"),
                    "plan": [{"title": "migrated single follow-up"}],
                    "created_issues": [{"index": 0, "issue": int(legacy["issue"])}],
                }]
                changed = True
        if changed:
            self._write(directives)
        return directives

    def get(self, directive_id: str) -> dict[str, Any] | None:
        return next((item for item in self.read() if item.get("id") == directive_id), None)

    def pending(self) -> list[dict[str, Any]]:
        return self._by_priority(item for item in self.read() if item.get("status") == "pending")

    def consumed(self) -> list[dict[str, Any]]:
        return self._by_priority(item for item in self.read() if item.get("status") == "consumed")

    @staticmethod
    def _by_priority(directives: Any) -> list[dict[str, Any]]:
        """Return higher-priority programs first, retaining creation order for ties."""
        return sorted(directives, key=lambda item: int(item.get("priority", 0)), reverse=True)

    def add(self, text: str, personas: list[str] | None = None,
            directive_id: str | None = None) -> dict[str, Any]:
        text = " ".join(text.split()).strip()
        if not text:
            raise ValueError("manager directive cannot be empty")
        if len(text) > 4000:
            raise ValueError("manager directive cannot exceed 4,000 characters")
        scope = [str(name).strip() for name in (personas or []) if str(name).strip()]
        unknown = [name for name in scope if name not in PERSONAS]
        if unknown:
            raise ValueError(f"unknown persona(s): {', '.join(sorted(unknown))}")
        directives = self.read()
        created_at = utc_now().isoformat()
        value = {"id": directive_id or unique_directive_id(text, created_at, directives),
                 "status": "pending", "text": text, "created_at": created_at}
        if scope:
            value["personas"] = scope
        if any(item.get("id") == value["id"] for item in directives):
            raise ValueError(f"directive id already exists: {value['id']}")
        directives.append(value)
        self._write(directives)
        return value

    def replace(self, value: dict[str, Any]) -> dict[str, Any]:
        directives = self.read()
        for index, item in enumerate(directives):
            if item.get("id") == value.get("id"):
                directives[index] = value
                self._write(directives)
                return value
        raise RuntimeError(f"no directive to update: {value.get('id')}")

    def clear(self, directive_id: str | None = None) -> int:
        directives = self.read()
        keep = [item for item in directives if directive_id and item.get("id") != directive_id]
        self._write(keep)
        return len(directives) - len(keep)


def slug_for_directive(text: str, created_at: str) -> str:
    """A short, stable, human-recognizable id drawn from the directive's own words."""
    words = [word for word in re.findall(r"[a-z0-9]+", text.lower()) if len(word) > 3][:3]
    stem = "-".join(words) or "directive"
    return f"{stem}-{hashlib.sha256(f'{text}:{created_at}'.encode()).hexdigest()[:6]}"


def unique_directive_id(text: str, created_at: str, existing: list[dict[str, Any]]) -> str:
    taken = {item.get("id") for item in existing}
    candidate = slug_for_directive(text, created_at)
    suffix = 2
    while candidate in taken:
        candidate = f"{slug_for_directive(text, created_at)}-{suffix}"
        suffix += 1
    return candidate


class DirectiveStore:
    """One directive inside the book, with the record-keeping a program needs.

    Bound to a single id so the planning, issue-creation, and consultation paths can
    keep writing to "their" directive without knowing the book exists.
    """

    def __init__(self, directive_id: str | None = None, book: DirectiveBook | None = None):
        self.book = book or DirectiveBook()
        self.directive_id = directive_id

    def _entry(self) -> dict[str, Any] | None:
        if self.directive_id is None:
            pending = self.book.pending()
            return pending[0] if pending else None
        return self.book.get(self.directive_id)

    def read(self) -> dict[str, Any] | None:
        value = self._entry()
        return value if value and value.get("status") == "pending" else None

    def read_any(self) -> dict[str, Any] | None:
        return self._entry()

    def read_migrated(self) -> dict[str, Any] | None:
        return self._entry()

    def consume(self, issue: int) -> None:
        value = self.read()
        if not value:
            return
        value.update({"status": "consumed", "issue": issue, "consumed_at": utc_now().isoformat()})
        self.book.replace(value)

    def _write(self, value: dict[str, Any]) -> None:
        self.book.replace(value)

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
        self._write(value)
        return value

    def record_created_issue(self, index: int, issue: int) -> dict[str, Any]:
        value = self.read()
        if not value:
            raise RuntimeError("no pending directive")
        created = list(value.get("created_issues", []))
        created.append({"index": index, "issue": issue})
        value["created_issues"] = created
        self._write(value)
        return value

    def clear(self) -> None:
        self.book.clear(self.directive_id)


def summarize_directive(value: dict[str, Any] | None) -> dict[str, Any] | None:
    """Owner-facing view of the directive's evolution across consultation rounds."""
    if not value:
        return None
    summary = {
        "id": value.get("id"),
        "status": value.get("status"),
        "personas": value.get("personas", "all"),
        "text": value.get("text"),
        "created_at": value.get("created_at"),
        "issues": [int(item["issue"]) for item in value.get("created_issues", [])],
    }
    rounds = []
    for index, consultation in enumerate(value.get("consultations", []), start=1):
        rounds.append({
            "round": index,
            "worker": consultation.get("worker"),
            "created_at": consultation.get("created_at"),
            "idea": consultation.get("idea"),
            "issues": [int(item["issue"]) for item in consultation.get("created_issues", [])],
        })
    if rounds:
        summary["consultations"] = rounds
    return summary


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


@contextmanager
def try_lock(path: pathlib.Path):
    """Yield True while holding an exclusive advisory lock, or False if already held."""
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open("a+", encoding="utf-8") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
            return
        try:
            yield True
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _github_call(path: str, token: str, method: str, data: dict | None) -> Any:
    request = urllib.request.Request(
        "https://api.github.com" + path,
        data=json.dumps(data).encode() if data is not None else None,
        method=method,
        headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "wawalu-autonomous-team"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response) if response.length != 0 else None


def github(path: str, token: str, method: str = "GET", data: dict | None = None) -> Any:
    """Call the GitHub API, re-minting the token once if the run outlived its hour."""
    token = current_token(token)
    try:
        return _github_call(path, token, method, data)
    except urllib.error.HTTPError as error:
        if error.code != 401:
            raise
        return _github_call(path, refresh_token(token), method, data)


def issue_label(issue: dict[str, Any], prefix: str) -> str | None:
    for label in issue.get("labels", []):
        name = label.get("name", "") if isinstance(label, dict) else str(label)
        if name.startswith(prefix):
            return name.removeprefix(prefix)
    return None


def run_persona(issue: dict[str, Any]) -> str:
    """The engineer who will actually run this issue, after the unknown-label fallback.

    Pickup and execution have to agree on the name, or the registry would reserve a
    persona nobody is running and leave the real one free to be picked twice.
    """
    persona = issue_label(issue, "persona:") or "staff"
    return persona if persona in PERSONAS else "staff"


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


def delivered_work_context(token: str) -> list[str]:
    """Titles of work already shipped, so a new program never re-proposes finished work.

    A consultation round fires only once the previous program is fully merged, which means
    the owner directive it still carries describes work that is already live. Without this
    list the planner happily re-decomposes that stale directive into duplicates of its own
    merged pull requests.
    """
    delivered: list[str] = []
    query = urllib.parse.urlencode({"state": "closed", "sort": "updated", "direction": "desc",
                                    "per_page": 50})
    try:
        for item in github(f"/repos/{REPOSITORY}/issues?{query}", token):
            if not isinstance(item, dict):
                continue
            title = str(item.get("title", "")).strip()
            if title and title not in delivered:
                delivered.append(title)
    except Exception:
        return delivered
    return delivered


def persona_load_line(token: str, personas: list[str] | None = None) -> str:
    """Deterministic per-engineer load signal for the manager's assignment prompt.

    Small Qwen models balance poorly from raw titles, so we feed the conclusion:
    the count of open (unclosed) issues each engineer already carries. The count
    spans every directive, because an engineer's real load is what they carry
    across all of them — but only engineers this directive may use are listed,
    so the prompt never advertises someone the plan is not allowed to assign.
    """
    query = urllib.parse.urlencode({"state": "open", "per_page": 100})
    counts = {persona: 0 for persona in PERSONA_NAMES}
    try:
        for item in github(f"/repos/{REPOSITORY}/issues?{query}", token):
            if not isinstance(item, dict) or "pull_request" in item:
                continue
            persona = issue_label(item, "persona:")
            if persona in counts:
                counts[persona] += 1
    except Exception:
        return ""  # a balance hint is advisory; never let it break generation
    eligible = [p for p in ASSIGNABLE_PERSONAS if not personas or p in personas] or list(ASSIGNABLE_PERSONAS)
    parts = ", ".join(f"{PERSONA_NAMES[p]} ({p}) {counts[p]}" for p in eligible)
    return ("\nOpen task load per engineer right now (assign new work to those carrying "
            f"the fewest, given fit): {parts}.\n")


def comment(token: str, number: int, state: str, detail: str) -> None:
    body = f"<!-- wawalu-agent-state -->\n**Synthetic team · {state}**\n\n{detail}"
    github(f"/repos/{REPOSITORY}/issues/{number}/comments", token, "POST", {"body": body})


def interaction_comment(token: str, number: int, marker: str, heading: str, detail: str) -> None:
    body = f"<!-- {marker} -->\n**{heading}**\n\n{detail}"
    github(f"/repos/{REPOSITORY}/issues/{number}/comments", token, "POST", {"body": body})


def issue_delay_seconds(issue: dict[str, Any]) -> int:
    """Stable 1–6 minute wait between visible assignment and implementation.

    Kept short so the demo team iterates visibly; it only staggers pickup so
    every issue does not start on the same tick, not a realistic workday gap.
    """
    digest = hashlib.sha256(str(issue.get("number", "")).encode()).digest()
    return (1 + (int.from_bytes(digest[:2], "big") % 6)) * 60


def within_persona_window(persona: str, config: dict[str, Any], now: dt.datetime) -> bool:
    if not config.get("workday_rhythm", False):
        return True
    windows = config.get("persona_work_windows", {
        "infrastructure": [8, 13], "backend": [9, 14],
        "frontend": [10, 15], "staff": [11, 16],
        "product": [8, 13], "design": [10, 15],
        "evaluation": [9, 14], "integrations": [11, 16],
        "copywriter": [9, 18], "graphics": [9, 18], "fullstack": [10, 19],
        "qa": [8, 17], "security": [11, 20], "platform": [8, 17],
    })
    start, end = windows.get(persona, [8, 18])
    return int(start) <= now.astimezone(PACIFIC).hour < int(end)


def post_daily_standup(token: str, state: State, issues: list[dict[str, Any]], journal: Journal,
                       now: dt.datetime) -> None:
    day = now.astimezone(PACIFIC).date().isoformat()
    if state.value["standups"].get(day) or not issues:
        return
    active = []
    for issue in issues[:6]:
        persona = issue_label(issue, "persona:") or "staff"
        active.append(f"{PERSONA_NAMES.get(persona, persona)}: #{issue['number']} {issue.get('title', '')}")
    detail = ("Today’s focus:\n" + "\n".join(f"- {item}" for item in active) +
              "\n\nRhythm: planning in the morning, implementation through midday, then reviews and handoffs later in the day.")
    interaction_comment(token, int(issues[0]["number"]), "wawalu-standup", "Sam · daily standup", detail)
    with state.mutate():
        state.value["standups"][day] = int(issues[0]["number"])
    journal.emit("daily_standup_posted", issue=int(issues[0]["number"]), day=day)


def post_dependency_handoffs(token: str, state: State, issues: list[dict[str, Any]],
                             journal: Journal, now: dt.datetime) -> None:
    if not now.astimezone(PACIFIC).hour >= 14:
        return
    for issue in issues:
        match = re.search(r"Depends on #(\d+)", str(issue.get("body") or ""))
        if not match or state.value["handoffs"].get(str(issue["number"])):
            continue
        dependency = github(f"/repos/{REPOSITORY}/issues/{match.group(1)}", token)
        if dependency.get("state") != "closed":
            continue
        persona = issue_label(dependency, "persona:") or "staff"
        name = PERSONA_NAMES.get(persona, persona)
        outcome = re.search(r"## Outcome\s*\n+(.+?)(?:\n#|\Z)", str(dependency.get("body") or ""), re.S)
        changed = " ".join((outcome.group(1) if outcome else dependency.get("title", "completed work")).split())[:500]
        detail = (f"Changed: #{dependency['number']} is complete — {changed}\n\n"
                  f"Contract: use the accepted behavior and criteria on #{dependency['number']}.\n\n"
                  "Validation: protected CI and review completed before merge.\n\n"
                  "Known limitation: none recorded; raise a focused follow-up if the integration exposes one.")
        interaction_comment(token, int(issue["number"]), "wawalu-handoff", f"{name} · handoff", detail)
        with state.mutate():
            state.value["handoffs"][str(issue["number"])] = int(dependency["number"])
        journal.emit("dependency_handoff_posted", issue=int(issue["number"]), dependency=int(dependency["number"]), persona=persona)


def ensure_labels(token: str, ready_label: str) -> None:
    labels = {
        ready_label: ("2f81f7", "Queued for the autonomous synthetic team"),
        "agent-running": ("d4a72c", "A synthetic worker is executing this issue"),
        "agent-blocked": ("d73a4a", "Autonomous execution needs attention"),
        "persona:backend": ("6f42c1", "Assigned to Rowan"),
        "persona:frontend": ("9b59b6", "Assigned to Mina"),
        "persona:infrastructure": ("596b31", "Assigned to Ellis"),
        "persona:staff": ("245a8d", "Assigned to Priya"),
        "persona:product": ("0f7b6c", "Assigned to Noor"),
        "persona:design": ("b5427a", "Assigned to Iris"),
        "persona:evaluation": ("7d5a1f", "Assigned to Theo"),
        "persona:integrations": ("34618a", "Assigned to Anya"),
        "persona:copywriter": ("8a6d3b", "Assigned to Jude"),
        "persona:graphics": ("b45309", "Assigned to Kai"),
        "persona:fullstack": ("0e7490", "Assigned to Remy"),
        "persona:qa": ("15803d", "Assigned to Tess"),
        "persona:security": ("b91c1c", "Assigned to Vera"),
        "persona:platform": ("4d7c0f", "Assigned to Omar"),
    }
    existing = {item["name"] for item in github(f"/repos/{REPOSITORY}/labels?per_page=100", token)}
    for name, (color, description) in labels.items():
        if name not in existing:
            github(f"/repos/{REPOSITORY}/labels", token, "POST",
                   {"name": name, "color": color, "description": description})


def create_generated_issue(token: str, proposal: dict[str, Any], ready_label: str,
                           depends_on: int | None = None,
                           directive_id: str | None = None) -> dict[str, Any]:
    criteria = "\n".join(f"- [ ] {item}" for item in proposal["acceptance_criteria"])
    dependency = f"\n\n## Dependency\n\nDepends on #{depends_on}." if depends_on else ""
    # With several directives in flight the issue must say which product line it
    # belongs to; otherwise a queue of mixed work is unreadable to a human and the
    # observatory cannot tell two programs apart.
    program = f"\n\n## Program\n\nDirective `{directive_id}`." if directive_id else ""
    body = (f"Generated by Sam, the synthetic engineering manager, from `PRODUCT.md`.\n\n"
            f"## Outcome\n\n{proposal['outcome']}\n\n## Acceptance criteria\n\n{criteria}\n\n"
            f"This is a bounded demo-team task. Normal review and production controls apply."
            f"{program}{dependency}")
    labels = [ready_label, f"persona:{proposal['persona']}"]
    if directive_id:
        labels.append(f"directive:{directive_id}")
    return github(f"/repos/{REPOSITORY}/issues", token, "POST", {
        "title": proposal["title"], "body": body, "labels": labels})


def label_names(issue: dict[str, Any]) -> list[str]:
    return [item.get("name", "") if isinstance(item, dict) else str(item)
            for item in issue.get("labels", [])]


def replace_state_label(token: str, issue: dict[str, Any], ready_label: str,
                        add: str | None, keep_ready: bool) -> None:
    # Re-read the labels instead of trusting the snapshot taken when the run started:
    # a run lasts many minutes, and writing back a stale set silently reverts whatever
    # the owner changed meanwhile — including a PAUSED_LABEL parking an issue.
    try:
        current = github(f"/repos/{REPOSITORY}/issues/{issue['number']}", token)
    except Exception:  # noqa: BLE001 - a failed re-read must not lose the state label
        current = issue
    labels = label_names(current if isinstance(current, dict) and current.get("labels") is not None else issue)
    labels = [label for label in labels if label not in {"agent-running", "agent-blocked"}]
    # A paused issue never returns to the queue on its own; only the owner lifts the pause.
    if not keep_ready or PAUSED_LABEL in labels:
        labels = [label for label in labels if label != ready_label]
    if add and add not in labels and not (PAUSED_LABEL in labels and add == ready_label):
        labels.append(add)
    github(f"/repos/{REPOSITORY}/issues/{issue['number']}", token, "PATCH", {"labels": labels})


def generate_work(token: str, config: dict[str, Any], journal: Journal) -> dict[str, Any]:
    run_dir = AUTONOMY / "manager" / utc_now().strftime("%Y%m%dT%H%M%SZ")
    run_dir.mkdir(parents=True, exist_ok=False)
    manager = (ROOT / "personas" / "manager.md").read_text(encoding="utf-8")
    proposal = propose_task(manager, (PRODUCT_ROOT / "PRODUCT.md").read_text(encoding="utf-8"),
                            recent_issue_context(token), run_dir / "qwen-task.json",
                            utilization=persona_load_line(token))
    issue = create_generated_issue(token, proposal, config["issue_label"])
    journal.emit("task_generated", issue=issue["number"], persona=proposal["persona"], title=proposal["title"])
    return issue


def task_persona(task: dict[str, Any]) -> str:
    """Owner of a generated task; backlogs chain per persona, never as one queue.

    A single chain across the whole backlog leaves exactly one workable issue, so
    the team stalls for hours whenever that issue belongs to a persona whose work
    window is closed. Chaining within a persona keeps each track ordered while
    every other persona still has a head it can pick up.
    """
    return str(task.get("persona") or "staff")


def generate_directive_backlog(token: str, config: dict[str, Any], journal: Journal,
                               directive: dict[str, Any]) -> list[dict[str, Any]]:
    store = DirectiveStore(directive.get("id"))
    run_dir = AUTONOMY / "manager" / (utc_now().strftime("%Y%m%dT%H%M%SZ") + "-directive")
    run_dir.mkdir(parents=True, exist_ok=False)
    tasks = directive.get("plan")
    if not isinstance(tasks, list):
        tasks = propose_directive_plan(
            (ROOT / "personas" / "manager.md").read_text(encoding="utf-8"),
            (PRODUCT_ROOT / "PRODUCT.md").read_text(encoding="utf-8"), recent_issue_context(token),
            directive["text"], run_dir / "qwen-directive-plan.json",
            utilization=persona_load_line(token, directive.get("personas")),
            personas=directive.get("personas"))
        directive = store.save_plan(tasks)
    created = {int(item["index"]): int(item["issue"]) for item in directive.get("created_issues", [])}
    issues = []
    previous: dict[str, int] = {}
    for index, task in enumerate(tasks):
        persona = task_persona(task)
        if index in created:
            issue = github(f"/repos/{REPOSITORY}/issues/{created[index]}", token)
            previous[persona] = int(issue["number"])
            issues.append(issue)
            continue
        issue = create_generated_issue(token, task, config["issue_label"], previous.get(persona),
                                       directive_id=directive.get("id"))
        store.record_created_issue(index, issue["number"])
        previous[persona] = int(issue["number"])
        issues.append(issue)
        journal.emit("directive_task_generated", issue=issue["number"], order=index + 1,
                     persona=task["persona"], title=task["title"])
    store.consume(issues[0]["number"])
    journal.emit("directive_backlog_created", issues=[item["number"] for item in issues],
                 directive=directive.get("id"),
                 directive_sha256=hashlib.sha256(directive["text"].encode()).hexdigest())
    return issues


def consultation_complete(consultation: dict[str, Any]) -> bool:
    plan = consultation.get("plan")
    return isinstance(plan, list) and len(consultation.get("created_issues", [])) >= len(plan)


def program_task_pending(issue: dict[str, Any]) -> bool:
    """True while a program task still owes work the next consultation should wait for.

    A blocked task never closes on its own, so holding the next round behind it
    freezes product direction until a human intervenes — and the team meanwhile
    falls back to idle filler work. It already carries the label that asks for
    attention, so let the program move on without it.
    """
    if issue.get("state") == "closed":
        return False
    return not any((label.get("name", "") if isinstance(label, dict) else str(label)) == "agent-blocked"
                   for label in issue.get("labels", []))


def consult_every_directive(token: str, config: dict[str, Any], journal: Journal,
                            worker: str = "auto", state: "State | None" = None,
                            ) -> list[dict[str, Any]] | None:
    """Advance the first directive whose current program has finished.

    Each directive keeps its own consultation lineage, so a finished FinOps program
    asks for the next FinOps idea while an unfinished one waits — one consultation
    per tick, because each is a paid worker run.
    """
    for directive in DirectiveBook().consumed():
        issues = consult_after_directive_mvp(token, config, journal, worker, state, directive)
        if issues:
            return issues
    return None


def consult_after_directive_mvp(token: str, config: dict[str, Any], journal: Journal,
                                worker: str = "auto", state: "State | None" = None,
                                directive: dict[str, Any] | None = None,
                                ) -> list[dict[str, Any]] | None:
    book = DirectiveBook()
    directive = directive or next(iter(book.consumed()), None)
    store = DirectiveStore(directive.get("id") if directive else None, book)
    if not directive or directive.get("status") != "consumed" or not directive.get("created_issues"):
        return None
    rounds = list(directive.get("consultations", []))
    current = rounds[-1] if rounds else None
    if current is None or consultation_complete(current):
        latest = current.get("created_issues", []) if current else directive["created_issues"]
        for reference in latest:
            issue = github(f"/repos/{REPOSITORY}/issues/{int(reference['issue'])}", token)
            if program_task_pending(issue):
                return None
        max_rounds = int(config.get("max_consultation_rounds", 0))
        if max_rounds and len(rounds) >= max_rounds:
            return None
        if worker == "auto":
            digest = hashlib.sha256(f"{directive['text']}:{len(rounds)}".encode()).hexdigest()
            worker = "codex" if int(digest, 16) % 2 == 0 else "claude"
        if worker not in {"codex", "claude"}:
            raise ValueError("consultation worker must be auto, codex, or claude")
        routed = worker if state is None else resolve_worker(worker, state)
        if routed is None:
            journal.emit("consultation_capacity_deferred", worker=worker, round=len(rounds) + 1)
            return None
        current = store.begin_consultation(routed)
        rounds.append(current)
    round_number = len(rounds)
    worker = current["worker"]
    run_dir = AUTONOMY / "manager" / (utc_now().strftime("%Y%m%dT%H%M%SZ") + "-consultation")
    run_dir.mkdir(parents=True, exist_ok=True)
    idea = current.get("idea")
    if not idea:
        personas, runtime = load_personas(), load_runtime_env()
        attempted: set[str] = set()
        while True:
            try:
                idea = consult_next_steps(
                    worker, directive["text"], (PRODUCT_ROOT / "PRODUCT.md").read_text(encoding="utf-8"),
                    PRODUCT_ROOT, run_dir, personas["manager"]["wawalu_token"],
                    runtime["WAWALU_INGEST_ENDPOINT"].rstrip("/"),
                    runtime.get("WAWALU_PRODUCT_SITE_URL", ""))
                break
            except ConsultantCapacityExhausted:
                attempted.add(worker)
                if state is not None:
                    # Same clamp the run path applies: a consultation refusal states its own
                    # reset time, and a blind exponential hold that outlives it locks the
                    # provider out of BOTH consultations and runs long after it recovered.
                    state.record_worker_capacity(
                        worker, int(config.get("capacity_retry_seconds", 900)),
                        maximum_seconds=int(config.get("capacity_retry_max_seconds", 18000)),
                        reset_at=capacity_reset_at(sorted(run_dir.glob("*.jsonl"))))
                other = "claude" if worker == "codex" else "codex"
                if other in attempted or (state is not None and not state.worker_available(other)):
                    journal.emit("consultation_capacity_deferred", worker=worker, round=round_number)
                    return None
                current = store.update_consultation(worker=other, consult_attempts=0)
                journal.emit("consultation_worker_switched", worker=other, after_failures=0,
                             reason="capacity")
                worker = other
            except Exception:
                attempts = int(current.get("consult_attempts", 0)) + 1
                if attempts >= 2:
                    other = "claude" if worker == "codex" else "codex"
                    store.update_consultation(worker=other, consult_attempts=0)
                    journal.emit("consultation_worker_switched", worker=other, after_failures=attempts)
                else:
                    store.update_consultation(consult_attempts=attempts)
                raise
        current = store.update_consultation(idea=idea)
    tasks = current.get("plan")
    if not isinstance(tasks, list):
        tasks = propose_directive_plan(
            (ROOT / "personas" / "manager.md").read_text(encoding="utf-8"),
            (PRODUCT_ROOT / "PRODUCT.md").read_text(encoding="utf-8"), recent_issue_context(token),
            directive["text"], run_dir / "qwen-followup-plan.json", advisory=idea,
            utilization=persona_load_line(token, directive.get("personas")),
            delivered=delivered_work_context(token), personas=directive.get("personas"))
        current = store.update_consultation(plan=tasks)
    created = {int(item["index"]): int(item["issue"]) for item in current.get("created_issues", [])}
    issues = []
    previous: dict[str, int] = {}
    for index, task in enumerate(tasks):
        persona = task_persona(task)
        if index in created:
            issue = github(f"/repos/{REPOSITORY}/issues/{created[index]}", token)
            previous[persona] = int(issue["number"])
            issues.append(issue)
            continue
        issue = create_generated_issue(token, task, config["issue_label"], previous.get(persona),
                                       directive_id=directive.get("id"))
        store.record_consultation_issue(index, issue["number"])
        previous[persona] = int(issue["number"])
        issues.append(issue)
        journal.emit("directive_followup_task_generated", issue=issue["number"], order=index + 1,
                     round=round_number, persona=task["persona"], title=task["title"])
    journal.emit("directive_followup_consulted", worker=worker, round=round_number,
                 issues=[item["number"] for item in issues], directive=directive.get("id"),
                 directive_sha256=hashlib.sha256(directive["text"].encode()).hexdigest())
    return issues


def _pull_diff_call(number: int, token: str) -> str:
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPOSITORY}/pulls/{number}",
        headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github.v3.diff",
                 "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "wawalu-autonomous-team"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", "replace")


def fetch_pull_diff(number: int, token: str) -> str:
    token = current_token(token)
    try:
        return _pull_diff_call(number, token)
    except urllib.error.HTTPError as error:
        if error.code != 401:
            raise
        return _pull_diff_call(number, refresh_token(token))


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


def requeue_conflicted_pull(pull: dict[str, Any], token: str, config: dict[str, Any],
                            state: State, journal: Journal) -> bool:
    """Close a conflicted agent pull request and return its issue to the queue.

    A conflict here is a merge race, not a failed implementation: the run got a
    worker through the gates and past the reviewer, and only lost because other
    work reached ``main`` first. Charging that to the implementation attempt
    budget threw away finished, approved work — an issue whose earlier attempts
    failed for unrelated reasons arrived at its last attempt, succeeded, and was
    still marked ``agent-blocked`` because the counter was already spent.

    So the conflict path keeps its own small budget. Reaching an approved pull
    request clears the stale failure count (the issue has proven it is workable
    on current ``main``), while ``max_conflict_requeues`` still stops an issue
    that genuinely cannot land from recycling forever.
    """
    branch = str(pull["head"]["ref"])
    match = (re.match(r"agent/[^/]+/issue-(\d+)-", branch)
             or re.search(r"Closes #(\d+)", str(pull.get("body") or "")))
    if not branch.startswith("agent/") or not match:
        return False
    issue_number = int(match.group(1))
    issue = github(f"/repos/{REPOSITORY}/issues/{issue_number}", token)
    if issue.get("state") != "open":
        return False
    pull_number = int(pull["number"])
    github(f"/repos/{REPOSITORY}/pulls/{pull_number}", token, "PATCH", {"state": "closed"})
    try:
        github(f"/repos/{REPOSITORY}/git/refs/heads/{urllib.parse.quote(branch)}", token, "DELETE")
    except urllib.error.HTTPError:
        pass
    ready = config["issue_label"]
    with state.mutate():
        record = state.value["issues"].setdefault(str(issue_number), {})
        record.pop("retry_at", None)
        conflicts = int(record.get("conflict_requeues", 0)) + 1
        exhausted = conflicts > int(config.get("max_conflict_requeues", 2))
        record["conflict_requeues"] = conflicts
        record.update({"status": "blocked", "blocked_at": utc_now().isoformat()} if exhausted else
                      {"status": "requeued", "requeued_at": utc_now().isoformat(), "attempts": 0})
    if exhausted:
        replace_state_label(token, issue, ready, "agent-blocked", keep_ready=False)
        comment(token, issue_number, "blocked",
                f"Pull request #{pull_number} conflicted with `main` and this issue has already "
                "used its conflict-retry budget. It needs human attention.")
        journal.emit("pr_conflict_blocked", pull=pull_number, issue=issue_number, branch=branch)
        return True
    replace_state_label(token, issue, ready, ready, keep_ready=True)
    comment(token, issue_number, "requeued",
            f"Pull request #{pull_number} conflicted with `main` after other work merged, so it "
            "was closed. This issue returns to the queue for a fresh implementation on current `main`.")
    journal.emit("pr_conflict_requeued", pull=pull_number, issue=issue_number, branch=branch)
    return True


def deliver_approved_pull(pull: dict[str, Any], token: str, state: State,
                          journal: Journal) -> None:
    """Ask GitHub to merge a reviewer-approved team pull the worker forgot to deliver.

    Auto-merge is normally requested by the worker through the branch-bound
    ``.agent-delivery.json`` capability. A worker that finishes its change but
    omits that request leaves an approved, green pull request open forever:
    nothing else in the loop merges it, the issue keeps its ``agent-running``
    label, and the queue stalls behind finished work. The reviewer approval on
    the exact head is still the gate, and ``--auto`` keeps required checks in
    charge of delivery, so this only restores the intended ending.
    """
    number = int(pull["number"])
    head_sha = pull["head"]["sha"]
    with state.mutate():
        record = state.value["pr_deliveries"].get(str(number), {})
        attempts = int(record.get("attempts", 0)) if record.get("sha") == head_sha else 0
        if attempts < DELIVERY_ATTEMPT_LIMIT:
            state.value["pr_deliveries"][str(number)] = {
                "sha": head_sha, "attempts": attempts + 1, "at": utc_now().isoformat()}
    if attempts >= DELIVERY_ATTEMPT_LIMIT:
        return
    try:
        enable_auto_merge(REPOSITORY, str(pull["head"]["ref"]), token, ROOT)
    except Exception as error:
        journal.emit("team_pr_auto_merge_failed", pull=number, sha=head_sha,
                     attempts=attempts + 1, error=type(error).__name__, detail=str(error)[:300])
        return
    journal.emit("team_pr_auto_merge_enabled", pull=number, sha=head_sha)


def update_pull_branch(pull: dict[str, Any], token: str, config: dict[str, Any],
                       state: State, journal: Journal) -> None:
    """Unstick an approved, auto-merging pull request whose branch fell behind main."""
    number = int(pull["number"])
    head_sha = pull["head"]["sha"]
    record = state.value["pr_updates"].get(str(number), {})
    if record.get("sha") == head_sha:
        return
    detail = github(f"/repos/{REPOSITORY}/pulls/{number}", token)
    mergeable_state = str(detail.get("mergeable_state") or "unknown")
    if mergeable_state == "dirty":
        with state.mutate():
            state.value["pr_updates"][str(number)] = {
                "sha": head_sha, "result": "conflict", "at": utc_now().isoformat()}
        journal.emit("pr_update_conflict", pull=number, sha=head_sha)
        if config.get("requeue_conflicted_prs", True) and \
                requeue_conflicted_pull(pull, token, config, state, journal):
            return
        comment(token, number, "merge conflict",
                f"This pull request conflicts with `main` at `{head_sha[:10]}` and cannot be "
                "updated automatically. It needs a manual rebase or a fresh implementation.")
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
    with state.mutate():
        state.value["pr_updates"][str(number)] = {
            "sha": head_sha, "result": "updated", "at": utc_now().isoformat()}
    journal.emit("pr_branch_updated", pull=number, sha=head_sha)


def review_outstanding_prs(token: str, config: dict[str, Any], state: State,
                           journal: Journal) -> list[int]:
    """Marcus reviews open PRs from the owner, or team-approved PRs whose head moved."""
    with try_lock(AUTONOMY / "sweep.lock") as owned:
        if not owned:
            journal.emit("pr_sweep_skipped", reason="another sweep is running")
            return []
        return _review_outstanding_prs(token, config, state, journal)


def _review_outstanding_prs(token: str, config: dict[str, Any], state: State,
                            journal: Journal) -> list[int]:
    approved = []
    pulls = github(f"/repos/{REPOSITORY}/pulls?state=open&per_page=50", token)
    open_numbers = {str(int(pull["number"])) for pull in pulls or []}
    with state.mutate():
        for bucket in ("pr_reviews", "pr_updates", "pr_deliveries"):
            for key in [key for key in state.value[bucket] if key not in open_numbers]:
                state.value[bucket].pop(key)
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
        is_team_pull = str(pull.get("head", {}).get("ref", "")).startswith("agent/")
        if author != OWNER and not is_team_pull and not team_approved_before:
            continue
        if approved_current_head(reviews, head_sha):
            if pull.get("auto_merge"):
                if config.get("update_stuck_prs", True):
                    update_pull_branch(pull, token, config, state, journal)
            elif is_team_pull and config.get("deliver_approved_team_prs", True):
                deliver_approved_pull(pull, token, state, journal)
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
        with state.mutate():
            state.value["pr_reviews"][str(number)] = {
                "sha": head_sha, "approved": verdict["approved"], "at": utc_now().isoformat()}
        if verdict["approved"]:
            approved.append(number)
    return approved


def sweep_outstanding_prs(token: str, config: dict[str, Any], state: State,
                          journal: Journal) -> None:
    """Run the PR sweep without letting its failure abort the rest of the tick."""
    try:
        review_outstanding_prs(token, config, state, journal)
    except Exception as error:
        journal.emit("pr_sweep_error", error=type(error).__name__, detail=str(error)[:300])


def scenario_from_issue(issue: dict[str, Any], persona: str) -> dict[str, Any]:
    title = str(issue.get("title", "")).strip()
    body = str(issue.get("body") or "").strip()
    return {"id": f"issue-{issue['number']}-{title}", "issue": issue["number"], "title": title,
            "outcome": body[:12000] or title,
            "acceptance_criteria": ["The issue outcome is implemented", "Relevant automated tests pass",
                                    "The production build succeeds"], "assigned_persona": persona}


def choose_issue(issues: list[dict[str, Any]], state: State, config: dict[str, Any],
                 now: dt.datetime, active: dict[int, str] | None = None) -> dict[str, Any] | None:
    cooldown = int(config["retry_cooldown_seconds"])
    max_attempts = int(config["max_attempts"])
    open_numbers = {int(issue["number"]) for issue in issues}
    active = active or {}
    busy_personas = set(active.values())
    for issue in issues:
        if int(issue["number"]) in active or run_persona(issue) in busy_personas:
            continue
        if PAUSED_LABEL in label_names(issue):
            continue
        dependency = __import__("re").search(r"Depends on #(\d+)", str(issue.get("body") or ""))
        if dependency and int(dependency.group(1)) in open_numbers:
            continue
        persona = issue_label(issue, "persona:") or "staff"
        if not within_persona_window(persona, config, now):
            continue
        if config.get("workday_rhythm", False):
            try:
                assigned_at = dt.datetime.fromisoformat(str(issue.get("created_at") or "").replace("Z", "+00:00"))
            except ValueError:
                assigned_at = now
            if now < assigned_at + dt.timedelta(seconds=issue_delay_seconds(issue)):
                continue
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
    branch = subprocess.check_output(["git", "branch", "--show-current"], cwd=PRODUCT_ROOT, text=True).strip()
    if branch != "main":
        raise RuntimeError(f"autonomous checkout must be on main, found {branch!r}")
    with checkout_lock():
        subprocess.run(["git", "fetch", "origin", "main", "--prune"], cwd=PRODUCT_ROOT, check=True)
        subprocess.run(["git", "merge", "--ff-only", "origin/main"], cwd=PRODUCT_ROOT, check=True)


def cleanup_worktree(path: pathlib.Path, branch: str, journal: Journal) -> None:
    """Retire one run's worktree and branch, serialized against every other run's.

    Runs work inside their own worktree, but adding, pruning, and removing one all
    write the single shared `.git` directory, as does the tick thread's fast-forward
    of main. Two of those at once race on worktree metadata and ref locks, so all of
    them take the same checkout lock.
    """
    with checkout_lock():
        subprocess.run(["git", "worktree", "prune"], cwd=PRODUCT_ROOT, check=True)
        if path.is_dir():
            subprocess.run(["git", "worktree", "remove", "--force", str(path)], cwd=PRODUCT_ROOT, check=False)
            if not path.exists():
                journal.emit("worktree_cleaned", path=path.name)
        deleted = subprocess.run(["git", "branch", "--delete", "--force", branch], cwd=PRODUCT_ROOT,
                                 text=True, capture_output=True)
    if deleted.returncode == 0:
        journal.emit("local_branch_cleaned", branch=branch)


def run_worker_process(command: list[str], timeout_seconds: int, journal: Journal,
                       issue: int) -> int:
    """Run one orchestrator in its own process group so a wedged model cannot stall the week."""
    process = subprocess.Popen(command, cwd=ROOT, start_new_session=True)
    try:
        return process.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        journal.emit("run_timeout", issue=issue, timeout_seconds=timeout_seconds)
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=15)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
        return 124


def resolve_worker(requested: str, state: State, now: dt.datetime | None = None) -> str | None:
    """Route around a provider that recently reported capacity exhaustion.

    With ``auto`` the planning layer picks the worker, so a session-limited
    provider keeps getting re-picked and burns a full plan/worktree cycle
    before failing. Returns None when every provider is cooling down.
    """
    available = sorted(worker for worker in WORKERS if state.worker_available(worker, now))
    if not available:
        return None
    if requested in available:
        return requested
    if requested == "auto" and len(available) == len(WORKERS):
        return "auto"
    return available[0]


def execute_issue(issue: dict[str, Any], config: dict[str, Any], state: State,
                  journal: Journal, token: str) -> int:
    number = int(issue["number"])
    persona = run_persona(issue)
    # One locked section for the whole "this run has started" transition: the attempt
    # count, the daily tally, and the worker choice all read state that a concurrent
    # run may be changing, and a second reader must see this run's attempt.
    with state.mutate():
        record = state.value["issues"].setdefault(str(number), {})
        attempt = int(record.get("attempts", 0)) + 1
        record.update({"status": "running", "persona": persona,
                       "attempts": attempt,
                       "started_at": utc_now().isoformat()})
        state.record_run()
        requested_worker = resolve_worker(
            record.get("worker_override", config["default_worker"]), state) or config["default_worker"]
    scenario_dir = AUTONOMY / "scenarios"
    scenario_dir.mkdir(parents=True, exist_ok=True)
    scenario_path = scenario_dir / f"issue-{number}-{uuid.uuid4().hex[:6]}.json"
    scenario = scenario_from_issue(issue, persona)
    scenario["attempt"] = attempt
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
               str(scenario_path.relative_to(ROOT)), "--push", "--worker", requested_worker]
    exit_code = run_worker_process(
        command, int(config.get("worker_timeout_seconds", 10800)), journal, number)
    scenario_path.unlink(missing_ok=True)
    try:
        record_run_outcome(exit_code, issue, number, persona, scenario, config, state, journal, token)
    finally:
        # Bookkeeping talks to GitHub and can fail; the worktree must go regardless,
        # or the next attempt trips over the debris instead of doing the work.
        cleanup_worktree(worktree, f"agent/{persona}/{scenario_slug}", journal)
    return exit_code


def _bookkeeper(journal: Journal, number: int):
    """Announce a run's outcome to GitHub without letting the network veto the record.

    A DNS blip or a 5xx while commenting used to abort the rest of
    ``record_run_outcome``, so the run's terminal journal event never landed and
    the issue kept a stale ``agent-running`` label. The local state transition is
    the source of truth; the GitHub-facing half is best effort and self-reports.
    """
    def tell(action: str, call) -> None:
        try:
            call()
        except OSError as error:  # URLError and HTTPError both land here
            journal.emit("github_bookkeeping_failed", issue=number, action=action,
                         error=type(error).__name__, detail=str(error))
    return tell


def latest_run_transcripts() -> list[pathlib.Path]:
    """The worker transcripts of the most recent orchestrator run.

    The daemon never learns the run id — the orchestrator mints it in its own
    process — so the newest directory under .agent/runs is the run that just
    finished. Only used to read a capacity refusal's stated reset time, where
    picking the wrong run costs nothing worse than an unchanged cooldown.
    """
    runs = ROOT / ".agent" / "runs"
    try:
        newest = max((path for path in runs.iterdir() if path.is_dir()),
                     key=lambda path: path.stat().st_mtime, default=None)
    except OSError:
        return []
    return sorted(newest.glob("*.jsonl")) if newest else []


def record_run_outcome(exit_code: int, issue: dict[str, Any], number: int, persona: str,
                       scenario: dict[str, Any], config: dict[str, Any], state: State,
                       journal: Journal, token: str) -> None:
    """Record how a finished run went: issue state, labels, and the owner-visible comment.

    Each branch takes the state lock only long enough to write its own transition, and
    re-reads inside it, because this run may have started before other runs that have
    already finished. The GitHub half stays outside the lock: it is slow, it fails, and
    nothing about it should block another run from recording its outcome.
    """
    tell = _bookkeeper(journal, number)
    if exit_code == 0:
        with state.mutate():
            record = state.value["issues"].setdefault(str(number), {})
            record.update({"status": "submitted", "finished_at": utc_now().isoformat()})
            state.record_submission(persona)
            for collaborator in scenario.get("collaborators", []):
                state.record_submission(collaborator)
        journal.emit("run_submitted", issue=number, persona=persona)
        tell("comment", lambda: comment(token, number, "submitted", "The worker completed its run and opened a reviewed pull request. If it requested merge, GitHub will deliver it after required checks."))
        tell("label", lambda: replace_state_label(token, issue, config["issue_label"], "agent-running", keep_ready=False))
    elif exit_code == DIFF_BUDGET_EXIT_CODE:
        # The daily diff rail, not a defect in the work: leave the issue ready and do
        # not consume an implementation attempt, or a spent budget would blockade the
        # whole queue by exhausting max_attempts on every issue it touches.
        with state.mutate():
            record = state.value["issues"].setdefault(str(number), {})
            record.update({"status": "retry", "attempts": max(int(record.get("attempts", 1)) - 1, 0),
                           "retry_at": (utc_now() + dt.timedelta(
                               seconds=int(config.get("retry_cooldown_seconds", 60)))).isoformat()})
        journal.emit("run_diff_budget_deferred", issue=number, persona=persona,
                     approved_diffs_today=BUDGET.count(), limit=BUDGET.limit)
        tell("label", lambda: replace_state_label(token, issue, config["issue_label"], None, keep_ready=True))
    elif exit_code == PROVIDER_OVERLOAD_EXIT_CODE:
        # The provider's own servers fell over mid-run. Like the diff rail, this says
        # nothing about the work, so it must not consume an implementation attempt: with
        # one provider dark, an overload wave would otherwise walk every issue it touched
        # to agent-blocked within max_attempts runs. No worker cooldown either — the
        # outage is transient and switching providers does not help, so retry plainly.
        with state.mutate():
            record = state.value["issues"].setdefault(str(number), {})
            record.update({"status": "retry", "attempts": max(int(record.get("attempts", 1)) - 1, 0),
                           "retry_at": (utc_now() + dt.timedelta(
                               seconds=int(config.get("retry_cooldown_seconds", 60)))).isoformat()})
        journal.emit("run_provider_overload_deferred", issue=number, persona=persona)
        tell("comment", lambda: comment(token, number, "provider overloaded",
             "The provider returned a server-side overload error. This did not consume an "
             "implementation attempt; Sam will retry after the cooldown."))
        tell("label", lambda: replace_state_label(token, issue, config["issue_label"], None, keep_ready=True))
    elif exit_code in CAPACITY_WORKERS:
        exhausted = CAPACITY_WORKERS[exit_code]
        alternate = "claude" if exhausted == "codex" else "codex"
        # The long capacity backoff is for the case where there is nowhere to go: both
        # providers dark. When the alternate is awake, waiting it out is pure dead time
        # — the next attempt already carries worker_override, so it will not re-pick the
        # exhausted provider. Retry on the ordinary cooldown instead. This still burns no
        # attempt and still holds the exhausted provider out via record_worker_capacity.
        alternate_ready = state.worker_available(alternate)
        stated_reset = capacity_reset_at(latest_run_transcripts())
        with state.mutate():
            record = state.value["issues"].setdefault(str(number), {})
            failures = int(record.get("capacity_failures", 0)) + 1
            delay = min(int(config.get("capacity_retry_seconds", 900)) * (2 ** (failures - 1)),
                        int(config.get("capacity_retry_max_seconds", 18000)))
            if alternate_ready:
                delay = min(delay, int(config.get("retry_cooldown_seconds", 300)))
            record.update({"status": "retry", "attempts": int(record.get("attempts", 1)) - 1,
                           "capacity_failures": failures, "worker_override": alternate,
                           "retry_at": (utc_now() + dt.timedelta(seconds=delay)).isoformat()})
            cooldown = state.record_worker_capacity(
                exhausted, int(config.get("capacity_retry_seconds", 900)),
                maximum_seconds=int(config.get("capacity_retry_max_seconds", 18000)),
                reset_at=stated_reset)
        journal.emit("run_capacity_deferred", issue=number, persona=persona, exhausted_worker=exhausted,
                     next_worker=alternate, delay_seconds=delay, worker_cooldown_seconds=cooldown,
                     failures=failures, alternate_ready=alternate_ready,
                     stated_reset=stated_reset.isoformat() if stated_reset else None)
        tell("comment", lambda: comment(token, number, "capacity deferred",
             f"{exhausted.title()} reported temporary account capacity exhaustion. This did not consume "
             f"an implementation attempt; Sam will retry with {alternate.title()} after the backoff."))
        tell("label", lambda: replace_state_label(token, issue, config["issue_label"], None, keep_ready=True))
    else:
        with state.mutate():
            record = state.value["issues"].setdefault(str(number), {})
            attempts = int(record.get("attempts", 1))
            blocked = attempts >= int(config["max_attempts"])
            record["status"] = "blocked" if blocked else "retry"
            if not blocked:
                record["retry_at"] = (utc_now() + dt.timedelta(seconds=int(config["retry_cooldown_seconds"]))).isoformat()
        journal.emit("run_failed", issue=number, persona=persona, exit_code=exit_code, attempts=attempts)
        if blocked:
            tell("comment", lambda: comment(token, number, "blocked", f"The run failed {attempts} times and needs human attention. Exit code: `{exit_code}`."))
            tell("label", lambda: replace_state_label(token, issue, config["issue_label"], "agent-blocked", keep_ready=False))
        else:
            tell("comment", lambda: comment(token, number, "retry scheduled", f"The run exited with `{exit_code}`. It will retry after the configured cooldown."))
            tell("label", lambda: replace_state_label(token, issue, config["issue_label"], None, keep_ready=True))


def within_hours(config: dict[str, Any], now: dt.datetime | None = None) -> bool:
    hour = (now or dt.datetime.now(PACIFIC)).astimezone(PACIFIC).hour
    window = config["working_hours"]
    return int(window["start"]) <= hour < int(window["end"])


def design_reference() -> str:
    """Text digest of the owner's Claude Design mirror for the design stakeholder.

    The dispatcher session refreshes design-system/claude-design/ from the owner's
    claude.ai/design project; Iris reviews with that guidance in hand. Missing or
    empty mirror simply yields no reference — the review proceeds unchanged.
    """
    from runner.layers import page_text
    mirror = PRODUCT_ROOT / "design-system" / "claude-design"
    if not mirror.is_dir():
        return ""
    parts = []
    for path in sorted(mirror.glob("*.html")):
        try:
            parts.append(f"--- {path.name} ---\n{page_text(path.read_text(encoding='utf-8'), 5000)}")
        except OSError:
            continue
    return "\n\n".join(parts)


def stakeholder_prompt(persona: str) -> str:
    """A stakeholder's voice comes from its persona file; stakeholders that never
    run workers (sales) have no .secrets entry, so read the prompt directly."""
    return (ROOT / "personas" / f"{persona}.md").read_text(encoding="utf-8")


def list_open_issue_titles(token: str) -> list[str]:
    issues = github(f"/repos/{REPOSITORY}/issues?state=open&per_page=100", token)
    return [str(item.get("title", "")) for item in issues if "pull_request" not in item]


def claim_stakeholder_slot(state: State, persona: str, day: str, max_daily: int,
                           min_interval_seconds: int, now: dt.datetime) -> bool:
    """Take this stakeholder's next review slot, or report that it is not due yet.

    Rolling the day over, testing the cadence and stamping the claim all happen
    inside one lock, because a review is slow: the Qwen call and the snapshot take
    tens of seconds, and a decision made before that work and recorded after it
    leaves a window where the next tick — or a second daemon left over from a
    restart — reads a cadence that the review in flight has not written yet. Both
    then fire, and a stakeholder burns its whole day's feedback in a few minutes
    instead of spreading it across the day the owner asked for.
    """
    with state.mutate():
        record = state.value.setdefault("stakeholder_reviews", {}).setdefault(persona, {})
        if record.get("day") != day:
            record.update({"day": day, "count": 0})
        if int(record.get("count", 0)) >= max_daily:
            return False
        last = record.get("last_at")
        if last and (now - dt.datetime.fromisoformat(last)).total_seconds() < min_interval_seconds:
            return False
        record["count"] = int(record.get("count", 0)) + 1
        record["last_at"] = now.isoformat()
        return True


def release_stakeholder_slot(state: State, persona: str) -> None:
    """Give back the daily slot a claimed review never used.

    The cadence stamp stays: a review that just failed should not be retried on the
    next tick, but it should not cost the stakeholder one of its few daily voices.
    """
    with state.mutate():
        record = state.value.setdefault("stakeholder_reviews", {}).setdefault(persona, {})
        record["count"] = max(0, int(record.get("count", 0)) - 1)


def post_stakeholder_reviews(token: str, config: dict[str, Any], state: State,
                             journal: Journal, now: dt.datetime) -> None:
    """Let non-engineering stakeholders steer the product on a cadence.

    Each configured stakeholder (designer on UX, sales on sellability, copywriter
    on wording) reviews the deployed pages through its own lens and files at most
    two concrete tasks to the personas it may assign. Reviews are rate-limited per
    stakeholder per day so feedback stays a signal, not a queue-flooding firehose.
    """
    reviews = config.get("stakeholder_reviews") or []
    if not reviews:
        return
    day = now.astimezone(PACIFIC).date().isoformat()
    delivered = open_titles = None
    for review in reviews:
        persona = str(review.get("persona", ""))
        allowed = [name for name in review.get("assign_to", []) if name in PERSONAS]
        if not allowed or persona not in {**PERSONA_NAMES, **STAKEHOLDER_NAMES}:
            continue
        if not claim_stakeholder_slot(state, persona, day, int(review.get("max_daily", 2)),
                                      int(review.get("min_interval_seconds", 14400)), now):
            continue
        if delivered is None:  # one fetch shared by every due stakeholder this tick
            delivered = delivered_work_context(token)
            open_titles = list_open_issue_titles(token)
        run_dir = AUTONOMY / "stakeholders" / (now.strftime("%Y%m%dT%H%M%SZ") + f"-{persona}")
        run_dir.mkdir(parents=True, exist_ok=True)
        site_url = load_runtime_env().get("WAWALU_PRODUCT_SITE_URL", "")
        snapshot = snapshot_live_site(PRODUCT_ROOT, run_dir, site_url)
        pages = []
        if snapshot:
            pages = [(page.stem, page.read_text(encoding="utf-8", errors="replace"))
                     for page in sorted(snapshot.glob("*.html"))]
        name = PERSONA_NAMES.get(persona) or STAKEHOLDER_NAMES.get(persona, persona)
        try:
            result = stakeholder_review(
                stakeholder_prompt(persona), str(review.get("lens", "")),
                (PRODUCT_ROOT / "PRODUCT.md").read_text(encoding="utf-8"),
                pages, delivered, open_titles, allowed, run_dir / "review.json",
                reference=design_reference() if persona == "design" else "")
        except Exception as error:
            release_stakeholder_slot(state, persona)
            journal.emit("stakeholder_review_failed", persona=persona,
                         error=type(error).__name__, detail=str(error)[:300])
            continue
        created = []
        for task in result["tasks"]:
            criteria = "\n".join(f"- [ ] {item}" for item in task["acceptance_criteria"])
            role = str(review.get("role", persona))
            body = (f"**{name} · {role} feedback**\n\n{result['feedback']}\n\n"
                    f"## Outcome\n\n{task['outcome']}\n\n"
                    f"## Acceptance criteria\n\n{criteria}\n\n"
                    f"Filed by {name} from a live-product review. Normal review and "
                    f"production controls apply.")
            issue = github(f"/repos/{REPOSITORY}/issues", token, "POST", {
                "title": task["title"], "body": body,
                "labels": [config["issue_label"], f"persona:{task['persona']}"]})
            created.append(int(issue["number"]))
            open_titles.append(task["title"])  # a later stakeholder must not duplicate it
        journal.emit("stakeholder_review_posted", persona=persona,
                     tasks=len(created), issues=created)


def start_run(issue: dict[str, Any], config: dict[str, Any], state: State, journal: Journal,
              token: str, runs: RunRegistry) -> bool:
    """Hand one issue to a run thread, leaving the tick free to serve the rest of the team.

    The thread gets its own ``State`` handle rather than the tick's: what keeps
    concurrent runs from overwriting each other is the file lock, not a shared object,
    and a handle per thread means one run's re-read never moves another's ground.
    """
    number = int(issue["number"])

    def body() -> None:
        try:
            execute_issue(issue, config, State(state.path), journal, token)
        except Exception as error:
            journal.emit("run_thread_error", issue=number,
                         error=type(error).__name__, detail=str(error)[:500])

    return runs.start(number, run_persona(issue), body)


def apply_diff_limit(config: dict[str, Any]) -> int:
    """Bind the daily approved-diff rail to config and return it.

    The orchestrator runs in a child process and reads the rail from the
    environment at import, so the value is exported here rather than passed
    per-run: both sides of the fence then agree on one number.
    """
    limit = int(config.get("daily_diff_limit", BUDGET.limit))
    BUDGET.limit = limit
    os.environ["WAWALU_DAILY_DIFF_LIMIT"] = str(limit)
    return limit


def tick(config: dict[str, Any], state: State, journal: Journal, token: str | None = None,
         runs: RunRegistry | None = None) -> str:
    runs = runs if runs is not None else RunRegistry()
    if STOP.exists() or not config.get("enabled", False):
        return "stopped"
    if not within_hours(config):
        if config.get("review_owner_prs", True) and config.get("review_prs_after_hours", False):
            sweep_outstanding_prs(token or installation_token(), config, state, journal)
        return "outside-working-hours"
    token = token or installation_token()
    sync_main()
    ensure_labels(token, config["issue_label"])
    if config.get("review_owner_prs", True):
        sweep_outstanding_prs(token, config, state, journal)
    issues = list_ready_issues(token, config["issue_label"])
    if config.get("interaction_rhythm", False):
        post_daily_standup(token, state, issues, journal, utc_now())
        post_dependency_handoffs(token, state, issues, journal, utc_now())
    post_stakeholder_reviews(token, config, state, journal, utc_now())
    # One directive is planned per tick. The rest stay pending and are planned on
    # later ticks, so several product lines can be in flight without a single tick
    # spending several paid planning runs back to back.
    pending = DirectiveBook().pending()
    generated = generate_directive_backlog(token, config, journal, pending[0]) if pending else None
    # Planning keeps happening while runs are in flight; only starting another one is
    # gated, so a full team still gets its next program written and queued.
    if len(runs) >= max_concurrent_runs(config):
        return "run-slots-full"
    # Planning above still runs; only starting work is gated, so the directive program
    # keeps evolving while the day's diff rail is spent.
    if apply_diff_limit(config) <= BUDGET.count():
        return "diff-budget-exhausted"
    # A run thread may have recorded a submission since this tick began.
    state.reload()
    active = runs.active()
    # Consultation is asked BEFORE the ready queue is picked from, not after it comes
    # up empty. Stakeholder reviews file a steady trickle of legitimate work, so the
    # queue is essentially never empty and gating the next round behind "nothing else
    # to do" left directive evolution to fire only on the accident of every persona
    # being PR-rate-limited at once. The round is self-gating anyway: it only fires
    # once the current program's issues are all closed, so asking every tick costs
    # nothing until there is genuinely a new program to write. Skipped when this tick
    # already planned a directive backlog, to keep it at one paid planning run a tick.
    if not generated and config.get("consult_after_directive_mvp", False):
        generated = consult_every_directive(token, config, journal, state=state)
    issue = choose_issue(generated, state, config, utc_now(), active) if generated else None
    # A rate-limited persona on one directive must not stall every other directive:
    # fall through to the shared ready queue instead of returning early.
    if issue is None:
        issue = choose_issue(issues, state, config, utc_now(), active)
    if issue is None and (issues or pending):
        return "queued-personas-rate-limited"
    if issue is None and config.get("generate_when_idle", False):
        generated = generate_work(token, config, journal)
        issue = choose_issue([generated], state, config, utc_now(), active)
        if issue is None:
            return "persona-pr-rate-limit"
    if issue is None:
        return "idle"
    if resolve_worker(config["default_worker"], state) is None:
        journal.emit("workers_capacity_exhausted", issue=int(issue["number"]))
        return "workers-capacity-exhausted"
    if not start_run(issue, config, state, journal, token, runs):
        return "run-already-active"
    return "executed"


def command_loop(once: bool = False) -> int:
    config = load_config()
    journal = Journal()
    runs = RunRegistry()
    with singleton():
        journal.emit("daemon_started", once=once,
                     max_concurrent_runs=max_concurrent_runs(config))
        while True:
            try:
                result = tick(config, State(), journal, runs=runs)
                journal.emit("tick", result=result, active_runs=len(runs))
            except Exception as error:
                journal.emit("daemon_error", error=type(error).__name__, detail=str(error)[:2000])
            if once:
                # A single-shot invocation was asked for one complete run, so see it out.
                runs.join()
                break
            if STOP.exists():
                break
            time.sleep(max(30, int(config["poll_seconds"])))
        # A STOP must take effect now, not in an hour, so runs still in flight are left
        # to their own worker processes: those keep their own session and finish their
        # pull request, only their bookkeeping is lost. Same as a kill has always been.
        orphaned = sorted(runs.active())
        if orphaned:
            journal.emit("daemon_stopped_with_active_runs", issues=orphaned)
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
    directive.add_argument("--clear", nargs="?", const="__all__", metavar="ID",
                           help="clear one directive by id, or every directive when given no id")
    directive.add_argument("--personas", default="",
                           help="comma-separated personas this directive may be assigned to")
    directive.add_argument("--id", dest="directive_id", default=None,
                           help="explicit directive id (defaults to a slug of the text)")
    args = parser.parse_args()
    AUTONOMY.mkdir(parents=True, exist_ok=True)
    if args.command == "stop":
        STOP.touch(mode=0o600, exist_ok=True); print("autonomous team stopped"); return 0
    if args.command == "resume":
        STOP.unlink(missing_ok=True); print("autonomous team resumed"); return 0
    if args.command == "directive":
        book = DirectiveBook()
        if args.clear:
            removed = book.clear(None if args.clear == "__all__" else args.clear)
            print(f"cleared {removed} directive(s)"); return 0
        if args.text:
            personas = [name.strip() for name in args.personas.split(",") if name.strip()]
            value = book.add(" ".join(args.text), personas, args.directive_id)
            print(json.dumps(summarize_directive(value), indent=2)); return 0
        print(json.dumps([summarize_directive(item) for item in book.read()], indent=2)); return 0
    if args.command == "review-prs":
        approved = review_outstanding_prs(installation_token(), load_config(), State(), Journal())
        print(json.dumps({"approved_pulls": approved}, indent=2)); return 0
    if args.command == "status":
        config = load_config(); state = State()
        print(json.dumps({"enabled": config.get("enabled"), "stopped": STOP.exists(),
                          "attempts_today": state.runs_today(),
                          "max_concurrent_runs": max_concurrent_runs(config),
                          "min_pr_interval_seconds": config.get("min_pr_interval_seconds"),
                          "directives": [summarize_directive(item) for item in DirectiveBook().read()],
                          "state": state.value}, indent=2)); return 0
    return command_loop(args.once)


if __name__ == "__main__":
    raise SystemExit(main())
