// The post page as a visitor meets it: the shipped markup from src/post.html,
// the shipped wiring from src/post-page.js, and a fetch that answers the way the
// network would — with a post, with nothing, or by failing.
//
// The render layer is covered structurally in tests/post-detail.test.js. What is
// only true end to end is here: which state the page lands in for a given
// answer, that the retry button re-runs the real fetch and can recover, and that
// the page's two routes out read the same words in every one of those states.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, pressTab, tabSequence, textOf } from "./support/browser.js";
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
async function openPostPage(search, answer, hash = "") {
  const page = await loadPage(new URL("../src/post.html", import.meta.url), { location: { search, hash } });
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

// The slots the wait reserves, in document order, read off the attribute that
// names each one. The shape is the claim — not how many shimmer blocks there
// are, which is a fact about the stylesheet rather than about the reader.
const skeletonSlots = (node) => node.querySelectorAll("[data-post-skeleton-slot]")
  .map((slot) => slot.getAttribute("data-post-skeleton-slot"));

const seedResponse = (posts) => ({ ok: true, status: 200, json: async () => ({ posts }) });
const seedOnly = (posts) => (url) => {
  if (url === SEED_URL) return seedResponse(posts);
  throw new Error(`Unexpected request: ${url}`);
};

// The page's own routes out, wherever it is in its life. Read from the whole
// document rather than from known ids: a third one appearing anywhere — in the
// markup, in a state panel — fails here, and so does a stray "back".
function exits(document) {
  // A withheld route is not a route: this harness models no layout, so a hidden
  // link still carries its words and would otherwise read as offered here.
  return document.querySelectorAll("a").filter((link) => !link.hidden && (
    /^Open (Social|People) to |←|Back to/.test(link.textContent)
    // …and any chrome link that is on the page with no words in it. The People
    // label is now written from the loaded display name, so a name the page
    // cannot put in a label leaves a focusable link holding nothing — the one
    // failure a text-only match cannot see, because there is no text to match.
    || link.classList.contains("detail-back")));
}

// Social in every state, People wherever there is a post to belong to one.
// Nothing rewrites either label; the People link's destination may narrow to a
// display name the page can actually name, which is what the label promises,
// and a state with no post withdraws the link rather than softening its words.
// `peopleHref` of null asserts that withdrawal — counted through the list, so
// no node is ever compared against null.
//
// Publish is the third, and it belongs to the reader rather than to the post,
// so every state offers it — the loading one included. Nothing a lookup can
// answer decides whether a visitor may write a post of their own.
function assertExits(page, peopleHref, where) {
  const links = exits(page.document);
  const expected = [[SOCIAL.label, SOCIAL.href]];
  if (peopleHref) expected.push([PEOPLE.label, peopleHref]);
  expected.push([PUBLISH.label, PUBLISH.href]);
  assert.deepEqual(
    links.map((link) => [textOf(link), link.href]),
    expected,
    `${where}: the page's routes out`,
  );
}

// Who chose the name in the byline, in one sentence (#2408). This page used to
// ship Social's whole feed note — the three sentences in FEED_NOTE below — which
// is written for a reader scrolling many posts by many names. A permalink holds
// one post, and the sentence above it has already named the invented posts, so
// the block spent forty words to leave one fact this page's reader needs.
const IDENTITY = "Whoever published this post chose the display name on it; nobody owns or verifies a display name on Social.";

// Social's and People's version, which this page no longer carries. Those two
// pages keep it and are asserted on elsewhere; here it is the string that must
// not come back.
const FEED_NOTE = "Display names on the posts already on Social are invented. On any other post, whoever published it chose the name. Nobody owns or verifies a display name, and anyone can publish under any name.";

const SOCIAL = { label: "Open Social to read the whole feed", href: "/social.html" };
const PEOPLE = { label: "Open People to see Mina Okafor’s other image posts", href: "/profile.html" };
const PUBLISH = { label: "Open Social to publish a post", href: "/social.html#post-form" };
const MINA = "/profile.html?author=Mina%20Okafor";

test("a post that loads is headed by its display name and reads description, image, caption, name, time", async () => {
  const page = await openPostPage("?id=p-image", seedOnly([SEED_POST]));
  try {
    const { document } = page;
    assert.equal(textOf(document.querySelector("#page-title")), "Mina Okafor's Social post");
    assert.equal(document.title, "Mina Okafor's Social post · Social · Shiplog");

    const article = page.panel.querySelector("article");
    const time = article.querySelector("time");
    assert.equal(time.getAttribute("datetime"), "2026-07-14T09:00:00.000Z");
    assert.ok(textOf(time).length > 0, "the timestamp needs readable text as well");

    const figure = article.querySelector("figure");
    assert.equal(figure.querySelectorAll("img").length, 1);
    assert.equal(textOf(figure.querySelector("figcaption")), "The middle card, ringed.");
    assert.deepEqual(
      article.children.slice(0, 4).map((node) => node.className),
      ["description-note detail-image-description", "detail-figure", "detail-byline", "post-date detail-date"],
      "the routed page preserves the valid-post reading order",
    );
    assert.equal(page.panel.getAttribute("aria-busy"), "false");
    const main = textOf(document.querySelector("#main-content"));
    assert.ok(main.includes(IDENTITY),
      "a stranger arriving on this link is not told who chose the name in the byline");
    // Painted, not just authored: one sentence, no "demo" for a real post, and
    // no trace of the three-sentence feed note it replaced.
    const notice = main.slice(main.indexOf(IDENTITY), main.indexOf(IDENTITY) + IDENTITY.length);
    assert.doesNotMatch(notice, /\bdemo\b/i, "the notice calls a real post a demo");
    assert.equal(notice.split(". ").length, 1, `the caveat is more than one sentence: ${notice}`);
    assert.equal(main.includes(FEED_NOTE), false, "Social's three-sentence feed note is back on the permalink");

    // The post named its author, so the People link now points at that one
    // display name's view — which is what its words promised all along.
    assertExits(page, MINA, "loaded");
  } finally {
    page.restore();
  }
});

test("the loaded heading and title safely reuse the card's exact display name", async () => {
  const displayName = `Ada <Admin> "Q"`;
  const page = await openPostPage("?id=p-image", seedOnly([{ ...SEED_POST, author: `  ${displayName}  ` }]));
  try {
    assert.equal(textOf(page.panel.querySelector(".detail-author-link")), displayName);
    assert.equal(textOf(page.document.querySelector("#page-title")), `${displayName}'s Social post`);
    assert.equal(page.document.title, `${displayName}'s Social post · Social · Shiplog`);
    assert.equal(page.document.querySelectorAll("admin").length, 0, "angle brackets must remain text");
  } finally {
    page.restore();
  }
});

test("unusable publisher names leave a generic heading and title", async () => {
  for (const author of [undefined, null, "", "   ", 42, {}]) {
    const page = await openPostPage("?id=p-image", seedOnly([{ ...SEED_POST, author }]));
    try {
      assert.equal(textOf(page.document.querySelector("#page-title")), "Social post");
      assert.equal(page.document.title, "Social post · Social · Shiplog");
      assertIdentityStands(page.document, "unusable publisher name");
    } finally {
      page.restore();
    }
  }
});

// Issue #2408. The permalink names who chose the display name in a sentence of
// its own rather than in Social's three. Social and People keep the feed note —
// read out of those two pages here so this test fails if the block quietly
// migrates back — and this page's markup must carry neither it nor any other
// second telling of the same fact.
test("the permalink names who chose the display name in one sentence, not Social's three", async () => {
  const shipped = [];
  for (const file of ["social.html", "profile.html"]) {
    const html = (await readFile(new URL(`../src/${file}`, import.meta.url), "utf8")).replace(/<!--[\s\S]*?-->/g, "");
    const clause = html.match(/Display names on the posts[^<]*anyone can publish under any name\./)?.[0];
    assert.ok(clause, `${file} no longer tells a reader what a display name is`);
    shipped.push(clause);
  }
  assert.equal(new Set(shipped).size, 1, "Social and People drifted into two ways of saying it");
  assert.equal(FEED_NOTE, shipped[0], `the feed note the permalink dropped was reworded: ${shipped[0]}`);

  const post = (await readFile(new URL("../src/post.html", import.meta.url), "utf8")).replace(/<!--[\s\S]*?-->/g, "");
  assert.equal(post.split(IDENTITY).length - 1, 1, "the permalink's markup carries its own sentence other than exactly once");
  assert.equal(post.includes("Display names on the posts"), false, "the permalink still ships Social's feed note");
  assert.equal(post.includes("anyone can publish under any name"), false, "the permalink still ships the feed note's last clause");

  const page = await openPostPage("?id=p-image", seedOnly([SEED_POST]));
  try {
    const rendered = textOf(page.document.querySelector("#main-content"));
    // Once. A fact stated twice on one screen is a fact a reader skips.
    assert.equal(rendered.split(IDENTITY).length - 1, 1, "the permalink states it other than exactly once");
    // And the claim inside it is made once, not restated by a second telling:
    // the block this replaced said a name proves nothing twice over.
    assert.equal(rendered.split("owns or verifies").length - 1, 1, "the permalink says a name is unverified more than once");
    // The page's other "signed-in" sentence is about Social, not about a name,
    // and it belongs to the states with no post. Both on one screen would read
    // as two claims about the same thing.
    assert.doesNotMatch(rendered, /not a signed-in account/);
  } finally {
    page.restore();
  }
});

// Issue #2300. The sentence stands in the page's own frame rather than in the
// region the lookup repaints, so a reader whose link fails or names a missing
// post is told it too. Counted over the whole body, located by one combined
// query (document order), and compared as booleans, never as nodes.
//
// Issue #2408 adds the position it reads from: after the post region, never in
// front of it. The order asserted is the rendered one — #post-detail is in the
// same combined query, so a module that moved a block on load would be caught
// here rather than passing on authored markup order.
function assertIdentityStands(document, where) {
  assert.equal(textOf(document.body).split(IDENTITY).length - 1, 1,
    `${where}: the page says who chose the display name other than exactly once`);
  assert.equal(textOf(document.body).includes(FEED_NOTE), false,
    `${where}: Social's three-sentence feed note is back on the permalink`);
  const flow = document.querySelector("#main-content").querySelectorAll("h1,p,a,#post-detail");
  const heading = flow.findIndex((node) => node.id === "page-title");
  const detail = flow.findIndex((node) => node.id === "post-detail");
  const note = flow.findIndex((node) => node.tagName === "P" && textOf(node) === IDENTITY);
  const social = flow.findIndex((node) => node.id === "post-back");
  assert.ok(heading >= 0 && detail >= 0 && note >= 0 && social >= 0,
    `${where}: the heading, the post region, the sentence or the Social link left the page's content`);
  assert.ok(heading < detail && detail < note && note < social,
    `${where}: the sentence must read after the post and before "${SOCIAL.label}"`);
  assert.equal(flow[note].getAttribute("class"), "hint", `${where}: the sentence lost the class Social's feed note uses`);
  for (const region of ["#post-detail", "#site-footer"]) {
    assert.equal(Boolean(flow[note].closest(region)), false, `${where}: the sentence sits inside ${region}`);
  }
}

test("the permalink says who chose the display name once in every state, after the post and before the feed link", async () => {
  const cold = await loadPage(new URL("../src/post.html", import.meta.url), { location: { search: "?id=p-image" } });
  try {
    assertIdentityStands(cold.document, "before the script runs");

    let release;
    globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(seedResponse([SEED_POST])); });
    await importPageModule("/post-page.js");
    await waitFor(() => cold.document.documentElement.dataset.shiplogPostDetail === "loading", "the script took the region");
    assertIdentityStands(cold.document, "while the lookup runs");

    release();
    await waitFor(() => cold.document.documentElement.dataset.shiplogPostDetail === "ready", "the post arrived");
    const panel = cold.document.querySelector("#post-detail");
    await waitFor(() => panel.querySelectorAll(".detail-post").filter((node) => !node.classList.contains("detail-skeleton")).length === 1,
      "the real post replaced the placeholder");
    assert.equal(panel.dataset.postState, "loaded");
    assertIdentityStands(cold.document, "once the post rendered");
  } finally {
    cold.restore();
  }

  const unresolved = [
    ["not-found", "?id=p-gone", seedOnly([SEED_POST])],
    ["error", "?id=p-image", () => { throw new TypeError("Failed to fetch"); }],
  ];
  for (const [state, search, answer] of unresolved) {
    const page = await openPostPage(search, answer);
    try {
      assert.equal(page.panel.dataset.postState, state, `the page landed in ${page.panel.dataset.postState}, not ${state}`);
      assertIdentityStands(page.document, state);
    } finally {
      page.restore();
    }
  }
});

