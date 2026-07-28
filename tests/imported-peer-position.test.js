// The peer position a leader's own import is shown, and the states that are
// honestly not a position at all.
//
// WHAT THIS FILE PINS. The card used to publish a percentile and a run-on note,
// or the words "Not in this import". Neither told a reader what they were being
// compared against, how like them that group is, or when the reference data was
// published — so a rank could be quoted into a board pack without a single fact
// that bounds it. Every assertion below is about one of four things:
//
//   1. A comparison the model EXPLICITLY qualified renders as a position: the
//      percentile, the quartile, the comparator segment, the material distance
//      from the cohort median, and one prioritized next step.
//   2. The qualifiers — comparability, confidence, cohort version and snapshot —
//      are on the card itself, not inside the disclosure.
//   3. A comparison that is unavailable, refused, or malformed claims NO rank
//      and NO cohort, and names what would be needed instead.
//   4. The method and the supporting metrics are one native, keyboard-operable
//      disclosure away, and they print.
//
// Fixtures are generated here rather than committed: the shapes are the ones
// `gradeImportedCorpus` and `localFinops` publish, and the cohort behind them is
// the repository's own published reference data.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, textOf } from "./support/browser.js";
import {
  DISPLAY_REFUSAL, IMPORTED_EXECUTIVE_VIEW_VERSION, applyImportedExecutive,
  clearImportedExecutive, importedHeroFigures, importedKpiFigures, importedMixFigures,
} from "../src/imported-executive-view.js";
import { importedPeerBenchmark } from "../src/imported-peer-benchmark.js";
import {
  HEADLINE_METRIC_ID, PEER_COHORT_PROVENANCE, PEER_UNAVAILABLE_REASON,
} from "../src/peer-cohort-contract.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const CSS = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");

const RUBRIC = PEER_COHORT_PROVENANCE.rubricVersion;

/** A graded corpus, shaped exactly as `gradeImportedCorpus` publishes one. */
const grade = (composite, highValueShare, { scored = 240 } = {}) => Object.freeze({
  gradeable: true,
  composite,
  grade: "B",
  rubricVersionId: RUBRIC,
  records: Object.freeze({ source: scored, scored, unclassified: 0 }),
  score: Object.freeze({
    categories: Object.freeze([
      Object.freeze({ key: "highValue", share: highValueShare, records: 12 }),
      Object.freeze({ key: "inefficient", share: 1 - highValueShare, records: 8 }),
    ]),
  }),
});

/** A local-finops analysis, shaped as the page holds one. */
const analysis = (departments, spendUsd, recoverableUsd, extra = {}) => Object.freeze({
  period: "2026-06-01 to 2026-06-30",
  spendUsd,
  recoverableUsd,
  rankedDepartments: Object.freeze(
    Array.from({ length: departments }, (unused, index) => Object.freeze({ id: `unit-${index}` }))),
  topDepartment: Object.freeze({ id: "unit-3", name: "unit-3 · Platform", recoverableUsd: 2100 }),
  action: "Pilot lower-cost routing for text-generation in unit-3 · Platform.",
  ...extra,
});

/** An import a published cohort applies to, sitting below its median. */
const comparable = () => importedPeerBenchmark({
  grade: grade(46, 0.16), analysis: analysis(8, 10000, 3400),
});

/** An import with no attributed org unit: no segment, so no cohort, so no rank. */
const refused = () => importedPeerBenchmark({
  grade: grade(46, 0.16), analysis: analysis(0, 10000, 3400),
});

const peerCardOf = (peer) => importedKpiFigures(grade(46, 0.16), {
  spendUsd: 10000, recoverableUsd: 3400, departments: 8, period: "2026-06", peer,
}).find((entry) => entry.key === "peer");

const figuresFor = (peer) => Object.freeze({
  version: IMPORTED_EXECUTIVE_VIEW_VERSION,
  hero: importedHeroFigures(null),
  kpis: importedKpiFigures(grade(46, 0.16), {
    spendUsd: 10000, recoverableUsd: 3400, departments: 8, period: "2026-06", peer,
  }),
  mix: importedMixFigures(null),
});

