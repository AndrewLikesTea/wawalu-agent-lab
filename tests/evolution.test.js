import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHtml, textOf } from "./support/browser.js";
import {
  QUERY_CATEGORIES, categorySpendUsd, explainLiteracyScore, formatUsd, letterGrade, literacyScore,
  normalizeMix, quartileLabel, rankDepartments, recommendationFor,
  recoverableSpendUsd, redactForScoring, summarize, valuePerThousandUsd,
} from "../src/evolution.js";
import {
  firstScreenEdits, loadBundledSeed, seedDocument,
} from "../scripts/seed-first-screen.mjs";
import { recoverableAnswer } from "../src/finops-stand.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/** The answer region's figures are derived at build time (#1184), so the
 *  region is read as the build serves it rather than as the source authors it. */
const served = async () =>
  parseHtml(seedDocument(await read("src/evolution.html"),
    firstScreenEdits(await loadBundledSeed())));

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
  // The content region, not the whole document: the header and nav sit outside
  // it so the skip link has somewhere worth skipping to. tests/page-skip-link.js
  // owns the rest of that contract.
  assert.match(page, /<main id="main-content" tabindex="-1">/);
  // The one AI FinOps door lands on the answer region rather than on the top of
  // this page (#1187). src/site-nav.js owns that href and tests/site-nav.test.js
  // owns the contract; this line is here so the tab this test walks is the one a
  // reader actually arrives through.
  assert.match(page, /aria-current="page" href="\/evolution\.html#finops-recoverable-answer"/);
  // Intervention priority is metric-defined, so there is no "Rank by" control
  // to assert. This used to match a label that only existed inside a developer
  // comment; the ordered list the page actually ships is the real coverage.
  assert.match(page, /<ol class="department-priority" id="department-priority"/);
  assert.doesNotMatch(page, /id="department-sort"/);

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
  const [page, script, strings, styles] = await Promise.all([
    read("src/evolution.html"), read("src/evolution-page.js"),
    read("src/briefing-strings.js"), read("src/evolution.css"),
  ]);
  assert.match(page, /id="finops-load-state" role="status" aria-live="polite"/);
  assert.match(page, /<button id="finops-data-retry" type="button" hidden>/);
  assert.match(strings, /The last successful synthetic analysis remains visible/);
  // What every panel says after that failure is authored in briefing-strings.js,
  // and it names the retry control by the label the button above actually ships.
  assert.match(strings, /No score is inferred from a sample that did not load/);
  assert.match(strings, /Retry bundled analysis/);
  assert.match(styles, /\.finops-load-state button:focus-visible/);
  assert.match(styles, /\.sample-badge[^}]*background:transparent/);
});

