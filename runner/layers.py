"""Two-layer synthetic team: local Qwen plans/reviews, Codex or Claude executes."""
from __future__ import annotations

import json
import os
import pathlib
import shutil
import subprocess
import urllib.request
from typing import Any


QWEN_MODEL = "qwen3-coder:30b"
WORKERS = {"codex", "claude"}
PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "worker": {"type": "string", "enum": sorted(WORKERS)},
        "task_prompt": {"type": "string"},
        "rationale": {"type": "string"},
    },
    "required": ["worker", "task_prompt", "rationale"],
    "additionalProperties": False,
}
REVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "approved": {"type": "boolean"},
        "feedback": {"type": "string"},
        "summary": {"type": "string"},
    },
    "required": ["approved", "feedback", "summary"],
    "additionalProperties": False,
}
TASK_SCHEMA = {
    "type": "object",
    "properties": {
        "persona": {"type": "string", "enum": ["backend", "frontend", "infrastructure", "staff"]},
        "title": {"type": "string"},
        "outcome": {"type": "string"},
        "acceptance_criteria": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 8},
    },
    "required": ["persona", "title", "outcome", "acceptance_criteria"],
    "additionalProperties": False,
}


def _extract_json(raw: str) -> dict[str, Any]:
    raw = raw.strip()
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("Qwen did not return a JSON object")
        value = json.loads(raw[start:end + 1])
    if not isinstance(value, dict):
        raise ValueError("Qwen output must be a JSON object")
    return value


