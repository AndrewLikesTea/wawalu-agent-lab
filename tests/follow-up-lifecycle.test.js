import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, pressEnter, tabSequence, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const reply = (body, status = 201) => new Response(JSON.stringify(body), { status });
const success = () => reply({ captured: true, created: true, purpose: "follow_up" });

for (const [name, failure, diagnostic] of [
  ["refused", () => reply({ error: { code: "storage_error" } }, 500), /No request was sent/],
  ["offline", () => Promise.reject(new TypeError("offline")), /couldn’t send/],
  ["invalid JSON", () => new Response("<html>proxy</html>"), /couldn’t send/],
  ...[null, {}, [], { captured: false }, { captured: true, created: "yes", purpose: "follow_up" }]
    .map((body) => [JSON.stringify(body), () => reply(body), /couldn’t send/]),
]) {
  test(`shared footer lifecycle and keyboard retry after ${name}`, async () => {
    const page = await loadPage(new URL("../src/social.html", import.meta.url));
    const originalFetch = globalThis.fetch;
    const calls = [];
    let finish;
    globalThis.fetch = async (url, options) => {
      if (String(url) !== "/api/leads") return originalFetch(url, options);
      calls.push(JSON.parse(options.body));
      return new Promise((resolve, reject) => {
        finish = () => Promise.resolve().then(calls.length === 1 ? failure : success).then(resolve, reject);
      });
    };
    try {
      await importPageModule("/site-footer-page.js");
      const { document } = page;
      const get = (suffix) => document.getElementById(`site-footer-${suffix}`);
      const form = get("form"), email = get("email"), status = get("status"), retry = get("retry");
      const submit = form.querySelector('button[type="submit"]');
      assert.equal(form.dataset.requestState, "idle");
      assert.equal(textOf(status), "");
      assert.equal(retry.hidden, true);
      assert.equal(submit.hidden, false);
      assert.equal(submit.getAttribute("aria-disabled"), null);
      assert.equal(get("recovery").hidden, true);
      assert.equal(status.getAttribute("role"), "status");
      assert.equal(status.getAttribute("aria-live"), "polite");
      assert.equal(status.getAttribute("aria-atomic"), "true");
      email.focus();
      typeText(document, "person@example.com");
      submit.focus();
      pressEnter(document);
      const pending = (control) => {
        assert.equal(form.dataset.requestState, "submitting");
        assert.equal(document.activeElement, control);
        assert.equal(control.hidden, false);
        assert.equal(control.disabled, false);
        assert.equal(control.getAttribute("aria-disabled"), "true");
        assert.ok(tabSequence(document).includes(control));
        assert.match(textOf(control), /Sending follow-up request/);
        assert.match(textOf(status), /sending your email/);
        control.click();
        pressEnter(document);
      };
      pending(submit);
      assert.equal(calls.length, 1);
      finish();
      await waitFor(() => form.dataset.requestState === "failure", "failure");
      assert.match(textOf(status), diagnostic);
      assert.equal(get("confirmation"), null);
      assert.equal(retry.hidden, false);
      // Iris's defect: the retry may not stand beside the action it replaces.
      assert.equal(submit.hidden, true);
      assert.equal(retry.getAttribute("aria-disabled"), null);
      assert.match(textOf(retry), /Retry your follow-up request/);
      assert.equal(email.value, "person@example.com");
      assert.equal(document.activeElement, email, "hidden request control hands focus to the retained field");
      assert.ok(tabSequence(document).indexOf(email) < tabSequence(document).indexOf(retry));
      retry.focus();
      pressEnter(document);
      pending(retry);
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[1], calls[0]);
      finish();
      await waitFor(() => form.dataset.requestState === "success", "success");
      assert.equal(retry.hidden, true);
      assert.equal(form.hidden, true);
      assert.match(textOf(get("confirmation")), /Request received/);
      assert.equal(document.activeElement, get("confirmation"));
      assert.ok(!tabSequence(document).includes(retry));
      // The receipt owns the send control; settling the retry may not free it.
      assert.equal(submit.disabled, true);
      assert.equal(submit.getAttribute("aria-disabled"), "true");
      get("again").click();
      assert.equal(form.dataset.requestState, "idle");
      assert.equal(document.activeElement, email);
      assert.equal(textOf(status), "");
      assert.equal(retry.hidden, true);
      // And no control carries the last attempt's pending state into the next.
      assert.equal(submit.getAttribute("aria-disabled"), null);
      assert.equal(retry.getAttribute("aria-disabled"), null);
    } finally {
      globalThis.fetch = originalFetch;
      page.restore();
    }
  });
}
