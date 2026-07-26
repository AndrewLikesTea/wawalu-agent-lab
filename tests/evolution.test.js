import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  QUERY_CATEGORIES, categorySpendUsd, explainLiteracyScore, formatUsd, letterGrade, literacyScore,
  normalizeMix, quartileLabel, rankDepartments, recommendationFor,
  recoverableSpendUsd, redactForScoring, summarize, valuePerThousandUsd,
} from "../src/evolution.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const team = (overrides = {}) => ({
  id: "team", name: "Backend Platform", headcount: 10, spendUsd: 10_000, queries: 20_000,
  mix: { highValue: 0.5, overProvisioned: 0.2, inefficient: 0.2, outOfScope: 0.1 },
  ...overrides,
});

test("a mix normalizes to four shares that sum to one", () => {
  // Raw judge counts, a missing category, and a mix that drifts off 1 must all
  // land on the same denominator or spend and score disagree with each other.
  const fromCounts = normalizeMix({ highValue: 60, overProvisioned: 20, inefficient: 15, outOfScope: 5 });
  assert.deepEqual(fromCounts, { highValue: 0.6, overProvisioned: 0.2, inefficient: 0.15, outOfScope: 0.05 });

  const partial = normalizeMix({ highValue: 3, outOfScope: 1 });
  assert.equal(partial.highValue, 0.75);
  assert.equal(partial.inefficient, 0);

  const total = Object.values(normalizeMix({ highValue: 0.4, overProvisioned: 0.31, inefficient: 0.2, outOfScope: 0.11 }))
    .reduce((sum, share) => sum + share, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);

  // Empty and malformed input degrade to zeros rather than NaN reaching the DOM.
  assert.deepEqual(normalizeMix(), { highValue: 0, overProvisioned: 0, inefficient: 0, outOfScope: 0 });
  assert.deepEqual(normalizeMix({ highValue: -5, outOfScope: "x" }),
    { highValue: 0, overProvisioned: 0, inefficient: 0, outOfScope: 0 });
});

test("the literacy score ranks the four query classes and grades them", () => {
  assert.equal(literacyScore({ highValue: 1 }), 100);
  assert.equal(literacyScore({ outOfScope: 1 }), 0);
  assert.equal(literacyScore({ overProvisioned: 1 }), 55);
  assert.equal(literacyScore({ inefficient: 1 }), 35);
  // An over-provisioned prompt is legitimate work on the wrong model, so it must
  // always score above a re-prompt spiral, which must score above pure leakage.
  assert.ok(literacyScore({ overProvisioned: 1 }) > literacyScore({ inefficient: 1 }));
  assert.ok(literacyScore({ inefficient: 1 }) > literacyScore({ outOfScope: 1 }));
  assert.equal(literacyScore({ highValue: 0.5, overProvisioned: 0.2, inefficient: 0.2, outOfScope: 0.1 }), 68);

  assert.equal(letterGrade(100), "A");
  assert.equal(letterGrade(90), "A");
  assert.equal(letterGrade(89), "B");
  assert.equal(letterGrade(70), "C");
  assert.equal(letterGrade(60), "D");
  assert.equal(letterGrade(59), "F");
  assert.equal(letterGrade("not a score"), "F");
  assert.deepEqual(explainLiteracyScore({ highValue: 1 }).terms[0],
    { key: "highValue", share: 1, weight: 100, contribution: 100 });
  assert.match(explainLiteracyScore({ highValue: 1 }).arithmetic, /= 100\.0/);
});

test("recoverable spend is conservative and category-attributed", () => {
  const department = team();
  // 20% over-provisioned × 0.7 + 20% inefficient × 0.4 + 10% leakage × 1.0.
  assert.equal(recoverableSpendUsd(department), 3_200);
  assert.ok(recoverableSpendUsd(department) < department.spendUsd);
  assert.equal(categorySpendUsd(department, "outOfScope"), 1_000);
  assert.equal(categorySpendUsd(department, "highValue"), 5_000);
  // A team with no waste has nothing to reclaim, and a zero-spend team cannot divide by zero.
  assert.equal(recoverableSpendUsd(team({ mix: { highValue: 1 } })), 0);
  assert.equal(recoverableSpendUsd(team({ spendUsd: 0 })), 0);
  assert.equal(valuePerThousandUsd(team({ spendUsd: 0 })), 0);
  assert.equal(valuePerThousandUsd(department), 1_000);
});

