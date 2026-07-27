// One skip link per page, one main landmark per page, and the link points at it.
//
// Table-driven for the same reason tests/site-nav.test.js is: a page that grows
// a site header has to appear here, and the assertions below say what "keyboard
// users can reach the content" means in behaviour rather than in a screenshot.
//
// The tab order here is driven through tests/support/browser.js, the same
// harness the build and history flows use: it parses the shipped markup and
// walks the real document-order tab sequence, so "Tab lands on the skip link"
// is a keystroke assertion, not an inspection of the source text. What it
// cannot model is the browser moving focus to an anchor's #target — that is
// asserted structurally instead (the target exists, is the landmark, and is
// focusable), and called out where it happens.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SITE_NAV } from "../src/site-nav.js";
import { parseHtml, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";

// Every page reviewed in issue 348. The home page is both the front door and
// the decisions list, so the six reviewed surfaces are these five files.
const PAGES = [
  { file: "index.html", surface: "home and decisions list" },
  { file: "decision.html", surface: "single decision" },
  { file: "post.html", surface: "single post" },
  { file: "releases.html", surface: "releases" },
  { file: "agents.html", surface: "agent observatory" },
];

const SKIP_TEXT = "Skip to main content";

const read = (file) => readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
const load = async (file) => parseHtml(await read(file));

// Every element exposing the main landmark role, however it is spelled.
const mainLandmarks = (document) => [
  ...document.querySelectorAll("main"),
  ...document.querySelectorAll('[role="main"]').filter((node) => node.tagName !== "MAIN"),
];

test("one Tab from page load lands on the skip link, on every reviewed page", async () => {
  for (const { file, surface } of PAGES) {
    const document = await load(file);
    const first = pressTab(document);
    assert.ok(first, `${file} (${surface}) has no tab stop at all`);
    assert.equal(
      first.className,
      "skip-link",
      `${file} (${surface}): the first tab stop is "${textOf(first)}", not the skip link`,
    );
    assert.equal(first.tagName, "A");
    assert.equal(textOf(first), SKIP_TEXT, `${file}: the skip link must read "${SKIP_TEXT}"`);
    assert.equal(document.querySelectorAll(".skip-link").length, 1, `${file}: exactly one skip link, not two`);
  }
});

test("every reviewed page exposes exactly one main landmark, and the skip link targets it", async () => {
  for (const { file, surface } of PAGES) {
    const document = await load(file);
    const landmarks = mainLandmarks(document);
    assert.equal(landmarks.length, 1, `${file} (${surface}) exposes ${landmarks.length} main landmarks`);

    const [landmark] = landmarks;
    assert.ok(landmark.id, `${file}: the main landmark needs an id for the skip link to target`);
    assert.equal(
      document.querySelector(".skip-link").href,
      `#${landmark.id}`,
      `${file}: the skip link does not point at the main landmark`,
    );

    // Focus has to move, not just the scroll position. Only a focusable target
    // hands the keyboard to the content region, and tabindex="-1" is how a
    // landmark becomes focusable without joining the tab sequence itself.
    assert.equal(landmark.getAttribute("tabindex"), "-1", `${file}: the main landmark must be focusable`);
    assert.ok(
      !tabSequence(document).includes(landmark),
      `${file}: the landmark must not become a tab stop of its own`,
    );

    // The landmark is the content region, so the header and nav sit outside it:
    // skipping to a <main> that wraps the nav skips nothing.
    assert.equal(landmark.querySelectorAll("nav").length, 0, `${file}: the site nav is inside the main landmark`);
    assert.equal(landmark.querySelectorAll(".site-header").length, 0, `${file}: the site header is inside the main landmark`);
  }
});

test("activating the skip link goes to the landmark, past every site-frame tab stop", async () => {
  for (const { file } of PAGES) {
    const document = await load(file);
    const skip = pressTab(document);
    pressEnter(document);

    // Real activation, recorded by the harness. The browser then moves focus to
    // the target because it carries tabindex="-1" — the step above pins that.
    assert.deepEqual(document.navigations, [skip.href], `${file}: the skip link did not activate`);

    // What the one press is worth: every tab stop the reader no longer walks —
    // which is the stops *before* the landmark, not every stop outside it. The
    // site footer sits after the content region, so its controls are behind a
    // reader who has skipped, and counting them here would misreport the saving.
    const sequence = tabSequence(document);
    const landmark = document.querySelector(`#${skip.href.slice(1)}`);
    const inside = new Set(landmark.querySelectorAll("a,button,input,select,textarea"));
    const first = sequence.findIndex((stop) => inside.has(stop));
    assert.ok(first > 0, `${file}: the content region has no tab stop of its own`);
    const skipped = sequence.slice(0, first).filter((stop) => stop !== skip);
    assert.equal(skipped.length, 8, `${file}: expected the wordmark and seven nav links to be skipped`);
    assert.ok(skipped.every((stop) => stop.closest(".site-header")), `${file}: a content control sits outside <main>`);

    // And nothing the footer contributes may shadow the landmark: every stop it
    // owns follows the content region's own stops.
    const footer = new Set(document.querySelector("#site-footer").querySelectorAll("a,button,input,select,textarea"));
    assert.ok(sequence.some((stop) => footer.has(stop)), `${file}: the footer must be keyboard reachable`);
    assert.ok(
      sequence.filter((stop) => footer.has(stop)).every((stop) => sequence.indexOf(stop) > first),
      `${file}: a footer control precedes the main content in the tab order`,
    );
  }
});

/* ------------------------------ focus styling ----------------------------- */

function relativeLuminance(hex) {
  const channels = hex.length === 4
    ? [...hex.slice(1)].map((digit) => parseInt(digit + digit, 16))
    : [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  const [r, g, b] = channels.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground, background) {
  const [light, dark] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

// The two stylesheets the five reviewed pages load.
const STYLESHEETS = ["styles.css", "agents.css"];

test("the skip link is offscreen rather than removed, and readable once focused", async () => {
  for (const file of STYLESHEETS) {
    const css = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    const rule = css.match(/^\.skip-link \{([^}]*)\}/m)?.[1];
    assert.ok(rule, `${file} must style .skip-link`);

    // display:none, visibility:hidden and tabindex="-1" each take it out of the
    // accessibility tree or the tab order. Moving it out of the viewport does
    // neither, which is the whole point of a skip link.
    assert.doesNotMatch(rule, /display:\s*none/, `${file}: display:none removes the skip link from the tab order`);
    assert.doesNotMatch(rule, /visibility:\s*hidden/, `${file}: visibility:hidden removes it from the accessibility tree`);
    assert.match(rule, /transform:\s*translateY\(-\d+%\)/, `${file}: the resting state must sit outside the viewport`);

    const focusRule = css.match(/^\.skip-link:focus \{([^}]*)\}/m)?.[1];
    assert.ok(focusRule, `${file} must style .skip-link:focus`);
    assert.match(focusRule, /transform:\s*translateY\(0\)/, `${file}: focus must bring the skip link on screen`);
    assert.match(focusRule, /outline:\s*3px solid/, `${file}: the focused skip link needs a visible ring`);

    // Contrast is computed from the tokens the rule actually uses, so a later
    // colour edit fails here rather than shipping an unreadable link.
    const background = rule.match(/background:\s*(#[0-9a-f]{3,8})/i)[1];
    const color = rule.match(/[^-]color:\s*(#[0-9a-f]{3,8})/i)[1];
    const ratio = contrastRatio(color, background);
    assert.ok(
      ratio >= 4.5,
      `${file}: the focused skip link renders ${color} on ${background} at ${ratio.toFixed(2)}:1`,
    );
  }
});

test("the main landmark rings for keyboard focus only, never for a mouse click", async () => {
  for (const file of STYLESHEETS) {
    const css = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.match(css, /^\.page>main:focus \{ outline:none; \}$/m, `${file}: a click must not park a ring on the page`);
    assert.match(css, /^\.page>main:focus-visible \{ outline:3px solid/m, `${file}: keyboard focus must be visible`);
  }
});

/* --------------------------- the post page's order ------------------------ */

test("the post page's tab order is skip link, then the nav, then the exits", async () => {
  const document = await load("post.html");
  const sequence = tabSequence(document);

  assert.deepEqual(
    sequence.slice(0, 11).map((stop) => textOf(stop)),
    [
      SKIP_TEXT,
      "Shiplog",
      ...SITE_NAV.map((link) => link.label),
      "← Back to Social",
      "← Back to Profile",
    ],
    "the post page's tab order changed",
  );

  // Walked as keystrokes, not read off the list: eleven presses from page load.
  const walked = Array.from({ length: 11 }, () => textOf(pressTab(document)));
  assert.deepEqual(walked, sequence.slice(0, 11).map((stop) => textOf(stop)));
});

test("the post page's exits read after the site header, in the document, not in CSS", async () => {
  const document = await load("post.html");
  const landmark = document.querySelector("#main-content");
  for (const id of ["post-back-feed", "post-back"]) {
    const exit = document.querySelector(`#${id}`);
    assert.ok(exit.closest("#main-content"), `#${id} must sit inside the content region`);
    assert.equal(exit.closest(".site-header"), null, `#${id} must not sit in the site header`);
  }
  // Document order inside the landmark: exits, then the heading, then the panel.
  const order = landmark.querySelectorAll("#post-back-feed,#post-back,#page-title,#post-detail")
    .map((node) => node.id);
  assert.deepEqual(order, ["post-back-feed", "post-back", "page-title", "post-detail"]);

  // No CSS trick may stand in for that order — reading order is the point.
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const exitRule = css.match(/^\.detail-page-exits \{([^}]*)\}/m)[1];
  assert.doesNotMatch(exitRule, /row-reverse|order:\s*-?\d|position:\s*absolute/, "the exits must not be re-sequenced visually");
  const html = await read("post.html");
  assert.doesNotMatch(html.match(/<p class="detail-page-exits">[\s\S]*?<\/p>/)[0], /style=/);
});

test("the post page names both destinations it can honestly claim", async () => {
  const document = await load("post.html");
  const exits = document.querySelectorAll("#post-back-feed,#post-back");
  assert.deepEqual(
    exits.map((exit) => [exit.href, textOf(exit)]),
    [["/social.html", "← Back to Social"], ["/profile.html", "← Back to Profile"]],
    "each exit must name its destination in its own visible text",
  );
  // The visible text carries the destination, so no aria-label may hold a word
  // the eye cannot read.
  for (const exit of exits) assert.equal(exit.getAttribute("aria-label"), null);

  // /social.html is the feed route the rest of the site uses — the nav's Social
  // entry — rather than a path guessed for this page.
  assert.equal(exits[0].href, SITE_NAV.find((link) => link.label === "Social").href);
});
