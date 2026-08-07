// Bringing a filed plan back after a reload, and saying what it was filed
// against (#1290).
//
// What this file exists to catch:
//
//   * a plan that comes back QUIETLY REPRICED. A restored plan must show the
//     moves, the scopes and the total that were filed, not what the same levers
//     would be worth against an analysis that has since moved.
//   * a staleness notice that says "outdated" without saying WHICH input moved.
//     Each of the three cases — analysis, rate card, both — is asserted on the
//     words, and the matching case is asserted to produce no notice at all.
//   * a corrupt record that reaches the load path as an exception, or that is
//     retried, or that leaves half a plan on screen.
//   * a clear control that empties the screen and leaves the record behind.
//
// It drives the real markup from src/evolution.html and the real slate from the
// bundled example, and it reloads by standing up a SECOND page seeded with the
// exact bytes the first page wrote — which is what a browser does.
//
// HARNESS NOTES. Element identity is never asserted (it walks the whole parsed
// page and hangs) and no property is reflected to an attribute, so visibility is
// asserted on the `hidden` PROPERTY and presence on `getElementById` being
// non-null. No descendant or universal selector is used.

import assert from "node:assert/strict";
import test from "node:test";

import { loadExampleDataset } from "../src/example-dataset.js";
import { emptyMoveScope } from "../src/plan-scope-levers.js";
import {
  PLAN_KEEP_FILED_LABEL, PLAN_RECOMPUTE_LABEL, PLAN_SCOPE_KEY, PLAN_SCOPE_RECORD_VERSION,
  PLAN_UNREADABLE_MESSAGE, analysisFingerprint, projectPlanRecord, rateCardFingerprint,
  readPlanRecord, validatePlanRecord,
} from "../src/plan-scope-store.js";
import { PLAN_SCOPE_VERSION, planMoveKey, planScope } from "../src/plan-scope.js";
import { applyPlanScope, planLeverId } from "../src/plan-scope-view.js";
import { routingSlate } from "../src/routing-slate.js";
import { DomEvent, loadPage, textOf } from "./support/browser.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

const bundledSlate = () => routingSlate(loadExampleDataset());

/** The fingerprints the shipped page computes for the bundled example. */
const bundledPrints = () => ({
  analysis: analysisFingerprint(bundledSlate()),
  rateCard: rateCardFingerprint(null),
});

/** The section, painted against a seeded store, with the handles a test drives. */
async function openPlan({ seed = {}, fingerprints = bundledPrints() } = {}) {
  const page = await loadPage(PAGE, { scripts: false, storage: seed });
  const { document } = page;
  const slate = bundledSlate();
  const storage = globalThis.localStorage;
  const model = applyPlanScope(document, slate, { storage, fingerprints });
  const byId = (id) => document.getElementById(id);
  return {
    document,
    slate,
    model,
    storage,
    byId,
    control: (index, part) => byId(planLeverId(index, part)),
    figure: () => textOf(byId("plan-scope-figure")),
    committedCount: () => byId("plan-scope").dataset.committedCount,
    notice: () => byId("plan-scope-staleness"),
    noticeText: () => textOf(byId("plan-scope-staleness-text")),
    stored: () => storage.getItem(PLAN_SCOPE_KEY),
    restore: page.restore,
  };
}

/** Type into a field the way a lead does: replace the text, then let the page hear it. */
function enter(control, text) {
  control.value = text;
  control.dispatchEvent(new DomEvent("input", { bubbles: true }));
}

/** File the same plan every reload test files: rank 1 at 40%, one named exclusion. */
function fileAPlan(plan) {
  plan.control(0, "commit").click();
  enter(plan.control(0, "share"), "40");
  enter(plan.control(0, "excluded"), "batch-summaries");
}

/** What `planScope()` itself answers for that plan. Never recomputed by this file. */
function expectedPlan(slate) {
  return planScope(slate, {
    commitments: [{
      move: planMoveKey(slate.rules[0]),
      reroutedSharePct: 40,
      excludedWorkloads: 1,
      eligibleTeams: 1,
    }],
  });
}

// ---------------------------------------------------------------------------
// 1. A reload brings back the moves, the scopes and the total.
// ---------------------------------------------------------------------------

