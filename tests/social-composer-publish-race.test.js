// #2370: the Social composer as a disclosure a publish can outlive.
//
// Attempt 1 was rejected because a publish that landed after the reader had
// closed, reopened and edited the composer emptied the edited draft. Every
// request here is a deferred promise resolved or rejected by hand, so the draft
// can be changed while the request is actually out. The media half is a value
// the test holds, changed through feed.description.setAttached — the call
// src/social-page.js makes when an image is attached, replaced or removed.
//
// Harness notes: assertions compare ids, attributes, text and counts, never
// elements. pressTab restarts at stop 0 from an element that is not itself a
// stop (the heading open() focuses), so the walk from the heading reads the
// stops after it in document order, which is what a browser's Tab does.

import test from "node:test";
import assert from "node:assert/strict";
import {
  BLANK_POST_MESSAGE, DRAFT_KEPT_NOTE, ERROR_SUMMARY_TITLE, PUBLISH_FAILED_NOTE, mountSocialFeed,
} from "../src/social.js";
import { DomEvent, loadPage, pressKey, tabSequence, textOf } from "./support/browser.js";

const IMAGE_A = { content_type: "image/png", data: "iVBORw0KGgo=", width: 32, height: 32, preview: "data:image/png;base64,first" };
const IMAGE_B = { content_type: "image/png", data: "R0lGODlhAQ==", width: 16, height: 16, preview: "data:image/png;base64,second" };
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function composer(t, { image = null } = {}) {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const { document } = page;
  const id = (name) => document.querySelector(`#${name}`);
  const requests = [];
  let pending = null;
  let media = null;
  let cleared = 0;
  const feed = mountSocialFeed(document, {
    posts: [], state: "ready", storage: page.storage,
    getMedia: () => (media ? { ...media, alt: id("post-image-alt").value.trim() } : null),
    clearMedia: () => { cleared += 1; media = null; },
    create: (post, sent) => new Promise((resolve, reject) => {
      requests.push({ post, image: sent });
      pending = {
        resolve: () => resolve({ ...post, id: `saved-${requests.length}`, source: "shiplog-web" }),
        reject: (message) => reject(new Error(message)),
      };
    }),
  });
  const attach = (next) => {
    media = next;
    id("compose-preview-image").src = next.preview;
    id("compose-media").hidden = false;
    feed.description.setAttached(true);
  };
  const detach = () => {
    media = null;
    id("compose-media").hidden = true;
    feed.description.setAttached(false);
  };
  const type = (name, value) => {
    id(name).focus();
    id(name).value = value;
    id(name).dispatchEvent(new DomEvent("input", { bubbles: true }));
  };
  // Pressed the way a reader presses it: the button takes focus, then submits.
  const publish = async () => {
    id("post-submit").focus();
    id("post-submit").click();
    await settle();
  };
  const cards = () => document.querySelectorAll(".post-card")
    .filter((card) => !card.getAttribute("class").includes("-skeleton"));
  id("post-compose-open").click();
  if (image) attach(image);
  return {
    document, feed, id, requests, attach, detach, type, publish, cards,
    get media() { return media; },
    get cleared() { return cleared; },
    async resolve() { pending.resolve(); await settle(); },
    async reject(message) { pending.reject(message); await settle(); },
  };
}

const insidePanel = (node) => {
  for (let cursor = node; cursor; cursor = cursor.parentNode) if (cursor.id === "post-compose-panel") return true;
  return false;
};

function stopsAfter(document, node) {
  const order = [];
  const walk = (parent) => {
    for (const child of parent.children ?? []) {
      if (typeof child.getAttribute !== "function") continue;
      order.push(child);
      walk(child);
    }
  };
  walk(document.querySelector("body"));
  const at = order.indexOf(node);
  return tabSequence(document).filter((stop) => order.indexOf(stop) > at);
}

test("the composer ships closed, opens onto its heading, and tabs through every control in order", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const { document } = page;
  mountSocialFeed(document, { posts: [], state: "ready", storage: page.storage });
  const id = (name) => document.querySelector(`#${name}`);
  const trigger = id("post-compose-open");
  assert.equal(trigger.tagName, "BUTTON");
  assert.equal(trigger.type, "button");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(trigger.getAttribute("aria-controls"), "post-compose-panel");
  assert.equal(id("post-compose-panel").hidden, true);
  assert.equal(id("post-compose-panel").getAttribute("aria-labelledby"), "post-form-title");
  const controls = ["post-body", "post-image", "remove-image", "post-image-alt", "post-author", "post-submit", "post-compose-cancel"];
  const paint = document.querySelectorAll("a").filter((link) => link.getAttribute("class")?.includes("paint-link"));
  assert.equal(paint.length, 1);
  for (const node of [...controls.map(id), paint[0]]) {
    assert.equal(insidePanel(node), true, `${node.id || "the Paint link"} is outside the hidden panel`);
  }
  assert.equal(tabSequence(document).filter(insidePanel).length, 0, "a composer control is a tab stop while closed");

  trigger.click();
  id("compose-media").hidden = false;
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(id("post-compose-panel").hidden, false);
  assert.equal(document.activeElement?.id, "post-form-title");
  assert.equal(id("post-form-title").getAttribute("tabindex"), "-1");
  const walked = stopsAfter(document, id("post-form-title")).slice(0, 8)
    .map((node) => node.id || node.getAttribute("class"));
  assert.deepEqual(walked, [
    "post-body", "secondary-button paint-link", "post-image", "remove-image",
    "post-image-alt", "post-author", "post-submit", "post-compose-cancel",
  ]);
});

