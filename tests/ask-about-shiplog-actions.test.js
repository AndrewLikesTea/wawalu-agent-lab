// The two direct asks beside "Ask about Shiplog" on the four secondary pages
// (#2807): "Request a Shiplog demonstration" and "Discuss a Shiplog pilot".
//
// What is pinned, and why:
//
//   1. Both are on the page, named exactly, in the row the route sits in, and
//      each is a link to its own radio in the one existing follow-up form, so a
//      page whose script never ran still lands the reader on that question.
//   2. Activating either one moves FOCUS into that form and preselects the
//      matching answer to "What do you want to discuss?" — read back off the
//      radios and off the request the stubbed transport receives.
//   3. The request still carries the page it came from (purpose and topic), and
//      the sentence saying what is sent is byte-for-byte the shared one.
//   4. No second form arrived with them.
//
// Counts and attributes throughout, never `assert.equal(node, null)`.

import test from "node:test";
import assert from "node:assert/strict";

import { ASK_ABOUT_SHIPLOG_ACTIONS, ASK_ABOUT_SHIPLOG_ID } from "../src/ask-about-shiplog.js";
import { FOLLOW_UP_INTENTS, FOLLOW_UP_PRIVACY_WITH_MESSAGE } from "../src/lead-capture.js";
import { FOLLOW_UP_TOPICS } from "../src/leads.js";
import { initSiteFooter } from "../src/site-footer.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";

const PAGES = [
  ["coach.html", "follow_up_coach"],
  ["social.html", "follow_up_social"],
  ["profile.html", "follow_up_people"],
  ["agents.html", "follow_up_agents"],
];

test("the two labels name only what the form already asks about", () => {
  assert.deepEqual(Object.keys(ASK_ABOUT_SHIPLOG_ACTIONS), ["demo", "pilot"]);
  for (const intent of Object.keys(ASK_ABOUT_SHIPLOG_ACTIONS)) {
    assert.ok(Object.hasOwn(FOLLOW_UP_INTENTS, intent), `${intent} is not an answer the form offers`);
  }
  assert.equal(ASK_ABOUT_SHIPLOG_ACTIONS.demo, "Request a Shiplog demonstration");
  assert.equal(ASK_ABOUT_SHIPLOG_ACTIONS.pilot, "Discuss a Shiplog pilot");
});

for (const [file, purpose] of PAGES) {
  for (const [intent, label] of Object.entries(ASK_ABOUT_SHIPLOG_ACTIONS)) {
    for (const activation of ["keyboard", "click"]) {
      test(`${file}: "${label}" by ${activation} lands in the follow-up form with ${intent} chosen`, async (t) => {
        const page = await loadPage(new URL(`../src/${file}`, import.meta.url));
        t.after(() => page.restore());
        const { document } = page;

        const actions = document.querySelectorAll("a")
          .filter((link) => link.getAttribute("data-follow-up-intent") === intent);
        assert.equal(actions.length, 1, `${file}: ${actions.length} "${label}" actions`);
        const [action] = actions;
        assert.equal(textOf(action), label);
        assert.equal(action.getAttribute("href"), `#site-footer-intent-${intent}`,
          `${file}: the no-script fallback does not land on the matching answer`);
        // In the route's own row, or — on Social, where the route sits loose in
        // <main> — in a row of its own straight after the route's caption.
        const route = document.getElementById(ASK_ABOUT_SHIPLOG_ID);
        const caption = document.getElementById("ask-about-shiplog-description");
        const row = action.parentNode;
        assert.ok(row === route.parentNode
          || (row.getAttribute("id") === "ask-about-shiplog-intents"
            && caption.parentNode.childElements.indexOf(row) === caption.parentNode.childElements.indexOf(caption) + 1),
        `${file}: the action is not beside Ask about Shiplog`);
        assert.ok(tabSequence(document).includes(action), `${file}: the action is not a tab stop`);

        // One form, the existing one, and the radios the action targets are in it.
        assert.equal(document.querySelectorAll("form").filter((form) => form.querySelectorAll("button")
          .some((button) => textOf(button) === "Request a follow-up")).length, 1);
        const form = document.getElementById("site-footer-form");
        const radios = form.querySelectorAll('input[name="intent"]');
        assert.equal(radios.filter((radio) => radio.getAttribute("id") === `site-footer-intent-${intent}`).length, 1);
        assert.equal(radios.filter((radio) => radio.checked).length, 0, "a topic was chosen before the visitor chose one");

        const script = document.querySelector('script[src="/ask-about-shiplog-page.js"]');
        assert.ok(script, `${file}: the page does not load the module that wires the actions`);
        await importPageModule(script.getAttribute("src"));
        const calls = [];
        initSiteFooter(document, async (_url, options) => {
          calls.push(JSON.parse(options.body));
          return new Response(JSON.stringify({ ok: true, created: true }), { status: 201 });
        });

        action.focus();
        if (activation === "keyboard") pressEnter(document);
        else action.click();

        const radio = document.getElementById(`site-footer-intent-${intent}`);
        assert.ok(document.activeElement === radio, `${file}: focus is on ${document.activeElement?.id}, not the chosen answer`);
        assert.ok(form.querySelectorAll(`#${radio.getAttribute("id")}`).length === 1, "focus left the follow-up form");
        assert.deepEqual(radios.filter((node) => node.checked).map((node) => node.value), [intent]);
        assert.deepEqual(document.navigations, [`#site-footer-intent-${intent}`]);

        // What is sent is said exactly as before.
        assert.equal(textOf(document.getElementById("site-footer-note")), FOLLOW_UP_PRIVACY_WITH_MESSAGE);

        document.getElementById("site-footer-email").value = "reader@example.com";
        form.querySelector('button[type="submit"]').click();
        await waitFor(() => calls.length === 1, "follow-up request");
        assert.equal(calls[0].purpose, purpose, `${file}: the request no longer names its page`);
        assert.equal(calls[0].topic, FOLLOW_UP_TOPICS[purpose]);
        assert.equal(calls[0].intent, intent);
      });
    }
  }
}

test("choosing the other action replaces the first choice", async (t) => {
  const page = await loadPage(new URL("../src/coach.html", import.meta.url));
  t.after(() => page.restore());
  const { document } = page;
  await importPageModule("/ask-about-shiplog-page.js");
  initSiteFooter(document, async () => new Response("{}", { status: 201 }));
  document.getElementById("ask-about-shiplog-demo").click();
  document.getElementById("ask-about-shiplog-pilot").click();
  const checked = document.getElementById("site-footer-form").querySelectorAll('input[name="intent"]')
    .filter((radio) => radio.checked);
  assert.deepEqual(checked.map((radio) => radio.value), ["pilot"]);
  assert.equal(document.activeElement?.getAttribute("id"), "site-footer-intent-pilot");
});
