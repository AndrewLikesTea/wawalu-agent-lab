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
const REASON_ID = "site-footer-reason";

/**
 * Why a visitor is reaching out, in the words the form offers and the values the
 * endpoint accepts.
 *
 * This is the browser half of a two-halved contract: `LEAD_REASONS` in
 * src/leads.js is the same list of values, and tests/leads.test.js pins them to
 * each other. It is not imported from there — that module is the endpoint's, and
 * no page ships server code — so the test is what keeps a choice this form
 * offers from being one the endpoint would refuse.
 *
 * A native radio group in a fieldset, rendered from this list. Three real
 * controls rather than a select, because a radio group is one tab stop, arrow
 * keys move between the options, and nothing about it needs a script to work.
 * The first two are the two the issue named; the third is what keeps a visitor
 * who is neither from having to misfile themselves to be heard at all.
 */
export const FOLLOW_UP_REASONS = Object.freeze([
  Object.freeze({
    value: "own_spend",
    id: "site-footer-reason-own-spend",
    label: "Running Shiplog against my own AI spend",
  }),
  Object.freeze({
    value: "demo_question",
    id: "site-footer-reason-demo-question",
    label: "A question about the demonstration",
  }),
  Object.freeze({
    value: "something_else",
    id: "site-footer-reason-something-else",
    label: "Something else",
  }),
]);

/** The question above the group, and the claim the group's own answer makes. */
export const REASON_LEGEND = "Why are you getting in touch?";
export const REASON_PRIVACY = "The reason you choose is sent with your work email address; "
  + "nothing else on this page is sent.";

/**
 * What a visitor is told when they typed an address and chose nothing.
 *
 * It names the missing choice rather than saying the form is incomplete, and it
 * names what the form would have done, the way every other inline message on
 * this surface does.
 */
export const REASON_REQUIRED = "Choose why you are getting in touch to request a Shiplog follow-up.";

/**
 * What a visitor can do here, then who runs it and where — on every page.
 *
 * The doing sentence comes first on purpose. This band used to open by defining
 * Shiplog as a decision and release log, which describes one section of one page
 * and contradicts what the site leads with: the home page's title, heading, and
 * first call to action are all AI FinOps.
 *
 * The second sentence still names an organisation and a hosting claim, both
 * checkable from outside. Between them they claim no customer, no usage, no
 * funding, and no result — there is no evidence here for any of those. Every
 * verb in the first sentence is something a page this site ships today does,
 * and DEMOS says which page.
 */
export const IDENTITY = "On this site you can analyze your own AI spend, check a prompt before you send "
  + "it, and read the decisions and releases behind it. Shiplog is a demonstration product, built and "
  + "operated by Wawalu at labs.wawalu.org.";

/**
 * Every door the navigation offers, and what each one is for.
 *
 * This band is the only directory on the pages whose body carries none, so a
 * surface left out is one a reader has to guess at. Each `label` is the word
 * src/site-nav.js uses, and each description is word for word the sentence the
 * home page's "Where everything is" list gives that surface: one name and one
 * description per concept.
 *
 * AI FinOps is first and is the only link: it is what the site leads with. The
 * href is root-relative because this band ships on every page — a bare relative
 * path would resolve against a page in a subdirectory rather than the site.
 */
