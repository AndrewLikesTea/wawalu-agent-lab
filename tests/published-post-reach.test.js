// What publishing on Social makes public, in one wording on the three pages
// that show a published post (#2734).
//
// Social, People and the shared post page each used to answer "who can read
// this, and can it be taken back?" in their own nouns and their own point of
// view. A reader who met two of them had no way to tell whether the differences
// carried meaning: "anyone can read an image post you publish" on People,
// "anyone can read a post a visitor publishes" on the permalink, and "anyone
// who opens Social can read it, on any device or browser" inside Social's
// storage block are one fact in three voices. The terms of publishing fared
// better — People wrote them (#2484) and Social's composer adopted the same
// bytes (#2648) — but the permalink, the page a forwarded link actually lands a
// stranger on, said nothing about them at all.
//
// Both sentences are now constants in src/social.js, and this file compares the
// bytes rather than reading each page's sense. Three claims, per page:
//   * present, exactly once;
//   * byte-identical to the constant, so a paraphrase on any one page fails;
//   * authored in the markup, so it paints before a line of script runs.
//
// The reporting clause Social and People close on is deliberately not shared —
// src/post-page.js draws a Report post button on a loaded post and on none of
// the permalink's three other states, so a sentence promising one would send a
// waiting reader hunting for a control that is not on the screen. It is held to
// the two pages where it holds unconditionally instead, and to the same bytes
// on both.
//
// HARNESS NOTES: no element is ever an operand of an assertion here (a failed
// node comparison serialises the whole parsed page and outlives the test
// timeout), and counts come from splitting text rather than from a selector,
// because this harness models no layout and reads straight through a collapsed
// disclosure.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, textOf } from "./support/browser.js";
import { PUBLISHED_POST_REACH, PUBLISHED_POST_TERMS } from "../src/social.js";

// The three pages that show a reader a post somebody published, named the way a
// reader would name them. Nothing else on the site shows one.
const PAGES = [
  ["Social", "social.html"],
  ["People", "profile.html"],
  ["the shared post page", "post.html"],
];

// The wordings these two replaced. None of them may come back beside the
// sentence that replaced it, or anywhere else on any of the three pages: the
// defect this file exists to catch is a later change re-adding one "to be
// clear", which is how there came to be three in the first place.
const RETIRED = [
  "anyone can read an image post you publish",
  "anyone can read a post a visitor publishes",
  "anyone who opens Social can read it, on any device or browser",
  // And the second-person stack the terms replaced (#2648), which said public
  // and permanent as two facts a reader had to add up.
  "Anyone who visits Shiplog can read your post, its image, and the display name you publish it with.",
  "You cannot edit or delete your own post after you publish it",
];

const read = (file) => readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
const times = (text, part) => text.split(part).length - 1;

/* ------------------------------ the sentences ----------------------------- */

// The bar the two constants are held to, before any page is opened: a reader
// skims standing copy, and a claim about what they cannot undo has to survive
// being skimmed.
test("each sentence is one short, active sentence that answers one question", () => {
  for (const sentence of [PUBLISHED_POST_REACH, PUBLISHED_POST_TERMS]) {
    assert.equal(sentence.split(/[.!?]/).filter((part) => part.trim()).length, 1,
      `"${sentence}" is more than one sentence`);
    assert.ok(sentence.endsWith("."), `"${sentence}" does not end in a full stop`);
    assert.ok(sentence.split(/\s+/).length <= 15, `"${sentence}" is longer than 15 words`);
    // The subject is the published post, not the page the sentence is on. This
    // is the whole reason one wording can serve three surfaces: "anyone who
    // opens Social" and "an image post you publish" could not.
    assert.match(sentence, /^A published post|^Anyone can read a published post/,
      `"${sentence}" names a page or a reader rather than the published post`);
    assert.doesNotMatch(sentence, /\byou\b|\byour\b/i,
      `"${sentence}" addresses a publisher, on pages where nobody can publish`);
  }

  // Two questions, answered apart. A reader asks who can read it and whether it
  // can come back, and the pair used to be one sentence with a trailing clause.
  assert.match(PUBLISHED_POST_REACH, /read/);
  assert.match(PUBLISHED_POST_REACH, /on any device or browser/,
    "the reach sentence no longer says a published post is readable anywhere");
  assert.match(PUBLISHED_POST_TERMS, /public/);
  assert.match(PUBLISHED_POST_TERMS, /cannot be edited or deleted/);
  // Neither borrows the other's claim, so neither can be dropped as a
  // restatement of its neighbour.
  assert.doesNotMatch(PUBLISHED_POST_REACH, /edited or deleted|public/);
  assert.doesNotMatch(PUBLISHED_POST_TERMS, /device|browser/);
  // And the reporting clause is not inside either, which is what lets the
  // permalink carry them: that page draws a Report post button in one of its
  // four states.
  for (const sentence of [PUBLISHED_POST_REACH, PUBLISHED_POST_TERMS])
    assert.doesNotMatch(sentence, /Report post/,
      `"${sentence}" promises a control the shared post page draws in one state of four`);
});

