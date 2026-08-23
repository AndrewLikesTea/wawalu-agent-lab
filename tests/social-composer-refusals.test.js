// The Social composer's drawn refusals, as a reader meets them.
//
// Three fields can stop a publish, and this file is about how each one says so:
//   1. a post over the 280-character budget;
//   2. an image with no description (that refusal already shipped — what is
//      checked here is where it stands and how it is announced);
//   3. a file the picker will not take, which lives in
//      tests/social-image-upload-limits.test.js because it needs the page's own
//      file wiring.
//
// One contract across all three: the sentence is the next thing after the field
// it is about, it is announced where it appears, it marks the control it blocks,
// and it leaves when the field satisfies the rule again. No refusal is carried
// by a red counter, a spent-looking button, or a banner at the foot of the form
// — every message names its own field and reads as a whole sentence with the
// colour taken out.
//
// Harness notes: assertions are on counts, text, and attribute values, never on
// element identity, and DOM order is read off `childElements` rather than a
// descendant selector, which this harness refuses.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_POST_LENGTH,
  POST_BODY_ERROR_ID,
  IMAGE_DESCRIPTION_ERROR_ID,
  mountSocialFeed,
  overLengthPostMessage,
} from "../src/social.js";
import { DomEvent, loadPage, textOf } from "./support/browser.js";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// A composer standing on the shipped markup, with the media half replaced by a
// value the test controls. `create` counts publications, which is how "no post
// was created" is asserted without reaching into storage.
async function composer(t, { attached = false } = {}) {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const document = page.document;
  const published = [];
  let media = attached
    ? { content_type: "image/png", data: PNG_BASE64, width: 1200, height: 900, preview: "data:image/png;base64,carried" }
    : null;

  const feed = mountSocialFeed(document, {
    posts: [],
    state: "ready",
    storage: page.storage,
    getMedia: () => (media ? { ...media, alt: document.querySelector("#post-image-alt").value.trim() } : null),
    clearMedia: () => { media = null; },
    create: async (post) => {
      published.push(post);
      return { ...post, id: post.id ?? "published" };
    },
  });
  feed.description.setAttached(Boolean(media));
  feed.composer.open();
  if (media) document.querySelector("#compose-media").hidden = false;
  return { page, document, feed, published };
}

// One keystroke's worth of the event the field listens for.
const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new DomEvent("input", { bubbles: true }));
};

// Publish post, activated the way a reader activates it.
const publish = (document) => document.querySelector("#post-submit").click();

// DOM order without a descendant selector: what stands immediately before the
// message, named by its id or its tag.
const precedes = (document, id) => {
  const node = document.querySelector(`#${id}`);
  const siblings = node.parentNode.childElements;
  const before = siblings[siblings.indexOf(node) - 1];
  return before?.id || before?.className || before?.tagName;
};

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("the over-length sentence states the typed length, the overshoot, and the limit", () => {
  assert.equal(overLengthPostMessage(312), "Your post is 312 characters — 32 over the 280 limit.");
  assert.equal(overLengthPostMessage(281), "Your post is 281 characters — 1 over the 280 limit.");
  // Self-describing with the field label taken away: it opens with the field's
  // own words, so it is a whole sentence wherever it is read.
  assert.match(overLengthPostMessage(312), /^Your post is /);
  assert.match(overLengthPostMessage(312), /\.$/);
  assert.equal(MAX_POST_LENGTH, 280);
});

test("an over-length post is named beside the field, and publishes nothing", async (t) => {
  const harness = await composer(t);
  const input = harness.document.querySelector("#post-body");

  type(input, "o".repeat(312));

  const error = harness.document.querySelector(`#${POST_BODY_ERROR_ID}`);
  assert.equal(error.hidden, false);
  assert.equal(textOf(error), "⚠Your post is 312 characters — 32 over the 280 limit.");
  // Announced where it appears, not left for a reader to notice.
  assert.equal(error.getAttribute("role"), "alert");
  // Marked on the control it blocks, and bound to it — with the field's own
  // hint and counter still described.
  assert.equal(input.getAttribute("aria-invalid"), "true");
  const described = (input.getAttribute("aria-describedby") ?? "").split(/\s+/);
  assert.ok(described.includes(POST_BODY_ERROR_ID), "the error id is not in aria-describedby");
  assert.ok(described.includes("post-body-hint"));
  assert.ok(described.includes("post-counter"));
  // Not colour alone: the mark leads the message and is hidden from assistive
  // tech, because the sentence beside it already says what is wrong.
  assert.equal(harness.document.querySelectorAll(".field-error-mark").length, 1);
  assert.equal(harness.document.querySelector(".field-error-mark").getAttribute("aria-hidden"), "true");

  publish(harness.document);
  await settle();

  assert.equal(harness.published.length, 0, "an over-length post was published anyway");
  // And the reader is put on the field to cut down.
  assert.equal(harness.document.activeElement?.id, "post-body");
  assert.equal(input.value.length, 312, "the over-length text is left there to be cut down");
  // The refusal is said once, at the field. The notice at the foot of the form
  // is where an outcome is announced, and no post was attempted.
  assert.equal(harness.document.querySelector("#social-notice").hidden, true);
});

