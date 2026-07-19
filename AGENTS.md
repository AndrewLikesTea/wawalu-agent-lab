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
- Do not change `.github/workflows`, `.agent-policy.json`, `CODEOWNERS`, or
  deployment configuration. Open an issue if one of those must change.
- You may create and migrate local SQLite databases only through
  `python3 -m runner.local_database`. Database names must use the
  `wawalu-agent-lab-` prefix, files remain under the ignored worktree-local
  database directory, and migrations must come from `migrations/`. Do not run
  `sqlite3`, `wrangler d1`, remote database commands, destructive SQL, or access
  database files directly. This capability is for local development and tests;
  it grants no production database or deployment access.
- Keep changes reviewable and report tests, risks, and remaining work.
