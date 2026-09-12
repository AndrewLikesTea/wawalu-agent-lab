// A display name on People, followed back to that name's whole feed on Social.
//
// THE FLOW UNDER TEST (#2193). People shows image posts and only image posts. A
// reader who wants the rest of one display name's posts — the text ones — used
// to have to take the intro's link to Social and then re-select, by hand, the
// filter the page they were standing on already knew. This is the one click that
// replaces that: a link in the display-name filter region, naming the selected
// name and Social, whose href carries the name into Social's own display-name
// filter.
//
// FOUR PROPERTIES, ONE PER TEST:
//
//   1. On a settled People page the link is in the filter region, its text names
//      the selected display name and Social and says "published under", and it
//      is the tab stop between the picker and the heading over the grid.
//   2. Choosing another display name moves both halves of it — the sentence and
//      the URL — with no reload.
//   3. It follows the picker's own load state: while the display names have not
//      arrived, the chips are not on the page and neither is this.
//   4. Social, opened cold at that URL, is already filtered to the name: the
//      menu is on it, #feed-summary describes the narrowed result, and Clear
//      filters puts every display name back.
//
// WHY IT IS ONE FILE. tests/people-landing.test.js pins People's reading order
// and tests/social.test.js pins the feed's summary sentence; neither walks the
// URL from the surface that mints it to the page that reads it, and that seam —
// People's href shape against Social's parameter name — is where a regression
// leaves both files green and the journey broken. The URL under test is built by
// socialFeedHref(), the same function src/profile.js draws the anchor with, and
// test 1 asserts the rendered anchor equals it.
//
// NO NETWORK AND NO CLOCK. Both feeds are generated here and served through
// declared routes; the harness throws on any other request, and the refresh
// timers both pages start are collected and cleared.
//
// HARNESS. A DOM double, not a browser: no `assert.equal(node, null)` (it walks
// the whole parsed page), no `querySelectorAll("*")` and no descendant
// selectors — document order is a hand-rolled pre-order walk over `children`,
// which also holds text nodes, so every `dataset` read is guarded.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { socialAllPostsLabel, socialFeedHref } from "../src/social-links.js";
import { CLEAR_FILTERS_LABEL, connectionStatusLine } from "../src/social.js";
import { profileConnectionLine } from "../src/profile.js";

const PEOPLE_PAGE = new URL("../src/profile.html", import.meta.url);
const SOCIAL_PAGE = new URL("../src/social.html", import.meta.url);
const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";

// Three display names whose image-post counts disagree with alphabetical order,
// so a landing rule that counts images is distinguishable from one that sorts
// names:
//   Zed  — 2 image posts, and so what People opens on for a visitor who asked
//          for nobody. Following Zed would not prove the link tracks a choice.
//   Bea  — 1 image post and 1 text post, the name test 2 switches to: the text
//          post is exactly what People cannot show and Social can.
//   Ari  — has posted, but never a picture.
const ZED = "Zed";
const BEA = "Bea";
const ARI = "Ari";

const image = (name) => ({ src: `/media/${name.toLowerCase()}.svg`, alt: `A drawing signed ${name}`, width: 1200, height: 900 });

// The demo-seed shape People reads. The day is written out rather than sliced
// off the id: a seed id whose tail is not a real day of the month silently lands
// People on "Guest".
const post = (id, author, day, { withImage = true } = {}) => ({
  id,
  author,
  body: `${id} from ${author}`,
  createdAt: `2026-07-${day}T09:00:00.000Z`,
  likes: 0,
  comments: 0,
  ...(withImage ? { image: image(author) } : {}),
});

const FEED = [
  post("p-01", ARI, "01", { withImage: false }),
  post("p-02", ZED, "02"),
  post("p-03", BEA, "03"),
  post("p-04", ZED, "04"),
  post("p-05", BEA, "05", { withImage: false }),
];

// The same posts in the durable API's shape. `source` is not decoration: a post
// without it is dropped on the way in and the feed lands silently in its empty
// state, so a "the filter applied" assertion would be made against no cards.
const asApiPost = (entry) => ({
  id: entry.id,
  author: entry.author,
  content: entry.body,
  timestamp: entry.createdAt,
  source: "demo",
  ...(entry.image ? { image: entry.image } : {}),
});

/** Every element under `root`, in the pre-order a reader meets them in. */
function documentOrder(root) {
  const order = [];
  const visit = (node) => {
    for (const child of node.children) {
      if (child.nodeType !== 1) continue;
      order.push(child);
      visit(child);
    }
  };
  visit(root);
  return order;
}

/** Collect and clear whatever interval a page entry starts. */
function trapTimers(t) {
  const timers = [];
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (...args) => {
    const handle = realSetInterval(...args);
    timers.push(handle);
    return handle;
  };
  return () => {
    for (const handle of timers) clearInterval(handle);
    globalThis.setInterval = realSetInterval;
  };
}

