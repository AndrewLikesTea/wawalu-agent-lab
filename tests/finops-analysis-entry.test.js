// The visitor's own entry into the analysis: one provider export, one click, a
// result — and then the two optional files that sharpen it, added from the
// result itself.
//
// Everything below drives the shipped AI FinOps tab (src/evolution.html booted
// by src/evolution-page.js) or the shipped markup directly. Nothing between the
// selection and the rendered brief is stubbed; the one thing the harness
// supplies is the browser's File API, which a headless DOM has no picker for.
//
// What is pinned here is the part that would regress silently: the gate is the
// published eligibility policy rather than a file count, the optional inputs say
// what they buy, both halves of the money sit beside the headline figure, and an
// added file — valid or not — never takes the reader's result off the screen.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, parseHtml, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { applyRequirements, mappingRequirements } from "../src/local-import-flow.js";
import {
  analysisEligibility, INPUT_STATES, OPTIONAL_UPGRADES,
} from "../src/finops-attribution-policy.js";
import { coverageChangeSummary } from "../src/attribution-confidence.js";
import { applyAttributionSplit, applyChangeSummary } from "../src/attribution-confidence-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const EXAMPLE_EXPORTS = new URL("../contracts/integrations/tabular-dialects/v1/fixtures/", import.meta.url);
const PROVIDER_EXPORT = await readFile(new URL("openai-usage-export.csv", EXAMPLE_EXPORTS), "utf8");
const ORG_ROSTER = await readFile(new URL("generic-hris-roster.csv", EXAMPLE_EXPORTS), "utf8");

/** The shipped export with two project labels respelled to match the roster. */
const JOINABLE_EXPORT = PROVIDER_EXPORT
  .replace(/atlas-platform/g, "Atlas Platform")
  .replace(/boreal-support/g, "Boreal Support");

const PROVIDER_FILE = "openai-usage-export.csv";
const ROSTER_FILE = "generic-hris-roster.csv";

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));

