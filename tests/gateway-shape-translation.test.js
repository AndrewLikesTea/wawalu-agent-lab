// The gateway mapping contract, held to the policy file it reads.
//
// Four properties, each with a test that fails when it stops holding:
//
//   1. THE MAPPING IS EXACT. Both target shapes are asserted character for
//      character against a committed policy fixture in the real #1138 schema.
//      These are not smoke tests: they exist so that RENAMING A POLICY FIELD
//      FAILS HERE rather than shipping a config with a hole in it, and the last
//      test in the section proves that by renaming one.
//   2. IT REFUSES RATHER THAN GUESSES. An unknown policy version translates
//      nothing and names the version it saw.
//   3. NOTHING IS SILENTLY DROPPED. A rule a shape cannot express is in
//      `untranslatable` with its reason, and is neither in the output nor
//      mangled into it.
//   4. THE PAGE SHOWS THE READER'S OWN POLICY, collapsed, with no input in it.

import assert from "node:assert/strict";
import test from "node:test";

import { loadExampleDataset } from "../src/example-dataset.js";
import {
  ACCEPTED_POLICY_VERSIONS, DEFAULT_FROM_CURRENT_TIER, FIELDS_NOT_CARRIED,
  GATEWAY_MAPPING_VERSION, GATEWAY_SHAPES, NO_CATCH_ALL, TRANSLATION_STATES,
  UNTRANSLATABLE_REASONS, gatewayShapeSnippet, translateRoutingPolicy, untranslatableSummary,
} from "../src/gateway-shape-translation.js";
import { ROUTING_POLICY_SCHEMA, routingPolicyDocument } from "../src/routing-policy-document.js";
import { routingSlate } from "../src/routing-slate.js";
import { GATEWAY_SHAPE_PREVIEW_ID, PREVIEW_SHAPE, applyRoutingSlate } from "../src/routing-slate-view.js";
import { loadPage, textOf } from "./support/browser.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const STAMP = "2026-08-05T09:30:00.000Z";

/**
 * A realistic multi-rule policy in the shape `routingPolicyDocument` writes, with
 * the three cases that actually occur in one file: a rule whose model the export
 * named, a rule from the per-org-unit form (where `sourceModel` repeats the org
 * unit because no model was named), and a rule whose current tier the analysis
 * could not classify.
 */
