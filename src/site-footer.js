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
//   2. The email affordance is an inline form, not a dialog or disclosure. A
//      visitor sees the one field and its action on first paint. There is no
//      focus trap to escape and nothing overlays the page they were reading.
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
  CONTACT_COPY, describeWith, emailFieldError, FOLLOW_UP_PRIVACY, FOLLOW_UP_PRIVACY_WITH_MESSAGE,
  FOLLOW_UP_USE, knownNotSent, looksLikeEmail, MAX_FOLLOW_UP_MESSAGE_LENGTH, overLengthMessage,
  postLeadEmail, SubmissionError,
} from "./lead-capture.js";
import { REPOSITORY_URL } from "./repository-url.js";

const ERROR_ID = "site-footer-error";
const RECOVERY_ID = "site-footer-recovery";
const REPOSITORY_ID = "site-footer-repository";
const RETRY_ID = "site-footer-retry";
const STATUS_ID = "site-footer-status";

/**
 * The one other way in, offered only once the first one has failed.
 *
 * A visitor whose request did not land had exactly one thing to press, and it
 * was the thing that had just not worked. This is a destination that does not
 * run through that transport at all — the public repository the site is built
 * from, already published on /releases.html and /index.html. It is deliberately
 * not a second inbox, a chat channel, or a promise about a reply: this project
 * has none of those to offer, and inventing one would be worse than the dead end
 * it replaces. The label names the destination and the act, so a reader who
 * arrives on it by Tab knows it goes somewhere the retry beside it does not.
 */
export const REPOSITORY_LINK_LABEL = "Open an issue on the public GitHub repository";

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

// Who Shiplog is for, and the page that shows it working; the tests say why.
export const PITCH = "Shiplog is for engineering teams that answer for an AI bill and a release history.";
export const PITCH_LINK = "the worked decision in AI FinOps";
export const PITCH_HREF = "/evolution.html#workspace-answer";

/**
 * Every door the navigation offers, and what each one is for.
 *
 * This band is the only directory on the pages whose body carries none, so a
 * surface left out is one a reader has to guess at. Every row is a link.
 *
 * `label` and `href` are the word and the path src/site-nav.js uses — for a row
 * carrying `beneath`, the path that navigation files under it. They are
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
  Object.freeze({ label: "Prompt coach", href: "/coach.html", purpose: "grade a prompt, then revise and grade again" }),
  // `beneath` names the destination this page is filed under: src/site-nav.js
  // gives /personal-history.html no door of its own, so this band is the only
  // directory that can offer one. It used to be a clause hung off the Prompt
  // coach row, which described two destinations in one row and gave the
  // second no entry of its own. Its browser-tab clause is a promise, as above.
  Object.freeze({
    label: "Personal AI history",
    href: "/personal-history.html",
    purpose: "grades your assistant export in this browser tab",
    beneath: "Prompt coach",
  }),
  Object.freeze({ label: "Decisions", href: "/", purpose: "record a decision, then search the history" }),
  Object.freeze({ label: "Releases", href: "/releases.html", purpose: "every release and the decisions it carried" }),
  Object.freeze({ label: "Social", href: "/social.html", purpose: "read short posts about what the team ships, images optional" }),
  Object.freeze({ label: "People", href: "/profile.html", purpose: "pick a display name, see its image posts, newest first" }),
  Object.freeze({ label: "Paint", href: "/paint/", purpose: "crop or draw an image, export a PNG, publish it on Social" }),
  Object.freeze({ label: "Agent observatory", href: "/agents.html", purpose: "watch a synthetic engineering team build and review work" }),
]);

/**
 * The context the controls do not carry.
 *
 * The button beside it names the errand — a follow-up — but not what the
 * follow-up would be about, or who is on the other end. That is this sentence's
 * job, and it stands above the form because a visitor reads it before deciding
 * whether to type an address into anything.
 */
export const INVITATION = "Questions about Shiplog? Send the Wawalu team that operates it a follow-up request.";

/**
 * What asking actually gets a visitor — the home page's answer, on the pages a
 * shared link lands on.
 *
 * A reader who arrived on a deep page from a forwarded link had only INVITATION
 * above, which names the errand and not the offer. The home page's "How a team
 * gets Shiplog" paragraph answers it, so its claims are reused rather than
 * rewritten, and nothing is added: no reply time, no figure, no promise the
 * home page does not already make. tests/follow-up-offer.test.js compares this
 * against that paragraph, so the two cannot become two answers.
 */
export const OFFER = "There is no self-serve signup and no published price. Whether Shiplog is available "
  + "for your team and what it would cost are both answered on request.";

// What the field sends is not this footer's sentence to write: all three
// follow-up forms render FOLLOW_UP_PRIVACY from src/lead-capture.js, beside
// the transport that makes it true.

