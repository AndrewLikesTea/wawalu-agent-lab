// Profile view: the pure core (normalization, selection, summary, links) and the
// render layer (tiles, states) that the grid depends on.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { byClass, createElement, first, ids, installDocument, tags } from "./support/dom.js";

installDocument();

const { FEED_LOADING_LINE } = await import("../src/social.js");

const {
  EMPTY_SUMMARY_LINE, PROFILE_EMPTY_COPY, authorChipLabel, authorInitials, captionFor, countLabel, defaultProfileAuthor,
  distinctAuthors, hasExplicitAuthor, imagePostCounts, loadingSummaryText,
  mergePostsById, normalizeProfileApiPosts, normalizeSeedPosts, pickerEntries, pickerNoteText, postDetailHref,
  singleNameNotice, profileActiveFilterLine,
  profileAnnouncement, profileEmptyText, profileHref, profilePaintHref, profileResultsHeading, profileSummary, profileSummaryText,
  renderAuthorPicker, renderProfileGrid, renderProfileHeader, resolveProfileAuthor, selectProfilePosts,
} = await import("../src/profile.js");

// The identity line People used to carry for an empty display name, before one
// zero state took over both the panel and the announcement. It is spelled out
// here rather than exported from the module, because the only thing left to say
// about it is that no render path prints it any more.
const retiredEmptyLine = (name) => `${name} hasn’t posted an image yet.`;

const apiPost = {
  id: "8a1f4c62-1c2a-4f4b-9a3d-2b6e5c7d8e9f",
  author: "Mina",
  content: "Focus rings landed everywhere.",
  caption: "The middle card, ringed.",
  timestamp: "2026-07-14T09:00:00.000Z",
  source: "shiplog-web",
  image_url: "/api/social-media/8a1f4c62-1c2a-4f4b-9a3d-2b6e5c7d8e9f/content",
  image_alt: "A card wrapped in a blue focus ring",
  image_width: 1200,
  image_height: 900,
  like_count: 3,
  comment_count: 1,
};

const imagePost = {
  id: "p-image",
  author: "Mina",
  body: "Focus rings landed everywhere.",
  caption: null,
  createdAt: "2026-07-14T09:00:00.000Z",
  likes: 3,
  comments: 1,
  image: { src: "/media/focus-ring.svg", alt: "A card wrapped in a blue focus ring", width: 1200, height: 900 },
};

const olderImagePost = { ...imagePost, id: "p-older", createdAt: "2026-07-10T09:00:00.000Z" };
const textPost = { id: "p-text", author: "Mina", body: "No picture on this one.", caption: null, createdAt: "2026-07-15T09:00:00.000Z", likes: 0, comments: 0 };
const otherPost = { ...imagePost, id: "p-other", author: "Kai" };

/* -------------------------------- pure core ------------------------------- */

test("the API read model becomes a renderable post, image and counts included", () => {
  const [post] = normalizeProfileApiPosts({ posts: [apiPost] });
  assert.equal(post.id, apiPost.id);
  assert.equal(post.author, "Mina");
  assert.equal(post.body, "Focus rings landed everywhere.");
  assert.equal(post.caption, "The middle card, ringed.");
  assert.equal(post.createdAt, apiPost.timestamp);
  assert.equal(post.likes, 3);
  assert.equal(post.comments, 1);
  assert.deepEqual(post.image, {
    src: "/api/social-media/8a1f4c62-1c2a-4f4b-9a3d-2b6e5c7d8e9f/content",
    alt: "A card wrapped in a blue focus ring",
    width: 1200,
    height: 900,
  });
});

test("a malformed row is dropped, and its neighbours still render", () => {
  const posts = normalizeProfileApiPosts({ posts: [
    { ...apiPost, content: "   " },
    { ...apiPost, id: "second", timestamp: "not-a-date" },
    { ...apiPost, id: "third" },
    null,
  ] });
  assert.deepEqual(posts.map((post) => post.id), ["third"]);
});

test("an off-origin image is refused, but the post it came with survives", () => {
  const [post] = normalizeProfileApiPosts({ posts: [{ ...apiPost, image_url: "https://cdn.example.com/tracker.gif" }] });
  assert.equal(post.image, undefined);
  assert.equal(post.body, "Focus rings landed everywhere.");
});

test("a text post normalizes with no image and zeroed counts", () => {
  const [post] = normalizeProfileApiPosts({ posts: [{ ...apiPost, image_url: null, image_alt: null, like_count: null, comment_count: undefined }] });
  assert.equal(post.image, undefined);
  assert.equal(post.likes, 0);
  assert.equal(post.comments, 0);
});

test("the demo seed shape normalizes the same way", () => {
  const [post] = normalizeSeedPosts([{
    id: "seed-post-1",
    author: "Mina",
    body: "Shipped the new focus-visible outlines.",
    createdAt: "2026-07-12T09:15:00.000Z",
    image: { src: "/media/focus-ring.svg", alt: "Stacked cards", width: 1200, height: 900 },
  }]);
  assert.equal(post.id, "seed-post-1");
  assert.equal(post.caption, null);
  assert.equal(post.image.src, "/media/focus-ring.svg");
  assert.equal(normalizeSeedPosts(undefined).length, 0);
});

test("merging prefers the earlier list, so live posts shadow same-id seeds", () => {
  const live = { ...imagePost, body: "live copy" };
  const seed = { ...imagePost, body: "seed copy" };
  const merged = mergePostsById([live], [seed, otherPost]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].body, "live copy");
});

