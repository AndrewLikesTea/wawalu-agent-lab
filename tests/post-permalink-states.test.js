// The four states of the single-post permalink, drawn end to end.
//
// A link pasted into a chat window is opened cold by someone with no context,
// and it has to say what happened whichever way the lookup goes. There are
// exactly four answers — loading, loaded, not-found, error — and this file's
// central claim is that exactly one of them is *in the document* at a time.
// Not one visible: one present. A state hidden with CSS or folded into a closed
// disclosure still contributes its heading to the page's heading count and is
// still reachable by a screen reader, so the inactive branches have to be gone.
//
// Two harness notes, both learned the hard way in this repo:
//   * never assert that a queried node equals null — that walks the whole
//     parsed page and hangs well past the test timeout. Count instead.
//   * this harness models no layout, so text inside a collapsed disclosure
//     still reads as present. Which is the second reason absence, not hiding,
//     is the thing being asserted.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const SEED_URL = "/social-demo-data.json";

const IMAGE_POST = {
  id: "p-image",
  author: "Mina Okafor",
  body: "Focus rings landed everywhere.",
  caption: "The middle card, ringed.",
  createdAt: "2026-07-14T09:00:00.000Z",
  likes: 3,
  comments: 1,
  image: { src: "/media/focus-ring.svg", alt: "A card wrapped in a blue focus ring", width: 1200, height: 900 },
};

const TEXT_POST = {
  id: "p-text",
  author: "Rowan Diaz",
  body: "Shipped the retry path today.",
  createdAt: "2026-07-15T11:30:00.000Z",
  likes: 1,
  comments: 0,
};

// The headline each state puts on screen. Whichever one is active, the other
// three of these must not appear anywhere in the page's text.
const STATE_HEADLINES = {
  loading: "Loading this post…",
  loaded: "Post by ",
  "not-found": "Post not found",
  error: "Post could not be loaded",
};

const seedResponse = (posts) => ({ ok: true, status: 200, json: async () => ({ posts }) });

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

const seedOnly = (posts) => (url) => {
  if (url === SEED_URL) return seedResponse(posts);
  throw new Error(`Unexpected request: ${url}`);
};

// One state, counted rather than inspected for absence. Every state panel — the
// wait, the post, and both unresolved explanations — carries the same marker,
// so a second one anywhere in the document fails here whether it is on screen,
// off screen, or inside something collapsed.
function assertOneState(page, expected, where) {
  const panels = page.document.querySelectorAll("[data-post-state-panel]");
  const present = panels.map((node) => node.getAttribute("data-post-state-panel"));
  assert.deepEqual(present, [expected], `${where}: expected exactly the ${expected} state, found ${present.join(" + ") || "none"}`);

  // The region agrees with the panel it is holding: one value, one state.
  assert.equal(page.panel.dataset.postState, expected, `${where}: the region names the state it holds`);

  // And no other state's headline survives in the text — including any that a
  // stylesheet might have hidden rather than removed.
  const text = textOf(page.document.querySelector("main"));
  for (const [state, headline] of Object.entries(STATE_HEADLINES)) {
    if (state === expected) continue;
    assert.equal(text.includes(headline), false, `${where}: the ${state} state's "${headline}" is still in the page`);
  }

  // At most one state heading in the panel: the two unresolved states own an
  // h2, the wait is a status line, and a loaded post is headed by the page's h1.
  const headings = page.panel.querySelectorAll(".empty-title");
  assert.equal(headings.length, ["not-found", "error"].includes(expected) ? 1 : 0, `${where}: state headings in the panel`);
}

/* ------------------------------- not found -------------------------------- */

