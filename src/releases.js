// Release list view component.
//
// This module is intentionally split like app.js: a pure, DOM-free core
// (validation, ordering, association resolution, focus math) that is unit
// tested without a browser, and a thin rendering layer that turns the resolved
// data into accessible DOM. Data sourcing (storage, demo seed, future "record a
// release" form) lives in releases-page.js so this component stays reusable and
// testable in isolation.
//
// Tradeoff: this file deliberately does NOT import from app.js. The statuses are
// re-declared below rather than shared to avoid coupling the release view to the
// decision module's load-time side effects. The seam to unify them later is a
// small shared module; that abstraction is not yet earned by two call sites.

export const RELEASE_STORAGE_KEY = "shiplog.releases.v1";
export const RELEASE_STATUSES = ["planned", "completed", "cancelled"];

// Mirrors STATUSES in app.js. Kept local (see the module note above); the order
// here is the order breakdown counts are reported in.
export const RELEASE_DECISION_STATUSES = ["pending", "approved", "proposed", "accepted", "superseded"];

// URL builders are the single seam between views. They are pure and unit-tested
// so the routing shape lives in one place: the list links to a release detail
// page, and a release's decisions link to the decision's canonical location.
//
// A decision has no standalone detail page yet, so it is addressed as a native
// anchor on the decisions page (`/#decision-<id>`, matched by app.js's card id).
// The browser handles the scroll and `:target` highlights it — no router needed.
// The day a real decision page exists, only this one function changes.
export function releaseDetailHref(id) {
  return `/release.html?id=${encodeURIComponent(id)}`;
}

export function decisionDetailHref(id) {
  return `/#decision-${encodeURIComponent(id)}`;
}

function isRelease(value) {
  return value !== null
    && typeof value === "object"
    && typeof value.id === "string" && value.id.trim() !== ""
    && typeof value.version === "string" && value.version.trim() !== ""
    && typeof value.createdAt === "string"
    && !Number.isNaN(Date.parse(value.createdAt))
    && Array.isArray(value.decisionIds)
    && value.decisionIds.every((id) => typeof id === "string");
}