test("the profile subject is the query param, then the remembered name, then a default", () => {
  assert.equal(resolveProfileAuthor({ param: "Mina", stored: "Kai" }), "Mina");
  assert.equal(resolveProfileAuthor({ param: "  ", stored: "Kai" }), "Kai");
  assert.equal(resolveProfileAuthor({ authors: ["Ari", "Kai"] }), "Ari");
  assert.equal(resolveProfileAuthor({}), "Guest");
  // A forwarded name past the author limit is answered under, not discarded: no
  // post can carry it, so it is a display name with no image posts, and this
  // page draws that. Ignoring it used to hand the reader Kai's pictures — or
  // "Guest" — under a name nobody had asked for. Whole, never truncated into
  // somebody else's name.
  assert.equal(resolveProfileAuthor({ param: "x".repeat(61), stored: "Kai" }), "x".repeat(61));
  // The remembered name keeps the limit: it is a name this browser may still
  // publish under, and storage refuses to hold an over-long one anyway.
  assert.equal(resolveProfileAuthor({ stored: "x".repeat(61), authors: ["Ari"] }), "Ari");
});

test("with nothing asked for, the landing name beats the first name alphabetically", () => {
  // The reported defect: a visitor following Social's "Open People" pointer
  // landed on whichever name sorted first and read a verdict about an empty
  // grid. A name with images outranks alphabetical order — but only as a
  // default: anything explicit still wins, empty profile included.
  assert.equal(resolveProfileAuthor({ authors: ["Ari", "Kai"], preferred: "Kai" }), "Kai");
  assert.equal(resolveProfileAuthor({ param: "Ari", authors: ["Ari", "Kai"], preferred: "Kai" }), "Ari");
  assert.equal(resolveProfileAuthor({ stored: "Ari", authors: ["Ari", "Kai"], preferred: "Kai" }), "Ari");
  // No name has an image: the fallback is unchanged, and the empty state is the
  // honest answer rather than a name picked at random.
  assert.equal(resolveProfileAuthor({ authors: ["Ari", "Kai"], preferred: null }), "Ari");
});

test("an explicit name is told apart from a first-time landing", () => {
  assert.equal(hasExplicitAuthor({ param: "Kai" }), true);
  assert.equal(hasExplicitAuthor({ stored: "Kai" }), true);
  assert.equal(hasExplicitAuthor({ param: "  ", stored: null }), false);
  assert.equal(hasExplicitAuthor({}), false);
  // A link that asked for an over-long name still asked for somebody, so the
  // page must not report that name back as a preselection of its own, and must
  // not move off it when the live feed lands.
  assert.equal(hasExplicitAuthor({ param: "x".repeat(61) }), true);
  assert.equal(hasExplicitAuthor({ stored: "x".repeat(61) }), false);
});

test("the landing name is the fullest profile, ties broken by the picker's own order", () => {
  const posts = [imagePost, olderImagePost, otherPost, textPost];
  assert.deepEqual(imagePostCounts(posts), [{ name: "Kai", images: 1 }, { name: "Mina", images: 2 }]);
  assert.equal(defaultProfileAuthor(posts), "Mina");
  // A tie is broken by distinctAuthors order, so the same feed always opens on
  // the same view rather than on whichever post happened to be fetched first.
  assert.equal(defaultProfileAuthor([imagePost, otherPost]), "Kai");
  assert.equal(defaultProfileAuthor([otherPost, imagePost]), "Kai");
  // Text-only posts are not images, and a feed with no images at all has no
  // landing name to offer.
  assert.equal(defaultProfileAuthor([textPost]), null);
  assert.equal(defaultProfileAuthor([]), null);
});

test("a picker entry carries its image-post count in the button's own text", () => {
  assert.equal(authorChipLabel("Mina", 2), "Filter People to Mina’s image posts · 2 image posts");
  assert.equal(authorChipLabel("Ari", 1), "Filter People to Ari’s image posts · 1 image post");
  // A name with nothing to show stays in the picker; the count is what says so.
  assert.equal(authorChipLabel("Kai", 0), "Filter People to Kai’s image posts · 0 image posts");
  // Three states, not two. A store that has not answered says so; only an
  // answered store is allowed to say zero.
  assert.equal(authorChipLabel("Kai", null), "Filter People to Kai’s image posts · Counting…");
  assert.equal(authorChipLabel("Kai", undefined), "Filter People to Kai’s image posts · Counting…");
  // The selected entry carries a word and a glyph, so which one is showing is
  // not told by colour. The count survives the mark.
  assert.equal(authorChipLabel("Mina", 2, { selected: true }), "✓ Selected: Filter People to Mina’s image posts · 2 image posts");
  assert.equal(authorChipLabel("Kai", null, { selected: true }), "✓ Selected: Filter People to Kai’s image posts · Counting…");
});

test("the picker lists every name the posts carry, and the selected one either way", () => {
  const posts = [imagePost, olderImagePost, otherPost, textPost];
  assert.deepEqual(pickerEntries(posts, "Mina"), [{ name: "Kai", images: 1 }, { name: "Mina", images: 2 }]);
  // A name the store does not carry is still selectable — it is what a shared
  // link or a remembered name may ask for — and it leads, where it was chosen.
  assert.deepEqual(pickerEntries(posts, "Nova"),
    [{ name: "Nova", images: 0 }, { name: "Kai", images: 1 }, { name: "Mina", images: 2 }]);
  // Counting the same way the grid selects: a text-only author is a real name
  // with a real zero, not a missing one.
  assert.deepEqual(pickerEntries([textPost], "Mina"), [{ name: "Mina", images: 0 }]);
});

