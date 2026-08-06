// Decision entry: the rules a person types against in the recorder on the
// history view, as a pure DOM-free core.
//
// Split from the page wiring the same way release-form.js is split from
// releases-page.js, and for the same reason: the failures a form reports are
// worth pinning without a browser. Nothing here reads storage, touches the DOM,
// or writes a record — the persistence path stays exactly where it already is,
// app.js's createDecision() followed by saveDecisions().
//
// Both of those callers ask this module, and neither owns a rule of its own:
// createDecision() refuses a write by calling validateDecision() and throwing
// the very message the form would have printed beside the field. That is the
// invariant worth having — a record cannot be persisted in a state the form
// would have rejected, and a caller that bypasses the form is answered in the
// same words rather than in a generic one about "a field".
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

// The label each field carries in the form, so the summary line can name the
// field that is blocking the save in the words the visitor is looking at.
export const DECISION_ENTRY_LABELS = Object.freeze({
  title: "Title",
  context: "Context",
  alternatives: "Alternatives",
  owner: "Owner",
  status: "Status",
});

// One message per field per failure. Each names what to write rather than
// restating that the field is required: the control already carries `required`,
// and "Title is required" tells somebody looking at an empty box nothing.
//
// `tooLong` is a function of the length that was submitted, not a constant: a
// paste that is 63 characters over reads as a different problem from one that is
// 3 over, and "it is currently 1063" is the number a person needs to cut down
// to the limit. It states counts and never the offending text — echoing a
// visitor's own paste back into a message would put their string into a second
// place on the page, and the whole point of this form is that their string is
// only ever text content.
const tooLong = (what, limit) => (length) =>
  `${what} must be ${limit} characters or fewer; it is currently ${length}.`;

export const DECISION_ENTRY_ERRORS = Object.freeze({
  title: Object.freeze({
    missing: "Give the decision a short title. It is what the history lists and what search matches.",
    tooLong: tooLong("Title", DECISION_ENTRY_LIMITS.title),
  }),
  context: Object.freeze({
    missing: "Write the problem, the constraints, and the reasoning. This is what a teammate reads six months from now.",
    tooLong: tooLong("Context", DECISION_ENTRY_LIMITS.context),
  }),
  alternatives: Object.freeze({
    missing: "Name the other options considered and why they lost. Write “None considered” if there were none.",
    tooLong: tooLong("Alternatives", DECISION_ENTRY_LIMITS.alternatives),
  }),
  owner: Object.freeze({
    missing: "Name the person responsible for this decision.",
    tooLong: tooLong("Owner", DECISION_ENTRY_LIMITS.owner),
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
  return text.length > DECISION_ENTRY_LIMITS[field] ? messages.tooLong(text.length) : null;
}

/**
 * Every failure in the entry, in form order, as `{ field, message }` pairs.
 *
 * An empty array is the only thing a caller may treat as submittable. These are
 * the rules for *both* boundaries: the form asks this before it reports, and
 * createDecision() asks this before it builds a record. One list of rules and
 * one set of message strings, so a record cannot be written in a state the form
 * would have refused, and a refusal from the write path is worded exactly the
 * way the field beside the box is worded.
 */
export function validateDecisionEntry(values = {}, options = {}) {
  return DECISION_ENTRY_FIELDS
    .map((field) => ({ field, message: decisionEntryFieldError(field, values[field], options) }))
    .filter(({ message }) => message !== null);
}

/**
 * The same rules, in the shape a write path wants: `{ ok, failures }`.
 *
 * A caller that is about to persist a record asks `ok` and, when it is false,
 * carries `failures[0].message` — which is the identical string the form puts
 * beside that field.
 */
export function validateDecision(record = {}, options = {}) {
  const failures = validateDecisionEntry(record, options);
  return { ok: failures.length === 0, failures };
}

// The single line the form-level live region carries: what is blocking this
// save, and how much else is waiting behind it. It names the first failing
// field — the one focus just landed on — and counts the rest rather than
// restating them, because each of those is already on the field it belongs to
// and a summary that repeats them reads the whole form twice to a screen reader.
//
// Takes the failing fields rather than a bare count, because the caller corrects
// this line as fields are fixed one at a time and the field that blocks the save
// changes as they go.
export function decisionEntrySummary(failures = []) {
  const fields = (Array.isArray(failures) ? failures : [])
    .map((failure) => (typeof failure === "string" ? failure : failure?.field))
    .filter((field) => DECISION_ENTRY_FIELDS.includes(field));
  if (fields.length === 0) return "";
  const blocking = `${DECISION_ENTRY_LABELS[fields[0]]} is blocking this save.`;
  const remaining = fields.length - 1;
  if (remaining === 0) return `${blocking} No other field needs attention.`;
  return remaining === 1
    ? `${blocking} 1 more field needs attention.`
    : `${blocking} ${remaining} more fields need attention.`;
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
