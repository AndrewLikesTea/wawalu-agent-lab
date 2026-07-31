// The structural-column contract, driven by checked-in fixture files.
//
// Every case reads a real file from tests/fixtures/corpus-structure/ rather than
// a string literal in a test body, because the thing under test is what happens
// to a file a reader chose. Each fixture is asserted twice: once against the
// normalized record shape it produces, and once against the words the import
// step actually renders from it — including the single next action.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHtml, textOf } from "./support/browser.js";
import {
  CORPUS_STRUCTURE_SCHEMA_VERSION, DIALECTS, STRUCTURAL_FIELDS, STRUCTURAL_RECORD_KEYS,
  STRUCTURE_ROW_CODES, detectStructuralDialect, parseCorpusStructure, structuralSummary,
} from "../src/corpus-structure.js";
import { applyCorpusStructure } from "../src/corpus-structure-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const fixture = (name) =>
  readFile(new URL(`./fixtures/corpus-structure/${name}`, import.meta.url), "utf8");

const parseFixture = async (name) => parseCorpusStructure(await fixture(name));

/** The detected/not-detected map, in the declared order, as plain booleans. */
const detectedOf = (result) =>
  Object.fromEntries(STRUCTURAL_RECORD_KEYS.map((key) => [key, result.detected[key]]));

async function render(result) {
  const doc = parseHtml(await readFile(PAGE, "utf8"));
  const summary = applyCorpusStructure(doc, result);
  return { doc, summary };
}

const lines = (doc) => [...doc.getElementById("corpus-structure-fields").children].map(textOf);

/** Every id on the path from a node to the document, for a containment check. */
function ancestorIds(node) {
  const ids = [];
  for (let current = node?.parentNode; current; current = current.parentNode) {
    if (current.getAttribute?.("id")) ids.push(current.getAttribute("id"));
  }
  return ids;
}

// --- the contract ----------------------------------------------------------

test("the normalized shape is versioned and closed", () => {
  assert.equal(CORPUS_STRUCTURE_SCHEMA_VERSION, "1.0");
  assert.deepEqual(STRUCTURAL_RECORD_KEYS, [
    "threadId", "turnIndex", "parentMessageId", "modelTier", "timestamp", "language",
  ]);
  // The rank behind the single next action, stated in code rather than in prose:
  // thread id, then turn ordering, then model tier, then timestamp, then language.
  assert.deepEqual(STRUCTURAL_FIELDS.map((field) => field.priority), [1, 2, 2, 3, 4, 5]);
  // Both ordering encodings are one question, so an export carrying either is
  // not missing ordering.
  assert.deepEqual(
    STRUCTURAL_FIELDS.filter((field) => field.group === "ordering").map((field) => field.id),
    ["turnIndex", "parentMessageId"],
  );
  // Every dialect declares a console option for every group, including the
  // groups it cannot supply — an action a reader cannot act on is not an action.
  for (const dialect of DIALECTS) {
    for (const group of ["thread", "ordering", "model", "time", "language"]) {
      assert.equal(typeof dialect.exportOptions[group], "string", `${dialect.id}/${group}`);
    }
  }
});

test("a dialect is recognized from the header row, and an unknown header is not guessed", () => {
  assert.equal(
    detectStructuralDialect(["message_text", "user_email", "conversation_id"]).dialect.id,
    "chatgpt-enterprise-conversation-export",
  );
  // Header matching is by name, not position, so a reordered export still maps.
  assert.equal(
    detectStructuralDialect(["user_email", "created_at", "message_text"]).dialect.id,
    "chatgpt-enterprise-conversation-export",
  );
  assert.equal(detectStructuralDialect(["thread", "turn", "text"]).status, "unrecognized");
  // Half an identity is not a dialect.
  assert.equal(detectStructuralDialect(["message_text", "language"]).status, "unrecognized");
});

// --- one fixture per supported dialect -------------------------------------

