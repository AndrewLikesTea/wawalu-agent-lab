import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createPost,
  sortPostsNewestFirst,
  counterState,
  nextFocusIndex,
  filterPosts,
  normalizeApiPosts,
  normalizeSocialApiPosts,
  normalizeImage,
  columnCount,
  feedSummarySentence,
  feedHeading,
  DEFAULT_FEED_HEADING,
  AUTHOR_TERM,
  MAX_POST_LENGTH,
  MAX_AUTHOR_LENGTH,
  MAX_IMAGE_ALT_LENGTH,
  DEFAULT_AUTHOR,
  mountSocialFeed,
} from "../src/social.js";
import { loadPage, textOf } from "./support/browser.js";

const sample = [
  { id: "p-old", author: "Kai",  body: "first",  createdAt: "2026-07-10T00:00:00.000Z" },
  { id: "p-new", author: "Ari",  body: "latest", createdAt: "2026-07-14T00:00:00.000Z" },
  { id: "p-mid", author: "Mina", body: "middle", createdAt: "2026-07-12T00:00:00.000Z" },
];

const ids = (posts) => posts.map((post) => post.id);

// Tag-balance check for the hand-authored SVG assets. A mismatched or unclosed
// tag makes a browser drop the image, which would silently demote every seeded
// card to its "Image unavailable" state — a failure unit tests would otherwise
// never see.
function unbalancedTag(markup) {
  const stack = [];
  for (const [, closing, opening, , selfClosing] of markup.matchAll(/<(?:\/([\w:-]+)|([\w:-]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?))>/g)) {
    if (closing) {
      if (stack.pop() !== closing) return `unbalanced </${closing}>`;
    } else if (!selfClosing) {
      stack.push(opening);
    }
  }
  return stack.length ? `unclosed <${stack.at(-1)}>` : null;
}

test("creates a normalized post with deterministic metadata", () => {
  const post = createPost(
    { author: "  Mina  ", body: "  Shipped it!  " },
    { id: "post-1", createdAt: "2026-07-14T12:00:00.000Z" },
  );
  assert.deepEqual(post, {
    id: "post-1",
    author: "Mina",
    body: "Shipped it!",
    createdAt: "2026-07-14T12:00:00.000Z",
  });
});

test("author is optional and falls back to the default byline", () => {
  const post = createPost({ body: "no name given" }, { id: "p", createdAt: "2026-07-14T00:00:00.000Z" });
  assert.equal(post.author, DEFAULT_AUTHOR);
  const blank = createPost({ author: "   ", body: "whitespace name" }, { id: "p2", createdAt: "2026-07-14T00:00:00.000Z" });
  assert.equal(blank.author, DEFAULT_AUTHOR);
});

test("rejects an empty or over-budget body", () => {
  assert.throws(() => createPost({ author: "Kai", body: "   " }), TypeError);
  assert.throws(() => createPost({ body: "x".repeat(MAX_POST_LENGTH + 1) }), TypeError);
  // Exactly at the limit is allowed.
  assert.doesNotThrow(() => createPost({ body: "x".repeat(MAX_POST_LENGTH) }, { id: "p", createdAt: "2026-07-14T00:00:00.000Z" }));
});

test("rejects an over-budget author", () => {
  assert.throws(() => createPost({ author: "x".repeat(MAX_AUTHOR_LENGTH + 1), body: "hello" }), TypeError);
});

test("orders posts reverse-chronologically without mutating the input", () => {
  const before = ids(sample);
  assert.deepEqual(ids(sortPostsNewestFirst(sample)), ["p-new", "p-mid", "p-old"]);
  assert.deepEqual(ids(sample), before);
});

test("counterState reports remaining budget and warning thresholds", () => {
  const empty = counterState("");
  assert.equal(empty.remaining, MAX_POST_LENGTH);
  assert.equal(empty.empty, true);
  assert.equal(empty.over, false);

  const near = counterState("x".repeat(MAX_POST_LENGTH - 5));
  assert.equal(near.remaining, 5);
  assert.equal(near.near, true);
  assert.equal(near.over, false);

  const over = counterState("x".repeat(MAX_POST_LENGTH + 3));
  assert.equal(over.remaining, -3);
  assert.equal(over.over, true);
  assert.equal(over.near, false);
});

test("nextFocusIndex moves within bounds and clamps; Enter is not a nav key", () => {
  assert.equal(nextFocusIndex(0, "ArrowDown", 3), 1);
  assert.equal(nextFocusIndex(2, "ArrowDown", 3), 2); // clamps at last
  assert.equal(nextFocusIndex(1, "ArrowUp", 3), 0);
  assert.equal(nextFocusIndex(0, "ArrowUp", 3), 0); // clamps at first
  assert.equal(nextFocusIndex(-1, "ArrowDown", 3), 0); // nothing focused yet
  assert.equal(nextFocusIndex(1, "Home", 3), 0);
  assert.equal(nextFocusIndex(1, "End", 3), 2);
  assert.equal(nextFocusIndex(1, "Enter", 3), 1); // cards are not interactive; Enter is a no-op
  assert.equal(nextFocusIndex(0, "ArrowDown", 0), -1); // empty list
});

