// The trajectory finding: is the habit this reader was told to change first
// actually moving, and may this page say so?
//
// HOW THIS SUITE IS ARGUED. Every reading is produced by the real reader from
// Theo's benchmark periods, which carry 7.8, 6.0, and 4.2 points per scored
// prompt on the same leading move. Those three figures are derived from the
// labelled prompts in tests/personal-history-evaluation.test.js and asserted
// against Rowan's own comparison in tests/personal-history-carry-forward.test.js,
// so nothing below is a number recorded from a run.
//
// WHERE A SLOT IS BUILT BY HAND, AND WHY. The materiality rule is about
// differences of hundredths, and no pair of shipped fixtures differs by a
// hundredth. Inventing prompts to manufacture one would be inventing evidence,
// so those cases take a real report and a *stated* previous figure, written on
// the page beside the threshold it is being tested against. Every such slot
// still goes through `validateCarriedSummary` on the way in, exactly as one read
// out of a browser would.
//
// WHAT A FAILURE HERE MEANS. A state failure is the six findings no longer being
// total or no longer matching the four carry-forward states they read. A
// materiality failure is this page about to tell somebody their habit improved
// on a rounding difference. A handoff failure is either a dead control or — the
// one that ships harm rather than a wrong number — prompt text reaching a
// clipboard.
//
// NOTHING HERE IS REAL. Every export is generated in-test from the bundled
// synthetic prompts.

import test from "node:test";
import assert from "node:assert/strict";

import { DomEvent, loadPage, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { buildPersonalHistoryReport } from "../src/personal-history-report.js";
import { PERSONAL_REPORT_STATE } from "../src/personal-history-contract.js";
import { PERSONAL_RUN_KIND } from "../src/personal-history-entry.js";
import {
  EVAL_BENCHMARK_PERIODS, buildEvalExport, evalDays, evalFixtureExport,
} from "../src/personal-history-eval-fixtures.js";
import {
  CARRY_FORWARD_STATE, CARRY_FORWARD_STORAGE,
  carryForwardSummary, compareWithCarriedSummary, readCarriedSummary, validateCarriedSummary,
} from "../src/personal-history-carry-forward.js";
import {
  TRAJECTORY_CONFIDENCE_CAVEAT, TRAJECTORY_FINDING, TRAJECTORY_HANDOFF, TRAJECTORY_MATERIALITY,
  TRAJECTORY_STATE, buildTrajectory, movementMateriality, trajectoryBriefText, trajectoryHandoff,
} from "../src/personal-history-trajectory.js";

const PAGE = new URL("../src/personal-history.html", import.meta.url);

/** A storage object with the three methods the carry-forward module uses. */
function fakeStorage(seed = null) {
  const values = new Map(seed === null ? [] : [[CARRY_FORWARD_STORAGE.key, seed]]);
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
  };
}

/** A browser that refuses storage outright, the way a private window does. */
const hostileStorage = () => ({
  getItem() { throw new Error("denied"); },
  setItem() { throw new Error("denied"); },
  removeItem() { throw new Error("denied"); },
});

const periodAt = (index) => buildPersonalHistoryReport(evalFixtureExport(EVAL_BENCHMARK_PERIODS[index]));

/** A slot holding the summary a period would have carried forward. */
const slotFor = (report, overrides = {}) => {
  const summary = { ...carryForwardSummary(report, { reading: 1 }), ...overrides };
  assert.equal(validateCarriedSummary(summary).valid, true,
    "a test slot must be a summary this build would read back out of a browser");
  return readCarriedSummary(fakeStorage(JSON.stringify(summary)));
};

const trajectoryFor = (report, slot) =>
  buildTrajectory(report, compareWithCarriedSummary(report, slot), { kind: PERSONAL_RUN_KIND.file });

/* ----------------------------- the six findings ---------------------------- */

test("every finding publishes what it claims and what it refuses to claim", () => {
  const findings = Object.values(TRAJECTORY_STATE);
  assert.equal(findings.length, 6);
  for (const state of findings) {
    const finding = TRAJECTORY_FINDING[state];
    assert.ok(finding, `${state} has no published finding`);
    for (const field of ["headline", "claims", "refuses"]) {
      assert.equal(typeof finding[field], "string");
      assert.ok(finding[field].length > 30, `${state}.${field} is not a sentence`);
    }
  }
  // Only the two directional findings may use the words that assert a movement.
  for (const state of findings) {
    if (state === TRAJECTORY_STATE.improved || state === TRAJECTORY_STATE.worsened) continue;
    const copy = `${TRAJECTORY_FINDING[state].headline} ${TRAJECTORY_FINDING[state].claims}`;
    assert.doesNotMatch(copy, /\bimproved\b|\bbetter\b|\bworse\b/i,
      `${state} claims a direction it did not measure`);
  }
});

