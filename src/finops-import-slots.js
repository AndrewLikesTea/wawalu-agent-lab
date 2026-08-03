/**
 * The two-file import, told as one path to the literacy grade (#997).
 *
 * A leader who drops a provider spend export sees money answered and the AI
 * literacy card sitting on a dash, with nothing on the page saying that the
 * dash is waiting on a SECOND file. That reads as a broken grade rather than a
 * missing input. This module owns the one model both surfaces are painted
 * from: which of the two declared files is present, what each one unlocks, and
 * — when the conversation export is the one missing — the sentence the literacy
 * card says instead of showing an empty grade.
 *
 * Two rules this module keeps, because both are load-bearing elsewhere:
 *
 * 1. NOTHING here is a live region. The page announces through exactly one
 *    region (`finops-stand-live`) plus the import control's own reason line,
 *    and tests/finops-answer-announcement.test.js asserts that count. A slot
 *    list that also announced would make every clear speak twice, so the slot
 *    states are ordinary status text: no aria-live, no role of status or alert.
 * 2. Present and missing are carried by WORDS and by `aria-*`, never by the
 *    colour band or the mark alone. Each slot ships a state word in its own
 *    text and an `aria-disabled` on the missing one, so the state survives
 *    greyscale, a screen reader, and a stylesheet that failed to load.
 */

/** The state a declared file is in. Two values; there is no partial file. */
export const IMPORT_SLOT_STATE = Object.freeze({
  present: "present",
  missing: "missing",
});

/**
 * The two declared files, in the order a reader meets them.
 *
 * `unlocks` is one sentence and names an OUTCOME, not a format: a reader
 * deciding whether to go and find a second export needs to know what it buys
 * them, and "a JSONL conversation log" is not that.
 */
export const IMPORT_SLOTS = Object.freeze([
  Object.freeze({
    id: "spend",
    nodeId: "finops-import-slot-spend",
    label: "Spend export",
    unlocks: "Answers where the money went: the period total, the department "
      + "rollup, and the recoverable figure under it.",
  }),
  Object.freeze({
    id: "conversation",
    nodeId: "finops-import-slot-conversation",
    label: "Conversation export",
    unlocks: "Answers how that spend was used: the AI literacy grade, its "
      + "sampled-spend coverage, and the departments behind it.",
  }),
]);

/** The word each state says. Read by a screen reader, kept by a screenshot. */
export const IMPORT_SLOT_WORD = Object.freeze({
  [IMPORT_SLOT_STATE.present]: "Imported",
  [IMPORT_SLOT_STATE.missing]: "Not imported yet",
});

/**
 * What the literacy card says when a spend export arrived on its own.
 *
 * It names the missing file exactly — "conversation export", the same two words
 * the slot above it uses — because "add more data" is not an instruction anyone
 * can follow.
 */
export const LITERACY_NEEDS_CONVERSATION =
  "No grade yet: the AI literacy grade is scored from a conversation export, "
  + "and this import has a spend export only. Drop a conversation export into "
  + "the same import panel and this card fills in.";

/** What it says when there is no spend export either — both files still to come. */
export const LITERACY_NEEDS_BOTH =
  "No grade yet: the AI literacy grade is scored from a conversation export, "
  + "and no file has been imported into this tab.";

/** The grade slot's character while a grade is waiting on an input. */
export const LITERACY_PENDING_MARK = "…";

/**
 * Normalize whatever the page knows about its selection into the two booleans
 * everything below reads. Accepts loose input so a caller can hand over counts.
 */
export function importFilePresence({ spend = false, conversation = false } = {}) {
  return Object.freeze({
    spend: Boolean(spend),
    conversation: Boolean(conversation),
  });
}

/** The two slots, resolved against a presence. */
export function importSlotStates(presence) {
  const present = importFilePresence(presence);
  return Object.freeze(IMPORT_SLOTS.map((slot) => Object.freeze({
    ...slot,
    state: present[slot.id] ? IMPORT_SLOT_STATE.present : IMPORT_SLOT_STATE.missing,
    word: present[slot.id] ? IMPORT_SLOT_WORD.present : IMPORT_SLOT_WORD.missing,
  })));
}

/**
 * What the literacy card is allowed to claim, given the files in hand.
 *
 * `withheld` is true whenever the conversation export is absent — the grade is
 * not low, it is unscored, and the card has to say which of the two it is.
 */
export function literacyInputState(presence) {
  const present = importFilePresence(presence);
  if (present.conversation) {
    return Object.freeze({ withheld: false, sentence: "", state: "scored" });
  }
  return Object.freeze({
    withheld: true,
    sentence: present.spend ? LITERACY_NEEDS_CONVERSATION : LITERACY_NEEDS_BOTH,
    state: present.spend ? "needs-conversation" : "needs-both",
  });
}

/**
 * Paint the two slots.
 *
 * Every slot node is authored in the document, so this writes text and
 * attributes and never creates or removes a region — a region that arrives with
 * its own content is a region no assistive technology was told about.
 */
export function renderImportSlots(document, presence) {
  const slots = importSlotStates(presence);
  for (const slot of slots) {
    const node = document?.getElementById?.(slot.nodeId);
    if (!node) continue;
    node.dataset.state = slot.state;
    // The state word is the accessible channel and the greyscale channel at
    // once. `aria-disabled` is the machine-readable half of the same fact.
    node.setAttribute("aria-disabled", String(slot.state === IMPORT_SLOT_STATE.missing));
    const word = document.getElementById(`${slot.nodeId}-state`);
    if (word) word.textContent = slot.word;
    const unlocks = document.getElementById(`${slot.nodeId}-unlocks`);
    if (unlocks) unlocks.textContent = slot.unlocks;
  }
  return slots;
}

/**
 * Paint the literacy card's missing-input sentence.
 *
 * When a grade is withheld for a missing file the grade slot says so in words
 * beside a pending mark, rather than sitting on the authored dash: a dash is
 * indistinguishable from a grade that failed to compute.
 *
 * Returns the state so a caller can decide whether the rest of the card is
 * allowed to paint a letter over the top of it.
 *
 * A `null` presence means "this grade did not come from the reader's own
 * files" — the bundled example, or a restored capture — and clears the sentence
 * rather than claiming the example company failed to send us a transcript.
 */
export function renderLiteracyInputNeed(document, presence) {
  const need = presence === null
    ? Object.freeze({ withheld: false, sentence: "", state: "scored" })
    : literacyInputState(presence);
  const card = document?.getElementById?.("score-card");
  if (card) card.dataset.inputState = need.state;
  const sentence = document?.getElementById?.("score-input-need");
  if (sentence) {
    sentence.textContent = need.withheld ? need.sentence : "";
    sentence.hidden = !need.withheld;
  }
  return need;
}
