// Executable contract for AI-assistant conversation and audit exports.
//
// The suite is table-driven over the conversation registry, so a dialect added
// without an example fixture, without a changelog note, or with a mapping that
// does not reproduce its fixture fails here rather than on a reader's file.
//
// The centre of it is the never-render rule. Every prompt-bearing table this
// file builds carries sentinel prose no other string in the repository contains,
// and the assertions are that the sentinel is absent from the parse result, the
// JSON export, the CSV export, the summary lines, every skipped-row message, the
// rendered page, and browser storage — including on the negative path, where the
// row that fails validation is the row that carries the sentinel.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ALL_DIALECT_PROFILES, CONVERSATION_DIALECT_PROFILES, COERCIONS, DIALECT_PROFILES,
  NEVER_RENDER, UNGROUPED_DEPARTMENT, assertProfileRegistry, neverRenderColumns, profileById,
} from "../src/dialect-profiles.js";
import { detectDialect } from "../src/dialect-detection.js";
import {
  CONVERSATION_CONTRACT_VERSION, CONVERSATION_RECORD_KEYS, CONVERSATION_ROW_CODES,
  assertNeverRenderClean, conversationExportCsv, conversationExportJson,
  conversationSummaryLines, parseConversationExport,
} from "../src/conversation-export.js";
import {
  CONVERSATION_EXAMPLE_FILES, conversationExampleTable, conversationExampleText,
} from "../src/conversation-export-example.js";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { readTable, reorderColumns, withoutColumns } from "./support/tabular.js";

const FIXTURES = new URL("../contracts/integrations/conversation-export/v1/fixtures/", import.meta.url);
const BILLING_FIXTURES = new URL("../contracts/integrations/tabular-dialects/v1/fixtures/", import.meta.url);
const CONTRACT_DOC = new URL("../docs/conversation-export-import-contract.md", import.meta.url);

const fixtureText = (dialectId) => readFile(new URL(`${dialectId}.csv`, FIXTURES), "utf8");
const fixtureTable = async (dialectId) => readTable(await fixtureText(dialectId));

const DIALECT_IDS = CONVERSATION_DIALECT_PROFILES.map((profile) => profile.id);

/** The four records every example fixture must produce, whatever the vendor. */
const EXPECTED_RECORDS = [
  { conversation_id: "conv-4821", actor_id: "rowan.ash@example.invalid", department: "Atlas Platform", occurred_at: "2026-06-15T09:12:04Z", prompt_chars: 73, prompt_token_estimate: 19, prompt_empty: false },
  { conversation_id: "conv-4822", actor_id: "juno.vale@example.invalid", department: "Boreal Support", occurred_at: "2026-06-15T11:40:19Z", prompt_chars: 73, prompt_token_estimate: 19, prompt_empty: false },
  { conversation_id: "conv-4823", actor_id: "rowan.ash@example.invalid", department: "Atlas Platform", occurred_at: "2026-06-16T08:55:41Z", prompt_chars: 64, prompt_token_estimate: 16, prompt_empty: false },
  { conversation_id: "conv-4824", actor_id: "wren.holt@example.invalid", department: "Cinder Research", occurred_at: "2026-06-16T15:02:58Z", prompt_chars: 68, prompt_token_estimate: 17, prompt_empty: false },
];

// --- sentinel tables --------------------------------------------------------

/**
 * A ChatGPT-shaped table whose prompt cells are strings that exist nowhere else.
 * `rows` is a list of `[id, actor, department, timestamp, prompt]`.
 */
const SENTINEL = Object.freeze({
  one: "zzq-sentinel-prompt-alpha-do-not-render",
  two: "zzq-sentinel-prompt-beta-do-not-render",
  three: "zzq-sentinel-prompt-gamma-do-not-render",
});

const sentinelTable = (rows, { columns = null } = {}) => ({
  columns: columns ?? ["conversation_id", "user_email", "department", "created_at", "role", "model", "message_text"],
  rows: rows.map(([id, actor, department, at, prompt]) =>
    (columns
      ? [id, actor, at, "user", "assistant-large", prompt]
      : [id, actor, department, at, "user", "assistant-large", prompt])),
});

