// What an operator's own FinOps briefing does between visits (#991).
//
// Three symptoms an operator would notice, each driven end to end through the
// shipped page: the briefing they chose to keep is still there when they come
// back, the briefing they forgot is really gone on the next visit, and today's
// export replaces yesterday's figures instead of mixing with them.
//
// Nothing here stubs the import. A selection is the browser's own File API
// shape over bytes generated in this file, and the dialect detection, the
// column mapping, the join, the analysis, the briefing contract, the retention
// store and the renderers are all the shipped ones. A "reload" is a genuine
// second boot: the page entry is imported again against a fresh document,
// seeded with exactly the storage the first boot left behind.
//
// Assertion discipline, because this suite runs against a headless harness:
// every assertion is on a count, an attribute value or text content. No
// assertion is handed a parsed node — comparing one makes the harness walk the
// whole document to build a diff, which outlives the test timeout.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  BRIEFING_RETENTION_KEY, RETENTION_STATE, retainedSuppliedContext,
} from "../src/finops-briefing-retention.js";
import { ACCEPTED_INDUSTRIES, ACCEPTED_ORG_SIZE_BANDS } from "../src/cohort-attribution.js";
import { ORG_UNIT_LABEL_STORAGE_KEY } from "../src/org-unit-labels.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));
const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

// ---------------------------------------------------------------------------
// Two imports that cannot be mistaken for one another
// ---------------------------------------------------------------------------
//
// Each is a provider period export plus the org roster that attributes it, in
// the shipped v1 tabular dialects, generated here rather than committed. The
// roster matters: without one, nothing joins, the attribution policy withholds
// the money figure, and there is no figure left to prove survived a reload.
//
// The two are disjoint in every dimension a figure can reach the screen
// through — different calendar months, a different department label (and so a
// different opaque unit id), different row amounts, different totals with no
// digits in common. A figure from the spring import appearing after the winter
// one has been imported can only be stale data, never a coincidence of the
// fixtures.

const PROVIDER_HEADER = "usage_date,model,project,n_context_tokens_total,"
  + "n_generated_tokens_total,amount,api_key_name";
const ROSTER_HEADER = "employee_id,full_name,work_email,job_title,department,"
  + "manager_employee_id,employment_status,location";

const providerExport = (department, rows) => [PROVIDER_HEADER,
  ...rows.map(({ date, amount, key }) =>
    `${date},gpt-4o,${department},1840000,214000,${amount},${key}`)].join("\n");

const orgRoster = (department, employeeId) => [ROSTER_HEADER,
  `${employeeId},Ada Fern,ada.fern@example.invalid,Staff Engineer,${department},`
  + `${employeeId}-mgr,Active,Remote`].join("\n");

/** The export this operator imported in the spring. */
const SPRING = Object.freeze({
  label: "spring",
  providerFile: "spring-usage.csv",
  rosterFile: "spring-roster.csv",
  department: "Harbourfield Research",
  months: Object.freeze(["2025-03", "2025-04"]),
  amounts: Object.freeze(["1810.50", "2140.25"]),
  total: "3950.75",
  provider: providerExport("Harbourfield Research", [
    { date: "2025-03-06", amount: "1810.50", key: "harbourfield-batch" },
    { date: "2025-04-09", amount: "2140.25", key: "harbourfield-agent" },
  ]),
  roster: orgRoster("Harbourfield Research", "emp-2001"),
});

/** The export the same operator imports months later. */
const WINTER = Object.freeze({
  label: "winter",
  providerFile: "winter-usage.csv",
  rosterFile: "winter-roster.csv",
  department: "Tessellate Logistics",
  months: Object.freeze(["2025-11", "2025-12"]),
  amounts: Object.freeze(["612.40", "988.10"]),
  total: "1600.50",
  totalUsd: 1600.5,
  provider: providerExport("Tessellate Logistics", [
    { date: "2025-11-04", amount: "612.40", key: "tessellate-batch" },
    { date: "2025-12-15", amount: "988.10", key: "tessellate-agent" },
  ]),
  roster: orgRoster("Tessellate Logistics", "emp-3001"),
});

