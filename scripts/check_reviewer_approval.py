#!/usr/bin/env python3
"""Fail CI unless the synthetic Reviewer App approved the exact PR head."""
from __future__ import annotations

import json
import os
import urllib.request


REVIEWER_LOGINS = {"wawalu-synthetic-reviewer", "wawalu-synthetic-reviewer[bot]"}


def approved_current_head(reviews: list[dict], head_sha: str) -> bool:
    return any(
        isinstance(review, dict)
        and isinstance(review.get("user"), dict)
        and review.get("state") == "APPROVED"
        and review.get("commit_id") == head_sha
        and (review.get("user") or {}).get("login") in REVIEWER_LOGINS
        for review in reviews
    )


def fetch_reviews(repository: str, pull_number: str, token: str) -> list[dict]:
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repository}/pulls/{pull_number}/reviews?per_page=100",
        headers={"Authorization": f"Bearer {token}",
                 "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28",
                 "User-Agent": "wawalu-agent-lab"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        value = json.load(response)
    return value if isinstance(value, list) else []


def main() -> int:
    repository = os.environ["GITHUB_REPOSITORY"]
    pull_number = os.environ["PR_NUMBER"]
    head_sha = os.environ["PR_HEAD_SHA"]
    token = os.environ["GITHUB_TOKEN"]
    if approved_current_head(fetch_reviews(repository, pull_number, token), head_sha):
        print(f"synthetic reviewer approved {head_sha}")
        return 0
    print(f"synthetic reviewer has not approved current head {head_sha}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
