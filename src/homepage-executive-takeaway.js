// The homepage's short, forwardable reading of the bundled worked decision.
// Keep this byte-identical to #executive-takeaway-text: the visible paragraph
// lets a reader verify the clipboard payload before activating the control.
// Every claim here EXCEPT THE PERIOD is authored rather than composed, because the composer that
// publishes it on AI FinOps carries an import graph this first screen must not
// pay for. Authored, then, but not unpinned: the test file holds all four
// claims against `buildStandHeadline()` and `buildFirstRunResult()`, so a
// rename or a re-rank in the example data fails the build here rather than
// quietly forwarding a stale number to somebody's boss.
// The one claim here that is NOT authored. Everything else in the sentence is
// pinned prose, but a period is cheap to derive — `analyzed-period.js` imports
// nothing — and a forwarded figure with no window on it is the reply the
// takeaway was getting most.
import { analyzedPeriodPhrase, reportingWindow } from "./analyzed-period.js";

/**
 * The window the figures above cover, in words: "June 2026" for the bundled
 * example, whatever the bundled months become for anything else. Null when no
 * window can be named, which is a state the sentence below has a shape for.
 */
export const ANALYZED_PERIOD = analyzedPeriodPhrase(reportingWindow());

/**
 * The takeaway, with the span appended to the figure sentence rather than added
 * as a block of its own: the first screen has no room above the fold and no
 * spare tab stops, and a period belongs to the figure it qualifies anyway.
 *
 * #1858: the clause reads "in June 2026 alone", not "across June 2026". The
 * block below this one tells a reader the example ships three synthetic months,
 * so "across" left the money readable as a quarter's — an order of magnitude on
 * the one figure this page asks anyone to act on. The bundled export set is six
 * months (see `EXAMPLE_MONTHS`) and $154,500 is the last of them, so the word
 * that has to be on the sentence is the one that says this is a single month's
 * figure and not the bundle's total.
 *
 * The clause is dropped whole when no period can be named. There is no state in
 * which this prints "in " with nothing after it.
 */
export function takeawayText(period = ANALYZED_PERIOD) {
  const span = typeof period === "string" && period.trim() ? ` in ${period.trim()} alone` : "";
  return `$51,254 of $154,500 in analyzed AI spend is recoverable (33%)${span} `
    + "— a modelled ceiling on what re-routing this work could save, not money already saved. "
    + "First recommended action: Pilot lower-cost routing in Atlas Platform. "
    + "Accountable role: Platform Engineering Lead. Figures are from a bundled synthetic example "
    + "and are not visitor data.";
}

export const EXECUTIVE_TAKEAWAY = takeawayText();

export const TAKEAWAY_COPY_FEEDBACK = Object.freeze({
  copied: "Executive takeaway copied.",
  failed: "Could not copy the executive takeaway. Select the text above and copy it manually.",
});

import {
  CONTACT_COPY, emailFieldError, looksLikeEmail, postLeadEmail, SubmissionError,
} from "./lead-capture.js";

export const FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE = "follow_up_finops_example";

/**
 * The second ask on this page, in the section that sells the decision and
 * release log rather than the bundled AI FinOps example. It is a different
 * errand and it is stored as one: a row written under this purpose says the
 * visitor asked about the log, which is the only thing the reply has to know.
 *
 * The whole path is real end to end — `LEAD_PURPOSES` accepts it, migration
 * 0010 widens the `lead_submissions` purpose CHECK to it, and
 * tests/homepage-decision-log-follow-up.test.js drives the submit handler into
 * the shipped Pages Function over a migrated database and reads the row back.
 * Adding the constant without the migration would be a topic the storage layer
 * refuses, answered to the visitor as a receipt.
 */
export const DECISION_LOG_FOLLOW_UP_PURPOSE = "follow_up_decision_log";

