import test from "node:test";
import assert from "node:assert/strict";

import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";
import { importPageModule } from "./support/page-module.js";
import {
  ANALYZED_PERIOD, bindFinopsExampleFollowUp, EXECUTIVE_TAKEAWAY,
  FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE, TAKEAWAY_COPY_FEEDBACK, takeawayText,
} from "../src/homepage-executive-takeaway.js";
import { analyzedPeriodPhrase, EXAMPLE_MONTHS, reportingWindow } from "../src/analyzed-period.js";
import { loadExampleDataset } from "../src/example-dataset.js";
import { onRequest } from "../functions/api/leads.js";
import { createTestD1 } from "./support/d1-sqlite.js";
import { buildStandHeadline } from "../src/finops-stand.js";
import { buildFirstRunResult } from "../src/finops-first-run.js";

const PAGE = new URL("../src/index.html", import.meta.url);
const NativeResponse = globalThis.Response;

// The recipient half is the footer's, word for word (`FOLLOW_UP_PRIVACY` in
// src/lead-capture.js); the rest is this form's, because this form posts the
// readonly topic field beside the address and the footer's "nothing else on
// this page is sent" would be a claim its own request breaks.
const DISCLOSURE = "The work email address you type here goes to the Wawalu team that operates Shiplog;"
  + " only that address and this fixed follow-up topic are sent.";

async function openTakeaway(t, clipboard) {
  const page = await loadPage(PAGE);
  t.after(() => page.restore());
  Object.defineProperty(globalThis.navigator, "clipboard", { value: clipboard, configurable: true });
  await importPageModule("/homepage-executive-takeaway.js");
  return page.document;
}

test("the homepage visibly labels a concise, qualified executive takeaway", async (t) => {
  const document = await openTakeaway(t, { writeText: async () => {} });
  const region = document.querySelector(".executive-takeaway");
  const text = textOf(document.getElementById("executive-takeaway-text"));

  assert.equal(region.getAttribute("aria-labelledby"), "executive-takeaway-title");
  assert.equal(textOf(document.getElementById("executive-takeaway-title")), "Executive takeaway");
  assert.equal(text, EXECUTIVE_TAKEAWAY);
  assert.match(text, /\$51,254 of \$154,500/);
  assert.match(text, /33%/);
  assert.match(text, /Pilot lower-cost routing in Atlas Platform/);
  assert.match(text, /Accountable role: Platform Engineering Lead/);
  assert.match(text, /bundled synthetic example and are not visitor data/);
  // A takeaway written to be forwarded is the worst place on the site to drop
  // the limit on this figure: read alone, "$51,254 is recoverable" is a saving
  // somebody can be held to. It travels with the ceiling or it does not travel.
  assert.match(text, /modelled ceiling on what re-routing this work could save, not money already saved/);
});

test("the rendered figure sentence says which months it is true over", async (t) => {
  const document = await openTakeaway(t, { writeText: async () => {} });
  const text = textOf(document.getElementById("executive-takeaway-text"));

  // #1745: forwarded on its own, the figure line drew one reply — "over what
  // period?" — and neither the line nor the person who sent it could answer.
  // #1858: naming the month was not enough. The block below states that the
  // example ships three synthetic months, so "across June 2026" beside a
  // $154,500 total still left a reader unable to tell a month's money from a
  // quarter's. "alone" is the word that settles it, and it is pinned here.
  assert.equal(ANALYZED_PERIOD, "June 2026");
  assert.ok(text.includes(`is recoverable (33%) in ${ANALYZED_PERIOD} alone —`),
    `the rendered takeaway does not carry the derived period: ${text}`);
  // The span rides on the figure sentence, so it cannot be read as a claim of
  // its own and cannot displace anything above the fold.
  assert.doesNotMatch(text, /\(33%\) in\s+(?:alone|—)|undefined/);
  assert.match(text, /Figures are from a bundled synthetic example and are not visitor data\.$/);
});

