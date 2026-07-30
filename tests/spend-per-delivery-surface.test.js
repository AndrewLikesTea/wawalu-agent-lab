// The spend-per-delivery panel as a reader meets it on the AI FinOps front door.
//
// Every test drives the shipped markup of src/evolution.html, and the last three
// boot the real page entry, so "the front door renders this state" is checked
// against the wiring that ships rather than against a call this file made itself.
// Nothing transcribes a figure: expectations come from the state the shipped
// contract produced for the input under test.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  DELIVERY_FINDING_CLASSIFICATIONS, deliveryEfficiencyFinding,
} from "../src/delivery-efficiency-finding.js";
import {
  DELIVERY_FINDING_FIXTURES,
} from "../src/delivery-efficiency-finding-fixtures.js";
import {
  SPEND_PER_DELIVERY_STATE, spendPerDeliveryDecision, spendPerDeliveryInput,
} from "../src/spend-per-delivery.js";
import { alignedSpendPerRelease } from "../src/aligned-spend-per-release.js";
import {
  EXAMPLE_DELIVERY_RELEASES, SPEND_PER_DELIVERY_FIXTURES, spendPerDeliveryFixture,
} from "../src/spend-per-delivery-fixtures.js";
import {
  SPEND_PER_DELIVERY_BODY_ID, SPEND_PER_DELIVERY_DETAIL_ID, SPEND_PER_DELIVERY_DISCLOSURES,
  SPEND_PER_DELIVERY_LIVE_ID, SPEND_PER_DELIVERY_PHASE, SPEND_PER_DELIVERY_SECTION_ID,
  applySpendPerDelivery, applySpendPerDeliveryPhase, clearSpendPerDelivery,
} from "../src/spend-per-delivery-view.js";
import { exampleDatasetFiles } from "../src/example-dataset.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const STYLESHEET = new URL("../src/evolution.css", import.meta.url);
const DEMO_DATA = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const section = (document) => document.getElementById(SPEND_PER_DELIVERY_SECTION_ID);
const body = (document) => document.getElementById(SPEND_PER_DELIVERY_BODY_ID);
const live = (document) => document.getElementById(SPEND_PER_DELIVERY_LIVE_ID);
const pick = (document, selector) => body(document).querySelector(selector);
/** The one disclosure group. Every topic a reader can check hangs off it. */
const group = (document) => document.getElementById(SPEND_PER_DELIVERY_DETAIL_ID);
const disclosure = (document, key) =>
  group(document).querySelector(`.spd-detail[data-disclosure="${key}"]`);
/**
 * What a keyboard press on a native `summary` does: the browser flips `open` on
 * the parent `details` and fires `toggle`. The test DOM does not model native
 * activation, so the two steps are made here — the control itself is asserted to
 * be a real `summary` inside a real `details`, which is what makes it operable.
 */
function toggleDisclosure(details) {
  details.open = !details.open;
  details.dispatchEvent(new DomEvent("toggle"));
  return details;
}

async function paint(name) {
  const { document } = await loadPage(PAGE);
  const state = applySpendPerDelivery(document, spendPerDeliveryFixture(name));
  return { document, state };
}

/* ------------------------------ the three states ------------------------------ */

test("the eligible state answers first, then shows the figure it is a ratio of", async () => {
  const { document, state } = await paint("eligible");
  assert.equal(section(document).hidden, false);
  assert.equal(section(document).dataset.state, SPEND_PER_DELIVERY_STATE.eligible);
  // The answer is the first child, so a reader who reads one line reads the answer.
  assert.equal(body(document).children[0].className, "spd-answer");
  assert.equal(textOf(body(document).children[0]), state.statement);
  // The numeral never appears without its unit or its arithmetic.
  const figure = pick(document, ".spd-figure");
  assert.ok(textOf(figure).includes(state.metric.spendPerDeliveryUsd.toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })));
  assert.match(textOf(figure), /per completed release/);
  assert.ok(textOf(figure).includes(`${state.metric.deliveries} completed release`));
  assert.ok(textOf(figure).includes(state.window.start) && textOf(figure).includes(state.window.end));
  assert.match(textOf(figure), /end exclusive/);
});

