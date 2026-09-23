import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { initSiteFooter } from "../src/site-footer.js";
import { FOLLOW_UP_TOPICS } from "../src/leads.js";

const pages = [
  ["coach", "follow_up_coach", ".coach-hero"],
  ["social", "follow_up_social", ".hero-social"],
  ["profile", "follow_up_people", ".hero-profile"],
  ["agents", "follow_up_agents", ".observatory-hero"],
];

for (const [name, purpose, heroSelector] of pages) {
  for (const activation of ["keyboard", "click"]) {
    test(`${name}: introduction action ${activation} focuses the existing follow-up and retains request identity`, async (t) => {
      const page = await loadPage(new URL(`../src/${name}.html`, import.meta.url));
      t.after(() => page.restore());
      const { document } = page;
      const route = document.querySelector("#ask-about-shiplog");
      assert.equal(document.querySelectorAll("#ask-about-shiplog").length, 1);
      assert.ok(document.querySelector(heroSelector)?.querySelector("#ask-about-shiplog") === route, "action belongs to the introduction");
      assert.equal(textOf(route), "Ask about Shiplog");
      assert.equal(route.tagName, "A");
      assert.equal(route.getAttribute("href"), "#site-footer-panel");
      assert.ok(route.classList.contains("text-link"));
      assert.ok(route.parentNode.classList.contains("hero-actions"));
      assert.ok(tabSequence(document).includes(route));
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
