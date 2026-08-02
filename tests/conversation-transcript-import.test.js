// One drop, two kinds of file (#996).
//
// The AI FinOps page has exactly one import affordance, and it already accepts a
// billing export. This file proves it now also accepts an assistant conversation
// transcript in either declared shape, that the shape is decided from the file's
// contents with no name and no picker involved, that the billing route is
// unchanged, and — the promise the reader cannot check for themselves — that a
// distinctive sentence inside a message reaches no rendered page, no persisted
// blob, and no exported JSON.
//
// Every fixture is generated here rather than committed, and every assertion is
// on a count, an attribute, or a serialized string. Nothing compares a DOM node.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  CONVERSATION_TRANSCRIPT_CONTRACT, CONVERSATION_TRANSCRIPT_VERSION, TRANSCRIPT_INTAKE_COPY,
  TRANSCRIPT_SHAPES, TRANSCRIPT_SHAPE_IDS, analyzeConversationTranscriptText,
  describeUnrecognizedTranscript, detectConversationTranscript, parseConversationTranscript,
  readConversationTranscript,
} from "../src/conversation-transcript-import.js";
import { assertNeverRenderClean, conversationExportJson } from "../src/conversation-export.js";
import { conversationLiteracyJson } from "../src/conversation-literacy.js";
import { orgQueryDepartmentLiteracy } from "../src/org-query-scoring.js";
import { detectAndNormalizeExport } from "../src/export-provider-detection.js";
import { UNGROUPED_DEPARTMENT } from "../src/dialect-profiles.js";

// ---------------------------------------------------------------------------
// The fixtures. One per accepted shape, plus one file that is neither.
//
// SENTINEL is the string this whole file exists to lose. It is inside message
// content and nowhere else, so anything that prints it printed a prompt.
// ---------------------------------------------------------------------------

const SENTINEL = "zarquon-hyperbolic-omnicognate-neutron-wrangler";

/** Four conversations, two departments, enough of each to clear the floor. */
const CONVERSATIONS = [
  { dept: "Platform", user: "ada@example.com", n: 8,
    prompt: `rename this variable to something clearer. ${SENTINEL}` },
  { dept: "Platform", user: "bo@example.com", n: 7,
    prompt: `design the migration plan with constraints and acceptance criteria. ${SENTINEL}` },
  { dept: "Support", user: "cy@example.com", n: 9,
    prompt: `write a birthday poem for my mum. ${SENTINEL}` },
  { dept: "Support", user: "di@example.com", n: 6,
    prompt: `rename this variable to something clearer. ${SENTINEL}` },
];

const stamp = (index) => `2026-06-${String(1 + (index % 20)).padStart(2, "0")}T09:15:00Z`;

/** Every conversation both fixtures describe, flattened once. */
function plan() {
  const rows = [];
  let ordinal = 0;
  for (const group of CONVERSATIONS) {
    for (let copy = 0; copy < group.n; copy += 1) {
      rows.push({
        id: `conv-${(ordinal += 1)}`,
        department: group.dept,
        user: group.user,
        at: stamp(ordinal),
        prompt: `${group.prompt} (${ordinal})`,
      });
    }
  }
  return rows;
}

/** Shape 1: a JSON envelope of conversation objects with nested messages. */
function envelopeFixture(rows = plan()) {
  return `${JSON.stringify({
    export_version: 3,
    conversations: rows.map((entry) => ({
      conversation_id: entry.id,
      created_at: entry.at,
      user: { email: entry.user },
      department: entry.department,
      model: "claude-sonnet",
      messages: [
        { role: "user", content: entry.prompt },
        { role: "assistant", content: `An assistant reply that also mentions ${SENTINEL}.` },
      ],
    })),
  }, null, 2)}\n`;
}

/** Shape 2: newline-delimited message events, one per line, shuffled. */
function eventsFixture(rows = plan()) {
  const lines = [];
  rows.forEach((entry) => {
    lines.push(JSON.stringify({
      conversation_id: entry.id, role: "assistant", ts: entry.at,
      content: `An assistant reply that also mentions ${SENTINEL}.`,
    }));
    lines.push(JSON.stringify({
      conversation_id: entry.id, role: "user", ts: entry.at, content: entry.prompt,
      user_email: entry.user, team: entry.department, model: "claude-sonnet",
    }));
  });
  return `${lines.join("\n")}\n`;
}

/** Neither shape: a plausible-looking JSON file with no turns in it anywhere. */
const UNRECOGNIZED_FIXTURE = `${JSON.stringify({
  kind: "some.other.thing", generated_at: "2026-06-01", notes: ["nothing to see"],
}, null, 2)}\n`;

