// Addresses written before /evolution.html was shortened (#1498), and the shim
// that keeps them landing somewhere real (#1500).
//
// Three things are asserted, and the third is the one that costs a reader real
// work when it breaks:
//
//   1. THE MAP IS TRUE OF THE SHIPPED MARKUP. Every value in the alias map is an
//      id the page actually has, checked against src/evolution.html rather than
//      against a second list — a table that forwards one missing target to
//      another is worse than no table, because it looks fixed.
//   2. A STALE FRAGMENT IS FORWARDED, on a cold load and on a hash change, by the
//      wiring the page ships and not by a re-implementation of it.
//   3. A PRE-CONSOLIDATION RESTORE PAYLOAD STILL RENDERS. The v1 retained entry
//      is the shape an earlier build wrote; it must come back on the shortened
//      page, against the canonical figure, with its capture time, its pricing
//      provenance and the grade beside that figure intact.
//
// The page tests wait on all three settle points, not only `ready`: the
// evaluation and the static gateway both resolve after the ready flag, and a
// test that returns between them reds CI as an unhandled rejection while staying
// green on a fast machine.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  CANONICAL_ANSWER_REGION_ID, CONSOLIDATED_REGION_ALIASES, RESOLVED_BY,
  RETIRED_ANCHOR_TARGETS, forwardRetiredAnchor, resolveRegionTarget,
} from "../src/retired-anchor-compatibility.js";
import { ANSWER_SPINE, ROLE } from "../src/finops/answer-spine-view.js";
import { RETAINED_STATE_KEY } from "../src/finops-retained-state.js";
import { DECLARED_RATE_UNITS } from "../src/finops-declared-rate-contract.js";
import { PRICED_DESTINATIONS } from "../src/finops-pricing-provenance.js";
import { PRICING_PROVENANCE_IDS } from "../src/finops-pricing-provenance-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const MARKUP = await readFile(PAGE, "utf8");
const DEMO = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url)));
const EVALUATION = JSON.parse(await readFile(
  new URL("../src/finops-evaluation-fixtures.json", import.meta.url)));
const ROUTES = {
  "/evolution-demo-data.json": DEMO,
  "/finops-evaluation-fixtures.json": EVALUATION,
};

