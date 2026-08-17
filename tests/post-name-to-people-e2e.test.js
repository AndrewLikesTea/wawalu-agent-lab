// A display name on a forwarded post, followed to People, end to end (#1833).
//
// THE FLOW UNDER TEST. Somebody pastes a permalink into a chat window. The
// person who opens it has never seen this site, has no history behind them, and
// wants more than the one post they were sent. The display name under that post
// is the whole of their way onward, so it has to be a control — and the URL it
// carries has to land People on that same name rather than on whichever name
// People would have picked for a visitor who asked for nobody.
//
// WHY IT IS ITS OWN FILE. Both halves already have coverage: post-detail.test.js
// and post-permalink-states.test.js pin what the permalink renders, and
// people-requested-name.test.js pins what People does with a forwarded name.
// Neither walks the URL from the page that mints it to the page that reads it,
// and that seam — the parameter name and the value format — is the one place a
// regression leaves both files green and the journey broken. This is the same
// shape tests/social-name-to-people-e2e.test.js gives the feed's own version of
// the walk, one surface further out.
//
// NOTHING IS HAND-WRITTEN. The URL under test is the one the permalink emits
// (postAuthorPeopleHref), and the sentence it is checked against is People's
// own active-filter line. A change to either side reds this file by name.
//
// NO NETWORK AND NO CLOCK. Both feeds are generated here and served through
// declared routes; the harness throws on any other request. People's 30-second
// refresh is collected and cleared, so nothing outlives a test.
//
// HARNESS. A DOM double, not a browser: no `assert.equal(node, null)` (it walks
// the whole parsed page), no `querySelectorAll("*")`, and no descendant
// selectors — ancestry is walked by hand through `parentNode`.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { postAuthorName, postAuthorPeopleHref } from "../src/post-detail.js";
import { profileConnectionLine } from "../src/profile.js";
import { DEFAULT_AUTHOR } from "../src/social-identity.js";

const POST_PAGE = new URL("../src/post.html", import.meta.url);
const PEOPLE_PAGE = new URL("../src/profile.html", import.meta.url);
const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";

// Two names whose image-post counts disagree, so the name being forwarded is
// never the name People would have landed on by itself: Vale has two pictures
// and is the landing default, Okafor has one and is the name under the post.
const VALE = "Iris Vale";
const OKAFOR = "Remy Okafor";

const seedPost = (id, author, day) => ({
  id,
  author,
  body: `${id} from ${author}`,
  caption: `${author} shipped something on the ${day}th.`,
  createdAt: `2026-07-${day}T09:00:00.000Z`,
  likes: 0,
  comments: 0,
  image: { src: `/media/${id}.svg`, alt: `A drawing signed ${author}`, width: 1200, height: 900 },
});

const FEED = [
  seedPost("p-11", VALE, "11"),
  seedPost("p-12", OKAFOR, "12"),
  seedPost("p-13", VALE, "13"),
];

/**
 * The permalink, opened cold at a shared link: no history, no store, and one
 * declared route for the only fetch a non-UUID id makes (src/post-page.js asks
 * the durable API only for ids shaped like one, so the seed is the whole feed
 * here).
 */
async function openPost(t, search) {
  const page = await loadPage(POST_PAGE, { storage: {}, location: { search }, routes: { [SEED_ROUTE]: { posts: FEED } } });
  t.after(() => page.restore());
  await importPageModule("/post-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "ready", `the permalink settled for ${search}`);
  return page;
}

/**
 * People, opened cold at whatever URL the permalink handed over. Three waits,
 * the way every other page test in this repo does it: the entry's own flag, the
 * connection line, and the polite region, which is only written once the grid
 * has been painted for a name. Awaiting the flag alone leaves a render in flight
 * that resolves after the globals are torn down — green here, red on CI.
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
  await waitFor(() => document.documentElement.dataset.shiplogProfile === "ready", "the People page finished its first load");
  await waitFor(() => {
    const line = document.querySelectorAll("#profile-status");
    return line.length === 0 || textOf(line[0]) === profileConnectionLine("live");
  }, "the live feed answered");
  await waitFor(() => textOf(document.querySelector("#profile-announcer")).length > 0, "People announced the view it settled on");
  globalThis.setInterval = realSetInterval;
  return page;
}

/** The search half of an href the page built, ready to hand to a page load. */
const searchOf = (href) => href.slice(href.indexOf("?"));

/* --------------------- 1. the control on the permalink --------------------- */

test("a forwarded post carries its display name as a link to People", async (t) => {
  const page = await openPost(t, "?id=p-12");
  const { document } = page;
  const card = document.querySelector(".detail-post");

  const links = document.querySelectorAll(".detail-author-link");
  assert.equal(links.length, 1, "one display name on a post, not one per state");
  const link = links[0];
  assert.equal(link.tagName, "A");
  // The name itself is the label. "Profile" or "View profile" would leave a
  // screen reader's list of links unable to say whose.
  assert.equal(textOf(link), OKAFOR);
  assert.equal(link.getAttribute("href"), postAuthorPeopleHref(OKAFOR), "the link is the one the module mints, not a second URL shape");

  // Exactly one tab stop inside the post card, and it is this one. The card
  // itself is tabindex="-1" — a script focuses it after a retry — so a keyboard
  // reader passing through the post meets the name and nothing else.
  const inCard = tabSequence(document).filter((stop) => {
    for (let walk = stop; walk; walk = walk.parentNode) if (walk === card) return true;
    return false;
  });
  assert.deepEqual(inCard, [link], "the display name is the post card's only tab stop");
});

/* ------------------------- 2. the walk, end to end ------------------------- */

test("the forwarded post's display-name link opens People filtered to that name", async (t) => {
  const post = await openPost(t, "?id=p-12");
  const href = post.document.querySelectorAll(".detail-author-link")[0].getAttribute("href");

  const people = await openPeople(t, searchOf(href));
  const { document } = people;
  // People's own active-filter line, which is the page saying whose posts these
  // are. Not Vale, who has more pictures and is what People lands on when
  // nobody asked for anyone.
  assert.equal(textOf(document.querySelector("#profile-name")), `People is filtered to ${OKAFOR}.`);
  assert.doesNotMatch(textOf(document.querySelector("#main-content")), /filtered to (Iris Vale|Guest)\./);
  // And it is on that name's own posts, not a blank grid behind a right banner.
  assert.equal(document.querySelectorAll(".profile-tile").filter((tile) => !tile.className.includes("skeleton")).length, 1);
});

/* --------------------------- 3. the nameless post -------------------------- */

test("a post published under no display name leads to People filtered to Guest", async (t) => {
  // A post with no display name was published as "Guest": src/social.js resolves
  // an empty name field to DEFAULT_AUTHOR at publish time, so that is the name
  // the permalink prints (postAuthorName, pinned in tests/post-detail.test.js)
  // and the name this link has to be able to reach. What is asserted here is the
  // far end: that People really can be filtered to it, so the permalink is not
  // pointing at a name People would answer under somebody else's.
  assert.equal(postAuthorName(""), DEFAULT_AUTHOR);
  const people = await openPeople(t, searchOf(postAuthorPeopleHref("")));
  const { document } = people;
  assert.equal(textOf(document.querySelector("#profile-name")), `People is filtered to ${DEFAULT_AUTHOR}.`);
  // Guest published nothing in this feed, so People says so under Guest's own
  // name rather than trading it for the name with the most pictures.
  assert.doesNotMatch(textOf(document.querySelector("#main-content")), /filtered to Iris Vale\./);
});
