// The retained AI FinOps briefing as a keyed series (#1089).
//
// What only this file can catch: that a second import lands as a second period
// instead of overwriting the first, that re-importing a period already on file
// updates it in place rather than appending a duplicate, that the read shape is
// chronological and computed rather than trusted, that the single-briefing
// record this browser may already be holding is migrated into the series on
// first load, that no malformed stored value throws into a load, that nothing
// prompt-shaped reaches the persisted bytes, and that the page paints the count
// above the answer.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { BRIEFING_RETENTION_KEY, RETENTION_COPY } from "../src/finops-briefing-retention.js";
import {
  BRIEFING_SERIES_KEY, BRIEFING_SERIES_VERSION, ENTRY_BASIS, ESTIMATE_SCOPE, briefingSeriesEntry,
  briefingSeriesSummary, estimatedSeries, forgetBriefingSeries, readBriefingSeries,
  realizedSeries, recordBriefingSeriesEntry, recordEstimatedPeriod,
} from "../src/finops-briefing-series.js";
import { estimateFromDeclaredFacts } from "../src/finops-declared-fact-estimate.js";
import { EXAMPLE_DECLARED_FACTS } from "../src/finops-declared-fact-fixtures.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));
// A supported native export: one file selection is a complete import.
const NATIVE_OPENAI = await readFile(new URL(
  "../contracts/integrations/native-provider-exports/v1/fixtures/openai-supported.csv",
  import.meta.url), "utf8");

/** The storage a browser hands the store, with the jar visible to the test. */
function memoryStorage(seed = {}) {
  const jar = new Map(Object.entries(seed));
  return {
    jar,
    getItem: (key) => (jar.has(key) ? jar.get(key) : null),
    setItem: (key, value) => { jar.set(key, String(value)); },
    removeItem: (key) => { jar.delete(key); },
  };
}

/**
 * THE PAYLOAD SHAPE SHIPPING TODAY, copied out of the single-briefing store's
 * own test rather than invented here: this is what a browser that opted in
 * before #1089 is holding under the legacy key right now.
 */
const legacyPayload = (overrides = {}) => ({
  version: 1,
  capturedAt: "2026-08-01T09:00:00.000Z",
  provider: { id: "openai", name: "OpenAI", confidence: 92 },
  confidence: "Medium",
  totals: {
    analyzedSpendUsd: 546.2,
    recoverableUsd: 402.75,
    recordsAnalyzed: 3,
    recordsExcluded: 0,
    period: "2026-06-01 to 2026-07-01",
    previousPeriod: "2026-05-01 to 2026-06-01",
    periods: [
      { period: "2026-05-01 to 2026-06-01", spendUsd: 400 },
      { period: "2026-06-01 to 2026-07-01", spendUsd: 546.2 },
    ],
  },
  departments: [
    { id: "atlas-platform", name: "Atlas Platform", spendUsd: 412.75, previousSpendUsd: 300, recoverableUsd: 300 },
    { id: "boreal-support", name: "Boreal Support", spendUsd: 133.45, previousSpendUsd: 100, recoverableUsd: 102.75 },
  ],
  rankedAction: "Pilot lower-cost routing for text-generation in Atlas Platform.",
  attribution: { withheld: false, spendExport: true, conversationExport: false },
  context: null,
  ...overrides,
});

/** One import's briefing, at a chosen month, in the payload shape above. */
const briefingFor = (month, spendUsd, extra = {}) => legacyPayload({
  capturedAt: `${month}-28T09:00:00.000Z`,
  totals: { ...legacyPayload().totals, period: `${month}-01 to ${month}-28`, analyzedSpendUsd: spendUsd },
  ...extra,
});

const record = (storage) => JSON.parse(storage.getItem(BRIEFING_SERIES_KEY));

// ---------------------------------------------------------------------------
// (a) Two imports, two periods — the defect this issue names.
// ---------------------------------------------------------------------------

test("a second import lands beside the first instead of overwriting it", () => {
  const storage = memoryStorage();
  recordBriefingSeriesEntry(storage, briefingFor("2026-06", 546.2));
  const series = recordBriefingSeriesEntry(storage, briefingFor("2026-07", 610));

  assert.deepEqual(series.map((entry) => entry.period), ["2026-06", "2026-07"]);
  assert.deepEqual(series.map((entry) => entry.spendUsd), [546.2, 610]);
});

