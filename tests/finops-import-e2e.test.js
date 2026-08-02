// End-to-end regression for the leader's import-to-decision path.
//
// Every test here drives the shipped AI FinOps tab — the real markup from
// src/evolution.html, booted by the real page entry (src/evolution-page.js) —
// and asserts only on what a leader can see: the mapping step's own summary and
// blockers, the trust verdict's coverage line, the decision brief's numbers, and
// the file the export button hands back. Nothing between the file selection and
// the saved decision record is stubbed: the real delimited reader, the real
// dialect detection, the real column mapping, the real join, the real coverage
// metric, and the real export all run.
//
// The one thing the harness supplies is the browser's own File API — a headless
// DOM cannot open an OS file picker — so a selection is the `{ name, type,
// text() }` shape the page reads, carrying the bytes of a checked-in export.
//
// Determinism: no network beyond the two bundled fixtures the page fetches, no
// clock thresholds, no sleeps. Every wait is on state the page itself produces.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, pressEnter, pressKey, pressTab, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { BRIEFING_FILE_VERSION } from "../src/finops-briefing-export.js";
import { conversationExampleText } from "../src/conversation-export-example.js";
import {
  FINOPS_WORKSPACE_KEY, FINOPS_WORKSPACE_VERSION,
} from "../src/finops-workspace-contract.js";
import {
  JOURNEY_SNAPSHOT_KEY, JOURNEY_SNAPSHOT_VERSION, validateJourneySnapshot,
} from "../src/finops-journey-snapshot.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

// The two fixtures the page fetches for the surfaces above the import panel.
// They are the bundled demo seed, not this suite's subject; serving them keeps
// the page in the state a visitor actually meets the import panel in.
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

// The subject: the example provider export and org roster shipped with the
// dialect contracts. These are the files a leader is meant to be handed as a
// worked example, and this suite imports their bytes unmodified.
const EXAMPLE_EXPORTS = new URL("../contracts/integrations/tabular-dialects/v1/fixtures/", import.meta.url);
const PROVIDER_EXPORT = await readFile(new URL("openai-usage-export.csv", EXAMPLE_EXPORTS), "utf8");
const ORG_ROSTER = await readFile(new URL("generic-hris-roster.csv", EXAMPLE_EXPORTS), "utf8");
const NATIVE_EXPORTS = new URL("../contracts/integrations/native-provider-exports/v1/fixtures/", import.meta.url);
const NATIVE_OPENAI = await readFile(new URL("openai-supported.csv", NATIVE_EXPORTS), "utf8");
const INCOMPLETE_ANTHROPIC = await readFile(
  new URL("anthropic-missing-required.csv", NATIVE_EXPORTS), "utf8");

// ---------------------------------------------------------------------------
// What the fixture is worth, derived from its own bytes.
// ---------------------------------------------------------------------------
//
// openai-usage-export.csv holds three cost rows, one per project:
//
//   atlas-platform    412.75
//   boreal-support     31.40
//   cinder-research   102.05
//                    -------
//   total             546.20
//
// generic-hris-roster.csv holds one row per person, whose `department` column is
// the org unit the money has to land on: "Atlas Platform", "Boreal Support",
// "Cinder Research".
//
// Coverage is defined in src/finops-trust-verdict.js: attributed spend over
// total spend, dollar-weighted, where a row is attributed when its org unit
// resolves to exactly one confirmed roster entry. The join key is the label
// trimmed, lower-cased, and whitespace-collapsed (`unitKey` in
// src/finops-tabular-import.js) — punctuation is not normalized, so
// `atlas-platform` and `atlas platform` are two different org units.
//
// Hence the two expectations below, and the reason this suite carries two
// happy-path fixtures rather than one.
const TOTAL_SPEND = "546.20 USD";

// (1) The example export and the example roster exactly as shipped: nothing
// joins, so no dollar of the 546.20 is attributed.
const AS_SHIPPED = Object.freeze({
  coverage: "0.0%",
  inputs: `0.00 USD attributed of ${TOTAL_SPEND} total · 0 of 3 rows`,
});

// (2) The same shipped export with one edit — the two project labels spelled the
// way the roster spells them — which is what a leader whose own export happens
// to agree with their own roster would upload. Then Atlas (412.75) and Boreal
// (31.40) attribute and Cinder (102.05) does not:
//   attributed  412.75 + 31.40 = 444.15
//   coverage    444.15 / 546.20 = 81.3164…% → 81.3% at one decimal place
const JOINABLE = Object.freeze({
  coverage: "81.3%",
  inputs: `444.15 USD attributed of ${TOTAL_SPEND} total · 2 of 3 rows`,
  attributedSpendUsd: 444.15,
  topDepartment: "Atlas Platform",
});

/** The shipped export with two project labels respelled to match the roster. */
const JOINABLE_EXPORT = PROVIDER_EXPORT
  .replace(/atlas-platform/g, "Atlas Platform")
  .replace(/boreal-support/g, "Boreal Support");

/** The shipped export with its required cost column removed, header and all. */
const NO_AMOUNT_EXPORT = PROVIDER_EXPORT.split("\n")
  .map((line) => (line.trim() === "" ? line : dropColumn(line, 5)))
  .join("\n");

