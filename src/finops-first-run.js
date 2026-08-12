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

import {
  EXAMPLE_ORG_COHORT_PROFILE, EXAMPLE_TASK_LEDGER, exampleCohortPosition,
  loadExampleDataset, nameExampleDepartments,
} from "./example-dataset.js";
import { getRecoverableSpend } from "./finops-answer-contract.js";
import { buildFinopsBriefing, validateBriefing } from "./finops-briefing-contract.js";
import {
  COST_BAND, PEER_RANK_LABEL, costPositionDetail, costPositionHeadline, resolveCostPosition,
} from "./peer-cost-position.js";
import {
  bandDistanceWords, INTERNAL_GAP_STATUS, internalGapDetail, internalGapHeadline,
  resolveInternalCostGap,
} from "./internal-cost-gap.js";
import { DECISION_QUESTION, loadCanonicalDecision } from "./finops-decision-contract.js";
import {
  auditDecisionFigures, DECISION_STATE, noticeFor, OUT_OF_RANGE_VALUE, RELOAD_ACTION,
} from "./finops-decision-interaction.js";
import {
  composeFirstRunLiteracy, LITERACY_SLOT_LABEL, LITERACY_UNAVAILABLE, literacyMethodEntry,
} from "./finops-first-run-literacy.js";

/** Bump when a slot, a state word, or a label changes meaning. */
export const FIRST_RUN_VERSION = "finops-first-run-result/1.0.0";

/** The element ids this module's view owns. Nothing else writes them. */
export const FIRST_RUN_IDS = Object.freeze({
  region: "finops-first-run",
  question: "finops-first-run-title",
  answer: "finops-first-run-answer",
  answerDetail: "finops-first-run-answer-detail",
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
  // The band chip, ahead of the value it bands, so the position is the first
  // thing read in the slot rather than a decoration hung off the end of it.
  peerBand: "finops-first-run-peer-band",
  // The internal drill-down of that same position: which department is furthest
  // behind which, on the same metric and the same band boundaries.
  internalValue: "finops-first-run-internal-value",
  internalDetail: "finops-first-run-internal-detail",
  internalBand: "finops-first-run-internal-band",
  // The fifth resolved slot: the letter the bundled synthetic prompt corpus
  // earns, and the share of the invented spend that sample actually covers.
  // `finops-first-run-literacy.js` owns both figures and the join between them.
  literacyValue: "finops-first-run-literacy-value",
  literacyDetail: "finops-first-run-literacy-detail",
  action: "finops-first-run-action",
  role: "finops-first-run-role",
  // The three containers that speak for the bundled example and only for it.
  // They are addressed as wholes because #979 withholds them as wholes: once a
  // reader's own export is on screen, a synthetic peer band beside their own
  // department ranking is a second answer to the question this region asks.
  slots: "finops-first-run-slots",
  recommendation: "finops-first-run-recommendation",
  confidence: "finops-first-run-confidence",
  methodList: "finops-first-run-method-list",
  method: "finops-first-run-method",
  methodSummary: "finops-first-run-method-summary",
  // The heading text inside that summary, separate from the state chip beside
  // it, so the disclosure can name what it is actually holding.
  methodTitle: "finops-first-run-method-title",
  methodState: "finops-first-run-method-state",
  methodPrint: "finops-first-run-method-print",
  demo: "finops-first-run-demo",
  import: "finops-first-run-import",
  // The third way on, and the only one that leaves this page: the same bundled
  // example, rebuilt as the printable executive sheet. Its copy and its href
  // live in `finops-example-briefing.js`, which owns the hand-off; these are the
  // slots that carry them.
  briefing: "finops-first-run-briefing",
  briefingHeading: "finops-first-run-briefing-heading",
  briefingNote: "finops-first-run-briefing-note",
  // The destination URL a recipient of the forwarded briefing opens (#1525),
  // as text beside the hand-off rather than as a second control: this block
  // keeps exactly one tab stop.
  briefingAddress: "finops-first-run-briefing-address",
  briefingUrl: "finops-first-run-briefing-url",
  live: "finops-first-run-live",
});

