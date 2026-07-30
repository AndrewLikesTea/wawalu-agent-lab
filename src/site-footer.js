// One site footer: one identity paragraph, one way to reach a person, on every
// page of the site.
//
// This file is to the footer what src/site-nav.js is to the navigation. Every
// page is static HTML and the build copies src/ verbatim, so each page embeds
// the rendered markup rather than asking a script to inject it — the footer has
// to be in the document before any JavaScript runs, and it must not appear or
// vanish depending on whether a module loaded. `siteFooterMarkup()` below is
// still the single source of truth: tests/site-footer.test.js renders it for
// every page that carries a site nav and requires an exact match, so a page
// cannot quietly ship a footer of its own invention.
//
// Two things about the shape it takes:
//
//   1. It is a real <footer> at body level, after the content region in
//      document order. That is what makes it a contentinfo landmark, and it is
//      why the skip link still skips something: "skip to main content" moves a
//      reader past the header, and the footer is behind them, not in front.
//   2. The email affordance is progressive disclosure, not a dialog. A visitor
//      who wants to ask about Shiplog gets a button, and the button reveals a
//      form in place. There is no focus trap to escape and nothing overlays the
//      page they were reading.
//
// The submission itself is not new work. It is the same transport and the same
// validation the home page's field-note form and the AI FinOps contact form
// already share, imported from lead-capture.js. What it asks for is not the same
// though, so it reads its validation and failure wording from CONTACT_COPY
// rather than the field-note set: the home page carries both forms, and a
// visitor who mistypes an address has to be told which one they were using.
// The promise it makes once an address lands is still its own — see the note on
// CAPTURED about what it is willing to say.

import {
  CONTACT_COPY, describeWith, emailFieldError, looksLikeEmail, postLeadEmail, SubmissionError,
} from "./lead-capture.js";

const ERROR_ID = "site-footer-error";
const RECOVERY_ID = "site-footer-recovery";

/**
 * Who runs this, what it is, and where it lives — in one sentence, on every
 * page. It names an organisation and a hosting claim, both of which are checkable
 * from outside. It claims no customer, no usage, no funding, and no result,
 * because this repository has no evidence for any of those and a footer is a
 * strange place to start inventing some.
 */
export const IDENTITY = "Shiplog is a demonstration engineering decision and release log, "
  + "built and operated by Wawalu at labs.wawalu.org.";

/**
 * The context the button no longer carries.
 *
 * Every form on this site that asks a person to get back to you is opened and
 * submitted by a control reading exactly "Request a follow-up" — one label, no
 * page-specific qualification — so the sentence beside it is what says a
 * follow-up about what, from whom. It sits outside the panel because a visitor
 * reads it before deciding whether to open anything.
 */
export const INVITATION = "Questions about Shiplog? Ask the Wawalu team that operates it, and a "
  + "person replies by email.";

/**
 * What submitting does, before the note about what it sends. The home page also
 * carries a work-email field that subscribes you to field notes, and the two are
 * a few hundred pixels apart; a visitor should never have to guess which one
 * they are typing into. The line above says who you are talking to, this says
 * what pressing the button asks for.
 */
export const PURPOSE = "Submitting sends a Shiplog follow-up request.";

/**
 * The privacy claim, in the same register as the AI FinOps form's: it names the
 * one thing that travels, and it names the things that do not. It is true by
 * construction rather than by promise — `postLeadEmail` assembles the whole
 * request body from one argument, the value of the field below, so no other page
 * state has a route to the wire.
 */
export const PRIVACY = "This form sends one thing: the work email address you type. Nothing else "
  + "on this page — nothing you have read, filtered, imported, or exported — is read, attached, or "
  + "transmitted, and the address goes to the Wawalu team that operates Shiplog.";

// What a visitor is told once the address is stored.
//
// Deliberately not an SLA. The AI FinOps form answers within two business days
// because someone watches that queue; this footer sits on eight pages of a
// demonstration product and nobody has promised to watch it that closely. So it
// says what is actually true — the address is recorded, a person is the one who
// reads it, and no machine is about to reply — rather than a response time this
// demo would break.
const CAPTURED = "Follow-up requested — we sent your email address, and nothing else. It is recorded "
  + "for the Wawalu team, and a person replies by email; nothing here answers automatically.";