function dropColumn(line, index) {
  const cells = line.split(",");
  cells.splice(index, 1);
  return cells.join(",");
}

const PROVIDER_FILE = "openai-usage-export.csv";
const ROSTER_FILE = "generic-hris-roster.csv";

/** Load the tab and boot its real entry module, exactly as the page tag does. */
async function openFinopsTab(storage = {}) {
  const page = await loadPage(PAGE, {
    storage,
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  // The page is "open" once every one of its own asynchronous surfaces has
  // settled — not after a delay. Leaving one in flight would let it run on into
  // the next test, which is how a suite gets its first flaky failure.
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  await waitFor(() => textOf(document.getElementById("integration-contract-provenance"))
    .startsWith("Gateway completed"), "the static contract gateway to settle");
  await waitFor(() => document.getElementById("finops-evaluation-result")
    .getAttribute("aria-busy") === "false", "the evaluation panel to settle");
  return page;
}

const consentSeed = (state) => ({
  [FINOPS_WORKSPACE_KEY]: JSON.stringify({
    schemaVersion: FINOPS_WORKSPACE_VERSION,
    consent: {
      state,
      decidedAt: "2026-07-28T09:00:00.000Z",
      grantedAgainst: state === "granted" ? FINOPS_WORKSPACE_VERSION : null,
    },
    periods: [],
    commitments: [],
    meta: { lastWriteAt: "2026-07-28T09:00:00.000Z" },
  }),
});

/**
 * Hand the file input a selection. This is the browser's File API and nothing
 * else: name, media type, and a text() promise over the real bytes.
 */
function chooseFiles(document, files) {
  const input = document.getElementById("local-finops-files");
  input.files = files.map(({ name, text }) => ({
    name, type: "text/csv", text: async () => text,
  }));
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));

/** Wait for the mapping step to be open on a named file. */
function reviewOpens(document, fileName) {
  return waitFor(() => !byId(document, "import-mapping").hidden
    && shownText(document, "import-mapping-file") === fileName,
  `the column-mapping step to open on ${fileName}`);
}

/** Tab from wherever focus is until a control is reached; no mouse involved. */
function tabTo(document, id) {
  const stops = tabSequence(document).length;
  for (let step = 0; step <= stops; step += 1) {
    const focused = pressTab(document);
    if (focused?.id === id) return focused;
  }
  assert.fail(`"${id}" is not reachable by Tab from ${document.activeElement?.id || "the current focus"}; `
    + `a keyboard user cannot complete this step. Tab stops: ${stops}.`);
}

test("a supported native provider export bypasses mapping and opens its analysis", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    chooseFiles(document, [{ name: "openai-native.csv", text: NATIVE_OPENAI }]);
    await waitFor(() => !byId(document, "local-results").hidden,
      "the native provider analysis to render");
    assert.equal(byId(document, "import-mapping").hidden, true,
      "a supported native adapter must bypass #import-mapping");
    assert.equal(byId(document, "local-export-activation").dataset.state, "ready");
    assert.match(shownText(document, "local-export-activation-status"),
      /OpenAI organization usage export.*adapter v1.*header confidence/i);
    assert.equal(byId(document, "local-export-activation").dataset.confidence, "0.875");
    assert.equal(document.activeElement?.id, "finops-stand",
      "focus should move to the existing analysis answer");
  } finally {
    page.restore();
  }
});

test("an incomplete native export is announced and never enters mapping or analysis", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    chooseFiles(document, [{ name: "anthropic-incomplete.csv", text: INCOMPLETE_ANTHROPIC }]);
    await waitFor(() => byId(document, "local-export-activation").dataset.state === "error",
      "the incomplete native status to render");
    assert.equal(byId(document, "import-mapping").hidden, true);
    assert.equal(byId(document, "local-results").hidden, true);
    assert.match(shownText(document, "local-export-activation-status"),
      /looks incomplete.*missing required column.*cost_usd/i);
    assert.equal(byId(document, "local-finops-files").getAttribute("aria-invalid"), "true");
    // The rejection has to survive the end of the selection. The two announcement
    // regions clear each other, so a refusal that let the queue run on to
    // "1 compatible file ready" would erase the only thing a screen reader was
    // told about this file, and take the focus off the picker with it.
    assert.match(shownText(document, "local-import-alert"), /incomplete/i);
    assert.doesNotMatch(shownText(document, "local-import-state"), /compatible file/i);
    assert.equal(document.activeElement?.id, "local-finops-files");
  } finally {
    page.restore();
  }
});

test("one bad required row rejects the whole native export and preserves the bundled answer", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  const mixed = [
    "usage_date,model,project,n_context_tokens_total,amount,currency",
    "2026-07-01,gpt-demo,synthetic-platform,1200,1.25,USD",
    "03/04/2026,gpt-demo,synthetic-platform,900,0.75,USD",
  ].join("\n");
  try {
    chooseFiles(document, [{ name: "mixed-native.csv", text: mixed }]);
    await waitFor(() => byId(document, "local-export-activation").dataset.state === "error",
      "the required-field rejection to render");
    assert.equal(byId(document, "local-results").hidden, true);
    assert.equal(byId(document, "local-finops-files").getAttribute("aria-invalid"), "true");
    assert.match(shownText(document, "local-file-error"),
      /invalid required field.*row 3.*usage_date.*dates printed as YYYY-MM-DD/i);
    assert.match(shownText(document, "finops-stand"), /Bundled synthetic example[\s\S]*\$51,254/,
      "a partial native subtotal must not replace the bundled analysis");
  } finally {
    page.restore();
  }
});