function policyFixture() {
  const guardrails = (unit, sourceTier, lifecycle) => ({
    appliesToOrgUnit: unit,
    appliesToSourceTier: sourceTier,
    derivedFromPeriod: "2026-07-01 to 2026-07-31",
    confidence: "medium",
    basis: "Modelled potential, not realized savings",
    lifecycle,
    reviewBeforeApply: true,
  });
  const evidence = (statement, rank) => ({
    statement, derivedFrom: "per-model", slateVersion: "routing-slate/1.0.0", rank,
  });
  return {
    schema: ROUTING_POLICY_SCHEMA,
    version: "1.0.0",
    generatedAt: STAMP,
    period: "2026-07-01 to 2026-07-31",
    statement: "This is a proposal, not a configuration.",
    basis: "Modelled potential, not realized savings",
    tieBreak: "Ranked by expected monthly return, highest first.",
    ruleCount: 3,
    totalExpectedMonthlyReturnUsd: 21400,
    rules: [
      {
        rank: 1,
        sourceModel: "frontier-chat-4",
        sourceTier: "premium",
        targetTier: "standard",
        expectedMonthlyReturnUsd: 12000,
        observedChangeUsd: null,
        guardrails: guardrails("Platform Engineering", "premium", "proposed"),
        evidence: evidence("Platform Engineering paid 40000.00 USD for frontier-chat-4.", 1),
      },
      {
        rank: 2,
        sourceModel: "Data Science",
        sourceTier: "premium",
        targetTier: "standard",
        expectedMonthlyReturnUsd: 7400,
        observedChangeUsd: -1200,
        guardrails: guardrails("Data Science", "premium", "scored"),
        evidence: evidence("recoverable: 26000.00 - 18600.00 = 7400.00", 2),
      },
      {
        rank: 3,
        sourceModel: "compact-embed-2",
        sourceTier: "",
        targetTier: "economy",
        expectedMonthlyReturnUsd: 2000,
        observedChangeUsd: null,
        guardrails: guardrails("Support Tooling", "", "proposed"),
        evidence: evidence("Support Tooling paid 6000.00 USD for compact-embed-2.", 3),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 1. The mapping is exact, on both shapes.
// ---------------------------------------------------------------------------

test("the ordered rule list is exactly this, field for field", () => {
  const translation = translateRoutingPolicy(policyFixture(), GATEWAY_SHAPES.RULE_LIST);

  assert.strictEqual(translation.mappingVersion, GATEWAY_MAPPING_VERSION);
  assert.strictEqual(translation.policySchema, ROUTING_POLICY_SCHEMA);
  assert.strictEqual(translation.policyVersion, "1.0.0");
  assert.strictEqual(translation.state, TRANSLATION_STATES.TRANSLATED);
  assert.strictEqual(translation.ruleCount, 3);
  assert.strictEqual(translation.translatedCount, 3);
  assert.deepStrictEqual(translation.untranslatable, [],
    "the rule list can match on an org unit alone, so nothing here is unexpressible");
  assert.deepStrictEqual(translation.fieldsNotCarried, FIELDS_NOT_CARRIED);

  assert.deepStrictEqual(translation.translated, {
    shape: "rule-list",
    evaluation: "first match wins, in this order",
    rules: [
      {
        match: { orgUnit: "Platform Engineering", model: "frontier-chat-4", tier: "premium" },
        target: { tier: "standard" },
      },
      {
        // The per-org-unit form names no model, so the match names none either.
        match: { orgUnit: "Data Science", model: null, tier: "premium" },
        target: { tier: "standard" },
      },
      {
        match: { orgUnit: "Support Tooling", model: "compact-embed-2", tier: null },
        target: { tier: "economy" },
      },
    ],
    default: null,
    unmatchedTraffic: NO_CATCH_ALL,
  });
});

test("the weighted pools are exactly this, field for field", () => {
  const translation = translateRoutingPolicy(policyFixture(), GATEWAY_SHAPES.WEIGHTED_POOL);

  assert.strictEqual(translation.state, TRANSLATION_STATES.TRANSLATED);
  assert.strictEqual(translation.ruleCount, 3);
  assert.strictEqual(translation.translatedCount, 2);
  assert.deepStrictEqual(translation.translated, {
    shape: "weighted-pool",
    weightUnit: "percent of the pool",
    pools: [
      {
        name: "platform-engineering--frontier-chat-4",
        appliesTo: { orgUnit: "Platform Engineering", model: "frontier-chat-4" },
        default: "premium",
        upstreams: [{ name: "standard", weight: 100 }, { name: "premium", weight: 0 }],
      },
      {
        name: "data-science--premium",
        appliesTo: { orgUnit: "Data Science", model: null },
        default: "premium",
        upstreams: [{ name: "standard", weight: 100 }, { name: "premium", weight: 0 }],
      },
    ],
    defaultsFrom: DEFAULT_FROM_CURRENT_TIER,
  });
  assert.match(DEFAULT_FROM_CURRENT_TIER, /no fallback route/,
    "a pool cannot omit a default, so the shape has to say where the one it used came from");
});

test("no dollar figure, confidence, evidence or lifecycle reaches either shape", () => {
  for (const shape of Object.values(GATEWAY_SHAPES)) {
    const snippet = gatewayShapeSnippet(translateRoutingPolicy(policyFixture(), shape));
    for (const leaked of ["12000", "7400", "-1200", "medium", "proposed", "scored", "recoverable"]) {
      assert.strictEqual(snippet.includes(leaked), false,
        `${shape} carries "${leaked}", which a router has no field for`);
    }
  }
});

test("nothing time-dependent reaches the output, so two translations are one string", () => {
  const first = gatewayShapeSnippet(translateRoutingPolicy(policyFixture(), PREVIEW_SHAPE));
  const second = gatewayShapeSnippet(translateRoutingPolicy(policyFixture(), PREVIEW_SHAPE));
  assert.strictEqual(first, second);
  assert.strictEqual(first.includes(STAMP), false, "the policy's instant must not be in a shape");
  assert.strictEqual(first.includes("2026"), false);
});

test("the module reads no clock, no network and no storage", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../src/gateway-shape-translation.js", import.meta.url), "utf8");
  for (const forbidden of ["Date.now", "new Date", "Math.random", "fetch(", "localStorage",
    "document.createElement", "document.getElement", "document.query", "XMLHttpRequest"]) {
    assert.strictEqual(source.includes(forbidden), false,
      `${forbidden} in a mapping that promises identical output for one policy is a defect`);
  }
});

test("the shapes read the real committed policy, so a schema rename fails here", () => {
  // The bundled example, through the real generator: this is the exact document
  // the download control writes, not a paraphrase of it.
  const policy = routingPolicyDocument(routingSlate(loadExampleDataset()), STAMP);
  const list = translateRoutingPolicy(policy, GATEWAY_SHAPES.RULE_LIST);
  assert.strictEqual(list.state, TRANSLATION_STATES.TRANSLATED);
  assert.ok(policy.rules.length >= 2, "the bundled example must earn rules to translate");
  assert.strictEqual(list.translatedCount, policy.rules.length,
    "every rule the real policy carries must reach the rule list");
  for (const [index, entry] of list.translated.rules.entries()) {
    const rule = policy.rules[index];
    assert.strictEqual(entry.match.orgUnit, rule.guardrails.appliesToOrgUnit);
    assert.strictEqual(entry.match.tier, rule.guardrails.appliesToSourceTier || null);
    assert.strictEqual(entry.target.tier, rule.targetTier);
  }

  // The point of the assertion above: move the field the mapping reads, and the
  // rule is refused rather than quietly translated into an unaddressed match.
  const renamed = {
    ...policy,
    rules: policy.rules.map(({ guardrails, ...rule }) => ({
      ...rule,
      guardrails: { ...guardrails, appliesToOrgUnit: undefined, orgUnit: guardrails.appliesToOrgUnit },
    })),
  };
  const after = translateRoutingPolicy(renamed, GATEWAY_SHAPES.RULE_LIST);
  assert.strictEqual(after.translatedCount, 0);
  assert.strictEqual(after.untranslatable.length, policy.rules.length);
  assert.strictEqual(after.untranslatable[0].field, "no_org_unit");
});

// ---------------------------------------------------------------------------
// 2 and 3. Refusals, and rules that do not make it.
// ---------------------------------------------------------------------------

test("a policy version this mapping does not know translates nothing and says which", () => {
  const policy = { ...policyFixture(), version: "2.0.0" };
  for (const shape of Object.values(GATEWAY_SHAPES)) {
    const translation = translateRoutingPolicy(policy, shape);
    assert.strictEqual(translation.state, TRANSLATION_STATES.UNSUPPORTED_VERSION);
    assert.strictEqual(translation.translated, null);
    assert.deepStrictEqual(translation.untranslatable, [],
      "a version it cannot read is not a list of rules it rejected one by one");
    assert.ok(translation.reason.includes("2.0.0"), translation.reason);
    assert.ok(translation.reason.includes(ACCEPTED_POLICY_VERSIONS[0]), translation.reason);
    assert.strictEqual(gatewayShapeSnippet(translation), "");
  }
});

test("an empty policy is an honest empty state, not an empty config", () => {
  const translation = translateRoutingPolicy(
    { ...policyFixture(), ruleCount: 0, rules: [] }, PREVIEW_SHAPE);
  assert.strictEqual(translation.state, TRANSLATION_STATES.EMPTY);
  assert.strictEqual(translation.translated, null);
  assert.strictEqual(translation.translatedCount, 0);
  assert.ok(translation.reason.includes("no rules"), translation.reason);
});

test("input that is not a policy is refused rather than half-read", () => {
  for (const bad of [null, "a string", 42, {}, { version: "1.0.0", rules: "not an array" }]) {
    const translation = translateRoutingPolicy(bad, PREVIEW_SHAPE);
    assert.strictEqual(translation.state, TRANSLATION_STATES.UNREADABLE);
    assert.strictEqual(translation.translated, null);
  }
  const shape = translateRoutingPolicy(policyFixture(), "some-other-shape");
  assert.strictEqual(shape.state, TRANSLATION_STATES.UNSUPPORTED_SHAPE);
  assert.strictEqual(shape.translated, null);
});

test("a rule a shape cannot express is listed with its reason, not dropped or mangled", () => {
  const translation = translateRoutingPolicy(policyFixture(), GATEWAY_SHAPES.WEIGHTED_POOL);
  assert.deepStrictEqual(translation.untranslatable, [{
    rank: 3,
    source: "compact-embed-2",
    field: "no_source_tier",
    reason: UNTRANSLATABLE_REASONS.no_source_tier,
  }]);

  // Not dropped: it is named. Not mangled: no pool was built for it, and no pool
  // carries an empty upstream that would silently route to nowhere.
  const snippet = gatewayShapeSnippet(translation);
  assert.strictEqual(snippet.includes("compact-embed-2"), false);
  assert.strictEqual(snippet.includes("support-tooling"), false);
  for (const pool of translation.translated.pools) {
    for (const upstream of pool.upstreams) assert.ok(upstream.name, "an unnamed upstream is a hole");
  }

  const summary = untranslatableSummary(translation);
  assert.ok(summary.startsWith("1 of 3 rules"), summary);
  assert.ok(summary.includes(UNTRANSLATABLE_REASONS.no_source_tier), summary);
  assert.ok(summary.includes("still in the downloaded policy"), summary);
  assert.strictEqual(untranslatableSummary(
    translateRoutingPolicy(policyFixture(), GATEWAY_SHAPES.RULE_LIST)), "");
});

// ---------------------------------------------------------------------------
// 4. The disclosure on the page.
// ---------------------------------------------------------------------------

/** Every element under a node, without a descendant selector the harness rejects. */
function descendants(node) {
  const found = [];
  const walk = (current) => {
    for (const child of current.children ?? []) {
      if (child.nodeType !== 1) continue;
      found.push(child);
      walk(child);
    }
  };
  walk(node);
  return found;
}

test("the preview host is authored inside the routing section and ships empty", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  const host = document.getElementById(GATEWAY_SHAPE_PREVIEW_ID);
  assert.ok(host, "the host must be authored in evolution.html");
  assert.strictEqual(descendants(host).length, 0,
    "no rule, figure or period may ship in the document; it is all translated at runtime");

  const ids = [];
  for (let up = host.parentNode; up; up = up.parentNode) if (up.id) ids.push(up.id);
  assert.ok(ids.includes("routing-slate"), `saw ${ids.join(", ")}`);
  assert.strictEqual(ids.includes("routing-slate-body"), false,
    "inside the painted body it would be replaced on the next paint");
});

test("painting a slate works one snippet from the reader's own policy, collapsed", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  const slate = applyRoutingSlate(document, loadExampleDataset());
  const host = document.getElementById(GATEWAY_SHAPE_PREVIEW_ID);

  assert.strictEqual(host.querySelectorAll("details").length, 1);
  const detail = host.querySelectorAll("details")[0];
  assert.strictEqual(detail.hasAttribute("open"), false, "it must be collapsed by default");
  assert.strictEqual(detail.dataset.state, TRANSLATION_STATES.TRANSLATED);
  assert.strictEqual(detail.dataset.shape, PREVIEW_SHAPE);
  assert.strictEqual(host.querySelectorAll("summary").length, 1);
  assert.strictEqual(host.querySelectorAll("summary")[0].getAttribute("aria-expanded"), "false");

  assert.strictEqual(host.querySelectorAll("pre").length, 1);
  // `textOf` collapses runs of whitespace, so the indentation is compared away
  // here; what this holds is that every character of meaning is the reader's.
  const collapse = (text) => text.replace(/\s+/g, " ").trim();
  const snippet = textOf(host.querySelectorAll("pre")[0]);
  const expected = gatewayShapeSnippet(
    translateRoutingPolicy(routingPolicyDocument(slate, STAMP), PREVIEW_SHAPE));
  assert.strictEqual(snippet, collapse(expected),
    "the snippet must be this reader's policy translated, not an authored example");
  assert.ok(snippet.includes(slate.lead.unit), "rank 1's org unit must be in the worked snippet");
  assert.ok(snippet.includes(slate.lead.targetTier));
  assert.strictEqual(snippet.includes(STAMP), false);

  // The shape has to be named where the snippet is, or it is a wall of JSON.
  assert.ok(textOf(host).includes("first match wins"), textOf(host));
});

test("there is nowhere in the preview to paste a secret", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  applyRoutingSlate(document, loadExampleDataset());
  const host = document.getElementById(GATEWAY_SHAPE_PREVIEW_ID);

  assert.strictEqual(host.querySelectorAll("input,select,textarea,button,form,a").length, 0,
    "a credential field, an endpoint box or a connect link has no place in a local translation");
  const focusable = descendants(host).filter((node) => node.tagName === "SUMMARY");
  assert.strictEqual(focusable.length, 1, "the disclosure's own summary is the only focusable");
  assert.doesNotMatch(textOf(host), /api key|credential|token|connect your/i, textOf(host));
});

test("a page with no analysis says so instead of showing an empty code block", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  const slate = applyRoutingSlate(document, null);
  const host = document.getElementById(GATEWAY_SHAPE_PREVIEW_ID);

  assert.strictEqual(host.querySelectorAll("details").length, 1);
  assert.strictEqual(host.querySelectorAll("pre").length, 0,
    "an empty code block reads as a gateway with nothing to change");
  assert.strictEqual(host.querySelectorAll("details")[0].dataset.state, "unavailable");
  assert.ok(textOf(host).includes(slate.reason), textOf(host));
});

test("the preview is repainted when the rules go away, not left on the last policy", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  applyRoutingSlate(document, loadExampleDataset());
  applyRoutingSlate(document, { rankedDepartments: "not an array" });
  const host = document.getElementById(GATEWAY_SHAPE_PREVIEW_ID);
  assert.strictEqual(host.querySelectorAll("pre").length, 0,
    "a snippet from a slate that is no longer on screen is a config for the wrong month");
  assert.strictEqual(host.querySelectorAll("details").length, 1);
});
