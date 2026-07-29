// Decision entry: the rules a person types against in the recorder on the
// history view, as a pure DOM-free core.
//
// Split from the page wiring the same way release-form.js is split from
// releases-page.js, and for the same reason: the failures a form reports are
// worth pinning without a browser. Nothing here reads storage, touches the DOM,
// or writes a record — the persistence path stays exactly where it already is,
// app.js's createDecision() followed by saveDecisions().
//
// Why this module exists. The recorder used to hand every empty required field
// to form.reportValidity(). That is one native bubble at a time: it carries the
// browser's copy rather than ours, it vanishes on the next keystroke so it
// cannot be re-read by someone who missed it, and it says nothing about the
// three other fields that are also empty. PRODUCT.md names accessible keyboard
// navigation as non-negotiable and "record a decision with context,
// alternatives, owner, and status" as the first outcome, so every failure is
// stated inline, on its own field, in our words, all at once, and stays on the
// page until the field it describes is edited.
//
// Alternatives is required here. It reads as bookkeeping and it is the opposite:
// a decision with no record of what else was considered is the one a team
// re-argues from scratch a year later. Someone who genuinely weighed nothing can
// say so in a few words, which is itself worth knowing.

import { STORED_DECISION_STATUSES, canonicalDecisionStatus } from "./decision-status.js";

// The bound on each free-text field. app.js re-exports these under the
// MAX_*_LENGTH names that shiplog-import.js and the FinOps commitment path
// already import, and index.html mirrors them as maxlength attributes — so the
// form, the record validator, and the importer agree by construction instead of
// by comment.
export const DECISION_ENTRY_LIMITS = Object.freeze({
  title: 120,
  context: 1000,
  alternatives: 1000,
  owner: 80,
});

// The required fields, in the order the form presents them. That order is also
// the report order: focus lands on the first failure a reader would reach rather
// than on the last one found.
export const DECISION_ENTRY_FIELDS = Object.freeze(["title", "context", "alternatives", "owner", "status"]);

// One message per field per failure. Each names what to write rather than
// restating that the field is required: the control already carries `required`,
// and "Title is required" tells somebody looking at an empty box nothing.
export const DECISION_ENTRY_ERRORS = Object.freeze({
  title: Object.freeze({
    missing: "Give the decision a short title. It is what the history lists and what search matches.",
    tooLong: `Shorten the title to ${DECISION_ENTRY_LIMITS.title} characters or fewer.`,
  }),
  context: Object.freeze({
    missing: "Write the problem, the constraints, and the reasoning. This is what a teammate reads six months from now.",
    tooLong: `Shorten the context to ${DECISION_ENTRY_LIMITS.context} characters or fewer.`,
  }),
  alternatives: Object.freeze({
    missing: "Name the other options considered and why they lost. Write “None considered” if there were none.",
    tooLong: `Shorten the alternatives to ${DECISION_ENTRY_LIMITS.alternatives} characters or fewer.`,
  }),
  owner: Object.freeze({
    missing: "Name the person responsible for this decision.",
    tooLong: `Shorten the owner to ${DECISION_ENTRY_LIMITS.owner} characters or fewer.`,
  }),
  status: Object.freeze({
    missing: "Choose whether this decision is Pending or Accepted.",
    invalid: "Choose whether this decision is Pending or Accepted.",
  }),
});

/**
 * The one failure a single field has, or null when it has none.
 *
 * Status is checked against every value a record may legally carry rather than
 * against the two the form offers, so a caller that sets a stored status
 * directly — the legacy "approved", a test, a future importer — is not refused a
 * value createDecision() would accept.
 */
export function decisionEntryFieldError(field, value, options = {}) {
  const messages = DECISION_ENTRY_ERRORS[field];
  if (!messages) return null;
  const text = String(value ?? "").trim();
  if (field === "status") {
    if (!text) return messages.missing;
    const allowed = options.statuses ?? STORED_DECISION_STATUSES;
    return allowed.includes(text) ? null : messages.invalid;
  }
  if (!text) return messages.missing;
  return text.length > DECISION_ENTRY_LIMITS[field] ? messages.tooLong : null;
}

/**
 * Every failure in the entry, in form order, as `{ field, message }` pairs.
 *
 * An empty array is the only thing a caller may treat as submittable. This is
 * deliberately not a second copy of createDecision()'s rules: that function
 * stays the boundary that decides what can be *stored*, and this one decides
 * what a person is told about what they *typed*. The overlap is intentional —
 * one of them speaks to a visitor and the other refuses a bad record.
 */
export function validateDecisionEntry(values = {}, options = {}) {
  return DECISION_ENTRY_FIELDS
    .map((field) => ({ field, message: decisionEntryFieldError(field, values[field], options) }))
    .filter(({ message }) => message !== null);
}

// The single line the form-level alert carries. It counts rather than repeating
// the messages: each one is already on the field it belongs to, and a summary
// that restates them all reads the whole form twice to a screen reader.
//
// A count rather than the failure list, because the caller corrects this line as
// fields are fixed one at a time and only ever knows how many are left.
export function decisionEntrySummary(count = 0) {
  if (!Number.isFinite(count) || count <= 0) return "";
  return count === 1
    ? "One field still needs an answer before this decision can be recorded. It is described below."
    : `${count} fields still need an answer before this decision can be recorded. Each one is described below.`;
}

// Said once, after the record has been written and the history recomposed.
//
// The filters belong to the visitor and a save deliberately does not reset
// them, so "the history updated" can be true while the new row is not on
// screen. When that happens this says so instead of leaving somebody hunting
// for a record that is filtered away.
export function decisionRecordedSummary(decision, options = {}) {
  const title = String(decision?.title ?? "").trim();
  const status = canonicalDecisionStatus(String(decision?.status ?? "").trim());
  const where = options.visible === false
    ? "The active filters hide it — clear the filters to see it."
    : "It is in the history below.";
  return `Recorded “${title}” as ${status}. ${where}`;
}
