// The third state of a follow-up form: it landed. Written once, for both
// work-email panels — the About Shiplog one in the footer (src/site-footer.js)
// and the one under a FinOps brief (src/finops-contact.js) — so the two cannot
// word a success differently.
//
//   1. Success is terminal until the visitor says otherwise. The form is hidden
//      and its submit control disabled, so no click, key press, or tab stop can
//      send twice; `sent` is checked by the submit handler too. Coming back is
//      the reopen button, a deliberate act.
//   2. The address is rendered as text. `textContent` is all this module writes,
//      so nothing a visitor types can become a node.
//
// Announcement follows the panel rather than inventing a second pattern: the
// surface's status paragraph carries the outcome sentence exactly as it does on
// failure, and the receipt is a `role="status"` region too and takes focus. A
// live region inserted already-populated is not reliably announced, so focus
// landing on the receipt is what puts a reader inside it.

/**
 * The receipt answers two questions and nothing else: what was sent and what did
 * not go with it. `LEAD` is deliberately split
 * around the address so the address arrives as a text node of its own.
 *
 * The exclusion list is not decoration. `postLeadEmail` builds the whole request
 * body from the typed address and a fixed routing label, so no page state has a
 * route to the wire on any surface — the sentence is true by construction, and
 * naming what stayed behind is the point of it. No response or action is
 * promised after receipt.
 */
export const CONFIRMATION_LEAD = "Request received. Work email sent: ";
export const CONFIRMATION_DETAIL = "Also sent: the follow-up request type. No page content, prompt text, uploaded file, or browsing data was sent.";
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
export function createFollowUpConfirmation({ form, status, submit, email, topic = null, onReopen = () => {} }) {
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

  const topicDetail = document.createElement("p");
  topicDetail.className = `${base}-confirmation-detail`;

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
    if (topic) {
      topicDetail.textContent = `Follow-up topic sent: ${topic}.`;
      if (!topicDetail.parentNode) region.insertBefore(topicDetail, again);
    }
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
