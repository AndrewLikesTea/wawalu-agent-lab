// A display name on a forwarded post, followed to People, end to end.
//
// THE FLOW UNDER TEST (#1833). Someone pastes a post link into a chat window.
// The person who opens it has never seen this site: one post, no feed around it,
// no history behind them. The name on that post is the only thread they have to
// pull, so it has to be a real one — a link that leads to the rest of what that
// display name published, and a link People can actually act on.
//
// Four properties, each a test here:
//
//   1. A LOADED post carries its display name as an anchor inside the post card,
//      built with People's own URL shape, one tab stop, underlined rather than
//      distinguished by colour alone.
//   2. That href, opened COLD on People, lands filtered to that name — asserted
//      against the sentence People itself renders ("People is filtered to X."),
//      not against a string invented here. This is the point of the issue: the
//      two halves of one contract, checked against each other rather than each
//      against its own expectation.
//   3. A post published with NO display name is a post by Guest, everywhere:
//      src/social.js stores it that way, the byline says it, and the link it
//      emits lands People on the Guest bucket rather than on nobody.
//   4. The three unresolved states — loading, not found, unreachable — carry no
//      display-name link at all, because none of them has a display name, and
//      all three still offer the feed.
//
// WHY A FILE OF ITS OWN. tests/post-permalink-states.test.js pins the permalink's
// four states and tests/people-landing.test.js pins `?author=` beating People's
// default. Neither walks the URL from the page that mints it to the page that
// reads it, and that seam — the post page's href shape versus People's parameter
// name and its trim — is exactly where a regression leaves both files green and
// the journey broken. It is the sibling of tests/social-name-to-people-e2e.test.js,
// which walks the same seam from Social's feed.
//
// NO NETWORK AND NO CLOCK. The feed is generated here and served through declared
// routes; the harness throws on any other request. People's refresh timers are
// collected and cleared so nothing outlives a test.
//
// HARNESS. A DOM double, not a browser: never `assert.equal(node, null)` (it
// walks the whole parsed page), no `querySelectorAll("*")` and no descendant
// selectors — containment is walked over `parentNode` by hand.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { profileHref } from "../src/social-links.js";
import { POST_EXITS } from "../src/post-detail.js";
import { DEFAULT_AUTHOR } from "../src/social-identity.js";
import { profileConnectionLine } from "../src/profile.js";

const POST_PAGE = new URL("../src/post.html", import.meta.url);
const PEOPLE_PAGE = new URL("../src/profile.html", import.meta.url);
const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";

// Three display names whose image-post counts disagree, because People's landing
// default is "the name with the most image posts": forwarding the name that
// would have been picked anyway proves nothing.
//   Iris Vale   — 3 image posts, People's default for a visitor who asked for
//                 nobody.
//   Mina Okafor — 2, the name the permalink under test forwards.
//   Guest       — 1, and it is not a chosen name: it is what src/social.js
//                 stores for a post published with the display-name field empty.
const IRIS = "Iris Vale";
const MINA = "Mina Okafor";
const GUEST = "Guest";

// The seed shape both pages read. The day is written out rather than derived
// from the id: a seed id whose tail is not a real day of the month silently
// lands People on Guest, which is the one answer this file must not get by
// accident.
const post = (id, author, day) => ({
  id,
  author,
  body: `${id} from ${author}`,
  createdAt: `2026-07-${day}T09:00:00.000Z`,
  likes: 0,
  comments: 0,
  image: { src: `/media/${id}.svg`, alt: `A drawing signed ${author}`, width: 1200, height: 900 },
});

const FEED = [
  post("p-01", IRIS, "01"),
  post("p-02", MINA, "02"),
  post("p-03", IRIS, "03"),
  post("p-04", MINA, "04"),
  post("p-05", IRIS, "05"),
  // The post nobody put a name on. Ids here are deliberately not UUIDs, so
  // src/post-page.js asks the seed rather than the durable API and this file
  // declares one route per page.
  post("p-06", GUEST, "06"),
];

