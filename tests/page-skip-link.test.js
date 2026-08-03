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
import { readdir, readFile } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMOS } from "../src/site-footer.js";
import { SITE_NAV } from "../src/site-nav.js";
import { parseHtml, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";

// Every page whose content region begins with its own interactive control, so
// the full keystroke walk below — skip, then land inside main — has something
// to land on. The home page is both the front door and the decisions list.
// Issue 348 reviewed the first five; issue 378 found the AI FinOps tab and the
// published prompt trace had never been converted and added them here.
//
// A page whose content region is empty until its module renders (the release
// detail, the Savings Action Center) cannot be walked this way from static
// markup. Those are covered structurally by the enumerating guard at the foot
// of this file, which no page can fall out of.
const PAGES = [
  { file: "index.html", surface: "home and decisions list" },
  { file: "decision.html", surface: "single decision" },
  { file: "post.html", surface: "single post" },
  { file: "releases.html", surface: "releases" },
  { file: "agents.html", surface: "agent observatory" },
  { file: "social.html", surface: "social feed" },
  { file: "profile.html", surface: "profile" },
  { file: "evolution.html", surface: "AI FinOps" },
  { file: "coach.html", surface: "prompt coach" },
  { file: "personal-history.html", surface: "personal AI history" },
  { file: "agent-trace.html", surface: "published prompt trace" },
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

    // The landmark is the content region, so the header and the site nav sit
    // outside it: skipping to a <main> that wraps the site nav skips nothing.
    //
    // Written as "no *site* nav" rather than "no nav at all", which is what it
    // used to say. In-page wayfinding inside the content region is legitimate —
    // the AI FinOps workspace rail is one — and the requirement for it is not
    // that it be absent but that a screen-reader user can tell it apart from the
    // site nav, which means an accessible name of its own.
    assert.equal(landmark.querySelectorAll(".site-nav").length, 0, `${file}: the site nav is inside the main landmark`);
    for (const nav of landmark.querySelectorAll("nav")) {
      const labelledBy = nav.getAttribute("aria-labelledby");
      const name = labelledBy
        ? textOf(document.getElementById(labelledBy) ?? { textContent: "" })
        : (nav.getAttribute("aria-label") ?? "");
      assert.ok(name, `${file}: a navigation landmark inside <main> has no accessible name`);
      assert.notEqual(name, document.querySelector(".site-nav")?.getAttribute("aria-label"),
        `${file}: an in-page nav shares its name with the site nav`);
    }
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
    // Counted from the nav itself rather than written down: a destination added
    // to the link set changes what one press is worth, and this number moving
    // with it is the point.
    assert.equal(skipped.length, SITE_NAV.length + 1,
      `${file}: expected the wordmark and every nav link to be skipped`);
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

/* --------------------------- the enumerating guard ------------------------ */

// PAGES above is hand-written, so it can only fail for a page somebody
// remembered to add. This test cannot be forgotten: it derives the page list
// from the routing source of truth instead of from a literal.
//
// That source of truth is the src/ tree itself. Every surface here is static
// HTML and scripts/build.mjs copies src/ into dist/ verbatim — no router, no
// manifest, no generated pages — so "the routes the site serves" and "the .html
// files under src/" are the same set by construction. Walking the directory is
// walking the route table, and a page added tomorrow is enumerated the moment
// its file exists.
//
// There is no exclusion list, and adding one would defeat the point. Every page
// is renderable from its shipped markup with no fixture parameters: the detail
// pages read their id from the query string at runtime and still serve the same
// document frame. The Paint editor is the one page whose destination is not the
// main landmark — it skips to the canvas, which is the content a reader came
// for — and it is held to the same three requirements as the rest rather than
// waived.

const SRC = new URL("../src/", import.meta.url);
const SRC_PATH = fileURLToPath(SRC);

async function servedPages() {
  const entries = await readdir(SRC_PATH, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    // Recorded as a route-relative path so a failure names the URL, not a file.
    .map((entry) => `${relative(SRC_PATH, entry.parentPath)}/${entry.name}`.replace(/^\//, ""))
    .sort();
}

// Natively focusable, or made focusable by a tabindex of any value. A skip link
// that lands on neither moves the scroll position and leaves the keyboard where
// it was, which is the failure this whole file exists to prevent.
const isFocusable = (node) =>
  node.getAttribute("tabindex") !== null
  || ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(node.tagName);

test("every page the build serves ships a skip link, enumerated from src/ rather than listed", async () => {
  const pages = await servedPages();

  // A glob that silently matched nothing would make every assertion below
  // vacuous, so the enumeration has to find at least the pages already pinned.
  assert.ok(pages.length >= PAGES.length, `only ${pages.length} pages enumerated`);
  for (const { file } of PAGES) assert.ok(pages.includes(file), `${file} is not enumerated from src/`);

  for (const route of pages) {
    const document = parseHtml(await readFile(new URL(route, SRC), "utf8"));

    const links = document.querySelectorAll(".skip-link");
    assert.equal(links.length, 1, `/${route} renders ${links.length} skip links`);

    // First in the tab sequence, by document order — not by where CSS paints it.
    assert.equal(
      tabSequence(document)[0],
      links[0],
      `/${route}: the first tab stop is "${textOf(tabSequence(document)[0])}", not the skip link`,
    );

    // The link has to have somewhere to go, and focus has to be able to land there.
    const href = links[0].href;
    assert.match(href, /^#\S+$/, `/${route}: the skip link points at "${href}" rather than a fragment on the page`);
    const target = document.querySelector(href);
    assert.ok(target, `/${route}: the skip link targets ${href}, which no element on the page carries`);
    assert.ok(isFocusable(target), `/${route}: ${href} cannot take focus, so the link only scrolls`);
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

// The test above reads one stylesheet at a time. That is not the same question
// as "is the link readable on this page": a page loads more than one sheet, and
// a later one could restyle .skip-link into its own palette. Issue 378 asked
// for the computed pair on the two pages it converted, so this walks the cascade
// each page actually assembles from its own <link> tags, in load order.
//
// Only the pages carrying the site frame are walked. The Paint editor states its
// skip link in theme custom properties that switch with a light/dark toggle, so
// its pair is not two literals and belongs with tests/paint-shell.test.js; the
// enumerating guard above still holds it to shipping a working link.
async function pageStylesheets(html) {
  const hrefs = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(([, href]) => href);
  return Promise.all(hrefs.map((href) => readFile(new URL(href.replace(/^\//, ""), SRC), "utf8")));
}

// Last declaration wins, which is what the cascade does for rules of equal
// specificity — the only kind any sheet here writes for .skip-link.
function declared(sheets, selector, property) {
  const rules = new RegExp(`^\\${selector} \\{([^}]*)\\}`, "gm");
  let value = null;
  for (const css of sheets) {
    for (const [, body] of css.matchAll(rules)) {
      const match = body.match(new RegExp(`(?:^|[;\\s])${property}:\\s*(#[0-9a-f]{3,8})`, "i"));
      if (match) value = match[1];
    }
  }
  return value;
}

test("the focused skip link clears 4.5:1 against what it is actually painted on", async () => {
  for (const { file, surface } of PAGES) {
    const sheets = await pageStylesheets(await read(file));
    const background = declared(sheets, ".skip-link", "background");
    const color = declared(sheets, ".skip-link", "color");
    assert.ok(background && color, `${file} (${surface}): no sheet it loads gives .skip-link a colour pair`);

    // The link is position:fixed with an opaque background of its own, so the
    // page's backdrop never shows through and this pair is the whole contrast
    // question. A sheet that dropped the background would break that assumption,
    // which is why the assertion above is not optional.
    const ratio = contrastRatio(color, background);
    assert.ok(
      ratio >= 4.5,
      `${file} (${surface}): the focused skip link renders ${color} on ${background} at ${ratio.toFixed(2)}:1`,
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

const FRAME_STOPS = SITE_NAV.length + 4;

test("the post page's tab order is skip link, then the nav, then its two pointers", async () => {
  const document = await load("post.html");
  const sequence = tabSequence(document);

  assert.deepEqual(
    sequence.slice(0, FRAME_STOPS).map((stop) => textOf(stop)),
    [
      SKIP_TEXT,
      "Shiplog",
      ...SITE_NAV.map((link) => link.label),
      "Open Social to read the whole feed",
      "Open People to see the image posts published under one display name",
    ],
    "the post page's tab order changed",
  );

  // Walked as keystrokes, not read off the list: one press per frame stop.
  const walked = Array.from({ length: FRAME_STOPS }, () => textOf(pressTab(document)));
  assert.deepEqual(walked, sequence.slice(0, FRAME_STOPS).map((stop) => textOf(stop)));

  // After the pointers, the next stops a keyboard reader reaches are the footer's:
  // its site map, in the band's own order, and then the contact trigger.
  // Nothing the shipped post markup contains sits between them — the image and
  // the caption are rendered by post-detail.js and carry no links of their own
  // (a caption is text, never markup — PRODUCT.md), so the order the review
  // asked for — exit, image link, caption links, footer — holds with its middle
  // two steps empty.
  const afterExit = sequence.slice(FRAME_STOPS).map((stop) => textOf(stop));
  assert.deepEqual(
    afterExit.slice(0, DEMOS.length + 1),
    [...DEMOS.map((demo) => demo.label), "Request a follow-up"],
  );
  assert.ok(
    sequence.slice(FRAME_STOPS).every((stop) => stop.closest("#site-footer")),
    "a control on the post page sits between the pointers and the footer",
  );
});

test("the post page's pointers read after the site header, in the document, not in CSS", async () => {
  const document = await load("post.html");
  const landmark = document.querySelector("#main-content");
  const exit = document.querySelector("#post-back");
  assert.ok(exit.closest("#main-content"), "the pointers must sit inside the content region");
  assert.equal(exit.closest(".site-header"), null, "the pointers must not sit in the site header");

  // Document order inside the landmark: the exit, then the heading, then the panel.
  const order = landmark.querySelectorAll("#post-back,#page-title,#post-detail").map((node) => node.id);
  assert.deepEqual(order, ["post-back", "page-title", "post-detail"]);

  // No CSS trick may stand in for that order — reading order is the point.
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const exitRule = css.match(/^\.detail-page-exits \{([^}]*)\}/m)[1];
  assert.doesNotMatch(exitRule, /row-reverse|order:\s*-?\d|position:\s*absolute/, "the exit must not be re-sequenced visually");
  const html = await read("post.html");
  assert.doesNotMatch(html.match(/<p class="detail-page-exits">[\s\S]*?<\/p>/)[0], /style=/);
});

test("the post page ships two pointers, each naming its own destination in its own text", async () => {
  const document = await load("post.html");
  const exits = document.querySelector("#main-content").querySelectorAll(".detail-back");
  // Two destinations, never two links to one: two stacked routes to the same
  // page is the bug this replaced.
  assert.equal(exits.length, 2, "the page offers Social and People, and nothing else");
  assert.deepEqual(exits.map((link) => link.href), ["/social.html", "/profile.html"]);
  assert.deepEqual(
    exits.map((link) => textOf(link)),
    [
      "Open Social to read the whole feed",
      "Open People to see the image posts published under one display name",
    ],
  );

  // The visible text carries the destination, so no aria-label may hold a word
  // the eye cannot read.
  for (const link of exits) assert.equal(link.getAttribute("aria-label"), null);

  // The routes the rest of the site uses — the nav's own Social and People
  // entries — rather than paths guessed for this page.
  assert.equal(exits[0].href, SITE_NAV.find((link) => link.label === "Social").href);
  assert.equal(exits[1].href, SITE_NAV.find((link) => link.label === "People").href);
});

test("every interactive control on the post page inherits the site's focus ring", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  // The exit, the retry button and any link a caption or image grows all pick up
  // one of these rules; none of them restyles :focus-visible for itself.
  assert.match(css, /^\.detail-back:focus-visible \{ outline:3px solid var\(--focus-ring\)/m);
  assert.match(css, /:focus-visible[^{]*\{[^}]*outline:3px solid var\(--focus-ring\)/);
  const postCss = css.match(/^\.detail-(image|caption|post|media|date)[^{]*\{[^}]*\}/gm) ?? [];
  for (const rule of postCss) {
    const selector = rule.split("{")[0].trim();
    // One of these is focusable, and only on purpose: post-page.js sends focus
    // to .detail-post after a successful retry so the reader lands on the post
    // rather than at the top of the document. It gets the site's ring in the
    // site's colour — offset and radius are the only things it may set for
    // itself, because a ring drawn tight against an image reads as a border.
    if (selector.endsWith(":focus-visible")) {
      assert.match(rule, /outline:3px solid var\(--focus-ring\)/, `${selector} must use the site's ring, not its own`);
      continue;
    }
    assert.doesNotMatch(rule, /outline/, `${selector} must not restyle the ring`);
  }
});
