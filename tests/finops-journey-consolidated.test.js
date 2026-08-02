// The consolidated FinOps journey, read the way a lead and a keyboard read it.
//
// Three states, because they are the three a lead actually arrives in: a *new*
// review with nothing retained, a *resumed* review whose action is chosen and
// whose evidence is still short, and a *verification-ready* review waiting on a
// checkpoint. Each is driven through the real entry module on the real page
// markup, so what is asserted is what a reader would meet — rendered text,
// roles and labels, and what a disclosure does when it is pressed. No snapshots.
//
// The fixtures are the same shapes the shipped journey tests already use, built
// here from the bundled example records rather than committed as a file.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml, pressEnter, pressSpace, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { MONTHLY_ACTION_VERSION } from "../src/monthly-department-action-store.js";
import { REVIEW_EVIDENCE_KEY, REVIEW_EVIDENCE_VERSION } from "../src/recurring-review-readiness.js";
import {
  JOURNEY_PHASE, JOURNEY_QUESTION, actionHref, consolidateJourney, verificationCheckpoint,
} from "../src/finops-journey-consolidated.js";
import { renderConsolidatedJourney } from "../src/finops-journey-consolidated-view.js";

const PAGE = new URL("../src/savings-action-center.html", import.meta.url);
const ACTION_KEY = "shiplog.finops.monthly-department-action.v1";
// The day the bundled next-step fixtures were authored against. Injected, never
// read from a clock, so every phase below is pinned to one date.
const TODAY = "2026-07-15T09:00:00.000Z";

const action = (overrides = {}) => ({
  schemaVersion: MONTHLY_ACTION_VERSION,
  decisionVersion: "monthly-department-decision/1.0.0",
  actionId: "route-short-lookups",
  actionLabel: "Route short lookups to the efficient model",
  department: "Atlas Platform",
  ownerLabel: "AI Platform product owner",
  baseline: {
    value: 1200, unit: "USD/month", period: "2026-06",
    aggregation: "Monthly eligible recoverable spend",
    calculation: "Sum eligible row deltas",
  },
  target: {
    value: 0, unit: "USD/month remaining avoidable spend",
    deadline: "2026-07-31", calculation: "baseline minus verified reduction",
  },
  reviewPeriod: "2026-07",
  confidence: "high",
  provenanceReferences: ["fix-pack:1"],
  committedAt: "2026-06-30T12:00:00.000Z",
  ...overrides,
});

const analysis = (period = "2026-07", value = 900) => ({
  schemaVersion: "local-finops/1.0.0",
  period,
  rankedDepartments: [{ name: "Atlas Platform", recoverableUsd: value }],
});

const verdict = (overrides = {}) => ({
  state: "all_clear", measured: true, coveragePercent: 96, rows: 24, confidence: "high", ...overrides,
});

const evidence = (currentAnalysis, theoVerdict) => JSON.stringify({
  schemaVersion: REVIEW_EVIDENCE_VERSION, currentAnalysis, theoVerdict,
});

/**
 * The three journeys, as this browser's own storage would hold them.
 *
 * `new` holds nothing at all. `resumed` holds a committed action whose current
 * analysis is from the baseline month, so the comparison is not yet available.
 * `verification_ready` holds the later month, so the action is committed, the
 * evidence is comparable, and the deadline is the open question.
 */
const STATES = Object.freeze({
  new: { storage: {}, phase: JOURNEY_PHASE.new },
  resumed: {
    storage: {
      // Committed, but its expected effect is months away, so nothing is due.
      [ACTION_KEY]: JSON.stringify(action({ target: { ...action().target, deadline: "2026-12-31" } })),
      [REVIEW_EVIDENCE_KEY]: evidence(analysis("2026-06"), verdict()),
    },
    phase: JOURNEY_PHASE.resumed,
  },
  verification_ready: {
    storage: {
      // The deadline has passed, so verifying it outranks every other step.
      [ACTION_KEY]: JSON.stringify(action({ target: { ...action().target, deadline: "2026-07-15" } })),
      [REVIEW_EVIDENCE_KEY]: evidence(analysis(), verdict()),
    },
    phase: JOURNEY_PHASE.verificationReady,
  },
});

async function openJourney(name) {
  const page = await loadPage(PAGE, { storage: STATES[name].storage });
  await importPageModule("/savings-action-center-page.js");
  await waitFor(() => page.document.querySelector(".fjc-decision"),
    `the ${name} consolidated journey`);
  return page;
}

/** The view builds through the global `document`; a unit render lends it one. */
function rendered(journey) {
  const document = parseHtml(`<body><section id="finops-journey">
    <h2 id="finops-journey-question"></h2>
    <p id="finops-journey-sample"></p>
    <div id="finops-journey-body"></div>
    <p id="finops-journey-live"></p>
  </section></body>`);
  renderConsolidatedJourney(document, journey);
  return document;
}

