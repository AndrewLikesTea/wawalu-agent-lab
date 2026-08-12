// People, driven as a page: the order a reader meets the controls in, the view
// they land on when they followed Social's "Open People" pointer and asked for
// nobody in particular, and what changing the picker does.
//
// tests/profile.test.js covers the pure core and the render layer. This boots
// the shipped markup with the shipped wiring, because the defect this page had
// was not in either half on its own: the picker rendered correctly, below a
// conclusion about a name nobody had chosen.
//
// The feed is built here rather than committed as a fixture, so a change to the
// bundled demo posts can never quietly decide what these tests assert.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, textOf, tabSequence, pressKey, pressTab } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const PAGE_URL = new URL("../src/profile.html", import.meta.url);
const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";

const image = (name) => ({ src: `/media/${name}.svg`, alt: `A drawing signed ${name}`, width: 1200, height: 900 });

const seedPost = (id, author, { withImage = true } = {}) => ({
  id,
  author,
  body: `${id} from ${author}`,
  caption: null,
  createdAt: `2026-07-${id.slice(-2)}T09:00:00.000Z`,
  likes: 0,
  comments: 0,
  ...(withImage ? { image: image(author) } : {}),
});

// Zed leads on image posts; Bea has one; Ari has posted, but never a picture.
// Alphabetical order and image-post order therefore disagree, which is the only
// way to tell a landing rule that counts images from one that sorts names.
const SEED_FEED = {
  posts: [
    seedPost("p-11", "Ari", { withImage: false }),
    seedPost("p-12", "Zed"),
    seedPost("p-13", "Bea"),
    seedPost("p-14", "Zed"),
  ],
};

// Document order, the same pre-order walk a browser reads the page in.
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

