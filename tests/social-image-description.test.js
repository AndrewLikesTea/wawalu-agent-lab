// Every image posted to Social is described, and every image rendered from
// storage says something.
//
// Two halves of one guarantee, tested together because they only hold together:
//   1. the composer refuses to publish an image whose description is empty,
//      whitespace, or over budget — and refuses without costing the poster the
//      caption, the byline, or the encoded image;
//   2. the read path never renders a bare alt="", because rows written before
//      the requirement existed still have to be readable. Nothing is backfilled.
//
// Harness notes, because both are easy to get wrong here: assertions are on
// counts and attribute values, never on element identity, and the select double
// accepts values a real control would refuse — so nothing below leans on either.

import test from "node:test";
import assert from "node:assert/strict";
import {
  IMAGE_DESCRIPTION_ERROR_ID,
  IMAGE_DESCRIPTION_REFUSAL_NOTE,
  MAX_IMAGE_ALT_LENGTH,
  imageDescriptionProblem,
  mountImageDescription,
  mountSocialFeed,
  renderPosts,
} from "../src/social.js";
import { MISSING_DESCRIPTION_NOTE, imageDescription } from "../src/image-description.js";
import { renderProfileGrid } from "../src/profile.js";
import {
  createMemoryRateLimiter,
  createMemorySocialStores,
  handleSocialMediaRequest,
} from "../src/social-posts-api.js";
import { DomEvent, loadPage, tabSequence, textOf } from "./support/browser.js";
import { byClass, createElement, installDocument, tags } from "./support/dom.js";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const IMAGE = { src: "/media/focus-ring.svg", alt: "A card wrapped in a blue focus ring", width: 1200, height: 900 };

// A composer standing on the shipped markup, with the media half replaced by a
// value the test controls. `create` counts publications, which is how "no post
// was created" is asserted without reaching into storage.
async function composer(t, { attached = true } = {}) {
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
    // Exactly what the page's media composer hands over: the bytes it holds,
    // plus whatever is in the description field right now.
    getMedia: () => (media ? { ...media, alt: document.querySelector("#post-image-alt").value.trim() } : null),
    clearMedia: () => { media = null; },
    create: async (post) => {
      published.push(post);
      return { ...post, id: post.id ?? "published" };
    },
  });
  feed.description.setAttached(Boolean(media));

  // The preview the media half painted before the submit. Nothing in the
  // refusal path may touch it.
  const preview = document.querySelector("#compose-preview-image");
  if (media) {
    preview.src = media.preview;
    document.querySelector("#compose-media").hidden = false;
  }

  const fill = ({ body, author, description }) => {
    if (body !== undefined) document.querySelector("#post-body").value = body;
    if (author !== undefined) document.querySelector("#post-author").value = author;
    if (description !== undefined) document.querySelector("#post-image-alt").value = description;
  };
  return { page, document, feed, published, fill, preview, get media() { return media; } };
}

// Publish post, activated the way a reader activates it: the button submits its
// form, so the path under test is the shipped one.
const publish = (document) => document.querySelector("#post-submit").click();

// One keystroke's worth of the event the field listens for.
const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new DomEvent("input", { bubbles: true }));
};

// Ancestry by walk: the harness throws on a descendant selector, so "is this
// node inside the composer?" is answered by climbing to it.
const insideForm = (node) => {
  for (let cursor = node; cursor; cursor = cursor.parentNode) if (cursor.id === "post-form") return true;
  return false;
};

test("the caption is the composer's first field, in source order and in the tab sequence", async (t) => {
  const html = await import("node:fs/promises")
    .then(({ readFile }) => readFile(new URL("../src/social.html", import.meta.url), "utf8"));
  // The hint above the fields has always read "Write the caption. Add an image
  // if you want one." The fields now say it in the same order: the one a post
  // cannot exist without, then the optional one, then what the image needs.
  assert.ok(html.indexOf('id="post-body"') < html.indexOf('id="post-image"'),
    "the form authors the optional image field ahead of the caption it requires");
  assert.ok(html.indexOf('id="post-image"') < html.indexOf('id="remove-image"'));
  assert.ok(html.indexOf('id="remove-image"') < html.indexOf('id="post-image-alt"'));
  assert.ok(html.indexOf('id="post-image-alt"') < html.indexOf('id="post-author"'));

  const harness = await composer(t);
  // Source order, not a visual reordering: nothing here carries a tabindex, so
  // what the markup says is what a keyboard walks.
  assert.equal(harness.document.querySelector("#post-body").getAttribute("tabindex"), null);
  assert.equal(harness.document.querySelector("#post-image").getAttribute("tabindex"), null);

  const stops = tabSequence(harness.document).filter(insideForm).map((node) => node.id);
  assert.equal(stops[0], "post-body", "the composer's first tab stop is not the caption");
  assert.equal(stops[1], "post-image", "something focusable sits between the caption and Upload image");
  assert.ok(stops.indexOf("post-image-alt") > stops.indexOf("post-image"));
  assert.ok(stops.indexOf("post-author") > stops.indexOf("post-image-alt"));
});

