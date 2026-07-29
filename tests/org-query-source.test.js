// Executable contract for the organizational query-source registry.
//
// Every source in the registry is exercised against a real file here: the four
// conversation dialects come from the example generator the conversation
// contract's own tests parse, the gateway log from the query-sample template,
// and the JSON envelope from the bundled synthetic fixture. Nothing in this
// file is a vendor export, a customer record, or a real prompt — the fixture
// carries rubric categories and pseudonymous unit keys and no prose at all.
//
// The two properties that make this a contract rather than a page of prose:
//   1. The registry is *derived from* the modules it binds to, so a renamed
//      dialect or a bumped contract version fails here rather than silently
//      orphaning an entry a reader can select.
//   2. The privacy boundary is asserted as behaviour, not as a promise: the
//      suite fails every network primitive during validation, and reads the
//      module's own source for a credential, a fetch, or a storage call.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHtml, textOf } from "./support/browser.js";
import {
  ORG_QUERY_SOURCES,
  ORG_QUERY_SOURCE_CODES,
  ORG_QUERY_SOURCE_CONTRACT_ID,
  ORG_QUERY_SOURCE_GUARANTEES,
  ORG_QUERY_SOURCE_INTAKE_SENTENCE,
  ORG_QUERY_SOURCE_KIND,
  ORG_QUERY_SOURCE_VERSION,
  UNSUPPORTED_ORG_QUERY_SOURCES,
  contractDocument,
  organizationalSampleSummary,
  orgQuerySourceById,
  orgQuerySourceCompatibility,
  orgQuerySourceGuidance,
  validateOrgQuerySource,
} from "../src/org-query-source.js";
import { CONVERSATION_CONTRACT_VERSION } from "../src/conversation-export.js";
import { CONVERSATION_DIALECT_PROFILES } from "../src/dialect-profiles.js";
import {
  QUERY_SAMPLE_CONTRACT_KIND, QUERY_SAMPLE_SCHEMA_VERSION, classifyQuerySample,
} from "../src/query-sample-contract.js";
import { conversationExampleText } from "../src/conversation-export-example.js";
import { exampleQuerySampleText } from "../src/query-sample-example.js";
import { scorePromptLiteracy } from "../src/prompt-literacy-scoring.js";
import {
  PROMPT_GRADING_STATE, promptGradingEligibility, promptGradingSignals,
} from "../src/prompt-grading-eligibility.js";
import { applyExportPackageGuidance, applyOrgQuerySources, applyOrgQuerySourceStatus }
  from "../src/local-import-flow.js";

const MANIFEST = new URL("../contracts/integrations/org-query-source/v1/manifest.json",
  import.meta.url);
const FIXTURE = new URL("../contracts/integrations/org-query-source/v1/fixtures/organizational-sample.json",
  import.meta.url);
const MODULE = new URL("../src/org-query-source.js", import.meta.url);
const PAGE = new URL("../src/evolution.html", import.meta.url);

const fixtureText = () => readFile(FIXTURE, "utf8");
const batch = (text, options = {}) => validateOrgQuerySource(text, {
  sourceId: "representative-prompt-batch", fileName: "sample.json", ...options,
});

/** The bundled fixture as an object, for tests that mutate one delivery state. */
async function fixtureDocument() {
  return JSON.parse(await fixtureText());
}

// --- the document ----------------------------------------------------------

