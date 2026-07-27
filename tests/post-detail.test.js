// The single-post view a profile tile navigates to: resolution plus the four
// states it must keep apart (loading, found, missing, failed).

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { byClass, createElement, first, ids, installDocument, tags } from "./support/dom.js";

installDocument();

const { findPostById, postDetailTitle, postPageHeading, renderPostDetail } = await import("../src/post-detail.js");

const post = {
  id: "p-image",
  author: "Mina Okafor",
  body: "Focus rings landed everywhere.",
  caption: "The middle card, ringed.",
  createdAt: "2026-07-14T09:00:00.000Z",
  likes: 3,
  comments: 1,
  image: { src: "/media/focus-ring.svg", alt: "A card wrapped in a blue focus ring", width: 1200, height: 900 },
};

test("a post is found by exact id", () => {
  const posts = [post, { ...post, id: "other" }];
  assert.equal(findPostById(posts, "p-image").id, "p-image");
  assert.equal(findPostById(posts, "missing"), null);
  assert.equal(findPostById(posts, ""), null);
  assert.equal(findPostById(undefined, "p-image"), null);
});

test("the detail view shows the image whole, with its caption and counts", () => {
  const container = createElement("div");
  renderPostDetail(container, post);

  assert.equal(container.getAttribute("aria-busy"), "false");
  const article = first(container, "detail-post");
  assert.equal(article.tagName, "ARTICLE");

  const img = tags(article, "IMG")[0];
  assert.equal(img.src, "/media/focus-ring.svg");
  assert.equal(img.alt, "A card wrapped in a blue focus ring");
  // No lazy loading here: this image is the reason the page was opened.
  assert.equal(img.loading, undefined);

  const figure = tags(article, "FIGURE")[0];
  assert.equal(tags(figure, "FIGCAPTION")[0].textContent, "The middle card, ringed.");
  // A dedicated caption does not replace the body, so both are shown.
  assert.equal(first(article, "detail-body").textContent, "Focus rings landed everywhere.");

  const author = first(article, "post-author");
  assert.equal(author.tagName, "A");
  assert.equal(author.href, "/profile.html?author=Mina%20Okafor");
  assert.equal(first(article, "post-avatar").getAttribute("aria-hidden"), "true");

  assert.match(first(article, "detail-stats").textContent, /3 likes.*1 comment/);

  const label = article.getAttribute("aria-labelledby").split(" ");
  assert.equal(label.length, 2);
  for (const id of label) assert.ok(ids(article).includes(id), `${id} must resolve inside the article`);
});

test("an image without source alt uses the visible caption as its description", () => {
  const container = createElement("div");
  renderPostDetail(container, { ...post, image: { ...post.image, alt: "" } });
  assert.equal(tags(container, "IMG")[0].alt, "The middle card, ringed.");
});

test("a post with no separate caption shows its body once", () => {
  const container = createElement("div");
  renderPostDetail(container, { ...post, caption: null });
  assert.equal(tags(container, "FIGCAPTION")[0].textContent, "Focus rings landed everywhere.");
  assert.equal(byClass(container, "detail-body").length, 0, "the body is not repeated under its own caption");
});

test("a text post falls back to a labelled paragraph", () => {
  const container = createElement("div");
  renderPostDetail(container, { ...post, caption: null, image: undefined });
  assert.equal(tags(container, "FIGURE").length, 0);
  const body = first(container, "detail-body");
  assert.equal(body.textContent, "Focus rings landed everywhere.");
  assert.ok(ids(container).includes(body.id));
});

test("a dead image keeps its description rather than dropping it", () => {
  const container = createElement("div");
  renderPostDetail(container, post);
  const media = first(container, "detail-media");
  assert.equal(media.dataset.state, "loading");

  tags(container, "IMG")[0].dispatch("error");
  assert.equal(media.dataset.state, "error");
  const fallback = first(container, "detail-media-fallback");
  assert.equal(fallback.hidden, false);
  assert.equal(fallback.getAttribute("role"), "status");
  assert.ok(ids(fallback).includes(fallback.getAttribute("aria-labelledby")));
  assert.match(fallback.textContent, /Image unavailable.*Description: A card wrapped in a blue focus ring/);
  // The page's standing back link is the only way back; the note does not add
  // a second control to the same profile.
  assert.equal(byClass(fallback, "empty-action-secondary").length, 0);
});

test("a missing post is named in plain language, with no id or code echoed back", () => {
  const missing = createElement("div");
  renderPostDetail(missing, null, { id: "p-gone", author: "Mina" });
  assert.equal(first(missing, "detail-state-label").textContent, "Post status");
  assert.equal(first(missing, "empty-title").textContent, "Post not found");
  assert.match(missing.textContent, /This post may have been removed, or the link may be incomplete\./);
  assert.equal(missing.firstChild.getAttribute("role"), "status");
  assert.ok(ids(missing).includes(missing.firstChild.getAttribute("aria-labelledby")));
  assert.equal(byClass(missing, "empty-action-secondary").length, 0, "the standing back link is not repeated here");
  // The reader is told the post is gone, not shown the string they typed.
  assert.doesNotMatch(missing.textContent, /p-gone|404|null|undefined/);
});

