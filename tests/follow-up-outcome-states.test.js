// Three states a visitor must be able to tell apart on the shared follow-up
// form: nothing attempted, request received, request not sent.
//
// tests/follow-up-request-path.test.js already drives the state machine that
// produces them and tests/follow-up-lifecycle.test.js already drives a failure
// and a keyboard retry through a page's own entry module. What neither of them
// held was the *first* state's shape. Every page shipped the third state's
// control in its source — a `hidden` "Retry your follow-up request" button in
// the actions row — so a page read as a document rather than rendered as one
// offered a retry for a request nobody had made. `hidden` removes a control
// from the screen and from the accessibility tree; it does not remove it from
// the page. A text extraction, a saved copy, a print, a reader-mode view, or
// any snapshot taken of the markup found it and had no way to know it was not
// on offer.
//
// So this file asserts each state by what is *present*, not by what is styled:
//
//   1. Not attempted — one primary action in the form, no retry anywhere in it,
//      and the two outcome regions empty. Asserted against the shipped markup of
//      every page that carries the shared form, discovered rather than listed.
//   2. Not sent — a retry exists, exactly one, and everything the visitor chose
//      or typed is still where they left it, so pressing it sends the request
//      they meant. This is the criterion the submit handler owns: no path out of
//      a failure may clear the form.
//   3. Received — a receipt naming the topic the request carried, sourced from
//      the same tables the wire is built from, and the retry gone from the page
//      rather than hidden on it.
//
// Assertions are on counts and attributes throughout. `assert.equal(node, null)`
// renders a whole parsed page into a failure message in this harness and takes
// minutes to do it, so absence is `assert.ok(!node)` or a count of zero.

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { loadPage, pressEnter, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { initSiteFooter, RETRY_LABEL } from "../src/site-footer.js";
import { FOLLOW_UP_INTENTS } from "../src/lead-capture.js";
import { FOLLOW_UP_TOPICS } from "../src/leads.js";

const SRC = new URL("../src/", import.meta.url);
const TYPED_EMAIL = "director@example.com";
const TYPED_MESSAGE = "Which of these numbers is a measurement?";

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));

const jsonReply = (body, status = 201) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

/**
 * Every retry control anywhere under a node, counted by id rather than by tag.
 *
 * `querySelectorAll` rejects `*` in this harness and text nodes sit in
 * `children` carrying a truthy `tagName`, so the walk filters on `getAttribute`
 * — the one accessor a text node does not have.
 */
function countRetries(node, found = 0) {
  for (const child of node.children ?? []) {
    if (child.getAttribute?.("id") === "site-footer-retry") found += 1;
    found = countRetries(child, found);
  }
  return found;
}

/** A footer wired to a caller-supplied transport: the injectable production path. */
async function mountFooter(file, request) {
  const page = await loadPage(new URL(file, SRC));
  const calls = [];
  initSiteFooter(page.document, (url, options) => {
    calls.push({ url, options });
    return request(calls.length);
  });
  return { page, document: page.document, calls };
}

const settled = (document, state) => waitFor(
  () => byId(document, "site-footer-form").dataset.requestState === state,
  `the follow-up request to reach ${state}`);

/* ------------------------- 1. nothing attempted yet ------------------------ */

