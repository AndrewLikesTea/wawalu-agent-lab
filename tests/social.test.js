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
  noMatchMessage,
  noMatchGuidance,
  CLEAR_FILTERS_LABEL,
  feedHeading,
  DEFAULT_FEED_HEADING,
  AUTHOR_TERM,
  MAX_POST_LENGTH,
  MAX_AUTHOR_LENGTH,
  MAX_IMAGE_ALT_LENGTH,
  DEFAULT_AUTHOR,
  mountSocialFeed,
} from "../src/social.js";
import { loadPage, pressKey, tabSequence, textOf } from "./support/browser.js";

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

// The keyboard hint is a promise about the keys, so it is checked against the
// keys: every group it names moves focus, each movement is named once, and the
// two arrow pairs are named for the different distances they actually travel.
test("the feed's keyboard hint names each bound movement once", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());

  const hint = textOf(page.document.querySelector(".feed-hint"));
  assert.equal(hint, "Use ← and → to move between posts, ↑ and ↓ to move between rows, and Home and End to jump to the first and last post. Each card holds the whole post, so there is nothing to open.");
  // Releases says "move between releases … Home and End to jump to the first
  // and last release"; Social says the same thing about posts, so one reader
  // learns one pattern.
  assert.match(hint, /Use ← and → to move between posts, ↑ and ↓ to [^,]+, and Home and End to jump/);
  assert.doesNotMatch(hint, /move to the post/, "one verb for moving, not 'move' beside 'move to'");
  // Nothing on a card is interactive, so the hint must not offer Enter.
  assert.doesNotMatch(hint, /Enter|Space/);

  const posts = [0, 1, 2, 3, 4].map((i) => ({
    id: `p${i}`, author: `A${i}`, body: `body ${i}`, createdAt: `2026-07-0${i + 1}T00:00:00.000Z`,
  }));
  mountSocialFeed(page.document, { posts, state: "ready" });
  const cards = page.document.querySelectorAll(".post-card");
  // The harness lays nothing out, so the grid the hint describes — two columns,
  // [0 1 / 2 3 / 4] — is supplied as the offsets social.js measures.
  cards.forEach((card, i) => { card.offsetTop = [0, 0, 320, 320, 640][i]; });
  const press = (from, key) => {
    cards[from].focus();
    pressKey(page.document, key);
    return cards.indexOf(page.document.activeElement);
  };

  assert.equal(press(0, "ArrowRight"), 1, "→ steps one post");
  assert.equal(press(1, "ArrowLeft"), 0, "← steps back one post");
  assert.equal(press(0, "ArrowDown"), 2, "↓ moves a whole row, which is not what → does");
  assert.equal(press(3, "ArrowUp"), 1, "↑ moves back a row");
  assert.equal(press(3, "Home"), 0, "Home jumps to the first post");
  assert.equal(press(1, "End"), 4, "End jumps to the last post");
  assert.equal(press(1, "Enter"), 1, "Enter does nothing, so the hint does not name it");
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
  // The caption is the one field a post cannot exist without, so its label says
  // so in the same parenthetical the other three fields use, and its hint — the
  // refusal an empty caption actually meets — is named by the textarea itself.
  assert.match(page, /<label for="post-body">Caption <span class="label-optional label-required">\(required\)<\/span><\/label>/);
  assert.match(page, /aria-describedby="post-body-hint post-counter-label post-counter"/);
  assert.match(page, /id="post-body-hint">Publish post stops on an empty caption/);
  assert.match(page, /id="post-counter"[^>]*aria-live="polite"/);
  assert.match(page, /id="post-count">Loading the Social feed…<\/span>/);
  // The count and the connection line describe one wait, so they ship the same
  // sentence rather than "Loading posts…" beside "Connecting to the Social feed…".
  assert.match(page, /id="feed-status">Loading the Social feed…<\/span>/);
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
  const previewFailure = "We couldn’t create an image preview. Choose Remove image to remove the file, then choose Upload image to upload it again. Confirm that the preview appears before publishing.";
  assert.ok(page.includes(`<p id="compose-preview-error" hidden>${previewFailure}</p>`));
  assert.ok(wiring.includes(`setStatus("${previewFailure}", true);`));
  assert.match(page, /id="post-image-alt"/);
  assert.match(page, /id="post-media-status" role="status" aria-live="polite"/);
  assert.match(page, /id="post-submit"[^>]*aria-describedby="post-consequence social-notice"/);
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
// act and stops there. The same pass pins the destination for image posts: this
// site has no page called Profile, so "profile" survives on Social only as the
// People page's URL and the class that styles its nav item, never as a word a
// reader sees.
test("the control that opens the composer names it, and agrees with it about images", async (t) => {
  const markup = await readFile(new URL("../src/social.html", import.meta.url), "utf8");
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());

  const entry = page.document.querySelector(".hero-actions").querySelectorAll("a")
    .filter((anchor) => anchor.getAttribute("href") === "#post-form");
  assert.equal(entry.length, 1, "the hero offers exactly one route into the composer");
  // One name for one thing. The trigger, an eyebrow, and the heading named this
  // form three ways — "Open the post form", "New post", "Write a post" — so a
  // visitor met the composer three times before a field, and the trigger read
  // like a different destination from the heading it opens. Held as one string
  // so the two assertions cannot drift apart the way the page did.
  const composerName = "Write a post";
  assert.equal(textOf(entry[0]), composerName,
    "the control that opens the composer stopped using the composer's own name");
  assert.equal(textOf(page.document.querySelector("#post-form-title")), composerName,
    "the heading and the control that opens it name the composer differently again");
  // Counted, not compared against null: a surviving element sends assert.equal
  // through the whole parsed page instead of failing.
  assert.equal(page.document.querySelector(".form-panel").querySelectorAll(".eyebrow").length, 0,
    "the composer carries a third name above its first field again");
  const rendered = textOf(page.document.querySelector("body"));
  assert.equal(rendered.split(composerName).length - 1, 2,
    "the composer name must appear once on the trigger and once on the heading");

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
  assert.equal(textOf(note),
    "Every display name below is invented for this demo or a name a visitor published under.",
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
  const intro = textOf(page.document.querySelector(".hero-social").querySelectorAll("p")[1]);
  assert.doesNotMatch(intro, /invented for this demo/,
    "the intro says who wrote the posts a second time, four screens from a card");
  assert.match(intro, /Posts use no customer or production data\.$/,
    "the demo-data sentence must stay the intro's last words");
});

