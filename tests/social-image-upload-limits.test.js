// What the Social composer says when a chosen file cannot be posted.
//
// Three refusals share one region — the composer's media status line — and they
// have to stay distinguishable, because each has a different next step:
//   1. the file is not one of the four accepted formats;
//   2. the file is over the stated maximum;
//   3. the file passed both checks and still produced no preview.
//
// The third is the one that was already here, and the first two are checked
// before a byte is read so they cannot be reported as it. That ordering is the
// point of this file: layered the other way, every rejected file would be told
// "we couldn't create a preview", which is true and tells nobody what to fix.
//
// Harness notes: the file input's `files` is set directly, because this harness
// accepts values a real control would refuse — so the page, not the browser,
// has to do the refusing, and that is exactly what is asserted. Assertions are
// on visible text, counts, and attribute values, never on element identity.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { UNSUPPORTED_TYPE_ERROR, overLimitError } from "../src/publishing-media.js";

const PAGE = fileURLToPath(new URL("../src/social.html", import.meta.url));

// The strings a visitor reads, written out rather than imported, so a silent
// rewording fails here instead of passing against itself.
const RECOVERY = "The invalid selection was cleared; no prior image remains selected. Convert or re-export it, then choose it again.";
const UNSUPPORTED_TYPE = `This file is not a PNG, JPEG, GIF, or WebP. ${RECOVERY}`;
const OVER_LIMIT = `This file is 513 KB; the maximum is 512 KB. ${RECOVERY}`;
const PREVIEW_FAILURE = "We couldn’t create an image preview. Select Remove image, then Choose image to try again.";

// The composer as it is served: real markup, real wiring, no network beyond the
// two responses the page's own start-up asks for.
async function openComposer(t) {
  const page = await loadPage(PAGE, {
    routes: {
      "/social-demo-data.json": { posts: [] },
      "/api/social-posts?limit=100": { posts: [] },
    },
  });
  // The feed polls on a timer. Nothing here depends on a refresh, and a live
  // interval would outlast the test, so the handles are collected and cleared.
  const timers = [];
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (...args) => {
    const handle = realSetInterval(...args);
    timers.push(handle);
    return handle;
  };
  await importPageModule("/social-page.js");
  await waitFor(
    () => page.document.documentElement.dataset.shiplogSocial === "ready",
    "the social page finished its first load",
  );
  globalThis.setInterval = realSetInterval;
  t.after(() => {
    for (const handle of timers) clearInterval(handle);
    page.restore();
  });
  return { document: page.document };
}

// Choose a file the way the visitor does — through the file input — and wait
// for the composer to say something about it.
async function choose(document, file) {
  const input = document.querySelector("#post-image");
  input.files = [file];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
  const status = document.querySelector("#post-media-status");
  await waitFor(
    () => textOf(status) && textOf(status) !== "Preparing image preview…",
    `the composer answered for ${file.name}`,
  );
  return status;
}

test("a file in an unaccepted format is named as such, with the four accepted formats", async (t) => {
  const { document } = await openComposer(t);

  const status = await choose(document, { name: "sunset.heic", type: "image/heic", size: 40_000 });

  assert.equal(textOf(status), UNSUPPORTED_TYPE);
  assert.ok(UNSUPPORTED_TYPE.startsWith(UNSUPPORTED_TYPE_ERROR));
  // Same region as the preview failure, marked as an error the same way.
  assert.equal(status.classList.contains("is-error"), true);
  assert.equal(document.querySelectorAll("#post-media-status").length, 1);
  assert.equal(document.querySelector("#post-media-status").getAttribute("role"), "status");
  // Nothing was attached, so the composer stays closed and the file input is
  // empty and ready for the next attempt.
  assert.equal(document.querySelector("#compose-media").hidden, true);
  assert.equal(document.querySelector("#post-image").value, "");
  assert.equal(document.querySelector("#post-submit").disabled, true);
  assert.equal(textOf(document.querySelector("#post-publish-blocker")),
    "Publishing is unavailable until you choose a supported image within 512 KB.");
  assert.equal(document.querySelectorAll("#post-media-status[aria-live]").length, 1);
  assert.equal(document.querySelector("#post-publish-blocker").getAttribute("aria-live"), null);
  assert.equal(document.querySelector("#post-image-steps").querySelector("a")?.getAttribute("href"), "/paint/");
});

test("a file over the limit is told the limit, in the words the field's help text uses", async (t) => {
  const { document } = await openComposer(t);

  const status = await choose(document, { name: "poster.png", type: "image/png", size: 512 * 1024 + 1 });

  assert.equal(textOf(status), OVER_LIMIT);
  assert.equal(overLimitError(512 * 1024 + 1), "This file is 513 KB; the maximum is 512 KB.");
  assert.equal(status.classList.contains("is-error"), true);
  assert.equal(document.querySelector("#compose-media").hidden, true);
  assert.equal(document.querySelector("#post-submit").disabled, true);
  assert.equal(textOf(document.querySelector("#post-publish-blocker")),
    "Publishing is unavailable until you choose a supported image within 512 KB.");
  assert.equal(document.querySelectorAll("#post-media-status[aria-live]").length, 1);
  assert.equal(document.querySelector("#post-image-steps").querySelector("a")?.getAttribute("href"), "/paint/");
});