test("the description requirement is stated only once there is an image to describe", async (t) => {
  const harness = await composer(t, { attached: false });
  const marker = harness.document.querySelector("#post-image-alt-required");
  const input = harness.document.querySelector("#post-image-alt");

  assert.equal(marker.hidden, true, "no image, nothing to require");
  assert.equal(input.getAttribute("aria-required"), "false");
  // The marker names the condition, so it agrees with the "Image (optional)"
  // legend above it instead of contradicting it.
  assert.equal(textOf(marker), "(required with an image)");
  // The same element, class, and placement the Name and Image labels use for
  // their "(optional)" markers — one treatment answers both questions.
  assert.equal(marker.tagName, "SPAN");
  assert.equal(marker.getAttribute("class"), "label-optional label-required");
  assert.equal(
    harness.document.querySelectorAll(".label-optional").length,
    4,
    "Image, Image description, Display name, and Caption each carry exactly one marker — none is left unmarked",
  );

  harness.feed.description.setAttached(true);
  assert.equal(marker.hidden, false, "the image arrived, so the requirement is now real");
  assert.equal(input.getAttribute("aria-required"), "true");

  harness.feed.description.setAttached(false);
  assert.equal(marker.hidden, true, "removing the image takes the requirement with it");
});

test("publishing an image with a blank description creates nothing and keeps every field", async (t) => {
  const harness = await composer(t);
  harness.fill({ body: "Ring landed on every control.", author: "Mina", description: "   " });

  publish(harness.document);

  assert.equal(harness.published.length, 0, "whitespace is not a description, so no post exists");

  const input = harness.document.querySelector("#post-image-alt");
  const error = harness.document.querySelector(`#${IMAGE_DESCRIPTION_ERROR_ID}`);
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.equal(error.hidden, false);
  assert.match(textOf(error), /Add a description of the image before posting/);
  // Not colour alone: the message leads with a mark, and the mark is hidden from
  // assistive tech because the sentence already says what is wrong.
  assert.equal(harness.document.querySelectorAll(".field-error-mark").length, 1);
  assert.equal(textOf(harness.document.querySelector(".field-error-mark")), "⚠");
  assert.equal(harness.document.querySelector(".field-error-mark").getAttribute("aria-hidden"), "true");

  // The message is bound to the field it is about, and the field's own hint and
  // counter are still described.
  const described = (input.getAttribute("aria-describedby") ?? "").split(/\s+/);
  assert.ok(described.includes(IMAGE_DESCRIPTION_ERROR_ID), "the error id is in aria-describedby");
  assert.ok(described.includes("post-image-alt-hint"));
  assert.ok(described.includes("post-image-alt-counter"));

  // Focus lands on the field to fix, and says so in a way a re-render carries.
  assert.equal(harness.document.activeElement?.id, "post-image-alt");
  assert.equal(input.getAttribute("autofocus"), "");

  // Nothing the poster typed or attached was spent on the refusal.
  assert.equal(harness.document.querySelector("#post-body").value, "Ring landed on every control.");
  assert.equal(harness.document.querySelector("#post-author").value, "Mina");
  assert.equal(harness.preview.src, "data:image/png;base64,carried", "the encoded image is still in the composer");
  assert.equal(harness.document.querySelector("#compose-media").hidden, false, "the preview is still on screen");
  assert.equal(harness.media?.data, PNG_BASE64, "the bytes never left the store the success path reads");
});