test("the registry declares its own kind, version, and guarantees", () => {
  const document = contractDocument();
  assert.equal(document.kind, ORG_QUERY_SOURCE_KIND);
  assert.equal(document.manifest_version, ORG_QUERY_SOURCE_VERSION);
  assert.equal(ORG_QUERY_SOURCE_CONTRACT_ID, `${ORG_QUERY_SOURCE_KIND}/${ORG_QUERY_SOURCE_VERSION}`);
  assert.equal(document.fixture_data, "synthetic-only");

  // The four promises the issue asks for, as machine-readable false rather than
  // as a sentence somebody has to read and believe.
  assert.equal(document.guarantees.credentials, false);
  assert.equal(document.guarantees.network_calls, false);
  assert.equal(document.guarantees.customer_data_transfer, false);
  assert.equal(document.guarantees.prompt_content_persisted, false);
  assert.equal(document.guarantees.prompt_content_rendered, false);
  assert.deepEqual(document.guarantees, JSON.parse(JSON.stringify(ORG_QUERY_SOURCE_GUARANTEES)));

  // The shared declarations every source inherits.
  assert.equal(document.attribution.required, true);
  assert.equal(document.time_bucket.granularity, "day");
  assert.equal(document.time_bucket.format, "YYYY-MM-DD");
  assert.ok(document.sampling.max_rows > 0 && document.sampling.max_bytes > 0);
  assert.ok(document.sampling.max_prompt_excerpt_chars > 0);
  for (const state of ["partial", "stale", "malformed", "reordered"]) {
    const entry = document.delivery_behaviour[state];
    assert.ok(entry.situation && entry.behaviour && entry.never, `${state} is under-declared`);
  }
});

test("the published manifest is the shipped document, byte for byte", async () => {
  const raw = await readFile(MANIFEST, "utf8");
  assert.deepEqual(JSON.parse(raw), contractDocument());
  // Stable serialization, so a regenerated manifest is a no-op diff rather than
  // a reformat that hides a real change inside it.
  assert.equal(raw, `${JSON.stringify(contractDocument(), null, 2)}\n`);
});

test("every source states attribution, a bucket, a bound, provenance, and its contract", () => {
  assert.ok(ORG_QUERY_SOURCES.length >= 3);
  const ids = ORG_QUERY_SOURCES.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "source ids are not unique");
  const kinds = new Set(ORG_QUERY_SOURCES.map((entry) => entry.source_kind));
  // The three shapes the registry exists to cover.
  assert.deepEqual([...kinds].sort(), ["conversation-archive", "gateway-log", "prompt-batch"]);

  for (const entry of ORG_QUERY_SOURCES) {
    assert.ok(entry.label && entry.summary, `${entry.id} has no label or summary`);
    assert.equal(entry.attribution.required, true, `${entry.id} makes attribution optional`);
    assert.ok(entry.attribution.field, `${entry.id} names no attribution field`);
    assert.equal(entry.time_bucket.granularity, "day");
    assert.ok(entry.accepted_extensions.length, `${entry.id} accepts no format`);
    assert.ok(entry.provenance.label && entry.provenance.detail);
    assert.ok(entry.reads.contract && entry.reads.version && entry.reads.module);
    assert.ok(entry.dialect_ids.length, `${entry.id} declares no shape`);
    assert.ok(["prompt_literacy", "attribution_and_volume"].includes(entry.grades));
    // Five guidance rows, in a fixed order, for every source.
    assert.deepEqual(orgQuerySourceGuidance(entry).map((row) => row.term),
      ["What it is", "Attributed by", "Bucketed by", "Accepted here", "What it answers"]);
  }
  assert.equal(orgQuerySourceGuidance(null).length, 0);
});

test("the registry is bound to the live contracts it reads, not to a copy", () => {
  const archive = orgQuerySourceById("local-conversation-archive");
  assert.deepEqual([...archive.dialect_ids],
    CONVERSATION_DIALECT_PROFILES.map((profile) => profile.id));
  assert.equal(archive.reads.version, CONVERSATION_CONTRACT_VERSION);

  for (const id of ["gateway-proxy-log", "representative-prompt-batch"]) {
    const entry = orgQuerySourceById(id);
    assert.equal(entry.reads.contract, QUERY_SAMPLE_CONTRACT_KIND);
    assert.equal(entry.reads.version, QUERY_SAMPLE_SCHEMA_VERSION);
  }
  assert.deepEqual([...orgQuerySourceById("gateway-proxy-log").dialect_ids], ["delimited-gateway-log"]);
  assert.deepEqual([...orgQuerySourceById("representative-prompt-batch").dialect_ids], ["json-envelope"]);
});

// --- every supported shape -------------------------------------------------

