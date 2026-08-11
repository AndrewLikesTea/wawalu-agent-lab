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

import { createFollowUpConfirmation } from "./follow-up-confirmation.js";
import {
  CONTACT_COPY, describeWith, emailFieldError, FOLLOW_UP_PRIVACY, looksLikeEmail, postLeadEmail,
  SubmissionError,
} from "./lead-capture.js";

const ERROR_ID = "site-footer-error";
const RECOVERY_ID = "site-footer-recovery";
const RETRY_ID = "site-footer-retry";
const STATUS_ID = "site-footer-status";

/**
 * What a visitor can do here, then who runs it and where — on every page.
 *
 * The doing sentence comes first on purpose. This band used to open by defining
 * Shiplog as a decision and release log, which describes one section of one page
 * and contradicts what the site leads with: the home page's title, heading, and
 * first call to action are all AI FinOps.
 *
 * The second sentence names an organisation and a hosting claim, both checkable
 * from outside. Between them they claim no customer, usage, funding, or result —
 * there is no evidence here for any of those. Every verb in the first sentence
 * is something a page this site ships today does, and DEMOS says which page.
 */
export const IDENTITY = "On this site you can analyze your own AI spend, check a prompt before you send "
  + "it, and read the decisions and releases behind it. Shiplog is a demonstration product, built and "
  + "operated by Wawalu at labs.wawalu.org.";

/**
 * Every door the navigation offers, and what each one is for.
 *
 * This band is the only directory on the pages whose body carries none, so a
 * surface left out is one a reader has to guess at. Every row is a link.
 *
 * `label` and `href` are the word and the path src/site-nav.js uses. They are
 * copied rather than imported: this module is in every page's initial payload
 * and src/site-nav.js is 6 KB of it, so tests/site-footer.test.js compares the
 * two tables instead.
 *
 * `purpose` is a fragment built from the home page's sentence for the same
 * surface — the footer points, the home page explains — keeping the facts the
 * act turns on: where Paint's PNG goes, what order People's posts come in. AI
 * FinOps keeps "in this browser tab", a promise about where an export is read.
 */
export const DEMOS = Object.freeze([
  Object.freeze({
    label: "AI FinOps",
    href: "/evolution.html",
    purpose: "score your provider export in this browser tab",
    // The only row that says where to start: a list with no order is no list.
    note: "start here:",
  }),
  Object.freeze({
    label: "Prompt coach",
    href: "/coach.html",
    purpose: "grade a prompt, then revise and grade again",
    // `also` is a page named beneath this destination rather than beside it:
    // src/site-nav.js files /personal-history.html under Prompt coach's section
    // instead of giving it a door, and a reader who left the home page had
    // nowhere else to find it. Its browser-tab clause is a promise, as above.
    also: Object.freeze({
      label: "Personal AI history",
      href: "/personal-history.html",
      purpose: "reads your export in this browser tab",
    }),
  }),
  Object.freeze({ label: "Decisions", href: "/", purpose: "record a decision, then search the history" }),
  Object.freeze({ label: "Releases", href: "/releases.html", purpose: "every release and the decisions it carried" }),
  Object.freeze({ label: "Social", href: "/social.html", purpose: "read short posts about what the team ships, images optional" }),
  Object.freeze({ label: "People", href: "/profile.html", purpose: "pick a display name, see its image posts, newest first" }),
  Object.freeze({ label: "Paint", href: "/paint/", purpose: "crop or draw an image, export a PNG, publish it on Social" }),
  Object.freeze({ label: "Agent observatory", href: "/agents.html", purpose: "watch a synthetic engineering team build and review work" }),
]);

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

