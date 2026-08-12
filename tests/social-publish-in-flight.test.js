// The two ends of a publish that the confirmation file does not cover: the wait
// in the middle, and what a reader can do with a publish that did not land.
//
// tests/social-publish-confirmation.test.js owns the receipt itself — its words,
// its links, its focus. This file owns the states either side of it:
//
//   1. In flight, the submit control names what is happening and refuses to
//      start a second write. The disabled attribute only stops a pointer; the
//      caption's Cmd/Ctrl+Enter shortcut calls form.requestSubmit(), which
//      submits a form whose submit button is disabled, so the guard has to be a
//      flag the handler checks — not the control's state.
//   2. A response that cannot address the post it claims to have made is not
//      drawn as a success. The confirmation promises two destinations, so a
//      response missing the id or the display name takes its own lane rather
//      than rendering a link to nowhere.
//   3. A failure leaves all four things the reader supplied where they are, and
//      the retry is the same control on the same page: no reopened dialog, no
//      re-selected image, and the second write carries the same payload.
//
// Harness notes: assertions are on counts, text, and attributes, never on an
// element object; the progress-string count walks text nodes rather than
// querySelectorAll("*"), which this harness rejects.

import test from "node:test";
import assert from "node:assert/strict";
import {
  PUBLISH_IN_FLIGHT_LABEL,
  PUBLISH_STATE_WORDS,
  UNCONFIRMED_PUBLISH_NOTE,
  mountSocialFeed,
  publishedPostLinks,
} from "../src/social.js";
import { postDetailHref, profileHref } from "../src/social-links.js";
import { DomEvent, loadPage, textOf } from "./support/browser.js";

const NOW = Date.parse("2026-08-06T09:00:00.000Z");
const SAVED_ID = "9c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const RETRY_ID = "2b3c4d5e-6f70-4a81-9b2c-3d4e5f607182";

const flush = () => new Promise((resolve) => setImmediate(resolve));

// The composer on the shipped markup, with the publish call replaced by one this
// file settles by hand: every assertion below is about a moment that only exists
// while the write is outstanding, or about what the reader is left holding after
// it answers.
async function composer(t, { hasImage = false } = {}) {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const document = page.document;
  const attempts = [];
  let media = hasImage
    ? { content_type: "image/png", data: "iVBORw0KGgo=", width: 32, height: 32, preview: "data:image/png;base64,carried" }
    : null;

  const feed = mountSocialFeed(document, {
    posts: [],
    state: "ready",
    storage: page.storage,
    getMedia: () => (media ? { ...media, alt: document.querySelector("#post-image-alt").value.trim() } : null),
    clearMedia: () => { media = null; },
    create: (post, sentMedia) => new Promise((resolve, reject) => {
      attempts.push({ post, media: sentMedia, resolve, reject });
    }),
  });
  feed.description.setAttached(Boolean(media));
  feed.composer.open();
  if (media) {
    document.querySelector("#compose-preview-image").src = media.preview;
    document.querySelector("#compose-media").hidden = false;
  }

  const fill = ({ body, author, description }) => {
    if (body !== undefined) document.querySelector("#post-body").value = body;
    if (author !== undefined) document.querySelector("#post-author").value = author;
    if (description !== undefined) document.querySelector("#post-image-alt").value = description;
  };
  // Starts the publish and stops there: the promise the composer is awaiting is
  // still outstanding when this resolves.
  const publish = async () => {
    document.querySelector("#post-submit").click();
    await flush();
  };
  const settle = async (value) => {
    attempts.at(-1).resolve(value);
    await flush();
  };
  const failWith = async (message) => {
    attempts.at(-1).reject(new Error(message));
    await flush();
  };
  const saved = (id) => ({ ...attempts.at(-1).post, id, createdAt: new Date(NOW).toISOString() });

  return { page, document, feed, attempts, fill, publish, settle, failWith, saved, get media() { return media; } };
}