test("a filed plan comes back after a reload with the same moves, scopes and total",
  async () => {
    const first = await openPlan();
    let written;
    try {
      fileAPlan(first);
      const expected = expectedPlan(first.slate);
      assert.ok(expected.plannedMonthlyUsd > 0, "the bundled rank 1 move must be worth something");
      assert.ok(first.figure().includes(
        `$${expected.plannedMonthlyUsd.toLocaleString("en-US")} planned`), first.figure());
      written = first.stored();
      assert.ok(written, "filing a plan must write the record");
    } finally {
      first.restore();
    }

    // The reload: a second page, seeded with exactly the bytes the first wrote.
    const second = await openPlan({ seed: { [PLAN_SCOPE_KEY]: written } });
    try {
      const expected = expectedPlan(second.slate);
      assert.equal(second.committedCount(), "1");
      assert.equal(second.byId("plan-scope").dataset.filed, "true");
      assert.ok(second.figure().includes(
        `$${expected.plannedMonthlyUsd.toLocaleString("en-US")} planned`), second.figure());
      // The scopes, back in the controls the lead typed them into.
      assert.equal(second.control(0, "commit").checked, true);
      assert.equal(second.control(0, "share").value, "40");
      assert.equal(second.control(0, "excluded").value, "batch-summaries");
      // And nothing that was not filed came back committed.
      assert.equal(second.control(1, "commit").checked, false);
      assert.equal(second.control(1, "share").value, "");
    } finally {
      second.restore();
    }
  });

test("a restored plan shows the dollars that were FILED, not what the moves are worth now",
  async () => {
    const slate = bundledSlate();
    const filedTotal = 4242;
    const record = {
      schemaVersion: PLAN_SCOPE_RECORD_VERSION,
      planVersion: PLAN_SCOPE_VERSION,
      analysisFingerprint: bundledPrints().analysis,
      rateCardFingerprint: bundledPrints().rateCard,
      plannedMonthlyUsd: filedTotal,
      moves: [{
        key: planMoveKey(slate.rules[0]),
        sharePct: 40,
        excludedText: "batch-summaries",
        refuses: false,
        plannedMonthlyUsd: filedTotal,
        modelledMonthlyUsd: slate.rules[0].expectedMonthlyUsd,
      }],
    };
    assert.equal(validatePlanRecord(record).ok, true);
    const plan = await openPlan({ seed: { [PLAN_SCOPE_KEY]: JSON.stringify(record) } });
    try {
      // 4242 is not what these levers compute to; it is what was filed, and it
      // is what a restore has to show.
      assert.notEqual(expectedPlan(plan.slate).plannedMonthlyUsd, filedTotal);
      assert.ok(plan.figure().includes("$4,242 planned"), plan.figure());
      // Nothing was rewritten on the way in: the filed record still stands.
      assert.equal(readPlanRecord(plan.storage).record.plannedMonthlyUsd, filedTotal);
    } finally {
      plan.restore();
    }
  });

// ---------------------------------------------------------------------------
// 2-4. The staleness notice names the input that moved.
// ---------------------------------------------------------------------------

/** File a plan, then reload it under fingerprints the caller chooses. */
async function reloadUnder(fingerprints) {
  const first = await openPlan();
  let written;
  try {
    fileAPlan(first);
    written = first.stored();
  } finally {
    first.restore();
  }
  return openPlan({ seed: { [PLAN_SCOPE_KEY]: written }, fingerprints });
}

test("a plan filed against a different analysis says so, and offers both ways out",
  async () => {
    const plan = await reloadUnder({ ...bundledPrints(), analysis: "deadbeef" });
    try {
      assert.equal(plan.notice().hidden, false);
      assert.equal(plan.notice().dataset.changed, "analysis");
      const words = plan.noticeText();
      assert.ok(words.startsWith("The analysis has changed since this plan was filed."), words);
      assert.ok(!words.includes("rate card"), words);
      const recompute = plan.byId("plan-scope-recompute");
      const keep = plan.byId("plan-scope-keep-filed");
      assert.ok(recompute, "the prioritized action must be present");
      assert.ok(keep, "keeping the plan as filed must be offered");
      assert.equal(textOf(recompute), PLAN_RECOMPUTE_LABEL);
      assert.equal(textOf(keep), PLAN_KEEP_FILED_LABEL);
      assert.equal(recompute.getAttribute("type"), "button");
    } finally {
      plan.restore();
    }
  });

test("a plan filed against a different rate card names the rate card", async () => {
  const plan = await reloadUnder({ ...bundledPrints(), rateCard: "deadbeef" });
  try {
    assert.equal(plan.notice().hidden, false);
    assert.equal(plan.notice().dataset.changed, "rateCard");
    const words = plan.noticeText();
    assert.ok(words.startsWith("The rate card has changed since this plan was filed."), words);
    assert.ok(!words.startsWith("The analysis"), words);
  } finally {
    plan.restore();
  }
});

