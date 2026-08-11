/**
 * "Did what we committed to work?" — the track-record header (#1091).
 *
 * WHAT THIS IS FOR. /evolution.html opens on a snapshot: where do we stand this
 * month. A reader who has been here before opens it with a different question —
 * the one they left with last time — and the page had no answer to it above the
 * fold. This header is that answer, and it is deliberately FOUR THINGS: one
 * figure, one verdict, one line of context, one action. Not a row of tiles.
 *
 * NOTHING IS SCORED OR PARSED HERE. The grade comes from
 * `scoreCommittedSaving` (#1090) and the months come from `readBriefingSeries`
 * (#1089); this module chooses which of them to show, in which state, and says
 * so in words. If a figure below disagrees with the verdict page, the fix
 * belongs in one of those two modules and not in this one.
 *
 * THE STATES ARE EXHAUSTIVE, AND TWO OF THEM HAVE NO FIGURE AT ALL. A browser
 * holding nothing, and a browser holding one month, cannot express a movement:
 * there is no baseline to move away from. Both of those states say what is
 * missing and what the next import does, and NEITHER renders a figure element —
 * no "0 USD of 0 USD", no placeholder percentage, no empty chart. A zero
 * dressed as a measurement is worse than an absent one, because a reader
 * forwards it.
 *
 * ONE ACTION, DERIVED. The action is a function of the state and nothing else,
 * so two readers in the same state are told the same next thing.
 */

import {
  canonicalPeriod, formatUsd, monthLabel,
} from "./finops-imported-period-series.js";
import { nextCalendarMonth } from "./commitment-verification.js";
import { scoreCommittedSaving, VERDICT_GRADE } from "./committed-saving-verdict.js";
import {
  briefingSeriesSummary, estimateAccuracy, realizedSeriesEntries,
} from "./finops-briefing-series.js";
import { TRACK_RECORD_DECISION_CONTRACT } from "./finops-track-record-contract.js";

/** Named once, so the document, the page entry and the tests agree. */
export const TRACK_RECORD_IDS = Object.freeze({
  region: "finops-track-record",
  question: "finops-track-record-question",
  figure: "finops-track-record-figure",
  verdict: "finops-track-record-verdict",
  context: "finops-track-record-context",
  action: "finops-track-record-action",
  detail: "finops-track-record-detail",
  estimate: "finops-track-record-estimate",
  movement: "finops-track-record-movement",
});

/** The heading. Carried here so a surface cannot quietly retitle the question. */
export const TRACK_RECORD_QUESTION = TRACK_RECORD_DECISION_CONTRACT.views[0].question;

const COMMIT_PAGE = "/savings-commitment.html";

const decisionAction = (name, { named = false } = {}) => Object.freeze({
  text: TRACK_RECORD_DECISION_CONTRACT.actions[name].label,
  href: TRACK_RECORD_DECISION_CONTRACT.actions[name].href,
  code: TRACK_RECORD_DECISION_CONTRACT.actions[name].code,
  named,
});

/**
 * The ONE action for a gap state, read off the contract's ordered list.
 *
 * No branch here decides the priority — the list does, so changing which
 * recovery leads is a change to configuration a reviewer can read whole. Only
 * `portable` carries a precondition; the other two are always reachable, so a
 * state whose list is exhausted still has an action rather than none.
 *
 * `named` is a RENDERING fact, not a contract one: in the empty state the page
 * already ships this exact control as its own primary, and a second copy would
 * spend a tab stop the first screen does not have.
 */
const primaryAction = (state, portableRecordAvailable) => {
  const offered = { portable: portableRecordAvailable, addMonth: true, startFresh: true };
  const order = TRACK_RECORD_DECISION_CONTRACT.returnActions.byState[state] ?? [];
  return decisionAction(order.find((name) => offered[name]) ?? "addMonth",
    { named: state === TRACK_RECORD_STATE.none });
};

const movementUsd = (value) => `${Number(value).toLocaleString("en-US", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})} USD`;

/**
 * Why there is no movement figure, said in the reader's words. Keyed by the
 * refusal the model actually made, so a mixed-books refusal is not reported as
 * a short record — they are different facts with different next actions.
 */