test("re-importing a period already on file updates that entry in place", () => {
  const storage = memoryStorage();
  recordBriefingSeriesEntry(storage, briefingFor("2026-06", 546.2));
  const series = recordBriefingSeriesEntry(storage, briefingFor("2026-06", 700));

  assert.equal(series.length, 1, "a repeated period must never append a duplicate");
  assert.equal(series[0].spendUsd, 700, "the later import is the entry that is kept");
  assert.equal(record(storage).entries.length, 1, "and the persisted record holds one entry too");
});

test("one month billed by two providers is two entries, keyed by scope", () => {
  const storage = memoryStorage();
  recordBriefingSeriesEntry(storage, briefingFor("2026-06", 546.2));
  const series = recordBriefingSeriesEntry(storage, briefingFor("2026-06", 120, {
    provider: { id: "anthropic", name: "Anthropic", confidence: 88 },
  }));

  assert.deepEqual(series.map((entry) => entry.scope), ["anthropic", "openai"]);
  // Two entries, one period: the count a reader is shown is distinct periods.
  assert.equal(briefingSeriesSummary(series).count, 1);
});

// ---------------------------------------------------------------------------
// (b) The read shape: chronological, computed, and never fabricated.
// ---------------------------------------------------------------------------

test("July imported before June reads back June then July", () => {
  const storage = memoryStorage();
  recordBriefingSeriesEntry(storage, briefingFor("2026-07", 610));
  recordBriefingSeriesEntry(storage, briefingFor("2026-06", 546.2));

  assert.deepEqual(readBriefingSeries(storage).map((entry) => entry.period),
    ["2026-06", "2026-07"]);
});

test("stored insertion order is not trusted: the read re-sorts it", () => {
  const storage = memoryStorage({
    [BRIEFING_SERIES_KEY]: JSON.stringify({
      version: BRIEFING_SERIES_VERSION,
      entries: [
        briefingSeriesEntry(briefingFor("2026-09", 3)),
        briefingSeriesEntry(briefingFor("2026-05", 1)),
        briefingSeriesEntry(briefingFor("2026-07", 2)),
      ],
    }),
  });

  assert.deepEqual(readBriefingSeries(storage).map((entry) => entry.period),
    ["2026-05", "2026-07", "2026-09"]);
});

test("a gap month is a gap: April and June do not fabricate a May", () => {
  const storage = memoryStorage();
  recordBriefingSeriesEntry(storage, briefingFor("2026-04", 300));
  const series = recordBriefingSeriesEntry(storage, briefingFor("2026-06", 546.2));

  assert.equal(series.length, 2);
  assert.deepEqual(series.map((entry) => entry.period), ["2026-04", "2026-06"]);
  assert.equal(series.some((entry) => entry.period === "2026-05"), false);
});

test("a single-period series reads back as one entry with its figures", () => {
  const storage = memoryStorage();
  const series = recordBriefingSeriesEntry(storage, briefingFor("2026-06", 546.2));

  assert.equal(series.length, 1);
  assert.deepEqual(series[0], {
    period: "2026-06",
    scope: "openai",
    providerName: "OpenAI",
    capturedAt: "2026-06-28T09:00:00.000Z",
    spendUsd: 546.2,
    recoverableUsd: 402.75,
    confidence: "Medium",
    // What #1106 added: an explicit basis on the entry, and the verification
    // state derived from it. An import is `imported` and verified, always.
    basis: "imported",
    verified: true,
    supersededBy: null,
  });
});

test("the schema version is one top-level integer, not a field on every entry", () => {
  const storage = memoryStorage();
  recordBriefingSeriesEntry(storage, briefingFor("2026-06", 546.2));
  const stored = record(storage);

  assert.equal(stored.version, BRIEFING_SERIES_VERSION);
  assert.equal(Number.isInteger(stored.version), true);
  assert.deepEqual(Object.keys(stored).sort(), ["entries", "version"]);
  assert.equal("version" in stored.entries[0], false,
    "the version belongs to the record, not to each entry");
});

// ---------------------------------------------------------------------------
// (c) Migration off the single key, and every unreadable value.
// ---------------------------------------------------------------------------

