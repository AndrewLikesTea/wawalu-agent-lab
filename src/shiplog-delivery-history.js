/**
 * Executable integration contract: a Shiplog **delivery-history** export, read
 * in the browser as the denominator side of local AI spend per delivery.
 *
 * THE ONE THING THIS SUPPLIES
 *
 *     How many releases a team recorded as completed inside a declared period,
 *     and whether that count is trustworthy enough to divide spend by.
 *
 * `spend-per-delivery.js` already answers "is spend keeping pace with delivery?"
 * from *this browser's own* release log. That works for a reader who records
 * releases here and nowhere else. A FinOps lead usually cannot: the releases are
 * in another Shiplog instance, another tab, or another team's install. This
 * contract is the file that carries them across — a JSON document, chosen with
 * the file picker, validated and consumed entirely in the tab.
 *
 * WHAT CROSSES THE BOUNDARY, AND WHAT NEVER DOES
 *
 * Per release: an opaque delivery id, a revision, an operation, a completion
 * timestamp, a coarse status, an optional short version label, and a count of
 * linked decisions. That is the whole allowlist, and `additionalProperties:
 * false` is enforced here rather than described: an undeclared field rejects the
 * document instead of being stripped.
 *
 * Never: release notes, commit messages, branch names, diffs, ticket text,
 * author or reviewer identity, repository or instance URLs, credentials, or any
 * free prose. `docs/shiplog-delivery-history-contract.md` states the boundary;
 * `PROHIBITED_FIELD_PATTERN` refuses the common ways it gets crossed by accident.
 *
 * THE IDENTIFIER-DERIVED LABEL RULE
 *
 * `delivery_id`, `source_instance_id`, and `export_id` are withheld: they are
 * validated, joined on, and then dropped, and nothing this module returns can be
 * rendered back to them. A producer-authored `version_label` is the one string
 * that *is* forwarded — so it is the one string that can smuggle a withheld
 * identifier out. Containment is not a sufficient test for that (see
 * `identifier-leak.js`): a label sharing any contiguous run of three or more
 * alphanumeric characters with a withheld identifier is treated as derived from
 * it, and the whole document is refused as a privacy violation, exactly as an
 * undeclared field is. `sanitizeDeliveryLabel` re-applies the same test at the
 * forwarding boundary as a second lock, so a caller that assembled records by
 * hand still cannot publish one.
 *
 * DELIBERATELY OUT OF SCOPE. Any live connection, credential, URL, upload,
 * webhook, or polling schedule; release size, scope, quality, or content; author
 * or team attribution; and any write back to a source instance. A real connector
 * is a deployment decision and is not made here.
 *
 * LOCALITY AND PURITY. No fetch, storage, clock, randomness, or credential path.
 * Freshness is judged against a caller-supplied `asOf`, never `Date.now()`, so
 * the same file always produces the same outcome in a test and on the page.
 */

import {
  MINIMUM_SHARED_RUN, firstSharedIdentifierRun, sharesIdentifierRun,
} from "./identifier-leak.js";

// Re-exported so a consumer of this contract states the rule it is bound by from
// one import rather than reaching past it into the detector.
export { MINIMUM_SHARED_RUN };

export const DELIVERY_HISTORY_CONTRACT = "shiplog-delivery-history/1.0";

/** Exact versions this consumer has reviewed. An unknown one is never guessed. */
export const SUPPORTED_SCHEMA_VERSIONS = Object.freeze(["1.0"]);

export const DELIVERY_HISTORY_KIND = "shiplog.delivery_history";

/**
 * The three outcomes a reader is shown, and the only three this module returns.
 *
 * `incomplete` is not a soft failure and not a warning: it is a usable count
 * that is knowably a floor, and it is a distinct state precisely so a partial or
 * stale export can be used *and labelled* rather than either silently accepted
 * or needlessly refused.
 */
export const DELIVERY_HISTORY_OUTCOME = Object.freeze({
  accepted: "accepted",
  incomplete: "incomplete",
  incompatible: "incompatible",
});

