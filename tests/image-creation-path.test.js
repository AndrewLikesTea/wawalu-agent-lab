// The route from browsing an image to making one.
//
// tests/paint-social-handoff.test.js covers the return leg — a finished drawing
// arriving at the Social composer. This covers the outbound one, which had no
// signposting at all: a visitor scrolling the Social feed or the People grid had
// only a nav item reading "Paint", which names a destination without saying what
// it is for, and the composer's own "Create in Paint" button sat several screens
// above them.
//
// What is pinned is what a keyboard user actually gets: a real anchor, in
// document order, inside the panel where the browsing happens, carrying a text
// label that says both the tool and the outcome — never an icon alone.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHtml, tabSequence, textOf } from "./support/browser.js";
import { SOCIAL_COMPOSER_PATH } from "../src/paint-handoff.js";
import { initPaint, paintReturnContext } from "../src/paint/paint.js";
import { profilePaintHref } from "../src/profile.js";

const PAINT_PATH = "/paint/";
/** The editor, with or without the provenance the origin surface writes on it. */
const opensPaint = (href) => href === PAINT_PATH || href.startsWith(`${PAINT_PATH}?`);

const PAGES = {
  Social: new URL("../src/social.html", import.meta.url),
  People: new URL("../src/profile.html", import.meta.url),
};

/** The browsing panel on each page: the feed, and the image grid. */
const BROWSING_PANEL = { Social: "post-feed", People: "profile-grid" };

const sources = Object.fromEntries(await Promise.all(
  Object.entries(PAGES).map(async ([name, url]) => [name, await readFile(url, "utf8")])));
const documents = Object.fromEntries(
  Object.entries(sources).map(([name, html]) => [name, parseHtml(html)]));

/** Every anchor on a page that points at the Paint editor. */
const paintLinks = (document) => document.querySelectorAll("a")
  .filter((anchor) => opensPaint(anchor.href));

for (const [name, document] of Object.entries(documents)) {
  test(`${name} offers a labelled way to create an image, beside the images it shows`, () => {
    const invitation = document.querySelector(".feed-create");
    assert.ok(invitation, `${name} has no route from browsing an image to making one`);

    const link = invitation.querySelector("a");
    assert.equal(link.tagName, "A", "the route is not an anchor, so it is not open-in-new-tab-able");
    assert.ok(opensPaint(link.href), `${name}'s route does not open Paint: ${link.href}`);
    // The label says the tool and the outcome. "Paint" alone names a
    // destination; "↗" alone names nothing.
    assert.match(textOf(link), /Create an image in Paint/);
    assert.doesNotMatch(textOf(link), /^[^A-Za-z]*$/, "the label carries no words");

    // The sentence around it says where the image goes afterwards, so the route
    // is legible before it is taken.
    assert.match(textOf(invitation), /post|attach/i);
  });

  test(`${name} keeps the Paint route in the keyboard sequence, before the browsing panel`, () => {
    const sequence = tabSequence(document);
    const link = document.querySelector(".feed-create").querySelector("a");
    assert.ok(sequence.includes(link), `${name}'s Paint route is not keyboard reachable`);

    // Ahead of the browsing region it introduces: a reader tabbing through the
    // feed meets the invitation before the images, not after however many of
    // them there happen to be.
    assert.ok(document.getElementById(BROWSING_PANEL[name]),
      `${name} has no ${BROWSING_PANEL[name]} region`);
    assert.ok(sources[name].indexOf('class="feed-create')
      < sources[name].indexOf(`id="${BROWSING_PANEL[name]}"`),
    `${name} authors its Paint route after the images it is meant to introduce`);
  });
}

test("People names both ends of the route: the editor and the feed the image returns to", () => {
  const invitation = documents.People.querySelector(".feed-create");
  const hrefs = invitation.querySelectorAll("a").map((anchor) => anchor.href);
  assert.deepEqual(hrefs, ["/paint/?from=profile", SOCIAL_COMPOSER_PATH]);
});

