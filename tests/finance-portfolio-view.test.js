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
import { byClass, installDocument, tags, walk } from "./support/dom.js";

installDocument();

const {
  MAX_TEXT_LENGTH, mountFinancePortfolio, renderPortfolioCard,
  renderPortfolioUnavailable, renderPortfolioUnsupported,
  renderRemainingOpportunities, safeText,
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
  // Two attributes are set on a card and no more: the disclosure's accessible
  // name, which carries fixture text, and the decorative mark's aria-hidden.
  // Keeping the list this short is what makes "no fixture value reaches an
  // attribute" checkable at a glance.
  for (const node of walk(card, () => true)) {
    const allowed = node.tagName === "SUMMARY" ? ["aria-label"]
      : node.classes.includes("portfolio-comparison-mark") ? ["aria-hidden"] : [];
    assert.deepEqual(Object.keys(node.attributes), allowed, node.tagName);
    assert.deepEqual(Object.keys(node.listeners), [], node.tagName);
  }
});

// The card above is no longer what the page paints: the panel now leads with a
// recommendation and folds the rest into a disclosure. Hostile text has to be
// checked on what is actually painted, or the guarantee covers a code path a
// reader never sees.
test("the painted panel renders hostile export text as inert text end to end", () => {
  const { hostile } = withHostileText();
  const nodes = panel();
  mountFinancePortfolio(createFinancePortfolio(hostile), nodes);
  for (const details of tags(nodes.list, "DETAILS")) details.open = true;

  assert.ok(nodes.list.textContent.includes(XSS));
  for (const tagName of ["IMG", "SCRIPT", "IFRAME", "SVG"])
    assert.deepEqual(tags(nodes.list, tagName), [], tagName);

  // The panel's only link is the commitment handoff, and its href is a literal
  // written in the module. No fixture value reaches a URL or a listener.
  const links = tags(nodes.list, "A");
  assert.equal(links.length, 1);
  assert.equal(links[0].href, "/savings-commitment.html");
  for (const node of walk(nodes.list, () => true))
    assert.deepEqual(Object.keys(node.listeners ?? {}), [], node.tagName);
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
    "Measurement period unavailable", "Provenance unavailable", "Priority --",
  ]) assert.ok(text.includes(fallback), fallback);
  // A missing target must not be reported as a $0 target, which reads as a
  // target that was trivially met.
  assert.match(text, /Target recoverable spend Unavailable/);
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

test("card reading order leads from action to money, status, confidence, and next step", () => {
  const portfolio = createFinancePortfolio(fixture);
  const card = renderPortfolioCard(portfolio, portfolio.select()[0]);
  const article = tags(card, "ARTICLE")[0];

  assert.deepEqual(article.children.map((node) => node.className), [
    "portfolio-card-heading", "portfolio-money-block", "portfolio-status-line",
    "portfolio-next", "portfolio-comparison", "portfolio-details",
  ]);
  assert.equal(tags(article.children[0], "H3").length, 1);
  assert.match(article.children[1].textContent, /Savings target/);
  assert.match(article.children[2].textContent, /Confidence ·/);
  assert.match(article.children[3].textContent, /Next action:/);
});

// Every dollar figure on a card covers one 31-day measurement period. Labelling
// one "annual" would overstate the result by roughly twelve times, so the word
// is barred from the card and the period is stated next to the figures.
test("money figures are labelled by period, never annualized, and pair with their labels", () => {
  const portfolio = createFinancePortfolio(fixture);
  for (const action of portfolio.select()) {
    const card = renderPortfolioCard(portfolio, action);
    assert.doesNotMatch(card.textContent, /annual|per year|\/yr/i, action.actionId);
    assert.match(byClass(card, "portfolio-period")[0].textContent,
      /^Measured over \d+ \w+–\d+ \w+ \d{4}\.$/, action.actionId);
  }

  // Only a verified result may be labelled "verified"; a completed one that has
  // not been through evidence review says "realized".
  const labelsFor = (status) => {
    const action = portfolio.select().find((candidate) => candidate.status === status);
    const money = tags(renderPortfolioCard(portfolio, action), "DL")[0];
    assert.equal(money.className, "portfolio-money");
    assert.equal(tags(money, "DD").length, 2);
    return tags(money, "DT").map((node) => node.textContent);
  };
  assert.deepEqual(labelsFor("verified"), ["Savings target", "Verified savings"]);
  assert.deepEqual(labelsFor("completed"), ["Savings target", "Realized savings"]);

  // An unmeasured action says so in words; it must never show a $0 result,
  // which reads as a measured failure rather than an absent measurement.
  const planned = portfolio.select().find((action) => action.status === "planned");
  const plannedMoney = tags(renderPortfolioCard(portfolio, planned), "DL")[0];
  assert.equal(tags(plannedMoney, "DD")[1].textContent, "Not yet measured");
  assert.equal(byClass(plannedMoney, "money-measure")[1].dataset.value, "none");
});