test("the missing-description refusal is announced where every other publish outcome is", async (t) => {
  const harness = await composer(t);
  harness.fill({ body: "Ring landed on every control.", author: "Mina", description: "   " });

  publish(harness.document);

  assert.equal(harness.published.length, 0, "the refusal announced a post that was published anyway");

  const notice = harness.document.querySelector("#social-notice");
  // The composer's own status region, reused: a confirmation, a failed save, and
  // now this refusal all arrive in the same place, so nothing new was added for
  // a reader to be listening to.
  assert.equal(notice.getAttribute("role"), "status");
  assert.equal(notice.getAttribute("aria-live"), "polite");
  assert.equal(harness.document.querySelectorAll("#social-notice").length, 1);
  assert.equal(notice.hidden, false);
  assert.equal(notice.classList.contains("is-success"), false);
  // Nothing folds the announcement away: text found inside a closed disclosure
  // is still text this harness can read, and a live region behind one is silent.
  for (let cursor = notice; cursor; cursor = cursor.parentNode) {
    assert.notEqual(cursor.tagName, "DETAILS", "the announcement sits inside a disclosure");
  }

  const said = textOf(notice);
  assert.ok(said.includes(IMAGE_DESCRIPTION_REFUSAL_NOTE), `the refusal was not said: ${said}`);
  assert.match(said, /image description/, "the message does not name the field to fill in");
  // The message is the whole signal — the word "Not published" is in the chip's
  // own label, not in a colour behind it.
  assert.match(said, /Not published/);

  // The shape of a refusal on this page: what stopped, what is asked of you, and
  // that nothing was published. It is said when the refusal happens and nowhere
  // else — the caption's hint used to carry the same three clauses in the page as
  // served, describing a failure the reader had not met yet, and now states only
  // the rule and the budget.
  assert.match(IMAGE_DESCRIPTION_REFUSAL_NOTE, /^Publish post stops on an /);
  assert.match(IMAGE_DESCRIPTION_REFUSAL_NOTE, /—/);
  assert.match(IMAGE_DESCRIPTION_REFUSAL_NOTE, /, and nothing is published\.$/);
  const captionHint = textOf(harness.document.querySelector("#post-body-hint"));
  assert.equal(captionHint, "Required. Up to 280 characters.");

  // Announced, and then the reader is put where the fix is.
  assert.equal(harness.document.activeElement?.id, "post-image-alt");
});

// Two refusals, one at a time. The caption is `required`, so the browser answers
// first and the submit handler returns before the description is consulted.
test("an empty caption and a described-nothing image are not both reported", async (t) => {
  const harness = await composer(t);
  harness.fill({ body: "   ", author: "Mina", description: "" });

  publish(harness.document);

  assert.equal(harness.published.length, 0);
  assert.equal(harness.document.querySelector("#social-notice").hidden, true,
    "the description refusal spoke over the caption's native one");
  assert.equal(harness.document.querySelector(`#${IMAGE_DESCRIPTION_ERROR_ID}`).hidden, true);
  assert.equal(harness.document.querySelector("#post-image-alt").getAttribute("aria-invalid"), null);
});

test("an over-length description is refused through the same path as a missing one", async (t) => {
  const harness = await composer(t);
  const tooLong = "d".repeat(MAX_IMAGE_ALT_LENGTH + 12);
  harness.fill({ body: "Caption.", author: "Mina", description: tooLong });

  publish(harness.document);

  const input = harness.document.querySelector("#post-image-alt");
  assert.equal(harness.published.length, 0);
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.equal(input.value, tooLong, "the over-length text is left there to be cut down");
  assert.match(
    textOf(harness.document.querySelector(`#${IMAGE_DESCRIPTION_ERROR_ID}`)),
    new RegExp(`${MAX_IMAGE_ALT_LENGTH} characters or fewer\\. Remove 12\\.`),
  );
  assert.ok((input.getAttribute("aria-describedby") ?? "").includes(IMAGE_DESCRIPTION_ERROR_ID));
  assert.equal(harness.document.activeElement?.id, "post-image-alt");
  assert.equal(harness.document.querySelector("#post-body").value, "Caption.");
  assert.equal(harness.preview.src, "data:image/png;base64,carried");
});

test("a described image publishes, and the refusal state does not survive the fix", async (t) => {
  const harness = await composer(t);
  harness.fill({ body: "Ring landed everywhere.", author: "Mina", description: "" });
  publish(harness.document);
  assert.equal(harness.published.length, 0);

  const input = harness.document.querySelector("#post-image-alt");
  type(input, "A card wrapped in a blue focus ring.");
  publish(harness.document);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.published.length, 1, "the post is created once the description is there");
  assert.equal(input.getAttribute("aria-invalid"), null, "a valid field is not left marked invalid");
  assert.equal(input.getAttribute("autofocus"), null);
  assert.equal(harness.document.querySelector(`#${IMAGE_DESCRIPTION_ERROR_ID}`).hidden, true);
  // The refusal was replaced by the outcome that actually happened, not left
  // standing beside it.
  const notice = harness.document.querySelector("#social-notice");
  assert.equal(notice.classList.contains("is-success"), true);
  assert.ok(!textOf(notice).includes(IMAGE_DESCRIPTION_REFUSAL_NOTE), "a published post still says it was refused");
});

