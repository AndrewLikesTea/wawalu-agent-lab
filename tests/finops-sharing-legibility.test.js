// Sharing, read as a deliberate act — and the sheet that arrives at the far end.
//
// THREE THINGS THIS FILE HOLDS, and why each is a defect worth a test.
//
//   1. THE EGRESS SENTENCE IS AT THE CONTROL AND IS NOT FOLDED AWAY. Copying a
//      link and downloading a briefing both put this reader's own figures
//      somewhere this page cannot follow them. That is stated beside the button
//      that does it, as static markup in the shipped document — not injected by
//      a script that may not have run, and not inside a disclosure. The harness
//      reads straight through a shut `details` element and a real browser does
//      not, so a sentence folded into one passes its test and is invisible to
//      the reader it was written for. Both disclosures are therefore checked by
//      walking their ancestors, and the only ancestor allowed to be hidden is
//      the region the control itself lives or dies with.
//
//   2. THE CONTROLS STAY REACHABLE, AND THE SENTENCES COST NO TAB STOP. A
//      disclosure that wrapped or displaced its control would take the control
//      out of the tab order; a disclosure built as a summary or a link would add
//      a stop to a page that has to be crossed by keyboard. So the tab order
//      through each control's own region is pinned exactly, and the two
//      disclosures are asserted to be plain paragraphs that describe their
//      button rather than compete with it.
//
//   3. THE SHARED SHEET IS LEGIBLE AS TRUSTWORTHY AT A GLANCE. The sheet a
//      colleague opens is drawn from a fragment, so it has to say whose figures
//      these are before it says anything else. Its container is asserted to
//      exist on the real page entry's shared path — the failure this replaces
//      was a null container, which is what a container that only ever existed in
//      a unit test looks like from the page. Inside it: the figure first, the
//      confidence grade and the provenance one level down in the answer region's
//      own type roles, and the measured and estimated parts of the figure each
//      carrying a word and a value, never a colour alone.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  SHARE_LINK_IDS, applyShareLink,
} from "../src/finops-share-link-control.js";
import { encodeSharedBriefing } from "../src/finops-shared-briefing-link.js";
import { FINOPS_CONSENT } from "../src/finops-workspace.js";

// The view imports its model by the served path the browser resolves, so it is
// loaded through the same resolver hook the page entries use rather than
// statically — a static import would be linked before that hook is installed.
const { SHARED_SHEET_ID, renderExecutiveBriefingPreview } =
  await importPageModule("/executive-briefing-view.js");

const FINOPS_PAGE = new URL("../src/evolution.html", import.meta.url);
const BRIEFING_PAGE = new URL("../src/executive-briefing.html", import.meta.url);
const finopsHtml = await readFile(FINOPS_PAGE, "utf8");
const ORIGIN = "https://labs.wawalu.org";

// The ids this contract pins. Literals on purpose: these are the hooks the
// shipped document has to carry, so the test states them rather than importing
// a constant that could be renamed on both sides at once.
const SHARE_EGRESS_ID = "finops-share-egress";
const DOWNLOAD_EGRESS_ID = "finops-download-egress";

/** The download control the egress sentence sits beside. */
const DOWNLOAD_BUTTON_ID = "export-local-json";

/** The one region each control is offered or withheld with, and no other. */
const CONTROL_REGION = Object.freeze({
  [SHARE_EGRESS_ID]: SHARE_LINK_IDS.block,
  [DOWNLOAD_EGRESS_ID]: "local-results",
});

function period(index = 0, overrides = {}) {
  const month = `2026-0${index + 1}`;
  return {
    periodId: `user:${month}`,
    period: month,
    dataset: "user",
    briefingContractVersion: "finops-briefing/1.0.0",
    derivedAt: "2026-08-01T00:00:00.000Z",
    analyzedSpendMinor: 15_450_000 + index,
    attributedSpendMinor: 12_000_000,
    recoverableScenarioMinor: 3_141_500 + index,
    recordsTotal: 900,
    recordsAnalyzed: 880,
    coverageRatioPpm: 977_777,
    confidence: "moderate",
    topDepartmentId: "dept-atlas-platform",
    ...overrides,
  };
}

const retainedDocument = (periods) => JSON.stringify({
  schemaVersion: "finops-workspace/1.1.0",
  consent: { state: FINOPS_CONSENT.granted, decidedAt: "2026-07-01T00:00:00.000Z" },
  periods,
  commitments: [],
  meta: { lastWriteAt: "2026-07-01T00:00:00.000Z" },
});

const WORKSPACE_KEY = "shiplog.finops.workspace.v1";

