import { STORED_DECISION_STATUSES, canonicalDecisionStatus } from "./decision-status.js";
import { dedupeById } from "./demo-data.js";
import { initLeadCapture } from "./lead-capture.js";
import { retentionDeclined, retentionRefusal } from "./local-retention.js";
import { EXAMPLE_LABEL, SAMPLE_RELEASE_ID, SEED_DECISIONS, SEED_RELEASES } from "./seed-records.js";
import {
  SUPERSEDE_ERRORS,
  formatSupersedeSummary,
  indexSupersessions,
  normalizeSupersedes,
  validateSupersedes,
} from "./supersede.js";
import {
  indexById,
  loadReleases,
  mountReleaseList,
  releaseDescription,
  releaseDetailHref,
  releaseOwner,
  releaseStatus,
  releaseTitle,
  renderReleaseListState,
  resolveRelease,
  statusSummaryText,
} from "./releases.js";

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
export const MAX_TITLE_LENGTH = 120;
export const MAX_CONTEXT_LENGTH = 1000;
export const MAX_ALTERNATIVES_LENGTH = 1000;
export const MAX_OWNER_LENGTH = 80;

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

  if (!title || !context || !owner || !STATUSES.includes(status)) {
    throw new TypeError("A decision requires a title, context, owner, and valid status.");
  }
  if (title.length > MAX_TITLE_LENGTH || context.length > MAX_CONTEXT_LENGTH
      || alternatives.length > MAX_ALTERNATIVES_LENGTH
      || owner.length > MAX_OWNER_LENGTH) {
    throw new TypeError("A decision field exceeds its maximum length.");
  }

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
export const RECORD_TYPES = ["all", "decision", "release"];

