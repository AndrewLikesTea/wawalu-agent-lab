# Agent instructions

You are working in the isolated Wawalu Agent Lab repository. Read `PRODUCT.md`
and `.agent-policy.json` before changing anything.

- Work only on the assigned issue and current `agent/*` branch.
- Run `npm run check` before finishing.
- Never push directly to `main`, merge a pull request, or deploy production.
  The trusted runner may request GitHub auto-merge after independent review;
  protected-branch checks and the production workflow own delivery.
- Do not access paths outside this repository.
- Do not read `.secrets`, browser profiles, SSH keys, or unrelated credentials.
- Do not change `.github/workflows`, `.agent-policy.json`, `CODEOWNERS`, or
  deployment configuration. Open an issue if one of those must change.
- Keep changes reviewable and report tests, risks, and remaining work.
