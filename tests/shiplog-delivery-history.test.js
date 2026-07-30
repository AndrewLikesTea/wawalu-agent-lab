// The Shiplog delivery-history contract, its leak rule, and the intake surface
// that presents it.
//
// Every fixture is generated here from one base document, one field at a time, so
// a scenario cannot drift from the schema it is checked against and the ceiling
// cases cost no repository bytes. All data is synthetic: the identifiers are
// invented pseudonyms and no file, credential, or network path is involved.
//
// The privacy section is the point of this suite. A label derived from a withheld
// identifier has to be refused even when *neither normalized string contains the
// other*, which is the case the previous containment check passed, so that exact
// pair is asserted both ways: our rule refuses it, and the containment test it
// replaces is shown to pass it.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  IDENTIFIER_DERIVED_REPLACEMENT, MINIMUM_SHARED_RUN, alphanumericRuns,
  assertNoIdentifierLeak, firstSharedIdentifierRun, normalizeForLeakCheck,
  redactIdentifierDerived, sharedIdentifierRun, sharesIdentifierRun,
} from "../src/identifier-leak.js";
import {
  DELIVERY_HISTORY_CODES, DELIVERY_HISTORY_CONTRACT, DELIVERY_HISTORY_KIND,
  DELIVERY_HISTORY_LIMITS, DELIVERY_HISTORY_OUTCOME, MAX_DOCUMENT_BYTES, MAX_RECORDS,
  SUPPORTED_SCHEMA_VERSIONS, claimsDeliveryHistory, deliveriesFromDeliveryHistory,
  parseDeliveryHistory, sanitizeDeliveryLabel,
} from "../src/shiplog-delivery-history.js";
import {
  DELIVERY_HISTORY_SECTION_ID, applyDeliveryHistory, clearDeliveryHistory,
  deliveryHistoryLines,
} from "../src/shiplog-delivery-history-view.js";
import { spendPerDeliveryDecision, spendPerDeliveryInput } from "../src/spend-per-delivery.js";
import { loadPage, textOf } from "./support/browser.js";

// --- the synthetic corpus ---------------------------------------------------

const INSTANCE = "psn_instance000000001";
const EXPORT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const deliveryId = (index) => `psn_aaaaaaaaaaaaaaaa0${index}`;

/**
 * One release. The version labels are numeric on purpose: they must share no
 * three-character run with any identifier in the same document, or the contract
 * would rightly refuse its own valid fixture — which is itself a useful property
 * to have noticed.
 */
const release = (index, day, extra = {}) => ({
  delivery_id: deliveryId(index),
  revision: 1,
  operation: "upsert",
  completed_at: `2026-06-${String(day).padStart(2, "0")}T12:00:00Z`,
  status: "completed",
  version_label: `2026.06.${index}`,
  decision_link_count: 2,
  ...extra,
});

const baseDocument = (overrides = {}) => ({
  schema_version: "1.0",
  kind: DELIVERY_HISTORY_KIND,
  export_id: EXPORT_ID,
  snapshot: {
    source_instance_id: INSTANCE,
    sequence: 7,
    generated_at: "2026-07-01T00:00:00Z",
    mode: "full",
    completeness: "complete",
    omitted_record_count: 0,
    period_start: "2026-06-01",
    period_end: "2026-07-01",
    ...(overrides.snapshot ?? {}),
  },
  privacy: {
    classification_site: "browser_tab",
    release_notes_retained: false,
    direct_identifiers_included: false,
    ...(overrides.privacy ?? {}),
  },
  records: overrides.records ?? [release(1, 4), release(2, 11), release(3, 18), release(4, 25)],
  ...Object.fromEntries(Object.entries(overrides)
    .filter(([key]) => !["snapshot", "privacy", "records"].includes(key))),
});

const parse = (overrides = {}, options = {}) =>
  parseDeliveryHistory(JSON.stringify(baseDocument(overrides)), options);

const codesOf = (outcome) => outcome.codes.join(",");

// --- 1 · a valid export -----------------------------------------------------

