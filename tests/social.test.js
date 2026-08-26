import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createPost,
  sortPostsNewestFirst,
  counterState,
  filterPosts,
  normalizeApiPosts,
  normalizeSocialApiPosts,
  normalizeImage,
  feedSummarySentence,
  noMatchMessage,
  noMatchGuidance,
  CLEAR_FILTERS_LABEL,
  feedHeading,
  DEFAULT_FEED_HEADING,
  MAX_POST_LENGTH,
  MAX_AUTHOR_LENGTH,
  MAX_IMAGE_ALT_LENGTH,
  DEFAULT_AUTHOR,
  PUBLISH_FAILED_NOTE,
  mountSocialFeed,
  mountComposerDisclosure,
} from "../src/social.js";
import { loadPage, pressKey, tabSequence, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { PAINT_HANDOFF_KEY } from "../src/publishing-media.js";

const sample = [
  { id: "p-old", author: "Kai",  body: "first",  createdAt: "2026-07-10T00:00:00.000Z" },
  { id: "p-new", author: "Ari",  body: "latest", createdAt: "2026-07-14T00:00:00.000Z" },
  { id: "p-mid", author: "Mina", body: "middle", createdAt: "2026-07-12T00:00:00.000Z" },
];

const ids = (posts) => posts.map((post) => post.id);

// The site's one definition of a display name. It carries both facts that used
// to be split — where the names come from, and that nobody owns one — and
// Social and People render it in the same bytes.
const DISPLAY_NAME_SENTENCE = "Display names are invented for this demo or chosen by whoever published the post — nobody owns or verifies one, and anyone can publish under any name.";
// The wording the feed list carried before, kept here so the test that forbids
// it names what it is forbidding.
const RETIRED_FEED_VARIANT = "Every display name below is invented for this demo or a name a visitor published under.";

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
  // Whitespace is the only body that reaches this refusal — the textarea's own
  // `required` accepts three spaces — so the sentence a reader meets in the
  // composer's notice has to describe that, not a field they failed to fill in.
  assert.throws(() => createPost({ author: "Kai", body: "   " }), {
    name: "TypeError",
    message: "A post cannot be blank.",
  });
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

// The feed's instructions are not keyboard instructions. social.js binds no key
// over the list, so the paragraph that described Tab and the arrow keys
// described the browser; what a reader entering the list needs is how many posts
// are below it and how they are sorted, and that is the summary sentence the
// list now points its description at.
test("the feed list is described by its summary sentence, not by keyboard instructions", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());

  const feed = page.document.querySelector("#post-feed");
  assert.equal(feed.getAttribute("aria-describedby"), "feed-summary");
  // The eyebrow that used to carry the order is gone: the sentence it described
  // ends "newest first", and one screen states the order once.
  assert.equal(page.document.querySelectorAll("#feed-order").length, 0);

  const markup = await readFile(new URL("../src/social.html", import.meta.url), "utf8");
  const rendered = markup.replace(/<!--[\s\S]*?-->/g, "");
  assert.doesNotMatch(rendered, /arrow keys/, "no keyboard sentence survives on the feed");
  assert.doesNotMatch(rendered, /native/, "the feed instructions never name the browser's own behaviour");
  assert.doesNotMatch(rendered, /Clear filters shows every post again/,
    "the button's label is not restated as a sentence beside it");
  assert.equal(rendered.match(/class="hint feed-hint"/), null);

  const posts = [0, 1, 2, 3, 4].map((i) => ({
    id: `p${i}`, author: `A${i}`, body: `body ${i}`, createdAt: `2026-07-0${i + 1}T00:00:00.000Z`,
  }));
  mountSocialFeed(page.document, { posts, state: "ready" });
  const cards = page.document.querySelectorAll(".post-card");
  assert.deepEqual(cards.map((card) => card.tabIndex), [undefined, undefined, undefined, undefined, undefined]);
  const links = page.document.querySelectorAll(".post-author");
  assert.equal(links.length, 5);
  assert.deepEqual(links.map((link) => link.tagName), ["A", "A", "A", "A", "A"]);
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
  // The post text is the one field a post cannot exist without, so its label
  // says so in the same parenthetical the other three fields use, and its hint —
  // the refusal an empty post actually meets — is named by the textarea itself.
  assert.match(page, /<label for="post-body">Your post <span class="label-optional label-required">\(required\)<\/span><\/label>/);
  assert.match(page, /aria-describedby="post-body-hint post-counter-label post-counter"/);
  // The budget, and nothing about what the browser will do to an empty field:
  // the hint used to narrate a refusal before the reader had typed anything. The
  // number is the textarea's own maxlength. It opened "Required." as well, which
  // is the label's own parenthetical said twice a line apart (#1826).
  assert.match(page, /id="post-body-hint">Up to 280 characters\.<\/span>/);
  assert.doesNotMatch(page, /id="post-body-hint">Required\./);
  assert.doesNotMatch(page, /your browser asks you to fill this in/);
  assert.doesNotMatch(page, /nothing is published\.<\/span>/);
  assert.match(page, /id="post-counter"[^>]*aria-live="polite"/);
  // The count ships empty and social.js removes the element outright while a
  // fetch is open: "Counting posts…" was a third description of the one wait the
  // status region and the connection line were already reporting.
  assert.match(page, /id="post-count"><\/span>/);
  // The feed ships one short retrieval status and nothing beside it. The
  // connection line ships wordless: authored, its promise stood directly above
  // "Loading the Social feed…", so the shipped frame made a promise about posts
  // nobody had seen and then said it had none yet. src/social.js writes the
  // sentence when it puts the line back on a rendered feed;
  // tests/live-connection-copy.test.js owns the three states it can be in.
  assert.match(page, /id="feed-status"><\/span>/);
  assert.doesNotMatch(page, /will appear here on their own/);
  assert.equal((page.match(/Posts are loading\. Select Write a post to publish\./g) ?? []).length, 1);
  assert.doesNotMatch(page, /id="post-count"[^>]*>0 posts<\/span>/);
  // One announced region for a filter change, and it is the summary: the count
  // beside the heading says a thinner version of the same news, so announcing
  // both read every change out twice.
  assert.doesNotMatch(page, /id="post-count"[^>]*aria-live/);
  assert.match(page, /<p class="feed-summary" id="feed-summary" aria-live="polite"><\/p>/);
  // The live region ships empty, not hidden and not counting: a `hidden` region
  // announces unreliably when its text arrives, and a zero before the first
  // fetch is a claim the page has not earned.
  assert.doesNotMatch(page, /id="feed-summary"[^>]*hidden/);
  assert.doesNotMatch(page, /id="feed-summary"[^>]*role="status"/);
  assert.doesNotMatch(page, /id="feed-summary"[^>]*>Showing/);
  assert.match(page, /required/);
  assert.match(page, /id="post-image"[^>]*type="file"[^>]*accept="image\/png,image\/jpeg,image\/gif,image\/webp"/);
  assert.match(page, /href="\/paint\/"/);
  assert.match(page, /id="compose-preview-image" alt=""/);
  // The preview failure is not in the page as served. It shipped in the markup
  // behind `hidden`, so a page nobody had uploaded anything to still carried a
  // sentence about a file that had failed to decode. The element stays — the
  // wiring fills it on the image's error event — and it ships empty.
  const previewFailure = "We couldn’t create an image preview. Select Remove image, then Choose image to try again.";
  assert.ok(page.includes('<p id="compose-preview-error" hidden></p>'));
  assert.doesNotMatch(page, /create an image preview/);
  assert.doesNotMatch(page, /Confirm that the preview appears/);
  assert.ok(wiring.includes(`export const PREVIEW_FAILURE = "${previewFailure}";`));
  assert.ok(wiring.includes("fallback.textContent = PREVIEW_FAILURE;"));
  assert.ok(wiring.includes("setStatus(PREVIEW_FAILURE, true);"));
  assert.match(page, /id="post-image-alt"/);
  assert.match(page, /id="post-media-status" role="status" aria-live="polite"/);
  assert.match(page, /id="post-submit"[^>]*aria-describedby="post-consequence post-publish-blocker social-notice"/);
  assert.match(page, /id="social-notice" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(wiring, /selectionGeneration/);
  assert.match(component, /Publishing…/);
  assert.match(wiring, /takePaintHandoff/);
  assert.match(wiring, /caption: post\.body/);

  // No innerHTML anywhere in the interactive layers (no user-generated HTML).
  assert.doesNotMatch(`${component}\n${wiring}`, /innerHTML/);
});

// The composer used to explain three things that had not happened: what the
// browser would do to an empty post, that an image preview had failed, and
// how to recover from that failure. All three shipped in the markup, so a
// first-time visitor read them before touching a control. What is pinned here is
// the page as a reader meets it on arrival.
test("the composer describes no failure that has not happened yet", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());

  // Read from the rendered body, not the source: `hidden` is no defence here —
  // this harness reads text straight through it, the way find-in-page and reader
  // mode do — so the text has to be absent, not concealed.
  const rendered = textOf(page.document.querySelector("body"));
  for (const gone of [
    "your browser asks you to fill this in",
    "nothing is published",
    "create an image preview",
    "Confirm that the preview appears",
  ]) {
    assert.ok(!rendered.includes(gone), `the page still says "${gone}" before anything has failed`);
  }

  // The element that says it when a preview does fail is still here, still
  // hidden, and still the one src/social-page.js writes to. Counted, never
  // compared against null.
  assert.equal(page.document.querySelectorAll("#compose-preview-error").length, 1);
  assert.equal(textOf(page.document.querySelector("#compose-preview-error")), "");

  // What the post hint says instead: the budget the counter beside it counts
  // down from, and only that — the label above it is where the field says it is
  // required.
  assert.equal(textOf(page.document.querySelector("#post-body-hint")), "Up to 280 characters.");
  assert.equal(page.document.querySelector("#post-body").getAttribute("maxlength"), "280");

  // One offer of Paint on the page, and it is the composer's. The hero carried a
  // second button with the same four words, and the feed's empty state a third.
  const paint = page.document.querySelectorAll("a")
    .filter((anchor) => textOf(anchor).startsWith("Create an image in Paint"));
  assert.equal(paint.length, 1, "Social offers Paint more than once again");
  assert.match(textOf(paint[0]), /\(opens in a new tab\)/);
});

