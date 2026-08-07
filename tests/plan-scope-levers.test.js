// Moving a scope lever, on the shipped page (#1288).
//
// What this file exists to catch is a plan surface that LOOKS interactive and
// is not honest about what it did:
//
//   * a lever that moves and leaves the total, the committed count or the next
//     action behind — the three have to move in one step or a reader is looking
//     at a stale number beside a fresh control.
//   * a total the view computed itself. Every figure asserted here is compared
//     against `planScope()`'s own answer for the same commitments, so a second
//     copy of the arithmetic in the view layer fails rather than agrees.
//   * a refusal that eats the lead's work: a bad share must not clear the typed
//     text, must not drop the last accepted share, and must not touch any other
//     move.
//   * a removal that forgets. Taking a move out and putting it back has to
//     restore the share, the workloads and the refusal without re-entry.
//   * a second live region, or an announcement made somewhere a closed
//     disclosure would silence.
//
// It drives the real markup from src/evolution.html and the real slate from the
// bundled example, which is the state a lead lands in.
//
// HARNESS NOTES. Its selects accept unlisted values and it reflects no property
// to an attribute, so refusal is asserted on this page's OWN rejection path —
// the error node, `aria-invalid`, and the figure that did not move — rather than
// on anything the control would have refused in a browser. Equality against an
// element node is never asserted: it walks the whole parsed page and hangs.

import assert from "node:assert/strict";
import test from "node:test";

import { loadExampleDataset } from "../src/example-dataset.js";
import { feasibleShareRefusal } from "../src/plan-scope-levers.js";
import { planMoveKey, planScope } from "../src/plan-scope.js";
import { applyPlanScope, planLeverId, planScopeStatus } from "../src/plan-scope-view.js";
import { routingSlate } from "../src/routing-slate.js";
import { DomEvent, loadPage, textOf } from "./support/browser.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

const bundledSlate = () => routingSlate(loadExampleDataset());

/** The section, painted, with the handles a test drives it through. */
async function openPlan() {
  const page = await loadPage(PAGE, { scripts: false });
  const { document } = page;
  const slate = bundledSlate();
  const model = applyPlanScope(document, slate);
  return {
    document,
    slate,
    model,
    control: (index, part) => document.getElementById(planLeverId(index, part)),
    figure: () => textOf(document.getElementById("plan-scope-figure")),
    action: () => textOf(document.getElementById("plan-scope-action")),
    status: () => textOf(document.getElementById("plan-scope-status")),
    committedCount: () => document.getElementById("plan-scope").dataset.committedCount,
    restore: page.restore,
  };
}

/** Type into a field the way a lead does: replace the text, then let the page hear it. */
function enter(control, text) {
  control.value = text;
  control.dispatchEvent(new DomEvent("input", { bubbles: true }));
}

// ---------------------------------------------------------------------------
// 1. A lever moves, and the whole answer moves with it.
// ---------------------------------------------------------------------------

test("committing a move at a share updates the total, the count and the next action",
  async () => {
    const plan = await openPlan();
    try {
      const before = plan.figure();
      assert.ok(before.includes("$0 planned"), before);
      assert.equal(plan.committedCount(), "0");
      const firstAction = plan.action();

      plan.control(0, "commit").click();
      enter(plan.control(0, "share"), "50");

      // The figure the module computes for exactly these levers, never one this
      // test or the view recomputed.
      const expected = planScope(plan.slate, {
        commitments: [{
          move: planMoveKey(plan.slate.rules[0]),
          reroutedSharePct: 50,
          eligibleTeams: 1,
        }],
      });
      assert.ok(expected.plannedMonthlyUsd > 0, "the bundled rank 1 move must be worth something");

      const figure = plan.figure();
      assert.ok(figure.includes(`$${expected.plannedMonthlyUsd.toLocaleString("en-US")} planned`),
        figure);
      assert.equal(plan.committedCount(), "1");
      assert.equal(plan.action(), `Do this first: ${expected.nextAction}`);
      assert.notEqual(plan.action(), firstAction, "the ask must move on once it is answered");
      assert.equal(plan.status(), planScopeStatus(expected));
      assert.ok(plan.status().includes("1 of 5"), plan.status());
    } finally {
      plan.restore();
    }
  });

