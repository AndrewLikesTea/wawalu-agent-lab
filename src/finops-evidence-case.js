// The case for the recoverable figure, in the order a skeptic reads it (#1524).
//
// WHAT THIS FIXES. The evidence destination was thirteen regions that each
// answered a real question and none that answered the one a finance director
// arrives with: "I have to defend this number in a meeting on Thursday — show me
// the arithmetic." The score card, the classifier agreement, the graded sample
// and the spend-and-recovery working are all true, and a reader had to assemble
// the chain out of them in their head, in an order the page never stated. So the
// destination now opens with the chain itself, in four sections and one heading
// order that is the reading order:
//
//   1. the claim        the canonical figure and the sentence it supports, once.
//   2. the arithmetic   every operand, its operation and the running result, in
//                       evaluation order, as an ordered list.
//   3. the rubric       the versions and the pricing bands, at one known place,
//                       worded so they can be quoted verbatim in the meeting.
//   4. the provenance   per input, where it came from and the assumption that
//                       puts it there.
//
// NO SECOND ARITHMETIC. Every figure below is read off the record
// `getRecoverableSpend` already publishes and the departments it summed, through
// the SAME `departmentRows`/`isScored` pair that record used. A running subtotal
// this file computed over a different row set would be a second opinion about the
// headline, which is the defect the answer contract exists to have ended. The one
// thing computed here is the running total, and it is a partial sum of the same
// addition — asserted against `record.monthly` on the last step rather than
// hoped for.
//
// IT IS ONE FILE, AND ONE FETCH. The model and the paint sit together because
// this module is only ever reached through an `import()` on the open that brings
// the reader to the evidence destination: splitting it into a contract and a view
// would be two round trips for one region, and the view has no other caller.
// Nothing here is imported statically by `evolution-page.js`, so none of it is in
// the first screen's payload — the whole region costs the answer screen nothing.
//
// THE FIGURE IS NEVER FOLDED AWAY. It is the thing being defended. It is painted
// outside every disclosure on this region, and the two collapsible layers hold
// only an input's assumption and the full band table. Nothing in this file
// creates a live region: the destination already has one, and a second speaker
// describing the same open is how a screen-reader user learns to ignore both.
//
// COLOUR CARRIES NOTHING ALONE. Each input's origin is a chip in the page's
// existing `brief-provenance` vocabulary, and the chip carries the word
// ("Declared by the export" / "Derived here") and a silhouette — outline for a
// static classification, which is the Claude Design foundations rule — so the
// distinction survives greyscale, a colour-blind reader and a screen reader.

import {
  CONFIDENCE_RULE, MONTHS_PER_YEAR, RECOVERABLE_SPEND_RULE,
  attestationOperands, departmentRows, getRecoverableSpend, isScored,
} from "./finops-answer-contract.js";
import {
  DEFAULT_REFERENCE_CARD, PREMIUM_LIST_RATE, RATE_CARD_CONTRACT_VERSION, STANDARD_LIST_RATE,
} from "./finops-rate-card-contract.js";
import { PEER_COHORT_RUBRIC_VERSION } from "./peer-cohort-fixtures.js";
import { loadExampleDataset } from "./example-dataset.js";

/** Bump when a section, an operation word, or an origin label changes meaning. */
export const EVIDENCE_CASE_CONTRACT = "finops-evidence-case/1.0.0";

/** The four states this region can truthfully be in, drawn rather than assumed. */
export const EVIDENCE_CASE_STATE = Object.freeze({
  pending: "pending",
  ready: "ready",
  empty: "empty",
  error: "error",
});

/** The ids the shipped markup carries, in one place so a test can name them. */
export const EVIDENCE_CASE_IDS = Object.freeze({
  region: "finops-evidence-case",
  title: "finops-evidence-case-title",
  claimFigure: "finops-evidence-claim-figure",
  claimSentence: "finops-evidence-claim-sentence",
  chain: "finops-evidence-chain",
  rubric: "finops-evidence-rubric",
  provenance: "finops-evidence-provenance",
  error: "finops-evidence-case-error",
});

/** The chip word for each origin. Never a colour on its own. */
export const ORIGIN_LABEL = Object.freeze({
  declared: "Declared by the export",
  derived: "Derived here",
});

/**
 * The human name for each attested operand.
 *
 * The keys are `ATTESTATION_OPERANDS`' own, so an operand added there without a
 * label here is visible as its key rather than silently dropped — a provenance
 * row that disappears is the one failure this section may not have.
 */