// Issue #2408. What a reader meets above the post, which on a page reached from
// a pasted link is all they have agreed to read: the surface the post came out
// of, and one sentence saying what the page is. Everything the page has to say
// about invented posts, display names and reporting reads under the post.
const PAGE_LEDE = "This page is for one post from Social, Shiplog’s shared feed of short posts about shipped work.";
const CAVEAT_WORDS = /invented|display name|customer or production data|Report post|reporting/i;

// Rendered order, not authored order: the post region is in the same combined
// query as the paragraphs, so a module that moved a block on load is caught
// here. Compared as text and counts — no node is ever asserted against.
function assertOpensWithThePost(document, where) {
  const flow = document.querySelector("#main-content").querySelectorAll("p,#post-detail");
  const detail = flow.findIndex((node) => node.id === "post-detail");
  assert.ok(detail >= 0, `${where}: the post region left the page's content`);

  const above = flow.slice(0, detail).map(textOf);
  assert.deepEqual(above, ["Social", PAGE_LEDE],
    `${where}: a reader meets something other than the eyebrow and the page's own sentence before the post`);
  for (const paragraph of above) {
    assert.doesNotMatch(paragraph, CAVEAT_WORDS, `${where}: a caveat reads before the post`);
  }
  // The measure the issue was written about: the page used to spend about sixty
  // words on caveats before the thing the link promised.
  const words = above.join(" ").split(/\s+/).filter(Boolean).length;
  assert.ok(words <= 25, `${where}: ${words} words stand between the reader and the post`);
}

