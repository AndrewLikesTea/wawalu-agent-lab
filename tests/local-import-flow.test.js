// Reading-experience regression for the browser-local import and mapping flow.
//
// Every assertion here drives the shipped markup — src/evolution.html parsed by
// the same harness the decisions end-to-end suite uses — rather than a fixture
// authored for the test. What it pins is the part that is easy to regress
// silently: the diagnostic stays attached to the control it concerns, the
// headline number never appears without a word saying what kind of number it
// is, one commit produces one announcement, and nothing read out of a selected
// file reaches visible text or a live region.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHtml, tabSequence, textOf } from "./support/browser.js";
import {
  announce, applyDatasetProvenance, applyFieldDiagnostic, applyLeadingFinding, applyMetricBasis,
  applyRequirements, applyStage, applyTrustVerdict, applyUpgradePanel, diagnosticFor,
  EXAMPLE_DATASET_PROVENANCE, focusStageHeading, IMPORT_STAGES, importStage, mappingRequirements,
  metricBasis, redactDiagnostic, stageProgress, upgradeDelta,
} from "../src/local-import-flow.js";
import { OPTIONAL_INPUT_UPGRADES } from "../src/finops-attribution-policy.js";
import { trustVerdict } from "../src/finops-trust-verdict.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

async function page() {
  return parseHtml(await readFile(PAGE, "utf8"));
}

const normalized = (node) => textOf(node);

// --- stage model -----------------------------------------------------------

test("the stage model names the stages the flow already walked, and no more", () => {
  assert.deepEqual(IMPORT_STAGES.map((stage) => stage.id), ["select", "check", "read"]);
  assert.equal(importStage({}), "select");
  assert.equal(importStage({ providers: 1 }), "check");
  assert.equal(importStage({ hris: true }), "check");
  assert.equal(importStage({ providers: 2, hris: true, hasResult: true }), "read");

  const progress = stageProgress("check");
  assert.deepEqual(progress.map((step) => step.state), ["complete", "current", "remaining"]);
  assert.deepEqual(progress.map((step) => step.status), ["done", "now", "next"]);
  // Shape and word travel with every state so the tint is never the only signal.
  assert.deepEqual(progress.map((step) => step.shape), ["✓", "●", "○"]);
});

test("the stage indicator exposes the current step to assistive tech", async () => {
  const doc = await page();
  applyStage(doc, "check");
  const steps = doc.querySelectorAll("li");
  const stages = steps.filter((step) => step.className === "import-stage");
  assert.equal(stages.length, 3);
  assert.equal(stages[0].getAttribute("aria-current"), null);
  assert.equal(stages[1].getAttribute("aria-current"), "step");
  assert.equal(stages[2].getAttribute("aria-current"), null);
  assert.match(normalized(stages[1]), /Step 2\s*Check the mapping\s*now/);
  assert.equal(stages[0].dataset.state, "complete");
  assert.equal(stages[2].dataset.state, "remaining");

  // Repainting a later stage moves aria-current rather than accumulating it.
  applyStage(doc, "read");
  const repainted = doc.querySelectorAll("li").filter((step) => step.className === "import-stage");
  assert.deepEqual(repainted.map((step) => step.getAttribute("aria-current")), [null, null, "step"]);
});

// --- per-field diagnostics -------------------------------------------------

