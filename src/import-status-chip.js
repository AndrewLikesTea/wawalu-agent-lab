// One chip vocabulary for expanded-provider import evidence (#931).
//
// Three surfaces — the recognition score, the provider-native intake, and the
// intake-confidence verdict — each drew their own state with a coloured left
// rule and nothing else. A reader who sees no colour met three identical boxes.
//
// So state is a chip here, and a chip is three carriers that survive each other:
//
//   WORD   the label ("Ambiguous"), which is the whole meaning on its own
//   VALUE  the figure the state was decided from ("75 of 100"), never implied
//   SHAPE  a mark off the page's own circle ramp, aria-hidden decoration only
//
// Colour is the fourth carrier and never the first. `tests/import-status-chip.test.js`
// deletes the shape and the tint and asserts the chip still reads.
//
// SILHOUETTE follows the Claude Design foundations card ("Chip inventory"):
// FILLED WASH = a dynamic signal (how this file scored just now), OUTLINE = a
// static classification (which provider contract it was read against). Two
// jobs, two silhouettes, so a reader can tell a live verdict from a label.
//
// SHAPE follows the glyph table at the top of `evolution.css`: CIRCLE is the
// status ramp (○ nothing · ◌ reading · ◔ some · ◐ part · ● measured) and × is
// refusal. No new mark is introduced and no mark is borrowed from another role.

import { MAX_CONFIDENCE, RECOGNITION_BANDS, RECOGNITION_OUTCOMES } from "./export-recognition.js";
import { INTAKE_STATES } from "./provider-native-import.js";

/** How much of an import this workspace understood. One state, one chip. */
export const IMPORT_STATUS = Object.freeze({
  PENDING: "pending",
  LOADING: "loading",
  RECOGNIZED: "recognized",
  PARTIAL: "partial",
  AMBIGUOUS: "ambiguous",
  REJECTED: "rejected",
});

/** Filled wash = a live signal. Outline = a classification that never moves. */
export const CHIP_KINDS = Object.freeze({ SIGNAL: "signal", CLASSIFICATION: "classification" });

/**
 * The chip table. `uncertainty` and `next` are the two sentences an unsettled
 * import owes a reader: what is not known, and what they do about it. Both are
 * required on every unsettled state — a chip that only names a colour band
 * leaves the reader to guess, which is the defect this table exists to close.
 */
export const IMPORT_STATUS_CHIPS = Object.freeze({
  [IMPORT_STATUS.PENDING]: Object.freeze({
    status: IMPORT_STATUS.PENDING, label: "Not read yet", shape: "○", tone: "neutral",
    uncertainty: "No export has been read in this tab yet.",
    next: "Choose the provider you exported from, then read a file or a bundled example.",
  }),
  [IMPORT_STATUS.LOADING]: Object.freeze({
    status: IMPORT_STATUS.LOADING, label: "Reading", shape: "◌", tone: "neutral",
    uncertainty: "This export is still being parsed in this tab.",
    next: "Wait for the reading to finish; nothing leaves this browser while it runs.",
  }),
  [IMPORT_STATUS.RECOGNIZED]: Object.freeze({
    status: IMPORT_STATUS.RECOGNIZED, label: "Recognized", shape: "●", tone: "ok",
    uncertainty: "", next: "",
  }),
  [IMPORT_STATUS.PARTIAL]: Object.freeze({
    status: IMPORT_STATUS.PARTIAL, label: "Partly parsed", shape: "◐", tone: "warn",
    uncertainty: "The provider was recognized, but not every row carried a readable "
      + "billed unit count and cost, so the figure rests on fewer rows than the file has.",
    next: "Open the evidence below and check which rows were counted before acting on it.",
  }),
  [IMPORT_STATUS.AMBIGUOUS]: Object.freeze({
    status: IMPORT_STATUS.AMBIGUOUS, label: "Ambiguous", shape: "◔", tone: "warn",
    uncertainty: "More than one published contract fits this file, so which provider "
      + "produced it is not settled.",
    next: "Open the evidence below, confirm the provider you exported from, and read it again.",
  }),
  [IMPORT_STATUS.REJECTED]: Object.freeze({
    status: IMPORT_STATUS.REJECTED, label: "Rejected", shape: "×", tone: "error",
    uncertainty: "This file did not match the contract for the provider you chose, so no "
      + "figure was computed from it.",
    next: "Open the evidence below to see which signals were missing, then export again "
      + "with the columns it names.",
  }),
});