async function people({ search = "", storage = {}, live = { posts: [] }, seed = SEED_FEED } = {}) {
  const page = await loadPage(PAGE_URL, {
    storage,
    location: { search },
    routes: { [SEED_ROUTE]: seed, [LIVE_ROUTE]: live },
  });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0; // The page's 30-second refresh must not outlive the test.
  const replaced = [];
  globalThis.window.history = { replaceState: (...args) => replaced.push(args) };
  await importPageModule("/profile-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogProfile === "ready", "the first load settles");
  return {
    document,
    replaced,
    storage: page.storage,
    navigations: page.navigations,
    picker: document.querySelector("#profile-author"),
    restore() { globalThis.setInterval = savedInterval; page.restore(); },
  };
}

// The picker's own chips, in the order a reader tabs through them. The harness
// rejects descendant selectors, so this reads the container's children rather
// than querying "#profile-author button".
const chips = (page) => page.picker.children.filter((node) => node.tagName === "BUTTON");
const chipTexts = (page) => chips(page).map((chip) => textOf(chip));
const selectedChip = (page) => chips(page).find((chip) => chip.getAttribute("aria-pressed") === "true") ?? null;
const chipFor = (page, name) => chips(page).find((chip) => chip.dataset.author === name);

// The results panel's heading, which is also that section's accessible name.
const resultsHeading = (document) => textOf(document.querySelector("#grid-title"));

// The tiles the grid actually drew. Counted, never assumed: the whole point of
// the heading's number is that it agrees with this.
const tileCount = (document) => document.querySelectorAll(".profile-tile").length;

// The regions that speak to the reader on the page. The two polite live regions
// inside the panel are left out on purpose: an announcement has no page around
// it to borrow context from, so it may restate what the page already shows.
const spokenRegions = (document) => [
  textOf(document.querySelector(".profile-identity")),
  textOf(document.querySelector(".section-heading")),
  textOf(document.querySelector("#profile-grid")),
];

test("the picker is read and reached before the name, the count, and the results", async () => {
  const page = await people();
  try {
    const { document } = page;
    const order = documentOrder(document);
    const at = (selector) => order.indexOf(document.querySelector(selector));

    // Real markup order, not a repositioning: the control that chooses whose
    // posts these are comes before every element that reports the answer.
    for (const selector of ["#profile-author-label", "#profile-author", "#profile-author-hint"]) {
      assert.ok(at(selector) < at(".profile-identity"), `${selector} still renders after the persona header`);
      assert.ok(at(selector) < at(".list-panel"), `${selector} still renders after the results`);
    }
    assert.ok(at("#profile-author") < at("#profile-name"));
    assert.ok(at("#profile-author") < at("#profile-summary"));
    assert.ok(at("#profile-author") < at("#profile-grid"));

    // And the tab sequence agrees, without a tabindex propping it up: every
    // display name is its own tab stop, in reading order, and they are the first
    // controls a keyboard reaches inside the main content. Ahead of them is the
    // intro's link to Social, which is a word in the opening sentence rather
    // than a control on this view — a reader who wants the whole feed meets the
    // way to it before the filter they would otherwise have to escape.
    const inMain = tabSequence(document).filter((element) => element.closest("#main-content"));
    assert.equal(inMain[0].getAttribute("href"), "/social.html",
      "the first tab stop in main is not the intro's route to Social");
    assert.equal(inMain[0].parentNode?.classList?.contains("profile-lede"), true);
    assert.deepEqual(inMain.slice(1, 4).map((element) => element.dataset.author), ["Ari", "Bea", "Zed"],
      "the first controls in main are not the display-name buttons in reading order");
    for (const chip of chips(page))
      assert.equal(chip.getAttribute("tabindex"), null, "the order is markup order, not a tabindex trick");
  } finally {
    page.restore();
  }
});

test("a first-time visitor lands on a display name that has image posts", async () => {
  const page = await people();
  try {
    const { document } = page;
    // Zed has the most image posts; Ari sorts first and has none. Landing on Ari
    // is the reported defect — a verdict about an empty name nobody chose.
    assert.equal(selectedChip(page)?.dataset.author, "Zed");
    assert.equal(textOf(document.querySelector("#profile-name")), "Active display-name filter: Zed",
      "the header names someone other than the picker's own value");
    assert.match(textOf(document.querySelector(".profile-role")),
      /^A display name in the Social feed is not a signed-in user[\s\S]*anyone can publish under any name\.$/,
      "the display-name caveat is not the general one");
    assert.equal(textOf(document.querySelector(".profile-role")).includes("Zed"), false,
      "the caveat spends a third visible copy of the display name");
    // The scope is the intro's to state, once, and it is the intro that carries
    // the link. This paragraph and the eyebrow over the grid both used to
    // restate the rule in their own words.
    assert.match(textOf(document.querySelector(".profile-lede")),
      /^People shows the image posts published under one display name — open Social when you want the whole feed, including posts with no image\./);
    // What a reader who scrolled straight to the grid meets: the heading counts
    // image posts, the eyebrow above it orders them. Neither repeats the other.
    const panelHeading = document.querySelector(".list-heading");
    assert.equal(textOf(panelHeading.querySelectorAll(".eyebrow")[0]), "Newest first");
    assert.match(textOf(document.querySelector("#profile-summary")), /^2 image posts/);
    assert.equal(document.querySelectorAll(".profile-tile").length, 2);
    assert.equal(document.querySelectorAll(".empty-state").length, 0);
    // A default is not a choice: nothing was written on the reader's behalf.
    assert.equal(page.storage.getItem("shiplog.social.author"), null);
    assert.equal(page.replaced.length, 0);
  } finally {
    page.restore();
  }
});

// The waiting copy is People's own — the image posts under the selected display
// name — and it is copy for a wait, so it must not outlive one. It used to be
// Social's old whole-feed loading message, which announced the whole feed on the
// page that tells a reader to open Social when they want it, and was the first
// thing a screen reader read here.
test("no placeholder is still announcing a load once the posts are on screen", async () => {
  const page = await people();
  try {
    const { document } = page;
    assert.equal(tileCount(document), 2, "the settled page has no posts, so nothing replaced the placeholders");
    const settled = [...spokenRegions(document), textOf(document.querySelector(".feed-connection"))];
    for (const text of settled) {
      assert.doesNotMatch(text, /Loading/, "a loading placeholder outlived the posts it stood in for");
    }
    // Replaced by what the reader was waiting for, not merely emptied.
    assert.match(textOf(document.querySelector("#profile-summary")), /^2 image posts/);
    assert.equal(textOf(document.querySelector("#profile-status")), "New image posts appear here without reloading the page.");

    // And a name switch re-renders those regions rather than dropping back to a
    // placeholder — the state the old copy was wrong in twice over.
    chipFor(page, "Bea").click();
    for (const text of spokenRegions(document)) assert.doesNotMatch(text, /Loading/);
    assert.match(textOf(document.querySelector("#profile-summary")), /^1 image post /);
  } finally {
    page.restore();
  }
});

// The reported defect: in about a hundred words, People told a reader what it
// shows and where the rest of the posts are three times — the intro, the
// paragraph beside the picker, and the eyebrow over the grid — and offered the
// same route into Paint twice. A first-time visitor has the rule after the
// first sentence; every telling after that is a page repeating itself.
test("People states the images-only rule once and offers each route once", async () => {
  const page = await people();
  try {
    const main = page.document.getElementById("main-content");
    const anchors = main.querySelectorAll("a");
    const rendered = textOf(main);

    // Counted over the rendered page, hydrated, not over the source: what a
    // reader hears is what the module wrote, not what the markup shipped.
    assert.equal(rendered.split("including posts with no image").length - 1, 1,
      "the intro's rule is stated more than once in the main content");
    assert.doesNotMatch(rendered, /This view shows image posts only/);
    assert.doesNotMatch(rendered, /posts without images are on Social/);
    // The ordering label orders, and stops there: it used to carry the rule as
    // a tail on the end of it.
    assert.equal(textOf(main.querySelector(".list-heading").querySelectorAll(".eyebrow")[0]), "Newest first");

    // Two routes to Social, and they go to different places for different
    // reasons: the intro's states the rule and opens the whole feed, and the
    // helper beside the grid opens the composer, because publishing is the one
    // thing People cannot do. Neither is a spare copy of the other, so each is
    // pinned to its own sentence and its own destination.
    const toSocial = anchors.filter((anchor) => (anchor.getAttribute("href") ?? "").startsWith("/social.html"));
    assert.equal(toSocial.length, 2, "the main content changed how many times it routes to Social");
    assert.equal(toSocial[0].getAttribute("href"), "/social.html");
    assert.equal(toSocial[0].parentNode?.classList?.contains("profile-lede"), true,
      "the link to the whole feed is not in the sentence that states the rule");
    assert.equal(toSocial[1].getAttribute("href"), "/social.html#post-form");
    assert.equal(textOf(toSocial[1]), "Publish a post on Social");
    assert.equal(toSocial[1].parentNode?.classList?.contains("feed-create"), true,
      "the route to the composer is not in the helper beside the grid");

    // One route into Paint, beside the pictures that prompt it, still saying
    // what the tab does in its own text.
    const toPaint = anchors.filter((anchor) => textOf(anchor).startsWith("Create an image in Paint"));
    assert.equal(toPaint.length, 1, "the main content offers Paint more than once");
    assert.equal(textOf(toPaint[0]), "Create an image in Paint (opens in a new tab)");
    assert.equal(toPaint[0].getAttribute("target"), "_blank");
    assert.equal(toPaint[0].getAttribute("rel"), "noopener");
    assert.equal(toPaint[0].getAttribute("id"), "profile-paint-route");
  } finally {
    page.restore();
  }
});

test("an explicit name wins even when it has no image posts", async () => {
  for (const [how, options] of [
    ["a shared link", { search: "?author=Ari" }],
    ["the remembered name", { storage: { "shiplog.social.author": "Ari" } }],
  ]) {
    const page = await people(options);
    try {
      const { document } = page;
      assert.equal(selectedChip(page)?.dataset.author, "Ari", `${how} did not survive the landing default`);
      assert.equal(textOf(document.querySelector("#profile-name")), "Active display-name filter: Ari");
      assert.equal(document.querySelectorAll(".profile-tile").length, 0);
      assert.equal(document.querySelectorAll(".empty-state").length, 1);
      const status = document.querySelector("#profile-feed-status");
      assert.equal(status.hidden, false);
      assert.equal(document.querySelectorAll("#profile-feed-status").length, 1);

      chipFor(page, "Zed").click();
      assert.equal(document.querySelectorAll(".profile-tile").length, 2);
      assert.equal(status.hidden, true, "switching from an empty author hides the stale status");
      assert.equal(textOf(status), "", "empty guidance cannot survive beside another author's posts");
    } finally {
      page.restore();
    }
  }
});

test("People uses one status node for loading, error, and recovery to live posts", async (t) => {
  const routes = { [SEED_ROUTE]: { posts: [] } };
  const page = await loadPage(PAGE_URL, { routes });
  const savedInterval = globalThis.setInterval;
  let refresh;
  globalThis.setInterval = (callback) => { refresh = callback; return 0; };
  t.after(() => { globalThis.setInterval = savedInterval; page.restore(); });

  const status = page.document.querySelector("#profile-feed-status");
  assert.equal(textOf(status), "Loading image posts…");
  assert.equal(page.document.querySelectorAll("#profile-feed-status").length, 1);

  await importPageModule("/profile-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogProfile === "ready", "the failed first load settles");
  assert.equal(status.querySelectorAll(".empty-state-error").length, 1);
  assert.match(textOf(status), /Image posts could not be loaded/);
  assert.match(textOf(status), /try again/i);

  routes[LIVE_ROUTE] = { posts: [{
    id: "live-image", author: "Mina", content: "Recovered.", timestamp: "2026-07-18T12:00:00.000Z",
    image_url: "/media/Mina.svg", image_alt: "A drawing signed Mina", image_width: 1200, image_height: 900,
  }] };
  await refresh();
  assert.equal(page.document.querySelectorAll(".profile-tile").length, 1);
  assert.equal(status.hidden, true, "live refresh hides the failed status after posts arrive");
  assert.equal(textOf(status), "");
});

test("every entry says how many image posts that display name has, and which one is showing", async () => {
  const page = await people();
  try {
    // The count is the button's own text, so it is the accessible name too — a
    // reader picking by keyboard hears it, and nothing here is decoration.
    // Singular for exactly one; a bare zero only for a name the feed answered
    // zero for. Zed is selected, and says so in words rather than in colour.
    assert.deepEqual(chipTexts(page), [
      "Ari · 0 image posts",
      "Bea · 1 image post",
      "✓ Showing Zed · 2 image posts",
    ]);
    // The value stays the bare display name: the label is for the reader, the
    // data attribute is what the page filters and links by.
    assert.deepEqual(chips(page).map((chip) => chip.dataset.author), ["Ari", "Bea", "Zed"]);
    // Present on every entry, not only the pressed one.
    assert.deepEqual(chips(page).map((chip) => chip.getAttribute("aria-pressed")), ["false", "false", "true"]);
    // The mark is a character and a word, so the distinction survives greyscale.
    assert.equal(chipTexts(page).filter((text) => text.includes("✓ Showing")).length, 1);
    // A name with nothing to show is still selectable — its count is the thing
    // that tells the reader it is empty.
    assert.equal(chips(page)[0].hasAttribute("disabled"), false);
  } finally {
    page.restore();
  }
});

test("the counts on the picker are the rows the grid draws, name by name", async () => {
  // The two halves cannot disagree because they are the same derivation: walk
  // every entry, select it, and check the grid against the number the chip
  // claimed before anything was clicked.
  const page = await people();
  try {
    const { document } = page;
    const claimed = new Map(chipTexts(page).map((text) => {
      const [, name, count] = text.match(/(?:✓ Showing )?(.+) · (\d+) image posts?$/);
      return [name, Number(count)];
    }));
    assert.deepEqual([...claimed], [["Ari", 0], ["Bea", 1], ["Zed", 2]]);

    for (const [name, count] of claimed) {
      chipFor(page, name).click();
      assert.equal(document.querySelectorAll(".profile-tile").length, count,
        `the picker promised ${count} image posts for ${name} and the grid drew something else`);
      assert.equal(textOf(document.querySelector("#profile-name")), `Active display-name filter: ${name}`);
    }
  } finally {
    page.restore();
  }
});

test("the results heading names the display name and counts the tiles under it", async () => {
  // Walk every display name the picker offers, including the one with nothing to
  // show, and read the heading's own number back against the tiles the grid drew
  // in the same render. Nothing here is a literal that happens to match the
  // fixture: the expected count is counted off the page.
  const page = await people();
  try {
    const { document } = page;
    for (const name of ["Ari", "Bea", "Zed"]) {
      chipFor(page, name).click();
      const heading = resultsHeading(document);
      const stated = heading.match(/^(.+) · (\d+) (image posts?)$/);
      assert.ok(stated, `the heading states no name and no count: ${heading}`);
      assert.equal(stated[1], name, `the heading names someone other than the display name showing: ${heading}`);
      const drawn = tileCount(document);
      assert.equal(Number(stated[2]), drawn, `the heading claimed ${stated[2]} and the grid drew ${drawn}`);
      // Social's own pluralisation: the singular only for exactly one.
      assert.equal(stated[3], drawn === 1 ? "image post" : "image posts", heading);
    }
    // Zed's two, spelled out, so the phrasing itself is pinned and not only the
    // arithmetic — and the ordering stays the eyebrow's to state, once.
    chipFor(page, "Zed").click();
    assert.equal(resultsHeading(document), "Zed · 2 image posts");
    assert.equal(tileCount(document), 2);
    const ordering = textOf(document.querySelector(".section-heading")).match(/newest first/gi) ?? [];
    assert.equal(ordering.length, 1, "the results panel states the ordering more than once");
  } finally {
    page.restore();
  }
});

test("a name whose posts are all gone says zero and offers the way to fill it", async () => {
  // Bea's one image post is removed from the live feed and shadowed out of the
  // seed by an id-matching text post, so this is a real, answered zero rather
  // than a name the store has never heard of.
  const page = await people({
    live: { posts: [{ id: "p-13", author: "Bea", content: "p-13 from Bea", timestamp: "2026-07-13T09:00:00.000Z" }] },
  });
  try {
    const { document } = page;
    assert.equal(chipTexts(page).includes("Bea · 0 image posts"), true, chipTexts(page).join(" / "));
    chipFor(page, "Bea").click();
    assert.equal(document.querySelectorAll(".profile-tile").length, 0);
    // The existing invitation, not a new one and not a blank region.
    assert.equal(document.querySelectorAll(".empty-state").length, 1);
    assert.match(textOf(document.querySelector(".empty-state")), /Paint/);
  } finally {
    page.restore();
  }
});

test("an empty display name is named in prose once and counted once", async () => {
  // A name the feed has never carried: total posts and image posts are both
  // zero. Each region says its own thing about that once — the identity line in
  // prose, the results heading as the count of the panel it names — and no
  // region repeats another's wording.
  const page = await people({ search: "?author=Nova" });
  try {
    const { document } = page;
    assert.equal(selectedChip(page)?.dataset.author, "Nova");
    const spoken = spokenRegions(document);
    const statements = spoken.flatMap((text) => text.match(/No image posts under this display name yet|\d+ image posts?/g) ?? []);
    assert.deepEqual(statements, ["0 image posts", "No image posts under this display name yet"],
      `the page states the same thing twice: ${statements.join(" / ")}`);
    // The named wording survives in the polite announcement only, which has no
    // page around it to borrow a subject from.
    assert.equal(spoken.filter((text) => text.includes("hasn’t posted an image yet")).length, 0);
    assert.match(textOf(document.querySelector("#profile-announcer")), /^Nova hasn’t posted an image yet\./);
    // An answered zero, in the same words a populated name gets, and it is the
    // heading that carries it: a reader entering the results region is told
    // whose posts are missing rather than that some feature is empty.
    assert.equal(resultsHeading(document), "Nova · 0 image posts");
    assert.equal(tileCount(document), 0);
    // Deleted, not hidden: no count chip survives anywhere in the panel.
    assert.equal(document.querySelectorAll("#profile-count").length, 0);
    assert.equal(document.querySelectorAll(".count").length, 0);
    // The empty state still says what would fill the grid, which is guidance
    // rather than a second telling of the count.
    assert.equal(document.querySelectorAll(".empty-state").length, 1);
    assert.match(textOf(document.querySelector(".empty-state")), /Paint/);
  } finally {
    page.restore();
  }
});

// A display name is publisher-supplied text — "anyone can publish under any
// name" is the sentence this page prints beside it — so this page renders
// hostile input by design, in prose, in a heading, and inside a URL.
//
// The name chosen here is a decoy route: 35 characters, so the API's own
// 60-character author limit (MAX_SOCIAL_AUTHOR_LENGTH, src/social-posts-api.js)
// would accept it, and shaped to impersonate the page's one link to Social. If
// any of these landed as markup instead of text, the page would
// offer a reader a second "Social" link pointing somewhere else, in the exact
// spot the copy tells them to go for the posts this view leaves out.
//
// This is the value half of that defence — the name arrives whole, and encoded
// where it lands in a URL. The render half, that every one of these is written
// through textContent and never innerHTML, is pinned at the source in
// tests/profile.test.js, because the page harness parses no markup and so could
// not tell a text node from a parsed one.
const DECOY_NAME = '<a href="//evil.example">Social</a>';

test("a display name that is markup is rendered as text and forges no second route", async () => {
  const page = await people({ search: `?author=${encodeURIComponent(DECOY_NAME)}` });
  try {
    const { document } = page;
    // Whole and literal in the results heading and in the active-filter chip —
    // the two visible elements this region spends on the display name, and both
    // of the places the name still lands as text. Parsed markup would have left
    // only the anchor's own text behind.
    assert.equal(resultsHeading(document), `${DECOY_NAME} · 0 image posts`);
    assert.equal(textOf(document.querySelector("#profile-name")), `Active display-name filter: ${DECOY_NAME}`);
    // The header block the name is written into holds no link at all, so a
    // forged one would be the only anchor in it. The page's one route to Social
    // is the intro's, above it, and the name never reaches that sentence.
    assert.equal(document.querySelector(".profile-identity").querySelectorAll("a").length, 0);
    assert.equal(document.querySelector(".profile-role").querySelectorAll("a").length, 0);
    const routes = document.querySelector(".profile-lede").querySelectorAll("a");
    assert.equal(routes.length, 1);
    assert.equal(routes[0].getAttribute("href"), "/social.html");
    assert.equal(textOf(routes[0]), "Social");
    // The one place the name is written into an attribute rather than a text
    // node. Percent-encoded by URLSearchParams, so the quotes in it cannot end
    // the attribute, and the route is still this site's Paint editor.
    const paint = document.querySelector("#profile-paint-route").getAttribute("href");
    assert.doesNotMatch(paint, /["'<>]/, "the display name reached the href unencoded");
    assert.equal(new URL(paint, "https://shiplog.test").pathname, "/paint/");
    assert.equal(new URL(paint, "https://shiplog.test").searchParams.get("author"), DECOY_NAME);
  } finally {
    page.restore();
  }
});

test("choosing another name updates the page in place and keeps the URL and storage in step", async () => {
  for (const key of [" ", "Enter"]) {
    const page = await people();
    try {
      const { document } = page;
      // Keyboard alone: no click, no pointer, and no keydown handler of our own
      // — a real button is what makes Space and Enter both press it.
      chipFor(page, "Bea").focus();
      assert.equal(document.activeElement?.dataset.author, "Bea");
      pressKey(document, key);

      assert.equal(selectedChip(page)?.dataset.author, "Bea", `${key} did not select`);
      // Focus stays on the display name that was just chosen, even though the
      // chips were rebuilt around it.
      assert.equal(document.activeElement?.dataset.author, "Bea");
      assert.equal(textOf(document.querySelector("#profile-name")), "Active display-name filter: Bea");
      assert.equal(textOf(document.querySelector(".profile-role")).includes("Bea"), false);
      assert.match(textOf(document.querySelector("#profile-summary")), /^1 image post /);
      assert.equal(document.querySelectorAll(".profile-tile").length, 1);
      assert.equal(page.navigations.length, 0);
      assert.equal(page.storage.getItem("shiplog.social.author"), "Bea");
      assert.deepEqual(page.replaced.at(-1)?.[2], "/profile.html?author=Bea");
      assert.equal(document.querySelector("#profile-paint-route").href, "/paint/?from=profile&author=Bea");
    } finally {
      page.restore();
    }
  }
});

test("selecting with the pointer moves the heading, the list, the URL, and the storage together", async () => {
  const page = await people();
  try {
    const { document } = page;
    chipFor(page, "Bea").click();

    assert.equal(selectedChip(page)?.dataset.author, "Bea");
    assert.equal(textOf(document.querySelector("#profile-name")), "Active display-name filter: Bea");
    assert.match(textOf(document.querySelector("#profile-summary")), /^1 image post /);
    assert.equal(document.querySelectorAll(".profile-tile").length, 1);
    // In place: no navigation, and the selection is carried in the URL and in
    // this browser's remembered name exactly as it was from the old position.
    assert.equal(page.navigations.length, 0);
    assert.equal(page.storage.getItem("shiplog.social.author"), "Bea");
    assert.deepEqual(page.replaced.at(-1)?.[2], "/profile.html?author=Bea");
    // The route into Paint follows the selection, so its back link returns here.
    assert.equal(document.querySelector("#profile-paint-route").href, "/paint/?from=profile&author=Bea");
  } finally {
    page.restore();
  }
});

test("a page whose posts have not landed says it is counting, and the heading states no number", async () => {
  // The frame the page really has: the seed has named the display names, the
  // live feed has not answered, and no count is settled. The old defect this
  // guards is the honest-looking one — printing "0 image posts" for a name the
  // store simply has not been asked about yet.
  const page = await loadPage(PAGE_URL, { routes: { [SEED_ROUTE]: SEED_FEED, [LIVE_ROUTE]: { posts: [] } } });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  globalThis.window.history = { replaceState() {} };
  const routed = globalThis.fetch;
  globalThis.fetch = (url, init) => (url === LIVE_ROUTE ? new Promise(() => {}) : routed(url, init));
  try {
    const { document } = page;
    await importPageModule("/profile-page.js");
    const picker = await waitFor(
      () => { const node = document.querySelector("#profile-author"); return node.children.length > 0 ? node : null; },
      "the picker renders its first entries",
    );
    const texts = picker.children.map((chip) => textOf(chip));
    assert.deepEqual(texts, ["Ari · Counting…", "Bea · Counting…", "✓ Showing Zed · Counting…"]);
    // Not one number anywhere, and above all not a zero.
    assert.equal(texts.filter((text) => /image posts?/.test(text)).length, 0);
    // The names and the pressed state are already right — only the counts wait.
    assert.deepEqual(picker.children.map((chip) => chip.getAttribute("aria-pressed")), ["false", "false", "true"]);
    // The results heading waits with them. It names the display name that is
    // showing, and the posts under it, and stops: the seed's tiles are on screen
    // but the feed has not answered, so a number here — a zero above all — would
    // be a count the page cannot yet stand behind, and would contradict the
    // "Counting…" on the chip for the very same name.
    const heading = resultsHeading(document);
    assert.equal(heading, "Zed · image posts");
    assert.doesNotMatch(heading, /\d/, `the heading numbered an uncounted feed: ${heading}`);
  } finally {
    globalThis.setInterval = savedInterval;
    page.restore();
  }
});

test("a feed with no image posts at all still lands on the empty state", async () => {
  const page = await loadPage(PAGE_URL, {
    routes: {
      [SEED_ROUTE]: { posts: [seedPost("p-21", "Ari", { withImage: false })] },
      [LIVE_ROUTE]: { posts: [] },
    },
  });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  try {
    await importPageModule("/profile-page.js");
    const { document } = page;
    await waitFor(() => document.documentElement.dataset.shiplogProfile === "ready", "the first load settles");
    // Nothing to prefer, so the old fallback stands and the page says so once.
    // One display name means no choice to make, so the picker says which name
    // the feed holds instead of drawing a single chip that reads as a choice
    // nobody made — and the name is still text on the page either way.
    const picker = document.querySelector("#profile-author");
    assert.equal(picker.children.filter((node) => node.tagName === "BUTTON").length, 0,
      "a one-name feed still drew a lone chip");
    assert.equal(textOf(picker), "Only one display name is in this feed: Ari.");
    assert.equal(document.querySelectorAll(".empty-state").length, 1);
    assert.match(textOf(document.querySelector("#profile-summary")), /^0 image posts · 1 post in total · last posted /);
  } finally {
    globalThis.setInterval = savedInterval;
    page.restore();
  }
});

/* --------------------------- one profile header --------------------------- */

// The reported defect, in DOM order: picker, initials blob, active-filter line,
// counts line, display-name paragraph, ordering label, and only then the heading
// that names what any of it is. The name arrived four times and the heading last,
// after the label that orders the list it heads.

// An element's own text, not its descendants'. textOf() reads a whole subtree, so
// counting "elements that carry the name" with it would count every ancestor of
// the one that actually prints it.
const ownText = (node) => node.children.filter((child) => child.nodeType === 3).map((child) => child.data).join("");

// Is this element, or anything above it, offscreen-only? The polite announcer is
// allowed to restate the name; it is not a visible copy of it.
function hidden(node) {
  for (let walk = node; walk; walk = walk.parentNode) {
    if (walk.classList?.contains("visually-hidden")) return true;
    if (walk.getAttribute?.("aria-hidden") === "true") return true;
  }
  return false;
}

// Every visible element in the results region that prints the display name in
// its own text. The grid is skipped: a tile's caption is the post's words, and
// in this feed a post's body legitimately contains the name that published it —
// that is content, not the page telling a reader the same thing again.
function nameCarriers(document, name) {
  const grid = document.querySelector("#profile-grid");
  const found = [];
  const visit = (node) => {
    for (const child of node.children) {
      if (child.nodeType !== 1 || child === grid) continue;
      if (!hidden(child) && ownText(child).includes(name)) found.push(child);
      visit(child);
    }
  };
  visit(document.querySelector(".list-panel"));
  return found;
}

const headingsIn = (node) => {
  const found = [];
  const visit = (current) => {
    for (const child of current.children) {
      if (child.nodeType !== 1) continue;
      if (/^H[1-6]$/.test(child.tagName)) found.push(child);
      visit(child);
    }
  };
  visit(node);
  return found;
};

test("one profile header opens the results, above the line that orders them", async () => {
  const page = await people();
  try {
    const { document } = page;
    const order = documentOrder(document);
    const at = (selector) => order.indexOf(document.querySelector(selector));

    // Reading order, top to bottom: intro, picker, profile header, ordering
    // label, posts. The heading used to be the last of those.
    assert.ok(at(".profile-lede") < at("#profile-author"), "the intro no longer opens the page");
    assert.ok(at("#profile-author") < at("#grid-title"), "the heading is read before the picker that fills it");
    assert.ok(at("#grid-title") < at("#profile-order"), "the ordering label still precedes the heading it orders under");
    assert.ok(at("#profile-order") < order.indexOf(document.querySelectorAll(".profile-tile")[0]),
      "the ordering label is read after the posts it orders");

    // One block, not four fragments: the initials, the heading, and the caveat
    // are children of the same container, and that container opens the panel.
    const header = document.querySelector(".profile-identity");
    const panel = document.querySelector(".list-panel");
    assert.equal(panel.childElements[0], header, "something else opens the results region");
    assert.equal(document.querySelector("#profile-avatar").parentNode, header);
    assert.equal(document.querySelector("#grid-title").parentNode.parentNode, header);
    assert.equal(document.querySelector(".profile-role").parentNode.parentNode, header);
    // And the hero it came from keeps no piece of it behind.
    const hero = document.querySelector(".hero-profile");
    assert.equal(hero.querySelectorAll(".profile-identity").length, 0);
    assert.equal(hero.querySelectorAll(".profile-role").length, 0);

    // The initials are decoration: announced, "AR" is a word, and the name is
    // already the heading's. This survives a picker change, because the module
    // rewrites the element on every render.
    const initials = document.querySelector("#profile-avatar");
    assert.equal(initials.getAttribute("aria-hidden"), "true");
    assert.equal(textOf(initials), "ZE");
    chipFor(page, "Bea").click();
    assert.equal(textOf(initials), "BE");
    assert.equal(initials.getAttribute("aria-hidden"), "true", "a re-render dropped the avatar's aria-hidden");
  } finally {
    page.restore();
  }
});

test("one section-level heading opens the results region, and it names the display name", async () => {
  const page = await people();
  try {
    const { document } = page;
    const headings = headingsIn(document.querySelector(".list-panel"));
    assert.deepEqual(headings.map((heading) => heading.getAttribute("id")), ["grid-title"],
      `the results region opens with ${headings.length} headings`);
    assert.equal(headings[0].tagName, "H2");
    // It is the section's accessible name too, so the region a reader enters is
    // named by the same words the header shows them.
    assert.equal(document.querySelector(".workspace").getAttribute("aria-labelledby"), "grid-title");
    assert.equal(resultsHeading(document), "Zed · 2 image posts");
    // The ordering label is a label, not a second heading over the same list.
    assert.equal(document.querySelector("#profile-order").tagName, "P");
  } finally {
    page.restore();
  }
});

test("the display name is visible twice in the results region, and no more", async () => {
  const page = await people();
  try {
    const { document } = page;
    for (const name of ["Zed", "Bea", "Ari"]) {
      chipFor(page, name).click();
      const carriers = nameCarriers(document, name).map((node) => node.getAttribute("id") ?? node.className);
      assert.deepEqual(carriers, ["grid-title", "profile-name"],
        `${name} is printed by ${carriers.length} visible elements: ${carriers.join(" / ")}`);
    }
    // The two that are left say different things about the same name: what the
    // results are, and which picker entry chose them.
    assert.equal(resultsHeading(document), "Ari · 0 image posts");
    assert.equal(textOf(document.querySelector("#profile-name")), "Active display-name filter: Ari");
    // The lines that gave up their copy still say their own thing: Ari has
    // posted, just never a picture, and the counts carry that without a name.
    assert.match(textOf(document.querySelector("#profile-summary")), /^0 image posts · 1 post in total · last posted /);
    assert.match(textOf(document.querySelector(".profile-role")), /^A display name in the Social feed/);
    // The announcement keeps the name, because it is heard away from the page.
    assert.match(textOf(document.querySelector("#profile-announcer")), /Ari/);
  } finally {
    page.restore();
  }
});

test("the line that orders the posts is tied to the list it orders", async () => {
  const page = await people();
  try {
    const { document } = page;
    const grid = document.querySelector("#profile-grid");
    const label = document.querySelector("#profile-order");
    // The ordering is a static statement rather than a control, so the reference
    // runs from the list to the label: a reader entering the list is told how it
    // is sorted, and the page grows no tab stop to carry the fact.
    assert.equal(grid.getAttribute("aria-describedby"), "profile-order");
    assert.equal(document.querySelectorAll("#profile-order").length, 1, "the description resolves to no element or to two");
    assert.equal(textOf(label), "Newest first");
    assert.equal(tabSequence(document).includes(label), false, "the ordering label became a tab stop");
  } finally {
    page.restore();
  }
});

test("tabbing from the top reaches the picker, then the posts under the header", async () => {
  const page = await people();
  try {
    const { document } = page;
    // Walked, not read off the markup: every stop is a real focus move made by
    // the page harness that boots the shipped markup with the shipped module.
    document.querySelector(".profile-lede").querySelectorAll("a")[0].focus();
    const walked = [];
    for (let step = 0; step < 6; step += 1) walked.push(pressTab(document));
    assert.deepEqual(walked.slice(0, 3).map((node) => node.dataset?.author), ["Ari", "Bea", "Zed"],
      "the display-name picker is not the first thing a keyboard reaches in main");
    // Then the panel's own two-step helper — make the image, publish it — in the
    // order the steps happen, then the first post. The ordering label sits
    // between the picker and these, and takes no stop of its own: nothing
    // focusable was added above the results to carry it.
    assert.equal(walked[3].getAttribute("id"), "profile-paint-route");
    assert.equal(walked[4].getAttribute("id"), "profile-publish-route");
    assert.equal(walked[5].classList.contains("profile-tile"), true, "the sixth stop is not the first post");

    // And the visual order the tab order is supposed to match: every one of
    // those stops comes after the heading, and the posts come after the label.
    const order = documentOrder(document);
    const at = (node) => order.indexOf(node);
    assert.ok(at(document.querySelector("#profile-author")) < at(document.querySelector("#grid-title")));
    assert.ok(at(document.querySelector("#grid-title")) < at(document.querySelector("#profile-order")));
    assert.ok(at(document.querySelector("#profile-order")) < at(walked[5]));
    // No new focusable above the results region: the intro's link to Social and
    // the picker are still the whole of it.
    const inMain = tabSequence(document).filter((element) => element.closest("#main-content"));
    const beforePanel = inMain.filter((element) => !element.closest(".list-panel"));
    assert.deepEqual(beforePanel.map((element) => element.dataset?.author ?? element.getAttribute("href")),
      ["/social.html", "Ari", "Bea", "Zed"]);
  } finally {
    page.restore();
  }
});

/* ------------------- the name nobody chose, said in words ------------------ */

// The reported defect: People opened on one name, with a verdict about it, and
// nothing on the page said whether the visitor had asked for that name or the
// page had picked it for them. A roster with counts answers "what else is
// there"; this sentence answers "why this one".

const pickerNote = (document) => textOf(document.querySelector("#profile-picker-note"));

// Every write to the polite region, in order. The page has one live region and
// one code path into it, and "exactly once" is a claim about the writes rather
// than about the text that survives them — a second announcement of the same
// words leaves no trace in textContent but is heard twice.
function recordAnnouncements(document) {
  const announcer = document.querySelector("#profile-announcer");
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(announcer), "textContent");
  const writes = [];
  Object.defineProperty(announcer, "textContent", {
    configurable: true,
    get: () => descriptor.get.call(announcer),
    set: (value) => { writes.push(String(value)); descriptor.set.call(announcer, value); },
  });
  return writes;
}

test("arriving with no name asked for lists every display name with its count and says the name was preselected", async () => {
  const page = await people();
  try {
    const { document } = page;
    // The whole set on arrival, each entry carrying its count as words rather
    // than a bare figure beside a name.
    assert.deepEqual(chipTexts(page), [
      "Ari · 0 image posts",
      "Bea · 1 image post",
      "✓ Showing Zed · 2 image posts",
    ]);
    for (const text of chipTexts(page))
      assert.match(text, /· \d+ image posts?$/, `an entry states a number without saying what it counts: ${text}`);
    // Every display name that has an image post is on the roster, derived from
    // the same feed the grid draws from rather than from a list kept beside it.
    for (const name of ["Bea", "Zed"]) assert.ok(chipFor(page, name), `${name} has image posts and no picker entry`);

    // And the sentence that says the visitor did not pick this one.
    assert.equal(pickerNote(document),
      "Showing Zed’s image posts. We preselected this name for you; pick another below to switch.");
    // Nothing was written on their behalf to make the preselection stick.
    assert.equal(page.storage.getItem("shiplog.social.author"), null);
    assert.equal(page.replaced.length, 0);
  } finally {
    page.restore();
  }
});

test("a name that was asked for is never claimed as a preselection", async () => {
  for (const [how, options] of [
    ["a shared link", { search: "?author=Bea" }],
    ["the remembered name", { storage: { "shiplog.social.author": "Bea" } }],
  ]) {
    const page = await people(options);
    try {
      const note = pickerNote(page.document);
      assert.equal(note, "Showing Bea’s image posts. Pick another name below to switch.", how);
      assert.doesNotMatch(note, /preselect/i, `${how} was reported back as the page's own choice`);
    } finally {
      page.restore();
    }
  }
});

test("choosing a name by keyboard moves the page and announces it once, from one region", async () => {
  const page = await people();
  try {
    const { document } = page;
    const writes = recordAnnouncements(document);
    chipFor(page, "Bea").focus();
    pressKey(document, "Enter");

    // The three things a reader watches, moved together by the one selection.
    assert.equal(resultsHeading(document), "Bea · 1 image post");
    assert.equal(textOf(document.querySelector("#profile-name")), "Active display-name filter: Bea");
    assert.equal(tileCount(document), 1);
    // Once, in one voice. Two code paths writing the same news, or a second
    // live region rendering it, is what a screen reader hears twice.
    // Social's settled sentence with this page's noun in it: same verb, same
    // word order, same closing clause, so a reader of one feed can read the
    // other without learning a second sentence.
    assert.deepEqual(writes, ["Showing 1 image post by Bea, newest first."]);
    const live = document.getElementById("main-content").querySelectorAll("[aria-live]");
    assert.deepEqual(live.map((node) => node.getAttribute("id")), ["profile-announcer"],
      "the main content holds more than one live region");
    // A selection is a choice, so the preselection claim is gone with it.
    assert.equal(pickerNote(document), "Showing Bea’s image posts. Pick another name below to switch.");
  } finally {
    page.restore();
  }
});

// The same sentence Social settles on, in this page's noun. Social says
// "Showing 12 posts, newest first."; People says how many image posts are under
// the selected display name, in the same verb and the same word order, so the
// two feeds do not teach a visitor two ways to read the same fact.
test("a settled People feed says how many image posts it holds and how they are ordered", async () => {
  const page = await people({ seed: { posts: [seedPost("p-21", "Ari"), seedPost("p-22", "Ari"), seedPost("p-23", "Ari")] } });
  try {
    const { document } = page;
    const announced = textOf(document.querySelector("#profile-announcer"));
    assert.equal(announced, "Showing 3 image posts by Ari, newest first.");
    assert.equal(tileCount(document), 3, "the stated count is the number of tiles on screen");
    // The page's existing noun, not a second word for the same thing.
    assert.match(announced, /image posts/);
    // Social's opening verb and closing clause, word for word.
    assert.match(announced, /^Showing /);
    assert.match(announced, /, newest first\.$/);
  } finally {
    page.restore();
  }
});

test("a keyboard selection leaves focus on the name that was chosen, not at the top of the document", async () => {
  const page = await people();
  try {
    const { document } = page;
    chipFor(page, "Ari").focus();
    pressKey(document, " ");
    // The chips are rebuilt by the selection, so this is a focus move the page
    // had to make: without it the reader is dropped back to the document.
    assert.equal(document.activeElement?.dataset.author, "Ari");
    assert.equal(document.activeElement?.getAttribute("aria-pressed"), "true");
    assert.equal(document.activeElement?.parentNode?.getAttribute("id"), "profile-author");
    // And the next name is one Tab away, so a reader comparing two names does
    // not have to walk back up the page between them.
    assert.equal(pressTab(document)?.dataset?.author, "Bea");
  } finally {
    page.restore();
  }
});

test("a selected name with no image posts says so once, and offers the way onward", async () => {
  const page = await people({ search: "?author=Nova" });
  try {
    const { document } = page;
    assert.equal(tileCount(document), 0);
    // One region, not two, and not an empty list.
    assert.equal(document.querySelectorAll(".empty-state").length, 1);
    const empty = document.querySelector(".empty-state");
    assert.match(textOf(empty), /Images made in Paint and published on Social appear here\./);
    assert.equal(document.querySelector("#profile-grid").querySelectorAll(".profile-grid").length, 0,
      "the grid drew an empty list beside the region that explains it");
    // The route onward, named the way the rest of the site names those places.
    const routes = empty.querySelectorAll("a").map((anchor) => anchor.getAttribute("href"));
    assert.equal(routes.filter((href) => href.startsWith("/paint/")).length, 1);
    assert.equal(routes.filter((href) => href === "/social.html").length, 1);
    assert.equal(textOf(empty.querySelectorAll("a")[0]), "Create an image in Paint (opens in a new tab)");
    assert.equal(textOf(empty.querySelectorAll("a")[1]), "See every post on Social");
    // The panel the guidance lands in speaks as content: the polite region is
    // the page's one voice, so this is not announced a second time from here.
    const status = document.querySelector("#profile-feed-status");
    assert.equal(status.getAttribute("aria-live"), null);
    assert.equal(status.getAttribute("role"), null);
    assert.match(textOf(document.querySelector("#profile-announcer")), /^Nova hasn’t posted an image yet\./);
  } finally {
    page.restore();
  }
});

test("a feed with one display name says so in words instead of drawing a lone chip", async () => {
  const page = await people({ seed: { posts: [seedPost("p-30", "Ari"), seedPost("p-31", "Ari")] } });
  try {
    const { document } = page;
    const picker = document.querySelector("#profile-author");
    assert.equal(picker.children.filter((node) => node.tagName === "BUTTON").length, 0,
      "a one-name feed drew a chip that reads as an unmade choice");
    assert.equal(textOf(picker), "Only one display name has image posts: Ari.");
    // The results are still the same results, and the sentence over the picker
    // does not point at a control that is not there.
    assert.equal(resultsHeading(document), "Ari · 2 image posts");
    assert.equal(pickerNote(document), "Showing Ari’s image posts.");
    assert.equal(tileCount(document), 2);
  } finally {
    page.restore();
  }
});