/** Is `node` inside `ancestor`? The harness rejects descendant selectors. */
function within(node, ancestor) {
  for (let walk = node; walk; walk = walk.parentNode) if (walk === ancestor) return true;
  return false;
}

/** A settled permalink, served from the shipped markup and the shipped wiring. */
async function openPost(t, search, { answer = null } = {}) {
  const page = await loadPage(POST_PAGE, {
    location: { search },
    routes: { [SEED_ROUTE]: { posts: FEED } },
  });
  t.after(() => page.restore());
  if (answer) globalThis.fetch = async (url) => answer(String(url));

  await importPageModule("/post-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "ready",
    `the post page settled for ${search}`);
  return { ...page, panel: page.document.querySelector("#post-detail") };
}

/**
 * People, opened cold at a forwarded URL: an empty store, one declared route per
 * fetch, and nothing in this file having visited People first.
 *
 * Three waits — the entry's flag, the connection line, and the polite region,
 * which is only written once the grid has been painted for a name. Waiting on
 * the flag alone leaves a render in flight that resolves after the globals are
 * torn down and surfaces as an unhandled rejection: green here, red on CI.
 */
async function openPeople(t, search) {
  const page = await loadPage(PEOPLE_PAGE, {
    storage: {},
    location: { search },
    routes: { [SEED_ROUTE]: { posts: FEED }, [LIVE_ROUTE]: { posts: [] } },
  });
  const timers = [];
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (...args) => {
    const handle = realSetInterval(...args);
    timers.push(handle);
    return handle;
  };
  t.after(() => {
    for (const handle of timers) clearInterval(handle);
    globalThis.setInterval = realSetInterval;
    page.restore();
  });

  await importPageModule("/profile-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogProfile === "ready", "People finished its first load");
  await waitFor(() => {
    const line = document.querySelectorAll("#profile-status");
    return line.length === 0 || textOf(line[0]) === profileConnectionLine("live");
  }, "the live feed answered");
  await waitFor(() => textOf(document.querySelector("#profile-announcer")).length > 0, "People announced the view it settled on");
  globalThis.setInterval = realSetInterval;
  return page;
}

/** The href a permalink's display-name link actually emits, followed as a URL. */
const searchOf = (href) => new URL(href, "https://labs.wawalu.org").search;

/* ------------------------- 1. the control on the post ---------------------- */

test("a loaded post carries its display name as one keyboard stop, linked to People", async (t) => {
  const page = await openPost(t, "?id=p-02");
  const link = page.panel.querySelector(".detail-author-link");

  assert.equal(link.tagName, "A", "the display name is not an anchor, so it cannot be forwarded or copied");
  // The visible text is the name. "Profile" or "View profile" would leave a
  // screen reader's list of links unable to say whose profile any of them is.
  assert.equal(textOf(link), MINA);
  assert.equal(link.getAttribute("aria-label"), null, "the name must be readable in the ink, not only in an aria-label");

  // People's own URL shape, built by the function People's other callers build
  // it with, so the two cannot drift apart into two vocabularies.
  assert.equal(link.getAttribute("href"), profileHref(MINA));
  assert.equal(link.href, "/profile.html?author=Mina%20Okafor");

  // Exactly one stop inside the post card, and it is markup order rather than a
  // tabindex trick. The card itself is focusable only on purpose (tabindex="-1",
  // for the landing after a retry), so it must not appear in the sequence.
  const card = page.panel.querySelector(".detail-post");
  const stops = tabSequence(page.document).filter((element) => within(element, card));
  assert.deepEqual(stops.map((element) => element.className), ["detail-author-link"],
    "the post card grew a tab stop of its own, or lost the one it had");
  assert.equal(link.getAttribute("tabindex"), null);
  assert.equal(page.panel.querySelectorAll(".detail-author-link").length, 1, "one byline, not two");

  // Affordance without colour alone: the site's existing underline on the class
  // itself, and the shared focus ring the global anchor rule already gives every
  // link. No rule of its own — src/styles.css has no headroom for one, and this
  // control needs nothing the site does not already ship.
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.detail-author-link \{[^}]*text-decoration:underline/);
  assert.match(css, /button:focus-visible,a:focus-visible \{[^}]*outline:3px solid var\(--focus-ring\)/);
  assert.equal(/outline\s*:\s*(none|0)/.test(css.match(/\.detail-author-link[^{]*\{[^}]*\}/g)?.join("") ?? ""), false,
    "no rule may take the focus outline off the display name");
});