test("an unsupported local export format reports recovery without opening mapping", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    chooseFiles(document, [{ name: "provider-export.zip", text: "not an archive reader" }]);
    await waitFor(() => byId(document, "local-export-activation").dataset.state === "error",
      "the unsupported-format status to render");
    assert.equal(byId(document, "import-mapping").hidden, true);
    assert.equal(byId(document, "local-results").hidden, true);
    assert.match(shownText(document, "local-file-error"),
      /ZIP archive.*open the archive.*choose the CSV/i);
    assert.equal(byId(document, "local-finops-files").getAttribute("aria-invalid"), "true");
  } finally {
    page.restore();
  }
});

test("a leader imports the example provider export and reaches a decision they can export", async (t) => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await t.test("step 1 · the idle panel asks for the one file it needs", () => {
      assert.match(shownText(document, "import-stages"), /Step 1Choose filesnow/);
      // One required input, two optional precision upgrades. Each row says
      // whether it is required in a word, and each optional row says what it
      // buys. Neither optional row is offered as something to add, because the
      // export groups itself and the analysis runs without them.
      const requirements = shownText(document, "mapping-requirements");
      assert.match(requirements,
        /^○RequiredProvider period exportnot selectedAdd it/);
      assert.match(requirements, /\+OptionalDepartment names \(optional\)/);
      assert.match(requirements,
        /optional — sharpens attribution; your export's own grouping is used/);
      assert.match(requirements, /\+OptionalQuery sample/);
      assert.equal(byId(document, "local-results").hidden, true,
        "no result may be on screen before a file is selected");
    });

    await t.test("step 2 · the provider export is recognized and every column is shown", async () => {
      chooseFiles(document, [
        { name: PROVIDER_FILE, text: JOINABLE_EXPORT },
        { name: ROSTER_FILE, text: ORG_ROSTER },
      ]);
      await reviewOpens(document, PROVIDER_FILE);
      // A delimited file reaches the mapping step, not a projection, so this
      // read ends with no verdict to paint. The activation must hand its
      // primary action back rather than leave it disabled under "reading…" —
      // there is no other control here that reopens the picker.
      assert.equal(byId(document, "activate-local-export").disabled, false,
        "the export chooser is stranded disabled while the mapping step is open");
      assert.equal(byId(document, "local-export-activation").dataset.state, "idle");
      assert.match(shownText(document, "import-mapping-summary"),
        /Recognized as OpenAI usage export/);
      assert.equal(shownText(document, "import-mapping-caption"),
        "7 columns in file order, with one real value from your own data. 3 data rows were read.");
      assert.equal(byId(document, "import-mapping-rows").children.length, 7,
        "every column of the leader's own file must be listed, not only the mapped ones");
      assert.equal(shownText(document, "import-mapping-status"),
        "6 of 7 columns are mapped. Ready to run the analysis.");
      assert.equal(byId(document, "import-mapping-blockers").hidden, true,
        "a recognized export must not be blocked");
      assert.equal(byId(document, "import-mapping-confirm").disabled, false);
    });

    await t.test("step 2 · the correction preview shows what one column became, with a real value", () => {
      const row = byId(document, "import-mapping-rows").children
        .find((entry) => textOf(entry).includes("project"));
      assert.ok(row, "the provider export's org-unit column must appear in the preview");
      assert.equal(row.querySelector("select").value, "orgUnit",
        "the project column must be proposed as the org unit the money lands on");
      assert.match(textOf(row), /Auto-detected/);
      assert.match(textOf(row), /Atlas Platform/,
        "the preview must show one real value out of the leader's own file");
    });

    await t.test("step 3 · confirming both mappings produces the coverage metric", async () => {
      byId(document, "import-mapping-confirm").click();
      await reviewOpens(document, ROSTER_FILE);
      assert.match(shownText(document, "import-mapping-summary"), /Recognized as Org roster/);
      byId(document, "import-mapping-confirm").click();
      await waitFor(() => !byId(document, "local-results").hidden, "the decision brief to appear");

      assert.equal(shownText(document, "local-trust-coverage"), JOINABLE.coverage,
        "the coverage headline must equal the fixture's attributed share of its own spend");
      assert.equal(shownText(document, "local-trust-inputs"), JOINABLE.inputs,
        "attributed spend, total spend, and both row counts must ship with the percentage");
      assert.match(shownText(document, "local-trust-answer"), /^81\.3% of 546\.20 USD is attributed/);
      assert.equal(byId(document, "local-trust-coverage").dataset.available, "true");
    });

    await t.test("step 3 · the decision brief names the department the money is on", () => {
      // Pinned as it ships, and it is a finding rather than a target: a leader
      // whose roster says "Atlas Platform" is shown "Department …8e16aa",
      // because the delimited translator hashes the label into an opaque unit id
      // and no readable name survives the import. The number is right; the row
      // it is on is unreadable. Change this expectation only with the fix.
      assert.match(shownText(document, "local-department"), /^Department …[0-9a-f]{6}$/);
      assert.equal(shownText(document, "local-metric-label"), "Local import",
        "the leader's own number must not still be captioned as example data");
      assert.equal(byId(document, "local-recoverable").dataset.real, "true");
      assert.match(shownText(document, "dataset-provenance-results"),
        /Your data — openai-usage-export\.csv, generic-hris-roster\.csv/);
      assert.match(shownText(document, "import-stages"), /Step 3Read the resultnow/);
    });

    await t.test("step 3 · the benchmark, the evidence and the figure all come from this import", () => {
      // One imported-analysis state feeds four linked disclosures. The benchmark
      // card used to be two constants written over whatever the analysis said;
      // now it carries the analysis's own verdict, and the card says which
      // source it is speaking for.
      const benchmark = byId(document, "local-benchmark-state");
      assert.equal(benchmark.dataset.source, "import",
        "the benchmark card must declare that it is speaking for the leader's own import");
      assert.equal(benchmark.dataset.state, "unavailable",
        "this import carries no query sample, so no cohort may be claimed for it");
      assert.equal(shownText(document, "local-benchmark-why"),
        "Unavailable: the imported contracts contain no compatible peer cohort or benchmark methodology.",
        "the sentence under the card is the analysis's own reason, not a constant");

      // The evidence list is the same analysis's, and it is not the bundled
      // sample's: it counts the rows this import actually joined.
      const evidence = textOf(byId(document, "local-evidence"));
      assert.match(evidence, /deduplicated provider aggregate/);
      assert.match(evidence, /USD is the disclosed routing scenario/);

      // The figure, the department beside it, and the action it sizes are one
      // decision, so the action names the amount the figure shows.
      const impact = shownText(document, "local-recoverable");
      assert.match(impact, /^\d+\.\d{2} USD$/,
        "the quantified impact must be this import's own figure, painted once");
      assert.match(shownText(document, "local-action"), /Pilot lower-cost routing/);
    });

    await t.test("step 3b · the leader can check the math on the figure they were just shown", () => {
      // The region is painted from the same payload the export button writes, so
      // this is the on-screen half of the assertion step 4 makes about the file.
      const region = byId(document, "local-lead-derivation");
      assert.equal(byId(document, "local-lead-derivation-detail").hidden, false,
        "the disclosure must be available once there is a briefing to check");
      assert.equal(region.hidden, false);
      assert.equal(region.dataset.verdict, "reproduced",
        "a briefing this build just computed must re-derive against this build's own rubric");
      const text = textOf(region);
      assert.match(text, /Reproduced\./);
      assert.match(text, /Recoverable spend, re-added from the ranked departments/);
      assert.match(text, /Confidence grade the coverage ratio earns/);
      // Screen-reader legible: the outcome of each step is in words, and the
      // rubric that produced the figure is named on the page rather than only in
      // the file.
      assert.match(text, /matches the briefing/);
      assert.match(text, /Routing rubric down-routing-candidate\/1\.0\.0/);
    });

    await t.test("step 4 · the decision record the leader exports carries the same numbers", () => {
      byId(document, "export-local-json").click();
      assert.equal(page.downloads.length, 1, "the export button must hand back exactly one file");
      const [download] = page.downloads;
      assert.equal(download.filename, "local-finops-briefing.json");
      const record = JSON.parse(download.text);
      assert.equal(record.dataset, "user");
      // The briefing the page showed travels in the file, not just the envelope
      // it was selected from.
      assert.equal(record.briefingFileVersion, BRIEFING_FILE_VERSION);
      assert.equal(record.figures.recoverableSpend.value, record.results.recoverableUsd);
      assert.equal(record.results.spendUsd, JOINABLE.attributedSpendUsd,
        "the saved record's spend must equal the attributed spend the page showed");
      assert.match(record.results.topDepartment.name, /^Department …[0-9a-f]{6}$/);
      assert.equal(record.results.period, "2026-06-05 to 2026-06-07");
    });
  } finally {
    page.restore();
  }
});

