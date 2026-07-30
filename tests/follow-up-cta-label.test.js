// One label for one thing, on every surface that asks for a work email.
//
// The site has three follow-up forms — the footer's, the AI FinOps result's, and
// the executive briefing's — plus the controls that open them. They used to be
// labelled five different ways: "Talk to us about Shiplog", "Talk to us about
// your numbers", "Discuss this briefing with us", "Ask for a walkthrough",
// "Send my email". A visitor moving between the agent observatory, the AI FinOps
// page, and the briefing had to work out that all five asked for the same thing
// from the same team, and the words a page used told them nothing about that.
//
// So every control that opens or submits one of these forms now reads exactly
// "Request a follow-up", with no page-specific qualification on the button. The
// context — a follow-up about what, from whom — lives in the copy beside it,
// which is what this file pins alongside the label: an unqualified CTA is only
// an improvement when the sentence next to it still answers the question.
//
// The rendered pages are the subject. Reading the shipped HTML rather than the
// constants is the point: a constant nothing renders is not a label a visitor
// sees, and this suite exists because five of them had drifted apart in markup.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, textOf } from "./support/browser.js";
import { CONTACT_COPY } from "../src/lead-capture.js";
import { INVITATION, PRIVACY, PURPOSE } from "../src/site-footer.js";
import { FIRST_RUN_CONVERSION } from "../src/finops-first-run.js";

/** The one label. Written out here so a rename has to be a decision, not a diff. */
const CTA = "Request a follow-up";

const pageUrl = (file) => new URL(`../src/${file}`, import.meta.url);

// Every page that ships the footer's own follow-up form. The executive briefing
// is deliberately absent: its footer points at the briefing's form instead of
// carrying a second one, and tests/site-footer.test.js owns that exception.
const FOOTER_PAGES = [
  "index.html", "decision.html", "workspace.html", "social.html", "post.html", "profile.html",
  "releases.html", "release.html", "evolution.html", "coach.html", "personal-history.html",
  "savings-action-center.html", "savings-commitment.html", "agents.html", "agent-trace.html",
];

// The controls that open a follow-up form, and the controls that submit one, on
// the surfaces named in issue #646. Both kinds carry the same label: pressing
// the first begins the request and pressing the second completes it, and a
// visitor should not have to learn two names for one errand.
const SURFACES = [
  {
    page: "evolution.html",
    what: "AI FinOps result",
    buttons: ["finops-contact-open", "finops-first-run-contact", "finops-followup-cta"],
    forms: ["finops-contact-form"],
    context: ["finops-contact", "finops-first-run-conversion", "finops-result-followup"],
  },
  {
    page: "executive-briefing.html",
    what: "executive briefing",
    buttons: ["briefing-contact-open"],
    forms: ["briefing-contact-form"],
    context: ["briefing-contact"],
  },
  {
    page: "agents.html",
    what: "agent observatory footer",
    buttons: ["site-footer-open"],
    forms: ["site-footer-form"],
    context: ["site-footer"],
  },
];

const byId = (document, id) => document.getElementById(id);
const submitOf = (document, formId) => byId(document, formId)?.querySelector('button[type="submit"]');

// Words that named the same errand something else. A visitor reading two of
// these on two pages has no way to know they lead to the same inbox.
const COMPETING = [/walkthrough/i, /\bdiscuss/i, /\bconversation/i, /\bchat\b/i, /\bdemo\b/i];

test("every control that opens or submits a follow-up form reads exactly the one CTA label", async () => {
  for (const { page: file, what, buttons, forms } of SURFACES) {
    const page = await loadPage(pageUrl(file));
    try {
      const controls = [
        ...buttons.map((id) => [id, byId(page.document, id)]),
        ...forms.map((id) => [`${id} submit`, submitOf(page.document, id)]),
      ];
      for (const [name, control] of controls) {
        assert.ok(control, `${what}: ${name} does not render on ${file}`);
        assert.equal(textOf(control), CTA, `${what}: ${name} must read "${CTA}"`);
      }
    } finally {
      page.restore();
    }
  }

  // The AI FinOps conversion control is re-labelled from this constant when the
  // first-run view repaints, so the constant and the shipped markup above have
  // to agree. The briefing's in-sheet invitation is painted rather than shipped;
  // tests/follow-up-conversion.test.js pins its rendered label.
  assert.equal(FIRST_RUN_CONVERSION.label, CTA);
});

test("the footer's follow-up control reads the same on every page that carries it", async () => {
  for (const file of FOOTER_PAGES) {
    const page = await loadPage(pageUrl(file));
    try {
      const { document } = page;
      assert.equal(textOf(byId(document, "site-footer-open")), CTA, `${file}: footer trigger`);
      assert.equal(textOf(submitOf(document, "site-footer-form")), CTA, `${file}: footer submit`);
    } finally {
      page.restore();
    }
  }
});

test("no follow-up surface calls the same errand a walkthrough, a discussion, or a conversation", async () => {
  for (const { page: file, what, context } of SURFACES) {
    const page = await loadPage(pageUrl(file));
    try {
      for (const id of context) {
        const region = byId(page.document, id);
        assert.ok(region, `${what}: #${id} does not render on ${file}`);
        const copy = textOf(region);
        for (const term of COMPETING) {
          assert.doesNotMatch(copy, term, `${what}: #${id} still names the follow-up "${term}"`);
        }
      }
    } finally {
      page.restore();
    }
  }

  // The shared validation copy is read by all three forms, so it is the one
  // place a competing term would reach every surface at once.
  for (const message of [CONTACT_COPY.emptyEmail, CONTACT_COPY.invalidEmail]) {
    assert.match(message, /request a Shiplog follow-up\.$/);
    for (const term of COMPETING) assert.doesNotMatch(message, term);
  }
});

test("each surface says beside its button that submitting sends only the work email typed", async () => {
  // The label carries no context, so this is the copy that has to carry it: what
  // the button asks for, and the one thing that leaves the browser.
  const sends = /sends? one thing[:,] the work email address you type/i;

  for (const { page: file, what, context } of SURFACES) {
    const page = await loadPage(pageUrl(file));
    try {
      const copy = context.map((id) => textOf(byId(page.document, id))).join(" ");
      assert.match(copy, sends, `${what}: nothing beside the button says what is sent`);
      assert.match(copy, /follow-up/i, `${what}: nothing beside the button names what is being asked for`);
    } finally {
      page.restore();
    }
  }

  // The footer's is split in two on purpose: the invitation is readable before
  // the panel is opened, the note is the field's accessible description.
  assert.match(INVITATION, /Shiplog/);
  assert.match(PURPOSE, /^Submitting sends a Shiplog follow-up request\./);
  assert.match(PRIVACY, sends);
});
