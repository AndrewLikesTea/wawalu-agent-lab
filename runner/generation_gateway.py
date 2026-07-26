"""Durable, local gateway for content-generation requests.

The spool is intentionally a directory of JSON files. Atomic renames provide the
only queue primitive we need, keep recovery inspectable, and avoid introducing a
daemon or a network service. Payloads stay private (0600); sampled records contain
only hashes and operational metadata.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import pathlib
import uuid
from collections.abc import Callable
from typing import Any


Transport = Callable[[dict[str, Any]], dict[str, Any]]


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _write_private(path: pathlib.Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(value, output, sort_keys=True, separators=(",", ":"))
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


class GenerationGateway:
    """Persistent at-least-once queue with one-request dispatch operations."""

    def __init__(
        self,
        root: pathlib.Path,
        *,
        sample_rate: float = 0.0,
        sample_seed: str = "",
        max_attempts: int = 3,
        now: Callable[[], dt.datetime] | None = None,
        request_id: Callable[[], str] | None = None,
    ):
        if not 0.0 <= sample_rate <= 1.0:
            raise ValueError("sample_rate must be between 0 and 1")
        if max_attempts < 1:
            raise ValueError("max_attempts must be positive")
        self.root = root
        self.sample_rate = sample_rate
        self.sample_seed = sample_seed
        self.max_attempts = max_attempts
        self.now = now or (lambda: dt.datetime.now(dt.UTC))
        self.request_id = request_id or (lambda: str(uuid.uuid4()))
        for name in ("pending", "inflight", "completed", "failed", "samples"):
            directory = root / name
            directory.mkdir(parents=True, exist_ok=True)
            directory.chmod(0o700)

    def enqueue(self, payload: dict[str, Any], *, operation: str) -> str:
        request_id = self.request_id()
        created_at = self.now().isoformat()
        job = {
            "version": 1,
            "request_id": request_id,
            "operation": operation,
            "created_at": created_at,
            "attempts": 0,
            "payload": payload,
        }
        _write_private(self.root / "pending" / f"{request_id}.json", job)
        return request_id

    def dispatch_one(self, transport: Transport) -> str | None:
        pending = next(iter(sorted((self.root / "pending").glob("*.json"))), None)
        if pending is None:
            return None
        return self.dispatch(pending.stem, transport)

    def dispatch(self, request_id: str, transport: Transport) -> str | None:
        """Claim and dispatch a specific request, or return None if already claimed."""
        pending = self.root / "pending" / f"{request_id}.json"
        inflight = self.root / "inflight" / pending.name
        try:
            pending.replace(inflight)
        except FileNotFoundError:  # Another dispatcher claimed it.
            return None
        job = json.loads(inflight.read_text(encoding="utf-8"))
        job["attempts"] += 1
        job["dispatched_at"] = self.now().isoformat()
        _write_private(inflight, job)
        try:
            response = transport(job["payload"])
            completed_at = self.now().isoformat()
            result = {**job, "completed_at": completed_at, "response": response}
            _write_private(self.root / "completed" / inflight.name, result)
            self._sample(result)
            inflight.unlink()
            return job["request_id"]
        except Exception as error:
            job["last_error"] = type(error).__name__
            job["failed_at"] = self.now().isoformat()
            destination = "failed" if job["attempts"] >= self.max_attempts else "pending"
            _write_private(self.root / destination / inflight.name, job)
            inflight.unlink()
            raise

    def recover_inflight(self) -> int:
        """Return abandoned claims to pending while no dispatchers are running."""
        recovered = 0
        for claimed in sorted((self.root / "inflight").glob("*.json")):
            destination = self.root / "pending" / claimed.name
            if destination.exists():
                continue
            claimed.replace(destination)
            recovered += 1
        return recovered

    def result(self, request_id: str) -> dict[str, Any] | None:
        path = self.root / "completed" / f"{request_id}.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    def _sample(self, result: dict[str, Any]) -> None:
        request_id = result["request_id"]
        draw = int.from_bytes(
            hashlib.sha256(f"{self.sample_seed}:{request_id}".encode()).digest()[:8], "big"
        ) / 2**64
        if draw >= self.sample_rate:
            return
        payload = result["payload"]
        response = result["response"]
        record = {
            "version": 1,
            "request_id": request_id,
            "operation": result["operation"],
            "model": str(payload.get("model", "")),
            "created_at": result["created_at"],
            "completed_at": result["completed_at"],
            "attempts": result["attempts"],
            "prompt_sha256": hashlib.sha256(str(payload.get("prompt", "")).encode()).hexdigest(),
            "schema_sha256": hashlib.sha256(_canonical(payload.get("format"))).hexdigest(),
            "response_sha256": hashlib.sha256(str(response.get("response", "")).encode()).hexdigest(),
        }
        _write_private(self.root / "samples" / f"{request_id}.json", record)
