// The retained FinOps state (#1484): the store, and the first screen that reads
// it, writes it, says so, and forgets it.
//
// Four groups:
//
//   1. THE STORE'S HAPPY PATH. A round trip through an injected storage, and the
//      provenance sentence the first screen prints from what came back.
//   2. THE STORE'S REFUSALS. Every discard path, each asserted on its reason CODE
//      and not only on the absence of a payload: a caller that cannot tell an
//      entry it will never read from a browser that has no storage cannot tell a
//      reader either. A tampered entry that parses is refused by shape, and a
//      forward migration from the older version produces the current shape.
//   3. THE STORAGE THAT FIGHTS BACK. Quota on write, a throwing read, and an
//      absent store — none of them may escape into the page.
//   4. THE PAGE. A fresh visitor meets the first screen this page already
//      shipped; applying rates retains them; a return visit is hydrated and says
//      when it was captured; forgetting takes two presses and puts the baseline
//      back; and a tampered entry renders the baseline plus the reason.
//
// Every storage here is injected or seeded through the harness, so no test
// mutates a global another test can read. The capture instant is frozen, so
// nothing asserts on the millisecond it ran in.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  RETAINED_LIMITS, RETAINED_MESSAGE, RETAINED_REASON, RETAINED_STATE_KEY,
  RETAINED_STATE_MIGRATIONS, RETAINED_STATE_VERSION, capturedAtLabel, clearRetainedState,
  loadRetainedState, retainedProvenanceLine, saveRetainedState, validateRetainedPayload,
} from "../src/finops-retained-state.js";
import { DECLARED_RATE_UNITS, RATE_MAX } from "../src/finops-declared-rate-contract.js";
import { PRICED_DESTINATIONS } from "../src/finops-pricing-provenance.js";
import { PRICING_PROVENANCE_IDS } from "../src/finops-pricing-provenance-view.js";
import { RETAINED_RESET_COPY } from "../src/finops-declared-rate-view.js";
import { FIRST_RUN_IDS } from "../src/finops-first-run.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));
const ROUTES = {
  "/evolution-demo-data.json": DEMO_DATA,
  "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
};

const [PREMIUM, STANDARD] = PRICED_DESTINATIONS;
const [INPUT_UNIT, OUTPUT_UNIT] = DECLARED_RATE_UNITS;
const LABEL = "MSA 2026 Schedule B";

/** The instant every write in this file is stamped with. Frozen, never read. */
const CAPTURED = new Date("2026-07-01T09:30:00.000Z");
const CAPTURED_AT = CAPTURED.toISOString();

const rate = (model, unit, amount) => (
  { model, unit, rate: amount, effectiveDate: "2026-05-01", sourceLabel: LABEL });

/** Both rates for both priced destinations: the fully declared card. */
const RATES = Object.freeze([
  rate(PREMIUM, INPUT_UNIT, 14), rate(PREMIUM, OUTPUT_UNIT, 16),
  rate(STANDARD, INPUT_UNIT, 9), rate(STANDARD, OUTPUT_UNIT, 11),
]);

const COVERAGE = Object.freeze({ coverage: 0.62, departmentIds: ["atlas", "beacon", "cinder"] });

/** A current-shape entry, as it sits in storage. */
const entry = (over = {}) => JSON.stringify({
  version: RETAINED_STATE_VERSION,
  capturedAt: CAPTURED_AT,
  declaredRates: RATES,
  scoredCoverage: COVERAGE,
  ...over,
});

/**
 * An injected storage. Each hook may throw, which is the only way to reproduce a
 * disabled store or an exhausted quota without touching a global.
 */
function fakeStorage(seed = {}, { onGet = null, onSet = null, onRemove = null } = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem(key) { onGet?.(key); return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { onSet?.(key, value); values.set(key, String(value)); },
    removeItem(key) { onRemove?.(key); values.delete(key); },
  };
}

const throwing = () => { throw new Error("this browser refuses site data"); };

// --- 1. the round trip -----------------------------------------------------