test("the ChatGPT Enterprise export carries turn ordinals and a language column", async () => {
  const result = await parseFixture("chatgpt-enterprise.csv");
  assert.equal(result.status, "matched");
  assert.equal(result.dialectId, "chatgpt-enterprise-conversation-export");
  assert.equal(result.schemaVersion, CORPUS_STRUCTURE_SCHEMA_VERSION);
  assert.deepEqual(detectedOf(result), {
    threadId: true, turnIndex: true, parentMessageId: false,
    modelTier: true, timestamp: true, language: true,
  });
  assert.equal(result.rowsParsed, 3);
  assert.equal(result.rowsSkipped, 0);
  // Partial data is normal: the row with no language keeps every other value and
  // reports absence as a distinct state, not as "" and not as a guess.
  assert.deepEqual(result.records[1], {
    threadId: "conv-8841", turnIndex: 1, parentMessageId: null,
    modelTier: "gpt-4o", timestamp: "2026-06-01T09:15:30Z", language: null,
  });
  // The tier is the provider's own string, not remapped to our taxonomy.
  assert.equal(result.records[2].modelTier, "gpt-4o-mini");
  // The unknown column in this fixture must not land anywhere.
  for (const record of result.records) {
    assert.deepEqual(Object.keys(record), STRUCTURAL_RECORD_KEYS);
    assert.ok(!Object.values(record).includes("TCK-1"));
  }
  const { summary } = await render(result);
  assert.equal(summary.nextAction.group, null);
  assert.equal(summary.nextAction.text,
    "Every structural column this analysis uses is already in your export. "
    + "No further console export option is needed.");
});

test("the Claude Enterprise export orders by parent message id and carries no language", async () => {
  const result = await parseFixture("claude-enterprise.csv");
  assert.equal(result.dialectId, "claude-enterprise-conversation-export");
  assert.deepEqual(detectedOf(result), {
    threadId: true, turnIndex: false, parentMessageId: true,
    modelTier: true, timestamp: true, language: false,
  });
  assert.equal(result.rowsParsed, 3);
  // The thread's first turn has no parent. Kept, with the field absent.
  assert.equal(result.records[0].parentMessageId, null);
  assert.equal(result.records[1].parentMessageId, "msg-1");
  // Ordering is answered by the parent pointer, so the one missing group is
  // language, and the action says the console cannot supply it at all.
  const { summary } = await render(result);
  assert.equal(summary.nextAction.group, "language");
  assert.equal(summary.nextAction.text,
    "Most valuable missing column: language of the conversation. In Claude Enterprise "
    + "conversation export, no language column is available in this export — a different "
    + "export is needed to supply it.");
});

test("the Copilot interaction export carries no model column", async () => {
  const result = await parseFixture("copilot-interaction.csv");
  assert.equal(result.dialectId, "copilot-conversation-export");
  assert.deepEqual(detectedOf(result), {
    threadId: true, turnIndex: true, parentMessageId: false,
    modelTier: false, timestamp: true, language: true,
  });
  // A blank turn number is a missing value, never a zero.
  assert.equal(result.records[1].turnIndex, null);
  assert.equal(result.records[0].turnIndex, 0);
  assert.equal(result.rowsSkipped, 0);
  const { summary } = await render(result);
  assert.equal(summary.nextAction.group, "model");
  assert.match(summary.nextAction.text, /^Most valuable missing column: model or tier the turn ran on\./);
});

test("an audit export keeps a row whose timestamp cannot be read, without inventing a date", async () => {
  const result = await parseFixture("workspace-audit.csv");
  assert.equal(result.dialectId, "workspace-audit-conversation-export");
  assert.deepEqual(detectedOf(result), {
    threadId: true, turnIndex: false, parentMessageId: false,
    modelTier: false, timestamp: true, language: false,
  });
  assert.equal(result.rowsParsed, 3);
  assert.equal(result.rowsSkipped, 0);
  assert.equal(result.records[1].timestamp, null);
  assert.equal(result.records[1].threadId, "sess-01");
  assert.equal(result.records[0].timestamp, "2026-06-07T07:45:00Z");
  // Ordering outranks model and language, so it is the one action named.
  const { summary } = await render(result);
  assert.equal(summary.nextAction.group, "ordering");
});

// --- the two edge fixtures -------------------------------------------------

test("an export with none of the structural columns says so, and asks for thread id first", async () => {
  const result = await parseFixture("no-structural-columns.csv");
  assert.equal(result.status, "matched");
  assert.equal(result.rowsParsed, 3);
  assert.deepEqual(Object.values(detectedOf(result)), [false, false, false, false, false, false]);
  const { doc, summary } = await render(result);
  assert.deepEqual(lines(doc), [
    "○Conversation / thread id — not present in this export",
    "○Turn number within the thread — not present in this export",
    "○Parent message id (the other way to order turns) — not present in this export",
    "○Model or tier the turn ran on — not present in this export",
    "○Request timestamp — not present in this export",
    "○Language of the conversation — not present in this export",
  ]);
  assert.equal(summary.nextAction.group, "thread");
  assert.equal(textOf(doc.getElementById("corpus-structure-action")),
    "Most valuable missing column: conversation / thread id. Turn on “Include conversation id” "
    + "in your ChatGPT Enterprise conversation export and export again.");
});

