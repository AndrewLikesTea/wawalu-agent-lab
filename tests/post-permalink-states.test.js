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
import { readdir, readFile } from "node:fs/promises";
import { DomEvent, loadPage, parseHtml, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";
import { postDetailHref } from "../src/social-links.js";
// The settled connection sentence People writes, taken from the module that
// writes it so a reworded status cannot leave the People half of the walk below
// waiting forever.
import { profileConnectionLine } from "../src/profile.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const SEED_URL = "/social-demo-data.json";
const LIVE_URL = "/api/social-posts?limit=100";

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
  loading: "Loading the shared post…",
  loaded: "Post by ",
  "not-found": "Post unavailable",
  error: "Post could not be opened",
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
    assert.equal(textOf(heading), "Post unavailable");
    assert.match(textOf(page.panel), /This post can’t be shown\./);
    assert.doesNotMatch(textOf(page.panel), /removed|private|signed-in|your post/i);

    // The line the page ships with is gone, not pushed below the explanation.
    assert.equal(textOf(page.panel).includes(STATE_HEADLINES.loading), false);
    assert.equal(page.panel.querySelectorAll(".detail-loading").length, 0);

    // A way back to the feed lives with the explanation, so the next step is
    // named in the same place as the problem.
    const feed = page.panel.querySelector(".detail-state-feed");
    assert.equal(feed.tagName, "A");
    assert.equal(feed.getAttribute("href"), "/social.html");
    assert.equal(textOf(feed), "Go to the Social feed");

    // Nothing to retry: the feed answered, and asking it again cannot change
    // the answer. Only the error state owns a retry.
    assert.equal(page.panel.querySelectorAll("button").length, 0);

    assertOneState(page, "not-found", "an id that does not exist");
  } finally {
    page.restore();
  }
});

// The wait and the answer share one slot, and the slot is the guarantee.
//
// Held open across the transition rather than sampled at the end: the claim is
// not "the not-found state looks right afterwards", it is that the sentence a
// reader was given while the lookup ran is *gone from the document* the moment
// there is an answer, because the same region was emptied and refilled. Two
// nodes toggled by a class or by `hidden` would pass an end-state check and
// still leave the loading sentence in the accessibility tree — and would leave
// the next render path someone adds free to show both.
test("the wait and the not-found answer are one slot, so they can never both stand", async () => {
  const page = await loadPage(new URL("../src/post.html", import.meta.url), { location: { search: "?id=p-never-existed" } });
  try {
    let release;
    globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(seedResponse([IMAGE_POST])); });
    await importPageModule("/post-page.js");
    const panel = page.document.querySelector("#post-detail");
    await waitFor(() => panel.querySelectorAll(".detail-loading").length === 1, "the loading state rendered");

    // While it runs: the wait, and nothing else claiming to be a state.
    assert.equal(panel.querySelectorAll("[data-post-state-panel]").length, 1);
    assert.equal(textOf(panel).includes("Post unavailable"), false, "the answer must not be pre-rendered behind the wait");

    release();
    await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "ready", "the lookup settled");

    // Afterwards: the answer in words, and not one node of the wait left — not
    // hidden, not emptied, not carried along beside it. Counted, never compared
    // against null, which walks the whole parsed page.
    assert.equal(panel.querySelectorAll(".detail-loading").length, 0);
    assert.equal(panel.querySelectorAll(".detail-loading-text").length, 0);
    assert.equal(panel.querySelectorAll("[data-post-state-panel]").length, 1);
    assert.equal(textOf(page.document.querySelector("main")).includes(STATE_HEADLINES.loading), false);
    assert.match(textOf(panel), /This post can’t be shown\./);

    // One slot: the same region node held both, so there is no second element
    // for a later state to be parked in.
    assert.equal(page.document.querySelectorAll("#post-detail").length, 1);
    assert.equal(panel.dataset.postState, "not-found");

    // And the stated outcome reads before the standing route onward, which is
    // still there in its shipped position and wording.
    const flow = page.document.querySelector("#main-content").querySelectorAll("#post-detail,#post-back");
    assert.deepEqual(flow.map((node) => node.id), ["post-detail", "post-back"]);
    assert.equal(textOf(page.document.querySelector("#post-back")), SOCIAL_LINK);
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
    assert.match(textOf(refused.panel), /The Social feed did not respond\./);
    // The status code is the page's business, not the reader's.
    assert.equal(textOf(refused.panel).includes("503"), false);
  } finally {
    refused.restore();
  }
});

// A link can fail to name a post in more ways than one: it can carry an id
// nobody posted under, it can carry an id a chat client truncated, or it can
// carry none at all. To the reader those are one answer — this link did not
// reach a post — so they are one state, headed by one set of words. Only the
// sentence under the heading differs, and only where it can say something true
// about how this particular link failed.
const NOT_FOUND_ROUTES = [
  ["no id at all", "", () => { throw new Error("a link with no id must not ask the network"); },
    /This link does not point to a post we can show/],
  ["a truncated id", "?id=8f14e45f-ceea-467a", seedOnly([IMAGE_POST, TEXT_POST]), /This post can’t be shown\./],
  ["an id that is only spaces", "?id=%20%20", seedOnly([IMAGE_POST]), /This post can’t be shown\./],
];

test("a link with no id, or a truncated one, lands in the same not-found state as a stale id", async () => {
  for (const [route, search, answer, sentence] of NOT_FOUND_ROUTES) {
    const page = await openPostPage(search, answer);
    try {
      // The same named state, the same heading, the same chip word.
      assertOneState(page, "not-found", route);
      assert.equal(textOf(page.panel.querySelector(".empty-title")), "Post unavailable", `${route}: the heading names what happened`);
      assert.equal(textOf(page.panel.querySelector(".detail-state-chip")), "Not found", `${route}: the chip carries its own word`);
      assert.match(textOf(page.panel), sentence, `${route}: the sentence says how this link failed`);

      // The wait is gone from the document, not pushed below the answer.
      assert.equal(textOf(page.document.querySelector("main")).includes(STATE_HEADLINES.loading), false, `${route}: the wait is still on the page`);
      assert.equal(page.panel.querySelectorAll(".detail-loading").length, 0, `${route}: a loading node survived`);

      // One next step: the feed. Counted, because the assertion is about how
      // many routes forward this state offers, not which node is where.
      assert.equal(page.panel.querySelectorAll(".empty-action").length, 1, `${route}: one next step, not a stack`);
      assert.equal(textOf(page.panel.querySelector(".detail-state-feed")), "Go to the Social feed");
      assert.equal(page.panel.querySelectorAll("button").length, 0, `${route}: nothing here can be retried`);
    } finally {
      page.restore();
    }
  }
});

