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

import { loadPage, parseHtml, pressEnter, pressSpace, tabSequence, textOf } from "./support/browser.js";
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
import { NO_SCORE_YET, ROUTING_SLATE_REASONS, RULE_LIFECYCLE } from "../src/routing-slate.js";
import {
  LIFECYCLE_CHIPS, applyRoutingSlate, markRoutingSlateLoading,
} from "../src/routing-slate-view.js";

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
// The page name first, then the answer as one claim, with a hierarchy under it.
//
// A CTO opens this page with one question and used to meet a full screen of the
// product's name before it was answered. What is pinned below is the fix: the
// answer is the first content region after the h1 hero, the steps under it read
// as subordinate through TWO channels rather than a tint, and the confidence tier
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

test("the h1 hero is first and the answer is the first content region after it", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const order = regionIds(document);

  assert.deepEqual(order.slice(0, 2), ["finops-hero", STAND_IDS.region],
    "orientation and the single answer are not the first two regions");
  assert.equal(SPINE_STEPS[0], "finops-hero",
    "the manifest's reading order disagrees with the document's");
  // Source position rather than an index into `<main>`'s children: since #832
  // two of the supporting steps are folded INTO the answer's disclosure group,
  // so they are no longer siblings of the answer. What has to stay true is what
  // it always was — a reader meets the answer's own heading before any step that
  // supports it — and that is a claim about where the bytes are in the file.
  const html = await readFile(PAGE, "utf8");
  const answerAt = html.indexOf(`id="${STAND_IDS.question}"`);
  assert.ok(answerAt > 0, "the answer's own heading is no longer authored on the page");
  for (const id of SUPPORTING) {
    assert.ok(html.indexOf(`id="${id}"`) > answerAt,
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

  const headings = document.querySelectorAll("h1, h2");
  assert.equal(headings[0]?.tagName, "H1", "an h2 is emitted before the page h1");
  assert.equal(headings.filter((heading) => heading.tagName === "H1").length, 1,
    "the page must expose one h1");
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
  assert.match(authored,
    /The Bundled synthetic example uses invented data\. Results will appear when preparation is complete\.$/,
    "the pre-analysis description must name what is being prepared without implying an error");
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

// ---------------------------------------------------------------------------
// The routing policy section (#1140).
//
// A reader has to tell four things apart in one pass and without reading prose:
// which rules are still PROPOSALS, which are SHIPPED, which are SCORED, and
// which single one to act on next. Each is a way the section could look right on
// a designer's screen and be unreadable off it:
//
//   1. The lifecycle is a WORD before it is a colour, and the three states stay
//      separable in greyscale by silhouette and by fill area. Only `scored`
//      carries a number, because only `scored` measured one.
//   2. Every disclosure in the section is a real control, keyboard-operable,
//      reporting the state it is actually in.
//   3. NOTHING that announces status sits inside a collapsed disclosure. A real
//      browser hides a closed subtree from the accessibility tree and this
//      harness reads straight through it, so the check is on the DOM SHAPE, not
//      on whether the text happens to be findable here.
//   4. Rank 1 and the one next action precede the rest of the list.
// ---------------------------------------------------------------------------

/** One flagged org unit, in the shape the down-routing rule publishes it. */
const routingUnit = (name, recoverableUsd, trend = {}) => ({
  name,
  spendUsd: recoverableUsd * 2,
  trendAvailable: false,
  trendReason: "Only one period has been read for this org unit.",
  downRouting: {
    unitLabel: name,
    flagged: true,
    recoverableUsd,
    observedMinorPerMillionTokens: 2941,
    decisionReason: `${name} is priced above the premium-tier floor.`,
    confidence: { level: "Medium", reasons: [] },
    workedExample: [{
      step: "recoverable", expression: `${recoverableUsd * 2} − ${recoverableUsd}`,
      value: recoverableUsd,
    }],
  },
  ...trend,
});

const routingEnvelope = (units) => ({
  period: "2026-06-01 to 2026-07-01", modelRouting: null, rankedDepartments: units,
});

/** The retained commitment that makes a rule "shipped": it names an org unit. */
const commitmentFor = (department) => ({ department, actionId: "route-short-lookups" });

/**
 * True when the accessibility tree of a real browser would not reach this node:
 * some ancestor is a closed disclosure and the node is not in that disclosure's
 * own summary, which stays rendered.
 */
function insideCollapsedDisclosure(node) {
  let child = node;
  for (let up = node?.parentNode; up; child = up, up = up.parentNode) {
    if (up.tagName === "DETAILS" && !up.hasAttribute("open") && child.tagName !== "SUMMARY") {
      return true;
    }
  }
  return false;
}

/** Every lifecycle chip painted into the routing-policy section. */
const routingChips = (document) =>
  document.querySelectorAll(".import-chip").filter((chip) => chip.closest("#routing-slate"));

async function paintRouting(analysis, options = {}) {
  const { document } = await loadPage(PAGE, { scripts: false });
  return { document, slate: applyRoutingSlate(document, analysis, options) };
}

test("each lifecycle chip states itself in a word, and only a scored rule shows a score", async () => {
  // One envelope, two states at once: Atlas is committed and its unit publishes
  // a measured change; nothing was committed for the other two. Rank order is
  // untouched by any of it.
  const { document, slate } = await paintRouting(
    routingEnvelope([
      routingUnit("Atlas Platform", 9000, { trendAvailable: true, spendChangeUsd: -1204.9 }),
      routingUnit("Cinder Research", 6000, { trendAvailable: true, spendChangeUsd: null }),
      routingUnit("Quartz Analytics", 3000),
    ]),
    { commitment: commitmentFor("Atlas Platform") },
  );
  assert.deepEqual(slate.rules.map((rule) => rule.lifecycle),
    [RULE_LIFECYCLE.SCORED, RULE_LIFECYCLE.PROPOSED, RULE_LIFECYCLE.PROPOSED],
    "a commitment names one org unit and moves that unit's rule only");

  const chips = routingChips(document);
  assert.ok(chips.length >= slate.rules.length,
    `every rule carries a lifecycle chip; got ${chips.length} for ${slate.rules.length} rules`);

  const seen = new Set();
  for (const chip of chips) {
    const state = chip.dataset.status;
    const expected = LIFECYCLE_CHIPS[state];
    assert.ok(expected, `${state} is not one of the three lifecycle states`);
    seen.add(state);

    // The word is the whole meaning: the mark is decoration a screen reader
    // never hears, and deleting the tint loses nothing.
    const shape = chip.querySelectorAll(".import-chip-shape");
    for (const mark of shape) assert.equal(mark.getAttribute("aria-hidden"), "true");
    assert.ok(textOf(chip).includes(expected.label),
      `a chip in state ${state} must carry the word "${expected.label}"`);

    // Silhouette and fill area, so the three separate in greyscale at 11px:
    // outline for the static classification, filled wash for the live signals,
    // and one step each off the circle ramp.
    assert.equal(chip.dataset.kind, expected.kind);
    assert.equal(textOf(shape[0]), expected.shape);

    // Only a scored rule shows a figure, and it says which way it went in words
    // rather than in a minus sign a reader has to spot.
    const values = chip.querySelectorAll(".import-chip-value").map(textOf);
    if (state === RULE_LIFECYCLE.SCORED) {
      assert.deepEqual(values, ["$1,204 lower"],
        "a scored rule carries its own measured change as the chip's value");
    } else {
      assert.deepEqual(values, [],
        `a ${state} rule must not show a score-shaped number beside a modelled figure`);
    }
  }
  assert.deepEqual([...seen].sort(), ["proposed", "scored"]);

  // The three chips differ in word, in silhouette and in mark, which is what
  // makes them separable with no colour at all.
  const table = Object.values(LIFECYCLE_CHIPS);
  assert.equal(new Set(table.map((chip) => chip.label)).size, 3);
  assert.equal(new Set(table.map((chip) => chip.shape)).size, 3);
  assert.equal(new Set(table.map((chip) => `${chip.kind}/${chip.shape}`)).size, 3);
});

test("a shipped rule with no measurable outcome says so instead of scoring itself", async () => {
  const { document, slate } = await paintRouting(
    routingEnvelope([routingUnit("Cinder Research", 6000, { trendAvailable: true })]),
    { commitment: commitmentFor("Cinder Research") },
  );
  assert.equal(slate.rules[0].lifecycle, RULE_LIFECYCLE.SHIPPED);
  assert.equal(slate.rules[0].observedChangeUsd, null,
    "a missing figure is no score, never a zero a reader would read as no change");
  const chip = routingChips(document)[0];
  assert.ok(textOf(chip).includes("Shipped"));
  assert.deepEqual(chip.querySelectorAll(".import-chip-value").map(textOf), []);
  assert.ok(textOf(byId(document, "routing-slate-body")).includes(NO_SCORE_YET),
    "the reason there is no score is stated, not left as an absence");
});

test("every routing-policy disclosure is keyboard-operable and reports its own state", async () => {
  const { document, slate } = await paintRouting(loadExampleDataset());
  const summaries = document.querySelectorAll("summary")
    .filter((node) => node.closest("#routing-slate"));
  assert.equal(summaries.length, slate.rules.length, "one disclosure per rule, rank 1 included");

  const sequence = tabSequence(document);
  for (const summary of summaries) {
    const details = summary.closest("details");
    assert.ok(sequence.includes(summary), `${textOf(summary)} is not reachable by Tab`);
    assert.equal(summary.getAttribute("aria-expanded"), "false");
    assert.equal(details.hasAttribute("open"), false);

    summary.focus();
    pressEnter(document);
    assert.equal(details.hasAttribute("open"), true, "Enter expands");
    assert.equal(summary.getAttribute("aria-expanded"), "true",
      "the announced state must track the state the element is actually in");

    pressSpace(document);
    assert.equal(details.hasAttribute("open"), false, "Space collapses");
    assert.equal(summary.getAttribute("aria-expanded"), "false");
  }

  // A summary gets no focus ring from the UA once this stylesheet has reset it,
  // so the control declares its own.
  const css = await readFile(STYLES, "utf8");
  assert.match(css,
    /\.completeness-detail>summary:focus-visible \{[^}]*outline:3px solid var\(--focus-ring\)/);
});

test("no status text in the routing-policy section sits inside a collapsed disclosure", async () => {
  const { document } = await paintRouting(loadExampleDataset());
  const status = byId(document, "routing-slate-status");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(insideCollapsedDisclosure(status), false,
    "the section's status line is announced, so it may never sit behind a disclosure");

  const announcing = [...document.querySelectorAll("[role]"), ...document.querySelectorAll("[aria-live]")]
    .filter((node) => node.closest?.("#routing-slate"))
    .filter((node) => ["status", "alert", "log"].includes(node.getAttribute("role"))
      || node.hasAttribute("aria-live"));
  assert.ok(announcing.length > 0, "the section must announce its state somewhere");
  for (const node of announcing) {
    assert.equal(insideCollapsedDisclosure(node), false,
      `a live region nested in a collapsed disclosure is never heard: ${textOf(node).slice(0, 60)}`);
  }

  // The lifecycle chips are the other thing a reader must never open something
  // to reach: every one of them is on a line that is rendered while closed.
  const chips = routingChips(document);
  assert.deepEqual(chips.filter(insideCollapsedDisclosure).map(textOf), [],
    "each rule states its lifecycle on the line a reader scans, not inside its evidence");
});

test("rank 1 and the one next action precede the rest of the routing list", async () => {
  const { document, slate } = await paintRouting(loadExampleDataset());
  const body = byId(document, "routing-slate-body");
  const order = body.childElements.map((node) => node.className);
  assert.deepEqual(order.slice(0, 4),
    ["answer-figure", "answer-figure-direction", "completeness-detail", "action-list"],
    "rank 1 at the numeral role, then the action, then rank 1's evidence, then the list");

  const lead = body.childElements[0];
  assert.equal(lead.dataset.rank, "1");
  assert.ok(textOf(lead).includes(slate.lead.source), "rank 1 names its own source");
  assert.ok(textOf(body.childElements[1]).includes(slate.nextAction),
    "the prioritized action is the second element, not buried in the list");

  // Ranks 2..n are the list, and rank 1 is not repeated inside it.
  const ranks = document.querySelectorAll(".completeness-detail")
    .filter((node) => node.closest(".action-list"))
    .map((node) => node.dataset.rank);
  assert.deepEqual(ranks, slate.rules.slice(1).map((rule) => String(rule.rank)));
  assert.equal(slate.nextActionRank, 1, "with nothing committed the next move is rank 1 itself");
});

test("the next move is the best rule still proposed, never one already shipped", async () => {
  const { document, slate } = await paintRouting(
    routingEnvelope([
      routingUnit("Atlas Platform", 9000, { trendAvailable: true, spendChangeUsd: -500 }),
      routingUnit("Cinder Research", 6000),
    ]),
    { commitment: commitmentFor("Atlas Platform") },
  );
  assert.equal(slate.nextActionRank, 2, "rank 1 is already scored, so it is not the next move");
  const direction = textOf(byId(document, "routing-slate-body").childElements[1]);
  assert.ok(direction.startsWith("Do this first:"));
  assert.ok(direction.includes("Cinder Research"));

  // Rank is still what a move is worth: committing to one does not reshuffle it.
  assert.deepEqual(slate.rules.map((rule) => rule.rank), [1, 2]);
  assert.equal(slate.lead.source, "Atlas Platform");
});

test("the routing policy draws loading, empty, error, and implausible-extreme states alike", async () => {
  // LOADING — the rules on screen are the previous envelope's and are left
  // alone; only the status line moves, and it says the ranking is not recomputed.
  const loading = await paintRouting(loadExampleDataset());
  const before = byId(loading.document, "routing-slate").dataset.ruleCount;
  markRoutingSlateLoading(loading.document);
  assert.equal(byId(loading.document, "routing-slate-status").dataset.state, "loading");
  assert.match(textOf(byId(loading.document, "routing-slate-status")), /Reading the analysis/);
  assert.equal(byId(loading.document, "routing-slate").getAttribute("aria-busy"), "true");
  assert.equal(byId(loading.document, "routing-slate").dataset.ruleCount, before,
    "a read in progress does not blank the ranking a reader is looking at");

  // EMPTY — real copy naming why, not a blank region.
  const empty = await paintRouting(routingEnvelope([]));
  assert.equal(empty.slate.state, "unavailable");
  assert.equal(byId(empty.document, "routing-slate-status").dataset.state, "unavailable");
  assert.ok(textOf(byId(empty.document, "routing-slate-body"))
    .includes(ROUTING_SLATE_REASONS.no_candidates));

  // ERROR — an envelope whose candidate lists are the wrong shape is a broken
  // input, and gets a different sentence from "nothing qualified".
  const failed = await paintRouting({ period: "2026-06", rankedDepartments: "not a list" });
  assert.equal(failed.slate.state, "error");
  assert.equal(byId(failed.document, "routing-slate").dataset.state, "error");
  assert.ok(textOf(byId(failed.document, "routing-slate-status"))
    .includes("could not be read as a routing policy"));
  assert.ok(textOf(byId(failed.document, "routing-slate-body"))
    .includes(ROUTING_SLATE_REASONS.unreadable));

  // EXTREMES — a very long name, a very large figure, a negative score, and far
  // more rules than fit one screen. None of them may collapse the lifecycle
  // distinction or push rank 1 out of first position.
  const longName = `Department ${"of Extremely Long Organisational Naming ".repeat(6)}`;
  const extreme = await paintRouting(routingEnvelope([
    routingUnit(longName, 9_000_000_000, { trendAvailable: true, spendChangeUsd: -12_345_678.9 }),
    ...Array.from({ length: 40 }, (unused, index) =>
      routingUnit(`Unit ${String(index).padStart(2, "0")}`, 40 - index)),
  ]), { commitment: commitmentFor(longName) });

  assert.equal(extreme.slate.rules.length, 41);
  assert.equal(extreme.slate.lead.source, longName, "the largest figure is still rank 1");
  assert.equal(extreme.slate.lead.lifecycle, RULE_LIFECYCLE.SCORED);
  assert.equal(extreme.slate.nextActionRank, 2, "rank 1 is scored, so rank 2 is the move");

  const body = byId(extreme.document, "routing-slate-body");
  assert.equal(body.childElements[0].dataset.rank, "1");
  assert.ok(textOf(body.childElements[0]).includes(longName),
    "a long name wraps rather than being cut out of the loudest element");
  assert.deepEqual(body.childElements[0].querySelectorAll(".import-chip-value").map(textOf),
    ["$12,345,678 lower"]);

  // One chip per rule on its scannable line, plus rank 1's own in the figure,
  // and every one of them still reachable without opening anything.
  const chips = routingChips(extreme.document);
  assert.equal(chips.length, extreme.slate.rules.length + 1);
  assert.deepEqual(chips.filter(insideCollapsedDisclosure).map(textOf), []);

  // Long strings wrap in the list rather than pushing the panel sideways.
  assert.match(await readFile(STYLES, "utf8"), /\.action-list \{[^}]*overflow-wrap:anywhere/);
});
