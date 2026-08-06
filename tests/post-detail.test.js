// The single-post view a profile tile navigates to: resolution plus the four
// states it must keep apart (loading, found, missing, failed).

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { byClass, createElement, first, ids, installDocument, tags } from "./support/dom.js";

installDocument();

const {
  POST_EXITS,
  POST_LOADING_LINE,
  POST_STATES,
  findPostById,
  resolvePostState,
  postDetailTitle,
  postImageAlt,
  postPageHeading,
  postPeopleHref,
  renderPostDetail,
} = await import("../src/post-detail.js");

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

  assert.match(first(article, "detail-stats").textContent, /3 likes.*1 comment/);

  // The caption names the article, and the id it names resolves inside it.
  const label = article.getAttribute("aria-labelledby");
  assert.equal(label, "detail-caption");
  assert.ok(ids(article).includes(label), `${label} must resolve inside the article`);
});

test("the post reads in one order: who, when, the image, then its caption", () => {
  const container = createElement("div");
  renderPostDetail(container, post);
  const article = first(container, "detail-post");

  // The poster's name heads the page as its h1 (src/post-page.js writes it into
  // the hero above this panel) and opens the article as a link to that person's
  // People view — the page's one forward step out of a shared link.
  assert.equal(postPageHeading(post), "Post by Mina Okafor");

  const time = tags(article, "TIME")[0];
  assert.equal(time.textContent.length > 0, true, "the timestamp needs human-readable text");
  assert.equal(time.dateTime, "2026-07-14T09:00:00.000Z", "and a machine-readable datetime");

  const sequence = article.children.map((child) => child.tagName);
  assert.deepEqual(sequence.slice(0, 3), ["P", "TIME", "FIGURE"], "the byline, then the timestamp, then the image");

  const figure = tags(article, "FIGURE")[0];
  assert.deepEqual(
    figure.children.map((child) => child.tagName),
    ["DIV", "FIGCAPTION"],
    "the caption is the image's figcaption, and follows it",
  );
  assert.ok(tags(figure, "IMG").length === 1, "the image sits inside the figure");

  // The byline is the name itself, linked — never "profile" or "view profile",
  // which would leave a screen reader's link list unable to say whose.
  const byline = first(article, "detail-byline");
  assert.equal(article.children[0], byline, "the byline opens the article");
  const link = first(byline, "detail-author-link");
  assert.equal(link.tagName, "A");
  assert.equal(link.textContent, "Mina Okafor");
  assert.equal(link.href, "/profile.html?author=Mina%20Okafor");
});

/* --------------------- the image's accessible name ------------------------ */

// Three branches, one precedence, asserted at the function and through a render.
test("the image is named by the poster's alt text when there is any", () => {
  assert.equal(postImageAlt({ alt: "A card wrapped in a blue focus ring" }, "The middle card, ringed."), "A card wrapped in a blue focus ring");
  const container = createElement("div");
  renderPostDetail(container, post);
  assert.equal(tags(container, "IMG")[0].alt, "A card wrapped in a blue focus ring");
});

test("an image without source alt uses the visible caption as its description", () => {
  assert.equal(postImageAlt({ alt: "   " }, "The middle card, ringed."), "The middle card, ringed.");
  const container = createElement("div");
  renderPostDetail(container, { ...post, image: { ...post.image, alt: "" } });
  assert.equal(tags(container, "IMG")[0].alt, "The middle card, ringed.");
});

test("an image with neither alt nor caption is marked decorative, not labelled 'image'", () => {
  assert.equal(postImageAlt({ alt: "" }, ""), "");
  const container = createElement("div");
  renderPostDetail(container, { ...post, body: "", caption: null, image: { ...post.image, alt: "" } });

  const img = tags(container, "IMG")[0];
  assert.equal(img.alt, "", "alt must be exactly empty, so the image leaves the accessibility tree");
  // Not a placeholder, and never the filename: both are worse than silence.
  assert.doesNotMatch(String(img.alt), /image|photo|picture|focus-ring|svg/i);
  // Nor does an empty figcaption appear, announcing a caption that is not there.
  assert.equal(tags(container, "FIGCAPTION").length, 0);
  assert.equal(first(container, "detail-post").getAttribute("aria-labelledby"), null);
});

