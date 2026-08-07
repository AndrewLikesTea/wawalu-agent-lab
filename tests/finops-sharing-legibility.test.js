// Sharing is a deliberate act, so the page has to say what leaves (#1209).
//
// A reader can send this browser's own figures out of it by two doors: the
// shareable link on the AI FinOps page, and the brief file on the printable
// briefing. Both were legible about what they *are* and silent about what
// sending them *costs* — that the payload is the reader's own months rather
// than the bundled synthetic company, and that once it is out it travels
// wherever it is pasted or forwarded.
//
// WHAT THIS FILE HOLDS.
//
//   1. THE CAUTION IS PLAINLY VISIBLE AT THE CONTROL. Not a tooltip, not a
//      title attribute, and never folded inside a disclosure element — the
//      harness reads through a shut one and a real reader does not, so a
//      warning folded away would pass its own test and warn nobody. It is
//      checked by walking ancestors, because that is the only thing here that
//      can tell a shut disclosure from an open page.
//   2. IT ADDS NO TAB STOP, AND TAKES NONE AWAY. The caution is static prose;
//      the control it describes stays a real `button` in document order,
//      reachable by keyboard once there is something to share. Both halves are
//      asserted against the shipped markup, on the tab sequence.
//   3. ONE ACT, ONE VOICE. The two doors carry the same sentence, character for
//      character. Two differently worded cautions about one risk make a reader
//      decide whether the second means something new; it never does.
//   4. THE CAUTION TRAVELS WITH ITS CONTROL. On the briefing page the download
//      link is hidden until there is a brief behind it, and the sentence is
//      hidden and unhidden in the same statement. A caution over a control that
//      is not offered is noise, and noise is what a reader learns to read past.
//   5. THE SHARED BRIEF STILL READS FIGURE, THEN GRADE, THEN PROVENANCE, and
//      the grade is still a word plus a rung plus a shape rather than a hue.
//      That hierarchy is what a link is worth sending *to*; this pins it here so
//      the sharing work above cannot be landed over a view that lost it.
//      (Its states — loading, absent, error, implausible extreme — are drawn and
//      asserted in tests/executive-briefing-preview.test.js, which owns them.)

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { FINOPS_CONSENT } from "../src/finops-workspace.js";
import { SHARE_LINK_IDS, applyShareLink } from "../src/finops-share-link-control.js";

const FINOPS_PAGE = new URL("../src/evolution.html", import.meta.url);
const BRIEFING_PAGE = new URL("../src/executive-briefing.html", import.meta.url);
const finopsHtml = await readFile(FINOPS_PAGE, "utf8");
const briefingHtml = await readFile(BRIEFING_PAGE, "utf8");

const ORIGIN = "https://labs.wawalu.org";
const DOWNLOAD_ID = "open-shared-brief-download";
const DOWNLOAD_EGRESS_ID = "open-shared-brief-egress";
const DOWNLOAD_NOTE_ID = "open-shared-brief-download-note";

/** The classes this site uses to take a node off screen but leave it announced. */
const OFF_SCREEN = ["visually-hidden", "sr-only"];

/**
 * Every ancestor of `node`, nearest first. The harness rejects descendant
 * selectors, so a claim about what a node is folded inside is walked.
 */
function ancestors(node) {
  const chain = [];
  for (let step = node.parentNode; step; step = step.parentNode) chain.push(step);
  return chain;
}

const tagOf = (node) => String(node.tagName ?? "").toLowerCase();

/**
 * The tab order as ids. `tabSequence` hands back elements, so a filter that
 * compares its entries against a string id silently matches nothing and passes
 * whatever it was asked to prove — this maps first, once, on purpose.
 */
const tabIds = (document) => tabSequence(document).map((node) => node.getAttribute("id") ?? "");

