// The conversation aggregation on the existing import worker.
//
// There is one offload mechanism in this repository and this file exists to keep
// it that way: the same `createImportOffloader`, the same chunked transfer, the
// same `import:` message names, the same cancellation-by-termination, and the
// same synchronous fallback — with a `kind` selecting which reader runs at the
// far end and nothing else changed.
//
// The large fixture is generated here rather than committed. The
// main-thread-responsiveness assertion is the one `import-offload.test.js`
// already uses: count the task boundaries the transfer loop yields at. It is
// structural rather than a wall-clock measurement, so it does not go flaky on a
// loaded machine — which is the whole reason that test chose it.

import assert from "node:assert/strict";
import test from "node:test";
import { CANCELLED_CODE, createImportOffloader } from "../src/import-offload.js";
import { IMPORT_KINDS, createImportWorkerSession } from "../src/import-worker-core.js";
import { analyzeConversationExportText } from "../src/conversation-literacy.js";
import { parseLocalImportFile } from "../src/finops-tabular-import.js";

const GENERATED_AT = "2026-07-24T00:00:00.000Z";

/** A thread boundary and nothing else, driving the real worker session. */
function fakeWorkers() {
  const created = [];
  const factory = (url, options) => {
    void options.type;
    const worker = {
      url,
      terminated: false,
      onmessage: null,
      onerror: null,
      postMessage(message) {
        if (worker.terminated) return;
        const copy = structuredClone(message);
        queueMicrotask(() => { if (!worker.terminated) session.handle(copy); });
      },
      terminate() { worker.terminated = true; },
    };
    const session = createImportWorkerSession((message) => {
      if (worker.terminated) return;
      // Structured clone in both directions: the aggregate has to survive the
      // same serialization the usage envelope does, or it cannot cross a thread.
      const copy = structuredClone(message);
      queueMicrotask(() => { if (!worker.terminated) worker.onmessage?.({ data: copy }); });
    });
    created.push(worker);
    return worker;
  };
  factory.created = created;
  return factory;
}

function offloaderWith(factory, overrides = {}) {
  return createImportOffloader({
    scope: {},
    createWorker: factory,
    yieldToTask: () => Promise.resolve(),
    ...overrides,
  });
}

const COLUMNS = ["conversation_id", "user_email", "department", "created_at", "role", "model", "message_text"];

/**
 * `turns` conversation rows across three departments, generated deterministically
 * so the expected counts below are arithmetic rather than a golden file.
 *
 * Every fourth turn is a mechanical edit on a premium model (over-provisioned),
 * every fourth a re-prompt (inefficient), every fourth personal (out-of-scope),
 * and the rest are well-formed requests.
 */
const DEPARTMENTS = ["Atlas Platform", "Boreal Support", "Cinder Research"];
const PROMPTS = [
  ["fix the typo in this heading", "gpt-4o"],
  ["try again, that answer is wrong", "gpt-4o-mini"],
  ["give me a recipe for a birthday cake", "gpt-4o-mini"],
  ["Context: the billing service. Constraints: must not change the schema. "
    + "Acceptance criteria: the suite passes.", "gpt-4o-mini"],
];

function generateExport(turns) {
  const lines = [COLUMNS.join(",")];
  for (let index = 0; index < turns; index += 1) {
    const [prompt, model] = PROMPTS[index % PROMPTS.length];
    lines.push([
      `conv-${String(index).padStart(7, "0")}`,
      `person${index % 12}@example.invalid`,
      DEPARTMENTS[index % DEPARTMENTS.length],
      `2026-06-${String((index % 27) + 1).padStart(2, "0")}T09:00:00Z`,
      "user",
      model,
      `"${prompt}"`,
    ].join(","));
  }
  return lines.join("\n");
}

const conversationJob = (text, options = {}) => ({
  kind: IMPORT_KINDS.conversationLiteracy,
  text,
  fileName: "conversations.csv",
  mediaType: "text/csv",
  options,
  sync: () => analyzeConversationExportText(text, options),
});

// --- the offloaded run ------------------------------------------------------

test("the worker returns the same aggregate the synchronous path would", async () => {
  const text = generateExport(240);
  const offloader = offloaderWith(fakeWorkers());
  const offloaded = await offloader.run(conversationJob(text));

  assert.equal(offloader.mode, "worker");
  assert.deepStrictEqual(offloaded, JSON.parse(JSON.stringify(analyzeConversationExportText(text))));
  assert.equal(offloaded.literacy.departments.length, DEPARTMENTS.length);
});

