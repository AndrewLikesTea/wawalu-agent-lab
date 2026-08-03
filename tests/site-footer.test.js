// One footer, on every page, with one way to reach a person.
//
// Two halves, for two different failure modes:
//
//   1. Table-driven markup, the same discipline tests/site-nav.test.js applies
//      to the navigation. A page that carries a site nav must render exactly
//      what src/site-footer.js produces, and a new page cannot ship a footer of
//      its own invention or quietly ship none at all.
//   2. Behaviour, driven through tests/support/browser.js and the shipped page
//      entry — the same level as tests/finops-contact.test.js, and using that
//      suite's mocking pattern exactly: POST /api/leads is taken over, every
//      other request keeps going to the page's own fixture router, and nothing
//      in here can reach a network.
//
// The claim the copy makes ("this form sends one thing") is asserted against the
// outgoing request body, not against the sentence, for the same reason it is
// there: the sentence is only true because `postLeadEmail` builds the whole body
// from one argument.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DEMOS, FOLLOW_UP_REDIRECT, IDENTITY, INVITATION, siteFooterMarkup } from "../src/site-footer.js";
import { FOLLOW_UP_PRIVACY } from "../src/lead-capture.js";
import { SITE_NAV } from "../src/site-nav.js";
import { loadPage, pressEnter, pressKey, pressTab, tabSequence, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

// Every page of the site. Kept in the same order and to the same rule as
// tests/site-nav.test.js: if a page carries the site navigation it is a page of
// the site, and a page of the site carries the footer.
const PAGES = [
  "index.html", "decision.html", "workspace.html", "social.html", "post.html", "profile.html", "releases.html",
  "release.html", "evolution.html", "coach.html", "personal-history.html", "savings-action-center.html", "savings-commitment.html",
  "executive-briefing.html",
  "agents.html", "agent-trace.html",
];

const pageUrl = (file) => new URL(`../src/${file}`, import.meta.url);
const read = (file) => readFile(pageUrl(file), "utf8");

const TYPED_EMAIL = "director@example.com";

// The recovery paragraph, in the order a person needs it: what happened, what to
// do, then what is still safe. Pinned whole rather than by fragment — the order
// of the three sentences is the point, and a substring match would not see it.
const RECOVERY_COPY = "We could not send your follow-up request. Try again in a few minutes. "
  + "Your email address is still in the field above, and nothing else on this page changed.";

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));
const describedBy = (document) => byId(document, "site-footer-email").getAttribute("aria-describedby");

/* ------------------------------- the markup ------------------------------- */

// The pages whose footer points at a follow-up form of their own instead of
// carrying the generic one. Kept here rather than inferred from the page, so a
// page cannot quietly drop the contact affordance: dropping it is a decision
// this table has to record, and src/site-footer.js has to offer copy for.
const FOOTER_VARIANT = new Map([
  ["executive-briefing.html", { redirect: FOLLOW_UP_REDIRECT.briefing }],
]);

test("every page of the site renders the footer, byte for byte from src/site-footer.js", async () => {
  for (const file of PAGES) {
    const html = await read(file);
    assert.ok(
      html.includes(siteFooterMarkup("    ", FOOTER_VARIANT.get(file))),
      `${file} footer markup has drifted from src/site-footer.js`,
    );
    // One footer, not two, and the behaviour that drives it is wired in.
    assert.equal((html.match(/<footer/g) ?? []).length, 1, `${file} renders more than one footer`);
    assert.match(html, /<script type="module" src="\/site-footer-page\.js"><\/script>/, `${file} never loads the footer entry`);
  }
});

