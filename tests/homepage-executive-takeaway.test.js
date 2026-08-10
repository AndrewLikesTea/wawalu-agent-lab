import test from "node:test";
import assert from "node:assert/strict";

import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";
import { importPageModule } from "./support/page-module.js";
import {
  EXECUTIVE_TAKEAWAY, TAKEAWAY_COPY_FEEDBACK,
} from "../src/homepage-executive-takeaway.js";
import { buildStandHeadline } from "../src/finops-stand.js";
import { buildFirstRunResult } from "../src/finops-first-run.js";

const PAGE = new URL("../src/index.html", import.meta.url);

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
    assert.equal(times(hero, figure), 1, `the first screen states ${figure} ${times(hero, figure)} times`);
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
