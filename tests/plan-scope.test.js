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
//   * a control. There is nothing to fill in on this surface, by design.
//
// It drives the real markup from src/evolution.html and the real slate from the
// bundled example, which is the state a lead lands in.

import assert from "node:assert/strict";
import test from "node:test";

import { loadExampleDataset } from "../src/example-dataset.js";
import { formatUsd } from "../src/evolution.js";
import { CONFIDENCE_TIERS } from "../src/finops-rate-card-contract.js";
import {
  PLAN_GRADE_CEILING, PLAN_LEVERS, PLAN_SCOPE_QUESTION, PLAN_SHARE_FIELD_NAME, PLAN_SHARE_MAX,
  PLAN_SHARE_MIN, PLAN_VS_DIAGNOSIS, planEntryCommitment, planMoveKey, planScope,
} from "../src/plan-scope.js";
import {
  PLAN_SCOPE_DETAIL_SUMMARY, applyPlanScope, planControlId,
} from "../src/plan-scope-view.js";
import { routingSlate } from "../src/routing-slate.js";
import { DomEvent, loadPage, tabSequence, textOf } from "./support/browser.js";

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
  assert.equal(details.length, 1, "one disclosure, holding every move's levers");
  assert.equal(details[0].dataset.moveCount, String(model.moves.length));
  assert.ok(!details[0].hasAttribute("open"), "the per-move detail is collapsed by default");
  const summaries = body.querySelectorAll("summary");
  assert.equal(summaries.length, 1, "the section adds exactly one tab stop");
  assert.equal(summaries[0].getAttribute("aria-expanded"), "false");
  assert.ok(textOf(summaries[0]).startsWith(PLAN_SCOPE_DETAIL_SUMMARY));

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

// ---------------------------------------------------------------------------
// 4. The levers (#1288). #1286 shipped this section with no control at all,
//    which is why the assertion that used to stand here — "the section adds no
//    control a reader could fill in" — is superseded by the label test below
//    rather than deleted: the rule it protected (nothing here may be
//    unreachable or unlabelled) is the rule these tests now carry.
//
//    What they exist to catch: a figure, a count and an action that update out
//    of step; a refusal that costs a lead something they typed; a scope that
//    evaporates when a move leaves the plan; and a control a keyboard or a
//    screen reader cannot use.
// ---------------------------------------------------------------------------

/** Paint the section with a fresh session state, and hand back both. */
async function paintPlan() {
  const page = await loadPage(PAGE);
  const slate = bundledSlate();
  const entries = new Map();
  const model = applyPlanScope(page.document, slate, { entries });
  return { document: page.document, slate, entries, model };
}

const controlById = (document, id) => document.getElementById(id);

/** What the page currently says, as the three figures that must move together. */
const shownPlan = (document) => ({
  total: textOf(document.getElementById("plan-scope-figure")),
  committed: textOf(document.getElementById("plan-scope-committed")),
  action: textOf(document.getElementById("plan-scope-action")),
  status: textOf(document.getElementById("plan-scope-status")),
});

/** Type into a control the way the harness's keyboard does, event and all. */
function enter(document, id, value) {
  const control = controlById(document, id);
  control.value = value;
  control.dispatchEvent(new DomEvent("input", { bubbles: true }));
  return control;
}

test("changing a lever moves the total, the committed count and the next action together",
  async () => {
    const { document, slate, model } = await paintPlan();
    const before = shownPlan(document);
    assert.ok(before.total.includes("$0 planned"), before.total);
    assert.ok(before.committed.startsWith("0 of "), before.committed);

    controlById(document, planControlId(0, "commit")).click();
    enter(document, planControlId(0, "share"), "50");

    // The expected figures come from the shipped computation, not from this
    // test's own arithmetic: a view that drifted from the module would show a
    // number this assertion never has to know.
    const expected = planScope(slate, {
      commitments: [planEntryCommitment(model.moves[0].key,
        { committed: true, reroutedSharePct: 50, excludedWorkloads: "", teamRefuses: false })],
    });
    assert.ok(expected.plannedMonthlyUsd > 0, "the first bundled move must plan real dollars");

    const after = shownPlan(document);
    assert.ok(after.total.includes(`${formatUsd(expected.plannedMonthlyUsd)} planned`), after.total);
    assert.ok(after.committed.startsWith("1 of "), after.committed);
    assert.equal(after.action, `Do this first: ${expected.nextAction}`);
    assert.notEqual(after.action, before.action, "the ask must move on to the next open move");
    // The announcement is the page's existing status line, and it carries the
    // same figures in the same pass.
    assert.ok(after.status.includes(formatUsd(expected.plannedMonthlyUsd)), after.status);
    assert.equal(document.getElementById("plan-scope").dataset.committedCount, "1");
    assert.equal(document.getElementById("plan-scope-grade").dataset.grade,
      expected.grade.tier);
  });