test("a page with its own follow-up form ships one work-email form, and its footer points at it", async () => {
  // The executive briefing ends on a decision, and its own form arrives attached
  // to it. A second generic form on the same screen would ask a reader who has
  // just decided something to choose between two identical fields.
  const html = await read("executive-briefing.html");
  const page = await loadPage(pageUrl("executive-briefing.html"));
  const { document } = page;
  try {
    assert.equal(byId(document, "site-footer-form"), null, "the briefing page ships a second contact form");
    assert.equal(byId(document, "site-footer-open"), null, "the briefing page ships a second contact disclosure");
    assert.equal(document.querySelectorAll('input[type="email"]').length, 1,
      "exactly one work-email field on the page a reader decides from");
    assert.ok(byId(document, "briefing-contact-form"), "the briefing's own form must be the one that stays");

    // The footer still names who runs Shiplog, and still offers a route to a
    // person — as a real link, so it works with no script at all.
    assert.match(textOf(byId(document, "site-footer")), /Wawalu/);
    const link = document.querySelector(".site-footer-redirect-link");
    assert.equal(link.tagName, "A");
    assert.equal(link.getAttribute("href"), "#briefing-contact");
    assert.ok(tabSequence(document).includes(link), "the footer must stay keyboard reachable");
    assert.ok(byId(document, "briefing-contact"), "the footer points at a section that exists");

    // The link is the whole pointer. It used to be preceded by a paragraph
    // explaining that the page carries its own form and which of the two to
    // use; a clear label does that job, and the paragraph must not come back.
    assert.equal(textOf(link), "Request a follow-up", "the pointer carries the site's one follow-up label");
    assert.equal(document.querySelector(".site-footer-redirect"), null,
      "the About block must explain the link with the link, not with a paragraph");
    assert.doesNotMatch(textOf(byId(document, "site-footer")), /carries its own follow-up form/);

    // And every other page keeps the generic form: this is one page's exception,
    // not a site-wide removal.
    for (const other of PAGES.filter((file) => !FOOTER_VARIANT.has(file))) {
      assert.match(await read(other), /id="site-footer-form"/, `${other} lost its contact form`);
    }
    assert.doesNotMatch(html, /id="site-footer-form"/);
  } finally {
    page.restore();
  }
});