test("savings outcome states each pair a mark, a verdict, and the dollar gap", () => {
  const portfolio = createFinancePortfolio(fixture);
  const actions = portfolio.select();
  const outcome = (action) =>
    byClass(renderPortfolioCard(portfolio, action), "portfolio-comparison")[0];

  const awaiting = outcome(actions.find((action) => action.status === "planned"));
  assert.equal(awaiting.dataset.outcome, "unavailable");
  assert.match(awaiting.textContent, /— Savings outcome: Not yet measured\..*No realized savings/);

  const short = outcome(actions.find((action) => portfolio.comparison(action)?.amountUsd > 0));
  assert.equal(short.dataset.outcome, "short");
  assert.match(short.textContent,
    /↓ Savings outcome: Short of target\. \$[\d,]+ \(\d+(\.\d+)?%\) below the \$[\d,]+ savings target\./);

  const met = outcome({ ...actions[0], estimatedImpactUsd: 500, realizedImpact: { value: 500 } });
  assert.equal(met.dataset.outcome, "met");
  assert.match(met.textContent, /✓ Savings outcome: Target met\. Matched the \$500 savings target exactly\./);

  const above = outcome({ ...actions[0], estimatedImpactUsd: 500, realizedImpact: { value: 700 } });
  assert.equal(above.dataset.outcome, "met");
  assert.match(above.textContent, /Target met\. \$200 \(40%\) above the \$500 savings target\./);

  // A result larger than the recoverable spend it was measured against cannot
  // be savings, so it is never presented as a target that was beaten.
  const impossible = outcome({
    ...actions[0], estimatedImpactUsd: 100,
    baseline: { value: 8_222 }, realizedImpact: { value: 2_000_000_000 },
  });
  assert.equal(impossible.dataset.outcome, "not-usable");
  assert.match(impossible.textContent,
    /! Savings outcome: Result not usable\..*larger than the \$8,222 of recoverable spend.*Confirm the units/);

  const unanchored = outcome({
    ...actions[0], baseline: undefined, realizedImpact: { value: 100 },
  });
  assert.equal(unanchored.dataset.outcome, "not-usable");
  assert.match(unanchored.textContent, /baseline spend for this action is unavailable/);
});

// The verdict has to survive with colour, the mark, and aria-label all gone —
// aria-label on a plain element is routinely dropped by assistive technology,
// so nothing may be said only there.
test("outcome verdicts read from visible text alone, without color or aria-label", () => {
  const portfolio = createFinancePortfolio(fixture);
  for (const action of portfolio.select()) {
    const comparison = byClass(renderPortfolioCard(portfolio, action), "portfolio-comparison")[0];
    assert.equal(comparison.getAttribute("aria-label"), null, action.actionId);
    assert.equal(byClass(comparison, "portfolio-comparison-mark")[0].getAttribute("aria-hidden"),
      "true", action.actionId);
    const words = tags(comparison, "STRONG")[0].textContent;
    assert.match(words, /^Savings outcome: (Not yet measured|Result not usable|Target met|Short of target)\.$/);
  }
});

test("evidence disclosure explains where the target came from, without restating the card", () => {
  const portfolio = createFinancePortfolio(fixture);
  const card = renderPortfolioCard(portfolio, portfolio.select()[0]);
  const details = tags(card, "DETAILS")[0];
  const summary = tags(details, "SUMMARY")[0];
  assert.equal(summary.textContent, "Review owner, provenance, and evidence");
  assert.match(summary.getAttribute("aria-label"),
    /^Review owner, provenance, and evidence for /);
  // The savings target is the gap between these two figures, so the disclosure
  // is auditable rather than decorative.
  assert.match(details.textContent,
    /Accountable owner.*Baseline recoverable spend \$[\d,]+ over .*Target recoverable spend \$[\d,]+ or less over /);
  assert.match(details.textContent, /Confidence provenance:/);
  // Confidence and status are on the face of the card; repeating them here
  // would be surface, not evidence.
  assert.doesNotMatch(tags(details, "DL")[0].textContent, /Confidence/);
});

