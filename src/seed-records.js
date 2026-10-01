// The representative decision and release records that every visitor sees.
//
// These used to be two JSON files fetched at boot. That made them arrive a
// network round trip after the first paint, which is why a cold visitor read
// "0 records" under a caption promising examples, and why the decision detail
// page could sit on "Loading decision" indefinitely when the request was slow
// or refused. They are module-level constants now: available synchronously at
// render time, so the very first render already has them.
//
// They are a READ-THROUGH layer, never a write. Nothing here is ever put into
// the visitor's storage. That keeps three properties that a first-load write
// would cost us: the examples cannot be mistaken for the visitor's own records
// by the export ("only what is stored in this browser"), a visitor's records
// can never be overwritten or hidden by re-seeding, and editing this file
// changes what every visitor sees on the next load rather than only what a
// brand new browser sees.
//
// INVENTED_DECISIONS and SEED_RELEASES below are invented. No customer, Wawalu
// operational, or internal record appears in them.
//
// REPOSITORY_DECISIONS is the one exception, and it is a different kind of
// record rather than a loosening of that rule: each entry is a decision this
// repository actually made, cited to the pull request that merged it. Nothing
// there is invented either — it is quoted from the reasoning that PR landed —
// and nothing there is customer or production data, because the subject is this
// site's own source. The two sets never merge into one class: see
// recordProvenance in app.js, which is the single place the three classes are
// decided.

// The ids the home page's calls to action, the detail routes, and the
// cross-links all agree on. They are exported so no surface has to repeat the
// literal; the one place that cannot import them is static markup in
// src/index.html, which is pinned against these constants by a test.
export const SAMPLE_DECISION_ID = "demo-queue";
export const SAMPLE_RELEASE_ID = "demo-r-1-3-0";

// The one label these records carry wherever they appear — list row and detail
// page alike. Plain and factual on purpose: it states what the record is, and
// nothing about what the reader should conclude from it.
export const EXAMPLE_LABEL = "Example record";

// The counterpart marking, for a record this browser actually holds.
//
// Every row in the home page's log carries exactly one of the two now (#2539).
// An unbadged row left a reader to infer "then this one must be mine", and an
// inference is not a statement. The wording is the hero's own — "Records you add
// stay in this browser" — shortened to badge length, and it shares no word with
// EXAMPLE_LABEL so neither marking can be read as the other.
export const ADDED_LABEL = "You added";

// The third marking: a decision this repository really made. It shares no word
// with either label above, for the same reason those two share none with each
// other — a reader must not be able to read one marking as another.
export const REPOSITORY_LABEL = "Shiplog's own decision";

// The public repository these records are citable in. The PR link on a row is
// built from this and the record's own number, so a record cannot name one pull
// request and open another.
export const REPOSITORY_URL = "https://github.com/AndrewLikesTea/wawalu-agent-lab";

export function pullRequestUrl(number) {
  return `${REPOSITORY_URL}/pull/${number}`;
}

// How a repository row says which release carried it.
//
// RELEASE LINK RULE: a repository record links a release in this log only if
// that release genuinely shipped it. Every release in this log is an invented
// example, so none of them shipped any of these, and every record below sets
// `releaseInLog: false`. The association is dropped at composition rather than
// left to the renderer, and the row states the absence in these words instead
// of borrowing "Not yet shipped" — these decisions did ship, just not into a
// release this log holds.
export const REPOSITORY_RELEASE_ABSENT = "The release that shipped it is not in this log";