test("the same path completes on the keyboard alone, all the way to the saved record", async (t) => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    // The file picker itself is the operating system's, not the page's; from the
    // moment the selection lands, nothing below calls click().
    chooseFiles(document, [
      { name: PROVIDER_FILE, text: JOINABLE_EXPORT },
      { name: ROSTER_FILE, text: ORG_ROSTER },
    ]);

    await t.test("the mapping step announces itself and hands focus to its heading", async () => {
      await reviewOpens(document, PROVIDER_FILE);
      assert.equal(document.activeElement?.id, "import-mapping-title",
        "entering the step must move focus into it, not leave it on the file input behind");
      assert.equal(shownText(document, "local-import-state"),
        "Check the column mapping.Every column in the selected file is listed with what it becomes "
        + "and one value from it. Nothing is computed until you confirm.");
    });

    await t.test("both mappings are confirmed with Tab and Enter", async () => {
      tabTo(document, "import-mapping-confirm");
      pressEnter(document);
      await reviewOpens(document, ROSTER_FILE);
      tabTo(document, "import-mapping-confirm");
      pressEnter(document);
      await waitFor(() => !byId(document, "local-results").hidden,
        "the decision brief to appear after a keyboard confirmation");
    });

    await t.test("the keyboard traversal produced the same coverage metric", () => {
      assert.equal(shownText(document, "local-trust-coverage"), JOINABLE.coverage);
      assert.equal(shownText(document, "local-trust-inputs"), JOINABLE.inputs);
      // …and the keyboard lands on the ANSWER, which is what the import
      // changed, rather than most of a page below it on the brief that supports
      // it. #744: the reader who imported an export to change the answer used to
      // be moved past the answer and had to shift-tab back up to read it.
      assert.equal(document.activeElement?.id, "finops-stand",
        "the answer must take focus so a keyboard user is told what changed");
    });

    await t.test("the decision record is saved from the keyboard too", () => {
      tabTo(document, "export-local-json");
      pressEnter(document);
      assert.equal(page.downloads.length, 1,
        "Enter on the export control must produce the decision record");
      assert.equal(JSON.parse(page.downloads[0].text).results.spendUsd, JOINABLE.attributedSpendUsd);
    });
  } finally {
    page.restore();
  }
});

