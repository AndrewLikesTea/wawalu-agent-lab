import argparse
import base64
import datetime as dt
import json
import os
import pathlib
import re
import subprocess
import sys
import uuid

from runner.github_app import installation_token
from runner.budget import DiffBudget
from runner.layers import plan, review, run_worker, WORKERS

ROOT = pathlib.Path(__file__).resolve().parents[1]
AGENT_DIR = ROOT / ".agent"
SECRETS = ROOT / ".secrets" / "personas.json"
RUNTIME_ENV = ROOT / ".secrets" / "runtime.env"
BUDGET = DiffBudget(ROOT)


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


def prepare_worktree(persona: str, scenario_id: str) -> tuple[pathlib.Path, str]:
    branch = f"agent/{persona}/{scenario_id}"
    worktree = AGENT_DIR / "worktrees" / f"{persona}-{scenario_id}"
    if worktree.exists():
        raise SystemExit(f"worktree already exists: {worktree}")
    run(["git", "worktree", "add", "-b", branch, str(worktree), "main"])
    return worktree, branch


def command_status() -> int:
    print(json.dumps({
        "root": str(ROOT), "planner_model": "qwen3-coder:30b",
        "git": output(["git", "status", "--short", "--branch"]),
        "github_authenticated": subprocess.run(["gh", "auth", "status"], capture_output=True).returncode == 0,
        "ollama_models": output(["ollama", "list"]),
        "personas_configured": SECRETS.exists(),
        "approved_diffs_today": BUDGET.count(),
        "approved_diff_limit": BUDGET.limit,
    }, indent=2))
    return 0


def command_run(persona: str, scenario_path: str, push: bool, requested_worker: str) -> int:
    BUDGET.ensure_available()
    personas = load_personas()
    runtime = load_runtime_env()
    if persona not in personas: raise SystemExit(f"unknown persona: {persona}")
    scenario = json.loads((ROOT / scenario_path).read_text())
    scenario_id = safe_slug(scenario["id"])
    worktree, branch = prepare_worktree(persona, scenario_id)
    run_id = f"sim_{dt.datetime.now(dt.UTC).strftime('%Y%m%dT%H%M%SZ')}_{uuid.uuid4().hex[:8]}"
    run_dir = AGENT_DIR / "runs" / run_id
    run_dir.mkdir(parents=True)
    persona_prompt = (ROOT / personas[persona]["prompt_file"]).read_text()
    plan_value = plan(persona_prompt, scenario, run_dir / "qwen-plan.json", requested_worker)
    worker_prompt = f'''{plan_value["task_prompt"]}

Read PRODUCT.md, AGENTS.md, and .agent-policy.json. Work only in this worktree.
Run relevant tests. Do not push, merge, deploy, or access paths outside it.
'''
    (run_dir / "worker-prompt.txt").write_text(worker_prompt)
    exit_code = run_worker(plan_value["worker"], worker_prompt, worktree, run_dir,
                           persona, personas[persona]["wawalu_token"],
                           runtime["WAWALU_INGEST_ENDPOINT"].rstrip("/"))
    metadata = {"run_id": run_id, "persona": persona, "scenario": scenario_id,
                "worker": plan_value["worker"], "branch": branch,
                "worktree": str(worktree), "exit_code": exit_code}
    (run_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    if exit_code: return exit_code
    run(["npm", "run", "check"], cwd=worktree)
    run([sys.executable, "-m", "runner.policy", "--base", "main"], cwd=worktree)
    run(["git", "add", "--intent-to-add", "--all"], cwd=worktree)
    diff = output(["git", "diff", "--no-ext-diff", "main"], cwd=worktree)
    review_value = review(persona_prompt, scenario, plan_value, diff,
                          "npm run check and agent policy passed",
                          run_dir / "qwen-review.json")
    (run_dir / "review.json").write_text(json.dumps(review_value, indent=2) + "\n")
    if not review_value["approved"]:
        metadata["review"] = "rejected"
        (run_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
        print(json.dumps(metadata, indent=2))
        return 3
    if diff:
        metadata["diff_budget_remaining"] = BUDGET.record({
            "run_id": run_id, "persona": persona, "scenario": scenario_id,
            "worker": plan_value["worker"],
            "recorded_at": dt.datetime.now(dt.UTC).isoformat(),
        })
        (run_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
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
             "--title", title, "--body", f"Synthetic team run: `{run_id}`\n\nMerging to protected `main` triggers production deployment automatically.{issue_line}"], cwd=worktree, env=pr_env)
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
    execute.add_argument("--worker", choices=["auto", *sorted(WORKERS)], default="auto")
    args = parser.parse_args()
    return command_status() if args.command == "status" else command_run(
        args.persona, args.scenario, args.push, args.worker)


if __name__ == "__main__":
    raise SystemExit(main())