/**
 * People, booted from the shipped markup with the shipped wiring.
 *
 * Two waits, not one. `shiplogProfile` is the entry's own flag; the connection
 * line is what the page writes once the fetch it started has actually landed.
 * Awaiting only the flag leaves a render in flight that resolves after the
 * globals are torn down and surfaces as an unhandled rejection — green on a
 * quiet laptop, red on a loaded CI box.
 */
async function openPeople(t, { seed = { posts: FEED }, live = { posts: [] } } = {}) {
  const page = await loadPage(PEOPLE_PAGE, {
    storage: {},
    routes: { [SEED_ROUTE]: seed, [LIVE_ROUTE]: live },
  });
  const release = trapTimers(t);
  t.after(() => { release(); page.restore(); });
  globalThis.window.history = { replaceState() {} };
  await importPageModule("/profile-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogProfile === "ready", "People finished its first load");
  await waitFor(() => {
    const line = document.querySelectorAll("#profile-status");
    return line.length === 0 || textOf(line[0]) === profileConnectionLine("live");
  }, "the live feed answered");
  release();
  return page;
}

/** Social, booted cold at `search`, settled on a rendered feed. */
async function openSocial(t, { search = "" } = {}) {
  const page = await loadPage(SOCIAL_PAGE, {
    storage: {},
    location: { search },
    routes: { [SEED_ROUTE]: { posts: [] }, [LIVE_ROUTE]: { posts: FEED.map(asApiPost) } },
  });
  const release = trapTimers(t);
  t.after(() => { release(); page.restore(); });
  await importPageModule("/social-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogSocial === "ready", "Social finished its first load");
  await waitFor(() => textOf(document.querySelector("#feed-status")) === connectionStatusLine("live"), "the live feed answered");
  await waitFor(() => textOf(document.querySelector("#feed-summary")).startsWith("Showing"), "the feed settled on a count");
  release();
  return page;
}

/** The picker's own chips. The harness rejects descendant selectors. */
const chips = (document) => document.querySelector("#profile-author").children
  .filter((node) => node.tagName === "BUTTON");
const chipFor = (document, name) => chips(document).find((chip) => chip.dataset.author === name);

/** The link this issue adds, read off the page rather than reconstructed. */
const routeLine = (document) => document.querySelector("#profile-social-route");
const routeLink = (document) => routeLine(document)?.children.find((node) => node.tagName === "A") ?? null;

/** Tiles the grid actually drew: skeletons carry the same class as real ones. */
const drawnTiles = (document) => document.querySelectorAll(".profile-tile")
  .filter((tile) => !tile.classList.contains("profile-tile-skeleton"));

test("People offers the selected display name's whole feed from inside the filter region", async (t) => {
  const { document } = await openPeople(t);
  assert.ok(drawnTiles(document).length > 0, "the grid drew nothing, so no name is selected to link from");

  const link = routeLink(document);
  assert.ok(link, "the filter region offers no route to the selected name's whole feed");

  // The visible text is the accessible name: it carries the display name being
  // read and the destination, so it says where activating it goes without the
  // sentence around it. And the site's own phrasing for the relationship
  // between a post and a name — never "published as", which People's authored
  // copy is held away from.
  assert.equal(textOf(link), socialAllPostsLabel(ZED));
  assert.match(textOf(link), /\bZed\b/);
  assert.match(textOf(link), /\bSocial\b/);
  assert.match(textOf(link), /published under/);
  assert.doesNotMatch(textOf(link), /published as/);
  // No count: the number belongs to the feed at the other end, which this page
  // has not loaded.
  assert.doesNotMatch(textOf(link), /\d/);

  // A link, treated as one. The underline is the stylesheet's, so this pins the
  // class that carries it rather than a colour.
  assert.equal(link.tagName, "A");
  assert.equal(link.classList.contains("text-link"), true, "the route is not drawn as the site draws a link");

  // It is inside the group the picker belongs to, and after the picker in it.
  const group = routeLine(document).parentNode;
  assert.equal(group.tagName, "FIELDSET");
  assert.equal(group.querySelectorAll("#profile-author").length, 1,
    "the route is not in the same group as the control that chooses the name");

  // Reading order, and the tab order that follows from it: the picker, then this
  // link, then the heading that names the results. No tabindex propping it up.
  const order = documentOrder(document);
  const at = (selector) => order.indexOf(document.querySelector(selector));
  assert.ok(at("#profile-author") < at("#profile-social-route"), "the route is read before the control that sets it");
  assert.ok(at("#profile-social-route") < at("#grid-title"), "the route is read after the image-post heading");
  assert.equal(link.getAttribute("tabindex"), null, "the order is markup order, not a tabindex trick");

  const stops = tabSequence(document).filter((element) => element.closest("#main-content"));
  const index = stops.indexOf(link);
  assert.ok(index > 0, "the route to the whole feed is not keyboard reachable");
  assert.equal(stops[index - 1].dataset?.author, ZED, "the route is not the stop after the last display name");

  // Same tab: this is a page on this site, so it carries none of the new-tab
  // apparatus People's route into Paint needs.
  assert.equal(link.getAttribute("target"), null);
});

test("choosing another display name moves the route's sentence and its URL together", async (t) => {
  const { document } = await openPeople(t);
  assert.equal(routeLink(document).getAttribute("href"), socialFeedHref(ZED));

  chipFor(document, BEA).click();

  const link = routeLink(document);
  assert.equal(textOf(link), socialAllPostsLabel(BEA), "the route still names the display name that was showing before");
  assert.equal(link.getAttribute("href"), socialFeedHref(BEA), "the route still carries the previous display name");
  // In place: no navigation happened, and the grid beside it moved to the same
  // name in the same paint.
  assert.deepEqual(document.navigations, []);
  assert.equal(chipFor(document, BEA).getAttribute("aria-pressed"), "true");

  // A name with no image posts is still a name with posts, and the route is the
  // whole point of the page for it.
  chipFor(document, ARI).click();
  assert.equal(routeLink(document).getAttribute("href"), socialFeedHref(ARI));
  assert.equal(textOf(routeLink(document)), socialAllPostsLabel(ARI));
  assert.deepEqual(document.navigations, []);
});

test("the route waits with the picker rather than inventing a load state of its own", async (t) => {
  // A feed that answers with nothing: the picker has no display names to offer,
  // so its chips are not drawn and the availability hint stands in for them.
  const { document } = await openPeople(t, { seed: { posts: [] }, live: { posts: [] } });
  assert.equal(chips(document).length, 0, "the picker drew options over a feed with no posts");
  assert.equal(document.querySelectorAll("#profile-social-route").length, 0,
    "the route to Social outlived the picker it belongs to");
  // And it makes no claim about a display name while it is gone.
  assert.doesNotMatch(textOf(document.body), /See every post published under/);
});

test("Social opened at that URL is already filtered, and Clear filters puts every name back", async (t) => {
  const search = socialFeedHref(BEA).slice(socialFeedHref(BEA).indexOf("?"));
  const { document } = await openSocial(t, { search });

  const menu = document.querySelector("#post-name-filter");
  assert.equal(menu.value, BEA, "Social did not apply the display name People forwarded");
  // The option is a real one the menu offers, not a value forced onto a control
  // that does not hold it — a test double accepts any value, a browser does not.
  assert.equal(menu.options.filter((option) => option.value === BEA).length, 1);

  // The cards on screen are that name's, text post included: the whole reason
  // the link exists is the post People could not show.
  const cards = document.querySelectorAll(".post-card");
  const bylines = cards.map((card) => textOf(card.querySelector(".post-name")));
  assert.equal(bylines.length, 2, "the feed is not showing the forwarded name's posts");
  assert.deepEqual([...new Set(bylines)], [BEA]);

  // And the summary sentence describes that narrowed result, in the menu's own
  // words, with the ordering it always states and no second copy of it.
  const summary = textOf(document.querySelector("#feed-summary"));
  assert.equal(summary, `Showing 2 of ${FEED.length} posts by ${BEA}, newest first.`);

  const clear = document.querySelector("#post-filter-clear");
  assert.equal(textOf(clear), CLEAR_FILTERS_LABEL);
  assert.equal(clear.disabled, false, "the reset is shut on a feed the URL filtered");
  clear.click();

  assert.equal(menu.value, "all", "Clear filters left the forwarded name selected");
  assert.equal(document.querySelectorAll(".post-card").length, FEED.length);
  assert.equal(textOf(document.querySelector("#feed-summary")), `Showing ${FEED.length} posts, newest first.`);
});

test("a forwarded name the feed does not carry leaves the whole feed showing", async (t) => {
  const { document } = await openSocial(t, { search: "?author=Nobody%20Here" });
  const menu = document.querySelector("#post-name-filter");
  // Never a value the control does not offer: the menu would be showing a
  // filter no reset could clear and a summary describing a result nobody can
  // reach.
  assert.equal(menu.value, "all");
  assert.equal(menu.options.filter((option) => option.value === "Nobody Here").length, 0);
  assert.equal(document.querySelectorAll(".post-card").length, FEED.length);
  assert.equal(textOf(document.querySelector("#feed-summary")), `Showing ${FEED.length} posts, newest first.`);
});
