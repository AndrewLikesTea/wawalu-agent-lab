// The bundled example's next step and checkpoint, on the AI FinOps page (#1020).
//
// THE DEFECT. With no file imported, the page's two "next step" evidence layers
// were dead ends — "No journey records have been read yet, so no next step is
// recommended" in the served document, and, once painted, a step drawn from an
// invented journey fixture that named a department appearing nowhere in the
// analyzed spend beside it, over a journey block that recommended nothing at all
// and scheduled no checkpoint. Three regions, three different answers to "what
// do I do first?".
//
// WHAT THIS FILE OWNS: that there is exactly ONE first action in the bundled
// state, that it is derived rather than authored, that it carries the figure and
// the period it came from, that it schedules a checkpoint, and that the dead-end
// sentence is not on the page. The rule itself — the ranking and the tiebreak —
// is pinned against the module, not against a reading of the paint.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  NEXT_STEP_DATA_STATE, bundledFirstAction, bundledFirstActionSentence, nextStepDataState,
} from "../src/finops-bundled-next-step.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const load = async (name) =>
  JSON.parse(await readFile(new URL(`../src/${name}`, import.meta.url), "utf8"));

const DEMO_DATA = await load("evolution-demo-data.json");
const EVALUATION_FIXTURES = await load("finops-evaluation-fixtures.json");
const OVERSPEND_FIXTURE = await load("model-overspend-finding-fixture.json");
const EXAMPLE = bundledFirstAction(DEMO_DATA);

const ACTION_KEY = "shiplog.finops.monthly-department-action.v1";
const DEAD_END = "No journey records have been read yet";

async function openPage({ storage = {} } = {}) {
  const page = await loadPage(PAGE, {
    storage,
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
      "/model-overspend-finding-fixture.json": OVERSPEND_FIXTURE,
    },
  });
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  return page;
}

/** One retained monthly action, which is what an import leaves behind. */
const retained = JSON.stringify({
  schemaVersion: "monthly-department-action/1.0.0",
  decisionVersion: "monthly-department-decision/1.0.0",
  actionId: "route-short-lookups",
  actionLabel: "Route short lookups to the efficient model",
  department: "Atlas Platform",
  ownerLabel: "AI Platform product owner",
  baseline: {
    value: 1200, unit: "USD/month", period: "2026-06",
    aggregation: "Monthly eligible recoverable spend", calculation: "Sum eligible row deltas",
  },
  target: {
    value: 0, unit: "USD/month remaining avoidable spend",
    deadline: "2026-07-31", calculation: "baseline minus verified reduction",
  },
  reviewPeriod: "2026-07",
  confidence: "high",
  provenanceReferences: ["fix-pack:1"],
  committedAt: "2026-06-30T12:00:00.000Z",
});

test("the rule ranks the example's own rank-1 actions by baseline, then by id", () => {
  assert.equal(EXAMPLE.contract, "finops-bundled-next-step/1.0.0");
  assert.equal(EXAMPLE.state, NEXT_STEP_DATA_STATE.bundledExample);
  const candidates = DEMO_DATA.actionPlan.actions.filter((entry) => entry.isTopNextAction);
  const largest = Math.max(...candidates.map((entry) => entry.baseline.value));
  assert.equal(EXAMPLE.figure.value, largest,
    "the step must come from the example's largest modelled recoverable line");
  assert.equal(EXAMPLE.rank.outranked, candidates.length - 1);
  // The tiebreak is the whole reason a reordered fixture cannot move the answer.
  const tied = bundledFirstAction({
    actionPlan: {
      benchmarkPeriods: DEMO_DATA.actionPlan.benchmarkPeriods,
      actions: [...candidates].reverse().map((entry) => ({
        ...entry, baseline: { ...entry.baseline, value: 100 },
      })),
    },
  });
  assert.equal(tied.actionId,
    [...candidates].map((entry) => entry.actionId).sort()[0]);
});

test("a dataset with no rankable candidate derives nothing rather than inventing one", () => {
  assert.equal(bundledFirstAction(null), null);
  assert.equal(bundledFirstAction({ actionPlan: { actions: [] } }), null);
  assert.equal(bundledFirstAction({
    actionPlan: { actions: [{ ...DEMO_DATA.actionPlan.actions[0], baseline: null }] },
  }), null, "an action with no quotable figure is not a candidate ranked lower, it is not one");
  assert.equal(bundledFirstActionSentence(null), null);
});

test("the bundled state names exactly one step, with its department and derived figure", async () => {
  const { document } = await openPage();
  const step = document.getElementById("finops-next-step-action");
  const figure = document.getElementById("finops-next-step-impact");
  assert.equal(textOf(step), `${EXAMPLE.action} in ${EXAMPLE.department}`);
  assert.match(textOf(figure), new RegExp(EXAMPLE.figure.text.replace("$", "\\$")));
  assert.match(textOf(figure), new RegExp(EXAMPLE.figure.metricName));
  assert.match(textOf(figure), new RegExp(EXAMPLE.figure.unit),
    "a bare number in a recommendation is a number two readers quote differently");
  assert.match(textOf(figure), new RegExp(EXAMPLE.figure.period));
  // Exactly one: the region carries a single primary action, never two.
  assert.equal(document.getElementById("finops-next-step-body")
    .querySelectorAll("a.next-step-primary").length, 1);
  assert.equal(document.getElementById("finops-next-step").dataset.stepSource,
    NEXT_STEP_DATA_STATE.bundledExample);
});

