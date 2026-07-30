// Reading-experience regression for the column-review step.
//
// Every assertion drives the shipped markup — src/evolution.html parsed by the
// same harness the import-flow suite uses — rather than a fixture authored for
// the test. What it pins is what a leader has to be able to do: see every one of
// their own columns with a real value from it, correct one, be told in product
// terms what an unmapped field costs them, be stopped before two columns claim
// one field, come back to their own choices, and never have a string out of
// their file rendered as anything but text.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DomEvent, parseHtml, textOf } from "./support/browser.js";
import { readDelimitedText } from "../src/delimited-text.js";
import { detectShape } from "../src/finops-tabular-import.js";
import {
  IGNORED_TARGET, createColumnMapping, mappingIssues, setColumnTarget,
} from "../src/import-column-mapping.js";
import {
  closeMappingReview, focusMappingReview, renderMappingReview,
} from "../src/import-mapping-view.js";
import { applyDatasetProvenance, userDatasetProvenance } from "../src/local-import-flow.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

const OPENAI_CSV = [
  "date,project_name,model,n_context_tokens_total,n_generated_tokens_total,amount,currency",
  "2026-07-24,Atlas Platform,gpt-4o-mini,120000,18000,42.55,USD",
  "2026-07-25,Cinder Design,dall-e-3,0,0,7.05,USD",
].join("\n");

const UNKNOWN_CSV = [
  "Buchungstag,Kostenstelle,Sprachmodell,Betrag",
  "2026-07-24,Atlas Platform,gpt-4o-mini,42.55",
].join("\n");

async function page() {
  return parseHtml(await readFile(PAGE, "utf8"));
}

function mappingFor(text, fileName = "export.csv") {
  const reading = readDelimitedText(text);
  return createColumnMapping({ reading, fileName, detection: detectShape(reading.header) });
}

/**
 * Mount the step the way the page mounts it: the caller owns the state, every
 * correction repaints. Returns a live handle so a test can "use" the surface.
 */
function mount(doc, initial) {
  const handle = { state: initial };
  const paint = () => renderMappingReview(doc, handle.state, {
    onTarget: (index, target) => { handle.state = setColumnTarget(handle.state, index, target); paint(); },
    onKind: () => {},
    onConfirm: () => { handle.confirmed = (handle.confirmed ?? 0) + 1; },
    onCancel: () => { handle.cancelled = true; },
  });
  paint();
  handle.repaint = paint;
  handle.rows = () => doc.querySelectorAll(".import-mapping-row");
  handle.select = (index) => doc.getElementById(`import-mapping-target-${index}`);
  handle.choose = (index, value) => {
    const select = handle.select(index);
    select.value = value;
    select.dispatchEvent(new DomEvent("change", { bubbles: true }));
  };
  return handle;
}

const values = (nodes) => nodes.map((node) => textOf(node));

// --- structure and pre-filled state ----------------------------------------

test("the step is a real table, in file order, with a value from the reader's own data", async () => {
  const doc = await page();
  const view = mount(doc, mappingFor(OPENAI_CSV, "july-usage.csv"));
  assert.equal(doc.getElementById("import-mapping").hidden, false);
  assert.equal(textOf(doc.getElementById("import-mapping-file")), "july-usage.csv");

  // Tabular data in a table: column headers scoped as columns, each row's own
  // header cell scoped as a row. Not divs pretending.
  const table = doc.querySelector(".import-mapping-table");
  assert.deepEqual(
    table.querySelectorAll("th[scope=col]").map((cell) => textOf(cell)),
    ["Your column", "Becomes", "Proposal", "Sample from your file"],
  );
  const rows = view.rows();
  assert.equal(rows.length, 7);
  assert.equal(rows[0].querySelector("th").getAttribute("scope"), "row");
  assert.deepEqual(
    values(doc.querySelectorAll(".import-mapping-column-name")),
    ["date", "project_name", "model", "n_context_tokens_total", "n_generated_tokens_total", "amount", "currency"],
  );
  assert.equal(view.select(1).value, "orgUnit");
  assert.equal(textOf(doc.getElementById("import-mapping-sample-1")), "Atlas Platform");

  // Proposed versus unset is a word, never only a tint.
  assert.deepEqual(new Set(values(doc.querySelectorAll(".import-mapping-origin-word"))), new Set(["Auto-detected"]));
  assert.match(textOf(doc.getElementById("import-mapping-caption")), /7 columns in file order/);
  assert.equal(doc.getElementById("import-mapping-confirm").disabled, false);
  assert.equal(doc.getElementById("import-mapping-blockers").hidden, true);
});