/** Machine-readable reasons. Every one of them has a recovery sentence below. */
export const DELIVERY_HISTORY_CODES = Object.freeze({
  fileTooLarge: "file_too_large",
  invalidJson: "invalid_json",
  notAnEnvelope: "not_an_envelope",
  unsupportedVersion: "unsupported_version",
  unsupportedKind: "unsupported_kind",
  unknownField: "unknown_field",
  missingField: "missing_field",
  invalidValue: "invalid_value",
  prohibitedField: "prohibited_field",
  privacyDeclarationRejected: "privacy_declaration_rejected",
  identifierDerivedLabel: "identifier_derived_label",
  tooManyRecords: "too_many_records",
  revisionConflict: "revision_conflict",
  malformedPeriod: "malformed_period",
  recordOutsidePeriod: "record_outside_period",
  noReleaseInPeriod: "no_release_in_declared_period",
  periodIncompatible: "period_incompatible_with_spend",
  staleReplay: "stale_replay",
  staleExport: "stale_export",
  partialExport: "partial_export",
});

const RECOVERY = Object.freeze({
  [DELIVERY_HISTORY_CODES.fileTooLarge]: "Export a narrower date range; the byte ceiling is stated in the message.",
  [DELIVERY_HISTORY_CODES.invalidJson]: "Re-export the history; the file is not valid JSON.",
  [DELIVERY_HISTORY_CODES.notAnEnvelope]: "Choose a delivery-history export, not a bare list of releases.",
  [DELIVERY_HISTORY_CODES.unsupportedVersion]: `Export schema_version ${SUPPORTED_SCHEMA_VERSIONS.join(" or ")}; an unreviewed version is never guessed at.`,
  [DELIVERY_HISTORY_CODES.unsupportedKind]: "Choose a delivery-history export rather than another Shiplog artifact.",
  [DELIVERY_HISTORY_CODES.unknownField]: "Remove the undeclared field at source; a consumer that stripped it would hide what it received.",
  [DELIVERY_HISTORY_CODES.missingField]: "Add the named field to the export and choose the file again.",
  [DELIVERY_HISTORY_CODES.invalidValue]: "Correct the named field at source and choose the file again.",
  [DELIVERY_HISTORY_CODES.prohibitedField]: "Remove release prose, identity, and location fields at source; this contract carries none of them.",
  [DELIVERY_HISTORY_CODES.privacyDeclarationRejected]: "Export with the browser-tab privacy declaration this contract requires.",
  [DELIVERY_HISTORY_CODES.identifierDerivedLabel]: "Author version labels that share no run of characters with a delivery or instance id.",
  [DELIVERY_HISTORY_CODES.tooManyRecords]: "Split the history into shorter periods; the record ceiling is stated in the message.",
  [DELIVERY_HISTORY_CODES.revisionConflict]: "Correct the source so one delivery and revision has one content, then re-export with a new export_id.",
  [DELIVERY_HISTORY_CODES.malformedPeriod]: "Correct period_start and period_end so the period is a real half-open range.",
  [DELIVERY_HISTORY_CODES.recordOutsidePeriod]: "Re-export so every release falls inside the declared period.",
  [DELIVERY_HISTORY_CODES.noReleaseInPeriod]: "Choose an export whose declared period actually contains the releases it lists.",
  [DELIVERY_HISTORY_CODES.periodIncompatible]: "Export the delivery period that overlaps your billing period, or compare the two separately.",
  [DELIVERY_HISTORY_CODES.staleReplay]: "Nothing to fix: a sequence at or below one already read is a replay and changes no reading.",
  [DELIVERY_HISTORY_CODES.staleExport]: "Re-export the period from the source instance to refresh the count.",
  [DELIVERY_HISTORY_CODES.partialExport]: "Request a complete snapshot when you need the count to be final rather than a floor.",
});

/** Enforced before parsing. A local file, not a transfer: generous but bounded. */
export const MAX_DOCUMENT_BYTES = 4_000_000;
export const MAX_RECORDS = 20_000;
export const MAX_VERSION_LABEL_LENGTH = 64;

/** Freshness target, in hours after `generated_at`, judged against `asOf`. */
export const STALE_AFTER_HOURS = 72;

/** The provenance fields an accepted export declares to the metric contract. */
export const DELIVERY_HISTORY_PROVENANCE_FIELDS = Object.freeze([
  "local.shiplog.release.created_at",
  "local.shiplog.release.status",
]);

/**
 * What this contract does not enforce, stated rather than implied.
 *
 * A duplicate JSON key is the notable one: the platform parser collapses it
 * before any code here runs, so "reject duplicate keys" is a producer obligation
 * and a transport obligation, not something this consumer can verify. Saying so
 * is the point — a reader who believes the boundary catches it would trust the
 * wrong thing.
 */
