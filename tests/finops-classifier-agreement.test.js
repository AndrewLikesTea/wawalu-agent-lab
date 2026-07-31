// The published agreement figure, held to the scorer that produced it.
//
// The rule this file exists to enforce: NO NUMBER IS WRITTEN DOWN HERE. Every
// assertion computes the expected value from a fresh `scoreAgreementCorpus` run
// over the shipped corpus and compares the page against that. A test that
// restated "119 of 158" would pass forever after the classifier changed, which
// is the exact failure a measured claim on an executive page cannot afford.
//
// The one literal is the corpus floor (150), and that is a policy about the
// fixture rather than a result of scoring it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  AGREEMENT_LABELS, MINIMUM_CORPUS_ENTRIES, scoreAgreementCorpus,
  serializeAgreementReport, validateCorpus, weakestClass,
} from "../src/finops-classifier-agreement.js";
import {
  agreementCopy, confusionRows, renderClassifierAgreement,
} from "../src/finops-classifier-agreement-view.js";

const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
const corpus = JSON.parse(
  await readFile(new URL("../src/finops-classifier-agreement-corpus.json", import.meta.url), "utf8"),
);

/** The page as the browser gets it, with the region painted from a fresh run. */
function paintedPage(report = scoreAgreementCorpus(corpus)) {
  const doc = parseHtml(html);
  renderClassifierAgreement(doc, report);
  return doc;
}

// --- (c) the corpus is well-formed -----------------------------------------

test("the shipped corpus is well-formed by its own declared rules", () => {
  assert.deepEqual(validateCorpus(corpus), [],
    "a malformed corpus must fail here with the reason named, not produce a plausible number");
});

test("the corpus carries at least the floor of entries, all with unique ids", () => {
  assert.ok(corpus.entries.length >= MINIMUM_CORPUS_ENTRIES,
    `the corpus holds ${corpus.entries.length}; below ${MINIMUM_CORPUS_ENTRIES} a per-class rate is anecdote`);
  const ids = corpus.entries.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "every entry needs an id a dispute can cite");
});

test("every human label is in the declared vocabulary and carries a rationale", () => {
  for (const entry of corpus.entries) {
    assert.ok(AGREEMENT_LABELS.includes(entry.label),
      `${entry.id} carries label "${entry.label}", which is outside the published vocabulary`);
    assert.ok(entry.rationale.trim().length > 0,
      `${entry.id} has no rationale, so a director cannot argue with its label`);
  }
});

test("every class the corpus declares is measurable, not represented by one example", () => {
  const report = scoreAgreementCorpus(corpus);
  for (const row of report.perClass) {
    assert.ok(row.support >= 10,
      `${row.class} has ${row.support} labelled queries; a rate over that few is not worth publishing`);
  }
});

// --- (b) two runs are byte-identical ---------------------------------------

test("two scorer runs over the same corpus produce byte-identical output", () => {
  const first = serializeAgreementReport(scoreAgreementCorpus(corpus));
  const second = serializeAgreementReport(scoreAgreementCorpus(corpus));
  assert.equal(first, second, "the artifact must not move between runs");
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(first), "no timestamp may reach the artifact");
  // Sorted keys, checked rather than asserted in a comment: a reader who
  // recomputes this has to get the same bytes, not the same values.
  const keys = Object.keys(JSON.parse(first));
  assert.deepEqual(keys, [...keys].sort(), "top-level keys must be sorted");
});

test("the report carries the corpus version and the sample size it was computed from", () => {
  const report = scoreAgreementCorpus(corpus);
  assert.equal(report.corpusVersion, corpus.corpus_version);
  assert.equal(report.overall.sampleSize, corpus.entries.length,
    "every labelled entry is in the denominator; a dropped entry would flatter the figure");
});

// --- (a) the rendered number equals a fresh run ----------------------------

test("the headline on /evolution.html equals a fresh scorer run, computed here", () => {
  const report = scoreAgreementCorpus(corpus);
  const doc = paintedPage(report);
  const headline = textOf(doc.getElementById("classifier-agreement-headline"));
  // Built from the run, not from a literal: change the classifier and this
  // expectation moves with it.
  assert.equal(headline,
    `The query classifier agrees with human labels on ${report.overall.agreed} of ${report.overall.sampleSize} sampled queries.`);
  assert.ok(headline.includes(String(report.overall.agreed)));
  assert.ok(headline.includes(String(report.overall.sampleSize)));
});

test("no agreement figure is authored in the markup", () => {
  const report = scoreAgreementCorpus(corpus);
  const region = html.slice(html.indexOf('id="classifier-agreement"'),
    html.indexOf("</section>", html.indexOf('id="classifier-agreement"')));
  for (const figure of [String(report.overall.agreed), String(report.overall.sampleSize),
    report.overall.agreementRate]) {
    assert.ok(!region.includes(figure),
      `"${figure}" is written into the markup; every published number must come from a scorer run`);
  }
});