test("each picker entry is a button that names itself, its count, and its state", () => {
  const container = createElement("div");
  const chosen = [];
  renderAuthorPicker(container, pickerEntries([imagePost, olderImagePost, otherPost], "Mina"), {
    author: "Mina",
    onSelect: (name) => chosen.push(name),
  });

  assert.deepEqual(container.children.map((chip) => chip.tagName), ["BUTTON", "BUTTON"]);
  // The harness reflects no properties, so `type` is asserted as the property
  // the render layer set, not as an attribute.
  assert.deepEqual(container.children.map((chip) => chip.type), ["button", "button"]);
  assert.deepEqual(container.children.map((chip) => chip.textContent),
    ["Filter People to Kai’s image posts · 1 image post", "✓ Selected: Filter People to Mina’s image posts · 2 image posts"]);
  // Present on both, not omitted on the unpressed one: a toggle that only
  // marks the pressed chip reads as a plain button that happens to be pressed.
  assert.deepEqual(container.children.map((chip) => chip.getAttribute("aria-pressed")), ["false", "true"]);
  // The mark is text, so the selected chip is legible with colour off.
  assert.equal(container.children.filter((chip) => chip.textContent.includes("✓ Selected:")).length, 1);
  // One silhouette for every entry: a display name is a static classification,
  // so nothing here is signalled by a changed chip treatment.
  assert.deepEqual(container.children.map((chip) => chip.className), ["profile-filter-option", "profile-filter-option"]);

  container.children[0].dispatch("click");
  assert.deepEqual(chosen, ["Kai"]);
});

test("the line over the picker says how to switch, and who chose the name showing", () => {
  // A name nobody asked for is reported as the page's own suggestion, with the
  // control that undoes it named where it is.
  assert.equal(pickerNoteText("Mina", { preselected: true }),
    "We picked this display name by default. You can choose another.");
  // A shared link or a remembered name is a choice, and saying otherwise would
  // tell a reader they had not made the decision they had.
  assert.equal(pickerNoteText("Mina"), "");
  assert.doesNotMatch(pickerNoteText("Mina", { preselected: false }), /preselect/i);
  // It states no name of its own. The selected chip below it is marked
  // "✓ Selected:" and the results region names the display name twice, so this
  // line telling it a fourth time is what made the page's answer unfindable.
  assert.doesNotMatch(pickerNoteText("Mina", { preselected: true }), /Mina/);
  assert.doesNotMatch(pickerNoteText("Mina"), /image posts/);
  // With one entry there is nothing below to pick, so there is no instruction
  // to give and singleNameNotice() carries the fact instead.
  assert.equal(pickerNoteText("Mina", { preselected: true, choices: 1 }), "");
});

test("a picker with one entry states the fact instead of drawing a choice", () => {
  assert.equal(singleNameNotice([{ name: "Ari", images: 3 }]), "Only one display name has image posts: Ari.");
  // A single name with nothing under it is a different sentence: the count is
  // zero, so claiming image posts for it would be wrong.
  assert.equal(singleNameNotice([{ name: "Ari", images: 0 }]), "Only one display name is in this feed: Ari.");
  // And an unanswered store claims no count at all, the way the chips say
  // "Counting…" rather than "0".
  assert.equal(singleNameNotice([{ name: "Ari", images: 3 }], { counted: false }),
    "Only one display name is in this feed: Ari.");
  // Two names are a choice, and a choice is drawn as controls.
  assert.equal(singleNameNotice([{ name: "Ari", images: 1 }, { name: "Bea", images: 1 }]), null);
  assert.equal(singleNameNotice([]), null);
});

test("a one-name picker renders the sentence and no button", () => {
  const container = createElement("div");
  renderAuthorPicker(container, pickerEntries([imagePost, olderImagePost], "Mina"), { author: "Mina" });
  assert.deepEqual(container.children.map((node) => node.tagName), ["P"]);
  assert.equal(container.textContent, "Only one display name has image posts: Mina.");
});

test("an uncounted picker says it is counting rather than claiming a zero", () => {
  const container = createElement("div");
  renderAuthorPicker(container, pickerEntries([imagePost, otherPost], "Mina"), { author: "Mina", counted: false });
  assert.deepEqual(container.children.map((chip) => chip.textContent),
    ["Filter People to Kai’s image posts · Counting…", "✓ Selected: Filter People to Mina’s image posts · Counting…"]);
  assert.equal(container.children.filter((chip) => /· \d+ image posts?$/.test(chip.textContent)).length, 0);
});

test("the grid selects this author's image posts, newest first", () => {
  const posts = [olderImagePost, textPost, otherPost, imagePost];
  const selected = selectProfilePosts(posts, "Mina");
  assert.deepEqual(selected.map((post) => post.id), ["p-image", "p-older"]);
  // Author matching is exact: a near-miss name is a different profile.
  assert.equal(selectProfilePosts(posts, "mina").length, 0);
  assert.equal(selectProfilePosts(posts, "").length, 0);
});

test("selection can include text posts, which is what the summary counts", () => {
  const posts = [olderImagePost, textPost, otherPost, imagePost];
  assert.equal(selectProfilePosts(posts, "Mina", { imagesOnly: false }).length, 3);
  const summary = profileSummary(posts, "Mina");
  assert.equal(summary.total, 3);
  assert.equal(summary.withImages, 2);
  assert.equal(summary.likes, 6);
  assert.equal(summary.latest, textPost.createdAt);
});

