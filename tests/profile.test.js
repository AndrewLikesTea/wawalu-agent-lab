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
  distinctAuthors, emptySummaryText, hasExplicitAuthor, imagePostCounts, loadingSummaryText,
  mergePostsById, normalizeProfileApiPosts, normalizeSeedPosts, pickerEntries, pickerNoteText, postDetailHref,
  singleNameNotice,
  profileAnnouncement, profileHref, profilePaintHref, profileResultsHeading, profileSummary, profileSummaryText,
  renderAuthorPicker, renderProfileGrid, renderProfileHeader, resolveProfileAuthor, selectProfilePosts,
} = await import("../src/profile.js");

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
  // An over-long name is ignored rather than truncated into someone else's.
  assert.equal(resolveProfileAuthor({ param: "x".repeat(61), stored: "Kai" }), "Kai");
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
  // An over-long name never wins, so it is not a choice the page has to honour.
  assert.equal(hasExplicitAuthor({ param: "x".repeat(61) }), false);
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
  assert.equal(authorChipLabel("Mina", 2), "Mina · 2 image posts");
  assert.equal(authorChipLabel("Ari", 1), "Ari · 1 image post");
  // A name with nothing to show stays in the picker; the count is what says so.
  assert.equal(authorChipLabel("Kai", 0), "Kai · 0 image posts");
  // Three states, not two. A store that has not answered says so; only an
  // answered store is allowed to say zero.
  assert.equal(authorChipLabel("Kai", null), "Kai · Counting…");
  assert.equal(authorChipLabel("Kai", undefined), "Kai · Counting…");
  // The selected entry carries a word and a glyph, so which one is showing is
  // not told by colour. The count survives the mark.
  assert.equal(authorChipLabel("Mina", 2, { selected: true }), "✓ Showing Mina · 2 image posts");
  assert.equal(authorChipLabel("Kai", null, { selected: true }), "✓ Showing Kai · Counting…");
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
    ["Kai · 1 image post", "✓ Showing Mina · 2 image posts"]);
  // Present on both, not omitted on the unpressed one: a toggle that only
  // marks the pressed chip reads as a plain button that happens to be pressed.
  assert.deepEqual(container.children.map((chip) => chip.getAttribute("aria-pressed")), ["false", "true"]);
  // The mark is text, so the selected chip is legible with colour off.
  assert.equal(container.children.filter((chip) => chip.textContent.includes("✓ Showing")).length, 1);
  // One silhouette for every entry: a display name is a static classification,
  // so nothing here is signalled by a changed chip treatment.
  assert.deepEqual(container.children.map((chip) => chip.className), ["profile-filter-option", "profile-filter-option"]);

  container.children[0].dispatch("click");
  assert.deepEqual(chosen, ["Kai"]);
});