// Mirrors loadDecisions: tolerant of malformed storage, never throws, and drops
// entries that do not satisfy the release shape.
export function loadReleases(storage) {
  try {
    const value = JSON.parse(storage.getItem(RELEASE_STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter(isRelease) : [];
  } catch {
    return [];
  }
}

export function saveReleases(storage, releases) {
  storage.setItem(RELEASE_STORAGE_KEY, JSON.stringify(releases));
}

// Reverse chronological order (newest first). Never mutates the input. Ties fall
// back to input order via JS sort stability, matching app.js's "newest" sort.
export function sortReleasesNewestFirst(releases) {
  return [...releases].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function indexById(items) {
  const map = new Map();
  for (const item of items ?? []) map.set(item.id, item);
  return map;
}

// Resolve a release's decisionIds against the known decisions, preserving the
// association order. Ids with no matching decision are surfaced as `missingIds`
// rather than silently dropped — dangling references are a real cross-cutting
// risk (a decision can be absent after an export/import round-trip), so the view
// reports them instead of misrepresenting the count.
export function resolveRelease(release, decisions) {
  const lookup = decisions instanceof Map ? decisions : indexById(decisions);
  const linked = [];
  const missingIds = [];
  const associations = [];
  for (const id of release.decisionIds) {
    const decision = lookup.get(id);
    if (decision) {
      linked.push(decision);
      associations.push({ id, decision, missing: false });
    } else {
      missingIds.push(id);
      associations.push({ id, decision: null, missing: true });
    }
  }

  const counts = {
    total: release.decisionIds.length,
    linked: linked.length,
    missing: missingIds.length,
  };
  for (const status of RELEASE_DECISION_STATUSES) counts[status] = 0;
  for (const decision of linked) {
    if (counts[decision.status] !== undefined) counts[decision.status] += 1;
  }

  return { ...release, decisions: linked, missingIds, associations, counts };
}

// Compose ordering + resolution: the single entry point the view renders from.
export function summarizeReleases(releases, decisions = []) {
  const byId = indexById(decisions);
  return sortReleasesNewestFirst(releases).map((release) => resolveRelease(release, byId));
}

export function releaseStatus(release) {
  return RELEASE_STATUSES.includes(release?.status) ? release.status : "completed";
}

export function releaseTitle(release) {
  return typeof release?.title === "string" && release.title.trim() !== ""
    ? release.title
    : release?.version ?? "Untitled release";
}

export function releaseDescription(release) {
  return typeof release?.description === "string" && release.description.trim() !== ""
    ? release.description
    : typeof release?.notes === "string" ? release.notes : "";
}

// The complete list is composed and ordered before filtering, so changing
// filters never changes relative ordering. Search is deliberately a simple
// normalized substring match: predictable, fast for a local log, and equally
// usable for release copy and associated decisions. A decision contributes both
// its title and its context: the row surfaces the title, so a search for text a
// user can see must match it — matching context alone is a surprising dead end.
export function filterReleases(releases, decisions = [], filters = {}) {
  const status = RELEASE_STATUSES.includes(filters.status) ? filters.status : "all";
  const query = typeof filters.query === "string" ? filters.query.trim().toLocaleLowerCase() : "";
  return summarizeReleases(releases, decisions).filter((release) => {
    if (status !== "all" && releaseStatus(release) !== status) return false;
    if (!query) return true;
    const searchable = [
      releaseTitle(release),
      releaseDescription(release),
      ...release.decisions.flatMap((decision) => [decision.title, decision.context]),
    ];
    return searchable.some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(query));
  });
}

// Detail-view entry point: find one release by id and resolve its decisions.
// Returns null when the id is unknown so the view can render a "not found"
// state instead of guessing — a release reached by a stale link or a bad id is
// a real cross-cutting case, the same way dangling decision ids are handled.
export function resolveReleaseDetail(releases, decisions, id) {
  const release = (releases ?? []).find((candidate) => candidate.id === id);
  return release ? resolveRelease(release, decisions) : null;
}

// `author` was the original demo-data name. Prefer the product-facing `owner`
// field while retaining that alias so existing browser data and old exports do
// not lose attribution.
export function releaseOwner(release) {
  for (const value of [release?.owner, release?.author]) {
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return "Unknown";
}

// One-line status summary shown on the collapsed row, e.g.
// "3 decisions · 2 accepted, 1 proposed" (with a trailing "N missing" segment
// when there are dangling references).
export function statusSummaryText(resolved) {
  const { counts } = resolved;
  if (counts.total === 0) return "No linked decisions";
  const head = `${counts.total} ${counts.total === 1 ? "decision" : "decisions"}`;
  const parts = [];
  for (const status of RELEASE_DECISION_STATUSES) {
    if (counts[status] > 0) parts.push(`${counts[status]} ${status}`);
  }
  if (counts.missing > 0) parts.push(`${counts.missing} missing`);
  return parts.length ? `${head} · ${parts.join(", ")}` : head;
}

// Focus math for the release controls. Arrow/Home/End move focus and clamp at
// the ends (no wrap); Enter activates the selected release's detail action.
// Space retains the native button behavior and expands the inline disclosure.
const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", "Home", "End"]);

export function nextIndex(current, key, length) {
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

// ---------------------------------------------------------------------------
// Rendering layer. Everything below touches the DOM and is exercised in the
// browser; the pure core above is what the unit tests cover. Every field is
// written through textContent / text nodes (never HTML strings), so stored
// decision text can never execute (PRODUCT.md: no user-generated HTML).
// ---------------------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDate(iso) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
}

function renderReleaseBody(release) {
  const body = el("div", "release-body");

  const description = releaseDescription(release);
  if (description.trim() !== "") {
    body.append(el("p", "release-notes", description));
  }

  if (release.counts.total === 0) {
    body.append(el("p", "release-empty", "No decisions linked to this release."));
    return body;
  }

  const list = el("ol", "release-decisions");
  for (const decision of release.decisions) {
    const row = el("li", "release-decision");
    row.append(el("span", `badge badge-${decision.status}`, decision.status));
    row.append(el("span", "release-decision-title", decision.title));
    if (decision.owner) row.append(el("span", "release-decision-owner", decision.owner));
    list.append(row);
  }
  for (const id of release.missingIds) {
    const row = el("li", "release-decision release-decision-missing");
    row.append(el("span", "badge badge-missing", "missing"));
    const label = el("span", "release-decision-title");
    label.append(document.createTextNode("Linked decision "));
    label.append(el("code", undefined, id));
    label.append(document.createTextNode(" is not in this log."));
    row.append(label);
    list.append(row);
  }
  body.append(list);
  return body;
}

// The disclosure summarises a release inline; this link opens the full detail
// view. Added to every row (expanded or not) so the list stays a true index.
function renderDetailLink(release) {
  const link = el("a", "release-detail-link", "View release details");
  link.href = releaseDetailHref(release.id);
  link.append(el("span", "release-detail-arrow", "→"));
  link.querySelector(".release-detail-arrow").setAttribute("aria-hidden", "true");
  return link;
}

function renderReleaseItem(release) {
  const item = el("li", "release-item");
  const toggleId = `release-toggle-${release.id}`;
  const panelId = `release-panel-${release.id}`;

  const heading = el("h3", "release-heading");
  const toggle = el("button", "release-toggle");
  toggle.type = "button";
  toggle.id = toggleId;
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", panelId);
  toggle.dataset.releaseId = release.id;

  const info = el("span", "release-info");
  info.append(el("span", "release-version", releaseTitle(release)));
  info.append(el("span", `badge badge-release-${releaseStatus(release)}`, releaseStatus(release)));
  const time = el("time", "date", formatDate(release.createdAt));
  time.dateTime = release.createdAt;
  info.append(time);
  info.append(el("span", "release-summary", statusSummaryText(release)));

  const chevron = el("span", "release-chevron");
  chevron.setAttribute("aria-hidden", "true");
  toggle.append(info, chevron);
  heading.append(toggle);

  const panel = el("div", "release-panel");
  panel.id = panelId;
  panel.hidden = true;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-labelledby", toggleId);
  panel.append(renderReleaseBody(release));
  panel.append(renderDetailLink(release));

  item.append(heading, panel);
  return item;
}

export function renderReleaseList(container, resolvedReleases, options = {}) {
  container.replaceChildren();

  if (resolvedReleases.length === 0) {
    const empty = el("div", "empty-state");
    empty.append(el("p", "empty-title", options.filtered ? "No matching releases." : "No releases yet."));
    empty.append(el("p", undefined, options.filtered
      ? "Try a different search or status filter."
      : "Record a release and link the decisions behind it to build a shipping history."));
    container.append(empty);
    return;
  }

  const list = el("ol", "release-list");
  resolvedReleases.forEach((release) => {
    list.append(renderReleaseItem(release));
  });
  container.append(list);
}

function focusToggle(toggles, index) {
  toggles[index]?.focus();
}

export function handleReleaseListKeydown(event, container) {
  const toggle = event.target.closest?.(".release-toggle");
  if (!toggle || event.target !== toggle || !NAV_KEYS.has(event.key)) return false;
  const toggles = [...container.querySelectorAll(".release-toggle")];
  event.preventDefault();
  if (event.key === "Enter") {
    toggle.closest?.(".release-item")?.querySelector?.(".release-detail-link")?.click();
  } else {
    focusToggle(toggles, nextIndex(toggles.indexOf(toggle), event.key, toggles.length));
  }
  return true;
}

export function focusRelease(container, id) {
  if (typeof id !== "string" || id === "") return false;
  const toggle = [...container.querySelectorAll(".release-toggle")]
    .find((candidate) => candidate.dataset.releaseId === id);
  if (!toggle) return false;
  toggle.focus({ preventScroll: true });
  toggle.scrollIntoView({ block: "center" });
  return true;
}

// Wire the interactive behaviour. Handlers are delegated to the container so
// they survive a re-render without re-binding. Returns a small API so the page
// (or a future filter control) can re-render with fresh data.
export function mountReleaseList(container, data = {}) {
  let current = data;
  // Returns the releases actually shown so callers get the visible count from
  // the same computation that rendered them, rather than re-deriving it by
  // querying the rendered DOM (which would couple the page to class names here).
  const render = (next = current, filters = {}) => {
    current = next;
    const shown = filterReleases(current.releases ?? [], current.decisions ?? [], filters);
    const filtered = (filters.status !== undefined && filters.status !== "all") || Boolean(filters.query?.trim());
    renderReleaseList(container, shown, { filtered });
    return shown;
  };

  container.addEventListener("keydown", (event) => {
    handleReleaseListKeydown(event, container);
  });

  // Toggle the disclosure. Pointer clicks and Space activation on the native
  // button arrive here; Enter is intercepted above to open the detail view.
  container.addEventListener("click", (event) => {
    const toggle = event.target.closest?.(".release-toggle");
    if (!toggle) return;
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    const panel = container.ownerDocument.getElementById(toggle.getAttribute("aria-controls"));
    if (panel) panel.hidden = expanded;
  });

  render(data);
  return { render };
}

// ---------------------------------------------------------------------------
// Release detail view. A dedicated, deep-linkable page for one release. It is
// intentionally link-driven rather than interactive: the back link, each
// decision, and the missing-reference rows are plain anchors/semantics, so
// keyboard access and focus order come from the platform with no roving
// tabindex to maintain. Like the list, every field is written through
// textContent / text nodes — never HTML strings (PRODUCT.md: no user HTML).
// ---------------------------------------------------------------------------

export const RELEASE_LIST_HREF = "/releases.html";

export function releaseListHref(id) {
  return id ? `${RELEASE_LIST_HREF}?focus=${encodeURIComponent(id)}` : RELEASE_LIST_HREF;
}

function renderBackLink(releaseId) {
  const back = el("a", "detail-back");
  back.href = releaseListHref(releaseId);
  back.append(el("span", "detail-back-arrow", "←"));
  back.querySelector(".detail-back-arrow").setAttribute("aria-hidden", "true");
  back.append(document.createTextNode(" All releases"));
  return back;
}

function renderMetaRow(label, valueNode) {
  const row = el("div", "detail-meta-row");
  row.append(el("dt", "detail-meta-label", label));
  const dd = el("dd", "detail-meta-value");
  dd.append(valueNode);
  row.append(dd);
  return row;
}

function renderDetailDecision(decision) {
  const item = el("li");
  const link = el("a", "detail-decision");
  const summary = el("span", "detail-decision-summary");
  link.href = decisionDetailHref(decision.id);
  link.append(el("span", `badge badge-${decision.status}`, decision.status));
  summary.append(el("span", "detail-decision-title", decision.title));
  const alternativeText = typeof decision.alternatives === "string" && decision.alternatives.trim() !== ""
    ? decision.alternatives
    : "No alternatives recorded.";
  const alternatives = el("span", "detail-decision-alternatives");
  alternatives.append(el("span", "detail-decision-alternatives-label", "Alternatives"));
  alternatives.append(document.createTextNode(alternativeText));
  summary.append(alternatives);
  link.append(summary);
  if (decision.owner) {
    const owner = el("span", "detail-decision-owner");
    owner.append(el("span", "detail-decision-owner-label", "Owner"));
    owner.append(document.createTextNode(decision.owner));
    link.append(owner);
  }
  const arrow = el("span", "detail-decision-arrow", "→");
  arrow.setAttribute("aria-hidden", "true");
  link.append(arrow);
  item.append(link);
  return item;
}

function renderMissingDecision(id) {
  const item = el("li", "detail-decision-missing");
  item.append(el("span", "badge badge-missing", "missing"));
  const label = el("span", "detail-decision-title");
  label.append(document.createTextNode("Linked decision "));
  label.append(el("code", undefined, id));
  label.append(document.createTextNode(" is not in this log."));
  item.append(label);
  return item;
}

function renderDetailDecisions(resolved) {
  const section = el("section", "detail-decisions");
  section.setAttribute("aria-labelledby", "detail-decisions-title");
  section.append(el("h2", "detail-decisions-heading", "Decisions in this release"));
  section.querySelector(".detail-decisions-heading").id = "detail-decisions-title";
  section.append(el("p", "detail-summary", statusSummaryText(resolved)));

  if (resolved.counts.total === 0) {
    section.append(el("p", "release-empty", "No decisions linked to this release."));
    return section;
  }

  const list = el("ol", "detail-decision-list");
  // Keep the release author's association order, including dangling records.
  // Grouping missing references at the end would subtly rewrite that history.
  for (const association of resolved.associations) {
    list.append(association.missing
      ? renderMissingDecision(association.id)
      : renderDetailDecision(association.decision));
  }
  section.append(list);
  return section;
}

// Render the whole detail view into `container`. `resolved` is the output of
// resolveReleaseDetail, or null when the id was not found — the back link is
// rendered either way so a stale link is never a dead end. `options.id` lets the
// not-found state name the id that failed to resolve.
export function renderReleaseDetail(container, resolved, options = {}) {
  container.replaceChildren();
  container.append(renderBackLink(resolved?.id));

  if (!resolved) {
    const empty = el("div", "empty-state");
    empty.append(el("h1", "empty-title", "Release not found."));
    const detail = el("p");
    if (options.id) {
      detail.append(document.createTextNode("No release matches "));
      detail.append(el("code", undefined, options.id));
      detail.append(document.createTextNode(" in this log."));
    } else {
      detail.textContent = "This link is missing a release id.";
    }
    empty.append(detail);
    container.append(empty);
    return;
  }

  const article = el("article", "release-detail");
  const header = el("header", "detail-header");
  header.append(el("p", "eyebrow", "Release"));
  header.append(el("h1", "detail-version", resolved.version));

  const meta = el("dl", "detail-meta");
  const time = el("time", "date");
  time.dateTime = resolved.createdAt;
  time.textContent = formatDate(resolved.createdAt);
  meta.append(renderMetaRow("Released", time));
  meta.append(renderMetaRow("Owner", document.createTextNode(releaseOwner(resolved))));
  header.append(meta);

  if (typeof resolved.notes === "string" && resolved.notes.trim() !== "") {
    header.append(el("p", "detail-notes", resolved.notes));
  }

  article.append(header);
  article.append(renderDetailDecisions(resolved));
  container.append(article);
}
