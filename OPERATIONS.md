# Operations and trust boundaries

## Repository

- GitHub: `AndrewLikesTea/wawalu-agent-lab`
- Agents push only `agent/<persona>/<task>` branches.
- `main` requires a PR, exact-head synthetic review, CI, resolved conversations,
  and blocks force pushes.
- The agent credential is never a ruleset bypass actor.

## Model and identity boundary

- Qwen runs locally and creates the implementation handoff and final review.
- Codex and Claude Code authenticate with the machine owner's provider account.
- Every worker receives only the selected persona's Wawalu ingest token.
- The ingest proxy derives identity from that token and overwrites client-sent
  identity, so provider account email is not used for Wawalu attribution.
- Claude runs without session persistence and with a per-run telemetry settings
  file. Codex uses a separate `CODEX_HOME` per persona.

## Deployment

- Cloudflare Pages project: `wawalu-agent-lab`
- Preview branches deploy automatically from pull requests.
- Every protected `main` update runs checks, deploys that exact commit to the
  production Pages branch, and smoke-tests `labs.wawalu.org`.
- A worker may request auto-merge only for its own current branch through the
  `.agent-delivery.json` capability. The runner validates and consumes the request
  before exchanging it for a short-lived GitHub App token.
- After independent Reviewer App approval, the runner honors that worker request.
  Required CI and branch protection remain the release gate; there is no separate
  deployment approval after merge.
- Worker processes cannot see reusable GitHub or Cloudflare credentials, bypass
  checks, target another PR, or invoke the production deployment themselves.

## Daily diff budget

- The local orchestrator allows 50 Qwen-approved, non-empty code diffs per UTC
  day across all personas.
- The ignored ledger lives under `.agent/budgets/` with mode `0600`.
- Failed workers, rejected reviews, and no-change runs do not consume budget.
- The runner checks availability before invoking a paid worker and records the
  diff atomically before committing or pushing it.

## Autonomous manager

- A per-user macOS LaunchAgent (`org.wawalu.agent-lab`) runs one manager loop.
- An advisory file lock prevents concurrent managers and workers run sequentially
  so the 30B Qwen model, Codex or Claude, Docker, and tests share laptop memory.
- `agent-ready` GitHub issues are the durable queue. A `persona:<role>` label
  assigns the worker; unassigned tasks fall back to the staff persona.
- When the queue is empty, Sam may generate one bounded issue from `PRODUCT.md`.
- Default operation is 08:00–18:00 Pacific time, at most one submitted PR per
  engineer in a rolling hour, two attempts per issue, and a 30-minute retry cooldown. Edit the ignored
  `.secrets/autonomy.json` to change those controls.
- State, private event history, logs, generated scenarios, and the stop file live
  under ignored `.agent/autonomy/`. Public issue comments expose safe lifecycle
  states to the Agent Observatory without publishing model transcripts.
- `python3 -m runner.autonomous directive "..."` stores one private, pending owner
  directive. Sam prioritizes it ahead of queued issues for the next generated
  task. A successful issue creation consumes it; failures leave it pending. The
  exact directive is not published, though the resulting issue is public.
- Sam decomposes a directive into 2–6 ordered issues, assigns each to a persona,
  and records explicit issue dependencies. Later work stays queued until its predecessor
  closes. Assignment considers recent utilization and role fit; plans with four or more
  tasks must use at least three engineers, without creating filler work. The 2,000-line
  bound applies per PR, not to the overall directive.
- When `consult_after_directive_mvp` is enabled and every initial directive issue is
  closed, Sam asks Codex or Claude once for read-only product and infrastructure
  follow-up ideas. Qwen converts one idea into a bounded queued issue; normal review,
  rate limits, and deployment controls still apply.
- Human-behavior probabilities live in protected `config/team-behaviors.json`.
  Distractions use read-only/no-tool CLI sessions; collaborators share only the task
  worktree; review debates are published as named PR comments and must resolve before
  Marcus submits the final approval.
- Before every task the manager fast-forwards local `main` from `origin/main`.
  Completed disposable worktrees are removed after each attempt.

## GitHub App

Register the app from `github-app-manifest.json`. Grant only repository
contents, issues, pull requests, and metadata access. Do not grant Actions,
administration, environments, secrets, or ruleset write access. Install it only
on this repository. The local orchestrator should mint short-lived installation
tokens; agents never receive the app private key.
The repository must have GitHub auto-merge enabled. The implementation App uses
its pull-request and contents permissions only to create the PR and request
auto-merge; it is not a ruleset bypass actor.

Register `github-reviewer-app-manifest.json` as a second App with only contents
read and pull-request review access. The implementation App authors PRs; the
Reviewer App approves Qwen-reviewed diffs, satisfying the protected-branch
review gate without using Andrew's identity. CI verifies that the App's approval
targets the exact current head SHA, so every new push requires a fresh review.

## Emergency stop

1. Stop the local orchestrator process.
   `python3 -m runner.autonomous stop` persists this stop across LaunchAgent restarts.
2. Suspend or uninstall the GitHub App from the repository.
3. Disable Pages preview builds or revoke the Cloudflare API token.
4. Revoke synthetic Wawalu ingest tokens.
