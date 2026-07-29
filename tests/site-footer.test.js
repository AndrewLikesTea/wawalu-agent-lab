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
import { IDENTITY, PRIVACY, PURPOSE, siteFooterMarkup } from "../src/site-footer.js";
import { loadPage, pressEnter, pressKey, pressTab, tabSequence, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

// Every page of the site. Kept in the same order and to the same rule as
// tests/site-nav.test.js: if a page carries the site navigation it is a page of
// the site, and a page of the site carries the footer.
const PAGES = [
  "index.html", "decision.html", "workspace.html", "social.html", "post.html", "profile.html", "releases.html",
  "release.html", "evolution.html", "coach.html", "savings-action-center.html", "savings-commitment.html",
  "agents.html", "agent-trace.html",
];

const pageUrl = (file) => new URL(`../src/${file}`, import.meta.url);
const read = (file) => readFile(pageUrl(file), "utf8");

const TYPED_EMAIL = "director@example.com";

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));
const describedBy = (document) => byId(document, "site-footer-email").getAttribute("aria-describedby");

/* ------------------------------- the markup ------------------------------- */

test("every page of the site renders the footer, byte for byte from src/site-footer.js", async () => {
  for (const file of PAGES) {
    const html = await read(file);
    assert.ok(
      html.includes(siteFooterMarkup()),
      `${file} footer markup has drifted from src/site-footer.js`,
    );
    // One footer, not two, and the behaviour that drives it is wired in.
    assert.equal((html.match(/<footer/g) ?? []).length, 1, `${file} renders more than one footer`);
    assert.match(html, /<script type="module" src="\/site-footer-page\.js"><\/script>/, `${file} never loads the footer entry`);
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
    const note = textOf(byId(document, "site-footer-note"));
    assert.match(note, /^Submitting requests a follow-up conversation about Shiplog\./,
      "the purpose comes before the note about what is sent");
    assert.ok(note.includes(PRIVACY), "the purpose must not have displaced the privacy claim");
    assert.equal(note, `${PURPOSE} ${PRIVACY}`);

    // The control the visitor presses says the same thing the note does.
    const submit = byId(document, "site-footer-panel").querySelector('button[type="submit"]');
    assert.equal(textOf(submit), "Request a follow-up");

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
    assert.equal(textOf(trigger), "Talk to us about Shiplog");
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
  const calls = interceptLeads((call) => jsonReply({ subscribed: call === 1 }, call === 1 ? 201 : 200));
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
    assert.deepEqual(JSON.parse(options.body), { email: TYPED_EMAIL });
    assert.deepEqual(Object.keys(JSON.parse(options.body)), ["email"]);

    assert.equal(byId(document, "site-footer-form").dataset.state, "success");
    const confirmation = shownText(document, "site-footer-status");
    assert.match(confirmation, /^Follow-up requested — we sent your email address, and nothing else\./);
    assert.match(confirmation, /recorded for the Wawalu team/, "the confirmation must say what happens next");
    // Nothing promised that this demo does not do.
    assert.doesNotMatch(confirmation, /business days?|within \d|hours?\b/i);
    // The live region announces it rather than leaving it to the eye alone.
    assert.equal(byId(document, "site-footer-status").getAttribute("aria-live"), "polite");
    assert.equal(byId(document, "site-footer-status").getAttribute("role"), "status");

    // A repeat submission is still a success, and still claims nothing more.
    submitEmail(document, TYPED_EMAIL);
    await waitFor(() => shownText(document, "site-footer-status").startsWith("That address is already"),
      "the already-recorded confirmation");
    assert.equal(calls.length, 2);
  } finally {
    page.restore();
  }
});

test("the privacy sentence beside the field is what the request body actually does", async () => {
  const page = await openFooterPage("evolution.html");
  const { document } = page;
  const calls = interceptLeads(() => jsonReply({ subscribed: true }));
  try {
    assert.equal(shownText(document, "site-footer-note"), `${PURPOSE} ${PRIVACY}`);
    assert.match(PRIVACY, /sends one thing: the work email address you type/);

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
  const calls = interceptLeads(() => jsonReply({ subscribed: true }));
  try {
    byId(document, "site-footer-open").click();
    const field = byId(document, "site-footer-email");

    submitEmail(document, "");
    assert.equal(calls.length, 0, "an empty address must not reach the network");
    assert.equal(shownText(document, "site-footer-error"), "Enter your work email to request a follow-up conversation.");
    assert.equal(byId(document, "site-footer-error").hidden, false);
    assert.equal(field.getAttribute("aria-invalid"), "true");
    assert.match(describedBy(document), /site-footer-error/,
      "the diagnostic must be associated with the input, not merely near it");
    assert.equal(document.activeElement, field, "focus must stay on the field the visitor has to fix");
    // A validation failure is not a submission failure: no recovery copy.
    assert.equal(byId(document, "site-footer-recovery").hidden, true);

    submitEmail(document, "director at example");
    assert.equal(calls.length, 0, "a malformed address must not reach the network");
    assert.equal(shownText(document, "site-footer-error"), "Enter a valid work email address to request a follow-up conversation.");
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
    : jsonReply({ subscribed: true })));
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
    assert.match(textOf(byId(document, "site-footer-recovery")), /still in the field above, so you can request a follow-up again/);
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
    assert.deepEqual(JSON.parse(calls[1].options.body), { email: TYPED_EMAIL });
    assert.match(shownText(document, "site-footer-status"), /^Follow-up requested — we sent your email address, and nothing else\./);
  } finally {
    page.restore();
  }
});

test("the pending state is announced, not merely spun", async () => {
  const page = await openFooterPage("index.html");
  const { document } = page;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  interceptLeads(async () => { await pending; return jsonReply({ subscribed: true }); });
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
    assert.equal(submit.disabled, false);
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
    ]) assert.ok(css.includes(`${selector} {`), `${file} must style ${selector}`);

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
  for (const selector of [".site-footer", ".site-footer-inner", ".site-footer-panel", ".site-footer-trigger"]) {
    const rule = (css) => css.match(new RegExp(`^\\${selector} \\{([^}]*)\\}`, "m"))[1];
    assert.equal(rule(observatory), rule(base), `${selector} has drifted between styles.css and agents.css`);
  }
});
