// The first-run literacy letter: is it reproducible, and does any prompt leak?
//
// Two properties are worth more here than any assertion about the letter itself.
//
// REPRODUCIBILITY. A score an executive reads has to be the same score the next
// time anyone looks. The scoring path walks a Map of category tallies, a Set of
// graded department names, and a sort over departments — three places where an
// insertion-order or iteration-order dependency would produce a stable-looking
// number that quietly moves when the input order changes. So the scoring runs
// twice in-process and is compared byte for byte, and a third time over a
// reversed department list, which is what actually catches the ordering bug.
//
// REDACTION. `example-conversation-corpus.js` writes real prompt sentences into
// delimited bytes. They exist for the length of one parse. This file takes the
// corpus text it generates, pulls the message column out of it, and asserts that
// no substring of any prompt reaches the composed slot, the rendered DOM, or the
// briefing export payload — checked against the generated text rather than
// against a list typed here, so a template added later is covered automatically.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHtml, textOf } from "./support/browser.js";
import { applyFirstRunResult } from "../src/finops-first-run-view.js";
import { buildFirstRunResult, FIRST_RUN_IDS } from "../src/finops-first-run.js";
import {
  composeFirstRunLiteracy, LITERACY_UNAVAILABLE,
} from "../src/finops-first-run-literacy.js";
import {
  CORPUS_COLUMNS, CORPUS_PLAN, CORPUS_PROMPT_COUNT, exampleConversationCorpusText,
} from "../src/example-conversation-corpus.js";
import { loadExampleDataset } from "../src/example-dataset.js";
import { RUBRIC_VERSION_ID } from "../src/prompt-literacy-scoring.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

const analysis = () => loadExampleDataset();
const departmentsOf = (envelope) => envelope.rankedDepartments
  .map((department) => ({ id: department.id, name: department.name }));

/** Every distinct prompt sentence the corpus writes, read back out of its bytes. */
function corpusPrompts(departments) {
  const lines = exampleConversationCorpusText(departments).trim().split("\n");
  const column = CORPUS_COLUMNS.indexOf("message_text");
  const prompts = new Set();
  for (const line of lines.slice(1)) {
    // The message column is last and is the only quoted one, so this split is
    // exact for this corpus. A future column with a comma in it would break the
    // read loudly here rather than silently weaken the assertions below.
    const cells = line.split(",");
    const raw = cells.slice(column).join(",");
    prompts.add(raw.startsWith("\"") ? raw.slice(1, -1).replace(/""/g, "\"") : raw);
  }
  return [...prompts];
}

// --- reproducibility -------------------------------------------------------

test("the same corpus and rubric version produce a byte-identical letter twice over", () => {
  const envelope = analysis();
  const first = composeFirstRunLiteracy(envelope);
  const second = composeFirstRunLiteracy(envelope);

  assert.equal(first.available, true, "the bundled corpus produced no letter at all");
  // Compared as serialized bytes, not field by field: a field added later is
  // covered without anyone remembering to add it to a list.
  assert.equal(JSON.stringify(second), JSON.stringify(first),
    "two runs of the same corpus disagreed");

  // A third run over a re-ordered department list. The letter is a roll-up over
  // a Map of tallies and a Set of graded names, and if either one's iteration
  // order reached the arithmetic, this is the run that would move.
  const reversed = composeFirstRunLiteracy({
    ...envelope, rankedDepartments: [...envelope.rankedDepartments].reverse(),
  });
  assert.equal(reversed.grade, first.grade);
  assert.equal(reversed.score, first.score);
  assert.equal(reversed.coveredUsd, first.coveredUsd);
  assert.equal(reversed.totalUsd, first.totalUsd);
  assert.equal(reversed.coverageTier, first.coverageTier);
});

