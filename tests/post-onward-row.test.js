// The permalink's onward-navigation row (#1757).
//
// A shared post used to be a page a visitor could only leave by the browser's
// own back button or the site nav: it said what the post was and then stopped.
// The row under the post is the answer — the three things a reader who has just
// finished a forwarded post can want next, in the order they narrow from this
// one post outward:
//
//   1. more from the person who wrote it,
//   2. the whole feed it came from,
//   3. writing one of their own.
//
// Which of the three are on the page depends on what the lookup found, and this
// file's claim is that the row and the post's own state can never disagree: the
// link about a display name exists only where a post supplied one, so it can
// never stand beside "Post unavailable".
//
// Harness notes, all learned the hard way in this repo: no `*` selector and no
// descendant selectors, no node compared against null (it walks the whole parsed
// page and outlives the timeout — count instead), and properties are read as
// properties. Nothing here waits on a class shared with a loading skeleton.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { profileHref } from "../src/social-links.js";
import { POST_EXITS, postPeopleLabel } from "../src/post-detail.js";

const SEED_URL = "/social-demo-data.json";

// A display name with a space in it, so the href assertion below is about a
// name that has to be encoded rather than one that survives being pasted in.
const AUTHOR = "Ari Okonkwo";

const POST = {
  id: "p-onward",
  author: AUTHOR,
  body: "The row under a forwarded post now says where to go next.",
  caption: "Three ways on from one post.",
  createdAt: "2026-07-20T10:15:00.000Z",
  likes: 2,
  comments: 0,
};

const seedResponse = (posts) => ({ ok: true, status: 200, json: async () => ({ posts }) });
const seedOnly = (posts) => (url) => {
  if (url === SEED_URL) return seedResponse(posts);
  throw new Error(`Unexpected request: ${url}`);
};

async function openPostPage(search, answer) {
  const page = await loadPage(new URL("../src/post.html", import.meta.url), { location: { search } });
  globalThis.fetch = async (url) => answer(String(url));
  await importPageModule("/post-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "ready", `the post page settled for ${search}`);
  return { ...page, panel: page.document.querySelector("#post-detail") };
}

// The row itself, read as what it is: the links in the exits paragraph, in
// document order. Read off the class the page's own routes carry, so a control
// added to the row without that class — and therefore without the site's
// spacing and focus ring — fails here rather than passing unnoticed.
const rowOf = (document) => document.querySelectorAll(".detail-back");

const PEOPLE_LABEL = postPeopleLabel(AUTHOR);
const SOCIAL_LABEL = POST_EXITS.social.label;
const PUBLISH_LABEL = POST_EXITS.publish.label;

/* -------------------------------- loaded ---------------------------------- */

test("a loaded post offers all three ways on, narrowest first, and names the display name in the first", async () => {
  const page = await openPostPage("?id=p-onward", seedOnly([POST]));
  try {
    const row = rowOf(page.document);
    assert.equal(row.length, 3, "a loaded post offers exactly three ways on");
    assert.deepEqual(row.map(textOf), [PEOPLE_LABEL, SOCIAL_LABEL, PUBLISH_LABEL]);

    // The first names the person, in the visible text rather than in a title or
    // an aria-label: a reader scanning the row can tell whose posts it leads to.
    assert.ok(row[0].textContent.includes(AUTHOR), "the People route must name the display name it leads to");
    // And it goes where the feed's own author links go — the same builder, not a
    // query string assembled a second time for this page.
    assert.equal(row[0].getAttribute("href"), profileHref(AUTHOR));
    assert.equal(row[0].getAttribute("href"), "/profile.html?author=Ari%20Okonkwo");

    // The feed link is untouched, words and target both.
    assert.equal(row[1].getAttribute("href"), POST_EXITS.social.href);
    // The composer is reached at Social's own publish anchor.
    assert.equal(row[2].getAttribute("href"), POST_EXITS.publish.href);
  } finally {
    page.restore();
  }
});

test("every control in the row is a real link with its own words, reachable by Tab in reading order", async () => {
  const page = await openPostPage("?id=p-onward", seedOnly([POST]));
  try {
    const row = rowOf(page.document);
    const sequence = tabSequence(page.document);
    const stops = row.map((link) => sequence.indexOf(link));

    for (const [index, link] of row.entries()) {
      // A real anchor, not a div with a handler: that is where the site's
      // visible focus ring and Enter-to-follow come from.
      assert.equal(link.tagName, "A", "a route onward must be an anchor");
      assert.ok(link.getAttribute("href"), "a route onward must have somewhere to go");
      // Words of its own. Nothing in this row is told apart by colour, and no
      // aria-label carries a destination the eye cannot read.
      assert.ok(textOf(link).trim().length > 0, "a route onward must carry its own label");
      assert.equal(link.getAttribute("aria-label"), null);
      // The site's existing link classes, so the row costs styles.css nothing.
      assert.equal(link.className, "detail-back detail-page-back");
      assert.ok(stops[index] >= 0, "a route onward must be reachable by Tab");
      link.focus();
      assert.equal(page.document.activeElement, link, "a route onward must be able to hold focus");
    }

    // Tab order is reading order: the row is three links in the document, not
    // three boxes a stylesheet put in a different sequence.
    assert.deepEqual(stops.slice().sort((a, b) => a - b), stops);
    // And the post itself is read before any of them.
    const author = page.panel.querySelector(".detail-author-link");
    assert.ok(sequence.indexOf(author) < stops[0], "the post's own links precede the row");
  } finally {
    page.restore();
  }
});

// The classes the row uses are the site's, and they carry a visible ring. No
// new colour, type scale or spacing value was minted for this row.
test("the row's controls take the site's own link styling and focus ring", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /^\.detail-back:focus-visible \{ outline:3px solid var\(--focus-ring\)/m);
  assert.match(css, /^\.detail-page-back \{/m);
  assert.match(css, /^\.detail-page-exits \{/m);
  // Three links wrap inside the row the flex rule already declares, so nothing
  // needed a rule of its own.
  assert.match(css.match(/^\.detail-page-exits \{([^}]*)\}/m)[1], /flex-wrap:wrap/);
  assert.equal(/#post-publish|#post-people|#post-back/.test(css), false,
    "the row must not add an id-keyed rule for a control the shared classes already style");
});

/* --------------------------- loading, and after --------------------------- */

test("while the lookup runs the row offers the feed and the composer, and nothing about a display name", async () => {
  const page = await loadPage(new URL("../src/post.html", import.meta.url), { location: { search: "?id=p-onward&author=Ari%20Okonkwo" } });
  try {
    let release;
    globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(seedResponse([POST])); });
    await importPageModule("/post-page.js");
    const panel = page.document.querySelector("#post-detail");
    await waitFor(() => panel.querySelectorAll(".detail-loading").length === 1, "the loading state rendered");

    // The feed link is there, which is what a reader who gives up on the wait
    // needs. Counted, not compared against null.
    assert.deepEqual(rowOf(page.document).map(textOf), [SOCIAL_LABEL, PUBLISH_LABEL]);
    assert.equal(page.document.querySelectorAll("#post-people").length, 0,
      "no link about a display name may exist before a post has named one");
    // Not even though the arriving URL claimed one: a claim in a link somebody
    // pasted is not a name this page resolved.
    assert.equal(textOf(page.document.querySelector("#main-content")).includes(AUTHOR), false);

    release();
    await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "ready", "the post arrived");

    // And once the name is known it is added at the front of the row, without
    // disturbing the two that were already standing there.
    assert.deepEqual(rowOf(page.document).map(textOf), [PEOPLE_LABEL, SOCIAL_LABEL, PUBLISH_LABEL]);
  } finally {
    page.restore();
  }
});

