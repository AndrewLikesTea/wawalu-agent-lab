// The homepage's short, forwardable reading of the bundled worked decision.
// Keep this byte-identical to #executive-takeaway-text: the visible paragraph
// lets a reader verify the clipboard payload before activating the control.
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
 * The clause is dropped whole when no period can be named. There is no state in
 * which this prints "across " with nothing after it.
 */
export function takeawayText(period = ANALYZED_PERIOD) {
  const span = typeof period === "string" && period.trim() ? ` across ${period.trim()}` : "";
  return `$51,254 of $154,500 in analyzed AI spend is recoverable (33%)${span} `
    + "— a modelled ceiling on what re-routing this work could save, not money already saved. "
    + "First recommended action: Pilot lower-cost routing in Atlas Platform. "
    + "Accountable role: Platform Engineering Lead. Figures are from a bundled synthetic example "
    + "and are not visitor data.";
}

export const EXECUTIVE_TAKEAWAY = takeawayText();

/** The homepage region a forwarded takeaway should land its reader in. */
export const TAKEAWAY_SECTION_ID = "executive-takeaway";

// Where the takeaway says it came from when the page cannot say for itself: a
// file:// preview, a test with no location, an origin that is not the web. The
// copied text is read by somebody who was not here, so a link that cannot be
// clicked is worse than the published address of the thing being quoted.
const PUBLISHED_HOST = "labs.wawalu.org";

/**
 * The host of a location, but only if that location is the web.
 * @returns {string|null} null for file://, for a missing origin, and for
 *   anything the URL parser refuses — each of which falls back to the published
 *   host rather than pasting a local path into somebody's inbox.
 */
function webHost(origin) {
  try {
    const parsed = new URL(String(origin));
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.host || null;
  } catch {
    return null;
  }
}

/**
 * The absolute link the copied takeaway carries.
 *
 * ONLY `origin` AND `pathname` ARE READ. A fragment or a query string on this
 * page is visitor-influenceable — anyone can hand out a link to this homepage
 * with anything after the `?` — and this text is pasted into email, so nothing
 * that reaches it may come from the URL bar. The section fragment is a constant
 * in this module, not something read back off the document.
 *
 * The scheme is forced to https rather than copied from the location: a local
 * preview on http, or a test on none, must still hand a reader an address that
 * works from where they open it.
 *
 * @param {{origin?: string, pathname?: string}} location read at call time.
 * @returns {string} an absolute https URL ending in the takeaway's fragment.
 */
export function takeawayShareUrl(location = globalThis.location ?? globalThis.window?.location) {
  const host = webHost(location?.origin);
  const raw = host && typeof location?.pathname === "string" ? location.pathname : "/";
  // Defensive even though a real `pathname` carries neither: this is the one
  // value here that comes from outside the module, so it is cut at the first
  // character that could start a query or a fragment.
  const [path] = raw.split(/[?#]/);
  return `https://${host ?? PUBLISHED_HOST}${path.startsWith("/") ? path : "/"}#${TAKEAWAY_SECTION_ID}`;
}

/**
 * What the control puts on the clipboard: the takeaway, verbatim, and then the
 * link on a line of its own.
 *
 * Bare, on its own line, with no markdown and no angle brackets, because the
 * destination that matters is a plain-text email body — every mail client
 * linkifies a naked URL at a line break, and none of them linkify `[x](y)`. The
 * takeaway text above it is unchanged: what a reader verified on screen before
 * pressing the button is what leaves the page.
 */
export function shareTakeawayText(takeaway = EXECUTIVE_TAKEAWAY, url = takeawayShareUrl()) {
  return `${takeaway}\n${url}`;
}

export const TAKEAWAY_COPY_FEEDBACK = Object.freeze({
  copied: "Executive takeaway copied, with a link back to this page.",
  failed: "Could not copy automatically. The executive takeaway and its link are in the box below, "
    + "selected and ready — press Ctrl+C, or Cmd+C on a Mac.",
});

import {
  CONTACT_COPY, emailFieldError, looksLikeEmail, postLeadEmail, SubmissionError,
} from "./lead-capture.js";

export const FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE = "follow_up_finops_example";

/**
 * Wire the native copy button. The clipboard is injectable for focused tests.
 *
 * The manual rung follows the Prompt coach's fallback (`coaching-summary-view.js`)
 * rather than inventing a second shape for the same failure: a permanent hidden
 * field in the page that this module fills and reveals, focused and selected, so
 * the keystroke the status line just named has something to copy. The field is
 * written by assigning `value` — never by building markup — and it stays inside
 * the `hidden` wrapper until it is needed, so it costs the first screen no tab
 * stop and shifts nothing above it.
 */
export function bindExecutiveTakeaway(doc = globalThis.document, clipboard = globalThis.navigator?.clipboard) {
  const button = doc?.getElementById("copy-executive-takeaway");
  const text = doc?.getElementById("executive-takeaway-text");
  const status = doc?.getElementById("executive-takeaway-status");
  const fallback = doc?.getElementById("executive-takeaway-fallback");
  const box = doc?.getElementById("executive-takeaway-fallback-text");
  if (!button || !text || !status) return false;

  button.addEventListener("click", async () => {
    // Built at the press, not at load: the address a visitor is standing on is
    // what the link should point at, and a page entry runs before that is final.
    const payload = shareTakeawayText();
    try {
      if (typeof clipboard?.writeText !== "function") throw new Error("Clipboard unavailable");
      await clipboard.writeText(payload);
      status.textContent = TAKEAWAY_COPY_FEEDBACK.copied;
      if (fallback) fallback.hidden = true;
    } catch {
      status.textContent = TAKEAWAY_COPY_FEEDBACK.failed;
      if (box) box.value = payload;
      if (fallback) fallback.hidden = false;
      box?.focus?.();
      box?.select?.();
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
  if (!open || !panel || !form || !status || !error) return null;
  const email = form.elements.email;
  const submit = form.querySelector('button[type="submit"]');

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
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.state === "submitting" || form.dataset.state === "success") return;
    const invalid = emailFieldError(email.value, looksLikeEmail(email.value), CONTACT_COPY);
    if (invalid) {
      form.dataset.state = "invalid";
      error.textContent = invalid;
      error.hidden = false;
      email.setAttribute("aria-invalid", "true");
      status.textContent = "";
      email.focus();
      return;
    }
    form.dataset.state = "submitting";
    error.hidden = true;
    email.removeAttribute("aria-invalid");
    submit.disabled = true;
    submit.setAttribute("aria-disabled", "true");
    status.textContent = "Sending your follow-up request…";
    try {
      await postLeadEmail(request, email.value, FINOPS_EXAMPLE_FOLLOW_UP_PURPOSE, CONTACT_COPY);
      form.dataset.state = "success";
      for (const control of [form.elements.topic, email, submit]) control.disabled = true;
      status.textContent = "Follow-up requested. Someone from Wawalu will reply by email.";
    } catch (caught) {
      form.dataset.state = "error";
      status.textContent = caught instanceof SubmissionError ? caught.message : CONTACT_COPY.unconfirmed;
      email.setAttribute("aria-invalid", "true");
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
