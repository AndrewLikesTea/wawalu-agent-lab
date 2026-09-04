// How a team gets Shiplog, on the pages a shared link lands on.
//
// The home page answers "so how do I get this?" in a paragraph of its own: no
// self-serve signup, no published price, and both availability and cost answered
// on request. Nothing else said it. A visitor forwarded a link to the Prompt
// coach, Releases, Social, or People page reached a follow-up block that opened
// with "Questions about Shiplog?", which reads as a support box rather than as
// the way to get the product (#2130).
//
// So those four pages carry the home page's own wording above the work-email
// field. This file pins the two halves that could drift apart: the sentence is
// present, above the field, in the rendered page; and it still says only what the
// home page already published, compared against that paragraph rather than
// against a phrase typed in here.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";
import { importPageModule } from "./support/page-module.js";
import { HOW_TO_GET, INVITATION } from "../src/site-footer.js";

// The four deep pages issue #2130 named. The home page is deliberately absent:
// it carries the paragraph this sentence is drawn from, further up the page.
const DEEP_PAGES = ["coach.html", "releases.html", "social.html", "profile.html"];

const SENTENCE_LEAD = "This request is sent about the ";

const pageUrl = (file) => new URL(`../src/${file}`, import.meta.url);
const read = (file) => readFile(pageUrl(file), "utf8");
const byId = (document, id) => document.getElementById(id);

/**
 * Every element under a node, in document order.
 *
 * Walked rather than queried: this harness throws on the universal selector and
 * a comma-separated one is unreliable, and either failure would leave the
 * ordering assertions below comparing an empty list against itself. Text nodes
 * live in `children` too and carry no `getAttribute`, hence the guard.
 */
function flatten(node, found = []) {
  for (const child of node.children ?? []) {
    if (child.tagName && !child.tagName.startsWith("#")) found.push(child);
    flatten(child, found);
  }
  return found;
}

/** The footer with its module wired in, the way a browser wires it. */
async function openPage(file) {
  const page = await loadPage(pageUrl(file));
  await importPageModule("/site-footer-page.js");
  return page;
}

for (const file of DEEP_PAGES) {
  test(`${file} says above the work-email field what asking the Wawalu team gets you`, async () => {
    const page = await openPage(file);
    const { document } = page;
    try {
      const how = byId(document, "site-footer-how");
      assert.ok(how, `${file}: the follow-up block never says how a team gets Shiplog`);
      assert.equal(textOf(how), HOW_TO_GET, `${file}: the sentence has drifted from src/site-footer.js`);
      assert.ok(!how.hidden, `${file}: the sentence ships hidden`);

      // Above the field, because it is what a visitor weighs before deciding
      // whether to type an address at all — and below the question it answers.
      const order = flatten(byId(document, "site-footer"));
      const field = byId(document, "site-footer-email");
      const invitation = order.find((node) => textOf(node) === INVITATION);
      assert.ok(order.indexOf(how) > order.indexOf(invitation), `${file}: the sentence is above the invitation`);
      assert.ok(order.indexOf(how) < order.indexOf(field), `${file}: the sentence is below the field it precedes`);

      // Prose in the style the invitation already uses: no new class, and so no
      // new rule in a stylesheet with no room for one, and no new tab stop.
      assert.equal(how.tagName, "P", `${file}: the sentence must be a paragraph`);
      assert.equal(how.getAttribute("class"), invitation.getAttribute("class"),
        `${file}: the sentence must reuse the invitation style, not introduce one`);
      assert.deepEqual(flatten(how), [], `${file}: the sentence must contain no control`);
      assert.ok(!tabSequence(document).some((node) => node.id === "site-footer-how"),
        `${file}: the sentence must not take focus`);

      // And it is additive. The line that says which page the request is about
      // is what the sentence stands beside, not what it replaced.
      const stated = byId(document, "site-footer-topic-note");
      assert.ok(stated, `${file}: the page-specific topic line is gone`);
      assert.ok(textOf(stated).startsWith(SENTENCE_LEAD), `${file}: the topic line has been reworded`);
      assert.equal(textOf(byId(document, "site-footer-form")
        .querySelector('button[type="submit"]')), "Request a follow-up",
      `${file}: the submit control was renamed`);
    } finally {
      page.restore();
    }
  });
}

test("the sentence claims only what the home page already published", async () => {
  // Compared against the paragraph, not against a literal: a test that pinned
  // this prose to a string typed in here would pass just as happily once the two
  // had drifted into two different offers, which is the defect it exists to catch.
  const document = parseHtml(await read("index.html"));
  const offer = flatten(document)
    .find((node) => node.tagName === "P" && textOf(node).startsWith("How a team gets Shiplog"));
  assert.ok(offer, "the home page no longer explains how a team gets Shiplog");
  const paragraph = textOf(offer);

  for (const claim of [
    "There is no self-serve signup and no published price",
    "what it would cost are both answered on request",
  ]) {
    assert.ok(HOW_TO_GET.includes(claim), `the sentence dropped the home page's wording: ${claim}`);
    assert.ok(paragraph.includes(claim), `the home page no longer publishes: ${claim}`);
  }

  // One sentence, and no claim the home page does not make: nothing about a
  // reply, a schedule, a trial, or a number.
  assert.equal(HOW_TO_GET.at(-1), ".");
  assert.equal((HOW_TO_GET.match(/[.!?]/g) ?? []).length, 1, "one sentence, not two");
  for (const overreach of [/\breply\b/i, /\bget back to you\b/i, /within \d/i, /\bfree\b/i,
    /\btrial\b/i, /\bdays?\b/i, /\$\s*\d/, /\d/]) {
    assert.doesNotMatch(HOW_TO_GET, overreach, `the sentence must not promise: ${overreach}`);
  }
});

test("the home page keeps its own paragraph and does not gain the footer sentence", async () => {
  // The addition is for the pages that were missing the answer. The home page
  // answers it in the body, and a second copy in its footer would be the
  // duplication this change is meant to avoid.
  const document = parseHtml(await read("index.html"));
  assert.ok(byId(document, "site-footer-how") == null,
    "the home page's footer must not repeat its own paragraph");
  assert.ok(byId(document, "site-footer-form"), "the home page still carries the footer's follow-up form");
});
