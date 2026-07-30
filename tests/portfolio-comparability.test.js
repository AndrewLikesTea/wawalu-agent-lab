// The portfolio comparability contract, its samples, and the region that shows
// them.
//
// Four groups, checking different claims:
//
//   1. THE RULES. Coverage, alignment, comparability, confidence, and the
//      single next action are recomputed from the published definitions rather
//      than transcribed, including the cases where two of them disagree — full
//      coverage that is still not combinable is the interesting one.
//   2. THE CLOSED FIELD SET. The regression this build exists for: a portfolio
//      carrying a field the contract does not declare is refused whole, the
//      screening says so, and the defect names the key without quoting the
//      value. A contract that only *described* a closed field set was the
//      defect; these tests are what makes the description enforcement.
//   3. THE SAMPLES. Four bundled portfolios, one per failure mode this page
//      claims to teach, each landing on the verdict and the action it is there
//      to demonstrate, none carrying a cost, a credential, or source material,
//      and all of them admissible under the closed field set.
//   4. THE SURFACE. The shipped markup of src/evolution.html carries the
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
  PORTFOLIO_QUESTIONS, PORTFOLIO_SAMPLE_FIELDS, PROVIDER_STATE, REMEDIATION_TIERS,
  SAMPLE_DEFECT_ACTION_CODE, SAMPLE_DEFECT_CODE,
  calendarDate, deliveryCount, evaluatePortfolioComparability, roundRatio, screenPortfolioSample,
} from "../src/portfolio-comparability.js";
import {
  DEFAULT_SAMPLE_ID, PORTFOLIO_SAMPLES, evaluateSample, portfolioSample, screenBundledSamples,
} from "../src/portfolio-comparability-samples.js";
import {
  PORTFOLIO_BODY_ID, PORTFOLIO_DEFECT_ID, PORTFOLIO_SAMPLE_SELECT_ID, PORTFOLIO_SECTION_ID,
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

test("a whole portfolio on one window in one currency is comparable", () => {
  const result = evaluatePortfolioComparability(portfolio(complete()));
  assert.equal(result.verdict, COMPARABILITY_VERDICT.yes);
  assert.equal(result.comparable, true);
  assert.equal(result.coverage.ratio, 1);
  assert.equal(result.coverage.coveredCount, 3);
  assert.equal(result.confidence.ratio, 1);
  assert.equal(result.nextAction.code, NO_ACTION_CODE);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.contractDefects, []);
  assert.equal(result.contractId, PORTFOLIO_COMPARABILITY_CONTRACT_ID);
  // No money field, at any depth. Combining spend is a different question.
  assert.equal(/cost|amount|spend|usd_|price/i.test(JSON.stringify(result.providers)), false);
});

test("a provider with no record for the window is missing, and coverage says so", () => {
  const result = evaluatePortfolioComparability(
    portfolio([record("openai"), record("aws")]));
  assert.equal(result.verdict, COMPARABILITY_VERDICT.notYet);
  assert.equal(result.coverage.ratio, roundRatio(2 / 3));
  assert.equal(providerOf(result, "anthropic").state, PROVIDER_STATE.missing);
  assert.equal(result.nextAction.code, FINDING_CODE.MISSING_PROVIDER);
  assert.equal(result.nextAction.providerId, "anthropic");
  assert.match(result.nextAction.statement, /2026-06-01 to 2026-07-01/);
  assert.equal(result.nextAction.focus, "files");
});

test("full coverage is still not combinable when a second window overlaps", () => {
  const result = evaluatePortfolioComparability(portfolio([
    ...complete(),
    record("anthropic", { periodStart: "2026-06-15", periodEnd: "2026-07-15" }),
  ]));
  // The two tests disagreeing on purpose: every provider reports the window
  // exactly once, and the overlap still cannot be separated by arithmetic.
  assert.equal(result.coverage.ratio, 1);
  assert.equal(result.comparable, false);
  assert.equal(result.verdict, COMPARABILITY_VERDICT.notYet);
  assert.equal(providerOf(result, "anthropic").state, PROVIDER_STATE.overlapping);
  assert.equal(result.nextAction.code, FINDING_CODE.OVERLAPPING_PERIOD);
});