test("the AI FinOps proof point is supporting, explicit, and linked to its evidence", async () => {
  const [page, script, styles] = await Promise.all([
    read("src/evolution.html"), read("src/evolution-page.js"), read("src/evolution.css"),
  ]);
  const proofPoint = page.slice(page.indexOf('<article class="proof-point"'),
    page.indexOf('<section class="finops-headline"'));

  assert.match(proofPoint, /aria-labelledby="proof-point-title"/);
  assert.match(proofPoint, /Monthly baseline[\s\S]*\$7,430/);
  assert.match(proofPoint, /Projected savings[\s\S]*\$5,200 \/ month/);
  assert.match(proofPoint, /Accountable role[\s\S]*Core Services platform director/);
  assert.match(proofPoint, /Confidence[\s\S]*High · 760-query scored sample/);
  // The boundary is stated once, above the figures, rather than repeated under
  // them: the wording moved, the requirement that it be here did not.
  assert.match(proofPoint, /Illustrative figures · invented sample/);
  assert.match(proofPoint, /invented example data/i);
  assert.match(proofPoint, /not your spend or realized savings/i);
  assert.match(proofPoint, /href="#recommendation-evidence"/);
  assert.match(page, /id="recommendation-evidence"[\s\S]*aria-labelledby="evaluation-title"/);

  // The useful example is authored in HTML rather than painted, and therefore
  // cannot be erased by either async failure path.
  assert.doesNotMatch(script, /proof-point/);
  // It is illustrative demonstration data, so it is no longer allowed to sit in
  // the reader's first step. The import panel — the one thing this page asks a
  // visitor to do — comes first, and the invented recommendation reads after it
  // as the supporting example it always was.
  assert.ok(page.indexOf('<section class="local-import') < page.indexOf('<article class="proof-point"'),
    "the illustrative proof point must follow the import panel, not precede it");
  assert.ok(page.indexOf('<article class="proof-point"') < page.indexOf('<section class="finops-headline"'),
    "the proof point stays above the supporting executive panels it introduces");
  assert.match(styles, /@media\(max-width:640px\)[\s\S]*\.proof-point-facts\s*\{\s*grid-template-columns:1fr/);
});

// ---------------------------------------------------------------------------
// #1183 — ONE ANSWER AT THE TOP.
//
// A CTO opening this page must be able to stop after one region and still know
// three things: how much annual spend is recoverable, which move to make first,
// and how far to trust the figure. What is asserted here is that ordering and
// that count — the region comes before every section that supports it, and it
// states each of the three exactly once. Nothing here asserts a node is null:
// comparing against a harness element walks the whole parsed page.
// ---------------------------------------------------------------------------

const ANSWER_REGION_ID = "finops-recoverable-answer";

/** Every heading inside a region, without a descendant selector. */
const headingsWithin = (document, region) => [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
  .filter((heading) => {
    for (let node = heading; node; node = node.parentNode) if (node === region) return true;
    return false;
  });

test("the recoverable answer is the first content region a reader meets", async () => {
  const document = parseHtml(await read("src/evolution.html"));
  const regions = [...document.getElementById("main-content").children]
    .filter((node) => node?.nodeType === 1).map((node) => node.id);

  // The hero carries the page h1 and no figure; the answer is what follows it,
  // ahead of the headline region and every section that supports the answer.
  assert.equal(regions[0], "finops-hero", "the page name must come first");
  assert.equal(regions[1], ANSWER_REGION_ID,
    "the answer must precede every section that supports it");
  assert.ok(regions.indexOf(ANSWER_REGION_ID) < regions.indexOf("finops-stand"));
  assert.ok(regions.indexOf(ANSWER_REGION_ID) < regions.indexOf("finops-first-run"));
});

test("the answer region asks one question, states one figure, and names one move", async () => {
  const document = await served();
  const answer = recoverableAnswer();
  const region = document.getElementById(ANSWER_REGION_ID);

  // ONE QUESTION, at the level directly below the page h1.
  const headings = headingsWithin(document, region);
  assert.equal(headings.length, 1, "a second heading here is a second question");
  assert.equal(headings[0].tagName, "H2");
  assert.equal(headings[0].id, "finops-recoverable-question");
  assert.ok(textOf(headings[0]).endsWith("?"));

  // ONE MONEY METRIC, labelled, and a currency figure rather than a share.
  const label = document.getElementById("finops-recoverable-label");
  const value = document.getElementById("finops-recoverable-value");
  assert.match(textOf(label), /Recoverable annual AI spend/);
  assert.match(textOf(value), /^\$[\d,]+$/, "the figure is whole dollars, rounded for display");
  assert.equal(textOf(value), answer.recoverable.text,
    "the figure is the derivation's, not one authored beside it");

  // ONE CONFIDENCE SENTENCE — what the estimate rests on and its one limit.
  const confidence = textOf(document.getElementById("finops-recoverable-confidence"));
  assert.match(confidence, /list price/i);
  assert.match(confidence, /committed-use/i);
  assert.match(confidence, /ceiling/i);

  // ONE NEXT ACTION, and it is a link to where the move is carried out.
  const links = [...region.querySelectorAll("a")];
  assert.deepEqual(links.map((link) => link.id), ["finops-recoverable-action"],
    "a second link here hands the ranking decision back to the reader");
  assert.equal(links[0].getAttribute("href"), answer.action.href);
  assert.ok(textOf(links[0]).includes(answer.destination.label),
    "the action names the move to make, not the destination page");
});

test("no figure in the answer region is authored into the markup", async () => {
  // #1184: the figure, the move and the arithmetic under the disclosure are one
  // derivation over the bundled analysis, rendered by the build. The source may
  // therefore carry none of them — a literal here is a copy that stops moving
  // when the dataset does. tests/finops-recoverable-answer.test.js owns the
  // agreement between each rendered figure and what the derivation returns.
  const page = await read("src/evolution.html");
  const answer = recoverableAnswer();
  const region = page.slice(page.indexOf(`id="${ANSWER_REGION_ID}"`));
  const markup = region.slice(0, region.indexOf("</section>"));
  assert.deepEqual(markup.match(/\$[\d,]+/g) ?? [], [],
    "a dollar figure is authored into the answer region again");
  assert.equal(textOf((await served()).getElementById("finops-recoverable-value")),
    answer.recoverable.text);
});

test("the action center points at the answer instead of restating it", async () => {
  const document = parseHtml(await read("src/savings-action-center.html"));
  const link = document.getElementById("finops-journey-owner-link");
  assert.equal(link.getAttribute("href"), `/evolution.html#${ANSWER_REGION_ID}`);
  assert.match(textOf(document.getElementById("finops-journey-owner")),
    /stated once/, "the action center defers rather than issuing a second telling");
});

test("every page in the site carries the AI FinOps tab", async () => {
  for (const page of ["index.html", "social.html", "releases.html", "decision.html", "release.html", "agents.html"])
    assert.match(await read(`src/${page}`), /href="\/evolution\.html"/, `${page} must link the AI FinOps tab`);
});
