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
import { OVER_LIMIT_ERROR, UNSUPPORTED_TYPE_ERROR } from "../src/publishing-media.js";

const PAGE = fileURLToPath(new URL("../src/social.html", import.meta.url));

// The strings a visitor reads, written out rather than imported, so a silent
// rewording fails here instead of passing against itself.
const UNSUPPORTED_TYPE = "This file is not a PNG, JPEG, GIF, or WebP. Convert or re-export it in one of those formats, then choose it again.";
const OVER_LIMIT = "This file is over the 512 KB maximum. Pick a smaller file, or export a smaller PNG from Paint.";
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
  assert.equal(UNSUPPORTED_TYPE_ERROR, UNSUPPORTED_TYPE);
  // Same region as the preview failure, marked as an error the same way.
  assert.equal(status.classList.contains("is-error"), true);
  assert.equal(document.querySelectorAll("#post-media-status").length, 1);
  assert.equal(document.querySelector("#post-media-status").getAttribute("role"), "status");
  // Nothing was attached, so the composer stays closed and the file input is
  // empty and ready for the next attempt.
  assert.equal(document.querySelector("#compose-media").hidden, true);
  assert.equal(document.querySelector("#post-image").value, "");
});

test("a file over the limit is told the limit, in the words the field's help text uses", async (t) => {
  const { document } = await openComposer(t);

  const status = await choose(document, { name: "poster.png", type: "image/png", size: 512 * 1024 + 1 });

  assert.equal(textOf(status), OVER_LIMIT);
  assert.equal(OVER_LIMIT_ERROR, OVER_LIMIT);
  assert.equal(status.classList.contains("is-error"), true);
  assert.equal(document.querySelector("#compose-media").hidden, true);
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

  assert.ok(markup.includes('<p class="hint" id="post-image-hint">PNG, JPEG, GIF, or WebP · 512 KB maximum.</p>'));
  assert.ok(OVER_LIMIT.includes("512 KB maximum"));
  assert.ok(UNSUPPORTED_TYPE.includes("PNG, JPEG, GIF, or WebP"));
  // Every mention of the figure across the field, its wiring, and the refusals
  // is the same mention, so no second phrasing of the limit can drift in beside
  // it. The same for the format list, which the composer states three times.
  const source = `${markup}\n${wiring}\n${copy}`;
  const limits = source.match(/512\s*KB\s*[a-z]*/gi) ?? [];
  assert.ok(limits.length >= 3, "the limit is stated beside the field and in both refusals");
  for (const mention of limits) assert.equal(mention, "512 KB maximum");
  const formats = source.match(/PNG,[^.·]*WebP/g) ?? [];
  assert.ok(formats.length >= 3, "the format list is stated beside the field and in both refusals");
  for (const mention of formats) assert.equal(mention, "PNG, JPEG, GIF, or WebP");
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
