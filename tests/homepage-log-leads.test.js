// #2394: the front door introduces the product before the extra capability.
//
// Sasha's live-product review found the homepage opening with AI FinOps — a
// bundled synthetic spend example — and reaching the decision and release log,
// the thing Shiplog is, one section later. This file holds the corrected order
// and the four AI FinOps blocks the reorder was not allowed to cost.
//
// Every order assertion here reads the PAINTED document, after the page's own
// entry modules have run, rather than the authored markup. The homepage draws
// controls into empty containers on load (landing-decision-page.js paints the
// print control and the whole briefing), and a module that reordered `<main>`
// after paint would leave a source-order assertion green while a visitor read
// the old order. Source order is checked in tests/build.test.js; what a visitor
// meets is checked here.
//
// Nothing below compares a DOM node with assert: the harness stringifies a
// whole parsed subtree on failure and the run hangs past its timeout. Positions,
// counts, attributes, and text only.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { initDecisionLog, STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { loadPage, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { EXPORT_BUTTON_LABEL } from "../src/shiplog-export.js";
import { RELEASE_EXPORT_BUTTON_LABEL } from "../src/release-export.js";
import { PILOT_TEAM_HANDOFF } from "../src/shiplog-pilot-scorecard.js";
import { SITE_NAV } from "../src/site-nav.js";

const PAGE = new URL("../src/index.html", import.meta.url);
const RELEASES = new URL("../src/releases.html", import.meta.url);
const IMPORT_CONTROL_LABEL = "Choose JSON file";
// The page name is the destination label a reader can click in the nav, not a
// second word for the same surface invented by the scorecard.
const HOME_PAGE_NAME = SITE_NAV.find((item) => item.href === "/index.html").label;

/**
 * Stand the front door up and let everything that paints on load finish.
 *
 * Three settle signals, not one. `ready` alone leaves the briefing's own paint
 * in flight, which lands in CI as an unhandled rejection after the test has
 * already passed locally: the summary's aria-busy flip, the print control the
 * entry draws into its empty container, and the log's own ready flag are all
 * waited on before a single position is read.
 */
async function openFrontDoor(t) {
  const page = await loadPage(PAGE, {
    storage: { [STORAGE_KEY]: JSON.stringify([]), [RELEASE_STORAGE_KEY]: JSON.stringify([]) },
  });
  t.after(() => page.restore());
  const { document } = page;

  await importPageModule("/landing-decision-page.js");
  await importPageModule("/homepage-executive-takeaway.js");
  await importPageModule("/shiplog-pilot-scorecard.js");
  await initDecisionLog(document, page.storage);

  const mount = document.getElementById("landing-decision-summary");
  const actions = document.getElementById("landing-decision-actions");
  await waitFor(() => mount.getAttribute("aria-busy") === "false", "the summary finished painting");
  await waitFor(() => actions.childElements.length > 0, "the entry drew its print control");
  await waitFor(() => document.documentElement.dataset.shiplog === "ready", "the log came to life");
  return { page, document };
}

/** The top-level regions of `<main>`, in the order they are painted. */
const regions = (document) => document.getElementById("main-content").childElements;

/**
 * Where a region sits in `<main>`, by id, or -1 when it is not a region at all.
 * A number, so a regression reports two positions instead of two subtrees.
 */
function positionOf(document, id) {
  return regions(document).findIndex((region) => region.getAttribute("id") === id);
}

/** Every id on the path from a node up to the document, nearest first. */
function ancestorIds(node) {
  const ids = [];
  for (let current = node; current; current = current.parentNode) {
    const id = current.getAttribute?.("id");
    if (id) ids.push(id);
  }
  return ids;
}

test("the painted front door reaches the log before the AI FinOps capability", async (t) => {
  const { document } = await openFrontDoor(t);

  const log = positionOf(document, "shiplog-entry");
  const finops = positionOf(document, "additional-capability");
  assert.ok(log >= 0, "the painted page lost the decision and release log section");
  assert.ok(finops >= 0, "the painted page lost the AI FinOps section");
  assert.ok(log < finops,
    `the log is painted at position ${log} of <main> and AI FinOps at ${finops}: the product must come first`);

  // The example briefing is AI FinOps' own conclusion, so it stays with it,
  // below the log rather than between the log and the block it belongs to.
  const briefing = positionOf(document, "landing-decision");
  assert.ok(log < briefing,
    `the example briefing is painted at ${briefing}, above the log at ${log}`);
  assert.ok(finops < briefing,
    `the example briefing is painted at ${briefing}, above the block it concludes at ${finops}`);

  assert.ok(positionOf(document, "record-history") < positionOf(document, "shiplog-evaluation-brief"),
    "the working panels precede the evaluation brief");
});

