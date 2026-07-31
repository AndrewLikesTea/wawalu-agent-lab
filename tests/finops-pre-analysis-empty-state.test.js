// What /evolution.html draws for a visitor who has imported nothing.
//
// THE DEFECT THIS EXISTS TO CATCH. A first-time visitor with a fresh profile
// landed on a scaffold: eleven metric-shaped tiles across #finops-stand and
// #finops-first-run, every one of them holding a null placeholder — "Not yet
// compared", "Not yet measured", "Not yet ranked", "No department named yet",
// "Confidence not stated" — with two copies of the invented-data disclaimer
// between them. Sighted, it read as a broken dashboard. By heading, it was a
// dozen stops through labelled nothing before the one action worth taking.
//
// The fix withholds each block until it has a figure, using `hidden` rather
// than a visually-hidden class, because a visually-hidden node is still in the
// accessibility tree and still a stop. So the claims below are counted over the
// first screen's whole text, hidden nodes included: a placeholder that survives
// as an unread string is a placeholder that comes back the first time someone
// reveals the block for another reason.
//
// tests/finops-first-screen-copy.test.js owns the words the empty state does
// say. This file owns what it must not, and the regression guard that the
// populated state is unchanged.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHtml, textOf } from "./support/browser.js";
import { applyFirstRunResult } from "../src/finops-first-run-view.js";
import { buildFirstRunResult, FIRST_RUN_IDS, FIRST_RUN_NOT_YET } from "../src/finops-first-run.js";
import { applyStandHeadline } from "../src/finops-stand-view.js";
import { composeStandHeadline, STAND_IDS, STAND_PENDING, STAND_QUESTION } from "../src/finops-stand.js";
import { loadExampleDataset } from "../src/example-dataset.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

/**
 * The null placeholders the pre-analysis screen is not allowed to hold.
 *
 * Read off the modules that own them rather than typed here: they are still the
 * right words for a figure a completed analysis genuinely could not produce,
 * and this file is about *when* they may be shown, not about the wording.
 */
const PLACEHOLDERS = [
  STAND_PENDING.position, STAND_PENDING.recoverable, STAND_PENDING.team, STAND_PENDING.action,
  FIRST_RUN_NOT_YET.measured, FIRST_RUN_NOT_YET.ranked,
  "Confidence not stated",
];

/** The disclaimer, in the words both regions used to carry a copy of. */
const DISCLAIMER = "invented data for an invented company";

const byId = (document, id) => document.getElementById(id);

/**
 * The first screen: the answer region, the page's own name, and the brief.
 *
 * Everything below #finops-first-run is a disclosure, an evidence layer, or the
 * import panel — a reader reaches those by scrolling or by opening something,
 * which is a different decision from the one this file is about.
 */
const firstScreen = (document) =>
  [STAND_IDS.region, "finops-hero", FIRST_RUN_IDS.region].map((id) => byId(document, id));

/** Every element under `root`, in document order, hidden ones included. */
function descendants(root) {
  const out = [];
  const visit = (node) => {
    for (const child of node?.children ?? []) {
      if (child?.nodeType !== 1) continue;
      out.push(child);
      visit(child);
    }
  };
  visit(root);
  return out;
}

/** How many times `needle` occurs across a screen's text, hidden nodes included. */
function occurrences(regions, needle) {
  return regions.reduce((total, region) =>
    total + textOf(region).split(needle).length - 1, 0);
}

/** The same count over what is actually drawn — hidden subtrees skipped. */
function drawnOccurrences(regions, needle) {
  return regions.reduce((total, region) => total
    + [region, ...descendants(region)]
      .filter((node) => !node.hidden && !node.closest("[hidden]"))
      .reduce((sum, node) => sum + ownText(node).split(needle).length - 1, 0), 0);
}

/** A node's own text — its direct text children, not its descendants'. */
function ownText(node) {
  return (node.children ?? [])
    .filter((child) => child?.nodeType === 3).map((child) => child.data ?? "").join(" ");
}

/** The shipped document, before any script has run — the state under test. */
const shippedPage = async () => parseHtml(await readFile(PAGE, "utf8"));

// --- the pre-analysis state ------------------------------------------------

test("no null placeholder is authored anywhere on the pre-analysis first screen", async () => {
  const document = await shippedPage();
  const screen = firstScreen(document);

  for (const placeholder of PLACEHOLDERS) {
    assert.equal(occurrences(screen, placeholder), 0,
      `the empty screen still reads ${JSON.stringify(placeholder)}`);
  }
});

