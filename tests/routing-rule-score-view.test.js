// The routing score, painted into the "Act and verify" destination on
// /evolution.html. The aggregate has to be readable without opening anything, and
// every rule row has to carry the threshold that produced its verdict.

import test from "node:test";
import assert from "node:assert/strict";

import { loadPage, textOf } from "./support/browser.js";
import { ROUTING_RULE_SCORE_REASONS } from "../src/routing-rule-score.js";
import {
  ROUTING_RULE_SCORE_BODY_ID, ROUTING_RULE_SCORE_SECTION_ID, ROUTING_RULE_SCORE_STATUS_ID,
  applyRoutingRuleScore,
} from "../src/routing-rule-score-view.js";
import {
  commitmentRecord, followUpExport, priorPolicy,
} from "./fixtures/routing-rule-score/shipped-policy.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

/**
 * The follow-up envelope, in the shape the page's own analysis publishes: one
 * per-unit trend per department, which is what the observed series is read from.
 * "Delta Research" carries no usable trend, so it reaches the score as absent
 * coverage exactly as it does in the pure-function fixture.
 */
function followUpAnalysis() {
  const departments = followUpExport().map((entry) => ({
    name: entry.unit,
    previousSpendUsd: entry.periods[0].total,
    spendUsd: entry.periods[1].total,
    trendAvailable: true,
  }));
  departments.push({
    name: "Delta Research", previousSpendUsd: null, spendUsd: 900, trendAvailable: false,
  });
  return { period: "2026-08-01 to 2026-09-01", rankedDepartments: departments };
}

async function paint(options = {}) {
  const { document } = await loadPage(PAGE, { scripts: false });
  const payload = applyRoutingRuleScore(document, priorPolicy(), {
    commitment: commitmentRecord(), followUpAnalysis: followUpAnalysis(), ...options,
  });
  return { document, payload };
}

const section = (document) => document.getElementById(ROUTING_RULE_SCORE_SECTION_ID);

test("the panel sits in the Act and verify destination and states its question", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  const node = section(document);
  assert.equal(node.getAttribute("data-workspace-region"), "act-and-verify");
  assert.equal(node.getAttribute("aria-labelledby"), "routing-rule-score-title");
  assert.match(
    textOf(document.getElementById("routing-rule-score-title")),
    /Did last period's routing rules return what they said they would\?/,
  );
});

test("the aggregate verdict and its stated rule are readable without interaction", async () => {
  const { document, payload } = await paint();
  assert.equal(payload.aggregate, "partially-met");
  const node = section(document);
  assert.equal(node.getAttribute("data-verdict"), "partially-met");
  assert.equal(node.getAttribute("data-scored-count"), "3");

  const figure = document.querySelectorAll(".answer-figure")
    .filter((entry) => entry.closest(`#${ROUTING_RULE_SCORE_SECTION_ID}`));
  assert.equal(figure.length, 1);
  const text = textOf(figure[0]);
  assert.match(text, /Routing rules scored over 2026-07 to 2026-08/);
  assert.match(text, /Partially met/);
  assert.match(text, /3 of 4 rules scored; 1 excluded for want of evidence/);
  assert.match(text, /Rules with no evidence are excluded from this verdict/);
  // The figure is a sibling of the disclosures, never inside one: a closed
  // disclosure is dropped from the accessibility tree in a real browser.
  assert.equal(figure[0].closest("details"), null);
});

test("the status line names the register, both periods, and the excluded count", async () => {
  const { document } = await paint();
  const status = document.getElementById(ROUTING_RULE_SCORE_STATUS_ID);
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("data-state"), "ready");
  assert.equal(
    textOf(status),
    "4 routing rules on the 2026-07 analysis: 3 scored over 2026-07 to 2026-08, "
    + "1 with not enough evidence.",
  );
});

test("every rule row carries its verdict and the threshold that produced it", async () => {
  const { document } = await paint();
  const rows = document.querySelectorAll("details")
    .filter((entry) => entry.closest(`#${ROUTING_RULE_SCORE_BODY_ID}`));
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.getAttribute("data-verdict")),
    ["met", "partially-met", "missed", "not-enough-evidence"]);

  const atlas = textOf(rows[0]);
  assert.match(atlas, /1\. Atlas Platform → standard tier · expected \$400/);
  assert.match(atlas, /Expected \$400, observed \$400, in Atlas Platform\./);
  assert.match(atlas, /Threshold \$380\. Observed saving reached 95% of the expected return\./);
  assert.match(atlas, /Basis: rule:Atlas Platform@Atlas Platform\|periods:2026-07->2026-08/);

  assert.match(textOf(rows[1]), /Expected \$200, observed \$100/);
  assert.match(textOf(rows[1]), /Threshold \$190\./);
  assert.match(textOf(rows[2]), /Expected \$160, observed -\$100/);
  assert.match(textOf(rows[2]), /Threshold \$0\. Observed saving at or below the missed floor/);
});

test("a rule with no evidence shows the missing coverage in prose and no figure", async () => {
  const { document } = await paint();
  const rows = document.querySelectorAll("details")
    .filter((entry) => entry.closest(`#${ROUTING_RULE_SCORE_BODY_ID}`));
  const delta = textOf(rows[3]);
  assert.match(delta, /Not enough evidence/);
  assert.match(delta, /No cost rows for "Delta Research" anywhere in the follow-up export/);
  assert.doesNotMatch(delta, /Threshold/);
  // The only dollar figure on the row is the expectation the policy stated. No
  // observed figure, no zero, no interpolated estimate.
  assert.deepEqual(delta.match(/-?\$[\d,]+/g), ["$120"]);
});

test("an import for a month the commitment never covered is refused, not scored", async () => {
  const { document, payload } = await paint({
    followUpAnalysis: { ...followUpAnalysis(), period: "2026-09-01 to 2026-10-01" },
  });
  assert.equal(payload.available, false);
  assert.equal(payload.reason, ROUTING_RULE_SCORE_REASONS.period_mismatch);
  assert.equal(section(document).getAttribute("data-state"), "unavailable");
  assert.match(textOf(document.getElementById(ROUTING_RULE_SCORE_BODY_ID)),
    /is not the period this commitment is answerable for/);
});

test("with nothing committed the panel says why rather than painting a verdict", async () => {
  const { document, payload } = await paint({ commitment: null });
  assert.equal(payload.available, false);
  assert.equal(payload.reason, ROUTING_RULE_SCORE_REASONS.no_commitment);
  const rows = document.querySelectorAll("details")
    .filter((entry) => entry.closest(`#${ROUTING_RULE_SCORE_BODY_ID}`));
  assert.equal(rows.length, 0);
});

test("an org unit name carrying markup renders as characters, not as an element", async () => {
  const hostile = priorPolicy();
  hostile.rankedDepartments[0].name = "Atlas <script>x</script>";
  hostile.rankedDepartments[0].downRouting.unitLabel = hostile.rankedDepartments[0].name;
  const { document } = await loadPage(PAGE, { scripts: false });
  applyRoutingRuleScore(document, hostile, {
    commitment: commitmentRecord(), followUpAnalysis: followUpAnalysis(),
  });
  const body = document.getElementById(ROUTING_RULE_SCORE_BODY_ID);
  assert.match(textOf(body), /Atlas <script>x<\/script>/);
  assert.equal(body.querySelectorAll("script").length, 0);
});
