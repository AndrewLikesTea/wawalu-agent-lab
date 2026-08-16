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
// The footer's own submit was the last holdout: it read "Send work email to
// request a follow-up" while the home page's lead-capture note told a visitor to
// use "Request a follow-up" in the footer of that very page (#1809). It reads
// the one label now, and its invitation is what says a follow-up about what.
//
// The rendered pages are the subject. Reading the shipped HTML rather than the
// constants is the point: a constant nothing renders is not a label a visitor
// sees, and this suite exists because five of them had drifted apart in markup.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, textOf } from "./support/browser.js";
import { CONTACT_COPY, FOLLOW_UP_PRIVACY } from "../src/lead-capture.js";
import { INVITATION } from "../src/site-footer.js";

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
    // #finops-first-run-contact was the second copy of this ask. The answer
    // spine retired the region it sat in and the deletion took the control with
    // it; the two that remain are the form's own trigger and the result's.
    buttons: ["finops-contact-open", "finops-followup-cta"],
    forms: ["finops-contact-form"],
    context: ["finops-contact", "finops-result-followup"],
  },
  {
    page: "executive-briefing.html",
    what: "executive briefing",
    buttons: ["briefing-contact-open"],
    forms: ["briefing-contact-form"],
    context: ["briefing-contact"],
  },
];

const byId = (document, id) => document.getElementById(id);
const submitOf = (document, formId) => byId(document, formId)?.querySelector('button[type="submit"]');

// Words that named the same errand something else. A visitor reading two of
// these on two pages has no way to know they lead to the same inbox.
const COMPETING = [/walkthrough/i, /\bdiscuss/i, /\bconversation/i, /\bchat\b/i, /\bdemo\b/i];

// The copy that belongs to the errand, which on the footer is everything except
// the site's destination directory. That list describes the product's surfaces
// in the home page's words — a "shared demo feed", a "demo persona" — and those
// are names for what a visitor can go and look at, not names for the follow-up.
// Every sentence that does speak for the request stays subject to the rule.
const errandCopy = (region) => {
  const directory = region.querySelector(".site-footer-demos");
  const copy = textOf(region);
  return directory ? copy.replace(textOf(directory), "") : copy;
};

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

  // The briefing's in-sheet invitation is painted rather than shipped;
  // tests/follow-up-conversion.test.js pins its rendered label.
});

test("the footer's visible request control reads the one CTA label on every page", async () => {
  for (const file of FOOTER_PAGES) {
    const page = await loadPage(pageUrl(file));
    try {
      const { document } = page;
      // `assert.ok(x == null)` rather than `assert.equal(x, null)`: a failing
      // equal() deep-inspects the whole parsed page to build its diff and never
      // returns, so the regression this guards would hang CI instead of naming
      // itself. Same reason at the matching assertion in tests/site-footer.test.js.
      assert.ok(byId(document, "site-footer-open") == null, `${file}: footer must not gate the form behind a trigger`);
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
        const copy = errandCopy(region);
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
  // the button asks for, and the one thing that leaves the browser. Every
  // surface now says it in the same sentence — see tests/follow-up-privacy.test.js
  // for the identity check; here it only has to be present beside each control.
  for (const { page: file, what, context } of SURFACES) {
    const page = await loadPage(pageUrl(file));
    try {
      const copy = context.map((id) => textOf(byId(page.document, id))).join(" ");
      assert.ok(copy.includes(FOLLOW_UP_PRIVACY), `${what}: nothing beside the button says what is sent`);
      assert.match(copy, /follow-up/i, `${what}: nothing beside the button names what is being asked for`);
    } finally {
      page.restore();
    }
  }

  // The invitation outside the footer's panel is readable before the panel is
  // opened, and it is what names who a visitor would be talking to.
  assert.match(INVITATION, /Shiplog/);
});