test("the permalink opens with the post in every state, not with its caveats", async () => {
  const cold = await loadPage(new URL("../src/post.html", import.meta.url), { location: { search: "?id=p-image" } });
  try {
    assertOpensWithThePost(cold.document, "before the script runs");

    let release;
    globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(seedResponse([SEED_POST])); });
    await importPageModule("/post-page.js");
    await waitFor(() => cold.document.documentElement.dataset.shiplogPostDetail === "loading", "the script took the region");
    assertOpensWithThePost(cold.document, "while the lookup runs");

    release();
    await waitFor(() => cold.document.documentElement.dataset.shiplogPostDetail === "ready", "the post arrived");
    assertOpensWithThePost(cold.document, "once the post rendered");
  } finally {
    cold.restore();
  }

  for (const [state, search, answer] of [
    ["not-found", "?id=p-gone", seedOnly([SEED_POST])],
    ["error", "?id=p-image", () => { throw new TypeError("Failed to fetch"); }],
  ]) {
    const page = await openPostPage(search, answer);
    try {
      assert.equal(page.panel.dataset.postState, state, `the page landed in ${page.panel.dataset.postState}, not ${state}`);
      assertOpensWithThePost(page.document, state);
    } finally {
      page.restore();
    }
  }
});

// Issue #2397. How to ask for a post to be looked at, in the two paragraphs
// Social already ships beside its feed: the route to the control, then what a
// report does and does not do. A reader who opens a forwarded link has never
// seen that feed panel, so this page named no reporting path at all — it told a
// stranger nobody verifies the name on the post, and nothing about what to do
// with a post that needs looking at.
//
// Written out here so the two sentences are readable in the tests that assert
// them, and pinned against src/social.html below so neither page can reword one
// on its own. The permalink has no Report post button of its own, so it names
// the control rather than offering it; the words are the same either way.
const REPORT_ROUTE = "To ask the Wawalu team to review a post, select Report post on it.";
const REPORT_ABOUT = "How reporting works: Report post opens a short form about that one post. Choose a reason, add a note if you want to, and give your email address. The report goes only to the Wawalu team, who review each one. A report does not remove or hide the post, and not every report leads to removal.";

