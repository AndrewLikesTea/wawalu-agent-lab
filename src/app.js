import { dedupeById, fetchDemoData } from "./demo-data.js";
import { initLeadCapture } from "./lead-capture.js";
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
// The current workflow uses pending/approved. The original three values remain
// readable so existing local logs and demo/release associations are not lost.
export const STATUSES = ["pending", "approved", "proposed", "accepted", "superseded"];

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

export function saveDecisions(storage, decisions) {
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

  return {
    id: options.id ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    title,
    context,
    alternatives,
    owner,
    status,
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
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

export function toHistoryRecords(decisions = [], releases = []) {
  const byId = indexById(decisions);
  return [
    ...decisions.map((decision) => ({
      type: "decision",
      id: decision.id,
      title: decision.title,
      owner: decision.owner,
      createdAt: decision.createdAt,
      status: decision.status,
      searchable: [decision.title, decision.context, decision.alternatives],
      decision,
    })),
    ...releases.map((release) => {
      const resolved = resolveRelease(release, byId);
      return {
        type: "release",
        id: release.id,
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
export function selectHistory(records, view = {}) {
  const { owner = "all", sort = DEFAULT_SORT } = view;
  const type = RECORD_TYPES.includes(view.type) ? view.type : "all";
  const status = STATUSES.includes(view.status) ? view.status : "all";
  const query = typeof view.query === "string" ? view.query.trim().toLocaleLowerCase() : "";
  const compare = (SORTS[sort] ?? SORTS[DEFAULT_SORT]).compare;
  return records
    .filter((record) => {
      if (type !== "all" && record.type !== type) return false;
      if (status !== "all" && (record.type !== "decision" || record.status !== status)) return false;
      if (owner !== "all" && record.owner !== owner) return false;
      return !query || record.searchable
        .some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(query));
    })
    .sort(compare);
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

function renderDecisionRow(decision, index) {
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
  appendLabelledValue(meta, "Status", decision.status, `badge badge-${decision.status}`);
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
function renderReleaseRow(release, index) {
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
      ? renderReleaseRow(record.release, index)
      : renderDecisionRow(record.decision, index));
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
  const announce = createCountAnnouncer(root.querySelector("#history-announcement"), {
    delay: options.announceDelay,
  });
  let recordedDecisions = loadDecisions(storage);
  let decisions = recordedDecisions;
  let releases = [];
  let records = [];
  list?.setAttribute("aria-busy", "true");

  // Single source of truth for the view. Controls write into it, the render
  // function reads from it; nothing re-reads filter state out of the DOM.
  const view = {
    query: "",
    type: "all",
    status: "all",
    owner: "all",
    sort: DEFAULT_SORT,
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
    announce(historyCountMessage(visible, records.length));
  };

  // Full refresh: recompose the stream and re-derive owner options (data may
  // have changed) then re-render.
  const refresh = () => {
    records = toHistoryRecords(decisions, releases);
    if (ownerFilter) syncOwnerOptions(ownerFilter, records);
    view.owner = ownerFilter?.value ?? view.owner;
    render();
  };

  const demo = await fetchDemoData();
  decisions = dedupeById([...recordedDecisions, ...demo.decisions]);
  releases = dedupeById([...loadReleases(storage), ...demo.releases]);
  syncStatusAvailability();
  refresh();
  if (demo.unavailable && decisions.length === 0) renderDecisionState(list, "error");
  focusLinkedDecision(root);

  const releaseList = root.querySelector("#sample-release-list");
  if (releaseList && releases.length > 0) {
    const featuredReleases = releases.slice(0, 1);
    mountReleaseList(releaseList, {
      releases: featuredReleases,
      decisions,
    }).render({ releases: featuredReleases, decisions });
  } else if (releaseList) {
    renderReleaseListState(releaseList, demo.unavailable ? "error" : "empty", { singular: true });
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

  // One reset path, shared by the toolbar control and the empty state's single
  // primary action, so "reset" always means the same thing. Focus lands on the
  // search input: a stable node outside the list that is re-rendered away.
  const resetFilters = () => {
    view.query = "";
    view.type = "all";
    view.status = "all";
    view.owner = "all";
    view.sort = DEFAULT_SORT;
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

    const decision = createDecision(Object.fromEntries(new FormData(form)));
    recordedDecisions = [decision, ...recordedDecisions];
    decisions = dedupeById([decision, ...decisions]);
    try {
      saveDecisions(storage, recordedDecisions);
      notice.hidden = true;
    } catch {
      notice.textContent = "This decision is visible for now, but could not be saved in this browser.";
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
