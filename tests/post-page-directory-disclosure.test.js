// A forwarded post fills its own page, and the rest of the site waits behind a
// disclosure (#1984).
//
// THE SHAPE. /post.html is the one page of this site a visitor reaches cold,
// from a link pasted into a chat window. It already leads with the post; what it
// also carried was the footer's eight-row directory of everywhere else, open, so
// the larger half of the document was a site map the reader had not asked for.
// The list is now behind a summary that ships closed. Nothing was deleted: every
// row, every link, in the same order, one keystroke away.
//
// WHAT IS PINNED HERE, and why each one is a defect if it slips:
//   1. The post is what the content region opens on, under the heading that
//      names it and the one sentence saying what this page is — the promise the
//      link made, not the sixth block down. That sentence is counted, not just
//      allowed: one paragraph, one sentence, and nothing else may join it.
//   2. The disclosure is closed on first paint. An "open by default" details is
//      the same page it replaced with an extra triangle.
//   3. Every destination survives and is keyboard-reachable once expanded.
//      A disclosure that loses rows is a deletion wearing a summary.
//   4. The follow-up form — its field and its action — is OUTSIDE the disclosure
//      and BEFORE it, so a reader reaches a person without meeting a site map on
//      the way. #2250 moved the fold below the form; it used to sit above it.
//   5. Every live region on the page is outside the disclosure. Folding a status
//      region away is how a page goes silent for a screen reader while every
//      visual test still passes.
//   6. These five pages and no others (#2250): the shared post, Social, People,
//      Prompt coach and Releases, where a visitor came to do one thing. The
//      directory is still the point of the footer on the twelve pages a reader
//      arrives at from inside the site, and stays open there.
//
// HARNESS NOTES, all of them load-bearing:
//   * textOf reads straight through a closed disclosure, so "is it inside the
//     collapsed region" is asked of the tree — parentNode walked by hand —
//     never of visible text.
//   * This harness has no `open` property: a closed details answers `undefined`,
//     which is why first paint asserts `!node.open` and everything after it asks
//     hasAttribute("open"). `equal(node.open, false)` would pass on a page that
//     ships the disclosure open.
//   * tabSequence keeps a closed disclosure's contents in the sequence — a gap
//     stated in tests/support/browser.js — so browserTabSequence below drops
//     them, and that is the order a browser gives.
//   * Nothing is asserted against a node: a failed node comparison serialises
//     the whole parsed page and outlives the test timeout. Indices and counts.
//   * Descendant selectors throw here, so every "inside X" question is a walk.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DEMOS, DIRECTORY_SUMMARY, PITCH_LINK, SOURCE_LINK_LABEL } from "../src/site-footer.js";
import { SITE_NAV } from "../src/site-nav.js";
import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";

const POST_PAGE = new URL("../src/post.html", import.meta.url);
const SRC = new URL("../src/", import.meta.url);

const DIRECTORY = "#site-footer-directory";
const SUMMARY = "#site-footer-directory-summary";

// The pages whose footer folds the directory away and puts it last (#2250).
// Hand-kept and named, the same discipline FOOTER_VARIANT in
// tests/site-footer.test.js follows: a page cannot join or leave this set
// without a reviewer reading the line that says so.
const FOLDED = ["post.html", "social.html", "profile.html", "coach.html", "releases.html"];

// The retrieval line the page ships in its markup, character for character.
const LOADING = "The public shared post is loading.";

const open = (node) => node.hasAttribute("open");

// Is this element inside a disclosure that is currently closed? A summary is the
// handle on the disclosure, not something the disclosure hides, so the walk
// starts above the element it opens.
function insideClosed(node) {
  const from = node.tagName === "SUMMARY" ? node.parentNode : node;
  for (let current = from?.parentNode; current; current = current.parentNode) {
    if (current.tagName === "DETAILS" && !open(current)) return true;
  }
  return false;
}

// Is this element anywhere inside the directory disclosure, open or closed? The
// summary is the handle, so it answers no — it is what a reader reaches when the
// disclosure hides everything else.
function insideDirectory(node) {
  const from = node?.tagName === "SUMMARY" ? node.parentNode : node;
  for (let current = from?.parentNode; current; current = current.parentNode) {
    if (current.getAttribute?.("id") === "site-footer-directory") return true;
  }
  return false;
}

