import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { NAV_SETS, SITE_NAV, navCurrentFor } from "../src/site-nav.js";
import { parseHtml, pressKey, tabSequence, textOf } from "./support/browser.js";

const primary = ["Home", "Decision log", "Releases"];
const secondary = ["AI FinOps", "Prompt coach", "Social", "People", "Paint", "Agent observatory"];
const pages = [];
for (const file of await readdir(new URL("../src/", import.meta.url))) {
  if (!file.endsWith(".html")) continue;
  const html = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
  if (html.includes('class="site-nav"')) pages.push({ file, html });
}

// The project shim does not hide closed details descendants from Tab. Model
// that native visibility rule locally, without changing unrelated page tests.
const visibleNavStops = (document) => tabSequence(document).filter((node) => {
  if (!node.closest(".site-nav")) return false;
  const start = node.tagName === "SUMMARY" ? node.parentNode : node;
  for (let parent = start.parentNode; parent; parent = parent.parentNode) {
    if (parent.tagName === "DETAILS" && !parent.hasAttribute("open")) return false;
  }
  return true;
});

// The secondary label names the boundary a first-time visitor needs before
// choosing a door (#3206): everything inside it is a separate lab tool, in the
// footer's own words, and nothing outside it is. #2746 forbade a classifying
// name while the footer still called Social, People and Paint Shiplog's own;
// tests/site-footer.test.js now holds the header and the footer to one answer.
// The set, its order and its membership are unchanged, and each destination
// sits in exactly one group.
const GROUP = "Separate lab tools";
test("Shiplog leads and the secondary label says its destinations are separate lab tools", () => {
  assert.deepEqual(NAV_SETS.map((set) => set.label), ["Primary", GROUP]);
  assert.deepEqual(SITE_NAV.filter((link) => link.set === "primary").map((link) => link.label), primary);
  assert.deepEqual(SITE_NAV.filter((link) => link.set === "secondary").map((link) => link.label), secondary);
  const labels = SITE_NAV.map((link) => link.label);
  assert.deepEqual(labels, [...primary, ...secondary]);
  assert.equal(new Set(labels).size, labels.length);
  assert.equal(new Set(SITE_NAV.map((link) => link.href)).size, labels.length);
  assert.equal(pages.length, 17);
});

// The boundary is words, not a colour: the group's accessible name is the
// visible summary text, and the summary is the only non-link stop the nav adds.
test("every page names the lab-tools group in visible text that is its list's label", () => {
  for (const { file, html } of pages) {
    const nav = parseHtml(html).querySelector(".site-nav");
    const summaries = nav.querySelectorAll("summary");
    assert.equal(summaries.length, 1, file);
    assert.equal(textOf(summaries[0]), GROUP, file);
    assert.equal(summaries[0].hasAttribute("hidden"), false, file);
    assert.equal(summaries[0].getAttribute("aria-hidden"), null, file);
    const lists = nav.querySelectorAll("ul");
    assert.equal(lists.length, 2, file);
    assert.equal(lists[1].getAttribute("aria-labelledby"), summaries[0].getAttribute("id"), file);
    for (const label of primary) assert.equal(textOf(lists[1]).includes(label), false, `${file}: ${label}`);
    assert.equal(html.split(`>${GROUP}<`).length - 1, 1, `${file}: the group is named once`);
  }
});