test("authors are listed once each, alphabetically", () => {
  assert.deepEqual(distinctAuthors([otherPost, imagePost, olderImagePost]), ["Kai", "Mina"]);
});

test("a tile always has a caption: the caption field, else the body", () => {
  assert.equal(captionFor({ caption: "A ringed card", body: "ignored" }), "A ringed card");
  assert.equal(captionFor({ caption: null, body: "No picture on this one." }), "No picture on this one.");
  assert.equal(captionFor(null), "");
});

test("links carry ids and names through the query string, encoded", () => {
  assert.equal(postDetailHref("a b&c"), "/post.html?id=a+b%26c");
  assert.equal(postDetailHref("a b&c", "Mina O'Neil"), "/post.html?id=a+b%26c&author=Mina+O%27Neil");
  // Provenance is opt-in and encoded like everything else: the post page reads
  // it to decide whether its one exit says Profile or Social.
  assert.equal(postDetailHref("p-1", "Mina", "profile"), "/post.html?id=p-1&author=Mina&from=profile");
  assert.equal(profileHref("Mina O'Neil"), "/profile.html?author=Mina%20O'Neil");
  assert.equal(profilePaintHref("Mina O'Neil"), "/paint/?from=profile&author=Mina+O%27Neil");
});

test("initials and counts read as English", () => {
  assert.equal(authorInitials("Mina Okafor"), "MO");
  assert.equal(authorInitials("Kai"), "KA");
  assert.equal(authorInitials("  "), "?");
  assert.equal(countLabel(1, "image post"), "1 image post");
  assert.equal(countLabel(0, "like"), "0 likes");
});

/* ------------------------------ render layer ------------------------------ */

test("a tile visibly links to the full Social post", () => {
  const container = createElement("div");
  renderProfileGrid(container, [imagePost], { author: "Mina" });

  assert.equal(container.getAttribute("aria-busy"), "false");
  const list = first(container, "profile-grid");
  assert.equal(list.tagName, "UL");
  assert.equal(list.getAttribute("role"), "list");

  const tile = first(container, "profile-tile");
  assert.equal(tile.tagName, "A", "the whole tile is the navigation target");
  // Every tile says where it sent the reader from, so the post page's single
  // back link can read "← Back to People" instead of guessing.
  assert.equal(tile.href, "/post.html?id=p-image&author=Mina&from=profile");
  assert.equal(tile.dataset.postId, "p-image");

  const caption = first(tile, "profile-tile-caption");
  assert.equal(caption.tagName, "FIGCAPTION");
  assert.equal(caption.textContent, "Focus rings landed everywhere.");
  assert.equal(tile.getAttribute("aria-label"), "Focus rings landed everywhere. — Open post");
  assert.equal(first(tile, "profile-tile-link-label").textContent, "Open post");

  const img = tags(tile, "IMG")[0];
  assert.equal(img.src, "/media/focus-ring.svg");
  assert.equal(img.alt, "A card wrapped in a blue focus ring");
  assert.equal(img.loading, "lazy");
  assert.equal(img.decoding, "async");
  // Intrinsic dimensions reserve the tile, so a late image cannot reflow the grid.
  assert.equal(img.width, 1200);
  assert.equal(img.height, 900);

  const meta = first(tile, "profile-tile-meta");
  assert.match(meta.textContent, /3 likes · 1 comment/);
  assert.equal(tags(meta, "TIME")[0].dateTime, imagePost.createdAt);
});

test("tiles render newest first, and each gets its own caption id", () => {
  const container = createElement("div");
  renderProfileGrid(container, [olderImagePost, imagePost], { author: "Mina" });
  const tiles = byClass(container, "profile-tile");
  assert.deepEqual(tiles.map((tile) => tile.dataset.postId), ["p-image", "p-older"]);
  const captionIds = byClass(container, "profile-tile-caption").map((caption) => caption.id);
  assert.equal(new Set(captionIds).size, 2, "ids are unique per tile");
});

// Every tile offers the same named step into the post, and offers it once. The
// tile itself is that control here — the whole picture is the hit target — so
// what is counted is the label printed on it, and what is checked is that the
// label is last in the tile: the action reads after the picture and the words
// it acts on, and is the last stop a reader tabs through before the next tile.
test("every tile carries one control named Open post, pointing at that post", () => {
  const container = createElement("div");
  renderProfileGrid(container, [olderImagePost, imagePost], { author: "Mina" });

  // Placeholders wear .profile-tile too, so a count that included them would
  // pass against a grid holding no posts at all.
  const tiles = byClass(container, "profile-tile").filter((tile) => !tile.classes.includes("profile-tile-skeleton"));
  assert.equal(tiles.length, 2, "the per-tile assertions below need real tiles");

  for (const tile of tiles) {
    const labels = byClass(tile, "profile-tile-link-label");
    assert.equal(labels.length, 1, "a tile names its way into the post exactly once");
    assert.equal(labels[0].textContent, "Open post");
    assert.equal(tile.tagName, "A");
    assert.equal(tile.href, `/post.html?id=${tile.dataset.postId}&author=Mina&from=profile`,
      "the tile opens its own post, not the grid's first one");
    assert.equal(tile.getAttribute("aria-label"), "Focus rings landed everywhere. — Open post");
    // Last child, by index rather than by node identity: a failed identity
    // comparison would print the whole parsed tile.
    assert.equal(tile.children.indexOf(labels[0]), tile.children.length - 1,
      "the action is offered before the reader has the post it acts on");
  }
});

