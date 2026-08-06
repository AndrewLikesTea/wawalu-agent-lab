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
  leadWithWorkedDecision, renderTrackRecord, trackRecordModel,
} from "../src/finops-track-record.js";
import { BRIEFING_SERIES_KEY, recordBriefingSeriesEntry } from "../src/finops-briefing-series.js";
import { FIRST_RUN_IDS } from "../src/finops-first-run.js";
import { STAND_IDS } from "../src/finops-stand.js";
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

/* --------- 7. which of the two blocks a first visit meets first ------------- */

// A visitor arrives from the homepage's claim that a worked decision is already
// computed here, and the first thing under the page's name was this header's
// EMPTIEST state: an answer about a file they were never asked to bring. So
// while this browser is keeping no period, the bundled worked decision leads and
// this header reads under it. Nothing is duplicated and nothing is hidden — the
// same nodes move, and they move back the moment a period is on file.

/** Every element under `main`, in reading order. */
function readingOrder(document) {
  const out = [];
  const visit = (node) => {
    for (const child of node?.children ?? []) {
      if (child?.nodeType !== 1) continue;
      out.push(child);
      visit(child);
    }
  };
  visit(document.getElementById("main-content"));
  return out;
}

/** The element children of a node, as ids — the shared-parent instrument. */
const childIds = (node) =>
  [...node.children].filter((child) => child.nodeType === 1).map((child) => child.id);

const CONTROLS = ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"];

/** The controls a keyboard reader reaches under `main`, in the order they come. */
const reachable = (order) => order
  .filter((node) => CONTROLS.includes(node.tagName))
  .filter((node) => !node.hidden && !node.closest("[hidden]")
    && node.getAttribute("tabindex") !== "-1");

test("with no period on file, the worked decision leads and the header reads under it", async () => {
  const page = await openFinopsTab();
  try {
    const { document } = page;
    assert.equal(document.getElementById(TRACK_RECORD_IDS.region).dataset.state,
      TRACK_RECORD_STATE.none);

    // The page's own name first, then the answer this page promises before any
    // file is chosen — not the empty state of a record nobody started.
    const blocks = childIds(document.getElementById("main-content"));
    assert.equal(blocks[0], "finops-hero", "the page's own name no longer comes first");
    assert.equal(blocks[1], FIRST_RUN_IDS.region,
      "the first block under the page's name is not the worked decision");

    // It is the whole worked decision that moved, not a summary of it: the
    // per-successful-task position and the named first action came with it.
    assert.match(textOf(document.getElementById(FIRST_RUN_IDS.peerValue)),
      /per successful task/);
    assert.match(textOf(document.getElementById(FIRST_RUN_IDS.action)), /\S/,
      "the worked decision arrived without its named first action");
    // And so did the label that says whose figures these are. Once, because the
    // block moved rather than being copied: two labels is two claims to keep
    // true and one more thing for a screen reader to read out.
    assert.match(textOf(document.getElementById(FIRST_RUN_IDS.sample)),
      /Bundled synthetic example/);
    assert.equal(document.querySelectorAll(`#${FIRST_RUN_IDS.sample}`).length, 1);
  } finally {
    page.restore();
  }
});

test("with no period on file, the header sits directly below the worked decision", async () => {
  const page = await openFinopsTab();
  try {
    const { document } = page;
    const region = document.getElementById(TRACK_RECORD_IDS.region);
    const worked = document.getElementById(FIRST_RUN_IDS.region);
    // Siblings, so the comparison below is over one list rather than two.
    assert.equal(region.parentNode === worked.parentNode, true,
      "the two blocks are no longer in one parent, so neither is 'directly below' the other");
    const order = childIds(region.parentNode);
    assert.ok(order.indexOf(TRACK_RECORD_IDS.region) > order.indexOf(FIRST_RUN_IDS.region),
      `the header did not follow the worked decision: ${order.slice(0, 4).join(", ")}`);
    assert.equal(order.indexOf(TRACK_RECORD_IDS.region),
      order.indexOf(FIRST_RUN_IDS.region) + 1, "something was drawn between the two blocks");

    // Still the invitation, still naming the one step that starts a record, and
    // still visible rather than folded away to make room above it.
    assert.equal(document.querySelectorAll(`#${TRACK_RECORD_IDS.context}`).length, 1);
    assert.match(textOf(document.getElementById(TRACK_RECORD_IDS.context)),
      /^No track record on file.*Importing one provider export/s);
    assert.equal(region.hidden, false);
    assert.equal(ancestorTags(region).includes("details"), false);
  } finally {
    page.restore();
  }
});

