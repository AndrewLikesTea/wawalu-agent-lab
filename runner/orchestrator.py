import argparse
import base64
import contextlib
import datetime as dt
import fcntl
import json
import hashlib
import os
import pathlib
import re
import shutil
import subprocess
import sys
import uuid

from runner.github_app import installation_token, reviewer_token
from runner.budget import DiffBudget, DiffBudgetExhausted
from runner.delivery import DELIVERY_REQUEST, consume_merge_request, enable_auto_merge
from runner.layers import CAPACITY_EXIT_CODES, plan, review, review_debate, run_aside, run_worker, WORKERS
from runner.simulation import (choose_distraction, choose_peer_reviewer, happens, load_behaviors,
                               personality_context, retry_salt)

ROOT = pathlib.Path(__file__).resolve().parents[1]
AGENT_DIR = ROOT / ".agent"
SECRETS = ROOT / ".secrets" / "personas.json"
RUNTIME_ENV = ROOT / ".secrets" / "runtime.env"
BUDGET = DiffBudget(ROOT)
# Distinct from the capacity codes in layers.CAPACITY_EXIT_CODES (75/76).
DIFF_BUDGET_EXIT_CODE = 77


CHECKOUT_LOCK = AGENT_DIR / "autonomy" / "checkout.lock"


@contextlib.contextmanager
def checkout_lock(path: pathlib.Path = CHECKOUT_LOCK):
    """Serialize the git commands that write the shared product checkout.

    Each run works inside its own worktree, but creating, reclaiming, and removing a
    worktree — and fast-forwarding main — all write the one `.git` directory they
    share. With runs in flight at the same time, and in separate processes, that is a
    real race on worktree metadata and ref locks, so those commands take this file
    lock. Only the git calls do: the long work inside a worktree must never hold it.
    """
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open("a+", encoding="utf-8") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def run(command: list[str], cwd: pathlib.Path = ROOT, **kwargs):
    return subprocess.run(command, cwd=cwd, check=True, text=True, **kwargs)


def output(command: list[str], cwd: pathlib.Path = ROOT, **kwargs) -> str:
    return subprocess.check_output(command, cwd=cwd, text=True, **kwargs).strip()


def push_branch(branch: str, worktree: pathlib.Path, env: dict[str, str]) -> None:
    """Push the run's branch, replacing whatever an earlier attempt left behind.

    Branch names come from persona and issue, so a retried issue pushes the same name
    twice and the second push is rejected as non-fast-forward — throwing away a whole
    paid worker session at its very last step. The branch is this run's alone and holds
    exactly the diff the reviewer just approved, so replacing a stale tip is the right
    move; the lease is read first so a ref that moved after we looked still wins.
    """
    attempt = subprocess.run(["git", "push", "--set-upstream", "origin", branch],
                             cwd=worktree, env=env, text=True)
    if not attempt.returncode:
        return
    stale = output(["git", "ls-remote", "origin", f"refs/heads/{branch}"], cwd=worktree, env=env)
    if not stale:
        raise RuntimeError(f"pushing {branch} failed and no remote branch explains it")
    run(["git", "push", f"--force-with-lease={branch}:{stale.split()[0]}",
         "--set-upstream", "origin", branch], cwd=worktree, env=env)


def create_pull_request(command: list[str], branch: str, worktree: pathlib.Path,
                        env: dict[str, str]) -> None:
    """Open the pull request, tolerating one an earlier attempt already opened.

    A retry that force-pushed its branch has already updated that open PR with the new
    work, so `gh pr create` refusing a duplicate head is success, not failure.
    """
    attempt = subprocess.run(command, cwd=worktree, env=env, text=True)
    if not attempt.returncode:
        return
    existing = output(["gh", "pr", "list", "--repo", REPOSITORY, "--head", branch,
                       "--state", "open", "--json", "number", "--jq", ".[].number"],
                      cwd=worktree, env=env)
    if not existing:
        raise RuntimeError(f"opening a pull request for {branch} failed and none is open")
    print(f"reusing open pull request #{existing.splitlines()[0]} for {branch}")


def collaborator_capacity_deferred(exit_code: int) -> bool:
    """Capacity exit codes are stable internal signals from runner.layers, not provider API codes."""
    return bool(CAPACITY_EXIT_CODES) and exit_code in CAPACITY_EXIT_CODES.values()