test("every page that ships the shared follow-up form offers one action and no retry", async () => {
  const files = (await readdir(SRC)).filter((name) => name.endsWith(".html")).sort();
  const carrying = [];

  for (const file of files) {
    const html = await readFile(new URL(file, SRC), "utf8");
    // Cheap enough to check before paying for a parse, and it is the assertion
    // that matters most: the label may not be readable in a page's source.
    if (!html.includes('id="site-footer-form"')) continue;
    carrying.push(file);
    // Scoped to this form's own id. Two of these pages also carry a follow-up
    // panel of their own — the AI FinOps contact form on evolution.html and the
    // bundled-example form on index.html, both wired by other modules — and
    // those still ship their retry hidden in the markup. They are not the shared
    // form experience and are not what this file holds.
    assert.ok(!html.includes(`<button id="site-footer-retry"`),
      `${file}: ships a retry a reader can find before any request was made`);

    const page = await loadPage(new URL(file, SRC));
    try {
      const { document } = page;
      const form = byId(document, "site-footer-form");
      assert.ok(!textOf(form).includes(RETRY_LABEL),
        `${file}: the unattempted form reads as offering a retry`);
      assert.equal(form.querySelectorAll('button[type="submit"]').length, 1,
        `${file}: an unattempted follow-up form has exactly one primary action`);
      assert.equal(countRetries(form), 0, `${file}: and no retry control at all`);
      assert.ok(!byId(document, "site-footer-retry"), `${file}: nor one anywhere else on the page`);

      // The two regions that speak for an outcome say nothing, because there
      // has been none — neither a receipt nor a failure is on this page.
      assert.equal(shownText(document, "site-footer-status"), "",
        `${file}: the live region claims an outcome before there is one`);
      assert.equal(shownText(document, "site-footer-recovery"), "",
        `${file}: the recovery paragraph describes a failure that has not happened`);
    } finally {
      page.restore();
    }
  }

  // An empty discovery would make every assertion above vacuous.
  assert.ok(carrying.length >= 15,
    `the shared follow-up form was found on only ${carrying.length} pages`);
});

/* ---------------- 2 and 3. not sent, then received, in one run -------------- */

test("a failed follow-up keeps everything the visitor chose, and a landed one names the topic", async () => {
  // Coach is the fullest shape the shared form takes: a fixed page topic on the
  // form, a required "what do you want to discuss" choice, and the optional
  // message box. If a failure clears anything, it clears something here.
  const { page, document, calls } = await mountFooter("coach.html", (attempt) => (attempt <= 2
    ? Promise.resolve(jsonReply({ error: { code: "storage_error" } }, 500))
    : Promise.resolve(jsonReply({ captured: true, created: true, purpose: "follow_up_coach", intent: "pilot" }))));
  try {
    const form = byId(document, "site-footer-form");
    const email = byId(document, "site-footer-email");
    const message = byId(document, "site-footer-message");
    const intent = byId(document, "site-footer-intent-pilot");
    assert.equal(form.dataset.requestState, "idle");

    intent.click();
    message.focus();
    typeText(document, TYPED_MESSAGE);
    email.focus();
    typeText(document, TYPED_EMAIL);
    pressEnter(document);
    await settled(document, "failure");

    // --- not sent ---------------------------------------------------------
    // The outcome is stated in words, and the words are about the request,
    // not about the field: a failure may not read as a receipt.
    assert.match(shownText(document, "site-footer-status"), /^No request was sent\b/);
    assert.doesNotMatch(shownText(document, "site-footer-status"), /received|recorded/i);
    assert.match(shownText(document, "site-footer-recovery"), /^No request was sent\./);
    assert.ok(!byId(document, "site-footer-confirmation"), "a failure leaves no receipt behind");

    // The retry exists now, once, and it says what it does.
    const retry = byId(document, "site-footer-retry");
    assert.ok(retry, "a failed request must offer a retry");
    assert.equal(countRetries(form), 1, "one failure, one retry");
    assert.equal(textOf(retry), RETRY_LABEL);
    assert.equal(retry.getAttribute("type"), "submit");
    assert.equal(retry.closest("form")?.getAttribute("id"), "site-footer-form",
      "the retry must resubmit this form rather than navigate");

    // Nothing the visitor chose or typed was cleared to "help" them. This is
    // the whole of the criterion: the retry beside these values sends them.
    assert.equal(email.value, TYPED_EMAIL, "a failure must not clear the address");
    assert.equal(message.value, TYPED_MESSAGE, "a failure must not clear the message");
    assert.ok(intent.checked, "a failure must not clear the discussion choice");

    // --- a second failure changes none of that ----------------------------
    retry.click();
    await waitFor(() => calls.length === 2, "the retry to make its own request");
    await settled(document, "failure");
    assert.deepEqual(JSON.parse(calls[1].options.body), JSON.parse(calls[0].options.body),
      "the retry must resend the request the visitor already described");
    assert.equal(countRetries(form), 1, "a second failure must not stack a second retry");
    assert.equal(email.value, TYPED_EMAIL);
    assert.equal(message.value, TYPED_MESSAGE);
    assert.ok(intent.checked);

    // --- received ----------------------------------------------------------
    byId(document, "site-footer-retry").click();
    await settled(document, "success");

    const receipt = byId(document, "site-footer-confirmation");
    assert.ok(receipt, "a landed request must leave a receipt");
    const read = textOf(receipt);
    assert.match(read, /^✓\s*Request received\./, "the receipt must say the request arrived");
    // Named from the same tables the request body was built from, so the
    // sentence a visitor reads back cannot drift from what went on the wire.
    const sent = JSON.parse(calls[2].options.body);
    assert.equal(sent.topic, FOLLOW_UP_TOPICS.follow_up_coach);
    assert.ok(read.includes(`Fixed page topic: ${FOLLOW_UP_TOPICS.follow_up_coach}.`),
      `the receipt must name the topic the request carried: ${read}`);
    assert.ok(read.includes(`What you want to discuss: ${FOLLOW_UP_INTENTS[sent.intent]}.`),
      `the receipt must name the choice the endpoint stored: ${read}`);

    // And the failure state is off the page rather than behind a style: a
    // reader must not meet a retry beside a receipt.
    assert.equal(countRetries(byId(document, "site-footer-panel")), 0,
      "a landed request takes the retry back off the page");
    assert.ok(!byId(document, "site-footer-retry"));
    assert.equal(byId(document, "site-footer-recovery").hidden, true);
    assert.equal(form.hidden, true, "the form a landed request replaced is not still standing");
  } finally {
    page.restore();
  }
});

