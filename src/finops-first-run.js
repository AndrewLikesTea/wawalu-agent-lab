// The first-run synthetic result: what this page answers before it is given a
// file.
//
// THE PROBLEM THIS SOLVES. A first-time visitor arrives with no provider export
// in hand. Until now the first viewport gave them a hero sentence, a status
// strip saying nothing of theirs was imported, and a score card whose four
// slots read "Not scored yet". Every populated figure on the page was either
// behind a disclosure, nine screens down, or gated on a fetch — so the question
// a buyer actually arrives with, "what does this thing tell me?", had no answer
// above the fold. The one-click example dataset existed, but it sat beside a
// file picker most of a page away and produced nothing until it was pressed.
//
// So this module composes a complete, readable result out of the bundled
// invented dataset and hands it to the first viewport already populated: one
// headline benchmark, one quantified impact, one honestly-unavailable value,
// and one recommended action with the role accountable for it.
//
// ---------------------------------------------------------------------------
// THE RULES THIS MODULE ENFORCES
// ---------------------------------------------------------------------------
//
// 1. NOTHING IS PRE-COMPUTED. Every figure below comes out of
//    `loadExampleDataset()` — the same translator, the same analysis, and the
//    same briefing contract a reader's own file walks through — and is then
//    validated against `validateBriefing`. There is no hand-written number in
//    this file, so a contract that moves under it fails loudly rather than
//    leaving a stale figure on the landing surface.
//
// 2. A SYNTHETIC FIGURE IS NEVER PRESENTED AS AN OUTCOME. Every slot carries
//    the sample label with it, in words, and the impact slot says in its own
//    detail line that a routing scenario is a modelled ceiling rather than a
//    realized saving. `SAMPLE_LABEL` is authored once here so the region and
//    its tests cannot hold two versions of it.
//
// 3. AN ABSENT FIGURE IS LABELLED, NEVER ZEROED. Where the analysis has no
//    value — the bundled sample genuinely ships no peer cohort — the slot says
//    "Unavailable" and carries the reason the analysis itself gave. A dash, an
//    estimate, or a "$0" would each be a claim this page cannot make.
//
// 4. THE COMPOSITION IS TOTAL. `composeFirstRunResult` never throws and never
//    returns null: malformed input, a missing envelope, and a briefing that
//    fails validation all resolve to the `unavailable` state with a reason in
//    it, because the two next actions below the result stay useful in every one
//    of those cases and a region that vanishes takes them with it.
//
// Every string here is plain text. This module builds no nodes and assigns no
// markup; `finops-first-run-view.js` owns the DOM.

import { loadExampleDataset } from "./example-dataset.js";
import { buildFinopsBriefing, validateBriefing } from "./finops-briefing-contract.js";
import { DECISION_QUESTION, loadCanonicalDecision } from "./finops-decision-contract.js";

/** Bump when a slot, a state word, or a label changes meaning. */
export const FIRST_RUN_VERSION = "finops-first-run-result/1.0.0";

/** The element ids this module's view owns. Nothing else writes them. */
export const FIRST_RUN_IDS = Object.freeze({
  region: "finops-first-run",
  question: "finops-first-run-title",
  label: "finops-first-run-label",
  confidenceValue: "finops-first-run-confidence-value",
  confidenceDetail: "finops-first-run-confidence-detail",
  shape: "finops-first-run-shape",
  word: "finops-first-run-word",
  sample: "finops-first-run-sample",
  benchmarkValue: "finops-first-run-benchmark-value",
  benchmarkDetail: "finops-first-run-benchmark-detail",
  impactValue: "finops-first-run-impact-value",
  impactDetail: "finops-first-run-impact-detail",
  peerValue: "finops-first-run-peer-value",
  peerDetail: "finops-first-run-peer-detail",
  action: "finops-first-run-action",
  role: "finops-first-run-role",
  methodList: "finops-first-run-method-list",
  demo: "finops-first-run-demo",
  import: "finops-first-run-import",
  contact: "finops-first-run-contact",
  live: "finops-first-run-live",
});

