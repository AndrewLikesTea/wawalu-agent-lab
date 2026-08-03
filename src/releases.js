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
//
// The label says so: it selects releases whose linked decision id resolves to
// nothing, not releases with no decisions at all (those cannot exist — the
// recorder requires one). The value stays `missing` because the control, the
// URL, and the counts key off it.
export const MISSING_DECISION_FILTER = "missing";

// The linked-decision filter for the release log. Filtering by decision
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
  { value: MISSING_DECISION_FILTER, label: "Decision not in this log" },
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

/**
 * This browser's store, or nothing where it is refused outright.
 *
 * Acquiring it lives beside the loader that reads it, mirroring
 * `browserOrgUnitLabelStorage`: the store is a getter that throws in some embedded
 * contexts, and a page that only wants to *count* releases should not be the layer
 * that reaches for it. The AI FinOps page in particular is asserted to name no
 * storage API at all, so this is the seam it reads the release log through.
 */
export function browserReleaseStorage(scope = globalThis) {
  try {
    return scope?.localStorage ?? null;
  } catch {
    return null;
  }
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
  const { status, decisionStatus, decisionId, query } = normalizeReleaseFilters(filters);
  const normalizedQuery = query.toLocaleLowerCase();
  return summarizeReleases(releases, decisions).filter((release) => {
    if (status !== "all" && releaseStatus(release) !== status) return false;
    if (!matchesDecisionStatus(release, decisionStatus)) return false;
    if (!matchesDecisionId(release, decisionId)) return false;
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
    decisionId: decisionIdFilter(input.decisionId),
    query: typeof input.query === "string" ? input.query.trim() : "",
  };
}

// ---------------------------------------------------------------------------
// Narrowing the releases to one decision: "which releases carried the
// decision I am looking at". Unlike the status filter, the vocabulary is the
// visitor's own log, so the value cannot be validated here — the page checks it
// against the decisions it holds before applying it, the same way the decision
// list validates its own restored filter.
//
// It rides in the query string for the same reason the decisions history's
// current-only filter does (see app.js): a link to a narrowed history is worth
// sharing, an absent parameter is simply the default, and nothing new has to be
// persisted for a reload to land on the same view.
// ---------------------------------------------------------------------------

export const DECISION_FILTER_PARAM = "decision";
export const ALL_DECISIONS_FILTER = "all";

export function decisionIdFilter(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : ALL_DECISIONS_FILTER;
}

export function readDecisionFilter(search = "") {
  try {
    return decisionIdFilter(new URLSearchParams(search).get(DECISION_FILTER_PARAM));
  } catch {
    return ALL_DECISIONS_FILTER;
  }
}

// Rewrites only this parameter and leaves every other one in place, so the
// release filters never clobber the `focus` parameter a deep link carries.
export function decisionFilterSearch(search = "", decisionId = ALL_DECISIONS_FILTER) {
  const params = new URLSearchParams(search);
  const value = decisionIdFilter(decisionId);
  if (value === ALL_DECISIONS_FILTER) params.delete(DECISION_FILTER_PARAM);
  else params.set(DECISION_FILTER_PARAM, value);
  const query = params.toString();
  return query ? `?${query}` : "";
}

// A release matches when it is associated with this decision at all — including
// through a reference that no longer resolves, so filtering by a decision that
// was later deleted still finds the releases that named it.
export function matchesDecisionId(resolved, value) {
  const filter = decisionIdFilter(value);
  if (filter === ALL_DECISIONS_FILTER) return true;
  return (resolved?.associations ?? []).some((association) => association.id === filter);
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
    || normalized.decisionId !== ALL_DECISIONS_FILTER
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

// The subset a reader can still settle *as a decision*: the stages before the
// lifecycle reaches a final word. A dangling reference is a broken record, not
// an open question, and a superseded decision was already answered by a later
// one — both are release-level problems, so a caller asking "which decision
// here is not final yet" must not be handed either. It lives here and not in
// each caller because the words are the log's vocabulary, not one view's.
export const OPEN_DECISION_KINDS = Object.freeze(["proposed", "pending"]);

// The most urgent thing about one release, or null when nothing is outstanding.
// `kinds` narrows what counts as outstanding; it is a subset of the list above,
// read in the same priority order.
export function releaseAttentionKind(resolved, kinds = RELEASE_ATTENTION_KINDS) {
  return kinds.find((kind) => (resolved?.counts?.[kind] ?? 0) > 0) ?? null;
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

// ---------------------------------------------------------------------------
// The follow-up for ONE release.
//
// releaseFollowUp() above answers the list's question — "which release on this
// screen needs attention?". This answers the question a lead asks after opening
// one: "of the decisions this release carried, which do I chase next, and why
// does it matter?". Both read RELEASE_ATTENTION_KINDS, so the two surfaces can
// never disagree about what is outstanding or in which order.
//
// The settled state in this log is `accepted`; there is no separate "completed"
// decision status (see decision-status.js — the whole vocabulary is proposed,
// pending, accepted, superseded). A release whose linked decisions are all
// accepted therefore has no follow-up, and the detail view renders none.
// ---------------------------------------------------------------------------

// Where someone is sent to enter a record that is missing. Declared here rather
// than imported from release-form.js, which already imports this module and
// would make the cycle; a test pins the two values equal.
export const RECORD_DECISION_HREF = "/#decision-form";

// Attribution for a linked decision, with the same `author` alias releases
// accept. "Unassigned" is a statement about the record, not a guess: a decision
// nobody owns is exactly why a follow-up stalls, so the callout says so.
export function decisionOwner(decision) {
  for (const value of [decision?.owner, decision?.author]) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "Unassigned";
}

// ---------------------------------------------------------------------------
// The rationale behind a linked decision, previewed where the release is read.
//
// A release manager opening a release asks "what did we decide, and why" before
// anything else. `context` is the field the decision recorder writes for the
// why; nothing else on a decision answers it, so an absent one is stated rather
// than substituted from a neighbouring field that means something different.
//
// The preview is clipped in JS as well as in CSS. CSS alone would leave the
// whole rationale in the accessible name of the row that links to the record —
// a screen reader would hear the full text where a sighted reader sees three
// lines, and the two surfaces would stop matching. Clipping here keeps them the
// same, and the link to the full record is what carries the rest.
// ---------------------------------------------------------------------------

export const NO_RATIONALE_TEXT = "No rationale recorded.";
export const RATIONALE_PREVIEW_LENGTH = 180;

export function decisionRationale(decision) {
  const value = decision?.context;
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function decisionRationalePreview(decision, limit = RATIONALE_PREVIEW_LENGTH) {
  const value = decisionRationale(decision);
  if (value === "") return NO_RATIONALE_TEXT;
  if (value.length <= limit) return value;
  const clipped = value.slice(0, limit);
  const boundary = clipped.lastIndexOf(" ");
  // Prefer a word boundary, but only when one is near the end: clipping a long
  // unbroken run back to its first space would throw away most of the preview.
  const body = boundary > limit * 0.6 ? clipped.slice(0, boundary) : clipped;
  return `${body.trimEnd()}…`;
}

// The decision that governs a release: the first one linked to it. The order a
// release carries is the order the recorder ticked its decisions in (see
// release-form.js — the selection is an ordered list precisely so this survives
// a re-render), so the head of that list is the choice the recorder made about
// which decision the release stands on, not a guess made here.
//
// Returns the association rather than the decision, so a governing reference
// that no longer resolves is still reported instead of read as "none".
export function governingAssociation(resolved) {
  return resolved?.associations?.[0] ?? null;
}

// Why this one decision matters *to this release*, what to do, and where the
// action goes. Split the same way the list callout's copy is: the reason can be
// read on its own, and the target sentence describes the link rather than
// replacing its label.
const DECISION_FOLLOW_UP_COPY = {
  [MISSING_DECISION_FILTER]: {
    reason: (release) => `${releaseTitle(release)} names this decision, but the record is not in this log — the reasoning behind the release cannot be reviewed.`,
    action: () => "Record the missing decision",
    target: () => "Opens the decision recorder on the decisions page, where the absent record can be entered.",
  },
  proposed: {
    reason: (release, name) => `“${name}” is still proposed, so ${releaseTitle(release)} has no recorded decision to stand behind.`,
    action: (release, name) => `Decide on “${name}”`,
    target: (release, name) => `Opens the decision record for “${name}”, with the context and alternatives behind it.`,
  },
  pending: {
    reason: (release, name) => `“${name}” is still pending, so ${releaseTitle(release)} has no recorded outcome for it.`,
    action: (release, name) => `Settle “${name}”`,
    target: (release, name) => `Opens the decision record for “${name}”, with the context and alternatives behind it.`,
  },
  superseded: {
    reason: (release, name) => `A later decision replaced “${name}”, so ${releaseTitle(release)} is linked to reasoning this log no longer treats as current.`,
    action: (release, name) => `Review “${name}”`,
    target: (release, name) => `Opens the decision record for “${name}”, which names the decision that replaced it.`,
  },
};

/**
 * The next decision to chase on one resolved release, or null when nothing is
 * outstanding. `resolved` is the output of resolveRelease/resolveReleaseDetail.
 *
 * Ordering: a dangling reference outranks an unsettled decision (a broken
 * record cannot be reviewed at all), and among unsettled ones the earlier the
 * lifecycle stage the more urgent. Within a single kind the release author's
 * association order decides, so the answer is stable across renders and matches
 * the order the evidence list below is read in.
 *
 * `kinds` narrows what the release is asked about. A caller that only wants an
 * unsettled decision passes OPEN_DECISION_KINDS and gets one whether or not the
 * release also has a dangling reference: a broken link outranks a pending
 * decision here, but it must not stand in for one on a surface that promised an
 * open decision and would otherwise show nothing.
 */
export function releaseDecisionFollowUp(resolved, kinds = RELEASE_ATTENTION_KINDS) {
  const kind = releaseAttentionKind(resolved, kinds);
  if (!kind) return null;
  const copy = DECISION_FOLLOW_UP_COPY[kind];

  if (kind === MISSING_DECISION_FILTER) {
    const decisionId = resolved.missingIds[0];
    return {
      kind,
      decisionId,
      title: null,
      status: "missing",
      // Not "Unassigned": the record may well have an owner. This log does not
      // hold it, and saying so is the honest state.
      owner: "Unknown",
      reason: copy.reason(resolved),
      action: copy.action(),
      href: RECORD_DECISION_HREF,
      target: copy.target(),
    };
  }

  const decision = resolved.decisions.find((candidate) => canonicalDecisionStatus(candidate?.status) === kind);
  const name = decisionLabel(decision);
  // A decision with no usable id cannot be addressed, so the callout names it
  // and says why it cannot be opened rather than rendering a broken link.
  const addressable = typeof decision?.id === "string" && decision.id.trim() !== "";
  return {
    kind,
    decisionId: addressable ? decision.id : null,
    title: name,
    status: kind,
    owner: decisionOwner(decision),
    reason: copy.reason(resolved, name),
    action: addressable ? copy.action(resolved, name) : null,
    href: addressable ? decisionDetailHref(decision.id) : null,
    target: addressable
      ? copy.target(resolved, name)
      : "This decision has no id, so it has no record to open. It is listed below as it was linked.",
  };
}

// The detail view can answer only the decision-record part of release
// readiness. Operational checks, approvals, and deployment state do not exist
// in this product, so this conclusion deliberately makes no claim about them.
// "Clear" means exactly: at least one decision is linked, every reference
// resolves, and every linked decision canonicalizes to `accepted`.
export function releaseDecisionReadinessText(resolved) {
  if ((resolved?.counts?.total ?? 0) === 0) {
    return "Decision check: Unknown — no decisions are linked.";
  }
  if (releaseAttentionKind(resolved)) {
    return "Decision check: Follow-up required — at least one linked decision is missing, proposed, pending, or superseded.";
  }
  return "Decision check: Clear — every linked decision is accepted.";
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
    // One line, not two: a wait is stated once. The wording matches the loading
    // state shipped in src/releases.html character for character, so the markup
    // a visitor reads before this script runs and the markup it draws after are
    // the same sentence.
    loading: [`Loading ${noun}…`],
    error: [`${options.singular ? "Release" : "Releases"} could not be loaded`, "Try reloading this page. Your saved records have not been changed."],
    // Two empty states, kept distinct on purpose: "nothing recorded yet" is a
    // first-run state whose one next step is recording a release, while "no
    // release matches" is a filter state whose one next step is clearing them.
    empty: options.filtered
      ? ["No matching releases", "No release matches the current search, release status, linked decision, and linked decision status together."]
      : ["No releases have been recorded yet", "Link at least one decision, then record a release."],
  }[state];
  panel.append(el("h3", undefined, copy[0]));
  // A state with nothing to add beyond its heading says only that; an empty
  // paragraph would take a line and be read out as one.
  if (copy[1]) panel.append(el("p", undefined, copy[1]));
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

// Give an anchor its destination as both the property and the attribute.
//
// In a browser these are one write. They are not the same thing to read back:
// an anchor whose href only exists as a property has no destination in the
// serialized markup, which is what a link is. Writing both keeps "the link the
// renderer built" and "the link the page ships" the same answer, whichever one
// a caller — or a test — asks.
function linkTo(node, href) {
  node.href = href;
  node.setAttribute("href", href);
  return node;
}

function renderMetaRow(label, valueNode) {
  const row = el("div", "detail-meta-row");
  row.append(el("dt", "detail-meta-label", label));
  const dd = el("dd", "detail-meta-value");
  dd.append(valueNode);
  row.append(dd);
  return row;
}

// The evidence row for one linked decision. `flagged` marks the row the
// follow-up callout above is about, inside the link so a screen reader hears
// "next follow-up" as part of the row's name rather than as a stray word.
function renderDetailDecision(decision, flagged = false) {
  const item = el("li");
  const link = el("a", `detail-decision${flagged ? " detail-decision-flagged" : ""}`);
  if (flagged) link.append(el("span", "detail-decision-flag", "Next follow-up"));
  const summary = el("span", "detail-decision-summary");
  linkTo(link, decisionDetailHref(decision.id));
  link.append(el("span", `badge badge-${decision.status}`, decision.status));
  summary.append(el("span", "detail-decision-title", decision.title));
  // The identifier travels with the title so a linked decision can be matched
  // to an export, an import error, or a missing-reference row above it — those
  // name the decision by id, and two decisions may share a title.
  const identifier = el("span", "detail-decision-identifier");
  identifier.append(el("span", "detail-decision-identifier-label", "ID"));
  identifier.append(el("code", undefined, decision.id));
  summary.append(identifier);
  const rationale = el("span", "detail-decision-rationale");
  rationale.append(el("span", "detail-decision-rationale-label", "Rationale"));
  rationale.append(el("span", "detail-decision-rationale-text", decisionRationalePreview(decision)));
  summary.append(rationale);
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

function renderMissingDecision(id, flagged = false) {
  const item = el("li", `detail-decision-missing${flagged ? " detail-decision-flagged" : ""}`);
  if (flagged) item.append(el("span", "detail-decision-flag", "Next follow-up"));
  item.append(el("span", "badge badge-missing", "missing"));
  const label = el("span", "detail-decision-title");
  label.append(document.createTextNode("Linked decision "));
  label.append(el("code", undefined, id));
  label.append(document.createTextNode(" is not in this log."));
  item.append(label);
  return item;
}

// Nothing linked. A release with no decisions behind it is a real gap in the
// log rather than a blank slot, so this state says what is missing and links to
// the recorder — the same next step the release form's picker offers when there
// is nothing to link.
function renderDetailDecisionsEmpty() {
  const empty = el("div", "detail-decisions-empty");
  // The exact sentence the collapsed row uses, kept as its own element so the
  // two surfaces read identically.
  empty.append(el("p", "release-empty", "No decisions linked to this release."));
  empty.append(el(
    "p",
    "detail-decisions-empty-body",
    "Nothing in this log says why it shipped. Record the decision behind it so the reasoning is written down; a release links its decisions at the moment it is recorded.",
  ));
  const actions = el("div", "detail-state-actions");
  const action = el("a", "empty-action detail-decisions-empty-action", "Record the decision behind this release");
  action.href = RECORD_DECISION_HREF;
  actions.append(action);
  empty.append(actions);
  return empty;
}

// Render-local ids, like the follow-up callout's: one governing decision exists
// per release detail view, so nothing here needs a counter to stay unique.
const GOVERNING_TITLE_ID = "detail-governing-title";
const GOVERNING_TARGET_ID = "detail-governing-target";

export const GOVERNING_DECISION_CAPTION =
  "The decision this release stands on — the first one linked when it was recorded.";
export const GOVERNING_DECISION_MISSING_TEXT =
  "This decision is not in this log, so the reasoning behind the release cannot be reviewed here. "
  + "Record it on the decisions page, or record the release again against a decision this log holds.";

// The decision that governs the release, ahead of the full evidence list: title,
// current status, owner, and a clipped rationale, with one link to the record
// that holds the rest.
//
// A governing reference that no longer resolves degrades to plain text — the id
// and a sentence saying what to do — rather than to a link that would open a
// "decision not found" page. A dangling reference is a fact about this log, not
// a destination.
function renderDetailGoverning(association) {
  const section = el("section", `detail-governing${association.missing ? " detail-governing-missing" : ""}`);
  section.setAttribute("aria-labelledby", GOVERNING_TITLE_ID);
  const heading = el("h2", "detail-governing-heading", "Governing decision");
  heading.id = GOVERNING_TITLE_ID;
  section.append(heading);
  section.append(el("p", "detail-governing-caption", GOVERNING_DECISION_CAPTION));

  if (association.missing) {
    const name = el("p", "detail-governing-name");
    name.append(el("span", "badge badge-missing", "missing"));
    name.append(document.createTextNode("Linked decision "));
    name.append(el("code", undefined, association.id));
    name.append(document.createTextNode(" is not in this log."));
    section.append(name);
    const note = el("p", "detail-governing-note", GOVERNING_DECISION_MISSING_TEXT);
    note.setAttribute("role", "note");
    section.append(note);
    return section;
  }

  const decision = association.decision;
  const status = canonicalDecisionStatus(decision.status);
  // Title as its own element so long titles wrap here rather than being clipped
  // with the rationale below them.
  section.append(el("p", "detail-governing-name", decision.title));

  const meta = el("dl", "detail-meta detail-governing-meta");
  meta.append(renderMetaRow("Status", el("span", `badge badge-${status}`, status)));
  meta.append(renderMetaRow("Owner", document.createTextNode(decisionOwner(decision))));
  section.append(meta);

  const rationale = el("p", "detail-governing-rationale");
  rationale.append(el("span", "detail-governing-rationale-label", "Rationale"));
  rationale.append(document.createTextNode(decisionRationalePreview(decision)));
  section.append(rationale);

  // The path to the full record is a sibling of the clipped preview, never
  // inside it, so nothing about the truncation can hide the way to the rest.
  const link = linkTo(el("a", "detail-governing-link", "Open the full decision record"), decisionDetailHref(decision.id));
  link.setAttribute("aria-describedby", GOVERNING_TARGET_ID);
  const arrow = el("span", "detail-governing-arrow", "→");
  arrow.setAttribute("aria-hidden", "true");
  link.append(arrow);
  section.append(link);

  const target = el("p", "detail-governing-target",
    `Opens the decision record for “${decision.title}”, with the rationale in full, the alternatives weighed, and its status.`);
  target.id = GOVERNING_TARGET_ID;
  section.append(target);
  return section;
}

function renderDetailDecisions(resolved, followUp = null) {
  const section = el("section", "detail-decisions");
  section.setAttribute("aria-labelledby", "detail-decisions-title");
  section.append(el("h2", "detail-decisions-heading", "Decisions in this release"));
  section.querySelector(".detail-decisions-heading").id = "detail-decisions-title";
  section.append(el("p", "detail-summary", statusSummaryText(resolved)));

  if (resolved.counts.total === 0) {
    section.append(renderDetailDecisionsEmpty());
    return section;
  }

  // The list is the evidence behind the callout above: everything this release
  // carried, not just the one decision being chased. Saying so is what keeps
  // the prioritised follow-up from reading like the whole picture.
  section.append(el(
    "p",
    "detail-decisions-caption",
    "Every decision linked to this release, in the order it was linked. Open one to read the record behind it.",
  ));

  const list = el("ol", "detail-decision-list");
  // Keep the release author's association order, including dangling records.
  // Grouping missing references at the end would subtly rewrite that history.
  //
  // One row carries the marker even if the same id was linked twice: the
  // callout is about a single decision, so a second marker would claim there
  // are two things to chase next.
  let marked = false;
  for (const association of resolved.associations) {
    const flagged = !marked
      && followUp !== null
      && followUp.decisionId !== null
      && followUp.decisionId === association.id
      && association.missing === (followUp.kind === MISSING_DECISION_FILTER);
    marked ||= flagged;
    list.append(association.missing
      ? renderMissingDecision(association.id, flagged)
      : renderDetailDecision(association.decision, flagged));
  }
  section.append(list);
  return section;
}

// Render-local ids, like the list callout's: one follow-up exists per release
// detail view, so nothing here needs a counter to stay unique.
const DETAIL_FOLLOW_UP_TITLE_ID = "detail-followup-title";
const DETAIL_FOLLOW_UP_TARGET_ID = "detail-followup-target";

function renderDetailFollowUpName(followUp) {
  const name = el("p", "detail-followup-decision");
  if (followUp.kind !== MISSING_DECISION_FILTER) {
    name.textContent = followUp.title;
    return name;
  }
  name.append(document.createTextNode("Linked decision "));
  name.append(el("code", undefined, followUp.decisionId));
  name.append(document.createTextNode(" is not in this log."));
  return name;
}

// The one decision to chase next on this release, ahead of the evidence list.
// Prominence is semantic as well as visual: a labelled section, the status and
// owner as a real definition list, the reason as prose, and an action link
// described by the sentence naming where it goes.
function renderDetailFollowUp(followUp) {
  const section = el("section", `detail-followup detail-followup-${followUp.kind}`);
  section.setAttribute("aria-labelledby", DETAIL_FOLLOW_UP_TITLE_ID);
  const heading = el("h2", "detail-followup-title", "Next follow-up");
  heading.id = DETAIL_FOLLOW_UP_TITLE_ID;
  section.append(heading);
  section.append(renderDetailFollowUpName(followUp));

  const meta = el("dl", "detail-meta detail-followup-meta");
  meta.append(renderMetaRow("Status", el("span", `badge badge-${followUp.status}`, followUp.status)));
  meta.append(renderMetaRow("Owner", document.createTextNode(followUp.owner)));
  section.append(meta);

  section.append(el("p", "detail-followup-reason", followUp.reason));

  if (followUp.href) {
    const link = el("a", "detail-followup-action", followUp.action);
    link.href = followUp.href;
    link.setAttribute("aria-describedby", DETAIL_FOLLOW_UP_TARGET_ID);
    const arrow = el("span", "detail-followup-arrow", "→");
    arrow.setAttribute("aria-hidden", "true");
    link.append(arrow);
    section.append(link);
  }

  const target = el("p", "detail-followup-target", followUp.target);
  target.id = DETAIL_FOLLOW_UP_TARGET_ID;
  section.append(target);
  return section;
}

// The release detail page could not read this browser's log at all. Distinct
// from "not found", which is a definite answer about a definite id: this one
// says nothing was decided and that retrying is safe.
export function renderReleaseDetailError(container) {
  container.replaceChildren();
  container.setAttribute("aria-busy", "false");
  container.append(renderBackLink());
  const panel = el("div", "empty-state empty-state-error");
  panel.setAttribute("role", "alert");
  panel.append(el("h1", "empty-title", "This release could not be loaded."));
  panel.append(el("p", undefined, "Reading this browser's log failed. Try reloading the page — your saved records have not been changed."));
  container.append(panel);
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
  article.append(el("p", "detail-readiness", releaseDecisionReadinessText(resolved)));
  // The governing decision comes before the prioritised follow-up: what this
  // release stands on is the question a reader opened the page with, and the
  // follow-up is what to do about the rest. A release with nothing linked has
  // no governing decision to state, and the evidence section's empty state
  // below already names that gap and its next step.
  const governing = governingAssociation(resolved);
  if (governing) article.append(renderDetailGoverning(governing));
  // The prioritised follow-up sits between the release and its evidence: a
  // reader meets what needs doing before the full list they would otherwise
  // have to triage themselves. Absent entirely when nothing is outstanding —
  // an empty callout would still take a line and still be read out.
  const followUp = releaseDecisionFollowUp(resolved);
  if (followUp) article.append(renderDetailFollowUp(followUp));
  article.append(renderDetailDecisions(resolved, followUp));
  container.append(article);
}
