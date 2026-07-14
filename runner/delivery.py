"""Trusted delivery control for reviewer-approved synthetic pull requests."""
from __future__ import annotations

import os
import pathlib
import subprocess


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
