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
 *
 * WHAT #960 ADDED, AND WHY NONE OF IT IS IN THE DOCUMENT
 * -----------------------------------------------------
 * Every outcome state is now a CHIP off the shared vocabulary in
 * import-status-chip.js — a mark, a word and a value that survive each other —
 * rather than a sentence on a coloured left rule. The Claude Design foundations
 * card ("Chip inventory") reserves a filled wash for a dynamic signal and an
 * outline for a static classification; a recognition verdict is the former, so
 * these are `data-kind="signal"` chips and the tint is the fourth carrier, never
 * the first. The three states a reader can be in — reading, recognized,
 * refused — each get one.
 *
 * The result region's accessible name is extended here too, at the moment a
 * verdict lands: `#finops-stand` already ships `tabindex="-1"` and already
 * receives focus on a successful import (evolution-page.js), but it was named by
 * the page's standing question alone, so a reader landing on it was told nothing
 * about whose export it was computed from. Adding the recognized source line to
 * its `aria-labelledby` makes the landing announce "…AWS Bedrock · recognition
 * confidence 92 of 100 · your imported export". It is set at runtime rather than
 * authored, because before an import there is no source to name — and because
 * /evolution.html has 0.7 KiB of document budget and no bytes to spend on an
 * attribute that is wrong until a file arrives.
 *
 * Focus is NOT taken on a refusal. The page leaves it on the file control so the
 * reader can choose again, and nothing in here moves it.
 */
import {
  CONVERSATION_TRANSCRIPT_CONTRACT, describeUnrecognizedTranscript, detectConversationTranscript,
} from "./conversation-transcript-import.js";
import { describeDetection, detectAndNormalizeExport } from "./export-provider-detection.js";
import { ACCEPTED_MIN_CONFIDENCE } from "./export-recognition.js";
import { IMPORT_STATUS, importStatusChip, renderChip } from "./import-status-chip.js";

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
  reading: "Parsing in this tab. Nothing is uploaded.",
  unreadable: "This file could not be read in this browser, so nothing was analyzed. "
    + "Choose it again with the file control, or export it again and retry.",
});

/**
 * What the result region is named by once a verdict lands.
 *
 * The standing question first, then the recognized source — reading order, and
 * the order a reader arriving on the region needs them in: what this answers,
 * then whose numbers answered it.
 */
export const STAND_LABELLED_BY = "finops-stand-question finops-stand-import-source";

const byId = (doc, id) => doc.getElementById(id);

/**
 * One state, painted as chip + sentence into one node.
 *
 * The chip's mark is `aria-hidden` decoration; its label and value are read, so
 * a live region holding one announces "Recognized 92 of 100" before the sentence
 * and a reader who sees no colour has already been told the outcome twice.
 */
function paintState(doc, node, { status, confidence = null, sentence }) {
  const text = doc.createElement("span");
  text.className = "import-reason-text";
  text.textContent = sentence;
  node.replaceChildren(renderChip(doc, importStatusChip(status, { confidence })), text);
  node.hidden = false;
  return node;
}

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
    //
    // The reason is the recognition entry point's own sentence — "no cost or
    // amount column", "this file has no content", "two providers scored too
    // close" — so what the reader hears is what went wrong with THEIR file,
    // never a generic refusal. Focus stays where it was.
    reasonNode.dataset.state = "unrecognized";
    paintState(doc, reasonNode, {
      status: IMPORT_STATUS.REJECTED,
      sentence: reason ?? describeDetection(verdict),
    });
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
    // The display name beside the id, so a later reader of this region does not
    // have to keep a second provider-name table to say which console it was.
    region.dataset.detectedProviderName = verdict.displayName;
    region.dataset.detectedConfidence = String(verdict.confidence);
    region.dataset.provenance = IMPORT_PROVENANCE;
    // Whose briefing this is, in the region's own accessible name. The page
    // moves focus here on a successful import; without this the landing
    // announced the standing question and left the reader to find the source.
    region.setAttribute("aria-labelledby", STAND_LABELLED_BY);
  }
  // The same verdict in the live region, so the update is discoverable without
  // moving focus onto it. A recognition that did not clear the settled band is
  // still a result — it is painted with the mark and the word for an unsettled
  // one, and says what a reader does about it.
  const settled = verdict.confidence >= ACCEPTED_MIN_CONFIDENCE;
  reasonNode.dataset.state = "recognized";
  reasonNode.dataset.band = settled ? "settled" : "unsettled";
  paintState(doc, reasonNode, {
    status: settled ? IMPORT_STATUS.RECOGNIZED : IMPORT_STATUS.AMBIGUOUS,
    confidence: verdict.confidence,
    sentence: settled
      ? `${verdict.displayName} recognized. The finding below is now computed from `
        + `${IMPORT_PROVENANCE}.`
      : `${verdict.displayName} is the closest match, below the ${ACCEPTED_MIN_CONFIDENCE} `
        + `of 100 this page treats as settled. The finding below is computed from `
        + `${IMPORT_PROVENANCE}; open the supporting evidence before acting on it.`,
  });
  return true;
}

