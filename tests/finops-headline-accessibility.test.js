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
import {
  STAND_DISCLOSURE_ORDER, STAND_IDS, STAND_MOUNTED_DISCLOSURES, STAND_QUESTION,
  composeStandHeadline,
} from "../src/finops-stand.js";
import {
  applyStandHeadline, standClaimSentence, standDisclosureIds,
} from "../src/finops-stand-view.js";
import { ANSWER_SPINE, ROLE, liveRegionIds } from "../src/finops/answer-spine-view.js";
import { loadExampleDataset } from "../src/example-dataset.js";

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

// ---------------------------------------------------------------------------
// #727 — the answer, first, as one claim, with a hierarchy under it.
//
// A CTO opens this page with one question and used to meet a full screen of the
// product's name before it was answered. What is pinned below is the fix: the
// answer is the first region of the document, the steps under it read as
// subordinate through TWO channels rather than a tint, and the confidence tier
// and evidence class are announced as part of the claim instead of as two
// badges a reader meets some moments later.

/** The spine in reading order: the headline, then the steps that support it. */
const SPINE_STEPS = liveRegionIds(ANSWER_SPINE);
/** The three supporting steps a lead reads immediately under the answer. */
const SUPPORTING = ANSWER_SPINE
  .filter((entry) => entry.role === ROLE.step)
  .map((entry) => entry.id)
  .filter((id) => SPINE_STEPS.indexOf(id) > SPINE_STEPS.indexOf(STAND_IDS.region))
  .slice(0, 3);

/** The ids of `#main-content`'s own element children, in document order. */
const regionIds = (document) => (document.getElementById("main-content").children ?? [])
  .filter((node) => node?.nodeType === 1 && node.id).map((node) => node.id);

test("the answer is the first region of the page, ahead of the hero and every step", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const order = regionIds(document);

  assert.equal(order[0], STAND_IDS.region,
    "the headline is not the first region a reader meets in the landmark");
  assert.equal(SPINE_STEPS[0], STAND_IDS.region,
    "the manifest's reading order disagrees with the document's");
  for (const id of ["finops-hero", ...SUPPORTING]) {
    assert.ok(order.indexOf(id) > order.indexOf(STAND_IDS.region),
      `#${id} is authored above the answer it supports`);
  }

  // Source order IS focus order and announcement order. Neither a rewrite of the
  // visual order nor a positive tab stop is allowed to make them disagree — that
  // is the whole reason the fix was a DOM move rather than a stylesheet rule.
  const css = await readFile(STYLES, "utf8");
  for (const line of css.split("\n").filter((row) => /\.stand|data-subordinate|\.finops-hero/.test(row))) {
    assert.doesNotMatch(line, /(^|[;{ ])order\s*:\s*-?\d/, `a spine rule reorders visually: ${line}`);
    assert.doesNotMatch(line, /flex-direction\s*:\s*[a-z-]*reverse/, `a spine rule reverses: ${line}`);
  }
  for (const node of document.querySelectorAll("[tabindex]")
    .filter((candidate) => candidate.closest("#main-content"))) {
    assert.ok(Number(node.getAttribute("tabindex")) <= 0,
      `#${node.id || node.className} takes a positive tabindex out of source order`);
  }
});

test("every id is unique and every ARIA reference in the document resolves", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  // The collapse passes on this page merged regions that each brought their own
  // ids, and an `aria-labelledby` pointing at a duplicated or deleted id is a
  // conformance failure that looks exactly like working markup.
  const seen = new Map();
  for (const node of document.querySelectorAll("[id]")) {
    assert.equal(seen.has(node.id), false, `#${node.id} is declared more than once`);
    seen.set(node.id, node);
  }
  // Scoped to what a reader can actually reach in the shipped document. A region
  // that ships `hidden` and is composed on demand — #recurring-review-workspace
  // is the one — brings its own heading with its content, so its reference
  // resolves at exactly the moment the region exists to be announced.
  for (const attribute of ["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns"]) {
    for (const node of document.querySelectorAll(`[${attribute}]`)
      .filter((candidate) => !candidate.closest("[hidden]"))) {
      for (const id of node.getAttribute(attribute).trim().split(/\s+/).filter(Boolean)) {
        assert.ok(seen.has(id),
          `${attribute} on #${node.id || node.tagName} points at "${id}", which is not in the document`);
      }
    }
  }
});

