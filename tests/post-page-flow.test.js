// The post page as a visitor meets it: the shipped markup from src/post.html,
// the shipped wiring from src/post-page.js, and a fetch that answers the way the
// network would — with a post, with nothing, or by failing.
//
// The render layer is covered structurally in tests/post-detail.test.js. What is
// only true end to end is here: which state the page lands in for a given
// answer, that the retry button re-runs the real fetch and can recover, and that
// exactly one back link is on the page in every one of those states.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const SEED_URL = "/social-demo-data.json";

const SEED_POST = {
  id: "p-image",
  author: "Mina Okafor",
  body: "Focus rings landed everywhere.",
  caption: "The middle card, ringed.",
  createdAt: "2026-07-14T09:00:00.000Z",
  likes: 3,
  comments: 1,
  image: { src: "/media/focus-ring.svg", alt: "A card wrapped in a blue focus ring", width: 1200, height: 900 },
};

// One page, one scripted network. `answer` is called for every request the page
// makes, so a test can change its mind between attempts — which is the only way
// to assert that a retry recovers rather than re-rendering the same failure.
async function openPostPage(search, answer) {
  const page = await loadPage(new URL("../src/post.html", import.meta.url), { location: { search } });
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return answer(String(url));
  };
  await importPageModule("/post-page.js");
  const settled = () => page.document.documentElement.dataset.shiplogPostDetail === "ready";
  await waitFor(settled, `the post page settled for ${search}`);
  return { ...page, requests, settled, panel: page.document.querySelector("#post-detail") };
}

const seedResponse = (posts) => ({ ok: true, status: 200, json: async () => ({ posts }) });
const seedOnly = (posts) => (url) => {
  if (url === SEED_URL) return seedResponse(posts);
  throw new Error(`Unexpected request: ${url}`);
};

// The one exit, wherever the page is in its life. Reading it from the whole
// document rather than from a known id is the point: a second back link
// appearing anywhere — in the markup, in a state panel — fails here.
function exits(document) {
  return document.querySelectorAll("a").filter((link) => /←|Back to|Return to/.test(link.textContent));
}

function assertOneExit(page, expected, where) {
  const links = exits(page.document);
  assert.equal(links.length, 1, `${where}: expected one back link, found ${links.map(textOf).join(" + ") || "none"}`);
  assert.equal(textOf(links[0]), expected.label, `${where}: the back link's text`);
  assert.equal(links[0].href, expected.href, `${where}: the back link's destination`);
}

const SOCIAL = { label: "← Back to Social", href: "/social.html" };
const PROFILE = { label: "← Back to Profile", href: "/profile.html?author=Mina%20Okafor" };

test("a post that loads is headed by its author and reads name, time, image, caption", async () => {
  const page = await openPostPage("?id=p-image", seedOnly([SEED_POST]));
  try {
    const { document } = page;
    assert.equal(textOf(document.querySelector("#page-title")), "Mina Okafor");
    assert.equal(document.title, "Post by Mina Okafor · Social · Shiplog");

    const article = page.panel.querySelector("article");
    const time = article.querySelector("time");
    assert.equal(time.getAttribute("datetime"), "2026-07-14T09:00:00.000Z");
    assert.ok(textOf(time).length > 0, "the timestamp needs readable text as well");

    const figure = article.querySelector("figure");
    assert.equal(figure.querySelectorAll("img").length, 1);
    assert.equal(textOf(figure.querySelector("figcaption")), "The middle card, ringed.");
    assert.equal(page.panel.getAttribute("aria-busy"), "false");

    assertOneExit(page, SOCIAL, "loaded");
  } finally {
    page.restore();
  }
});

test("arriving from a profile turns the one exit into the profile's, and nothing else", async () => {
  const page = await openPostPage("?id=p-image&from=profile&author=Mina%20Okafor", seedOnly([SEED_POST]));
  try {
    assertOneExit(page, PROFILE, "from a profile");
    // The provenance came from the URL, not from the post, so it is the same
    // exit whether or not the post itself loaded.
    assert.equal(textOf(page.document.querySelector("#page-title")), "Mina Okafor");
  } finally {
    page.restore();
  }
});