test("a saved entry loads back as the same validated current-shape payload", () => {
  const storage = fakeStorage();
  const saved = saveRetainedState({
    declaredRates: RATES, scoredCoverage: COVERAGE, capturedAt: CAPTURED, storage,
  });
  assert.equal(saved.retained, true);
  assert.equal(saved.reason, RETAINED_REASON.retained);
  assert.equal(storage.values.size, 1, "one namespaced key, and only one");
  assert.equal(JSON.parse(storage.values.get(RETAINED_STATE_KEY)).version, RETAINED_STATE_VERSION,
    "the payload states its own version — the key does not, so an old entry can be walked");

  const loaded = loadRetainedState({ storage });
  assert.equal(loaded.retained, true);
  assert.deepEqual(loaded.payload, {
    version: RETAINED_STATE_VERSION,
    capturedAt: CAPTURED_AT,
    declaredRates: RATES,
    scoredCoverage: COVERAGE,
  });
});

test("the provenance sentence states the capture time and what depends on it", () => {
  const { payload } = loadRetainedState({ storage: fakeStorage({ [RETAINED_STATE_KEY]: entry() }) });
  const line = retainedProvenanceLine(payload);
  assert.match(line, /^Retained in this browser: 4 declared rates, captured 2026-07-01 at 09:30 UTC\./);
  assert.match(line, /pricing provenance and the confidence grade/,
    "a reader is told which of the claims above the retained entry moved");
  assert.match(line, /the recoverable amount itself is not/,
    "…and which it did not, so the figure is not read as retained");
  assert.match(line, /62% of analyzed spend across 3 scored departments/);
  assert.equal(capturedAtLabel(CAPTURED_AT), "2026-07-01 at 09:30 UTC");
});

test("nothing to retain is a stated non-event, not an empty write", () => {
  const storage = fakeStorage();
  const outcome = saveRetainedState({ declaredRates: [], capturedAt: CAPTURED, storage });
  assert.equal(outcome.retained, false);
  assert.equal(outcome.reason, RETAINED_REASON.nothingToRetain);
  assert.equal(storage.values.size, 0);
});

// --- 2. the refusals -------------------------------------------------------

test("an older entry is walked forward into the current shape", () => {
  // Version 1 kept coverage as a bare ratio and no department ids.
  const v1 = JSON.stringify({
    version: 1, capturedAt: CAPTURED_AT, declaredRates: RATES, scoredCoverage: 0.62,
  });
  const loaded = loadRetainedState({ storage: fakeStorage({ [RETAINED_STATE_KEY]: v1 }) });
  assert.equal(loaded.retained, true);
  assert.equal(loaded.payload.version, RETAINED_STATE_VERSION);
  assert.deepEqual(loaded.payload.scoredCoverage, { coverage: 0.62, departmentIds: [] },
    "the ratio is carried; the ids it never held are NOT invented from today's analysis");
  assert.deepEqual(loaded.payload.declaredRates, RATES);
  assert.match(retainedProvenanceLine(loaded.payload),
    /over departments the entry did not record/);
  assert.deepEqual(Object.keys(RETAINED_STATE_MIGRATIONS), ["1"],
    "every readable version below the current one has exactly one step out of it");
});

test("a version this build does not know is discarded with a reason, not read", () => {
  for (const version of [RETAINED_STATE_VERSION + 1, 0, -1, 1.5, "2", null]) {
    const loaded = loadRetainedState({
      storage: fakeStorage({ [RETAINED_STATE_KEY]: entry({ version }) }),
    });
    assert.equal(loaded.retained, false, `version ${version} must not be read`);
    assert.equal(loaded.payload, null);
    assert.equal(loaded.reason, RETAINED_REASON.unsupportedVersion);
    assert.equal(loaded.message, RETAINED_MESSAGE[RETAINED_REASON.unsupportedVersion]);
  }
});

test("an entry that is not readable JSON is discarded with a reason", () => {
  const loaded = loadRetainedState({
    storage: fakeStorage({ [RETAINED_STATE_KEY]: "{\"version\": 2, truncated" }),
  });
  assert.equal(loaded.retained, false);
  assert.equal(loaded.reason, RETAINED_REASON.unparsableJson);
  assert.match(loaded.message, /not readable JSON/);
});

