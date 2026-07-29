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

import { COACHING_INPUT_SOURCE, buildCoachingSession } from "./prompt-coaching-contract.js";
import { COACHING_ENTRY_EXAMPLE, coachingEntryState } from "./prompt-coaching-entry.js";
import {
  EXAMPLE_CONTROL_ID, announceCoachingEntrySource, applyCoachingEntry,
  applyCoachingFirstRun, setCoachingEntryState, setCoachingFirstRunState,
} from "./prompt-coaching-entry-view.js";
import {
  INPUT_HINT, applyPromptCoaching, buildRevisionChange, clearPromptCoaching,
} from "./prompt-coaching-view.js";
import { applyCoachingPreview } from "./prompt-coaching-contract-view.js";
import { applyCoachingSpecimen } from "./coaching-specimen-view.js";
import { initCoachingSummaryCopy } from "./coaching-summary-view.js";

export function initPromptCoaching(doc = globalThis.document) {
  // The front door is painted first and independently of the form: a visitor
  // deciding whether this page is worth their prompt reads what they get, what
  // it is measured against, and what it never reaches before anything else.
  applyCoachingEntry(doc);
  // The first-run sample, on the destination that carries one: a complete
  // graded result from the bundled example, painted before the form is wired
  // and independently of it, so a visitor reads a real answer on arrival even
  // if the form never comes to life. A page without the sample region — the
  // dashboard's link to this workflow, for one — is unaffected.
  applyCoachingFirstRun(doc);
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

  // Whether the field currently holds the supplied example exactly as this page
  // wrote it. It is the whole of the example/reader distinction the session
  // contract classifies on, so it is set in exactly two places: true when the
  // example is loaded, false on any keystroke in the field or on clear.
  let fromExample = false;
  const refreshEntry = (answered = false) => setCoachingEntryState(doc, {
    state: coachingEntryState({
      fieldText: input?.value ?? "", fromExample, graded: answered,
    }),
  });

  // The zero-input path: a visitor with nothing to paste presses one control and
  // has a real result. Both halves of the submission are written — the text and
  // the tier — because grading the example's text against a tier it does not
  // name would grade something the example does not describe.
  doc.getElementById(EXAMPLE_CONTROL_ID)?.addEventListener("click", () => {
    if (input) input.value = COACHING_ENTRY_EXAMPLE.text;
    if (model && COACHING_ENTRY_EXAMPLE.appliesModelTier) {
      model.value = COACHING_ENTRY_EXAMPLE.modelTier ?? "";
    }
    fromExample = true;
    refreshEntry();
    input?.focus?.();
  });

  // Editing ends the example. One keystroke is enough: from here the next grade
  // is the visitor's own text and is classified as such.
  input?.addEventListener("input", () => {
    fromExample = false;
    refreshEntry();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault?.();
    graded += 1;
    const session = buildCoachingSession({
      // Numbered, not derived from the text and not generated from a clock, so
      // the same two grades produce the same pair of identifiers every time.
      sessionId: `grade-${graded}`,
      text: input?.value ?? "",
      modelTier: model?.value || null,
      // The classification travels with the session rather than being inferred
      // downstream: a figure produced from the supplied example must never be
      // readable as a grade of the visitor's own work.
      source: fromExample ? COACHING_ENTRY_EXAMPLE.source : COACHING_INPUT_SOURCE.readerText,
    });
    const change = baseline && session.result.scored
      ? buildRevisionChange({ comparisonId: `revision-${graded}`, baseline, revision: session })
      : null;
    applyPromptCoaching(doc, session.result, { change });
    announceCoachingEntrySource(doc, session.input.source);
    // The visitor has a result of their own now, so the worked example steps
    // aside: one result on the page at a time is the only way an example figure
    // cannot be mistaken for a reading of their prompt.
    setCoachingFirstRunState(doc, { replaced: true });
    refreshEntry(true);
    // A refusal is not a baseline: there is no grade in it to compare against,
    // so the last good one stands and the next grade still compares.
    if (session.result.scored) baseline = session;
  });

  clear?.addEventListener("click", () => {
    if (input) input.value = "";
    baseline = null;
    graded = 0;
    fromExample = false;
    clearPromptCoaching(doc);
    announceCoachingEntrySource(doc, null);
    // Back to the first-run state, sample and all: the page a visitor cleared
    // is the page they arrived on.
    setCoachingFirstRunState(doc, { replaced: false });
    refreshEntry();
    input?.focus?.();
  });

  return form;
}

initPromptCoaching();
