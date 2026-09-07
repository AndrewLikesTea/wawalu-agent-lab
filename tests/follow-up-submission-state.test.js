import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initSiteFooter, PENDING_ACTION_LABEL, siteFooterMarkup } from "../src/site-footer.js";
import { DomEvent, parseHtml, pressEnter, pressSpace, tabSequence, textOf } from "./support/browser.js";
import { waitFor } from "./support/page-module.js";

function setup() {
  const document = parseHtml(siteFooterMarkup());
  const requests = [];
  const form = initSiteFooter(document, (url, options) => new Promise((resolve, reject) => {
    requests.push({ url, options, resolve, reject });
  }));
  const get = (suffix) => document.getElementById(`site-footer-${suffix}`);
  const submit = form.querySelector('button[type="submit"]');
  const send = () => form.dispatchEvent(new DomEvent("submit", { bubbles: true }));
  const finish = async (state, code) => {
    requests.at(-1).resolve(new Response(JSON.stringify(code
      ? { error: { code } } : { captured: true, created: true }), { status: code ? 503 : 201 }));
    await waitFor(() => form.dataset.submissionState === state, state);
  };
  return { document, requests, form, get, submit, send, finish };
}

function assertPending(ui, focused) {
  const { document, form, get, submit } = ui;
  assert.equal(form.dataset.submissionState, "submitting");
  assert.equal(form.getAttribute("aria-busy"), "true");
  assert.equal(document.activeElement, focused);
  assert.ok(tabSequence(document).includes(focused));
  for (const button of [submit, get("retry")]) {
    assert.equal(button.disabled, false);
    assert.equal(button.getAttribute("aria-disabled"), "true");
    assert.equal(textOf(button), PENDING_ACTION_LABEL);
  }
  assert.equal(get("status").getAttribute("role"), "status");
  assert.equal(get("status").getAttribute("aria-live"), "polite");
  assert.equal(get("status").getAttribute("aria-atomic"), "true");
  assert.equal(get("status").closest("form"), null, "busy form must not suppress its sibling announcement");
  assert.match(textOf(get("status")), /sending your email address/);
  assert.equal(get("recovery").hidden, true);
  assert.equal(get("repository"), null);
  assert.equal(get("confirmation"), null);
  assert.doesNotMatch(get("email").getAttribute("aria-describedby"), /recovery|status|error/);
}

test("shared form starts idle and blocks all repeat activation while preserving button focus", async () => {
  const ui = setup();
  const { form, get, submit, document, requests, send, finish } = ui;
  assert.equal(form.dataset.submissionState, "idle");
  assert.equal(form.getAttribute("aria-busy"), "false");
  assert.equal(get("retry").hidden, true);
  assert.equal(get("recovery").hidden, true);
  assert.equal(textOf(get("status")), "");
  assert.equal(textOf(submit), "Request a follow-up");
  get("email").value = "mina@example.com";
  submit.focus();
  pressEnter(document);
  assertPending(ui, submit);
  pressEnter(document);
  pressSpace(document);
  submit.click();
  get("retry").click();
  send();
  assert.equal(requests.length, 1);
  await finish("success");
  assert.equal(form.getAttribute("aria-busy"), "false");
  assert.equal(form.hidden, true);
  assert.equal(document.activeElement, get("confirmation"));
  assert.match(textOf(get("status")), /Request sent/);
  assert.equal(get("confirmation").getAttribute("role"), "group");
  assert.equal(get("confirmation").getAttribute("aria-label"), "Follow-up request details");
  assert.equal(get("confirmation").getAttribute("aria-live"), null, "receipt is not a second live announcement");
  assert.equal(get("retry").hidden, true);
  assert.equal(get("recovery").hidden, true);
  send();
  assert.equal(requests.length, 1, "success is terminal until deliberately reopened");
});

