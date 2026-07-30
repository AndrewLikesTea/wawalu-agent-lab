// The history's filter state, expressed as the query string that carries it.
//
// THE DEFECT THIS CLOSES. The filters lived only in a JavaScript object inside
// initDecisionLog. A release manager who narrowed the history to "accepted
// decisions owned by Kai, Q2" and pasted the URL into a review sent their
// colleague the *unfiltered* history — the link said nothing about the view it
// came from, and a reload threw the same state away. Only "current only" rode
// in the URL, which meant the page already had two ways of holding a filter.
//
// So the query string is the state, and this module is the only place that
// knows how to read and write it. One canonical parameter name per filter, one
// canonical encoding, and `parse(serialize(state)) === state` for every state
// the controls can produce. app.js keeps a plain object for the render path,
// but it is derived here and written back here; it is not a second copy with
// its own rules.
//
// PARSING IS TOTAL. Everything that reaches this module came off somebody's
// clipboard, so nothing here may throw and nothing may fail closed: an invalid
// status is *no status filter*, not an empty result set for a view that looks
// perfectly valid. Every value is dropped back to its default individually, so
// one bad parameter can never discard the five good ones beside it.

import { DECISION_STATUSES, canonicalDecisionStatus } from "./decision-status.js";

// The record kinds the type filter offers. Held here rather than in app.js
// because the parser is what decides whether a shared `type=` is a value the
// view can carry; app.js re-exports it for its existing callers.
export const RECORD_TYPES = ["all", "decision", "release"];

// One parameter name per filter. Renaming one is a breaking change to every
// link somebody has already shared, so they are short, stable, and listed once.
export const HISTORY_FILTER_PARAMS = Object.freeze({
  query: "q",
  type: "type",
  status: "status",
  owner: "owner",
  from: "from",
  to: "to",
  currentOnly: "current",
});

// The "current only" toggle predates this module and shipped with a spelled-out
// value rather than a boolean. Kept exactly as it was: the links already in
// circulation carry it.
export const CURRENT_ONLY_PARAM = HISTORY_FILTER_PARAMS.currentOnly;
export const CURRENT_ONLY_VALUE = "only";

// The unfiltered view. A filter equal to its default is *absent* from the URL,
// which is what keeps an unfiltered history on the clean base path instead of
// on a path trailed by six empty parameters.
export const DEFAULT_HISTORY_FILTERS = Object.freeze({
  query: "",
  type: "all",
  status: "all",
  owner: "all",
  from: "",
  to: "",
  currentOnly: false,
});

// Serialization order, so the same state always produces the same string and a
// shared link is stable enough to diff by eye.
const FILTER_ORDER = ["query", "type", "status", "owner", "from", "to", "currentOnly"];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A calendar day, or "" for anything that is not one.
 *
 * The pattern check is not enough on its own: `2026-02-31` matches it and
 * `Date.parse` happily rolls it into March. Round-tripping through the parsed
 * date is what rejects a day that does not exist, so an out-of-range value
 * degrades to "no bound" rather than to a silently different one.
 */
export function normalizeFilterDate(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!DATE_PATTERN.test(text)) return "";
  const parsed = Date.parse(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10) === text ? text : "";
}

/**
 * Both bounds of the date window, with an impossible window repaired.
 *
 * An end before the start describes no day at all, and returning an empty
 * result set for it would read as "there are no records in Q2" rather than as
 * "this link is wrong". The start is the bound a reader typed first and the one
 * the summary leads with, so the end is what gets dropped.
 */
export function normalizeHistoryRange(from, to) {
  const start = normalizeFilterDate(from);
  const end = normalizeFilterDate(to);
  if (start && end && end < start) return { from: start, to: "" };
  return { from: start, to: end };
}

// Every status a link may name, folded onto the word the view actually filters
// by: the retired "approved" is still in circulation in older links and older
// exports, and it means "accepted".
function normalizeFilterStatus(value) {
  const status = canonicalDecisionStatus(typeof value === "string" ? value.trim() : "");
  return DECISION_STATUSES.includes(status) ? status : "all";
}

