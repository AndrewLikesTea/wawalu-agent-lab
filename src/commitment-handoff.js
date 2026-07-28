// The local handoff from an exported briefing to the decision it proposes.
//
// WHAT THIS IS FOR
// ----------------
// The Savings Commitment page could previously only propose a commitment out of
// the bundled synthetic analysis. That is a demonstration, not a decision: the
// figures were never the visitor's own, and a decision recorded from them would
// say so in the log forever.
//
// The AI FinOps page already writes the artifact that closes the gap. Its
// briefing file carries `savingsCommitment` — Noor's contract applied to the
// visitor's own imported analysis, derived by Rowan's adapter and validated on
// the way back in by `readSavedCommitment`. This module is the seam that turns
// that block back into the same `savings-commitment/1.0.0` preview the bundled
// fixture produces, so one render path and one record path serve both.
//
// WHY A FILE AND NOT A STORAGE HANDOFF
// ------------------------------------
// The AI FinOps page promises, on screen and in its tests, "no upload · no
// credentials · no network transfer · no browser storage". Passing the analysis
// between surfaces through `sessionStorage` would quietly break that promise for
// a convenience nobody asked for. The file the visitor already exports is the
// handoff, it is theirs, and it moves only because they chose it.
//
// EVERY REFUSAL IS AN ANSWER
// --------------------------
// `readCommitmentHandoff` never throws and never returns half a briefing. A file
// that is not a briefing, a briefing written against another contract version, a
// briefing whose commitment block was hand-edited, and a briefing whose analysis
// simply supports no commitment are four different sentences, not one shrug. The
// caller keeps whatever it was already showing: a rejected file replaces nothing.
//
// No storage, no clock, no network, no DOM.

import {
  COMMITMENT_STATUS,
  COMMITMENT_UNAVAILABLE_STATEMENT,
  calendarMonth,
} from "./finops-briefing-commitment.js";
import { RESTORE_REJECTION, parseSavedBriefing } from "./finops-briefing-restore.js";
import {
  SAVINGS_COMMITMENT_QUESTION,
  SAVINGS_COMMITMENT_VERSION,
  validateSavingsCommitment,
} from "./savings-commitment.js";

/** Where the commitment on screen came from. There is no third source. */
export const COMMITMENT_ORIGIN = Object.freeze({
  bundled: "bundled",
  imported: "imported",
});

/** The refusals this module adds to the briefing reader's own. */
export const HANDOFF_REJECTION = Object.freeze({
  commitment_unavailable:
    "That briefing was read, but its analysis proposes no commitment to record. The briefing that "
    + "was already open is unchanged.",
  commitment_not_valid:
    "That briefing carries a commitment block that no longer satisfies the savings-commitment "
    + "contract, so no decision is offered from it. Export the analysis again rather than editing a "
    + "saved briefing by hand.",
});

/** The sentence for any rejection code, whichever reader produced it. */
export function handoffRejectionMessage(code) {
  return HANDOFF_REJECTION[code] ?? RESTORE_REJECTION[code] ?? RESTORE_REJECTION.unreadable;
}

function rejected(name, code, message) {
  return Object.freeze({
    ok: false,
    name,
    code,
    message: message ?? handoffRejectionMessage(code),
    preview: null,
    origin: null,
    label: null,
  });
}

/**
 * The `savings-commitment/1.0.0` preview a saved commitment block states, or
 * null when it states one this build will not believe.
 *
 * The block is deliberately not read field by field and trusted. It is
 * reassembled into a full preview using this build's own constants and put
 * through `validateSavingsCommitment`, which re-checks the arithmetic, the
 * confidence band, the provenance record count, and the absence of credential or
 * prompt content at any depth — the same gate the bundled fixture passes.
 */
