// The portfolio comparability contract, its samples, and the region that shows
// them.
//
// Three groups, checking different claims:
//
//   1. THE RULES. Coverage, alignment, comparability, confidence, and the
//      single next action are recomputed from the published definitions rather
//      than transcribed, including the cases where two of them disagree — full
//      coverage that is still not combinable is the interesting one.
//   2. THE SAMPLES. Four bundled portfolios, one per failure mode this page
//      claims to teach, each landing on the verdict and the action it is there
//      to demonstrate, and none of them carrying a cost, a credential, or
//      source material.
//   3. THE SURFACE. The shipped markup of src/evolution.html carries the
//      region, and the real page entry paints an answered question and a
//      keyboard-reachable action into it. A module with nothing rendering it
//      would pass a test that only checked the module.
//
// Nothing here reads a clock, a network, or a random source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  COMPARABILITY_VERDICT, FINDING_CODE, NO_ACTION_CODE, PORTFOLIO_COMPARABILITY_CONTRACT_ID,
  PORTFOLIO_QUESTIONS, PROVIDER_STATE, REMEDIATION_TIERS,
  calendarDate, deliveryCount, evaluatePortfolioComparability, roundRatio,
} from "../src/portfolio-comparability.js";
import {
  DEFAULT_SAMPLE_ID, PORTFOLIO_SAMPLES, evaluateSample, portfolioSample,
} from "../src/portfolio-comparability-samples.js";
import {
  PORTFOLIO_BODY_ID, PORTFOLIO_SAMPLE_SELECT_ID, PORTFOLIO_SECTION_ID,
  applyPortfolioComparability, bindPortfolioSamples,
} from "../src/portfolio-comparability-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));
const SERVED = {
  "/evolution-demo-data.json": DEMO_DATA,
  "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
};

const html = await readFile(PAGE, "utf8");
const byId = (document, id) => document.getElementById(id);
const PERIOD = { start: "2026-06-01", end: "2026-07-01" };

const record = (providerId, overrides = {}) => ({
  providerId,
  periodStart: PERIOD.start,
  periodEnd: PERIOD.end,
  currencyCode: "USD",
  deliveryCount: 1000,
  provenance: { label: `${providerId} usage export` },
  ...overrides,
});

const portfolio = (records, overrides = {}) => ({
  portfolioId: "test",
  currencyCode: "USD",
  requiredPeriodStart: PERIOD.start,
  requiredPeriodEnd: PERIOD.end,
  requiredProviders: ["openai", "anthropic", "aws"],
  records,
  ...overrides,
});

const providerOf = (result, id) => result.providers.find((entry) => entry.providerId === id);
const complete = () => [record("openai"), record("anthropic"), record("aws")];

// ---------------------------------------------------------------------------
// 1. The rules.
// ---------------------------------------------------------------------------

test("a complete portfolio is comparable, fully covered, and needs no action", () => {
  const result = evaluatePortfolioComparability(portfolio(complete()));
  assert.equal(result.contractId, PORTFOLIO_COMPARABILITY_CONTRACT_ID);
  assert.equal(result.verdict, COMPARABILITY_VERDICT.yes);
  assert.equal(result.comparable, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.coverage.available, true);
  assert.equal(result.coverage.coveredCount, 3);
  assert.equal(result.coverage.ratio, 1);
  assert.equal(result.confidence.ratio, 1);
  assert.equal(result.nextAction.code, NO_ACTION_CODE);
  assert.equal(result.findings.length, 0);
  for (const provider of result.providers) assert.equal(provider.state, PROVIDER_STATE.covered);
});

test("a missing provider lowers coverage and is the action, in declaration order", () => {
  // Two providers absent, so the tie-break is the visible part of the rule.
  const result = evaluatePortfolioComparability(portfolio([record("aws")]));
  assert.equal(result.verdict, COMPARABILITY_VERDICT.notYet);
  assert.equal(result.comparable, false);
  assert.equal(result.coverage.coveredCount, 1);
  assert.equal(result.coverage.ratio, roundRatio(1 / 3));
  assert.equal(providerOf(result, "openai").state, PROVIDER_STATE.missing);
  assert.equal(result.nextAction.code, FINDING_CODE.MISSING_PROVIDER);
  assert.equal(result.nextAction.providerId, "openai");
  assert.match(result.nextAction.statement, /openai/);
  assert.match(result.nextAction.statement, new RegExp(PERIOD.start));
});

