// Correct one derived unit name where the reader reads it (#1026).
//
// A name derived from a dropped export is a claim this page made about the
// reader's own organization, and until now the only way to dispute it was a
// field further down the row. So the marker that states the claim carries the
// control that fixes it: activating it swaps a text field in for the button,
// seeded with the value being corrected.
//
// WHY THIS IS ITS OWN MODULE. finops-first-run-view.js is held to a rule — see
// tests/finops-decision-interaction.test.js — that it handles no key and names
// no control with `aria-label`: everything in it is a native control whose
// keyboard behaviour is the browser's. That rule is right for a disclosure and
// wrong for an editable value, which has no native element: an in-place edit
// that does not commit on Enter and discard on Escape is not an in-place edit.
// So the two keys are answered HERE, in one place, on the field itself, and the
// rest of that view keeps its contract. Nothing else in this module listens for
// a key, and the buttons around the field are plain native buttons.
//
// WHAT IT WILL NOT DO.
//
//   * Hold state. The commit goes to the caller's `onLabel` — the same page
//     state the name field beside it writes — and every surface repaints from
//     there, so the headline sentence, the ranked row and the naming provenance
//     cannot drift apart. This module keeps nothing between paints.
//   * Overwrite the derived value. It arrives on the row as `derivedName` and is
//     never written to, which is what makes the revert exact and the "inferred"
//     attribution restorable.
//   * Assign markup. Every node is `createElement`, every string `textContent`
//     or an attribute value. A reader's correction is text wherever it appears.
//   * Commit on blur. Tabbing through the row leaves the name alone.

import { FIRST_RUN_IDS } from "./finops-first-run.js";
import { MAX_ORG_UNIT_DISPLAY_LABEL } from "./org-unit-display-label.js";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

/** The control ids, deterministic so a repaint restores focus to the same one. */
export const orgUnitCorrectionId = (rank) => `finops-unit-correction-${rank}`;
export const orgUnitCorrectionFieldId = (rank) => `finops-unit-correction-field-${rank}`;

/**
 * The words. A CORRECTED UNIT IS ATTRIBUTED, NOT SILENTLY FIXED: "inferred from
 * your export" and "corrected by reader" are different claims about where a name
 * came from, and a brief a leader forwards has to keep saying which it is.
 *
 * Every control names its unit in VISIBLE text rather than in an attribute, so
 * the name a speech-control user says is the one they can read, and five
 * corrections are five distinguishable controls.
 */
export const UNIT_CORRECTION = Object.freeze({
  inferred: "inferred from your export",
  corrected: "corrected by reader",
  edit: (name) => `Correct ${name}`,
  revert: (pseudonym, derived) => `Revert ${pseudonym} to ${derived}`,
  field: (pseudonym) => `Corrected name for ${pseudonym}`,
  applied: (name) => `Corrected. This unit now reads ${name} in the headline, `
    + "the ranked rows, and the naming provenance.",
  reverted: (derived) => `Reverted. This unit reads the name derived from your export, ${derived}, again.`,
});

/**
 * Say what changed, politely, in the region's one live area.
 *
 * That area is authored outside the evidence disclosure on purpose: a live
 * region inside a shut disclosure element is silent in a real browser however
 * well it reads in a harness that models no layout. It is also not replaced by
 * the repaint a commit triggers, so the announcement outlives the paint.
 */
function announce(doc, sentence) {
  const live = byId(doc, FIRST_RUN_IDS.live);
  if (live && sentence) live.textContent = sentence;
  return live;
}

/**
 * The attribution marker for one derived row, with its correction control.
 *
 * @param entry a ranked row: `name` as it renders, `derivedName` underneath it,
 *   `pseudonym`, `unitId`, `rank`, and `readerNamed`.
 * @param onLabel the page's `(unitId, label)` writer, or null for a copy that
 *   carries no control at all — the print sibling, which is `aria-hidden` and
 *   must not repeat this module's ids.
 * @returns the marker, for the caller to append to the row's term.
 */
export function correctionMark(doc, entry, onLabel) {
  const corrected = Boolean(entry.readerNamed);
  const mark = doc.createElement("span");
  mark.className = "org-unit-correction";
  mark.dataset.attribution = corrected ? "reader" : "derived";
  const word = doc.createElement("span");
  word.className = "org-unit-correction-word";
  word.textContent = ` · ${corrected ? UNIT_CORRECTION.corrected : UNIT_CORRECTION.inferred}`;
  mark.append(word);
  if (!onLabel || !entry.unitId) return mark;

  const commit = (value, spoken) => {
    // The button the reader opened, remembered across the repaint the commit
    // triggers, so the ring lands back on the row they corrected rather than at
    // the top of the document.
    const region = byId(doc, FIRST_RUN_IDS.region);
    if (region) region.dataset.focusTarget = orgUnitCorrectionId(entry.rank);
    onLabel(entry.unitId, value);
    announce(doc, spoken);
  };

  const button = doc.createElement("button");
  button.id = orgUnitCorrectionId(entry.rank);
  button.className = "org-unit-correction-edit";
  button.setAttribute("type", "button");
  button.textContent = UNIT_CORRECTION.edit(entry.name);
  button.addEventListener("click", () => {
    const id = orgUnitCorrectionFieldId(entry.rank);
    // A real `label for`, like the name field this replaces: the field's
    // accessible name is text a reader can see, not an attribute only a screen
    // reader meets.
    const name = doc.createElement("label");
    name.className = "org-unit-correction-name";
    name.setAttribute("for", id);
    name.textContent = UNIT_CORRECTION.field(entry.pseudonym);
    const input = doc.createElement("input");
    input.id = id;
    input.className = "org-unit-correction-input";
    input.setAttribute("type", "text");
    // The ceiling the resolver applies, on the control, so the field cannot
    // accept a value the label layer would discard.
    input.setAttribute("maxlength", String(MAX_ORG_UNIT_DISPLAY_LABEL));
    input.dataset.unitId = entry.unitId;
    input.value = entry.name;
    const close = () => {
      mark.replaceChildren(word, doc.createTextNode(" "), button);
      button.focus?.({ preventScroll: true });
    };
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      // Answered here and nowhere else, so the field never also submits a form
      // or closes the disclosure around it.
      event.preventDefault();
      if (event.key === "Escape") {
        // Discards. Page state is not touched at all: no commit, no repaint,
        // and the reader is put back on the button they opened.
        close();
        return;
      }
      const value = input.value.trim();
      // An emptied field is a reader saying "not this" with nothing to put in
      // its place, which is the revert, not a unit with no name.
      commit(value, value
        ? UNIT_CORRECTION.applied(value)
        : UNIT_CORRECTION.reverted(entry.derivedName ?? entry.pseudonym));
    });
    mark.replaceChildren(word, doc.createTextNode(" "), name, input);
    input.focus?.({ preventScroll: true });
  });
  mark.append(doc.createTextNode(" "), button);

  // ONE ACTION, no confirm step, and only where there is something to go back
  // to: clearing the reader's label falls the one resolver through to the
  // derived name, so this restores the value AND the "inferred" attribution.
  if (corrected) {
    const revert = doc.createElement("button");
    revert.className = "org-unit-correction-revert";
    revert.setAttribute("type", "button");
    const derived = entry.derivedName ?? entry.pseudonym;
    revert.textContent = UNIT_CORRECTION.revert(entry.pseudonym, derived);
    revert.addEventListener("click", () => commit("", UNIT_CORRECTION.reverted(derived)));
    mark.append(doc.createTextNode(" "), revert);
  }
  return mark;
}
