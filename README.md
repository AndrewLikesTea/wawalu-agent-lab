# Wawalu Agent Lab

An isolated production sandbox built by a synthetic software team. Local Qwen
personas plan and review work; authenticated Codex or Claude Code workers make
the changes. The first product is **Shiplog**, a lightweight
engineering decision and release log intended for `labs.wawalu.org`.

The planning and review layers use `qwen3-coder:30b`; workers run sequentially
to preserve memory for Docker, tests, and browser previews. Each worker uses the
persona's Wawalu ingest token, so Wawalu attribution is independent of the
OpenAI or Anthropic account used to authenticate the CLI.

The repository is deliberately separate from the Wawalu product repository.
Agents work only in disposable worktrees, may push only `agent/*` branches, and
must use pull requests. Production deployment requires Andrew's approval through
the protected GitHub `production` environment.

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

See [OPERATIONS.md](OPERATIONS.md) for GitHub, Cloudflare, and release controls.