const MOVEMENT_UNAVAILABLE = Object.freeze({
  fewer_than_two_complete_periods:
    "No movement yet: two complete monthly periods are needed to measure one.",
  zero_preceding_cost:
    "No movement percentage: the preceding month's analyzed spend was zero.",
  mixed_provider_scope:
    "No movement figure: more than one provider is on file, and two sets of books do not sum "
    + "into one month. The per-period rows below keep them apart.",
});

/** Any refusal this file has not named yet still reads as the common one. */
const movementRefusal = (reason) =>
  MOVEMENT_UNAVAILABLE[reason] ?? MOVEMENT_UNAVAILABLE.fewer_than_two_complete_periods;

/**
 * Movement on the contract's agreed cost basis. Values remain unrounded in
 * state; only the sentence applies the contract's display rounding.
 */
export function latestCompletePeriodMovement(series) {
  const entries = realizedSeriesEntries(series)
    .filter((entry) => canonicalPeriod(entry?.period) !== null
      && Number.isFinite(entry?.spendUsd))
    .sort((left, right) => left.period.localeCompare(right.period));
  // One monthly period is the whole agreed basis, not one provider row.
  const complete = [...entries.reduce((months, entry) => {
    const spendUsd = (months.get(entry.period)?.spendUsd ?? 0) + entry.spendUsd;
    months.set(entry.period, Object.freeze({ period: entry.period, spendUsd }));
    return months;
  }, new Map()).values()];
  if (complete.length < TRACK_RECORD_DECISION_CONTRACT.metrics.completePeriod.minimumForVerdict) {
    return Object.freeze({ available: false, reason: "fewer_than_two_complete_periods" });
  }
  // The same refusal the commitment scorer makes, for the same reason: summing
  // two providers' months into one figure reports movement in books that were
  // never kept together. The rows behind the disclosure still show each scope.
  if (seriesScopeOf(entries) === "mixed") {
    return Object.freeze({ available: false, reason: "mixed_provider_scope" });
  }
  const preceding = complete.at(-2);
  const latest = complete.at(-1);
  if (preceding.spendUsd === 0) {
    return Object.freeze({ available: false, reason: "zero_preceding_cost", preceding, latest });
  }
  const absoluteChangeUsd = latest.spendUsd - preceding.spendUsd;
  const percentageChange = (absoluteChangeUsd / preceding.spendUsd) * 100;
  const direction = absoluteChangeUsd > 0 ? "rose" : absoluteChangeUsd < 0 ? "fell" : "was flat";
  return Object.freeze({
    available: true, preceding, latest, absoluteChangeUsd, percentageChange,
    statement: absoluteChangeUsd === 0
      ? `Analyzed spend was flat at ${movementUsd(latest.spendUsd)} from ${label(preceding.period)} to ${label(latest.period)}.`
      : `Analyzed spend ${direction} ${movementUsd(Math.abs(absoluteChangeUsd))} (${Math.abs(percentageChange).toFixed(1)}%) from ${label(preceding.period)} to ${label(latest.period)}.`,
  });
}

/**
 * The five states, in the order they are tested. The first three are about the
 * SERIES (is there anything to compare), the last two about the COMMITMENT
 * (is there anything to compare it against).
 */
export const TRACK_RECORD_STATE = Object.freeze({
  none: "no-track-record",
  single: "single-period",
  uncommitted: "uncommitted",
  awaiting: "awaiting-actuals",
  scored: "scored",
});

/** The grade in a reader's words, matching the verdict page's own wording. */
const GRADE_LABEL = Object.freeze({
  [VERDICT_GRADE.met]: "Met",
  [VERDICT_GRADE.partiallyMet]: "Partially met",
  [VERDICT_GRADE.missed]: "Missed",
  [VERDICT_GRADE.notEnoughEvidence]: "Not enough evidence",
});

const label = (period) => monthLabel(period) ?? period ?? "an unnamed month";

/**
 * WHICH BOOKS THIS SERIES IS.
 *
 * The scorer abstains when the series and the commitment were not read under
 * the same scope, and it is right to: months from somebody else's books are not
 * this commitment's months. The retained series is this browser's own imports,
 * which is the `user` dataset every retained commitment is filed under — so
 * that is the scope claimed here, and only while ONE provider is on file.
 * Two providers billing the same months are two sets of books, and "mixed"
 * makes the scorer say so rather than summing them into one figure.
 */
function seriesScopeOf(series) {
  const scopes = [...new Set(series.map((entry) => entry.scope))];
  if (scopes.length === 0) return null;
  return scopes.length === 1 ? "user" : "mixed";
}

