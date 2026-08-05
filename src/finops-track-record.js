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
 *
 * ONLY REALIZED MONTHS ARE SCORED (#1106). The series this header is handed can
 * hold estimated months as well as imported ones, and every figure below —
 * the count, the span, the movement, the verdict — is computed from
 * `realizedSeries(series)` and never from `series`. The estimates are read once
 * more, separately, for two things that are not figures about the past: their
 * own labelled rows, and the estimate-versus-actual sentence for a month that
 * now holds both.
 */

import {
  canonicalPeriod, formatUsd, monthLabel,
} from "./finops-imported-period-series.js";
import { nextCalendarMonth } from "./commitment-verification.js";
import { scoreCommittedSaving, VERDICT_GRADE } from "./committed-saving-verdict.js";
import {
  briefingSeriesSummary, ENTRY_BASIS, estimatedSeries, realizedSeries,
} from "./finops-briefing-series.js";

/** Named once, so the document, the page entry and the tests agree. */
export const TRACK_RECORD_IDS = Object.freeze({
  region: "finops-track-record",
  question: "finops-track-record-question",
  /** The first estimate-versus-actual sentence; the rest carry the data flag. */
  estimateDelta: "finops-track-record-estimate-delta",
  figure: "finops-track-record-figure",
  verdict: "finops-track-record-verdict",
  context: "finops-track-record-context",
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
      basis: ENTRY_BASIS.imported,
    });
  });
}

/** The word an estimated row is named by, wherever one is printed. */
const ESTIMATE_ROW_NAME = "Estimated · not measured";

/**
 * The estimate rows, built apart from the realized rows and never fed into the
 * movement arithmetic: an estimate has no earlier month of its own to have
 * moved from. Every row says what it is in its own provider cell, so a reader
 * who opens the table meets the word on the row rather than in a legend.
 */
function estimateRowsOf(estimates) {
  return estimates.map((entry) => Object.freeze({
    period: entry.period,
    periodLabel: label(entry.period),
    providerName: ESTIMATE_ROW_NAME,
    spend: formatUsd(entry.spendUsd),
    modelledSaving: formatUsd(entry.recoverableUsd),
    movement: "Not measured",
    verdict: entry.supersededBy ? "Superseded by an import" : "Estimate · not scored",
    basis: ENTRY_BASIS.estimated,
  }));
}

const round = (value) => Math.round(value * 100) / 100;

/**
 * THE ESTIMATE AGAINST THE ACTUAL, one sentence for each month holding both.
 *
 * Direction AND size, in whole USD — the unit every other figure in this header
 * is stated in, so a reader is not asked to hold a percentage beside four
 * dollar figures. "Under" means the estimate was below what the invoice turned
 * out to be. A month holding only one of the two produces no sentence: there is
 * nothing to compare, and a delta against a missing side would be a figure
 * about nothing.
 */
function estimateDeltasOf(estimates, realized) {
  const actual = new Map();
  for (const entry of realized) {
    actual.set(entry.period, (actual.get(entry.period) ?? 0) + entry.spendUsd);
  }
  const lines = [];
  for (const estimate of estimates) {
    if (!actual.has(estimate.period)) continue;
    const measured = actual.get(estimate.period);
    const delta = round(measured - estimate.spendUsd);
    const miss = delta > 0 ? `under by ${formatUsd(delta)}`
      : delta < 0 ? `over by ${formatUsd(-delta)}` : "exact";
    lines.push(`${label(estimate.period)}: the estimate said ${formatUsd(estimate.spendUsd)} and `
      + `the imported month came in at ${formatUsd(measured)} — the estimate was ${miss}.`);
  }
  return Object.freeze(lines);
}

/** How many estimated months are on file, said once for the context line. */
const estimateNote = (estimates) => {
  const count = estimates.length;
  if (count === 0) return "";
  return ` ${count} estimated month${count === 1 ? " is" : "s are"} on file, and `
    + `${count === 1 ? "it counts" : "they count"} towards nothing here until the month is `
    + "imported.";
};

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
  const held = (Array.isArray(series) ? series : []).filter(Boolean);
  // THE ONE FILTER. `entries` is the realized record from here down, and every
  // figure this function computes reads it. The estimates are held separately
  // and reach only the two places named at the top of this file.
  const entries = realizedSeries(held);
  const estimates = estimatedSeries(held);
  const estimateRows = estimateRowsOf(estimates);
  const estimateDeltas = estimateDeltasOf(estimates, entries);
  const { count, label: span } = briefingSeriesSummary(entries);
  const periods = [...new Set(entries.map((entry) => entry.period))].sort();

  if (count === 0) {
    return model({
      state: TRACK_RECORD_STATE.none,
      estimateDeltas,
      rows: estimateRows,
      context: "No track record on file: this browser is keeping no period. Importing one "
        + "provider export keeps the month it covers and starts the record."
        + estimateNote(estimates),
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
      context: `A track record needs a second period. One month is on file — ${label(periods[0])} `
        + "— so there is no movement to measure." + estimateNote(estimates),
      action: { text: "Import a second period", href: IMPORT_ANCHOR },
      rows: [...rowsOf(entries, null), ...estimateRows],
      estimateDeltas,
      summary: span,
    });
  }

  const committedFrom = canonicalPeriod(commitment?.claim?.period);
  if (committedFrom === null) {
    return model({
      state: TRACK_RECORD_STATE.uncommitted,
      context: `${span}. No commitment is stored in this browser, so there is nothing to score `
        + "these months against." + estimateNote(estimates),
      action: { text: "Commit to the next action", href: COMMIT_PAGE },
      rows: [...rowsOf(entries, null), ...estimateRows],
      estimateDeltas,
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
  const rows = [...rowsOf(entries, verdict), ...estimateRows];
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
      verdict: badgeOf(verdict),
      context: `${committed}. ${label(expected)} is not on file, so nothing has been measured `
        + "against it." + estimateNote(estimates),
      action: { text: `Import ${label(expected)} to close out the commitment`, href: IMPORT_ANCHOR },
      rows,
      estimateDeltas,
      summary: span,
    });
  }

  return model({
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
    action: { text: "Commit to the next action", href: COMMIT_PAGE },
    rows,
    estimateDeltas,
    summary: span,
  });
}

const badgeOf = (verdict) => Object.freeze({
  grade: verdict.grade,
  text: GRADE_LABEL[verdict.grade] ?? "Ungraded",
});

const EMPTY = Object.freeze([]);

const model = (fields) => Object.freeze({
  question: TRACK_RECORD_QUESTION,
  figure: null,
  verdict: null,
  rows: [],
  /** One sentence per month holding both an estimate and an import. */
  estimateDeltas: EMPTY,
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
  // The basis is on the row as data as well as in its words: a stylesheet or a
  // test asking "is this row measured" reads one attribute rather than matching
  // prose. No new class and no new rule — the styling budget on this page is
  // spent, and the word in the cell is what a reader actually needs.
  tr.dataset.basis = row.basis ?? ENTRY_BASIS.imported;
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

  // THE ESTIMATE AGAINST THE ACTUAL, outside the disclosure and beside the
  // figure it qualifies (#1106). A month whose estimate missed is exactly the
  // sentence a reader came back for, and one folded into a shut details element
  // is one nobody is read. A month holding only an estimate, or only an import,
  // contributes no node at all.
  for (const [index, sentence] of model_.estimateDeltas.entries()) {
    const line = el(document, "p", "local-lead-basis", sentence);
    if (index === 0) line.id = TRACK_RECORD_IDS.estimateDelta;
    line.dataset.estimateDelta = "true";
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
