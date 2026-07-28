// The navigation is one link set, in one order, with one name per destination.
//
// These tests are table-driven on purpose: a new page that carries a site nav
// has to be added to PAGES, and the "every page is in this table" test fails
// until it is. That is what stops a page from quietly growing a nav of its own,
// which is how the same surface ended up called three things.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { SITE_NAV, SITE_NAV_LABELS, navParentOf, siteNavMarkup } from "../src/site-nav.js";

// `current` is the surface the page belongs to, not always its own URL: a
// release detail is still "Releases", a single post is still "Social".
// `title` is the browser title, listed here so it cannot drift from the name
// the nav gives the same surface.
const PAGES = [
  { file: "index.html", current: "/", title: "Shiplog · Decision and release log" },
  { file: "decision.html", current: "/", title: "Decision · Shiplog" },
  { file: "social.html", current: "/social.html", title: "Social · Shiplog" },
  { file: "post.html", current: "/social.html", title: "Post · Social · Shiplog" },
  { file: "profile.html", current: "/profile.html", title: "People · Shiplog" },
  { file: "releases.html", current: "/releases.html", title: "Releases · Shiplog" },
  { file: "release.html", current: "/releases.html", title: "Release · Shiplog" },
  { file: "evolution.html", current: "/evolution.html", title: "AI FinOps · Shiplog" },
  { file: "savings-action-center.html", current: "/evolution.html", title: "Monthly Savings Action Center · Shiplog" },
  { file: "savings-commitment.html", current: "/evolution.html", title: "Savings Commitment · Shiplog" },
  { file: "agents.html", current: "/agents.html", title: "Agent observatory · Wawalu Labs" },
  { file: "agent-trace.html", current: "/agents.html", title: "Published prompt trace · Wawalu Labs" },
];

const pageUrl = (file) => new URL(`../src/${file}`, import.meta.url);

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
      SITE_NAV.map((link) => link.href),
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

test("the home page names the product and what it is for, not just its first section", async () => {
  const { title } = PAGES.find((page) => page.file === "index.html");
  // A bookmark, a tab strip, and a search result all show this string first. On
  // the front door it has to say what Shiplog is; "Decisions" only named the
  // list further down the page, and it named the decision detail too.
  assert.ok(title.startsWith("Shiplog · "), `the home page is titled "${title}"`);
  assert.notEqual(title, "Shiplog", "the bare product name says nothing about what it is for");
  assert.match(title, /decision/i);
  assert.match(title, /release/i);
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
  assert.match(entry[1], /demo persona/, "the list says what kind of people this destination contains");
});

test("the profile page identifies the selected name as a demo persona", async () => {
  const html = await readFile(pageUrl("profile.html"), "utf8");
  const role = html.match(/<p class="profile-role">([\s\S]*?)<\/p>/);
  assert.ok(role, "the profile page must state its role near its heading");
  assert.match(role[1], /<span class="profile-role-chip">Demo persona<\/span>/);
  assert.match(role[1], /<span id="profile-role-name">Ari<\/span> is a demo persona/);
  assert.match(role[1], /not a signed-in user/);
  assert.match(role[1], /shows that person's image posts only/);
  // Subordinate, not trapped: the way back to the whole feed is right there.
  assert.match(role[1], /href="\/social\.html"/);

  // A reader who clicked "People" arrives at a heading that names the selected
  // person, and the same view says that person is a demo persona.
  assert.match(html, /<h1 id="page-title"><span id="profile-name">Ari<\/span><\/h1>/);
});

test("the feed has one name: no page still says Team feed in its nav, eyebrow, or title", async () => {
  for (const file of ["social.html", "post.html"]) {
    const html = await readFile(pageUrl(file), "utf8");
    assert.match(html, /<p class="eyebrow">Social · (demo|post)<\/p>/, `${file} eyebrow must name the feed "Social"`);
    assert.doesNotMatch(html.match(/<head>[\s\S]*?<\/head>/)[0], /Team feed/i, `${file} title block must not say "Team feed"`);
  }
});