test("a dead image with no description says so rather than reading an empty one", () => {
  const container = createElement("div");
  renderPostDetail(container, { ...post, body: "", caption: null, image: { ...post.image, alt: "" } });
  tags(container, "IMG")[0].dispatch("error");
  assert.match(first(container, "detail-media-fallback").textContent, /carries no description of it/);
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

test("a post with no image renders no image slot at all, empty or otherwise", () => {
  for (const image of [undefined, null]) {
    const container = createElement("div");
    renderPostDetail(container, { ...post, image });
    // Not an empty frame, not a placeholder, not a hidden fallback waiting for
    // an error that cannot happen: the post is text, so the page is text.
    assert.equal(tags(container, "IMG").length, 0, "a post with no image must not render one");
    assert.equal(tags(container, "FIGURE").length, 0);
    assert.equal(byClass(container, "detail-media").length, 0, "no image frame reserves space for nothing");
    assert.equal(byClass(container, "detail-media-fallback").length, 0);
    // The text still reads, and still names the article.
    assert.equal(first(container, "detail-body").textContent, "The middle card, ringed.");
  }
});

test("hostile post text stays text and an active image URL is rejected at the render sink", () => {
  const container = createElement("div");
  const hostile = `<img src=x onerror="globalThis.pwned=true"><script>globalThis.pwned=true</script>`;
  globalThis.pwned = false;

  renderPostDetail(container, {
    ...post,
    author: hostile,
    body: hostile,
    caption: hostile,
    image: { src: "javascript:globalThis.pwned=true", alt: hostile },
  });

  assert.equal(first(container, "detail-body").textContent, hostile);
  assert.equal(tags(container, "SCRIPT").length, 0, "caption markup must not create executable nodes");
  assert.equal(tags(container, "IMG").length, 0, "an active image scheme must not reach the browser");
  assert.equal(tags(container, "FIGURE").length, 0, "a rejected image must degrade to a text-only post");
  assert.equal(globalThis.pwned, false);
  delete globalThis.pwned;
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
  assert.equal(first(missing, "detail-state-label").textContent, "Not found");
  assert.equal(first(missing, "empty-title").textContent, "Post not found");
  assert.match(missing.textContent, /This post was not found\./);
  assert.match(missing.textContent, /Social is a shared demo feed, not a signed-in account\./);
  assert.equal(missing.firstChild.getAttribute("role"), "status");
  assert.ok(ids(missing).includes(missing.firstChild.getAttribute("aria-labelledby")));
  const feed = first(missing, "detail-state-feed");
  assert.equal(feed.textContent, "Return to the Social feed");
  assert.equal(feed.href, "/social.html");
  // The reader is told the post is gone, not shown the string they typed.
  assert.doesNotMatch(missing.textContent, /p-gone|404|null|undefined/);
});

test("a failed load says what happened once, offers a retry, and leaks no error text", () => {
  const failed = createElement("div");
  let retried = 0;
  renderPostDetail(failed, null, { state: "error", id: "p-gone", author: "Mina", onRetry: () => { retried += 1; } });
  assert.equal(first(failed, "detail-state-label").textContent, "Unreachable");
  assert.equal(first(failed, "empty-title").textContent, "Post could not be loaded");
  // It names the thing that broke, not a verdict about the post.
  assert.match(failed.textContent, /The Social feed could not be reached/);
  assert.match(failed.textContent, /Social is a shared demo feed, not a signed-in account\./);
  assert.equal(failed.firstChild.getAttribute("role"), "alert");
  assert.doesNotMatch(failed.textContent, /p-gone|\b[45]\d\d\b|Error:|fetch|TypeError/);
  // The state offers both ways forward: leave for the feed or retry in place.
  assert.match(failed.textContent, /Retry/);
  assert.equal(first(failed, "detail-state-feed").textContent, "Return to the Social feed");
  tags(failed, "BUTTON")[0].dispatch("click");
  assert.equal(retried, 1, "a failed load offers a retry");
});

test("an id-less visit is headed by the same not-found words, and offers the feed", () => {
  const container = createElement("div");
  renderPostDetail(container, null, { id: "" });
  // One state, one heading, one chip word. A link with no id, a truncated id
  // and an id nobody posted under are one answer to a reader — the link did not
  // reach a post — so they are not headed three different ways.
  assert.equal(first(container, "empty-title").textContent, "Post not found");
  assert.equal(first(container, "detail-state-label").textContent, "Not found");
  assert.equal(first(container, "detail-state-panel").getAttribute("data-post-state-panel"), "not-found");
  // Only the sentence differs, because only it can say what is true of *this*
  // link: nothing was asked for, as against something that was not there.
  assert.match(container.textContent, /This link did not name a post to open/);
  assert.doesNotMatch(container.textContent, /This post was not found\./);
  // And one next step, named where the problem is explained. This state used to
  // offer none at all, leaving a dead end with nothing pointing out of it.
  const feed = first(container, "detail-state-feed");
  assert.equal(feed.textContent, "Return to the Social feed");
  assert.equal(feed.href, "/social.html");
  assert.equal(byClass(container, "empty-action").length, 1, "one action, not a stack");
  // Nothing to retry: no id was asked for, so a second attempt asks nothing.
  assert.equal(tags(container, "BUTTON").length, 0);
});

test("the loading state is one labelled line in the post's region, not a banner", () => {
  const container = createElement("div");
  renderPostDetail(container, null, { state: "loading", id: "p-image", author: "Mina" });

  assert.equal(container.getAttribute("aria-busy"), "true");
  // One node, announced politely, naming what is being waited for.
  assert.equal(container.children.length, 1, "the wait is a single line, not a stack of furniture");
  const status = first(container, "detail-loading");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.textContent.replace(/\s+/g, " ").trim(), "Loading this post from the Social feed…");
  assert.equal(POST_LOADING_LINE, "Loading this post from the Social feed…");
  // The feed is named, because Social and People say "Loading the Social feed…"
  // for the same fetch and this page narrows that wait rather than renaming it.
  assert.match(POST_LOADING_LINE, /the Social feed/);
  // A real ellipsis, the way "Loading the Social feed…" and "Loading releases…"
  // not three periods pretending to be one.
  assert.ok(POST_LOADING_LINE.endsWith("…") && !POST_LOADING_LINE.includes("..."));

  // Concise: no heading of its own, no state banner, and no placeholder block
  // pretending to be an image the post may not even have.
  assert.equal(tags(container, "H2").length, 0, "the wait must not open a heading");
  assert.equal(byClass(container, "empty-state").length, 0);
  assert.equal(byClass(container, "detail-skeleton").length, 0);
  assert.equal(byClass(container, "skeleton-media").length, 0);
  // Nor is the region left blank, which is the other way to say nothing.
  assert.ok(status.textContent.trim().length > 0, "the region must not be empty while it waits");

  // The spinner is decoration; the sentence is the state.
  assert.equal(first(container, "detail-loading-dot").getAttribute("aria-hidden"), "true");
  assert.equal(first(container, "detail-loading-dot").textContent, "");
  assert.equal(byClass(container, "empty-action-secondary").length, 0, "the standing back link is not repeated here");
});

// A permalink is the one page a visitor can land on with no context, so its h1
// says what the page holds — a post — and who wrote it. The bare display name
// used to read as that person's profile, which is a different page here.
// And with no author to name, it says which surface the page belongs to rather
// than the bare word "Post", which tells a first-time visitor nothing.
test("the loaded page is headed by the post and its author, not by the bare name", () => {
  assert.equal(postPageHeading(post), "Post by Mina Okafor");
  assert.equal(postPageHeading(null), "Post from Social");
  assert.equal(postPageHeading({ ...post, author: "" }), "Post from Social");
  assert.equal(postPageHeading({ ...post, author: "  Mina Okafor  " }), "Post by Mina Okafor");
});

// The heading and the tab name the same thing, so a visitor scanning open tabs
// and a visitor reading the page are not told two different names for one post.
test("the permalink heading matches the phrase in the document title", () => {
  assert.ok(postDetailTitle(post).startsWith(`${postPageHeading(post)} ·`),
    "the tab title opens with the same phrase the h1 shows");
});

test("the document title names the post, the feed, and the product", () => {
  assert.equal(postDetailTitle(post), "Post by Mina Okafor · Social · Shiplog");
  // The tab distinguishes the two unresolved answers the panel distinguishes,
  // so a strip of shared links does not read as one undifferentiated failure.
  assert.equal(postDetailTitle(null), "Post not found · Shiplog");
  assert.equal(postDetailTitle(null, "not-found"), "Post not found · Shiplog");
  assert.equal(postDetailTitle(null, "error"), "Post could not be loaded · Shiplog");
  // A state name never overrides a post that actually loaded.
  assert.equal(postDetailTitle(post, "error"), "Post by Mina Okafor · Social · Shiplog");
});

test("the post page's two routes out sit after the site frame, and name where they go", async () => {
  const html = await readFile(new URL("../src/post.html", import.meta.url), "utf8");

  // The order this page used to get wrong: its exit came before the wordmark,
  // so the one page-specific control on the site preceded the site frame.
  const brand = html.indexOf('class="brand"');
  const nav = html.indexOf('<nav class="site-nav"');
  const exit = html.indexOf('id="post-back"');
  const content = html.indexOf('id="post-detail"');
  assert.ok(brand < nav, "the wordmark precedes the nav");
  assert.ok(nav < exit, "the nav precedes the exits");
  // And the post precedes both of them. A permalink is opened to read one post;
  // the routes onward are what a reader wants after it, not instead of it.
  assert.ok(content < exit, "the post content precedes the exits");

  // Destination in the visible text, not smuggled into an aria-label — and both
  // destinations, because a cold visitor has neither of them behind them.
  assert.match(html, /<a class="detail-back detail-page-back" id="post-back" href="\/social\.html">Open Social to read the whole feed<\/a>/);
  assert.match(html, /<a class="detail-back detail-page-back" id="post-people" href="\/profile\.html">Open People to see this display name's other image posts<\/a>/);
  assert.equal(html.includes("post-back-feed"), false, "the old stacked exit is gone");
  const exits = html.match(/<p class="detail-page-exits">[\s\S]*?<\/p>/)[0];
  assert.doesNotMatch(exits, /aria-label/, "an exit must not depend on aria-label to name its destination");

  // No "Back", and no arrow standing in for one. A permalink opened from a
  // pasted link has nothing behind it, so a return glyph would name a step the
  // visitor never took.
  assert.doesNotMatch(exits, /←|Back to/, "the permalink's routes out point forward, not back");

  // And they are not a phrasing invented here: Social and People point at each
  // other with the same verb, and this page joins that pattern.
  const [social, people] = await Promise.all([
    readFile(new URL("../src/social.html", import.meta.url), "utf8"),
    readFile(new URL("../src/profile.html", import.meta.url), "utf8"),
  ]);
  assert.match(social, /Open People when you want/);
  assert.match(people, /Open Social when you want/);
});

/* --------------------------- where the exits go --------------------------- */

test("both destinations ship as constants, and only the People link's target narrows", () => {
  // The words are fixed. Nothing about a lookup may rewrite them, because they
  // have to read the same before, during and after it.
  assert.deepEqual(POST_EXITS, {
    social: { href: "/social.html", label: "Open Social to read the whole feed" },
    people: { href: "/profile.html", label: "Open People to see this display name's other image posts" },
  });
  // "display name" is the term Social's composer, Social's feed filter and the
  // People picker all use for the thing being chosen. One name per concept.
  assert.match(POST_EXITS.people.label, /display name/);
  // Both name a destination the nav offers: this site has a People page and no
  // page called Profile, so a link here cannot promise one.
  for (const exit of Object.values(POST_EXITS)) assert.match(exit.label, /^Open (Social|People) to /);

  // The loaded post's own author wins, then the ?author= profile.js writes into
  // its tiles.
  assert.equal(postPeopleHref("?id=p-image&from=profile&author=Mina%20Okafor"), "/profile.html?author=Mina%20Okafor");
  assert.equal(postPeopleHref("?id=p-image&author=Someone%20Else", "Mina Okafor"), "/profile.html?author=Mina%20Okafor");

  // No name, a name longer than a display name can be, and a value shaped like
  // an injection all land on the same honest default: People, unfiltered.
  for (const search of ["", "?id=p-image", "?id=p-image&author=", `?author=${"n".repeat(61)}`, "?author=%20%20"]) {
    assert.equal(postPeopleHref(search), POST_EXITS.people.href, `"${search}" must fall back to People`);
  }
});

/* ------------------------- the page's standing frame ---------------------- */

// Word-for-word with the <p> in src/post.html's hero. It is pinned here because
// the whole point of the sentence is that it is standing copy: a reader who
// arrived from a shared link has to be told what Social is before, during, and
// after the post load — including when the post never arrives.
// It is also the single Social definition, repeated word-for-word on the home
// page card and the Social page intro — one sentence, one vocabulary, wherever
// a visitor first meets Social.
const STANDING_SENTENCE =
  "Social is a shared demo feed of short posts about the work the team ships, each with an optional image.";

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
  // Counted over the page's own content, not the whole document: the About
  // Shiplog band below it names every destination of the site in the words the
  // home page's directory uses, and Social's row is this same sentence. What
  // this rule is about is the page repeating it once per panel state.
  const content = html.slice(0, html.indexOf('<footer class="site-footer"'));
  assert.equal(content.split(STANDING_SENTENCE).length - 1, 1, "it is written once, not repeated per state");

  // Short enough to read at a glance, and one sentence rather than a paragraph.
  assert.ok(STANDING_SENTENCE.split(/\s+/).length <= 25, "the standing sentence stays at 25 words or fewer");
  assert.equal(STANDING_SENTENCE.split(/[.!?]/).filter((part) => part.trim()).length, 1, "one sentence, not two");

  // It belongs to the standing frame, which no script rewrites, and it sits
  // outside the panel the fetch replaces — so it survives every state the
  // lookup can land in. Counted inside the region rather than matched against
  // the hero's closing tag, which the post's own region now sits inside.
  const region = html.match(/<div id="post-detail"[\s\S]*?<\/div>/)[0];
  assert.equal(region.includes(STANDING_SENTENCE), false, "the sentence must not sit in #post-detail");

  // And it reads after the post rather than before it. What Social is only
  // becomes a reader's question once they have read the post they came for.
  assert.ok(html.indexOf('id="post-detail"') < html.indexOf(STANDING_SENTENCE), "the post precedes the context about Social");
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

    assert.match(main.textContent, /Social is a shared demo feed/, `the sentence is gone in the ${name} state`);
    if (["missing", "error"].includes(name)) {
      assert.match(container.textContent, /not a signed-in account/, `the ${name} state must set demo context`);
    }
  }
});

