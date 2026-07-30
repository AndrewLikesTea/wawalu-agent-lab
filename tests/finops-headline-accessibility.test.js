// The AI FinOps comparison headline, read the way a keyboard and a screen
// reader read it.
//
// Four things are held here, and each of them is a way the headline could look
// correct on a designer's screen and be unusable off it:
//
//   1. NO MEANING IN COLOUR ALONE. Every band state — including the withheld
//      one — carries a word and a shape as well as a tint, and every foreground
//      / background pairing in the chip table clears WCAG AA. The ratios are
//      computed here rather than eyeballed, so a token swap that breaks one
//      fails a test instead of shipping.
//   2. READING ORDER. The question, then the position and the metric it is
//      based on, then the named lagging team, then the action. That is the DOM
//      order, which is why it is also the focus order and the print order.
//   3. THE DISCLOSURE IS OPERABLE. A real control, in the tab order, with
//      `aria-expanded` that tracks `open`, driven by Enter and by Space.
//   4. FOCUS SURVIVES A REPAINT. A reader standing on the evidence control when
//      a fresh position lands is still standing on it afterwards, with what
//      they had open still open.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml, pressEnter, pressSpace, textOf } from "./support/browser.js";
import { importPageModule } from "./support/page-module.js";
import {
  BAND_PRESENTATION, BAND_STATE, buildFirstRunResult, FIRST_RUN_IDS,
  WITHHELD_BAND_LABEL, WITHHELD_GAP_LABEL,
} from "../src/finops-first-run.js";
import { applyFirstRunResult } from "../src/finops-first-run-view.js";
import { DECISION_SPINE, READING_ORDER } from "../src/finops-decision-interaction.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const STYLES = new URL("../src/evolution.css", import.meta.url);
const SITE_STYLES = new URL("../src/styles.css", import.meta.url);
const byId = (document, id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Contrast, computed rather than claimed.

const channel = (value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);

function luminance(hex) {
  const parts = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = parts.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Resolve a `--token` out of the stylesheet's `:root`, or return the literal. */
function token(css, name) {
  if (!name.startsWith("--")) return name;
  const match = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  assert.ok(match, `${name} is declared in the stylesheet`);
  return match[1].toLowerCase();
}

/**
 * The per-state chip table this surface ships.
 *
 * `ink`/`fill` are the chip's own pair; `edge` is the border, which is a
 * meaningful non-text indicator and so owes 3:1 against what surrounds it. The
 * page behind the chip is the panel's own wash at its lightest, which is what
 * `surround` is.
 */
const SURROUND = "#ffffff";
const BAND_TABLE = [
  { state: BAND_STATE.ahead, ink: "--import-ink", fill: "--import-wash", edge: "--import-accent" },
  { state: BAND_STATE.middle, ink: "#3b3b35", fill: "#f4f3ee", edge: "--ink-muted" },
  { state: BAND_STATE.behind, ink: "--state-warn-ink", fill: "--state-warn-wash", edge: "--state-warn-line" },
  { state: BAND_STATE.critical, ink: "--state-error-ink", fill: "--state-error-wash", edge: "--state-error-line" },
  { state: BAND_STATE.withheld, ink: "#5b5b55", fill: SURROUND, edge: "--ink-muted" },
];

test("every band state clears WCAG AA on its own pairing, withheld included", async () => {
  const css = await readFile(STYLES, "utf8");
  const measured = [];
  for (const row of BAND_TABLE) {
    const ink = token(css, row.ink);
    const fill = token(css, row.fill);
    const edge = token(css, row.edge);
    const text = contrast(ink, fill);
    measured.push({ state: row.state, text: text.toFixed(2), edge: contrast(edge, fill).toFixed(2) });
    // The chip's label is small uppercase mono, so it is body text: 4.5:1.
    assert.ok(text >= 4.5,
      `${row.state} label is ${text.toFixed(2)}:1 against its own fill, under the 4.5:1 floor`);
    // The border is a meaningful non-text indicator in both directions: it has
    // to separate the chip from the page and from its own fill.
    for (const [against, label] of [[SURROUND, "the page"], [fill, "its own fill"]]) {
      const ratio = contrast(edge, against);
      assert.ok(ratio >= 3,
        `${row.state} border is ${ratio.toFixed(2)}:1 against ${label}, under the 3:1 floor`);
    }
  }
  // The focus ring is a non-text indicator too, and it has to be visible over
  // the panel's wash as well as over the page. It is a site-wide token, so it
  // is read from the site-wide sheet.
  const ring = token(await readFile(SITE_STYLES, "utf8"), "--focus-ring");
  for (const behind of [SURROUND, token(css, "--import-wash")]) {
    assert.ok(contrast(ring, behind) >= 3,
      `the focus ring is under 3:1 against ${behind}`);
  }
  assert.equal(measured.length, 5, "five band states are measured, not four");
});

test("a band is a word and a shape before it is a colour, in every state", async () => {
  const css = await readFile(STYLES, "utf8");
  const shapes = new Set();
  for (const state of Object.values(BAND_STATE)) {
    const presentation = BAND_PRESENTATION[state];
    assert.ok(presentation, `${state} has a non-colour presentation`);
    assert.ok(presentation.shape.length > 0, `${state} has a glyph`);
    // Distinct per state: one glyph in five tints is a colour-only signal with
    // a decoration on it.
    assert.equal(shapes.has(presentation.shape), false, `${state} reuses another state's glyph`);
    shapes.add(presentation.shape);
    // The silhouette rule from the Claude Design foundations card: a measured
    // band is a dynamic signal and gets a filled wash; a withheld position is a
    // static classification of an absence and gets an outline.
    assert.equal(presentation.silhouette, state === BAND_STATE.withheld ? "outline" : "wash");
    assert.match(css, new RegExp(`\\.first-run-band\\[data-band="${state}"\\]`),
      `${state} has a rule of its own in the stylesheet`);
  }
});

test("the withheld position is a labelled band, never a blank or a dash", async () => {
  const page = await loadPage(PAGE, { modules: false });
  try {
    const { document } = page;
    const base = buildFirstRunResult();
    const withheld = {
      ...base,
      peer: {
        available: false,
        value: "No peer position: this org has not declared its size band and industry.",
        detail: base.peer.detail,
        band: { state: BAND_STATE.withheld, label: WITHHELD_BAND_LABEL, shape: "◇", silhouette: "outline" },
      },
      internal: {
        available: false,
        value: "No internal comparison: fewer than two departments cleared the sample floor.",
        detail: base.internal.detail,
        band: { state: BAND_STATE.withheld, label: WITHHELD_GAP_LABEL, shape: "◇", silhouette: "outline" },
      },
    };
    applyFirstRunResult(document, withheld);

    const chip = byId(document, FIRST_RUN_IDS.peerBand);
    assert.equal(chip.hidden, false, "the chip is drawn, not skipped");
    assert.equal(chip.dataset.band, BAND_STATE.withheld);
    assert.match(textOf(chip), /Position withheld/);
    // The reason stands in the position's own place, at the same point in the
    // reading order — not appended at the end and not only in a tooltip.
    const value = byId(document, FIRST_RUN_IDS.peerValue);
    assert.match(textOf(value), /^No peer position: /);
    assert.notEqual(textOf(value).trim(), "—");
    assert.notEqual(textOf(value).trim(), "");
    assert.doesNotMatch(textOf(value), /^Unavailable$/);
    // And the same rule one slot over, in the gap's own words.
    assert.match(textOf(byId(document, FIRST_RUN_IDS.internalBand)), /Gap not compared/);
    assert.match(textOf(byId(document, FIRST_RUN_IDS.internalValue)), /^No internal comparison: /);
  } finally {
    page.restore?.();
  }
});

test("the headline announces question, position, lagging team, then action", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const html = await readFile(PAGE, "utf8");
  const region = byId(document, FIRST_RUN_IDS.region);

  // The four steps of the announced order, as ids, and the order they are owed.
  const announced = [
    "finops-first-run-title",
    "finops-first-run-peer-heading",
    "finops-first-run-internal-heading",
    "finops-first-run-action-heading",
  ];
  const positions = announced.map((id) => {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > 0, `${id} is authored in the document`);
    return at;
  });
  assert.deepEqual([...positions].sort((a, b) => a - b), positions,
    "the DOM order is the announced order: question, position, lagging team, action");

  // The spec says the same thing, so a future edit to one fails against the
  // other rather than drifting quietly.
  assert.deepEqual(DECISION_SPINE.slice(6), ["peer", "internal", "action", "confidence", "provenance"]);

  // No CSS reordering: a visual order that differs from source order is exactly
  // the bug this test exists to prevent.
  const css = await readFile(STYLES, "utf8");
  const scoped = css.split("\n").filter((line) => line.includes(".first-run"));
  for (const line of scoped) {
    assert.doesNotMatch(line, /(^|[;{ ])order\s*:\s*-?\d/, `a .first-run rule reorders visually: ${line}`);
    assert.doesNotMatch(line, /flex-direction\s*:\s*[a-z-]*reverse/, `a .first-run rule reverses: ${line}`);
    assert.doesNotMatch(line, /grid-area\s*:/, `a .first-run rule places by grid-area: ${line}`);
  }

  // No level skip, and no `div` doing a heading's job: the region's own h2 with
  // h3 for each part under it, unbroken.
  const levels = READING_ORDER.filter((step) => step.level).map((step) => step.level);
  assert.equal(levels[0], 2, "the region's own heading is the h2 under the page h1");
  assert.deepEqual(new Set(levels.slice(1)), new Set([3]),
    "every part of the answer is an h3 under it — no skip to h4, no h2 sibling");
  for (const step of READING_ORDER.filter((entry) => entry.level)) {
    const heading = byId(document, step.id);
    assert.equal(heading.tagName.toLowerCase(), `h${step.level}`, `${step.key} is a real h${step.level}`);
    assert.equal(heading.closest(`#${FIRST_RUN_IDS.region}`), region,
      `${step.key} is inside the headline region`);
  }
});

test("the evidence disclosure toggles aria-expanded under Enter and under Space", async () => {
  const page = await loadPage(PAGE, { modules: false });
  try {
    const { document } = page;
    const { bindFirstRunDisclosure } = await importPageModule("/finops-first-run-view.js");
    bindFirstRunDisclosure(document);
    const summary = byId(document, FIRST_RUN_IDS.methodSummary);
    const details = byId(document, FIRST_RUN_IDS.method);

    // A real control, not a div with a click handler, and not one whose visible
    // text is contradicted by an aria-label.
    assert.equal(summary.tagName.toLowerCase(), "summary");
    assert.equal(summary.hasAttribute("aria-label"), false,
      "the visible summary text is the accessible name");
    assert.equal(summary.getAttribute("aria-expanded"), "false");
    assert.ok(textOf(summary).length > 0, "the control has a visible name");

    // Focus lands on it by keyboard, and the keys go to it rather than to a
    // handler that re-implements what the native control already does.
    summary.focus();
    assert.equal(document.activeElement, summary, "the control is focusable");

    pressEnter(document);
    assert.equal(details.hasAttribute("open"), true, "Enter opens the disclosure");
    assert.equal(summary.getAttribute("aria-expanded"), "true");
    assert.equal(details.dataset.disclosure, "expanded");

    pressSpace(document);
    assert.equal(details.hasAttribute("open"), false, "Space closes the disclosure");
    assert.equal(summary.getAttribute("aria-expanded"), "false");
    assert.equal(details.dataset.disclosure, "collapsed");
  } finally {
    page.restore?.();
  }
});

test("a repaint keeps the reader's focus, their open disclosure, and its state", async () => {
  const page = await loadPage(PAGE, { modules: false });
  try {
    const { document } = page;
    const { bindFirstRunDisclosure } = await importPageModule("/finops-first-run-view.js");
    bindFirstRunDisclosure(document);
    const summary = byId(document, FIRST_RUN_IDS.methodSummary);
    const details = byId(document, FIRST_RUN_IDS.method);

    // The reader opens the evidence and is standing on the control.
    summary.focus();
    pressEnter(document);
    assert.equal(document.activeElement, summary);
    assert.equal(details.hasAttribute("open"), true);

    // A fresh position lands.
    applyFirstRunResult(document, buildFirstRunResult(), { announce: true });

    assert.equal(document.activeElement, summary, "the repaint moved the reader's focus");
    assert.equal(details.hasAttribute("open"), true,
      "the repaint closed a disclosure the reader had opened");
    assert.equal(summary.getAttribute("aria-expanded"), "true",
      "aria-expanded drifted from what the reader has open");

    // Announced politely, with the band in it, and without taking focus.
    const live = byId(document, FIRST_RUN_IDS.live);
    assert.equal(live.getAttribute("aria-live"), "polite");
    assert.ok(textOf(live).length > 0, "the update is announced");
    assert.equal(document.activeElement, summary, "the announcement stole focus");
  } finally {
    page.restore?.();
  }
});

test("the headline holds at 320px: nothing is truncated, clipped, or ellipsed", async () => {
  const css = await readFile(STYLES, "utf8");
  const scoped = css.split("\n").filter((line) => /\.first-run-(band|value|detail|slot)/.test(line));
  assert.ok(scoped.length > 0);
  for (const line of scoped) {
    // A team name is a proper noun a reader has to be able to read. Wrapping is
    // fine; cutting it off is not.
    assert.doesNotMatch(line, /text-overflow\s*:\s*ellipsis/, `a headline rule ellipses: ${line}`);
    assert.doesNotMatch(line, /white-space\s*:\s*nowrap/, `a headline rule refuses to wrap: ${line}`);
    assert.doesNotMatch(line, /-webkit-line-clamp/, `a headline rule clamps lines: ${line}`);
  }
  // The long strings that actually arrive here — a department name, a band
  // label — are allowed to break rather than push the panel sideways.
  assert.match(css, /\.first-run-value \{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.first-run-band\[data-band\] \{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.first-run-band\[data-band\] \{[^}]*max-width:100%/);
  // One column below the two-column breakpoint, so a 220px slot minimum never
  // forces a second track into a 320px viewport.
  assert.match(css, /\.first-run-slots,\.first-run-actions,\.first-run-support \{ grid-template-columns:1fr; \}/);
});