test("every declared conversation dialect validates as a conversation archive", () => {
  for (const profile of CONVERSATION_DIALECT_PROFILES) {
    const result = validateOrgQuerySource(conversationExampleText(profile.id),
      { sourceId: "local-conversation-archive", fileName: "archive.csv" });
    assert.ok(result.ok, `${profile.id} did not validate: ${result.message}`);
    assert.equal(result.dialect, profile.id);
    assert.equal(result.keySpace, "source_label");
    assert.ok(result.summary.recordCount > 0);
    assert.ok(result.summary.orgUnitCount > 0, "no organization unit was attributed");
    // Day buckets, derived from the timestamp rather than carried.
    for (const record of result.records) assert.match(record.queryDate, /^\d{4}-\d{2}-\d{2}$/);
    // An archive carries no tokens and no category, so it counts and places
    // queries; it does not claim to grade them.
    assert.equal(result.grades, "attribution_and_volume");
    assert.equal(result.summary.gradesLiteracy, false);
    assert.equal(result.summary.gradeable, false);
  }
});

test("a gateway log validates in its own dialect and carries the rubric's fields", () => {
  const result = validateOrgQuerySource(exampleQuerySampleText(),
    { sourceId: "gateway-proxy-log", fileName: "gateway.csv" });
  assert.ok(result.ok, result.message);
  assert.equal(result.dialect, "delimited-gateway-log");
  assert.equal(result.grades, "prompt_literacy");
  assert.equal(result.summary.orgUnitCount, result.summary.orgUnits.length);
  for (const record of result.records) {
    assert.ok(record.orgUnitId, "a record was kept with no organization unit");
    assert.ok(Number.isInteger(record.inputTokens) && Number.isInteger(record.outputTokens));
  }
});

test("a prompt batch validates as the JSON envelope, and only as that", async () => {
  const result = batch(await fixtureText());
  assert.ok(result.ok, result.message);
  assert.equal(result.dialect, "json-envelope");
  assert.equal(result.snapshot.sequence, 12);
  assert.equal(result.snapshot.completeness, "complete");
  assert.equal(result.registryContract, ORG_QUERY_SOURCE_CONTRACT_ID);

  // The same file offered as the wrong source is a mis-selection, and the
  // registry says which source to pick rather than blaming the file.
  const wrong = validateOrgQuerySource(await fixtureText(),
    { sourceId: "gateway-proxy-log", fileName: "sample.json" });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, ORG_QUERY_SOURCE_CODES.UNSUPPORTED_FORMAT);
  assert.match(wrong.recovery, /accepted formats|source that reads/i);
});

// --- the bundled fixture ---------------------------------------------------

test("the bundled fixture is synthetic: no prompts, no identifiers, no free text", async () => {
  const raw = await fixtureText();
  const document = await fixtureDocument();
  assert.equal(document.kind, QUERY_SAMPLE_CONTRACT_KIND);
  assert.equal(document.privacy.prompt_text_retained, false);
  assert.equal(document.privacy.direct_identifiers_included, false);

  const allowed = ["org_unit_id", "query_date", "model_raw", "input_tokens", "output_tokens", "category"];
  for (const record of document.records) {
    assert.deepEqual(Object.keys(record).sort(), [...allowed].sort());
    assert.match(record.org_unit_id, /^psn_[A-Za-z0-9_-]{16,64}$/);
    assert.match(record.query_date, /^\d{4}-\d{2}-\d{2}$/);
  }
  // No excerpt column at all, so there is no prompt text in the shipped bytes
  // to leak — and nothing that looks like a person.
  assert.ok(!raw.includes("prompt_excerpt"));
  assert.ok(!raw.includes("@"), "the fixture carries something shaped like an address");
  assert.ok(!/\b(user|email|actor|employee)_/.test(raw));
});