test("the analyzed period is derived from the bundled months, not written down", () => {
  // THE ANTI-FAKE TEST. The period the takeaway prints is the window the
  // $154,500 was summed over, which is the last month `example-dataset.js` cuts
  // its provider exports into. Held here against the envelope the analysis
  // actually publishes, so an authored "June 2026" that stopped being true
  // fails rather than forwarding a stale window to somebody's boss.
  assert.equal(reportingWindow(EXAMPLE_MONTHS), loadExampleDataset().period);
  assert.equal(ANALYZED_PERIOD, analyzedPeriodPhrase(loadExampleDataset().period));

  // And it MOVES. Different bundled months, different sentence — same code path,
  // no fixture file, nothing about "June" anywhere in the derivation.
  assert.equal(analyzedPeriodPhrase(reportingWindow(["2027-02", "2027-03"])), "March 2027");
  assert.ok(takeawayText(analyzedPeriodPhrase(reportingWindow(["2027-02", "2027-03"])))
    .includes("is recoverable (33%) in March 2027 alone —"));
  // Whole-month spans and year boundaries are named in calendar words too: a
  // window this cannot say in English must not reach a reader as an ISO string.
  assert.equal(analyzedPeriodPhrase("2026-01-01 to 2026-07-01"), "January–June 2026");
  assert.equal(analyzedPeriodPhrase("2025-11-01 to 2026-02-01"), "November 2025–January 2026");
  for (const unusable of [null, "", "P3M", "2026-06", "2026-06-15 to 2026-07-04", "not a window"]) {
    assert.equal(analyzedPeriodPhrase(unusable), null, `named a window it cannot read: ${unusable}`);
  }
  assert.equal(reportingWindow([]), null);
  assert.equal(reportingWindow(["nope"]), null);
});

test("with no nameable period the takeaway degrades to its wording rather than a stray clause", () => {
  // The first entry is the whole chain a monthless bundled example would take:
  // no usable month, so no window, so no phrase, so no clause.
  for (const empty of [analyzedPeriodPhrase(reportingWindow([])), null, "", "   "]) {
    const degraded = takeawayText(empty);
    assert.ok(degraded.includes("is recoverable (33%) — a modelled ceiling"),
      `the degraded takeaway is not the unqualified sentence: ${degraded}`);
    assert.doesNotMatch(degraded, /\balone\b|undefined|null/);
    // Everything else the takeaway owes a reader survives the missing period.
    assert.match(degraded, /First recommended action: Pilot lower-cost routing in Atlas Platform\./);
    assert.match(degraded, /Accountable role: Platform Engineering Lead\./);
    assert.match(degraded, /bundled synthetic example and are not visitor data\./);
  }
});

test("the recoverable figure is stated once on the first screen, and it is stated here", async (t) => {
  const document = await openTakeaway(t, { writeText: async () => {} });
  const hero = textOf(document.getElementById("top"));
  const intro = textOf(document.querySelector(".hero-proof-point"));
  const takeaway = textOf(document.getElementById("executive-takeaway-text"));
  const times = (text, figure) => text.split(figure).length - 1;

  // #1544: the paragraph above the takeaway used to state the same pair and the
  // same rate a line before it, so the first screen made one claim twice and a
  // reader had to compare two sentences to find out it was one claim. The
  // takeaway is the copyable, qualified version, so it keeps the money.
  // #1768: the follow-up form under the takeaway restated $51,254 to caveat it a
  // second time. Each figure now reads once on the first screen, in the takeaway.
  for (const figure of ["$51,254", "$154,500", "33%"]) {
    assert.equal(times(hero, figure), 1, `the first screen states ${figure} ${times(hero, figure)} times`);
    assert.equal(times(takeaway, figure), 1, `the takeaway must be where ${figure} is stated`);
  }

  // The paragraph still does its own job: it names where the decision lives,
  // says what the example is, and says what reading it costs. It just does not
  // do the takeaway's job as well.
  assert.match(intro, /AI FinOps publishes a worked decision/);
  assert.match(intro, /bundled synthetic example/);
  assert.match(intro, /no export of yours, no sign-in, and no account/);
  assert.doesNotMatch(intro, /\$[\d,]+|\d+%/,
    "the paragraph that introduces the example must not restate the figures the takeaway carries");
});

