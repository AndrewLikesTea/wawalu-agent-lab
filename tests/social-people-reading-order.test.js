import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, textOf, tabSequence } from "./support/browser.js";

const surfaces = [
  // The composer closes the reading order on Social (#2709): the feed and its
  // caveats are read first, then the panel for adding a post, then the route
  // off the page. #ask-about-shiplog used to sit above the panel, at the foot of
  // the feed panel. Since #2883 it follows the reporting explanation too, on
  // both pages, so the Shiplog asks come after all of the tool's own content.
  { file: "social", sequence: ["#page-title", "#post-compose-open", "#feed-title", "#post-name-filter", "#post-time-filter", "#feed-state", "#post-feed", ".social-feed-intro", "#feed-source-note", "#post-report-route", "#post-compose-panel", "#post-report-about", "#ask-about-shiplog"], guidance: ".social-feed-intro", state: "#feed-state", label: "Posts are loading." },
  { file: "profile", sequence: ["#page-title", "#profile-author-label", "#profile-author", "#grid-title", "#profile-feed-status", "#profile-grid", ".profile-lede.hint", ".profile-role", ".feed-create", "#ask-about-shiplog"], guidance: ".profile-lede.hint", state: "#profile-feed-status", label: "Image posts are loading." },
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
    // the label sits: on both pages the contact route closes the page, below
    // the tool's own content (#2883). Either way the two are one unit, in one
    // container, in order.
    const askRoute = document.querySelector("#ask-about-shiplog");
    const askCaption = document.querySelector("#ask-about-shiplog-description");
    assert.ok(askCaption.parentNode === askRoute.parentNode,
      "the follow-up caption drifted out of the row its label sits in");
    assert.ok(order.indexOf(askCaption) > order.indexOf(askRoute),
      "the caption is read before the label it explains");
    assert.ok(order.indexOf(askRoute) > order.indexOf(document.querySelector(surface.state)),
      "the contact route is read before the feed it follows");
    let stops = tabSequence(document).filter((node) => node.closest("#main-content"));
    // #2883: no Shiplog ask is a stop until the tool's own stops are done —
    // the route and its two direct asks are the last three in <main>.
    assert.deepEqual(stops.slice(-3).map((node) => node.id),
      ["ask-about-shiplog", "ask-about-shiplog-demo", "ask-about-shiplog-pilot"]);
    // People's introduction ends on the lab identity line, whose one link is
    // the route to Shiplog (#2864); the picker is the stop after it.
    // Social's line carries no link, so its hero adds no stop.
    if (surface.file === "profile") {
      assert.equal(stops[0].parentNode.getAttribute("id"), "lab-identity");
      stops = stops.slice(1);
    }
    // People's picker is drawn by its module, which this first paint has not
    // run; tests/people-landing.test.js walks the hydrated stops.
    if (surface.file === "social") assert.equal(stops[0].id, "post-compose-open");
    else assert.equal(String(stops[0].id).startsWith("ask-about-shiplog"), false);
    assert.ok(stops.every((node) => !Number(node.getAttribute("tabindex"))), "no positive tabindex overrides reading order");
    if (surface.file === "social") {
      assert.deepEqual(stops.slice(0, 4).map((node) => node.id), ["post-compose-open", "post-name-filter", "post-time-filter", "post-filter-clear"]);
      // The time menu's label is "Published", the word on every card (#2993).
      assert.deepEqual(["post-name-filter", "post-time-filter"].map((id) => textOf(document.querySelector(`[for="${id}"]`))),
        ["Filter posts by display name", "Published"]);
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