// What a visitor is told once the address is stored.
//
// One string on every page that ships this footer, so it can only claim the
// field all of them send. A topic goes only from the pages that declare one, and
// is named in the receipt, which knows whether there was one. Neither promises a
// reply, a response time, or an action: nothing here guarantees any of them.
const CAPTURED = "Request sent to the Wawalu team. Your submitted work email was recorded.";
const ALREADY_CAPTURED = "Request sent to the Wawalu team. That work email was already recorded, so no duplicate row was added.";

const SUBMITTING = "Requesting a follow-up — sending your email address…";
const RECOVERY_GUIDANCE = "Retry the same request from this page. If it keeps failing, wait a few minutes and retry.";

// What a failure is, before what it left behind: a visitor asks whether the
// team got their request, so the paragraph answers that in its first sentence
// rather than describing the field. Two answers and never a third — the origin
// refused it, or nobody answered and we cannot say. `knownNotSent` picks.
const RECOVERY_NOT_SENT = "No request was sent.";
const RECOVERY_UNCONFIRMED = "We could not confirm whether your request was sent.";

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
 * `redirect` replaces the inline form with a pointer to a page's own follow-up
 * form — see FOLLOW_UP_REDIRECT. The identity paragraph never varies: every
 * page says who runs Shiplog and where.
 *
 * `collapsedDemos` folds the destination list into a disclosure that ships
 * closed. Only /post.html asks for it: a forwarded link is opened to read one
 * post, and the map of everywhere else was the larger half of that page.
 *
 * `askMessage` adds the home page's optional question field above the work-email
 * field, and switches the privacy sentence with it: a form carrying a message
 * box cannot claim nothing else on the page is sent.
 *
 * `offer` opens the block with OFFER — what asking gets a visitor who never read
 * the home page's answer to the same question.
 */
export function siteFooterMarkup(indent = "    ", {
  redirect = null, followUpType = null, followUpTopic = null, statedTopic = false,
  collapsedDemos = false, askMessage = false, offer = false,
} = {}) {
  const contact = redirect ? [
    `    <a class="site-footer-redirect-link" href="${redirect.href}">${redirect.label}</a>`,
  ] : contactFormLines(followUpType, followUpTopic, statedTopic, askMessage, offer);
  const lines = [
    '<footer class="site-footer" id="site-footer" aria-labelledby="site-footer-title">',
    '  <div class="site-footer-inner">',
    '    <h2 class="site-footer-title" id="site-footer-title">About Shiplog</h2>',
    `    <p class="site-footer-identity">${IDENTITY}</p>`,
    `    <p class="site-footer-identity site-footer-pitch">${PITCH} See <a href="${PITCH_HREF}">${PITCH_LINK}</a>.</p>`,
    ...demoListLines(collapsedDemos),
    ...contact,
    "  </div>",
    "</footer>",
  ];
  return lines.map((line) => `${indent}${line}`).join("\n");
}

// The one line a folded directory gets: the rest of the site, and how much of it.
export const DIRECTORY_SUMMARY = `Where else to go on Shiplog — all ${DEMOS.length} destinations`;

/**
 * A real <ul>, so the destinations arrive as a list rather than a run-on
 * sentence and a screen reader gets the count. The hrefs are root-relative:
 * this band ships on every page, and a bare relative path would resolve against
 * a page in a subdirectory rather than against the site.
 *
 * `collapsed` wraps that same list, unchanged, in a disclosure. The summary
 * reuses the band's caption class and restyles no marker, so it paints one
 * triangle and keeps the band's ring. Nothing that announces is inside.
 */
function demoListLines(collapsed = false) {
  const list = [
    '    <ul class="site-footer-demos">',
    ...DEMOS.map(({ label, href, purpose, note }) =>
      `      <li><a href="${href}">${label}</a> — ${note ? `${note} ` : ""}${purpose}</li>`),
    "    </ul>",
  ];
  if (!collapsed) return list;
  return [
    '    <details id="site-footer-directory">',
    `      <summary class="site-footer-note" id="site-footer-directory-summary">${DIRECTORY_SUMMARY}</summary>`,
    ...list.map((line) => `  ${line}`),
    "    </details>",
  ];
}

// Above the address on purpose: a visitor decides what to ask before deciding
// whether to hand over a work address for the answer, and keyboard order is
// reading order. Every class and string here is the home page field's.
function messageFieldLines() {
  return [
    '        <div class="site-footer-field">',
    '          <label for="site-footer-message">What do you want to know? <span class="label-optional">(optional)</span></label>',
    '          <input id="site-footer-message" name="message" type="text" autocomplete="off" aria-describedby="site-footer-message-hint site-footer-message-counter-label site-footer-message-counter" />',
    '          <p class="site-footer-error" id="site-footer-message-error" role="alert" hidden></p>',
    `          <span class="hint" id="site-footer-message-hint">Up to ${MAX_FOLLOW_UP_MESSAGE_LENGTH} characters.</span>`,
    '          <p class="counter-row">',
    '            <span id="site-footer-message-counter-label">Characters remaining:</span>',
    `            <span id="site-footer-message-counter" aria-live="polite" aria-atomic="true">${MAX_FOLLOW_UP_MESSAGE_LENGTH}</span>`,
    "          </p>",
    "        </div>",
  ];
}

