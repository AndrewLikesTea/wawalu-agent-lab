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

import { DECISION_STATUSES, canonicalDecisionStatus } from "./decision-status.js";
import { retentionDeclined, retentionRefusal } from "./local-retention.js";
import { createShareControl } from "./share-link.js";
import { EXAMPLE_LABEL } from "./seed-records.js";

export const RELEASE_STORAGE_KEY = "shiplog.releases.v1";
export const RELEASE_STATUSES = ["planned", "completed", "cancelled"];

// Decision status is a different vocabulary from release status above: a
// release is planned, completed, or cancelled, and never accepted or
// superseded. The two lists stay apart. The decision words come from the shared
// module (see the module note: three call sites earned it); the order here is
// the order breakdown counts are reported in.
export const RELEASE_DECISION_STATUSES = DECISION_STATUSES;

// `missing` is not a decision status. It is the state of an *association* whose
// decision is not in this log — the dangling reference resolveRelease() already
// surfaces, which an export/import round trip can leave behind. It sits in the
// filter vocabulary because it is the one thing a reader of this list can act
// on and cannot otherwise see without expanding every release in turn.
export const MISSING_DECISION_FILTER = "missing";

// The linked-decision filter for the shipping history. Filtering by decision
// status asks "which releases carried at least one decision in this state",
// which is a different question from the release-status control ("which
// releases are planned/completed/cancelled"). They stay separate controls.
//
// The words are the shared vocabulary in lifecycle order; a test pins them
// against DECISION_STATUSES so this list cannot drift from the log's.
export const RELEASE_DECISION_STATUS_FILTERS = Object.freeze([
  { value: "all", label: "Any status" },
  { value: "proposed", label: "Proposed" },
  { value: "pending", label: "Pending" },
  { value: "accepted", label: "Accepted" },
  { value: "superseded", label: "Superseded" },
  { value: MISSING_DECISION_FILTER, label: "Missing decision" },
]);

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
  return `/decision.html?id=${encodeURIComponent(id)}`;
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

// Mirrors saveDecisions: the same explicit "do not keep records in this browser"
// choice governs both stores, and it is read from local-retention.js — a module
// with no dependencies of its own, so this file still imports nothing from
// app.js.
export function saveReleases(storage, releases) {
  if (retentionDeclined(storage)) throw retentionRefusal();
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
    const status = canonicalDecisionStatus(decision.status);
    if (counts[status] !== undefined) counts[status] += 1;
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
  const { status, decisionStatus, query } = normalizeReleaseFilters(filters);
  const normalizedQuery = query.toLocaleLowerCase();
  return summarizeReleases(releases, decisions).filter((release) => {
    if (status !== "all" && releaseStatus(release) !== status) return false;
    if (!matchesDecisionStatus(release, decisionStatus)) return false;
    if (!normalizedQuery) return true;
    const searchable = [
      releaseTitle(release),
      releaseDescription(release),
      ...release.decisions.flatMap((decision) => [decision.title, decision.context]),
    ];
    return searchable.some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(normalizedQuery));
  });
}

// Unknown values fall back to the default view rather than matching nothing:
// a stale bookmark or a hand-edited control can never empty the history.
export function decisionStatusFilter(value) {
  return RELEASE_DECISION_STATUS_FILTERS.some((option) => option.value === value) ? value : "all";
}

// The page, list renderer, and tests may all call the filtering API. Normalize
// their input at that boundary so selection and empty-state messaging cannot
// interpret the same malformed or stale value differently.
export function normalizeReleaseFilters(filters = {}) {
  const input = filters !== null && typeof filters === "object" ? filters : {};
  return {
    status: RELEASE_STATUSES.includes(input.status) ? input.status : "all",
    decisionStatus: decisionStatusFilter(input.decisionStatus),
    query: typeof input.query === "string" ? input.query.trim() : "",
  };
}

