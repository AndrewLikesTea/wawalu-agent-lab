import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { byClass, createElement, installDocument, tags } from "./support/dom.js";

installDocument();

import {
  decisionDetailState,
  normalizeAlternatives,
  createComparisonState,
  renderDecisionDetail,
  renderDecisionDetailState,
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

test("derives available, absent, not-found, and error states without conflating them", () => {
  assert.equal(decisionDetailState({ decision: { id: "known" }, unavailable: true }), "available");
  assert.equal(decisionDetailState(), "empty");
  assert.equal(decisionDetailState({ id: "stale" }), "not-found");
  assert.equal(decisionDetailState({ id: "stale", unavailable: true }), "error");
});

test("loading, absent, not-found, and error states explain the outcome and keep return navigation first", () => {
  const expected = {
    loading: /filling in the decision detail/i,
    empty: /No decision was specified/i,
    "not-found": /may have been removed/i,
    error: /temporarily unavailable/i,
  };

  for (const [state, copy] of Object.entries(expected)) {
    const container = createElement("div");
    const panel = renderDecisionDetailState(container, state);
    const links = tags(container, "A");
    assert.equal(container.children[0], links[0], `${state} return link should be first`);
    assert.equal(links[0].href, "/");
    assert.equal(links[0].textContent, "← Back to Decisions");
    assert.match(panel.textContent, copy);
    assert.equal(panel.getAttribute("role"), state === "error" ? "alert" : "status");
    assert.equal(panel.dataset.state, state);
  }
});

test("available detail renders labelled text, empty alternatives, and linked-release navigation in logical order", () => {
  const container = createElement("div");
  renderDecisionDetail(container, {
    id: "decision-1",
    title: "Keep durable jobs in a queue",
    status: "accepted",
    owner: "Mina",
    context: "Retries must survive a deploy.",
    alternatives: "",
    createdAt: "2026-07-01T00:00:00.000Z",
  }, {
    linkedReleases: [{
      id: "release 1",
      version: "v1.4.0",
      title: "Reliable jobs",
      status: "completed",
    }],
  });

  assert.equal(tags(container, "A")[0].textContent, "← Back to Decisions");
  assert.equal(tags(container, "H1")[0].textContent, "Keep durable jobs in a queue");
  assert.match(container.textContent, /Status accepted Owner Mina Recorded/);
  assert.match(container.textContent, /Context and rationale Retries must survive a deploy/);
  assert.match(container.textContent, /No alternatives were recorded/);
  assert.equal(byClass(container, "proof-relationship").length, 1);
  const links = tags(container, "A");
  assert.equal(links[1].href, "/release.html?id=release%201");
});

test("available detail omits the linked-release section when no release is associated", () => {
  const container = createElement("div");
  renderDecisionDetail(container, {
    id: "decision-2",
    title: "Use a cache",
    status: "proposed",
    owner: "Ari",
    context: "Reads are repeated.",
    alternatives: "No cache.",
    createdAt: "2026-07-01T00:00:00.000Z",
  });

  assert.equal(byClass(container, "proof-relationship").length, 0);
  assert.doesNotMatch(container.textContent, /Linked releases|No releases link/);
});

test("detail page uses semantic landmarks and safe DOM rendering", async () => {
  const read = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
  const [html, component, page, css] = await Promise.all([
    read("decision.html"), read("decision-detail.js"), read("decision-page.js"), read("styles.css"),
  ]);
  assert.match(html, /<title>Decision · Shiplog<\/title>/);
  assert.match(html, /id="decision-detail"/);
  assert.match(html, /aria-label="Decision detail"/);
  assert.match(component, /aria-live/);
  assert.match(component, /aria-controls/);
  assert.match(component, /role", state === "error" \? "alert" : "status"/);
  assert.match(component, /el\("table"/);
  assert.doesNotMatch(`${component}\n${page}`, /innerHTML/);
  // Resolution is synchronous, so the page must never enter a loading branch:
  // that branch is exactly how a visitor got stranded on "Loading decision".
  // The static loading state in decision.html stays as the pre-script paint.
  assert.doesNotMatch(page, /renderDecisionDetailState\(container, "loading"\)/);
  assert.match(page, /renderDecisionDetailState\(container, "error"\)/);
  assert.match(html, /href="\/">← Back to Decisions<\/a>/);
  assert.match(css, /@media\(max-width:760px\)/);
});

test("decision list links each card to its detail page", async () => {
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(app, /decision-detail-link/);
  assert.match(app, /\/decision\.html\?id=\$\{encodeURIComponent/);
});