test("when both moved, the notice names both", async () => {
  const plan = await reloadUnder({ analysis: "deadbeef", rateCard: "0badf00d" });
  try {
    assert.equal(plan.notice().hidden, false);
    assert.equal(plan.notice().dataset.changed, "analysis,rateCard");
    const words = plan.noticeText();
    assert.ok(words.startsWith(
      "The analysis and the rate card have both changed since this plan was filed."), words);
  } finally {
    plan.restore();
  }
});

test("matching fingerprints produce no notice at all", async () => {
  const plan = await reloadUnder(bundledPrints());
  try {
    assert.equal(plan.committedCount(), "1", "the plan must still have been restored");
    assert.equal(plan.notice().hidden, true);
    assert.equal(plan.noticeText(), "");
  } finally {
    plan.restore();
  }
});

test("recomputing reprices the filed plan through the shipped plan path, and refiles it",
  async () => {
    const plan = await reloadUnder({ ...bundledPrints(), analysis: "deadbeef" });
    try {
      plan.byId("plan-scope-recompute").click();
      assert.equal(plan.notice().hidden, true);
      assert.equal(plan.byId("plan-scope").dataset.filed, "false");
      // The figure is now `planScope()`'s own answer for the restored scopes —
      // this test never computes a dollar itself.
      const expected = expectedPlan(plan.slate);
      assert.ok(plan.figure().includes(
        `$${expected.plannedMonthlyUsd.toLocaleString("en-US")} planned`), plan.figure());
      // Refiled under today's fingerprints, so the next reload is not stale.
      assert.equal(readPlanRecord(plan.storage).record.analysisFingerprint, "deadbeef");
    } finally {
      plan.restore();
    }
  });

test("keeping the plan as filed dismisses the notice, changes no figure, and writes nothing",
  async () => {
    const plan = await reloadUnder({ ...bundledPrints(), analysis: "deadbeef" });
    try {
      const before = plan.figure();
      const stored = plan.stored();
      plan.byId("plan-scope-keep-filed").click();
      assert.equal(plan.notice().hidden, true);
      assert.equal(plan.figure(), before);
      // Unchanged bytes: re-filing under today's fingerprints would make the
      // next reload claim a match that was never checked.
      assert.equal(plan.stored(), stored);
      assert.equal(readPlanRecord(plan.storage).record.analysisFingerprint, bundledPrints().analysis);
    } finally {
      plan.restore();
    }
  });

// ---------------------------------------------------------------------------
// 5. A record that cannot be read.
// ---------------------------------------------------------------------------

for (const [name, raw] of [
  ["unparseable text", "{ this is not a plan"],
  ["a record from a shape this build does not know", JSON.stringify({
    schemaVersion: "finops-plan-scope/9.9.9", planVersion: PLAN_SCOPE_VERSION, moves: [],
  })],
  ["a record that fails its own contract", JSON.stringify({
    schemaVersion: PLAN_SCOPE_RECORD_VERSION,
    planVersion: PLAN_SCOPE_VERSION,
    analysisFingerprint: "nope",
    rateCardFingerprint: "nope",
    plannedMonthlyUsd: -1,
    moves: [],
  })],
]) {
  test(`${name} leaves the empty plan on screen, says so, and clears the record`, async () => {
    const plan = await openPlan({ seed: { [PLAN_SCOPE_KEY]: raw } });
    try {
      assert.equal(plan.committedCount(), "0");
      assert.equal(plan.byId("plan-scope").dataset.state, "empty");
      assert.ok(plan.figure().includes("$0 planned"), plan.figure());
      // No half-restored plan: not one control carries an answer.
      assert.equal(plan.control(0, "commit").checked, false);
      assert.equal(plan.control(0, "share").value, "");
      // The message, visible rather than only announced.
      const message = plan.byId("plan-scope-unreadable");
      assert.equal(message.hidden, false);
      assert.equal(textOf(message), PLAN_UNREADABLE_MESSAGE);
      // Unrecoverable, so it is dropped rather than retried.
      assert.equal(plan.stored(), null);
      // And no notice: there is no filed plan to be stale.
      assert.equal(plan.notice().hidden, true);
    } finally {
      plan.restore();
    }
  });
}

test("a first visit shows no unreadable message and no notice", async () => {
  const plan = await openPlan();
  try {
    assert.equal(plan.byId("plan-scope-unreadable").hidden, true);
    assert.equal(plan.notice().hidden, true);
    assert.equal(plan.stored(), null, "an empty plan writes no record");
  } finally {
    plan.restore();
  }
});

