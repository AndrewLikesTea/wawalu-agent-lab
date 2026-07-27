// One confidence treatment, pinned where it would go wrong quietly.
//
// Four things are locked here, because each has a failure mode a screenshot
// review would pass:
//
//   1. Reading order. Coverage precedes the headline figure in the *document*,
//      not in the paint. A CSS `order` regression is invisible to a sighted
//      reviewer and reverses what a screen reader says.
//   2. Not-color-alone. Every state exposes a word, and the three words differ.
//      This is asserted on rendered markup with the stylesheet absent, which is
//      the monochrome case.
//   3. One upgrade action. The ranked list offers the highest-gain input and
//      nothing that would gain nothing — including at 100% coverage, where the
//      obvious bug is an invitation to "raise coverage to ~100%".
//   4. The announcement fires on a change and stays silent otherwise.
//
// The DOM assertions drive the shipped markup of evolution.html, like the other
// view tests on this page, so a slot renamed in the page and not in the painter
// fails here rather than in a browser.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHtml, textOf } from "./support/browser.js";
import { CONFIDENCE, INPUT_STATES } from "../src/finops-attribution-policy.js";
import {
  CONFIDENCE_TREATMENT, confidenceTreatment, coverageChangeAnnouncement, coverageModel,
  coveragePercentText, coverageSplit, coverageStatement, rankedCoverageUpgrades,
  SURFACE_CATEGORY, SURFACES, topProviderLabel, UPGRADE_IDS, withheldReason,
} from "../src/attribution-confidence.js";
import {
  announce, announceCoverageChange, applyCoverageTreatment, applyCoverageUpgrade,
  confidenceChip,
} from "../src/attribution-confidence-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const page = async () => parseHtml(await readFile(PAGE, "utf8"));

const item = (cost, groupingKey = null, provider = "openai") =>
  ({ cost, groupingKey, provider, service: "chat" });

/** Line items whose attributed share is exactly `share`, over 1000 of spend. */
const itemsWithShare = (share, provider = "openai") => [
  item(1000 * share, "unit-a", provider),
  item(1000 * (1 - share), null, provider),
].filter((row) => row.cost > 0);

const modelFor = (share, inputState = INPUT_STATES.PROVIDER_PLUS_GROUPING, provider = "openai") =>
  coverageModel({ inputState, share, lineItems: itemsWithShare(share, provider) });

// --- the vocabulary --------------------------------------------------------

test("every state carries a word, and the three words differ", () => {
  const labels = Object.values(CONFIDENCE).map((state) => confidenceTreatment(state).label);
  assert.equal(new Set(labels).size, 3, "two states share a word");
  for (const label of labels) assert.ok(label.trim().length > 0);
});

test("every state carries a non-color differentiator besides the word", () => {
  const decorated = [CONFIDENCE.DEGRADED, CONFIDENCE.SUPPRESSED]
    .map((state) => confidenceTreatment(state));
  const shapes = decorated.map((treatment) => treatment.shape);
  const borders = decorated.map((treatment) => treatment.borderStyle);
  assert.equal(new Set(shapes).size, 2, "degraded and suppressed share a shape");
  assert.equal(new Set(borders).size, 2, "degraded and suppressed share a border style");
  for (const shape of shapes) assert.ok(shape.length > 0);
});

test("full confidence is the baseline: a word, and no badge", () => {
  const full = CONFIDENCE_TREATMENT[CONFIDENCE.FULL];
  assert.equal(full.decorated, false);
  assert.equal(full.shape, "");
  assert.equal(full.borderStyle, "none");
  assert.equal(full.label, "full confidence");
});

test("degraded reaches for qualified language, never failure language", () => {
  const degraded = CONFIDENCE_TREATMENT[CONFIDENCE.DEGRADED];
  const words = `${degraded.label} ${degraded.state}`.toLowerCase();
  for (const banned of ["error", "fail", "broken", "invalid", "danger"]) {
    assert.ok(!words.includes(banned), `degraded says "${banned}"`);
  }
  assert.match(degraded.label, /partial/);
});