test("a failed load says what happened once, offers a retry, and leaks no error text", () => {
  const failed = createElement("div");
  let retried = 0;
  renderPostDetail(failed, null, { state: "error", id: "p-gone", author: "Mina", onRetry: () => { retried += 1; } });
  assert.equal(first(failed, "detail-state-label").textContent, "Error");
  assert.equal(first(failed, "empty-title").textContent, "Post couldn’t be loaded");
  assert.match(failed.textContent, /We couldn’t reach Social, so this post didn’t load\./);
  assert.equal(failed.firstChild.getAttribute("role"), "alert");
  assert.doesNotMatch(failed.textContent, /p-gone|\b[45]\d\d\b|Error:|fetch|TypeError/);
  // Retry is the only action this state offers; the way back is the page's
  // standing back link, not a second copy of it inside the panel.
  assert.match(failed.textContent, /Try again/);
  assert.equal(byClass(failed, "empty-action-secondary").length, 0);
  tags(failed, "BUTTON")[0].dispatch("click");
  assert.equal(retried, 1, "a failed load offers a retry");
});

test("an id-less visit is told what the page needs, and the standing exits carry the feed", () => {
  const container = createElement("div");
  renderPostDetail(container, null, { id: "" });
  assert.equal(first(container, "empty-title").textContent, "Choose a post");
  assert.match(container.textContent, /No post was specified\. Open one from Social\./);
  // The page's standing exits already name Social, so the panel does not add a
  // second, differently-worded link to the same place.
  assert.equal(byClass(container, "empty-action-secondary").length, 0);
});

test("the loading state names what is loading in one sentence", () => {
  const container = createElement("div");
  renderPostDetail(container, null, { state: "loading", id: "p-image", author: "Mina" });
  assert.equal(container.getAttribute("aria-busy"), "true");
  assert.equal(first(container, "detail-state-label").textContent, "Post status");
  assert.equal(first(container, "empty-title").textContent, "Loading post");
  assert.match(container.textContent, /We’re finding this post and its author\./);
  assert.equal(container.firstChild.getAttribute("role"), "status");
  assert.ok(ids(container).includes(container.firstChild.getAttribute("aria-labelledby")));
  assert.equal(byClass(container, "empty-action-secondary").length, 0, "the standing back link is not repeated here");
  assert.equal(first(container, "detail-skeleton").getAttribute("aria-hidden"), "true");
});

test("the loaded page is headed by the post's author, not the bare word Post", () => {
  assert.equal(postPageHeading(post), "Post by Mina Okafor");
  assert.equal(postPageHeading(null), "Post");
  assert.equal(postPageHeading({ ...post, author: "" }), "Post");
});

test("the document title names the post, the feed, and the product", () => {
  assert.equal(postDetailTitle(post), "Post by Mina Okafor · Social · Shiplog");
  assert.equal(postDetailTitle(null), "Post not found · Shiplog");
  assert.equal(postDetailTitle(null, "error"), "Post unavailable · Shiplog");
});

test("the post page's exits sit after the site frame, and each names where it goes", async () => {
  const html = await readFile(new URL("../src/post.html", import.meta.url), "utf8");

  // The order this page used to get wrong: its back link came before the
  // wordmark, so the one page-specific control on the site preceded the site
  // frame. src/decision.html puts "← Back to Decisions" inside the content
  // region, after the header, and this page now matches it.
  const brand = html.indexOf('class="brand"');
  const nav = html.indexOf('<nav class="site-nav"');
  const feed = html.indexOf('id="post-back-feed"');
  const profile = html.indexOf('id="post-back"');
  const content = html.indexOf('id="post-detail"');
  assert.ok(brand < nav, "the wordmark precedes the nav");
  assert.ok(nav < feed, "the nav precedes the exits");
  assert.ok(feed < profile, "the feed exit precedes the profile exit");
  assert.ok(profile < content, "the exits precede the post content");

  // Destination in the visible text, not smuggled into an aria-label.
  assert.match(html, /<a class="detail-back detail-page-back" id="post-back-feed" href="\/social\.html">← Back to Social<\/a>/);
  assert.match(html, /<a class="detail-back detail-page-back" id="post-back" href="\/profile\.html">← Back to Profile<\/a>/);
  const exits = html.match(/<p class="detail-page-exits">[\s\S]*?<\/p>/)[0];
  assert.doesNotMatch(exits, /aria-label/, "an exit must not depend on aria-label to name its destination");

  // The arrow-plus-"Back to <destination>" convention comes from the decision
  // page; this page is not allowed to invent a second phrasing for the same job.
  const decision = await readFile(new URL("../src/decision.html", import.meta.url), "utf8");
  assert.match(decision, /class="detail-back" href="\/">← Back to Decisions<\/a>/);
});

