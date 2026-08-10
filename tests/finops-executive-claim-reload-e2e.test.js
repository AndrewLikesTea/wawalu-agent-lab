// Does the FinOps executive claim survive closing the tab? (#1495)
//
// #1490 let a lead declare contracted model rates, which moves the pricing
// provenance beside the recoverable figure from a published-list ceiling to
// "Declared". #1492 filled the graded floor with a scored-departments-only
// figure. #1493 made the pair survive a reload. #1494 put a guided loop under
// them that says what still stands between the figure and a defensible claim.
//
// Each of those landed with its own unit tests. What none of them can show is
// the thing a director actually depends on: that the claim they earned on
// Tuesday is the SAME claim, word for word, when they open the tab on Friday to
// forward it. So every test here drives the shipped AI FinOps tab — the real
// markup from src/evolution.html, booted by the real page entry — and a
// "reload" is a genuine second boot of that entry against a fresh document,
// seeded with exactly the storage the first boot left behind.
//
// WHAT IS COMPARED IS STRINGS. The before-values are captured as text off the
// page and compared with `assert.equal` to the after-values. A claim that came
// back as the same number rendered differently is a claim that changed.
//
// Assertion discipline, because this suite runs against a headless harness:
// every assertion is on a count, an attribute value or text content. No
// assertion is handed a parsed node — comparing one makes the harness walk the
// whole document to build a diff, which outlives the test timeout.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { PRICED_DESTINATIONS } from "../src/finops-pricing-provenance.js";
import { NO_DECLARATION_STATUS } from "../src/finops-declared-rate-view.js";
import {
  RETAINED_STATE_KEY, RETAINED_STATE_VERSION,
} from "../src/finops-retained-state.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));
const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

// ---------------------------------------------------------------------------
// The tab, and what a reload of it means
// ---------------------------------------------------------------------------

/**
 * Open the AI FinOps tab and mirror every storage write into a plain object.
 *
 * The mirror is what makes a reload real. The harness store is seeded from an
 * object but never writes back into it, so without this the second boot would
 * be handed the first boot's STARTING state and a restore test would pass on a
 * page that had retained nothing. The wrappers are installed before the page
 * entry is imported, so the boot's own writes are captured too.
 */