test("the comparison names the baseline, the direction, and a word beside the shape", async () => {
  const { document, state } = await paint("eligible");
  const comparison = pick(document, ".spd-comparison");
  assert.equal(comparison.dataset.direction, state.comparison.direction);
  // Not tint alone: the direction word and the percentage are both in the text.
  assert.ok(textOf(comparison).includes(state.comparison.direction));
  assert.ok(textOf(comparison).includes(`${state.comparison.deltaPercent.toFixed(1)}%`));
  assert.ok(textOf(comparison).includes(state.comparison.interpretation));
  // The shape is decoration and is hidden from assistive tech.
  assert.equal(comparison.querySelector(".spd-shape").getAttribute("aria-hidden"), "true");
  // Confidence carries a word too, and the basis sentence that earned it.
  const confidence = pick(document, ".spd-confidence");
  assert.equal(confidence.dataset.level, state.confidence.level);
  assert.ok(textOf(confidence).includes(state.confidence.level));
  assert.ok(textOf(confidence).includes(state.confidence.basis));
});

test("the insufficient state publishes no figure and leads with the release log", async () => {
  const { document, state } = await paint("insufficient");
  assert.equal(section(document).dataset.state, SPEND_PER_DELIVERY_STATE.insufficient);
  assert.equal(section(document).dataset.reason, "no_delivery_evidence");
  assert.equal(pick(document, ".spd-figure"), null, "no numeral where there is no ratio");
  assert.equal(pick(document, ".spd-comparison"), null, "and no baseline beside it");
  assert.ok(textOf(pick(document, ".spd-withheld")).includes(state.metric.unit));
  // The prioritized action is the one that creates the missing denominator.
  const action = pick(document, ".spd-action");
  assert.ok(textOf(action).includes(state.nextAction.text));
  assert.ok(textOf(action).includes(state.nextAction.owner));
  assert.equal(pick(document, ".spd-action-link").getAttribute("href"), "/release.html");
  // And the live region says the answer and the next step, once.
  assert.ok(textOf(live(document)).startsWith(state.statement));
  assert.ok(textOf(live(document)).includes(state.nextAction.text));
});

test("the mismatched-period state says the windows differ and offers no ratio", async () => {
  const { document, state } = await paint("mismatched");
  assert.equal(section(document).dataset.state, SPEND_PER_DELIVERY_STATE.mismatched);
  assert.equal(section(document).dataset.reason, "no_delivery_in_spend_window");
  assert.equal(pick(document, ".spd-figure"), null);
  assert.ok(textOf(pick(document, ".spd-answer")).includes("outside"));
  assert.ok(textOf(pick(document, ".spd-action")).includes(state.nextAction.text));
  assert.equal(pick(document, ".spd-action-link"), null, "no release log to open for this one");
});

test("every state carries the framing line and one disclosure group to check it with", async () => {
  for (const name of ["eligible", "insufficient", "mismatched"]) {
    const { document, state } = await paint(name);
    // The framing is in the block itself, not inside a disclosure.
    assert.equal(textOf(pick(document, ".spd-framing")), state.framing.statement);
    // One group, and only one: the evidence for this finding is not scattered
    // across peer controls down the panel.
    assert.equal(body(document).querySelectorAll(".spd-disclosures").length, 1, name);
    const details = group(document).querySelectorAll(".spd-detail");
    assert.equal(details.length, SPEND_PER_DELIVERY_DISCLOSURES.length, name);
    const text = textOf(group(document));
    for (const line of state.evidence) assert.ok(text.includes(line), `${name}: ${line}`);
    for (const line of state.confounders) assert.ok(text.includes(line), `${name}: ${line}`);
    assert.ok(text.includes(state.provenance.source));
    for (const node of details) {
      assert.equal(node.tagName, "DETAILS", name);
      assert.equal(node.children[0].tagName, "SUMMARY", name);
      assert.equal(node.open, false, "closed by default, so it is disclosure and not noise");
    }
  }
});

test("the clear hands the section back and leaves no figure behind", async () => {
  const { document } = await paint("eligible");
  clearSpendPerDelivery(document);
  assert.equal(section(document).hidden, true);
  assert.equal(section(document).dataset.state, SPEND_PER_DELIVERY_STATE.absent);
  assert.equal(section(document).dataset.reason, undefined);
  assert.equal(textOf(body(document)), "");
  assert.equal(textOf(live(document)), "");
  // An absent reading is the same handing back, through the same entry point.
  applySpendPerDelivery(document, { ...spendPerDeliveryFixture("eligible"), state: "absent" });
  assert.equal(section(document).hidden, true);
});

