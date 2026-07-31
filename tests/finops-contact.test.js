// The contact affordance beside the AI FinOps result.
//
// Same level as tests/finops-import-e2e.test.js: the shipped markup from
// src/evolution.html, booted by the real page entry, with nothing between the
// visitor and the form stubbed except the network — which is the subject here,
// because the claim printed next to this form is about what leaves the browser.
//
// Four things are pinned, in the order they would hurt if they broke:
//
//   1. The request body. It must be the typed address and nothing else. The
//      assertion is made against the outgoing body of a page that is, at that
//      moment, displaying a real import's figures, file names, and department —
//      so a leak would have something to leak.
//   2. The result is never displaced. Every figure on screen before the form
//      opens is still on screen while it is open, after it succeeds, and after
//      it fails.
//   3. Keyboard operation. Reach the trigger by Tab, open with Enter, land in
//      the form, leave with Escape, and get focus back where it started.
//   4. Nothing about failure exists until a submission has failed.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, pressEnter, pressKey, pressTab, tabSequence, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

// The same worked example the import suite drives, respelled so the provider
// export and the roster actually join: this suite needs a result with real
// figures, file names, and a department on screen.
const EXAMPLE_EXPORTS = new URL("../contracts/integrations/tabular-dialects/v1/fixtures/", import.meta.url);
const PROVIDER_EXPORT = await readFile(new URL("openai-usage-export.csv", EXAMPLE_EXPORTS), "utf8");
const ORG_ROSTER = await readFile(new URL("generic-hris-roster.csv", EXAMPLE_EXPORTS), "utf8");
const JOINABLE_EXPORT = PROVIDER_EXPORT
  .replace(/atlas-platform/g, "Atlas Platform")
  .replace(/boreal-support/g, "Boreal Support");

const PROVIDER_FILE = "openai-usage-export.csv";
const ROSTER_FILE = "generic-hris-roster.csv";

const TYPED_EMAIL = "director@example.com";

/**
 * Everything about the leader's own import that must never appear in a request
 * body: the two file names, the department labels their roster spells out, the
 * project labels their provider export spells out, the money, and the period.
 */
const IMPORT_SECRETS = Object.freeze([
  PROVIDER_FILE, ROSTER_FILE,
  "Atlas Platform", "Boreal Support", "Cinder Research", "atlas-platform", "cinder-research",
  "546.20", "444.15", "412.75", "31.40", "102.05",
  "2026-06-05", "2026-06-07",
]);

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));
const describedBy = (document) => byId(document, "finops-contact-email").getAttribute("aria-describedby");