// The sentence is a claim about the feed's authors, not about a fetch, so it
// has to survive every state social.js swaps the list between. A disclosure
// that only renders once posts arrive is missing from the two states — an open
// fetch and an empty feed — where a reader has the most time to read it.
test("who wrote the posts survives loading, populated, empty, and no-match", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());

  const sentence = "Every display name below is invented for this demo or a name a visitor published under.";
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

// The display name field said what it defaulted to and nothing about what the
// name means. Two facts belong where the name is chosen: it is the key People
// groups image posts by, and it is not an account — nobody owns or verifies one.
// People already says the second half ("is not a signed-in user"), so the
// composer borrows that clause word for word instead of inventing a third
// phrasing. Help text only: no heading, no link, no disclosure, nothing
// focusable, and the publish consequence at the button is left alone.
test("the display name field says what the name does and does not mean", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());

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
    "the input names its hints in reading order: the default, then what the name means");

  const text = textOf(identity[0]);
  assert.match(text, /People groups image posts by display name/,
    "the field stops saying that the name is how People groups a post");
  assert.match(text, /not a signed-in user/,
    "the field stops saying that a display name is not an account");
  assert.match(text, /anyone can publish under any name/,
    "the field stops saying that names are not reserved to anyone");

  // The “Guest” default survives the addition, in its own sentence.
  assert.equal(textOf(page.document.querySelector("#post-author-hint")), "Defaults to “Guest”.");

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

  // One phrasing across the two pages: People's sentence is what this matched.
  const people = await loadPage(new URL("../src/profile.html", import.meta.url), {});
  t.after(() => people.restore());
  assert.match(textOf(people.document.querySelector(".profile-role")), /not a signed-in user/,
    "People and Social drifted into two ways of saying a display name is not an account");

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
  assert.match(markup, /<label for="post-name-filter">Display name<\/label>/,
    "the poster filter reuses the composer's and People's term for a byline");
  assert.match(markup, /<option value="all">All display names<\/option>/,
    "the all-values option names the thing the menu holds, in the label's own term");
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
  assert.equal(textOf(options[0]), "All display names");
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

  // A narrowed feed says what it was narrowed from. Without the denominator,
  // "Showing 2 posts" and "Showing all 2 posts" are the same sentence to a
  // reader who cannot see the menus above it.
  assert.equal(feedSummarySentence({ shown: 3, total: 12, range: "from the past 24 hours", author: "Ari" }),
    "Showing 3 of 12 posts from the past 24 hours under the display name Ari.");
  assert.equal(feedSummarySentence({ shown: 1, total: 4, range: "from the past hour" }),
    "Showing 1 of 4 posts from the past hour.");
  assert.equal(feedSummarySentence({ shown: 2, total: 5, author: "Mina" }),
    "Showing 2 of 5 posts under the display name Mina.");
  // The plural follows the total, which is the noun being counted out of.
  assert.equal(feedSummarySentence({ shown: 1, total: 1, author: "Mina" }),
    "Showing 1 of 1 post under the display name Mina.");

  // A filtered zero states its zero — the number is the news — and the recovery
  // lives in the no-match panel below, which has a control that can act on it.
  assert.equal(feedSummarySentence({ shown: 0, total: 9, range: "from the past hour", author: "Ari" }),
    "Showing 0 of 9 posts from the past hour under the display name Ari.");
  assert.equal(feedSummarySentence({ shown: 0, total: 9, author: "Ari" }),
    "Showing 0 of 9 posts under the display name Ari.");
});

