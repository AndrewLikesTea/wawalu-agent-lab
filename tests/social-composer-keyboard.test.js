import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PUBLISH_REASON_ID, mountSocialFeed } from "../src/social.js";
import { DomEvent, loadPage, pressKey, pressTab, tabSequence, textOf } from "./support/browser.js";

// Harness note: every assertion here compares strings, numbers or booleans. A
// failing assertion with a parsed element as an operand spends minutes
// inspecting the whole page and outlives --test-timeout, so elements are named
// by id or class before they reach assert.

async function setup(t, options = {}) {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const feed = mountSocialFeed(page.document, {
    posts: [], state: "ready", storage: page.storage, ...options,
  });
  const id = (name) => page.document.querySelector(`#${name}`);
  return { ...page, feed, id };
}

const nameOf = (node) => (node ? node.id || node.getAttribute("class") || textOf(node).trim() : "nothing");

const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new DomEvent("input", { bubbles: true }));
};

// The composer open with an image attached, the state src/social-page.js puts
// it in once a file is in hand, and the description holding `description`.
async function withImage(t, description) {
  const page = await setup(t);
  page.id("post-compose-open").click();
  page.feed.description.setAttached(true);
  page.id("compose-media").hidden = false;
  type(page.id("post-image-alt"), description);
  return page;
}

// One walk over the form's descendants, named by id or class. Text nodes carry
// a tagName but no getAttribute, so that is what skips them.
function formOrder(form) {
  const names = [];
  const walk = (node) => {
    for (const child of node.children ?? []) {
      if (typeof child.getAttribute !== "function") continue;
      names.push(child.getAttribute("id") || child.getAttribute("class") || child.tagName);
      walk(child);
    }
  };
  walk(form);
  return names;
}

// How many elements say `phrase` themselves, rather than only by containing an
// element that does.
function carriers(root, phrase) {
  let count = 0;
  const walk = (node) => {
    const inside = (node.children ?? [])
      .filter((child) => typeof child.getAttribute === "function" && textOf(child).includes(phrase));
    if (inside.length === 0) count += 1;
    for (const child of inside) walk(child);
  };
  if (textOf(root).includes(phrase)) walk(root);
  return count;
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
  assert.equal(document.activeElement?.id, "post-body");
  // The name is on the <form> landmark and on nothing else. A second element
  // around it carrying the same name — the panel, as a role="region" — is two
  // nested landmarks both called "Publish a post", so opening the composer
  // announces the name twice on a page Iris already flagged for having several
  // similarly named publish controls. The <form> is the native landmark and it
  // is the thing with controls in it, so it is the one that keeps the name.
  assert.equal(textOf(id(id("post-form").getAttribute("aria-labelledby"))), "Publish a post");
  assert.ok(!id("post-compose-panel").getAttribute("role"), "the panel must not be a second landmark with the form's name");
  assert.notEqual(textOf(trigger), textOf(id("post-submit")));
  // From the post, Tab reaches the Paint step before the picker it leads to.
  assert.equal(nameOf(pressTab(document)), "secondary-button paint-link");
  assert.equal(nameOf(pressTab(document)), "post-image");
  pressKey(document, "Escape");
  assert.equal(id("post-compose-panel").hidden, true);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement?.id, "post-compose-open");
});