test("the permalink names the reporting path in Social's own bytes", async () => {
  const html = (await readFile(new URL("../src/social.html", import.meta.url), "utf8")).replace(/<!--[\s\S]*?-->/g, "");
  // Anchored on their opening words rather than typed out, so a Social that
  // rewords either one fails here instead of drifting away from this page.
  const shipped = {
    route: html.match(/To ask the Wawalu team[^<]*/)?.[0]?.trim(),
    about: html.match(/How reporting works: [^<]*not every report leads to removal\./)?.[0],
  };
  assert.ok(shipped.route, "Social no longer tells a reader how to ask for a post to be reviewed");
  assert.ok(shipped.about, "Social no longer explains what reporting does and does not do");
  assert.equal(REPORT_ROUTE, shipped.route, `the permalink does not ship Social's route sentence: ${shipped.route}`);
  assert.equal(REPORT_ABOUT, shipped.about, `the permalink does not ship Social's explanation: ${shipped.about}`);

  // And the permalink's markup carries each one exactly once, so the page ships
  // them to a reader whose script never runs.
  const post = (await readFile(new URL("../src/post.html", import.meta.url), "utf8")).replace(/<!--[\s\S]*?-->/g, "");
  for (const [name, clause] of Object.entries({ route: REPORT_ROUTE, explanation: REPORT_ABOUT })) {
    assert.equal(post.split(clause).length - 1, 1, `the permalink's markup carries the reporting ${name} other than exactly once`);
  }
  // Not in the follow-up block: that form's wording is pinned byte for byte
  // elsewhere, and a sentence about reporting a post is not a step in asking
  // the team a question about it.
  assert.equal(post.slice(post.indexOf('<footer class="site-footer"')).includes(REPORT_ROUTE), false,
    "the reporting route landed in the footer's follow-up block");
});

// Standing copy, wherever the lookup ended up: it lives in the page's own frame
// rather than in #post-detail, which every render empties. Counted over the
// whole body, located by one combined query (document order), and compared as
// booleans and counts, never as nodes.
function assertReportingStands(document, where) {
  const body = textOf(document.body);
  for (const [name, clause] of Object.entries({ route: REPORT_ROUTE, explanation: REPORT_ABOUT })) {
    assert.equal(body.split(clause).length - 1, 1,
      `${where}: the page states the reporting ${name} other than exactly once`);
  }

  const flow = document.querySelector("#main-content").querySelectorAll("h1,p,a");
  const at = (text) => flow.findIndex((node) => node.tagName === "P" && textOf(node) === text);
  const reading = [at(IDENTITY), at(REPORT_ROUTE), at(REPORT_ABOUT), flow.findIndex((node) => node.id === "post-back")];
  assert.ok(reading.every((index) => index >= 0),
    `${where}: the display-name caveat, a reporting sentence or the Social link left the page's content`);
  assert.deepEqual(reading.slice().sort((a, b) => a - b), reading,
    `${where}: reporting reads after the display-name caveat and before "${SOCIAL.label}"`);

  for (const [name, index] of Object.entries({ route: reading[1], explanation: reading[2] })) {
    assert.equal(flow[index].getAttribute("class"), "hint",
      `${where}: the reporting ${name} lost the class the caveat beside it uses`);
    for (const region of ["#post-detail", "#site-footer"]) {
      assert.equal(Boolean(flow[index].closest(region)), false, `${where}: the reporting ${name} sits inside ${region}`);
    }
  }
}

test("the permalink states the reporting path while the post loads and once it has loaded", async () => {
  const cold = await loadPage(new URL("../src/post.html", import.meta.url), { location: { search: "?id=p-image" } });
  try {
    assertReportingStands(cold.document, "before the script runs");

    let release;
    globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(seedResponse([SEED_POST])); });
    await importPageModule("/post-page.js");
    await waitFor(() => cold.document.documentElement.dataset.shiplogPostDetail === "loading", "the script took the region");
    assertReportingStands(cold.document, "while the lookup runs");

    release();
    await waitFor(() => cold.document.documentElement.dataset.shiplogPostDetail === "ready", "the post arrived");
    const panel = cold.document.querySelector("#post-detail");
    // The real post, not the placeholder that ships with the markup: a wait on
    // text would have returned on turn zero against copy the page authored.
    await waitFor(() => panel.querySelectorAll(".detail-post").filter((node) => !node.classList.contains("detail-skeleton")).length === 1,
      "the real post replaced the placeholder");
    assert.equal(panel.dataset.postState, "loaded");
    assertReportingStands(cold.document, "once the post rendered");
  } finally {
    cold.restore();
  }

  // A link that resolved to nothing is the state a reader is most likely to
  // want the team for, so the sentences stand there too.
  for (const [state, search, answer] of [
    ["not-found", "?id=p-gone", seedOnly([SEED_POST])],
    ["error", "?id=p-image", () => { throw new TypeError("Failed to fetch"); }],
  ]) {
    const page = await openPostPage(search, answer);
    try {
      assert.equal(page.panel.dataset.postState, state, `the page landed in ${page.panel.dataset.postState}, not ${state}`);
      assertReportingStands(page.document, state);
    } finally {
      page.restore();
    }
  }
});

test("arriving from a profile narrows the People link, and changes no words", async () => {
  const page = await openPostPage("?id=p-image&from=profile&author=Mina%20Okafor", seedOnly([SEED_POST]));
  try {
    assertExits(page, MINA, "from a profile");
    // Where the reader came from does not rename anything. The labels are the
    // same two the page ships for a visitor who has never seen either surface.
    assert.equal(textOf(page.document.querySelector("#page-title")), "Mina Okafor's Social post");
  } finally {
    page.restore();
  }
});

test("an unknown id is named as a missing post, with the feed still the way out", async () => {
  const page = await openPostPage("?id=p-gone", seedOnly([SEED_POST]));
  try {
    assert.match(textOf(page.panel), /Post unavailable/);
    assert.match(textOf(page.panel), /This shared link may be unavailable, or the post may no longer be in Social\./);
    assert.doesNotMatch(textOf(page.panel), /removed|private|signed-in|your post/i);
    assert.doesNotMatch(textOf(page.panel), /Display names on the posts/);
    // No post, no author: the h1 keeps the generic label it shipped with.
    assert.equal(textOf(page.document.querySelector("#page-title")), "Social post");
    assert.doesNotMatch(textOf(page.panel), /Try again/);
    assert.equal(page.panel.getAttribute("role"), "status");
    assert.equal(page.panel.getAttribute("aria-live"), "polite");
    assert.equal(page.panel.querySelector(".detail-state-message").getAttribute("role"), null);
    assert.equal(page.document.title, "Social post · Social · Shiplog");
    // No post, so no display name the People link's words could be about: the
    // feed is the one route this state offers.
    assertExits(page, null, "not found");
    const feed = page.panel.querySelector(".detail-state-feed");
    assert.equal(textOf(feed), "Go to the Social feed");
    assert.equal(feed.getAttribute("href"), "/social.html");
    assert.ok(tabSequence(page.document).includes(page.document.querySelector("#post-back")));
  } finally {
    page.restore();
  }
});

