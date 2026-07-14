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


def choose_distraction(persona: str, scenario_id: str, behaviors: dict[str, Any]) -> str | None:
    profile = behaviors["personas"][persona]
    if not happens(float(profile["distraction_rate"]), "distraction", persona, scenario_id):
        return None
    return stable_random("aside", persona, scenario_id).choice(behaviors["distractions"])


def choose_peer_reviewer(author: str, scenario_id: str) -> str:
    """Pick a stable complementary reviewer; never assign the author to review itself."""
    complements = {
        "backend": ("infrastructure", "frontend"),
        "frontend": ("staff", "backend"),
        "infrastructure": ("backend", "staff"),
        "staff": ("frontend", "infrastructure"),
    }
    choices = complements.get(author, ("staff", "backend"))
    return stable_random("peer-review", author, scenario_id).choice(choices)
