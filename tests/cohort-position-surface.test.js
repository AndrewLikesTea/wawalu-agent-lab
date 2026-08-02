// The ranked position, on the surface a FinOps lead actually reads.
//
// This drives the shipped AI FinOps tab — the real markup from
// src/evolution.html, booted by the real page entry (src/evolution-page.js) —
// with the real delimited reader, the real mapping step, and the real cohort
// projection. Nothing between the file selection and the panel is stubbed, so
// what is asserted here is what the reader sees.
//
// The unit-level contract lives in tests/cohort-attribution.test.js. What only
// this file can catch is the boundary between them: a page that resolves the
// declaration differently from the way the projection wrote it shows the
// missing-column instruction for a column the file already carries.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { ACCEPTED_INDUSTRIES, ACCEPTED_ORG_SIZE_BANDS } from "../src/cohort-attribution.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const EXAMPLE_EXPORTS = new URL("../contracts/integrations/tabular-dialects/v1/fixtures/", import.meta.url);
const PROVIDER_EXPORT = await readFile(new URL("openai-usage-export.csv", EXAMPLE_EXPORTS), "utf8");
const ORG_ROSTER = await readFile(new URL("generic-hris-roster.csv", EXAMPLE_EXPORTS), "utf8");

const PROVIDER_FILE = "openai-usage-export.csv";
const ROSTER_FILE = "generic-hris-roster.csv";

/** The shipped export, respelled to join the roster, as the import e2e does. */
const JOINABLE_EXPORT = PROVIDER_EXPORT
  .replace(/atlas-platform/g, "Atlas Platform")
  .replace(/boreal-support/g, "Boreal Support");

/**
 * The same export with the two cohort attributes declared in it.
 *
 * `declareOn` places the values on the first data row, on every data row, or on
 * every row but the first — the three shapes the contract says resolve the
 * same. Nothing else about the file changes: the columns the mapping step reads
 * are untouched, and the two added ones are ignored by it.
 */
function withDeclaration(csv, { orgSizeBand = "focused", industry = "saas", declareOn = "first" } = {}) {
  const lines = csv.split("\n");
  return lines.map((line, index) => {
    if (line.trim() === "") return line;
    if (index === 0) return `${line},org_size_band,industry`;
    const declared = declareOn === "every"
      || (declareOn === "first" && index === 1)
      || (declareOn === "later" && index > 1);
    return declared ? `${line},${orgSizeBand},${industry}` : `${line},,`;
  }).join("\n");
}

async function openFinopsTab() {
  const page = await loadPage(PAGE, {
    storage: {},
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  await waitFor(() => document.getElementById("finops-evaluation-result")
    .getAttribute("aria-busy") === "false", "the evaluation panel to settle");
  return page;
}

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));

function chooseFiles(document, files) {
  const input = byId(document, "local-finops-files");
  input.files = files.map(({ name, text }) => ({
    name, type: "text/csv", text: async () => text,
  }));
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

const reviewOpens = (document, fileName) => waitFor(
  () => !byId(document, "import-mapping").hidden
    && shownText(document, "import-mapping-file") === fileName,
  `the column-mapping step to open on ${fileName}`);

/** Drive the shipped import to a result, with the provider export given. */
async function importExport(document, providerText) {
  chooseFiles(document, [
    { name: PROVIDER_FILE, text: providerText },
    { name: ROSTER_FILE, text: ORG_ROSTER },
  ]);
  await reviewOpens(document, PROVIDER_FILE);
  byId(document, "import-mapping-confirm").click();
  await reviewOpens(document, ROSTER_FILE);
  byId(document, "import-mapping-confirm").click();
  await waitFor(() => !byId(document, "local-results").hidden, "the decision brief to appear");
  await waitFor(() => !byId(document, "local-cohort-position").hidden,
    "the ranked-position panel to be painted");
}

test("a declared export is given its ranked position on the import result screen", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importExport(document, withDeclaration(JOINABLE_EXPORT));

    assert.equal(byId(document, "local-cohort-position").dataset.state, "ranked");
    assert.equal(shownText(document, "local-cohort-state"), "Ranked position available");
    assert.equal(shownText(document, "local-cohort-headline"),
      "This import is compared against organizations with 1–4 attributed org units.");
    assert.match(shownText(document, "local-cohort-detail"),
      /12 organizations in 1–4 attributed org units · declared band focused · declared industry saas · 3 attributed org units counted/);
    assert.equal(byId(document, "local-cohort-next").hidden, true,
      "a published position has no gap for the reader to close");
    // The note is on the answer, not on the markup: what was read to place this
    // organization travels with the placement.
    assert.match(shownText(document, "local-cohort-note"),
      /Names, email addresses, employee or account identifiers, and prompt text are never read/);
    assert.match(shownText(document, "local-cohort-note"),
      /Peer cohorts are published synthetic reference data/);
    // Nothing out of the roster reaches the panel.
    const painted = shownText(document, "local-cohort-detail") + shownText(document, "local-cohort-note");
    for (const identifying of ["Ada Fern", "example.invalid", "Staff Engineer", "emp-1001"]) {
      assert.equal(painted.includes(identifying), false, `${identifying} must not be painted`);
    }
  } finally {
    page.restore();
  }
});