test("the pre-analysis first screen draws at most one metric-shaped tile", async () => {
  const document = await shippedPage();
  // A tile is a figure slot: a label over a value. Drawn means not inside a
  // `hidden` subtree — `hidden` is what takes a node out of the layout and out
  // of the accessibility tree at once, which a visually-hidden class does not.
  const drawn = firstScreen(document)
    .flatMap(descendants)
    .filter((node) => ["first-run-slot", "stand-figure", "stand-team"]
      .some((name) => node.classList.contains(name)))
    .filter((node) => !node.hidden && !node.closest("[hidden]"));

  assert.ok(drawn.length <= 1,
    `the empty screen draws ${drawn.length} metric tiles: ${JSON.stringify(drawn.map((n) => textOf(n)))}`);
});

test("the org's standing is asked once, and no heading is a bare placeholder", async () => {
  const document = await shippedPage();
  const headings = firstScreen(document).flatMap(descendants)
    .filter((node) => /^H[1-6]$/.test(node.tagName))
    .filter((node) => !node.hidden && !node.closest("[hidden]"));

  const asking = headings.filter((node) => textOf(node) === STAND_QUESTION);
  assert.equal(asking.length, 1,
    `the first screen asks "${STAND_QUESTION}" ${asking.length} times`);
  assert.equal(asking[0].id, STAND_IDS.question);

  // A heading whose whole content is a null placeholder is an entry in the
  // heading outline that tells a reader who jumped to it nothing at all.
  for (const heading of headings) {
    const text = textOf(heading);
    assert.notEqual(text, "", `an empty ${heading.tagName} is a dead stop in the outline`);
    assert.ok(!PLACEHOLDERS.includes(text),
      `${heading.tagName} "${text}" is a heading whose only content is a placeholder`);
  }

  // And removing the tiles introduced no gap in the outline: the levels the
  // screen still has run h1, h2, h3 with nothing skipped.
  const levels = [...new Set(headings.map((node) => Number(node.tagName.slice(1))))].sort();
  assert.deepEqual(levels, [1, 2, 3], `the first screen's heading levels are ${levels.join(", ")}`);
});

test("the invented-data disclaimer is stated once on the pre-analysis first screen", async () => {
  const document = await shippedPage();
  // Counted over what is DRAWN, unlike the placeholders above, and the
  // difference is deliberate. A placeholder is deleted: no state of this page
  // should ever reveal a block whose figure slot still reads "Not yet ranked".
  // The brief's copy of the disclaimer is not deleted — it is withheld with the
  // figures it qualifies and revealed on the same paint, because a reader
  // looking at an example result must be told whose numbers they are without
  // scrolling back to the region above. What was wrong was stating it twice to
  // a visitor who had been shown no figures at all.
  assert.equal(drawnOccurrences(firstScreen(document), DISCLAIMER), 1,
    "the empty screen repeats the invented-data disclaimer");
  // It is still authored rather than composed, so the claim is true with
  // scripting off as well — tests/finops-first-viewport.test.js owns that rule.
  assert.equal(occurrences(firstScreen(document), DISCLAIMER), 2);
});

test("one action is primary, the other is the design system's secondary treatment", async () => {
  const document = await shippedPage();
  const demo = byId(document, FIRST_RUN_IDS.demo);
  const own = byId(document, FIRST_RUN_IDS.import);

  // The weight is carried by the two classes the stylesheet already draws:
  // `.first-run-primary` is a filled `--import-accent` button, and
  // `.first-run-secondary` is a dashed outline on a transparent ground. No
  // third treatment, and neither of them is a new token.
  assert.ok(demo.classList.contains("first-run-primary"));
  assert.ok(own.classList.contains("first-run-secondary"));
  assert.ok(!own.classList.contains("first-run-primary"),
    "the secondary action is drawn at the primary action's weight");

  // And exactly one of the two is primary on the screen a visitor lands on.
  const primaries = firstScreen(document).flatMap(descendants)
    .filter((node) => node.classList.contains("first-run-primary"))
    .filter((node) => !node.hidden && !node.closest("[hidden]"));
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0].id, FIRST_RUN_IDS.demo);
});