// The control that opens the composer used to read "Write a post without an
// image" while the form it opens labels its image field "(optional)" — one page
// telling a reader both that a post cannot carry an image and that it may. The
// field label is the anchor term and is unchanged; the entry control names the
// act and stops there. The heading it reveals says the same words: it read
// "Create a Social post", so the panel named one act with two verbs, and the
// second one is the verb this page keeps for images. "Create" on Social means
// an image and nothing else.
//
// #1872: the opener then spent a while reading "Publish a post", which made the
// hero's button and the form's submit button two near-identical commands. A
// first-time visitor met "Publish a post" at the top of the page and "Publish
// post →" at the bottom of the form and had no way to tell which of the two
// made a post public — and the one that does is the one there is no undo for.
// Opening the form and publishing the post are two acts, so they get two verbs:
// "Write a post" opens (opener and heading, word for word), "Publish post"
// publishes, and nothing else on the page is labelled with either. The arrow
// went with it: every other arrow on this site decorates a route, and this
// button moves the reader nowhere.
//
// The same pass pins the destination for image posts: this site has no page
// called Profile, so "profile" survives on Social only as the People page's URL
// and the class that styles its nav item, never as a word a reader sees.
test("the opener and heading name opening, and only the submit control names publishing", async (t) => {
  const markup = await readFile(new URL("../src/social.html", import.meta.url), "utf8");
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());

  const entry = page.document.querySelector(".hero-actions")
    .querySelectorAll("#post-compose-open");
  assert.equal(entry.length, 1, "the hero offers exactly one route into the composer");
  assert.equal(textOf(entry[0]), "Write a post",
    "the control that opens the composer names publishing, which the submit button also names");
  // A disclosure, told the way this site's other one is told: the button owns
  // the state, the panel it names is the composer, and it starts collapsed.
  assert.equal(entry[0].tagName, "BUTTON");
  assert.equal(entry[0].type, "button", "the trigger would submit something");
  assert.equal(entry[0].getAttribute("aria-expanded"), "false");
  assert.equal(entry[0].getAttribute("aria-controls"), "post-compose-panel");
  assert.equal(page.document.querySelector("#post-compose-panel").hidden, true);
  assert.equal(textOf(page.document.querySelector("#post-form-title")), "Write a post",
    "the composer heading no longer repeats the words on the control that opens it");
  // One verb for opening, a different one for publishing. "Create" survives on
  // this page for images only, at "Create an image in Paint".
  assert.equal(textOf(page.document.querySelector("#post-submit")), "Publish post",
    "the submit control is named something other than the act it performs, or grew an arrow back");
  const panelWords = textOf(page.document.querySelector("#post-compose-panel"))
    .replaceAll("Create an image in Paint", "");
  assert.doesNotMatch(panelWords, /\bcreate\b/i,
    "the composer names the post with a second verb again");
  // Counted, not compared against null: a surviving element sends assert.equal
  // through the whole parsed page instead of failing.
  assert.equal(page.document.querySelector(".form-panel").querySelectorAll(".eyebrow").length, 0,
    "the composer carries a third name above its first field again");
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

test("the composer calls its required 280-character text a post throughout", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());

  const composer = page.document.querySelector("#post-compose-panel");
  assert.equal(textOf(composer.querySelector("#post-form-hint")),
    "Write your post. Add an image if you want one — a post with an image also appears on People, under the display name you publish it with.");
  // "Your post", not "Post": the page's other uses of the bare word name the
  // published thing — Publish post, Open post — and the label names the reader's
  // own draft (#1967). The noun is the same one everything else defers to.
  assert.equal(textOf(composer.querySelector('label[for="post-body"]')), "Your post (required)");
  assert.equal(textOf(composer.querySelector("#post-body-hint")), "Up to 280 characters.");
  // #1826: the field said it was required twice — once as the label's
  // parenthetical, once as the word the hint below it opened on. The
  // parenthetical is the survivor, because Image, Image description and Display
  // name all answer "must I fill this in?" in that same span. Counted across the
  // label and its hint together, so moving the word from one to the other still
  // fails here.
  const postField = composer.querySelector('label[for="post-body"]').parentNode;
  assert.equal(textOf(postField).toLowerCase().split("required").length - 1, 1,
    `the post field states that it is required more than once: ${textOf(postField)}`);
  assert.equal(textOf(composer.querySelector("#post-submit")), "Publish post");
  assert.equal(PUBLISH_FAILED_NOTE,
    "Your post, image, and image description are still in the composer, exactly as you left them.");
  // The two sentences the composer's notice can carry from createPost. They are
  // the "validation text" half of one name everywhere, and they never render
  // into the page, so the rendered sweep below cannot see them.
  for (const [refusal, message] of [
    [() => createPost({ body: "   " }), "A post cannot be blank."],
    [() => createPost({ body: "x".repeat(281) }), "A post must be 280 characters or fewer."],
  ]) {
    assert.throws(refusal, { name: "TypeError", message });
  }
  assert.doesNotMatch(textOf(composer), /\bcaption\b/i);
});

// The page never said who wrote the posts, so the bundled names read as other
// people's accounts. It says it once now, at the feed, in the two words the
// site already owns: "invented" for the bundled names, "display name" for what
// a post is published under. The intro used to carry it, four screens above the
// first card; a disclosure about the names on the cards belongs where the cards
// are, so this pins the sentence to the feed panel and pins the intro to not
// saying it a second time.
test("the feed says who wrote the posts, where the posts are", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());

  const note = page.document.querySelector("#feed-source-note");
  assert.equal(page.document.querySelectorAll("#feed-source-note").length, 1,
    "the feed states who wrote the posts exactly once");
  assert.equal(textOf(note), DISPLAY_NAME_SENTENCE,
    "the feed stopped disclosing who wrote the posts");
  assert.match(textOf(note), /invented for this demo/,
    "the bundled names keep the site's one phrase for what it made up");
  // And they keep it exclusively: every earlier word for the same thing is a
  // second name for one concept, which is what this sentence exists to end.
  for (const rival of [/persona/i, /synthetic/i, /representative example/i])
    assert.doesNotMatch(textOf(note), rival,
      "the bundled names must not be described a second way");

  // In the feed panel itself, not in the hero and not in the composer. The
  // harness refuses descendant selectors, so the ancestry is walked.
  const panelOf = (node) => {
    for (let at = node.parentNode; at; at = at.parentNode)
      if (at.classList?.contains("list-panel")) return at;
    return undefined;
  };
  assert.ok(panelOf(note), "the sentence left the feed panel");
  assert.equal(panelOf(note).getAttribute("aria-labelledby"), "feed-title",
    "the panel it sits in is the one the feed heading names");

  // Prose, and only prose: a heading would claim a section, a live region would
  // announce a sentence that never changes, and a tab stop would put a fixed
  // fact in the keyboard path to the cards.
  assert.equal(note.getAttribute("aria-live"), null);
  assert.equal(note.getAttribute("role"), null);
  assert.equal(note.getAttribute("tabindex"), null);
  assert.equal(note.hasAttribute("hidden"), false);
  assert.ok(note.classList.contains("hint"),
    "the sentence uses the explanatory-prose class the panel already ships");

  // Said once on the page. The intro says what the feed is and where to go
  // next, and its last words stay the ones the permalink quotes.
  // Eyebrow, tagline, intro: the intro is the third paragraph in the hero, and
  // the line above it says what a visitor does here in one sentence.
  assert.equal(textOf(page.document.querySelector("#page-tagline")),
    "Read every post, and publish your own.");
  const intro = textOf(page.document.querySelector(".hero-social").querySelectorAll("p")[2]);
  assert.doesNotMatch(intro, /invented for this demo/,
    "the intro says who wrote the posts a second time, four screens from a card");
  assert.match(intro, /Posts use no customer or production data\.$/,
    "the demo-data sentence must stay the intro's last words");
  // One sentence, word for word People's, naming the control both feeds print
  // on every card. Social had no such control and said nothing about opening a
  // post; People told a reader to "select a post" and named nothing.
  assert.match(intro, /Select Open post to read a post in full\./,
    "the intro never tells a reader a post can be opened in full");

  // And the demo status is stated once above the feed. The hero used to say it
  // twice within one paragraph break — an eyebrow reading "Social · demo", then
  // "a shared demo feed", then the demo-data sentence — so a reader met the
  // same fact three times before a post. The eyebrow keeps the word; the
  // sentence keeps the meaning; the intro stops repeating either.
  const hero = textOf(page.document.querySelector(".hero-social"));
  assert.equal(textOf(page.document.querySelector(".hero-social").querySelector(".eyebrow")),
    "Social · demo", "the page eyebrow stopped naming this a demo");
  assert.equal(hero.match(/\bdemo\b/gi)?.length, 1,
    `the hero says "demo" ${hero.match(/\bdemo\b/gi)?.length} times, not once`);
  assert.equal(hero.split("Posts use no customer or production data.").length - 1, 1,
    "the hero states the demo-data fact more than once");
  assert.doesNotMatch(intro, /demo feed/,
    "the intro calls the feed a demo one, a line under an eyebrow that already does");
  // Removing the word did not cost the sentence what it was for: the feed is
  // still shared, the posts short, the images optional.
  assert.match(intro, /^Social is a shared feed of short posts about what the team ships, images optional\./,
    "the intro stopped saying what the feed holds");
});

// The sentence is a claim about the feed's authors, not about a fetch, so it
// has to survive every state social.js swaps the list between. A disclosure
// that only renders once posts arrive is missing from the two states — an open
// fetch and an empty feed — where a reader has the most time to read it.
test("who wrote the posts survives loading, populated, empty, and no-match", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());

  const sentence = DISPLAY_NAME_SENTENCE;
  const stillThere = (state) => {
    assert.equal(page.document.querySelectorAll("#feed-source-note").length, 1,
      `the sentence disappears in the ${state} state`);
    assert.equal(textOf(page.document.querySelector("#feed-source-note")), sentence,
      `the sentence is rewritten in the ${state} state`);
  };

  const posts = [
    { id: "ari", author: "Ari", body: "just shipped", createdAt: new Date(Date.now() - 60000).toISOString() },
  ];
  const feed = mountSocialFeed(page.document, { posts: [], state: "loading" });
  stillThere("loading");
  feed.setState("error");
  stillThere("error");
  feed.seed([]);
  stillThere("empty");
  feed.seed(posts);
  stillThere("populated");

  // Filter the one post out: the no-match branch replaces the list, and the
  // sentence is not in the part that gets replaced.
  const nameFilter = page.document.querySelector("#post-name-filter");
  const offered = nameFilter.options.map((option) => option.getAttribute("value"));
  assert.ok(offered.includes("Ari"), `Ari must be offered; the menu holds ${offered.join(", ")}`);
  const timeFilter = page.document.querySelector("#post-time-filter");
  timeFilter.value = "hour";
  nameFilter.value = "Ari";
  nameFilter.dispatchEvent({ type: "change", bubbles: true });
  stillThere("filtered");
});