test("an unrecognized declared industry reaches the screen as the value the reader wrote", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importExport(document, withDeclaration(JOINABLE_EXPORT, { industry: "Rocket Surgery" }));

    assert.equal(byId(document, "local-cohort-position").dataset.state, "withheld");
    assert.equal(shownText(document, "local-cohort-state"), "Ranked position withheld");
    assert.equal(shownText(document, "local-cohort-headline"),
      'This import declares an industry of "Rocket Surgery", which is not a value this cohort '
      + "contract publishes.");
    assert.match(shownText(document, "local-cohort-detail"), /Reason code: UNRECOGNIZED_INDUSTRY/);
    // The instruction is to change the value. Telling a reader to add a column
    // their file already carries is the defect this assertion stands against —
    // and so is pointing at the in-page choosers, which are not offered here and
    // would be ignored if they were: a typed-in value is read only where the
    // file left the column empty.
    assert.match(shownText(document, "local-cohort-next"),
      /Change the industry value in the file to one of: saas, financial_services/);
    assert.equal(shownText(document, "local-cohort-next").includes("Add an industry column"), false);
    assert.equal(
      shownText(document, "local-cohort-next").includes("Place this import with these values"),
      false);
  } finally {
    page.restore();
  }
});

test("an unrecognized declared size band reaches the screen the same way", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importExport(document, withDeclaration(JOINABLE_EXPORT, { orgSizeBand: "gigantic" }));

    assert.match(shownText(document, "local-cohort-detail"),
      /Reason code: UNRECOGNIZED_ORG_SIZE_BAND/);
    assert.equal(shownText(document, "local-cohort-headline"),
      'This import declares an organization size band of "gigantic", which is not a value this '
      + "cohort contract publishes.");
    assert.match(shownText(document, "local-cohort-next"),
      /Change the org_size_band value in the file to one of: focused, scaling, enterprise/);
  } finally {
    page.restore();
  }
});

test("a declaration that starts after the first data row still ranks on the screen", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importExport(document, withDeclaration(JOINABLE_EXPORT, { declareOn: "later" }));

    assert.equal(byId(document, "local-cohort-position").dataset.state, "ranked");
    assert.match(shownText(document, "local-cohort-detail"), /declared band focused/);
    assert.equal(shownText(document, "local-cohort-detail").includes("MISSING"), false);
  } finally {
    page.restore();
  }
});

test("an export declaring nothing keeps its findings and says what is missing", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importExport(document, JOINABLE_EXPORT);

    // The rest of the briefing is unaffected: this is the existing import
    // behaviour, with the position withheld and explained beside it.
    assert.equal(byId(document, "local-results").hidden, false);
    assert.equal(byId(document, "local-cohort-position").dataset.state, "withheld");
    assert.match(shownText(document, "local-cohort-detail"),
      /Reason code: MISSING_ORG_SIZE_BAND/);
    // Three distinct jobs on screen: the eyebrow says what is withheld, the
    // headline names the missing input, and the next line names the control that
    // supplies it — by the exact label that control carries in the markup below.
    assert.equal(shownText(document, "local-cohort-state"), "Ranked position withheld");
    assert.match(shownText(document, "local-cohort-headline"),
      /declares no organization size band, and no column in it carries one/);
    const next = shownText(document, "local-cohort-next");
    assert.match(next,
      /choose "Organization size band" and "Industry", then press "Place this import with these values"/);
    assert.match(next, /bands on offer are focused, scaling, enterprise/);
    // The label quoted in the copy is the one the shipped control wears.
    assert.equal(byId(document, "local-cohort-declare-submit").textContent,
      "Place this import with these values");
    assert.equal(byId(document, "local-cohort-declare").hidden, false);
  } finally {
    page.restore();
  }
});

// --- the reader supplies what the file cannot ------------------------------

const DECLARE = "local-cohort-declare";

