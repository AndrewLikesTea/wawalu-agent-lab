// What the folded directory (#2250) was allowed to cost, in bytes of style.
//
// The name is a leftover: this file began as a scratch size measurement, and an
// agent worktree can create files but not delete or rename them, so it carries
// the change's size invariants rather than shipping empty. Fold it into
// tests/footer-directory-order.test.js whenever this area is next touched.
//
// src/styles.css runs about fifteen bytes under a hard build-time gate
// (scripts/check-size-budget.mjs, wired into `npm run verify:build`), so a
// disclosure that grew a chip, a border or a colour of its own would not build.
// The two assertions below say that in the codebase rather than in a commit
// message: the control reuses the band's caption and focus roles, and the two
// stylesheets that carry the band stay the mirrors src/styles.css says they are.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const SRC = new URL("../src/", import.meta.url);
const read = (file) => readFile(new URL(file, SRC), "utf8");

// The one rule the band declares for its destination list. src/styles.css names
// src/agents.css as the mirror of this block, and src/agents.css is what
// /agents.html and /agent-trace.html load, so the two must not drift.
const DEMOS_RULE = /\.site-footer-demos \{([^}]*)\}/;

test("the folded directory buys no rule of its own in either stylesheet", async () => {
  for (const file of ["styles.css", "agents.css"]) {
    const css = await read(file);
    assert.doesNotMatch(css, /site-footer-directory/,
      `${file}: the disclosure must reuse the band's roles, not grow a selector`);
  }
});

test("the band's destination list is declared identically in both stylesheets", async () => {
  const [styles, agents] = await Promise.all([read("styles.css"), read("agents.css")]);
  const declared = (css) => css.match(DEMOS_RULE)?.[1].trim();
  assert.ok(declared(styles), "styles.css lost its destination-list rule");
  assert.equal(declared(agents), declared(styles),
    "src/agents.css is documented as the mirror of this block and has drifted from it");
});