/** Wire the native copy button. The clipboard is injectable for focused tests. */
export function bindExecutiveTakeaway(doc = globalThis.document, clipboard = globalThis.navigator?.clipboard) {
  const button = doc?.getElementById("copy-executive-takeaway");
  const text = doc?.getElementById("executive-takeaway-text");
  const status = doc?.getElementById("executive-takeaway-status");
  if (!button || !text || !status) return false;

  button.addEventListener("click", async () => {
    try {
      if (typeof clipboard?.writeText !== "function") throw new Error("Clipboard unavailable");
      await clipboard.writeText(EXECUTIVE_TAKEAWAY);
      status.textContent = TAKEAWAY_COPY_FEEDBACK.copied;
    } catch {
      status.textContent = TAKEAWAY_COPY_FEEDBACK.failed;
    }
  });
  return true;
}

/**
 * Wire one contextual request without sending the visible topic as
 * visitor-authored data.
 *
 * `prefix` names a panel's own five nodes and `purpose` the fixed routing label
 * its submit sends. THE PAGE CARRIES TWO OF THESE and they must not be able to
 * reach each other, so everything that could couple them is scoped here: the
 * nodes are looked up once per call and closed over, the in-flight and settled
 * state lives on that form's own `data-state`, the submit listener is on the
 * form rather than on the document, and this module keeps no state of its own
 * between calls. `postLeadEmail` builds the whole request body from the typed
 * address and `purpose`, so neither panel has a route to the other's field.
 */
export function bindContextualFollowUp(doc, request, { prefix, purpose }) {
  const open = doc?.getElementById(`${prefix}-open`);
  const panel = doc?.getElementById(`${prefix}-panel`);
  const form = doc?.getElementById(`${prefix}-form`);
  const status = doc?.getElementById(`${prefix}-status`);
  const error = doc?.getElementById(`${prefix}-error`);
  if (!open || !panel || !form || !status || !error) return null;
  const email = form.elements.email;
  const submit = form.querySelector('button[type="submit"]');

  open.addEventListener("click", () => {
    panel.hidden = false;
    open.setAttribute("aria-expanded", "true");
    email.focus();
  });
  email.addEventListener("input", () => {
    error.hidden = true;
    error.textContent = "";
    email.removeAttribute("aria-invalid");
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.state === "submitting" || form.dataset.state === "success") return;
    const invalid = emailFieldError(email.value, looksLikeEmail(email.value), CONTACT_COPY);
    if (invalid) {
      form.dataset.state = "invalid";
      error.textContent = invalid;
      error.hidden = false;
      email.setAttribute("aria-invalid", "true");
      status.textContent = "";
      email.focus();
      return;
    }
    form.dataset.state = "submitting";
    error.hidden = true;
    email.removeAttribute("aria-invalid");
    submit.disabled = true;
    submit.setAttribute("aria-disabled", "true");
    status.textContent = "Sending your follow-up request…";
    try {
      await postLeadEmail(request, email.value, purpose, CONTACT_COPY);
      form.dataset.state = "success";
      for (const control of [form.elements.topic, email, submit]) control.disabled = true;
      status.textContent = "Follow-up requested. Someone from Wawalu will reply by email.";
    } catch (caught) {
      form.dataset.state = "error";
      status.textContent = caught instanceof SubmissionError ? caught.message : CONTACT_COPY.unconfirmed;
      email.setAttribute("aria-invalid", "true");
      submit.disabled = false;
      submit.removeAttribute("aria-disabled");
    }
  });
  return form;
}

/** The takeaway's own request: a follow-up about the bundled AI FinOps example. */
export function bindFinopsExampleFollowUp(doc = globalThis.document, request = (...args) => globalThis.fetch(...args)) {
  return bindContextualFollowUp(doc, request,
    { prefix: "finops-example-follow-up", purpose: FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE });
}

/** The decision and release log's request, in the section that describes it. */
export function bindDecisionLogFollowUp(doc = globalThis.document, request = (...args) => globalThis.fetch(...args)) {
  return bindContextualFollowUp(doc, request,
    { prefix: "decision-log-follow-up", purpose: DECISION_LOG_FOLLOW_UP_PURPOSE });
}

if (globalThis.document) {
  bindExecutiveTakeaway();
  bindFinopsExampleFollowUp();
  bindDecisionLogFollowUp();
}