test("organization totals are spend-weighted, not team-weighted", () => {
  // A tiny perfect team must not lift the headline while the large budget wastes.
  const large = team({ id: "large", spendUsd: 90_000, queries: 90_000, mix: { highValue: 0.4, overProvisioned: 0.3, inefficient: 0.2, outOfScope: 0.1 } });
  const small = team({ id: "small", spendUsd: 10_000, queries: 10_000, mix: { highValue: 1 } });
  const totals = summarize([large, small]);
  assert.equal(totals.spendUsd, 100_000);
  assert.equal(totals.departments, 2);
  // The large team scores 64 and the small one 100. A plain average across teams
  // would report 82 — a B — and hide the budget that is actually leaking.
  assert.equal(literacyScore(large.mix), 64);
  assert.equal(Math.round((literacyScore(large.mix) + literacyScore(small.mix)) / 2), 82);
  assert.equal(totals.score, 68);
  assert.equal(totals.grade, "D");
  // The mix is spend-shares of the whole organization, so the bar and the table agree.
  assert.ok(Math.abs(totals.mix.highValue - 0.46) < 0.005);
  assert.equal(totals.recoverableUsd, 35_100);
  assert.ok(Math.abs(totals.recoverableShare - 0.351) < 0.001);
  assert.deepEqual(summarize(), {
    spendUsd: 0, recoverableUsd: 0, queries: 0, headcount: 0, score: 0, grade: "F",
    mix: { highValue: 0, overProvisioned: 0, inefficient: 0, outOfScope: 0 },
    scoreExplanation: {
      version: "literacy-mix/1.0.0",
      rule: "Organization score = sum(department score × department spend) ÷ total spend; nearest integer.",
      arithmetic: "No spend: score = 0.",
    },
    recoverableShare: 0, departments: 0,
  });
  assert.equal(totals.scoreExplanation.version, "literacy-mix/1.0.0");
  assert.match(totals.scoreExplanation.arithmetic, /64×90000 \+ 100×10000 ÷ 100000 = 67\.60; rounded = 68/);
});

test("ranking puts the team that needs attention first for each metric", () => {
  const departments = [
    team({ id: "a", name: "A", spendUsd: 10_000, mix: { highValue: 0.9, overProvisioned: 0.1 } }),
    team({ id: "b", name: "B", spendUsd: 50_000, mix: { highValue: 0.4, overProvisioned: 0.3, inefficient: 0.2, outOfScope: 0.1 } }),
  ];
  assert.equal(rankDepartments(departments, "recoverableUsd")[0].id, "b");
  assert.equal(rankDepartments(departments, "spendUsd")[0].id, "b");
  // Lowest literacy first: ranking by score surfaces the weakest team, not the strongest.
  assert.equal(rankDepartments(departments, "score")[0].id, "b");
  assert.equal(rankDepartments(departments, "unknown-metric")[0].id, "b");
  // Ranking never mutates the caller's array.
  assert.equal(departments[0].id, "a");
});

test("every graded team gets one action aimed at its largest recoverable line", () => {
  const overProvisioned = recommendationFor(team({ mix: { highValue: 0.4, overProvisioned: 0.5, inefficient: 0.1 } }));
  assert.equal(overProvisioned.key, "overProvisioned");
  assert.match(overProvisioned.action, /down-routing/i);

  const inefficient = recommendationFor(team({ name: "QA & Release", mix: { highValue: 0.4, overProvisioned: 0.1, inefficient: 0.5 } }));
  assert.equal(inefficient.key, "inefficient");
  assert.match(inefficient.action, /workshop for QA & Release/);

  // Leakage is fully recoverable, so it must stay in the ranking — but the fix is
  // policy, never coaching. A workshop cannot stop someone asking about their deck.
  const leaking = recommendationFor(team({ mix: { highValue: 0.5, outOfScope: 0.5 } }));
  assert.equal(leaking.key, "outOfScope");
  assert.equal(leaking.lostUsd, 5_000);
  assert.match(leaking.action, /acceptable-use/i);
  assert.doesNotMatch(leaking.action, /workshop|training/i);
  assert.equal(recommendationFor(team({ mix: { highValue: 1 } })).key, "healthy");
  assert.equal(recommendationFor(team({ mix: { highValue: 1 } })).lostUsd, 0);
});

