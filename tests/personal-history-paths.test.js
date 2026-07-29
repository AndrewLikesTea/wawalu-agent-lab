// The allowlisted path accessor: what a personal export may be read out of, and
// everything a file cannot make this reader open.
//
// WHY THIS FILE EXISTS SEPARATELY from tests/personal-history-report.test.js.
// That file checks the arithmetic a reader will quote back at us. This one
// checks the boundary underneath it: the reader resolves the paths
// `personal-history-contract.js` declares and no others, so "what does this
// product read out of my file" is answered by one list rather than by every `?.`
// chain in the parser. A nested spelling that works is only half the claim; the
// other half is an undeclared neighbour that does not.
//
// No fixture is committed. Every export below is generated from the bundled
// synthetic preview's hand-authored prompts or from strings written in this
// file. No real prompt, provider, customer, or telemetry data was available and
// none is used.

import test from "node:test";
import assert from "node:assert/strict";

import {
  PERSONAL_EXPORT_PATH_RULE, PERSONAL_EXPORT_SHAPES, PERSONAL_NOT_ELIGIBLE,
  PERSONAL_NOT_ELIGIBLE_RULE, PERSONAL_REPORT_STATE, validatePersonalHistoryReport,
} from "../src/personal-history-contract.js";
import {
  assertNoPromptText, buildPersonalHistoryReport, detectPersonalExportShape,
  readDeclaredExportPath,
} from "../src/personal-history-report.js";
import { PERSONAL_PREVIEW_PROMPTS } from "../src/personal-history-fixture.js";
import { EVAL_FIXTURES, evalFixtureExport } from "../src/personal-history-eval-fixtures.js";

const [JSON_SHAPE] = PERSONAL_EXPORT_SHAPES;

/** Five days, so a generated export clears the distinct-day floor. */
const DAYS = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
const PROMPTS = 25;

const promptAt = (at) => PERSONAL_PREVIEW_PROMPTS[at % PERSONAL_PREVIEW_PROMPTS.length];
const dayAt = (at) => DAYS[at % DAYS.length];

/** The history in the flat spelling: `conversations`, `messages`, `role`, `content`. */
function flatExport() {
  return JSON.stringify({
    conversations: Array.from({ length: PROMPTS }, (unused, at) => ({
      create_time: `${dayAt(at)}T09:00:00Z`,
      messages: [
        { role: "user", content: promptAt(at) },
        { role: "assistant", content: "Here is a draft." },
      ],
    })),
  });
}

/**
 * The same history in the nested spelling, every declared dotted path at once:
 * `data.conversations`, `conversation.messages`, `author.role`,
 * `metadata.create_time`, and the prompt split across `content.parts`.
 */
function nestedExport({ extra = [] } = {}) {
  return JSON.stringify({
    data: {
      conversations: [...Array.from({ length: PROMPTS }, (unused, at) => ({
        conversation: {
          messages: [
            {
              author: { role: "user" },
              metadata: { create_time: `${dayAt(at)}T09:00:00Z` },
              content: { parts: promptAt(at).split("\n") },
            },
            { author: { role: "assistant" }, content: { parts: ["Here is a draft."] } },
          ],
        },
      })), ...extra],
    },
  });
}

// ---------------------------------------------------------------------------
// The accessor
// ---------------------------------------------------------------------------

test("every declared path is a literal path, and a table declares only columns", () => {
  const [json, table] = PERSONAL_EXPORT_SHAPES;
  const declared = [
    ...json.conversationPaths, ...json.messagePaths, ...json.rolePaths,
    ...json.attachmentPaths, ...json.dateFields, ...json.textFields,
  ];
  assert.ok(declared.some((path) => path.includes(".")), "no nested spelling is declared at all");
  for (const path of declared) {
    assert.match(path, /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/,
      `${path} is not a literal path of object keys`);
    assert.equal(/[*[\]$]/.test(path), false, `${path} reads like a pattern rather than a place`);
  }
  // A spreadsheet header has no nesting, so a delimited shape's lists stay
  // single-segment and are matched as column names.
  for (const column of [...table.dateFields, ...table.textFields]) {
    assert.equal(column.includes("."), false, `${column} is not a column name`);
  }
});

test("a declared path resolves, direct or dotted, and only where it is declared", () => {
  const message = { role: "user", author: { role: "assistant" }, content: { parts: ["a", "b"] } };
  assert.equal(readDeclaredExportPath(message, "role", JSON_SHAPE.rolePaths), "user");
  assert.equal(readDeclaredExportPath(message, "author.role", JSON_SHAPE.rolePaths), "assistant");
  assert.deepEqual(readDeclaredExportPath(message, "content.parts", JSON_SHAPE.textFields), ["a", "b"]);
  // The same path, offered against the wrong list for this call site. A role is
  // not resolvable where a date is being read, so the allowlist is per use and
  // not merely per contract.
  assert.equal(readDeclaredExportPath(message, "author.role", JSON_SHAPE.dateFields), undefined);
  assert.equal(readDeclaredExportPath(message, "role", []), undefined);
  assert.equal(readDeclaredExportPath(message, "author.role", ["author.role"]), undefined,
    "a caller-created list cannot promote a contract path into a different allowlist");
});

