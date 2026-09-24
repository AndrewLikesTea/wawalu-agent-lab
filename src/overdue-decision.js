// The one open decision that has waited past the window (issue #622).
//
// WHAT THIS ANSWERS
// -----------------
// A lead opens the history to browse it. The log is honest but flat: ten rows
// sorted by date, with no answer to "is anything sitting unreviewed?". This
// module answers exactly that, once: which single open decision has waited
// longest past the point it should have been called, how far past it is, who
// owns it, and where to go to settle it.
//
// It selects ONE. A list of everything overdue is a second backlog to triage;
// the log already has filters for that (Decision status: Pending / Proposed).
//
// WHAT "OPEN" MEANS
// -----------------
// The status glossary shipped on the decisions page defines all four words:
//
//   Proposed    Someone wrote it up. The team has not committed to it.
//   Pending     Under review. Waiting on the owner to call it.
//   Accepted    The team committed to it. Build against this one.
//   Superseded  A later decision replaced it. It stays in the log as history.
//
// The first two are unsettled and the last two are settled, so "open" is
// exactly {pending, proposed} — no new vocabulary, and nothing here renders a
// status word that is not in decision-status.js. A decision another decision
// names under Replaces is excluded whatever its status: the log already treats
// those as not-current (that is what the Current only filter hides), and
// chasing a review for a record that has been replaced is noise.
//
// WHAT "WAITED TOO LONG" MEANS, AND THE ASSUMPTION IN IT
// -----------------------------------------------------
// A decision record carries `createdAt` and `status`. It does not carry a
// review date: no shipped form, import, or export field sets one (see
// shiplog-export-schema.js). So the operative rule is the age of the open
// status, measured in whole elapsed days from `createdAt`, against ONE window
// — REVIEW_WINDOW_DAYS — applied to both open statuses.
//
// The rendered copy never names that window with a term of its own: it says
// "still Proposed or Pending after 14 days", in the page's own status words
// plus a number (issue #2507). Nothing a visitor reads here introduces a
// fifth status-like word.
//
// One window, not a ladder per status: a second threshold would be a second
// number nothing in the product can justify. Fourteen days is one sprint
// boundary, which is the interval at which "waiting on the owner to call it"
// stops being waiting and becomes drift. It is an assumption, it is stated in
// the rendered copy rather than hidden in this file, and a caller may override
// it with `reviewWindowDays`.
//
// `reviewBy` is honoured when a record happens to carry one, because a recorded
// review date is better evidence than an inferred window and the issue asks for
// it where applicable. Nothing in the product writes that field today, so this
// is a read, never a requirement: an absent or unparseable value falls back to
// the window rule rather than disqualifying the record.
//
// PURITY
// ------
// No DOM, no storage, no network, and no clock — `options.now` is the only
// instant compared, so the same records produce the same finding in a test and
// in a browser. overdue-decision-view.js renders what this returns.

import { canonicalDecisionStatus } from "./decision-status.js";
import { decisionDetailHref, decisionOwner } from "./releases.js";

const DAY_MS = 86_400_000;

/**
 * The unsettled statuses, in priority order: Pending outranks Proposed because
 * Pending is a decision somebody is actively waiting on the owner to call,
 * while Proposed has not been committed to a reviewer at all. Used both as the
 * membership test and — by index — as the tiebreak rank.
 */
export const OPEN_DECISION_STATUSES = Object.freeze(["pending", "proposed"]);

/** The window every open decision is measured against. See the note above. */
export const REVIEW_WINDOW_DAYS = 14;

/** The three states this finding has. `noneOpen` covers an empty log. */
export const OVERDUE_FINDING_KINDS = Object.freeze({
  overdue: "overdue",
  noneOverdue: "none-overdue",
  noneOpen: "none-open",
});

/** The heading each state carries. The two calm ones do not use urgent words. */
export const OVERDUE_FINDING_HEADINGS = Object.freeze({
  // "Waiting on a decision" is the page's own definition of Pending — "waiting
  // on the owner to call it" — and it is equally true of Proposed. It does not
  // name a fifth status.
  [OVERDUE_FINDING_KINDS.overdue]: "Waiting on a decision",
  [OVERDUE_FINDING_KINDS.noneOverdue]: "Review check",
  [OVERDUE_FINDING_KINDS.noneOpen]: "Review check",
});

/** Shown when a record's title is blank — the record is still openable. */
export const UNTITLED_DECISION = "Untitled decision";

/** The label on the one action, and the sentence that describes where it goes. */
export const OVERDUE_ACTION_LABEL = "Review this decision";

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function days(count) {
  return plural(count, "day");
}