/** Choose both values in the shipped control and submit it. */
function declare(document, { orgSizeBand = "focused", industry = "saas" } = {}) {
  byId(document, "local-cohort-band").value = orgSizeBand;
  byId(document, "local-cohort-industry").value = industry;
  byId(document, "local-cohort-declare-submit").click();
}

test("an export that declares both attributes is never offered the control", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importExport(document, withDeclaration(JOINABLE_EXPORT));

    // The acceptance criterion in its own right: the control is for a file that
    // cannot supply these two values, and this file supplied both.
    assert.equal(byId(document, DECLARE).hidden, true,
      "a cohort-complete import must not be asked to declare what it already declared");
    assert.equal(byId(document, "local-cohort-band").options.length, 0,
      "the chooser is not even built on an import that supplies its own attributes");
    // …and the position it did earn is labelled as the file's own.
    assert.match(shownText(document, "local-cohort-detail"), /position source: file-derived/);
  } finally {
    page.restore();
  }
});

test("an export that declares neither is offered the published values, and only those", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importExport(document, JOINABLE_EXPORT);

    assert.equal(byId(document, DECLARE).hidden, false);
    // The options are the contract's enumeration, not a list retyped in a view.
    assert.deepEqual(byId(document, "local-cohort-band").options.map((option) => option.value),
      [...ACCEPTED_ORG_SIZE_BANDS]);
    assert.deepEqual(byId(document, "local-cohort-industry").options.map((option) => option.value),
      [...ACCEPTED_INDUSTRIES]);
    assert.equal(byId(document, "local-cohort-declare-message").hidden, true,
      "nothing has been submitted, so there is nothing to say about it");
  } finally {
    page.restore();
  }
});

test("declaring the two attributes places the import already open, and labels it", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importExport(document, JOINABLE_EXPORT);
    assert.equal(byId(document, "local-cohort-position").dataset.state, "withheld");

    declare(document, { orgSizeBand: "focused", industry: "saas" });

    assert.equal(byId(document, "local-cohort-position").dataset.state, "ranked");
    assert.equal(shownText(document, "local-cohort-headline"),
      "This import is compared against organizations with 1–4 attributed org units.");
    // The three attributed org units are the ones counted from the export that
    // was already in this tab: no file was re-read to recompute this.
    assert.match(shownText(document, "local-cohort-detail"),
      /3 attributed org units counted from this export/);
    // And the placement says whose statement it rests on, at this surface.
    assert.match(shownText(document, "local-cohort-detail"),
      /position source: reader-declared/);
    assert.equal(shownText(document, "local-cohort-detail").includes("file-derived"), false,
      "a reader-declared position must never be presented as file-derived");
    assert.match(shownText(document, "local-cohort-note"),
      /declared by the reader in this tab rather than read from a column/);
    // The control has done its work and is off the page.
    assert.equal(byId(document, DECLARE).hidden, true);
  } finally {
    page.restore();
  }
});

test("forgetting the briefing takes the declared attributes with it", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importExport(document, JOINABLE_EXPORT);
    declare(document);
    assert.equal(byId(document, "local-cohort-position").dataset.state, "ranked");

    // The existing control, driven the way a reader drives it: opt in so the
    // one-action forget is offered, then take it.
    byId(document, "local-lead-retention-toggle").click();
    const forget = byId(document, "local-lead-retention-forget");
    assert.equal(forget.hidden, false, "forget is offered once something is kept");
    forget.click();
    await waitFor(() => byId(document, "local-cohort-position").hidden,
      "the ranked position to go with the forgotten briefing");

    // Nothing declared survived it. The same export, imported again, is back to
    // a withheld position and is asked for the two values afresh — which it
    // could not be if the declaration were still standing anywhere.
    await importExport(document, JOINABLE_EXPORT);
    assert.equal(byId(document, "local-cohort-position").dataset.state, "withheld");
    assert.match(shownText(document, "local-cohort-detail"),
      /Reason code: MISSING_ORG_SIZE_BAND/);
    assert.equal(shownText(document, "local-cohort-detail").includes("reader-declared"), false);
    assert.equal(byId(document, DECLARE).hidden, false);
  } finally {
    page.restore();
  }
});

test("clearing the import takes the ranked position with it", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importExport(document, withDeclaration(JOINABLE_EXPORT));
    byId(document, "clear-local-analysis").click();
    await waitFor(() => byId(document, "local-cohort-position").hidden,
      "the ranked position to be handed back with the import");
    assert.equal(byId(document, "local-cohort-position").dataset.state, "empty");
    assert.equal(shownText(document, "local-cohort-headline"), "—");
  } finally {
    page.restore();
  }
});