async function openFinopsTab() {
  const page = await loadPage(PAGE, {
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  // Every asynchronous surface the page starts on load is waited out here, so
  // none of them is still running when a test restores the globals.
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  await waitFor(() => shownText(document, "integration-contract-provenance").startsWith("Gateway completed"),
    "the static contract gateway to settle");
  await waitFor(() => byId(document, "finops-evaluation-result").getAttribute("aria-busy") === "false",
    "the evaluation panel to settle");
  return page;
}

/**
 * Take over POST /api/leads and record exactly what the page hands the network.
 * Every other request keeps going to the page's own fixture router, so nothing
 * else about the tab changes.
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
  assert.fail(`"${id}" is not reachable by Tab; a keyboard user cannot use the contact form.`);
}

/** Type an address into the disclosed form and submit it from the keyboard. */
function submitEmail(document, value) {
  const field = byId(document, "finops-contact-email");
  field.value = "";
  field.focus();
  typeText(document, value);
  pressEnter(document);
}

const settled = (document) => waitFor(
  () => ["success", "error"].includes(byId(document, "finops-contact-form").dataset.state),
  "the contact submission to settle");

function chooseFiles(document, files) {
  const input = byId(document, "local-finops-files");
  input.files = files.map(({ name, text }) => ({ name, type: "text/csv", text: async () => text }));
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

/** Drive the shipped import all the way to a decision brief with real figures. */
async function completeImport(document) {
  chooseFiles(document, [
    { name: PROVIDER_FILE, text: JOINABLE_EXPORT },
    { name: ROSTER_FILE, text: ORG_ROSTER },
  ]);
  await waitFor(() => !byId(document, "import-mapping").hidden
    && shownText(document, "import-mapping-file") === PROVIDER_FILE, "the mapping step for the export");
  byId(document, "import-mapping-confirm").click();
  await waitFor(() => shownText(document, "import-mapping-file") === ROSTER_FILE, "the mapping step for the roster");
  byId(document, "import-mapping-confirm").click();
  await waitFor(() => !byId(document, "local-results").hidden, "the decision brief to appear");
}

/**
 * Every number and label the result region is showing, read straight out of the
 * DOM. Comparing two of these is how "the result was not displaced" is checked:
 * it fails on a hidden section, an unmounted node, or a changed figure alike.
 */
function resultSnapshot(document) {
  const results = byId(document, "local-results");
  return {
    onScreen: !results.hidden && Boolean(results.parentNode),
    coverage: shownText(document, "local-trust-coverage"),
    inputs: shownText(document, "local-trust-inputs"),
    recoverable: shownText(document, "local-recoverable"),
    department: shownText(document, "local-department"),
    metric: shownText(document, "local-lead-metric"),
    provenance: shownText(document, "dataset-provenance-results"),
  };
}

// ---------------------------------------------------------------------------

test("at first paint the contact action is present, keyboard-reachable, and says nothing about failure", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    // A result is on screen from the moment the tab loads, and so is the way to
    // ask about it.
    assert.notEqual(shownText(document, "kpi-spend-value"), "–");
    const trigger = byId(document, "finops-contact-open");
    assert.equal(trigger.tagName, "BUTTON", "the contact action must be a real button, not a clickable div");
    assert.equal(trigger.getAttribute("type"), "button");
    assert.equal(textOf(trigger), "Request a follow-up");
    assert.ok(tabSequence(document).includes(trigger), "the contact action must be in the tab order");

    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(trigger.getAttribute("aria-controls"), "finops-contact-panel");
    assert.equal(byId(document, "finops-contact-panel").hidden, true);
    assert.ok(!tabSequence(document).includes(byId(document, "finops-contact-email")),
      "a collapsed form must contribute no tab stops");

    // Nothing about a failure, an error, or a recovery exists yet — neither
    // rendered nor named in the field's accessible description.
    assert.equal(byId(document, "finops-contact-recovery").hidden, true);
    assert.equal(byId(document, "finops-contact-error").hidden, true);
    assert.equal(shownText(document, "finops-contact-status"), "");
    assert.equal(byId(document, "finops-contact-form").dataset.state, undefined);
    assert.equal(describedBy(document), "finops-contact-note");
    assert.equal(byId(document, "finops-contact-email").getAttribute("aria-invalid"), null);
  } finally {
    page.restore();
  }
});

test("the form opens on the keyboard, takes focus, and hands it back on dismissal", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    const trigger = tabTo(document, "finops-contact-open");
    pressEnter(document);
    assert.equal(byId(document, "finops-contact-panel").hidden, false);
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.equal(document.activeElement?.id, "finops-contact-email",
      "opening a disclosed form must move focus into it, not leave it on the trigger");

    // The form's own controls follow the trigger in the sequence.
    const ids = tabSequence(document).map((node) => node.id);
    const order = ["finops-contact-open", "finops-contact-email", "finops-contact-dismiss"];
    const positions = order.map((id) => ids.indexOf(id));
    for (const [index, position] of positions.entries())
      assert.ok(position >= 0, `${order[index]} must be keyboard reachable while the form is open`);
    assert.deepEqual([...positions].sort((left, right) => left - right), positions,
      "the disclosed form must follow its trigger in the tab order");

    pressKey(document, "Escape");
    assert.equal(byId(document, "finops-contact-panel").hidden, true);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, trigger,
      "dismissing must return focus to the control that opened the form");

    // The explicit Close button is the same contract as Escape.
    pressEnter(document);
    assert.equal(byId(document, "finops-contact-panel").hidden, false);
    tabTo(document, "finops-contact-dismiss");
    pressEnter(document);
    assert.equal(byId(document, "finops-contact-panel").hidden, true);
    assert.equal(document.activeElement, trigger);
  } finally {
    page.restore();
  }
});

