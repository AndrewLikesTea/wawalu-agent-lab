"""Trusted delivery control for reviewer-approved synthetic pull requests."""
from __future__ import annotations

import os
import pathlib
import subprocess
import json


DELIVERY_REQUEST = ".agent-delivery.json"


def consume_merge_request(worktree: pathlib.Path, persona: str, branch: str) -> bool:
    """Consume a worker-authored, branch-bound auto-merge capability request."""
    path = worktree / DELIVERY_REQUEST
    if not path.exists():
        return False
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 4096:
        raise ValueError("invalid worker delivery request file")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    finally:
        path.unlink(missing_ok=True)
    expected = {"action": "auto_merge", "branch": branch, "requested_by": persona}
    if value != expected:
        raise ValueError("worker delivery request does not match its persona and branch")
    return True


def enable_auto_merge(repository: str, branch: str, token: str, cwd: pathlib.Path) -> None:
    """Ask GitHub to merge after branch protection passes; never bypass checks."""
    env = os.environ.copy()
    env["GH_TOKEN"] = token
    subprocess.run(
        ["gh", "pr", "merge", branch, "--repo", repository, "--auto", "--squash", "--delete-branch"],
        cwd=cwd,
        env=env,
        check=True,
    )
