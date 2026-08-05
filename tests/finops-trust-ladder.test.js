// Which rung of the trust ladder a brief stands on, and what moves it up (#1104).
//
// WHAT IS HELD HERE, and what no other file holds:
//
//   1. ABSENT IS A STATE. No import and a cleared import both leave the ladder
//      empty and off screen. "Declared" over a file nobody loaded is a verdict
//      about nothing, so the empty state is the block being gone — not rung 1.
//   2. THE DISTINCTION IS A WORD AND A POSITION. "Estimated — rung 2 of 3" is a
//      literal string. No new glyph is minted for it, no `trust-rung-*` shape
//      element exists, and the mark beside it is the marker the brief already
//      ships — which is what keeps tests/evolution-glyph-roles.test.js's
//      one-glyph-one-role registry true.
//   3. NO RUNG IS AWARDED FOR A CLAIM THIS PAGE CANNOT CHECK. A derivation can
//      reach DECLARED and ESTIMATED. VERIFIED is on the ladder as the rung the
//      promotion step names and is never handed out by arithmetic.
//   4. ONE ANNOUNCEMENT, AND ONLY ON A MOVE. The ladder adds no live region: the
//      rung rides the stand region's single sentence, after the action and
//      before the source. A revision that lands on the rung the reader was
//      already on contributes nothing to that sentence, because a polite region
//      handed the same rung again is an utterance with no news in it.
//   5. EVERY STATE, including the ones that do not demo well: no month marked
//      complete, a negative recoverable total, and one larger than the spend.
//
// Assertions are on counts, attributes and text. The harness is a double: it
// reads through a collapsed disclosure and rejects a descendant selector, so
// nothing below stands on visibility and every lookup walks `parentNode`.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import {
  PROMOTION_TARGET_ID, RUNG_COUNT, TRUST_LADDER, TRUST_RUNG,
  applyTrustLadder, clearTrustLadder, createTrustAnnouncer, trustAnnouncement,
  trustAssessment,
} from "../src/finops-trust-ladder.js";
import {
  ANSWER_ANNOUNCER_ID, announceAnswer, answerAnnouncement,
} from "../src/finops-answer-announcement.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const css = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");

const HOST = "finops-trust-ladder";

/** An import with one complete month that supports a recoverable figure. */
const estimatedImport = (period = {}) => ({
  period: "2026-01-01 to 2026-02-01",
  spendUsd: 240_000,
  recoverableUsd: 36_000,
  rankedDepartments: [],
  action: "",
  history: {
    state: "available",
    periods: [{
      period: "2026-01", spendUsd: 240_000, recoverableUsd: 36_000, completeness: "complete",
      ...period,
    }],
  },
});

/** An import whose only month was never closed. */
const partialImport = () => estimatedImport({ completeness: "partial" });

const host = (doc) => doc.getElementById(HOST);

// --- 1. absent is a state ---------------------------------------------------

test("an unimported page and a cleared import both leave the ladder gone, not at rung 1", () => {
  const doc = parseHtml(html);
  const block = host(doc);
  assert.equal(block.hidden, true, "the ladder ships off screen");
  assert.equal(block.dataset.rung, "none");
  assert.equal(block.children.length, 0, "and empty, so it states no verdict about no file");
  assert.equal(textOf(block), "");

  assert.equal(trustAssessment(null), null, "with no brief there is nothing to be on a rung");
  assert.equal(applyTrustLadder(doc, null), null);

  applyTrustLadder(doc, estimatedImport());
  assert.equal(host(doc).hidden, false);
  assert.ok(host(doc).children.length >= 4);

  clearTrustLadder(doc);
  assert.equal(host(doc).hidden, true, "a cleared import takes the rung down with the brief");
  assert.equal(host(doc).dataset.rung, "none");
  assert.equal(host(doc).children.length, 0, "and leaves no rung, no marker, and no promotion");
  assert.equal(host(doc).querySelectorAll(".brief-provenance").length, 0,
    "a cleared brief marks nothing, because it has nothing");
});

test("the ladder contributes no provenance marker to the page it ships as", () => {
  // The count tests/finops-imported-brief-readability.test.js takes over the
  // whole imported brief. An indicator that rendered unconditionally would put
  // marks on an unimported page, which is the failure this assertion pins.
  const doc = parseHtml(html);
  const outside = [...doc.querySelectorAll(".brief-provenance")]
    .filter((node) => {
      for (let held = node; held; held = held.parentNode) {
        if (held.id === "finops-first-run") return false;
      }
      return true;
    });
  assert.equal(outside.length, 0, "the shipped page marks nothing outside the bundled example");
});

// --- 2. a word and a position, never a new mark -----------------------------