test("a large export completes off the main thread without blocking it", async () => {
  // Tens of thousands of turns, generated here. 36,000 divides by both the
  // department count and the prompt cycle, so every expected count below is
  // exact rather than approximate.
  const turns = 36_000;
  const text = generateExport(turns);
  let yields = 0;
  const chunkChars = 262_144;
  const offloader = offloaderWith(fakeWorkers(), {
    chunkChars,
    yieldToTask: () => { yields += 1; return Promise.resolve(); },
  });

  const samples = [];
  const result = await offloader.run(conversationJob(text),
    { onProgress: (progress) => samples.push(progress) });

  // The aggregate counts, from the generator's own arithmetic.
  assert.equal(result.parse.recordCount, turns);
  assert.equal(result.parse.skippedRowCount, 0);
  const perDepartment = turns / DEPARTMENTS.length;
  assert.equal(result.literacy.attribution.total, turns);
  assert.equal(result.literacy.attribution.export_column, turns);
  assert.equal(result.literacy.attribution.unattributed, 0);
  for (const name of DEPARTMENTS) {
    const department = result.literacy.departments.find((entry) => entry.department === name);
    assert.equal(department.prompts.total, perDepartment);
    // Three prompts in four classify; the fourth cycles through the categories,
    // so each department sees the same mix.
    assert.equal(department.prompts.classified, perDepartment);
    assert.equal(department.gradeable, true);
    assert.equal(department.driver.key, "model_fit");
    assert.equal(department.driver.numerator, perDepartment / 4);
    assert.equal(department.driver.denominator, perDepartment);
  }
  assert.equal(result.literacy.company.showGrade, true);
  assert.equal(result.literacy.company.coveredPrompts, turns);

  // THE MAIN-THREAD ASSERTION, the same one the usage import's own offload test
  // makes: the transfer loop yields a task boundary per chunk, so the page
  // paints, scrolls and answers clicks between them. A file this size is many
  // chunks, and every one of them is a chance for the browser to run.
  assert.ok(text.length > chunkChars * 4, "the fixture is genuinely multi-chunk");
  assert.ok(yields >= Math.ceil(text.length / chunkChars) - 1,
    `${yields} task boundaries for ${Math.ceil(text.length / chunkChars)} chunks`);
  // And the parse itself ran on the worker: the reader saw a fraction of a known
  // total, never the coarse "cannot show progress" fallback.
  assert.ok(samples.length >= 3);
  assert.ok(samples.every((sample) => sample.coarse === false));
  assert.equal(samples.at(-1).phase, "done");
});

test("errors and cancellation propagate exactly as the usage import's do", async () => {
  const offloader = offloaderWith(fakeWorkers());
  // A file the delimited reader refuses fails as data — a code and located
  // problems — rather than as an exception the page cannot render.
  await assert.rejects(() => offloader.run(conversationJob("")), (error) => {
    assert.equal(typeof error.code, "string");
    assert.ok(Array.isArray(error.problems) && error.problems.length >= 1);
    return true;
  });

  const running = offloader.run(conversationJob(generateExport(4_000)));
  assert.equal(offloader.busy, true);
  assert.equal(offloader.cancel(), true);
  await assert.rejects(() => running, (error) => error.code === CANCELLED_CODE);
  // A cancelled run leaves nothing behind: the next import is ordinary.
  const after = await offloader.run(conversationJob(generateExport(120)));
  assert.equal(after.parse.recordCount, 120);
});

test("a browser without workers runs the identical pipeline on the page thread", async () => {
  const text = generateExport(120);
  const offloader = createImportOffloader({ scope: {}, yieldToTask: () => Promise.resolve() });
  const samples = [];
  const result = await offloader.run(conversationJob(text),
    { onProgress: (progress) => samples.push(progress) });

  assert.equal(offloader.mode, "sync");
  assert.deepStrictEqual(result, analyzeConversationExportText(text));
  // The surface says the fraction is unavailable rather than animating one.
  assert.ok(samples.every((sample) => sample.coarse === true));
});

// --- non-regression ---------------------------------------------------------

const USAGE_CSV = [
  "date,project_name,model,amount,currency",
  ...Array.from({ length: 300 }, (_, index) =>
    `2026-07-${String((index % 28) + 1).padStart(2, "0")},`
    + `${DEPARTMENTS[index % DEPARTMENTS.length]},`
    + `${index % 3 === 0 ? "gpt-4o" : "gpt-4o-mini"},${(index % 90) + 1}.00,USD`),
].join("\n");

const usageJob = () => ({
  kind: IMPORT_KINDS.usage,
  text: USAGE_CSV,
  fileName: "usage.csv",
  mediaType: "text/csv",
  options: { generatedAt: GENERATED_AT },
  sync: () => parseLocalImportFile(USAGE_CSV, "usage.csv", "text/csv", { generatedAt: GENERATED_AT }),
});

test("a usage import and a conversation export in one session leave the usage outputs unchanged", async () => {
  const offloader = offloaderWith(fakeWorkers());

  const before = await offloader.run(usageJob());
  const literacy = await offloader.run(conversationJob(generateExport(600)));
  const after = await offloader.run(usageJob());

  // Byte-identical: the envelope the spend-mix and down-routing pipeline reads
  // is exactly what it was before a conversation export was ever imported.
  assert.deepStrictEqual(after, before);
  assert.deepStrictEqual(after, JSON.parse(JSON.stringify(
    parseLocalImportFile(USAGE_CSV, "usage.csv", "text/csv", { generatedAt: GENERATED_AT }),
  )));
  // The two imports really did both run, on one worker mechanism.
  assert.ok(literacy.literacy.departments.length > 0);
  assert.equal(offloader.mode, "worker");

  // A default-kind job — the shape every caller written before this change
  // posts — still reaches the usage reader.
  const untagged = await offloader.run({ ...usageJob(), kind: undefined });
  assert.deepStrictEqual(untagged, before);
});
