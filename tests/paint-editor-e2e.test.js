import test from "node:test";
import assert from "node:assert/strict";
import { initEditor } from "../src/paint/paint.js";
import { MAX_BITMAP_BYTES } from "../src/paint/paint-engine.js";
import { createPaintHarness, imageFile } from "./support/paint-editor.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("empty account: a first-time user sees a rendered blank canvas and every core control", () => {
  const harness = createPaintHarness();
  const editor = initEditor(harness.root, harness.environment);

  assert.ok(editor, "the editor must remain usable without stored account data");
  assert.equal(editor.document.width, 1200);
  assert.equal(editor.document.height, 800);
  assert.equal(harness.uploads.length, 1, "the initial canvas must reach WebGL");
  assert.deepEqual(
    ["#export-button", "#file-input", "#clear-button", "#resize-button"]
      .map((selector) => Boolean(harness.root.querySelector(selector))),
    [true, true, true, true],
  );
  assert.match(harness.status.textContent, /^WebGL · \d+\.\d ms$/);
  assert.equal(harness.viewport.getAttribute("aria-label"), "Image canvas, 1200 by 800 pixels");
});

test("core canvas flow: drawing updates pixels, save state, and the visible WebGL texture", async () => {
  const harness = createPaintHarness();
  const editor = initEditor(harness.root, harness.environment);
  const initialRevision = editor.document.revision;

  await harness.canvas.dispatch("pointerdown", { pointerId: 7, clientX: 100, clientY: 100 });
  await harness.canvas.dispatch("pointermove", { pointerId: 7, clientX: 160, clientY: 100 });
  await harness.canvas.dispatch("pointerup", { pointerId: 7, clientX: 160, clientY: 100 });

  assert.ok(editor.document.revision > initialRevision);
  assert.notDeepEqual(editor.document.pixel(100, 100), [255, 255, 255, 255]);
  assert.equal(harness.selectors.get("#save-state").textContent, "Edited locally");
  assert.equal(harness.uploads.at(-1).pixels[0], editor.document.pixels[0]);
  assert.equal(harness.selectors.get("#drop-prompt").hidden, true);
});

test("drag-and-drop import: a user gets the decoded image dimensions without a network request", async () => {
  const harness = createPaintHarness();
  const editor = initEditor(harness.root, harness.environment);
  const file = imageFile(4, 3, { fill: 64 });

  const drag = await harness.viewport.dispatch("dragover");
  assert.equal(drag.defaultPrevented, true);
  assert.equal(harness.viewport.classList.contains("is-dragging"), true);
  await harness.viewport.dispatch("drop", { dataTransfer: { files: [file] } });
  await settle();

  assert.equal(editor.document.width, 4);
  assert.equal(editor.document.height, 3);
  assert.equal(editor.document.pixel(0, 0)[0], 64);
  assert.equal(harness.selectors.get("#document-width").textContent, "4 px");
  assert.equal(harness.selectors.get("#document-height").textContent, "3 px");
  assert.equal(harness.selectors.get("#save-state").textContent, "Imported locally");
  assert.equal(harness.viewport.classList.contains("is-dragging"), false);
});

test("slow imports: the latest dropped image wins when an earlier decode finishes late", async () => {
  const pending = new Map();
  const harness = createPaintHarness({
    createImageBitmap(file) {
      return new Promise((resolve) => pending.set(file.name, () =>
        resolve({ width: file.width, height: file.height, fill: file.fill, close() {} })));
    },
  });
  const editor = initEditor(harness.root, harness.environment);
  const slow = imageFile(8, 6, { name: "slow.png", fill: 20 });
  const latest = imageFile(3, 2, { name: "latest.png", fill: 220 });

  await harness.viewport.dispatch("drop", { dataTransfer: { files: [slow] } });
  assert.equal(editor.document.width, 1200, "work must remain visible while decoding");
  await harness.viewport.dispatch("drop", { dataTransfer: { files: [latest] } });
  pending.get("latest.png")();
  await settle();
  assert.equal(editor.document.width, 3);
  pending.get("slow.png")();
  await settle();

  assert.equal(editor.document.width, 3, "a stale decode must not overwrite the latest user action");
  assert.equal(editor.document.height, 2);
  assert.equal(editor.document.pixel(0, 0)[0], 220);
});

test("large import: an oversized image is reduced proportionally instead of exhausting the tab", async () => {
  const harness = createPaintHarness();
  const editor = initEditor(harness.root, harness.environment);

  await harness.viewport.dispatch("drop", {
    dataTransfer: { files: [imageFile(12000, 8000)] },
  });
  await settle();

  assert.ok(editor.document.width * editor.document.height * 4 <= MAX_BITMAP_BYTES);
  assert.ok(Math.abs(editor.document.width / editor.document.height - 1.5) < 0.001);
  assert.equal(harness.selectors.get("#save-state").textContent, "Imported at reduced resolution");
});

test("failed import: an unsupported drop explains the problem and preserves the current work", async () => {
  const harness = createPaintHarness();
  const editor = initEditor(harness.root, harness.environment);
  await harness.canvas.dispatch("pointerdown", { pointerId: 1, clientX: 20, clientY: 20 });
  await harness.canvas.dispatch("pointerup", { pointerId: 1, clientX: 20, clientY: 20 });
  const before = editor.document;

  await harness.viewport.dispatch("drop", {
    dataTransfer: { files: [imageFile(1, 1, { name: "notes.txt", type: "text/plain" })] },
  });
  await settle();

  assert.equal(editor.document, before);
  assert.equal(harness.status.textContent, "Choose a supported image file");
  assert.equal(harness.selectors.get("#save-state").textContent, "Edited locally");
});

test("interrupted action: cancelling a shape drag never leaves an accidental edit", async () => {
  const harness = createPaintHarness();
  const editor = initEditor(harness.root, harness.environment);
  const rectangle = harness.tools.find((tool) => tool.dataset.tool === "rectangle");
  await rectangle.dispatch("click");
  const before = new Uint8ClampedArray(editor.document.pixels);

  await harness.canvas.dispatch("pointerdown", { pointerId: 4, clientX: 10, clientY: 10 });
  await harness.canvas.dispatch("pointermove", { pointerId: 4, clientX: 200, clientY: 100 });
  await harness.canvas.dispatch("pointercancel", { pointerId: 4 });
  await harness.canvas.dispatch("pointerup", { pointerId: 4, clientX: 200, clientY: 100 });

  assert.deepEqual(editor.document.pixels, before);
  assert.equal(harness.selectors.get("#save-state").textContent, "Saved locally");
});

test("export flow: the current edited bitmap downloads once as a named PNG", async (context) => {
  const harness = createPaintHarness();
  const editor = initEditor(harness.root, harness.environment);
  await harness.canvas.dispatch("pointerdown", { pointerId: 2, clientX: 30, clientY: 30 });
  await harness.canvas.dispatch("pointerup", { pointerId: 2, clientX: 30, clientY: 30 });
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const revoked = [];
  URL.createObjectURL = (blob) => {
    assert.equal(blob.type, "image/png");
    return "blob:test-export";
  };
  URL.revokeObjectURL = (url) => revoked.push(url);
  context.after(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  await harness.selectors.get("#export-button").dispatch("click");
  await settle();

  assert.deepEqual(harness.exports, [{ download: "paint-export.png", href: "blob:test-export" }]);
  assert.deepEqual(revoked, ["blob:test-export"]);
  assert.equal(editor.document.pixel(30, 30)[3], 255);
});
