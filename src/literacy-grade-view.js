// The reading surface for the imported prompt-literacy grade.
//
// Rowan's `analyzeQueryLiteracy` already produces every number this panel shows,
// and Noor's `gradeEligibilityFromCoverage` already decides whether the letter may
// be shown at all. Nothing is scored, thresholded, or re-derived here: the module
// reads `literacy.eligibility`, `literacy.benchmark`, and `literacy.departments`
// and lays them out. The only arithmetic below is a bar width in percent.
//
// Four facts, in one deliberate order, for a leader who skims:
//
//   1. **the grade** — primary, and never separable from its qualifier. A
//      provisional or withheld letter carries the word beside the glyph inside the
//      same visual group, so a screenshot cropped to the number still says so.
//   2. **how much spend it covers** — the percentage *and* both dollar figures,
//      always on screen, never behind a hover.
//   3. **how confident it is** — Noor's tier label, with a shape and the rule
//      sentence that produced it.
//   4. **the one department to act on** — the terminal element of the block,
//      read straight off `eligibility.nextAction`.
//
// Three rules this surface holds, in the spirit of `model-overspend-finding-view`:
//
//   * **Nothing is signalled by tint alone.** Every band ships a letter and a
//     number; every confidence tier ships a shape and a word; every cohort row
//     ships a direction shape, the signed delta, and the median it is measured
//     against. The tint is the fourth channel, never the first.
//   * **A withheld letter is a sentence, never a blank or a zero.** Suppression
//     is a drawn state with its own copy, not an empty box.
//   * **Sample size is not an accelerator.** The counts that decide whether a
//     grade is worth reading sit in the summary, at the same weight as the
//     coverage percentage.
//
// It takes the document rather than reading a global, like `import-mapping-view`
// and `model-overspend-finding-view`, so a test drives the shipped markup of
// evolution.html. Every node is built with createElement and textContent: a
// department name out of a reader's export is a string in a cell and nothing else.

import { formatPercent, formatUsd } from "./evolution.js";
import { letterGradeForScore } from "./prompt-literacy-scoring.js";
import { NOT_GRADEABLE_COPY } from "./query-literacy.js";

const SECTION_ID = "literacy-grade";
const HEADING_ID = "literacy-grade-question";
const SUMMARY_ID = "literacy-grade-summary";
const ACTION_ID = "literacy-grade-action";
const COHORT_ID = "literacy-cohort";
const COHORT_BODY_ID = "literacy-cohort-body";
const TOGGLE_ID = "literacy-ungraded-toggle";
const PANEL_ID = "literacy-ungraded-panel";
const LIVE_ID = "literacy-grade-live";

/**
 * One shape per confidence tier, so the tier survives a greyscale print and a
 * reader who cannot separate the band hues. The words are Noor's own labels;
 * only the glyph is added here.
 */
const TIER_SHAPE = Object.freeze({
  high: "●",          // ●
  moderate: "◐",      // ◐
  provisional: "◔",   // ◔
  insufficient: "○",  // ○
  no_baseline: "◇",   // ◇
});

/** Cohort position: shape, and the word the shape stands for. */
const POSITION = Object.freeze({
  above: { shape: "▲", word: "above" },
  at: { shape: "→", word: "level with" },
  below: { shape: "▼", word: "below" },
});

/**
 * The visual band, keyed off the rubric's letter rather than off the score, so
 * the band and the letter can never disagree and no cutoff is restated here.
 * A and B are working as intended, C and D are the coaching range, F is failing.
 */
const LETTER_BAND = Object.freeze({ A: "good", B: "good", C: "watch", D: "watch", F: "poor" });

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A label kept off screen but in the accessibility tree. */
function screenReaderText(doc, text) {
  return element(doc, "span", "visually-hidden", text);
}

function setText(doc, id, text) {
  const node = byId(doc, id);
  if (node) node.textContent = text;
}

function departmentName(department) {
  const name = typeof department?.name === "string" ? department.name.trim() : "";
  return name || department?.departmentId || "Unnamed department";
}

const plural = (count, singular, many = `${singular}s`) =>
  `${count} ${count === 1 ? singular : many}`;
const queries = (count) => plural(count, "sampled query", "sampled queries");

