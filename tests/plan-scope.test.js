// The plan beside the diagnosis (#1286).
//
// What this file exists to catch is a section that starts LOOKING like a plan
// before anyone has made one:
//
//   * a planned figure that is anything other than exactly $0 with nothing
//     committed — including one quietly copied from the recoverable headline.
//   * a grade appearing where there is nothing to grade, or a fabricated "N/A"
//     that reads like a computed result.
//   * an honesty label coined here instead of taken from the rate-card ladder
//     the page already ships.
//   * a move on the slate that this section does not enumerate, or a lever
//     whose unit or default-when-silent is only in a code comment.
//   * more than one next action, or none.
//   * a lever control without a programmatic label, or one painted OUTSIDE the
//     collapsed disclosure, where it would take a tab stop on the first screen.
//     What those controls DO when moved is tests/plan-scope-levers.test.js.
//
// It drives the real markup from src/evolution.html and the real slate from the
// bundled example, which is the state a lead lands in.

import assert from "node:assert/strict";
import test from "node:test";

import { loadExampleDataset } from "../src/example-dataset.js";
import { CONFIDENCE_TIERS } from "../src/finops-rate-card-contract.js";
import {
  PLAN_GRADE_CEILING, PLAN_LEVERS, PLAN_SCOPE_QUESTION, PLAN_VS_DIAGNOSIS, planMoveKey, planScope,
} from "../src/plan-scope.js";
import { PLAN_SCOPE_DETAIL_SUMMARY, applyPlanScope } from "../src/plan-scope-view.js";
import { routingSlate } from "../src/routing-slate.js";
import { loadPage, textOf } from "./support/browser.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

const bundledSlate = () => routingSlate(loadExampleDataset());

// ---------------------------------------------------------------------------
// 1. The empty plan, which is the whole of what ships.
// ---------------------------------------------------------------------------

test("with nothing committed the planned figure is exactly $0", () => {
  const slate = bundledSlate();
  assert.ok(slate.rules.length > 0, "the bundled example must model at least one move");
  const model = planScope(slate);
  assert.equal(model.committedCount, 0);
  assert.equal(model.plannedMonthlyUsd, 0);
  // Not the diagnosis above it, which is a much larger number on the same page.
  assert.notEqual(model.plannedMonthlyUsd, slate.totalExpectedMonthlyUsd);
  for (const move of model.moves) assert.equal(move.plannedMonthlyUsd, 0);
});

test("no grade is emitted at all when nothing is committed", () => {
  const model = planScope(bundledSlate());
  assert.equal(model.grade, null, "an absent grade is not a passing one");
  assert.ok(model.gradeAbsentReason.length > 0, "the absence must be stated, not silent");
});

test("every move on the shipped slate appears with all three levers and their defaults", () => {
  const slate = bundledSlate();
  const model = planScope(slate);
  assert.equal(model.moves.length, slate.rules.length);
  for (const rule of slate.rules) {
    const move = model.moves.find((entry) => entry.key === planMoveKey(rule));
    assert.ok(move, `the slate's rule ${planMoveKey(rule)} must be enumerated here`);
    assert.equal(move.modelledMonthlyUsd, rule.expectedMonthlyUsd);
    assert.equal(move.levers.length, 3);
    assert.deepEqual(move.levers.map((lever) => lever.key),
      PLAN_LEVERS.map((lever) => lever.key));
    for (const lever of move.levers) {
      assert.equal(lever.stated, false, "silence is the shipped state of every lever");
      assert.equal(lever.value, 0, "an unstated lever counts as zero, never as all traffic");
      assert.ok(lever.unit.length > 0, `${lever.key} must carry a unit`);
      assert.ok(lever.defaultWhenSilent.length > 0, `${lever.key} must state its default`);
    }
  }
});

test("exactly one next action, phrased as an instruction", () => {
  const model = planScope(bundledSlate());
  assert.equal(typeof model.nextAction, "string");
  assert.ok(model.nextAction.startsWith("Ask "), model.nextAction);
  assert.equal(model.nextAction.split(". ").length, 1, "one sentence, not a list of asks");
});

// ---------------------------------------------------------------------------
// 2. The arithmetic, so two engineers compute the same figure.
// ---------------------------------------------------------------------------