test("a valid export is accepted and forwards no withheld identifier", () => {
  const outcome = parse();
  assert.equal(outcome.outcome, DELIVERY_HISTORY_OUTCOME.accepted);
  assert.equal(outcome.usable, true);
  assert.equal(outcome.contract, DELIVERY_HISTORY_CONTRACT);
  assert.deepEqual([...outcome.codes], []);
  assert.equal(outcome.counts.records, 4);
  assert.equal(outcome.counts.counted, 4);
  assert.equal(outcome.counts.quarantined, 0);
  assert.equal(outcome.snapshot.period, "2026-06-01 to 2026-07-01");
  // The forwarded projection: an ordinal, a timestamp, a cleared label, a status.
  assert.deepEqual(outcome.deliveries.map((entry) => entry.ordinal), [1, 2, 3, 4]);
  assert.deepEqual(outcome.deliveries.map((entry) => entry.label),
    ["2026.06.1", "2026.06.2", "2026.06.3", "2026.06.4"]);
  // The whole outcome, serialized: not one withheld identifier survives anywhere
  // in it, under any key, at any depth.
  const serialized = JSON.stringify(outcome);
  for (const withheld of [INSTANCE, EXPORT_ID, deliveryId(1), deliveryId(4)]) {
    assert.equal(serialized.includes(withheld), false,
      `${withheld} must not survive into the forwarded outcome`);
  }
  assert.deepEqual([...outcome.provenance.withheldFields],
    ["delivery_id", "snapshot.source_instance_id", "export_id"]);
  // Freshness with no comparison timestamp is unknown, and says so rather than
  // claiming to be current.
  assert.equal(outcome.snapshot.freshness.state, "unknown");
  assert.match(outcome.notes.join(" "), /Freshness is unknown/);
});

test("an accepted export drives the metric contract without carrying an id into it", () => {
  const outcome = parse();
  const { deliveries, statusDeclared } = deliveriesFromDeliveryHistory(outcome);
  assert.equal(deliveries.length, 4);
  assert.equal(statusDeclared, true);
  assert.equal(deliveries.every((entry) => !("id" in entry)), true,
    "no delivery pseudonym may travel into the metric input");
  const decision = spendPerDeliveryDecision(spendPerDeliveryInput({
    analysis: { period: "2026-06-01 to 2026-07-01", spendUsd: 4000 },
    releases: [],
  }) && {
    spendPeriods: [{ periodStart: "2026-06-01", periodEnd: "2026-07-01", spendUsd: 4000 }],
    deliveries,
    provenance: { origin: "import", source: outcome.provenance.source, derivedFromFields: [] },
  });
  assert.equal(decision.metric.deliveries, 4);
  assert.equal(decision.metric.spendPerDeliveryUsd, 1000);
});

test("the parser claims a file from its kind, not its name", () => {
  assert.equal(claimsDeliveryHistory(JSON.stringify(baseDocument())), true);
  // An unsupported version still claims the contract: the reader has to be told
  // their delivery history was refused, not that nothing recognized it.
  assert.equal(claimsDeliveryHistory(JSON.stringify(baseDocument({ schema_version: "9.9" }))), true);
  assert.equal(claimsDeliveryHistory(JSON.stringify({ kind: "shiplog.export", records: [] })), false);
  assert.equal(claimsDeliveryHistory("delivery_id,completed_at\n1,2026-06-01"), false);
  assert.equal(claimsDeliveryHistory(""), false);
});

// --- 2 · versioning ---------------------------------------------------------

test("an unsupported version is refused without guessing", () => {
  for (const version of ["1.1", "2.0", "0.9", 1, null]) {
    const outcome = parse({ schema_version: version });
    assert.equal(outcome.outcome, DELIVERY_HISTORY_OUTCOME.incompatible);
    assert.equal(outcome.usable, false);
    assert.equal(codesOf(outcome), DELIVERY_HISTORY_CODES.unsupportedVersion);
    assert.deepEqual([...outcome.deliveries], []);
    assert.match(outcome.diagnostics[0].recovery,
      new RegExp(SUPPORTED_SCHEMA_VERSIONS.join(" or ")));
  }
});

test("a different Shiplog artifact is refused as the wrong kind", () => {
  const outcome = parse({ kind: "shiplog.decision_log" });
  assert.equal(codesOf(outcome), DELIVERY_HISTORY_CODES.unsupportedKind);
});

// --- 3 · malformed input ----------------------------------------------------