async function openFinopsTab() {
  const page = await loadPage(PAGE, {
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  await waitFor(() => textOf(document.getElementById("integration-contract-provenance"))
    .startsWith("Gateway completed"), "the static contract gateway to settle");
  await waitFor(() => document.getElementById("finops-evaluation-result")
    .getAttribute("aria-busy") === "false", "the evaluation panel to settle");
  return page;
}

function chooseFiles(document, files) {
  const input = document.getElementById("local-finops-files");
  input.files = files.map(({ name, text }) => ({
    name, type: "text/csv", text: async () => text,
  }));
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

function reviewOpens(document, fileName) {
  return waitFor(() => !byId(document, "import-mapping").hidden
    && shownText(document, "import-mapping-file") === fileName,
  `the column-mapping step to open on ${fileName}`);
}

/** Take one delimited file through the mapping step it always walks. */
async function importFile(document, name, text) {
  chooseFiles(document, [{ name, text }]);
  await reviewOpens(document, name);
  byId(document, "import-mapping-confirm").click();
}

/**
 * The privacy statement, on whatever state the page is in. It is one authored
 * sentence in the import panel that every state below is nested inside, so
 * "present" means present and not hidden — never a per-state copy.
 */
function privacyStatement(document) {
  const note = document.querySelectorAll(".privacy-boundary")[0];
  return note && !note.hidden ? textOf(note) : null;
}

// --- (a) the gate is the policy, not a file count --------------------------

test("analysis is eligible on a provider export alone and refused only without one", () => {
  const alone = analysisEligibility({ hasProviderExport: true });
  assert.equal(alone.eligible, true);
  assert.equal(alone.inputState, INPUT_STATES.PROVIDER_ONLY);

  // The two optional inputs move the state without ever being a precondition.
  assert.equal(analysisEligibility({
    hasProviderExport: true, hasGroupingColumn: true,
  }).inputState, INPUT_STATES.PROVIDER_PLUS_GROUPING);
  assert.equal(analysisEligibility({
    hasProviderExport: true, hasGroupingColumn: true, hasOrgMapping: true,
  }).inputState, INPUT_STATES.PROVIDER_PLUS_ORG_MAPPING);
  // An org mapping with nothing to rename is still provider-only, and still
  // eligible: the policy decides that, and this gate reads its answer.
  assert.equal(analysisEligibility({
    hasProviderExport: true, hasOrgMapping: true,
  }).inputState, INPUT_STATES.PROVIDER_ONLY);

  // The only refusal, and it names the policy state that produced it rather
  // than a sentence authored beside a button.
  const refused = analysisEligibility({ hasProviderExport: false, hasOrgMapping: true });
  assert.equal(refused.eligible, false);
  assert.equal(refused.inputState, null);
  assert.match(refused.reason, /No recognized provider export is loaded/);
  assert.match(refused.reason, /concentrated in/,
    "the refusal carries the policy's own statement of what an export answers");
});

test("a provider export on its own reaches a decision brief", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    assert.equal(byId(document, "local-results").hidden, true);
    assert.ok(privacyStatement(document), "the initial state states the privacy boundary");

    await importFile(document, PROVIDER_FILE, JOINABLE_EXPORT);
    await waitFor(() => !byId(document, "local-results").hidden,
      "one provider export alone to produce a decision brief");
    // No roster was ever selected, and none was asked for.
    assert.equal(shownText(document, "mapping-requirements").includes("Add it"), false,
      "with the export in hand nothing may still be presented as missing");
    assert.ok(privacyStatement(document), "the results state states the privacy boundary");
  } finally {
    page.restore();
  }
});

// --- (b) the optional inputs say what they buy -----------------------------

test("the requirements panel marks both optional inputs optional, with their gain", async () => {
  const doc = parseHtml(await readFile(PAGE, "utf8"));
  applyRequirements(doc, { providers: 1, hris: false, samples: 0 });
  const rows = doc.querySelectorAll("li").filter((row) => row.className === "mapping-requirement");
  assert.deepEqual(rows.map((row) => row.dataset.kind), ["required", "optional", "optional"]);

  // Required versus optional survives without color: a word in the row, and the
  // same word in the accessible name.
  assert.match(textOf(rows[0]), /Required/);
  for (const optional of rows.slice(1)) {
    assert.match(textOf(optional), /Optional/);
    assert.match(optional.getAttribute("aria-label"), /^Optional: /);
    assert.equal(optional.querySelector("button"), null,
      "an optional input is never offered as something to resolve");
  }
  assert.match(textOf(rows[1]), new RegExp(OPTIONAL_UPGRADES.ORG_MAPPING.gain.slice(0, 40)));
  assert.match(textOf(rows[2]), new RegExp(OPTIONAL_UPGRADES.QUERY_SAMPLE.gain.slice(0, 40)));

  // With a measured share in hand the standing sentence is replaced by the
  // projected coverage the confidence model computed from the reader's own file.
  const measured = applyRequirements(doc, {
    providers: 1, hris: false, samples: 0,
    upgrades: { all: [{ id: "org_mapping", text: "Add an org mapping — would raise coverage to ~92%." }] },
  });
  assert.match(measured[1].gain, /would raise coverage to ~92%/);
});

test("an added query sample resolves its own row rather than a new requirement", () => {
  const rows = mappingRequirements({ providers: 1, hris: false, samples: 2 });
  assert.equal(rows[2].state, "ready");
  assert.equal(rows[2].required, false);
  assert.match(rows[2].status, /2 samples ready/);
});

// --- (c) both halves of the money, beside the headline ---------------------

test("the attributed and unattributed halves render beside the headline figure", async () => {
  const doc = parseHtml(await readFile(PAGE, "utf8"));
  const split = applyAttributionSplit(doc, { total: 546.2, attributed: 444.15 },
    { formatMoney: (value) => `${value.toFixed(2)} USD` });
  assert.equal(Math.round(split.attributedShare * 1000) / 1000, 0.813);

  const region = byId(doc, "local-attribution-split");
  assert.equal(region.hidden, false);
  assert.equal(region.dataset.state, "partial");
  // Inside the finding's own definition list, so the pair cannot be reflowed
  // away from the number: it is a sibling of the impact group, not a panel.
  assert.equal(region.parentNode.className, "local-finding-facts");
  const values = doc.querySelectorAll("dd").filter((node) => node.className === "attribution-split-value");
  assert.equal(textOf(values[0]), "81% · 444.15 USD");
  assert.equal(textOf(values[1]), "19% · 102.05 USD");
  // Every figure carries its unit and its currency; no bare numeral ships.
  for (const value of values) assert.match(textOf(value), /% · [\d.]+ USD$/);

  // A fully attributed result says so rather than hiding the pair.
  assert.equal(applyAttributionSplit(doc, { total: 100, attributed: 100 }).unattributed, 0);
  assert.equal(byId(doc, "local-attribution-split").dataset.state, "complete");
  // Nothing measured, nothing claimed.
  assert.equal(applyAttributionSplit(doc, null), null);
  assert.equal(byId(doc, "local-attribution-split").hidden, true);
});

test("per-unit detail stays collapsed behind the disclosure the page already had", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importFile(document, PROVIDER_FILE, JOINABLE_EXPORT);
    await waitFor(() => !byId(document, "local-results").hidden, "the decision brief to appear");

    assert.equal(byId(document, "local-attribution-split").hidden, false,
      "the attributed/unattributed pair renders with the result");
    const disclosures = document.querySelectorAll("button")
      .filter((node) => node.className === "local-trust-choice");
    assert.ok(disclosures.length, "the unattributed detail must be disclosed, not absent");
    for (const button of disclosures) {
      assert.equal(button.getAttribute("aria-expanded"), "false",
        "per-unit detail is collapsed until the reader opens it");
      assert.equal(byId(document, button.getAttribute("aria-controls")).hidden, true);
    }
    // Opening one is the same disclosure pattern, not a second mechanism.
    disclosures[0].click();
    assert.equal(disclosures[0].getAttribute("aria-expanded"), "true");
    assert.equal(byId(document, disclosures[0].getAttribute("aria-controls")).hidden, false);
  } finally {
    page.restore();
  }
});