/** The ids of the ancestors that carry `hidden`, nearest first. */
const hiddenAncestorIds = (node) => ancestors(node)
  .filter((step) => step.getAttribute?.("hidden") !== null && step.getAttribute?.("hidden") !== undefined)
  .map((step) => step.getAttribute("id") ?? tagOf(step));

/** A retained workspace document, serialized the way the store holds it. */
function retainedWorkspace() {
  return JSON.stringify({
    schemaVersion: "finops-workspace/1.1.0",
    consent: { state: FINOPS_CONSENT.granted, decidedAt: "2026-07-01T00:00:00.000Z" },
    periods: [{
      periodId: "user:2026-03",
      period: "2026-03",
      dataset: "user",
      briefingContractVersion: "finops-briefing/1.0.0",
      derivedAt: "2026-08-01T00:00:00.000Z",
      analyzedSpendMinor: 15_450_000,
      attributedSpendMinor: 12_000_000,
      recoverableScenarioMinor: 3_141_500,
      recordsTotal: 900,
      recordsAnalyzed: 880,
      coverageRatioPpm: 977_777,
      confidence: "moderate",
      topDepartmentId: "dept-atlas-platform",
    }],
    commitments: [],
    meta: { lastWriteAt: "2026-07-01T00:00:00.000Z" },
  });
}

/** A storage double holding exactly that workspace. */
function heldStorage() {
  const entries = new Map([["shiplog.finops.workspace.v1", retainedWorkspace()]]);
  return {
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: () => { throw new Error("painting the control must not write"); },
    removeItem: () => { throw new Error("painting the control must not write"); },
  };
}

/* --------------------- the caution at the copy control ---------------------- */

test("the copy control's egress caution is plain visible prose, not a folded one", () => {
  const document = parseHtml(finopsHtml);
  const caution = document.getElementById(SHARE_LINK_IDS.egress);

  // It exists as body prose, not as an attribute a pointer has to find.
  assert.equal(tagOf(caution), "p");
  assert.equal(caution.getAttribute("title"), null,
    "a caution in a title attribute is unreachable by keyboard and unreadable on touch");

  // It says the two things sending costs: whose figures, and how far they go.
  const words = textOf(caution);
  assert.match(words, /your own figures/i, "the caution must name whose figures travel");
  assert.match(words, /not the bundled example/i,
    "a reader looking at the synthetic company must be told this is not that");
  assert.match(words, /pasted or forwarded/i, "the caution must say how far the payload goes");

  // Visible: no hidden attribute of its own and no off-screen class.
  assert.equal(caution.getAttribute("hidden"), null);
  const classes = String(caution.getAttribute("class") ?? "").split(/\s+/);
  for (const offScreen of OFF_SCREEN) {
    assert.equal(classes.includes(offScreen), false,
      `the caution carries ${offScreen}: it would be announced and never read`);
  }

  // Never folded inside a disclosure element. The harness reads through a shut
  // one, so this is the assertion that can tell them apart.
  for (const step of ancestors(caution)) {
    assert.notEqual(tagOf(step), "details",
      "the caution is folded inside a disclosure and a sighted reader would never meet it");
  }

  // The one thing above it that may be hidden is the block that owns the control
  // it describes: with nothing of the reader's own to share there is no control,
  // and a caution about a control that is not offered is noise.
  assert.deepEqual(hiddenAncestorIds(caution), [SHARE_LINK_IDS.block]);

  // It reuses the block's own lead role rather than introducing a type step.
  assert.equal(classes.includes("prompt-coaching-copy-lead"), true);
});

test("the copy control names the caution, in reading order, and stays a real button", () => {
  const document = parseHtml(finopsHtml);
  const button = document.getElementById(SHARE_LINK_IDS.button);

  // A native button, in the markup — the harness reflects no properties, so the
  // attribute is what the browser would actually get.
  assert.equal(tagOf(button), "button");
  assert.equal(button.getAttribute("type"), "button");
  assert.equal(button.getAttribute("tabindex"), null,
    "a shared control taken out of the natural tab order is a control some readers cannot press");

  // What it is, what sending it costs, then what happened.
  assert.equal(button.getAttribute("aria-describedby"),
    `${SHARE_LINK_IDS.lead} ${SHARE_LINK_IDS.egress} ${SHARE_LINK_IDS.status}`);
});