test("malformed input refuses the whole document and builds no partial state", () => {
  const cases = [
    ["not JSON at all", "{oops", DELIVERY_HISTORY_CODES.invalidJson],
    ["a bare array", "[]", DELIVERY_HISTORY_CODES.notAnEnvelope],
  ];
  for (const [what, text, code] of cases) {
    const outcome = parseDeliveryHistory(text);
    assert.equal(codesOf(outcome), code, what);
    assert.equal(outcome.usable, false);
    assert.equal(outcome.counts.counted, 0);
  }
  // An undeclared field is refused rather than stripped.
  assert.equal(codesOf(parse({ extra_field: 1 })), DELIVERY_HISTORY_CODES.unknownField);
  assert.equal(codesOf(parse({ records: [release(1, 4, { rollout_percent: 50 })] })),
    DELIVERY_HISTORY_CODES.unknownField);
  // …and a field whose *name* is prose or identity says so specifically.
  for (const key of ["release_notes", "author_email", "commit_sha", "source_url"]) {
    const outcome = parse({ records: [release(1, 4, { [key]: "anything" })] });
    assert.equal(codesOf(outcome), DELIVERY_HISTORY_CODES.prohibitedField, key);
    assert.equal(outcome.diagnostics[0].message.includes("anything"), false,
      "a refusal must not echo the value it caught");
  }
  // Missing required fields, at both levels.
  const noStatus = baseDocument();
  delete noStatus.records[0].status;
  assert.equal(codesOf(parseDeliveryHistory(JSON.stringify(noStatus))),
    DELIVERY_HISTORY_CODES.missingField);
  const noPeriod = baseDocument();
  delete noPeriod.snapshot.period_end;
  assert.equal(codesOf(parseDeliveryHistory(JSON.stringify(noPeriod))),
    DELIVERY_HISTORY_CODES.missingField);
  // Values that are well-shaped and impossible.
  assert.equal(codesOf(parse({ snapshot: { period_start: "2026-02-30" } })),
    DELIVERY_HISTORY_CODES.malformedPeriod);
  assert.equal(codesOf(parse({ snapshot: { period_start: "2026-07-01", period_end: "2026-06-01" } })),
    DELIVERY_HISTORY_CODES.malformedPeriod);
  assert.equal(codesOf(parse({ records: [release(1, 4, { completed_at: "2026-06-31T00:00:00Z" })] })),
    DELIVERY_HISTORY_CODES.invalidValue);
  assert.equal(codesOf(parse({ records: [release(1, 4, { revision: 0 })] })),
    DELIVERY_HISTORY_CODES.invalidValue);
  assert.equal(codesOf(parse({ records: [release(1, 4, { delivery_id: "release-7" })] })),
    DELIVERY_HISTORY_CODES.invalidValue);
  assert.equal(codesOf(parse({ export_id: "not-a-uuid" })), DELIVERY_HISTORY_CODES.invalidValue);
  assert.equal(codesOf(parse({ records: [release(1, 4, { status: "shipped" })] })),
    DELIVERY_HISTORY_CODES.invalidValue);
});

test("a privacy declaration this contract does not accept refuses the document", () => {
  for (const privacy of [{ release_notes_retained: true }, { direct_identifiers_included: true },
    { classification_site: "server" }]) {
    assert.equal(codesOf(parse({ privacy })), DELIVERY_HISTORY_CODES.privacyDeclarationRejected);
  }
});

test("both ceilings are enforced before any record is read", () => {
  const oversize = parseDeliveryHistory("x".repeat(MAX_DOCUMENT_BYTES + 1));
  assert.equal(codesOf(oversize), DELIVERY_HISTORY_CODES.fileTooLarge);
  const tooMany = parse({
    records: Array.from({ length: MAX_RECORDS + 1 }, (unused, index) => release(index + 1, 4)),
  });
  assert.equal(codesOf(tooMany), DELIVERY_HISTORY_CODES.tooManyRecords);
  assert.equal(tooMany.counts.records, MAX_RECORDS + 1);
  assert.equal(tooMany.counts.counted, 0);
});

// --- 4 · reordering, duplication, and revisions -----------------------------

