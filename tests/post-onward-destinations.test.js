// The shared post page's two onward destinations, and the arrival at the end of
// the second one.
//
// A permalink is the one page in this product met cold, from a link pasted into
// a chat window. It offers a way to read more and a way to write something, and
// both of them land on /social.html — so the *href* is not what tells them
// apart, the label is. They used to open on the same two words ("Open the full
// Social feed", "Open Social to publish a post of your own"), which put one
// destination on the page phrased twice, and a reader had to get to the ninth
// word of the second before the two came apart.
//
// This file holds the whole slice honest, both halves of it:
//   * the page ships two links, with two hrefs and two names, as siblings in
//     one row — in the loading state a cold visitor meets first *and* in the
//     loaded state, because the row is authored markup on one path and driven
//     by post-page.js on the other;
//   * and the second href is not a promise the destination breaks. A link named
//     for an act has to land the reader somewhere they can perform it, so
//     Social opens its composer on that fragment and puts the caret in the
//     first field — without binding a key, so Tab still carries them through
//     the rest of the fields and back out.
//
// Harness notes this file depends on: a queried node is never compared against
// null (that walks the whole parsed page and outlives the timeout), text nodes
// live in node.children with a truthy tagName so element filtering goes through
// getAttribute, and textOf reads through anything collapsed — so the loading
// assertions are on link nodes and attributes rather than on page text.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, pressTab, tabSequence, textOf } from "./support/browser.js";
import { POST_EXITS } from "../src/post-detail.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const POST_PAGE = new URL("../src/post.html", import.meta.url);
const SOCIAL_PAGE = new URL("../src/social.html", import.meta.url);

const FEED_NAME = "Open Social to read the whole feed";
const PUBLISH_NAME = "Publish a post";
const FEED_HREF = "/social.html";
const PUBLISH_HREF = "/social.html#post-form";

const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";

const SEED_POST = {
  id: "p-image",
  author: "Mina Okafor",
  body: "Focus rings landed everywhere.",
  caption: "The middle card, ringed.",
  createdAt: "2026-07-14T09:00:00.000Z",
  likes: 3,
  comments: 1,
};

const seedResponse = (posts) => ({ ok: true, status: 200, json: async () => ({ posts }) });

// The accessible name of a link whose name comes from its own words: there is
// no aria-label, no aria-labelledby and no title standing in for text the eye
// cannot read, so the name is the text — and this asserts that as well as
// reading it, because a label attribute would silently win over the words.
function accessibleName(link, where) {
  for (const attribute of ["aria-label", "aria-labelledby", "title"]) {
    assert.equal(link.getAttribute(attribute), null,
      `${where}: ${link.id} names itself with ${attribute} instead of visible words`);
  }
  return textOf(link);
}

// Two links, two hrefs, two names, side by side in one row.
//
// "Siblings" is asserted as a shared parent *and* as neither being an ancestor
// of the other, walked through parentNode. Index arithmetic would not do: this
// harness keeps text nodes in node.children, so a position read off children is
// not the position a browser gives.
function assertTwoDestinations(document, where) {
  const row = document.querySelector(".detail-page-exits");
  const feed = document.querySelector("#post-back");
  const publish = document.querySelector("#post-publish");

  // Present and offered. A withheld link is not a route: this harness models no
  // layout, so a hidden one still carries its words and would read as offered.
  assert.equal(document.querySelectorAll("#post-back").length, 1, `${where}: one feed route`);
  assert.equal(document.querySelectorAll("#post-publish").length, 1, `${where}: one publish route`);
  assert.ok(!feed.hidden, `${where}: the feed route is withheld`);
  assert.ok(!publish.hidden, `${where}: the publish route is withheld`);

  // Two destinations, not one written twice.
  assert.equal(feed.getAttribute("href"), FEED_HREF, `${where}: the feed route's destination`);
  assert.equal(publish.getAttribute("href"), PUBLISH_HREF, `${where}: the publish route's destination`);
  assert.notEqual(feed.getAttribute("href"), publish.getAttribute("href"),
    `${where}: both routes lead to the same URL`);

  // …and two names. The publish route's name is exactly the string Social uses
  // for the same act on the control that opens its composer, on the composer's
  // heading, and on its submit button — not a sentence containing that string,
  // which is what "Open Social to publish a post of your own" was.
  assert.equal(accessibleName(feed, where), FEED_NAME, `${where}: the feed route's name`);
  assert.equal(accessibleName(publish, where), PUBLISH_NAME, `${where}: the publish route's name`);
  assert.notEqual(accessibleName(feed, where), accessibleName(publish, where));

  // Siblings in the onward row: neither is inside the other's sentence, and
  // neither is nested in the other.
  assert.ok(feed.closest(".detail-page-exits"), `${where}: the feed route left the onward row`);
  assert.ok(publish.closest(".detail-page-exits"), `${where}: the publish route left the onward row`);
  // Compared as booleans, never as nodes: a failing node comparison serialises
  // the whole parsed page and outlives the timeout.
  assert.equal(feed.parentNode === publish.parentNode, true, `${where}: the two routes are not siblings`);
  assert.equal(feed.parentNode === row, true, `${where}: the routes sit outside the row they are drawn in`);
  for (const [inner, outer] of [[feed, publish], [publish, feed]]) {
    let nested = false;
    for (let cursor = inner.parentNode; cursor; cursor = cursor.parentNode) if (cursor === outer) nested = true;
    assert.equal(nested, false, `${where}: ${inner.id} is nested inside ${outer.id}`);
  }

  // Both reachable by keyboard, in reading order.
  const sequence = tabSequence(document);
  assert.ok(sequence.indexOf(feed) >= 0, `${where}: the feed route is not a tab stop`);
  assert.ok(sequence.indexOf(feed) < sequence.indexOf(publish), `${where}: the publish route precedes the feed`);
}