test("filters rebuild from data, stay keyboard-native, and keep an accessible empty state", () => {
  const nodes = panel();
  const portfolio = createFinancePortfolio(fixture);
  mountFinancePortfolio(portfolio, nodes);

  assert.deepEqual(nodes.department.children.map((option) => option.value),
    ["all", ...portfolio.departments().map((department) => department.id)]);
  assert.equal(nodes.count.textContent, "5 actions shown");
  // One recommendation leads; the other four are one progressively disclosed group.
  assert.equal(nodes.list.children.length, 2);
  assert.equal(nodes.list.children[0].className, "portfolio-recommendation");
  assert.equal(nodes.list.children[1].className, "portfolio-more");

  nodes.department.value = "quality";
  nodes.state.value = "verified";
  nodes.department.dispatch("change");
  assert.equal(nodes.count.textContent, "1 action shown");
  assert.equal(nodes.verified.textContent, "$2,196");

  nodes.state.value = "planned";
  nodes.state.dispatch("change");
  assert.equal(nodes.count.textContent, "0 actions shown");
  assert.equal(nodes.list.children.length, 1);
  assert.equal(nodes.list.children[0].className, "portfolio-message");
  assert.equal(nodes.list.children[0].dataset.state, "empty");
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
  assert.equal(item.dataset.state, "error");
  assert.equal(item.getAttribute("role"), "alert");
  assert.match(item.textContent, /Portfolio unavailable/);
  assert.match(item.textContent, /could not be read/);
});

test("the primary state leads with exactly one ranked action and commitment handoff", () => {
  const nodes = panel();
  const portfolio = createFinancePortfolio(fixture);
  mountFinancePortfolio(portfolio, nodes);
  const recommendation = nodes.list.children[0];

  assert.equal(byClass(nodes.list, "portfolio-recommendation").length, 1);
  assert.equal(tags(recommendation, "H3")[0].textContent, portfolio.select()[0].title);
  assert.match(recommendation.textContent, /Recoverable spend benchmark.*Confidence.*Owning department/);
  const links = tags(recommendation, "A");
  assert.equal(links.length, 1);
  assert.equal(links[0].href, "/savings-commitment.html");
  assert.equal(links[0].textContent, "Continue to commitment");
});

test("multiple opportunities consolidate related findings behind native disclosure", () => {
  const nodes = panel();
  mountFinancePortfolio(createFinancePortfolio(fixture), nodes);
  const details = tags(nodes.list.children[1], "DETAILS")[0];

  assert.equal(tags(details, "SUMMARY")[0].textContent, "Review 4 remaining opportunities");
  assert.equal(details.getAttribute("aria-expanded"), null);
  // The two remaining repeated down-routing findings become one supporting item.
  assert.equal(byClass(details, "portfolio-opportunity").length, 3);
  assert.match(details.textContent, /projected recovery.*confidence.*Evidence:/);
});

test("expanded disclosure relies on synchronized native details semantics", () => {
  const nodes = panel();
  mountFinancePortfolio(createFinancePortfolio(fixture), nodes);
  const details = tags(nodes.list.children[1], "DETAILS")[0];
  details.open = true;

  assert.equal(details.open, true);
  assert.equal(details.getAttribute("aria-expanded"), null,
    "native details must not retain a hard-coded false aria-expanded value");
  assert.ok(byClass(details, "portfolio-opportunity").length > 0);
});

// The narrow check above can only fail on the one element it names. A static
// aria-expanded is a lie wherever it is written — on the summary, on a wrapper,
// on a card's own disclosure — because nothing in this module observes the
// toggle, so nothing can ever update it. The guard is therefore that the
// attribute appears nowhere in the painted panel.
test("nothing in the painted portfolio writes an aria-expanded it cannot update", () => {
  const nodes = panel();
  mountFinancePortfolio(createFinancePortfolio(fixture), nodes);
  const disclosures = tags(nodes.list, "DETAILS");
  assert.ok(disclosures.length >= 2, "recommendation and remaining opportunities both disclose");

  for (const details of disclosures) details.open = true;
  for (const node of walk(nodes.list, () => true))
    assert.equal(node.attributes?.["aria-expanded"], undefined, node.tagName);
});

test("the lead recommendation is traceable to its own evidence and provenance", () => {
  const nodes = panel();
  const portfolio = createFinancePortfolio(fixture);
  mountFinancePortfolio(portfolio, nodes);
  const details = tags(nodes.list.children[0], "DETAILS")[0];
  const records = portfolio.evidenceFor(portfolio.select()[0]);

  assert.ok(records.length > 0, "the top-ranked action carries evidence in the fixture");
  assert.equal(byClass(details, "portfolio-evidence")[0].children.length, records.length);
  assert.match(details.textContent, /Confidence provenance:/);
  assert.match(details.textContent, /Baseline recoverable spend/);
});