/* ------------------------- the page's standing frame ---------------------- */

// Word-for-word with the <p> in src/post.html's hero. It is pinned here because
// the whole point of the sentence is that it is standing copy: a reader who
// arrived from a shared link has to be told what Social is before, during, and
// after the post load — including when the post never arrives.
const STANDING_SENTENCE =
  "This is one post from Social, the team’s feed of short notes about the decisions and releases logged in Shiplog.";

// Every state the panel can be in, named the way a reader would name it.
const PANEL_STATES = [
  ["loading", null, { state: "loading", id: "p-image", author: "Mina" }],
  ["loaded", post, { state: "ready", id: "p-image", author: "Mina Okafor" }],
  ["missing", null, { state: "ready", id: "p-gone", author: "Mina" }],
  ["error", null, { state: "error", id: "p-gone", author: "Mina" }],
  ["id-less", null, { state: "ready", id: "" }],
];

const postPageHtml = () => readFile(new URL("../src/post.html", import.meta.url), "utf8");

test("the page says what Social is in one plain sentence, written once, outside the panel", async () => {
  const html = await postPageHtml();
  assert.ok(html.includes(`<p>${STANDING_SENTENCE}</p>`), "the standing sentence must ship in the markup");
  assert.equal(html.split(STANDING_SENTENCE).length - 1, 1, "it is written once, not repeated per state");

  // Short enough to read at a glance, and one sentence rather than a paragraph.
  assert.ok(STANDING_SENTENCE.split(/\s+/).length <= 25, "the standing sentence stays at 25 words or fewer");
  assert.equal(STANDING_SENTENCE.split(/[.!?]/).filter((part) => part.trim()).length, 1, "one sentence, not two");

  // It belongs to the hero, which no script rewrites, and it comes before the
  // panel — so it is already on screen while the post is still being fetched.
  const hero = html.match(/<section class="hero hero-post"[\s\S]*?<\/section>/)[0];
  assert.ok(hero.includes(STANDING_SENTENCE), "the sentence must sit in the standing hero, not in #post-detail");
  assert.ok(html.indexOf(STANDING_SENTENCE) < html.indexOf('id="post-detail"'), "it precedes the state panel");
});

test("the standing sentence outlives every state the panel renders", () => {
  for (const [name, value, options] of PANEL_STATES) {
    // The hero and the panel arranged the way src/post.html arranges them.
    const main = createElement("main");
    const hero = createElement("section");
    const lede = createElement("p");
    lede.textContent = STANDING_SENTENCE;
    hero.append(lede);
    const container = createElement("div");
    main.append(hero, container);

    renderPostDetail(container, value, options);

    assert.match(main.textContent, /This is one post from Social/, `the sentence is gone in the ${name} state`);
    // The panel keeps its own copy exactly as shipped and never restates this.
    assert.doesNotMatch(container.textContent, /This is one post from Social/, `the ${name} panel restates the sentence`);
  }
});

test("exactly two standing exits render on the post page, in every state", async () => {
  const html = await postPageHtml();
  // One per destination the page can honestly claim, each written once.
  assert.equal([...html.matchAll(/id="post-back"/g)].length, 1, "one standing profile exit in the markup");
  assert.equal([...html.matchAll(/id="post-back-feed"/g)].length, 1, "one standing feed exit in the markup");
  assert.equal([...html.matchAll(/class="detail-back detail-page-back"/g)].length, 2);

  for (const [name, value, options] of PANEL_STATES) {
    const container = createElement("div");
    renderPostDetail(container, value, options);
    const repeated = tags(container, "A")
      .filter((link) => link.classes.includes("empty-action-secondary"))
      .filter((link) => String(link.href ?? "").startsWith("/profile.html"));
    assert.equal(repeated.length, 0, `the ${name} state repeats the standing back link`);
  }
});

test("no panel state renders its own way out; the standing exits own that job", () => {
  for (const [name, value, options] of PANEL_STATES) {
    const container = createElement("div");
    renderPostDetail(container, value, options);
    assert.equal(
      byClass(container, "empty-action-secondary").length,
      0,
      `the ${name} state restates one of the standing exits`,
    );
    // Retry is the one action a state still owns, because no standing link can
    // re-run a failed fetch.
    const buttons = tags(container, "BUTTON");
    assert.equal(buttons.length, name === "error" ? 1 : 0, `the ${name} state renders unexpected controls`);
  }
});

test("the post page's nav lists Profile once", async () => {
  const html = await readFile(new URL("../src/post.html", import.meta.url), "utf8");
  const nav = html.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)[0];
  assert.equal([...nav.matchAll(/>Profile</g)].length, 1, "Profile appears twice in the post page nav");
});