test("a dead image leaves the caption and the link intact", () => {
  const container = createElement("div");
  renderProfileGrid(container, [imagePost], { author: "Mina" });

  const media = first(container, "profile-media");
  assert.equal(media.dataset.state, "loading");
  assert.equal(first(container, "profile-media-fallback").hidden, true);

  tags(container, "IMG")[0].dispatch("error");
  assert.equal(media.dataset.state, "error");
  assert.equal(tags(container, "IMG").length, 0, "the broken image element is removed");
  assert.equal(first(container, "profile-media-fallback").hidden, false);
  // The tile is still a working link with a name.
  const tile = first(container, "profile-tile");
  assert.equal(tile.href, "/post.html?id=p-image&author=Mina&from=profile");
  assert.equal(first(tile, "profile-tile-caption").textContent, "Focus rings landed everywhere.");
});

test("a loaded image settles to ready and keeps the fallback hidden", () => {
  const container = createElement("div");
  renderProfileGrid(container, [imagePost], { author: "Mina" });
  tags(container, "IMG")[0].dispatch("load");
  assert.equal(first(container, "profile-media").dataset.state, "ready");
  assert.equal(first(container, "profile-media-fallback").hidden, true);
});

test("the first load reserves a skeleton grid instead of a blank panel", () => {
  const container = createElement("div");
  const status = createElement("div");
  renderProfileGrid(container, [], { state: "loading", author: "Mina", statusRegion: status });
  assert.equal(container.getAttribute("aria-busy"), "true");
  const skeleton = first(container, "profile-grid-skeleton");
  // The status region is the announcement; the cells are the visible shape of
  // what is coming, and they name themselves without claiming to be six posts
  // Mina has or repeating the name the header above them already carries.
  assert.equal(skeleton.getAttribute("aria-hidden"), "true");
  assert.equal(status.textContent, "Loading image posts…");
  assert.equal(byClass(skeleton, "profile-tile-skeleton").length, 6);
  const labels = byClass(skeleton, "skeleton-label");
  assert.equal(labels.length, 6, "every reserved cell says what it is holding open");
  assert.ok(labels.every((node) => node.textContent === "Loading image post"));
  assert.equal(tags(skeleton, "A").length + tags(skeleton, "BUTTON").length, 0);
  assert.equal(byClass(container, "empty-state").length, 0);
});

test("posts already on screen outrank a pending or failed refresh", () => {
  for (const state of ["loading", "error"]) {
    const container = createElement("div");
    renderProfileGrid(container, [imagePost], { state, author: "Mina" });
    assert.equal(container.getAttribute("aria-busy"), "false");
    assert.equal(byClass(container, "profile-tile").length, 1, `${state} keeps the tiles`);
  }
});

test("a completed empty profile names the selected display name and routes to Publish post", () => {
  const container = createElement("div");
  renderProfileGrid(container, [], { author: "Mina" });
  const empty = first(container, "empty-state");
  assert.equal(first(empty, "empty-title").textContent,
    "The display name “Mina” has no image posts yet.");
  const actions = byClass(empty, "empty-action");
  assert.equal(actions.length, 1, "the empty state offers more than one next step");
  const action = actions[0];
  assert.equal(action.textContent, "Publish post");
  assert.equal(action.href, "/social.html#post-form");
  assert.equal(action.tagName, "A");
});

test("a failed load is offered a retry, not a false empty state", () => {
  const container = createElement("div");
  let retried = 0;
  renderProfileGrid(container, [], { state: "error", author: "Mina", onRetry: () => { retried += 1; } });
  assert.equal(first(container, "empty-title").textContent, "Image posts could not be loaded.");
  const retry = first(container, "empty-action");
  assert.equal(retry.tagName, "BUTTON");
  assert.equal(retry.type, "button");
  retry.dispatch("click");
  assert.equal(retried, 1);
});

test("re-rendering replaces the previous grid rather than appending to it", () => {
  const container = createElement("div");
  renderProfileGrid(container, [imagePost, olderImagePost], { author: "Mina" });
  renderProfileGrid(container, [imagePost], { author: "Mina" });
  assert.equal(byClass(container, "profile-tile").length, 1);
  assert.equal(container.children.length, 1);
});

/* ------------------------------- page wiring ------------------------------ */

