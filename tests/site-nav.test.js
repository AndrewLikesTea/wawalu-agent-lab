// The navigation is one link set, in one order, with one name per destination.
//
// These tests are table-driven on purpose: a new page that carries a site nav
// has to be added to PAGES, and the "every page is in this table" test fails
// until it is. That is what stops a page from quietly growing a nav of its own,
// which is how the same surface ended up called three things.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { SITE_NAV, SITE_NAV_LABELS, navCurrentFor, navHref, navParentOf, siteNavMarkup } from "../src/site-nav.js";
import { parseHtml, tabSequence, textOf } from "./support/browser.js";

// `current` is the surface the page belongs to, not always its own URL: a
// release detail is still "Releases", a single post is still "Social".
// `title` is the browser title, listed here so it cannot drift from the name
// the nav gives the same surface.
const PAGES = [
  { file: "index.html", current: "/", title: "Shiplog · one site for AI spend, decisions, and releases" },
  { file: "decision.html", current: "/", title: "Decision · Shiplog" },
  { file: "workspace.html", current: "/", title: "Local workspace · Shiplog" },
  { file: "social.html", current: "/social.html", title: "Social · Shiplog" },
  { file: "post.html", current: "/social.html", title: "Post · Social · Shiplog" },
  { file: "profile.html", current: "/profile.html", title: "People · Shiplog" },
  { file: "releases.html", current: "/releases.html", title: "Releases · Shiplog" },
  { file: "release.html", current: "/releases.html", title: "Release · Shiplog" },
  { file: "evolution.html", current: "/evolution.html", title: "AI FinOps · Shiplog" },
  { file: "savings-action-center.html", current: "/evolution.html", title: "Monthly Savings Action Center · Shiplog" },
  { file: "savings-commitment.html", current: "/evolution.html", title: "Savings Commitment · Shiplog" },
  { file: "executive-briefing.html", current: "/evolution.html", title: "Executive FinOps briefing · Shiplog" },
  { file: "coach.html", current: "/coach.html", title: "Prompt coach · Shiplog" },
  { file: "personal-history.html", current: "/coach.html", title: "Personal AI history · Shiplog" },
  { file: "agents.html", current: "/agents.html", title: "Agent observatory · Wawalu Labs" },
  { file: "agent-trace.html", current: "/agents.html", title: "Published prompt trace · Wawalu Labs" },
];

const pageUrl = (file) => new URL(`../src/${file}`, import.meta.url);
// The URL a reader actually has in the address bar on that page.
const pathOf = (file) => (file === "index.html" ? "/" : `/${file}`);

function navMarkup(html, file) {
  const match = html.match(/^[ \t]*<nav class="site-nav"[\s\S]*?<\/nav>/m);
  assert.ok(match, `${file} must render a <nav class="site-nav">`);
  return match[0];
}

function navLinks(html, file) {
  return [...navMarkup(html, file).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attributes, label]) => ({
    label,
    href: attributes.match(/href="([^"]*)"/)?.[1] ?? null,
  }));
}

test("every page renders the same nav labels, in the same order, each exactly once", async () => {
  for (const { file, current } of PAGES) {
    const links = navLinks(await readFile(pageUrl(file), "utf8"), file);

    assert.deepEqual(
      links.map((link) => link.label),
      SITE_NAV_LABELS,
      `${file} renders a different nav link set or order`,
    );
    assert.deepEqual(
      links.map((link) => link.href),
      SITE_NAV.map(navHref),
      `${file} points a nav link somewhere else`,
    );
    // The bug this replaces: "Social Profile" next to "Profile" read as the same
    // destination twice.
    const labels = links.map((link) => link.label);
    assert.equal(
      new Set(labels).size,
      labels.length,
      `${file} repeats a nav label: ${labels.join(", ")}`,
    );
    assert.equal(
      navMarkup(await readFile(pageUrl(file), "utf8"), file),
      siteNavMarkup(current),
      `${file} nav markup has drifted from src/site-nav.js`,
    );
  }
});

