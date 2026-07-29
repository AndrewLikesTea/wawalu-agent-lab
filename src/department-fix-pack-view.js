// The department fix pack, made legible enough to hand to someone else.
//
// The drill-down already names one prioritized intervention in `#action-result`.
// What it never showed is the *pattern* underneath it: the category the money
// sits in, what share of the scored sample it is, what the rivals were worth,
// and the arithmetic that turned those into a monthly figure. A director asked
// to approve a number they cannot check either approves it on trust or does not
// approve it at all, and neither is the decision this surface exists to support.
//
// So this module paints one more block into the same card, in one declared
// order, and prints in that order too:
//
//   1. the prioritized action        (`#action-title`, already there)
//   2. its monthly value             (`#action-impact`, already there)
//   3. its confidence                (`#action-confidence`, already there)
//   4. its provenance                (`#action-provenance`, already there)
//   5. the pattern-level evidence    (this module)
//
// `FIX_PACK_READING_ORDER` is that list as data, so the print test asserts the
// same sequence the painter relies on rather than a transcription of it.
//
// Three rules it holds, all of them the page's own:
//
//   - **The finding is legible before anything is expanded.** The summary line
//     above the disclosure names the pattern and its share. The disclosure holds
//     the audit trail, not the answer.
//   - **Nothing is carried by tint.** Every state has a word; the chips are
//     outlines, because a category, a basis and a source are static
//     classifications — Claude Design · Foundations, chip inventory ("filled
//     wash = dynamic signal, outline = static classification").
//   - **The panel is painted in every state, open or closed.** Content that only
//     exists once a reader presses a control cannot be printed by a reader who
//     did not. On paper the control disappears and its content stays.
//
// NO PROMPT TEXT REACHES THIS FILE. Its inputs are the scorer's frozen result
// (built from an allowlist of numbers and enum keys) and the reviewed action
// plan the bundled fixture already publishes in the same twelve slots.

import { formatUsd } from "./evolution.js";
import { INTERVENTION_OUTCOME, INTERVENTION_REDACTION_STATEMENT } from "./department-intervention-scoring.js";

const SECTION_ID = "action-evidence";
const SUMMARY_ID = "action-evidence-summary";
const TOGGLE_ID = "action-evidence-toggle";
const PANEL_ID = "action-evidence-panel";

/**
 * The handout's spine. Five slots, in the order a reader — on screen, through a
 * screen reader, or on paper — has to meet them for the recommendation to be
 * checkable before it is shared.
 */
export const FIX_PACK_READING_ORDER = Object.freeze([
  "action-title", "action-impact", "action-confidence", "action-provenance", "action-evidence",
]);

/** The shape channel beside each status word. Never the only channel. */
export const ACTION_STATUS_SHAPE = Object.freeze({
  completed: "●",
  in_progress: "◐",
  planned: "◆",
  unavailable: "◇",
});

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const usd = (value) => (Number.isFinite(value) ? formatUsd(value) : "Unavailable");

const percent = (share) => (Number.isFinite(share)
  ? `${(Math.max(0, Math.min(1, share)) * 100).toFixed(1)}%` : "share unmeasured");

const count = (value) => (Number.isFinite(value) ? Math.round(value).toLocaleString("en-US") : "0");

/** A row of the evidence list: a label, a value, and what qualifies the value. */
const row = (label, value, note) => Object.freeze({ label, value: String(value), note: note ?? null });

function model({ state, summary, rows, chips, arithmetic, assumptions, redaction }) {
  return Object.freeze({
    state,
    summary,
    rows: Object.freeze(rows.map((entry) => Object.freeze(entry))),
    chips: Object.freeze(chips ?? []),
    arithmetic: arithmetic ?? null,
    assumptions: Object.freeze(assumptions ?? []),
    redaction: redaction ?? INTERVENTION_REDACTION_STATEMENT,
  });
}

// --- the computed path -------------------------------------------------------

/**
 * The candidate rows, ranked, including the ones that lost.
 *
 * A recommendation whose rivals are hidden is a claim; a recommendation beside
 * the two figures it beat is an argument. An undetermined candidate is printed
 * as a ceiling with the signal it is missing named, never as a zero — a zero in
 * a ranked list reads as "clean" when it means "we could not look".
 */
function candidateRows(candidates) {
  return [...candidates]
    .sort((first, second) => (second.blockingUsd ?? 0) - (first.blockingUsd ?? 0))
    .map((candidate, index) => row(
      `Candidate ${index + 1} · ${candidate.label}`,
      candidate.determined
        ? `${usd(candidate.valueUsd)} a month`
        : `at most ${usd(candidate.maxValueUsd)} a month · not measured`,
      `${candidate.categoryLabel} · ${percent(candidate.categoryShare)} of scored prompts · `
      + `${candidate.patternLabel}`,
    ));
}

