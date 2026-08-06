// The two download controls the recipe rows carry (#1167), painted onto the
// recipe list the import panel already shows.
//
// WHY THIS IS A SEPARATE MODULE AND WHY IT IS DEFERRED. Nothing here is needed
// to read the page: a template and a sample are bytes a reader asks for, and the
// generator that emits them is the definition of code that can arrive on demand.
// It is reached by a native `import()` in the page entry, so neither this file
// nor `import-sample-files.js` is in the first-screen module graph — the same
// deferral the provider projection on this page already uses, and the reason
// this change costs the initial payload nothing.
//
// NO STRING A READER ACTS ON IS AUTHORED HERE except the two verbs. The adapter
// name, the column count, the row count, the period and the figure the sample
// imports as all come from `import-sample-files.js`, which reads them from the
// intake contract. NO CSS RULE IS ADDED: the row paragraph reuses
// `.import-slot-unlocks` and both buttons reuse `.provider-readiness-download`,
// which this page already ships for the readiness samples.
//
// The caller passes its own download helper rather than this module building a
// Blob: there is one object-URL routine on this page and a second one here would
// be a second answer to how a local file leaves the tab.

import {
  IMPORT_SAMPLE_FILES, importSampleFileById,
} from "./import-sample-files.js";

/** The two artifacts a row offers, as the value the button carries. */
export const SAMPLE_DOWNLOAD_KINDS = Object.freeze({ blank: "blank", sample: "sample" });

/** Said once, so the button text and the test cannot word the offer differently. */
export function downloadLabel(file, kind) {
  return kind === SAMPLE_DOWNLOAD_KINDS.blank
    ? `Download a blank CSV template · ${file.columns.length} columns, no rows`
    : `Download a worked ${file.sampleRowCount}-row sample · imports as `
      + `${file.documentedTotalLabel} across ${file.documentedPeriodLabel}`;
}

/** The exact bytes and file name a kind hands the reader. */
export function downloadPayload(file, kind) {
  return kind === SAMPLE_DOWNLOAD_KINDS.blank
    ? { text: file.blankTemplate, fileName: file.blankFilename }
    : { text: file.workedSample, fileName: file.sampleFilename };
}

function button(doc, file, kind) {
  const node = doc.createElement("button");
  node.type = "button";
  node.className = "provider-readiness-download";
  node.dataset.adapter = file.adapter;
  node.dataset.sampleKind = kind;
  node.textContent = downloadLabel(file, kind);
  return node;
}

/**
 * Append a template control and a sample control to every painted recipe row.
 *
 * The rows are found by the id `mountImportRecipes` already gives them, one
 * lookup per adapter — a descendant selector would be the obvious way and is not
 * available in the harness this page is tested through. A row that is not on the
 * page (a recipe that supplies the query sample rather than spend) is skipped
 * rather than invented: this contract emits provider CSV, and a control offering
 * a template for a file shape it cannot generate is worse than no control.
 *
 * @returns how many rows gained controls, so a caller can assert it mounted.
 */
export function mountImportSampleDownloads(list, download) {
  if (!list || typeof download !== "function") return 0;
  if (list.dataset.sampleDownloads === "mounted") return 0;
  const doc = list.ownerDocument;
  let mounted = 0;
  for (const file of IMPORT_SAMPLE_FILES) {
    const row = doc.getElementById(`import-recipe-${file.adapter}`);
    if (!row) continue;
    const line = doc.createElement("p");
    line.className = "import-slot-unlocks";
    line.dataset.kind = "sample-downloads";
    line.append(button(doc, file, SAMPLE_DOWNLOAD_KINDS.blank),
      button(doc, file, SAMPLE_DOWNLOAD_KINDS.sample));
    row.append(line);
    mounted += 1;
  }
  if (!mounted) return 0;
  list.dataset.sampleDownloads = "mounted";
  // One delegated handler rather than six: the list is painted once, and a file
  // is serialized only when a reader actually asks for one.
  list.addEventListener("click", (event) => {
    const control = event.target?.closest?.(".provider-readiness-download");
    const file = importSampleFileById(control?.dataset.adapter);
    if (!file || !control.dataset.sampleKind) return;
    const payload = downloadPayload(file, control.dataset.sampleKind);
    download(payload.text, file.mediaType, payload.fileName);
  });
  return mounted;
}
