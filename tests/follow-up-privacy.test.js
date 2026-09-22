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
import { FOLLOW_UP_PRIVACY, FOLLOW_UP_PRIVACY_WITH_MESSAGE, FOLLOW_UP_REPLY, FOLLOW_UP_USE } from "../src/lead-capture.js";
import { INTENT_QUESTION } from "../src/site-footer.js";
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
/**
 * A clock, in any of the shapes one gets quoted in.
 *
 * The block below the field now says who answers, and that is the one thing it
 * is allowed to promise: this repository has no queue, no rota and no way to
 * hold anybody to a deadline, so a response time here would be a number the
 * product cannot keep. Held against every follow-up block on the site rather
 * than against the sentence alone, because "we usually reply within a day" is
 * the kind of reassurance that gets added to one page at a time.
 */
const SPEED = /business day|within \d|\bhours?\b|\bminutes?\b|\bsoon\b|\bquickly\b|\bimmediately\b|\bright away\b/i;

// Neither sentence beside the field may read as a brochure.
const MARKETING = [/\bwe (?:will )?never\b/i, /\brest assured\b/i, /\bsecurely\b/i, /\bof course\b/i,
  /\bsimply\b/i, /\bprivacy[- ]first\b/i];

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
  // A longer budget than the sentence above, because it names four things
  // rather than one (#2365 added what you want to discuss). Still one sentence.
  assert.ok(words.length <= 34, `the sentence is ${words.length} words; the budget is 34`);
  assert.match(FOLLOW_UP_PRIVACY_WITH_MESSAGE, /what you want to discuss/, "it must name the intent it sends");
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
  //
  // #2407: the topic is named by pointing at the line that states it — "This
  // request is sent about the Social page — …", or the homepage example form's
  // read-only topic field — rather than by "this fixed follow-up topic", which
  // matched no label, heading or control a visitor could find. The old phrase
  // is held gone, so it cannot come back one page at a time.
  //
  // #2488: "the topic shown above" matched no label either, and read as the
  // "What do you want to discuss?" group. It now names the page, which is
  // what the "This request is sent about the … page" line states.
  assert.match(FOLLOW_UP_PRIVACY_WITH_MESSAGE, /the page named above/, "it must name the page it sends");
  assert.doesNotMatch(FOLLOW_UP_PRIVACY_WITH_MESSAGE, /topic shown above/,
    "no element on the form is labelled topic");
  assert.doesNotMatch(FOLLOW_UP_PRIVACY_WITH_MESSAGE, /fixed follow-up topic/,
    "the topic must be named in words the page carries, not an internal one");
  // #2431: the optional field is labelled "Anything else we should know?", so
  // the sentence names it in the visitor's words rather than calling it "the
  // message you type", which matched no label on the form either.
  assert.match(FOLLOW_UP_PRIVACY_WITH_MESSAGE, /anything else you type/,
    "it must name the optional field in the words its label uses");
  assert.doesNotMatch(FOLLOW_UP_PRIVACY_WITH_MESSAGE, /message you type/,
    "the sentence must not name the field something no label on the form says");
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

test("the reply sentence says who answers, and starts no clock", () => {
  // The third question a visitor asks at this field, after where the address
  // goes and what it is used for: what comes back. It was unanswered, and the
  // answer a first-time reader assumed — an autoresponder — is the one thing
  // that does not happen. So: a person, named as the team the sentence above
  // already names, replying to the address being typed.
  const words = FOLLOW_UP_REPLY.split(/\s+/).filter(Boolean);
  assert.ok(words.length <= 25, `the sentence is ${words.length} words; the budget is 25`);
  assert.equal(FOLLOW_UP_REPLY.at(-1), ".");
  assert.equal((FOLLOW_UP_REPLY.match(/[.!?]/g) ?? []).length, 1, "one sentence, not two");

  assert.match(FOLLOW_UP_REPLY, /A person from the Wawalu team that operates Shiplog/,
    "it must name a person, on the team the privacy sentence already names");
  assert.match(FOLLOW_UP_REPLY, /replies by email to the address you give/,
    "it must say the reply comes by email, to the address being typed");
  assert.match(FOLLOW_UP_REPLY, /no automated reply/, "it must say that nothing automated answers");

  // A promise about who, never about when. No figure, and no word that reads
  // as one — see SPEED.
  assert.doesNotMatch(FOLLOW_UP_REPLY, SPEED, "the sentence must promise a person, not a deadline");
  assert.doesNotMatch(FOLLOW_UP_REPLY, /\d/, "no number belongs in a promise about who answers");
  for (const filler of MARKETING) {
    assert.doesNotMatch(FOLLOW_UP_REPLY, filler, `the sentence must not read as marketing: ${filler}`);
  }
});