test("the shared post page offers two named destinations before its lookup answers", async (t) => {
  // The shipped markup, with no module imported: the state a cold visitor meets
  // in the frame before a line of this page's script has run.
  const page = await loadPage(POST_PAGE, { location: { search: "?id=p-image" } });
  t.after(() => page.restore());

  assert.equal(page.document.querySelector("#post-detail").dataset.postState, "loading",
    "this is meant to be the loading state");
  assertTwoDestinations(page.document, "the shipped loading markup");

  // The script's own loading render agrees with the markup it replaced: it may
  // narrow the People route, and it must leave these two exactly as shipped.
  let release;
  globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(seedResponse([SEED_POST])); });
  await importPageModule("/post-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "loading",
    "the script took the region");
  assertTwoDestinations(page.document, "the script's loading state");

  release();
  await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "ready", "the post arrived");

  // And the loaded state, which is the other render path: the row survives it
  // unchanged, because it lives outside #post-detail, which every render empties.
  assertTwoDestinations(page.document, "the loaded state");
  assert.deepEqual(
    [POST_EXITS.social.label, POST_EXITS.publish.label],
    [FEED_NAME, PUBLISH_NAME],
    "the shipped words and the module's constants disagree",
  );
});

// The other end of the publish route. Social's composer ships collapsed, so a
// fragment naming it has to open it — and a link named for an act has to leave
// the reader able to perform it, which means the caret in the first field and
// not on the site header several tab stops above.
async function openSocial(t, hash) {
  const page = await loadPage(SOCIAL_PAGE, { routes: { [SEED_ROUTE]: { posts: [] }, [LIVE_ROUTE]: { posts: [] } } });
  const savedLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  // src/social-page.js reads globalThis.location, which this runtime does not
  // ship; loadPage installs window.location only.
  Object.defineProperty(globalThis, "location", {
    value: { hash, search: "", origin: "https://labs.wawalu.org" },
    configurable: true,
    writable: true,
  });
  // The feed polls on a timer that would outlast the test.
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  t.after(() => {
    globalThis.setInterval = savedInterval;
    if (savedLocation) Object.defineProperty(globalThis, "location", savedLocation);
    else delete globalThis.location;
    page.restore();
  });
  await importPageModule("/social-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogSocial === "ready", "Social finished its first load");
  return page;
}

test("arriving on Social at the publish fragment lands the reader in the open composer", async (t) => {
  const { document } = await openSocial(t, "#post-form");

  const panel = document.querySelector("#post-compose-panel");
  const trigger = document.querySelector("#post-compose-open");
  // Expanded, and saying so: the trigger owns the disclosure's state, so a
  // panel revealed without it is a control lying about what is on screen.
  assert.ok(!panel.hidden, "the composer stayed collapsed under the fragment that names it");
  assert.equal(trigger.getAttribute("aria-expanded"), "true");

  // Focus is inside the composer — the post field, which is what open() does
  // for the trigger too, so a link into the form and a press of the button
  // leave the reader in the same place.
  const focused = document.activeElement;
  assert.equal(focused.id, "post-body", "the arrival left the caret outside the composer");
  let inside = false;
  for (let cursor = focused; cursor; cursor = cursor.parentNode) if (cursor === panel) inside = true;
  assert.equal(inside, true, "the focused element is not inside the composer panel");

  // And the fragment names something that is actually there.
  assert.equal(document.querySelectorAll("#post-form").length, 1, "the fragment names no element on this page");
  let inForm = false;
  for (let cursor = focused; cursor; cursor = cursor.parentNode) if (cursor.id === "post-form") inForm = true;
  assert.equal(inForm, true, "the caret landed outside the form the fragment names");

  // No trap. Tab moves on to the next field in the natural order and Shift+Tab
  // comes back to where it started — nothing here redirects either.
  const sequence = tabSequence(document);
  const start = sequence.indexOf(focused);
  assert.ok(start >= 0, "the focused field is not in the tab sequence");
  // Identity checked as a boolean, for the same reason: a failed node
  // comparison serialises the parsed page rather than reporting.
  assert.equal(pressTab(document) === sequence[start + 1], true, "something intercepted Tab out of the first field");
  assert.equal(pressTab(document, { shift: true }) === focused, true, "something intercepted Shift+Tab");

  // Tabbing on eventually leaves the panel: a trap would keep returning stops
  // inside it forever.
  const after = sequence.slice(start).filter((stop) => {
    for (let cursor = stop; cursor; cursor = cursor.parentNode) if (cursor === panel) return false;
    return true;
  });
  assert.ok(after.length > 0, "the tab sequence never leaves the composer");
});

test("Social without the publish fragment leaves the composer collapsed and focus alone", async (t) => {
  const { document } = await openSocial(t, "");

  assert.equal(document.querySelector("#post-compose-panel").hidden, true,
    "an ordinary arrival opened the composer");
  assert.equal(document.querySelector("#post-compose-open").getAttribute("aria-expanded"), "false");
  // An arriving page must not grab focus from a reader who did not ask for the
  // form, so the caret is nowhere in particular.
  assert.equal(document.activeElement?.id ?? "", "", "an ordinary arrival moved the caret");
});