test("every global navigation exposes named lists and a native, keyboard-operable disclosure", () => {
  for (const { file, html } of pages) {
    const document = parseHtml(html);
    const nav = document.querySelector(".site-nav");
    const lists = nav.querySelectorAll("ul");
    assert.deepEqual(lists.map((list) => list.querySelectorAll("a").map(textOf)), [primary, secondary], file);
    for (const list of lists) {
      assert.equal(list.getAttribute("role"), "list");
      if (list === lists[0]) assert.equal(list.getAttribute("aria-label"), "Primary", file);
      else assert.ok(document.getElementById(list.getAttribute("aria-labelledby")), file);
    }
    const details = nav.querySelector("details");
    const summary = details.querySelector("summary");
    assert.equal(textOf(summary), GROUP);
    // Native details supplies expanded state to assistive technology. Duplicated
    // aria-expanded or menu roles would introduce a second state model.
    assert.equal(summary.getAttribute("aria-expanded"), null);
    assert.equal(summary.getAttribute("role"), null);
    const current = navCurrentFor(`/${file}`);
    const startsOpen = SITE_NAV.some((link) => link.href === current && link.set === "secondary");
    assert.equal(details.hasAttribute("open"), startsOpen, file);
    summary.focus();
    pressKey(document, "Enter");
    assert.equal(details.hasAttribute("open"), !startsOpen, file);
    pressKey(document, " ");
    assert.equal(details.hasAttribute("open"), startsOpen, file);
    assert.equal(document.activeElement.tagName, "SUMMARY");
    details.removeAttribute("open");
    assert.deepEqual(visibleNavStops(document).map(textOf), [...primary, GROUP], file);
    summary.focus();
    pressKey(document, "Enter");
    assert.deepEqual(visibleNavStops(document).map(textOf), [...primary, GROUP, ...secondary], file);
    pressKey(document, " ");
    assert.deepEqual(visibleNavStops(document).map(textOf), [...primary, GROUP], file);
    details.setAttribute("open", "");
    const stops = tabSequence(document).filter((node) => node.closest(".site-nav"));
    assert.deepEqual(stops.map(textOf), [...primary, GROUP, ...secondary], file);
    assert.equal(nav.querySelectorAll("[tabindex]").length, 0);
    assert.equal(nav.querySelectorAll('[aria-current="page"]').length, 1);
  }
});

test("Decisions opens the existing focusable history target; Home opens the landing page", async () => {
  const home = parseHtml(pages.find(({ file }) => file === "index.html").html);
  const links = home.querySelector(".site-nav").querySelectorAll("a");
  assert.equal(links[0].href, "/index.html");
  assert.equal(links[1].href, "/#decisions-title");
  assert.equal(home.getElementById("decisions-title").getAttribute("tabindex"), "-1");
});

test("both header styles keep touch targets, focus, and a disclosure that opens in place", async () => {
  for (const file of ["styles.css", "agents.css"]) {
    const css = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.match(css, /\.site-nav a \{[^}]*min-height:44px/);
    assert.match(css, /summary\.nav-set-name \{[^}]*display:list-item[^}]*min-height:44px/);
    assert.match(css, /summary:focus-visible \{[^}]*outline:3px solid/);
    // A right-aligned row that widened on open would slide the summary ~350px
    // out from under the pointer. Stacked with the summary pinned to the
    // stacking edge, opening only grows the header downward.
    assert.match(css, /\.site-header \{ align-items:flex-start; \}/);
    assert.match(css, /\.site-nav \{ flex-direction:column; align-items:flex-end;/);
    assert.match(css, /details\.nav-set \{[^}]*text-align:right/);
    const mobile = css.slice(css.lastIndexOf("@media(max-width:600px)"));
    assert.match(mobile, /\.site-nav \{[^}]*width:100%; align-items:flex-start/);
    assert.match(mobile, /details\.nav-set \{[^}]*text-align:left/);
    assert.doesNotMatch(mobile, /position:absolute|overflow:hidden|order:/);
    // At 390px the group label and every item must wrap, not clip or push the
    // page sideways. The harness has no layout, so pin the rules that decide it.
    assert.match(css, /\.nav-set ul \{[^}]*flex-wrap:wrap/);
    assert.match(css, /\.site-nav \{[^}]*flex-wrap:wrap/);
    assert.match(mobile, /\.site-nav details a \{[^}]*overflow-wrap:anywhere/);
    const navRules = css.match(/[^{}]*(?:site-nav|nav-set)[^{}]*\{[^}]*\}/g);
    assert.ok(navRules.length > 10, file);
    for (const rule of navRules) {
      assert.doesNotMatch(rule, /white-space:\s*nowrap|text-overflow|[^-]width:\s*\d+px|overflow:\s*hidden/, `${file}: ${rule.trim()}`);
    }
  }
});
