// The evidence destination reads as a page a skeptic can check (#1524).
//
// WHAT THESE ASSERTIONS ARE FOR. A finance director defending $51,254 in a
// meeting needs four things in one order: the claim with the figure in it, the
// arithmetic that produced it, the rubric and bands it was graded against, and
// where each input came from. The destination held thirteen panels and none of
// that sequence. These assertions hold the shipped document to it.
//
// WHAT THE HARNESS CANNOT SEE, and what is asserted instead:
//
//   * It reads text through a CLOSED disclosure, so "the text is present" is
//     not evidence a reader can see it. Every claim about visibility here is an
//     assertion about the `open` attribute and about disclosure ANCESTRY, walked
//     through parentNode — never a text search on its own.
//   * It models no layout, so contrast is computed from the tokens the
//     stylesheet declares, composited onto the surface the panel actually draws
//     on. No ratio is hardcoded: a palette refresh moves the numbers and this
//     still asserts the same thing.
//   * It rejects the universal and descendant selectors, so every walk below
//     recurses `node.children` and guards `dataset` with `?.` — text nodes live
//     in `children` and carry none.
//
// No clock, no network, no sleeps: this reads the shipped document and the
// shipped stylesheets, and recomputes the chain from the module that owns it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, pressEnter, tabSequence, textOf } from "./support/browser.js";
import { loadExampleDataset } from "../src/example-dataset.js";
import { getRecoverableSpend, MONTHS_PER_YEAR } from "../src/finops-answer-contract.js";

const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
const evolutionCss = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
const siteCss = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

const REGION_ID = "finops-evidence-working";
const doc = () => parseHtml(html);
const region = (document = doc()) => {
  const found = document.getElementById(REGION_ID);
  assert.ok(found, `#${REGION_ID} is not in the shipped document`);
  return found;
};

/** Every element under `node`, in document order. `children` holds text nodes
 *  too, and those carry no dataset, so everything here guards for that. */
function elementsUnder(node, found = []) {
  for (const child of node.children ?? []) {
    if (child?.nodeType !== 1) continue;
    found.push(child);
    elementsUnder(child, found);
  }
  return found;
}

/** Ancestor test without a descendant selector — the harness rejects those. */
function ancestorMatching(node, predicate) {
  for (let walk = node.parentNode; walk; walk = walk.parentNode) {
    if (walk.nodeType === 1 && predicate(walk)) return walk;
  }
  return null;
}

const isDetails = (node) => node.tagName === "DETAILS";
const byTag = (node, tag) => elementsUnder(node).filter((el) => el.tagName === tag);

// ---------------------------------------------------------------------------
// 1. One heading hierarchy, no skipped level.
// ---------------------------------------------------------------------------

test("the destination's headings step down one level at a time", () => {
  const levels = elementsUnder(region())
    .filter((node) => /^H[1-6]$/.test(node.tagName ?? ""))
    .map((node) => Number(node.tagName.slice(1)));

  // The ACTUAL sequence, not a hand-listed set of ids: a heading added inside a
  // disclosure, or an h3 promoted to an h4, moves this list and fails here.
  assert.ok(levels.length >= 4, `expected the region's headings, found ${levels.length}`);
  assert.equal(levels[0], 2, "the claim is the region's top heading, under the page h1");
  for (let index = 1; index < levels.length; index += 1) {
    assert.ok(levels[index] - levels[index - 1] <= 1,
      `heading ${index + 1} jumps from h${levels[index - 1]} to h${levels[index]}: `
      + `the sequence is ${levels.join(", ")}`);
    assert.ok(levels[index] >= 2, "no heading in the region outranks the claim");
  }
});

// ---------------------------------------------------------------------------
// 2. The claim, with the canonical figure, in the always-visible flow.
// ---------------------------------------------------------------------------

const record = getRecoverableSpend(loadExampleDataset());

test("the claim states the canonical figure and is inside no disclosure", () => {
  const document = doc();
  const claim = document.getElementById("evidence-working-claim");
  assert.ok(claim, "the claim heading is gone");
  assert.equal(claim.tagName, "H2");
  assert.ok(textOf(claim).includes(record.monthlyDisplay),
    `the claim does not carry ${record.monthlyDisplay}: "${textOf(claim)}"`);
  // Folded into a shut disclosure this would still satisfy a text assertion and
  // be invisible to a reader, which is the whole failure mode.
  assert.equal(ancestorMatching(claim, isDetails), null,
    "the canonical figure is inside a disclosure");
  assert.equal(region(document).getAttribute("aria-labelledby"), "evidence-working-claim");
});

