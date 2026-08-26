// Browser client for POST /api/leads, keyed to the versioned response contract
// in contracts/lead-capture/v1/responses.json. Two rules hold this together:
// the page only ever shows copy this file owns (never a `message` string from
// the server or an intermediary), and it only claims capture or loss when the
// contract says the outcome is actually known.
//
// The transport, the validation, and the failure-to-copy mapping are exported
// because other forms use them: the site footer's follow-up panel and the AI
// FinOps contact affordance. Those forms own their disclosure behaviour, but
// they must not own a second guess at what a 502 means — one
// implementation of "was this captured?" is the whole point of the contract.
// What they do choose is which set of words a visitor reads, because they are
// not asking for the same thing this form is.
const ENDPOINT = "/api/leads";
const TIMEOUT_MS = 10000;

/**
 * The transport is shared; the words are not.
 *
 * The home page carries two work-email forms that do different things — one
 * subscribes you to field notes, the other asks a person to get back to you —
 * and they used to fail in identical words, so "Enter a valid work email
 * address." told a visitor nothing about which of the two they had failed to do.
 * Every string a visitor can read about a submission now arrives as one of these
 * sets, passed in by the form that owns the surface, and each set answers the
 * same questions in the same order: what to type, what a rejection means, and
 * what is and is not known when nothing answered.
 */
const UNREADABLE_CODES = ["invalid_request", "invalid_purpose", "invalid_json", "unsupported_media_type", "method_not_allowed", "invalid_message", "invalid_topic"];

// One limit for both halves: src/leads.js imports it rather than repeating it.
export const MAX_FOLLOW_UP_MESSAGE_LENGTH = 200;

// Keyed by the contract's application `error.code` enum. Every one of these
// means the address is definitely not stored, so the copy can say so.
function rejectedCopy({ invalidEmail, unreadable, storageError, storageUnavailable }) {
  const byCode = {
    invalid_email: invalidEmail,
    storage_error: storageError,
    storage_unavailable: storageUnavailable,
  };
  // Distinct refusals, one thing a visitor can do about any of them. Every code
  // the endpoint can answer with belongs to one of these buckets: a code missing
  // from here degrades to `unconfirmed` below, which tells a visitor we cannot
  // say whether their request landed when the origin has just said it did not.
  for (const code of UNREADABLE_CODES) byCode[code] = unreadable;
  return Object.freeze(byCode);
}

/** The home page's field-note sign-up: submitting subscribes you. */
export const FIELD_NOTE_COPY = Object.freeze({
  emptyEmail: "Enter your work email to subscribe to field notes.",
  invalidEmail: "Enter a valid work email address to subscribe to field notes.",
  rejected: rejectedCopy({
    invalidEmail: "You’re not subscribed: that address wasn’t accepted. Check it and submit again.",
    unreadable: "You’re not subscribed because the request couldn’t be read. Reload the page and try again.",
    storageError: "You’re not subscribed — something went wrong at our end. Please try again.",
    storageUnavailable: "You’re not subscribed because sign-up is temporarily offline.",
  }),
  rateLimited: "You’re not subscribed — too many attempts. Please wait a moment and try again.",
  // A proxy answered, or nothing did. The origin may have stored the address
  // before failing to answer, so this claims neither capture nor loss.
  unconfirmed: "We couldn’t reach sign-up, so we can’t confirm whether you’re subscribed. Please try again in a few minutes.",
});

/**
 * Asking a person to get back to you: the site footer's follow-up form, the AI
 * FinOps contact form, and the executive briefing's. All three make the same
 * request of the same team, so all three say so the same way — one name for the
 * thing being asked for, "a Shiplog follow-up", on every surface that asks. What
 * differs between them is the promise they make once it lands, which each of
 * them still owns.
 */