test("marking the team as refusing takes that move's planned dollars to zero", async () => {
  const { document } = await paintPlan();
  controlById(document, planControlId(0, "commit")).click();
  enter(document, planControlId(0, "share"), "100");
  const withShare = shownPlan(document);
  assert.ok(!withShare.total.includes("$0 planned"), withShare.total);

  controlById(document, planControlId(0, "refusing")).click();
  const refused = shownPlan(document);
  assert.ok(refused.total.includes("$0 planned"), refused.total);
  assert.ok(refused.committed.startsWith("1 of "),
    "a refused move is still committed — the plan states it and plans $0 of it");
});

test("an out-of-range share is refused, naming the field and the range, and costs nothing else",
  async () => {
    const { document, entries, model } = await paintPlan();
    // A second move committed, and a first move fully entered, so a refusal has
    // something to lose.
    controlById(document, planControlId(0, "commit")).click();
    controlById(document, planControlId(1, "commit")).click();
    enter(document, planControlId(0, "share"), "40");
    enter(document, planControlId(0, "exclusions"), "nightly batch, staging replay");
    controlById(document, planControlId(0, "refusing")).click();
    const before = shownPlan(document);

    enter(document, planControlId(0, "share"), "150");

    const error = document.getElementById(planControlId(0, "share-error"));
    assert.equal(error.hidden, false, "the refusal has to be visible, not just modelled");
    const message = textOf(error);
    assert.ok(message.includes(PLAN_SHARE_FIELD_NAME), message);
    assert.ok(message.includes(String(PLAN_SHARE_MIN)) && message.includes(String(PLAN_SHARE_MAX)),
      message);
    assert.equal(controlById(document, planControlId(0, "share")).getAttribute("aria-invalid"),
      "true");

    // Everything else the lead entered survives, in the state model and on screen.
    const entry = entries.get(model.moves[0].key);
    assert.equal(entry.reroutedSharePct, 40, "the refused value never reached the model");
    assert.equal(entry.excludedWorkloads, "nightly batch, staging replay");
    assert.equal(entry.teamRefuses, true);
    assert.equal(controlById(document, planControlId(0, "exclusions")).value,
      "nightly batch, staging replay");
    assert.equal(controlById(document, planControlId(1, "commit")).checked, true);
    assert.deepEqual(shownPlan(document), before, "a refusal re-renders nothing");
    // The lead's own keystrokes stay in the field they typed them into.
    assert.equal(controlById(document, planControlId(0, "share")).value, "150");
  });

test("a non-numeric share is refused in the same words, and the plan is unchanged", async () => {
  const { document, entries, model } = await paintPlan();
  controlById(document, planControlId(0, "commit")).click();
  enter(document, planControlId(0, "share"), "25");
  const before = shownPlan(document);

  enter(document, planControlId(0, "share"), "one third");
  const message = textOf(document.getElementById(planControlId(0, "share-error")));
  assert.ok(message.includes(PLAN_SHARE_FIELD_NAME), message);
  assert.ok(message.includes(String(PLAN_SHARE_MAX)), message);
  assert.equal(entries.get(model.moves[0].key).reroutedSharePct, 25);
  assert.deepEqual(shownPlan(document), before);

  // And a value the check accepts clears the refusal rather than leaving it up.
  enter(document, planControlId(0, "share"), "30");
  assert.equal(document.getElementById(planControlId(0, "share-error")).hidden, true);
  assert.equal(controlById(document, planControlId(0, "share")).getAttribute("aria-invalid"),
    "false");
  assert.notDeepEqual(shownPlan(document), before);
});

test("an empty share is silence, not a refusal, and counts as the stated default", async () => {
  const { document } = await paintPlan();
  controlById(document, planControlId(0, "commit")).click();
  enter(document, planControlId(0, "share"), "60");
  enter(document, planControlId(0, "share"), "");
  assert.equal(document.getElementById(planControlId(0, "share-error")).hidden, true);
  assert.ok(shownPlan(document).total.includes("$0 planned"),
    "an unstated scope counts as zero, never as all traffic");
});