/** The visible name of the region, so "example" is read rather than inferred. */
export const FIRST_RUN_LABEL = "Bundled synthetic example · nothing of yours needed";

/**
 * The three states this region resolves into, each readable without colour: a
 * word, a shape, and a tone family that only repeats them. The shapes are the
 * ones `panel-status-view.js` publishes — ◇ awaiting input, ▣ computed,
 * ▲ could not compute — so one glyph means one thing across the page.
 *
 * There is deliberately no "loading" state here. Only `#finops-load-state` may
 * narrate a load, and this result needs no network at all: it is composed from
 * a module in the bundle, which is why it survives a failed fixture fetch.
 * `DECISION_STATE.loading` names that state and names its owner, so the fact
 * that this region does not reach it is written down rather than inferred.
 *
 * `empty` and `unavailable` are deliberately two states and not one. "The
 * example carried no records" and "the example could not be analyzed" ask a
 * reader for different things — the first is a dataset with nothing in it, the
 * second is a failure — and collapsing them into one red block is how a page
 * tells someone to retry something that worked.
 *
 * `pending` overrides the word `DECISION_STATE.pending` carries. This region's
 * pending state is "a visitor has just arrived", not "a composition this page
 * started is still running", and "Example result pending" narrates a wait for
 * something nobody asked for. The word stays a state *name* — two words beside
 * the ◇ glyph — because that pairing is the greyscale, print, and screen-reader
 * channel, and because it is swapped on every transition. The sentence a
 * visitor actually reads is `FIRST_RUN_INSTRUCTION`, in the answer slot below.
 */
export const FIRST_RUN_STATE = Object.freeze({
  pending: Object.freeze({ ...DECISION_STATE.pending, word: "Not analyzed" }),
  ready: DECISION_STATE.ready,
  empty: DECISION_STATE.empty,
  unavailable: DECISION_STATE.error,
});

/**
 * The one plain-language message before anything has been analyzed.
 *
 * It is authored into the *answer* slot rather than the state label above it.
 * The label is `.eyebrow` — 11px uppercase monospace at .11em tracking — which
 * is a legible home for two words and an illegible one for a two-clause
 * instruction; the answer slot is the region's largest text and the first line
 * a reader lands on. It says what has happened and names both ways on, so the
 * slots underneath do not each have to re-explain themselves.
 *
 * "Not yet" and not "unavailable": this page spends "unavailable" on
 * `DECISION_STATE.error`, down to `state: "unavailable"` and `tone: "error"`.
 * A first screen that borrows it tells a visitor their analysis failed before
 * they have chosen anything, and leaves nothing to say when one really does.
 */
export const FIRST_RUN_INSTRUCTION =
  "No analysis has run yet. Try the Bundled synthetic example without uploading a file, or analyze your own export.";

/**
 * What a slot says before anything has been analyzed, in one shape.
 *
 * Three names for three slots, one wording for all of them: a reader learns
 * "Not available yet" once and recognizes it in whichever slot is empty — the
 * same words departments.html and finops-stand.js put in an unfilled slot. The
 * keys stay distinct because the callers name the slot they are filling.
 */
export const FIRST_RUN_NOT_YET = Object.freeze({
  measured: "Not available yet",
  ranked: "Not available yet",
  combined: "Not available yet",
});

/**
 * The invented-sample-data labelling, authored once.
 *
 * It is shown *above* the figures rather than under them, because a reader
 * decides what kind of number they are looking at before they read the number.
 */
export const SAMPLE_LABEL = Object.freeze({
  badge: "Bundled synthetic example",
  // A word and a clause (#1185); the paragraph is in the region's disclosure.
  statement: "Illustrative — invented data for an invented company, not your spend or"
    + " realized savings. No file is needed.",
});

/** What a slot says when the analysis produced no value for it. */
export const UNAVAILABLE_VALUE = "Unavailable";

/**
 * The reasons this region can be unavailable as a whole, in the words it uses.
 *
 * Each one names what failed and ends on the ONE thing the reader can do about
 * it, in the same words every time (#1669): the example is composed in this tab
 * from bytes this page already carries, so reloading is the whole recovery, and
 * a reader who is told what broke without being told that has been told half.
 * `pending` and `failed` are not re-authored here — they are the states
 * `DECISION_STATE` already names for the region below, read from it so one
 * wording cannot become two.
 */
