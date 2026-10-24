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

// Receipt copy acknowledges submitted fields without displaying the note.
// Surfaces supply their established reply guidance; storage guarantees no reply.
export const CONFIRMATION_LEAD = "Request received. Submitted work email: ";
export const CONFIRMATION_DETAIL = "Only that work email was entered by you and sent. The Wawalu team may review the request and reply; a reply is not guaranteed.";
export const CONFIRMATION_MESSAGE_DETAIL = "Only that work email and the message you entered were entered by you and sent. The Wawalu team may review the request and reply; a reply is not guaranteed.";
export const CONFIRMATION_INTENT_DETAIL = "Your discussion choice has been saved. The Wawalu team may review the request and reply; a reply is not guaranteed.";
export const CONFIRMATION_INTENT_MESSAGE_DETAIL = "Your discussion choice and the message you entered have been saved. The Wawalu team may review the request and reply; a reply is not guaranteed.";
export const REPEAT_NOTE_DETAIL = "Your work email was already recorded. The original note was kept; the note in this submission did not replace it.";
export const TOPIC_LEAD ="Fixed page topic: ";
export const INTENT_LEAD = "What you want to discuss: ";
export const SUBJECT_LEAD = "Asked about: ";
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
export function createFollowUpConfirmation({ form, status, submit, email, replyGuidance = "", onReopen = () => {} }) {
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
  // Empty unless the surface sent a topic. See `show`.
  const topic = document.createElement("strong");
  topic.className = `${base}-confirmation-topic`;
  const intent = document.createElement("strong");
  intent.className = topic.className;
  const subject = document.createElement("strong");
  subject.className = topic.className;
  const explanation = document.createElement("span");
  detail.append(subject, topic, intent, explanation);

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

  const reply = document.createElement("p");
  reply.className = `${base}-confirmation-detail`;
  reply.textContent = replyGuidance;
  reply.hidden = !replyGuidance;
  region.append(lead, detail, reply, again);

  let sent = false;

  /**
   * Put the panel into its terminal state, naming exactly what was submitted.
   *
   * `submittedTopic` is the surface's readonly topic field, which most surfaces
   * do not ship. A default here would read a topic back to a visitor whose
   * request carried none — untrue the way a promised reply is untrue — so the
   * sentence appears only where the field does. `storedIntent` is the label for
   * the intent the endpoint read back, so it too is empty unless one is known.
   */
  function show(value, submittedTopic = "", messageProvided = false, storedIntent = "", asked = "", created = true) {
    address.textContent = value;
    subject.textContent = asked ? `${SUBJECT_LEAD}${asked}. ` : "";
    topic.textContent = submittedTopic ? `${TOPIC_LEAD}${submittedTopic}. ` : "";
    intent.textContent = storedIntent ? `${INTENT_LEAD}${storedIntent}. ` : "";
    explanation.textContent = storedIntent || asked
      ? (messageProvided ? CONFIRMATION_INTENT_MESSAGE_DETAIL : CONFIRMATION_INTENT_DETAIL)
      : messageProvided ? CONFIRMATION_MESSAGE_DETAIL : CONFIRMATION_DETAIL;
    if (!created && messageProvided) explanation.textContent = REPEAT_NOTE_DETAIL;
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
