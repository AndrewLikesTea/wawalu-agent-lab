"""Policy-enforced, worktree-local SQLite provisioning for worker personas."""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import pathlib
import re
import sqlite3
import sys
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[1]
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
DESTRUCTIVE_SQL_RE = re.compile(
    r"\b(?:ATTACH|DETACH|DROP|TRUNCATE|DELETE|VACUUM\s+INTO|PRAGMA\s+WRITABLE_SCHEMA|LOAD_EXTENSION)\b",
    re.IGNORECASE,
)
TRANSACTION_SQL_RE = re.compile(r"\b(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b", re.IGNORECASE)


class LocalDatabasePolicyError(ValueError):
    """Raised when a requested local database operation exceeds policy."""


def load_policy(root: pathlib.Path = ROOT) -> dict[str, Any]:
    policy = json.loads((root / ".agent-policy.json").read_text(encoding="utf-8"))
    database = policy.get("local_databases")
    if not isinstance(database, dict) or database.get("enabled") is not True:
        raise LocalDatabasePolicyError("local database capability is disabled")
    return database


def _safe_relative_path(root: pathlib.Path, value: str, label: str) -> pathlib.Path:
    relative = pathlib.Path(value)
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        raise LocalDatabasePolicyError(f"{label} must be a relative path inside the worktree")
    candidate = root.joinpath(*relative.parts)
    current = root
    for part in relative.parts:
        current /= part
        if current.exists() and current.is_symlink():
            raise LocalDatabasePolicyError(f"{label} cannot contain symlinks")
    return candidate


class LocalDatabaseManager:
    def __init__(self, root: pathlib.Path = ROOT, policy: dict[str, Any] | None = None):
        self.root = root.resolve()
        self.policy = policy if policy is not None else load_policy(self.root)
        self.directory = _safe_relative_path(self.root, str(self.policy["directory"]), "database directory")
        self.migration_directory = _safe_relative_path(
            self.root, str(self.policy["migration_directory"]), "migration directory"
        )

    def validate_operation(self, operation: str) -> None:
        if operation not in self.policy.get("allowed_operations", []):
            raise LocalDatabasePolicyError(f"operation {operation!r} is not allowed")

    def database_path(self, name: str) -> pathlib.Path:
        prefix = str(self.policy["name_prefix"])
        maximum = int(self.policy.get("max_name_length", 64))
        if not name.startswith(prefix) or len(name) > maximum or not NAME_RE.fullmatch(name):
            raise LocalDatabasePolicyError(
                f"database name must match {prefix}<lowercase letters, digits, or hyphens> "
                f"and be at most {maximum} characters"
            )
        self.directory.mkdir(parents=True, exist_ok=True)
        if self.directory.is_symlink():
            raise LocalDatabasePolicyError("database directory cannot be a symlink")
        path = self.directory / f"{name}.sqlite3"
        if path.exists() and path.is_symlink():
            raise LocalDatabasePolicyError("database file cannot be a symlink")
        if path.resolve().parent != self.directory.resolve():
            raise LocalDatabasePolicyError("database path escapes the allowed directory")
        return path

    @staticmethod
    def _connect(path: pathlib.Path) -> sqlite3.Connection:
        connection = sqlite3.connect(path, timeout=5)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=5000")
        connection.execute(
            "CREATE TABLE IF NOT EXISTS _wawalu_schema_migrations "
            "(name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        )
        connection.commit()
        return connection

    def create(self, name: str) -> pathlib.Path:
        self.validate_operation("create")
        path = self.database_path(name)
        with contextlib.closing(self._connect(path)) as connection:
            result = connection.execute("PRAGMA quick_check").fetchone()
            if result != ("ok",):
                raise RuntimeError(f"new database failed integrity check: {result!r}")
        return path

    def migration_files(self) -> list[pathlib.Path]:
        if not self.migration_directory.is_dir() or self.migration_directory.is_symlink():
            raise LocalDatabasePolicyError("migration directory is missing or unsafe")
        files = sorted(self.migration_directory.glob("*.sql"))
        for path in files:
            if path.is_symlink() or not path.is_file() or path.resolve().parent != self.migration_directory.resolve():
                raise LocalDatabasePolicyError(f"unsafe migration path: {path}")
        return files

    def migrate(self, name: str) -> list[str]:
        self.validate_operation("migrate")
        path = self.database_path(name)
        applied: list[str] = []
        with contextlib.closing(self._connect(path)) as connection:
            for migration in self.migration_files():
                sql = migration.read_text(encoding="utf-8")
                if not self.policy.get("destructive_sql_allowed", False) and DESTRUCTIVE_SQL_RE.search(sql):
                    raise LocalDatabasePolicyError(f"destructive SQL is forbidden in {migration.name}")
                if TRANSACTION_SQL_RE.search(sql):
                    raise LocalDatabasePolicyError(f"transaction control is managed by the broker in {migration.name}")
                checksum = hashlib.sha256(sql.encode()).hexdigest()
                previous = connection.execute(
                    "SELECT checksum FROM _wawalu_schema_migrations WHERE name = ?", (migration.name,)
                ).fetchone()
                if previous:
                    if previous[0] != checksum:
                        raise LocalDatabasePolicyError(f"applied migration changed: {migration.name}")
                    continue
                escaped_name = migration.name.replace("'", "''")
                connection.executescript(
                    "BEGIN IMMEDIATE;\n"
                    + sql
                    + "\nINSERT INTO _wawalu_schema_migrations(name, checksum) VALUES "
                    + f"('{escaped_name}', '{checksum}');\nCOMMIT;"
                )
                applied.append(migration.name)
        return applied

    def check(self, name: str) -> str:
        self.validate_operation("check")
        path = self.database_path(name)
        if not path.is_file():
            raise LocalDatabasePolicyError("database does not exist")
        with contextlib.closing(self._connect(path)) as connection:
            result = connection.execute("PRAGMA quick_check").fetchone()
        if result != ("ok",):
            raise RuntimeError(f"database integrity check failed: {result!r}")
        return "ok"


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage policy-scoped local agent databases")
    subparsers = parser.add_subparsers(dest="operation", required=True)
    for operation in ("create", "migrate", "check", "path"):
        command = subparsers.add_parser(operation)
        command.add_argument("name")
    args = parser.parse_args()
    try:
        manager = LocalDatabaseManager()
        manager.validate_operation(args.operation)
        if args.operation == "create":
            result: Any = {"path": str(manager.create(args.name))}
        elif args.operation == "migrate":
            result = {"path": str(manager.database_path(args.name)), "applied": manager.migrate(args.name)}
        elif args.operation == "check":
            result = {"path": str(manager.database_path(args.name)), "status": manager.check(args.name)}
        else:
            result = {"path": str(manager.database_path(args.name))}
        print(json.dumps(result))
        return 0
    except (LocalDatabasePolicyError, OSError, sqlite3.Error) as error:
        print(f"local database policy: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