/** Everything a visitor reads above the "Executive takeaway" heading. */
function leadOf(document) {
  const read = [];
  for (const child of document.getElementById("top").childElements) {
    if (child.classList.contains("executive-takeaway")) break;
    read.push(textOf(child));
  }
  return read.join(" ");
}

test("the lead above the takeaway states the question, once, with no figure in it", async (t) => {
  const document = await openTakeaway(t, { writeText: async () => {} });
  const lead = leadOf(document);
  const sentences = lead.split(/(?<=[.?])\s+/).filter(Boolean);

  // #1767: the lead used to refer a first-time visitor to an increase this
  // page had never described. It states the question the worked decision
  // answers instead, and it names the page that answers it.
  assert.doesNotMatch(lead, /driving the increase/);
  assert.doesNotMatch(lead, /the (?:rise|growth|spike|trend|increase)\b/i,
    "no sentence in the lead may refer to a change this page has not described");
  const question = sentences.find((sentence) => sentence.includes("AI FinOps"));
  assert.ok(question, "one sentence in the lead must name the page the decision lives on");
  assert.ok(question.split(/\s+/).length <= 30,
    `the question runs to ${question.split(/\s+/).length} words`);
  assert.match(question, /where do we stand on AI spend, and what should we do first\?/);

  // Said once and said plainly: the caveat is one sentence here, not the three
  // restatements this block used to carry, and it is not a trailing clause.
  assert.equal(lead.split("bundled synthetic example").length - 1, 1,
    "the lead must name the sample data exactly once");
  assert.ok(sentences.includes("Reading it takes no export of yours, no sign-in, and no account."),
    "what reading the example costs must be its own sentence");
  assert.doesNotMatch(lead, /\$[\d,]+|\d/,
    "no figure may read above the Executive takeaway heading");
});

test("the homepage names the sample data one way and caveats each block once", async (t) => {
  const document = await openTakeaway(t, { writeText: async () => {} });
  const page = textOf(document.body);
  const times = (phrase) => page.split(phrase).length - 1;

  // #1768: one phrase for one thing, everywhere the front door names it.
  assert.equal(times("bundled synthetic data"), 0,
    "the homepage calls its sample data a bundled synthetic example, not bundled synthetic data");
  // The long form belongs to the block that has to draw a contrast: this figure
  // is counted, those are not. Said anywhere else it is a second explanation of
  // something already explained.
  assert.equal(times("computed from invented data for an invented company"), 1,
    "only the counted-figure block spells out what the sample data is made of");
  assert.match(textOf(document.getElementById("public-merges")),
    /belongs to a bundled synthetic example, computed from invented data for an invented company\. This one is counted from public GitHub activity/);
  // The log's proof point keeps its own words: it is describing records, not
  // figures, and it is the one block allowed to say so in its own vocabulary.
  assert.equal(times("These invented records demonstrate Shiplog. They use no customer or production data."), 1);
});

async function openContextualFollowUp(t, request) {
  const page = await loadPage(PAGE);
  t.after(() => page.restore());
  bindFinopsExampleFollowUp(page.document, request);
  return page.document;
}