def record_collaborator_exit(metadata: dict, exit_code: int) -> bool:
    """Record an optional collaborator result and report whether primary work may continue."""
    metadata["collaborator_exit_code"] = exit_code
    deferred = collaborator_capacity_deferred(exit_code)
    if deferred:
        metadata["collaborator_capacity_deferred"] = True
    return deferred


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


# The product under iteration may be a separate pre-existing repository (a
# company's existing codebase, e.g. paint-lab). The lab repo stays the home of
# the runner, personas, and charter; the product repo/checkout is configured in
# runtime.env and defaults to the historical self-hosted arrangement.
DEFAULT_REPOSITORY = "AndrewLikesTea/wawalu-agent-lab"


def _runtime_or_empty() -> dict[str, str]:
    try:
        return load_runtime_env()
    except SystemExit:  # tests / CI without .secrets
        return {}


_RUNTIME = _runtime_or_empty()
REPOSITORY = _RUNTIME.get("WAWALU_PRODUCT_REPOSITORY", DEFAULT_REPOSITORY)
PRODUCT_ROOT = pathlib.Path(_RUNTIME.get("WAWALU_PRODUCT_ROOT", str(ROOT)))


def product_check_command(worktree: pathlib.Path) -> list[str] | None:
    """The product repo's own gate, if it defines one (Shiplog had `npm run
    check`; external products like paint-lab may not)."""
    package_json = worktree / "package.json"
    if package_json.exists():
        scripts = json.loads(package_json.read_text()).get("scripts", {})
        if "check" in scripts:
            return ["npm", "run", "check"]
    return None


def discard_generated_artifacts(worktree: pathlib.Path) -> list[str]:
    """Drop test-run exhaust so review and policy see the change, not its debris.

    One Cypress visual run leaves dozens of failure screenshots behind. They are
    not the engineer's work, but they counted against the file-count policy, so a
    finished run could die at the last gate over its own test output.
    """
    prefixes = [str(prefix) for prefix in
                json.loads((ROOT / ".agent-policy.json").read_text()).get("generated_artifact_paths", [])
                if str(prefix).strip()]
    if not prefixes:
        return []
    discarded = output(["git", "status", "--porcelain", "--", *prefixes], cwd=worktree).splitlines()
    if not discarded:
        return []
    run(["git", "clean", "-fdq", "--", *prefixes], cwd=worktree)
    modified = [name for name in
                output(["git", "diff", "--name-only", "-z", "HEAD", "--", *prefixes],
                       cwd=worktree).split("\0") if name]
    if modified:
        run(["git", "checkout", "HEAD", "--", *modified], cwd=worktree)
    print(f"discarded {len(discarded)} generated test artifact(s)")
    return discarded


def reclaim_worktree(worktree: pathlib.Path, branch: str) -> None:
    """Clear a worktree a dead run left behind, so a retry is not blocked by its own wreckage.

    Worktrees are named for the persona and scenario, and the manager never runs two
    issues for one persona at once, so a worktree already sitting at this path is
    always debris rather than a peer's live workspace. Leaving it would make every
    retry fail instantly and burn the issue's remaining attempts.
    """
    print(f"reclaiming stale worktree: {worktree}", file=sys.stderr)
    subprocess.run(["git", "worktree", "remove", "--force", str(worktree)],
                   cwd=PRODUCT_ROOT, check=False)
    shutil.rmtree(worktree, ignore_errors=True)
    subprocess.run(["git", "worktree", "prune"], cwd=PRODUCT_ROOT, check=False)
    subprocess.run(["git", "branch", "--delete", "--force", branch],
                   cwd=PRODUCT_ROOT, check=False, capture_output=True)


def prepare_worktree(persona: str, scenario_id: str) -> tuple[pathlib.Path, str, str]:
    branch = f"agent/{persona}/{scenario_id}"
    worktree = AGENT_DIR / "worktrees" / f"{persona}-{scenario_id}"
    with checkout_lock():
        if worktree.exists():
            reclaim_worktree(worktree, branch)
        # worktrees branch off the PRODUCT checkout, wherever it lives
        run(["git", "worktree", "add", "-b", branch, str(worktree), "main"], cwd=PRODUCT_ROOT)
        # Pin the commit we branched from. `main` is a moving target: sibling
        # runs and the merge sweep advance it mid-run, and a run that diffs
        # against the name instead of the commit sees other people's merged
        # work reversed into its own diff.
        base_sha = output(["git", "rev-parse", "HEAD"], cwd=worktree).strip()
    install_product_dependencies(worktree)
    return worktree, branch, base_sha