test("an undeclared path is never resolved, however it is asked for", () => {
  const message = {
    role: "user",
    api_key: "sk-not-read",
    session: { cookie: "not-read" },
    content: { parts: ["a"], internal_notes: "not read" },
  };
  // Present in the file, and offered with a caller-invented allowlist. The
  // contract's own path set is the second gate, so a caller cannot declare a
  // path the contract does not.
  for (const path of ["api_key", "session.cookie", "content.internal_notes"]) {
    assert.equal(readDeclaredExportPath(message, path, [path]), undefined,
      `${path} resolved out of an export that never declared it`);
  }
});

test("a path is walked through own keys of plain objects and nothing else", () => {
  assert.equal(PERSONAL_EXPORT_PATH_RULE.wildcards, "none");
  assert.equal(PERSONAL_EXPORT_PATH_RULE.search, "none");
  // An array, a string, and a missing segment all end the walk at nothing rather
  // than being indexed into.
  for (const source of [{ content: ["a"] }, { content: "a" }, { content: null }, {}, null, "text", 42]) {
    assert.equal(readDeclaredExportPath(source, "content.parts", JSON_SHAPE.textFields), undefined);
  }
  // Inherited keys do not resolve, so nothing off a prototype chain can answer
  // for a field the export did not carry.
  const inherited = { author: Object.create({ role: "user" }) };
  assert.equal(readDeclaredExportPath(inherited, "author.role", JSON_SHAPE.rolePaths), undefined);
  class ExportAuthor {
    constructor() {
      this.role = "user";
    }
  }
  assert.equal(readDeclaredExportPath({ author: new ExportAuthor() }, "author.role", JSON_SHAPE.rolePaths),
    undefined, "a class instance is not a plain export record even when the key is its own");
  const nullPrototypeAuthor = Object.assign(Object.create(null), { role: "user" });
  assert.equal(readDeclaredExportPath({ author: nullPrototypeAuthor }, "author.role", JSON_SHAPE.rolePaths),
    "user", "a null-prototype JSON-like record remains safe to walk");
  const polluted = JSON.parse('{"content": {"__proto__": {"parts": ["x"]}}}');
  assert.equal(readDeclaredExportPath(polluted, "content.parts", JSON_SHAPE.textFields), undefined);
});

// ---------------------------------------------------------------------------
// Reading a nested export
// ---------------------------------------------------------------------------

test("the nested spelling of a history reads identically to the flat one", () => {
  const nested = buildPersonalHistoryReport(nestedExport());
  const flat = buildPersonalHistoryReport(flatExport());
  assert.equal(detectPersonalExportShape(nestedExport()), JSON_SHAPE.id);
  assert.equal(nested.state, PERSONAL_REPORT_STATE.prioritized);
  assert.deepEqual(validatePersonalHistoryReport(nested).errors, []);
  // The same prompts on the same days, so every published figure is the same:
  // where a field was spelled changes nothing about what was read out of it.
  assert.deepEqual(nested, flat);
  assert.equal(nested.coverage.scoredPrompts, PROMPTS);
  assert.equal(nested.coverage.distinctDays, DAYS.length);
});

test("a message's own nested date is read, and falls back to the conversation's", () => {
  const dated = (metadata, conversationDate) => buildPersonalHistoryReport(JSON.stringify({
    conversations: [{
      ...(conversationDate ? { create_time: `${conversationDate}T09:00:00Z` } : {}),
      messages: [{ author: { role: "user" }, ...metadata, content: { parts: [promptAt(0)] } }],
    }],
  }));
  // Enough to distinguish "the date was read" from "the date was not": a single
  // scored prompt is below the floor either way, and the undated bucket is what
  // separates the two.
  const own = dated({ metadata: { create_time: DAYS[0] } }, null);
  assert.equal(own.coverage.scoredPrompts, 1);
  assert.equal(own.coverage.dropped.undated, 0);

  const fallback = dated({ metadata: { create_time: "2026-09-01not-a-date" } }, DAYS[1]);
  assert.equal(fallback.coverage.scoredPrompts, 1, "a malformed nested date falls back to the conversation's");
  assert.equal(fallback.coverage.dropped.undated, 0);

  const undeclared = dated({ meta: { create_time: DAYS[0] } }, null);
  assert.equal(undeclared.coverage.dropped.undated, 1,
    "a date at an undeclared path is not a date this reader found");
  assert.equal(undeclared.coverage.scoredPrompts, 0);
});

// ---------------------------------------------------------------------------
// What is ignored
// ---------------------------------------------------------------------------