/** The month this browser actually has next, not the one the claim wants. */
const firstPeriodAfter = (periods, month) =>
  periods.filter((period) => period > month).sort()[0] ?? null;

/**
 * The per-period rows behind the disclosure.
 *
 * Movement is measured against the previous row IN THE SAME SCOPE, so a series
 * holding two providers never reports one provider's month as a movement in the
 * other's. The first row of each scope has no movement and says so; it is not
 * reported as zero, because "no earlier month" and "spend did not change" are
 * different facts.
 */
function rowsOf(series, verdict) {
  const previous = new Map();
  const followUp = verdict?.provenance?.comparedPeriods?.followUp ?? null;
  return series.map((entry) => {
    const earlier = previous.get(entry.scope) ?? null;
    previous.set(entry.scope, entry.spendUsd);
    const moved = earlier === null ? null : earlier - entry.spendUsd;
    return Object.freeze({
      period: entry.period,
      periodLabel: label(entry.period),
      providerName: entry.providerName,
      spend: formatUsd(entry.spendUsd),
      modelledSaving: formatUsd(entry.recoverableUsd),
      movement: moved === null ? "No earlier month on file"
        : moved === 0 ? "Flat"
          : moved > 0 ? `Fell ${formatUsd(moved)}` : `Rose ${formatUsd(-moved)}`,
      verdict: entry.period === followUp && verdict
        ? GRADE_LABEL[verdict.grade] : "Not scored",
    });
  });
}

/** The figure, only ever built from a graded verdict. */
function figureOf(verdict, committedFrom, followUp) {
  const realized = verdict.realizedSavingUsd;
  const committed = verdict.committedSavingUsd;
  const text = realized < 0
    ? `Spend rose ${formatUsd(-realized)} against ${formatUsd(committed)} committed`
    : `${formatUsd(realized)} realized of ${formatUsd(committed)} committed`;
  return Object.freeze({
    text,
    // One sentence, not two orphaned numbers: what was realized, against what,
    // for which month, measured against which month.
    sentence: realized < 0
      ? `Spend rose ${formatUsd(-realized)} against the ${formatUsd(committed)} monthly saving `
        + `committed for ${label(committedFrom)}, measured against ${label(followUp)}.`
      : `Realized ${formatUsd(realized)} of the ${formatUsd(committed)} monthly saving committed `
        + `for ${label(committedFrom)}, measured against ${label(followUp)}.`,
  });
}

/**
 * The header's whole model, from the series and the stored commitment.
 *
 * ESTIMATED PERIODS ARE FILTERED OUT AT THIS BOUNDARY and nowhere else (#1106).
 * `realizedSeriesEntries` is the only thing below that decides it, so the count,
 * the span, every row, the movement and the commitment verdict are computed from
 * imported figures alone. A declared estimate is a claim about a month, not a
 * measurement of it, and a header that graded a commitment against one would be
 * scoring the reader's own guess. What the estimate does earn is the line the
 * next paragraph builds: once the real figure for its month lands, the miss is
 * stated in words.
 *
 * @param options.series the read shape of `readBriefingSeries`, oldest first.
 * @param options.commitment the newest retained commitment record, or null.
 * @param options.portableRecordAvailable whether THIS SURFACE offers a usable
 *   portable-record import path. Passed in, never sniffed out of a document:
 *   the ordering in `returnActions` turns on it, so a caller that guesses wrong
 *   demotes or promotes every recovery action at once.
 * @returns a frozen model: `{ state, question, figure, verdict, context,
 *   action, rows, summary, estimateDelta, movement }`. `figure` and `verdict`
 *   are null in the states that have no measurement, and the caller renders
 *   nothing for them; `estimateDelta` is "" when no period holds both an
 *   estimate and an import; `movement` carries `available: false` and a reason
 *   whenever the contract's basis refuses a figure.
 */