/** Every id the served document authors, read from the markup the page ships. */
const AUTHORED_IDS = new Set([...MARKUP.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

/**
 * Walk up from a node, collecting ids. `parentNode`, not a descendant selector:
 * the harness rejects `"#a #b"` at parse time, so containment is proved by the
 * chain rather than by a query.
 */
function ancestorIds(node) {
  const ids = [];
  let current = node?.parentNode ?? null;
  while (current) {
    if (current.id) ids.push(current.id);
    current = current.parentNode ?? null;
  }
  return ids;
}

/** Drive the shipped page to a fully settled state. All three waits, in order. */
async function settledPage(t, options) {
  const page = await loadPage(PAGE, { routes: ROUTES, ...options });
  t.after(page.restore);
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "page ready");
  await waitFor(() => page.document.getElementById("finops-evaluation-result")
    .getAttribute("aria-busy") === "false", "evaluation settled");
  await waitFor(() => page.document.getElementById("integration-contract-provenance")
    .textContent.trim().startsWith("Gateway completed"), "static gateway settled");
  return page;
}

// ---------------------------------------------------------------------------
// 1. The map
// ---------------------------------------------------------------------------

test("every retired summary-region anchor maps to its live successor", () => {
  const retired = ANSWER_SPINE.filter((entry) => entry.role === ROLE.retired);
  assert.ok(retired.length > 0);
  assert.deepEqual(RETIRED_ANCHOR_TARGETS,
    Object.fromEntries(retired.map((entry) => [entry.id, entry.supersededBy])));
  for (const entry of retired) {
    const win = { location: { hash: `#${entry.id}` }, history: { replaceState(_state, _title, hash) {
      win.location.hash = hash;
    } } };
    assert.equal(forwardRetiredAnchor(win), entry.supersededBy);
    assert.equal(win.location.hash, `#${entry.supersededBy}`);
  }
});

test("the alias map carries the manifest's retired regions and #1498's merges", () => {
  for (const [id, target] of Object.entries(RETIRED_ANCHOR_TARGETS)) {
    assert.equal(CONSOLIDATED_REGION_ALIASES[id], target,
      `${id} is declared retired by the manifest but the alias map disagrees`);
  }
  // The two disclosure ids #1498 merged. Named explicitly: the point of the map
  // is that a removal is a diff somebody reviews, not a pattern that guesses.
  assert.equal(CONSOLIDATED_REGION_ALIASES["analysis-readiness-how-we-know"],
    "analysis-readiness-detail");
  assert.equal(CONSOLIDATED_REGION_ALIASES["analysis-readiness-upgrade-detail"],
    "analysis-readiness-detail");
});

test("no alias forwards a reader from one missing id to another", () => {
  assert.ok(AUTHORED_IDS.has(CANONICAL_ANSWER_REGION_ID),
    "the canonical answer region must be an id the served document authors");
  for (const [id, target] of Object.entries(CONSOLIDATED_REGION_ALIASES)) {
    assert.ok(AUTHORED_IDS.has(target), `${id} points at ${target}, which is not on the page`);
    assert.ok(!AUTHORED_IDS.has(id) || RETIRED_ANCHOR_TARGETS[id] !== undefined,
      `${id} is still on the page, so aliasing it away would move a live anchor`);
    assert.equal(CONSOLIDATED_REGION_ALIASES[target], undefined,
      `${target} is itself aliased, so ${id} resolves in two hops`);
  }
});

test("resolution is total: absent, aliased, live, and unknown all have an answer", () => {
  const doc = { getElementById: (id) => (AUTHORED_IDS.has(id) ? { id } : null) };
  assert.equal(resolveRegionTarget("", doc).reason, RESOLVED_BY.absent);
  assert.equal(resolveRegionTarget(null, doc).id, null);
  assert.deepEqual({ ...resolveRegionTarget("analysis-readiness-how-we-know", doc) },
    { requested: "analysis-readiness-how-we-know", id: "analysis-readiness-detail",
      reason: RESOLVED_BY.alias });
  assert.deepEqual({ ...resolveRegionTarget("finops-first-run", doc) },
    { requested: "finops-first-run", id: "finops-first-run", reason: RESOLVED_BY.live });
  assert.deepEqual({ ...resolveRegionTarget("finops-quarterly-summary", doc) },
    { requested: "finops-quarterly-summary", id: CANONICAL_ANSWER_REGION_ID,
      reason: RESOLVED_BY.canonical });
  // Slot lookup asks the same table and refuses the region-sized fallback.
  assert.equal(resolveRegionTarget("finops-quarterly-summary", doc, { fallback: false }).id, null);
});

test("a shared-briefing fragment is never mistaken for a stale anchor", () => {
  const win = { location: { hash: "#brief=abc123" } };
  const doc = { getElementById: (id) => (AUTHORED_IDS.has(id) ? { id } : null) };
  assert.equal(forwardRetiredAnchor(win, doc), null);
  assert.equal(win.location.hash, "#brief=abc123");
});

// ---------------------------------------------------------------------------
// 2. The deep-link / share-link entry point on the shipped page
// ---------------------------------------------------------------------------

test("a cold deep link is forwarded by the shipped evolution entry", async (t) => {
  const page = await settledPage(t, { location: { hash: "#finops-first-run-conversion" } });
  assert.equal(window.location.hash, "#finops-contact");
  assert.ok(page.document.getElementById("finops-contact"));
});

test("a share link into a merged disclosure lands inside the canonical answer region",
  async (t) => {
    const page = await settledPage(t,
      { location: { hash: "#analysis-readiness-how-we-know" } });
    assert.equal(window.location.hash, "#analysis-readiness-detail");
    const target = page.document.getElementById("analysis-readiness-detail");
    assert.equal(target.id, "analysis-readiness-detail");
    // The survivor lives in the answer's one supporting-detail layer, which is
    // inside the canonical answer region — so the stale link lands on the answer.
    assert.ok(ancestorIds(target).includes(CANONICAL_ANSWER_REGION_ID),
      "the merged disclosure must sit inside the canonical answer region");
  });

test("an unrecognised target id falls back to the canonical region without throwing",
  async (t) => {
    const page = await settledPage(t, { location: { hash: "#finops-quarterly-summary" } });
    assert.equal(window.location.hash, `#${CANONICAL_ANSWER_REGION_ID}`);
    assert.equal(page.document.getElementById(CANONICAL_ANSWER_REGION_ID).id,
      CANONICAL_ANSWER_REGION_ID);
  });

test("a live fragment is left exactly as it was", async (t) => {
  await settledPage(t, { location: { hash: "#local-import" } });
  assert.equal(window.location.hash, "#local-import");
});

// ---------------------------------------------------------------------------
// 3. The restore path
// ---------------------------------------------------------------------------

const [PREMIUM, STANDARD] = PRICED_DESTINATIONS;
const [INPUT_UNIT, OUTPUT_UNIT] = DECLARED_RATE_UNITS;
const CAPTURED_AT = "2026-07-01T09:30:00.000Z";
const rate = (model, unit, amount) => (
  { model, unit, rate: amount, effectiveDate: "2026-05-01", sourceLabel: "MSA 2026 Schedule B" });

/**
 * The PRE-CONSOLIDATION entry: schema version 1, which kept scored coverage as a
 * bare ratio. Written in-test rather than committed as a fixture, so the shape
 * this asserts on is visible in the assertion.
 */
const V1_ENTRY = JSON.stringify({
  version: 1,
  capturedAt: CAPTURED_AT,
  declaredRates: [
    rate(PREMIUM, INPUT_UNIT, 14), rate(PREMIUM, OUTPUT_UNIT, 16),
    rate(STANDARD, INPUT_UNIT, 9), rate(STANDARD, OUTPUT_UNIT, 11),
  ],
  scoredCoverage: 0.62,
});

test("a pre-consolidation restore payload comes back against the canonical figure",
  async (t) => {
    const page = await settledPage(t, { storage: { [RETAINED_STATE_KEY]: V1_ENTRY } });
    const doc = page.document;

    const region = doc.getElementById(CANONICAL_ANSWER_REGION_ID);
    assert.equal(region.getAttribute("data-retained-state"), "retained",
      "the canonical answer region must state that its figures are running on retained state");

    // The retained period: when the declaration was captured, stated UTC.
    const line = doc.getElementById("finops-retained-state");
    assert.equal(line.hidden, false);
    assert.equal(line.dataset.state, "retained");
    assert.ok(line.textContent.includes("2026-07-01 at 09:30 UTC"),
      `the capture time was not restored: ${line.textContent}`);
    assert.ok(line.textContent.includes("4 declared rates"));
    // v1 recorded no department ids, so the line says so rather than inventing.
    assert.ok(line.textContent.includes("62% of analyzed spend"));
    assert.ok(ancestorIds(line).includes(CANONICAL_ANSWER_REGION_ID),
      "the retained line must render inside the canonical answer region");

    // The declared pricing provenance, recomputed from the restored rates and
    // painted into the slot beside the canonical figure.
    const provenance = doc.getElementById(PRICING_PROVENANCE_IDS.score);
    assert.ok(ancestorIds(provenance).includes(CANONICAL_ANSWER_REGION_ID));
    assert.notEqual(provenance.getAttribute("data-band"), "0",
      "restored contracted rates must move the pricing-provenance band off unscored");
    assert.ok(provenance.textContent.includes("Pricing provenance"));

    // The earned grade beside the same figure, still graded after the reload.
    const grade = doc.getElementById("finops-recoverable-grade");
    assert.ok(ancestorIds(grade).includes(CANONICAL_ANSWER_REGION_ID));
    assert.notEqual(grade.getAttribute("data-grade"), "ungraded",
      "the earned grade must survive the reload");

    assert.equal(doc.getElementById("declared-rates-status").dataset.state, "accepted");
  });

test("a restore whose slot is gone paints nothing and throws nothing", () => {
  // The degenerate document: no retained slot, no canonical region. The restore
  // path must be total here, because a page that throws in boot loses every
  // region below the throw, not just this one.
  const doc = { getElementById: () => null };
  assert.equal(resolveRegionTarget("finops-retained-state", doc, { fallback: false }).id, null);
  assert.equal(forwardRetiredAnchor({ location: { hash: "#finops-retained-state" } }, doc),
    CANONICAL_ANSWER_REGION_ID);
});