test("a record that overlaps without matching contributes nothing to coverage", () => {
  const result = evaluatePortfolioComparability(portfolio([
    record("openai"), record("anthropic"), record("aws", { periodEnd: "2026-06-15" }),
  ]));
  const aws = providerOf(result, "aws");
  assert.equal(aws.covered, false);
  assert.equal(aws.state, PROVIDER_STATE.misaligned);
  assert.equal(result.coverage.coveredCount, 2);
  assert.equal(result.nextAction.code, FINDING_CODE.MISALIGNED_PERIOD);
  assert.equal(result.nextAction.providerId, "aws");
});

test("a record entirely outside the period is ignored rather than faulted", () => {
  const result = evaluatePortfolioComparability(portfolio([
    ...complete(),
    record("openai", { periodStart: "2026-07-01", periodEnd: "2026-08-01" }),
  ]));
  assert.equal(result.verdict, COMPARABILITY_VERDICT.yes);
  assert.equal(providerOf(result, "openai").intersectingCount, 1);
});

test("full coverage is still not combinable when one provider overlaps itself", () => {
  const result = evaluatePortfolioComparability(portfolio([
    ...complete(),
    record("anthropic", { periodStart: "2026-06-15", periodEnd: "2026-07-15" }),
  ]));
  // The distinction the two metrics exist to keep: everyone reported, and the
  // overlapping days still cannot be separated by arithmetic.
  assert.equal(result.coverage.ratio, 1);
  assert.equal(result.coverage.coveredCount, 3);
  assert.equal(result.comparable, false);
  assert.equal(result.verdict, COMPARABILITY_VERDICT.notYet);
  assert.equal(providerOf(result, "anthropic").state, PROVIDER_STATE.overlapping);
  assert.equal(result.nextAction.code, FINDING_CODE.OVERLAPPING_PERIOD);
  assert.equal(result.nextAction.providerId, "anthropic");
});

test("the same window supplied twice is a duplicate, not an overlap", () => {
  const result = evaluatePortfolioComparability(portfolio([...complete(), record("openai")]));
  const openai = providerOf(result, "openai");
  assert.equal(openai.state, PROVIDER_STATE.duplicate);
  assert.equal(openai.covered, false, "two aligned records are not exactly one");
  assert.equal(result.coverage.coveredCount, 2);
  assert.equal(result.nextAction.code, FINDING_CODE.DUPLICATE_RECORD);
});

test("an aligned record in another currency is held out and named", () => {
  const result = evaluatePortfolioComparability(portfolio([
    record("openai"), record("anthropic"), record("aws", { currencyCode: "EUR" }),
  ]));
  assert.equal(result.comparable, false);
  assert.equal(providerOf(result, "aws").state, PROVIDER_STATE.incompatibleCurrency);
  assert.equal(result.coverage.coveredCount, 2);
  assert.equal(result.nextAction.code, FINDING_CODE.INCOMPATIBLE_CURRENCY);
  // No rate is applied and no converted figure is invented anywhere.
  assert.match(result.nextAction.statement, /no conversion rate|applies no conversion rate/);
});

test("an undeclared provider never changes coverage, but its currency still blocks", () => {
  const clean = evaluatePortfolioComparability(portfolio([...complete(), record("azure")]));
  assert.equal(clean.coverage.requiredCount, 3);
  assert.equal(clean.coverage.ratio, 1);
  assert.equal(clean.verdict, COMPARABILITY_VERDICT.yes);
  assert.equal(providerOf(clean, "azure").state, PROVIDER_STATE.undeclared);

  const foreign = evaluatePortfolioComparability(portfolio([
    ...complete(), record("azure", { currencyCode: "GBP" }),
  ]));
  assert.equal(foreign.coverage.ratio, 1, "coverage counts required providers only");
  assert.equal(foreign.comparable, false, "an aligned record in another currency is in the window");
});