test("a rejected file is diagnosed at the control, not in a page banner", async () => {
  const doc = await page();
  const control = doc.getElementById("local-finops-files");
  const diagnostic = diagnosticFor({
    code: "missing_field",
    message: "provider records[3] is missing required field “org_unit_id”.",
    ordinal: 2, total: 3,
  });
  applyFieldDiagnostic(doc, diagnostic);

  assert.equal(control.getAttribute("aria-invalid"), "true");
  assert.equal(control.getAttribute("aria-describedby"), "local-file-help local-file-error");
  const errorNode = doc.getElementById("local-file-error");
  assert.equal(errorNode.hidden, false);
  // The failing file is identified by position and the field by header name.
  assert.match(normalized(errorNode), /File 2 of 3/);
  assert.match(normalized(errorNode), /org_unit_id/);
  // The recovery is present at the control, not somewhere else on the page.
  assert.match(normalized(errorNode), /Add the named field to the source export/);
  assert.equal(doc.getElementById("local-file-recovery").hidden, false);

  // Resolving the error clears the invalid state and restores the plain
  // description; focus is not left pointing at a message that no longer exists.
  applyFieldDiagnostic(doc, null);
  assert.equal(control.getAttribute("aria-invalid"), "false");
  assert.equal(control.getAttribute("aria-describedby"), "local-file-help");
  assert.equal(doc.getElementById("local-file-error").hidden, true);
  assert.equal(doc.getElementById("local-file-recovery").hidden, true);
});

test("each unresolved requirement carries the jump to the control that fixes it", async () => {
  const doc = await page();
  // The org mapping is optional enrichment: a provider export carries its own
  // grouping column, so an absent org file is a choice with no jump to offer.
  applyRequirements(doc, { providers: 2, hris: false });
  const optional = doc.querySelectorAll("li").filter((row) => row.className === "mapping-requirement");
  // Three rows now: one required input and two optional precision upgrades.
  assert.deepEqual(optional.map((row) => row.dataset.state), ["ready", "optional", "optional"]);
  assert.match(normalized(optional[0]), /Provider period export\s*2 periods ready/);
  // The row reads as an enhancement, not an unresolved input: "optional —
  // sharpens attribution", the wording finops-attribution-policy.js publishes.
  assert.match(normalized(optional[1]),
    /Department names \(optional\)\s*optional — sharpens attribution/);
  assert.equal(optional[1].querySelector("button"), null,
    "an optional input must not be offered as something to resolve");

  applyRequirements(doc, { providers: 0, hris: true });
  const rows = doc.querySelectorAll("li").filter((row) => row.className === "mapping-requirement");
  assert.deepEqual(rows.map((row) => row.dataset.state), ["missing", "ready", "optional"]);
  assert.equal(rows[1].querySelector("button"), null);

  const jump = rows[0].querySelector("button");
  assert.equal(jump.getAttribute("type"), "button");
  assert.match(jump.getAttribute("aria-label"), /moves focus to the file chooser/);
  jump.click();
  assert.equal(doc.activeElement, doc.getElementById("local-finops-files"));

  assert.deepEqual(
    mappingRequirements({ providers: 0, hris: false }).map((row) => row.state),
    ["missing", "optional", "optional"],
  );
  assert.deepEqual(
    mappingRequirements({ providers: 0, hris: false }).map((row) => row.required),
    [true, false, false],
  );
});

test("the requirements panel marks the optional inputs optional and states what each buys", async () => {
  const doc = await page();
  applyRequirements(doc, { providers: 1, hris: false, sample: false });
  const rows = doc.querySelectorAll("li").filter((row) => row.className === "mapping-requirement");
  assert.equal(rows.length, 3);
  // Required versus optional is carried by a word and an attribute, so the
  // distinction survives a monochrome screenshot and a screen reader alike.
  assert.deepEqual(rows.map((row) => row.dataset.required), ["true", "false", "false"]);
  assert.deepEqual(rows.map((row) => textOf(row.querySelector(".requirement-kind"))),
    ["Required", "Optional", "Optional"]);
  // Neither optional row may borrow the treatment a missing required input uses.
  assert.equal(rows.filter((row) => row.dataset.state === "missing").length, 0);
  assert.equal(rows.filter((row) => row.querySelector("button")).length, 0,
    "with the required export present, nothing is offered as something to resolve");

  // The gain is the policy's own sentence, not prose authored in the component.
  const [orgUpgrade, sampleUpgrade] = OPTIONAL_INPUT_UPGRADES;
  assert.equal(textOf(rows[1].querySelector(".requirement-gain")), orgUpgrade.gain);
  assert.equal(textOf(rows[2].querySelector(".requirement-gain")), sampleUpgrade.gain);
  assert.match(textOf(rows[2]), /Query sample \(optional\)\s*optional — adds prompt-quality grades/);

  // A supplied optional input reads as ready, and still as optional.
  applyRequirements(doc, { providers: 1, hris: true, sample: true });
  const ready = doc.querySelectorAll("li").filter((row) => row.className === "mapping-requirement");
  assert.deepEqual(ready.map((row) => row.dataset.state), ["ready", "ready", "ready"]);
  assert.deepEqual(ready.map((row) => row.dataset.required), ["true", "false", "false"]);
});