test("a missing post reached from a profile still offers the feed it belonged to", async () => {
  const page = await openPostPage("?id=p-gone&from=profile&author=Mina%20Okafor", seedOnly([SEED_POST]));
  try {
    // The arriving link claimed a display name, but the page never resolved a
    // post under it, so it is not a name this page can say "this" about. The
    // People link stays withdrawn here too rather than trusting the URL.
    assertExits(page, null, "missing, from a profile");
    // The panel names the next step where it explains the problem, so a reader
    // who has just been told the post is gone does not have to look back up the
    // page for what to do about it.
    const feed = page.panel.querySelector(".detail-state-feed");
    assert.equal(feed.getAttribute("href"), "/social.html");
    assert.equal(textOf(feed), "Go to the Social feed");
    // The site's two directories are both excluded: the header nav and the
    // footer's site map name every destination on every page, and neither is a
    // route this page offers. What is counted is what the page itself says —
    // the standing route out of the frame, and the panel's own action. Two, and
    // never a third: the pair is what a reader can hold at once.
    const toFeed = page.document.querySelectorAll("a")
      .filter((link) => link.getAttribute("href") === "/social.html"
        && !link.closest(".site-nav") && !link.closest("#site-footer"));
    // The panel's own action reads first, because the panel is where the post
    // would have been and now stands above the page's standing routes out.
    assert.deepEqual(toFeed.map(textOf), ["Go to the Social feed", SOCIAL.label]);

    // Tab order agrees: the state's own next step, then the standing exit.
    const sequence = tabSequence(page.document);
    assert.ok(sequence.indexOf(feed) < sequence.indexOf(page.document.querySelector("#post-back")));
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
    assert.match(textOf(page.panel), /Post could not be opened/);
    assert.match(textOf(page.panel), /Social did not respond, so this shared link is unavailable for now\./);
    assert.equal(textOf(page.panel.querySelector(".detail-state-feed")), "Go to the Social feed");
    // Whole-page, not just the panel: the error state's action and the standing
    // exit both land on /social.html, so they have to be two readable routes and
    // not one label printed twice on the screen a stuck reader is looking at.
    const errorFeed = page.document.querySelectorAll("a")
      .filter((link) => link.getAttribute("href") === "/social.html"
        && !link.closest(".site-nav") && !link.closest("#site-footer"));
    assert.deepEqual(errorFeed.map(textOf), ["Go to the Social feed", SOCIAL.label]);
    assert.doesNotMatch(textOf(page.panel), /private|signed-in|your post/i);
    assertExits(page, null, "failed");
    assert.equal(page.document.title, "Social post · Social · Shiplog");

    const retry = page.panel.querySelector("button");
    assert.equal(textOf(retry), "Retry the shared post");
    // A button, not a link: retrying re-runs the fetch in place rather than
    // reloading the page and losing everything already on screen.
    assert.equal(retry.type, "button");
    assert.equal(retry.querySelectorAll("a").length, 0);

    const before = page.requests.length;
    failing = false;
    retry.click();
    await waitFor(page.settled, "the retry finished");

    assert.ok(page.requests.length > before, "the retry must actually re-run the fetch");
    assert.equal(textOf(page.document.querySelector("#page-title")), "Mina Okafor's Social post");
    assert.equal(textOf(page.panel.querySelector("figcaption")), "The middle card, ringed.");
    assert.doesNotMatch(textOf(page.panel), /could not be reached/);
    assert.equal(page.panel.dataset.postState, "loaded");
    assertExits(page, MINA, "recovered");
  } finally {
    page.restore();
  }
});

test("not-found and failure keep both settled exit links keyboard reachable", async () => {
  const cases = [
    ["not found", seedOnly([SEED_POST])],
    ["failure", () => { throw new TypeError("Failed to fetch"); }],
  ];

  for (const [state, answer] of cases) {
    const page = await openPostPage("?id=p-gone", answer);
    try {
      const social = page.document.querySelector("#post-back");
      const publish = page.document.querySelector("#post-publish");
      const sequence = tabSequence(page.document);
      assert.equal(social.hidden, false, `${state}: the Social exit remains rendered`);
      assert.equal(publish.hidden, false, `${state}: the publish exit remains rendered`);
      assert.ok(sequence.includes(social), `${state}: the Social exit is keyboard focusable`);
      assert.ok(sequence.includes(publish), `${state}: the publish exit is keyboard focusable`);
    } finally {
      page.restore();
    }
  }
});

