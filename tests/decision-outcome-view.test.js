// What the outcome region actually paints.
//
// These assertions are about structure a reader depends on and that regresses
// silently: the four states each naming themselves in text, the decision and its
// linked release staying outside every disclosure, the two `<details>` starting
// closed, and the loading/absent/incomplete states being rendered content rather
// than an empty box. Anything needing real layout or a real toggle belongs in a
// browser test, not here.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { byClass, first, installDocument, tags, walk } from "./support/dom.js";

installDocument();
// The decision builder is imported through `app.js`, whose page bootstrap asks
// the document for its own form before doing anything. The stub has no query
// engine, so it answers "not this page" and the module loads inert.
globalThis.document.querySelector = () => null;

const { decisionOutcome, OUTCOME_STATUS } = await import("../src/decision-outcome.js");
const { DECISION_OUTCOME_STATE_COPY, renderDecisionOutcome, renderDecisionOutcomeState } =
  await import("../src/decision-outcome-view.js");

function container() {
  const node = globalThis.document.createElement("div");
  node.id = "decision-outcome";
  node.setAttribute("aria-busy", "true");
  return node;
}

// The decision as `buildCommitmentDecision` writes it. That builder's own output
// is pinned in `decision-outcome.test.js`; here the block is stated literally so
// this file is about what gets painted rather than about how it was built.
const decision = {
  id: "finops-commitment-route-support-summaries",
  title: "Route support-summaries to efficient-small",
  context: "Approved FinOps commitment route-support-summaries.",
  alternatives: "Keep routing support-summaries on frontier-large.",
  owner: "Dana Okafor",
  status: "accepted",
  createdAt: "2026-05-04T09:30:00.000Z",
  finopsCommitment: {
    schemaVersion: "shiplog-finops-commitment/1.0.0",
    commitmentId: "route-support-summaries",
    claim: {
      baselineMonthlyCostMinor: 1_200_000,
      projectedMonthlyCostMinor: 718_000,
      monthlySavingsMinor: 482_000,
      currency: "USD",
      unit: "usd_minor",
      period: "2026-05",
    },
    confidence: { percent: 78, band: "high" },
    provenance: {
      sourceId: "outcome-view-source",
      designation: "imported",
      importedAt: "2026-05-01T06:00:00.000Z",
      analysisPeriod: "2026-05",
      recordIds: ["record-a", "record-b"],
      recordCount: 2,
    },
    recommendedAction: {
      workloadId: "support-summaries",
      departmentId: "customer-support",
      fromModelId: "frontier-large",
      toModelId: "efficient-small",
    },
  },
};

const release = {
  id: "release-outcome-1",
  version: "2026.06.01",
  owner: "Priya Raman",
  status: "shipped",
  createdAt: "2026-05-28T12:00:00.000Z",
  decisionIds: [decision.id],
};

function observation(spendUsd = 7_000, unitId = "customer-support") {
  return {
    period: "2026-06-01 to 2026-07-01",
    modelRouting: {
      ranked: [{ unitId, candidates: [{ model: "frontier-large", currentSpendUsd: spendUsd }], excludedModels: [] }],
      insufficientData: [],
    },
  };
}

const META = { name: "finops-2026-06.json", month: "2026-06", dataset: "user", savedOn: "2026-07-01" };

function paint(overrides = {}) {
  const node = container();
  const outcome = decisionOutcome({
    decision, releases: [release], observation: observation(), observationMeta: META, ...overrides,
  });
  return { node, article: renderDecisionOutcome(node, outcome), outcome };
}

const text = (node) => (node ? node.textContent : "");

/* ------------------------------ what it renders ---------------------------- */