/** The same shape with no department column at all. */
const DEPARTMENTLESS_COLUMNS = ["conversation_id", "user_email", "created_at", "role", "model", "message_text"];

const SENTINEL_ROWS = [
  ["c-1", "one@example.invalid", "Atlas Platform", "2026-06-15T09:00:00Z", SENTINEL.one],
  ["c-2", "two@example.invalid", "Boreal Support", "2026-06-15T10:00:00Z", SENTINEL.two],
  ["c-3", "three@example.invalid", "Atlas Platform", "2026-06-15T11:00:00Z", SENTINEL.three],
];

const everySentinel = Object.values(SENTINEL);

/** Everything a surface could show, gathered into one string for the assertion. */
function exposedSurface(result) {
  return [
    JSON.stringify(result),
    conversationExportJson(result),
    conversationExportCsv(result),
    conversationSummaryLines(result).join(" "),
    result.skipped.map((entry) => entry.message).join(" "),
  ].join("\n");
}

// --- the registry -----------------------------------------------------------

test("the conversation profiles are a consistent registry beside the billing ones", () => {
  assert.doesNotThrow(() => assertProfileRegistry(ALL_DIALECT_PROFILES));
  assert.equal(CONVERSATION_DIALECT_PROFILES.length, 4);
  assert.deepEqual(ALL_DIALECT_PROFILES.length, DIALECT_PROFILES.length + 4);
  for (const profile of CONVERSATION_DIALECT_PROFILES) {
    assert.equal(profile.kind, "conversation");
    assert.equal(profile.groupingUnit, null, "a conversation export is not billed and groups no spend");
    assert.ok(Number.isInteger(profile.version) && profile.version >= 1);
    assert.equal(profile.changelog.length, profile.version);
    assert.equal(profileById(profile.id), profile);
    // The flag, by name, on exactly one column, mapped through a coercion that
    // cannot hand the text back.
    const sensitive = neverRenderColumns(profile);
    assert.equal(sensitive.length, 1, `${profile.id} must mark exactly one prompt column`);
    assert.equal(sensitive[0].sensitivity, NEVER_RENDER);
    assert.equal(sensitive[0].coerce, "promptSignals");
    assert.equal(sensitive[0].field, "prompt_signals");
    // Every profile declares the four required contract fields; department and
    // model are optional and degrade in opposite, declared directions.
    const fields = profile.columns.filter((entry) => entry.field).map((entry) => entry.field);
    assert.deepEqual([...fields].sort().filter((field) => field !== "model"),
      ["actor_id", "conversation_id", "department", "occurred_at", "prompt_signals"]);
    const department = profile.columns.find((entry) => entry.field === "department");
    assert.equal(department.required, false);
    assert.deepEqual(department.whenAbsent, { mode: "default", value: UNGROUPED_DEPARTMENT });
    const model = profile.columns.find((entry) => entry.field === "model");
    if (model) {
      assert.equal(model.required, false);
      // Omitted, never defaulted: there is no honest stand-in for a model name.
      assert.deepEqual(model.whenAbsent, { mode: "omit" });
      assert.equal(model.sensitivity, null, "a model identifier is the rubric's one carryable string");
    }
  }
});

test("the never-render pairing is refused in both directions", () => {
  const base = profileById("chatgpt-enterprise-conversation-export");
  const rewrite = (change) => [{
    ...base,
    columns: base.columns.map((entry) =>
      (entry.sensitivity === NEVER_RENDER ? { ...entry, ...change } : entry)),
  }];
  // A sensitive column mapped through a coercion that returns its text.
  assert.throws(() => assertProfileRegistry(rewrite({ coerce: "string" })), /deriving coercion/);
  // A deriving coercion used without the flag that justifies it.
  assert.throws(() => assertProfileRegistry(rewrite({ sensitivity: null })), /without the never-render flag/);
  // An unknown sensitivity is a typo, and a typo must not read as "not sensitive".
  assert.throws(() => assertProfileRegistry(rewrite({ sensitivity: "redacted" })), /unknown sensitivity/);
});