test("a post id that does not exist is headed as not found, with no wait left behind", async () => {
  const page = await openPostPage("?id=p-never-existed", seedOnly([IMAGE_POST, TEXT_POST]));
  try {
    const heading = page.panel.querySelector(".empty-title");
    assert.equal(textOf(heading), "Post not found");
    assert.match(textOf(page.panel), /This post was not found\./);

    // The line the page ships with is gone, not pushed below the explanation.
    assert.equal(textOf(page.panel).includes("Loading this post…"), false);
    assert.equal(page.panel.querySelectorAll(".detail-loading").length, 0);

    // A way back to the feed lives with the explanation, so the next step is
    // named in the same place as the problem.
    const feed = page.panel.querySelector(".detail-state-feed");
    assert.equal(feed.tagName, "A");
    assert.equal(feed.getAttribute("href"), "/social.html");
    assert.equal(textOf(feed), "Return to the Social feed");

    // Nothing to retry: the feed answered, and asking it again cannot change
    // the answer. Only the error state owns a retry.
    assert.equal(page.panel.querySelectorAll("button").length, 0);

    assertOneState(page, "not-found", "an id that does not exist");
  } finally {
    page.restore();
  }
});

// The distinction the page has to draw: a feed that answered and had no such
// post, versus a feed that could not be asked. Same absent post, two answers.
test("an answered feed with no matching id is not-found, not an error", async () => {
  const answered = await openPostPage("?id=p-gone", seedOnly([IMAGE_POST]));
  try {
    assertOneState(answered, "not-found", "the feed answered");
    assert.equal(textOf(answered.panel).includes("could not be reached"), false);
  } finally {
    answered.restore();
  }

  // A non-ok response is not an answer about the post — it is a feed that could
  // not be read — so the same missing post lands in the error state instead.
  const refused = await openPostPage("?id=p-gone", () => ({ ok: false, status: 503, json: async () => ({}) }));
  try {
    assertOneState(refused, "error", "the feed returned 503");
    assert.match(textOf(refused.panel), /The Social feed could not be reached/);
    // The status code is the page's business, not the reader's.
    assert.equal(textOf(refused.panel).includes("503"), false);
  } finally {
    refused.restore();
  }
});

/* --------------------------------- error ---------------------------------- */

test("an unreachable feed is named as such, with a keyboard-reachable retry after the heading", async () => {
  const page = await openPostPage("?id=p-image", () => { throw new TypeError("Failed to fetch"); });
  try {
    assertOneState(page, "error", "the fetch threw");

    // It names what failed. "Unavailable" would be a verdict about the post; a
    // reader needs to know the feed is the thing that did not answer, because
    // that is what tells them trying again is worth anything.
    assert.match(textOf(page.panel), /The Social feed could not be reached/);
    assert.equal(textOf(page.panel.querySelector(".empty-title")), "Post could not be loaded");
    // A word, not just a wash: the state reads with the stylesheet gone.
    assert.equal(textOf(page.panel.querySelector(".detail-state-chip")), "Unreachable");

    const retry = page.panel.querySelector(".detail-retry");
    // A real button. Not a div with a click handler: this is why it is in the
    // tab order and why Enter and Space work on it without a keydown handler.
    assert.equal(retry.tagName, "BUTTON");
    assert.equal(retry.type, "button");

    // Source order, not merely visual order: the explanation is reached before
    // the control that acts on it.
    const order = page.panel.querySelectorAll("h2,p,button");
    assert.ok(order.indexOf(page.panel.querySelector(".empty-title")) < order.indexOf(retry),
      "the retry must come after the heading in the document, not just below it");

    // In the natural tab order, after the page's standing exit.
    const sequence = tabSequence(page.document);
    assert.ok(sequence.includes(retry), "the retry is reachable by keyboard");
    assert.ok(sequence.indexOf(page.document.querySelector("#post-back")) < sequence.indexOf(retry));

    retry.focus();
    assert.equal(page.document.activeElement, retry, "and it can hold focus");
  } finally {
    page.restore();
  }
});

