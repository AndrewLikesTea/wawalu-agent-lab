import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { byClass, createElement, first, installDocument, tags } from "./support/dom.js";

installDocument();

import {
  DECISION_RETRY_LABEL,
  decisionDetailState,
  isRecoverableDecisionState,
  normalizeAlternatives,
  createComparisonState,
  renderDecisionDetail,
  renderDecisionDetailState,
  toggleAlternative,
  toggleComparison,
  resolveDecisionDetail,
} from "../src/decision-detail.js";

const DETAIL_STATES = ["loading", "empty", "not-found", "error"];

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
    loading: /decision record for this page and its linked releases/i,
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

// --- one primary state message, and only the actions the state is entitled to ---

test("each state names itself once, with its own status label and heading", () => {
  const seen = { label: new Set(), title: new Set(), guidance: new Set() };

  for (const state of DETAIL_STATES) {
    const container = createElement("div");
    const panel = renderDecisionDetailState(container, state, { onRetry() {} });

    // Exactly one heading in the panel: the primary state message, and nothing
    // beside it competing to be read first.
    const headings = [...tags(panel, "H1"), ...tags(panel, "H2"), ...tags(panel, "H3")];
    assert.equal(headings.length, 1, `${state}: one heading, so one primary message`);
    assert.equal(headings[0].className, "detail-state-title");

    const label = first(panel, "detail-state-label");
    assert.ok(label.classes.includes("detail-state-chip"),
      `${state}: the status label uses the shared chip, so the word carries the state`);
    // A tone class, never a bare colour: the wash only agrees with the word.
    assert.ok(label.classes.some((name) => name.startsWith("detail-state-chip-")), `${state}: chip carries a tone`);

    seen.label.add(label.textContent);
    seen.title.add(headings[0].textContent);
    seen.guidance.add(first(panel, "detail-state-guidance").textContent);
  }

  for (const [what, values] of Object.entries(seen)) {
    assert.equal(values.size, DETAIL_STATES.length, `two decision states share a ${what}`);
  }
});

test("retry is offered for a failed read and refused for states a second look cannot change", () => {
  assert.deepEqual(DETAIL_STATES.filter(isRecoverableDecisionState), ["error"]);

  for (const state of DETAIL_STATES) {
    const container = createElement("div");
    let retries = 0;
    const panel = renderDecisionDetailState(container, state, { onRetry: () => { retries += 1; } });
    const buttons = tags(panel, "BUTTON");

    assert.equal(panel.dataset.recoverable, String(state === "error"));
    if (state !== "error") {
      assert.equal(buttons.length, 0, `${state}: retrying cannot change this outcome, so nothing offers it`);
      continue;
    }
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].textContent, DECISION_RETRY_LABEL, "the retry says what it retries");
    assert.equal(buttons[0].type, "button", "a real button, so Enter and Space already work");
    buttons[0].dispatch("click");
    assert.equal(retries, 1);
  }
});

test("a caller with no retry handler renders the failure without a dead control", () => {
  const container = createElement("div");
  const panel = renderDecisionDetailState(container, "error");
  assert.equal(tags(panel, "BUTTON").length, 0);
  assert.match(panel.textContent, /trying again is safe/i);
});

test("recovery follows the words that explain it, and return navigation stays first", () => {
  const container = createElement("div");
  const panel = renderDecisionDetailState(container, "error", { onRetry() {} });

  // Reading order inside the panel: status label, heading, sentence, then the
  // action. Tab order is the same, because both are DOM order here.
  assert.deepEqual(panel.children.map((child) => child.className), [
    "detail-state-label detail-state-chip detail-state-chip-error",
    "detail-state-title",
    "detail-state-guidance",
    "detail-state-actions",
  ]);

  // The two operable things on a failed first screen, in the order they are met.
  const operable = [...tags(container, "A"), ...tags(container, "BUTTON")];
  assert.equal(operable[0].textContent, "← Back to Decisions");
  assert.equal(container.children[0], tags(container, "A")[0], "the labelled route back is still first");
  assert.equal(tags(container, "BUTTON")[0].textContent, DECISION_RETRY_LABEL);
  // Script-only focus targets for the moment a retry replaces the button.
  assert.equal(panel.getAttribute("tabindex"), "-1");
});

test("every state keeps a labelled route back to Decisions", () => {
  for (const state of DETAIL_STATES) {
    const container = createElement("div");
    renderDecisionDetailState(container, state, { onRetry() {} });
    const back = tags(container, "A")[0];
    assert.equal(back.href, "/", `${state}: the route back points at Decisions`);
    assert.match(back.textContent, /Back to Decisions/, `${state}: the route back is labelled`);
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
  assert.match(page, /renderDecisionDetailState\(container, "error", retry\)/);
  assert.match(html, /href="\/">← Back to Decisions<\/a>/);
  assert.match(css, /@media\(max-width:760px\)/);
});

test("decision list links each card to its detail page", async () => {
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(app, /decision-detail-link/);
  assert.match(app, /\/decision\.html\?id=\$\{encodeURIComponent/);
});