test("the prompt coercion returns counts and never the text", () => {
  const signals = COERCIONS.promptSignals(SENTINEL.one);
  assert.deepEqual({ ...signals },
    { chars: SENTINEL.one.length, token_estimate: Math.ceil(SENTINEL.one.length / 4), empty: false });
  assert.deepEqual({ ...COERCIONS.promptSignals("   ") }, { chars: 0, token_estimate: 0, empty: true });
  assert.ok(!JSON.stringify(signals).includes(SENTINEL.one));
});

// --- fixtures and examples --------------------------------------------------

test("every conversation dialect ships an example, and the bytes match the generator", async () => {
  assert.deepEqual(CONVERSATION_EXAMPLE_FILES.map((entry) => entry.dialectId), DIALECT_IDS);
  for (const entry of CONVERSATION_EXAMPLE_FILES) {
    assert.equal(await fixtureText(entry.dialectId), conversationExampleText(entry.dialectId),
      `ANTI-DRIFT: the committed fixture for ${entry.dialectId} is not what the generator produces.`);
    // The bytes and the table the parser is tested against are one source.
    const table = conversationExampleTable(entry.dialectId);
    const parsed = readTable(conversationExampleText(entry.dialectId));
    assert.deepEqual(parsed.columns, table.columns);
    assert.deepEqual(parsed.rows, table.rows);
    assert.equal(entry.fileName, `example-${entry.dialectId}.csv`);
    assert.equal(entry.mediaType, "text/csv");
  }
});

