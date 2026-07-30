// What a leader's own partial evidence supports, and what it must never imply.
//
// Four groups, checking different claims:
//
//   1. THE CALENDAR. The regression this build exists for: a `YYYY-MM-DD`-shaped
//      string for a day that does not exist is refused, not rolled forward into
//      the next month and counted.
//   2. USABLE VERSUS EXCLUDED. One record in, one record out, and the figure in
//      between: a partial total is labelled a floor, an excluded record
//      contributes nothing rather than zero, and the exclusion carries the one
//      reason it failed on rather than all of them.
//   3. REJECTED AND REVIEW GAPS. An upstream rejection and an open review gap
//      each keep the finding partial and each own a place in the action
//      priority, in the declared order.
//   4. THE SURFACE. The shipped markup of src/evolution.html carries the region,
//      and the real page entry paints an imported finding into it — with no peer
//      comparison measured — then hands it back when the import is cleared.
//
// Nothing here reads a clock, a network, or a random source, and no expectation
// is transcribed: every figure is recomputed from the input under test.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import { chooseFiles, evidencePainted, exampleSelection, openFinopsTab } from "./partial-evidence-probe.mjs";
import {
  ACTION_CODE, ATTRIBUTION_FLOOR, EXCLUSION_CODE, FINDING_STATE, PARTIAL_EVIDENCE_QUESTION,
  PARTIAL_EVIDENCE_VERSION, evaluatePartialEvidence, partialEvidenceFromAnalysis,
} from "../src/partial-evidence.js";
import {
  PARTIAL_EVIDENCE_BODY_ID, PARTIAL_EVIDENCE_SECTION_ID, PARTIAL_EVIDENCE_TITLE_ID,
  applyPartialEvidence, clearPartialEvidence,
} from "../src/partial-evidence-view.js";

const PERIOD = Object.freeze({ start: "2026-06-01", end: "2026-07-01" });

/** One admissible record unless an override makes it otherwise. */
const record = (id, overrides = {}) => ({
  id,
  providerLabel: `${id} export`,
  periodStart: PERIOD.start,
  periodEnd: PERIOD.end,
  currencyCode: "USD",
  spendUsd: 1000,
  provenanceLabel: `${id} usage export`,
  ...overrides,
});

const evaluate = (overrides = {}) => evaluatePartialEvidence({
  requiredPeriod: PERIOD, currencyCode: "USD", records: [], ...overrides,
});

const codeOf = (result, id) =>
  result.evidence.excluded.find((entry) => entry.id === id)?.code ?? null;

/* --------------------------------- the calendar -------------------------------- */

test("a day that does not exist is excluded, never rolled into the next month", () => {
  const result = evaluate({
    records: [record("openai"), record("anthropic", { periodStart: "2026-02-29" })],
    requiredPeriod: { start: "2026-01-01", end: "2026-07-01" },
  });

  assert.equal(codeOf(result, "anthropic"), EXCLUSION_CODE.unreadablePeriod);
  // The proof that nothing was normalized: the excluded amount is absent from
  // the figure entirely rather than present as a March period.
  assert.equal(result.material.value, 1000);
  assert.equal(result.evidence.admissible, 1);
  assert.equal(result.evidence.usable.some((entry) => entry.periodStart.startsWith("2026-03")),
    false, "an impossible February date must not reappear as a March window");
});

test("an impossible declared window is fatal and names the bound that failed", () => {
  const result = evaluate({
    requiredPeriod: { start: "2026-02-29", end: "2026-07-01" }, records: [record("openai")],
  });

  assert.equal(result.state, FINDING_STATE.insufficient);
  assert.match(result.contractErrors[0], /requiredPeriod\.start/);
  // No per-record blame for a declaration the reader did not write, and no
  // amount at all: the material slot falls back to a count of exports.
  assert.equal(result.evidence.excluded.length, 0);
  assert.equal(result.material.kind, "benchmark");
});

test("the leap day that does exist is admissible, so the rule is a calendar", () => {
  const result = evaluate({
    requiredPeriod: { start: "2024-02-01", end: "2024-04-01" },
    records: [record("openai", { periodStart: "2024-02-29", periodEnd: "2024-03-31" })],
  });

  assert.equal(result.state, FINDING_STATE.supported);
  assert.equal(result.evidence.admissible, 1);
});

/* --------------------------- usable versus excluded ---------------------------- */

