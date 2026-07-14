import argparse
import base64
import datetime as dt
import json
import hashlib
import os
import pathlib
import re
import subprocess
import sys
import uuid

from runner.github_app import installation_token, reviewer_token
from runner.budget import DiffBudget
from runner.delivery import DELIVERY_REQUEST, consume_merge_request, enable_auto_merge
from runner.layers import plan, review, review_debate, run_aside, run_worker, WORKERS
from runner.simulation import choose_distraction, choose_peer_reviewer, happens, load_behaviors, personality_context

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
    behaviors = load_behaviors()
    profile = behaviors["personas"][persona]
    first_pass_tendency = happens(float(profile["error_proneness"]), "first-pass", persona, scenario_id)
    persona_prompt += "\n\n" + personality_context(profile, first_pass_tendency)
    plan_value = plan(persona_prompt, scenario, run_dir / "qwen-plan.json", requested_worker)
    worker_prompt = f'''{persona_prompt}

Your assigned implementation task:
{plan_value["task_prompt"]}

Read PRODUCT.md, AGENTS.md, and .agent-policy.json. Work only in this worktree.
Run relevant tests. Do not push directly, deploy, or access paths outside it.
If you judge your finished work ready to merge, request that capability by writing
exactly this JSON to {DELIVERY_REQUEST}:
{{"action":"auto_merge","branch":"{branch}","requested_by":"{persona}"}}
Do not invoke GitHub yourself and do not request delivery for another branch.
'''
    (run_dir / "worker-prompt.txt").write_text(worker_prompt)
    distraction = choose_distraction(persona, scenario_id, behaviors)
    if distraction:
        run_aside(plan_value["worker"], distraction, worktree, run_dir, persona,
                  personas[persona]["wawalu_token"], runtime["WAWALU_INGEST_ENDPOINT"].rstrip("/"))
    exit_code = run_worker(plan_value["worker"], worker_prompt, worktree, run_dir,
                           persona, personas[persona]["wawalu_token"],
                           runtime["WAWALU_INGEST_ENDPOINT"].rstrip("/"))
    collaborators = [item for item in scenario.get("collaborators", [])
                     if item in personas and item not in {persona, "manager", "reviewer"}]
    metadata = {"run_id": run_id, "persona": persona, "collaborators": collaborators[:1],
                "distraction": bool(distraction), "first_pass_tendency": first_pass_tendency,
                "scenario": scenario_id, "worker": plan_value["worker"], "branch": branch,
                "worktree": str(worktree), "exit_code": exit_code}
    (run_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    if exit_code:
        return exit_code
    for collaborator in collaborators[:1]:
        collaborator_profile = behaviors["personas"][collaborator]
        collaborator_prompt = (ROOT / personas[collaborator]["prompt_file"]).read_text()
        collaborator_prompt += "\n\n" + personality_context(collaborator_profile, False)
        pairing_prompt = f"""{collaborator_prompt}

You are joining {profile['name']}'s existing pull-request worktree as a second engineer.
Review the current implementation against this scenario and make concrete improvements
where your expertise or opinions differ. Preserve sound work, do not merely restyle it,
and run relevant tests. Do not create or remove the delivery request.

Scenario: {json.dumps(scenario, indent=2)}
"""
        collaborator_worker = "claude" if plan_value["worker"] == "codex" else "codex"
        collaborator_exit = run_worker(
            collaborator_worker, pairing_prompt, worktree, run_dir, collaborator,
            personas[collaborator]["wawalu_token"], runtime["WAWALU_INGEST_ENDPOINT"].rstrip("/"),
            log_label=f"collaborator-{collaborator}")
        if collaborator_exit:
            metadata["collaborator_exit_code"] = collaborator_exit
            (run_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
            return collaborator_exit
    merge_requested = consume_merge_request(worktree, persona, branch)
    metadata["worker_requested_auto_merge"] = merge_requested
    (run_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    run(["npm", "run", "check"], cwd=worktree)
    run([sys.executable, "-m", "runner.policy", "--base", "main"], cwd=worktree)
    run(["git", "add", "--intent-to-add", "--all"], cwd=worktree)
    diff = output(["git", "diff", "--no-ext-diff", "main"], cwd=worktree)
    reviewed_diff_sha256 = hashlib.sha256(diff.encode()).hexdigest()
    reviewer_prompt = (ROOT / personas["reviewer"]["prompt_file"]).read_text()
    review_value = review(reviewer_prompt, scenario, plan_value, diff,
                          "npm run check and agent policy passed",
                          run_dir / "qwen-review.json")
    (run_dir / "review.json").write_text(json.dumps(review_value, indent=2) + "\n")
    if not review_value["approved"]:
        metadata["review"] = "rejected"
        (run_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
        print(json.dumps(metadata, indent=2))
        return 3
    debate_value = None
    debate_cast = [persona, *collaborators[:1]]
    if len(debate_cast) > 1 or happens(float(profile["debate_rate"]), "debate", persona, scenario_id):
        prompts = {behaviors["personas"][member]["name"]:
                   (ROOT / personas[member]["prompt_file"]).read_text() + "\n" + behaviors["personas"][member]["work_style"]
                   for member in debate_cast}
        prompts["Marcus"] = reviewer_prompt
        debate_value = review_debate(prompts, scenario, diff, run_dir / "qwen-review-debate.json")
        metadata["review_debate"] = debate_value
    remaining = BUDGET.record_if_changed({
            "run_id": run_id, "persona": persona, "scenario": scenario_id,
            "worker": plan_value["worker"],
            "recorded_at": dt.datetime.now(dt.UTC).isoformat(),
        }, diff)
    if remaining is not None:
        metadata["diff_budget_remaining"] = remaining
        metadata["reviewed_diff_sha256"] = reviewed_diff_sha256
        (run_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    if output(["git", "status", "--porcelain"], cwd=worktree):
        run(["git", "add", "--all"], cwd=worktree)
        run(["git", "commit", "-m", f"Agent: {scenario.get('title', scenario_id)}"], cwd=worktree)
    committed_diff = output(["git", "diff", "--no-ext-diff", "main"], cwd=worktree)
    if hashlib.sha256(committed_diff.encode()).hexdigest() != reviewed_diff_sha256:
        raise RuntimeError("committed diff does not match the reviewer-approved diff")
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
        team_line = ("\n\nPaired with: " + ", ".join(behaviors["personas"][member]["name"] for member in collaborators[:1])
                     if collaborators else "")
        run(["gh", "pr", "create", "--repo", "AndrewLikesTea/wawalu-agent-lab",
             "--base", "main", "--head", branch,
             "--title", title, "--body", f"Synthetic team run: `{run_id}`{team_line}\n\nMerging to protected `main` triggers production deployment automatically.{issue_line}"], cwd=worktree, env=pr_env)
        peer = choose_peer_reviewer(persona, scenario_id)
        peer_name = behaviors["personas"][peer]["name"]
        focus = {
            "frontend": "interaction states, keyboard access, and visible error handling",
            "backend": "data contracts, edge cases, and test coverage",
            "infrastructure": "operational safety, reversibility, and hidden coupling",
            "staff": "scope boundaries, integration seams, and long-term maintainability",
        }[peer]
        peer_body = ("<!-- wawalu-peer-review -->\n"
                     f"**{peer_name} · peer review**\n\n"
                     f"I reviewed this change before Marcus’s final gate, focusing on {focus}. "
                     "The implementation is bounded to the issue and its automated checks are part of the final review.")
        run(["gh", "pr", "comment", branch, "--repo", "AndrewLikesTea/wawalu-agent-lab", "--body", peer_body],
            cwd=worktree, env=pr_env)
        metadata["peer_reviewer"] = peer
        if debate_value:
            for message in debate_value.get("messages", []):
                body = ("<!-- wawalu-review-debate -->\n"
                        f"**{message.get('speaker', 'Engineer')}**\n\n{message.get('body', '')}")
                run(["gh", "pr", "comment", branch, "--repo", "AndrewLikesTea/wawalu-agent-lab", "--body", body],
                    cwd=worktree, env=pr_env)
            run(["gh", "pr", "comment", branch, "--repo", "AndrewLikesTea/wawalu-agent-lab", "--body",
                 f"<!-- wawalu-review-debate -->\n**Resolution**\n\n{debate_value.get('resolution', '')}"],
                cwd=worktree, env=pr_env)
        review_env = os.environ.copy(); review_env["GH_TOKEN"] = reviewer_token()
        run(["gh", "pr", "review", branch, "--repo", "AndrewLikesTea/wawalu-agent-lab",
             "--approve", "--body", f"Approved by the synthetic reviewer persona. Qwen review: {review_value['summary']}"],
            cwd=worktree, env=review_env)
        if merge_requested:
            enable_auto_merge("AndrewLikesTea/wawalu-agent-lab", branch, github_token, worktree)
            metadata["delivery"] = "worker-requested auto-merge; protected main deploys after required checks"
        else:
            metadata["delivery"] = "pull request open; worker did not request auto-merge"
        (run_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
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
