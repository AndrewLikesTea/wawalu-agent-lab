import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  normalizeAlternatives,
  createComparisonState,
  toggleAlternative,
  toggleComparison,
  resolveDecisionDetail,
} from "../src/decision-detail.js";

const alternatives = normalizeAlternatives({ alternatives: [
  { id: "a", name: "Queue", summary: "Durable", pros: ["Retries", ""], cons: ["Cost"], effort: "Medium", risk: "Low", selected: true },
  { id: "b", name: "Polling", summary: "Periodic", pros: ["Simple"], cons: ["Load"], effort: "Medium", risk: "Medium", selected: true },
  { id: "c", name: "Memory", summary: "Local", selected: true },
] });

test("normalizes structured alternatives and bounds initial selection", () => {
  assert.equal(alternatives.length, 3);
  assert.deepEqual(alternatives[0].pros, ["Retries"]);
  assert.equal(alternatives[2].effort, "Not assessed");
  assert.deepEqual(createComparisonState(alternatives), { selectedIds: ["a", "b"], comparisonVisible: false });
});

test("normalizes legacy free text without inventing pros and cons", () => {
  const [legacy] = normalizeAlternatives({ alternatives: "Database polling." });
  assert.equal(legacy.name, "Recorded alternative");
  assert.equal(legacy.summary, "Database polling.");
  assert.deepEqual(legacy.pros, []);
  assert.deepEqual(normalizeAlternatives({}), []);
});

test("selection stays unique, valid, and capped at two", () => {
  let state = { selectedIds: ["a", "b"], comparisonVisible: true };
  state = toggleAlternative(state, "c", alternatives);
  assert.deepEqual(state, { selectedIds: ["b", "c"], comparisonVisible: true });
  state = toggleAlternative(state, "b", alternatives);
  assert.deepEqual(state, { selectedIds: ["c"], comparisonVisible: false });
  assert.strictEqual(toggleAlternative(state, "missing", alternatives), state);
});

test("comparison can only open with exactly two alternatives", () => {
  assert.equal(toggleComparison({ selectedIds: ["a"], comparisonVisible: false }).comparisonVisible, false);
  assert.equal(toggleComparison({ selectedIds: ["a", "b"], comparisonVisible: false }).comparisonVisible, true);
  assert.equal(toggleComparison({ selectedIds: ["a", "b"], comparisonVisible: true }).comparisonVisible, false);
});

test("resolves known decisions and rejects stale ids", () => {
  const decisions = [{ id: "known", title: "Known" }];
  assert.equal(resolveDecisionDetail(decisions, "known"), decisions[0]);
  assert.equal(resolveDecisionDetail(decisions, "stale"), null);
  assert.equal(resolveDecisionDetail(undefined, "known"), null);
});

test("detail page uses semantic landmarks and safe DOM rendering", async () => {
  const read = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
  const [html, component, page, css] = await Promise.all([
    read("decision.html"), read("decision-detail.js"), read("decision-page.js"), read("styles.css"),
  ]);
  assert.match(html, /id="decision-detail"/);
  assert.match(html, /aria-label="Decision detail"/);
  assert.match(component, /aria-live/);
  assert.match(component, /aria-controls/);
  assert.match(component, /el\("table"/);
  assert.doesNotMatch(`${component}\n${page}`, /innerHTML/);
  assert.match(css, /@media\(max-width:760px\)/);
});

test("decision list links each card to its detail page", async () => {
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(app, /decision-detail-link/);
  assert.match(app, /\/decision\.html\?id=\$\{encodeURIComponent/);
});