test("arrow keys walk the grid by card and by row", () => {
  // 5 cards over 2 columns: [0 1 / 2 3 / 4]
  assert.equal(nextFocusIndex(0, "ArrowRight", 5, 2), 1);
  assert.equal(nextFocusIndex(1, "ArrowLeft", 5, 2), 0);
  assert.equal(nextFocusIndex(0, "ArrowDown", 5, 2), 2); // down a whole row
  assert.equal(nextFocusIndex(3, "ArrowUp", 5, 2), 1);
  assert.equal(nextFocusIndex(3, "ArrowDown", 5, 2), 4); // clamps to the last card
  assert.equal(nextFocusIndex(1, "ArrowUp", 5, 2), 1); // already on the top row
  assert.equal(nextFocusIndex(4, "ArrowRight", 5, 2), 4); // clamps at the end
  assert.equal(nextFocusIndex(-1, "ArrowRight", 5, 2), 0);
  assert.equal(nextFocusIndex(0, "ArrowDown", 0, 3), -1);
  // A degenerate column count must not stall navigation.
  assert.equal(nextFocusIndex(0, "ArrowDown", 3, 0), 1);
});

test("columnCount reads the grid width off the laid-out rows", () => {
  assert.equal(columnCount([0, 0, 0, 320, 320, 640]), 3);
  assert.equal(columnCount([0, 210, 420]), 1); // single column, one card per row
  assert.equal(columnCount([0, 0]), 2);
  assert.equal(columnCount([]), 0);
  assert.equal(columnCount(null), 0);
});

test("normalizeImage accepts same-origin assets and rejects everything else", () => {
  assert.deepEqual(normalizeImage({ src: "/media/focus-ring.svg", alt: "  A blue ring  ", width: 1200, height: 900 }), {
    src: "/media/focus-ring.svg",
    alt: "A blue ring",
    width: 1200,
    height: 900,
  });
  // Alt is optional; the caption describes the image when it is absent.
  assert.deepEqual(normalizeImage({ src: "/media/a.png" }), { src: "/media/a.png", alt: "" });
  assert.equal(normalizeImage({ src: "/media/a.png", alt: "x".repeat(MAX_IMAGE_ALT_LENGTH + 40) }).alt.length, MAX_IMAGE_ALT_LENGTH);

  // Dimensions are only kept as a usable pair, and only when sane.
  assert.equal("width" in normalizeImage({ src: "/media/a.png", width: 800 }), false);
  assert.equal("height" in normalizeImage({ src: "/media/a.png", width: 0, height: 900 }), false);
  assert.equal("width" in normalizeImage({ src: "/media/a.png", width: 12.5, height: 900 }), false);

  for (const src of [
    "https://cdn.example.com/a.png", // off-origin: blocked by img-src 'self'
    "//cdn.example.com/a.png", // protocol-relative
    "data:image/svg+xml,<svg/>", // inline payload
    "javascript:alert(1)",
    "media/a.png", // not root-relative
    "/media/../../etc/passwd",
    "/media/a.png?track=1", // query string is not part of the asset alphabet
    "/media/a b.png",
    "",
    "   ",
  ]) {
    assert.equal(normalizeImage({ src }), null, `expected ${JSON.stringify(src)} to be rejected`);
  }
  assert.equal(normalizeImage(null), null);
  assert.equal(normalizeImage({ src: 42 }), null);
});

test("filters posts by display name and common time ranges", () => {
  const now = Date.parse("2026-07-14T12:00:00.000Z");
  const posts = [
    { id: "recent-mina", author: "Mina", body: "now", createdAt: "2026-07-14T11:30:00.000Z" },
    { id: "older-mina", author: "Mina", body: "yesterday", createdAt: "2026-07-13T10:00:00.000Z" },
    { id: "recent-kai", author: "Kai", body: "today", createdAt: "2026-07-14T11:00:00.000Z" },
  ];
  assert.deepEqual(ids(filterPosts(posts, { author: "Mina", range: "all", now })), ["recent-mina", "older-mina"]);
  assert.deepEqual(ids(filterPosts(posts, { author: "all", range: "hour", now })), ["recent-mina", "recent-kai"]);
  assert.deepEqual(ids(filterPosts(posts, { author: "Mina", range: "day", now })), ["recent-mina"]);
});