test("the example export and the example roster, exactly as shipped, attribute nothing", async (t) => {
  // A defect regression, not a happy path. The two files a leader is handed as a
  // worked example use different spellings for the same org unit, so the import
  // succeeds and the decision brief arrives empty. If the fixtures or the join
  // are ever fixed, this test fails and is the record of what changed.
  const page = await openFinopsTab();
  const { document } = page;
  try {
    chooseFiles(document, [
      { name: PROVIDER_FILE, text: PROVIDER_EXPORT },
      { name: ROSTER_FILE, text: ORG_ROSTER },
    ]);

    await t.test("both files are recognized and neither is blocked", async () => {
      await reviewOpens(document, PROVIDER_FILE);
      assert.equal(byId(document, "import-mapping-confirm").disabled, false);
      byId(document, "import-mapping-confirm").click();
      await reviewOpens(document, ROSTER_FILE);
      assert.equal(byId(document, "import-mapping-confirm").disabled, false);
      byId(document, "import-mapping-confirm").click();
      await waitFor(() => !byId(document, "local-results").hidden, "the decision brief to appear");
    });

    await t.test("every dollar in the example export is unattributed", () => {
      assert.equal(shownText(document, "local-trust-coverage"), AS_SHIPPED.coverage);
      assert.equal(shownText(document, "local-trust-inputs"), AS_SHIPPED.inputs);
      assert.match(shownText(document, "local-trust-findings"), /Unresolved rows/,
        "the unattributed spend must be reported as a ranked finding, not left silent");
    });

    await t.test("the brief says plainly that there is no finding to act on", () => {
      assert.equal(byId(document, "local-result-notice").hidden, false);
      assert.equal(shownText(document, "local-result-notice"),
        "No department finding available. No provider aggregate joined an active HRIS unit. "
        + "Resolve the mapping gaps before choosing an action.");
      assert.equal(shownText(document, "local-metric-label"), "No rows matched");
      assert.equal(byId(document, "local-recoverable").dataset.real, "false",
        "a zero built on nothing must not be presented as a real number");
    });
  } finally {
    page.restore();
  }
});

test("a malformed export cannot be pushed past the mapping guard", async (t) => {
  // Derived from the shipped example by deleting its required cost column — the
  // export a leader produces when they trim a spreadsheet before uploading it.
  const page = await openFinopsTab();
  const { document } = page;
  try {
    chooseFiles(document, [
      { name: PROVIDER_FILE, text: NO_AMOUNT_EXPORT },
      { name: ROSTER_FILE, text: ORG_ROSTER },
    ]);

    await t.test("the step names the missing column as a blocker", async () => {
      await reviewOpens(document, PROVIDER_FILE);
      const blockers = byId(document, "import-mapping-blockers");
      assert.equal(blockers.hidden, false, "a missing required column must raise a visible blocker");
      assert.match(textOf(blockers), /Resolve before the analysis can run/);
      assert.match(textOf(blockers), /Cost/i);
      assert.equal(byId(document, "import-mapping-warnings").dataset.count !== undefined, true);
    });

    await t.test("the confirm control is disabled and Enter on it computes nothing", async () => {
      const confirm = byId(document, "import-mapping-confirm");
      assert.equal(confirm.disabled, true, "the guard is the disabled confirm control");
      confirm.focus();
      pressEnter(document);
      confirm.click();
      // Nothing to wait on but the absence of a transition, so the assertion is
      // made against the state the guard is required to hold: still in the step.
      assert.equal(byId(document, "import-mapping").hidden, false,
        "a blocked mapping must keep the leader in the step");
      assert.equal(byId(document, "local-results").hidden, true,
        "a blocked mapping must not produce a decision brief");
      assert.equal(page.downloads.length, 0, "no decision record may be produced from a blocked import");
    });
  } finally {
    page.restore();
  }
});