test("a browser holding the single-briefing payload migrates to a one-period series", () => {
  const storage = memoryStorage({ [BRIEFING_RETENTION_KEY]: JSON.stringify(legacyPayload()) });

  const series = readBriefingSeries(storage);
  assert.equal(series.length, 1);
  assert.equal(series[0].period, "2026-06");
  assert.equal(series[0].spendUsd, 546.2);
  assert.equal(series[0].recoverableUsd, 402.75);
  assert.equal(series[0].scope, "openai");
  assert.equal(series[0].confidence, "Medium");

  // Persisted, so the next load reads a series rather than migrating again.
  assert.equal(record(storage).entries.length, 1);
  // THE LEGACY KEY IS LEFT IN PLACE, on purpose: it is still the full-fidelity
  // payload the page rehydrates departments, attribution and supplied context
  // from. Only forget removes it.
  assert.notEqual(storage.getItem(BRIEFING_RETENTION_KEY), null);
});

test("an unparseable stored value surfaces as an empty series rather than throwing", () => {
  for (const broken of ["{", "null", "[]", '{"version":99,"entries":[]}', '{"entries":"nope"}']) {
    const storage = memoryStorage({ [BRIEFING_SERIES_KEY]: broken });
    assert.deepEqual(readBriefingSeries(storage), [], `"${broken}" must read as no series`);
  }
  // Entries that survive the parse but say nothing usable are dropped one by
  // one, and a record of only those is empty rather than a row of nulls.
  const partial = memoryStorage({
    [BRIEFING_SERIES_KEY]: JSON.stringify({
      version: BRIEFING_SERIES_VERSION,
      entries: [{ period: "not-a-month" }, null, { period: "2026-06" }],
    }),
  });
  assert.deepEqual(readBriefingSeries(partial), []);
});

test("a browser that refuses storage reads as empty and never throws", () => {
  const denied = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
    removeItem() { throw new Error("denied"); },
  };
  assert.deepEqual(readBriefingSeries(denied), []);
  assert.deepEqual(forgetBriefingSeries(denied), []);
  // A capture the browser refuses to persist still returns the series for THIS
  // render rather than throwing: the briefing on screen is unaffected, and the
  // retention control beside it is the surface that carries the refusal.
  assert.equal(recordBriefingSeriesEntry(denied, legacyPayload()).length, 1);
  assert.deepEqual(readBriefingSeries(undefined), []);
});

test("forget erases every kept period and the legacy record with it", () => {
  const storage = memoryStorage({ [BRIEFING_RETENTION_KEY]: JSON.stringify(legacyPayload()) });
  recordBriefingSeriesEntry(storage, briefingFor("2026-07", 610));
  assert.equal(readBriefingSeries(storage).length, 2);

  assert.deepEqual(forgetBriefingSeries(storage), []);
  assert.equal(storage.jar.has(BRIEFING_SERIES_KEY), false, "removed, not blanked");
  assert.equal(storage.jar.has(BRIEFING_RETENTION_KEY), false,
    "a legacy record left behind would repopulate the series on the next load");
  assert.deepEqual(readBriefingSeries(storage), []);
  // The control says what it does, because it deletes every period, not one.
  assert.match(RETENTION_COPY.forget, /every period/i);
});

// ---------------------------------------------------------------------------
// (d) The boundary: derived figures only, checked against the persisted bytes.
// ---------------------------------------------------------------------------

test("nothing prompt-shaped or raw reaches the persisted record", () => {
  const storage = memoryStorage();
  recordBriefingSeriesEntry(storage, briefingFor("2026-06", 546.2, {
    prompt: "Summarize our June OpenAI spend for the board",
    rawResponse: "The board deck says Atlas Platform overspent",
    rawText: "usage_date,cost\n2026-06-01,12.50",
    fileName: "acme-june-billing.csv",
    records: [{ aggregate_id: "a-1", cost: { amount_minor: 1250 } }],
    apiKey: "sk-live-not-a-real-key",
  }));

  const raw = storage.getItem(BRIEFING_SERIES_KEY);
  for (const forbidden of ["prompt", "rawResponse", "rawText", "fileName", "records",
    "apiKey", "Summarize", "board", "acme-june-billing", "sk-live", "usage_date"]) {
    assert.equal(raw.includes(forbidden), false,
      `the persisted record must not contain "${forbidden}"`);
  }
  // The exact key set of an entry, so a field added upstream cannot ride in.
  assert.deepEqual(Object.keys(JSON.parse(raw).entries[0]).sort(), [
    "basis", "capturedAt", "confidence", "period", "providerName", "recoverableUsd", "scope",
    "spendUsd", "supersededBy", "verified",
  ]);
});