test("normalizes valid API posts and drops malformed records", () => {
  const posts = normalizeApiPosts({ posts: [
    { id: "api-1", author_id: "11111111-1111-4111-8111-111111111111", agent_name: "Priya", title: "Shipped", content: "Keyboard flow is live.", created_at: "2026-07-14T11:00:00.000Z" },
    { id: "bad", author_id: "agent", agent_name: "Priya", title: "", content: "missing title", created_at: "2026-07-14T11:00:00.000Z" },
  ] });
  assert.deepEqual(posts, [{
    id: "api-1",
    author: "Priya",
    title: "Shipped",
    body: "Keyboard flow is live.",
    createdAt: "2026-07-14T11:00:00.000Z",
  }]);
  assert.deepEqual(normalizeApiPosts(null), []);
});

test("normalizes durable social API posts and drops malformed records", () => {
  assert.deepEqual(normalizeSocialApiPosts({ posts: [
    { id: "social-1", author: "Priya", content: "Shipped.", timestamp: "2026-07-18T12:00:00Z", source: "agent-orchestrator" },
    { id: "bad", author: "Priya", content: "", timestamp: "2026-07-18T12:00:00Z", source: "agent-orchestrator" },
  ] }), [{ id: "social-1", author: "Priya", body: "Shipped.", createdAt: "2026-07-18T12:00:00Z", source: "agent-orchestrator" }]);
});

test("carries image posts through the API normalizer in either field shape", () => {
  const base = { id: "social-1", author: "Priya", content: "Shipped.", timestamp: "2026-07-18T12:00:00Z", source: "agent-orchestrator" };
  const image = { src: "/media/focus-ring.svg", alt: "A blue focus ring", width: 1200, height: 900 };

  const [nested] = normalizeSocialApiPosts({ posts: [{ ...base, image }] });
  assert.deepEqual(nested.image, image);

  // The flat column shape the durable API would most plausibly grow.
  const [flat] = normalizeSocialApiPosts({ posts: [{
    ...base,
    image_url: "/media/release-timeline.svg",
    image_alt: "A rising bar chart",
    image_width: 1200,
    image_height: 900,
  }] });
  assert.deepEqual(flat.image, { src: "/media/release-timeline.svg", alt: "A rising bar chart", width: 1200, height: 900 });

  // A text-only post stays text-only — no empty image key.
  assert.equal("image" in normalizeSocialApiPosts({ posts: [base] })[0], false);
});

test("a rejected image drops the image, never the post", () => {
  const posts = normalizeSocialApiPosts({ posts: [{
    id: "social-2",
    author: "Priya",
    content: "The caption still has to survive.",
    timestamp: "2026-07-18T12:00:00Z",
    source: "agent-orchestrator",
    image: { src: "https://cdn.example.com/tracker.gif", alt: "off-origin" },
  }] });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body, "The caption still has to survive.");
  assert.equal("image" in posts[0], false);
});

test("social page is wired, labeled, and linked from the other pages", async () => {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [home, releases, page, wiring, component, styles] = await Promise.all([
    read("src/index.html"),
    read("src/releases.html"),
    read("src/social.html"),
    read("src/social-page.js"),
    read("src/social.js"),
    read("src/styles.css"),
  ]);

  // Reachable from the existing navigation (agents.html is out of scope/forbidden).
  assert.match(home, /href="\/social\.html"/);
  assert.match(releases, /href="\/social\.html"/);

  assert.match(page, /<title>Social · Shiplog<\/title>/);
  assert.match(page, /id="post-feed"/);
  assert.match(page, /id="post-name-filter"/);
  assert.match(page, /id="post-time-filter"/);
  assert.match(page, /id="feed-announcer"[^>]*aria-live="polite"/);
  assert.match(wiring, /\/api\/social-posts\?limit=100/);
  assert.match(wiring, /method: "POST"/);
  assert.match(wiring, /connection\.dataset\.state = "live"/);
  assert.match(wiring, /connection\.dataset\.state = "degraded"/);
  assert.match(styles, /\.feed-connection\[data-state="degraded"\] \.live-dot \{[^}]*border-radius:1px;[^}]*transform:rotate\(45deg\)/,
    "an unavailable live service changes the connection marker's shape, not only its colour");
  assert.doesNotMatch(wiring, /localStorage/);
  assert.match(page, /src="\/social-page\.js"/);
  // Compose inputs carry explicit labels + describedby wiring.
  assert.match(page, /<label for="post-author">/);
  assert.match(page, /<label for="post-body">/);
  assert.match(page, /aria-describedby="post-counter-label post-counter"/);
  assert.match(page, /id="post-counter"[^>]*aria-live="polite"/);
  assert.match(page, /id="post-count" aria-live="polite">Loading posts…<\/span>/);
  assert.doesNotMatch(page, /id="post-count"[^>]*>0 posts<\/span>/);
  assert.match(page, /required/);
  assert.match(page, /id="post-image"[^>]*type="file"[^>]*accept="image\/png,image\/jpeg,image\/gif,image\/webp"/);
  assert.match(page, /href="\/paint\/"/);
  assert.match(page, /id="compose-preview-image" alt=""/);
  const previewFailure = "We couldn’t create a preview of the uploaded image. Remove the image, upload the file again, and check the preview before publishing.";
  assert.ok(page.includes(`<p id="compose-preview-error" hidden>${previewFailure}</p>`));
  assert.ok(wiring.includes(`setStatus("${previewFailure}", true);`));
  assert.match(page, /id="post-image-alt"/);
  assert.match(page, /id="post-media-status" role="status" aria-live="polite"/);
  assert.match(page, /id="post-submit"[^>]*aria-describedby="social-notice"/);
  assert.match(page, /id="social-notice" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(wiring, /selectionGeneration/);
  assert.match(component, /Publishing…/);
  assert.match(wiring, /takePaintHandoff/);
  assert.match(wiring, /caption: post\.body/);

  // No innerHTML anywhere in the interactive layers (no user-generated HTML).
  assert.doesNotMatch(`${component}\n${wiring}`, /innerHTML/);
});