test("a committed move counts its share of the modelled figure, after exclusions", () => {
  const slate = bundledSlate();
  const rule = slate.rules[0];
  const model = planScope(slate, {
    commitments: [{
      move: planMoveKey(rule),
      owner: "Atlas Platform",
      reroutedSharePct: 50,
      eligibleWorkloads: 4,
      excludedWorkloads: 1,
      eligibleTeams: 2,
      refusingTeams: 1,
    }],
  });
  // modelled x 0.5 x (3/4) x (1/2), truncated toward zero.
  const expected = Math.trunc(rule.expectedMonthlyUsd * 0.5 * 0.75 * 0.5);
  assert.equal(model.plannedMonthlyUsd, expected);
  assert.equal(model.committedCount, 1);
});

test("a committed move that states no share plans nothing", () => {
  const slate = bundledSlate();
  const model = planScope(slate, {
    commitments: [{ move: planMoveKey(slate.rules[0]), owner: "Atlas Platform" }],
  });
  assert.equal(model.plannedMonthlyUsd, 0, "unstated scope is zero, not all traffic");
  assert.equal(model.moves[0].fullyScoped, false);
});

test("the honesty label is the rate-card ladder's own weakest rung", () => {
  const slate = bundledSlate();
  const model = planScope(slate, {
    commitments: [{
      move: planMoveKey(slate.rules[0]),
      reroutedSharePct: 100,
      excludedWorkloads: 0,
      refusingTeams: 0,
    }],
  });
  assert.equal(model.grade, CONFIDENCE_TIERS[0]);
  assert.equal(PLAN_GRADE_CEILING, CONFIDENCE_TIERS[0]);
  assert.ok(model.gradeRequirement.includes(CONFIDENCE_TIERS[0].marker));
  assert.ok(model.gradeRequirement.includes(CONFIDENCE_TIERS[0].label));
});

test("an empty slate yields $0 planned and an action that is still one instruction", () => {
  const model = planScope(null);
  assert.equal(model.plannedMonthlyUsd, 0);
  assert.equal(model.moves.length, 0);
  assert.equal(model.grade, null);
  assert.ok(model.nextAction.startsWith("Read "), model.nextAction);
});

// ---------------------------------------------------------------------------
// 3. The shipped page renders it, above the slate and outside the disclosure.
// ---------------------------------------------------------------------------

test("the section is authored on the page, above the routing slate", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  const section = document.getElementById("plan-scope");
  assert.ok(section, "the section must be authored in evolution.html");
  assert.equal(textOf(document.getElementById("plan-scope-title")), PLAN_SCOPE_QUESTION);
  assert.equal(section.getAttribute("data-workspace-region"), "act-and-verify");
  const ids = [...document.getElementById("main-content").children]
    .filter((node) => node.nodeType === 1 && node.id).map((node) => node.id);
  assert.ok(ids.indexOf("plan-scope") < ids.indexOf("routing-slate"),
    "the plan is read before the ranking it is a plan over");
});

test("the lead states the number, the distinction and one action, outside the disclosure",
  async () => {
    const { document } = await loadPage(PAGE, { scripts: false });
    const model = applyPlanScope(document, bundledSlate());
    const section = document.getElementById("plan-scope");
    assert.equal(section.dataset.state, "empty");
    assert.equal(section.dataset.committedCount, "0");
    assert.equal(section.dataset.moveCount, String(model.moves.length));

    const figure = textOf(document.getElementById("plan-scope-figure"));
    assert.ok(figure.includes("$0 planned"), figure);
    assert.equal(textOf(document.getElementById("plan-scope-distinction")), PLAN_VS_DIAGNOSIS);
    const action = textOf(document.getElementById("plan-scope-action"));
    assert.equal(action, `Do this first: ${model.nextAction}`);
    // One action, and one only: `answer-figure-direction` is the class the
    // instruction is painted in, and this section prints exactly one.
    const directions = document.getElementById("plan-scope-body")
      .querySelectorAll(".answer-figure-direction");
    assert.equal(directions.length, 1);
    // The status line is a sibling of the body, never inside the disclosure.
    const status = document.getElementById("plan-scope-status");
    assert.equal(status.getAttribute("role"), "status");
    assert.equal(status.parentNode.id, "plan-scope");
    assert.ok(textOf(status).includes("$0 planned"), textOf(status));
  });

