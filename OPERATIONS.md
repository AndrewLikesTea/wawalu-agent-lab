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
2. Suspend or uninstall the GitHub App from the repository.
3. Disable Pages preview builds or revoke the Cloudflare API token.
4. Revoke synthetic Wawalu ingest tokens.