test("a reading that named a move and a reading before it is a direction", () => {
  // March 7.8 → April 6.0 on the same move: a fall of 1.8, which is 23% of where
  // it started, clearing both floors comfortably.
  const trajectory = trajectoryFor(periodAt(1), slotFor(periodAt(0)));

  assert.equal(trajectory.state, TRAJECTORY_STATE.improved);
  assert.equal(trajectory.carryState, CARRY_FORWARD_STATE.compatible);
  assert.equal(trajectory.directional, true);
  assert.equal(trajectory.movement.material, true);
  assert.equal(trajectory.movement.points, -1.8);
  assert.equal(trajectory.readings.previous.pointsPerScoredPrompt, 7.8);
  assert.equal(trajectory.readings.current.pointsPerScoredPrompt, 6);
  // The rule is only drawn where it explains a refusal to report a direction.
  assert.equal(trajectory.movement.rule, null);
});

test("the same habit costing more is reported as costing more, never softened", () => {
  const trajectory = trajectoryFor(periodAt(0), slotFor(periodAt(2)));
  assert.equal(trajectory.state, TRAJECTORY_STATE.worsened);
  assert.equal(trajectory.movement.points, 3.6);
  assert.equal(trajectory.movement.material, true);
});

/* ---------------------------- the materiality rule --------------------------- */

test("both materiality floors bind, and the wider of the two decides", () => {
  // The absolute floor decides where the reader started small; the relative
  // floor decides where they started large. Each row states which.
  const cases = [
    { points: -0.04, previous: 0.2, material: false, why: "under the absolute floor" },
    { points: -0.05, previous: 0.2, material: true, why: "exactly on the absolute floor" },
    { points: -0.6, previous: 8, material: false, why: "over the absolute floor, under 10% of 8" },
    { points: -0.8, previous: 8, material: true, why: "exactly 10% of 8" },
    { points: 0, previous: 8, material: false, why: "no difference at all" },
  ];
  for (const row of cases) {
    const result = movementMateriality(row.points, row.previous);
    assert.equal(result.material, row.material, `${row.points} against ${row.previous}: ${row.why}`);
  }
  assert.equal(TRAJECTORY_MATERIALITY.operator, ">=");
  assert.match(TRAJECTORY_MATERIALITY.assumption, /product assumption/i);
  assert.match(TRAJECTORY_MATERIALITY.assumption, /not an empirically estimated/i,
    "the relative weight must not masquerade as a measured noise boundary");
  // A movement with nothing to take a share of falls back to the absolute floor
  // rather than dividing by zero and reporting a direction on an infinity.
  assert.equal(movementMateriality(-0.04, 0).material, false);
  assert.equal(movementMateriality(-0.06, 0).material, true);
  assert.equal(movementMateriality(-0.06, 0).share, null);
});

test("a difference inside the noise of the reading is no movement, not an improvement", () => {
  // April is read against a stated previous figure of 6.03 points per scored
  // prompt. The difference is 0.03 — under the 0.05 floor and far under 10% of
  // 6.03 — so the honest answer is that the habit has not moved.
  const trajectory = trajectoryFor(periodAt(1), slotFor(periodAt(0), { pointsPerScoredPrompt: 6.03 }));

  assert.equal(trajectory.carryState, CARRY_FORWARD_STATE.compatible,
    "the two readings are comparable; it is the difference that is not reportable");
  assert.equal(trajectory.state, TRAJECTORY_STATE.noMeaningfulMovement);
  assert.equal(trajectory.directional, false);
  assert.equal(trajectory.movement.material, false);
  assert.equal(trajectory.movement.threshold, 0.6);
  // The rule that decided it travels with the finding: the number visibly moved.
  assert.equal(trajectory.movement.rule, TRAJECTORY_MATERIALITY.rule);
  assert.doesNotMatch(TRAJECTORY_FINDING[trajectory.state].headline, /less|improv/i);
});