// A release matches when it carries at least one decision in the chosen state.
// This reads the counts resolveRelease() already derived — including its
// `missing` tally — so the filter and the row's own breakdown can never
// disagree, and the fold of the retired "approved" onto "accepted" applies here
// for free rather than being restated.
export function matchesDecisionStatus(resolved, value) {
  const filter = decisionStatusFilter(value);
  if (filter === "all") return true;
  return (resolved?.counts?.[filter] ?? 0) > 0;
}

// Whether the visible list is a narrowed view of the history. Used for the
// no-match state (which offers a reset) rather than the first-run empty state.
export function releaseFiltersActive(filters = {}) {
  const normalized = normalizeReleaseFilters(filters);
  return normalized.status !== "all"
    || normalized.decisionStatus !== "all"
    || normalized.query !== "";
}

// The one material count for the active filter, derived once and rendered in
// exactly one place. Nothing else on the page states how many releases matched,
// so a reader never has to reconcile two numbers answering the same question.
export function releaseCountText(visible, total) {
  return `${visible} of ${total} ${total === 1 ? "release" : "releases"}`;
}

// ---------------------------------------------------------------------------
// Follow-up. A release needs attention when a decision it carried is not
// settled, or when the association points at a decision this log does not hold.
//
// The order below is the order the single follow-up is chosen in: a dangling
// reference is a broken record and outranks an unsettled one, and among
// unsettled decisions the earlier the lifecycle stage, the more urgent the
// follow-up. `accepted` is absent on purpose — a release carrying only accepted
// decisions is the state everything else is trying to reach.
// ---------------------------------------------------------------------------

export const RELEASE_ATTENTION_KINDS = Object.freeze([
  MISSING_DECISION_FILTER,
  "proposed",
  "pending",
  "superseded",
]);

// The most urgent thing about one release, or null when nothing is outstanding.
export function releaseAttentionKind(resolved) {
  return RELEASE_ATTENTION_KINDS.find((kind) => (resolved?.counts?.[kind] ?? 0) > 0) ?? null;
}

// Linked-decision fields arrive from storage and from imports, so a decision
// may reach here without a usable title. Naming it by id keeps the follow-up
// specific — "resolve d-queue" is still actionable; "resolve a decision" is not.
function decisionLabel(decision) {
  for (const value of [decision?.title, decision?.id]) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "an untitled decision";
}

// Copy per kind. Each entry states what is outstanding, what the action does,
// and — separately, so it can describe the link rather than replace its label —
// where the link goes and what is waiting there.
const FOLLOW_UP_COPY = {
  [MISSING_DECISION_FILTER]: {
    lead: (release) => `${releaseTitle(release)} links a decision that is not in this log.`,
    action: (release) => `Check the reference on ${releaseTitle(release)}`,
    target: (release) => `Opens the release detail for ${releaseTitle(release)}, where the decision id that did not resolve is listed.`,
  },
  proposed: {
    lead: (release, name) => `“${name}” shipped in ${releaseTitle(release)} while still proposed.`,
    action: (release, name) => `Decide on “${name}”`,
    target: (release, name) => `Opens the decision detail for “${name}”, with the context and alternatives behind it.`,
  },
  pending: {
    lead: (release, name) => `“${name}” is still pending in ${releaseTitle(release)}.`,
    action: (release, name) => `Settle “${name}”`,
    target: (release, name) => `Opens the decision detail for “${name}”, with the context and alternatives behind it.`,
  },
  superseded: {
    lead: (release, name) => `${releaseTitle(release)} carried “${name}”, which a later decision replaced.`,
    action: (release, name) => `Review “${name}”`,
    target: (release, name) => `Opens the decision detail for “${name}”, which names the decision that replaced it.`,
  },
};

