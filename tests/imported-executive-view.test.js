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
import { MIN_SCORED_PROMPTS } from "../src/finops-panel-contract.js";

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

test("the high-value card is the corpus's own share, and the peer card is never an import's", () => {
  const kpis = importedKpiFigures(GRADED, { spendUsd: 444.15, recoverableUsd: 96.4, departments: 2 });
  const productive = kpis.find((kpi) => kpi.key === "productive");
  assert.equal(productive.available, true);
  assert.equal(productive.value, "60.0%", "3 of every 5 generated records are high-value");
  assert.match(productive.note, new RegExp(`${MIN_SCORED_PROMPTS * 4 * 0.6} of ${MIN_SCORED_PROMPTS * 4} scored queries`));

  const peer = kpis.find((kpi) => kpi.key === "peer");
  assert.equal(peer.available, false, "no peer cohort can be built from a leader's own files");
  assert.match(peer.note, /No anonymized peer cohort/);

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
  assert.equal(importedMixFigures(NOTHING), null,
    "four zero-width segments are a chart of nothing");
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
