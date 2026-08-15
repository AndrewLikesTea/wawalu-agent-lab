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

// The page's own routes onward, wherever it is in its life. Read from the whole
// document rather than from known ids: one appearing anywhere it should not —
// in the markup, in a state panel — fails here, and so does a stray "back".
function exits(document) {
  return document.querySelectorAll("a").filter((link) =>
    /^Open (Social|People) to |←|Back to/.test(link.textContent)
    // …and any chrome link that is on the page with no words in it. The People
    // label is now written from the loaded display name, so a name the page
    // cannot put in a label leaves a focusable link holding nothing — the one
    // failure a text-only match cannot see, because there is no text to match.
    || (link.classList.contains("detail-back") && !link.hidden));
}

// The feed and the composer in every state, People wherever there is a post to
// belong to one. Nothing rewrites any label; the People link's destination may
// narrow to a display name the page can actually name, which is what the label
// promises, and a state with no post withdraws the link rather than softening
// its words. `peopleHref` of null asserts that withdrawal — counted through the
// list, so no node is ever compared against null.
//
// The order is the row's order, because `exits()` reads the document: the name
// this post was published under, the feed it came out of, then writing one.
function assertExits(page, peopleHref, where) {
  const links = exits(page.document);
  const expected = peopleHref ? [[PEOPLE.label, peopleHref]] : [];
  expected.push([SOCIAL.label, SOCIAL.href], [PUBLISH.label, PUBLISH.href]);
  assert.deepEqual(
    links.map((link) => [textOf(link), link.href]),
    expected,
    `${where}: the page's routes onward`,
  );
}

// What a display name is, in the bytes Social's feed note and People's role line
// already ship. Written out here so the permalink's own sentence is readable in
// the test that asserts it, and pinned against those two pages below so none of
// the three can drift — a claim that agrees in substance and differs in a comma
// reads as two claims to anyone who meets both. It carries both halves of the
// definition: where the names come from, and that nobody owns one.
const IDENTITY = "Display names are invented for this demo or chosen by whoever published the post — nobody owns or verifies one, and anyone can publish under any name.";

const SOCIAL = { label: "Open the full Social feed", href: "/social.html" };
const PEOPLE = { label: "Open People to see Mina Okafor’s other image posts", href: "/profile.html" };
// Social's composer, at the fragment src/social-page.js opens the collapsed
// panel for. Same route People offers for the same job.
const PUBLISH = { label: "Publish a post of your own", href: "/social.html#post-form" };
const MINA = "/profile.html?author=Mina%20Okafor";

// The onward row's controls, as elements, in document order. `children` holds
// the whitespace between the tags as text nodes, so the walk keeps elements
// only; it is a walk rather than a selector because the harness rejects a
// descendant selector, and because "which control is third" is a question about
// the row's own children, not about where a match happens to fall in the page.
function onwardRow(document) {
  const row = document.querySelector("#post-onward");
  return row.children.filter((node) => node.nodeType === 1);
}

test("a post that loads is headed by its author and reads description, image, caption, name, time", async () => {
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
    assert.deepEqual(
      article.children.slice(0, 4).map((node) => node.className),
      ["description-note detail-image-description", "detail-figure", "detail-byline", "post-date detail-date"],
      "the routed page preserves the valid-post reading order",
    );
    assert.equal(page.panel.getAttribute("aria-busy"), "false");
    assert.ok(textOf(page.panel).includes(IDENTITY),
      "a stranger arriving on this link is not told what a display name is");

    // The post named its author, so the People link now points at that one
    // display name's view — which is what its words promised all along.
    assertExits(page, MINA, "loaded");
  } finally {
    page.restore();
  }
});

// Read out of the two pages that already ship the sentence rather than typed
// again here, so this fails the moment any of the three surfaces rewords it. All
// three carry the whole sentence now: it used to be split, with the feed saying
// where the names came from and the other two saying nobody owned one, which
// left a reader assembling one definition out of three partial ones.
test("the permalink says what a display name is in Social's and People's own bytes", async () => {
  const shipped = [];
  for (const file of ["social.html", "profile.html"]) {
    const html = (await readFile(new URL(`../src/${file}`, import.meta.url), "utf8")).replace(/<!--[\s\S]*?-->/g, "");
    const clause = html.match(/Display names are invented[^.<]*\./)?.[0];
    assert.ok(clause, `${file} no longer tells a reader what a display name is`);
    shipped.push(clause);
  }
  assert.equal(new Set(shipped).size, 1, "Social and People drifted into two ways of saying it");
  assert.equal(IDENTITY, shipped[0], `the permalink does not ship the other two's sentence: ${shipped[0]}`);

  const page = await openPostPage("?id=p-image", seedOnly([SEED_POST]));
  try {
    const rendered = textOf(page.panel);
    // Once. A fact stated twice on one screen is a fact a reader skips.
    assert.equal(rendered.split(IDENTITY).length - 1, 1, "the permalink states it other than exactly once");
    // The page's other "signed-in" sentence is about Social, not about a name,
    // and it belongs to the states with no post. Both on one screen would read
    // as two claims about the same thing.
    assert.doesNotMatch(rendered, /not a signed-in account/);
  } finally {
    page.restore();
  }
});