export const INPUT_LABEL = Object.freeze({
  period: "Reporting window",
  departmentsInScope: "Departments in scope",
  analyzedSpendUsd: "Analyzed spend the figure is a share of",
  monthlyRecoverableUsd: "Recoverable spend for the month",
  confidenceBand: "Confidence band",
  scoredDepartments: "Departments carrying a completed score",
  annualRecoverableUsd: "Annual projection",
});

/** Whole dollars, grouped, in the answer contract's own display form. */
const usd = (value) => (Number.isFinite(value)
  ? `$${Math.round(value).toLocaleString("en-US")}` : "not stated");

const asText = (value) => {
  if (value === null || value === undefined) return "not stated";
  if (typeof value === "number") return String(value);
  return String(value);
};

/**
 * The arithmetic chain, in evaluation order.
 *
 * One step per scored department — because that is what the addition is, and a
 * chain that says "sum the departments" is prose again — then the exclusion the
 * unscored rows get, then the projection, then the rounding. Each step states
 * its `operand`, its `operation` and the `running` result after it, so a reader
 * can put a finger on the line where a figure they dispute enters.
 *
 * `running` on the last addition is `record.monthlyDisplay` by construction: the
 * rows are the record's rows and the predicate is the record's predicate.
 */
export function recoverableChain(dataset, record = getRecoverableSpend(dataset)) {
  const rows = departmentRows(dataset);
  const scored = rows.filter(isScored);
  const unscored = rows.length - scored.length;
  const steps = [];
  let running = 0;

  scored.forEach((row, index) => {
    running += row.recoverableUsd;
    steps.push(Object.freeze({
      operation: index === 0 ? `start at ${usd(row.recoverableUsd)}` : `add ${usd(row.recoverableUsd)}`,
      operand: `${row.name ?? row.id ?? `department ${index + 1}`} — its identified recoverable`
        + " spend for the most recent complete month.",
      note: null,
      running: usd(running),
    }));
  });

  if (steps.length === 0) {
    return Object.freeze([Object.freeze({
      operation: "nothing to add",
      operand: `${rows.length} ${rows.length === 1 ? "department" : "departments"} published, none`
        + " carrying a completed FinOps score.",
      note: "An unscored department contributes zero and is never extrapolated from, so there is"
        + " nothing to sum and no figure is claimed.",
      running: "no figure is claimed",
    })]);
  }

  if (unscored > 0) {
    steps.push(Object.freeze({
      operation: "multiply by $0",
      operand: `${unscored} ${unscored === 1 ? "department" : "departments"} carrying no completed`
        + " FinOps score.",
      note: "An unscored department contributes zero and is never extrapolated from, which is why"
        + " the figure is a floor for the organization rather than its total.",
      running: usd(running),
    }));
  }

  steps.push(Object.freeze({
    operation: `multiply by ${MONTHS_PER_YEAR}`,
    operand: "the month above, held for a year.",
    note: "No seasonality and no growth adjustment.",
    running: usd(running * MONTHS_PER_YEAR),
  }));
  steps.push(Object.freeze({
    operation: "round once",
    operand: "the annual figure, to whole dollars.",
    note: "Rounded once, at the end, so no step above carries a rounding of its own.",
    running: record.annualisedDisplay ?? usd(running * MONTHS_PER_YEAR),
  }));
  return Object.freeze(steps);
}

/**
 * The versions and bands, once.
 *
 * Every value is read from the module that owns it rather than restated, so a
 * rubric bump or a repriced tier moves this section and cannot leave it quoting
 * last month's number in a meeting.
 */
export function evidenceRubric() {
  const card = DEFAULT_REFERENCE_CARD;
  return Object.freeze([
    Object.freeze({
      term: "Recoverable-spend rule",
      detail: RECOVERABLE_SPEND_RULE,
    }),
    Object.freeze({
      term: "Confidence cut points",
      detail: CONFIDENCE_RULE,
    }),
    Object.freeze({
      term: "Literacy rubric version",
      detail: `${PEER_COHORT_RUBRIC_VERSION} — the published rubric that classifies each prompt`
        + " into the four query classes the recoverable line is attributed from.",
    }),
    Object.freeze({
      term: "Rate card and pricing bands",
      detail: `${RATE_CARD_CONTRACT_VERSION} · card ${card.cardId} · source ${card.source}.`
        + ` Premium text tier ${usd(PREMIUM_LIST_RATE)} per million tokens, standard text tier`
        + ` ${usd(STANDARD_LIST_RATE)} per million tokens, both unsourced published list prices`
        + " with no committed-use discount declared — so every price here is a ceiling.",
    }),
  ]);
}