// The visible focus indicator is the site's own, not a new one: .empty-action
// carries the shared ring, and the global button rule covers it besides. No
// stylesheet on this page removes an outline without replacing it.
test("the retry shows the site's existing focus ring", async () => {
  const page = await openPostPage("?id=p-image", () => { throw new TypeError("Failed to fetch"); });
  try {
    const retry = page.panel.querySelector(".detail-retry");
    assert.ok(retry.classList.contains("empty-action"), "the retry uses the site's action styling");
  } finally {
    page.restore();
  }

  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.empty-action:focus-visible \{[^}]*outline:3px solid var\(--focus-ring\)/);
  assert.match(css, /button:focus-visible,a:focus-visible \{[^}]*outline:3px solid var\(--focus-ring\)/);
  assert.equal(/outline\s*:\s*(none|0)/.test(css.match(/\.detail-[a-z-]*:focus[^}]*\}/g)?.join("") ?? ""), false,
    "no post-page rule may remove a focus outline");
});

test("retry re-attempts the fetch and can take the page from error to loaded", async () => {
  let failing = true;
  const page = await openPostPage("?id=p-image", (url) => {
    if (failing) throw new TypeError("Failed to fetch");
    return seedOnly([IMAGE_POST])(url);
  });
  try {
    assertOneState(page, "error", "the first attempt failed");
    const attempts = page.requests.length;

    failing = false;
    page.panel.querySelector(".detail-retry").click();
    await waitFor(page.settled, "the retry finished");

    assert.ok(page.requests.length > attempts, "the retry must re-run the fetch, not redraw the last answer");
    // error → loaded, with nothing of the failure left standing.
    assertOneState(page, "loaded", "after a retry that worked");
    assert.equal(textOf(page.document.querySelector("#page-title")), "Post by Mina Okafor");
    assert.equal(page.panel.getAttribute("aria-busy"), "false");
  } finally {
    page.restore();
  }
});

/* -------------------------------- loaded ---------------------------------- */

test("a loaded post links its display name to that name's People view", async () => {
  const page = await openPostPage("?id=p-image", seedOnly([IMAGE_POST]));
  try {
    assertOneState(page, "loaded", "a post that loaded");

    const link = page.panel.querySelector(".detail-author-link");
    assert.equal(link.tagName, "A");
    // The link's text is the name. "Profile" or "View profile" would leave a
    // screen reader's list of links unable to say whose profile any of them is.
    assert.equal(textOf(link), "Mina Okafor");
    // The People view's own URL shape (profile.js's profileHref), not a second
    // vocabulary invented for this one page.
    assert.equal(link.getAttribute("href"), "/profile.html?author=Mina%20Okafor");
    assert.ok(tabSequence(page.document).includes(link), "the name is reachable by keyboard");

    // The permalink is no longer a dead end: there is a way onward as well as
    // a way back.
    assert.equal(page.panel.querySelectorAll(".detail-author-link").length, 1);
  } finally {
    page.restore();
  }
});

test("a name with characters that need encoding still reaches its People view", async () => {
  const post = { ...TEXT_POST, author: "Ada Ø’Neil & Co" };
  const page = await openPostPage("?id=p-text", seedOnly([post]));
  try {
    const link = page.panel.querySelector(".detail-author-link");
    assert.equal(textOf(link), "Ada Ø’Neil & Co");
    assert.equal(link.getAttribute("href"), `/profile.html?author=${encodeURIComponent("Ada Ø’Neil & Co")}`);
  } finally {
    page.restore();
  }
});

test("a post with an image is announced by the description the poster stored", async () => {
  const page = await openPostPage("?id=p-image", seedOnly([IMAGE_POST]));
  try {
    const images = page.panel.querySelectorAll("img");
    assert.equal(images.length, 1, "one image, not a placeholder beside it");
    assert.equal(images[0].alt, "A card wrapped in a blue focus ring");
    assert.equal(images[0].alt, IMAGE_POST.image.alt, "the alt is the stored description verbatim");
    // The caption belongs to the image rather than merely sitting under it.
    assert.equal(textOf(page.panel.querySelector("figcaption")), "The middle card, ringed.");
    assertOneState(page, "loaded", "a post with an image");
  } finally {
    page.restore();
  }
});

