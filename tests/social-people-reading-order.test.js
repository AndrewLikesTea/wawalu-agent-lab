import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, textOf, tabSequence } from "./support/browser.js";

const surfaces = [
  { file: "social", sequence: ["#page-title", "#post-compose-open", "#feed-title", "#post-name-filter", "#post-time-filter", "#feed-state", "#post-feed", ".social-feed-intro", "#feed-source-note"], guidance: ".social-feed-intro", state: "#feed-state", label: "Posts are loading." },
  // People used to read its follow-up route second, between the tagline and the
  // picker (#2640). The picker and the image posts lead the page now and the
  // route closes the results panel, which is the order Social already reads in.
  { file: "profile", sequence: ["#page-title", "#profile-author-label", "#profile-author", "#grid-title", "#profile-feed-status", "#profile-grid", ".profile-lede.hint", ".feed-create", ".profile-role", "#ask-about-shiplog"], guidance: ".profile-lede.hint", state: "#profile-feed-status", label: "Image posts are loading." },
];

for (const surface of surfaces) {
  test(`${surface.file}: actions, filters and results precede supporting captions on first paint`, async (t) => {
    const page = await loadPage(new URL(`../src/${surface.file}.html`, import.meta.url));
    t.after(() => page.restore());
    const { document } = page;
    const order = [];
    const walk = (node) => { for (const child of node.children) { order.push(child); walk(child); } };
    walk(document.querySelector("#main-content"));
    let previous = -1;
    for (const selector of surface.sequence) {
      const node = document.querySelector(selector);
      assert.ok(node, selector);
      const index = order.indexOf(node);
      assert.ok(index > previous, `${selector} must follow the preceding reading step`);
      previous = index;
    }
    assert.ok(textOf(document.querySelector(surface.state)).startsWith(surface.label));
    assert.equal(document.querySelector(surface.state).hidden, false);
    assert.equal(document.querySelector(surface.guidance).classList.contains("hint"), true);
    // The follow-up label keeps the caption that says what it costs, and both
    // pages now close their supporting block with it: Social's hero holds the
    // composer, People has no composer at all, so on neither page does the
    // errand off the page stand in front of the posts. Either way the two are
    // one unit, in one container, in order — and each is painted once.
    const askRoute = document.querySelector("#ask-about-shiplog");
    const askCaption = document.querySelector("#ask-about-shiplog-description");
    assert.equal(document.querySelectorAll("#ask-about-shiplog").length, 1,
      "the follow-up label is painted more than once");
    assert.equal(document.querySelectorAll("#ask-about-shiplog-description").length, 1,
      "the follow-up caption is painted more than once");
    assert.ok(askCaption.parentNode === askRoute.parentNode,
      "the follow-up caption drifted out of the row its label sits in");
    assert.ok(order.indexOf(askCaption) > order.indexOf(askRoute),
      "the caption is read before the label it explains");
    assert.ok(order.indexOf(askRoute) > order.indexOf(document.querySelector(surface.state)),
      "the contact route is read before the feed it follows");
    const stops = tabSequence(document).filter((node) => node.closest("#main-content"));
    if (surface.file === "social") {
      assert.equal(stops[0].id, "post-compose-open");
    } else {
      // People draws its picker from the posts, so the served page's first stop
      // in the content region is already inside the results panel, and the
      // follow-up route is the last stop there rather than the first.
      assert.ok(stops[0].closest(".list-panel"),
        "a control stands in front of People's image posts on the served page");
      assert.equal(stops.at(-1).id, "ask-about-shiplog",
        "the follow-up route is no longer the last stop in the content region");
    }
    assert.ok(stops.every((node) => !Number(node.getAttribute("tabindex"))), "no positive tabindex overrides reading order");
    if (surface.file === "social") {
      assert.deepEqual(stops.slice(0, 4).map((node) => node.id), ["post-compose-open", "post-name-filter", "post-time-filter", "post-filter-clear"]);
      for (const id of ["post-name-filter", "post-time-filter"]) {
        assert.match(textOf(document.querySelector(`[for="${id}"]`)), /^Filter posts by/);
      }
    } else {
      assert.equal(textOf(document.querySelector("#profile-author-label")), "Filter image posts by display name");
    }
  });
}

// This is a responsive stylesheet contract, not a simulated layout measurement.
// At 390px the same DOM must remain in normal reading order, with wrapping
// controls; no CSS ordering may put supporting copy back ahead of results.
test("390px uses wrapping controls and keeps the document's reading order", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const phone = css.slice(css.indexOf("/* Phone: loaded and loading tiles"), css.indexOf("/* Supersede link"));
  assert.match(phone, /@media\(max-width:520px\)/);
  assert.match(phone, /\.hero-actions\{[^}]*flex-direction:column/);
  assert.match(phone, /\.profile-toolbar\{[^}]*flex-direction:column/);
  assert.match(css, /\.social-toolbar\s*\{[^}]*flex-wrap:wrap/);
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g);
  for (const [, selectors, declarations] of rules) {
    if (!/hero|workspace|list-panel|social-toolbar|profile-toolbar|profile-lede|social-feed-intro|profile-role/.test(selectors)) continue;
    assert.doesNotMatch(declarations, /(?:^|;)\s*(?:order|grid-area)\s*:|flex-direction\s*:\s*\w+-reverse/, selectors);
  }
});