test("the request body carries the typed address and nothing from the leader's import", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  const calls = interceptLeads(() => jsonReply({ subscribed: true }));
  try {
    await completeImport(document);

    // The page is now displaying every value the assertion below forbids. If it
    // were not, the test could pass on a page with nothing to leak.
    const onScreen = textOf(byId(document, "local-results")) + textOf(byId(document, "dataset-provenance-results"));
    for (const secret of [PROVIDER_FILE, ROSTER_FILE, "546.20", "444.15"])
      assert.ok(onScreen.includes(secret), `the result must be showing "${secret}" for this test to mean anything`);

    byId(document, "finops-contact-open").click();
    submitEmail(document, TYPED_EMAIL);
    await settled(document);

    assert.equal(calls.length, 1, "one submission must produce exactly one request");
    const [{ url, options }] = calls;
    assert.equal(url, "/api/leads");
    assert.equal(options.method, "POST");

    // The body is the whole claim: one key, the typed value, nothing else.
    assert.deepEqual(JSON.parse(options.body), { email: TYPED_EMAIL });
    assert.deepEqual(Object.keys(JSON.parse(options.body)), ["email"]);

    // And nothing derived from the import reached the wire by any other route —
    // headers, query string, or a field added later.
    const transmitted = `${url} ${JSON.stringify(options.headers)} ${options.body}`;
    for (const secret of IMPORT_SECRETS) {
      assert.ok(!transmitted.includes(secret),
        `"${secret}" came from the leader's file and must never be in the request: ${transmitted}`);
    }
    // The opaque department id the brief renders is import-derived too.
    const department = shownText(document, "local-department");
    assert.ok(!transmitted.includes(department.replace("Department ", "")),
      "the department identifier on screen must not be in the request");

    // The visible claim beside the form says exactly this, in words.
    const note = shownText(document, "finops-contact-note");
    assert.match(note, /sends one thing: the work email address you type/);
    assert.match(note, /No figure, file name, column value, or department name from your import/);
  } finally {
    page.restore();
  }
});

test("the imported result stays on screen while the form opens, succeeds, fails, and closes", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  let failNext = false;
  interceptLeads(() => (failNext
    ? jsonReply({ error: { code: "storage_unavailable", message: "unavailable" } }, 503)
    : jsonReply({ subscribed: true })));
  try {
    await completeImport(document);
    const before = resultSnapshot(document);
    assert.equal(before.onScreen, true);
    assert.equal(before.coverage, "81.3%", "the fixture's coverage must be on screen before the form opens");

    byId(document, "finops-contact-open").click();
    assert.deepEqual(resultSnapshot(document), before, "opening the form must not disturb the result");

    submitEmail(document, TYPED_EMAIL);
    await settled(document);
    assert.equal(byId(document, "finops-contact-form").dataset.state, "success");
    assert.deepEqual(resultSnapshot(document), before, "a successful submission must not unmount the analysis");

    failNext = true;
    submitEmail(document, TYPED_EMAIL);
    await settled(document);
    assert.equal(byId(document, "finops-contact-form").dataset.state, "error");
    assert.deepEqual(resultSnapshot(document), before, "a failed submission must not remove or overwrite the result");

    byId(document, "finops-contact-dismiss").click();
    assert.deepEqual(resultSnapshot(document), before, "dismissing the form must not disturb the result");
  } finally {
    page.restore();
  }
});

test("the bundled example brief is equally undisturbed, and the confirmation says what happens next", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  interceptLeads((call) => jsonReply({ subscribed: call === 1 }, call === 1 ? 201 : 200));
  try {
    // The other result a visitor can reach: the bundled example analysis, run
    // through the same translator and rendered into the same region.
    byId(document, "try-example-dataset").click();
    await waitFor(() => !byId(document, "local-results").hidden, "the example decision brief to appear");
    const before = resultSnapshot(document);
    assert.equal(before.onScreen, true);

    byId(document, "finops-contact-open").click();
    submitEmail(document, TYPED_EMAIL);
    await settled(document);

    // The first words name the request that succeeded, not merely that
    // something was sent: this sentence is announced on its own, out of the
    // context of the button that produced it.
    const confirmation = shownText(document, "finops-contact-status");
    assert.match(confirmation, /^Follow-up requested — we sent your email address, and nothing else\./);
    assert.match(confirmation, /within two business days/, "the confirmation must say roughly when");
    assert.deepEqual(resultSnapshot(document), before,
      "the example brief must survive the submission exactly as the imported one does");

    // A repeat submission is still a success, and still claims nothing more.
    submitEmail(document, TYPED_EMAIL);
    await waitFor(() => shownText(document, "finops-contact-status").includes("already on our list"),
      "the already-captured confirmation");
    assert.match(shownText(document, "finops-contact-status"), /^Follow-up requested — that address is already on our list/);
    assert.match(shownText(document, "finops-contact-status"), /within two business days/);
    assert.deepEqual(resultSnapshot(document), before);

    // The example result's own labelling is exactly what it was.
    assert.equal(shownText(document, "local-metric-label"), "Bundled synthetic example");
    assert.match(shownText(document, "local-metric-detail"), /^Computed from an invented provider export/);
  } finally {
    page.restore();
  }
});