test("a record outside the window is ignored; one that straddles it is misaligned", () => {
  const ignored = evaluatePortfolioComparability(portfolio([
    ...complete(),
    record("openai", { periodStart: "2026-07-01", periodEnd: "2026-08-01" }),
  ]));
  assert.equal(ignored.verdict, COMPARABILITY_VERDICT.yes);

  const misaligned = evaluatePortfolioComparability(portfolio([
    record("openai", { periodStart: "2026-06-15", periodEnd: "2026-07-15" }),
    record("anthropic"), record("aws"),
  ]));
  assert.equal(providerOf(misaligned, "openai").state, PROVIDER_STATE.misaligned);
  assert.equal(providerOf(misaligned, "openai").covered, false);
  assert.equal(misaligned.nextAction.code, FINDING_CODE.MISALIGNED_PERIOD);
});

test("another currency is never converted, and an unreadable count is never coerced", () => {
  const foreign = evaluatePortfolioComparability(portfolio([
    record("openai"), record("anthropic"), record("aws", { currencyCode: "EUR" }),
  ]));
  assert.equal(foreign.verdict, COMPARABILITY_VERDICT.notYet);
  assert.equal(foreign.coverage.ratio, roundRatio(2 / 3));
  assert.equal(providerOf(foreign, "aws").state, PROVIDER_STATE.incompatibleCurrency);
  assert.equal(foreign.nextAction.code, FINDING_CODE.INCOMPATIBLE_CURRENCY);
  assert.match(foreign.nextAction.statement, /no conversion rate/);

  const unreadable = evaluatePortfolioComparability(portfolio([
    record("openai"), record("anthropic"), record("aws", { deliveryCount: "1,204" }),
  ]));
  assert.equal(providerOf(unreadable, "aws").state, PROVIDER_STATE.unreadableCount);
  assert.equal(providerOf(unreadable, "aws").deliveryCount, null);
  assert.equal(unreadable.nextAction.code, FINDING_CODE.UNREADABLE_COUNT);
  assert.equal(deliveryCount("1204"), null);
  assert.equal(deliveryCount(-1), null);
  assert.equal(deliveryCount(0), 0);
});

test("one action is offered, chosen by tier and then by declaration order", () => {
  // Every tier is represented at once: the highest tier wins, and no second
  // action is offered alongside it.
  const result = evaluatePortfolioComparability(portfolio([
    record("anthropic", { currencyCode: "EUR" }),
    record("aws", { periodStart: "2026-06-15", periodEnd: "2026-07-15" }),
  ]));
  assert.equal(result.nextAction.code, FINDING_CODE.MISSING_PROVIDER);
  assert.equal(result.nextAction.providerId, "openai");
  assert.equal(REMEDIATION_TIERS[0][0], FINDING_CODE.MISSING_PROVIDER);
  // Within one tier, the earliest-declared provider wins.
  const tie = evaluatePortfolioComparability(portfolio([record("aws")]));
  assert.equal(tie.nextAction.providerId, "openai");
});

test("an unanswerable declaration is a refusal to judge, not a 100% portfolio", () => {
  const result = evaluatePortfolioComparability(portfolio(complete(), {
    requiredProviders: [], requiredPeriodEnd: "2026-02-30",
  }));
  assert.equal(result.verdict, COMPARABILITY_VERDICT.no);
  assert.equal(result.coverage.available, false);
  assert.equal(result.coverage.ratio, null);
  assert.equal(result.nextAction.focus, "declaration");
  assert.ok(result.errors.length >= 2, "an unanswerable declaration listed no reasons");
  assert.equal(calendarDate("2026-02-30"), null);
  assert.equal(calendarDate("2028-02-29"), "2028-02-29");
  assert.equal(calendarDate("2026-6-1"), null);
});

test("provenance confidence is a share of covered providers, labels only", () => {
  const result = evaluatePortfolioComparability(portfolio([
    record("openai", { provenance: { label: "  " } }), record("anthropic"), record("aws"),
  ]));
  assert.equal(result.confidence.coveredCount, 3);
  assert.equal(result.confidence.attributedCount, 2);
  assert.equal(result.confidence.ratio, roundRatio(2 / 3));
  assert.equal(providerOf(result, "openai").provenanceLabel, null);
  // A blank label is not a fault: it is unattributed evidence, and the
  // portfolio is still combinable.
  assert.equal(result.verdict, COMPARABILITY_VERDICT.yes);
  assert.equal(roundRatio(1 / 3), 0.3333);
});

