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
import { loadPage, tabSequence, textOf } from "./support/browser.js";
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

// The page's standing pointers, wherever it is in its life. Reading them from
// the whole document rather than from known ids is the point: a third pointer
// appearing anywhere — in the markup, in a state panel — fails here.
function exits(document) {
  return document.querySelectorAll("a").filter((link) => /^Open (Social|People) to /.test(link.textContent));
}

// Both pointers, with their words fixed. Only the People destination moves, and
// only with the name the arriving URL carried.
function assertPointers(page, peopleHref, where) {
  const links = exits(page.document);
  assert.equal(links.length, 2, `${where}: expected both pointers, found ${links.map(textOf).join(" + ") || "none"}`);
  assert.deepEqual(links.map(textOf), [SOCIAL.label, PEOPLE.label], `${where}: the pointers' text`);
  assert.equal(links[0].href, SOCIAL.href, `${where}: the Social pointer's destination`);
  assert.equal(links[1].href, peopleHref, `${where}: the People pointer's destination`);
  // Nothing on the page invites a reader to step back to somewhere they have
  // most likely never been: this page is opened from a pasted link.
  assert.equal(
    page.document.querySelectorAll("a").filter((link) => /Back to/.test(link.textContent)).length,
    0,
    `${where}: a back label reappeared`,
  );
}

const SOCIAL = { label: "Open Social to read the whole feed", href: "/social.html" };
const PEOPLE = { label: "Open People to see the image posts published under one display name", href: "/profile.html" };
const MINA = "/profile.html?author=Mina%20Okafor";

test("a post that loads is headed by its author and reads name, time, image, caption", async () => {
  const page = await openPostPage("?id=p-image", seedOnly([SEED_POST]));
  try {
    const { document } = page;
    assert.equal(textOf(document.querySelector("#page-title")), "Post by Mina Okafor");
    assert.equal(document.title, "Post by Mina Okafor · Social · Shiplog");

    const article = page.panel.querySelector("article");
    const time = article.querySelector("time");
    assert.equal(time.getAttribute("datetime"), "2026-07-14T09:00:00.000Z");
    assert.ok(textOf(time).length > 0, "the timestamp needs readable text as well");

    const figure = article.querySelector("figure");
    assert.equal(figure.querySelectorAll("img").length, 1);
    assert.equal(textOf(figure.querySelector("figcaption")), "The middle card, ringed.");
    assert.equal(page.panel.getAttribute("aria-busy"), "false");

    assertPointers(page, PEOPLE.href, "loaded");
  } finally {
    page.restore();
  }
});

test("a named author narrows the People pointer's destination, and nothing else", async () => {
  const page = await openPostPage("?id=p-image&from=profile&author=Mina%20Okafor", seedOnly([SEED_POST]));
  try {
    assertPointers(page, MINA, "with a named author");
    // The name came from the URL, not from the post, so the pointers read the
    // same whether or not the post itself loaded.
    assert.equal(textOf(page.document.querySelector("#page-title")), "Post by Mina Okafor");
  } finally {
    page.restore();
  }
});

test("an unknown id is named as a missing post, with the feed still the way out", async () => {
  const page = await openPostPage("?id=p-gone", seedOnly([SEED_POST]));
  try {
    assert.match(textOf(page.panel), /Post not found/);
    assert.match(textOf(page.panel), /This post was not found\./);
    assert.match(textOf(page.panel), /Social is a shared demo feed, not a signed-in account\./);
    // No post, no author: the h1 names the page rather than standing as "Post".
    assert.equal(textOf(page.document.querySelector("#page-title")), "Post from Social");
    assert.doesNotMatch(textOf(page.panel), /Try again/);
    assert.equal(page.panel.querySelector(".detail-state-message").getAttribute("role"), "status");
    assert.equal(page.document.title, "Post not found · Shiplog");
    assertPointers(page, PEOPLE.href, "not found");
    const feed = page.panel.querySelector(".detail-state-feed");
    assert.equal(textOf(feed), "Return to the Social feed");
    assert.equal(feed.getAttribute("href"), "/social.html");
    assert.ok(tabSequence(page.document).includes(page.document.querySelector("#post-back")));
  } finally {
    page.restore();
  }
});

test("a missing post reached with an author still offers the feed it belonged to", async () => {
  const page = await openPostPage("?id=p-gone&from=profile&author=Mina%20Okafor", seedOnly([SEED_POST]));
  try {
    assertPointers(page, MINA, "missing, with a named author");
    // The panel names the feed too, beside the explanation of what went wrong,
    // so the next step is offered where the problem is read.
    const feed = page.panel.querySelector(".detail-state-feed");
    assert.equal(feed.getAttribute("href"), "/social.html");
    assert.equal(textOf(feed), "Return to the Social feed");
    // The site's two directories are both excluded: the header nav and the
    // footer's site map name every destination on every page, and neither is a
    // route this page offers. What is counted is what the page itself says.
    const toFeed = page.document.querySelectorAll("a")
      .filter((link) => link.getAttribute("href") === "/social.html"
        && !link.closest(".site-nav") && !link.closest("#site-footer"));
    assert.equal(toFeed.length, 2, "the standing pointer and the panel's recovery action, and nothing else");

    // Tab order: the exit first, then the post region's own action.
    const sequence = tabSequence(page.document);
    assert.ok(sequence.indexOf(page.document.querySelector("#post-back")) < sequence.indexOf(feed));
  } finally {
    page.restore();
  }
});