// The People link's words are about one display name's other posts. On a state
// with no post there is no such name — not even when the arriving URL claimed
// one, because a claim is not a name this page resolved — so the link is gone
// from the document rather than left pointing at People-in-general under words
// that promise a person. Social stays: the feed is true either way.
test("the states with no post withdraw the People link and keep the one to Social", async () => {
  const cases = [
    ["not-found", "?id=p-never-existed", seedOnly([IMAGE_POST])],
    ["not-found, with an author in the URL", "?id=p-gone&author=Mina%20Okafor", seedOnly([IMAGE_POST])],
    ["no id", "", () => { throw new Error("a link with no id must not ask the network"); }],
    ["error", "?id=p-image", () => { throw new TypeError("Failed to fetch"); }],
  ];
  for (const [where, search, answer] of cases) {
    const page = await openPostPage(search, answer);
    try {
      const exits = page.document.querySelectorAll(".detail-back").filter((link) => !link.hidden);
      // The feed, and the reader's own next post. Neither depends on this
      // lookup having found anything, so both survive a link that reached no
      // post at all.
      assert.deepEqual(exits.map(textOf), SETTLED_EXITS, `${where}: the routes out`);
      assert.equal(exits[0].getAttribute("href"), "/social.html");
      assert.equal(exits[1].getAttribute("href"), "/social.html#post-form");
      // Withdrawn from the document, not hidden: a hidden link still reads to a
      // screen reader in this harness, which models no layout at all.
      assert.equal(page.document.querySelector("#post-people").hidden, true, `${where}: the People link is rendered`);
      assert.equal(textOf(page.document.querySelector("main")).includes(PEOPLE_LINK), false, `${where}: its words are still on the page`);
      // And it is not merely out of the tab order while still being read.
      assert.equal(tabSequence(page.document).filter((stop) => textOf(stop) === PEOPLE_LINK).length, 0);
    } finally {
      page.restore();
    }
  }
});