test("the three decorated surfaces read one policy category each", () => {
  assert.equal(Object.keys(SURFACE_CATEGORY).length, Object.values(SURFACES).length);
  assert.equal(SURFACE_CATEGORY[SURFACES.KPI_ROW], SURFACE_CATEGORY[SURFACES.HEADLINE_FIGURE]);
  assert.notEqual(SURFACE_CATEGORY[SURFACES.SPEND_MIX], SURFACE_CATEGORY[SURFACES.FINDINGS_LIST]);
});

// --- the percentage --------------------------------------------------------

test("only an exact 1 prints 100%", () => {
  assert.equal(coveragePercentText(1), "100%");
  assert.equal(coveragePercentText(0.9996), ">99%");
  assert.equal(coveragePercentText(0.999), ">99%");
  assert.equal(coveragePercentText(0.995), ">99%");
});

test("only an exact 0 prints 0%", () => {
  assert.equal(coveragePercentText(0), "0%");
  assert.equal(coveragePercentText(0.0004), "<1%");
});

test("an undefined share has no percentage and says so", () => {
  assert.equal(coveragePercentText(null), null);
  assert.equal(coveragePercentText(undefined), null);
  assert.equal(coveragePercentText(Number.NaN), null);
  assert.match(coverageStatement({ share: null, confidence: CONFIDENCE.SUPPRESSED }),
    /^Coverage unmeasured · withheld$/);
});

test("the statement puts coverage before the confidence word", () => {
  const statement = coverageStatement({ share: 0.68, confidence: CONFIDENCE.DEGRADED });
  assert.equal(statement, "Covers 68% of spend · partial confidence");
  assert.ok(statement.indexOf("68%") < statement.indexOf("partial confidence"));
});

test("a withheld surface says why it is withheld and what would release it", () => {
  const reason = withheldReason({ inputState: INPUT_STATES.PROVIDER_ONLY, share: 0.2 });
  assert.match(reason, /^Withheld:/);
  assert.match(reason, /20%/);
  assert.match(reason, /50% floor/);
  assert.match(reason, /raise confidence/);
});

// --- the one upgrade action ------------------------------------------------

test("the split reads both gaps out of the policy's own share function", () => {
  const split = coverageSplit([item(600, "unit-a"), item(300, "unit-z"), item(100, null)],
    ["unit-a"]);
  assert.equal(split.total, 1000);
  assert.equal(split.attributed, 600);
  assert.equal(split.blank, 100);
  assert.equal(split.unnamed, 300);
  assert.equal(split.blankRows, 1);
});

test("the provider is read from the file, never hardcoded", () => {
  assert.equal(topProviderLabel([item(10, null, "acme-inference"), item(90, null, "zzz")]),
    "zzz");
  assert.equal(topProviderLabel([]), "provider");
  const upgrade = rankedCoverageUpgrades({
    inputState: INPUT_STATES.PROVIDER_ONLY, share: 0,
    lineItems: [item(100, null, "acme-inference")],
  });
  assert.match(upgrade.top.label, /acme-inference/);
});

test("exactly one coverage-moving action is offered, the highest-gain one", () => {
  const upgrade = rankedCoverageUpgrades({
    inputState: INPUT_STATES.PROVIDER_PLUS_ORG_MAPPING,
    knownGroups: ["unit-a"], share: 0.6,
    lineItems: [item(600, "unit-a"), item(300, "unit-z"), item(100, null)],
  });
  assert.equal(upgrade.top.id, UPGRADE_IDS.ORG_MAPPING, "the larger gap must rank first");
  assert.equal(upgrade.all.filter((entry) => entry.kind === "coverage").length, 2);
  assert.equal(upgrade.rest.length, 1, "everything else sits behind the disclosure");
  assert.equal(upgrade.rest[0].id, UPGRADE_IDS.FILL_GROUPING);
});

test("the action states the coverage it would buy", () => {
  const upgrade = rankedCoverageUpgrades({
    inputState: INPUT_STATES.PROVIDER_PLUS_GROUPING, share: 0.68,
    lineItems: itemsWithShare(0.68),
  });
  assert.equal(upgrade.top.id, UPGRADE_IDS.FILL_GROUPING);
  assert.equal(upgrade.top.projectedPercentText, "100%");
  assert.match(upgrade.top.text, /would raise coverage to ~100%\.$/);
});