// One rule, one wording. The help text beside the field and the two refusals
// state the limit and the format list with the same words, so a reader is never
// left comparing "512 KB maximum" with some other number's phrasing.
test("the help text and the refusals state the limit and the formats identically", async () => {
  const [markup, wiring, copy] = await Promise.all([
    readFile(new URL("../src/social.html", import.meta.url), "utf8"),
    readFile(new URL("../src/social-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/publishing-media.js", import.meta.url), "utf8"),
  ]);

  assert.ok(markup.includes('<p class="hint" id="post-image-hint">Social accepts PNG, JPEG, GIF, or WebP up to 512 KB. Reduce or re-export a larger image, then select Choose image.</p>'));
  assert.match(OVER_LIMIT, /maximum is 512 KB/);
  assert.ok(UNSUPPORTED_TYPE.includes("PNG, JPEG, GIF, or WebP"));
  // Every mention of the figure across the field, its wiring, and the refusals
  // is the same mention, so no second phrasing of the limit can drift in beside
  // it. The same for the format list, which the composer states three times.
  const source = `${markup}\n${wiring}\n${copy}`;
  const formats = source.match(/PNG,[^.·]*WebP/g) ?? [];
  assert.ok(formats.length >= 3, "the format list is stated beside the field and in both refusals");
  for (const mention of formats) assert.equal(mention, "PNG, JPEG, GIF, or WebP");
});

// One statement of the rule, in the field the reader is standing in. The
// formats and the size were stated twice a line apart — once in a clause hung
// off the Paint link by a semicolon, once as a summary line under it — so the
// field answered "what does this take?" twice, in two different shapes, before
// anyone had chosen a file. The refusals above still restate it, because they
// speak after a file has been chosen and have a different job.
test("the image field states the formats and the size exactly once, in plain sentences", async (t) => {
  const { document } = await openComposer(t);
  const steps = document.querySelector("#post-image-steps");
  const hint = document.querySelector("#post-image-hint");
  const help = `${textOf(steps)} ${textOf(hint)}`;

  assert.equal(help.split("512 KB").length - 1, 1, `the size is stated more than once: ${help}`);
  assert.equal(help.split("PNG, JPEG, GIF, or WebP").length - 1, 1,
    `the format list is stated more than once: ${help}`);
  // And nowhere else in the field either, including the summary line that used
  // to sit under the help text.
  assert.equal(textOf(document.querySelector(".media-picker")).split("512 KB").length - 1, 1);

  // The rule in one sentence, the fix in the next, and the fix names the
  // control by the label the control actually carries.
  assert.equal(textOf(hint),
    "Social accepts PNG, JPEG, GIF, or WebP up to 512 KB. Reduce or re-export a larger image, then select Choose image.");
  assert.equal(textOf(document.querySelector('label[for="post-image"]')), "Choose image");
  // No second phrasing of the same rule beside it, and no clause welding.
  assert.doesNotMatch(help, /\b(maximum|max|limit)\b/i);
  assert.doesNotMatch(help, /;/);

  // The Paint link is its own sentence and is otherwise untouched: same
  // destination, same new tab, still declared in the link's own text.
  assert.equal(textOf(steps), "Create an image in Paint (opens in a new tab) ↗.");
  const paint = steps.querySelector("a");
  assert.equal(paint.getAttribute("href"), "/paint/");
  assert.equal(paint.getAttribute("target"), "_blank");
  assert.equal(paint.getAttribute("rel"), "noopener");
  assert.match(textOf(paint), /\(opens in a new tab\)/);

  // Both lines are still there and still described, so nothing the file input
  // names has been left pointing at a node that no longer exists.
  assert.equal(document.querySelector("#post-image").getAttribute("aria-describedby"),
    "post-image-steps post-image-hint post-media-status");
  assert.equal(document.querySelectorAll("#post-image-hint").length, 1);
  assert.equal(document.querySelectorAll("#post-image-steps").length, 1);
});

// The rule behind the wording, stated once so no single label has to carry it:
// nothing the visitor chooses is sent until they publish, so no control, hint,
// heading, or refusal in the composer may call the act "upload". This reads the
// composer as served and as opened — the Paint arrival panel is empty here,
// which is the point: arriving from Paint, that panel says "uploaded nothing",
// and a negation is the one place the word still earns its keep.
test("nothing a visitor reads in the composer calls choosing a file uploading", async (t) => {
  const { document } = await openComposer(t);
  const panel = document.querySelector("#post-compose-panel");

  assert.doesNotMatch(textOf(panel), /upload/i);
  // Not shipped in the markup either, so the refusals and the chosen-image
  // region cannot reintroduce it once the wiring reveals them.
  assert.doesNotMatch(UNSUPPORTED_TYPE, /upload/i);
  assert.doesNotMatch(OVER_LIMIT, /upload/i);
  assert.doesNotMatch(PREVIEW_FAILURE, /upload/i);
  // And the region that names the chosen file names it as pending, not as sent.
  assert.equal(textOf(document.querySelector("#compose-media-source")), "Image to publish");
});

// The message that was already here still belongs to its own case: a file that
// passes both checks and then fails to decode.
test("the preview failure still speaks for a file that passes both checks", async (t) => {
  const { document } = await openComposer(t);
  const preview = document.querySelector("#compose-preview-image");
  const fallback = document.querySelector("#compose-preview-error");

  preview.dispatchEvent(new DomEvent("error", { bubbles: false }));

  assert.equal(textOf(document.querySelector("#post-media-status")), PREVIEW_FAILURE);
  // Written here on the error, not shipped in the markup and unhidden: the page
  // as served says nothing about a preview that has not failed.
  assert.equal(textOf(fallback), PREVIEW_FAILURE);
  assert.equal(fallback.hidden, false);
  assert.equal(preview.hidden, true);
  assert.equal(document.querySelector("#compose-preview-frame").dataset.state, "error");
});