test("no conversation fixture carries real customer data, credentials, or identifiers", async () => {
  const forbidden = [
    ["a non-reserved email domain", /@(?!(?:[a-z0-9-]+\.)*(?:invalid|example|test|localhost)\b)[a-z0-9.-]+\.[a-z]{2,}/i],
    ["a long numeric identifier", /\b\d{12,}\b/],
    ["a UUID", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
    ["an API key or token prefix", /\b(?:sk-|AKIA|ASIA|ghp_|xox[bap]-|Bearer\s|AIza)/],
  ];
  for (const dialectId of DIALECT_IDS) {
    const text = await fixtureText(dialectId);
    for (const [what, pattern] of forbidden) {
      assert.equal(pattern.exec(text), null, `fixture ${dialectId}.csv contains ${what}`);
    }
  }
});

for (const profile of CONVERSATION_DIALECT_PROFILES) {
  test(`${profile.id} v${profile.version}: detects itself and reads its own example`, async () => {
    const result = parseConversationExport(await fixtureTable(profile.id));
    assert.equal(result.status, "matched");
    assert.equal(result.profileId, profile.id);
    assert.equal(result.profileLabel, profile.label);
    assert.equal(result.profileVersion, profile.version);
    assert.equal(result.contractVersion, CONVERSATION_CONTRACT_VERSION);
    assert.equal(result.confidence, 1);
    assert.deepEqual(result.records.map((record) => ({ ...record })), EXPECTED_RECORDS);
    assert.deepEqual(result.skipped, []);
    assert.equal(result.grouped, true);
    assert.deepEqual(result.span, { first: "2026-06-15T09:12:04Z", last: "2026-06-16T15:02:58Z" });
    assert.ok(assertNeverRenderClean(result, profile));
  });

  test(`${profile.id} v${profile.version}: reordered columns still map by name`, async () => {
    const table = await fixtureTable(profile.id);
    const reversed = reorderColumns(table, table.columns.map((_, index) => table.columns.length - 1 - index));
    const result = parseConversationExport(reversed);
    assert.equal(result.profileId, profile.id, "column order must not affect detection");
    assert.deepEqual(result.records.map((record) => ({ ...record })), EXPECTED_RECORDS);
  });

  test(`${profile.id} v${profile.version}: a missing required column falls back to manual mapping`, async () => {
    const table = await fixtureTable(profile.id);
    const promptHeader = table.columns.find((name) =>
      neverRenderColumns(profile)[0].source === name);
    const partial = withoutColumns(table, [promptHeader]);
    const result = parseConversationExport(partial);
    assert.equal(result.status, "unrecognized");
    assert.equal(result.profileId, null);
    assert.deepEqual(result.records, []);
    // The fallback is the existing manual-mapping path: everything parsed is
    // still here, unchanged, and nothing errored.
    assert.deepEqual(result.detection.columns, partial.columns);
    assert.equal(result.detection.rows.length, partial.rows.length);
    assert.match(conversationSummaryLines(result)[0], /not recognized/);
  });
}

// --- detection lives beside the billing dialects, not on top of them --------

test("adding conversation dialects changes nothing about usage and roster detection", async () => {
  for (const profile of DIALECT_PROFILES) {
    const table = readTable(await readFile(new URL(`${profile.id}.csv`, BILLING_FIXTURES), "utf8"));
    const before = detectDialect(table);
    const after = detectDialect(table, ALL_DIALECT_PROFILES);
    assert.equal(after.status, before.status);
    assert.equal(after.profileId, before.profileId, `${profile.id} must still detect as itself`);
    assert.equal(after.confidence, before.confidence, `${profile.id} confidence must not move`);
  }
});

test("a conversation export is never mistaken for a billing export, or the reverse", async () => {
  for (const dialectId of DIALECT_IDS) {
    const detection = detectDialect(await fixtureTable(dialectId), ALL_DIALECT_PROFILES);
    assert.equal(detection.profileId, dialectId);
    assert.equal(detection.kind, "conversation");
  }
  const roster = readTable(await readFile(new URL("generic-hris-roster.csv", BILLING_FIXTURES), "utf8"));
  assert.equal(parseConversationExport(roster).status, "unrecognized");
});

test("a file shaped like two conversation vendors at once is claimed by neither", async () => {
  const chatgpt = await fixtureTable("chatgpt-enterprise-conversation-export");
  const claude = await fixtureTable("claude-enterprise-conversation-export");
  // Both identifier columns present: each profile forbids the other's, so the
  // tie is excluded rather than resolved by declaration order.
  const merged = {
    columns: [...chatgpt.columns, ...claude.columns],
    rows: chatgpt.rows.map((row, index) => [...row, ...claude.rows[index]]),
  };
  const result = parseConversationExport(merged);
  assert.equal(result.status, "unrecognized");
  assert.deepEqual(detectDialect(merged, ALL_DIALECT_PROFILES).candidates, []);
});

// --- imperfect data, one case per stated rule -------------------------------

test("a missing department column imports, grouped into one ungrouped bucket", () => {
  const table = sentinelTable(SENTINEL_ROWS, { columns: DEPARTMENTLESS_COLUMNS });
  const result = parseConversationExport(table);
  assert.equal(result.status, "matched");
  assert.equal(result.grouped, false);
  assert.equal(result.records.length, 3);
  assert.deepEqual([...new Set(result.records.map((record) => record.department))], [UNGROUPED_DEPARTMENT]);
  assert.deepEqual(result.departments.map((bucket) => bucket.department), [UNGROUPED_DEPARTMENT]);
  assert.equal(result.departments[0].conversations, 3);
  assert.ok(conversationSummaryLines(result).some((line) => line.includes(UNGROUPED_DEPARTMENT)));
});

test("an empty department cell degrades the same way, and never fails its row", () => {
  const result = parseConversationExport(sentinelTable([
    ["c-1", "one@example.invalid", "Atlas Platform", "2026-06-15T09:00:00Z", SENTINEL.one],
    ["c-2", "two@example.invalid", "", "2026-06-15T10:00:00Z", SENTINEL.two],
  ]));
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.skipped, []);
  assert.equal(result.records[1].department, UNGROUPED_DEPARTMENT);
});