test("the profile and post pages are wired, labelled, and reachable", async () => {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [home, social, profile, profileWiring, detail, detailWiring, component, detailComponent] = await Promise.all([
    read("src/index.html"), read("src/social.html"), read("src/profile.html"), read("src/profile-page.js"),
    read("src/post.html"), read("src/post-page.js"), read("src/profile.js"), read("src/post-detail.js"),
  ]);

  // A page nothing links to is a page nobody finds.
  assert.match(home, /href="\/profile\.html"/);
  assert.match(social, /href="\/profile\.html"/);

  assert.match(profile, /id="profile-grid"/);
  // The picker's label says what choosing an entry does, in the words Social's
  // own feed toolbar uses ("Show posts"), and names what is being chosen with
  // the term the composer, the feed filter, and this page's own description all
  // use. "Show posts by" alone left the menu's contents unnamed, so the page
  // described them as one thing and every other surface as another.
  assert.match(profile, /<legend id="profile-author-label">Choose a display name<\/legend>/);
  // The group is what the hint describes, and the container profile.js fills is
  // inside it, so the instruction is attached to the controls rather than to one
  // of them.
  assert.match(profile, /<fieldset class="filter-group" aria-describedby="profile-author-hint">/);
  // And the hint says what choosing an entry does. It used to define the term
  // instead — "The display name is the name shown on each post." — which a
  // reader could take in whole and still not know that pressing one narrows the
  // grid below, so the one sentence attached to the control explained nothing
  // about the control.
  assert.match(profile, /<p class="hint profile-toolbar-hint" id="profile-author-hint">\s*Choose a display name to see only the image posts published under it\.\s*<\/p>/);
  assert.doesNotMatch(profile, /The display name is the name shown on each post\./);
  assert.match(profile, /<div class="filter-options" id="profile-author"><\/div>/);
  // The picker is buttons, not a menu: an option list can hold the count but
  // cannot hold a pressed state a reader can see.
  assert.doesNotMatch(profile, /<select/);
  assert.match(profile, /id="profile-announcer"[^>]*aria-live="polite"/);
  assert.match(profile, /src="\/profile-page\.js"/);
  assert.match(profileWiring, /\/api\/social-posts\?limit=100/);

  assert.match(detail, /id="post-detail"/);
  assert.match(detail, /src="\/post-page\.js"/);
  assert.match(detailWiring, /\/api\/social-posts\//);

  // No innerHTML in any interactive layer: no user-generated HTML executes here.
  assert.doesNotMatch([component, detailComponent, profileWiring, detailWiring].join("\n"), /innerHTML/);
});

// One name for the thing the picker selects, on the page and on the post. The
// page used to describe itself with one word ("one demo persona's image posts")
// and label its picker with another, so a reader could not tell whether the menu
// held what the sentence promised. The surviving term is the one a post already
// carries: Social's composer field and its feed filter both say "display name".
//
// Pinned as a shared term rather than as one exact sentence, so the copy can be
// rewritten freely and only a second word for the same concept fails.
test("the People picker and the page's own description use one term for what is selected", async () => {
  const html = await readFile(new URL("../src/profile.html", import.meta.url), "utf8");
  const TERM = "display name";
  const RIVALS = [/demo persona/i, /\bpersona\b/i, /\bprofile\b/i, /\baccount\b/i, /\bauthor\b/i];
  const between = (pattern) => html.match(pattern)?.[1] ?? "";
  const surfaces = [
    // The line under the heading is where the page states what it shows now, so
    // it is the copy that has to use the picker's own term. The intro below it
    // used to open on that rule and no longer repeats it.
    ["page tagline", between(/<p class="profile-lede" id="page-tagline">([\s\S]*?)<\/p>/)],
    ["picker label", between(/<legend id="profile-author-label">([\s\S]*?)<\/legend>/)],
    ["picker hint", between(/<p class="hint profile-toolbar-hint" id="profile-author-hint">([\s\S]*?)<\/p>/)],
  ];

  for (const [surface, copy] of surfaces) {
    assert.notEqual(copy, "", `the ${surface} must still be on the page`);
    assert.ok(copy.includes(TERM), `the ${surface} must call the selected thing a "${TERM}": ${copy.trim()}`);
    for (const rival of RIVALS)
      assert.doesNotMatch(copy, rival, `the ${surface} must not name the same thing a second way`);
  }

  // The intro is still there, and it may not reintroduce a second word for what
  // the picker selects just because it stopped stating the rule itself.
  const intro = between(/<p class="profile-lede">([\s\S]*?)<\/p>/);
  assert.notEqual(intro, "", "the page intro must still be on the page");
  for (const rival of RIVALS)
    assert.doesNotMatch(intro, rival, "the page intro must not name the selected thing a second way");

  // The line about publishing keeps the term too: a reader is told how to put a
  // picture here, and it has to be the same word they just picked by. Pinned to
  // the term and its position rather than to the whole sentence — the sentence
  // is the helper beside the grid, and it names the publishing step with a link
  // now instead of in plain text.
  assert.match(html, /Write a post on Social<\/a> and publish it under a display name\./);
  const social = await readFile(new URL("../src/social.html", import.meta.url), "utf8");
  assert.match(social, /<label for="post-author">Display name <span class="label-optional">\(optional\)<\/span><\/label>/,
    "the composer names the same thing the picker selects");
});

test("the header shows who this is and what the counts mean", () => {
  const elements = {
    avatar: createElement("span"),
    name: createElement("span"),
    summary: createElement("p"),
  };
  renderProfileHeader(elements, "Mina Okafor", { total: 3, withImages: 2, likes: 6, latest: "2026-07-15T09:00:00.000Z" },
    { count: 2 });
  assert.equal(elements.avatar.textContent, "MO");
  assert.equal(elements.avatar.getAttribute("aria-hidden"), "true", "the avatar is decoration beside the name");
  // The chip states what is on screen: how many image posts, published under
  // which display name. The count is the caller's — the tiles it is about to
  // draw — not a second figure derived here.
  assert.equal(elements.name.textContent, "Showing 2 image posts published as Mina Okafor.");
  assert.match(elements.summary.textContent, /^2 image posts · 3 posts in total · last posted /);
  // The header writes the display name into exactly one of the elements it
  // touches. The heading beside them carries it a second time and that is the
  // whole budget for this region: the avatar must not spend a copy because it is
  // initials nobody should hear, and the counts line must not because it is read
  // directly under a heading that has just said the name.
  const written = [elements.avatar, elements.name, elements.summary]
    .filter((node) => node.textContent.includes("Mina Okafor"));
  assert.deepEqual(written, [elements.name], `${written.length} of the header's lines print the display name`);
});

// The reported defect: the line over the grid reported the page's internal state
// — "People is filtered to Ari." — which names a mechanism rather than a result,
// and left the reader to find the number somewhere else on the page.
test("the identity line says how many image posts are showing and under which name", () => {
  assert.equal(profileActiveFilterLine("Ari", 4), "Showing 4 image posts published as Ari.");
  // Counted the way every other number on this page is counted, so one image
  // post never lands as "1 image posts".
  assert.equal(profileActiveFilterLine("Bea", 1), "Showing 1 image post published as Bea.");
  assert.equal(profileActiveFilterLine("Bea", 1).includes(countLabel(1, "image post")), true);
  // A settled zero is its own sentence in the same voice, under the same name.
  // It is not the grid's empty state and does not borrow its words: that panel
  // still says what fills the grid, one region below.
  assert.equal(profileActiveFilterLine("Ari", 0), "Ari has no image posts yet.");
  assert.notEqual(profileActiveFilterLine("Ari", 0), profileEmptyText("Ari"));
  assert.notEqual(profileActiveFilterLine("Ari", 0), EMPTY_SUMMARY_LINE);
  // Nothing counted yet is not a zero: the pre-hydration frame and a first load
  // in flight name the display name and claim no number, exactly as the results
  // heading and the picker's "Counting…" do beside it.
  assert.equal(profileActiveFilterLine("Ari"), "Showing image posts published as Ari.");
  assert.equal(profileActiveFilterLine("Ari", null), profileActiveFilterLine("Ari"));
  assert.doesNotMatch(profileActiveFilterLine("Ari", null), /\d/);
  // The term the picker, the composer and Social's feed filter all use, and no
  // second word for it anywhere in the sentence.
  for (const rival of [/\bhandle\b/i, /\busername\b/i, /\bauthor\b/i, /\bposter\b/i, /\bprofile\b/i])
    for (const count of [null, 0, 1, 4])
      assert.doesNotMatch(profileActiveFilterLine("Ari", count), rival);
  // A name that is markup is text like any other: this line is written through
  // textContent, so it is carried whole rather than escaped or trimmed.
  assert.equal(profileActiveFilterLine('<a href="#">Social</a>', 2),
    'Showing 2 image posts published as <a href="#">Social</a>.');
});

test("an empty header states the situation once, in image-post terms", () => {
  const elements = { avatar: createElement("span"), name: createElement("span"), summary: createElement("p") };
  renderProfileHeader(elements, "Mina Okafor", { total: 0, withImages: 0, likes: 0, latest: null }, { count: 0 });
  // A settled zero is said plainly, under the name that was chosen, rather than
  // reported as a filter the reader has to interpret.
  assert.equal(elements.name.textContent, "Mina Okafor has no image posts yet.");
  // The empty line states the situation and names nobody: the heading above it
  // says "Mina Okafor · 0 image posts", so this line is read against a subject
  // the region has already given, and it used to open on that name as a third
  // visible copy of it. It still does not name the surface — it is never true
  // that "People" has no image posts, only that this display name has none.
  assert.equal(elements.summary.textContent, EMPTY_SUMMARY_LINE);
  assert.equal(elements.summary.textContent, "No image posts under this display name yet.");
  assert.doesNotMatch(elements.summary.textContent, /Mina/);
  // The description states the state; the grid's empty state gives the action.
  // Neither repeats the other's sentence — that repetition was the bug.
  assert.notEqual(elements.summary.textContent, profileEmptyText("Mina Okafor"));
});

test("the description carries the posted-but-no-images case, so the empty state need not", () => {
  // The old empty state spelled this out in a second paragraph. The counts say
  // it better, and they say it in one place.
  assert.equal(
    profileSummaryText({ total: 3, withImages: 0, likes: 0, latest: null }),
    "0 image posts · 3 posts in total",
  );
  // And it states the empty case without a display name, whatever it is passed:
  // the line is read under a heading that has already named one.
  assert.equal(
    profileSummaryText({ total: 0, withImages: 0, likes: 0, latest: null }),
    EMPTY_SUMMARY_LINE,
  );
});

test("the empty profile says it once across the whole page", () => {
  // Regression guard for the reported defect: the description, the heading
  // count, and the grid each used to hold their own copy of this sentence, and
  // two of them held it word-for-word.
  const summary = { total: 0, withImages: 0, likes: 0, latest: null };
  const elements = { avatar: createElement("span"), name: createElement("span"), summary: createElement("p") };
  renderProfileHeader(elements, "Mina", summary);
  const grid = createElement("div");
  renderProfileGrid(grid, [], { author: "Mina" });

  const spoken = [
    elements.summary.textContent,
    first(grid, "empty-title").textContent,
    profileAnnouncement("Mina", 0),
  ];
  // The announcement is the one place that may restate the description, because
  // a live region has no page around it to borrow context from.
  const onPage = spoken.slice(0, 2);
  assert.equal(new Set(onPage).size, onPage.length, "no two page regions print the same sentence");
  // The retired identity line is gone from the page and from the announcement
  // both: the name is carried by the zero state now, and the counts line states
  // the same fact without it, because the heading over it has already given the
  // subject and this page keeps the display name to two visible elements there.
  assert.equal(onPage.filter((text) => text.includes(retiredEmptyLine("Mina"))).length, 0);
  assert.equal(spoken.filter((text) => text.includes(retiredEmptyLine("Mina"))).length, 0);
  assert.equal(onPage.filter((text) => text.includes("Mina")).length, 1);
  assert.equal(onPage.filter((text) => text === EMPTY_SUMMARY_LINE).length, 1);
  assert.equal(onPage.filter((text) => text.includes("display name")).length, 2);
  // Neither the identity line nor the grid prints a bare count: an empty name
  // reads one sentence here and one sentence there. The zero itself belongs to
  // the results heading, which states it against a display name
  // (profileResultsHeading) rather than as a figure standing on its own.
  assert.equal(onPage.filter((text) => text.includes(countLabel(0, "image post"))).length, 0);
  assert.equal(profileResultsHeading("Mina", 0), "Mina · 0 image posts");
  assert.equal(profileAnnouncement("Mina", 0), "The display name “Mina” has no image posts yet.");
  // Social's settled sentence with this page's noun in it, closing clause and
  // all: "Showing 12 posts, newest first." there, this here.
  assert.equal(profileAnnouncement("Mina", 2), "Showing 2 image posts by Mina, newest first.");
  assert.equal(profileAnnouncement("Mina", 1), "Showing 1 image post by Mina, newest first.");
});

// A selected display name with nothing under it reads one way, whether or not
// another name in the same feed has pictures. This layer is given no view of the
// rest of the feed to reach a second wording with, and that is the point: the
// two zero states this page used to keep apart are one, so nothing a caller
// knows about the filter can bring the other one back.
test("the zero state does not vary with what the rest of the feed holds", () => {
  const grid = createElement("div");
  renderProfileGrid(grid, [], { state: "ready", author: "Ari" });
  const panel = first(grid, "empty-state");
  assert.equal(first(panel, "empty-title").textContent, profileEmptyText("Ari"));
  assert.equal(byClass(grid, "empty-state").length, 1, "one zero state, not two");
  assert.equal(byClass(grid, "empty-state-filtered").length, 0);

  // The same call carrying every option the retired filtered panel was fed.
  // They are not read any more, so they cannot change a word of this.
  const withFilter = createElement("div");
  renderProfileGrid(withFilter, [], {
    state: "ready", author: "Ari", total: 3, clearTo: "Zed", onClearFilters: () => {},
  });
  assert.equal(first(withFilter, "empty-title").textContent, profileEmptyText("Ari"));
  const actions = byClass(withFilter, "empty-action");
  assert.equal(actions.length, 1, "the zero state offers more than one next step");
  assert.equal(actions[0].textContent, PROFILE_EMPTY_COPY.actionLabel);
  assert.equal(actions[0].href, PROFILE_EMPTY_COPY.actionHref);
  // No button anywhere: the way back to a populated view is the picker above,
  // which is on screen in both of these situations.
  assert.equal(tags(withFilter, "BUTTON").length, 0);
});

test("the waiting line names image posts once without duplicating the selected display name", () => {
  assert.equal(loadingSummaryText(), "Loading image posts…");
  assert.equal(loadingSummaryText("Zed"), "Loading image posts…");
});

test("the profile page's static copy does not drift from the module's", async () => {
  // profile.html renders before the module runs, so its defaults are what a
  // first-time visitor actually reads first. That frame used to ship the empty
  // state — a verdict about a name nobody had chosen, and a false one for the
  // seeded feed — so it now says only that the counting has not happened yet.
  const html = await readFile(new URL("../src/profile.html", import.meta.url), "utf8");
  // The counts line ships with nothing in it. It used to wait as "Counting
  // image posts…" beside a status region that already said the image posts were
  // loading, which is one wait described twice; profile.js takes the element out
  // of the document entirely while a fetch is open, and the placeholder wording
  // is gone from the page.
  assert.match(html, /id="profile-summary"><\/p>/);
  assert.doesNotMatch(html, new RegExp(retiredEmptyLine("Ari")));
  // People's one retrieval status names the content type; the heading already
  // names the selected display name.
  assert.equal(loadingSummaryText("Ari"), "Loading image posts…");
  // And the connection line ships wordless. Its promise used to be authored
  // above the status that says the image posts are still loading, so the frame
  // with nothing in it made a promise and then admitted it had nothing — two
  // statuses, in the worse order. profile.js writes the sentence when it puts
  // the line back on a rendered grid; tests/live-connection-copy.test.js owns
  // the three states it can be in.
  assert.match(html, /id="profile-status"><\/span>/);
  assert.doesNotMatch(html, /will appear here on their own/);
  assert.equal((html.match(new RegExp(loadingSummaryText("Ari"), "g")) ?? []).length, 1,
    "People renders one authoritative loading message");
  assert.doesNotMatch(html, new RegExp(FEED_LOADING_LINE), "People is announcing Social's feed again");
  // The results heading ships the same words the module writes there, so the
  // frame before hydration reads as the state it is in: the display name the
  // seed lands on, and the posts under it, with nothing counted yet.
  assert.match(html, new RegExp(`id="grid-title">${profileResultsHeading("Ari")}<`));
  assert.doesNotMatch(html, /id="grid-title">[^<]*\d/, "the static heading counts posts nobody has counted");
  assert.equal(profileResultsHeading("Ari", 1), "Ari · 1 image post", "Social's own pluralisation");
  assert.equal(profileResultsHeading("Ari", 3), "Ari · 3 image posts");
  assert.equal(profileResultsHeading("Ari", 0), "Ari · 0 image posts");
  // The results panel's count chip is gone, not hidden: the number is the
  // heading's own text now, where the region it names carries it.
  assert.doesNotMatch(html, /id="profile-count"/);
  assert.doesNotMatch(html, /Start by sharing an image/);
});