// The tab order a browser gives, which is the harness's minus what a collapsed
// disclosure takes out of it.
const browserTabSequence = (document) => tabSequence(document).filter((stop) => !insideClosed(stop));

// Element children only: text nodes live in `children` here, answering "#text"
// for a tagName and carrying no dataset, so every walk has to step over them.
const elementChildren = (node) => node.children.filter((child) => child.nodeType === 1);

/* --------------------------- the post comes first ------------------------- */

test("the post is the first thing in the content region, under the heading that names it", async (t) => {
  const page = await loadPage(POST_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const main = document.querySelector("#main-content");

  // One region opens the content, and the post's own region opens that: what
  // precedes the post is the surface marker, the heading, and one sentence
  // saying what the page is. Anything beyond those three — a second paragraph,
  // a row of routes off the page — is the old order coming back, where the
  // thing the link promised was the sixth block a reader reached.
  //
  // The third block is the concession #2179 asked for, and it is bounded here
  // rather than left open: exactly one paragraph, exactly one sentence. This
  // page is met cold by someone who has never seen Social, and it used to go
  // from the heading straight into "The public shared post is loading." — busy
  // before it had said what it was. One line of orientation is not the intro
  // block that was removed; the count is what keeps the two apart.
  const frame = elementChildren(main)[0];
  assert.equal(frame.tagName, "SECTION");
  const blocks = elementChildren(frame);
  const post = blocks.findIndex((node) => node.getAttribute("aria-label") === "Post");
  assert.ok(post >= 0, "the content region has no post region");
  assert.deepEqual(blocks.slice(0, post).map((node) => node.tagName), ["P", "H1", "P"]);
  assert.equal(textOf(blocks[post - 2]), "Shared post");
  const lead = textOf(blocks[post - 1]);
  assert.equal(lead.split(/[.!?]/).filter((part) => part.trim()).length, 1,
    "one sentence stands between the heading and the post, not a paragraph of them");
  // It says what the page is, in the words Social uses for itself.
  assert.match(lead, /^A shared link opens one post from Social, /);
  assert.equal(lead.includes(LOADING), false, "the lead must not restate the retrieval line above it");

  // And it is the region that holds the post slot, the retrieval line included.
  const region = blocks[post];
  assert.equal(region.querySelectorAll("#post-detail").length, 1);
  assert.ok(textOf(region).includes(LOADING), "the loading line must sit in the post's own region");

  // Everything the page says about the surface the post came from, and every
  // route off the page, follows it. Counted rather than compared as nodes.
  const after = blocks.slice(post + 1);
  assert.ok(after.length >= 2, "the standing copy and the routes out must follow the post");
  assert.equal(after.filter((node) => node.querySelectorAll(".detail-back").length > 0).length, 1);
});

/* ------------------------ the directory, folded away ---------------------- */

test("the site directory ships closed, and only the task pages fold it", async (t) => {
  const page = await loadPage(POST_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  const directory = document.querySelector(DIRECTORY);
  assert.equal(directory.tagName, "DETAILS");
  // A closed disclosure answers `undefined` here, never `false`: asserting
  // equality against false would pass on a page shipping it open.
  assert.ok(!directory.open, "the directory must ship collapsed");
  assert.equal(directory.getAttribute("open"), null);

  const summary = document.querySelector(SUMMARY);
  assert.equal(summary.tagName, "SUMMARY");
  assert.equal(summary.parentNode.getAttribute("id"), "site-footer-directory",
    "a summary that is not a disclosure's own child is not a control");

  // It names what is behind it and how much of it there is, so opening it is not
  // the only way to learn the size, and it is the site rather than more about
  // this post.
  assert.equal(textOf(summary), DIRECTORY_SUMMARY);
  assert.match(textOf(summary), new RegExp(`\\b${DEMOS.length}\\b`), "the summary must state the count it hides");
  assert.match(textOf(summary), /Shiplog/);

  // The caption role the footer already ships, and no rule of its own: this
  // change buys no new colour, type or spacing value.
  assert.equal(summary.getAttribute("class"), "site-footer-note");
  const css = await readFile(new URL("styles.css", SRC), "utf8");
  assert.doesNotMatch(css, /site-footer-directory/, "the disclosure must not grow a rule of its own");
  // And it is visibly focusable — the band's focus rule now covers the one
  // control in it that is neither a link, a button nor a field.
  assert.match(css, /\.site-footer summary:focus-visible[^{]*\{ outline:3px solid var\(--focus-ring\)/);

  // Five pages, named rather than counted: the ones a visitor is on to do one
  // thing. Every other page of the site meets its directory open, because a
  // reader who arrived from inside the site is there to go somewhere else.
  const files = (await readdir(SRC, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => entry.name);
  for (const file of files) {
    const html = await readFile(new URL(file, SRC), "utf8");
    if (!html.includes('class="site-footer-demos"')) continue;
    assert.equal(html.includes('id="site-footer-directory"'), FOLDED.includes(file),
      FOLDED.includes(file) ? `${file} left its directory open` : `${file} folded its directory away too`);
  }
});

test("every destination survives the fold and is reachable once the directory is opened", async (t) => {
  const page = await loadPage(POST_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  // The rows are all still in the document — this is a disclosure, not a cut.
  const rows = document.querySelector(".site-footer-demos").querySelectorAll("li");
  assert.equal(rows.length, DEMOS.length);
  for (const [index, demo] of DEMOS.entries()) {
    assert.equal(textOf(rows[index].querySelectorAll("a")[0]), demo.label, `destination ${index} changed`);
  }

  // Closed, none of them is a tab stop; the summary is the one stop the map
  // costs a reader who did not ask for it.
  const directory = document.querySelector(DIRECTORY);
  const summary = document.querySelector(SUMMARY);
  const before = browserTabSequence(document);
  assert.equal(before.filter(insideDirectory).length, 0, "a collapsed map must cost no tab stops");
  assert.ok(before.includes(summary), "the summary must be the way in");

  // Opened from the keyboard, the way a reader opens it: focus the summary and
  // press Enter. Not by writing the attribute — the control has to work.
  summary.focus();
  pressEnter(document);
  assert.ok(open(directory), "Enter on the summary must open the directory");

  // Every link the band offers, now walkable: one stop per row, including the
  // row for the page the navigation files under Prompt coach.
  const expected = DEMOS.map((demo) => demo.label);
  const reachable = browserTabSequence(document).filter(insideDirectory).map(textOf);
  assert.deepEqual(reachable, expected, "an expanded directory must offer every destination, in order");
  assert.equal(reachable.length, DEMOS.length);

  // And it closes again on the same key, so a reader who opened it by mistake is
  // not stuck with it.
  summary.focus();
  pressEnter(document);
  assert.ok(!open(directory));
});

/* ------------- what may never end up inside the collapsed region ----------- */

test("the follow-up form stays outside the disclosure and in reach with nothing expanded", async (t) => {
  const page = await loadPage(POST_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  const field = document.querySelector("#site-footer-email");
  const form = document.querySelector("#site-footer-form");
  const submit = form.querySelectorAll("button").find((button) => button.getAttribute("type") === "submit"
    && !button.hasAttribute("hidden"));

  for (const [what, node] of [["the form", form], ["the email field", field], ["the submit control", submit]]) {
    assert.equal(insideDirectory(node), false, `${what} must not sit inside the collapsed directory`);
  }

  // Reachable with the directory shut: a visitor who wants a person should not
  // have to open a site map on the way to the field.
  const stops = browserTabSequence(document);
  assert.ok(stops.includes(field), "the email field must be a tab stop with nothing expanded");
  assert.ok(stops.includes(submit), "the submit control must be a tab stop with nothing expanded");
  assert.equal(textOf(submit), "Request a follow-up");
  assert.equal(field.getAttribute("type"), "email");
});

test("every live region on the page renders outside the disclosure", async (t) => {
  const page = await loadPage(POST_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  // The retrieval message: what a forwarded link is doing, announced while it
  // does it. It belongs to the post region, which is nowhere near the footer.
  const slot = document.querySelector("#post-detail");
  assert.equal(slot.getAttribute("role"), "status");
  assert.equal(slot.getAttribute("aria-live"), "polite");
  assert.ok(textOf(slot).includes(LOADING));
  assert.equal(insideDirectory(slot), false, "the retrieval message must not be foldable away");

  // The follow-up's three: the inline error, the recovery paragraph the failure
  // state reveals, and the status line the module announces through. A collapsed
  // ancestor would leave a failed request silent.
  for (const id of ["#site-footer-error", "#site-footer-recovery", "#site-footer-status"]) {
    const node = document.querySelector(id);
    assert.equal(node.tagName, "P", `${id} must be on the page to be assertable`);
    assert.equal(insideDirectory(node), false, `${id} must not sit inside the collapsed directory`);
  }
  assert.equal(document.querySelector("#site-footer-status").getAttribute("aria-live"), "polite");

  // Said as a rule rather than as a list, so a live region added later cannot
  // land inside the fold unnoticed: nothing under the disclosure announces.
  const directory = document.querySelector(DIRECTORY);
  for (const attribute of ["aria-live", "role"]) {
    const inside = directory.querySelectorAll(`[${attribute}]`);
    assert.equal(inside.filter((node) => (node.getAttribute(attribute) ?? "") !== "list").length, 0,
      `the disclosure carries a node with ${attribute}`);
  }
});

/* ------------------------------- tab order -------------------------------- */

test("the permalink's tab order runs skip, nav, post, exits, follow-up, directory", async (t) => {
  const page = await loadPage(POST_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  // Every exit the page can offer, not only the one the loading state shows:
  // post-page.js reveals the other two once it knows whose post this is, and the
  // order they land in is the claim being made.
  for (const id of ["#post-people", "#post-publish"]) document.querySelector(id).removeAttribute("hidden");

  const stops = browserTabSequence(document);
  const at = (selector) => stops.indexOf(document.querySelector(selector));

  // Indices, never node comparisons: a failed node assert here would serialise
  // the parsed document and hang the run.
  assert.equal(at(".skip-link"), 0, "the skip link opens the page");
  assert.equal(at(".brand"), 1);
  const nav = stops.slice(2, 2 + SITE_NAV.length).map(textOf);
  assert.deepEqual(nav, SITE_NAV.map((link) => link.label), "the site nav follows the skip link");

  // The post region, then the routes off the page, then the way to reach a
  // person, and only then the folded directory. #2250 moved the map behind the
  // follow-up: a reader who came for one post should finish the page's own
  // errand before meeting a list of everywhere else.
  const exits = ["#post-back", "#post-people", "#post-publish"].map(at);
  assert.deepEqual(exits.slice().sort((a, b) => a - b), exits, "the exits keep their reading order");
  assert.equal(exits[0], 2 + SITE_NAV.length, "the first exit follows the nav directly");
  assert.ok(at(SUMMARY) > exits[2], "the directory summary comes after the page's own routes out");
  assert.ok(at(SUMMARY) > at("#site-footer-email"), "the follow-up field is reached before the summary");
  assert.equal(at(SUMMARY), stops.length - 1, "the folded map is the last stop on the page");

  // Two stops between the last exit and the follow-up block, and both belong to
  // the shared band rather than to this page: its pointer at the worked
  // decision, and the repository link #2152 added beneath it.
  const between = stops.slice(exits[2] + 1, at("#site-footer-message")).map(textOf);
  assert.deepEqual(between, [PITCH_LINK, SOURCE_LINK_LABEL]);

  // The whole sequence, end to end, with the directory shut. The block's two
  // fields carry no text of their own — the optional question #2153 added, then
  // the work email — so they are named here by id rather than by an empty string.
  assert.deepEqual(stops.slice(at("#site-footer-message")).map((stop) => textOf(stop) || stop.id),
    ["site-footer-message", "site-footer-email", "Request a follow-up", DIRECTORY_SUMMARY],
    "with nothing expanded the page ends on the follow-up form and then the summary");
});