const reply = (body, status = 201) => new NativeResponse(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

test("the adjacent CTA opens a contextual work-email request that says what is sent", async (t) => {
  const document = await openContextualFollowUp(t, async () => reply({ captured: true, created: true }));
  const open = document.getElementById("finops-example-follow-up-open");
  const panel = document.getElementById("finops-example-follow-up-panel");
  assert.match(textOf(open), /follow-up about this bundled AI FinOps example/i);
  assert.equal(panel.hidden, true);
  open.click();
  assert.equal(panel.hidden, false);
  assert.equal(document.activeElement?.id, "finops-example-follow-up-email");
  // The site's one name for this field, the one src/site-footer.js renders on
  // every other follow-up form.
  assert.equal(textOf(document.querySelector('label[for="finops-example-follow-up-email"]')),
    "Work email for your follow-up");
  assert.match(document.getElementById("finops-example-follow-up-topic").value, /Atlas Platform|lower-cost routing/);
  // #1768: this form used to caveat $51,254 a second time, in a second
  // vocabulary, a line under the paragraph that already caveats it. It states
  // the one thing only a form can state now.
  //
  // #1968: and it names the recipient, in the words every other follow-up form
  // on the site uses, above the button rather than under it — this was the one
  // form on the site that asked for a work email without saying who reads it.
  const disclosure = document.getElementById("finops-example-follow-up-disclosure");
  assert.equal(textOf(disclosure), DISCLOSURE);
  const form = document.getElementById("finops-example-follow-up-form");
  const order = form.querySelectorAll("input,p,button");
  assert.ok(order.indexOf(document.getElementById("finops-example-follow-up-email")) < order.indexOf(disclosure),
    "the sentence sits below the field it describes");
  assert.ok(order.indexOf(disclosure) < order.indexOf(form.querySelector('button[type="submit"]')),
    "a claim a reader meets after pressing the button is not one they got to weigh");
  // Once. Two sentences making the same promise is how a reader ends up
  // deciding whether two wordings mean two promises. Counted over the whole
  // first screen since #1974 moved the panel below the worked-decision link:
  // the takeaway card no longer contains it, and a scope that stopped at the
  // card would count zero and pass.
  assert.equal(textOf(document.getElementById("top")).split("are sent").length - 1, 1,
    "the panel states what is sent exactly once");
});

test("the takeaway and the form under it state the sample-data fact once between them", async (t) => {
  const document = await openContextualFollowUp(t, async () => reply({ captured: true, created: true }));
  document.getElementById("finops-example-follow-up-open").click();
  const screen = textOf(document.getElementById("top"));
  const times = (text, phrase) => text.split(phrase).length - 1;

  // Once, in the paragraph the figure is written in, so it travels with the
  // number a reader copies. The open panel is counted too: the caveat may not
  // reappear behind the control that reveals the form. Scoped to the first
  // screen rather than to the takeaway card, because #1974 moved the panel out
  // of the card and below the worked-decision link.
  assert.equal(times(screen, "not visitor data"), 1,
    `the first screen states the sample-data fact ${times(screen, "not visitor data")} times`);
  assert.match(textOf(document.getElementById("executive-takeaway-text")),
    /Figures are from a bundled synthetic example and are not visitor data\./);
  // One name for one thing: "bundled synthetic data" was the fourth vocabulary.
  assert.equal(times(screen, "bundled synthetic data"), 0,
    "the sample data is named a bundled synthetic example wherever it is named");
});

/**
 * Every element under `root`, in the order a reader meets them. The harness
 * puts text nodes in `children` and refuses the universal selector, so this
 * walks the tree and keeps only elements.
 */
function inReadingOrder(root, found = []) {
  for (const child of root.children) {
    if (child.nodeType !== 1) continue;
    found.push(child);
    inReadingOrder(child, found);
  }
  return found;
}

test("the worked decision is offered before the work email is asked for", async (t) => {
  // #1974: the follow-up panel sat between the takeaway and the AI FinOps link,
  // so the first screen asked a visitor for their work email before it had shown
  // them anything the product does. The block moved whole — same copy, same ids,
  // same submit label, same controls — to below the two entry points.
  const document = await openContextualFollowUp(t, async () => reply({ captured: true, created: true }));
  const order = inReadingOrder(document.getElementById("top"));
  const at = (id) => order.findIndex((node) => node.getAttribute("id") === id);
  const linkTo = (href) => order.findIndex((node) => node.tagName === "A" && node.getAttribute("href") === href);
  const worked = linkTo("/evolution.html");
  const briefing = linkTo("#landing-decision");

  // 1. The takeaway card is the heading, the figures that end in what they are
  // from, and the control that copies them — and nothing else. Deep-equal
  // rather than a pair of index comparisons: this is the adjacency the move was
  // not allowed to disturb, and an extra node between any two of them is the
  // failure worth catching.
  assert.deepEqual(
    inReadingOrder(document.querySelector(".executive-takeaway"))
      .map((node) => node.getAttribute("id") ?? node.getAttribute("class")),
    ["executive-takeaway-title", "executive-takeaway-text", "executive-takeaway-actions",
      "copy-executive-takeaway", "executive-takeaway-status"],
  );
  assert.match(textOf(document.getElementById("executive-takeaway-text")),
    /Figures are from a bundled synthetic example and are not visitor data\.$/);

  // 2 and 3. Both entry points, in their own order, above the ask.
  assert.ok(at("executive-takeaway-title") < worked,
    "the worked-decision link must read below the takeaway it summarises");
  assert.ok(worked < briefing, "the primary entry point must read before the secondary one");
  assert.ok(briefing < at("finops-example-follow-up-open"),
    "the follow-up ask must read below both entry points");

  // 4. And the block arrived intact: its disclosure still sits directly above
  // the panel it controls, and the panel still holds the whole form.
  assert.equal(document.getElementById("finops-example-follow-up-open")
    .getAttribute("aria-controls"), "finops-example-follow-up-panel");
  for (const id of ["finops-example-follow-up-form", "finops-example-follow-up-topic",
    "finops-example-follow-up-email", "finops-example-follow-up-disclosure",
    "finops-example-follow-up-retry", "finops-example-follow-up-status"]) {
    assert.ok(at("finops-example-follow-up-panel") < at(id), `${id} left the moved panel`);
  }

  // Nothing that asks for an address may be reached between the heading and the
  // link. Read off the tree rather than from a list of ids, so a second field
  // added above the link fails here too.
  const before = order.slice(at("executive-takeaway-title"), worked);
  assert.equal(before.filter((node) => node.tagName === "INPUT").length, 0,
    "a field sits between the executive takeaway and the worked-decision link");
  assert.equal(before.filter((node) => /work email/i.test(textOf(node))).length, 0,
    "the work-email ask is still read before the worked decision");
});

test("moving the follow-up ask spends no tab stop and reorders no other control", async (t) => {
  const document = await openContextualFollowUp(t, async () => reply({ captured: true, created: true }));
  const inHero = new Set(inReadingOrder(document.getElementById("top")));

  // Four stops before the move, four after: the copy control, the two entry
  // points, and the disclosure that reveals the form. The panel is closed on
  // arrival, so its field and its two buttons cost nothing until it is opened —
  // and the homepage's tab budget is full, so this count may not grow.
  const stops = tabSequence(document).filter((stop) => inHero.has(stop));
  assert.deepEqual(stops.map((stop) => stop.getAttribute("id") ?? stop.getAttribute("href")),
    ["copy-executive-takeaway", "/evolution.html", "#landing-decision", "finops-example-follow-up-open"]);

  // Opening it adds the form's own stops where the reader just pressed, below
  // everything above — never above the link they have not read yet.
  document.getElementById("finops-example-follow-up-open").click();
  const opened = tabSequence(document).filter((stop) => inHero.has(stop));
  // Three, not four: the retry control ships hidden and only stands in for the
  // send control after a request has actually failed.
  assert.equal(opened.length, stops.length + 3, "the open panel offers the topic, the field, and one send control");
  assert.equal(opened.indexOf(document.getElementById("finops-example-follow-up-open")), 3,
    "the disclosure must still be the last stop the closed first screen offers");
});

test("the contextual request validates locally and never shows success for a failed response", async (t) => {
  const calls = [];
  const document = await openContextualFollowUp(t, async (...args) => {
    calls.push(args);
    return reply({ error: { code: "storage_error" } }, 500);
  });
  document.getElementById("finops-example-follow-up-open").click();
  const form = document.getElementById("finops-example-follow-up-form");
  const email = document.getElementById("finops-example-follow-up-email");
  email.focus();
  pressEnter(document);
  assert.equal(calls.length, 0);
  assert.match(textOf(document.getElementById("finops-example-follow-up-error")), /work email/i);
  email.value = "finops@example.com";
  pressEnter(document);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(form.dataset.state, "error");
  assert.doesNotMatch(textOf(document.getElementById("finops-example-follow-up-status")), /will reply|requested\./i);
  assert.equal(email.value, "finops@example.com");
  assert.equal(document.getElementById("finops-example-follow-up-confirmation"), null,
    "failure and success UI cannot render together");
  const visibleSubmits = form.querySelectorAll('button[type="submit"]').filter((button) => !button.hidden);
  assert.equal(visibleSubmits.length, 1);
  assert.equal(textOf(visibleSubmits[0]), "Retry your follow-up request");

  // Emptying the field and pressing again sends nothing, so there is no attempt
  // in flight to retry: the control has to go back to describing what pressing
  // it would actually do, or it offers to resend a request that never left.
  email.value = "";
  pressEnter(document);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1, "an empty field is not a second attempt");
  assert.equal(form.dataset.state, "invalid");
  const afterInvalid = form.querySelectorAll('button[type="submit"]').filter((button) => !button.hidden);
  assert.equal(afterInvalid.length, 1, "exactly one send control is offered");
  assert.equal(textOf(afterInvalid[0]), "Request a follow-up about this example");
});