function contactFormLines(followUpType, followUpTopic, stated, askMessage = false, offer = false) {
  return [
    `    <p class="site-footer-invitation">${INVITATION}</p>`,
    '    <div class="site-footer-panel" id="site-footer-panel">',
    `      <form id="site-footer-form" class="site-footer-form"${followUpType ? ` data-follow-up-type="${followUpType}"` : ""}${followUpTopic ? ` data-follow-up-topic="${followUpTopic}"` : ""} novalidate>`,
    // Why to ask, then what this request is about, then the fields: a visitor
    // reads the offer before the topic, and both before an address.
    ...(offer ? [`        <p class="site-footer-note" id="site-footer-offer">${OFFER}</p>`] : []),
    ...(!followUpTopic ? [] : stated ? [
      `        <p class="site-footer-note" id="site-footer-topic-note">This request is sent about the ${followUpTopic}.</p>`,
    ] : [
      '        <div class="site-footer-field">',
      '          <label for="site-footer-topic">Follow-up topic</label>',
      `          <input id="site-footer-topic" type="text" value="${followUpTopic}" readonly />`,
      "        </div>",
    ]),
    ...(askMessage ? messageFieldLines() : []),
    '        <div class="site-footer-field">',
    '          <label for="site-footer-email">Work email for your follow-up</label>',
    "          <!-- Only the note is named here. The inline error and the recovery",
    "               paragraph are added to this description by site-footer.js when",
    "               they exist, because a hidden element referenced by",
    "               aria-describedby is still part of the accessible description",
    "               and would otherwise be read on first focus. -->",
    '          <input id="site-footer-email" name="email" type="email" maxlength="254" inputmode="email" autocomplete="email" placeholder="you@company.com" required aria-describedby="site-footer-note" />',
    "        </div>",
    `        <p class="site-footer-error" id="site-footer-error" hidden></p>`,
    `        <p class="site-footer-note" id="site-footer-note">${askMessage ? FOLLOW_UP_PRIVACY_WITH_MESSAGE : FOLLOW_UP_PRIVACY}</p>`,
    `        <p class="site-footer-note" id="site-footer-use">${FOLLOW_UP_USE}</p>`,
    '        <p class="site-footer-recovery" id="site-footer-recovery" hidden></p>',
    '        <div class="site-footer-actions">',
    '          <button type="submit">Request a follow-up</button>',
    `          <button id="${RETRY_ID}" type="submit" hidden>Retry your follow-up request</button>`,
    "        </div>",
    "      </form>",
    '      <p class="site-footer-status" id="site-footer-status" role="status" aria-live="polite"></p>',
    "    </div>",
  ];
}

/**
 * Bring the submission to life. Every page ships the markup, so a page where
 * this never runs still names who operates Shiplog — but nothing intercepts the
 * submit there, and no request reaches the transport below. It is this listener,
 * not the markup, that makes the field mean anything.
 *
 * `request` is deferred to call time for the same reason the AI FinOps form
 * defers it: a test that takes over `globalThis.fetch` after the page mounts
 * must still be the one that receives the submission.
 */
