// The executive briefing, built from the reader's own browser — and printed.
//
// tests/executive-briefing-preview.test.js owns the sheet's reading order,
// semantics, and print stylesheet against the published sample. This file owns
// the two things that make the surface a leader's own artifact rather than a
// demo of one:
//
//   * WHOSE FIGURES — the page prefers this browser's retained FinOps periods,
//     builds the briefing from them without a single network request, and when
//     there are none says which of the six reasons applies before falling back
//     to the labelled sample;
//   * THE PRINT FLOW — one obvious control, reachable from the keyboard, that
//     expands every disclosure *before* the dialog opens, hands the reader's own
//     state back afterwards, and says so when the browser offers no dialog.
//
// Every period here is generated in the test rather than committed, and the page
// runs for real: the shipped markup, the shipped entry, the shipped contract.
// The harness `fetch` throws on any request a test did not declare, so the
// workspace path asserting "no routes" is an assertion that this page derives a
// leader's briefing without asking anything of the network.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { FINOPS_WORKSPACE_KEY, FINOPS_WORKSPACE_VERSION } from "../src/finops-workspace-contract.js";
import { FORBIDDEN_LINK_PATTERN } from "../src/executive-finops-briefing.js";
import { loadPage, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const PAGE = new URL("../src/executive-briefing.html", import.meta.url);
const FIXTURE_URL = new URL("../src/executive-finops-briefing-fixture.json", import.meta.url);
const CSS_URL = new URL("../src/executive-briefing.css", import.meta.url);

const readFixture = async () => JSON.parse(await readFile(FIXTURE_URL, "utf8"));

/**
 * One retained period, in the shape the workspace stores and the executive
 * contract reads. Only what either one actually selects from is stated.
 */
function period({
  month, analyzedMinor = 5_000_000, recoverableMinor = 750_000, dataset = "user",
  confidence = "high", orgUnit = "syn-model-serving", absenceReason,
} = {}) {
  const next = String(Number(month.slice(5)) + 1).padStart(2, "0");
  return {
    periodId: `${dataset}:${month}`,
    period: month,
    dataset,
    briefingContractVersion: "finops-briefing/1.0.0",
    derivedAt: `${month.slice(0, 5)}${next}-02T09:00:00.000Z`,
    sourceFingerprint: `fp-${month}`,
    analyzedSpendMinor: analyzedMinor,
    attributedSpendMinor: analyzedMinor,
    recoverableScenarioMinor: recoverableMinor,
    recordsTotal: 200,
    recordsAnalyzed: 200,
    coverageRatioPpm: 960_000,
    confidence,
    missingInputs: [],
    materialMetricId: "recoverable_scenario",
    materialMetricMinor: recoverableMinor,
    topDepartmentId: orgUnit,
    ...(absenceReason ? { absenceReason } : {}),
  };
}

/**
 * Three gapless months whose last one recovers 15% against a 10% baseline: a
 * briefing with an eligible benchmark, a positive standing, and a figure a
 * reader can check by hand ($7,500.00 of $50,000.00).
 */
const THREE_MONTHS = [
  period({ month: "2026-04", recoverableMinor: 500_000 }),
  period({ month: "2026-05", recoverableMinor: 500_000 }),
  period({ month: "2026-06", recoverableMinor: 750_000 }),
];

/** A stored workspace document, as the browser would hold it. */
function workspaceDocument({ consent = "granted", periods = [], version = FINOPS_WORKSPACE_VERSION } = {}) {
  return JSON.stringify({
    schemaVersion: version,
    consent: {
      state: consent,
      decidedAt: "2026-07-01T10:00:00.000Z",
      grantedAgainst: consent === "granted" ? "finops-workspace/1.1.0" : null,
    },
    periods,
    commitments: [],
    meta: { lastWriteAt: "2026-07-02T10:00:00.000Z" },
  });
}

const storedWorkspace = (options) => ({ [FINOPS_WORKSPACE_KEY]: workspaceDocument(options) });

/**
 * Stand up the page. `storage` seeds this browser's store; `routes` declares the
 * only files fetch may serve — omitting it entirely is how a test asserts that
 * the page reached the network for nothing at all.
 */
async function openPage(t, { storage = {}, routes } = {}) {
  const page = await loadPage(PAGE, { storage, routes: routes ?? {} });
  t.after(() => page.restore());
  await importPageModule("/executive-briefing-page.js");
  const root = page.document.getElementById("executive-briefing");
  await waitFor(() => root.getAttribute("aria-busy") === "false", "the briefing finished painting");
  return { page, document: page.document, root };
}

const source = () => importPageModule("/executive-briefing-source.js");

/* ------------------------- whose figures are these ------------------------- */

test("a workspace holding retained periods is the source, and the sample is not", async () => {
  const { BRIEFING_SOURCE, chooseBriefingSource } = await source();
  const storage = storageOf(storedWorkspace({ periods: THREE_MONTHS }));

  const chosen = chooseBriefingSource(storage);
  assert.equal(chosen.source, BRIEFING_SOURCE.workspace);
  assert.equal(chosen.absence, null);
  assert.equal(chosen.retainedCount, 3);
  assert.deepEqual(chosen.periods.map((entry) => entry.period), ["2026-04", "2026-05", "2026-06"]);
  assert.match(chosen.origin, /Your own retained FinOps periods/);
  assert.match(chosen.provenanceNote, /this browser's own FinOps workspace/);
});

test("every reason a browser cannot be briefed on is its own code, with a remedy", async () => {
  const { BRIEFING_SOURCE, WORKSPACE_ABSENCE, chooseBriefingSource } = await source();

  const cases = [
    [WORKSPACE_ABSENCE.notAsked, storageOf({})],
    [WORKSPACE_ABSENCE.declined, storageOf(storedWorkspace({ consent: "declined" }))],
    [WORKSPACE_ABSENCE.empty, storageOf(storedWorkspace({ consent: "granted", periods: [] }))],
    [WORKSPACE_ABSENCE.unreadable, storageOf({ [FINOPS_WORKSPACE_KEY]: "{not a document" })],
    [WORKSPACE_ABSENCE.unsupported,
      storageOf({ [FINOPS_WORKSPACE_KEY]: workspaceDocument({ version: "finops-workspace/9.0.0" }) })],
    [WORKSPACE_ABSENCE.invalidRecords, storageOf(storedWorkspace({
      periods: [{ ...THREE_MONTHS[0], analyzedSpendMinor: 1.5 }],
    }))],
    [WORKSPACE_ABSENCE.storageBlocked, storageOf({}, { refuse: true })],
    [WORKSPACE_ABSENCE.storageBlocked, null],
  ];

  for (const [code, storage] of cases) {
    const chosen = chooseBriefingSource(storage);
    assert.equal(chosen.source, BRIEFING_SOURCE.sample, `${code} did not fall back to the sample`);
    assert.equal(chosen.absence.code, code);
    // Three sentences a reader can act on, and never a link to follow or a
    // secret to hand over: this surface accepts neither, so a remedy that asked
    // for one would be describing a page that does not exist.
    for (const part of ["summary", "statement", "remedy"]) {
      assert.ok(chosen.absence[part]?.length > 20, `${code} has no ${part}`);
      assert.doesNotMatch(chosen.absence[part], FORBIDDEN_LINK_PATTERN);
      assert.doesNotMatch(chosen.absence[part], /\b(enter|paste|provide|supply|upload|connect)\s+(your|a|an|the)\b/i,
        `${code} asks the reader to hand something over`);
    }
    assert.equal(chosen.retainedCount, 0);
  }

  // Seven distinct reasons, not one shrug: "you declined" and "this browser
  // refused the key" are different facts about the reader's own machine.
  assert.equal(new Set(Object.values(WORKSPACE_ABSENCE)).size, 7);
});

test("one invalid retained record rejects the whole local source rather than publishing a subset", async () => {
  const { WORKSPACE_ABSENCE, chooseBriefingSource } = await source();
  const invalid = { ...THREE_MONTHS[1], recordsAnalyzed: -1 };
  const storage = storageOf(storedWorkspace({ periods: [THREE_MONTHS[0], invalid, THREE_MONTHS[2]] }));

  const chosen = chooseBriefingSource(storage);

  assert.equal(chosen.source, "sample");
  assert.equal(chosen.absence.code, WORKSPACE_ABSENCE.invalidRecords);
  assert.match(chosen.absence.statement, /partial and misleading briefing/);
  assert.deepEqual(chosen.periods, []);
});

/* ------------------------------ the populated page -------------------------- */

test("the page briefs on this browser's own periods, and asks the network for nothing", async (t) => {
  // No routes at all: the harness throws on any request, so reaching for the
  // published sample here would fail this test rather than pass unnoticed.
  const { document, root } = await openPage(t, { storage: storedWorkspace({ periods: THREE_MONTHS }) });

  const article = root.querySelector(".brief");
  assert.equal(article.getAttribute("data-state"), "briefing");
  assert.equal(root.querySelector(".brief-source-notice"), null, "the reader's own figures were labelled a sample");

  // The figure is this workspace's own month, formatted, and read against its
  // own trailing baseline: $7,500.00 of $50,000.00 is 15.0%, against 10.0%.
  assert.equal(textOf(document.querySelector(".brief-figure")), "$7,500.00");
  assert.match(textOf(document.querySelector(".brief-figure-share")),
    /15\.0% of \$50,000\.00 analyzed spend in 2026-06/);
  const standing = document.querySelector(".brief-standing");
  assert.equal(standing.getAttribute("data-standing"), "more_recoverable_than_baseline");
  assert.match(textOf(standing), /\+5\.0 pts against 10\.0% over 2 prior periods/);

  // One answerable question, one org unit to act on, one action.
  assert.match(textOf(document.querySelector(".brief-question")), /Where should we act first\?/);
  assert.match(textOf(document.querySelector(".brief-answer")), /syn-model-serving/);
  assert.equal(article.querySelectorAll('[data-role="priority-action"]').length, 1);

  // The masthead says whose figures these are, and the provenance says where
  // they were read from — both on screen and, since neither is behind a
  // disclosure this code closes, on paper.
  assert.match(textOf(document.querySelector(".brief-origin")), /Your own retained FinOps periods/);
  assert.match(textOf(document.querySelector(".brief-provenance-note")), /this browser's own FinOps workspace/);
  assert.match(textOf(document.querySelector(".brief-stamp")), /Dataset: user/);

  // The safety claim holds for what is actually on screen.
  assert.doesNotMatch(textOf(root), FORBIDDEN_LINK_PATTERN);
  assert.equal(root.querySelectorAll("a").length, 0, "a printable briefing offers no link to follow");
});

test("hostile retained labels are rendered as text and cannot create markup", async (t) => {
  const hostileOrgUnit = '<img src=x onerror="globalThis.pwned=true"><script>pwned()</script>';
  const periods = THREE_MONTHS.map((entry) => ({ ...entry, topDepartmentId: hostileOrgUnit }));
  const { root } = await openPage(t, { storage: storedWorkspace({ periods }) });

  // The value is contract-valid derived text, so this exercises the final
  // output-encoding boundary rather than relying on input refusal to hide an
  // unsafe renderer. A future innerHTML refactor would turn these into elements
  // and fail loudly.
  assert.equal(root.querySelector(".brief").getAttribute("data-synthetic"), null,
    "the hostile workspace was silently replaced by the synthetic sample");
  assert.equal(root.querySelector(".brief-org-unit").textContent, hostileOrgUnit);
  assert.equal(root.querySelectorAll("img").length, 0);
  assert.equal(root.querySelectorAll("script").length, 0);
  assert.equal(root.querySelectorAll("[onerror]").length, 0);
});

test("a workspace whose only period cannot be briefed on names every empty slot", async (t) => {
  const storage = storedWorkspace({
    periods: [period({ month: "2026-06", recoverableMinor: 0, confidence: "insufficient" })],
  });
  const { document, root } = await openPage(t, { storage });

  const article = root.querySelector(".brief");
  assert.equal(article.getAttribute("data-state"), "absent");
  assert.equal(root.querySelector(".brief-source-notice"), null, "these are still the reader's own months");
  for (const label of ["Where to act first", "How much is indicated", "How it compares", "What should happen next"]) {
    assert.match(textOf(article), new RegExp(label), `${label} is neither shown nor explained`);
  }
  assert.equal(document.querySelectorAll(".brief-figure").length, 0, "an absent metric was drawn as a figure");
  // The verdict, the bounds, and both levels still ship, so the sheet a reader
  // prints from this state still says why there is nothing on it.
  assert.match(textOf(article.querySelector("[data-confidence]")), /Insufficient level 1 of 4/);
  assert.equal(article.querySelectorAll(".brief-disclosure").length, 2);
  // And it is still printable: an artifact that explains an absence is worth
  // taking to the meeting the absence will be raised in.
  assert.ok(document.getElementById("brief-print"), "the print control is withheld from the absent state");
});

/* ----------------------------- the unavailable page ------------------------- */

test("a browser with nothing retained says so first, then shows the labelled sample", async (t) => {
  // No routes: the harness throws on any request, so a page that still fetched
  // its sample would fail here rather than quietly cost a reader a round-trip.
  const { document, root } = await openPage(t, {});

  const notice = root.querySelector(".brief-source-notice");
  assert.ok(notice, "the page passed off the published sample as the reader's own figures");
  assert.equal(notice.getAttribute("data-absence"), "retention_not_chosen");
  assert.equal(notice.getAttribute("role"), "status", "an empty workspace is a state, not a fault");
  assert.equal(notice.querySelector("h2").id, "brief-source-title");
  assert.match(textOf(notice), /Not your figures/);
  assert.match(textOf(notice), /nothing will be until you choose it on the AI FinOps page/);
  assert.match(textOf(notice), /published synthetic sample is shown below/);

  // Order matters more than presence: the reader is told whose figures these
  // are before they read one.
  const children = [...root.children];
  assert.ok(children.indexOf(notice) < children.findIndex((node) => node.classList.contains("brief")),
    "the sample was drawn above the notice that qualifies it");
  assert.match(textOf(document.querySelector(".brief-origin")), /synthetic sample/i);
  assert.equal(textOf(document.querySelector(".brief-figure")), "$6,120.00");

  // The notice is part of a printable document, so it carries no link either.
  assert.doesNotMatch(textOf(notice), FORBIDDEN_LINK_PATTERN);
  assert.equal(notice.querySelectorAll("a").length, 0);
});

test("a declined choice and an unreadable document are told apart on the page", async (t) => {
  const declined = await openPage(t, { storage: storedWorkspace({ consent: "declined" }) });
  assert.equal(declined.root.querySelector(".brief-source-notice").getAttribute("data-absence"),
    "retention_declined");
  assert.match(textOf(declined.root.querySelector(".brief-source-notice")), /That choice is respected/);
  declined.page.restore();

  const unreadable = await openPage(t, {
    storage: { [FINOPS_WORKSPACE_KEY]: "not a workspace at all" },
  });
  const notice = unreadable.root.querySelector(".brief-source-notice");
  assert.equal(notice.getAttribute("data-absence"), "unreadable_document");
  assert.match(textOf(notice), /nothing here rewrites or deletes it/);
  // Reading is all this page does: the stored text is exactly as it was.
  assert.equal(unreadable.page.storage.getItem(FINOPS_WORKSPACE_KEY), "not a workspace at all");
});

/* ---------------------------------- printing -------------------------------- */

test("the print control is one labelled button, described, and reachable by keyboard", async (t) => {
  const { document } = await openPage(t, { storage: storedWorkspace({ periods: THREE_MONTHS }) });

  const button = document.getElementById("brief-print");
  assert.ok(button, "the page offers no print control at all");
  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.getAttribute("type"), "button");
  assert.match(textOf(button), /Print or save as PDF/, "the control is labelled by an icon alone");
  const note = document.getElementById(button.getAttribute("aria-describedby"));
  assert.ok(note, "the control's description names an element that does not exist");
  assert.match(textOf(note), /Both levels open on paper/);
  assert.match(textOf(note), /Nothing is uploaded/);
  assert.ok(tabSequence(document).includes(button), "the print control is not reachable from the keyboard");
});

test("pressing print opens every level before the dialog and restores the reader's own state after", async (t) => {
  const { document, root } = await openPage(t, { storage: storedWorkspace({ periods: THREE_MONTHS }) });
  const article = root.querySelector(".brief");
  const toggles = [...document.querySelectorAll(".brief-toggle")];

  // The reader opened level 2 themselves; only level 3 is this code's to close.
  toggles[0].click();
  assert.equal(toggles[0].getAttribute("aria-expanded"), "true");

  // What the dialog would have been handed, captured at the instant it opened.
  let duringDialog = null;
  let hiddenDuringDialog = null;
  globalThis.window.print = () => {
    duringDialog = toggles.map((toggle) => toggle.getAttribute("aria-expanded"));
    hiddenDuringDialog = article.querySelectorAll(".brief-panel[hidden]").length;
  };
  document.getElementById("brief-print").click();

  assert.deepEqual(duringDialog, ["true", "true"], "a level was still collapsed when the dialog opened");
  assert.equal(hiddenDuringDialog, 0, "a panel was hidden from the sheet the reader asked for");
  // Afterwards the page is the reader's again, not the printer's.
  assert.equal(toggles[0].getAttribute("aria-expanded"), "true", "printing closed a level the reader opened");
  assert.equal(toggles[1].getAttribute("aria-expanded"), "false", "printing left a level open behind it");
  assert.equal(textOf(document.getElementById("brief-print-status")), "");
});

test("a browser that offers no print dialog is told to use its own, with the sheet already open", async (t) => {
  const { document } = await openPage(t, { storage: storedWorkspace({ periods: THREE_MONTHS }) });
  delete globalThis.window.print;

  document.getElementById("brief-print").click();

  const status = document.getElementById("brief-print-status");
  assert.equal(status.getAttribute("role"), "status");
  assert.match(textOf(status), /did not offer a print dialog/);
  assert.match(textOf(status), /printing from the browser's own menu produces the same sheet/);
  // Left expanded on purpose: the reader's next move is the browser's own print
  // command, and it must find the whole briefing rather than a headline.
  for (const toggle of document.querySelectorAll(".brief-toggle")) {
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
  }
});

test("the print sheet drops the control and keeps the notice that qualifies the figure", async () => {
  const css = await readFile(CSS_URL, "utf8");
  const print = css.slice(css.indexOf("@media print"));

  assert.match(print, /\.brief-print-control \{ display:none !important; \}|\.brief-print-control[^\n]*display:none/,
    "the print control prints as a dead button on paper");
  // The notice is not chrome: it is the sentence that stops a synthetic figure
  // being read as a measurement once the sheet leaves the room.
  assert.doesNotMatch(print, /\.brief-source-notice[^\n]*display:none/);
  assert.match(print, /\.brief-source-notice \{[^}]*break-inside:avoid/);
  assert.match(print, /\.brief-source-notice \{[^}]*background:none !important/);
  // The screen control is a target a thumb can hit, and a focus ring can find.
  assert.match(css, /\.brief-print-button \{[^}]*min-height:44px/);
  assert.match(css, /\.brief-print-button:focus-visible \{ outline:3px solid var\(--focus-ring\)/);
});

/* --------------- the empty state is a whole artifact, immediately ----------- */

test("the bundled sample is the published fixture's own input, and rebuilds its briefing", async () => {
  const fixture = await readFixture();
  const { SAMPLE_RETAINED_PERIODS, sampleRetainedPeriods } =
    await importPageModule("/executive-briefing-sample.js");
  const { buildExecutiveBriefing, validateExecutiveBriefing } =
    await importPageModule("/executive-finops-briefing.js");

  // Duplicated data is only safe when a drift is loud. This is where it is loud.
  assert.deepEqual(JSON.parse(JSON.stringify(sampleRetainedPeriods())), fixture.input.retainedPeriods);
  const briefing = buildExecutiveBriefing(sampleRetainedPeriods());
  assert.deepEqual(JSON.parse(JSON.stringify(briefing)), fixture.briefing);
  assert.equal(validateExecutiveBriefing(briefing).valid, true);

  // Deterministic twice over: the same periods, and a copy the contract may sort
  // or splice without reaching back into the module's own frozen record.
  assert.deepEqual(sampleRetainedPeriods(), sampleRetainedPeriods());
  assert.notEqual(sampleRetainedPeriods()[0], SAMPLE_RETAINED_PERIODS[0]);
  assert.throws(() => { SAMPLE_RETAINED_PERIODS[0].analyzedSpendMinor = 1; }, TypeError);
});

test("an empty workspace with no network at all still paints a complete briefing", async (t) => {
  // No storage, no routes: the harness throws on every request, so anything the
  // reader sees here was already in the bundle.
  const { document, root } = await openPage(t, {});

  const article = root.querySelector(".brief");
  assert.ok(article, "an empty workspace was left on a loading or error state");
  assert.equal(article.getAttribute("data-state"), "briefing");
  assert.equal(root.querySelector('.brief-state[data-state="loading"]'), null);
  assert.equal(root.querySelector('.brief-state[data-state="error"]'), null);

  // Everything the first screen owes a leader, present without opening a level.
  assert.match(textOf(document.querySelector(".brief-question")), /Where should we act first\?/);
  assert.match(textOf(document.querySelector(".brief-answer")), /syn-support-triage/);
  assert.equal(textOf(document.querySelector(".brief-figure")), "$6,120.00");
  assert.match(textOf(article.querySelector('[data-role="priority-action"]')), /Pilot lower-cost routing/);
  assert.equal(article.querySelectorAll('[data-role="priority-action"]').length, 1,
    "a leader is owed one recommended next action, not a menu");
  assert.match(textOf(document.querySelector(".brief-verdict")), /Confidence High/);
  // And it is a sheet worth taking away.
  assert.ok(document.getElementById("brief-print"), "the print control is withheld from the empty state");
});

test("the sample says it is synthetic on the artifact, and separates modelled from realized", async (t) => {
  const { document, root } = await openPage(t, {});
  const article = root.querySelector(".brief");

  // Said on the sheet itself, not only in the notice above it: a cropped
  // screenshot or a photographed page must still carry the word.
  assert.equal(article.getAttribute("data-synthetic"), "true");
  const banner = article.querySelector(".brief-synthetic");
  assert.ok(banner, "the sample carries no synthetic label inside the briefing");
  // Never `assert.equal` on two DOM nodes: a failing comparison makes node
  // inspect a cyclic element graph and the run stops responding rather than
  // reporting. Compare identity as a boolean and say what went wrong in words.
  const masthead = article.querySelector(".brief-masthead");
  assert.ok(masthead.children[0] === banner, "the synthetic label is not the first thing in the masthead");
  assert.match(textOf(banner), /Synthetic sample/);
  assert.match(textOf(banner), /not a measurement of your spend/);
  assert.match(textOf(document.querySelector(".brief-origin")), /synthetic sample/i);

  // Modelled potential is not money in the bank, and it says so beside the
  // figure rather than four sections down.
  const basis = article.querySelector(".brief-figure-basis");
  assert.ok(basis, "the headline figure is not distinguished from a realized saving");
  assert.equal(basis.getAttribute("data-basis"), "modelled_potential");
  assert.match(textOf(basis), /Modelled potential, not realized savings/);
  assert.match(textOf(basis), /not a realized saving/);
  assert.match(textOf(basis), /Nothing here has been banked/);
  assert.equal(article.querySelector('[data-role="material-metric"]').querySelectorAll(".brief-figure-basis").length,
    1, "the basis is drawn away from the figure it qualifies");

  // Provenance and the route to the method are readable without opening a level.
  const provenance = article.querySelector(".brief-provenance-summary");
  assert.ok(provenance, "the first screen discloses no provenance at all");
  assert.equal(provenance.querySelectorAll("[hidden]").length, 0);
  assert.ok(provenance.closest(".brief-panel") === null, "provenance was hidden behind a disclosure");
  assert.match(textOf(provenance), /3 retained periods of the user dataset/);
  assert.match(textOf(provenance), /1,766 of 1,840 records analyzed/);
  assert.match(textOf(provenance), /No clock, no random value, no network request/);
  assert.match(textOf(provenance), /What this rests on/);
  assert.match(textOf(provenance), /How every figure is recomputed/);

  // Still a printable document with nothing to follow and nothing to leak.
  assert.doesNotMatch(textOf(root), FORBIDDEN_LINK_PATTERN);
  assert.equal(root.querySelectorAll("a").length, 0);
});

test("every unbriefable workspace paints the same complete sample, however it failed", async (t) => {
  const cases = [
    ["retention_declined", storedWorkspace({ consent: "declined" })],
    ["no_retained_period", storedWorkspace({ consent: "granted", periods: [] })],
    ["unreadable_document", { [FINOPS_WORKSPACE_KEY]: "{not a document" }],
    ["unsupported_document", { [FINOPS_WORKSPACE_KEY]: workspaceDocument({ version: "finops-workspace/9.0.0" }) }],
    ["invalid_retained_records", storedWorkspace({ periods: [{ ...THREE_MONTHS[0], recordsAnalyzed: -1 }] })],
  ];

  for (const [code, storage] of cases) {
    const opened = await openPage(t, { storage });
    const article = opened.root.querySelector(".brief");
    assert.ok(article, `${code} left the reader with no briefing`);
    assert.equal(article.getAttribute("data-synthetic"), "true", `${code} drew an unlabelled sample`);
    assert.equal(textOf(opened.document.querySelector(".brief-figure")), "$6,120.00", `${code} drew no figure`);
    assert.equal(opened.root.querySelector(".brief-source-notice").getAttribute("data-absence"), code);
    assert.ok(opened.document.getElementById("brief-print"), `${code} offers no sheet to take away`);
    opened.page.restore();
  }
});

test("the print sheet drops the navigation and keeps the label, the basis, and the provenance", async () => {
  const css = await readFile(CSS_URL, "utf8");
  const print = css.slice(css.indexOf("@media print"));

  // Chrome comes off: the sheet is the briefing, and a nav bar on paper is a row
  // of dead links.
  assert.match(print, /\.site-header,\.site-nav,[^{]*\{ display:none !important; \}/);
  // What must survive the trip out of the building with the figure.
  for (const kept of [
    "brief-synthetic", "brief-figure-basis", "brief-provenance-summary",
  ]) {
    assert.doesNotMatch(print, new RegExp(`\\.${kept}[^\\n]*display:none`), `${kept} is dropped on paper`);
    assert.match(print, new RegExp(`\\.${kept} \\{[^}]*break-inside:avoid`),
      `${kept} may be split across a page break`);
  }
  // Colour is decorative on paper; the words carry the meaning in monochrome.
  assert.match(print, /\.brief-synthetic \{[^}]*background:none !important/);
  assert.match(print, /\.brief-basis-tag,\.brief-basis-statement \{[^}]*color:#171713 !important/);
  // And the levels still open, so the full provenance and method print too.
  assert.match(print, /\.brief-panel\[hidden\] \{ display:block !important; \}/);
});

/* --------------------------------- helpers ---------------------------------- */

/** A storage stand-in. `refuse` models a browser that blocks site data outright. */
function storageOf(seed = {}, { refuse = false } = {}) {
  const values = new Map(Object.entries(seed));
  const guard = () => {
    if (refuse) throw new Error("this browser blocks site data");
  };
  return {
    getItem(key) { guard(); return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { guard(); values.set(key, String(value)); },
    removeItem(key) { guard(); values.delete(key); },
  };
}
