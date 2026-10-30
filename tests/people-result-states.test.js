// #3002: People's results region has five mutually exclusive states — loading,
// unfiltered empty, filtered empty, error and populated — and a Retry whose
// focus behaviour is deterministic across a repeated failure and a success.
// Booted from the shipped markup and wiring, with the feed built in-test.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, textOf, tabSequence } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const PAGE_URL = new URL("../src/profile.html", import.meta.url);
const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";
const PUBLISH = ["Publish a post on Social", "/social.html#post-form"];

const seedPost = (id, author, withImage = true) => ({
  id, author, body: `${id} from ${author}`, caption: null,
  createdAt: `2026-07-${id.slice(-2)}T09:00:00.000Z`, likes: 0, comments: 0,
  ...(withImage ? { image: { src: `/media/${author}.svg`, alt: `A drawing signed ${author}`, width: 1200, height: 900 } } : {}),
});
const FEED = { posts: [seedPost("p-11", "Ari", false), seedPost("p-12", "Zed"), seedPost("p-13", "Bea"), seedPost("p-14", "Zed")] };

async function people(t, { search = "", seed = FEED, live = { posts: [] }, liveFetch = null } = {}) {
  const routes = { [SEED_ROUTE]: seed };
  if (live) routes[LIVE_ROUTE] = live;
  const page = await loadPage(PAGE_URL, { location: { search }, routes });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  globalThis.window.history = { pushState() {} };
  // liveFetch answers the posts API by hand: a non-OK status, a malformed body,
  // or a response held open so two refreshes can settle out of order.
  const routed = globalThis.fetch;
  if (liveFetch) globalThis.fetch = (url, init) => (url === LIVE_ROUTE ? liveFetch() : routed(url, init));
  t.after(() => { globalThis.fetch = routed; globalThis.setInterval = savedInterval; page.restore(); });
  await importPageModule("/profile-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogProfile === "ready", "the first load settles");
  return { document, routes };
}

const announcer = (document) => textOf(document.querySelector("#profile-announcer"));
const panel = (document) => document.querySelector("#profile-feed-status").querySelector(".empty-state");
const links = (node) => node.querySelectorAll("a").map((a) => [textOf(a), a.getAttribute("href")]);
const tiles = (document) => document.querySelectorAll(".profile-tile").filter((tile) => !tile.classList.contains("profile-tile-skeleton"));

test("the served frame is the loading state: busy, bounded placeholders and a status in words", async (t) => {
  const page = await loadPage(PAGE_URL, { routes: {} });
  t.after(() => page.restore());
  const { document } = page;
  const grid = document.querySelector("#profile-grid");
  assert.equal(grid.getAttribute("aria-busy"), "true");
  assert.equal(document.querySelectorAll(".profile-tile-skeleton").length, 6);
  const skeleton = grid.querySelector(".profile-grid-skeleton");
  assert.equal(skeleton.getAttribute("aria-hidden"), "true");
  assert.equal(skeleton.hasAttribute("inert"), true);
  assert.equal(textOf(document.querySelector("#profile-feed-status")), "Image posts are loading. Each one was published on Social.");
  const live = document.querySelector("#profile-announcer");
  assert.equal(live.getAttribute("aria-live"), "polite");
  assert.equal(live.getAttribute("aria-atomic"), "true");
});

test("unfiltered empty says no image posts exist and links to Social's composer", async (t) => {
  const { document } = await people(t, { seed: { posts: [seedPost("p-11", "Ari", false)] } });
  const empty = panel(document);
  assert.ok(empty.classList.contains("empty-state-none"));
  assert.equal(textOf(empty.querySelector("h3")), "No one has published an image post on Social yet.");
  assert.deepEqual(links(empty).at(-1), PUBLISH);
  assert.equal(tiles(document).length, 0);
  assert.equal(document.querySelector("#profile-grid").getAttribute("aria-busy"), "false");
  assert.equal(announcer(document), "No one has published an image post on Social yet.");
});

test("filtered empty names the display name and offers clear-filter and Social, after the picker in tab order", async (t) => {
  const { document } = await people(t, { search: "?author=Nova" });
  const empty = panel(document);
  assert.equal(empty.classList.contains("empty-state-none"), false);
  assert.equal(textOf(empty.querySelector("h3")), "The display name “Nova” has no image posts yet.");
  const clear = empty.querySelectorAll("button")[0];
  assert.equal(textOf(clear), "Clear selection and show all display names");
  assert.equal(clear.type, "button");
  assert.deepEqual(links(empty).at(-1), PUBLISH);

  const order = tabSequence(document);
  const chip = document.querySelector("#profile-author").children.find((node) => node.tagName === "BUTTON");
  const publish = empty.querySelectorAll("a").at(-1);
  assert.ok(order.indexOf(chip) >= 0, "the picker is not reachable by Tab");
  assert.ok(order.indexOf(chip) < order.indexOf(clear), "recovery comes before the display-name filter");
  assert.ok(order.indexOf(clear) < order.indexOf(publish), "Social comes before clearing the filter");

  clear.click();
  assert.equal(tiles(document).length > 0, true, "clearing the filter did not restore image posts");
  assert.equal(document.activeElement?.getAttribute("id"), "profile-name-picker");
});

test("populated keeps its post actions after the picker, and no state is a positive tab stop", async (t) => {
  const { document } = await people(t);
  assert.equal(tiles(document).length, 2);
  assert.equal(panel(document), null);
  const order = tabSequence(document);
  const chip = document.querySelector("#profile-author").children.find((node) => node.tagName === "BUTTON");
  const openPost = order.filter((node) => node.tagName === "A" && node.querySelector(".profile-tile-link-label"));
  assert.equal(openPost.length, 2, "a populated tile lost its Open post action");
  assert.ok(order.indexOf(chip) < order.indexOf(openPost[0]));
  assert.match(announcer(document), /^Showing 2 image posts by Zed, newest first\.$/);
  for (const node of document.querySelectorAll("[tabindex]")) {
    assert.ok(Number(node.getAttribute("tabindex")) <= 0, `positive tabindex on #${node.getAttribute("id")}`);
  }
});

test("Retry announces loading in place, stays on Retry after a repeated failure, then lands on the results heading", async (t) => {
  const { document, routes } = await people(t, { seed: { posts: [] }, live: null });
  const status = document.querySelector("#profile-feed-status");
  assert.match(textOf(status), /Image posts could not be loaded\./);
  assert.equal(announcer(document), "Image posts could not be loaded. Select Retry loading image posts.");
  const retry = status.querySelector(".profile-retry");
  assert.equal(retry.tagName, "BUTTON");
  assert.equal(textOf(retry), "Retry loading image posts");

  // Repeated failure: the wait is announced without moving focus, and focus is
  // back on the same Retry once the second failure lands.
  retry.focus();
  retry.click();
  assert.equal(announcer(document), "Image posts are loading.");
  assert.equal(retry.getAttribute("aria-disabled"), "true");
  assert.equal(document.activeElement, retry, "the wait moved focus off Retry");
  await waitFor(() => /could not be loaded/.test(announcer(document)), "the second attempt fails");
  assert.equal(document.activeElement, retry, "a repeated failure lost focus");
  assert.equal(retry.getAttribute("aria-disabled"), "false");

  // Success: focus moves to the heading that now names and counts the results.
  routes[LIVE_ROUTE] = { posts: [{
    id: "live-image", author: "Mina", content: "Recovered.", timestamp: "2026-07-18T12:00:00.000Z",
    image_url: "/media/Mina.svg", image_alt: "A drawing signed Mina", image_width: 1200, image_height: 900,
  }] };
  retry.click();
  await waitFor(() => tiles(document).length === 1, "the retry draws the recovered post");
  const heading = document.querySelector("#grid-title");
  assert.equal(document.activeElement, heading, "a successful retry left focus on a stale control");
  assert.equal(heading.getAttribute("tabindex"), "-1", "the heading became a tab stop");
  assert.equal(textOf(heading), "Mina · 1 image post");
});

test("Retry does not pull focus back when the reader moved on during the wait", async (t) => {
  const { document } = await people(t, { seed: { posts: [] }, live: null });
  const retry = document.querySelector("#profile-feed-status").querySelector(".profile-retry");
  retry.focus();
  retry.click();
  const elsewhere = document.querySelector("#profile-publish-route");
  elsewhere.focus();
  await waitFor(() => /could not be loaded/.test(announcer(document)), "the attempt fails");
  assert.equal(document.activeElement, elsewhere);
});

// #3066: a broken answer is a failure, not an empty feed. The harness only ever
// rejects (an unrouted request), so the non-OK and malformed shapes are answered
// by hand; each must draw the failure and leave the hero and the picker alone.
const BROKEN = {
  "a non-OK status": () => ({ ok: false, status: 503, json: async () => ({ error: "unavailable" }) }),
  "a body with no posts list": () => ({ ok: true, json: async () => ({ posts: "none" }) }),
  "a body that is not JSON": () => ({ ok: true, json: async () => { throw new SyntaxError("Unexpected token <"); } }),
};
for (const [shape, answer] of Object.entries(BROKEN)) {
  test(`${shape} draws the failure inside the region and keeps the hero and picker`, async (t) => {
    const { document } = await people(t, { seed: { posts: [] }, liveFetch: async () => answer() });
    const status = document.querySelector("#profile-feed-status");
    assert.match(textOf(status), /Image posts could not be loaded\./);
    assert.equal(status.querySelector(".profile-retry").type, "button");
    assert.equal(announcer(document), "Image posts could not be loaded. Select Retry loading image posts.");
    assert.equal(panel(document)?.classList.contains("empty-state-none") ?? false, false, "a broken answer read as no image posts");
    assert.equal(textOf(document.querySelector("#page-title")), "People: public image posts from Social");
    assert.equal(document.querySelectorAll("#page-tagline").length, 1);
    assert.equal(document.querySelectorAll("#profile-name-picker").length, 1);
  });
}

test("a slower, older refresh cannot overwrite a newer one", async (t) => {
  const answers = [];
  const { document } = await people(t, {
    search: "?author=Zed",
    liveFetch: () => (answers.length ? new Promise((resolve) => answers.push(resolve)) : (answers.push(null), Promise.resolve({ ok: true, json: async () => ({ posts: [] }) }))),
  });
  assert.equal(tiles(document).length, 2);
  // Two refreshes in flight (a returning tab twice); the newer answers first.
  document.dispatchEvent({ type: "visibilitychange" });
  document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(answers.length, 3, "both refreshes did not reach the posts API");
  answers[2]({ ok: true, json: async () => ({ posts: [{
    id: "live-zed", author: "Zed", content: "Newer.", timestamp: "2026-07-20T12:00:00.000Z", source: "shiplog-web",
    image_url: "/media/Zed.svg", image_alt: "A drawing signed Zed", image_width: 1200, image_height: 900,
  }] }) });
  await waitFor(() => tiles(document).length === 3, "the newer refresh draws its post");
  answers[1]({ ok: true, json: async () => ({ posts: [] }) });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(tiles(document).length, 3, "the older answer overwrote the newer one");
  assert.equal(announcer(document), "Showing 3 image posts by Zed, newest first.");
});

// No state injects or drops a page-level heading: the h1 and h2s are the same
// elements, in the same order, whether the region is loading, populated, empty,
// filtered to nothing or failed.
test("the h1 and h2 outline is identical in every state", async (t) => {
  const outline = (document) => ["h1", "h2"].map((tag) => document.querySelectorAll(tag).map((h) => h.getAttribute("id")).join(","));
  const served = await loadPage(PAGE_URL, { routes: {} });
  const loading = outline(served.document);
  served.restore();
  assert.deepEqual(loading, ["page-title", "grid-title,site-footer-title"]);
  // The script mounts the report panel's (hidden) heading once, whatever the
  // feed answers; it is the only heading hydration adds.
  const expected = ["page-title", "grid-title,post-report-title,site-footer-title"];
  const states = {
    populated: {},
    empty: { seed: { posts: [seedPost("p-11", "Ari", false)] } },
    "filtered empty": { search: "?author=Nova" },
    failed: { seed: { posts: [] }, live: null },
  };
  for (const [name, options] of Object.entries(states)) {
    await t.test(name, async (st) => {
      const { document } = await people(st, options);
      assert.deepEqual(outline(document), expected, `the ${name} state changed the heading outline`);
    });
  }
});

// The harness models no layout, so the narrow-width guarantee is pinned in the
// CSS the states depend on (as tests/profile.test.js does for the panel).
test("every state wraps at narrow widths and the new focus target has the site's ring", async () => {
  const css = await readFile(new URL("../src/social-states.css", import.meta.url), "utf8");
  const base = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /#grid-title:focus-visible\s*\{\s*outline:3px solid var\(--focus-ring\)/);
  assert.match(css, /#profile-feed-status \.empty-state\s*\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /#profile-feed-status \.empty-actions \.empty-action\s*\{[^}]*max-width:100%/);
  assert.match(css, /\.profile-retry\s*\{[^}]*max-width:100%;[^}]*white-space:normal/);
  assert.match(css, /\.profile-identity-text h2[,\s]/, "the heading a retry focuses does not wrap long names");
  assert.match(base, /\.empty-actions\s*\{[^}]*flex-wrap:wrap/);
});