test("storage that throws on every call leaves the page on the empty plan and does not throw",
  async () => {
    const page = await loadPage(PAGE, { scripts: false });
    try {
      const blocked = {
        getItem() { throw new Error("storage is disabled"); },
        setItem() { throw new Error("storage is disabled"); },
        removeItem() { throw new Error("storage is disabled"); },
      };
      const model = applyPlanScope(page.document, bundledSlate(),
        { storage: blocked, fingerprints: bundledPrints() });
      assert.equal(model.committedCount, 0);
      const section = page.document.getElementById("plan-scope");
      assert.equal(section.dataset.state, "empty");
      // A store that throws is reported the same way a corrupt record is: the
      // reader's plan is not there, and the reason is not their problem.
      const message = page.document.getElementById("plan-scope-unreadable");
      assert.equal(message.hidden, false);
      assert.equal(textOf(message), PLAN_UNREADABLE_MESSAGE);
      // And filing still works for the life of the tab.
      page.document.getElementById(planLeverId(0, "commit")).click();
      assert.equal(section.dataset.committedCount, "1");
    } finally {
      page.restore();
    }
  });

// ---------------------------------------------------------------------------
// 6. Clearing.
// ---------------------------------------------------------------------------

test("clearing the plan removes the record and returns the empty-plan state", async () => {
  const plan = await openPlan();
  try {
    fileAPlan(plan);
    assert.ok(plan.stored(), "there must be something to clear");
    const clear = plan.byId("plan-scope-clear");
    assert.ok(clear, "a filed plan must offer a way to clear it");
    assert.equal(clear.parentNode.hidden, false);

    clear.click();

    assert.equal(plan.stored(), null);
    assert.equal(plan.committedCount(), "0");
    assert.equal(plan.byId("plan-scope").dataset.state, "empty");
    assert.ok(plan.figure().includes("$0 planned"), plan.figure());
    // The controls are back to a first visit, so the next keystroke cannot
    // refile the plan that was just cleared.
    assert.equal(plan.control(0, "commit").checked, false);
    assert.equal(plan.control(0, "share").value, "");
    assert.equal(plan.control(0, "excluded").value, "");
    // And the control that did it retires with the plan it cleared.
    assert.equal(clear.parentNode.hidden, true);
  } finally {
    plan.restore();
  }
});

// ---------------------------------------------------------------------------
// The store's own contract.
// ---------------------------------------------------------------------------

test("the record carries the plan and nothing else", () => {
  const slate = bundledSlate();
  const key = planMoveKey(slate.rules[0]);
  const scopes = new Map([[key, {
    ...emptyMoveScope(), inPlan: true, sharePct: 40, excludedText: "batch-summaries",
  }]]);
  const record = projectPlanRecord({
    model: planScope(slate, {
      commitments: [{ move: key, reroutedSharePct: 40, excludedWorkloads: 1, eligibleTeams: 1 }],
    }),
    scopes,
    ...bundledPrints(),
  });
  assert.deepEqual(Object.keys(record).sort(), [
    "analysisFingerprint", "moves", "planVersion", "plannedMonthlyUsd", "rateCardFingerprint",
    "schemaVersion",
  ]);
  assert.deepEqual(Object.keys(record.moves[0]).sort(), [
    "excludedText", "key", "modelledMonthlyUsd", "plannedMonthlyUsd", "refuses", "sharePct",
  ]);
});

test("an empty plan projects to no record at all", () => {
  const record = projectPlanRecord({
    model: planScope(bundledSlate()), scopes: new Map(), ...bundledPrints(),
  });
  assert.equal(record, null);
});

test("the two fingerprints move only when their own input moves", () => {
  const slate = bundledSlate();
  assert.equal(analysisFingerprint(slate), analysisFingerprint(bundledSlate()));
  const repriced = {
    ...slate,
    rules: [{ ...slate.rules[0], expectedMonthlyUsd: slate.rules[0].expectedMonthlyUsd + 1 },
      ...slate.rules.slice(1)],
  };
  assert.notEqual(analysisFingerprint(slate), analysisFingerprint(repriced));
  // A declared card fingerprints differently from the reference card the page
  // falls back to, which is what makes declaring one a change worth naming.
  const declared = {
    cardId: "acme-2026-08",
    models: [{
      model: "standard-text", contractedInputRate: 0.4, contractedOutputRate: 1.2,
      currency: "USD", effectiveDate: "2026-08-01", committedUseDiscountPct: 10, permitted: true,
    }],
  };
  assert.notEqual(rateCardFingerprint(null), rateCardFingerprint(declared));
  assert.equal(rateCardFingerprint(declared), rateCardFingerprint({ ...declared }));
});