export const DELIVERY_HISTORY_LIMITS = Object.freeze([
  "A duplicate JSON key collapses in the browser's parser before validation; the "
  + "last value wins and no code here can see the first. Producers must not emit one.",
  "Freshness is judged against a timestamp the caller supplies. With none, the "
  + "export is reported as freshness-unknown rather than assumed current.",
  "One export is one reading. This module holds no high-water mark of its own; a "
  + "caller that wants replay protection passes the sequence it last accepted.",
]);

const OPAQUE_ID = /^psn_[A-Za-z0-9_-]{16,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const VERSION_LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._+-]*$/;

/**
 * Field names this contract refuses on sight, anywhere in the document.
 *
 * Not a content scan — a *shape* scan. Free prose and identity cannot be
 * recognized by looking at a value, but they arrive under names like `notes`,
 * `author`, `branch`, and `url` when a producer serializes a vendor object
 * instead of projecting one. The allowlist below already rejects every unknown
 * field; this pattern exists so the diagnostic says *why* rather than "unknown".
 */
const PROHIBITED_FIELD_PATTERN =
  /(note|summary|description|message|title|body|text|prose|author|owner|reviewer|committer|email|user|actor|branch|commit|sha|diff|repo|repository|url|uri|href|link|host|ip|token|key|secret|credential|cookie|prompt)/;

const ENVELOPE_FIELDS = Object.freeze(["schema_version", "kind", "export_id", "snapshot", "privacy", "records"]);
const SNAPSHOT_FIELDS = Object.freeze(["source_instance_id", "sequence", "generated_at", "mode",
  "completeness", "omitted_record_count", "period_start", "period_end"]);
const PRIVACY_FIELDS = Object.freeze(["classification_site", "release_notes_retained",
  "direct_identifiers_included"]);
const UPSERT_FIELDS = Object.freeze(["delivery_id", "revision", "operation", "completed_at",
  "status", "version_label", "decision_link_count"]);
const DELETE_FIELDS = Object.freeze(["delivery_id", "revision", "operation", "completed_at"]);

const MODES = Object.freeze(["full", "partial"]);
const COMPLETENESS = Object.freeze(["complete", "partial"]);
const STATUSES = Object.freeze(["completed", "rolled_back", "in_progress", "abandoned"]);
const OPERATIONS = Object.freeze(["upsert", "delete"]);

/** The one status that counts as a delivery. Everything else is recorded, not shipped. */
export const DELIVERED_STATUS = "completed";

// --- primitive validation ---------------------------------------------------

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** A real calendar date, not merely a well-shaped one. 2026-02-30 is refused. */
function calendarDate(value) {
  const match = ISO_DATE.exec(String(value ?? ""));
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const stamp = Date.UTC(year, month - 1, day);
  const date = new Date(stamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) return null;
  return stamp;
}

function calendarTimestamp(value) {
  const match = RFC3339.exec(String(value ?? ""));
  if (!match) return null;
  if (calendarDate(`${match[1]}-${match[2]}-${match[3]}`) === null) return null;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? stamp : null;
}

const isInteger = (value, minimum) =>
  Number.isInteger(value) && value >= minimum;

/**
 * A rejection: an outcome shaped exactly like an accepted one, so a caller
 * renders one code path. `usable` is false and `deliveries` is empty, always —
 * an incompatible document contributes no releases, not some of them.
 */
function refuse(code, message, detail = {}) {
  return Object.freeze({
    contract: DELIVERY_HISTORY_CONTRACT,
    schemaVersion: detail.schemaVersion ?? null,
    outcome: DELIVERY_HISTORY_OUTCOME.incompatible,
    usable: false,
    codes: Object.freeze([code]),
    snapshot: null,
    counts: Object.freeze({
      records: detail.records ?? 0, counted: 0, quarantined: 0, outsidePeriod: 0,
      tombstoned: 0, duplicatesCollapsed: 0, omittedDeclared: 0,
    }),
    deliveries: Object.freeze([]),
    notes: Object.freeze([]),
    provenance: Object.freeze({
      source: "A delivery-history file this tab refused. Nothing from it reached the analysis.",
      origin: "rejected",
      declaredFields: Object.freeze([]),
      withheldFields: WITHHELD_FIELDS,
    }),
    diagnostics: Object.freeze([Object.freeze({
      code, message, recovery: RECOVERY[code] ?? RECOVERY[DELIVERY_HISTORY_CODES.invalidValue],
    })]),
  });
}