test("an entry that parses but was tampered with is refused by shape, not coerced", () => {
  const tampered = [
    ["a rate as a string", { declaredRates: [{ ...RATES[0], rate: "14.00" }] }],
    ["a rate above the range", { declaredRates: [{ ...RATES[0], rate: RATE_MAX + 1 }] }],
    ["a negative rate", { declaredRates: [{ ...RATES[0], rate: -14 }] }],
    ["a unit outside the enum", { declaredRates: [{ ...RATES[0], unit: "usd-per-hour" }] }],
    ["a date that is not a date", { declaredRates: [{ ...RATES[0], effectiveDate: "2026-02-30" }] }],
    ["no source label", { declaredRates: [{ ...RATES[0], sourceLabel: "" }] }],
    ["coverage above 1", { scoredCoverage: { coverage: 1.4, departmentIds: [] } }],
    ["coverage as a string", { scoredCoverage: { coverage: "0.62", departmentIds: [] } }],
    ["department ids that are not text", { scoredCoverage: { coverage: 0.5, departmentIds: [7] } }],
    ["no capture time", { capturedAt: null }],
    ["a capture time that is not an instant", { capturedAt: "one tuesday" }],
    ["no rates at all", { declaredRates: [] }],
  ];
  for (const [what, over] of tampered) {
    const loaded = loadRetainedState({
      storage: fakeStorage({ [RETAINED_STATE_KEY]: entry(over) }),
    });
    assert.equal(loaded.retained, false, `${what} must be refused`);
    assert.equal(loaded.payload, null, `${what} must not reach a caller part-valid`);
    assert.equal(loaded.reason, RETAINED_REASON.invalidShape, what);
  }
});

test("the write is held to exactly the rule the read is held to", () => {
  const storage = fakeStorage();
  const refused = saveRetainedState({
    declaredRates: [{ ...RATES[0], rate: "14.00" }], capturedAt: CAPTURED, storage,
  });
  assert.equal(refused.retained, false);
  assert.equal(refused.reason, RETAINED_REASON.invalidShape);
  assert.equal(storage.values.size, 0, "a store that would refuse the read must refuse the write");
  assert.equal(validateRetainedPayload(null), null);
  assert.equal(
    validateRetainedPayload({
      version: RETAINED_STATE_VERSION,
      capturedAt: CAPTURED_AT,
      declaredRates: Array.from({ length: RETAINED_LIMITS.rates + 1 }, () => RATES[0]),
      scoredCoverage: COVERAGE,
    }), null, "an entry past the stated bound is refused rather than rendered");
});

// --- 3. storage that fights back -------------------------------------------

test("a quota-exhausted write degrades to the baseline with a reason", () => {
  const storage = fakeStorage({}, { onSet: throwing });
  const outcome = saveRetainedState({
    declaredRates: RATES, scoredCoverage: COVERAGE, capturedAt: CAPTURED, storage,
  });
  assert.equal(outcome.retained, false);
  assert.equal(outcome.payload, null);
  assert.equal(outcome.reason, RETAINED_REASON.writeFailed);
  assert.match(outcome.message, /refused the write/);
});

test("a read that throws, and a browser with no store at all, both degrade", () => {
  const refusedRead = loadRetainedState({ storage: fakeStorage({}, { onGet: throwing }) });
  assert.equal(refusedRead.reason, RETAINED_REASON.readFailed);
  assert.equal(refusedRead.payload, null);

  for (const storage of [null, undefined, {}, { getItem: "not a function" }]) {
    const outcome = loadRetainedState({ storage });
    assert.equal(outcome.retained, false);
    assert.equal(outcome.reason, RETAINED_REASON.storageUnavailable);
  }
  assert.equal(saveRetainedState({ declaredRates: RATES, capturedAt: CAPTURED, storage: null })
    .reason, RETAINED_REASON.storageUnavailable);
});

test("an empty browser is the unretained baseline, which is not a fault", () => {
  const loaded = loadRetainedState({ storage: fakeStorage() });
  assert.equal(loaded.retained, false);
  assert.equal(loaded.reason, RETAINED_REASON.unretained);
  assert.match(loaded.message, /unretained baseline/);
});

