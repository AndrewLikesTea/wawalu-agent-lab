// The contact affordance that sits under a FinOps briefing.
//
// A leader who has just read a briefing — the bundled example one, the one
// computed from their own export, or the one-page executive briefing built from
// what their browser already holds — has exactly one thing they might want that
// the page cannot give them: a person. This module is that, and nothing more.
//
// It drives two surfaces now, so every id it touches is derived from a `prefix`
// rather than written out: `finops-contact` on the AI FinOps result and
// `briefing-contact` on the executive briefing. The markup stays with each page
// — the copy beside a briefing is not the copy beside an import — but the
// behaviour, the transport, and the promise made once an address lands are one
// implementation, so the two surfaces cannot drift apart.
//
// Four rules hold it together:
//
//   1. It never touches the result. The form is a disclosure *beside* the
//      analysis, never in place of it; opening, submitting, failing, and
//      dismissing all leave every rendered figure exactly where it was. There is
//      no code path in here that writes to an analysis surface.
//   2. The payload is built from the typed field and the fixed `follow_up`
//      routing label. `postLeadEmail` in lead-capture.js accepts no page state,
//      so the visible claim ("only what you type is sent") is a property of the code, not a promise on a page.
//      This module holds no reference to the import state and imports nothing
//      that does.
//   3. Failure copy exists only after a failure. The recovery paragraph starts
//      hidden *and* unreferenced by the field's accessible description, because
//      a hidden node named by aria-describedby is still read aloud. The
//      next-step paragraph follows the same rule from the other direction: it
//      exists only after a success, because until then there is nothing to do
//      next.
//   4. A visitor who has just read a figure never has to go looking for the
//      form. Any control marked `data-follow-up-cta="<prefix>"` anywhere on the
//      page opens this panel and puts the cursor in the field, so the invitation
//      can sit beside the brief while the form itself stays outside the region
//      that re-renders.
//
// The transport, the validation, and the failure-to-copy mapping are the home
// page's. This form asks for the same thing the site footer's does — a person,
// getting back to you — so it reads from the same CONTACT_COPY set rather than
// wording a rejection its own way. What it does own is the promise it makes once
// the address lands, which is more specific than the footer's.

import { createFollowUpConfirmation } from "./follow-up-confirmation.js";
import {
  CONTACT_COPY, describeWith, emailFieldError, looksLikeEmail, postLeadEmail, SubmissionError,
} from "./lead-capture.js";

/**
 * What a visitor is told once the address is stored: that it arrived, and what
 * arrived with it. No reply, no response time, no next action — this surface
 * files a request into a queue and nothing downstream of it is guaranteed, so
 * naming a person or a deadline here would be writing a commitment the product
 * cannot keep. Neither does it claim a customer, a saving, or an outcome.
 *
 * It opens on "Request received" for the same reason the site footer's does: the
 * live region announces this sentence on its own, out of the context of the
 * button that was pressed, so the first words have to say which request
 * succeeded rather than merely that something was sent.
 */
export const CAPTURED = "Request received. Your submitted work email was recorded.";
export const ALREADY_CAPTURED = "Request received. That work email was already recorded, so no duplicate row was added.";

const SUBMITTING = "Requesting a follow-up — sending your email address…";

/**
 * Wire one contact panel.
 *
 * `prefix` names the family of ids the surface ships: `<prefix>-form`, `-open`,
 * `-panel`, `-email`, `-error`, `-status`, `-recovery`, `-dismiss`, `-next`. A
 * page that ships none of them gets `null` and no listeners.
 */
