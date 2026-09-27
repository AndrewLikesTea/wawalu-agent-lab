// #2577: the state between pressing Publish post and learning what happened.
//
// The outcome halves of this path already ship and are covered elsewhere
// (tests/social-publish-confirmation.test.js for the receipt and the failure,
// tests/social-composer-publish-race.test.js for a publish that outlives the
// panel). What was missing is the middle: the request left, and the only thing
// that said so was the submit button relabelling itself under the reader's own
// focus. This file pins the in-progress state in the composer's status region —
// the same region both outcomes are written in, and the region the submit button
// names in its own aria-describedby — and pins that it is replaced by the
// outcome rather than sitting under it.
//
// It also covers the failure half through the REAL media wiring, which the
// stub-driven tests above cannot: those replace getMedia/clearMedia with values
// the test holds, so "the image survived a failed publish" is asserted about the
// test's own variable. Here the image goes in the way a visitor puts it there —
// through the file picker, and through a Paint handoff — and the evidence that it
// survived is the second request carrying the same bytes.
//
// Harness notes: assertions are on counts, attributes and text, never on element
// identity (a null-equality assertion on a harness element walks the whole parsed
// page). Disabling an element does not blur it here, so "a second press cannot
// leave" is asserted on the request count and on the disabled property, never on
// focus having moved. DomEvent drops init properties it does not know, so the
// Cmd+Enter route sets `metaKey` on the event after constructing it.

import test from "node:test";
import assert from "node:assert/strict";
import {
  PUBLISH_FAILED_NOTE,
  PUBLISH_IN_PROGRESS_NOTE,
  PUBLISH_RETRY_LABEL,
  PUBLISH_STATE_WORDS,
  mountSocialFeed,
} from "../src/social.js";
import { PAINT_HANDOFF_KEY } from "../src/publishing-media.js";
import { DomEvent, loadPage, pressEnter, tabSequence, textOf, typeText } from "./support/browser.js";
import { waitFor } from "./support/page-module.js";
import { bootSocial, handoffRecord } from "./support/social-paint-arrival.js";

const SAVED_ID = "6b1d9e77-4c0a-4f8e-9a31-2d5e8c7b4a10";
const PNG_BYTES = Buffer.from("iVBORw0KGgo=", "base64");
const settle = () => new Promise((resolve) => setImmediate(resolve));

const notice = (document) => document.querySelector("#social-notice");
const chips = (document) => notice(document).querySelectorAll(".detail-state-chip");

// ---------------------------------------------------------------------------
// Part one: the in-flight state, on a transport the test opens and closes by
// hand, so every assertion below is read while the request is genuinely out.
// ---------------------------------------------------------------------------
async function composer(t) {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const { document } = page;
  const id = (name) => document.querySelector(`#${name}`);
  const requests = [];
  let pending = null;
  const feed = mountSocialFeed(document, {
    posts: [],
    state: "ready",
    storage: page.storage,
    create: (post) => new Promise((resolve, reject) => {
      requests.push(post);
      pending = {
        resolve: () => resolve({ ...post, id: SAVED_ID, source: "shiplog-web" }),
        reject: (message) => reject(new Error(message)),
      };
    }),
  });
  feed.composer.open();
  const type = (name, value) => {
    id(name).focus();
    id(name).value = value;
    id(name).dispatchEvent(new DomEvent("input", { bubbles: true }));
  };
  return {
    document,
    id,
    requests,
    type,
    // Pressed the way a reader presses it: focus lands on the control first, so
    // "focus did not move" below is a claim about a place focus actually was.
    async publish() {
      id("post-submit").focus();
      id("post-submit").click();
      await settle();
    },
    async resolve() { pending.resolve(); await settle(); },
    async reject(message) { pending.reject(message); await settle(); },
  };
}

