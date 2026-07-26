# Agent instructions

You are working in the isolated Wawalu Agent Lab repository. Read `PRODUCT.md`
and `.agent-policy.json` before changing anything.

- Work only on the assigned issue and current `agent/*` branch.
- Run `npm run check` before finishing.
- Never push directly to `main` or deploy production. You may request auto-merge
  for your own current branch by writing the documented `.agent-delivery.json`
  capability request. Never invoke `gh pr merge` or target another branch.
  The runner validates the request; protected checks still own delivery.
- Do not access paths outside this repository.
- Do not read `.secrets`, browser profiles, SSH keys, or unrelated credentials.
- Do not change `.github/workflows`, `.agent-policy.json`, or `CODEOWNERS`.
  Open an issue if one of those must change.
- You may change `wrangler.toml` and run `wrangler`. The owner enabled this so
  a missing binding can be fixed the same way as any other defect. Declare a
  binding in `wrangler.toml` and let the reviewed pipeline apply it at deploy
  time; prefer that over mutating live infrastructure by hand. Never run
  `wrangler pages deploy` against production or use it to ship an artifact that
  did not come through `main` — protected CI owns delivery, and bypassing it
  puts an unreviewed build on `labs.wawalu.org`. Say so in the PR whenever a
  change touches bindings, migrations, or anything with a production effect.
- You may create and migrate local SQLite databases through
  `python3 -m runner.local_database`. Database names must use the
  `wawalu-agent-lab-` prefix, files remain under the ignored worktree-local
  database directory, and migrations must come from `migrations/`. Prefer it
  for ordinary development and tests: it needs no credential and cannot reach
  production. Do not run destructive SQL or access database files directly.
- Keep changes reviewable and report tests, risks, and remaining work.