test("the first period on file puts both blocks back in the slots the markup gave them", () => {
  // The move is undone in the same tab it happened in: a reader who imports an
  // export mid-session must not be left with an invented company's result above
  // their own record. Held here rather than through a boot, because this is the
  // transition — none, then a period — and it has to be exact.
  const document = parseHtml(HTML);
  const authored = childIds(document.getElementById("main-content"));
  const heroChildren = childIds(document.getElementById("finops-hero"));

  leadWithWorkedDecision(document, trackRecordModel({ series: [] }));
  assert.notDeepEqual(childIds(document.getElementById("main-content")), authored,
    "nothing moved, so there is no restore to test");

  leadWithWorkedDecision(document, trackRecordModel({ series: [entry("2026-06", 1000)] }));
  assert.deepEqual(childIds(document.getElementById("main-content")), authored);
  assert.deepEqual(childIds(document.getElementById("finops-hero")), heroChildren);
});

test("a browser with a period on file is given the header first, exactly as authored", async () => {
  const page = await openFinopsTab(keptStorage({ months: [["2026-06", 1000]] }));
  try {
    const { document } = page;
    assert.equal(document.getElementById(TRACK_RECORD_IDS.region).dataset.state,
      TRACK_RECORD_STATE.single);
    const order = readingOrder(document).map((node) => node.id);
    assert.ok(order.indexOf(TRACK_RECORD_IDS.region) < order.indexOf(FIRST_RUN_IDS.region),
      "a browser keeping a period must meet its own record before the bundled example");
    // Authored parentage, untouched: the header in the hero, the worked decision
    // back in the slot the markup gave it, below the answer region.
    assert.equal(document.getElementById(TRACK_RECORD_IDS.region).parentNode.id, "finops-hero");
    const blocks = childIds(document.getElementById("main-content"));
    // #1183 inserted the recoverable answer between the hero and the headline.
    // Both still sit above every supporting section, and neither moved because
    // this browser has a period on file.
    assert.equal(blocks[1], "finops-recoverable-answer",
      "the recoverable answer no longer follows the hero");
    assert.equal(blocks[2], STAND_IDS.region, "the answer region no longer follows the hero");
  } finally {
    page.restore();
  }
});

test("leading with the worked decision spends no tab stop and reorders no control", async () => {
  const page = await openFinopsTab();
  try {
    const { document } = page;
    const order = readingOrder(document);
    const worked = order.findIndex((node) => node.id === FIRST_RUN_IDS.region);
    const above = reachable(order.slice(0, worked));

    // Read off the page as it stands, not chosen. Everything above the worked
    // decision is now the hero, and the hero carries no control at all — so the
    // move spent nothing: the first control a keyboard reader reaches after the
    // skip link's destination is still the first control of an answer. The count
    // is EXACT so that a control added up here — where the first screen's tab
    // budget is already spent — turns this red rather than quietly landing
    // between that destination and the answer a reader came for.
    assert.equal(above.length, 0,
      `${above.map((node) => node.id || node.tagName).join(", ")} sits above the worked decision`);

    // Tab order follows visual order because the block that moved BELOW the
    // worked decision brought no control with it: this state names its step in
    // the sentence instead. So nothing reached earlier now reads later.
    const region = document.getElementById(TRACK_RECORD_IDS.region);
    assert.equal(region.querySelectorAll("a, button, input, select, textarea").length, 0);
    // And the worked decision's own controls are still reached, in its own order.
    const within = reachable(order).filter((node) => node.closest(`#${FIRST_RUN_IDS.region}`));
    assert.ok(within.length > 0, "the worked decision's controls stopped being reachable");
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