test("the over-length message clears when the post comes back under the limit", async (t) => {
  const harness = await composer(t, { attached: true });
  const input = harness.document.querySelector("#post-body");
  const error = harness.document.querySelector(`#${POST_BODY_ERROR_ID}`);

  type(input, "o".repeat(MAX_POST_LENGTH + 4));
  assert.equal(error.hidden, false);

  type(input, "Ring landed on every control.");

  assert.equal(error.hidden, true);
  assert.equal(textOf(error), "");
  assert.equal(input.getAttribute("aria-invalid"), null, "a valid field is left marked invalid");
  assert.equal(input.getAttribute("aria-describedby"), "post-body-hint post-counter-label post-counter");

  // The successful path is untouched: a post with an image still publishes and
  // still reaches the feed.
  type(harness.document.querySelector("#post-image-alt"), "A card wrapped in a blue focus ring.");
  publish(harness.document);
  await settle();

  assert.equal(harness.published.length, 1, "a post back under the limit did not publish");
  assert.equal(harness.published[0].body, "Ring landed on every control.");
  const cards = harness.document.querySelectorAll(".post-card")
    .filter((card) => !card.className.includes("-skeleton"));
  assert.equal(cards.length, 1);
  assert.equal(harness.document.querySelector(`#${POST_BODY_ERROR_ID}`).hidden, true);
});

test("an empty image description is answered at its own field, and takes focus there", async (t) => {
  const harness = await composer(t, { attached: true });
  harness.document.querySelector("#post-body").value = "Ring landed on every control.";

  publish(harness.document);
  await settle();

  const error = harness.document.querySelector(`#${IMAGE_DESCRIPTION_ERROR_ID}`);
  assert.equal(harness.published.length, 0, "an undescribed image was published anyway");
  assert.equal(error.hidden, false);
  assert.equal(error.getAttribute("role"), "alert");
  assert.match(textOf(error), /Add a description of the image before posting/);
  assert.equal(harness.document.querySelector("#post-image-alt").getAttribute("aria-invalid"), "true");
  assert.equal(harness.document.activeElement?.id, "post-image-alt");

  // Typing one clears it, and nothing is left marked invalid.
  type(harness.document.querySelector("#post-image-alt"), "A card wrapped in a blue focus ring.");
  assert.equal(error.hidden, true);
  assert.equal(harness.document.querySelector("#post-image-alt").getAttribute("aria-invalid"), null);
});

test("every refusal slot follows its own field and ships empty", async (t) => {
  const harness = await composer(t);
  const document = harness.document;

  // Reading order, which is also tab order: the message is the next element
  // after the control it is about, not collected in a banner at either end of
  // the form.
  assert.equal(precedes(document, POST_BODY_ERROR_ID), "post-body");
  assert.equal(precedes(document, IMAGE_DESCRIPTION_ERROR_ID), "post-image-alt");
  assert.equal(precedes(document, "post-image-error"), "media-source-actions");

  for (const id of [POST_BODY_ERROR_ID, IMAGE_DESCRIPTION_ERROR_ID, "post-image-error"]) {
    const node = document.querySelector(`#${id}`);
    // Announced when it appears — the same assertive region for all three.
    assert.equal(node.getAttribute("role"), "alert", `#${id} is not announced`);
    // Present but empty and hidden in the page as served: no visible banner
    // standing over a form nobody has done anything wrong in yet.
    assert.equal(node.hidden, true, `#${id} ships visible`);
    assert.equal(textOf(node), "", `#${id} ships with words in it`);
    assert.equal(document.querySelectorAll(`#${id}`).length, 1);
    // The shipped field-error drawing, reused: no new class, and so no new
    // colour, type, or spacing value.
    assert.equal(node.getAttribute("class"), "field-error compose-error");
    // Nothing folds a refusal away — a live region behind a closed disclosure
    // is silent.
    for (let cursor = node; cursor; cursor = cursor.parentNode) {
      assert.notEqual(cursor.tagName, "DETAILS", `#${id} sits inside a disclosure`);
    }
  }
});
