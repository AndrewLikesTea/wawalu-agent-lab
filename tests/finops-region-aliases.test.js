// Where a pre-consolidation target lands (#1500).
//
// The consolidation passes deleted regions off /evolution.html. Their ids stayed
// in circulation — in a bookmark, in a share link already pasted into a thread,
// and in state a browser retained before the merge — and every one of them
// resolved to nothing, which put a reader at the top of a page holding a link
// somebody told them was the evidence.
//
// Two entry points, one table. The share link resolves against the shipped
// document; the retained store has no document to ask and resolves from the
// table alone. Both are covered here, and both are covered with the OLD ids
// written as literal strings — importing them would be importing something that
// no longer exists, and a test that has to be updated when the table is deleted
// is not a test of the table.
//
// The shipped page is the fixture. Nothing here is committed.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml } from "./support/browser.js";
import { installDeepLinkDisclosure, revealFragmentTarget } from "../src/deep-link-disclosure.js";
import {
  CANONICAL_ANSWER_REGION_ID, RETIRED_REGION_ALIASES, resolveRegionTargetId,
  resolveRetiredRegionId,
} from "../src/finops-spine.js";
import {
  RETAINED_STATE_KEY, RETAINED_STATE_VERSION, loadRetainedState, saveRetainedState,
} from "../src/finops-retained-state.js";
import { DECLARED_RATE_UNITS } from "../src/finops-declared-rate-contract.js";
import { PRICED_DESTINATIONS } from "../src/finops-pricing-provenance.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const page = async () => parseHtml(await readFile(PAGE, "utf8"));

// THE PRE-CONSOLIDATION IDS, AS LITERALS. `#1498`/`#1504` merged the readiness
// region's three sibling disclosures into one and deleted these two outright.
const DEAD_DISCLOSURE = "analysis-readiness-how-we-know";
const DEAD_UPGRADE_DETAIL = "analysis-readiness-upgrade-detail";
const SURVIVOR = "analysis-readiness-detail";
/** An id nothing ever retired and nothing ever shipped. */
const NEVER_EXISTED = "finops-region-that-never-was";

const [PREMIUM] = PRICED_DESTINATIONS;
const [INPUT_UNIT] = DECLARED_RATE_UNITS;
const CAPTURED_AT = "2026-07-01T09:30:00.000Z";
const RATES = Object.freeze([Object.freeze({
  model: PREMIUM, unit: INPUT_UNIT, rate: 14, effectiveDate: "2026-05-01",
  sourceLabel: "MSA 2026 Schedule B",
})]);
const COVERAGE = Object.freeze({ coverage: 0.62, departmentIds: ["atlas", "beacon"] });

/** A read-only storage holding exactly one entry, as a browser would. */
const storageHolding = (raw) => ({
  getItem: (key) => (key === RETAINED_STATE_KEY ? raw : null),
  setItem: () => {},
  removeItem: () => {},
});

/**
 * An entry in the PRE-CONSOLIDATION shape: version 2, and naming a region this
 * page has since deleted. Written as a literal object rather than through
 * `saveRetainedState`, because the point is an entry this build would not write.
 */
const preConsolidationEntry = (region) => JSON.stringify({
  version: 2,
  capturedAt: CAPTURED_AT,
  declaredRates: RATES,
  scoredCoverage: COVERAGE,
  region,
});

/** Every console channel, captured, so "no console errors" is asserted. */
function quietConsole(run) {
  const noise = [];
  const originals = {};
  for (const channel of ["error", "warn"]) {
    originals[channel] = console[channel];
    console[channel] = (...args) => noise.push([channel, ...args]);
  }
  try {
    return { result: run(), noise };
  } finally {
    Object.assign(console, originals);
  }
}

// --- the table -------------------------------------------------------------

test("every alias points at an id the shipped page still carries", async () => {
  const doc = await page();
  for (const [retired, survivor] of Object.entries(RETIRED_REGION_ALIASES)) {
    assert.ok(doc.getElementById(survivor),
      `"${retired}" points at "${survivor}", which must still be on the page`);
  }
  assert.ok(doc.getElementById(CANONICAL_ANSWER_REGION_ID),
    "the fallback region is the one the page actually ships");
});

// --- inbound share links ---------------------------------------------------

test("a share link written before the consolidation lands on the surviving region", async () => {
  const doc = await page();
  // The precondition this whole change exists for: the id is genuinely gone.
  assert.equal(doc.getElementById(DEAD_DISCLOSURE) ?? null, null);

  const { result: revealed, noise } = quietConsole(() => revealFragmentTarget(
    doc, `#${DEAD_DISCLOSURE}`, { resolve: resolveRegionTargetId, scroll: false }));

  assert.ok(revealed, "a retired target resolves rather than landing nowhere");
  assert.equal(revealed.id, SURVIVOR);
  assert.equal(revealed.requested, DEAD_DISCLOSURE);
  assert.equal(revealed.target, doc.getElementById(SURVIVOR));
  assert.deepEqual(noise, [], "and it says nothing to the console on the way");
});

test("the other retired disclosure resolves to the same survivor", async () => {
  const doc = await page();
  assert.equal(
    resolveRegionTargetId(DEAD_UPGRADE_DETAIL, doc), SURVIVOR,
    "both deleted disclosures' contents are inside the one that replaced them");
});

