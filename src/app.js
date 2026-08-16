import {
  DECISION_ENTRY_FIELDS,
  DECISION_ENTRY_LIMITS,
  decisionEntrySummary,
  decisionRecordedSummary,
  validateDecision,
  validateDecisionEntry,
} from "./decision-entry.js";
import {
  DECISION_BACKING_CHECKS,
  DECISION_BACKING_LABELS,
  scoreDecisionBacking,
} from "./decision-backing.js";
import { STORED_DECISION_STATUSES, canonicalDecisionStatus } from "./decision-status.js";
import { dedupeById } from "./demo-data.js";
import {
  DEFAULT_HISTORY_FILTERS,
  RECORD_TYPES,
  absoluteHistoryUrl,
  currentOnlySearch,
  historyFilterChips,
  historyFilterPath,
  historyFilterSearch,
  normalizeHistoryRange,
  parseHistoryFilters,
  readCurrentOnly,
} from "./history-filters.js";
import { copyHistoryLink, renderHistoryFilterChips, renderHistorySummary } from "./history-filter-view.js";
import { renderHistoryTrend } from "./history-trend-view.js";
import { publishHistoryScope } from "./history-scope.js";
import { initDeploymentStatus } from "./deployment-status-view.js";
import { initLeadCapture } from "./lead-capture.js";
import { retentionDeclined, retentionRefusal } from "./local-retention.js";
import { recordsChanged } from "./shiplog-records.js";
import { overdueDecisionFinding } from "./overdue-decision.js";
import { renderOverdueFinding } from "./overdue-decision-view.js";
import { EXAMPLE_LABEL, SAMPLE_RELEASE_ID, SEED_DECISIONS, SEED_RELEASES } from "./seed-records.js";
import {
  SUPERSEDE_ERRORS,
  formatSupersedeSummary,
  indexSupersessions,
  normalizeSupersedes,
  validateSupersedes,
} from "./supersede.js";
import {
  decisionDetailHref,
  indexById,
  loadReleases,
  mountReleaseList,
  releaseDescription,
  releaseDetailHref,
  releaseOwner,
  releaseStatus,
  releaseTitle,
  OPEN_DECISION_KINDS,
  releaseDecisionFollowUp,
  renderReleaseListState,
  resolveRelease,
  statusSummaryText,
} from "./releases.js";
import { shippedState } from "./shipped-releases.js";

export const STORAGE_KEY = "shiplog.decisions.v1";
// Every value a stored or imported record may carry. The words a visitor reads
// are DECISION_STATUSES; "approved" survives here only so an existing local log
// and its release associations are not lost, and it renders as "accepted".
export const STATUSES = STORED_DECISION_STATUSES;

// Sort strategies keyed by the value emitted by the sort <select>. Each entry is
// a pure comparator so the ordering stays testable without a DOM. Ties fall back
// to newest-first, and JS sort stability preserves input order beyond that.
export const SORTS = {
  newest: {
    label: "Newest first",
    compare: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  },
  title: {
    label: "Title (A–Z)",
    compare: (a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
      || Date.parse(b.createdAt) - Date.parse(a.createdAt),
  },
  owner: {
    label: "Owner (A–Z)",
    compare: (a, b) =>
      a.owner.localeCompare(b.owner, undefined, { sensitivity: "base" })
      || Date.parse(b.createdAt) - Date.parse(a.createdAt),
  },
};

// Default view: newest first. This matches the existing prepend behaviour and is
// the conventional ordering for a decision log. (Tradeoff: PRODUCT asks to browse
// "history"; we treat the newest entry as the top of that history rather than
// oldest-first, and expose the other orderings through the sort control.)
export const DEFAULT_SORT = "newest";

// Mirror the form's maxlength attributes so entries written straight into
// storage (bypassing the form) are bounded the same way before rendering.
//
// Read from decision-entry.js rather than declared twice: the recorder tells a
// visitor which field is too long and needs the same numbers this module
// enforces. The names stay, because shiplog-import.js and the FinOps commitment
// path import them from here.
export const MAX_TITLE_LENGTH = DECISION_ENTRY_LIMITS.title;
export const MAX_CONTEXT_LENGTH = DECISION_ENTRY_LIMITS.context;
export const MAX_ALTERNATIVES_LENGTH = DECISION_ENTRY_LIMITS.alternatives;
export const MAX_OWNER_LENGTH = DECISION_ENTRY_LIMITS.owner;

function isDecision(value) {
  return value !== null
    && typeof value === "object"
    && typeof value.id === "string"
    && typeof value.title === "string" && value.title.trim() !== ""
    && value.title.length <= MAX_TITLE_LENGTH
    && typeof value.context === "string" && value.context.trim() !== ""
    && value.context.length <= MAX_CONTEXT_LENGTH
    && (value.alternatives === undefined
      || (typeof value.alternatives === "string" && value.alternatives.length <= MAX_ALTERNATIVES_LENGTH))
    && typeof value.owner === "string" && value.owner.trim() !== ""
    && value.owner.length <= MAX_OWNER_LENGTH
    && STATUSES.includes(value.status)
    // The supersede link is optional, but a stored self-reference is not a
    // decision we will render: it would claim to replace itself.
    && (value.supersedes === undefined
      || (typeof value.supersedes === "string" && normalizeSupersedes(value.supersedes) !== value.id))
    && typeof value.createdAt === "string"
    && !Number.isNaN(Date.parse(value.createdAt));
}

export function loadDecisions(storage) {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter(isDecision) : [];
  } catch {
    return [];
  }
}

/**
 * Write the decision store, unless this browser has been told not to keep one.
 *
 * The refusal is an explicit choice made on /workspace.html and nowhere else: a
 * browser with no stored choice keeps retaining, exactly as it did before that
 * page existed. The thrown error is the same shape a full or disabled store
 * already produces, so every existing caller's failure path carries it — the
 * decision stays on screen for this session and the notice says it was not kept.
 */
export function saveDecisions(storage, decisions) {
  if (retentionDeclined(storage)) throw retentionRefusal();
  storage.setItem(STORAGE_KEY, JSON.stringify(decisions));
}