const byId = (document, id) => document.getElementById(id);
const shown = (document, id) => textOf(byId(document, id));

// --- 1. a qualified comparison is a position --------------------------------

test("a qualified comparison publishes the position, its comparator, and its cohort version", () => {
  const peer = comparable();
  const card = peerCardOf(peer);
  assert.equal(card.available, true);

  // The rank, and the quarter of the named cohort it falls in.
  assert.equal(card.value, `${peer.headline.percentile}th`);
  assert.equal(card.note, `${peer.headline.quartileLabel} of ${peer.cohort.label}`);

  // How like this organization the cohort is, and how much weight that carries.
  // Both are the contract's labels, with their raw codes beside them so the
  // styling keys off a value rather than off a substring.
  assert.equal(card.trust.comparability, peer.comparability);
  assert.equal(card.trust.confidence, peer.confidence);
  assert.match(card.trust.text, new RegExp(peer.comparabilityLabel.split(" ·")[0]));
  assert.match(card.trust.text, new RegExp(peer.confidenceLabel));

  // Who the comparator was, and why that cohort was the one selected.
  assert.match(card.segment.text, new RegExp(`${peer.cohort.memberCount} published synthetic peers`));
  assert.match(card.segment.text, new RegExp(peer.cohort.segmentLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(card.segment.basis, /8 attributed org units/);
  assert.match(card.segment.basis, /no industry declared/);

  // When the reference data was published, on the card and not in a disclosure.
  assert.match(card.cohortVersion.text, new RegExp(PEER_COHORT_PROVENANCE.version.replace(/\//g, "\\/")));
  assert.match(card.cohortVersion.text, new RegExp(PEER_COHORT_PROVENANCE.snapshotDate));
  assert.match(card.cohortVersion.text, new RegExp(RUBRIC.replace(/\//g, "\\/")));
  assert.match(card.cohortVersion.text, new RegExp(peer.cohort.cohortId));

  // The material distance: a rank says where, a delta says whether it matters.
  assert.equal(card.delta.metricId, HEADLINE_METRIC_ID);
  assert.equal(card.delta.ahead, false, "this import scores below its cohort median");
  assert.equal(card.delta.size, Math.abs(peer.headline.value - peer.headline.cohortMedian));
  assert.match(card.delta.text, new RegExp(`behind the cohort median of ${peer.headline.cohortMedian}`));

  // And exactly one prioritized next step, which is the contract's own.
  assert.equal(card.finding.action, peer.action.text);
  assert.equal(card.needed, null, "a card with a position asks a reader for nothing");
});

test("an import ahead of its cohort reads as ahead, in the metric's own direction", () => {
  const peer = importedPeerBenchmark({
    grade: grade(83, 0.5), analysis: analysis(8, 10000, 800),
  });
  const card = peerCardOf(peer);
  assert.equal(card.available, true);
  assert.equal(card.delta.ahead, true);
  assert.match(card.delta.text, /ahead of the cohort median/);
  // The high-value share is higher-is-better and the recoverable share is
  // lower-is-better; the words come from the metric, never from the sign.
  const recoverable = card.supporting.find((entry) => entry.id === "recoverable_share");
  assert.match(recoverable.text, /lower is better/);
});

test("the supporting metrics are the contract's other comparisons, in their own units", () => {
  const peer = comparable();
  const card = peerCardOf(peer);
  const expected = peer.comparisons.filter((entry) => entry.metricId !== HEADLINE_METRIC_ID);
  assert.equal(card.supporting.length, expected.length);
  assert.ok(expected.length > 0, "the contract publishes at least one supporting metric");
  assert.equal(card.supporting.some((entry) => entry.id === HEADLINE_METRIC_ID), false,
    "the headline is the position, not one of its supporting rows");
  for (const entry of card.supporting) {
    const comparison = expected.find((item) => item.metricId === entry.id);
    assert.equal(entry.label, comparison.label);
    if (!comparison.available) {
      // A metric the cohort could not compare is listed with the contract's own
      // reason. A list that silently shortens reads as a cohort with less to say.
      assert.equal(entry.available, false);
      assert.equal(entry.text, comparison.unavailable.need);
      continue;
    }
    assert.match(entry.text, new RegExp(`${comparison.percentile}th percentile`));
    assert.match(entry.text, new RegExp(comparison.quartileLabel));
    // Shares are printed as shares, never as the raw [0,1] value the model holds.
    if (comparison.metricId !== HEADLINE_METRIC_ID && comparison.value < 1) {
      assert.match(entry.text, /%/);
    }
  }
});

test("the method notes are assembled from what the comparison published about itself", () => {
  const card = peerCardOf(comparable());
  const method = card.method.join(" ");
  assert.match(method, /attributed org units, never in employees/);
  assert.match(method, new RegExp(RUBRIC.replace(/\//g, "\\/")));
  assert.match(method, /at least 8 published cohort values/);
  assert.match(method, new RegExp(PEER_COHORT_PROVENANCE.statement.slice(0, 40)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

// --- 2. the states that are not a position ----------------------------------

test("an unavailable comparison names what it needs and claims no rank", () => {
  for (const [label, peer, reason] of [
    ["no benchmark evaluated", null, "no_peer_cohort"],
    ["a refused benchmark", refused(), PEER_UNAVAILABLE_REASON.noSegmentInput],
  ]) {
    const card = peerCardOf(peer);
    assert.equal(card.available, false, label);
    assert.equal(card.unavailable.reason, reason, label);
    // Every fact that would imply a position is absent, not empty-stringed.
    assert.equal(card.trust, null, label);
    assert.equal(card.segment, null, label);
    assert.equal(card.cohortVersion, null, label);
    assert.equal(card.delta, null, label);
    assert.equal(card.finding, null, label);
    assert.deepEqual(card.supporting, [], label);
    assert.deepEqual(card.method, [], label);
    // …and what a reader would have to supply is named rather than implied.
    assert.match(card.needed, new RegExp(card.unavailable.needLabel
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), label);
  }
});

/**
 * A result that claims to be available without the facts a position needs.
 *
 * Each patch removes exactly one of them. None of these shapes should reach a
 * reader as a partly drawn card, and none should throw: a model can go wrong in
 * a build somebody is already looking at, and "no position" is the only honest
 * thing to say when the qualifiers are gone.
 */
const MALFORMED = Object.freeze([
  ["no headline at all", { headline: null }],
  ["a percentile that is not a number", (peer) => ({ headline: { ...peer.headline, percentile: null } })],
  ["no quartile label", (peer) => ({ headline: { ...peer.headline, quartileLabel: "" } })],
  ["an unnamed cohort", (peer) => ({ cohort: { ...peer.cohort, label: "" } })],
  ["no comparator segment", (peer) => ({ cohort: { ...peer.cohort, segmentLabel: "  " } })],
  ["a cohort with no members", (peer) => ({ cohort: { ...peer.cohort, memberCount: 0 } })],
  ["no comparability label", { comparabilityLabel: "" }],
  ["no confidence label", { confidenceLabel: null }],
  ["no published version", { provenance: {} }],
  ["no cohort object", { cohort: null }],
]);

test("a result that says available without the facts a position needs is refused", () => {
  for (const [label, patch] of MALFORMED) {
    const peer = comparable();
    const broken = { ...peer, ...(typeof patch === "function" ? patch(peer) : patch) };
    const card = peerCardOf(broken);
    assert.equal(card.available, false, label);
    assert.equal(card.unavailable.reason, DISPLAY_REFUSAL.unqualifiedPeer, label);
    assert.equal(card.value, "Not in this import", label);
    assert.equal(card.trust, null, label);
    assert.equal(card.cohortVersion, null, label);
    assert.equal(card.finding, null, label);
    assert.match(card.note, /no rank is shown for this import/, label);
  }
});

test("a qualified position with no comparisons array still renders, without support", () => {
  // Half a model is not the same defect as a wrong position: the percentile, the
  // cohort and both labels are present, so the position stands and only the
  // supporting list is empty.
  const card = peerCardOf({ ...comparable(), comparisons: null });
  assert.equal(card.available, true);
  assert.deepEqual(card.supporting, []);
  assert.ok(card.method.length > 0, "the cohort and its rubric are still publishable");
});

// --- 3. what a leader actually sees -----------------------------------------

test("the shipped card carries the position, its qualifiers, and its cohort version", async () => {
  const page = await loadPage(PAGE);
  const { document } = page;
  try {
    const peer = comparable();
    applyImportedExecutive(document, figuresFor(peer));

    assert.equal(shown(document, "kpi-peer-value"), `${peer.headline.percentile}th`);
    assert.equal(byId(document, "kpi-peer").dataset.available, "true");

    const trust = byId(document, "kpi-peer-trust");
    assert.equal(trust.hidden, false);
    assert.equal(trust.dataset.comparability, peer.comparability);
    assert.equal(trust.dataset.confidence, peer.confidence);
    assert.match(textOf(trust), /confidence/i);

    // The comparator and the snapshot are readable without opening anything.
    assert.equal(byId(document, "kpi-peer-segment").hidden, false);
    assert.match(shown(document, "kpi-peer-segment"), /published synthetic peers/);
    assert.equal(byId(document, "kpi-peer-provenance").hidden, false);
    assert.match(shown(document, "kpi-peer-provenance"), /finops-peer-cohort\/1\.0\.0/);
    assert.match(shown(document, "kpi-peer-provenance"), /snapshot 2026-06-30/);
    assert.equal(byId(document, "kpi-peer-delta").hidden, false);
    assert.match(shown(document, "kpi-peer-delta"), /cohort median/);

    // One next step, and nothing asking the reader for an input.
    assert.equal(byId(document, "kpi-peer-finding").hidden, false);
    assert.equal(byId(document, "kpi-peer-needed").hidden, true);
    assert.equal(shown(document, "kpi-peer-needed"), "");
  } finally {
    page.restore();
  }
});

test("the method and the supporting metrics are one native disclosure away", async () => {
  const page = await loadPage(PAGE);
  const { document } = page;
  try {
    const card = peerCardOf(comparable());
    applyImportedExecutive(document, figuresFor(comparable()));

    const detail = byId(document, "kpi-peer-detail");
    assert.equal(detail.hidden, false);
    assert.equal(detail.tagName, "DETAILS");
    // Native summary: Enter and Space, and the expanded state, are the element's
    // own. Nothing here reimplements either, so there is no aria-expanded to
    // keep in step and no key handler to get wrong.
    const summary = detail.querySelector("summary");
    assert.equal(summary.tagName, "SUMMARY");
    const label = textOf(summary);
    assert.ok(label.length > 12, `"${label}" is too short to say what it reveals`);
    assert.doesNotMatch(label, /^(more|details|show|expand|…)$/i);

    const supporting = byId(document, "kpi-peer-supporting");
    assert.equal(supporting.children.length, card.supporting.length);
    assert.equal(byId(document, "kpi-peer-supporting-block").hidden, false);
    assert.equal(textOf(supporting.children[0]), card.supporting[0].text);
    const method = byId(document, "kpi-peer-method");
    assert.equal(method.children.length, card.method.length);
    assert.equal(byId(document, "kpi-peer-method-block").hidden, false);

    // Nothing in the card is taken out of the tab order or given a positive
    // tabindex, so the reading order and the tab order stay the same order.
    for (const node of byId(document, "kpi-peer").querySelectorAll("[tabindex]")) {
      assert.ok(["-1", "0"].includes(node.getAttribute("tabindex")));
    }
  } finally {
    page.restore();
  }
});

test("the disclosure control has a visible focus ring and its content prints", () => {
  assert.match(CSS, /\.kpi-disclosure>summary:focus-visible\s*\{[^}]*outline:3px solid var\(--focus-ring\)/,
    "the only new keyboard control on the card must show where focus is");
  // A briefing that prints a percentile and drops the cohort it was measured in
  // is the claim this panel exists not to make, so the disclosure opens on paper
  // in CSS rather than by mutating the DOM on beforeprint.
  assert.match(CSS, /\.kpi-disclosure::details-content/);
  assert.match(CSS, /\.kpi-disclosure>\*/);
});

test("an unavailable card shows no rank, no cohort, and names the input it needs", async () => {
  const page = await loadPage(PAGE);
  const { document } = page;
  try {
    // First a comparable import, so the assertions below are about a card that
    // had a position and lost it — the state a stale qualifier survives.
    applyImportedExecutive(document, figuresFor(comparable()));
    const peer = refused();
    applyImportedExecutive(document, figuresFor(peer));

    const card = byId(document, "kpi-peer");
    assert.equal(card.dataset.available, "false");
    assert.equal(card.dataset.unavailableReason, PEER_UNAVAILABLE_REASON.noSegmentInput);
    assert.equal(byId(document, "kpi-peer-flag").hidden, false);
    assert.equal(shown(document, "kpi-peer-value"), "Not in this import");
    assert.equal(shown(document, "kpi-peer-note"), peer.unavailable.need);

    // Hidden AND emptied, so nothing that ignores `hidden` — a print stylesheet,
    // an extension, a copy of the DOM — can read a rank off a refused card.
    for (const id of ["kpi-peer-trust", "kpi-peer-segment", "kpi-peer-delta", "kpi-peer-provenance"]) {
      assert.equal(byId(document, id).hidden, true, id);
      assert.equal(shown(document, id), "", id);
    }
    assert.equal(byId(document, "kpi-peer-detail").hidden, true);
    assert.equal(byId(document, "kpi-peer-supporting").children.length, 0);
    assert.equal(byId(document, "kpi-peer-method").children.length, 0);
    assert.equal(byId(document, "kpi-peer-finding").hidden, true);

    // What is left says what would be needed, and implies nothing about where
    // this organization would land if it were supplied.
    assert.equal(byId(document, "kpi-peer-needed").hidden, false);
    assert.match(shown(document, "kpi-peer-needed"), /Needed for a peer position/);
    const text = textOf(card);
    assert.doesNotMatch(text, /percentile|quartile|cohort median/i);
    assert.doesNotMatch(text, /\b\d+(st|nd|rd|th)\b/);
    assert.doesNotMatch(text, /finops-peer-cohort/);
  } finally {
    page.restore();
  }
});

test("a malformed comparison reaches the page as a refusal, not as half a position", async () => {
  const page = await loadPage(PAGE);
  const { document } = page;
  try {
    applyImportedExecutive(document, figuresFor(comparable()));
    applyImportedExecutive(document, figuresFor({ ...comparable(), headline: null }));

    const card = byId(document, "kpi-peer");
    assert.equal(card.dataset.available, "false");
    assert.equal(card.dataset.unavailableReason, DISPLAY_REFUSAL.unqualifiedPeer);
    assert.doesNotMatch(textOf(card), /\b\d+(st|nd|rd|th)\b/);
    assert.doesNotMatch(textOf(card), /finops-peer-cohort/);
    assert.equal(byId(document, "kpi-peer-detail").hidden, true);
    assert.equal(byId(document, "kpi-peer-finding").hidden, true);
  } finally {
    page.restore();
  }
});

test("returning to the bundled sample takes every peer qualifier down with it", async () => {
  const page = await loadPage(PAGE);
  const { document } = page;
  try {
    applyImportedExecutive(document, figuresFor(comparable()));
    assert.equal(byId(document, "kpi-peer-provenance").hidden, false);

    clearImportedExecutive(document);
    for (const id of [
      "kpi-peer-trust", "kpi-peer-segment", "kpi-peer-delta", "kpi-peer-provenance",
      "kpi-peer-needed",
    ]) {
      assert.equal(byId(document, id).hidden, true, id);
      assert.equal(shown(document, id), "", id);
    }
    assert.equal(byId(document, "kpi-peer-detail").hidden, true);
    assert.equal(byId(document, "kpi-peer-supporting").children.length, 0);
    assert.equal(byId(document, "kpi-peer-method").children.length, 0);
  } finally {
    page.restore();
  }
});