test("with something to share the control is reachable, and the caution adds no tab stop", () => {
  const document = parseHtml(finopsHtml);

  // Before: nothing retained, so the block and its control are absent from the
  // page rather than disabled beside an invented company.
  assert.equal(tabIds(document).filter((id) => id === SHARE_LINK_IDS.button).length, 0);

  const offered = applyShareLink(document, heldStorage(), { origin: ORIGIN });
  assert.equal(offered.ok, true, `expected an offer, got ${offered.reason}`);
  assert.equal(document.getElementById(SHARE_LINK_IDS.block).hidden, false);

  // The caution came back on screen with the control, still with no hidden
  // attribute of its own, and still describing a visible button.
  const caution = document.getElementById(SHARE_LINK_IDS.egress);
  assert.equal(caution.getAttribute("hidden"), null);
  assert.deepEqual(hiddenAncestorIds(caution), []);

  // The control is reachable by keyboard, exactly once.
  const sequence = tabIds(document);
  assert.equal(sequence.filter((id) => id === SHARE_LINK_IDS.button).length, 1);
  // And the caution itself takes no stop: static prose a reader tabs past, not
  // a second thing to operate before the control it explains.
  assert.equal(sequence.filter((id) => id === SHARE_LINK_IDS.egress).length, 0);
  // The caution is read before the button is reached, not after it is pressed.
  const ids = document.querySelectorAll("[id]").map((node) => node.getAttribute("id"));
  assert.ok(ids.indexOf(SHARE_LINK_IDS.egress) < ids.indexOf(SHARE_LINK_IDS.button),
    "the caution must be read before the control, not after the figures have gone");
});

/* -------------------- the caution at the brief download --------------------- */

test("the brief download carries the same caution, in the same words", () => {
  const finops = parseHtml(finopsHtml);
  const briefing = parseHtml(briefingHtml);

  const here = textOf(finops.getElementById(SHARE_LINK_IDS.egress));
  const there = textOf(briefing.getElementById(DOWNLOAD_EGRESS_ID));
  assert.ok(here.length > 0, "the caution must actually say something");
  assert.equal(there, here,
    "one act, one voice: two wordings of one risk make a reader decide which is the real one");

  const link = briefing.getElementById(DOWNLOAD_ID);
  assert.equal(tagOf(link), "a");
  assert.equal(link.getAttribute("aria-describedby"),
    `${DOWNLOAD_EGRESS_ID} ${DOWNLOAD_NOTE_ID}`,
    "the caution is announced with the control, ahead of the envelope note");

  // Plain prose in the open here too, in the page's own caption role.
  const caution = briefing.getElementById(DOWNLOAD_EGRESS_ID);
  assert.equal(tagOf(caution), "p");
  assert.equal(String(caution.getAttribute("class") ?? "").split(/\s+/).includes("brief-print-hint"), true);
  for (const step of ancestors(caution)) {
    assert.notEqual(tagOf(step), "details", "the caution is folded inside a disclosure");
  }
  // It is read before the control, and both ship withheld together: there is no
  // brief behind the link until one has been built.
  const ids = briefing.querySelectorAll("[id]").map((node) => node.getAttribute("id"));
  assert.ok(ids.indexOf(DOWNLOAD_EGRESS_ID) < ids.indexOf(DOWNLOAD_ID));
  assert.equal(caution.hidden, true);
  assert.equal(link.hidden, true);
});