test("a malformed timestamp skips its row, counts it, and keeps the rest", () => {
  const result = parseConversationExport(sentinelTable([
    ["c-1", "one@example.invalid", "Atlas Platform", "2026-06-15T09:00:00Z", SENTINEL.one],
    ["c-2", "two@example.invalid", "Boreal Support", "last Tuesday", SENTINEL.two],
    ["c-3", "three@example.invalid", "Atlas Platform", "2026-06-15T11:00:00Z", SENTINEL.three],
  ]));
  assert.equal(result.records.length, 2);
  assert.equal(result.rowCount, 3);
  assert.equal(result.skippedRowCount, 1);
  assert.equal(result.skipped.length, 1);
  assert.deepEqual(
    { ...result.skipped[0] },
    {
      row: 1, rowNumber: 2, conversation_id: "c-2", field: "occurred_at",
      code: CONVERSATION_ROW_CODES.invalidTimestamp,
      message: "row 2: occurred_at is not an ISO 8601 timestamp",
    },
  );
  assert.ok(conversationSummaryLines(result).some((line) => line.includes("1 skipped")));
});

test("an empty required cell skips its row with its own code", () => {
  const result = parseConversationExport(sentinelTable([
    ["c-1", "", "Atlas Platform", "2026-06-15T09:00:00Z", SENTINEL.one],
  ]));
  assert.deepEqual(result.records, []);
  assert.equal(result.skipped[0].code, CONVERSATION_ROW_CODES.missingValue);
  assert.equal(result.skipped[0].field, "actor_id");
  assert.equal(result.skippedRowCount, 1);
});

test("rows out of chronological order are accepted, and ordering is derived", () => {
  const ordered = parseConversationExport(sentinelTable(SENTINEL_ROWS));
  const shuffled = parseConversationExport(sentinelTable([
    SENTINEL_ROWS[2], SENTINEL_ROWS[0], SENTINEL_ROWS[1],
  ]));
  assert.equal(shuffled.records.length, 3);
  assert.deepEqual(shuffled.skipped, []);
  assert.deepEqual(shuffled.span, ordered.span, "the span is derived, not read off the first and last row");
  assert.equal(ordered.outOfOrderRowCount, 0);
  assert.equal(shuffled.outOfOrderRowCount, 1);
  assert.ok(conversationSummaryLines(shuffled).some((line) => line.includes("out of chronological order")));
});

test("an empty prompt cell is a valid row whose signals are zero", () => {
  const result = parseConversationExport(sentinelTable([
    ["c-1", "one@example.invalid", "Atlas Platform", "2026-06-15T09:00:00Z", ""],
    ["c-2", "two@example.invalid", "Atlas Platform", "2026-06-15T10:00:00Z", SENTINEL.two],
  ]));
  assert.deepEqual(result.skipped, []);
  assert.equal(result.records.length, 2);
  assert.deepEqual(
    { ...result.records[0] },
    {
      conversation_id: "c-1", actor_id: "one@example.invalid", department: "Atlas Platform",
      occurred_at: "2026-06-15T09:00:00Z", prompt_chars: 0, prompt_token_estimate: 0, prompt_empty: true,
    },
  );
});

test("a timestamp without a clock or a zone is read as UTC midnight, and stated as such", () => {
  const result = parseConversationExport(sentinelTable([
    ["c-1", "one@example.invalid", "Atlas Platform", "2026-06-15", SENTINEL.one],
    ["c-2", "two@example.invalid", "Atlas Platform", "2026-06-15 10:30", SENTINEL.two],
  ]));
  assert.deepEqual(result.records.map((record) => record.occurred_at),
    ["2026-06-15T00:00:00Z", "2026-06-15T10:30:00Z"]);
});

// --- the never-render rule, end to end --------------------------------------

