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

### Build integrity, health, and rollback

- `npm run build` copies the static source into an isolated staging directory,
  writes a deterministic `build-manifest.json` with the byte length and SHA-256
  digest of every shipped file, and validates the artifact before promoting it
  to `dist/`. A failed build leaves no partially promoted artifact.
- `npm run verify:build` revalidates every digest, the exact `healthz` response,
  the social post-management assets, and the least-privilege browser policy.
  CI remains the only deployment authority; these checks require no credentials.
- Releases are immutable commit artifacts. To roll back, use the established
  protected release process to redeploy the last known-good commit artifact,
  verify its manifest, then smoke-test `/healthz`. Do not edit an artifact in
  place or bypass branch protection. Browser-local social posts use the existing
  storage schema, so reverting the UI does not migrate or delete user data.

## Daily diff budget

- The local orchestrator allows 50 Qwen-approved, non-empty code diffs per UTC
  day across all personas.
- The ignored ledger lives under `.agent/budgets/` with mode `0600`.
- Failed workers, rejected reviews, and no-change runs do not consume budget.
- The runner checks availability before invoking a paid worker and records the
  diff atomically before committing or pushing it.

## Autonomous manager

- A per-user macOS LaunchAgent (`org.wawalu.agent-lab`) runs one manager loop.
- The installed service is wrapped in macOS `caffeinate`, keeping an AC-powered,
  logged-in laptop awake while the manager runs. Launchd restarts unexpected exits.
- An advisory file lock prevents concurrent managers and workers run sequentially
  so the 30B Qwen model, Codex or Claude, Docker, and tests share laptop memory.
- `agent-ready` GitHub issues are the durable queue. A `persona:<role>` label
  assigns the worker; unassigned tasks fall back to the staff persona.
- When the queue is empty, Sam may generate one bounded issue from `PRODUCT.md`.
- Default operation is 08:00–18:00 Pacific time, at most one submitted PR per
  engineer in a rolling hour, two attempts per issue, and a 30-minute retry cooldown. Edit the ignored
  `.secrets/autonomy.json` to change those controls.
- A worker is terminated and retried if it exceeds `worker_timeout_seconds` (three
  hours by default), preventing a wedged Codex, Claude, test, or network subprocess
  from blocking the manager for the rest of the week.
- Provider rate/session limits are treated separately from implementation failures:
  the issue keeps its attempt budget, switches between Codex and Claude, and backs off
  from 15 minutes up to five hours if capacity remains unavailable. Other ready work can
  continue while that issue waits.
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
- When `consult_after_directive_mvp` is enabled and every issue in the directive's
  latest program is closed, Sam asks Codex or Claude for one read-only, high-level
  product or infrastructure idea. Because the consultant sandbox has no network
  access, the runner first saves a snapshot of every deployed page from
  `labs.wawalu.org` (`WAWALU_LABS_URL` overrides) into the consultation run
  directory, and the prompt directs the consultant to ground its recommendation in
  that live-site snapshot as well as the source; snapshot content is treated as
  untrusted page data. Qwen decomposes that untrusted idea into a new
  ordered 2-6 issue program with the same assignment and dependency rules as the
  initial directive; normal review, rate limits, and deployment controls still apply.
  Completing that program triggers the next consultation round. Consultation rounds
  and their issues are recorded in the private directive file, so an interrupted round
  resumes without repeating the paid consultation. `max_consultation_rounds` bounds
  the rounds per directive; 0 or unset means the cycle continues until the owner
  clears or replaces the directive.
- Human-behavior probabilities live in protected `config/team-behaviors.json`.
  Distractions use read-only/no-tool CLI sessions; collaborators share only the task
  worktree; review debates are published as named PR comments and must resolve before
  Marcus submits the final approval.
- Before every task the manager fast-forwards local `main` from `origin/main`.
  Completed disposable worktrees are removed after each attempt.
- With `review_owner_prs` enabled, every tick Marcus (the Qwen reviewer persona)
  reviews open pull requests that are authored by the repository owner, or that
  previously carried a synthetic-team approval whose head has since moved. On a
  genuine approval the Reviewer App approves the exact head SHA, satisfying the CI
  gate; owner PRs additionally get GitHub auto-merge enabled when
  `auto_merge_owner_prs` is set, so required CI remains the release gate. A
  rejection posts Marcus's feedback as a PR comment instead. Each head SHA is
  reviewed at most once (tracked in local state); a new push triggers a fresh
  review. `python3 -m runner.autonomous review-prs` runs one sweep on demand.
- With `update_stuck_prs` enabled, the same sweep unsticks eligible pull requests
  that are approved at their current head with auto-merge enabled but whose branch
  fell behind protected `main`: it calls the GitHub update-branch API pinned to the
  expected head SHA. If the update dismisses or stales the approval, the next sweep
  re-reviews the new head. Each head SHA is attempted at most once.
- A conflicted pull request cannot be updated mechanically. With
  `requeue_conflicted_prs` enabled, a conflicted `agent/*` pull request is closed,
  its branch deleted, and its issue relabeled `agent-ready` for a fresh
  implementation on current `main` through the normal plan, review, and delivery
  pipeline; the issue's attempt count is preserved, so `max_attempts` still bounds
  repeated failures. An issue that already used its attempt budget is marked
  `agent-blocked` for human attention instead of re-entering the queue. Conflicted
  owner pull requests only receive one merge-conflict comment per head and are left
  for a manual rebase.
- The CI approval gate polls for the exact-head synthetic approval for up to
  `APPROVAL_WAIT_SECONDS` (900 in CI) instead of failing immediately, so a pull
  request opened moments before the sweep reviews it passes without a manual rerun.
- Sweeps take an advisory lock (`.agent/autonomy/sweep.lock`) so the daemon and a
  manual `review-prs` never review the same pull request concurrently, the daemon
  reloads its state file every tick, sweep records for closed pull requests are
  pruned, and a sweep failure is journaled without aborting the rest of the tick.
  Set `review_prs_after_hours` to also run the review sweep outside working hours;
  paid worker runs remain bounded by the working-hours window either way.
- If a consultation worker fails twice in a row, the round switches to the other
  CLI (Codex ↔ Claude) before retrying.

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
