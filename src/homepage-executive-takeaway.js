// The homepage's short, forwardable reading of the bundled worked decision.
// This is the EXPECTED reading, not the payload: `forwardableTakeaway()` builds
// what the clipboard gets out of the block the reader is looking at, and the
// test file asserts the two are the same string. Splitting the takeaway into a
// value, a qualification and an action block gave the page and this module two
// ways to word the same claims, and two authored copies of a money figure stay
// equal only until somebody edits one of them.
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
  return `$51,254 of $154,500 in analyzed AI spend is recoverable (33%)${span}. `
    + "Modelled ceiling: what re-routing this work could save, not money already saved. "
    + "First recommended action: Pilot lower-cost routing in Atlas Platform. "
    + "Accountable role: Platform Engineering Lead. Figures are from a bundled synthetic example "
    + "and are not visitor data.";
}

export const EXECUTIVE_TAKEAWAY = takeawayText();

/**
 * The claims the block paints, in reading order, each entry the selectors whose
 * text makes up one sentence. The action title leads its own detail, so the two
 * join with the colon the forwarded line needs and the heading does not.
 *
 * Selectors and not a walk of the subtree: the block also holds a link, and a
 * label for a control is an affordance rather than a claim anybody can be held
 * to. A claim added to the markup and not to this list fails the equality
 * against `EXECUTIVE_TAKEAWAY` rather than reaching a clipboard silently.
 */
const TAKEAWAY_CLAIMS = Object.freeze([
  [".executive-takeaway-value"],
  [".executive-takeaway-qualification"],
  ["#executive-takeaway-action-title", ".executive-takeaway-detail"],
  [".executive-takeaway-owner"],
  [".executive-takeaway-source"],
]);

/**
 * The visible takeaway as one forwardable line, or "" when any part of it is
 * missing. Empty is the fail-closed answer and the copy path treats it as a
 * failure: a payload assembled from a block that did not fully render is a
 * money claim with a piece of its qualification cut off.
 */
export function forwardableTakeaway(doc = globalThis.document) {
  const sentences = [];
  for (const selectors of TAKEAWAY_CLAIMS) {
    const said = selectors.map((selector) =>
      (doc?.querySelector(selector)?.textContent ?? "").replace(/\s+/g, " ").trim());
    if (said.some((part) => !part)) return "";
    sentences.push(said.join(": "));
  }
  return sentences.join(" ");
}

export const TAKEAWAY_COPY_FEEDBACK = Object.freeze({
  copied: "Executive takeaway copied.",
  failed: "Could not copy the executive takeaway. Select the text above and copy it manually.",
});

import {
  CONTACT_COPY, emailFieldError, looksLikeEmail, MAX_FOLLOW_UP_MESSAGE_LENGTH, postLeadEmail,
  SubmissionError,
} from "./lead-capture.js";
import { createFollowUpConfirmation } from "./follow-up-confirmation.js";

export const FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE = "follow_up_finops_example";

/**
 * The refusal, in the Social composer's words on this field's budget: how long
 * the message is, how far over it is, and what the limit is. `overLengthPostMessage`
 * in src/social.js says the same three things about a post, and this is not an
 * import of it — that module is not something the home page's first screen can
 * load for one subtraction. It is the sentence, not a second mechanism.
 */
export function overLengthMessage(length, max = MAX_FOLLOW_UP_MESSAGE_LENGTH) {
  return `Your message is ${length} characters — ${length - max} over the ${max} limit.`;
}

/** Wire the native copy button. The clipboard is injectable for focused tests. */
export function bindExecutiveTakeaway(doc = globalThis.document, clipboard = globalThis.navigator?.clipboard) {
  const button = doc?.getElementById("copy-executive-takeaway");
  const text = doc?.getElementById("executive-takeaway-text");
  const status = doc?.getElementById("executive-takeaway-status");
  if (!button || !text || !status) return false;

  button.addEventListener("click", async () => {
    try {
      if (typeof clipboard?.writeText !== "function") throw new Error("Clipboard unavailable");
      const payload = forwardableTakeaway(doc);
      if (!payload) throw new Error("Takeaway unreadable");
      await clipboard.writeText(payload);
      status.textContent = TAKEAWAY_COPY_FEEDBACK.copied;
    } catch {
      status.textContent = TAKEAWAY_COPY_FEEDBACK.failed;
    }
  });
  return true;
}

