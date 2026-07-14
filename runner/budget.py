"""Local, atomic daily budget for Qwen-approved synthetic code diffs."""
from __future__ import annotations

import datetime as dt
import fcntl
import json
import pathlib
from typing import Any


DAILY_DIFF_LIMIT = 50


def _day(now: dt.datetime | None = None) -> str:
    return (now or dt.datetime.now(dt.UTC)).astimezone(dt.UTC).date().isoformat()


class DiffBudget:
    def __init__(self, root: pathlib.Path, limit: int = DAILY_DIFF_LIMIT):
        self.directory = root / ".agent" / "budgets"
        self.limit = limit

    def _paths(self, now: dt.datetime | None = None) -> tuple[pathlib.Path, pathlib.Path]:
        day = _day(now)
        return self.directory / f"{day}.json", self.directory / f"{day}.lock"

    def _read(self, path: pathlib.Path) -> list[dict[str, Any]]:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            return value if isinstance(value, list) else []
        except (OSError, ValueError):
            return []

    def count(self, now: dt.datetime | None = None) -> int:
        ledger, _ = self._paths(now)
        return len(self._read(ledger))

    def ensure_available(self, now: dt.datetime | None = None) -> None:
        if self.count(now) >= self.limit:
            raise RuntimeError(f"daily approved diff limit reached ({self.limit})")

    def record(self, entry: dict[str, Any], now: dt.datetime | None = None) -> int:
        ledger, lock = self._paths(now)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        with lock.open("a+", encoding="utf-8") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            entries = self._read(ledger)
            if len(entries) >= self.limit:
                raise RuntimeError(f"daily approved diff limit reached ({self.limit})")
            entries.append(entry)
            temporary = ledger.with_suffix(".tmp")
            temporary.write_text(json.dumps(entries, indent=2) + "\n", encoding="utf-8")
            temporary.chmod(0o600)
            temporary.replace(ledger)
            return self.limit - len(entries)