test("a post with no image renders no image element and no empty frame to hold one", async () => {
  const page = await openPostPage("?id=p-text", seedOnly([TEXT_POST]));
  try {
    // Counted, never asserted equal to null: a null-check walks the whole page.
    assert.equal(page.panel.querySelectorAll("img").length, 0);
    assert.equal(page.panel.querySelectorAll("figure").length, 0);
    assert.equal(page.panel.querySelectorAll(".detail-media").length, 0, "no empty frame reserving space for nothing");
    assert.equal(page.panel.querySelectorAll(".detail-image").length, 0);

    // The post itself still reads in full.
    assert.match(textOf(page.panel), /Shipped the retry path today\./);
    assert.equal(textOf(page.panel.querySelector(".detail-author-link")), "Rowan Diaz");
    assertOneState(page, "loaded", "a post with no image");
  } finally {
    page.restore();
  }
});

/* --------------------------- one state at a time -------------------------- */

test("every state the page can reach puts exactly one of the four on screen", async () => {
  // Loading is held open on purpose: a fetch that never settles is the only way
  // to read the state a visitor meets first.
  const waiting = await loadPage(new URL("../src/post.html", import.meta.url), { location: { search: "?id=p-image" } });
  try {
    let release;
    globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(seedResponse([IMAGE_POST])); });
    await importPageModule("/post-page.js");
    const panel = waiting.document.querySelector("#post-detail");
    await waitFor(() => panel.querySelectorAll(".detail-loading").length === 1, "the loading state rendered");

    assertOneState({ ...waiting, panel }, "loading", "while the lookup runs");
    assert.equal(panel.getAttribute("aria-busy"), "true");
    // The wait carries visible words, not a bare spinner: the dot is aria-hidden
    // decoration and the sentence is the state.
    assert.equal(textOf(panel.querySelector(".detail-loading-text")), "Loading this post…");
    assert.equal(panel.querySelector(".detail-loading-dot").getAttribute("aria-hidden"), "true");

    release();
    await waitFor(() => waiting.document.documentElement.dataset.shiplogPostDetail === "ready", "the post arrived");
    assertOneState({ ...waiting, panel }, "loaded", "once the post arrived");
  } finally {
    waiting.restore();
  }

  // And the three states a settled lookup can land in.
  const cases = [
    ["loaded", "?id=p-image", seedOnly([IMAGE_POST])],
    ["not-found", "?id=p-gone", seedOnly([IMAGE_POST])],
    ["error", "?id=p-image", () => { throw new TypeError("Failed to fetch"); }],
  ];
  for (const [state, search, answer] of cases) {
    const page = await openPostPage(search, answer);
    try {
      assertOneState(page, state, `the ${state} state`);
      // Whatever the state, the page's own h1 is the only h1 on it, so the
      // heading outline has one top level rather than one per rendered state.
      assert.equal(page.document.querySelectorAll("h1").length, 1, `the ${state} state adds a second h1`);
    } finally {
      page.restore();
    }
  }
});

// Every state says what it is in words, so none of them depends on a colour or
// an icon to be understood. Asserted on text with every class name ignored.
test("all four states carry a visible text label, not colour alone", async () => {
  const labels = {
    loading: /Loading this post…/,
    loaded: /Rowan Diaz/,
    "not-found": /Post not found/,
    error: /Post could not be loaded/,
  };

  const settledCases = [
    ["loaded", "?id=p-text", seedOnly([TEXT_POST])],
    ["not-found", "?id=p-gone", seedOnly([TEXT_POST])],
    ["error", "?id=p-text", () => { throw new TypeError("Failed to fetch"); }],
  ];
  for (const [state, search, answer] of settledCases) {
    const page = await openPostPage(search, answer);
    try {
      assert.match(textOf(page.panel), labels[state], `the ${state} state must name itself in words`);
    } finally {
      page.restore();
    }
  }

  // The loading state's label ships in the markup, so it is read there — before
  // a single line of script has run, which is when a cold visitor meets it.
  const html = await readFile(new URL("../src/post.html", import.meta.url), "utf8");
  assert.match(html, labels.loading);
});
