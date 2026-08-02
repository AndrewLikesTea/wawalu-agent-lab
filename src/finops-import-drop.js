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
 * #960 adds the keyboard and screen-reader half of the same journey, and the
 * three properties it turns on are worth naming beside the two above:
 *
 *   3. THE AFFORDANCE IS A CONTROL, NOT A SURFACE. The browse button below is a
 *      real button in the tab order that opens the same file control the label
 *      opens, so Enter and Space complete an import with no pointer and no drag
 *      event anywhere. Dropping stays what it always was: an addition.
 *   4. THE OUTCOME IS SPOKEN WHERE IT IS DRAWN. One polite live region, in the
 *      document from first paint and outside every disclosure, carries the
 *      provider AND the confidence on success and the recognition entry point's
 *      OWN reason on refusal — never a generic failure.
 *   5. FOCUS LANDS ON THE READER'S OWN RESULT. A recognized import moves focus
 *      to the lead finding, whose accessible name is extended to say whose
 *      briefing it now is: the provider, the confidence, and the file it came
 *      from, not "Results".
 */
import { describeDetection, detectAndNormalizeExport } from "./export-provider-detection.js";

export const IMPORT_DROP_IDS = Object.freeze({
  input: "local-finops-files",
  browse: "finops-import-browse",
  zone: "finops-import-drop",
  state: "finops-import-drop-state",
  reason: "finops-import-reason",
  source: "finops-stand-import-source",
  owner: "finops-stand-owner",
  question: "finops-stand-question",
  region: "finops-stand",
});

/** The provenance wording the lead finding carries once it is the reader's. */
export const IMPORT_PROVENANCE = "your imported export";

export const IMPORT_DROP_COPY = Object.freeze({
  dragging: "Drop to import",
  reading: "Reading your file",
  unreadable: "This file could not be read in this browser, so nothing was analyzed. "
    + "Choose it again with the file control, or export it again and retry.",
  recognizedChip: "Recognized",
  refusedChip: "Not recognized",
});

/**
 * How sure the recognition was, as a word and a silhouette.
 *
 * The confidence number ships beside these, so the tier never has to be read off
 * a tint: the page's status family is the circle (`◌ ○ ◔ ◐ ●`), and a fuller
 * circle is a surer reading. A tier that only changed the border colour would
 * leave "92 of 100" and "31 of 100" identical to a reader who cannot separate
 * green from amber.
 */
export const CONFIDENCE_TIERS = Object.freeze([
  Object.freeze({ floor: 85, tier: "high", word: "high confidence", shape: "●" }),
  Object.freeze({ floor: 60, tier: "moderate", word: "moderate confidence", shape: "◐" }),
  Object.freeze({ floor: 0, tier: "low", word: "low confidence", shape: "◔" }),
]);

export const confidenceTier = (confidence) =>
  CONFIDENCE_TIERS.find((entry) => Number(confidence) >= entry.floor) ?? CONFIDENCE_TIERS.at(-1);

const byId = (doc, id) => doc.getElementById(id);

/**
 * A file name a heading can hold.
 *
 * An export named by a build system can run to hundreds of characters, and an
 * accessible name that long is read out in full before the reader hears their
 * own figures. The visible line wraps (`overflow-wrap:anywhere` in the panel's
 * own rule); the spoken one is clipped here, with the ellipsis kept so nobody
 * mistakes the clipped name for the whole one.
 */
