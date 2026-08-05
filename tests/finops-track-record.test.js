// The track-record header at the top of /evolution.html (#1091).
//
// What only this file can catch: that the header leads with the question and
// carries FOUR things — one figure, one badge, one context line, one action —
// that the single action is derived rather than listed and changes across every
// branch, that a browser holding nothing and a browser holding one month get
// their own honest sentences instead of a zero dressed as a measurement, and
// that the figure, the badge and the action are structurally OUTSIDE the
// collapsed disclosure.
//
// That last one is why the parentNode walk below exists rather than a text
// assertion: this harness's `textOf` reads straight through a closed details
// element, so "the text is there" proves nothing about what a real browser
// announces when it is shut. The structure is the assertion.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  TRACK_RECORD_IDS, TRACK_RECORD_QUESTION, TRACK_RECORD_STATE,
  renderTrackRecord, trackRecordModel,
} from "../src/finops-track-record.js";
import { BRIEFING_SERIES_KEY, recordBriefingSeriesEntry } from "../src/finops-briefing-series.js";
import {
  FINOPS_CONSENT, retainApprovedCommitment, setFinopsConsent,
} from "../src/finops-workspace.js";
import { LOAD_NARRATION } from "../src/finops-load-status.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const HTML = await readFile(PAGE, "utf8");
const DEMO_DATA = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(await readFile(
  new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const NOW = new Date("2026-08-02T10:00:00.000Z");

/** One entry in the read shape `readBriefingSeries` returns. */
const entry = (period, spendUsd, recoverableUsd = 100) => ({
  period,
  scope: "openai",
  providerName: "OpenAI",
  capturedAt: `${period}-28T09:00:00.000Z`,
  spendUsd,
  recoverableUsd,
  confidence: "Medium",
});

/** The fields the scorer reads off a retained commitment record. */
const commitmentOf = ({ period = "2026-06", savingMinor = 60_000 } = {}) => ({
  commitmentId: "route-support-triage-to-haiku",
  claim: {
    baselineMonthlyCostMinor: 100_000,
    projectedMonthlyCostMinor: 40_000,
    monthlySavingsMinor: savingMinor,
    currency: "USD",
    unit: "usd_minor",
    period,
  },
  periodId: `user:${period}`,
});

/** June and July on file: 1,000 USD then 400 USD, a realized 600 USD. */
const TWO_MONTHS = [entry("2026-06", 1000), entry("2026-07", 400)];

/** The shipped document, with the header painted into the region it authors. */
function painted(model) {
  const document = parseHtml(HTML);
  renderTrackRecord(document, model);
  return document;
}

const region = (document) => document.getElementById(TRACK_RECORD_IDS.region);
const countOf = (document, selector) => region(document).querySelectorAll(selector).length;

/** Every ancestor of a node, as tag names. The disclosure test's instrument. */
function ancestorTags(node) {
  const tags = [];
  let walk = node?.parentNode ?? null;
  while (walk) {
    if (walk.tagName) tags.push(walk.tagName.toLowerCase());
    walk = walk.parentNode;
  }
  return tags;
}

/* ------------------- 0. what the document ships without script ------------- */

test("the header ships authored, above the answer region, outside any disclosure", () => {
  const document = parseHtml(HTML);
  assert.equal(textOf(document.getElementById(TRACK_RECORD_IDS.question)), TRACK_RECORD_QUESTION);
  // Above the answer region: a reader meets last month's grade before this
  // month's snapshot, which is the whole reason this header exists.
  assert.equal(HTML.indexOf(`id="${TRACK_RECORD_IDS.region}"`) < HTML.indexOf('id="finops-answer"'),
    true, "the track record must be authored above the answer region");
  // Outside every disclosure on the way up: a header folded into a shut
  // details element is a header nobody is read.
  assert.equal(ancestorTags(region(document)).includes("details"), false);
  // NO CONTROL OF ITS OWN on the screen a first visit lands on. The step this
  // state names — import an export — is already the first screen's own primary
  // action, and a second copy of one action competes with it at the same weight
  // and puts another tab stop between the skip link's destination and the
  // control a keyboard reader came for. That budget is held by
  // tests/finops-pre-analysis-empty-state.test.js, and this is the assertion
  // that keeps this header from spending it.
  assert.equal(countOf(document, "[data-track-record-action]"), 0);
  assert.equal(countOf(document, "a, button, input, select, textarea"), 0);
  // The step is still named, in the sentence rather than in a second button.
  assert.match(textOf(document.getElementById(TRACK_RECORD_IDS.context)),
    /Importing one provider export keeps the month it covers and starts the record\.$/);
});

test("a first visit renders the no-record sentence and no figure or row at all", () => {
  const document = parseHtml(HTML);
  // The authored state IS the honest first-visit state, not a placeholder the
  // script has to correct: a browser that never runs the module still reads a
  // true sentence rather than a zero waiting to be filled in.
  assert.equal(region(document).dataset.state, TRACK_RECORD_STATE.none);
  assert.equal(countOf(document, `#${TRACK_RECORD_IDS.context}`), 1);
  assert.match(textOf(document.getElementById(TRACK_RECORD_IDS.context)),
    /^No track record on file: this browser is keeping no period\./);
  assert.equal(countOf(document, `#${TRACK_RECORD_IDS.figure}`), 0);
  assert.equal(countOf(document, `#${TRACK_RECORD_IDS.verdict}`), 0);
  assert.equal(countOf(document, "details"), 0);
  assert.equal(countOf(document, ".track-record-row"), 0);
});

/* --------------------------- 1. the header itself -------------------------- */

test("the header leads with the question and carries one figure, one badge, one action", () => {
  const model = trackRecordModel({ series: TWO_MONTHS, commitment: commitmentOf() });
  assert.equal(model.state, TRACK_RECORD_STATE.scored);
  const document = painted(model);

  assert.equal(textOf(document.getElementById(TRACK_RECORD_IDS.question)), TRACK_RECORD_QUESTION);
  // One material figure, and the comparison readable in it rather than split
  // across two labelled boxes.
  assert.equal(textOf(document.getElementById(TRACK_RECORD_IDS.figure)),
    "600 USD realized of 600 USD committed");
  assert.equal(countOf(document, `#${TRACK_RECORD_IDS.figure}`), 1);
  // Exactly one next-action control. A second one is a menu, not an action.
  assert.equal(countOf(document, "[data-track-record-action]"), 1);
  assert.equal(document.getElementById(TRACK_RECORD_IDS.action).getAttribute("href"),
    "/savings-commitment.html");
  assert.equal(countOf(document, `#${TRACK_RECORD_IDS.verdict}`), 1);
  assert.equal(countOf(document, `#${TRACK_RECORD_IDS.context}`), 1);
});

test("the figure is labelled as a sentence, not two orphaned numbers", () => {
  const document = painted(trackRecordModel({ series: TWO_MONTHS, commitment: commitmentOf() }));
  const figure = document.getElementById(TRACK_RECORD_IDS.figure);
  assert.equal(figure.getAttribute("aria-label"),
    "Realized 600 USD of the 600 USD monthly saving committed for Jun 2026, measured against "
    + "Jul 2026.");
});

test("a month where spend rose is stated as a rise, never as a negative saving", () => {
  const model = trackRecordModel({
    series: [entry("2026-06", 1000), entry("2026-07", 1200)],
    commitment: commitmentOf(),
  });
  assert.equal(model.verdict.text, "Missed");
  assert.equal(model.figure.text, "Spend rose 200 USD against 600 USD committed");
});

/* ------------------------- 2. the verdict badge ---------------------------- */

test("the verdict is carried as text, not by a class or a colour alone", () => {
  for (const [spend, word] of [[400, "Met"], [700, "Partially met"], [1200, "Missed"]]) {
    const document = painted(trackRecordModel({
      series: [entry("2026-06", 1000), entry("2026-07", spend)],
      commitment: commitmentOf(),
    }));
    const badge = document.getElementById(TRACK_RECORD_IDS.verdict);
    assert.equal(textOf(badge), word, `${spend} must read as "${word}" in the badge's own text`);
    // The attribute is a hook for a rule, never the place the meaning lives.
    assert.equal(badge.dataset.grade !== undefined, true);
  }
});

/* --------------------- 3. the single action, derived ----------------------- */

test("the next action changes across every branch it is derived from", () => {
  const actionFor = (input) => trackRecordModel(input).action.text;

  // Nothing kept: the first import is the only thing that starts a record.
  assert.equal(actionFor({ series: [] }), "Import a provider export to start the record");
  // One month: a track record needs a second period before anything moves.
  assert.equal(actionFor({ series: [entry("2026-06", 1000)] }), "Import a second period");
  // A commitment whose closing month was never imported: import that month.
  assert.equal(actionFor({
    series: [entry("2026-06", 1000), entry("2026-08", 400)],
    commitment: commitmentOf(),
  }), "Import Jul 2026 to close out the commitment");
  // Closed out and scored: the next thing is the next commitment.
  assert.equal(actionFor({ series: TWO_MONTHS, commitment: commitmentOf() }),
    "Commit to the next action");
  // Months on file and nothing committed against them: the same next step.
  assert.equal(actionFor({ series: TWO_MONTHS }), "Commit to the next action");
});

test("an open commitment names the month that would close it, with no figure yet", () => {
  const model = trackRecordModel({
    series: [entry("2026-06", 1000), entry("2026-08", 400)],
    commitment: commitmentOf(),
  });
  assert.equal(model.state, TRACK_RECORD_STATE.awaiting);
  assert.equal(model.figure, null, "an unmeasured commitment must render no figure");
  assert.equal(model.verdict.text, "Not enough evidence");
  assert.match(model.context, /Jul 2026 is not on file/);
});

/* ----------------------- 4. empty and single states ------------------------ */

test("with no series the header says there is no track record, and shows no figure", () => {
  const model = trackRecordModel({ series: [] });
  assert.equal(model.state, TRACK_RECORD_STATE.none);
  assert.equal(model.rows.length, 0, "nothing on file is zero rows, not one empty one");

  const document = painted(model);
  // "on file" rather than "yet": this region sits in the hero's explanation
  // zone, where no line may say what has not happened — the plainness is the
  // requirement, and that vocabulary is spoken for.
  assert.match(textOf(document.getElementById(TRACK_RECORD_IDS.context)),
    /^No track record on file: this browser is keeping no period\./);
  // No figure, no badge, no disclosure, and no row: a zero dressed as a
  // measurement is worse than an absent one, because a reader forwards it.
  assert.equal(countOf(document, `#${TRACK_RECORD_IDS.figure}`), 0);
  assert.equal(countOf(document, `#${TRACK_RECORD_IDS.verdict}`), 0);
  assert.equal(countOf(document, "details"), 0);
  assert.equal(countOf(document, ".track-record-row"), 0);
  assert.equal(region(document).dataset.state, TRACK_RECORD_STATE.none);
  // The step is still named — in the sentence, because the first screen already
  // carries that exact control as its primary action.
  assert.equal(countOf(document, "[data-track-record-action]"), 0);
  assert.equal(model.action.text, "Import a provider export to start the record");
});

test("one period gets its own message rather than the multi-period figure", () => {
  const model = trackRecordModel({
    series: [entry("2026-06", 1000)], commitment: commitmentOf(),
  });
  assert.equal(model.state, TRACK_RECORD_STATE.single);

  const document = painted(model);
  assert.equal(countOf(document, `#${TRACK_RECORD_IDS.figure}`), 0);
  assert.equal(textOf(document.getElementById(TRACK_RECORD_IDS.context)),
    "A track record needs a second period. One month is on file — Jun 2026 — so there is no "
    + "movement to measure.");
  assert.equal(countOf(document, ".track-record-row"), 1, "the one month on file is still listed");
});

test("no state of the header narrates a load or says what has not happened", () => {
  const states = [
    { series: [] },
    { series: [entry("2026-06", 1000)] },
    { series: TWO_MONTHS },
    { series: [entry("2026-06", 1000), entry("2026-08", 400)], commitment: commitmentOf() },
    { series: TWO_MONTHS, commitment: commitmentOf() },
  ];
  for (const input of states) {
    const model = trackRecordModel(input);
    const said = [model.context, model.action.text, model.figure?.text, model.verdict?.text]
      .filter(Boolean).join(" ");
    // This region is inside the hero's explanation zone, which is held to both
    // of these by tests/finops-first-screen-copy.js. A state added here without
    // reading that file would otherwise fail in someone else's suite.
    assert.doesNotMatch(said, LOAD_NARRATION, `${model.state} narrates a load`);
    assert.doesNotMatch(said, /\bpending\b|\byet\b/i, `${model.state} says what has not happened`);
  }
});

/* ------------- 4b. estimated months: never realized, always labelled ------- */
//
// What only this section can catch: that an estimate on the record — live or
// superseded — is absent from every FIGURE the header states, asserted on the
// numbers rather than on the absence of a word; that a month holding both
// states the miss in one sentence with a direction and a size; and that a month
// holding one of the two states nothing.

/** An estimated entry in the read shape the store returns. */
const estimated = (period, spendUsd, supersededBy = null) => ({
  period,
  scope: "estimated",
  providerName: "Estimated from declared facts",
  capturedAt: `${period}-01T08:00:00.000Z`,
  spendUsd,
  recoverableUsd: 0,
  confidence: "modelled",
  basis: "estimated",
  verified: false,
  supersededBy,
});

test("aggregates, trends and the verdict read realized months only", () => {
  // June and July imported at 1,000 and 400 — a realized 600 against a 600
  // commitment. Beside them: July's estimate, already superseded, and an
  // August estimate nothing has measured. Both are enormous on purpose.
  const withEstimates = trackRecordModel({
    series: [
      ...TWO_MONTHS,
      estimated("2026-07", 900_000, "2026-07 openai"),
      estimated("2026-08", 900_000),
    ],
    commitment: commitmentOf(),
  });
  const realizedOnly = trackRecordModel({ series: TWO_MONTHS, commitment: commitmentOf() });

  // Every figure is the one the realized months alone produce.
  assert.equal(withEstimates.state, realizedOnly.state);
  assert.equal(withEstimates.figure.text, "600 USD realized of 600 USD committed");
  assert.equal(withEstimates.figure.sentence, realizedOnly.figure.sentence);
  assert.equal(withEstimates.verdict.text, "Met");
  // The span and the count: two periods, June to July. August's estimate is not
  // a month this record has reached.
  assert.equal(withEstimates.summary, "2 periods on file · Jun–Jul 2026");
  assert.equal(withEstimates.summary, realizedOnly.summary);
  // The trend: July fell 600 USD from June, and no row reports a movement
  // against an estimate.
  const movements = withEstimates.rows.map((row) => row.movement);
  assert.deepEqual(movements,
    ["No earlier month on file", "Fell 600 USD", "Not measured", "Not measured"]);
});

test("an estimate is labelled as one in every row it appears in", () => {
  const document = painted(trackRecordModel({
    series: [...TWO_MONTHS, estimated("2026-08", 900_000)],
    commitment: commitmentOf(),
  }));
  const rows = document.querySelectorAll(".track-record-row");
  assert.equal(rows.length, 3);
  assert.deepEqual([...rows].map((row) => row.dataset.basis),
    ["imported", "imported", "estimated"]);
  // The word is in the row's own text, not only in a data attribute: a reader
  // who cannot see a stylesheet still reads what this month is.
  assert.match(textOf(rows[2].querySelector("th")), /Estimated · not measured$/);
  assert.equal(textOf(rows[2].querySelectorAll("td")[2]), "Not measured");
  assert.equal(textOf(rows[2].querySelectorAll("td")[3]), "Estimate · not scored");
});

test("a month holding both states the miss with its direction and its size", () => {
  const model = trackRecordModel({
    // July's estimate said 500 USD; the import came in at 400 USD.
    series: [...TWO_MONTHS, estimated("2026-07", 500, "2026-07 openai")],
    commitment: commitmentOf(),
  });
  assert.equal(model.estimateDeltas.length, 1);
  assert.equal(model.estimateDeltas[0],
    "Jul 2026: the estimate said 500 USD and the imported month came in at 400 USD — the "
    + "estimate was over by 100 USD.");

  const document = painted(model);
  assert.equal(countOf(document, "[data-estimate-delta]"), 1);
  assert.equal(textOf(document.getElementById(TRACK_RECORD_IDS.estimateDelta)),
    model.estimateDeltas[0]);
  // Outside the disclosure: the sentence a reader came back for is not folded
  // into a shut details element.
  assert.equal(
    ancestorTags(document.getElementById(TRACK_RECORD_IDS.estimateDelta)).includes("details"),
    false);
  // The other direction, in the same sentence shape.
  assert.equal(trackRecordModel({
    series: [...TWO_MONTHS, estimated("2026-07", 250, "2026-07 openai")],
  }).estimateDeltas[0],
  "Jul 2026: the estimate said 250 USD and the imported month came in at 400 USD — the "
  + "estimate was under by 150 USD.");
});

test("a month holding only one of the two states no delta at all", () => {
  // An estimate for a month nothing has imported.
  const onlyEstimate = trackRecordModel({
    series: [...TWO_MONTHS, estimated("2026-09", 500)], commitment: commitmentOf(),
  });
  assert.deepEqual(onlyEstimate.estimateDeltas, []);
  assert.equal(countOf(painted(onlyEstimate), "[data-estimate-delta]"), 0);

  // And imported months with no estimate anywhere near them.
  const onlyImports = trackRecordModel({ series: TWO_MONTHS, commitment: commitmentOf() });
  assert.deepEqual(onlyImports.estimateDeltas, []);
  assert.equal(countOf(painted(onlyImports), "[data-estimate-delta]"), 0);
});

test("a browser holding estimates and no import has no track record and says so", () => {
  const model = trackRecordModel({ series: [estimated("2026-08", 900_000)] });

  assert.equal(model.state, TRACK_RECORD_STATE.none);
  assert.equal(model.figure, null, "an estimate is never a figure this header states");
  assert.equal(model.summary, "");
  assert.match(model.context,
    /1 estimated month is on file, and it counts towards nothing here until the month is imported\.$/);
  // It is still visible and still labelled — one row, marked as an estimate.
  const document = painted(model);
  assert.equal(countOf(document, ".track-record-row"), 1);
  assert.equal(document.querySelector(".track-record-row").dataset.basis, "estimated");
});

/* ------------------- 5. the disclosure, and what is outside it -------------- */

test("the per-period detail is collapsed by default and lists every period", () => {
  const document = painted(trackRecordModel({
    series: [...TWO_MONTHS, entry("2026-08", 380)], commitment: commitmentOf(),
  }));
  const details = document.getElementById(TRACK_RECORD_IDS.detail);
  assert.equal(countOf(document, `#${TRACK_RECORD_IDS.detail}`), 1);
  assert.equal(details.hasAttribute("open"), false, "the detail must ship collapsed");
  // Native disclosure: focusable and operable by keyboard with no script at all.
  assert.equal(details.querySelectorAll("summary").length, 1);
  // The accessible name says what it reveals AND how many periods.
  assert.equal(textOf(details.querySelector("summary")),
    "Show each period: spend, modelled saving, realized movement and verdict (3 periods)");
  assert.equal(details.querySelectorAll(".track-record-row").length, 3);
  // Every row carries the five things a reader came for.
  const first = details.querySelectorAll(".track-record-row")[1];
  assert.equal(textOf(first.querySelectorAll("td")[0]), "400 USD");
  assert.equal(textOf(first.querySelectorAll("td")[2]), "Fell 600 USD");
  assert.equal(textOf(first.querySelectorAll("td")[3]), "Met");
});

test("the figure, the badge and the action are outside the disclosure", () => {
  const document = painted(trackRecordModel({ series: TWO_MONTHS, commitment: commitmentOf() }));
  for (const id of [TRACK_RECORD_IDS.figure, TRACK_RECORD_IDS.verdict,
    TRACK_RECORD_IDS.action, TRACK_RECORD_IDS.context, TRACK_RECORD_IDS.question]) {
    const node = document.getElementById(id);
    assert.equal(ancestorTags(node).includes("details"), false,
      `${id} must not be nested inside the disclosure — it is silent there when it is shut`);
  }
  // And the disclosure really is in the same region, so the check has teeth.
  assert.equal(ancestorTags(document.getElementById(TRACK_RECORD_IDS.detail))
    .includes("section"), true);
});

/* ----------------------------- 6. the page, wired -------------------------- */

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
  // Every asynchronous surface settles before a test touches the page: one left
  // in flight runs on into the teardown and fails the file, not the assertion.
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  await waitFor(() => textOf(document.getElementById("integration-contract-provenance"))
    .startsWith("Gateway completed"), "the static contract gateway to settle");
  await waitFor(() => document.getElementById("finops-evaluation-result")
    .getAttribute("aria-busy") === "false", "the evaluation panel to settle");
  return page;
}

/** A browser that kept these months, and optionally a commitment beside them. */
function keptStorage({ months = [], commitment = null } = {}) {
  const jar = new Map();
  const storage = {
    getItem: (key) => (jar.has(key) ? jar.get(key) : null),
    setItem: (key, value) => { jar.set(key, String(value)); },
    removeItem: (key) => { jar.delete(key); },
  };
  for (const [period, spendUsd] of months) {
    recordBriefingSeriesEntry(storage, {
      version: 1,
      capturedAt: `${period}-28T09:00:00.000Z`,
      provider: { id: "openai", name: "OpenAI", confidence: 92 },
      confidence: "Medium",
      totals: { analyzedSpendUsd: spendUsd, recoverableUsd: 120, period },
    });
  }
  if (commitment) {
    setFinopsConsent(storage, FINOPS_CONSENT.granted, { now: NOW });
    const kept = retainApprovedCommitment(storage, {
      metadata: commitment, approvedAt: NOW.toISOString(),
    }, { now: NOW });
    assert.equal(kept.ok, true, kept.message);
  }
  return Object.fromEntries(jar);
}

/** The commitment shape the workspace store accepts, claim and all. */
const retainableCommitment = (period = "2026-06") => ({
  schemaVersion: "shiplog-finops-commitment/1.0.0",
  ...commitmentOf({ period }),
  confidence: { percent: 78, band: "high" },
  provenance: { designation: "imported", analysisPeriod: period, recordCount: 2 },
  recommendedAction: {
    workloadId: "support-triage",
    departmentId: "customer-support",
    fromModelId: "opus-tier",
    toModelId: "haiku-tier",
  },
});

test("the shipped page opens on the question, with nothing kept", async () => {
  const page = await openFinopsTab();
  try {
    const { document } = page;
    assert.equal(textOf(document.getElementById(TRACK_RECORD_IDS.question)),
      TRACK_RECORD_QUESTION);
    assert.equal(document.getElementById(TRACK_RECORD_IDS.region).dataset.state,
      TRACK_RECORD_STATE.none);
    assert.match(textOf(document.getElementById(TRACK_RECORD_IDS.context)),
      /^No track record on file/);
    // The shipped page's own primary action is the one control for this state,
    // so the header adds none: see the authored-header test above.
    assert.equal(document.querySelectorAll("[data-track-record-action]").length, 0);
    // Above the snapshot analysis, and not inside any disclosure on the way up.
    assert.equal(ancestorTags(document.getElementById(TRACK_RECORD_IDS.region))
      .includes("details"), false);
  } finally {
    page.restore();
  }
});

test("a browser holding two months and a commitment is shown the grade", async () => {
  const page = await openFinopsTab(keptStorage({
    months: [["2026-06", 1000], ["2026-07", 400]],
    commitment: retainableCommitment("2026-06"),
  }));
  try {
    const { document } = page;
    assert.equal(document.getElementById(TRACK_RECORD_IDS.region).dataset.state,
      TRACK_RECORD_STATE.scored);
    assert.equal(textOf(document.getElementById(TRACK_RECORD_IDS.figure)),
      "600 USD realized of 600 USD committed");
    assert.equal(textOf(document.getElementById(TRACK_RECORD_IDS.verdict)), "Met");
    assert.equal(textOf(document.getElementById(TRACK_RECORD_IDS.action)),
      "Commit to the next action");
    assert.equal(document.getElementById(TRACK_RECORD_IDS.detail).hasAttribute("open"), false);
    assert.equal(page.storage.getItem(BRIEFING_SERIES_KEY) !== null, true);
  } finally {
    page.restore();
  }
});