/** The visible name of the region, so "example" is read rather than inferred. */
export const FIRST_RUN_LABEL = "Example result · nothing of yours needed";

/**
 * The three states this region resolves into, each readable without colour: a
 * word, a shape, and a tone family that only repeats them. The shapes are the
 * ones `panel-status-view.js` publishes — ◇ awaiting input, ▣ computed,
 * ▲ could not compute — so one glyph means one thing across the page.
 *
 * There is deliberately no "loading" state here. Only `#finops-load-state` may
 * narrate a load, and this result needs no network at all: it is composed from
 * a module in the bundle, which is why it survives a failed fixture fetch.
 */
export const FIRST_RUN_STATE = Object.freeze({
  pending: Object.freeze({ state: "pending", word: "Example result pending", shape: "◇", tone: "neutral" }),
  ready: Object.freeze({ state: "ready", word: "Example result", shape: "▣", tone: "resolved" }),
  unavailable: Object.freeze({ state: "unavailable", word: "Example result unavailable", shape: "▲", tone: "error" }),
});

/**
 * The invented-sample-data labelling, authored once.
 *
 * It is shown *above* the figures rather than under them, because a reader
 * decides what kind of number they are looking at before they read the number.
 */
export const SAMPLE_LABEL = Object.freeze({
  badge: "Invented sample data",
  statement:
    "Every figure below comes from a bundled six-month dataset for an invented company. "
    + "It is not your spend, customer data, or realized savings.",
});

/** What a slot says when the analysis produced no value for it. */
export const UNAVAILABLE_VALUE = "Unavailable";

/** The reasons this region can be unavailable as a whole, in the words it uses. */
export const FIRST_RUN_UNAVAILABLE = Object.freeze({
  pending: "The bundled example has not been composed on this page yet.",
  notComposed: "No example analysis was produced, so no figure is shown here.",
  invalidBriefing: "The bundled example did not satisfy the briefing contract, so no figure is shown here.",
  failed: "The bundled example could not be analyzed in this browser, so no figure is shown here.",
});

/**
 * The two next steps, kept clearly distinct.
 *
 * They are different decisions, not two labels for one: the first runs the
 * invented data through every panel on this page, and the second opens the
 * picker for a reader's own export. Neither one is a scroll hint — both are
 * real buttons in this region's own tab order, and each delegates to the single
 * control that already owns its behaviour, so there is still exactly one way
 * into the example dataset and one file input.
 */
export const FIRST_RUN_ACTIONS = Object.freeze({
  demo: Object.freeze({
    label: "Try the example data",
    note: "See the same six invented months in every panel below. Nothing is uploaded or stored.",
    targetId: "try-example-dataset",
  }),
  import: Object.freeze({
    label: "Analyze local exports",
    note: "Choose your provider exports. They stay in this tab and are not uploaded or stored.",
    targetId: "local-finops-files",
  }),
});

/**
 * The conversion moment that follows the result.
 *
 * Deliberately after the two choices above and deliberately quieter than both:
 * it is the step for a reader who has read a number and wants a person, not a
 * third way to start. It opens the follow-up form this page already ships
 * rather than adding a second one.
 */
export const FIRST_RUN_CONVERSION = Object.freeze({
  heading: "Want help with your own analysis?",
  body: "Analyze your provider exports in this browser, or leave your email and we can walk you through the process.",
  label: "Ask for a walkthrough",
  targetId: "finops-contact-open",
  focusId: "finops-contact-email",
});

/** The slot labels, so the region and its tests cannot disagree. */
export const SLOT_LABEL = Object.freeze({
  benchmark: "Headline benchmark · recoverable share of analyzed spend",
  impact: "Quantified impact · routing scenario",
  peer: "Peer comparison",
  action: "Recommended action · rank 1",
  confidence: "Confidence in this answer",
});

const USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

/** A whole-dollar figure, or null. Never "$0" for a value that is not a number. */
function usd(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? USD.format(amount) : null;
}

/** A whole-percent figure, or null. */
function percent(ratio) {
  const value = Number(ratio);
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : null;
}

const count = (value) => new Intl.NumberFormat("en-US").format(value);

/**
 * The recoverable share of analyzed spend: the one ratio that reads as a
 * benchmark rather than as a total, so a reader can hold it against their own
 * number before they have run anything.
 *
 * Null rather than zero when the denominator is missing, non-positive, or the
 * numerator is not a number — a share of nothing is not 0%, it is unknown.
 */
export function recoverableShare(recoverableUsd, analyzedSpendUsd) {
  const recoverable = Number(recoverableUsd);
  const analyzed = Number(analyzedSpendUsd);
  if (!Number.isFinite(recoverable) || recoverable < 0) return null;
  if (!Number.isFinite(analyzed) || analyzed <= 0) return null;
  return recoverable / analyzed;
}

/** "2026-06-01T00:00:00Z" → "2026-06-01". Null for anything else. */
function calendarDay(instant) {
  const match = /^(\d{4}-\d{2}-\d{2})T/.exec(String(instant ?? ""));
  return match ? match[1] : null;
}

/** The reporting window as the briefing carries it: inclusive start, exclusive end. */
function periodLine(period) {
  const start = calendarDay(period?.start);
  const end = calendarDay(period?.end);
  return start && end ? `${start} to ${end} (end exclusive)` : null;
}

function slot(available, value, detail) {
  return Object.freeze({ available, value, detail });
}

/**
 * The benchmark slot: a share, with the two operands that produced it beside
 * it so a reader can check the ratio rather than take it.
 */
function benchmarkSlot(analysis, briefing) {
  const share = recoverableShare(analysis?.recoverableUsd, analysis?.spendUsd);
  if (share === null) {
    return slot(false, UNAVAILABLE_VALUE,
      "The example analysis produced no analyzed-spend denominator, so no share is shown.");
  }
  const recoverable = usd(analysis.recoverableUsd);
  const analyzed = usd(analysis.spendUsd);
  const departments = Array.isArray(analysis?.rankedDepartments) ? analysis.rankedDepartments.length : 0;
  const window = periodLine(briefing?.materialMetric?.period);
  const parts = [`${recoverable} of ${analyzed} analyzed`];
  if (departments) parts.push(`${count(departments)} invented departments`);
  if (window) parts.push(window);
  return slot(true, `${percent(share)} of analyzed AI spend`, `${parts.join(" · ")}.`);
}

/**
 * The impact slot: the briefing's own material metric, or the briefing's own
 * statement of why there is none. The absence statement is carried verbatim —
 * this module does not re-decide a slot the contract already decided.
 */
function impactSlot(briefing) {
  const metric = briefing?.materialMetric;
  const amount = metric?.unit === "USD" ? usd(metric.value) : null;
  if (!amount) {
    return slot(false, UNAVAILABLE_VALUE,
      briefing?.absent?.materialMetric?.statement
      ?? "The example analysis produced no material figure for this period.");
  }
  return slot(true, `${amount} in the reporting period`,
    "A modelled routing scenario over the invented departments — a ceiling on what re-routing "
    + "could recover, not a realized, invoiced, or promised saving.");
}

/**
 * The peer slot, and the reason it exists: the bundled sample genuinely ships
 * no comparable cohort, so this is the region's own worked example of an
 * unavailable value that is labelled rather than filled in.
 */
