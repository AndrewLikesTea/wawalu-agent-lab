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
import { initSiteFooter, NOTE_GUIDANCE } from "../src/site-footer.js";
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

        // #2962: the answer is chosen, so focus goes to the field still to fill.
        assert.ok(document.activeElement === document.getElementById("site-footer-email"),
          `${file}: focus is on ${document.activeElement?.id}, not the work email`);
        assert.equal(form.querySelectorAll("#site-footer-email").length, 1, "focus left the follow-up form");
        assert.deepEqual(radios.filter((node) => node.checked).map((node) => node.value), [intent]);
        // The radio is the fragment target and a browser would focus it, so the
        // address is pushed rather than navigated: still shareable, Back still works.
        assert.deepEqual(document.navigations, []);
        assert.equal(window.location.hash, `#site-footer-intent-${intent}`);

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

// One name per action on every page that offers it (#2844): any link or button
// that moves to the follow-up form and names a demonstration or a pilot says it
// with the shared pair, never "Request a demonstration" or "Discuss a pilot
// evaluation". post.html offers neither and must keep it that way or match.
const TARGETS_FORM = (node) => ["href", "data-target"]
  .some((name) => (node.getAttribute(name) ?? "").startsWith("#site-footer"));
for (const [file, offers] of [["social.html", true], ["profile.html", true], ["post.html", false],
  ["index.html", true], ["releases.html", true], ["coach.html", true]]) {
  test(`${file}: demonstration and pilot actions use the one shared pair`, async (t) => {
    const page = await loadPage(new URL(`../src/${file}`, import.meta.url));
    t.after(() => page.restore());
    const labels = [...page.document.querySelectorAll("a"), ...page.document.querySelectorAll("button")]
      .filter(TARGETS_FORM).map(textOf).filter((text) => /demonstration|pilot/i.test(text));
    for (const label of labels) {
      assert.ok(Object.values(ASK_ABOUT_SHIPLOG_ACTIONS).includes(label), `${file}: variant action label "${label}"`);
    }
    assert.deepEqual([...new Set(labels)].sort(), offers ? Object.values(ASK_ABOUT_SHIPLOG_ACTIONS).sort() : []);
  });
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
  assert.equal(document.activeElement?.getAttribute("id"), "site-footer-email");
});

// #2962: the same fragment, arrived at by URL — a shared link, a new tab, Back.
const radiosOf = (document) => document.getElementById("site-footer-form").querySelectorAll('input[name="intent"]');
for (const [file, purpose] of PAGES) {
  for (const intent of Object.keys(ASK_ABOUT_SHIPLOG_ACTIONS)) {
    test(`${file}: opened at #site-footer-intent-${intent}, the answer is chosen, changeable, and the page still named`, async (t) => {
      const page = await loadPage(new URL(`../src/${file}`, import.meta.url), { location: { hash: `#site-footer-intent-${intent}` } });
      t.after(() => page.restore());
      const { document } = page;
      await importPageModule("/ask-about-shiplog-page.js");
      const calls = [];
      initSiteFooter(document, async (_url, options) => {
        calls.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ ok: true, created: true }), { status: 201 });
      });
      const radios = radiosOf(document);
      assert.deepEqual(radios.filter((node) => node.checked).map((node) => node.value), [intent]);
      // The page entry chooses before the footer script wires its listeners, as
      // the script tags are ordered; the footer still shows that answer's guidance.
      assert.equal(textOf(document.getElementById("site-footer-message-guidance")), NOTE_GUIDANCE[intent] ?? "");
      assert.ok(radios.map((node) => node.getAttribute("value")).includes(intent), "the chosen value is not a listed answer");
      assert.equal(document.activeElement?.getAttribute("id"), "site-footer-email");
      assert.equal(textOf(document.getElementById("site-footer-topic-note")),
        `This request is sent about the ${FOLLOW_UP_TOPICS[purpose]}.`);

      // Back/Forward to the other answer.
      const other = intent === "demo" ? "pilot" : "demo";
      window.location.hash = `#site-footer-intent-${other}`;
      window.dispatchEvent({ type: "hashchange" });
      assert.deepEqual(radios.filter((node) => node.checked).map((node) => node.value), [other]);

      // The visitor changes their mind; what they chose is what is sent.
      document.getElementById("site-footer-intent-availability_pricing").click();
      document.getElementById("site-footer-email").value = "reader@example.com";
      document.getElementById("site-footer-form").querySelector('button[type="submit"]').click();
      await waitFor(() => calls.length === 1, "follow-up request");
      assert.deepEqual([calls[0].purpose, calls[0].topic, calls[0].intent],
        [purpose, FOLLOW_UP_TOPICS[purpose], "availability_pricing"]);
    });
  }
}

// Only an exact radio id counts: none of these chooses, moves focus, or throws.
const MALFORMED = ["#", "#site-footer-intent-", "#site-footer-intent-sales", "#site-footer-intent-Demo",
  "#site-footer-intent-demo#site-footer-intent-pilot", "#site-footer-intent-pilot&x=1", "#site-footer-intent-%E0%A4%A",
  "#site-footer-panel"];
for (const [file] of PAGES) {
  test(`${file}: an unknown, malformed or repeated fragment leaves the default`, async (t) => {
    const page = await loadPage(new URL(`../src/${file}`, import.meta.url), { location: { hash: MALFORMED[0] } });
    t.after(() => page.restore());
    const { document } = page;
    await importPageModule("/ask-about-shiplog-page.js");
    for (const hash of MALFORMED) {
      window.location.hash = hash;
      window.dispatchEvent({ type: "hashchange" });
      assert.equal(radiosOf(page.document).filter((node) => node.checked).length, 0, `${hash} chose an answer`);
      assert.notEqual(document.activeElement?.getAttribute?.("id"), "site-footer-email", `${hash} moved focus`);
    }
  });
}