test("a verified outcome paints the question, the state, and the one comparison", () => {
  const { node, article } = paint();
  assert.equal(article.dataset.status, OUTCOME_STATUS.verified);
  assert.equal(node.getAttribute("aria-busy"), "false");
  assert.equal(node.dataset.state, OUTCOME_STATUS.verified);
  assert.equal(article.getAttribute("aria-labelledby"), "dout-question");
  assert.equal(first(article, "dout-question").id, "dout-question");
  assert.match(text(first(article, "dout-question")), /Did this decision save what it projected\?/);
  assert.equal(text(first(article, "dout-figure-value")), "$5,000.00");
  assert.match(text(first(article, "dout-figure-against")), /\$4,820\.00 projected/);
  // Exactly one headline figure: a second one would be a second answer.
  assert.equal(byClass(article, "dout-figure-value").length, 1);
});

test("each state names itself in text and carries a non-colour shape cue", () => {
  const states = [
    { overrides: {}, status: "verified", label: "Verified", shape: "solid" },
    { overrides: { observation: observation(9_000) }, status: "underperforming", label: "Underperforming", shape: "double" },
    { overrides: { observation: null, observationMeta: null }, status: "inconclusive", label: "Inconclusive", shape: "dashed" },
    { overrides: { observation: observation(7_000, "platform-engineering") }, status: "unmatched", label: "Unmatched", shape: "dotted" },
  ];
  const seen = new Set();
  for (const state of states) {
    const { article } = paint(state.overrides);
    const banner = first(article, "dout-status");
    assert.equal(article.dataset.status, state.status);
    assert.equal(article.dataset.shape, state.shape);
    assert.equal(banner.dataset.shape, state.shape);
    assert.equal(text(first(article, "dout-status-label")), state.label);
    // The glyph is decorative: it repeats the word, never replaces it.
    assert.equal(first(article, "dout-cue").getAttribute("aria-hidden"), "true");
    assert.ok(text(first(article, "dout-statement")).length > 0, `${state.status} states no reason`);
    seen.add(state.shape);
  }
  assert.equal(seen.size, 4);
});

test("a state with no comparison says so rather than leaving a blank", () => {
  const { article } = paint({ observation: null, observationMeta: null });
  const comparison = first(article, "dout-comparison");
  assert.equal(comparison.dataset.state, "absent");
  assert.equal(byClass(article, "dout-figure-value").length, 0);
  assert.match(text(first(article, "dout-comparison-absent")), /No observed-against-projected figure/);
  assert.match(text(first(article, "dout-next-label") ?? first(article, "dout-next-link")),
    /month after the baseline/);
});

test("exactly one next action is painted, whatever the state", () => {
  for (const overrides of [{}, { releases: [] }, { observation: null, observationMeta: null }]) {
    const { article } = paint(overrides);
    const labels = [...byClass(article, "dout-next-label"), ...byClass(article, "dout-next-link")];
    assert.equal(labels.length, 1);
    assert.ok(text(first(article, "dout-next-rationale")).length > 0);
  }
});

/* ----------------------------- the linked records -------------------------- */

test("the decision and its linked release are painted as links, outside every disclosure", () => {
  const { article } = paint();
  const decisionLink = first(article, "dout-decision-link");
  assert.equal(decisionLink.getAttribute("href"), `/decision.html?id=${encodeURIComponent(decision.id)}`);
  assert.equal(text(decisionLink), decision.title);
  const releaseLink = first(article, "dout-release-link");
  assert.equal(releaseLink.getAttribute("href"), "/release.html?id=release-outcome-1");
  assert.match(text(first(article, "dout-links")), /Priya Raman · recorded 2026-05-28/);

  for (const className of ["dout-links", "dout-evidence", "dout-comparison"]) {
    const block = first(article, className);
    assert.ok(block, `${className} is not painted`);
    let parent = block.parent;
    while (parent) {
      assert.notEqual(parent.tagName, "DETAILS", `${className} is hidden inside a disclosure`);
      parent = parent.parent;
    }
  }
});

test("a decision no release links to says so where the release would have been", () => {
  const { article } = paint({ releases: [] });
  assert.equal(first(article, "dout-release-link"), null);
  assert.match(text(first(article, "dout-release-absent")), /No release links to this decision/);
  assert.match(text(first(article, "dout-next-link")), /Record the release/);
});

/* ------------------------------- the disclosures --------------------------- */