test("every page that carries a site nav is covered by the table", async () => {
  const listed = new Set(PAGES);
  const files = (await readdir(new URL("../src/", import.meta.url), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => entry.name);

  for (const file of files) {
    const html = await read(file);
    if (!html.includes('class="site-nav"')) continue;
    assert.ok(listed.has(file), `${file} is a page of the site but is missing from PAGES`);
  }
});

test("the footer is a contentinfo landmark with an accessible name, after the content in document order", async () => {
  // A detail page and a list page, so this is not asserted on one layout. Every
  // page now uses the .page-wrapped frame — issue 378 converted the last of the
  // bare-<main> ones — and the footer stays outside it, scoped to the document.
  for (const file of ["index.html", "post.html", "social.html", "agents.html"]) {
    const html = await read(file);
    const page = await loadPage(pageUrl(file));
    const { document } = page;
    try {
      const footers = document.querySelectorAll("footer");
      assert.equal(footers.length, 1, `${file}: exactly one contentinfo landmark`);
      const [footer] = footers;

      // A <footer> is only a contentinfo landmark when it is scoped to the
      // document rather than nested in an article or a section.
      assert.equal(footer.parentNode.tagName, "BODY", `${file}: the footer must be scoped to the document`);

      const name = footer.getAttribute("aria-labelledby");
      assert.ok(name, `${file}: the landmark needs an accessible name`);
      assert.equal(textOf(byId(document, name)), "About Shiplog", `${file}: the name must be a real heading`);

      // After the content region, in the document — not merely painted below it.
      assert.ok(html.indexOf("</main>") < html.indexOf('<footer class="site-footer"'), `${file}: the footer precedes the content`);
      // And nothing in it borrows tab order: no positive tabindex anywhere.
      for (const node of footer.querySelectorAll("a,button,input,select,textarea")) {
        const tabindex = node.getAttribute("tabindex");
        assert.ok(tabindex === null || Number(tabindex) <= 0, `${file}: ${node.id} carries tabindex="${tabindex}"`);
      }
    } finally {
      page.restore();
    }
  }
});

test("the footer says what a visitor can do here before it says what Shiplog is", async () => {
  // The band used to open by defining Shiplog as a decision and release log,
  // which is not what this site leads with: the home page's title, heading, and
  // first call to action are all AI FinOps. A visitor who reads only this block
  // has to come away knowing what they can do, not just what to call it.
  const page = await loadPage(pageUrl("index.html"));
  const { document } = page;
  try {
    const identity = textOf(document.querySelector(".site-footer-identity"));
    const [opening] = identity.split(". ");
    assert.match(opening, /^On this site you can /, "the first sentence must name what a visitor can do");
    assert.ok(!opening.includes("Shiplog is"), "the definition must not be the opening sentence");
    // The three things it promises are the three things the demo list points at.
    for (const verb of ["analyze your own AI spend", "check a prompt", "decisions and releases"])
      assert.ok(identity.includes(verb), `the opening must name "${verb}"`);
  } finally {
    page.restore();
  }
});

test("the footer is a site map: every destination the navigation offers, each one a link", async () => {
  const page = await loadPage(pageUrl("index.html"));
  const { document } = page;
  try {
    const list = document.querySelector(".site-footer-demos");
    assert.equal(list.tagName, "UL", "the destinations must be a real list, so a screen reader gets the count");
    const items = [...list.querySelectorAll("li")];
    assert.equal(items.length, DEMOS.length, "one row per destination");

    // Every door the navigation offers, named exactly once. This band is the
    // only directory on the pages whose body carries none, so a surface missing
    // here is a surface a visitor has to guess at.
    const navLabels = SITE_NAV.map((link) => link.label);
    const sorted = (labels) => [...labels].sort();
    assert.deepEqual(sorted(DEMOS.map((demo) => demo.label)), sorted(navLabels),
      "the band must name each navigation destination exactly once, by the name the navigation uses");

    // One door per name. src/site-footer.js repeats the hrefs rather than
    // importing src/site-nav.js — that file is 6 KB and this module is in every
    // page's initial payload — so the two tables are compared here instead,
    // where it costs a visitor nothing.
    for (const demo of DEMOS) {
      const destination = SITE_NAV.find((link) => link.label === demo.label);
      assert.equal(demo.href, destination.href,
        `the footer sends "${demo.label}" somewhere the navigation does not`);
      // Root-relative, the convention every cross-page link in src/site-nav.js
      // uses: this band ships on every page, and a bare relative path would
      // resolve against a page in a subdirectory instead of against the site.
      assert.ok(demo.href.startsWith("/"), `"${demo.label}" must resolve from any page depth`);
    }

    // Every row is a link, and every link is reachable from the keyboard: a
    // name a reader cannot follow is a name they have to go and find in the
    // header for themselves.
    const stops = tabSequence(document);
    assert.equal(list.querySelectorAll("a").length, DEMOS.length, "every destination must be followable");
    for (const [index, demo] of DEMOS.entries()) {
      const link = items[index].querySelector("a");
      assert.equal(textOf(link), demo.label, `${demo.label} must be the linked text, and named first in its row`);
      assert.equal(link.getAttribute("href"), demo.href);
      assert.ok(stops.includes(link), `${demo.label} must be keyboard reachable`);
    }
    assert.match(textOf(items[0]), /start here/i, "the list must say where to start");
    assert.match(textOf(items[0]), /^AI FinOps/, "the site leads with AI FinOps, so the list does too");

    // A site map, not an essay. Each row is a fragment of at most eight words
    // after the destination's name — the marker on the first row is the order
    // signal, not purpose copy, so it is counted separately.
    for (const demo of DEMOS) {
      const words = demo.purpose.split(/\s+/);
      assert.ok(words.length <= 8, `"${demo.label}" runs to ${words.length} words of purpose`);
      assert.doesNotMatch(demo.purpose, /[.!?]$/, `"${demo.label}" is written as a sentence`);
      assert.doesNotMatch(demo.purpose, /powerful|seamless|unlock|leverage|central hub/i, `"${demo.label}" uses filler`);
    }

    // The defect this replaces: every row used to be word for word the sentence
    // the home page's "Where everything is" list gives that surface, so the home
    // page printed the same eight sentences twice and every other page carried
    // an essay. One name per concept is still the rule above; one wording per
    // concept was the mistake. No row may say what a guide row says.
    const guideRows = [...document.querySelector(".site-guide").querySelectorAll("li")];
    for (const demo of DEMOS) {
      const guide = guideRows.find((row) => row.querySelector(`a[href="${demo.href}"]`));
      assert.ok(guide, `the home page's directory is missing ${demo.label}`);
      const sentence = textOf(guide).slice(demo.label.length).trim();
      assert.ok(!textOf(items.find((row) => textOf(row).startsWith(demo.label))).includes(sentence),
        `${demo.label} repeats the home page's sentence in the footer`);
    }

    // And it is the same list on every page, including the one whose footer
    // swaps the contact form for a pointer.
    for (const file of PAGES) {
      const html = await read(file);
      for (const demo of DEMOS) {
        assert.ok(html.includes(`<a href="${demo.href}">${demo.label}</a> — `), `${file} is missing "${demo.label}"`);
      }
      assert.ok(html.includes('<li><a href="/evolution.html">AI FinOps</a>'), `${file} is missing the way in`);
    }

    // Neither surface may sell the analysis without saying where it happens.
    // The AI FinOps row is a fragment now, but this clause is a promise about
    // where a visitor's export is read, so it survives the trim on both.
    const guideRow = guideRows.find((row) => row.querySelector('a[href="/evolution.html"]'));
    for (const row of [items[0], guideRow])
      assert.match(textOf(row), /provider export in this browser tab/,
        "the AI FinOps destination must preserve its local-analysis disclosure");
    // The home page's own row still names the action; the footer points, and
    // the page it points at does the promising.
    assert.match(textOf(guideRow), /where to act first on your AI spend/,
      "the home page's directory must name the action AI FinOps gives a visitor");
  } finally {
    page.restore();
  }
});

test("the footer says who runs Shiplog and where, and claims nothing it cannot show", async () => {
  const page = await loadPage(pageUrl("index.html"));
  const { document } = page;
  try {
    const identity = shownText(document, "site-footer");
    assert.match(identity, /Wawalu/, "the footer must name the organisation that operates Shiplog");
    assert.match(identity, /labs\.wawalu\.org/, "the footer must name where this is hosted");
    assert.match(identity, /demonstration/, "the footer must say this is a demonstration product");
    assert.equal(textOf(document.querySelector(".site-footer-identity")), IDENTITY);

    // The proof-point gap is a different piece of work. This band invents none
    // of it: no customer, no usage, no funding, no result, no number at all.
    for (const claim of [
      /customers?\b/i, /\bclients?\b/i, /trusted by/i, /\bfunding\b/i, /\brevenue\b/i,
      /teams like yours/i, /\d+\s*%/, /\$\s*\d/, /\b\d[\d,]{2,}\b/,
    ]) assert.doesNotMatch(identity, claim, `the footer must not make this claim: ${claim}`);
  } finally {
    page.restore();
  }
});

test("the footer form says what submitting asks for, on the page that carries both work-email forms", async () => {
  const page = await loadPage(pageUrl("index.html"));
  const { document } = page;
  try {
    // One sentence between the field and the button — the site's, not this
    // footer's. Pinned whole: a substring match would pass on any prose.
    const note = textOf(byId(document, "site-footer-note"));
    assert.equal(note, FOLLOW_UP_PRIVACY);
    // It names what is sent, who receives it, and that nothing else goes.
    assert.match(note, /work email address you type here/);
    assert.match(note, /Wawalu team that operates Shiplog/);
    assert.match(note, /nothing else on this page is sent/);

    // The control the visitor presses says the same thing the note does.
    const submit = byId(document, "site-footer-panel").querySelector('button[type="submit"]');
    assert.equal(textOf(submit), "Request a follow-up");

    // The button carries no page-specific qualification, so the line outside the
    // panel is what says a follow-up about what — and it is readable before the
    // visitor opens anything.
    assert.equal(textOf(document.querySelector(".site-footer-invitation")), INVITATION);
    assert.match(INVITATION, /Shiplog/);

    // And nothing in this form reads as the field-note sign-up a few sections up.
    const footer = textOf(byId(document, "site-footer"));
    assert.doesNotMatch(footer, /field note|subscrib/i,
      "the contact form must never describe itself as a subscription");
  } finally {
    page.restore();
  }
});

/* ------------------------------ the behaviour ----------------------------- */

/**
 * Stand up a page with its footer wired the way the browser wires it. The two
 * files driven below are the home page and a detail page; neither needs a
 * fixture route, because the footer is the only module imported.
 */
async function openFooterPage(file) {
  const page = await loadPage(pageUrl(file));
  await importPageModule("/site-footer-page.js");
  return page;
}

/**
 * Take over POST /api/leads and record exactly what the page hands the network.
 * Lifted from tests/finops-contact.test.js so both forms are pinned the same way.
 */
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

/** Tab from wherever focus is until a control is reached; no mouse involved. */
function tabTo(document, id) {
  const stops = tabSequence(document).length;
  for (let step = 0; step <= stops; step += 1) {
    const focused = pressTab(document);
    if (focused?.id === id) return focused;
  }
  assert.fail(`"${id}" is not reachable by Tab; a keyboard user cannot use the footer.`);
}

/** Type an address into the disclosed form and submit it from the keyboard. */
function submitEmail(document, value) {
  const field = byId(document, "site-footer-email");
  field.value = "";
  field.focus();
  typeText(document, value);
  pressEnter(document);
}

const settled = (document) => waitFor(
  () => ["success", "error"].includes(byId(document, "site-footer-form").dataset.state),
  "the footer submission to settle");

test("the footer's contact action is collapsed at first paint and says nothing about failure", async () => {
  const page = await openFooterPage("index.html");
  const { document } = page;
  try {
    const trigger = byId(document, "site-footer-open");
    assert.equal(trigger.tagName, "BUTTON", "the action must be a real button, not a clickable div");
    assert.equal(trigger.getAttribute("type"), "button");
    assert.equal(textOf(trigger), "Request a follow-up");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(trigger.getAttribute("aria-controls"), "site-footer-panel");
    assert.equal(byId(document, "site-footer-panel").hidden, true);
    assert.ok(!tabSequence(document).includes(byId(document, "site-footer-email")),
      "a collapsed form must contribute no tab stops");

    assert.equal(byId(document, "site-footer-error").hidden, true);
    assert.equal(byId(document, "site-footer-recovery").hidden, true);
    assert.equal(shownText(document, "site-footer-status"), "");
    assert.equal(byId(document, "site-footer-form").dataset.state, undefined);
    assert.equal(describedBy(document), "site-footer-note");
    assert.equal(byId(document, "site-footer-email").getAttribute("aria-invalid"), null);
  } finally {
    page.restore();
  }
});

test("the button toggles the form on the keyboard, takes focus, and hands it back", async () => {
  // Driven on a detail page, where the reveal has the least room and the most to
  // get wrong: the page's own content is short and the footer is close behind it.
  const page = await openFooterPage("post.html");
  const { document } = page;
  try {
    const trigger = tabTo(document, "site-footer-open");
    pressEnter(document);
    assert.equal(byId(document, "site-footer-panel").hidden, false);
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.equal(document.activeElement?.id, "site-footer-email",
      "opening a disclosed form must move focus into it, not leave it on the trigger");

    // The form's own controls follow the trigger in the sequence.
    const ids = tabSequence(document).map((node) => node.id);
    const order = ["site-footer-open", "site-footer-email", "site-footer-dismiss"];
    const positions = order.map((id) => ids.indexOf(id));
    for (const [index, position] of positions.entries())
      assert.ok(position >= 0, `${order[index]} must be keyboard reachable while the form is open`);
    assert.deepEqual([...positions].sort((left, right) => left - right), positions,
      "the disclosed form must follow its trigger in the tab order");

    // Toggling closed is the button's own job, and focus comes back to it.
    trigger.focus();
    pressEnter(document);
    assert.equal(byId(document, "site-footer-panel").hidden, true);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, trigger);

    // Escape and the explicit Close button are the same contract.
    pressEnter(document);
    assert.equal(byId(document, "site-footer-panel").hidden, false);
    pressKey(document, "Escape");
    assert.equal(byId(document, "site-footer-panel").hidden, true);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, trigger);

    pressEnter(document);
    tabTo(document, "site-footer-dismiss");
    pressEnter(document);
    assert.equal(byId(document, "site-footer-panel").hidden, true);
    assert.equal(document.activeElement, trigger);
  } finally {
    page.restore();
  }
});