// Consolidation re-attributes money: a group states one heading, one diagnosis,
// and the sum of its members. Merging two findings that are not the same finding
// therefore makes one of them disappear into the other's narrative while its
// dollars are still counted, and an export chooses the titles.
test("consolidation groups by authored title, never by the truncated display text", () => {
  const prefix = "a".repeat(MAX_TEXT_LENGTH);
  const value = { value: 0.9 };
  const item = renderRemainingOpportunities({ evidenceFor: () => [] }, [
    { title: `${prefix} first`, estimatedImpactUsd: 10, confidence: value },
    { title: `${prefix} second`, estimatedImpactUsd: 20, confidence: value },
    { title: undefined, estimatedImpactUsd: 30, confidence: value },
    { title: "   ", estimatedImpactUsd: 40, confidence: value },
    { title: "row:2", estimatedImpactUsd: 50, confidence: value },
  ]);
  const opportunities = byClass(item, "portfolio-opportunity");

  // Five findings, five items: a shared 320-character prefix, two titles that
  // are unusable in different ways, and a title shaped like the key this module
  // gives an untitled row all stay separate.
  assert.equal(opportunities.length, 5);
  for (const opportunity of opportunities)
    assert.doesNotMatch(opportunity.textContent, /related findings/);
});

test("a genuine merge states how many findings it summed", () => {
  const nodes = panel();
  mountFinancePortfolio(createFinancePortfolio(fixture), nodes);
  const merged = byClass(nodes.list, "portfolio-opportunity")
    .filter((item) => /related findings/.test(item.textContent));

  assert.equal(merged.length, 1);
  assert.match(byClass(merged[0], "portfolio-opportunity-summary")[0].textContent,
    /projected recovery · .+ confidence · .+ · 2 related findings$/);
});

// One hostile row chooses how many evidence refs and departments a line names.
// Each value is length-bounded on its own, so an unbounded join is the way the
// bound is escaped: the count is the input the module does not control.
test("a consolidated line stays bounded however many findings feed it", () => {
  const flood = Array.from({ length: 40 }, (_, index) => ({
    sampleId: `sample-${index}`, category: "c".repeat(MAX_TEXT_LENGTH),
  }));
  const item = renderRemainingOpportunities({ evidenceFor: () => flood },
    Array.from({ length: 40 }, (_, index) => ({
      title: "One finding", departmentName: `Department ${index}`,
      estimatedImpactUsd: 1, confidence: { value: 0.9 },
    })));
  const summary = byClass(item, "portfolio-opportunity-summary")[0].textContent;

  assert.match(summary, /Department 0, Department 1, Department 2, and 37 more/);
  // 40 findings each citing the same 40 records is 1600 references and 40
  // distinct rows; the line names three of them and counts the rest.
  assert.match(byClass(item, "portfolio-opportunity-evidence")[0].textContent,
    /^Evidence: sample-0 · c+, sample-1 · c+, sample-2 · c+, and 37 more\.$/);
});

test("unsupported export or class evaluation has a distinct non-alert state", () => {
  const state = renderPortfolioUnsupported();
  assert.equal(state.dataset.state, "unsupported");
  assert.equal(state.getAttribute("role"), null);
  assert.match(state.textContent, /cannot be ranked.*format or evaluated classes.*no recommendation/i);
});

// "Nothing to rank" is claimed from the portfolio's own rejection list rather
// than chosen by the call site, so the panel cannot say the export was fully
// understood when rows in it were skipped.
test("rows the analysis could not evaluate read as unrankable, not as no opportunity", () => {
  const unrankable = structuredClone(fixture);
  unrankable.actionPlan.actions = [];
  unrankable.portfolioLifecycle[0].actionId = XSS;
  const nodes = panel();
  mountFinancePortfolio(createFinancePortfolio(unrankable), nodes);
  const item = nodes.list.children[0];

  assert.equal(item.dataset.state, "unsupported");
  // Unsupported data is a state to read, not an alarm to clear: no alert wall.
  assert.equal(item.getAttribute("role"), null);
  assert.match(item.textContent, /could not be evaluated by this analysis/);
  assert.doesNotMatch(item.textContent, /No supported savings opportunity/);
  // The skipped rows are named from the export, so their ids are hostile text.
  for (const tagName of ["IMG", "SCRIPT", "IFRAME", "A"])
    assert.deepEqual(tags(item, tagName), [], tagName);
  assert.ok(item.textContent.length < MAX_TEXT_LENGTH * 2);
});

test("a supported evaluation with no opportunities names that empty result", () => {
  const emptyFixture = structuredClone(fixture);
  emptyFixture.actionPlan.actions = [];
  emptyFixture.portfolioLifecycle = [];
  const nodes = panel();
  nodes.department.value = "all";
  nodes.state.value = "all";
  mountFinancePortfolio(createFinancePortfolio(emptyFixture), nodes);

  assert.equal(nodes.list.children[0].dataset.state, "empty");
  assert.match(nodes.list.textContent, /No supported savings opportunity.*enough evidence/i);
  assert.doesNotMatch(nodes.list.textContent, /cannot be ranked/i);
});

// The loading row is served in the markup, so it is on screen before this
// module runs and exists in exactly one place. The assertions live with the
// other document checks in finance-portfolio.test.js.