// The intro's last sentence read as a promise about the whole page: a
// first-time visitor took "no customer or production data" to mean nothing
// here is real, including the post they were about to write, and then met the
// composer's warning that a published post cannot be deleted. Two true
// statements about two different sets of posts. The intro now says which set
// it means — the ones already in the feed, which the site invented — and hands
// the visitor's own post to the consequence at the Publish post button, which
// stays the one and only place that cost is stated.
const PROVENANCE_SENTENCE = "The posts already here are invented to demonstrate Shiplog; a post you publish is real.";
const PUBLISH_CONSEQUENCE = "Anyone who visits Shiplog can read your post, its image, and the display name you publish it with. You cannot delete it afterwards, so post nothing you would not put on a public page.";

test("the intro scopes the demo promise to the seeded posts, and the composer states the cost once", async (t) => {
  const { document, id } = await socialDisclosure(t);
  // Opened through the page's own control: the state a reader is in when they
  // are actually deciding whether to publish.
  id("post-compose-open").click();

  const intro = textOf(document.querySelector(".hero-social").querySelectorAll("p")[2]);
  assert.match(intro, /The posts already here are invented to demonstrate Shiplog; a post you publish is real\. Posts use no customer or production data\.$/,
    "the intro stopped saying which posts its demo promise covers, or stopped ending on the demo-data sentence");
  // The word the eyebrow owns is still said once in the hero: "demonstrate" is
  // the site's verb on the homepage and Releases, and it is not a fourth badge.
  const hero = textOf(document.querySelector(".hero-social"));
  assert.equal(hero.match(/\bdemo\b/gi)?.length, 1, "the hero says \"demo\" more than once again");

  const main = textOf(document.querySelector("#main-content"));
  // Once each, on the whole page. Both sentences are the kind a later change
  // re-adds beside a card or in the composer "to be safe", and a promise made
  // twice in two wordings is what filed this.
  assert.equal(main.split("no customer or production data").length - 1, 1,
    "the demo-data phrase is stated more than once on Social");
  assert.equal(main.split(PROVENANCE_SENTENCE).length - 1, 1,
    "the sentence saying which posts are invented is not on the page exactly once");
  assert.equal(main.split(PUBLISH_CONSEQUENCE).length - 1, 1,
    "the publish consequence is not on the page exactly once");

  // And it is where the decision is made: in the composer, read before the
  // control that acts on it, and named by that control.
  const consequence = id("post-consequence");
  assert.equal(textOf(consequence), PUBLISH_CONSEQUENCE, "the publish consequence was rewritten");
  assert.equal(document.querySelectorAll(".publish-consequence").length, 1);
  assert.equal(foldedAway(consequence), false, "the consequence only renders inside something collapsed");
  const order = documentOrder(document);
  const submit = id("post-submit");
  assert.ok(order.indexOf(consequence) < order.indexOf(submit),
    "the consequence is read after the button it is about");
  assert.ok((submit.getAttribute("aria-describedby") ?? "").split(" ").includes("post-consequence"),
    "the publish control stopped naming the consequence");

  // No second wording of either idea anywhere else on the page. Checked against
  // the text with the consequence itself removed, so the sentence cannot vouch
  // for its own paraphrase.
  const elsewhere = main.split(PUBLISH_CONSEQUENCE).join(" ");
  for (const rival of [/cannot delete/i, /can’t delete/i, /delete it afterwards/i, /permanently/i, /public page/i, /anyone who visits/i]) {
    assert.doesNotMatch(elsewhere, rival,
      `Social states that a published post is public and permanent a second way (${rival})`);
  }
  // The intro says what a post is made of, and stops there: what publishing
  // costs belongs at the button, four screens down, not in a paragraph a reader
  // skims on the way to the feed.
  assert.doesNotMatch(intro, /delete|public|permanent/i,
    "the intro carries the publish consequence a second time");
});

/* ------------------- the feed before the provenance (#1789) ------------------ */

// Document order, the same pre-order walk a browser reads the page in. The
// criterion is reading order and tab order, so this is asserted by position in
// the walk and never by a stylesheet, which the harness does not model anyway.
function documentOrder(document) {
  const order = [];
  const visit = (node) => {
    for (const child of node.children) {
      if (child.nodeType !== 1) continue;
      order.push(child);
      visit(child);
    }
  };
  visit(document);
  return order;
}

// Cards the feed actually drew. The loading skeleton carries .post-card too, so
// counting it would let an ordering assertion pass against a feed holding no
// posts at all.
const drawnCards = (document) =>
  [...document.querySelectorAll(".post-card")].filter((card) => !card.classList.contains("post-card-skeleton"));

// Is anything above this node a disclosure? The harness rejects descendant
// selectors, so the ancestry is walked. A live region inside a closed one is
// silent, and a sentence inside one is a sentence the reader has to ask for.
function insideDisclosure(node) {
  for (let at = node.parentNode; at; at = at.parentNode) if (at.tagName === "DETAILS") return true;
  return false;
}

// The reported defect: the display-name sentence opened the feed panel, above
// the filters, above the status region and above the first card, so the first
// screen of Social was provenance and the feed a reader came for was below it.
// The sentence is unchanged and still said once; it is read after the posts it
// explains now. It has to hold in every state the feed swaps between, because
// the states a reader waits longest in — an open fetch, a failed one, a feed
// the filters emptied — are exactly the ones where the ordering would rot
// unnoticed.
test("the status region and the posts are read before the demo disclaimer, in every feed state", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const { document } = page;

  const invariant = (state, { cards = 0, status = null } = {}) => {
    const order = documentOrder(document);
    const at = (node) => order.indexOf(node);
    const note = document.querySelector("#feed-source-note");
    const region = document.querySelector("#feed-state");
    const list = document.querySelector("#post-feed");

    // Said once, in the bytes it has always had.
    assert.equal(document.querySelectorAll("#feed-source-note").length, 1,
      `${state}: the page does not state the display-name caveat exactly once`);
    assert.equal(textOf(note), DISPLAY_NAME_SENTENCE, `${state}: the caveat was rewritten`);

    // The ordering criterion itself.
    assert.ok(at(region) < at(note), `${state}: the feed status is read after the caveat`);
    assert.ok(at(list) < at(note), `${state}: the posts list is read after the caveat`);
    assert.ok(at(document.querySelector(".social-toolbar")) < at(list),
      `${state}: the filters no longer sit above the posts they narrow`);

    // The live region did not move: same element, same id, same announcement
    // contract, and nothing foldable above it.
    assert.equal(region.getAttribute("role"), "status", `${state}: the status region stopped being a status`);
    assert.equal(region.getAttribute("aria-live"), "polite", `${state}: the status region stopped announcing`);
    assert.equal(insideDisclosure(region), false, `${state}: the status announces from inside a disclosure`);
    // And neither did the caveat go behind one: it is read without being asked
    // for, by a keyboard and by a screen reader alike.
    assert.equal(insideDisclosure(note), false, `${state}: the caveat has to be opened before it can be read`);
    assert.equal(note.getAttribute("tabindex"), null, `${state}: the caveat grew a tab stop`);
    assert.equal(note.hasAttribute("hidden"), false, `${state}: the caveat ships hidden`);

    // The state's own words, in the region that has always carried them.
    if (status !== null) assert.match(textOf(region), status, `${state}: the always-visible region lost its status`);

    const drawn = drawnCards(document);
    assert.equal(drawn.length, cards, `${state}: the feed drew ${drawn.length} cards rather than ${cards}`);
    if (cards > 0) assert.ok(at(drawn[0]) < at(note), `${state}: the first post card is read after the caveat`);
  };

  const feed = mountSocialFeed(document, { posts: [], state: "loading" });
  invariant("loading", { status: /Posts are loading\. Select Write a post to publish\./ });

  feed.setState("error");
  invariant("error", { status: /Social posts could not be loaded\./ });

  feed.seed([]);
  invariant("empty", { status: /No posts on Social yet\./ });

  // Three days old, so the time filter below can genuinely empty the feed.
  feed.seed([
    { id: "ari", author: "Ari", body: "just shipped", createdAt: new Date(Date.now() - 3 * 86400000).toISOString() },
  ]);
  invariant("populated", { cards: 1 });

  // Filter the one post out: the no-match branch replaces the list, and the
  // caveat is below the part that gets replaced.
  const nameFilter = document.querySelector("#post-name-filter");
  nameFilter.value = "Ari";
  document.querySelector("#post-time-filter").value = "hour";
  nameFilter.dispatchEvent({ type: "change", bubbles: true });
  invariant("filtered-empty", { status: /No posts by Ari from the past hour\./ });
});

// The other half of the same complaint: not just that the caveat is late, but
// that the panel's *first* words are the feed's own. They used to be a caveat
// about who owns a display name, which is the least useful thing a list region
// can open on. The first text a reader meets inside the panel is the heading
// social.js writes the count into — the bare noun while a fetch is open,
// because a count is a claim the page cannot make yet, and the number once it
// can. Source order, not a stylesheet: the harness models no layout, and the
// criterion is what a screen reader reads first anyway.
test("the Posts panel opens on the feed's own heading, not on the display-name caveat", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const { document } = page;
  const panel = document.querySelector(".list-panel");

  const opensOn = (state, expected) => {
    const text = textOf(panel);
    assert.ok(text.startsWith(expected),
      `${state}: the panel opens on "${text.slice(0, 60)}…" rather than "${expected}"`);
    // And the caveat is somewhere below, said once on the whole page.
    assert.equal(document.querySelectorAll("#feed-source-note").length, 1,
      `${state}: the display-name caveat is not on the page exactly once`);
    assert.equal(text.split(DISPLAY_NAME_SENTENCE).length - 1, 1,
      `${state}: the panel renders the display-name caveat more than once`);
    assert.ok(text.indexOf(DISPLAY_NAME_SENTENCE) > text.indexOf(expected),
      `${state}: the caveat is back above the panel's own heading`);
  };

  // The frame before any script runs: the heading is authored into the markup.
  opensOn("first paint", DEFAULT_FEED_HEADING);

  const feed = mountSocialFeed(document, { posts: [], state: "loading" });
  opensOn("loading", DEFAULT_FEED_HEADING);
  feed.setState("error");
  opensOn("error", DEFAULT_FEED_HEADING);
  feed.seed([]);
  opensOn("empty", feedHeading({ shown: 0 }));
  feed.seed([
    { id: "ari", author: "Ari", body: "just shipped", createdAt: new Date(Date.now() - 60000).toISOString() },
  ]);
  opensOn("populated", feedHeading({ shown: 1 }));
});

