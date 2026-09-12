// The route from a finished Paint image to a Social post, end to end.
//
// The gap this covers: Paint could export a PNG and then say nothing, so the
// only way on was to know that Social existed and that the file had to be
// attached by hand. The handoff is now an explicit card the editor reveals
// after the work exists, and the destination repeats the same promise —
// Paint uploads nothing — instead of leaving a reader to infer it from an
// empty file field.
//
// Everything here is behaviour a keyboard user feels: which control focus lands
// on, where the link goes, what the destination says, and what it says when the
// arrival did not come from Paint at all.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initEditor } from "../src/paint/paint.js";
import {
  EXPORT_FILE_NAME,
  PAINT_HANDOFF_COPY,
  paintHandoffHref,
  paintHandoffIntent,
  renderPaintArrival,
} from "../src/paint-handoff.js";
import { PAINT_HANDOFF_KEY, PAINT_HANDOFF_STORAGE_ERROR } from "../src/publishing-media.js";
import { createPaintHarness } from "./support/paint-editor.js";
import { byClass, createElement, installDocument } from "./support/dom.js";

installDocument();

const read = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

function editorHarness(environment = {}) {
  const paint = createPaintHarness({ exportBlob: new Blob(["png"], { type: "image/png" }) });
  const stored = new Map();
  paint.navigations = [];
  Object.assign(paint.environment, {
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: (key) => stored.delete(key),
    },
    location: { assign: (href) => paint.navigations.push(href) },
    // The window an open Social composer has to claim the image, passed at
    // once: nothing here waits in real time.
    setTimeout: (resolve) => resolve(),
  }, environment);
  paint.stored = stored;
  paint.editor = initEditor(paint.root, paint.environment);
  return paint;
}

const control = (paint, id) => paint.selectors.get(id);