// The control that opens the composer used to read "Write a post without an
// image" while the form it opens labels its image field "(optional)" — one page
// telling a reader both that a post cannot carry an image and that it may. The
// field label is the anchor term and is unchanged; the entry control names the
// act, in the intro's own words, and stops there. It no longer echoes the
// composer's heading either — see the naming test below. The same pass pins the
// destination for image posts: this
// site has no page called Profile, so "profile" survives on Social only as the
// People page's URL and the class that styles its nav item, never as a word a
// reader sees.
test("the control that opens the composer agrees with the composer about images", async (t) => {
  const markup = await readFile(new URL("../src/social.html", import.meta.url), "utf8");
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());

  const entry = page.document.querySelector(".hero-actions").querySelectorAll("a")
    .filter((anchor) => anchor.getAttribute("href") === "#post-form");
  assert.equal(entry.length, 1, "the hero offers exactly one route into the composer");
  assert.equal(textOf(entry[0]), "Or publish your own post below",
    "the control that opens the composer makes a claim about images again");

  const rendered = textOf(page.document.querySelector("body"));
  assert.doesNotMatch(rendered, /without an image/i,
    "a rendered string on Social says a post cannot carry an image");
  // Attributes too: a stale aria-label or title would go unread by the check
  // above. Rationale comments are prose about the copy, not the copy itself.
  assert.doesNotMatch(markup.replace(/<!--[\s\S]*?-->/g, ""), /without an image/i,
    "a stale label survives in an attribute or a hidden string");

  // The composer's own words, unchanged: the intro offers the image, the field
  // label is the term everything else defers to.
  const hint = textOf(page.document.querySelector("#post-form-hint"));
  assert.match(hint, /Add an image if you want one/);
  assert.equal(textOf(page.document.querySelector(".media-picker").querySelector("legend")), "Image (optional)");

  // The byline field is named after the concept every other surface reads it
  // as. It was labelled "Name (optional)" while its own hint, the feed filter
  // an inch below it, and People all said "display name" — one thing, two
  // words, within a single screen. Pinned so the term cannot drift back.
  const authorLabel = page.document.querySelectorAll("label")
    .filter((label) => label.getAttribute("for") === "post-author");
  assert.equal(authorLabel.length, 1, "the byline field carries exactly one visible label");
  assert.equal(textOf(authorLabel[0]), "Display name (optional)");
  assert.equal(page.document.querySelector("#post-author").getAttribute("aria-label"), null,
    "the accessible name comes from the visible label, not a second string beside it");

  // One name for the destination, and it is the one the nav, the footer, and
  // People's own heading use.
  assert.match(hint, /appears on People/, "the composer stops naming where an image post lands");
  assert.doesNotMatch(rendered, /profile/i, "Social names a page called Profile, which does not exist");
  const beyondTheUrl = markup.replace(/class="nav-profile"|href="\/profile\.html"/g, "");
  assert.doesNotMatch(beyondTheUrl.replace(/<!--[\s\S]*?-->/g, ""), /profile/i,
    "the word survives outside the People page's own URL and nav class");
});