/** Named on every outcome, refused or accepted, so the promise is visible. */
const WITHHELD_FIELDS = Object.freeze(["delivery_id", "snapshot.source_instance_id", "export_id"]);

function fieldProblem(path, value, allowed) {
  const keys = Object.keys(value);
  for (const key of keys) {
    if (allowed.includes(key)) continue;
    return PROHIBITED_FIELD_PATTERN.test(key.toLowerCase())
      ? { code: DELIVERY_HISTORY_CODES.prohibitedField, message: `${path}.${key} is a field this contract refuses to carry.` }
      : { code: DELIVERY_HISTORY_CODES.unknownField, message: `${path}.${key} is not declared by ${DELIVERY_HISTORY_CONTRACT}.` };
  }
  for (const key of allowed) {
    if (!(key in value)) {
      return { code: DELIVERY_HISTORY_CODES.missingField, message: `${path}.${key} is required and absent.` };
    }
  }
  return null;
}

/**
 * Does this file claim to be a delivery history?
 *
 * The intake queue asks before it parses, because *what a file is* comes from its
 * bytes and not from its name — and because a file that claims this kind must be
 * reported against this contract even when it fails it. An unsupported version or
 * a malformed record has to reach the reader as "this delivery history was not
 * read, here is why", never as "some other reader did not recognize it".
 */
export function claimsDeliveryHistory(text) {
  try {
    const document = JSON.parse(String(text ?? ""));
    return isPlainObject(document) && document.kind === DELIVERY_HISTORY_KIND;
  } catch {
    return false;
  }
}

// --- the parse --------------------------------------------------------------

/**
 * Validate one delivery-history document and report what may be used from it.
 *
 * @param text the file's bytes as a string. Nothing else is accepted: a caller
 *   that already parsed the JSON has already lost the chance to refuse it.
 * @param options.asOf an RFC 3339 timestamp to judge freshness against, or null
 *   for freshness-unknown. Never a clock read inside this module.
 * @param options.acceptedSequence the highest sequence this caller has already
 *   read for the same source, or null. A sequence at or below it is a replay.
 * @param options.spendWindow `{ start, end }` ISO dates of the billing period
 *   the count will be divided into, or null. A declared delivery period that
 *   cannot overlap it is period-incompatible and yields no count.
 * @returns a frozen outcome. Total: it never throws on input, because a hostile
 *   file is a state this surface has to render, not an exception to leak.
 */
