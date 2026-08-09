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
import { loadPage, textOf, tabSequence, pressKey } from "./support/browser.js";
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

async function people({ search = "", storage = {}, live = { posts: [] } } = {}) {
  const page = await loadPage(PAGE_URL, {
    storage,
    location: { search },
    routes: { [SEED_ROUTE]: SEED_FEED, [LIVE_ROUTE]: live },
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
    // things a keyboard reaches inside the main content.
    const inMain = tabSequence(document).filter((element) => element.closest("#main-content"));
    assert.deepEqual(inMain.slice(0, 3).map((element) => element.dataset.author), ["Ari", "Bea", "Zed"],
      "the first tab stops in main are not the display-name buttons in reading order");
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
      /Zed is a display name[\s\S]*See every post on Social\.$/,
      "the selected-name results state does not route to the posts it leaves out");
    // The scope is the intro's to state, once. This paragraph and the eyebrow
    // over the grid both used to restate it in their own words.
    assert.match(textOf(document.querySelector(".profile-lede")),
      /Open Social when you want the whole feed, including posts with no image\./);
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
    } finally {
      page.restore();
    }
  }
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
    const statements = spoken.flatMap((text) => text.match(/hasn’t posted an image yet|\d+ image posts?/g) ?? []);
    assert.deepEqual(statements, ["hasn’t posted an image yet", "0 image posts"],
      `the page states the same thing twice: ${statements.join(" / ")}`);
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
// would accept it, and shaped to impersonate the one link this paragraph now
// carries. If any of these landed as markup instead of text, the page would
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
    // Whole and literal in the prose and in the results heading: parsed markup
    // would have left only the anchor's own text behind.
    assert.equal(textOf(document.querySelector("#profile-role-name")), DECOY_NAME);
    assert.equal(resultsHeading(document), `${DECOY_NAME} · 0 image posts`);
    // The scope sentence still owns exactly one route, and it is Social's.
    const routes = document.querySelector(".profile-role").querySelectorAll("a");
    assert.equal(routes.length, 1);
    assert.equal(routes[0].getAttribute("href"), "/social.html");
    // The one place the name is written into an attribute rather than a text
    // node. Percent-encoded by URLSearchParams, so the quotes in it cannot end
    // the attribute, and the route is still this site's Paint editor.
    const paint = document.querySelector("#profile-paint-cta").getAttribute("href");
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
      assert.match(textOf(document.querySelector(".profile-role")),
        /Bea is a display name[\s\S]*See every post on Social\.$/);
      assert.match(textOf(document.querySelector("#profile-summary")), /^1 image post /);
      assert.equal(document.querySelectorAll(".profile-tile").length, 1);
      assert.equal(page.navigations.length, 0);
      assert.equal(page.storage.getItem("shiplog.social.author"), "Bea");
      assert.deepEqual(page.replaced.at(-1)?.[2], "/profile.html?author=Bea");
      assert.equal(document.querySelector("#profile-paint-cta").href, "/paint/?from=profile&author=Bea");
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
    assert.equal(document.querySelector("#profile-paint-cta").href, "/paint/?from=profile&author=Bea");
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
    const picker = document.querySelector("#profile-author");
    const pressed = picker.children.filter((chip) => chip.getAttribute("aria-pressed") === "true");
    assert.deepEqual(pressed.map((chip) => chip.dataset.author), ["Ari"]);
    assert.equal(document.querySelectorAll(".empty-state").length, 1);
    assert.match(textOf(document.querySelector("#profile-summary")), /^0 image posts · 1 post in total · last posted /);
  } finally {
    globalThis.setInterval = savedInterval;
    page.restore();
  }
});
