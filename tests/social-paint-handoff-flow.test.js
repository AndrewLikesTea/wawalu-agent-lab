// #2298: an image sent from Paint lands in Social's composer, through the page
// as served.
//
// The draft a visitor is writing lives only in the Social tab's memory, and
// Paint opens in a second tab. So there are two ways in, and both are here: the
// composer already open in the first tab claims the image from its storage event
// and the draft stays where it was; with no composer to claim it, Paint opens
// Social, which takes it on load. Either way the image goes through the Choose
// image path, so its refusals, its preview and its publish request are the
// chosen file's — the last test compares the two requests byte for byte.
//
// Harness notes: assertions are on ids, text, counts and properties, never on an
// element itself; every wait is on state the page produces.

import test from "node:test";
import assert from "node:assert/strict";

import { DomEvent, textOf, typeText, pressTab } from "./support/browser.js";
import { waitFor } from "./support/page-module.js";
import { bootSocial, handoffRecord } from "./support/social-paint-arrival.js";
import { PAINT_HANDOFF_COPY } from "../src/paint-handoff.js";
import { AUTHOR_STORAGE_KEY } from "../src/social-identity.js";
import { IMAGE_DESCRIPTION_REFUSAL_NOTE } from "../src/social.js";
import {
  MAX_PUBLISH_IMAGE_BYTES,
  PAINT_HANDOFF_KEY,
  UNSUPPORTED_TYPE_ERROR,
  overLimitError,
} from "../src/publishing-media.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const DRAFT = "Drew the release timeline next door.";
const ALT = "A hand-drawn timeline with three releases marked.";
const FROM_PAINT = { search: "?from=paint&image=prepared", hash: "#post-form" };
const SAVED = {
  "/api/social-posts": {
    post: { id: "saved-2298", author: "Remy", content: DRAFT, timestamp: "2026-09-12T09:00:00.000Z", source: "human" },
  },
};

const posts = (requests) => requests.filter((request) => request.method === "POST");

function typeInto(document, id, text) {
  document.querySelector(`#${id}`).focus();
  typeText(document, text);
}

async function chooseFile(document, file) {
  const input = document.querySelector("#post-image");
  input.files = [file];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
  await waitFor(() => !document.querySelector("#compose-media").hidden, `the composer took ${file.name}`);
}

test("an open composer claims the image into its draft, and publishes it as it would a chosen file", async (t) => {
  const { document, id, requests, storage, dispatchStorage } = await bootSocial(t, { routes: SAVED });
  id("post-compose-open").click();
  typeInto(document, "post-body", DRAFT);
  typeInto(document, "post-author", "Remy");

  storage.setItem(PAINT_HANDOFF_KEY, handoffRecord(PNG));
  dispatchStorage(PAINT_HANDOFF_KEY);
  await waitFor(() => !id("compose-media").hidden, "the composer took the image from Paint");

  assert.equal(storage.getItem(PAINT_HANDOFF_KEY), null, "the record was left for a second taker");
  assert.equal(id("post-body").value, DRAFT, "the draft was replaced by the handoff");
  assert.equal(id("post-author").value, "Remy", "the display name was replaced by the handoff");
  assert.equal(document.activeElement?.id, "post-image-alt", "focus did not land on the description");
  assert.equal(textOf(id("compose-media-source")), "Image to publish");
  assert.equal(textOf(id("remove-image")), "Remove image");
  assert.equal(id("compose-preview-image").src, `data:image/png;base64,${PNG.toString("base64")}`);
  assert.equal(posts(requests).length, 0, "the image was sent on arrival");

  // Publish post still refuses an undescribed image, and sends nothing.
  id("post-submit").click();
  await waitFor(() => !id("social-notice").hidden, "the composer answered the publish");
  assert.ok(textOf(id("social-notice")).includes(IMAGE_DESCRIPTION_REFUSAL_NOTE));
  assert.equal(posts(requests).length, 0, "an undescribed image was published");

  typeInto(document, "post-image-alt", ALT);
  id("post-submit").click();
  await waitFor(() => id("social-notice").classList.contains("is-success"), "the publish landed");
  const handed = JSON.parse(posts(requests)[0].body);
  assert.deepEqual(handed, {
    author: "Remy",
    content: DRAFT,
    image: { content_type: "image/png", data: PNG.toString("base64"), alt: ALT, width: 8, height: 8 },
    caption: DRAFT,
  });

  // The same bytes chosen with Choose image make the same request.
  typeInto(document, "post-body", DRAFT);
  await chooseFile(document, new File([PNG], "timeline.png", { type: "image/png" }));
  typeInto(document, "post-image-alt", ALT);
  id("post-submit").click();
  await waitFor(() => posts(requests).length === 2, "the chosen file was published");
  assert.deepEqual(JSON.parse(posts(requests)[1].body), handed);
  await waitFor(() => !id("post-submit").disabled, "the second publish settled");
});