test("arrival order decides nothing", () => {
  const ordered = parse();
  const reversed = parse({ records: [release(4, 25), release(3, 18), release(2, 11), release(1, 4)] });
  assert.equal(reversed.outcome, DELIVERY_HISTORY_OUTCOME.accepted);
  assert.deepEqual(reversed.deliveries.map((entry) => entry.label),
    ordered.deliveries.map((entry) => entry.label));
  // A correction that arrives *before* the record it corrects still wins.
  const corrected = parse({
    records: [
      release(1, 20, { revision: 2, version_label: "2026.06.9" }),
      release(1, 4, { revision: 1 }),
    ],
  });
  assert.equal(corrected.counts.duplicatesCollapsed, 1);
  assert.deepEqual(corrected.deliveries.map((entry) => entry.label), ["2026.06.9"]);
});

test("an identical duplicate collapses and a conflicting one refuses the export", () => {
  const identical = parse({ records: [release(1, 4), release(1, 4), release(2, 11)] });
  assert.equal(identical.outcome, DELIVERY_HISTORY_OUTCOME.accepted);
  assert.equal(identical.counts.counted, 2);
  assert.equal(identical.counts.duplicatesCollapsed, 1);
  const conflicting = parse({
    records: [release(1, 4), release(1, 4, { version_label: "2026.06.8" })],
  });
  assert.equal(codesOf(conflicting), DELIVERY_HISTORY_CODES.revisionConflict);
  assert.equal(conflicting.usable, false);
});

test("an explicit tombstone withdraws a release; a tombstone may carry nothing else", () => {
  const withdrawn = parse({
    records: [release(1, 4), { delivery_id: deliveryId(2), revision: 2, operation: "delete",
      completed_at: "2026-06-11T12:00:00Z" }],
  });
  assert.equal(withdrawn.counts.tombstoned, 1);
  assert.equal(withdrawn.counts.counted, 1);
  assert.match(withdrawn.notes.join(" "), /withdrawn by an explicit tombstone/);
  const overreaching = parse({
    records: [release(1, 4), { delivery_id: deliveryId(2), revision: 2, operation: "delete",
      completed_at: "2026-06-11T12:00:00Z", status: "completed" }],
  });
  assert.equal(codesOf(overreaching), DELIVERY_HISTORY_CODES.unknownField);
});

// --- 5 · partial, stale, replayed, period-incompatible ----------------------

test("a partial export is usable and knowably a floor", () => {
  const outcome = parse({ snapshot: { mode: "partial", completeness: "partial", omitted_record_count: 6 } });
  assert.equal(outcome.outcome, DELIVERY_HISTORY_OUTCOME.incomplete);
  assert.equal(outcome.usable, true);
  assert.equal(outcome.counts.counted, 4);
  assert.equal(codesOf(outcome), DELIVERY_HISTORY_CODES.partialExport);
  assert.match(outcome.notes.join(" "), /Absence is not deletion/);
  assert.match(outcome.diagnostics[0].message, /6 records omitted/);
});

test("a stale export is labelled lagging rather than refused", () => {
  const outcome = parse({}, { asOf: "2026-07-10T00:00:00Z" });
  assert.equal(outcome.outcome, DELIVERY_HISTORY_OUTCOME.incomplete);
  assert.equal(outcome.usable, true);
  assert.equal(outcome.snapshot.freshness.state, "stale");
  assert.equal(outcome.snapshot.freshness.hours, 216);
  assert.equal(codesOf(outcome), DELIVERY_HISTORY_CODES.staleExport);
  // Inside the target it is simply current, with no code and no caveat.
  const fresh = parse({}, { asOf: "2026-07-02T00:00:00Z" });
  assert.equal(fresh.outcome, DELIVERY_HISTORY_OUTCOME.accepted);
  assert.equal(fresh.snapshot.freshness.state, "current");
});

test("a replayed sequence changes nothing", () => {
  for (const sequence of [6, 7]) {
    const outcome = parse({ snapshot: { sequence } }, { acceptedSequence: 7 });
    assert.equal(codesOf(outcome), DELIVERY_HISTORY_CODES.staleReplay);
    assert.equal(outcome.usable, false);
    assert.deepEqual([...outcome.deliveries], []);
  }
  assert.equal(parse({ snapshot: { sequence: 8 } }, { acceptedSequence: 7 }).usable, true);
});