test("the corpus itself is byte-identical across runs and carries no clock", async () => {
  const departments = departmentsOf(analysis());
  assert.equal(exampleConversationCorpusText(departments), exampleConversationCorpusText(departments));
  const source = await readFile(new URL("../src/example-conversation-corpus.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Math\.random|Date\.now|new Date\(/,
    "a generated fixture that reads a clock or a PRNG is not reproducible");
});

// --- the figures a director would dispute -----------------------------------

test("the letter uses reader vocabulary while retaining its attributable rubric id", () => {
  const literacy = composeFirstRunLiteracy(analysis());
  assert.match(literacy.value, /· published literacy rubric$/);
  assert.equal(literacy.rubricVersionId, RUBRIC_VERSION_ID);
  assert.match(literacy.value, /^[A-F] · \d{1,3} of 100 · /);
});

test("the coverage line states scored dollars, in-scope dollars, and the tier", () => {
  const envelope = analysis();
  const literacy = composeFirstRunLiteracy(envelope);
  const total = envelope.rankedDepartments.reduce((sum, d) => sum + d.spendUsd, 0);

  assert.equal(literacy.totalUsd, total, "the denominator is not the analyzed spend");
  assert.ok(literacy.coveredUsd > 0 && literacy.coveredUsd < literacy.totalUsd,
    "the example must show a real gap between scored and in-scope spend, or the "
    + "coverage figure demonstrates nothing");
  // A clear majority, so the letter is worth showing at all; the tier is read
  // from grade-eligibility.js's published floors rather than restated here.
  assert.ok(literacy.coverageRatio > 0.8);
  assert.equal(literacy.coverageTier, "high");
  assert.match(literacy.detail,
    /^\$[\d,]+ of \$[\d,]+ in-scope invented spend was scored — high coverage/);
  assert.match(literacy.detail, /\d+ of \d+ invented departments/);
});

test("a department under the minimum sample is counted, never partially credited", () => {
  const envelope = analysis();
  const literacy = composeFirstRunLiteracy(envelope);
  // The plan deliberately ships one department below the five-prompt floor, so
  // the corpus proves the "sampled but not graded" case rather than only the
  // happy one. Its spend must be missing from the numerator and present in the
  // denominator; anything else is partial credit by another name.
  assert.equal(literacy.departmentsGraded, literacy.departmentsTotal - 1);
  assert.ok(literacy.promptsScored < literacy.promptsTotal);
  assert.equal(literacy.promptsTotal, CORPUS_PROMPT_COUNT);
  const starved = CORPUS_PLAN.filter((plan) => plan.mix.reduce((a, b) => a + b, 0) < 5);
  assert.equal(starved.length, 1, "the plan no longer ships an under-sampled department");
});

test("every plan row states the assumption its mix encodes", () => {
  for (const plan of CORPUS_PLAN) {
    assert.ok(plan.why && plan.why.length > 40,
      `${plan.unitId} carries a mix with no stated reason behind it`);
  }
});

test("an analysis with no departments withholds the letter with a reason, not a dash", () => {
  const withheld = composeFirstRunLiteracy({ rankedDepartments: [] });
  assert.equal(withheld.available, false);
  assert.equal(withheld.value, LITERACY_UNAVAILABLE.noDepartments);
  assert.equal(withheld.grade, null);
  assert.doesNotMatch(withheld.value, /^[—-]$/);
});

test("a scoring path that throws degrades to a labelled slot rather than a blank", () => {
  const withheld = composeFirstRunLiteracy(analysis(), () => {
    throw new TypeError("the corpus could not be read");
  });
  assert.equal(withheld.available, false);
  assert.equal(withheld.value, LITERACY_UNAVAILABLE.failed);
});

// --- redaction --------------------------------------------------------------

test("no fixture prompt substring reaches the composed slot, the DOM, or an export", async () => {
  const envelope = analysis();
  const prompts = corpusPrompts(departmentsOf(envelope));
  assert.ok(prompts.length >= 4, "the corpus wrote fewer prompt shapes than it has categories");

  const result = buildFirstRunResult();
  const document = parseHtml(await readFile(PAGE, "utf8"));
  applyFirstRunResult(document, result, { announce: true });

  // The whole region's rendered text, the whole composed result serialized, and
  // the authored markup, checked against every prompt the corpus wrote.
  const rendered = textOf(document.getElementById(FIRST_RUN_IDS.region));
  const serialized = JSON.stringify(result);
  const markup = await readFile(PAGE, "utf8");

  for (const prompt of prompts) {
    // The whole sentence, and the distinctive fragment inside it. A leak that
    // truncated the prompt would pass a whole-string check.
    for (const needle of [prompt, prompt.slice(0, 24)]) {
      assert.ok(!rendered.includes(needle), `a prompt reached the DOM: ${JSON.stringify(needle)}`);
      assert.ok(!serialized.includes(needle), `a prompt reached the result: ${JSON.stringify(needle)}`);
      assert.ok(!markup.includes(needle), `a prompt was authored into the page: ${JSON.stringify(needle)}`);
    }
  }

  // The invented actor addresses are not prompt text, but they are the other
  // free-form column in the corpus and must not travel either.
  assert.ok(!rendered.includes("@example.invalid"));
  assert.ok(!serialized.includes("@example.invalid"));
});

test("the composed slot carries no free-form field a prompt could ride out in", () => {
  const literacy = composeFirstRunLiteracy(analysis());
  // Every string this slot publishes is either authored in this repository or
  // assembled from a count, a dollar figure, a letter, or a rubric label. The
  // check is structural: no value in it may be an object or an array, because a
  // nested field is where an upstream record would hide.
  for (const [key, value] of Object.entries(literacy)) {
    assert.ok(value === null || ["string", "number", "boolean"].includes(typeof value),
      `literacy.${key} is a ${typeof value}; a nested field can carry a record out`);
  }
});