/**
 * Pattern evidence for a computed recommendation.
 *
 * Every figure is read off the scorer's frozen result. Nothing is recomputed
 * here, so a reader who disputes a number is disputing
 * `department-intervention-scoring.js` and the input digest below says which
 * input produced it.
 */
export function computedFixPackEvidence(result) {
  const provenance = result?.provenance ?? {};
  const recommendation = result?.recommendation ?? null;
  const sampled = row("Scored sample", `${count(provenance.sampledQueries)} prompts`,
    `${provenance.samplingStatus ?? "sampling status unavailable"} · `
    + `${count(provenance.periodDays)}-day period · basis: ${provenance.basis ?? "unstated"}`);
  const digest = row("Input digest", provenance.inputDigest ?? "unavailable",
    `${provenance.scorerVersion ?? "scorer version unavailable"} · `
    + `${provenance.rubricVersion ?? "rubric version unavailable"}`);

  if (!recommendation) {
    const reason = result?.reason;
    return model({
      state: result?.candidates?.length ? "ready" : "empty",
      summary: reason?.text ?? "No intervention is prioritized for this department, and no "
        + "pattern is claimed for one.",
      chips: [outcomeChip(result?.outcome), "no dollar value claimed"],
      rows: [
        row("Why there is no action", reason?.code ?? "no_recommendation", reason?.text ?? null),
        ...candidateRows(result?.candidates ?? []),
        row("Monthly spend read", usd(provenance.monthlySpendUsd),
          "The spend the candidates above were apportioned from."),
        sampled,
        digest,
      ],
    });
  }

  const rationale = recommendation.rationale ?? {};
  return model({
    state: "ready",
    summary: rationale.text ?? "A pattern was found but not described.",
    chips: [
      outcomeChip(result.outcome),
      `${recommendation.kind} intervention`,
      rationale.categoryLabel ?? "category unavailable",
      `confidence ${recommendation.confidence?.level ?? "unstated"}`,
    ],
    rows: [
      row("Pattern", rationale.patternLabel ?? "unavailable",
        `${percent(rationale.shareOfScoredPrompts)} of this department's scored prompts · `
        + `${rationale.categoryLabel ?? "category unavailable"}`),
      row("Expected monthly value",
        `${usd(recommendation.estimatedMonthlyValueUsd)} per 30-day month`,
        `Estimated recoverable value from ${usd(provenance.monthlySpendUsd)} of spend normalized `
          + "to a 30-day month."),
      // Every factor, not only the one that capped it: "what would make this
      // high" is answerable only beside the two that were already high.
      ...(recommendation.confidence?.factors ?? []).map((factor) => row(
        `Confidence factor · ${factor.key}`, factor.level, factor.detail)),
      ...candidateRows(result.candidates ?? []),
      sampled,
      digest,
    ],
    arithmetic: rationale.arithmetic ?? null,
    assumptions: rationale.assumptions ?? [],
  });
}

/** The outcome as a word, so the state never rests on where the block sits. */
function outcomeChip(outcome) {
  return {
    [INTERVENTION_OUTCOME.recommended]: "computed · not yet reviewed",
    [INTERVENTION_OUTCOME.ambiguous]: "no single action prioritized",
    [INTERVENTION_OUTCOME.insufficientEvidence]: "evidence insufficient",
    [INTERVENTION_OUTCOME.hold]: "hold · nothing warranted",
  }[outcome] ?? "outcome unstated";
}

// --- the reviewed path -------------------------------------------------------

/**
 * Pattern evidence for a reviewed intervention from the bundled fixture.
 *
 * A reviewed plan carries no scorer candidates, and inventing some for it would
 * put a rule's opinion inside a human's result. What it does carry is an
 * arithmetic a reader can check by subtraction — baseline, target, estimate,
 * and whether anything was simulated — so that is what is shown, labelled as a
 * reviewed result rather than a computed one.
 */
export function reviewedFixPackEvidence(action, departmentName) {
  const realized = action.realizedSavingsUsd;
  return model({
    state: "ready",
    summary: `${departmentName ?? "This department"} carries a reviewed intervention. `
      + "Its evidence is the reviewed baseline, target and estimate below, not a computed pattern.",
    chips: ["reviewed intervention", action.statusLabel ?? action.status ?? "status unstated",
      "no computed candidates"],
    rows: [
      row("Baseline", usd(action.baselineUsd),
        "Spend before the intervention, on the reviewed plan's monthly basis."),
      row("Target", usd(action.targetUsd),
        "Spend after the intervention, on the same monthly basis."),
      row("Expected monthly value", `${usd(action.estimatedSavingsUsd)} per 30-day month`,
        "Baseline minus target, normalized to the handoff's 30-day month."),
      row("Simulated realized", realized === null ? "Not simulated" : usd(realized),
        realized === null
          ? "Nothing has been simulated for this plan yet, so no realized figure is claimed."
          : "What the simulation returned against the estimate above."),
      row("Accountable role", action.accountableRole ?? "Unassigned",
        "Who can actually pull this lever."),
      row("Provenance", action.provenance ?? "Bundled static fixture",
        "The record this reviewed plan was read from."),
    ],
    arithmetic: `${usd(action.baselineUsd)} baseline − ${usd(action.targetUsd)} target = `
      + `${usd(action.estimatedSavingsUsd)} expected value per 30-day month.`,
    assumptions: action.diagnosis ? [action.diagnosis] : [],
  });
}