export const FIRST_RUN_UNAVAILABLE = Object.freeze({
  pending: DECISION_STATE.pending.statement,
  notComposed: `No Bundled synthetic example analysis was produced, so no figure is shown here. ${RELOAD_ACTION}`,
  invalidBriefing: `The Bundled synthetic example came back missing figures this region states, so no figure is shown here. ${RELOAD_ACTION}`,
  failed: DECISION_STATE.error.statement,
  empty: DECISION_STATE.empty.statement,
  outOfRange: `A figure in the Bundled synthetic example was outside the range it can take, so it is not shown. ${RELOAD_ACTION}`,
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
    label: "Try the Bundled synthetic example",
    note: "Fills every panel below with six invented months. No file is needed.",
    targetId: "try-example-dataset",
  }),
  import: Object.freeze({
    // "Analyze local exports" named the file rather than the reader, and
    // "local" is this page's word for where the analysis runs, not for whose
    // export it is. The two labels have to be told apart at a glance by whose
    // data each one uses, which is the only difference that matters here.
    label: "Analyze your own export",
    // The first sentence is the label of the picker this choice delegates to,
    // so a reader who follows it meets the same words on the control itself.
    note: "Choose your export files. They stay in this browser and are not uploaded.",
    targetId: "local-finops-files",
  }),
});

// DELETED: FIRST_RUN_CONVERSION, the copy and the delegation target for
// #finops-first-run-conversion. The answer spine retired that region in favour
// of #finops-contact, which asks the same thing and owns the form, the label,
// and the privacy line; a second copy of the ask had nothing of its own to say.
// See src/finops/answer-spine-view.js for the retirement and its record.

