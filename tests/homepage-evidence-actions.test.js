import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { initSiteFooter } from "../src/site-footer.js";
import { FOLLOW_UP_INTENTS, FOLLOW_UP_REPLY } from "../src/lead-capture.js";

for (const intent of ["demo", "pilot"]) {
  test(`repository evidence ${intent} action preserves the topic through the existing follow-up`, async (t) => {
    const page = await loadPage(new URL("../src/index.html", import.meta.url));
    t.after(() => page.restore());
    const { document } = page;
    const requests = [];
    initSiteFooter(document, async (url, options) => {
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ captured: true, created: true, purpose: "follow_up_homepage" }), { status: 201 });
    });
    await importPageModule("/homepage-buyer-intent.js");
    const evidence = document.getElementById("repository-evidence");
    const actions = document.getElementById("repository-evidence-actions");
    assert.ok(actions.parentNode === evidence);
    const children = [...evidence.children];
    assert.ok(children.indexOf(actions) > children.indexOf(document.getElementById("repository-release-pair")));
    assert.ok(evidence.querySelector("#repository-evidence-source"));
    assert.equal(actions.querySelectorAll("a").length, 2);
    const link = actions.querySelector(`[data-buyer-intent="${intent}"]`);
    assert.equal(link.tagName, "A");
    assert.equal(textOf(link), intent === "demo" ? "Request a Shiplog demonstration" : "Discuss a Shiplog pilot");
    assert.equal(link.getAttribute("href"), "#site-footer-panel");
    assert.equal(textOf(document.getElementById(link.getAttribute("aria-describedby"))), FOLLOW_UP_REPLY);
    assert.ok(tabSequence(document).includes(link));
    link.focus();
    pressEnter(document);
    assert.equal(document.activeElement?.id, "site-footer-email");
    assert.equal(document.getElementById("buyer-intent-topic").value, intent);
    assert.ok(textOf(document.getElementById("buyer-intent-carried")).includes(FOLLOW_UP_INTENTS[intent]));
    const form = document.getElementById("site-footer-form");
    document.getElementById("site-footer-email").value = "buyer@example.com";
    form.querySelector('button[type="submit"]').click();
    await waitFor(() => form.hidden, "follow-up confirmation");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].email, "buyer@example.com");
    assert.equal(requests[0].purpose, "follow_up_homepage");
    assert.equal(requests[0].intent, undefined, "Home preserves intent locally; its existing endpoint accepts only email");
    link.click();
    assert.equal(form.hidden, false);
    assert.equal(document.getElementById("buyer-intent-topic").value, intent);
  });
}

test("evidence actions use wrapping, mobile stacking, touch targets and visible focus", async () => {
  // The repository's DOM harness has no layout engine; verify the shipped CSS contract.
  const base = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const page = await readFile(new URL("../src/landing-decision.css", import.meta.url), "utf8");
  assert.match(base, /\.hero-actions\s*\{[^}]*flex-wrap:wrap/);
  assert.match(base, /\.hero-actions\{[^}]*flex-direction:column/);
  assert.match(base, /\.button-link\s*\{[^}]*min-height:48px/);
  assert.match(base, /a:focus-visible\s*\{\s*outline:3px solid/);
  assert.match(page, /#repository-evidence-actions \.button-link\s*\{[^}]*min-width:0; max-width:100%; white-space:normal; overflow-wrap:anywhere/);
});
