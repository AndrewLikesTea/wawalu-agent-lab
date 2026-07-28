// Imported briefings replace the demonstration, and the same month twice does
// not become two months of evidence on the way through.
//
// The briefing files here are BUILT with the product's own exporter from the
// same month envelopes the verification fixtures use, then read back through the
// product's own reader. A committed JSON file would agree with itself forever;
// these fail the moment either side of the briefing seam moves.

import assert from "node:assert/strict";
import test from "node:test";
import { byClass, first, installDocument, tags } from "./support/dom.js";

installDocument();

const { briefingFile } = await import("../src/finops-briefing-export.js");
const {
  SAVINGS_EVIDENCE_BUNDLE_VERSION,
  importedSavingsClaim,
  readEvidenceFile,
  readEvidenceFiles,
  savingsEvidenceBundle,
} = await import("../src/savings-evidence.js");
const { renderSavingsActionCenter, renderEvidenceRejections } =
  await import("../src/savings-action-center-view.js");
const { monthEnvelope, usageRow } =
  await import("./fixtures/commitment-verification/paired-periods.js");

/**
 * One month, exported exactly as the AI FinOps page exports it.
 *
 * The later months here save by moving *traffic* off the committed route rather
 * than by repricing it: the file's one per-route figure is its own commitment
 * block, and a route that has fallen below the routing rule's premium floor no
 * longer has one. That is the shape a real migration has, and it is why volume
 * falls in these fixtures while the observed unit price does not.
 */