test("the panel wraps rather than clipping, at any width", async () => {
  const css = await readFile(STYLESHEET, "utf8");
  const block = css.slice(css.indexOf(".spend-per-delivery {"));
  assert.ok(!/[^-]width:\s*\d+px/.test(block), "a fixed pixel width would clip a long amount");
  assert.match(block, /\.spd-figure-value \{[^}]*overflow-wrap:anywhere/);
  assert.match(block, /\.spd-answer \{[^}]*overflow-wrap:anywhere/);
  // The withheld state has an edge of its own, so it cannot read as a weak figure.
  assert.match(block, /\.spd-withheld \{[^}]*dashed/);
  assert.match(block, /\.spd-detail-summary \{[^}]*min-height:44px/);
  assert.match(block, /\.spd-detail-summary:focus-visible \{[^}]*var\(--focus-ring\)/);
});

/* ------------------------------- the front door ------------------------------- */

async function openFinopsTab(storage = {}) {
  const page = await loadPage(PAGE, {
    storage,
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  return page;
}

const releaseLog = (...days) => ({
  "shiplog.releases.v1": JSON.stringify(days.map((day, index) => ({
    id: `stored-${index}`,
    version: `9.${index}.0`,
    createdAt: `${day}T12:00:00.000Z`,
    status: "completed",
    decisionIds: [],
  }))),
});

function chooseExampleExports(document) {
  const input = document.getElementById("local-finops-files");
  input.files = exampleDatasetFiles().map(({ fileName, text }) => ({
    name: fileName, type: "application/json", text: async () => text,
  }));
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

test("a visitor who has read nothing never meets this panel", async () => {
  const { document } = await openFinopsTab();
  assert.equal(section(document).hidden, true);
  assert.equal(section(document).dataset.state, SPEND_PER_DELIVERY_STATE.absent);
});

test("the bundled example dataset answers the question with its own release log", async () => {
  const { document } = await openFinopsTab();
  document.getElementById("try-example-dataset").click();

  assert.equal(section(document).hidden, false);
  assert.equal(section(document).dataset.state, SPEND_PER_DELIVERY_STATE.eligible);
  // Labelled as the example it is, on the line a reader checks provenance on.
  assert.equal(section(document).dataset.origin, "example");
  assert.match(textOf(pick(document, ".spd-provenance")), /example/i);
  assert.match(textOf(group(document)), /bundled example release log/);
  // A figure, its unit, and the framing that keeps it an observation.
  assert.match(textOf(pick(document, ".spd-figure")), /per completed release/);
  assert.match(textOf(pick(document, ".spd-framing")), /observational ratio/);
});

test("an imported export with an empty release log asks for a release, not for more billing", async () => {
  const { document } = await openFinopsTab();
  chooseExampleExports(document);
  // Visible is no longer the same as read: the panel unhides to say it is
  // reading. The reading is the `ready` phase.
  await waitFor(() => section(document).dataset.phase === SPEND_PER_DELIVERY_PHASE.ready
    && !section(document).hidden, "the delivery comparison to be painted");

  assert.equal(section(document).dataset.state, SPEND_PER_DELIVERY_STATE.insufficient);
  assert.equal(section(document).dataset.reason, "no_delivery_evidence");
  assert.equal(section(document).dataset.origin, "import");
  assert.equal(pick(document, ".spd-action-link").getAttribute("href"), "/release.html");

  // And the reset takes it away: the window it described came from the analysis
  // being discarded.
  document.getElementById("clear-local-analysis").click();
  assert.equal(section(document).hidden, true);
});

test("stored releases from another window reach the mismatched-period state", async () => {
  // The bundled provider exports cover 2026-01-01 to 2026-07-01; these shipped
  // before any of it.
  const { document } = await openFinopsTab(releaseLog("2025-11-04", "2025-11-14", "2025-11-24"));
  chooseExampleExports(document);
  // Visible is no longer the same as read: the panel unhides to say it is
  // reading. The reading is the `ready` phase.
  await waitFor(() => section(document).dataset.phase === SPEND_PER_DELIVERY_PHASE.ready
    && !section(document).hidden, "the delivery comparison to be painted");

  assert.equal(section(document).dataset.state, SPEND_PER_DELIVERY_STATE.mismatched);
  assert.equal(section(document).dataset.reason, "no_delivery_in_spend_window");
  assert.equal(pick(document, ".spd-figure"), null, "no ratio is published for a drifted window");
  assert.match(textOf(group(document)), /this browser's release log/);
});

test("stored releases inside the imported window publish a ratio the reader can check", async () => {
  const { document } = await openFinopsTab(
    releaseLog("2026-06-03", "2026-06-13", "2026-06-23"));
  chooseExampleExports(document);
  // Visible is no longer the same as read: the panel unhides to say it is
  // reading. The reading is the `ready` phase.
  await waitFor(() => section(document).dataset.phase === SPEND_PER_DELIVERY_PHASE.ready
    && !section(document).hidden, "the delivery comparison to be painted");

  assert.equal(section(document).dataset.state, SPEND_PER_DELIVERY_STATE.eligible);
  assert.equal(section(document).dataset.origin, "import");
  assert.ok(textOf(pick(document, ".spd-figure")).includes("3 completed releases"));
  // Only three months of this browser's log exist inside six billing periods, so
  // there is no trailing baseline and confidence says so rather than implying one.
  assert.equal(pick(document, ".spd-confidence").dataset.level, "medium");
  // And with no baseline, the classified finding withholds a direction rather than
  // reading the ratio as a change.
  assert.equal(pick(document, ".spd-finding").dataset.classification, "insufficient_evidence");
});

/* --------------------- the classified finding, on the page -------------------- */

test("every painted state carries its classification, priority, and caveats", async () => {
  // The scoring layer is not optional decoration on this panel: there is no state
  // in which a reader meets the figure without the classification that qualifies
  // it, so this walks all three states the surface can paint.
  for (const name of ["eligible", "insufficient", "mismatched"]) {
    const { document } = await paint(name);
    const finding = pick(document, ".spd-finding");
    assert.ok(finding, `${name} painted no finding`);
    assert.ok(DELIVERY_FINDING_CLASSIFICATIONS.includes(finding.dataset.classification), name);
    assert.match(textOf(finding), /Priority \d: /, name);
    // The thresholds and the rules that fired are on the screen, not only in the
    // module: a disputed classification can be recomputed from what was rendered.
    assert.match(textOf(disclosure(document, "confidence")), /Material change: 15%/, name);
    assert.ok(pick(document, ".spd-finding-rationale").children.length >= 3, name);
    assert.ok(pick(document, ".spd-finding-caveats").children.length >= 3, name);
    // The framing sentence has its own paragraph; it is not repeated in the list.
    assert.doesNotMatch(textOf(pick(document, ".spd-finding-caveats")),
      /not a return on investment/, name);
  }
});

test("the panel cannot render a material rise without the direction it published", async () => {
  const { document } = await loadPage(PAGE);
  const decision = spendPerDeliveryDecision(DELIVERY_FINDING_FIXTURES.materialIncrease.input);
  applySpendPerDelivery(document, decision, deliveryEfficiencyFinding(decision));
  const finding = pick(document, ".spd-finding");
  assert.equal(finding.dataset.classification, "material_ratio_increase");
  assert.equal(finding.dataset.priorityRank, "2");
  assert.match(textOf(finding), /\+50\.0%/);
  // And it still says, on screen, that this is not evidence either figure moved
  // the other — now under the disclosure that owns the limits rather than beside
  // the classification word.
  assert.match(textOf(disclosure(document, "limits")),
    /not evidence that spend affected delivery/);
});

test("an unalignable window renders the top-priority finding and no figure", async () => {
  const { document } = await loadPage(PAGE);
  const decision = spendPerDeliveryDecision(DELIVERY_FINDING_FIXTURES.invalidAlignment.input);
  applySpendPerDelivery(document, decision, deliveryEfficiencyFinding(decision));
  const finding = pick(document, ".spd-finding");
  assert.equal(finding.dataset.classification, "invalid_period_alignment");
  assert.equal(finding.dataset.priorityRank, "1");
  assert.equal(pick(document, ".spd-figure"), null);
});

/* ----------------------- one finding, one disclosure group -------------------- */

test("the question is the heading, and the answer is the first thing under it", async () => {
  const { document, state } = await paint("eligible");
  const heading = document.getElementById("spend-per-delivery-title");
  assert.equal(heading.tagName, "H2", "a reader listing headings meets the question");
  assert.match(textOf(heading), /\?$/);
  // One region, and it supports the page's single complete summary rather than
  // competing with it.
  assert.equal(section(document).getAttribute("data-decision-summary"), "evidence");
  // Answer, then figure, then comparison — a leader who reads one line reads the
  // answer, and the metric they act on is the second thing on the screen.
  const order = [...body(document).children].map((child) => child.className);
  assert.deepEqual(order.slice(0, 3), ["spd-answer", "spd-figure", "spd-comparison"]);
  assert.equal(textOf(body(document).children[0]), state.statement);
  // Exactly one prioritized action, and the group is the last thing in the body.
  assert.equal(body(document).querySelectorAll(".spd-action").length, 1);
  assert.equal(body(document).children.at(-1).className, "spd-disclosures");
});

test("the six topics a reader can dispute each have their own disclosure", async () => {
  const { document, state } = await paint("eligible");
  assert.deepEqual(
    [...group(document).querySelectorAll(".spd-detail")].map((node) => node.dataset.disclosure),
    SPEND_PER_DELIVERY_DISCLOSURES.map((entry) => entry.key));

  // Period alignment names the window and says, in a word, whether the two sides
  // describe it.
  const alignment = disclosure(document, "period-alignment");
  assert.ok(textOf(alignment).includes(state.window.start));
  assert.ok(textOf(alignment).includes(`${state.window.days} days`));
  assert.equal(alignment.querySelector(".spd-alignment").dataset.aligned, "true");
  assert.match(textOf(alignment), /Aligned/);
  // Release counts carry the derivation's own evidence lines and both floors.
  const counts = disclosure(document, "release-counts");
  for (const line of state.evidence) assert.ok(textOf(counts).includes(line), line);
  assert.match(textOf(counts), /at least 14 days/);
  assert.match(textOf(counts), /at least 3 releases recorded as completed/);
  // Excluded records are structured facts, not a re-reading of the counts: the
  // baseline periods that failed the floor and the source text never carried.
  const excluded = disclosure(document, "excluded-records");
  assert.match(textOf(excluded), /excluded from the trailing baseline/,
    "a clean baseline says so rather than staying silent");
  assert.match(textOf(excluded), /release\.version/);
  // Provenance names the source and whether the basis was complete.
  assert.ok(textOf(disclosure(document, "provenance")).includes(state.provenance.source));
  // Confidence carries the basis and every threshold the classification used.
  const confidence = disclosure(document, "confidence");
  assert.ok(textOf(confidence).includes(state.confidence.basis));
  assert.match(textOf(confidence), /Single-release sensitivity/);
  // And the limits are stated as limits, with all six confounders.
  const limits = disclosure(document, "limits");
  for (const line of state.confounders) assert.ok(textOf(limits).includes(line), line);
});

test("a disclosure the reader opened survives a repaint of the same reading", async () => {
  const { document } = await paint("eligible");
  const opened = disclosure(document, "excluded-records");
  // Native control: a summary inside a details, with nothing bolted on top of the
  // keyboard behaviour the browser already gives it.
  const summary = opened.children[0];
  assert.equal(summary.tagName, "SUMMARY");
  assert.equal(summary.getAttribute("tabindex"), null);
  assert.equal(summary.getAttribute("role"), null);
  toggleDisclosure(opened);

  // Same reading, painted again: the reader's open control comes back open and
  // the five they did not touch stay closed.
  applySpendPerDelivery(document, spendPerDeliveryFixture("eligible"));
  assert.equal(disclosure(document, "excluded-records").open, true);
  assert.equal(disclosure(document, "period-alignment").open, false);

  // A different reading closes it: a panel left open would caption the evidence
  // of a window that is no longer on screen.
  applySpendPerDelivery(document, spendPerDeliveryFixture("mismatched"));
  assert.equal(disclosure(document, "excluded-records").open, false);
});

test("nothing the panel renders reframes the ratio as a return or a cause", async () => {
  for (const name of ["eligible", "insufficient", "mismatched"]) {
    const { document, state } = await paint(name);
    // Every disclosure is opened so the scan reaches the prose behind them too.
    for (const node of group(document).querySelectorAll(".spd-detail")) node.open = true;
    const rendered = textOf(body(document));
    assert.ok(rendered.length > 2000, `${name}: the panel publishes prose to scan`);
    for (const claim of state.framing.forbiddenClaims) {
      const pattern = new RegExp(`\\b${claim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      // The framing sentence is the one string allowed to name the claims,
      // because it is the sentence that denies them.
      const offenders = [...body(document).querySelectorAll("p,li,span,h3,h4,summary")]
        .map(textOf)
        .filter((text) => pattern.test(text) && !state.framing.statement.includes(text));
      assert.deepEqual(offenders, [], `${name}: "${claim}" reached the screen`);
    }
  }
});

/* ------------------- loading, missing data, and a failed read ----------------- */

test("the loading phase captions the panel without blanking the reading under it",
  async () => {
    const { document, state } = await paint("eligible");
    const status = applySpendPerDeliveryPhase(document, SPEND_PER_DELIVERY_PHASE.loading);
    assert.equal(section(document).dataset.phase, SPEND_PER_DELIVERY_PHASE.loading);
    assert.equal(section(document).getAttribute("aria-busy"), "true");
    // A wait that ends is worth one polite announcement, not an alert.
    assert.equal(status.querySelector(".spd-status-line").getAttribute("role"), "status");
    assert.match(textOf(status), /Reading/);
    // The figure a reader was already looking at is still there, and is labelled
    // as the previous one rather than silently left to look current.
    assert.equal(textOf(pick(document, ".spd-answer")), state.statement);
    assert.match(textOf(status), /previous one/);

    // And the reading that arrives clears the caption and the busy state.
    applySpendPerDelivery(document, spendPerDeliveryFixture("eligible"));
    assert.equal(pick(document, ".spd-status"), null);
    assert.equal(section(document).dataset.phase, SPEND_PER_DELIVERY_PHASE.ready);
    assert.equal(section(document).getAttribute("aria-busy"), null);
  });

test("a failed read is an alert, and says what to do about it", async () => {
  const { document } = await loadPage(PAGE);
  const status = applySpendPerDeliveryPhase(document, SPEND_PER_DELIVERY_PHASE.error,
    { detail: "Choose a provider export for the period you want to compare." });
  assert.equal(section(document).hidden, false, "the question is still asked");
  assert.equal(section(document).dataset.phase, SPEND_PER_DELIVERY_PHASE.error);
  assert.equal(section(document).getAttribute("aria-busy"), null);
  assert.equal(status.querySelector(".spd-status-line").getAttribute("role"), "alert");
  // Colour is never the only channel: the word is in the text beside the shape.
  assert.match(textOf(status), /Not read/);
  assert.equal(status.querySelector(".spd-shape").getAttribute("aria-hidden"), "true");
  assert.match(textOf(status), /Choose a provider export/);
  assert.match(textOf(live(document)), /could not be read/);

  // The page owns the announcement for a failure it already reported once, so the
  // same caption can step down to a note without losing the word or the tone.
  const quiet = applySpendPerDeliveryPhase(document, SPEND_PER_DELIVERY_PHASE.error,
    { detail: "This file was rejected.", announce: false });
  assert.equal(quiet.querySelector(".spd-status-line").getAttribute("role"), "note");
  assert.equal(quiet.dataset.phase, SPEND_PER_DELIVERY_PHASE.error);
});

test("an analysis with no recorded release is marked as missing delivery evidence",
  async () => {
    const { document, state } = await paint("insufficient");
    assert.equal(section(document).dataset.reason, "no_delivery_evidence");
    assert.equal(section(document).dataset.deliveryEvidence, "missing");
    // The action is the one that creates the missing denominator, and it is the
    // only one: an insufficient reading is still one decisive finding.
    assert.equal(body(document).querySelectorAll(".spd-action").length, 1);
    assert.equal(state.nextAction.rank, 1);
    assert.match(textOf(pick(document, ".spd-action")), /release log/);
    // The alignment disclosure says the two sides are not aligned rather than
    // implying a window that was never established.
    assert.equal(disclosure(document, "period-alignment")
      .querySelector(".spd-alignment").dataset.aligned, "false");
    // And a later eligible reading takes the marker away with it.
    applySpendPerDelivery(document, spendPerDeliveryFixture("eligible"));
    assert.equal(section(document).dataset.deliveryEvidence, undefined);
  });

test("a rejected import captions the delivery panel instead of leaving it reading",
  async () => {
    const { document } = await openFinopsTab();
    const input = document.getElementById("local-finops-files");
    input.files = [{
      name: "not-an-export.json", type: "application/json",
      text: async () => JSON.stringify({ unrelated: true }),
    }];
    input.dispatchEvent(new DomEvent("change", { bubbles: true }));
    await waitFor(() => section(document).dataset.phase === SPEND_PER_DELIVERY_PHASE.error,
      "the delivery panel to report the rejected file");

    assert.equal(section(document).getAttribute("aria-busy"), null);
    assert.match(textOf(pick(document, ".spd-status")), /Not read/);
    // One alert for one failure: the page's own status region already announced
    // it, so this caption is a note.
    assert.equal(pick(document, ".spd-status-line").getAttribute("role"), "note");
    assert.match(textOf(pick(document, ".spd-status")), /No reading here was replaced/);
  });

test("the disclosure group and its controls hold up at any width", async () => {
  const css = await readFile(STYLESHEET, "utf8");
  const block = css.slice(css.indexOf(".spend-per-delivery {"));
  // One stacked group rather than a fixed grid: six summaries of different
  // lengths must not be forced into columns that clip them.
  assert.match(block, /\.spd-disclosures \{[^}]*display:grid/);
  assert.ok(!/[^-]width:\s*\d+px/.test(block), "a fixed pixel width would clip a summary");
  assert.match(block, /\.spd-detail-summary \{[^}]*min-height:44px/);
  assert.match(block, /\.spd-detail-summary \{[^}]*overflow-wrap:anywhere/);
  assert.match(block, /\.spd-detail-summary:focus-visible \{[^}]*var\(--focus-ring\)/);
  // The question wraps and is sized against the viewport rather than pinned.
  assert.match(block, /\.spd-question \{[^}]*clamp\(/);
  assert.match(block, /\.spd-question \{[^}]*overflow-wrap:anywhere/);
  // The error phase is the only one that reaches for the error family.
  assert.match(block, /\.spd-status\[data-phase="error"\] \{[^}]*var\(--state-error-line\)/);
  assert.ok(!/\.spd-status \{[^}]*--state-error/.test(block),
    "a panel that is merely reading must not be drawn as broken");
});

/* --------------------- the period-aligned pair on the panel ------------------- */

// The paired reading is derived on the page's own path, from the same input the
// decision came from, so these tests build it the way `paintSpendPerDelivery`
// does rather than hand-writing a record.
const alignedFor = (name) => alignedSpendPerRelease(SPEND_PER_DELIVERY_FIXTURES[name]);

async function paintWithPair(name) {
  const { document } = await loadPage(PAGE);
  const decision = spendPerDeliveryFixture(name);
  const aligned = alignedFor(name);
  applySpendPerDelivery(document, decision, deliveryEfficiencyFinding(decision), aligned);
  return { document, decision, aligned };
}

/** Paint one input through both derivations, exactly as the page does. */
async function paintInput(input) {
  const { document } = await loadPage(PAGE);
  const decision = spendPerDeliveryDecision(input);
  const aligned = alignedSpendPerRelease(input);
  applySpendPerDelivery(document, decision, deliveryEfficiencyFinding(decision), aligned);
  return { document, aligned };
}

const monthlyAnalysis = (periods) => ({
  period: periods.at(-1).period,
  spendUsd: periods.at(-1).spendUsd,
  history: { periods },
});

test("the panel reports the movement against the previous comparable window", async () => {
  const { document, aligned } = await paintWithPair("eligible");
  assert.equal(aligned.state, "eligible");
  assert.equal(aligned.trend.available, true);
  const block = pick(document, ".spd-aligned");
  assert.equal(block.dataset.state, "eligible");
  assert.equal(block.dataset.trend, aligned.trend.direction);
  assert.equal(section(document).dataset.alignedState, "eligible");
  assert.equal(section(document).dataset.alignedTrend, aligned.trend.direction);
  // The direction is a word beside the shape, never the shape alone, and the
  // shape is hidden from a screen reader.
  assert.match(textOf(block), new RegExp(aligned.trend.direction));
  assert.equal(block.querySelector(".spd-shape").getAttribute("aria-hidden"), "true");
  // Both windows are named with their lengths and their own figures, so the
  // movement can be recomputed from the block that reports it.
  const values = [...block.querySelectorAll(".spd-aligned-value")].map(textOf);
  assert.equal(values.length, 2);
  for (const side of [aligned.metric.prior, aligned.metric.current]) {
    // Matched on the whole range: one window's end is the other's start, so a
    // single date is ambiguous between the two lines.
    const range = `${side.window.start} to ${side.window.end}`;
    const line = values.find((text) => text.includes(range));
    assert.ok(line, `${range} is named`);
    assert.match(line, new RegExp(`${side.window.days} days`));
    assert.match(line, new RegExp(`${side.shippedReleases} releases`));
  }
  // It sits with the figure it qualifies, above the classification.
  const classes = [...body(document).children].map((node) => node.className);
  assert.ok(classes.indexOf("spd-aligned") < classes.indexOf("spd-finding"));
  assert.ok(classes.indexOf("spd-aligned") > classes.indexOf("spd-comparison"));
});

test("the compared pair, its alignment basis, and its exclusions are checkable", async () => {
  const { document, aligned } = await paintWithPair("eligible");
  const alignment = textOf(disclosure(document, "period-alignment"));
  for (const entry of aligned.comparedWindows) {
    assert.ok(alignment.includes(entry.start), `${entry.start} is disclosed`);
  }
  assert.ok(alignment.includes(aligned.alignment.note));
  // The bundled example's periods are calendar months, so the pair is accepted on
  // that basis and the day of difference it leaves is disclosed as a limit.
  assert.equal(aligned.alignment.basis, "calendar_month");
  assert.ok(textOf(disclosure(document, "limits")).includes(aligned.caveats.at(-1)));
  const excluded = textOf(disclosure(document, "excluded-records"));
  assert.match(excluded, new RegExp(
    `${aligned.exclusions.releasesOutsideComparedWindows} fall outside`));
  assert.ok(excluded.includes(aligned.exclusions.rule));
});

test("a current window with no release still reports its prior releases as inside the pair",
  async () => {
    // Two comparable months of spend, and releases recorded only in the earlier
    // one. This is the state the first draft of this derivation got wrong: it
    // reported the reader's own recorded releases as outside a window that holds
    // them, because no movement was published.
    const { document, aligned } = await paintInput(spendPerDeliveryInput({
      analysis: monthlyAnalysis([
        { period: "2026-05-01 to 2026-06-01", spendUsd: 98_000, completeness: "complete" },
        { period: "2026-06-01 to 2026-07-01", spendUsd: 125_500, completeness: "complete" },
      ]),
      releases: EXAMPLE_DELIVERY_RELEASES.filter((entry) =>
        entry.createdAt.startsWith("2026-05")),
      origin: "example",
    }));

    assert.equal(aligned.reasonCode, "no_releases_in_current_period");
    assert.equal(aligned.trend.available, false);
    assert.equal(aligned.exclusions.releasesOutsideComparedWindows, 0);
    assert.equal(aligned.exclusions.releasesInsideComparedWindows, 3);
    assert.equal(section(document).dataset.alignedState, "insufficient_data");
    assert.equal(section(document).dataset.alignedTrend, "unavailable");
    const block = pick(document, ".spd-aligned");
    assert.equal(block.dataset.reason, "no_releases_in_current_period");
    // The reader is told the window is empty and what to do, not that their three
    // recorded releases were outside the windows being compared.
    assert.match(textOf(block), /No release is recorded as shipped inside the latest billing/);
    assert.match(textOf(block), /release log/);
    assert.match(textOf(disclosure(document, "excluded-records")), /0 fall outside/);
  });

test("a mismatched pair is marked on the section rather than left silent", async () => {
  const { document, aligned } = await paintInput(spendPerDeliveryInput({
    analysis: monthlyAnalysis([
      { period: "2026-05-01 to 2026-06-01", spendUsd: 98_000, completeness: "complete" },
      { period: "2026-06-01 to 2026-06-15", spendUsd: 40_000, completeness: "complete" },
    ]),
    releases: EXAMPLE_DELIVERY_RELEASES,
    origin: "example",
  }));
  assert.equal(aligned.state, "mismatched_window");
  assert.equal(section(document).dataset.alignedState, "mismatched_window");
  assert.equal(pick(document, ".spd-aligned").dataset.reason,
    "unequal_reporting_window_lengths");
  assert.match(textOf(disclosure(document, "period-alignment")), /not comparable/);
});

test("the panel still paints without a paired reading, and the pair block is not faked",
  async () => {
    const { document } = await paint("eligible");
    assert.equal(pick(document, ".spd-aligned"), null);
    assert.equal(section(document).dataset.alignedState, undefined);
    // And a later paint that carries one adds it, then clearing takes it away.
    const decision = spendPerDeliveryFixture("eligible");
    applySpendPerDelivery(document, decision, deliveryEfficiencyFinding(decision),
      alignedFor("eligible"));
    assert.notEqual(pick(document, ".spd-aligned"), null);
    clearSpendPerDelivery(document);
    assert.equal(section(document).dataset.alignedState, undefined);
  });

test("the paired block holds up at any width and never colours a direction", async () => {
  const css = await readFile(STYLESHEET, "utf8");
  const block = css.slice(css.indexOf(".spd-aligned {"));
  assert.match(block, /\.spd-aligned \{[^}]*display:grid/);
  assert.match(block, /\.spd-aligned-value \{[^}]*overflow-wrap:anywhere/);
  assert.match(block, /@media \(max-width:34rem\) \{[^}]*\.spd-aligned-pair/);
  // A green/red pair here would label one direction good, which this figure does
  // not do. The direction is carried by the word and the shape only.
  assert.ok(!/\.spd-aligned\[data-trend="(higher|lower)"\]/.test(css),
    "no rule tints the block by direction");
});
