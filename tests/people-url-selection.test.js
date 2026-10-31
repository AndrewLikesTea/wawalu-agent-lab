import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, textOf, tabSequence } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { renderPosts } from "../src/social.js";
import { profileHref, requestedProfileAuthor } from "../src/social-links.js";

const names = ["Iris Vale", "Élodie + & / ? # %’", "東京 花"];
const posts = names.map((author, index) => ({
  id: `p-${index}`, author, body: "An image post", createdAt: "2026-07-01T09:00:00Z",
  image: { src: `/media/image-${index}.svg`, alt: `Drawing by ${author}`, width: 100, height: 100 },
}));
const searchFor = (name) => new URL(profileHref(name), "https://example.test").search;
async function openPeople(search) {
  const page = await loadPage(new URL("../src/profile.html", import.meta.url), {
    location: { search }, routes: {
      "/social-demo-data.json": { posts }, "/api/social-posts?limit=100": { posts: [] },
    },
  });
  const interval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  try {
    await importPageModule("/profile-page.js");
    await waitFor(() => page.document.documentElement.dataset.shiplogProfile === "ready", "People settles");
  } finally { globalThis.setInterval = interval; }
  return page;
}
function assertSelection(document, name, count = 1) {
  assert.equal(textOf(document.querySelector("#grid-title")), `${name} · ${count} image ${count === 1 ? "post" : "posts"}`);
  const tiles = document.querySelectorAll(".profile-tile").filter((tile) => !tile.classList.contains("profile-tile-skeleton"));
  assert.deepEqual(tiles.map((tile) => tile.dataset.postId), posts.filter((post) => post.author === name).map((post) => post.id));
  const selected = document.querySelector('[aria-pressed="true"]');
  assert.equal(selected.dataset.author, name);
  assert.match(textOf(selected), /✓ Current filter/);
}

for (const name of names) {
  test(`People restores exact URL selection on direct load and reload: ${name}`, async () => {
    for (let load = 0; load < 2; load++) {
      const page = await openPeople(searchFor(name));
      try { assertSelection(page.document, name); } finally { page.restore(); }
    }
  });
  test(`standalone byline renders a keyboard link for ${name}`, async () => {
    const page = await loadPage(new URL("../src/post.html", import.meta.url), {
      location: { search: `?id=${posts.find((post) => post.author === name).id}` },
      routes: { "/social-demo-data.json": { posts } },
    });
    try {
      await importPageModule("/post-page.js");
      await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "ready", "Post settles");
      const link = page.document.querySelector(".detail-author-link");
      assert.equal(link.tagName, "A");
      assert.equal(textOf(link), name);
      assert.equal(requestedProfileAuthor(new URL(link.href, "https://example.test").search), name);
      assert.ok(tabSequence(page.document).includes(link));
    } finally { page.restore(); }
  });
}

test("People chips write shareable URLs; history restores known, unknown, malformed and unselected views", async () => {
  const page = await openPeople("");
  try {
    const { document } = page;
    const initial = textOf(document.querySelector("#grid-title"));
    const initialNote = textOf(document.querySelector("#profile-picker-note"));
    document.querySelectorAll(".profile-filter-option").find((chip) => chip.dataset.author === names[1]).click();
    assert.equal(requestedProfileAuthor(window.location.search), names[1]);
    assertSelection(document, names[1]);
    for (const name of [names[2], "Removed & 未知", names[1]]) {
      window.location.search = searchFor(name);
      window.dispatchEvent({ type: "popstate" });
      assertSelection(document, name, names.includes(name) ? 1 : 0);
      if (!names.includes(name)) {
        assert.ok(textOf(document.querySelector(".empty-state")).includes(name));
        const links = document.querySelectorAll("a");
        assert.ok(links.some((link) => link.href === "/social.html#post-form"));
        assert.ok(links.some((link) => link.href.startsWith("/social.html?author=") && textOf(link).includes(name)));
      }
      assert.equal(textOf(document.querySelector("#profile-picker-note")), "");
    }
    window.location.search = "?author=%E0%A4%A%ZZ";
    window.dispatchEvent({ type: "popstate" });
    assertSelection(document, requestedProfileAuthor(window.location.search), 0);
    window.location.search = "";
    window.dispatchEvent({ type: "popstate" });
    assert.equal(textOf(document.querySelector("#grid-title")), initial);
    assert.equal(textOf(document.querySelector("#profile-picker-note")), initialNote);
  } finally { page.restore(); }
});


test("feed bylines link exact complex names for image and text posts", async () => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url));
  try {
    const feed = page.document.querySelector("#post-feed");
    const entries = posts.flatMap((post) => [post, { ...post, id: `${post.id}-text`, image: null }]);
    renderPosts(feed, entries);
    for (const card of feed.querySelectorAll(".post-card")) {
      const post = entries.find((entry) => entry.id === card.dataset.postId);
      const link = card.querySelector(".detail-author-link");
      assert.equal(link.tagName, "A");
      assert.equal(textOf(link), post.author);
      assert.equal(requestedProfileAuthor(new URL(link.href, "https://example.test").search), post.author);
      assert.ok(tabSequence(page.document).includes(link));
    }
    assert.equal(feed.querySelectorAll(".detail-author-link").length, entries.length);
  } finally { page.restore(); }
});

test("navigation while seed data is loading uses the latest URL", async () => {
  const page = await loadPage(new URL("../src/profile.html", import.meta.url), {
    location: { search: searchFor(names[0]) },
    routes: { "/api/social-posts?limit=100": { posts: [] } },
  });
  const originalFetch = globalThis.fetch;
  const interval = globalThis.setInterval;
  let releaseSeed;
  globalThis.fetch = (url, init) => url === "/social-demo-data.json"
    ? new Promise((resolve) => { releaseSeed = () => resolve({ ok: true, json: async () => ({ posts }) }); })
    : originalFetch(url, init);
  globalThis.setInterval = () => 0;
  try {
    await importPageModule("/profile-page.js");
    await waitFor(() => Boolean(releaseSeed), "seed request starts");
    window.location.search = searchFor(names[2]);
    window.dispatchEvent({ type: "popstate" });
    releaseSeed();
    await waitFor(() => page.document.documentElement.dataset.shiplogProfile === "ready", "People settles");
    assertSelection(page.document, names[2]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setInterval = interval;
    page.restore();
  }
});