function briefing(month, { spendMinor, tokens = 10_000_000, requests = 5_000 } = {}) {
  const [year, index] = month.split("-").map(Number);
  const next = index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, "0")}`;
  const analysis = monthEnvelope({
    modelUsage: [usageRow({
      spendMinor,
      tokens,
      inputTokens: Math.round(tokens * 0.6),
      outputTokens: tokens - Math.round(tokens * 0.6),
      requests,
    })],
    period: `${month}-01 to ${next}-01`,
    generatedAt: `${next}-02T09:15:00.000Z`,
  });
  const file = briefingFile(analysis, { dataset: "user", exportedAt: `${next}-02T09:20:00.000Z` });
  return { name: `briefing-${month}.json`, text: file.text, byteSize: file.text.length };
}

// 300.00 USD baseline, 150.00 USD projected monthly saving.
const june = () => briefing("2026-06", { spendMinor: 30_000 });
// Half the traffic, at the same unit price: 150.00 USD observed, exactly on plan.
const july = () => briefing("2026-07", { spendMinor: 15_000, tokens: 5_000_000, requests: 2_500 });
// Less again: 120.00 USD observed, 180.00 USD realized against a 150.00 USD plan.
const august = () => briefing("2026-08", { spendMinor: 12_000, tokens: 4_000_000, requests: 2_000 });

function opened(...files) {
  const read = readEvidenceFiles(files);
  assert.deepEqual(read.rejected, [], "a briefing this build wrote must be readable by it");
  return read.opened;
}

test("a saved briefing is read as one month with the commitment it carries", () => {
  const [entry] = opened(june());
  assert.equal(entry.month, "2026-06");
  assert.equal(entry.dataset, "user");
  assert.equal(entry.commitment.status, "ok");
  assert.equal(entry.commitment.commitment.baseline.period, "2026-06");
});

test("two consecutive imported months answer the question with a verified saving", () => {
  const claim = importedSavingsClaim(opened(june(), july(), august()));
  assert.equal(claim.source, "imported");
  assert.equal(claim.status, "ok");
  assert.equal(claim.verdict, "verified");
  assert.equal(claim.monthsCounted, 2);
  assert.match(claim.headline, /^Verified/);
  assert.match(claim.metric.label, /2 observed months/);
  assert.equal(claim.metric.value, "330.00 USD");
  assert.match(claim.nextAction.label, /Bank the saving/);
  assert.deepEqual(claim.months.map((month) => month.period), ["2026-07", "2026-08"]);
  assert.deepEqual(claim.facts.map((entry) => entry.label),
    ["Accountable department", "Expected effect", "Confidence", "Provenance"]);
  assert.match(claim.facts[1].value, /a month by routing/);
  assert.match(claim.facts[3].value, /imported record from briefing-2026-06\.json, your own import/);
  assert.ok(claim.calculation.rows.some((row) => row.label === "Sustained total"));
  assert.equal(claim.exportable, true);
});

test("the same month opened twice is one month, and cannot verify a saving", () => {
  const claim = importedSavingsClaim(opened(june(), july(), july()));
  assert.equal(claim.status, "unavailable");
  assert.equal(claim.reason, "insufficient_evidence");
  assert.equal(claim.verdict, null, "an unavailable claim states no verdict");
  assert.equal(claim.monthsCounted, 1);
  assert.match(claim.headline, /Fewer distinct months/);
  assert.match(claim.nextAction.label, /Import August 2026/);
  assert.ok(claim.notes.some((note) => /July 2026 was opened 2 times and counts as one month/.test(note)),
    "the reader is told the month was opened twice");
  // The provisional figure is still shown, and is one month's worth.
  assert.match(claim.metric.label, /1 observed month\b/);
  assert.equal(claim.metric.value, "150.00 USD");
});

test("months that disagree, or arrive out of sequence, are named rather than counted", () => {
  const conflicting = importedSavingsClaim(opened(june(), july(),
    briefing("2026-07", { spendMinor: 24_000, tokens: 8_000_000, requests: 4_000 })));
  assert.equal(conflicting.monthsCounted, 0);
  assert.ok(conflicting.notes.some((note) => /copies disagree/.test(note)));

  const gapped = importedSavingsClaim(opened(june(), july(),
    briefing("2026-09", { spendMinor: 12_000, tokens: 4_000_000, requests: 2_000 })));
  assert.equal(gapped.monthsCounted, 1);
  assert.ok(gapped.notes.some((note) => /September 2026: .*unbroken run/.test(note)));
});

test("briefings that propose no commitment are a stated state, not an empty panel", () => {
  const flat = briefing("2026-06", { spendMinor: 0 });
  const claim = importedSavingsClaim(opened(flat));
  assert.equal(claim.reason, "no_commitment");
  assert.match(claim.headline, /None of the briefings that were opened proposes a commitment/);
  assert.match(claim.nextAction.label, /Open a month that proposes a commitment/);
  assert.equal(claim.metric, null);
  const view = renderSavingsActionCenter(claim);
  assert.equal(tags(view, "H2")[0].id, "sac-question");
  assert.equal(view.dataset.state, "none");
});

test("evidence exports as one file that reopens into the same claim", () => {
  const first3 = opened(june(), july(), august());
  const bundle = savingsEvidenceBundle(first3, { exportedAt: "2026-09-03T10:00:00.000Z" });
  assert.equal(bundle.fileName, "shiplog-savings-evidence.json");
  assert.equal(JSON.parse(bundle.text).schemaVersion, SAVINGS_EVIDENCE_BUNDLE_VERSION);
  assert.deepEqual(JSON.parse(bundle.text).months, ["2026-06", "2026-07", "2026-08"]);

  const reopened = readEvidenceFile({ name: bundle.fileName, text: bundle.text });
  assert.deepEqual(reopened.rejected, []);
  assert.equal(reopened.opened.length, 3);
  assert.deepEqual(
    importedSavingsClaim(reopened.opened).months,
    importedSavingsClaim(first3).months,
  );
  assert.equal(importedSavingsClaim(reopened.opened).verdict, "verified");
});

test("a file that is not a briefing is refused by name, with the reader's own sentence", () => {
  const read = readEvidenceFile({ name: "notes.txt", text: "not json at all" });
  assert.deepEqual(read.opened, []);
  assert.equal(read.rejected[0].name, "notes.txt");
  assert.ok(read.rejected[0].message.length > 20);

  const alert = renderEvidenceRejections(read.rejected);
  assert.equal(alert.getAttribute("role"), "alert");
  assert.match(alert.textContent, /notes\.txt/);
  assert.equal(renderEvidenceRejections([]), null);
});

test("an imported verdict paints one metric, the counted months, and the caveat", () => {
  const view = renderSavingsActionCenter(importedSavingsClaim(opened(june(), july(), august())));
  assert.equal(view.dataset.source, "imported");
  assert.equal(view.dataset.state, "verified");
  assert.equal(first(view, "sac-metric-value").textContent, "330.00 USD");
  assert.equal(byClass(view, "sac-month").length, 2);
  assert.equal(byClass(view, "sac-month")[0].dataset.verdict, "achieved");
  assert.equal(tags(view, "DETAILS").length, 1, "the arithmetic stays behind one disclosure");
  assert.match(first(view, "sac-caveat").textContent, /UPPER BOUND/);
  assert.match(first(view, "sac-contracts").textContent, /savings-commitment-verification-series/);
});
