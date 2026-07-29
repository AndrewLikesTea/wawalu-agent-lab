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
import {
  INPUT_HINT, applyPromptCoaching, buildRevisionChange, clearPromptCoaching,
} from "./prompt-coaching-view.js";
import { applyCoachingPreview } from "./prompt-coaching-contract-view.js";
import { applyCoachingSpecimen } from "./coaching-specimen-view.js";
import { initCoachingSummaryCopy } from "./coaching-summary-view.js";

export function initPromptCoaching(doc = globalThis.document) {
  // The preview is painted before the form is wired, and independently of it:
  // a reader deciding whether to type anything into the box needs the boundary
  // and the worked example whether or not the form ever comes to life.
  applyCoachingPreview(doc);
  // The specimen likewise: it is a review surface over bundled samples and
  // reads nothing a visitor types, so it renders whether or not the form does.
  applyCoachingSpecimen(doc);
  // The copy control is wired before the form and independently of it, for the
  // same reason: its markup is already in the document, and a button that is
  // painted but never wired is worse than one that never appears. It stays
  // hidden until a comparison exists to summarise.
  initCoachingSummaryCopy(doc);

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

  // The last graded session, so a second grade can be read as a change rather
  // than as a repeat of the first question. It is a session envelope — the
  // measurements of what was graded, never the text — and it lives in this
  // closure for as long as the tab is open and nowhere else: no storage, no
  // request, no URL. Clearing the panel drops it.
  let baseline = null;
  let graded = 0;

  form.addEventListener("submit", (event) => {
    event.preventDefault?.();
    graded += 1;
    const session = buildCoachingSession({
      // Numbered, not derived from the text and not generated from a clock, so
      // the same two grades produce the same pair of identifiers every time.
      sessionId: `grade-${graded}`,
      text: input?.value ?? "",
      modelTier: model?.value || null,
    });
    const change = baseline && session.result.scored
      ? buildRevisionChange({ comparisonId: `revision-${graded}`, baseline, revision: session })
      : null;
    applyPromptCoaching(doc, session.result, { change });
    // A refusal is not a baseline: there is no grade in it to compare against,
    // so the last good one stands and the next grade still compares.
    if (session.result.scored) baseline = session;
  });

  clear?.addEventListener("click", () => {
    if (input) input.value = "";
    baseline = null;
    graded = 0;
    clearPromptCoaching(doc);
    input?.focus?.();
  });

  return form;
}

initPromptCoaching();