// ---------------------------------------------------------------------------
// The tab, and what a reload of it means
// ---------------------------------------------------------------------------

/**
 * Open the AI FinOps tab and mirror every storage write into a plain object.
 *
 * The mirror is what makes a reload real. The harness store is seeded from an
 * object but never writes back into it, so without this the second boot would
 * be handed the first boot's STARTING state and a restore test would pass on a
 * page that had saved nothing. The wrappers are installed before the page entry
 * is imported, so the boot's own writes are captured too.
 */
async function openFinopsTab(seed = {}) {
  const page = await loadPage(PAGE, {
    storage: { ...seed },
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  const jar = { ...seed };
  const { setItem, removeItem } = page.storage;
  page.storage.setItem = (key, value) => { jar[key] = String(value); setItem(key, value); };
  page.storage.removeItem = (key) => { delete jar[key]; removeItem(key); };
  page.jar = jar;

  await importPageModule("/evolution-page.js");
  const { document } = page;
  // Every asynchronous surface settles before a test touches the page; one left
  // in flight would run on into the next test.
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  await waitFor(() => shownText(document, "integration-contract-provenance")
    .startsWith("Gateway completed"), "the static contract gateway to settle");
  await waitFor(() => byId(document, "finops-evaluation-result")
    .getAttribute("aria-busy") === "false", "the evaluation panel to settle");
  return page;
}

/** Close this tab and open the page again on whatever this browser now holds. */
async function reopen(page) {
  page.restore();
  return openFinopsTab(page.jar);
}

/** One file selection through the real control, exactly as a browse does. */
function chooseFiles(document, files) {
  const input = byId(document, "local-finops-files");
  input.files = files.map(({ name, text }) => ({ name, type: "text/csv", text: async () => text }));
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

const reviewOpens = (document, fileName) => waitFor(
  () => !byId(document, "import-mapping").hidden
    && shownText(document, "import-mapping-file") === fileName,
  `the column-mapping step to open on ${fileName}`);

/**
 * Import one export with its roster and wait for the page to finish answering.
 *
 * The wait is on the provenance line naming this import's own first month, not
 * on the result region opening: on a second import the region is already open,
 * and waiting for that would return before a single figure had been repainted.
 */
async function importExport(document, fixture) {
  chooseFiles(document, [
    { name: fixture.providerFile, text: fixture.provider },
    { name: fixture.rosterFile, text: fixture.roster },
  ]);
  await reviewOpens(document, fixture.providerFile);
  byId(document, "import-mapping-confirm").click();
  await reviewOpens(document, fixture.rosterFile);
  byId(document, "import-mapping-confirm").click();
  await waitFor(() => !byId(document, "local-results").hidden
    && shownText(document, "finops-provenance").includes(fixture.months[0]),
  `the ${fixture.label} export to be analyzed and rendered`);
  // The point of the roster is that the money joins it. An import that stopped
  // attributing would withhold every figure below, and each assertion about a
  // restored figure would then be passing on an absence.
  assert.equal(byId(document, "local-recoverable").dataset.real, "true",
    `the ${fixture.label} import must produce an attributed figure to keep`);
}

/** The same provider export with no roster beside it: nothing joins an org unit. */
const UNATTRIBUTED = Object.freeze({
  label: "unattributed spring",
  file: "spring-usage-only.csv",
  months: SPRING.months,
  provider: providerExport("Harbourfield Research", [
    { date: "2025-03-06", amount: "1810.50", key: "harbourfield-batch" },
    { date: "2025-04-09", amount: "2140.25", key: "harbourfield-agent" },
  ]),
});

/** Turn the keep-this-briefing control on, and prove the browser took it. */
function keepBriefing(page) {
  const { document } = page;
  byId(document, "local-lead-retention-toggle").click();
  assert.equal(byId(document, "local-lead-retention").dataset.state, RETENTION_STATE.retained,
    "the control must report the briefing as kept before a reload is worth testing");
  assert.notEqual(page.storage.getItem(BRIEFING_RETENTION_KEY), null,
    "keeping a briefing must write the versioned key");
}

/** The figures an operator reads off the briefing, as text. */
const briefingFigures = (document) => ({
  question: shownText(document, "local-lead-question"),
  metric: shownText(document, "local-lead-metric"),
  action: shownText(document, "local-lead-action"),
});

// ---------------------------------------------------------------------------
// 1. Coming back to a briefing you kept
// ---------------------------------------------------------------------------

test("the briefing an operator kept is still on screen when they come back to the tab", async () => {
  let page = await openFinopsTab();
  try {
    await importExport(page.document, SPRING);
    keepBriefing(page);
    const before = briefingFigures(page.document);
    // The import is worth restoring: a real finding with a figure in it, not the
    // contract's "nothing could be computed" state.
    assert.equal(byId(page.document, "local-lead-finding").dataset.state, "available");
    assert.match(before.metric, /\d+\.\d{2} USD/, "the kept briefing must carry a money figure");
    assert.match(before.action, /Pilot lower-cost routing/);

    page = await reopen(page);
    const { document } = page;

    // The operator's own briefing is open on arrival, and says it came back
    // rather than being recomputed.
    assert.equal(byId(document, "local-results").hidden, false);
    assert.equal(byId(document, "local-results").dataset.retained, "true");
    const finding = byId(document, "local-lead-finding");
    assert.equal(finding.hidden, false);
    assert.equal(finding.dataset.state, "available");
    assert.equal(finding.dataset.contractVersion, "finops-briefing/1.0.0",
      "the restored briefing must come through the same contract a fresh import does");

    // Every figure the operator read before closing the tab reads the same now:
    // the question, the money figure with its period, and the sized action.
    assert.deepEqual(briefingFigures(document), before);
    assert.equal(occurrences(shownText(document, "local-lead-metric"), SPRING.months[0]) > 0, true,
      "the restored figure must still name the period it was observed over");

    // The control reports the state it is actually in, and offers the way out.
    assert.equal(byId(document, "local-lead-retention").dataset.state, RETENTION_STATE.retained);
    assert.equal(byId(document, "local-lead-retention-toggle").checked, true);
    assert.equal(byId(document, "local-lead-retention-forget").hidden, false);
    assert.equal(byId(document, "local-lead-retention-captured").hidden, false);
    assert.match(shownText(document, "local-lead-retention-captured"), /^Captured .* UTC$/);

    // Nothing of the file itself came back with the figures: this browser keeps
    // derived values, so a restored page cannot echo a chosen file's name.
    const everything = textOf(document.documentElement);
    assert.equal(occurrences(everything, SPRING.providerFile), 0,
      "a restored briefing must not name the file it was computed from");
    assert.equal(occurrences(everything, SPRING.rosterFile), 0,
      "a restored briefing must not name the roster it was computed from");
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// 2. Forgetting one, and meaning it
// ---------------------------------------------------------------------------

test("after an operator forgets a briefing, the next visit opens on the bundled example", async () => {
  let page = await openFinopsTab();
  try {
    await importExport(page.document, SPRING);
    keepBriefing(page);
    page = await reopen(page);

    // Forget is only reachable because the kept briefing came back and offered
    // it. Asserting that first is what stops this test from passing on a page
    // that restored nothing: the harness will happily click a control a real
    // browser never painted, so the state has to be checked, not the click.
    assert.equal(byId(page.document, "local-lead-retention").hidden, false);
    assert.equal(byId(page.document, "local-lead-retention").dataset.state, RETENTION_STATE.retained);
    assert.equal(byId(page.document, "local-lead-retention-forget").hidden, false,
      "an operator can only forget a briefing the page brought back and showed them");

    byId(page.document, "local-lead-retention-forget").click();
    assert.equal(page.storage.getItem(BRIEFING_RETENTION_KEY), null,
      "forget must remove the key rather than blank it");
    assert.equal(BRIEFING_RETENTION_KEY in page.jar, false,
      "the key must be gone from this browser, not merely from the live page");

    page = await reopen(page);
    const { document } = page;

    // The visit after a forget is the visit a first-time reader gets.
    assert.equal(byId(document, "local-results").hidden, true);
    assert.equal(byId(document, "local-lead-finding").hidden, true);
    assert.equal(byId(document, "local-lead-retention").hidden, true);
    assert.equal(byId(document, "finops-stand").dataset.source, "example");
    assert.match(shownText(document, "finops-stand-label"), /Bundled synthetic example/);
    assert.equal(page.storage.getItem(BRIEFING_RETENTION_KEY), null,
      "nothing may be re-written under the forgotten key by a later load");

    // Not one figure from the forgotten import is anywhere on the page —
    // including inside the folded panels. The harness reads text through a
    // closed disclosure, so this catches residue a reader would find by
    // expanding one; the attribute assertions below are what hold the folding
    // itself, since only a real browser can prove what is off screen.
    const everything = textOf(document.documentElement);
    assert.equal(occurrences(everything, SPRING.total), 0,
      "the forgotten import's total must not survive anywhere on the page");
    for (const month of SPRING.months) {
      assert.equal(occurrences(everything, month), 0,
        `the forgotten import's period ${month} must not survive anywhere on the page`);
    }
    for (const amount of SPRING.amounts) {
      assert.equal(occurrences(everything, amount), 0,
        `the forgotten import's row amount ${amount} must not survive anywhere on the page`);
    }

    // The support panels are folded away rather than emptied on screen only.
    assert.equal(byId(document, "local-lead-arithmetic-detail").hidden, true);
    assert.equal(byId(document, "local-lead-derivation-detail").hidden, true);
    assert.equal(byId(document, "finops-imported-headline").hidden, true);
    assert.equal(byId(document, "finops-imported-movement").hidden, true);
    assert.equal(byId(document, "finops-imported-movement").dataset.periodCount, "0");
    assert.equal(document.querySelectorAll("li.stand-imported-period").length, 0,
      "no period row from the forgotten import may still be painted");
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// 3. A second export, and the figures it has to replace
// ---------------------------------------------------------------------------

test("a second export replaces the figures from the first rather than mixing the two", async () => {
  let page = await openFinopsTab();
  try {
    await importExport(page.document, SPRING);
    keepBriefing(page);
    // Through a reload first, so the second import lands on a restored briefing
    // — the state an operator is actually in when they open the tab and drop in
    // this month's file.
    page = await reopen(page);
    // The spring briefing really is the one on screen when the winter file is
    // dropped in. Without this the test would still pass on a page that
    // restored nothing, and "replaced" would mean "arrived on an empty page".
    assert.equal(byId(page.document, "local-results").dataset.retained, "true");
    assert.equal(byId(page.document, "local-lead-finding").dataset.state, "available");
    const spring = briefingFigures(page.document);
    assert.equal(occurrences(spring.metric, SPRING.months[0]) > 0, true,
      "the restored briefing must be the spring one before the winter file replaces it");

    await importExport(page.document, WINTER);
    const { document } = page;

    // The answer on screen is the winter import's.
    assert.equal(byId(document, "local-lead-finding").dataset.state, "available");
    assert.notDeepEqual(briefingFigures(document), spring,
      "a second import must repaint the briefing, not leave the restored one up");
    assert.equal(occurrences(shownText(document, "local-lead-metric"), WINTER.months[1]) > 0, true,
      "the figure on screen must name the period the second import observed");

    // THE REPLACEMENT ASSERTIONS. Nothing that identifies the spring import —
    // its total or any of its row amounts — is anywhere on the page.
    const everything = textOf(document.documentElement);
    assert.equal(occurrences(everything, SPRING.total), 0,
      "the previous import's total must not survive a second import");
    for (const amount of SPRING.amounts) {
      assert.equal(occurrences(everything, amount), 0,
        `the previous import's row amount ${amount} must not survive a second import`);
    }

    // The one place a previous import's PERIOD is allowed to appear is the
    // period series, which merges what this browser kept with the file just
    // read on purpose (#977), so a month-by-month operator sees movement
    // instead of one period and no change. Everywhere a reader takes a figure
    // from — the briefing itself, and the imported headline above it — a month
    // that is not in the file just imported must be gone.
    const results = shownText(document, "local-results");
    const headline = shownText(document, "finops-imported-headline");
    for (const month of SPRING.months) {
      assert.equal(occurrences(results, month), 0,
        `${month} came from the previous import and must not appear in the briefing`);
      assert.equal(occurrences(headline, month), 0,
        `${month} came from the previous import and must not appear in the headline`);
    }
    const movement = shownText(document, "finops-imported-movement");
    for (const month of WINTER.months) {
      assert.equal(occurrences(movement, month) > 0, true,
        `${month} is in the file just imported and must be in the period series`);
    }
    // The series is labelled with the periods it is made of rather than being a
    // bare list of numbers, so a kept month is identifiable as one.
    const periodRows = document.querySelectorAll("li.stand-imported-period");
    assert.equal(periodRows.length > 0, true, "the second import must paint its own period series");
    for (const month of WINTER.months) {
      assert.equal(periodRows.filter((row) => row.dataset.period === month).length, 1,
        `${month} must be painted exactly once in the period series`);
    }

    // And what this browser is now holding is the winter briefing, not the
    // spring one: a third visit cannot restore a figure the operator replaced.
    const payload = JSON.parse(page.storage.getItem(BRIEFING_RETENTION_KEY));
    const stored = JSON.stringify(payload);
    assert.equal(occurrences(stored, SPRING.total), 0,
      "the kept payload must be rewritten by the second import, not appended to");
    for (const month of SPRING.months) {
      assert.equal(occurrences(stored, month), 0,
        `the kept payload must not still carry the previous import's period ${month}`);
    }
    // Asserted as a number rather than as text: the payload is JSON, where the
    // winter total is 1600.5 and the trailing zero the page prints is a
    // formatting decision the store does not make.
    assert.equal(payload.totals.analyzedSpendUsd, WINTER.totalUsd,
      "the kept payload must carry the second import's own total");
    assert.equal(payload.departments.length, 1,
      "the kept payload must hold the second import's department rollup and no other");
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// 4. A defect this work found, filed as an executable regression
// ---------------------------------------------------------------------------
//
// An operator who imports a provider export with no org roster is told, in so
// many words, that too little of the spend is attributed to name a figure — no
// money figure, and no action sized by one. If they keep that briefing and come
// back, the page states the figure it had refused to state, and an action
// costed against it. Same data, stronger claim, one reload apart.
//
// The cause was a decision that was made beside the analysis and not kept with
// it: `buildFinopsBriefing(result, { attributionWithheld })` is passed the
// page's suppression decision on a live import (evolution-page.js), and
// `briefingFromRetained` called the same builder with the option defaulted to
// false. The retained payload had no attribution facts in it to re-derive it
// from.
//
// Fixed in #997 by the first of the two options this comment left open: the
// withholding decision — and the file presence it was decided against — now
// travel in the payload beside the figures. It is three derived booleans and
// carries no export content, and it is what lets the restore reproduce the
// outcome the import reached rather than recompute one from a partial envelope.
// The todo marker is gone with the defect.

test("a figure the page withheld is not stated as fact after a reload", async () => {
    let page = await openFinopsTab();
    try {
      const { document } = page;
      // One file, and its columns are the supported native shape, so this is a
      // complete import with no mapping step in between.
      chooseFiles(document, [{ name: UNATTRIBUTED.file, text: UNATTRIBUTED.provider }]);
      await waitFor(() => !byId(document, "local-results").hidden
      && shownText(document, "finops-provenance").includes(UNATTRIBUTED.months[0]),
      "the unattributed export to be analyzed and rendered");

      // What the operator is told before they close the tab.
      assert.equal(byId(document, "local-recoverable").dataset.real, "false");
      const withheld = briefingFigures(document);
      assert.match(withheld.metric, /Too little of this spend is attributed/);

      byId(document, "local-lead-retention-toggle").click();
      page = await reopen(page);

      // And what they are told when they come back to it.
      assert.deepEqual(briefingFigures(page.document), withheld,
        "a reload must not publish a figure the analysis withheld");
    } finally {
      page.restore();
    }
  });

// ---------------------------------------------------------------------------
// 4. The context the operator supplied by hand (#1010)
// ---------------------------------------------------------------------------
//
// A billing export cannot say which industry the company is in or how big it
// is; the operator can, and does, in the declaration beside the position. That
// is context of theirs, about this import, and before this change it died with
// the tab while the figures it qualified came back — so a restored brief was a
// brief with the operator's own half missing.
//
// These drive the shipped controls: the real chooser, the real submit, the real
// retention control, and a genuine second boot over the storage the first boot
// left behind.

/** Declare the two attributes this export carries no column for. */
function declareCohort(document) {
  assert.equal(byId(document, "local-cohort-declare").hidden, false,
    "an import with no cohort columns must offer the declaration to fill them");
  byId(document, "local-cohort-band").value = ACCEPTED_ORG_SIZE_BANDS[0];
  byId(document, "local-cohort-industry").value = ACCEPTED_INDUSTRIES[0];
  byId(document, "local-cohort-declare-submit").click();
  assert.equal(byId(document, "local-cohort-declare-message").dataset.state, "accepted",
    "the declaration must be accepted before a test asserts it was kept");
}

/** The record this browser is holding, parsed. */
const heldRecord = (page) => JSON.parse(page.storage.getItem(BRIEFING_RETENTION_KEY));

test("the context an operator supplied comes back with the brief, dated as theirs", async () => {
  let page = await openFinopsTab();
  try {
    await importExport(page.document, SPRING);
    keepBriefing(page);
    declareCohort(page.document);

    // The declaration went into the record of the import it was about — one
    // key, one version, one erase — rather than beside it under a second key.
    const record = heldRecord(page);
    assert.equal(record.version, 1);
    assert.equal(record.context.cohort.orgSizeBand, ACCEPTED_ORG_SIZE_BANDS[0]);
    assert.equal(record.context.cohort.industry, ACCEPTED_INDUSTRIES[0]);
    assert.equal(typeof record.context.editedAt, "string");
    assert.notEqual(record.context.editedAt, record.capturedAt,
      "when the operator typed and when the file was read are two different facts");
    const before = briefingFigures(page.document);

    page = await reopen(page);
    const { document } = page;

    // The brief is back and complete: the same figures, and the operator's own
    // declaration standing behind them rather than an empty chooser.
    assert.equal(byId(document, "local-results").dataset.retained, "true");
    assert.deepEqual(briefingFigures(document), before);
    assert.equal(retainedSuppliedContext(heldRecord(page)).cohort.industry,
      ACCEPTED_INDUSTRIES[0]);

    // And the brief says when the operator last edited it, in a line that
    // cannot be mistaken for the capture time above it.
    const supplied = byId(document, "local-lead-retention-supplied");
    assert.equal(supplied.hidden, false, "a restored brief must date the context supplied for it");
    assert.match(shownText(document, "local-lead-retention-supplied"),
      /^You (last edited the names and facts you supplied yourself|supplied names and facts).* UTC\. /);
    assert.match(shownText(document, "local-lead-retention-supplied"),
      /derived from the file you imported\.$/);
    assert.equal(shownText(document, "local-lead-retention-supplied").includes("Captured"), false);
    assert.match(shownText(document, "local-lead-retention-captured"), /^Captured .* UTC$/);
  } finally {
    page.restore();
  }
});

test("one forget clears the import and every piece of context supplied with it", async () => {
  let page = await openFinopsTab();
  try {
    await importExport(page.document, SPRING);
    keepBriefing(page);
    declareCohort(page.document);
    page = await reopen(page);
    assert.equal(byId(page.document, "local-lead-retention-forget").hidden, false,
      "an operator can only forget a brief the page brought back and showed them");

    byId(page.document, "local-lead-retention-forget").click();

    // ONE ACTION, NO RESIDUE UNDER ANY KEY. Asserted on the store rather than
    // on the screen: a page that painted its sample state over a record it left
    // behind would look identical and restore it on the next load.
    assert.equal(page.storage.getItem(BRIEFING_RETENTION_KEY), null);
    assert.equal(BRIEFING_RETENTION_KEY in page.jar, false);
    assert.equal(ORG_UNIT_LABEL_STORAGE_KEY in page.jar, false,
      "the other key this page can name org units under must be gone too");
    const residue = JSON.stringify(page.jar);
    for (const supplied of [ACCEPTED_ORG_SIZE_BANDS[0], ACCEPTED_INDUSTRIES[0], SPRING.total]) {
      assert.equal(occurrences(residue, supplied), 0,
        `"${supplied}" must not survive a forget anywhere in this browser`);
    }

    page = await reopen(page);
    assert.equal(byId(page.document, "local-results").hidden, true);
    assert.equal(byId(page.document, "local-lead-retention").hidden, true);
    assert.equal(byId(page.document, "local-lead-retention-supplied").hidden, true);
    assert.equal(byId(page.document, "finops-stand").dataset.source, "example");
    assert.equal(page.storage.getItem(BRIEFING_RETENTION_KEY), null);
  } finally {
    page.restore();
  }
});

test("a second import replaces a restored brief without carrying its context across", async () => {
  let page = await openFinopsTab();
  try {
    await importExport(page.document, SPRING);
    keepBriefing(page);
    declareCohort(page.document);
    page = await reopen(page);
    assert.equal(byId(page.document, "local-results").dataset.retained, "true");

    await importExport(page.document, WINTER);

    // The winter import wins the record, and the spring declaration does not
    // ride along inside it: what the operator said about last quarter's file is
    // not a fact about the file they just opened.
    const record = heldRecord(page);
    assert.equal(record.totals.analyzedSpendUsd, WINTER.totalUsd);
    assert.equal(retainedSuppliedContext(record), null,
      "context declared against the previous import must not be kept against this one");
    assert.equal(byId(page.document, "local-lead-retention-supplied").hidden, true,
      "a brief with no supplied context must not show an edit time for one");
    assert.equal(occurrences(JSON.stringify(record), ACCEPTED_INDUSTRIES[0]), 0);
  } finally {
    page.restore();
  }
});

test("a record this page cannot read is discarded and the tab opens pre-import", async () => {
  // Written by a version that is not this one, and carrying a context field
  // shaped in a way this page does not recognize. Both are the same failure and
  // get the same remedy: nothing is rehydrated, and the key does not survive to
  // fail again on the next load.
  const page = await openFinopsTab({
    [BRIEFING_RETENTION_KEY]: JSON.stringify({
      version: 99,
      capturedAt: "2026-08-01T09:00:00.000Z",
      totals: { analyzedSpendUsd: 4242.42 },
      departments: [],
      context: { unitLabels: "not a map", editedAt: 17 },
    }),
  });
  try {
    const { document } = page;
    assert.equal(byId(document, "local-lead-finding").dataset.state, "empty");
    assert.equal(byId(document, "finops-stand").dataset.source, "example");
    assert.equal(byId(document, "local-lead-retention-supplied").hidden, true);
    assert.equal(page.storage.getItem(BRIEFING_RETENTION_KEY), null,
      "an unreadable record must be removed, not left to be re-read on every visit");
    assert.equal(occurrences(textOf(document.documentElement), "4242.42"), 0,
      "nothing from a record that failed validation may be painted");
  } finally {
    page.restore();
  }
});
