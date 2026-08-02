/**
 * ONE import affordance for /evolution.html (#958).
 *
 * The page used to ask three separate provider sub-questions about the same
 * export — which console it came from, whether it was eligible, and which
 * bundled example it resembled — each behind its own file control. There is now
 * one: a drop zone that is also the browse control, and the whole page body is
 * the drop target.
 *
 * Two properties this module exists to guarantee:
 *
 *   1. DROP AND BROWSE ARE ONE HANDLER. `bindImportDrop` owns the file control's
 *      `change` registration and the document-level `drop`, and both call the
 *      SAME `onFiles` the page passed in. Drag and drop is an additive layer:
 *      remove every drag event from the browser and the file control still
 *      completes the identical import.
 *   2. A REFUSAL NEVER BLANKS A RESULT. An unrecognized file paints the reason
 *      named by the recognition entry point (#957) into a live region that was
 *      in the document before the drag started. Nothing in here writes to the
 *      lead finding on that path, so the reading a visitor already has stays on
 *      screen — including a previous reader's own imported result.
 *
 * No provider is named in this file. Which console a file came from is
 * `detectAndNormalizeExport`'s answer, taken from the file's own columns.
 */
import { describeDetection, detectAndNormalizeExport } from "./export-provider-detection.js";

export const IMPORT_DROP_IDS = Object.freeze({
  input: "local-finops-files",
  zone: "finops-import-drop",
  state: "finops-import-drop-state",
  reason: "finops-import-reason",
  source: "finops-stand-import-source",
  region: "finops-stand",
});

/** The provenance wording the lead finding carries once it is the reader's. */
export const IMPORT_PROVENANCE = "your imported export";

export const IMPORT_DROP_COPY = Object.freeze({
  dragging: "Drop to import",
  unreadable: "This file could not be read in this browser, so nothing was analyzed. "
    + "Choose it again with the file control, or export it again and retry.",
});

const byId = (doc, id) => doc.getElementById(id);

/**
 * Paint one recognition verdict.
 *
 * @returns true when the verdict is a recognized provider, so a caller can tell
 *          the two outcomes apart without re-reading the verdict.
 */
export function renderImportRecognition(doc, verdict, { reason = null } = {}) {
  const reasonNode = byId(doc, IMPORT_DROP_IDS.reason);
  const source = byId(doc, IMPORT_DROP_IDS.source);
  if (!reasonNode || !source) return false;
  const recognized = Boolean(verdict?.provider);

  if (!recognized) {
    // The named reason and nothing else. The lead finding below is deliberately
    // untouched: a reader who imported successfully a minute ago keeps their
    // figures, and a reader who never has keeps the bundled example.
    reasonNode.dataset.state = "unrecognized";
    reasonNode.textContent = reason ?? describeDetection(verdict);
    reasonNode.hidden = false;
    return false;
  }

  source.dataset.source = "import";
  source.dataset.provider = verdict.provider;
  source.dataset.confidence = String(verdict.confidence);
  // Provider and confidence in the result region itself, visible on arrival:
  // not in a disclosure, because a closed one hides them from a real browser
  // whatever a test harness reads through it.
  source.textContent = `${verdict.displayName} · recognition confidence `
    + `${verdict.confidence} of 100 · ${IMPORT_PROVENANCE}`;
  source.hidden = false;
  const region = byId(doc, IMPORT_DROP_IDS.region);
  if (region) {
    region.dataset.detectedProvider = verdict.provider;
    region.dataset.detectedConfidence = String(verdict.confidence);
    region.dataset.provenance = IMPORT_PROVENANCE;
  }
  // The same sentence in the live region, so the update is discoverable without
  // moving focus onto it.
  reasonNode.dataset.state = "recognized";
  reasonNode.textContent = `${verdict.displayName} recognized at ${verdict.confidence} of 100. `
    + `The finding below is now computed from ${IMPORT_PROVENANCE}.`;
  reasonNode.hidden = false;
  return true;
}

/**
 * Recognize one batch, from the file content alone.
 *
 * The control accepts supporting files beside a provider export — an org
 * mapping, a query sample, a delivery history — so a batch is recognized when
 * ANY file in it is, and only a batch with no recognizable export at all paints
 * a refusal.
 */
async function recognizeBatch(doc, files) {
  let firstVerdict = null;
  for (const file of files) {
    let text = null;
    try {
      text = await file.text();
    } catch {
      renderImportRecognition(doc, null, { reason: IMPORT_DROP_COPY.unreadable });
      return false;
    }
    const verdict = detectAndNormalizeExport(text);
    firstVerdict ??= verdict;
    if (verdict.provider) return renderImportRecognition(doc, verdict);
  }
  return renderImportRecognition(doc, firstVerdict);
}

/**
 * Wire the one import affordance.
 *
 * @param onFiles the page's import handler. Called with the chosen files on
 *                BOTH paths and never wrapped differently on one of them.
 */
export function bindImportDrop(doc, onFiles) {
  const input = byId(doc, IMPORT_DROP_IDS.input);
  const zone = byId(doc, IMPORT_DROP_IDS.zone);
  if (!input || typeof onFiles !== "function") return false;

  const accept = (chosen) => {
    const files = [...(chosen ?? [])];
    if (!files.length) return undefined;
    // The import starts on the SAME TICK it always did — the panel's busy state
    // is set synchronously by the handler below, and a recognition pass awaited
    // in front of it would move that state a microtask later and change what a
    // caller sees immediately after the event. Recognition paints beside it.
    const running = onFiles(files);
    void recognizeBatch(doc, files);
    return running;
  };

  input.addEventListener("change", () => accept(input.files));

  const state = byId(doc, IMPORT_DROP_IDS.state);
  const dragging = (active) => {
    const value = String(active);
    if (zone) zone.dataset.dragging = value;
    if (doc.body) doc.body.dataset.importDragging = value;
    // Words, not a tint: the active state has to survive a high-contrast theme,
    // a printed page and a reader who cannot tell the border colours apart.
    if (state) state.textContent = active ? IMPORT_DROP_COPY.dragging : "";
  };

  // The whole page is the target. `preventDefault` on dragover is what stops the
  // browser navigating away to the dropped file, which would end the session.
  const target = doc.body ?? doc;
  target.addEventListener("dragover", (event) => {
    event.preventDefault?.();
    dragging(true);
  });
  target.addEventListener("dragleave", () => dragging(false));
  target.addEventListener("drop", (event) => {
    event.preventDefault?.();
    dragging(false);
    return accept(event.dataTransfer?.files ?? null);
  });
  return true;
}
