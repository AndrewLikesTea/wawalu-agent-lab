// #2604: the state Social lands in when an image arrives from Paint's "Use this
// image in a Social post" control.
//
// The route itself already worked (#2298): the composer opens, the image goes
// through the Choose image path, and focus lands on the description. What it did
// not do was say anything about itself where the reader was looking. The preview
// carried no account of where the picture came from, the arrival made no promise
// about what was still required, a transfer that failed named one way on out of
// two, and a visitor who had typed their post in another tab arrived at an empty
// form with nothing to explain it. This file holds those four states, and pins
// the composer's description of the Paint route to the sentence the arrival
// actually renders — the drift this issue exists to stop.
//
// Harness notes: assertions are on ids, counts, text and properties, never on an
// element itself. The origin line is read out of the page as served as well as
// out of the booted page, so the promise and the arrival are compared as bytes.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { DomEvent, textOf, typeText } from "./support/browser.js";
import { waitFor } from "./support/page-module.js";
import { bootSocial, handoffRecord } from "./support/social-paint-arrival.js";
import {
  PAINT_ARRIVAL_NO_DRAFT,
  PAINT_ARRIVAL_ORIGIN_LINE,
  PAINT_ARRIVAL_PREVIEW_LINE,
  PAINT_ARRIVAL_REQUIRED_STEP,
  PAINT_ARRIVAL_ROUTES,
} from "../src/paint-handoff.js";
import { MAX_PUBLISH_IMAGE_BYTES, PAINT_HANDOFF_KEY } from "../src/publishing-media.js";
import { IMAGE_DESCRIPTION_REFUSAL_NOTE } from "../src/social.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const FROM_PAINT = { search: "?from=paint&image=prepared", hash: "#post-form" };
const DRAFT = "Drew the release timeline next door.";
const ALT = "A hand-drawn timeline with three releases marked.";

const arrive = (t, record = handoffRecord(PNG)) =>
  bootSocial(t, { ...FROM_PAINT, storage: { [PAINT_HANDOFF_KEY]: record } });

// (1) (2) (3) One arrival, and everything a reader meets in it: the composer
// open, the carried image in the frame, the origin said beside that frame, the
// remaining required step said in the same sentence, and the caret in the field
// that sentence names.
test("an arrival from Paint opens the composer, previews the image, names its origin and lands on the description", async (t) => {
  const { document, id } = await arrive(t);
  await waitFor(() => !id("compose-media").hidden, "the composer took the image from Paint");

  assert.equal(id("post-compose-panel").hidden, false, "the composer arrived collapsed");
  assert.equal(id("compose-preview-image").src, `data:image/png;base64,${PNG.toString("base64")}`);
  assert.equal(textOf(id("compose-media-source")), "Image to publish");

  // The origin line, beside the preview rather than in the composer's intro
  // prose: its parent is the media region that holds the picture.
  const origin = id("compose-media-origin");
  assert.equal(origin.hidden, false, "the preview carried no account of where the image came from");
  assert.equal(textOf(origin), PAINT_ARRIVAL_PREVIEW_LINE);
  assert.equal(id("compose-media").querySelectorAll("#compose-media-origin").length, 1,
    "the origin line was rendered outside the region that holds the preview");
  // In words, not in a hue: the sentence itself names Paint and the step left.
  assert.match(textOf(origin), /came from Paint/);
  assert.match(textOf(origin), /required step/);

  // Focus is set after the composer is open and the field is in the DOM.
  assert.equal(document.activeElement?.id, "post-image-alt", "focus did not land on the description");
});

