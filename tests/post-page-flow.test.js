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

// The page's own routes out, wherever it is in its life. Read from the whole
// document rather than from known ids: a third one appearing anywhere — in the
// markup, in a state panel — fails here, and so does a stray "back".
function exits(document) {
  return document.querySelectorAll("a").filter((link) =>
    /^Open (Social|People) to |←|Back to/.test(link.textContent)
    // …and any chrome link that is on the page with no words in it. The People
    // label is now written from the loaded display name, so a name the page
    // cannot put in a label leaves a focusable link holding nothing — the one
    // failure a text-only match cannot see, because there is no text to match.
    || (link.classList.contains("detail-back") && !link.hidden));
}

// Social in every state, People wherever there is a post to belong to one.
// Nothing rewrites either label; the People link's destination may narrow to a
// display name the page can actually name, which is what the label promises,
// and a state with no post withdraws the link rather than softening its words.
// `peopleHref` of null asserts that withdrawal — counted through the list, so
// no node is ever compared against null.
function assertExits(page, peopleHref, where) {
  const links = exits(page.document);
  const expected = [[SOCIAL.label, SOCIAL.href]];
  if (peopleHref) expected.push([PEOPLE.label, peopleHref]);
  assert.deepEqual(
    links.map((link) => [textOf(link), link.href]),
    expected,
    `${where}: the page's routes out`,
  );
}

// What a display name is, in the bytes Social's composer and People's role line
// already ship. Written out here so the permalink's own sentence is readable in
// the test that asserts it, and pinned against those two pages below so none of
// the three can drift — a claim that agrees in substance and differs in a comma
// reads as two claims to anyone who meets both.
const IDENTITY = "A display name is not a signed-in user — nobody owns or verifies one, and anyone can publish under any name.";

const SOCIAL = { label: "Open Social to read the whole feed", href: "/social.html" };
const PEOPLE = { label: "Open People to see Mina Okafor’s other image posts", href: "/profile.html" };
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
    assert.ok(textOf(page.panel).includes(IDENTITY),
      "a stranger arriving on this link is not told what a display name is");

    // The post named its author, so the People link now points at that one
    // display name's view — which is what its words promised all along.
    assertExits(page, MINA, "loaded");
  } finally {
    page.restore();
  }
});

// Read out of the two pages that already ship the claim rather than typed again
// here, so this fails the moment any of the three surfaces rewords it. Compared
// on the clause the three genuinely share: Social attaches it to the composer's
// field and People attaches it to a named person ("Ari is a display name…"), so
// only the permalink can carry the whole sentence, and the sentence it carries
// has to end in exactly their bytes.
test("the permalink says what a display name is in Social's and People's own bytes", async () => {
  const shipped = [];
  for (const file of ["social.html", "profile.html"]) {
    const html = (await readFile(new URL(`../src/${file}`, import.meta.url), "utf8")).replace(/<!--[\s\S]*?-->/g, "");
    const clause = html.match(/not a signed-in user[^.<]*\./)?.[0];
    assert.ok(clause, `${file} no longer tells a reader a display name is not an account`);
    shipped.push(clause);
  }
  assert.equal(new Set(shipped).size, 1, "Social and People drifted into two ways of saying it");
  assert.ok(IDENTITY.endsWith(shipped[0]), `the permalink does not end in the clause the other two ship: ${shipped[0]}`);

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
    assert.match(textOf(page.panel), /Post not found/);
    assert.match(textOf(page.panel), /This post was not found\./);
    assert.match(textOf(page.panel), /Social is a shared demo feed, not a signed-in account\./);
    assert.doesNotMatch(textOf(page.panel), /A display name is not a signed-in user/);
    // No post, no author: the h1 names the page rather than standing as "Post".
    assert.equal(textOf(page.document.querySelector("#page-title")), "Post from Social");
    assert.doesNotMatch(textOf(page.panel), /Try again/);
    assert.equal(page.panel.querySelector(".detail-state-message").getAttribute("role"), "status");
    assert.equal(page.document.title, "Post not found · Shiplog");
    // No post, so no display name the People link's words could be about: the
    // feed is the one route this state offers.
    assertExits(page, null, "not found");
    const feed = page.panel.querySelector(".detail-state-feed");
    assert.equal(textOf(feed), "Return to the Social feed");
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
    assert.equal(textOf(feed), "Return to the Social feed");
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
    assert.deepEqual(toFeed.map(textOf), ["Return to the Social feed", "Open Social to read the whole feed"]);

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
    assert.match(textOf(page.panel), /Post could not be loaded/);
    assert.match(textOf(page.panel), /The Social feed could not be reached/);
    assert.match(textOf(page.panel), /Social is a shared demo feed, not a signed-in account\./);
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
    assert.match(textOf(page.panel), /Post not found/);
    assert.match(textOf(page.panel), /This link did not name a post to open/);
    assert.equal(page.requests.length, 0);
    assertExits(page, null, "no id");
    // The one next step, in the panel that explains why it is needed.
    assert.equal(textOf(page.panel.querySelector(".detail-state-feed")), "Return to the Social feed");
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
    assert.doesNotMatch(textOf(panel), /A display name is not a signed-in user/);
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
    assert.equal(textOf(panel.querySelector(".detail-loading")), "Loading this post…");
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