test("closing a dirty draft preserves every field and returns to the actual opener", async (t) => {
  const { document, feed, id } = await setup(t);
  const origin = document.createElement("button");
  document.body.append(origin);
  origin.focus();
  feed.composer.open();
  for (const name of ["post-body", "post-author", "post-image-alt"]) id(name).value = `Draft ${name}`;
  pressKey(document, "Escape");
  assert.equal(document.activeElement === origin, true, "Escape did not return focus to the opener");
  feed.composer.open({ opener: origin });
  for (const name of ["post-body", "post-author", "post-image-alt"]) assert.equal(id(name).value, `Draft ${name}`);
  id("post-compose-cancel").click();
  assert.equal(document.activeElement === origin, true, "Close did not return focus to the opener");
  assert.equal(textOf(id("post-keyboard-hint")),
    "Escape or Close hides the composer, and your draft stays in this tab while the composer is closed or you work in another tab, such as Paint. While publishing, wait for the result before closing.");
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
  assert.equal(document.activeElement?.id, "post-body");
  reject(new Error("Offline"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(id("post-compose-cancel").disabled, false);
  assert.equal(id("post-body").value, "Keep this draft");
  // Where the reader is standing when the request comes back. Pressing Publish
  // disables the button under their own focus, so a real browser has already
  // dropped them on <body> — outside the panel, where Escape is not bound and
  // Tab restarts at the top of the document. Both outcomes now end on this one
  // region: success for its receipt, failure for its Retry.
  assert.equal(document.activeElement?.id, "social-notice");
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
  // is the first image step — which is exactly the kind of stop a reading-order
  // test exists to hold in place rather than skip.
  const stops = tabSequence(document).filter(inPanel).map(nameOf);
  assert.deepEqual(stops, [
    "post-body", "secondary-button paint-link", "post-image", "remove-image",
    "post-image-alt", "post-author", "post-submit", "post-compose-cancel",
  ]);
  for (const node of document.querySelectorAll("[tabindex]")) assert.ok(Number(node.getAttribute("tabindex")) <= 0);
});

// #2294: the composer is read in the order the work is done — Paint, export,
// choose, preview, describe, display name, the notice that the post is public
// and permanent, then the one Publish post.
test("the composer reads Paint, Choose image, the preview, the fields and the notice, then Publish post", async (t) => {
  const { document, id } = await setup(t);
  const order = formOrder(id("post-form"));
  const expected = [
    "post-image-steps", "secondary-button paint-link", "post-image", "compose-media", "remove-image",
    "compose-preview", "post-image-alt", "post-author", "post-consequence", PUBLISH_REASON_ID,
    "post-submit", "post-compose-cancel",
  ];
  const missing = expected.filter((name) => !order.includes(name));
  assert.deepEqual(missing, [], `the composer lost part of its sequence: ${order.join(" ")}`);
  assert.deepEqual([...expected].sort((a, b) => order.indexOf(a) - order.indexOf(b)), expected);
  // The Paint action, with exporting by hand as its fallback, is the list item
  // after the Paint link, still before the picker.
  const steps = id("post-image-steps").querySelectorAll("li").map((item) => textOf(item));
  assert.equal(steps.length, 2);
  assert.match(steps[1], /^Select “Use this image in a Social post” in Paint, or export a PNG/);

  // One Publish post control, and it is the last button before Close.
  const named = ["a", "button", "input", "summary"]
    .flatMap((tag) => document.querySelectorAll(tag))
    .filter((node) => (node.getAttribute("aria-label") || textOf(node).trim()) === "Publish post");
  assert.equal(named.length, 1, `${named.length} controls are named Publish post`);
  assert.deepEqual(id("post-form").querySelectorAll("button").map(nameOf),
    ["remove-image", "post-submit", "post-compose-cancel"]);
  assert.equal(id("post-submit").type, "submit");

  // With no image there is nothing to describe, so nothing waits on Publish post.
  assert.equal(id(PUBLISH_REASON_ID).hidden, true);
  assert.equal((id("post-submit").getAttribute("aria-describedby") ?? "").includes(PUBLISH_REASON_ID), false);
});

// Described, so Publish post is enabled and a real tab stop: a disabled submit
// is skipped by a real browser and never blurred by this harness, which would
// make the walk below prove nothing.
test("with a described image, Tab walks Paint, Choose image, Remove image, the fields, Publish post, then Close", async (t) => {
  const { document, id } = await withImage(t, "A card wrapped in a blue focus ring.");
  assert.equal(id("post-submit").disabled, false);
  assert.equal(document.activeElement?.id, "post-body");
  const walked = [];
  for (let press = 0; press < 12; press += 1) {
    const name = nameOf(pressTab(document));
    walked.push(name);
    if (name === "post-compose-cancel") break;
  }
  assert.deepEqual(walked, [
    "secondary-button paint-link", "post-image", "remove-image", "post-image-alt",
    "post-author", "post-submit", "post-compose-cancel",
  ]);
});

test("an image with no description names the missing step on Publish post, once, and only while it is missing", async (t) => {
  const { document, feed, id } = await withImage(t, "");
  const submit = id("post-submit");
  const describedBy = () => (submit.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  const reason = id(PUBLISH_REASON_ID);

  assert.equal(describedBy().includes(PUBLISH_REASON_ID), true,
    `Publish post is not described by the missing step: ${describedBy().join(" ")}`);
  assert.equal(reason.hidden, false);
  assert.match(textOf(reason), /Fill in the required image description/);
  assert.equal(carriers(document.querySelector("body"), "Fill in the required image description"), 1);
  // Beside the control it is about: the element immediately before it.
  const siblings = id("post-form").childElements.map((node) => node.getAttribute("id"));
  assert.equal(siblings[siblings.indexOf("post-submit") - 1], PUBLISH_REASON_ID);
  // It describes the press; it does not take it away.
  assert.equal(submit.disabled, false);

  type(id("post-image-alt"), "A card wrapped in a blue focus ring.");
  assert.equal(reason.hidden, true);
  assert.equal(textOf(reason), "");
  assert.deepEqual(describedBy(), ["post-consequence", "post-publish-blocker", "social-notice"]);

  // Whitespace is not a description.
  type(id("post-image-alt"), "   ");
  assert.equal(describedBy().includes(PUBLISH_REASON_ID), true);
  assert.equal(describedBy().filter((token) => token === PUBLISH_REASON_ID).length, 1);

  // No image, nothing to describe: the step goes with it.
  feed.description.setAttached(false);
  assert.equal(describedBy().includes(PUBLISH_REASON_ID), false);
  assert.equal(reason.hidden, true);
  assert.equal(carriers(document.querySelector("body"), "Fill in the required image description"), 0);
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
