// One name for the Social feed, on the three pages that talk about it (#2698).
//
// THE DEFECT. A reader moving between Social, People and a shared post met three
// names for one surface. Social headed its own list "Post feed". People said
// "Open Social when you want the whole feed". The post page said "Open Social to
// read the whole feed" and described the place as "Shiplog’s shared feed of
// short posts about shipped work". Nothing on the site called it what the nav
// calls its destination, so a first-time visitor had no way to tell that the
// "whole feed" People offered, the "shared feed" the permalink described and the
// "Post feed" they landed under were the same list.
//
// THE NAME. "the Social feed" in a sentence, "Social feed" as a heading. Social
// stays the name of the page and the nav destination, which is why the post
// page's pinned clause still reads "one post from Social," — only what follows
// the comma changed.
//
// WHAT IS PINNED HERE:
//   1. The name renders on all three pages, in the authored markup a cold
//      visitor meets before any module has run.
//   2. The three retired names render on none of them. Asserted against rendered
//      text, not the file: src/post.html, src/social.html and src/profile.html
//      all keep the old wordings in rationale comments, which is the record of
//      what was retired and is not copy.
//   3. Social's heading keeps the name once a fetch answers and the heading
//      grows a count, which is the only one of the three that script rewrites.
//
// HARNESS NOTES this file depends on:
//   * No node is ever asserted against — a failed node comparison serialises the
//     whole parsed page and outlives --test-timeout. Text and counts only.
//   * querySelectorAll("*") throws here and comma selector groups are unsafe, so
//     the "nowhere" half reads one text blob per page rather than walking
//     elements.
//   * The parser drops comments, so textOf(document.body) is rendered copy; the
//     three pages load every script by src, so no inline script leaks into it.
//   * Each page is restored before the next one loads. Stacking t.after()
//     restores across pages unwinds oldest-first and leaves the wrong page's
//     globals installed.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, textOf } from "./support/browser.js";
import { DEFAULT_FEED_HEADING, feedHeading } from "../src/social.js";

// In a sentence, and as a heading. Both are the same two words so a reader who
// read one recognises the other.
const FEED_NAME = "the Social feed";
const FEED_HEADING = "Social feed";

// The three names this replaced. Each one was the only page on the site using
// it, which is what made the set of them a navigation problem rather than a
// wording preference.
const RETIRED = ["Post feed", "the whole feed", "shared feed"];

const PAGES = [
  // Social names its own list. The heading ships as the bare noun because a
  // count is a claim the page cannot make until a fetch has answered.
  { file: "social.html", name: FEED_HEADING, where: "the feed heading" },
  // People says what this view leaves out, and points at the feed that has it.
  { file: "profile.html", name: FEED_NAME, where: "the sentence under the tagline" },
  // The shared post page points forward to the feed the post came out of.
  { file: "post.html", name: FEED_NAME, where: "the route out of the post" },
];

test("Social, People and the shared post page call the feed by one name", async () => {
  for (const { file, name, where } of PAGES) {
    const page = await loadPage(new URL(`../src/${file}`, import.meta.url), {});
    try {
      const body = textOf(page.document.body);
      assert.ok(body.includes(name),
        `${file} does not call the feed "${name}" in ${where}`);
      for (const retired of RETIRED) {
        assert.equal(body.includes(retired), false,
          `${file} still calls the feed "${retired}" in rendered copy`);
      }
    } finally {
      page.restore();
    }
  }
});

test("Social's heading keeps the name when it grows a count", () => {
  // The one of the three that script rewrites: src/social.js replaces the
  // heading on every render, so the name has to survive the counted form as well
  // as the bare one it ships as.
  assert.equal(DEFAULT_FEED_HEADING, FEED_HEADING);
  for (const showing of [{ shown: 0 }, { shown: 1 }, { shown: 3, author: "Ari" }]) {
    assert.ok(feedHeading(showing).startsWith(`${FEED_HEADING}: `),
      `a counted heading stopped naming the feed: "${feedHeading(showing)}"`);
  }
});