function peerSlot(analysis) {
  const benchmark = analysis?.benchmark;
  const comparisons = Array.isArray(benchmark?.comparisons) ? benchmark.comparisons.length : 0;
  if (benchmark?.state === "available" && comparisons > 0) {
    return slot(true, `${count(comparisons)} compared departments`,
      typeof benchmark.methodology === "string" ? benchmark.methodology : "");
  }
  const message = typeof benchmark?.message === "string" && benchmark.message.trim()
    ? benchmark.message
    : "No comparable peer cohort ships with this example, so no position is claimed.";
  return slot(false, UNAVAILABLE_VALUE, message);
}

/** The rank-1 action and the role accountable for it, or the reason there is none. */
function actionSlot(briefing) {
  const ranked = briefing?.rankedAction;
  if (typeof ranked?.action === "string" && ranked.action.trim()) {
    const cap = usd(briefing?.materialMetric?.value);
    const action = cap
      ? `Pilot lower-cost routing in the top-spend invented department. Cap the pilot at ${cap}, then compare it with a similar period.`
      : ranked.action;
    return slot(true, action,
      typeof ranked.accountableRole === "string" && ranked.accountableRole
        ? `Accountable role: ${ranked.accountableRole}`
        : "");
  }
  return slot(false, "No action is ranked from this example.",
    briefing?.absent?.rankedAction?.statement ?? "");
}

/**
 * The confidence slot: the canonical decision's bounded score, and the basis
 * for it in the same breath.
 *
 * A summary that states an impact without stating how much of it was verified
 * is not a complete decision — it is a number a leader has to take on faith. So
 * the score never appears without its basis: if the canonical record is missing
 * or fails its contract, this slot says so rather than showing a bare decimal.
 */
function confidenceSlot(decision) {
  const confidence = decision?.confidence;
  const score = Number(confidence?.score);
  if (!Number.isFinite(score) || typeof confidence?.basis !== "string" || !confidence.basis.trim()) {
    return slot(false, UNAVAILABLE_VALUE,
      "No confidence score was published with this example, so none is claimed.");
  }
  return slot(true, `${score.toFixed(2)} of 1.00 · ${confidence.band}`, confidence.basis);
}

/**
 * The method disclosure, built out of the briefing rather than written beside
 * it, so the sentence a reader checks the figure against cannot drift from the
 * figure. Every entry is a term and its plain-text value.
 */
function methodEntries(analysis, briefing) {
  const coverage = briefing?.coverage ?? {};
  const entries = [
    ["Inputs", "Six invented monthly provider exports and one invented HRIS org export, generated "
      + "in this tab. No company, account, provider, or person in them is real, and no customer "
      + "or telemetry data is read."],
    ["Path", "The same translator, analysis, and briefing your own file walks through — "
      + `${analysis?.schemaVersion ?? "no analysis schema"} · `
      + `${briefing?.contractVersion ?? "no briefing contract"} · `
      + `${briefing?.rubricVersion ?? "no rubric"}.`],
  ];
  if (briefing?.arithmeticInputs?.operation) {
    entries.push(["Arithmetic", briefing.arithmeticInputs.operation]);
  }
  if (Number.isFinite(Number(coverage.recordsTotal))) {
    entries.push(["Coverage", `${count(coverage.recordsAnalyzed ?? 0)} of `
      + `${count(coverage.recordsTotal ?? 0)} example records analyzed · `
      + `confidence ${coverage.confidence ?? "unknown"}.`]);
  }
  entries.push(["Limits", "A routing scenario is a modelled ceiling, not a realized saving. This "
    + "sample carries no peer cohort and no scored query sample, so the peer and literacy "
    + "figures on this page stay unavailable. Your own export will produce different numbers."]);
  if (briefing?.provenance?.text) entries.push(["Where it ran", briefing.provenance.text]);
  return Object.freeze(entries.map(([term, detail]) => Object.freeze({ term, detail })));
}

/**
 * Compose the region from an analysis envelope and the briefing built from it.
 *
 * Total: any input this cannot read resolves to `unavailable` with a reason,
 * because the sample label and the two next actions below the figures stay
 * useful in exactly those cases.
 */