test("a publish in flight is stated in words, in the region the submit button names", async (t) => {
  const harness = await composer(t);
  const { document, id } = harness;
  harness.type("post-body", "On its way to Social.");
  harness.type("post-author", "Mina");

  await harness.publish();
  assert.equal(harness.requests.length, 1, "the request never left, so there is no in-flight state to read");

  const region = notice(document);
  assert.equal(region.hidden, false, "the composer said nothing while the publish was out");
  // The state is a word first. The wash only agrees with it.
  assert.equal(chips(document).length, 1, "the in-flight state is told by exactly one chip");
  assert.equal(textOf(chips(document)[0]), PUBLISH_STATE_WORDS.pending);
  assert.ok(chips(document)[0].getAttribute("class").includes("detail-state-chip-pending"));
  assert.ok(textOf(region).includes(PUBLISH_IN_PROGRESS_NOTE), "the region does not say what is happening");
  // Not the success surface: the publish has not landed.
  assert.equal(region.classList.contains("is-success"), false);

  // Adjacent to the publishing action in the accessibility tree, not only on
  // screen: the button that started this names this region as its description,
  // and the region announces politely and whole on its own account.
  assert.ok(id("post-submit").getAttribute("aria-describedby").split(/\s+/).includes("social-notice"));
  assert.equal(region.getAttribute("role"), "status");
  assert.equal(region.getAttribute("aria-live"), "polite");
  assert.equal(region.getAttribute("aria-atomic"), "true");
  assert.equal(document.querySelectorAll("#social-notice").length, 1, "the state is said in two places");

  // The button carries the same one state, in its own label.
  assert.match(textOf(id("post-submit")), /Publishing…/);
  assert.equal(id("post-submit").getAttribute("aria-busy"), "true");

  // And the reader is left standing where they pressed. A live region speaks
  // without being visited, so nothing here steals focus mid-request — and the
  // region does not become a tab stop on the way past.
  assert.equal(document.activeElement?.id, "post-submit", "the in-flight state pulled focus off the button");
  assert.equal(region.getAttribute("tabindex"), "-1", "programmatic only — not a new tab stop");
  assert.equal(tabSequence(document).filter((node) => node.id === "social-notice").length, 0);

  // The outcome replaces the state; it never lands underneath it.
  await harness.resolve();
  assert.equal(notice(document).classList.contains("is-success"), true);
  assert.doesNotMatch(textOf(notice(document)), new RegExp(PUBLISH_STATE_WORDS.pending));
  assert.equal(textOf(notice(document)).includes(PUBLISH_IN_PROGRESS_NOTE), false,
    "the confirmation still says a publish is on its way");
  assert.match(textOf(id("post-submit")), /Publish post/);
  assert.equal(id("post-submit").getAttribute("aria-busy"), "false");
});

test("a failure replaces the in-flight state rather than joining it", async (t) => {
  const harness = await composer(t);
  const { document } = harness;
  harness.type("post-body", "This one does not land.");

  await harness.publish();
  assert.match(textOf(notice(document)), new RegExp(PUBLISH_STATE_WORDS.pending));

  await harness.reject("Posts API returned 503");

  // One state, and it is the current one: the chip is the failure's, and the
  // sentence that said the post was on its way is gone.
  assert.equal(chips(document).length, 1);
  assert.equal(textOf(chips(document)[0]), PUBLISH_STATE_WORDS.failed);
  assert.ok(chips(document)[0].getAttribute("class").includes("detail-state-chip-error"));
  assert.equal(textOf(notice(document)).includes(PUBLISH_IN_PROGRESS_NOTE), false,
    "the failure sits under a sentence still claiming the post is on its way");
  assert.ok(textOf(notice(document)).includes(PUBLISH_FAILED_NOTE));
});

test("every route into Publish post is dropped while one publish is out, without disabling the control", async (t) => {
  const harness = await composer(t);
  const { document, id } = harness;
  harness.type("post-body", "Only once.");
  harness.type("post-author", "Mina");

  await harness.publish();
  assert.equal(harness.requests.length, 1);

  // (a) The button again.
  id("post-submit").click();
  await settle();
  // (b) Implicit submission from the single-line display-name field, which never
  // touches the button at all.
  id("post-author").focus();
  pressEnter(document);
  await settle();
  // (c) The post field's own Cmd/Ctrl+Enter shortcut. Two things this harness
  // does not do, stood up so the route is exercised rather than skipped: DomEvent
  // drops init properties it does not know, so `metaKey` is set on the event, and
  // the form has no requestSubmit, so it stands in for the browser's — which
  // fires a submit event at the form. The count below proves the shortcut reached
  // it, and the request count proves what it reached was the guard.
  let requested = 0;
  id("post-form").requestSubmit = () => {
    requested += 1;
    id("post-form").dispatchEvent(new DomEvent("submit", { bubbles: true }));
  };
  id("post-body").focus();
  const shortcut = new DomEvent("keydown", { bubbles: true, key: "Enter" });
  shortcut.metaKey = true;
  id("post-body").dispatchEvent(shortcut);
  await settle();
  assert.equal(requested, 1, "Cmd+Enter in the post field never asked the form to submit");
  // (d) And a submit dispatched at the form directly.
  id("post-form").dispatchEvent(new DomEvent("submit", { bubbles: true }));
  await settle();

  assert.equal(harness.requests.length, 1, "a pending publish sent a second request");
  // The guard is the handler, not the attribute (#2370): a disabled button would
  // drop the focus it was pressed with and skip itself in the tab order, and it
  // would still not be what stops the three routes above. Asserted on the
  // request count and the property, because disabling does not blur in this
  // harness — a "focus left the button" assertion would pass for free.
  assert.equal(id("post-submit").disabled, false);
  assert.equal(id("post-compose-cancel").disabled, false, "Close stopped working during a publish");
  // Still one state, said once, for the whole time the request was out.
  assert.equal(chips(document).length, 1);
  assert.equal(textOf(chips(document)[0]), PUBLISH_STATE_WORDS.pending);

  await harness.resolve();
  const cards = document.querySelectorAll(".post-card")
    .filter((card) => !card.getAttribute("class").includes("-skeleton"));
  assert.equal(cards.length, 1, "four presses, and not one post");
});

