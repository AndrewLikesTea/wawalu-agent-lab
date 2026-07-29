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

const PAINT_PATH = "/paint/";

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
  .filter((anchor) => anchor.href === PAINT_PATH);

for (const [name, document] of Object.entries(documents)) {
  test(`${name} offers a labelled way to create an image, beside the images it shows`, () => {
    const invitation = document.querySelector(".feed-create");
    assert.ok(invitation, `${name} has no route from browsing an image to making one`);

    const link = invitation.querySelector("a");
    assert.equal(link.tagName, "A", "the route is not an anchor, so it is not open-in-new-tab-able");
    assert.equal(link.href, PAINT_PATH);
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
  assert.deepEqual(hrefs, [PAINT_PATH, SOCIAL_COMPOSER_PATH]);
});

test("the composer's own Paint control is unchanged and still labelled in words", () => {
  const links = paintLinks(documents.Social);
  // Three: the site nav, the composer's media picker, and the feed invitation.
  assert.equal(links.length, 3, "the number of routes into Paint from Social changed");
  const composer = documents.Social.querySelector(".media-source-actions").querySelector("a");
  assert.equal(composer.href, PAINT_PATH);
  assert.match(textOf(composer), /Create in Paint/);
});