// The composer used to be named three times before its first field: the hero's
// route into it, the badge, and the heading — "Write a post" printed twice, so a
// screen reader read the panel's name before the panel and again on arrival.
// Decisions and Releases each carry one badge and one heading, in that order,
// and the form panel takes its accessible name from that heading. Social is the
// same shape now, with this page's noun in the badge.
test("the composer names itself once, in the shape the other record forms use", async (t) => {
  const markup = await readFile(new URL("../src/social.html", import.meta.url), "utf8");
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());

  const rendered = textOf(page.document.querySelector("body"));
  assert.equal((rendered.match(/Write a post/g) || []).length, 1,
    "Social prints the composer's name more than once");

  const panel = page.document.querySelector(".form-panel");
  assert.equal(panel.getAttribute("aria-labelledby"), "post-form-title",
    "the composer panel is not named by its own heading");
  assert.equal(textOf(page.document.querySelector("#post-form-title")), "Write a post");

  // Badge above heading, the order both other record forms use.
  assert.ok(markup.indexOf('<p class="eyebrow">New post</p>')
    < markup.indexOf('<h2 id="post-form-title">'),
    "the badge does not sit above the composer heading");

  // Same two elements, same classes, same wiring as the release form.
  const releases = await readFile(new URL("../src/releases.html", import.meta.url), "utf8");
  for (const fragment of [
    '<div class="form-panel" aria-labelledby=',
    '<div class="section-heading">',
    '<p class="eyebrow">New',
  ]) {
    assert.ok(markup.includes(fragment) && releases.includes(fragment),
      `the composer no longer matches the release form on: ${fragment}`);
  }
});

// Every toolbar control says what it sorts or narrows, in the site's own words:
// "Display name" is the term the composer and People already use for the name a
// post carries, and the feed's order is stated rather than left as a bare value.
// The word "agent" is a role name this product never shows on a post, so on this
// page it survives only as the name of the Agent observatory destination.
test("the feed toolbar names what each control filters, in the site's own terms", async (t) => {
  const markup = await readFile(new URL("../src/social.html", import.meta.url), "utf8");

  assert.doesNotMatch(markup, /All agents/, "the poster filter never offers a menu of \"agents\"");
  assert.match(markup, /<label for="post-name-filter">Display name<\/label>/,
    "the poster filter reuses the composer's and People's term for a byline");
  assert.match(markup, /<option value="all">Everyone<\/option>/);
  assert.match(markup, /class="eyebrow">Post order: newest first</,
    "the feed's order is a named fact, not a bare value floating above the heading");
  // "Show posts" named no field — it read as the button beside it rather than
  // as the label above a menu. The label is the fact the menu narrows on.
  assert.match(markup, /<label for="post-time-filter">Time posted<\/label>/,
    "the time menu is labelled by what it filters on");
  assert.doesNotMatch(markup.replace(/<!--[\s\S]*?-->/g, ""), /Show posts/,
    "the label that read like a button survives somewhere on the page");
  assert.match(markup, /<option value="hour">From the past hour<\/option>/,
    "each option states what it includes, so the closed menu is already readable");
  // One word for the person who wrote a post, in all three places a reader
  // meets the concept: the filter's label, the note under Clear filters, and
  // the summary sentence (asserted on a booted page below).
  assert.match(markup, /id="post-filter-clear-hint">Clear filters shows every post again, from any time and every display name\.</,
    "Clear filters says what it restores, in the two menus' own terms");
  assert.match(markup, /id="post-filter-clear"[^>]*aria-describedby="post-filter-clear-hint"/,
    "the note is the button's description, not a paragraph that happens to sit near it");

  // Only the Agent observatory destination may still carry the word.
  const beyondNav = markup.replace(/Agent observatory/g, "").replace(/href="\/agents\.html"/g, "");
  assert.equal(beyondNav.match(/agent/gi), null, "no other copy on Social calls anyone an agent");

  // The default option is rebuilt by the feed itself, so it has to agree.
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  mountSocialFeed(page.document, { posts: sample, state: "ready" });
  const options = page.document.querySelector("#post-name-filter").options;
  assert.equal(textOf(options[0]), "Everyone");
  assert.equal(options[0].getAttribute("value"), "all", "the filter's values are untouched by the relabelling");
  assert.equal(options.filter((option) => /agent/i.test(textOf(option))).length, 0);

  // Both menus, and only these two, carry a visible label tied to their own
  // control — so neither reads as the button they sit beside.
  const labels = page.document.querySelector(".social-toolbar").querySelectorAll("label");
  assert.deepEqual(labels.map((label) => textOf(label)), ["Display name", "Time posted"]);
  assert.deepEqual(labels.map((label) => label.getAttribute("for")), ["post-name-filter", "post-time-filter"]);
});