/** True for the states a reader still has to resolve before trusting a figure. */
export const isUnsettled = (status) =>
  status === IMPORT_STATUS.PARTIAL || status === IMPORT_STATUS.AMBIGUOUS
  || status === IMPORT_STATUS.REJECTED;

/** The recognition band and outcome, as one import status. */
export function recognitionStatus(band, outcome) {
  if (band === RECOGNITION_BANDS.REJECTED) return IMPORT_STATUS.REJECTED;
  if (band === RECOGNITION_BANDS.ACCEPTED) return IMPORT_STATUS.RECOGNIZED;
  return outcome === RECOGNITION_OUTCOMES.AMBIGUOUS
    ? IMPORT_STATUS.AMBIGUOUS : IMPORT_STATUS.PARTIAL;
}

/**
 * The intake state, as one import status.
 *
 * An answered intake with no computable rate is `partial`, not `recognized`:
 * the provider was read and the figure was not, and one chip saying "Recognized"
 * over a missing number is the exact ambiguity this vocabulary removes.
 */
export function intakeStatus(state, hasMetric) {
  if (state === INTAKE_STATES.UNRECOGNIZED) return IMPORT_STATUS.REJECTED;
  if (state === INTAKE_STATES.PROVISIONAL) return IMPORT_STATUS.AMBIGUOUS;
  return hasMetric ? IMPORT_STATUS.RECOGNIZED : IMPORT_STATUS.PARTIAL;
}

/**
 * One chip, ready to paint.
 *
 * `value` is written by this module rather than by each caller, so "75 of 100"
 * cannot drift into "75/100" on the surface next door. A chip without a
 * confidence still carries its label and its shape.
 */
export function importStatusChip(status, { confidence = null, max = MAX_CONFIDENCE } = {}) {
  const base = IMPORT_STATUS_CHIPS[status] ?? IMPORT_STATUS_CHIPS[IMPORT_STATUS.PENDING];
  const value = Number.isFinite(confidence) ? `${confidence} of ${max}` : "";
  return Object.freeze({ ...base, kind: CHIP_KINDS.SIGNAL, value,
    text: value ? `${base.label} · ${value}` : base.label });
}

/**
 * A static classification chip: the contract a file was read against, the
 * format it arrived in, the row count. Outline silhouette, neutral tone, and
 * never a verdict — a classification that borrowed the verdict's fill would
 * read as a live signal about the file.
 */
export function classificationChip(label, value = "") {
  return Object.freeze({ status: "classification", label, value, shape: "", tone: "neutral",
    kind: CHIP_KINDS.CLASSIFICATION, uncertainty: "", next: "",
    text: value ? `${label} · ${value}` : label });
}

/**
 * Paints one chip.
 *
 * The mark is `aria-hidden` and lives in its own element, so a screen reader
 * reads "Ambiguous 75 of 100" and deleting the mark from the DOM loses nothing.
 */
export function renderChip(doc, chip) {
  const root = doc.createElement("span");
  root.className = "import-chip";
  root.dataset.status = chip.status;
  root.dataset.kind = chip.kind;
  root.dataset.tone = chip.tone;
  const parts = [];
  if (chip.shape) {
    const shape = doc.createElement("span");
    shape.className = "import-chip-shape";
    shape.setAttribute("aria-hidden", "true");
    shape.textContent = chip.shape;
    parts.push(shape);
  }
  const label = doc.createElement("span");
  label.className = "import-chip-label";
  label.textContent = chip.label;
  parts.push(label);
  if (chip.value) {
    const value = doc.createElement("span");
    value.className = "import-chip-value";
    value.textContent = chip.value;
    parts.push(value);
  }
  root.replaceChildren(...parts);
  return root;
}
