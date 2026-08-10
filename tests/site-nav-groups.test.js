// The row says which doors run on the reader's own work and which are demos
// (#1537).
//
// The bug these tests pin is not a missing feature, it is a missing sentence: a
// flat row of eight names told a scanning visitor nothing about the difference
// that decides where to start, and a reader who opened Social first concluded
// the whole site was a demonstration. So the row carries two visible group
// names now, and every assertion below is about what a reader can SEE and what
// a keyboard can still reach — never about a class being present.
//
// Read against every page that carries the nav rather than the six the issue
// named, because a grouping that lands on some pages is a grouping a reader
// stops trusting. The list comes off disk, so a new page cannot opt out.
//
// Harness limits this file works within (tests/support/browser.js): no universal
// or descendant selectors, properties are not reflected to attributes, and an
// equality assertion against an element node hangs — so everything here is a
// count, an attribute, or a string.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { NAV_SETS, SITE_NAV, SITE_NAV_LABELS, navHref } from "../src/site-nav.js";
import { parseHtml, tabSequence, textOf } from "./support/browser.js";

const pageUrl = (file) => new URL(`../src/${file}`, import.meta.url);

/** Every page that renders the site nav, read off disk rather than listed here. */
async function navPages() {
  const files = (await readdir(new URL("../src/", import.meta.url), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => entry.name)
    .sort();
  const pages = [];
  for (const file of files) {
    const html = await readFile(pageUrl(file), "utf8");
    if (html.includes('class="site-nav"')) pages.push({ file, html });
  }
  // The six the issue names are the ones a reviewer will open by hand. If the
  // walk above ever stops finding them, these tests are measuring nothing.
  for (const file of ["index.html", "coach.html", "releases.html", "social.html", "profile.html", "agents.html"]) {
    assert.ok(pages.some((page) => page.file === file), `${file} must render the site nav`);
  }
  return pages;
}

const PAGES = await navPages();

const navOf = (html) => parseHtml(html).querySelector(".site-nav");
/** The group boxes, each read through its own visible name. */
function groupsOf(nav, file) {
  return nav.querySelectorAll(".nav-set").map((box) => {
    const names = box.querySelectorAll(".nav-set-name");
    assert.equal(names.length, 1, `${file}: a group carries ${names.length} names`);
    return { box, name: names[0], links: box.querySelectorAll("a") };
  });
}

// The two names, as the reader sees them. Written out here rather than only
// imported, so a rename that empties the promise is a visible diff in this file.
const OWN = "Runs on your own work";
const DEMO = "Demos, sample data";

test("the two group names say which doors run on your own work and which are demonstrations", () => {
  assert.deepEqual(NAV_SETS.map((set) => set.label), [OWN, DEMO], "the nav's own group names");
  // The demonstration group has to say the word, in the rendered text, with no
  // reading between lines: "sample data" alone leaves a visitor guessing.
  assert.match(DEMO, /demo/i, "the demonstration group must call itself a demo");
  // And the other one has to say whose material it runs on. "Tools" would name
  // a category; this names the reader.
  assert.match(OWN, /your own work/i, "the tools group must say it runs on the reader's own work");
  // Two names, not two ids that happen to differ.
  assert.equal(new Set(NAV_SETS.map((set) => set.id)).size, 2);
  assert.equal(new Set(NAV_SETS.map((set) => set.label)).size, 2);
});

test("every destination declares which group it is in, and the groups keep the order the row already had", () => {
  for (const link of SITE_NAV) {
    assert.ok(NAV_SETS.some((set) => set.key === link.set), `"${link.label}" belongs to no nav group`);
  }
  // Reading order is unchanged: grouping the row must not reorder it, because
  // the order is what the home page's "start here" points at.
  const grouped = NAV_SETS.flatMap((set) => SITE_NAV.filter((link) => link.set === set.key).map((link) => link.label));
  assert.deepEqual(grouped, SITE_NAV_LABELS, "grouping reordered the row");
  assert.equal(SITE_NAV_LABELS[0], "AI FinOps", "AI FinOps must stay the first destination after the site name");
});

test("every page renders both group names as plain text inside the one nav landmark", () => {
  for (const { file, html } of PAGES) {
    const document = parseHtml(html);
    assert.equal(document.querySelectorAll(".site-nav").length, 1, `${file}: the site nav is rendered twice`);
    const nav = document.querySelector(".site-nav");
    const groups = groupsOf(nav, file);
    assert.equal(groups.length, 2, `${file}: the row shows ${groups.length} groups, not two`);
    assert.deepEqual(groups.map((group) => textOf(group.name)), [OWN, DEMO], `${file}: the visible group names`);

    // Plain text, in the row, with nothing a reader has to do to see it.
    for (const { name } of groups) {
      assert.equal(name.tagName, "SPAN", `${file}: a group name is a ${name.tagName}`);
      assert.equal(name.getAttribute("title"), null, `${file}: a group name hides in a tooltip`);
      assert.equal(name.getAttribute("aria-hidden"), null, `${file}: a group name is hidden from assistive tech`);
      assert.equal(name.getAttribute("hidden"), null, `${file}: a group name ships hidden`);
      // One class, and it is the one the stylesheet rule below is measured on:
      // an added "sr-only" or "visually-hidden" fails here.
      assert.equal(name.getAttribute("class"), "nav-set-name", `${file}: a group name carries another class`);
      assert.ok(textOf(name).length > 0, `${file}: a group name renders no text`);
    }
    // No disclosure anywhere in the row: a name behind a summary is a name a
    // scanning reader does not read.
    for (const tag of ["details", "summary", "button", "select"]) {
      assert.equal(nav.querySelectorAll(tag).length, 0, `${file}: the nav ships a ${tag}`);
    }
    // A second nav landmark would split the row rather than group it.
    assert.equal(nav.querySelectorAll("nav").length, 0, `${file}: a nav nests inside the site nav`);
    assert.equal(nav.getAttribute("aria-label"), "Site", `${file}: the landmark lost its name`);
  }
});

test("every page puts every destination in its declared group, and leaves none ungrouped", () => {
  const expected = NAV_SETS.map((set) => SITE_NAV.filter((link) => link.set === set.key));
  for (const { file, html } of PAGES) {
    const nav = navOf(html);
    const groups = groupsOf(nav, file);
    assert.equal(nav.querySelectorAll("a").length, SITE_NAV.length, `${file}: the nav lists a different number of doors`);

    let grouped = 0;
    for (const [index, group] of groups.entries()) {
      grouped += group.links.length;
      assert.deepEqual(group.links.map(textOf), expected[index].map((link) => link.label),
        `${file}: the "${textOf(group.name)}" group holds the wrong destinations`);
      // Byte-identical hrefs: grouping the row must not repoint a door.
      assert.deepEqual(group.links.map((link) => link.getAttribute("href")), expected[index].map(navHref),
        `${file}: the "${textOf(group.name)}" group points a door somewhere else`);
    }
    // Every anchor in the row is inside a group. An eighth door left beside the
    // groups is the failure this counts.
    assert.equal(grouped, SITE_NAV.length, `${file}: ${SITE_NAV.length - grouped} destinations sit outside every group`);

    // The grouping is exposed, not just drawn: each group's list is named by the
    // span the reader is looking at.
    for (const [index, group] of groups.entries()) {
      const id = group.name.getAttribute("id");
      assert.ok(id, `${file}: a group name carries no id to point at`);
      const lists = group.box.querySelectorAll("ul");
      assert.equal(lists.length, 1, `${file}: a group holds ${lists.length} lists`);
      assert.equal(lists[0].getAttribute("aria-labelledby"), id, `${file}: a group's list is not tied to its name`);
      // list-style:none is enough for Safari to drop the list role, and with it
      // the name this attribute just supplied.
      assert.equal(lists[0].getAttribute("role"), "list", `${file}: a group's list can lose its role`);
      // One item per door the group offers. People is a view of Social, so the
      // pair is one item — the count a screen reader announces is the number of
      // places to go, not the number of anchors.
      assert.equal(lists[0].querySelectorAll("li").length, expected[index].filter((link) => !link.subordinate).length,
        `${file}: the "${textOf(group.name)}" group announces the wrong number of doors`);
    }
    // The first door after the site name is still AI FinOps.
    assert.equal(textOf(nav.querySelectorAll("a")[0]), "AI FinOps", `${file}: another destination opens the row`);
  }
});

test("naming the groups costs no tab stop: the skip link, then the eight destinations, once each", () => {
  for (const { file, html } of PAGES) {
    const document = parseHtml(html);
    const nav = document.querySelector(".site-nav");
    const links = nav.querySelectorAll("a");

    // The row's own tab stops, counted the way the harness counts a real one:
    // everything focusable, not everything that looks like a link. Eight is the
    // number the ungrouped row had, and the group names must not add a ninth.
    const stops = nav.querySelectorAll("a,button,input,select,textarea,summary,[tabindex]");
    assert.equal(stops.length, 8, `${file}: the nav holds ${stops.length} focusable elements, not 8`);
    assert.equal(nav.querySelectorAll("[tabindex]").length, 0, `${file}: something in the nav sets tabindex`);
    for (const stop of stops) {
      assert.equal(stop.tagName, "A", `${file}: a nav tab stop is a ${stop.tagName}`);
      assert.ok(stop.getAttribute("href"), `${file}: a nav tab stop links nowhere`);
    }

    // And in the page's real sequence: the skip link first, then the row in
    // reading order. The brand link sits between them and always has.
    const sequence = tabSequence(document);
    assert.equal(sequence[0].getAttribute("class"), "skip-link", `${file}: the skip link is not the first tab stop`);
    assert.deepEqual(sequence.filter((node) => links.includes(node)).map(textOf), SITE_NAV_LABELS,
      `${file}: the nav's tab order`);
  }
});

test("both stylesheets draw the group names in the row, and let the groups wrap instead of scrolling", async () => {
  for (const name of ["styles.css", "agents.css"]) {
    const css = await readFile(new URL(`../src/${name}`, import.meta.url), "utf8");
    const rule = (selector) => {
      const literal = selector.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);
      const found = css.match(new RegExp(`^${literal} \\{([^}]*)\\}`, "m"));
      assert.ok(found, `${name}: no rule for ${selector}`);
      return found[1];
    };

    // The name is in the flow of the row. Every technique for hiding text while
    // leaving it in the DOM is refused here, because "visible" is the whole
    // requirement.
    const label = rule(".nav-set-name");
    for (const hidden of [/position:absolute/, /clip/, /display:none/, /visibility:hidden/, /font-size:0/,
      /width:1px/, /height:1px/, /opacity:0/, /text-indent/]) {
      assert.doesNotMatch(label, hidden, `${name}: the group name is hidden by ${hidden}`);
    }
    // Darker than the links it labels (#62625d), so it reads as a label rather
    // than as a ninth destination. 15.9:1 on the page.
    assert.match(label, /color:#171713/, `${name}: the group name must carry the neutral ink`);
    assert.doesNotMatch(label, /pointer-events|cursor:pointer/, `${name}: the group name must not pretend to be a control`);

    // The groups stack their name over their links, and both the row and each
    // group's list wrap: at 390px that is what keeps the eighth door on screen
    // instead of behind a sideways scroll.
    assert.match(rule(".nav-set"), /flex-direction:column/, `${name}: the group name must sit with its links`);
    assert.match(rule(".nav-set ul"), /flex-wrap:wrap/, `${name}: a group's links must wrap`);
    assert.match(rule(".nav-set ul"), /list-style:none/, `${name}: the group list must not draw markers in the header`);
    assert.match(rule(".nav-set ul"), /margin:0/, `${name}: the list must not inherit a paragraph's margins`);
    assert.match(rule(".site-nav"), /flex-wrap:wrap/, `${name}: the row itself must wrap`);
    // Nothing here may re-order what the tab sequence above just pinned.
    for (const selector of [".nav-set", ".nav-set ul", ".nav-set-name"]) {
      assert.doesNotMatch(rule(selector), /(^|[;\s])order:/, `${name}: ${selector} re-orders the row`);
      assert.doesNotMatch(rule(selector), /-reverse/, `${name}: ${selector} reverses the row`);
    }
  }
});
