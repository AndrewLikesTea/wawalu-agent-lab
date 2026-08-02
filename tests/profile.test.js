// Profile view: the pure core (normalization, selection, summary, links) and the
// render layer (tiles, states) that the grid depends on.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { byClass, createElement, first, ids, installDocument, tags } from "./support/dom.js";

installDocument();

const {
  PROFILE_EMPTY_COPY, authorInitials, captionFor, countLabel, distinctAuthors, emptySummaryText,
  mergePostsById, normalizeProfileApiPosts, normalizeSeedPosts, postDetailHref,
  profileAnnouncement, profileHref, profilePaintHref, profileSummary, profileSummaryText,
  renderProfileGrid, renderProfileHeader, resolveProfileAuthor, selectProfilePosts,
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

test("a tile is a link to the post, named by its caption", () => {
  const container = createElement("div");
  renderProfileGrid(container, [imagePost], { author: "Mina" });

  assert.equal(container.getAttribute("aria-busy"), "false");
  const list = first(container, "profile-grid");
  assert.equal(list.tagName, "UL");
  assert.equal(list.getAttribute("role"), "list");

  const tile = first(container, "profile-tile");
  assert.equal(tile.tagName, "A", "the whole tile is the navigation target");
  // Every tile says where it sent the reader from, so the post page's single
  // back link can read "← Back to Profile" instead of guessing.
  assert.equal(tile.href, "/post.html?id=p-image&author=Mina&from=profile");
  assert.equal(tile.dataset.postId, "p-image");

  // The accessible name is the caption alone — usable in a link list, where the
  // alt text plus counts would not be.
  const caption = first(tile, "profile-tile-caption");
  assert.equal(caption.tagName, "FIGCAPTION");
  assert.equal(caption.textContent, "Focus rings landed everywhere.");
  assert.equal(tile.getAttribute("aria-labelledby"), caption.id);
  assert.ok(ids(tile).includes(caption.id), "the label target resolves inside the tile");

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
  renderProfileGrid(container, [], { state: "loading", author: "Mina" });
  assert.equal(container.getAttribute("aria-busy"), "true");
  const skeleton = first(container, "profile-grid-skeleton");
  assert.equal(skeleton.getAttribute("aria-hidden"), "true", "placeholders announce nothing");
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
  assert.equal(action.textContent, "Create an image in Paint");
  assert.equal(action.href, "/paint/?from=profile&author=Mina");
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
  assert.match(profile, /<label for="profile-author">/);
  assert.match(profile, /id="profile-author"[^>]*aria-describedby="profile-author-hint"/);
  assert.match(profile, /id="profile-announcer"[^>]*aria-live="polite"/);
  assert.match(profile, /src="\/profile-page\.js"/);
  assert.match(profileWiring, /\/api\/social-posts\?limit=100/);

  assert.match(detail, /id="post-detail"/);
  assert.match(detail, /src="\/post-page\.js"/);
  assert.match(detailWiring, /\/api\/social-posts\//);

  // No innerHTML in any interactive layer: no user-generated HTML executes here.
  assert.doesNotMatch([component, detailComponent, profileWiring, detailWiring].join("\n"), /innerHTML/);
});

test("the header shows who this is and what the counts mean", () => {
  const elements = {
    avatar: createElement("span"),
    name: createElement("span"),
    roleName: createElement("span"),
    summary: createElement("p"),
  };
  renderProfileHeader(elements, "Mina Okafor", { total: 3, withImages: 2, likes: 6, latest: "2026-07-15T09:00:00.000Z" });
  assert.equal(elements.avatar.textContent, "MO");
  assert.equal(elements.avatar.getAttribute("aria-hidden"), "true", "the avatar is decoration beside the name");
  assert.equal(elements.name.textContent, "Mina Okafor");
  assert.equal(elements.roleName.textContent, "Mina Okafor", "the demo-persona framing follows the selected name");
  assert.match(elements.summary.textContent, /^2 image posts · 3 posts in total · last posted /);
});

test("an empty header states the situation once, in image-post terms", () => {
  const elements = { avatar: createElement("span"), name: createElement("span"), summary: createElement("p") };
  renderProfileHeader(elements, "Mina Okafor", { total: 0, withImages: 0, likes: 0, latest: null });
  // The empty line names the person the page is showing, not the surface: it is
  // never true that "People" has no image posts, only that this name has none.
  assert.equal(elements.summary.textContent, "Mina Okafor hasn’t posted an image yet.");
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
  assert.equal(
    profileSummaryText({ total: 0, withImages: 0, likes: 0, latest: null }, "Mina"),
    "Mina hasn’t posted an image yet.",
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
    countLabel(0, "image post"),
    first(grid, "empty-title").textContent,
    profileAnnouncement("Mina", 0),
  ];
  // The announcement is the one place that may restate the description, because
  // a live region has no page around it to borrow context from.
  const onPage = spoken.slice(0, 3);
  assert.equal(new Set(onPage).size, onPage.length, "no two page regions print the same sentence");
  assert.equal(onPage.filter((text) => text.includes(emptySummaryText("Mina"))).length, 1);
  assert.equal(onPage.filter((text) => text.includes("Paint")).length, 1);
  assert.equal(spoken[1], "0 image posts", "the heading count is a count, not a sentence");
  assert.equal(profileAnnouncement("Mina", 0), "Mina hasn’t posted an image yet. Images made in Paint and published on Social appear here.");
  assert.equal(profileAnnouncement("Mina", 2), "Showing 2 image posts by Mina.");
});

test("the profile page's static copy does not drift from the module's", async () => {
  // profile.html renders before the module runs, so its defaults are the empty
  // state a first-time visitor actually sees first.
  const html = await readFile(new URL("../src/profile.html", import.meta.url), "utf8");
  // "Ari" is the pre-hydration name in the line above, so the static empty
  // sentence has to be built from that same name and nothing else.
  assert.match(html, new RegExp(`id="profile-summary">${emptySummaryText("Ari")}<`));
  assert.match(html, new RegExp(`id="profile-count">${countLabel(0, "image post")}<`));
  assert.doesNotMatch(html, /Start by sharing an image/);
});
