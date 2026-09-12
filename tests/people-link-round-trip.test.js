// #2312: an image post's display name, followed to that name's People list from
// a Social card and from the post page, for names that have to survive a trip
// through a URL, and People's answer when the name has no image posts.
//
// The address (`/profile.html?author=…`), its one builder (profileHref in
// src/social-links.js) and People holding a forwarded name already existed.
// This file walks the round trip the others do not: the href a page actually
// drew, opened on People, selecting that exact name and printing it literally;
// the address People rewrites when the filter changes, surviving a reload; and
// the zero-image-posts message naming the person with a way to Social.
//
// HARNESS. The page harness parses no markup, so "printed literally" cannot go
// red from an innerHTML regression; the source check at the bottom pins that
// half. Skeleton tiles carry .profile-tile, so tiles are counted without them.
// No node is compared against null, no descendant or `*` selector is used, and
// each page is opened with all three of its settle waits.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { connectionStatusLine } from "../src/social.js";
import { peopleImagePostsLabel, profileHref } from "../src/social-links.js";

const SOCIAL_PAGE = new URL("../src/social.html", import.meta.url);
const PEOPLE_PAGE = new URL("../src/profile.html", import.meta.url);
const POST_PAGE = new URL("../src/post.html", import.meta.url);
const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";

// One name per hazard: a space, non-ASCII letters, and each of & # ? < — the
// characters that split a query string, start a fragment, or open a tag when
// they go into an address or a page unescaped.
const HOSTILE = ["Ari Mensah", "Zoë Ølsen", "R&D", "Crew #7", "Why?", "<b>Bo</b>"];
const TEXT_ONLY = "Tess Nakano";

// The id's tail is the day of the month, written out in createdAt as well: a
// seed whose day is not a real date is dropped and takes its name with it.
const post = (id, author, { withImage = true } = {}) => ({
  id,
  author,
  body: `${id} body`,
  createdAt: `2026-07-${id.slice(-2)}T09:00:00.000Z`,
  likes: 0,
  comments: 0,
  ...(withImage ? { image: { src: `/media/${id}.svg`, alt: `Drawing ${id}`, width: 1200, height: 900 } } : {}),
});

// Ari has two image posts, so "only that name's" is told apart from "one tile".
const FEED = [
  ...HOSTILE.map((name, index) => post(`p-0${index + 1}`, name)),
  post("p-07", "Ari Mensah"),
  post("p-08", TEXT_ONLY, { withImage: false }),
];

const imagePostIds = (name) => FEED
  .filter((entry) => entry.author === name && entry.image)
  .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  .map((entry) => entry.id);

// Social's durable API shape. Without `source` every post is dropped and the
// feed settles on its empty state, where "no link here" passes against nothing.
const asApiPost = (entry) => ({
  id: entry.id,
  author: entry.author,
  content: entry.body,
  timestamp: entry.createdAt,
  source: "demo",
  ...(entry.image ? { image: entry.image } : {}),
});

const searchOf = (href) => new URL(href, "https://labs.wawalu.org").search;
const drawnTiles = (document) =>
  document.querySelectorAll(".profile-tile").filter((tile) => !tile.classList.contains("profile-tile-skeleton"));
const chips = (document) => document.querySelector("#profile-author").children.filter((node) => node.tagName === "BUTTON");
const pressed = (document) => chips(document).filter((chip) => chip.getAttribute("aria-pressed") === "true");

// A page with its refresh timer silenced, closed by the caller.
async function open(url, options, entry) {
  const page = await loadPage(url, options);
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  const replaced = [];
  globalThis.window.history = { replaceState: (...args) => replaced.push(args) };
  await importPageModule(entry);
  return {
    ...page,
    replaced,
    close() { globalThis.setInterval = realSetInterval; page.restore(); },
  };
}

