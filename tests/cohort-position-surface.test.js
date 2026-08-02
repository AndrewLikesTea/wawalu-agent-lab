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
import {
  ACCEPTED_INDUSTRIES, ACCEPTED_ORG_SIZE_BANDS,
} from "../src/cohort-attribution.js";
import { ANSWER_ANNOUNCER_ID } from "../src/finops-answer-announcement.js";

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
    // their file already carries is the defect this assertion stands against.
    assert.match(shownText(document, "local-cohort-next"),
      /Change the declared industry value to one of: saas, financial_services/);
    assert.equal(shownText(document, "local-cohort-next").includes("Add an industry column"), false);
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
      /Change the declared org_size_band value to one of: focused, scaling, enterprise/);
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
    assert.match(shownText(document, "local-cohort-next"),
      /Add an org_size_band column declaring one of: focused, scaling, enterprise/);
  } finally {
    page.restore();
  }
});

// --- the reader's own declaration, on the shipped page (#978) --------------

const OPTION_VALUES = (document, id) =>
  byId(document, id).querySelectorAll("option").map((node) => node.value);

/** The shipped export with exactly one of the two cohort columns on it. */
const withOneDeclaration = (csv, column, value) => csv.split("\n").map((line, index) => {
  if (line.trim() === "") return line;
  return index === 0 ? `${line},${column}` : `${line},${index === 1 ? value : ""}`;
}).join("\n");

/** Set both selects and submit, as a reader with a mouse and a keyboard does. */
function declareCohort(document, { orgSizeBand = "", industry = "" } = {}) {
  byId(document, "local-cohort-declare-band").value = orgSizeBand;
  byId(document, "local-cohort-declare-industry").value = industry;
  byId(document, "local-cohort-declare-submit").click();
}

test("the declaration control offers exactly the accepted enumeration", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importExport(document, JOINABLE_EXPORT);
    assert.equal(byId(document, "local-cohort-declare").hidden, false);
    // The placeholder is the ABSENCE of a declaration, so it is dropped before
    // the comparison; every other option is a published key and nothing else.
    // This is asserted separately from the refusal because the test harness's
    // select accepts any value — only the rendered list proves what is offered.
    assert.deepEqual(OPTION_VALUES(document, "local-cohort-declare-band").filter(Boolean),
      [...ACCEPTED_ORG_SIZE_BANDS]);
    assert.deepEqual(OPTION_VALUES(document, "local-cohort-declare-industry").filter(Boolean),
      [...ACCEPTED_INDUSTRIES]);
    assert.equal(byId(document, "local-cohort-declare-band-field").hidden, false);
    assert.equal(byId(document, "local-cohort-declare-industry-field").hidden, false);
  } finally {
    page.restore();
  }
});

test("an export declaring both attributes is offered no declaration control", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importExport(document, withDeclaration(JOINABLE_EXPORT));
    assert.equal(byId(document, "local-cohort-position").dataset.state, "ranked");
    assert.equal(byId(document, "local-cohort-declare").hidden, true,
      "a file that supplies both attributes has nothing for a reader to declare");
    // …and the placement is labelled as what it is.
    assert.equal(byId(document, "local-cohort-position").dataset.provenance, "file");
    assert.match(shownText(document, "local-cohort-detail"), /file-derived cohort/);
    assert.equal(shownText(document, "local-cohort-state"), "Ranked position available");
  } finally {
    page.restore();
  }
});

test("only the attribute the file cannot supply is offered", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    // The export declares its industry and nothing else, so the industry field
    // is folded away and the band field is the one thing asked for.
    await importExport(document, withOneDeclaration(JOINABLE_EXPORT, "industry", "saas"));
    assert.equal(byId(document, "local-cohort-declare").hidden, false);
    assert.equal(byId(document, "local-cohort-declare-band-field").hidden, false);
    assert.equal(byId(document, "local-cohort-declare-industry-field").hidden, true);
  } finally {
    page.restore();
  }
});

