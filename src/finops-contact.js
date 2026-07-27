// The contact affordance that sits under the AI FinOps result.
//
// A leader who has just read a decision brief — the bundled example one or the
// one computed from their own export — has exactly one thing they might want
// that this page cannot give them: a person. This module is that, and nothing
// more.
//
// Three rules hold it together:
//
//   1. It never touches the result. The form is a disclosure *beside* the
//      analysis, never in place of it; opening, submitting, failing, and
//      dismissing all leave every rendered figure exactly where it was. There is
//      no code path in here that writes to an analysis surface.
//   2. The payload is built from the typed field and nothing else. The whole
//      body is assembled by `postLeadEmail` in lead-capture.js out of one
//      argument — the address in the input — so the visible claim ("only what
//      you type is sent") is a property of the code, not a promise on a page.
//      This module holds no reference to the import state and imports nothing
//      that does.
//   3. Failure copy exists only after a failure. The recovery paragraph starts
//      hidden *and* unreferenced by the field's accessible description, because
//      a hidden node named by aria-describedby is still read aloud.
//
// The transport, the validation, and the failure-to-copy mapping are the home
// page's; only the wording and the disclosure behaviour are new here.

import {
  describeWith, emailFieldError, looksLikeEmail, postLeadEmail, SubmissionError, UNCONFIRMED_COPY,
} from "./lead-capture.js";

const ERROR_ID = "finops-contact-error";
const RECOVERY_ID = "finops-contact-recovery";

// What a visitor is told once the address is stored. It names the one thing that
// travelled, who answers, and by when. Two business days is the commitment this
// makes; nothing here claims a customer, a saving, or an outcome.
const CAPTURED = "Sent — your email address, and nothing else. Someone here replies within two "
  + "business days. We cannot see your analysis, so say in your reply what you would like to go through.";
const ALREADY_CAPTURED = "That address is already on our list, so nothing new was stored. Someone here "
  + "replies within two business days.";

const SUBMITTING = "Sending your email address…";

export function initFinopsContact(root = document, request = (...args) => globalThis.fetch(...args)) {
  const form = root.querySelector("#finops-contact-form");
  const trigger = root.querySelector("#finops-contact-open");
  const panel = root.querySelector("#finops-contact-panel");
  if (!form || !trigger || !panel) return null;

  const email = form.elements.email;
  const submit = form.querySelector('button[type="submit"]');
  const dismiss = root.querySelector("#finops-contact-dismiss");
  const fieldError = root.querySelector(`#${ERROR_ID}`);
  const status = root.querySelector("#finops-contact-status");
  const recovery = root.querySelector(`#${RECOVERY_ID}`);

  function setFieldError(message) {
    fieldError.textContent = message ?? "";
    fieldError.hidden = !message;
    describeWith(email, ERROR_ID, Boolean(message));
    if (message) email.setAttribute("aria-invalid", "true");
    else email.removeAttribute("aria-invalid");
  }

  function setRecoveryVisible(visible) {
    recovery.hidden = !visible;
    describeWith(email, RECOVERY_ID, visible);
  }

  function open() {
    if (!panel.hidden) return;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    // Disclosing a form and leaving focus on the trigger behind it is the whole
    // failure this control exists to avoid, so focus lands on the first field.
    email.focus();
  }

  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    // Focus goes back where the visitor left it. Anything else drops a keyboard
    // user at the top of the document, above the result they were reading.
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
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const invalid = emailFieldError(email.value, looksLikeEmail(email.value));
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
    submit.disabled = true;
    submit.setAttribute("aria-disabled", "true");
    status.textContent = SUBMITTING;

    try {
      const body = await postLeadEmail(request, email.value);
      form.dataset.state = "success";
      status.textContent = body?.subscribed === false ? ALREADY_CAPTURED : CAPTURED;
    } catch (error) {
      // Copy this repository owns, never a string an intermediary supplied, and
      // never a claim that the address was lost when that is not known.
      form.dataset.state = "error";
      status.textContent = error instanceof SubmissionError ? error.message : UNCONFIRMED_COPY;
      setRecoveryVisible(true);
    } finally {
      submit.disabled = false;
      submit.removeAttribute("aria-disabled");
    }
  });

  return form;
}