test("a complete reading is a total; anything held back makes it a labelled floor", () => {
  const complete = evaluate({ records: [record("openai"), record("anthropic")] });
  assert.equal(complete.state, FINDING_STATE.supported);
  assert.equal(complete.partial, false);
  assert.equal(complete.material.partial, false);
  assert.equal(complete.material.value, 2000);
  assert.equal(complete.material.partialReason, null);
  assert.equal(complete.nextAction.code, ACTION_CODE.recordTheDecision);

  const partial = evaluate({
    records: [record("openai"), record("aws", { currencyCode: "EUR" })],
  });
  assert.equal(partial.state, FINDING_STATE.partial);
  assert.equal(partial.material.partial, true);
  // The excluded record contributes nothing — not zero. Same figure as the
  // one-record case above, which is what "nothing" means arithmetically.
  assert.equal(partial.material.value, 1000);
  assert.match(partial.material.label, /partial floor/i);
  assert.match(partial.material.partialReason, /floor/);
  assert.equal(codeOf(partial, "aws"), EXCLUSION_CODE.incompatibleCurrency);
});

test("each rule excludes what it is for, and a record carries one reason only", () => {
  const result = evaluate({
    requiredPeriod: { start: "2026-01-01", end: "2026-07-01" },
    records: [
      record("clean"),
      record("nodate", { periodStart: "2026-06-31" }),
      record("outside", { periodStart: "2025-12-01", periodEnd: "2026-01-01" }),
      record("euro", { currencyCode: "EUR" }),
      record("unreadable", { spendUsd: "1,204" }),
      record("clean", { spendUsd: 5000 }),
    ],
  });

  assert.equal(codeOf(result, "nodate"), EXCLUSION_CODE.unreadablePeriod);
  assert.equal(codeOf(result, "outside"), EXCLUSION_CODE.outsideRequiredPeriod);
  assert.equal(codeOf(result, "euro"), EXCLUSION_CODE.incompatibleCurrency);
  assert.equal(codeOf(result, "unreadable"), EXCLUSION_CODE.unreadableAmount);
  assert.equal(result.evidence.excluded.filter((entry) => entry.id === "clean").length, 1,
    "the repeated export id is the duplicate, and only the second copy is excluded");
  assert.equal(codeOf(result, "clean"), EXCLUSION_CODE.duplicateExport);
  // A record that fails two rules reports the first one in EXCLUSION_ORDER.
  const both = evaluate({
    records: [record("openai"), record("both", { periodStart: "2026-06-31", currencyCode: "EUR" })],
  });
  assert.equal(codeOf(both, "both"), EXCLUSION_CODE.unreadablePeriod);
  assert.equal(both.evidence.excluded.length, 1);
});

test("nothing admissible publishes a count of exports, never an amount", () => {
  const result = evaluate({ records: [record("euro", { currencyCode: "EUR" })] });

  assert.equal(result.state, FINDING_STATE.insufficient);
  assert.equal(result.material.kind, "benchmark");
  assert.equal(result.material.unit, "share_of_exports");
  assert.equal(result.material.value, 0);
  assert.doesNotMatch(result.material.display, /\d+\.\d\d/,
    "no dollar figure may be printed while nothing is usable");
  assert.equal(result.headline.includes("USD"), false);
});

test("an empty import asks for a file rather than reporting a finding of zero", () => {
  const result = evaluate({ records: [] });

  assert.equal(result.state, FINDING_STATE.insufficient);
  assert.equal(result.nextAction.code, ACTION_CODE.selectProviderExport);
  assert.equal(result.material.value, null);
});

/* ----------------------- rejected exports and review gaps ---------------------- */

test("an upstream rejection is disclosed with its own words, not absorbed", () => {
  const result = evaluate({
    records: [record("openai")],
    heldOut: [{
      id: "aws-1", providerLabel: "Bedrock export", code: "unsupported_currency",
      reason: "Bedrock export is priced in EUR; only USD exports are added together.",
    }],
  });

  assert.equal(result.state, FINDING_STATE.partial);
  const held = result.evidence.excluded[0];
  assert.equal(held.origin, "upstream");
  assert.equal(held.code, "unsupported_currency");
  assert.match(held.reason, /priced in EUR/);
  assert.equal(result.nextAction.code, ACTION_CODE.recoverExcludedEvidence);
  assert.match(result.nextAction.statement, /Bedrock export/);
});