test("the three rungs are named, numbered, and told apart without colour or a glyph", () => {
  assert.equal(RUNG_COUNT, 3, "three rungs, and there is no fourth");
  assert.deepEqual(TRUST_LADDER.map((entry) => entry.rung),
    [TRUST_RUNG.declared, TRUST_RUNG.estimated, TRUST_RUNG.verified],
    "the ladder is ordered low to high, which is what makes the ordinal mean anything");
  assert.deepEqual(TRUST_LADDER.map((entry) => entry.ordinal), [1, 2, 3]);
  assert.equal(new Set(TRUST_LADDER.map((entry) => entry.name)).size, 3);
  assert.equal(new Set(TRUST_LADDER.map((entry) => entry.token)).size, 3);

  for (const entry of TRUST_LADDER) {
    // The statement is the whole distinction in one literal string: a reader who
    // sees no colour, and one hearing it read aloud, get the same two cues.
    assert.equal(entry.statement, `${entry.name} — rung ${entry.ordinal} of ${RUNG_COUNT}`);
    assert.ok(!/\b(colour|color|green|amber|red)\b/i.test(entry.supports),
      `the ${entry.rung} rung names a colour as its meaning`);
    // What it is good for AND what it is not: an "estimate" nobody bounded is
    // an invitation to spend it on a billing dispute.
    assert.match(entry.supports, /Good enough to/);
    assert.ok(entry.promotion.trim().length > 0, `${entry.rung} states no step up`);
  }
  assert.match(TRUST_LADDER[1].supports, /Not good enough to settle a billing dispute/,
    "the estimated rung must state the decision it cannot carry, in words");
});

test("no shape element and no glyph is minted for the rung, in the module or the sheet", () => {
  const doc = parseHtml(html);
  applyTrustLadder(doc, estimatedImport());
  const GLYPHS = /[◇◆◈◌○◐◔●▲▼▶▸▾▣▢◧▦◤×✓]/u;
  const walk = (node, found = []) => {
    for (const child of node.children ?? []) {
      if (child.nodeType === 1) { found.push(child); walk(child, found); }
    }
    return found;
  };
  for (const node of walk(host(doc))) {
    const own = (node.children ?? []).filter((child) => child.nodeType === 3)
      .map((child) => child.textContent).join("");
    assert.doesNotMatch(own, GLYPHS,
      `the ladder draws ${own.trim()}, a mark the glyph-role registry already spends elsewhere`);
    assert.ok(!/trust-rung/.test(String(node.getAttribute("class") ?? "")),
      "a trust-rung-* shape element is a second vocabulary for a distinction words already carry");
  }
  assert.doesNotMatch(css, /trust-rung/, "the stylesheet grew a rung shape rule");
  // And the ladder costs the sheet nothing: every class it paints is one the
  // brief already ships, which is what keeps it inside the size budget.
  for (const node of walk(host(doc))) {
    for (const name of String(node.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)) {
      assert.ok(css.includes(`.${name}`) || html.includes(name),
        `.${name} is a new selector; the ladder must compose from classes the page has`);
    }
  }
});

test("the rung reuses the brief's one provenance marker rather than a second vocabulary", () => {
  const doc = parseHtml(html);
  applyTrustLadder(doc, estimatedImport());
  const marks = host(doc).querySelectorAll(".brief-provenance");
  assert.equal(marks.length, 1, "one marker on the rung, painted once");
  assert.equal(marks[0].dataset.provenance, "reader",
    "a rung this page derived is not a figure read out of the file");
  assert.equal(marks[0].dataset.silhouette, "outline");
  assert.match(textOf(marks[0]), /Trust ladder rung/, "the marker names what it qualifies");
  assert.match(textOf(marks[0]), /est\./, "and carries the short text token beside it");

  applyTrustLadder(doc, estimatedImport());
  assert.equal(host(doc).querySelectorAll(".brief-provenance").length, 1,
    "a second paint over the same import adds no second marker");
});

// --- 3. no rung is awarded for a claim this page cannot check ---------------

test("a complete month earns Estimated, and nothing earns Verified", () => {
  const earned = trustAssessment(estimatedImport());
  assert.equal(earned.entry.rung, TRUST_RUNG.estimated);
  assert.equal(earned.entry.statement, "Estimated — rung 2 of 3");
  assert.equal(earned.plausible, true);
  assert.equal(earned.note, "", "a plausible estimate needs no caveat beyond its own line");

  // Every shape of import this page can read, and not one of them reaches the
  // top rung: reconciliation happens against evidence this tab never sees.
  for (const analysis of [estimatedImport(), partialImport(), { history: null },
    estimatedImport({ recoverableUsd: 0 }), { rankedDepartments: [] }]) {
    assert.notEqual(trustAssessment(analysis).entry.rung, TRUST_RUNG.verified,
      "a derivation handed out the rung that means somebody checked the invoice");
  }
});

