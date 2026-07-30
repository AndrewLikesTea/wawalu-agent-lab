/**
 * The delivery-history file's three states, on the intake panel that read it.
 *
 * One region, three outcomes, and never a fourth: a reader who chose a Shiplog
 * delivery-history export learns whether it was accepted, accepted-but-a-floor,
 * or refused — and in the last case, what would fix it. The words are the
 * contract's own; this layer chooses none of its own beyond the three state
 * labels and the static labels already in the markup.
 *
 * Two rules hold here, the same two the rest of this intake surface keeps:
 *   1. Nothing is signalled by colour alone. Every state ships a word and a
 *      shape beside whatever the stylesheet tints.
 *   2. Nothing read out of the file reaches the DOM except the values the
 *      contract forwards — a count, a period, a status, and a version label the
 *      identifier-leak rule already cleared. No delivery id, instance id, export
 *      id, or file name is ever written here, and every value is a text node.
 */

import {
  DELIVERY_HISTORY_OUTCOME, MINIMUM_SHARED_RUN, sanitizeDeliveryLabel,
} from "./shiplog-delivery-history.js";

export const DELIVERY_HISTORY_SECTION_ID = "delivery-history";

/**
 * The three states in words and shapes. `incomplete` is deliberately not called
 * a warning: the count is usable, and calling it a warning would push a reader
 * to discard a file that answers their question with a stated bound.
 */
export const DELIVERY_HISTORY_STATE_TEXT = Object.freeze({
  [DELIVERY_HISTORY_OUTCOME.accepted]: Object.freeze({ label: "Accepted", shape: "◆" }),
  [DELIVERY_HISTORY_OUTCOME.incomplete]: Object.freeze({ label: "Accepted as a floor", shape: "◈" }),
  [DELIVERY_HISTORY_OUTCOME.incompatible]: Object.freeze({ label: "Not read", shape: "×" }),
});

/**
 * Every line the region renders, derived from one outcome.
 *
 * Split out from the painting so a test can assert on the sentences without a
 * document, and so the announcement the page makes and the text on screen are
 * the same strings rather than two wordings of one event.
 */
export function deliveryHistoryLines(outcome) {
  const state = DELIVERY_HISTORY_STATE_TEXT[outcome.outcome]
    ?? DELIVERY_HISTORY_STATE_TEXT[DELIVERY_HISTORY_OUTCOME.incompatible];
  if (!outcome.usable) {
    const [diagnostic] = outcome.diagnostics;
    return Object.freeze({
      state: outcome.outcome,
      label: state.label,
      shape: state.shape,
      statement: diagnostic?.message ?? "The file was not read.",
      counts: "No release count was taken from this file, and no reading was replaced.",
      latest: "",
      provenance: outcome.provenance.source,
      notes: Object.freeze(outcome.diagnostics.map((entry) => entry.recovery).filter(Boolean)),
    });
  }
  const { counts, snapshot } = outcome;
  // The label on the most recent counted release is the one string out of the
  // file this surface renders, and it goes through the leak rule a second time
  // on the way. A label that cannot clear it is replaced by its ordinal — a
  // reader loses a cosmetic name, never the count.
  const newest = [...outcome.deliveries].reverse().find((entry) => entry.status === "completed") ?? null;
  const cleared = newest ? sanitizeDeliveryLabel(newest.label) : null;
  return Object.freeze({
    state: outcome.outcome,
    label: state.label,
    shape: state.shape,
    statement: `${counts.counted} release${counts.counted === 1 ? "" : "s"} recorded as completed in `
      + `${snapshot.period}, from a Shiplog delivery history ${outcome.schemaVersion} export.`,
    counts: `${counts.records} record${counts.records === 1 ? "" : "s"} read · `
      + `${counts.counted} counted · ${counts.quarantined} not counted · `
      + `${counts.omittedDeclared} declared omitted · sequence ${snapshot.sequence} · `
      + `freshness ${snapshot.freshness.state}`,
    latest: newest
      ? `Most recent counted release: ${cleared.state === "kept" ? cleared.label
        : `release ${newest.ordinal} (label withheld)`} on ${newest.completedAt.slice(0, 10)}.`
      : "",
    provenance: outcome.provenance.source,
    notes: Object.freeze([
      ...outcome.diagnostics.map((entry) => `${entry.message} ${entry.recovery}`),
      ...outcome.notes,
      `Withheld and never rendered: ${outcome.provenance.withheldFields.join(", ")}. A version label `
      + `sharing a run of ${MINIMUM_SHARED_RUN} or more characters with one of them is refused.`,
    ]),
  });
}

function textNode(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

const write = (doc, id, text) => {
  const node = doc.getElementById(id);
  if (node) {
    node.textContent = text;
    node.hidden = !text;
  }
  return node;
};

/**
 * Paint the region from one outcome.
 *
 * @returns the lines that were painted, so a caller asserts on what it asked for
 *   rather than on the DOM it got back.
 */
export function applyDeliveryHistory(doc, outcome) {
  const section = doc?.getElementById?.(DELIVERY_HISTORY_SECTION_ID);
  if (!outcome) return clearDeliveryHistory(doc);
  const lines = deliveryHistoryLines(outcome);
  if (!section) return lines;
  section.hidden = false;
  section.dataset.outcome = lines.state;
  // The version the surface rendered, on the surface: a reviewer comparing the
  // page against the file is comparing two stated versions.
  section.dataset.contract = outcome.contract;
  write(doc, "delivery-history-shape", lines.shape);
  write(doc, "delivery-history-state", lines.label);
  write(doc, "delivery-history-statement", lines.statement);
  write(doc, "delivery-history-counts", lines.counts);
  write(doc, "delivery-history-latest", lines.latest);
  write(doc, "delivery-history-provenance", lines.provenance);
  const notes = doc.getElementById("delivery-history-notes");
  if (notes) {
    notes.replaceChildren(...lines.notes.map((note) =>
      textNode(doc, "li", "delivery-history-note", note)));
    notes.hidden = lines.notes.length === 0;
  }
  return lines;
}

/** Take the region off screen. A file that is no longer loaded says nothing. */
export function clearDeliveryHistory(doc) {
  const section = doc?.getElementById?.(DELIVERY_HISTORY_SECTION_ID);
  if (!section) return null;
  section.hidden = true;
  section.dataset.outcome = "absent";
  delete section.dataset.contract;
  for (const id of ["delivery-history-shape", "delivery-history-state", "delivery-history-statement",
    "delivery-history-counts", "delivery-history-latest", "delivery-history-provenance"]) {
    write(doc, id, "");
  }
  const notes = doc.getElementById("delivery-history-notes");
  if (notes) {
    notes.replaceChildren();
    notes.hidden = true;
  }
  return null;
}