test("the calculation and the period comparison are closed disclosures, not hidden divs", () => {
  const { article } = paint();
  const details = tags(article, "DETAILS");
  assert.deepEqual(details.map((node) => node.dataset.disclosure), ["calculation", "periods"]);
  for (const node of details) {
    // Closed by default: the headline is readable without opening anything.
    assert.equal(node.getAttribute("open"), null);
    assert.equal(node.firstChild.tagName, "SUMMARY");
    assert.ok(text(node.firstChild).length > 0);
  }
  assert.equal(text(details[0].firstChild), "How this was calculated");
  assert.match(text(details[0]), /1200000 - 700000 = 500000 minor units/);
  assert.equal(text(details[1].firstChild), "Compare the two months");
  assert.match(text(details[1]), /June 2026/);
  assert.match(text(details[1]), /\$12,000\.00/);
});

test("the disclosures still open on a state with nothing to disclose, and say what is missing", () => {
  const { article } = paint({ observation: null, observationMeta: null });
  const details = tags(article, "DETAILS");
  assert.equal(details.length, 2);
  assert.equal(text(details[0].firstChild), "How this would be calculated");
  assert.match(text(details[0]), /no observed month has been paired/);
  assert.match(text(details[1]), /Two months are needed to compare/);
});

/* --------------------------- evidence and confidence ----------------------- */

test("evidence cites both sides and marks itself complete", () => {
  const { article } = paint();
  const evidence = first(article, "dout-evidence");
  assert.equal(evidence.dataset.complete, "true");
  assert.deepEqual(byClass(evidence, "dout-citation").map((node) => node.dataset.side),
    ["observed", "baseline", "baseline"]);
  assert.equal(first(article, "dout-evidence-gaps"), null);
  assert.match(text(first(evidence, "dout-evidence-count")), /2 baseline records/);
});

test("incomplete evidence is a named list of gaps, not a missing panel", () => {
  const { article } = paint({ releases: [], observationMeta: { ...META, dataset: "example" } });
  const evidence = first(article, "dout-evidence");
  assert.equal(evidence.dataset.complete, "false");
  const gaps = first(evidence, "dout-evidence-gaps");
  assert.equal(gaps.getAttribute("aria-label"), "What this evidence is missing");
  assert.equal(gaps.children.length, 2);
  assert.match(text(gaps), /example dataset/);
});

test("confidence is painted with the rules that produced it, never as a bare adjective", () => {
  const { article } = paint({ releases: [] });
  const block = first(article, "dout-confidence");
  assert.equal(block.dataset.level, "medium");
  assert.match(text(first(block, "dout-confidence-level")), /Medium confidence · commitment recorded 78%/);
  assert.ok(byClass(block, "dout-confidence-reasons")[0].children.length >= 2);
});

test("a decision with no commitment metadata still paints every region", () => {
  const node = container();
  const article = renderDecisionOutcome(node, decisionOutcome({
    decision: { id: "plain-1", title: "Adopt trunk-based development", owner: "Ada", status: "accepted" },
    releases: [],
  }));
  assert.equal(article.dataset.status, "inconclusive");
  assert.equal(first(article, "dout-confidence").dataset.level, "none");
  assert.match(text(first(article, "dout-provenance")), /carries no FinOps commitment metadata/);
  for (const className of ["dout-comparison", "dout-evidence", "dout-next"]) {
    assert.ok(text(first(article, className)).length > 0, `${className} is empty`);
  }
});

/* ------------------------------ the other states --------------------------- */

test("loading and error are rendered states with the same shape as an outcome", () => {
  const loading = container();
  const section = renderDecisionOutcomeState(loading, "loading");
  assert.equal(section.dataset.state, "loading");
  assert.equal(section.getAttribute("role"), "status");
  assert.equal(loading.getAttribute("aria-busy"), "true");
  assert.equal(first(section, "dout-state-title").id, "dout-question");
  assert.match(text(section), /Checking this decision’s outcome/);

  const failed = container();
  const errorSection = renderDecisionOutcomeState(failed, "error");
  assert.equal(errorSection.getAttribute("role"), "alert");
  assert.equal(failed.getAttribute("aria-busy"), "false");
  assert.match(text(errorSection), /no outcome is stated/);

  // An unknown state is the error state, never an empty region.
  assert.match(text(renderDecisionOutcomeState(container(), "nonsense")), /could not be read/);
});