test("arriving from a profile narrows the People link, and changes no words", async () => {
  const page = await openPostPage("?id=p-image&from=profile&author=Mina%20Okafor", seedOnly([SEED_POST]));
  try {
    assertExits(page, MINA, "from a profile");
    // Where the reader came from does not rename anything. The labels are the
    // same two the page ships for a visitor who has never seen either surface.
    assert.equal(textOf(page.document.querySelector("#page-title")), "Post by Mina Okafor");
  } finally {
    page.restore();
  }
});

test("an unknown id is named as a missing post, with the feed still the way out", async () => {
  const page = await openPostPage("?id=p-gone", seedOnly([SEED_POST]));
  try {
    assert.match(textOf(page.panel), /Post unavailable/);
    assert.match(textOf(page.panel), /This post can’t be shown\./);
    assert.doesNotMatch(textOf(page.panel), /removed|private|signed-in|your post/i);
    assert.doesNotMatch(textOf(page.panel), /Display names are invented for this demo/);
    // No post, no author: the h1 names the page rather than standing as "Post".
    assert.equal(textOf(page.document.querySelector("#page-title")), "Post from Social");
    assert.doesNotMatch(textOf(page.panel), /Try again/);
    assert.equal(page.panel.querySelector(".detail-state-message").getAttribute("role"), "status");
    assert.equal(page.document.title, "Post unavailable · Shiplog");
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
    assert.deepEqual(toFeed.map(textOf), ["Go to the Social feed", "Open the full Social feed"]);

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
    assert.match(textOf(page.panel), /The Social feed did not respond\./);
    assert.equal(textOf(page.panel.querySelector(".detail-state-feed")), "Open the full Social feed");
    assert.doesNotMatch(textOf(page.panel), /private|signed-in|your post/i);
    assertExits(page, null, "failed");

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
    assertExits(page, MINA, "recovered");
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
    assert.match(textOf(page.panel), /This link does not point to a post we can show/);
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
    assert.equal(state.getAttribute("role"), "status", "the state is announced without stealing focus");
    assert.equal(page.document.activeElement, null, "nothing may take focus on load");
    assert.equal(textOf(state.querySelector(".detail-loading-text")), "Shiplog is opening a single shared post from Social…");
    assert.doesNotMatch(textOf(panel), /Display names are invented for this demo/);
    // Nothing is named yet, so the h1 names the page — the same words a reader
    // sees in the shipped markup before any script runs.
    assert.equal(textOf(page.document.querySelector("#page-title")), "Post from Social");
    // The compact state says the wait once, without guessing at an image-shaped placeholder.
    assert.equal(panel.querySelectorAll(".detail-state-message").length, 0);
    assert.equal(panel.querySelectorAll("h2").length, 0);
    assert.equal(state.getAttribute("aria-labelledby"), null);
    assert.equal(panel.querySelectorAll(".skeleton-media").length, 0);
    // The frame around it still says what the page is, so the region is never
    // an unexplained blank.
    assert.match(textOf(page.document.querySelector(".hero-post")),
      /Shared links like this one open a single post from Social’s shared demo feed\./);
    assertExits(page, null, "loading");
    // Not hidden, not empty: not in the document at all. Counted, never compared
    // against null.
    assert.equal(page.document.querySelectorAll("#post-people").length, 0,
      "loading must not expose an empty or placeholder display name");
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
    assert.equal(textOf(panel.querySelector(".detail-loading-text")), "Shiplog is opening a single shared post from Social…");
    assert.equal(panel.querySelector(".detail-loading").getAttribute("role"), "status");
    // The states that explain an absent post are not in the markup at all, so
    // the wait and an unavailable panel cannot be read together at any point.
    assert.equal(panel.querySelectorAll(".detail-state-message").length, 0);
    assert.equal(panel.querySelectorAll(".detail-post").length, 0);
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
    assert.equal(textOf(panel.querySelector(".detail-loading-text")), "Shiplog is opening a single shared post from Social…");
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
    // The panel offers both a return to the feed and a retry.
    assert.equal(page.panel.querySelectorAll("button").length, 1);
    assert.equal(page.panel.querySelectorAll("a").length, 1);
    assert.equal(textOf(page.panel.querySelector("a")), "Open the full Social feed");
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

/* ---------------------------- the onward row ------------------------------ */

// A forwarded post used to end in a dead end for anyone who wanted more than the
// one post: the page offered the feed and, once it knew a name, that person's
// People view — and nothing at all for the reader who had just decided to write
// a post of their own. The row now carries up to three routes, and which of them
// a state may offer is the whole of what these tests are about.
//
// Every control is a link with its own visible words, so each is one tab stop
// with the site's own ring and nothing here adds a tabindex. What changes
// between states is the set, never a label.
const ROW_LABELS = { people: PEOPLE.label, feed: SOCIAL.label, publish: PUBLISH.label };
const rowLabels = (document) => onwardRow(document).map(textOf);

// The two questions asked in every state, both as counts: what the row offers,
// and whether a People link exists anywhere in the document. The second is a
// count and not a node comparison — a People link that survived into a state
// with no display name is a link promising a person the page never resolved.
function assertRow(page, expected, where) {
  assert.deepEqual(rowLabels(page.document), expected.map((key) => ROW_LABELS[key]), `${where}: the onward row`);
  assert.equal(page.document.querySelectorAll("#post-people").length, expected.includes("people") ? 1 : 0,
    `${where}: the People link`);
  // Reachable, in the row's own order, with no tabindex anywhere in it.
  const sequence = tabSequence(page.document);
  const stops = onwardRow(page.document).map((control) => sequence.indexOf(control));
  assert.equal(stops.filter((index) => index >= 0).length, expected.length, `${where}: every control is keyboard-reachable`);
  assert.deepEqual(stops.slice().sort((a, b) => a - b), stops, `${where}: tab order follows the row`);
  for (const control of onwardRow(page.document)) {
    assert.equal(control.getAttribute("tabindex"), null, `${where}: ${textOf(control)} must not carry a tabindex`);
  }
}

test("the loading state offers the feed and the composer, and no People link at all", async () => {
  // Held open, so the wait is read as its own state rather than inferred from
  // the state that follows it.
  const page = await loadPage(new URL("../src/post.html", import.meta.url), { location: { search: "?id=p-image&author=Mina%20Okafor" } });
  try {
    let release;
    globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(seedResponse([SEED_POST])); });
    await importPageModule("/post-page.js");
    await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "loading", "the script took the region");

    // Two, and the publish route is one of them on purpose: a reader is not held
    // at a dead end while a fetch runs, and Social's composer is true whatever
    // this lookup returns. The People link is the one that cannot be here — even
    // though the arriving URL claimed a display name, which is a claim and not a
    // name this page resolved.
    assertRow(page, ["feed", "publish"], "loading");
    assert.equal(textOf(page.document.querySelector("main")).includes("Mina Okafor"), false,
      "loading must not print a display name the page has not resolved");

    // Settled all the way through before the page is torn down, so a fetch left
    // in flight cannot surface as an unhandled rejection in CI.
    release();
    await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "ready", "the post arrived");
    assertRow(page, ["people", "feed", "publish"], "after loading");
  } finally {
    page.restore();
  }
});