test("nothing that announces is folded into a disclosure in this region", () => {
  for (const node of elementsUnder(region())) {
    const role = node.getAttribute("role");
    if (role !== "status" && role !== "alert" && !node.getAttribute("aria-live")) continue;
    assert.equal(ancestorMatching(node, isDetails), null,
      `a live region (${role ?? "aria-live"}) is inside a disclosure and would never be spoken`);
  }
});

// ---------------------------------------------------------------------------
// 3. The arithmetic chain, recomputed from the module that owns the figure.
// ---------------------------------------------------------------------------

/** Whole-dollar-and-cents, grouped, the way the chain writes a running total. */
function money(value) {
  const [whole, cents] = Math.abs(value).toFixed(2).split(".");
  let grouped = "";
  for (let index = 0; index < whole.length; index += 1) {
    if (index > 0 && (whole.length - index) % 3 === 0) grouped += ",";
    grouped += whole[index];
  }
  return `$${grouped}.${cents}`;
}

test("every running result in the chain is what the contract module computes", () => {
  const document = doc();
  const list = document.getElementById("evidence-working-steps");
  assert.ok(list, "the chain list is gone");
  assert.equal(list.tagName, "OL", "the chain is an ordered list, not a paragraph of hedges");

  const steps = byTag(list, "LI");
  const dataset = loadExampleDataset();
  const rows = (dataset.rankedDepartments ?? dataset.departments ?? [])
    .filter((row) => row?.scored !== false
      && Number.isFinite(row?.recoverableUsd) && row.recoverableUsd >= 0);

  // scope + one line per scored department + the rounding + the projection.
  assert.equal(steps.length, rows.length + 3,
    `the chain has ${steps.length} steps for ${rows.length} scored departments`);

  const expected = [`${record.scoredDepartments} of ${record.totalDepartments} in scope`];
  let running = 0;
  for (const row of rows) {
    running += row.recoverableUsd;
    expected.push(money(running));
  }
  expected.push(`${record.monthlyDisplay} a month`, `${record.annualisedDisplay} a year`);

  steps.forEach((step, index) => {
    const result = byTag(step, "B")[0];
    assert.ok(result, `step ${index + 1} states no running result`);
    assert.equal(textOf(result), expected[index],
      `step ${index + 1} states "${textOf(result)}", the module computes "${expected[index]}"`);
    // Input, operation and running result: the operation is what makes the line
    // checkable, so a step that lost it is a step a reader has to trust.
    const operation = elementsUnder(step).find((node) => node.className === "evidence-step-op");
    assert.ok(operation && textOf(operation).length > 0,
      `step ${index + 1} states no operation`);
  });

  // Each department's own line is named in its step, so the sum can be checked
  // against the department destination rather than taken on trust.
  rows.forEach((row, index) => {
    const step = textOf(steps[index + 1]);
    assert.ok(step.includes(row.name), `step ${index + 2} does not name ${row.name}`);
    assert.ok(step.includes(money(row.recoverableUsd)),
      `step ${index + 2} does not state ${row.name}'s own line ${money(row.recoverableUsd)}`);
  });

  const projection = textOf(steps[steps.length - 1]);
  assert.ok(projection.includes(String(MONTHS_PER_YEAR)),
    "the projection step does not state the factor it multiplies by");
});

// ---------------------------------------------------------------------------
// 4. Rubric version and bands, stated once, at one known place.
// ---------------------------------------------------------------------------