test("an unreadable delivery count is not a zero", () => {
  for (const value of [-1, 1.5, "1204", null, undefined]) {
    const result = evaluatePortfolioComparability(portfolio([
      record("openai"), record("anthropic"), record("aws", { deliveryCount: value }),
    ]));
    const aws = providerOf(result, "aws");
    assert.equal(aws.covered, false, `${String(value)} was accepted as a count`);
    assert.equal(aws.deliveryCount, null);
    assert.equal(result.nextAction.code, FINDING_CODE.UNREADABLE_COUNT);
  }
  assert.equal(deliveryCount(0), 0, "zero deliveries is a reading, not an absence");
});

test("no declared portfolio is unavailable coverage, not 100%", () => {
  const result = evaluatePortfolioComparability(portfolio(complete(), { requiredProviders: [] }));
  assert.equal(result.verdict, COMPARABILITY_VERDICT.no);
  assert.equal(result.coverage.available, false);
  assert.equal(result.coverage.ratio, null);
  assert.equal(result.confidence.available, false);
  assert.ok(result.errors.some((error) => /requiredProviders/.test(error)));
  // "No" is not "not yet": no record supplied later answers an unasked question.
  assert.equal(result.nextAction.code, NO_ACTION_CODE);
  assert.equal(result.nextAction.focus, "declaration");
});

test("an invalid period or currency is refused rather than guessed", () => {
  for (const override of [
    { requiredPeriodStart: "2026-02-30" },
    { requiredPeriodEnd: "not-a-date" },
    { requiredPeriodStart: "2026-07-01", requiredPeriodEnd: "2026-07-01" },
    { currencyCode: "dollars" },
  ]) {
    const result = evaluatePortfolioComparability(portfolio(complete(), override));
    assert.equal(result.verdict, COMPARABILITY_VERDICT.no, JSON.stringify(override));
    assert.equal(result.declaration.valid, false);
    assert.ok(result.errors.length > 0);
  }
  assert.equal(calendarDate("2028-02-29"), "2028-02-29", "a leap day is a real date");
  assert.equal(calendarDate("2026-02-29"), null);
  // Never throws at this boundary: the panel says what is wrong instead of
  // going down with the reader's page.
  assert.equal(evaluatePortfolioComparability(undefined).verdict, COMPARABILITY_VERDICT.no);
  assert.equal(evaluatePortfolioComparability({ records: "not a list" }).providers.length, 0);
});

test("confidence is over covered providers, and is unavailable when none are", () => {
  const result = evaluatePortfolioComparability(portfolio([
    record("openai"), record("anthropic", { provenance: { label: "  " } }), record("aws"),
  ]));
  assert.equal(result.confidence.coveredCount, 3);
  assert.equal(result.confidence.attributedCount, 2);
  assert.equal(result.confidence.ratio, roundRatio(2 / 3));

  const empty = evaluatePortfolioComparability(portfolio([]));
  assert.equal(empty.confidence.available, false);
  assert.equal(empty.confidence.ratio, null);
});

test("only the provenance label survives; source material never leaves the record", () => {
  const result = evaluatePortfolioComparability(portfolio([
    record("openai", {
      provenance: {
        label: "OpenAI organization usage export",
        source: "/Users/lead/Downloads/january-invoice.csv",
        sourceRows: ["sk-live-000", "what is our churn"],
      },
    }),
    record("anthropic"), record("aws"),
  ]));
  assert.equal(providerOf(result, "openai").provenanceLabel, "OpenAI organization usage export");
  const serialized = JSON.stringify(result);
  for (const secret of ["january-invoice", "sk-live-000", "what is our churn", "Downloads"]) {
    assert.equal(serialized.includes(secret), false, `${secret} escaped into the verdict`);
  }
});