// ---------------------------------------------------------------------------
// 2. The closed field set. The regression this build exists for.
// ---------------------------------------------------------------------------

test("a portfolio field outside the closed set refuses the portfolio whole", () => {
  const suspect = portfolio(complete(), { internalNote: "ring Dana at Northwind about the CUR" });
  const screening = screenPortfolioSample(suspect);
  assert.equal(screening.ok, false, "screening passed an undeclared portfolio field");
  assert.deepEqual(screening.defects.map((entry) => [entry.code, entry.field]),
    [[SAMPLE_DEFECT_CODE.UNKNOWN_PORTFOLIO_FIELD, "internalNote"]]);

  const result = evaluatePortfolioComparability(suspect);
  assert.equal(result.verdict, COMPARABILITY_VERDICT.no);
  assert.equal(result.comparable, false);
  assert.equal(result.sampleContract.ok, false);
  assert.equal(result.contractDefects.length, 1);
  // Nothing was measured: an otherwise-perfect portfolio does not get a
  // coverage figure out of a contract that refused to read it.
  assert.equal(result.coverage.available, false);
  assert.equal(result.coverage.ratio, null);
  assert.deepEqual(result.providers, []);
  assert.deepEqual(result.findings, []);
  // The one action names the key and the fix.
  assert.equal(result.nextAction.code, SAMPLE_DEFECT_ACTION_CODE);
  assert.equal(result.nextAction.focus, "contract");
  assert.match(result.nextAction.statement, /"internalNote"/);
  // And never the value. An undeclared field is where a customer's name
  // arrives, so quoting it back would leak what the refusal exists to stop.
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("Dana"), false, "the refusal quoted the value");
  assert.equal(serialized.includes("Northwind"), false, "the refusal quoted the value");
});

test("an undeclared field on a record or a provenance block is refused too", () => {
  const inRecord = evaluatePortfolioComparability(portfolio([
    record("openai"), record("anthropic"), { ...record("aws"), apiKey: "sk-not-read" },
  ]));
  assert.equal(inRecord.verdict, COMPARABILITY_VERDICT.no);
  assert.deepEqual(inRecord.contractDefects.map((entry) => [entry.code, entry.field, entry.where]),
    [[SAMPLE_DEFECT_CODE.UNKNOWN_RECORD_FIELD, "apiKey", "Record 3"]]);
  assert.equal(JSON.stringify(inRecord).includes("sk-not-read"), false);

  const inProvenance = evaluatePortfolioComparability(portfolio([
    { ...record("openai"), provenance: { label: "OpenAI usage export", sourceFile: "/tmp/u.csv" } },
    record("anthropic"), record("aws"),
  ]));
  assert.deepEqual(inProvenance.contractDefects.map((entry) => entry.code),
    [SAMPLE_DEFECT_CODE.UNKNOWN_PROVENANCE_FIELD]);
  assert.equal(JSON.stringify(inProvenance).includes("/tmp/u.csv"), false);

  // Several defects: all are reported, portfolio level first, then records in
  // supplied order, so the single action is the same on every run.
  const several = evaluatePortfolioComparability(portfolio([
    { ...record("openai"), zzzLast: true },
    { ...record("anthropic"), alsoUndeclared: true },
  ], { spendTotal: 100, internalNote: "x" }));
  assert.deepEqual(several.contractDefects.map((entry) => entry.field),
    ["internalNote", "spendTotal", "zzzLast", "alsoUndeclared"]);
  assert.match(several.nextAction.statement, /"internalNote"/);
  assert.equal(several.errors.length, 4);
});