test("a submission goes through the shared capture path, and the confirmation says what happens next", async () => {
  const page = await openFooterPage("index.html");
  const { document } = page;
  const calls = interceptLeads((call) => jsonReply({ captured: true, created: call === 1, purpose: "follow_up" }, call === 1 ? 201 : 200));
  try {
    byId(document, "site-footer-open").click();
    submitEmail(document, TYPED_EMAIL);
    await settled(document);

    // The shared path is /api/leads with a body built from one argument. That is
    // the whole of `postLeadEmail`, and the whole of the claim beside the field.
    assert.equal(calls.length, 1, "one submission must produce exactly one request");
    const [{ url, options }] = calls;
    assert.equal(url, "/api/leads");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { email: TYPED_EMAIL, purpose: "follow_up" });
    assert.deepEqual(Object.keys(JSON.parse(options.body)), ["email", "purpose"]);

    assert.equal(byId(document, "site-footer-form").dataset.state, "success");
    const confirmation = shownText(document, "site-footer-status");
    assert.match(confirmation, /^Follow-up requested — we sent your email address, and nothing else\./);
    assert.match(confirmation, /recorded for the Wawalu team/, "the confirmation must say what happens next");
    // Nothing promised that this demo does not do.
    assert.doesNotMatch(confirmation, /business days?|within \d|hours?\b/i);
    // The live region announces it rather than leaving it to the eye alone.
    assert.equal(byId(document, "site-footer-status").getAttribute("aria-live"), "polite");
    assert.equal(byId(document, "site-footer-status").getAttribute("role"), "status");

    // A repeat submission is still a success, and still claims nothing more —
    // but it has to be asked for: the landed request took the form away.
    byId(document, "site-footer-again").click();
    submitEmail(document, TYPED_EMAIL);
    // It opens on the same three words as the first confirmation: the live
    // region announces this sentence alone, out of the context of the button
    // that was pressed, so it has to name which request succeeded.
    await waitFor(
      () => shownText(document, "site-footer-status")
        .startsWith("Follow-up requested — that address is already on our list"),
      "the already-recorded confirmation");
    assert.equal(calls.length, 2);
  } finally {
    page.restore();
  }
});