test("an unclosed month is Declared and says why, rather than being promoted", () => {
  const doc = parseHtml(html);
  const assessment = applyTrustLadder(doc, partialImport());
  assert.equal(assessment.entry.rung, TRUST_RUNG.declared);
  assert.equal(host(doc).dataset.rung, "declared");
  assert.equal(host(doc).dataset.ordinal, "1");
  const said = textOf(host(doc));
  assert.match(said, /Declared — rung 1 of 3/, "the reader is told which rung, in words and by number");
  assert.match(said, /No month in this export is marked complete/,
    "and what is missing, rather than being left to infer it from an absence");
});

test("an implausible intake falls to Declared and states what the reader is looking at", () => {
  for (const period of [{ recoverableUsd: -36_000 }, { recoverableUsd: 900_000 },
    { spendUsd: 0 }]) {
    const doc = parseHtml(html);
    const assessment = applyTrustLadder(doc, estimatedImport(period));
    assert.equal(assessment.entry.rung, TRUST_RUNG.declared,
      `${JSON.stringify(period)} was silently promoted above Declared`);
    assert.equal(host(doc).dataset.rung, "declared");
    // The indicator does not overflow: it is the same five lines it always is,
    // and the ordinal never leaves the ladder.
    assert.equal(host(doc).children.length, 5, "the block's shape does not move for a bad figure");
    assert.match(textOf(host(doc)), /rung 1 of 3/);
  }
  const negative = trustAssessment(estimatedImport({ recoverableUsd: -36_000 }));
  assert.equal(negative.plausible, false);
  assert.match(negative.note, /negative or larger than the spend/,
    "a reading nobody should stand on is named, not rounded away");
});

// --- 4. one announcement, and one path up ------------------------------------

test("the ladder announces nothing of its own and takes no tab stop of its own", () => {
  const doc = parseHtml(html);
  applyTrustLadder(doc, estimatedImport());
  assert.equal(host(doc).querySelectorAll('[aria-live], [role="status"], [role="alert"]').length, 0,
    "the stand region owns the page's one announcer; a second is a queue, not an answer");
  assert.equal(host(doc).querySelectorAll("[tabindex]").length, 0,
    "the ladder overrides no tab stop, so its order is the document order");
  // Nothing that announces is inside a disclosure either — and the ladder opens
  // no disclosure at all, so a collapsed one cannot swallow it.
  assert.equal(host(doc).querySelectorAll("details").length, 0);
});

const HEADLINE = Object.freeze({
  question: "Are we wasting money?",
  recoverable: { label: "Recoverable spend", value: "$36,000" },
  action: { available: true, label: "Pilot lower-cost routing" },
  label: "Your own export · analyzed in this browser",
});

test("the rung rides the answer's own sentence, after the action and before the source", () => {
  const plain = answerAnnouncement(HEADLINE);
  assert.match(plain, /Source: Your own export · analyzed in this browser\.$/);
  assert.doesNotMatch(plain, /Trust ladder/,
    "an answer with no brief on the ladder composes the sentence it always composed");

  const trust = trustAnnouncement(trustAssessment(estimatedImport()));
  assert.equal(trust, "Trust ladder: Estimated — rung 2 of 3");
  const said = answerAnnouncement(HEADLINE, { trust });
  const action = said.indexOf("Do this next:");
  const rung = said.indexOf("Trust ladder:");
  const source = said.indexOf("Source:");
  assert.ok(action > 0 && rung > action && source > rung,
    `the announcement's reading order is figure, action, rung, source: "${said}"`);
  assert.match(said, /Source: Your own export · analyzed in this browser\.$/,
    "whose figures these are is still the last thing a reader hears");
  assert.equal(trustAnnouncement(null), "", "no brief announces no rung");
});