/**
 * The whole case for one analysis envelope.
 *
 * `state` is `empty` rather than an exception when nothing is scored: a reader
 * who has imported an export with no completed score is owed the four headings
 * and the reason, not a blank region and not a $0 that reads like a measurement.
 */
export function evidenceCase(dataset = loadExampleDataset()) {
  const record = getRecoverableSpend(dataset);
  const scored = record.scoredDepartments > 0;
  return Object.freeze({
    contract: EVIDENCE_CASE_CONTRACT,
    state: scored ? EVIDENCE_CASE_STATE.ready : EVIDENCE_CASE_STATE.empty,
    claim: Object.freeze({
      figure: record.monthlyDisplay ?? "No recoverable figure is stated",
      available: Boolean(record.monthlyDisplay),
      sentence: scored
        ? `${record.headline}. ${record.basisSentence} ${record.confidence.sentence}`
        : record.basisSentence,
    }),
    chain: recoverableChain(dataset, record),
    rubric: evidenceRubric(),
    inputs: Object.freeze(attestationOperands(dataset, record).map((operand) => Object.freeze({
      key: operand.key,
      label: INPUT_LABEL[operand.key] ?? operand.key,
      value: asText(operand.value),
      origin: operand.origin,
      originLabel: ORIGIN_LABEL[operand.origin] ?? operand.origin,
      assumption: operand.assumption,
    }))),
  });
}

// ---------------------------------------------------------------------------
// The paint.
// ---------------------------------------------------------------------------

const byId = (doc, id) => doc?.getElementById?.(id) ?? null;

const element = (doc, tag, className, text = null) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== null) node.textContent = text;
  return node;
};

/**
 * One term-and-body row, in the vocabulary this page already reads figures in.
 *
 * `overflow-wrap` on `.data-guarantee-list` is what keeps a provenance label
 * nobody expected — a two-hundred-character department name out of somebody's
 * export — inside the column instead of widening the region, which is why an
 * implausible label is a state this region draws rather than a bug it discovers.
 */
const row = (doc, term, detail, tail = null) => {
  const group = element(doc, "div", "data-guarantee-pair");
  group.append(element(doc, "dt", null, term));
  const dd = element(doc, "dd", null, detail);
  if (tail) dd.append(tail);
  group.append(dd);
  return group;
};

/**
 * The origin chip: the word, the silhouette, and a screen-reader lead-in.
 *
 * `data-silhouette="outline"` on both origins is deliberate and it is the Claude
 * Design foundations rule applied rather than paraphrased — filled wash is for a
 * dynamic signal, outline for a static classification, and where an operand came
 * from is a classification of the operand, not a live state. The two origins are
 * told apart by the WORD, never by the fill.
 */
function originChip(doc, input) {
  const chip = element(doc, "span", "brief-provenance");
  chip.setAttribute("data-provenance", input.origin);
  chip.setAttribute("data-silhouette", "outline");
  chip.setAttribute("data-tone", "neutral");
  const lead = element(doc, "span", "visually-hidden", `${input.label} provenance: `);
  chip.append(lead, element(doc, "span", "brief-provenance-label", input.originLabel));
  return chip;
}

/**
 * One input's assumption, behind a real disclosure.
 *
 * A `summary` element rather than a button with `aria-expanded` authored on it:
 * the browser owns the expanded state, so it cannot go stale, and the keyboard
 * reaches it with no `tabindex` of ours. `aria-expanded` is still written, and
 * written from the `toggle` event rather than from the press, so the attribute
 * and the element agree even when something else opens the disclosure — a deep
 * link, a find-in-page, a reader expanding all. The state span carries a shape
 * and the words Show / Hide, so the affordance is never a colour alone.
 */