test("an empty or malformed address is diagnosed at the field, and keeps what was typed", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  const calls = interceptLeads(() => jsonReply({ subscribed: true }));
  try {
    byId(document, "finops-contact-open").click();
    const field = byId(document, "finops-contact-email");

    submitEmail(document, "");
    assert.equal(calls.length, 0, "an empty address must not reach the network");
    assert.equal(shownText(document, "finops-contact-error"), "Enter your work email to request a Shiplog follow-up.");
    assert.equal(byId(document, "finops-contact-error").hidden, false);
    assert.equal(field.getAttribute("aria-invalid"), "true");
    assert.match(describedBy(document), /finops-contact-error/,
      "the diagnostic must be associated with the input, not merely near it");
    assert.equal(document.activeElement, field, "focus must be on the field the visitor has to fix");
    // A validation failure is not a submission failure: no recovery copy.
    assert.equal(byId(document, "finops-contact-recovery").hidden, true);

    submitEmail(document, "director at example");
    assert.equal(calls.length, 0, "a malformed address must not reach the network");
    assert.equal(shownText(document, "finops-contact-error"), "Enter a valid work email address to request a Shiplog follow-up.");
    assert.equal(field.value, "director at example", "the field must keep what the visitor typed");

    // Editing retracts the diagnostic and its association.
    field.focus();
    typeText(document, "x");
    assert.equal(byId(document, "finops-contact-error").hidden, true);
    assert.equal(describedBy(document), "finops-contact-note");
    assert.equal(field.getAttribute("aria-invalid"), null);
  } finally {
    page.restore();
  }
});

test("a failed submission shows recovery copy for the first time and keeps the address in the field", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  interceptLeads(() => jsonReply({ error: { code: "storage_unavailable", message: "unreviewed upstream text" } }, 503));
  try {
    byId(document, "finops-contact-open").click();
    const recovery = byId(document, "finops-contact-recovery");
    assert.equal(recovery.hidden, true, "recovery copy must not exist before an attempt");
    assert.doesNotMatch(describedBy(document), /finops-contact-recovery/);

    submitEmail(document, TYPED_EMAIL);
    await settled(document);

    assert.equal(recovery.hidden, false);
    assert.match(describedBy(document), /finops-contact-recovery/);
    assert.match(textOf(recovery), /Your email address is still in the field/);
    assert.match(textOf(recovery), /the briefing above is unchanged/);
    assert.equal(byId(document, "finops-contact-email").value, TYPED_EMAIL,
      "a failed submission must not clear the address the visitor typed");
    // Copy this repository owns — never the string the response supplied.
    assert.equal(shownText(document, "finops-contact-status"),
      "We didn’t get your request because follow-up requests are temporarily offline.");
    assert.doesNotMatch(shownText(document, "finops-contact-status"), /unreviewed upstream text/);
    // The control is usable again.
    assert.equal(byId(document, "finops-contact-panel").querySelector('button[type="submit"]').disabled, false);
  } finally {
    page.restore();
  }
});

test("the contact copy claims nothing the page has not shown, and leaves the existing labelling alone", async () => {
  const html = await readFile(PAGE, "utf8");
  const page = await openFinopsTab();
  const { document } = page;
  try {
    const copy = textOf(byId(document, "finops-contact"));
    for (const claim of [
      /customers?\b/i, /\bclients?\b/i, /trusted by/i, /realized/i, /\bsavings?\b/i,
      /\bROI\b/i, /teams like yours/i, /\d+\s*%/, /\$\s*\d/,
    ]) assert.doesNotMatch(copy, claim, `the contact copy must not make this claim: ${claim}`);

    // The two labels this change is forbidden to touch, character for character.
    assert.match(html, /<strong>Bundled synthetic example<\/strong>\s*<span>This is an illustrative recommendation—not live analysis, customer data, or realized savings\.<\/span>/);
    assert.match(html, /<strong>Your files do not leave this tab\.<\/strong>/);
    assert.match(html, /Bundled synthetic example — invented data, not your spend\. Analyze your own export to replace it with your figures\./);

    // And the contact section is placed beside the result region, not inside it:
    // nothing in it can be unmounted by a re-render of the analysis.
    assert.equal(byId(document, "finops-contact").closest("#local-results"), null);
    const order = ["local-results", "finops-contact"].map((id) => html.indexOf(`id="${id}"`));
    assert.ok(order[0] < order[1] && order[0] >= 0,
      "the contact section must follow the result region in the document");
  } finally {
    page.restore();
  }
});