/** A storage double the share control can read a retained document out of. */
function storageWith(periods) {
  const store = new Map(periods ? [[WORKSPACE_KEY, retainedDocument(periods)]] : []);
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, value); },
    removeItem: (key) => { store.delete(key); },
  };
}

/** Every ancestor of `node` that is hidden, named by id, nearest first. */
function hiddenAncestorIds(node) {
  const found = [];
  for (let current = node.parentNode; current; current = current.parentNode) {
    if (current.nodeType !== 1) break;
    if (current.hidden) found.push(current.id || String(current.tagName).toLowerCase());
  }
  return found;
}

/** True when anything above `node` is a disclosure the harness reads through. */
function insideDisclosure(node) {
  for (let current = node.parentNode; current; current = current.parentNode) {
    if (String(current.tagName ?? "").toLowerCase() === "details") return true;
  }
  return false;
}

/** The ids of `region`'s own tab stops, in order. */
function tabStopsWithin(document, regionId) {
  const region = document.getElementById(regionId);
  return tabSequence(document)
    .filter((element) => {
      for (let node = element; node; node = node.parentNode) if (node === region) return true;
      return false;
    })
    .map((element) => element.id);
}

/* ------------------- 1. the sentence, at the control, in the open ------------ */

test("both egress disclosures ship as visible static markup beside their control", () => {
  const document = parseHtml(finopsHtml);

  for (const id of [SHARE_EGRESS_ID, DOWNLOAD_EGRESS_ID]) {
    // Authored in the document rather than written by a script: a claim about
    // where a reader's figures travel must not depend on a module having run.
    assert.equal(finopsHtml.includes(`id="${id}"`), true, `${id} is not in the shipped markup`);
    const note = document.getElementById(id);
    assert.equal(Boolean(note), true, `${id} did not parse out of the document`);
    assert.equal(String(note.tagName).toLowerCase(), "p", `${id} must be plain prose`);

    // Not hidden itself, and not folded into a disclosure the harness sees
    // through. The prior failure was exactly this: the words shipped, and
    // shipped hidden.
    assert.notEqual(note.hidden, true, `${id} ships hidden`);
    assert.equal(insideDisclosure(note), false, `${id} is folded inside a details element`);

    // The one region above it that may be hidden is the region its own control
    // is offered or withheld with. Anything else hidden above it means the words
    // are gone while the button they describe is on screen.
    assert.deepEqual(hiddenAncestorIds(note), [CONTROL_REGION[id]],
      `${id} is suppressed by something other than its own control's region`);
  }
});

test("each egress sentence says the figures are the sender's and travel where they are pasted", () => {
  const document = parseHtml(finopsHtml);
  for (const id of [SHARE_EGRESS_ID, DOWNLOAD_EGRESS_ID]) {
    const words = textOf(document.getElementById(id));
    assert.match(words, /your own/i, `${id} does not say whose figures these are`);
    assert.match(words, /paste/i, `${id} does not say the payload travels wherever it is pasted`);
  }
});

test("the copy control is offered with its egress sentence, and withheld with it", () => {
  const document = parseHtml(finopsHtml);
  const note = document.getElementById(SHARE_EGRESS_ID);

  // Nothing retained: the block, the button and the sentence are all withheld
  // together, because there is no link to copy and so nothing to disclose.
  applyShareLink(document, storageWith(null), { origin: ORIGIN });
  assert.equal(document.getElementById(SHARE_LINK_IDS.block).hidden, true);
  assert.deepEqual(hiddenAncestorIds(note), [SHARE_LINK_IDS.block]);

  // A retained period offers the control — and the sentence is in the open with
  // it, with nothing hidden anywhere above it.
  applyShareLink(document, storageWith([period(2)]), { origin: ORIGIN });
  assert.equal(document.getElementById(SHARE_LINK_IDS.block).hidden, false);
  assert.deepEqual(hiddenAncestorIds(note), []);
});

/* ------------------------ 2. keyboard reach and tab cost -------------------- */

test("the copy control is reachable by keyboard and the disclosures add no tab stop", () => {
  const document = parseHtml(finopsHtml);
  applyShareLink(document, storageWith([period(2)]), { origin: ORIGIN });

  // The share region's tab order, exactly: the button that copies, then the box
  // holding what it copies. The sentences sit between them as prose and cost
  // nothing to cross.
  assert.deepEqual(tabStopsWithin(document, SHARE_LINK_IDS.block),
    [SHARE_LINK_IDS.button, SHARE_LINK_IDS.text]);

  const reachable = tabSequence(document).map((element) => element.id);
  assert.equal(reachable.includes(SHARE_LINK_IDS.button), true,
    "the copy control is not reachable by keyboard");
  for (const id of [SHARE_EGRESS_ID, DOWNLOAD_EGRESS_ID]) {
    assert.equal(reachable.includes(id), false, `${id} became a tab stop`);
  }
});

