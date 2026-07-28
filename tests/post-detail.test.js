// The single-post view a profile tile navigates to: resolution plus the four
// states it must keep apart (loading, found, missing, failed).

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { byClass, createElement, first, ids, installDocument, tags } from "./support/dom.js";

installDocument();

const {
  DEFAULT_POST_RETURN,
  findPostById,
  postDetailTitle,
  postImageAlt,
  postPageHeading,
  postReturnContext,
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

  // The poster's name is the page's h1, written into the hero above this panel
  // (src/post-page.js), so the article opens with the timestamp. What must hold
  // here is the rest of the sequence, and that the caption belongs to the image.
  assert.equal(postPageHeading(post), "Mina Okafor");

  const time = tags(article, "TIME")[0];
  assert.equal(time.textContent.length > 0, true, "the timestamp needs human-readable text");
  assert.equal(time.dateTime, "2026-07-14T09:00:00.000Z", "and a machine-readable datetime");

  const sequence = article.children.map((child) => child.tagName);
  assert.deepEqual(sequence.slice(0, 2), ["TIME", "FIGURE"], "the timestamp precedes the image");

  const figure = tags(article, "FIGURE")[0];
  assert.deepEqual(
    figure.children.map((child) => child.tagName),
    ["DIV", "FIGCAPTION"],
    "the caption is the image's figcaption, and follows it",
  );
  assert.ok(tags(figure, "IMG").length === 1, "the image sits inside the figure");

  // The author is named once, by the page heading. A second link to the same
  // profile would sit between the exit and the image in the tab order.
  assert.equal(byClass(article, "post-author").length, 0);
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

test("the loaded page is headed by the poster's display name, not the bare word Post", () => {
  assert.equal(postPageHeading(post), "Mina Okafor");
  assert.equal(postPageHeading(null), "Post");
  assert.equal(postPageHeading({ ...post, author: "" }), "Post");
  assert.equal(postPageHeading({ ...post, author: "  Mina Okafor  " }), "Mina Okafor");
});

test("the document title names the post, the feed, and the product", () => {
  assert.equal(postDetailTitle(post), "Post by Mina Okafor · Social · Shiplog");
  assert.equal(postDetailTitle(null), "Post not found · Shiplog");
  assert.equal(postDetailTitle(null, "error"), "Post unavailable · Shiplog");
});

test("the post page's exit sits after the site frame, and names where it goes", async () => {
  const html = await readFile(new URL("../src/post.html", import.meta.url), "utf8");

  // The order this page used to get wrong: its back link came before the
  // wordmark, so the one page-specific control on the site preceded the site
  // frame. src/decision.html puts "← Back to Decisions" inside the content
  // region, after the header, and this page now matches it.
  const brand = html.indexOf('class="brand"');
  const nav = html.indexOf('<nav class="site-nav"');
  const exit = html.indexOf('id="post-back"');
  const content = html.indexOf('id="post-detail"');
  assert.ok(brand < nav, "the wordmark precedes the nav");
  assert.ok(nav < exit, "the nav precedes the exit");
  assert.ok(exit < content, "the exit precedes the post content");

  // Destination in the visible text, not smuggled into an aria-label. The feed
  // is what ships, because a link with no provenance came from the feed as far
  // as this page can honestly tell.
  assert.match(html, /<a class="detail-back detail-page-back" id="post-back" href="\/social\.html">← Back to Social<\/a>/);
  assert.equal(html.includes("post-back-feed"), false, "the second, stacked exit is gone");
  const exits = html.match(/<p class="detail-page-exits">[\s\S]*?<\/p>/)[0];
  assert.doesNotMatch(exits, /aria-label/, "an exit must not depend on aria-label to name its destination");

  // The arrow-plus-"Back to <destination>" convention comes from the decision
  // page; this page is not allowed to invent a second phrasing for the same job.
  const decision = await readFile(new URL("../src/decision.html", import.meta.url), "utf8");
  assert.match(decision, /class="detail-back" href="\/">← Back to Decisions<\/a>/);
});

/* ---------------------------- where "back" goes --------------------------- */

test("provenance decides the one exit, and anything unknown means the feed", () => {
  assert.deepEqual(postReturnContext("?id=p-image&from=profile&author=Mina%20Okafor"), {
    href: "/profile.html?author=Mina%20Okafor",
    label: "← Back to Profile",
  });
  // Came from a profile, but with no usable name: still the profile, generally.
  assert.deepEqual(postReturnContext("?id=p-image&from=profile"), {
    href: "/profile.html",
    label: "← Back to Profile",
  });
  assert.equal(postReturnContext(`?from=profile&author=${"n".repeat(61)}`).href, "/profile.html");

  // No provenance, a provenance naming somewhere this page does not know, and a
  // value shaped like an injection all land on the same honest default.
  for (const search of ["", "?id=p-image", "?id=p-image&from=", "?from=social", "?from=PROFILE", "?from=javascript:alert(1)"]) {
    assert.deepEqual(postReturnContext(search), DEFAULT_POST_RETURN, `"${search}" must fall back to the feed`);
  }
  assert.deepEqual(DEFAULT_POST_RETURN, { href: "/social.html", label: "← Back to Social" });

  // The label reads the same in both directions and says only what it does.
  for (const search of ["?from=profile", ""]) assert.match(postReturnContext(search).label, /^← Back to (Profile|Social)$/);
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

    assert.match(main.textContent, /Social is a shared demo feed/, `the sentence is gone in the ${name} state`);
    // The panel keeps its own copy exactly as shipped and never restates this.
    assert.doesNotMatch(container.textContent, /Social is a shared demo feed/, `the ${name} panel restates the sentence`);
  }
});