test("clearing removes the key and reports whether it happened", () => {
  const storage = fakeStorage({ [RETAINED_STATE_KEY]: entry(), other: "left alone" });
  const cleared = clearRetainedState({ storage });
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.reason, RETAINED_REASON.cleared);
  assert.equal(storage.values.has(RETAINED_STATE_KEY), false);
  assert.equal(storage.values.get("other"), "left alone", "one key, and nothing else touched");

  const refused = clearRetainedState({ storage: fakeStorage({}, { onRemove: throwing }) });
  assert.equal(refused.cleared, false, "a browser that refuses the removal has not forgotten");
  assert.equal(refused.reason, RETAINED_REASON.writeFailed);
  assert.equal(clearRetainedState({ storage: null }).reason, RETAINED_REASON.storageUnavailable);
});

// --- 4. the page -----------------------------------------------------------

const boot = async (storage = {}) => {
  const page = await loadPage(PAGE, { routes: ROUTES, storage });
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.getElementById("declared-rates-form") !== null,
    "the declared-rate form never appeared");
  return page;
};

const byId = (page, id) => page.document.getElementById(id);
const provenance = (page) => textOf(byId(page, PRICING_PROVENANCE_IDS.score));

/** Everything in `<main>` before the first-run region: the first screen's words. */
function firstScreenText(document) {
  const parts = [];
  const visit = (node) => {
    for (const child of node.children ?? []) {
      if (child?.nodeType === 3) {
        parts.push(child.textContent);
        continue;
      }
      if (child?.nodeType !== 1) continue;
      if (child.id === FIRST_RUN_IDS.region) return true;
      if (visit(child)) return true;
    }
    return false;
  };
  assert.equal(visit(document.getElementById("main-content")), true,
    "the first-run region is not inside main at all");
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

test("a visitor with nothing retained meets the first screen this page shipped", async () => {
  const page = await boot();
  const line = byId(page, "finops-retained-state");
  assert.equal(textOf(line), "", "an unretained first screen says nothing about retention");
  assert.equal(line.hidden, true, "…and takes no room and no place in the reading order");
  assert.equal(line.dataset.state, RETAINED_REASON.unretained);
  assert.match(provenance(page), /Pricing provenance: Limited confidence \(67\/100\)/,
    "the figure is priced at the published list, exactly as the served document is");
  assert.equal(byId(page, "retained-state-reset").hidden, true,
    "there is nothing to forget, so no control offers to");
  assert.equal(byId(page, "retained-state-confirm").hidden, true);
  assert.equal(page.storage.getItem(RETAINED_STATE_KEY), null, "and nothing was written on load");
  // The whole first screen, not only the slot: nothing above the first-run
  // region mentions retention at all, so a visitor with an empty browser reads
  // the page #1481 and #1482 left behind and not a word more.
  const firstScreen = firstScreenText(page.document);
  for (const vocabulary of ["Retained", "retained", "this browser"]) {
    assert.equal(firstScreen.includes(vocabulary), false,
      `an unretained first screen must not say "${vocabulary}"`);
  }
});

test("applying rates is what retains them, and the first screen says so", async () => {
  const first = await boot();
  byId(first, "declared-rates-input").value = [
    `${PREMIUM}, ${INPUT_UNIT}, 14, 2026-05-01, ${LABEL}`,
    `${PREMIUM}, ${OUTPUT_UNIT}, 16, 2026-05-01, ${LABEL}`,
    `${STANDARD}, ${INPUT_UNIT}, 9, 2026-05-01, ${LABEL}`,
    `${STANDARD}, ${OUTPUT_UNIT}, 11, 2026-05-01, ${LABEL}`,
  ].join("\n");
  byId(first, "declared-rates-form").dispatchEvent(new DomEvent("submit", { bubbles: true }));

  const written = first.storage.getItem(RETAINED_STATE_KEY);
  assert.notEqual(written, null, "the action that establishes the rates is the action that keeps them");
  const payload = JSON.parse(written);
  assert.equal(payload.version, RETAINED_STATE_VERSION);
  assert.deepEqual(payload.declaredRates, RATES,
    "the five declared fields, and nothing else the page happened to be holding");
  assert.equal(typeof payload.scoredCoverage.coverage, "number",
    "the scored coverage the graded floor was taken at is captured with them");
  assert.deepEqual(Object.keys(payload).sort(),
    ["capturedAt", "declaredRates", "scoredCoverage", "version"]);
  assert.match(textOf(byId(first, "finops-retained-state")),
    /^Retained in this browser: 4 declared rates, captured /);
  assert.equal(byId(first, "retained-state-reset").hidden, false);
});

test("a return visit is hydrated from the retained entry and dates it", async () => {
  // The same bytes the test above asserted the page writes, with the capture
  // instant frozen so nothing here depends on the millisecond it ran in.
  const page = await boot({ [RETAINED_STATE_KEY]: entry() });
  assert.match(provenance(page), /Pricing provenance: High confidence \(88\/100\)/,
    "the earned provenance is restored rather than starting again at the list price");
  assert.match(textOf(byId(page, "declared-rates-status")),
    /4 declared rates restored from this browser/);
  assert.match(textOf(byId(page, "finops-retained-state")),
    /captured 2026-07-01 at 09:30 UTC/);
  assert.equal(byId(page, "finops-retained-state").hidden, false);
  assert.equal(byId(page, "retained-state-reset").hidden, false);
});

test("forgetting takes two presses and puts the unretained baseline back", async () => {
  const page = await boot({ [RETAINED_STATE_KEY]: entry() });
  assert.match(provenance(page), /Pricing provenance: High confidence \(88\/100\)/);
  const reset = byId(page, "retained-state-reset");
  const confirm = byId(page, "retained-state-confirm");
  assert.equal(confirm.hidden, true, "the deleting control does not exist until it is asked for");

  reset.dispatchEvent(new DomEvent("click", { bubbles: true }));
  assert.equal(confirm.hidden, false);
  assert.equal(textOf(byId(page, "retained-state-status")), RETAINED_RESET_COPY.arm);
  assert.equal(page.storage.getItem(RETAINED_STATE_KEY) !== null, true,
    "one press is not a deletion");

  // Pressing the first control again is the cancel, so no third control exists.
  reset.dispatchEvent(new DomEvent("click", { bubbles: true }));
  assert.equal(confirm.hidden, true);
  assert.equal(page.storage.getItem(RETAINED_STATE_KEY) !== null, true);

  reset.dispatchEvent(new DomEvent("click", { bubbles: true }));
  confirm.dispatchEvent(new DomEvent("click", { bubbles: true }));
  assert.equal(page.storage.getItem(RETAINED_STATE_KEY), null, "the key is gone");
  assert.match(provenance(page), /Pricing provenance: Limited confidence \(67\/100\)/,
    "and the figures are the unretained baseline again");
  assert.equal(textOf(byId(page, "finops-retained-state")), "");
  assert.equal(byId(page, "finops-retained-state").hidden, true);
  assert.equal(byId(page, "retained-state-reset").hidden, true);
});

test("a tampered entry renders the baseline and the reason, never a half-trusted figure", async () => {
  const page = await boot({ [RETAINED_STATE_KEY]: entry({ declaredRates: [{ ...RATES[0], rate: "14.00" }] }) });
  assert.match(provenance(page), /Pricing provenance: Limited confidence \(67\/100\)/,
    "nothing derived from a partly-valid entry may be painted");
  const line = byId(page, "finops-retained-state");
  assert.equal(line.hidden, false, "the reader is told, on the screen carrying the figure");
  assert.equal(line.dataset.state, RETAINED_REASON.invalidShape);
  assert.match(textOf(line), /failed validation/);
});

test("a browser that refuses the write leaves the page on the baseline and says why", async () => {
  const page = await boot();
  page.storage.setItem = throwing;
  byId(page, "declared-rates-input").value =
    `${PREMIUM}, ${INPUT_UNIT}, 14, 2026-05-01, ${LABEL}\n`
    + `${PREMIUM}, ${OUTPUT_UNIT}, 16, 2026-05-01, ${LABEL}`;
  byId(page, "declared-rates-form").dispatchEvent(new DomEvent("submit", { bubbles: true }));

  const line = byId(page, "finops-retained-state");
  assert.equal(line.dataset.state, RETAINED_REASON.writeFailed);
  assert.match(textOf(line), /refused the write/);
  assert.match(textOf(byId(page, "retained-state-status")), /refused the write/);
  assert.equal(byId(page, "retained-state-reset").hidden, true,
    "nothing was kept, so nothing offers to forget it");
  // The declaration still applies to THIS tab: a browser that will not remember
  // is not a reason to refuse the rates the reader just stated.
  assert.match(textOf(byId(page, "declared-rates-status")), /2 declared rates applied/);
});
