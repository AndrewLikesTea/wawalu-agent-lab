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
  ESTIMATE_MISS, briefingSeriesSummary, estimateComparisons, isRealizedEntry, realizedSeries,
} from "./finops-briefing-series.js";

/** Named once, so the document, the page entry and the tests agree. */
export const TRACK_RECORD_IDS = Object.freeze({
  region: "finops-track-record",
  question: "finops-track-record-question",
  figure: "finops-track-record-figure",
  verdict: "finops-track-record-verdict",
  context: "finops-track-record-context",
  estimate: "finops-track-record-estimate",
  action: "finops-track-record-action",
  detail: "finops-track-record-detail",
});

/** The heading. Carried here so a surface cannot quietly retitle the question. */
export const TRACK_RECORD_QUESTION = "Did what we committed to work?";

/** Where the import affordance lives on this page, for the action's target. */
const IMPORT_ANCHOR = "#local-import";
const COMMIT_PAGE = "/savings-commitment.html";

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
    // AN ESTIMATED ROW IS NEVER A MOVEMENT AND NEVER A VERDICT. It reports what
    // it is, in both columns, and it does not seed the movement of the row
    // under it: an estimate a reader made is not a month anything moved from.
    const estimated = !isRealizedEntry(entry);
    const earlier = estimated ? null : previous.get(entry.scope) ?? null;
    if (!estimated) previous.set(entry.scope, entry.spendUsd);
    const moved = earlier === null ? null : earlier - entry.spendUsd;
    return Object.freeze({
      period: entry.period,
      periodLabel: label(entry.period),
      providerName: entry.providerName,
      estimated,
      spend: formatUsd(entry.spendUsd),
      modelledSaving: formatUsd(entry.recoverableUsd),
      movement: estimated ? "Estimated, not measured"
        : moved === null ? "No earlier month on file"
          : moved === 0 ? "Flat"
            : moved > 0 ? `Fell ${formatUsd(moved)}` : `Rose ${formatUsd(-moved)}`,
      verdict: estimated ? (entry.superseded ? "Estimate · superseded by an import"
        : "Estimate · no import for this month yet")
        : entry.period === followUp && verdict ? GRADE_LABEL[verdict.grade] : "Not scored",
    });
  });
}

/**
 * ESTIMATE AGAINST ACTUAL, for the newest month holding both, in one sentence.
 *
 * Direction and size, from the durable entries every time this model is built —
 * the delta is never kept in the DOM or in the record, so it cannot outlive or
 * disagree with the two figures it is derived from. Nothing is said at all
 * until an import for that month has arrived, because until then there is no
 * miss to state.
 */
function estimateSentence(series) {
  const latest = estimateComparisons(series).at(-1);
  if (!latest) return null;
  const against = `${formatUsd(latest.estimatedUsd)} estimated against `
    + `${formatUsd(latest.verifiedUsd)} imported`;
  if (latest.direction === ESTIMATE_MISS.exact) {
    return `Estimate against actual for ${label(latest.period)}: the estimate was exact — ${against}.`;
  }
  return `Estimate against actual for ${label(latest.period)}: the estimate was `
    + `${latest.direction} by ${formatUsd(Math.abs(latest.deltaUsd))} — ${against}.`;
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
 * @param options.series the read shape of `readBriefingSeries`, oldest first.
 * @param options.commitment the newest retained commitment record, or null.
 * @returns a frozen model: `{ state, question, figure, verdict, context,
 *   action, rows, summary }`. `figure` and `verdict` are null in the states
 *   that have no measurement, and the caller renders nothing for them.
 */
export function trackRecordModel({ series, commitment = null } = {}) {
  const all = (Array.isArray(series) ? series : []).filter(Boolean);
  // EVERY FIGURE BELOW IS BUILT FROM `entries`, WHICH IS REALIZED ONLY (#1106).
  // The count, the span, the movement, the scorer's series and the periods the
  // follow-up logic searches all read it, so an estimate cannot enter a figure
  // presented as measured. `all` is used for two things and nothing else: the
  // per-period rows, where an estimate is shown and labelled as one, and the
  // estimate-against-actual sentence.
  const entries = realizedSeries(all);
  const estimate = estimateSentence(all);
  const { count, label: span } = briefingSeriesSummary(entries);
  const periods = [...new Set(entries.map((entry) => entry.period))].sort();

  if (count === 0) {
    return model({
      state: TRACK_RECORD_STATE.none,
      estimate,
      rows: rowsOf(all, null),
      context: "No track record on file: this browser is keeping no period. Importing one "
        + "provider export keeps the month it covers and starts the record."
        // An estimate is on the record but it is not a period: it measures
        // nothing, so it neither starts a track record nor is left unmentioned
        // while a row for it sits under this line.
        + (all.length > 0 ? " An estimate from declared facts is kept below, labelled as an "
          + "estimate; it is not a measurement." : ""),
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
      action: {
        text: "Import a provider export to start the record", href: IMPORT_ANCHOR, named: true,
      },
    });
  }
  if (count === 1) {
    return model({
      state: TRACK_RECORD_STATE.single,
      estimate,
      context: `A track record needs a second period. One month is on file — ${label(periods[0])} `
        + "— so there is no movement to measure.",
      action: { text: "Import a second period", href: IMPORT_ANCHOR },
      rows: rowsOf(all, null),
      summary: span,
    });
  }

  const committedFrom = canonicalPeriod(commitment?.claim?.period);
  if (committedFrom === null) {
    return model({
      state: TRACK_RECORD_STATE.uncommitted,
      estimate,
      context: `${span}. No commitment is stored in this browser, so there is nothing to score `
        + "these months against.",
      action: { text: "Commit to the next action", href: COMMIT_PAGE },
      rows: rowsOf(all, null),
      summary: span,
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
  const rows = rowsOf(all, verdict);
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
    return model({
      state: TRACK_RECORD_STATE.awaiting,
      estimate,
      verdict: badgeOf(verdict),
      context: `${committed}. ${label(expected)} is not on file, so nothing has been measured `
        + "against it.",
      action: { text: `Import ${label(expected)} to close out the commitment`, href: IMPORT_ANCHOR },
      rows,
      summary: span,
    });
  }

  return model({
    state: graded ? TRACK_RECORD_STATE.scored : TRACK_RECORD_STATE.awaiting,
    estimate,
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
    action: { text: "Commit to the next action", href: COMMIT_PAGE },
    rows,
    summary: span,
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
  estimate: null,
  rows: [],
  summary: "",
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
  // The basis is on the row as data, not as a colour: the label a reader needs
  // is in the cells themselves, and this is for a test and a stylesheet.
  tr.dataset.basis = row.estimated ? "estimated" : "verified";
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

  // ESTIMATE AGAINST ACTUAL, IN THE OPEN. A sibling of the disclosure in the
  // page's own basis-line idiom — not a row inside it, and not a class of its
  // own: a reader who was told a number before the invoice arrived is owed the
  // size of the miss without opening anything.
  if (model_.estimate) {
    const line = el(document, "p", "local-lead-basis", model_.estimate);
    line.id = TRACK_RECORD_IDS.estimate;
    nodes.push(line);
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