/** The slot labels, so the region and its tests cannot disagree. */
export const SLOT_LABEL = Object.freeze({
  benchmark: "Headline benchmark · recoverable share of analyzed spend",
  impact: "Quantified impact · routing scenario",
  // One name for one number: the headline region above calls this the same
  // thing. "Peer position" there and "Peer comparison" here were two names for
  // the same comparison on the same screen.
  peer: PEER_RANK_LABEL,
  internal: "Internal drill-down · widest department gap",
  literacy: LITERACY_SLOT_LABEL,
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
  return Object.freeze({ available, value, detail, band: null });
}

// ---------------------------------------------------------------------------
// BAND STATES — the position and the severity of the internal gap, as something
// a reader can read rather than a colour they have to decode.
//
// A band is four channels or it is nothing: a WORD (the label below), a SHAPE
// (a glyph that differs per state, not one glyph rotated), a SILHOUETTE, and
// only then a tint. The Claude Design foundations card sets the silhouette
// rule this follows — "filled wash = dynamic signal, outline = static
// classification" — so a measured band is a wash and `withheld`, which is a
// classification of an *absence*, is an outline. That is also why `withheld` is
// a state in this table and not a missing entry: a reader who cannot be given a
// position is owed a labelled chip saying so, in the position's own place.

/** The band states a chip may carry. `withheld` is first-class, never a blank. */
export const BAND_STATE = Object.freeze({
  ahead: "ahead",
  middle: "middle",
  behind: "behind",
  critical: "critical",
  withheld: "withheld",
});

/**
 * The non-colour channels for each state.
 *
 * `shape` is a distinct glyph per state, so greyscale, a mono printer, and a
 * screen reader that ignores CSS all still separate them. `silhouette` is what
 * the stylesheet keys the chip's fill and border weight off.
 */
export const BAND_PRESENTATION = Object.freeze({
  [BAND_STATE.ahead]: Object.freeze({ shape: "▲", silhouette: "wash" }),
  [BAND_STATE.middle]: Object.freeze({ shape: "●", silhouette: "wash" }),
  [BAND_STATE.behind]: Object.freeze({ shape: "▼", silhouette: "wash" }),
  [BAND_STATE.critical]: Object.freeze({ shape: "▼▼", silhouette: "wash" }),
  // Neither diamond: ◇ and ◆ are provenance on this page and say nothing about
  // a band. A measured middle is the full circle, a withheld band the empty one.
  [BAND_STATE.withheld]: Object.freeze({ shape: "○", silhouette: "outline" }),
});

/** The peer position's three measured bands, in this module's vocabulary. */
const PEER_BAND_STATE = Object.freeze({
  [COST_BAND.top]: BAND_STATE.ahead,
  [COST_BAND.middle]: BAND_STATE.middle,
  [COST_BAND.bottom]: BAND_STATE.behind,
});

/** The label a withheld position carries in place of a band. Never a dash. */
export const WITHHELD_BAND_LABEL = "Position withheld";

/** The label a suppressed internal comparison carries. Never a dash either. */
export const WITHHELD_GAP_LABEL = "Gap not compared";

/** A band descriptor: the word, the glyph, the silhouette, and the state key. */
function band(state, label) {
  const presentation = BAND_PRESENTATION[state] ?? BAND_PRESENTATION[BAND_STATE.withheld];
  return Object.freeze({ state, label, ...presentation });
}

/** A slot that carries a band chip beside its value. */
function bandedSlot(available, value, detail, bandDescriptor) {
  return Object.freeze({ available, value, detail, band: bandDescriptor });
}

/**
 * The slot a figure gets when it is outside the range it can take.
 *
 * Not "Unavailable": an absent figure and an impossible one are different
 * facts, and a reader who is shown the same word for both cannot tell a sample
 * that ships no peer cohort from a pipeline that produced 412%. The offending
 * value travels with the notice, because the person who can fix it needs it.
 */
function outOfRangeSlot(notice) {
  return slot(false, `${OUT_OF_RANGE_VALUE}: ${notice.value}`, notice.statement);
}

/**
 * The benchmark slot: a share, with the two operands that produced it beside
 * it so a reader can check the ratio rather than take it.
 */
function benchmarkSlot(analysis, briefing, notices = []) {
  const notice = noticeFor(notices, "share");
  if (notice) return outOfRangeSlot(notice);
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
function impactSlot(briefing, notices = []) {
  const notice = noticeFor(notices, "impactUsd");
  if (notice) return outOfRangeSlot(notice);
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
 * The peer slot: where this organization's spend RANKS, not what it costs.
 *
 * The one question, and only it: "among comparable organizations, is this org's
 * cost per successful task high or low?" The value line carries the band and the
 * metric to cents; the detail line names the cohort it was compared against, so
 * a leader can repeat the position to a peer without hunting for which group
 * they were placed in.
 *
 * The numerator is `analysis.spendUsd` — the same headline spend total the
 * benchmark slot above divides — passed through untouched. Nothing here
 * recomputes spend, and nothing here can move it.
 *
 * When a position is withheld, the slot renders the contract's own reason
 * string. It never renders the bare word "Unavailable": "we do not know" and
 * "here is why we cannot say" ask different things of a reader, and only the
 * second one can be acted on.
 */
function peerSlot(analysis, org, tasks) {
  const position = resolveCostPosition({ org, spendUsd: Number(analysis?.spendUsd), tasks });
  // A withheld position is a band state with a label and a silhouette of its
  // own, painted in the position's place — not a gap in the row.
  if (!position.available) {
    return bandedSlot(false, position.reason, position.metric.definition,
      band(BAND_STATE.withheld, WITHHELD_BAND_LABEL));
  }
  const state = PEER_BAND_STATE[position.band] ?? BAND_STATE.middle;
  return bandedSlot(true, costPositionHeadline(position), costPositionDetail(position),
    band(state, position.bandLabel));
}

/**
 * The internal drill-down of the peer slot above: the widest gap BETWEEN this
 * organization's own departments, on the same metric and against the same band
 * boundaries the peer position was placed against.
 *
 * It sits directly under the peer comparison on purpose. A leader who has just
 * read "bottom quartile against comparable organizations" asks one question
 * next — where inside the company that is coming from — and answering it in a
 * different unit, against a different cohort, or three panels away is how a
 * position stops being actionable. `internal-cost-gap.js` imports the metric,
 * the boundaries, and the eligibility floor from `peer-cost-position.js` rather
 * than restating any of them, so the two lines are directly comparable.
 *
 * A suppressed finding renders its own sentence, exactly like the peer slot's
 * withheld reason. It never renders the bare word "Unavailable" and it never
 * renders an empty panel: "we did not compare, here is why" is the answer.
 */
function internalSlot(gap, cohort = null) {
  const peers = cohortSentence(cohort);
  if (gap?.status !== INTERNAL_GAP_STATUS.finding) {
    return bandedSlot(false, gap?.suppressedReason ?? FIRST_RUN_UNAVAILABLE.notComposed,
      `${gap?.metric?.definition ?? ""}${peers}`.trim(), band(BAND_STATE.withheld, WITHHELD_GAP_LABEL));
  }
  // Severity is the band distance itself, in the rubric's own words: one band
  // behind is a gap, two or more is a different fact and gets a different chip.
  const distance = Number(gap.gapBands) || 0;
  const state = distance >= 2 ? BAND_STATE.critical : BAND_STATE.behind;
  const words = bandDistanceWords(distance);
  const label = `${words.charAt(0).toUpperCase()}${words.slice(1)} behind`;
  return bandedSlot(true, `${internalGapHeadline(gap)}.`, `${internalGapDetail(gap)}${peers}`,
    band(state, label));
}

/**
 * The cohort the pair above was picked out of: who else is in it, where the
 * middle of it is, and under which rubrics.
 *
 * It is one sentence appended to the slot's own detail rather than a block of
 * its own, because it qualifies that finding and nothing else. Every name in it
 * comes from `exampleCohortPosition`, which builds its peers out of the same
 * relabelled envelope this slot's leader and laggard came from — so a reader
 * cannot meet a team here that the headline and the literacy letter above are
 * not also talking about.
 *
 * A degenerate cohort — fewer than two placeable departments, or no median —
 * renders the reason and the input that would unblock it. Never an empty list,
 * never a dash, and never a hidden block: the pair is still a finding, and the
 * cohort behind it is still owed an explanation.
 */
function cohortSentence(cohort) {
  if (!cohort) return "";
  if (!cohort.available) return ` ${cohort.reason} ${cohort.needed}`;
  return ` Cohort: ${cohort.peerNames.join(", ")} — ${cohort.peers.length} departments of the same `
    + `invented company over the same reporting period, median ${cohort.medianDisplay} per `
    + `successful task. Banded under ${cohort.rubricVersion}; the literacy letter beside this slot `
    + `is graded under ${cohort.literacyRubricVersion}.`;
}

/** The department carrying the most analyzed spend, by name. Null when unnamed. */
function topSpendDepartment(analysis) {
  const departments = Array.isArray(analysis?.rankedDepartments) ? analysis.rankedDepartments : [];
  let top = null;
  for (const department of departments) {
    const spend = Number(department?.spendUsd);
    if (!Number.isFinite(spend)) continue;
    if (!top || spend > Number(top.spendUsd)) top = department;
  }
  return typeof top?.name === "string" && top.name.trim() ? top.name.trim() : null;
}

/** The rank-1 action and the role accountable for it, or the reason there is none. */
function actionSlot(briefing, analysis = null) {
  const ranked = briefing?.rankedAction;
  if (typeof ranked?.action === "string" && ranked.action.trim()) {
    const cap = usd(briefing?.materialMetric?.value);
    // The team is named, not described. "The top-spend invented department" made
    // the reader hold a ranking in their head to find out who the action was
    // for, and it was the one line in this region that referred to a department
    // without saying which — the peer slot below names two by name.
    const top = topSpendDepartment(analysis);
    const target = top ? `${top}, the top-spend invented department` : "the top-spend invented department";
    const action = cap
      ? `Pilot lower-cost routing in ${target}. Cap the pilot at ${cap}, then compare it with a similar period.`
      : ranked.action;
    return slot(true, action,
      typeof ranked.accountableRole === "string" && ranked.accountableRole
        ? `Accountable role: ${ranked.accountableRole}`
        : "");
  }
  // The composition succeeded and ranked nothing, which is not the same as a
  // composition that failed — `degradedResult` owns that word.
  return slot(false, `${FIRST_RUN_NOT_YET.ranked}.`,
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
function confidenceSlot(decision, notices = []) {
  const notice = noticeFor(notices, "confidence");
  if (notice) return outOfRangeSlot(notice);
  const confidence = decision?.confidence;
  const score = Number(confidence?.score);
  if (!Number.isFinite(score) || typeof confidence?.basis !== "string" || !confidence.basis.trim()) {
    return slot(false, UNAVAILABLE_VALUE,
      "No confidence score was published with this example, so none is claimed.");
  }
  return slot(true, `${score.toFixed(2)} of 1.00 · ${confidence.band}`, confidence.basis);
}

/**
 * The answer: one sentence, directly under the question, before any figure.
 *
 * WHY IT EXISTS. The region used to lead with the question and then hand the
 * reader three labelled slots to assemble an answer out of. A leader who reads
 * "Are we wasting money?" and meets a grid is being asked to do the summarising
 * the page exists to do. So the canonical record's own headline is carried
 * here, verbatim where it exists, and the impact headline goes underneath it as
 * the sentence that sizes it.
 *
 * The canonical fixture and the composed benchmark are independent inputs, so
 * this falls back to the benchmark rather than disappearing with the fixture: a
 * page that can still say "33% of analyzed AI spend is recoverable" should say
 * it even when the authored headline for that number did not load.
 */
function answerSlot(decision, benchmark, impact) {
  const headline = decision?.benchmark?.headline;
  const sized = decision?.impact?.headline;
  if (typeof headline === "string" && headline.trim()) {
    return slot(true, headline.trim(),
      typeof sized === "string" && sized.trim() ? sized.trim() : (impact?.detail ?? ""));
  }
  if (benchmark?.available) {
    return slot(true, `${benchmark.value} is recoverable in this example.`, benchmark.detail ?? "");
  }
  return slot(false, "No answer is claimed from this example.",
    benchmark?.detail ?? FIRST_RUN_UNAVAILABLE.notComposed);
}

/**
 * The method disclosure, built out of the briefing rather than written beside
 * it, so the sentence a reader checks the figure against cannot drift from the
 * figure. Every entry is a term and its plain-text value.
 */
function methodEntries(analysis, briefing, gap = null, literacy = null) {
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
  // The literacy grade's own provenance, ahead of the limits that qualify it:
  // the letter, the rubric label it was produced under, and both coverage
  // denominators. A reader who disputes the letter needs all four to recompute
  // it, and a letter with no rubric version beside it cannot be argued with.
  if (literacy) entries.push(["AI literacy", literacyMethodEntry(literacy)]);
  entries.push(["Limits", "A routing scenario is a modelled ceiling, not a realized saving. This "
    + "sample carries no peer cohort, so the peer figure on this page stays unavailable, and its "
    + "literacy letter is scored over invented prompts rather than anyone's real traffic. Your own "
    + "export will produce different numbers."]);
  // The internal gap's provenance, beside the rest of the evidence rather than
  // only inside the slot: a later verification pass needs the metric, the rubric
  // version, the rows the finding selected, and the window they cover in order
  // to recompute the same number without re-importing the file.
  if (gap?.provenance) {
    const { provenance } = gap;
    const rows = provenance.rowSelector.values.length
      ? `${provenance.rowSelector.field} in ${provenance.rowSelector.values.join(", ")}`
      : `no ${provenance.rowSelector.field} rows selected`;
    const window = provenance.dateRange.start && provenance.dateRange.end
      ? `${provenance.dateRange.start} to ${provenance.dateRange.end}`
      : "window unavailable";
    entries.push(["Internal gap", `${provenance.metricId} · ${provenance.rubricVersion} · `
      + `cohort ${provenance.cohortId ?? "unmatched"} · snapshot ${provenance.snapshotId ?? "unknown"} · `
      + `${rows} · ${window}. Recompute from these and compare.`]);
  }
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
export function composeFirstRunResult({
  analysis = null, briefing = null, decision = null, org = null, tasks = null, cohort = null,
} = {}) {
  if (!analysis || typeof analysis !== "object" || !briefing || typeof briefing !== "object") {
    return unavailableResult(FIRST_RUN_UNAVAILABLE.notComposed);
  }
  // Checked before the briefing contract, deliberately. An analysis that read
  // nothing may well produce a briefing with no metric in it — that is the
  // contract working, not a contract failure — and reporting it as "the example
  // came back missing figures" would tell a reader to reload something that ran
  // correctly and found an empty window.
  if (isEmptyAnalysis(analysis)) return emptyResult();
  let validation;
  try {
    validation = validateBriefing(briefing);
  } catch {
    return unavailableResult(FIRST_RUN_UNAVAILABLE.invalidBriefing);
  }
  if (!validation?.valid) {
    return unavailableResult(FIRST_RUN_UNAVAILABLE.invalidBriefing);
  }
  // Every figure this region would print, checked against the range it can take
  // before any of it is drawn. A share of 412% or a negative impact is not a
  // number to format — it is a number to refuse.
  const notices = auditDecisionFigures({
    share: recoverableShare(analysis?.recoverableUsd, analysis?.spendUsd),
    impactUsd: briefing?.materialMetric?.unit === "USD" ? briefing.materialMetric.value : null,
    analyzedUsd: analysis?.spendUsd,
    confidence: decision?.confidence?.score,
    rank: decision?.prioritizedAction?.rank,
  });
  const benchmark = benchmarkSlot(analysis, briefing, notices);
  // A region whose one populated headline is itself unavailable is not a
  // result, and calling it one would be the exact misrepresentation this
  // module exists to prevent.
  if (!benchmark.available) {
    return unavailableResult(noticeFor(notices, "share")
      ? FIRST_RUN_UNAVAILABLE.outOfRange
      : FIRST_RUN_UNAVAILABLE.notComposed);
  }
  const impact = impactSlot(briefing, notices);
  // Resolved once and used twice — the slot and the method entry read the same
  // object, so the sentence a reader checks the finding against cannot drift
  // from the finding.
  const gap = resolveInternalCostGap({ analysis, org, tasks });
  // Resolved once and used twice, exactly like the gap above: the slot a reader
  // sees and the evidence entry they check it against read the same object.
  const literacy = composeFirstRunLiteracy(analysis);
  return Object.freeze({
    ...BASE,
    presentation: FIRST_RUN_STATE.ready,
    notices,
    // The region's own heading is the canonical decision question, not the
    // briefing's headline question. The briefing asks what an analysis says;
    // this region is the page's one complete answer to what a leader arrived
    // to decide, and `finops-decision-contract.js` owns that wording.
    question: DECISION_QUESTION,
    decision,
    answer: answerSlot(decision, benchmark, impact),
    benchmark,
    impact,
    peer: peerSlot(analysis, org, tasks),
    internal: internalSlot(gap, cohort),
    internalGap: gap,
    literacy,
    action: actionSlot(briefing, analysis),
    confidence: confidenceSlot(decision, notices),
    method: methodEntries(analysis, briefing, gap, literacy),
    reason: null,
  });
}

/**
 * True when the analysis ran and found nothing.
 *
 * Both conditions, not either: an empty ranking *and* no analyzed spend. One of
 * the two alone is a partial analysis, which is a result with a caveat rather
 * than an empty one — a window with spend in it but nothing rankable still has
 * a share to state.
 *
 * `rankedDepartments` must actually be an array: an analysis that never
 * produced the field at all is malformed, not empty, and belongs in the
 * unavailable state with the rest of the unreadable input.
 */
function isEmptyAnalysis(analysis) {
  if (!Array.isArray(analysis?.rankedDepartments) || analysis.rankedDepartments.length > 0) return false;
  return Number(analysis?.spendUsd) === 0;
}

/** The part of the region that does not depend on any analysis at all. */
const BASE = Object.freeze({
  version: FIRST_RUN_VERSION,
  label: FIRST_RUN_LABEL,
  sample: SAMPLE_LABEL,
  actions: FIRST_RUN_ACTIONS,
});

function degradedResult(presentation, reason, answerValue) {
  const blank = slot(false, UNAVAILABLE_VALUE, reason);
  return Object.freeze({
    ...BASE,
    presentation,
    notices: Object.freeze([]),
    // The question stands even when the answer does not: a reader who meets
    // this region in its unavailable state should still be able to see what it
    // would have decided.
    question: DECISION_QUESTION,
    decision: null,
    answer: slot(false, answerValue, reason),
    benchmark: blank,
    impact: blank,
    // The peer slot never degrades to the bare word "Unavailable", in any
    // state. A position is either produced or withheld with a sentence that
    // says what is missing, and a composition that failed outright is still a
    // reason a reader can act on.
    peer: bandedSlot(false, "No peer position: this example could not be composed, so there is "
      + "no cost per successful task to place.", reason,
    band(BAND_STATE.withheld, WITHHELD_BAND_LABEL)),
    // Suppressed, not blank, for the same reason: a comparison that was not made
    // is owed the sentence that says so.
    internal: bandedSlot(false, "No internal comparison: this example could not be composed, so no "
      + "department was placed against another.", reason,
    band(BAND_STATE.withheld, WITHHELD_GAP_LABEL)),
    internalGap: null,
    // Same rule as the two above: a grade that could not be produced is owed the
    // sentence saying so, never the bare word "Unavailable" and never a dash.
    literacy: slot(false, LITERACY_UNAVAILABLE.failed, reason),
    action: slot(false, "Recommended action unavailable.", reason),
    confidence: blank,
    method: Object.freeze([Object.freeze({ term: "Limits", detail: reason })]),
    reason,
  });
}

function unavailableResult(reason) {
  return degradedResult(FIRST_RUN_STATE.unavailable, reason,
    "No answer is claimed from this example.");
}

/**
 * The empty state: the analysis ran, and there was nothing in it.
 *
 * Drawn as its own state rather than folded into `unavailable`, because the two
 * ask different things of a reader. Nothing here is red and nothing suggests a
 * retry — the dataset is simply empty, and saying so is the whole answer.
 */
function emptyResult() {
  return degradedResult(FIRST_RUN_STATE.empty, FIRST_RUN_UNAVAILABLE.empty,
    "No spend was recorded in this window, so nothing is recoverable from it.");
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
    // Relabelled once, here, and then used for every block below. The headline
    // benchmark, the literacy corpus's department column, the peer cohort, and
    // the internal gap all read this one object, which is what makes the three
    // blocks of the brief describe one company rather than three.
    const named = nameExampleDepartments(load());
    // ONE RECOVERABLE FIGURE FOR THE PAGE (#1496). The total this region divides
    // and prints is taken from the canonical accessor rather than from the
    // envelope's own field, so the figure here and the one in the answer region
    // at the top of the page are the same derivation and not two that happen to
    // agree. Scored departments only: an envelope carrying an unscored
    // department contributes zero for it here too.
    const recoverable = getRecoverableSpend(named);
    const analysis = Number.isFinite(recoverable.monthly)
      ? Object.freeze({ ...named, recoverableUsd: recoverable.monthly })
      : named;
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
    // The bundled example's own declared cohort attributes and task ledger,
    // read from the seeded sample data rather than from the analysis envelope:
    // the analysis is the reader's file path, and nothing on it declares an
    // organization's size band or industry. An import therefore reaches the
    // peer slot with no declaration and is withheld with the reason that says
    // so, which is the honest answer for a file that never stated either.
    return composeFirstRunResult({
      analysis,
      briefing: buildFinopsBriefing(analysis),
      decision,
      org: EXAMPLE_ORG_COHORT_PROFILE,
      tasks: EXAMPLE_TASK_LEDGER,
      cohort: exampleCohortPosition({ analysis, tasks: EXAMPLE_TASK_LEDGER }),
    });
  } catch {
    return unavailableResult(FIRST_RUN_UNAVAILABLE.failed);
  }
}
