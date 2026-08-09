// The figure first, and one "how we know this" behind it (#1185).
//
// WHAT THESE ASSERTIONS ARE FOR.
//
//   * FIGURE BEFORE QUALIFICATION. A CTO reading the answer region met a
//     paragraph of provenance before they met a number. Source order is reading
//     order on this page, so the assertions are on source order: the figure's
//     own value is authored before the sentence that qualifies it, and what is
//     left beside the figure is a marker of a few words rather than a preamble.
//   * ONE PATTERN, REUSED. Three regions carry it and they carry the SAME one:
//     the same summary words, the same three labelled parts in the same order,
//     the same classes. A per-section variant is a pattern nobody learns.
//   * NOTHING LIVE INSIDE IT. The harness reads text through a closed
//     disclosure, so a live region folded into one passes every text assertion
//     while being silent in a real browser. This walks parentNode from every
//     status/live node on the page and fails if one has a disclosure ancestor.
//
// No clock, no network, no sleeps: this reads the shipped document.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import { FOCUS_SPEC } from "../src/finops-decision-interaction.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const doc = () => parseHtml(html);

/** The summary words, identical across instances so the control is learnable. */
const SUMMARY_LABEL = "How we know this";

/** The three parts, in the order every instance states them. */
const PARTS = ["Provenance", "Basis", "Limits"];

/** Every region that carries the pattern, with the disclosure it carries. */
const INSTANCES = [
  { region: "finops-recoverable-answer", disclosure: "finops-recoverable-how-we-know" },
  { region: "finops-stand", disclosure: "finops-stand-how-we-know" },
  { region: "finops-first-run", disclosure: "finops-first-run-how-we-know" },
];

/** Ancestor test without a descendant selector — the harness rejects those. */
const within = (node, ancestor) => {
  for (let walk = node; walk; walk = walk.parentNode) if (walk === ancestor) return true;
  return false;
};

const at = (id) => {
  const index = html.indexOf(`id="${id}"`);
  assert.ok(index >= 0, `#${id} is no longer authored in the document`);
  return index;
};

// ---------------------------------------------------------------------------
// 1. The figure is stated before the thing that qualifies it.
// ---------------------------------------------------------------------------

test("the answer region states its figure before any sentence qualifying it", () => {
  const document = doc();

  // The money, then the marker beside it, then the hedge, then the move.
  assert.ok(at("finops-recoverable-value") < at("finops-recoverable-marker"),
    "the marker is authored before the figure it marks");
  assert.ok(at("finops-recoverable-marker") < at("finops-recoverable-confidence"),
    "the qualifying sentence is authored before the marker");
  assert.ok(at("finops-recoverable-confidence") < at("finops-recoverable-how-we-know"),
    "the full qualification is not below the short one");

  // THE MARKER CARRIES ITS MEANING AS TEXT. Not a colour, not a glyph alone:
  // a word a reader can read and a screen reader can speak.
  // The word itself is resolved by the readiness contract and seeded into the
  // served document (#1480), so the authored source carries a placeholder. What
  // matters here is that the marker is a few words of TEXT and not a colour, and
  // the seed keeps it that way: it is a one-line chip either way.
  const marker = document.getElementById("finops-recoverable-marker");
  const markerText = textOf(marker).trim();
  assert.ok(markerText.length > 0 && markerText.length <= 30,
    `the marker beside the figure is ${markerText.length} characters of text`);
  assert.equal(marker.getAttribute("aria-hidden"), null,
    "the only marker on the figure is hidden from assistive technology");

  // AND IT IS SHORT. The defect was a disclaimer longer than the finding: this
  // sentence shipped at 233 characters, three lines of hedge between the money
  // and the move. A ceiling rather than a ratchet — the full 233 characters are
  // in the disclosure below, so there is nowhere for this line to grow back to.
  const hedge = textOf(document.getElementById("finops-recoverable-confidence"));
  assert.ok(hedge.length <= 100,
    `the hedge beside the figure is ${hedge.length} characters; it belongs in the `
    + "disclosure past about 100");
  for (const term of [/list price/i, /committed-use/i, /ceiling/i]) {
    assert.match(hedge, term, "shortening the hedge dropped what it exists to say");
  }
});