// --- the in-place precision upgrade ---------------------------------------

test("the delta names which figures moved, in which direction, and against which file", () => {
  const delta = upgradeDelta({
    before: { recoverableUsd: 100, spendUsd: 500, attributedPercent: 60, namedUnits: 2 },
    after: { recoverableUsd: 120, spendUsd: 480, attributedPercent: 60, namedUnits: 3 },
    fileName: "org-roster.csv",
    formatMoney: (value) => `${value.toFixed(2)} USD`,
  });
  assert.equal(delta.fileName, "org-roster.csv");
  assert.deepEqual(delta.changes.map((change) => change.direction),
    ["up", "down", "same", "up"]);
  // Direction ships as a word as well as a glyph; the arrow is decoration.
  assert.deepEqual(delta.changes.map((change) => change.word),
    ["up", "down", "unchanged", "up"]);
  assert.equal(delta.changes[0].text, "Recoverable scenario: 100.00 USD → 120.00 USD (up)");
  assert.equal(delta.moved.length, 3);
  assert.match(delta.summary, /^org-roster\.csv applied\. 3 figures moved/);

  const flat = upgradeDelta({
    before: { recoverableUsd: 100 }, after: { recoverableUsd: 100 }, fileName: "sample.json",
  });
  assert.equal(flat.moved.length, 0);
  assert.match(flat.summary, /No figure moved; the result you were reading is unchanged\./);
});

test("an applied upgrade announces politely, and a failed one leaves the result alone", async () => {
  const doc = await page();
  const control = doc.getElementById("local-upgrade-file");
  const live = doc.getElementById("local-upgrade-live");

  applyUpgradePanel(doc, { state: "idle" }, { available: false });
  assert.equal(doc.getElementById("local-upgrade").hidden, true,
    "the upgrade control is offered only where there is a result to upgrade");

  // Every state carries the privacy statement, and the live region is polite.
  assert.equal(live.getAttribute("aria-live"), "polite");
  applyUpgradePanel(doc, { state: "reading", fileName: "org-roster.csv" });
  assert.equal(doc.getElementById("local-upgrade").hidden, false);
  assert.equal(control.disabled, true, "the control is not re-entrant while it reads");
  assert.match(textOf(doc.getElementById("local-upgrade-privacy")), /Your file stays in this tab/);
  assert.equal(textOf(live), "", "a read in progress is not an outcome to announce");

  const delta = upgradeDelta({
    before: { recoverableUsd: 100, spendUsd: 500, attributedPercent: 60, namedUnits: 2 },
    after: { recoverableUsd: 140, spendUsd: 500, attributedPercent: 82, namedUnits: 2 },
    fileName: "org-roster.csv",
  });
  applyUpgradePanel(doc, { state: "applied", fileName: "org-roster.csv", delta });
  assert.equal(control.disabled, false);
  assert.equal(control.getAttribute("aria-invalid"), "false");
  const changes = doc.getElementById("local-upgrade-changes");
  assert.equal(changes.hidden, false);
  assert.equal(changes.children.length, 4);
  assert.match(textOf(changes), /Recoverable scenario/);
  assert.match(textOf(live), /org-roster\.csv applied\. 2 figures moved/);
  assert.match(textOf(live), /Your file stays in this tab/);

  // The failure path: the diagnostic lands on the upgrade control itself, the
  // announcement stays polite, and nothing about the result is cleared here.
  applyUpgradePanel(doc, {
    state: "error", fileName: "broken.csv",
    error: diagnosticFor({ code: "empty_file", message: "the selection has no rows.", ordinal: 1, total: 1 }),
  });
  assert.equal(control.getAttribute("aria-invalid"), "true");
  assert.equal(control.getAttribute("aria-describedby"), "local-upgrade-help local-upgrade-error");
  const errorNode = doc.getElementById("local-upgrade-error");
  assert.equal(errorNode.hidden, false);
  assert.match(textOf(errorNode), /Not applied/);
  assert.match(textOf(errorNode), /re-export the period and select it again/);
  assert.equal(doc.getElementById("local-upgrade-changes").hidden, true);
  assert.match(textOf(live), /The result already on screen was not replaced\./);
  assert.match(textOf(doc.getElementById("local-upgrade-privacy")), /Your file stays in this tab/);
});