test("the recomputed total is announced through the page's own status region, outside "
  + "every disclosure", async () => {
  const plan = await openPlan();
  try {
    plan.control(1, "commit").click();
    enter(plan.control(1, "share"), "100");
    const status = plan.document.getElementById("plan-scope-status");
    assert.equal(status.getAttribute("role"), "status");
    // A live region inside a collapsed disclosure is dropped by a real browser,
    // so the announced node must be a direct child of the section itself.
    assert.equal(status.parentNode.id, "plan-scope");
    assert.equal(status.dataset.state, "committed");
    assert.ok(plan.status().includes("1 of 5"), plan.status());
    // One region, not two: nothing painted into the body announces anything.
    const live = plan.document.getElementById("plan-scope")
      .querySelectorAll("[aria-live],[role=\"status\"]");
    assert.equal(live.length, 1);
  } finally {
    plan.restore();
  }
});

test("a refusing team removes that move's whole figure", async () => {
  const plan = await openPlan();
  try {
    plan.control(0, "commit").click();
    enter(plan.control(0, "share"), "100");
    const committed = plan.figure();
    assert.ok(!committed.includes("$0 planned"), committed);

    plan.control(0, "refuses").click();
    assert.ok(plan.figure().includes("$0 planned"), plan.figure());
    // Still committed — a refused move is in the plan and worth nothing, which
    // is a different statement from never having been committed.
    assert.equal(plan.committedCount(), "1");
  } finally {
    plan.restore();
  }
});

test("naming excluded workloads states the third scope fact", async () => {
  const plan = await openPlan();
  try {
    plan.control(0, "commit").click();
    enter(plan.control(0, "share"), "40");
    enter(plan.control(0, "excluded"), "nightly-batch, eval-harness");
    const rows = plan.document.getElementById("plan-scope-body").querySelectorAll("li");
    const excluded = rows.filter((row) => row.dataset.lever === "excludedWorkloads");
    assert.equal(excluded.length, plan.model.moves.length);
    assert.equal(excluded[0].dataset.stated, "true");
    assert.ok(textOf(excluded[0]).includes("Stated: 2"), textOf(excluded[0]));
    // And the other four moves are untouched by one move's entry.
    for (const row of excluded.slice(1)) assert.equal(row.dataset.stated, "false");
  } finally {
    plan.restore();
  }
});

// ---------------------------------------------------------------------------
// 2. A refusal that costs the lead nothing.
// ---------------------------------------------------------------------------

for (const [label, typed] of [["an out-of-range", "150"], ["a non-numeric", "half"]]) {
  test(`${label} share is refused and keeps every other entry`, async () => {
    const plan = await openPlan();
    try {
      // Two moves scoped first, so a refusal has something to destroy.
      plan.control(0, "commit").click();
      enter(plan.control(0, "share"), "40");
      plan.control(1, "commit").click();
      enter(plan.control(1, "share"), "25");
      enter(plan.control(1, "excluded"), "nightly-batch");
      const standing = plan.figure();
      const standingAction = plan.action();

      enter(plan.control(0, "share"), typed);

      const error = plan.document.getElementById(planLeverId(0, "share-error"));
      const name = "Atlas Platform → standard tier";
      assert.equal(textOf(error), feasibleShareRefusal(name));
      assert.ok(textOf(error).includes("0 to 100"), textOf(error));
      assert.equal(error.hidden, false);
      const share = plan.control(0, "share");
      assert.equal(share.getAttribute("aria-invalid"), "true");
      assert.equal(share.getAttribute("aria-describedby"), error.id);
      // The rejected text stays put so it can be corrected, not retyped.
      assert.equal(share.value, typed);

      // Nothing else moved: the figure still stands on the last accepted share,
      // and the other move's entries are exactly as they were.
      assert.equal(plan.figure(), standing);
      assert.equal(plan.action(), standingAction);
      assert.equal(plan.committedCount(), "2");
      assert.equal(plan.control(1, "share").value, "25");
      assert.equal(plan.control(1, "excluded").value, "nightly-batch");
      assert.equal(plan.control(0, "excluded").value, "");
      // The refusal is announced through the one region, and says what stands.
      assert.ok(plan.status().startsWith(feasibleShareRefusal(name)), plan.status());
      assert.ok(plan.status().includes("Nothing else changed"), plan.status());

      // Correcting it clears the refusal and moves the figure again.
      enter(share, "60");
      assert.equal(share.getAttribute("aria-invalid"), null);
      assert.equal(share.getAttribute("aria-describedby"), null);
      assert.equal(error.hidden, true);
      assert.notEqual(plan.figure(), standing);
    } finally {
      plan.restore();
    }
  });
}