test("taking a move out of the plan and putting it back restores the scope entered", async () => {
  const { document, slate, entries, model } = await paintPlan();
  const key = model.moves[0].key;
  controlById(document, planControlId(0, "commit")).click();
  enter(document, planControlId(0, "share"), "45");
  enter(document, planControlId(0, "exclusions"), "billing, nightly batch");
  const committed = shownPlan(document);

  controlById(document, planControlId(0, "commit")).click();
  assert.ok(shownPlan(document).total.includes("$0 planned"), "removed means removed");
  assert.equal(entries.get(key).reroutedSharePct, 45, "the scope is retained in the state model");

  // Repaint the whole section, which rebuilds every node: the retained scope is
  // in the page's state, not in the DOM of a node that no longer exists.
  applyPlanScope(document, slate, { entries });
  assert.equal(controlById(document, planControlId(0, "share")).value, "45");
  assert.equal(controlById(document, planControlId(0, "exclusions")).value,
    "billing, nightly batch");
  assert.equal(controlById(document, planControlId(0, "commit")).checked, false);

  controlById(document, planControlId(0, "commit")).click();
  assert.deepEqual(shownPlan(document), committed, "re-adding forces no re-entry");
});

test("every control the section paints is labelled, reachable and keyboard-operable",
  async () => {
    const { document } = await paintPlan();
    const section = document.getElementById("plan-scope");
    const controls = section.querySelectorAll("input,select,textarea,button");
    assert.equal(controls.length, 4 * bundledSlate().rules.length,
      "four levers per modelled move, and nothing else to fill in");
    const labels = section.querySelectorAll("label");
    for (const control of controls) {
      assert.ok(control.id, "a control with no id cannot carry a <label for>");
      const labelled = labels.filter((label) => label.getAttribute("for") === control.id);
      assert.equal(labelled.length, 1, `${control.id} needs exactly one <label for>`);
      assert.ok(textOf(labelled[0]).length > 0, `${control.id}'s label says nothing`);
      // Native controls only: each is in the tab sequence and takes the focus
      // ring styles.css gives every input, with no tabindex of its own.
      assert.equal(control.tagName, "INPUT");
      assert.equal(control.getAttribute("tabindex"), null);
      assert.equal(control.disabled, false);
    }
    // The levers are in the tab sequence the page actually has, and every one of
    // them is inside this section — below the first-run region, never above it.
    const sequence = tabSequence(document).filter((node) => node.tagName === "INPUT");
    for (const control of controls) {
      assert.ok(sequence.includes(control), `${control.id} is not reachable by Tab`);
      assert.equal(control.closest("section").id, "plan-scope");
    }
  });

test("the share field states its range where a label or description carries it", async () => {
  const { document } = await paintPlan();
  const share = controlById(document, planControlId(0, "share"));
  const label = document.getElementById("plan-scope").querySelectorAll("label")
    .find((node) => node.getAttribute("for") === share.id);
  const described = share.getAttribute("aria-describedby").split(" ")
    .map((id) => textOf(document.getElementById(id))).join(" ");
  const said = `${textOf(label)} ${described}`;
  assert.ok(said.includes(String(PLAN_SHARE_MIN)) && said.includes(String(PLAN_SHARE_MAX)), said);
  // Not placeholder text alone, which no label mechanism exposes.
  assert.equal(share.getAttribute("placeholder"), null);
});

test("no announcing or updating text is painted inside a collapsed disclosure", async () => {
  const { document } = await paintPlan();
  controlById(document, planControlId(0, "commit")).click();
  const closed = document.getElementById("plan-scope-body").querySelectorAll("details")
    .filter((node) => !node.hasAttribute("open"));
  assert.equal(closed.length, 1, "one disclosure, and it opens closed");
  // Walking parentNode rather than using a descendant selector, which this
  // harness rejects at parse time.
  const insideClosed = (node) => {
    for (let walk = node?.parentNode; walk; walk = walk.parentNode) {
      if (closed.includes(walk)) return true;
    }
    return false;
  };
  for (const id of ["plan-scope-status", "plan-scope-figure", "plan-scope-committed",
    "plan-scope-action", "plan-scope-grade", "plan-scope-controls"]) {
    assert.equal(insideClosed(document.getElementById(id)), false,
      `${id} is hidden from the accessibility tree inside a closed disclosure`);
  }
  const status = document.getElementById("plan-scope-status");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(document.querySelectorAll("[id=\"plan-scope-status\"]").length, 1,
    "one live region for this section, reusing the one the page already ships");
});