test("every supporting section leads with its finding, not its disclaimer", () => {
  // The two synthetic-data markers that survive above their figures are a
  // clause each. The paragraphs they used to be are inside the disclosures.
  const document = doc();
  for (const id of ["finops-stand-sample", "finops-first-run-sample"]) {
    const text = textOf(document.getElementById(id));
    assert.ok(text.length <= 140,
      `#${id} is ${text.length} characters of preamble above the figures`);
    assert.match(text, /Illustrative/,
      `#${id} no longer names what kind of number follows`);
  }
  // And the long form did not simply vanish: it is in the disclosure.
  const first = textOf(document.getElementById("finops-first-run-how-we-know"));
  assert.match(first, /six months of invented records/);
  assert.match(first, /hand-authored synthetic cohort boundaries/);
});

// ---------------------------------------------------------------------------
// 2. One pattern, reused — not a variant per section.
// ---------------------------------------------------------------------------

test("three regions carry the same how-we-know disclosure", () => {
  const document = doc();
  const all = document.querySelectorAll("details.how-we-know");
  assert.equal(all.length, INSTANCES.length,
    "a how-we-know disclosure was added or dropped without updating this list");

  for (const { region, disclosure } of INSTANCES) {
    const host = document.getElementById(region);
    const details = document.getElementById(disclosure);
    assert.ok(details, `#${region} carries no how-we-know disclosure`);
    assert.equal(details.tagName, "DETAILS",
      `#${disclosure} is not a native disclosure element`);
    assert.ok(within(details, host), `#${disclosure} is not inside #${region}`);
    assert.equal(details.hasAttribute("open"), false,
      `#${disclosure} ships open, so the proof arrives as a disclaimer again`);

    // IDENTICAL, LEARNABLE CONTROL. Same words, same classes, every instance.
    const summary = details.querySelector("summary");
    assert.equal(summary.tagName, "SUMMARY");
    assert.equal(textOf(summary).replace(/[▸▾\s]+/g, " ").trim(), SUMMARY_LABEL,
      `#${disclosure}'s control reads differently from the others`);
    assert.ok(summary.className.includes("figure-source-summary"),
      `#${disclosure} forks the shipped disclosure silhouette`);
    assert.equal(summary.getAttribute("tabindex"), null,
      `#${disclosure}'s control was taken out of the natural tab order`);
    assert.equal(summary.querySelectorAll("button").length, 0,
      `#${disclosure} puts a control inside its summary, so Enter and Space stop `
      + "being the browser's");
    assert.equal(summary.hidden, false, `#${disclosure}'s control is hidden`);

    // THREE LABELLED PARTS, in the same order every time.
    const terms = details.querySelectorAll("dt").map((node) => textOf(node).trim());
    assert.deepEqual(terms, PARTS, `#${disclosure} states different parts`);
    assert.equal(details.querySelectorAll("dd").length, PARTS.length,
      `#${disclosure} has a labelled part with no content`);
    for (const definition of details.querySelectorAll("dd")) {
      assert.ok(textOf(definition).trim().length > 40,
        `#${disclosure} carries a part that says nothing`);
    }

    // No heading inside: the disclosure explains an answer, it does not open a
    // second question under it.
    assert.equal(details.querySelectorAll("h1,h2,h3,h4,h5,h6").length, 0,
      `#${disclosure} outranks the answer it sits inside`);
  }
});

test("the pattern adds no class the stylesheet has to grow for", async () => {
  const css = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  for (const sheet of [css, styles]) {
    assert.doesNotMatch(sheet, /\.how-we-know/,
      "the how-we-know pattern grew a rule instead of reusing .figure-source");
  }
  // The classes it does lean on are the ones already shipped for this job.
  for (const selector of [".figure-source>summary", ".figure-source-detail",
    ".figure-source-state"]) {
    assert.ok(css.includes(selector), `${selector} is gone, so the pattern is unstyled`);
  }
  // Including the focus ring on the control, in both states — the rule is on
  // the summary, which a disclosure keeps whether it is open or shut.
  assert.match(css, /\.figure-source>summary:focus-visible \{[^}]*outline:3px/,
    "the how-we-know control has no visible focus ring");
});

test("the brief's disclosure is in the region's pinned focus order", () => {
  assert.equal(FOCUS_SPEC.order[0], "finops-first-run-how-we-know-summary",
    "the how-we-know control is not the first thing reached after the answer");
  assert.ok(at("finops-first-run-answer") < at("finops-first-run-how-we-know"),
    "the control is reached before the answer it qualifies");
});

// ---------------------------------------------------------------------------
// 3. Nothing that has to be announced is folded away.
// ---------------------------------------------------------------------------

