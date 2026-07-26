export const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeLeadInput(input) {
  const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
  const company = typeof input?.company === "string" ? input.company.trim() : "";
  return { email, company };
}

export function validateLeadInput(input) {
  const lead = normalizeLeadInput(input);
  if (!lead.email) return { lead, error: "Enter your email address." };
  if (lead.email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(lead.email)) {
    return { lead, error: "Enter a valid email address." };
  }
  return { lead, error: null };
}

export function createD1LeadStore(db) {
  return Object.freeze({
    async subscribe(email, now) {
      await db.prepare(`
        INSERT INTO leads (email, created_at, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET updated_at = excluded.updated_at
      `).bind(email, now, now).run();
    },
  });
}

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export async function handleLeadRequest(request, { store, now = () => new Date().toISOString() }) {
  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed." }, { allow: "POST" });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json(415, { error: "Send the request as JSON." });
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 2048) {
    return json(413, { error: "Request is too large." });
  }

  let raw;
  let input;
  try {
    raw = await request.text();
    if (raw.length > 2048) return json(413, { error: "Request is too large." });
    input = JSON.parse(raw);
  } catch {
    return json(400, { error: "Request body must be valid JSON." });
  }

  const { lead, error } = validateLeadInput(input);
  if (error) return json(422, { error });
  // A filled hidden field is treated as a successful no-op so simple bots
  // cannot use response differences to tune around the trap.
  if (lead.company) return json(200, { subscribed: true });

  try {
    await store.subscribe(lead.email, now());
    return json(201, { subscribed: true });
  } catch {
    return json(503, { error: "We couldn't save your email right now. Please try again." });
  }
}

export function initLeadCapture(root = document, fetcher = fetch) {
  const form = root.querySelector("#lead-form");
  if (!form) return;
  const email = form.elements.email;
  const status = root.querySelector("#lead-status");
  const button = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "";
    email.setCustomValidity("");
    if (!email.validity.valid) {
      email.setCustomValidity(email.validity.valueMissing
        ? "Enter your email address."
        : "Enter a valid email address.");
      email.reportValidity();
      return;
    }

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    status.textContent = "Sending…";
    try {
      const response = await fetcher("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error);
      form.reset();
      status.textContent = "You're on the list—we'll send the guide soon.";
    } catch (error) {
      status.textContent = error?.message || "Something went wrong. Please try again.";
      email.focus();
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  });
  email.addEventListener("input", () => email.setCustomValidity(""));
}
