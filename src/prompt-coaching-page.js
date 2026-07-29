// The coaching workflow's page entry: the whole of the wiring, deliberately.
//
// It is a script of its own rather than another branch of evolution-page.js
// because it shares no state with the FinOps analysis. Nothing here reads an
// import, a workspace, a seed, or a file; nothing here writes one. A reader can
// coach a prompt on a first visit with nothing selected, and a failure in the
// analysis pipeline cannot take this workflow down with it.
//
// The markup is already in the document, so a page where this script fails to
// load still reads correctly: the section explains itself, the field is a plain
// textarea, and the form does nothing — it never had an action to fall back to,
// because there is no server in this workflow to fall back to.
//
// NO NETWORK, NO STORAGE, NO PERSISTENCE. The pasted text is read from the
// field, passed to a pure function, and left in the field the reader typed it
// into. It is not saved, not exported, not put in a URL, and not written to any
// storage. The one place it exists is the DOM node the reader owns.

import { buildCoachingSession } from "./prompt-coaching-contract.js";
import { buildRevisionComparison } from "./prompt-revision-comparison.js";
import { INPUT_HINT, applyPromptCoaching, clearPromptCoaching } from "./prompt-coaching-view.js";
import {
  REVISION_HINT, applyRevisionComparison, applyRevisionError, applyRevisionStep,
  clearRevision, runRevisionCopy, setRevisionBusy,
} from "./prompt-revision-view.js";
import { applyCoachingPreview } from "./prompt-coaching-contract-view.js";
import { applyCoachingSpecimen } from "./coaching-specimen-view.js";

/**
 * Wire the coaching workflow and the revision loop built on top of it.
 *
 * THE ONE PIECE OF STATE, AND WHY IT IS A VARIABLE. Between the two grades this
 * closure holds `baseline`: the coaching *session* envelope, which carries
 * measurements of the graded text and never the text itself. The two prompts
 * live in the two textareas the reader owns. Nothing else holds either, and a
 * variable is not a store — closing the tab is the whole of the delete flow.
 *
 * `clipboard` is a parameter rather than a global read so a test can drive the
 * shipped wiring with a clipboard that succeeds, one that rejects, and none at
 * all. In the browser it resolves to the platform's.
 */
export function initPromptCoaching(doc = globalThis.document,
  { clipboard = globalThis.navigator?.clipboard } = {}) {
  // The preview is painted before the form is wired, and independently of it:
  // a reader deciding whether to type anything into the box needs the boundary
  // and the worked example whether or not the form ever comes to life.
  applyCoachingPreview(doc);
  // The specimen likewise: it is a review surface over bundled samples and
  // reads nothing a visitor types, so it renders whether or not the form does.
  applyCoachingSpecimen(doc);

  const form = doc?.getElementById?.("prompt-coaching-form");
  if (!form) return null;
  const input = doc.getElementById("prompt-coaching-input");
  const model = doc.getElementById("prompt-coaching-model");
  const clear = doc.getElementById("prompt-coaching-clear");

  // The limits are the contract's, so the sentence under the field cannot drift
  // from the number the contract enforces. Written here rather than in the
  // markup for that reason alone.
  const hint = doc.getElementById("prompt-coaching-hint");
  if (hint) hint.textContent = INPUT_HINT;
  const revisionHint = doc.getElementById("prompt-revision-hint");
  if (revisionHint) revisionHint.textContent = REVISION_HINT;

  const revisionForm = doc.getElementById("prompt-revision-form");
  const revisionInput = doc.getElementById("prompt-coaching-revision-input");
  const tier = () => model?.value || null;

  // Session ids are a display label, never derived from the text and never
  // random: a counter keeps them unique (the comparison rejects two sides with
  // the same id) and keeps the workflow deterministic, which is what lets a
  // fixture assert an id at all.
  let runs = 0;
  let baseline = null;

  form.addEventListener("submit", (event) => {
    event.preventDefault?.();
    runs += 1;
    const session = buildCoachingSession({
      sessionId: `baseline-${runs}`,
      text: input?.value ?? "",
      modelTier: tier(),
    });
    // Step 1 is painted from the session's own result, which is byte-identical
    // to what `gradeMyPrompt` returned before this issue. The single-prompt
    // path did not change; it gained an envelope around it.
    applyPromptCoaching(doc, session.result);
    baseline = session.outcome === "graded" ? session : null;
    // A refused baseline has no figure to compare against, and its own recovery
    // already points at the field above. Opening step 2 there would offer a
    // second box for a prompt that was not read.
    if (baseline) applyRevisionStep(doc, { baseline, text: input?.value ?? "" });
    else clearRevision(doc);
  });

  clear?.addEventListener("click", () => {
    if (input) input.value = "";
    baseline = null;
    clearPromptCoaching(doc);
    clearRevision(doc);
    input?.focus?.();
  });

  revisionForm?.addEventListener("submit", (event) => {
    event.preventDefault?.();
    if (!baseline) return;
    setRevisionBusy(doc, true);
    try {
      runs += 1;
      const revision = buildCoachingSession({
        sessionId: `revision-${runs}`,
        text: revisionInput?.value ?? "",
        modelTier: tier(),
      });
      applyRevisionComparison(doc, buildRevisionComparison({
        comparisonId: `comparison-${runs}`, baseline, revision,
      }));
    } catch (error) {
      // Includes the tier the reader changed between runs? No — that abstains
      // inside the contract and is a painted state. This branch is a malformed
      // session or an internal inconsistency, and it must still leave a usable
      // panel rather than a disabled button.
      applyRevisionError(doc, error);
    } finally {
      setRevisionBusy(doc, false);
    }
  });

  // "Restore the original prompt" reads the baseline field rather than a saved
  // copy: the original is already on the page, and a second copy of a reader's
  // text held to support an undo is a second copy held.
  doc.getElementById("prompt-revision-reset")?.addEventListener("click", () => {
    if (revisionInput && input) revisionInput.value = input.value;
    revisionInput?.focus?.();
  });

  doc.getElementById("prompt-revision-copy")?.addEventListener("click", () => {
    runRevisionCopy(doc, clipboard);
  });

  return form;
}

initPromptCoaching();