def install_product_dependencies(worktree: pathlib.Path) -> None:
    """Workers must be able to run the product's own linters and tests, so a
    JS product worktree needs node_modules before the worker starts. Best
    effort: a failed install shouldn't kill the run before the worker exists."""
    if not (worktree / "package.json").exists():
        return
    lockfile = worktree / "package-lock.json"
    command = ["npm", "ci"] if lockfile.exists() else ["npm", "install"]
    try:
        run(command, cwd=worktree, capture_output=True)
    except subprocess.CalledProcessError as error:
        print(f"dependency install failed ({' '.join(command)}): "
              f"{(error.stderr or '')[-500:]}", file=sys.stderr)


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
    try:
        BUDGET.ensure_available()
    except DiffBudgetExhausted as error:
        # Dedicated exit code: the daemon defers instead of burning an attempt.
        print(str(error), file=sys.stderr)
        return DIFF_BUDGET_EXIT_CODE
    personas = load_personas()
    runtime = load_runtime_env()
    if persona not in personas: raise SystemExit(f"unknown persona: {persona}")
    scenario = json.loads((ROOT / scenario_path).read_text())
    scenario_id = safe_slug(scenario["id"])
    worktree, branch, base_sha = prepare_worktree(persona, scenario_id)
    run_id = f"sim_{dt.datetime.now(dt.UTC).strftime('%Y%m%dT%H%M%SZ')}_{uuid.uuid4().hex[:8]}"
    run_dir = AGENT_DIR / "runs" / run_id
    run_dir.mkdir(parents=True)
    persona_prompt = (ROOT / personas[persona]["prompt_file"]).read_text()
    behaviors = load_behaviors()
    profile = behaviors["personas"][persona]
    # The daemon stamps this run's attempt number so a retry re-rolls the simulated
    # behavior instead of reproducing the draw the reviewer just rejected.
    attempt = int(scenario.get("attempt", 1))
    salt = retry_salt(attempt)
    first_pass_tendency = happens(float(profile["error_proneness"]), "first-pass", persona, scenario_id, *salt)
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
    distraction = choose_distraction(persona, scenario_id, behaviors, attempt)
    if distraction:
        run_aside(plan_value["worker"], distraction, worktree, run_dir, persona,
                  personas[persona]["wawalu_token"], runtime["WAWALU_INGEST_ENDPOINT"].rstrip("/"))
    exit_code = run_worker(plan_value["worker"], worker_prompt, worktree, run_dir,
                           persona, personas[persona]["wawalu_token"],
                           runtime["WAWALU_INGEST_ENDPOINT"].rstrip("/"))
    collaborators = [item for item in scenario.get("collaborators", [])
                     if item in personas and item not in {persona, "manager", "reviewer"}]
    metadata = {"run_id": run_id, "persona": persona, "collaborators": collaborators[:1],
                "attempt": attempt,
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
            deferred = record_collaborator_exit(metadata, collaborator_exit)
            (run_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
            if deferred:
                continue
            return collaborator_exit
    merge_requested = consume_merge_request(worktree, persona, branch)
    metadata["worker_requested_auto_merge"] = merge_requested
    (run_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    check_command = product_check_command(worktree)
    if check_command:
        run(check_command, cwd=worktree)
        gates_passed = "npm run check and agent policy passed"
    else:
        gates_passed = "agent policy passed (product repo defines no check script)"
    discard_generated_artifacts(worktree)
    # The gate has to see new files too. Staging intent first means an oversized
    # change fails here, in seconds, instead of after the reviewer has spent an
    # hour on work the final policy check was always going to throw away.
    run(["git", "add", "--intent-to-add", "--all"], cwd=worktree)
    run([sys.executable, "-m", "runner.policy", "--base", base_sha, "--repo", str(worktree)])
    diff = output(["git", "diff", "--no-ext-diff", base_sha], cwd=worktree)
    reviewed_diff_sha256 = hashlib.sha256(diff.encode()).hexdigest()
    reviewer_prompt = (ROOT / personas["reviewer"]["prompt_file"]).read_text()
    review_value = review(reviewer_prompt, scenario, plan_value, diff,
                          gates_passed,
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
    committed_diff = output(["git", "diff", "--no-ext-diff", base_sha], cwd=worktree)
    if hashlib.sha256(committed_diff.encode()).hexdigest() != reviewed_diff_sha256:
        raise RuntimeError("committed diff does not match the reviewer-approved diff")
    run([sys.executable, "-m", "runner.policy", "--base", base_sha, "--repo", str(worktree)])
    if push:
        github_token = installation_token()
        auth = base64.b64encode(f"x-access-token:{github_token}".encode()).decode()
        push_env = os.environ.copy()
        push_env.update({"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "http.https://github.com/.extraheader",
                         "GIT_CONFIG_VALUE_0": "AUTHORIZATION: basic " + auth})
        push_branch(branch, worktree, push_env)
        title = scenario.get("title", scenario["outcome"].splitlines()[0])[:100]
        pr_env = os.environ.copy(); pr_env["GH_TOKEN"] = github_token
        issue_line = f"\n\nCloses #{scenario['issue']}" if scenario.get("issue") else ""
        team_line = ("\n\nPaired with: " + ", ".join(behaviors["personas"][member]["name"] for member in collaborators[:1])
                     if collaborators else "")
        create_pull_request(["gh", "pr", "create", "--repo", REPOSITORY,
             "--base", "main", "--head", branch,
             "--title", title, "--body", f"Synthetic team run: `{run_id}`{team_line}\n\nMerging to protected `main` triggers production deployment automatically.{issue_line}"],
             branch, worktree, pr_env)
        peer = choose_peer_reviewer(persona, scenario_id)
        peer_name = behaviors["personas"][peer]["name"]
        focus = {
            "frontend": "interaction states, keyboard access, and visible error handling",
            "backend": "data contracts, edge cases, and test coverage",
            "infrastructure": "operational safety, reversibility, and hidden coupling",
            "staff": "scope boundaries, integration seams, and long-term maintainability",
            "product": "whether the change answers the question it claims to, and what it leaves ambiguous",
            "design": "hierarchy, legibility, drawn states, and meaning that rests on color alone",
            "evaluation": "reproducibility of any score, stated assumptions, and fixture coverage",
            "integrations": "schema contracts, versioning, and behavior on partial or malformed data",
            "copywriter": "clarity, tone, and consistency of user-facing wording, and that changed strings render where intended",
            "graphics": "rendering correctness, canvas performance, and pixel fidelity across devices and DPIs",
            "fullstack": "end-to-end coherence from UI to storage, and the seams between layers",
            "qa": "regression risk, coverage of the changed behavior, and flake resistance",
            "security": "input handling, injection surfaces, abuse resistance, and least privilege",
            "platform": "build and deploy safety, binding configuration, and rollback paths",
        # A peer whose discipline is not listed still gets a review; falling back
        # beats a KeyError that would abort an otherwise finished run.
        }.get(peer, "correctness, tests, and whether the change matches its stated scope")
        peer_body = ("<!-- wawalu-peer-review -->\n"
                     f"**{peer_name} · peer review**\n\n"
                     f"I reviewed this change before Marcus’s final gate, focusing on {focus}. "
                     "The implementation is bounded to the issue and its automated checks are part of the final review.")
        run(["gh", "pr", "comment", branch, "--repo", REPOSITORY, "--body", peer_body],
            cwd=worktree, env=pr_env)
        metadata["peer_reviewer"] = peer
        if debate_value:
            for message in debate_value.get("messages", []):
                body = ("<!-- wawalu-review-debate -->\n"
                        f"**{message.get('speaker', 'Engineer')}**\n\n{message.get('body', '')}")
                run(["gh", "pr", "comment", branch, "--repo", REPOSITORY, "--body", body],
                    cwd=worktree, env=pr_env)
            run(["gh", "pr", "comment", branch, "--repo", REPOSITORY, "--body",
                 f"<!-- wawalu-review-debate -->\n**Resolution**\n\n{debate_value.get('resolution', '')}"],
                cwd=worktree, env=pr_env)
        review_env = os.environ.copy(); review_env["GH_TOKEN"] = reviewer_token()
        run(["gh", "pr", "review", branch, "--repo", REPOSITORY,
             "--approve", "--body", f"Approved by the synthetic reviewer persona. Qwen review: {review_value['summary']}"],
            cwd=worktree, env=review_env)
        if merge_requested:
            enable_auto_merge(REPOSITORY, branch, github_token, worktree)
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