test("the headline is announced as one claim: question, number, confidence, evidence", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const region = byId(document, STAND_IDS.region);

  // Named by its question, described by the whole claim. One arrival, one
  // sentence — not a claim here and two unattached badges further down.
  assert.equal(region.getAttribute("aria-labelledby"), STAND_IDS.question);
  assert.equal(region.getAttribute("aria-describedby"), STAND_IDS.claim);
  const authored = textOf(byId(document, STAND_IDS.claim));
  assert.ok(authored.length > 0, "the description ships empty, so arriving announces a bare name");
  // …and it states no confidence tier, because before anything is read there is
  // no claim to be confident about. A null tier in the region's own description
  // announces a placeholder figure to a reader who has not asked for one; the
  // paint below writes the real tier in the moment there is one.
  assert.doesNotMatch(authored, /Confidence not stated/,
    "the pre-analysis description announces a null confidence tier");
  // One sentence after the question, and it both names the read in progress and
  // says what replaces it. The sentence it replaced — "Nothing has been read
  // yet, so this claim rests on nothing" — contradicted the line above it and
  // announced an integrity warning to a visitor who had claimed nothing.
  assert.match(authored, /Still reading the Bundled synthetic example; the numbers below fill in when it finishes\.$/,
    "the pre-analysis description no longer says what is being read and what replaces it");
  assert.doesNotMatch(authored, /rests on nothing/,
    "the pre-analysis description contradicts the sentence before it");

  // And after a real paint it is the four values the visible slots carry.
  const headline = composeStandHeadline({ analysis: loadExampleDataset(), source: "example" });
  applyStandHeadline(document, headline);
  const spoken = textOf(byId(document, STAND_IDS.claim));
  assert.equal(spoken, standClaimSentence(headline));
  assert.ok(spoken.startsWith(STAND_QUESTION), "the announcement does not open with the question");
  for (const part of [headline.answer, headline.entitlement.confidence, headline.entitlement.evidence]) {
    assert.ok(spoken.includes(part.replace(/\.$/, "")),
      `the announcement drops "${part}", so the claim is heard without what bounds it`);
  }
  // The indicators are still words on the surface — the description is a second
  // channel for them, never the only one, and never a colour standing in.
  assert.equal(textOf(byId(document, STAND_IDS.confidence)), headline.entitlement.confidence);
  assert.equal(textOf(byId(document, STAND_IDS.evidence)), headline.entitlement.evidence);
});

test("the claim survives a long question, an extreme figure, and the lowest tier", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  // Generated here rather than committed: one unbroken 300-character token is
  // the shape a pasted department key actually arrives in.
  const question = `Where do we stand on ${"a".repeat(300)}?`;
  const extreme = {
    question,
    answer: "Recoverable spend is -$1,204,559,873.00 across 0 analyzed tasks.",
    label: "Bundled synthetic example",
    entitlement: {
      available: true, evidenceClass: "synthetic-cohort", confidenceTier: "low",
      confidence: "Low confidence", evidence: "Hand-authored synthetic cohort boundaries",
    },
    position: { available: false, value: "Not yet compared", basis: "" },
    recoverable: { available: true, value: "-$1,204,559,873.00", basis: "" },
    team: { available: false, name: "No department named yet", detail: "" },
    action: { available: false }, disclosures: [], positioned: false, source: "example",
  };
  applyStandHeadline(document, extreme);

  const spoken = textOf(byId(document, STAND_IDS.claim));
  assert.ok(spoken.length > 0, "an extreme headline left the region with an empty description");
  assert.ok(spoken.includes(question), "the long question is dropped from the announcement");
  assert.ok(spoken.includes("Low confidence"), "the lowest tier is not announced");
  assert.ok(spoken.includes("-$1,204,559,873.00"), "the figure is not announced");
  // Withheld is drawn, not blanked, and the region says which state it is in.
  assert.equal(byId(document, STAND_IDS.region).dataset.position, "withheld");
  assert.equal(byId(document, STAND_IDS.withheld).hidden, false);

  // Nothing in the region is allowed to cut a value off rather than wrap it, and
  // the three slots the extremes actually land in say so explicitly.
  const css = await readFile(STYLES, "utf8");
  for (const line of css.split("\n").filter((row) => row.startsWith(".stand"))) {
    assert.doesNotMatch(line, /text-overflow\s*:\s*ellipsis/, `a headline rule ellipses: ${line}`);
    assert.doesNotMatch(line, /white-space\s*:\s*nowrap/, `a headline rule refuses to wrap: ${line}`);
    assert.doesNotMatch(line, /-webkit-line-clamp/, `a headline rule clamps lines: ${line}`);
  }
  for (const selector of ["\\.stand-head h2", "\\.stand-figure-value", "\\.stand-entitlement-item"]) {
    assert.match(css, new RegExp(`${selector} \\{[^}]*overflow-wrap:anywhere`),
      `${selector} pushes the panel sideways instead of wrapping`);
  }
});