// --- the metric is never ambiguous ----------------------------------------

test("every non-real headline condition is stated in words beside the number", () => {
  assert.deepEqual(metricBasis({ mode: "example" }).label, "Example data");
  assert.equal(metricBasis({ mode: "example" }).real, false);
  assert.equal(metricBasis({ mode: "failed" }).label, "Import failed");
  assert.equal(metricBasis({ mode: "partial", providers: 1, hris: false }).label, "Incomplete mapping");
  // A missing org file is never named as the thing still unresolved: it is not
  // required, and pointing at it would be telling the reader to fix nothing.
  assert.doesNotMatch(metricBasis({ mode: "partial", providers: 1, hris: false }).detail, /org mapping/i);
  assert.match(metricBasis({ mode: "partial", providers: 0, hris: true }).detail,
    /Provider period export/);
  assert.equal(metricBasis({ mode: "local", plausible: false }).label, "Needs review");
  assert.equal(metricBasis({ mode: "local", departments: 0 }).label, "No rows matched");
  const real = metricBasis({ mode: "local", departments: 3, joinedRecords: 12 });
  assert.equal(real.label, "Local import");
  assert.equal(real.real, true);
  assert.match(real.detail, /12 joined records/);
});

test("the example-data case labels the headline metric on a cold load", async () => {
  const doc = await page();
  // Authored state, before any script runs.
  assert.equal(doc.getElementById("local-metric-label").textContent.trim(), "Example data");
  assert.equal(doc.getElementById("local-recoverable").dataset.real, "false");
  assert.match(normalized(doc.getElementById("headline-basis")), /Example data — bundled synthetic sample/);
  assert.equal(doc.getElementById("analysis-mode").dataset.mode, "example");

  applyMetricBasis(doc, metricBasis({ mode: "local", departments: 4, joinedRecords: 9 }));
  assert.equal(doc.getElementById("local-metric-label").textContent, "Local import");
  assert.equal(doc.getElementById("local-metric-label").dataset.real, "true");
  assert.equal(doc.getElementById("local-recoverable").dataset.real, "true");

  // Empty result: the mapping is valid, so the label says so rather than
  // leaving the reader to read a dash as either zero or broken.
  applyMetricBasis(doc, metricBasis({ mode: "local", departments: 0, joinedRecords: 0 }));
  assert.equal(doc.getElementById("local-metric-label").dataset.real, "false");
  assert.match(normalized(doc.getElementById("local-metric-detail")), /no provider aggregate joined/i);
});

// --- announcements ---------------------------------------------------------

test("one commit produces one announcement, routed by severity", async () => {
  const doc = await page();
  const status = doc.getElementById("local-import-state");
  const alert = doc.getElementById("local-import-alert");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(alert.getAttribute("role"), "alert");
  assert.equal(alert.getAttribute("aria-live"), "assertive");

  announce(doc, { severity: "polite", state: "loading", title: "Reading files in this tab…", copy: "Parsing locally." });
  assert.match(normalized(status), /Reading files in this tab/);
  assert.equal(normalized(alert), "");
  assert.equal(status.dataset.state, "loading");

  // A hard failure moves to the assertive region and empties the polite one, so
  // the same outcome is never read from two places.
  announce(doc, { severity: "assertive", state: "error", title: "This file was not analyzed.", copy: "Not valid JSON." });
  assert.match(normalized(alert), /This file was not analyzed\.\s*Not valid JSON\./);
  assert.equal(normalized(status), "");

  announce(doc, { severity: "polite", state: "ready", title: "Local analysis ready.", copy: "Done." });
  assert.equal(normalized(alert), "");
  assert.match(normalized(status), /Local analysis ready/);
});