export function trackRecordModel({ series, commitment = null, portableRecordAvailable = false } = {}) {
  const held = (Array.isArray(series) ? series : []).filter(Boolean);
  const entries = realizedSeriesEntries(held);
  // Prepared here, rendered as-is: one sentence per period that was both
  // predicted and then billed, in period order.
  const estimateDelta = estimateAccuracy(held).map((scored) => scored.sentence).join(" ");
  const built = (fields) => model({ estimateDelta, ...fields });
  const { label: span } = briefingSeriesSummary(entries);
  const periods = [...new Set(entries.map((entry) => entry.period))].sort();
  const movement = latestCompletePeriodMovement(entries);

  if (periods.length === 0) {
    return built({
      state: TRACK_RECORD_STATE.none,
      context: "No track record on file: this browser is keeping no period. Importing one "
        + "provider export keeps the month it covers and starts the record.",
      // NAMED, NOT DUPLICATED. The next action for a browser keeping nothing is
      // the import choice the first screen already ships as its own primary
      // control. A second copy of it above that control does not give a reader
      // a second way in: it competes with the primary at the same weight, and
      // it puts one more tab stop between the skip link's destination and the
      // action a keyboard reader came for — a budget
      // tests/finops-pre-analysis-empty-state.test.js holds the first screen
      // to. So this state names the step in the sentence above and renders no
      // control, which leaves exactly one action on that screen rather than
      // two. Every other state renders its action, because by then this header
      // owns the most prioritized next step on the page.
      //
      // AND IT IS `Start fresh`, NOT THE PORTABLE RECORD: a browser keeping
      // nothing has no gap to fill from a record it is already carrying, so the
      // contract lists exactly one path for this state. Prioritizing an import
      // here would put a recovery in front of a reader who has nothing to
      // recover — and would spend the tab stop the note above is about.
      action: primaryAction(TRACK_RECORD_STATE.none, portableRecordAvailable),
      movement,
    });
  }
  if (periods.length === 1) {
    return built({
      state: TRACK_RECORD_STATE.single,
      context: `A track record needs a second period. One month is on file — ${label(periods[0])} `
        + "— so there is no movement to measure.",
      // A retained period with insufficient evidence: the portable record leads.
      action: primaryAction(TRACK_RECORD_STATE.single, portableRecordAvailable),
      rows: rowsOf(entries, null),
      summary: span,
      movement,
    });
  }

  const committedFrom = canonicalPeriod(commitment?.claim?.period);
  if (committedFrom === null) {
    return built({
      state: TRACK_RECORD_STATE.uncommitted,
      context: `${span}. No commitment is stored in this browser, so there is nothing to score `
        + "these months against.",
      action: { text: "Commit to the next action", href: COMMIT_PAGE },
      rows: rowsOf(entries, null),
      summary: span,
      movement,
    });
  }

  const followUp = firstPeriodAfter(periods, committedFrom);
  const verdict = scoreCommittedSaving({
    series: entries,
    commitment,
    seriesScope: seriesScopeOf(entries),
    followUpPeriod: followUp,
  });
  const expected = nextCalendarMonth(committedFrom);
  const rows = rowsOf(entries, verdict);
  const graded = verdict.grade !== VERDICT_GRADE.notEnoughEvidence;

  // The commitment is still open: the month that would close it has not been
  // imported. Named as the one action, because it is the only thing that can
  // turn this header into a grade.
  if (!graded && !periods.includes(expected)) {
    // Never `formatUsd(null)`: a commitment whose saving figure could not be
    // read says so, rather than reporting a committed 0 USD nobody committed.
    const committed = verdict.committedSavingUsd === null
      ? `A commitment is stored for ${label(committedFrom)}, but its saving figure could not be read`
      : `${formatUsd(verdict.committedSavingUsd)} a month was committed for ${label(committedFrom)}`;
    return built({
      state: TRACK_RECORD_STATE.awaiting,
      verdict: badgeOf(verdict),
      context: `${committed}. ${label(expected)} is not on file, so nothing has been measured `
        + "against it.",
      action: primaryAction(TRACK_RECORD_STATE.awaiting, portableRecordAvailable),
      rows,
      summary: span,
      // The closing month is missing, not the whole record: the months that ARE
      // on file still moved, and the line below the context says by how much.
      movement,
    });
  }

  return built({
    state: graded ? TRACK_RECORD_STATE.scored : TRACK_RECORD_STATE.awaiting,
    figure: graded ? figureOf(verdict, committedFrom, verdict.provenance.comparedPeriods.followUp)
      : null,
    verdict: badgeOf(verdict),
    context: graded
      ? `${label(committedFrom)} to ${label(verdict.provenance.comparedPeriods.followUp)}, `
        + `scored against the commitment kept in this browser · ${span}.`
      // Ungraded with the closing month on file: the scorer refused for a reason
      // of its own — the wrong books, an unreadable claim — and it states that
      // reason in full on the commitment page. One line here, and the page that
      // owns the refusal is one link away rather than paraphrased badly.
      : `${span}. These months were not scored against the commitment on file; the commitment `
        + "page names the check that refused.",
    action: graded
      ? { text: "Commit to the next action", href: COMMIT_PAGE }
      : primaryAction(TRACK_RECORD_STATE.awaiting, portableRecordAvailable),
    rows,
    summary: span,
    movement,
  });
}