test("every page that carries a site nav is covered by the table", async () => {
  const listed = new Set(PAGES.map((page) => page.file));
  const files = (await readdir(new URL("../src/", import.meta.url), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => entry.name);

  for (const file of files) {
    const html = await readFile(pageUrl(file), "utf8");
    if (!html.includes('class="site-nav"')) continue;
    assert.ok(listed.has(file), `${file} renders a site nav but is missing from PAGES`);
  }
});

test("each nav destination exists and each page title names its surface the way the nav does", async () => {
  for (const { href } of SITE_NAV) {
    const file = href === "/" ? "index.html" : href.endsWith("/") ? `${href.slice(1)}index.html` : href.slice(1);
    await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
  }

  for (const { file, current, title } of PAGES) {
    const html = await readFile(pageUrl(file), "utf8");
    assert.match(html, new RegExp(`<title>${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</title>`), `${file} title`);
    // A surface's own page is titled with its nav label, so a reader's tab and
    // the link they clicked agree. The home page is the exception below: it is
    // the front door, and it names the product.
    const label = SITE_NAV.find((link) => link.href === current)?.label;
    if (["social.html", "profile.html", "releases.html", "evolution.html", "agents.html"].includes(file)) {
      assert.ok(title.startsWith(`${label} ·`), `${file} is titled "${title}" but the nav calls it "${label}"`);
    }
  }
});

/* ------------------------- one door, on the answer ------------------------- */
// The AI FinOps surface is five pages and a five-destination rail. It gets one
// nav entry, and that entry opens on the region that answers the question a
// reader arrives with — not on the hero above it, and not on the rail, which is
// a list of places to choose between. The other four pages stay reachable, from
// this page's own content, at their own unchanged URLs.

test("the one AI FinOps door opens on the recoverable-dollars answer, not on a menu", async () => {
  // Every published FinOps URL, so re-promoting any of them to a top-level entry
  // fails here rather than growing the row back one item at a time.
  const FINOPS = ["/evolution.html", "/savings-action-center.html", "/savings-commitment.html",
    "/executive-briefing.html"];
  const doors = SITE_NAV.filter((link) => FINOPS.includes(link.href)
    || (link.section ?? []).some((path) => FINOPS.includes(path)));
  assert.equal(doors.length, 1, `the nav offers ${doors.length} AI FinOps doors`);
  const [door] = doors;
  assert.equal(door.label, "AI FinOps");
  assert.equal(navHref(door), "/evolution.html#finops-recoverable-answer");

  // The region exists, and it is the one holding the figure — a rename that left
  // the id pointing at an empty band would pass a fragment check and fail here.
  const html = await readFile(pageUrl("evolution.html"), "utf8");
  const region = html.match(/<section class="finops-recoverable-answer" id="finops-recoverable-answer"[\s\S]*?<\/section>/);
  assert.ok(region, "evolution.html must carry the region the door names");
  assert.match(region[0], /id="finops-recoverable-value">\$[\d,]+</, "the door must land on the figure");
  assert.match(region[0], /How much of our AI spend can we recover/, "and on the question it answers");

  // Collapsing the nav must not orphan the pages it used to be able to grow an
  // entry for. Each one is linked from the body of the page the door opens.
  const body = html.replace(/<nav class="site-nav"[\s\S]*?<\/nav>/, "");
  for (const path of door.section) {
    assert.ok(body.includes(`href="${path}"`), `${path} is reachable only from the nav`);
  }
});

test("the home page names the product and what it is for, not just its first section", async () => {
  const { title } = PAGES.find((page) => page.file === "index.html");
  // A bookmark, a tab strip, and a search result all show this string first. On
  // the front door it has to say what Shiplog is; "Decisions" only named the
  // list further down the page, and it named the decision detail too.
  assert.ok(title.startsWith("Shiplog · "), `the home page is titled "${title}"`);
  assert.notEqual(title, "Shiplog", "the bare product name says nothing about what it is for");
  assert.match(title, /decision/i);
  assert.match(title, /release/i);
  // And it reads as one product with parts, not as a menu of three things to
  // pick between: "Shiplog · AI FinOps, decisions, and releases" listed them as
  // alternatives, which is the reading this phrasing removes.
  assert.match(title, /one site for/i, `the home page is titled "${title}"`);
});

test("no two pages share a document title, and none is longer than a tab can show", async () => {
  const seen = new Map();
  for (const { file, title } of PAGES) {
    const owner = seen.get(title);
    assert.equal(owner, undefined, `${file} and ${owner} both render the title "${title}"`);
    seen.set(title, file);
    assert.ok(title.length < 60, `${file} is titled "${title}" (${title.length} characters)`);
  }
});

test("every page that ships a <title> is one of the pages this table pins", async () => {
  // Pages without a site nav (the Paint editor) still own a tab, so a duplicate
  // could hide there. This walks the built source rather than the table.
  const dir = new URL("../src/", import.meta.url);
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".html")) files.push(`${entry.parentPath ?? entry.path}/${entry.name}`);
  }
  const titles = new Map();
  for (const path of files) {
    const title = (await readFile(path, "utf8")).match(/<title>([^<]*)<\/title>/)?.[1];
    if (!title) continue;
    const owner = titles.get(title);
    assert.equal(owner, undefined, `${path} and ${owner} both render the title "${title}"`);
    titles.set(title, path);
  }
});