test("every control names the column it belongs to and is bound to its own message", async () => {
  const doc = await page();
  const view = mount(doc, mappingFor(OPENAI_CSV, "july-usage.csv"));
  const names = doc.querySelectorAll(".import-mapping-select").map((select) => select.getAttribute("aria-label"));
  assert.equal(new Set(names).size, 7, "a page of identically-named selects is a failure");
  assert.equal(names[3], "Column 4 “n_context_tokens_total” becomes");
  // Every option is reachable, including the explicit way to map nothing.
  assert.deepEqual(view.select(0).options[0].getAttribute("value"), IGNORED_TARGET);
  assert.equal(textOf(view.select(0).options[0]), "Ignore this column");
  assert.match(textOf(view.select(0).options[1]), /Usage date \(required\)/);
  // Clean state: described by its own sample cell, not by an error.
  assert.equal(view.select(0).getAttribute("aria-invalid"), "false");
  assert.equal(view.select(0).getAttribute("aria-describedby"), "import-mapping-sample-0");
});

// --- nothing detected ------------------------------------------------------

test("with nothing detected the step is unset, callouts are concrete, and it still completes", async () => {
  const doc = await page();
  const view = mount(doc, mappingFor(UNKNOWN_CSV, "kosten.csv"));
  assert.equal(doc.getElementById("import-mapping").dataset.detected, "none");
  assert.deepEqual(new Set(values(doc.querySelectorAll(".import-mapping-origin-word"))), new Set(["Not detected"]));
  assert.match(textOf(doc.getElementById("import-mapping-kind-note")), /No export shape was recognized/);
  assert.equal(doc.getElementById("import-mapping-confirm").disabled, true);

  const blockers = doc.getElementById("import-mapping-blockers");
  assert.equal(blockers.hidden, false);
  assert.equal(blockers.dataset.count, "4");
  const text = textOf(blockers);
  assert.match(text, /No column becomes Cost amount/);
  assert.match(text, /headline number and the recoverable scenario cannot be computed/);
  assert.doesNotMatch(text, /required field missing/i);

  // Mapped by hand, the same step completes: not a dead end.
  view.choose(0, "date");
  view.choose(1, "orgUnit");
  view.choose(2, "model");
  view.choose(3, "amount");
  assert.equal(doc.getElementById("import-mapping-confirm").disabled, false);
  assert.deepEqual(values(doc.querySelectorAll(".import-mapping-origin-word")), Array(4).fill("Your choice"));
  assert.match(textOf(doc.getElementById("import-mapping-status")), /Ready to run the analysis/);
  doc.getElementById("import-mapping-confirm").click();
  assert.equal(view.confirmed, 1);
});

test("what an unmapped optional field costs is offered without blocking", async () => {
  const doc = await page();
  const view = mount(doc, mappingFor(UNKNOWN_CSV, "kosten.csv"));
  view.choose(0, "date");
  view.choose(1, "orgUnit");
  view.choose(2, "model");
  view.choose(3, "amount");
  const warnings = doc.getElementById("import-mapping-warnings");
  assert.equal(warnings.hidden, false);
  assert.match(textOf(warnings), /You can continue; here is what the analysis will not have/);
  assert.match(textOf(warnings), /Every row is read as USD/);
  assert.equal(doc.getElementById("import-mapping-confirm").disabled, false);
});