test("every disclosure names what it reveals and reports its state in both of them", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  // `STAND_MOUNTED_DISCLOSURES` are built by finops-stand-view.js rather than
  // authored here — see the constant for why — so they carry no markup a static
  // read could check. tests/finops-stand-surface.test.js holds them to the same
  // naming and state rules against the booted page.
  for (const key of STAND_DISCLOSURE_ORDER.filter((id) => !STAND_MOUNTED_DISCLOSURES.includes(id))) {
    const ids = standDisclosureIds(key);
    const summary = byId(document, ids.summary);
    const name = textOf(summary);

    // The accessible name is the visible text, and it states the thing behind
    // the control rather than the interaction.
    assert.equal(summary.hasAttribute("aria-label"), false, `${key} overrides its visible name`);
    assert.ok(name.length > 0, `${key} has no accessible name`);
    assert.doesNotMatch(name, /^\s*(show|hide|read)\s*(more|less|details)?\s*$/i,
      `${key} is named "${name}", which does not say what it reveals`);
    assert.ok(textOf(byId(document, ids.heading)).length > 8,
      `${key} does not carry a question of its own`);

    // State on the control itself, and a pointer to a real, unique, present id.
    assert.equal(summary.getAttribute("aria-expanded"), "false");
    assert.equal(summary.getAttribute("aria-controls"), ids.list);
    assert.ok(byId(document, ids.list), `${key} controls "${ids.list}", which is not in the document`);

    // The summary IS the control. A button inside it would be a second control
    // in the same tab stop, with the keyboard going to whichever won.
    assert.deepEqual(summary.querySelectorAll("button,a,input,select,textarea"), [],
      `${key} nests an interactive element inside its summary`);
  }
});

test("opening a disclosure leaves the reader standing on the control they pressed", async () => {
  const page = await loadPage(PAGE, { modules: false });
  try {
    const { document } = page;
    const { bindStandDisclosures } = await importPageModule("/finops-stand-view.js");
    bindStandDisclosures(document);
    const ids = standDisclosureIds(STAND_DISCLOSURE_ORDER[0]);
    const summary = byId(document, ids.summary);
    const details = byId(document, ids.details);

    summary.focus();
    assert.equal(document.activeElement, summary);
    pressEnter(document);
    assert.equal(details.hasAttribute("open"), true, "Enter did not expand the disclosure");
    assert.equal(summary.getAttribute("aria-expanded"), "true");
    assert.equal(document.activeElement, summary,
      "expanding moved focus away from the answer and the control that opened it");

    pressEnter(document);
    assert.equal(summary.getAttribute("aria-expanded"), "false",
      "aria-expanded drifted from what the reader has open");
    assert.equal(document.activeElement, summary);
  } finally {
    page.restore?.();
  }
});