// --- the empty path ----------------------------------------------------------

/** No department, no bundle, or nothing to read: still a reading, never a blank. */
export function unavailableFixPackEvidence(reason) {
  return model({
    state: "unavailable",
    summary: reason ?? "No department is selected, so there is no pattern to show.",
    chips: ["no evidence read"],
    rows: [row("Evidence", "Unavailable", reason ?? null)],
  });
}

// --- painting ----------------------------------------------------------------

/**
 * Paint the evidence block. The panel content is written in every state,
 * whether the disclosure is open or shut, because print shows it either way.
 *
 * @returns the model that was painted.
 */
export function renderFixPackEvidence(doc, evidence) {
  const section = byId(doc, SECTION_ID);
  const panel = byId(doc, PANEL_ID);
  const toggle = byId(doc, TOGGLE_ID);
  if (!section || !panel || !toggle) return null;

  section.dataset.state = evidence.state;
  const summary = byId(doc, SUMMARY_ID);
  if (summary) summary.textContent = evidence.summary;

  section.dataset.itemCount = String(evidence.rows.length);
  setToggleLabel(toggle, toggle.getAttribute("aria-expanded") === "true", evidence.rows.length);
  panel.replaceChildren(...panelBlocks(doc, evidence));
  return evidence;
}

/**
 * The label says what will happen and to what, and carries the count so a
 * reader knows the size of what they are opening before they open it.
 */
function setToggleLabel(toggle, expanded, items) {
  toggle.textContent = `${expanded ? "Hide" : "Show"} pattern evidence `
    + `(${count(items)} ${items === 1 ? "item" : "items"})`;
}

function panelBlocks(doc, evidence) {
  const blocks = [];
  if (evidence.chips.length) {
    const chips = element(doc, "p", "action-evidence-chips");
    for (const text of evidence.chips) chips.append(element(doc, "span", "action-evidence-chip", text));
    blocks.push(chips);
  }

  const list = element(doc, "dl", "action-evidence-rows");
  for (const entry of evidence.rows) {
    list.append(element(doc, "dt", undefined, entry.label));
    const value = element(doc, "dd", "action-evidence-value");
    value.append(element(doc, "span", "action-evidence-figure", entry.value));
    if (entry.note) value.append(element(doc, "span", "action-evidence-note", entry.note));
    list.append(value);
  }
  blocks.push(list);

  if (evidence.arithmetic) {
    const arithmetic = element(doc, "p", "action-evidence-arithmetic");
    arithmetic.append(element(doc, "strong", undefined, "Arithmetic: "),
      element(doc, "span", undefined, evidence.arithmetic));
    blocks.push(arithmetic);
  }
  if (evidence.assumptions.length) {
    const assumptions = element(doc, "ul", "action-evidence-assumptions");
    for (const text of evidence.assumptions) {
      assumptions.append(element(doc, "li", undefined, text));
    }
    blocks.push(element(doc, "p", "eyebrow", "Assumptions"), assumptions);
  }

  // The promise, in every state and never behind a second control.
  const privacy = element(doc, "p", "action-evidence-redaction");
  const shape = element(doc, "span", "action-evidence-shape", "▨");
  shape.setAttribute("aria-hidden", "true");
  privacy.append(shape, element(doc, "strong", undefined, "Prompt text withheld "),
    element(doc, "span", undefined, evidence.redaction));
  blocks.push(privacy);
  return blocks;
}

/**
 * Wire the disclosure once.
 *
 * A real button: it says what it controls, owns the region by id, reports its
 * own state, starts closed, and is never removed or disabled — a control that
 * vanishes takes a keyboard reader's place in the tab order with it. Focus is
 * left exactly where the reader put it, because nothing around the button is
 * rebuilt when it is pressed.
 */
export function bindFixPackDisclosure(doc) {
  const section = byId(doc, SECTION_ID);
  const toggle = byId(doc, TOGGLE_ID);
  const panel = byId(doc, PANEL_ID);
  if (!section || !toggle || !panel || section.dataset.bound === "true") return null;
  section.dataset.bound = "true";
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    panel.hidden = !expanded;
    section.dataset.expanded = expanded ? "true" : "false";
    setToggleLabel(toggle, expanded, Number(section.dataset.itemCount) || 0);
  });
  return toggle;
}