// "Author" would be a second word for something this site already names: the
// composer's field hint, People's picker, and this filter all say "display
// name". The summary sentence and the Clear filters note say it too, so the
// three places a reader meets the concept agree word for word.
test("feedSummarySentence composes only the filters that are set, with correct plurals", () => {
  assert.equal(AUTHOR_TERM, "display name");

  assert.equal(feedSummarySentence({ shown: 12 }), "Showing all 12 posts, newest first.");
  assert.equal(feedSummarySentence({ shown: 1 }), "Showing 1 post, newest first.");
  // An unfiltered feed with nothing in it is the never-posted state, which the
  // empty panel already says more usefully than a sentence counting to zero.
  assert.equal(feedSummarySentence({ shown: 0 }), "");

  assert.equal(feedSummarySentence({ shown: 3, range: "from the past 24 hours", author: "Ari" }),
    "Showing 3 posts from the past 24 hours under the display name Ari.");
  assert.equal(feedSummarySentence({ shown: 1, range: "from the past hour" }),
    "Showing 1 post from the past hour.");
  assert.equal(feedSummarySentence({ shown: 2, author: "Mina" }),
    "Showing 2 posts under the display name Mina.");

  assert.equal(feedSummarySentence({ shown: 0, range: "from the past hour", author: "Ari" }),
    "No posts from the past hour under the display name Ari. Clear filters to see all posts.");
  assert.equal(feedSummarySentence({ shown: 0, author: "Ari" }),
    "No posts under the display name Ari. Clear filters to see all posts.");
});

// The heading said "All posts" whatever the filters held, so a feed narrowed to
// one display name still announced itself as every post on Social. It names what
// is on screen now, in the same words the two menus use.
test("feedHeading names the set on screen and counts it, in the menus' own words", () => {
  assert.equal(DEFAULT_FEED_HEADING, "All posts");

  assert.equal(feedHeading({ shown: 12 }), "All 12 posts");
  // Nothing to be "all" of: one post is the whole feed, and "All 1 post" is not
  // a sentence anyone writes.
  assert.equal(feedHeading({ shown: 1 }), "1 post");
  // An answered, unfiltered, empty feed. Same two words the empty panel opens
  // with ("No posts on Social yet."), so the heading cannot contradict it.
  assert.equal(feedHeading({ shown: 0 }), "No posts");

  assert.equal(feedHeading({ shown: 2, author: "Ari" }), `2 posts under the ${AUTHOR_TERM} Ari`);
  assert.equal(feedHeading({ shown: 1, range: "from the past hour" }), "1 post from the past hour");
  assert.equal(feedHeading({ shown: 3, range: "from the past 24 hours", author: "Ari" }),
    "3 posts from the past 24 hours under the display name Ari");
  assert.equal(feedHeading({ shown: 0, range: "from the past 7 days", author: "Mina" }),
    "No posts from the past 7 days under the display name Mina");

  // A heading, not a second copy of the sentence below it, and no arrow glyphs.
  for (const shown of [0, 1, 5]) {
    const text = feedHeading({ shown, range: "from the past hour", author: "Ari" });
    assert.doesNotMatch(text, /^Showing|\.$/, "the heading reads as a sentence");
    assert.doesNotMatch(text, /[→↗·—]/, "the heading carries a glyph");
  }
});

// The heading is the accessible name of the whole feed panel, so a stale one is
// also what a screen reader announces on entering the region. Its count and the
// cards below it are counted together here, so a heading that drifts from the
// list fails.
test("the feed heading tracks the filters and the cards actually rendered", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());

  const minutesAgo = (n) => new Date(Date.now() - n * 60 * 1000).toISOString();
  const posts = [
    { id: "ari-recent", author: "Ari", body: "just shipped", createdAt: minutesAgo(5) },
    { id: "ari-older", author: "Ari", body: "earlier today", createdAt: minutesAgo(60 * 5) },
    { id: "mina-older", author: "Mina", body: "last week", createdAt: minutesAgo(60 * 24 * 3) },
  ];
  mountSocialFeed(page.document, { posts, state: "ready" });

  const heading = page.document.querySelector("#feed-title");
  const nameFilter = page.document.querySelector("#post-name-filter");
  const timeFilter = page.document.querySelector("#post-time-filter");
  const shown = () => page.document.querySelectorAll(".post-card").length;
  // The harness's select accepts any value; a real one refuses an unlisted
  // option, so every value driven here is checked against what is rendered.
  const choose = (control, value) => {
    const offered = control.options.map((option) => option.getAttribute("value"));
    assert.ok(offered.includes(value), `${value} must be offered; the menu holds ${offered.join(", ")}`);
    control.value = value;
    control.dispatchEvent({ type: "change", bubbles: true });
  };

  assert.equal(textOf(heading), "All 3 posts");
  assert.equal(shown(), 3);

  choose(nameFilter, "Ari");
  assert.equal(textOf(heading), "2 posts under the display name Ari");
  assert.equal(shown(), 2, "the heading's count is the number of cards rendered");

  choose(nameFilter, "all");
  choose(timeFilter, "hour");
  assert.equal(textOf(heading), "1 post from the past hour");
  assert.equal(shown(), 1);

  choose(nameFilter, "Ari");
  assert.equal(textOf(heading), "1 post from the past hour under the display name Ari",
    "both filters are named, and the pair carries one count");
  assert.equal(shown(), 1);

  choose(nameFilter, "Mina");
  assert.equal(textOf(heading), "No posts from the past hour under the display name Mina");
  assert.equal(shown(), 0);
  assert.doesNotMatch(textOf(heading), /No posts on Social yet/,
    "the heading takes over the never-posted empty state's words");

  page.document.querySelector("#post-filter-clear").click();
  assert.equal(textOf(heading), "All 3 posts", "Clear filters restores the unfiltered heading and count");
  assert.equal(shown(), 3);

  // Still the panel's accessible name, and still out in the open: a heading
  // folded away or renamed would take the region's name with it.
  const panel = page.document.querySelector(".list-panel");
  assert.equal(panel.getAttribute("aria-labelledby"), "feed-title");
  assert.equal(heading.hasAttribute("hidden"), false);
  // The count beside it is the one announced region here; a second live region
  // on the heading would read the same news twice.
  assert.equal(heading.getAttribute("aria-live"), null);
  assert.equal(page.document.querySelector("#post-count").getAttribute("aria-live"), "polite");
});