test("un-mapping a required column in the wizard re-blocks the import", async (t) => {
  // The partially-mapped state a leader can reach through the shipped UI: a
  // recognized export whose cost column they set back to "Ignore this column".
  const page = await openFinopsTab();
  const { document } = page;
  try {
    chooseFiles(document, [
      { name: PROVIDER_FILE, text: JOINABLE_EXPORT },
      { name: ROSTER_FILE, text: ORG_ROSTER },
    ]);
    await reviewOpens(document, PROVIDER_FILE);

    await t.test("the amount column starts mapped and confirmable", () => {
      assert.equal(byId(document, "import-mapping-confirm").disabled, false);
      assert.equal(byId(document, "import-mapping-target-5").value, "amount");
    });

    await t.test("choosing 'Ignore this column' on the cost column blocks the analysis", () => {
      const select = byId(document, "import-mapping-target-5");
      select.focus();
      // Up-arrow on the closed select is how a keyboard user changes it; the
      // first option is the explicit ignore, so this walks the choice back.
      while (select.value !== "ignored") pressKey(document, "ArrowUp");
      assert.equal(byId(document, "import-mapping-blockers").hidden, false);
      assert.equal(byId(document, "import-mapping-confirm").disabled, true,
        "removing a required mapping must re-arm the guard");
      assert.match(shownText(document, "import-mapping-blockers"), /Cost/i,
        "the blocker must name the column the leader just un-mapped");
      assert.equal(shownText(document, "import-mapping-status"),
        "5 of 7 columns are mapped. 1 thing must be resolved first.");
    });

    await t.test("the blocked import produces neither a brief nor a record", () => {
      byId(document, "import-mapping-confirm").click();
      assert.equal(byId(document, "local-results").hidden, true);
      assert.equal(page.downloads.length, 0);
    });

    await t.test("restoring the mapping lets the same import through", async () => {
      const select = byId(document, "import-mapping-target-5");
      select.focus();
      while (select.value !== "amount") pressKey(document, "ArrowDown");
      assert.equal(byId(document, "import-mapping-confirm").disabled, false);
      byId(document, "import-mapping-confirm").click();
      await reviewOpens(document, ROSTER_FILE);
      byId(document, "import-mapping-confirm").click();
      await waitFor(() => !byId(document, "local-results").hidden, "the decision brief to appear");
      assert.equal(shownText(document, "local-trust-coverage"), JOINABLE.coverage);
    });
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// Reopening a saved briefing (issue #388).
//
// The round trip is real on both ends: the file fed back into the reopen
// control is the one the Export JSON button just handed out, produced by the
// shipped export path from a genuine import. Nothing between the two is stubbed.
// ---------------------------------------------------------------------------

/** Hand the reopen control a file, through the same File API a picker uses. */
function chooseBriefing(document, text, { name = "local-finops-briefing.json", size } = {}) {
  const input = byId(document, "reopen-briefing-file");
  input.files = [{
    name, type: "application/json", size: size ?? text.length, text: async () => text,
  }];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

/** Drive the shipped import all the way to a decision brief. */
async function importJoinableExport(document) {
  chooseFiles(document, [
    { name: PROVIDER_FILE, text: JOINABLE_EXPORT },
    { name: ROSTER_FILE, text: ORG_ROSTER },
  ]);
  await reviewOpens(document, PROVIDER_FILE);
  byId(document, "import-mapping-confirm").click();
  await reviewOpens(document, ROSTER_FILE);
  byId(document, "import-mapping-confirm").click();
  await waitFor(() => !byId(document, "local-results").hidden, "the decision brief to appear");
}

test("an opted-in import adds its canonical derived briefing to the local workspace", async () => {
  const page = await openFinopsTab(consentSeed("granted"));
  try {
    await importJoinableExport(page.document);

    const retained = JSON.parse(page.storage.getItem(FINOPS_WORKSPACE_KEY));
    assert.equal(retained.consent.state, "granted");
    assert.equal(retained.periods.length, 1);
    assert.equal(retained.periods[0].dataset, "user");
    assert.equal(retained.periods[0].period, "2026-06");
    assert.equal(retained.periods[0].briefingContractVersion, "finops-briefing/1.0.0");
    assert.equal(retained.periods[0].materialMetricId, "recoverable_scenario");
    assert.equal(retained.periods[0].materialMetricMinor, 40275);
    assert.equal("provenance" in retained.periods[0], false,
      "the persisted record must be the allowlisted projection, not the briefing envelope");
  } finally {
    page.restore();
  }
});

test("a completed import leaves a journey snapshot the action center can resume", async () => {
  const page = await openFinopsTab(consentSeed("granted"));
  try {
    await importJoinableExport(page.document);

    const stored = page.storage.getItem(JOURNEY_SNAPSHOT_KEY);
    assert.notEqual(stored, null, "the import must leave a snapshot to carry");
    const snapshot = JSON.parse(stored);
    assert.equal(snapshot.version, JOURNEY_SNAPSHOT_VERSION);
    assert.equal(validateJourneySnapshot(snapshot).ok, true);
    assert.equal(snapshot.provenance.fileCount, 2);
    // The contract the retained evidence recorded, whichever envelope this page
    // analysed through — a placeholder here would name no version at all.
    assert.match(snapshot.provenance.analysisContract, /^local-finops[\w-]*\/\d+\.\d+\.\d+$/);
    assert.equal(snapshot.benchmark.analysisPeriod, "2026-06");
    assert.ok(snapshot.departmentReferences.length > 0,
      "the departments this import ranked must be referenced");
    // This browser has no retained monthly action, so there is no action to
    // reference and the snapshot says so rather than inventing one.
    assert.equal(snapshot.trackedAction, null);
    // References, not payloads: no department name and no file name is in it.
    assert.doesNotMatch(stored, /Atlas Platform|openai-usage-export|generic-hris-roster/);
  } finally {
    page.restore();
  }
});

test("declining storage preserves the import flow without retaining derived figures", async () => {
  const page = await openFinopsTab(consentSeed("declined"));
  const before = page.storage.getItem(FINOPS_WORKSPACE_KEY);
  try {
    await importJoinableExport(page.document);

    assert.equal(page.storage.getItem(FINOPS_WORKSPACE_KEY), before);
    assert.equal(byId(page.document, "local-results").hidden, false);
    assert.equal(shownText(page.document, "local-trust-coverage"), JOINABLE.coverage);
  } finally {
    page.restore();
  }
});

test("a leader reopens the briefing they exported and reads it beside the current analysis", async (t) => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importJoinableExport(document);
    byId(document, "export-local-json").click();
    const exported = page.downloads.at(-1).text;

    await t.test("the exported file reopens read-only and says so", async () => {
      chooseBriefing(document, exported);
      await waitFor(() => !byId(document, "restored-briefing").hidden,
        "the restored briefing region to appear");

      const region = byId(document, "restored-briefing");
      assert.equal(region.getAttribute("role"), "region");
      assert.match(shownText(document, "restored-briefing-title"), /Reopened FinOps briefing \(read-only\)/);
      assert.match(textOf(region), /Reopened from a file · not the current analysis/);
      // The window it observed is the file's own period, not today.
      assert.match(shownText(document, "restored-briefing-captured"),
        /^Observation window 2026-06-05 to 2026-06-07 · written \d{4}-\d{2}-\d{2} · /);
      assert.match(shownText(document, "restored-briefing-coverage"), /confidence|coverage/i);
      // It is not the live slot, and the live slot is untouched by it.
      assert.notEqual(region, byId(document, "local-lead-finding"));
      assert.equal(byId(document, "local-lead-finding").hidden, false,
        "the imported result must still be on screen underneath its own heading");
    });

    await t.test("the load is announced politely and focus lands on the restored heading", () => {
      assert.match(shownText(document, "local-import-state"), /Saved briefing reopened\./);
      assert.equal(shownText(document, "local-import-alert"), "",
        "a successful load must not speak from the assertive region as well");
      assert.equal(document.activeElement?.id, "restored-briefing-title");
    });

    await t.test("the delta against the identical analysis reports no change, in words", () => {
      const delta = byId(document, "restored-briefing-delta");
      assert.equal(delta.hidden, false, "both a restored briefing and an analysis are present");
      assert.equal(delta.dataset.comparable, "true");
      assert.match(textOf(delta), /Observed spend unchanged at 444\.15 USD\./);
      assert.match(textOf(delta), /Confidence grade unchanged at/);
    });

    await t.test("closing it takes the region away and returns focus to the control", () => {
      byId(document, "restored-briefing-close").click();
      assert.equal(byId(document, "restored-briefing").hidden, true);
      assert.equal(document.activeElement?.id, "reopen-briefing-file");
      assert.match(shownText(document, "local-import-state"), /Reopened briefing closed\./);
    });
  } finally {
    page.restore();
  }
});

test("a malformed briefing is refused in one calm sentence and leaves nothing behind", async (t) => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importJoinableExport(document);
    const before = shownText(document, "local-lead-metric");

    await t.test("the reason names the fault and no markup reaches the page", async () => {
      chooseBriefing(document, JSON.stringify({
        exportedAt: "2026-07-01T00:00:00.000Z",
        dataset: "user",
        briefingContractVersion: "finops-briefing/1.0.0",
        results: { note: "<img src=x onerror=\"globalThis.pwned=1\" data-payload=\"1\">" },
      }));
      await waitFor(() => !byId(document, "restored-briefing-error").hidden,
        "the rejection sentence to appear");

      const error = byId(document, "restored-briefing-error");
      assert.match(textOf(error), /contains markup or a scheme URL/);
      assert.doesNotMatch(textOf(error), /Error|at Object|undefined/);
      assert.equal(byId(document, "reopen-briefing-file").getAttribute("aria-invalid"), "true");
      assert.equal(globalThis.pwned, undefined);
      assert.equal(document.querySelectorAll("img").filter((node) => node.hasAttribute("data-payload")).length, 0,
        "nothing out of the file may become an element");
    });

    await t.test("no half-restored region is left on screen and the analysis is untouched", () => {
      assert.equal(byId(document, "restored-briefing").hidden, true);
      assert.equal(byId(document, "restored-briefing-metric").textContent, "");
      assert.equal(shownText(document, "local-lead-metric"), before,
        "a rejected file must not change a single figure in the live analysis");
      assert.match(shownText(document, "local-import-alert"), /That briefing was not opened\./);
      assert.equal(document.activeElement?.id, "restored-briefing-error",
        "focus lands on the sentence that says what to do next, as the Shiplog importer does");
    });
  } finally {
    page.restore();
  }
});