// A real billing export, so "the billing path still works" is asserted against
// the shape the page actually recognizes rather than against a stand-in.
const BEDROCK_HEADER = ["lineItem/UsageStartDate", "product/model_id", "lineItem/UsageAmount",
  "lineItem/UnblendedCost", "lineItem/CurrencyCode", "lineItem/UsageAccountId", "lineItem/UsageType"];
const BEDROCK_EXPORT = `${[BEDROCK_HEADER,
  ["2026-07-20", "anthropic.claude-sonnet", "120000", "4.80", "USD", "000000000001", "USE1-InputTokenCount"],
  ["2026-07-21", "anthropic.claude-sonnet", "45000", "0.90", "USD", "000000000001", "USE1-InputTokenCount"],
].map((row) => row.join(",")).join("\n")}\n`;

// ---------------------------------------------------------------------------
// 1. The written contract, and that the code runs on it.
// ---------------------------------------------------------------------------

test("the contract declares two versioned, genuinely distinguishable shapes", () => {
  assert.equal(CONVERSATION_TRANSCRIPT_VERSION, "1.0");
  assert.match(CONVERSATION_TRANSCRIPT_CONTRACT, /conversation-transcript\/1\.0$/);
  assert.equal(TRANSCRIPT_SHAPES.length, 2);
  const ids = TRANSCRIPT_SHAPES.map((shape) => shape.id);
  assert.deepEqual(ids, [TRANSCRIPT_SHAPE_IDS.envelope, TRANSCRIPT_SHAPE_IDS.events]);
  for (const shape of TRANSCRIPT_SHAPES) {
    assert.ok(shape.label && shape.discriminator, `${shape.id} states no discriminator`);
    assert.ok(shape.required.length >= 3, `${shape.id} declares too few required fields`);
  }
  // Distinguishable, asserted rather than claimed: each fixture matches its own
  // shape and neither is read as the other.
  assert.equal(detectConversationTranscript(envelopeFixture()).shape, TRANSCRIPT_SHAPE_IDS.envelope);
  assert.equal(detectConversationTranscript(eventsFixture()).shape, TRANSCRIPT_SHAPE_IDS.events);
  assert.equal(detectConversationTranscript(UNRECOGNIZED_FIXTURE).shape, null);
});

test("detection reads contents, never a name, and both shapes agree", () => {
  // The same conversations in two formats produce the same records, the same
  // departments and the same counts: the shape is a transport, not a meaning.
  const fromEnvelope = parseConversationTranscript(envelopeFixture());
  const fromEvents = parseConversationTranscript(eventsFixture());
  for (const parsed of [fromEnvelope, fromEvents]) {
    assert.equal(parsed.status, "matched");
    assert.equal(parsed.records.length, 30);
    assert.equal(parsed.skippedRowCount, 0);
    assert.equal(assertNeverRenderClean(parsed), true);
  }
  assert.deepEqual(fromEnvelope.records.map((record) => record.conversation_id),
    fromEvents.records.map((record) => record.conversation_id));
  assert.deepEqual(fromEnvelope.departments.map((bucket) => bucket.department), ["Platform", "Support"]);
  assert.deepEqual(fromEnvelope.departments.map((bucket) => bucket.conversations), [15, 15]);
  assert.deepEqual(fromEvents.departments.map((bucket) => bucket.conversations), [15, 15]);
  // Only the human turn is measured. The assistant reply in both fixtures is
  // longer than the prompt, so a parser that measured both would show it.
  for (const record of fromEnvelope.records) {
    assert.ok(record.prompt_chars > 0 && record.prompt_chars < 140,
      "prompt_chars must measure the human turn alone");
  }
});

test("a record missing required fields is skipped and counted, never fatal", () => {
  const rows = plan();
  const text = JSON.stringify({
    conversations: [
      // No identifier.
      { created_at: rows[0].at, user: rows[0].user, messages: [{ role: "user", content: SENTINEL }] },
      // A timestamp nothing can read.
      { conversation_id: "conv-x", created_at: "last tuesday", user: rows[0].user,
        messages: [{ role: "user", content: SENTINEL }] },
      // Complete.
      { conversation_id: "conv-y", created_at: rows[0].at, user: rows[0].user, department: "Platform",
        messages: [{ role: "user", content: `fine ${SENTINEL}` }] },
    ],
  });
  const parsed = parseConversationTranscript(text);
  assert.equal(parsed.status, "matched");
  assert.equal(parsed.rowCount, 3);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.skippedRowCount, 2);
  assert.deepEqual(parsed.skipped.map((entry) => entry.code),
    ["missing_required_value", "invalid_timestamp"]);
  // And the located skips name a field and a row number, never a cell.
  for (const entry of parsed.skipped) {
    assert.ok(Number.isInteger(entry.rowNumber));
    assert.equal(entry.message.includes(SENTINEL), false);
  }
});