export function parseDeliveryHistory(text, {
  asOf = null, acceptedSequence = null, spendWindow = null,
} = {}) {
  const source = String(text ?? "");
  if (source.length > MAX_DOCUMENT_BYTES) {
    return refuse(DELIVERY_HISTORY_CODES.fileTooLarge,
      `The delivery history is larger than the ${MAX_DOCUMENT_BYTES}-character ceiling this tab reads.`);
  }
  let document;
  try {
    document = JSON.parse(source);
  } catch {
    return refuse(DELIVERY_HISTORY_CODES.invalidJson, "The file is not valid JSON.");
  }
  if (!isPlainObject(document)) {
    return refuse(DELIVERY_HISTORY_CODES.notAnEnvelope,
      `The top level is not a ${DELIVERY_HISTORY_CONTRACT} envelope object.`);
  }
  // Version and kind before shape: an unreviewed version is refused without any
  // claim about whether the rest of it would have validated.
  if (typeof document.schema_version !== "string"
    || !SUPPORTED_SCHEMA_VERSIONS.includes(document.schema_version)) {
    return refuse(DELIVERY_HISTORY_CODES.unsupportedVersion,
      `schema_version is not one this consumer has reviewed (${SUPPORTED_SCHEMA_VERSIONS.join(", ")}).`);
  }
  const schemaVersion = document.schema_version;
  if (document.kind !== DELIVERY_HISTORY_KIND) {
    return refuse(DELIVERY_HISTORY_CODES.unsupportedKind,
      `kind must be ${DELIVERY_HISTORY_KIND}.`, { schemaVersion });
  }
  const envelopeProblem = fieldProblem("document", document, ENVELOPE_FIELDS);
  if (envelopeProblem) return refuse(envelopeProblem.code, envelopeProblem.message, { schemaVersion });
  if (typeof document.export_id !== "string" || !UUID.test(document.export_id)) {
    return refuse(DELIVERY_HISTORY_CODES.invalidValue,
      "export_id must be a UUID so a retry is idempotent.", { schemaVersion });
  }
  if (!isPlainObject(document.snapshot) || !isPlainObject(document.privacy)) {
    return refuse(DELIVERY_HISTORY_CODES.invalidValue,
      "snapshot and privacy must both be objects.", { schemaVersion });
  }
  const snapshotProblem = fieldProblem("snapshot", document.snapshot, SNAPSHOT_FIELDS);
  if (snapshotProblem) return refuse(snapshotProblem.code, snapshotProblem.message, { schemaVersion });
  const privacyProblem = fieldProblem("privacy", document.privacy, PRIVACY_FIELDS);
  if (privacyProblem) return refuse(privacyProblem.code, privacyProblem.message, { schemaVersion });

  const snapshot = document.snapshot;
  if (typeof snapshot.source_instance_id !== "string" || !OPAQUE_ID.test(snapshot.source_instance_id)) {
    return refuse(DELIVERY_HISTORY_CODES.invalidValue,
      "snapshot.source_instance_id must be an opaque psn_ pseudonym.", { schemaVersion });
  }
  if (!isInteger(snapshot.sequence, 0)) {
    return refuse(DELIVERY_HISTORY_CODES.invalidValue,
      "snapshot.sequence must be a non-negative integer.", { schemaVersion });
  }
  const generatedAt = calendarTimestamp(snapshot.generated_at);
  if (generatedAt === null) {
    return refuse(DELIVERY_HISTORY_CODES.invalidValue,
      "snapshot.generated_at must be an RFC 3339 timestamp on a real calendar date.", { schemaVersion });
  }
  if (!MODES.includes(snapshot.mode) || !COMPLETENESS.includes(snapshot.completeness)) {
    return refuse(DELIVERY_HISTORY_CODES.invalidValue,
      `snapshot.mode must be one of ${MODES.join(", ")} and snapshot.completeness one of ${COMPLETENESS.join(", ")}.`,
      { schemaVersion });
  }
  if (!isInteger(snapshot.omitted_record_count, 0)) {
    return refuse(DELIVERY_HISTORY_CODES.invalidValue,
      "snapshot.omitted_record_count must be a non-negative integer.", { schemaVersion });
  }
  const periodStart = calendarDate(snapshot.period_start);
  const periodEnd = calendarDate(snapshot.period_end);
  if (periodStart === null || periodEnd === null || periodStart >= periodEnd) {
    return refuse(DELIVERY_HISTORY_CODES.malformedPeriod,
      "snapshot.period_start and period_end must be real calendar dates forming a half-open period.",
      { schemaVersion });
  }
  const privacy = document.privacy;
  if (privacy.classification_site !== "browser_tab" || privacy.release_notes_retained !== false
    || privacy.direct_identifiers_included !== false) {
    return refuse(DELIVERY_HISTORY_CODES.privacyDeclarationRejected,
      "privacy must declare browser-tab reading, no retained release notes, and no direct identifiers.",
      { schemaVersion });
  }
  if (!Array.isArray(document.records)) {
    return refuse(DELIVERY_HISTORY_CODES.invalidValue, "records must be an array.", { schemaVersion });
  }
  if (document.records.length > MAX_RECORDS) {
    return refuse(DELIVERY_HISTORY_CODES.tooManyRecords,
      `records holds more than the ${MAX_RECORDS}-record ceiling this tab reads.`,
      { schemaVersion, records: document.records.length });
  }

  // The withheld set every forwarded string is checked against. The instance and
  // export ids are in it as well as the per-record ids: a label derived from the
  // instance pseudonym correlates two exports just as well as one derived from a
  // release's own id.
  const withheld = [snapshot.source_instance_id, document.export_id,
    ...document.records.map((record) => (isPlainObject(record) ? record.delivery_id : null))]
    .filter((value) => typeof value === "string");

  const byDelivery = new Map();
  let duplicatesCollapsed = 0;
  let tombstoned = 0;
  let outsidePeriod = 0;
  const records = document.records;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const path = `records[${index}]`;
    if (!isPlainObject(record)) {
      return refuse(DELIVERY_HISTORY_CODES.invalidValue, `${path} must be an object.`,
        { schemaVersion, records: records.length });
    }
    if (!OPERATIONS.includes(record.operation)) {
      return refuse(DELIVERY_HISTORY_CODES.invalidValue,
        `${path}.operation must be one of ${OPERATIONS.join(", ")}.`,
        { schemaVersion, records: records.length });
    }
    const isDelete = record.operation === "delete";
    const problem = fieldProblem(path, record, isDelete ? DELETE_FIELDS : UPSERT_FIELDS);
    // A version label is the one optional field, so its absence is not a
    // missing field — but an absent *required* field, an undeclared one, and a
    // prohibited one all still refuse the document.
    if (problem && !(problem.code === DELIVERY_HISTORY_CODES.missingField
      && problem.message.includes(".version_label"))) {
      return refuse(problem.code, problem.message, { schemaVersion, records: records.length });
    }
    if (typeof record.delivery_id !== "string" || !OPAQUE_ID.test(record.delivery_id)) {
      return refuse(DELIVERY_HISTORY_CODES.invalidValue,
        `${path}.delivery_id must be an opaque psn_ pseudonym.`,
        { schemaVersion, records: records.length });
    }
    if (!isInteger(record.revision, 1)) {
      return refuse(DELIVERY_HISTORY_CODES.invalidValue,
        `${path}.revision must be an integer of 1 or more.`, { schemaVersion, records: records.length });
    }
    const completedAt = calendarTimestamp(record.completed_at);
    if (completedAt === null) {
      return refuse(DELIVERY_HISTORY_CODES.invalidValue,
        `${path}.completed_at must be an RFC 3339 timestamp on a real calendar date.`,
        { schemaVersion, records: records.length });
    }
    let status = null;
    let label = null;
    let decisionLinks = 0;
    if (!isDelete) {
      if (!STATUSES.includes(record.status)) {
        return refuse(DELIVERY_HISTORY_CODES.invalidValue,
          `${path}.status must be one of ${STATUSES.join(", ")}.`,
          { schemaVersion, records: records.length });
      }
      status = record.status;
      if (!isInteger(record.decision_link_count, 0)) {
        return refuse(DELIVERY_HISTORY_CODES.invalidValue,
          `${path}.decision_link_count must be a non-negative integer.`,
          { schemaVersion, records: records.length });
      }
      decisionLinks = record.decision_link_count;
      if (record.version_label !== undefined && record.version_label !== null) {
        if (typeof record.version_label !== "string"
          || record.version_label.length > MAX_VERSION_LABEL_LENGTH
          || !VERSION_LABEL.test(record.version_label)) {
          return refuse(DELIVERY_HISTORY_CODES.invalidValue,
            `${path}.version_label must be at most ${MAX_VERSION_LABEL_LENGTH} characters of a short release name.`,
            { schemaVersion, records: records.length });
        }
        // The privacy rule this contract exists to enforce. The message names
        // the run's length and where it started; it never quotes the label, the
        // run, or the identifier, because a rejection that printed the leak
        // would be the leak.
        const shared = firstSharedIdentifierRun(record.version_label, withheld);
        if (shared) {
          return refuse(DELIVERY_HISTORY_CODES.identifierDerivedLabel,
            `${path}.version_label shares a ${shared.length}-character run with a withheld `
            + `identifier at normalized offset ${shared.textOffset}, so it is identifier-derived `
            + "and the document is refused.",
            { schemaVersion, records: records.length });
        }
        label = record.version_label;
      }
    }
    // Reordering is not authority. Arrival order decides nothing: the greatest
    // revision for a delivery wins whether it came first or last, an identical
    // copy collapses, and a differing copy at the same revision refuses the
    // document rather than letting array order pick a winner.
    const held = byDelivery.get(record.delivery_id);
    const candidate = { revision: record.revision, operation: record.operation, completedAt, status, label, decisionLinks };
    if (held) {
      if (held.revision === record.revision) {
        const same = held.operation === candidate.operation && held.completedAt === candidate.completedAt
          && held.status === candidate.status && held.label === candidate.label
          && held.decisionLinks === candidate.decisionLinks;
        if (!same) {
          return refuse(DELIVERY_HISTORY_CODES.revisionConflict,
            `${path} repeats a delivery at revision ${record.revision} with different content, `
            + "so no winner can be chosen.", { schemaVersion, records: records.length });
        }
        duplicatesCollapsed += 1;
        continue;
      }
      if (held.revision > record.revision) {
        duplicatesCollapsed += 1;
        continue;
      }
      duplicatesCollapsed += 1;
    }
    byDelivery.set(record.delivery_id, candidate);
  }

  // Ordered by completion, then by the fields that are actually forwarded, so
  // the same document always yields the same list without the withheld id
  // deciding anything.
  const resolved = [...byDelivery.values()].sort((left, right) =>
    left.completedAt - right.completedAt
    || String(left.label).localeCompare(String(right.label))
    || left.revision - right.revision);

  const deliveries = [];
  for (const entry of resolved) {
    if (entry.operation === "delete") {
      tombstoned += 1;
      continue;
    }
    if (entry.completedAt < periodStart || entry.completedAt >= periodEnd) {
      outsidePeriod += 1;
      continue;
    }
    deliveries.push(entry);
  }

  const codes = [];
  const notes = [];
  const diagnostics = [];
  const add = (code, message) => {
    codes.push(code);
    diagnostics.push(Object.freeze({ code, message, recovery: RECOVERY[code] }));
  };

  // A replay is not a defect and not an error: it is a document that changes
  // nothing, and saying so is more useful than either accepting it twice or
  // reporting it as broken.
  if (acceptedSequence !== null && Number.isInteger(acceptedSequence)
    && snapshot.sequence <= acceptedSequence) {
    return refuse(DELIVERY_HISTORY_CODES.staleReplay,
      `snapshot.sequence ${snapshot.sequence} is at or below the sequence already read `
      + `(${acceptedSequence}), so this export is an acknowledged replay and replaces no reading.`,
      { schemaVersion, records: records.length });
  }
  if (spendWindow?.start && spendWindow?.end) {
    const windowStart = calendarDate(spendWindow.start);
    const windowEnd = calendarDate(spendWindow.end);
    if (windowStart !== null && windowEnd !== null
      && (periodEnd <= windowStart || periodStart >= windowEnd)) {
      return refuse(DELIVERY_HISTORY_CODES.periodIncompatible,
        `The declared delivery period ${snapshot.period_start} to ${snapshot.period_end} does not `
        + `overlap the billing period ${spendWindow.start} to ${spendWindow.end}, so no ratio can `
        + "be formed from the pair.", { schemaVersion, records: records.length });
    }
  }
  if (deliveries.length === 0 && records.length > 0) {
    return refuse(DELIVERY_HISTORY_CODES.noReleaseInPeriod,
      `No release in this export falls inside its own declared period `
      + `${snapshot.period_start} to ${snapshot.period_end}.`,
      { schemaVersion, records: records.length });
  }

  if (snapshot.completeness === "partial" || snapshot.mode === "partial"
    || snapshot.omitted_record_count > 0) {
    add(DELIVERY_HISTORY_CODES.partialExport,
      `The export declares itself ${snapshot.completeness} in ${snapshot.mode} mode with `
      + `${snapshot.omitted_record_count} record${snapshot.omitted_record_count === 1 ? "" : "s"} omitted, `
      + "so the count below is a floor.");
    notes.push("Absence is not deletion: a release this export omits is not treated as un-shipped.");
  }
  if (outsidePeriod > 0) {
    add(DELIVERY_HISTORY_CODES.recordOutsidePeriod,
      `${outsidePeriod} release${outsidePeriod === 1 ? "" : "s"} fall outside the declared period `
      + "and are not counted.");
  }
  const freshness = freshnessOf(generatedAt, asOf);
  if (freshness.state === "stale") {
    add(DELIVERY_HISTORY_CODES.staleExport,
      `The export was generated ${freshness.hours} hours before the period being analyzed, past the `
      + `${STALE_AFTER_HOURS}-hour freshness target, so the count may lag the source.`);
  }
  if (freshness.state === "unknown") {
    notes.push("Freshness is unknown: no comparison timestamp was supplied, so this count is "
      + "neither claimed to be current nor reported as stale.");
  }
  if (tombstoned > 0) {
    notes.push(`${tombstoned} release${tombstoned === 1 ? " was" : "s were"} withdrawn by an explicit `
      + "tombstone in this export and are not counted.");
  }
  if (duplicatesCollapsed > 0) {
    notes.push(`${duplicatesCollapsed} repeated record${duplicatesCollapsed === 1 ? "" : "s"} collapsed `
      + "to the greatest revision; arrival order decided nothing.");
  }

  const counted = deliveries.filter((entry) => entry.status === DELIVERED_STATUS).length;
  const outcome = codes.length ? DELIVERY_HISTORY_OUTCOME.incomplete : DELIVERY_HISTORY_OUTCOME.accepted;
  const period = `${snapshot.period_start} to ${snapshot.period_end}`;

  return Object.freeze({
    contract: DELIVERY_HISTORY_CONTRACT,
    schemaVersion,
    outcome,
    usable: true,
    codes: Object.freeze(codes),
    snapshot: Object.freeze({
      sequence: snapshot.sequence,
      generatedAt: snapshot.generated_at,
      mode: snapshot.mode,
      completeness: snapshot.completeness,
      omittedRecordCount: snapshot.omitted_record_count,
      periodStart: snapshot.period_start,
      periodEnd: snapshot.period_end,
      period,
      freshness: Object.freeze(freshness),
    }),
    counts: Object.freeze({
      records: records.length,
      counted,
      quarantined: outsidePeriod + tombstoned,
      outsidePeriod,
      tombstoned,
      duplicatesCollapsed,
      omittedDeclared: snapshot.omitted_record_count,
    }),
    // The forwarded projection: an ordinal instead of the withheld id, the
    // completion timestamp, a validated label or null, and the status. Nothing
    // here can be rendered back to a delivery, an instance, or an export.
    deliveries: Object.freeze(deliveries.map((entry, index) => Object.freeze({
      ordinal: index + 1,
      completedAt: new Date(entry.completedAt).toISOString(),
      label: entry.label,
      status: entry.status,
      decisionLinks: entry.decisionLinks,
    }))),
    notes: Object.freeze(notes),
    provenance: Object.freeze({
      source: `Shiplog delivery history ${schemaVersion}, sequence ${snapshot.sequence}, `
        + `covering ${period}. Read in this tab; nothing was uploaded or stored.`,
      origin: "delivery_history_file",
      declaredFields: DELIVERY_HISTORY_PROVENANCE_FIELDS,
      withheldFields: WITHHELD_FIELDS,
    }),
    diagnostics: Object.freeze(diagnostics),
  });
}