// --- duplicates and corrections --------------------------------------------

test("a duplicate target is announced, bound to both controls, and gates confirmation", async () => {
  const doc = await page();
  const view = mount(doc, mappingFor(OPENAI_CSV, "july-usage.csv"));
  view.choose(4, "amount");

  assert.equal(doc.getElementById("import-mapping-confirm").disabled, true);
  for (const index of [4, 5]) {
    const select = view.select(index);
    assert.equal(select.getAttribute("aria-invalid"), "true");
    assert.equal(select.getAttribute("aria-describedby"), `import-mapping-message-${index}`);
    const message = doc.getElementById(`import-mapping-message-${index}`);
    assert.equal(message.hidden, false);
    assert.match(textOf(message), /Column 5 and Column 6 both become Cost amount/);
  }
  // And announced on change, not only drawn next to the control.
  assert.match(textOf(doc.getElementById("import-mapping-status")), /1 thing must be resolved first/);

  // Resolving it clears both the message and the gate.
  view.choose(4, IGNORED_TARGET);
  assert.equal(doc.getElementById("import-mapping-confirm").disabled, false);
  assert.equal(view.select(5).getAttribute("aria-invalid"), "false");
  assert.equal(doc.getElementById(`import-mapping-message-4`).hidden, true);
});

// --- back, and leaving -----------------------------------------------------

test("re-entering the step keeps the reader's corrections, not the auto-detected default", async () => {
  const doc = await page();
  const view = mount(doc, mappingFor(OPENAI_CSV, "july-usage.csv"));
  view.choose(3, IGNORED_TARGET);
  view.choose(6, IGNORED_TARGET);
  const edited = view.state;

  // Leaving discards the surface — the reader's rows and samples do not outlive
  // the step — but the state the page holds is untouched.
  closeMappingReview(doc);
  assert.equal(doc.getElementById("import-mapping").hidden, true);
  assert.equal(doc.querySelectorAll(".import-mapping-row").length, 0);
  assert.equal(textOf(doc.getElementById("import-mapping-status")), "");

  const returned = mount(doc, edited);
  assert.equal(returned.select(3).value, IGNORED_TARGET);
  assert.equal(returned.select(6).value, IGNORED_TARGET);
  assert.equal(returned.select(1).value, "orgUnit");
  assert.deepEqual(
    values(doc.querySelectorAll(".import-mapping-origin-word")).slice(3, 4), ["Your choice"],
  );
});

test("entering the step moves focus to it, and cancelling is always available", async () => {
  const doc = await page();
  const view = mount(doc, mappingFor(UNKNOWN_CSV, "kosten.csv"));
  const heading = focusMappingReview(doc);
  assert.equal(heading, doc.getElementById("import-mapping-title"));
  assert.equal(heading.getAttribute("tabindex"), "-1");
  assert.equal(doc.activeElement, heading);

  // The step gates confirmation, never the exit: a file that can never be
  // mapped must still be abandonable.
  assert.equal(doc.getElementById("import-mapping-confirm").disabled, true);
  const cancel = doc.getElementById("import-mapping-cancel");
  assert.equal(cancel.disabled, false);
  cancel.click();
  assert.equal(view.cancelled, true);
});

// --- untrusted text --------------------------------------------------------