test("the rung is announced when it moves and stays quiet when it does not", () => {
  const doc = parseHtml(html);
  const live = doc.getElementById(ANSWER_ANNOUNCER_ID);
  assert.ok(live, "the page's one announcer is the region this rides on");
  const announceRung = createTrustAnnouncer();
  // One recompute, exactly as the page does it: the rung is offered to the
  // announcer, and whatever comes back is what the sentence is composed with.
  const recompute = (analysis) => {
    announceAnswer(doc, answerAnnouncement(HEADLINE,
      { trust: announceRung(trustAssessment(analysis)) }));
    return textOf(live);
  };

  // A reader who was on no rung and is now on one has moved, and hears it.
  assert.match(recompute(partialImport()), /Trust ladder: Declared — rung 1 of 3/);

  // A revision that lands them back on Declared has NOT moved them. The answer
  // is announced — it changed — and the rung clause is absent, rather than the
  // same string being written back, which a polite region would read out again.
  const again = recompute(partialImport());
  assert.doesNotMatch(again, /Trust ladder/,
    "an unchanged rung was announced a second time, which is news that is not news");
  assert.match(again, /Recoverable spend: \$36,000/,
    "and the answer itself is still announced on the quiet turn");
  assert.match(again, /Source: Your own export · analyzed in this browser\.$/,
    "with the source still last, so the sentence's shape does not move either");

  // Moving up the ladder is the change the indicator exists for, so it is said.
  assert.match(recompute(estimatedImport()), /Trust ladder: Estimated — rung 2 of 3/);
  assert.doesNotMatch(recompute(estimatedImport()), /Trust ladder/,
    "and settling on Estimated is announced once, not on every later import");

  // Clearing takes the reader off the ladder, so arriving again is a move again.
  announceRung(null);
  assert.match(recompute(estimatedImport()), /Trust ladder: Estimated — rung 2 of 3/,
    "a cleared import must not leave the announcer thinking the reader is still on a rung");
});

test("the announcer speaks every real move, including the one no derivation grants", () => {
  // `trustAssessment` cannot reach Verified, so the promotion an integration
  // would hand this page is exercised directly: the gate is on the rung
  // changing, not on which rung it changed to.
  const announceRung = createTrustAnnouncer();
  const at = (index) => ({ entry: TRUST_LADDER[index], plausible: true, note: "" });
  assert.equal(announceRung(at(0)), "Trust ladder: Declared — rung 1 of 3");
  assert.equal(announceRung(at(1)), "Trust ladder: Estimated — rung 2 of 3");
  assert.equal(announceRung(at(1)), "", "the same rung twice is one announcement");
  assert.equal(announceRung(at(2)), "Trust ladder: Verified — rung 3 of 3");
  assert.equal(announceRung(at(2)), "");
  // Down is a move too: a worse export must not be a silent demotion.
  assert.equal(announceRung(at(0)), "Trust ladder: Declared — rung 1 of 3");
  assert.equal(announceRung(null), "", "off the ladder is not a rung and is not spoken");
  assert.equal(announceRung(at(0)), "Trust ladder: Declared — rung 1 of 3",
    "and stepping back on after that is a move");
  // Two announcers do not share a memory; one mount, one reader, one history.
  assert.equal(createTrustAnnouncer()(at(0)), "Trust ladder: Declared — rung 1 of 3");
});

test("the one step up is one sentence and links to the preflight already on the page", () => {
  const doc = parseHtml(html);
  applyTrustLadder(doc, estimatedImport());
  const links = host(doc).querySelectorAll("a");
  assert.equal(links.length, 1, "one path up the ladder, not a second preflight");
  assert.equal(links[0].getAttribute("href"), `#${PROMOTION_TARGET_ID}`);
  assert.equal(links[0].getAttribute("tabindex"), null, "the link takes the tab stop it is due");
  const copy = textOf(links[0]);
  assert.match(copy, /evidence preflight/);
  assert.equal(copy.split(/(?<=\.)\s/).filter(Boolean).length, 1,
    `the promotion step is one sentence: "${copy}"`);

  // The destination is a real region of this page, not a link into nothing.
  const target = doc.getElementById(PROMOTION_TARGET_ID);
  assert.equal(target.tagName, "SECTION");
  assert.ok(textOf(doc.getElementById("own-data-preflight-question")).length > 0);
});

// --- 5. the pre-intake screen explains the scale before anyone is on it ------

test("the first-run region names the three rungs and claims none of them", () => {
  const doc = parseHtml(html);
  const legend = doc.getElementById("finops-first-run-trust-ladder");
  const said = textOf(legend);
  for (const entry of TRUST_LADDER) {
    assert.match(said, new RegExp(`${entry.name}`),
      `the pre-intake explanation does not name the ${entry.rung} rung`);
    assert.match(said, new RegExp(`rung ${entry.ordinal} of ${RUNG_COUNT}`));
  }
  assert.match(said, /stands on no rung/,
    "the bundled example must not be presented as having earned a rung");
  // The first screen's tab budget is full: the explanation adds no control to
  // it, so the enumerated focus order of `#finops-first-run` is unchanged.
  for (const tag of ["a", "button", "input", "select", "textarea"]) {
    assert.equal(legend.querySelectorAll(tag).length, 0,
      `the pre-intake explanation opened a ${tag} and took a tab stop off the first screen`);
  }
});