test("the composer's own Paint control is unchanged and still labelled in words", () => {
  const links = paintLinks(documents.Social);
  // Three: the site nav, the composer's media picker, and the feed invitation.
  assert.equal(links.length, 3, "the number of routes into Paint from Social changed");
  const composer = documents.Social.querySelector(".media-source-actions").querySelector("a");
  assert.equal(composer.href, PAINT_PATH);
  assert.match(textOf(composer), /Create in Paint/);
});

/* ------------------------------ the way back ------------------------------ */
// Paint is a full-screen workspace with no site navigation, so the route out is
// one link. What is pinned here is that taking the outbound route hands Paint
// enough to point that link back at the surface the reader actually left.

test("taking the People route out lands in Paint with a back link to People", () => {
  const link = documents.People.querySelector(".feed-create").querySelector("a");
  const search = link.href.slice(PAINT_PATH.length);
  assert.deepEqual(paintReturnContext(search), {
    href: "/profile.html",
    label: "Back to People",
  });

  // profile.js upgrades the same href with the selected display name, and that
  // returns to the exact profile rather than the default persona.
  const named = paintReturnContext(profilePaintHref("Mina O'Neil").slice(PAINT_PATH.length));
  assert.equal(named.href, "/profile.html?author=Mina%20O'Neil");
  assert.equal(named.label, "Back to People");
});

test("taking a Social route out lands in Paint with a back link to Social", () => {
  for (const link of paintLinks(documents.Social)) {
    const search = link.href.slice(PAINT_PATH.length);
    assert.deepEqual(paintReturnContext(search), {
      href: SOCIAL_COMPOSER_PATH,
      label: "Back to Social",
    });
  }
});

test("Paint ships the return link as a visible, keyboard-reachable anchor in its header", async () => {
  const html = await readFile(new URL("../src/paint/index.html", import.meta.url), "utf8");
  const document = parseHtml(html);
  const back = document.getElementById("paint-return");
  assert.ok(back, "Paint has no return link");
  assert.equal(back.tagName, "A", "the way out is not an anchor");
  assert.ok(tabSequence(document).includes(back), "Paint's return link is not keyboard reachable");

  // Named, and named in words: not an arrow, and not "back" pointing nowhere.
  assert.match(textOf(back), /^Back to (Social|People)$/);
  // It sits in the document actions, ahead of the canvas, so it is reached
  // before the editing surface rather than after everything in it.
  assert.ok(html.indexOf('id="paint-return"') < html.indexOf('id="editor-canvas"'));
  // Nothing hides it at a narrow width — the workspace it escapes is widest
  // exactly where the reader has least room.
  const css = await readFile(new URL("../src/paint/paint.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.return-action \{[^}]*display:\s*none/);
});

// The smallest shell initPaint touches for this: the one link, and the document
// element the theme is written to. Everything else it reaches for is optional.
function paintShell(search) {
  const back = { tagName: "A", href: "/social.html", textContent: "Back to Social" };
  return {
    back,
    root: {
      documentElement: { dataset: {} },
      querySelector: (selector) => (selector === "#paint-return" ? back : null),
    },
    environment: { location: { search } },
  };
}

test("Paint rewrites its one back link to the surface the visitor actually left", () => {
  const fromPeople = paintShell(profilePaintHref("Mina O'Neil").slice(PAINT_PATH.length));
  initPaint(fromPeople.root, fromPeople.environment);
  assert.equal(fromPeople.back.href, "/profile.html?author=Mina%20O'Neil");
  assert.equal(fromPeople.back.textContent, "Back to People");

  // Opened cold — a bookmark, a new tab, the nav — the link still names a
  // destination rather than going missing.
  const cold = paintShell("");
  initPaint(cold.root, cold.environment);
  assert.equal(cold.back.href, "/social.html");
  assert.equal(cold.back.textContent, "Back to Social");
});