const badgeOf = (verdict) => Object.freeze({
  grade: verdict.grade,
  text: GRADE_LABEL[verdict.grade] ?? "Ungraded",
});

const model = (fields) => Object.freeze({
  question: TRACK_RECORD_QUESTION,
  figure: null,
  verdict: null,
  rows: [],
  summary: "",
  estimateDelta: "",
  movement: Object.freeze({ available: false, reason: "fewer_than_two_complete_periods" }),
  ...fields,
});

/* --------------------------------- rendering ------------------------------- */

function el(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** One row of the disclosure's table, as text in five cells. */
function rowNode(document, row) {
  const tr = el(document, "tr", "track-record-row");
  const head = el(document, "th", undefined, `${row.periodLabel} · ${row.providerName}`);
  head.setAttribute("scope", "row");
  tr.append(head,
    el(document, "td", undefined, row.spend),
    el(document, "td", undefined, row.modelledSaving),
    el(document, "td", undefined, row.movement),
    el(document, "td", undefined, row.verdict));
  return tr;
}

const HEADINGS = ["Period", "Spend", "Modelled saving", "Realized movement", "Verdict"];

/**
 * The per-period working, collapsed.
 *
 * The summary names what it reveals AND how many periods, so a reader deciding
 * whether to open it knows what is behind it. Nothing above it is inside it:
 * see the note on `renderTrackRecord`.
 */
function detailNode(document, model_) {
  const details = el(document, "details", "local-lead-detail");
  details.id = TRACK_RECORD_IDS.detail;
  const periods = model_.rows.length;
  details.append(el(document, "summary", undefined,
    `Show each period: spend, modelled saving, realized movement and verdict `
    + `(${periods} period${periods === 1 ? "" : "s"})`));

  const wrap = el(document, "div", "table-wrap");
  const table = el(document, "table", "finops-table");
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const heading of HEADINGS) {
    const cell = el(document, "th", undefined, heading);
    cell.setAttribute("scope", "col");
    headRow.append(cell);
  }
  head.append(headRow);
  const body = document.createElement("tbody");
  for (const row of model_.rows) body.append(rowNode(document, row));
  table.append(head, body);
  wrap.append(table);
  details.append(wrap);
  return details;
}

/**
 * Paint the header into the region the document already ships.
 *
 * THE FIGURE, THE BADGE AND THE ACTION ARE SIBLINGS OF THE DISCLOSURE, never
 * descendants of it. A grade folded into a collapsed disclosure is a grade
 * nobody is told about, and a test harness that reads text through a closed
 * disclosure will not notice — which is why the structure, not the text, is
 * what the tests hold.
 *
 * Every string is inserted as text. This region composes nothing from markup.
 */