const ALREADY_CAPTURED = "Follow-up requested — that address is already on our list, so nothing new "
  + "was recorded. The Wawalu team can reach you there.";

const SUBMITTING = "Requesting a follow-up — sending your email address…";

/**
 * The pages that answer a follow-up request better than this footer can, and
 * therefore ship a pointer to their own form instead of a second one.
 *
 * There is exactly one today. The executive briefing ends on a decision, and its
 * own form arrives attached to it — a request from there says which figure and
 * which action it is about, which a generic "talk to us about Shiplog" cannot.
 * Two identical work-email fields on one screen also make a reader who has just
 * decided something choose between them, and the choice has no right answer.
 *
 * The pointer is a real link, not a button: it works with no script at all,
 * which is the same promise the rest of this footer makes.
 */
export const FOLLOW_UP_REDIRECT = Object.freeze({
  briefing: Object.freeze({
    statement: "This page carries its own follow-up form, at the end of the briefing. Use that one: it reaches "
      + "the same Wawalu team, and a request made there arrives attached to the decision you just read. It "
      + "sends one thing — the work email address you type.",
    // Named for where it goes, not for what it does. It is a jump link, and
    // giving it the CTA's words would put a second "Request a follow-up" on the
    // page that submits nothing.
    label: "Go to the follow-up form",
    href: "#briefing-contact",
  }),
});

/**
 * The footer as it appears in every page's source. `indent` is the indentation
 * of the <footer> element itself; every page places it at body level, so the
 * default is the four spaces the pages already use there.
 *
 * `redirect` replaces the disclosure and its form with a pointer to a page's own
 * follow-up form — see FOLLOW_UP_REDIRECT. The identity paragraph never varies:
 * every page says who runs Shiplog and where.
 */
export function siteFooterMarkup(indent = "    ", { redirect = null } = {}) {
  const contact = redirect ? [
    `    <p class="site-footer-redirect">${redirect.statement}</p>`,
    `    <a class="site-footer-redirect-link" href="${redirect.href}">${redirect.label}</a>`,
  ] : contactDisclosureLines();
  const lines = [
    '<footer class="site-footer" id="site-footer" aria-labelledby="site-footer-title">',
    '  <div class="site-footer-inner">',
    '    <h2 class="site-footer-title" id="site-footer-title">About Shiplog</h2>',
    `    <p class="site-footer-identity">${IDENTITY}</p>`,
    ...contact,
    "  </div>",
    "</footer>",
  ];
  return lines.map((line) => `${indent}${line}`).join("\n");
}

function contactDisclosureLines() {
  return [
    `    <p class="site-footer-invitation">${INVITATION}</p>`,
    '    <button class="site-footer-trigger" id="site-footer-open" type="button" aria-expanded="false" aria-controls="site-footer-panel">',
    "      Request a follow-up",
    "    </button>",
    '    <div class="site-footer-panel" id="site-footer-panel" hidden>',
    '      <form id="site-footer-form" class="site-footer-form" novalidate>',
    '        <div class="site-footer-field">',
    '          <label for="site-footer-email">Work email</label>',
    "          <!-- Only the note is named here. The inline error and the recovery",
    "               paragraph are added to this description by site-footer.js when",
    "               they exist, because a hidden element referenced by",
    "               aria-describedby is still part of the accessible description",
    "               and would otherwise be read on first focus. -->",
    '          <input id="site-footer-email" name="email" type="email" maxlength="254" inputmode="email" autocomplete="email" placeholder="you@company.com" required aria-describedby="site-footer-note" />',
    "        </div>",
    `        <p class="site-footer-error" id="site-footer-error" hidden></p>`,
    `        <p class="site-footer-note" id="site-footer-note">${PURPOSE} ${PRIVACY}</p>`,
    '        <div class="site-footer-actions">',
    '          <button type="submit">Request a follow-up</button>',
    '          <button id="site-footer-dismiss" type="button">Close</button>',
    "        </div>",
    "      </form>",
    '      <p class="site-footer-status" id="site-footer-status" role="status" aria-live="polite"></p>',
    '      <p class="site-footer-recovery" id="site-footer-recovery" hidden>Your email address is still in the field above, so you can request a follow-up again. Nothing else on this page changed.</p>',
    "    </div>",
  ];
}

