// Translation regression for the one-click example dataset.
//
// The dataset is only worth shipping if it is a real input: raw provider and
// HRIS bytes that walk the shipped translator and the shipped analysis. So the
// assertions here are deliberately about the *envelope* — its shape and its key
// totals — not about a stored result. If the contract tightens, this fails with
// every other importer test, which is the reason the dataset exists in this
// form rather than as a committed result object.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { exampleDatasetFiles, loadExampleDataset } from "../src/example-dataset.js";
import {
  LOCAL_KINDS, localFinopsJsonExport, localFinopsMeetingSummary, parseLocalFinopsFile,
} from "../src/local-finops.js";

test("the example dataset ships raw provider and HRIS files, not a result", () => {
  const files = exampleDatasetFiles();
  assert.equal(files.length, 7, "six consecutive months plus one org roster");
  for (const file of files) {
    assert.match(file.fileName, /\.json$/);
    assert.equal(file.mediaType, "application/json");
    // Raw bytes, accepted by exactly the call the file input makes.
    const parsed = parseLocalFinopsFile(file.text, file.fileName, file.mediaType);
    assert.ok(["provider", "hris"].includes(parsed.type));
  }
  const kinds = files.map((file) => JSON.parse(file.text).kind);
  assert.equal(kinds.filter((kind) => kind === LOCAL_KINDS.provider).length, 6);
  assert.equal(kinds.filter((kind) => kind === LOCAL_KINDS.hris).length, 1);

  const periods = files
    .map((file) => JSON.parse(file.text))
    .filter((document) => document.kind === LOCAL_KINDS.provider)
    .map((document) => [document.snapshot.period_start, document.snapshot.period_end]);
  // Six *consecutive complete* calendar months: each period ends where the next
  // begins, and every boundary is the first of a month.
  assert.deepEqual(periods.map(([start]) => start), [
    "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01",
  ]);
  for (const [index, [, end]] of periods.entries())
    assert.equal(end, periods[index + 1]?.[0] ?? "2026-07-01");
});

test("the example dataset carries no real identifier and no committed result", async () => {
  const source = await readFile(new URL("../src/example-dataset.js", import.meta.url), "utf8");
  // Nothing resembles a provider-issued resource or account identifier.
  assert.ok(!/arn:aws|\bi-0[0-9a-f]{8}/.test(source), "no provider resource identifier");
  for (const file of exampleDatasetFiles()) {
    for (const match of file.text.matchAll(/"psn_[^"]+"/g))
      assert.match(match[0], /^"psn_example_[A-Za-z0-9_-]+"$/, `${match[0]} must be an example pseudonym`);
  }
  // No pre-computed answer is stored: the numbers in the source are inputs.
  //
  // The module now also derives the example's peer cohort from an envelope it is
  // handed, so *naming* an analysis field is expected and the bare-mention scan
  // this used to be would fail on a read. What must never appear is one of those
  // fields with a number authored beside it — a stored answer, which is the
  // thing the assumption above actually forbids.
  assert.doesNotMatch(source, /(spendUsd|recoverableUsd|medianValue|coveredUsd)\s*[:=][^=]*\d/,
    "an analysis figure is authored into the dataset module rather than derived");
});

test("the example dataset translates to a valid envelope with stable key totals", () => {
  const envelope = loadExampleDataset();

  assert.equal(envelope.schemaVersion, "local-finops-history/1.0.0");
  assert.equal(envelope.validation.state, "valid");
  assert.deepEqual(envelope.validation.results, []);
  assert.deepEqual(envelope.warnings, []);
  assert.equal(envelope.quality.quarantinedRecords, 0);
  // Every record joins an active unit, so the analyzed total is the sum over
  // every line item in the month — the definition the finding relies on.
  assert.equal(envelope.quality.joinedRecords, 15);

  assert.equal(envelope.period, "2026-06-01 to 2026-07-01");
  assert.equal(envelope.spendUsd, 154_500);
  // 104,600 USD of the month's spend is text-generation billed in tokens. The
  // dataset bills 340 tokens per minor unit, so the observed price is
  // round(1e6 ÷ 340) = 2,941 minor per million — above the 2,000 premium floor —
  // and the same tokens at the 1,500 reference rate cost 53,346 USD.
  assert.equal(envelope.recoverableUsd, 51_254);
  assert.equal(envelope.confidence, "Medium");

  assert.equal(envelope.history.state, "available");
  assert.equal(envelope.history.periodCount, 6);
  assert.equal(envelope.history.previousPeriod, "2026-05-01 to 2026-06-01");
  assert.deepEqual(envelope.history.periods.map((period) => period.spendUsd),
    [112_000, 113_200, 113_400, 114_100, 115_300, 154_500]);

  // Five departments, one unambiguous driver, one flat, one declining.
  const byName = new Map(envelope.rankedDepartments.map((item) => [item.name, item]));
  assert.equal(byName.size, 5);
  const delta = (name) => byName.get(name).spendUsd - byName.get(name).previousSpendUsd;
  // Named, not elided (#1017): the loader speaks this invented company's own
  // roster, so a figure is keyed by the words the page actually prints.
  assert.equal(delta("Atlas Platform"), 34_500);
  assert.equal(delta("Quartz Analytics"), 4_000);
  assert.equal(delta("Ember Studio"), 2_200);
  assert.equal(delta("Boreal Support"), 0);
  assert.equal(delta("Cinder Research"), -1_500);
  // No tie at the top, so the leading finding cannot be arbitrary.
  const positive = [...byName.values()]
    .map((item) => item.spendUsd - item.previousSpendUsd)
    .filter((value) => value > 0).sort((left, right) => right - left);
  assert.ok(positive[0] > positive[1] * 2, "the top driver must be unambiguous");
  // The analysis's own top-ranked recommendation names that same driver.
  assert.equal(envelope.topDepartment.name, "Atlas Platform");
});

test("an export made from example data carries its provenance into the artifact", () => {
  const envelope = loadExampleDataset();

  const json = JSON.parse(localFinopsJsonExport(envelope, { exampleDataset: true }));
  assert.equal(json.dataset, "example");
  assert.match(json.datasetNotice, /EXAMPLE DATA/);
  assert.equal(json.results.spendUsd, 154_500);

  const summary = localFinopsMeetingSummary(envelope, { exampleDataset: true });
  assert.match(summary.split("\n")[0], /^EXAMPLE DATA/);

  // A real import is unchanged: no notice, and the dataset is the reader's own.
  const userJson = JSON.parse(localFinopsJsonExport(envelope));
  assert.equal(userJson.dataset, "user");
  assert.ok(!("datasetNotice" in userJson));
  assert.match(localFinopsMeetingSummary(envelope).split("\n")[0], /^LOCAL FINOPS/);
});