test("at full coverage no upgrade is offered at all", () => {
  const upgrade = rankedCoverageUpgrades({
    inputState: INPUT_STATES.PROVIDER_PLUS_ORG_MAPPING, share: 1,
    lineItems: [item(1000, "unit-a")],
  });
  assert.equal(upgrade.top, null);
  assert.equal(upgrade.all.length, 0);
  for (const entry of upgrade.all) assert.ok(!/~100%/.test(entry.text));
});

test("an org mapping over a fully grouped export is offered as precision, not coverage", () => {
  const upgrade = rankedCoverageUpgrades({
    inputState: INPUT_STATES.PROVIDER_PLUS_GROUPING, share: 1,
    lineItems: [item(1000, "unit-a")],
  });
  assert.equal(upgrade.top, null, "nothing here moves coverage");
  assert.equal(upgrade.all.length, 1);
  assert.equal(upgrade.all[0].kind, "precision");
  assert.match(upgrade.all[0].text, /coverage is unchanged/);
});

test("a file with no spend in it promises nothing", () => {
  const upgrade = rankedCoverageUpgrades({
    inputState: INPUT_STATES.PROVIDER_ONLY, share: null, lineItems: [],
  });
  assert.equal(upgrade.top, null);
  assert.equal(upgrade.all.length, 0);
});

// --- the announcement ------------------------------------------------------

test("a coverage rise is announced with both figures and what it upgraded", () => {
  const text = coverageChangeAnnouncement({
    previous: { inputState: INPUT_STATES.PROVIDER_PLUS_GROUPING, share: 0.68 },
    next: { inputState: INPUT_STATES.PROVIDER_PLUS_ORG_MAPPING, share: 0.91 },
  });
  assert.match(text, /^Coverage increased from 68% to 91%\./);
  assert.match(text, /2 findings upgraded to full confidence\.$/);
});

test("an unchanged coverage is not announced", () => {
  const same = { inputState: INPUT_STATES.PROVIDER_PLUS_GROUPING, share: 0.68 };
  assert.equal(coverageChangeAnnouncement({ previous: same, next: { ...same } }), null);
});

test("an initial render has no previous coverage and stays silent", () => {
  assert.equal(coverageChangeAnnouncement({ previous: null, next: { share: 0.68 } }), null);
});

test("a coverage fall is announced without upgrade language", () => {
  const text = coverageChangeAnnouncement({
    previous: { inputState: INPUT_STATES.PROVIDER_PLUS_ORG_MAPPING, share: 0.91 },
    next: { inputState: INPUT_STATES.PROVIDER_PLUS_GROUPING, share: 0.68 },
  });
  assert.match(text, /^Coverage decreased from 91% to 68%\./);
  assert.ok(!/upgraded/.test(text));
  assert.match(text, /no longer read at full confidence\.$/);
});

// --- reading order, on the shipped markup ----------------------------------

/**
 * Position in a depth-first walk of the whole document — not among siblings.
 * The coverage lead and the figure it qualifies are deliberately separate
 * name-value groups, so a sibling comparison would silently pass whatever the
 * order between the two groups turned out to be.
 */
const documentOrder = (doc) => {
  const order = new Map();
  const walk = (node) => {
    if (node.id) order.set(node.id, order.size);
    for (const child of node.children ?? []) if (child.tagName) walk(child);
  };
  walk(doc.documentElement ?? doc.body);
  return order;
};

const indexOfId = (order, id) => {
  assert.ok(order.has(id), `the page has no #${id}`);
  return order.get(id);
};

test("coverage precedes the headline figure in the document, in every slot", async () => {
  const order = documentOrder(await page());
  assert.ok(indexOfId(order, "local-impact-coverage") < indexOfId(order, "local-recoverable"),
    "the recoverable figure is authored before its coverage");
  assert.ok(indexOfId(order, "local-attribution-note") < indexOfId(order, "local-recoverable"),
    "the qualifier is authored after the number it qualifies");
  assert.ok(indexOfId(order, "kpi-recoverable-coverage") < indexOfId(order, "kpi-recoverable-value"),
    "the KPI numeral is authored before its coverage");
  assert.ok(indexOfId(order, "mix-coverage") < indexOfId(order, "mix-bar"),
    "the mix bar is authored before its coverage");
  assert.ok(indexOfId(order, "local-departments-coverage") < indexOfId(order, "local-department-list"),
    "the findings list is authored before its coverage");
  // And the whole coverage block is read before the finding it belongs to is
  // summarised, not merely before the numeral inside it.
  assert.ok(indexOfId(order, "local-trust-coverage") < indexOfId(order, "local-recoverable"),
    "the trust verdict's coverage headline follows the recoverable figure");
});