test("an id nobody retired is never rerouted", async () => {
  const doc = await page();
  // The safety property. If this ever fails, the resolver is moving links that
  // work, which is a worse defect than the one it was added to fix.
  for (const live of ["finops-stand", "local-import", CANONICAL_ANSWER_REGION_ID, SURVIVOR]) {
    assert.equal(resolveRegionTargetId(live, doc), live);
  }
});

test("an unknown target falls back to the canonical answer region, never nowhere", async () => {
  const doc = await page();
  assert.equal(resolveRegionTargetId(NEVER_EXISTED, doc), CANONICAL_ANSWER_REGION_ID);
  // Not a string, and a key that only exists on Object.prototype. Neither may
  // throw and neither may resolve to a function.
  for (const junk of [null, undefined, 42, "constructor", "__proto__", ""]) {
    assert.equal(resolveRegionTargetId(junk, doc), CANONICAL_ANSWER_REGION_ID);
  }
});

test("a page that passes no resolver behaves exactly as it did before", async () => {
  const doc = await page();
  // Every other page in this repo installs the deep-link opener without a table.
  // A retired id must stay "no target" for them, not silently reroute.
  assert.ok(revealFragmentTarget(doc, `#${DEAD_DISCLOSURE}`) === null);
  assert.ok(revealFragmentTarget(doc, `#${NEVER_EXISTED}`) === null);
});

test("a reload carrying a retired fragment resolves through the installed handler", async () => {
  const doc = await page();
  const listeners = new Map();
  const win = {
    location: { hash: `#${DEAD_DISCLOSURE}` },
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type) => listeners.delete(type),
  };

  const { noise } = quietConsole(() => {
    const teardown = installDeepLinkDisclosure(doc, win, {
      resolve: resolveRegionTargetId, scroll: false,
    });
    teardown();
  });

  // The cold-load case: the browser already tried this fragment and failed.
  assert.equal(doc.activeElement, doc.getElementById(SURVIVOR),
    "the reader's focus lands on the region that took the deleted one's content");
  assert.deepEqual(noise, []);
});

// --- the retained store ----------------------------------------------------

test("a payload naming a dead region restores whole, against the surviving one", () => {
  const { result: loaded, noise } = quietConsole(() => loadRetainedState(
    { storage: storageHolding(preConsolidationEntry(DEAD_DISCLOSURE)) }));

  // THE STATE IS KEPT. A dead region id is not a reason to lose a reader's
  // declared rates, the period they were effective from, or the coverage the
  // grade was earned at.
  assert.equal(loaded.retained, true, "a dead region must not abort the restore");
  assert.equal(loaded.payload.version, RETAINED_STATE_VERSION);
  assert.equal(loaded.payload.capturedAt, CAPTURED_AT);
  assert.deepEqual(loaded.payload.declaredRates, RATES);
  assert.deepEqual(loaded.payload.scoredCoverage, COVERAGE);
  // AND THE TARGET IS RESOLVED. This is the assertion the alias table owns:
  // delete the table and this reads the canonical region instead.
  assert.equal(loaded.payload.region, SURVIVOR);
  assert.deepEqual(noise, []);
});

test("a payload naming a region no table knows lands on the canonical answer", () => {
  const loaded = loadRetainedState(
    { storage: storageHolding(preConsolidationEntry(NEVER_EXISTED)) });
  assert.equal(loaded.retained, true);
  assert.equal(loaded.payload.region, CANONICAL_ANSWER_REGION_ID);
  assert.deepEqual(loaded.payload.declaredRates, RATES);
});

test("an entry that names no region at all restores against the canonical answer", () => {
  const entry = JSON.parse(preConsolidationEntry(DEAD_DISCLOSURE));
  delete entry.region;
  const loaded = loadRetainedState({ storage: storageHolding(JSON.stringify(entry)) });
  assert.equal(loaded.retained, true);
  assert.equal(loaded.payload.region, CANONICAL_ANSWER_REGION_ID);
});

test("a write states the region it is retained against", () => {
  const written = [];
  const outcome = saveRetainedState({
    declaredRates: RATES,
    scoredCoverage: COVERAGE,
    capturedAt: new Date(CAPTURED_AT),
    region: DEAD_DISCLOSURE,
    storage: { setItem: (_key, value) => written.push(value), getItem: () => null },
  });
  assert.equal(outcome.retained, true);
  assert.equal(outcome.payload.region, SURVIVOR,
    "the stored id is the live one, so the next read has nothing to repair");
  assert.equal(JSON.parse(written[0]).region, SURVIVOR);
});

test("the table alone resolves, with no document anywhere near it", () => {
  // The store runs before any paint and on a page it cannot see. The pure form
  // must therefore never consult a document, and never throw for want of one.
  assert.equal(resolveRetiredRegionId(DEAD_DISCLOSURE), SURVIVOR);
  assert.equal(resolveRetiredRegionId(DEAD_UPGRADE_DETAIL), SURVIVOR);
  assert.equal(resolveRetiredRegionId("finops-stand"), "finops-stand",
    "a region the census still declares is returned unchanged");
  // Everything the two tables cannot vouch for lands on the answer, so the
  // store can never hold an id that points at nothing.
  for (const junk of [NEVER_EXISTED, null, undefined, 42, "", "__proto__", "constructor"]) {
    assert.equal(resolveRetiredRegionId(junk), CANONICAL_ANSWER_REGION_ID);
  }
});
