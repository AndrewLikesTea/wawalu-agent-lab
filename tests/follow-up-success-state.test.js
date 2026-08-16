// The third state of a follow-up form: it landed.
//
// Both panels had a pending state and a failure state, and a success that was
// one sentence in a live region above a form that still looked ready to send. A
// visitor who missed the sentence pressed the button again; a visitor who read
// it had no receipt naming the address they had typed.
//
// What is pinned here, on both surfaces that ship the form — the About Shiplog
// panel in the footer and the executive briefing's own copy of it:
//
//   1. The receipt names the address that was submitted, as text.
//   2. Success is terminal. The form is gone, the submit control is disabled and
//      out of the tab order, and pressing what is left sends nothing. Coming
//      back is a deliberate act with its own control.
//   3. Focus lands on the receipt, and the receipt is a live region announced
//      the way the failure is.
//   4. The failure state is untouched and reads nothing like the receipt.
//   5. The briefing's "run the same analysis on your own export" next step
//      survives the swap, because it is not part of what gets swapped.
//
// Both pages run for real — shipped markup, real page entry, only /api/leads
// stubbed. Nothing here trusts a harness double to reject anything: every claim
// is read back off the rendered DOM.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CONFIRMATION_DETAIL, REOPEN_LABEL } from "../src/follow-up-confirmation.js";
import { loadPage, pressEnter, tabSequence, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const BRIEFING_PAGE = new URL("../src/executive-briefing.html", import.meta.url);
const BRIEFING_FIXTURE_PATH = "/executive-finops-briefing-fixture.json";
const BRIEFING_FIXTURE = JSON.parse(
  await readFile(new URL("../src/executive-finops-briefing-fixture.json", import.meta.url), "utf8"));

// Deliberately long, and deliberately full of the characters a naive receipt
// would either break on or interpret.
const LONG_EMAIL = "finance.operations.director@a-very-long-company.example";
const MARKUP_EMAIL = "a<b>c@example.com";

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));

function interceptLeads(reply) {
  const passthrough = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    if (url !== "/api/leads") return passthrough(url, options);
    calls.push({ url, options });
    return reply(calls.length);
  };
  return calls;
}

const jsonReply = (body, status = 201) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

const failureReply = () => jsonReply({ error: { code: "storage_unavailable", message: "unavailable" } }, 503);

/** Type an address into a disclosed form and submit it from the keyboard. */
function submitEmail(document, prefix, value) {
  const field = byId(document, `${prefix}-email`);
  field.value = "";
  field.focus();
  typeText(document, value);
  pressEnter(document);
}

const settled = (document, prefix) => waitFor(
  () => ["success", "error"].includes(byId(document, `${prefix}-form`).dataset.state),
  "the submission to settle");

async function openFooterPage() {
  const page = await loadPage(new URL("../src/index.html", import.meta.url));
  await importPageModule("/site-footer-page.js");
  return page;
}

async function openNamedFooterPage(file) {
  const page = await loadPage(new URL(`../src/${file}`, import.meta.url));
  await importPageModule("/site-footer-page.js");
  return page;
}

async function openBriefingPage() {
  const page = await loadPage(BRIEFING_PAGE, { routes: { [BRIEFING_FIXTURE_PATH]: BRIEFING_FIXTURE } });
  await importPageModule("/executive-briefing-page.js");
  await waitFor(() => byId(page.document, "executive-briefing").getAttribute("aria-busy") === "false",
    "the briefing to finish painting");
  return page;
}

// The two surfaces, driven identically. The panels ship different copy and
// different class families; the state model behind them is one implementation,
// and this table is what says so.
//
// `gated` is the one place they differ, and it is stated rather than probed: the
// briefing still keeps its form behind a trigger, the footer renders the form on
// first paint. Probing for the trigger instead would let either surface quietly
// change shape — this harness models no layout, so a form left inside an
// unopened panel still takes a value and still submits.
const SURFACES = [
  { name: "the About Shiplog footer", open: openFooterPage, prefix: "site-footer", gated: false },
  { name: "the executive briefing", open: openBriefingPage, prefix: "briefing-contact", gated: true },
];

/** Get to a usable form, holding each surface to the shape it claims above. */
function reveal(document, { prefix, gated }) {
  const trigger = byId(document, `${prefix}-open`);
  if (!gated) return assert.ok(trigger == null, `${prefix}: the form must not be gated behind a trigger`);
  assert.ok(trigger, `${prefix}: the gated form must ship the trigger that opens it`);
  trigger.click();
}