// Two names in a flat row read as two products. The profile destination is
// Social filtered to one display name's image posts, and presenting it as an
// equal peer is what made a reader ask which of the two was "the feed". The pair
// is now nested, and the profile still reaches from anywhere in one click.
test("the profile destination is presented as a view of Social, not as a competing destination", async () => {
  assert.equal(navParentOf("/profile.html"), "/social.html");
  assert.equal(navParentOf("/social.html"), null, "Social is a surface of its own");
  assert.equal(navParentOf("/releases.html"), null);

  for (const { file } of PAGES) {
    const nav = navMarkup(await readFile(pageUrl(file), "utf8"), file);
    const group = nav.match(/<span class="nav-group">([\s\S]*?)<\/span>/);
    assert.ok(group, `${file} must nest the Social pair rather than listing two peers`);
    assert.match(group[1], /href="\/social\.html"/, `${file}: Social heads its own group`);
    assert.match(group[1], /class="nav-profile"[^>]*href="\/profile\.html"/, `${file}: the profile link sits inside it`);
    // Nesting must not cost reach: it is still one ordinary link, in the list,
    // named the same thing everywhere.
    assert.match(nav, />People</, `${file}: People must still be linked from the nav`);
  }

  // The subordination is carried by position, size, and a turn mark — never by
  // colour on its own, and never by removing the link.
  for (const sheet of ["styles.css", "agents.css"]) {
    const css = await readFile(new URL(`../src/${sheet}`, import.meta.url), "utf8");
    assert.match(css, /\.nav-group \{/, `${sheet} must style the group`);
    assert.match(css, /\.nav-group \.nav-profile \{ font-size:\.92em; \}/, `${sheet} must render the profile link one size down`);
    assert.match(css, /\.nav-group \.nav-profile::before \{ content:"\\21B3"/, `${sheet} must mark the profile link as a view`);
  }
});

// This demo has no accounts. A nav item called "Profile" promised every visitor
// a page about themselves, and the home page then had to spend a sentence taking
// the promise back. The stable replacement remains true as the selected person
// changes.
test("the nav names people, and never promises the visitor a personal profile", async () => {
  const link = SITE_NAV.find((entry) => entry.href === "/profile.html");
  assert.equal(link.label, "People", "the destination names people rather than the visitor's account");
  assert.ok(link.label.length <= "Profile".length, "the replacement must not consume more mobile-nav width");

  for (const { file } of PAGES) {
    const nav = navMarkup(await readFile(pageUrl(file), "utf8"), file);
    assert.doesNotMatch(nav, />Profile</, `${file} still offers the visitor a "Profile"`);
  }

  // The home page's destination list is the same name, doing the same job, so it
  // no longer needs a sentence undoing the label.
  const home = await readFile(pageUrl("index.html"), "utf8");
  const entry = home.match(/<li><a href="\/profile\.html">([\s\S]*?)<\/li>/);
  assert.ok(entry, "the destination list must still name this page");
  assert.match(entry[1], /^People<\/a>/, "the list calls it what the nav calls it");
  assert.doesNotMatch(entry[1], /not your account/, "a truthful label needs no correction");
  assert.match(entry[1], /display name/, "the list says what the picker on that page selects");
  assert.doesNotMatch(entry[1], /profile/i, "the list must not call this destination a profile");
});

test("the profile page defines the selected name as a display name", async () => {
  const html = await readFile(pageUrl("profile.html"), "utf8");
  const role = html.match(/<p class="profile-role">([\s\S]*?)<\/p>/);
  assert.ok(role, "the profile page must state its role near its heading");
  assert.match(role[1], /<span id="profile-role-name">Ari<\/span> is a display name/);
  // One term, and "persona" is not it. This sentence used to say "demo
  // persona" while the intro, the label, and the hint said "display name",
  // which left a reader with two words for the one thing the picker selects.
  // Matched against the whole file, rationale notes included, and on the WORD
  // rather than the letters: the footer's "Personal AI history" row and its
  // href both contain "persona" as a substring and name something else. The
  // plural is bounded in too, which an unanchored pattern would let through.
  assert.equal(html.match(/\bpersonas?\b/gi), null, "the page still calls a display name a persona");
  const rendered = html.replace(/<!--[\s\S]*?-->/g, "");
  // The claim Social's composer makes about the name, made here too and in the
  // composer's own words, for the reader who arrives from a shared link and
  // never sees the composer: it is not an account, and it is not reserved.
  assert.match(role[1], /not a signed-in user — nobody owns or verifies one, and anyone can publish under any name/);
  // The second sentence stays on the same subject the first one names. It used
  // to swap to "this display name" mid-paragraph, and before that to "that
  // person's image posts", which gave the page a second word for the name.
  assert.match(role[1], /This view shows only that name's image posts\./);
  assert.doesNotMatch(rendered, /that person's|their image posts/,
    "no rendered copy on People calls a display name's posts someone's");
  // Subordinate, not trapped: the way back to the whole feed is right there.
  assert.match(role[1], /href="\/social\.html"/);

  // A reader who clicked "People" arrives at a heading that says People, so the
  // link and the page agree on one name for this surface. The selected person is
  // a filter on it, not its name, so the name renders in the identity line under
  // the description — still present, still the pre-hydration default.
  assert.match(html, /<h1 id="page-title">People<\/h1>/);
  assert.match(html, /<p class="profile-summary" id="profile-name">Ari<\/p>/);
});

// The two surfaces a visitor mixes up. Each page's first sentence has to say
// what it holds AND name the other one with a reason to open it instead, or the
// nav's two adjacent labels are the only thing telling them apart.
test("Social and People each disambiguate the other in the sentence under the heading", async () => {
  const pages = [
    { file: "social.html", heading: "Social", other: "People", lede: /<h1 id="page-title">Social<\/h1>\s*<p>([^<]*)<\/p>/ },
    { file: "profile.html", heading: "People", other: "Social", lede: /<h1 id="page-title">People<\/h1>\s*<p class="profile-lede">([^<]*)<\/p>/ },
  ];

  const descriptions = [];
  for (const { file, heading, other, lede } of pages) {
    const html = await readFile(pageUrl(file), "utf8");
    // The heading noun is the nav label, so no synonym drifts between the link
    // and the page it opens.
    const label = SITE_NAV.find((entry) => entry.label === heading);
    assert.ok(label, `${file}: the heading must be a destination name the nav uses`);

    const match = html.match(lede);
    assert.ok(match, `${file}: the heading must be followed by one sentence of description`);
    const description = match[1];
    descriptions.push(description);

    const mentions = description.split(other).length - 1;
    assert.equal(mentions, 1, `${file}: the description must name ${other} exactly once, not ${mentions} times`);
    assert.match(description, new RegExp(`Open ${other} when`), `${file}: it must say when to open ${other} instead`);
  }

  assert.notEqual(descriptions[0], descriptions[1], "the two descriptions must not be the same sentence");
});

/* --------------------------- the item you are on --------------------------- */
// Which destination the reader is already looking at has to survive three
// things the markup cannot see: a screen reader that never renders the
// highlight, a reader who cannot separate the two greys it is drawn in, and a
// grayscale print of the briefing in which no hue is left at all.

test("every page marks exactly one nav item as the current page, and marks the right one", async () => {
  for (const { file, current } of PAGES) {
    const nav = parseHtml(await readFile(pageUrl(file), "utf8")).querySelector(".site-nav");
    const marked = nav.querySelectorAll("a").filter((link) => link.getAttribute("aria-current") === "page");
    assert.equal(marked.length, 1, `${file} marks ${marked.length} nav items as the current page`);
    const destination = SITE_NAV.find((link) => link.href === current);
    assert.equal(marked[0].href, navHref(destination), `${file} marks the wrong nav item as current`);
    // A detail page belongs to a surface, so the marked item is that surface's
    // name — "Release · Shiplog" is still under Releases.
    assert.equal(textOf(marked[0]), SITE_NAV.find((link) => link.href === current).label);
    // And the surface each page belongs to is not a hand-written column in the
    // table above: it is what navCurrentFor() derives from the page's own URL,
    // so the markup and the resolver cannot disagree.
    assert.equal(navCurrentFor(pathOf(file)), current, `${file}: navCurrentFor disagrees with the markup`);
  }
});

// Exact-string equality on the pathname is the implementation that passes the
// four top-level pages and fails the one that matters: a decision detail page is
// /decision.html?id=d-3, which equals nothing in the nav.
test("a detail page marks the section it belongs to, and the root marks only itself", () => {
  assert.equal(navCurrentFor("/decision.html?id=d-3"), "/", "a decision detail is still Decisions");
  assert.equal(navCurrentFor("/decision.html"), "/");
  assert.equal(navCurrentFor("/executive-briefing.html?scope=q3"), "/evolution.html");
  assert.equal(navCurrentFor("/release.html?id=r-9#linked"), "/releases.html");
  assert.equal(navCurrentFor("/post.html?id=p-2"), "/social.html");
  assert.equal(navCurrentFor("/agent-trace.html?trace=t-1"), "/agents.html");
  assert.equal(navCurrentFor("/paint/"), "/paint/", "a directory destination owns its subtree");
  assert.equal(navCurrentFor("/"), "/");
  assert.equal(navCurrentFor("/index.html"), "/");
  // "/" is a prefix of every path on this site. Matching it as one would mark
  // Decisions current on all eight destinations.
  for (const path of ["/social.html", "/releases.html", "/evolution.html", "/coach.html", "/agents.html"]) {
    assert.equal(navCurrentFor(path), path, `${path} must mark itself, not the front door`);
  }
  assert.equal(navCurrentFor("/nothing-here.html"), null, "an unknown page marks nothing rather than the front door");
});

// The five surfaces the live-product review walked, named one at a time: a loop
// that silently covered none of them would still pass the table test above.
test("each reviewed page marks its own destination, and only that one", async () => {
  const reviewed = [
    ["evolution.html", "AI FinOps"],
    ["coach.html", "Prompt coach"],
    ["agents.html", "Agent observatory"],
    ["executive-briefing.html", "AI FinOps"],
    ["decision.html", "Decisions"],
  ];
  for (const [file, label] of reviewed) {
    const nav = parseHtml(await readFile(pageUrl(file), "utf8")).querySelector(".site-nav");
    const marked = nav.querySelectorAll("a").filter((link) => link.getAttribute("aria-current") === "page");
    assert.equal(marked.length, 1, `${file} marks ${marked.length} nav items as the current page`);
    assert.equal(textOf(marked[0]), label, `${file} marks the wrong destination`);
    for (const link of nav.querySelectorAll("a")) {
      if (link === marked[0]) continue;
      assert.equal(link.getAttribute("aria-current"), null, `${file}: "${textOf(link)}" also claims to be the page`);
    }
  }
});

test("the site nav landmark is named apart from the in-page navigation", async () => {
  for (const { file } of PAGES) {
    const document = parseHtml(await readFile(pageUrl(file), "utf8"));
    const site = document.querySelector(".site-nav");
    const name = site.getAttribute("aria-label");
    assert.equal(name, "Site", `${file}: the site nav must name itself`);
    // A reader cycling landmarks hears "Site navigation" and, on the AI FinOps
    // pages, the workspace rail — two names, not two anonymous navigations.
    for (const other of document.querySelectorAll("nav")) {
      if (other === site) continue;
      const label = other.getAttribute("aria-label") ?? other.getAttribute("aria-labelledby");
      assert.ok(label, `${file}: a second navigation landmark ships with no name`);
      assert.notEqual(label, name, `${file}: two navigation landmarks answer to "${name}"`);
    }
  }
});

/* ------------------ what the mark measures, not what it claims ------------- */

// The declaration block a selector ships, read by exact selector text so a
// renamed or deleted rule fails here instead of making an assertion vacuous.
const sheets = new Map();
async function sheet(name) {
  if (!sheets.has(name)) sheets.set(name, await readFile(new URL(`../src/${name}`, import.meta.url), "utf8"));
  return sheets.get(name);
}
const declarations = (css, selector) => {
  const literal = selector.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);
  const found = css.match(new RegExp(`^${literal} \\{([^}]*)\\}`, "m"));
  assert.ok(found, `no rule for ${selector}`);
  return found[1];
};

function relativeLuminance([r, g, b]) {
  const [x, y, z] = [r, g, b].map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * x + 0.7152 * y + 0.0722 * z;
}
const rgb = (hex) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
function contrastRatio(foreground, background) {
  const [light, dark] = [relativeLuminance(rgb(foreground)), relativeLuminance(rgb(background))].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

// The two surfaces the header sits on: the page, and the blue bloom the body
// gradient paints into the top right corner, which is exactly where the nav is.
const NAV_SURFACES = { page: "#f3f1eb", bloom: "#d6e6fa" };

test("the rule under the current item measures at least 3:1 against the nav background", async () => {
  for (const name of ["styles.css", "agents.css"]) {
    const css = await sheet(name);
    const current = declarations(css, '.site-nav a[aria-current="page"]');
    // The mark is drawn in currentColor, so the ink this rule sets is the ink
    // the rule is drawn in — read it rather than assuming it.
    const ink = current.match(/color:\s*(#[0-9a-f]{3,6})/i)?.[1];
    assert.ok(ink, `${name}: the current item must set the ink its mark inherits`);
    // Neutral ink, not the accent: the accent already means "link or action" on
    // these pages, and a marker drawn in it reads as one.
    assert.equal(ink.toLowerCase(), "#171713", `${name}: the mark must be drawn in the neutral ink`);
    for (const [where, background] of Object.entries(NAV_SURFACES)) {
      const ratio = contrastRatio(ink, background);
      assert.ok(ratio >= 3, `${name}: the mark is ${ratio.toFixed(2)}:1 against the ${where} (${background})`);
    }
  }
  // The measured numbers, pinned so a token edit that dims the mark fails here
  // rather than in a screenshot nobody diffs: 15.91:1 and 14.17:1.
  assert.equal(contrastRatio("#171713", NAV_SURFACES.page).toFixed(2), "15.91");
  assert.equal(contrastRatio("#171713", NAV_SURFACES.bloom).toFixed(2), "14.17");
});

// A one-pixel column down a nav item, in device pixels, built only from values
// read out of the stylesheet: the text band, then the rows the rule occupies.
// Every ink is forced to one identical grey first — this is the grayscale print
// and the colour-blind reader at once, with hue *and* lightness removed — so
// anything still visible in the returned profile is shape or weight, never
// colour. Delete the box-shadow and the rule rows go back to bare surface.
const FLAT_GREY = [90, 90, 86];
const SURFACE = rgb(NAV_SURFACES.page);
function grayscaleProfile(block) {
  // Heavier stems cover more of the row. Monotonic in weight; the assertions
  // below compare profiles, so the exact curve is not load-bearing.
  const weight = Number(block.match(/font-weight:\s*(\d+)/)?.[1] ?? 400);
  const shadow = block.match(/box-shadow:\s*inset 0 -(\d+)px 0/);
  const surface = /background:\s*(?!none)/.test(block) ? [255, 255, 255] : SURFACE;
  const cover = (coverage, over = surface) => relativeLuminance(
    FLAT_GREY.map((ink, index) => ink * coverage + over[index] * (1 - coverage)),
  );
  const text = cover(0.24 + weight / 2500);
  const ruleRows = Number(shadow?.[1] ?? 0);
  return {
    text,
    // The rule band is the bottom rows of the item: fully inked where the
    // shadow reaches, bare surface where it does not.
    rule: ruleRows > 0 ? cover(1) : relativeLuminance(surface),
    ruleRows,
  };
}

test("with every colour in the nav collapsed to one grey, the current item is still the one you can pick out", async () => {
  for (const name of ["styles.css", "agents.css"]) {
    const css = await sheet(name);
    const rest = grayscaleProfile(declarations(css, ".site-nav a"));
    const current = grayscaleProfile(declarations(css, '.site-nav a[aria-current="page"]'));

    // Shape: the current item inks rows the other items leave bare. This is the
    // channel that survives a grayscale print, and it is the one carrying most
    // of the difference.
    assert.ok(current.ruleRows >= 2, `${name}: the current item must carry a rule, not a hue`);
    const shape = Math.abs(current.rule - rest.rule);
    assert.ok(shape >= 0.25, `${name}: in grayscale the rule band differs by only ${shape.toFixed(3)}`);

    // Weight may supplement the shape but may not be the only differentiator:
    // in a flat row of eight, a weight-only difference is easy to miss, so the
    // rule has to be the larger signal.
    const weight = Math.abs(current.text - rest.text);
    assert.ok(weight > 0, `${name}: the current item should also carry weight`);
    assert.ok(shape > weight, `${name}: weight (${weight.toFixed(3)}) is doing more work than the rule (${shape.toFixed(3)})`);
  }
});

test("the current item is marked by an outline, never by a filled wash", async () => {
  for (const name of ["styles.css", "agents.css"]) {
    const css = await sheet(name);
    const current = declarations(css, '.site-nav a[aria-current="page"]');
    assert.match(current, /font-weight:/, `${name}: the current item must carry weight`);
    assert.match(current, /box-shadow:inset 0 -2px 0/, `${name}: the current item must carry a rule`);
    // currentColor, not a new token: the mark inherits the palette rather than
    // introducing a colour the design system does not have.
    assert.match(current, /currentColor/, `${name}: the mark must reuse the text colour`);
    // A fill says "live, happening now" everywhere else on this site. Where you
    // are is a standing fact, so hover keeps the wash and the current item does
    // not — which is also what stops the two from reading as the same state.
    assert.doesNotMatch(current, /background/, `${name}: the current item must not be a filled wash`);
    assert.match(declarations(css, ".site-nav a:hover"), /background:rgba\(255,255,255,\.72\)/, `${name}: hover keeps the fill`);
    assert.doesNotMatch(declarations(css, ".site-nav a:hover"), /box-shadow|font-weight/, `${name}: hover must not borrow the mark`);
  }
});

test("a focused nav item and the current nav item never collapse into the same mark", async () => {
  for (const name of ["styles.css", "agents.css"]) {
    const css = await sheet(name);
    const focus = declarations(css, ".site-nav a:focus-visible");
    const current = declarations(css, '.site-nav a[aria-current="page"]');
    // Different property, different geometry: the ring is an outline on all
    // four sides, the mark an inset shadow on one. Both draw at once on a
    // focused current item, and neither hides the other.
    assert.match(focus, /outline:3px solid/, `${name}: focus must draw a ring`);
    assert.doesNotMatch(focus, /box-shadow/, `${name}: the ring must not be drawn as the current item's rule`);
    assert.doesNotMatch(current, /outline/, `${name}: the current item must not draw a ring`);
    // The ring sits outside the box, clear of the 2px rule inside it, so a
    // focused non-current item cannot be read as the page you are on.
    const offset = Number(focus.match(/outline-offset:\s*(\d+)px/)?.[1]);
    assert.ok(offset >= 3, `${name}: the ring is offset ${offset}px and lands on the current item's rule`);
    // And in a different colour: the accent for the transient state, the
    // neutral ink for the standing one.
    const ring = focus.match(/outline:3px solid (#[0-9a-f]{3,6}|var\(--focus-ring\))/i)?.[1];
    assert.ok(ring, `${name}: the ring must name its colour`);
    const resolved = ring.startsWith("var") ? css.match(/--focus-ring:\s*(#[0-9a-f]{3,6})/i)?.[1] : ring;
    assert.notEqual(resolved.toLowerCase(), "#171713", `${name}: the ring is drawn in the current item's ink`);
    assert.ok(contrastRatio(resolved, NAV_SURFACES.page) >= 3, `${name}: the ring must clear 3:1 on the page`);
  }
});

// A stylesheet carries several blocks at the same width, one per line. The one
// that lays out the row is the one that mentions the nav.
function navBreakpoint(css, width) {
  const body = [...css.matchAll(new RegExp(`@media\\(max-width:${width}px\\) \\{ ([\\s\\S]*?)\\}\\n`, "g"))]
    .map(([, block]) => block).find((block) => block.includes(".site-nav{"));
  assert.ok(body, `no ${width}px breakpoint lays out the nav`);
  return body;
}

test("at 390px the nav still shows the mark, and the page does not scroll sideways", async () => {
  const css = await sheet("styles.css");
  // 390px is inside this breakpoint, which is where the row of eight stops
  // fitting. The nav scrolls within itself; the page column stays a percentage
  // of the viewport, so nothing pushes a horizontal scrollbar onto the page.
  const phone = navBreakpoint(css, 520);
  assert.match(phone, /main,\.page\{width:calc\(100% - 24px\)/, "the page column must stay inside a 390px viewport");
  const nav = phone.match(/\.site-nav\{([^}]*)\}/)[1];
  assert.match(nav, /width:100%/);
  assert.match(nav, /overflow-x:auto/, "the row scrolls rather than pushing the page wide");
  assert.doesNotMatch(nav, /overflow:hidden|text-overflow|white-space:nowrap/, "the row must not clip what it cannot fit");
  // The mark is an *inset* shadow, so it scrolls with its item and no overflow
  // container can cut it off. What a scroll container can cut off is the focus
  // ring, which reaches 6px past the box (3px offset + 3px wide), so the
  // padding has to clear it on both edges.
  const [top, , bottom] = nav.match(/padding:([^;]*)/)[1].trim().split(/\s+/);
  for (const [edge, value] of [["top", top], ["bottom", bottom]]) {
    assert.ok(Number.parseInt(value, 10) >= 6, `the ${edge} padding is ${value}, so the focus ring is clipped at 390px`);
  }
  // Nothing in the breakpoint overrides the mark away at phone width.
  assert.doesNotMatch(phone, /\.site-nav a\[aria-current="page"\]\{/, "the breakpoint must not restyle the current item");

  // The observatory pages take the other stylesheet, where the row stacks
  // instead of scrolling. Either treatment is fine; the mark survives both.
  const agents = await sheet("agents.css");
  const stacked = navBreakpoint(agents, 560);
  assert.match(stacked.match(/\.site-nav\{([^}]*)\}/)[1], /flex-direction:column/);
  assert.doesNotMatch(stacked, /\.site-nav a\[aria-current="page"\]\{/, "the breakpoint must not restyle the current item");
});

test("the nav is reached by keyboard in the order it is displayed", async () => {
  for (const { file } of PAGES) {
    const document = parseHtml(await readFile(pageUrl(file), "utf8"));
    const links = document.querySelector(".site-nav").querySelectorAll("a");
    const sequence = tabSequence(document).filter((node) => links.includes(node));
    // Every destination is a tab stop — nesting the profile link inside the
    // Social group must not cost it one — and the sequence is document order,
    // which is the order the nav is authored and read in.
    assert.deepEqual(sequence.map(textOf), SITE_NAV_LABELS, `${file}: nav tab order`);

    // The order above is document order because nothing overrides it. A
    // tabindex anywhere in the row would make that agreement a coincidence,
    // whichever direction it pointed.
    const nav = document.querySelector(".site-nav");
    assert.equal(nav.querySelectorAll("[tabindex]").length, 0, `${file}: a nav item sets tabindex`);

    // The item you are on is the one it is tempting to freeze: a reader who is
    // already there has nowhere to go, so it becomes a span, and then it is the
    // one destination a keyboard cannot reach or a screen reader cannot list.
    for (const item of nav.querySelectorAll('[aria-current="page"]')) {
      assert.equal(item.tagName, "A", `${file}: the current item is a ${item.tagName}, not a link`);
      assert.ok(item.getAttribute("href"), `${file}: the current item is a link to nowhere`);
    }
  }

  // Nothing in the stylesheets re-orders the row visually, which would leave the
  // focus ring jumping around a nav that looks sequential.
  for (const sheet of ["styles.css", "agents.css"]) {
    const css = await readFile(new URL(`../src/${sheet}`, import.meta.url), "utf8");
    for (const [, selector, body] of css.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
      if (!/\.site-nav|\.nav-group/.test(selector)) continue;
      assert.doesNotMatch(body, /(^|[;{\s])order:/, `${sheet} re-orders "${selector.trim()}"`);
      assert.doesNotMatch(body, /-reverse/, `${sheet} reverses "${selector.trim()}"`);
    }
  }
});

test("the feed has one name: no page still says Team feed in its nav, eyebrow, or title", async () => {
  for (const file of ["social.html", "post.html"]) {
    const html = await readFile(pageUrl(file), "utf8");
    // The feed's name comes first on both pages. The permalink adds its record
    // between the surface and the "demo" marker every feed page ends on, so the
    // two eyebrows read "Social · demo" and "Social · post · demo".
    assert.match(html, /<p class="eyebrow">Social · (post · )?demo<\/p>/, `${file} eyebrow must name the feed "Social"`);
    assert.doesNotMatch(html.match(/<head>[\s\S]*?<\/head>/)[0], /Team feed/i, `${file} title block must not say "Team feed"`);
  }
});