test("the primary action is within four tab stops of the skip link's destination", async () => {
  const document = await shippedPage();
  // The skip link exists to be used: activating it moves focus to `<main>`,
  // which is where a keyboard user starts. Counting from the link itself would
  // measure the site nav, which this change deliberately does not touch.
  const skip = document.querySelector(".skip-link");
  assert.equal(skip.getAttribute("href"), "#main-content");
  const main = byId(document, "main-content");
  assert.equal(main.getAttribute("tabindex"), "-1", "the skip link's target cannot take focus");

  const reachable = descendants(main)
    .filter((node) => ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(node.tagName))
    .filter((node) => !node.hidden && !node.closest("[hidden]")
      && node.getAttribute("tabindex") !== "-1");
  const stops = reachable.findIndex((node) => node.id === FIRST_RUN_IDS.demo) + 1;
  assert.ok(stops >= 1 && stops <= 4,
    `the primary action is ${stops} tab stops into <main>: ${JSON.stringify(reachable.slice(0, 5).map((n) => n.id))}`);
});

test("the primary action's focus ring is the site's existing token, and no new one was added", async () => {
  const css = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
  const rule = css.match(/\.first-run-choice button:focus-visible \{([^}]*)\}/)?.[1];
  assert.ok(rule, "the choice buttons publish no focus-visible rule at all");
  // `--focus-ring` is declared once, in styles.css `:root`, and this is the
  // only ring these controls draw. `outline-offset` matters as much as the
  // colour: the ring sits clear of the filled button and against the region's
  // own near-white ground, which is what the 3:1 non-text contrast is measured
  // against rather than the accent fill it would otherwise sit on.
  assert.match(rule, /outline:3px solid var\(--focus-ring\)/);
  assert.match(rule, /outline-offset:3px/);
  const root = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(root, /--focus-ring:#155f9e/, "the focus token moved; the contrast above is stale");

  // The withheld blocks introduce no custom property of their own: `hidden`
  // already means "not rendered", and the rule only restores that meaning
  // against the author `display` each block sets.
  const withheld = css.match(/\.pre-analysis-withheld\[hidden\] \{([^}]*)\}/)?.[1];
  assert.equal(withheld?.trim(), "display:none;");
});

// --- the populated state, unchanged ----------------------------------------

test("loading the bundled synthetic example renders the full metric grid", async () => {
  const document = await shippedPage();
  const result = buildFirstRunResult();
  assert.ok(result, "the bundled example composed nothing to paint");
  applyFirstRunResult(document, result);
  applyStandHeadline(document, composeStandHeadline({ analysis: loadExampleDataset(), source: "example" }));

  // Every block the empty state withheld is drawn again, in its authored place
  // and with its authored label — this is the regression guard that the fix is
  // a change to the pre-analysis state and to nothing else.
  const blocks = firstScreen(document).flatMap(descendants)
    .filter((node) => node.classList.contains("pre-analysis-withheld"));
  assert.ok(blocks.length >= 6, `only ${blocks.length} withheld blocks are marked`);
  for (const block of blocks) {
    assert.equal(block.hidden, false,
      `${block.className} is still hidden after the example was loaded`);
  }

  const labelled = [
    [FIRST_RUN_IDS.benchmarkValue, "Potentially recoverable share"],
    [FIRST_RUN_IDS.impactValue, "Potential impact · routing scenario"],
    [FIRST_RUN_IDS.peerValue, "Rank against similar organizations"],
    [FIRST_RUN_IDS.internalValue, "Internal drill-down · widest department gap"],
    [FIRST_RUN_IDS.confidenceValue, "Confidence in this answer"],
    [STAND_IDS.positionValue, "Rank against similar organizations"],
    [STAND_IDS.recoverableValue, "Recoverable spend"],
    [STAND_IDS.teamName, "Department driving the increase"],
  ];
  for (const [id, label] of labelled) {
    const value = byId(document, id);
    assert.notEqual(textOf(value), "", `${id} is drawn with no value in it`);
    assert.equal(textOf(value.parentNode.querySelector("h3")), label,
      `${id}'s label moved or changed`);
  }

  // The sample marker comes back with the figures it qualifies, so a reader
  // looking at an example result is still told whose numbers these are.
  const sample = byId(document, FIRST_RUN_IDS.sample);
  assert.equal(sample.hidden, false);
  assert.match(textOf(sample), /Bundled synthetic example/);
  assert.match(textOf(sample), new RegExp(DISCLAIMER));
});