export function initFinopsContact(
  root = document,
  request = (...args) => globalThis.fetch(...args),
  { prefix = "finops-contact" } = {},
) {
  const ERROR_ID = `${prefix}-error`;
  const RECOVERY_ID = `${prefix}-recovery`;
  const form = root.querySelector(`#${prefix}-form`);
  const trigger = root.querySelector(`#${prefix}-open`);
  const panel = root.querySelector(`#${prefix}-panel`);
  if (!form || !trigger || !panel) return null;

  const email = form.elements.email;
  const submit = form.querySelector('button[type="submit"]');
  const retry = root.querySelector(`#${prefix}-retry`);
  const dismiss = root.querySelector(`#${prefix}-dismiss`);
  const fieldError = root.querySelector(`#${ERROR_ID}`);
  const status = root.querySelector(`#${prefix}-status`);
  const recovery = root.querySelector(`#${RECOVERY_ID}`);
  // Optional: a surface may offer no next action, and one that does not still
  // works. It is never named by aria-describedby — it is a place to go, not a
  // description of the field.
  const nextStep = root.querySelector(`#${prefix}-next`);

  function setFieldError(message) {
    fieldError.textContent = message ?? "";
    fieldError.hidden = !message;
    describeWith(email, ERROR_ID, Boolean(message));
    if (message) email.setAttribute("aria-invalid", "true");
    else email.removeAttribute("aria-invalid");
  }

  function setRecoveryVisible(visible) {
    recovery.hidden = !visible;
    if (retry) {
      retry.hidden = !visible;
      submit.hidden = visible;
    }
    describeWith(email, RECOVERY_ID, visible);
  }

  function setNextStepVisible(visible) {
    if (nextStep) nextStep.hidden = !visible;
  }

  // The success state, from the same source as the site footer's, so the two
  // panels cannot word a landed request differently. It replaces the form and
  // leaves the next-step paragraph exactly where it is — that paragraph is a
  // sibling of the form, not part of it, which is what lets a confirmed request
  // on the executive briefing still offer somewhere to go.
  const confirmation = createFollowUpConfirmation({
    form,
    status,
    submit,
    email,
    // Asking for the form back is saying the last request is not the story any
    // more: its outcome and the action it left behind both go.
    onReopen: () => {
      status.textContent = "";
      delete form.dataset.state;
      setNextStepVisible(false);
    },
  });

  function open() {
    if (!panel.hidden) return;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    // Disclosing a form and leaving focus on the trigger behind it is the whole
    // failure this control exists to avoid, so focus lands on the first field —
    // or, once a request has landed and taken the form away, on the receipt.
    if (confirmation.sent) confirmation.region.focus();
    else email.focus();
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

  // The contextual invitations. They live beside — or inside — the brief a
  // visitor has just read, which is a region this module must never render into
  // and, on the executive briefing, a region that is *repainted* whole. So the
  // listener is delegated from the root rather than bound to the nodes that
  // happen to exist at wiring time: an invitation drawn into the sheet after
  // this ran works on its first press, and one a repaint unmounted leaves no
  // dead listener behind.
  //
  // All an invitation does is bring the reader to this form: open it if it is
  // shut, and land the cursor in the field either way, so a second press is
  // never a way to close the form a visitor just asked for.
  root.addEventListener("click", (event) => {
    if (!event.target?.closest?.(`[data-follow-up-cta="${prefix}"]`)) return;
    open();
    if (confirmation.sent) confirmation.region.focus();
    else email.focus();
  });

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
    // Terminal until the visitor reopens the form: nothing on screen can fire
    // this once the receipt is up, and this keeps that true for anything else.
    if (confirmation.sent) return;
    const invalid = emailFieldError(email.value, looksLikeEmail(email.value), CONTACT_COPY);
    if (invalid) {
      // Whatever was typed stays; the field is never cleared to "help".
      form.dataset.state = "invalid";
      setFieldError(invalid);
      setRecoveryVisible(false);
      setNextStepVisible(false);
      status.textContent = "";
      email.focus();
      return;
    }

    form.dataset.state = "submitting";
    setFieldError(null);
    setRecoveryVisible(false);
    setNextStepVisible(false);
    submit.disabled = true;
    submit.setAttribute("aria-disabled", "true");
    status.textContent = SUBMITTING;

    try {
      const address = email.value.trim();
      const body = await postLeadEmail(request, email.value, "follow_up", CONTACT_COPY);
      form.dataset.state = "success";
      status.textContent = body.created ? CAPTURED : ALREADY_CAPTURED;
      // Waiting two business days is not a next action, so the surface offers
      // one: somewhere to go now, in this tab, that does not depend on the reply.
      // It survives the swap below: the form goes, this stays.
      setNextStepVisible(true);
      confirmation.show(address, form.elements.topic?.value);
    } catch (error) {
      // Copy this repository owns, never a string an intermediary supplied, and
      // never a claim that the address was lost when that is not known.
      form.dataset.state = "error";
      status.textContent = error instanceof SubmissionError ? error.message : CONTACT_COPY.unconfirmed;
      setRecoveryVisible(true);
    } finally {
      // Retry has to work without a reload — but not on the path where the
      // request landed and the form went away with it.
      if (!confirmation.sent) {
        submit.disabled = false;
        submit.removeAttribute("aria-disabled");
      }
    }
  });

  return form;
}
