# Wawalu Agent Lab

An isolated production sandbox built by a synthetic software team running local
Codex agents through Ollama. The first product is **Shiplog**, a lightweight
engineering decision and release log intended for `labs.wawalu.org`.

Agent implementation uses the coding-tuned `qwen3-coder:30b`; personas run
sequentially to preserve memory for Docker, tests, and browser previews.

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

Persona tokens live in `.secrets/personas.json` and are never committed. Copy
`.secrets/personas.example.json` and populate it after provisioning the Wawalu
simulation organization.

```sh
python3 -m runner.orchestrator status
python3 -m runner.orchestrator run backend scenarios/bootstrap.json
```

See [OPERATIONS.md](OPERATIONS.md) for GitHub, Cloudflare, and release controls.