export function initSiteFooter(root = document, request = (...args) => globalThis.fetch(...args)) {
  const form = root.querySelector("#site-footer-form");
  const panel = root.querySelector("#site-footer-panel");
  if (!form || !panel) return null;

  const email = form.elements.email;
  // Only the pages that ask a question ship these three; everything below has
  // to work exactly as it did when none of them existed.
  const message = form.elements.message ?? null;
  const messageError = root.querySelector("#site-footer-message-error");
  const counter = root.querySelector("#site-footer-message-counter");
  const submit = form.querySelector('button[type="submit"]');
  const fieldError = root.querySelector(`#${ERROR_ID}`);
  const status = root.querySelector("#site-footer-status");
  const recovery = root.querySelector(`#${RECOVERY_ID}`);
  const retry = root.querySelector(`#${RETRY_ID}`);
  const actions = form.querySelector(".site-footer-actions");

  // The alternative route is built here rather than shipped in the markup, for
  // the reason the receipt is: a node that exists before anything has failed is
  // a node a screen reader can find and read out to a visitor who has not
  // submitted anything. It is created on the first failure and taken off the
  // page by every path out of one, so a landed request cannot leave it standing
  // beside its own receipt.
  //
  // It goes between the recovery paragraph and the action row, which puts it
  // immediately before the retry in the tab order: the send control that sits
  // between them is hidden for exactly as long as this link is on the page.
  let repositoryLink = null;
  function setRepositoryLinkVisible(visible) {
    if (!visible) {
      repositoryLink?.remove();
      return;
    }
    if (!repositoryLink) {
      repositoryLink = form.ownerDocument.createElement("a");
      repositoryLink.id = REPOSITORY_ID;
      // The footer's own standalone-link treatment: a 44px tap target, blue and
      // underlined, with the band's focus ring. No rule is added for it.
      repositoryLink.className = "site-footer-redirect-link";
      repositoryLink.href = REPOSITORY_URL;
      repositoryLink.textContent = REPOSITORY_LINK_LABEL;
    }
    if (!repositoryLink.parentNode && actions) form.insertBefore(repositoryLink, actions);
  }

  function setFieldError(message) {
    fieldError.textContent = message ?? "";
    fieldError.hidden = !message;
    describeWith(email, ERROR_ID, Boolean(message));
    if (message) email.setAttribute("aria-invalid", "true");
    else email.removeAttribute("aria-invalid");
  }

  // A failure is recovered here, on the page it happened on: the retry stands
  // where the send control was and submits this form again, value and all.
  //
  // The swap is the one moment this form can hide the control a reader is
  // standing on, and a browser answers that by dropping focus to the top of the
  // document — out of the footer, above everything they read, with no
  // announcement. So the control being hidden hands focus to the field, which is
  // present on both sides of the swap and is the thing they may want to correct.
  // Not the control replacing it: the submit path disables that a line later.
  // Written when the outcome is known, not before: the authored markup ships
  // only the half of the paragraph that is true of both failures.
  function setRecoveryVisible(visible, notSent = false) {
    if (visible) {
      recovery.textContent = `${notSent ? RECOVERY_NOT_SENT : RECOVERY_UNCONFIRMED} ${RECOVERY_GUIDANCE}`;
    }
    recovery.hidden = !visible;
    setRepositoryLinkVisible(visible);
    if (retry) {
      const stranded = form.ownerDocument.activeElement === (visible ? submit : retry);
      retry.hidden = !visible;
      submit.hidden = visible;
      if (stranded) email.focus();
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

  // The live count and the refusal beside it, off one measurement in one moment,
  // so the number and the sentence cannot disagree about which side of the limit
  // the message is on. Returns the answer the submit path needs too.
  function overLimit() {
    if (!message || !counter || !messageError) return false;
    const { length } = message.value;
    const over = length > MAX_FOLLOW_UP_MESSAGE_LENGTH;
    counter.textContent = `${MAX_FOLLOW_UP_MESSAGE_LENGTH - length}`;
    messageError.textContent = over ? overLengthMessage(length) : "";
    messageError.hidden = !over;
    if (over) message.setAttribute("aria-invalid", "true");
    else message.removeAttribute("aria-invalid");
    return over;
  }
  message?.addEventListener("input", overLimit);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    // One request in flight, one request per receipt. The disabled control and
    // the hidden retry make a second submission hard to reach by hand, but this
    // form now carries two submit buttons and an implicit submission from the
    // field, so what stops a duplicate POST is stated here rather than left to
    // emerge from which control happens to be visible.
    if (confirmation.sent || form.dataset.state === "submitting") return;
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
    // Refused against the number the endpoint would refuse it against. Nothing
    // typed is cleared or truncated on the way out.
    if (overLimit()) {
      form.dataset.state = "invalid";
      setFieldError(null);
      setRecoveryVisible(false);
      status.textContent = "";
      message.focus();
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
      const topic = form.dataset.followUpTopic;
      // Blank stays off the wire: an empty optional field sends exactly the
      // request this form sent before it existed.
      const note = message?.value.trim() || null;
      const body = await postLeadEmail(request, email.value, form.dataset.followUpType || "follow_up", CONTACT_COPY, topic, note);
      form.dataset.state = "success";
      status.textContent = body.created ? CAPTURED : ALREADY_CAPTURED;
      // The form is replaced from here, so the control that would send again is
      // gone before the `finally` below could bring it back.
      confirmation.show(address, topic, Boolean(note));
    } catch (error) {
      // Copy this repository owns, never a string an intermediary supplied, and
      // never a claim that the address was lost when that is not known.
      form.dataset.state = "error";
      status.textContent = error instanceof SubmissionError ? error.message : CONTACT_COPY.unconfirmed;
      // Every failure here is retryable in place, so the paragraph that says so
      // and the control that does it appear on all of them — the same rule the
      // AI FinOps form follows.
      setRecoveryVisible(true, knownNotSent(error));
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