export function previewFromCommitmentBlock(block) {
  if (!block || typeof block !== "object" || Array.isArray(block)) return null;
  if (block.status !== COMMITMENT_STATUS.ok && block.status !== COMMITMENT_STATUS.noCommitment) {
    return null;
  }
  const ok = block.status === COMMITMENT_STATUS.ok;
  const preview = {
    schemaVersion: SAVINGS_COMMITMENT_VERSION,
    question: SAVINGS_COMMITMENT_QUESTION,
    status: block.status,
    designation: block.designation,
    source: block.source,
    commitment: ok ? block.commitment : null,
    reason: ok ? null : block.statement,
    consideredCount: block.consideredCount,
    eligibleCount: block.eligibleCount,
    excluded: Array.isArray(block.excluded) ? block.excluded : [],
    // The contract requires the downstream marker to name it. This module is
    // that downstream step arriving, so it restates the dependency rather than
    // carrying a copy of the note the file has no room for.
    downstream: { dependsOnContract: SAVINGS_COMMITMENT_VERSION },
  };
  try {
    validateSavingsCommitment(preview);
  } catch {
    return null;
  }
  return preview;
}

/** The one line naming what the figures on screen describe. */
export function handoffLabel({ name, month, dataset, savedOn }) {
  const monthText = month ? `the ${month} analysis` : "an analysis over a window that is not one month";
  const datasetText = dataset === "example"
    ? "the AI FinOps example dataset, not your own spend"
    : "your own imported spend";
  return `${name} · ${monthText} · ${datasetText} · briefing written ${savedOn}`;
}

/**
 * Read one opened briefing file into the commitment it proposes.
 *
 * @param file `{ name, text, byteSize }` as a file input supplies it.
 * @returns `{ ok: true, preview, label, month, dataset, savedOn }`, or
 *   `{ ok: false, code, message }`. Total: it never throws, so a caller can
 *   render the outcome instead of guarding the call.
 */
export function readCommitmentHandoff({ name = "file", text = "", byteSize = null } = {}) {
  const parsed = parseSavedBriefing(text, { byteSize });
  if (!parsed.ok) return rejected(name, parsed.code, parsed.message);

  const { saved } = parsed;
  const block = saved.savingsCommitment;
  if (!block || block.status === COMMITMENT_STATUS.unavailable) {
    // The block already carries the authored sentence naming what is missing;
    // repeating it here in this module's words would give one fact two voices.
    return rejected(name, "commitment_unavailable",
      COMMITMENT_UNAVAILABLE_STATEMENT[block?.reason] ?? HANDOFF_REJECTION.commitment_unavailable);
  }
  const preview = previewFromCommitmentBlock(block);
  if (!preview) return rejected(name, "commitment_not_valid");

  const month = calendarMonth(`${saved.period.startDate} to ${saved.period.endDate}`);
  return Object.freeze({
    ok: true,
    name,
    code: null,
    message: null,
    preview,
    origin: COMMITMENT_ORIGIN.imported,
    month,
    dataset: saved.dataset,
    savedOn: saved.savedOn,
    label: handoffLabel({ name, month, dataset: saved.dataset, savedOn: saved.savedOn }),
  });
}

/**
 * Read a selection of files and keep the last one that proposes a commitment.
 *
 * One commitment is recorded at a time, so a multi-file selection resolves to
 * one accepted briefing and a rejection for each of the others. Nothing is
 * merged: two briefings are two analyses, and averaging them would be the one
 * figure nobody could trace.
 */
export function readCommitmentHandoffs(files = []) {
  const rejections = [];
  let accepted = null;
  for (const file of Array.isArray(files) ? files : []) {
    const read = readCommitmentHandoff(file);
    if (read.ok) {
      if (accepted) {
        rejections.push(rejected(accepted.name, "superseded",
          `${accepted.name} was replaced by ${read.name}: one commitment is recorded at a time.`));
      }
      accepted = read;
    } else {
      rejections.push(read);
    }
  }
  return Object.freeze({ accepted, rejections: Object.freeze(rejections) });
}