test("a hostile header and a hostile sample render as literal text everywhere", async () => {
  const doc = await page();
  const hostile = "<img src=x onerror=alert(1)>";
  const payload = "</td><script>alert(2)</script>";
  const state = mappingFor(`date,${hostile}\n2026-07-24,${payload}`, `${hostile}.csv`);
  const view = mount(doc, state);

  const name = doc.querySelectorAll(".import-mapping-column-name")[1];
  assert.equal(name.textContent, hostile);
  assert.equal(name.title, hostile);
  assert.equal(name.querySelectorAll("img").length, 0);
  assert.equal(view.select(1).getAttribute("aria-label"), `Column 2 “${hostile}” becomes`);

  const sample = doc.getElementById("import-mapping-sample-1");
  assert.equal(textOf(sample), payload);
  assert.equal(sample.querySelectorAll("script").length, 0);
  assert.equal(sample.querySelector(".import-mapping-sample-value").title, payload);

  // The file name travels the same way, and no announcement carries markup.
  assert.equal(doc.getElementById("import-mapping-file").textContent, `${hostile}.csv`);
  assert.equal(doc.getElementById("import-mapping-status").querySelectorAll("img").length, 0);

  // The surface never has a markup sink to reach in the first place.
  for (const module of ["../src/import-mapping-view.js", "../src/import-column-mapping.js"]) {
    const source = await readFile(new URL(module, import.meta.url), "utf8");
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);
  }
});

// --- provenance ------------------------------------------------------------

test("the reader's own file names replace the example caption on every figure", async () => {
  const doc = await page();
  const provenance = userDatasetProvenance({
    files: ["july-usage.csv", "roster.csv"], rows: 412, shapes: ["OpenAI usage export"],
  });
  applyDatasetProvenance(doc, false, provenance);

  const notes = doc.querySelectorAll("[data-dataset-provenance]");
  assert.ok(notes.length >= 4, "every surface that renders numbers carries the label");
  for (const note of notes) {
    assert.equal(note.hidden, false);
    assert.equal(note.getAttribute("data-dataset"), "user");
    assert.match(textOf(note), /Your data — july-usage\.csv, roster\.csv/);
    assert.match(textOf(note), /412 rows read in this tab and mapped by you/);
    assert.match(textOf(note), /Read as OpenAI usage export/);
    assert.doesNotMatch(textOf(note), /Example data/);
  }
  for (const surface of doc.querySelectorAll("[data-analysis-surface]"))
    assert.equal(surface.getAttribute("data-dataset"), "user");

  // Abandoning returns every one of them to the example baseline.
  applyDatasetProvenance(doc, true);
  for (const note of doc.querySelectorAll("[data-dataset-provenance]")) {
    assert.match(textOf(note), /Example data — not your data/);
    assert.doesNotMatch(textOf(note), /july-usage\.csv/);
  }
});

// --- the page wiring -------------------------------------------------------

test("the page runs the shipped analysis on the confirmed mapping and can abandon it", async () => {
  const [script, styles] = await Promise.all([
    readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution.css", import.meta.url), "utf8"),
  ]);
  // Confirming runs the shipped normalizer with the reviewed binding — there is
  // no second analysis path, and no parse of a delimited file without one.
  assert.match(script,
    /const options = boundedDelimitedOptions\(\{ mapping: binding \}\);[\s\S]*parseLocalImportFile\(file\.text, file\.fileName, file\.mediaType, options\)/);
  assert.match(script, /sampleOversized: true/);
  assert.match(script, /normalizeLocalFinopsHistory\(\{\s*providers: loaded\.providers/);
  // Back into the step re-uses the retained text and the reader's own state.
  assert.match(script, /remap\?\.addEventListener\("click"/);
  assert.match(script, /entry\?\.state \?\? createColumnMapping/);
  // Abandoning clears the queued files, the retained text, and the choices.
  assert.match(script, /imports\.length = 0;\s*\n\s*queue = \[\];\s*\n\s*review = null;/);
  assert.match(script, /closeMappingReview\(document\)/);
  assert.doesNotMatch(script, /innerHTML|outerHTML|document\.write/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|indexedDB/);
  // Narrow widths stack the row instead of scrolling a wide table sideways.
  assert.match(styles, /@media\(max-width:640px\)[\s\S]*\.import-mapping-table td\[data-label\]::before/);
  assert.match(styles, /\.import-mapping select:focus-visible/);
});
