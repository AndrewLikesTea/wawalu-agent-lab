import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, textOf, tabSequence } from "./support/browser.js";

const surfaces = [
  // The composer closes the reading order on Social (#2709): the feed and its
  // caveats are read first, then the panel for adding a post, then the route
  // off the page. #ask-about-shiplog used to sit above the panel, at the foot of
  // the feed panel.
  { file: "social", sequence: ["#page-title", "#post-compose-open", "#feed-title", "#post-name-filter", "#post-time-filter", "#feed-state", "#post-feed", ".social-feed-intro", "#feed-source-note", "#post-report-route", "#post-compose-panel", "#ask-about-shiplog"], guidance: ".social-feed-intro", state: "#feed-state", label: "Posts are loading." },
  { file: "profile", sequence: ["#page-title", "#ask-about-shiplog", "#profile-author-label", "#profile-author", "#grid-title", "#profile-feed-status", "#profile-grid", ".profile-lede.hint", ".feed-create", ".profile-role"], guidance: ".profile-lede.hint", state: "#profile-feed-status", label: "Image posts are loading." },
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
    // The follow-up label keeps the caption that says what it costs, wherever
    // the label sits: on Social the hero holds one action and the contact route
    // closes the page below the composer, People has no composer so the route is
    // its hero action. Either way the two are one unit, in one container, in
    // order.
    const askRoute = document.querySelector("#ask-about-shiplog");
    const askCaption = document.querySelector("#ask-about-shiplog-description");
    assert.ok(askCaption.parentNode === askRoute.parentNode,
      "the follow-up caption drifted out of the row its label sits in");
    assert.ok(order.indexOf(askCaption) > order.indexOf(askRoute),
      "the caption is read before the label it explains");
    if (surface.file === "social")
      assert.ok(order.indexOf(askRoute) > order.indexOf(document.querySelector(surface.state)),
        "the contact route is read before the feed it follows");
    const stops = tabSequence(document).filter((node) => node.closest("#main-content"));
    assert.equal(stops[0].id, surface.file === "social" ? "post-compose-open" : "ask-about-shiplog");
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