test("a fall that clears the absolute floor but not the relative one is not a direction", () => {
  // 6.5 → 6.0 is half a point, ten times the absolute floor, and still under a
  // tenth of where it started. The relative floor is the one that binds.
  const trajectory = trajectoryFor(periodAt(1), slotFor(periodAt(0), { pointsPerScoredPrompt: 6.5 }));
  assert.equal(trajectory.movement.points, -0.5);
  assert.equal(trajectory.state, TRAJECTORY_STATE.noMeaningfulMovement);
});

/* -------------------------- the states without a direction ------------------- */

test("a first reading is a finding of its own, and claims no direction", () => {
  const trajectory = trajectoryFor(periodAt(0), readCarriedSummary(fakeStorage()));

  assert.equal(trajectory.state, TRAJECTORY_STATE.firstReading);
  assert.equal(trajectory.carryState, CARRY_FORWARD_STATE.firstReading);
  assert.equal(trajectory.movement, null);
  assert.equal(trajectory.readings.previous, null);
  assert.match(trajectory.reasonRule, /first reading this browser has carried forward/);
});

test("a different leading move is incompatible, and says so rather than subtracting", () => {
  // A reader whose leading move changed has two habits' costs, not one habit's
  // two readings. Built from a real summary with a stated move identifier.
  const trajectory = trajectoryFor(periodAt(1), slotFor(periodAt(0), { moveId: "intent-names-audience" }));

  assert.equal(trajectory.state, TRAJECTORY_STATE.incompatible);
  assert.equal(trajectory.movement, null);
  // Both sides are still drawn: "the thing worth changing first has changed" is
  // the finding, and a reader needs the two ends to see it.
  assert.ok(trajectory.readings.previous);
  assert.ok(trajectory.readings.current);
});

test("a browser that refuses storage is insufficient evidence, not a first reading", () => {
  const trajectory = trajectoryFor(periodAt(0), readCarriedSummary(hostileStorage()));

  assert.equal(trajectory.state, TRAJECTORY_STATE.insufficientEvidence);
  assert.equal(trajectory.carryState, CARRY_FORWARD_STATE.insufficientEvidence);
  assert.match(trajectory.reasonRule, /would not let the page look for a previous summary/);
});

test("a comparison whose weaker end earned no confidence reports no direction", () => {
  // The figures are comparable and the fall is large. The evidence under one end
  // of it is not, so the finding is about the evidence.
  const trajectory = trajectoryFor(periodAt(1), slotFor(periodAt(0), { confidence: "none" }));

  assert.equal(trajectory.carryState, CARRY_FORWARD_STATE.compatible);
  assert.equal(trajectory.state, TRAJECTORY_STATE.insufficientEvidence);
  assert.equal(trajectory.confidence.level, "none");
});

test("a low-confidence direction carries its caveat in the finding, not in a footnote", () => {
  const trajectory = trajectoryFor(periodAt(1), slotFor(periodAt(0)));
  assert.equal(trajectory.confidence.level, "low",
    "the benchmark periods sit on the eligibility floor, so the comparison is held low");
  assert.equal(trajectory.confidence.caveat, TRAJECTORY_CONFIDENCE_CAVEAT);
  assert.match(trajectory.confidence.heldAt, /weaker of the two/);
});

test("the worked example and a refused reading are given no trajectory at all", () => {
  const slot = slotFor(periodAt(0));
  const comparison = compareWithCarriedSummary(periodAt(1), slot);
  assert.equal(buildTrajectory(periodAt(1), comparison, { kind: PERSONAL_RUN_KIND.preview }), null,
    "an invented person was given a before and after");
  assert.equal(buildTrajectory(periodAt(1), null, { kind: PERSONAL_RUN_KIND.file }), null);

  // A history under the floors names no move, so there is nothing to be moving.
  const thin = buildPersonalHistoryReport(buildEvalExport({
    blocks: [{ prompt: "context-and-notes", count: 4 }], days: evalDays("2026-06", 2),
  }));
  assert.notEqual(thin.state, PERSONAL_REPORT_STATE.prioritized);
  assert.equal(buildTrajectory(thin, compareWithCarriedSummary(thin, slot), {}), null);
});

/* -------------------------------- the handoff ------------------------------- */