test("a release outside the declared period is quarantined and counted", () => {
  const outcome = parse({ records: [release(1, 4), release(2, 11), { ...release(3, 18),
    completed_at: "2026-05-18T12:00:00Z" }] });
  assert.equal(outcome.outcome, DELIVERY_HISTORY_OUTCOME.incomplete);
  assert.equal(outcome.counts.counted, 2);
  assert.equal(outcome.counts.outsidePeriod, 1);
  assert.equal(codesOf(outcome), DELIVERY_HISTORY_CODES.recordOutsidePeriod);
  // The half-open boundary: period_end itself is outside.
  const boundary = parse({ records: [{ ...release(1, 1), completed_at: "2026-07-01T00:00:00Z" }] });
  assert.equal(codesOf(boundary), DELIVERY_HISTORY_CODES.noReleaseInPeriod);
  assert.equal(boundary.usable, false);
});

test("a delivery period that cannot overlap the billing period is refused as a pair", () => {
  const outcome = parse({}, { spendWindow: { start: "2026-08-01", end: "2026-09-01" } });
  assert.equal(codesOf(outcome), DELIVERY_HISTORY_CODES.periodIncompatible);
  assert.equal(outcome.usable, false);
  assert.match(outcome.diagnostics[0].message, /2026-06-01 to 2026-07-01/);
  // A window that overlaps at all is compatible; the metric contract, not this
  // parser, decides whether the overlap is enough to divide.
  assert.equal(parse({}, { spendWindow: { start: "2026-06-15", end: "2026-07-15" } }).usable, true);
});

test("the contract states the limits it does not enforce", () => {
  assert.equal(DELIVERY_HISTORY_LIMITS.length >= 3, true);
  assert.match(DELIVERY_HISTORY_LIMITS.join(" "), /duplicate JSON key/);
});

// --- 6 · the identifier-derived label rule ---------------------------------
//
// The regression this issue exists for. The pair below is the one the previous
// containment check passed.

const LEAKY_ID = "psn_ABCDEF123456789012";

test("a version label sharing a run with a withheld identifier is refused", () => {
  const outcome = parse({
    records: [{ ...release(1, 4), delivery_id: LEAKY_ID, version_label: "build DEF123" }],
  });
  assert.equal(outcome.outcome, DELIVERY_HISTORY_OUTCOME.incompatible);
  assert.equal(outcome.usable, false);
  assert.equal(codesOf(outcome), DELIVERY_HISTORY_CODES.identifierDerivedLabel);
  assert.deepEqual([...outcome.deliveries], []);
  // Neither the label, the run, nor the identifier appears in what is published
  // about the refusal — a rejection that quoted the leak would be the leak.
  const serialized = JSON.stringify(outcome);
  for (const secret of ["build DEF123", "DEF123", "def123", LEAKY_ID, "ABCDEF"]) {
    assert.equal(serialized.includes(secret), false, `${secret} must not be echoed`);
  }
  assert.match(outcome.diagnostics[0].message, /shares a 3-character run/);
});

test("the containment check this rule replaces would have passed that label", () => {
  // Documented so the regression cannot be "simplified" back: containment is not
  // a sufficient test, and here is the pair that proves it.
  const label = normalizeForLeakCheck("build DEF123");
  const identifier = normalizeForLeakCheck("ABCDEF123456");
  assert.equal(label.includes(identifier), false);
  assert.equal(identifier.includes(label), false);
  assert.equal(sharesIdentifierRun("build DEF123", ["ABCDEF123456"]), true);
});

test("punctuation, case, and spacing cannot smuggle a run past the rule", () => {
  for (const label of ["build DEF123", "BUILD-def-123", "d.e.f.1.2.3", "rel_DEF123_final",
    "2026.DEF.123"]) {
    const outcome = parse({
      records: [{ ...release(1, 4), delivery_id: LEAKY_ID, version_label: label }],
    });
    assert.equal(codesOf(outcome), DELIVERY_HISTORY_CODES.identifierDerivedLabel, label);
  }
  // The instance and export pseudonyms are withheld too, so a label derived from
  // either one is refused even though no release carries it.
  assert.equal(codesOf(parse({ records: [release(1, 4, { version_label: "instance-7" })] })),
    DELIVERY_HISTORY_CODES.identifierDerivedLabel);
});