async function settle() {
  for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

test("the handoff link routes to the Social composer and carries which kind of handoff it is", () => {
  assert.equal(paintHandoffHref("exported"), "/social.html?from=paint&image=exported#post-form");
  assert.equal(paintHandoffHref("prepared"), "/social.html?from=paint&image=prepared#post-form");
  // Same origin, relative, and fully determined by the kind: an unrecognised
  // kind falls back to the exported route rather than becoming a destination.
  assert.equal(paintHandoffHref("javascript:alert(1)"), "/social.html?from=paint&image=exported#post-form");
  assert.equal(paintHandoffHref(undefined), "/social.html?from=paint&image=exported#post-form");
});

test("the destination recognises a Paint arrival and ignores anything else", () => {
  assert.equal(paintHandoffIntent("?from=paint&image=exported"), PAINT_HANDOFF_COPY.exported);
  assert.equal(paintHandoffIntent("from=paint&image=prepared"), PAINT_HANDOFF_COPY.prepared);
  assert.equal(paintHandoffIntent("?from=paint"), null);
  assert.equal(paintHandoffIntent("?from=paint&image=constructor"), null);
  assert.equal(paintHandoffIntent("?from=profile&image=exported"), null);
  assert.equal(paintHandoffIntent(""), null);
  assert.equal(paintHandoffIntent(), null);
});

test("exporting a PNG reveals a labelled handoff and puts focus on the way out", async () => {
  const paint = editorHarness();
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:paint-handoff-test";
  URL.revokeObjectURL = () => {};
  try {
    assert.equal(control(paint, "#paint-handoff").hidden, true, "the card must not exist before the work does");
    await control(paint, "#export-button").dispatch("click");
    await settle();
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }

  const card = control(paint, "#paint-handoff");
  assert.equal(card.hidden, false);
  assert.equal(card.dataset.handoff, "exported");
  assert.equal(control(paint, "#paint-handoff-link").href, paintHandoffHref("exported"));
  assert.equal(control(paint, "#paint-handoff-action-label").textContent, "Add it to a post on Social");
  // The card is where the reader is now, so it is where focus is. Without this
  // a keyboard user would have to walk back through the header to find it.
  assert.equal(control(paint, "#paint-handoff-link").focused, true);
  // It says what happened to the file and what did not happen to it.
  assert.match(control(paint, "#paint-handoff-detail").textContent, /uploaded nothing/i);
  assert.match(control(paint, "#paint-handoff-detail").textContent, new RegExp(EXPORT_FILE_NAME));
  assert.equal(paint.exports.length, 1, "the file itself still downloads");
  assert.deepEqual(paint.navigations, [], "exporting left the editor on its own");
});

test("dismissing the handoff returns focus to the control that opened it", async () => {
  const paint = editorHarness();
  const originalCreate = URL.createObjectURL;
  URL.createObjectURL = () => "blob:paint-handoff-test";
  try {
    await control(paint, "#export-button").dispatch("click");
    await settle();
  } finally {
    URL.createObjectURL = originalCreate;
  }

  control(paint, "#export-button").focused = false;
  await control(paint, "#paint-handoff-dismiss").dispatch("click");
  assert.equal(control(paint, "#paint-handoff").hidden, true);
  assert.equal(control(paint, "#export-button").focused, true, "focus must not be dropped on the document");
});

// #2298: “Use this image in a Social post” (#publish-button) is one press. It
// leaves the PNG Export PNG would download in storage for the composer, and
// either an open composer claims it or Paint opens Social itself.
test("the Social post action is enabled exactly when Export PNG is", () => {
  const paint = editorHarness();
  assert.equal(control(paint, "#export-button").disabled, false);
  assert.equal(control(paint, "#publish-button").disabled, false);

  // The one state that takes Export PNG away takes this action with it.
  const blind = createPaintHarness();
  blind.canvas.getContext = () => null;
  assert.equal(initEditor(blind.root, blind.environment), null);
  assert.equal(blind.selectors.get("#export-button").disabled, true);
  assert.equal(blind.selectors.get("#publish-button").disabled, true);
});

test("sending the image leaves the exported PNG for Social and opens the composer", async () => {
  const paint = editorHarness();
  await control(paint, "#publish-button").dispatch("click");
  await settle();

  assert.deepEqual(paint.navigations, [paintHandoffHref("prepared")]);
  const record = JSON.parse(paint.stored.get(PAINT_HANDOFF_KEY));
  assert.equal(record.dataUrl, `data:image/png;base64,${Buffer.from("png").toString("base64")}`);
  assert.equal(record.type, "image/png");
  assert.equal(record.name, EXPORT_FILE_NAME);
  assert.equal(paint.exports.length, 0, "the action downloaded a file as well");
  assert.equal(control(paint, "#paint-handoff").hidden, true, "the action asked for a second press");
  assert.equal(control(paint, "#publish-button").disabled, false);
});

test("an open Social composer that claims the image keeps the visitor in Paint, told where it went", async () => {
  const paint = editorHarness({
    setTimeout: (resolve) => {
      paint.stored.delete(PAINT_HANDOFF_KEY);
      resolve();
    },
  });
  await control(paint, "#publish-button").dispatch("click");
  await settle();

  assert.deepEqual(paint.navigations, [], "Paint opened a second Social beside the one that took the image");
  assert.match(control(paint, "#publish-status").textContent, /Switch to that tab/);
});

test("a store that will not hold the image keeps the visitor in Paint and says why", async () => {
  const paint = editorHarness({
    localStorage: {
      getItem: () => null,
      setItem() { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); },
    },
  });
  await control(paint, "#publish-button").dispatch("click");
  await settle();

  assert.deepEqual(paint.navigations, []);
  assert.equal(control(paint, "#publish-status").textContent, PAINT_HANDOFF_STORAGE_ERROR);
  assert.equal(control(paint, "#publish-button").disabled, false);
});