test("no coverage slot is positioned out of document order by the stylesheet", async () => {
  const css = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
  const rules = css.split("\n").filter((line) => line.includes(".coverage-lead")
    || line.includes(".confidence-chip"));
  assert.ok(rules.length > 0, "the treatment has no stylesheet");
  for (const rule of rules) {
    assert.ok(!/(^|[^-\w])order\s*:/.test(rule), `a coverage rule reorders the paint: ${rule}`);
    assert.ok(!/position\s*:\s*absolute/.test(rule), `a coverage rule lifts out of flow: ${rule}`);
  }
});

// --- the painted result ----------------------------------------------------

test("every painted state exposes a text label, with no stylesheet loaded", async () => {
  const doc = await page();
  const seen = new Set();
  for (const share of [1, 0.68, 0.2]) {
    applyCoverageTreatment(doc, modelFor(share));
    const text = textOf(doc.getElementById("local-impact-coverage"));
    assert.match(text, /confidence|withheld/, `no word for share ${share}`);
    seen.add(text.split("·")[1]?.trim());
  }
  assert.equal(seen.size, 3, "two states painted the same word");
});

test("the same treatment lands identically in all four slots", async () => {
  const doc = await page();
  applyCoverageTreatment(doc, modelFor(0.68));
  for (const id of ["local-impact-coverage", "kpi-recoverable-coverage", "mix-coverage",
    "local-departments-coverage"]) {
    const node = doc.getElementById(id);
    assert.equal(node.hidden, false, `#${id} stayed hidden`);
    assert.match(textOf(node), /Covers 68% of spend/, `#${id} lost the coverage figure`);
  }
  // The mix is read from line items alone, so the policy holds it at full
  // confidence even at 68% attribution. Same slot, same painter, honest word.
  assert.match(textOf(doc.getElementById("mix-coverage")), /full confidence/);
  assert.match(textOf(doc.getElementById("local-impact-coverage")), /partial confidence/);
});

test("full confidence paints the sentence and no chip", async () => {
  const doc = await page();
  applyCoverageTreatment(doc, modelFor(1));
  const node = doc.getElementById("local-impact-coverage");
  assert.equal(node.dataset.confidence, "full");
  assert.equal(node.querySelectorAll(".confidence-chip").length, 0, "the baseline grew a badge");
  assert.match(textOf(node), /Covers 100% of spend · full confidence/);
});

test("degraded and suppressed each carry a chip whose shape is hidden from AT", async () => {
  const doc = await page();
  for (const [share, state] of [[0.68, "degraded"], [0.2, "suppressed"]]) {
    applyCoverageTreatment(doc, modelFor(share));
    const chip = doc.getElementById("local-impact-coverage").querySelector(".confidence-chip");
    assert.ok(chip, `no chip at share ${share}`);
    assert.equal(chip.dataset.confidence, state);
    assert.equal(chip.querySelector(".confidence-chip-shape").getAttribute("aria-hidden"), "true");
    assert.ok(textOf(chip.querySelector(".confidence-chip-label")).length > 0);
  }
});

test("a suppressed findings list is withheld with a reason, not silently absent", async () => {
  const doc = await page();
  applyCoverageTreatment(doc, coverageModel({
    inputState: INPUT_STATES.PROVIDER_ONLY, share: 0, lineItems: [item(1000, null)],
  }));
  const node = doc.getElementById("local-departments-coverage");
  assert.equal(node.hidden, false);
  const text = textOf(node);
  assert.match(text, /withheld/i);
  assert.match(text, /no grouping column/);
  assert.match(text, /raise confidence/);
});

test("a null model clears every slot rather than leaving a stale percentage", async () => {
  const doc = await page();
  applyCoverageTreatment(doc, modelFor(0.68));
  applyCoverageTreatment(doc, null);
  for (const id of ["local-impact-coverage", "kpi-recoverable-coverage", "mix-coverage",
    "local-departments-coverage"]) {
    const node = doc.getElementById(id);
    assert.equal(node.hidden, true, `#${id} kept a stale sentence`);
    assert.equal(textOf(node), "");
  }
  assert.equal(doc.getElementById("coverage-upgrade").hidden, true);
});

