import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  confidenceLabel, createFinancePortfolio,
} from "../src/finance-portfolio.js";

const fixture = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8",
));

const withLifecycle = (rows) => createFinancePortfolio({ ...fixture, portfolioLifecycle: rows });
const statusOf = (portfolio, actionId) =>
  portfolio.select().find((action) => action.actionId === actionId)?.status;

test("portfolio values come from lifecycle snapshots and keep savings states distinct", () => {
  const portfolio = createFinancePortfolio(fixture);
  assert.deepEqual(portfolio.select().map(({ status }) => status),
    ["in_progress", "planned", "completed", "verified", "planned"]);
  assert.deepEqual(portfolio.summarize(), {
    projectedUsd: 18_275, completedUsd: 4_996, verifiedUsd: 2_196, actionCount: 5,
  });
  assert.deepEqual(portfolio.summarize({ state: "completed" }), {
    projectedUsd: 3_474, completedUsd: 2_800, verifiedUsd: 0, actionCount: 1,
  });
  assert.deepEqual(portfolio.rejectedLifecycle, []);
});

test("department and lifecycle filters compose and malformed state is resilient", () => {
  const portfolio = createFinancePortfolio(fixture);
  assert.equal(portfolio.select({ department: "quality", state: "verified" })[0].actionId,
    "action-quality-down-route-v1");
  assert.deepEqual(portfolio.select({ department: "quality", state: "planned" }), []);
  assert.equal(portfolio.select({ state: "corrupt" }).length, 5);
  assert.deepEqual(portfolio.select({ department: "missing" }), []);
});

test("filter values are looked up, never used as object keys", () => {
  const portfolio = createFinancePortfolio(fixture);
  for (const hostile of ["__proto__", "constructor", "toString"]) {
    assert.deepEqual(portfolio.select({ department: hostile }), []);
    assert.deepEqual(portfolio.select({ state: hostile }).length, 5);
    assert.equal(portfolio.periodFor(hostile), null);
  }
  assert.equal({}.polluted, undefined);
  assert.deepEqual(portfolio.select({ department: { id: "quality" } }).length, 5);
});

test("the department filter is derived from the actions that exist", () => {
  const portfolio = createFinancePortfolio(fixture);
  assert.deepEqual(portfolio.departments().map(({ id }) => id),
    ["backend", "data-ml", "frontend", "quality", "sre"]);
  for (const { id } of portfolio.departments())
    assert.ok(portfolio.select({ department: id }).length > 0, id);
});

test("one malformed lifecycle row never takes the whole portfolio offline", () => {
  const portfolio = withLifecycle([
    { actionId: "action-does-not-exist", status: "verified", realizedImpact: { value: 10 } },
    { actionId: "action-backend-down-route-v1", status: "in_progress" },
    { actionId: "action-backend-down-route-v1", status: "verified", realizedImpact: { value: 9e9 } },
    { actionId: "action-quality-down-route-v1", status: "teleported" },
    null,
  ]);

  assert.equal(portfolio.select().length, 5);
  assert.equal(statusOf(portfolio, "action-backend-down-route-v1"), "in_progress");
  assert.equal(statusOf(portfolio, "action-quality-down-route-v1"), "planned");
  assert.deepEqual(portfolio.rejectedLifecycle, [
    { actionId: "action-does-not-exist", code: "ACTION_NOT_FOUND" },
    { actionId: "action-backend-down-route-v1", code: "DUPLICATE_LIFECYCLE_ROW" },
    { actionId: "action-quality-down-route-v1", code: "INVALID_LIFECYCLE_ROW" },
    { actionId: "(unnamed)", code: "INVALID_LIFECYCLE_ROW" },
  ]);
  assert.equal(portfolio.summarize().completedUsd, 0);
});

test("an unmeasurable result leaves the action unclaimed rather than half-applied", () => {
  for (const realizedImpact of [undefined, {}, { value: null }, { value: "2800" },
    { value: Number.NaN }, { value: Number.POSITIVE_INFINITY }, { value: -1 }]) {
    const portfolio = withLifecycle([
      { actionId: "action-frontend-retry-workshop-v1", status: "completed", realizedImpact },
    ]);
    const totals = portfolio.summarize();
    // Savings are never claimed from a measurement the store would not accept,
    // and the action stays where it was rather than stranding mid-path.
    assert.equal(totals.completedUsd, 0, JSON.stringify(realizedImpact));
    assert.equal(totals.verifiedUsd, 0);
    assert.ok(Number.isFinite(totals.projectedUsd));
    assert.equal(statusOf(portfolio, "action-frontend-retry-workshop-v1"), "planned");
    assert.deepEqual(portfolio.rejectedLifecycle,
      [{ actionId: "action-frontend-retry-workshop-v1", code: "UNUSABLE_RESULT" }]);
  }
});

