// A filed plan surviving a reload, and saying what moved under it (#1290).
//
// What this file exists to catch is a store that quietly loses or quietly lies:
//
//   * a plan that comes back with different moves, different scopes or a
//     different total than the one that was filed;
//   * a corrupted entry that throws at init, or — worse — half-restores and
//     leaves a reader looking at part of their plan with no way to tell;
//   * a plan filed against an analysis that has since moved and says nothing,
//     or one filed against figures that have NOT moved and cries wolf;
//   * a clear control that empties the screen and leaves the record behind.
//
// It drives the real markup from src/evolution.html and the real slate from the
// bundled example, and every reload is a fresh document over the SAME store —
// which is what a reload actually is.
//
// HARNESS NOTES. Equality against an element node is never asserted: it walks
// the whole parsed page and hangs. Nothing is selected with a descendant or
// universal selector, and the checked state of a control is read as a property,
// because this harness reflects none of them to attributes.

import assert from "node:assert/strict";
import test from "node:test";

import { loadExampleDataset } from "../src/example-dataset.js";
import {
  PLAN_KEEP_LABEL, PLAN_RECORD_VERSION, PLAN_RECOMPUTE_LABEL, PLAN_STORAGE_KEY,
  analysisFingerprint, planFingerprints, rateCardFingerprint, readStoredPlan,
} from "../src/plan-persistence.js";
import { planMoveKey } from "../src/plan-scope.js";
import { PLAN_SCOPE_CLEAR_LABEL, applyPlanScope, planLeverId } from "../src/plan-scope-view.js";
import { routingSlate } from "../src/routing-slate.js";
import { DomEvent, loadPage, textOf } from "./support/browser.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

const bundledSlate = () => routingSlate(loadExampleDataset());

/**
 * A storage stand-in. Every test builds its own, so no case can leak a filed
 * plan into the next one. `refuse` models a browser that blocks site data.
 */
