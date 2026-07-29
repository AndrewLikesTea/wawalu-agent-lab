// The entry rules, tested without a document.
//
// Two things live here: what may be handed in before a byte is read, and the run
// ledger that decides which async completion is allowed to paint. The ledger is
// the whole of the fix for the stale-result race, so it is pinned here as
// arithmetic — tests/personal-history-flow.test.js then drives the same rules
// through the shipped page, where the failure actually happened.

import test from "node:test";
import assert from "node:assert/strict";
import {
  PERSONAL_ENTRY_REFUSAL, PERSONAL_FILE_ACCEPT, PERSONAL_FILE_EXTENSIONS,
  PERSONAL_MAX_FILE_BYTES, PERSONAL_READ_STAGES, PERSONAL_RUN_KIND,
  createRunLedger, personalFileEligibility, personalStageProgress,
} from "../src/personal-history-entry.js";
import { PERSONAL_EXPORT_SHAPES, PERSONAL_READER_LIMITS } from "../src/personal-history-contract.js";

/* ------------------------------- eligibility ------------------------------- */

test("both supported shapes have an extension a picker can filter on, and nothing else does", () => {
  assert.equal(PERSONAL_FILE_EXTENSIONS.length, new Set(PERSONAL_FILE_EXTENSIONS).size, "no duplicates");
  for (const shape of PERSONAL_EXPORT_SHAPES) {
    assert.ok(PERSONAL_FILE_ACCEPT.includes(shape.container === "json" ? ".json" : ".csv"),
      `${shape.id} has no extension in the picker filter`);
  }
  assert.ok(!PERSONAL_FILE_EXTENSIONS.includes(".pdf"));
});

test("a supported export is eligible, whatever media type the operating system guessed", () => {
  for (const name of ["history.json", "PROMPTS.CSV", "log.tsv", "export.txt"]) {
    const verdict = personalFileEligibility({ name, size: 4096, type: "application/octet-stream" });
    assert.equal(verdict.eligible, true, `${name} should be readable`);
    assert.equal(verdict.code, null);
  }
});

test("an unsupported file is refused with a reason, a remedy, and without being opened", () => {
  let opened = false;
  const file = { name: "transcript.pdf", size: 900, text: () => { opened = true; } };
  const verdict = personalFileEligibility(file);

  assert.equal(verdict.eligible, false);
  assert.equal(verdict.code, PERSONAL_ENTRY_REFUSAL.unsupportedFileType);
  assert.match(verdict.summary, /\.pdf/);
  assert.match(verdict.detail, /never read|not opened/i);
  assert.match(verdict.remedy, /Nothing was uploaded/);
  assert.equal(opened, false, "eligibility must decide from the name and size alone");
});

test("a file over the in-tab ceiling is refused before it is pulled into the tab", () => {
  const verdict = personalFileEligibility({ name: "everything.json", size: PERSONAL_MAX_FILE_BYTES + 1 });
  assert.equal(verdict.code, PERSONAL_ENTRY_REFUSAL.fileTooLarge);
  assert.match(verdict.remedy, /Split the export/);

  // Bytes are never fewer than characters in UTF-8, so anything under this
  // ceiling is definitely under the reader's own character ceiling and is
  // passed through rather than pre-judged.
  assert.equal(PERSONAL_MAX_FILE_BYTES, PERSONAL_READER_LIMITS.maxChars);
  assert.equal(personalFileEligibility({ name: "big.json", size: PERSONAL_MAX_FILE_BYTES }).eligible, true);
});

test("no file at all is a refusal a surface can print rather than a thrown error", () => {
  const verdict = personalFileEligibility(null);
  assert.equal(verdict.code, PERSONAL_ENTRY_REFUSAL.noFile);
  assert.equal(verdict.eligible, false);
});

/* --------------------------------- stages --------------------------------- */

test("each stage is named, positioned, and carries a word as well as a shape", () => {
  const stages = personalStageProgress("grade");
  assert.deepEqual(stages.map((stage) => stage.state), ["complete", "current", "remaining"]);
  assert.deepEqual(stages.map((stage) => stage.status), ["done", "now", "next"]);
  assert.deepEqual(stages.map((stage) => stage.position), [1, 2, 3]);
  for (const stage of stages) {
    assert.ok(stage.label && stage.detail, `${stage.id} needs a label and a detail`);
    assert.ok(stage.shape, `${stage.id} needs a shape as well as a word`);
  }
  // An unknown stage falls back to the first rather than rendering three
  // "remaining" steps with nothing in progress.
  assert.equal(personalStageProgress("nonsense")[0].state, "current");
  assert.equal(PERSONAL_READ_STAGES.length, 3);
});

/* ------------------------------- the ledger ------------------------------- */

test("a run holds the current token until something else takes one", () => {
  const ledger = createRunLedger();
  const first = ledger.start(PERSONAL_RUN_KIND.file);

  assert.equal(ledger.isCurrent(first), true);
  assert.equal(ledger.running, true);
  assert.equal(ledger.runningKind, PERSONAL_RUN_KIND.file);

  const second = ledger.start(PERSONAL_RUN_KIND.preview);
  assert.notEqual(second, first);
  assert.equal(ledger.isCurrent(first), false, "the superseded run may not paint");
  assert.equal(ledger.isCurrent(second), true);
  assert.equal(ledger.runningKind, PERSONAL_RUN_KIND.preview);
});

test("invalidating leaves no run current, so every outstanding completion is stale", () => {
  const ledger = createRunLedger();
  const running = ledger.start(PERSONAL_RUN_KIND.file);
  ledger.invalidate();

  assert.equal(ledger.isCurrent(running), false, "clear must invalidate work already in flight");
  assert.equal(ledger.running, false);
  assert.equal(ledger.runningKind, null);

  // And a second clear cannot resurrect the first token by wrapping around.
  ledger.invalidate();
  assert.equal(ledger.isCurrent(running), false);
});

test("a finished run stays current so its own result stands, and no other run's does", () => {
  const ledger = createRunLedger();
  const first = ledger.start(PERSONAL_RUN_KIND.file);
  const second = ledger.start(PERSONAL_RUN_KIND.preview);
  ledger.finish(second);

  assert.equal(ledger.running, false, "the page is idle once the current run lands");
  assert.equal(ledger.isCurrent(second), true, "the landed result is still the one on screen");
  assert.equal(ledger.isCurrent(first), false, "the superseded run stays stale after the winner lands");

  // A stale run finishing changes nothing about what is on screen.
  ledger.finish(first);
  assert.equal(ledger.isCurrent(second), true);
});

test("a token nobody was issued is never current", () => {
  const ledger = createRunLedger();
  assert.equal(ledger.isCurrent(0), false);
  assert.equal(ledger.isCurrent(undefined), false);
  ledger.start(PERSONAL_RUN_KIND.file);
  assert.equal(ledger.isCurrent(99), false);
});
