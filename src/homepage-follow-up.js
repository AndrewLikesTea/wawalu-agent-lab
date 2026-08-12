// The home page's named hand-raise: the control that sits with the executive
// takeaway and reveals a follow-up request form in the block a reader is already
// standing in, instead of sending them to the footer or to another page.
//
// It is the same errand the footer's panel runs, so it is not allowed to make
// different claims. Everything a visitor reads here is imported rather than
// retyped: the privacy sentence from src/lead-capture.js, the receipt from
// src/follow-up-confirmation.js, and the three outcome sentences from
// src/site-footer.js. The transport is `postLeadEmail`, so the request body is
// still the typed address and a fixed routing label and nothing else.
//
// What this file does not do is reach into the footer's wiring. `initSiteFooter`
// resolves its nodes by fixed ids, so a second panel on the same page needs the
// wiring parameterised by prefix — which is what `initFollowUpPanel` below is —
// but doing that inside site-footer.js would grow site-footer-page.js's static
// import graph, and config/evolution-size-budget.json caps that graph with about
// a hundred bytes to spare. So the parameterised version lives here, behind the
// home page's own entry, and the footer keeps its own copy of the state machine
// until somebody has the bytes to merge the two. The words are shared, which is
// the part that would otherwise drift; the plumbing is duplicated on purpose.
//
// The panel reuses the `site-footer-` class family for the same reason: those
// rules already exist in src/styles.css, and a second set of identical rules
// would be paid for out of that file's budget. `createFollowUpConfirmation`
// reads the family off the status paragraph, so the receipt is styled too.

import { createFollowUpConfirmation } from "./follow-up-confirmation.js";
import {
  CONTACT_COPY, describeWith, emailFieldError, looksLikeEmail, postLeadEmail, SubmissionError,
} from "./lead-capture.js";
import { ALREADY_CAPTURED, CAPTURED, SUBMITTING } from "./site-footer.js";

/** The home page's panel. A prefix, not an id, is what makes a second one possible. */
export const TAKEAWAY_PREFIX = "takeaway-contact";

/**
 * The name the control carries.
 *
 * Every control that opens or submits a follow-up form reads "Request a
 * follow-up" — see tests/follow-up-cta-label.test.js — and this one deliberately
 * does not, because it is the only one with no sentence beside it doing the
 * naming. It sits in a row of takeaway actions between "Copy executive takeaway"
 * and the link into AI FinOps, where an unqualified CTA would be a third button
 * with no subject. So the label carries the subject and the submit control
 * inside the panel carries the shared CTA.
 */
export const HAND_RAISE_LABEL = "Ask the team about your own spend";

/**
 * Bring one follow-up panel to life, resolving its nodes from `prefix`.
 *
 * `request` is deferred to call time for the reason every form on this site
 * defers it: a test that takes over `globalThis.fetch` after the page mounts
 * must still be the one that receives the submission.
 */
export function initFollowUpPanel(
  root = document,
  request = (...args) => globalThis.fetch(...args),
  prefix = TAKEAWAY_PREFIX,
) {
  const at = (suffix) => `${prefix}-${suffix}`;
  const form = root.querySelector(`#${at("form")}`);
  const trigger = root.querySelector(`#${at("open")}`);
  const panel = root.querySelector(`#${at("panel")}`);
  if (!form || !trigger || !panel) return null;

  const email = form.elements.email;
  const submit = form.querySelector('button[type="submit"]');
  const dismiss = root.querySelector(`#${at("dismiss")}`);
  const fieldError = root.querySelector(`#${at("error")}`);
  const status = root.querySelector(`#${at("status")}`);
  const recovery = root.querySelector(`#${at("recovery")}`);
  const retry = root.querySelector(`#${at("retry")}`);

  function setFieldError(message) {
    fieldError.textContent = message ?? "";
    fieldError.hidden = !message;
    describeWith(email, at("error"), Boolean(message));
    if (message) email.setAttribute("aria-invalid", "true");
    else email.removeAttribute("aria-invalid");
  }

  // A failure is recovered here, on the page and in the block it happened in:
  // the retry stands where the send control was and submits this form again,
  // value and all.
  function setRecoveryVisible(visible) {
    recovery.hidden = !visible;
    if (retry) {
      retry.hidden = !visible;
      submit.hidden = visible;
    }
    describeWith(email, at("recovery"), visible);
  }

  // A success moves focus into the receipt. A failure leaves a reader at the
  // field they have to resubmit, so that field carries the outcome in its
  // description and reads as invalid until another request starts.
  function setOutcomeDescribed(failed) {
    describeWith(email, at("status"), failed);
    if (failed) email.setAttribute("aria-invalid", "true");
    else email.removeAttribute("aria-invalid");
  }

  const confirmation = createFollowUpConfirmation({
    form,
    status,
    submit,
    email,
    onReopen: () => { status.textContent = ""; delete form.dataset.state; setOutcomeDescribed(false); },
  });

  function open() {
    if (!panel.hidden) return;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    // Revealing a form and leaving focus above it strands a keyboard reader at
    // the moment they asked for the form. After a request has landed there is no
    // form to land in, so the receipt takes the focus.
    if (confirmation.sent) confirmation.region.focus();
    else email.focus();
  }

  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    // Focus returns to the control that opened the panel, which is the only
    // thing standing between the reader and the takeaway they were reading.
    trigger.focus();
  }

  trigger.addEventListener("click", () => (panel.hidden ? open() : close()));
  dismiss?.addEventListener("click", close);
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  });

  // Editing the field retracts the diagnostic about it. The submission outcome
  // in the live region stays: it reports something that happened, not something
  // about the current value.
  email.addEventListener("input", () => {
    if (form.dataset.state === "invalid") {
      delete form.dataset.state;
      setFieldError(null);
    } else if (form.dataset.state === "error") {
      setOutcomeDescribed(false);
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (confirmation.sent) return;
    const invalid = emailFieldError(email.value, looksLikeEmail(email.value), CONTACT_COPY);
    if (invalid) {
      // Whatever was typed stays; the field is never cleared to "help".
      form.dataset.state = "invalid";
      setFieldError(invalid);
      setRecoveryVisible(false);
      status.textContent = "";
      email.focus();
      return;
    }

    form.dataset.state = "submitting";
    setFieldError(null);
    setRecoveryVisible(false);
    setOutcomeDescribed(false);
    submit.disabled = true;
    submit.setAttribute("aria-disabled", "true");
    status.textContent = SUBMITTING;

    try {
      const address = email.value.trim();
      const body = await postLeadEmail(
        request, email.value, form.dataset.followUpType || "follow_up", CONTACT_COPY,
      );
      form.dataset.state = "success";
      status.textContent = body.created ? CAPTURED : ALREADY_CAPTURED;
      confirmation.show(address);
    } catch (error) {
      // Copy this repository owns, never a string an intermediary supplied, and
      // never a claim that the address was lost when that is not known.
      form.dataset.state = "error";
      status.textContent = error instanceof SubmissionError ? error.message : CONTACT_COPY.unconfirmed;
      setRecoveryVisible(true);
      setOutcomeDescribed(true);
    } finally {
      if (!confirmation.sent) {
        submit.disabled = false;
        submit.removeAttribute("aria-disabled");
      }
    }
  });

  return form;
}

if (globalThis.document) initFollowUpPanel();
