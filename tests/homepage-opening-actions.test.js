import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";
import { initSiteFooter } from "../src/site-footer.js";
import { importPageModule, waitFor } from "./support/page-module.js";

for (const enhanced of [true, false]) {
  for (const keyboard of [true, false]) {
    test(`opening actions share topic state and destination (scroll=${enhanced}, keyboard=${keyboard})`, async (t) => {
      const page = await loadPage(new URL("../src/index.html", import.meta.url));
      t.after(() => page.restore());
      const { document } = page;
      const panel = document.getElementById("site-footer-panel");
      const email = document.getElementById("site-footer-email");
      const initialFocus = document.activeElement;
      const scrolls = [];
      panel.scrollIntoView = enhanced ? (options) => scrolls.push(options) : undefined;
      await importPageModule("/homepage-buyer-intent.js");
      assert.ok(document.activeElement === initialFocus, "initialization must not steal focus");
      email.value = "reader@example.com";
      for (const [id, intent, label, topic] of [
        ["ask-about-shiplog", "demo", "Request a demonstration", "A product demonstration"],
        ["discuss-pilot", "pilot", "Discuss a pilot", "A pilot evaluation"],
      ]) {
        const link = document.getElementById(id);
        assert.ok(link.closest("#shiplog-entry"));
        assert.equal(link.tagName, "A");
        assert.equal(textOf(link), label);
        assert.equal(link.getAttribute("aria-label"), null);
        assert.equal(link.getAttribute("href"), "#site-footer-panel");
        // The description both routes share must say what activating one DOES.
        // It read as an instruction to go and use the form until #2623, which
        // is the errand these controls now run: a keyboard or screen-reader
        // user hears it before committing, and it is the only place the move
        // and the topic are announced in advance.
        const described = document.getElementById(link.getAttribute("aria-describedby"));
        assert.match(textOf(described), /^Both actions move you to the follow-up form/);
        assert.doesNotMatch(textOf(described), /^Use the follow-up form/);
        // And it says what is shown, not what is sent: the topic never leaves
        // this page, so a description promising otherwise would be a claim the
        // request cannot substantiate.
        assert.match(textOf(described), /sends your work email address and nothing else/);
        assert.ok(tabSequence(document).includes(link));
        link.focus();
        if (keyboard) pressEnter(document);
        else link.click();
        assert.equal(document.activeElement?.id, email.id);
        assert.equal(email.value, "reader@example.com");
        assert.equal(textOf(document.getElementById("buyer-intent-choice")), `Discussion topic: ${topic}`);
        assert.ok(textOf(document.getElementById("buyer-intent-carried")).includes(topic));
        assert.equal(document.getElementById(`buyer-intent-${intent}`).getAttribute("aria-pressed"), "true");
      }
      assert.deepEqual(document.navigations, ["#site-footer-panel", "#site-footer-panel"]);
      assert.equal(document.querySelectorAll("#site-footer-form").length, 1);
      assert.deepEqual(scrolls, enhanced ? [{ block: "start" }, { block: "start" }] : []);
      document.getElementById("buyer-intent-demo").click();
      assert.equal(document.getElementById("buyer-intent-pilot").getAttribute("aria-pressed"), "false");
    });
  }
}

test("opening links retain their native destination without scripts", async (t) => {
  const page = await loadPage(new URL("../src/index.html", import.meta.url));
  t.after(() => page.restore());
  for (const id of ["ask-about-shiplog", "discuss-pilot"]) page.document.getElementById(id).click();
  assert.deepEqual(page.document.navigations, ["#site-footer-panel", "#site-footer-panel"]);
  assert.equal(page.document.getElementById("site-footer-form").hidden, false);
});

test("destination spacing, responsive rows, reduced motion and visible focus use existing CSS", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /#site-footer-panel\s*\{\s*scroll-margin-top:24px/);
  assert.match(css, /\.hero-actions\s*\{[^}]*flex-wrap:wrap/);
  assert.match(css, /\.hero-actions\{[^}]*flex-direction:column/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\s*\{\s*html\{scroll-behavior:auto/);
  assert.match(css, /a:focus-visible\s*\{\s*outline:3px solid/);
});


test("an opening action reopens a completed request before focusing its field", async (t) => {
  const page = await loadPage(new URL("../src/index.html", import.meta.url));
  t.after(() => page.restore());
  const { document } = page;
  initSiteFooter(document, async () => new Response(JSON.stringify({
    captured: true, created: true, purpose: "follow_up_homepage",
  }), { status: 201 }));
  await importPageModule("/homepage-buyer-intent.js");
  const form = document.getElementById("site-footer-form");
  document.getElementById("site-footer-email").value = "reader@example.com";
  form.querySelector('button[type="submit"]').click();
  await waitFor(() => form.hidden, "completed request");
  document.getElementById("discuss-pilot").click();
  assert.equal(form.hidden, false);
  assert.equal(document.activeElement?.id, "site-footer-email");
  assert.equal(textOf(document.getElementById("buyer-intent-choice")), "Discussion topic: A pilot evaluation");
});