test("Coach, Releases, Social, People, and Agents send one bounded request and show durable success", async () => {
  const pages = [
    ["coach.html", "follow_up_coach", "Paste a prompt"],
    ["releases.html", "follow_up_releases", "Deployment status"],
    ["social.html", "follow_up_social", "images optional"],
    ["profile.html", "follow_up_people", "image posts"],
    ["agents.html", "follow_up_agents", "Agent Observatory"],
  ];
  for (const [file, requestType, pageContent] of pages) {
    const page = await openNamedFooterPage(file);
    const calls = interceptLeads(() => jsonReply({ captured: true, created: true, purpose: requestType }, 201));
    try {
      submitEmail(page.document, "site-footer", LONG_EMAIL);
      await settled(page.document, "site-footer");

      assert.equal(calls.length, 1, `${file}: valid submission must be sent once`);
      const payload = JSON.parse(calls[0].options.body);
      assert.deepEqual(payload, { email: LONG_EMAIL, purpose: requestType }, `${file}: bounded payload`);
      assert.deepEqual(Object.keys(payload), ["email", "purpose"], `${file}: no third field can disclose content`);
      assert.doesNotMatch(calls[0].options.body, new RegExp(pageContent, "i"), `${file}: page content stays local`);
      assert.equal(byId(page.document, "site-footer-form").dataset.state, "success", `${file}: success state`);
      const confirmation = byId(page.document, "site-footer-confirmation");
      assert.ok(confirmation, `${file}: visible confirmation`);
      assert.equal(page.document.activeElement?.id, "site-footer-confirmation", `${file}: focus reaches confirmation`);
      assert.match(textOf(confirmation), /Your work email was sent to the Wawalu team/, `${file}: receipt names recipient`);
      assert.match(textOf(confirmation), /requested follow-up type is the only other information sent/, `${file}: receipt states disclosure`);
      assert.doesNotMatch(textOf(confirmation), new RegExp(pageContent, "i"), `${file}: receipt does not render page content`);
      assert.match(shownText(page.document, "site-footer-status"), /person replies by email/,
        `${file}: confirmation states the next step`);
    } finally {
      page.restore();
    }
  }
});

test("each reviewed page keeps empty and invalid email inline and sends nothing", async () => {
  for (const file of ["coach.html", "releases.html", "social.html", "profile.html", "agents.html"]) {
    const page = await openNamedFooterPage(file);
    const calls = interceptLeads(() => jsonReply({ captured: true, created: true }, 201));
    try {
      const field = byId(page.document, "site-footer-email");
      for (const [value, copy] of [
        ["", /Enter your work email/],
        ["rowan at example", /Enter a valid work email address/],
      ]) {
        submitEmail(page.document, "site-footer", value);
        assert.equal(calls.length, 0, `${file}: ${JSON.stringify(value)} must not be sent`);
        assert.equal(field.getAttribute("aria-invalid"), "true", `${file}: field exposes invalid state`);
        assert.match(shownText(page.document, "site-footer-error"), copy, `${file}: inline diagnostic`);
        assert.match(field.getAttribute("aria-describedby"), /site-footer-error/, `${file}: diagnostic is associated`);
        assert.equal(byId(page.document, "site-footer-confirmation"), null, `${file}: validation cannot look successful`);
      }
    } finally {
      page.restore();
    }
  }
});

