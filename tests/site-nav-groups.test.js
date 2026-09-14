import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { NAV_SETS, SITE_NAV, navCurrentFor } from "../src/site-nav.js";
import { parseHtml, pressKey, tabSequence, textOf } from "./support/browser.js";

const primary = ["Home", "Decisions", "Releases"];
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

test("Shiplog leads and unrelated tools have a neutral secondary label", () => {
  assert.deepEqual(NAV_SETS.map((set) => set.label), ["Shiplog", "More lab tools"]);
  assert.deepEqual(SITE_NAV.filter((link) => link.set === "primary").map((link) => link.label), primary);
  assert.deepEqual(SITE_NAV.filter((link) => link.set === "secondary").map((link) => link.label), secondary);
  assert.equal(pages.length, 17);
});

test("every global navigation exposes named lists and a native, keyboard-operable disclosure", () => {
  for (const { file, html } of pages) {
    const document = parseHtml(html);
    const nav = document.querySelector(".site-nav");
    const lists = nav.querySelectorAll("ul");
    assert.deepEqual(lists.map((list) => list.querySelectorAll("a").map(textOf)), [primary, secondary], file);
    for (const list of lists) {
      assert.equal(list.getAttribute("role"), "list");
      assert.ok(document.getElementById(list.getAttribute("aria-labelledby")), file);
    }
    const details = nav.querySelector("details");
    const summary = details.querySelector("summary");
    assert.equal(textOf(summary), "More lab tools");
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
    assert.deepEqual(visibleNavStops(document).map(textOf), [...primary, "More lab tools"], file);
    summary.focus();
    pressKey(document, "Enter");
    assert.deepEqual(visibleNavStops(document).map(textOf), [...primary, "More lab tools", ...secondary], file);
    pressKey(document, " ");
    assert.deepEqual(visibleNavStops(document).map(textOf), [...primary, "More lab tools"], file);
    details.setAttribute("open", "");
    const stops = tabSequence(document).filter((node) => node.closest(".site-nav"));
    assert.deepEqual(stops.map(textOf), [...primary, "More lab tools", ...secondary], file);
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
  }
});