// The retry does not just re-run a fetch: it takes the page back through the
// wait. Held open on the second attempt, because the state between "the reader
// pressed Retry" and "the post arrived" is the one a failing network makes the
// reader sit in, and it has to be the same wait the page opened with.
test("a retry re-enters the wait in the post's shape, then lands the post in it", async () => {
  let failing = true;
  let release = null;
  const page = await openPostPage("?id=p-image", () => {
    if (failing) throw new TypeError("Failed to fetch");
    return new Promise((resolve) => { release = () => resolve(seedResponse([SEED_POST])); });
  });
  try {
    const panel = page.panel;
    assert.equal(panel.dataset.postState, "error");
    assert.deepEqual(skeletonSlots(panel), [], "a failed lookup is an answer, not a wait");

    failing = false;
    panel.querySelector(".detail-retry").click();
    await waitFor(() => panel.querySelectorAll(".detail-loading").length === 1, "the retry re-entered the wait");

    // One state again: the failure is gone from the document rather than sitting
    // under the placeholder, and the placeholder holds the same four slots.
    assert.equal(panel.dataset.postState, "loading");
    assert.equal(panel.getAttribute("aria-busy"), "true");
    assert.equal(panel.querySelectorAll(".detail-state-message").length, 0);
    assert.equal(panel.querySelectorAll("button").length, 0);
    assert.deepEqual(skeletonSlots(panel), ["author-metadata", "caption", "optional-image"]);
    assert.equal(textOf(panel.querySelector(".detail-loading-text")), "The post is loading.");

    await waitFor(() => release, "the retry issued its request");
    release();
    await waitFor(page.settled, "the retry recovered");

    assert.equal(panel.dataset.postState, "loaded");
    assert.deepEqual(skeletonSlots(panel), []);
    assert.equal(panel.querySelectorAll(".detail-post").length, 1);
    assert.equal(textOf(panel.querySelector("figcaption")), "The middle card, ringed.");
  } finally {
    page.restore();
  }
});

test("a visit with no id is told what the page needs, and still has one way out", async () => {
  const page = await openPostPage("", () => { throw new Error("a page with no id must not ask the network"); });
  try {
    // The same words as any other link that failed to reach a post: a reader
    // who was handed a truncated URL is not in a different situation from one
    // handed a stale id, and should not have to work out that they are.
    assert.match(textOf(page.panel), /Post unavailable/);
    assert.match(textOf(page.panel), /This shared link may be unavailable or incomplete/);
    assert.equal(page.requests.length, 0);
    assertExits(page, null, "no id");
    // The one next step, in the panel that explains why it is needed.
    assert.equal(textOf(page.panel.querySelector(".detail-state-feed")), "Go to the Social feed");
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
    assert.equal(panel.getAttribute("role"), "status", "the state is announced without stealing focus");
    assert.equal(state.getAttribute("role"), null, "the update uses the page's persistent live region");
    assert.equal(page.document.activeElement, null, "nothing may take focus on load");
    assert.equal(textOf(state.querySelector(".detail-loading-text")), "The post is loading.");
    assert.doesNotMatch(textOf(panel), /Display names on the posts/);
    // Nothing is named yet, so the h1 names the page — the same words a reader
    // sees in the shipped markup before any script runs.
    assert.equal(textOf(page.document.querySelector("#page-title")), "Social post");
    assert.equal(page.document.title, "Social post · Social · Shiplog");
    // The state says the wait once, in words, and holds the post's shape under
    // it: no chip, no heading, no second explanation.
    assert.equal(panel.querySelectorAll(".detail-state-message").length, 0);
    assert.equal(panel.querySelectorAll("h2").length, 0);
    assert.equal(state.getAttribute("aria-labelledby"), null);
    assert.deepEqual(skeletonSlots(panel), ["author-metadata", "caption", "optional-image"]);
    assert.equal(panel.querySelectorAll(".detail-skeleton")[0].getAttribute("aria-hidden"), "true");
    assert.ok(panel.querySelector("article.detail-skeleton"), "the wait uses the loaded post's semantic container");
    assert.equal(panel.querySelector(".detail-skeleton").hasAttribute("inert"), true, "the placeholder can never enter the tab order");
    const skeleton = panel.querySelector(".detail-skeleton");
    assert.ok(skeleton.querySelector('[data-post-skeleton-slot="author-metadata"]'));
    assert.ok(skeleton.querySelector('[data-post-skeleton-slot="caption"]'));
    assert.ok(skeleton.querySelector('figure[data-post-skeleton-slot="optional-image"]'));
    // The placeholder is shape only: it must not put words on the page that a
    // reader would try to read, or that the announcement would read out.
    assert.equal(textOf(panel.querySelector(".detail-skeleton")).trim(), "");
    // The frame around it still says what the page is, so the region is never
    // an unexplained blank.
    assert.match(textOf(page.document.querySelector(".hero-post")),
      /The posts already on Social are invented to demonstrate Shiplog and use no customer or production data; a post a visitor publishes is real\./);
    assertExits(page, null, "loading");
    assert.equal(textOf(page.document.querySelector("#post-people")), "", "loading must not expose an empty or placeholder display name");
    assert.equal(page.document.querySelector("#post-people").hidden, true);
    // Nothing inside the waiting region is tabbable, so the exit stays the
    // first thing on the page a keyboard reader reaches after the site frame.
    assert.equal(tabSequence(page.document).filter((node) => node.closest("#post-detail")).length, 0);

    release();
    await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "ready", "the post arrived");
    assert.equal(panel.getAttribute("aria-busy"), "false");
    assertExits(page, MINA, "after loading");
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
    assert.equal(textOf(panel.querySelector(".detail-loading-text")), "The post is loading.");
    assert.equal(panel.getAttribute("role"), "status");
    assert.equal(panel.querySelector(".detail-loading").getAttribute("role"), null);
    // The placeholder is in the markup too — the wait a cold visitor meets is
    // the shape of the post, not a line of text the post then pushes down.
    assert.deepEqual(skeletonSlots(panel), ["author-metadata", "caption", "optional-image"]);
    // The states that explain an absent post are not in the markup at all, so
    // the wait and an unavailable panel cannot be read together at any point.
    assert.equal(panel.querySelectorAll(".detail-state-message").length, 0);
    assert.equal(panel.querySelectorAll(".detail-post").filter((node) => !node.classList.contains("detail-skeleton")).length, 0);
    // And it takes nothing away from the exit above it.
    assertExits(page, null, "before the script runs");
    assert.equal(tabSequence(page.document).filter((node) => node.closest("#post-detail")).length, 0);

    // Held open, so the script's own render of the same line can be read.
    let release;
    globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(seedResponse([SEED_POST])); });
    await importPageModule("/post-page.js");
    await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "loading", "the script took the region");

    assert.equal(panel.dataset.postState, "loading", "the script agrees with the markup it replaced");
    assert.equal(panel.querySelectorAll(".detail-loading").length, 1, "one wait line, not the shipped one plus a second");
    assert.equal(textOf(panel.querySelector(".detail-loading-text")), "The post is loading.");
    assert.equal(panel.querySelectorAll(".detail-state-message").length, 0);
    // And one placeholder: the script redraws the wait the markup shipped, it
    // does not stack a second set of slots under the first.
    assert.deepEqual(skeletonSlots(panel), ["author-metadata", "caption", "optional-image"]);
    assert.equal(panel.querySelectorAll(".detail-skeleton").length, 1);

    release();
    await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "ready", "the post arrived");

    // Resolved: one state, and the wait is gone rather than pushed off screen.
    assert.equal(panel.dataset.postState, "loaded");
    assert.equal(panel.querySelectorAll(".detail-loading").length, 0);
    // The placeholder goes with it. A shimmer block left under a rendered post
    // is a page still telling the reader it is working.
    assert.deepEqual(skeletonSlots(panel), []);
    assert.equal(panel.querySelectorAll(".detail-post").length, 1);
    assert.equal(panel.getAttribute("aria-busy"), "false");
    assert.doesNotMatch(textOf(panel), /Loading this post/);
    assert.equal(textOf(page.document.querySelector("#page-title")), "Mina Okafor's Social post");
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
    assert.equal(textOf(panel.querySelector(".detail-state-feed")), "Go to the Social feed");
  } finally {
    page.restore();
  }
});