// One fact, one wording, on all three pages that show a published post. Social
// and the permalink already agreed; People — the page a reader can land on
// straight from the nav, and the only one that is nothing but pictures — said
// nothing about it at all. Compared as rendered text rather than as markup,
// because that is what a reader receives, and byte-for-byte rather than by a
// pattern: a sentence that agrees in substance and differs in a comma reads as
// two claims, and this test is the thing that stops the third page drifting.
test("Social, People, and a post permalink say the demo-data fact in the same bytes", async (t) => {
  const SENTENCE = "Posts use no customer or production data.";
  const found = [];
  for (const file of ["social.html", "profile.html", "post.html"]) {
    const page = await loadPage(new URL(`../src/${file}`, import.meta.url), {});
    t.after(() => page.restore());
    const rendered = textOf(page.document.querySelector("#main-content"));
    const sentence = rendered.match(/[A-Z][^.]*customer or production data[^.]*\./)?.[0];
    assert.ok(sentence, `${file} does not tell a reader the posts carry nothing real`);
    assert.equal(sentence, SENTENCE, `${file} states the demo-data fact in its own words`);
    // Once per page: a fact repeated on one screen is a fact a reader skips.
    assert.equal(rendered.split(SENTENCE).length - 1, 1,
      `${file} repeats the demo-data sentence`);
    found.push(sentence);
  }
  assert.equal(new Set(found).size, 1, "the three pages no longer share one wording");
});

// What a display name is used to be explained three ways in three places: the
// feed list said where the names came from, the composer said nobody owns one,
// and People repeated the composer. Each dropped a fact the others carried, so a
// visitor learned the concept and then met a different version of it on the next
// screen. One sentence carries both facts now, and it is the same bytes on both
// pages — compared as rendered text, because that is what a reader receives.
test("Social and People define a display name once, in the same words", async (t) => {
  const rendered = [];
  for (const file of ["social.html", "profile.html"]) {
    const page = await loadPage(new URL(`../src/${file}`, import.meta.url), {});
    t.after(() => page.restore());
    const text = textOf(page.document.querySelector("#main-content"));
    assert.equal(text.split(DISPLAY_NAME_SENTENCE).length - 1, 1,
      `${file} renders the display-name definition ${text.split(DISPLAY_NAME_SENTENCE).length - 1} times, not once`);
    // No earlier wording of the same idea survives beside it. The composer's
    // publish consequence is the one other place "display name" appears with a
    // claim attached, and it claims something else entirely.
    assert.doesNotMatch(text, /not a signed-in user/,
      `${file} still explains a display name a second way`);
    assert.equal(text.includes(RETIRED_FEED_VARIANT), false,
      `${file} still carries the retired feed-list wording`);
    // Both halves, not one: this is the whole point of merging the three.
    assert.match(text, /invented for this demo/, `${file} dropped where the names come from`);
    assert.match(text, /nobody owns or verifies one/, `${file} dropped that nobody owns a name`);
    rendered.push(text.match(/Display names are[^.]*\./)?.[0]);
  }
  assert.equal(new Set(rendered).size, 1,
    `Social and People drifted apart: ${rendered.join(" / ")}`);
  assert.equal(rendered[0], DISPLAY_NAME_SENTENCE);

  // The composer's publish consequence is out of this change and unchanged.
  const social = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => social.restore());
  assert.equal(textOf(social.document.querySelector("#post-consequence")),
    "Anyone who visits Shiplog can read your post, its image, and the display name you publish it with. You cannot delete it afterwards, so post nothing you would not put on a public page.");
});

// The opened composer pins both sentences beneath the display name field: what
// publishes to Social and cannot change, then how People groups image posts.
test("the display name field explains where the name appears and that it cannot change", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  // The composer ships collapsed now, so this asks the question about the state
  // a reader is actually in when they read the field: opened through the page's
  // own control, not by clearing `hidden` behind its back.
  mountComposerDisclosure(page.document);
  page.document.querySelector("#post-compose-open").click();

  const identity = page.document.querySelectorAll("#post-author-identity");
  assert.equal(identity.length, 1, "the display name field carries exactly one identity hint");
  assert.equal(identity[0].tagName, "P");
  assert.ok(identity[0].classList.contains("hint"),
    "the new text uses the field hint pattern the rest of the composer uses");

  // Attached to the field itself, not floated somewhere in the page: same field
  // group as the input, and named by the input's own aria-describedby.
  const input = page.document.querySelector("#post-author");
  assert.ok(identity[0].parentNode === input.parentNode,
    "the hint left the display name field's own group");
  assert.deepEqual((input.getAttribute("aria-describedby") ?? "").split(" "),
    ["post-author-hint", "post-author-identity"],
    "the input names its Social and People hints in reading order");

  const socialHelp = textOf(page.document.querySelector("#post-author-hint"));
  assert.equal(socialHelp,
    "The display name appears on your post in the Social feed, defaults to “Guest,” and cannot be changed after publishing.");
  const text = textOf(identity[0]);
  assert.equal(text, "People groups image posts under this display name.");
  // What a display name is not is the feed note's sentence, said once on the
  // page. Repeating it here would put the definition in two wordings again, and
  // the second copy would sit behind a panel a reader has to open.
  assert.doesNotMatch(text, /not a signed-in user|owns or verifies|invented for this demo/,
    "the field states the display-name definition a second time");

  // Help text, not a control: the composer gains no tab stop and no widget.
  assert.equal(identity[0].querySelectorAll("a,button,input,select,textarea,summary").length, 0,
    "the help text grew something focusable");
  assert.equal(identity[0].getAttribute("tabindex"), null);
  // Nothing collapses or hides it: the harness models no layout and reads
  // straight through a closed details element, so walk the ancestors instead.
  const folded = [];
  for (let node = identity[0]; node; node = node.parentNode) {
    if (node.tagName === "DETAILS" || node.getAttribute?.("hidden") !== null) folded.push(node.tagName);
  }
  assert.deepEqual(folded, [], "the help text sits inside something hidden or collapsed");

  // The consequence at the Publish button is the one place that claim is made.
  assert.match(textOf(page.document.querySelector("#post-consequence")),
    /^Anyone who visits Shiplog can read your post, its image, and the display name you publish it with\./);
  assert.equal(page.document.querySelectorAll(".publish-consequence").length, 1);
});

// Every toolbar control says what it sorts or narrows, in the site's own words:
// "Display name" is the term the composer and People already use for the name a
// post carries, and the feed's order is stated rather than left as a bare value.
// The word "agent" is a role name this product never shows on a post, so on this
// page it survives only as the name of the Agent observatory destination.
test("the feed toolbar names what each control filters, in the site's own terms", async (t) => {
  const markup = await readFile(new URL("../src/social.html", import.meta.url), "utf8");

  assert.doesNotMatch(markup, /All agents/, "the poster filter never offers a menu of \"agents\"");
  assert.match(markup, /<label for="post-name-filter">Filter posts by display name<\/label>/,
    "the poster filter reuses the composer's and People's term for a byline");
  assert.match(markup, /<option value="all">All display names<\/option>/,
    "the all-values option names the thing the menu holds, in the label's own term");
  assert.doesNotMatch(markup.replace(/<!--[\s\S]*?-->/g, ""), /Post order: newest first/,
    "the ordering eyebrow survives above a summary sentence that already ends \"newest first\"");
  // "Show posts" named no field — it read as the button beside it rather than
  // as the label above a menu. The label is the fact the menu narrows on.
  assert.match(markup, /<label for="post-time-filter">Filter posts by posting time<\/label>/,
    "the time menu is labelled by what it filters on");
  assert.doesNotMatch(markup.replace(/<!--[\s\S]*?-->/g, ""), /Show posts/,
    "the label that read like a button survives somewhere on the page");
  assert.match(markup, /<option value="hour">From the past hour<\/option>/,
    "each option states what it includes, so the closed menu is already readable");
  // The button carries no description paragraph: the one it had opened by
  // restating its own label. What the filters are doing to the feed is the
  // summary sentence's job (asserted on a booted page below).
  assert.doesNotMatch(markup, /post-filter-clear-hint/,
    "the button's label is not restated as a sentence beside it");
  assert.match(markup, /<button class="clear-filters social-clear" id="post-filter-clear" type="button">Clear filters<\/button>/,
    "Clear filters is the whole control: a label a reader has already read needs no gloss");

  // Only the Agent observatory destination may still carry the word.
  const beyondNav = markup.replace(/Agent observatory/g, "").replace(/href="\/agents\.html"/g, "");
  assert.equal(beyondNav.match(/agent/gi), null, "no other copy on Social calls anyone an agent");

  // The default option is rebuilt by the feed itself, so it has to agree.
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  mountSocialFeed(page.document, { posts: sample, state: "ready" });
  const options = page.document.querySelector("#post-name-filter").options;
  assert.equal(textOf(options[0]), "All display names");
  assert.equal(options[0].getAttribute("value"), "all", "the filter's values are untouched by the relabelling");
  assert.equal(options.filter((option) => /agent/i.test(textOf(option))).length, 0);

  // Both menus, and only these two, carry a visible label tied to their own
  // control — so neither reads as the button they sit beside.
  const labels = page.document.querySelector(".social-toolbar").querySelectorAll("label");
  assert.deepEqual(labels.map((label) => textOf(label)), ["Filter posts by display name", "Filter posts by posting time"]);
  assert.deepEqual(labels.map((label) => label.getAttribute("for")), ["post-name-filter", "post-time-filter"]);
});

