// The follow-up conversion path, on both surfaces that show a decision brief.
//
// A visitor who has just read a figure — the AI FinOps result, or the one-page
// executive briefing — must be able to ask about it without hunting, must be
// told what leaves the browser before they type anything, and must be left with
// something to do once the address lands.
//
// What is pinned here, in the order it would hurt if it broke:
//
//   1. The confirmation opens with "Follow-up requested". This is the exact
//      string a prior regression got wrong on the AI FinOps surface, where the
//      form said "Sent —" while the rest of the site said "Follow-up requested".
//      Both confirmations — the new address and the repeat — are asserted from
//      the top of the sentence, on both surfaces, because the live region reads
//      it out with no other context.
//   2. The contextual invitation works. A control beside the brief opens the
//      form and puts the cursor in the field, by mouse and by keyboard alike,
//      and a second press does not take the form away again.
//   3. The privacy claim is visible before the visitor commits, and it is true:
//      the request body is the typed address and nothing else.
//   4. There is a usable next action after the confirmation, it is a real link,
//      it is keyboard reachable, and it does not exist before a success.
//
// Both pages run for real: shipped markup, real page entry, only the network
// stubbed — which is the subject, because the claim beside these forms is about
// what leaves the browser.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, pressEnter, pressKey, pressTab, tabSequence, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const EVOLUTION_PAGE = new URL("../src/evolution.html", import.meta.url);
const BRIEFING_PAGE = new URL("../src/executive-briefing.html", import.meta.url);

const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));
const BRIEFING_FIXTURE_PATH = "/executive-finops-briefing-fixture.json";
const BRIEFING_FIXTURE = JSON.parse(
  await readFile(new URL("../src/executive-finops-briefing-fixture.json", import.meta.url), "utf8"));

const TYPED_EMAIL = "director@example.com";

/** The exact opening this issue exists to settle, on every confirmation. */
const CAPTURED_OPENING = /^Follow-up requested — we sent your email address, and nothing else\./;
const ALREADY_CAPTURED_OPENING = /^Follow-up requested — that address is already on our list/;

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));

/**
 * Take over POST /api/leads and record what the page hands the network. Every
 * other request keeps going to the page's own fixture router.
 */
function interceptLeads(reply) {
  const passthrough = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    if (url !== "/api/leads") return passthrough(url, options);
    calls.push({ url, options });
    return reply(calls.length);
  };
  return calls;
}

const jsonReply = (body, status = 201) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

/** Tab from wherever focus is until a control is reached; no mouse involved. */
function tabTo(document, id) {
  const stops = tabSequence(document).length;
  for (let step = 0; step <= stops; step += 1) {
    const focused = pressTab(document);
    if (focused?.id === id) return focused;
  }
  return assert.fail(`"${id}" is not reachable by Tab; a keyboard user cannot reach it.`);
}

/** Type an address into a disclosed form and submit it from the keyboard. */
function submitEmail(document, prefix, value) {
  const field = byId(document, `${prefix}-email`);
  field.value = "";
  field.focus();
  typeText(document, value);
  pressEnter(document);
}

const settled = (document, prefix) => waitFor(
  () => ["success", "error"].includes(byId(document, `${prefix}-form`).dataset.state),
  "the contact submission to settle");

async function openFinopsTab() {
  const page = await loadPage(EVOLUTION_PAGE, {
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  // Every asynchronous surface the page starts on load is waited out here, so
  // none of them is still running when a test restores the globals.
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  await waitFor(() => shownText(document, "integration-contract-provenance").startsWith("Gateway completed"),
    "the static contract gateway to settle");
  await waitFor(() => byId(document, "finops-evaluation-result").getAttribute("aria-busy") === "false",
    "the evaluation panel to settle");
  return page;
}

async function openBriefingTab() {
  const page = await loadPage(BRIEFING_PAGE, { routes: { [BRIEFING_FIXTURE_PATH]: BRIEFING_FIXTURE } });
  await importPageModule("/executive-briefing-page.js");
  await waitFor(() => byId(page.document, "executive-briefing").getAttribute("aria-busy") === "false",
    "the briefing to finish painting");
  return page;
}

// --- the contextual invitation ---------------------------------------------

test("the AI FinOps result carries an invitation beside it that opens the form and lands in the field", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    const cta = byId(document, "finops-result-followup").querySelector("[data-follow-up-cta]");
    assert.equal(cta.tagName, "BUTTON", "the invitation must be a real button, not a clickable div");
    assert.equal(cta.getAttribute("type"), "button");
    assert.equal(cta.getAttribute("data-follow-up-cta"), "finops-contact");
    assert.equal(cta.getAttribute("aria-controls"), "finops-contact-panel");
    assert.ok(tabSequence(document).includes(cta), "the invitation must be in the tab order");

    // It sits beside the brief, never inside the region a re-render replaces.
    assert.equal(byId(document, "finops-result-followup").closest("#local-results"), null);

    // Reached and pressed from the keyboard alone.
    assert.equal(tabTo(document, "finops-followup-cta"), cta);
    pressEnter(document);
    assert.equal(byId(document, "finops-contact-panel").hidden, false, "the invitation must open the form");
    assert.equal(byId(document, "finops-contact-open").getAttribute("aria-expanded"), "true",
      "the disclosure trigger must agree with the panel it controls");
    assert.equal(document.activeElement?.id, "finops-contact-email",
      "the invitation must land the cursor in the field, not merely reveal it");

    // Pressing it again is never a way to lose the form: it re-focuses instead.
    byId(document, "finops-contact-open").focus();
    cta.click();
    assert.equal(byId(document, "finops-contact-panel").hidden, false);
    assert.equal(document.activeElement?.id, "finops-contact-email");
  } finally {
    page.restore();
  }
});

