// The executive figures a leader's own import produces, and the states it does
// not produce a figure for.
//
// The model half is asserted directly, because the interesting cases are the
// refusals: an import with no invoice, an import whose recoverable figure the
// attribution policy withheld, and a corpus under the declared floor. The DOM
// half is drawn into the shipped markup of src/evolution.html so the assertions
// are on what a leader can see rather than on a fixture authored for this test.

import test from "node:test";
import assert from "node:assert/strict";

import { loadPage, textOf } from "./support/browser.js";
import {
  applyImportedExecutive, clearImportedExecutive, CORPUS_REFUSAL_COPY,
  importedExecutiveFigures, importedHeroFigures, importedKpiFigures, importedMixFigures,
} from "../src/imported-executive-view.js";
import {
  CORPUS_NOT_GRADEABLE, gradeImportedCorpus,
} from "../src/imported-corpus-grade.js";
import {
  MIN_ATTRIBUTED_SHARE, MIN_SCORED_PROMPTS, PANELS_BY_ID, PANEL_UNAVAILABLE_REASON,
  importedPanelFacts, panelState,
} from "../src/finops-panel-contract.js";
import { DISPLAY_REFUSAL, PROVENANCE_GAP } from "../src/imported-executive-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

const byId = (document, id) => document.getElementById(id);
const shown = (document, id) => textOf(byId(document, id));

/**
 * A corpus of `count` records in a fixed 3:1:1 mix, generated rather than
 * committed. Token counts vary so the corpus is not accidentally uniform; they
 * are evidence only and cannot move the composite.
 */
function corpus(count, { categories = ["highValue", "highValue", "highValue", "inefficient", "overProvisioned"] } = {}) {
  return Array.from({ length: count }, (unused, index) => ({
    category: categories[index % categories.length],
    model: "acme-sonnet-1",
    inputTokens: 100 + index,
    outputTokens: 50 + index,
  }));
}

const GRADED = gradeImportedCorpus(corpus(MIN_SCORED_PROMPTS * 4));
const AT_FLOOR = gradeImportedCorpus(corpus(MIN_SCORED_PROMPTS));
const THIN = gradeImportedCorpus(corpus(MIN_SCORED_PROMPTS - 1));
const NOTHING = gradeImportedCorpus([]);