test("a loaded post offers all three, in reading order: the name, the feed, then publishing", async () => {
  const page = await openPostPage("?id=p-image", seedOnly([SEED_POST]));
  try {
    assertRow(page, ["people", "feed", "publish"], "loaded");

    // Walked as the row's own children, so this is DOM order — what a screen
    // reader and the Tab key follow — and not the order a selector happened to
    // match in. The narrowest route first: the display name this post was
    // published under, the feed it came out of, then writing one.
    const [people, feed, publish] = onwardRow(page.document);
    assert.deepEqual([people.id, feed.id, publish.id], ["post-people", "post-back", "post-publish"]);

    // The People link names the person in words a reader can see, and goes to
    // People filtered to that same name — the ?author= parameter profile.js
    // reads on load, not a route invented here.
    assert.ok(textOf(people).includes("Mina Okafor"), "the People link must name the display name it filters to");
    assert.equal(people.getAttribute("href"), MINA);
    assert.equal(people.getAttribute("aria-label"), null, "the visible words carry the destination");

    // And publishing goes to the composer's own fragment, which is what opens
    // the collapsed panel on Social.
    assert.equal(publish.getAttribute("href"), "/social.html#post-form");
    assert.equal(textOf(publish), PUBLISH.label);

    // One row, one of each: nothing is duplicated into the panel above it.
    assert.equal(page.panel.querySelectorAll(".detail-back").length, 0, "the row lives in the page frame, not the panel");
    assert.equal(page.document.querySelectorAll("#post-publish").length, 1);
  } finally {
    page.restore();
  }
});

test("a failed lookup keeps the feed and the composer reachable, and withdraws People", async () => {
  const page = await openPostPage("?id=p-image&author=Mina%20Okafor", () => { throw new TypeError("Failed to fetch"); });
  try {
    assert.equal(page.panel.dataset.postState, "error");
    assertRow(page, ["feed", "publish"], "error");
    // The state owns a retry of its own, and it still reads before the row —
    // the control that can still produce the post precedes the ones that leave
    // without it.
    const sequence = tabSequence(page.document);
    assert.ok(sequence.indexOf(page.panel.querySelector(".detail-retry")) < sequence.indexOf(page.document.querySelector("#post-back")));
  } finally {
    page.restore();
  }
});

test("a post that is not there keeps the feed and the composer reachable, and withdraws People", async () => {
  const page = await openPostPage("?id=p-gone&author=Mina%20Okafor", seedOnly([SEED_POST]));
  try {
    assert.equal(page.panel.dataset.postState, "not-found");
    assertRow(page, ["feed", "publish"], "not found");
    // The link that was never resolved is not merely withdrawn from the row: its
    // words are off the page, so nothing promises this reader a person.
    assert.equal(textOf(page.document.querySelector("main")).includes(PEOPLE.label), false);
  } finally {
    page.restore();
  }
});
