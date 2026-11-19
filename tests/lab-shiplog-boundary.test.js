import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, textOf, tabSequence } from "./support/browser.js";

for (const route of ["social", "profile", "post", "coach"]) {
  test(`${route}: tool main precedes the named, shared Shiplog landmark`, async (t) => {
    const page = await loadPage(new URL(`../src/${route}.html`, import.meta.url));
    t.after(() => page.restore());
    const { document } = page;
    assert.equal(document.querySelectorAll("main").length, 1);
    assert.equal(document.querySelectorAll("footer").length, 1);
    const main = document.querySelector("main");
    const footer = document.querySelector("footer");
    assert.equal(main.id, "main-content");
    assert.ok(document.querySelector('link[href="/lab-shiplog-followup.css"]'));
    assert.equal(document.querySelector(".skip-link").getAttribute("href"), "#main-content");
    assert.ok(!footer.closest("main"));
    assert.ok(footer.hasAttribute("data-lab-shiplog-followup"));
    const heading = document.querySelector(`#${footer.getAttribute("aria-labelledby")}`);
    assert.equal(heading.tagName, "H2");
    assert.equal(textOf(heading), "About Shiplog");
    assert.equal(heading.closest("footer"), footer);
    const order = [];
    const walk = (node) => { for (const child of node.children) { order.push(child); walk(child); } };
    walk(document);
    assert.ok(order.indexOf(footer) > order.indexOf(main));
    const stops = tabSequence(document);
    const firstFooterStop = stops.findIndex((node) => node.closest("footer"));
    assert.ok(firstFooterStop >= 0);
    for (const [i, node] of stops.entries()) {
      assert.ok(Number(node.getAttribute("tabindex")) <= 0);
      if (node.closest("main")) assert.ok(i < firstFooterStop, `${node.id} follows Shiplog`);
    }
    for (const id of ["ask-about-shiplog", "ask-about-shiplog-demo", "ask-about-shiplog-pilot"]) {
      const link = document.querySelector(`#${id}`);
      if (route === "post") assert.equal(link, null); // Preserve this route's existing controls.
      else assert.equal(link.closest("footer"), footer);
    }
  });
}

test("shared separation uses a rule, spacing and heading, never CSS reordering", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const boundary = await readFile(new URL("../src/lab-shiplog-followup.css", import.meta.url), "utf8");
  assert.match(boundary, /border-top:1px solid/);
  assert.match(boundary, /padding-top:30px/);
  assert.match(boundary, /prefers-color-scheme:dark/);
  assert.doesNotMatch(boundary, /(?:^|[;{])\s*(?:order|grid-area)\s*:|row-reverse|column-reverse|overflow:hidden/);
  assert.match(css, /\.site-footer a:focus-visible[^}]*outline:3px solid var\(--focus-ring\)/);
});