/**
 * What the summary block says, decided once and reused by the DOM and by the
 * live-region sentence so the two can never drift.
 *
 * The letter's source is stated, never guessed. With a cohort, it is the median
 * of the graded departments Rowan already computed; with exactly one graded
 * department it is that department's own published score, named as such; with
 * two graded departments and no cohort there is no organization-level letter to
 * read, and the panel says that rather than inventing one.
 */
export function literacyGradeReading(literacy) {
  const eligibility = literacy?.eligibility ?? null;
  const departments = Array.isArray(literacy?.departments) ? literacy.departments : [];
  const graded = departments.filter((department) => department.gradeable);
  const cohort = literacy?.benchmark?.cohort ?? null;
  const source = cohort
    ? { score: cohort.medianScore, basis: `median of ${plural(cohort.size, "graded department")}` }
    : graded.length === 1
      ? { score: graded[0].score, basis: `the only graded department · ${departmentName(graded[0])}` }
      : null;

  // Two independent gates, both of which must pass, exactly as the hero card
  // gates its own letter. Noor owns the first; the second is simply whether a
  // published score exists to print.
  const withheld = !eligibility?.showGrade;
  const state = withheld ? "withheld" : !source ? "ungraded"
    : eligibility.provisional ? "provisional" : "graded";
  const letter = state === "withheld" || state === "ungraded"
    ? "—" : letterGradeForScore(source.score);
  const qualifier = state === "provisional" ? "Provisional grade"
    : state === "withheld" ? "Grade withheld"
      : state === "ungraded" ? "No cohort grade" : "Confident grade";

  const sample = literacy?.sample ?? { total: 0, classified: 0 };
  return Object.freeze({
    state,
    letter,
    qualifier,
    band: LETTER_BAND[letter] ?? "review",
    gradeText: source && !withheld
      ? `${source.score} / 100 · letter ${letter} · ${source.basis}`
      : withheld
        ? `No letter is shown. ${eligibility?.rule ?? "Coverage is too low to publish a grade."}`
        : `No letter is shown. A cohort median needs three graded departments and this import graded ${graded.length}.`,
    coverageText: !eligibility || eligibility.coverage === null
      ? `Not measurable · ${eligibility?.label ?? "no spend baseline"}`
      : `${formatPercent(eligibility.coverage, { digits: 1 })} of imported spend scored`
        + ` · ${formatUsd(eligibility.coveredUsd)} of ${formatUsd(eligibility.totalUsd)}`,
    confidenceShape: TIER_SHAPE[eligibility?.tier] ?? TIER_SHAPE.no_baseline,
    confidenceText: eligibility?.label ?? "Confidence unavailable",
    confidenceRule: eligibility?.rule ?? "",
    sampleText: `${sample.classified} of ${queries(sample.total)} classified`
      + ` · ${graded.length} of ${plural(departments.length, "department")} graded`,
    actionText: eligibility?.nextAction?.text ?? "No next action is available.",
    actionAvailable: Boolean(eligibility?.nextAction?.available),
  });
}

/** The chip the department rows and the summary share: letter and number, together. */
function gradeChip(doc, score) {
  const letter = letterGradeForScore(score);
  const chip = element(doc, "span", "grade-chip");
  chip.dataset.band = LETTER_BAND[letter] ?? "review";
  chip.append(
    screenReaderText(doc, "grade "),
    doc.createTextNode(letter),
    screenReaderText(doc, " score "),
    element(doc, "span", undefined, String(score)),
  );
  return chip;
}

function summaryBlock(doc, reading) {
  const block = element(doc, "div", "literacy-grade-block");
  const letter = element(doc, "p", "literacy-grade-letter");
  letter.dataset.band = reading.band;
  letter.append(
    screenReaderText(doc, "Grade "),
    doc.createTextNode(reading.letter),
    // The qualifier shares the letter's element, so no crop, no screenshot, and
    // no reflow can separate a provisional grade from the word "provisional".
    element(doc, "span", "literacy-grade-qualifier", reading.qualifier),
  );

  const facts = element(doc, "dl", "literacy-grade-facts");
  const fact = (term, value) => {
    const group = element(doc, "div");
    group.append(element(doc, "dt", undefined, term), element(doc, "dd", undefined, value));
    return group;
  };
  const confidence = element(doc, "div");
  const confidenceValue = element(doc, "dd");
  const shape = element(doc, "span", "literacy-grade-shape", reading.confidenceShape);
  shape.setAttribute("aria-hidden", "true");
  confidenceValue.append(shape, doc.createTextNode(` ${reading.confidenceText}`));
  confidence.append(element(doc, "dt", undefined, "Confidence"), confidenceValue);

  facts.append(
    fact("Grade", reading.gradeText),
    fact("Spend covered", reading.coverageText),
    confidence,
    fact("Sample", reading.sampleText),
  );

  block.append(letter, facts);
  const wrapper = element(doc, "div", "literacy-grade-summary-body");
  wrapper.append(block);
  if (reading.confidenceRule) {
    wrapper.append(element(doc, "p", "literacy-grade-rule", reading.confidenceRule));
  }
  return wrapper;
}