// The one sentence a settled feed owes a first-time visitor: how many posts,
// which filters produced them, and what order they are in. The order clause is
// part of it, because it is the page's only statement of the order now.
test("feedSummarySentence composes only the filters that are set, with correct plurals", () => {
  assert.equal(feedSummarySentence({ shown: 12 }), "Showing 12 posts, newest first.");
  assert.equal(feedSummarySentence({ shown: 1 }), "Showing 1 post, newest first.");
  // An unfiltered feed with nothing in it is the never-posted state, which the
  // empty panel already says more usefully than a sentence counting to zero.
  assert.equal(feedSummarySentence({ shown: 0 }), "");

  // A narrowed feed says what it was narrowed from. Without the denominator,
  // "Showing 2 posts" says nothing to a reader who cannot see the menus above
  // it. The filter reads "by Ari" — People's words for the same fact — and the
  // time clause is the menu's own option text.
  assert.equal(feedSummarySentence({ shown: 3, total: 12, range: "from the past 24 hours", author: "Ari" }),
    "Showing 3 of 12 posts by Ari from the past 24 hours, newest first.");
  assert.equal(feedSummarySentence({ shown: 1, total: 4, range: "from the past hour" }),
    "Showing 1 of 4 posts from the past hour, newest first.");
  assert.equal(feedSummarySentence({ shown: 2, total: 5, author: "Mina" }),
    "Showing 2 of 5 posts by Mina, newest first.");
  // The plural follows the total, which is the noun being counted out of.
  assert.equal(feedSummarySentence({ shown: 1, total: 1, author: "Mina" }),
    "Showing 1 of 1 post by Mina, newest first.");

  // A filtered zero orders nothing and counts nothing, so this sentence says
  // nothing: the no-match panel is the region that states the dead end, and it
  // is the one holding the control that undoes it. Composing the panel's two
  // sentences here as well put them on the page twice and announced them from
  // two polite regions — the defect this sentence exists to prevent, in its own
  // voice.
  assert.equal(feedSummarySentence({ shown: 0, total: 9, range: "from the past hour", author: "Ari" }), "");
  assert.equal(feedSummarySentence({ shown: 0, total: 9, author: "Ari" }), "");
  assert.equal(feedSummarySentence({ shown: 0, total: 1, range: "from the past hour" }), "");
});

// The filtered dead end used to render the never-posted panel, which told a
// reader the feed was empty while it was in fact full and their own two menus
// were hiding it. These two lines are the opposite claim, and they are checked
// against the never-posted copy so the two can never read as the same screen.
test("the no-match copy names the filters and cannot be confused with the never-posted state", () => {
  // Plain sentences. "No posts match these filters: Ari · from the past hour."
  // made a reader parse a labelled list before they could read the news.
  assert.equal(noMatchMessage({ author: "Ari", range: "from the past 24 hours" }),
    "No posts by Ari from the past 24 hours.");
  assert.equal(noMatchMessage({ author: "Ari" }), "No posts by Ari.");
  assert.equal(noMatchMessage({ range: "from the past hour" }), "No posts from the past hour.");

  // The way out names the control by the exact words printed on it, so a reader
  // can go looking for the thing they were just told to press.
  assert.equal(noMatchGuidance(12), "Select Clear filters to see all 12 posts.");
  assert.equal(noMatchGuidance(1), "Select Clear filters to see all 1 post.");
  assert.match(noMatchGuidance(4), new RegExp(`Select ${CLEAR_FILTERS_LABEL} `));

  for (const text of [noMatchMessage({ author: "Ari" }), noMatchGuidance(3)]) {
    assert.doesNotMatch(text, /No posts on Social yet/);
    assert.doesNotMatch(text, /create an image in Paint/);
  }
  assert.equal(CLEAR_FILTERS_LABEL, "Clear filters");
});

// The heading said "All posts" whatever the filters held, so a feed narrowed to
// one display name still announced itself as every post on Social. It names what
// is on screen now, in the same words the two menus and the sentence below use.
test("feedHeading names the set on screen and counts it, in the menus' own words", () => {
  // No count before a fetch has answered, and no "All" claim beside a sentence
  // that already says how many of how many posts are showing.
  assert.equal(DEFAULT_FEED_HEADING, "Post feed");

  assert.equal(feedHeading({ shown: 12 }), "Post feed: 12 posts");
  assert.equal(feedHeading({ shown: 1 }), "Post feed: 1 post");
  // An answered, unfiltered, empty feed. Same two words the empty panel opens
  // with ("No posts on Social yet."), so the heading cannot contradict it.
  assert.equal(feedHeading({ shown: 0 }), "Post feed: No posts");

  assert.equal(feedHeading({ shown: 2, author: "Ari" }), "Post feed: 2 posts by Ari");
  assert.equal(feedHeading({ shown: 1, range: "from the past hour" }), "Post feed: 1 post from the past hour");
  assert.equal(feedHeading({ shown: 3, range: "from the past 24 hours", author: "Ari" }),
    "Post feed: 3 posts by Ari from the past 24 hours");
  assert.equal(feedHeading({ shown: 0, range: "from the past 7 days", author: "Mina" }),
    "Post feed: No posts by Mina from the past 7 days");

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

  assert.equal(textOf(heading), "Post feed: 3 posts");
  assert.equal(shown(), 3);

  choose(nameFilter, "Ari");
  assert.equal(textOf(heading), "Post feed: 2 posts by Ari");
  assert.equal(shown(), 2, "the heading's count is the number of cards rendered");

  choose(nameFilter, "all");
  choose(timeFilter, "hour");
  assert.equal(textOf(heading), "Post feed: 1 post from the past hour");
  assert.equal(shown(), 1);

  choose(nameFilter, "Ari");
  assert.equal(textOf(heading), "Post feed: 1 post by Ari from the past hour",
    "both filters are named, and the pair carries one count");
  assert.equal(shown(), 1);

  choose(nameFilter, "Mina");
  assert.equal(textOf(heading), "Post feed: No posts by Mina from the past hour");
  assert.equal(shown(), 0);
  assert.doesNotMatch(textOf(heading), /No posts on Social yet/,
    "the heading takes over the never-posted empty state's words");

  page.document.querySelector("#post-filter-clear").click();
  assert.equal(textOf(heading), "Post feed: 3 posts", "Clear filters restores the unfiltered heading and count");
  assert.equal(shown(), 3);

  // Still the panel's accessible name, and still out in the open: a heading
  // folded away or renamed would take the region's name with it.
  const panel = page.document.querySelector(".list-panel");
  assert.equal(panel.getAttribute("aria-labelledby"), "feed-title");
  assert.equal(heading.hasAttribute("hidden"), false);
  // The summary below the filters is the one announced region here; a second
  // live region on the heading, or on the count beside it, would read the same
  // news twice.
  assert.equal(heading.getAttribute("aria-live"), null);
  assert.equal(page.document.querySelector("#post-count").getAttribute("aria-live"), null);
  assert.equal(page.document.querySelector("#feed-summary").getAttribute("aria-live"), "polite");
});

test("the feed heading makes no claim about the feed before a fetch has answered", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const heading = page.document.querySelector("#feed-title");
  const feed = mountSocialFeed(page.document, { posts: [], state: "loading" });

  assert.equal(textOf(heading), "Post feed", "an open fetch is not a count of zero");
  feed.setState("error");
  assert.equal(textOf(heading), "Post feed", "a failed fetch is not a count of zero");

  feed.seed([]);
  assert.equal(textOf(heading), "Post feed: No posts", "an answered fetch with nothing in it is a real zero");
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

  assert.equal(textOf(summary), "Showing 3 posts, newest first.");
  assert.equal(shown(), 3);
  // The sentence is the announced region, and it is in normal flow rather than
  // folded away or hidden — a live region a reader cannot see is one they are
  // told about but cannot check.
  assert.equal(summary.getAttribute("aria-live"), "polite");
  assert.equal(summary.hasAttribute("hidden"), false);
  assert.equal(summary.getAttribute("role"), null, "a role=status on the same text announces it twice");
  assert.equal(summary.querySelectorAll("[aria-live]").length, 0, "a nested live region announces twice");

  choose(nameFilter, "Ari");
  assert.equal(textOf(summary), "Showing 2 of 3 posts by Ari, newest first.");
  assert.equal(shown(), 2, "the stated count is the number of cards rendered");

  choose(timeFilter, "hour");
  assert.equal(textOf(summary), "Showing 1 of 3 posts by Ari from the past hour, newest first.");
  assert.equal(shown(), 1);

  choose(nameFilter, "all");
  assert.equal(textOf(summary), "Showing 1 of 3 posts from the past hour, newest first.",
    "an unset filter contributes no clause");

  choose(nameFilter, "Mina");
  assert.equal(shown(), 0);
  // Nothing matched, so this sentence stops: the dead end is the panel's news,
  // and the panel is the live region that carries the way out of it. Saying it
  // here as well printed the same two sentences twice, a few pixels apart, and
  // announced them from two polite regions at once.
  assert.equal(textOf(summary), "", "the dead end is stated by the panel that recovers from it, once");
  const deadEnd = page.document.querySelector(".empty-state-filtered");
  assert.match(textOf(deadEnd), /No posts by Mina from the past hour\./);
  assert.match(textOf(deadEnd), /Select Clear filters to see all 3 posts\./);
  // Once on the whole page, not once per region.
  const body = textOf(page.document.body);
  assert.equal((body.match(/Select Clear filters to see all 3 posts\./g) ?? []).length, 1);
  assert.equal(textOf(page.document.querySelector("#post-filter-clear")), "Clear filters",
    "the sentence points at a label the button does not render");
  // Distinct from the never-posted empty state, which this change leaves alone.
  assert.doesNotMatch(textOf(deadEnd), /No posts on Social yet/);

  page.document.querySelector("#post-filter-clear").click();
  assert.equal(textOf(summary), "Showing 3 posts, newest first.");
  assert.equal(shown(), 3);
});

