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

import { gradeMyPrompt } from "./prompt-coaching.js";
import { INPUT_HINT, applyPromptCoaching, clearPromptCoaching } from "./prompt-coaching-view.js";

export function initPromptCoaching(doc = globalThis.document) {
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

  form.addEventListener("submit", (event) => {
    event.preventDefault?.();
    applyPromptCoaching(doc, gradeMyPrompt({
      text: input?.value ?? "",
      modelTier: model?.value || null,
    }));
  });

  clear?.addEventListener("click", () => {
    if (input) input.value = "";
    clearPromptCoaching(doc);
    input?.focus?.();
  });

  return form;
}

initPromptCoaching();