export function composeFirstRunResult({ analysis = null, briefing = null, decision = null } = {}) {
  if (!analysis || typeof analysis !== "object" || !briefing || typeof briefing !== "object") {
    return unavailableResult(FIRST_RUN_UNAVAILABLE.notComposed);
  }
  let validation;
  try {
    validation = validateBriefing(briefing);
  } catch {
    return unavailableResult(FIRST_RUN_UNAVAILABLE.invalidBriefing);
  }
  if (!validation?.valid) {
    return unavailableResult(FIRST_RUN_UNAVAILABLE.invalidBriefing);
  }
  const benchmark = benchmarkSlot(analysis, briefing);
  // A region whose one populated headline is itself unavailable is not a
  // result, and calling it one would be the exact misrepresentation this
  // module exists to prevent.
  if (!benchmark.available) {
    return unavailableResult(FIRST_RUN_UNAVAILABLE.notComposed);
  }
  return Object.freeze({
    ...BASE,
    presentation: FIRST_RUN_STATE.ready,
    // The region's own heading is the canonical decision question, not the
    // briefing's headline question. The briefing asks what an analysis says;
    // this region is the page's one complete answer to what a leader arrived
    // to decide, and `finops-decision-contract.js` owns that wording.
    question: DECISION_QUESTION,
    decision,
    benchmark,
    impact: impactSlot(briefing),
    peer: peerSlot(analysis),
    action: actionSlot(briefing),
    confidence: confidenceSlot(decision),
    method: methodEntries(analysis, briefing),
    reason: null,
  });
}

/** The part of the region that does not depend on any analysis at all. */
const BASE = Object.freeze({
  version: FIRST_RUN_VERSION,
  label: FIRST_RUN_LABEL,
  sample: SAMPLE_LABEL,
  actions: FIRST_RUN_ACTIONS,
  conversion: FIRST_RUN_CONVERSION,
});

function unavailableResult(reason) {
  const empty = slot(false, UNAVAILABLE_VALUE, reason);
  return Object.freeze({
    ...BASE,
    presentation: FIRST_RUN_STATE.unavailable,
    // The question stands even when the answer does not: a reader who meets
    // this region in its unavailable state should still be able to see what it
    // would have decided.
    question: DECISION_QUESTION,
    decision: null,
    benchmark: empty,
    impact: empty,
    peer: empty,
    action: slot(false, "No action is ranked from this example.", reason),
    confidence: empty,
    method: Object.freeze([Object.freeze({ term: "Limits", detail: reason })]),
    reason,
  });
}

/**
 * Build the region, running the bundled example through the real analysis path.
 *
 * Wrapped rather than trusted: this runs on first paint on the landing surface,
 * and a contract that moved under the fixture must degrade this region to its
 * labelled unavailable state instead of taking the page down with it.
 *
 * @param load injectable for tests; defaults to the shipped example dataset.
 */
export function buildFirstRunResult(load = loadExampleDataset, loadDecision = loadCanonicalDecision) {
  try {
    const analysis = load();
    // The established example analysis and the authored fixture are independent
    // local inputs. A broken fixture must not hide a still-valid benchmark and
    // action; it only removes the confidence claim it owns.
    //
    // A record that failed validation is dropped whole rather than attached and
    // ignored. The loader's verdict is the boundary: a rejected record may carry
    // exactly the content the boundary rejected it for — an address, a
    // credential, a string that arrived from an import — and this result is
    // serialized into views, snapshots, and judge-facing summaries. Carrying it
    // "unused" would put the rejected value in every one of them.
    let decision = null;
    try {
      const loaded = loadDecision();
      decision = loaded?.valid ? (loaded.decision ?? null) : null;
    } catch {
      decision = null;
    }
    return composeFirstRunResult({ analysis, briefing: buildFinopsBriefing(analysis), decision });
  } catch {
    return unavailableResult(FIRST_RUN_UNAVAILABLE.failed);
  }
}