test("reopening a briefing reaches no network and writes to no storage", async (t) => {
  const page = await openFinopsTab();
  const { document } = page;
  const requests = [];
  const writes = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, ...rest) => {
    requests.push(String(url));
    return realFetch(url, ...rest);
  };
  const realSetItem = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = (key, value) => {
    writes.push(key);
    return realSetItem.call(globalThis.localStorage, key, value);
  };
  try {
    await importJoinableExport(document);
    byId(document, "export-local-json").click();
    const exported = page.downloads.at(-1).text;
    requests.length = 0;
    writes.length = 0;

    await t.test("a successful load touches neither", async () => {
      chooseBriefing(document, exported);
      await waitFor(() => !byId(document, "restored-briefing").hidden, "the restored briefing");
      assert.deepEqual(requests, [], `a load must not fetch; it requested ${requests.join(", ")}`);
      assert.deepEqual(writes, [], `a load must not persist; it wrote ${writes.join(", ")}`);
    });

    await t.test("a rejected load touches neither", async () => {
      chooseBriefing(document, "{ truncated");
      await waitFor(() => !byId(document, "restored-briefing-error").hidden, "the rejection sentence");
      assert.deepEqual(requests, []);
      assert.deepEqual(writes, []);
    });
  } finally {
    globalThis.fetch = realFetch;
    globalThis.localStorage.setItem = realSetItem;
    page.restore();
  }
});

