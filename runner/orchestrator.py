import argparse
import base64
import datetime as dt
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import uuid

from runner.github_app import installation_token

ROOT = pathlib.Path(__file__).resolve().parents[1]
AGENT_DIR = ROOT / ".agent"
SECRETS = ROOT / ".secrets" / "personas.json"
RUNTIME_ENV = ROOT / ".secrets" / "runtime.env"
MODEL = "qwen3-coder:30b"


def run(command: list[str], cwd: pathlib.Path = ROOT, **kwargs):
    return subprocess.run(command, cwd=cwd, check=True, text=True, **kwargs)


def output(command: list[str], cwd: pathlib.Path = ROOT) -> str:
    return subprocess.check_output(command, cwd=cwd, text=True).strip()


def load_personas() -> dict:
    if not SECRETS.exists():
        raise SystemExit("copy config/personas.example.json to .secrets/personas.json and populate tokens")
    return json.loads(SECRETS.read_text())["personas"]


def load_runtime_env() -> dict[str, str]:
    if not RUNTIME_ENV.exists():
        raise SystemExit("missing ignored runtime configuration: .secrets/runtime.env")
    values = {}
    for raw_line in RUNTIME_ENV.read_text().splitlines():
        line = raw_line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    return values


def safe_slug(value: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not value: raise SystemExit("scenario requires a usable id")
    return value[:48]


def prepare_home(persona: str, token: str, runtime: dict[str, str]) -> tuple[pathlib.Path, pathlib.Path]:
    home = AGENT_DIR / "codex-homes" / persona
    config_dir = home / "wawalu"
    config_dir.mkdir(parents=True, exist_ok=True)
    notify = pathlib.Path.home() / ".local/share/wawalu/bin/wawalu-codex-notify"
    notify_config = config_dir / "codex.json"
    ingest_endpoint = runtime["WAWALU_INGEST_ENDPOINT"].rstrip("/")
    notify_config.write_text(json.dumps({
        "endpoint": ingest_endpoint, "token": token,
        "capture_policy": "full",
    }, indent=2) + "\n")
    notify_config.chmod(0o600)
    notify_line = f'notify = ["{notify}"]\n\n' if notify.exists() else ""
    (home / "config.toml").write_text(notify_line + f'''[otel]
environment = "wawalu-simulation"
log_user_prompt = false
exporter = {{ otlp-http = {{ endpoint = "{ingest_endpoint}/v1/logs", protocol = "json", headers = {{ "Authorization" = "Bearer {token}" }} }} }}
''')
    return home, notify_config


def prepare_worktree(persona: str, scenario_id: str) -> tuple[pathlib.Path, str]:
    branch = f"agent/{persona}/{scenario_id}"
    worktree = AGENT_DIR / "worktrees" / f"{persona}-{scenario_id}"
    if worktree.exists():
        raise SystemExit(f"worktree already exists: {worktree}")
    run(["git", "worktree", "add", "-b", branch, str(worktree), "main"])
    return worktree, branch


def build_prompt(persona: str, persona_data: dict, scenario: dict) -> str:
    persona_prompt = (ROOT / persona_data["prompt_file"]).read_text()
    return f'''{persona_prompt}

You are working on scenario {scenario['id']!r}.

Outcome:
{scenario['outcome']}

Acceptance criteria:
{json.dumps(scenario['acceptance_criteria'], indent=2)}

Read PRODUCT.md, AGENTS.md, and .agent-policy.json. Implement only this task.
Run all relevant tests. Do not push, merge, deploy, or access anything outside
this worktree. Finish with a concise summary of changes, checks, and risks.
'''


def command_status() -> int:
    print(json.dumps({
        "root": str(ROOT), "model": MODEL,
        "git": output(["git", "status", "--short", "--branch"]),
        "github_authenticated": subprocess.run(["gh", "auth", "status"], capture_output=True).returncode == 0,
        "ollama_models": output(["ollama", "list"]),
        "personas_configured": SECRETS.exists(),
    }, indent=2))
    return 0


def command_run(persona: str, scenario_path: str, push: bool) -> int:
    personas = load_personas()
    runtime = load_runtime_env()
    if persona not in personas: raise SystemExit(f"unknown persona: {persona}")
    scenario = json.loads((ROOT / scenario_path).read_text())
    scenario_id = safe_slug(scenario["id"])
    worktree, branch = prepare_worktree(persona, scenario_id)
    home, notify_config = prepare_home(persona, personas[persona]["wawalu_token"], runtime)
    run_id = f"sim_{dt.datetime.now(dt.UTC).strftime('%Y%m%dT%H%M%SZ')}_{uuid.uuid4().hex[:8]}"
    run_dir = AGENT_DIR / "runs" / run_id
    run_dir.mkdir(parents=True)
    prompt = build_prompt(persona, personas[persona], scenario)
    (run_dir / "prompt.txt").write_text(prompt)
    env = os.environ.copy()
    env.update({
        "CODEX_HOME": str(home), "WAWALU_CODEX_CONFIG": str(notify_config),
        "WAWALU_SIMULATION": "1", "WAWALU_SIMULATION_RUN_ID": run_id,
        "WAWALU_SIMULATION_PERSONA": persona,
    })
    command = [
        "codex", "exec", "--oss", "--local-provider", "ollama", "--model", MODEL,
        "--sandbox", "workspace-write", "--cd", str(worktree), "--json",
        "-c", "approval_policy=never", "-c", "sandbox_workspace_write.network_access=false", prompt,
    ]
    with (run_dir / "codex.jsonl").open("w") as log:
        result = subprocess.run(command, cwd=worktree, env=env, text=True, stdout=log, stderr=subprocess.STDOUT)
    metadata = {"run_id": run_id, "persona": persona, "scenario": scenario_id,
                "branch": branch, "worktree": str(worktree), "exit_code": result.returncode}
    (run_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    if result.returncode: return result.returncode
    run(["npm", "run", "check"], cwd=worktree)
    run([sys.executable, "-m", "runner.policy", "--base", "main"], cwd=worktree)
    if output(["git", "status", "--porcelain"], cwd=worktree):
        run(["git", "add", "--all"], cwd=worktree)
        run(["git", "commit", "-m", f"Agent: {scenario.get('title', scenario_id)}"], cwd=worktree)
    run([sys.executable, "-m", "runner.policy", "--base", "main"], cwd=worktree)
    if push:
        github_token = installation_token()
        auth = base64.b64encode(f"x-access-token:{github_token}".encode()).decode()
        push_env = os.environ.copy()
        push_env.update({"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "http.https://github.com/.extraheader",
                         "GIT_CONFIG_VALUE_0": "AUTHORIZATION: basic " + auth})
        run(["git", "push", "--set-upstream", "origin", branch], cwd=worktree, env=push_env)
        title = scenario.get("title", scenario["outcome"].splitlines()[0])[:100]
        pr_env = os.environ.copy(); pr_env["GH_TOKEN"] = github_token
        issue_line = f"\n\nCloses #{scenario['issue']}" if scenario.get("issue") else ""
        run(["gh", "pr", "create", "--repo", "AndrewLikesTea/wawalu-agent-lab",
             "--base", "main", "--head", branch,
             "--title", title, "--body", f"Synthetic team run: `{run_id}`\n\nProduction deployment still requires owner approval.{issue_line}"], cwd=worktree, env=pr_env)
    print(json.dumps(metadata, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run isolated local Codex engineering personas")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    execute = sub.add_parser("run")
    execute.add_argument("persona")
    execute.add_argument("scenario")
    execute.add_argument("--push", action="store_true")
    args = parser.parse_args()
    return command_status() if args.command == "status" else command_run(args.persona, args.scenario, args.push)


if __name__ == "__main__":
    raise SystemExit(main())