test("the privacy sentence beside the field is what the request body actually does", async () => {
  const page = await openFooterPage("evolution.html");
  const { document } = page;
  const calls = interceptLeads(() => jsonReply({ captured: true, created: true, purpose: "follow_up" }));
  try {
    assert.equal(shownText(document, "site-footer-note"), FOLLOW_UP_PRIVACY);

    byId(document, "site-footer-open").click();
    submitEmail(document, TYPED_EMAIL);
    await settled(document);

    // The AI FinOps tab is the page with the most on it to leak. Nothing from
    // the page reaches the wire by any route — body, headers, or query string.
    const [{ url, options }] = calls;
    const transmitted = `${url} ${JSON.stringify(options.headers)} ${options.body}`;
    for (const secret of ["evolution", "savings", "7,430", "5,200", "760", "baseline"]) {
      assert.ok(!transmitted.includes(secret), `"${secret}" is page state and must never be in the request`);
    }
  } finally {
    page.restore();
  }
});

test("an obviously invalid address is diagnosed at the field and never reaches the network", async () => {
  const page = await openFooterPage("index.html");
  const { document } = page;
  const calls = interceptLeads(() => jsonReply({ captured: true, created: true, purpose: "follow_up" }));
  try {
    byId(document, "site-footer-open").click();
    const field = byId(document, "site-footer-email");

    submitEmail(document, "");
    assert.equal(calls.length, 0, "an empty address must not reach the network");
    assert.equal(shownText(document, "site-footer-error"), "Enter your work email to request a Shiplog follow-up.");
    assert.equal(byId(document, "site-footer-error").hidden, false);
    assert.equal(field.getAttribute("aria-invalid"), "true");
    assert.match(describedBy(document), /site-footer-error/,
      "the diagnostic must be associated with the input, not merely near it");
    assert.equal(document.activeElement, field, "focus must stay on the field the visitor has to fix");
    // A validation failure is not a submission failure: no recovery copy.
    assert.equal(byId(document, "site-footer-recovery").hidden, true);

    submitEmail(document, "director at example");
    assert.equal(calls.length, 0, "a malformed address must not reach the network");
    assert.equal(shownText(document, "site-footer-error"), "Enter a valid work email address to request a Shiplog follow-up.");
    assert.equal(field.value, "director at example", "the field must keep what the visitor typed");

    // Editing retracts the diagnostic and its association.
    field.focus();
    typeText(document, "x");
    assert.equal(byId(document, "site-footer-error").hidden, true);
    assert.equal(describedBy(document), "site-footer-note");
    assert.equal(field.getAttribute("aria-invalid"), null);
  } finally {
    page.restore();
  }
});