const field = (document, id) => document.querySelector(id).value;
const notice = (document) => document.querySelector("#social-notice");
const submit = (document) => document.querySelector("#post-submit");
// Scoped to the control rather than selected as a descendant: this harness
// parses no descendant selectors.
const submitLabel = (document) => textOf(submit(document).querySelector(".submit-label"));

// Every text node on the page that matches, counted as text rather than as
// elements: an element's textContent includes its descendants', so counting
// elements would count one string once per ancestor.
function matchingText(root, pattern) {
  const found = [];
  const walk = (node) => {
    if (typeof node.data === "string") {
      if (pattern.test(node.data)) found.push(node.data);
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return found;
}

test("while a publish is in flight the control says so, once, and starts nothing else", async (t) => {
  const harness = await composer(t);
  harness.fill({ body: "Waiting on the write.", author: "Remy" });

  await harness.publish();

  assert.equal(harness.attempts.length, 1, "the write is outstanding");
  assert.equal(submitLabel(harness.document), PUBLISH_IN_FLIGHT_LABEL, "the control names what it is doing");
  assert.equal(submit(harness.document).disabled, true);
  assert.equal(submit(harness.document).getAttribute("aria-busy"), "true");
  // Said once. Social already stacks its own loading strings; the publish state
  // is not allowed to become another of them.
  assert.equal(matchingText(harness.document, /Publishing/).length, 1);
  assert.ok(notice(harness.document).hidden, "nothing is claimed until the write answers");

  await harness.settle(harness.saved(SAVED_ID));

  assert.equal(submitLabel(harness.document), "Publish post", "and the control goes back to its own words");
  assert.equal(submit(harness.document).disabled, false);
  assert.equal(submit(harness.document).getAttribute("aria-busy"), "false");
  assert.equal(matchingText(harness.document, /Publishing/).length, 0);
  assert.equal(notice(harness.document).hidden, false);
});

test("a second submit while the first is in flight is not a second post", async (t) => {
  const harness = await composer(t);
  const document = harness.document;
  harness.fill({ body: "Pressed twice in a hurry.", author: "Remy" });

  await harness.publish();

  // The pointer, refused by the control's own state.
  submit(document).click();
  await flush();
  assert.equal(harness.attempts.length, 1, "the disabled control started nothing");

  // The keyboard, which does not go through the control at all: Cmd+Enter in the
  // caption calls form.requestSubmit(), and a disabled submit button does not
  // stop that. Only the handler's own guard does.
  document.querySelector("#post-body").dispatchEvent(new DomEvent("keydown", { bubbles: true, key: "Enter", metaKey: true }));
  await flush();
  assert.equal(harness.attempts.length, 1, "the shortcut started nothing either");

  document.querySelector("#post-form").requestSubmit();
  await flush();
  assert.equal(harness.attempts.length, 1, "and neither did a programmatic submit");

  await harness.settle(harness.saved(SAVED_ID));

  assert.equal(notice(document).querySelectorAll("a").length, 1, "one publish, one receipt, one permalink");
  assert.equal(
    document.querySelectorAll(".post-card").filter((card) => card.dataset.postId === SAVED_ID).length,
    1,
    "and one card in the feed",
  );

  // The guard is released with the write, so the next post is publishable.
  harness.fill({ body: "A genuinely second post." });
  await harness.publish();
  assert.equal(harness.attempts.length, 2);
});

test("a response that cannot address the post is not drawn as a success", async (t) => {
  const harness = await composer(t);
  harness.fill({ body: "Answered without an id.", author: "Remy" });

  await harness.publish();
  // A 200 whose body lost the row: the write path cannot say where the post is,
  // so the confirmation must not claim it knows.
  await harness.settle({ author: "Remy", body: "Answered without an id.", createdAt: new Date(NOW).toISOString() });

  const region = notice(harness.document);
  assert.equal(region.hidden, false);
  assert.match(textOf(region), new RegExp(PUBLISH_STATE_WORDS.unconfirmed));
  assert.match(textOf(region), new RegExp(UNCONFIRMED_PUBLISH_NOTE.slice(0, 60)));
  assert.doesNotMatch(textOf(region), /^Published/, "it does not borrow the confirmation's opening");
  assert.equal(region.classList.contains("is-success"), false);
  assert.equal(region.querySelectorAll("a").length, 0, "no destination is offered, because none was returned");
  assert.equal(harness.document.querySelectorAll(".post-card").length, 0, "and nothing joined the feed");
  // Unconfirmed is not the same news as refused: the caption stays put, because
  // publishing it again could duplicate a post that did land.
  assert.equal(field(harness.document, "#post-body"), "Answered without an id.");
  assert.equal(submit(harness.document).disabled, false);
});

test("a failed publish keeps all four fields, and retry sends the same post from the same page", async (t) => {
  const harness = await composer(t, { hasImage: true });
  const document = harness.document;
  harness.fill({
    body: "This one does not land the first time.",
    author: "Remy",
    description: "A card wrapped in a blue focus ring.",
  });

  await harness.publish();
  await harness.failWith("Posts API returned 503");

  // All four things the reader supplied, untouched.
  assert.equal(field(document, "#post-body"), "This one does not land the first time.");
  assert.equal(field(document, "#post-author"), "Remy");
  assert.equal(field(document, "#post-image-alt"), "A card wrapped in a blue focus ring.");
  assert.equal(harness.media?.data, "iVBORw0KGgo=", "the encoded image is still in the composer");
  assert.equal(document.querySelector("#compose-media").hidden, false, "and its preview is still on screen");

  assert.match(textOf(notice(document)), new RegExp(PUBLISH_STATE_WORDS.failed));
  assert.match(textOf(notice(document)), /Posts API returned 503/);
  // The retry is this control, right here — not a reopened dialog.
  assert.equal(submit(document).disabled, false);
  assert.equal(submitLabel(document), "Publish post");

  await harness.publish();

  assert.equal(harness.attempts.length, 2, "the same control issued the second publish");
  const [first, second] = harness.attempts;
  // Identical payload: everything the write path puts on the wire. The client
  // side id is not part of it — src/social-page.js sends author, content, and
  // the image, and the server owns the row's identity.
  assert.equal(second.post.body, first.post.body);
  assert.equal(second.post.author, first.post.author);
  assert.equal(second.media.data, first.media.data);
  assert.equal(second.media.content_type, first.media.content_type);
  assert.equal(second.media.alt, first.media.alt);
  assert.equal(second.media.alt, "A card wrapped in a blue focus ring.");

  await harness.settle(harness.saved(RETRY_ID));

  const links = notice(document).querySelectorAll("a");
  assert.equal(links.length, 2, "permalink plus People, because this post carries an image");
  assert.equal(links[0].getAttribute("href"), postDetailHref(RETRY_ID, "Remy"));
  assert.equal(links[1].getAttribute("href"), profileHref("Remy"));
  assert.match(textOf(notice(document)), /^Published “This one does not land the first time\.” as Remy\./);
  assert.equal(document.activeElement?.id, "social-notice", "and the reader is standing on the receipt");
  // Only now do the fields empty, on the attempt that actually landed.
  assert.equal(field(document, "#post-body"), "");
  assert.equal(field(document, "#post-image-alt"), "");
  assert.equal(field(document, "#post-author"), "Remy");
});

test("both destinations come from the response, or neither is offered", () => {
  const saved = { id: SAVED_ID, author: "Remy" };
  assert.deepEqual(publishedPostLinks(saved), {
    post: postDetailHref(SAVED_ID, "Remy"),
    profile: profileHref("Remy"),
  });
  assert.equal(publishedPostLinks({ author: "Remy" }), null, "no id, no permalink to promise");
  assert.equal(publishedPostLinks({ id: SAVED_ID }), null, "no display name, no People page to promise");
  assert.equal(publishedPostLinks({ id: "  ", author: "Remy" }), null);
  assert.equal(publishedPostLinks({ id: SAVED_ID, author: "  " }), null);
  assert.equal(publishedPostLinks(null), null);
});