test("arriving from Paint takes the image once, focuses the description and clears the address", async (t) => {
  const { document, id, requests, storage, history, boot } = await bootSocial(t, {
    ...FROM_PAINT,
    storage: { [PAINT_HANDOFF_KEY]: handoffRecord(PNG), [AUTHOR_STORAGE_KEY]: "Remy" },
  });
  await waitFor(() => !id("compose-media").hidden, "the composer took the image from Paint");

  assert.equal(id("post-compose-panel").hidden, false);
  assert.equal(id("post-author").value, "Remy");
  assert.equal(document.activeElement?.id, "post-image-alt");
  assert.equal(storage.getItem(PAINT_HANDOFF_KEY), null);
  assert.deepEqual(history.replaced, ["/social.html#post-form"], "a reload would ask for the image again");
  assert.equal(id("paint-arrival").hidden, false);
  assert.ok(textOf(id("paint-arrival")).includes(PAINT_HANDOFF_COPY.prepared.arrivalTitle));
  assert.equal(posts(requests).length, 0);

  // A second boot reads the address the first one left, so it takes nothing.
  const later = handoffRecord(PNG);
  storage.setItem(PAINT_HANDOFF_KEY, later);
  await boot();
  assert.equal(storage.getItem(PAINT_HANDOFF_KEY), later, "a second boot took the handoff again");
});

for (const [label, bytes, type, reason] of [
  ["a file that is not an accepted image", Buffer.from("<svg/>"), "image/svg+xml", UNSUPPORTED_TYPE_ERROR],
  ["an image over 512 KB", Buffer.alloc(MAX_PUBLISH_IMAGE_BYTES + 1, 7), "image/png", overLimitError(MAX_PUBLISH_IMAGE_BYTES + 1)],
]) {
  test(`${label} from Paint is refused as a chosen one is, and Choose image still works`, async (t) => {
    const { document, id, storage } = await bootSocial(t, {
      ...FROM_PAINT,
      storage: { [PAINT_HANDOFF_KEY]: handoffRecord(bytes, { type }) },
    });
    const error = id("post-image-error");

    assert.ok(textOf(error).includes(reason), `the refusal did not say why: ${textOf(error)}`);
    assert.equal(error.hidden, false);
    assert.equal(id("compose-media").hidden, true, "a refused image was shown as ready");
    assert.equal(id("paint-arrival").hidden, true, "a refused image was announced as attached");
    assert.equal(id("post-submit").disabled, true);
    assert.equal(storage.getItem(PAINT_HANDOFF_KEY), null, "a refused record was left to be refused again");

    await chooseFile(document, new File([PNG], "timeline.png", { type: "image/png" }));
    assert.equal(error.hidden, true);
    assert.equal(id("post-submit").disabled, false);
  });
}

test("without the marker, and with no draft to join, a waiting record is left alone", async (t) => {
  const record = handoffRecord(PNG);
  const { id, storage, dispatchStorage } = await bootSocial(t, { storage: { [PAINT_HANDOFF_KEY]: record } });

  assert.equal(storage.getItem(PAINT_HANDOFF_KEY), record);
  assert.equal(id("compose-media").hidden, true);
  // A closed, empty composer is not the draft Paint was opened from.
  dispatchStorage(PAINT_HANDOFF_KEY);
  assert.equal(storage.getItem(PAINT_HANDOFF_KEY), record, "a tab with no draft claimed the image");
  assert.equal(id("post-compose-panel").hidden, true);
});

test("transfer confirmation is one status, and removal clears it without clearing the text draft", async (t) => {
  const { document, id, storage, dispatchStorage } = await bootSocial(t);
  id("post-compose-open").click();
  typeInto(document, "post-body", DRAFT);
  typeInto(document, "post-author", "Remy");
  storage.setItem(PAINT_HANDOFF_KEY, handoffRecord(PNG));
  dispatchStorage(PAINT_HANDOFF_KEY);
  await waitFor(() => !id("compose-media").hidden, "preview arrived");
  assert.equal(id("paint-arrival").getAttribute("role"), "status");
  assert.match(textOf(id("paint-arrival")), /Image transferred/);
  assert.equal(id("paint-arrival").querySelector(".paint-arrival-shape").getAttribute("aria-hidden"), "true");
  assert.equal(textOf(id("post-media-status")), "", "transfer must not have a second live confirmation");
  id("post-author").value = "";
  typeInto(document, "post-author", "Remy updated");
  assert.equal(document.activeElement.id, "post-author", "ordinary edits must not refocus the description");
  id("remove-image").click();
  assert.equal(id("paint-arrival").hidden, true);
  assert.equal(textOf(id("paint-arrival")), "");
  assert.equal(id("compose-media").hidden, true);
  assert.equal(id("compose-preview-image").getAttribute("src"), null);
  assert.equal(id("post-body").value, DRAFT);
  assert.equal(id("post-author").value, "Remy updated");
  assert.equal(document.activeElement.id, "post-image");
  assert.match(textOf(id("post-media-status")), /Image removed.*publish without an image/);
});

