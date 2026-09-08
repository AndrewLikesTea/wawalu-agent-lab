import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mountSocialFeed } from "../src/social.js";
import { loadPage, pressKey, pressTab, tabSequence, textOf } from "./support/browser.js";

async function setup(t, options = {}) {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const feed = mountSocialFeed(page.document, {
    posts: [], state: "ready", storage: page.storage, ...options,
  });
  const id = (name) => page.document.querySelector(`#${name}`);
  return { ...page, feed, id };
}

test("keyboard activation names and expands the composer, focuses its required field, and Escape returns to origin", async (t) => {
  const { document, id } = await setup(t);
  const trigger = id("post-compose-open");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(trigger.getAttribute("aria-controls"), "post-compose-panel");
  assert.equal(tabSequence(document).includes(id("post-body")), false);
  trigger.focus();
  pressKey(document, "Enter");
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement, id("post-body"));
  // The name is on the <form> landmark and on nothing else. A second element
  // around it carrying the same name — the panel, as a role="region" — is two
  // nested landmarks both called "Publish a post", so opening the composer
  // announces the name twice on a page Iris already flagged for having several
  // similarly named publish controls. The <form> is the native landmark and it
  // is the thing with controls in it, so it is the one that keeps the name.
  assert.equal(textOf(id(id("post-form").getAttribute("aria-labelledby"))), "Publish a post");
  assert.ok(!id("post-compose-panel").getAttribute("role"), "the panel must not be a second landmark with the form's name");
  assert.notEqual(textOf(trigger), textOf(id("post-submit")));
  assert.equal(pressTab(document), id("post-image"));
  pressKey(document, "Escape");
  assert.equal(id("post-compose-panel").hidden, true);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, trigger);
});

test("closing a dirty draft preserves every field and returns to the actual opener", async (t) => {
  const { document, feed, id } = await setup(t);
  const origin = document.createElement("button");
  document.body.append(origin);
  origin.focus();
  feed.composer.open();
  for (const name of ["post-body", "post-author", "post-image-alt"]) id(name).value = `Draft ${name}`;
  pressKey(document, "Escape");
  assert.equal(document.activeElement, origin);
  feed.composer.open({ opener: origin });
  for (const name of ["post-body", "post-author", "post-image-alt"]) assert.equal(id(name).value, `Draft ${name}`);
  id("post-compose-cancel").click();
  assert.equal(document.activeElement, origin);
  assert.match(textOf(id("post-keyboard-hint")), /keeps your draft in this tab/);
});

test("Escape and other close paths cannot hide an active submission, including a failed request", async (t) => {
  let reject;
  const pending = new Promise((_, fail) => { reject = fail; });
  const { document, feed, id } = await setup(t, { create: () => pending });
  id("post-compose-open").click();
  id("post-body").value = "Keep this draft";
  id("post-submit").click();
  assert.equal(id("post-submit").getAttribute("aria-busy"), "true");
  assert.equal(id("post-compose-cancel").disabled, true);
  id("post-body").focus();
  pressKey(document, "Escape");
  feed.composer.close();
  id("post-compose-open").click();
  assert.equal(feed.composer.isOpen, true);
  assert.equal(id("post-compose-open").getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement, id("post-body"));
  reject(new Error("Offline"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(id("post-compose-cancel").disabled, false);
  assert.equal(id("post-body").value, "Keep this draft");
  // Where the reader is standing when the request comes back. Pressing Publish
  // disables the button under their own focus, so a real browser has already
  // dropped them on <body> — outside the panel, where Escape is not bound and
  // Tab restarts at the top of the document. Both outcomes now end on this one
  // region: success for its receipt, failure for its Retry.
  assert.equal(document.activeElement, id("social-notice"));
  assert.equal(id("social-notice").getAttribute("tabindex"), "-1");
  id("post-body").focus();
  pressKey(document, "Escape");
  assert.equal(feed.composer.isOpen, false);
});

test("composer tab order follows its fields and actions without positive tabindex", async (t) => {
  const { document, id } = await setup(t);
  id("post-compose-open").click();
  id("compose-media").hidden = false;
  // Filtered by where a stop *is*, not by a list of names the test already
  // knows. Filtering the sequence through `expected.includes` would let a
  // control added to the composer tomorrow sit anywhere in the order — or
  // nowhere in it — and still leave this green, which is the shape of check
  // that reports coverage it does not have.
  const panel = id("post-compose-panel");
  const inPanel = (node) => { for (let n = node; n; n = n.parentNode) if (n === panel) return true; return false; };
  // Keyed by id where there is one and by class where there is not. The Paint
  // link is the stop the name-list version of this check was silently dropping:
  // it is the only composer control without an id, it leaves the site, and it
  // sits in the middle of the image steps — which is exactly the kind of stop a
  // reading-order test exists to hold in place rather than skip.
  const stops = tabSequence(document).filter(inPanel).map((node) => node.id || node.getAttribute("class"));
  assert.deepEqual(stops, [
    "post-body", "post-image", "secondary-button paint-link", "remove-image",
    "post-image-alt", "post-author", "post-submit", "post-compose-cancel",
  ]);
  for (const node of document.querySelectorAll("[tabindex]")) assert.ok(Number(node.getAttribute("tabindex")) <= 0);
});

test("composer style contracts allow narrow content to wrap and retain shared focus outlines", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const composerCss = await readFile(new URL("../src/social-composer.css", import.meta.url), "utf8");
  const html = await readFile(new URL("../src/social.html", import.meta.url), "utf8");
  assert.match(html, /href="\/social-composer.css"/);
  assert.match(composerCss, /#post-compose-panel, #post-form, #post-form \.field\s*\{ min-width:0;/);
  assert.match(composerCss, /#post-compose-panel\s*\{ overflow-wrap:anywhere;/);
  assert.match(composerCss, /#post-form \.secondary-button\s*\{ max-width:100%; flex-wrap:wrap;/);
  assert.match(composerCss, /#post-form \.new-tab-note\s*\{ white-space:normal;/);
  assert.match(css, /input:focus-visible[^{}]+\{ outline:3px solid var\(--focus-ring\); outline-offset:2px;/);
  assert.match(css, /\.file-button:has\(input:focus-visible\)\s*\{ outline:3px solid var\(--focus-ring\)/);
  // The two numbers this file invents, each pinned to the shipped value it was
  // read off. 24px is the scroll-margin styles.css already uses; line-height 1.4
  // exists only because the shared button rule ships a line-height of 1, which
  // overlaps the moment white-space:normal lets a label wrap. If either shipped
  // value moves, the override stops being justified and this fails rather than
  // quietly becoming a magic number nobody can explain.
  assert.match(composerCss, /#post-form input, #post-form textarea, #post-form button \{ scroll-margin-block:24px;/);
  assert.match(css, /scroll-margin-top:24px;/);
  assert.match(composerCss, /#post-form button \{ white-space:normal; line-height:1\.4; padding-block:12px;/);
  assert.match(css, /^button \{[^{}]*min-height:46px;[^{}]*font:700 14px\/1 /m);
});
