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
import { SPEND_PER_DELIVERY_STATE } from "../src/spend-per-delivery.js";
import { spendPerDeliveryFixture } from "../src/spend-per-delivery-fixtures.js";
import {
  SPEND_PER_DELIVERY_BODY_ID, SPEND_PER_DELIVERY_LIVE_ID, SPEND_PER_DELIVERY_SECTION_ID,
  applySpendPerDelivery, clearSpendPerDelivery,
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

test("every state carries the framing line and the disclosure a reader checks it with", async () => {
  for (const name of ["eligible", "insufficient", "mismatched"]) {
    const { document, state } = await paint(name);
    // The framing is in the block itself, not inside the disclosure.
    assert.equal(textOf(pick(document, ".spd-framing")), state.framing.statement);
    const detail = pick(document, ".spd-detail");
    assert.equal(detail.tagName, "DETAILS");
    assert.equal(detail.children[0].tagName, "SUMMARY");
    const text = textOf(detail);
    for (const line of state.evidence) assert.ok(text.includes(line), `${name}: ${line}`);
    for (const line of state.confounders) assert.ok(text.includes(line), `${name}: ${line}`);
    assert.ok(text.includes(state.provenance.source));
    assert.equal(detail.open, false, "closed by default, so it is disclosure and not noise");
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
  assert.match(textOf(pick(document, ".spd-detail")), /bundled example release log/);
  // A figure, its unit, and the framing that keeps it an observation.
  assert.match(textOf(pick(document, ".spd-figure")), /per completed release/);
  assert.match(textOf(pick(document, ".spd-framing")), /observational ratio/);
});

test("an imported export with an empty release log asks for a release, not for more billing", async () => {
  const { document } = await openFinopsTab();
  chooseExampleExports(document);
  await waitFor(() => !section(document).hidden, "the delivery comparison to be painted");

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
  await waitFor(() => !section(document).hidden, "the delivery comparison to be painted");

  assert.equal(section(document).dataset.state, SPEND_PER_DELIVERY_STATE.mismatched);
  assert.equal(section(document).dataset.reason, "no_delivery_in_spend_window");
  assert.equal(pick(document, ".spd-figure"), null, "no ratio is published for a drifted window");
  assert.match(textOf(pick(document, ".spd-detail")), /this browser's release log/);
});

test("stored releases inside the imported window publish a ratio the reader can check", async () => {
  const { document } = await openFinopsTab(
    releaseLog("2026-06-03", "2026-06-13", "2026-06-23"));
  chooseExampleExports(document);
  await waitFor(() => !section(document).hidden, "the delivery comparison to be painted");

  assert.equal(section(document).dataset.state, SPEND_PER_DELIVERY_STATE.eligible);
  assert.equal(section(document).dataset.origin, "import");
  assert.ok(textOf(pick(document, ".spd-figure")).includes("3 completed releases"));
  // Only three months of this browser's log exist inside six billing periods, so
  // there is no trailing baseline and confidence says so rather than implying one.
  assert.equal(pick(document, ".spd-confidence").dataset.level, "medium");
});