for (const { name, open, prefix, gated } of SURFACES) {
  test(`${name} answers a landed request with a receipt naming the address`, async () => {
    const page = await open();
    const { document } = page;
    interceptLeads(() => jsonReply({ captured: true, created: true, purpose: "follow_up" }));
    try {
      reveal(document, { prefix, gated });
      assert.equal(byId(document, `${prefix}-confirmation`), null,
        "a receipt must not exist before a request lands");

      submitEmail(document, prefix, LONG_EMAIL);
      await settled(document, prefix);

      const receipt = byId(document, `${prefix}-confirmation`);
      assert.ok(receipt, "a landed request must leave a confirmation");
      assert.equal(receipt.hidden, false);
      // The address the visitor typed, in the receipt, as text.
      assert.match(textOf(receipt), new RegExp(LONG_EMAIL.replace(/[.]/g, "\\.")));
      assert.equal(textOf(receipt.querySelector(`.${receipt.className}-address`)), LONG_EMAIL);
      // Who answers, and roughly when — the response time the FinOps form
      // already states, hedged, because someone reads this queue and nobody has
      // promised the hour.
      assert.match(textOf(receipt), /A person from the Wawalu team will reply to that address by email, usually within two business days/);
      assert.match(textOf(receipt), /requested follow-up type is the only other information sent/);
      // And what stayed behind, named rather than left to be assumed: the
      // request carried one field, so the receipt says so out loud.
      assert.match(textOf(receipt), /no page content, prompt text, uploaded file, or browsing data went with it/);
      // The categories may be named; a value from the page may not. The address
      // line is the only place a page could leak into, so it is checked alone.
      const addressLine = textOf(receipt.querySelector(`.${receipt.className}-lead`));
      assert.doesNotMatch(addressLine, /\$/, "no figure from the page may appear in the receipt");
      assert.doesNotMatch(addressLine, /briefing|column|department/i);
    } finally {
      page.restore();
    }
  });

  test(`${name} cannot send twice: the receipt replaces the form`, async () => {
    const page = await open();
    const { document } = page;
    const calls = interceptLeads(() => jsonReply({ captured: true, created: true, purpose: "follow_up" }));
    try {
      reveal(document, { prefix, gated });
      const submit = byId(document, `${prefix}-form`).querySelector('button[type="submit"]');
      submitEmail(document, prefix, LONG_EMAIL);
      await settled(document, prefix);
      assert.equal(calls.length, 1);

      // Gone from the tab order, gone from the page a mouse can reach, and
      // inert if something presses it anyway.
      assert.equal(byId(document, `${prefix}-form`).hidden, true, "the form must not stay on screen");
      assert.equal(submit.disabled, true, "the submit control must not be pressable after a success");
      assert.ok(!tabSequence(document).includes(submit), "the submit control must leave the tab order");
      assert.ok(!tabSequence(document).includes(byId(document, `${prefix}-email`)),
        "the field must leave the tab order with the form it belongs to");
      submit.click();
      byId(document, `${prefix}-email`).focus();
      pressEnter(document);
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(calls.length, 1, "no click and no Enter may send a second request");

      // Asking again is deliberate, and it gives the form back with the cursor
      // in it and the outcome of the last request cleared.
      const again = byId(document, `${prefix}-again`);
      assert.equal(again.tagName, "BUTTON");
      assert.equal(textOf(again), REOPEN_LABEL);
      again.click();
      assert.equal(byId(document, `${prefix}-confirmation`), null, "the receipt goes when the form comes back");
      assert.equal(byId(document, `${prefix}-form`).hidden, false);
      assert.equal(document.activeElement?.id, `${prefix}-email`);
      assert.equal(submit.disabled, false);
      assert.equal(shownText(document, `${prefix}-status`), "");

      submitEmail(document, prefix, LONG_EMAIL);
      await settled(document, prefix);
      assert.equal(calls.length, 2, "a deliberately reopened form must still send");
    } finally {
      page.restore();
    }
  });

  test(`${name} moves focus to the receipt and announces it the way it announces a failure`, async () => {
    const page = await open();
    const { document } = page;
    interceptLeads(() => jsonReply({ captured: true, created: true, purpose: "follow_up" }));
    try {
      reveal(document, { prefix, gated });
      submitEmail(document, prefix, LONG_EMAIL);
      await settled(document, prefix);

      const receipt = byId(document, `${prefix}-confirmation`);
      assert.equal(document.activeElement, receipt,
        "focus must land on the confirmation, not on the body and not back in the form");
      assert.equal(receipt.getAttribute("tabindex"), "-1", "the receipt takes focus but is not a tab stop");
      assert.ok(!tabSequence(document).includes(receipt));

      // Announced the way the failure is: the same role and the same politeness
      // the status paragraph beside it has carried all along.
      const status = byId(document, `${prefix}-status`);
      assert.equal(receipt.getAttribute("role"), "status");
      assert.equal(receipt.getAttribute("aria-live"), "polite");
      assert.equal(status.getAttribute("role"), "status");
      assert.equal(status.getAttribute("aria-live"), "polite");

      // Focus order out of the receipt: the way back to the form first, then
      // whatever the panel offers after it.
      const stops = tabSequence(document);
      const again = byId(document, `${prefix}-again`);
      assert.ok(stops.includes(again), "the way back to the form must be reachable by Tab");
      const nextStep = byId(document, `${prefix}-next`);
      if (nextStep && !nextStep.hidden) {
        assert.ok(stops.indexOf(again) < stops.indexOf(nextStep.querySelector("a")),
          "the reopen control comes before the next step, not after it");
      }
    } finally {
      page.restore();
    }
  });

  test(`${name} keeps its failure state, and a failure leaves no receipt`, async () => {
    const page = await open();
    const { document } = page;
    interceptLeads(failureReply);
    try {
      reveal(document, { prefix, gated });
      submitEmail(document, prefix, LONG_EMAIL);
      await settled(document, prefix);

      assert.equal(byId(document, `${prefix}-form`).dataset.state, "error");
      assert.equal(byId(document, `${prefix}-confirmation`), null,
        "a failed request must never leave a confirmation behind");
      // The form is still there, still pressable: every failure here is
      // retryable in place.
      assert.equal(byId(document, `${prefix}-form`).hidden, false);
      assert.equal(byId(document, `${prefix}-form`).querySelector('button[type="submit"]').disabled, false);

      // The recovery paragraph is exactly the sentence it has always been, and
      // it reads nothing like a receipt.
      const recovery = byId(document, `${prefix}-recovery`);
      assert.equal(recovery.hidden, false);
      assert.match(textOf(recovery), /Your email address is still in the field/);
      assert.doesNotMatch(textOf(recovery), new RegExp(CONFIRMATION_DETAIL.slice(0, 40)));
      assert.doesNotMatch(shownText(document, `${prefix}-status`), /Your work email was sent to the Wawalu team/);
    } finally {
      page.restore();
    }
  });

  test(`${name} renders a typed address as text, never as markup`, async () => {
    const page = await open();
    const { document } = page;
    interceptLeads(() => jsonReply({ captured: true, created: true, purpose: "follow_up" }));
    try {
      reveal(document, { prefix, gated });
      submitEmail(document, prefix, MARKUP_EMAIL);
      await settled(document, prefix);

      const receipt = byId(document, `${prefix}-confirmation`);
      assert.match(textOf(receipt), /a<b>c@example\.com/, "the address arrives verbatim, as text");
      assert.equal(receipt.querySelectorAll("b").length, 0, "nothing a visitor types may become a node");
    } finally {
      page.restore();
    }
  });
}