test("a graded corpus publishes the letter, its confidence, and the count behind both", () => {
  const hero = importedHeroFigures(GRADED);
  assert.equal(hero.available, true);
  assert.equal(hero.letter, GRADED.grade);
  assert.equal(hero.value, `${GRADED.composite} / 100 · grade ${GRADED.grade}`);
  // The three things a director asks of a letter are on one line, so the letter
  // cannot be quoted without its qualifier.
  assert.match(hero.coverage, new RegExp(`${MIN_SCORED_PROMPTS * 4} of ${MIN_SCORED_PROMPTS * 4} `
    + "imported records scored"));
  assert.match(hero.coverage, new RegExp(GRADED.confidence.label));
  // The arithmetic travels with the claim rather than being re-derived here.
  assert.match(hero.rule, new RegExp(GRADED.confidence.basis.arithmetic.replace(/\//g, "\\/")));
  assert.match(hero.rule, /imported-corpus-grade\/1\.0\.0/);
  assert.equal(hero.actionAvailable, false,
    "a corpus four times over the floor has nothing left to ask for");
});

test("a corpus on the floor is graded, and its next step is stated as arithmetic", () => {
  const hero = importedHeroFigures(AT_FLOOR);
  assert.equal(hero.available, true, "the floor is read with >=, so a corpus sitting on it grades");
  assert.equal(hero.actionAvailable, true);
  // 25 on the floor, 50 for the next named level: the ask is 25 more, not a
  // vague "add more data".
  assert.match(hero.action, new RegExp(`Add ${MIN_SCORED_PROMPTS} more scored queries`));
  assert.match(hero.action, new RegExp(`${MIN_SCORED_PROMPTS * 2}`));
});

test("every published refusal reason reaches the card as a label, a rule, and a next step", () => {
  for (const [result, reason] of [
    [THIN, CORPUS_NOT_GRADEABLE.belowFloor],
    [NOTHING, CORPUS_NOT_GRADEABLE.noSourceRecords],
    [gradeImportedCorpus([{ category: "not-a-category" }]), CORPUS_NOT_GRADEABLE.noneClassified],
  ]) {
    assert.equal(result.reason, reason, "the fixture must exercise the reason it claims to");
    const hero = importedHeroFigures(result);
    assert.equal(hero.available, false);
    assert.equal(hero.letter, "!", "no letter may be published for a refusal");
    assert.equal(hero.value, CORPUS_REFUSAL_COPY[reason].label);
    assert.equal(hero.action, CORPUS_REFUSAL_COPY[reason].action);
    // The published sentence, shown as published: the module that refused owns
    // the reason, and this view does not paraphrase it.
    assert.equal(hero.rule, result.reasonRule);
    assert.match(hero.coverage, new RegExp(`floor ${MIN_SCORED_PROMPTS}`),
      "a refusal must name the floor it was measured against");
  }
});

test("the money cards separate a missing invoice from a total that needs review", () => {
  const [spend, recoverable] = importedKpiFigures(GRADED, {});
  assert.equal(spend.available, false);
  assert.equal(spend.value, "Not in this import");
  assert.match(spend.note, /No provider period export/);
  assert.equal(recoverable.value, "Not in this import");

  const [reviewed] = importedKpiFigures(GRADED, { spendUsd: 1e15, plausible: false });
  assert.equal(reviewed.value, "Needs review");
  assert.match(reviewed.note, /supported display range/);
});

test("a withheld recoverable figure is not shown, and says which decision withheld it", () => {
  const [, recoverable] = importedKpiFigures(GRADED, {
    spendUsd: 444.15, recoverableUsd: 96.4, recoverableWithheld: true,
    withheldReason: "Attribution is below the published floor.",
  });
  assert.equal(recoverable.available, false);
  assert.equal(recoverable.value, "Not shown");
  assert.equal(recoverable.note, "Attribution is below the published floor.");
});

test("the high-value card is the corpus's own share, and the peer card needs a benchmark", () => {
  const kpis = importedKpiFigures(GRADED, { spendUsd: 444.15, recoverableUsd: 96.4, departments: 2 });
  const productive = kpis.find((kpi) => kpi.key === "productive");
  assert.equal(productive.available, true);
  assert.equal(productive.value, "60.0%", "3 of every 5 generated records are high-value");
  assert.match(productive.note, new RegExp(`${MIN_SCORED_PROMPTS * 4 * 0.6} of ${MIN_SCORED_PROMPTS * 4} scored queries`));

  const peer = kpis.find((kpi) => kpi.key === "peer");
  // No benchmark was handed over, which is a different statement from one that
  // was evaluated and refused. `imported-peer-benchmark.test.js` owns the
  // evaluated cases; this one pins that an absent evaluation is not filled in.
  assert.equal(peer.available, false, "no peer benchmark was evaluated for this call");
  assert.match(peer.note, /No peer comparison was evaluated/);

  const unscored = importedKpiFigures(NOTHING, { spendUsd: 444.15 });
  assert.equal(unscored.find((kpi) => kpi.key === "productive").available, false);
});

test("the mix is a share of queries, captioned in records, and absent when nothing scored", () => {
  const mix = importedMixFigures(GRADED);
  const shares = Object.values(mix.shares).reduce((sum, share) => sum + share, 0);
  assert.ok(Math.abs(shares - 1) < 0.01, `the four shares must cover the corpus, got ${shares}`);
  assert.equal(mix.captionFor({ key: "highValue" }),
    `${MIN_SCORED_PROMPTS * 4 * 0.6} of ${MIN_SCORED_PROMPTS * 4} scored queries`);
  assert.match(mix.basis, /query mix, not a spend mix/);

  // Four zero-width segments are a chart of nothing — but a bare null said only
  // that no chart existed and left the caller to invent a reason for a refusal
  // it did not make. The refusal is now the contract's, and it is named.
  const empty = importedMixFigures(NOTHING);
  assert.equal(empty.available, false);
  assert.equal(empty.shares, null, "no shares may be published for a corpus with nothing scored");
  assert.equal(empty.provenance, null, "an unpublished value has no provenance to qualify");
  assert.equal(empty.unavailable.reason, PANEL_UNAVAILABLE_REASON.scoredPrompts);
  assert.equal(empty.unavailable.panel, "spend-mix");
  assert.match(empty.basis, /carried a category the rubric scores/);
});

/**
 * A provider period export, generated rather than committed: `rows` costed rows,
 * each naming an org unit and a model. `requestCounts` drops the one column the
 * KPI row never declared, so a missing-optional-field case is one argument away.
 */
function providerExport(rows, { requestCounts = true } = {}) {
  return {
    document: {
      records: Array.from({ length: rows }, (unused, index) => ({
        org_unit_id: `unit-${index % 3}`,
        cost: { amount_minor: 1000 + index },
        usage: {
          model_raw: "acme-sonnet-1",
          ...(requestCounts ? { request_count: 10 + index } : {}),
        },
      })),
    },
  };
}

const PROVIDER_ROWS = 40;
const SHARE = 0.78;
const COMPLETE = Object.freeze({
  period: "2026-06-01 to 2026-06-30", spendUsd: 444.15, recoverableUsd: 96.4, departments: 2,
});

const factsFor = (providers, { attributedShare = SHARE, scoredPrompts = MIN_SCORED_PROMPTS * 4 } = {}) =>
  importedPanelFacts({
    providers, result: { rankedDepartments: ["unit-0", "unit-1"] },
    attributedShare, scoredPrompts, gradedDepartments: 2,
  });

test("a complete export publishes every KPI, each with the provenance behind it", () => {
  const facts = factsFor([providerExport(PROVIDER_ROWS)]);
  const kpis = importedKpiFigures(GRADED, { ...COMPLETE, facts, attributedShare: SHARE });
  const card = (key) => kpis.find((kpi) => kpi.key === key);

  for (const key of ["spend", "recoverable", "productive"]) {
    const kpi = card(key);
    assert.equal(kpi.available, true, `${key} must publish from a complete export`);
    assert.equal(kpi.unavailable, null, `${key} published a figure, so it declares no gap`);
    assert.equal(kpi.provenance.complete, true, `${key} must state all three provenance facts`);
    assert.deepEqual([...kpi.provenance.missing], []);
    assert.equal(kpi.provenance.period, COMPLETE.period);
    assert.equal(kpi.provenance.attributedShare, SHARE);
  }
  // The money cards count the rows that carried a cost — the same count the
  // panel contract made for its own decision, not a second tally.
  assert.equal(card("spend").provenance.sourceRecords, PROVIDER_ROWS);
  assert.equal(card("spend").provenance.unit, "provider row");
  assert.equal(card("spend").provenance.sourceRecords, facts.costedRows);

  // The high-value share is a corpus figure and counts scored queries — and it
  // carries the import's ATTRIBUTED-SPEND FRACTION like every other published
  // value. A corpus coverage ratio or a null here answers a different question
  // than the one the provenance block declares.
  const productive = card("productive");
  assert.equal(productive.provenance.unit, "scored query");
  assert.equal(productive.provenance.sourceRecords, MIN_SCORED_PROMPTS * 4);
  assert.equal(productive.provenance.attributedShare, SHARE);
  assert.equal(productive.provenance.attributedSharePercent, "78%");

  // The one value an import can never publish: a reason, and no provenance to
  // qualify a figure that does not exist.
  assert.equal(card("peer").provenance, null);
  assert.equal(card("peer").unavailable.reason, PANEL_UNAVAILABLE_REASON.peerCohortRecords);

  const mix = importedMixFigures(GRADED, { ...COMPLETE, attributedShare: SHARE });
  assert.equal(mix.available, true);
  assert.equal(mix.provenance.sourceRecords, MIN_SCORED_PROMPTS * 4);
  assert.equal(mix.provenance.attributedShare, SHARE);
  assert.equal(mix.provenance.period, COMPLETE.period);

  const hero = importedHeroFigures(GRADED, { ...COMPLETE, attributedShare: SHARE });
  assert.equal(hero.provenance.complete, true);
  assert.equal(hero.unavailable, null);
});

test("an export missing an optional column still publishes the KPI row, and the panel that declared it names the column", () => {
  const facts = factsFor([providerExport(PROVIDER_ROWS, { requestCounts: false })]);
  const kpis = importedKpiFigures(GRADED, { ...COMPLETE, facts, attributedShare: SHARE });
  for (const key of ["spend", "recoverable", "productive"]) {
    const kpi = kpis.find((entry) => entry.key === key);
    assert.equal(kpi.available, true,
      "usage.request_count is not an input the KPI row declared, so its absence withholds nothing");
    assert.equal(kpi.provenance.complete, true);
    assert.equal(kpi.provenance.sourceRecords !== null, true);
  }
  // The panel that did declare it refuses, and names one column rather than the
  // file: the reason is a property of the contract, not of this view.
  const overspend = panelState(PANELS_BY_ID["model-overspend"], facts);
  assert.equal(overspend.available, false);
  assert.equal(overspend.reason, PANEL_UNAVAILABLE_REASON.requestCountedRows);
  assert.match(overspend.message.need, /usage\.request_count/);
  assert.equal(overspend.message.reason, PANEL_UNAVAILABLE_REASON.requestCountedRows);
});

test("below a declared threshold a value is refused with the contract's reason, never with a zero", () => {
  // The attribution floor. The dollars were read and under half of them resolve
  // to an org unit, so the ranked recoverable figure is withheld upstream and
  // this row says which floor withheld it.
  const thin = MIN_ATTRIBUTED_SHARE - 0.01;
  const [, recoverable] = importedKpiFigures(GRADED, {
    ...COMPLETE,
    facts: factsFor([providerExport(PROVIDER_ROWS)], { attributedShare: thin }),
    attributedShare: thin,
    recoverableWithheld: true,
    withheldReason: "Attribution is below the published floor.",
  });
  assert.equal(recoverable.available, false);
  assert.equal(recoverable.value, "Not shown", "a withheld figure is not a zero dollar figure");
  assert.equal(recoverable.unavailable.reason, PANEL_UNAVAILABLE_REASON.attributedShare);
  assert.match(recoverable.unavailable.need,
    new RegExp(`${Math.round(MIN_ATTRIBUTED_SHARE * 100)}%`));
  assert.equal(recoverable.provenance, null, "no figure was published, so nothing is qualified");

  // The scored-prompt floor. One query short, so the high-value share and the
  // mix refuse together and with the same code.
  const kpis = importedKpiFigures(THIN, { ...COMPLETE, attributedShare: SHARE });
  const productive = kpis.find((kpi) => kpi.key === "productive");
  assert.equal(productive.available, false);
  assert.equal(productive.value, "Not in this import",
    "a corpus under the floor has no high-value share, not a 0% one");
  assert.equal(productive.unavailable.reason, PANEL_UNAVAILABLE_REASON.scoredPrompts);
  assert.equal(productive.provenance, null);
  // The note states the arithmetic a reader can check, not "insufficient data".
  assert.match(productive.note, new RegExp(`${MIN_SCORED_PROMPTS - 1} of the ${MIN_SCORED_PROMPTS}`));
  assert.equal(importedMixFigures(THIN).unavailable.reason, PANEL_UNAVAILABLE_REASON.scoredPrompts);
  // The corpus module's own published rule travels with the contract's code
  // rather than being paraphrased here.
  assert.equal(importedMixFigures(THIN).unavailable.detail, THIN.reasonRule);
});

test("an unestablished provenance fact is absent, not zero, and a refused display says so", () => {
  const [spend] = importedKpiFigures(GRADED, { spendUsd: 444.15 });
  assert.equal(spend.available, true);
  assert.equal(spend.provenance.sourceRecords, null,
    "no fact record was handed over, and a zero row count under a dollar figure is undetectable");
  assert.deepEqual([...spend.provenance.missing],
    [PROVENANCE_GAP.sourceRecords, PROVENANCE_GAP.period, PROVENANCE_GAP.attributedShare]);
  assert.equal(spend.provenance.attributedSharePercent, null,
    "an undefined fraction must not render as 0%");

  // A present export whose totals cannot be displayed is this view's refusal,
  // not a missing input, and carries a code that says which.
  const [outside] = importedKpiFigures(GRADED, { spendUsd: 1e15, plausible: false });
  assert.equal(outside.unavailable.reason, DISPLAY_REFUSAL.outsideRange);
  assert.equal(outside.unavailable.need, null, "there is no next step for a total out of range");
});

test("the shipped card and KPI row take the figures, and hand them back on clear", async () => {
  const page = await loadPage(PAGE);
  const { document } = page;
  try {
    const figures = importedExecutiveFigures(GRADED, {
      spendUsd: 444.15, recoverableUsd: 96.4, departments: 2, period: "2026-06",
    });
    applyImportedExecutive(document, figures, { band: () => "good" });

    assert.equal(shown(document, "score-grade"), GRADED.grade);
    assert.equal(shown(document, "score-value"), figures.hero.value);
    assert.equal(shown(document, "score-coverage"), figures.hero.coverage);
    assert.equal(byId(document, "score-card").dataset.band, "good");
    assert.equal(byId(document, "score-card").dataset.metricState, "available");
    assert.equal(byId(document, "score-card").dataset.gradeSource, "import");
    assert.equal(shown(document, "kpi-spend-value"), "$444");
    // The card that could not be filled carries a word and a shape, not only a
    // dashed edge: the state has to survive a monochrome screenshot.
    assert.equal(byId(document, "kpi-peer-flag").hidden, false);
    assert.equal(byId(document, "kpi-spend-flag").hidden, true);
    // The bundled-sample caption is no longer true of these four numbers.
    assert.equal(byId(document, "headline-basis").hidden, true);
    assert.equal(byId(document, "kpi-row").dataset.source, "import");

    clearImportedExecutive(document);
    assert.equal(byId(document, "headline-basis").hidden, false);
    assert.equal(byId(document, "kpi-row").dataset.source, "sample");
    assert.equal(byId(document, "kpi-peer-flag").hidden, true);
    assert.equal(byId(document, "score-card").dataset.gradeSource, undefined);
  } finally {
    page.restore();
  }
});

test("the shipped row carries each value's reason and provenance, and drops them on clear", async () => {
  const page = await loadPage(PAGE);
  const { document } = page;
  try {
    const facts = factsFor([providerExport(PROVIDER_ROWS)]);
    applyImportedExecutive(document,
      importedExecutiveFigures(GRADED, { ...COMPLETE, facts, attributedShare: SHARE }),
      { band: () => "good" });

    const spend = byId(document, "kpi-spend");
    assert.equal(spend.dataset.sourceRecords, String(PROVIDER_ROWS));
    assert.equal(spend.dataset.sourceUnit, "provider row");
    assert.equal(spend.dataset.sourcePeriod, COMPLETE.period);
    assert.equal(spend.dataset.attributedShare, String(SHARE));
    assert.equal(spend.dataset.unavailableReason, undefined,
      "a published figure carries no refusal code");

    // The published high-value share carries the same fraction on the element a
    // reader inspects, not a coverage ratio and not an empty attribute.
    assert.equal(byId(document, "kpi-productive").dataset.attributedShare, String(SHARE));
    assert.equal(byId(document, "kpi-productive").dataset.sourceUnit, "scored query");

    const peer = byId(document, "kpi-peer");
    assert.equal(peer.dataset.unavailableReason, PANEL_UNAVAILABLE_REASON.peerCohortRecords);
    assert.equal(peer.dataset.sourceRecords, undefined,
      "an absent fact is an absent attribute, never an empty string");

    clearImportedExecutive(document);
    assert.equal(byId(document, "kpi-spend").dataset.sourceRecords, undefined);
    assert.equal(byId(document, "kpi-spend").dataset.attributedShare, undefined);
    assert.equal(byId(document, "kpi-peer").dataset.unavailableReason, undefined);
    assert.equal(byId(document, "score-card").dataset.sourceRecords, undefined);
  } finally {
    page.restore();
  }
});

test("a refused grade leaves no letter on the shipped card", async () => {
  const page = await loadPage(PAGE);
  const { document } = page;
  try {
    applyImportedExecutive(document, importedExecutiveFigures(THIN, { spendUsd: 444.15 }));
    assert.equal(shown(document, "score-grade"), "!");
    assert.equal(byId(document, "score-card").dataset.metricState, "needs-review");
    assert.equal(shown(document, "score-peer"), THIN.reasonRule);
    assert.equal(byId(document, "score-action").dataset.available, "true");
  } finally {
    page.restore();
  }
});