test("every follow-up form renders the reply sentence too, byte for byte, above the button", async () => {
  const forms = await followUpForms();
  assert.ok(forms.length >= NAMED_PAGES.length, "no follow-up form was found at all");

  for (const { file, form, field, submit } of forms) {
    const order = form.querySelectorAll("input,p,button");
    const at = (node) => order.indexOf(node);
    const replies = order.filter((node) => textOf(node) === FOLLOW_UP_REPLY);
    assert.equal(replies.length, 1, `${file}: the reply sentence renders ${replies.length} times in one form`);
    assert.ok(at(field) < at(replies[0]), `${file}: the reply sentence is above the field it describes`);
    assert.ok(at(replies[0]) < at(submit), `${file}: the reply sentence is below the button it should precede`);

    // What a visitor weighs before typing, not something a receipt tells them
    // afterwards — the same rule the two sentences above it follow.
    assert.ok(!replies[0].hidden, `${file}: the reply sentence ships hidden`);
    const note = form.querySelectorAll("p").find((node) => textOf(node) === expectedPrivacy(file));
    assert.equal(replies[0].getAttribute("class"), note.getAttribute("class"),
      `${file}: the reply sentence must reuse the form-hint style, not introduce one`);

    // Three sentences, not one long one. The use sentence is a separate claim
    // about a separate thing, and folding this into it would put a promise
    // about a person inside a sentence that deliberately makes none.
    const uses = form.querySelectorAll("p").filter((node) => textOf(node) === FOLLOW_UP_USE);
    assert.equal(uses.length, 1, `${file}: the use sentence must survive this one, whole and on its own`);
  }
});

test("no follow-up block on the site quotes a response time", async () => {
  for (const { file, form } of await followUpForms()) {
    assert.doesNotMatch(textOf(form), SPEED,
      `${file}: the follow-up block quotes a response time nobody here can keep`);
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

test("the message form's sentence names the page the line above it states", async () => {
  // #2488: "the topic shown above" pointed at nothing labelled topic. The
  // sentence now says "the page named above", and on every page that ships it
  // that page is named above it, by the "This request is sent about the … page"
  // line, so the pointer lands on words a visitor can find.
  const seen = new Set();
  for (const { file, form } of await followUpForms()) {
    if (!ASKS_MESSAGE.has(file)) continue;
    seen.add(file);
    const order = form.querySelectorAll("p");
    const note = order.find((node) => textOf(node) === expectedPrivacy(file));
    assert.match(textOf(note), /the page named above/, `${file}: the sentence does not name the page`);
    assert.doesNotMatch(textOf(note), /topic shown above/, `${file}: the old pointer is back`);
    const line = form.querySelector("#site-footer-topic-note");
    assert.ok(line, `${file}: nothing above the sentence names the page`);
    assert.match(textOf(line), /^This request is sent about the .+ page — /, `${file}: the line names no page`);
    assert.ok(order.indexOf(line) < order.indexOf(note), `${file}: the page is named below the sentence`);
  }
  assert.deepEqual([...seen].sort(), [...ASKS_MESSAGE].sort(), "a page that asks a message was not found");
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

/**
 * The two questions on a form that asks one, and why they may not rhyme.
 *
 * The required fieldset asks what the request is about; the optional field
 * beneath it asks for everything that choice cannot carry. Both used to open
 * "What do you want to" — discuss, then know — and a first-time visitor reading
 * them in order had no way to tell which one wanted what, or why the same
 * question was being asked twice. The label below is the answer to the second
 * one, in words the privacy sentence under the address repeats.
 */
const OPTIONAL_QUESTION = "Anything else we should know? (optional)";

test("the optional field asks something the question above it did not", async () => {
  const asked = new Set();
  for (const { file, form } of await followUpForms()) {
    // Read out of the shipped markup, like every sentence above: a label only
    // src/site-footer.js agrees with is not the one a visitor reads.
    const openings = form.querySelectorAll("label,legend")
      .filter((node) => textOf(node).startsWith("What do you want to"));
    if (!form.querySelector("#site-footer-message")) {
      assert.equal(openings.length, 0, `${file}: a form with no optional field still asks for one`);
      continue;
    }
    asked.add(file);

    const label = form.querySelectorAll("label").find((node) => node.getAttribute("for") === "site-footer-message");
    assert.equal(textOf(label), OPTIONAL_QUESTION, `${file}: the optional field's label has drifted`);

    // The required question keeps its own words, and is now the only one on the
    // form that opens this way.
    assert.equal(textOf(form.querySelector("legend")), INTENT_QUESTION,
      `${file}: the question about the topic has drifted`);
    assert.equal(openings.length, 1,
      `${file}: two questions on one form open "What do you want to" and read as one asked twice`);
  }
  assert.deepEqual([...asked].sort(), [...ASKS_MESSAGE].sort(),
    "every page that ships the optional field must be held to its label");
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
    // #2407: the one item in the list that was named in the site's own
    // vocabulary rather than the visitor's. Every page it shipped on now points
    // at the topic line above the field instead.
    "this fixed follow-up topic",
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
