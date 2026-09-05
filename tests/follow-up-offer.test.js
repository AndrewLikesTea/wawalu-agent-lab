// What asking the Wawalu team actually gets you, on the pages a shared link
// lands on.
//
// The home page answers this above its own form: there is no self-serve signup
// and no published price, and both of the questions that follow from that —
// whether Shiplog is available for your team, and what it would cost — are
// answered on request. A visitor who arrived on Prompt coach, Releases, Social
// or People from a forwarded link never read it. Their follow-up block asked
// "Questions about Shiplog?" and then asked for a work address, with no stated
// reason to hand one over. Issue #2130 gave those four the home page's answer,
// and issue #2153 gave it to the shared post page, which is the page a forwarded
// link lands on most often of all.
//
// Two things this file holds, and one it deliberately does not:
//
//   1. The carriers listed below have the sentence and every other page does
//      not, so the shape is a decision recorded here rather than something a
//      page can grow or drop quietly. The home page is on the "does not" side: its footer is
//      unchanged, and the paragraph a few sections up is where it says this.
//   2. The claims are the home page's, compared against the home page's own
//      shipped paragraph rather than against a string typed in here. A reused
//      sentence that has drifted from its source is two answers to one question,
//      which is the defect this reuse exists to avoid.
//
// It does not pin the sentence's placement relative to the topic note as an
// aesthetic: it pins that both stand above the work-email field, because that is
// what makes them reasons to type rather than notes about what was typed.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";
import { importPageModule } from "./support/page-module.js";
import { OFFER } from "../src/site-footer.js";

const SRC = new URL("../src/", import.meta.url);
const pageUrl = (file) => new URL(`../src/${file}`, import.meta.url);
const read = (file) => readFile(pageUrl(file), "utf8");
const byId = (document, id) => document.getElementById(id);

// The four deep pages issue #2130 named, and the shared post page issue #2153
// added to them. A shared link lands on one of these, and the follow-up block is
// the first thing on it that asks for anything.
const CARRIERS = ["coach.html", "releases.html", "social.html", "profile.html", "post.html"];

// The two claims, sliced out of the shipped sentence rather than retyped: a
// fragment written here would keep passing after the sentence changed under it.
const [PRICE_CLAIM, AVAILABILITY_CLAIM] = OFFER.split(". ");

