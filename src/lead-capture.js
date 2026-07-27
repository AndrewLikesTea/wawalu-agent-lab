// Browser client for POST /api/leads, keyed to the versioned response contract
// in contracts/lead-capture/v1/responses.json. Two rules hold this together:
// the page only ever shows copy this file owns (never a `message` string from
// the server or an intermediary), and it only claims capture or loss when the
// contract says the outcome is actually known.
//
// The transport, the validation, and the failure-to-copy mapping are exported
// because a second form now uses them: the AI FinOps contact affordance in
// finops-contact.js. That form owns its own wording and its own disclosure
// behaviour, but it must not own a second guess at what a 502 means — one
// implementation of "was this captured?" is the whole point of the contract.
const ENDPOINT = "/api/leads";
const TIMEOUT_MS = 10000;

export const EMPTY_EMAIL_ERROR = "Enter your work email.";
export const INVALID_EMAIL_ERROR = "Enter a valid work email address.";

const CAPTURED = "You’re on the list for the next concise field note about durable engineering decisions.";
const ALREADY_CAPTURED = "You’re already on the list for the next concise field note.";

// Keyed by the contract's application `error.code` enum. Every one of these
// means the address is definitely not stored, so the copy can say so.
const REJECTED_COPY = Object.freeze({
  invalid_email: "That address wasn’t accepted, so it wasn’t saved. Check it and submit again.",
  invalid_json: "Your email wasn’t saved because the request couldn’t be read. Reload the page and try again.",
  unsupported_media_type: "Your email wasn’t saved because the request couldn’t be read. Reload the page and try again.",
  method_not_allowed: "Your email wasn’t saved because the request couldn’t be read. Reload the page and try again.",
  storage_error: "Your email wasn’t saved. Please try again.",
  storage_unavailable: "Your email wasn’t saved because sign-up is temporarily offline.",
});
const RATE_LIMITED_COPY = "Too many attempts, so your email wasn’t saved. Please wait a moment and try again.";
// A proxy answered, or nothing did. The origin may have stored the address
// before failing to answer, so this claims neither capture nor loss.
export const UNCONFIRMED_COPY = "We couldn’t reach sign-up, so we can’t confirm your email was saved. Please try again in a few minutes.";

// Outcomes where a bare retry is not a useful next step: sign-up is down, or we
// don't know what happened. Both surface the recovery block in the markup.
export const NEEDS_RECOVERY = Object.freeze(["storage_unavailable", "unconfirmed"]);

export class SubmissionError extends Error {
  constructor(message, reason) {
    super(message);
    this.reason = reason;
  }
}

// Resolves a response into copy we own plus the reason code that drives
// recovery. Deliberately ignores body.error.message: an intermediary can put
// arbitrary text there, and the page must not repeat unreviewed strings.
export function resolveFailure(response, body) {
  const code = typeof body?.error?.code === "string" ? body.error.code : null;
  if (code && Object.hasOwn(REJECTED_COPY, code)) return { message: REJECTED_COPY[code], reason: code };
  if (response.status === 429) return { message: RATE_LIMITED_COPY, reason: "rate_limited" };
  return { message: UNCONFIRMED_COPY, reason: "unconfirmed" };
}

/**
 * The one request either form makes. The body is built here, from the address
 * argument and nothing else, so no caller can widen what leaves the browser:
 * `{ email }` is the entire documented request shape, and the FinOps contact
 * form's no-transfer claim rests on this function having no other input.
 *
 * Resolves with the parsed success body; throws a SubmissionError carrying copy
 * this module owns plus the reason code that drives recovery.
 */
export async function postLeadEmail(request, email) {
  const response = await request(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email }),
    // Without this a hung request strands the visitor on "Submitting…"
    // with the control disabled and no way to recover.
    signal: globalThis.AbortSignal?.timeout?.(TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = resolveFailure(response, body);
    throw new SubmissionError(failure.message, failure.reason);
  }
  return body;
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

/** The inline message an address is owed before a request is worth making. */
export function emailFieldError(value, valid) {
  if (!String(value ?? "").trim()) return EMPTY_EMAIL_ERROR;
  return valid ? null : INVALID_EMAIL_ERROR;
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
    const fieldError = emailFieldError(email.value, email.checkValidity());
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
    status.textContent = "Submitting…";

    try {
      const body = await postLeadEmail(request, email.value);

      form.dataset.state = "success";
      status.textContent = body?.subscribed === false ? ALREADY_CAPTURED : CAPTURED;
      form.reset();
    } catch (error) {
      // A rejected fetch (offline, aborted, DNS) means the request may still
      // have reached the origin, so it resolves to the unconfirmed wording
      // rather than asserting the address was lost.
      const reason = error instanceof SubmissionError ? error.reason : "unconfirmed";
      form.dataset.state = "error";
      status.textContent = error instanceof SubmissionError ? error.message : UNCONFIRMED_COPY;
      setRecoveryVisible(NEEDS_RECOVERY.includes(reason));
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-disabled");
    }
  });

  return form;
}