// A filter combination that matches nothing is not an empty feed: the posts are
// still there, two menus are hiding them, and the reader can undo that from
// where they are standing. This pins the words, the control, and where focus
// goes when the control removes itself.
test("a filter combination matching nothing reads as a dead end with its own recovery", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());

  const minutesAgo = (n) => new Date(Date.now() - n * 60 * 1000).toISOString();
  const posts = [
    { id: "ari-recent", author: "Ari", body: "just shipped", createdAt: minutesAgo(5) },
    { id: "ari-older", author: "Ari", body: "earlier today", createdAt: minutesAgo(60 * 5) },
    { id: "mina-older", author: "Mina", body: "last week", createdAt: minutesAgo(60 * 24 * 3) },
  ];
  mountSocialFeed(page.document, { posts, state: "ready" });

  const feed = page.document.querySelector("#post-feed");
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
  // The harness models no layout, so "still on the page" is asked of the parent
  // chain rather than of anything visual.
  const inDocument = (node) => {
    for (let cursor = node; cursor; cursor = cursor.parentNode) if (cursor === page.document) return true;
    return false;
  };

  choose(nameFilter, "Mina");
  choose(timeFilter, "hour");
  assert.equal(shown(), 0);

  const panel = page.document.querySelector(".empty-state");
  assert.match(textOf(panel), /No posts by Mina from the past hour\./);
  assert.match(textOf(panel), /Select Clear filters to see all 3 posts\./);
  // Not the never-posted screen, in either of its halves.
  assert.doesNotMatch(textOf(panel), /No posts on Social yet/);
  assert.doesNotMatch(textOf(panel), /create an image in Paint/);

  // And nothing else on the page offers a second reason for the empty feed. The
  // connection promise is the one that reads as one — "New posts will appear
  // here on their own." tells a reader to wait for posts that are already here,
  // behind their own two menus — so it leaves the document in this state, the
  // way it already leaves it while the first fetch is open.
  assert.doesNotMatch(textOf(page.document.body), /New posts will appear here on their own/);
  assert.equal(page.document.querySelectorAll(".feed-connection").length, 0);
  assert.equal(textOf(page.document.querySelector("#feed-summary")), "",
    "the summary repeats the panel's two sentences a second time");

  // A real button, after the message in DOM order, and in the tab sequence.
  const stateRegion = page.document.querySelector("#feed-state");
  const buttons = stateRegion.querySelectorAll("button");
  assert.equal(buttons.length, 1, "the dead end adds exactly one control");
  const clear = buttons[0];
  assert.equal(clear.tagName, "BUTTON");
  // type=button, so a control that happens to sit inside a form some day cannot
  // submit it.
  assert.equal(clear.type, "button");
  assert.equal(textOf(clear), "Clear filters");
  const order = stateRegion.querySelectorAll("p,button").map((node) => node.tagName);
  assert.equal(order.at(-1), "BUTTON", "the control follows the message it recovers from");
  const sequence = tabSequence(page.document);
  assert.equal(sequence.includes(clear), true, "the in-region control is reachable by Tab");

  clear.click();
  assert.equal(shown(), 3, "recovery restores every post");
  assert.equal(nameFilter.value, "all");
  assert.equal(timeFilter.value, "all");
  assert.equal(textOf(page.document.querySelector("#feed-summary")), "Showing 3 posts, newest first.");
  // The connection line comes back with the posts, in its authored slot.
  assert.equal(page.document.querySelectorAll(".feed-connection").length, 1);
  assert.equal(page.document.querySelectorAll(".empty-state").length, 0);
  assert.equal(stateRegion.hidden, true, "matching posts hide the no-match status");
  assert.equal(textOf(stateRegion), "", "no-match copy cannot survive beside matching posts");

  // The button that was pressed is gone with the panel, so focus must have been
  // moved somewhere that still exists — never left on a removed node, never
  // dropped to the body.
  const landed = page.document.activeElement;
  assert.notEqual(landed, null, "focus is moved explicitly, not dropped");
  assert.equal(inDocument(landed), true, "focus lands on a node still in the document");
  assert.equal(landed.classList.contains("post-author"), true, "focus lands on the first restored native link");
  assert.equal(landed.closest(".post-card").dataset.postId, "ari-recent");
  // Only the dead end's own control was ever added to the tab sequence.
  assert.equal(feed.querySelectorAll("button").length, 0);
});

// The dead end belongs to the filters, not to an empty feed: with nothing
// published at all, any filter setting is still the never-posted screen.
test("an empty feed keeps the never-posted state whatever the filters hold", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const feed = mountSocialFeed(page.document, { posts: [], state: "ready" });
  const timeFilter = page.document.querySelector("#post-time-filter");

  timeFilter.value = "hour";
  timeFilter.dispatchEvent({ type: "change", bubbles: true });
  const panel = page.document.querySelector(".empty-state");
  assert.match(textOf(panel), /No posts on Social yet\./);
  assert.doesNotMatch(textOf(panel), /No posts match/);
  assert.equal(page.document.querySelector("#post-feed").querySelectorAll("button").length, 0);
  assert.equal(feed.getPosts().length, 0);
});

test("the summary makes no claim about the feed before a fetch has answered", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const summary = page.document.querySelector("#feed-summary");
  const feed = mountSocialFeed(page.document, { posts: [], state: "loading" });

  // Empty rather than hidden: the element is the live region and has to persist
  // across updates, so the first render before any data arrives writes no text
  // at all — not "Showing 0 posts", not "Showing 0 of 0 posts".
  assert.equal(textOf(summary), "", "an open fetch is not a count of zero");
  assert.equal(summary.hasAttribute("hidden"), false);
  assert.doesNotMatch(textOf(summary), /Showing|0/);

  feed.setState("error");
  assert.equal(textOf(summary), "", "a failed fetch is not a count of zero");

  // An answered but genuinely empty feed is the never-posted state; the empty
  // panel says it, and the sentence stays out of its way.
  feed.seed([]);
  assert.equal(textOf(summary), "");
  assert.match(textOf(page.document.querySelector(".empty-state")), /No posts on Social yet\./);
});

// The reported defect: a settled feed told a visitor how it was sorted in an
// eyebrow, how many posts there were in a chip, and what set was on screen in a
// heading — three fragments, no sentence. One sentence carries all of it now,
// and the fragments that restated the order are gone with it.
test("a settled feed says how many posts it holds and how they are ordered, once", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());

  const posts = [0, 1, 2, 3].map((i) => ({
    id: `p${i}`, author: "Ari", body: `body ${i}`, createdAt: `2026-07-0${i + 1}T00:00:00.000Z`,
  }));
  const feed = mountSocialFeed(page.document, { posts, state: "ready" });

  const panel = page.document.querySelector(".list-panel");
  const summary = page.document.querySelector("#feed-summary");
  assert.equal(textOf(summary), "Showing 4 posts, newest first.");
  assert.equal(page.document.querySelectorAll(".post-card").length, 4,
    "the stated count is the number of cards rendered");

  // Exactly one statement of the order in the whole feed panel. The eyebrow that
  // used to say "Post order: newest first" above the heading is what this
  // replaced, so a second match here means the fragment came back.
  assert.equal((textOf(panel).match(/newest first/gi) ?? []).length, 1);
  assert.doesNotMatch(textOf(panel), /Post order/);
  // And no heading claiming to hold every post beside a sentence that counts.
  assert.doesNotMatch(textOf(panel), /All posts/);

  // Singular is a real sentence, not "1 posts".
  feed.seed([posts[0]]);
  assert.equal(textOf(summary), "Showing 1 post, newest first.");
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

  // One wait, one sentence. The count and the connection line are waiting on the
  // same fetch as the status region, so while it is open they are not on the
  // page at all — absent, not hidden, because a hidden line is still text a
  // screen reader can be walked through.
  assert.equal(page.document.querySelectorAll("#post-count").length, 0,
    "the first fetch is open, so there is no count line to read");
  assert.equal(page.document.querySelectorAll(".feed-connection").length, 0,
    "a promise about posts nobody has seen is a second description of the wait");
  assert.doesNotMatch(textOf(page.document.body), /Counting posts/);
  assert.doesNotMatch(textOf(page.document.body), /New posts will appear here on their own/);
  assert.equal(page.document.querySelectorAll(".empty-state").length, 0, "loading copy never shares the page with empty-state guidance");
  const status = page.document.querySelector("#feed-state");
  assert.equal(status.querySelectorAll(".state-title").length, 1);
  assert.equal(textOf(status.querySelector(".state-title")), "Posts are loading. Select Write a post to publish.");

  feed.setState("error");
  assert.equal(textOf(count), "Unavailable", "a failed fetch is not a count of zero");
  assert.match(textOf(page.document.querySelector(".empty-state-error")), /Social posts could not be loaded\./);

  feed.seed([]);
  assert.equal(textOf(count), "0 posts", "an answered fetch with nothing in it is a real zero");
  const empty = page.document.querySelector(".empty-state");
  assert.match(textOf(empty), /No posts on Social yet\./);
  assert.match(textOf(empty), /Write a post, or create an image in Paint first\./);

  feed.seed([{ id: "now-populated", author: "Mina", body: "Ready.", createdAt: new Date().toISOString() }]);
  assert.equal(status.hidden, true, "a populated feed hides the reused status region");
  assert.equal(textOf(status), "", "empty/error copy cannot survive a populated render");
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

// ---------------------------------------------------------------------------
// The composer as a disclosure (#1514).
//
// A first-time visitor used to land on Social and meet a caption box, a file
// picker, a name field and a Publish button before a single post — the page
// asked them to write before it let them read. The feed comes first now and the
// composer is one keystroke away behind the hero's Write a post control.
//
// Every assertion below reads the disclosure's own state alongside the text,
// because this harness models no layout: textOf reads straight through a
// collapsed panel, so "the caution is present" passes on a page where nobody
// can see it. `hidden` on the panel and `aria-expanded` on the trigger are what
// actually fail when the reveal breaks.
// ---------------------------------------------------------------------------

/** The shipped page with the composer wired, and nothing else mounted. */
async function socialDisclosure(t) {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const composer = mountComposerDisclosure(page.document);
  const id = (name) => page.document.querySelector(`#${name}`);
  return { page, document: page.document, composer, id };
}

/** Ancestry by walk: the harness throws on a descendant selector. */
const foldedAway = (node) => {
  for (let cursor = node; cursor; cursor = cursor.parentNode) {
    if (cursor.tagName === "DETAILS" && !cursor.hasAttribute?.("open")) return true;
    if (cursor.getAttribute?.("hidden") !== null && cursor.getAttribute) return true;
  }
  return false;
};

// #1872, and the assertion most likely to regress: "Publish" is the page's word
// for the irreversible act, so it may appear on exactly one control — the button
// that performs it. Read with the composer open, because that is the only state
// in which both controls are on screen at once, and the state the old pair of
// near-identical commands was ambiguous in. Every label a reader can press or
// that names a field is counted: anchors, buttons, summaries, and field labels,
// across the whole document rather than the composer alone, so the nav, the
// feed's own controls and the footer cannot quietly take the word either.
test("with the composer open, one control on Social says Publish and it is the submit button", async (t) => {
  const { document, id } = await socialDisclosure(t);
  id("post-compose-open").click();

  const panel = id("post-compose-panel");
  assert.equal(panel.hidden, false, "the composer did not open, so this proves nothing");
  assert.equal(id("post-compose-open").getAttribute("aria-expanded"), "true");

  const publishing = document.querySelectorAll("a,button,summary,label")
    .filter((node) => /Publish/.test(textOf(node)));
  assert.deepEqual(publishing.map((node) => textOf(node)), ["Publish post"],
    "Social offers more than one control whose label says Publish");
  assert.equal(publishing[0].getAttribute("id"), "post-submit");

  // The other half of the pair: the control that opens the form and the heading
  // it reveals are the same words, and they are not the publishing ones.
  assert.equal(textOf(id("post-compose-open")), "Write a post");
  assert.equal(textOf(id("post-form-title")), "Write a post");

  // The consequence is untouched and still stands between the last field and the
  // button, named by the button that costs it. Order by walk, because the
  // harness rejects a descendant selector.
  const siblings = document.querySelector("#post-form").childElements.map((node) => node.getAttribute("id"));
  assert.ok(siblings.indexOf("post-consequence") >= 0 && siblings.indexOf("post-submit") >= 0,
    `the composer no longer authors the consequence and the button as siblings: ${siblings}`);
  assert.ok(siblings.indexOf("post-consequence") < siblings.indexOf("post-submit"),
    "the consequence moved below the button that costs it");
  assert.match(textOf(id("post-consequence")), /You cannot delete it afterwards/);
  assert.ok(id("post-submit").getAttribute("aria-describedby").split(/\s+/).includes("post-consequence"));
});