test("the feed heading makes no claim about the feed before a fetch has answered", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const heading = page.document.querySelector("#feed-title");
  const feed = mountSocialFeed(page.document, { posts: [], state: "loading" });

  assert.equal(textOf(heading), "All posts", "an open fetch is not a count of zero");
  feed.setState("error");
  assert.equal(textOf(heading), "All posts", "a failed fetch is not a count of zero");

  feed.seed([]);
  assert.equal(textOf(heading), "No posts", "an answered fetch with nothing in it is a real zero");
  assert.match(textOf(page.document.querySelector(".empty-state")), /No posts on Social yet\./);
});

// The sentence directly above the cards answers "what am I looking at" without
// a tour. Its count comes from the same array the cards are rendered from, so
// the two cannot disagree; this test pins that by counting both.
test("the summary sentence stays true as the filters change", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());

  const minutesAgo = (n) => new Date(Date.now() - n * 60 * 1000).toISOString();
  const posts = [
    { id: "ari-recent", author: "Ari", body: "just shipped", createdAt: minutesAgo(5) },
    { id: "ari-older", author: "Ari", body: "earlier today", createdAt: minutesAgo(60 * 5) },
    { id: "mina-older", author: "Mina", body: "last week", createdAt: minutesAgo(60 * 24 * 3) },
  ];
  mountSocialFeed(page.document, { posts, state: "ready" });

  const summary = page.document.querySelector("#feed-summary");
  const nameFilter = page.document.querySelector("#post-name-filter");
  const timeFilter = page.document.querySelector("#post-time-filter");
  const shown = () => page.document.querySelectorAll(".post-card").length;
  // The harness's select accepts any value; a real one refuses an unlisted
  // option, so every value driven here is checked against what is rendered.
  const choose = (control, value) => {
    const offered = control.options.map((option) => option.getAttribute("value"));
    assert.ok(offered.includes(value), `${value} must be offered; the menu holds ${offered.join(", ")}`);
    control.value = value;
    control.dispatchEvent({ type: "change", bubbles: true });
  };

  assert.equal(textOf(summary), "Showing all 3 posts, newest first.");
  assert.equal(summary.hasAttribute("hidden"), false);
  assert.equal(shown(), 3);

  choose(nameFilter, "Ari");
  assert.equal(textOf(summary), "Showing 2 posts under the display name Ari.");
  assert.equal(shown(), 2, "the stated count is the number of cards rendered");

  choose(timeFilter, "hour");
  assert.equal(textOf(summary), "Showing 1 post from the past hour under the display name Ari.");
  assert.equal(shown(), 1);

  choose(nameFilter, "all");
  assert.equal(textOf(summary), "Showing 1 post from the past hour.",
    "an unset filter contributes no clause");

  choose(nameFilter, "Mina");
  assert.equal(shown(), 0);
  assert.equal(textOf(summary),
    "No posts from the past hour under the display name Mina. Clear filters to see all posts.");
  // Distinct from the never-posted empty state, which this change leaves alone.
  assert.doesNotMatch(textOf(summary), /No posts on Social yet/);

  page.document.querySelector("#post-filter-clear").click();
  assert.equal(textOf(summary), "Showing all 3 posts, newest first.");
  assert.equal(shown(), 3);
});

