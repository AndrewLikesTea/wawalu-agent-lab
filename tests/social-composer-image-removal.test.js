// What Remove image tells a reader who cannot see the preview disappear (#2456).
//
// Removing an image changes three things a sighted reader observes at a glance
// and a screen reader observes not at all: the preview goes, the image
// description stops being required, and the post will now publish without an
// image. Until this change the control reported all of that as silence — the
// status line that had announced "Image ready to describe and post." was
// emptied, and focus moved to Choose image with no account of what had
// happened to the file that was there.
//
// Booted through tests/support/social-paint-arrival.js, which stands up the
// FileReader and createImageBitmap this runtime does not ship, so the accepted
// path — the only path with an image to remove — is reachable at all. The
// refusal paths are covered in tests/social-image-upload-limits.test.js.

import test from "node:test";
import assert from "node:assert/strict";

import { DomEvent, textOf } from "./support/browser.js";
import { waitFor } from "./support/page-module.js";
import { bootSocial } from "./support/social-paint-arrival.js";

// The two sentences a visitor reads, written out rather than imported — the way
// tests/social-image-upload-limits.test.js writes its own — so a silent
// rewording fails here instead of passing against itself. src/social-page.js is
// a page module with browser-absolute imports and cannot be imported directly
// anyway.
const READY = "Image ready to describe and post. Nothing is sent until you publish.";
const IMAGE_REMOVED_STATUS = "Image removed. This post will publish without an image, and the image description is no longer required.";

// A real File, because the FileReader stub reads its real bytes.
const pngFile = () => new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "card.png", { type: "image/png" });

// The composer open with an image accepted and previewed — the state Remove
// image exists to undo.
async function withAcceptedImage(t) {
  const social = await bootSocial(t);
  social.id("post-compose-open").click();
  const input = social.id("post-image");
  input.files = [pngFile()];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
  await waitFor(() => textOf(social.id("post-media-status")) === READY, "the composer accepted the image");
  return social;
}

test("Remove image says what was removed, in the region that announced the image arriving", async (t) => {
  const social = await withAcceptedImage(t);
  const status = () => textOf(social.id("post-media-status"));

  // The image is here: the preview panel is open and the description is being
  // waited on.
  assert.equal(social.id("compose-media").hidden, false);
  assert.equal(social.id("post-image-alt").getAttribute("aria-required"), "true");

  social.id("remove-image").click();

  // The same region, saying the opposite thing — not emptied. Arrival and
  // removal are one line disagreeing, rather than one line and an absence.
  assert.equal(status(), IMAGE_REMOVED_STATUS);
  assert.notEqual(status(), "");
  assert.match(status(), /^Image removed\./);
  // It names both consequences a reader cannot otherwise observe.
  assert.match(status(), /publish without an image/);
  assert.match(status(), /no longer required/);

  // And the state it describes is the state the composer is actually in, so the
  // announcement cannot drift from the page.
  assert.equal(social.id("compose-media").hidden, true);
  assert.equal(social.id("post-image-alt").getAttribute("aria-required"), "false");
  assert.equal(social.id("post-image").value, "");
});

test("the removal is announced by a live region and read by the control focus lands on", async (t) => {
  const social = await withAcceptedImage(t);
  const status = social.id("post-media-status");

  // Announced: the region is polite and atomic, so the whole sentence is read
  // rather than the changed words alone. It ships that way in src/social.html;
  // asserted here because the announcement is the point of the sentence.
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(status.getAttribute("aria-atomic"), "true");

  social.id("remove-image").click();

  // Focus goes to Choose image — the control that starts the act again, and the
  // one the removed image's own control was replaced by. It is described by the
  // status line, so a reader who lands there is told the state even if the live
  // region announcement was missed.
  assert.equal(social.document.activeElement?.id, "post-image");
  const describedBy = (social.id("post-image").getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  assert.equal(describedBy.includes("post-media-status"), true,
    `Choose image is not described by the status line: ${describedBy.join(" ")}`);
});

test("removing an image withdraws the publish blocker rather than leaving it behind", async (t) => {
  const social = await withAcceptedImage(t);

  // An image with no description holds Publish post to a named step.
  const reason = social.id("post-publish-reason");
  assert.equal(reason.hidden, false);
  assert.match(textOf(reason), /Fill in the required image description/);

  social.id("remove-image").click();

  // With no image there is nothing to describe, so the step goes with it. A
  // removal that announced itself and left this standing would be telling the
  // reader two different things about the same post.
  assert.equal(reason.hidden, true);
  assert.equal(textOf(reason), "");
  const describedBy = (social.id("post-submit").getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  assert.equal(describedBy.includes("post-publish-reason"), false);
  assert.equal(social.id("post-submit").disabled, false);
});

test("a rejected file still clears in silence, so its own refusal is the only sentence", async (t) => {
  const social = await bootSocial(t);
  social.id("post-compose-open").click();

  // clear() is shared with the refusal path, which writes its own sentence
  // after clearing. If removal's announcement leaked into that path, a refused
  // file would be answered twice, and the second answer would say an image was
  // removed when none was ever accepted.
  const input = social.id("post-image");
  input.files = [new File([Buffer.from([1, 2, 3])], "sunset.heic", { type: "image/heic" })];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
  await waitFor(() => textOf(social.id("post-image-error")) !== "", "the composer refused the file");

  assert.equal(textOf(social.id("post-media-status")), "");
  assert.equal(textOf(social.id("post-image-error")).includes(IMAGE_REMOVED_STATUS), false);
  assert.match(textOf(social.id("post-image-error")), /not a PNG, JPEG, GIF, or WebP/);
});