test("an open review gap keeps the finding partial and outranks re-exporting", () => {
  const result = evaluate({
    records: [record("openai")],
    heldOut: [{ id: "aws-1", providerLabel: "Bedrock export", code: "stale_export" }],
    review: { state: "needs_review", gaps: [{ code: "quarantined", message: "Two rows quarantined." }] },
  });

  assert.equal(result.state, FINDING_STATE.partial);
  assert.equal(result.review.open, true);
  assert.equal(result.nextAction.code, ACTION_CODE.resolveReviewGaps);
  assert.match(result.material.partialReason, /review gap remains open/);
});

test("the action priority is the declared order, first condition wins", () => {
  const base = {
    records: [record("openai"), record("bad", { periodStart: "2026-02-30" })],
    review: { state: "needs_review", gaps: [{ code: "g", message: "A gap." }] },
    attribution: { share: 0.1 },
  };
  // Impossible dates outrank everything else that is also true.
  assert.equal(evaluate(base).nextAction.code, ACTION_CODE.correctImpossibleDates);
  // Remove them and the review gap is next.
  assert.equal(evaluate({ ...base, records: [record("openai")] }).nextAction.code,
    ACTION_CODE.resolveReviewGaps);
  // Then a held-out export.
  assert.equal(evaluate({
    ...base, records: [record("openai")], review: null,
    heldOut: [{ id: "h", providerLabel: "Held export", code: "stale_export" }],
  }).nextAction.code, ACTION_CODE.recoverExcludedEvidence);
  // Then attribution, and only below the declared floor.
  const under = evaluate({ records: [record("openai")], review: null, attribution: { share: 0.1 } });
  assert.equal(under.nextAction.code, ACTION_CODE.attributeUnassignedSpend);
  assert.equal(under.attribution.floor, ATTRIBUTION_FLOOR);
  const over = evaluate({
    records: [record("openai")], review: null, attribution: { share: ATTRIBUTION_FLOOR },
  });
  assert.equal(over.nextAction.code, ACTION_CODE.recordTheDecision);
});

test("no input reaches a peer comparison, and an unavailable one says so", () => {
  const absent = evaluate({ records: [record("openai")] });
  assert.equal(absent.peer.measured, false);
  assert.match(absent.peer.statement, /No peer comparison was measured/);

  const refused = evaluate({
    records: [record("openai")], peer: { available: false, reason: "no_comparable_peer_metric" },
  });
  assert.equal(refused.peer.reason, "no_comparable_peer_metric");
  // Available or not, this policy never restates a figure, so no number from a
  // comparison can appear in any string it publishes.
  const available = evaluate({ records: [record("openai")], peer: { available: true } });
  assert.equal(available.peer.measured, true);
  assert.doesNotMatch(available.peer.statement, /\d/);
});

test("the closed field set drops anything the policy does not declare", () => {
  const result = evaluate({
    records: [record("openai", { apiKey: "sk-live-should-never-travel", promptText: "hello" })],
  });

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("sk-live"), false);
  assert.equal(serialized.includes("promptText"), false);
  assert.equal(result.version, PARTIAL_EVIDENCE_VERSION);
});

test("the analysis adapter names every field it forwards", () => {
  const input = partialEvidenceFromAnalysis({
    analysis: {
      period: "2026-06-01 to 2026-07-01",
      spendUsd: 4200.75,
      provenance: "OpenAI usage export",
      multiProvider: {
        providers: [{ provider: "openai", label: "OpenAI", costBasis: "billed_amount" }],
        rejections: [{
          exportId: "aws-1", providerLabel: "Bedrock", code: "unsupported_currency",
          message: "Priced in EUR.", action: "Re-export in USD.",
        }],
      },
      validation: { state: "needs_review", results: [{ code: "quarantine", message: "One held." }] },
    },
    peer: { available: false, unavailable: { reason: "no_comparable_peer_metric" } },
    attributedShare: 0.42,
  });

  assert.deepEqual(input.requiredPeriod, { start: "2026-06-01", end: "2026-07-01" });
  assert.equal(input.records.length, 1);
  assert.equal(input.records[0].spendUsd, 4200.75);
  assert.equal(input.heldOut[0].code, "unsupported_currency");
  assert.match(input.heldOut[0].reason, /Re-export in USD/);
  assert.equal(input.review.state, "needs_review");
  assert.equal(input.peer.available, false);
  assert.equal(input.attribution.share, 0.42);

  const result = evaluatePartialEvidence(input);
  assert.equal(result.state, FINDING_STATE.partial);
  assert.equal(result.material.value, 4200.75);
  assert.equal(result.nextAction.code, ACTION_CODE.resolveReviewGaps);
});

/* ----------------------------- the shipped surface ----------------------------- */