test("the failed state reads the post's region and its retry, then the back link", async () => {
  const page = await openPostPage("?id=p-image", () => { throw new TypeError("Failed to fetch"); });
  try {
    const { document } = page;
    const back = document.querySelector("#post-back");
    const retry = page.panel.querySelector(".detail-retry");

    // Document order, which is tab order here: the post's region and the one
    // action it owns, then the page's standing way out. A reader who failed to
    // get the post reaches the control that can recover it before the control
    // that abandons it.
    const sequence = tabSequence(document);
    assert.ok(sequence.includes(back) && sequence.includes(retry), "both controls are reachable by keyboard");
    assert.ok(sequence.indexOf(retry) < sequence.indexOf(back), "the retry comes before the exit");
    assert.ok(retry.closest("#post-detail"), "the retry belongs to the post's region, not the page frame");
    // The panel offers both a way on to the feed and a retry.
    assert.equal(page.panel.querySelectorAll("button").length, 1);
    assert.equal(page.panel.querySelectorAll("a").length, 1);
    assert.equal(textOf(page.panel.querySelector("a")), "Go to the Social feed");
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

// The clipboard the shipped page reaches for. post-page.js injects nothing —
// the browser's own clipboard is read at press time — so a test that wants to
// watch the write has to stand one on the global and put it back afterwards.
// With no writeText at all, the browser has no clipboard to offer.
function installClipboard(writeText) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const clipboard = writeText ? { writeText } : undefined;
  Object.defineProperty(globalThis, "navigator", { value: { clipboard }, configurable: true });
  return () => Object.defineProperty(globalThis, "navigator", saved);
}

const PERMALINK = "https://labs.wawalu.org/post.html?id=p-image";
const RETIRED_ADDRESS_SENTENCE = "Copy this page’s address to share this post.";

// The one act this page can perform on the post it is showing. Asserted end to
// end because both halves of it are only true together: the page reads its id
// out of `?id=`, and the address the button copies has to be a link that reads
// back to the same post.
test("a loaded post can hand over its own link, and says so where the post is", async () => {
  let copied = null;
  const restoreClipboard = installClipboard(async (value) => { copied = value; });
  // Opened the way a feed links here: with the author and provenance those
  // surfaces add, and a fragment. What is copied is the post, not this reader's
  // route to it.
  const page = await openPostPage("?id=p-image&author=Mina%20Okafor&from=profile", seedOnly([SEED_POST]), "#comments");
  try {
    assert.equal(page.document.querySelectorAll(".share-button").length, 1, "one copy control on the page");
    const copy = page.panel.querySelector(".share-button");
    assert.equal(textOf(copy), "Copy link to this post");
    assert.equal(copy.tagName, "BUTTON");
    assert.ok(copy.closest("#post-detail"), "the control belongs to the post's region, not the page frame");
    // Nothing reaches the clipboard on render.
    assert.equal(copied, null);
    assert.equal(textOf(page.panel.querySelector(".share-status")), "");

    copy.click();
    await waitFor(() => copied !== null, "the clipboard was written");
    assert.equal(copied, PERMALINK);
    await waitFor(() => textOf(page.panel.querySelector(".share-status")) !== "", "the control reported what happened");
    const status = page.panel.querySelector(".share-status");
    assert.equal(textOf(status), "Link copied.");
    assert.equal(status.getAttribute("role"), "status");
    assert.equal(status.getAttribute("aria-live"), "polite");
    assert.equal(page.panel.querySelectorAll("input").length, 0, "a copy that worked draws no manual field");
    // The button replaced the sentence that sent readers to the address bar.
    assert.equal(textOf(page.document.body).includes(RETIRED_ADDRESS_SENTENCE), false);

    // Reading order, and so tab order: the post, then the control that copies
    // it, then the page's standing routes out — by document position, with no
    // tabindex spent on any of it.
    const sequence = tabSequence(page.document);
    assert.equal(copy.getAttribute("tabindex"), null);
    assert.ok(sequence.includes(copy), "the control is reachable by keyboard");
    assert.ok(sequence.indexOf(page.panel.querySelector(".detail-author-link")) < sequence.indexOf(copy),
      "the post's own content is reached before the control that copies its link");
    for (const id of ["#post-back", "#post-people", "#post-publish"]) {
      assert.ok(sequence.indexOf(copy) < sequence.indexOf(page.document.querySelector(id)),
        `the copy control precedes ${id}`);
    }
    // It takes nothing away from the routes off the page.
    assertExits(page, MINA, "with a copy control");
  } finally {
    page.restore();
    restoreClipboard();
  }
});

// Tab order by pressing Tab, not only by index: from the post's last stop, one
// press reaches the control and the next reaches the feed link.
test("Tab moves from the post to its copy control, then straight to the feed", async () => {
  const page = await openPostPage("?id=p-image", seedOnly([SEED_POST]));
  try {
    const sequence = tabSequence(page.document);
    const copy = page.panel.querySelector(".share-button");
    const before = sequence[sequence.indexOf(copy) - 1];
    assert.ok(before.closest(".detail-post"), "the stop before the control is the post's own content");
    before.focus();
    // pressTab restarts at the first stop when nothing is focused, so the start
    // is confirmed before stepping.
    assert.ok(page.document.activeElement === before, "Tab starts from the post");
    assert.equal(textOf(pressTab(page.document)), "Copy link to this post");
    const next = pressTab(page.document);
    assert.equal(next.id, "post-back");
    assert.equal(textOf(next), "Open Social to read the whole feed");
  } finally {
    page.restore();
  }
});

// A refused write and a browser with no clipboard end the same way: the link in a
// read-only field, focused and selected, with the instruction and no success.
test("a clipboard that refuses or is missing hands over the link to copy by hand", async () => {
  const cases = [
    ["refused", async () => { throw new Error("denied"); }],
    ["missing", undefined],
  ];
  for (const [name, writeText] of cases) {
    const restoreClipboard = installClipboard(writeText);
    const page = await openPostPage("?id=p-image&from=profile", seedOnly([SEED_POST]));
    // The harness models no text selection, so select() is counted instead.
    const proto = Object.getPrototypeOf(page.document.createElement("input"));
    proto.select = function () { this.selected = (this.selected ?? 0) + 1; };
    try {
      const copy = page.panel.querySelector(".share-button");
      const status = page.panel.querySelector(".share-status");
      for (const press of [1, 2]) {
        copy.click();
        await waitFor(() => textOf(status) !== "", `${name}: the control reported the refusal`);
        const fields = page.panel.querySelectorAll("input");
        assert.equal(fields.length, 1, `${name}, press ${press}: one manual field, never a second`);
        const field = fields[0];
        assert.equal(field.value, PERMALINK);
        assert.equal(field.getAttribute("readonly"), "", "read as the attribute the control sets");
        const labels = page.panel.querySelectorAll(`label[for="${field.id}"]`);
        assert.equal(labels.length, 1);
        assert.equal(textOf(labels[0]), "Link to this post for manual copying");
        assert.ok(page.document.activeElement === field, `${name}: focus moved to the field`);
        assert.equal(field.selected, press, `${name}: the field's text was selected`);
        assert.ok(textOf(status).includes("Select the text and use your device’s copy command."));
        assert.equal(textOf(page.panel).includes("Link copied."), false, `${name}: a refusal said it copied`);
      }
    } finally {
      delete proto.select;
      page.restore();
      restoreClipboard();
    }
  }
});

// The states with no post: a control offering to copy a link to a post that is
// not there would hand over an address for a page that says the same nothing.
test("no state without a post offers to copy a link to one", async () => {
  const cases = [
    ["not found", "?id=p-gone", seedOnly([SEED_POST])],
    ["failure", "?id=p-image", () => { throw new TypeError("Failed to fetch"); }],
  ];
  for (const [state, search, answer] of cases) {
    const page = await openPostPage(search, answer);
    try {
      assert.equal(page.panel.querySelectorAll(".share-button").length, 0, `${state}: a link to copy without a post`);
      assert.equal(page.panel.querySelectorAll(".share-status").length, 0, `${state}: a confirmation with nothing to confirm`);
      assert.equal(page.panel.querySelectorAll("input").length, 0, `${state}: a manual-copy field with no post`);
      assert.equal(textOf(page.document.getElementById("main-content")).includes("Copy link to this post"), false,
        `${state}: the label survived into a state with no post`);
    } finally {
      page.restore();
    }
  }
});

// Before the script runs at all, and while the lookup is still running: the
// shipped markup and the wait are both states with no post in them.
test("the wait a cold visitor meets offers no link to copy", async () => {
  const page = await loadPage(new URL("../src/post.html", import.meta.url), { location: { search: "?id=p-image" } });
  try {
    assert.equal(page.document.querySelectorAll(".share-button").length, 0, "the shipped markup offers a copy before a post exists");

    let release;
    globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(seedResponse([SEED_POST])); });
    await importPageModule("/post-page.js");
    await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "loading", "the script took the region");
    const panel = page.document.querySelector("#post-detail");
    assert.equal(panel.querySelectorAll(".share-button").length, 0, "the wait offers a copy before a post exists");
    assert.equal(panel.querySelectorAll("input").length, 0, "the wait draws a manual-copy field before a post exists");
    // Which is also why nothing inside the waiting region is tabbable yet.
    assert.equal(tabSequence(page.document).filter((node) => node.closest("#post-detail")).length, 0);

    release();
    await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "ready", "the post arrived");
    assert.equal(panel.querySelectorAll(".share-button").length, 1, "the post brought the control with it");
  } finally {
    page.restore();
  }
});