test("the bundled fixture drives a gradeable organizational sample", async () => {
  const result = batch(await fixtureText());
  assert.ok(result.ok, result.message);
  assert.equal(result.summary.gradeable, true);
  assert.equal(result.summary.orgUnitCount, 2);
  assert.equal(result.summary.classifiedShare, 1);
  assert.deepEqual(result.summary.shortfalls, []);
  // Two units, each clearing the per-unit floor, over a window that clears the
  // fortnight floor. Both are read from the grading thresholds, not restated.
  const floor = contractDocument().sampling.gradeable_floor;
  for (const unit of result.summary.orgUnits) {
    assert.ok(unit.records >= floor.prompts_per_org_unit, `${unit.id} is below the floor`);
  }
  assert.ok(result.summary.windowDays >= floor.history_window_days);

  // It grades: through the redaction boundary, into the rubric, out as a score.
  const classified = classifyQuerySample(result.parsed);
  assert.equal(classified.unclassified.length, 0);
  for (const record of classified.records) {
    assert.deepEqual(Object.keys(record).sort(),
      ["category", "inputTokens", "model", "orgUnitId", "outputTokens", "queryDate"]);
  }
  const scored = scorePromptLiteracy(classified.records);
  assert.equal(scored.scored, true, "the sample produced no score");
  assert.ok(Number.isFinite(scored.composite));
  assert.ok(scored.composite >= 0 && scored.composite <= 100);
  assert.equal(scored.records.scored, result.summary.recordCount);
  assert.ok(scored.grade, "the graded sample carries no grade");

  // And it clears the eligibility gate the surfaces switch on, so the fixture
  // exercises the graded path rather than the "not enough evidence" one.
  const eligibility = promptGradingEligibility(
    promptGradingSignals([{ parsed: result.parsed, classified }]));
  assert.equal(eligibility.state, PROMPT_GRADING_STATE.ownGrade);
});

test("a sample below the floors is reported as short, dimension by dimension", () => {
  const summary = organizationalSampleSummary([
    { orgUnitId: "psn_unit_synthetic_atlas_0001", queryDate: "2026-07-01", category: "highValue" },
    { orgUnitId: "psn_unit_synthetic_atlas_0001", queryDate: "2026-07-02", category: null, promptExcerpt: null },
  ], orgQuerySourceById("representative-prompt-batch"));
  assert.equal(summary.gradeable, false);
  const dimensions = summary.shortfalls.map((entry) => entry.dimension).sort();
  assert.deepEqual(dimensions, ["classified_share", "history_window_days", "prompts_per_org_unit"]);
  for (const shortfall of summary.shortfalls) {
    assert.ok(shortfall.observed < shortfall.target, `${shortfall.dimension} is not short`);
    assert.ok(shortfall.detail.length > 0);
  }
});

// --- unsupported and incomplete sources ------------------------------------

test("a source this contract does not accept is refused with the local alternative", () => {
  assert.ok(UNSUPPORTED_ORG_QUERY_SOURCES.length >= 4);
  for (const declined of UNSUPPORTED_ORG_QUERY_SOURCES) {
    const status = orgQuerySourceCompatibility({ sourceId: declined.id });
    assert.equal(status.status, "unsupported");
    assert.equal(status.code, ORG_QUERY_SOURCE_CODES.UNSUPPORTED_SOURCE);
    assert.ok(status.message.includes(declined.label));
    assert.equal(status.recovery, declined.do_instead);
    // The refusal is the same statement whether it arrives through the panel
    // or through a validation call with a file already in hand.
    const validated = validateOrgQuerySource("anything", { sourceId: declined.id });
    assert.equal(validated.ok, false);
    assert.equal(validated.code, ORG_QUERY_SOURCE_CODES.UNSUPPORTED_SOURCE);
  }
  // Every declined source is declined for a reason a reader can act on.
  for (const declined of UNSUPPORTED_ORG_QUERY_SOURCES) {
    assert.ok(declined.why.length > 20 && declined.do_instead.length > 20);
  }
});