/**
 * The live regions that ALREADY sit inside a disclosure on this page, named
 * rather than counted.
 *
 * None of them was folded by #1185 — every one predates it, and unfolding them
 * is four other regions' worth of change. They are pinned here because the
 * assertion that matters is directional: this list may shrink, and a node that
 * joins it fails this test by name. The harness reads text through a shut
 * disclosure, so nothing else on this page would notice.
 */
const ALREADY_FOLDED = [
  "department-detail inside disclosure-department-priority",
  "LI inside disclosure-savings-portfolio",
  "finops-journey-live inside disclosure-journey",
  "org-query-source-status inside org-query-source-help",
  "portfolio-count inside disclosure-savings-portfolio",
];

/** Every status/live node on the page, with the disclosure it is folded into. */
const foldedLiveRegions = (document) => {
  const live = new Set([
    ...document.querySelectorAll("[aria-live]"),
    ...document.querySelectorAll("[role=\"status\"]"),
    ...document.querySelectorAll("[role=\"alert\"]"),
    ...document.querySelectorAll("[role=\"log\"]"),
  ]);
  const folded = new Set();
  for (const node of live) {
    for (let walk = node.parentNode; walk; walk = walk.parentNode) {
      if (walk.tagName !== "DETAILS") continue;
      folded.add(`${node.id || node.tagName} inside ${walk.id || "an unnamed disclosure"}`);
      break;
    }
  }
  return [...folded].sort();
};

test("no live region was folded away, and none joined the ones already folded", () => {
  const document = doc();
  const live = document.querySelectorAll("[aria-live]");
  assert.ok(live.length >= 5,
    `only ${live.length} live regions found; the audit is not reaching the page`);

  const folded = foldedLiveRegions(document);
  const joined = folded.filter((entry) => !ALREADY_FOLDED.includes(entry));
  assert.deepEqual(joined, [],
    "a live region moved inside a disclosure: shut, it announces to nobody, and "
    + "the harness reads its text anyway");
});

test("nothing announced is inside a how-we-know disclosure", () => {
  const document = doc();
  const folded = foldedLiveRegions(document);
  for (const entry of folded) {
    assert.doesNotMatch(entry, /how-we-know/,
      `${entry}: the one pattern this page reuses must never hold an announcement`);
  }
  // And the audit is done by walking the markup, not by trusting the harness:
  // every node the pattern holds is checked for the attributes that make it
  // live, at any depth, in the test below as well.
  for (const { disclosure } of INSTANCES) {
    const details = document.getElementById(disclosure);
    assert.equal(details.querySelectorAll("[aria-live]").length, 0,
      `#${disclosure} holds a live region`);
  }
});

test("the how-we-know disclosures hold prose, not announcements", () => {
  const document = doc();
  for (const { disclosure } of INSTANCES) {
    const details = document.getElementById(disclosure);
    for (const attribute of ["aria-live", "role"]) {
      assert.equal(details.querySelectorAll(`[${attribute}]`).length, 0,
        `#${disclosure} holds a node carrying ${attribute}`);
    }
    // No control inside either: the proof is readable, not operable.
    for (const tag of ["button", "input", "select", "textarea", "a"]) {
      assert.equal(details.querySelectorAll(tag).length, 0,
        `#${disclosure} folds a ${tag} away behind a shut disclosure`);
    }
  }
});

// ---------------------------------------------------------------------------
// 4. Plain language outside, identifiers inside.
// ---------------------------------------------------------------------------

test("internal identifiers stay inside the disclosure, not in the visible answer", () => {
  const document = doc();
  // "residue" is what the coverage module calls records its classifier could
  // not place. It is a correct name in the code and a meaningless one on the
  // page, so no reader-facing sentence in the answer spine may carry it.
  for (const id of ["finops-answer-confidence", "finops-recoverable-confidence",
    "finops-stand-sample", "finops-first-run-sample", "finops-first-run-answer-detail"]) {
    const text = textOf(document.getElementById(id));
    assert.doesNotMatch(text, /\bresidue\b/i, `#${id} still says "residue" to a reader`);
    assert.doesNotMatch(text, /provisional coverage tier/i,
      `#${id} still exposes an internal tier name`);
    assert.doesNotMatch(text, /\/\d+\.\d+\.\d+/,
      `#${id} still quotes a versioned contract id in visible prose`);
  }
  // The identifier a skeptic actually needs is not deleted — it is one press
  // away, verbatim, in the part of the disclosure that names the arithmetic.
  const brief = textOf(document.getElementById("finops-first-run-how-we-know"));
  assert.match(brief, /literacy-mix\/1\.0\.0/,
    "the rubric a quoted grade must be argued against is no longer available");
});