/* ------------------- the same three states on a real page ------------------ */

test("social.html reaches all three states through its own entry module", async () => {
  const page = await loadPage(new URL("social.html", SRC));
  const originalFetch = globalThis.fetch;
  let failNext = true;
  globalThis.fetch = async (url, options) => {
    if (String(url) !== "/api/leads") return originalFetch(url, options);
    return failNext
      ? jsonReply({ error: { code: "storage_unavailable" } }, 503)
      : jsonReply({ captured: true, created: true, purpose: "follow_up_social", intent: "demo" });
  };
  try {
    // Nothing has run yet, and the page still offers exactly one action.
    const { document } = page;
    assert.equal(countRetries(byId(document, "site-footer-form")), 0);

    await importPageModule("/site-footer-page.js");
    const form = byId(document, "site-footer-form");
    const message = byId(document, "site-footer-message");
    assert.equal(form.dataset.requestState, "idle");
    assert.equal(countRetries(form), 0, "mounting the module may not add a retry either");

    byId(document, "site-footer-intent-demo").click();
    message.focus();
    typeText(document, TYPED_MESSAGE);
    byId(document, "site-footer-email").focus();
    typeText(document, TYPED_EMAIL);
    pressEnter(document);
    await settled(document, "failure");

    assert.equal(countRetries(form), 1);
    assert.match(shownText(document, "site-footer-status"), /^No request was sent\b/);
    assert.equal(message.value, TYPED_MESSAGE, "the shipped page must keep the message too");
    assert.ok(byId(document, "site-footer-intent-demo").checked);

    failNext = false;
    byId(document, "site-footer-retry").click();
    await settled(document, "success");

    assert.ok(textOf(byId(document, "site-footer-confirmation"))
      .includes(`What you want to discuss: ${FOLLOW_UP_INTENTS.demo}.`));
    assert.equal(countRetries(byId(document, "site-footer-panel")), 0);
  } finally {
    globalThis.fetch = originalFetch;
    page.restore();
  }
});