test("neither disclosure contains a focusable element of its own", () => {
  const document = parseHtml(finopsHtml);
  for (const id of [SHARE_EGRESS_ID, DOWNLOAD_EGRESS_ID]) {
    const note = document.getElementById(id);
    const inside = note.querySelectorAll("a,button,input,select,textarea,summary,[tabindex]");
    assert.equal(inside.length, 0, `${id} carries ${inside.length} focusable descendant(s)`);
  }
});

test("each control names its egress sentence as part of its own description", () => {
  const document = parseHtml(finopsHtml);

  const copy = document.getElementById(SHARE_LINK_IDS.button);
  assert.equal(copy.getAttribute("type"), "button");
  assert.equal(copy.getAttribute("aria-describedby")?.split(/\s+/).includes(SHARE_EGRESS_ID), true,
    "the copy control does not name its egress sentence");

  const download = document.getElementById(DOWNLOAD_BUTTON_ID);
  assert.equal(download.getAttribute("type"), "button");
  assert.equal(download.getAttribute("aria-describedby")?.split(/\s+/).includes(DOWNLOAD_EGRESS_ID),
    true, "the download control does not name its egress sentence");

  // A real control in the shipped document, ahead of the sentence that
  // describes it: the export group's tab order is its two buttons and nothing
  // else, once the results region it lives with is on screen.
  document.getElementById("local-results").hidden = false;
  assert.deepEqual(tabStopsWithin(document, "local-export-actions"),
    [DOWNLOAD_BUTTON_ID, "export-local-summary"]);
  assert.equal(tabSequence(document).map((element) => element.id).includes(DOWNLOAD_EGRESS_ID),
    false, `${DOWNLOAD_EGRESS_ID} became a tab stop`);
});

/* --------------------------- 3. the shared sheet ---------------------------- */

/**
 * Open the printable briefing on a link carrying two of the sender's periods,
 * exactly as a colleague's browser does, and hand back the painted document.
 *
 * Driven through the shipped page entry rather than the view alone: the failure
 * this replaces was a container that existed in a renderer and never reached the
 * page, which is indistinguishable from no container at all to the reader.
 */
async function openSharedLink(t) {
  const page = await loadPage(BRIEFING_PAGE, {
    location: { hash: `#brief=${encodeSharedBriefing([period(0), period(1)]).token}` },
  });
  t.after(() => page.restore());
  await importPageModule("/executive-briefing-page.js");
  await waitFor(
    () => page.document.getElementById("executive-briefing").getAttribute("aria-busy") !== "true",
    "the briefing never finished painting",
  );
  return page.document;
}

test("the shared sheet reaches the page, and costs the reader no tab stop", async (t) => {
  const document = await openSharedLink(t);
  const sheet = document.getElementById(SHARED_SHEET_ID);
  assert.equal(Boolean(sheet), true, "the shared-sheet container is absent from the painted page");
  assert.equal(sheet.querySelectorAll(".brief-figure").length, 1);
  // A masthead, not a toolbar: nothing in it is focusable.
  assert.equal(sheet.querySelectorAll("a,button,input,select,textarea,summary,[tabindex]").length, 0);
  assert.equal(tabSequence(document).map((element) => element.id).includes(SHARED_SHEET_ID), false);
});

test("the shared sheet reads figure first, then grade and provenance one level down", async (t) => {
  const document = await openSharedLink(t);
  const sheet = document.getElementById(SHARED_SHEET_ID);

  // The answer region's own type-scale roles, reused rather than restated.
  const roles = sheet.querySelectorAll("p").map((node) => node.className);
  assert.deepEqual(
    roles.filter((name) => ["brief-figure", "brief-figure-label", "brief-verdict",
      "brief-provenance-line"].includes(name)),
    ["brief-figure", "brief-figure-label", "brief-verdict", "brief-provenance-line"],
    "the shared sheet's reading order is not figure, then grade, then provenance",
  );
  // The figure the sheet leads with is the figure the metric section states.
  const figures = document.querySelectorAll(".brief-figure");
  assert.equal(figures.length, 2);
  assert.equal(textOf(figures[0]), textOf(figures[1]));

  // The grade is announced in the page's existing words, verbatim: the same
  // label, word and rung the trust verdict below already uses.
  const verdicts = document.querySelectorAll(".brief-verdict");
  assert.equal(verdicts.length, 2);
  assert.equal(verdicts[0].dataset.confidence, verdicts[1].dataset.confidence);
  assert.equal(textOf(verdicts[0]), textOf(verdicts[1]),
    "the shared sheet announces the grade in different words from the trust verdict");
});