test("the feed is what a first-time visitor reads first, and the composer follows it", async (t) => {
  const { document } = await socialDisclosure(t);

  // Rendered order, in the source of truth for the markup: the feed panel and
  // the composer panel are siblings, and the feed is first. A CSS reordering
  // would satisfy neither this nor the tab order below.
  const panels = document.querySelector(".workspace").childElements
    .filter((node) => node.getAttribute("class")?.includes("-panel"));
  assert.deepEqual(panels.map((node) => node.getAttribute("class")),
    ["list-panel", "form-panel"],
    "the composer is authored ahead of the feed again");

  // And the fields are no longer the first interactive controls after the page
  // heading. Counted inside <main>, which is where the skip link lands: the
  // site nav above it is not what this change is about.
  const main = document.querySelector("#main-content");
  const stops = tabSequence(document).filter((node) => {
    for (let cursor = node; cursor; cursor = cursor.parentNode) if (cursor === main) return true;
    return false;
  });
  const composerFields = ["post-body", "post-image", "post-author", "post-submit"];
  assert.equal(composerFields.includes(stops[0]?.id), false,
    `the first control inside <main> is a composer field: ${stops[0]?.id}`);
  for (const field of composerFields) {
    assert.equal(stops.filter((node) => node.id === field).length, 0,
      `${field} is still a tab stop while the composer is collapsed`);
  }

  // The concrete sequence, not just a count, so a regression names itself: the
  // skip link's destination, then the trigger, then the feed's own controls.
  assert.equal(document.querySelector(".skip-link").getAttribute("href"), "#main-content");
  assert.equal(main.getAttribute("tabindex"), "-1");
  assert.deepEqual(stops.slice(0, 4).map((node) => node.id),
    ["post-compose-open", "post-name-filter", "post-time-filter", "post-filter-clear"],
    "the first controls after the page heading are not the trigger and then the feed");
  // "No more than three tab stops from the skip link to the first feed control":
  // the display-name filter is stop 2.
  assert.ok(stops.findIndex((node) => node.id === "post-name-filter") + 1 <= 3);
});

test("the trigger reveals the composer and puts focus in the post field", async (t) => {
  const { document, id } = await socialDisclosure(t);
  const trigger = id("post-compose-open");
  const panel = id("post-compose-panel");

  assert.equal(panel.hidden, true, "the composer ships open");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(foldedAway(id("post-body")), true, "the post field is reachable before it is revealed");

  trigger.click();

  assert.equal(panel.hidden, false, "activating the trigger did not reveal the composer");
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement?.id, "post-body",
    "focus did not land in the post field the trigger promised");
  // And the fields a keyboard reader now walks are the composer's, in order.
  const revealed = tabSequence(document).map((node) => node.id);
  assert.ok(revealed.indexOf("post-body") > revealed.indexOf("post-compose-open"));
  assert.ok(revealed.indexOf("post-body") < revealed.indexOf("post-image"));
});

test("closing the composer returns focus to the trigger, never to the top of the document", async (t) => {
  const { document, id } = await socialDisclosure(t);
  const trigger = id("post-compose-open");
  const panel = id("post-compose-panel");

  // Every way it closes today. The Close control first.
  trigger.click();
  id("post-compose-cancel").click();
  assert.equal(panel.hidden, true, "Close left the composer open");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement?.id, "post-compose-open",
    "Close dropped focus somewhere other than the control that opened the panel");

  // Escape from inside the panel, which is what the footer's disclosure honours.
  trigger.click();
  id("post-body").focus();
  pressKey(document, "Escape");
  assert.equal(panel.hidden, true, "Escape left the composer open");
  assert.equal(document.activeElement?.id, "post-compose-open",
    "Escape dropped focus somewhere other than the trigger");

  // And the trigger itself, pressed a second time.
  trigger.click();
  trigger.click();
  assert.equal(panel.hidden, true);
  assert.equal(document.activeElement?.id, "post-compose-open");
});

test("the character counter still announces in the composer the trigger revealed", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const document = page.document;
  const feed = mountSocialFeed(document, { posts: [], state: "ready", storage: page.storage });
  const counter = document.querySelector("#post-counter");

  // The live region ships with the panel and is never re-created, so the reveal
  // cannot drop an announcement: same node, same live attributes, afterwards.
  document.querySelector("#post-compose-open").click();
  assert.equal(document.querySelector("#post-counter"), counter, "the reveal re-created the live region");
  assert.equal(counter.getAttribute("aria-live"), "polite");
  assert.equal(counter.getAttribute("aria-atomic"), "true");
  assert.equal(foldedAway(counter), false, "the live region is announcing from inside something hidden");
  assert.equal(textOf(counter), "280");

  // Typed into after the reveal, the way a reader reaches it — not into a
  // composer that was never hidden.
  assert.equal(document.activeElement?.id, "post-body");
  typeText(document, "Shipped the reorder.");
  assert.equal(textOf(counter), String(MAX_POST_LENGTH - "Shipped the reorder.".length));
  assert.equal(feed.getPosts().length, 0);
});

test("the composer's three cautions still read word for word once it is open", async (t) => {
  const { document, id } = await socialDisclosure(t);
  id("post-compose-open").click();
  // The alt-text requirement lives with the image it describes, so it is on
  // screen exactly when an image is attached — the composer's own rule, which
  // this change moved and did not touch. This is the state src/social-page.js
  // puts the panel in when a file is chosen.
  id("compose-media").hidden = false;

  const cautions = {
    "post-image-alt-hint": "Describe what matters in the image for people who cannot see it. Up to 200 characters.",
    "post-author-hint": "The display name appears on your post in the Social feed, defaults to “Guest,” and cannot be changed after publishing.",
    "post-author-identity": "People groups image posts under this display name.",
    "post-consequence": "Anyone who visits Shiplog can read your post, its image, and the display name you publish it with. You cannot delete it afterwards, so post nothing you would not put on a public page.",
  };
  for (const [id_, wording] of Object.entries(cautions)) {
    const node = document.querySelector(`#${id_}`);
    assert.equal(textOf(node), wording, `${id_} was rewritten rather than moved`);
    // The text alone would pass behind a collapsed panel, so state the state.
    assert.equal(foldedAway(node), false, `${id_} is rendered inside something hidden`);
  }
  // The requirement marker beside the image description, in its own words.
  assert.equal(textOf(id("post-image-alt-required")), "(required with an image)");
  assert.equal(id("post-compose-panel").hidden, false);
});

// ---------------------------------------------------------------------------
// The draft the composer is holding (#1832).
//
// The composer's own first step sends a visitor to Paint in a second tab, and
// the Close control and Escape both take the panel away. What a half-written
// post survives was never pinned by a test: the disclosure keeps it because it
// reveals and hides one panel and never rebuilds it, which is a property of
// the implementation that nothing was holding in place. These are the
// assertions that make it a promise — and the same assertions are what the
// sentence beside the Paint steps now says out loud.
//
// Every one of them reads a field's value and its counter together: a counter
// left at its empty-form maximum over a field that still holds text is the
// visible half of the same bug, and it is what a reader would see first.
// ---------------------------------------------------------------------------

const DRAFT = "Shipped the retention pass, and drew the diagram next door.";
const ALT_TEXT = "A whiteboard diagram of the composer keeping its draft.";

/** The shipped markup with the feed wired, the way a reader meets the page. */
async function draftComposer(t, { create } = {}) {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const document = page.document;
  const feed = mountSocialFeed(document, {
    posts: [], state: "ready", storage: page.storage, create,
  });
  const id = (name) => document.querySelector(`#${name}`);
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  // Typed the way a visitor types it — focused control, one keystroke at a
  // time — because the counters this file asserts on only move on `input`.
  const typeInto = (field, text) => {
    id(field).focus();
    typeText(document, text);
  };
  return { page, document, feed, id, settle, typeInto };
}

test("the composer keeps the post and the display name across a close and a reopen", async (t) => {
  const { page, document, id, typeInto } = await draftComposer(t);
  const trigger = id("post-compose-open");
  const panel = id("post-compose-panel");

  trigger.click();
  assert.equal(document.activeElement?.id, "post-body");
  typeInto("post-body", DRAFT);
  typeInto("post-author", "Mina");

  // (a) Closed with the Close control, which is the "by mistake" exit.
  id("post-compose-cancel").click();
  assert.equal(panel.hidden, true, "Close left the composer open");
  assert.equal(document.activeElement?.id, "post-compose-open",
    "Close dropped focus somewhere other than the control that opened the panel");

  trigger.click();
  assert.equal(id("post-body").value, DRAFT, "the post a visitor had written was thrown away by a close");
  assert.equal(id("post-author").value, "Mina", "the display name was thrown away by a close");
  assert.equal(textOf(id("post-counter")), String(MAX_POST_LENGTH - DRAFT.length),
    "the counter went back to its empty-form maximum over a field that still holds a post");
  assert.equal(document.activeElement?.id, "post-body",
    "reopening did not put the caret in the first field");

  // (b) Closed with Escape from inside the panel, which is the keyboard exit —
  // and the one a visitor is most likely to hit by accident.
  id("post-body").focus();
  pressKey(document, "Escape");
  assert.equal(panel.hidden, true, "Escape left the composer open");
  assert.equal(document.activeElement?.id, "post-compose-open",
    "Escape dropped focus somewhere other than the trigger");

  trigger.click();
  assert.equal(id("post-body").value, DRAFT, "the post was thrown away by Escape");
  assert.equal(id("post-author").value, "Mina", "the display name was thrown away by Escape");
  assert.equal(textOf(id("post-counter")), String(MAX_POST_LENGTH - DRAFT.length));
  assert.equal(document.activeElement?.id, "post-body");

  // Nothing left this tab to hold it. The draft is kept by the panel that is
  // still standing, not by anything written down: browser storage is untouched
  // by the whole round trip, so the site's storage promises have nothing new to
  // answer for and a reload starts a fresh post.
  assert.equal(page.storage.length, 0,
    "the composer started writing the draft to browser storage");
});

