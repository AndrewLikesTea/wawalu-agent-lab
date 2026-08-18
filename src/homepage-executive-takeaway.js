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
export const DECISION_LOG_FOLLOW_UP_PURPOSE = "follow_up_decision_log";

/**
 * The home page carries two of these now — one about the bundled AI FinOps
 * example, one about the decision and release log further down — so nothing in
 * here is looked up by a written-out id any more. Each instance owns its own
 * nodes, its own pending state, and its own live region, keyed off `prefix`;
 * two instances on one page cannot clear, submit, or re-focus each other
 * because neither holds a reference to anything outside its own family.
 *
 * What they share is the one thing that must not fork: `postLeadEmail` builds
 * the whole request body from the typed address and a fixed routing label, so
 * the visible topic is never sent as visitor-authored data and no page state
 * has a route to the wire. The topic a visitor reads is markup; the purpose a
 * server stores is a constant in this file.
 */
const FOLLOW_UP_SURFACES = Object.freeze([
  Object.freeze({
    prefix: "finops-example-follow-up",
    purpose: FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE,
    submitting: "Sending your follow-up request…",
    captured: "Follow-up requested. Someone from Wawalu will reply by email.",
  }),
  Object.freeze({
    prefix: "decision-log-follow-up",
    purpose: DECISION_LOG_FOLLOW_UP_PURPOSE,
    submitting: "Sending your follow-up request about the decision and release log…",
    // The live region reads on its own, out of the context of the button that
    // was pressed, so it has to name which of the page's two requests landed.
    captured: "Follow-up requested about the decision and release log. Someone from Wawalu will reply by email.",
  }),
]);

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

/** Wire one contextual request without sending the visible topic as visitor-authored data. */
export function bindFollowUpRequest(
  doc = globalThis.document,
  request = (...args) => globalThis.fetch(...args),
  { prefix, purpose, submitting, captured } = FOLLOW_UP_SURFACES[0],
) {
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
    status.textContent = submitting;
    try {
      await postLeadEmail(request, email.value, purpose, CONTACT_COPY);
      form.dataset.state = "success";
      for (const control of [form.elements.topic, email, submit]) control.disabled = true;
      status.textContent = captured;
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

const surface = (prefix) => FOLLOW_UP_SURFACES.find((entry) => entry.prefix === prefix);

/** The request beside the executive takeaway: the bundled AI FinOps example. */
export function bindFinopsExampleFollowUp(doc = globalThis.document, request = (...args) => globalThis.fetch(...args)) {
  return bindFollowUpRequest(doc, request, surface("finops-example-follow-up"));
}

/** The request beside the decision and release log, further down the same page. */
export function bindDecisionLogFollowUp(doc = globalThis.document, request = (...args) => globalThis.fetch(...args)) {
  return bindFollowUpRequest(doc, request, surface("decision-log-follow-up"));
}

if (globalThis.document) {
  bindExecutiveTakeaway();
  bindFinopsExampleFollowUp();
  bindDecisionLogFollowUp();
}
