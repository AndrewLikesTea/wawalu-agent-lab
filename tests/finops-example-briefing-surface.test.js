// The two surfaces the example-to-briefing hand-off crosses, driven for real.
//
// tests/finops-example-briefing.test.js pins the contract — the parameter, the
// derivation, the labelling. This file pins that both pages actually carry it:
// the AI FinOps landing surface has an operable CTA in the region a first-time
// visitor reads, and the briefing page opened from it draws the same example
// rather than whatever this browser happens to hold.
//
// Both halves are asserted twice where it matters: once against the shipped
// markup, because an anchor has to be correct before any script runs, and once
// against the booted page, because the module repaints it and the two must agree.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { FIRST_RUN_IDS } from "../src/finops-first-run.js";
import {
  EXAMPLE_BRIEFING_CTA, EXAMPLE_BRIEFING_HREF, EXAMPLE_BRIEFING_NOTICE, EXAMPLE_RETURN_HREF,
} from "../src/finops-example-briefing.js";
import {
  FINOPS_WORKSPACE_KEY, SAMPLE_FINOPS_WORKSPACE,
} from "../src/finops-workspace-contract.js";

const FINOPS_PAGE = new URL("../src/evolution.html", import.meta.url);
const BRIEFING_PAGE = new URL("../src/executive-briefing.html", import.meta.url);