test("the remediation tiers are total, ordered, and pick exactly one action", () => {
  // Every fault at once. The tier order alone decides, not the record order.
  const result = evaluatePortfolioComparability(portfolio([
    record("openai", { currencyCode: "EUR" }),
    record("anthropic", { periodEnd: "2026-06-20" }),
    record("aws", { deliveryCount: null }),
  ], { requiredProviders: ["missing-one", "openai", "anthropic", "aws"] }));
  assert.equal(result.nextAction.code, FINDING_CODE.MISSING_PROVIDER);
  assert.equal(result.nextAction.providerId, "missing-one");

  const tiers = REMEDIATION_TIERS.flat();
  assert.equal(new Set(tiers).size, tiers.length, "a code appears in two tiers");
  assert.equal(tiers.includes(FINDING_CODE.UNDECLARED_PROVIDER), false,
    "an undeclared provider is never an instruction to the reader");

  // The same input evaluated twice is the same verdict, action included.
  const again = evaluatePortfolioComparability(portfolio([record("aws")]));
  const once = evaluatePortfolioComparability(portfolio([record("aws")]));
  assert.deepEqual(JSON.parse(JSON.stringify(again)), JSON.parse(JSON.stringify(once)));
});

test("the four questions are answered in the published order", () => {
  const result = evaluatePortfolioComparability(portfolio([record("aws")]));
  assert.deepEqual(result.answers.map((answer) => answer.id),
    PORTFOLIO_QUESTIONS.map((entry) => entry.id));
  assert.deepEqual(result.answers.map((answer) => answer.order), [1, 2, 3, 4]);
  assert.match(result.answers[0].headline, /Not yet/);
  assert.match(result.answers[1].headline, /1 of 3 providers/);
  assert.match(result.answers[2].headline, /provenance|source/i);
  assert.equal(result.answers[3].headline, result.nextAction.statement);
});

test("a verdict carries no cost, no spend, and no ranking of providers", () => {
  // Aggregating portfolio cost and ranking providers are different questions.
  // Neither is answered here, and neither may leak in as a field or a sentence.
  const serialized = JSON.stringify(evaluatePortfolioComparability(portfolio(complete())));
  for (const forbidden of ["cost", "spend", "amount", "price", "invoice", "rank"]) {
    assert.equal(serialized.toLowerCase().includes(forbidden), false,
      `"${forbidden}" appeared in a comparability verdict`);
  }
});

// ---------------------------------------------------------------------------
// 2. The samples.
// ---------------------------------------------------------------------------

test("each bundled sample lands on the verdict and the action it teaches", () => {
  const expected = {
    complete: [COMPARABILITY_VERDICT.yes, NO_ACTION_CODE],
    "missing-provider": [COMPARABILITY_VERDICT.notYet, FINDING_CODE.MISSING_PROVIDER],
    "overlapping-period": [COMPARABILITY_VERDICT.notYet, FINDING_CODE.OVERLAPPING_PERIOD],
    "incompatible-currency": [COMPARABILITY_VERDICT.notYet, FINDING_CODE.INCOMPATIBLE_CURRENCY],
  };
  assert.deepEqual(PORTFOLIO_SAMPLES.map((sample) => sample.id), Object.keys(expected));
  for (const [id, [verdict, action]] of Object.entries(expected)) {
    const { result, sample } = evaluateSample(id);
    assert.equal(result.verdict, verdict, id);
    assert.equal(result.nextAction.code, action, id);
    assert.ok(sample.teaches.length > 0, `${id} says nothing about why it is here`);
  }
  // The one that shows coverage and comparability disagreeing.
  assert.equal(evaluateSample("overlapping-period").result.coverage.ratio, 1);
  assert.equal(evaluateSample("missing-provider").result.coverage.ratio, roundRatio(2 / 3));
  // An unknown id falls back rather than painting nothing.
  assert.equal(portfolioSample("no-such-sample").id, DEFAULT_SAMPLE_ID);
});