async function openFinopsTab(seed = {}) {
  const page = await loadPage(PAGE, {
    storage: { ...seed },
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  const jar = { ...seed };
  const { setItem, removeItem } = page.storage;
  page.storage.setItem = (key, value) => { jar[key] = String(value); setItem(key, value); };
  page.storage.removeItem = (key) => { delete jar[key]; removeItem(key); };
  page.jar = jar;

  await importPageModule("/evolution-page.js");
  const { document } = page;
  // Every asynchronous surface settles before a test touches the page; one left
  // in flight would run on into the next test against a torn-down document.
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  await waitFor(() => shownText(document, "integration-contract-provenance")
    .startsWith("Gateway completed"), "the static contract gateway to settle");
  await waitFor(() => byId(document, "finops-evaluation-result")
    .getAttribute("aria-busy") === "false", "the evaluation panel to settle");
  return page;
}

/** Close this tab and open the page again on whatever this browser now holds. */
async function reopen(page) {
  const { jar } = page;
  page.restore();
  return openFinopsTab(jar);
}

// ---------------------------------------------------------------------------
// The declaration a lead makes, generated from the page's own destination list
// ---------------------------------------------------------------------------
//
// Both units for every destination this analysis prices, because the pricing
// contract only calls a card "Declared" when it covers all of them. Generated
// from PRICED_DESTINATIONS rather than typed out, so adding a destination to
// the page moves this fixture with it instead of silently under-declaring.

const SOURCE_LABEL = "MSA 2026 Schedule B";

const DECLARATION_LINES = PRICED_DESTINATIONS.flatMap((model) => [
  `${model}, usd-per-million-input, 2.50, 2026-01-01, ${SOURCE_LABEL}`,
  `${model}, usd-per-million-output, 10.00, 2026-01-01, ${SOURCE_LABEL}`,
]);

const DECLARED_RATE_COUNT = DECLARATION_LINES.length;

/** Paste the contracted rates into the shipped form and submit it for real. */
function declareContractedRates(document) {
  byId(document, "declared-rates-input").value = DECLARATION_LINES.join("\n");
  byId(document, "declared-rates-form")
    .dispatchEvent(new DomEvent("submit", { bubbles: true }));
  assert.equal(byId(document, "declared-rates-status").dataset.state, "accepted",
    "the declaration must be accepted before a reload of it is worth testing");
}

/**
 * The claim as a director reads it: the figure, the tier marker beside it, the
 * earned grade, the pricing provenance, and the graded floor under it.
 *
 * Captured as STRINGS, so what a reload is compared against is words on a page
 * and not an object that happens to re-derive the same way.
 */
const CLAIM_SLOTS = Object.freeze([
  "finops-recoverable-value",
  "finops-recoverable-marker",
  "finops-recoverable-grade",
  "finops-recoverable-provenance",
  "finops-recoverable-provenance-reason",
  "finops-recoverable-confidence",
  "finops-stand-floor-value",
  "finops-stand-floor-basis",
]);

const claimText = (document) => Object.fromEntries(
  CLAIM_SLOTS.map((id) => [id, shownText(document, id)]));

/** The two attributes a stylesheet and an assistive technology read instead. */
const claimAttributes = (document) => ({
  grade: byId(document, "finops-recoverable-grade").dataset.grade,
  band: byId(document, "finops-recoverable-provenance").dataset.band,
  floorAvailable: byId(document, "finops-stand-floor-value").dataset.available,
});

// ---------------------------------------------------------------------------
// 1. A browser that never declared anything
// ---------------------------------------------------------------------------
//
// FIRST IN THIS FILE ON PURPOSE. Every later test declares a rate, and the
// declared-rate view holds the accepted declaration in a module value; a
// never-declared assertion running after one of them would be asserting against
// a page whose modules had already been handed a declaration.

test("a browser that never declared a rate reloads onto the unretained baseline", async () => {
  let page = await openFinopsTab();
  try {
    const before = claimText(page.document);
    page = await reopen(page);
    const { document } = page;

    // Nothing was retained, so nothing is claimed to have been.
    assert.equal(RETAINED_STATE_KEY in page.jar, false,
      "a visit that declared nothing must not write a retained entry");
    assert.equal(shownText(document, "finops-retained-state"), "",
      "the retention line must stay empty for a browser holding nothing");
    assert.equal(byId(document, "finops-retained-state").hidden, true);
    // A control that forgets nothing teaches a reader that something was kept.
    assert.equal(byId(document, "retained-state-reset").hidden, true,
      "the forget control must not be offered when there is nothing to forget");
    assert.equal(shownText(document, "declared-rates-status"), NO_DECLARATION_STATUS);

    // THE STALE-CLAIM CHECK, ON COUNTS. The headline figure is the page's own
    // unretained baseline: a list-price ceiling. The word this whole flow turns
    // on must appear nowhere in the figure line, and the tier marker must still
    // be the illustrative one.
    const figure = shownText(document, "finops-recoverable-figure");
    assert.equal(occurrences(figure, "Declared"), 0,
      "a browser that declared nothing must not meet a Declared claim");
    assert.equal(shownText(document, "finops-recoverable-marker"), "Illustrative");
    assert.equal(byId(document, "finops-recoverable-provenance").dataset.band, "2",
      "the provenance band must stay the published-list one");

    // And the baseline is byte-identical across the reload too: the served
    // document is what a fresh visitor keeps meeting.
    assert.deepEqual(claimText(document), before,
      "the unretained baseline moved between two boots of the same page");
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// 2. The whole loop, and the same words on the other side of a reload
// ---------------------------------------------------------------------------

test("the executive claim a lead earned is word-for-word the same after a reload", async () => {
  let page = await openFinopsTab();
  try {
    const baseline = claimText(page.document);
    declareContractedRates(page.document);

    // The claim is EARNED before it is reloaded: the marker says the rates are
    // the reader's own, the grade is a letter and not the ungraded default, and
    // the graded floor beside it is a published figure over scored departments
    // only. Without these three the reload below would be proving that an empty
    // claim survives, which is not the claim under test.
    const before = claimText(page.document);
    const attributesBefore = claimAttributes(page.document);
    assert.equal(before["finops-recoverable-marker"], "Declared",
      "declaring contracted rates must move the tier marker off Illustrative");
    assert.notEqual(before["finops-recoverable-provenance"],
      baseline["finops-recoverable-provenance"],
      "declaring contracted rates must move the pricing provenance off the list price");
    assert.match(before["finops-recoverable-grade"], /^Confidence: \w/);
    assert.notEqual(attributesBefore.grade, "ungraded",
      "the grade must be earned before a reload of it proves anything");
    assert.equal(attributesBefore.floorAvailable, "true",
      "the scored-departments-only floor must be published before it is reloaded");
    assert.match(before["finops-stand-floor-value"], /^\$[\d,]+ · over \$[\d,]+ the rubric scored/);
    // The score is read off the page rather than written here: what this test
    // pins is that the SAME score comes back, not what today's rubric makes it.
    const appliedStatus = shownText(page.document, "declared-rates-status");
    const [, declaredScore] = /Pricing provenance is now Declared — (\d+\.\d) of 100\./
      .exec(appliedStatus) ?? [];
    assert.equal(appliedStatus, `${DECLARED_RATE_COUNT} declared rates applied. Pricing provenance `
      + `is now Declared — ${declaredScore} of 100.`);

    page = await reopen(page);
    const { document } = page;

    // THE WHOLE POINT. Every slot of the claim, string against string.
    const after = claimText(document);
    for (const id of CLAIM_SLOTS) {
      assert.equal(after[id], before[id],
        `${id} did not come back the way the lead left it`);
    }
    assert.deepEqual(claimAttributes(document), attributesBefore,
      "the grade band, provenance band or floor availability changed across the reload");

    // And the page says the words came back rather than having been recomputed,
    // so a reader can tell a restored claim from a coincidence.
    assert.equal(shownText(document, "declared-rates-status"),
      `${DECLARED_RATE_COUNT} declared rates restored from this browser. Pricing provenance is now `
      + `Declared — ${declaredScore} of 100.`);
    assert.equal(byId(document, "finops-retained-state").dataset.state, "retained");
    assert.equal(byId(document, "finops-retained-state").hidden, false);
    assert.equal(byId(document, "retained-state-reset").hidden, false,
      "a browser holding a declaration must offer the control that forgets it");
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// 3. The record that outlives the tab says the same thing the tab says
// ---------------------------------------------------------------------------
//
// The claim is only auditable if the machine-readable record behind it and the
// sentence on screen cannot disagree. A forwarded brief is read by somebody who
// never saw this tab, so a retained entry stating a coverage the page prints
// differently is a claim two readers would defend two different ways.

test("the retained record and the restored screen state one claim, not two", async () => {
  let page = await openFinopsTab();
  try {
    declareContractedRates(page.document);
    page = await reopen(page);
    const { document } = page;

    const entry = JSON.parse(page.jar[RETAINED_STATE_KEY]);
    assert.equal(entry.version, RETAINED_STATE_VERSION,
      "the record must state the version this build reads, not carry an implied one");
    assert.equal(entry.declaredRates.length, DECLARED_RATE_COUNT);

    // (a) The rate count the line prints is the record's own count.
    const line = shownText(document, "finops-retained-state");
    assert.equal(occurrences(line, `${DECLARED_RATE_COUNT} declared rates`), 1,
      `the retention line must state the ${DECLARED_RATE_COUNT} rates the record holds`);

    // (b) The coverage the line prints is the record's own ratio, rounded the
    // one way the page rounds it — not a second measurement of the same spend.
    const scoredPercent = `${Math.round(entry.scoredCoverage.coverage * 100)}%`;
    assert.equal(occurrences(line, `${scoredPercent} of analyzed spend`), 1,
      "the retention line must state the coverage the record was written with");
    assert.equal(occurrences(shownText(document, "finops-stand-floor-value"),
      `${scoredPercent} of analyzed spend`), 1,
      "the graded floor and the retained record disagree about the scored coverage");

    // (c) The departments the coverage was taken over are counted, not implied.
    const scoredCount = entry.scoredCoverage.departmentIds.length;
    assert.ok(scoredCount >= 1, "at least one department must have been scored");
    assert.equal(occurrences(line, `across ${scoredCount} scored departments`), 1,
      "the retention line must state how many departments the record names");

    // (d) Every destination the analysis prices is in the record, which is the
    // only reason the screen is allowed to say "Declared" at all.
    for (const model of PRICED_DESTINATIONS) {
      assert.equal(entry.declaredRates.filter((rate) => rate.model === model).length, 2,
        `the record must carry both units for ${model}`);
    }
    assert.equal(shownText(document, "finops-recoverable-marker"), "Declared");
    // The word itself, not the constant behind it: renaming the top provenance
    // label renames what a director reads, and this is where that is caught.
    assert.equal(occurrences(shownText(document, "declared-rates-status"),
      "Pricing provenance is now Declared"), 1,
    "the restored declaration must be reported at the Declared provenance label");

    // (e) And the source a reader cited travels with it, so the provenance
    // detail beside the figure names the same paper the record does.
    assert.equal(new Set(entry.declaredRates.map((rate) => rate.sourceLabel)).size, 1);
    assert.equal(entry.declaredRates[0].sourceLabel, SOURCE_LABEL);
    assert.equal(occurrences(shownText(document, "finops-recoverable-provenance-detail"),
      SOURCE_LABEL), 1,
      "the provenance detail must cite the source the retained record carries");

    // Nothing beyond the closed set of retained facts is in the file.
    assert.deepEqual(Object.keys(entry).sort(),
      ["capturedAt", "declaredRates", "scoredCoverage", "version"]);
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// 4. Forgetting means forgotten on the next visit
// ---------------------------------------------------------------------------

test("a forgotten declaration does not come back on the next reload", async () => {
  let page = await openFinopsTab();
  try {
    declareContractedRates(page.document);
    assert.equal(RETAINED_STATE_KEY in page.jar, true);

    // Two presses, exactly as the region ships them: the first arms and reveals
    // the confirm, the second removes the entry.
    byId(page.document, "retained-state-reset").click();
    assert.equal(byId(page.document, "retained-state-confirm").hidden, false,
      "the first press must reveal the control that confirms the removal");
    byId(page.document, "retained-state-confirm").click();
    assert.equal(RETAINED_STATE_KEY in page.jar, false,
      "confirming the removal must take the entry out of this browser");

    page = await reopen(page);
    const { document } = page;

    // The whole failure mode, on counts: a lead who deliberately forgot their
    // rates must not be handed a Declared claim by the next boot.
    assert.equal(occurrences(shownText(document, "finops-recoverable-figure"), "Declared"), 0,
      "a forgotten declaration resurrected itself on the next visit");
    assert.equal(shownText(document, "finops-recoverable-marker"), "Illustrative");
    assert.equal(shownText(document, "finops-retained-state"), "");
    assert.equal(byId(document, "finops-retained-state").hidden, true);
    assert.equal(byId(document, "retained-state-reset").hidden, true);
    assert.equal(shownText(document, "declared-rates-status"), NO_DECLARATION_STATUS);
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// 5. An entry this build cannot read is refused, not part-applied
// ---------------------------------------------------------------------------
//
// The failure mode is a half-restored claim: a browser carrying an entry from
// another build, or one somebody edited, painting the parts that still parse
// and leaving a director reading a Declared marker over rates nobody declared.

test("a retained entry this build cannot read leaves the baseline claim alone", async () => {
  const seeded = {
    // A rate stored as a numeric string is an entry written by something other
    // than this build. The validator refuses it whole rather than coercing it.
    tampered: JSON.stringify({
      version: RETAINED_STATE_VERSION,
      capturedAt: "2026-08-01T09:15:00.000Z",
      declaredRates: [{ model: "premium-text", unit: "usd-per-million-input", rate: "2.50",
        effectiveDate: "2026-01-01", sourceLabel: SOURCE_LABEL }],
      scoredCoverage: { coverage: 0.93, departmentIds: ["one"] },
    }),
    unreadable: "{\"version\": 2, truncated",
    fromTheFuture: JSON.stringify({ version: RETAINED_STATE_VERSION + 1 }),
  };

  for (const [name, entry] of Object.entries(seeded)) {
    const page = await openFinopsTab({ [RETAINED_STATE_KEY]: entry });
    try {
      const { document } = page;
      assert.equal(occurrences(shownText(document, "finops-recoverable-figure"), "Declared"), 0,
        `the ${name} entry was part-applied to the claim`);
      assert.equal(shownText(document, "finops-recoverable-marker"), "Illustrative");
      // Refused is SAID, not silently swallowed: the reader is told the figures
      // are the baseline, and the forget control stays away.
      assert.notEqual(byId(document, "finops-retained-state").dataset.state, "retained");
      assert.notEqual(shownText(document, "finops-retained-state"), "",
        `the ${name} entry must be refused out loud, not in silence`);
      assert.equal(byId(document, "retained-state-reset").hidden, true);
    } finally {
      page.restore();
    }
  }
});