test("the reopen control and the restored region are operable on the keyboard alone", async (t) => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importJoinableExport(document);
    byId(document, "export-local-json").click();
    const exported = page.downloads.at(-1).text;

    await t.test("the control is reachable by Tab and carries a real label", () => {
      const input = tabTo(document, "reopen-briefing-file");
      assert.equal(input.getAttribute("type"), "file");
      const label = document.querySelectorAll("label")
        .find((node) => node.getAttribute("for") === "reopen-briefing-file");
      assert.equal(textOf(label), "Reopen a saved briefing");
      assert.equal(input.getAttribute("placeholder"), null,
        "the control is labelled programmatically, never by placeholder text");
    });

    await t.test("the reopened region is discoverable by its accessible name", async () => {
      chooseBriefing(document, exported);
      await waitFor(() => !byId(document, "restored-briefing").hidden, "the reopened briefing");
      const region = byId(document, "restored-briefing");
      const name = textOf(byId(document, region.getAttribute("aria-labelledby")));
      assert.match(name, /Reopened/, "the region's accessible name must say it is reopened");
      // And its own control is on the Tab path once it is open.
      const close = tabTo(document, "restored-briefing-close");
      assert.equal(close.id, "restored-briefing-close");
      pressEnter(document);
      assert.equal(byId(document, "restored-briefing").hidden, true);
    });
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// The third declared organizational query source, through the same file input.
// ---------------------------------------------------------------------------
//
// A conversation or audit archive is not a query sample and not a provider
// export. Before this path existed the import surface had nowhere to put one:
// it fell through to the column-mapping step, which reads billing shapes. These
// two tests are the regression guard on that routing in both directions — an
// archive and a supported one-file provider export both bypass billing mapping,
// but only the latter activates the analysis.

test("a local conversation archive is recognized without the mapping step", async () => {
  const page = await openFinopsTab();
  try {
    const { document } = page;
    chooseFiles(document, [{
      name: "conversation-archive.csv",
      text: conversationExampleText("chatgpt-enterprise-conversation-export"),
    }]);
    await waitFor(() => shownText(document, "org-coaching").includes("Your file, read in this tab"),
      "the coaching decision to be repainted from the reader's own archive");
    // The registry's own label for the source, so the reader is told which of
    // the three declared shapes their file was read as.
    assert.match(shownText(document, "org-coaching"), /Local conversation or audit archive/);
    // And it never reached the billing-shaped mapping step.
    assert.equal(byId(document, "import-mapping").hidden, true,
      "an archive must not be routed through the column-mapping step");
    // An archive carries no rubric category, so no letter is published from it
    // and the surface names no department to coach.
    assert.ok(!shownText(document, "org-coaching").includes("needs coaching first"));
  } finally {
    page.restore();
  }
});

test("a supported one-file provider export now reaches analysis without mapping", async () => {
  const page = await openFinopsTab();
  try {
    const { document } = page;
    chooseFiles(document, [{ name: "openai-usage-export.csv", text: PROVIDER_EXPORT }]);
    await waitFor(() => !byId(document, "local-results").hidden,
      "the supported provider export to reach analysis");
    assert.equal(byId(document, "import-mapping").hidden, true);
    assert.equal(byId(document, "local-export-activation").dataset.state, "ready");
  } finally {
    page.restore();
  }
});