test("an unknown source, an unselected source, and a wrong format each say what to do", () => {
  const unknown = validateOrgQuerySource("x", { sourceId: "not-a-source" });
  assert.equal(unknown.code, ORG_QUERY_SOURCE_CODES.UNKNOWN_SOURCE);
  assert.match(unknown.recovery, /local-conversation-archive/);

  const unselected = orgQuerySourceCompatibility({});
  assert.equal(unselected.code, ORG_QUERY_SOURCE_CODES.NO_SOURCE_SELECTED);

  const wrongFormat = orgQuerySourceCompatibility({
    sourceId: "representative-prompt-batch", fileName: "gateway.csv",
  });
  assert.equal(wrongFormat.code, ORG_QUERY_SOURCE_CODES.UNSUPPORTED_FORMAT);
  assert.match(wrongFormat.message, /\.json/);
  // A media type a browser guessed is advisory and never the reason for a
  // refusal: a .tsv typed as text/plain still reads.
  assert.equal(orgQuerySourceCompatibility({
    sourceId: "gateway-proxy-log", fileName: "gateway.tsv", mediaType: "text/plain",
  }).status, "supported");
});

test("a gateway log offered as a prompt batch names the source to pick instead", () => {
  const result = validateOrgQuerySource(exampleQuerySampleText(),
    { sourceId: "representative-prompt-batch" });
  assert.equal(result.code, ORG_QUERY_SOURCE_CODES.DIALECT_MISMATCH);
  assert.match(result.recovery, /Gateway or proxy log export/);
});

test("an archive with no organization-unit column is incomplete, not merely empty", () => {
  const text = [
    "conversation_id,timestamp,prompt",
    "conv-1,2026-07-01T09:00:00Z,alpha",
    "conv-2,2026-07-02T09:00:00Z,beta",
  ].join("\n");
  const result = validateOrgQuerySource(text,
    { sourceId: "local-conversation-archive", fileName: "archive.csv" });
  assert.equal(result.ok, false);
  assert.ok([ORG_QUERY_SOURCE_CODES.MISSING_ATTRIBUTION,
    ORG_QUERY_SOURCE_CODES.UNRECOGNIZED_SOURCE_SHAPE].includes(result.code), result.code);
  assert.ok(result.recovery.length > 0);
  // No cell value reaches the message, even on the path where the row that
  // failed is the row carrying a prompt.
  assert.ok(!result.message.includes("alpha") && !result.message.includes("beta"));
});

// --- partial, stale, malformed, reordered ----------------------------------

test("a partial delivery is accepted, counted, and never presented as complete", async () => {
  const document = await fixtureDocument();
  document.snapshot.completeness = "partial";
  document.snapshot.omitted_record_count = 4;
  document.snapshot.issues = ["one gateway node was unreachable during export"];
  // One row that cannot validate, so the partial path and the row-skip path are
  // exercised by the same delivery.
  document.records[0] = { ...document.records[0], query_date: "2026-13-45" };
  const result = batch(JSON.stringify(document));
  assert.ok(result.ok, result.message);
  assert.equal(result.snapshot.completeness, "partial");
  assert.equal(result.snapshot.omittedRecordCount, 4);
  assert.equal(result.skippedRowCount, 1);
  assert.equal(result.summary.recordCount, document.records.length - 1);
  assert.ok(result.issues.some((issue) => issue.code === "invalid_time_bucket"));
});

test("a stale delivery is refused whole; sequence decides, never arrival", async () => {
  const text = await fixtureText();
  const stale = batch(text, { lastAcceptedSequence: 12 });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "stale_delivery");
  assert.ok(stale.recovery.length > 0);
  // The same bytes are accepted when nothing newer has been seen.
  assert.equal(batch(text, { lastAcceptedSequence: 11 }).ok, true);
});

test("a malformed delivery is refused before a row is read", async () => {
  const document = await fixtureDocument();
  document.kind = "wawalu.integration.something-else";
  const wrongKind = batch(JSON.stringify(document));
  assert.equal(wrongKind.ok, false);
  assert.equal(wrongKind.code, "unsupported_contract");
  assert.equal(wrongKind.records, undefined, "a refused file yielded records");

  const truncated = batch("{\"schema_version\": \"1.0\", \"kind\":");
  assert.equal(truncated.ok, false);

  // The delimited path refuses broken quoting the same way, whole-file.
  const brokenQuoting = validateOrgQuerySource(
    "org_unit_id,query_date,model_raw,input_tokens,output_tokens,category\n\"unterminated,2026-07-01,m,1,1,highValue",
    { sourceId: "gateway-proxy-log", fileName: "gateway.csv" });
  assert.equal(brokenQuoting.ok, false);
});