test("the shared figure's measured and estimated parts each carry a word and a value", async (t) => {
  const document = await openSharedLink(t);
  const parts = document.getElementById(SHARED_SHEET_ID).querySelectorAll("[data-basis]");
  assert.deepEqual(parts.map((node) => node.dataset.basis), ["measured", "estimated"]);

  for (const part of parts) {
    // A word, a value, and a silhouette — never a colour on its own. The
    // silhouette follows the chip rule in design-system/claude-design:
    // outline is a static classification, a filled wash is a derived signal.
    assert.match(textOf(part.querySelectorAll(".brief-component-tag")[0]), /^(Measured|Estimated)$/);
    assert.match(textOf(part.querySelectorAll(".brief-component-value")[0]), /\$[\d,]/,
      "a component of the figure carries no value of its own");
  }
  assert.equal(parts[0].dataset.silhouette, "outline", "a measurement is a static classification");
  assert.equal(parts[1].dataset.silhouette, "filled", "a modelled scenario is a derived signal");
});

/* ------------- the states nobody demos: empty, unknown, implausible --------- */

/**
 * Draw one shared sheet off a briefing shaped by hand, and hand it back.
 *
 * The page is loaded first because the view composes against the document the
 * browser gives it — these states are reached by a real recipient's browser on a
 * real link, so they are drawn by the shipped renderer rather than described.
 */
async function sheetOf(t, briefing) {
  const page = await loadPage(BRIEFING_PAGE);
  t.after(() => page.restore());
  const article = renderExecutiveBriefingPreview(briefing, { origin: "", shared: true });
  const sheet = article.querySelectorAll(".brief-shared")[0];
  assert.equal(sheet.id, SHARED_SHEET_ID);
  return sheet;
}

test("a link carrying no computable figure still draws a sheet that says so", async (t) => {
  const sheet = await sheetOf(t, {
    absent: { recoverable: { statement: "Two of the sender’s periods carry no attributed spend." } },
    confidence: { level: "low" },
  });
  // The figure slot is drawn, not dropped: a missing number is a state, and a
  // sheet that omits its own headline reads as a sheet that is still loading.
  assert.equal(textOf(sheet.querySelectorAll(".brief-figure")[0]), "—");
  assert.match(textOf(sheet.querySelectorAll(".brief-figure-label")[0]), /no attributed spend/);
  // The grade still reads, and both components still say what kind of number
  // they would have been.
  assert.equal(sheet.querySelectorAll(".brief-verdict").length, 1);
  assert.deepEqual(
    sheet.querySelectorAll("[data-basis]").map((node) => textOf(node.querySelectorAll(".brief-component-tag")[0])),
    ["Measured", "Estimated"],
  );
});

test("an unknown grade and missing provenance are drawn as themselves, not as blanks", async (t) => {
  const sheet = await sheetOf(t,
    { confidence: { level: "provisional-v2" }, recoverable: { valueMinor: 1000, label: "x" } });
  const verdict = sheet.querySelectorAll(".brief-verdict")[0];
  // A rung this build has no word for still announces in the same voice: the
  // label, the raw level, and an honest "level 0 of N" rather than a guess.
  assert.equal(verdict.dataset.confidence, "provisional-v2");
  assert.match(textOf(verdict), /Confidence/);
  assert.match(textOf(verdict), /provisional-v2/);
  assert.match(textOf(verdict), /level 0 of/);
  // No provenance in the payload: the counts read as em dashes, never "undefined".
  const measured = sheet.querySelectorAll("[data-basis]")[0];
  assert.match(textOf(measured.querySelectorAll(".brief-component-note")[0]), /Summed from — of — records/);
});

test("an implausible figure is formatted and still labelled as a modelled scenario", async (t) => {
  const sheet = await sheetOf(t, {
    recoverable: { valueMinor: 9_999_999_999_99, analyzedSpendMinor: 1, label: "Recoverable" },
    confidence: { level: "moderate" },
  });
  assert.match(textOf(sheet.querySelectorAll(".brief-figure")[0]), /^\$9,999,999,999\.99$/);
  const estimated = sheet.querySelectorAll("[data-basis]")[1];
  assert.match(textOf(estimated.querySelectorAll(".brief-component-note")[0]),
    /not an invoice line and not a realized saving/);
  // A figure this size must not be able to read as money already banked, so the
  // word beside it is "Estimated" and the silhouette is the derived one.
  assert.equal(textOf(estimated.querySelectorAll(".brief-component-tag")[0]), "Estimated");
  assert.equal(estimated.dataset.silhouette, "filled");
});