/**
 * Paint a recognized conversation transcript.
 *
 * A separate painter from the provider one, and deliberately narrower: it writes
 * the live region and nothing else. The result region's provenance datasets name
 * the console a *billing* figure came from, and a transcript produces a literacy
 * grade rather than a cost figure, so labelling the stand with it would caption
 * one answer with another answer's source.
 */
export function renderImportConversation(doc, detected) {
  const reasonNode = byId(doc, IMPORT_DROP_IDS.reason);
  if (!reasonNode || !detected?.shape) return false;
  reasonNode.dataset.state = "recognized-conversation";
  reasonNode.dataset.transcriptShape = detected.shape;
  paintState(doc, reasonNode, {
    status: IMPORT_STATUS.RECOGNIZED,
    sentence: `${detected.label} recognized from this file's own structure `
      + `(contract ${CONVERSATION_TRANSCRIPT_CONTRACT}): ${detected.observed}. It is read into the `
      + "AI-literacy grade below. Message and prompt text is measured and discarded in the parser; "
      + "none of it is kept.",
  });
  return true;
}

/**
 * The reading state, in the drop target's own state line.
 *
 * Not in the live region: the answer block already announces "Reading files in
 * this tab…" when the handler starts, and a second region saying the same thing
 * is a queue rather than an answer. This line is `aria-hidden` markup that
 * exists to be SEEN — the same slot the drag state uses, because both are
 * transient states of the affordance rather than outcomes of an import.
 */
export function renderImportReading(doc, active) {
  const state = byId(doc, IMPORT_DROP_IDS.state);
  if (!state) return null;
  if (!active) {
    state.textContent = "";
    return state;
  }
  return paintState(doc, state, {
    status: IMPORT_STATUS.LOADING, sentence: IMPORT_DROP_COPY.reading,
  });
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
  let firstTranscript = null;
  let lastText = "";
  try {
    for (const file of files) {
      let text = null;
      try {
        text = await file.text();
      } catch {
        renderImportRecognition(doc, null, { reason: IMPORT_DROP_COPY.unreadable });
        return false;
      }
      lastText = text;
      const verdict = detectAndNormalizeExport(text);
      firstVerdict ??= verdict;
      if (verdict.provider) return renderImportRecognition(doc, verdict);
      // The other kind of export this one control accepts. Asked only after the
      // provider question, and from the same bytes: a billing export carries no
      // nested turns and no message events, so the order changes no verdict.
      const transcript = detectConversationTranscript(text);
      if (transcript.shape) firstTranscript ??= transcript;
    }
    if (firstTranscript) return renderImportConversation(doc, firstTranscript);
    // Not a provider export and not a transcript. The refusal names both: the
    // provider reason the recognition entry point gave, and the two conversation
    // shapes with the fields each requires.
    return renderImportRecognition(doc, firstVerdict, {
      reason: `${describeDetection(firstVerdict)} ${describeUnrecognizedTranscript(lastText)}`,
    });
  } finally {
    // Every exit, including the refusal returns above: a reading state left
    // standing over a painted verdict says the page is still working on a file
    // it has already answered for.
    renderImportReading(doc, false);
  }
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
    renderImportReading(doc, true);
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
