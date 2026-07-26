const ENDPOINT = "/api/leads";
const FALLBACK_ERROR = "We couldn’t save your email. Please try again.";

class SubmissionError extends Error {}

function messageFromResponse(response, body) {
  if (response.status === 429) return "Too many attempts. Please wait a moment and try again.";
  return body?.error?.message ?? FALLBACK_ERROR;
}

export function initLeadCapture(root = document, request = globalThis.fetch) {
  const form = root.querySelector("#lead-capture-form");
  if (!form || typeof request !== "function") return null;

  const email = form.elements.email;
  const button = form.querySelector('button[type="submit"]');
  const status = root.querySelector("#lead-capture-status");

  email.addEventListener("input", () => {
    if (form.dataset.state === "error") {
      delete form.dataset.state;
      status.textContent = "";
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    form.dataset.state = "submitting";
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
    status.textContent = "Submitting…";

    try {
      const response = await request(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ email: email.value }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new SubmissionError(messageFromResponse(response, body));

      form.dataset.state = "success";
      status.textContent = body?.subscribed === false
        ? "You’re already on the list. We’ll keep you posted."
        : "You’re in. Watch your inbox for the next field note.";
      form.reset();
    } catch (error) {
      form.dataset.state = "error";
      status.textContent = error instanceof SubmissionError ? error.message : FALLBACK_ERROR;
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-disabled");
    }
  });

  return form;
}
