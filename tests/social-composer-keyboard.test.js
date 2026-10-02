import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PUBLISH_REASON_ID, composerFocusables, mountSocialFeed, nextContainedStop } from "../src/social.js";
import { DomEvent, loadPage, pressKey, pressTab, tabSequence, textOf } from "./support/browser.js";
import { bootSocial } from "./support/social-paint-arrival.js";
import { waitFor } from "./support/page-module.js";

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
  assert.equal(document.activeElement?.id, "post-form-title");
  id("post-body").focus();
  // The name is on the <form> landmark and on nothing else. A second element
  // around it carrying the same name — the panel, as a role="region" — is two
  // nested landmarks both called "Write a post", so opening the composer
  // announces the name twice on a page Iris already flagged for having several
  // similarly named publish controls. The <form> is the native landmark and it
  // is the thing with controls in it, so it is the one that keeps the name.
  assert.equal(textOf(id(id("post-form").getAttribute("aria-labelledby"))), "Write a post");
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

// #2554 re-reported this composer's open/close keyboard behaviour, which shipped
// in #2378 and #2460 and is asserted above and in
// tests/social-composer-publish-race.test.js. One invariant the report states was
// still only implied: every existing check names the node open() focuses by id
// ("post-form-title"), and an id match is not containment. A refactor that kept
// the id but moved the heading out of the panel — above the trigger, say, as a
// heading for the whole column — would leave all of those green while open()
// dropped focus outside the region it had just revealed, which is the failure the
// criterion is about. So this asserts what the criterion actually says: whatever
// open() focuses is a descendant of #post-compose-panel. Walked by parentNode
// because this harness throws on a descendant selector, and because a walk keeps
// answering after the panel's contents are rearranged.
test("open() lands focus inside the composer panel by containment, not by id, on both routes", async (t) => {
  const { document, feed, id } = await setup(t);
  const panel = id("post-compose-panel");
  const within = (node) => {
    for (let cursor = node; cursor; cursor = cursor.parentNode) if (cursor === panel) return true;
    return false;
  };

  // A closed composer holds no focus, so the two claims below are about what
  // open() did and not about where the page happened to start.
  assert.equal(within(document.activeElement), false);

  // The trigger's own route.
  id("post-compose-open").click();
  assert.equal(within(document.activeElement), true,
    `open() left focus outside the composer, on ${nameOf(document.activeElement)}`);
  // Programmatically focusable without being a stop, so containment costs the
  // page no tab stop.
  assert.equal(document.activeElement?.getAttribute("tabindex"), "-1");
  assert.equal(tabSequence(document).filter((node) => node === document.activeElement).length, 0,
    "the node open() focuses became a tab stop");

  // And the API route, from an opener that is not the trigger — the shape a Paint
  // handoff and the publish reveal use. Escape first, so open() runs a real
  // hidden-to-shown transition rather than re-focusing an already-open panel.
  pressKey(document, "Escape");
  assert.equal(within(document.activeElement), false);
  const origin = document.createElement("button");
  document.body.append(origin);
  origin.focus();
  feed.composer.open({ opener: origin });
  assert.equal(within(document.activeElement), true,
    `open({ opener }) left focus outside the composer, on ${nameOf(document.activeElement)}`);
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
    "Escape or Close hides the composer, and your draft stays in this tab while the composer is closed or you work in another tab, such as Paint.");
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
  // Two labelled routes since #2514 — Paint first, a file already on the device
  // second — both still read before the picker they lead into.
  const steps = id("post-image-steps").querySelectorAll("li").map((item) => textOf(item));
  assert.equal(steps.length, 2);
  assert.match(steps[0], /^From Paint: .* then select “Use this image in a Social post”$/);
  // #2594: the file route no longer quotes the label on the picker it is read
  // above, which rendered "…on this device Choose image" as one run-on line.
  assert.equal(steps[1], "From a file: add an image already saved on this device");

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
  // open() lands on the heading, which is not itself a tab stop; this harness
  // would restart Tab at stop 0 from there, so the walk starts on the field a
  // browser's next Tab reaches (tests/social-composer-publish-race.test.js).
  assert.equal(document.activeElement?.id, "post-form-title");
  id("post-body").focus();
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

// #2709. Rendered order, not authored order: this boots /social-page.js and
// walks the document the modules leave behind, because an authored-order check
// describes a page no visitor sees. One walk and one index per region, compared
// as a whole sequence — a handful of separate "A precedes B" checks can all pass
// while the order as a reader meets it is still wrong.
const RENDERED_ORDER = [
  "#page-title", "#page-tagline", "#post-compose-open", "#feed-title",
  "#post-name-filter", "#post-time-filter", "#post-filter-clear", "#feed-summary",
  "#feed-state", "#post-feed", ".social-feed-intro", "#feed-source-note",
  "#post-report-route", "#post-compose-panel", "#post-form-title", "#post-body",
  "#ask-about-shiplog", "#ask-about-shiplog-description", "#post-report-about",
];

// Every tab stop inside the page body ahead of the display-name filter, named.
// Pinned as a list and not only as a number so a change that swaps one control
// for another — rather than adding one — fails with the swap in the message.
// Bounded to #main-content on purpose: the skip link and the nav rail also sit
// above the filters, and a new nav destination is not this file's failure.
const STOPS_ABOVE_FILTERS = ["post-compose-open"];

const LIVE_POST = {
  posts: [{
    id: "visitor-2709", author: "Mina", content: "Moved the composer below the feed.",
    timestamp: "2026-09-30T09:00:00.000Z", source: "shiplog-web",
  }],
};

test("the composer is read after the feed and before the contact route, and adds no tab stop above the filters", async (t) => {
  const { document, id } = await bootSocial(t, { routes: { "/api/social-posts?limit=100": LIVE_POST } });
  await waitFor(() => document.querySelectorAll(".post-card")
    .filter((card) => !card.getAttribute("class").includes("post-card-skeleton")).length === 1,
  "the post painted");

  const order = [];
  const walk = (node) => {
    for (const child of node.children ?? []) {
      // Text nodes arrive in `children` with a truthy tagName, so the attribute
      // reader is what tells an element from a run of text.
      if (typeof child.getAttribute !== "function") continue;
      order.push(child);
      walk(child);
    }
  };
  walk(document.querySelector("#main-content"));

  const at = (selector) => {
    const node = document.querySelector(selector);
    assert.ok(node, `${selector} is not on the page`);
    const index = order.indexOf(node);
    assert.ok(index >= 0, `${selector} is outside #main-content`);
    return index;
  };
  const indices = RENDERED_ORDER.map(at);
  const named = RENDERED_ORDER.map((selector, position) => [selector, indices[position]])
    .sort((a, b) => a[1] - b[1]).map(([selector]) => selector);
  assert.deepEqual(named, RENDERED_ORDER, `rendered reading order is ${named.join(" ")}`);

  // "After the feed region" means after the cards, not merely after the element
  // that holds them: the last card's own index is what the criterion is about.
  const cards = document.querySelectorAll(".post-card")
    .filter((card) => !card.getAttribute("class").includes("post-card-skeleton"));
  assert.equal(cards.length, 1);
  assert.ok(order.indexOf(cards[cards.length - 1]) < at("#post-compose-panel"),
    "the composer is read before the last post");

  // About Shiplog is the site footer, outside #main-content, so the composer
  // precedes it by construction. Asserted as an index rather than against the
  // node, because comparing a parsed element to a value inspects the page.
  assert.equal(order.indexOf(document.querySelector("#site-footer-title")), -1,
    "About Shiplog moved inside #main-content, where the walk above no longer bounds it");

  // The criterion the move must not pay for. The composer still has exactly one
  // entry point above the filters — the hero control that was already there.
  const stops = tabSequence(document);
  const above = stops.slice(0, stops.indexOf(id("post-name-filter")));
  const names = above.filter((node) => node.closest("#main-content"))
    .map((node) => node.getAttribute("id") || node.getAttribute("class") || textOf(node).trim());
  assert.deepEqual(names, STOPS_ABOVE_FILTERS, `the page's stops above the filters are ${names.join(" ")}`);
  assert.equal(names.length, 1, "the page gained a tab stop above the feed's filters");
  // Said as a total too, so a focusable added to the page chrome above the
  // filters — outside #main-content, where the list above cannot see it — is
  // still a count that has to move for this to stay green.
  assert.equal(above.length, above.filter((node) => !node.closest("#main-content")).length + 1);

  // The contact route is still a stop, just a later one: it moved below the
  // composer rather than out of the tab order.
  assert.ok(stops.indexOf(document.querySelector("#ask-about-shiplog")) > stops.indexOf(id("post-compose-open")));
  // The caption travels with the label it explains, in one container.
  assert.equal(document.querySelector("#ask-about-shiplog-description").parentNode
    === document.querySelector("#ask-about-shiplog").parentNode, true,
  "the follow-up caption drifted out of the container its label sits in");
});

// The composer closed is the `hidden` attribute and nothing else: textOf reads
// straight through a collapsed region in this harness, so a visibility claim
// made on text alone would pass against a panel standing wide open.
test("open puts focus in the composer one stop above its first field, and both close routes return it", async (t) => {
  const { document, id } = await setup(t);
  const panel = id("post-compose-panel");
  assert.equal(panel.hidden, true);
  assert.equal(tabSequence(document).includes(id("post-body")), false);

  id("post-compose-open").click();
  assert.equal(panel.hidden, false);
  assert.equal(document.activeElement?.id, "post-form-title");
  // Where the criterion asked for the post field: open() lands on the panel's
  // heading instead, which names the form that was just revealed (#2370), and
  // the field is the very next stop. Proved with the pure Tab decision rather
  // than pressTab, which restarts at stop 0 from a node off the ring.
  assert.equal(nextContainedStop(composerFocusables(panel), document.activeElement, false)?.id, "post-body");

  id("post-compose-cancel").click();
  assert.equal(panel.hidden, true);
  assert.equal(document.activeElement?.id, "post-compose-open");

  id("post-compose-open").click();
  id("post-author").focus();
  pressKey(document, "Escape");
  assert.equal(panel.hidden, true);
  assert.equal(document.activeElement?.id, "post-compose-open");
  assert.equal(id("post-compose-open").getAttribute("aria-expanded"), "false");
});

test("Escape elsewhere on the page is left alone, and a collapsed composer refuses one aimed into it", async (t) => {
  const { document, id } = await setup(t);
  id("post-compose-open").click();

  // A press on a control outside the panel never reaches this disclosure, so
  // the page keeps Escape — and the open composer stays open.
  const outside = new DomEvent("keydown", { bubbles: true, key: "Escape" });
  id("post-name-filter").focus();
  id("post-name-filter").dispatchEvent(outside);
  assert.equal(outside.defaultPrevented, false, "the composer swallowed Escape from outside it");
  assert.equal(id("post-compose-panel").hidden, false, "Escape outside the composer closed it");
  assert.equal(document.activeElement?.id, "post-name-filter");

  id("post-body").focus();
  pressKey(document, "Escape");
  assert.equal(id("post-compose-panel").hidden, true);
  assert.equal(document.activeElement?.id, "post-compose-open");

  // And a stray press delivered inside the collapsed panel is refused rather
  // than re-run: close() would otherwise yank focus to the trigger from
  // wherever the reader had got to.
  id("post-filter-clear").focus();
  const stray = new DomEvent("keydown", { bubbles: true, key: "Escape" });
  id("post-body").dispatchEvent(stray);
  assert.equal(stray.defaultPrevented, false);
  assert.equal(id("post-compose-panel").hidden, true);
  assert.equal(document.activeElement?.id, "post-filter-clear");
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