test("a malformed portfolio is refused rather than thrown, and the shape still reads", () => {
  for (const input of [null, undefined, "a portfolio", 42, []]) {
    const result = evaluatePortfolioComparability(input);
    assert.equal(result.verdict, COMPARABILITY_VERDICT.no, String(input));
    assert.equal(result.contractDefects[0].code, SAMPLE_DEFECT_CODE.MALFORMED_SAMPLE);
    // A consumer must not have to branch on the refusal to read the result.
    assert.equal(result.coverage.available, false);
    assert.equal(result.confidence.available, false);
    assert.deepEqual(result.declaration.requiredProviders, []);
    assert.equal(result.answers.length, PORTFOLIO_QUESTIONS.length);
  }
  const badRecords = evaluatePortfolioComparability(portfolio({ openai: 1 }));
  assert.equal(badRecords.contractDefects[0].code, SAMPLE_DEFECT_CODE.MALFORMED_SAMPLE);
  const badEntry = evaluatePortfolioComparability(portfolio([record("openai"), "openai"]));
  assert.equal(badEntry.contractDefects[0].where, "Record 2");
});

test("the declared field set is the one the contract publishes", () => {
  assert.deepEqual([...PORTFOLIO_SAMPLE_FIELDS.record], [
    "providerId", "periodStart", "periodEnd", "currencyCode", "deliveryCount", "provenance",
  ]);
  // Every declared field is admissible: the closed set is not narrower than the
  // shape the contract documents, or a valid portfolio would be refused.
  const screening = screenPortfolioSample(portfolio(complete()));
  assert.equal(screening.ok, true);
  assert.deepEqual(screening.defects, []);
  // A bare provenance label string is still admissible.
  assert.equal(screenPortfolioSample(portfolio([
    { ...record("openai"), provenance: "OpenAI usage export" },
  ])).ok, true);
  // And every shipped sample record carries declared fields only.
  for (const sample of PORTFOLIO_SAMPLES) {
    for (const entry of sample.portfolio.records) {
      assert.deepEqual(Object.keys(entry)
        .filter((key) => !PORTFOLIO_SAMPLE_FIELDS.record.includes(key)), [], sample.id);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. The samples.
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
    assert.deepEqual(result.contractDefects, [], `${id} is not admissible`);
    assert.ok(sample.teaches.length > 0, `${id} says nothing about why it is here`);
  }
  // The one that shows coverage and comparability disagreeing.
  assert.equal(evaluateSample("overlapping-period").result.coverage.ratio, 1);
  assert.equal(evaluateSample("missing-provider").result.coverage.ratio, roundRatio(2 / 3));
  // An unknown id falls back rather than painting nothing.
  assert.equal(portfolioSample("no-such-sample").id, DEFAULT_SAMPLE_ID);
});

test("no sample carries a credential, a prompt, a customer, a file path, or a stray field", () => {
  assert.deepEqual(screenBundledSamples(), [],
    "a bundled sample is not admissible under its own contract");
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
// 4. The surface.
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
  assert.equal(section.dataset.contractDefects, "0");

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

test("a refused portfolio paints the defect above the answers, not inside them", async () => {
  const { document } = await loadPage(PAGE);
  const evaluated = {
    sample: { id: "unknown-field", label: "Undeclared field", teaches: "What a refusal looks like." },
    result: evaluatePortfolioComparability(
      portfolio(complete(), { internalNote: "ring Dana at Northwind" })),
  };
  applyPortfolioComparability(document, evaluated);
  const section = byId(document, PORTFOLIO_SECTION_ID);
  assert.equal(section.dataset.verdict, COMPARABILITY_VERDICT.no);
  assert.equal(section.dataset.contractDefects, "1");
  assert.equal(section.dataset.coverage, "");

  const notice = byId(document, PORTFOLIO_DEFECT_ID);
  assert.ok(notice, "a refused portfolio painted no defect");
  assert.equal(notice.closest("details"), null, "the blocking defect hid behind a disclosure");
  assert.equal(notice.dataset.defectCode, SAMPLE_DEFECT_CODE.UNKNOWN_PORTFOLIO_FIELD);
  assert.match(textOf(notice), /"internalNote"/);
  // No provider rows, no button into the file chooser: the fix is in the
  // fixture, and nothing was read to show.
  assert.equal(document.querySelectorAll(".portfolio-provider").length, 0);
  assert.equal(byId(document, "portfolio-comparability-action-jump"), null);
  assert.equal(textOf(byId(document, PORTFOLIO_BODY_ID)).includes("Dana"), false,
    "the region quoted the value");
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