test("the briefing's next step survives the swap and stays operable beside the receipt", async () => {
  const page = await openBriefingPage();
  const { document } = page;
  interceptLeads(() => jsonReply({ captured: true, created: true, purpose: "follow_up" }));
  try {
    byId(document, "briefing-contact-open").click();
    submitEmail(document, "briefing-contact", LONG_EMAIL);
    await settled(document, "briefing-contact");

    // The one thing a visitor can do while the reply is written is still there:
    // it is a sibling of the form, not part of it, so the swap cannot take it.
    const next = byId(document, "briefing-contact-next");
    assert.equal(next.hidden, false, "the next step must survive a successful submission");
    assert.match(textOf(next), /run the same analysis on your own export/);
    const link = next.querySelector("a");
    assert.equal(link.getAttribute("href"), "/evolution.html");
    assert.ok(tabSequence(document).includes(link), "the next step must stay keyboard reachable");

    // And so is the receipt, in the same panel, above it.
    assert.ok(byId(document, "briefing-contact-confirmation"));
    // The briefing itself is untouched by all of this.
    assert.ok(document.querySelector(".brief-figure"), "the briefing must survive the submission");
  } finally {
    page.restore();
  }
});

test("the receipt is styled apart from the failure box, and a long address wraps at any width", async () => {
  const sheets = {
    "site-footer": await readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    "brief-contact": await readFile(new URL("../src/executive-briefing.css", import.meta.url), "utf8"),
    "finops-contact": await readFile(new URL("../src/evolution.css", import.meta.url), "utf8"),
  };
  for (const [base, css] of Object.entries(sheets)) {
    // Read whitespace-free: these sheets are written in two house styles and the
    // rule, not the spacing, is what this test is about.
    const compact = css.replace(/\s+/g, "");
    // A card of its own, not the failure box borrowed: the error rule and the
    // confirmation rule must not resolve to the same treatment.
    const rule = compact.match(new RegExp(`\\.${base}-confirmation\\{([^}]*)\\}`))?.[1] ?? "";
    assert.match(rule, /background/, `${base}: the receipt needs a container treatment of its own`);
    assert.doesNotMatch(rule, /error|#8a2b2b|#b4453a|#d9b7b7/,
      `${base}: the receipt must not borrow the failure box's palette`);
    // The one string a visitor supplied is the one that can be long.
    assert.match(compact, new RegExp(`\\.${base}-confirmation-address\\{[^}]*overflow-wrap:anywhere`),
      `${base}: a long address must wrap rather than push the card wider than the panel`);
    // Full-width control on a phone, like every other control in these panels.
    assert.match(compact, new RegExp(`\\.${base}-confirmation-again\\{width:100%;?\\}`),
      `${base}: the way back to the form must be a full-width target at narrow widths`);
  }
});