// --- (d) adding an optional file, in place ---------------------------------

test("the change summary names the figures that moved, and only when they moved", async () => {
  const doc = parseHtml(await readFile(PAGE, "utf8"));
  const summary = coverageChangeSummary({
    previous: { inputState: INPUT_STATES.PROVIDER_PLUS_GROUPING, share: 0 },
    next: { inputState: INPUT_STATES.PROVIDER_PLUS_ORG_MAPPING, share: 0.813 },
  });
  const moved = Object.fromEntries(summary.items.map((item) => [item.id, item]));
  assert.deepEqual([moved.attributed_share.from, moved.attributed_share.to], ["0%", "81%"]);
  assert.deepEqual([moved.unattributed_share.from, moved.unattributed_share.to], ["100%", "19%"]);

  applyChangeSummary(doc, summary);
  const region = byId(doc, "local-result-change");
  assert.equal(region.hidden, false);
  // Not a live region: the polite announcement is spoken once, and this is what
  // a reader who missed it can come back to.
  assert.equal(region.getAttribute("aria-live"), null);
  assert.match(textOf(region), /Attributed share0% → 81%/);

  // An unchanged recalculation leaves no summary to mislead the reader.
  assert.equal(coverageChangeSummary({
    previous: { inputState: INPUT_STATES.PROVIDER_ONLY, share: 0.4 },
    next: { inputState: INPUT_STATES.PROVIDER_ONLY, share: 0.4 },
  }), null);
  applyChangeSummary(doc, null);
  assert.equal(byId(doc, "local-result-change").hidden, true);
});

