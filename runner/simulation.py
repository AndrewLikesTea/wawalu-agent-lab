"""Stable human-behavior traits for the synthetic demo team."""
from __future__ import annotations

import hashlib
import json
import pathlib
import random
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config" / "team-behaviors.json"


def load_behaviors(path: pathlib.Path = CONFIG) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def stable_random(*parts: object) -> random.Random:
    seed = hashlib.sha256("\x1f".join(map(str, parts)).encode()).digest()
    return random.Random(int.from_bytes(seed[:8], "big"))


def happens(rate: float, *parts: object) -> bool:
    return stable_random(*parts).random() < max(0.0, min(1.0, rate))


def personality_context(profile: dict[str, Any], expose_blind_spot: bool) -> str:
    text = str(profile["work_style"])
    if expose_blind_spot:
        text += ("\nYour realistic first-pass tendency: " + str(profile["blind_spot"]) +
                 " Do not deliberately introduce defects or bypass tests; let teammates and review challenge genuine misses.")
    return text


def choose_collaborator(primary: str, scenario_id: str, eligible: list[str],
                        behaviors: dict[str, Any]) -> str | None:
    profile = behaviors["personas"][primary]
    candidates = sorted(persona for persona in eligible if persona != primary)
    if not candidates or not happens(float(profile["collaboration_rate"]), "collaborate", primary, scenario_id):
        return None
    return stable_random("collaborator", primary, scenario_id).choice(candidates)


def retry_salt(attempt: int) -> tuple[object, ...]:
    """Extra seed parts that make a retry draw different behavior than the try before.

    A draw seeded only on (persona, scenario) is identical on every attempt, so a
    run rejected *because* of the drawn behavior — an aside that widens the diff
    past the reviewer's scope bar — reproduces that rejection until the issue is
    blocked. Attempt 1 keeps its historical seed so first passes stay reproducible.
    """
    return () if int(attempt) <= 1 else (int(attempt),)


def choose_distraction(persona: str, scenario_id: str, behaviors: dict[str, Any],
                       attempt: int = 1) -> str | None:
    profile = behaviors["personas"][persona]
    salt = retry_salt(attempt)
    if not happens(float(profile["distraction_rate"]), "distraction", persona, scenario_id, *salt):
        return None
    return stable_random("aside", persona, scenario_id, *salt).choice(behaviors["distractions"])


def choose_peer_reviewer(author: str, scenario_id: str) -> str:
    """Pick a stable complementary reviewer; never assign the author to review itself."""
    complements = {
        "backend": ("infrastructure", "frontend"),
        "frontend": ("staff", "backend"),
        "infrastructure": ("backend", "staff"),
        "staff": ("frontend", "infrastructure"),
        # Each new role is reviewed by the discipline most likely to catch what it
        # misses: product work by the staff and design eyes that must build it,
        # design by frontend, and both data roles by the people downstream of them.
        "product": ("staff", "design"),
        "design": ("frontend", "product"),
        "evaluation": ("backend", "staff"),
        "integrations": ("backend", "infrastructure"),
        # The 2026-07-25 hires: copy is reviewed by the disciplines that render it,
        # pixels by the people who consume them, tests by those they gate, security
        # by the operators, and platform by the engineers it deploys.
        "copywriter": ("design", "frontend"),
        "graphics": ("frontend", "design"),
        "fullstack": ("backend", "frontend"),
        "qa": ("staff", "backend"),
        "security": ("infrastructure", "backend"),
        "platform": ("infrastructure", "staff"),
    }
    choices = complements.get(author, ("staff", "backend"))
    return stable_random("peer-review", author, scenario_id).choice(choices)