/* --------------------------- 2. the cold open ------------------------------ */

test("the href a forwarded post emits opens People filtered to that display name", async (t) => {
  // The URL is read off the rendered post rather than composed here, so this
  // test follows the link a reader would actually click.
  const permalink = await openPost(t, "?id=p-02");
  const href = permalink.panel.querySelector(".detail-author-link").getAttribute("href");
  permalink.restore();

  const people = await openPeople(t, searchOf(href));
  const { document } = people;

  // The forwarded name, not People's landing default. Iris has the most image
  // posts, so she is who this page picks for a visitor who asked for nobody —
  // reaching her here would mean the emitted URL lost to the default.
  assert.equal(textOf(document.querySelector("#profile-name")), `People is filtered to ${MINA}.`);
  assert.equal(textOf(document.querySelector("#grid-title")), `${MINA} · 2 image posts`);
  const pressed = document.querySelector("#profile-author").children
    .filter((node) => node.tagName === "BUTTON" && node.getAttribute("aria-pressed") === "true");
  assert.equal(pressed.length, 1);
  assert.equal(pressed[0].dataset.author, MINA, "the cold open did not resolve to the forwarded name");

  // And the post that was forwarded is in the grid it led to, so the link is not
  // merely well-formed: it lands on the rest of what that name published.
  const tiles = document.querySelectorAll(".profile-tile").map((tile) => tile.dataset?.postId);
  assert.deepEqual(tiles, ["p-04", "p-02"], "newest first, and the forwarded post among them");
  assert.equal(document.querySelectorAll(".empty-state").length, 0);
});

/* ------------------------------- 3. Guest ---------------------------------- */

test("a post published with no display name reads Guest and leads to the Guest bucket", async (t) => {
  // What src/social.js stores when the composer's display-name field is empty:
  // the same trim and the same fallback this page resolves the byline with, so
  // "no name" is one answer across the product rather than three.
  assert.equal(DEFAULT_AUTHOR, GUEST);

  const permalink = await openPost(t, "?id=p-06");
  const link = permalink.panel.querySelector(".detail-author-link");
  assert.equal(textOf(link), GUEST, "an unnamed post lost its byline instead of naming its bucket");
  assert.equal(link.getAttribute("href"), profileHref(GUEST));
  assert.equal(link.href, "/profile.html?author=Guest");
  const href = link.getAttribute("href");
  permalink.restore();

  // Guest is a name People can show, which is the whole reason it may be linked:
  // this page never emits a link that lands People on a name it cannot draw.
  const people = await openPeople(t, searchOf(href));
  const { document } = people;
  assert.equal(textOf(document.querySelector("#profile-name")), `People is filtered to ${GUEST}.`);
  assert.equal(textOf(document.querySelector("#grid-title")), `${GUEST} · 1 image post`);
  assert.deepEqual(document.querySelectorAll(".profile-tile").map((tile) => tile.dataset?.postId), ["p-06"]);
});

/* ------------------- 4. the states that have no name ----------------------- */