test("the line over the picker says who is showing, and who chose them", () => {
  // A name nobody asked for is reported as the page's own suggestion, with the
  // control that undoes it named where it is.
  assert.equal(pickerNoteText("Mina", { preselected: true }),
    "Showing Mina’s image posts. We preselected this name for you; pick another below to switch.");
  // A shared link or a remembered name is a choice, and saying otherwise would
  // tell a reader they had not made the decision they had.
  assert.equal(pickerNoteText("Mina"), "Showing Mina’s image posts. Pick another name below to switch.");
  assert.doesNotMatch(pickerNoteText("Mina", { preselected: false }), /preselect/i);
  // With one entry there is nothing below to pick, so the sentence stops.
  assert.equal(pickerNoteText("Mina", { preselected: true, choices: 1 }), "Showing Mina’s image posts.");
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
    ["Kai · Counting…", "✓ Showing Mina · Counting…"]);
  assert.equal(container.children.filter((chip) => chip.textContent.includes("image post")).length, 0);
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
  assert.equal(tile.getAttribute("aria-label"), "Focus rings landed everywhere. — view full post on Social");
  assert.equal(first(tile, "profile-tile-link-label").textContent, "View full post on Social");

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
  assert.equal(skeleton.getAttribute("aria-hidden"), "true", "placeholders announce nothing");
  assert.equal(status.textContent, "Loading image posts…");
  assert.ok(byClass(skeleton, "profile-tile-skeleton").length > 0);
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

test("an empty profile separates viewing Social from creating and publishing an image", () => {
  const container = createElement("div");
  renderProfileGrid(container, [], { author: "Mina" });
  const empty = first(container, "empty-state");
  assert.equal(tags(empty, "P").length, 1, "the empty state renders one message, not two");
  assert.equal(first(empty, "empty-title").textContent, "Images made in Paint and published on Social appear here.");
  // Named, not gestured at: the visitor has to know where to go.
  assert.match(empty.textContent, /Paint/);

  // Two destinations, told apart by their labels rather than by their weight,
  // and neither of them a second reading of the sentence above.
  const actions = byClass(empty, "empty-action");
  assert.equal(actions.length, 2);
  const title = first(empty, "empty-title").textContent;
  for (const control of actions) {
    assert.ok(!title.includes(control.textContent),
      `the empty state's sentence repeats its own button: ${control.textContent}`);
  }

  // The primary is first, so the solid control, the reading order, and the tab
  // order all name the same link. An outlined secondary arriving first would put
  // the emphasis and the sequence in disagreement.
  const action = actions[0];
  // The site's one name for the act, plus the disclosure every route into Paint
  // carries: the editor opens in a new tab, so the label says so.
  assert.equal(action.textContent, "Create an image in Paint");
  assert.equal(first(action, "new-tab-note").textContent, ` ${PROFILE_EMPTY_COPY.newTabNote}`);
  assert.equal(action.href, "/paint/?from=profile&author=Mina");
  assert.equal(action.target, "_blank");
  assert.equal(action.rel, "noopener");
  assert.equal(action.tagName, "A", "the primary action is keyboard reachable without scripted key handling");
  assert.match(action.href, /^\/paint\//, "first-time visitors get a visible route into creation");
  assert.ok(!action.className.includes("empty-action-secondary"), "the primary action is styled as the secondary one");
  assert.equal(actions[1].textContent, "See every post on Social");
  assert.equal(actions[1].href, "/social.html");
  assert.ok(actions[1].className.includes("empty-action-secondary"), "the second action is not marked as secondary");
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
  assert.match(profile, /<legend id="profile-author-label">Show posts by display name<\/legend>/);
  // The group is what the hint describes, and the container profile.js fills is
  // inside it, so the instruction is attached to the controls rather than to one
  // of them.
  assert.match(profile, /<fieldset class="filter-group" aria-describedby="profile-author-hint">/);
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
    ["page intro", between(/<p class="profile-lede">([\s\S]*?)<\/p>/)],
    ["picker label", between(/<legend id="profile-author-label">([\s\S]*?)<\/legend>/)],
    ["picker hint", between(/<p class="hint profile-toolbar-hint" id="profile-author-hint">([\s\S]*?)<\/p>/)],
  ];

  for (const [surface, copy] of surfaces) {
    assert.notEqual(copy, "", `the ${surface} must still be on the page`);
    assert.ok(copy.includes(TERM), `the ${surface} must call the selected thing a "${TERM}": ${copy.trim()}`);
    for (const rival of RIVALS)
      assert.doesNotMatch(copy, rival, `the ${surface} must not name the same thing a second way`);
  }

  // The line about publishing keeps the term too: the page tells a reader how
  // to fill it, and it has to be the same word they just picked by. The act is
  // a link now, so the term sits outside it — matched around the tag rather
  // than inside one string.
  assert.match(html, /publish a post on Social<\/a> under a display name/);
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
  renderProfileHeader(elements, "Mina Okafor", { total: 3, withImages: 2, likes: 6, latest: "2026-07-15T09:00:00.000Z" });
  assert.equal(elements.avatar.textContent, "MO");
  assert.equal(elements.avatar.getAttribute("aria-hidden"), "true", "the avatar is decoration beside the name");
  assert.equal(elements.name.textContent, "Active display-name filter: Mina Okafor");
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

test("an empty header states the situation once, in image-post terms", () => {
  const elements = { avatar: createElement("span"), name: createElement("span"), summary: createElement("p") };
  renderProfileHeader(elements, "Mina Okafor", { total: 0, withImages: 0, likes: 0, latest: null });
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
  assert.notEqual(elements.summary.textContent, PROFILE_EMPTY_COPY.guidance);
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
  renderProfileGrid(grid, [], {});

  const spoken = [
    elements.summary.textContent,
    first(grid, "empty-title").textContent,
    profileAnnouncement("Mina", 0),
  ];
  // The announcement is the one place that may restate the description, because
  // a live region has no page around it to borrow context from.
  const onPage = spoken.slice(0, 2);
  assert.equal(new Set(onPage).size, onPage.length, "no two page regions print the same sentence");
  // The named wording survives in the announcement alone. On the page itself the
  // counts line states the same fact without the name, because the heading over
  // it has already given the subject and this page keeps the display name to two
  // visible elements in that region.
  assert.equal(onPage.filter((text) => text.includes(emptySummaryText("Mina"))).length, 0);
  assert.equal(spoken.filter((text) => text.includes(emptySummaryText("Mina"))).length, 1);
  assert.equal(onPage.filter((text) => text.includes("Mina")).length, 0);
  assert.equal(onPage.filter((text) => text === EMPTY_SUMMARY_LINE).length, 1);
  assert.equal(onPage.filter((text) => text.includes("Paint")).length, 1);
  // Neither the identity line nor the grid prints a bare count: an empty name
  // reads one sentence here and one sentence there. The zero itself belongs to
  // the results heading, which states it against a display name
  // (profileResultsHeading) rather than as a figure standing on its own.
  assert.equal(onPage.filter((text) => text.includes(countLabel(0, "image post"))).length, 0);
  assert.equal(profileResultsHeading("Mina", 0), "Mina · 0 image posts");
  assert.equal(profileAnnouncement("Mina", 0), "Mina hasn’t posted an image yet. Images made in Paint and published on Social appear here.");
  // Social's settled sentence with this page's noun in it, closing clause and
  // all: "Showing 12 posts, newest first." there, this here.
  assert.equal(profileAnnouncement("Mina", 2), "Showing 2 image posts by Mina, newest first.");
  assert.equal(profileAnnouncement("Mina", 1), "Showing 1 image post by Mina, newest first.");
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
  assert.match(html, /id="profile-summary">Counting image posts…</);
  assert.doesNotMatch(html, new RegExp(emptySummaryText("Ari")));
  // People's one retrieval status names the content type; the heading already
  // names the selected display name.
  assert.equal(loadingSummaryText("Ari"), "Loading image posts…");
  assert.match(html, /id="profile-status">Connecting to live updates…</);
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