test("the basis line says what the number is and is not, and names the sample size", () => {
  const report = scoreAgreementCorpus(corpus);
  const doc = paintedPage(report);
  const basis = textOf(doc.getElementById("classifier-agreement-basis"));
  assert.ok(basis.includes(String(report.overall.sampleSize)), "the reader is told N");
  assert.match(basis, /synthetic sample/i);
  assert.match(basis, /not accuracy on customer traffic/i);
});

test("a FinOps lead can reach the corpus and the scorer from the page", () => {
  assert.ok(html.includes('href="/finops-classifier-agreement-corpus.json"'),
    "the corpus must be linked, not merely described");
  assert.ok(html.includes("src/finops-classifier-agreement.js"),
    "the method must be nameable from the page");
});

// --- (d) the caveat equals the scorer's weakest class -----------------------

test("the weakest-class caveat on the page equals the class the scorer computes", () => {
  const report = scoreAgreementCorpus(corpus);
  const doc = paintedPage(report);
  const caveat = textOf(doc.getElementById("classifier-agreement-caveat"));
  assert.equal(caveat, agreementCopy(report).caveat);
  assert.ok(caveat.includes(String(report.weakestClass.agreed)));
  assert.ok(caveat.includes(String(report.weakestClass.support)));
  // The class itself, recomputed from the per-class rows rather than read back
  // out of the report the caveat was built from.
  assert.equal(report.weakestClass.class, weakestClass(report.perClass).class);
});

test("the weakest class is the lowest rate, with the declared tie-break", () => {
  const report = scoreAgreementCorpus(corpus);
  const lowest = Math.min(...report.perClass
    .filter((row) => row.support > 0).map((row) => Number(row.agreementRate)));
  assert.equal(Number(report.weakestClass.agreementRate), lowest);

  // Larger support wins a tie, then class name. Driven with a hand-built row
  // set so the rule is exercised even when the shipped corpus has no tie.
  const tied = weakestClass([
    { class: "zeta", support: 10, agreed: 5, agreementRate: "0.5000", confusion: [] },
    { class: "alpha", support: 20, agreed: 10, agreementRate: "0.5000", confusion: [] },
    { class: "beta", support: 20, agreed: 10, agreementRate: "0.5000", confusion: [] },
    { class: "empty", support: 0, agreed: 0, agreementRate: "0.0000", confusion: [] },
  ]);
  assert.equal(tied.class, "alpha",
    "larger support breaks the tie, then the alphabetically first name; a class with no support is never the weakest");
});

// --- the disclosure ---------------------------------------------------------

test("the collapsed region is one sentence, one caveat, and the basis line", () => {
  const doc = paintedPage();
  const region = doc.getElementById("classifier-agreement");
  assert.ok(region, "the region ships in the markup, not only in a module");
  const detail = doc.getElementById("classifier-agreement-confusion");
  assert.ok(detail, "the per-class confusion sits behind a disclosure");
  assert.equal(detail.tagName.toLowerCase(), "details");
  assert.ok(!detail.hasAttribute("open"), "the confusion detail ships collapsed");
});

test("the confusion detail carries one row per human label, from the report", () => {
  const report = scoreAgreementCorpus(corpus);
  const doc = paintedPage(report);
  const terms = [...doc.getElementById("classifier-agreement-confusion-list")
    .querySelectorAll("dt")].map((node) => textOf(node));
  assert.deepEqual(terms, confusionRows(report).map((row) => row.term));
  assert.equal(terms.length, report.perClass.length,
    "every label a reviewer may assign gets a row, including the ones that agree");
});

// --- the page entry actually paints it --------------------------------------

test("the shipped page entry computes and paints the figure from the served corpus", async () => {
  const page = await loadPage(new URL("../src/evolution.html", import.meta.url), {
    routes: { "/finops-classifier-agreement-corpus.json": corpus },
  });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  await waitFor(
    () => document.getElementById("classifier-agreement")?.getAttribute("data-agreement") === "measured",
    "the agreement region to be painted by the page entry");
  const report = scoreAgreementCorpus(corpus);
  assert.equal(textOf(document.getElementById("classifier-agreement-headline")),
    agreementCopy(report).headline,
    "the number a visitor reads is the one this test just computed, not a stored one");
});

test("a corpus that did not load paints no figure at all", () => {
  const doc = parseHtml(html);
  renderClassifierAgreement(doc, null);
  const headline = textOf(doc.getElementById("classifier-agreement-headline"));
  assert.match(headline, /did not load/);
  assert.equal(textOf(doc.getElementById("classifier-agreement-caveat")), "");
  assert.ok(!/\d/.test(headline), "no number survives a failed load");
});