test("the first focusable in the log precedes the first focusable in AI FinOps", async (t) => {
  const { document } = await openFrontDoor(t);
  const sequence = tabSequence(document);

  const firstIn = (id) => sequence.findIndex((element) => ancestorIds(element).includes(id));
  const log = firstIn("shiplog-entry");
  const finops = firstIn("additional-capability");
  assert.ok(log >= 0, "the log section offers no tab stop of its own");
  assert.ok(finops >= 0, "the AI FinOps section offers no tab stop of its own");
  assert.ok(log < finops,
    `the log's first tab stop is number ${log} and AI FinOps' is ${finops}: reading order and tab order disagree`);

  // Keep the proof’s full-record link in the expected keyboard order.
  // The six are the full decision record, the follow-up
  // route, the two deployment-check links, the record-list button, and the
  // decision-to-release link.
  assert.equal(
    sequence.filter((element) => ancestorIds(element).includes("shiplog-entry")).length,
    6,
    "the log entry section must still offer its six tab stops including the full decision record",
  );
});

// One assertion per block, so a regression names the block it dropped rather
// than reporting "the section changed".
test("the AI FinOps executive takeaway still renders below the log", async (t) => {
  const { document } = await openFrontDoor(t);
  const section = document.getElementById("additional-capability");
  assert.equal(section.querySelectorAll(".executive-takeaway").length, 1);
  assert.equal(textOf(document.getElementById("executive-takeaway-title")), "Executive takeaway");
  assert.match(textOf(document.getElementById("executive-takeaway-text")), /\$51,254 of \$154,500/);
});

test("the AI FinOps follow-up form still renders below the log", async (t) => {
  const { document } = await openFrontDoor(t);
  const section = document.getElementById("additional-capability");
  assert.equal(section.querySelectorAll("#finops-example-follow-up-form").length, 1);
  assert.equal(section.querySelectorAll("#finops-example-follow-up-email").length, 1);
  assert.equal(
    document.getElementById("finops-example-follow-up-open").getAttribute("aria-controls"),
    "finops-example-follow-up-panel",
  );
});

test("the AI FinOps example briefing still renders below the log", async (t) => {
  const { document } = await openFrontDoor(t);
  const mount = document.getElementById("landing-decision-summary");
  assert.equal(mount.getAttribute("aria-busy"), "false");
  assert.equal(mount.querySelectorAll("article").length, 1);
  assert.equal(textOf(document.getElementById("landing-decision-title")),
    "The decision the AI FinOps example produces.");
});

test("the AI FinOps provider-export guidance still renders below the log", async (t) => {
  const { document } = await openFrontDoor(t);
  const guidance = document.getElementById("landing-decision")
    .querySelectorAll(".landing-decision-next").map(textOf)
    .find((text) => text.includes("reads a provider export"));
  assert.match(guidance ?? "",
    /OpenAI, Anthropic, Azure OpenAI, Google Vertex AI, or AWS Bedrock, as CSV, TSV, JSON, or JSONL/);
});

test("every in-page link on the painted front door still lands on a region that exists", async (t) => {
  const { document } = await openFrontDoor(t);

  const fragments = document.querySelectorAll("a")
    .map((link) => link.getAttribute("href") ?? "")
    .filter((href) => href.startsWith("#") && href.length > 1)
    .map((href) => href.slice(1));
  assert.ok(fragments.length > 0, "the front door lost every in-page link");

  const missing = [...new Set(fragments)]
    .filter((id) => document.querySelectorAll(`[id="${id}"]`).length !== 1);
  assert.deepEqual(missing, [], "in-page links point at ids the painted page does not carry");

  // Both directions, by position rather than by prose. The AI FinOps block
  // sends a reader down to the briefing; the log sends them down to the record
  // panels. Neither may become a link back up the page.
  const inSection = (id, href) => document.getElementById(id)
    .querySelectorAll("a").some((link) => link.getAttribute("href") === href);
  assert.ok(inSection("additional-capability", "#landing-decision"),
    "the AI FinOps block must still offer its route to the example briefing");
  assert.ok(positionOf(document, "additional-capability") < positionOf(document, "landing-decision"),
    "the AI FinOps route to the briefing says 'below' and must stay pointing down");
  assert.ok(inSection("shiplog-entry", "#record-history"),
    "the log entry must still offer its route to the record panels");
  assert.ok(positionOf(document, "shiplog-entry") < positionOf(document, "record-history"),
    "the log entry sends a reader further down this page and must stay pointing down");
});

