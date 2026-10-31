import test from "node:test";
import assert from "node:assert/strict";
import { bootSocial } from "./support/social-paint-arrival.js";
import { DomEvent, textOf, tabSequence } from "./support/browser.js";
import { waitFor } from "./support/page-module.js";

const file = (name = "draft.png") => new File([Buffer.from([137,80,78,71,13,10,26,10])], name, { type: "image/png" });
function choose(id, value = file()) {
  id("post-image").files = [value];
  id("post-image").dispatchEvent(new DomEvent("change", { bubbles: true }));
}
const fire = (image, type) => image.dispatchEvent(new DomEvent(type));

test("loading, decoded, failure and removal keep status and keyboard actions associated", async (t) => {
  const { id, document } = await bootSocial(t, { autoImageLoad: false });
  id("post-compose-open").click();
  choose(id);
  assert.equal(id("compose-media").hidden, false);
  assert.match(textOf(id("post-media-status")), /Preparing/);
  assert.equal(id("compose-media").getAttribute("role"), "group");
  assert.equal(id("compose-media").getAttribute("aria-labelledby"), "compose-media-source");
  assert.match(id("compose-media").getAttribute("aria-describedby"), /post-media-status/);
  assert.match(id("remove-image").getAttribute("aria-describedby"), /post-media-status/);
  assert.ok(tabSequence(document).includes(id("remove-image")));
  assert.ok(tabSequence(document).includes(id("post-image-alt")));
  assert.equal(id("post-submit").disabled, true);
  await waitFor(() => Boolean(id("compose-preview-image").src), "bytes read");
  fire(id("compose-preview-image"), "load");
  assert.equal(id("compose-preview-frame").dataset.state, "ready");
  assert.match(textOf(id("post-media-status")), /Image ready/);
  assert.equal(id("post-submit").disabled, false);
  fire(id("compose-preview-image"), "error");
  assert.equal(id("compose-preview-frame").dataset.state, "error");
  assert.match(textOf(id("compose-preview-error")), /Remove image.*Choose image/);
  assert.equal(id("post-submit").disabled, true);
  fire(id("compose-preview-image"), "load");
  assert.equal(id("compose-preview-frame").dataset.state, "error");
  id("remove-image").click();
  assert.equal(id("compose-preview-frame").dataset.state, "removed");
  assert.match(textOf(id("post-media-status")), /Image removed/);
  assert.equal(document.activeElement.id, "post-image");
  assert.equal(id("post-submit").disabled, false);
});

test("late preview events cannot change a removed or replacement draft", async (t) => {
  const { id } = await bootSocial(t, { autoImageLoad: false });
  choose(id);
  await waitFor(() => Boolean(id("compose-preview-image").src), "first image");
  const old = id("compose-preview-image");
  id("remove-image").click();
  for (const event of ["load", "error"]) fire(old, event);
  assert.equal(id("compose-preview-frame").dataset.state, "removed");
  assert.match(textOf(id("post-media-status")), /Image removed/);
  choose(id, file("replacement.png"));
  await waitFor(() => id("compose-preview-image") !== old, "replacement image");
  for (const event of ["load", "error"]) fire(old, event);
  assert.equal(id("compose-preview-frame").dataset.state, "loading");
  fire(id("compose-preview-image"), "load");
  assert.equal(id("compose-preview-frame").dataset.state, "ready");
});

test("removal or replacement while bitmap decoding is pending invalidates the result", async (t) => {
  const { id } = await bootSocial(t, { autoImageLoad: false });
  const pending = [];
  globalThis.createImageBitmap = () => new Promise(resolve => pending.push(resolve));
  choose(id);
  await waitFor(() => pending.length === 1, "first decode");
  id("remove-image").click();
  pending.shift()({ width: 10, height: 100 });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(id("compose-media").hidden, true);
  choose(id);
  await waitFor(() => pending.length === 1, "second decode");
  choose(id, file("new.png"));
  await waitFor(() => pending.length === 2, "third decode");
  pending[1]({ width: 100, height: 10 });
  await waitFor(() => Boolean(id("compose-preview-image").src), "new image");
  const current = id("compose-preview-image");
  pending[0]({ width: 10, height: 100 });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(id("compose-preview-image") === current, true);
  assert.match(textOf(id("compose-preview-caption")), /100 × 10/);
});

test("animated GIF bytes remain the preview source without flattening", async (t) => {
  const { id } = await bootSocial(t, { autoImageLoad: false });
  // Two frames with different palette indices, plus the looping extension.
  const bytes = Buffer.from(
    '47494638396101000100800000000000ffffff' +
    '21ff0b4e45545343415045322e300301000000' +
    '21f904000a0000002c0000000001000100000202440100' +
    '21f904000a0000002c00000000010001000002024c01003b', 'hex');
  choose(id, new File([bytes], 'animated.gif', { type: 'image/gif' }));
  await waitFor(() => Boolean(id('compose-preview-image').src), 'GIF source');
  assert.equal(id('compose-preview-image').src, `data:image/gif;base64,${bytes.toString('base64')}`);
  fire(id('compose-preview-image'), 'load');
  assert.equal(id('compose-preview-frame').dataset.state, 'ready');
});

test("bitmap decode failure keeps a removable, explained draft", async (t) => {
  const { id } = await bootSocial(t, { autoImageLoad: false });
  globalThis.createImageBitmap = async () => { throw new Error('decoder rejected bytes'); };
  choose(id);
  await waitFor(() => id('compose-preview-frame').dataset.state === 'error', 'decode failure');
  assert.equal(id('compose-media').hidden, false);
  assert.match(textOf(id('post-media-status')), /Remove image.*Choose image/);
  assert.equal(id('post-submit').disabled, true);
  id('remove-image').click();
  assert.equal(id('compose-media').hidden, true);
  assert.equal(id('post-submit').disabled, false);
});

test("a refused replacement cannot unblock an undecoded or failed image", async (t) => {
  const { id } = await bootSocial(t, { autoImageLoad: false });
  choose(id);
  await waitFor(() => Boolean(id('compose-preview-image').src), 'image pending');
  choose(id, new File(['text'], 'notes.txt', { type: 'text/plain' }));
  assert.equal(id('post-submit').disabled, true);
  assert.match(textOf(id('post-media-status')), /Preparing/);
  fire(id('compose-preview-image'), 'error');
  choose(id, new File(['text'], 'notes.txt', { type: 'text/plain' }));
  assert.equal(id('post-submit').disabled, true);
  assert.match(textOf(id('post-media-status')), /Remove image/);
});