// A skeleton wears the loaded card's own classes, so counting `.detail-post`
// alone would count the wait as a post. What is asserted is the link itself:
// the placeholder for the display name is a shimmer block, never an anchor.
test("no state without a post offers a display-name link, and all of them offer the feed", async (t) => {
  // Loading, held open: the lookup is still running, so there is no name yet.
  const waiting = await loadPage(POST_PAGE, { location: { search: "?id=p-02" } });
  t.after(() => waiting.restore());
  let release;
  globalThis.fetch = () => new Promise((resolve) => {
    release = () => resolve({ ok: true, status: 200, json: async () => ({ posts: FEED }) });
  });
  await importPageModule("/post-page.js");
  const panel = waiting.document.querySelector("#post-detail");
  await waitFor(() => panel.querySelectorAll(".detail-loading").length === 1, "the loading state rendered");

  assert.equal(panel.querySelectorAll(".detail-author-link").length, 0, "the wait offered a link to a name it does not have");
  // The skeleton still holds the slot the name will land in, so the post does
  // not shove the page down when it arrives.
  assert.equal(panel.querySelectorAll("[data-post-skeleton-slot]")
    .filter((slot) => slot.dataset?.postSkeletonSlot === "display-name").length, 1);
  assert.equal(panel.querySelectorAll("a").length, 0, "the wait's placeholder is a shimmer block, not an anchor");
  const feedLink = waiting.document.querySelector("#post-back");
  assert.equal(feedLink.hidden, false, "the loading state lost the feed");
  assert.equal(textOf(feedLink), POST_EXITS.social.label);

  release();
  await waitFor(() => waiting.document.documentElement.dataset.shiplogPostDetail === "ready", "the lookup settled");
  waiting.restore();

  // Not found and unreachable: both settled, neither with a post, so neither
  // with a display name — and both still standing next to the feed.
  for (const [state, search, answer] of [
    ["not-found", "?id=p-never-existed", null],
    ["error", "?id=p-02", () => { throw new TypeError("Failed to fetch"); }],
  ]) {
    const page = await openPost(t, search, { answer });
    assert.equal(page.panel.querySelectorAll(".detail-author-link").length, 0,
      `${state}: a display-name link with no display name behind it`);
    const back = page.document.querySelector("#post-back");
    assert.equal(back.hidden, false, `${state}: the feed link went with the post`);
    assert.equal(textOf(back), POST_EXITS.social.label);
    assert.equal(back.getAttribute("href"), "/social.html");
    // The People exit is withdrawn in these two states for the same reason: its
    // words are about a display name the page could not resolve.
    assert.equal(page.document.querySelector("#post-people").hidden, true, `${state}: People was offered with no name`);
    page.restore();
  }
});

/* -------------------- the two routes that both land on Social -------------- */

test("the two Social routes out are told apart by their first word", async (t) => {
  const page = await openPost(t, "?id=p-02");
  const { document } = page;

  const feed = document.querySelector("#post-back");
  const publish = document.querySelector("#post-publish");
  const firstWord = (node) => textOf(node).split(" ")[0];

  // Both still land on Social, which is why they read as near-duplicates and why
  // the words are the only thing that can separate them.
  assert.equal(feed.getAttribute("href"), "/social.html");
  assert.equal(publish.getAttribute("href"), "/social.html#post-form");
  assert.equal(publish.hidden, false, "a settled state offers the publish route");

  assert.notEqual(firstWord(feed), firstWord(publish),
    `both routes out still open on "${firstWord(feed)}"`);
  // Not merely different: each opens on what its destination is for. A reader
  // scanning the row reads the first word and nothing else.
  assert.equal(firstWord(feed), "Read");
  assert.equal(firstWord(publish), "Publish");
  assert.equal(textOf(feed), POST_EXITS.social.label);
  assert.equal(textOf(publish), POST_EXITS.publish.label);

  // Short, and still naming their destination in visible text.
  for (const node of [feed, publish]) {
    assert.ok(textOf(node).includes("Social"), `${node.id} must name where it goes`);
    assert.ok(textOf(node).length <= 40, `${node.id} is a label, not a sentence`);
    assert.equal(node.getAttribute("aria-label"), null, `${node.id} must name its destination in visible text`);
  }

  // The words ship in the markup too, so they are what a cold visitor reads
  // before this page's script has been fetched.
  const html = await readFile(POST_PAGE, "utf8");
  assert.ok(html.includes(`>${POST_EXITS.social.label}</a>`), "the feed label must ship in the markup");
  assert.ok(html.includes(`>${POST_EXITS.publish.label}</a>`), "the publish label must ship in the markup");
});