test("failure → retry → failure → retry → success → idle leaves no stale outcome", async () => {
  const ui = setup();
  const { form, get, submit, document, requests, send, finish } = ui;
  get("email").value = "mina@example.com";
  submit.focus();
  send();
  await finish("failure", "storage_error");
  assert.equal(form.getAttribute("aria-busy"), "false");
  assert.match(textOf(get("status")), /No request was sent/);
  assert.equal(get("recovery").hidden, false);
  assert.equal(get("confirmation"), null);
  assert.equal(submit.hidden, true);
  const retry = get("retry");
  assert.equal(retry.hidden, false);
  assert.equal(textOf(retry), "Retry your follow-up request");
  assert.equal(retry.getAttribute("aria-disabled"), null);
  retry.focus();
  pressEnter(document);
  assertPending(ui, retry);
  send();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].options.body, requests[0].options.body);
  await finish("failure", "storage_unavailable");
  assert.equal(document.activeElement, retry);
  pressSpace(document);
  assertPending(ui, retry);
  await finish("success");
  assert.equal(get("repository"), null);
  assert.equal(retry.hidden, true);
  get("again").click();
  assert.equal(form.dataset.submissionState, "idle");
  assert.equal(form.hidden, false);
  assert.equal(document.activeElement, get("email"));
  assert.equal(get("confirmation"), null);
  assert.equal(textOf(get("status")), "");
  assert.equal(textOf(submit), "Request a follow-up");
  assert.equal(submit.getAttribute("aria-disabled"), null);
  send();
  await finish("success");
  assert.equal(textOf(get("confirmation")).match(/reply is not guaranteed/g).length, 1,
    "repeated receipts must not accumulate detail text");
});

test("failed request followed by invalid retry returns to idle validation without failure UI", async () => {
  const { form, get, send, finish } = setup();
  get("email").value = "mina@example.com";
  send();
  await finish("failure", "storage_error");
  get("email").value = "";
  send();
  assert.equal(form.dataset.submissionState, "idle");
  assert.equal(get("error").hidden, false);
  assert.equal(get("retry").hidden, true);
  assert.equal(get("recovery").hidden, true);
  assert.equal(textOf(get("status")), "");
  assert.equal(get("repository"), null);
  assert.doesNotMatch(get("email").getAttribute("aria-describedby"), /status|recovery/);
});

test("a network rejection clears busy semantics without inventing a confirmed outcome", async () => {
  const ui = setup();
  const { document, form, get, requests, send } = ui;
  get("email").value = "mina@example.com";
  get("email").focus();
  send();
  assertPending(ui, get("email"));
  requests[0].reject(new TypeError("offline"));
  await waitFor(() => form.dataset.submissionState === "failure", "network failure");
  assert.equal(form.getAttribute("aria-busy"), "false");
  assert.equal(document.activeElement, get("email"));
  assert.match(textOf(get("status")), /can’t confirm/);
  assert.equal(get("retry").hidden, false);
  assert.equal(get("retry").getAttribute("aria-disabled"), null);
  assert.equal(get("confirmation"), null);
});

test("both footer stylesheets preserve hidden states, receipt wrapping, and mobile action size", async () => {
  // The DOM harness does not run the CSS cascade: explicitly protect the rules
  // that stop display:grid from overriding hidden and long addresses overflowing.
  for (const file of ["styles.css", "agents.css"]) {
    const css = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.match(css, /\.site-footer-actions button\[hidden\]\s*\{\s*display:none/);
    assert.match(css, /\.site-footer-confirmation-address\s*\{\s*overflow-wrap:anywhere/);
    assert.match(css, /\.site-footer-confirmation-again\{width:100%/);
    assert.match(css, /\.site-footer-confirmation:focus-visible\s*\{\s*outline:3px solid/);
  }
});

// Every surface that shares createFollowUpConfirmation hides its form the moment
// a request lands — that is what stops a send or a retry standing beside a
// receipt, which is the state confusion this work exists to remove. A form laid
// out on a grid outranks the browser's own [hidden] rule, so each stylesheet has
// to hide it itself; the footer's two sheets are not a special case here, they
// are two of four. Asserted as an implication rather than four literal rules, so
// a fifth surface, or a family that stops using a grid, is covered by the same
// sentence.
test("every stylesheet that lays a follow-up form out on a grid also hides it", async () => {
  const families = [
    ["styles.css", "site-footer"], ["agents.css", "site-footer"],
    ["evolution.css", "finops-contact"], ["executive-briefing.css", "brief-contact"],
  ];
  for (const [file, prefix] of families) {
    const css = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.match(css, new RegExp(`\\.${prefix}-form\\s*\\{[^}]*display:grid`),
      `${file} is expected to lay .${prefix}-form out on a grid`);
    assert.match(css, new RegExp(`\\.${prefix}-form\\[hidden\\][^{]*\\{\\s*display:none`),
      `${file} lays .${prefix}-form out on a grid, so it must also hide it on success`);
  }
});