export function createDecision(values, options = {}) {
  const title = String(values.title ?? "").trim();
  const context = String(values.context ?? "").trim();
  const alternatives = String(values.alternatives ?? "").trim();
  const owner = String(values.owner ?? "").trim();
  const status = String(values.status ?? "");

  // The write path asks the same validator the recorder asks, and refuses on the
  // same answer. It used to carry its own two sentences — "a decision requires a
  // title…" and "a field exceeds its maximum length" — which named neither the
  // field nor the number, and which no visitor was ever shown. Now a caller that
  // bypasses the form (an importer, a console, a future surface) is refused with
  // the exact string the form prints beside the offending field, so a record
  // cannot be persisted in a state the form would have rejected.
  const { ok, failures } = validateDecision(
    { title, context, alternatives, owner, status },
    { statuses: STATUSES },
  );
  if (!ok) throw new TypeError(failures[0].message);

  const id = options.id ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const supersedes = normalizeSupersedes(values.supersedes);
  // The link is checked against the decisions that exist right now, so a self
  // reference or a deleted target is refused here instead of being written and
  // discovered later as a dangling reference. The caller surfaces the message.
  const supersedesError = validateSupersedes(supersedes, { id, decisions: options.decisions ?? [] });
  if (supersedesError) throw new TypeError(supersedesError);

  const decision = {
    id,
    title,
    context,
    alternatives,
    owner,
    status,
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
  // Only written when there is a link: an absent field and an empty string are
  // the same state, and one of them is not worth storing on every record.
  if (supersedes) decision.supersedes = supersedes;
  return decision;
}

// Distinct owners, case-insensitively sorted, for populating the owner filter.
export function uniqueOwners(decisions) {
  return [...new Set(decisions.map((decision) => decision.owner))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

// The history stream holds two record kinds. Normalizing them into one shape —
// title, owner, createdAt, status, searchable text — keeps a single filter and
// sort path for both, so the existing comparators keep working unchanged and a
// release can never fall through a decision-shaped code path.
//
// Declared in history-filters.js, because the query-string parser is what has
// to decide whether a shared `type=` names a record kind this view can render.
// Re-exported here for the callers that have always read it from this module.
export { RECORD_TYPES };

// The wording each row uses for its counterparts, and what it says when there
// are none. Held here so the copy is pinned by a test instead of being spelled
// out twice in two row renderers that could drift apart.
//
// The two labels are deliberately different words, and neither repeats the
// release card's own "Linked decisions" count line — that line summarises
// (`2 decisions · 1 accepted`), this one names and opens them.
//
// A release with no associations has `empty: null`: its card already says "No
// linked decisions", so a second line saying the same thing is noise. A
// decision's row has nothing else to say it, so it gets the note.
//
// `unresolved` is a different sentence on purpose, and only a decision has one.
// "Not yet shipped" is a fact about the work; a release record that names this
// decision and cannot be read is a fact about the log. Reading the second as the
// first would tell someone their decision never shipped when what actually
// happened is that the evidence went missing, so the two never share wording.
export const RELATIONSHIP_COPY = {
  decision: {
    label: "Shipped in",
    empty: "Not yet shipped",
    unresolved: "Shipped releases could not be read",
  },
  release: { label: "Decisions in this release", empty: null },
};

// Said on a counterpart the current filters have removed from the list. The
// relationship is a property of the records, not of the view, so a filter
// changes what is listed and never what a row knows — but a link that points at
// a row a visitor cannot see has to say so.
export const HIDDEN_LINK_NOTE = "· not in this view";

// Which releases carry each decision, built once per composition rather than
// re-scanned per row. Releases already resolve their decisions (resolveRelease);
// this is the same association read from the other side, so a decision row can
// name its releases even when the release rows are filtered away.
function indexReleasesByDecision(releases) {
  const index = new Map();
  for (const release of releases) {
    for (const id of release.decisionIds ?? []) {
      const carried = index.get(id);
      if (!carried) index.set(id, [release]);
      // A release that names the same decision twice is one association, not
      // two: the row would otherwise repeat the link.
      else if (!carried.includes(release)) carried.push(release);
    }
  }
  return index;
}

export function toHistoryRecords(decisions = [], releases = [], options = {}) {
  const byId = indexById(decisions);
  const releasesByDecision = indexReleasesByDecision(releases);
  // Derived once per composition rather than per row, and only here: rows carry
  // the answer, they never re-derive it. Which records are examples is decided
  // by the caller that composed the stream, so a row never has to guess from an
  // id shape that a visitor could also produce.
  const exampleIds = options.exampleIds instanceof Set ? options.exampleIds : new Set(options.exampleIds ?? []);
  const { supersededBy } = indexSupersessions(decisions);
  return [
    ...decisions.map((decision) => {
      // What shipped this decision, read off the releases that name it. The
      // shared rule (shipped-releases.js) decides which of them can be named and
      // routed to, so a row and the decision detail page never disagree about
      // the same records, and the three states — shipped, not yet, unreadable —
      // are settled here rather than inferred from a length in the renderer.
      const shipped = shippedState(releasesByDecision.get(decision.id) ?? []);
      return {
        type: "decision",
        id: decision.id,
        example: exampleIds.has(decision.id),
        title: decision.title,
        owner: decision.owner,
        createdAt: decision.createdAt,
        // The word the row shows and the filter compares against, which is the
        // stored value except for the legacy "approved" (read as "accepted").
        status: canonicalDecisionStatus(decision.status),
        superseded: supersededBy.has(decision.id),
        searchable: [decision.title, decision.context, decision.alternatives],
        // The releases that carried it, in composition order, as the same link
        // shape a release uses for its decisions.
        links: shipped.entries.map((entry) => ({
          type: "release",
          id: entry.id,
          label: entry.version,
          href: entry.href,
          missing: false,
        })),
        shipped,
        decision,
      };
    }),
    ...releases.map((release) => {
      const resolved = resolveRelease(release, byId);
      return {
        type: "release",
        id: release.id,
        example: exampleIds.has(release.id),
        title: releaseTitle(release),
        owner: releaseOwner(release),
        createdAt: release.createdAt,
        status: releaseStatus(release),
        searchable: [
          releaseTitle(release),
          release.version,
          releaseDescription(release),
          ...resolved.decisions.map((decision) => decision.title),
        ],
        superseded: false,
        // Association order is preserved, and a dangling reference is carried
        // as a named-but-unopenable link rather than dropped: a release that
        // lost a decision is history the row must not quietly rewrite.
        links: resolved.associations.map(({ id, decision, missing }) => ({
          type: "decision",
          id,
          label: missing ? "Unavailable decision" : decision.title,
          href: missing ? "" : decisionDetailHref(id),
          missing,
        })),
        release: resolved,
      };
    }),
  ];
}

// Pure view derivation over the whole history: filter by record type, decision
// status, owner, and search, then sort. Never mutates the input array, and an
// unknown type/status/sort value degrades gracefully to the default.
//
// Status coupling (single rule, applied here and mirrored by the control state
// in initDecisionLog): a decision status can only describe a decision, so an
// active status narrows the stream to decisions even while the type filter says
// "all records". The status control itself is disabled — and reset to "all" —
// whenever the type filter is set to releases, where it could never match.
//
// Example ordering (single rule, applied here): the visitor's own records come
// first and the examples follow, whatever the chosen sort. The sort still
// orders within each group. A real record is a visitor's own work and must
// never be pushed below the fold by demo data that is newer or alphabetically
// earlier; a stream with no examples in it is unaffected.
//
// Date range (single rule, applied here): `from`/`to` are calendar days read in
// UTC, both inclusive, compared against the record's `createdAt` instant. A day
// that does not exist and an end before the start are not filters — they are a
// mistyped or hand-edited link — so they degrade to "no bound" rather than to an
// empty result set for a window a reader believes they asked for.
export function selectHistory(records, view = {}) {
  const { owner = "all", sort = DEFAULT_SORT } = view;
  const releaseId = typeof view.releaseId === "string" && view.releaseId.trim() !== "" ? view.releaseId : "all";
  const type = RECORD_TYPES.includes(view.type) ? view.type : "all";
  const status = STATUSES.includes(view.status) ? canonicalDecisionStatus(view.status) : "all";
  const query = typeof view.query === "string" ? view.query.trim().toLocaleLowerCase() : "";
  const { from, to } = normalizeHistoryRange(view.from, view.to);
  const after = from ? Date.parse(`${from}T00:00:00.000Z`) : null;
  const before = to ? Date.parse(`${to}T23:59:59.999Z`) : null;
  const compare = (SORTS[sort] ?? SORTS[DEFAULT_SORT]).compare;
  return records
    .filter((record) => {
      if (after !== null || before !== null) {
        const at = Date.parse(record.createdAt);
        if (Number.isNaN(at)) return false;
        if (after !== null && at < after) return false;
        if (before !== null && at > before) return false;
      }
      // "Current only" removes exactly the decisions another decision replaced.
      // A release is never superseded, so it is never removed by this filter.
      if (view.currentOnly === true && record.superseded === true) return false;
      // A release selection answers “which decisions did this release carry?”;
      // the release row itself is context, not one of those decisions. `links`
      // is optional on a hand-built record, as everywhere else that reads it.
      if (releaseId !== "all" && (record.type !== "decision"
        || !(record.links ?? []).some((link) => link.type === "release" && link.id === releaseId))) return false;
      if (type !== "all" && record.type !== type) return false;
      if (status !== "all" && (record.type !== "decision" || record.status !== status)) return false;
      if (owner !== "all" && record.owner !== owner) return false;
      return !query || record.searchable
        .some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(query));
    })
    .sort((a, b) => Number(a.example === true) - Number(b.example === true) || compare(a, b));
}

// Every filter's state survives a reload now, because a link to a filtered
// history is worth sharing — see history-filters.js, which owns the parameter
// names and the encoding. These two re-exports are the "current only" toggle's
// own helpers, which rewrite that one parameter inside an arbitrary query
// string so a page carrying an `id` keeps it.
export { CURRENT_ONLY_PARAM, CURRENT_ONLY_VALUE } from "./history-filters.js";
export { currentOnlySearch, readCurrentOnly };

// States the active filter and what it removed. Empty while the filter is off:
// there is nothing hidden to account for.
export function supersedeFilterSummary(records, view = {}) {
  if (view.currentOnly !== true) return "";
  const current = selectHistory(records, view).length;
  const total = selectHistory(records, { ...view, currentOnly: false }).length;
  return formatSupersedeSummary(current, total - current);
}

// Decision-only view derivation, expressed through the shared history selector
// so both paths cannot drift apart.
export function selectDecisions(decisions, view = {}) {
  return selectHistory(toHistoryRecords(decisions, []), view)
    .map((record) => record.decision);
}

// Focus-index math for optional arrow/Home/End navigation. Cards also remain in
// the normal Tab order; movement clamps at the ends (no wrap).
export function nextFocusIndex(current, key, length) {
  if (length === 0) return -1;
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : Math.min(current + 1, length - 1);
    case "ArrowUp":
      return current <= 0 ? 0 : current - 1;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return current;
  }
}

const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", "Home", "End"]);

function appendTextElement(parent, tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function appendLabelledValue(parent, label, value, className = "") {
  const pair = document.createElement("span");
  pair.className = `meta-pair ${className}`.trim();
  appendTextElement(pair, "span", "meta-label", `${label}:`);
  appendTextElement(pair, "span", "meta-value", value);
  parent.append(pair);
  return pair;
}

function recordLabel(count) {
  return `${count} ${count === 1 ? "record" : "records"}`;
}

function focusCard(cards, index) {
  cards[index]?.focus();
}

export function handleDecisionListKeydown(event, list) {
  // `.history-card` is carried by both decision and release rows, so arrow
  // navigation walks the mixed stream in render order.
  const card = event.target.closest?.(".history-card");
  if (!card || event.target !== card || !NAV_KEYS.has(event.key)) return false;
  const cards = [...list.querySelectorAll(".history-card")];
  event.preventDefault();
  if (event.key === "Enter") {
    // Cards are native links, so this mirrors their native activation while
    // keeping the state transition explicit and independently testable.
    card.click();
  } else {
    focusCard(cards, nextFocusIndex(cards.indexOf(card), event.key, cards.length));
  }
  return true;
}

// The decision list is rendered after module evaluation, so the browser may
// have attempted fragment navigation before its target existed. Restore the
// expected link behavior explicitly: move focus to it and reveal it without an
// animated scroll.
export function focusLinkedDecision(root = document, hash = window.location.hash) {
  if (!hash.startsWith("#decision-")) return false;
  let id;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch {
    return false;
  }
  const target = root.getElementById(id);
  const card = target?.classList.contains("decision-card")
    ? target
    : target?.querySelector?.(".decision-card");
  if (!card) return false;
  card.focus({ preventScroll: true });
  target.scrollIntoView({ block: "center" });
  return true;
}

// The recorder remains an ordinary page region, not a modal. Moving focus to
// its first required field makes the empty-state action useful without trapping
// keyboard users or changing the established form workflow.
export function enterDecisionRecorder(root, trigger) {
  const title = root.querySelector("#title");
  if (!title) return false;
  title.focus({ preventScroll: true });
  title.scrollIntoView?.({ block: "center" });
  returnFocusTarget = trigger ?? null;
  return true;
}

let returnFocusTarget = null;

export function exitDecisionRecorder(root) {
  const fallback = root.querySelector("#decisions-title");
  const target = returnFocusTarget?.isConnected === false ? fallback : (returnFocusTarget ?? fallback);
  if (!target) return false;
  target.focus?.({ preventScroll: true });
  target.scrollIntoView?.({ block: "center" });
  returnFocusTarget = null;
  return true;
}

export function renderDecisionState(container, state, options = {}) {
  container.replaceChildren();
  container.setAttribute("aria-busy", String(state === "loading"));
  const panel = document.createElement("div");
  panel.className = `list-state list-state-${state}`;
  panel.setAttribute("role", state === "error" ? "alert" : "status");
  // Two distinct empty states, kept distinct on purpose: "nothing recorded yet"
  // is a first-run state whose one action is recording a decision, while "no
  // records match" is a filter state whose one action is resetting the filters.
  const copy = {
    loading: ["Loading decisions", "Loading all decisions…"],
    error: ["Decisions could not be loaded", "Your saved decisions are still shown when available. Try reloading for the example history."],
    empty: options.filtered
      ? ["No records match your filters", "No decision or release matches the current record type, status, owner, and search. Reset the filters to see the full history."]
      : [
        "No decisions yet",
        "Record the title, context, owner, and status behind a useful decision. You can link it to a release when that work ships.",
      ],
  }[state];
  appendTextElement(panel, "h3", "", copy[0]);
  appendTextElement(panel, "p", "", copy[1]);
  // Which filters produced the empty list, in their own values. The sentence
  // above names the *dimensions* ("record type, status, owner, and search"),
  // which leaves a reader who has narrowed four controls to reconstruct what
  // they set from memory before they can undo it. Same words as the chips, so
  // the two ways of reading the view agree; omitted when the caller passes no
  // filter state, which is every caller that renders this panel without a view.
  if (state === "empty" && options.filtered) {
    const chips = historyFilterChips(options.filters ?? {});
    if (chips.length > 0) {
      appendTextElement(panel, "p", "hint empty-state-filters", `Filters in effect: ${chips.map((chip) => chip.text).join(" · ")}`);
    }
  }
  if (state === "empty") {
    const action = options.filtered
      ? appendTextElement(panel, "button", "empty-action history-reset-action", "Reset filters")
      : appendTextElement(panel, "button", "empty-action decision-empty-action", "Record your first decision");
    action.type = "button";
    action.setAttribute("aria-controls", options.filtered ? "decision-list" : "decision-form");
    action.dataset.action = options.filtered ? "reset-filters" : "record-decision";
  }
  container.append(panel);
}

function appendRecordedDate(meta, createdAt, label) {
  const datePair = document.createElement("span");
  datePair.className = "meta-pair date";
  appendTextElement(datePair, "span", "meta-label", label);
  const time = appendTextElement(
    datePair,
    "time",
    "meta-value",
    new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(createdAt)),
  );
  time.dateTime = createdAt;
  meta.append(datePair);
  return datePair;
}

function appendOwner(summary, owner) {
  const element = document.createElement("p");
  element.className = "owner";
  appendTextElement(element, "span", "owner-label", "Owner");
  element.append(document.createTextNode(owner));
  summary.append(element);
  return element;
}

// The one place a row says a record is an example. Same badge idiom as the type
// and status badges next to it, so the disclosure travels with the row through
// every filter and sort instead of living only in the caption above the list.
function appendExampleBadge(meta, example) {
  if (example !== true) return null;
  return appendTextElement(meta, "span", "badge badge-example", EXAMPLE_LABEL);
}

// The decisions a release carried, rendered on the release row. The other
// direction — the releases that shipped a decision — is appendShippedIn below,
// which has a summary line and a disclosure this flat list does not need: a
// release names a handful of decisions and all of them matter equally, while a
// decision's releases have a newest one that answers the question on its own.
//
// It sits *outside* the card's own link on purpose. An anchor cannot nest, so
// putting a counterpart link inside the card would either be invalid markup or
// a dead label; as a sibling it is a real Tab stop that opens that record
// directly, and it stays out of the arrow-key path (`.history-card` only), so
// the list navigation a keyboard user already knows is unchanged.
//
// `visibleKeys` is the set of rows the current filters left on screen. A
// counterpart outside it is still named — filtering narrows the list, never the
// relationship — and is marked as not being in this view.
function appendRelationships(article, record, visibleKeys) {
  const copy = RELATIONSHIP_COPY[record.type];
  const links = record.links ?? [];
  if (!copy || (links.length === 0 && !copy.empty)) return null;
  const relationship = document.createElement("p");
  relationship.className = "record-links";
  appendTextElement(relationship, "span", "owner-label", copy.label);
  if (links.length === 0) {
    appendTextElement(relationship, "span", "record-link-empty", copy.empty);
  }
  for (const link of links) {
    // A dangling reference gets no anchor: there is no record to open. It is
    // named anyway, so the row and the release's own count agree.
    if (link.missing) {
      appendTextElement(relationship, "span", "record-link record-link-missing", link.label);
      continue;
    }
    const anchor = document.createElement("a");
    anchor.className = "record-link";
    anchor.href = link.href;
    appendTextElement(anchor, "span", "record-link-label", link.label);
    if (visibleKeys && !visibleKeys.has(`${link.type}:${link.id}`)) {
      anchor.classList.add("record-link-hidden");
      // Stated in words inside the link, so the note travels with the
      // accessible name instead of being carried by the muted styling alone.
      appendTextElement(anchor, "span", "record-link-note", HIDDEN_LINK_NOTE);
    }
    relationship.append(anchor);
  }
  article.append(relationship);
  return relationship;
}

const mediumDate = (value) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
const SHIPPED_UNDATED = "date not recorded";
const SHIPPED_NONE = { state: "none", entries: [], newest: null, others: 0 };

// One release inside the disclosure: version, status, and date, all inside the
// anchor that opens it. Keeping the three in the link is what makes the whole
// row one Tab stop whose accessible name is "v1.4.0 planned 1 May 2026" — the
// answer read out in one go — instead of a bare version with the facts stranded
// beside it. Every string arrives through textContent, so a version recorded as
// `<img src=x onerror=alert(1)>` is 28 visible characters and no element.
function shippedReleaseLink(entry, visibleKeys) {
  const item = document.createElement("li");
  const anchor = document.createElement("a");
  anchor.className = "record-link";
  anchor.href = entry.href;
  appendTextElement(anchor, "span", "record-link-label", entry.version);
  // Real separator characters, not the flex gap between the spans: an accessible
  // name is computed from text, and spacing is not text — without these the link
  // is announced as "v1.4.0plannedMay 1, 2026".
  anchor.append(document.createTextNode(" "));
  appendTextElement(anchor, "span", `badge badge-release-${entry.status}`, entry.status);
  anchor.append(document.createTextNode(" "));
  if (entry.dated) {
    const time = appendTextElement(anchor, "time", "linked-release-date", mediumDate(entry.createdAt));
    time.dateTime = entry.createdAt;
  } else {
    appendTextElement(anchor, "span", "linked-release-date", SHIPPED_UNDATED);
  }
  if (visibleKeys && !visibleKeys.has(`release:${entry.id}`)) {
    anchor.classList.add("record-link-hidden");
    appendTextElement(anchor, "span", "record-link-note", HIDDEN_LINK_NOTE);
  }
  item.append(anchor);
  return item;
}

// Which releases shipped a decision, answered on the row itself.
//
// A decision can be carried by several releases, and a flat row of every version
// says nothing about which one actually put the decision in front of users. So
// the line that is always on screen answers that — the most recent release by
// date, its date, and how many others there are — and the full list, each
// release with its status and date, is one keypress underneath it.
//
// That line IS the disclosure's summary element rather than a paragraph above
// one. A reader gets a single sentence and a single control instead of a summary
// they read and a separate "show more" they then have to find; and because a
// summary element is always rendered, nothing that has to be read on arrival is
// ever inside the collapsed part. The disclosure is native, matching the one the
// decision detail page uses for a superseded predecessor: Enter, Space, and the
// natural tab order are the browser's, not a tabindex this view has to keep
// correct, and aria-expanded is kept in step with the open state on toggle.
//
// It needs no rule of its own. The wrapper is the `.record-links` row release
// rows already use, and the disclosure is its only child there, so it lays out
// against the width the row already had.
//
// Nothing in here is a live region, and nothing is stated by colour alone: the
// summary names the version in words, and both "Not yet shipped" and the
// unreadable-records line are sentences rather than a styled absence.
function appendShippedIn(article, record, visibleKeys) {
  const copy = RELATIONSHIP_COPY.decision;
  const shipped = record.shipped ?? SHIPPED_NONE;
  // A div, not a paragraph: a disclosure is flow content and a `p` may not
  // contain it. The class, and so the layout, is the one release rows use.
  const relationship = document.createElement("div");
  relationship.className = "record-links";

  if (shipped.state !== "shipped") {
    // The state stands alone here — prefixing "Shipped in" to "Not yet shipped"
    // reads as a contradiction, and neither sentence needs the label to be
    // understood. There is nothing to disclose, so there is no disclosure.
    appendTextElement(
      relationship,
      "span",
      "record-link-empty",
      shipped.state === "unresolved" ? copy.unresolved : copy.empty,
    );
    article.append(relationship);
    return relationship;
  }

  const { newest, others, entries } = shipped;
  const disclosure = document.createElement("details");
  disclosure.className = "shipped-releases";
  const summary = document.createElement("summary");
  summary.className = "supersede-disclosure-summary shipped-summary";
  summary.setAttribute("aria-expanded", "false");
  appendTextElement(summary, "span", "owner-label", copy.label);
  summary.append(document.createTextNode(" "));
  appendTextElement(summary, "span", "shipped-latest-version", newest.version);
  summary.append(document.createTextNode(" · "));
  if (newest.dated) {
    const time = appendTextElement(summary, "time", "shipped-latest-date", mediumDate(newest.createdAt));
    time.dateTime = newest.createdAt;
  } else {
    appendTextElement(summary, "span", "shipped-latest-date", SHIPPED_UNDATED);
  }
  // Exactly one release gets no fragment at all rather than "+0 more".
  if (others > 0) {
    summary.append(document.createTextNode(" · "));
    appendTextElement(summary, "span", "shipped-more", `+${others} more`);
  }
  // A filter that removed the release this line names has to say so on the line
  // itself: the same note is on the link inside, and collapsed content is not
  // read out.
  if (visibleKeys && !visibleKeys.has(`release:${newest.id}`)) {
    summary.append(document.createTextNode(" "));
    appendTextElement(summary, "span", "record-link-note", HIDDEN_LINK_NOTE);
  }
  // `open` is read off the attribute as well as the property so the state is the
  // one in the markup, whichever way it was flipped.
  disclosure.addEventListener("toggle", () => {
    summary.setAttribute("aria-expanded", String(disclosure.open === true || disclosure.getAttribute("open") !== null));
  });

  const list = document.createElement("ul");
  list.className = "linked-release-list";
  // Composition order — the order this row's links have always been in — stated
  // rather than left to be inferred from the versions.
  list.setAttribute("aria-label", "Releases that shipped this decision, in the order they were recorded");
  for (const entry of entries) list.append(shippedReleaseLink(entry, visibleKeys));
  disclosure.append(summary, list);
  relationship.append(disclosure);

  article.append(relationship);
  return relationship;
}

// Whether a decision's record would survive being questioned, said on the row.
//
// The rule set is decision-backing.js and nothing about it is decided here: this
// function turns one verdict object into one line and one disclosure. Keeping
// the judgement out of the renderer is what lets the same verdict be asserted
// against fixtures without a DOM, which is the only way the line stays
// reproducible when someone disputes it.
//
// WHAT IS ALWAYS ON SCREEN, and why. The verdict sentence is a sibling of the
// disclosure, never inside it. Collapsed content is not read out, so a verdict
// that only existed under the summary would be a claim a screen reader user
// could not hear without first finding and opening a control. The supporting
// detail — which checks passed, which failed, which rule decided — is the part
// behind the disclosure, and it is closed on arrival.
//
// WHY IT LOOKS LIKE NOTHING IN PARTICULAR. A backed decision is the normal case
// and gets no badge, no colour and no icon: the wording carries it, so the only
// rows that pull the eye are the ones naming a next action. It also needs no
// rule of its own — the wrapper is the `.record-links` row the shipped-in line
// already uses, and the disclosure reuses that line's summary styling, so the
// whole thing lays out against widths this row already had.
//
// The disclosure is native, matching appendShippedIn above: Enter, Space and the
// tab order are the browser's, and aria-expanded is kept in step on toggle. It
// sits outside the card's own anchor, so it is a real tab stop rather than a
// control nested in a link, and arrow-key navigation (`.history-card` only) is
// unchanged.
//
// Every string that reaches the DOM here is an authored constant or an integer
// from the verdict, and all of it arrives through textContent. No owner name,
// context sentence or alternative label is rendered by this function at all.
function appendBacking(article, record) {
  const verdict = scoreDecisionBacking(record);
  const wrapper = document.createElement("div");
  wrapper.className = "record-links decision-backing";
  appendTextElement(wrapper, "span", "decision-backing-verdict", verdict.verdict);

  const disclosure = document.createElement("details");
  disclosure.className = "decision-backing-detail";
  const summary = appendTextElement(disclosure, "summary", "supersede-disclosure-summary", "How this was checked");
  summary.setAttribute("aria-expanded", "false");
  disclosure.addEventListener("toggle", () => {
    summary.setAttribute("aria-expanded", String(disclosure.open === true || disclosure.getAttribute("open") !== null));
  });

  const checks = document.createElement("ul");
  checks.className = "linked-release-list decision-backing-checks";
  // The order is the rule order, stated rather than left to be inferred from
  // the wording of four list items.
  checks.setAttribute("aria-label", "Backing checks, in the order the rules apply them");
  for (const check of DECISION_BACKING_CHECKS) {
    const outcome = verdict.passed.includes(check) ? "recorded" : "missing";
    appendTextElement(checks, "li", "decision-backing-check", `${DECISION_BACKING_LABELS[check]}: ${outcome}`);
  }
  disclosure.append(checks);
  // The rule id, so a lead disputing the line can name the rule they disagree
  // with instead of describing the sentence it produced.
  appendTextElement(disclosure, "p", "decision-backing-rule", `Deciding rule: ${verdict.ruleId}`);

  wrapper.append(disclosure);
  article.append(wrapper);
  return wrapper;
}

function renderDecisionRow(record, index, visibleKeys) {
  const { decision, example } = record;
  const item = document.createElement("li");
  const article = document.createElement("article");
  const detailLink = document.createElement("a");
  detailLink.className = "history-card decision-card decision-detail-link";
  // Deep-link target: the release detail view links a decision as
  // `/#decision-<id>` (see decisionDetailHref in releases.js). Rendering the
  // matching id makes that a native anchor — the browser scrolls to it and
  // `:target` highlights it, with no routing code. Cross-page seam only.
  article.id = `decision-${decision.id}`;
  detailLink.href = `/decision.html?id=${encodeURIComponent(decision.id)}`;

  // Render-local ids avoid leaking arbitrary stored ids into ARIA IDREFs.
  const titleId = `decision-title-${index}`;
  const descriptionId = `decision-summary-${index}`;
  detailLink.setAttribute("aria-labelledby", titleId);
  detailLink.setAttribute("aria-describedby", descriptionId);

  const title = appendTextElement(detailLink, "h3", "", decision.title);
  title.id = titleId;
  const meta = document.createElement("div");
  meta.className = "decision-meta";
  // The record type is stated as text, not signalled by card colour alone, so
  // the mixed stream stays legible in a filtered result.
  appendLabelledValue(meta, "Type", "Decision", "badge badge-type badge-type-decision");
  // The row renders from the stored record, so the legacy "approved" is folded
  // onto the word the filter and the glossary use before it reaches the badge.
  const status = canonicalDecisionStatus(decision.status);
  appendLabelledValue(meta, "Status", status, `badge badge-${status}`);
  appendExampleBadge(meta, example);
  appendRecordedDate(meta, decision.createdAt, "Recorded:");
  const summary = document.createElement("div");
  summary.id = descriptionId;
  appendTextElement(summary, "p", "context", decision.context);
  if (decision.alternatives) {
    const alternatives = document.createElement("p");
    alternatives.className = "alternatives";
    appendTextElement(alternatives, "span", "owner-label", "Alternatives");
    alternatives.append(document.createTextNode(decision.alternatives));
    summary.append(alternatives);
  }
  summary.prepend(meta);
  appendOwner(summary, decision.owner);
  appendTextElement(summary, "span", "decision-action", "View decision details");
  detailLink.append(summary);
  article.append(detailLink);
  appendShippedIn(article, record, visibleKeys);
  appendBacking(article, record);
  item.append(article);
  return item;
}

// A release row carries the same amount of context as a decision row — status,
// date, description, linked-decision summary, owner — and the same open/act
// affordance, so a filtered result is still actionable without a second hop.
function renderReleaseRow(record, index, visibleKeys) {
  const { release, example } = record;
  const item = document.createElement("li");
  const article = document.createElement("article");
  const detailLink = document.createElement("a");
  detailLink.className = "history-card release-card release-history-link";
  detailLink.href = releaseDetailHref(release.id);

  const titleId = `release-title-${index}`;
  const descriptionId = `release-summary-${index}`;
  detailLink.setAttribute("aria-labelledby", titleId);
  detailLink.setAttribute("aria-describedby", descriptionId);

  const heading = releaseTitle(release) === release.version
    ? release.version
    : `${release.version} · ${releaseTitle(release)}`;
  const title = appendTextElement(detailLink, "h3", "", heading);
  title.id = titleId;
  const meta = document.createElement("div");
  meta.className = "decision-meta";
  appendLabelledValue(meta, "Type", "Release", "badge badge-type badge-type-release");
  const status = releaseStatus(release);
  appendLabelledValue(meta, "Status", status, `badge badge-release-${status}`);
  appendExampleBadge(meta, example);
  appendRecordedDate(meta, release.createdAt, "Released:");
  const summary = document.createElement("div");
  summary.id = descriptionId;
  const description = releaseDescription(release);
  if (description) appendTextElement(summary, "p", "context", description);
  const linked = document.createElement("p");
  linked.className = "alternatives release-linked";
  appendTextElement(linked, "span", "owner-label", "Linked decisions");
  linked.append(document.createTextNode(statusSummaryText(release)));
  summary.append(linked);
  summary.prepend(meta);
  appendOwner(summary, releaseOwner(release));
  appendTextElement(summary, "span", "decision-action", "View release details");
  detailLink.append(summary);
  article.append(detailLink);
  appendRelationships(article, record, visibleKeys);
  item.append(article);
  return item;
}

// Renders the composed history stream and returns the number of visible rows so
// the caller can announce an accurate count without re-deriving the selection.
export function renderHistory(container, count, records, view = {}) {
  const visible = selectHistory(records, view);
  container.replaceChildren();
  container.setAttribute("aria-busy", "false");

  count.textContent = visible.length === records.length
    ? recordLabel(records.length)
    : `${visible.length} of ${recordLabel(records.length)}`;

  if (records.length === 0) {
    renderDecisionState(container, "empty");
    return 0;
  }

  if (visible.length === 0) {
    renderDecisionState(container, "empty", { filtered: true, filters: view });
    return 0;
  }

  const list = document.createElement("ol");
  list.className = "decision-list";
  // What the filters left on screen, keyed by kind and id so a decision and a
  // release that share an id can never be mistaken for each other. Rows read it
  // to mark a counterpart the current view does not list.
  const visibleKeys = new Set(visible.map((record) => `${record.type}:${record.id}`));
  visible.forEach((record, index) => {
    list.append(record.type === "release"
      ? renderReleaseRow(record, index, visibleKeys)
      : renderDecisionRow(record, index, visibleKeys));
  });
  container.append(list);
  return visible.length;
}

// Decision-only entry point, kept for callers (and tests) that render a stream
// of decisions without releases.
export function renderDecisions(container, count, decisions, view) {
  return renderHistory(container, count, toHistoryRecords(decisions, []), view);
}

// The visible count updates on every keystroke; the announcement does not.
// Screen reader users get one settled message per burst of typing or filter
// changes instead of a new interruption per character.
export const COUNT_ANNOUNCE_DELAY = 500;

export function createCountAnnouncer(node, options = {}) {
  const delay = options.delay ?? COUNT_ANNOUNCE_DELAY;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let pending = null;
  return (message) => {
    if (!node) return;
    if (pending !== null) clearTimer(pending);
    pending = setTimer(() => {
      pending = null;
      node.textContent = message;
    }, delay);
  };
}

export function historyCountMessage(visible, total) {
  if (total === 0) return "No records recorded yet.";
  if (visible === 0) return "No records match the current filters.";
  if (visible === total) return `Showing all ${recordLabel(total)}.`;
  return `Showing ${visible} of ${recordLabel(total)}.`;
}

// Rebuilds the owner filter options from the current data while preserving the
// active selection when that owner still exists.
function syncOwnerOptions(select, records) {
  const current = select.value || "all";
  const owners = uniqueOwners(records);
  select.replaceChildren(new Option("all", "all"));
  for (const owner of owners) select.append(new Option(owner, owner));
  select.value = current === "all" || owners.includes(current) ? current : "all";
}

function syncReleaseOptions(select, releases) {
  if (!select) return;
  const current = select.value || "all";
  select.replaceChildren(new Option("All releases", "all"));
  for (const release of releases) select.append(new Option(releaseTitle(release), release.id));
  select.value = current === "all" || releases.some(({ id }) => id === current) ? current : "all";
}

function renderHistoryReleaseFollowUp(container, release, decisions) {
  if (!container) return;
  container.replaceChildren();
  // Open decisions only: this panel exists to name the one decision in the
  // selected release that still needs settling, and releases.js owns which
  // lifecycle stages those are.
  const followUp = release
    ? releaseDecisionFollowUp(resolveRelease(release, decisions), OPEN_DECISION_KINDS)
    : null;
  container.hidden = !followUp;
  if (container.hidden) return;
  const panel = document.createElement("section");
  panel.className = "history-release-followup";
  panel.setAttribute("aria-labelledby", "history-release-followup-title");
  appendTextElement(panel, "p", "history-release-followup-kicker", "Prioritized follow-up");
  const heading = appendTextElement(panel, "h3", "history-release-followup-title", followUp.title);
  heading.id = "history-release-followup-title";
  const meta = document.createElement("div");
  meta.className = "decision-meta";
  appendLabelledValue(meta, "Owner", followUp.owner);
  appendLabelledValue(meta, "Status", followUp.status, `badge badge-${followUp.status}`);
  panel.append(meta);
  if (followUp.href) {
    const link = appendTextElement(panel, "a", "history-release-followup-action", followUp.action);
    link.href = followUp.href;
  }
  container.append(panel);
}

// The recorder offers the decisions that exist right now as supersede targets,
// so the ordinary path cannot produce a self reference (a new decision has no id
// yet) or a dangling one. A selection that has since disappeared is still
// checked on submit — the log can change in another tab between the two.
function syncSupersedesOptions(select, decisions) {
  const current = select.value || "";
  select.replaceChildren(new Option("None", ""));
  for (const decision of decisions) select.append(new Option(decision.title, decision.id));
  select.value = decisions.some((decision) => decision.id === current) ? current : "";
}

export async function initDecisionLog(root = document, storage = localStorage, options = {}) {
  initLeadCapture(root);
  const form = root.querySelector("#decision-form");
  const list = root.querySelector("#decision-list");
  const count = root.querySelector("#decision-count");
  const notice = root.querySelector("#storage-notice");
  const statusFilter = root.querySelector("#filter-status");
  const ownerFilter = root.querySelector("#filter-owner");
  const releaseFilter = root.querySelector("#filter-release");
  const releaseHint = root.querySelector("#filter-release-hint");
  const releaseFollowUp = root.querySelector("#history-release-followup");
  const sortBy = root.querySelector("#sort-by");
  const search = root.querySelector("#decision-search");
  const clearFilters = root.querySelector("#clear-decision-filters");
  const exitRecorder = root.querySelector("#exit-decision-recorder");
  const typeFilter = [...(root.querySelectorAll?.('input[name="record-type"]') ?? [])];
  const statusHint = root.querySelector("#filter-status-hint");
  const currentOnly = root.querySelector("#filter-current-only");
  const fromFilter = root.querySelector("#filter-from");
  const toFilter = root.querySelector("#filter-to");
  const filterSummary = root.querySelector("#history-filter-summary");
  const trend = root.querySelector("#history-trend");
  const filterChips = root.querySelector("#history-filter-chips");
  const copyLink = root.querySelector("#copy-history-link");
  // A live region of its own, so "Link copied" and "Showing 3 of 41 records"
  // cannot overwrite each other mid-announcement.
  const copyStatus = root.querySelector("#history-copy-status");
  const supersedeSummary = root.querySelector("#history-supersede-summary");
  const overdueSlot = root.querySelector("#overdue-decision");
  const supersedesField = root.querySelector("#supersedes");
  const supersedesError = root.querySelector("#supersedes-error");
  const formError = root.querySelector("#decision-form-error");
  const recordStatus = root.querySelector("#decision-record-status");
  // Each required field paired with the paragraph that reports its failure. A
  // surface that mounts the recorder without those paragraphs still validates
  // and still refuses a bad entry; it just cannot show the message, so every
  // access below is optional rather than assumed.
  const entryFields = new Map(DECISION_ENTRY_FIELDS.map((field) => [field, {
    control: root.querySelector(`#${field}`),
    error: root.querySelector(`#${field}-error`),
  }]));
  const locationRef = options.location ?? globalThis.window?.location;
  const historyRef = options.history ?? globalThis.window?.history;
  const windowRef = options.window ?? globalThis.window;
  const clipboardRef = options.clipboard ?? globalThis.navigator?.clipboard;
  const announce = createCountAnnouncer(root.querySelector("#history-announcement"), {
    delay: options.announceDelay,
  });
  // The examples are a module constant, so the composed history exists before
  // the first render rather than a fetch later. `options.seed` exists for tests
  // that need a history with nothing in it but their own fixtures.
  const seed = options.seed ?? { decisions: SEED_DECISIONS, releases: SEED_RELEASES };
  const seedDecisions = Array.isArray(seed.decisions) ? seed.decisions : [];
  const seedReleases = Array.isArray(seed.releases) ? seed.releases : [];
  let recordedDecisions = loadDecisions(storage);
  let recordedReleases = loadReleases(storage);
  let decisions = [];
  let releases = [];
  let records = [];
  // The seed ids this visitor has not taken over, recomputed by refresh(). Held
  // here because the sample release panel below needs the same answer the rows
  // are badged from, rather than re-deriving it.
  let exampleIds = new Set();

  // Single source of truth for the render path. Controls write into it, the
  // render function reads from it; nothing re-reads filter state out of the DOM.
  //
  // The *filters* in it are a projection of the query string and nothing else:
  // adoptFilters() writes the URL into this object and commit() writes this
  // object back out, so state → URL → state is one loop rather than two copies
  // that can disagree. Sort is not a filter and stays out of the URL — it
  // reorders the same records, it never changes which ones a link resolves to.
  const view = {
    query: "",
    type: "all",
    status: "all",
    owner: "all",
    releaseId: "all",
    sort: DEFAULT_SORT,
    from: "",
    to: "",
    currentOnly: false,
  };

  // The query string this page owns, tracked locally because pushState does not
  // report back through the same object in every environment.
  let queryString = locationRef?.search ?? "";

  // Reflect the filter state into the controls. Called on boot, on Back, and
  // after a chip removes a filter — every path that changes the filters without
  // a person touching the control that owns them.
  const syncFilterControls = () => {
    if (search) search.value = view.query;
    for (const radio of typeFilter) radio.checked = radio.value === view.type;
    if (statusFilter) statusFilter.value = view.status;
    if (ownerFilter) {
      // A shared link can name an owner this log has never held. The option list
      // is asked directly rather than inferred from what the control did with
      // the value: a `<select>` silently refuses a value no option carries, so
      // reading the value back conflates "this log has no such owner" with "the
      // options are not built yet" — and at boot the owner options, which are
      // derived from the visitor's own records, are exactly that. The view falls
      // back to the whole history rather than filtering by a person no option
      // represents.
      const offered = [...(ownerFilter.options ?? [])].some((option) => option.value === view.owner);
      if (!offered) view.owner = "all";
      ownerFilter.value = view.owner;
    }
    if (releaseFilter) {
      const offered = [...(releaseFilter.options ?? [])].some((option) => option.value === view.releaseId);
      if (!offered) view.releaseId = "all";
      releaseFilter.value = view.releaseId;
    }
    if (fromFilter) fromFilter.value = view.from;
    if (toFilter) toFilter.value = view.to;
    syncCurrentOnlyControl();
    syncStatusAvailability();
  };

  // Take a parsed filter state as the truth. Only the filter keys are touched:
  // sort is the visitor's, not the link's.
  const adoptFilters = (filters) => {
    for (const key of Object.keys(DEFAULT_HISTORY_FILTERS)) view[key] = filters[key];
    syncFilterControls();
  };

  /**
   * Write the filters back to the URL and re-render.
   *
   * `push: true` (a discrete filter change, a dismissed chip) leaves an entry
   * the Back button can return to; `push: false` (a keystroke in the search
   * box) rewrites the current one, because stepping back through twenty
   * keystrokes is not history a person wants. A change that produces the same
   * query string writes nothing at all — a no-op must not stack a duplicate
   * entry that Back appears to ignore.
   */
  const syncUrl = ({ push = true } = {}) => {
    const next = historyFilterSearch(view);
    if (next === queryString) return false;
    queryString = next;
    const target = historyFilterPath(locationRef ?? {}, view);
    if (push) historyRef?.pushState?.(null, "", target);
    else historyRef?.replaceState?.(null, "", target);
    return true;
  };

  const commit = (options) => {
    syncUrl(options);
    render();
  };

  // Going Back is a filter change like any other: re-derive the state from the
  // URL the browser restored, put it back on the controls, and re-render. The
  // URL is already correct at this point, so nothing is written.
  windowRef?.addEventListener?.("popstate", () => {
    queryString = locationRef?.search ?? "";
    adoptFilters(parseHistoryFilters(queryString));
    render();
  });

  const showSupersedesError = (message) => {
    if (supersedesError) {
      supersedesError.textContent = message;
      supersedesError.hidden = false;
    }
    supersedesField?.setAttribute?.("aria-invalid", "true");
    supersedesField?.focus?.();
    // Same rule the field errors follow: a refusal retires the previous
    // success line, so the last thing said about this form is what just
    // happened to it.
    if (recordStatus) recordStatus.textContent = "";
  };

  const clearSupersedesError = () => {
    if (supersedesError) {
      supersedesError.textContent = "";
      supersedesError.hidden = true;
    }
    supersedesField?.setAttribute?.("aria-invalid", "false");
  };

  // Which fields are currently reporting a failure. Held here so the form-level
  // count can be corrected as fields are fixed one at a time, instead of
  // advertising a stale "3 fields" next to two remaining messages.
  const failingFields = new Set();

  // The summary is one line and it is said once per submit. It names the field
  // that is blocking the save — the one focus just landed on — and counts the
  // rest; `failingFields` is kept in form order by showEntryErrors, so the first
  // entry is the first failure a reader would reach.
  const syncEntrySummary = () => {
    if (!formError) return;
    formError.textContent = decisionEntrySummary([...failingFields]);
    formError.hidden = failingFields.size === 0;
  };

  // The message paragraph joins and leaves its control's accessible description
  // with the failure itself. Named up front in the markup it would be a
  // permanent, usually-empty description; added here it is only ever part of the
  // description while there is something to describe.
  const describeField = (control, id, described) => {
    if (!control || !id) return;
    const names = (control.getAttribute?.("aria-describedby") ?? "")
      .split(/\s+/)
      .filter((name) => name && name !== id);
    if (described) names.push(id);
    if (names.length > 0) control.setAttribute?.("aria-describedby", names.join(" "));
    else control.removeAttribute?.("aria-describedby");
  };

  const clearFieldError = (field) => {
    const slot = entryFields.get(field);
    failingFields.delete(field);
    if (slot?.error) {
      slot.error.textContent = "";
      slot.error.hidden = true;
    }
    describeField(slot?.control, slot?.error?.id, false);
    // Removed rather than set to "false": aria-invalid is the state of a control
    // a visitor has actually been told about, and a form nobody has submitted
    // yet should not describe five controls as explicitly valid.
    slot?.control?.removeAttribute?.("aria-invalid");
  };

  const showFieldError = (field, message) => {
    const slot = entryFields.get(field);
    failingFields.add(field);
    if (slot?.error) {
      // textContent, never markup. The message is our copy, but it sits beside
      // fields holding the visitor's, and no path from a typed value to parsed
      // HTML may exist anywhere in this form (PRODUCT.md: no user-generated
      // HTML execution).
      slot.error.textContent = message;
      slot.error.hidden = false;
    }
    describeField(slot?.control, slot?.error?.id, true);
    slot?.control?.setAttribute?.("aria-invalid", "true");
  };

  const showEntryErrors = (errors) => {
    for (const field of DECISION_ENTRY_FIELDS) clearFieldError(field);
    for (const { field, message } of errors) showFieldError(field, message);
    syncEntrySummary();
    // A fresh failure retires the previous success line: the last thing said
    // about this form must be the thing that just happened to it.
    if (recordStatus) recordStatus.textContent = "";
    // Focus the first failure in form order — where a reader would start — not
    // the last one found. Every other message is already on its own field.
    const first = entryFields.get(errors[0]?.field)?.control;
    first?.focus?.({ preventScroll: true });
    first?.scrollIntoView?.({ block: "center" });
  };

  const clearEntryErrors = () => {
    for (const field of DECISION_ENTRY_FIELDS) clearFieldError(field);
    syncEntrySummary();
  };

  // A message clears as soon as its own field is edited, so it can never outlive
  // the problem it describes. Nothing is re-validated on the way through:
  // telling somebody their half-typed context is empty while they are typing it
  // is noise, and the next submit is the moment that decides.
  for (const [field, slot] of entryFields) {
    if (!slot.control) continue;
    const event = slot.control.tagName === "SELECT" ? "change" : "input";
    slot.control.addEventListener?.(event, () => {
      if (!failingFields.has(field)) return;
      clearFieldError(field);
      syncEntrySummary();
    });
  }

  const syncCurrentOnlyControl = () => {
    if (!currentOnly) return;
    currentOnly.setAttribute?.("aria-pressed", String(view.currentOnly));
  };

  const STATUS_HINT = "Applies to decisions. Choosing a status shows decision records only.";
  const STATUS_HINT_UNAVAILABLE = "Unavailable while the record type is set to Releases — a release has no decision status.";
  const RELEASE_HINT = "Shows decisions associated with the selected release.";
  const RELEASE_HINT_UNAVAILABLE = "Unavailable while the record type is set to Releases — this filter shows the decisions a release carried, not the release itself.";

  // Mirrors the coupling rule documented on selectHistory into the controls:
  // with releases selected neither the status nor the release filter can ever
  // match, so each is disabled (a native state assistive tech reports) and its
  // value returns to "all" rather than lingering as an inert selection. Both
  // are the same rule: a filter that narrows the stream to decisions is
  // contradicted by a type filter asking for releases, and the pair would
  // otherwise compose into a guaranteed-empty list no control explains.
  const syncStatusAvailability = () => {
    const unavailable = view.type === "release";
    if (statusFilter) {
      if (unavailable && view.status !== "all") {
        view.status = "all";
        statusFilter.value = "all";
      }
      statusFilter.disabled = unavailable;
      if (statusHint) statusHint.textContent = unavailable ? STATUS_HINT_UNAVAILABLE : STATUS_HINT;
    }
    if (releaseFilter) {
      if (unavailable && view.releaseId !== "all") {
        view.releaseId = "all";
        releaseFilter.value = "all";
      }
      releaseFilter.disabled = unavailable;
      if (releaseHint) releaseHint.textContent = unavailable ? RELEASE_HINT_UNAVAILABLE : RELEASE_HINT;
    }
  };

  // The chip buttons currently on screen, in render order, so a removal can
  // hand focus to the one that replaced it.
  let chipButtons = [];

  // A dismissed chip drops exactly one filter and leaves the rest composed.
  // Focus moves to the chip that took its place, or to the next control along,
  // so the keyboard is never returned to the top of the document.
  const removeFilter = (key, button) => {
    if (!(key in DEFAULT_HISTORY_FILTERS)) return;
    const index = chipButtons.indexOf(button);
    view[key] = DEFAULT_HISTORY_FILTERS[key];
    syncFilterControls();
    commit();
    const landing = chipButtons[index] ?? chipButtons.at(-1) ?? copyLink ?? search;
    landing?.focus?.({ preventScroll: true });
  };

  // A bar is a date filter, applied through the state every other control on
  // this page writes to and committed on the same path — not a second filtering
  // rule that could drift from the one the list obeys. Both ends are inclusive
  // calendar days, which is exactly what the week bucket carries.
  //
  // Focus then moves to the From control. The chart is re-rendered from the
  // narrowed set, so the bar the keyboard was standing on is gone by the time
  // the filter lands; the date field is a stable neighbour that now holds what
  // just happened, which is where the chips' own removal path lands too.
  const selectWeek = (bucket) => {
    view.from = bucket.start;
    view.to = bucket.end;
    syncFilterControls();
    commit();
    (fromFilter ?? search)?.focus?.({ preventScroll: true });
  };

  const render = () => {
    const visible = renderHistory(list, count, records, view);
    if (supersedeSummary) supersedeSummary.textContent = supersedeFilterSummary(records, view);
    // The headline of the list, and the filters that produced it. Rendered
    // before the announcement so a reader who hears the count can already find
    // the same sentence on screen.
    renderHistorySummary(filterSummary, { visible, total: records.length, filters: view });
    chipButtons = renderHistoryFilterChips(filterChips, view, { onRemove: removeFilter });
    // The shape of the same view, from the same selection rule: the chart is
    // drawn here rather than from a listener of its own, so a filter can never
    // move the list without moving the trend above it.
    renderHistoryTrend(trend, { records: selectHistory(records, view), onSelectWeek: selectWeek });
    renderHistoryReleaseFollowUp(
      releaseFollowUp,
      releases.find(({ id }) => id === view.releaseId),
      decisions,
    );
    announce(historyCountMessage(visible, records.length));
    // The history owns the filter rule, so it states its own selection instead of
    // letting the export panel re-derive one from the store. Published on every
    // render, including the first: a surface that mounts later reads the scope
    // rather than waiting for the next keystroke.
    publishHistoryScope(root, browsedScope());
  };

  // What the visitor can see, by kind. Examples are left in: they are visible
  // records, and the export's own rule — visitor's own records only — is applied
  // downstream, so this stays a statement about the view and nothing else.
  const browsedScope = () => {
    const shown = selectHistory(records, view);
    return {
      filtered: shown.length !== records.length,
      decisionIds: shown.filter((record) => record.type === "decision").map((record) => record.id),
      releaseIds: shown.filter((record) => record.type === "release").map((record) => record.id),
      // The state that produced those ids, so a downloaded file can name the
      // filter it came from. `filtered` above is a different fact — it says
      // records were actually left out — and the two can disagree honestly: an
      // owner filter every record matches is an active filter that hid nothing.
      // The ids still decide membership; this is only what the file says about
      // itself. `sort` is deliberately not in it: it reorders the same records.
      filters: { ...view },
    };
  };

  // Full refresh: recompose the stream and re-derive owner options (data may
  // have changed) then re-render.
  //
  // Recomposition always starts from what the visitor has recorded and merges
  // the examples behind it. The examples are never written, so recording or
  // importing can only add to the recorded half — it cannot delete, overwrite,
  // or hide either half. dedupeById keeps the first occurrence, so a recorded
  // record that shares an id with an example replaces it and is not badged.
  // `paint: false` composes the log and re-derives the controls without
  // rendering, which is what boot needs before it adopts a link's filters. Every
  // other caller is a data change and paints.
  const refresh = ({ paint = true } = {}) => {
    decisions = dedupeById([...recordedDecisions, ...seedDecisions]);
    releases = dedupeById([...recordedReleases, ...seedReleases]);
    const recordedIds = new Set([...recordedDecisions, ...recordedReleases].map(({ id }) => id));
    exampleIds = new Set([...seedDecisions, ...seedReleases]
      .map(({ id }) => id)
      .filter((id) => !recordedIds.has(id)));
    records = toHistoryRecords(decisions, releases, { exampleIds });
    // The review finding is composed here and not in render(), on purpose: it
    // reads the whole log, so a filter or a keystroke can never change it. Only
    // the data changing can, and this is the one place the data changes.
    //
    // The clock is read here rather than at boot so a tab left open across a
    // review point does not keep reporting yesterday's answer. `options.now`
    // exists so a test never depends on the wall clock.
    if (overdueSlot) {
      renderOverdueFinding(
        overdueSlot,
        overdueDecisionFinding(records, {
          now: options.now ?? Date.now(),
          reviewWindowDays: options.reviewWindowDays,
        }),
        { exampleLabel: EXAMPLE_LABEL },
      );
    }
    if (ownerFilter) syncOwnerOptions(ownerFilter, records);
    syncReleaseOptions(releaseFilter, releases);
    if (supersedesField) syncSupersedesOptions(supersedesField, decisions);
    view.owner = ownerFilter?.value ?? view.owner;
    // Same rule for the release: an import can replace the store with one that
    // no longer holds the selected release, and syncReleaseOptions drops the
    // option. Without this the control would read "All releases" while the view
    // still filtered by the release that is gone.
    view.releaseId = releaseFilter?.value ?? view.releaseId;
    if (paint) render();
  };

  // Nothing is awaited before this point, and nothing needs to be: the history
  // is composed and rendered inside the same synchronous turn that boots the
  // page, so the record count and the rows are already correct on the first
  // paint instead of counting up from the "0 records" in the static markup.
  // The URL is read once, here, and it is the only place the first filter state
  // comes from: a reload and a pasted link are the same event to this page.
  // The log is composed before the link is read, and that order is load-bearing.
  // The owner options are built from the visitor's own records, and a `<select>`
  // refuses a value none of its options carries. Reading the link first handed
  // `?owner=Priya` to a control that still held nothing but "all", so the
  // control refused it and syncFilterControls dropped the filter to "all": the
  // reader of a shared link saw every owner's records where the sender had seen
  // one person's, the export followed that wider view, and syncUrl() below then
  // rewrote the address bar without the parameter that had gone missing. The
  // composition pass does not paint, so this is still one render.
  refresh({ paint: false });
  adoptFilters(parseHistoryFilters(locationRef?.search ?? ""));
  render();
  focusLinkedDecision(root);
  // Canonicalize what the address bar says, without a history entry: a link
  // carrying `status=approved`, an owner this log has never held, or a
  // parameter nothing here reads now shows the state actually on screen. Silent
  // when the link was already canonical, which is the ordinary case.
  syncUrl({ push: false });

  // The "Representative release" panel. It used to feature releases[0], which is
  // whatever sorts first in the composed log — the newest planned example for a
  // cold visitor, and the visitor's own most recent release once they record
  // one. Both are wrong here: the panel's heading, its hint, and the story card
  // above it all name the one release that carried the sample decision, and a
  // visitor's own record must never be presented as an invented example.
  //
  // So it features that release by id, and falls back to another example only if
  // the seed no longer carries it. Every candidate is filtered through the
  // example ids, so this panel can only ever show example data.
  const releaseList = root.querySelector("#sample-release-list");
  if (releaseList) {
    const exampleReleases = releases.filter(({ id }) => exampleIds.has(id));
    const featuredReleases = exampleReleases
      .filter(({ id }) => id === SAMPLE_RELEASE_ID)
      .concat(exampleReleases)
      .slice(0, 1);
    if (featuredReleases.length > 0) {
      mountReleaseList(releaseList, {
        releases: featuredReleases,
        decisions,
        exampleIds,
      }).render({ releases: featuredReleases, decisions, exampleIds });
    } else {
      renderReleaseListState(releaseList, "empty", { singular: true });
    }
  }

  // Changing a filter/sort only re-renders; owner options are stable until the
  // data itself changes, so we deliberately do not resync them here. Each
  // handler updates one field of `view` and leaves the rest alone, so filters
  // and the search term always compose instead of resetting one another.
  //
  // Every filter commits: the change reaches the URL in the same turn it
  // reaches the list, so the address bar is never a stale description of the
  // view. Sort is the one control that only re-renders — it is not in the URL.
  for (const radio of typeFilter) {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      view.type = RECORD_TYPES.includes(radio.value) ? radio.value : "all";
      syncStatusAvailability();
      commit();
    });
  }
  statusFilter?.addEventListener("change", () => {
    view.status = statusFilter.value;
    commit();
  });
  ownerFilter?.addEventListener("change", () => {
    view.owner = ownerFilter.value;
    commit();
  });
  releaseFilter?.addEventListener("change", () => {
    view.releaseId = releaseFilter.value;
    commit();
  });
  sortBy?.addEventListener("change", () => {
    view.sort = sortBy.value;
    render();
  });
  // Typing rewrites the current history entry rather than stacking one per
  // keystroke; the committed value (blur, or Enter) is what Back steps through.
  search?.addEventListener("input", () => {
    view.query = search.value;
    commit({ push: false });
  });
  search?.addEventListener("change", () => {
    view.query = search.value;
    commit();
  });
  for (const control of [fromFilter, toFilter]) {
    control?.addEventListener("change", () => {
      view.from = fromFilter?.value ?? "";
      view.to = toFilter?.value ?? "";
      // An end before the start is repaired on the way in, so the controls
      // never describe a window the list is not showing.
      const range = normalizeHistoryRange(view.from, view.to);
      view.from = range.from;
      view.to = range.to;
      if (fromFilter) fromFilter.value = view.from;
      if (toFilter) toFilter.value = view.to;
      commit();
    });
  }
  // A pressed toggle, not a checkbox: one control with one visible state, whose
  // pressed-ness is what both the header summary and the query string report.
  currentOnly?.addEventListener("click", () => {
    view.currentOnly = !view.currentOnly;
    syncCurrentOnlyControl();
    commit();
  });

  // One reset path, shared by the toolbar control and the empty state's single
  // primary action, so "clear all" always means the same thing. Focus lands on
  // the search input: a stable node outside the list that is re-rendered away.
  const resetFilters = () => {
    adoptFilters({ ...DEFAULT_HISTORY_FILTERS });
    view.sort = DEFAULT_SORT;
    if (sortBy) sortBy.value = DEFAULT_SORT;
    // Back to the clean base path: every filter parameter goes, and nothing is
    // left behind as an empty one.
    commit();
    search?.focus();
  };
  clearFilters?.addEventListener("click", resetFilters);

  // "Copy link to this view". The message is said in a live region of its own
  // and is left on screen, so a failure is visible rather than a button that
  // appears to have done nothing.
  copyLink?.addEventListener("click", async () => {
    const { message } = await copyHistoryLink(
      absoluteHistoryUrl(locationRef ?? {}, view),
      { clipboard: clipboardRef },
    );
    if (copyStatus) copyStatus.textContent = message;
  });

  // Keyboard navigation is delegated to the list container so it survives every
  // re-render without re-binding. Each card is one native-link Tab stop; arrows
  // are an additional list-local shortcut and Enter activates the same link.
  list.addEventListener("keydown", (event) => {
    handleDecisionListKeydown(event, list);
  });
  list.addEventListener("click", (event) => {
    const trigger = event.target.closest?.("[data-action]");
    if (trigger?.dataset.action === "record-decision") enterDecisionRecorder(root, trigger);
    if (trigger?.dataset.action === "reset-filters") resetFilters();
  });
  exitRecorder?.addEventListener("click", () => exitDecisionRecorder(root));

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));

    // Our own validation, not form.reportValidity(). The form carries
    // `novalidate` so the browser's one-bubble-at-a-time report never runs
    // first, and every failure is stated inline on the field it belongs to
    // instead. Nothing is written while any of them stands.
    const errors = validateDecisionEntry(values);
    if (errors.length > 0) {
      showEntryErrors(errors);
      return;
    }

    let decision;
    try {
      decision = createDecision(values, { decisions });
    } catch (error) {
      // A rejected supersede link is the one failure the native form validity
      // cannot express, so it is reported inline against the field that caused
      // it and nothing is written. Any other failure is still a programming
      // error and keeps its existing behaviour.
      if (!Object.values(SUPERSEDE_ERRORS).includes(error.message)) throw error;
      showSupersedesError(error.message);
      return;
    }
    clearSupersedesError();
    clearEntryErrors();
    // Only the recorded half grows. refresh() recomposes the examples behind
    // it, so a new decision is added to the visitor's records rather than
    // replacing anything, and both sets survive.
    recordedDecisions = [decision, ...recordedDecisions];
    let saved = true;
    try {
      saveDecisions(storage, recordedDecisions);
      notice.hidden = true;
    } catch (error) {
      saved = false;
      // Two different failures, told apart because the recovery differs: a full
      // or disabled store is something to work around, a declined retention
      // choice is something to change on the workspace page.
      notice.textContent = error?.code === "retention_declined"
        ? "This decision is visible for now. This browser is set not to keep Shiplog records, so it "
          + "was not saved — change that on the local workspace page."
        : "This decision is visible for now, but could not be saved in this browser.";
      notice.hidden = false;
    }
    // The history is recomposed in the same turn as the save, so the row is on
    // screen before focus returns to the form — there is nothing to reload and
    // nothing to wait for.
    refresh();
    // Only when the write landed. Everything downstream — the export panel's
    // count is the one that exists today — re-reads the store, so announcing a
    // refused save would advertise a record the file will not contain.
    if (saved) recordsChanged(root);
    // …unless the visitor's own filters exclude it. A save deliberately does not
    // reset them, so the status line says which of the two happened rather than
    // leaving somebody hunting for a row that was filtered away.
    //
    // Nothing is said when the save failed: the notice above already explains
    // that this decision is visible for now but was not kept, and a second line
    // announcing it as recorded would contradict it.
    if (recordStatus) {
      const visible = selectHistory(records, view)
        .some((record) => record.type === "decision" && record.id === decision.id);
      recordStatus.textContent = saved ? decisionRecordedSummary(decision, { visible }) : "";
    }
    form.reset();
    form.elements.title.focus();
  });

  // The live deployment self-check (#1791), which is the releases page's band
  // and not a second one: same module, same reading, same sentence. It is booted
  // from the composed log so both surfaces compare the running deployment
  // against the same newest record, and it is deliberately NOT awaited — it
  // reads the health endpoint, and the history above it must not wait on a
  // network read to be correct. A boot that throws leaves the authored waiting
  // line rather than a blank block.
  //
  // A surface that mounts this recorder without the block gets nothing:
  // initDeploymentStatus returns on a missing panel. `deploymentNow` is its own
  // option because `options.now` here is a millisecond number and the check
  // reads an ISO string.
  initDeploymentStatus(root, {
    releases,
    readHealth: options.readHealth,
    now: options.deploymentNow,
  }).catch(() => {});

  document.documentElement.dataset.shiplog = "ready";
}

// Auto-init only on the decisions page. Guarding on the form's presence keeps
// app.js safe to import from other pages (e.g. releases-page.js reuses
// loadDecisions) without booting the decision log against a missing DOM.
if (typeof document !== "undefined" && document.querySelector("#decision-form")) {
  initDecisionLog();
}