function normalizeFilterType(value) {
  const type = typeof value === "string" ? value.trim() : "";
  return RECORD_TYPES.includes(type) && type !== "all" ? type : "all";
}

function normalizeFilterOwner(value) {
  const owner = typeof value === "string" ? value.trim() : "";
  // An owner nobody has recorded is still a legal filter — it simply matches
  // nothing, exactly as the control would if that person left the log.
  return owner === "" || owner === "all" ? "all" : owner;
}

function normalizeFilterQuery(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The filter state a query string describes.
 *
 * Unknown keys are ignored, a repeated or array-shaped parameter takes its
 * first occurrence (what a browser's own `get` does), and every unusable value
 * falls back to its default. Never throws.
 */
export function parseHistoryFilters(search = "") {
  let params;
  try {
    params = new URLSearchParams(typeof search === "string" ? search : "");
  } catch {
    return { ...DEFAULT_HISTORY_FILTERS };
  }
  const read = (key) => {
    try {
      const value = params.get(HISTORY_FILTER_PARAMS[key]);
      return typeof value === "string" ? value : "";
    } catch {
      return "";
    }
  };
  const range = normalizeHistoryRange(read("from"), read("to"));
  return {
    query: normalizeFilterQuery(read("query")),
    type: normalizeFilterType(read("type")),
    status: normalizeFilterStatus(read("status")),
    owner: normalizeFilterOwner(read("owner")),
    from: range.from,
    to: range.to,
    currentOnly: read("currentOnly") === CURRENT_ONLY_VALUE,
  };
}

/** Every filter value normalized, whatever shape the caller held it in. */
export function normalizeHistoryFilters(filters = {}) {
  const range = normalizeHistoryRange(filters.from, filters.to);
  return {
    query: normalizeFilterQuery(filters.query),
    type: normalizeFilterType(filters.type),
    status: normalizeFilterStatus(filters.status),
    owner: normalizeFilterOwner(filters.owner),
    from: range.from,
    to: range.to,
    currentOnly: filters.currentOnly === true,
  };
}

/**
 * The query string for a filter state: `?q=queue&owner=Kai`, or "" when nothing
 * is filtered.
 *
 * Empty string rather than "?" on purpose — the unfiltered history is the clean
 * base path, and a bare "?" is a different URL that a reader would have to
 * explain.
 */
export function historyFilterSearch(filters = {}) {
  const active = normalizeHistoryFilters(filters);
  const params = new URLSearchParams();
  for (const key of FILTER_ORDER) {
    if (active[key] === DEFAULT_HISTORY_FILTERS[key]) continue;
    params.set(HISTORY_FILTER_PARAMS[key], key === "currentOnly" ? CURRENT_ONLY_VALUE : String(active[key]));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Is any filter active? Drives the summary line's wording and clear-all. */
export function historyFiltersActive(filters = {}) {
  return historyFilterSearch(filters) !== "";
}

// --- the "current only" toggle's own parameter -------------------------------
// Kept as standalone helpers because they rewrite *one* parameter inside an
// arbitrary query string (a release or decision page carries an `id` this must
// not clobber), which is a different job from serializing the whole view.

export function readCurrentOnly(search = "") {
  try {
    return new URLSearchParams(search).get(CURRENT_ONLY_PARAM) === CURRENT_ONLY_VALUE;
  } catch {
    return false;
  }
}

export function currentOnlySearch(search = "", currentOnly = false) {
  const params = new URLSearchParams(search);
  if (currentOnly) params.set(CURRENT_ONLY_PARAM, CURRENT_ONLY_VALUE);
  else params.delete(CURRENT_ONLY_PARAM);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * The path this view lives at, filters included: `/?q=queue&owner=Kai`.
 *
 * The hash is deliberately dropped. It is a deep link to one record
 * (`#decision-<id>`) and carrying it into a *shared* filtered view would open
 * somebody else's browser scrolled at a row the filters may not even list.
 */
export function historyFilterPath(location = {}, filters = {}) {
  return `${location.pathname || "/"}${historyFilterSearch(filters)}`;
}

/**
 * The same view as something a person can paste anywhere.
 *
 * Falls back to the path alone when there is no origin to hang it off (a
 * `file://` document, a test double), which is still a usable link — never an
 * exception, and never the string "undefined/?q=…".
 */
export function absoluteHistoryUrl(location = {}, filters = {}) {
  const path = historyFilterPath(location, filters);
  const origin = typeof location.origin === "string" ? location.origin : "";
  return origin && origin !== "null" ? `${origin}${path}` : path;
}

// --- words -------------------------------------------------------------------

// Dates in the summary and the chips are formatted in UTC against a fixed
// locale: `createdAt` is a UTC instant and the copy around these words is
// English, so a reader and a test see the same "Apr 1" wherever they are.
const DATE_FORMATS = {
  short: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  full: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }),
};

export function formatFilterDate(date, { year = true } = {}) {
  const value = normalizeFilterDate(date);
  if (!value) return "";
  return DATE_FORMATS[year ? "full" : "short"].format(new Date(`${value}T00:00:00.000Z`));
}

const TYPE_WORDS = { decision: "decisions", release: "releases" };
const TYPE_LABELS = { decision: "Decisions", release: "Releases" };

const recordWord = (count) => (count === 1 ? "record" : "records");

/** The window in words: "Apr 1 – Jun 30", "from Apr 1, 2026", "through Jun 30, 2026". */
export function historyDateScope(filters = {}) {
  const { from, to } = normalizeHistoryRange(filters.from, filters.to);
  if (from && to) {
    // The year is stated only when the window crosses one. "Apr 1 – Jun 30" is
    // the reading a person wants from a headline; the chips underneath carry
    // both dates in full for anyone who needs the exact bound.
    const year = from.slice(0, 4) !== to.slice(0, 4);
    return `${formatFilterDate(from, { year })} – ${formatFilterDate(to, { year })}`;
  }
  if (from) return `from ${formatFilterDate(from)}`;
  if (to) return `through ${formatFilterDate(to)}`;
  return "";
}

/**
 * The headline above the results: "7 of 41 records · decisions · Apr 1 – Jun 30".
 *
 * Segments that do not apply are omitted rather than printed empty, so an
 * unfiltered history reads "41 records" and not "41 records · · ".
 */
export function historySummaryLine(visible, total, filters = {}) {
  const active = normalizeHistoryFilters(filters);
  const counted = visible === total
    ? `${total} ${recordWord(total)}`
    : `${visible} of ${total} ${recordWord(total)}`;
  const scope = historyDateScope(active);
  return [counted, TYPE_WORDS[active.type], scope].filter(Boolean).join(" · ");
}

/**
 * One descriptor per active filter, in the order the chips are shown.
 *
 * `label`/`value` are the words on the chip; `remove` is its accessible name,
 * which names the filter it drops. A row of buttons all called "Remove" is a
 * list a screen reader user cannot act on.
 */
export function historyFilterChips(filters = {}) {
  const active = normalizeHistoryFilters(filters);
  const chips = [];
  const add = (key, label, value) => chips.push({
    key,
    label,
    value,
    text: value ? `${label}: ${value}` : label,
    remove: value ? `Remove ${label.toLowerCase()} filter: ${value}` : `Remove filter: ${label}`,
  });
  if (active.query) add("query", "Search", active.query);
  if (active.type !== "all") add("type", "Record type", TYPE_LABELS[active.type]);
  if (active.status !== "all") add("status", "Status", active.status);
  if (active.owner !== "all") add("owner", "Owner", active.owner);
  if (active.from) add("from", "From", formatFilterDate(active.from));
  if (active.to) add("to", "To", formatFilterDate(active.to));
  if (active.currentOnly) add("currentOnly", "Current only", "");
  return chips;
}