test("the forwarding boundary drops a label the parser never saw", () => {
  assert.deepEqual(sanitizeDeliveryLabel("build DEF123", ["ABCDEF123456"]),
    { label: null, state: "dropped" });
  assert.deepEqual(sanitizeDeliveryLabel("2026.06.1", ["ABCDEF123456"]),
    { label: "2026.06.1", state: "kept" });
  assert.deepEqual(sanitizeDeliveryLabel(null, []), { label: null, state: "absent" });
  // Length and shape are part of the same lock: a label is a short release name,
  // never a sentence and never markup.
  assert.equal(sanitizeDeliveryLabel("x".repeat(65), []).state, "dropped");
  assert.equal(sanitizeDeliveryLabel("<script>alert(1)</script>", []).state, "dropped");
  // …and the adapter applies it, so a hand-built outcome cannot forward one.
  const handBuilt = {
    usable: true,
    deliveries: [{ ordinal: 1, completedAt: "2026-06-04T12:00:00Z", label: "build DEF123", status: "completed" }],
  };
  const { deliveries } = deliveriesFromDeliveryHistory(handBuilt,
    { withheldIdentifiers: ["ABCDEF123456"] });
  assert.deepEqual(deliveries, [{ completedAt: "2026-06-04T12:00:00Z", label: null }]);
});

test("the detector reports a run without reproducing it", () => {
  assert.equal(MINIMUM_SHARED_RUN, 3);
  assert.equal(normalizeForLeakCheck("Build DEF-123!"), "builddef123");
  assert.deepEqual([...alphanumericRuns("abcd")], ["abc", "bcd"]);
  assert.deepEqual([...alphanumericRuns("ab")], []);
  const shared = sharedIdentifierRun("build DEF123", "ABCDEF123456");
  assert.deepEqual(shared, { length: 3, textOffset: 5, identifierOffset: 3 });
  assert.equal(sharedIdentifierRun("2026.06.1", "ABCDEF123456"), null);
  // A one- or two-character identifier cannot reject anything, so a short field
  // does not become a denial of service against every label.
  assert.equal(sharesIdentifierRun("anything", ["ab"]), false);
  const first = firstSharedIdentifierRun("build DEF123", ["zzzzzzzz", "ABCDEF123456"]);
  assert.equal(first.identifierIndex, 1);
  assert.throws(() => assertNoIdentifierLeak("version_label", "build DEF123", ["ABCDEF123456"]),
    (error) => /version_label shares a 3-character run/.test(error.message)
      && !/def123/i.test(error.message));
  assert.equal(assertNoIdentifierLeak("version_label", "2026.06.1", ["ABCDEF123456"]), true);
});

test("redaction removes the offending token, and the whole string when joining leaks", () => {
  assert.equal(redactIdentifierDerived("shipped build DEF123 today", ["ABCDEF123456"]),
    `shipped build ${IDENTIFIER_DERIVED_REPLACEMENT} today`);
  assert.equal(redactIdentifierDerived("nothing to see", ["ABCDEF123456"]), "nothing to see");
  // "AB" and "CD" share no three-run on their own; normalized together they do,
  // and a partial redaction of a leak is a leak.
  assert.equal(redactIdentifierDerived("ab cd", ["xxabcdxx"]), IDENTIFIER_DERIVED_REPLACEMENT);
});

// --- 7 · the intake surface -------------------------------------------------

const PAGE = new URL("../src/evolution.html", import.meta.url);
const shown = (document, id) => textOf(document.getElementById(id));

test("the three outcomes each read as a word, a shape, and a sentence", () => {
  const accepted = deliveryHistoryLines(parse());
  assert.equal(accepted.label, "Accepted");
  assert.equal(accepted.shape, "◆");
  assert.match(accepted.statement, /4 releases recorded as completed in 2026-06-01 to 2026-07-01/);
  assert.match(accepted.latest, /Most recent counted release: 2026\.06\.4 on 2026-06-25/);
  assert.match(accepted.notes.join(" "), /Withheld and never rendered/);

  const floor = deliveryHistoryLines(parse({ snapshot: { completeness: "partial" } }));
  assert.equal(floor.label, "Accepted as a floor");
  assert.equal(floor.shape, "◈");

  const refused = deliveryHistoryLines(parse({ schema_version: "9.9" }));
  assert.equal(refused.label, "Not read");
  assert.equal(refused.shape, "×");
  assert.match(refused.counts, /No release count was taken/);
  assert.equal(refused.latest, "");
});