test("the decision page ships the loading state, the control, and the script", async () => {
  const html = await readFile(new URL("../src/decision.html", import.meta.url), "utf8");
  assert.match(html, /id="decision-outcome"[^>]*aria-busy="true"/);
  // The region is never an empty box before the module runs, and the two copies
  // of the loading sentence say the same thing.
  assert.ok(html.includes(DECISION_OUTCOME_STATE_COPY.loading.title), "the loading title drifted");
  assert.ok(html.includes(DECISION_OUTCOME_STATE_COPY.loading.body), "the loading body drifted");
  // The file control is in the markup, not in the render module, so it is not
  // replaced — and its focus not stolen — every time the region repaints.
  assert.match(html,
    /<input id="dout-file" type="file"[^>]*aria-describedby="dout-file-intro dout-file-note"/);
  assert.match(html, /<label for="dout-file">/);
  assert.match(html, /id="dout-file-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /src="\/decision-outcome-page\.js"/);
  assert.match(html, /href="\/decision-outcome\.css"/);
});

test("the panel's copy tells a first-time reader what is recorded and what is optional", async () => {
  const html = await readFile(new URL("../src/decision.html", import.meta.url), "utf8");
  const controls = html.match(/<div class="dout-controls">[\s\S]*?<\/div>/)[0];

  // The two headings name the two halves, so a reader arriving with no FinOps
  // context can tell the recorded decision from the file they may never open.
  assert.match(html, /id="dout-panel-title">Recorded outcome and optional evidence</);
  assert.match(controls, /<h3 class="dout-controls-title">Optional evidence<\/h3>/);

  // One sentence, before the control, saying what opening a briefing adds and
  // that opening it is optional.
  const intro = controls.match(/<p class="dout-file-intro" id="dout-file-intro">([^<]*)<\/p>/)[1];
  assert.ok(controls.indexOf(intro) < controls.indexOf('for="dout-file"'),
    "the explanation must precede the control it explains");
  assert.match(intro, /is optional/);
  assert.match(intro, /measured against what this decision projected/);

  // The note names the file and where it comes from rather than describing a
  // month by how the decision was priced.
  const note = controls.match(/id="dout-file-note">([^<]*)</)[1];
  assert.match(note, /AI FinOps page/);
  assert.match(note, /Export briefing \(JSON\)/);
  assert.doesNotMatch(note, /priced in/);

  // The empty state is reassuring and actionable, and names the control by its
  // own label rather than saying "try again".
  const status = controls.match(/id="dout-file-status"[^>]*>([^<]*)</)[1];
  assert.match(status, /reads without one/);
  assert.match(status, /Open a later month’s FinOps briefing/);
});

test("the two waiting states describe their own region and nothing else", () => {
  const { loading, reading } = DECISION_OUTCOME_STATE_COPY;
  // The recorded half never claims to be reading a file, and the file half
  // never restates the recorded half.
  assert.doesNotMatch(loading.body, /briefing|month you have opened/i);
  assert.match(loading.body, /No file is needed for this step/);
  assert.match(reading.title, /FinOps briefing/);
  assert.match(reading.body, /FinOps briefing/);
  assert.doesNotMatch(reading.body, /savings-commitment contract/);
  assert.notEqual(loading.title, reading.title);
});

test("painting replaces the previous state rather than appending to it", () => {
  const node = container();
  renderDecisionOutcomeState(node, "loading");
  renderDecisionOutcome(node, decisionOutcome({
    decision, releases: [release], observation: observation(), observationMeta: META,
  }));
  assert.equal(node.children.length, 1);
  assert.equal(walk(node, (candidate) => candidate.classes.includes("dout-state")).length, 0);
});