test("the bundled state names the checkpoint metric and the period it is measured over", async () => {
  const { document } = await openPage();
  const checkpoint = document.getElementById("finops-journey-checkpoint");
  assert.equal(checkpoint.dataset.known, "true");
  const text = textOf(checkpoint);
  assert.match(text, new RegExp(EXAMPLE.checkpoint.metricName));
  assert.match(text, new RegExp(EXAMPLE.checkpoint.period));
  assert.match(text, new RegExp(EXAMPLE.checkpoint.expected.replace("$", "\\$")));
  assert.match(text, new RegExp(EXAMPLE.checkpoint.due));
  // …and the same checkpoint is readable in the layer above, so a reader who
  // only opens one of the two still meets it.
  assert.match(textOf(document.getElementById("finops-next-step-checkpoint")),
    new RegExp(EXAMPLE.checkpoint.metricName));
});

test("the dead-end sentence does not render anywhere in the bundled state", async () => {
  const { document } = await openPage();
  assert.equal(textOf(document.body).includes(DEAD_END), false,
    "the bundled state has a real step; it may not also claim nothing was read");
  const authored = await readFile(PAGE, "utf8");
  assert.equal(authored.includes(DEAD_END), false,
    "…and not in the served document either, which is what a reader meets before any paint");
});

test("the circulation decision and both evidence layers state one first action", async () => {
  const { document } = await openPage();
  const circulation = textOf(document.getElementById("briefing-readiness-action"));
  assert.equal(circulation, bundledFirstActionSentence(EXAMPLE));
  for (const id of ["finops-next-step-action", "finops-journey-action"]) {
    const step = textOf(document.getElementById(id));
    assert.equal(step.includes(EXAMPLE.department), true, `${id} must name the same department`);
    assert.equal(circulation.toLowerCase().includes(EXAMPLE.action.toLowerCase()), true,
      "the circulation block must state the step the evidence layers name");
    assert.equal(step.toLowerCase().includes(EXAMPLE.action.toLowerCase()), true);
  }
  // And the figure behind it is the same figure in all three.
  assert.equal(circulation.includes(EXAMPLE.figure.text), true);
  assert.equal(textOf(document.getElementById("finops-next-step-impact"))
    .includes(EXAMPLE.figure.text), true);
});

test("both layers keep their bundled-synthetic-example labelling and claim no realized saving", async () => {
  const { document } = await openPage();
  for (const id of ["finops-next-step-sample", "finops-journey-sample"]) {
    assert.match(textOf(document.getElementById(id)), /Bundled synthetic example/);
  }
  const body = textOf(document.getElementById("finops-journey-body"));
  assert.match(body, /not a realized saving/);
  assert.match(body, /recommends/);
  assert.equal(/realized savings of/.test(body), false);
});

test("an import replaces the bundled step, and a forget restores it", async () => {
  const bundled = await openPage();
  const before = textOf(bundled.document.getElementById("finops-next-step-action"));
  assert.equal(before, `${EXAMPLE.action} in ${EXAMPLE.department}`);
  bundled.restore();

  const imported = await openPage({ storage: { [ACTION_KEY]: retained } });
  const after = textOf(imported.document.getElementById("finops-next-step-action"));
  assert.notEqual(after, before, "a reader's own retained action outranks the example");
  assert.equal(imported.document.getElementById("finops-next-step").dataset.stepSource,
    NEXT_STEP_DATA_STATE.importedPeriods);
  assert.equal(textOf(imported.document.getElementById("finops-next-step-sample"))
    .includes("Your own retained records"), true);
  imported.restore();

  // Forget: the same page with that key gone is the bundled state again.
  const forgotten = await openPage();
  assert.equal(textOf(forgotten.document.getElementById("finops-next-step-action")), before);
  assert.equal(forgotten.document.getElementById("finops-journey").dataset.stepSource,
    NEXT_STEP_DATA_STATE.bundledExample);
});

test("an import that produced nothing readable is named, not silently shown the example", () => {
  assert.equal(nextStepDataState({}), NEXT_STEP_DATA_STATE.bundledExample);
  assert.equal(nextStepDataState({ restored: { currentAnalysis: { rankedDepartments: [] } } }),
    NEXT_STEP_DATA_STATE.importedEmpty,
    "an empty ranked list is an import with nothing in it, not an absence of one");
  assert.equal(nextStepDataState({ restored: { currentAnalysis: { rankedDepartments: [{}] } } }),
    NEXT_STEP_DATA_STATE.importedPeriods);
  assert.equal(nextStepDataState({ retainedAction: {} }), NEXT_STEP_DATA_STATE.importedPeriods);
});