/* ------------------------------ the three pages --------------------------- */

test("all three pages say both sentences, in the same bytes, exactly once each", async () => {
  for (const [name, file] of PAGES) {
    const markup = await read(file);
    for (const sentence of [PUBLISHED_POST_REACH, PUBLISHED_POST_TERMS]) {
      assert.equal(times(markup, sentence), 1,
        `${name} (${file}) writes this ${times(markup, sentence)} times rather than once: ${sentence}`);
    }
  }
});

test("both sentences paint before any script runs, and only once on the page", async (t) => {
  for (const [name, file] of PAGES) {
    // Served, not hydrated: what a reader receives from the markup, ahead of
    // the first fetch. No page module is imported here on purpose — authored
    // copy that a view module overwrites on load would pass a file-level check
    // and never reach a reader.
    const page = await loadPage(new URL(`../src/${file}`, import.meta.url), {});
    t.after(() => page.restore());
    const painted = textOf(page.document.querySelector("#main-content"));
    for (const sentence of [PUBLISHED_POST_REACH, PUBLISHED_POST_TERMS]) {
      assert.equal(times(painted, sentence), 1,
        `${name} does not paint this exactly once before any script runs: ${sentence}`);
    }
  }
});

test("the wordings these replaced are gone from all three pages", async (t) => {
  for (const [name, file] of PAGES) {
    const markup = await read(file);
    const page = await loadPage(new URL(`../src/${file}`, import.meta.url), {});
    t.after(() => page.restore());
    const painted = textOf(page.document.querySelector("#main-content"));
    for (const retired of RETIRED) {
      assert.equal(markup.includes(retired), false,
        `${name} (${file}) still ships a retired wording of what publishing makes public: ${retired}`);
      assert.equal(painted.includes(retired), false,
        `${name} still paints a retired wording of what publishing makes public: ${retired}`);
    }
  }
});

/* ---------------------- the clause that is not shared --------------------- */

// Kept where it is true, and in one wording there too. Social says it beside
// Publish post and People says it in the helper that hands a reader to that
// composer; both pages draw a Report post button on every card they render.
test("the reporting clause stays on the two pages that always draw the control", async () => {
  const CLAUSE = "Anyone can select Report post on it.";
  for (const file of ["social.html", "profile.html"]) {
    const markup = await read(file);
    assert.equal(times(markup, CLAUSE), 1, `${file} does not state the reporting clause exactly once`);
    // Directly after the terms, so the pair still reads as one thought: a post
    // cannot be taken down by its publisher, and this is the route that does
    // end in removal (#2373).
    assert.equal(times(markup, `${PUBLISHED_POST_TERMS} ${CLAUSE}`), 1,
      `${file} parted the reporting route from the terms it qualifies`);
  }
  const post = await read("post.html");
  assert.equal(post.includes(CLAUSE), false,
    "the shared post page promises a Report post control it draws in one of its four states");
});

/* ----------------------- what the edit may not disturb -------------------- */

// Criterion 5: the example-post caveat is a separate claim with its own owner,
// and trimming the reach clause off the end of each page's provenance sentence
// may not change how often that claim is made. One per page, as before.
test("the demo-data caveat is still made exactly once per page", async (t) => {
  for (const [name, file] of PAGES) {
    const page = await loadPage(new URL(`../src/${file}`, import.meta.url), {});
    t.after(() => page.restore());
    const painted = textOf(page.document.querySelector("#main-content"));
    assert.equal(times(painted, "no customer or production data"), 1,
      `${name} makes the demo-data claim ${times(painted, "no customer or production data")} times rather than once`);
  }
});