test("exactly one standing exit renders on the post page, in every state", async () => {
  const html = await postPageHtml();
  assert.equal([...html.matchAll(/id="post-back"/g)].length, 1, "one standing exit in the markup");
  assert.equal([...html.matchAll(/class="detail-back detail-page-back"/g)].length, 1, "and only one");
  assert.equal([...html.matchAll(/<a [^>]*>← Back to /g)].length, 1, "one back label ships, not two stacked ones");

  // No state may add a second one, whatever it renders: the count above is the
  // whole page's count only if the panel contributes nothing to it.
  for (const [name, value, options] of PANEL_STATES) {
    const container = createElement("div");
    renderPostDetail(container, value, options);
    const backish = tags(container, "A").filter((link) => /Back to|Return to/.test(link.textContent));
    assert.equal(backish.length, 0, `the ${name} state renders its own back link`);
    const toExits = tags(container, "A")
      .filter((link) => ["/social.html", "/profile.html"].some((href) => String(link.href ?? "").startsWith(href)));
    assert.equal(toExits.length, 0, `the ${name} state links to an exit destination itself`);
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

/* --------------- states a reader can tell apart with colour off ----------- */

test("loading, not found and failed each say a different thing, in words", () => {
  const render = (value, options) => {
    const container = createElement("div");
    renderPostDetail(container, value, options);
    return container;
  };
  const loading = render(null, { state: "loading", id: "p-gone" });
  const missing = render(null, { state: "ready", id: "p-gone" });
  const failed = render(null, { state: "error", id: "p-gone", onRetry: () => {} });

  const title = (container) => first(container, "empty-title").textContent;
  const titles = [title(loading), title(missing), title(failed)];
  assert.deepEqual(titles, ["Loading post", "Post not found", "Post couldn’t be loaded"]);
  assert.equal(new Set(titles).size, 3, "two states share a title");

  // The difference has to survive with colour, icons and badges removed, so it
  // is asserted on the words themselves — no class name is read here.
  const words = (container) => new Set(container.textContent.toLowerCase().match(/[a-z’']+/g));
  const missingWords = words(missing);
  const failedWords = words(failed);
  const only = (a, b) => [...a].filter((word) => !b.has(word));
  assert.ok(only(missingWords, failedWords).includes("removed"), "the missing state must say the post is gone");
  assert.ok(only(failedWords, missingWords).some((word) => ["couldn’t", "reach"].includes(word)),
    "the failed state must describe a failure, not an absence");

  // And in the other direction: neither state may be readable as the other.
  assert.doesNotMatch(missing.textContent, /couldn’t|failed|unavailable|try again/i);
  assert.doesNotMatch(failed.textContent, /removed|incomplete|may have been/i);
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
});

test("the post page's nav lists Profile once", async () => {
  const html = await readFile(new URL("../src/post.html", import.meta.url), "utf8");
  const nav = html.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)[0];
  assert.equal([...nav.matchAll(/>Profile</g)].length, 1, "Profile appears twice in the post page nav");
});