// What the field sends is not this footer's sentence to write: all three
// follow-up forms render FOLLOW_UP_PRIVACY from src/lead-capture.js, beside
// the transport that makes it true.

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
 * There is exactly one today. The executive briefing ends on a decision and its
 * own form arrives attached to it — a request from there says which figure and
 * which action it is about, which a generic "talk to us about Shiplog" cannot.
 *
 * A link and nothing else, carrying the one label every follow-up control
 * carries. It works with no script at all, and the target takes focus (see the
 * `tabindex="-1"` on #briefing-contact) so following it lands a keyboard reader
 * in the form rather than merely scrolling it into view.
 */
export const FOLLOW_UP_REDIRECT = Object.freeze({
  briefing: Object.freeze({
    label: "Request a follow-up",
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
export function siteFooterMarkup(indent = "    ", { redirect = null, followUpType = null } = {}) {
  const contact = redirect ? [
    `    <a class="site-footer-redirect-link" href="${redirect.href}">${redirect.label}</a>`,
  ] : contactDisclosureLines(followUpType);
  const lines = [
    '<footer class="site-footer" id="site-footer" aria-labelledby="site-footer-title">',
    '  <div class="site-footer-inner">',
    '    <h2 class="site-footer-title" id="site-footer-title">About Shiplog</h2>',
    `    <p class="site-footer-identity">${IDENTITY}</p>`,
    ...demoListLines(),
    ...contact,
    "  </div>",
    "</footer>",
  ];
  return lines.map((line) => `${indent}${line}`).join("\n");
}

/**
 * A real <ul>, so the destinations arrive as a list rather than a run-on
 * sentence and a screen reader gets the count. The hrefs are root-relative:
 * this band ships on every page, and a bare relative path would resolve against
 * a page in a subdirectory rather than against the site.
 */
function demoListLines() {
  return [
    '    <ul class="site-footer-demos">',
    ...DEMOS.map(({ label, href, purpose, note, also }) =>
      `      <li><a href="${href}">${label}</a> — ${note ? `${note} ` : ""}${purpose}`
      + `${also ? `; <a href="${also.href}">${also.label}</a> ${also.purpose}` : ""}</li>`),
    "    </ul>",
  ];
}

function contactDisclosureLines(followUpType) {
  return [
    `    <p class="site-footer-invitation">${INVITATION}</p>`,
    '    <button class="site-footer-trigger" id="site-footer-open" type="button" aria-expanded="false" aria-controls="site-footer-panel">',
    "      Request a follow-up",
    "    </button>",
    '    <div class="site-footer-panel" id="site-footer-panel" hidden>',
    `      <form id="site-footer-form" class="site-footer-form"${followUpType ? ` data-follow-up-type="${followUpType}"` : ""} novalidate>`,
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
    `        <p class="site-footer-note" id="site-footer-note">${FOLLOW_UP_PRIVACY}</p>`,
    '        <p class="site-footer-recovery" id="site-footer-recovery" hidden>We could not send your follow-up request. Your email address is still in the field above, and nothing else on this page changed. Retry sends the same request again from this page; if it keeps failing, wait a few minutes and retry.</p>',
    '        <div class="site-footer-actions">',
    '          <button type="submit">Request a follow-up</button>',
    `          <button id="${RETRY_ID}" type="submit" hidden>Retry sending this request</button>`,
    '          <button id="site-footer-dismiss" type="button">Close</button>',
    "        </div>",
    "      </form>",
    '      <p class="site-footer-status" id="site-footer-status" role="status" aria-live="polite"></p>',
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
  const retry = root.querySelector(`#${RETRY_ID}`);

  function setFieldError(message) {
    fieldError.textContent = message ?? "";
    fieldError.hidden = !message;
    describeWith(email, ERROR_ID, Boolean(message));
    if (message) email.setAttribute("aria-invalid", "true");
    else email.removeAttribute("aria-invalid");
  }

  // A failure is recovered here, on the page it happened on: the retry stands
  // where the send control was and submits this form again, value and all.
  function setRecoveryVisible(visible) {
    recovery.hidden = !visible;
    if (retry) {
      retry.hidden = !visible;
      submit.hidden = visible;
    }
    describeWith(email, RECOVERY_ID, visible);
  }

  // A success moves focus into the receipt. A failure leaves a reader at the
  // field they have to resubmit, so that field carries the outcome in its
  // description and reads as invalid until another request starts.
  function setOutcomeDescribed(failed) {
    describeWith(email, STATUS_ID, failed);
    if (failed) email.setAttribute("aria-invalid", "true");
    else email.removeAttribute("aria-invalid");
  }

  // The success state. Once a request lands the form goes away and this receipt
  // takes its place, so there is nothing left to press a second time; the
  // announcement stays in the live region below, where the failure's does.
  const confirmation = createFollowUpConfirmation({
    form,
    status,
    submit,
    email,
    // Coming back to the form clears the outcome of the last request: it reports
    // something that happened, and the visitor has just said they are not done.
    onReopen: () => { status.textContent = ""; delete form.dataset.state; setOutcomeDescribed(false); },
  });

  function open() {
    if (!panel.hidden) return;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    // Revealing a form and leaving focus on the trigger above it strands a
    // keyboard user at the very moment they asked for the form. After a request
    // has landed there is no form to land in, so the receipt takes the focus.
    if (confirmation.sent) confirmation.region.focus();
    else email.focus();
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
    } else if (form.dataset.state === "error") {
      // The address is being changed, so it is no longer the one the last
      // attempt failed on. The live region and the recovery paragraph stay —
      // that request really did fail — but the field stops reading as invalid.
      setOutcomeDescribed(false);
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (confirmation.sent) return;
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
    // The last outcome stops describing the field once a new one is in flight.
    setOutcomeDescribed(false);
    submit.disabled = true;
    submit.setAttribute("aria-disabled", "true");
    // Announced, not merely spun: the live region carries the pending state to a
    // reader who never sees the button change.
    status.textContent = SUBMITTING;

    try {
      const address = email.value.trim();
      const body = await postLeadEmail(
        request, email.value, form.dataset.followUpType || "follow_up", CONTACT_COPY,
      );
      form.dataset.state = "success";
      status.textContent = body.created ? CAPTURED : ALREADY_CAPTURED;
      // The form is replaced from here, so the control that would send again is
      // gone before the `finally` below could bring it back.
      confirmation.show(address);
    } catch (error) {
      // Copy this repository owns, never a string an intermediary supplied, and
      // never a claim that the address was lost when that is not known.
      form.dataset.state = "error";
      status.textContent = error instanceof SubmissionError ? error.message : CONTACT_COPY.unconfirmed;
      // Every failure here is retryable in place, so the paragraph that says so
      // and the control that does it appear on all of them — the same rule the
      // AI FinOps form follows.
      setRecoveryVisible(true);
      setOutcomeDescribed(true);
    } finally {
      // Retry has to work without a reload, so the control comes back on every
      // path out of the request — except the one where the request landed and
      // the form it belongs to is no longer on screen.
      if (!confirmation.sent) {
        submit.disabled = false;
        submit.removeAttribute("aria-disabled");
      }
    }
  });

  return form;
}