test("a valid contextual request persists and renders an accurate promise-free receipt", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const response = await onRequest({
    request: new Request("https://labs.wawalu.org/api/leads", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "finops@example.com", purpose: FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE,
        topic: "Bundled AI FinOps example — lower-cost routing in Atlas Platform" }),
    }),
    env: { DB: db },
  });
  assert.equal(response.status, 201);
  const document = await openContextualFollowUp(t, async () => reply({ captured: true, created: true }));
  document.getElementById("finops-example-follow-up-open").click();
  document.getElementById("finops-example-follow-up-email").value = "finops@example.com";
  const form = document.getElementById("finops-example-follow-up-form");
  document.getElementById("finops-example-follow-up-email").focus();
  pressEnter(document);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(form.dataset.state, "success", textOf(document.getElementById("finops-example-follow-up-status")));
  const receipt = textOf(document.getElementById("finops-example-follow-up-confirmation"));
  assert.match(receipt, /Request received\. Submitted work email: finops@example\.com/);
  assert.match(receipt, /Bundled AI FinOps example — lower-cost routing in Atlas Platform/);
  assert.doesNotMatch(receipt, /will reply|within two business days/i);
  assert.equal(form.hidden, true);
  const row = db.raw.prepare("SELECT email, purpose, topic FROM lead_submissions WHERE email = ?").get("finops@example.com");
  assert.equal(row.email, "finops@example.com");
  assert.equal(row.purpose, FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE);
  assert.equal(row.topic, "Bundled AI FinOps example — lower-cost routing in Atlas Platform");
  // The stored row is the whole of what the sentence above the button promised:
  // that address, that topic, and no third column.
  assert.equal(textOf(document.getElementById("finops-example-follow-up-disclosure")), DISCLOSURE);
});