// The threshold, read out the same way everywhere: the two status words the
// page defines, plus a plain number of days. There is no noun for it, because
// every noun this panel tried was a word that appears nowhere else on the site.
function pastWindowPhrase(windowDays) {
  return `still Proposed or Pending after ${days(windowDays)}`;
}

// The status words are capitalised in prose, matching the glossary on the page.
// The badge keeps the stored lowercase form the list rows use.
function statusWord(status) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function referenceMs(now) {
  if (now instanceof Date) return Number.isNaN(now.getTime()) ? null : now.getTime();
  if (typeof now === "number") return Number.isFinite(now) ? now : null;
  if (typeof now === "string") {
    const parsed = Date.parse(now);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function windowOf(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : REVIEW_WINDOW_DAYS;
}

// A review date only if the record actually carries a readable one. Anything
// else — absent, blank, a number, an unparseable string — is not a review date,
// and saying so here is what keeps the window rule the fallback rather than the
// exception.
function recordedReviewMs(decision) {
  const value = decision?.reviewBy;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function title(decision) {
  const value = decision?.title;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : UNTITLED_DECISION;
}

/**
 * How long one decision has been open, the point it should have been reviewed
 * by, and how far past that point the reference instant is.
 *
 * Whole elapsed days throughout, so a record is only ever reported as overdue
 * by a number a reader can count. Overdue means strictly past: a review date
 * reached today is due, not late. Returns null when the age cannot be
 * established — an unreadable `createdAt` or no reference instant — because a
 * record whose age is unknown must not be claimed as late.
 */
export function decisionReviewAge(decision, options = {}) {
  const now = referenceMs(options.now);
  const recordedMs = Date.parse(decision?.createdAt);
  if (now === null || Number.isNaN(recordedMs)) return null;
  const windowDays = windowOf(options.reviewWindowDays);
  const recorded = recordedReviewMs(decision);
  const reviewByMs = recorded ?? recordedMs + windowDays * DAY_MS;
  const daysPast = Math.floor((now - reviewByMs) / DAY_MS);
  return {
    // Which rule produced the review date, so the rendered benchmark can say
    // whether it read a recorded date or applied the window.
    source: recorded === null ? "window" : "recorded",
    windowDays,
    recordedAt: new Date(recordedMs).toISOString(),
    reviewBy: new Date(reviewByMs).toISOString(),
    daysOpen: Math.floor((now - recordedMs) / DAY_MS),
    daysPast,
    overdue: daysPast >= 1,
  };
}

function openStatus(record) {
  const status = canonicalDecisionStatus(record?.status ?? record?.decision?.status);
  return OPEN_DECISION_STATUSES.includes(status) ? status : null;
}

/**
 * The open decisions in a composed history stream, each with its age.
 *
 * Takes the same records the history list renders (toHistoryRecords), so the
 * example badging, the canonical status, and the superseded flag are read from
 * one derivation rather than re-derived here against a second set of rules.
 */
export function openDecisionRecords(records = [], options = {}) {
  return records
    .filter((record) => record?.type === "decision" && record?.superseded !== true && openStatus(record) !== null)
    .map((record) => ({
      record,
      status: openStatus(record),
      age: decisionReviewAge(record.decision ?? record, options),
    }));
}

// Priority, highest first. Four rules, in this order:
//
//   1. Further past its review date first. That is the material benchmark and
//      the issue asks for the single most overdue decision.
//   2. The visitor's own record before an example when their age is equal.
//   3. Pending before Proposed, per OPEN_DECISION_STATUSES.
//   4. Recorded earlier first, then the lower id — so the selection is a total
//      order and cannot depend on input order. Ties by id is the convention
//      shiplog-export-schema.js already uses for records written in the same
//      instant.
function comparePriority(a, b) {
  return b.age.daysPast - a.age.daysPast
    || Number(a.record.example === true) - Number(b.record.example === true)
    || OPEN_DECISION_STATUSES.indexOf(a.status) - OPEN_DECISION_STATUSES.indexOf(b.status)
    || Date.parse(a.age.recordedAt) - Date.parse(b.age.recordedAt)
    || String(a.record.id).localeCompare(String(b.record.id));
}

// The overdue candidates in priority order, highest first. One path, used by
// both exported entry points, so the answer and the count behind it can never
// come from two different orderings. Never mutates the input.
function rankOverdue(open) {
  return open.filter((entry) => entry.age?.overdue === true).sort(comparePriority);
}

/** The single highest-priority overdue decision, or null when none qualifies. */
export function selectOverdueDecision(records = [], options = {}) {
  return rankOverdue(openDecisionRecords(records, options))[0] ?? null;
}

// How far past it is, and against what. The lead already said how long it has
// been open and in which status, so this line states only the comparison.
function benchmarkSentence(entry) {
  const { age } = entry;
  return age.source === "recorded"
    ? `Its recorded review date passed ${days(age.daysPast)} ago.`
    : `It is ${days(age.daysPast)} past the ${days(age.windowDays)} this check allows.`;
}

// Why this one and not another, stated rather than implied. A single candidate
// says so; more than one says how many it was chosen from and on what rule.
//
//
// It does not restate the window: a candidate can be here on its own recorded
// review date instead, and "after 14 days" beside a record five days old would
// contradict the benchmark line above it.
function prioritySentence(entry, overdueCount) {
  if (overdueCount <= 1) return "It is the only decision in this log past the date it should have been called.";
  const from = `Chosen from ${plural(overdueCount, "decision")} past the date they should have been called`;
  return entry.record.example === true
    ? `${from}: the one furthest past. This finding comes from the example records.`
    : `${from}: the one furthest past.`;
}

// The calm states. Neither implies urgency, and neither congratulates: they say
// what was checked, against what, and what would change the answer.
function calmLead(openCount, windowDays) {
  if (openCount === 0) {
    return "Nothing in this log is Proposed or Pending, so no review call is outstanding. "
      + `A decision recorded as Proposed or Pending gets ${days(windowDays)} from its recorded date.`;
  }
  const inside = openCount === 1
    ? `1 decision is Proposed or Pending, and it is inside ${days(windowDays)}.`
    : `${plural(openCount, "decision")} are Proposed or Pending, and none is past ${days(windowDays)}.`;
  return `${inside} Nothing is waiting on a review call.`;
}

// Stated when an open record's date cannot be read, so the count above is never
// quietly presented as covering records it could not judge.
function undatedNote(undatedCount) {
  if (undatedCount === 0) return "";
  return ` ${plural(undatedCount, "Proposed or Pending decision")} carr${undatedCount === 1 ? "ies" : "y"} `
    + "no readable recorded date, so its age could not be checked.";
}

/**
 * The whole finding, as one model a view renders without deciding anything.
 *
 * Always returns a model: the no-overdue result is a state with copy, not an
 * absent panel, because "we checked and nothing is late" is the answer a lead
 * came for as much as the other one is.
 */
export function overdueDecisionFinding(records = [], options = {}) {
  const windowDays = windowOf(options.reviewWindowDays);
  const open = openDecisionRecords(records, { ...options, reviewWindowDays: windowDays });
  const undatedCount = open.filter((entry) => entry.age === null).length;
  const overdue = rankOverdue(open);
  const selected = overdue[0] ?? null;
  const base = {
    windowDays,
    openCount: open.length,
    overdueCount: overdue.length,
    undatedCount,
    decisionId: null,
    example: false,
    age: null,
    meta: [],
    action: null,
  };

  if (!selected) {
    const kind = open.length === 0 ? OVERDUE_FINDING_KINDS.noneOpen : OVERDUE_FINDING_KINDS.noneOverdue;
    return {
      ...base,
      kind,
      heading: OVERDUE_FINDING_HEADINGS[kind],
      // The exact negation of the line the page shows while the check runs, so
      // a reader sees the same question answered rather than a new one.
      lead: `No decision is ${pastWindowPhrase(windowDays)}.`,
      benchmark: `${calmLead(open.length, windowDays)}${undatedNote(undatedCount)}`,
      priority: "",
    };
  }

  const decision = selected.record.decision ?? selected.record;
  const name = title(decision);
  return {
    ...base,
    kind: OVERDUE_FINDING_KINDS.overdue,
    heading: OVERDUE_FINDING_HEADINGS[OVERDUE_FINDING_KINDS.overdue],
    decisionId: selected.record.id,
    example: selected.record.example === true,
    age: selected.age,
    lead: `“${name}” has been ${statusWord(selected.status)} for ${days(selected.age.daysOpen)}.`,
    benchmark: `${benchmarkSentence(selected)}${undatedNote(undatedCount)}`,
    priority: prioritySentence(selected, overdue.length),
    // The three facts the issue asks a reader to be able to act on, in the same
    // Status / Owner / Recorded order and with the same badge token the list
    // rows and the detail page already use for a decision status.
    meta: [
      { label: "Status", value: selected.status, badge: `badge badge-${selected.status}` },
      { label: "Owner", value: decisionOwner(decision) },
      { label: "Recorded", value: selected.age.recordedAt, kind: "date" },
    ],
    action: {
      href: decisionDetailHref(selected.record.id),
      label: OVERDUE_ACTION_LABEL,
      // The accessible name says which decision, because "Review this decision"
      // alone is ambiguous to anyone reading the links out of context.
      name: `${OVERDUE_ACTION_LABEL}: ${name}`,
      target: `Opens the full record for “${name}” — its context, alternatives, owner, and any release it is `
        + "linked to — so the owner can settle it or record the decision that replaces it.",
    },
  };
}