test("a failed submission keeps the typed address, says it can be retried, and the retry works", async () => {
  const page = await openFooterPage("post.html");
  const { document } = page;
  let failNext = true;
  const calls = interceptLeads(() => (failNext
    ? jsonReply({ error: { code: "storage_unavailable", message: "unreviewed upstream text" } }, 503)
    : jsonReply({ captured: true, created: true, purpose: "follow_up" })));
  try {
    byId(document, "site-footer-open").click();
    const field = byId(document, "site-footer-email");
    const submit = byId(document, "site-footer-panel").querySelector('button[type="submit"]');
    assert.equal(byId(document, "site-footer-recovery").hidden, true, "recovery copy must not exist before an attempt");
    assert.doesNotMatch(describedBy(document), /site-footer-recovery/);

    submitEmail(document, TYPED_EMAIL);
    await settled(document);

    assert.equal(byId(document, "site-footer-form").dataset.state, "error");
    assert.equal(field.value, TYPED_EMAIL, "a failed submission must not clear the address the visitor typed");
    assert.equal(byId(document, "site-footer-recovery").hidden, false);
    assert.match(describedBy(document), /site-footer-recovery/);
    assert.equal(textOf(byId(document, "site-footer-recovery")), RECOVERY_COPY);
    // Copy this repository owns — never the string the response supplied.
    assert.equal(shownText(document, "site-footer-status"),
      "We didn’t get your request because follow-up requests are temporarily offline.");
    assert.doesNotMatch(shownText(document, "site-footer-status"), /unreviewed upstream text/);
    // The control is usable again, without a reload.
    assert.equal(submit.disabled, false);
    assert.equal(submit.getAttribute("aria-disabled"), null);

    // The second attempt: the same panel, the same value, no page reload.
    failNext = false;
    field.focus();
    pressEnter(document);
    await waitFor(() => byId(document, "site-footer-form").dataset.state === "success",
      "the retry to succeed");
    assert.equal(calls.length, 2, "the retry must make its own request");
    assert.deepEqual(JSON.parse(calls[1].options.body), { email: TYPED_EMAIL, purpose: "follow_up" });
    assert.match(shownText(document, "site-footer-status"), /^Follow-up requested — we sent your email address, and nothing else\./);
  } finally {
    page.restore();
  }
});