// (3), honestly. The sentence above calls the description "the last required
// step before you can publish". That is a claim about the publish path, so it is
// checked against the publish path: the same arrival, submitted undescribed,
// must be refused and must send nothing.
test("the required-step promise is the one the publish guard keeps", async (t) => {
  const { document, id, requests } = await bootSocial(t, {
    ...FROM_PAINT,
    storage: { [PAINT_HANDOFF_KEY]: handoffRecord(PNG) },
    routes: {
      "/api/social-posts": {
        post: { id: "arrival-2604", author: "Remy", content: DRAFT, timestamp: "2026-09-28T09:00:00.000Z", source: "human" },
      },
    },
  });
  await waitFor(() => !id("compose-media").hidden, "the composer took the image from Paint");
  const posted = () => requests.filter((request) => request.method === "POST");

  id("post-body").focus();
  typeText(document, DRAFT);
  id("post-author").focus();
  typeText(document, "Remy");
  id("post-submit").click();
  await waitFor(() => !id("social-notice").hidden, "the composer answered the publish");
  assert.ok(textOf(id("social-notice")).includes(IMAGE_DESCRIPTION_REFUSAL_NOTE),
    `an undescribed arrival was not refused: ${textOf(id("social-notice"))}`);
  assert.equal(posted().length, 0, "an undescribed image was published");

  // And the same press, described, is taken — so the copy names a step that is
  // required, not one that is merely requested.
  id("post-image-alt").focus();
  typeText(document, ALT);
  id("post-submit").click();
  await waitFor(() => posted().length === 1, "the described arrival was not published");
  assert.equal(JSON.parse(posted()[0].body).image.alt, ALT);
});

// (4) The signalled arrival that could not carry its image. Three shapes of the
// same failure — nothing in the store, bytes that will not decode, and a payload
// over the publish limit — and all three owe the reader the same two routes.
for (const [label, record] of [
  ["a record that is not there", null],
  ["a payload that cannot be read", JSON.stringify({ createdAt: Date.now(), dataUrl: "not an image" })],
  ["a payload over the size limit", handoffRecord(Buffer.alloc(MAX_PUBLISH_IMAGE_BYTES + 1, 7))],
]) {
  test(`${label} opens the composer with no preview and names both ways on`, async (t) => {
    const { id } = await bootSocial(t, {
      ...FROM_PAINT, storage: record ? { [PAINT_HANDOFF_KEY]: record } : {},
    });
    const error = id("post-image-error");
    await waitFor(() => !error.hidden, "the failed arrival said nothing");

    // Never an empty frame with no explanation: the region that would hold the
    // preview is not on screen at all, and the origin line that would describe it
    // is empty.
    assert.equal(id("post-compose-panel").hidden, false, "the composer stayed closed on a failed arrival");
    assert.equal(id("compose-media").hidden, true, "a failed arrival showed a preview frame");
    assert.equal(id("compose-preview-image").getAttribute("src"), null);
    assert.equal(id("compose-media-origin").hidden, true);
    assert.equal(textOf(id("compose-media-origin")), "");

    // The message is visible, and it is words rather than a wash.
    assert.equal(error.getAttribute("role"), "alert");
    const said = textOf(error);
    assert.ok(said.includes(PAINT_ARRIVAL_ROUTES), `the two ways on were not offered: ${said}`);
    // Exactly two, each nameable: the picker on this device, and the route back.
    assert.match(said, /already on this device/);
    // Properties, not attributes: src/social-page.js builds this link by
    // assignment and the harness reflects neither back into markup.
    const back = error.querySelector("a");
    assert.equal(back.href, "/paint/");
    assert.equal(back.target, "_blank", "the route back must keep this tab's draft alive");
    assert.match(textOf(back), /Back to Paint/);
    assert.equal(error.querySelectorAll("a").length, 1, "the failure grew a third route");
  });
}

// (5) The no-draft sentence, on both halves of the arrival: said once when the
// tab really is empty, and not said at all when it is not.
test("an arrival into an empty tab says so, and an arrival into a draft does not", async (t) => {
  const { id } = await arrive(t);
  await waitFor(() => !id("compose-media").hidden, "the composer took the image from Paint");

  const panel = textOf(id("paint-arrival"));
  assert.ok(panel.includes(PAINT_ARRIVAL_NO_DRAFT), `an empty arriving tab said nothing about it: ${panel}`);
  assert.equal(panel.split(PAINT_ARRIVAL_NO_DRAFT).length - 1, 1, "the sentence was said twice");
  assert.equal(id("paint-arrival").querySelectorAll(".paint-arrival-note").length, 1);
  // One sentence, and it is about the tab rather than about the image, so it
  // follows the next step instead of interrupting it.
  assert.ok(panel.indexOf(PAINT_ARRIVAL_NO_DRAFT) > panel.indexOf("Next"),
    "the no-draft sentence came before the step it must not interrupt");
});

