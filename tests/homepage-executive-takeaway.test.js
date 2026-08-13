import test from "node:test";
import assert from "node:assert/strict";

import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";
import { importPageModule } from "./support/page-module.js";
import {
  bindFinopsExampleFollowUp, EXECUTIVE_TAKEAWAY, FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE,
  TAKEAWAY_COPY_FEEDBACK,
} from "../src/homepage-executive-takeaway.js";
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
  for (const figure of ["$51,254", "$154,500", "33%"]) {
    const expected = figure === "$51,254" ? 2 : 1;
    assert.equal(times(hero, figure), expected, `the first screen states ${figure} ${times(hero, figure)} times`);
    assert.equal(times(takeaway, figure), 1, `the takeaway must be where ${figure} is stated`);
  }

  // The paragraph still does its own job: it says a worked decision is already
  // computed, whose it is, and what reading it costs. It just does not do the
  // takeaway's job as well.
  assert.match(intro, /A worked decision is already computed on the AI FinOps page/);
  assert.match(intro, /bundled synthetic example/);
  assert.match(intro, /no export of yours, no sign-in, and no account/);
  assert.doesNotMatch(intro, /\$[\d,]+|\d+%/,
    "the paragraph that introduces the example must not restate the figures the takeaway carries");
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

test("the adjacent CTA opens a contextual work-email request while its synthetic disclosure remains visible", async (t) => {
  const document = await openContextualFollowUp(t, async () => reply({ captured: true, created: true }));
  const open = document.getElementById("finops-example-follow-up-open");
  const panel = document.getElementById("finops-example-follow-up-panel");
  assert.match(textOf(open), /follow-up about this bundled AI FinOps example/i);
  assert.equal(panel.hidden, true);
  open.click();
  assert.equal(panel.hidden, false);
  assert.equal(document.activeElement?.id, "finops-example-follow-up-email");
  assert.match(document.getElementById("finops-example-follow-up-topic").value, /Atlas Platform|lower-cost routing/);
  assert.match(textOf(document.getElementById("finops-example-follow-up-disclosure")), /\$51,254.*bundled synthetic data, not visitor data/);
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
  assert.match(textOf(document.getElementById("finops-example-follow-up-disclosure")), /bundled synthetic data, not visitor data/);
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