test("a failed lookup names the feed it could not reach, and retry can recover", async () => {
  let failing = true;
  const page = await openPostPage("?id=p-image", (url) => {
    if (failing) throw new TypeError("Failed to fetch");
    return seedOnly([SEED_POST])(url);
  });
  try {
    assert.match(textOf(page.panel), /Post could not be loaded/);
    assert.match(textOf(page.panel), /The Social feed could not be reached/);
    assert.match(textOf(page.panel), /Social is a shared demo feed, not a signed-in account\./);
    assertPointers(page, PEOPLE.href, "failed");

    const retry = page.panel.querySelector("button");
    assert.equal(textOf(retry), "Retry");
    // A button, not a link: retrying re-runs the fetch in place rather than
    // reloading the page and losing everything already on screen.
    assert.equal(retry.type, "button");
    assert.equal(retry.querySelectorAll("a").length, 0);

    const before = page.requests.length;
    failing = false;
    retry.click();
    await waitFor(page.settled, "the retry finished");

    assert.ok(page.requests.length > before, "the retry must actually re-run the fetch");
    assert.equal(textOf(page.document.querySelector("#page-title")), "Post by Mina Okafor");
    assert.equal(textOf(page.panel.querySelector("figcaption")), "The middle card, ringed.");
    assert.doesNotMatch(textOf(page.panel), /could not be reached/);
    assert.equal(page.panel.dataset.postState, "loaded");
    assertPointers(page, PEOPLE.href, "recovered");
  } finally {
    page.restore();
  }
});

test("a visit with no id is told what the page needs, and still has one way out", async () => {
  const page = await openPostPage("", () => { throw new Error("a page with no id must not ask the network"); });
  try {
    assert.match(textOf(page.panel), /Choose a post/);
    assert.equal(page.requests.length, 0);
    assertPointers(page, PEOPLE.href, "no id");
  } finally {
    page.restore();
  }
});

test("the loading state is one announced line in the post's region, and takes no focus", async () => {
  // Held open: the seed never answers, so the page stays in its loading state
  // for as long as the assertions need it.
  const page = await loadPage(new URL("../src/post.html", import.meta.url), { location: { search: "?id=p-image" } });
  try {
    let release;
    globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(seedResponse([SEED_POST])); });
    await importPageModule("/post-page.js");
    const panel = page.document.querySelector("#post-detail");
    await waitFor(() => panel.querySelector(".detail-loading"), "the loading state rendered");

    const state = panel.querySelector(".detail-loading");
    assert.equal(panel.getAttribute("aria-busy"), "true");
    assert.equal(state.getAttribute("role"), "status", "the state is announced without stealing focus");
    assert.equal(page.document.activeElement, null, "nothing may take focus on load");
    assert.equal(textOf(state), "Loading this post…");
    // Nothing is named yet, so the h1 names the page — the same words a reader
    // sees in the shipped markup before any script runs.
    assert.equal(textOf(page.document.querySelector("#page-title")), "Post from Social");
    // A wait, not a second page: no state banner, no heading of its own, and no
    // placeholder block standing in for an image this post may not have.
    assert.equal(panel.querySelectorAll(".detail-state-message").length, 0);
    assert.equal(panel.querySelectorAll("h2").length, 0);
    assert.equal(panel.querySelectorAll(".skeleton-media").length, 0);
    // The frame around it still says what the page is, so the region is never
    // an unexplained blank.
    assert.match(textOf(page.document.querySelector(".hero-post")), /Social is a shared demo feed/);
    assertPointers(page, PEOPLE.href, "loading");
    // Nothing inside the waiting region is tabbable, so the exit stays the
    // first thing on the page a keyboard reader reaches after the site frame.
    assert.equal(tabSequence(page.document).filter((node) => node.closest("#post-detail")).length, 0);

    release();
    await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "ready", "the post arrived");
    assert.equal(panel.getAttribute("aria-busy"), "false");
    assertPointers(page, PEOPLE.href, "after loading");
  } finally {
    page.restore();
  }
});

