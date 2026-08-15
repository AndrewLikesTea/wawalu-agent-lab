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
  assert.equal(ANALYZED_PERIOD, "June 2026");
  assert.ok(text.includes(`is recoverable (33%) across ${ANALYZED_PERIOD} —`),
    `the rendered takeaway does not carry the derived period: ${text}`);
  // The span rides on the figure sentence, so it cannot be read as a claim of
  // its own and cannot displace anything above the fold.
  assert.doesNotMatch(text, /across\s+—|across\s*$|undefined/);
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
    .includes("is recoverable (33%) across March 2027 —"));
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
    assert.doesNotMatch(degraded, /across|undefined|null/);
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
  assert.match(document.getElementById("finops-example-follow-up-topic").value, /Atlas Platform|lower-cost routing/);
  // #1768: this form used to caveat $51,254 a second time, in a second
  // vocabulary, a line under the paragraph that already caveats it. It states
  // the one thing only a form can state now.
  assert.equal(textOf(document.getElementById("finops-example-follow-up-disclosure")),
    "Only your work email and this fixed follow-up topic are sent.");
});

test("the takeaway and the form under it state the sample-data fact once between them", async (t) => {
  const document = await openContextualFollowUp(t, async () => reply({ captured: true, created: true }));
  document.getElementById("finops-example-follow-up-open").click();
  const card = textOf(document.querySelector(".executive-takeaway"));
  const times = (text, phrase) => text.split(phrase).length - 1;

  // Once, in the paragraph the figure is written in, so it travels with the
  // number a reader copies. The open panel is counted too: the caveat may not
  // reappear behind the control that reveals the form.
  assert.equal(times(card, "not visitor data"), 1,
    `the takeaway card and its form state the sample-data fact ${times(card, "not visitor data")} times`);
  assert.match(textOf(document.getElementById("executive-takeaway-text")),
    /Figures are from a bundled synthetic example and are not visitor data\./);
  // One name for one thing: "bundled synthetic data" was the fourth vocabulary.
  assert.equal(times(card, "bundled synthetic data"), 0,
    "the sample data is named a bundled synthetic example wherever it is named");
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
});

test("a valid contextual request reaches the real endpoint, persists its purpose, then promises an email reply", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const response = await onRequest({
    request: new Request("https://labs.wawalu.org/api/leads", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "finops@example.com", purpose: FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE }),
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
  assert.match(textOf(document.getElementById("finops-example-follow-up-status")), /Someone from Wawalu will reply by email/);
  const row = db.raw.prepare("SELECT email, purpose FROM lead_submissions WHERE email = ?").get("finops@example.com");
  assert.equal(row.email, "finops@example.com");
  assert.equal(row.purpose, FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE);
  assert.equal(textOf(document.getElementById("finops-example-follow-up-disclosure")),
    "Only your work email and this fixed follow-up topic are sent.");
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
  assert.ok(payload.includes(`across ${ANALYZED_PERIOD}`), "the copied text drops the period");
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
