# Issue 3035: completed browser demo evidence

The homepage now shows completion evidence only after the evaluator opens the
recorded release detail page with its linked local decision. A versioned snapshot
must match the current records exactly. Missing, changed, unlinked, duplicate-id
shadowed, malformed, or example-only records cannot supply completion evidence.
Existing pilot, demonstration, brief and scorecard actions remain immediately after
that evidence.

The rendered statement, exact reopen links and plain-text copy share one model.
The copy omits the reopen links: its reader has no access to this browser's
records, so it states the linked pair, what opening the release showed, and the
demo boundary instead.
Copy success is announced without moving focus. A refused or unavailable clipboard
exposes a labeled, focused manual-copy field. Removing evidence while focus is in
it returns focus to the workflow heading. Storage changes and page restoration
refresh the gate; copying also rechecks storage. Workspace erasure removes the
saved detail visit along with the records.

Validation:

- 92 focused tests passed across demo progress, release guide, demo routes,
  buyer intent and workspace behavior.
- `npm run check` exited 0: 7,721 tests passed, five skipped, one pre-existing TODO;
  production build, artifact verification and payload size budgets passed;
  production tests: 50 passed and the same pre-existing TODO.
- The existing TODO is the release-row disclosure's Enter behavior in
  `tests/release-manager-journey-e2e.test.js`; it is outside this patch.
- Keyboard and focus behavior use the repository DOM harness. Narrow layout uses
  wrapping links/buttons and a full-width manual-copy field; no real-browser
  viewport or screen-reader session was performed.

Limits and delivery:

- Completion records that the detail view rendered, not comprehension, endorsement,
  a customer outcome, a benchmark or a testimonial. Reopen links require this
  browser's local records. Refused storage prevents retaining completion.
- No production bindings, migrations, protected files or deployment changes.
- The prior attempt (PR #3038) failed only `check_reviewer_approval.py`: no
  approval of the head within 900s. No code test failed, so no code change can fix it.
- Exact-final-head synthetic review approval is not available from this worktree
  session. It remains an unresolved delivery blocker. No auto-merge capability is
  requested before that approval; the runner owns staging, committing and review.
  Once approved, the final reviewed head must remain unchanged through delivery.