export function toHistoryRecords(decisions = [], releases = [], options = {}) {
  const byId = indexById(decisions);
  // Derived once per composition rather than per row, and only here: rows carry
  // the answer, they never re-derive it. Which records are examples is decided
  // by the caller that composed the stream, so a row never has to guess from an
  // id shape that a visitor could also produce.
  const exampleIds = options.exampleIds instanceof Set ? options.exampleIds : new Set(options.exampleIds ?? []);
  const { supersededBy } = indexSupersessions(decisions);
  return [
    ...decisions.map((decision) => ({
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
      decision,
    })),
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
export function selectHistory(records, view = {}) {
  const { owner = "all", sort = DEFAULT_SORT } = view;
  const type = RECORD_TYPES.includes(view.type) ? view.type : "all";
  const status = STATUSES.includes(view.status) ? canonicalDecisionStatus(view.status) : "all";
  const query = typeof view.query === "string" ? view.query.trim().toLocaleLowerCase() : "";
  const compare = (SORTS[sort] ?? SORTS[DEFAULT_SORT]).compare;
  return records
    .filter((record) => {
      // "Current only" removes exactly the decisions another decision replaced.
      // A release is never superseded, so it is never removed by this filter.
      if (view.currentOnly === true && record.superseded === true) return false;
      if (type !== "all" && record.type !== type) return false;
      if (status !== "all" && (record.type !== "decision" || record.status !== status)) return false;
      if (owner !== "all" && record.owner !== owner) return false;
      return !query || record.searchable
        .some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(query));
    })
    .sort((a, b) => Number(a.example === true) - Number(b.example === true) || compare(a, b));
}

// The "current only" filter is the one filter whose state has to survive a
// reload, because a link to a filtered history is worth sharing. It rides in the
// query string the pages already read with URLSearchParams, so nothing new has
// to be persisted and an absent parameter is simply the default (off).
export const CURRENT_ONLY_PARAM = "current";
export const CURRENT_ONLY_VALUE = "only";

export function readCurrentOnly(search = "") {
  try {
    return new URLSearchParams(search).get(CURRENT_ONLY_PARAM) === CURRENT_ONLY_VALUE;
  } catch {
    return false;
  }
}

// Rewrites only this parameter and leaves every other one in place, so the
// history filters never clobber an unrelated query string.
export function currentOnlySearch(search = "", currentOnly = false) {
  const params = new URLSearchParams(search);
  if (currentOnly) params.set(CURRENT_ONLY_PARAM, CURRENT_ONLY_VALUE);
  else params.delete(CURRENT_ONLY_PARAM);
  const query = params.toString();
  return query ? `?${query}` : "";
}

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

function renderDecisionRow(decision, index, example = false) {
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
  item.append(article);
  return item;
}

// A release row carries the same amount of context as a decision row — status,
// date, description, linked-decision summary, owner — and the same open/act
// affordance, so a filtered result is still actionable without a second hop.
function renderReleaseRow(release, index, example = false) {
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
    renderDecisionState(container, "empty", { filtered: true });
    return 0;
  }

  const list = document.createElement("ol");
  list.className = "decision-list";
  visible.forEach((record, index) => {
    list.append(record.type === "release"
      ? renderReleaseRow(record.release, index, record.example)
      : renderDecisionRow(record.decision, index, record.example));
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
  const sortBy = root.querySelector("#sort-by");
  const search = root.querySelector("#decision-search");
  const clearFilters = root.querySelector("#clear-decision-filters");
  const exitRecorder = root.querySelector("#exit-decision-recorder");
  const typeFilter = [...(root.querySelectorAll?.('input[name="record-type"]') ?? [])];
  const statusHint = root.querySelector("#filter-status-hint");
  const currentOnly = root.querySelector("#filter-current-only");
  const supersedeSummary = root.querySelector("#history-supersede-summary");
  const supersedesField = root.querySelector("#supersedes");
  const supersedesError = root.querySelector("#supersedes-error");
  const locationRef = options.location ?? globalThis.window?.location;
  const historyRef = options.history ?? globalThis.window?.history;
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

  // Single source of truth for the view. Controls write into it, the render
  // function reads from it; nothing re-reads filter state out of the DOM.
  const view = {
    query: "",
    type: "all",
    status: "all",
    owner: "all",
    sort: DEFAULT_SORT,
    // Restored from the query string, so a reloaded or shared link opens with
    // the same filter the user left on.
    currentOnly: readCurrentOnly(locationRef?.search ?? ""),
  };

  // The query string this page owns, tracked locally because replaceState does
  // not report back through the same object in every environment.
  let queryString = locationRef?.search ?? "";
  const syncUrl = () => {
    queryString = currentOnlySearch(queryString, view.currentOnly);
    const target = `${locationRef?.pathname ?? ""}${queryString}${locationRef?.hash ?? ""}`;
    if (target) historyRef?.replaceState?.(null, "", target);
  };

  const showSupersedesError = (message) => {
    if (supersedesError) {
      supersedesError.textContent = message;
      supersedesError.hidden = false;
    }
    supersedesField?.setAttribute?.("aria-invalid", "true");
    supersedesField?.focus?.();
  };

  const clearSupersedesError = () => {
    if (supersedesError) {
      supersedesError.textContent = "";
      supersedesError.hidden = true;
    }
    supersedesField?.setAttribute?.("aria-invalid", "false");
  };

  const syncCurrentOnlyControl = () => {
    if (!currentOnly) return;
    currentOnly.setAttribute?.("aria-pressed", String(view.currentOnly));
  };

  const STATUS_HINT = "Applies to decisions. Choosing a status shows decision records only.";
  const STATUS_HINT_UNAVAILABLE = "Unavailable while the record type is set to Releases — a release has no decision status.";

  // Mirrors the coupling rule documented on selectHistory into the controls:
  // with releases selected the status filter can never match, so it is disabled
  // (a native state assistive tech reports) and its value returns to "all"
  // rather than lingering as an inert selection.
  const syncStatusAvailability = () => {
    if (!statusFilter) return;
    const unavailable = view.type === "release";
    if (unavailable && view.status !== "all") {
      view.status = "all";
      statusFilter.value = "all";
    }
    statusFilter.disabled = unavailable;
    if (statusHint) statusHint.textContent = unavailable ? STATUS_HINT_UNAVAILABLE : STATUS_HINT;
  };

  const render = () => {
    const visible = renderHistory(list, count, records, view);
    if (supersedeSummary) supersedeSummary.textContent = supersedeFilterSummary(records, view);
    announce(historyCountMessage(visible, records.length));
  };

  // Full refresh: recompose the stream and re-derive owner options (data may
  // have changed) then re-render.
  //
  // Recomposition always starts from what the visitor has recorded and merges
  // the examples behind it. The examples are never written, so recording or
  // importing can only add to the recorded half — it cannot delete, overwrite,
  // or hide either half. dedupeById keeps the first occurrence, so a recorded
  // record that shares an id with an example replaces it and is not badged.
  const refresh = () => {
    decisions = dedupeById([...recordedDecisions, ...seedDecisions]);
    releases = dedupeById([...recordedReleases, ...seedReleases]);
    const recordedIds = new Set([...recordedDecisions, ...recordedReleases].map(({ id }) => id));
    exampleIds = new Set([...seedDecisions, ...seedReleases]
      .map(({ id }) => id)
      .filter((id) => !recordedIds.has(id)));
    records = toHistoryRecords(decisions, releases, { exampleIds });
    if (ownerFilter) syncOwnerOptions(ownerFilter, records);
    if (supersedesField) syncSupersedesOptions(supersedesField, decisions);
    view.owner = ownerFilter?.value ?? view.owner;
    render();
  };

  // Nothing is awaited before this point, and nothing needs to be: the history
  // is composed and rendered inside the same synchronous turn that boots the
  // page, so the record count and the rows are already correct on the first
  // paint instead of counting up from the "0 records" in the static markup.
  syncStatusAvailability();
  syncCurrentOnlyControl();
  refresh();
  focusLinkedDecision(root);

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
  for (const radio of typeFilter) {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      view.type = RECORD_TYPES.includes(radio.value) ? radio.value : "all";
      syncStatusAvailability();
      render();
    });
  }
  statusFilter?.addEventListener("change", () => {
    view.status = statusFilter.value;
    render();
  });
  ownerFilter?.addEventListener("change", () => {
    view.owner = ownerFilter.value;
    render();
  });
  sortBy?.addEventListener("change", () => {
    view.sort = sortBy.value;
    render();
  });
  search?.addEventListener("input", () => {
    view.query = search.value;
    render();
  });
  // A pressed toggle, not a checkbox: one control with one visible state, whose
  // pressed-ness is what both the header summary and the query string report.
  currentOnly?.addEventListener("click", () => {
    view.currentOnly = !view.currentOnly;
    syncCurrentOnlyControl();
    syncUrl();
    render();
  });

  // One reset path, shared by the toolbar control and the empty state's single
  // primary action, so "reset" always means the same thing. Focus lands on the
  // search input: a stable node outside the list that is re-rendered away.
  const resetFilters = () => {
    view.query = "";
    view.type = "all";
    view.status = "all";
    view.owner = "all";
    view.sort = DEFAULT_SORT;
    view.currentOnly = false;
    syncCurrentOnlyControl();
    syncUrl();
    if (search) search.value = "";
    for (const radio of typeFilter) radio.checked = radio.value === "all";
    if (statusFilter) statusFilter.value = "all";
    if (ownerFilter) ownerFilter.value = "all";
    if (sortBy) sortBy.value = DEFAULT_SORT;
    syncStatusAvailability();
    render();
    search?.focus();
  };
  clearFilters?.addEventListener("click", resetFilters);

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
    if (!form.reportValidity()) return;

    let decision;
    try {
      decision = createDecision(Object.fromEntries(new FormData(form)), { decisions });
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
    // Only the recorded half grows. refresh() recomposes the examples behind
    // it, so a new decision is added to the visitor's records rather than
    // replacing anything, and both sets survive.
    recordedDecisions = [decision, ...recordedDecisions];
    try {
      saveDecisions(storage, recordedDecisions);
      notice.hidden = true;
    } catch (error) {
      // Two different failures, told apart because the recovery differs: a full
      // or disabled store is something to work around, a declined retention
      // choice is something to change on the workspace page.
      notice.textContent = error?.code === "retention_declined"
        ? "This decision is visible for now. This browser is set not to keep Shiplog records, so it "
          + "was not saved — change that on the local workspace page."
        : "This decision is visible for now, but could not be saved in this browser.";
      notice.hidden = false;
    }
    refresh();
    form.reset();
    form.elements.title.focus();
  });

  document.documentElement.dataset.shiplog = "ready";
}

// Auto-init only on the decisions page. Guarding on the form's presence keeps
// app.js safe to import from other pages (e.g. releases-page.js reuses
// loadDecisions) without booting the decision log against a missing DOM.
if (typeof document !== "undefined" && document.querySelector("#decision-form")) {
  initDecisionLog();
}