// ---------------------------------------------------------------------------
// (e) The line a reader sees.
// ---------------------------------------------------------------------------

test("the summary states the count and the span, and says nothing when empty", () => {
  const storage = memoryStorage();
  for (const [month, spend] of [["2026-04", 300], ["2026-05", 420], ["2026-06", 546.2]]) {
    recordBriefingSeriesEntry(storage, briefingFor(month, spend));
  }
  assert.equal(briefingSeriesSummary(readBriefingSeries(storage)).label,
    "3 periods on file · Apr–Jun 2026");

  const one = memoryStorage();
  recordBriefingSeriesEntry(one, briefingFor("2026-06", 546.2));
  assert.equal(briefingSeriesSummary(readBriefingSeries(one)).label, "1 period on file · Jun 2026");

  // A span crossing a year names both years rather than eliding one.
  const across = memoryStorage();
  recordBriefingSeriesEntry(across, briefingFor("2025-12", 100));
  recordBriefingSeriesEntry(across, briefingFor("2026-01", 120));
  assert.equal(briefingSeriesSummary(readBriefingSeries(across)).label,
    "2 periods on file · Dec 2025–Jan 2026");

  const empty = briefingSeriesSummary([]);
  assert.equal(empty.label, "", "nothing on file renders nothing, not an empty count");
  assert.equal(empty.count, 0);
  assert.equal(empty.firstPeriod, null);
  assert.deepEqual(briefingSeriesSummary(null).label, "");
});

// ---------------------------------------------------------------------------
// (e2) An estimated month on the record, and the import that takes it over (#1106).
//
// What only this section can catch: that the basis is an explicit field rather
// than an inference, that a record written before it existed reads as imported,
// that an import for an estimated month keeps the estimate and marks it instead
// of overwriting it, and that neither a live nor a superseded estimate reaches
// a realized figure.
// ---------------------------------------------------------------------------

/** The estimator's own output for the bundled example's declared facts. */
const ESTIMATE = estimateFromDeclaredFacts(EXAMPLE_DECLARED_FACTS);

const keepEstimate = (storage, period, estimate = ESTIMATE) =>
  recordEstimatedPeriod(storage, {
    estimate, period, capturedAt: `${period}-01T08:00:00.000Z`,
  });

test("an estimated month is kept with an explicit basis, and says it was never verified", () => {
  const storage = memoryStorage();
  const series = keepEstimate(storage, "2026-07");

  assert.equal(series.length, 1);
  assert.equal(series[0].basis, ENTRY_BASIS.estimated);
  assert.equal(series[0].verified, false, "an estimate is never verified");
  assert.equal(series[0].supersededBy, null, "nothing has taken it over yet");
  // The figures are the estimator's, not re-derived here: the declared bill and
  // the conservative end of its modelled recoverable band.
  assert.equal(series[0].spendUsd, EXAMPLE_DECLARED_FACTS.monthlySpendUsd);
  assert.equal(series[0].recoverableUsd, ESTIMATE.recoverableMonthlyUsd.low);
  // The discriminator is on the entry. It is NOT inferred from a missing
  // provider id: this entry has a scope and a provider name like any other.
  assert.equal(series[0].scope, ESTIMATE_SCOPE);
  assert.equal(series[0].providerName.length > 0, true);
});

test("an import for an estimated month supersedes the estimate and never deletes it", () => {
  const storage = memoryStorage();
  keepEstimate(storage, "2026-07");
  const series = recordBriefingSeriesEntry(storage, briefingFor("2026-07", 610));

  assert.equal(series.length, 2, "the estimate stays on the record beside the import");
  const estimate = series.find((one) => one.basis === ENTRY_BASIS.estimated);
  const imported = series.find((one) => one.basis === ENTRY_BASIS.imported);
  assert.equal(estimate.supersededBy, `2026-07 ${imported.scope}`,
    "the marker names the verified entry that took over");
  assert.equal(estimate.spendUsd, EXAMPLE_DECLARED_FACTS.monthlySpendUsd,
    "and the estimate's own figures are untouched by the import");
  assert.equal(imported.supersededBy, null);
  assert.equal(imported.verified, true);
  // The verified entry drives every realized figure, and the estimate — which
  // is 154,500 USD, orders of magnitude larger — reaches none of them.
  assert.deepEqual(realizedSeries(series).map((one) => [one.period, one.spendUsd]),
    [["2026-07", 610]]);
  assert.equal(briefingSeriesSummary(realizedSeries(series)).label, "1 period on file · Jul 2026");
});