test("replies, attachments, credentials, and unrecognized records are read for nothing", () => {
  const marker = "qz4-marker-no-report-may-carry";
  const report = buildPersonalHistoryReport(nestedExport({
    extra: [
      // Somebody else's turns, at the nested role path.
      {
        conversation: {
          messages: [
            { author: { role: "assistant" }, content: { parts: [`reply about ${marker}`] } },
            { author: { role: "system" }, content: { parts: [`system note ${marker}`] } },
            { author: { role: "tool" }, content: { parts: [`tool output ${marker}`] } },
          ],
        },
      },
      // A message that is only a file, plus fields a reader must never open.
      {
        conversation: {
          messages: [{
            author: { role: "user" },
            metadata: { create_time: `${DAYS[0]}T10:00:00Z` },
            attachments: [{ filename: `${marker}.pdf`, mime_type: "application/pdf", bytes: 4096 }],
            api_key: `sk-${marker}`,
            authorization: `Bearer ${marker}`,
            session: { cookie: `session=${marker}` },
          }],
        },
      },
      // Records that are not conversations at all: no declared messages path
      // between them, so each is skipped whole.
      null, 42, "conversation", { title: `${marker}` }, { messages: "not an array" },
      { notes: [{ role: "user", content: `${marker} in an undeclared record` }] },
    ],
  }));

  assert.equal(report.state, PERSONAL_REPORT_STATE.prioritized);
  assert.equal(report.coverage.scoredPrompts, PROMPTS, "nothing above was graded");
  assert.equal(report.coverage.promptEntries, PROMPTS,
    "an attachment-only message is not a prompt entry, and nobody else's turn is one either");
  assert.equal(report.coverage.attachmentsSkipped, 1, "the attachment is counted and not opened");
  // The count is the whole of what an attachment contributes: no filename, MIME
  // type, or byte length reaches the report, and neither does a credential.
  assert.equal(assertNoPromptText(report, marker), true);
  assert.equal(JSON.stringify(report).includes("4096"), false);
});

// ---------------------------------------------------------------------------
// The refusals
// ---------------------------------------------------------------------------

test("a malformed, empty, or short history is refused with an actionable reason", () => {
  const refusals = [
    ["{not json at all", PERSONAL_NOT_ELIGIBLE.unrecognizedShape],
    ['{"data": {"conversations": [{"conversation": {"messages": "not an array"}}]}}',
      PERSONAL_NOT_ELIGIBLE.unrecognizedShape],
    ['{"data": {"conversations": []}}', PERSONAL_NOT_ELIGIBLE.noPromptEntries],
    // Recognized, and carrying only turns this reader does not attribute to you.
    [nestedExport({ extra: [] }).replace(/"user"/g, '"assistant"'), PERSONAL_NOT_ELIGIBLE.noPromptEntries],
  ];
  for (const [text, reason] of refusals) {
    const report = buildPersonalHistoryReport(text);
    assert.equal(report.state, PERSONAL_REPORT_STATE.notEligible, text.slice(0, 40));
    assert.equal(report.reason, reason, text.slice(0, 40));
    assert.equal(report.reasonRule, PERSONAL_NOT_ELIGIBLE_RULE[reason]);
    assert.deepEqual(validatePersonalHistoryReport(report).errors, []);
  }
});

test("an insufficient period says which floor was missed and echoes no prompt", () => {
  const marker = "qz5-marker-no-refusal-may-carry";
  const oneDay = JSON.stringify({
    data: {
      conversations: Array.from({ length: 24 }, (unused, at) => ({
        conversation: {
          messages: [{
            author: { role: "user" },
            metadata: { create_time: `${DAYS[0]}T09:00:00Z` },
            content: { parts: [`Context: ${marker}.`, `Request: draft the note about ${marker}.`] },
          }],
        },
      })),
    },
  });
  const report = buildPersonalHistoryReport(oneDay);
  assert.equal(report.reason, PERSONAL_NOT_ELIGIBLE.tooFewDistinctDays);
  assert.equal(report.eligibility.distinctDays, 1);
  assert.equal(report.eligibility.met, false);
  // Every count measured on the way is reported, and none of the text that
  // produced them is.
  assert.ok(report.coverage.scoredPrompts >= 20);
  assert.equal(assertNoPromptText(report, marker), true);
  assert.deepEqual(validatePersonalHistoryReport(report).errors, []);
});

// ---------------------------------------------------------------------------
// The reproducibility fixtures
// ---------------------------------------------------------------------------

test("the labelled fixtures still produce the figures written down beside them", () => {
  // The nested `content.parts` spelling is how every fixture in that suite is
  // built, so this is the pin that the accessor reads them exactly as the
  // hand-derived expectations assume.
  for (const fixture of EVAL_FIXTURES) {
    const report = buildPersonalHistoryReport(evalFixtureExport(fixture));
    assert.equal(report.state, fixture.expected.state, fixture.id);
    assert.equal(report.reason, fixture.expected.reason, fixture.id);
    assert.equal(report.coverage.scoredPrompts, fixture.expected.scoredPrompts, fixture.id);
    assert.equal(report.coverage.distinctDays, fixture.expected.distinctDays, fixture.id);
    assert.deepEqual({ ...report.coverage.dropped }, { ...fixture.expected.dropped }, fixture.id);
    assert.equal(report.coverage.attachmentsSkipped, fixture.expected.attachmentsSkipped, fixture.id);
    assert.equal(report.priority.id, fixture.expected.priorityId, fixture.id);
  }
});