// The state a visitor meets before a single line of this page's script has run.
// A shared link is opened cold, and the markup paints first; the region used to
// ship empty, so the page read as a heading, a sentence, and a hole.
test("the page opens already saying it is loading, and the post replaces that line", async () => {
  const page = await loadPage(new URL("../src/post.html", import.meta.url), { location: { search: "?id=p-image" } });
  try {
    const panel = page.document.querySelector("#post-detail");

    // Shipped markup, no module imported yet.
    assert.equal(panel.dataset.postState, "loading");
    assert.equal(panel.getAttribute("aria-busy"), "true");
    assert.equal(panel.querySelectorAll(".detail-loading").length, 1);
    assert.equal(textOf(panel.querySelector(".detail-loading")), "Loading this post…");
    assert.equal(panel.querySelector(".detail-loading").getAttribute("role"), "status");
    // The states that explain an absent post are not in the markup at all, so
    // the wait and an unavailable panel cannot be read together at any point.
    assert.equal(panel.querySelectorAll(".detail-state-message").length, 0);
    assert.equal(panel.querySelectorAll(".detail-post").length, 0);
    // And it takes nothing away from the exit above it.
    assertPointers(page, PEOPLE.href, "before the script runs");
    assert.equal(tabSequence(page.document).filter((node) => node.closest("#post-detail")).length, 0);

    // Held open, so the script's own render of the same line can be read.
    let release;
    globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(seedResponse([SEED_POST])); });
    await importPageModule("/post-page.js");
    await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "loading", "the script took the region");

    assert.equal(panel.dataset.postState, "loading", "the script agrees with the markup it replaced");
    assert.equal(panel.querySelectorAll(".detail-loading").length, 1, "one wait line, not the shipped one plus a second");
    assert.equal(textOf(panel.querySelector(".detail-loading")), "Loading this post…");
    assert.equal(panel.querySelectorAll(".detail-state-message").length, 0);

    release();
    await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "ready", "the post arrived");

    // Resolved: one state, and the wait is gone rather than pushed off screen.
    assert.equal(panel.dataset.postState, "loaded");
    assert.equal(panel.querySelectorAll(".detail-loading").length, 0);
    assert.equal(panel.querySelectorAll(".detail-post").length, 1);
    assert.equal(panel.getAttribute("aria-busy"), "false");
    assert.doesNotMatch(textOf(panel), /Loading this post/);
    assert.equal(textOf(page.document.querySelector("#page-title")), "Post by Mina Okafor");
  } finally {
    page.restore();
  }
});

// The other exit from the loading state: no post to show, one state on the
// region, and the wait line gone rather than sitting under the explanation.
test("a missing post leaves the loading state behind entirely", async () => {
  const page = await openPostPage("?id=p-gone", seedOnly([SEED_POST]));
  try {
    const panel = page.panel;
    assert.equal(panel.dataset.postState, "not-found");
    assert.equal(panel.querySelectorAll(".detail-loading").length, 0, "the wait must not survive under the explanation");
    assert.doesNotMatch(textOf(panel), /Loading this post/);
    assert.equal(panel.querySelectorAll(".detail-state-message").length, 1);
    assert.equal(panel.getAttribute("aria-busy"), "false");
    // The body still carries a way forward, alongside the standing exit above.
    assert.equal(textOf(panel.querySelector(".detail-state-feed")), "Return to the Social feed");
  } finally {
    page.restore();
  }
});

test("the failed state reads back link, then the post's region, then its retry", async () => {
  const page = await openPostPage("?id=p-image", () => { throw new TypeError("Failed to fetch"); });
  try {
    const { document } = page;
    const back = document.querySelector("#post-back");
    const retry = page.panel.querySelector(".detail-retry");

    // Document order, which is tab order here: the way out, the post's region,
    // then the one action that region owns.
    const sequence = tabSequence(document);
    assert.ok(sequence.includes(back) && sequence.includes(retry), "both controls are reachable by keyboard");
    assert.ok(sequence.indexOf(back) < sequence.indexOf(retry), "the exit comes before the retry");
    assert.ok(retry.closest("#post-detail"), "the retry belongs to the post's region, not the page frame");
    // The panel offers both a return to the feed and a retry.
    assert.equal(page.panel.querySelectorAll("button").length, 1);
    assert.equal(page.panel.querySelectorAll("a").length, 1);
    assert.equal(textOf(page.panel.querySelector("a")), "Return to the Social feed");
  } finally {
    page.restore();
  }
});

test("a retry that succeeds puts the reader on the post, not back at the top", async () => {
  let failing = true;
  const page = await openPostPage("?id=p-image", (url) => {
    if (failing) throw new TypeError("Failed to fetch");
    return seedOnly([SEED_POST])(url);
  });
  try {
    const retry = page.panel.querySelector(".detail-retry");
    retry.focus();
    assert.equal(page.document.activeElement, retry);

    // A retry that fails again must not drop focus on the floor: the button the
    // reader is standing on is replaced by a new one, so focus follows it.
    retry.click();
    await waitFor(page.settled, "the second failure rendered");
    const second = page.panel.querySelector(".detail-retry");
    assert.notEqual(second, retry, "the failed state re-rendered");
    assert.equal(page.document.activeElement, second, "focus follows the retry it replaced");

    failing = false;
    second.click();
    await waitFor(page.settled, "the retry recovered");
    // And when it works, focus lands on what was asked for. -1 keeps the post
    // out of the tab sequence, so nothing new appears in it.
    const article = page.panel.querySelector(".detail-post");
    assert.equal(page.document.activeElement, article);
    assert.equal(article.getAttribute("tabindex"), "-1");
    assert.equal(tabSequence(page.document).includes(article), false);
  } finally {
    page.restore();
  }
});