// The filtered dead end used to render the never-posted panel, which told a
// reader the feed was empty while it was in fact full and their own two menus
// were hiding it. These two lines are the opposite claim, and they are checked
// against the never-posted copy so the two can never read as the same screen.
test("the no-match copy names the filters and cannot be confused with the never-posted state", () => {
  assert.equal(noMatchMessage({ author: "Ari", range: "from the past 24 hours" }),
    "No posts match these filters: Ari · from the past 24 hours.");
  // The colon is what keeps the sentence grammatical when only one menu is set.
  assert.equal(noMatchMessage({ author: "Ari" }), "No posts match these filters: Ari.");
  assert.equal(noMatchMessage({ range: "from the past hour" }),
    "No posts match these filters: from the past hour.");

  assert.equal(noMatchGuidance(12), "Social still holds 12 posts. Clear the filters to read them.");
  assert.equal(noMatchGuidance(1), "Social still holds 1 post. Clear the filters to read them.");

  for (const text of [noMatchMessage({ author: "Ari" }), noMatchGuidance(3)]) {
    assert.doesNotMatch(text, /No posts on Social yet/);
    assert.doesNotMatch(text, /create an image in Paint/);
  }
  assert.equal(CLEAR_FILTERS_LABEL, "Clear filters");
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
  assert.equal(shown(), 3);
  // The sentence is the announced region, and it is in normal flow rather than
  // folded away or hidden — a live region a reader cannot see is one they are
  // told about but cannot check.
  assert.equal(summary.getAttribute("aria-live"), "polite");
  assert.equal(summary.hasAttribute("hidden"), false);
  assert.equal(summary.getAttribute("role"), null, "a role=status on the same text announces it twice");
  assert.equal(summary.querySelectorAll("[aria-live]").length, 0, "a nested live region announces twice");

  choose(nameFilter, "Ari");
  assert.equal(textOf(summary), "Showing 2 of 3 posts under the display name Ari.");
  assert.equal(shown(), 2, "the stated count is the number of cards rendered");

  choose(timeFilter, "hour");
  assert.equal(textOf(summary), "Showing 1 of 3 posts from the past hour under the display name Ari.");
  assert.equal(shown(), 1);

  choose(nameFilter, "all");
  assert.equal(textOf(summary), "Showing 1 of 3 posts from the past hour.",
    "an unset filter contributes no clause");

  choose(nameFilter, "Mina");
  assert.equal(shown(), 0);
  assert.equal(textOf(summary), "Showing 0 of 3 posts from the past hour under the display name Mina.");
  // Distinct from the never-posted empty state, which this change leaves alone.
  assert.doesNotMatch(textOf(summary), /No posts on Social yet/);

  page.document.querySelector("#post-filter-clear").click();
  assert.equal(textOf(summary), "Showing all 3 posts, newest first.");
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
  assert.match(textOf(panel), /No posts match these filters: Mina · from the past hour\./);
  assert.match(textOf(panel), /Social still holds 3 posts\. Clear the filters to read them\./);
  // Not the never-posted screen, in either of its halves.
  assert.doesNotMatch(textOf(panel), /No posts on Social yet/);
  assert.doesNotMatch(textOf(panel), /create an image in Paint/);

  // A real button, after the message in DOM order, and in the tab sequence.
  const buttons = feed.querySelectorAll("button");
  assert.equal(buttons.length, 1, "the dead end adds exactly one control");
  const clear = buttons[0];
  assert.equal(clear.tagName, "BUTTON");
  // type=button, so a control that happens to sit inside a form some day cannot
  // submit it.
  assert.equal(clear.type, "button");
  assert.equal(textOf(clear), "Clear filters");
  const order = feed.querySelectorAll("p,button").map((node) => node.tagName);
  assert.equal(order.at(-1), "BUTTON", "the control follows the message it recovers from");
  const sequence = tabSequence(page.document);
  assert.equal(sequence.includes(clear), true, "the in-region control is reachable by Tab");

  clear.click();
  assert.equal(shown(), 3, "recovery restores every post");
  assert.equal(nameFilter.value, "all");
  assert.equal(timeFilter.value, "all");
  assert.equal(textOf(page.document.querySelector("#feed-summary")), "Showing all 3 posts, newest first.");
  assert.equal(page.document.querySelectorAll(".empty-state").length, 0);

  // The button that was pressed is gone with the panel, so focus must have been
  // moved somewhere that still exists — never left on a removed node, never
  // dropped to the body.
  const landed = page.document.activeElement;
  assert.notEqual(landed, null, "focus is moved explicitly, not dropped");
  assert.equal(inDocument(landed), true, "focus lands on a node still in the document");
  assert.equal(landed.classList.contains("post-card"), true, "focus lands on the first restored post");
  assert.equal(landed.dataset.postId, "ari-recent");
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

// The shipped markup only pins the count a visitor sees before the feed mounts.
// Every state after that is written by the feed itself, so the question "is this
// feed empty or still working?" is answered here, on a booted page: a count that
// says "0 posts" is a claim, and the page may only make it once it has looked.
test("the post count never claims zero posts before the feed has any answer", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const count = page.document.querySelector("#post-count");
  const feed = mountSocialFeed(page.document, { posts: [], state: "loading" });

  assert.equal(textOf(count), "Loading the Social feed…", "the first fetch is open, so there is no count to give");
  assert.equal(page.document.querySelectorAll(".empty-state").length, 0, "loading copy never shares the page with empty-state guidance");
  // One wait, one sentence. The count, the panel over the empty grid, and the
  // connection line are all waiting on the same fetch, so a reader gets one
  // description of it and a screen reader hears one, not three.
  assert.deepEqual([...new Set([
    textOf(count),
    textOf(page.document.querySelector(".state-title")),
    textOf(page.document.querySelector("#feed-status")),
  ])], ["Loading the Social feed…"]);

  feed.setState("error");
  assert.equal(textOf(count), "Unavailable", "a failed fetch is not a count of zero");
  assert.match(textOf(page.document.querySelector(".empty-state-error")), /Social posts could not be loaded\./);

  feed.seed([]);
  assert.equal(textOf(count), "0 posts", "an answered fetch with nothing in it is a real zero");
  const empty = page.document.querySelector(".empty-state");
  assert.match(textOf(empty), /No posts on Social yet\./);
  assert.match(textOf(empty), /Publish a post, or create an image in Paint first\./);
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