test("every authored claim in the takeaway is one AI FinOps still publishes", () => {
  // The takeaway is prose typed into a document, which makes it a second source
  // of truth for figures the composer owns. It is allowed to be — the import
  // graph behind `buildStandHeadline()` is not something the first screen can
  // afford to load — but it is not allowed to drift. Every claim is held here
  // against the composer that paints it on AI FinOps, so a rename in the
  // example data, a re-ranked action, or a re-modelled rate fails the build.
  const headline = buildStandHeadline();
  const action = buildFirstRunResult().action;

  const [pair] = headline.recoverable.basis.match(/\$[\d,]+ of \$[\d,]+/) ?? [];
  const [, rate] = headline.recoverable.value.match(/(\d+)% of analyzed spend/) ?? [];
  assert.ok(EXECUTIVE_TAKEAWAY.includes(`${pair} in analyzed AI spend is recoverable (${rate}%)`),
    `the takeaway states a pair or rate the composed headline no longer does: ${pair} / ${rate}%`);
  assert.match(headline.recoverable.basis, /modelled ceiling.*not money already saved/,
    "the takeaway repeats a limit AI FinOps no longer states about this figure");

  // Rank 1 is a rank, not a sentence: the takeaway shortens the published
  // action to its verb and its department, so both are pinned and the claim
  // that it is *first* is pinned to the slot AI FinOps ranks first.
  assert.ok(action.available, "the takeaway names a first action AI FinOps no longer recommends");
  assert.ok(action.value.startsWith(`Pilot lower-cost routing in ${headline.team.name}`),
    `rank 1 on AI FinOps is now "${action.value}", which the takeaway no longer shortens`);
  assert.ok(EXECUTIVE_TAKEAWAY.includes(`First recommended action: Pilot lower-cost routing in ${headline.team.name}.`));
  assert.ok(EXECUTIVE_TAKEAWAY.includes(`${action.detail}.`),
    `the accountable role is now "${action.detail}", which the takeaway does not carry`);
});