/* --------------------------- no post to point at -------------------------- */

// Both unresolved answers, and the same row: the feed and the composer are true
// whatever the lookup did, and the third link's words are about a person this
// page never resolved.
const NO_POST = [
  ["not found", "?id=p-missing", seedOnly([POST]), "Post unavailable"],
  ["not found, with a display name in the URL", "?id=p-missing&author=Ari%20Okonkwo", seedOnly([POST]), "Post unavailable"],
  ["error", "?id=p-onward", () => { throw new TypeError("Failed to fetch"); }, "Post could not be opened"],
];

test("a state with no post keeps the feed and the composer, and never shows a link about a display name", async () => {
  for (const [where, search, answer, headline] of NO_POST) {
    const page = await openPostPage(search, answer);
    try {
      assert.deepEqual(rowOf(page.document).map(textOf), [SOCIAL_LABEL, PUBLISH_LABEL], `${where}: the row`);
      assert.equal(rowOf(page.document)[1].getAttribute("href"), POST_EXITS.publish.href, `${where}: the composer route`);
      assert.equal(page.document.querySelectorAll("#post-people").length, 0, `${where}: a link about a display name survived`);

      // One state at a time, stated as the thing that must never co-occur: the
      // page says it has no post *and* offers a link about that post's author.
      const main = textOf(page.document.querySelector("#main-content"));
      assert.ok(main.includes(headline), `${where}: the state must say what happened`);
      assert.equal(main.includes(PEOPLE_LABEL), false, `${where}: "${headline}" is standing beside a People link`);
      assert.equal(main.includes(AUTHOR), false, `${where}: a display name the page never resolved is on screen`);

      // The row is outside the region every render empties, which is why it
      // survives a state change at all.
      assert.equal(page.panel.querySelectorAll(".detail-back").length, 0, `${where}: the row must sit in the page frame`);
    } finally {
      page.restore();
    }
  }
});