test("the grade line states an absence rather than a score", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  applyPlanScope(document, bundledSlate());
  const grade = document.getElementById("plan-scope-grade");
  assert.equal(grade.dataset.grade, "absent");
  const text = textOf(grade);
  assert.ok(!text.includes("N/A"), "a fabricated N/A reads like a computed result");
  // The facts required to earn a stronger label are named in the copy.
  assert.ok(text.includes(CONFIDENCE_TIERS[0].marker), text);
  assert.ok(text.includes("re-routed traffic share"), text);
  assert.ok(text.includes("excluded"), text);
  assert.ok(text.includes("refused"), text);
});

test("every move's levers, units and defaults are rendered, one row each", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  const model = applyPlanScope(document, bundledSlate());
  // Scoped through the body element rather than a descendant selector: this
  // harness parses one compound selector and throws on "a b".
  const body = document.getElementById("plan-scope-body");
  const details = body.querySelectorAll("details");
  // Two, and only two: the levers, and the evidence grade's own rule list
  // (#1289). Each one is identified by what it holds rather than by position.
  assert.equal(details.length, 2, "the levers and the evidence rules, one disclosure each");
  const moveDetail = details.find((node) => node.dataset.moveCount !== undefined);
  const rules = details.find((node) => node.id === "plan-evidence-grade-detail");
  assert.ok(moveDetail && rules, "both disclosures must be identifiable");
  assert.equal(moveDetail.dataset.moveCount, String(model.moves.length));
  assert.ok(!moveDetail.hasAttribute("open"), "the per-move detail is collapsed by default");
  assert.ok(!rules.hasAttribute("open"), "the rule detail is collapsed by default");
  const summaries = body.querySelectorAll("summary");
  assert.equal(summaries.length, 2, "the section adds exactly two tab stops, both below the fold");
  for (const summary of summaries) assert.equal(summary.getAttribute("aria-expanded"), "false");
  assert.ok(summaries.some((node) => textOf(node).startsWith(PLAN_SCOPE_DETAIL_SUMMARY)));

  const rows = body.querySelectorAll("li");
  const levers = rows.filter((node) => node.dataset.lever);
  assert.equal(levers.length, model.moves.length * 3);
  for (const lever of PLAN_LEVERS) {
    const mine = levers.filter((node) => node.dataset.lever === lever.key);
    assert.equal(mine.length, model.moves.length);
    for (const node of mine) {
      assert.equal(node.dataset.stated, "false");
      const text = textOf(node);
      assert.ok(text.includes(lever.name), text);
      assert.ok(text.includes(lever.unit), text);
      assert.ok(text.includes(lever.defaultWhenSilent), text);
    }
  }
  const moveRows = rows.filter((node) => node.dataset.move);
  assert.equal(moveRows.length, model.moves.length);
});

test("every lever control is labelled, and all of them sit inside the disclosure",
  async () => {
    const { document } = await loadPage(PAGE, { scripts: false });
    const model = applyPlanScope(document, bundledSlate());
    const section = document.getElementById("plan-scope");
    const controls = section.querySelectorAll("input,select,textarea");
    // Four levers a move: in or out, the feasible share, the excluded workloads,
    // and the refusal.
    assert.equal(controls.length, model.moves.length * 4);

    const labelFor = new Map(section.querySelectorAll("label")
      .map((label) => [label.getAttribute("for"), label]));
    for (const control of controls) {
      assert.ok(control.id, "every control needs an id its label can name");
      const label = labelFor.get(control.id);
      assert.ok(label, `${control.id} has no label tied to it by for/id`);
      assert.ok(textOf(label).length > 0, `${control.id}'s label says nothing`);
      // Walked upward rather than matched with a descendant selector, which this
      // harness rejects: no control may sit outside the collapsed disclosure.
      let node = control;
      while (node && node.tagName !== "DETAILS") node = node.parentNode;
      assert.ok(node, `${control.id} is painted outside the disclosure, on the tab order`);
    }
    // The share field is a TEXT field on purpose: a number field reports an
    // empty value for anything it cannot parse, which would swallow a lead's
    // entry instead of refusing it. Its range is in its label, and its keypad
    // is declared through inputmode.
    const shares = controls.filter((control) => control.id.endsWith("-share"));
    assert.equal(shares.length, model.moves.length);
    for (const share of shares) {
      assert.equal(share.type, "text");
      assert.equal(share.getAttribute("inputmode"), "numeric");
      assert.ok(textOf(labelFor.get(share.id)).includes("0 to 100"),
        textOf(labelFor.get(share.id)));
    }
  });