test("no sentinel prompt reaches any surface this contract exposes", () => {
  const result = parseConversationExport(sentinelTable(SENTINEL_ROWS));
  assert.equal(result.records.length, 3);
  assert.ok(assertNeverRenderClean(result, profileById("chatgpt-enterprise-conversation-export")));
  const surface = exposedSurface(result);
  for (const sentinel of everySentinel) {
    assert.ok(!surface.includes(sentinel), `a prompt body reached an exposed surface: ${sentinel}`);
  }
  // The counts are there, so the assertion above is not passing on an empty read.
  assert.equal(result.records[0].prompt_chars, SENTINEL.one.length);
  assert.ok(conversationExportCsv(result).includes(String(SENTINEL.one.length)));
  assert.deepEqual(Object.keys(result.records[0]), CONVERSATION_RECORD_KEYS);
});

test("a row that fails validation leaks nothing into the error surface", () => {
  // The negative path, arranged so a leak would have something to leak: the row
  // that fails is the row carrying the sentinel prompt.
  const result = parseConversationExport(sentinelTable([
    ["c-1", "not-an-address", "Atlas Platform", "not-a-timestamp", SENTINEL.one],
  ]));
  assert.deepEqual(result.records, []);
  assert.equal(result.skippedRowCount, 1);
  assert.equal(result.skipped.length, 2, "both bad fields are reported, on one skipped row");
  for (const entry of result.skipped) {
    assert.equal(entry.rowNumber, 1);
    assert.ok(!entry.message.includes(SENTINEL.one));
    assert.ok(!entry.message.includes("not-an-address"), "no message echoes a cell value");
    assert.match(entry.message, /^row 1: /);
  }
  assert.ok(!exposedSurface(result).includes(SENTINEL.one));
});

// --- the page ---------------------------------------------------------------

/** Everything the harness's DOM can show: text plus every attribute value. */
function renderedMarkup(node, collected = []) {
  if (node.nodeType === 1) {
    collected.push(node.tagName, ...node.attributes.values());
  }
  for (const child of node.children ?? []) renderedMarkup(child, collected);
  if (node.nodeType === 3) collected.push(node.textContent);
  return collected.join(" ");
}

test("the import screen offers an example per dialect, says the prompt rule, and links the contract", async () => {
  const demo = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
  const evaluation = JSON.parse(
    await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));
  const page = await loadPage(new URL("../src/evolution.html", import.meta.url), {
    routes: { "/evolution-demo-data.json": demo, "/finops-evaluation-fixtures.json": evaluation },
  });
  try {
    await importPageModule("/evolution-page.js");
    const { document } = page;
    await waitFor(() => document.getElementById("conversation-example-dialect").options.length > 0,
      "the dialect chooser to be painted from the registry");

    // Labelled, keyboard-reachable, and consistent with the existing controls.
    const chooser = document.getElementById("conversation-example-dialect");
    const label = document.querySelector('label[for="conversation-example-dialect"]');
    assert.ok(label, "the chooser must have a label element bound to it");
    assert.equal(textOf(label), "Example conversation export");
    assert.equal(chooser.getAttribute("aria-describedby"), "conversation-example-help");
    assert.ok(document.getElementById("conversation-example-help"));
    assert.deepEqual(chooser.options.map((option) => option.value), DIALECT_IDS);
    assert.deepEqual(chooser.options.map((option) => textOf(option)),
      CONVERSATION_DIALECT_PROFILES.map((profile) => profile.label));
    const button = document.getElementById("download-conversation-example");
    assert.equal(button.getAttribute("type"), "button");
    assert.equal(textOf(button), "Download an example conversation export");

    // The privacy disclosure is above the file input, not after it.
    const note = document.getElementById("prompt-privacy-note");
    const noteText = textOf(note);
    for (const claim of ["parsed in memory", "never rendered", "never stored", "never uploaded"]) {
      assert.ok(noteText.toLowerCase().includes(claim), `the disclosure must say "${claim}"`);
    }
    const contractLink = note.querySelector("a");
    assert.equal(contractLink.getAttribute("href"), "/docs/conversation-export-import-contract.md");
    const controls = document.querySelectorAll("input,p,span")
      .map((element) => element.getAttribute("id"));
    assert.ok(controls.indexOf("prompt-privacy-note") < controls.indexOf("local-file-help"),
      "the prompt disclosure must be read before the file picker, not after it");

    // The download is the page's own local blob download, and it carries the
    // chosen dialect's bytes.
    chooser.value = "copilot-conversation-export";
    button.dispatchEvent({ type: "click" });
    assert.equal(page.downloads.length, 1);
    assert.equal(page.downloads[0].filename, "example-copilot-conversation-export.csv");
    assert.equal(page.downloads[0].text, await fixtureText("copilot-conversation-export"));

    // Nothing of the example prose is on the page, and nothing was stored.
    const markup = renderedMarkup(document);
    for (const prose of ["summarize the incident review", "draft a friendly reply", "rewrite this migration"]) {
      assert.ok(!markup.includes(prose), `prompt prose reached the page: ${prose}`);
    }
    assert.equal(page.storage.length, 0, "the import surface writes nothing to browser storage");
  } finally {
    page.restore();
  }
});

