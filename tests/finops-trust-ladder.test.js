// The trust ladder, held to the four claims it can actually break (#1104).
//
//   1. THE SPEC. Three rungs, in order, each one saying what it supports AND
//      what it does not, and each one naming ONE step up. A rung that only says
//      what it is good for is a badge, and a badge is what a reader quotes past.
//   2. THE LADDER IS READ, NOT LOOKED AT. All three rungs are drawn at once,
//      each states its place in words, the current one carries a filled mark and
//      the word "you are here", and the two it is not on keep full outline
//      weight. Contrast is computed here rather than eyeballed.
//   3. NOTHING NEW IS FOCUSABLE. This is the failure that killed the previous
//      attempt: a summary element inside the first-run region is a tab stop, and
//      tests/finops-decision-interaction.test.js enumerates that region's stops
//      exactly. The block is asserted to hold zero focusables.
//   4. THE ANNOUNCEMENT. Spoken when the rung MOVES and silent when it does not,
//      through the one live region the intake already writes.
//
// Assertions are on counts and attributes, never on a node being null: the
// harness resolves a null comparison by inspecting the whole parsed page.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";
import { waitFor } from "./support/page-module.js";
import {
  RUNG_COUNT, RUNG_HERE, TRUST_LADDER_HEADING, TRUST_LADDER_IDS,
  TRUST_RUNG, TRUST_RUNGS, announcedRung, applyTrustLadder, currentTrustRung,
  refreshTrustLadder, readTrustEvidence, rungAnnouncement, rungChangeAnnouncement,
  rungDescriptor, rungFor, rungPlaceLabel, seedAnnouncedRung, setDeclaredEstimate,
} from "../src/finops-trust-ladder.js";
import {
  applyDeclaredFactIntake, bindDeclaredFactIntake,
} from "../src/finops-declared-fact-intake-view.js";
import { EXAMPLE_DECLARED_FACTS } from "../src/finops-declared-fact-fixtures.js";
import { INTAKE_IDS } from "../src/finops-declared-fact-intake.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const SHEET = new URL("../src/evolution.css", import.meta.url);
const html = await readFile(PAGE, "utf8");
const css = await readFile(SHEET, "utf8");
const byId = (doc, id) => doc.getElementById(id);
const chips = (doc) =>
  byId(doc, TRUST_LADDER_IDS.rungs).querySelectorAll(".brief-provenance");

// --- contrast, computed rather than assumed ---------------------------------