test("the offer sentence carries the home page's claims and adds none of its own", async () => {
  // One sentence per claim, and nothing after the second.
  assert.equal(OFFER.at(-1), ".");
  assert.equal((OFFER.match(/[.!?]/g) ?? []).length, 2, "two sentences: the position, then what follows from it");
  assert.ok(PRICE_CLAIM && AVAILABILITY_CLAIM, "the sentence did not split into its two claims");

  // The source of truth: the home page's own "How a team gets Shiplog"
  // paragraph, read out of the shipped markup. The first claim is reused word
  // for word; the second names Shiplog where the home page's sentence, having
  // just named it, says "it" — so the reused half is the clause after that.
  const home = textOf(byId(parseHtml(await read("index.html")), "shiplog-entry"));
  assert.match(home, /How a team gets Shiplog/, "the home page's offer paragraph did not parse");
  assert.ok(home.includes(PRICE_CLAIM),
    `the home page no longer says "${PRICE_CLAIM}", so the four pages are quoting nothing`);
  const shared = AVAILABILITY_CLAIM.slice(AVAILABILITY_CLAIM.indexOf("available"));
  assert.ok(home.includes(shared), `the home page no longer says "${shared}"`);

  // And nothing was invented on the way across. No reply, no clock, no figure,
  // and no offer of a thing this site does not have.
  for (const overreach of [/\d/, /\bwithin\b/i, /\bbusiness day/i, /\bguarantee/i, /\bwe['’]ll\b/i,
    /\bfree\b/i, /\btrial\b/i, /\bhours?\b/i, /\bsoon\b/i]) {
    assert.doesNotMatch(OFFER, overreach, `the sentence must promise nothing new: ${overreach}`);
  }
});

test("exactly the four deep pages open their follow-up block with it", async () => {
  const files = (await readdir(SRC)).filter((name) => name.endsWith(".html")).sort();
  assert.ok(files.length > CARRIERS.length, "the page list did not read");

  for (const file of files) {
    const document = parseHtml(await read(file));
    const offer = byId(document, "site-footer-offer");
    assert.equal(Boolean(offer), CARRIERS.includes(file),
      `${file}: the offer sentence disagrees with the table of pages that carry it`);
    if (!offer) continue;
    assert.equal(textOf(offer), OFFER, `${file}: the offer sentence has drifted from src/site-footer.js`);
  }

  // Named rather than merely implied by the loop above: the home page says this
  // in its own paragraph, and a second copy in its footer would be the same
  // claim twice on one screen.
  assert.equal(Boolean(byId(parseHtml(await read("index.html")), "site-footer-offer")), false,
    "the home page's footer must not repeat the paragraph above it");
});

test("it is prose above the work-email field, in the hint style, and costs no control", async () => {
  for (const file of CARRIERS) {
    const document = parseHtml(await read(file));
    const form = byId(document, "site-footer-form");
    const offer = byId(document, "site-footer-offer");
    assert.equal(offer.tagName, "P", `${file}: the offer must be a paragraph`);

    // The same hint role the privacy sentence uses — no new class, and so no new
    // colour, size, or spacing to pay for in a stylesheet with none to spare.
    assert.equal(offer.getAttribute("class"), byId(document, "site-footer-note").getAttribute("class"),
      `${file}: the sentence must reuse the form-hint style, not introduce one`);
    assert.equal(offer.getAttribute("tabindex"), null, `${file}: the sentence must not take focus`);
    for (const tag of ["a", "button", "input"]) {
      assert.equal(offer.querySelectorAll(tag).length, 0, `${file}: the sentence must contain no ${tag}`);
    }

    // Document order inside the form: the offer, then the line naming what this
    // request is about, then the field. The offer says why to type; the topic
    // note says what about. A reader meets both before the address.
    const order = [...form.querySelectorAll("p"), ...form.querySelectorAll("input")];
    const at = (node) => order.indexOf(node);
    assert.ok(at(offer) >= 0, `${file}: the offer is not inside the follow-up form`);
    assert.ok(at(offer) < at(byId(document, "site-footer-topic-note")),
      `${file}: the offer must open the block, above the line naming the topic`);
    assert.ok(at(offer) < at(byId(document, "site-footer-email")),
      `${file}: the offer is stated below the field it is the reason for`);

    // Once. The claim reads as an answer, not as insistence.
    const stated = form.querySelectorAll("p").filter((node) => textOf(node) === OFFER);
    assert.equal(stated.length, 1, `${file}: the offer is stated ${stated.length} times`);

    // The page-specific line it stands above is still there and still names this
    // page: the new sentence explains the offer, it does not replace the topic.
    assert.ok(textOf(byId(document, "site-footer-topic-note")).startsWith("This request is sent about the "),
      `${file}: the line naming this page's topic was merged away`);
  }
});

for (const file of CARRIERS) {
  test(`${file} paints the offer above the field a visitor types into`, async () => {
    const page = await loadPage(pageUrl(file));
    await importPageModule("/site-footer-page.js");
    const { document } = page;
    try {
      // Rendered, after the footer's own module has wired the form up: this is
      // the sentence a visitor reads, not the one the source file holds.
      const offer = byId(document, "site-footer-offer");
      assert.equal(textOf(offer), OFFER, `${file}: the painted sentence has drifted`);
      assert.ok(!offer.hidden, `${file}: the sentence ships hidden`);
      assert.ok(!tabSequence(document).some((node) => node.id === "site-footer-offer"),
        `${file}: the sentence must not be a tab stop`);

      // It is inside the block it explains, above the address and above the
      // control that sends it.
      const panel = byId(document, "site-footer-panel");
      const order = [...panel.querySelectorAll("p"), ...panel.querySelectorAll("input"),
        ...panel.querySelectorAll("button")];
      const at = (node) => order.indexOf(node);
      assert.ok(at(offer) < at(byId(document, "site-footer-email")),
        `${file}: the sentence paints below the field`);
      assert.ok(at(offer) < at(panel.querySelector('button[type="submit"]')),
        `${file}: the sentence paints below the control that sends`);
    } finally {
      page.restore();
    }
  });
}
