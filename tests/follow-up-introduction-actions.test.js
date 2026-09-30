import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { initSiteFooter } from "../src/site-footer.js";
import { FOLLOW_UP_TOPICS } from "../src/leads.js";
import { FOLLOW_UP_INTENTS, FOLLOW_UP_REPLY } from "../src/lead-capture.js";
import {
  ASK_ABOUT_SHIPLOG_DESCRIPTION, ASK_ABOUT_SHIPLOG_DESCRIPTION_ID,
} from "../src/ask-about-shiplog.js";

const pages = [
  ["coach", "follow_up_coach", ".coach-hero"],
  ["social", "follow_up_social", ".list-panel"],
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
      assert.ok(route.parentNode.classList.contains(name === "social" ? "list-panel" : "hero-actions"));
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
      assert.ok(described[0].parentNode.classList.contains(name === "social" ? "list-panel" : "hero-actions"),
        `${name}: the description drifted away from the label it explains`);
      assert.ok(!tabSequence(document).includes(described[0]),
        `${name}: the description became a tab stop of its own`);

      // #2643: that line names what a visitor can ask this page's form FOR — a
      // product demonstration or a pilot evaluation, in the order the fieldset
      // below lists them — rather than listing the fields they will fill in, and
      // it still ends on the reply promise. Read off the painted caption rather
      // than the constant, so a page shipping a stale copy fails here.
      const caption = textOf(described[0]);
      const offers = [FOLLOW_UP_INTENTS.demo.toLowerCase(), FOLLOW_UP_INTENTS.pilot.toLowerCase()];
      for (const offer of offers) {
        assert.ok(caption.includes(offer),
          `${name}: the line does not say a visitor can ask for ${offer}`);
      }
      assert.ok(caption.indexOf(offers[0]) < caption.indexOf(offers[1]),
        `${name}: the line names the two offers in an order this page's fieldset does not list them in`);
      assert.ok(caption.endsWith(FOLLOW_UP_REPLY),
        `${name}: the line no longer says: ${FOLLOW_UP_REPLY}`);
      // The cost answer stays the form's to give, once, further down the page.
      assert.doesNotMatch(caption, /price|pricing|availability/i,
        `${name}: the line restates the availability answer the form below already gives`);

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
      // And the two the line names are really on the form below it, under those
      // names and in that order. Labels rather than values: the label is what a
      // reader matches the introduction's sentence against when they arrive.
      const choices = document.querySelector("#site-footer-intent")
        .querySelectorAll("label").map((label) => textOf(label));
      assert.deepEqual(choices, Object.values(FOLLOW_UP_INTENTS),
        `${name}: the follow-up fieldset no longer offers the topics the introduction names`);
      assert.deepEqual(choices.slice(1, 3), [FOLLOW_UP_INTENTS.demo, FOLLOW_UP_INTENTS.pilot],
        `${name}: the demonstration and the pilot are not where the introduction says they are`);

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