test("the rubric and the pricing bands are stated in one place, labelled", () => {
  const document = doc();
  const rubric = document.getElementById("evidence-working-rubric");
  assert.ok(rubric, "the rubric block is gone");
  const heading = document.getElementById("evidence-working-rubric-title");
  assert.equal(heading?.tagName, "H3", "the rubric block is not labelled by a heading");

  const stated = textOf(rubric);
  for (const version of ["finops-recoverable-spend/1.0.0", "finops-pricing-provenance/1.0.0"]) {
    assert.ok(stated.includes(version), `the rubric block does not state ${version}`);
    // Once. A version restated inline three times is three things that can
    // disagree, which is the defect this region was drawn to remove.
    const occurrences = textOf(region(document)).split(version).length - 1;
    assert.equal(occurrences, 1, `${version} is stated ${occurrences} times in the region`);
  }

  const bands = document.getElementById("evidence-working-bands");
  assert.ok(bands, "the band table is gone");
  assert.equal(bands.tagName, "DETAILS", "the band table is not progressive disclosure");
  const criteria = byTag(bands, "DT").map((node) => textOf(node));
  assert.equal(criteria.length, 4, `expected four pricing criteria, found ${criteria.length}`);
});

// ---------------------------------------------------------------------------
// 5. Provenance per input, with a source and a band or a period.
// ---------------------------------------------------------------------------

test("every input names a source, and carries a band or a period identifier", () => {
  const document = doc();
  const sources = document.getElementById("evidence-working-sources");
  assert.ok(sources, "the provenance list is gone");
  const items = byTag(sources, "LI");
  assert.ok(items.length >= 5, `expected one entry per input, found ${items.length}`);
  for (const item of items) {
    const source = elementsUnder(item).find((node) => node.className === "evidence-step-op");
    assert.ok(source && textOf(source).length > 0, `"${textOf(item)}" names no source`);
    const band = elementsUnder(item).find((node) => node.className === "evidence-band");
    assert.ok(band && textOf(band).length > 0,
      `"${textOf(item)}" carries no band or period identifier`);
  }
  assert.ok(textOf(sources).includes(record.periodLabel),
    `the provenance list does not state the period ${record.periodLabel}`);
});

// ---------------------------------------------------------------------------
// 6. Every disclosure is reachable, operable, and readable once opened.
// ---------------------------------------------------------------------------

test("each disclosure is a tab stop, opens on Enter, and reveals its content", () => {
  const document = doc();
  const disclosures = elementsUnder(region(document)).filter(isDetails);
  assert.ok(disclosures.length >= 2,
    `expected the supporting detail behind disclosures, found ${disclosures.length}`);

  for (const disclosure of disclosures) {
    const summary = byTag(disclosure, "SUMMARY")[0];
    assert.ok(summary, `#${disclosure.id} has no summary, so it has no control`);
    assert.equal(disclosure.hasAttribute("open"), false,
      `#${disclosure.id} ships open; supporting detail starts folded`);

    // Reachable by keyboard alone: the summary is in the page's own tab order.
    assert.ok(tabSequence(document).includes(summary),
      `#${disclosure.id}'s control is not reachable by Tab`);

    // Operable by keyboard alone, and the expanded state changes on activation.
    // The control is a native summary, so the expanded state a screen reader
    // announces IS the `open` attribute; where a summary also carries an
    // explicit aria-expanded, the two must agree or the announcement is a lie.
    summary.focus();
    pressEnter(document);
    assert.equal(disclosure.hasAttribute("open"), true,
      `#${disclosure.id} did not expand on Enter`);
    const announced = summary.getAttribute("aria-expanded");
    if (announced !== null) {
      assert.equal(announced, "true",
        `#${disclosure.id} announces aria-expanded="${announced}" while open`);
    }

    // And what it revealed is readable: a disclosure whose content is empty is a
    // control that does nothing.
    const body = elementsUnder(disclosure)
      .filter((node) => node !== summary && !ancestorMatching(node, (walk) => walk === summary));
    assert.ok(body.some((node) => textOf(node).length > 0),
      `#${disclosure.id} reveals nothing`);

    pressEnter(document);
    assert.equal(disclosure.hasAttribute("open"), false,
      `#${disclosure.id} did not collapse again on Enter`);
  }
});

test("the region adds no focus trap: its controls are only its disclosures", () => {
  const document = doc();
  const inside = tabSequence(document)
    .filter((node) => ancestorMatching(node, (walk) => walk.id === REGION_ID));
  assert.ok(inside.every((node) => node.tagName === "SUMMARY"),
    `the region ships a control that is not a disclosure: `
    + `${inside.map((node) => node.tagName).join(", ")}`);
});

