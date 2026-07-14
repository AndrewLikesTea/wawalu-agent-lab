# Operations and trust boundaries

## Repository

- GitHub: `AndrewLikesTea/wawalu-agent-lab` (private)
- Agents push only `agent/<persona>/<task>` branches.
- `main` requires a PR, CI, code-owner review, and blocks force pushes.
- The agent credential is never a ruleset bypass actor.

## Deployment

- Cloudflare Pages project: `wawalu-agent-lab`
- Preview branches deploy automatically from pull requests.
- Production is a manually dispatched workflow referencing an exact `main`
  commit and the GitHub `production` environment.
- Andrew is the required production reviewer. Environment secrets are not
  released until approval.

## GitHub App

Register the app from `github-app-manifest.json`. Grant only repository
contents, issues, pull requests, and metadata access. Do not grant Actions,
administration, environments, secrets, or ruleset write access. Install it only
on this repository. The local orchestrator should mint short-lived installation
tokens; agents never receive the app private key.

## Emergency stop

1. Stop the local orchestrator process.
2. Suspend or uninstall the GitHub App from the repository.
3. Disable Pages preview builds or revoke the Cloudflare API token.
4. Revoke synthetic Wawalu ingest tokens.