test("one upgrade action is shown, and the rest sit behind one disclosure", async () => {
  const doc = await page();
  applyCoverageTreatment(doc, coverageModel({
    inputState: INPUT_STATES.PROVIDER_PLUS_ORG_MAPPING, share: 0.6, knownGroups: ["unit-a"],
    lineItems: [item(600, "unit-a"), item(300, "unit-z"), item(100, null)],
  }));
  const region = doc.getElementById("coverage-upgrade");
  assert.equal(region.hidden, false);
  assert.equal(region.querySelectorAll(".coverage-upgrade-action").length, 1,
    "more than one primary action is rendered");
  assert.match(textOf(doc.getElementById("coverage-upgrade-action")), /org mapping file/);
  const more = doc.getElementById("coverage-upgrade-more");
  assert.equal(more.hidden, false);
  assert.equal(more.tagName, "DETAILS");
  assert.equal(more.getAttribute("open"), null, "the disclosure ships open");
  assert.equal(doc.getElementById("coverage-upgrade-rest").querySelectorAll("li").length, 1);
});

test("at full coverage the upgrade affordance is absent, not empty", async () => {
  const doc = await page();
  applyCoverageTreatment(doc, coverageModel({
    inputState: INPUT_STATES.PROVIDER_PLUS_ORG_MAPPING, share: 1,
    lineItems: [item(1000, "unit-a")],
  }));
  const region = doc.getElementById("coverage-upgrade");
  assert.equal(region.hidden, true);
  assert.equal(region.dataset.state, "none");
});