export const CONTACT_COPY = Object.freeze({
  emptyEmail: "Enter your work email to request a Shiplog follow-up.",
  invalidEmail: "Enter a valid work email address to request a Shiplog follow-up.",
  rejected: rejectedCopy({
    invalidEmail: "No request was sent: that address wasn’t accepted. Check it and submit again.",
    unreadable: "No request was sent because it couldn’t be read. Reload the page and try again.",
    storageError: "No request was sent — something went wrong at our end. Please try again.",
    storageUnavailable: "No request was sent because follow-up requests are temporarily offline.",
  }),
  rateLimited: "No request was sent — too many attempts. Please wait a moment and try again.",
  unconfirmed: "We couldn’t send your request, so we can’t confirm it reached us. Please try again in a few minutes.",
});

/**
 * The one privacy sentence every follow-up form shows between its field and its
 * submit button — the footer's, the AI FinOps result's, and the executive
 * briefing's. It is one sentence rather than a per-surface list of what that
 * page holds because there is one promise to make: `postLeadEmail` below builds
 * the whole request body from one argument, the typed address, so no page state
 * has a route to the wire on any of them. The pages are static HTML and the
 * build copies src/ verbatim, so each form embeds the rendered text;
 * tests/follow-up-privacy.test.js reads this constant and requires every form to
 * render it exactly.
 */
export const FOLLOW_UP_PRIVACY = "The work email address you type here goes to the Wawalu team that "
  + "operates Shiplog; nothing else on this page is sent.";

// This form's own pending and success states: the contact forms promise
// something else, so each set owns that sentence. Both repeat src/index.html's
// promise — who writes field notes, and that there is no schedule — so a
// subscriber can check what arrived. "Already on its way" claimed a cadence.
const SUBMITTING = "Subscribing you to field notes…";
const CAPTURED = "You’re subscribed. Field notes come from the Wawalu team that operates Shiplog: what the team"
  + " changed or learned. There is no schedule. The first note goes out when it is written.";
const ALREADY_CAPTURED = "That address is already subscribed to field notes from the Wawalu team that operates"
  + " Shiplog. There is no schedule.";

// Outcomes where a bare retry is not a useful next step: sign-up is down, or we
// don't know what happened. Both surface the recovery block in the markup.
export const NEEDS_RECOVERY = Object.freeze(["storage_unavailable", "unconfirmed"]);

export class SubmissionError extends Error {
  constructor(message, reason) {
    super(message);
    this.reason = reason;
  }
}

/**
 * Whether a failed submission is *known* not to have been stored. The contract
 * answers this once and no form re-answers it: every recognized application
 * `code` is documented `captured: false`, and a 429 is refused before the
 * origin runs. Only `unconfirmed` — a proxy answered, or the fetch itself
 * rejected — leaves capture unknown, as does anything that is not one of these.
 */
export function knownNotSent(error) {
  return error instanceof SubmissionError && error.reason !== "unconfirmed";
}

// Resolves a response into copy we own plus the reason code that drives
// recovery. Deliberately ignores body.error.message: an intermediary can put
// arbitrary text there, and the page must not repeat unreviewed strings.
export function resolveFailure(response, body, copy) {
  const code = typeof body?.error?.code === "string" ? body.error.code : null;
  if (code && Object.hasOwn(copy.rejected, code)) return { message: copy.rejected[code], reason: code };
  if (response.status === 429) return { message: copy.rateLimited, reason: "rate_limited" };
  return { message: copy.unconfirmed, reason: "unconfirmed" };
}

// Sends the address, routing label, optional fixed topic, optional message.
// Every 2xx is a capture, including legacy responses that predate `created`.
export async function postLeadEmail(request, email, purpose, copy, topic = null, message = null) {
  const response = await request(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email, purpose, ...(topic && { topic }), ...(message && { message }) }),
    // Without this a hung request strands the visitor on "Submitting…"
    // with the control disabled and no way to recover.
    signal: globalThis.AbortSignal?.timeout?.(TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = resolveFailure(response, body, copy);
    throw new SubmissionError(failure.message, failure.reason);
  }
  const created = typeof body?.created === "boolean"
    ? body.created
    : (typeof body?.subscribed === "boolean" ? body.subscribed : true);
  return { captured: true, created, purpose };
}

