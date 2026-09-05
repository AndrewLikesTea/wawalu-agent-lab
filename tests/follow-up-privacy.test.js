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
import { FOLLOW_UP_PRIVACY, FOLLOW_UP_PRIVACY_WITH_MESSAGE, FOLLOW_UP_USE } from "../src/lead-capture.js";
import { parseHtml, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";

const SRC = new URL("../src/", import.meta.url);
const read = (file) => readFile(new URL(file, SRC), "utf8");

/** The one label, the same one tests/follow-up-cta-label.test.js pins. */
const CTA = "Request a follow-up";
const CTAS = new Set([CTA]);

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

/**
 * Which of the two sentences a form is held to, and why there are two.
 *
 * A form that offers only a work-email field can say that nothing else on the
 * page is sent, because nothing else is. Issue #2129 gave five of these forms an
 * optional field asking what the visitor wants to know, and issue #2153 gave the
 * shared post page the same shape; on those the first sentence would be false the
 * moment anyone typed in it. So they render the second one, which names all three
 * things that go: the address, the topic the page fixes, and the message.
 *
 * The table is keyed on the page rather than inferred from the markup on
 * purpose. Inferring it would mean a form that lost its message field, or grew
 * one, could swap sentences without anyone deciding to — which is the drift this
 * whole file exists to catch. `expectedPrivacy` is what every assertion below
 * reads, so a page is never compared against a sentence it does not ship.
 */
const ASKS_MESSAGE = new Set([
  "agents.html", "coach.html", "post.html", "profile.html", "releases.html", "social.html",
]);
const expectedPrivacy = (file) => (ASKS_MESSAGE.has(file) ? FOLLOW_UP_PRIVACY_WITH_MESSAGE : FOLLOW_UP_PRIVACY);

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

test("the message form's sentence is one sentence too, and lists everything that goes", () => {
  const words = FOLLOW_UP_PRIVACY_WITH_MESSAGE.split(/\s+/).filter(Boolean);
  // A longer budget than the sentence above, because it names three things
  // rather than one. Still one sentence, and still short enough to read once.
  assert.ok(words.length <= 32, `the sentence is ${words.length} words; the budget is 32`);
  assert.equal(FOLLOW_UP_PRIVACY_WITH_MESSAGE.at(-1), ".");
  assert.equal((FOLLOW_UP_PRIVACY_WITH_MESSAGE.match(/[.!?]/g) ?? []).length, 1,
    "one sentence, not two joined by a full stop");

  // The same opening the other sentence makes, so a reader moving between two
  // forms is reading one promise with one exception, not two promises.
  assert.match(FOLLOW_UP_PRIVACY_WITH_MESSAGE, /work email address you type here/, "it must name what is sent");
  assert.match(FOLLOW_UP_PRIVACY_WITH_MESSAGE, /Wawalu team that operates Shiplog/,
    "it must name who receives it");

  // All three things, and the claim it may not make: a form with a message box
  // is a form where something else on the page can reach the wire.
  assert.match(FOLLOW_UP_PRIVACY_WITH_MESSAGE, /follow-up topic/, "it must name the topic it sends");
  assert.match(FOLLOW_UP_PRIVACY_WITH_MESSAGE, /message you type/, "it must name the message it sends");
  assert.doesNotMatch(FOLLOW_UP_PRIVACY_WITH_MESSAGE, /nothing else on this page is sent/,
    "a form that carries a message box may not claim nothing else on the page is sent");

  for (const filler of [/\bwe (?:will )?never\b/i, /\brest assured\b/i, /\bsecurely\b/i, /\bof course\b/i,
    /\bsimply\b/i, /\bprivacy[- ]first\b/i]) {
    assert.doesNotMatch(FOLLOW_UP_PRIVACY_WITH_MESSAGE, filler, `the sentence must not read as marketing: ${filler}`);
  }
});

test("the use sentence states a use, and promises no reply, no schedule, and no list", () => {
  // The privacy sentence says where the address goes. It does not say what the
  // team then does with it, and "goes to a team" is not an answer to "will you
  // put me on something?". This is that answer, and it is a separate string
  // because the sentence above is pinned as one sentence naming one thing.
  const words = FOLLOW_UP_USE.split(/\s+/).filter(Boolean);
  assert.ok(words.length <= 20, `the sentence is ${words.length} words; the budget is 20`);
  assert.equal(FOLLOW_UP_USE.at(-1), ".");
  assert.equal((FOLLOW_UP_USE.match(/[.!?]/g) ?? []).length, 1, "one sentence, not two");

  // The use, and the limit on it.
  assert.match(FOLLOW_UP_USE, /reply to this request/, "it must name what the address is used for");
  assert.match(FOLLOW_UP_USE, /nothing else/, "it must say the address is used for nothing else");

  // What a stored address cannot promise. Nobody is committed to answering by
  // this sentence, no clock starts, and no figure is quoted.
  for (const overreach of [/\bwill (?:reply|respond|get back)\b/i, /\bguarantee/i, /\bwithin\b/i,
    /\bbusiness day/i, /\d/]) {
    assert.doesNotMatch(FOLLOW_UP_USE, overreach, `the sentence must promise no reply or schedule: ${overreach}`);
  }
  // And it is not a sign-up. The home page has one of those, a few sections up
  // from this form, and the two must not read as the same errand.
  for (const signup of [/newsletter/i, /mailing list/i, /subscrib/i, /\bmarketing\b/i, /\baccount\b/i,
    /field note/i]) {
    assert.doesNotMatch(FOLLOW_UP_USE, signup, `the sentence must not read as a sign-up: ${signup}`);
  }
});

test("every follow-up form renders the use sentence too, byte for byte, beside the field", async () => {
  const forms = await followUpForms();
  assert.ok(forms.length >= NAMED_PAGES.length, "no follow-up form was found at all");

  for (const { file, form, field, submit } of forms) {
    // Same discovery rule as the sentence above it: read out of the shipped
    // markup, matched whole. A form that carries one claim and not the other
    // leaves a visitor a question the page next door answers.
    const order = form.querySelectorAll("input,p,button");
    const at = (node) => order.indexOf(node);
    const uses = order.filter((node) => textOf(node) === FOLLOW_UP_USE);
    assert.equal(uses.length, 1, `${file}: the use sentence renders ${uses.length} times in one form`);
    assert.ok(at(field) < at(uses[0]), `${file}: the use sentence is above the field it describes`);
    assert.ok(at(uses[0]) < at(submit), `${file}: the use sentence is below the button it should precede`);

    // It is on the page before anything is submitted, rather than in a receipt
    // or a retry: it is what a visitor weighs while deciding whether to type.
    assert.ok(!uses[0].hidden, `${file}: the use sentence ships hidden`);

    // The hint style the privacy sentence already uses — no new class, and so
    // no new colour, size, or spacing to pay for in a stylesheet with none left.
    const note = form.querySelectorAll("p").find((node) => textOf(node) === expectedPrivacy(file));
    assert.equal(uses[0].getAttribute("class"), note.getAttribute("class"),
      `${file}: the use sentence must reuse the form-hint style, not introduce one`);
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
    assert.equal(textOf(note), expectedPrivacy(file), `${file}: the privacy sentence has drifted`);

    // And the sentence agrees with the form under it. A form with a message box
    // must not claim nothing else is sent; a form without one must not describe
    // a field a visitor cannot see, which would be the same lie the other way.
    assert.equal(Boolean(form.querySelector("#site-footer-message")), ASKS_MESSAGE.has(file),
      `${file}: the shipped message field disagrees with the sentence it is held to`);
  }
});

test("the sentence sits between the work-email field and the submit button, once", async () => {
  for (const { file, form, field, submit } of await followUpForms()) {
    // Document order inside the form: field, then note, then the control that
    // sends. A claim a reader meets after pressing the button is not a claim
    // they got to weigh.
    const order = form.querySelectorAll("input,p,button");
    const at = (node) => order.indexOf(node);
    const notes = order.filter((node) => textOf(node) === expectedPrivacy(file));
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
  // Three paragraphs, all shared with every other page: who runs Shiplog, who
  // it is for, and — since #2152 — the repository line that lets a reader check
  // the first of those from outside. None of them explains this link; a clear
  // label does that.
  const paragraphs = footer.querySelectorAll("p");
  assert.equal(paragraphs.length, 3,
    "the About block keeps the shared paragraphs and no explanation of the link");
  for (const paragraph of paragraphs) {
    assert.doesNotMatch(textOf(paragraph), /follow-up form|form below|which form|carries its own/i,
      "the About block must explain the link with the link, not with a paragraph");
  }

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