test("a tab that holds a draft is never told it has none", async (t) => {
  const { document, id, storage, dispatchStorage } = await bootSocial(t);
  id("post-compose-open").click();
  id("post-body").focus();
  typeText(document, DRAFT);

  storage.setItem(PAINT_HANDOFF_KEY, handoffRecord(PNG));
  dispatchStorage(PAINT_HANDOFF_KEY);
  await waitFor(() => !id("compose-media").hidden, "the open composer claimed the image");

  assert.equal(id("post-body").value, DRAFT, "the claim replaced the draft it was joining");
  assert.equal(textOf(id("compose-media-origin")), PAINT_ARRIVAL_PREVIEW_LINE);
  assert.equal(id("paint-arrival").querySelectorAll(".paint-arrival-note").length, 0,
    "a tab holding a draft was told it holds none");
  assert.equal(textOf(id("paint-arrival")).split(PAINT_ARRIVAL_NO_DRAFT).length - 1, 0);
});

// And it is an arrival sentence, not a composer-open sentence: pressing Write a
// post, or choosing a file with the picker, must not print either new line.
test("an ordinary composer open and an ordinary file choice print neither arrival line", async (t) => {
  const { document, id } = await bootSocial(t);
  id("post-compose-open").click();

  assert.equal(id("paint-arrival").hidden, true);
  assert.equal(textOf(id("paint-arrival")), "");
  assert.equal(id("compose-media-origin").hidden, true);

  const input = id("post-image");
  input.focus();
  input.files = [new File([PNG], "timeline.png", { type: "image/png" })];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
  await waitFor(() => !id("compose-media").hidden, "the composer took the chosen file");

  assert.equal(id("compose-media-origin").hidden, true, "a file chosen on this page was attributed to Paint");
  assert.equal(textOf(id("compose-media-origin")), "");
  assert.equal(textOf(id("paint-arrival")).split(PAINT_ARRIVAL_NO_DRAFT).length - 1, 0);
  // The chosen-file path keeps its own readiness line, which the arrival suppresses.
  assert.match(textOf(id("post-media-status")), /ready to describe and post/);
  assert.equal(document.activeElement?.id, "post-image", "choosing a file moved the caret");
});

// (6) The seam this issue is about. The composer's description of the Paint route
// and the sentence the arrival renders are one string: it is read here out of the
// page as served, out of the shared vocabulary both halves import, and out of the
// booted arrival, and all three must agree byte for byte.
test("the composer's Paint-route promise is the arrival's own sentence, byte for byte", async (t) => {
  const served = await readFile(new URL("../src/social.html", import.meta.url), "utf8");
  const { id } = await arrive(t);
  await waitFor(() => !id("compose-media").hidden, "the composer took the image from Paint");

  const promise = textOf(id("post-image-return"));
  assert.ok(promise.includes(PAINT_ARRIVAL_ORIGIN_LINE),
    `the route's description does not quote what the arrival renders: ${promise}`);
  // And what the arrival renders is that quoted sentence plus the step half,
  // joined by one space and nothing else — so a rewording of either end shows up
  // here rather than in a reader's disappointment.
  assert.equal(textOf(id("compose-media-origin")),
    `${PAINT_ARRIVAL_ORIGIN_LINE} ${PAINT_ARRIVAL_REQUIRED_STEP}`);
  assert.equal(textOf(id("compose-media-origin")), PAINT_ARRIVAL_PREVIEW_LINE);
  // In the page as served, so a curl contains the promise: it is standing help,
  // not something a script writes in after load.
  assert.match(served, /<p class="hint" id="post-image-return">/);
  assert.ok(
    served.replace(/<!--[\s\S]*?-->/g, "").includes(PAINT_ARRIVAL_ORIGIN_LINE),
    "the authored promise drifted from the sentence the arrival renders",
  );
  // It says what the visitor will see, not merely that something will happen.
  assert.match(promise, /opens with that image already in the preview/);
  // The step half is promised, not quoted: per #2294 this paragraph is reachable
  // before any image exists, and nothing reachable then may name that field.
  assert.doesNotMatch(promise, /image description/i,
    "the promise names the description field before there is an image it applies to");
  assert.match(promise, /step still required is named there/);
  // And it borrows neither the picker's label nor the file rule, both of which
  // the field states exactly once elsewhere.
  assert.equal(promise.split("Choose image").length - 1, 0);
  assert.equal(promise.split("512 KB").length - 1, 0);
});
