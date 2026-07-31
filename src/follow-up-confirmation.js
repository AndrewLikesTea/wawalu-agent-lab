// The third state of a follow-up form: it landed.
//
// Both work-email panels — the About Shiplog one in the footer
// (src/site-footer.js) and the one under a FinOps brief, including the executive
// briefing's copy of it (src/finops-contact.js) — had two visible outcomes and
// one invisible one. A failure got a red box and a way to retry; a success got a
// sentence in the live region above a form that still looked ready to send. This
// is the missing state, written once so the two cannot word it differently.
//
//   1. Success is terminal until the visitor says otherwise. The form is hidden
//      and its submit control disabled, so no click, key press, or tab stop can
//      send twice; `sent` is checked by the submit handler too, so nothing
//      synthetic can either. Coming back is the reopen button, a deliberate act.
//   2. The address is rendered as text. `textContent` is all this module writes,
//      so nothing a visitor types can become a node.
//   3. It says only what the request carried. `postLeadEmail` builds the whole
//      body from the address in the field, so the receipt names the address and
//      repeats the form's own privacy vocabulary — no figure, file, filter, or
//      page identity — and promises no response time, because nobody here has
//      committed to one.
//
// Announcement follows the panel rather than inventing a second pattern: the
// surface's status paragraph is a `role="status"` region and still carries the
// outcome sentence exactly as it does on failure, and the receipt is one too and
// takes focus. In practice the sentence is what a screen reader speaks — a live
// region inserted already-populated is not reliably announced — and focus
// landing on the receipt is what puts a reader inside it.

/**
 * The receipt, in the register the forms already use: what was sent, who reads
 * it, and what did not travel. `LEAD` is deliberately split around the address
 * so the address arrives as a text node of its own.
 */
export const CONFIRMATION_LEAD = "We sent one thing: ";
export const CONFIRMATION_DETAIL = "A person from the Wawalu team replies to that address by email. "
  + "Nothing else on this page — nothing you have read, filtered, imported, or exported — was read, "
  + "attached, or transmitted.";
export const REOPEN_LABEL = "Request another follow-up";

/**
 * The class family a surface already uses, read off its status paragraph:
 * `.site-footer-status` names the `site-footer-` family, `.brief-contact-status`
 * the `brief-contact-` one. Derived rather than passed so a caller cannot wire a
 * panel to styles that belong to another page.
 */
function classBase(status) {
  const found = status.className.split(/\s+/).find((name) => name.endsWith("-status"));
  return found ? found.slice(0, -"-status".length) : "follow-up";
}

/**
 * Give one panel a success state.
 *
 * `form`, `status` and `submit` are nodes the surface already ships; `email` is
 * where focus returns when the visitor asks for the form back, and `onReopen` is
 * that surface's own cleanup for the moment (its live region, its next step).
 * The receipt is built here rather than shipped in every page's markup: it
 * exists only after a request lands, so there is no hidden node for a screen
 * reader to find first.
 */
export function createFollowUpConfirmation({ form, status, submit, email, onReopen = () => {} }) {
  const document = form.ownerDocument;
  const base = classBase(status);
  const prefix = form.id.replace(/-form$/, "");

  const region = document.createElement("div");
  region.className = `${base}-confirmation`;
  region.id = `${prefix}-confirmation`;
  region.setAttribute("role", "status");
  region.setAttribute("aria-live", "polite");
  // The focus target. Not a tab stop — a reader tabs out of it to the reopen
  // control, never back into a receipt they have already read.
  region.setAttribute("tabindex", "-1");

  const lead = document.createElement("p");
  lead.className = `${base}-confirmation-lead`;
  const mark = document.createElement("span");
  mark.className = `${base}-confirmation-mark`;
  // Decoration. The sentence beside it already says what happened, and a glyph
  // read aloud as "check mark" says it worse.
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "✓";
  const address = document.createElement("strong");
  address.className = `${base}-confirmation-address`;
  lead.append(mark, CONFIRMATION_LEAD, address, ".");

  const detail = document.createElement("p");
  detail.className = `${base}-confirmation-detail`;
  detail.textContent = CONFIRMATION_DETAIL;

  const again = document.createElement("button");
  again.className = `${base}-confirmation-again`;
  again.id = `${prefix}-again`;
  again.setAttribute("type", "button");
  again.textContent = REOPEN_LABEL;
  again.addEventListener("click", () => {
    reset();
    onReopen();
    // The visitor asked for the form, so the cursor goes in it — the same rule
    // the disclosure button follows.
    email.focus();
  });

  region.append(lead, detail, again);

  let sent = false;

  /** Put the panel into its terminal state, naming the address that was sent. */
  function show(value) {
    address.textContent = value;
    if (!region.parentNode) form.parentNode.insertBefore(region, form);
    // Hiding the form takes the field and both of its buttons out of the tab
    // order; disabling submit means even a stray click on it does nothing.
    form.hidden = true;
    submit.disabled = true;
    submit.setAttribute("aria-disabled", "true");
    sent = true;
    region.focus();
  }

  /** Back to the form, unsent, with whatever was typed still in the field. */
  function reset() {
    if (!sent) return;
    sent = false;
    region.remove();
    form.hidden = false;
    submit.disabled = false;
    submit.removeAttribute("aria-disabled");
  }

  return { show, reset, region, get sent() { return sent; } };
}
