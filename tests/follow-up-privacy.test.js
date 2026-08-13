// One privacy sentence, on every follow-up form the site ships.
//
// The site has seventeen of these forms across sixteen pages — the footer's on
// fifteen, the AI FinOps result's, and the executive briefing's — and the claim
// each of them makes between the field and the button is the same claim: the
// typed address goes to the Wawalu team, and nothing else does. It used to be
// written three different ways, about ninety words each, every version listing
// the particular things its own page happened to hold. A reader moving between
// two of them had to work out whether two different lists meant two different
// promises. They did not.
//
// So there is one string, `FOLLOW_UP_PRIVACY` in src/lead-capture.js, next to
// the transport that makes it true: `postLeadEmail` builds the whole request
// body from one argument, the typed address, so no page state has a route to
// the wire on any surface.
//
// The pages are static HTML and the build copies src/ verbatim, so each form
// embeds the rendered sentence rather than asking a script for it. That is what
// this file exists to police. It reads the shipped markup rather than the
// constant, because a constant nothing renders is not a sentence a visitor sees,
// and it discovers the forms rather than listing them, because a new page with a
// follow-up form has to be held to this too.

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { FOLLOW_UP_PRIVACY } from "../src/lead-capture.js";
import { parseHtml, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";

const SRC = new URL("../src/", import.meta.url);
const read = (file) => readFile(new URL(file, SRC), "utf8");

/** The one label, the same one tests/follow-up-cta-label.test.js pins. */
const CTA = "Request a follow-up";
const CTAS = new Set([CTA, "Send work email to request a follow-up"]);

/**
 * Every follow-up form the site ships, found rather than listed.
 *
 * A follow-up form is a `<form>` whose submit control reads the one CTA label.
 * That deliberately excludes the home page's field-note sign-up, which asks for
 * a work email too but subscribes you rather than asking a person to reply — a
 * different errand, and not this sentence's to describe.
 */
async function followUpForms() {
  const files = (await readdir(SRC)).filter((name) => name.endsWith(".html")).sort();
  const found = [];
  for (const file of files) {
    const document = parseHtml(await read(file));
    for (const form of document.querySelectorAll("form")) {
      const submit = form.querySelector('button[type="submit"]');
      if (!submit || !CTAS.has(textOf(submit))) continue;
      found.push({ file, form, submit, document, field: form.querySelector('input[type="email"]') });
    }
  }
  return found;
}

// The six pages issue #797 named, kept here so a page that stops carrying the
// form has to be a decision rather than a silent deletion. The discovery above
// finds more than these — every page of the site carries the footer's form —
// and the test below requires the named six to be among what it finds.
const NAMED_PAGES = [
  "agents.html", "agent-trace.html", "coach.html", "decision.html", "evolution.html",
  "executive-briefing.html",
];

test("the shared sentence is one sentence, under 25 words, and names all three things", () => {
  const words = FOLLOW_UP_PRIVACY.split(/\s+/).filter(Boolean);
  assert.ok(words.length <= 25, `the sentence is ${words.length} words; the budget is 25`);

  // One sentence: one terminator, at the end. A second sentence is how ninety
  // words grew out of the last one.
  assert.equal(FOLLOW_UP_PRIVACY.at(-1), ".");
  assert.equal((FOLLOW_UP_PRIVACY.match(/[.!?]/g) ?? []).length, 1,
    "one sentence, not two joined by a full stop");

  // What is sent, who receives it, and that nothing else goes with it. A reader
  // deciding whether to type an address is deciding on exactly these three.
  assert.match(FOLLOW_UP_PRIVACY, /work email address you type here/, "it must name what is sent");
  assert.match(FOLLOW_UP_PRIVACY, /Wawalu team that operates Shiplog/, "it must name who receives it");
  assert.match(FOLLOW_UP_PRIVACY, /nothing else on this page is sent/,
    "it must say that nothing else on the page is sent");

  // No hedge, no marketing, and no promise the transport does not keep.
  for (const filler of [/\bwe (?:will )?never\b/i, /\brest assured\b/i, /\bsecurely\b/i, /\bof course\b/i,
    /\bsimply\b/i, /\bprivacy[- ]first\b/i]) {
    assert.doesNotMatch(FOLLOW_UP_PRIVACY, filler, `the sentence must not read as marketing: ${filler}`);
  }
});

test("every follow-up form on the site renders that sentence, byte for byte", async () => {
  const forms = await followUpForms();
  assert.ok(forms.length >= NAMED_PAGES.length, "no follow-up form was found at all");

  const carriers = new Set(forms.map(({ file }) => file));
  for (const file of NAMED_PAGES) {
    assert.ok(carriers.has(file), `${file} no longer carries a follow-up form`);
  }

  for (const { file, form, field } of forms) {
    assert.ok(field, `${file}: a follow-up form with no work-email field`);

    // The note is the field's accessible description, so it is read out with the
    // control rather than only sitting near it.
    const noteId = field.getAttribute("aria-describedby");
    assert.ok(noteId, `${file}: the field names no description`);
    const note = form.querySelector(`#${noteId}`);
    assert.ok(note, `${file}: aria-describedby names #${noteId}, which is not in the form`);

    // Byte for byte, not by fragment: a substring match would pass on any prose
    // that happened to contain the words, which is how six copies drifted apart.
    assert.equal(textOf(note), FOLLOW_UP_PRIVACY, `${file}: the privacy sentence has drifted`);
  }
});

test("the sentence sits between the work-email field and the submit button, once", async () => {
  for (const { file, form, field, submit } of await followUpForms()) {
    // Document order inside the form: field, then note, then the control that
    // sends. A claim a reader meets after pressing the button is not a claim
    // they got to weigh.
    const order = form.querySelectorAll("input,p,button");
    const at = (node) => order.indexOf(node);
    const notes = order.filter((node) => textOf(node) === FOLLOW_UP_PRIVACY);
    assert.equal(notes.length, 1, `${file}: the sentence renders ${notes.length} times in one form`);
    assert.ok(at(field) < at(notes[0]), `${file}: the sentence is above the field it describes`);
    assert.ok(at(notes[0]) < at(submit), `${file}: the sentence is below the button it should precede`);
  }
});

test("no page keeps a fragment of the prose the one sentence replaced", async () => {
  // The wordings that were live before issue #797, one fragment each, long
  // enough that nothing else could match them. Checked against the shipped
  // markup of every page rather than the three that carried them, because a
  // copy of a paragraph is exactly the failure this file exists to catch.
  const RETIRED = [
    "No figure, period, limitation, file, or prompt text",
    "this form cannot reach what your browser holds",
    "Submitting sends a Shiplog follow-up request.",
    "nothing you have read, filtered, imported, or exported",
    "No figure, file name, column value, or department name from your import",
    "This page carries its own follow-up form",
  ];
  const files = (await readdir(SRC)).filter((name) => name.endsWith(".html"));
  for (const file of files) {
    const html = await read(file);
    for (const fragment of RETIRED) {
      assert.ok(!html.includes(fragment), `${file} still ships retired prose: "${fragment}"`);
    }
  }
});

test("the briefing's About block points at the form with a link, not a paragraph", async () => {
  const document = parseHtml(await read("executive-briefing.html"));
  const footer = document.getElementById("site-footer");

  // One link, carrying the one label. It replaced a paragraph that explained
  // that the page has its own form and which of the page's two forms to use.
  const link = footer.querySelector(".site-footer-redirect-link");
  assert.equal(link.tagName, "A");
  assert.equal(textOf(link), CTA);
  assert.equal(link.getAttribute("href"), "#briefing-contact");
  assert.equal(footer.querySelectorAll("p").length, 1,
    "the About block keeps the identity paragraph and no explanation of the link");

  // Focus has to move, not just the scroll position — the same rule
  // tests/page-skip-link.test.js holds the skip link to, and the same mechanism:
  // tabindex="-1" makes the wrapper focusable without giving it a tab stop.
  const target = document.getElementById("briefing-contact");
  assert.equal(target.getAttribute("tabindex"), "-1", "the anchor target must take focus");
  assert.ok(!tabSequence(document).includes(target), "the target must not become a tab stop of its own");
});

test("following the About block's link lands a keyboard reader in the briefing's form", async () => {
  const document = parseHtml(await read("executive-briefing.html"));

  // Reached and pressed from the keyboard alone.
  const link = document.querySelector(".site-footer-redirect-link");
  let focused = null;
  for (let step = 0; step < tabSequence(document).length; step += 1) {
    focused = pressTab(document);
    if (focused === link) break;
  }
  assert.equal(focused, link, "the pointer to the form is not reachable by Tab");

  pressEnter(document);
  // Real activation, recorded by the harness. The browser then moves focus to
  // #briefing-contact because it carries tabindex="-1"; the test above pins that.
  assert.deepEqual(document.navigations, ["#briefing-contact"], "the link did not activate");

  // What the reader gets for the press: the next Tab from the target is inside
  // the form, not somewhere else on the page.
  const target = document.getElementById("briefing-contact");
  const inside = new Set(target.querySelectorAll("a,button,input,select,textarea"));
  const sequence = tabSequence(document);
  const first = sequence.findIndex((stop) => inside.has(stop));
  assert.ok(first >= 0, "the form region offers the reader no control at all");
  assert.equal(sequence[first].id, "briefing-contact-open",
    "the first stop inside the form must be the control that opens it");

  // And the field and the submit button are behind it, in that order — the form
  // is collapsed in the shipped markup, so this is the source order the
  // disclosure reveals rather than a live tab sequence.
  const controls = target.querySelectorAll("input,button").map((node) => node.id);
  assert.deepEqual(
    controls.filter((id) => ["briefing-contact-open", "briefing-contact-email"].includes(id)),
    ["briefing-contact-open", "briefing-contact-email"],
    "the work email field must follow the control that reveals it",
  );
});