test("redaction removes identity and secrets while preserving prompt structure", () => {
  const raw = "Escalation from ana.reyes@northwind.example about card 4111 1111 1111 1111 at "
    + "https://internal.example/orders/8842 with key sk-demo-000000000000, probe Bearer demo-token-not-real-000, "
    + "node 10.42.7.19, ref 123-45-6789. Write a root-cause summary with a timeline and the rollback to recommend.";
  const scored = redactForScoring(raw);

  for (const secret of ["ana.reyes@northwind.example", "4111 1111 1111 1111", "sk-demo-000000000000",
    "demo-token-not-real-000", "10.42.7.19", "123-45-6789", "internal.example"])
    assert.ok(!scored.includes(secret), `${secret} must not survive redaction`);
  for (const placeholder of ["[email]", "[card]", "[url]", "[secret]", "[ip]", "[id]"])
    assert.ok(scored.includes(placeholder), `${placeholder} must mark what was removed`);
  // A placeholder must not swallow the separator after it, or redaction itself
  // damages the sentence structure the judge is meant to grade.
  assert.match(scored, /\[card\] at \[url\]/);
  // The quality signal a judge scores on — the instruction and its acceptance
  // criteria — has to survive, or the score measures redaction instead of skill.
  assert.match(scored, /Write a root-cause summary with a timeline and the rollback to recommend\./);
  assert.equal(redactForScoring(), "");
});

test("quartile labels and currency formatting read as an executive expects", () => {
  assert.equal(quartileLabel(91), "Top quartile");
  assert.equal(quartileLabel(75), "Top quartile");
  assert.equal(quartileLabel(50), "Second quartile");
  assert.equal(quartileLabel(30), "Third quartile");
  assert.equal(quartileLabel(9), "Bottom quartile");
  assert.equal(quartileLabel(undefined), "Unranked");
  assert.equal(formatUsd(41_280), "$41,280");
  assert.equal(formatUsd("not money"), "$0");
});

test("the AI FinOps tab ships from every page and keeps the demo boundary", async () => {
  const [home, page, script, pageScript, styles, demo] = await Promise.all([
    read("src/index.html"), read("src/evolution.html"), read("src/evolution.js"),
    read("src/evolution-page.js"), read("src/evolution.css"), read("src/evolution-demo-data.json"),
  ]);
  assert.match(home, /href="\/evolution\.html"/);
  assert.match(page, /<title>AI FinOps · Shiplog<\/title>/);
  assert.match(page, /<main>/);
  assert.match(page, /aria-current="page" href="\/evolution\.html"/);
  assert.match(page, /<label for="department-sort">Rank by<\/label>/);

  // No user-generated HTML execution, and no live enterprise system is contacted
  // from the browser: the tab renders a static, hand-authored sample only.
  assert.doesNotMatch(`${script}\n${pageScript}\n${page}`, /innerHTML|outerHTML|document\.write/);
  assert.doesNotMatch(pageScript, /api\.(openai|anthropic)\.com|workday|amazonaws/i);
  assert.match(pageScript, /"\/evolution-demo-data\.json"/);
  assert.doesNotMatch(demo, /@gmail\.com|@wawalu\.org|ingest\.wawalu/i);

  // Category identity is never carried by color alone: each of the four classes
  // ships a label and its own action text next to the swatch.
  for (const category of QUERY_CATEGORIES) {
    assert.ok(script.includes(category.label), `${category.label} must be labelled`);
    assert.match(styles, new RegExp(`--cat-${category.key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}\\s*:`));
  }
});

test("the AI FinOps page exposes labelled loading and keyboard-native recovery", async () => {
  const [page, script, styles] = await Promise.all([
    read("src/evolution.html"), read("src/evolution-page.js"), read("src/evolution.css"),
  ]);
  assert.match(page, /id="finops-load-state" role="status" aria-live="polite"/);
  assert.match(page, /<button id="finops-data-retry" type="button" hidden>/);
  assert.match(script, /The last successful synthetic analysis remains visible/);
  assert.match(script, /No metric is inferred from a failed load/);
  assert.match(styles, /\.finops-load-state button:focus-visible/);
  assert.match(styles, /\.sample-badge[^}]*background:transparent/);
});

test("every page in the site carries the AI FinOps tab", async () => {
  for (const page of ["index.html", "social.html", "releases.html", "decision.html", "release.html", "agents.html"])
    assert.match(await read(`src/${page}`), /href="\/evolution\.html"/, `${page} must link the AI FinOps tab`);
});