/**
 * Bring the disclosure and the submission to life. Every page ships the markup,
 * so a page where this never runs still names who operates Shiplog — it just
 * shows a button that does nothing, which is why the button is the only control
 * outside the panel and the panel starts hidden.
 *
 * `request` is deferred to call time for the same reason the AI FinOps form
 * defers it: a test that takes over `globalThis.fetch` after the page mounts
 * must still be the one that receives the submission.
 */
export function initSiteFooter(root = document, request = (...args) => globalThis.fetch(...args)) {
  const form = root.querySelector("#site-footer-form");
  const trigger = root.querySelector("#site-footer-open");
  const panel = root.querySelector("#site-footer-panel");
  if (!form || !trigger || !panel) return null;

  const email = form.elements.email;
  const submit = form.querySelector('button[type="submit"]');
  const dismiss = root.querySelector("#site-footer-dismiss");
  const fieldError = root.querySelector(`#${ERROR_ID}`);
  const status = root.querySelector("#site-footer-status");
  const recovery = root.querySelector(`#${RECOVERY_ID}`);

  function setFieldError(message) {
    fieldError.textContent = message ?? "";
    fieldError.hidden = !message;
    describeWith(email, ERROR_ID, Boolean(message));
    if (message) email.setAttribute("aria-invalid", "true");
    else email.removeAttribute("aria-invalid");
  }

  function setRecoveryVisible(visible) {
    recovery.hidden = !visible;
    describeWith(email, RECOVERY_ID, visible);
  }

  function open() {
    if (!panel.hidden) return;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    // Revealing a form and leaving focus on the trigger above it strands a
    // keyboard user at the very moment they asked for the form.
    email.focus();
  }

  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    // Focus returns to the control that opened the panel. Losing it here would
    // drop the reader at the top of the document, above everything they read.
    trigger.focus();
  }

  trigger.addEventListener("click", () => (panel.hidden ? open() : close()));
  dismiss?.addEventListener("click", close);
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  });

  // Editing the field retracts the diagnostic about it. The submission outcome
  // in the live region stays: it reports something that happened, not something
  // about the current value.
  email.addEventListener("input", () => {
    if (form.dataset.state === "invalid") {
      delete form.dataset.state;
      setFieldError(null);
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const invalid = emailFieldError(email.value, looksLikeEmail(email.value), CONTACT_COPY);
    if (invalid) {
      // Whatever was typed stays; the field is never cleared to "help".
      form.dataset.state = "invalid";
      setFieldError(invalid);
      setRecoveryVisible(false);
      status.textContent = "";
      email.focus();
      return;
    }

    form.dataset.state = "submitting";
    setFieldError(null);
    setRecoveryVisible(false);
    submit.disabled = true;
    submit.setAttribute("aria-disabled", "true");
    // Announced, not merely spun: the live region carries the pending state to a
    // reader who never sees the button change.
    status.textContent = SUBMITTING;

    try {
      const body = await postLeadEmail(request, email.value, CONTACT_COPY);
      form.dataset.state = "success";
      status.textContent = body?.subscribed === false ? ALREADY_CAPTURED : CAPTURED;
    } catch (error) {
      // Copy this repository owns, never a string an intermediary supplied, and
      // never a claim that the address was lost when that is not known.
      form.dataset.state = "error";
      status.textContent = error instanceof SubmissionError ? error.message : CONTACT_COPY.unconfirmed;
      // Every failure here is retryable in place, so the paragraph that says so
      // appears on all of them — the same rule the AI FinOps form follows.
      setRecoveryVisible(true);
    } finally {
      // Retry has to work without a reload, so the control comes back on every
      // path out of the request.
      submit.disabled = false;
      submit.removeAttribute("aria-disabled");
    }
  });

  return form;
}