test("stage change moves focus to the new stage's own heading or control", async () => {
  const doc = await page();
  assert.equal(focusStageHeading(doc, "read"), doc.getElementById("local-results-title"));
  assert.equal(doc.getElementById("local-results-title").getAttribute("tabindex"), "-1");
  assert.equal(doc.activeElement, doc.getElementById("local-results-title"));
  focusStageHeading(doc, "select");
  assert.equal(doc.activeElement, doc.getElementById("local-finops-files"));
});

// --- redaction -------------------------------------------------------------

test("no value read out of a selected file reaches text or a live region", async () => {
  const doc = await page();
  const hostile = "Record psn_abcdefghijklmnop0123 in export "
    + "3f2504e0-4f89-11d3-9a0c-0305e82c3301 from /Users/leader/Downloads/october-billing.json "
    + "is missing required field “cost”.";
  const scrubbed = redactDiagnostic(hostile);
  assert.doesNotMatch(scrubbed, /psn_/);
  assert.doesNotMatch(scrubbed, /3f2504e0/);
  assert.doesNotMatch(scrubbed, /october-billing|Downloads/);
  // The contract field name survives: it is the header a reader needs to fix.
  assert.match(scrubbed, /“cost”/);

  const diagnostic = diagnosticFor({ code: "missing_field", message: hostile, ordinal: 1, total: 1 });
  applyFieldDiagnostic(doc, diagnostic);
  announce(doc, { severity: "assertive", state: "error", title: "This file was not analyzed.", copy: diagnostic.text });
  for (const node of [doc.getElementById("local-file-error"), doc.getElementById("local-import-alert")]) {
    const text = normalized(node);
    assert.doesNotMatch(text, /psn_|3f2504e0|october-billing|Downloads/);
  }
});

test("the redaction promise is stated where the numbers are read, not in a footer", async () => {
  const html = await readFile(PAGE, "utf8");
  const boundary = html.indexOf('class="privacy-boundary"');
  assert.ok(boundary > 0 && boundary < html.indexOf('id="local-finops-files"'),
    "the boundary must precede the control that starts the import");
  // The promise moved with the product, deliberately: the column-review step
  // shows one sample value per column, because a reader cannot check what their
  // column became without seeing what is in it, and their own file name labels
  // their own result. Everything else the boundary said still holds, and the
  // limit is still stated at the control rather than in a footer.
  assert.match(html, /Column headers, one sample value per column while you check the mapping, and totals are shown; no other cell value is ever rendered/);
  assert.match(html, /No other cell value or record identifier is rendered, announced, or written to an export/);
  assert.match(html, /your file name appears only as the provenance label on your own result/);

  // Detailed provenance recedes into disclosure; the promise itself does not.
  const doc = await page();
  const provenance = doc.getElementById("local-provenance");
  assert.equal(provenance.closest("details").className, "local-provenance-detail");
  assert.equal(doc.querySelector(".privacy-boundary").closest("details"), null);
});

// --- keyboard completeness -------------------------------------------------