test("no sample carries a credential, a prompt, a customer, or a file path", () => {
  const serialized = JSON.stringify(PORTFOLIO_SAMPLES).toLowerCase();
  for (const forbidden of ["prompt", "completion", "message", "sk-", "secret", "token",
    "password", "customer", "email", "@", "/users/", ".csv", "http"]) {
    assert.equal(serialized.includes(forbidden), false,
      `a bundled sample carries "${forbidden}"`);
  }
  for (const sample of PORTFOLIO_SAMPLES) {
    for (const entry of sample.portfolio.records) {
      assert.deepEqual(Object.keys(entry.provenance), ["label"]);
      assert.equal(Number.isInteger(entry.deliveryCount), true);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. The surface.
// ---------------------------------------------------------------------------

test("the region is authored in the shipped markup, on the import panel", () => {
  const document = parseHtml(html);
  const section = byId(document, PORTFOLIO_SECTION_ID);
  assert.ok(section, "the AI FinOps page ships no comparability region");
  assert.equal(section.dataset.verdict, "unavailable");
  assert.ok(byId(document, PORTFOLIO_BODY_ID), "the region has no body to paint into");
  assert.ok(byId(document, PORTFOLIO_SAMPLE_SELECT_ID), "the region has no sample chooser");
  // The question is the heading, in the contract's words.
  assert.equal(textOf(byId(document, "portfolio-comparability-title")),
    PORTFOLIO_QUESTIONS[0].question);
  // Inside the import panel, below the coverage panel it sits one level above.
  assert.ok(html.indexOf('id="provider-coverage"') < html.indexOf(`id="${PORTFOLIO_SECTION_ID}"`));
  assert.ok(html.indexOf(`id="${PORTFOLIO_SECTION_ID}"`) < html.indexOf('id="delivery-history"'));
  // And it says whose data judged it before it says anything else.
  assert.match(textOf(byId(document, "portfolio-comparability-marker")), /bundled sample/i);
  // The markup authors no verdict, percentage, provider name, or remediation.
  const authored = html.slice(html.indexOf(`id="${PORTFOLIO_SECTION_ID}"`),
    html.indexOf('id="delivery-history"')).replace(/<!--[\s\S]*?-->/g, "");
  for (const leak of ["openai", "anthropic", "Not yet", "%"]) {
    assert.equal(authored.includes(leak), false, `the markup hard-codes "${leak}"`);
  }
});

test("painting answers the four questions in order and offers one action", async () => {
  const { document } = await loadPage(PAGE);
  const painted = applyPortfolioComparability(document, evaluateSample("missing-provider"));
  assert.ok(painted, "the region painted nothing");
  const section = byId(document, PORTFOLIO_SECTION_ID);
  assert.equal(section.hidden, false);
  assert.equal(section.dataset.verdict, COMPARABILITY_VERDICT.notYet);
  assert.equal(section.dataset.coverage, String(painted.coverage.ratio));

  const answers = document.querySelectorAll(".portfolio-answer");
  assert.deepEqual([...answers].map((node) => node.dataset.answer),
    PORTFOLIO_QUESTIONS.map((entry) => entry.id));
  // The verdict is a word before it is a glyph or a tint, and none of the four
  // answers is behind a disclosure.
  assert.match(textOf(document.querySelector(".portfolio-verdict-word")), /Not yet/);
  for (const node of answers) assert.equal(node.closest("details"), null);

  const action = byId(document, "portfolio-comparability-action-jump");
  assert.ok(action, "a not-yet verdict offered no action");
  assert.equal(action.dataset.actionCode, FINDING_CODE.MISSING_PROVIDER);
  assert.ok(action.getAttribute("aria-label").includes(painted.nextAction.statement));
  assert.equal(textOf(byId(document, "portfolio-comparability-action")),
    `4. ${PORTFOLIO_QUESTIONS[3].question}${painted.nextAction.statement}`
    + painted.answers[3].detail);
});

test("per-provider detail stays behind progressive disclosure, shut on arrival", async () => {
  const { document } = await loadPage(PAGE);
  const painted = applyPortfolioComparability(document, evaluateSample("incompatible-currency"));
  const details = document.querySelector("details.portfolio-disclosure");
  assert.ok(details, "there is no disclosure");
  assert.equal(details.hasAttribute("open"), false);
  assert.ok(details.querySelector("summary"), "a disclosure with no summary cannot be operated");

  const rows = document.querySelectorAll(".portfolio-provider");
  assert.equal(rows.length, painted.providers.length);
  for (const row of rows) assert.ok(row.closest("details"), "provider detail escaped its disclosure");
  const aws = [...rows].find((row) => row.dataset.provider === "aws");
  assert.equal(aws.dataset.state, PROVIDER_STATE.incompatibleCurrency);
  assert.match(textOf(document.querySelector(".portfolio-basis")),
    new RegExp(PORTFOLIO_COMPARABILITY_CONTRACT_ID.replace(/[./]/g, "\\$&")));
});

test("a comparable portfolio offers no button to press past the verdict", async () => {
  const { document } = await loadPage(PAGE);
  applyPortfolioComparability(document, evaluateSample("complete"));
  assert.equal(byId(document, PORTFOLIO_SECTION_ID).dataset.verdict, COMPARABILITY_VERDICT.yes);
  assert.equal(byId(document, "portfolio-comparability-action-jump"), null);
  assert.match(textOf(byId(document, "portfolio-comparability-action")), /No action needed/);

  // And nothing to paint takes the region off screen rather than half-painting.
  assert.equal(applyPortfolioComparability(document, null), null);
  assert.equal(byId(document, PORTFOLIO_SECTION_ID).hidden, true);
  assert.equal(byId(document, PORTFOLIO_BODY_ID).children.length, 0);
});

test("choosing another sample repaints the verdict and the action", async () => {
  const { document } = await loadPage(PAGE);
  const seen = [];
  bindPortfolioSamples(document, evaluateSample, { onSelect: (e) => seen.push(e.sample.id) });
  const select = byId(document, PORTFOLIO_SAMPLE_SELECT_ID);
  assert.deepEqual([...select.querySelectorAll("option")].map((option) => option.value),
    PORTFOLIO_SAMPLES.map((sample) => sample.id));
  assert.deepEqual(seen, [DEFAULT_SAMPLE_ID]);
  assert.equal(byId(document, PORTFOLIO_SECTION_ID).dataset.verdict, COMPARABILITY_VERDICT.yes);

  // What choosing another option does, without going through the key handler:
  // the value changes and the control announces it.
  select.value = "overlapping-period";
  select.dispatchEvent({ type: "change", bubbles: true });
  assert.deepEqual(seen, [DEFAULT_SAMPLE_ID, "overlapping-period"]);
  const section = byId(document, PORTFOLIO_SECTION_ID);
  assert.equal(section.dataset.sample, "overlapping-period");
  assert.equal(section.dataset.verdict, COMPARABILITY_VERDICT.notYet);
  assert.equal(byId(document, "portfolio-comparability-action-jump").dataset.actionCode,
    FINDING_CODE.OVERLAPPING_PERIOD);
});

test("the shipped page entry paints the judgment with no fetch of its own", async () => {
  const { document } = await loadPage(PAGE, { routes: SERVED });
  await importPageModule("/evolution-page.js");
  await waitFor(() => byId(document, PORTFOLIO_SECTION_ID).dataset.verdict !== "unavailable",
    "the page entry never painted a comparability verdict");

  const section = byId(document, PORTFOLIO_SECTION_ID);
  assert.equal(section.dataset.verdict, COMPARABILITY_VERDICT.yes);
  assert.equal(section.dataset.sample, DEFAULT_SAMPLE_ID);
  assert.equal(document.querySelectorAll(".portfolio-answer").length, PORTFOLIO_QUESTIONS.length);
  // The chooser is reachable by keyboard without opening anything: the three
  // refusals are the part of this judgment worth reading.
  assert.ok(tabSequence(document).includes(byId(document, PORTFOLIO_SAMPLE_SELECT_ID)),
    "the sample chooser is not in the natural tab order");
  // The panel above still answers its own question; this region took nothing
  // from the single-provider path.
  assert.ok(byId(document, "provider-coverage"), "the coverage panel is gone");
});