test("an unknown id is named as a missing post, with the feed still the way out", async () => {
  const page = await openPostPage("?id=p-gone", seedOnly([SEED_POST]));
  try {
    assert.match(textOf(page.panel), /Post not found/);
    assert.match(textOf(page.panel), /This post may have been removed, or the link may be incomplete\./);
    assert.doesNotMatch(textOf(page.panel), /couldn’t be loaded|Try again/);
    assert.equal(page.panel.querySelector(".detail-state-message").getAttribute("role"), "status");
    assertOneExit(page, SOCIAL, "not found");
  } finally {
    page.restore();
  }
});

test("a failed lookup says the load failed, and its retry re-runs the fetch and recovers", async () => {
  let failing = true;
  const page = await openPostPage("?id=p-image", (url) => {
    if (failing) throw new TypeError("Failed to fetch");
    return seedOnly([SEED_POST])(url);
  });
  try {
    assert.match(textOf(page.panel), /Post couldn’t be loaded/);
    assert.match(textOf(page.panel), /We couldn’t reach Social, so this post didn’t load\./);
    // A failure, not an absence: the missing state's words must not appear here.
    assert.doesNotMatch(textOf(page.panel), /not found|may have been removed/i);
    assertOneExit(page, SOCIAL, "failed");

    const retry = page.panel.querySelector("button");
    assert.equal(textOf(retry), "Try again");
    // A button, not a link: retrying re-runs the fetch in place rather than
    // reloading the page and losing everything already on screen.
    assert.equal(retry.type, "button");
    assert.equal(retry.querySelectorAll("a").length, 0);

    const before = page.requests.length;
    failing = false;
    retry.click();
    await waitFor(page.settled, "the retry finished");

    assert.ok(page.requests.length > before, "the retry must actually re-run the fetch");
    assert.equal(textOf(page.document.querySelector("#page-title")), "Mina Okafor");
    assert.equal(textOf(page.panel.querySelector("figcaption")), "The middle card, ringed.");
    assert.doesNotMatch(textOf(page.panel), /couldn’t be loaded/);
    assertOneExit(page, SOCIAL, "recovered");
  } finally {
    page.restore();
  }
});

test("a visit with no id is told what the page needs, and still has one way out", async () => {
  const page = await openPostPage("", () => { throw new Error("a page with no id must not ask the network"); });
  try {
    assert.match(textOf(page.panel), /Choose a post/);
    assert.equal(page.requests.length, 0);
    assertOneExit(page, SOCIAL, "no id");
  } finally {
    page.restore();
  }
});

test("the loading state is labelled, announced, and reserves the space the post will take", async () => {
  // Held open: the seed never answers, so the page stays in its loading state
  // for as long as the assertions need it.
  const page = await loadPage(new URL("../src/post.html", import.meta.url), { location: { search: "?id=p-image" } });
  try {
    let release;
    globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(seedResponse([SEED_POST])); });
    await importPageModule("/post-page.js");
    const panel = page.document.querySelector("#post-detail");
    await waitFor(() => panel.querySelector(".detail-state-message"), "the loading state rendered");

    const state = panel.querySelector(".detail-state-message");
    assert.equal(panel.getAttribute("aria-busy"), "true");
    assert.equal(state.getAttribute("role"), "status", "the state is announced without stealing focus");
    assert.equal(page.document.activeElement, null, "nothing may take focus on load");
    assert.match(textOf(state), /Post status/);
    assert.match(textOf(state), /Loading post/);
    // Same sentence shape as the decision page's "We're finding this decision
    // and its linked releases." — a title is not a state on its own.
    assert.match(textOf(state), /We’re finding this post and its author\./);
    // Reserved space, so the post does not shove the page around when it lands.
    assert.equal(state.querySelector(".detail-skeleton").getAttribute("aria-hidden"), "true");
    assert.equal(state.querySelectorAll(".skeleton-media").length, 1);
    assertOneExit(page, SOCIAL, "loading");

    release();
    await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "ready", "the post arrived");
    assertOneExit(page, SOCIAL, "after loading");
  } finally {
    page.restore();
  }
});