test("the shipped markup carries the region, its question, and no answer", async () => {
  const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
  const document = parseHtml(html);
  const section = document.getElementById(PARTIAL_EVIDENCE_SECTION_ID);

  assert.ok(section, "the region has to exist in the page a reader is served");
  assert.equal(section.hidden, true, "no finding exists before anything is imported");
  assert.equal(section.dataset.state, "absent");
  assert.equal(textOf(document.getElementById(PARTIAL_EVIDENCE_TITLE_ID)),
    PARTIAL_EVIDENCE_QUESTION);
  assert.equal(textOf(document.getElementById(PARTIAL_EVIDENCE_BODY_ID)), "",
    "every sentence is painted, so the markup may hold no state word or figure");
});

test("the front door paints an imported finding and no measured peer comparison", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    const section = document.getElementById(PARTIAL_EVIDENCE_SECTION_ID);
    assert.equal(section.hidden, true, "a visitor who imported nothing meets no finding");

    chooseFiles(document, exampleSelection());
    await evidencePainted(document);

    // Whose evidence this is, judged by which policy — both readable as facts on
    // the element rather than only as prose inside it.
    assert.equal(section.dataset.source, "import");
    assert.equal(section.dataset.policyVersion, PARTIAL_EVIDENCE_VERSION);
    // The finding is derived, not authored: the admissible count on the section
    // equals the number of counted exports the disclosure lists.
    assert.equal(section.dataset.admissible,
      String(document.querySelectorAll(".pe-usable").length));
    assert.ok(Number(section.dataset.admissible) > 0);
    // Exactly one material figure and exactly one action, always.
    assert.equal(document.querySelectorAll(".pe-material").length, 1);
    assert.equal(document.querySelectorAll(".pe-action").length, 1);
    assert.ok(document.querySelector(".pe-action").dataset.actionCode);
    // The refusal that must survive every state: no peer comparison was
    // measured, and the region says so where a reader and a reviewer both see it.
    assert.equal(section.dataset.peerMeasured, "false");
    assert.equal(document.querySelector(".pe-peer").dataset.measured, "false");
    assert.match(textOf(document.querySelector(".pe-peer")), /No peer comparison was measured/);
    // Progressive disclosure: the exclusions and the provenance are behind a
    // native summary, shut on arrival.
    const disclosure = document.querySelector(".pe-disclosure");
    assert.equal(disclosure.tagName.toLowerCase(), "details");
    assert.equal(Boolean(disclosure.open), false);
    assert.match(textOf(document.querySelector(".pe-provenance")), /browser local ephemeral/);

    // And the finding goes with the evidence. There is no bundled fallback: a
    // synthetic answer to "what do my exports support" is the claim this region
    // refuses.
    document.getElementById("clear-local-analysis").click();
    assert.equal(section.hidden, true);
    assert.equal(section.dataset.state, "absent");
  } finally {
    page.restore();
  }
});

test("a partial finding stamps the figure in words a screen reader reaches", async () => {
  const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
  const document = parseHtml(html);
  const result = evaluatePartialEvidence({
    requiredPeriod: PERIOD,
    currencyCode: "USD",
    records: [record("openai"), record("aws", { currencyCode: "EUR" })],
  });

  applyPartialEvidence(document, result);
  const section = document.getElementById(PARTIAL_EVIDENCE_SECTION_ID);
  assert.equal(section.dataset.state, FINDING_STATE.partial);
  assert.equal(section.dataset.partial, "true");
  assert.equal(section.dataset.excluded, "1");
  const stamp = document.querySelector(".pe-material-partial");
  assert.equal(stamp.dataset.stamp, "partial");
  assert.match(textOf(stamp), /Partial floor/);
  // The state is a word before it is a glyph, and the glyph is hidden from
  // assistive technology rather than read out as punctuation.
  assert.match(textOf(document.querySelector(".pe-headline-word")), /Partial support/);
  assert.equal(document.querySelector(".pe-headline-shape").getAttribute("aria-hidden"), "true");
  // The one exclusion is listed with its code and its reason.
  const excluded = document.querySelector(".pe-exclusion");
  assert.equal(excluded.dataset.code, EXCLUSION_CODE.incompatibleCurrency);
  assert.match(textOf(excluded), /cannot obtain a rate locally/);

  clearPartialEvidence(document);
  assert.equal(section.hidden, true);
  assert.equal(textOf(document.getElementById(PARTIAL_EVIDENCE_BODY_ID)), "");
});