test("the mapping-review step withholds the sample for a never-render column", async () => {
  // The manual path: a reader drops a conversation export into the picker that
  // only imports usage and roster files. Every column is still listed and still
  // theirs to map — but the prompt column shows no cell of their file.
  const { createColumnMapping } = await import("../src/import-column-mapping.js");
  const text = [
    "conversation_id,user_email,department,created_at,role,model,message_text",
    `c-1,one@example.invalid,Atlas Platform,2026-06-15T09:00:00Z,user,assistant-large,${SENTINEL.one}`,
  ].join("\n");
  const state = createColumnMapping({
    fileName: "conversations.csv",
    reading: {
      header: text.split("\n")[0].split(","),
      rows: [{ values: text.split("\n")[1].split(",") }],
    },
  });
  const prompt = state.columns.find((column) => column.header === "message_text");
  assert.equal(prompt.sample.available, false);
  assert.equal(prompt.sample.value, "");
  assert.equal(prompt.sample.display, "");
  assert.match(prompt.sample.note, /never shown/);
  assert.equal(state.columns.length, 7, "every column is still listed and still mappable");
  // A neighbouring column is unaffected: this withholds one column, not the file.
  assert.equal(state.columns.find((column) => column.header === "department").sample.value,
    "Atlas Platform");
  assert.ok(!JSON.stringify(state).includes(SENTINEL.one));
});

// --- the doc and the parser describe the same contract ----------------------

test("the contract doc names every dialect, the flag, and every stated behaviour", async () => {
  const doc = await readFile(CONTRACT_DOC, "utf8");
  for (const dialectId of DIALECT_IDS) {
    assert.ok(doc.includes(dialectId), `the contract doc does not name dialect ${dialectId}`);
  }
  assert.ok(doc.includes(`sensitivity: "${NEVER_RENDER}"`), "the doc must name the flag it enforces");
  assert.ok(doc.includes(UNGROUPED_DEPARTMENT));
  assert.ok(doc.includes(`\`${CONVERSATION_CONTRACT_VERSION}\``));
  for (const code of Object.values(CONVERSATION_ROW_CODES)) {
    assert.ok(doc.includes(code), `the doc does not state the ${code} row code`);
  }
  for (const field of ["conversation_id", "actor_id", "occurred_at", "department", "prompt_signals"]) {
    assert.ok(doc.includes(field), `the doc does not state the ${field} field`);
  }
  for (const signal of ["prompt_chars", "prompt_token_estimate", "prompt_empty"]) {
    assert.ok(doc.includes(signal), `the doc does not state the ${signal} derived signal`);
  }
  // The doc is reachable from the screen that uses it, and shipped with it.
  const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
  assert.ok(html.includes("/docs/conversation-export-import-contract.md"));
  const build = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
  assert.ok(build.includes("conversation-export-import-contract.md"), "the linked doc must ship in the artifact");
  assert.ok(build.includes("conversation-export"), "the example fixtures must ship in the artifact");
});