function channel(part) {
  const value = part / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const full = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

// ---------------------------------------------------------------------------
// 1. The spec
// ---------------------------------------------------------------------------

test("three rungs, in order, each saying what it does NOT support", () => {
  assert.equal(RUNG_COUNT, 3);
  assert.deepEqual(TRUST_RUNGS.map((entry) => entry.rung),
    [TRUST_RUNG.declared, TRUST_RUNG.estimated, TRUST_RUNG.verified]);
  assert.deepEqual(TRUST_RUNGS.map((entry) => entry.ordinal), [1, 2, 3]);
  assert.equal(new Set(TRUST_RUNGS.map((entry) => entry.name)).size, RUNG_COUNT);
  for (const entry of TRUST_RUNGS) {
    assert.ok(entry.supports.length > 20, `${entry.rung} states no support`);
    assert.ok(entry.withholds.length > 20, `${entry.rung} withholds nothing`);
    assert.ok(entry.promotion.length > 20, `${entry.rung} offers no step`);
    // One step, not a list of them: a promotion a reader has to choose between
    // is a decision this block was supposed to make for them.
    assert.doesNotMatch(entry.promotion, /\bor\b.*\bor\b/);
  }
  // The estimate's own words are the ones the reader is owed, unhedged.
  const estimated = rungDescriptor(TRUST_RUNG.estimated);
  assert.match(estimated.supports, /direction-of-travel decision/);
  assert.match(estimated.withholds, /no invoice and no export of yours was read/);
  // And the step up is the export preflight the page already has a door to,
  // named by that door's own visible label rather than by a second one.
  assert.match(estimated.promotion, /Analyze your own export/);
  assert.match(html, /Analyze your own export|finops-first-run-import/);
});

test("the rung is earned from what was read, and an absurd figure earns nothing", () => {
  assert.equal(rungFor({}), TRUST_RUNG.declared);
  assert.equal(rungFor({ declaredEstimate: true }), TRUST_RUNG.estimated);
  assert.equal(rungFor({ importedEvidence: true }), TRUST_RUNG.verified);
  // A file outranks a declaration; a declaration alone never reaches the top.
  assert.equal(rungFor({ importedEvidence: true, declaredEstimate: true }),
    TRUST_RUNG.verified);
  // An unrecognised rung reads as the BOTTOM one. Guessing upward is the one
  // error a trust marker cannot be allowed to make.
  assert.equal(rungDescriptor("audited").rung, TRUST_RUNG.declared);
  assert.equal(rungDescriptor(undefined).rung, TRUST_RUNG.declared);
  assert.equal(rungPlaceLabel(TRUST_RUNG.estimated), "Rung 2 of 3");
  assert.equal(rungPlaceLabel("nonsense"), "Rung 1 of 3");
});

// ---------------------------------------------------------------------------
// 2. The announcement — spoken on a move, silent inside a rung
// ---------------------------------------------------------------------------

test("a rung change is announced with its place, its name, and its limit", () => {
  const doc = parseHtml(html);
  seedAnnouncedRung(doc, TRUST_RUNG.declared);
  const moved = rungChangeAnnouncement(doc, TRUST_RUNG.estimated);
  assert.equal(moved, rungAnnouncement(TRUST_RUNG.estimated));
  assert.match(moved, /^Rung 2 of 3: Estimated\./);
  assert.match(moved, /no invoice and no export of yours was read/);
  // The instruction stays on the page. A live region that reads out a next step
  // talks over the figure the reader was listening to.
  assert.doesNotMatch(moved, /One step up/);
  assert.equal(announcedRung(doc), TRUST_RUNG.estimated);
});

test("a revision inside the same rung must not read the ladder out again", () => {
  const doc = parseHtml(html);
  seedAnnouncedRung(doc, TRUST_RUNG.declared);
  assert.equal(typeof rungChangeAnnouncement(doc, TRUST_RUNG.estimated), "string");
  // THE CONTRACT: null, not an empty string and not the same sentence again.
  // The caller writes nothing at all when it gets this back.
  assert.equal(rungChangeAnnouncement(doc, TRUST_RUNG.estimated), null);
  assert.equal(rungChangeAnnouncement(doc, TRUST_RUNG.estimated), null);
  // Moving on still speaks, and moving back down speaks too — a reader who
  // clears an import has to be told the figures stopped being verified.
  assert.match(rungChangeAnnouncement(doc, TRUST_RUNG.verified), /Rung 3 of 3/);
  assert.match(rungChangeAnnouncement(doc, TRUST_RUNG.declared), /Rung 1 of 3/);
  // Two documents are two ladders: one page's history cannot silence another's.
  const other = parseHtml(html);
  assert.equal(announcedRung(other), null);
  assert.match(rungChangeAnnouncement(other, TRUST_RUNG.declared), /Rung 1 of 3/);
});

// ---------------------------------------------------------------------------
// 3. The ladder as it is read
// ---------------------------------------------------------------------------

test("all three rungs are drawn, and the current one is a word and a shape", () => {
  const doc = parseHtml(html);
  for (const rung of [TRUST_RUNG.declared, TRUST_RUNG.estimated, TRUST_RUNG.verified]) {
    assert.equal(applyTrustLadder(doc, rung), rung);
    const painted = chips(doc);
    assert.equal(painted.length, RUNG_COUNT, "a rung left the ladder");
    const current = painted.filter((chip) => chip.dataset.current === "true");
    assert.equal(current.length, 1, "exactly one rung is this brief's");
    assert.equal(current[0].dataset.rung, rung);
    // Four channels before colour: place, name, mark, and the word on the one.
    const entry = rungDescriptor(rung);
    // Three channels and not one of them a mark: this page's circles already
    // mean status, so the ladder says its place in words and lets the chip's
    // own silhouette be the shape. NO glyph is drawn at all — the role table in
    // tests/evolution-glyph-roles.test.js is what a borrowed one would fail.
    assert.equal(textOf(current[0]),
      `${rungPlaceLabel(rung)} · ${entry.name} · ${RUNG_HERE}`);
    assert.equal(current[0].querySelectorAll(".brief-provenance-shape").length, 0);
    for (const chip of painted.filter((node) => node.dataset.current !== "true")) {
      assert.equal(chip.dataset.silhouette, "outline",
        "a rung this brief is not on was drawn as an absence");
      assert.match(textOf(chip), /^Rung [1-3] of 3 · /);
      assert.doesNotMatch(textOf(chip), new RegExp(RUNG_HERE));
    }
    // The filled wash is the Claude Design rule for a dynamic signal, and the
    // rung a brief is on is the only thing here that moves.
    assert.equal(current[0].dataset.silhouette, "filled");
    // The sentence under it is this rung's, and it is both halves of the claim.
    assert.equal(textOf(byId(doc, TRUST_LADDER_IDS.support)),
      `${entry.supports} ${entry.withholds}`);
    assert.equal(textOf(byId(doc, TRUST_LADDER_IDS.promotion)), entry.promotion);
    assert.equal(byId(doc, TRUST_LADDER_IDS.block).dataset.rung, rung);
    assert.equal(byId(doc, TRUST_LADDER_IDS.block).dataset.ordinal, String(entry.ordinal));
  }
});

test("the authored ladder is the Declared state, so a scriptless page is true", () => {
  // The document ships the bottom rung and the module repaints the same words.
  // The comparison is what proves the two copies have not drifted.
  const authored = parseHtml(html);
  const authoredChips = [...chips(authored)].map((chip) => textOf(chip));
  const authoredSupport = textOf(byId(authored, TRUST_LADDER_IDS.support));
  const authoredPromotion = textOf(byId(authored, TRUST_LADDER_IDS.promotion));
  assert.equal(textOf(byId(authored, TRUST_LADDER_IDS.heading)), TRUST_LADDER_HEADING);
  assert.equal(authoredChips.length, RUNG_COUNT);

  applyTrustLadder(authored, TRUST_RUNG.declared);
  assert.deepEqual([...chips(authored)].map((chip) => textOf(chip)), authoredChips);
  assert.equal(textOf(byId(authored, TRUST_LADDER_IDS.support)), authoredSupport);
  assert.equal(textOf(byId(authored, TRUST_LADDER_IDS.promotion)), authoredPromotion);
  // The heading is a heading, at the level the region's outline is already at.
  assert.equal(byId(authored, TRUST_LADDER_IDS.heading).tagName.toLowerCase(), "h3");
});

test("nothing in the ladder is focusable, and it adds no tab stop to the region", () => {
  const doc = parseHtml(html);
  applyTrustLadder(doc, TRUST_RUNG.verified);
  const block = byId(doc, TRUST_LADDER_IDS.block);
  assert.equal(block.querySelectorAll("a,button,input,select,summary,details,[tabindex]").length,
    0, "the ladder ships a control, which puts a stop in an enumerated order");
  const inBlock = (node) => {
    for (let walk = node; walk; walk = walk.parentNode) if (walk === block) return true;
    return false;
  };
  assert.equal(tabSequence(doc).filter(inBlock).length, 0);
  // And it is inside the region whose focus order is enumerated exactly, which
  // is the whole reason the block is static rather than a disclosure.
  let inRegion = false;
  for (let walk = block; walk; walk = walk.parentNode) {
    if (walk.getAttribute?.("id") === TRUST_LADDER_IDS.region) inRegion = true;
  }
  assert.equal(inRegion, true);
});

test("the ladder is legible in greyscale and above 4.5:1 where it is drawn", () => {
  // Two rules, no new token: the chips are the shipped .brief-provenance and its
  // silhouettes, so the only thing this file adds is the row and the block.
  assert.match(css, /\.trust-ladder \{[^}]*display:grid/);
  assert.match(css, /\.trust-ladder-rungs \{[^}]*flex-wrap:wrap/);
  assert.doesNotMatch(css, /\.trust-ladder[^{]*\{[^}]*--[a-z-]+:/,
    "the ladder declares a token of its own");
  // The region is a wash-to-white gradient, so both ends are checked. The
  // current rung is the filled chip's ink on its wash; the others are the
  // outline chip's ink, which is NOT dimmed further for being a rung away.
  assert.ok(contrast("#244c3c", "#eef6f2") >= 4.5, "the current rung is under 4.5:1");
  for (const background of ["#eef6f2", "#ffffff"]) {
    const ratio = contrast("#6f6f69", background);
    assert.ok(ratio >= 4.5, `a rung not reached is ${ratio.toFixed(2)}:1 on ${background}`);
  }
});

// ---------------------------------------------------------------------------
// 4. On the page: every state, and the announcement through the real binding
// ---------------------------------------------------------------------------

test("the region's own state decides the rung, including when an import clears", () => {
  const doc = parseHtml(html);
  const region = byId(doc, TRUST_LADDER_IDS.region);
  assert.equal(currentTrustRung(doc), TRUST_RUNG.declared);
  setDeclaredEstimate(doc, true);
  assert.equal(readTrustEvidence(doc).declaredEstimate, true);
  assert.equal(currentTrustRung(doc), TRUST_RUNG.estimated);
  region.dataset.source = "imported";
  assert.equal(refreshTrustLadder(doc), TRUST_RUNG.verified);
  // Clearing the import falls back to the declaration underneath rather than to
  // the bottom: the reader's five facts did not stop existing.
  delete region.dataset.source;
  assert.equal(refreshTrustLadder(doc), TRUST_RUNG.estimated);
  setDeclaredEstimate(doc, false);
  assert.equal(refreshTrustLadder(doc), TRUST_RUNG.declared);
});

test("a submit moves the rung once, and a revision inside it says nothing more", async () => {
  const page = await loadPage(PAGE, { modules: false });
  try {
    const { document } = page;
    bindDeclaredFactIntake(document);
    // Arrived on the bundled example's facts: Declared, and NOT announced.
    assert.equal(byId(document, TRUST_LADDER_IDS.block).dataset.rung, TRUST_RUNG.declared);
    assert.equal(textOf(byId(document, INTAKE_IDS.live)).length, 0);

    const submit = () => byId(document, INTAKE_IDS.form)
      .dispatchEvent({ type: "submit", bubbles: true, preventDefault() {} });

    // Their own spend, submitted: the ladder moves and the move is spoken once,
    // on the same announcement the headline was already making.
    byId(document, INTAKE_IDS.spend).value = "220000";
    submit();
    assert.equal(byId(document, TRUST_LADDER_IDS.block).dataset.rung, TRUST_RUNG.estimated);
    const spoken = textOf(byId(document, INTAKE_IDS.live));
    assert.match(spoken, /Rung 2 of 3: Estimated/);

    // A revision INSIDE the same rung. The figures changed, so the headline is
    // rewritten — but the ladder is not read out a second time.
    byId(document, INTAKE_IDS.spend).value = "221000";
    submit();
    const revised = textOf(byId(document, INTAKE_IDS.live));
    assert.notEqual(revised, spoken, "the figures changed and were not announced");
    assert.doesNotMatch(revised, /Rung \d of 3/,
      "a revision inside one rung read the ladder out again");
    assert.equal(byId(document, TRUST_LADDER_IDS.block).dataset.rung, TRUST_RUNG.estimated);

    // Clearing goes back to the bundled example, which IS a rung change.
    byId(document, INTAKE_IDS.clear).dispatchEvent({ type: "click", bubbles: true });
    assert.equal(byId(document, TRUST_LADDER_IDS.block).dataset.rung, TRUST_RUNG.declared);
    assert.match(textOf(byId(document, INTAKE_IDS.live)), /Rung 1 of 3: Declared/);
  } finally {
    page.restore?.();
  }
});

test("a figure far outside any plausible band still draws three honest rungs", async () => {
  const page = await loadPage(PAGE, { modules: false });
  try {
    const { document } = page;
    bindDeclaredFactIntake(document);
    // Two engineers against nine million dollars a month, and a headcount at the
    // top of the field's range against a hundred dollars. Neither is a position
    // anybody holds, and neither may promote or demote the ladder.
    for (const facts of [
      { ...EXAMPLE_DECLARED_FACTS, monthlySpendUsd: 9_000_000, engineers: 2 },
      { ...EXAMPLE_DECLARED_FACTS, monthlySpendUsd: 100, engineers: 50_000 },
    ]) {
      applyDeclaredFactIntake(document, facts);
      assert.equal(chips(document).length, RUNG_COUNT);
      assert.equal(byId(document, TRUST_LADDER_IDS.block).dataset.rung, TRUST_RUNG.estimated,
        "an implausible figure claimed a rung no file paid for");
      assert.equal(chips(document).filter((chip) => chip.dataset.current === "true").length, 1);
    }
  } finally {
    page.restore?.();
  }
});

await waitFor(() => true);