/** Wire the contextual request without sending the visible topic as visitor-authored data. */
export function bindFinopsExampleFollowUp(doc = globalThis.document, request = (...args) => globalThis.fetch(...args)) {
  const open = doc?.getElementById("finops-example-follow-up-open");
  const panel = doc?.getElementById("finops-example-follow-up-panel");
  const form = doc?.getElementById("finops-example-follow-up-form");
  const status = doc?.getElementById("finops-example-follow-up-status");
  const error = doc?.getElementById("finops-example-follow-up-error");
  const messageError = doc?.getElementById("finops-example-follow-up-message-error");
  const counter = doc?.getElementById("finops-example-follow-up-message-counter");
  if (!open || !panel || !form || !status || !error || !messageError || !counter) return null;
  const email = form.elements.email;
  const message = form.elements.message;
  const submit = form.querySelector('button[type="submit"]');
  const retry = doc.getElementById("finops-example-follow-up-retry");
  const confirmation = createFollowUpConfirmation({
    form, status, submit, email,
    onReopen: () => { status.textContent = ""; delete form.dataset.state; },
  });

  // The retry stands where the send control was, exactly as the footer's does.
  // It is optional here because this handler binds to whatever markup the page
  // ships, and a submit path that throws on a missing button would surface as an
  // unhandled rejection rather than as the failure the visitor is looking at.
  function showRetry(visible) {
    if (!retry) return;
    submit.hidden = visible;
    retry.hidden = !visible;
  }

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

  /**
   * The live count, and the refusal that arrives with it.
   *
   * Both halves come off the same measurement in the same moment, so the number
   * beside the field and the sentence under it cannot disagree about which side
   * of the limit the message is on. Returns whether it is over, because that is
   * the same question the submit path has to ask.
   */
  function updateCounter() {
    const { length } = message.value;
    const over = length > MAX_FOLLOW_UP_MESSAGE_LENGTH;
    counter.textContent = `${MAX_FOLLOW_UP_MESSAGE_LENGTH - length}`;
    messageError.textContent = over ? overLengthMessage(length) : "";
    messageError.hidden = !over;
    if (over) message.setAttribute("aria-invalid", "true");
    else message.removeAttribute("aria-invalid");
    return over;
  }
  message.addEventListener("input", updateCounter);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.state === "submitting" || form.dataset.state === "success") return;
    const invalid = emailFieldError(email.value, looksLikeEmail(email.value), CONTACT_COPY);
    if (invalid) {
      form.dataset.state = "invalid";
      // Nothing was sent, so nothing is being retried: the control goes back to
      // saying what pressing it would actually do. The footer does the same.
      showRetry(false);
      error.textContent = invalid;
      error.hidden = false;
      email.setAttribute("aria-invalid", "true");
      status.textContent = "";
      email.focus();
      return;
    }
    // Refused here, before the request, against the number the endpoint would
    // refuse it against — the field states one limit and both halves keep it.
    // Nothing typed is cleared or truncated on the way out.
    if (updateCounter()) {
      form.dataset.state = "invalid";
      showRetry(false);
      status.textContent = "";
      message.focus();
      return;
    }
    form.dataset.state = "submitting";
    showRetry(false);
    error.hidden = true;
    email.removeAttribute("aria-invalid");
    submit.disabled = true;
    submit.setAttribute("aria-disabled", "true");
    status.textContent = "Sending your follow-up request…";
    try {
      const address = email.value.trim();
      const topic = form.elements.topic.value;
      // Blank stays off the wire entirely: an optional field left empty sends
      // exactly the request this form sent before it existed.
      const note = message.value.trim() || null;
      await postLeadEmail(request, email.value, FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE, CONTACT_COPY, topic, note);
      form.dataset.state = "success";
      status.textContent = "Request sent to the Wawalu team. Your submitted work email and follow-up topic were recorded.";
      confirmation.show(address, topic);
    } catch (caught) {
      form.dataset.state = "error";
      status.textContent = caught instanceof SubmissionError ? caught.message : CONTACT_COPY.unconfirmed;
      email.setAttribute("aria-invalid", "true");
      showRetry(true);
      submit.disabled = false;
      submit.removeAttribute("aria-disabled");
    }
  });
  return form;
}

if (globalThis.document) {
  bindExecutiveTakeaway();
  bindFinopsExampleFollowUp();
}