// The paragraph ships in the markup of every page, so this checks it where a
// visitor actually meets it: two pages, driven to failure through the shipped
// entry rather than read out of the source string.
for (const file of ["agents.html", "decision.html"]) {
  test(`${file} leads its failure state with what happened, not with the reassurance`, async () => {
    const page = await openFooterPage(file);
    const { document } = page;
    interceptLeads(() => { throw new TypeError("network error"); });
    try {
      byId(document, "site-footer-open").click();
      submitEmail(document, TYPED_EMAIL);
      await settled(document);

      assert.equal(byId(document, "site-footer-form").dataset.state, "error");
      assert.equal(byId(document, "site-footer-recovery").hidden, false);
      assert.equal(shownText(document, "site-footer-recovery"), RECOVERY_COPY);
      assert.ok(shownText(document, "site-footer-recovery").startsWith("We could not send your follow-up request."),
        "the outcome sentence must be the first thing read");
    } finally {
      page.restore();
    }
  });
}

test("the pending state is announced, not merely spun", async () => {
  const page = await openFooterPage("index.html");
  const { document } = page;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  interceptLeads(async () => { await pending; return jsonReply({ captured: true, created: true, purpose: "follow_up" }); });
  try {
    byId(document, "site-footer-open").click();
    submitEmail(document, TYPED_EMAIL);
    await waitFor(() => byId(document, "site-footer-form").dataset.state === "submitting", "the pending state");

    const submit = byId(document, "site-footer-panel").querySelector('button[type="submit"]');
    assert.equal(submit.disabled, true, "the submit control must be unusable while a request is in flight");
    assert.equal(submit.getAttribute("aria-disabled"), "true");
    assert.equal(shownText(document, "site-footer-status"), "Requesting a follow-up — sending your email address…",
      "the pending state must be in the live region, not only in the button");

    release();
    await settled(document);
    // The request landed, so the control does not come back with it: the receipt
    // has taken the form's place, and a second send has to be asked for.
    assert.equal(submit.disabled, true, "a landed request must leave nothing to press again");
    assert.equal(byId(document, "site-footer-form").hidden, true);
    byId(document, "site-footer-again").click();
    assert.equal(submit.disabled, false, "reopening the form must give the control back");
  } finally {
    page.restore();
  }
});