test("the handoff carries the move, the rubric's own rewrite, and nothing a reader wrote", () => {
  const marker = "ZQXMARKERQZ";
  const report = periodAt(0);
  const handoff = trajectoryHandoff(report);

  assert.equal(handoff.available, true);
  assert.equal(handoff.moveId, report.priority.id);
  assert.equal(handoff.href, TRAJECTORY_HANDOFF.href);
  assert.match(handoff.href, /^\/coach\.html#/, "the handoff must open the shipped coach");
  assert.ok(!handoff.href.includes("?"), "nothing this page read may be put in a URL");

  const brief = handoff.brief;
  assert.ok(brief.includes(report.priority.title), "the brief must name the move");
  assert.ok(brief.includes(report.priority.id), "the brief must name the rubric identifier");
  assert.ok(brief.includes(report.priority.guidance));
  if (report.priority.rewrite) assert.ok(brief.includes(report.priority.rewrite));
  assert.ok(brief.includes(TRAJECTORY_HANDOFF.boundary));

  // A history in which every prompt is a unique marker still produces a brief
  // with the marker nowhere in it: there is no prompt text in a report to leak.
  const marked = buildPersonalHistoryReport(evalFixtureExport(EVAL_BENCHMARK_PERIODS[0])
    .replaceAll("Draft", `Draft ${marker}`));
  assert.ok(!trajectoryBriefText(marked).includes(marker),
    "text from the reader's own export reached the clipboard brief");

  // Defense in depth at the handoff boundary: even an unvalidated caller cannot
  // turn report-shaped prompt text into clipboard text. Recognized identifiers
  // resolve back to the bundled rubric; unknown identifiers are refused.
  const poisoned = {
    ...report,
    priority: {
      ...report.priority,
      title: marker,
      guidance: marker,
      rewrite: marker,
    },
  };
  const poisonedBrief = trajectoryBriefText(poisoned);
  assert.ok(poisonedBrief);
  assert.ok(!poisonedBrief.includes(marker));
  assert.equal(poisonedBrief, brief, "handoff copy must be reproduced from the rubric identifier");
  assert.equal(trajectoryHandoff({
    ...poisoned,
    priority: { ...poisoned.priority, id: `unknown-${marker}` },
  }).available, false, "an unknown move cannot carry attacker-authored fallback copy");
});

test("a reading with no move to hand over offers no control", () => {
  const thin = buildPersonalHistoryReport(buildEvalExport({
    blocks: [{ prompt: "fully-stated", count: 3 }], days: evalDays("2026-06", 2),
  }));
  const handoff = trajectoryHandoff(thin);
  assert.equal(handoff.available, false);
  assert.equal(handoff.moveId, null);
  assert.equal(handoff.brief, "");
  assert.equal(trajectoryBriefText(thin), "");
});

/* --------------------------------- the page -------------------------------- */

/** Read one export through the shipped page and wait for the report to paint. */
async function readOnPage(document, text) {
  const input = document.getElementById("personal-history-file");
  input.files = [{ name: "export.json", size: text.length, text: async () => text }];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
  await waitFor(() => document.querySelector(".ph-report"));
}

test("two readings on the shipped page draw a before, an after, and one finding", async () => {
  const page = await loadPage(PAGE);
  try {
    await importPageModule("/personal-history-page.js");
    const { document } = page;

    await readOnPage(document, evalFixtureExport(EVAL_BENCHMARK_PERIODS[0]));
    const first = document.querySelector(".ph-trajectory");
    assert.equal(first.dataset.trajectory, TRAJECTORY_STATE.firstReading);
    assert.match(textOf(first), /first reading there is anything to carry forward from/);
    assert.match(textOf(first), /no earlier reading in this browser/,
      "the empty side of a first reading must say it is empty");

    await readOnPage(document, evalFixtureExport(EVAL_BENCHMARK_PERIODS[1]));
    const second = document.querySelector(".ph-trajectory");
    assert.equal(second.dataset.trajectory, TRAJECTORY_STATE.improved);
    assert.equal(second.dataset.carry, CARRY_FORWARD_STATE.compatible);
    assert.equal(second.dataset.material, "true");

    // Before and after, each labelled, each carrying the same six figures.
    const sides = second.querySelectorAll(".ph-reading");
    assert.equal(sides.length, 2);
    assert.equal(sides[0].dataset.side, "previous");
    assert.equal(sides[1].dataset.side, "current");
    assert.match(textOf(sides[0]), /Your last reading/);
    assert.match(textOf(sides[0]), /7\.8 points/);
    assert.match(textOf(sides[1]), /This reading/);
    assert.match(textOf(sides[1]), /6 points/);
    for (const side of sides) {
      const list = side.querySelector(".ph-reading-facts");
      assert.equal(list.getAttribute("aria-labelledby"), side.querySelector("h5").id,
        "each reading's figures must be named by the heading above them");
    }

    // The claim, the refusal, and the calibration are all on screen together.
    const text = textOf(second);
    assert.match(text, /costs you less on an average request/);
    assert.match(text, /does not establish that anything you did caused the fall/);
    assert.match(text, /Held at low/);
    assert.match(text, /it is not yet a trend/);
    // The one-person refusal is drawn beside the comparison, not left in a
    // contract nobody opens: the words "percentile" and "peer comparison" appear
    // here exactly once each, in the sentence that refuses them.
    assert.match(text, /not a benchmark, a percentile, a peer cohort, a team score/);
  } finally {
    page.restore();
  }
});

test("how the comparison was drawn is disclosed progressively, from the keyboard", async () => {
  const page = await loadPage(PAGE);
  try {
    await importPageModule("/personal-history-page.js");
    const { document } = page;
    await readOnPage(document, evalFixtureExport(EVAL_BENCHMARK_PERIODS[0]));
    await readOnPage(document, evalFixtureExport(EVAL_BENCHMARK_PERIODS[1]));

    const toggle = document.getElementById("ph-toggle-trajectory");
    assert.equal(toggle.tagName, "BUTTON");
    assert.equal(toggle.getAttribute("type"), "button");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    const panel = document.getElementById(toggle.getAttribute("aria-controls"));
    assert.equal(panel.hidden, true, "supporting detail is shut by default");

    let focused = null;
    for (let step = 0; step < tabSequence(document).length; step += 1) {
      focused = pressTab(document);
      if (focused === toggle) break;
    }
    assert.equal(focused, toggle, "the disclosure is not reachable by Tab");
    pressEnter(document);
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(panel.hidden, false);

    const evidence = textOf(panel);
    assert.match(evidence, /points per scored prompt/, "the compared figure is defined");
    assert.match(evidence, /at least 10%/, "the materiality rule travels with the finding");
    assert.match(evidence, /conservative product assumption/,
      "the relative weight's unvalidated assumption must travel with the score");
    assert.match(evidence, /against a threshold of 0\.78 points/,
      "a reader is owed the threshold this comparison was actually measured against");
    assert.match(evidence, /The export behind it was never stored/);

    toggle.click();
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(panel.hidden, true);
  } finally {
    page.restore();
  }
});

test("the handoff is one press and one link, and the fallback appears when a copy cannot", async () => {
  const page = await loadPage(PAGE);
  try {
    await importPageModule("/personal-history-page.js");
    const { document } = page;
    document.getElementById("personal-history-preview").click();
    await waitFor(() => document.querySelector(".ph-report"));

    const block = document.querySelector(".ph-handoff");
    assert.ok(block, "a named move must offer somewhere to take it");
    const link = block.querySelector(".ph-handoff-link");
    assert.equal(link.getAttribute("href"), TRAJECTORY_HANDOFF.href);
    assert.equal(textOf(link), TRAJECTORY_HANDOFF.linkLabel);

    const button = document.getElementById("ph-handoff-copy");
    assert.equal(button.getAttribute("type"), "button");
    assert.match(button.getAttribute("aria-describedby"), /ph-handoff-status/,
      "the outcome of the press must be part of the control's description");
    const fallback = document.getElementById("ph-handoff-fallback");
    assert.equal(fallback.hidden, true, "an unneeded box must not hold a tab stop");
    assert.ok(!tabSequence(document).includes(document.getElementById("ph-handoff-text")));

    // This harness offers no clipboard and no execCommand, which is the same
    // position a reader on an insecure origin is in: the honest floor is the
    // text, selected, with a keystroke to press.
    button.click();
    await waitFor(() => document.getElementById("ph-handoff-status").textContent !== "Copying…");
    const status = document.getElementById("ph-handoff-status");
    assert.equal(status.dataset.outcome, "manual");
    assert.equal(button.disabled, false, "the control must come back after a failed copy");
    assert.equal(fallback.hidden, false);
    assert.match(document.getElementById("ph-handoff-text").value, /the move my own AI history named/);
  } finally {
    page.restore();
  }
});

test("the home page names the personal history path without displacing the coach", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  const entry = html.slice(html.indexOf('class="coach-entry"'), html.indexOf("</section>", html.indexOf('class="coach-entry"')));

  assert.ok(entry.includes('href="/personal-history.html"'), "the home page never names the history path");
  // The coach keeps the primary control, and the companion path reads after it.
  assert.ok(entry.indexOf('class="secondary-button" href="/coach.html"') < entry.indexOf('href="/personal-history.html"'),
    "the companion link must not displace the coach's own call to action");
});