test("a superseded estimate is excluded from realized figures exactly as a live one is", () => {
  const storage = memoryStorage();
  keepEstimate(storage, "2026-06");
  keepEstimate(storage, "2026-07");
  const series = recordBriefingSeriesEntry(storage, briefingFor("2026-06", 546.2));

  const [live] = estimatedSeries(series).filter((one) => one.supersededBy === null);
  assert.equal(live.period, "2026-07", "July's estimate has no import to be taken over by");
  assert.equal(estimatedSeries(series).length, 2);
  // Two estimates and one import: the realized side is the import alone, and
  // its spend is the only spend any aggregate can see.
  assert.deepEqual(realizedSeries(series).map((one) => one.spendUsd), [546.2]);
  assert.equal(realizedSeries(series).every((one) => one.verified), true);
});

test("two estimates for one period replace in place, and one import does not", () => {
  const storage = memoryStorage();
  keepEstimate(storage, "2026-07");
  const series = keepEstimate(storage, "2026-07",
    estimateFromDeclaredFacts({ ...EXAMPLE_DECLARED_FACTS, monthlySpendUsd: 90_000 }));

  assert.equal(series.length, 1, "a re-estimate is a later reading of the same unmeasured month");
  assert.equal(series[0].spendUsd, 90_000, "and the newer estimate is the one kept");
});

test("an entry stored before the basis field existed reads as an imported month", () => {
  // The exact bytes a browser that opted in before #1106 is holding: seven
  // fields, no basis anywhere on the entry or the record.
  const legacy = {
    period: "2026-06", scope: "openai", providerName: "OpenAI",
    capturedAt: "2026-06-28T09:00:00.000Z", spendUsd: 546.2, recoverableUsd: 402.75,
    confidence: "Medium",
  };
  const storage = memoryStorage({
    [BRIEFING_SERIES_KEY]: JSON.stringify({
      version: BRIEFING_SERIES_VERSION, entries: [legacy],
    }),
  });
  const series = readBriefingSeries(storage);

  assert.equal(series[0].basis, ENTRY_BASIS.imported);
  assert.equal(series[0].verified, true);
  assert.equal(realizedSeries(series).length, 1, "it counts as a realized month, as it always did");
  assert.equal(estimatedSeries(series).length, 0);
});

test("a hand-edited file cannot promote its own estimate into a verified month", () => {
  const storage = memoryStorage({
    [BRIEFING_SERIES_KEY]: JSON.stringify({
      version: BRIEFING_SERIES_VERSION,
      entries: [{
        period: "2026-06", scope: "estimated", providerName: "Estimated",
        capturedAt: "2026-06-01T08:00:00.000Z", spendUsd: 999_999, recoverableUsd: 0,
        confidence: "modelled", basis: "estimated", verified: true,
        supersededBy: "2026-06 openai",
      }],
    }),
  });
  const [entry] = readBriefingSeries(storage);

  assert.equal(entry.verified, false, "`verified` is derived from the basis, never read");
  assert.equal(entry.supersededBy, null,
    "and a supersession no imported entry backs is not a supersession");
  assert.equal(realizedSeries(readBriefingSeries(storage)).length, 0);
});

test("an unknown basis is excluded from realized figures rather than counted as one", () => {
  const storage = memoryStorage({
    [BRIEFING_SERIES_KEY]: JSON.stringify({
      version: BRIEFING_SERIES_VERSION,
      entries: [{
        period: "2026-06", scope: "somewhere", providerName: "A newer build",
        capturedAt: "2026-06-28T09:00:00.000Z", spendUsd: 500, recoverableUsd: 0,
        confidence: "Medium", basis: "projected",
      }],
    }),
  });

  assert.equal(realizedSeries(readBriefingSeries(storage)).length, 0,
    "a basis this build does not know is not a measured month");
});

// ---------------------------------------------------------------------------
// (f) The page, wired: the count is painted above the answer.
// ---------------------------------------------------------------------------