// The other half of what the label now says out loud. The refusal above is the
// "with an image" clause; this is the "required" clause having a limit — a post
// with no image publishes with the description field empty, through the same
// submit the refusal goes through.
test("a caption-only post publishes with an empty description", async (t) => {
  const harness = await composer(t, { attached: false });
  harness.fill({ body: "No picture, just words.", author: "Mina", description: "" });

  publish(harness.document);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.published.length, 1, "a post with nothing to describe was refused anyway");
  assert.equal(harness.published[0].image, undefined, "no image rode along with the caption");
  const input = harness.document.querySelector("#post-image-alt");
  assert.equal(input.getAttribute("aria-invalid"), null, "an empty description was marked invalid with no image");
  assert.equal(harness.document.querySelector(`#${IMAGE_DESCRIPTION_ERROR_ID}`).hidden, true);
  const notice = harness.document.querySelector("#social-notice");
  assert.equal(notice.classList.contains("is-success"), true, "a published caption was not confirmed");
  assert.ok(!textOf(notice).includes(IMAGE_DESCRIPTION_REFUSAL_NOTE),
    "a post with nothing to describe was told to describe something");
});

test("the description counter is the caption's counter, pointed at this field's budget", async (t) => {
  const harness = await composer(t);
  const counter = harness.document.querySelector("#post-image-alt-counter");
  const input = harness.document.querySelector("#post-image-alt");

  assert.equal(textOf(harness.document.querySelector("#post-image-alt-counter-label")), "Characters remaining:");
  assert.equal(textOf(harness.document.querySelector("#post-counter-label")), "Characters remaining:");
  assert.equal(counter.getAttribute("aria-live"), "polite");
  assert.equal(textOf(counter), String(MAX_IMAGE_ALT_LENGTH));

  type(input, "A card.");
  assert.equal(textOf(counter), String(MAX_IMAGE_ALT_LENGTH - 7));

  type(input, "n".repeat(MAX_IMAGE_ALT_LENGTH - 3));
  assert.equal(counter.classList.contains("near"), true, "the counter escalates before the wall, as the caption's does");

  type(input, "n".repeat(MAX_IMAGE_ALT_LENGTH + 5));
  assert.equal(textOf(counter), "-5");
  assert.equal(counter.classList.contains("over"), true);
});

test("imageDescriptionProblem requires a description only of an image post", () => {
  assert.equal(imageDescriptionProblem("", { attached: false }), null);
  assert.equal(imageDescriptionProblem("   ", { attached: false }), null);
  assert.equal(imageDescriptionProblem("A described card.", { attached: true }), null);
  assert.match(imageDescriptionProblem("", { attached: true }), /Add a description/);
  assert.match(imageDescriptionProblem("\n\t ", { attached: true }), /Add a description/);
  assert.match(imageDescriptionProblem("x".repeat(MAX_IMAGE_ALT_LENGTH + 1), { attached: true }), /Remove 1\./);
  // Trimmed before measuring, so trailing whitespace is not what refuses a post.
  assert.equal(imageDescriptionProblem(`${"x".repeat(MAX_IMAGE_ALT_LENGTH)}   `, { attached: true }), null);
});

test("the shipped composer markup carries the marker, the error slot, and the counter", async () => {
  const html = await import("node:fs/promises")
    .then(({ readFile }) => readFile(new URL("../src/social.html", import.meta.url), "utf8"));
  // Stated in the page as served, with its condition: the description is
  // required only of a post that carries an image, which is the rule
  // imageDescriptionProblem enforces and the opposite of what a flat
  // "(required)" claims under an "Image (optional)" legend. social.js still
  // owns the live marker and takes it away with the image.
  assert.match(html, /<span class="label-optional label-required" id="post-image-alt-required">\(required with an image\)<\/span>/);
  assert.match(html, /id="post-image-alt"[^>]*maxlength="200"/);
  assert.match(html, /aria-describedby="post-image-alt-hint post-image-alt-counter-label post-image-alt-counter"/);
  assert.match(html, /<p class="field-error compose-error" id="post-image-alt-error" hidden><\/p>/);
  assert.match(html, /id="post-image-alt-counter" aria-live="polite" aria-atomic="true">200<\/span>/);
});