export function renderTrackRecord(document, model_) {
  const region = document.getElementById(TRACK_RECORD_IDS.region);
  if (!region) return null;
  region.dataset.state = model_.state;

  const heading = el(document, "h2", "track-record-question", model_.question);
  heading.id = TRACK_RECORD_IDS.question;
  const nodes = [heading];

  if (model_.figure) {
    const figure = el(document, "p", "local-lead-metric", model_.figure.text);
    figure.id = TRACK_RECORD_IDS.figure;
    figure.setAttribute("aria-label", model_.figure.sentence);
    nodes.push(figure);
  }
  if (model_.verdict) {
    const line = el(document, "p", "local-lead-grade");
    const chip = el(document, "span", "local-lead-grade-chip", model_.verdict.text);
    chip.id = TRACK_RECORD_IDS.verdict;
    chip.dataset.grade = model_.verdict.grade;
    line.append(chip);
    nodes.push(line);
  }

  const context = el(document, "p", "local-lead-basis", model_.context);
  context.id = TRACK_RECORD_IDS.context;
  nodes.push(context);

  // The contract's second question, under the first. Skipped only in the empty
  // state: "no movement yet" beside "no track record on file" is the same fact
  // twice, and the first screen leads with the worked decision rather than two
  // lines about a file nobody has brought.
  if (model_.state !== TRACK_RECORD_STATE.none) {
    const movement = el(document, "p", "local-lead-basis", model_.movement.available
      ? model_.movement.statement
      : movementRefusal(model_.movement.reason));
    movement.id = TRACK_RECORD_IDS.movement;
    nodes.push(movement);
  }

  // The estimate against the bill (#1106). TEXT, NOT A CONTROL: the first
  // screen's tab order is a budget another test holds, and this line is
  // something to read rather than somewhere to go. It reuses the basis class
  // above it, so no rule is added to a stylesheet with no room for one, and it
  // is a sibling of the disclosure rather than inside it — a miss folded into a
  // collapsed disclosure is a miss nobody is told about.
  if (model_.estimateDelta) {
    const estimate = el(document, "p", "local-lead-basis", model_.estimateDelta);
    estimate.id = TRACK_RECORD_IDS.estimate;
    nodes.push(estimate);
  }

  // Exactly one control, in the page's own action idiom: a link a keyboard
  // reader reaches in the tab order without opening anything first. An action
  // flagged `named` is one the first screen already offers as its own primary
  // control, and this header states it in the context line above instead — see
  // the note on the `none` state.
  if (!model_.action.named) {
    const action = el(document, "a", "secondary-button", model_.action.text);
    action.id = TRACK_RECORD_IDS.action;
    action.setAttribute("href", model_.action.href);
    action.dataset.trackRecordAction = "true";
    nodes.push(action);
  }

  if (model_.rows.length > 0) nodes.push(detailNode(document, model_));
  region.replaceChildren(...nodes);
  return region;
}

/* ------------------------- which block is met first ------------------------ */

/** The bundled worked decision this page already ships, and the region with the h1. */
const WORKED_DECISION_ID = "finops-first-run";
const HERO_ID = "finops-hero";

/** The authored slot of a block that moves — parent AND position — kept per node. */
const authoredHome = new WeakMap();

const slotAfter = (node) => {
  const kin = [...(node.parentNode?.children ?? [])];
  return kin[kin.indexOf(node) + 1] ?? null;
};

const rememberHome = (node) => {
  if (!authoredHome.has(node)) {
    authoredHome.set(node, { parent: node.parentNode, before: slotAfter(node) });
  }
};

/** One of these blocks moves within its own parent, so the position is checked too. */
const sendHome = (node) => {
  const home = authoredHome.get(node);
  if (!home?.parent) return;
  if (node.parentNode === home.parent && slotAfter(node) === home.before) return;
  home.parent.insertBefore(node,
    home.before?.parentNode === home.parent ? home.before : null);
};

/**
 * WHAT A FIRST VISIT MEETS FIRST (#1112).
 *
 * A reader arriving on the homepage's claim that a worked decision is already
 * computed here met this header's EMPTIEST state first: an answer about a file
 * nobody had asked them to bring. So while this browser keeps no period, both
 * blocks move under the region holding the page's h1 — the worked decision, then
 * this header directly below it, reading as an invitation under a result rather
 * than in place of one. Both move back the moment a period is on file.
 *
 * THE STATE IS NOT RECOMPUTED HERE: it is the model's own `none`, the predicate
 * that wrote the sentence in the region. One storage read, no second opinion.
 *
 * ONE SET OF NODES, MOVED — not two authored copies toggled by `hidden`, which
 * would double this page's bytes and read its "bundled synthetic example" label
 * out twice. A real DOM move keeps screen-reader order and visual order equal,
 * folds nothing into a disclosure, and needs no rule in a full stylesheet.
 */
export function leadWithWorkedDecision(document, model_) {
  const region = document.getElementById(TRACK_RECORD_IDS.region);
  const worked = document.getElementById(WORKED_DECISION_ID);
  const hero = document.getElementById(HERO_ID);
  if (!region || !worked || !hero?.parentNode) return null;
  rememberHome(worked);
  rememberHome(region);
  if (model_.state !== TRACK_RECORD_STATE.none) {
    sendHome(worked);
    sendHome(region);
    return region;
  }
  hero.parentNode.insertBefore(worked, slotAfter(hero));
  hero.parentNode.insertBefore(region, slotAfter(worked));
  return worked;
}