/* -------------------------------- the band -------------------------------- */

test("both stylesheets that the site's pages load style the footer, and agree about the band", async () => {
  // agents.html and agent-trace.html load agents.css alone; the other nine load
  // styles.css. A rule present in one and absent from the other ships an
  // unstyled band on two pages, which is exactly how this went wrong before.
  const sheets = await Promise.all(["styles.css", "agents.css"]
    .map(async (file) => [file, await readFile(new URL(`../src/${file}`, import.meta.url), "utf8")]));

  for (const [file, css] of sheets) {
    for (const selector of [
      ".site-footer", ".site-footer-inner", ".site-footer-trigger", ".site-footer-panel",
      ".site-footer-actions button", ".site-footer-status", ".site-footer-recovery",
      ".site-footer-demos", ".site-footer-demos a",
    ]) assert.ok(css.includes(`${selector} {`), `${file} must style ${selector}`);

    // The band's link is keyboard-visible on every page that ships it. This rule
    // covered buttons and inputs alone in agents.css, which was survivable while
    // nothing in the band was a link on those two pages.
    assert.match(css, /\.site-footer a:focus-visible \{/, `${file}: the footer's link has no focus ring`);

    // A collapsed panel is collapsed, not merely transparent.
    assert.match(css, /\.site-footer-panel\[hidden\] \{ display:none; \}/, `${file}: the hidden panel must not occupy the band`);

    // Tap targets. 44px is the floor for the trigger, the two actions, and the
    // field a thumb has to hit on a phone.
    for (const rule of [
      /\.site-footer-trigger \{ min-height:44px;/,
      /\.site-footer-actions button \{ min-height:44px;/,
      /\.site-footer-field input \{ min-height:4[6-9]px;/,
    ]) assert.match(css, rule, `${file}: ${rule} — a tap target is under 44px`);

    // No horizontal overflow at a narrow viewport: the band keeps the page's own
    // gutter rather than a fixed width, and the field may shrink inside its grid.
    assert.match(css, /\.site-footer-inner \{[^}]*width:min\(1180px,calc\(100% - 40px\)\)/, `${file}: the band must not be fixed-width`);
    assert.match(css, /@media\(max-width:520px\) \{ \.site-footer-inner\{width:calc\(100% - 24px\)/, `${file}: no narrow-viewport rule for the band`);
    assert.match(css, /\.site-footer-field input \{[^}]*min-width:0/, `${file}: the field can overflow its grid column`);

    // The disclosure animates only for a visitor who has not asked it not to.
    assert.match(css, /@media\(prefers-reduced-motion:reduce\) \{[\s\S]*?\.site-footer-panel\{animation:none\}/,
      `${file}: the reveal must be silenced under prefers-reduced-motion`);
  }

  // And the band itself is one design, not two: the shared declarations are
  // identical in both files.
  const [[, base], [, observatory]] = sheets;
  for (const selector of [".site-footer", ".site-footer-inner", ".site-footer-panel", ".site-footer-trigger", ".site-footer-demos"]) {
    const rule = (css) => css.match(new RegExp(`^\\${selector} \\{([^}]*)\\}`, "m"))[1];
    assert.equal(rule(observatory), rule(base), `${selector} has drifted between styles.css and agents.css`);
  }
});