async function openSocial() {
  const page = await open(SOCIAL_PAGE, { storage: {}, routes: { [SEED_ROUTE]: { posts: [] }, [LIVE_ROUTE]: { posts: FEED.map(asApiPost) } } }, "/social-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogSocial === "ready", "Social finished its first load");
  await waitFor(() => textOf(document.querySelector("#feed-status")) === connectionStatusLine("live"), "the live feed answered");
  await waitFor(() => textOf(document.querySelector("#feed-summary")).startsWith("Showing"), "the feed settled on a count");
  return page;
}

async function openPeople(search) {
  const page = await open(PEOPLE_PAGE, { storage: {}, location: { search }, routes: { [SEED_ROUTE]: { posts: FEED }, [LIVE_ROUTE]: { posts: [] } } }, "/profile-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogProfile === "ready", "People finished its first load");
  await waitFor(() => document.querySelectorAll(".profile-tile-skeleton").length === 0, "the placeholder grid was replaced");
  await waitFor(() => textOf(document.querySelector("#profile-announcer")).length > 0, "People announced the view it settled on");
  return page;
}

async function openPost(id, posts) {
  const page = await open(POST_PAGE, { location: { search: `?id=${id}` }, routes: { [SEED_ROUTE]: { posts } } }, "/post-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "ready", "the post page settled");
  return page;
}

// Asserts People is on `name`, listing exactly that name's image posts.
function assertSelected(document, name) {
  assert.deepEqual(pressed(document).map((chip) => chip.dataset.author), [name], `People did not select ${name}`);
  const count = imagePostIds(name).length;
  assert.equal(textOf(document.querySelector("#grid-title")), `${name} · ${count} image post${count === 1 ? "" : "s"}`);
  assert.deepEqual(drawnTiles(document).map((tile) => tile.dataset?.postId), imagePostIds(name));
  assert.equal(document.querySelectorAll(".empty-state").length, 0);
}

test("each Social image card's People link opens People on that exact name, however it is spelled", async () => {
  const social = await openSocial();
  const hrefs = new Map();
  try {
    const cards = social.document.querySelectorAll(".post-card").filter((card) => !card.classList.contains("post-card-skeleton"));
    assert.equal(cards.length, FEED.length, "the settled feed is not the feed this test served");
    for (const entry of FEED) {
      const card = cards.find((node) => node.dataset?.postId === entry.id);
      const links = card.querySelectorAll("a").filter((link) => (link.getAttribute("href") ?? "").startsWith("/profile.html"));
      if (!entry.image) {
        assert.equal(links.length, 0, `the text-only post ${entry.id} links to People`);
        continue;
      }
      assert.equal(links.length, 1, `${entry.id} offers its People link no times, or twice`);
      assert.equal(textOf(links[0]), peopleImagePostsLabel(entry.author));
      assert.equal(links[0].getAttribute("href"), profileHref(entry.author));
      assert.equal(new URLSearchParams(searchOf(links[0].getAttribute("href"))).get("author"), entry.author);
      // The byline prints the name literally, as text.
      assert.equal(textOf(card.querySelector(".post-name")), entry.author);
      hrefs.set(entry.author, links[0].getAttribute("href"));
    }
  } finally {
    social.close();
  }

  assert.deepEqual([...hrefs.keys()], HOSTILE);
  for (const [name, href] of hrefs) {
    const people = await openPeople(searchOf(href));
    try {
      assertSelected(people.document, name);
    } finally {
      people.close();
    }
  }
});

test("the post page's People link round-trips a hostile name, and a text-only post has none", async () => {
  const name = "Zoë & <b>Bo</b> #7?";
  const page = await openPost("p-01", [{ ...post("p-01", name) }, post("p-02", TEXT_ONLY, { withImage: false })]);
  try {
    const main = page.document.querySelector("#main-content");
    assert.deepEqual(main.querySelectorAll("a").map((link) => textOf(link)), [
      `See ${name}’s image posts on People`, "Open Social to read the whole feed", "Open Social to publish a post",
    ], "the post page's links are its People link and the Social links, and nothing else");
    const link = main.querySelectorAll("a")[0];
    assert.equal(link.getAttribute("href"), profileHref(name));
    assert.equal(new URLSearchParams(searchOf(link.getAttribute("href"))).get("author"), name);
    assert.equal(textOf(page.document.querySelector(".post-name")), name);
  } finally {
    page.close();
  }

  const text = await openPost("p-02", [post("p-02", TEXT_ONLY, { withImage: false })]);
  try {
    const main = text.document.querySelector("#main-content");
    assert.equal(textOf(text.document.querySelector(".post-name")), TEXT_ONLY);
    assert.deepEqual(main.querySelectorAll("a").map((link) => link.getAttribute("href")), ["/social.html", "/social.html#post-form"]);
  } finally {
    text.close();
  }
});

test("changing People's filter rewrites the address, and reloading that address keeps the name", async () => {
  const first = await openPeople(searchOf(profileHref("Why?")));
  let address;
  try {
    assertSelected(first.document, "Why?");
    chips(first.document).find((chip) => chip.dataset.author === "Zoë Ølsen").click();
    assertSelected(first.document, "Zoë Ølsen");
    address = first.replaced.at(-1)?.[2];
    assert.equal(address, profileHref("Zoë Ølsen"), "the address did not follow the filter");
  } finally {
    first.close();
  }

  // A cold reload of that address, with nothing remembered in storage: the
  // address alone has to carry the name.
  const reloaded = await openPeople(searchOf(address));
  try {
    assertSelected(reloaded.document, "Zoë Ølsen");
  } finally {
    reloaded.close();
  }
});

test("a name with no image posts is named, links to Social, and never becomes Guest", async () => {
  for (const name of [TEXT_ONLY, "Nobody & <Co> #1?"]) {
    const page = await openPeople(searchOf(profileHref(name)));
    try {
      const { document } = page;
      assert.deepEqual(pressed(document).map((chip) => chip.dataset.author), [name]);
      assert.equal(chips(document).filter((chip) => chip.dataset.author === "Guest").length, 0, "People fell back to Guest");
      assert.equal(drawnTiles(document).length, 0);
      const empty = document.querySelectorAll(".empty-state");
      assert.equal(empty.length, 1);
      assert.match(textOf(empty[0]), /has no image posts yet\./);
      assert.ok(textOf(empty[0]).includes(`“${name}”`), `the message does not name ${name} literally`);
      const routes = empty[0].querySelectorAll("a");
      assert.equal(routes.length, 1);
      assert.match(routes[0].getAttribute("href"), /^\/social\.html/);
    } finally {
      page.close();
    }
  }

  // An empty or blank name is not a name: People keeps its default landing.
  for (const search of ["?author=", "?author=%20%20"]) {
    const page = await openPeople(search);
    try {
      assertSelected(page.document, "Ari Mensah");
    } finally {
      page.close();
    }
  }
});

test("the three renderers write display names as text, never as markup", async () => {
  for (const file of ["social.js", "post-detail.js", "profile.js"]) {
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, `${file} has an HTML sink`);
  }
});