test("ragged rows and undecodable ordinals are counted and stepped over, never thrown", async () => {
  const result = await parseFixture("ragged-rows.csv");
  assert.equal(result.status, "matched");
  assert.equal(result.rowsParsed, 2);
  assert.equal(result.rowsSkipped, 3);
  assert.deepEqual(result.skipped.map((entry) => entry.code), [
    STRUCTURE_ROW_CODES.raggedRow,
    STRUCTURE_ROW_CODES.undecodableOrdinal,
    STRUCTURE_ROW_CODES.raggedRow,
  ]);
  // A skip names a coordinate and a code, never a cell of the file.
  for (const entry of result.skipped) assert.match(entry.message, /^row \d+: /);
  assert.deepEqual(result.records.map((record) => record.threadId), ["conv-1", "conv-4"]);
  // Row order is carried through, not repaired: the surviving ordinals are the
  // file's own, in the file's own order.
  assert.deepEqual(result.records.map((record) => record.turnIndex), [0, 2]);
  const { doc } = await render(result);
  assert.equal(textOf(doc.getElementById("corpus-structure-counts")),
    "2 rows parsed, 3 skipped as malformed.");
});

// --- what the import step renders ------------------------------------------

test("the summary reports the dialect, the counts, and one action, in the import step", async () => {
  const result = await parseFixture("chatgpt-enterprise.csv");
  const { doc } = await render(result);
  const region = doc.getElementById("corpus-structure");
  assert.equal(region.hidden, false);
  // It lives inside the import panel, beside the step it belongs to.
  assert.ok(ancestorIds(region).includes("local-import"));
  assert.equal(textOf(doc.getElementById("corpus-structure-dialect")),
    "Recognized as ChatGPT Enterprise conversation export (structural schema 1.0).");
  assert.equal(textOf(doc.getElementById("corpus-structure-counts")),
    "3 rows parsed, none skipped as malformed.");
  assert.deepEqual(lines(doc), [
    "✓Conversation / thread id — detected",
    "✓Turn number within the thread — detected",
    "○Parent message id (the other way to order turns) — not present in this export",
    "✓Model or tier the turn ran on — detected",
    "✓Request timestamp — detected",
    "✓Language of the conversation — detected",
  ]);
  // Nothing is signalled by tint alone: the word is in the sentence, and the
  // heading it sits under is focusable so the region is reachable by keyboard.
  const heading = doc.getElementById("corpus-structure-title");
  assert.equal(heading.getAttribute("tabindex"), "-1");
  assert.equal(heading.tagName, "H3");
  assert.equal(region.getAttribute("aria-labelledby"), "corpus-structure-title");
});

test("the summary announces itself through the page's own polite region", async () => {
  const result = await parseFixture("no-structural-columns.csv");
  const { doc } = await render(result);
  const live = doc.getElementById("corpus-structure-live");
  assert.equal(live.getAttribute("role"), "status");
  assert.equal(live.getAttribute("aria-live"), "polite");
  // Always in the rendered tree, so the first import is announced as well as
  // the tenth.
  assert.equal(live.hidden, false);
  assert.match(textOf(live), /0 of 6 structural columns detected/);
  assert.match(textOf(live), /Most valuable missing column: conversation \/ thread id\./);
  // Clearing takes the region and its announcement together.
  applyCorpusStructure(doc, null);
  assert.equal(doc.getElementById("corpus-structure").hidden, true);
  assert.equal(textOf(live), "");
  assert.deepEqual(lines(doc), []);
});

test("a file matching no dialect is reported plainly, never partially guessed", () => {
  const result = parseCorpusStructure("owner,cost,period\nada,12,2026-06\n");
  assert.equal(result.status, "unrecognized");
  assert.equal(result.dialectId, null);
  assert.deepEqual(result.records, []);
  assert.deepEqual(Object.values(result.detected), [false, false, false, false, false, false]);
  const summary = structuralSummary(result);
  assert.equal(summary.dialectLine,
    "This file's header row matched no supported export dialect, so no column was read.");
  assert.equal(summary.countLine, "No rows were parsed.");
  assert.match(summary.nextAction.text, /^No supported export dialect matched this file's header row/);
});