// The browser's own shape check, for forms that cannot lean on the control's
// native constraint validation. It is deliberately the same expression
// `normalizeEmail` applies in src/leads.js: a field the page accepts and the
// endpoint then rejects with a 422 is a worse experience than either check
// alone, so tests/leads.test.js pins the two to the same verdicts.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function looksLikeEmail(value) {
  const candidate = String(value ?? "").trim();
  return candidate.length > 0 && candidate.length <= 254 && EMAIL_SHAPE.test(candidate);
}

/**
 * The inline message an address is owed before a request is worth making. The
 * caller supplies the copy set, so the message names the thing this particular
 * form would have done with a usable address.
 */
export function emailFieldError(value, valid, copy) {
  if (!String(value ?? "").trim()) return copy.emptyEmail;
  return valid ? null : copy.invalidEmail;
}

/**
 * Add or remove one id from a control's accessible description.
 *
 * A hidden node named by `aria-describedby` is still read: the accessible name
 * and description computation includes referenced subtrees whether or not they
 * are rendered. So an id that points at failure copy has to come and go with the
 * failure, or the very first visitor to focus the field is told their email is
 * "still in the field above" before they have typed anything.
 */
export function describeWith(control, id, present) {
  const ids = (control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  const without = ids.filter((entry) => entry !== id);
  control.setAttribute("aria-describedby", (present ? [...without, id] : without).join(" "));
}

export function initLeadCapture(root = document, request = globalThis.fetch) {
  const form = root.querySelector("#lead-capture-form");
  if (!form || typeof request !== "function") return null;

  const email = form.elements.email;
  const button = form.querySelector('button[type="submit"]');
  const status = root.querySelector("#lead-capture-status");
  const recovery = root.querySelector("#lead-capture-recovery");

  function setRecoveryVisible(visible) {
    if (!recovery) return;
    recovery.hidden = !visible;
    // The markup no longer names this paragraph in the field's description; it
    // is added only once a failure has actually happened, and removed again the
    // moment the visitor edits the field.
    describeWith(email, "lead-capture-recovery", visible);
  }

  function clearStatus() {
    delete form.dataset.state;
    status.textContent = "";
    email.removeAttribute("aria-invalid");
    setRecoveryVisible(false);
  }

  email.addEventListener("input", () => {
    if (form.dataset.state === "error") clearStatus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fieldError = emailFieldError(email.value, email.checkValidity(), FIELD_NOTE_COPY);
    if (fieldError) {
      form.dataset.state = "error";
      email.setAttribute("aria-invalid", "true");
      status.textContent = fieldError;
      setRecoveryVisible(false);
      email.focus();
      return;
    }

    form.dataset.state = "submitting";
    email.removeAttribute("aria-invalid");
    setRecoveryVisible(false);
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
    status.textContent = SUBMITTING;

    try {
      const body = await postLeadEmail(request, email.value, "field_notes", FIELD_NOTE_COPY);

      form.dataset.state = "success";
      status.textContent = body.created ? CAPTURED : ALREADY_CAPTURED;
      form.reset();
    } catch (error) {
      // A rejected fetch (offline, aborted, DNS) means the request may still
      // have reached the origin, so it resolves to the unconfirmed wording
      // rather than asserting the address was lost.
      const reason = error instanceof SubmissionError ? error.reason : "unconfirmed";
      form.dataset.state = "error";
      status.textContent = error instanceof SubmissionError ? error.message : FIELD_NOTE_COPY.unconfirmed;
      setRecoveryVisible(NEEDS_RECOVERY.includes(reason));
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-disabled");
    }
  });

  return form;
}