/* --------------------- the state the page opens holding ------------------- */

// A shared link is opened cold: the markup paints before post-page.js is
// fetched, parsed and run. The region used to ship empty, so the first thing a
// visitor saw was a heading, a sentence, and a hole. The wait now ships with
// the page, in the words the script would have written anyway.
test("the shipped markup opens in the loading state, saying so in words", async () => {
  const html = await postPageHtml();
  const region = html.match(/<div id="post-detail"[\s\S]*?<\/div>/)[0];

  assert.match(region, /data-post-state="loading"/, "the region names the state it opens in");
  assert.match(region, /aria-busy="true"/, "and reports that it is still working");
  assert.equal((region.match(/class="detail-loading /g) ?? []).length, 1, "one wait line, not a stack");
  // The shipped wait is a state panel like the three the script can draw, so a
  // count of panels is one before any script has run, not zero.
  assert.equal((region.match(/data-post-state-panel="loading"/g) ?? []).length, 1);
  assert.ok(region.includes(`>${POST_LOADING_LINE}</span>`), "the shipped line is the rendered line");
  assert.match(region, /role="status"/, "so assistive tech announces it without stealing focus");
  assert.match(region, /class="detail-loading-dot" aria-hidden="true"/, "the spinner is decoration");

  // One spelling of one sentence. Two would flash a rewrite when the script ran.
  assert.equal(html.split(POST_LOADING_LINE).length - 1, 1);
  // The wait is a line, not a second page: no heading, no chip, no placeholder
  // block standing in for an image this post may not have.
  assert.doesNotMatch(region, /<h[1-6]|detail-state-chip|skeleton-media|empty-state/);
  // And it carries nothing to tab to, so the standing exit stays the first stop
  // a keyboard reader reaches after the site frame.
  assert.doesNotMatch(region, /<a |<button|tabindex/);
  // Nothing about the resolved states ships in the markup: they are what the
  // script writes *instead of* this, never alongside it.
  assert.doesNotMatch(region, /Post not found|Post could not be loaded|Choose a post|Return to the Social feed/);
});

// One value, not two toggled nodes. Two nodes is how a wait survives underneath
// an unavailable-post panel; a single attribute cannot hold both states.
// The lookup says what it did; the post decides the rest. There is no way to
// ask for "error" and be handed a post, or to claim a load with nothing loaded.
test("four states, and the post itself resolves which of them a render is", () => {
  assert.deepEqual(POST_STATES, ["loading", "loaded", "not-found", "error"]);

  assert.equal(resolvePostState(null, "loading"), "loading");
  assert.equal(resolvePostState(post, "loading"), "loading", "a post in hand does not end a wait early");
  assert.equal(resolvePostState(post, "ready"), "loaded");
  assert.equal(resolvePostState(post, "error"), "loaded", "a post that arrived is not a failure");
  // A lookup that finished empty-handed is not-found; only one that could not
  // finish is error. That is the whole difference between the two panels.
  assert.equal(resolvePostState(null, "ready"), "not-found");
  assert.equal(resolvePostState(null, "not-found"), "not-found");
  assert.equal(resolvePostState(null, "error"), "error");
  assert.equal(resolvePostState(null), "not-found", "the default is a lookup that finished");

  for (const state of POST_STATES) {
    assert.ok(POST_STATES.includes(resolvePostState(state === "loaded" ? post : null, state)));
  }
});

test("the post region holds exactly one state, and names it on one attribute", () => {
  const expected = {
    loading: "loading",
    loaded: "loaded",
    missing: "not-found",
    error: "error",
    // Not a fifth state: no id asked for is a post that cannot be found, worded
    // for the one case where the reader never named one.
    "id-less": "not-found",
  };

  for (const [name, value, options] of PANEL_STATES) {
    const container = createElement("div");
    // Start from what src/post.html ships, so each render has to move the state
    // off "loading" rather than inherit it.
    container.setAttribute("data-post-state", "loading");
    container.append(createElement("p"));

    renderPostDetail(container, value, options);

    assert.equal(container.dataset.postState, expected[name], `the ${name} state is named on the region`);
    // One panel in the DOM, and it is the active one. Counted rather than
    // asserted absent: an inactive state must have no node at all, not a node
    // pushed off screen, because a hidden heading is still a heading.
    const panels = byClass(container, "detail-state-panel");
    assert.equal(panels.length, 1, `the ${name} state renders ${panels.length} panels, not one`);
    assert.equal(panels[0].getAttribute("data-post-state-panel"), expected[name]);
    const waiting = byClass(container, "detail-loading").length;
    const explained = byClass(container, "detail-state-message").length;
    const shown = byClass(container, "detail-post").length;
    assert.equal(waiting + explained + shown, 1, `the ${name} state renders more than one thing at once`);
    assert.equal(waiting, name === "loading" ? 1 : 0, `the ${name} state's wait line`);
    assert.equal(explained, ["missing", "error", "id-less"].includes(name) ? 1 : 0, `the ${name} state's explanation`);
    assert.equal(container.getAttribute("aria-busy"), name === "loading" ? "true" : "false");
    // The wait never survives into a resolved state, whatever the region held
    // before: the shipped line and the unavailable panel are never both on screen.
    if (name !== "loading") assert.doesNotMatch(container.textContent, /Loading this post/);
  }
});

test("the standing exits remain while unavailable states add a clear feed action", async () => {
  const html = await postPageHtml();
  assert.equal([...html.matchAll(/id="post-back"/g)].length, 1, "one Social exit in the markup");
  assert.equal([...html.matchAll(/id="post-people"/g)].length, 1, "one People exit in the markup");
  assert.equal([...html.matchAll(/class="detail-back detail-page-back"/g)].length, 2, "the pair, and only the pair");
  assert.equal([...html.matchAll(/<a [^>]*>Open (Social|People) to /g)].length, 2, "one label each, not a stack");

  for (const [name, value, options] of PANEL_STATES) {
    const container = createElement("div");
    renderPostDetail(container, value, options);
    const backish = tags(container, "A").filter((link) => /Back to|Return to/.test(link.textContent));
    // Every state that resolved without a post carries the feed action, the
    // id-less one included: it is as much a dead end as a stale id is.
    assert.equal(backish.length, ["missing", "error", "id-less"].includes(name) ? 1 : 0);
  }
});

test("only unavailable requested-post states render a feed action", () => {
  for (const [name, value, options] of PANEL_STATES) {
    const container = createElement("div");
    renderPostDetail(container, value, options);
    assert.equal(
      byClass(container, "empty-action-secondary").length,
      ["missing", "error", "id-less"].includes(name) ? 1 : 0,
      `the ${name} state has the expected feed action`,
    );
    // Retry is the one action a state still owns, because no standing link can
    // re-run a failed fetch.
    const buttons = tags(container, "BUTTON");
    assert.equal(buttons.length, name === "error" ? 1 : 0, `the ${name} state renders unexpected controls`);
  }
});

/* --------------- states a reader can tell apart with colour off ----------- */

test("loading and unavailable states say what happened in words", () => {
  const render = (value, options) => {
    const container = createElement("div");
    renderPostDetail(container, value, options);
    return container;
  };
  const loading = render(null, { state: "loading", id: "p-gone" });
  const missing = render(null, { state: "ready", id: "p-gone" });
  const failed = render(null, { state: "error", id: "p-gone", onRetry: () => {} });

  // The wait has no heading of its own — it is a status line — so it is read
  // by its sentence, and the two resolved states by their headings.
  const titles = [
    first(loading, "detail-loading").textContent.trim(),
    first(missing, "empty-title").textContent,
    first(failed, "empty-title").textContent,
  ];
  assert.deepEqual(titles, ["Loading this post from the Social feed…", "Post not found", "Post could not be loaded"]);

  // The difference has to survive with colour, icons and badges removed, so it
  // is asserted on the words themselves — no class name is read here.
  const words = (container) => new Set(container.textContent.toLowerCase().match(/[a-z’']+/g));
  const missingWords = words(missing);
  const failedWords = words(failed);
  const only = (a, b) => [...a].filter((word) => !b.has(word));
  assert.ok(only(missingWords, failedWords).includes("removed"), "the missing state may say the post was removed");
  assert.ok(only(failedWords, missingWords).includes("reached"), "the failed state must name the feed it could not reach");

  // Neither state makes the temporary failure sound like confirmed deletion.
  assert.doesNotMatch(missing.textContent, /couldn’t|failed|try again/i);
  assert.doesNotMatch(failed.textContent, /removed|incomplete|may have been/i);
});

test("each state's chip carries a word, and a wash that only agrees with it", async () => {
  const chipOf = (value, options) => {
    const container = createElement("div");
    renderPostDetail(container, value, options);
    return first(container, "detail-state-chip");
  };

  const chips = [
    ["not-found", chipOf(null, { state: "ready", id: "p-gone" }), "missing", "Not found"],
    ["error", chipOf(null, { state: "error", id: "p-gone" }), "error", "Unreachable"],
    // A link that named no post is not a third answer. It used to be chipped
    // "Post status" in a neutral wash — a label naming the field rather than
    // the state, on the one page where a reader most needs to be told what
    // happened. It carries the not-found word now, like every other link that
    // did not reach a post.
    ["id-less", chipOf(null, { state: "ready", id: "" }), "missing", "Not found"],
  ];

  for (const [name, chip, tone, text] of chips) {
    // Text plus colour, never colour alone: with the stylesheet gone the chip
    // still reads, and the wash class only names the tone it is painted in.
    assert.equal(chip.textContent, text, `the ${name} chip must name its state in words`);
    assert.ok(chip.classes.includes(`detail-state-chip-${tone}`), `the ${name} chip carries its tone class`);
  }
  // Two answers, two words: a post that is gone and a feed that could not be
  // reached are different facts and must not share a label. A link that named
  // no post at all is the first of those two, not a third.
  assert.equal(new Set(chips.map(([, chip]) => chip.textContent)).size, 2);

  // A resolved lookup is a dynamic signal, so every one of these is a filled
  // wash. The outline chip is this site's mark for a standing classification,
  // and nothing on this page is one.
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  for (const tone of ["missing", "error"]) {
    const rule = css.match(new RegExp(`^\\.detail-state-chip-${tone} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
    assert.match(rule, /background:#/, `the ${tone} chip needs a filled wash, not a bare outline`);
    assert.match(rule, /color:#/, `the ${tone} chip needs its own ink`);
  }
  // The wait is not chipped at all: it is a sentence, and a colour would be the
  // only thing a chip added to it.
  const waiting = createElement("div");
  renderPostDetail(waiting, null, { state: "loading", id: "p-image" });
  assert.equal(byClass(waiting, "detail-state-chip").length, 0);
});

test("a missing post reaches the feed even when the standing exit does not", () => {
  // Arrived from a profile: the one exit goes back to that profile, so the panel
  // is the only thing that can offer the feed the missing post belonged to.
  const fromProfile = createElement("div");
  renderPostDetail(fromProfile, null, { id: "p-gone", returnHref: "/profile.html?author=Mina%20Okafor" });
  const feed = first(fromProfile, "detail-state-feed");
  assert.equal(feed.tagName, "A");
  assert.equal(feed.href, "/social.html");
  assert.equal(feed.textContent, "Return to the Social feed");
  // It comes after the words that explain it, so it is not tabbed to first.
  assert.equal(fromProfile.firstChild.lastChild, feed);

  // The unavailable state owns this next step even when the standing exit also
  // points to Social.
  for (const returnHref of ["/social.html", undefined]) {
    const container = createElement("div");
    renderPostDetail(container, null, { id: "p-gone", returnHref });
    assert.equal(byClass(container, "detail-state-feed").length, 1);
  }
  // A post that failed to load offers both a feed return and retry.
  const failed = createElement("div");
  renderPostDetail(failed, null, { state: "error", id: "p-gone", returnHref: "/profile.html" });
  assert.equal(byClass(failed, "detail-state-feed").length, 1);
});

/* ------------------------- extremes stay in the page ---------------------- */

// No viewport-level harness exists in this repo — `node --test` parses markup
// and CSS text, it does not lay anything out — so the assertion is that the
// constraining rules are applied to the elements that carry the extreme
// content. A real 390px overflow check would need a browser runner.
test("a 1,000-character caption and an extreme image stay inside the page's column", async () => {
  const caption = "shipped ".repeat(120) + "x".repeat(200); // >1,000 chars, incl. one unbreakable run
  assert.ok(caption.length > 1000);

  for (const image of [
    { src: "/media/focus-ring.svg", alt: "", width: 320, height: 9000 },
    { src: "/media/focus-ring.svg", alt: "", width: 9000, height: 320 },
  ]) {
    const container = createElement("div");
    renderPostDetail(container, { ...post, caption, image });

    // No inline width, height or style may be written from post data: the cap
    // belongs to the stylesheet, where one rule covers every post.
    const img = tags(container, "IMG")[0];
    assert.equal(img.classes.includes("detail-image"), true);
    assert.equal(img.getAttribute("style"), null);
    assert.equal(first(container, "detail-post").classes.includes("detail-post"), true);
    assert.equal(first(container, "detail-caption").classes.includes("detail-caption"), true);
  }

  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const rule = (selector) => css.match(new RegExp(`^\\${selector} \\{([^}]*)\\}`, "m"))?.[1] ?? "";

  // The image: bounded both ways, with width and height left to the browser so
  // the aspect ratio survives either cap.
  const image = rule(".detail-image");
  assert.match(image, /max-width:100%/, "a wide image must not exceed its column");
  assert.match(image, /max-height:/, "a tall image needs a height cap");
  assert.match(image, /width:auto/, "a fixed width would distort the capped image");
  assert.match(image, /height:auto/);
  assert.doesNotMatch(image, /min-width|[^-]width:\s*\d/, "nothing may force the image wider than the column");

  // The caption: a 1,000-character run with no spaces wraps rather than pushing
  // a horizontal scrollbar onto a 390px phone.
  assert.match(rule(".detail-caption"), /overflow-wrap:anywhere/);
  // And the column itself is the page's existing container, not a new max-width.
  assert.match(rule(".detail-post"), /min-width:0/);
  assert.match(rule(".detail-media"), /overflow:hidden/);
  assert.match(rule(".detail-figure"), /min-width:0/);

  // The same caption on a text-only post lands in .detail-body instead, which
  // needs the same treatment — this is the path a caption over 1,000 characters
  // takes when the post carries no image, and it is the one easiest to forget.
  const textOnly = createElement("div");
  renderPostDetail(textOnly, { ...post, caption, image: undefined });
  const body = first(textOnly, "detail-body");
  assert.equal(body.textContent.length, caption.length, "the caption is shown whole, not truncated");
  assert.equal(body.getAttribute("style"), null, "no inline width may be written from post data");
  assert.match(rule(".detail-body"), /overflow-wrap:anywhere/);
  // Neither the caption nor the body may clip what it cannot fit: wrapping is
  // the answer at 390px, not an ellipsis or a hidden overflow.
  for (const selector of [".detail-caption", ".detail-body"]) {
    assert.doesNotMatch(rule(selector), /text-overflow|overflow:hidden|white-space:nowrap|max-height/,
      `${selector} must wrap a long caption rather than cut it off`);
  }
  // At phone width the page column itself is what keeps the line inside the
  // viewport, and it is a percentage of it rather than a fixed width.
  const phone = css.match(/@media\(max-width:520px\) \{ (main,\.page\{[^}]*\})/)?.[1] ?? "";
  assert.match(phone, /width:calc\(100% - 24px\)/, "the page column must stay inside a 390px viewport");
});

test("the post page's nav lists the profile destination once", async () => {
  const html = await readFile(new URL("../src/post.html", import.meta.url), "utf8");
  const nav = html.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)[0];
  assert.equal([...nav.matchAll(/>People</g)].length, 1, "People appears twice in the post page nav");
});