for (const [label, record] of [
  ["missing", null],
  ["malformed", "{broken"],
  ["expired", handoffRecord(PNG, { createdAt: 1 })],
  ["unreadable", JSON.stringify({ createdAt: Date.now(), dataUrl: "not an image" })],
]) {
  test(`${label} transfer opens the composer with a recoverable inline error`, async (t) => {
    const { document, id } = await bootSocial(t, {
      ...FROM_PAINT, storage: record ? { [PAINT_HANDOFF_KEY]: record } : {},
    });
    assert.equal(id("post-compose-panel").hidden, false);
    assert.equal(id("compose-media").hidden, true);
    assert.equal(id("paint-arrival").hidden, true);
    assert.equal(document.activeElement.id, "post-form-title");
    assert.equal(id("post-image-error").getAttribute("role"), "alert");
    assert.match(textOf(id("post-image-error")), /could not be loaded/);
    const recovery = id("post-image-error").querySelector("a");
    assert.equal(recovery.href, "/paint/");
    assert.equal(recovery.target, "_blank", "recovery must keep the draft tab alive");
    assert.match(textOf(recovery), /Back to Paint.*new tab/);
    assert.equal(id("post-submit").disabled, false, "text-only publishing remains available");
    // The failure happened in storage. The picker is empty and would take any
    // supported file right now, so it is not a control holding something invalid.
    assert.equal(id("post-image").getAttribute("aria-invalid"), null);
  });
}

test("a malformed cross-tab transfer preserves an existing text draft and display name", async (t) => {
  const { id, document, storage, dispatchStorage } = await bootSocial(t);
  id("post-compose-open").click();
  typeInto(document, "post-body", DRAFT);
  typeInto(document, "post-author", "Remy");
  storage.setItem(PAINT_HANDOFF_KEY, "null");
  dispatchStorage(PAINT_HANDOFF_KEY);
  assert.equal(id("post-body").value, DRAFT);
  assert.equal(id("post-author").value, "Remy");
  assert.equal(id("post-image-error").hidden, false);
  await chooseFile(document, new File([PNG], "replacement.png", { type: "image/png" }));
  assert.equal(id("post-image-error").hidden, true);
  assert.equal(id("paint-arrival").hidden, true);
});

test("a transferred preview decode failure withdraws confirmation and offers Paint recovery", async (t) => {
  const { id, document } = await bootSocial(t, {
    ...FROM_PAINT, storage: { [PAINT_HANDOFF_KEY]: handoffRecord(PNG) },
  });
  await waitFor(() => !id("compose-media").hidden, "preview arrived");
  typeInto(document, "post-body", DRAFT);
  id("compose-preview-image").dispatchEvent(new DomEvent("error"));
  assert.equal(id("paint-arrival").hidden, true);
  assert.equal(id("compose-media").hidden, true);
  assert.equal(id("post-body").value, DRAFT);
  assert.match(textOf(id("post-image-error")), /could not be previewed/);
  assert.equal(id("post-image-error").querySelector("a").href, "/paint/");
});


test("arrival keyboard order reaches description, name, publish and close; reverse Tab reaches removal", async (t) => {
  const { id, document } = await bootSocial(t, {
    ...FROM_PAINT, storage: { [PAINT_HANDOFF_KEY]: handoffRecord(PNG) },
  });
  await waitFor(() => !id("compose-media").hidden, "preview arrived");
  typeInto(document, "post-image-alt", ALT);
  assert.equal(pressTab(document).id, "post-author");
  assert.equal(pressTab(document).id, "post-submit");
  assert.equal(pressTab(document).id, "post-compose-cancel");
  id("post-image-alt").focus();
  assert.equal(pressTab(document, { shift: true }).id, "remove-image");
});

test("blocked storage reports recovery without losing the draft", async (t) => {
  const { id, document, dispatchStorage } = await bootSocial(t);
  id("post-compose-open").click();
  typeInto(document, "post-body", DRAFT);
  const storage = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error("Storage blocked"); } };
  try {
    // Dispatch needs a real record in the harness store to model a cross-tab event.
    storage.setItem(PAINT_HANDOFF_KEY, handoffRecord(PNG));
    dispatchStorage(PAINT_HANDOFF_KEY);
    assert.equal(id("post-body").value, DRAFT);
    assert.equal(id("post-image-error").hidden, false);
    assert.equal(id("post-image-error").querySelector("a").href, "/paint/");
  } finally {
    globalThis.localStorage = storage;
  }
});

test("undecodable transferred bytes retain text and provide Paint recovery", async (t) => {
  const { id, document, storage, dispatchStorage } = await bootSocial(t);
  id("post-compose-open").click();
  typeInto(document, "post-body", DRAFT);
  globalThis.createImageBitmap = async () => { throw new Error("Cannot decode"); };
  storage.setItem(PAINT_HANDOFF_KEY, handoffRecord(PNG));
  dispatchStorage(PAINT_HANDOFF_KEY);
  await waitFor(() => !id("post-image-error").hidden, "decoder refused transfer");
  assert.equal(id("post-body").value, DRAFT);
  assert.equal(id("paint-arrival").hidden, true);
  assert.equal(id("compose-media").hidden, true);
  assert.equal(id("post-image-error").querySelector("a").href, "/paint/");
  assert.equal(document.activeElement.id, "post-form-title");
});