test("a label the second lock drops is replaced by its ordinal, never rendered", () => {
  // The parser cannot produce this; a caller reaching the view with a hand-built
  // outcome can, and the view is the last boundary before a screen.
  const lines = deliveryHistoryLines({
    outcome: DELIVERY_HISTORY_OUTCOME.accepted,
    usable: true,
    schemaVersion: "1.0",
    counts: { records: 1, counted: 1, quarantined: 0, omittedDeclared: 0 },
    snapshot: { period: "2026-06-01 to 2026-07-01", sequence: 7, freshness: { state: "current" } },
    deliveries: [{ ordinal: 1, completedAt: "2026-06-04T12:00:00Z", status: "completed",
      label: "<img src=x onerror=alert(1)>" }],
    notes: [],
    diagnostics: [],
    provenance: { source: "test", withheldFields: ["delivery_id"] },
  });
  assert.match(lines.latest, /release 1 \(label withheld\)/);
  assert.equal(lines.latest.includes("onerror"), false);
});

test("the shipped intake panel paints all three states and hands the region back", async () => {
  const { document } = await loadPage(PAGE);
  const section = document.getElementById(DELIVERY_HISTORY_SECTION_ID);
  assert.ok(section, "the intake panel must ship the delivery-history region");
  assert.equal(section.hidden, true, "the region says nothing before a file is chosen");

  applyDeliveryHistory(document, parse());
  assert.equal(section.hidden, false);
  assert.equal(section.dataset.outcome, DELIVERY_HISTORY_OUTCOME.accepted);
  assert.equal(section.dataset.contract, DELIVERY_HISTORY_CONTRACT);
  assert.equal(shown(document, "delivery-history-state"), "Accepted");
  assert.match(shown(document, "delivery-history-counts"), /4 records read · 4 counted/);
  assert.match(shown(document, "delivery-history-provenance"), /Read in this tab/);

  applyDeliveryHistory(document, parse({ snapshot: { completeness: "partial", omitted_record_count: 2 } }));
  assert.equal(section.dataset.outcome, DELIVERY_HISTORY_OUTCOME.incomplete);
  assert.match(shown(document, "delivery-history-notes"), /Absence is not deletion/);

  const refused = parse({ records: [{ ...release(1, 4), delivery_id: LEAKY_ID,
    version_label: "build DEF123" }] });
  applyDeliveryHistory(document, refused);
  assert.equal(section.dataset.outcome, DELIVERY_HISTORY_OUTCOME.incompatible);
  assert.equal(shown(document, "delivery-history-state"), "Not read");
  assert.equal(shown(document, "delivery-history-latest"), "");
  // The refusal reaches the page with the recovery and without the leak.
  assert.match(shown(document, "delivery-history-notes"), /share no run of characters/);
  assert.equal(textOf(section).includes("DEF123"), false,
    "an identifier-derived label must never reach the DOM");

  clearDeliveryHistory(document);
  assert.equal(section.hidden, true);
  assert.equal(section.dataset.outcome, "absent");
  assert.equal(shown(document, "delivery-history-state"), "");
});

test("the AI FinOps entry routes a claimed file to this contract and pairs it with spend", async () => {
  const entry = await readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8");
  // The wiring this issue is only useful with: the parse is reached from the
  // file queue, the outcome is painted, and an accepted history replaces the
  // local release log in the metric input rather than being merged with it.
  assert.match(entry, /from "\/shiplog-delivery-history\.js"/);
  assert.match(entry, /from "\/shiplog-delivery-history-view\.js"/);
  assert.match(entry, /claimsDeliveryHistory\(file\.text\)/);
  assert.match(entry, /applyDeliveryHistory\(document, outcome\)/);
  assert.match(entry, /withDeliveryHistory\(base, importedDeliveryHistory\)/);
  assert.match(entry, /parseDeliveryHistory\(selectedDeliveryHistoryText/);
  assert.match(entry, /importedDeliveryHistory = outcome\.usable \? outcome : null/);
  assert.match(entry, /clearDeliveryHistory\(document\)/);
});
