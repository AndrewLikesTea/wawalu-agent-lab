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
  // The twelve include the historical build source and the repository block's two links — the cited pull
  // request and the route to every repository-backed decision (#2742) — the
  // route to the evaluation brief and blank pilot scorecard inside the offer
  // paragraph (#2540), the full decision record, the follow-up routes, the two
  // deployment-check links, the deployment check's evidence disclosure (#2555),
  // the record-list button, and the decision-to-release link.
  //
  // The check's copy control is NOT among them, and that is the point of
  // counting here rather than in the markup: this page is booted without a
  // health reading, so the check cannot answer, and a control that would copy
  // a verdict nobody has is withdrawn rather than offered. It becomes the
  // thirteenth stop only once the comparison comes out one way or the other, which
  // tests/homepage-deployment-copy.test.js drives directly.
  //
  // The thirteenth is the coverage figure's corrective link (#2907): the example
  // log this page boots with has one uncovered release, so the figure offers
  // "Review the 1 uncovered release on Releases" directly after its result. It
  // exists only while a release is uncovered; a covered or still-counting log
  // offers twelve.
  assert.equal(
    sequence.filter((element) => ancestorIds(element).includes("shiplog-entry")).length,
    13,
    "the log entry section offers thirteen tab stops, including the coverage figure's corrective link",
  );
  assert.equal(sequence.filter((element) => element.getAttribute?.("id") === "reasoning-kept-review").length, 1);
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

// #2827: a first-time visitor meets the promise before the form instructions.
// The log's eyebrow ("the product this page carries") is deleted, not hidden,
// and the promise moved up rather than being copied.
test("the painted front door leads with the promise, then names the log", async (t) => {
  const { document } = await openFrontDoor(t);
  const main = document.getElementById("main-content");
  const headings = main.querySelectorAll("h1,h2,h3,h4");
  assert.equal(headings[0].tagName, "H1");
  assert.equal(textOf(headings[0]), "Know why it shipped. Decide what’s next.");
  assert.equal(main.querySelectorAll("h1").length, 1);

  const hero = document.getElementById("top");
  const blocks = hero.childElements.filter((node) => node.getAttribute?.("class") !== "eyebrow");
  const order = blocks.map((node) => node.getAttribute("id") || textOf(node).slice(0, 40));
  const at = (prefix) => order.findIndex((label) => label.startsWith(prefix));
  assert.equal(at("page-title"), 0, `the promise must open the hero: ${order.join(" | ")}`);
  assert.match(textOf(blocks[1]),
    /^Shiplog records decisions, tracks the releases they shape, and keeps the link between them\./);
  assert.ok(at("home-log-title") > 1, `the log's name must follow the promise: ${order.join(" | ")}`);
  assert.equal(textOf(document.getElementById("home-log-title")), "Decision log");
  assert.match(textOf(blocks[at("home-log-title") + 1]), /^Browse existing decisions or record a new one/);
  const demo = document.getElementById("core-demo-link");
  assert.equal(textOf(demo), "Explore the Decision log →");
  assert.equal(demo.getAttribute("href"), "#record-history-title");
  assert.equal(textOf(document.getElementById("record-history-title")), "Decision log");

  assert.doesNotMatch(textOf(main), /the product this page carries/);
  assert.equal(document.getElementById("shiplog-entry").childElements[0].getAttribute("id"), "repository-evidence",
    "the log entry must open on its evidence, not on a kicker");
  assert.equal(document.getElementById("shiplog-entry").getAttribute("aria-labelledby"), "home-log-title");
  assert.ok(!document.getElementById("shiplog-entry-title"), "the old promise heading id is still on the page");

  // No tab stop moved: the promise adds none, the hero still offers only the
  // demo link, and the log entry's first stop still follows it directly.
  const sequence = tabSequence(document);
  const heroStops = sequence.filter((node) => ancestorIds(node).includes("top"));
  assert.deepEqual(heroStops.map((node) => node.id), ["core-demo-link"]);
  const demoAt = sequence.indexOf(demo);
  assert.ok(!ancestorIds(sequence[demoAt - 1]).includes("main-content"), "a stop was added above the demo link");
  assert.ok(ancestorIds(sequence[demoAt + 1]).includes("shiplog-entry"), "a stop was added after the demo link");

  // The directional sentence that is still true keeps its wording: the
  // recorder, the filters, the export, and the import did not move.
  assert.match(textOf(hero),
    /Recording, searching, filtering, exporting, and importing the log are all further down this page\./);
});

// The second half of #2394. The scorecard named both controls correctly and
// named no page, so a reviewer ran the step on Releases, met a button reading
// "Export shown releases as JSON" and no import control, and read the step as naming
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