test("Escape and Close keep the typed text and the image, return to the trigger, and reopen on the same draft", async (t) => {
  const harness = await composer(t, { image: IMAGE_A });
  const { document, id } = harness;
  harness.type("post-body", "Half a post.");
  harness.type("post-image-alt", "A half-drawn card.");

  pressKey(document, "Escape");
  assert.equal(id("post-compose-panel").hidden, true);
  assert.equal(id("post-compose-open").getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement?.id, "post-compose-open");
  // Escape outside the panel does nothing.
  pressKey(document, "Escape");
  assert.equal(id("post-compose-panel").hidden, true);

  id("post-compose-open").click();
  assert.equal(document.activeElement?.id, "post-form-title");
  id("post-compose-cancel").click();
  assert.equal(document.activeElement?.id, "post-compose-open");

  id("post-compose-open").click();
  assert.equal(id("post-body").value, "Half a post.");
  assert.equal(id("post-image-alt").value, "A half-drawn card.");
  assert.equal(id("compose-media").hidden, false);
  assert.equal(id("compose-preview-image").src, IMAGE_A.preview);
  assert.equal(harness.media?.data, IMAGE_A.data);
});

test("an invalid press lists each problem by field, wires each field to its error, and focuses the summary", async (t) => {
  const harness = await composer(t, { image: IMAGE_A });
  const { document, id } = harness;
  harness.type("post-body", "   ");
  await harness.publish();

  assert.equal(harness.requests.length, 0);
  const summary = id("post-error-summary");
  assert.equal(summary.hidden, false);
  assert.equal(document.activeElement?.id, "post-error-summary");
  assert.equal(summary.getAttribute("tabindex"), "-1");
  assert.equal(textOf(summary.querySelector("h3")), ERROR_SUMMARY_TITLE);
  const items = summary.querySelectorAll("li").map((item) => textOf(item));
  assert.equal(items.length, 2);
  assert.equal(items[0], BLANK_POST_MESSAGE);
  assert.match(items[1], /^Image description: Add a description of the image/);
  for (const [field, error] of [["post-body", "post-body-error"], ["post-image-alt", "post-image-alt-error"]]) {
    assert.equal(id(field).getAttribute("aria-invalid"), "true", `${field} is not marked invalid`);
    assert.ok(id(field).getAttribute("aria-describedby").split(/\s+/).includes(error), `${field} does not name ${error}`);
    assert.equal(id(error).hidden, false);
    assert.ok(textOf(id(error)).length > 1, `${error} carries no words`);
  }

  // Closing keeps the errors with the draft.
  id("post-compose-cancel").click();
  id("post-compose-open").click();
  assert.equal(summary.hidden, false);
  assert.equal(id("post-body").getAttribute("aria-invalid"), "true");

  harness.type("post-body", "Fixed.");
  harness.type("post-image-alt", "A described card.");
  await harness.publish();
  assert.equal(harness.requests.length, 1);
  assert.equal(summary.hidden, true);
  assert.equal(textOf(summary), "");
  assert.equal(id("post-body").getAttribute("aria-invalid"), null);
  assert.equal(id("post-image-alt").getAttribute("aria-invalid"), null);
  await harness.resolve();
});