// The single most relevant follow-up across the releases currently on screen,
// or null when none of them needs one. `resolvedReleases` is already newest
// first, so the release chosen for a kind is the most recent one carrying it.
//
// Deliberately counts nothing: the matching-record count above is the page's
// one number, and a second "N need attention" would compete with it.
export function releaseFollowUp(resolvedReleases = []) {
  for (const kind of RELEASE_ATTENTION_KINDS) {
    const release = (resolvedReleases ?? []).find((candidate) => (candidate?.counts?.[kind] ?? 0) > 0);
    if (!release) continue;
    const copy = FOLLOW_UP_COPY[kind];
    if (kind === MISSING_DECISION_FILTER) {
      return {
        kind,
        releaseId: release.id,
        decisionId: release.missingIds[0] ?? null,
        href: releaseDetailHref(release.id),
        lead: copy.lead(release),
        action: copy.action(release),
        target: copy.target(release),
      };
    }
    const decision = release.decisions.find((candidate) => canonicalDecisionStatus(candidate?.status) === kind);
    const name = decisionLabel(decision);
    const addressable = typeof decision?.id === "string" && decision.id.trim() !== "";
    return {
      kind,
      releaseId: release.id,
      decisionId: addressable ? decision.id : null,
      // A decision with no id cannot be addressed, so the follow-up falls back
      // to the release that carries it rather than rendering a broken link.
      href: addressable ? decisionDetailHref(decision.id) : releaseDetailHref(release.id),
      lead: copy.lead(release, name),
      action: addressable ? copy.action(release, name) : `Open ${releaseTitle(release)}`,
      target: addressable
        ? copy.target(release, name)
        : `Opens the release detail for ${releaseTitle(release)}, where “${name}” is listed.`,
    };
  }
  return null;
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

// Disclosure state is independent of the DOM so a filter-driven re-render does
// not unexpectedly collapse releases the user already opened. Unknown ids are
// ignored, which also makes the state safe when fresh data replaces the list.
export function createReleaseListState(releases = [], expandedIds = []) {
  const validIds = new Set(releases.map(({ id }) => id));
  return {
    expandedIds: [...new Set(expandedIds)].filter((id) => validIds.has(id)),
  };
}

export function toggleReleaseExpanded(state, id, releases = []) {
  if (!releases.some((release) => release.id === id)) return state;
  const expanded = new Set(state.expandedIds);
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
  return { expandedIds: [...expanded] };
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

function labelledValue(label, value, className = "") {
  const pair = el("span", `meta-pair ${className}`.trim());
  pair.append(el("span", "meta-label", `${label}:`));
  pair.append(el("span", "meta-value", value));
  return pair;
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
    // Canonical, so the word inside the disclosure is the word the filter and
    // the collapsed breakdown used to select and count this release.
    const status = canonicalDecisionStatus(decision.status);
    row.append(labelledValue("Status", status, `badge badge-${status}`));
    // The evidence is inspectable, not just visible: the title is the link to
    // the decision this release is associated with, so the association can be
    // followed from the row that claims it. A record with no usable id is named
    // rather than linked — a link to `?id=undefined` is worse than plain text.
    const name = decisionLabel(decision);
    if (typeof decision.id === "string" && decision.id.trim() !== "") {
      const link = el("a", "release-decision-title release-decision-link", name);
      link.href = decisionDetailHref(decision.id);
      row.append(link);
    } else {
      row.append(el("span", "release-decision-title", name));
    }
    if (decision.owner) row.append(labelledValue("Owner", decision.owner, "release-decision-owner"));
    list.append(row);
  }
  for (const id of release.missingIds) {
    const row = el("li", "release-decision release-decision-missing");
    row.append(labelledValue("Status", "missing", "badge badge-missing"));
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

function renderReleaseItem(release, index, expanded = false, example = false) {
  const item = el("li", "release-item");
  // Render-local ids keep arbitrary stored release ids out of ARIA IDREFs.
  const toggleId = `release-toggle-${index}`;
  const panelId = `release-panel-${index}`;

  const heading = el("h3", "release-heading");
  const toggle = el("button", "release-toggle");
  toggle.type = "button";
  toggle.id = toggleId;
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.setAttribute("aria-controls", panelId);
  toggle.dataset.releaseId = release.id;

  const info = el("span", "release-info");
  info.append(el("span", "release-version", releaseTitle(release)));
  // Inside the toggle, so the label is part of the row's accessible name: a
  // screen reader hears that this release is invented before it hears its
  // status or the decisions it carried, rather than after or not at all.
  if (example) info.append(el("span", "badge badge-example", EXAMPLE_LABEL));
  info.append(labelledValue("Status", releaseStatus(release), `badge badge-release-${releaseStatus(release)}`));
  const time = el("time", "date", formatDate(release.createdAt));
  time.dateTime = release.createdAt;
  const datePair = el("span", "meta-pair date");
  datePair.append(el("span", "meta-label", "Released:"));
  datePair.append(time);
  info.append(datePair);
  info.append(labelledValue("Decisions", statusSummaryText(release), "release-summary"));

  const chevron = el("span", "release-chevron");
  chevron.setAttribute("aria-hidden", "true");
  toggle.append(info, chevron);
  heading.append(toggle);

  const panel = el("div", "release-panel");
  panel.id = panelId;
  panel.hidden = !expanded;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-labelledby", toggleId);
  panel.append(renderReleaseBody(release));
  panel.append(renderDetailLink(release));

  item.append(heading, panel);
  return item;
}

export function renderReleaseList(container, resolvedReleases, options = {}) {
  container.replaceChildren();
  container.setAttribute("aria-busy", "false");

  if (resolvedReleases.length === 0) {
    renderReleaseListState(container, "empty", { filtered: options.filtered, actions: true });
    return;
  }

  const list = el("ol", "release-list");
  const expandedIds = new Set(options.expandedIds ?? []);
  // Which of these rows are the shipped examples rather than the visitor's own
  // records. Absent by default, so a caller that has no such distinction to
  // draw renders exactly what it did before.
  const exampleIds = options.exampleIds instanceof Set
    ? options.exampleIds
    : new Set(options.exampleIds ?? []);
  resolvedReleases.forEach((release, index) => {
    list.append(renderReleaseItem(release, index, expandedIds.has(release.id), exampleIds.has(release.id)));
  });
  container.append(list);
}

export function renderReleaseListState(container, state, options = {}) {
  container.replaceChildren();
  container.setAttribute("aria-busy", String(state === "loading"));
  const panel = el("div", `list-state list-state-${state}`);
  panel.setAttribute("role", state === "error" ? "alert" : "status");
  const noun = options.singular ? "release" : "releases";
  const copy = {
    loading: [`Loading ${noun}`, `Finding ${options.singular ? "the latest release" : "your shipping history"}…`],
    error: [`${options.singular ? "Release" : "Releases"} could not be loaded`, "Try reloading this page. Your saved records have not been changed."],
    // Two empty states, kept distinct on purpose: "nothing recorded yet" is a
    // first-run state whose one next step is recording a release, while "no
    // release matches" is a filter state whose one next step is clearing them.
    empty: options.filtered
      ? ["No matching releases", "No release matches the current search, release status, and linked decision status together."]
      : ["No releases yet", "Record a release and link the decisions behind it to build a shipping history."],
  }[state];
  panel.append(el("h3", undefined, copy[0]));
  panel.append(el("p", undefined, copy[1]));
  // The next step is offered only where one exists to take. The homepage sample
  // panel renders this same state without controls to reset or a form to fill,
  // so it opts out rather than showing an action that would go nowhere.
  if (state === "empty" && options.actions) {
    const action = el(
      "button",
      `empty-action ${options.filtered ? "release-reset-action" : "release-empty-action"}`,
      options.filtered ? "Clear filters" : "Record a release",
    );
    action.type = "button";
    action.dataset.action = options.filtered ? "reset-filters" : "record-release";
    action.setAttribute("aria-controls", options.filtered ? "release-list" : "release-form");
    panel.append(action);
  }
  container.append(panel);
}

// Render-local, like the disclosure's toggle/panel ids: one follow-up exists at
// a time, so the wiring below needs no counter to stay unique.
const FOLLOW_UP_TITLE_ID = "release-followup-title";
const FOLLOW_UP_TARGET_ID = "release-followup-target";

// The prioritised follow-up for the releases currently on screen, rendered into
// its own slot above the list. Hidden outright when nothing is outstanding: an
// empty callout would still take a line and still be read out.
//
// Prominence is both visual (see .release-followup) and semantic: the callout
// is a labelled section ahead of the list, its action is a real link, and the
// link is described by the sentence naming where it goes and what is there.
export function renderReleaseFollowUp(container, followUp) {
  container.replaceChildren();
  container.hidden = !followUp;
  if (!followUp) return;

  const panel = el("section", `release-followup release-followup-${followUp.kind}`);
  panel.setAttribute("aria-labelledby", FOLLOW_UP_TITLE_ID);
  const heading = el("h3", "release-followup-title", "Needs a follow-up");
  heading.id = FOLLOW_UP_TITLE_ID;
  panel.append(heading);
  panel.append(el("p", "release-followup-lead", followUp.lead));

  const link = el("a", "release-followup-action", followUp.action);
  link.href = followUp.href;
  link.setAttribute("aria-describedby", FOLLOW_UP_TARGET_ID);
  const arrow = el("span", "release-followup-arrow", "→");
  arrow.setAttribute("aria-hidden", "true");
  link.append(arrow);
  panel.append(link);

  const target = el("p", "release-followup-target", followUp.target);
  target.id = FOLLOW_UP_TARGET_ID;
  panel.append(target);
  container.append(panel);
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
  let state = createReleaseListState(current.releases ?? []);
  // Returns the releases actually shown so callers get the visible count from
  // the same computation that rendered them, rather than re-deriving it by
  // querying the rendered DOM (which would couple the page to class names here).
  const render = (next = current, filters = {}) => {
    current = next;
    state = createReleaseListState(current.releases ?? [], state.expandedIds);
    const shown = filterReleases(current.releases ?? [], current.decisions ?? [], filters);
    const filtered = releaseFiltersActive(filters);
    renderReleaseList(container, shown, {
      filtered,
      expandedIds: state.expandedIds,
      exampleIds: current.exampleIds,
    });
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
    state = toggleReleaseExpanded(state, toggle.dataset.releaseId, current.releases ?? []);
    const expanded = state.expandedIds.includes(toggle.dataset.releaseId);
    toggle.setAttribute("aria-expanded", String(expanded));
    const panel = container.ownerDocument.getElementById(toggle.getAttribute("aria-controls"));
    if (panel) panel.hidden = !expanded;
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
  // The identifier travels with the title so a linked decision can be matched
  // to an export, an import error, or a missing-reference row above it — those
  // name the decision by id, and two decisions may share a title.
  const identifier = el("span", "detail-decision-identifier");
  identifier.append(el("span", "detail-decision-identifier-label", "ID"));
  identifier.append(el("code", undefined, decision.id));
  summary.append(identifier);
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
  const heading = el("div", "detail-heading");
  heading.append(el("p", "eyebrow", `Release · ${resolved.version}`));
  heading.append(el("h1", "detail-version", releaseTitle(resolved)));
  // Same disclosure the list row carries, for a reader who arrived by URL.
  if (options.example === true) heading.append(el("span", "badge badge-example", EXAMPLE_LABEL));
  if (options.shareable) {
    const share = createShareControl({ type: "release", id: resolved.id });
    if (share) heading.append(share);
  }
  header.append(heading);

  const meta = el("dl", "detail-meta");
  const time = el("time", "date");
  time.dateTime = resolved.createdAt;
  time.textContent = formatDate(resolved.createdAt);
  meta.append(renderMetaRow("Released", time));
  meta.append(renderMetaRow("Owner", document.createTextNode(releaseOwner(resolved))));
  meta.append(renderMetaRow("Status", el("span", `badge badge-release-${releaseStatus(resolved)}`, releaseStatus(resolved))));
  header.append(meta);

  // Description first, notes as the fallback (releaseDescription's rule), so a
  // release recorded through the form — which writes `description` and never
  // the older `notes` — shows its copy here the way an imported record does.
  const summary = releaseDescription(resolved);
  if (summary.trim() !== "") header.append(el("p", "detail-notes", summary));

  article.append(header);
  article.append(renderDetailDecisions(resolved));
  container.append(article);
}