test("declaring the missing cohort recomputes the position from the imported session", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importExport(document, JOINABLE_EXPORT);
    assert.equal(byId(document, "local-cohort-position").dataset.state, "withheld");

    // No re-import, no second file read: the same three org units already in
    // this tab are what the recomputed position is selected from.
    declareCohort(document, { orgSizeBand: "focused", industry: "saas" });

    assert.equal(byId(document, "local-cohort-position").dataset.state, "ranked");
    assert.equal(byId(document, "local-cohort-position").dataset.provenance, "reader_declared");
    assert.match(shownText(document, "local-cohort-detail"), /3 attributed org units counted/);
    // Labelled reader-declared in the eyebrow, in the detail sentence, and in
    // the panel's own status region — never presented as file-derived.
    assert.equal(shownText(document, "local-cohort-state"),
      "Ranked position available · reader-declared cohort");
    assert.match(shownText(document, "local-cohort-detail"), /reader-declared cohort/);
    // The one phrase the panel must never apply to this placement. The
    // statement beside it does contain the words "file-derived" — it says the
    // position is reader-declared RATHER THAN file-derived — so the assertion
    // is on the label the panel would carry if it claimed the wrong source.
    assert.equal(shownText(document, "local-cohort-detail").includes("· file-derived cohort"),
      false);
    const status = byId(document, "local-cohort-declare-status");
    assert.equal(status.hidden, false);
    assert.equal(status.getAttribute("aria-live"), "polite");
    assert.match(textOf(status), /declared by you on this page/);
    // And the headline above says the same thing about the same placement.
    assert.match(shownText(document, "finops-stand-position-basis"), /reader-declared cohort/);
    assert.match(textOf(byId(document, ANSWER_ANNOUNCER_ID)), /declared by you on this page/);
  } finally {
    page.restore();
  }
});

test("a declared value the model refuses is answered with the accepted options", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importExport(document, JOINABLE_EXPORT);
    // The harness's select accepts a value the real control would never offer,
    // which is exactly the bypass the model-layer refusal exists for.
    declareCohort(document, { orgSizeBand: "gigantic", industry: "saas" });

    assert.equal(byId(document, "local-cohort-position").dataset.state, "withheld");
    assert.equal(byId(document, "local-cohort-position").dataset.provenance, "none");
    assert.match(textOf(byId(document, "local-cohort-declare-status")),
      /"gigantic" is not an accepted organization size band\. The accepted values are: focused, scaling, enterprise\./);
    assert.match(shownText(document, "local-cohort-detail"),
      /Reason code: UNACCEPTED_DECLARED_VALUE/);
  } finally {
    page.restore();
  }
});

test("declaring one of the two attributes publishes no position", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importExport(document, JOINABLE_EXPORT);
    declareCohort(document, { industry: "saas" });

    assert.equal(byId(document, "local-cohort-position").dataset.state, "withheld");
    assert.match(shownText(document, "local-cohort-detail"), /Reason code: MISSING_ORG_SIZE_BAND/);
  } finally {
    page.restore();
  }
});

test("the forget control takes the declared cohort with the briefing", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importExport(document, JOINABLE_EXPORT);
    declareCohort(document, { orgSizeBand: "focused", industry: "saas" });
    assert.equal(byId(document, "local-cohort-position").dataset.state, "ranked");

    // Opt in, then use the one control that means "forget this". It runs the
    // same reset the clear control does, and the declared values live in that
    // session state, so there is nothing left for the next import to inherit.
    const toggle = byId(document, "local-lead-retention-toggle");
    toggle.checked = true;
    toggle.dispatchEvent(new DomEvent("change", { bubbles: true }));
    await waitFor(() => byId(document, "local-lead-retention-forget").hidden === false,
      "the forget control to be offered for a kept briefing");
    byId(document, "local-lead-retention-forget").click();
    await waitFor(() => byId(document, "local-cohort-position").hidden,
      "the ranked position to be handed back with the briefing");

    // Re-import the same undeclared export: it must be withheld again, which it
    // cannot be if the declaration survived the forget.
    await importExport(document, JOINABLE_EXPORT);
    assert.equal(byId(document, "local-cohort-position").dataset.state, "withheld");
    assert.match(shownText(document, "local-cohort-detail"), /Reason code: MISSING_ORG_SIZE_BAND/);
    assert.equal(byId(document, "local-cohort-declare-status").hidden, true);
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