// ---------------------------------------------------------------------------
// 7. Contrast, computed from the tokens in use.
// ---------------------------------------------------------------------------

const TOKENS = Object.fromEntries([...`${siteCss}\n${evolutionCss}`
  .matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g)].map(([, name, hex]) => [name, hex]));

const expand = (hex) => (hex.length === 4
  ? `#${[...hex.slice(1)].map((ch) => ch + ch).join("")}` : hex);
const bytes = (hex) => [1, 3, 5].map((at) => Number.parseInt(expand(hex).slice(at, at + 2), 16));

const channel = (value) => (value / 255 <= 0.03928
  ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);

const relativeLuminance = (hex) => {
  const [red, green, blue] = bytes(hex).map(channel);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

function contrastRatio(foreground, background) {
  const [light, dark] = [relativeLuminance(foreground), relativeLuminance(background)]
    .sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** One declaration off one rule, with `var(--token)` resolved through the
 *  stylesheet's own `:root`. Nothing here is a hex this test typed. */
function declared(css, selector, property) {
  const rule = css.match(new RegExp(`${selector.replace(/[.[\]"=]/g, "\\$&")}[^{]*\\{([^}]*)\\}`));
  assert.ok(rule, `no rule for ${selector}`);
  const found = rule[1].match(new RegExp(`(?:^|;|\\{)\\s*${property}\\s*:\\s*([^;]+)`));
  assert.ok(found, `${selector} declares no ${property}`);
  const value = found[1].trim();
  const token = value.match(/^var\(--([\w-]+)\)$/);
  if (!token) return value;
  assert.ok(TOKENS[token[1]], `--${token[1]} is not a declared token`);
  return TOKENS[token[1]];
}

/** The surface the panel actually draws on: its own translucent fill composited
 *  over the page background, both read from the stylesheets. */
function panelSurface() {
  const page = declared(siteCss, ":root", "background");
  const fill = declared(evolutionCss, ".finops-panel", "background");
  const parts = fill.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  assert.ok(parts, `.finops-panel's background is not an rgb(a) fill: ${fill}`);
  const alpha = parts[4] === undefined ? 1 : Number(parts[4]);
  const under = bytes(page);
  const over = [1, 2, 3].map((at) => Number(parts[at]));
  const mixed = over.map((value, index) =>
    Math.round(value * alpha + under[index] * (1 - alpha)));
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

test("the region's text clears 4.5:1 on the surface it is drawn on", () => {
  const surface = panelSurface();
  for (const selector of [".evidence-step-op", ".evidence-band"]) {
    const ink = declared(evolutionCss, selector, "color");
    const ratio = contrastRatio(ink, surface);
    assert.ok(ratio >= 4.5,
      `${selector} (${ink}) on ${surface} is ${ratio.toFixed(2)}:1, under 4.5:1`);
  }
});

test("no band identifier is carried by its outline alone", () => {
  // The band chip is an OUTLINE, which is the design system's silhouette for a
  // static classification. An outline at this weight is not a 3:1 boundary, so
  // the meaning may never rest on it: every chip states its band in words.
  const chips = elementsUnder(region()).filter((node) => node.className === "evidence-band");
  assert.ok(chips.length >= 5, `expected the band chips, found ${chips.length}`);
  for (const chip of chips) {
    assert.ok(textOf(chip).length > 0, "a band chip is drawn with no label in it");
  }
});

// ---------------------------------------------------------------------------
// 8. Nothing the answer screen said about provenance was silently dropped.
// ---------------------------------------------------------------------------

test("every provenance label the answer screen carries is still in the product", () => {
  // Enumerated on purpose. This region restates the rubric and the sources in
  // one place; the risk that creates is a label quietly deleted from the answer
  // screen because "it is over there now". Each one is named, so a silent drop
  // fails by name rather than by a count nobody reads.
  const LABELS = [
    "Recoverable AI spend per month",
    "How far to trust this figure",
    "Illustrative",
    "Confidence:",
    "Pricing provenance:",
    "Bundled synthetic example",
    "How we know this",
    "Provenance",
    "Basis",
    "Limits",
  ];
  const page = textOf(doc().getElementById("main-content"));
  for (const label of LABELS) {
    assert.ok(page.includes(label),
      `"${label}" is no longer anywhere in the page after the move`);
  }
});