test("a result measured over the wrong period stops short instead of counting", () => {
  const portfolio = withLifecycle([{
    actionId: "action-frontend-retry-workshop-v1",
    status: "verified",
    realizedImpact: { value: 2_800, periodRef: "period-2026-06-25-2026-07-25" },
  }]);
  // Only the store knows which period a result belongs to, so this row is
  // caught mid-path: the action shows the progress that was proven and the
  // unearned savings are not counted.
  assert.equal(statusOf(portfolio, "action-frontend-retry-workshop-v1"), "in_progress");
  assert.equal(portfolio.summarize().completedUsd, 0);
  assert.deepEqual(portfolio.rejectedLifecycle,
    [{ actionId: "action-frontend-retry-workshop-v1", code: "INVALID_PERIOD" }]);
});

test("a missing or non-array lifecycle leaves every action projected", () => {
  for (const rows of [undefined, null, "verified", { actionId: "x" }]) {
    const portfolio = withLifecycle(rows);
    assert.deepEqual(new Set(portfolio.select().map(({ status }) => status)),
      new Set(["planned"]));
    assert.equal(portfolio.summarize().completedUsd, 0);
  }
});

test("comparison, evidence, periods, and confidence support progressive disclosure", () => {
  const portfolio = createFinancePortfolio(fixture);
  const verified = portfolio.select({ state: "verified" })[0];
  assert.deepEqual(portfolio.comparison(verified), { amountUsd: 243, percent: 10 });
  assert.equal(portfolio.evidenceFor(verified).length, 2);
  assert.equal(portfolio.periodFor(verified.target.periodRef).inclusiveDays, 31);
  assert.equal(confidenceLabel(verified.confidence), "High · 92%");
  assert.equal(confidenceLabel(), "Unavailable");
  assert.equal(confidenceLabel(null), "Unavailable");
  assert.equal(portfolio.comparison({}), null);
  assert.deepEqual(portfolio.evidenceFor({}), []);
  assert.ok(Object.isFrozen(portfolio.evidenceFor(verified)[0]));
});

test("finance leader UI has labelled native filters, resilient states, and non-color status cues", async () => {
  const [html, css, page, view] = await Promise.all([
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution.css", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/finance-portfolio-view.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<label for="portfolio-department">Department<\/label>/);
  assert.match(html, /<label for="portfolio-state">Lifecycle state<\/label>/);
  assert.match(html, /Projected savings/);
  assert.match(html, /Completed savings/);
  assert.match(html, /Verified savings/);
  assert.match(html, /id="portfolio-count" role="status"/);
  // The count announces filter results; a live region on the list itself would
  // re-read every card on every keystroke-driven filter change.
  assert.doesNotMatch(html, /<ol class="portfolio-list"[^>]*aria-live/);
  assert.match(html, /class="portfolio-filters" role="group"/);
  // The pre-module row ships in the markup so it is on screen before the module
  // runs, and it states an absence rather than a placeholder figure — or a
  // second "Loading…", which only #finops-load-state may say.
  assert.match(html, /aria-busy="true"[\s\S]*?data-state="loading" role="status"/);
  assert.match(html, /Fills in once the action lifecycle is read\./);
  assert.doesNotMatch(html.split("portfolio-list")[1].split("</ol>")[0], /\$0|\$—/);
  assert.match(css, /border-left-style:dashed/);
  assert.match(css, /border-left-style:double/);
  assert.match(view, /No matching portfolio actions/);
  assert.match(view, /Review owner, provenance, and evidence/);
  assert.match(view, /Savings outcome:/);
  // Each outcome state needs a shape or a mark of its own; colour alone cannot
  // be the difference between "target met" and "short of target".
  for (const state of ["short", "met", "not-usable", "unavailable"])
    assert.match(css, new RegExp(`\\[data-outcome="${state}"\\]`), state);
  assert.match(view, /OUTCOME_MARKS/);
  for (const source of [page, view])
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});