function cohortRow(doc, comparison, department, medianScore) {
  const position = POSITION[comparison.position] ?? POSITION.at;
  const item = element(doc, "li", "literacy-cohort-row");
  item.dataset.position = comparison.position;

  const head = element(doc, "div", "literacy-cohort-head");
  head.append(
    element(doc, "p", "literacy-cohort-name", departmentName(department)),
    gradeChip(doc, comparison.score),
  );

  const shape = element(doc, "span", "literacy-cohort-shape", position.shape);
  shape.setAttribute("aria-hidden", "true");
  const delta = element(doc, "p", "literacy-cohort-delta");
  delta.append(shape, doc.createTextNode(
    ` ${comparison.deltaPoints > 0 ? "+" : ""}${comparison.deltaPoints} points`
    + ` ${position.word} the cohort median of ${medianScore}`,
  ));

  // The bar repeats the number beside it; it is decoration with a length, so it
  // is hidden from the accessibility tree rather than read out twice.
  const track = element(doc, "div", "literacy-cohort-bar");
  track.setAttribute("aria-hidden", "true");
  const fill = element(doc, "span");
  fill.dataset.band = LETTER_BAND[letterGradeForScore(comparison.score)] ?? "review";
  fill.style.width = `${Math.max(0, Math.min(100, comparison.score))}%`;
  track.append(fill);

  const coverage = department?.coverage ?? null;
  item.append(head, delta, track, element(doc, "p", "literacy-cohort-coverage",
    coverage
      ? `${coverage.joined} of ${queries(coverage.sampled)} scored`
        + ` · ${formatUsd(department.spend?.joinedUsd ?? 0)} of`
        + ` ${formatUsd(department.spend?.totalUsd ?? 0)} spend`
      : "Coverage detail unavailable for this department."));
  return item;
}

function ungradedRow(doc, department) {
  const item = element(doc, "li", "literacy-ungraded-row");
  item.append(
    element(doc, "p", "literacy-cohort-name", departmentName(department)),
    element(doc, "p", "literacy-ungraded-reason",
      NOT_GRADEABLE_COPY[department.reason] ?? "This department produced no grade."),
    element(doc, "p", "literacy-cohort-coverage",
      `${department.coverage?.joined ?? 0} of `
      + `${queries(department.coverage?.sampled ?? 0)} scored`
      + ` · ${formatUsd(department.spend?.totalUsd ?? 0)} spend with no grade`),
  );
  return item;
}

/**
 * The disclosure. `aria-expanded` lives on the control, the revealed content
 * follows it in DOM order, and the label says what opening it will show — so
 * focus order matches reading order and the button is never a bare chevron.
 */
function bindDisclosure(doc, toggle, panel, count) {
  toggle.hidden = count === 0;
  panel.hidden = true;
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", PANEL_ID);
  const label = (expanded) =>
    `${expanded ? "Hide" : "Show"} ${plural(count, "department")} with no grade`;
  toggle.textContent = label(false);
  if (toggle.dataset.bound === "true") return;
  toggle.dataset.bound = "true";
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    toggle.textContent = label(!expanded);
    const body = byId(doc, PANEL_ID);
    if (body) body.hidden = expanded;
  });
}