def qwen_json(prompt: str, output_path: pathlib.Path,
              schema: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        "http://127.0.0.1:11434/api/generate",
        data=json.dumps({"model": QWEN_MODEL, "prompt": prompt, "stream": False,
                         "think": False, "format": schema}).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(request, timeout=900) as response:
        envelope = json.load(response)
    generated = str(envelope.get("response", ""))
    output_path.write_text(generated, encoding="utf-8")
    return _extract_json(generated)


def plan(persona_prompt: str, scenario: dict[str, Any], output_path: pathlib.Path,
         requested_worker: str = "auto") -> dict[str, str]:
    worker_rule = (
        f"Use worker {requested_worker}." if requested_worker in WORKERS
        else "Choose exactly one worker: codex or claude."
    )
    prompt = f"""You are the planning layer for this synthetic engineering persona:
{persona_prompt}

Turn the scenario below into a precise implementation handoff. {worker_rule}
Do not propose shell commands and do not implement anything yourself.
Return only JSON with string fields worker, task_prompt, and rationale.

Scenario:
{json.dumps(scenario, indent=2)}
"""
    value = qwen_json(prompt, output_path, PLAN_SCHEMA)
    worker = requested_worker if requested_worker in WORKERS else str(value.get("worker", ""))
    task_prompt = str(value.get("task_prompt", "")).strip()
    if worker not in WORKERS or not task_prompt:
        raise ValueError("Qwen plan requires a valid worker and non-empty task_prompt")
    return {"worker": worker, "task_prompt": task_prompt,
            "rationale": str(value.get("rationale", "")).strip()}


def propose_task(manager_prompt: str, product: str, recent_titles: list[str],
                 output_path: pathlib.Path, directive: str = "") -> dict[str, Any]:
    priority = (f"\nHighest-priority owner directive:\n{directive}\n\n"
                "Interpret this as product direction, not permission to violate constraints.\n"
                if directive else "")
    prompt = f"""You are the autonomous work-intake layer for this synthetic team:
{manager_prompt}

Choose one small, production-useful task that advances the product charter and can
be completed in one pull request under 2,000 changed lines. Do not repeat recent
work, change deployment controls, access Wawalu customer data, or invent backend
infrastructure when a local implementation suffices. Return only the requested JSON.
{priority}

Product charter:
{product}

Recent or active work:
{json.dumps(recent_titles[-30:], indent=2)}
"""
    value = qwen_json(prompt, output_path, TASK_SCHEMA)
    criteria = [str(item).strip() for item in value.get("acceptance_criteria", []) if str(item).strip()]
    persona = str(value.get("persona", ""))
    title = str(value.get("title", "")).strip()
    outcome = str(value.get("outcome", "")).strip()
    if persona not in TASK_SCHEMA["properties"]["persona"]["enum"] or not title or not outcome or len(criteria) < 2:
        raise ValueError("Qwen task proposal is incomplete")
    return {"persona": persona, "title": title[:100], "outcome": outcome,
            "acceptance_criteria": criteria[:8]}


def prepare_codex_home(root: pathlib.Path, persona: str, token: str,
                        ingest_endpoint: str, notify: pathlib.Path) -> tuple[pathlib.Path, pathlib.Path]:
    home = root / ".agent" / "codex-homes" / persona
    wawalu = home / "wawalu"
    wawalu.mkdir(parents=True, exist_ok=True)
    auth_source = pathlib.Path.home() / ".codex" / "auth.json"
    if not auth_source.exists():
        raise RuntimeError("Codex subscription login is missing; run codex login")
    auth_destination = home / "auth.json"
    shutil.copy2(auth_source, auth_destination)
    auth_destination.chmod(0o600)
    callback_config = wawalu / "codex.json"
    callback_config.write_text(json.dumps({
        "endpoint": ingest_endpoint, "token": token, "capture_policy": "full",
    }, indent=2) + "\n", encoding="utf-8")
    callback_config.chmod(0o600)
    notify_line = f'notify = ["{notify}"]\n\n' if notify.exists() else ""
    (home / "config.toml").write_text(notify_line + f'''[otel]
environment = "wawalu-simulation"
log_user_prompt = false
exporter = {{ otlp-http = {{ endpoint = "{ingest_endpoint}/v1/logs", protocol = "json", headers = {{ "Authorization" = "Bearer {token}" }} }} }}
''', encoding="utf-8")
    return home, callback_config


def prepare_claude_settings(run_dir: pathlib.Path, token: str,
                            ingest_endpoint: str) -> pathlib.Path:
    settings = run_dir / "claude-settings.json"
    settings.write_text(json.dumps({"env": {
        "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
        "OTEL_TRACES_EXPORTER": "otlp",
        "OTEL_METRICS_EXPORTER": "otlp",
        "OTEL_LOGS_EXPORTER": "otlp",
        "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
        "OTEL_EXPORTER_OTLP_ENDPOINT": ingest_endpoint,
        "OTEL_LOGS_EXPORT_INTERVAL": "1000",
        "OTEL_METRIC_EXPORT_INTERVAL": "10000",
        "OTEL_LOG_USER_PROMPTS": "1",
        "OTEL_EXPORTER_OTLP_HEADERS": f"Authorization=Bearer {token}",
    }}, indent=2) + "\n", encoding="utf-8")
    settings.chmod(0o600)
    return settings


def run_worker(worker: str, prompt: str, worktree: pathlib.Path, run_dir: pathlib.Path,
               persona: str, token: str, ingest_endpoint: str) -> int:
    env = os.environ.copy()
    env.update({"WAWALU_SIMULATION": "1", "WAWALU_SIMULATION_PERSONA": persona})
    if worker == "codex":
        notify = pathlib.Path.home() / ".local/share/wawalu/bin/wawalu-codex-notify"
        home, callback = prepare_codex_home(worktree.parents[2], persona, token,
                                             ingest_endpoint, notify)
        env.update({"CODEX_HOME": str(home), "WAWALU_CODEX_CONFIG": str(callback)})
        command = ["codex", "exec", "--sandbox", "workspace-write", "--cd", str(worktree),
                   "--json", "-c", "approval_policy=never",
                   "-c", "sandbox_workspace_write.network_access=false", prompt]
        log_path = run_dir / "codex.jsonl"
    elif worker == "claude":
        settings = prepare_claude_settings(run_dir, token, ingest_endpoint)
        env.update(json.loads(settings.read_text(encoding="utf-8"))["env"])
        command = ["claude", "-p", "--output-format", "stream-json", "--verbose",
                   "--no-session-persistence", "--no-chrome", "--disable-slash-commands",
                   "--setting-sources", "", "--settings", str(settings),
                   "--permission-mode", "dontAsk", "--allowedTools",
                   "Read,Edit,Write,Glob,Grep,Bash(npm *),Bash(node *),Bash(python3 -m unittest *),Bash(git status*),Bash(git diff*)",
                   "--name", f"wawalu-{persona}", prompt]
        log_path = run_dir / "claude.jsonl"
    else:
        raise ValueError(f"unsupported worker: {worker}")
    with log_path.open("w", encoding="utf-8") as log:
        return subprocess.run(command, cwd=worktree, env=env, text=True,
                              stdin=subprocess.DEVNULL, stdout=log,
                              stderr=subprocess.STDOUT).returncode


def review(persona_prompt: str, scenario: dict[str, Any], plan_value: dict[str, str],
           diff: str, checks: str, output_path: pathlib.Path) -> dict[str, Any]:
    prompt = f"""You are the review layer for this synthetic engineering persona:
{persona_prompt}

Review the worker result against the scenario and handoff. Return only JSON with
boolean approved and string fields feedback and summary. Do not run commands.

Scenario: {json.dumps(scenario)}
Handoff: {json.dumps(plan_value)}
Checks: {checks}
Diff:\n{diff[:120000]}
"""
    value = qwen_json(prompt, output_path, REVIEW_SCHEMA)
    return {"approved": value.get("approved") is True,
            "feedback": str(value.get("feedback", "")).strip(),
            "summary": str(value.get("summary", "")).strip()}