test("the editor markup ships the handoff hidden, labelled, and keyboard-operable", async () => {
  const html = await read("paint/index.html");
  assert.match(html, /<section class="paint-handoff" id="paint-handoff" aria-labelledby="paint-handoff-title" hidden>/);
  assert.match(html, /id="paint-handoff-link" href="\/social\.html\?from=paint&amp;image=exported#post-form"/);
  assert.match(html, /<button class="secondary-action paint-handoff-dismiss" id="paint-handoff-dismiss" type="button">Keep editing<\/button>/);
  // A link and a button: both are in the tab order and both activate with the
  // keys the browser already promises. Nothing here is a click-only div.
  assert.doesNotMatch(html, /<div[^>]*id="paint-handoff-link"/);

  const css = await read("paint/paint.css");
  assert.match(css, /\.paint-handoff \{[^}]*position: fixed/);
  // State is told by a shape as well as a wash, so the two kinds are not
  // distinguished by colour alone.
  assert.match(css, /\.paint-handoff\[data-handoff="prepared"\] \.paint-handoff-shape \{/);
  assert.match(css, /button:focus-visible, input:focus-visible, select:focus-visible, \[tabindex\]:focus-visible, a:focus-visible \{ outline: 3px solid var\(--focus\)/);
});

test("the composer explains an exported file was not uploaded and names the next step", () => {
  const panel = createElement("div");
  const rendered = renderPaintArrival(panel, paintHandoffIntent("?from=paint&image=exported"));

  assert.equal(rendered, panel);
  assert.equal(panel.hidden, false);
  assert.equal(panel.dataset.handoff, "exported");
  assert.match(panel.textContent, /uploaded nothing/i);
  assert.match(panel.textContent, /Nothing is attached to this post yet/i);
  assert.match(byClass(panel, "paint-arrival-next")[0].textContent, /Choose image/);
  assert.match(panel.textContent, new RegExp(EXPORT_FILE_NAME));
  assert.equal(byClass(panel, "paint-arrival-shape").length, 1, "the chip carries a shape, not only a colour");
});

test("the composer distinguishes a prepared drawing: attached to the draft, still not published", () => {
  const panel = createElement("div");
  renderPaintArrival(panel, paintHandoffIntent("?from=paint&image=prepared"));

  assert.equal(panel.dataset.handoff, "prepared");
  assert.match(panel.textContent, /has not been uploaded or published/i);
  assert.match(byClass(panel, "paint-arrival-next")[0].textContent, /publish the post/i);
});

test("an ordinary visit to Social shows no arrival panel at all", () => {
  const panel = createElement("div");
  renderPaintArrival(panel, paintHandoffIntent("?from=paint&image=prepared"));
  const cleared = renderPaintArrival(panel, paintHandoffIntent(""));

  assert.equal(cleared, null);
  assert.equal(panel.hidden, true);
  assert.equal(panel.textContent, "");
  assert.equal(panel.dataset.handoff, undefined, "a stale kind must not survive on the panel");
});

test("Social ships the arrival region and wires it to the query the handoff sends", async () => {
  const html = await read("social.html");
  // role="status" so the explanation is announced when it appears, tabindex="-1"
  // so the arrival can move focus onto it without adding a tab stop for every
  // other visitor.
  assert.match(html, /<div class="paint-arrival" id="paint-arrival" role="status" tabindex="-1" hidden><\/div>/);
  assert.ok(
    html.indexOf('id="paint-arrival"') < html.indexOf('id="post-form"'),
    "the explanation must precede the form it is about",
  );

  const wiring = await read("social-page.js");
  assert.match(wiring, /const arrivalPanel = root\.querySelector\("#paint-arrival"\);/);
  assert.match(wiring, /renderPaintArrival\(arrivalPanel, intent\)\?\.focus\?\.\(\)/);

  const css = await read("styles.css");
  assert.match(css, /\.paint-arrival:focus-visible \{ outline:3px solid var\(--focus-ring\)/);
  assert.match(css, /\.paint-arrival\[data-handoff="prepared"\] \.paint-arrival-shape \{/);
});