test("the summary makes no claim about the feed before a fetch has answered", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const summary = page.document.querySelector("#feed-summary");
  const feed = mountSocialFeed(page.document, { posts: [], state: "loading" });

  assert.equal(summary.hasAttribute("hidden"), true, "an open fetch is not a count of zero");
  assert.equal(textOf(summary), "");

  feed.setState("error");
  assert.equal(summary.hasAttribute("hidden"), true, "a failed fetch is not a count of zero");

  // An answered but genuinely empty feed is the never-posted state; the empty
  // panel says it, and the sentence stays out of its way.
  feed.seed([]);
  assert.equal(summary.hasAttribute("hidden"), true);
  assert.match(textOf(page.document.querySelector(".empty-state")), /No posts on Social yet\./);
});

// The shipped markup only pins the count a visitor sees before the feed mounts.
// Every state after that is written by the feed itself, so the question "is this
// feed empty or still working?" is answered here, on a booted page: a count that
// says "0 posts" is a claim, and the page may only make it once it has looked.
test("the post count never claims zero posts before the feed has any answer", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const count = page.document.querySelector("#post-count");
  const feed = mountSocialFeed(page.document, { posts: [], state: "loading" });

  assert.equal(textOf(count), "Loading posts…", "the first fetch is open, so there is no count to give");
  assert.equal(page.document.querySelectorAll(".empty-state").length, 0, "loading copy never shares the page with empty-state guidance");

  feed.setState("error");
  assert.equal(textOf(count), "Unavailable", "a failed fetch is not a count of zero");
  assert.match(textOf(page.document.querySelector(".empty-state-error")), /Social posts could not be loaded\./);

  feed.seed([]);
  assert.equal(textOf(count), "0 posts", "an answered fetch with nothing in it is a real zero");
  const empty = page.document.querySelector(".empty-state");
  assert.match(textOf(empty), /No posts on Social yet\./);
  assert.match(textOf(empty), /Publish a post, or open Paint to create an image first\./);
  assert.doesNotMatch(textOf(empty), /Loading|Connecting/);
});

test("demo seed contains only valid, demo-only posts", async () => {
  const raw = await readFile(new URL("../src/social-demo-data.json", import.meta.url), "utf8");
  const data = JSON.parse(raw);
  assert.ok(Array.isArray(data.posts) && data.posts.length > 0);
  // The seed is the offline fallback rendered directly by the feed, so every
  // entry must carry the render shape the feed expects.
  for (const post of data.posts) {
    assert.equal(typeof post.id === "string" && post.id.trim() !== "", true);
    assert.equal(typeof post.author === "string" && post.author.trim() !== "" && post.author.length <= MAX_AUTHOR_LENGTH, true);
    assert.equal(typeof post.body === "string" && post.body.trim() !== "" && post.body.length <= MAX_POST_LENGTH, true);
    assert.equal(typeof post.createdAt === "string" && !Number.isNaN(Date.parse(post.createdAt)), true);
  }
});

test("seeded images pass validation, ship as assets, and describe themselves", async () => {
  const data = JSON.parse(await readFile(new URL("../src/social-demo-data.json", import.meta.url), "utf8"));
  const imagePosts = data.posts.filter((post) => post.image);
  // The seed is the only path that exercises the image layout while the durable
  // API is text-only, so it must actually contain image posts.
  assert.ok(imagePosts.length > 0, "expected the demo seed to include image posts");

  for (const post of imagePosts) {
    const image = normalizeImage(post.image);
    assert.ok(image, `seed image ${post.image.src} must survive normalizeImage`);
    // Alt text is required of the seed even though the renderer tolerates its
    // absence: hand-authored content has no excuse.
    assert.ok(image.alt.length > 0 && image.alt.length <= MAX_IMAGE_ALT_LENGTH);
    assert.ok(image.width > 0 && image.height > 0, "seed images reserve layout space");
    // The referenced asset must exist in src/, or the card renders its error state.
    const file = await readFile(new URL(`../src${image.src}`, import.meta.url), "utf8");
    assert.match(file, /^<svg[^>]*viewBox=/, `${image.src} must be an SVG that scales to its tile`);
    assert.equal(unbalancedTag(file), null, `${image.src} must be well-formed`);
    // Assets are static art: no scripting, no off-origin fetches.
    assert.doesNotMatch(file, /<script|xlink:href|https?:\/\/(?!www\.w3\.org)/i);
  }
});

// The feed used to be "Social Profile" in the nav, which sat next to "Profile"
// and read as the same destination twice. It is "Social" everywhere now; the
// full ordered link set is pinned in tests/site-nav.test.js.
test("every global social destination link uses the Social label", async () => {
  const pages = [
    "index.html",
    "decision.html",
    "evolution.html",
    "releases.html",
    "release.html",
    "post.html",
    "profile.html",
    "social.html",
  ];

  for (const page of pages) {
    const html = await readFile(new URL(`../src/${page}`, import.meta.url), "utf8");
    assert.match(
      html,
      /<a class="nav-social"(?: aria-current="page")? href="\/social\.html">Social<\/a>/,
      `${page} must use the Social navigation label`,
    );
  }
});
