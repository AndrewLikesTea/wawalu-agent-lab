// Browser client for POST /api/leads, keyed to the versioned response contract
// in contracts/lead-capture/v1/responses.json. Two rules hold this together:
// the page only ever shows copy this file owns (never a `message` string from
// the server or an intermediary), and it only claims capture or loss when the
// contract says the outcome is actually known.
const ENDPOINT = "/api/leads";
const TIMEOUT_MS = 10000;

const EMPTY_EMAIL_ERROR = "Enter your work email.";
const INVALID_EMAIL_ERROR = "Enter a valid work email address.";

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
const UNCONFIRMED_COPY = "We couldn’t reach sign-up, so we can’t confirm your email was saved. Please try again in a few minutes.";

// Outcomes where a bare retry is not a useful next step: sign-up is down, or we
// don't know what happened. Both surface the recovery block in the markup.
const NEEDS_RECOVERY = Object.freeze(["storage_unavailable", "unconfirmed"]);

class SubmissionError extends Error {
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

export function initLeadCapture(root = document, request = globalThis.fetch) {
  const form = root.querySelector("#lead-capture-form");
  if (!form || typeof request !== "function") return null;

  const email = form.elements.email;
  const button = form.querySelector('button[type="submit"]');
  const status = root.querySelector("#lead-capture-status");
  const recovery = root.querySelector("#lead-capture-recovery");

  function setRecoveryVisible(visible) {
    if (recovery) recovery.hidden = !visible;
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
    if (!email.value.trim() || !email.checkValidity()) {
      form.dataset.state = "error";
      email.setAttribute("aria-invalid", "true");
      status.textContent = email.value.trim() ? INVALID_EMAIL_ERROR : EMPTY_EMAIL_ERROR;
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
      const response = await request(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ email: email.value }),
        // Without this a hung request strands the visitor on "Submitting…"
        // with the control disabled and no way to recover.
        signal: globalThis.AbortSignal?.timeout?.(TIMEOUT_MS),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = resolveFailure(response, body);
        throw new SubmissionError(failure.message, failure.reason);
      }

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
