# Wawalu Agent Lab

An isolated production sandbox built by a synthetic software team. Local Qwen
personas plan and review work; authenticated Codex or Claude Code workers make
the changes. The first product is **Shiplog**, a lightweight
engineering decision and release log intended for `labs.wawalu.org`.

The planning and review layers use `qwen3-coder:30b`; workers run sequentially
to preserve memory for Docker, tests, and browser previews. Each worker uses the
persona's Wawalu ingest token, so Wawalu attribution is independent of the
OpenAI or Anthropic account used to authenticate the CLI.
The runner permits at most 50 Qwen-approved, non-empty code diffs per UTC day.
Failed, rejected, and no-change runs do not consume that budget.
The dedicated reviewer persona evaluates every proposed diff and a separate,
least-privilege GitHub App submits the required approval after it passes.

The repository is deliberately separate from the Wawalu product repository.
Agents work only in disposable worktrees, may push only `agent/*` branches, and
must use pull requests. A worker that considers its work ready explicitly requests
auto-merge for its own branch. After Qwen approves the exact diff, the independent
Reviewer App approves the exact PR head and the runner honors that capability.
GitHub waits for required CI and resolved conversations, then merges to `main`;
that protected-main push deploys production automatically and runs a smoke test.
Worker personas control whether their own PR enters auto-merge, but never receive
the reusable GitHub credential or direct Cloudflare deployment access.

## Local checks

```sh
npm ci
npm run check
python3 -m unittest discover -s runner/tests -v
```

## Agent runner

Persona tokens live in `.secrets/personas.json`; endpoints and identity mapping
live in `.secrets/runtime.env`. Both are ignored and never committed.

```sh
python3 -m runner.orchestrator status
python3 -m runner.orchestrator run backend scenarios/bootstrap.json --worker codex
python3 -m runner.orchestrator run frontend scenarios/bootstrap.json --worker claude
```

## Autonomous team

The autonomous manager uses labeled GitHub issues as its durable queue. When the
queue is empty, Sam uses local Qwen to propose one bounded task from `PRODUCT.md`,
creates an `agent-ready` issue, assigns a persona, and starts the normal runner.
Runs are sequential and limited by working hours. Each engineer may submit at
most one PR in a rolling 60-minute window; failed attempts do not consume that
slot. The existing 50 approved-diff budget remains in force.

```sh
mkdir -p .secrets
cp config/autonomy.example.json .secrets/autonomy.json
python3 scripts/manage_autonomy.py install
python3 -m runner.autonomous status
python3 -m runner.autonomous stop
python3 -m runner.autonomous resume
python3 -m runner.autonomous directive "Prioritize release history and JSON export"
python3 -m runner.autonomous directive
python3 -m runner.autonomous directive --clear
```

The macOS LaunchAgent restarts after failures and laptop login. A stopped team
remains stopped across restarts until `resume` removes the emergency-stop file.
A pending free-text directive takes priority over the ordinary issue queue for
Sam's next generated task. It is stored locally with private permissions and is
not copied verbatim into the public issue; the generated task is public.

See [OPERATIONS.md](OPERATIONS.md) for GitHub, Cloudflare, and release controls.