test("reordered rows and reordered columns both survive without moving a total", async () => {
  const ordered = batch(await fixtureText());
  const document = await fixtureDocument();
  document.records = [...document.records].reverse();
  const reordered = batch(JSON.stringify(document));
  assert.ok(reordered.ok, reordered.message);
  assert.ok(reordered.outOfOrderRowCount > 0, "a reversed delivery reported no out-of-order row");
  // Reported, never dropped: the same records, the same units, the same window.
  assert.equal(reordered.summary.recordCount, ordered.summary.recordCount);
  assert.equal(reordered.summary.windowDays, ordered.summary.windowDays);
  assert.deepEqual(
    [...reordered.summary.orgUnits].map((unit) => unit.records).sort(),
    [...ordered.summary.orgUnits].map((unit) => unit.records).sort());
  assert.equal(reordered.summary.gradeable, true);

  // The delimited path maps by column name, so a permuted header reads alike.
  const rows = [
    "org_unit_id,query_date,model_raw,input_tokens,output_tokens,category",
    "psn_unit_synthetic_atlas_0001,2026-07-01,acme-sonnet-1,400,120,highValue",
  ];
  const permuted = [
    "category,output_tokens,input_tokens,model_raw,query_date,org_unit_id",
    "highValue,120,400,acme-sonnet-1,2026-07-01,psn_unit_synthetic_atlas_0001",
  ];
  const asWritten = validateOrgQuerySource(rows.join("\n"),
    { sourceId: "gateway-proxy-log", fileName: "g.csv" });
  const asPermuted = validateOrgQuerySource(permuted.join("\n"),
    { sourceId: "gateway-proxy-log", fileName: "g.csv" });
  assert.ok(asWritten.ok && asPermuted.ok);
  assert.deepEqual(asPermuted.records.map((r) => ({ ...r })), asWritten.records.map((r) => ({ ...r })));
});

// --- the no-network, no-credential boundary --------------------------------