test("the import surface is keyboard-complete and in reading order", async () => {
  const html = await readFile(PAGE, "utf8");
  // Ordering is fixed in the DOM, never patched with a positive tabindex.
  assert.doesNotMatch(html, /tabindex="[1-9]/);

  const doc = await page();
  applyStage(doc, "check");
  // Providers is the only genuinely required input, so it is the one that can
  // still be unresolved and therefore the one that offers a jump.
  applyRequirements(doc, { providers: 0, hris: true });
  applyFieldDiagnostic(doc, diagnosticFor({ code: "invalid_json", message: "The file is not valid JSON." }));
  doc.getElementById("local-results").hidden = false;
  doc.getElementById("clear-local-analysis").hidden = false;

  const ids = tabSequence(doc).map((node) => node.getAttribute("id")).filter(Boolean);
  const order = [
    "local-finops-files", "local-file-repick", "local-file-discard",
    "clear-local-analysis", "export-local-json", "export-local-summary",
  ];
  const positions = order.map((id) => ids.indexOf(id));
  for (const [index, position] of positions.entries())
    assert.ok(position >= 0, `${order[index]} must be reachable by keyboard`);
  assert.deepEqual([...positions].sort((left, right) => left - right), positions,
    "tab order must follow the staged reading order");

  // The requirement jump is a real button in the sequence, between the control
  // it points at and the export actions that follow the result.
  const jump = tabSequence(doc).find((node) => node.className === "requirement-jump");
  assert.ok(jump, "an unresolved requirement must expose its jump to the keyboard");

  // Hidden stages contribute nothing to the sequence.
  doc.getElementById("local-results").hidden = true;
  const hiddenIds = tabSequence(doc).map((node) => node.getAttribute("id"));
  assert.ok(!hiddenIds.includes("export-local-json"));
});

test("the panel draws focus, disabled, and status states from existing tokens", async () => {
  const styles = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
  // No raw hex is introduced by the refinement: the new roles are named tokens.
  for (const token of [
    "--import-ink", "--import-accent", "--import-line", "--import-wash",
    "--state-warn-ink", "--state-warn-line", "--state-warn-wash",
    "--state-error-ink", "--state-error-line", "--state-error-wash",
  ]) assert.match(styles, new RegExp(`${token}\\s*:`), `${token} must be defined`);

  // The focus ring is the site token, not a per-panel blue, and it is never
  // removed.
  assert.match(styles, /\.local-import button:focus-visible[^{]*\{\s*outline:3px solid var\(--focus-ring\)/);
  assert.doesNotMatch(styles, /outline:\s*none/);
  // Stage and requirement states are never carried by color alone.
  assert.match(styles, /\.import-stage \.stage-status/);
  assert.match(styles, /\.mapping-requirement \.requirement-status/);
  // The mapping summary stays usable at small widths.
  assert.match(styles, /@media\(max-width:640px\)[\s\S]*\.import-stage\s*\{\s*flex:1 1 100%/);
});

// --- example data: one label everywhere, one action that clears it ----------

test("the entry action is one button beside the picker, with nothing to confirm", async () => {
  const doc = await page();
  const action = doc.getElementById("try-example-dataset");
  assert.ok(action, "a visitor with no export must have one thing to click");
  assert.equal(action.tagName, "BUTTON");
  assert.equal(action.getAttribute("type"), "button");
  assert.ok(tabSequence(doc).includes(action), "the entry action must be keyboard reachable");
  // One dataset, one action: exactly one entry control, and no chooser, wizard,
  // or confirm step anywhere in the import panel.
  assert.equal(doc.querySelectorAll(".local-example-action").length, 1);
  const html = await readFile(PAGE, "utf8");
  assert.doesNotMatch(html, /<dialog|example-scenario|example-dataset-picker/i);
});

// --- trust verdict ---------------------------------------------------------

const UNIT_A = "psn_flow_unit_alpha000001";
const UNIT_MISSING = "psn_flow_unit_absent00002";

function trustFixture(rows) {
  return trustVerdict({
    providers: [{
      export_id: "flow-export",
      snapshot: { period_start: "2026-06-01", period_end: "2026-07-01" },
      records: rows.map((row, index) => ({
        aggregate_id: `psn_flow_agg_${index}`,
        revision: 0,
        org_unit_id: row.unit,
        cost: { amount_minor: row.minor, currency: "USD", status: "final" },
      })),
    }],
    hris: {
      export_id: "flow-hris",
      records: [{ unit_id: UNIT_A, revision: 0, operation: "upsert", active: true }],
    },
  });
}

test("the trust verdict paints coverage with its numerator and denominator, never alone", async () => {
  const doc = await page();
  applyTrustVerdict(doc, trustFixture([
    { unit: UNIT_A, minor: 9_000 },
    { unit: UNIT_MISSING, minor: 1_000 },
  ]));
  const section = doc.getElementById("local-trust");
  assert.equal(section.hidden, false);
  assert.equal(section.dataset.state, "findings");
  assert.equal(normalized(doc.getElementById("local-trust-coverage")), "90.0%");
  const inputs = normalized(doc.getElementById("local-trust-inputs"));
  assert.match(inputs, /90\.00 USD attributed of 100\.00 USD total/);
  assert.match(inputs, /1 of 2 rows/);
});

test("a finding's per-row detail is built only when it is expanded", async () => {
  const doc = await page();
  applyTrustVerdict(doc, trustFixture([
    { unit: UNIT_A, minor: 9_000 },
    { unit: UNIT_MISSING, minor: 600 },
    { unit: UNIT_MISSING, minor: 400 },
  ]));
  const [item] = doc.querySelectorAll(".local-trust-finding");
  const button = item.querySelector(".local-trust-choice");
  const panel = doc.getElementById(button.getAttribute("aria-controls"));
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(panel.hidden, true);
  // Collapsed: provenance and the confidence rule only. No row list has been
  // grouped, so a large import pays nothing for detail nobody opened.
  assert.equal(panel.querySelectorAll(".local-trust-detail-rows").length, 0);
  button.click();
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(panel.hidden, false);
  const rows = panel.querySelectorAll("li");
  assert.equal(rows.length, 1);
  // The six-character tail, never the whole opaque id.
  assert.match(normalized(rows[0]), /…t00002/);
  assert.match(normalized(rows[0]), /10\.00 USD/);
  // No full opaque identifier reaches the DOM, expanded or not.
  assert.ok(!normalized(doc.getElementById("local-trust")).includes(UNIT_MISSING));
});

test("full coverage degrades to an all-clear, not to an empty shell", async () => {
  const doc = await page();
  applyTrustVerdict(doc, trustFixture([{ unit: UNIT_A, minor: 12_345 }]));
  const section = doc.getElementById("local-trust");
  assert.equal(section.dataset.state, "all_clear");
  assert.equal(normalized(doc.getElementById("local-trust-coverage")), "100.0%");
  assert.match(normalized(doc.getElementById("local-trust-inputs")), /123\.45 USD attributed/);
  assert.match(normalized(doc.getElementById("local-trust-answer")), /^Yes\./);
  // No findings section and no next action, and neither is left as a stub.
  assert.equal(doc.getElementById("local-trust-findings-section").hidden, true);
  assert.equal(doc.getElementById("local-trust-findings").querySelectorAll("li").length, 0);
  assert.equal(doc.getElementById("local-trust-next").hidden, true);
});

test("the one next action links back into the step that would close the gap", async () => {
  const doc = await page();
  applyTrustVerdict(doc, trustFixture([
    { unit: UNIT_A, minor: 1_000 },
    { unit: UNIT_MISSING, minor: 9_000 },
  ]));
  const next = doc.getElementById("local-trust-next");
  assert.equal(next.hidden, false);
  // Exactly one action, never a list of them.
  assert.equal(next.querySelectorAll(".local-trust-action").length, 1);
  const action = doc.getElementById("local-trust-action");
  assert.equal(action.dataset.available, "true");
  assert.match(normalized(action), /90\.00 USD/);
  const jump = doc.getElementById("local-trust-jump");
  assert.equal(jump.hidden, false);
  assert.equal(jump.dataset.step, "roster");
  jump.click();
  assert.equal(doc.activeElement, doc.getElementById("local-finops-files"));
});

test("an empty import shows no percentage at all", async () => {
  const doc = await page();
  applyTrustVerdict(doc, trustVerdict({ providers: [], hris: null }));
  assert.equal(doc.getElementById("local-trust").dataset.state, "empty");
  assert.equal(normalized(doc.getElementById("local-trust-coverage")), "No percentage");
  assert.doesNotMatch(normalized(doc.getElementById("local-trust")), /100(\.0)?%/);
});

test("every surface that renders analysis numbers carries the one provenance label", async () => {
  const doc = await page();
  const surfaces = doc.querySelectorAll("[data-analysis-surface]");
  assert.ok(surfaces.length >= 2, "the results brief and the leading finding both render envelope data");
  // The audit is mechanical: a surface that renders analysis numbers either
  // carries a provenance slot or it is a defect. Nothing is per-view copy.
  for (const surface of surfaces) {
    assert.ok(surface.querySelectorAll("[data-dataset-provenance]").length > 0
      || surface.getAttribute("data-dataset-provenance") !== null,
    `${surface.getAttribute("id")} renders analysis data with no provenance slot`);
  }

  const state = applyDatasetProvenance(doc, true);
  const notes = doc.querySelectorAll("[data-dataset-provenance]");
  assert.ok(notes.length >= 3);
  for (const note of notes) {
    assert.equal(note.hidden, false);
    assert.equal(note.getAttribute("data-dataset"), "example");
    // One string, repeated exactly: the label, and what to bring to replace it.
    assert.match(normalized(note), new RegExp(state.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(normalized(note), /v1 provider-usage JSON export/);
  }
  for (const surface of doc.querySelectorAll("[data-analysis-surface]"))
    assert.equal(surface.getAttribute("data-dataset"), "example");

  // The metric basis beside the headline number reads from the same copy, so
  // the number and the word for what kind of number it is cannot disagree.
  const basis = metricBasis({ mode: "example-dataset" });
  assert.equal(basis.real, false);
  assert.equal(basis.label, EXAMPLE_DATASET_PROVENANCE.label);
  assert.match(basis.detail, /v1 provider-usage JSON export/);
});

test("clearing example data leaves no residue in state, storage, or the URL", async () => {
  const doc = await page();
  applyDatasetProvenance(doc, true);
  applyLeadingFinding(doc, {
    available: true, question: "Why did spend rise in June 2026?",
    metric: "+39200.00 USD (+34%) versus May 2026",
    driverSentence: "Department …atlas0 contributed +34500.00 USD.",
    action: { available: true, text: "Pilot lower-cost routing." },
  });
  const finding = doc.getElementById("local-lead-finding");
  assert.equal(finding.hidden, false);
  assert.match(normalized(doc.getElementById("local-lead-question")), /June 2026/);

  // The one clearing action returns every labelled surface to a fresh state.
  applyDatasetProvenance(doc, false);
  for (const note of doc.querySelectorAll("[data-dataset-provenance]")) {
    assert.equal(note.hidden, true);
    assert.equal(normalized(note), "", "a cleared provenance note keeps no text");
    assert.equal(note.getAttribute("data-dataset"), "user");
  }
  for (const surface of doc.querySelectorAll("[data-analysis-surface]"))
    assert.equal(surface.getAttribute("data-dataset"), "user");

  // A reload can only resurrect the example if something wrote it down. Nothing
  // on this path has any writer: no storage, no cookie, no URL mutation.
  for (const module of [
    "../src/example-dataset.js", "../src/finops-leading-finding.js",
    "../src/local-import-flow.js", "../src/evolution-page.js",
  ]) {
    const source = await readFile(new URL(module, import.meta.url), "utf8");
    assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie|pushState|replaceState/,
      `${module} must not persist analysis state`);
  }
  // The one thing this page does write down is a leader's own display labels for
  // opaque org-unit identifiers — no number, no result, nothing that could put a
  // finding back on screen — and this same clearing action empties them, so
  // "clear" still means one thing here.
  const pageSource = await readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8");
  assert.match(pageSource, /clearModelOverspendFinding\(document, \{ storage: labelStorage\(\) \}\)/);
  // And the markup ships no example numbers of its own to fall back on.
  const html = await readFile(PAGE, "utf8");
  assert.doesNotMatch(html, /atlas0|39200|154500/);
});