const journeyFor = (name, surface = "review") => consolidateJourney({
  restored: {
    status: "absent",
    notice: null,
    carried: null,
    retainedAction: STATES[name].storage[ACTION_KEY]
      ? JSON.parse(STATES[name].storage[ACTION_KEY]) : null,
    currentAnalysis: STATES[name].storage[REVIEW_EVIDENCE_KEY]
      ? JSON.parse(STATES[name].storage[REVIEW_EVIDENCE_KEY]).currentAnalysis : null,
    theoVerdict: STATES[name].storage[REVIEW_EVIDENCE_KEY]
      ? JSON.parse(STATES[name].storage[REVIEW_EVIDENCE_KEY]).theoVerdict : null,
  },
  now: TODAY,
  surface,
});

/* --------------------------- the three states ---------------------------- */

test("a new review names the one next step and states no figure it does not have", async () => {
  const page = await openJourney("new");
  try {
    const { document } = page;
    const region = document.getElementById("finops-journey");
    assert.equal(region.dataset.phase, JOURNEY_PHASE.new);

    // The question is answerable and it is the region's accessible name.
    assert.equal(region.getAttribute("aria-labelledby"), "finops-journey-question");
    assert.equal(textOf(document.getElementById("finops-journey-question")), JOURNEY_QUESTION);

    // The phase travels as a word, not only as the tint on the card.
    assert.match(textOf(document.querySelector(".fjc-phase")), /New review/);

    // No figure is claimed before an import, and the slot says so rather than
    // showing a zero, a dash, or the bundled example's number.
    const metric = document.getElementById("finops-journey-metric");
    assert.equal(metric.dataset.known, "false");
    assert.match(textOf(metric), /Not stated/);
    assert.doesNotMatch(textOf(region), /Route short support summaries/);

    // And exactly one next step, which is the one that produces the evidence.
    const link = document.getElementById("finops-journey-action");
    assert.match(textOf(link), /Import a provider export to start this review/);
    assert.equal(link.href, "/evolution.html#local-import-title");
    assert.equal(document.querySelectorAll(".fjc-action").length, 1);
    assert.doesNotMatch(textOf(region), /undefined|NaN|\[object/);
  } finally {
    page.restore();
  }
});

test("a resumed review shows what was decided and what remains, both collapsed", async () => {
  const page = await openJourney("resumed");
  try {
    const { document } = page;
    const decided = document.getElementById("finops-journey-decided-trigger");
    const remaining = document.getElementById("finops-journey-remaining-trigger");

    // Both are shut on arrival: the decision is above the fold, its supporting
    // detail is one press away and not on another page.
    for (const trigger of [decided, remaining]) {
      assert.equal(trigger.getAttribute("aria-expanded"), "false");
      assert.equal(document.getElementById(trigger.getAttribute("aria-controls")).hidden, true);
    }

    decided.focus();
    pressEnter(document);
    const panel = document.getElementById("finops-journey-decided-panel");
    assert.equal(panel.hidden, false);
    // What was already decided is the retained record's own words.
    assert.match(textOf(panel), /Route short lookups to the efficient model/);
    assert.match(textOf(panel), /AI Platform product owner/);
    assert.match(textOf(panel), /Checkpoint due/);
    assert.match(textOf(panel), /2026-12-31/);

    remaining.focus();
    pressEnter(document);
    assert.match(textOf(document.getElementById("finops-journey-remaining-panel")),
      /Next step/);
    assert.doesNotMatch(textOf(document.getElementById("finops-journey")),
      /undefined|NaN|\[object/);
  } finally {
    page.restore();
  }
});

test("a verification-ready review puts the checkpoint and its expected figure on screen", async () => {
  const page = await openJourney("verification_ready");
  try {
    const { document } = page;
    assert.equal(document.getElementById("finops-journey").dataset.phase,
      JOURNEY_PHASE.verificationReady);

    // The checkpoint is the answer in this phase, so it is painted beside the
    // action rather than behind a disclosure.
    const checkpoint = document.getElementById("finops-journey-checkpoint");
    assert.ok(checkpoint, "the checkpoint block is on screen");
    assert.equal(checkpoint.dataset.known, "true");
    assert.match(textOf(checkpoint), /Due 2026-07-15/);
    assert.match(textOf(checkpoint), /0 USD\/month remaining avoidable spend/);
    // And it names the record it was read off, because this view derived it.
    assert.match(textOf(checkpoint), /retained monthly action route-short-lookups/);

    // The material figure is the local measured comparison, not a projection.
    assert.match(textOf(document.getElementById("finops-journey-metric")),
      /\$900\.00 vs \$1,200\.00/);
    assert.match(textOf(document.getElementById("finops-journey-action")), /Verify/);
  } finally {
    page.restore();
  }
});

/* ------------------------- keyboard and semantics ------------------------- */

test("every disclosure is a real button over a named region, operable by Enter and Space", async () => {
  const page = await openJourney("verification_ready");
  try {
    const { document } = page;
    const triggers = document.querySelectorAll(".fjc-disclosure-trigger");
    assert.equal(triggers.length, 4,
      "decided, remaining, prior results, and department detail");

    for (const trigger of triggers) {
      assert.equal(trigger.tagName, "BUTTON");
      const panel = document.getElementById(trigger.getAttribute("aria-controls"));
      assert.ok(panel, "aria-controls names a region that exists");
      assert.equal(panel.getAttribute("role"), "group");
      assert.equal(panel.getAttribute("aria-labelledby"), trigger.id,
        "the controlled region is labelled by its trigger");

      // Reading order, in the source: the evidence is the NEXT thing after the
      // control that reveals it. A panel moved elsewhere in the DOM leaves a
      // reader who opens it somewhere other than where they pressed.
      const siblings = trigger.parentNode.children.map((node) => node.getAttribute("id"));
      assert.deepEqual(siblings, [trigger.id, panel.getAttribute("id")],
        "the disclosure panel does not sit immediately after its own trigger");

      // Reachable by Tab, in document order.
      assert.ok(tabSequence(document).includes(trigger));

      trigger.focus();
      pressEnter(document);
      assert.equal(trigger.getAttribute("aria-expanded"), "true", "Enter expands");
      assert.equal(panel.hidden, false);
      assert.match(textOf(trigger), /Hide/);

      pressSpace(document);
      assert.equal(trigger.getAttribute("aria-expanded"), "false", "Space collapses");
      assert.equal(panel.hidden, true);
      assert.match(textOf(trigger), /Show/);

      // A collapsed panel leaves the tab sequence rather than holding it.
      const inside = tabSequence(document).filter((node) => node.closest?.(`#${panel.id}`));
      assert.deepEqual(inside, [], "a shut disclosure holds no tab stop");
    }
  } finally {
    page.restore();
  }
});

test("an opened disclosure survives the repaint an evidence read triggers", async () => {
  const page = await openJourney("verification_ready");
  try {
    const { document } = page;
    const trigger = document.getElementById("finops-journey-department-trigger");
    trigger.focus();
    pressEnter(document);

    // Clearing imported files repaints the page. This journey did not move, so
    // the region is left standing and the reader keeps what they opened.
    document.getElementById("sac-clear").click();
    assert.equal(
      document.getElementById("finops-journey-department-trigger").getAttribute("aria-expanded"),
      "true", "a repaint does not close what the reader opened");
  } finally {
    page.restore();
  }
});

test("the heading order under the journey runs h2 then h3, with no level skipped", async () => {
  const page = await openJourney("verification_ready");
  try {
    const { document } = page;
    // One h1 roots the page; the region's own heading is the h2 under it and
    // everything the view emits is an h3.
    assert.equal(document.querySelectorAll("h1").length, 1);
    const region = document.getElementById("finops-journey");
    assert.equal(region.querySelectorAll("h2").length, 1);
    assert.equal(region.querySelectorAll("h4").length, 0);
    assert.ok(region.querySelectorAll("h3").length >= 3,
      "the figure, the action, the checkpoint, and the support group all name themselves");
    for (const heading of region.querySelectorAll("h3")) {
      assert.ok(textOf(heading).length > 0, "no heading is empty");
    }
  } finally {
    page.restore();
  }
});

test("no signal on the journey travels as colour alone", () => {
  const document = rendered(journeyFor("verification_ready"));
  const chips = document.querySelectorAll(".fjc-chip");
  assert.equal(chips.length, 5, "impact, confidence, verification, provenance, department");
  for (const chip of chips) {
    const shape = chip.querySelector(".fjc-chip-shape");
    assert.equal(shape.getAttribute("aria-hidden"), "true",
      "the glyph is decoration beside the words, never the accessible name");
    const spoken = `${textOf(chip.querySelector(".fjc-chip-label"))} `
      + `${textOf(chip.querySelector(".fjc-chip-value"))}`;
    assert.ok(spoken.trim().length > 0, "each chip reads fully without its wash");
    assert.doesNotMatch(spoken, /undefined|NaN|\[object/);
    assert.ok(chip.dataset.known === "true" || chip.dataset.known === "false");
  }
});

/* ------------------------------ the model -------------------------------- */

test("a malformed contract renders a readable fallback rather than a blank or a throw", () => {
  // A restored shape that is not a record at all.
  const notARecord = consolidateJourney({ restored: [], now: TODAY });
  assert.equal(notARecord.phase, JOURNEY_PHASE.degraded);

  // And a record whose retained action is present but unreadable garbage. The
  // model must still answer: a question, a phase, a reason, and a step.
  const broken = consolidateJourney({
    restored: { retainedAction: { actionId: 42, target: "tomorrow" }, currentAnalysis: null },
    now: TODAY,
  });
  const document = rendered(broken);
  const region = document.getElementById("finops-journey");
  assert.ok(textOf(region).length > 0, "the panel is never blank");
  assert.match(textOf(region), /Records unreadable|Review in progress/);
  assert.equal(document.querySelectorAll(".fjc-action").length, 1,
    "a degraded journey still offers exactly one step");
  assert.doesNotMatch(textOf(region), /undefined|NaN|\[object/);
});

test("the checkpoint is derived from the retained record, and says so when there is none", () => {
  const scheduled = verificationCheckpoint(action());
  assert.equal(scheduled.known, true);
  assert.equal(scheduled.due, "2026-07-31");
  assert.match(scheduled.source, /retained monthly action route-short-lookups/);

  const none = verificationCheckpoint(null);
  assert.equal(none.known, false);
  assert.equal(none.due, null);
  assert.match(none.note, /No checkpoint is scheduled/);
});

test("the one action links to the right place from each surface it is painted on", () => {
  assert.equal(actionHref("collect_evidence", "briefing"), "#local-import-title");
  assert.equal(actionHref("collect_evidence", "review"), "/evolution.html#local-import-title");
  // An off-page target is already absolute and is not rewritten by either.
  assert.equal(actionHref("verify_action", "briefing"), "/savings-action-center.html");
  assert.equal(actionHref("verify_action", "review"), "/savings-action-center.html");
});

test("a carried snapshot's prior results reach the journey, and a refused one says so", () => {
  const carried = consolidateJourney({
    restored: {
      status: "restored",
      notice: "Carried from your last local import. Nothing was re-imported.",
      carried: {
        provenance: { importSourceId: "0a1b2c3d", fileCount: 2, rows: 480,
          importedAt: "2026-07-01T08:00:00.000Z" },
        verification: { state: "all_clear", measured: true, rows: 24 },
        confidence: { action: "high", evidence: "high", coveragePercent: 96 },
        departmentReferences: ["0a1b2c3d"],
      },
      retainedAction: action(),
      currentAnalysis: analysis(),
      theoVerdict: verdict(),
    },
    now: TODAY,
  });
  assert.equal(carried.priorResults.length, 4);
  const document = rendered(carried);
  assert.match(textOf(document.querySelector(".fjc-notice")), /Nothing was re-imported/);
  document.getElementById("finops-journey-prior-trigger").click();
  const panel = document.getElementById("finops-journey-prior-panel");
  assert.equal(panel.hidden, false);
  assert.match(textOf(panel), /0a1b2c3d · 2 files, 480 rows/);
  assert.match(textOf(panel), /all_clear · 24 measured rows/);

  // A refused snapshot costs the carried block and nothing else.
  const refused = journeyFor("verification_ready");
  assert.deepEqual(refused.priorResults, []);
  assert.equal(refused.notice, null);
  assert.equal(refused.phase, JOURNEY_PHASE.verificationReady);
});

/* ------------------------------ both surfaces ----------------------------- */

test("both entry points ship the region and render it from the same pair of modules", async () => {
  const [briefingHtml, briefingEntry, reviewHtml, reviewEntry] = await Promise.all([
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/savings-action-center.html", import.meta.url), "utf8"),
    readFile(new URL("../src/savings-action-center-page.js", import.meta.url), "utf8"),
  ]);
  for (const [name, html] of [["briefing", briefingHtml], ["review", reviewHtml]]) {
    assert.match(html, /id="finops-journey"/, `${name} ships the region`);
    assert.match(html, /id="finops-journey-body"/, `${name} ships the painted body`);
    assert.match(html, /href="\/finops-journey-consolidated\.css"/,
      `${name} links the shared stylesheet`);
    assert.match(html, /id="finops-journey-live"[^>]*aria-live="polite"/,
      `${name} ships one polite live region for the journey`);
  }
  for (const [name, entry] of [["briefing", briefingEntry], ["review", reviewEntry]]) {
    assert.match(entry, /consolidateJourney/, `${name} composes the journey`);
    assert.match(entry, /renderConsolidatedJourney/, `${name} renders it`);
  }
});