// ---------------------------------------------------------------------------
// 3. Removal keeps scope.
// ---------------------------------------------------------------------------

test("taking a move out of the plan and putting it back restores its whole scope",
  async () => {
    const plan = await openPlan();
    try {
      plan.control(0, "commit").click();
      enter(plan.control(0, "share"), "60");
      enter(plan.control(0, "excluded"), "nightly-batch, eval-harness");
      const scoped = plan.figure();
      assert.ok(!scoped.includes("$0 planned"), scoped);

      plan.control(0, "commit").click();
      assert.equal(plan.committedCount(), "0");
      assert.ok(plan.figure().includes("$0 planned"), plan.figure());
      // The entries survive removal, in the fields as well as in the arithmetic.
      assert.equal(plan.control(0, "share").value, "60");
      assert.equal(plan.control(0, "excluded").value, "nightly-batch, eval-harness");

      plan.control(0, "commit").click();
      assert.equal(plan.committedCount(), "1");
      assert.equal(plan.figure(), scoped, "re-adding restores the scope without re-entry");
      const rows = plan.document.getElementById("plan-scope-body").querySelectorAll("li");
      const excluded = rows.filter((row) => row.dataset.lever === "excludedWorkloads");
      assert.equal(excluded[0].dataset.stated, "true");
    } finally {
      plan.restore();
    }
  });

test("a repaint of the section keeps what the lead already said", async () => {
  const plan = await openPlan();
  try {
    plan.control(0, "commit").click();
    enter(plan.control(0, "share"), "75");
    const scoped = plan.figure();

    // The page repaints this section whenever the analysis it sits under is
    // repainted. A lead's scope has to survive that, or every import wipes it.
    applyPlanScope(plan.document, plan.slate);
    assert.equal(plan.figure(), scoped);
    assert.equal(plan.committedCount(), "1");
    assert.equal(plan.control(0, "share").value, "75");
    assert.equal(plan.control(0, "commit").checked, true);
  } finally {
    plan.restore();
  }
});

// ---------------------------------------------------------------------------
// 4. The view invents no arithmetic.
// ---------------------------------------------------------------------------

test("every painted total is the module's answer for the same commitments", async () => {
  const plan = await openPlan();
  try {
    plan.control(2, "commit").click();
    enter(plan.control(2, "share"), "30");
    enter(plan.control(2, "excluded"), "none");
    plan.control(3, "commit").click();
    enter(plan.control(3, "share"), "80");
    plan.control(3, "refuses").click();

    const expected = planScope(plan.slate, {
      commitments: [
        {
          move: planMoveKey(plan.slate.rules[2]),
          reroutedSharePct: 30,
          excludedWorkloads: 0,
          eligibleTeams: 1,
        },
        {
          move: planMoveKey(plan.slate.rules[3]),
          reroutedSharePct: 80,
          eligibleTeams: 1,
          refusingTeams: 1,
        },
      ],
    });
    assert.equal(plan.status(), planScopeStatus(expected));
    assert.equal(plan.committedCount(), String(expected.committedCount));
    assert.ok(plan.figure()
      .includes(`$${expected.plannedMonthlyUsd.toLocaleString("en-US")} planned`), plan.figure());
    assert.equal(plan.action(), `Do this first: ${expected.nextAction}`);
  } finally {
    plan.restore();
  }
});