const DEMO_DATA = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(await readFile(
  new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const ROUTES = {
  "/evolution-demo-data.json": DEMO_DATA,
  "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
};

const byId = (document, id) => document.getElementById(id);

/* ------------------------- the CTA, before any script ---------------------- */

test("the hand-off is a real anchor in the shipped markup, inside the example brief", async () => {
  const document = parseHtml(await readFile(FINOPS_PAGE, "utf8"));
  const link = byId(document, FIRST_RUN_IDS.briefing);

  // An anchor, not a button: it leaves this page, so it must be operable with no
  // script, land in the address bar, and survive being copied.
  assert.equal(link.tagName.toLowerCase(), "a");
  assert.equal(link.getAttribute("href"), EXAMPLE_BRIEFING_HREF,
    "the authored href and the hand-off contract disagree");
  // The context is what makes it the *same* example rather than a generic link.
  assert.match(link.getAttribute("href"), /\?example=/);

  // Inside the first-run region, so it is retired with the brief it belongs to
  // the moment a reader's own result supersedes it.
  const region = byId(document, FIRST_RUN_IDS.region);
  assert.ok(region.querySelector(`#${FIRST_RUN_IDS.briefing}`),
    "the hand-off is authored outside the example brief it hands off from");

  // Named by its own text and described by the note beside it — never named by
  // the note, which would make the accessible name a paragraph.
  assert.equal(link.getAttribute("aria-describedby"), FIRST_RUN_IDS.briefingNote);
  assert.equal(textOf(link), EXAMPLE_BRIEFING_CTA.label);
  assert.match(textOf(byId(document, FIRST_RUN_IDS.briefingNote)), /not your spend/i);

  // A real heading, at the level its siblings use, so the region's outline has
  // no skipped level and no unlabelled block.
  const heading = byId(document, FIRST_RUN_IDS.briefingHeading);
  assert.equal(heading.tagName.toLowerCase(), "h3");
});

test("the note beside the hand-off is not a fourth upload promise", async () => {
  const document = parseHtml(await readFile(FINOPS_PAGE, "utf8"));
  // The two analysis choices keep their own note class and their own count: the
  // no-upload promise still sits once, beside the choice that reads a file.
  assert.equal(document.querySelectorAll(".first-run-action-note").length, 2);
  // TWO notes in the hand-off block since #1525, and the count is not the claim
  // this test is making. The claim is that exactly ONE of them makes a promise
  // about a reader's data: the second is the forwardable destination address,
  // which says nothing about uploads and must not grow into a fourth copy of
  // the promise. Asserted on the wording rather than on the tally, because a
  // tally would have hidden a real fourth promise behind the same number.
  const notes = [...document.querySelectorAll(".first-run-handoff-note")];
  assert.equal(notes.length, 2);
  const promises = notes.filter((note) => /uploaded|your spend/i.test(textOf(note)));
  assert.equal(promises.length, 1,
    "the hand-off block states the no-upload promise more than once");
});

/* --------------------------- the CTA, once booted -------------------------- */

test("the booted page repaints the hand-off from the module that owns it", async (t) => {
  const page = await loadPage(FINOPS_PAGE, { routes: ROUTES });
  t.after(() => page.restore());
  await importPageModule("/evolution-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready"
    || byId(document, "finops-load-state")?.dataset.state === "error",
  "the page never settled into a resolved load state");
  // Every self-started job, not only the one under test: `restore()` otherwise
  // pulls the globals out from under a request still in flight, and the
  // rejection surfaces in whichever test runs next.
  await waitFor(() => byId(document, "integration-contract-provenance")
    ?.textContent.trim().startsWith("Gateway completed"), "the static contract gateway to settle");
  await waitFor(() => byId(document, "finops-evaluation-result")
    ?.getAttribute("aria-busy") === "false", "the evaluation panel to settle");

  const link = byId(document, FIRST_RUN_IDS.briefing);
  assert.equal(textOf(link), EXAMPLE_BRIEFING_CTA.label);
  assert.equal(link.getAttribute("href"), EXAMPLE_BRIEFING_HREF);
  assert.equal(textOf(byId(document, FIRST_RUN_IDS.briefingNote)), EXAMPLE_BRIEFING_CTA.note);
  assert.equal(textOf(byId(document, FIRST_RUN_IDS.briefingHeading)),
    EXAMPLE_BRIEFING_CTA.heading);

  // The brief it hands off from is resolved, not pending: a link to "this
  // example" over an unresolved example is a link to nothing.
  assert.equal(byId(document, FIRST_RUN_IDS.region).dataset.state, "ready");

  // Reachable by keyboard, and after the two choices rather than in front of
  // them: putting data into the page comes before leaving it.
  const order = tabSequence(document).map((node) => node.id);
  const handoff = order.indexOf(FIRST_RUN_IDS.briefing);
  assert.ok(handoff >= 0, "the hand-off is not in the tab sequence");
  assert.ok(order.indexOf(FIRST_RUN_IDS.import) < handoff,
    "the hand-off is reached before the reader's own-data choice");
});

/* ------------------- the briefing page, opened from the CTA ----------------- */

/** The briefing page, with the address bar and the store of the caller's choosing. */
async function openBriefing(t, { search = "", storage = {} } = {}) {
  const page = await loadPage(BRIEFING_PAGE, { routes: {}, location: { search }, storage });
  t.after(() => page.restore());
  await importPageModule("/executive-briefing-page.js");
  const root = page.document.getElementById("executive-briefing");
  await waitFor(() => root.getAttribute("aria-busy") === "false", "the briefing finished painting");
  return { document: page.document, root };
}

const WORKSPACE = { [FINOPS_WORKSPACE_KEY]: JSON.stringify(SAMPLE_FINOPS_WORKSPACE) };

test("the example link briefs on the example, not on this browser's own periods", async (t) => {
  const { root } = await openBriefing(t, {
    search: EXAMPLE_BRIEFING_HREF.slice(EXAMPLE_BRIEFING_HREF.indexOf("?")),
    // A browser that *does* hold a retained period. The pinned example must win,
    // because that is what the reader asked for by following the link.
    storage: WORKSPACE,
  });
  const read = textOf(root);

  // The example's own figures: $51,254 recoverable of $154,500 analyzed.
  assert.match(read, /\$51,254/);
  assert.match(read, /\$154,500/);
  // And not the stored period's, which would be the same heading over different
  // money — the exact confusion this hand-off exists to remove.
  assert.doesNotMatch(read, /\$6,120/);
  assert.doesNotMatch(read, /\$48,200/);

  assert.equal(root.querySelector(".brief").dataset.state, "briefing");
});

test("the pinned briefing says it is invented and says what it left out", async (t) => {
  const { root } = await openBriefing(t, {
    search: `?example=${EXAMPLE_BRIEFING_HREF.split("=")[1]}`, storage: WORKSPACE,
  });

  const notice = root.querySelector("[data-example-context]");
  assert.ok(notice, "no example-context notice was drawn");
  assert.equal(notice.dataset.absence, EXAMPLE_BRIEFING_NOTICE.code);
  assert.equal(notice.getAttribute("role"), "status");
  const noticeText = textOf(notice);
  assert.match(noticeText, /Not your figures/i);
  assert.match(noticeText, /left out/i);

  // The notice comes before the sheet: whose figures these are is read before
  // the figures are.
  const children = [...root.children].filter((node) => node.nodeType === 1);
  assert.ok(children.indexOf(notice) < children.findIndex((node) => node.matches?.(".brief")),
    "the sheet is drawn above the notice that says whose figures it holds");

  // The synthetic banner and the confidence ceiling the contract owns.
  assert.match(textOf(root.querySelector(".brief-synthetic")), /Bundled synthetic example/);
  assert.match(textOf(root.querySelector(".brief-synthetic")), /invented data/);
  assert.match(textOf(root), /not a realized saving/i);

  // And the way back to the region the reader came from, as a real link.
  const back = notice.querySelector(".brief-source-return-link");
  assert.equal(back.getAttribute("href"), EXAMPLE_RETURN_HREF);
  assert.equal(textOf(back), EXAMPLE_BRIEFING_NOTICE.returnLabel);
});

test("without the parameter the page still briefs on this browser's own periods", async (t) => {
  const { root } = await openBriefing(t, { search: "", storage: WORKSPACE });
  const read = textOf(root);
  assert.match(read, /\$6,120/, "the reader's own retained period was not briefed on");
  assert.doesNotMatch(read, /\$51,254/);
  assert.equal(root.querySelector("[data-example-context]"), null);
});

test("an unknown example value is not treated as the example", async (t) => {
  const { root } = await openBriefing(t, { search: "?example=whatever", storage: WORKSPACE });
  assert.equal(root.querySelector("[data-example-context]"), null);
  assert.match(textOf(root), /\$6,120/);
});