async function openFinopsTab(storage = {}) {
  const page = await loadPage(PAGE, {
    storage,
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  // Every asynchronous surface settles before a test touches the page; one left
  // in flight would run on into the next test.
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  await waitFor(() => textOf(document.getElementById("integration-contract-provenance"))
    .startsWith("Gateway completed"), "the static contract gateway to settle");
  await waitFor(() => document.getElementById("finops-evaluation-result")
    .getAttribute("aria-busy") === "false", "the evaluation panel to settle");
  return page;
}

test("the briefing page paints the periods on file above the analysis", async () => {
  const page = await openFinopsTab({
    [BRIEFING_RETENTION_KEY]: JSON.stringify(legacyPayload()),
  });
  const { document } = page;
  try {
    const line = document.getElementById("local-lead-series");
    assert.notEqual(line, undefined, "the summary slot must exist in the shipped document");
    // The load migrated the single kept briefing, so the reader is told what
    // this browser holds — one period, named.
    assert.equal(line.hidden, false);
    assert.equal(textOf(line), "1 period on file · Jun 2026");
    assert.equal(JSON.parse(page.storage.getItem(BRIEFING_SERIES_KEY)).version,
      BRIEFING_SERIES_VERSION);
    // Above the analysis and not inside a disclosure: a count folded into a
    // closed details element is silent in a real browser.
    let node = line.parentNode;
    while (node) {
      assert.notEqual(node.tagName?.toLowerCase(), "details",
        "the count must not be nested inside a disclosure");
      node = node.parentNode;
    }
  } finally {
    page.restore();
  }
});

test("a page with three periods on file names the whole span", async () => {
  const storage = memoryStorage();
  for (const [month, spend] of [["2026-04", 300], ["2026-05", 420], ["2026-06", 546.2]]) {
    recordBriefingSeriesEntry(storage, briefingFor(month, spend));
  }
  const page = await openFinopsTab({
    [BRIEFING_RETENTION_KEY]: JSON.stringify(legacyPayload()),
    [BRIEFING_SERIES_KEY]: storage.getItem(BRIEFING_SERIES_KEY),
  });
  try {
    assert.equal(textOf(page.document.getElementById("local-lead-series")),
      "3 periods on file · Apr–Jun 2026");
  } finally {
    page.restore();
  }
});

test("a reader with nothing kept is shown no count at all", async () => {
  const page = await openFinopsTab();
  try {
    const line = page.document.getElementById("local-lead-series");
    assert.equal(line.hidden, true, "an empty series must render nothing");
    assert.equal(textOf(line), "");
    assert.equal(page.storage.getItem(BRIEFING_SERIES_KEY), null,
      "a load that kept nothing must not write the series key either");
  } finally {
    page.restore();
  }
});

test("the reader's opt-in records the period, and forget clears every one of them", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    // A briefing of the reader's own, imported through the real control.
    const input = document.getElementById("local-finops-files");
    input.files = [{
      name: "openai-native.csv",
      type: "text/csv",
      text: async () => NATIVE_OPENAI,
    }];
    input.dispatchEvent(new DomEvent("change", { bubbles: true }));
    await waitFor(() => !document.getElementById("local-results").hidden,
      "the imported briefing to render");

    // The import alone writes nothing: the series is as opt-in as the briefing.
    assert.equal(page.storage.getItem(BRIEFING_SERIES_KEY), null);
    assert.equal(document.getElementById("local-lead-series").hidden, true);

    document.getElementById("local-lead-retention-toggle").click();
    const stored = JSON.parse(page.storage.getItem(BRIEFING_SERIES_KEY));
    assert.equal(stored.version, BRIEFING_SERIES_VERSION);
    assert.equal(stored.entries.length, 1, "the opt-in records the imported period");
    assert.match(stored.entries[0].period, /^\d{4}-\d{2}$/);
    assert.match(textOf(document.getElementById("local-lead-series")),
      /^1 period on file · \w{3} \d{4}$/);

    document.getElementById("local-lead-retention-forget").click();
    assert.equal(page.storage.getItem(BRIEFING_SERIES_KEY), null,
      "forget must remove every kept period, not blank the record");
    assert.equal(page.storage.getItem(BRIEFING_RETENTION_KEY), null);
    assert.equal(textOf(document.getElementById("local-lead-series")), "");
  } finally {
    page.restore();
  }
});
