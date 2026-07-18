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

// Pure view derivation: filter by status/owner, then sort. Never mutates the
// input array, and an unknown sort key degrades gracefully to the default.
export function selectDecisions(decisions, view = {}) {
  const { owner = "all", sort = DEFAULT_SORT } = view;
  const status = STATUSES.includes(view.status) ? view.status : "all";
  const query = typeof view.query === "string" ? view.query.trim().toLocaleLowerCase() : "";
  const compare = (SORTS[sort] ?? SORTS[DEFAULT_SORT]).compare;
  return decisions
    .filter((decision) =>
      (status === "all" || decision.status === status)
      && (owner === "all" || decision.owner === owner)
      && (!query || [decision.title, decision.context, decision.alternatives]
        .some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(query))))
    .sort(compare);
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

function recordLabel(count) {
  return `${count} ${count === 1 ? "record" : "records"}`;
}

function focusCard(cards, index) {
  cards[index]?.focus();
}

export function handleDecisionListKeydown(event, list) {
  const card = event.target.closest?.(".decision-card");
  if (!card || event.target !== card || !NAV_KEYS.has(event.key)) return false;
  const cards = [...list.querySelectorAll(".decision-card")];
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

function renderDecisions(container, count, decisions, view) {
  const visible = selectDecisions(decisions, view);
  container.replaceChildren();

  count.textContent = visible.length === decisions.length
    ? recordLabel(decisions.length)
    : `${visible.length} of ${recordLabel(decisions.length)}`;

  if (decisions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    appendTextElement(empty, "p", "empty-title", "No decisions yet.");
    appendTextElement(empty, "p", "", "Add the first record to start your engineering history.");
    container.append(empty);
    return;
  }

  if (visible.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    appendTextElement(empty, "p", "empty-title", "No matching decisions.");
    appendTextElement(empty, "p", "", "Try a different search, owner, or status filter.");
    container.append(empty);
    return;
  }

  const list = document.createElement("ol");
  list.className = "decision-list";
  visible.forEach((decision, index) => {
    const item = document.createElement("li");
    const article = document.createElement("article");
    const detailLink = document.createElement("a");
    detailLink.className = "decision-card decision-detail-link";
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

    const meta = document.createElement("div");
    meta.className = "decision-meta";
    appendTextElement(meta, "span", `badge badge-${decision.status}`, decision.status);
    appendTextElement(meta, "time", "date", new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(decision.createdAt)))
      .dateTime = decision.createdAt;

    const title = appendTextElement(detailLink, "h3", "", decision.title);
    title.id = titleId;
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
    const owner = document.createElement("p");
    owner.className = "owner";
    appendTextElement(owner, "span", "owner-label", "Owner");
    owner.append(document.createTextNode(decision.owner));
    summary.prepend(meta);
    summary.append(owner);
    appendTextElement(summary, "span", "decision-action", "View decision details");
    detailLink.append(summary);
    article.append(detailLink);
    item.append(article);
    list.append(item);
  });
  container.append(list);
}

// Rebuilds the owner filter options from the current data while preserving the
// active selection when that owner still exists.
function syncOwnerOptions(select, decisions) {
  const current = select.value || "all";
  const owners = uniqueOwners(decisions);
  select.replaceChildren(new Option("All owners", "all"));
  for (const owner of owners) select.append(new Option(owner, owner));
  select.value = current === "all" || owners.includes(current) ? current : "all";
}

export function initDecisionLog(root = document, storage = localStorage) {
  const form = root.querySelector("#decision-form");
  const list = root.querySelector("#decision-list");
  const count = root.querySelector("#decision-count");
  const notice = root.querySelector("#storage-notice");
  const statusFilter = root.querySelector("#filter-status");
  const ownerFilter = root.querySelector("#filter-owner");
  const sortBy = root.querySelector("#sort-by");
  const search = root.querySelector("#decision-search");
  const clearFilters = root.querySelector("#clear-decision-filters");
  let decisions = loadDecisions(storage);

  const currentView = () => ({
    status: statusFilter?.value ?? "all",
    owner: ownerFilter?.value ?? "all",
    sort: sortBy?.value ?? DEFAULT_SORT,
    query: search?.value ?? "",
  });

  // Full refresh: re-derive owner options (data may have changed) then re-render.
  const refresh = () => {
    if (ownerFilter) syncOwnerOptions(ownerFilter, decisions);
    renderDecisions(list, count, decisions, currentView());
  };

  refresh();
  focusLinkedDecision(root);

  // Changing a filter/sort only re-renders; owner options are stable until the
  // data itself changes, so we deliberately do not resync them here.
  for (const control of [statusFilter, ownerFilter, sortBy]) {
    control?.addEventListener("change", () => renderDecisions(list, count, decisions, currentView()));
  }
  search?.addEventListener("input", () => renderDecisions(list, count, decisions, currentView()));
  clearFilters?.addEventListener("click", () => {
    if (search) search.value = "";
    if (statusFilter) statusFilter.value = "all";
    if (ownerFilter) ownerFilter.value = "all";
    if (sortBy) sortBy.value = DEFAULT_SORT;
    renderDecisions(list, count, decisions, currentView());
    search?.focus();
  });

  // Keyboard navigation is delegated to the list container so it survives every
  // re-render without re-binding. Each card is one native-link Tab stop; arrows
  // are an additional list-local shortcut and Enter activates the same link.
  list.addEventListener("keydown", (event) => {
    handleDecisionListKeydown(event, list);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const decision = createDecision(Object.fromEntries(new FormData(form)));
    decisions = [decision, ...decisions];
    try {
      saveDecisions(storage, decisions);
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