export const REPOSITORY_DECISIONS = Object.freeze([
  Object.freeze({
    id: "shiplog-pr-362",
    title: "Serve the example records as module constants, not a fetched file",
    context: "The example decisions and releases were two JSON files fetched at boot, so they arrived a network round trip after the first paint: a cold visitor read a count of zero under a caption promising examples, and the decision detail page could sit on its loading state when the request was slow or refused.",
    alternatives: "Keeping the fetch and covering the gap with a loading state, and writing the examples into the visitor's storage on first load — rejected because the export could then no longer claim it holds only what this browser stored.",
    owner: "Remy",
    status: "accepted",
    createdAt: "2026-07-27T20:57:32.000Z",
    repository: Object.freeze({ pullRequest: 362, releaseInLog: false }),
  }),
  Object.freeze({
    id: "shiplog-pr-294",
    title: "Store supersession in one direction and derive the reverse",
    context: "A decision needed to record that it replaced an earlier one, and every surface that reads the relationship from the other side — the detail banner, the history filter, the import round trip — needed the same answer.",
    alternatives: "A stored superseded-by field on the decision that was replaced — rejected because a writer would have to keep two fields in step, and the two directions could then disagree.",
    owner: "Remy",
    status: "accepted",
    createdAt: "2026-07-27T04:08:52.000Z",
    repository: Object.freeze({ pullRequest: 294, releaseInLog: false }),
  }),
  Object.freeze({
    id: "shiplog-pr-2547",
    title: "Mark every record row with whose record it is",
    context: "The home page's record count and its rows did not say which records demonstrate Shiplog and which the visitor had added, so a reader could not tell the two apart from the list alone.",
    alternatives: "Marking only the demonstration records and leaving a visitor's own rows unmarked — rejected because an unmarked row left a reader to infer the answer, and an inference is not a statement. Deriving the answer from the shape of a record id was rejected too: a visitor can produce that shape.",
    owner: "Mina",
    status: "accepted",
    createdAt: "2026-09-25T08:43:47.000Z",
    repository: Object.freeze({ pullRequest: 2547, releaseInLog: false }),
  }),
]);

export const REPOSITORY_DECISION_IDS = Object.freeze(REPOSITORY_DECISIONS.map(({ id }) => id));

const INVENTED_DECISIONS = Object.freeze([
  Object.freeze({
    id: SAMPLE_DECISION_ID,
    title: "Adopt a durable job queue",
    context: "Background work was lost on deploys; move to an at-least-once durable queue.",
    alternatives: "Database polling and in-process retries.",
    owner: "Kai",
    status: "accepted",
    createdAt: "2026-05-02T09:00:00.000Z",
  }),
  Object.freeze({
    id: "demo-cache",
    title: "Cache the read path",
    context: "Read latency spikes under load; add a short-TTL cache in front of the store.",
    alternatives: "Query tuning alone and precomputed read models.",
    owner: "Ari",
    status: "accepted",
    createdAt: "2026-05-20T09:00:00.000Z",
  }),
  Object.freeze({
    id: "demo-flags",
    title: "Introduce feature flags",
    context: "Decouple deploy from release so risky changes ship dark first.",
    alternatives: "Long-lived release branches and configuration-only switches.",
    owner: "Priya",
    status: "proposed",
    createdAt: "2026-06-01T09:00:00.000Z",
  }),
  Object.freeze({
    id: "demo-tokens",
    title: "Rotate to short-lived tokens",
    context: "Long-lived credentials are hard to revoke; move to short-lived, refreshable tokens.",
    alternatives: "Manual key rotation and narrower long-lived credentials.",
    owner: "Rowan",
    status: "accepted",
    createdAt: "2026-06-15T09:00:00.000Z",
  }),
  Object.freeze({
    id: "demo-logging",
    title: "Standardize structured logging",
    context: "Free-text logs are hard to query; adopt a structured, queryable log format.",
    alternatives: "Parsing free-text at ingestion and service-specific schemas.",
    owner: "Ellis",
    status: "proposed",
    createdAt: "2026-06-28T09:00:00.000Z",
  }),
  Object.freeze({
    id: "demo-csv",
    title: "Sunset the legacy CSV export",
    context: "The CSV export is unmaintained and superseded by the JSON export.",
    alternatives: "Repairing CSV compatibility and maintaining both formats.",
    owner: "Mina",
    status: "superseded",
    createdAt: "2026-03-10T09:00:00.000Z",
  }),
]);

// The decision half of the log every visitor sees: the invented examples first,
// then this repository's own records. One array, because they are one log — the
// class is carried per record, so no surface has to be told which list a row
// came from.
export const SEED_DECISIONS = Object.freeze([...INVENTED_DECISIONS, ...REPOSITORY_DECISIONS]);