test("the upgrade control is a real button, keyboard reachable, sized to the bar", async () => {
  const doc = await page();
  applyCoverageUpgrade(doc, rankedCoverageUpgrades({
    inputState: INPUT_STATES.PROVIDER_PLUS_GROUPING, share: 0.68,
    lineItems: itemsWithShare(0.68),
  }));
  const jump = doc.getElementById("coverage-upgrade-jump");
  assert.equal(jump.tagName, "BUTTON");
  assert.equal(jump.getAttribute("type"), "button");
  assert.equal(jump.hidden, false);
  assert.equal(jump.getAttribute("tabindex"), null, "the action was taken out of the tab order");
  assert.match(jump.getAttribute("aria-label"), /moves focus to the file control/);
  const css = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
  assert.match(css, /\.coverage-upgrade-jump \{[^}]*min-height:44px/);
  assert.match(css, /\.coverage-upgrade-more summary \{[^}]*min-height:44px/);
  assert.match(css, /\.coverage-upgrade-jump:focus-visible[^{]*\{[^}]*outline:3px/);
});

test("repainting the upgrade binds its handler once", async () => {
  const doc = await page();
  const upgrade = rankedCoverageUpgrades({
    inputState: INPUT_STATES.PROVIDER_PLUS_GROUPING, share: 0.68,
    lineItems: itemsWithShare(0.68),
  });
  applyCoverageUpgrade(doc, upgrade);
  applyCoverageUpgrade(doc, upgrade);
  assert.equal(doc.getElementById("coverage-upgrade-jump").dataset.bound, "true");
});

// --- the live region -------------------------------------------------------

test("the page ships one polite coverage region, and it starts empty", async () => {
  const doc = await page();
  const live = doc.getElementById("coverage-live");
  assert.equal(live.getAttribute("aria-live"), "polite");
  assert.equal(live.getAttribute("role"), "status");
  assert.equal(textOf(live), "");
});

test("a coverage change is announced, and silence stays silent", async () => {
  const doc = await page();
  announceCoverageChange(doc, coverageChangeAnnouncement({
    previous: { inputState: INPUT_STATES.PROVIDER_PLUS_GROUPING, share: 0.68 },
    next: { inputState: INPUT_STATES.PROVIDER_PLUS_ORG_MAPPING, share: 0.91 },
  }), { moveFocus: false });
  assert.match(textOf(doc.getElementById("coverage-live")),
    /^Coverage increased from 68% to 91%\. 2 findings upgraded to full confidence\.$/);
  announce(doc, null);
  assert.equal(textOf(doc.getElementById("coverage-live")), "");
  announceCoverageChange(doc, null);
  assert.equal(textOf(doc.getElementById("coverage-live")), "");
});

test("the announced state is also readable from the elements themselves", async () => {
  const doc = await page();
  applyCoverageTreatment(doc, modelFor(0.68));
  announce(doc, "");
  // The live region is now empty, as it will be for any reader who arrived after
  // the announcement. The state has to still be findable.
  assert.match(textOf(doc.getElementById("local-impact-coverage")), /Covers 68% of spend/);
  assert.match(textOf(doc.getElementById("kpi-recoverable-coverage")), /partial confidence/);
});

test("announcing moves focus to the result heading when asked, and never otherwise", async () => {
  const doc = await page();
  const heading = doc.getElementById("local-results-title");
  assert.equal(heading.getAttribute("tabindex"), "-1", "the heading is not programmatically focusable");
  let focused = 0;
  heading.focus = () => { focused += 1; };
  announceCoverageChange(doc, "Coverage increased from 68% to 91%.");
  assert.equal(focused, 1);
  announceCoverageChange(doc, null);
  assert.equal(focused, 1, "focus moved with nothing to announce");
  announceCoverageChange(doc, "Coverage increased from 91% to 100%.", { moveFocus: false });
  assert.equal(focused, 1, "focus moved when the caller had already placed it");
});

// --- extremes --------------------------------------------------------------

test("0% coverage renders without promising a figure it cannot show", async () => {
  const doc = await page();
  applyCoverageTreatment(doc, coverageModel({
    inputState: INPUT_STATES.PROVIDER_ONLY, share: 0, lineItems: [item(1000, null)],
  }));
  assert.match(textOf(doc.getElementById("local-impact-coverage")), /Covers 0% of spend · withheld/);
  assert.match(textOf(doc.getElementById("coverage-upgrade-action")), /would raise coverage to ~100%/);
});

test("a share that rounds to 100 but is not 100 never prints 100%", async () => {
  const doc = await page();
  applyCoverageTreatment(doc, coverageModel({
    inputState: INPUT_STATES.PROVIDER_PLUS_GROUPING, share: 0.9996,
    lineItems: [item(9996, "unit-a"), item(4, null)],
  }));
  const text = textOf(doc.getElementById("local-impact-coverage"));
  assert.match(text, /Covers >99% of spend/);
  assert.ok(!/100%/.test(text));
});

test("a single line item and a single unattributed row read as one, not one(s)", () => {
  const upgrade = rankedCoverageUpgrades({
    inputState: INPUT_STATES.PROVIDER_PLUS_GROUPING, share: 0.5,
    lineItems: [item(500, "unit-a"), item(500, null)],
  });
  assert.match(upgrade.top.label, /1 row missing it/);
});

test("a very long provider name is carried verbatim, and the state word is not truncated", async () => {
  const doc = await page();
  const long = `${"north-american-inference-platform-".repeat(6)}prod`;
  applyCoverageTreatment(doc, modelFor(0.68, INPUT_STATES.PROVIDER_PLUS_GROUPING, long));
  assert.match(textOf(doc.getElementById("coverage-upgrade-action")), /north-american-inference-platform/);
  const css = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
  // The sentence wraps; the chip's word does not, so a name long enough to break
  // the row takes the wrap and the state survives it.
  assert.match(css, /\.coverage-upgrade-action \{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.confidence-chip-label \{[^}]*white-space:nowrap/);
  assert.match(css, /\.coverage-lead-figure \{[^}]*overflow-wrap:anywhere/);
});

test("an unmeasurable share paints the unmeasured sentence in every slot", async () => {
  const doc = await page();
  applyCoverageTreatment(doc, coverageModel({
    inputState: INPUT_STATES.PROVIDER_ONLY, share: null, lineItems: [],
  }));
  for (const id of ["local-impact-coverage", "kpi-recoverable-coverage",
    "local-departments-coverage"]) {
    assert.match(textOf(doc.getElementById(id)), /Coverage unmeasured/, `#${id}`);
  }
  assert.equal(doc.getElementById("coverage-upgrade").hidden, true);
});

test("a chip built outside the painter still ships its word", async () => {
  const doc = await page();
  for (const state of Object.values(CONFIDENCE)) {
    assert.ok(textOf(confidenceChip(doc, state)).length > 0);
  }
});