/**
 * Freshness as a state and an interval, never as a boolean.
 *
 * "Unknown" is a real answer: a caller with no comparison timestamp gets it
 * rather than a default of "current", because defaulting to current is how a
 * six-month-old export ends up captioned as this month's delivery rate.
 */
function freshnessOf(generatedAt, asOf) {
  const reference = calendarTimestamp(asOf);
  if (reference === null) return { state: "unknown", hours: null, target: STALE_AFTER_HOURS };
  const hours = Math.round((reference - generatedAt) / 3_600_000);
  return {
    state: hours > STALE_AFTER_HOURS ? "stale" : "current",
    hours,
    target: STALE_AFTER_HOURS,
  };
}

/**
 * The second lock on the label rule.
 *
 * `parseDeliveryHistory` already refuses a document whose label is derived from
 * a withheld identifier. This is what a caller assembling deliveries from
 * anywhere else — a hand-built record, a future adapter, a test — passes a label
 * through before it reaches a rendered surface. Same test, same bias: a label it
 * cannot clear is dropped, not truncated.
 *
 * @returns `{ label, state }` where state is "kept", "dropped", or "absent".
 */
export function sanitizeDeliveryLabel(label, withheldIdentifiers = []) {
  if (typeof label !== "string" || !label.trim()) {
    return Object.freeze({ label: null, state: "absent" });
  }
  if (label.length > MAX_VERSION_LABEL_LENGTH || !VERSION_LABEL.test(label)
    || sharesIdentifierRun(label, withheldIdentifiers, MINIMUM_SHARED_RUN)) {
    return Object.freeze({ label: null, state: "dropped" });
  }
  return Object.freeze({ label, state: "kept" });
}

/**
 * Adapt an accepted outcome into the delivery shape `spendPerDeliveryInput`
 * already takes.
 *
 * No `id` is emitted at all. The metric contract defaults a missing one to its
 * own positional handle, so the withheld pseudonym has no reason to travel — and
 * a field that never travels cannot leak. `statusDeclared` is true because this
 * contract requires `status` on every upsert, which is exactly the provenance
 * field the metric lowers confidence for when it is absent.
 */
export function deliveriesFromDeliveryHistory(outcome, { withheldIdentifiers = [] } = {}) {
  if (!outcome?.usable) return { deliveries: [], statusDeclared: false };
  const deliveries = outcome.deliveries
    .filter((entry) => entry.status === DELIVERED_STATUS)
    .map((entry) => ({
      completedAt: entry.completedAt,
      label: sanitizeDeliveryLabel(entry.label, withheldIdentifiers).label,
    }));
  return { deliveries, statusDeclared: deliveries.length > 0 };
}