export function clampName(name, limit = 64) {
  const text = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/** Paint one chip — a shape, then the word that would stand without it. */
function paintChip(doc, node, { outcome, shape, label, sentence }) {
  node.replaceChildren();
  const chip = doc.createElement("span");
  chip.className = "import-reason-chip";
  chip.dataset.outcome = outcome;
  const mark = doc.createElement("span");
  mark.className = "import-reason-shape";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = shape;
  chip.append(mark, doc.createTextNode(` ${label}`));
  const said = doc.createElement("span");
  said.className = "import-reason-text";
  said.textContent = sentence;
  node.append(chip, doc.createTextNode(" "), said);
}

/**
 * Paint one recognition verdict.
 *
 * @returns true when the verdict is a recognized provider, so a caller can tell
 *          the two outcomes apart without re-reading the verdict.
 */
export function renderImportRecognition(doc, verdict, { reason = null, fileName = "" } = {}) {
  const reasonNode = byId(doc, IMPORT_DROP_IDS.reason);
  const source = byId(doc, IMPORT_DROP_IDS.source);
  if (!reasonNode || !source) return false;
  const recognized = Boolean(verdict?.provider);
  const zone = byId(doc, IMPORT_DROP_IDS.zone);

  if (!recognized) {
    // The named reason and nothing else. The lead finding below is deliberately
    // untouched: a reader who imported successfully a minute ago keeps their
    // figures, and a reader who never has keeps the bundled example.
    //
    // Focus does not move on this path either. A refusal is read where the
    // reader already is — beside the control they will use again — and dragging
    // them to a result that did not change would be a lie about what happened.
    reasonNode.dataset.state = "unrecognized";
    paintChip(doc, reasonNode, {
      outcome: "unrecognized",
      shape: "○",
      label: IMPORT_DROP_COPY.refusedChip,
      sentence: reason ?? describeDetection(verdict),
    });
    reasonNode.hidden = false;
    if (zone) zone.dataset.state = "refused";
    return false;
  }

  const tier = confidenceTier(verdict.confidence);
  source.dataset.source = "import";
  source.dataset.provider = verdict.provider;
  source.dataset.confidence = String(verdict.confidence);
  source.dataset.confidenceTier = tier.tier;
  // Provider and confidence in the result region itself, visible on arrival:
  // not in a disclosure, because a closed one hides them from a real browser
  // whatever a test harness reads through it. The tier is a word beside the
  // number, so neither one depends on the tint the panel draws behind it.
  source.textContent = `${verdict.displayName} · recognition confidence `
    + `${verdict.confidence} of 100 · ${tier.word} · ${IMPORT_PROVENANCE}`;
  source.hidden = false;
  const region = byId(doc, IMPORT_DROP_IDS.region);
  if (region) {
    region.dataset.detectedProvider = verdict.provider;
    region.dataset.detectedConfidence = String(verdict.confidence);
    region.dataset.provenance = IMPORT_PROVENANCE;
  }
  // WHOSE BRIEFING THIS IS, in the region's own accessible name. Arriving here
  // used to announce "Where do we stand on AI spend?" — the same words a reader
  // who imported nothing hears. The owner line is prepended rather than
  // substituted, so the question the region answers is still the second thing
  // spoken.
  const owner = byId(doc, IMPORT_DROP_IDS.owner);
  const named = clampName(fileName);
  if (owner && region) {
    owner.textContent = `Your ${verdict.displayName} briefing, recognized at `
      + `${verdict.confidence} of 100 — ${tier.word}`
      + `${named ? `, from ${named}` : ""}.`;
    region.setAttribute("aria-labelledby", `${IMPORT_DROP_IDS.owner} ${IMPORT_DROP_IDS.question}`);
  }
  // The same sentence in the live region, so the update is discoverable without
  // moving focus onto it — and then focus moves anyway, because the reader asked
  // for a result and the result is somewhere else on the page.
  reasonNode.dataset.state = "recognized";
  paintChip(doc, reasonNode, {
    outcome: "recognized",
    shape: tier.shape,
    label: IMPORT_DROP_COPY.recognizedChip,
    sentence: `${verdict.displayName} recognized at ${verdict.confidence} of 100 — ${tier.word}. `
      + `The finding below is now computed from ${IMPORT_PROVENANCE}.`,
  });
  reasonNode.hidden = false;
  if (zone) zone.dataset.state = "imported";
  region?.focus?.();
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
  let firstName = "";
  for (const file of files) {
    let text = null;
    try {
      text = await file.text();
    } catch {
      // The one reason the recognition entry point cannot name, because it never
      // saw a byte: the browser refused the read. Still specific — it says what
      // failed and what to do — never "import failed".
      renderImportRecognition(doc, null,
        { reason: IMPORT_DROP_COPY.unreadable, fileName: file?.name });
      return false;
    }
    const verdict = detectAndNormalizeExport(text);
    if (firstVerdict === null) {
      firstVerdict = verdict;
      firstName = file?.name ?? "";
    }
    if (verdict.provider) return renderImportRecognition(doc, verdict, { fileName: file?.name });
  }
  return renderImportRecognition(doc, firstVerdict, { fileName: firstName });
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
  const state = byId(doc, IMPORT_DROP_IDS.state);

  const accept = (chosen) => {
    const files = [...(chosen ?? [])];
    if (!files.length) return undefined;
    // The reading state, drawn before the first byte is decoded. It is the
    // visible half only: the live region below is what a screen reader hears,
    // and saying "reading" in both would interrupt the same reader twice for one
    // event.
    if (zone) zone.dataset.state = "reading";
    if (state) state.textContent = IMPORT_DROP_COPY.reading;
    // The import starts on the SAME TICK it always did — the panel's busy state
    // is set synchronously by the handler below, and a recognition pass awaited
    // in front of it would move that state a microtask later and change what a
    // caller sees immediately after the event. Recognition paints beside it.
    const running = onFiles(files);
    // A file the browser refuses to read rejects the page's own read as well as
    // the recognition pass below. The reader has already been told why, in the
    // live region and in the reason the recognition entry point named — so the
    // rejection here is a duplicate of a message that shipped, not a failure
    // nobody reported. Left unhandled it would be an unhandled rejection and
    // nothing more.
    running?.catch?.(() => {});
    void recognizeBatch(doc, files).finally?.(() => {
      if (state) state.textContent = "";
    });
    return running;
  };

  input.addEventListener("change", () => accept(input.files));

  // THE KEYBOARD PATH, and it is a real control rather than a surface with
  // pointer handlers on it. Enter and Space activate this button, which opens
  // the very same file control the label opens, which runs the very same
  // `accept` above. Nothing about a drag is required to complete an import.
  const browse = byId(doc, IMPORT_DROP_IDS.browse);
  browse?.addEventListener("click", () => {
    input.focus?.();
    input.click?.();
  });

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
