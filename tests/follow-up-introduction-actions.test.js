import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { initSiteFooter } from "../src/site-footer.js";
import { FOLLOW_UP_TOPICS } from "../src/leads.js";
import { FOLLOW_UP_REPLY } from "../src/lead-capture.js";
import {
  ASK_ABOUT_SHIPLOG_DESCRIPTION, ASK_ABOUT_SHIPLOG_DESCRIPTION_ID,
} from "../src/ask-about-shiplog.js";

// The third entry is the region the route belongs to on that page, and the
// fourth is the class its immediate container carries. The region is the page's
// introduction wherever the route is the introduction's own action; since #2654
// the prompt coach carries it below the grade for the same reason, so the page's
// promise is not separated from the example that keeps it. Social is the one
// page where the route belongs to no region: it used to close the feed panel's
// supporting block, and since #2709 the composer is read after the feed, so the
// route closes the page below the composer instead. Its container is
// <main> itself, which carries no class — hence the null.
const pages = [
  ["coach", "follow_up_coach", "#ask-about-shiplog-actions", "hero-actions"],
  ["social", "follow_up_social", "#main-content", null],
  ["profile", "follow_up_people", ".hero-profile", "hero-actions"],
  ["agents", "follow_up_agents", ".observatory-hero", "hero-actions"],
];

for (const [name, purpose, heroSelector, containerClass] of pages) {
  for (const activation of ["keyboard", "click"]) {
    test(`${name}: introduction action ${activation} focuses the existing follow-up and retains request identity`, async (t) => {
      const page = await loadPage(new URL(`../src/${name}.html`, import.meta.url));
      t.after(() => page.restore());
      const { document } = page;
      const route = document.querySelector("#ask-about-shiplog");
      assert.equal(document.querySelectorAll("#ask-about-shiplog").length, 1);
      assert.ok(document.querySelector(heroSelector)?.querySelector("#ask-about-shiplog") === route, "the action left the region that carries it");
      assert.equal(textOf(route), "Ask about Shiplog");
      assert.equal(route.tagName, "A");
      assert.equal(route.getAttribute("href"), "#site-footer-panel");
      assert.ok(route.classList.contains("text-link"));
      // The route and its description are direct children of one container, so
      // neither is nested a level deeper than the other inside the region.
      const inContainer = (node, label) => {
        if (containerClass) assert.ok(node.parentNode.classList.contains(containerClass), label);
        else assert.equal(node.parentNode.getAttribute("id"), heroSelector.slice(1), label);
      };
      inContainer(route, `${name}: the label left the container that carries it`);
      assert.ok(tabSequence(document).includes(route));

      // #2556: the label does not travel alone. The line that says where the
      // route goes belongs to the introduction, beside the label, and is not a
      // control. (The prompt coach replaces its entry copy on load, so that page
      // is also checked after its own modules run, in
      // tests/prompt-coach-destination.test.js.)
      const described = document.querySelectorAll("p")
        .filter((node) => node.getAttribute("id") === ASK_ABOUT_SHIPLOG_DESCRIPTION_ID);
      assert.equal(described.length, 1, `${name}: the description is painted ${described.length} times`);
      assert.equal(textOf(described[0]), ASK_ABOUT_SHIPLOG_DESCRIPTION);
      inContainer(described[0], `${name}: the description drifted away from the label it explains`);
      assert.equal(described[0].parentNode === route.parentNode, true,
        `${name}: the description and its label no longer share a container`);
      assert.ok(!tabSequence(document).includes(described[0]),
        `${name}: the description became a tab stop of its own`);
      assert.equal(document.querySelectorAll("#site-footer-form").length, 1);
      const script = document.querySelector('script[src="/ask-about-shiplog-page.js"]');
      assert.ok(script, "the shipped page wires the action independently of its data loading");
      await importPageModule(script.getAttribute("src"));
      const calls = [];
      initSiteFooter(document, async (_url, options) => {
        calls.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      });
      const form = document.querySelector("#site-footer-form");
      const panel = document.querySelector("#site-footer-panel");
      const email = document.querySelector("#site-footer-email");
      email.value = "reader@example.com";
      document.querySelector("#site-footer-intent-pilot").click();
      route.focus();
      if (activation === "keyboard") pressEnter(document);
      else route.click();
      assert.equal(document.activeElement?.id, panel.id);
      assert.equal(panel.getAttribute("tabindex"), "-1");
      assert.ok(!tabSequence(document).includes(panel), "focus target adds no tab stop");
      assert.ok(panel.querySelector("#site-footer-form") === form);
      assert.equal(email.value, "reader@example.com", "jump preserves entered values");
      // #2689: the reader who just arrived at the form meets the reply promise
      // for the first time here, not for the second. The caption they followed
      // used to end on the same sentence. Counted on the painted page after the
      // footer's own module ran, so the one surviving copy is the form's.
      const replies = document.querySelectorAll("p").filter((node) => textOf(node) === FOLLOW_UP_REPLY);
      assert.equal(replies.length, 1, `${name}: the reply promise is painted ${replies.length} times`);
      assert.ok(form.querySelector("#site-footer-reply") === replies[0],
        `${name}: the surviving copy is not the one inside the follow-up form`);

      assert.equal(form.dataset.followUpType, purpose);
      assert.equal(form.dataset.followUpTopic, FOLLOW_UP_TOPICS[purpose]);
      assert.ok(textOf(document.querySelector("#site-footer-topic-note")).includes(FOLLOW_UP_TOPICS[purpose]));
      form.querySelector('button[type="submit"]').click();
      await waitFor(() => calls.length === 1, "follow-up request");
      assert.equal(calls[0].purpose, purpose);
      assert.equal(calls[0].topic, FOLLOW_UP_TOPICS[purpose]);
    });
  }
}

test("introduction actions reuse wrapping rows and reduced-motion scrolling", async () => {
  // This repository's DOM harness has no layout engine: verify CSS contracts,
  // without pretending a viewport number measures rendered geometry.
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.hero-actions\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /@media[^{}]*max-width:\s*\d+px[^]*?\.hero-actions\{[^}]*flex-direction:column/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\s*\{\s*html\{scroll-behavior:auto\}/);
});