test("the invitation states, before anything is typed, that only the address is submitted", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    const note = shownText(document, "finops-result-followup").toLowerCase();
    assert.match(note, /only the work email address you type is submitted/);
    for (const attachment of ["file", "figure", "column value", "department name", "prompt text"])
      assert.ok(note.includes(attachment), `the claim must name ${attachment} among what is not attached`);
    // And it claims nothing this page has not shown.
    for (const claim of [/customers?\b/i, /trusted by/i, /\bROI\b/i, /realized/i, /\$\s*\d/])
      assert.doesNotMatch(shownText(document, "finops-result-followup"), claim);
  } finally {
    page.restore();
  }
});

// --- the confirmation, and the string a prior regression got wrong ----------

test("the AI FinOps confirmation begins with “Follow-up requested”, both times", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  interceptLeads((call) => jsonReply({ subscribed: call === 1 }, call === 1 ? 201 : 200));
  try {
    byId(document, "finops-result-followup").querySelector("[data-follow-up-cta]").click();
    submitEmail(document, "finops-contact", TYPED_EMAIL);
    await settled(document, "finops-contact");

    const confirmation = shownText(document, "finops-contact-status");
    assert.match(confirmation, CAPTURED_OPENING);
    assert.match(confirmation, /within two business days/);

    submitEmail(document, "finops-contact", TYPED_EMAIL);
    await waitFor(() => shownText(document, "finops-contact-status").includes("already on our list"),
      "the already-captured confirmation");
    assert.match(shownText(document, "finops-contact-status"), ALREADY_CAPTURED_OPENING);
  } finally {
    page.restore();
  }
});

test("a successful request leaves a usable next action, and a failed one leaves none", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  let failNext = false;
  interceptLeads(() => (failNext
    ? jsonReply({ error: { code: "storage_unavailable", message: "unavailable" } }, 503)
    : jsonReply({ subscribed: true })));
  try {
    byId(document, "finops-contact-open").click();
    const next = byId(document, "finops-contact-next");
    assert.equal(next.hidden, true, "there is nothing to do next before a request succeeds");
    assert.ok(!tabSequence(document).includes(next.querySelector("a")),
      "a hidden next action must contribute no tab stop");

    submitEmail(document, "finops-contact", TYPED_EMAIL);
    await settled(document, "finops-contact");

    assert.equal(next.hidden, false, "a confirmed request must leave somewhere to go");
    const link = next.querySelector("a");
    assert.equal(link.getAttribute("href"), "/executive-briefing.html", "the next action must be a real destination");
    assert.ok(textOf(link).length > 0, "the next action needs a label a reader can act on");
    assert.ok(tabSequence(document).includes(link), "the next action must be keyboard reachable");
    // It is a place to go, not a description of the field.
    assert.doesNotMatch(byId(document, "finops-contact-email").getAttribute("aria-describedby"),
      /finops-contact-next/);

    // A later failure retracts it: there is nothing to do next after a request
    // that did not land.
    failNext = true;
    submitEmail(document, "finops-contact", TYPED_EMAIL);
    await settled(document, "finops-contact");
    assert.equal(byId(document, "finops-contact-form").dataset.state, "error");
    assert.equal(next.hidden, true);
  } finally {
    page.restore();
  }
});

// --- the executive briefing surface ----------------------------------------

test("the executive briefing carries the same invitation, keyboard-operable, beside the document", async () => {
  const page = await openBriefingTab();
  const { document } = page;
  try {
    const section = byId(document, "briefing-contact");
    assert.ok(section, "the briefing must offer a way to ask about it");
    // Outside the painted region, so a repaint of the briefing cannot unmount it.
    assert.equal(section.closest("#executive-briefing"), null);
    // The briefing itself is still on screen and still says what it says.
    assert.ok(document.querySelector(".brief"), "the briefing document must still be painted");

    const trigger = tabTo(document, "briefing-contact-open");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(byId(document, "briefing-contact-panel").hidden, true);
    assert.ok(!tabSequence(document).includes(byId(document, "briefing-contact-email")),
      "a collapsed form must contribute no tab stops");

    pressEnter(document);
    assert.equal(byId(document, "briefing-contact-panel").hidden, false);
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.equal(document.activeElement?.id, "briefing-contact-email");

    pressKey(document, "Escape");
    assert.equal(byId(document, "briefing-contact-panel").hidden, true);
    assert.equal(document.activeElement, trigger, "dismissing must return focus to the control that opened it");
  } finally {
    page.restore();
  }
});