export const SEED_RELEASES = Object.freeze([
  Object.freeze({
    id: "demo-r-1-4-0",
    version: "v1.4.0",
    title: "Security and delivery hardening",
    description: "Short-lived credentials, feature flags, and structured logs make delivery safer.",
    status: "planned",
    notes: "Security and delivery hardening.",
    owner: "Priya",
    createdAt: "2026-07-01T16:00:00.000Z",
    decisionIds: Object.freeze(["demo-flags", "demo-tokens", "demo-logging"]),
  }),
  Object.freeze({
    id: SAMPLE_RELEASE_ID,
    version: "v1.3.0",
    title: "Throughput and latency",
    description: "A durable queue and read cache improve reliability under load.",
    status: "completed",
    notes: "Throughput and latency work.",
    owner: "Kai",
    createdAt: "2026-05-25T16:00:00.000Z",
    decisionIds: Object.freeze([SAMPLE_DECISION_ID, "demo-cache"]),
  }),
  Object.freeze({
    id: "demo-r-1-2-1",
    version: "v1.2.1",
    title: "Legacy export cleanup",
    description: "Retired the old CSV path after the JSON export replaced it.",
    status: "cancelled",
    // One id here resolves to nothing on purpose: a release may name a decision
    // that no longer exists, and the list must say so rather than drop it.
    notes: "Cleanup release. One linked decision has since been archived.",
    owner: "Mina",
    createdAt: "2026-04-05T16:00:00.000Z",
    decisionIds: Object.freeze(["demo-csv", "demo-archived-legacy"]),
  }),
  Object.freeze({
    id: "demo-r-1-2-0",
    version: "v1.2.0",
    title: "Infrastructure maintenance",
    description: "Infrastructure-only work with no decision records.",
    status: "completed",
    notes: "Infrastructure-only release with no decision records.",
    createdAt: "2026-03-15T16:00:00.000Z",
    decisionIds: Object.freeze([]),
  }),
]);

// The structured-alternatives enhancement for the sample decision. It is the
// same record as its SEED_DECISIONS entry, with `alternatives` upgraded from a
// sentence to the comparable options the detail page renders. Resolution
// prefers this shape and falls back to the list shape, so a decision without a
// detail seed still opens.
export const SEED_DECISION_DETAILS = Object.freeze([
  Object.freeze({
    id: SAMPLE_DECISION_ID,
    title: "Adopt a durable job queue",
    context: "Background work was lost on deploys. We need at-least-once delivery, observable retries, and a recovery path that does not depend on one application process staying alive.",
    owner: "Kai",
    status: "accepted",
    createdAt: "2026-05-02T09:00:00.000Z",
    alternatives: Object.freeze([
      Object.freeze({
        id: "managed-queue",
        name: "Managed durable queue",
        summary: "Use a hosted at-least-once queue with worker acknowledgements and retry policies.",
        pros: Object.freeze(["Survives deploys and worker crashes", "Built-in retries and dead-letter handling"]),
        cons: Object.freeze(["Adds a managed dependency", "Consumers must be idempotent"]),
        effort: "Medium",
        risk: "Low",
        selected: true,
      }),
      Object.freeze({
        id: "database-polling",
        name: "Database polling",
        summary: "Store jobs in the primary database and have workers poll for pending rows.",
        pros: Object.freeze(["Uses existing infrastructure", "Transactional enqueue with application writes"]),
        cons: Object.freeze(["Polling adds database load", "Locking and retry logic become application concerns"]),
        effort: "Medium",
        risk: "Medium",
        selected: true,
      }),
      Object.freeze({
        id: "in-process-retries",
        name: "In-process retries",
        summary: "Keep work in application memory and retry failures within the running process.",
        pros: Object.freeze(["Smallest implementation change", "No new service to operate"]),
        cons: Object.freeze(["Work is lost during deploys", "No durable audit trail"]),
        effort: "Low",
        risk: "High",
      }),
    ]),
  }),
]);

export const SEED_DECISION_IDS = Object.freeze(SEED_DECISIONS.map(({ id }) => id));
export const SEED_RELEASE_IDS = Object.freeze(SEED_RELEASES.map(({ id }) => id));

// What the record count reads for a visitor with nothing stored. The static
// markup in src/index.html states this number so the count is right on the
// first paint instead of counting up from zero; a test pins the two together.
export const SEED_RECORD_COUNT = SEED_DECISIONS.length + SEED_RELEASES.length;

// How many of those are invented examples. Every seeded release is one, and
// every seeded decision except the repository records above. Derived, not
// written down, so adding a record of either kind cannot leave the split line
// in index.html pinned to a number that no longer describes the log.
export const SEED_EXAMPLE_COUNT = SEED_RECORD_COUNT - REPOSITORY_DECISIONS.length;

// Which of the seed ids are still examples for this visitor. A record the
// visitor actually stored wins on id, so it is their record and is not labelled
// as an example — otherwise an imported record could quietly inherit the badge.
export function exampleIdsFor(recordedIds = []) {
  const recorded = recordedIds instanceof Set ? recordedIds : new Set(recordedIds);
  return new Set([...SEED_DECISION_IDS, ...SEED_RELEASE_IDS].filter((id) => !recorded.has(id)));
}