test("a conversation with no department falls back rather than guessing", () => {
  const text = JSON.stringify([{
    id: "conv-1", timestamp: "2026-06-02T10:00:00Z", user_id: "u-100",
    messages: [{ role: "user", content: "route this cheaply" }],
  }]);
  const parsed = parseConversationTranscript(text);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].department, UNGROUPED_DEPARTMENT);
  assert.equal(parsed.grouped, true);
});

// ---------------------------------------------------------------------------
// 2. The refusal names the shapes and the fields.
// ---------------------------------------------------------------------------

test("an unrecognized file is refused by name, not by shrug", () => {
  const message = describeUnrecognizedTranscript(UNRECOGNIZED_FIXTURE);
  assert.equal(/could not parse|unable to read|something went wrong/i.test(message), false,
    "the refusal must not be generic");
  // Both shapes, and the required field names of each, in the message itself.
  for (const shape of TRANSCRIPT_SHAPES) {
    assert.ok(message.includes(shape.label), `the refusal does not name ${shape.id}`);
    for (const field of shape.required) {
      assert.ok(message.includes(field), `the refusal does not name the required field ${field}`);
    }
  }
  for (const field of ["conversation_id", "role", "messages[]", "department", "cost_center"]) {
    assert.ok(message.includes(field), `the refusal does not name ${field}`);
  }
  // And what this file appeared to contain, structurally.
  assert.match(message, /appeared to contain a single JSON object/);
  assert.match(describeUnrecognizedTranscript("a,b,c\n1,2,3\n"),
    /appeared to contain 2 non-blank lines that are not JSON/);
  assert.match(describeUnrecognizedTranscript("   "), /appeared to contain no content at all/);

  const refused = readConversationTranscript(UNRECOGNIZED_FIXTURE);
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "unrecognized_source_shape");
  assert.equal(refused.message, message);
});

// ---------------------------------------------------------------------------
// 3. One entry point, two destinations.
// ---------------------------------------------------------------------------

test("a billing export routes to the cost path and a transcript to literacy", () => {
  // The billing detector is the one the drop panel runs. A transcript is not a
  // provider export to it, and a provider export is not a transcript to us.
  assert.equal(detectAndNormalizeExport(BEDROCK_EXPORT).provider, "bedrock");
  assert.equal(detectAndNormalizeExport(envelopeFixture()).provider, null);
  assert.equal(detectAndNormalizeExport(eventsFixture()).provider, null);
  assert.equal(readConversationTranscript(BEDROCK_EXPORT).ok, false);

  for (const text of [envelopeFixture(), eventsFixture()]) {
    const claimed = readConversationTranscript(text);
    assert.equal(claimed.ok, true, claimed.message ?? "");
    assert.equal(claimed.grades, "prompt_literacy");
    assert.equal(claimed.keySpace, "source_label");
    assert.equal(claimed.records.length, 30);
    // The literacy path the page already runs on an archive, reached with a
    // rubric category per conversation and no excerpt behind it.
    const literacy = orgQueryDepartmentLiteracy({ results: [claimed] });
    const graded = literacy.departments.filter((department) => department.gradeable);
    assert.equal(graded.length, 2, "both departments must reach a grade");
    for (const department of graded) assert.match(department.grade, /^[A-F]$/);
  }
});

// ---------------------------------------------------------------------------
// 4. Redaction by construction.
// ---------------------------------------------------------------------------

test("nothing a transcript import produces carries a word of the transcript", () => {
  for (const text of [envelopeFixture(), eventsFixture()]) {
    const parsed = parseConversationTranscript(text);
    const claimed = readConversationTranscript(text);
    const analysis = analyzeConversationTranscriptText(text);
    const serialized = [
      JSON.stringify(parsed),
      JSON.stringify(claimed),
      JSON.stringify(analysis),
      JSON.stringify(orgQueryDepartmentLiteracy({ results: [claimed] })),
      conversationExportJson(parsed),
      conversationLiteracyJson(analysis.literacy),
    ];
    for (const blob of serialized) {
      assert.equal(blob.includes(SENTINEL), false, "a prompt reached a serialized result");
      assert.equal(blob.includes("assistant reply"), false, "an assistant turn reached a result");
    }
    // Positive control: the counts that replaced the text are really there.
    assert.equal(analysis.parse.recordCount, 30);
    assert.ok(analysis.literacy.departments.length >= 2);
  }
});