test("the keyboard-operable control copies only the takeaway and confirms success", async (t) => {
  const copied = [];
  const document = await openTakeaway(t, { writeText: async (value) => copied.push(value) });
  const button = document.getElementById("copy-executive-takeaway");

  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.type, "button");
  assert.ok(tabSequence(document).includes(button));
  button.focus();
  pressEnter(document);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(copied, [EXECUTIVE_TAKEAWAY]);
  assert.equal(textOf(document.getElementById("executive-takeaway-status")), TAKEAWAY_COPY_FEEDBACK.copied);

  // The pasted plain text is the whole answer or it is not worth pasting: the
  // period, the pair, the rate, the first action, the role, and the disclosure
  // that keeps a synthetic figure from being read as a bill — in one payload.
  const [payload] = copied;
  // The pasted line states the period exactly as the page does, "alone" and all:
  // a figure that loses the word on its way into Slack is a figure a reader
  // there can multiply by three.
  assert.ok(payload.includes(`in ${ANALYZED_PERIOD} alone`), "the copied text drops the period");
  for (const claim of [
    "$51,254 of $154,500", "(33%)",
    "First recommended action: Pilot lower-cost routing in Atlas Platform.",
    "Accountable role: Platform Engineering Lead.",
    "Figures are from a bundled synthetic example and are not visitor data.",
    "a modelled ceiling on what re-routing this work could save, not money already saved",
  ]) {
    assert.ok(payload.includes(claim), `the copied text drops "${claim}"`);
  }
  // A ceiling, still. Nothing here may read as money the reader has banked.
  assert.doesNotMatch(payload, /realized savings|we recovered|we saved|has saved/i);
});

test("clipboard refusal leaves visible recovery guidance", async (t) => {
  const document = await openTakeaway(t, { writeText: async () => { throw new Error("denied"); } });
  document.getElementById("copy-executive-takeaway").click();
  await new Promise((resolve) => setImmediate(resolve));

  const status = document.getElementById("executive-takeaway-status");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(textOf(status), TAKEAWAY_COPY_FEEDBACK.failed);
});