test("the briefing form sends the typed address and nothing from the briefing, and says so", async () => {
  const page = await openBriefingTab();
  const { document } = page;
  const calls = interceptLeads(() => jsonReply({ subscribed: true }));
  try {
    // The figures this page is showing when the request goes out. If it were
    // showing none, the assertion below could not mean anything.
    const figure = textOf(document.querySelector(".brief-figure"));
    assert.ok(figure.length > 0, "the briefing must be showing a figure for this test to mean anything");

    const note = shownText(document, "briefing-contact-note");
    assert.match(note, /This form sends one thing: the work email address you type/);
    assert.match(note, /No figure, period, limitation, file, or prompt text from this briefing/);
    // Named outright rather than left to be inferred from "nothing else": the
    // two things a reader is actually worried about are the figures they just
    // read and the export they opened on the AI FinOps page.
    assert.match(note, /briefing figures on this page and any files you imported[^.]*are never transmitted/i);
    assert.match(note, /they stay in this browser/i);

    byId(document, "briefing-contact-open").click();
    submitEmail(document, "briefing-contact", TYPED_EMAIL);
    await settled(document, "briefing-contact");

    assert.equal(calls.length, 1, "one submission must produce exactly one request");
    const [{ url, options }] = calls;
    assert.equal(url, "/api/leads");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { email: TYPED_EMAIL });
    assert.deepEqual(Object.keys(JSON.parse(options.body)), ["email"]);

    const transmitted = `${url} ${JSON.stringify(options.headers)} ${options.body}`;
    for (const secret of [figure, ...figure.replace(/[^0-9.]/g, " ").trim().split(/\s+/)].filter((v) => v.length > 2))
      assert.ok(!transmitted.includes(secret), `"${secret}" is on screen and must never be in the request`);

    // The confirmation, and the next action it leaves behind.
    assert.match(shownText(document, "briefing-contact-status"), CAPTURED_OPENING);
    const next = byId(document, "briefing-contact-next");
    assert.equal(next.hidden, false);
    assert.equal(next.querySelector("a").getAttribute("href"), "/evolution.html");
    assert.ok(tabSequence(document).includes(next.querySelector("a")));

    // And the briefing above is exactly where it was.
    assert.equal(textOf(document.querySelector(".brief-figure")), figure);
  } finally {
    page.restore();
  }
});

test("the briefing form diagnoses a bad address at the field and never reaches the network", async () => {
  const page = await openBriefingTab();
  const { document } = page;
  const calls = interceptLeads(() => jsonReply({ subscribed: true }));
  try {
    byId(document, "briefing-contact-open").click();
    submitEmail(document, "briefing-contact", "director at example");
    assert.equal(calls.length, 0, "a malformed address must not reach the network");

    const field = byId(document, "briefing-contact-email");
    assert.equal(byId(document, "briefing-contact-error").hidden, false);
    assert.equal(field.getAttribute("aria-invalid"), "true");
    assert.match(field.getAttribute("aria-describedby"), /briefing-contact-error/,
      "the diagnostic must be associated with the input, not merely near it");
    assert.equal(document.activeElement, field, "focus must be on the field the visitor has to fix");
    assert.equal(field.value, "director at example", "the field must keep what the visitor typed");
    assert.equal(byId(document, "briefing-contact-recovery").hidden, true,
      "a validation failure is not a submission failure");
    assert.equal(byId(document, "briefing-contact-next").hidden, true);
  } finally {
    page.restore();
  }
});

// --- narrow viewports and print --------------------------------------------

test("both invitations are usable on a narrow viewport, and the briefing's never prints", async () => {
  const evolutionCss = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
  const briefingCss = await readFile(new URL("../src/executive-briefing.css", import.meta.url), "utf8");

  // A thumb gets the whole width rather than a target to aim at.
  assert.match(evolutionCss, /\.finops-followup-cta-button \{ width:100%; \}/);
  assert.match(briefingCss, /\.brief-contact-trigger \{ width:100%; \}/);
  // Targets are at least the 44px this repository already holds itself to.
  assert.match(evolutionCss, /\.finops-followup-cta-button \{ min-height:44px;/);
  assert.match(briefingCss, /\.brief-contact-trigger \{ min-height:44px;/);
  // A form on paper is a dead control: it goes with the rest of the chrome.
  const print = briefingCss.slice(briefingCss.indexOf("@media print"));
  assert.match(print, /^[\s\S]*\.brief-contact[^{]*\{ display:none !important; \}/);
});