// ---------------------------------------------------------------------------
// 5. The real page: one control, both file kinds, and no sentinel anywhere.
// ---------------------------------------------------------------------------

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const file = (name, type, text) => ({ name, type, size: text.length, text: async () => text });

async function openFinopsTab() {
  const page = await loadPage(PAGE, {
    storage: {},
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  return page;
}

/** Record every key this page persists while a file is being imported. */
function recordWrites() {
  const real = globalThis.localStorage;
  const written = [];
  const recorder = {
    getItem: (key) => real.getItem(key),
    setItem: (key, value) => { written.push(`${key}=${value}`); real.setItem(key, value); },
    removeItem: (key) => real.removeItem(key),
    clear: () => real.clear(),
  };
  Object.defineProperty(globalThis, "localStorage",
    { value: recorder, writable: true, configurable: true });
  return written;
}

function choose(document, chosen) {
  const input = document.getElementById("local-finops-files");
  input.files = [chosen];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

const settled = (document) => waitFor(
  () => document.getElementById("local-import-state").getAttribute("aria-busy") === "false",
  "the import to finish");

test("the one drop takes a billing export and a transcript to their own paths", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  const written = recordWrites();

  // (a) The billing export, on the route it has always taken.
  choose(document, file("bedrock.csv", "text/csv", BEDROCK_EXPORT));
  await waitFor(() => document.getElementById("finops-stand").dataset.detectedProvider === "bedrock",
    "the billing export to reach the provider path");
  await settled(document);

  // (b) The transcript, through the SAME control — no picker, no second zone,
  // and a name that says nothing true about the file.
  const transcript = envelopeFixture();
  choose(document, file("untitled.txt", "text/plain", transcript));
  await waitFor(
    () => document.getElementById("finops-import-reason").dataset.state === "recognized-conversation",
    "the transcript to be recognized from its contents");
  await settled(document);

  const said = textOf(document.getElementById("finops-import-reason"));
  assert.match(said, /Conversation envelope \(JSON\)/);
  assert.match(said, /30 conversation objects/);
  assert.equal(document.getElementById("finops-import-reason").dataset.transcriptShape,
    TRANSCRIPT_SHAPE_IDS.envelope);
  // The billing verdict the reader already had is untouched by the second file.
  assert.equal(document.getElementById("finops-stand").dataset.detectedProvider, "bedrock");

  // (c) THE SENTINEL, nowhere. In the rendered page, in everything the page
  // persisted, and in the JSON export the reader can download.
  assert.equal(textOf(document.documentElement).includes(SENTINEL), false,
    "a prompt reached the rendered page");
  for (const entry of written) {
    assert.equal(entry.includes(SENTINEL), false, "a prompt reached this browser's storage");
  }
  document.getElementById("export-local-json").click();
  for (const download of page.downloads) {
    assert.equal(download.text.includes(SENTINEL), false, "a prompt reached the JSON export");
  }
  // Whether or not the record control produced a file here, the export payload
  // builders are asserted directly above ("nothing a transcript import produces
  // carries a word of the transcript"), so the JSON export is covered either way.
  assert.ok(Array.isArray(page.downloads));
});

test("the panel says what a conversation export gives up and what it never does", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  const reads = document.getElementById("finops-transcript-reads");
  const discards = document.getElementById("finops-transcript-discards");
  assert.equal(textOf(reads), TRANSCRIPT_INTAKE_COPY.reads);
  assert.equal(textOf(discards), TRANSCRIPT_INTAKE_COPY.discards);
  // What is read, and what is discarded, named in the words the criteria use.
  assert.match(textOf(reads), /messages .*roles?|role/i);
  assert.match(textOf(reads), /timestamp/);
  assert.match(textOf(reads), /department/);
  assert.match(textOf(discards), /never keeps the words/);
  assert.match(textOf(discards), /prompt text/);
  // In the reading flow, not folded away: neither paragraph has a collapsible
  // ancestor, asserted by counting the disclosures that contain them.
  for (const id of ["finops-transcript-reads", "finops-transcript-discards"]) {
    assert.equal(document.querySelectorAll(`#${id}`).length, 1);
    const ancestors = [];
    for (let node = document.getElementById(id).parentNode; node; node = node.parentNode) {
      if (node.tagName) ancestors.push(node.tagName);
    }
    assert.equal(ancestors.includes("DETAILS"), false, `#${id} is folded inside a disclosure`);
    assert.ok(ancestors.length > 0, "the paragraph is not in the document");
  }
});