// ---------------------------------------------------------------------------
// Part two: the failure half through the wiring as it is served — the real media
// composer, the real transport, and an image that got there the way a visitor
// puts one there. The stub-driven failure tests assert the draft survived by
// reading a variable the test owns; these read the request the retry actually
// sent.
// ---------------------------------------------------------------------------
const SAVED_ROW = {
  post: {
    id: SAVED_ID,
    author: "Mina",
    content: "The image that survived a failed publish.",
    timestamp: "2026-09-27T09:00:00.000Z",
    source: "human",
  },
};

// The POST is intercepted in front of the routed fetch the page was booted with,
// so a publish can be refused and then allowed without reloading the page.
// `page.restore()` puts the original fetch back when the test ends.
function refusePublishing(session) {
  const posted = [];
  const served = globalThis.fetch;
  let refusing = true;
  globalThis.fetch = (url, init = {}) => {
    if (url === "/api/social-posts" && (init.method ?? "GET") === "POST") {
      posted.push(JSON.parse(init.body));
      if (refusing) return Promise.resolve({ ok: false, status: 503, json: async () => null });
    }
    return served(url, init);
  };
  return { posted, allow() { refusing = false; } };
}

async function typeDraft(session, { body, alt }) {
  session.id("post-body").focus();
  typeText(session.document, body);
  session.id("post-image-alt").focus();
  typeText(session.document, alt);
  session.id("post-author").focus();
  typeText(session.document, "Mina");
}

// The two ways an image reaches the composer, each opened the way a visitor
// opens it: the file picker on this page, and a drawing handed over by Paint.
const IMAGE_PATHS = {
  "the file picker": async (t) => {
    const session = await bootSocial(t, { routes: { "/api/social-posts": SAVED_ROW } });
    session.id("post-compose-open").click();
    const input = session.id("post-image");
    input.files = [{
      name: "card.png",
      type: "image/png",
      size: PNG_BYTES.length,
      arrayBuffer: async () => PNG_BYTES,
    }];
    input.dispatchEvent(new DomEvent("change", { bubbles: true }));
    await waitFor(() => !session.id("compose-media").hidden, "the chosen file reached the composer");
    return session;
  },
  "a Paint handoff": async (t) => {
    const session = await bootSocial(t, {
      search: "?from=paint&image=prepared",
      hash: "#post-form",
      storage: { [PAINT_HANDOFF_KEY]: handoffRecord(PNG_BYTES) },
      routes: { "/api/social-posts": SAVED_ROW },
    });
    await waitFor(() => !session.id("compose-media").hidden, "the drawing from Paint reached the composer");
    return session;
  },
};

for (const [path, open] of Object.entries(IMAGE_PATHS)) {
  test(`a refused publish of an image from ${path} keeps the whole draft, and the retry sends the same bytes`, async (t) => {
    const session = await open(t);
    const { document, id } = session;
    const transport = refusePublishing(session);
    const body = "The image that survived a failed publish.";
    const alt = "A card wrapped in a blue focus ring.";
    await typeDraft(session, { body, alt });
    const preview = id("compose-preview-image").src;

    id("post-submit").focus();
    id("post-submit").click();
    await waitFor(() => textOf(notice(document)).includes(PUBLISH_FAILED_NOTE), "the composer reported the failure");

    // The failure is the composer's own, beside the publishing action — not a
    // page-level banner — and it says so in a word, not in a colour.
    assert.equal(chips(document).length, 1);
    assert.equal(textOf(chips(document)[0]), PUBLISH_STATE_WORDS.failed);
    assert.equal(notice(document).classList.contains("is-success"), false);

    // Every part of the draft is where the reader left it: the caption, the
    // display name, the description, and the image itself — still previewed, on
    // a panel that is actually on screen.
    assert.equal(id("post-body").value, body);
    assert.equal(id("post-author").value, "Mina");
    assert.equal(id("post-image-alt").value, alt);
    assert.equal(id("compose-media").hidden, false, "the preview left with the failed publish");
    assert.equal(id("compose-preview-image").src, preview);
    assert.equal(id("post-compose-panel").hidden, false, "the composer closed itself on a failure");

    // Retry is a real button, reachable by Tab, with nothing to retype first.
    const retry = notice(document).querySelector(".feed-status-action");
    assert.equal(retry.tagName, "BUTTON");
    assert.equal(retry.type, "button");
    assert.equal(textOf(retry), PUBLISH_RETRY_LABEL);
    assert.ok(tabSequence(document).includes(retry), "the retry is not keyboard reachable");
    assert.equal(id("post-submit").disabled, false, "the original control is usable too");

    transport.allow();
    retry.click();
    await waitFor(() => notice(document).classList.contains("is-success"), "the retry landed");

    // The evidence the image survived: the second request carried it, byte for
    // byte, and the description with it. Nothing was reselected or retyped.
    assert.equal(transport.posted.length, 2, "the retry was not a second request");
    const [first, second] = transport.posted;
    assert.equal(second.content, body);
    assert.equal(second.author, "Mina");
    assert.equal(second.image?.data, first.image?.data, "the retry sent a different image");
    assert.ok(second.image?.data, "the retry sent no image at all");
    assert.equal(second.image?.alt, alt);

    // And only now is the draft spent.
    assert.equal(id("post-body").value, "");
    assert.equal(id("compose-media").hidden, true);
  });
}