/* --------------------------- the read path ------------------------------- */

installDocument();

const legacy = {
  id: "p-legacy",
  author: "Mina",
  body: "Ring landed everywhere.",
  createdAt: "2026-07-14T00:00:00.000Z",
  image: { src: "/media/focus-ring.svg", width: 1200, height: 900 },
};

test("one helper answers for both surfaces, and never with an empty alt", () => {
  assert.deepEqual(imageDescription({ author: "Mina", image: IMAGE }), { alt: IMAGE.alt, missing: false });
  assert.deepEqual(imageDescription(legacy), {
    alt: "Image posted by Mina. No description provided.",
    missing: true,
  });
  // Whitespace is not a description, and an unknown byline still gets a name.
  assert.equal(imageDescription({ author: "Mina", image: { src: "/a.svg", alt: "   " } }).missing, true);
  assert.equal(imageDescription({ image: { src: "/a.svg" } }).alt, "Posted image. No description provided.");
  assert.equal(imageDescription({ author: "Mina", image: { src: "/a.svg", alt: " Trimmed " } }).alt, "Trimmed");
});

test("the feed gives a stored post with no description a real alt and a visible note", () => {
  const container = createElement("div");
  renderPosts(container, [legacy]);

  const img = tags(container, "IMG")[0];
  assert.equal(img.alt, "Image posted by Mina. No description provided.");
  assert.notEqual(img.alt.trim(), "");
  assert.equal(byClass(container, "description-note").length, 1);
  assert.equal(byClass(container, "description-note")[0].textContent, MISSING_DESCRIPTION_NOTE);
  // The note is beside the caption, not folded into the card's accessible name.
  assert.equal(byClass(container, "post-caption")[0].textContent, "Ring landed everywhere.");
});

test("a People profile gives the same post the same alt and the same note", () => {
  const container = createElement("div");
  renderProfileGrid(container, [{ ...legacy, caption: "Ring landed everywhere.", likes: 0, comments: 0 }], {
    author: "Mina",
  });

  const img = tags(container, "IMG")[0];
  assert.equal(img.alt, "Image posted by Mina. No description provided.");
  assert.equal(byClass(container, "description-note").length, 1);
  assert.equal(byClass(container, "description-note")[0].textContent, MISSING_DESCRIPTION_NOTE);
  assert.equal(byClass(container, "profile-tile-caption")[0].textContent, "Ring landed everywhere.");
});

test("a described post carries its own words on both surfaces and no note", () => {
  const described = { ...legacy, image: IMAGE };
  const feed = createElement("div");
  renderPosts(feed, [described]);
  assert.equal(tags(feed, "IMG")[0].alt, IMAGE.alt);
  assert.equal(byClass(feed, "description-note").length, 0);

  const profile = createElement("div");
  renderProfileGrid(profile, [{ ...described, caption: "Ring landed everywhere.", likes: 0, comments: 0 }], {
    author: "Mina",
  });
  assert.equal(tags(profile, "IMG")[0].alt, IMAGE.alt);
  assert.equal(byClass(profile, "description-note").length, 0);
});

test("the write path refuses an undescribed or over-described upload, so no new row can lack one", async () => {
  const stores = createMemorySocialStores();
  const deps = {
    ...stores,
    store: stores.posts,
    authenticate: async () => ({ id: "11111111-1111-4111-8111-111111111111", persona: "Mina", scopes: ["social-posts:write"] }),
    identifyHuman: async () => ({ id: "human:reader" }),
    rateLimit: createMemoryRateLimiter({ limit: 30 }),
    nowMs: () => Date.parse("2026-07-18T12:00:00.000Z"),
    requestId: "description-guarantee",
  };
  const upload = async (alt) => {
    const response = await handleSocialMediaRequest(new Request("https://test.invalid/api/social-media", {
      method: "POST",
      headers: { authorization: "Bearer painter", "content-type": "application/json" },
      body: JSON.stringify({ content_type: "image/png", data: PNG_BASE64, alt }),
    }), deps);
    return { status: response.status, body: await response.json() };
  };

  assert.equal((await upload("A single grey pixel.")).status, 201);
  assert.equal((await upload("   ")).status, 422);
  assert.match((await upload("   ")).body.error.fields.alt, /required/);
  assert.equal((await upload("x".repeat(1000))).status, 422);
});
