// The scorer, wired into the drill-down a leader actually clicks.
//
// The unit tests prove the rule. This proves the wiring: the shipped markup of
// `src/evolution.html`, the real page entry, the real bundled fixture, and a
// real click on a department button in the priority list.
//
// Two departments, because the surface has to keep doing two different things:
//
//   - one whose fixture carries a reviewed intervention, which must render
//     exactly as it did before this change — the scorer is a fallback, not a
//     replacement, and a reviewed result is never overwritten by a computed one;
//   - one whose fixture carries none, where the twelve slots used to read
//     "Result unavailable" and now carry the scorer's answer.
//
// Nothing here asserts a dollar figure by transcribing it. Every number the page
// is expected to paint is derived from the scorer in the test, so a weight change
// moves the expectation and the assertion together and this file cannot silently
// bless a number nobody recomputed.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { scoreDepartmentIntervention } from "../src/department-intervention-scoring.js";
import { interventionActionFields } from "../src/department-intervention-view.js";
import { INTERVENTION_REDACTION_STATEMENT } from "../src/department-intervention-scoring.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const load = async (name) => JSON.parse(await readFile(new URL(`../src/${name}`, import.meta.url), "utf8"));

const DEMO_DATA = await load("evolution-demo-data.json");
const EVALUATION_FIXTURES = await load("finops-evaluation-fixtures.json");
const OVERSPEND_FIXTURE = await load("model-overspend-finding-fixture.json");

/** The department whose fixture deliberately has no reviewed intervention. */
const UNREVIEWED = DEMO_DATA.departments.find(
  (department) => department.actionPlan?.status === "unavailable");
/** One that does, so the reviewed path stays covered by the same run. */
const REVIEWED = DEMO_DATA.departments.find(
  (department) => department.actionPlan?.status === "completed");

async function openPage(data = DEMO_DATA) {
  const page = await loadPage(PAGE, {
    routes: {
      "/evolution-demo-data.json": data,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
      "/model-overspend-finding-fixture.json": OVERSPEND_FIXTURE,
    },
  });
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  return page.document;
}

/** Click the priority-list entry for one department, the way a reader does. */
function drillInto(document, departmentId) {
  const button = [...document.getElementById("department-priority").querySelectorAll("button")]
    .find((candidate) => candidate.dataset.departmentId === departmentId);
  assert.ok(button, `no priority-list button for ${departmentId}`);
  button.click();
  return button;
}

const shown = (document, id) => textOf(document.getElementById(id));

test("the fixture still contains both a reviewed and an unreviewed department", () => {
  // If this ever fails the bundled data changed, and the two tests below are
  // asserting nothing rather than failing honestly.
  assert.ok(UNREVIEWED, "no department without a reviewed intervention");
  assert.ok(REVIEWED, "no department with a reviewed intervention");
});

test("a department with no reviewed intervention gets the computed answer", async () => {
  const document = await openPage();
  drillInto(document, UNREVIEWED.id);

  const expected = interventionActionFields(scoreDepartmentIntervention(UNREVIEWED));
  assert.equal(shown(document, "detail-name"), UNREVIEWED.name);
  assert.equal(shown(document, "action-status"), expected.status);
  assert.equal(shown(document, "action-title"), expected.title);
  assert.equal(shown(document, "action-rationale"), expected.rationale);
  assert.equal(shown(document, "action-impact"), expected.impact);
  assert.equal(shown(document, "action-confidence"), expected.confidence);
  assert.equal(shown(document, "action-owner"), expected.owner);
  assert.equal(shown(document, "action-provenance"), expected.provenance);
  assert.equal(shown(document, "action-estimate"), expected.estimate);
  assert.equal(shown(document, "action-realized"), expected.realized);
  assert.equal(shown(document, "action-diagnosis"), expected.diagnosis);
  assert.equal(document.getElementById("action-result").dataset.status, expected.dataStatus);

  // This department's sample is unmeasured, so the surface must be refusing to
  // score rather than publishing a quiet, tiny number.
  assert.equal(scoreDepartmentIntervention(UNREVIEWED).outcome, "insufficient_evidence");
  assert.equal(shown(document, "action-estimate"), "Unavailable");
});

test("the reviewed intervention is never overwritten by a computed one", async () => {
  const document = await openPage();
  drillInto(document, REVIEWED.id);

  assert.equal(shown(document, "detail-name"), REVIEWED.name);
  assert.equal(shown(document, "action-title"), REVIEWED.actionPlan.title);
  assert.equal(shown(document, "action-rationale"), REVIEWED.actionPlan.rationale);
  assert.equal(shown(document, "action-diagnosis"), REVIEWED.actionPlan.diagnosis);
  assert.equal(document.getElementById("action-result").dataset.status, "completed");
  // And nothing of the computed vocabulary leaks into the reviewed reading.
  assert.doesNotMatch(shown(document, "action-status"), /Computed recommendation/);
});

const PAINTED_SLOTS = ["action-status", "action-title", "action-rationale", "action-impact",
  "action-confidence", "action-owner", "action-provenance", "action-baseline",
  "action-target", "action-estimate", "action-realized", "action-diagnosis"];

test("prompt text in the bundled record cannot reach a painted field", async () => {
  const sentinel = "SENTINEL-PROMPT-BODY-4d71";
  // The record a compromised or careless upstream would hand this page: prompt
  // bodies hung off the department, its mix, its sampling block and its
  // evidence. The scorer's allowlist is what stops any of it being painted.
  const polluted = {
    ...DEMO_DATA,
    departments: DEMO_DATA.departments.map((department) => (department.id !== UNREVIEWED.id
      ? department
      : {
        ...department,
        promptText: sentinel,
        excerpt: sentinel,
        mix: { ...department.mix, lastPrompt: sentinel },
        sampling: { ...department.sampling, transcript: sentinel },
        patterns: { repeatedShapeShare: 0.5, sampleQuery: sentinel },
      })),
  };

  const document = await openPage(polluted);
  drillInto(document, UNREVIEWED.id);

  const painted = PAINTED_SLOTS.map((id) => shown(document, id)).join(" ");
  assert.equal(painted.includes(sentinel), false);
  // The promise is painted alongside the numbers, in this state as in any other.
  assert.ok(shown(document, "action-provenance").includes(INTERVENTION_REDACTION_STATEMENT));
});