export const DEMOS = Object.freeze([
  Object.freeze({
    label: "AI FinOps",
    href: "/evolution.html",
    description: "Find where to act first on your AI spend: score your own provider export in this browser tab.",
    // The only row that says "start here": a list with no order is no list.
    note: "Start here.",
  }),
  Object.freeze({ label: "Prompt coach", description: "Grade one prompt against a bundled rubric in your browser tab, then revise it and grade again." }),
  Object.freeze({ label: "Decisions", description: "Record a decision with its context, alternatives, and owner, then search and filter the history." }),
  Object.freeze({ label: "Releases", description: "Every release, newest first, with the decisions it carried." }),
  Object.freeze({ label: "Social", description: "Social is a shared demo feed of short posts about the work the team ships, each with an optional image." }),
  Object.freeze({ label: "People", description: "Pick a display name and see the image posts published under it, newest first. The picker is on the page." }),
  Object.freeze({ label: "Paint", description: "Draw or crop an image in this tab, export a PNG, then hand it to a Social post yourself." }),
  Object.freeze({ label: "Agent observatory", description: "Watch a synthetic engineering team plan, build, review, and deliver work." }),
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

// What the field sends is not this footer's sentence to write. It is the same
// claim the AI FinOps form and the briefing's form make, so all three render one
// string — FOLLOW_UP_PRIVACY in src/lead-capture.js, beside the transport that
// makes it true.

// What a visitor is told once the address is stored.
//
// Deliberately not an SLA. The AI FinOps form answers within two business days
// because someone watches that queue; this footer sits on eight pages of a
// demonstration product and nobody has promised to watch it that closely. So it
// says what is actually true — the address is recorded, a person is the one who
// reads it, and no machine is about to reply — rather than a response time this
// demo would break.
const CAPTURED = "Follow-up requested — we sent your email address and the reason you chose, and "
  + "nothing else. They are recorded for the Wawalu team, and a person replies by email; nothing "
  + "here answers automatically.";
const ALREADY_CAPTURED = "Follow-up requested — that address is already on our list, so nothing new "
  + "was recorded. The Wawalu team can reach you there.";

// Two things go now, so the pending sentence says two. It is the same claim the
// form made above the button, in the tense of a request that is in flight.
const SUBMITTING = "Requesting a follow-up — sending your email address and reason…";

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
 *
 * It is a link and nothing else. It used to be preceded by a paragraph
 * explaining that the page carries its own form and which of the page's two
 * forms to use — an explanation a reader only needs if the link is unclear, and
 * the fix for that is a clear link. So it carries the one label every control
 * that leads to a follow-up carries, and the target takes focus (see the
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
export function siteFooterMarkup(indent = "    ", { redirect = null } = {}) {
  const contact = redirect ? [
    `    <a class="site-footer-redirect-link" href="${redirect.href}">${redirect.label}</a>`,
  ] : contactDisclosureLines();
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
 * sentence and a screen reader gets the count. Only the primary demo is a link
 * — the rest are named as the nav names them, and that is where a visitor
 * reaches them.
 */
function demoListLines() {
  return [
    '    <ul class="site-footer-demos">',
    ...DEMOS.map(({ label, href, description, note }) => {
      const name = href ? `<a href="${href}">${label}</a>` : `<strong>${label}</strong>`;
      return `      <li>${name} — ${description}${note ? ` ${note}` : ""}</li>`;
    }),
    "    </ul>",
  ];
}

/** The words a reason was chosen by, for the receipt that reads it back. */
export function labelForReason(value) {
  return FOLLOW_UP_REASONS.find((reason) => reason.value === value)?.label ?? null;
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
    // A real fieldset with a legend: the question is the group's accessible
    // name, the three options are one tab stop, and it sits between the field
    // and the button because that is the order the request is built in.
    '        <fieldset class="site-footer-reason" id="site-footer-reason" aria-describedby="site-footer-reason-note">',
    `          <legend>${REASON_LEGEND}</legend>`,
    ...FOLLOW_UP_REASONS.flatMap(({ value, id, label }) => [
      '          <div class="site-footer-choice">',
      `            <input id="${id}" name="reason" type="radio" value="${value}" required />`,
      `            <label for="${id}">${label}</label>`,
      "          </div>",
    ]),
    `          <p class="site-footer-reason-note" id="site-footer-reason-note">${REASON_PRIVACY}</p>`,
    "        </fieldset>",
    `        <p class="site-footer-error" id="site-footer-error" hidden></p>`,
    `        <p class="site-footer-note" id="site-footer-note">${FOLLOW_UP_PRIVACY}</p>`,
    '        <div class="site-footer-actions">',
    '          <button type="submit">Request a follow-up</button>',
    '          <button id="site-footer-dismiss" type="button">Close</button>',
    "        </div>",
    "      </form>",
    '      <p class="site-footer-status" id="site-footer-status" role="status" aria-live="polite"></p>',
    '      <p class="site-footer-recovery" id="site-footer-recovery" hidden>We could not send your follow-up request. Try again in a few minutes. Your email address is still in the field above, and nothing else on this page changed.</p>',
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
  const reasonGroup = form.querySelector(`#${REASON_ID}`);
  // Spread, not the live list: this is read in both a browser and the test
  // harness, and only an array answers `.find` in both.
  const reasons = [...form.querySelectorAll('input[name="reason"]')];
  const chosenReason = () => reasons.find((radio) => radio.checked) ?? null;

  /**
   * One diagnostic paragraph, described to whichever control has to change.
   * Pointing it at both would tell a visitor with a valid address that the
   * address is the problem.
   */
  function setFieldError(message, control = email) {
    fieldError.textContent = message ?? "";
    fieldError.hidden = !message;
    for (const owner of [email, reasonGroup]) {
      if (!owner) continue;
      const owns = Boolean(message) && owner === control;
      describeWith(owner, ERROR_ID, owns);
      if (owns) owner.setAttribute("aria-invalid", "true");
      else owner.removeAttribute("aria-invalid");
    }
  }

  function setRecoveryVisible(visible) {
    recovery.hidden = !visible;
    describeWith(email, RECOVERY_ID, visible);
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
    onReopen: () => { status.textContent = ""; delete form.dataset.state; },
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
  function retractDiagnostic() {
    if (form.dataset.state !== "invalid") return;
    delete form.dataset.state;
    setFieldError(null);
  }

  email.addEventListener("input", retractDiagnostic);
  // Choosing a reason answers the diagnostic about the missing choice the same
  // way typing answers the one about the address.
  for (const radio of reasons) radio.addEventListener("change", retractDiagnostic);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    // A request that landed is the end of this form's work. Nothing reachable
    // can fire this handler once the receipt is up, and this is the guarantee
    // that stays true even if something synthetic tries.
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
    // Nothing leaves the page until the visitor has said why. The endpoint
    // refuses an unknown reason on its own — this is the half that keeps a
    // visitor from finding that out through a failed request.
    const choice = chosenReason();
    if (!choice) {
      form.dataset.state = "invalid";
      setFieldError(REASON_REQUIRED, reasonGroup);
      setRecoveryVisible(false);
      status.textContent = "";
      reasons[0]?.focus();
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
      const address = email.value.trim();
      const body = await postLeadEmail(request, email.value, "follow_up", CONTACT_COPY, choice.value);
      form.dataset.state = "success";
      status.textContent = body.created ? CAPTURED : ALREADY_CAPTURED;
      // The form is replaced from here, so the control that would send again is
      // gone before the `finally` below could bring it back. The receipt reads
      // the choice back in the words the visitor picked it by, not the value
      // that travelled.
      confirmation.show(address, labelForReason(choice.value));
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