function storageOf(seed = {}, { refuse = false } = {}) {
  const values = new Map(Object.entries(seed));
  const guard = () => {
    if (refuse) throw new Error("this browser blocks site data");
  };
  return {
    getItem(key) { guard(); return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { guard(); values.set(key, String(value)); },
    removeItem(key) { guard(); values.delete(key); },
    size: () => values.size,
  };
}

/** One visit to the page: a fresh document, the same store. */
async function openPlan(storage, fingerprints) {
  const page = await loadPage(PAGE, { scripts: false });
  const { document } = page;
  const slate = bundledSlate();
  applyPlanScope(document, slate, { storage, fingerprints });
  const body = document.getElementById("plan-scope-body");
  return {
    document,
    slate,
    body,
    control: (index, part) => document.getElementById(planLeverId(index, part)),
    figure: () => textOf(document.getElementById("plan-scope-figure")),
    committedCount: () => document.getElementById("plan-scope").dataset.committedCount,
    notice: () => document.getElementById("plan-scope-staleness"),
    failure: () => document.getElementById("plan-scope-restore-error"),
    clear: () => document.getElementById("plan-scope-clear"),
    restore: page.restore,
  };
}

/**
 * Type into a field the way a lead does, then leave it. The `input` is every
 * keystroke; the `change` is the entry being committed, which is a browser's own
 * blur behaviour and the only one of the two that files anything.
 */
function enter(control, text) {
  control.value = text;
  control.dispatchEvent(new DomEvent("input", { bubbles: true }));
  control.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

/** A plan a lead filed: the rank 1 move, at half its traffic, with an exclusion. */
function fileAPlan(plan) {
  plan.control(0, "commit").click();
  enter(plan.control(0, "share"), "50");
  enter(plan.control(0, "excluded"), "batch jobs");
}

// ---------------------------------------------------------------------------
// 1. The plan comes back.
// ---------------------------------------------------------------------------

test("a filed plan is restored after a reload with the same moves, scopes and total",
  async () => {
    const storage = storageOf();
    const today = planFingerprints(bundledSlate(), null);
    let filedTotal = "";
    const first = await openPlan(storage, today);
    try {
      fileAPlan(first);
      filedTotal = first.figure();
      assert.ok(!filedTotal.includes("$0 planned"), filedTotal);
      assert.equal(first.committedCount(), "1");
    } finally {
      first.restore();
    }

    // What actually went into this browser: the committed move, its three
    // levers, the total and the two fingerprints. Nothing else — a field added
    // here without a reason is a field a reader never agreed to store.
    const stored = readStoredPlan(storage);
    assert.equal(stored.status, "restored");
    assert.equal(stored.record.version, PLAN_RECORD_VERSION);
    assert.deepEqual(Object.keys(stored.record).sort(), [
      "analysisFingerprint", "moves", "plannedMonthlyUsd", "rateCardFingerprint", "version",
    ]);
    assert.equal(stored.record.moves.length, 1);
    assert.deepEqual(stored.record.moves[0], {
      key: planMoveKey(bundledSlate().rules[0]),
      sharePct: 50,
      excludedText: "batch jobs",
      refuses: false,
    });
    assert.equal(stored.record.analysisFingerprint, today.analysis);

    const second = await openPlan(storage, today);
    try {
      assert.equal(second.control(0, "commit").checked, true);
      assert.equal(second.control(0, "share").value, "50");
      assert.equal(second.control(0, "excluded").value, "batch jobs");
      assert.equal(second.control(0, "refuses").checked, false);
      assert.equal(second.committedCount(), "1");
      assert.equal(second.figure(), filedTotal);
      // Nothing moved under it, so the reader is told nothing.
      assert.ok(!second.notice(), "matching fingerprints must produce no notice");
      assert.ok(!second.failure(), "a plan that read cleanly must report no failure");
    } finally {
      second.restore();
    }
  });

test("with no plan in this browser the section is the empty plan it always was", async () => {
  const storage = storageOf();
  const plan = await openPlan(storage, planFingerprints(bundledSlate(), null));
  try {
    assert.equal(plan.committedCount(), "0");
    assert.ok(plan.figure().includes("$0 planned"), plan.figure());
    assert.ok(!plan.notice(), "an empty plan has nothing to be stale about");
    assert.ok(!plan.failure(), "an absent key is the ordinary first visit, not a failure");
    // The clear control is painted but hidden: an untouched section adds no tab
    // stop it did not add before.
    assert.ok(plan.clear().parentNode.hidden, "nothing filed, nothing to clear");
    assert.equal(storage.size(), 0, "an empty plan writes no key at all");
  } finally {
    plan.restore();
  }
});

// ---------------------------------------------------------------------------
// 2. A corrupted entry degrades to the empty plan, in the open.
// ---------------------------------------------------------------------------

for (const [name, value] of [
  ["unparseable", "{not json at all"],
  ["a bare string", "\"a plan, honest\""],
  ["the wrong version", JSON.stringify({
    version: "finops-plan/0", plannedMonthlyUsd: 10, analysisFingerprint: "a",
    rateCardFingerprint: "b", moves: [],
  })],
  ["a broken shape", JSON.stringify({
    version: PLAN_RECORD_VERSION, plannedMonthlyUsd: 10, analysisFingerprint: "a",
    rateCardFingerprint: "b", moves: [{ key: 42, sharePct: "half" }],
  })],
]) {
  test(`a stored plan that is ${name} leaves an empty plan and says so`, async () => {
    const storage = storageOf({ [PLAN_STORAGE_KEY]: value });
    // Init must not throw. If it does, the whole analysis page dies here.
    const plan = await openPlan(storage, planFingerprints(bundledSlate(), null));
    try {
      assert.equal(plan.committedCount(), "0");
      assert.ok(plan.figure().includes("$0 planned"), plan.figure());
      assert.equal(plan.control(0, "commit").checked, false);
      const failure = plan.failure();
      assert.ok(failure, "the reader must be told their saved plan could not be read");
      assert.ok(!failure.hidden, "the message is visible");
      const words = textOf(failure);
      assert.ok(words.includes("could not be read"), words);
      assert.ok(words.includes("started from an empty plan"), words);
      // Non-blocking: the live controls below it are the live controls.
      assert.equal(plan.body.children[0].id, "plan-scope-restore-error");
      assert.ok(plan.body.querySelectorAll("details").length >= 1);
      // And the bad key is gone, so the message is said once and not every visit.
      assert.equal(storage.getItem(PLAN_STORAGE_KEY), null);
    } finally {
      plan.restore();
    }
  });
}

test("a browser that blocks site data paints the plan and stores nothing", async () => {
  const plan = await openPlan(storageOf({}, { refuse: true }),
    planFingerprints(bundledSlate(), null));
  try {
    // A blocked store is not a corrupted plan: there is nothing to report.
    assert.equal(plan.committedCount(), "0");
    fileAPlan(plan);
    assert.ok(!plan.figure().includes("$0 planned"), plan.figure());
    assert.equal(plan.committedCount(), "1");
  } finally {
    plan.restore();
  }
});

// ---------------------------------------------------------------------------
// 3. What the plan was filed against has moved.
// ---------------------------------------------------------------------------

/** File a plan, then come back to a page whose fingerprints are `now`. */
async function refileAndReopen(storage, filed, now) {
  const first = await openPlan(storage, filed);
  try {
    fileAPlan(first);
  } finally {
    first.restore();
  }
  return openPlan(storage, now);
}

test("a changed analysis names the analysis, offers the recompute, and offers keeping it filed",
  async () => {
    const storage = storageOf();
    const filed = planFingerprints(bundledSlate(), null);
    const plan = await refileAndReopen(storage, filed,
      { analysis: "00000000", rateCard: filed.rateCard });
    try {
      const notice = plan.notice();
      assert.ok(notice, "a plan filed against an older analysis must say so");
      assert.equal(notice.dataset.changed, "analysis");
      // Above the moves and inside the plan region, not a page-wide banner.
      assert.equal(plan.body.children[0].id, "plan-scope-staleness");
      assert.equal(notice.parentNode.id, "plan-scope-body");
      const words = textOf(notice);
      assert.ok(words.includes("the analysis changed"), words);
      assert.ok(!words.includes("rate card"), words);
      // One prioritised action, plus the option to leave the plan alone.
      const recompute = plan.document.getElementById("plan-scope-recompute");
      const keep = plan.document.getElementById("plan-scope-keep");
      assert.ok(recompute && keep, "both ways out must be on the notice");
      assert.equal(textOf(recompute), PLAN_RECOMPUTE_LABEL);
      assert.equal(textOf(keep), PLAN_KEEP_LABEL);
      // The restored plan is still the restored plan while the notice stands.
      assert.equal(plan.committedCount(), "1");
      assert.equal(plan.control(0, "share").value, "50");
    } finally {
      plan.restore();
    }
  });

test("a changed rate card names the rate card, and both changing names both", async () => {
  const filed = planFingerprints(bundledSlate(), null);
  const cardOnly = await refileAndReopen(storageOf(), filed,
    { analysis: filed.analysis, rateCard: "00000000" });
  try {
    assert.equal(cardOnly.notice().dataset.changed, "rate card");
    const words = textOf(cardOnly.notice());
    assert.ok(words.includes("the rate card changed"), words);
  } finally {
    cardOnly.restore();
  }

  const both = await refileAndReopen(storageOf(), filed,
    { analysis: "00000000", rateCard: "00000000" });
  try {
    assert.equal(both.notice().dataset.changed, "both");
    const words = textOf(both.notice());
    assert.ok(words.includes("the analysis and the rate card changed"), words);
  } finally {
    both.restore();
  }
});

test("recomputing re-files the plan against today's fingerprints and retires the notice",
  async () => {
    const storage = storageOf();
    const filed = planFingerprints(bundledSlate(), null);
    const now = { analysis: "00000000", rateCard: filed.rateCard };
    const plan = await refileAndReopen(storage, filed, now);
    try {
      plan.document.getElementById("plan-scope-recompute").click();
      assert.ok(plan.notice().hidden, "the notice is answered and goes");
      const stored = readStoredPlan(storage);
      assert.equal(stored.record.analysisFingerprint, now.analysis);
      assert.equal(stored.record.rateCardFingerprint, now.rateCard);
      // The plan itself is untouched: recomputing re-prices it, it does not
      // withdraw a single committed move.
      assert.equal(stored.record.moves.length, 1);
      assert.equal(stored.record.moves[0].sharePct, 50);
      assert.equal(plan.committedCount(), "1");
    } finally {
      plan.restore();
    }
  });

test("keeping the plan as filed dismisses the notice and changes nothing in the store",
  async () => {
    const storage = storageOf();
    const filed = planFingerprints(bundledSlate(), null);
    const plan = await refileAndReopen(storage, filed,
      { analysis: "00000000", rateCard: filed.rateCard });
    try {
      const before = storage.getItem(PLAN_STORAGE_KEY);
      plan.document.getElementById("plan-scope-keep").click();
      assert.ok(plan.notice().hidden, "the notice is answered and goes");
      assert.equal(storage.getItem(PLAN_STORAGE_KEY), before,
        "keeping a plan as filed must not rewrite it");
      assert.equal(readStoredPlan(storage).record.analysisFingerprint, filed.analysis);
      assert.equal(plan.committedCount(), "1");
    } finally {
      plan.restore();
    }
  });

// ---------------------------------------------------------------------------
// 4. Clearing the plan.
// ---------------------------------------------------------------------------

test("clearing the plan removes the stored record and empties the section", async () => {
  const storage = storageOf();
  const today = planFingerprints(bundledSlate(), null);
  const first = await openPlan(storage, today);
  try {
    fileAPlan(first);
  } finally {
    first.restore();
  }

  const plan = await openPlan(storage, today);
  try {
    const control = plan.clear();
    assert.equal(textOf(control), PLAN_SCOPE_CLEAR_LABEL);
    assert.equal(control.parentNode.hidden, false, "a filed plan can be cleared");
    control.click();

    assert.equal(storage.getItem(PLAN_STORAGE_KEY), null);
    assert.equal(storage.size(), 0);
    assert.equal(plan.committedCount(), "0");
    assert.ok(plan.figure().includes("$0 planned"), plan.figure());
    assert.equal(plan.control(0, "commit").checked, false);
    assert.equal(plan.control(0, "share").value, "");
    assert.equal(plan.control(0, "excluded").value, "");
    assert.ok(!plan.failure(), "clearing is not a read failure");
  } finally {
    plan.restore();
  }
});

// ---------------------------------------------------------------------------
// 5. The fingerprints themselves.
// ---------------------------------------------------------------------------

test("a fingerprint is stable for equal inputs and moves when a figure does", () => {
  const slate = bundledSlate();
  assert.equal(analysisFingerprint(slate), analysisFingerprint(bundledSlate()));
  const moved = {
    ...slate,
    rules: slate.rules.map((rule, index) => (index === 0
      ? { ...rule, expectedMonthlyUsd: rule.expectedMonthlyUsd + 1 }
      : rule)),
  };
  assert.notEqual(analysisFingerprint(moved), analysisFingerprint(slate));

  const card = { id: "acme", rates: { premium: 12, standard: 3 } };
  // Key order is not a change: the same card written two ways hashes the same.
  assert.equal(rateCardFingerprint(card),
    rateCardFingerprint({ rates: { standard: 3, premium: 12 }, id: "acme" }));
  assert.notEqual(rateCardFingerprint(card),
    rateCardFingerprint({ id: "acme", rates: { premium: 12, standard: 4 } }));
  assert.notEqual(rateCardFingerprint(card), rateCardFingerprint(null));
});
