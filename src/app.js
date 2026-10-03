import {
  DECISION_ENTRY_FIELDS,
  DECISION_ENTRY_LIMITS,
  DECISION_ENTRY_STATUSES,
  decisionEntrySummary,
  decisionRecordedSummary,
  recordReleaseHref,
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
import { initDemoProgress } from "./demo-progress.js";
import { initEvaluationSummary } from "./evaluation-summary.js";
import { renderReleaseCoverage } from "./homepage-release-coverage.js";
import {
  DEFAULT_HISTORY_FILTERS,
  RECORD_TYPES,
  absoluteHistoryUrl,
  currentOnlySearch,
  historyFilterChips,
  historyAddressSearch,
  normalizeHistoryRange,
  parseHistoryFilters,
  readCurrentOnly,
} from "./history-filters.js";
import { copyHistoryLink, renderHistoryFilterChips, renderHistorySummary } from "./history-filter-view.js";
import { renderHistoryTrend } from "./history-trend-view.js";
import { renderDecisionTimelines } from "./decision-timeline-view.js";
import { publishHistoryScope } from "./history-scope.js";
import { initDeploymentStatus } from "./deployment-status-view.js";
import { initLeadCapture } from "./lead-capture.js";
import { initAskAboutShiplog } from "./ask-about-shiplog.js";
import { retentionDeclined, retentionRefusal } from "./local-retention.js";
import { recordsChanged } from "./shiplog-records.js";
import { overdueDecisionFinding } from "./overdue-decision.js";
import { renderOverdueFinding } from "./overdue-decision-view.js";
import {
  ADDED_LABEL,
  EXAMPLE_LABEL,
  REPOSITORY_LABEL,
  REPOSITORY_RELEASE_ABSENT,
  SAMPLE_RELEASE_ID,
  SEED_DECISIONS,
  SEED_RELEASES,
  exampleDecisionFormValues,
  pullRequestUrl,
} from "./seed-records.js";
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
  readReleases,
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

// The strict read, mirroring readReleases: a store that refuses to hand the
// decisions over throws here instead of reading as "this browser has recorded
// none". Those are two different states and a surface that offers to link
// decisions has to be able to tell them apart — an empty list drawn over a
// refused read is a first-run sentence standing on top of a failure. A value
// that *was* read is tolerated exactly the way loadDecisions tolerates it.
export function readDecisions(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  try {
    const value = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? value.filter(isDecision) : [];
  } catch {
    return [];
  }
}

export function loadDecisions(storage) {
  try {
    return readDecisions(storage);
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
      //
      // RELEASE LINK RULE (seed-records.js REPOSITORY_RELEASE_ABSENT): a record
      // from this repository may link a release in this log only if that release
      // genuinely shipped it. It is settled here, at composition, rather than
      // left to whether an invented release happens to name the id: an example
      // release must never be presented as the thing that shipped a real
      // decision, and "never" has to be structural to stay true as the examples
      // change. The row says the absence in words — see appendShippedIn.
      const repository = decision.repository ?? null;
      const shipped = repository && repository.releaseInLog !== true
        ? shippedState([])
        : shippedState(releasesByDecision.get(decision.id) ?? []);
      return {
        type: "decision",
        id: decision.id,
        example: exampleIds.has(decision.id),
        repository,
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
      // "Shiplog's own decisions" keeps exactly the repository-sourced records.
      // Read off the provenance field through the one predicate that decides
      // the three classes — never off the badge's copy, which is a string
      // somebody will reword, and never off the shape of an id, which a visitor
      // can produce. An example record can therefore never survive this filter.
      if (view.repositoryOnly === true && !isRepositoryRecord(record)) return false;
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

// WHOSE RECORD IS THIS. One notion of provenance, read by the row badges and by
// the split count above them, so the two can never disagree.
//
// `example` is decided once per composition, in refresh(): the seed ids this
// visitor has not taken over. That is the same rule the JSON export applies from
// the other side — the export is built from loadDecisions/loadReleases, so a
// record is in the file if and only if this browser holds it, which is exactly
// the half this predicate calls not-an-example. Neither the badge nor the count
// re-derives provenance from an id shape a visitor could also produce.
// THE SINGLE PLACE THE THREE CLASSES ARE DECIDED. Every badge, every count and
// every sentence below reads provenance from here, so the row, the split count
// above the list, and the pasteable summary can never disagree.
//
// `repository` wins over `example` on purpose. A repository record is seeded, so
// it is inside the same not-this-browser's set that `example` marks, and leaving
// it there keeps the sort, the export and exampleIdsFor working unchanged — the
// extra class is a finer answer on top of that set, never a contradiction of it.
export function recordProvenance(record) {
  if (record?.repository) return "repository";
  return record?.example === true ? "example" : "added";
}

export function isExampleRecord(record) {
  return recordProvenance(record) === "example";
}

export function isRepositoryRecord(record) {
  return recordProvenance(record) === "repository";
}

/** The provenance split over a set of rows: `{ total, examples, repository, added }`. */
export function countRecordProvenance(records = []) {
  let examples = 0;
  let repository = 0;
  for (const record of records) {
    const which = recordProvenance(record);
    if (which === "example") examples += 1;
    else if (which === "repository") repository += 1;
  }
  return { total: records.length, examples, repository, added: records.length - examples - repository };
}

// The two halves, in one place, so the figure above the list and the sentence
// beside it say them identically. Both halves are always named, including at
// zero: "no example records" is a fact a reader can act on, while dropping the
// half would leave them unable to tell an absence from something the page
// declined to say.
function exampleHalf(examples) {
  return examples === 0 ? "no example records" : `${examples} example ${examples === 1 ? "record" : "records"}`;
}

function addedHalf(added) {
  return added === 0 ? "none you added" : `${added} you added`;
}

// The third class, named only when there is one to name.
//
// Absent at zero, where the other two are always named, and the asymmetry is
// deliberate: the example/added split is a property of every log, so a reader
// has to be told both numbers to read either. A repository record is a kind of
// record some sets simply do not contain — a set of releases never contains one
// — and "none from this repository" on a list of releases would answer a
// question the reader did not ask and imply the class could appear there.
//
// It is also what keeps the release-coverage sentence (releaseCoverageLine) and
// the releases page's reasoning figure byte-identical: both count releases, no
// release is a repository record, so this clause never reaches them.
function repositoryHalf(repository) {
  return `${repository} from this repository`;
}

/**
 * The provenance split shown beside the record count.
 *
 * Always over the rows currently on screen — every caller passes the filtered
 * selection — so search, the filters, and Current only move this figure with the
 * list. Empty when nothing is shown: the count beside it already says none, and
 * the list below says why.
 */
export function provenanceSplitLine(visible = []) {
  const { total, examples, repository, added } = countRecordProvenance(visible);
  if (total === 0) return "";
  const halves = [exampleHalf(examples)];
  if (repository > 0) halves.push(repositoryHalf(repository));
  halves.push(addedHalf(added));
  return `· ${halves.join(" · ")}`;
}

// WHAT THE REPOSITORY-ONLY VIEW IS SHOWING, in words (#2710).
//
// Shown only while that filter is active and withdrawn the moment it is not, so
// the sentence can never be read over a list it does not describe. It states
// three things and stops: whose decisions these are, who recorded them, and that
// each row carries its own citation. It makes NO claim about customers, about
// how much the product is used, or about what any of these decisions achieved —
// the records are this site's own source history and that is the whole of what
// the page can stand behind.
export const REPOSITORY_VIEW_NOTE = "These are Shiplog's own decisions, recorded in Shiplog by the team that "
  + "operates it. Each one cites the public pull request it came from.";

// Which records a counted figure counted. #2539: every figure on the home page
// derived from a record count names its own records, so a reader who never
// reaches the caption above the list still knows the number includes invented
// examples.
function countedRecordsNote(records) {
  return countedRecordsNoteFor(countRecordProvenance(records));
}

// The same sentence over a split that was counted somewhere else. The releases
// page's reasoning figure (release-reasoning-proof.js) derives provenance from
// the example-id set that badges its rows rather than from an `example` flag per
// record, so it has the two halves and not the records; it names them in these
// words rather than in a second set, because two wordings of one split is how
// the site starts telling a reader two different things about the same records.
export function countedRecordsNoteFor({ examples = 0, repository = 0, added = 0 } = {}) {
  if (repository === 0) return `Counted here: ${exampleHalf(examples)} and ${addedHalf(added)}.`;
  return `Counted here: ${exampleHalf(examples)}, ${repositoryHalf(repository)} and ${addedHalf(added)}.`;
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
  //
  // The wait is stated ONCE. This used to be two lines — a heading "Loading
  // decisions" over a paragraph "Loading all decisions…" — which is the same
  // sentence twice, read out twice, and only ever half-true: the region below is
  // one combined decision-and-release history, so neither line named what was
  // being waited for. The wording matches the loading state authored in
  // src/index.html character for character, so the sentence a visitor reads
  // before this script runs is the sentence still standing after it.
  const copy = {
    loading: [HISTORY_LOADING_TEXT],
    // A failure states what failed and what is untouched, and it is the one
    // state that offers Retry. It is not "your saved decisions are still shown":
    // nothing is shown, because a log this browser refused to hand over cannot
    // be told apart from an empty one, and drawing the examples underneath a
    // failure would present invented records as the visitor's history.
    error: [
      "Couldn’t load your history",
      "This browser’s decision and release log could not be read. Your saved records have not been changed.",
    ],
    empty: options.filtered
      ? ["No records match your filters", "No decision or release matches the current record type, status, owner, and search. Reset the filters to see the full history."]
      : [
        "No decisions yet",
        "Record the title, context, owner, and status behind a useful decision. You can link it to a release when that work ships.",
      ],
  }[state];
  appendTextElement(panel, "h3", "", copy[0]);
  // A state with nothing to add beyond its heading says only that. An empty
  // paragraph would take a line on screen and be read out as one.
  if (copy[1]) appendTextElement(panel, "p", "", copy[1]);
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
  // The one next step each settled state offers. A real button in every case —
  // never a link dressed as one — because none of the three navigates: they
  // move focus into the recorder, drop the filters, or read the log again.
  //
  // Every one of them is drawn HERE, inside the history region, which is well
  // below index.html's first screen. That is deliberate and load-bearing: the
  // first screen is at its tab-stop budget (the coach link is stop 29 of 30), so
  // a recovery control added above it would push that link out of range.
  const kind = HISTORY_STATE_ACTION_FOR[options.filtered && state === "empty" ? "no-match" : state];
  if (kind) {
    const [className, label, controls] = HISTORY_STATE_ACTIONS[kind];
    const action = appendTextElement(panel, "button", `empty-action ${className}`, label);
    action.type = "button";
    action.setAttribute("aria-controls", controls);
    action.dataset.action = kind;
  }
  container.append(panel);
}

// The one loading sentence of the combined history, exported so index.html's
// authored copy and the panel this module paints over it can be held to the same
// bytes by a test rather than by two people remembering.
export const HISTORY_LOADING_TEXT = "Loading decisions and releases…";

// Which next step belongs to which state. "no-match" is the narrowed spelling of
// `empty`; `loading` has none — on boot there is nothing to offer, and a list
// with rows shows no panel at all.
const HISTORY_STATE_ACTION_FOR = { empty: "record-decision", "no-match": "reset-filters", error: "retry" };

// Each action's class, visible label, and what it controls.
const HISTORY_STATE_ACTIONS = {
  "reset-filters": ["history-reset-action", "Reset filters", "decision-list"],
  "record-decision": ["decision-empty-action", "Record your first decision", "decision-form"],
  retry: ["history-retry-action", "Retry", "decision-list"],
};

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

// The one place a row says whose record it is. Same badge idiom as the type and
// status badges next to it, so the answer travels with the row through every
// filter and sort instead of living only in the caption above the list.
//
// Both provenances are marked (#2539), and both as words: the marking is a text
// span, so it is in the row's accessible description rather than in a colour,
// and it is never a control — index.html's first screen is at its tab-stop
// budget and a badge has nothing to activate.
const PROVENANCE_BADGE = {
  example: ["badge badge-example", EXAMPLE_LABEL],
  repository: ["badge badge-repository", REPOSITORY_LABEL],
  added: ["badge badge-added", ADDED_LABEL],
};

function appendProvenanceBadge(meta, record) {
  const [className, label] = PROVENANCE_BADGE[recordProvenance(record)];
  return appendTextElement(meta, "span", className, label);
}

// What a repository row carries that no other row does: the pull request it is
// citable in, as a real link, and the release-link rule stated in words.
//
// It sits outside the card's own link for the reason appendRelationships does —
// an anchor cannot nest — so the PR is a Tab stop of its own that opens the
// merged pull request. That is below the home page's first screen, which is at
// its tab-stop budget; this adds nothing above it.
//
// The caveat on the example records is a page-level sentence about *those*
// records. Nothing here repeats or qualifies it, because nothing here is an
// example: the badge and this line are the whole of what the row claims.
function appendRepositorySource(article, record) {
  const { repository } = record;
  if (!repository) return null;
  const source = document.createElement("p");
  // The layout class the other relationship rows use, so this line sits with
  // them and costs no rule of its own — styles.css has no size headroom.
  source.className = "record-links record-source";
  appendTextElement(source, "span", "owner-label", "Recorded in");
  const anchor = document.createElement("a");
  anchor.className = "record-link record-source-link";
  anchor.href = pullRequestUrl(repository.pullRequest);
  appendTextElement(anchor, "span", "record-link-label", `Pull request #${repository.pullRequest}`);
  source.append(anchor);
  article.append(source);
  return source;
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
    //
    // A repository record gets its own wording. "Not yet shipped" would be
    // false of it: it shipped, in a pull request this row links, into a release
    // this log does not hold. Composition guarantees it reaches this branch —
    // see the release link rule in toHistoryRecords.
    const empty = isRepositoryRecord(record) ? REPOSITORY_RELEASE_ABSENT : copy.empty;
    appendTextElement(
      relationship,
      "span",
      "record-link-empty",
      shipped.state === "unresolved" ? copy.unresolved : empty,
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
  const { decision } = record;
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
  appendProvenanceBadge(meta, record);
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
  appendRepositorySource(article, record);
  appendBacking(article, record);
  item.append(article);
  return item;
}

// A release row carries the same amount of context as a decision row — status,
// date, description, linked-decision summary, owner — and the same open/act
// affordance, so a filtered result is still actionable without a second hop.
function renderReleaseRow(record, index, visibleKeys) {
  const { release } = record;
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
  appendProvenanceBadge(meta, record);
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

// HOW MUCH OF THE LOG CARRIES ITS REASONING.
//
// The fact is read off the record, never off the row's text: `decisionIds` is
// the association the release recorder writes, carried here as the resolved
// record's `counts.total`. A dangling reference still counts as carried — the
// release did name a decision, and the row already reports separately that one
// of them is missing. Losing a decision to an import is a different failure
// from never having recorded one, and this line is about the second.
function carriesLinkedDecision(record) {
  return (record.release?.counts?.total ?? record.release?.decisionIds?.length ?? 0) > 0;
}

const NO_RELEASES_TO_COUNT = "No releases are listed here, so there are none to count.";

/**
 * One sentence over the releases a view is currently showing.
 *
 * Pure, and derived from the same array the rows are built from, so the line
 * cannot describe a different set than the list under it. Every branch names
 * the filters, because a reader who has narrowed the log must not read a
 * narrowed number as a statement about the whole log. "0 of 0" is never
 * rendered: a view with no releases in it says so in words instead.
 *
 * It also names the records it counted (#2539). It used to lean on the caption
 * above the list for that, which asked a reader to hold two sentences together
 * to know whether an invented release was inside this number; the second
 * sentence answers it here, from the same array and the same helper as the split
 * count in the heading. "No releases to count" names nothing, because it counted
 * nothing.
 */
export function releaseCoverageLine(visible = []) {
  const releases = visible.filter((record) => record.type === "release");
  if (releases.length === 0) return NO_RELEASES_TO_COUNT;
  return `${releaseCoverageClaim(releases)} ${countedRecordsNote(releases)}`;
}

function releaseCoverageClaim(releases) {
  const total = releases.length;
  const carried = releases.filter(carriesLinkedDecision).length;
  const bare = total - carried;
  const shown = "shown by the current filters";
  if (total === 1) {
    return carried === 1
      ? `The one release ${shown} carries at least one linked decision.`
      : `The one release ${shown} carries no linked decision.`;
  }
  if (bare === 0) return `All ${total} releases ${shown} carry at least one linked decision.`;
  if (carried === 0) return `None of the ${total} releases ${shown} carries a linked decision.`;
  return `Of the ${total} releases ${shown}, ${carried} carry at least one linked decision `
    + `and ${bare} ${bare === 1 ? "does" : "do"} not.`;
}

// Renders the composed history stream and returns the number of visible rows so
// the caller can announce an accurate count without re-deriving the selection.
//
// `coverage`, when the surface has that node, is written here rather than from
// a listener of its own: it is the same `visible` array the rows come from, on
// the same render, so no filter can move the list without moving the sentence
// above it — including on the two empty paths, which return early below.
export function renderHistory(container, count, records, view = {}, { coverage, provenance } = {}) {
  const visible = selectHistory(records, view);
  if (coverage) coverage.textContent = releaseCoverageLine(visible);
  // The split beside the figure, written here rather than by a listener of its
  // own, for the same reason and on the same array: no path can move the list
  // without moving both halves of the count. Recording a decision re-renders
  // through here, which is how the "you added" half grows with no reload.
  if (provenance) provenance.textContent = provenanceSplitLine(visible);
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

// What the history's live region says when the log could not be read. It names
// the control that recovers it, because the panel that carries that control is
// below the fold and the announcement is the only notice a screen reader gets —
// nothing moves focus to it.
export const HISTORY_UNREAD_ANNOUNCEMENT =
  "Couldn’t load your history. Use the Retry button in the history to read the log again.";

// What the recorder says when it refuses to write into a log it could not read.
// Saving would put a one-record log over every decision already stored.
export const HISTORY_UNREAD_SAVE = "Couldn’t save: your decision log didn’t load. "
  + "Retry loading the history below, then record again — nothing you typed has been lost.";

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

// Use only the canonical seed layer: browser-added records cannot become
// homepage evidence, even if imported data imitates a provenance marker.
//
// WHICH ONE OF THEM, SAID OUT LOUD: the newest repository decision that carries
// a citable pull request number, a title, and a date this page can order by.
// `sort` is named here rather than inherited from the default view, because the
// one record a buyer reads first must not change because somebody reordered the
// seed array or changed which sort the history list opens on. The three
// requirements are a filter rather than a fallback: an unparseable date makes
// "newest" arbitrary, and an uncitable number is the single thing this block
// exists to rule out, so a record missing either is dropped instead of shown.
export function renderRepositoryEvidence(root, decisions = SEED_DECISIONS) {
  const target = root.querySelector("#repository-evidence-records");
  if (!target) return;
  const records = selectHistory(toHistoryRecords(decisions, []), {
    repositoryOnly: true, type: "decision", sort: "newest",
  }).filter((record) => Number.isSafeInteger(record.repository?.pullRequest)
    && record.repository.pullRequest > 0 && record.title?.trim()
    && Number.isFinite(Date.parse(record.createdAt)));
  target.replaceChildren();
  const record = records[0];
  if (!record) {
    const empty = root.createElement("p");
    empty.setAttribute("class", "release-followup-lead");
    empty.textContent = "No repository-backed decisions are available in this log.";
    target.append(empty);
    return;
  }
  const paragraph = root.createElement("p");
  paragraph.setAttribute("class", "release-followup-lead");
  const link = root.createElement("a");
  link.setAttribute("href", pullRequestUrl(record.repository.pullRequest));
  link.textContent = `${record.title} — public pull request #${record.repository.pullRequest}`;
  paragraph.append(link);
  target.append(paragraph);
}

export async function initDecisionLog(root = document, storage = localStorage, options = {}) {
  renderRepositoryEvidence(root);
  initLeadCapture(root);
  // The log entry's route to the follow-up form. Guarded inside, so a page that
  // mounts this log without the route or without the band gets nothing.
  initAskAboutShiplog(root);
  const form = root.querySelector("#decision-form");
  const list = root.querySelector("#decision-list");
  const count = root.querySelector("#decision-count");
  // The same figure split by provenance. A second node rather than more text in
  // the one above it, so the total keeps one meaning and one reader — and the
  // two are siblings in the heading, so they are read as one line.
  const provenance = root.querySelector("#decision-provenance");
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
  // The one-press route into step one (#2725). Optional like every other
  // control here: a surface that mounts the recorder without it still records.
  const fillExample = root.querySelector("#fill-example-decision");
  const typeFilter = [...(root.querySelectorAll?.('input[name="record-type"]') ?? [])];
  const statusHint = root.querySelector("#filter-status-hint");
  const currentOnly = root.querySelector("#filter-current-only");
  const repositoryOnly = root.querySelector("#filter-repository-only");
  // The sentence that says what the repository-only view is showing. Written on
  // the same render as the rows, beside the headline rather than inside it: the
  // headline is a count and this is a claim about provenance.
  const sourceNote = root.querySelector("#history-source-note");
  const fromFilter = root.querySelector("#filter-from");
  const toFilter = root.querySelector("#filter-to");
  const filterSummary = root.querySelector("#history-filter-summary");
  // Plain text beside the list, deliberately not a live region of its own: it
  // is written on the same render as the rows, so a second announcement here
  // would only interrupt the settled count in #history-announcement.
  const coverage = root.querySelector("#release-coverage");
  const trend = root.querySelector("#history-trend");
  const timelines = root.querySelector("#history-timelines");
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
  // The evaluation path's next step, offered only for a decision that is in
  // storage. Withdrawn by every refusal and by the next edit, like the status
  // line above it, so it can never point a visitor at a record that was not kept.
  const recordNext = root.querySelector("#decision-record-next");
  const recordReleaseLink = root.querySelector("#decision-record-release");
  const withdrawRecordNext = () => {
    if (recordNext) recordNext.hidden = true;
  };
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
  // BOTH LOGS, READ STRICTLY. The tolerant loaders turn a store that refuses the
  // read into an empty array, which means a failure used to arrive on this page
  // dressed as "you have not recorded anything yet" — a first-run sentence, and a
  // "Record your first decision" button, standing on top of a log that is still
  // there and could not be reached. Null means unread, which is its own state
  // with its own copy and its own next step (Retry) below.
  const readLog = () => {
    try {
      return { decisions: readDecisions(storage), releases: readReleases(storage) };
    } catch {
      return null;
    }
  };
  let stored = readLog();
  // An unread log is a state of the LIST, not of the page: the filters, the
  // recorder and the export panel around it keep working.
  let unread = stored === null;
  let recordedDecisions = stored?.decisions ?? [];
  let recordedReleases = stored?.releases ?? [];
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
    repositoryOnly: false,
  };

  // The query string this page owns, tracked locally because replaceState does
  // not report back through the same object in every environment.
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
    syncRepositoryOnlyControl();
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
   * Always replaceState, never pushState: a filter is a view of this page, not
   * a place a person went, so a shared or reloaded address describes the view
   * without Back replaying every status tried on the way to it. Parameters the
   * log does not own stay in the address. A change that produces the same query
   * string writes nothing at all.
   */
  const syncUrl = () => {
    const next = historyAddressSearch(queryString, view);
    if (next === queryString) return false;
    queryString = next;
    // A rewrite is the same entry, so it keeps whatever state that entry holds.
    historyRef?.replaceState?.(historyRef.state ?? null, "", `${locationRef?.pathname || "/"}${next}`);
    return true;
  };

  const commit = () => {
    syncUrl();
    render();
  };

  // Back or Forward onto an entry this page did not write (a record's deep
  // link, a page before it): re-derive the state from the URL the browser
  // restored, put it back on the controls, and re-render. Nothing is written.
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
    withdrawRecordNext();
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
    withdrawRecordNext();
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

  // The same idiom for the provenance toggle: one control, one visible state,
  // and aria-pressed is that state. Called from syncFilterControls, so a shared
  // link, Back, and a chip removal all leave the button describing the view.
  const syncRepositoryOnlyControl = () => {
    if (!repositoryOnly) return;
    repositoryOnly.setAttribute?.("aria-pressed", String(view.repositoryOnly));
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
    // The failed read is drawn in the list's own region and nowhere else, and it
    // replaces whatever was there: renderDecisionState clears the container, so
    // the loading line is gone from the DOM rather than hidden behind the panel
    // that succeeded it. Every figure that describes the list is emptied in the
    // same breath — a count, a split or a coverage sentence left standing would
    // be describing a history this page does not have.
    const visible = unread ? 0 : renderHistory(list, count, records, view, { coverage, provenance });
    if (unread) {
      renderDecisionState(list, "error");
      if (count) count.textContent = "";
      if (provenance) provenance.textContent = "";
      if (coverage) coverage.textContent = "";
    }
    if (supersedeSummary) supersedeSummary.textContent = supersedeFilterSummary(records, view);
    // The rows this view is showing, for everything below that describes them:
    // the headline's provenance split, the trend, and the timelines. One
    // selection, so none of them can describe a different set than the list.
    const selected = selectHistory(records, view);
    // The headline of the list, and the filters that produced it. Rendered
    // before the announcement so a reader who hears the count can already find
    // the same sentence on screen. It carries the same split as the figure in
    // the heading: a figure that names no records is one a reader has to take
    // the caption's word for.
    // Skipped, not recomputed, on a failed read: this line's whole vocabulary is
    // "n of m records", and every sentence it can produce from a log of zero —
    // starting with "no records yet" — contradicts the panel below it.
    if (unread) {
      if (filterSummary) filterSummary.textContent = "";
    } else {
      renderHistorySummary(filterSummary, {
        visible,
        total: records.length,
        filters: view,
        split: provenanceSplitLine(selected),
      });
    }
    // The provenance view's own sentence, beside that headline. Emptied on a
    // failed read for the same reason the figures above are: a claim about what
    // the rows are, over a list this page could not read, is a claim about
    // nothing.
    if (sourceNote) sourceNote.textContent = !unread && view.repositoryOnly ? REPOSITORY_VIEW_NOTE : "";
    chipButtons = renderHistoryFilterChips(filterChips, view, { onRemove: removeFilter });
    // The shape of the same view, from the same selection rule: the chart is
    // drawn here rather than from a listener of its own, so a filter can never
    // move the list without moving the trend above it.
    renderHistoryTrend(trend, { records: selected, onSelectWeek: selectWeek });
    // What became of each decision in the same view. Release dates are looked up
    // in the whole log rather than the filtered set: hiding the release rows
    // changes which decisions are listed and must not change how long any one of
    // them took to ship.
    renderDecisionTimelines(timelines, { records: selected, releases: records });
    renderHistoryReleaseFollowUp(
      releaseFollowUp,
      releases.find(({ id }) => id === view.releaseId),
      decisions,
    );
    // The page's own live region carries the state change, so a failed or
    // recovered read is announced without the panel having to steal focus to be
    // noticed. historyCountMessage cannot say this: a count of zero reads as
    // "No records recorded yet", which is the other state entirely.
    announce(unread ? HISTORY_UNREAD_ANNOUNCEMENT : historyCountMessage(visible, records.length));
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
  // The pasteable summary of the loaded log (#2582). Mounted before the first
  // composition so its control is live by the time refresh() below hands it the
  // first set of figures, and updated from inside refresh() rather than from a
  // listener of its own: that is the one place the data changes, so the summary
  // cannot describe a log the page has moved on from. A surface without the
  // block gets an inert handle and nothing here changes.
  const evaluationSummary = initEvaluationSummary(root, { clipboard: clipboardRef });

  const refresh = ({ paint = true } = {}) => {
    // An unread log composes to nothing, examples included. The examples are a
    // module constant and would load fine, but a page that drew them under a
    // failed read would be presenting invented records as this browser's history
    // — and its record count, its trend and its export would all describe them.
    decisions = unread ? [] : dedupeById([...recordedDecisions, ...seedDecisions]);
    releases = unread ? [] : dedupeById([...recordedReleases, ...seedReleases]);
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
    // review date does not keep reporting yesterday's answer. `options.now`
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
    // Over the whole loaded log, not the filtered selection, and repainted even
    // on the composition pass that does not paint the list: the summary states
    // that filters do not move its figures, so it is written here where the data
    // changes and nowhere the filters reach.
    evaluationSummary.update({ records, decisions, releases, exampleIds, unread });
    // The releases page's two coverage figures, on the front door (#2605), from
    // the same counter and the same sentence that page paints. Written here and
    // not in render() for the reason above: this block states that the filters
    // do not move its numbers, so it is repainted only where the data changes.
    // A surface without the block is left alone.
    renderReleaseCoverage(root, { releases, decisions, exampleIds, unread });
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
  // carrying `status=approved` or an owner this log has never held now shows the
  // state actually on screen. Silent when the link was already canonical, which
  // is the ordinary case.
  syncUrl();

  // The "Example record" panel. It used to feature releases[0], which is
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
  for (const type of ["input", "change"]) {
    search?.addEventListener(type, () => {
      view.query = search.value;
      commit();
    });
  }
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
  // The provenance toggle, on the same path. A native button, so Tab reaches it
  // and Enter or Space activates it without this handler knowing which was
  // pressed; it writes the one filter state everything else on this page reads,
  // so Clear filters, a chip and a shared link all already understand it.
  repositoryOnly?.addEventListener("click", () => {
    view.repositoryOnly = !view.repositoryOnly;
    syncRepositoryOnlyControl();
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
  // Read both logs again, saying so while it happens.
  //
  // The wait is painted into the same region the Retry was in, so the failed
  // panel and its button are gone from the DOM before either answer lands —
  // which is also what keeps a reader from meeting a Retry and a recovered list
  // at once. A read that succeeds recomposes the history and lands focus on the
  // list's own heading, which is what the press was for; one that fails again
  // redraws the failure and puts focus back on the freshly drawn Retry, so the
  // keyboard is not dropped to the top of the document by a button that a
  // re-render removed from under it.
  const retryHistory = () => {
    renderDecisionState(list, "loading");
    const next = readLog();
    if (!next) {
      renderDecisionState(list, "error");
      announce(HISTORY_UNREAD_ANNOUNCEMENT);
      list.querySelector(".history-retry-action")?.focus?.({ preventScroll: true });
      return;
    }
    unread = false;
    recordedDecisions = next.decisions;
    recordedReleases = next.releases;
    refresh();
    root.querySelector("#decisions-title")?.focus?.({ preventScroll: true });
  };

  list.addEventListener("click", (event) => {
    const trigger = event.target.closest?.("[data-action]");
    if (trigger?.dataset.action === "record-decision") enterDecisionRecorder(root, trigger);
    if (trigger?.dataset.action === "reset-filters") resetFilters();
    if (trigger?.dataset.action === "retry") retryHistory();
  });
  exitRecorder?.addEventListener("click", () => exitDecisionRecorder(root));

  // STEP ONE IN ONE PRESS (#2725). Load the example decision this page already
  // displays above the log into the five fields, and do nothing else: no
  // validation runs, no record is built, nothing is written, and the history
  // does not move. The visitor's own press of Record decision is still what
  // records, and every filled field is left exactly as editable as one they
  // typed — these are plain value writes against the shipped controls, with no
  // readonly, disabled or hidden state anywhere in the path.
  //
  // THE VALUES ARE NOT RETYPED HERE. exampleDecisionFormValues() reads the one
  // seed record the home page's displayed example is drawn from, so a copy edit
  // to that example moves this text with it.
  //
  // Three things are tidied, each for the same reason the submit path tidies
  // them: a message, a line, or a step that described the form a moment ago
  // must not outlive the press that changed it.
  //   • The field errors go, because the fields they describe are now answered
  //     and a message beside filled text is false.
  //   • The supersede error goes with them: Replaces is left alone by the fill,
  //     and a refusal about a link this press did not make is stale.
  //   • The last save's next step is withdrawn, exactly as typing withdraws it.
  //     Programmatic value writes raise no input event, so the listener below
  //     never sees this one.
  // The "Recorded …" status line is deliberately NOT cleared: it is a true
  // statement about a decision that is still in the log below, and the fill
  // neither removes nor contradicts it.
  fillExample?.addEventListener("click", () => {
    const values = exampleDecisionFormValues();
    for (const [field, value] of Object.entries(values)) {
      const control = entryFields.get(field)?.control;
      if (control) control.value = value;
    }
    clearEntryErrors();
    clearSupersedesError();
    withdrawRecordNext();
    // Focus the top of the form rather than leaving it on the button. It is the
    // page's own idiom — a failed submit sends focus to the first field that
    // needs attention — and it is the only announcement a screen reader gets
    // that the press landed: the Title field is read back with the example text
    // now in it, as editable text.
    const title = entryFields.get("title")?.control;
    title?.focus?.({ preventScroll: true });
    title?.scrollIntoView?.({ block: "center" });
  });

  // Typing the next decision retires the last one's next step. form.reset()
  // raises neither event, so the step a save reveals survives that save.
  form.addEventListener("input", withdrawRecordNext);
  form.addEventListener("change", withdrawRecordNext);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));

    // Our own validation, not form.reportValidity(). The form carries
    // `novalidate` so the browser's one-bubble-at-a-time report never runs
    // first, and every failure is stated inline on the field it belongs to
    // instead. Nothing is written while any of them stands.
    //
    // Status is checked against the two the select offers, not against every
    // value a stored record may carry: a submitted status that did not come
    // from this control is refused rather than minted. See
    // DECISION_ENTRY_STATUSES.
    const errors = validateDecisionEntry(values, { statuses: DECISION_ENTRY_STATUSES });
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
    // The log this record would join could not be read, so there is no base to
    // add to: writing now would put this one decision over every decision the
    // store still holds. The entry stays in the form, untouched, and the notice
    // names the Retry that recovers the log.
    if (unread) {
      notice.textContent = HISTORY_UNREAD_SAVE;
      notice.hidden = false;
      return;
    }
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
    // A kept decision moves focus to the next step of the evaluation path, as
    // the releases recorder moves it to the release it kept: the next thing to
    // do is on another page, and the link is described by the sentence that
    // says the decision will be waiting there. An unkept one offers nothing and
    // returns focus to the form.
    if (saved && recordNext && recordReleaseLink) {
      recordReleaseLink.setAttribute("href", recordReleaseHref(decision.id));
      recordNext.hidden = false;
      recordReleaseLink.focus();
    } else {
      withdrawRecordNext();
      form.elements.title.focus();
    }
  });

  // How far this browser got through the demo (#2500). Mounted from here
  // because the recorder owns both halves of the answer: this is the surface
  // that writes decisions, and recordsChanged() above is the notification the
  // indicator re-reads on. It is handed READERS, not lists — the store is the
  // state, and a copy taken at boot would keep describing a log a later write
  // has moved on from. A page without the path gets nothing back and nothing
  // breaks, so the recorder still mounts on a surface that does not carry it.
  initDemoProgress(root, storage, {
    decisions: () => loadDecisions(storage),
    releases: () => loadReleases(storage),
  });

  // The live deployment self-check (#1791), which is the releases page's band
  // and not a second one: same module, same reading, same sentence. Both
  // surfaces compare the running deployment against the same real record of it,
  // derived by initDeploymentStatus from the build stamp inside this artifact
  // when no record is passed. It is deliberately NOT awaited — it
  // reads the health endpoint, and the history above it must not wait on a
  // network read to be correct. A boot that throws leaves the authored waiting
  // line rather than a blank block.
  //
  // A surface that mounts this recorder without the block gets nothing:
  // initDeploymentStatus returns on a missing panel. `deploymentNow` is its own
  // option because `options.now` here is a millisecond number and the check
  // reads an ISO string.
  initDeploymentStatus(root, {
    release: options.deployedRelease,
    buildStamp: options.buildStamp,
    readHealth: options.readHealth,
    now: options.deploymentNow,
    // Injected for the same reason as the reader and the clock: the block's
    // copy control writes to a clipboard, and a test drives that write rather
    // than the browser's.
    clipboard: clipboardRef,
  }).catch(() => {});

  document.documentElement.dataset.shiplog = "ready";
}

// Auto-init only on the decisions page. Guarding on the form's presence keeps
// app.js safe to import from other pages (e.g. releases-page.js reuses
// loadDecisions) without booting the decision log against a missing DOM.
if (typeof document !== "undefined" && document.querySelector("#decision-form")) {
  initDecisionLog();
}