test("a publish that fails keeps the draft, and closing the composer afterwards does not cost it either", async (t) => {
  const { document, id, settle, typeInto } = await draftComposer(t, {
    create: async () => { throw new Error("The posts service is unreachable."); },
  });
  const trigger = id("post-compose-open");

  trigger.click();
  typeInto("post-body", DRAFT);
  typeInto("post-author", "Mina");
  id("post-submit").click();
  await settle();

  // The composer said so, and it still holds every field: the reset below is
  // the success path's, and only the success path's.
  assert.equal(id("social-notice").hidden, false, "a failed publish said nothing at all");
  assert.equal(id("post-body").value, DRAFT, "a failed publish emptied the post field");
  assert.equal(id("post-author").value, "Mina");
  assert.equal(textOf(id("post-counter")), String(MAX_POST_LENGTH - DRAFT.length));

  id("post-compose-cancel").click();
  trigger.click();
  assert.equal(id("post-body").value, DRAFT,
    "the post survived the failure and was then lost to the close");
  assert.equal(id("post-author").value, "Mina");
  assert.equal(textOf(id("post-counter")), String(MAX_POST_LENGTH - DRAFT.length));
});

test("a publish that lands empties the draft, and reopening the composer shows an empty form", async (t) => {
  const { document, id, settle, typeInto } = await draftComposer(t, {
    create: async (post) => ({ ...post, id: "saved-1832", createdAt: "2026-08-17T09:00:00.000Z" }),
  });
  const trigger = id("post-compose-open");

  trigger.click();
  typeInto("post-body", DRAFT);
  typeInto("post-author", "Mina");
  id("post-submit").click();
  await settle();

  assert.equal(id("social-notice").classList.contains("is-success"), true,
    `the publish did not land: ${textOf(id("social-notice"))}`);
  assert.equal(id("post-body").value, "", "the published post was left in the field");
  assert.equal(textOf(id("post-counter")), String(MAX_POST_LENGTH));

  id("post-compose-cancel").click();
  trigger.click();
  assert.equal(id("post-body").value, "", "a published post came back on the next open");
  assert.equal(textOf(id("post-counter")), String(MAX_POST_LENGTH),
    "the counter reopened counting down from a post that was already published");
  assert.equal(textOf(id("post-image-alt-counter")), String(MAX_IMAGE_ALT_LENGTH));
  // The display name is deliberately not one of the emptied fields: it is who
  // this browser is (src/social.js remembers it on a landed publish), so it is
  // there for the next post rather than asked for again.
  assert.equal(id("post-author").value, "Mina",
    "the byline was cleared with the post, so the next post asks who you are again");
});

// The image half of the same round trip, on the page as it is served: the whole
// wiring, the real media composer, and a drawing arriving from Paint the way the
// second tab hands one over. Nothing here fakes the preview state — a test that
// sets `#compose-media` visible itself can only prove that a hidden panel stays
// hidden.
const PAINT_DRAWING = {
  content_type: "image/png",
  data: "iVBORw0KGgo=",
  preview: "data:image/png;base64,iVBORw0KGgo=",
  size: 12,
  width: 1,
  height: 1,
  source: "paint",
};

async function socialPageFromPaint(t) {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {
    routes: {
      "/social-demo-data.json": { posts: [] },
      "/api/social-posts?limit=100": { posts: [] },
      // `source` or the row is dropped as invalid and the publish is reported as
      // a failure that never happened.
      "/api/social-posts": {
        post: {
          id: "saved-1832", author: "Mina", content: DRAFT,
          timestamp: "2026-08-17T09:00:00.000Z", source: "human",
        },
      },
    },
  });
  // The drawing Paint left in this tab. src/social-page.js reads it off
  // sessionStorage, which this runtime does not ship as a global.
  const handed = new Map([[PAINT_HANDOFF_KEY, JSON.stringify(PAINT_DRAWING)]]);
  const savedSession = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", {
    value: {
      getItem: (key) => handed.get(key) ?? null,
      setItem: (key, value) => handed.set(key, String(value)),
      removeItem: (key) => handed.delete(key),
    },
    configurable: true,
    writable: true,
  });
  // The feed polls on a timer; nothing here waits on a refresh and a live
  // interval would outlast the test.
  const timers = [];
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (...args) => {
    const handle = realSetInterval(...args);
    timers.push(handle);
    return handle;
  };
  await importPageModule("/social-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogSocial === "ready",
    "the social page finished its first load");
  globalThis.setInterval = realSetInterval;
  t.after(() => {
    for (const handle of timers) clearInterval(handle);
    if (savedSession) Object.defineProperty(globalThis, "sessionStorage", savedSession);
    else delete globalThis.sessionStorage;
    page.restore();
  });
  const id = (name) => page.document.querySelector(`#${name}`);
  return { page, document: page.document, id };
}

test("the image, its description, and both counters survive a close and a reopen", async (t) => {
  const { document, id } = await socialPageFromPaint(t);
  const trigger = id("post-compose-open");

  trigger.click();
  assert.equal(id("compose-media").hidden, false, "the drawing from Paint never reached the composer");
  // The property, not the attribute: this harness reflects neither onto the
  // other, and `src` is set as a property by the page.
  assert.equal(id("compose-preview-image").src, PAINT_DRAWING.preview);

  id("post-body").focus();
  typeText(document, DRAFT);
  id("post-image-alt").focus();
  typeText(document, ALT_TEXT);

  // Escape, from inside the panel — the composer's keyboard exit.
  pressKey(document, "Escape");
  assert.equal(id("post-compose-panel").hidden, true, "Escape left the composer open");
  assert.equal(document.activeElement?.id, "post-compose-open",
    "Escape dropped focus somewhere other than the control that opened the panel");

  trigger.click();
  assert.equal(document.activeElement?.id, "post-body", "reopening skipped the first field");
  assert.equal(id("post-body").value, DRAFT);
  assert.equal(id("post-image-alt").value, ALT_TEXT, "the image description was thrown away by the close");
  // The preview still renders, and the control that takes the image back out is
  // still offered — both of them actually on screen, not merely present in a
  // panel nobody can see.
  assert.equal(id("compose-media").hidden, false, "the preview was gone on reopen");
  assert.equal(id("compose-preview-image").src, PAINT_DRAWING.preview);
  assert.equal(textOf(id("remove-image")), "Remove image");
  assert.equal(foldedAway(id("remove-image")), false, "Remove image is no longer offered");
  // And both counters describe the text that is there, not an empty form.
  assert.equal(textOf(id("post-counter")), String(MAX_POST_LENGTH - DRAFT.length));
  assert.equal(textOf(id("post-image-alt-counter")), String(MAX_IMAGE_ALT_LENGTH - ALT_TEXT.length));
});

test("publishing the drawing empties the composer, and reopening it offers no leftover image", async (t) => {
  const { document, id } = await socialPageFromPaint(t);
  const trigger = id("post-compose-open");

  trigger.click();
  id("post-body").focus();
  typeText(document, DRAFT);
  id("post-image-alt").focus();
  typeText(document, ALT_TEXT);
  id("post-submit").click();
  await waitFor(() => !id("social-notice").hidden, "the composer answered the publish");

  assert.equal(id("social-notice").classList.contains("is-success"), true,
    `the publish did not land: ${textOf(id("social-notice"))}`);

  id("post-compose-cancel").click();
  trigger.click();
  assert.equal(id("post-body").value, "", "the published post came back on the next open");
  assert.equal(id("post-image-alt").value, "", "the published image description came back on the next open");
  assert.equal(textOf(id("post-counter")), String(MAX_POST_LENGTH));
  assert.equal(textOf(id("post-image-alt-counter")), String(MAX_IMAGE_ALT_LENGTH));
  // No preview and nothing to remove: the media panel is away and the file
  // input is empty. Asserted on the panel rather than on the image's `src`,
  // because this harness keeps a property the page removed as an attribute.
  assert.equal(id("compose-media").hidden, true, "the published image was still on offer");
  assert.equal(foldedAway(id("remove-image")), true, "Remove image is offered with no image attached");
  assert.equal(id("post-image").value, "");
});

test("the composer tells the visitor its draft is kept, in the help style, beside the step that sends them away", async (t) => {
  const { document, id } = await socialDisclosure(t);
  id("post-compose-open").click();
  const note = id("post-draft-note");

  assert.equal(textOf(note),
    "Anything you have already typed is kept here while you are in the other tab, and while this panel is closed.");
  assert.equal(document.querySelectorAll("#post-draft-note").length, 1);
  // The shipped help style, not a new one: the same class every other line in
  // this form wears, which is what keeps this off styles.css.
  assert.equal(note.getAttribute("class"), "hint");
  assert.equal(note.tagName, "P");
  assert.equal(foldedAway(note), false, "the sentence only renders inside something collapsed");

  // Beside the numbered steps it answers for, after them, and inside the same
  // field: a reader meets it as they are deciding whether to leave for Paint.
  const order = documentOrder(document);
  assert.ok(order.indexOf(id("post-image-steps")) < order.indexOf(note),
    "the sentence is read before the steps it answers for");
  assert.ok(order.indexOf(note) < order.indexOf(id("post-image-alt")),
    "the sentence has drifted past the image description field");
  for (let cursor = note; ; cursor = cursor.parentNode) {
    assert.ok(cursor, "the sentence is not inside the image field it belongs to");
    if (cursor.getAttribute?.("class")?.includes("media-picker")) break;
  }

  // It adds no tab stop and no rival instruction: the steps stay the sequence,
  // this is the reassurance beside them.
  assert.equal(note.querySelectorAll("a,button,input").length, 0,
    "the sentence grew a focusable element");
  assert.doesNotMatch(textOf(note), /return to this tab/i,
    "the sentence restates a numbered step instead of answering it");
  // And it promises no more than the composer does: nothing is written to
  // storage, so it must not tell a reader their post is saved.
  assert.doesNotMatch(textOf(note), /\bsaved?\b|\bstored?\b|\bdraft is safe\b/i,
    "the sentence promises storage the composer does not have");
});