test("validating every source touches no network primitive", async () => {
  const calls = [];
  const trap = (name) => (...args) => {
    calls.push({ name, args: args.length });
    throw new Error(`${name} was called by a local source validation`);
  };
  const saved = {
    fetch: globalThis.fetch,
    XMLHttpRequest: globalThis.XMLHttpRequest,
    WebSocket: globalThis.WebSocket,
  };
  globalThis.fetch = trap("fetch");
  globalThis.XMLHttpRequest = trap("XMLHttpRequest");
  globalThis.WebSocket = trap("WebSocket");
  try {
    const text = await fixtureText();
    assert.equal(batch(text).ok, true);
    assert.equal(validateOrgQuerySource(exampleQuerySampleText(),
      { sourceId: "gateway-proxy-log", fileName: "g.csv" }).ok, true);
    for (const profile of CONVERSATION_DIALECT_PROFILES) {
      assert.equal(validateOrgQuerySource(conversationExampleText(profile.id),
        { sourceId: "local-conversation-archive", fileName: "a.csv" }).ok, true);
    }
    // Refusal paths too: an error must not be the thing that phones home.
    validateOrgQuerySource("nonsense", { sourceId: "gateway-proxy-log", fileName: "g.csv" });
    validateOrgQuerySource("x", { sourceId: "live-gateway-api" });
    assert.deepEqual(calls, []);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test("the registry module holds no credential, endpoint, or storage call", async () => {
  const source = await readFile(MODULE, "utf8");
  const code = source.split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");
  for (const forbidden of [
    /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /localStorage/, /sessionStorage/,
    /indexedDB/, /https?:\/\//, /api[_-]?key/i, /authorization/i, /Bearer /,
  ]) {
    assert.ok(!forbidden.test(code), `org-query-source.js contains ${forbidden}`);
  }
  // The registry imports only contract modules, never a transport.
  const imports = [...source.matchAll(/from "\.\/([\w.-]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(imports)].sort(), [
    "conversation-export.js", "delimited-text.js", "dialect-profiles.js",
    "prompt-grading-eligibility.js", "query-sample-contract.js",
  ]);
  // The promise a reader is shown is the promise the code keeps.
  assert.match(ORG_QUERY_SOURCE_INTAKE_SENTENCE, /no credential is used/i);
  assert.match(ORG_QUERY_SOURCE_INTAKE_SENTENCE, /nothing is uploaded/i);
  assert.match(ORG_QUERY_SOURCE_INTAKE_SENTENCE, /no prompt text is stored/i);
});

// --- the panel -------------------------------------------------------------

test("the import panel paints the registry and reports compatibility", async () => {
  const html = await readFile(PAGE, "utf8");
  const doc = parseHtml(html);

  const painted = applyOrgQuerySources(doc);
  assert.equal(painted, ORG_QUERY_SOURCES.length);

  const chooser = doc.getElementById("org-query-source-select");
  assert.deepEqual(chooser.options.map((option) => option.value),
    ORG_QUERY_SOURCES.map((entry) => entry.id));
  assert.deepEqual(chooser.options.map((option) => textOf(option)),
    ORG_QUERY_SOURCES.map((entry) => entry.label));

  assert.equal(textOf(doc.getElementById("org-query-source-promise")),
    ORG_QUERY_SOURCE_INTAKE_SENTENCE);
  assert.equal(doc.getElementById("org-query-source-declined").children.length,
    UNSUPPORTED_ORG_QUERY_SOURCES.length);

  // The first source is selected on a cold load and reports as supported, in
  // words rather than by tint alone.
  const status = doc.getElementById("org-query-source-status");
  assert.equal(status.dataset.status, "supported");
  assert.match(textOf(status), /^Supported: /);

  const terms = doc.getElementById("org-query-source-guidance").children
    .filter((node) => node.tagName === "DT").map((node) => textOf(node));
  assert.deepEqual(terms, ["What it is", "Attributed by", "Bucketed by", "Accepted here", "What it answers"]);

  // Selecting another source repaints both the verdict and the guidance.
  applyOrgQuerySourceStatus(doc, "local-conversation-archive");
  assert.match(textOf(doc.getElementById("org-query-source-guidance")), /department/);
  applyOrgQuerySourceStatus(doc, "live-gateway-api");
  assert.equal(status.dataset.status, "unsupported");
  assert.match(textOf(status), /^Not read here: /);
  assert.equal(doc.getElementById("org-query-source-guidance").children.length, 0);

  // The markup is slots: no source label, format list, or refusal sentence is
  // authored into the page, so adding a source cannot leave stale copy.
  for (const entry of [...ORG_QUERY_SOURCES, ...UNSUPPORTED_ORG_QUERY_SOURCES]) {
    assert.ok(!html.includes(entry.label), `evolution.html hardcodes ${entry.label}`);
  }
  assert.match(html, /href="\/docs\/org-query-source-contract\.md"/);
});

test("the provider-export intake still paints beside it", async () => {
  const doc = parseHtml(await readFile(PAGE, "utf8"));
  // The registry is an addition to the same panel, not a replacement: the
  // package guidance still finds its slots and still fills them.
  assert.ok(applyExportPackageGuidance(doc) > 0);
  assert.ok(doc.getElementById("export-package-guidance").children.length > 0);
  assert.ok(textOf(doc.getElementById("export-package-promise")).length > 0);
  // And the file picker the provider export arrives through is untouched.
  assert.ok(doc.getElementById("local-finops-files"));
  assert.equal(applyOrgQuerySources(doc), ORG_QUERY_SOURCES.length);
  assert.ok(doc.getElementById("export-package-guidance").children.length > 0);
});