function assumptionDisclosure(doc, input) {
  const details = element(doc, "details", "figure-source");
  details.setAttribute("data-disclosure", "collapsed");
  const summary = element(doc, "summary", "figure-source-summary");
  summary.setAttribute("aria-expanded", "false");
  const state = element(doc, "span", "figure-source-state");
  state.setAttribute("data-disclosure", "collapsed");
  const shape = element(doc, "span", "figure-source-shape", "▸");
  shape.setAttribute("aria-hidden", "true");
  state.append(shape, doc.createTextNode(" Show the assumption"));
  summary.append(state);
  const body = element(doc, "p", "figure-source-detail", input.assumption);
  details.append(summary, body);
  details.addEventListener?.("toggle", () => {
    const open = details.open === true || details.getAttribute("open") !== null;
    summary.setAttribute("aria-expanded", open ? "true" : "false");
    details.setAttribute("data-disclosure", open ? "expanded" : "collapsed");
    state.setAttribute("data-disclosure", open ? "expanded" : "collapsed");
    shape.textContent = open ? "▾" : "▸";
    state.lastChild.textContent = open ? " Hide the assumption" : " Show the assumption";
  });
  return details;
}

/**
 * Paint the case into the shipped region and hand back the state it painted.
 *
 * Idempotent: every list is replaced whole, so the open that brings a reader back
 * to this destination repaints rather than appending a second chain. It returns
 * null when the region is not in the document, which is what a page that has not
 * shipped the markup yet reads as "nothing to do".
 */
export function renderEvidenceCase(doc, dataset = loadExampleDataset()) {
  const region = byId(doc, EVIDENCE_CASE_IDS.region);
  if (!region) return null;
  const record = evidenceCase(dataset);
  const figure = byId(doc, EVIDENCE_CASE_IDS.claimFigure);
  const sentence = byId(doc, EVIDENCE_CASE_IDS.claimSentence);
  const chain = byId(doc, EVIDENCE_CASE_IDS.chain);
  const rubric = byId(doc, EVIDENCE_CASE_IDS.rubric);
  const provenance = byId(doc, EVIDENCE_CASE_IDS.provenance);
  const failure = byId(doc, EVIDENCE_CASE_IDS.error);

  region.setAttribute("data-evidence-state", record.state);
  if (failure) failure.hidden = true;
  if (figure) {
    figure.textContent = record.claim.figure;
    figure.setAttribute("data-available", record.claim.available ? "true" : "false");
  }
  if (sentence) sentence.textContent = record.claim.sentence;

  // THE ORDINAL IS THE LIST'S OWN. An ordered list with its markers suppressed is
  // a chain a reader cannot cite a step of, so the `ol` carries no class: the
  // number beside each step is the browser's, and every class inside one already
  // ships. The operation is the mono label role, the operand and its caveat the
  // supporting role, and the running result an outline chip — the three type
  // roles the foundations card already assigns, and no new rule in either sheet.
  if (chain) {
    chain.replaceChildren();
    record.chain.forEach((step, index) => {
      const item = doc.createElement("li");
      item.setAttribute("data-operation", step.operation);
      item.setAttribute("data-running", step.running);
      item.append(
        element(doc, "p", "stand-figure-label", step.operation),
        element(doc, "p", "answer-figure-basis", step.operand),
      );
      if (step.note) item.append(element(doc, "p", "answer-figure-basis", step.note));
      const chip = element(doc, "span", "brief-provenance");
      chip.setAttribute("data-provenance", "derived");
      chip.setAttribute("data-silhouette", "outline");
      chip.setAttribute("data-tone", "neutral");
      chip.append(
        element(doc, "span", "visually-hidden", `Running total after step ${index + 1}: `),
        element(doc, "span", "brief-provenance-label", step.running),
      );
      item.append(chip);
      chain.append(item);
    });
  }

  if (rubric) {
    rubric.replaceChildren();
    for (const entry of record.rubric) rubric.append(row(doc, entry.term, entry.detail));
  }

  if (provenance) {
    provenance.replaceChildren();
    for (const input of record.inputs) {
      const group = element(doc, "div", "data-guarantee-pair");
      group.setAttribute("data-input", input.key);
      group.setAttribute("data-origin", input.origin);
      group.append(element(doc, "dt", null, input.label));
      const dd = doc.createElement("dd");
      const value = element(doc, "span", null, input.value);
      value.setAttribute("data-role", "value");
      dd.append(value, originChip(doc, input), assumptionDisclosure(doc, input));
      group.append(dd);
      provenance.append(group);
    }
  }
  return record.state;
}

/**
 * The state to paint when this module itself never arrived.
 *
 * Exported for the same reason the copy is authored in the document rather than
 * written here: the caller that has to draw this state is the one holding a
 * failed `import()`, so it cannot be holding this function either. It is here so
 * a test can drive the state the shell writes by hand, against the same ids.
 */
export function evidenceCaseFailureState() {
  return EVIDENCE_CASE_STATE.error;
}