// Withdrawing a link is fine. Withdrawing the link a reader is standing on,
// and saying nothing about where they now are, is not: focus would fall to the
// document and a keyboard reader would restart from the top of the page.
test("a reader standing on the People link keeps their place when it is withdrawn", async () => {
  const page = await loadPage(new URL("../src/post.html", import.meta.url), { location: { search: "?id=p-gone" } });
  try {
    let release;
    globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(seedResponse([IMAGE_POST])); });
    await importPageModule("/post-page.js");
    const panel = page.document.querySelector("#post-detail");
    await waitFor(() => panel.querySelectorAll(".detail-loading").length === 1, "the loading state rendered");

    // Standing on it while the lookup is still open, which is when it is still
    // offered — a post may yet arrive.
    const people = page.document.querySelector("#post-people");
    people.focus();
    assert.equal(page.document.activeElement, people);

    release();
    await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "ready", "the lookup settled");

    // The post was not there, so the link is gone — and focus is on the exit
    // beside it rather than nowhere.
    assert.equal(page.document.querySelector("#post-people").hidden, true);
    assert.equal(page.document.activeElement, page.document.querySelector("#post-back"));
  } finally {
    page.restore();
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
    assert.match(textOf(page.panel), /The Social feed did not respond\./);
    assert.equal(textOf(page.panel.querySelector(".empty-title")), "Post could not be opened");
    assert.equal(textOf(page.panel.querySelector(".detail-state-feed")), "Read the full Social feed");
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

    // In the natural tab order, and ahead of the page's standing exit: the post
    // slot sits above the routes off the page, so the action that can still
    // produce the post is reached before the ones that leave without it.
    const sequence = tabSequence(page.document);
    assert.ok(sequence.includes(retry), "the retry is reachable by keyboard");
    assert.ok(sequence.indexOf(retry) < sequence.indexOf(page.document.querySelector("#post-back")));

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

// The same recovery, driven from the keyboard alone: tab to the control and
// press Enter. Nothing here calls click() — the point is that a reader who
// never touches a pointer can get out of the error state, and that the page
// re-attempts the load in place rather than reloading itself.
test("the retry is reached by Tab and fired by Enter, and the People link returns with the post", async () => {
  let failing = true;
  const page = await openPostPage("?id=p-image", (url) => {
    if (failing) throw new TypeError("Failed to fetch");
    return seedOnly([IMAGE_POST])(url);
  });
  try {
    assertOneState(page, "error", "the first attempt failed");
    const attempts = page.requests.length;

    // Tabbed to, not focused by hand: the control has to be in the sequence a
    // keyboard reader actually walks.
    const retry = page.panel.querySelector(".detail-retry");
    let presses = tabSequence(page.document).length;
    while (page.document.activeElement !== retry && presses > 0) {
      pressTab(page.document);
      presses -= 1;
    }
    assert.equal(page.document.activeElement, retry, "Tab must reach the retry");

    failing = false;
    pressEnter(page.document);
    await waitFor(page.settled, "the retry finished");

    assert.ok(page.requests.length > attempts, "Enter must re-run the load, not redraw the last answer");
    assertOneState(page, "loaded", "after an Enter-driven retry");
    // No reload: the same document is still standing, which is the only reason
    // the assertions above can see the page at all.
    assert.equal(page.document.querySelectorAll("h1").length, 1);
    // A post again, so the link whose words are about its author comes back.
    assert.deepEqual(page.document.querySelectorAll(".detail-back").map(textOf), CHROME_LINKS);
    assert.equal(page.document.querySelector("#post-people").getAttribute("href"), "/profile.html?author=Mina%20Okafor");
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

/* ------------------- the description, and its parity ---------------------- */

// The composer refuses to publish an image without a description, and until now
// the only reader who ever got that description was one using a screen reader:
// it lived in an alt attribute and nowhere else. On a permalink — the one page
// opened cold, from a link pasted into a chat window — that is the difference
// between reading the post and guessing at it. It is now on screen, under a
// label saying what it is, in the caption type this site already uses for
// exactly this text on the feed and on a People tile.
const DESCRIPTION_LABEL = "Image description:";

test("a loaded post shows the poster's image description under a visible label", async () => {
  const page = await openPostPage("?id=p-image", seedOnly([IMAGE_POST]));
  try {
    const label = page.panel.querySelector(".detail-image-description-label");
    const text = page.panel.querySelector(".detail-image-description-text");
    assert.equal(textOf(label), DESCRIPTION_LABEL, "the description is labelled in words, not by position");
    assert.equal(textOf(text), IMAGE_POST.image.alt, "and the label is followed by what the poster wrote");

    // The description leads the image in source order, followed by the image's
    // caption. It remains adjacent to the figure and inside the post region.
    const parts = page.panel.querySelectorAll(".detail-image-description-text,.detail-image,figcaption");
    assert.deepEqual(parts.map((node) => node.className),
      ["detail-image-description-text", "detail-image", "detail-caption"],
      "description, then image, then the post's caption");

    // No new type role and no new hue: the paragraph carries the class the feed
    // and a People tile already draw this text with. styles.css has no headroom
    // for a fourth spelling of one rule, and a fourth spelling is how three
    // surfaces start disagreeing about what a caption looks like.
    const note = page.panel.querySelector(".detail-image-description");
    assert.equal(note.tagName, "P");
    assert.ok(note.classList.contains("description-note"), "the existing caption role, reused");
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    assert.doesNotMatch(css, /\.detail-image-description[\s,{]/, "the reused class must not grow a rule of its own");

    // It is text, not a control: the first screen's tab budget is tight and
    // nothing here may spend any of it.
    const stops = tabSequence(page.document);
    assert.equal(stops.filter((stop) => stop.closest("figure")).length, 0, "the figure adds no tab stop");
    assertOneState(page, "loaded", "a described post");
  } finally {
    page.restore();
  }
});

// One value, used twice. The alt attribute and the sentence on screen are not
// two copies of the description kept in step by hand — they are the same string,
// read from one place in src/post-detail.js, which is why they cannot drift.
test("the image's alt and its visible description are one string, byte for byte", async () => {
  const page = await openPostPage("?id=p-image", seedOnly([IMAGE_POST]));
  try {
    const img = page.panel.querySelector(".detail-image");
    const visible = page.panel.querySelector(".detail-image-description-text");
    // Read off the node's own text, so the label beside it cannot pad the
    // comparison, and compared with === rather than a regex.
    assert.equal(img.alt, visible.textContent);
    assert.equal(img.alt, IMAGE_POST.image.alt);
    assert.equal(visible.textContent, IMAGE_POST.image.alt);
  } finally {
    page.restore();
  }
});

// The state a shared link is most likely to land in months later: the post is
// still there and the image behind it is not. What a reader gets then is the
// description in the image's place and a sentence saying the image could not be
// shown — never a blank box, and never a tinted frame as the only signal.
test("an image that cannot be shown is replaced by its description and a sentence saying so", async () => {
  const page = await openPostPage("?id=p-image", seedOnly([IMAGE_POST]));
  try {
    const before = tabSequence(page.document).length;
    page.panel.querySelector(".detail-image").dispatchEvent(new DomEvent("error"));

    const fallback = page.panel.querySelector(".detail-media-fallback");
    assert.equal(fallback.hidden, false, "the placeholder is in the document and not hidden");
    assert.equal(page.panel.querySelectorAll(".detail-image").length, 0, "the broken image element is gone, not left as a blank box");
    assert.equal(page.panel.querySelector(".detail-media").dataset.state, "error");

    // The description stands where the image was, unprefixed, so it is still the
    // exact string the alt held.
    const spoken = textOf(fallback);
    assert.ok(spoken.includes(IMAGE_POST.image.alt), "the description takes the image's place");
    assert.match(spoken, /We couldn’t show the image on this post/);
    assert.ok(spoken.includes("Image unavailable"), "and the state is labelled in words, not by tint alone");

    // The post is still a post: the display name, the timestamp and the caption
    // all survive the image, and so does the labelled description under it.
    assert.equal(textOf(page.panel.querySelector(".detail-author-link")), IMAGE_POST.author);
    assert.equal(textOf(page.panel.querySelector("figcaption")), IMAGE_POST.caption);
    assert.equal(textOf(page.panel.querySelector(".detail-image-description-text")), IMAGE_POST.image.alt);
    assert.equal(page.panel.querySelectorAll("time").length, 1);

    // A failure that offers nothing to press: same tab stops broken as whole.
    assert.equal(tabSequence(page.document).length, before, "the failed image adds no control");
    assertOneState(page, "loaded", "a post whose image failed");
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

/* ------------------------- the page's own chrome -------------------------- */

// What a cold visitor needs is not in the post. It is the frame around it: where
// this page sits, where to go next, and that none of it is real. A shared link
// can resolve to a post or to nothing at all, and the frame has to read the same
// either way — so this is asserted in the missing state as well as the loaded
// one, not just in the state that happens to work.
const SOCIAL_LINK = "Read the full Social feed";
const PEOPLE_LINK = "Open People to see Mina Okafor’s other image posts";
const PUBLISH_LINK = "Publish a post of your own on Social";
const CHROME_LINKS = [SOCIAL_LINK, PEOPLE_LINK, PUBLISH_LINK];
// What each state offers. Social is true whatever the lookup did — the feed
// exists either way — so it stands in all four. People is offered only where
// there is a post, because its words are about that post's display name and a
// state with no post has no name to put behind them. Publish is about the
// reader rather than about this post, so it stands wherever the lookup has
// settled and is withheld only while it is still running.
const SETTLED_EXITS = [SOCIAL_LINK, PUBLISH_LINK];
const EXITS_BY_STATE = {
  loading: [SOCIAL_LINK],
  loaded: CHROME_LINKS,
  "not-found": SETTLED_EXITS,
  error: SETTLED_EXITS,
};
// Word for word the last sentence of Social's own intro, because a visitor who
// lands here may never open /social.html.
const DEMO_SENTENCE = "Posts use no customer or production data.";
// What a pasted link opens, for a reader who has never seen the feed. It is
// context about the page, not about this post — which is also why it holds in
// the states where the lookup found nothing — so it reads after the post
// rather than in front of it.
const CONTEXT_SENTENCE = "Shared links like this one open a single post from Social’s shared demo feed.";

test("the words of a route out never change, and the demo sentence survives every state", async () => {
  const cases = [
    ["loaded", "?id=p-image", seedOnly([IMAGE_POST])],
    ["not-found", "?id=p-never-existed", seedOnly([IMAGE_POST])],
    ["error", "?id=p-image", () => { throw new TypeError("Failed to fetch"); }],
  ];
  for (const [state, search, answer] of cases) {
    const page = await openPostPage(search, answer);
    try {
      const main = page.document.querySelector("#main-content");

      // The labels this state offers, in this order. Counted and read, never
      // checked for absence against null. No state rewrites a label — a state
      // with nothing to say behind one withdraws the whole link instead.
      assert.deepEqual(page.document.querySelectorAll(".detail-back").filter((link) => !link.hidden).map(textOf), EXITS_BY_STATE[state],
        `the ${state} state changed the page's routes out`);

      // Neither says "Back", and neither carries a return glyph: nobody arriving
      // on a pasted link has a step to undo.
      for (const label of CHROME_LINKS) assert.doesNotMatch(label, /←|Back/);

      assert.equal(textOf(main).includes(DEMO_SENTENCE), true,
        `the ${state} state lost the sentence saying the feed is a demo`);

      // And none of it lives in the region the fetch replaces — which is the
      // whole reason it survives. renderPostDetail() empties #post-detail on
      // every render, so anything inside it is gone the moment a state changes.
      assert.equal(page.panel.querySelectorAll(".detail-back").length, 0,
        `the ${state} state's routes out must sit in the page frame, not the panel`);
      assert.equal(textOf(page.panel).includes(DEMO_SENTENCE), false,
        `the ${state} state must not repeat the demo sentence inside the panel`);
    } finally {
      page.restore();
    }
  }

  // The frame paints before any script runs, so the words above are read from
  // the shipped markup too, not only from a page that has finished loading.
  const html = await readFile(new URL("../src/post.html", import.meta.url), "utf8");
  assert.ok(html.includes(`>${SOCIAL_LINK}</a>`), `${SOCIAL_LINK} must ship in the markup`);
  assert.ok(html.includes(`<p>${DEMO_SENTENCE}</p>`), "the demo sentence must ship in the markup");
  // The eyebrow is the feed pages' eyebrow, word for word, so a permalink is
  // stamped as a demo the same way /social.html and /profile.html are — and it
  // no longer says "post" a line above the h1 that says it and two lines above
  // the sentence that says it again.
  assert.match(html, /<p class="eyebrow">Social · demo<\/p>/);
});

// The row a visitor lands next to when a shared link is all they have.
//
// Nobody arrives here with history behind them, so what the page offers onward
// is the whole of their map: the person who published this, the feed it came
// out of, and the page where they can write one of their own. Read off the
// links themselves rather than by walking children — this harness keeps text
// nodes in node.children, and a hidden link still carries its words, so what is
// *offered* is the visible set and nothing else.
const offeredRow = (document) => {
  const links = document.querySelectorAll(".detail-back").filter((link) => !link.hidden);
  for (const link of links) assert.ok(link.closest(".detail-page-exits"), `${link.id} left the onward row`);
  return links;
};

test("the onward row offers the feed, the display name and a post of your own", async () => {
  // Loaded: all three, in reading order, each carrying its own words.
  const loaded = await openPostPage("?id=p-image", seedOnly([IMAGE_POST]));
  try {
    const row = offeredRow(loaded.document);
    assert.equal(row.length, 3, "a loaded permalink offers exactly three controls");
    assert.deepEqual(row.map(textOf), CHROME_LINKS, "the row's reading order");
    assert.deepEqual(row.map((link) => link.getAttribute("href")), [
      "/social.html",
      `/profile.html?author=${encodeURIComponent(IMAGE_POST.author)}`,
      "/social.html#post-form",
    ], "each control's destination");
    // The People link's words and its filter are one claim about one display
    // name, so the name has to be readable in the label as well as in the URL.
    assert.ok(textOf(row[1]).includes(IMAGE_POST.author), "the People link must name the display name it filters to");

    // Nothing distinguishing them is colour: each carries its own text, no
    // aria-label stands in for words the eye cannot read, and all three share
    // the one focus-ring rule this site declares for `.detail-back`.
    for (const link of row) {
      assert.equal(link.getAttribute("aria-label"), null, `${link.id} must name its destination in visible text`);
      assert.equal(link.classList.contains("detail-back"), true, `${link.id} must inherit the site's focus ring`);
    }

    // Tab order follows reading order, walked off the sequence a keyboard
    // reader actually travels.
    const sequence = tabSequence(loaded.document);
    const stops = row.map((link) => sequence.indexOf(link));
    assert.equal(stops.filter((stop) => stop < 0).length, 0, "every control in the row is reachable by keyboard");
    assert.deepEqual(stops.slice().sort((a, b) => a - b), stops, "tab order must follow the row's reading order");
  } finally {
    loaded.restore();
  }

  // Loading: the feed alone. A People link here would have to guess at a name,
  // and a stub or a disabled control would promise one the page does not have.
  const waiting = await loadPage(new URL("../src/post.html", import.meta.url), { location: { search: "?id=p-image" } });
  try {
    let release;
    globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(seedResponse([IMAGE_POST])); });
    await importPageModule("/post-page.js");
    await waitFor(() => waiting.document.querySelector("#post-detail").querySelectorAll(".detail-loading").length === 1, "the loading state rendered");

    const row = offeredRow(waiting.document);
    assert.equal(row.length, 1, "a lookup still running offers exactly one control");
    assert.deepEqual(row.map(textOf), [SOCIAL_LINK]);
    assert.equal(row.filter((link) => link.id === "post-people").length, 0, "no People link before the display name is known");
    // Withheld, not stubbed: the withheld link holds no placeholder name for a
    // later render to have to correct.
    assert.equal(textOf(waiting.document.querySelector("#post-people")), "");

    release();
    await waitFor(() => waiting.document.documentElement.dataset.shiplogPostDetail === "ready", "the lookup settled");
  } finally {
    waiting.restore();
  }

  // Not found and unreachable: no post, so no display name — but the feed and
  // the reader's own next post are true either way, and both stay reachable.
  for (const [state, search, answer] of [
    ["not-found", "?id=p-never-existed", seedOnly([IMAGE_POST])],
    ["error", "?id=p-image", () => { throw new TypeError("Failed to fetch"); }],
  ]) {
    const page = await openPostPage(search, answer);
    try {
      const row = offeredRow(page.document);
      assert.deepEqual(row.map(textOf), SETTLED_EXITS, `${state}: the feed and a post of your own`);
      assert.equal(row.filter((link) => link.id === "post-people").length, 0, `${state}: no People link without a post`);
      assert.equal(row.filter((link) => link.id === "post-publish").length, 1, `${state}: the publish route survives`);
      const sequence = tabSequence(page.document);
      for (const link of row) assert.ok(sequence.includes(link), `${state}: ${link.id} must stay reachable by keyboard`);
    } finally {
      page.restore();
    }
  }

  // The publish destination is not a shape invented for this row.
  // src/social-page.js opens the collapsed composer for exactly this fragment,
  // so the link lands a visitor in the form rather than beside a hidden panel.
  const [socialPage, social] = await Promise.all([
    readFile(new URL("../src/social-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/social.html", import.meta.url), "utf8"),
  ]);
  assert.match(socialPage, /hash === "#post-form"/, "Social must still open its composer on #post-form");
  assert.match(social, /id="post-form"/, "and still ship the element that fragment names");
});

// Who reads a published post, and whether it can be taken back. It used to be
// said three times — Social's intro, Social's composer, and the permalink's
// hero — two of them nowhere near a control that can publish anything. A
// warning repeated on pages where the act is impossible is a warning a reader
// stops reading, and it was spent before it could cost anything. It is now said
// exactly once, at the Publish post button, which names it as its own
// accessible description so it is announced at the moment of the act.
const CONSEQUENCE = "Anyone who visits Shiplog can read your post, its image, and the display name you publish it with. You cannot delete it afterwards, so post nothing you would not put on a public page.";
const consequencesIn = (html) => [...html.matchAll(/<p class="[^"]*publish-consequence[^"]*"[^>]*>([^<]*)<\/p>/g)].map((match) => match[1]);

test("the publication consequence is said once, at the button that publishes", async () => {
  const social = await readFile(new URL("../src/social.html", import.meta.url), "utf8");
  const post = await readFile(new URL("../src/post.html", import.meta.url), "utf8");
  const people = await readFile(new URL("../src/profile.html", import.meta.url), "utf8");

  // One on Social — the composer's, beside Publish post — and none on the
  // permalink, which has no composer and cannot publish. Counted, so a second
  // copy or a lost one is a failure rather than a silent pass.
  assert.deepEqual(consequencesIn(social), [CONSEQUENCE],
    "Social must carry the consequence exactly once, beside Publish post");
  assert.deepEqual(consequencesIn(post), [],
    "the permalink publishes nothing and must not carry the consequence");
  // People is the third page that shows published posts, and it publishes
  // nothing either: it picks a display name and lists that name's image posts.
  // Pinned at zero so the sentence cannot spread back across the reading pages.
  assert.deepEqual(consequencesIn(people), [],
    "People publishes nothing and must not carry the consequence");
  // Not moved into either page under another class name either: the sentence is
  // gone from their text altogether.
  assert.equal(post.includes(CONSEQUENCE), false, "the permalink must not repeat the sentence unclassed");
  assert.equal(people.includes(CONSEQUENCE), false, "People must not repeat the sentence unclassed");

  // It stands ahead of the control it is about, and the button names it, so it
  // is read on focus rather than only seen.
  assert.ok(social.indexOf('id="post-consequence"') < social.indexOf('id="post-submit"'),
    "the consequence must precede the Publish post button");
  assert.match(social, /id="post-submit"[^>]*aria-describedby="post-consequence post-publish-blocker social-notice"/);

  // The description resolves: every id the button names is on the page, and the
  // consequence's id is unique, so the announcement cannot land on the wrong
  // node or on nothing at all.
  const document = parseHtml(social);
  const described = document.querySelector("#post-submit").getAttribute("aria-describedby").split(/\s+/);
  assert.deepEqual(described, ["post-consequence", "post-publish-blocker", "social-notice"]);
  for (const id of described) {
    assert.equal(document.querySelectorAll(`#${id}`).length, 1, `aria-describedby names ${id} exactly once on the page`);
  }
  assert.equal(textOf(document.querySelector("#post-consequence")), CONSEQUENCE,
    "the id the button names must hold the consequence itself");

  // The line this replaced described storage, not audience. Neither page may
  // say it again.
  for (const [name, page] of [["social.html", social], ["post.html", post]]) {
    assert.equal(page.includes("shared across browsers"), false,
      `${name} must say who can read a post, not where the bytes live`);
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
    assert.equal(textOf(panel.querySelector(".detail-loading-text")), "Loading the shared post…");
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
    loading: /Loading the shared post…/,
    loaded: /Rowan Diaz/,
    "not-found": /Post unavailable/,
    error: /Post could not be opened/,
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

/* --------------------- the page names itself, then leaves ----------------- */

// A permalink is the page most likely to be someone's first contact with this
// product, because it is the page that gets pasted into a chat window. What
// that link promised is one post, so the post is what the page leads with —
// under the heading that names it, and above everything the page says about the
// surface it came from. It used to read out as: skip link, nav, the eyebrow and
// heading, three paragraphs about Social, two links off the page, and only then
// the post itself. The context and the routes onward are what a reader wants
// after the post, not in front of it.
//
// Read off single combined queries, which come back in document order — the
// harness rejects descendant selectors like "section #id", and a node compared
// against null walks the whole parsed page.
function assertLeadsWithThePost(document, where) {
  const main = document.querySelector("#main-content");

  const order = main.querySelectorAll("#page-title,#post-detail,#post-back,#post-people,#post-publish").map((node) => node.id);
  assert.deepEqual(order, ["page-title", "post-detail", "post-back", "post-people", "post-publish"],
    `${where}: the permalink must name the post, then show it, then offer a way onward`);

  // The whole page sequence: eyebrow, heading, the post's own region, what
  // Social is, then the links. The context paragraph is the standing sentence
  // about the feed; the demo sentence follows it, and neither precedes the post.
  const flow = main.querySelectorAll("h1,p,div");
  const eyebrow = flow.findIndex((node) => node.classList.contains("eyebrow"));
  const heading = flow.findIndex((node) => node.id === "page-title");
  const slot = flow.findIndex((node) => node.id === "post-detail");
  const context = flow.findIndex((node) => textOf(node) === CONTEXT_SENTENCE);
  const intro = flow.findIndex((node) => textOf(node) === DEMO_SENTENCE);
  const exits = flow.findIndex((node) => node.classList.contains("detail-page-exits"));
  assert.ok(eyebrow >= 0 && slot >= 0 && context >= 0 && intro >= 0 && exits >= 0,
    `${where}: the page lost a part of its sequence`);
  const reading = [eyebrow, heading, slot, context, intro, exits];
  assert.deepEqual(reading.slice().sort((a, b) => a - b), reading,
    `${where}: eyebrow, heading, the post, what Social is, then the routes out`);

  // They live in the standing block that carries the eyebrow and the heading —
  // not inside #post-detail, which every render empties. The post's own slot
  // sits in that same block, above them.
  for (const id of ["#post-back", "#post-people", "#post-publish", "#post-detail"]) {
    assert.ok(main.querySelector(id).closest(".hero-post"), `${where}: ${id} must sit in the standing block`);
  }
  // Asserted as a boolean, never as a node compared against null: a failing
  // node comparison serialises the whole parsed page and outlives the timeout.
  for (const id of ["#post-back", "#post-people", "#post-publish"]) {
    assert.equal(Boolean(main.querySelector(id).closest("#post-detail")), false, `${where}: ${id} must survive a re-render`);
  }

  // Only links valid for this state are offered and reachable.
  const sequence = tabSequence(document);
  const offered = main.querySelectorAll(".detail-back").filter((link) => !link.hidden);
  // Loading offers the feed alone; a settled state adds the reader's own next
  // post, and a loaded one adds the display name it can now name.
  const expected = main.querySelector("#post-publish").hidden ? [SOCIAL_LINK] : main.querySelector("#post-people").hidden ? SETTLED_EXITS : CHROME_LINKS;
  assert.deepEqual(offered.map(textOf), expected, `${where}: a route out changed`);
  for (const id of offered.map((link) => `#${link.id}`)) {
    assert.ok(sequence.includes(main.querySelector(id)), `${where}: ${id} must stay reachable by keyboard`);
  }

  // Following the skip link lands on the region that holds the heading, and the
  // first of the two routes out a reader tabs to is Social, never People.
  const skip = document.querySelector(".skip-link");
  assert.equal(skip.getAttribute("href"), "#main-content");
  assert.equal(main.querySelectorAll("#page-title").length, 1, `${where}: the skip target must contain the heading`);
  const reached = sequence.slice(sequence.indexOf(skip) + 1).filter((stop) => stop.classList.contains("detail-back"));
  assert.equal(textOf(reached[0]), SOCIAL_LINK, `${where}: the first route out reached after the skip link`);
}

test("the permalink leads with the post and puts the feed context under it, loading and loaded", async () => {
  // The loading state is the one a cold visitor meets first, and it is drawn by
  // its own branch of renderPostDetail(), so it is held open and read on its own
  // rather than inferred from the state that follows it.
  const waiting = await loadPage(new URL("../src/post.html", import.meta.url), { location: { search: "?id=p-image" } });
  try {
    let release;
    globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(seedResponse([IMAGE_POST])); });
    await importPageModule("/post-page.js");
    const panel = waiting.document.querySelector("#post-detail");
    await waitFor(() => panel.querySelectorAll(".detail-loading").length === 1, "the loading state rendered");
    assertLeadsWithThePost(waiting.document, "while the lookup runs");

    release();
    await waitFor(() => waiting.document.documentElement.dataset.shiplogPostDetail === "ready", "the post arrived");
    assertLeadsWithThePost(waiting.document, "once the post arrived");
  } finally {
    waiting.restore();
  }

  // And in the markup itself, which is the order a reader gets before any
  // script has run — including a reader whose script never runs at all.
  const html = await readFile(new URL("../src/post.html", import.meta.url), "utf8");
  const at = (needle) => html.indexOf(needle);
  assert.ok(at('<p class="eyebrow">Social · demo</p>') < at('<h1 id="page-title">'), "the eyebrow precedes the heading");
  assert.ok(at('<h1 id="page-title">') < at('id="post-detail"'), "the heading precedes the post's own region");
  assert.ok(at('id="post-detail"') < at(`<p>${CONTEXT_SENTENCE}</p>`), "the post precedes what the page says about Social");
  assert.ok(at(`<p>${CONTEXT_SENTENCE}</p>`) < at(`<p>${DEMO_SENTENCE}</p>`), "the two standing sentences keep their order");
  assert.ok(at(`<p>${DEMO_SENTENCE}</p>`) < at(`>${SOCIAL_LINK}</a>`), "the intro precedes the Social route out");
  assert.ok(at(`>${SOCIAL_LINK}</a>`) < at('id="post-people"'), "Social precedes People, the order the nav names them in");
  // Moved in the markup, not turned around in CSS: a stylesheet reorder would
  // leave reading order and tab order in the order this change exists to end.
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  for (const rule of [".detail-page-exits", ".workspace-single", ".hero"]) {
    const declarations = css.match(new RegExp(`^\\${rule} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
    assert.doesNotMatch(declarations, /order:\s*-?\d|column-reverse|wrap-reverse|position:\s*absolute/,
      `${rule} must not re-sequence the page visually`);
  }
});

// A loaded post is the whole point of the reorder, and it is the state where the
// post region has content of its own to place: the caption, the display name,
// the time, and the image described by its alt text. All of it reads before the
// paragraph about Social and before both cross-links.
test("a loaded post's caption, name, time and image all read before the feed context", async () => {
  const page = await openPostPage("?id=p-image", seedOnly([IMAGE_POST]));
  try {
    assertLeadsWithThePost(page.document, "a loaded post");
    assertOneState(page, "loaded", "a loaded post");

    const main = page.document.querySelector("#main-content");
    // One combined query, which comes back in document order. Everything the
    // post is made of, then the context sentence, then the two routes out.
    const flow = main.querySelectorAll(".detail-author-link,.detail-date,.detail-image,figcaption,#post-back,#post-people");
    const names = flow.map((node) => node.id || node.className);
    assert.deepEqual(names, ["detail-image", "detail-caption", "detail-author-link", "post-date detail-date", "post-back", "post-people"],
      "the post's parts must all precede the routes off the page");

    // The image is announced by the description the poster stored, in the post
    // region rather than beside it.
    const image = main.querySelector(".detail-image");
    assert.equal(image.alt, IMAGE_POST.image.alt);
    assert.ok(image.closest("#post-detail"), "the image belongs to the post's own region");

    // And the context paragraph itself is after the post, not merely below it.
    const blocks = main.querySelectorAll("#post-detail,p");
    const slot = blocks.findIndex((node) => node.id === "post-detail");
    const context = blocks.findIndex((node) => textOf(node) === CONTEXT_SENTENCE);
    assert.ok(slot >= 0 && context > slot, "the paragraph describing Social must follow the post");

    // Tab order agrees with reading order: the post's own link to its author is
    // reached before either cross-link.
    const sequence = tabSequence(page.document);
    const author = main.querySelector(".detail-author-link");
    assert.ok(sequence.indexOf(author) < sequence.indexOf(main.querySelector("#post-back")),
      "a focusable inside the post region must precede the cross-links");
  } finally {
    page.restore();
  }
});

// The URL shape is the contract with every permalink already pasted into a chat
// window: `?id=`, built by postDetailHref and read by post-page.js. Reordering
// the page may not change it, so a link built the way the feed and the People
// grid build theirs still resolves to the same post — with the optional author
// and provenance parameters those surfaces add, too.
test("a permalink built the old way still resolves to the same post", async () => {
  for (const search of [
    postDetailHref(IMAGE_POST.id).replace("/post.html", ""),
    postDetailHref(IMAGE_POST.id, IMAGE_POST.author, "profile").replace("/post.html", ""),
    "?id=p-image",
  ]) {
    assert.match(search, /^\?id=p-image(&|$)/, "the permalink still carries its post id in ?id=");
    const page = await openPostPage(search, seedOnly([IMAGE_POST, TEXT_POST]));
    try {
      assertOneState(page, "loaded", `a permalink at ${search}`);
      assert.equal(textOf(page.panel.querySelector(".detail-author-link")), IMAGE_POST.author);
      assert.equal(textOf(page.document.querySelector("#page-title")), `Post by ${IMAGE_POST.author}`);
      assert.equal(textOf(page.panel.querySelector("figcaption")), IMAGE_POST.caption);
    } finally {
      page.restore();
    }
  }
});

/* ------------------ what the page is, said exactly once ------------------- */

// Someone opening a forwarded link has never seen Social, so the page has to say
// what it is — once. It used to say it four times over before the post: the
// eyebrow read "Social · post · demo", the h1 reads "Post from Social", the wait
// was a whole sentence about the product opening a single shared post from
// Social, and the standing sentence under the post says it again. The eyebrow
// now carries the surface and the demo marker the feed pages carry, the wait
// joins the loading voice used on Social and People, and the one sentence that
// explains what a shared link opens is left to do the explaining alone.
//
// Assembled from parts so this file can name the retired line without becoming
// the place it survives.
const RETIRED_WAIT = ["Shiplog is opening a single", "shared post from Social…"].join(" ");
const times = (haystack, needle) => haystack.split(needle).length - 1;

// Every file the site ships, not just the two that carried the old wait: a
// string retired from a page and left standing in a module is still a string a
// reader can meet.
async function shippedSources() {
  const root = new URL("../src/", import.meta.url);
  const names = await readdir(root, { recursive: true });
  const wanted = names.filter((name) => /\.(html|js)$/.test(name));
  return Promise.all(wanted.map(async (name) => [`src/${name}`, await readFile(new URL(name, root), "utf8")]));
}

test("the shared-post page introduces itself once, in the site's loading voice", async () => {
  for (const [name, source] of await shippedSources()) {
    assert.equal(times(source, RETIRED_WAIT), 0, `${name} still ships the retired wait`);
  }

  // The wait a cold visitor meets, held open. Read off the rendered page rather
  // than the markup, because this is the state the module redraws.
  const waiting = await loadPage(new URL("../src/post.html", import.meta.url), { location: { search: "?id=p-image" } });
  try {
    let release;
    globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(seedResponse([IMAGE_POST])); });
    await importPageModule("/post-page.js");
    const panel = waiting.document.querySelector("#post-detail");
    await waitFor(() => panel.querySelectorAll(".detail-loading").length === 1, "the loading state rendered");

    const wait = textOf(panel.querySelector(".detail-loading-text"));
    assert.equal(wait, "Loading the shared post…");
    assert.match(wait, /^Loading /, "the wait opens the way every other wait on this site opens");
    assert.doesNotMatch(wait, /Shiplog/, "the wait must not narrate the product in the third person");
    assertSaidOnce(waiting.document, "while the lookup runs");

    release();
    await waitFor(() => waiting.document.documentElement.dataset.shiplogPostDetail === "ready", "the post arrived");
    assertSaidOnce(waiting.document, "once the post arrived");
  } finally {
    waiting.restore();
  }

  // And in the two states where the lookup found nothing, which is where the
  // standing copy is doing the most work.
  for (const [state, search, answer] of [
    ["not-found", "?id=p-gone", seedOnly([IMAGE_POST])],
    ["error", "?id=p-image", () => { throw new TypeError("Failed to fetch"); }],
  ]) {
    const page = await openPostPage(search, answer);
    try {
      assertSaidOnce(page.document, `the ${state} state`);
    } finally {
      page.restore();
    }
  }
});

// One explanation of what this page is, and one statement that the feed is a
// demo. Counted over the rendered page's own content — the About Shiplog band
// below it is the site's directory and is not this page introducing itself.
function assertSaidOnce(document, where) {
  const main = textOf(document.querySelector("#main-content"));
  assert.equal(times(main, RETIRED_WAIT), 0, `${where}: the retired wait is back on the page`);
  assert.equal(times(main, CONTEXT_SENTENCE), 1, `${where}: what a shared link opens is said ${times(main, CONTEXT_SENTENCE)} times`);
  assert.equal(times(main, DEMO_SENTENCE), 1, `${where}: the demo sentence is said ${times(main, DEMO_SENTENCE)} times`);
  // And no second wording of the same fact anywhere in the page's content: one
  // mention of a post coming from Social, the one in the sentence above.
  assert.equal(times(main, "post from Social’s shared demo feed"), 1, `${where}: a second wording of the same fact`);
  assert.doesNotMatch(main, /single shared post|Social · post/, `${where}: the page restates itself`);
}

/* ------------------ the byline, and where it leads (#1833) ---------------- */

// A forwarded post is opened by someone who has never seen this site, and the
// display name on it is the only thread they have to the rest of that person's
// pictures. It has to be a real link, it has to be exactly one tab stop, it has
// to appear only where there is a post to be about, and the URL it mints has to
// land People already filtered — which is asserted here by opening People at it
// rather than by reading the two functions and agreeing they look alike.

/**
 * The post card's own tab stops, walked off the sequence a keyboard reader
 * actually travels. The harness rejects descendant selectors, so containment is
 * a walk up `parentNode`.
 */
const cardStops = (document) => {
  const panel = document.querySelector("#post-detail");
  return tabSequence(document).filter((element) => {
    for (let node = element; node; node = node.parentNode) if (node === panel) return true;
    return false;
  });
};

/**
 * People, opened cold at a query string this permalink minted. Same three waits
 * the other People walks in this repo use (tests/social-name-to-people-e2e.js):
 * the entry's own flag, the connection line where the page still has one, and
 * the polite region, which is written only once a grid has been painted for a
 * name. Awaiting the flag alone leaves a render in flight that resolves after
 * the globals are torn down — green here, an unhandled rejection on CI.
 */
async function openPeopleAt(search, posts) {
  const page = await loadPage(new URL("../src/profile.html", import.meta.url), {
    storage: {},
    location: { search },
    routes: { [SEED_URL]: { posts }, [LIVE_URL]: { posts: [] } },
  });
  const timers = [];
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (...args) => {
    const handle = realSetInterval(...args);
    timers.push(handle);
    return handle;
  };
  await importPageModule("/profile-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogProfile === "ready", "People finished its first load");
  await waitFor(() => {
    const line = document.querySelectorAll("#profile-status");
    return line.length === 0 || textOf(line[0]) === profileConnectionLine("live");
  }, "People's feed answered");
  await waitFor(() => textOf(document.querySelector("#profile-announcer")).length > 0, "People announced the view it settled on");
  globalThis.setInterval = realSetInterval;
  return {
    document,
    restore() {
      for (const handle of timers) clearInterval(handle);
      globalThis.setInterval = realSetInterval;
      page.restore();
    },
  };
}

test("the display name is the post card's one tab stop, and only once a post has loaded", async () => {
  const waiting = await loadPage(new URL("../src/post.html", import.meta.url), { location: { search: "?id=p-image" } });
  try {
    let release;
    globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(seedResponse([IMAGE_POST])); });
    await importPageModule("/post-page.js");
    const { document } = waiting;
    await waitFor(() => document.querySelector("#post-detail").querySelectorAll(".detail-loading").length === 1, "the loading state rendered");

    // While the lookup runs the card holds a sentence and a placeholder and
    // nothing a Tab key can land on. There is no display name yet, so there is
    // nothing honest to link — and a stub here would be a name to correct later.
    assert.equal(cardStops(document).length, 0, "the wait offers a tab stop of its own");
    assert.equal(document.querySelectorAll(".detail-author-link").length, 0, "the wait links a display name it does not have");
    // The wait's byline is the shimmer block standing in for one, inside the
    // aria-hidden placeholder — not a byline with a name or an empty link in it.
    for (const byline of document.querySelectorAll(".detail-byline")) {
      assert.equal(byline.querySelectorAll("[data-post-skeleton-slot]").length, 1, "the wait drew a byline that is not a placeholder");
      assert.equal(textOf(byline), "", "the wait's placeholder byline carries text");
    }
    // And the route to the feed reads what it shipped with, untouched by the state.
    assert.equal(textOf(document.querySelector("#post-back")), SOCIAL_LINK);

    release();
    await waitFor(() => document.documentElement.dataset.shiplogPostDetail === "ready", "the lookup settled");

    // Exactly one new stop, and it is the name.
    const stops = cardStops(document);
    assert.equal(stops.length, 1, "a loaded post must add exactly one tab stop inside the card");
    assert.equal(stops[0].className, "detail-author-link");
    assert.equal(textOf(stops[0]), IMAGE_POST.author);
    // Markup order, not a tabindex trick. The article around it stays out of the
    // sequence: post-page.js focuses it after a retry, nobody ever tabs to it.
    assert.equal(stops[0].getAttribute("tabindex"), null);
    assert.equal(document.querySelector(".detail-post").getAttribute("tabindex"), "-1");
    // Nothing distinguishing it is colour alone, and it needs no rule of its own:
    // the class this site already declares carries the underline, and the global
    // anchor rule carries the focus ring.
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    assert.match(css, /\.detail-author-link \{[^}]*text-decoration:underline/);
    assert.match(css, /button:focus-visible,a:focus-visible \{[^}]*outline:3px solid var\(--focus-ring\)/);
  } finally {
    waiting.restore();
  }
});

test("no post means no display-name link, and the states that have none keep the words they shipped with", async () => {
  for (const [state, search, answer] of [
    ["not-found", "?id=p-never-existed", seedOnly([IMAGE_POST])],
    ["error", "?id=p-image", () => { throw new TypeError("Failed to fetch"); }],
  ]) {
    const page = await openPostPage(search, answer);
    try {
      assertOneState(page, state, `the ${state} state`);
      // Counted, never compared against null: a name this page never resolved
      // must not be standing anywhere as a link to somebody's People view.
      assert.equal(page.document.querySelectorAll(".detail-author-link").length, 0,
        `${state}: a display-name link with no display name behind it`);
      assert.equal(page.document.querySelectorAll(".detail-byline").length, 0,
        `${state}: a byline with no post to be about`);
      // The wording of this state is untouched by the byline work: its own
      // sentence, its own in-panel route to the feed, and the standing one.
      assert.equal(textOf(page.document.querySelector("#post-back")), SOCIAL_LINK, `${state}: the standing feed link was reworded`);
      assert.equal(textOf(page.panel.querySelector(".detail-state-feed")).length > 0, true, `${state}: the state's own feed action went missing`);
    } finally {
      page.restore();
    }
  }
});

test("the routes out of a permalink do not open on the same word", async () => {
  const opening = (label) => label.split(" ")[0];
  // The reported defect: two links a reader skims by their first word, both
  // opening on "Open" and both naming Social, with the difference at the end of
  // the line where a skimming reader never reaches it.
  assert.notEqual(opening(SOCIAL_LINK), opening(PUBLISH_LINK),
    `both routes out still open on "${opening(SOCIAL_LINK)}"`);
  assert.deepEqual([SOCIAL_LINK, PUBLISH_LINK].map(opening), ["Read", "Publish"],
    "each route opens on the act it performs");
  // Each still names where it goes, so a link list read aloud is still a map.
  for (const label of [SOCIAL_LINK, PUBLISH_LINK]) assert.match(label, /Social/);

  // Read off the rendered page as well as off the constants, because the words
  // ship in src/post.html and nothing rewrites them at runtime.
  const page = await openPostPage("?id=p-image", seedOnly([IMAGE_POST]));
  try {
    const row = page.document.querySelectorAll(".detail-back").filter((link) => !link.hidden);
    const openings = row.map((link) => opening(textOf(link)));
    assert.equal(new Set(openings).size, openings.length, `two routes out open on the same word: ${openings.join(", ")}`);
  } finally {
    page.restore();
  }
});

test("the URL the byline mints lands People already filtered to that display name", async () => {
  const permalink = await openPostPage("?id=p-image", seedOnly([IMAGE_POST, TEXT_POST]));
  let href;
  try {
    const link = permalink.panel.querySelector(".detail-author-link");
    assert.equal(textOf(link), IMAGE_POST.author);
    // People's own URL shape, exactly: the parameter People parses, the name
    // encoded the way People decodes it.
    href = link.getAttribute("href");
    assert.equal(href, `/profile.html?author=${encodeURIComponent(IMAGE_POST.author)}`);
    assert.equal(href, "/profile.html?author=Mina%20Okafor");
  } finally {
    permalink.restore();
  }

  // Followed rather than reasoned about. People is opened cold — nothing
  // remembered, nothing visited first — at the query string the permalink just
  // wrote, so the seam between the two pages is what is under test.
  const people = await openPeopleAt(href.slice(href.indexOf("?")), [IMAGE_POST, TEXT_POST]);
  try {
    const { document } = people;
    assert.equal(textOf(document.querySelector("#profile-name")), `People is filtered to ${IMAGE_POST.author}.`);
    // Not the landing default, and not the name People reaches for when it has
    // run out of candidates.
    const rendered = textOf(document.querySelector("#main-content"));
    assert.doesNotMatch(rendered, /filtered to (Rowan Diaz|Guest)\./);
    // And the filter is really applied: the picker is on that name and the grid
    // drew that name's picture. Skeleton tiles carry .profile-tile too, so they
    // are excluded or "the grid recovered" passes mid-load.
    const picker = document.querySelector("#profile-author").children.filter((node) => node.tagName === "BUTTON");
    assert.equal(picker.find((chip) => chip.getAttribute("aria-pressed") === "true")?.dataset?.author, IMAGE_POST.author);
    const tiles = document.querySelectorAll(".profile-tile").filter((tile) => !tile.classList.contains("profile-tile-skeleton"));
    assert.equal(tiles.length, 1, "the filtered grid did not draw this display name's one image post");
  } finally {
    people.restore();
  }
});