test("the log's eyebrow no longer places the section further down the page", async (t) => {
  const { document } = await openFrontDoor(t);
  const eyebrow = textOf(document.getElementById("shiplog-entry").querySelector(".eyebrow"));
  assert.match(eyebrow, /^The decision and release log · /);
  assert.doesNotMatch(eyebrow, /further down|below|later on/i,
    "the section leads the page now, so its own kicker may not send a reader down to it");

  // The directional sentence that is still true keeps its wording: the
  // recorder, the filters, the export, and the import did not move.
  assert.match(textOf(document.getElementById("shiplog-entry")),
    /Recording, searching, filtering, exporting, and importing the log are all further down this page\./);
});

// The second half of #2394. The scorecard named both controls correctly and
// named no page, so a reviewer ran the step on Releases, met a button reading
// "Export releases as JSON" and no import control, and read the step as naming
// controls that do not exist. The controls are not renamed; the step is.
test("the pilot scorecard's Team handoff names the real controls and the page each is on", async (t) => {
  const { document } = await openFrontDoor(t);
  const row = document.getElementById("shiplog-pilot-scorecard").querySelectorAll("li")[2];
  assert.equal(textOf(row.querySelector("h3")), "Team handoff");
  assert.equal(textOf(row.querySelector("p")), PILOT_TEAM_HANDOFF);

  // Both labels are read off the homepage's own rendered controls, not retyped.
  assert.equal(textOf(document.getElementById("export-shiplog")), EXPORT_BUTTON_LABEL);
  assert.equal(textOf(document.querySelector('label[for="import-shiplog-file"]')), IMPORT_CONTROL_LABEL);
  assert.ok(PILOT_TEAM_HANDOFF.includes(`“${EXPORT_BUTTON_LABEL}” on the ${HOME_PAGE_NAME} page`),
    "the export control must be named with the page it is on");
  assert.ok(PILOT_TEAM_HANDOFF.includes(`“${IMPORT_CONTROL_LABEL}” on the ${HOME_PAGE_NAME} page`),
    "the import control must be named with the page it is on");

  // #2395: this row is copied to a clipboard and downloaded as a file, so it may
  // not point at a page with a word that only works while standing on it.
  assert.doesNotMatch(PILOT_TEAM_HANDOFF, /\bthis page\b|\bopen it here\b|\bhere with\b/,
    "name the page; a deictic does not survive the copy or the download");
  assert.ok(document.querySelectorAll('a[aria-current="page"]').map(textOf).includes(HOME_PAGE_NAME),
    "the page the row names must be the destination this page's nav marks as current");

  // And the Releases page's own export is named by its own rendered label,
  // stated as the separate control it is rather than as an alternative route.
  assert.ok(PILOT_TEAM_HANDOFF.includes(`“${RELEASE_EXPORT_BUTTON_LABEL}”`),
    "the step must name the Releases export a reviewer will actually find");
  assert.match(PILOT_TEAM_HANDOFF, /the Releases page has a separate “[^”]+” button and no import control\./);

  // The claim about Releases is checked against Releases, so it cannot go stale
  // silently: that page renders the label and carries no file input at all.
  const releases = await readFile(RELEASES, "utf8");
  assert.ok(releases.includes(`>${RELEASE_EXPORT_BUTTON_LABEL}</button>`),
    "the Releases page must still render the export label the scorecard quotes");
  assert.equal((releases.match(/type="file"/g) ?? []).length, 0,
    "the scorecard says Releases has no import control; it now has one");
  assert.equal((await readFile(PAGE, "utf8")).match(/type="file"/g).length, 1,
    "the scorecard sends a teammate to the one file picker this page carries");
});
