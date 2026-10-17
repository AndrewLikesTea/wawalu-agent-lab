import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { parseHtml, textOf } from "./support/browser.js";

// Use the production artifact too when running this focused suite after build.
const root = new URL(`../${process.env.SHIPLOG_E2E_BUILD_ROOT || "src"}/`, import.meta.url);
const required = ["social.html", "profile.html", "post.html", "index.html", "releases.html", "coach.html"];
const checked = [];

for (const file of await readdir(root)) {
  if (!file.endsWith(".html")) continue;
  const html = await readFile(new URL(file, root), "utf8");
  const document = parseHtml(html);
  const header = document.querySelector(".site-header");
  if (!header?.querySelector(".site-nav")) continue;
  checked.push(file);

  test(`${file}: header names Shiplog once, through one accessible home link`, () => {
    const brands = header.querySelectorAll(".brand");
    assert.equal(brands.length, 1);
    const brand = brands[0];
    assert.equal(brand.tagName, "A");
    assert.equal(brand.getAttribute("href"), file === "index.html" ? "#top" : "/");
    assert.equal(textOf(brand).trim(), "Shiplog");
    assert.equal(brand.getAttribute("aria-label"), null);
    assert.equal(brand.getAttribute("aria-labelledby"), null);
    assert.equal(brand.getAttribute("aria-hidden"), null);
    assert.equal(brand.hasAttribute("hidden"), false);
    assert.equal(brand.querySelector(".mark").getAttribute("aria-hidden"), "true");
    assert.equal((textOf(header).match(/\bShiplog\b/g) || []).length, 1,
      "the brand must not return as a second caption, even one hidden with CSS");

    // Check naming references as well as text: pointing the primary list at
    // the home link would repeat Shiplog in the accessibility tree.
    const descendants = (node) => [node, ...node.children.flatMap(descendants)];
    for (const node of descendants(header).filter((node) => node.getAttribute)) {
      for (const attribute of ["aria-label", "title", "alt"]) {
        assert.doesNotMatch(node.getAttribute(attribute) || "", /Shiplog/i);
      }
      for (const attribute of ["aria-labelledby", "aria-describedby"]) {
        for (const id of (node.getAttribute(attribute) || "").split(/\s+/).filter(Boolean)) {
          const target = document.getElementById(id);
          assert.ok(target, `${attribute} must resolve: ${id}`);
          assert.doesNotMatch(textOf(target), /Shiplog/i);
        }
      }
    }
    const nav = header.querySelector(".site-nav");
    assert.equal(nav.getAttribute("aria-label"), "Site");
    const primary = nav.querySelector("ul");
    assert.equal(primary.getAttribute("aria-label"), "Primary");
    assert.deepEqual(primary.querySelectorAll("a").map(textOf), ["Home", "Decision log", "Releases"]);
    assert.equal(textOf(nav.querySelector("summary")), "More destinations");
  });
}

test("brand regression coverage includes all six requested surfaces", () => {
  for (const file of required) assert.ok(checked.includes(file), file);
});