test("REGRESSION: close, reopen and edit during a publish, then it lands — the edit stays and the old post is in the feed", async (t) => {
  const harness = await composer(t);
  const { document, id } = harness;
  harness.type("post-body", "The post that was sent.");
  await harness.publish();
  assert.equal(harness.requests.length, 1);

  id("post-body").focus();
  pressKey(document, "Escape");
  assert.equal(id("post-compose-panel").hidden, true, "a pending publish refused the close");
  id("post-compose-open").click();
  assert.match(textOf(id("post-submit")), /Publishing…/, "the reopened composer does not say a publish is out");
  assert.equal(id("post-submit").disabled, false);
  harness.type("post-body", "The post I am writing now.");

  await harness.resolve();

  assert.equal(id("post-body").value, "The post I am writing now.");
  assert.equal(harness.cleared, 0);
  const saved = harness.cards().filter((card) => card.dataset.postId === "saved-1");
  assert.equal(saved.length, 1, "the published post is not in the feed");
  assert.match(textOf(saved[0]), /The post that was sent\./);
  assert.match(textOf(id("social-notice")), /^Published “The post that was sent\.”/);
  assert.ok(textOf(id("social-notice")).includes(DRAFT_KEPT_NOTE));
  assert.equal(document.activeElement?.id, "post-body", "the completion pulled focus off the field being edited");
  assert.equal(textOf(id("post-counter")), String(280 - "The post I am writing now.".length));
});

for (const change of ["replace", "remove"]) {
  test(`${change === "replace" ? "replacing" : "removing"} the image during a publish keeps the current image state when it lands`, async (t) => {
    const harness = await composer(t, { image: IMAGE_A });
    const { id } = harness;
    harness.type("post-body", "Sent with the first image.");
    harness.type("post-image-alt", "The first image.");
    await harness.publish();
    assert.equal(harness.requests[0].image.data, IMAGE_A.data);

    if (change === "replace") harness.attach(IMAGE_B);
    else harness.detach();
    await harness.resolve();

    assert.equal(harness.cleared, 0, "the completion cleared the current image");
    assert.equal(id("post-body").value, "Sent with the first image.");
    if (change === "replace") {
      assert.equal(harness.media?.data, IMAGE_B.data);
      assert.equal(id("compose-preview-image").src, IMAGE_B.preview);
      assert.equal(id("compose-media").hidden, false);
      assert.equal(id("post-image-alt").value, "The first image.");
    } else {
      assert.equal(harness.media, null);
      assert.equal(id("compose-media").hidden, true);
    }
    assert.equal(harness.cards().filter((card) => card.dataset.postId === "saved-1").length, 1);
  });
}

test("a publish that lands with no edits clears the form and media, and lands focus on the notice", async (t) => {
  const harness = await composer(t, { image: IMAGE_A });
  const { document, id } = harness;
  harness.type("post-body", "Nothing changes after this.");
  harness.type("post-image-alt", "A card.");
  await harness.publish();
  await harness.resolve();

  assert.equal(id("post-body").value, "");
  assert.equal(id("post-image-alt").value, "");
  assert.equal(harness.cleared, 1);
  assert.equal(harness.media, null);
  assert.equal(textOf(id("post-counter")), "280");
  assert.equal(textOf(id("social-notice")).includes(DRAFT_KEPT_NOTE), false);
  assert.equal(document.activeElement?.id, "social-notice");
  assert.match(textOf(id("post-submit")), /Publish post/);
});

test("a publish that fails after an edit keeps the edited draft and says it failed", async (t) => {
  const harness = await composer(t);
  const { document, id } = harness;
  harness.type("post-body", "First words.");
  await harness.publish();
  harness.type("post-body", "Better words.");
  await harness.reject("Posts API returned 503");

  assert.equal(id("post-body").value, "Better words.");
  assert.equal(harness.cleared, 0);
  const notice = textOf(id("social-notice"));
  assert.match(notice, /Not published/);
  assert.match(notice, /Posts API returned 503/);
  assert.ok(notice.includes(PUBLISH_FAILED_NOTE));
  assert.equal(document.activeElement?.id, "post-body");
  assert.equal(harness.cards().length, 0);
});

test("a second press while a publish is pending sends nothing, without disabling the button", async (t) => {
  const harness = await composer(t);
  const { document, id } = harness;
  harness.type("post-body", "Only once.");
  await harness.publish();
  await harness.publish();
  id("post-author").focus();
  id("post-form").dispatchEvent(new DomEvent("submit", { bubbles: true }));
  await settle();

  assert.equal(harness.requests.length, 1, "a pending publish sent a second request");
  assert.equal(id("post-submit").disabled, false);
  assert.equal(id("post-submit").getAttribute("aria-busy"), "true");
  assert.equal(id("post-compose-cancel").disabled, false);
  await harness.resolve();
  assert.equal(harness.cards().length, 1);
});

test("a publish that settles while the composer is closed announces outside it and leaves focus on the trigger", async (t) => {
  const harness = await composer(t);
  const { document, id } = harness;
  harness.type("post-body", "Sent, then closed.");
  await harness.publish();
  id("post-compose-cancel").click();
  await harness.resolve();

  assert.equal(document.activeElement?.id, "post-compose-open");
  assert.equal(id("post-compose-panel").hidden, true);
  assert.equal(textOf(id("feed-announcer")), "Post published.");
  assert.equal(id("post-body").value, "", "an unedited draft is still spent by the publish");
});