test("the download caution is offered with the control, on the page as it ships", async (t) => {
  // The reader's own retained months, because that is the only state where the
  // door exists: the published synthetic sample offers no download, so a brief
  // over it would be somebody else's company with a confident filename on it.
  const page = await loadPage(BRIEFING_PAGE, {
    storage: { "shiplog.finops.workspace.v1": retainedWorkspace() },
  });
  t.after(() => page.restore());
  await importPageModule("/executive-briefing-page.js");
  const document = page.document;
  const root = document.getElementById("executive-briefing");
  await waitFor(() => root.getAttribute("aria-busy") === "false", "the briefing finished painting");

  const link = document.getElementById(DOWNLOAD_ID);
  const caution = document.getElementById(DOWNLOAD_EGRESS_ID);
  // The door is open — and the sentence saying what going through it sends is
  // open with it. Never one without the other: that equality is the invariant.
  assert.equal(link.hidden, false, "retained figures must put a brief behind the link");
  assert.equal(caution.hidden, link.hidden);
  assert.match(textOf(caution), /pasted or forwarded/i);

  // Still no tab stop of its own beside a control that has one.
  const sequence = tabIds(document);
  assert.equal(sequence.filter((id) => id === DOWNLOAD_EGRESS_ID).length, 0);
  assert.equal(sequence.filter((id) => id === DOWNLOAD_ID).length, 1);
});

/* ------------------- what the link is worth sending to ---------------------- */

test("the shared brief is a real container in the shipped markup, drawn before any script", () => {
  const document = parseHtml(briefingHtml);
  const root = document.getElementById("executive-briefing");
  assert.equal(root.getAttribute("role"), "region");
  assert.equal(root.getAttribute("aria-busy"), "true", "unpainted is a state, and it says so");

  // Populated in the default parse: a reader whose script has not run yet meets
  // a drawn loading state, not an empty box.
  const states = root.querySelectorAll(".brief-state");
  assert.equal(states.length, 1);
  assert.equal(states[0].getAttribute("data-state"), "loading");
  assert.equal(states[0].getAttribute("role"), "status");
  assert.ok(textOf(states[0]).length > 0, "the loading state must say what is being built");
});

test("the shared brief reads figure, then grade, then provenance — and the grade is not a hue", async (t) => {
  const page = await loadPage(BRIEFING_PAGE, { routes: {} });
  t.after(() => page.restore());
  await importPageModule("/executive-briefing-page.js");
  const document = page.document;
  const root = document.getElementById("executive-briefing");
  await waitFor(() => root.getAttribute("aria-busy") === "false", "the briefing finished painting");

  const article = root.querySelector(".brief");
  const roles = article.querySelectorAll("[data-role]").map((node) => node.getAttribute("data-role"));
  // The figure is read before the grade, and the grade before what bounds it and
  // where it came from. This is the grammar the AI FinOps answer region uses, and
  // a shared brief that re-ordered it would answer a different question.
  assert.ok(roles.indexOf("material-metric") < roles.indexOf("trust-verdict"));
  assert.ok(roles.indexOf("trust-verdict") < roles.indexOf("limitations"));

  // Provenance is on the first screen, under the bounds — named, not hidden
  // behind a disclosure a reader has to know to open.
  assert.equal(article.querySelectorAll(".brief-provenance-summary").length, 1);
  assert.ok(textOf(article.querySelector(".brief-provenance-line")).length > 0);

  // The grade is a word, a rung, and a shape. `data-confidence` is the fourth
  // channel, and removing every hue would leave all three of the others.
  const verdict = article.querySelector(".brief-verdict");
  assert.ok(String(verdict.getAttribute("data-confidence") ?? "").length > 0);
  assert.equal(textOf(verdict.querySelector(".brief-verdict-label")), "Confidence");
  assert.ok(textOf(verdict.querySelector(".brief-verdict-word")).length > 0);
  assert.match(textOf(verdict.querySelector(".brief-verdict-rung")), /^level \d of \d$/);
  assert.equal(verdict.querySelectorAll(".brief-verdict-shape").length, 1);
});
