// Render-layer tests for the finance-leader action portfolio.
//
// The portfolio renders strings it did not author — action titles, owner names,
// evidence summaries, provenance lines. These tests render the hostile version
// of each and assert it comes out as inert text: no element is ever created
// from fixture content, no attribute is ever set from it, and no invisible
// character survives to reorder a currency figure on a board-ready page.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { installDocument, tags, walk } from "./support/dom.js";

installDocument();

const {
  MAX_TEXT_LENGTH, mountFinancePortfolio, renderPortfolioCard,
  renderPortfolioUnavailable, safeText,
} = await import("../src/finance-portfolio-view.js");
const { createFinancePortfolio } = await import("../src/finance-portfolio.js");

const fixture = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8",
));

const XSS = "<img src=x onerror=alert(1)><script>alert(2)</script>";

function withHostileText() {
  const hostile = structuredClone(fixture);
  const [action] = hostile.actionPlan.actions;
  action.action = XSS;
  action.departmentName = `</ol><iframe src="javascript:alert(3)">`;
  action.accountableRole = "javascript:alert(4)";
  action.confidence.provenance = `"><svg onload=alert(5)>`;
  for (const record of hostile.evidence)
    if (record.sampleId === action.evidenceRefs[0]) record.summary = XSS;
  return { hostile, actionId: action.actionId };
}

function panel() {
  const make = (id) => {
    const node = document.createElement("div");
    node.id = id;
    return node;
  };
  return {
    department: make("department"), state: make("state"), list: make("list"),
    projected: make("projected"), completed: make("completed"),
    verified: make("verified"), count: make("count"),
  };
}

test("hostile fixture text renders as inert text, never as markup or attributes", () => {
  const { hostile, actionId } = withHostileText();
  const portfolio = createFinancePortfolio(hostile);
  const action = portfolio.select().find((item) => item.actionId === actionId);
  const card = renderPortfolioCard(portfolio, action);

  // The payload is present, and present only as text.
  assert.ok(card.textContent.includes(XSS));
  assert.ok(card.textContent.includes("javascript:alert(4)"));

  for (const tagName of ["IMG", "SCRIPT", "IFRAME", "SVG", "A"])
    assert.deepEqual(tags(card, tagName), [], tagName);

  // Nothing in a portfolio card is a link, an image, or a handler target, so no
  // fixture value can reach a URL or an event attribute.
  for (const node of walk(card, () => true)) {
    assert.deepEqual(Object.keys(node.attributes), [], node.tagName);
    assert.deepEqual(Object.keys(node.listeners), [], node.tagName);
  }
});

test("safeText bounds length, drops invisible characters, and refuses non-strings", () => {
  assert.equal(safeText("  spaced\n\tout  "), "spaced out");

  const overlong = safeText("a".repeat(5_000));
  assert.equal(overlong.length, MAX_TEXT_LENGTH);
  assert.ok(overlong.endsWith("…"));

  // A right-to-left override can make a currency figure read back to front on
  // a board slide. Written as escapes because the literals are invisible.
  const rightToLeftOverride = String.fromCharCode(0x202E);
  const zeroWidthSpace = String.fromCharCode(0x200B);
  assert.equal(safeText(`Savings ${rightToLeftOverride}0001$`), "Savings 0001$");
  assert.equal(safeText(`clean${zeroWidthSpace}text`), "cleantext");

  for (const value of [undefined, null, 42, { toString: () => XSS }, ["x"]])
    assert.equal(safeText(value), "Unavailable");
  assert.equal(safeText("   "), "Unavailable");
  assert.equal(safeText(null, "Owner unassigned"), "Owner unassigned");
});

test("an overlong hostile caption cannot flood the rendered card", () => {
  const { hostile, actionId } = withHostileText();
  hostile.actionPlan.actions[0].action = `${XSS}${"pad ".repeat(10_000)}`;
  const portfolio = createFinancePortfolio(hostile);
  const action = portfolio.select().find((item) => item.actionId === actionId);
  const heading = tags(renderPortfolioCard(portfolio, action), "H3")[0];
  assert.equal(heading.textContent.length, MAX_TEXT_LENGTH);
});

test("missing and malformed action values fall back instead of printing undefined", () => {
  const portfolio = createFinancePortfolio(fixture);
  const [real] = portfolio.select();
  const damaged = {
    ...real,
    title: undefined, accountableRole: { role: "ops" }, departmentName: null,
    priorityRank: Number.NaN, status: "not_a_state", confidence: { value: "high" },
    target: undefined, provenance: {},
  };
  const text = renderPortfolioCard(portfolio, damaged).textContent;

  assert.doesNotMatch(text, /undefined|NaN|\[object Object\]/);
  for (const fallback of [
    "Untitled action", "Owner unassigned", "State unavailable",
    "Period unavailable", "Provenance unavailable", "Priority --",
  ]) assert.ok(text.includes(fallback), fallback);
});

test("the bundled fixture renders in full, untruncated, with non-color state cues", () => {
  const portfolio = createFinancePortfolio(fixture);
  const seen = new Set();
  for (const action of portfolio.select()) {
    const card = renderPortfolioCard(portfolio, action);
    assert.ok(!card.textContent.includes("…"), action.actionId);
    assert.equal(card.dataset.state, action.status);
    // Every lifecycle state is readable as words, not only as a border style.
    assert.match(card.textContent,
      /Projected · planned|Projected · in progress|Completed · awaiting verification|Verified · evidence reviewed/);
    seen.add(action.status);
  }
  assert.deepEqual([...seen].sort(), ["completed", "in_progress", "planned", "verified"]);
});

test("filters rebuild from data, stay keyboard-native, and keep an accessible empty state", () => {
  const nodes = panel();
  const portfolio = createFinancePortfolio(fixture);
  mountFinancePortfolio(portfolio, nodes);

  assert.deepEqual(nodes.department.children.map((option) => option.value),
    ["all", ...portfolio.departments().map((department) => department.id)]);
  assert.equal(nodes.count.textContent, "5 actions shown");
  assert.equal(nodes.list.children.length, 5);

  nodes.department.value = "quality";
  nodes.state.value = "verified";
  nodes.department.dispatch("change");
  assert.equal(nodes.count.textContent, "1 action shown");
  assert.equal(nodes.verified.textContent, "$2,196");

  nodes.state.value = "planned";
  nodes.state.dispatch("change");
  assert.equal(nodes.count.textContent, "0 actions shown");
  assert.equal(nodes.list.children.length, 1);
  assert.equal(nodes.list.children[0].className, "portfolio-empty");
  assert.match(nodes.list.children[0].textContent, /No matching portfolio actions/);
  assert.equal(nodes.projected.textContent, "$0");
});

test("a hostile department name reaches the filter control as text only", () => {
  const { hostile } = withHostileText();
  const nodes = panel();
  mountFinancePortfolio(createFinancePortfolio(hostile), nodes);

  const injected = nodes.department.children
    .find((option) => option.textContent.includes("iframe"));
  assert.ok(injected);
  assert.deepEqual(tags(nodes.department, "IFRAME"), []);
  assert.deepEqual(Object.keys(injected.attributes), []);
});

test("an unreadable action plan states that no savings figure is shown", () => {
  assert.throws(() => createFinancePortfolio({ actionPlan: null }), /versioned action plan/);
  const item = renderPortfolioUnavailable(undefined);
  assert.match(item.textContent, /Portfolio unavailable/);
  assert.match(item.textContent, /could not be read/);
});