test("an org mapping added from the result updates it in place", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importFile(document, PROVIDER_FILE, JOINABLE_EXPORT);
    await waitFor(() => !byId(document, "local-results").hidden, "the decision brief to appear");
    const before = shownText(document, "local-trust-coverage");
    assert.equal(before, "0.0%", "with no roster, none of the spend is attributed");

    // The affordance lives on the result and moves focus to the one picker.
    const add = byId(document, "add-optional-file");
    assert.equal(add.disabled, false);
    add.click();
    assert.equal(document.activeElement, byId(document, "local-finops-files"));

    await importFile(document, ROSTER_FILE, ORG_ROSTER);
    await waitFor(() => shownText(document, "local-trust-coverage") !== before,
      "the coverage figure to move in place");

    // The result was never taken away, and the provider export was never
    // re-requested: only the roster was ever handed to the picker again.
    assert.equal(byId(document, "local-results").hidden, false);
    assert.equal(shownText(document, "local-trust-coverage"), "81.3%");
    assert.match(shownText(document, "local-attribution-split"), /444\.15 USD/);

    const change = byId(document, "local-result-change");
    assert.equal(change.hidden, false);
    assert.match(textOf(change), /Attributed share0% → 81%/);
    assert.match(textOf(change), /Unattributed share100% → 19%/);
    // Spoken politely, and the caret is left where the reader put it.
    assert.match(shownText(document, "coverage-live"), /Coverage increased from 0% to 81%/);
    assert.ok(privacyStatement(document), "the in-place upgrade state states the privacy boundary");
  } finally {
    page.restore();
  }
});

// --- (e) an unusable added file leaves the result standing -----------------

test("an invalid optional file leaves the prior result intact and recoverable", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importFile(document, PROVIDER_FILE, JOINABLE_EXPORT);
    await waitFor(() => !byId(document, "local-results").hidden, "the decision brief to appear");
    const coverage = shownText(document, "local-trust-coverage");
    const figure = shownText(document, "local-recoverable");
    const basis = shownText(document, "local-metric-label");

    // A JSON file the v1 contract refuses: not delimited, so it fails on sight
    // rather than opening the mapping step.
    chooseFiles(document, [{ name: "not-an-export.json", text: "{\"nope\":true}" }]);
    await waitFor(() => !byId(document, "local-file-error").hidden,
      "the diagnostic to attach to the control that produced it");

    assert.equal(byId(document, "local-results").hidden, false,
      "a failed addition must never blank the result the reader already had");
    assert.equal(shownText(document, "local-trust-coverage"), coverage);
    assert.equal(shownText(document, "local-recoverable"), figure);
    assert.equal(shownText(document, "local-metric-label"), basis,
      "a surviving real figure keeps the label that describes it");

    // Recoverable in place: the error is bound to the control, and both
    // recoveries sit beside it.
    assert.equal(byId(document, "local-finops-files").getAttribute("aria-invalid"), "true");
    assert.equal(byId(document, "local-file-recovery").hidden, false);
    assert.ok(privacyStatement(document), "the error state states the privacy boundary");

    // And the same result is still exportable, so nothing was half-discarded.
    byId(document, "export-local-json").click();
    assert.equal(page.downloads.length, 1);
  } finally {
    page.restore();
  }
});

// --- (f) / (5) the example path stays available and stays secondary --------

test("the example affordance is keyboard-operable, secondary, and below the reader's own path", async () => {
  const doc = parseHtml(await readFile(PAGE, "utf8"));
  const example = byId(doc, "try-example-dataset");
  assert.equal(example.tagName.toLowerCase(), "button");
  assert.equal(example.getAttribute("type"), "button");
  assert.equal(example.hasAttribute("disabled"), false);

  // DOM order decides both reading order and the first Tab stop, so the file
  // control the visitor's own path starts at must come first.
  const controls = doc.querySelectorAll("button,input")
    .filter((node) => ["local-finops-files", "try-example-dataset"].includes(node.id))
    .map((node) => node.id);
  assert.deepEqual(controls, ["local-finops-files", "try-example-dataset"]);

  const styles = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
  // Subordinate treatment: the filled accent belongs to the primary path, and
  // this control no longer claims it.
  assert.match(styles, /\.local-import button\.local-example-action \{[^}]*background:transparent/);
});