test("the four spine steps are one hierarchy, and no de-emphasis is a tint alone", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const css = await readFile(STYLES, "utf8");

  // The headline is not subordinate to anything; every step under it is, and
  // says so in the markup rather than only in a stylesheet.
  assert.equal(byId(document, STAND_IDS.region).dataset.subordinate, undefined);
  assert.equal(SUPPORTING.length, 3, "the spine no longer declares three steps under the answer");
  for (const id of ["finops-hero", ...SUPPORTING]) {
    assert.equal(byId(document, id).dataset.subordinate, "true",
      `#${id} sits under the answer but is not marked subordinate`);
  }

  // Two rungs, both already in this stylesheet, and they do not overlap: the
  // headline's floor is above the subordinate ceiling at every viewport.
  const rung = (selector) => {
    const match = new RegExp(`${selector}[^}]*font-size:clamp\\((\\d+)px,[^,]+,(\\d+)px\\)`).exec(css);
    assert.ok(match, `${selector} has no clamped rung`);
    return { min: Number(match[1]), max: Number(match[2]) };
  };
  const headline = rung("\\.stand-head h2 \\{");
  const subordinate = rung("\\[data-subordinate=\"true\"\\] h2 \\{");
  assert.ok(subordinate.max < headline.min,
    `the subordinate rung tops out at ${subordinate.max}px, at or above the headline's ${headline.min}px floor`);
  // Both steps that size their own heading later in this file are named at a
  // specificity that wins, or the rung above quietly loses the cascade to them.
  for (const scoped of ["\\.first-run\\[data-subordinate=\"true\"\\] \\.first-run-head h2",
    "\\.next-step\\[data-subordinate=\"true\"\\] \\.next-step-head h2"]) {
    assert.match(css, new RegExp(`${scoped}[,\\s][^}]*font-size:clamp\\(${subordinate.min}px`),
      `a step's own heading rule outranks the subordinate rung: ${scoped}`);
  }

  // And the demotion changes a surface as well as a size. A step that only lost
  // a tint would read as identical to the headline in greyscale and in print.
  const surface = /\.next-step\[data-subordinate="true"\] \{([^}]*)\}/.exec(css);
  assert.ok(surface, "no surface rule distinguishes a supporting step");
  assert.match(surface[1], /background:/, "the subordinate treatment changes no surface");
  assert.match(surface[1], /border-left-width:/, "the subordinate treatment changes no border");
  // The headline keeps the filled wash — the silhouette rule from
  // design-system/claude-design/review-08-foundations.html: a filled wash is a
  // dynamic signal, an outline is a static classification.
  assert.match(css, /\.stand \{[^}]*background:linear-gradient/);
});

test("the hierarchy's ink clears AA everywhere it lands, headline and subordinate alike", async () => {
  const css = await readFile(STYLES, "utf8");
  // `--ink` is not declared anywhere in this repository, so `color:var(--ink)`
  // is invalid at computed-value time and these slots inherit the root ink.
  // That is what is measured here, because that is what a reader sees.
  const ROOT_INK = "#171713";
  const WASH = token(css, "--import-wash");      // the headline's own surface
  const PAGE_SURFACE = "#ffffff";                 // every subordinate step's
  const measured = [];
  const pairs = [
    { what: "headline question", ink: ROOT_INK, on: WASH, floor: 4.5 },
    { what: "headline metric", ink: ROOT_INK, on: WASH, floor: 4.5 },
    { what: "headline basis copy", ink: token(css, "--ink-muted"), on: WASH, floor: 4.5 },
    { what: "evidence + confidence indicator", ink: token(css, "--import-ink"), on: WASH, floor: 4.5 },
    { what: "indicator, degraded", ink: token(css, "--state-warn-ink"), on: WASH, floor: 4.5 },
    { what: "subordinate step heading", ink: ROOT_INK, on: PAGE_SURFACE, floor: 4.5 },
    { what: "subordinate step copy", ink: token(css, "--ink-muted"), on: PAGE_SURFACE, floor: 4.5 },
    // The subordinate rail is a meaningful non-text indicator, so it owes 3:1
    // against the surfaces on both sides of it.
    { what: "subordinate rail on white", ink: token(css, "--ink-muted"), on: PAGE_SURFACE, floor: 3 },
    { what: "subordinate rail on the page", ink: token(css, "--ink-muted"), on: "#f3f1eb", floor: 3 },
  ];
  for (const pair of pairs) {
    const ratio = contrast(pair.ink, pair.on);
    measured.push(`${pair.what}: ${ratio.toFixed(2)}:1`);
    assert.ok(ratio >= pair.floor,
      `${pair.what} is ${ratio.toFixed(2)}:1 against ${pair.on}, under the ${pair.floor}:1 floor`);
  }
  assert.equal(measured.length, pairs.length);
  // De-emphasised is a rung and a surface, never a faded ink: the subordinate
  // steps are held to the same floor as the headline above them.
  assert.doesNotMatch(css, /\[data-subordinate="true"\][^{]*\{[^}]*opacity:/,
    "a step is de-emphasised with opacity, which takes its contrast with it");
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