function renderCohort(doc, literacy) {
  const section = byId(doc, COHORT_ID);
  const body = byId(doc, COHORT_BODY_ID);
  const toggle = byId(doc, TOGGLE_ID);
  const panel = byId(doc, PANEL_ID);
  if (!section || !body || !toggle || !panel) return;

  const departments = Array.isArray(literacy?.departments) ? literacy.departments : [];
  const byDepartment = new Map(departments.map((department) => [department.departmentId, department]));
  const benchmark = literacy?.benchmark ?? {};
  section.dataset.state = benchmark.state ?? "unavailable";
  setText(doc, "literacy-cohort-method", benchmark.message ?? "Cohort comparison unavailable.");

  body.replaceChildren();
  if (benchmark.state === "available") {
    const list = element(doc, "ol", "literacy-cohort-list");
    list.setAttribute("aria-label", "Graded departments, furthest above the cohort median first");
    for (const comparison of benchmark.comparisons) {
      list.append(cohortRow(doc, comparison, byDepartment.get(comparison.departmentId), benchmark.cohort.medianScore));
    }
    body.append(list);
  }

  const ungraded = departments.filter((department) => !department.gradeable);
  bindDisclosure(doc, toggle, panel, ungraded.length);
  const list = element(doc, "ol", "literacy-ungraded-list");
  list.setAttribute("aria-label", "Departments with no grade, and why");
  for (const department of ungraded) list.append(ungradedRow(doc, department));
  panel.replaceChildren(list);
}

/**
 * Paint the panel.
 *
 * @param {object} doc the document holding evolution.html's markup.
 * @param {{status: "loading"|"empty"|"error"|"ready", literacy?: object,
 *   message?: string, example?: boolean}} state
 */
export function renderLiteracyGrade(doc, state = {}) {
  const section = byId(doc, SECTION_ID);
  if (!section) return null;
  const status = state.status ?? "empty";
  const summary = byId(doc, SUMMARY_ID);
  const cohort = byId(doc, COHORT_ID);
  const action = byId(doc, ACTION_ID);
  section.hidden = false;
  section.dataset.state = status;
  section.setAttribute("aria-busy", String(status === "loading"));

  if (status !== "ready") {
    section.dataset.gradeState = "none";
    section.dataset.band = "review";
    const copy = status === "loading"
      ? "Scoring the imported query sample…"
      : status === "error"
        ? state.message
          || "The imported query sample could not be scored, so no grade is shown."
        : state.example
          ? "Example data is on screen. No query sample has been imported, so no grade is computed from your own prompts."
          : "No query sample accompanied this import, so no prompt-literacy grade is computed.";
    setText(doc, HEADING_ID, status === "error"
      ? "This import could not be graded." : "How well is this organization prompting?");
    summary?.replaceChildren(element(doc, "p", "literacy-grade-placeholder", copy));
    if (cohort) cohort.hidden = true;
    setText(doc, ACTION_ID, status === "error"
      ? "Re-select the export, or import billing data with a query sample attached."
      : "Import a query sample alongside your billing export to grade your own departments.");
    if (action) action.dataset.available = "false";
    setText(doc, LIVE_ID, `Prompt-literacy grade: ${copy}`);
    return null;
  }

  const reading = literacyGradeReading(state.literacy);
  section.dataset.gradeState = reading.state;
  section.dataset.band = reading.band;
  setText(doc, HEADING_ID, "How well is this organization prompting?");
  summary?.replaceChildren(summaryBlock(doc, reading));
  if (cohort) cohort.hidden = false;
  renderCohort(doc, state.literacy);
  setText(doc, ACTION_ID, reading.actionText);
  if (action) action.dataset.available = String(reading.actionAvailable);

  // The announcement carries the three facts that changed, not the word
  // "updated": a leader who cannot see the swap still learns what replaced what.
  setText(doc, LIVE_ID, `${state.example ? "Example" : "Imported"} prompt-literacy grade ready. `
    + `Grade ${reading.letter}, ${reading.qualifier.toLowerCase()}. `
    + `${reading.coverageText}. ${reading.confidenceText}. Next action: ${reading.actionText}`);
  return reading;
}

/** Return the panel to its authored, hidden state. */
export function clearLiteracyGrade(doc) {
  const section = byId(doc, SECTION_ID);
  if (!section) return;
  section.hidden = true;
  section.dataset.state = "empty";
  section.dataset.gradeState = "none";
  section.dataset.band = "review";
  byId(doc, SUMMARY_ID)?.replaceChildren();
  byId(doc, COHORT_BODY_ID)?.replaceChildren();
  byId(doc, PANEL_ID)?.replaceChildren();
  setText(doc, LIVE_ID, "");
}
