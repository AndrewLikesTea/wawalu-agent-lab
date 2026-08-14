// The import-first Evolution flow, proved against the shipped page (#1726).
//
// This file exists for the four claims the suite could not already make. The
// happy path, the mapping wizard, the two announcement regions, the drop/browse
// equivalence and the reload-and-recover path are all covered elsewhere
// (tests/finops-import-e2e.test.js, tests/finops-import-drop.test.js,
// tests/finops-analysis-entry.test.js) and are deliberately not repeated here.
// What is new:
//
//   1. The consolidated trust disclosure (#1728) seen through the real page
//      rather than through `renderImportTrustEvidence` called by hand. Its own
//      unit test parses evolution.html off disk and paints the view directly, so
//      nothing yet proves that a cold visitor never meets it, that a rejected
//      file never earns one, and that a real local analysis is what produces it.
//   2. Recovery inside one tab. The existing rejection tests all end at the
//      refusal or reload the page; none of them chooses a good file next, which
//      is what a reader actually does.
//   3. The in-flight state produced by a real import. The existing reading-state
//      test calls `renderImportReading` by hand, so it cannot see whether the
//      page's own handler marks the result region busy while a file is read.
//   4. The no-selection case: a change event carrying no file must move nothing.
//
// Harness notes, because they shape every assertion below:
//   * `finops-track-record.js` reorders `<main>` on load, so nothing here reads
//     authored source order — every assertion is on the post-load DOM.
//   * Nothing is compared against an element (`assert.equal(node, null)` walks
//     the whole parsed page); visibility is the ancestor walk in `visible`.
//   * A closed disclosure is asserted with `!node.open`, never `=== false`, and
//     `textOf` reads straight through one, so text alone proves nothing about
//     whether a reader can see it.
//   * The harness models no viewport, so the narrow-layout requirement is
//     asserted as the stylesheet rule that produces it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(await readFile(
  new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));
const STYLES = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const EVOLUTION_CSS = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");

// The three-fixture matrix, all read from the shipped contract fixtures so the
// bytes under test are the bytes the contract publishes.
const NATIVE = new URL("../contracts/integrations/native-provider-exports/v1/fixtures/",
  import.meta.url);
/** Valid: a supported native provider export that reaches analysis. */
const VALID_EXPORT = await readFile(new URL("openai-supported.csv", NATIVE), "utf8");
/** Structurally incomplete: the right shape, missing a required column. */
const INCOMPLETE_EXPORT = await readFile(new URL("anthropic-missing-required.csv", NATIVE), "utf8");
/** Unsupported format: what a console that only hands out archives gives you. */
const UNSUPPORTED_FORMAT = Object.freeze({
  name: "provider-export.zip", type: "application/zip", text: "PK not a reader",
});

async function openFinopsTab() {
  const page = await loadPage(PAGE, {
    storage: {},
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  // All three settle waits. Stopping at `ready` leaves a paint in flight that
  // passes locally and surfaces in CI as an unhandled rejection in the next test.
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  await waitFor(() => textOf(document.getElementById("integration-contract-provenance"))
    .startsWith("Gateway completed"), "the static contract gateway to settle");
  await waitFor(() => document.getElementById("finops-evaluation-result")
    .getAttribute("aria-busy") === "false", "the evaluation panel to settle");
  return page;
}

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));

/** On screen, not merely present: `hidden` anywhere above takes a node away. */
function visible(node) {
  if (!node) return false;
  for (let up = node; up && up.nodeType === 1; up = up.parentNode) if (up.hidden) return false;
  return true;
}

/** Hand the shipped control a selection, in the shape the page reads. */
function chooseFiles(document, files) {
  const input = byId(document, "local-finops-files");
  input.files = files.map(({ name, text, type = "text/csv" }) => ({
    name, type, text: typeof text === "function" ? text : async () => text,
  }));
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

/** Tab from wherever focus is until a control is reached; no mouse involved. */
function tabTo(document, id) {
  const stops = tabSequence(document).length;
  for (let step = 0; step <= stops; step += 1) {
    const focused = pressTab(document);
    if (focused?.id === id) return focused;
  }
  return assert.fail(`"${id}" is not reachable by Tab; a keyboard user cannot start the import. `
    + `Tab stops: ${stops}.`);
}

const analysisRendered = (document) => waitFor(() => !byId(document, "local-results").hidden,
  "the local analysis result to render");
const refused = (document) => waitFor(
  () => byId(document, "local-export-activation").dataset.state === "error",
  "the refusal to render beside the file chooser");

// ---------------------------------------------------------------------------
// Cold open
// ---------------------------------------------------------------------------

test("a cold visitor can reach the file choice and meets no pre-import trust gate", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    // The real control, in the real tab order — not only the activation button
    // that delegates to it. A page that can only be started through a proxy is
    // one refactor away from having no import at all.
    const input = byId(document, "local-finops-files");
    assert.equal(tabSequence(document).includes(input), true,
      "the file control itself must be a tab stop, not reachable only through a proxy button");
    assert.equal(visible(input), true);
    assert.equal(visible(byId(document, "local-finops-files-label")
      ?? byId(document, "local-file-help")), true,
    "the instruction the control is described by must be on screen beside it");

    // The three regions a cold visitor must not meet: no result, no consolidated
    // trust evidence, and no superseded pre-result evidence gate (#1728 moved
    // that evidence behind the real analysis; this proves the booted page agrees
    // with the module test that asserts it on the authored file).
    assert.equal(byId(document, "local-results").hidden, true);
    assert.equal(visible(byId(document, "local-trust-evidence")), false,
      "consolidated trust evidence must not exist before an analysis produced it");
    assert.equal(visible(byId(document, "own-data-evidence-preflight")), false,
      "the superseded pre-result evidence gate must stay retired on the booted page");

    // Competing pre-import gate headings: absent (off screen) or secondary. The
    // claim is on level and count, never on visual prominence.
    const gateHeadings = ["own-data-preflight-question", "local-results-title"]
      .map((id) => byId(document, id));
    for (const heading of gateHeadings) {
      assert.equal(heading.tagName, "H3",
        `${heading.id} must stay a third-level heading, subordinate to the page's answer`);
      assert.equal(visible(heading), false,
        `${heading.id} must not compete with the import ask before there is anything behind it`);
    }
    // And exactly one "how far to trust this" control in the document, hidden.
    const trustSummaries = document.querySelectorAll("summary")
      .filter((node) => /How far to trust this result/.test(textOf(node)));
    assert.equal(trustSummaries.length, 1, "two trust disclosures would be two verdicts");
    assert.equal(visible(trustSummaries[0]), false);

    // The one visible next step above the picker still asks for a file.
    assert.equal(byId(document, "local-export-activation").dataset.state, "idle");
    assert.equal(textOf(byId(document, "activate-local-export")), "Choose a provider export");
  } finally {
    page.restore();
  }
});

test("the file control carries a stylesheet focus ring and a narrow-layout rule", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    const input = byId(document, "local-finops-files");
    // The affordance is the stylesheet rule, not the synthetic focus event: a
    // page can move focus perfectly and still paint nothing a reader can see.
    assert.match(STYLES,
      /(^|[,\s{}])input:focus-visible[^{]*\{[^}]*outline:3px solid var\(--focus-ring\)/m,
      "an <input> must earn a visible outline on keyboard focus");
    assert.doesNotMatch(EVOLUTION_CSS, /#local-finops-files[^{]*:focus[^{]*\{[^}]*outline\s*:\s*(?:none|0)/,
      "the import control must not opt out of the global focus ring");
    assert.equal(input.getAttribute("tabindex"), null,
      "the control must keep its native tab stop rather than a scripted one");

    // Focus does land there too — through the keyboard, from the activation
    // button a cold visitor meets first.
    tabTo(document, "activate-local-export");
    pressEnter(document);
    assert.equal(document.activeElement?.id, "local-finops-files");

    // The harness models no layout and no module on this page reads matchMedia
    // or innerWidth, so a viewport shim would assert only itself. The narrow
    // layout is therefore asserted where it is actually decided: the rule that
    // stacks the import and result headings below 640px.
    assert.match(EVOLUTION_CSS,
      /@media\(max-width:640px\)[\s\S]{0,4000}?\.local-import-heading,\.local-import-controls,\.local-result-heading \{[^}]*flex-direction:column/,
      "the import and result headings must stack rather than overflow on a narrow screen");
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// The fixture matrix: valid, unsupported format, structurally incomplete
// ---------------------------------------------------------------------------

test("a valid provider export renders the result and only then its trust evidence", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    assert.equal(visible(byId(document, "local-trust-evidence")), false);

    chooseFiles(document, [{ name: "openai-supported.csv", text: VALID_EXPORT }]);
    await analysisRendered(document);

    const results = byId(document, "local-results");
    assert.equal(results.hidden, false);
    assert.equal(results.getAttribute("aria-busy"), "false",
      "a rendered result must not still claim to be loading");
    assert.equal(results.dataset.dataset, "user");

    const trust = byId(document, "local-trust-evidence");
    assert.equal(visible(trust), true,
      "a successful local analysis must carry its consolidated trust evidence");
    // Consolidated: the five facts in one place, behind one native disclosure,
    // shut on arrival so the result stays the thing a reader reads first.
    assert.equal(!trust.open, true, "the trust disclosure must arrive shut");
    assert.equal(byId(document, "local-trust-evidence-summary").getAttribute("aria-expanded"),
      "false");
    assert.equal(byId(document, "local-trust-evidence-facts").children.length, 5,
      "one line per evidence fact: readiness, recognition, mapping, compatibility, provenance");
    assert.notEqual(shownText(document, "local-trust-evidence-verdict"), "",
      "the disclosure must state a verdict, not open onto an empty heading");
    assert.notEqual(shownText(document, "local-trust-evidence-action"), "");
    // And the retired gate stays retired once there is a real result to attach
    // evidence to — which is the whole point of moving it (#1728).
    assert.equal(visible(byId(document, "own-data-evidence-preflight")), false);
  } finally {
    page.restore();
  }
});

test("an unsupported format is refused with no result and no trust evidence", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    chooseFiles(document, [UNSUPPORTED_FORMAT]);
    await refused(document);

    assert.equal(byId(document, "local-results").hidden, true,
      "a refused file must not leave a result region open");
    assert.equal(visible(byId(document, "local-trust-evidence")), false,
      "a file that produced no analysis must not produce evidence about one");
    assert.equal(byId(document, "local-finops-files").getAttribute("aria-invalid"), "true");
    assert.equal(byId(document, "local-file-error").hidden, false,
      "the refusal must be bound to the control that read the file");
    assert.match(shownText(document, "local-file-error"), /archive/i);
    // Recovery is offered where the refusal is, not only in a live region.
    assert.match(shownText(document, "local-file-error"), /choose the CSV/i);
    assert.equal(visible(byId(document, "local-file-recovery")), true,
      "a refused reader must be shown the way back without hunting for it");
  } finally {
    page.restore();
  }
});

test("a structurally incomplete export names its missing column and earns no evidence", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    chooseFiles(document, [{ name: "anthropic-missing-required.csv", text: INCOMPLETE_EXPORT }]);
    await refused(document);

    assert.equal(byId(document, "local-results").hidden, true);
    assert.equal(visible(byId(document, "local-trust-evidence")), false,
      "a partial read must not be dressed as a partial result");
    assert.equal(byId(document, "import-mapping").hidden, true,
      "an export missing a required column must not open the mapping wizard");
    // The one edit that clears it, named: the column, not a generic refusal.
    assert.match(shownText(document, "local-export-activation-status"),
      /incomplete[\s\S]*missing required column[\s\S]*cost_usd/i);
    assert.equal(byId(document, "local-finops-files").getAttribute("aria-invalid"), "true");
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// Loading, empty selection, and the path back
// ---------------------------------------------------------------------------

test("while a file is being read the result region says so and claims no number", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  let release = null;
  const held = new Promise((resolve) => { release = resolve; });
  try {
    const beforeFigure = shownText(document, "finops-stand-recoverable-value");
    const beforeProvenance = byId(document, "finops-stand").dataset.provenance;
    chooseFiles(document, [{
      name: "openai-supported.csv",
      text: () => held.then(() => VALID_EXPORT),
    }]);

    // The page is now mid-read: the bytes have been asked for and have not
    // arrived. Everything asserted here is what a reader sees in that window.
    assert.equal(byId(document, "local-results").getAttribute("aria-busy"), "true",
      "the result region must declare itself busy while its input is being read");
    assert.equal(byId(document, "local-import-state").getAttribute("aria-busy"), "true");
    assert.equal(byId(document, "local-export-activation").dataset.state, "reading");
    assert.equal(byId(document, "activate-local-export").disabled, true,
      "the control that starts an import must not start a second one mid-read");
    assert.equal(byId(document, "local-file-error").hidden, true,
      "a new read must clear the previous file's diagnostic before it reports its own");
    // No figure moves on a promise. The panels may say they are waiting — that
    // reserved line is the point — but the answer itself is still the bundled
    // one, and nothing is captioned as the reader's own data yet.
    assert.equal(shownText(document, "finops-stand-recoverable-value"), beforeFigure,
      "an in-flight read must not move the figure it has not produced yet");
    assert.equal(byId(document, "finops-stand").dataset.provenance, beforeProvenance,
      "an in-flight read must not relabel the answer as the reader's own export");
    assert.equal(byId(document, "local-results").hidden, true);

    release();
    await analysisRendered(document);
    await waitFor(() => byId(document, "local-export-activation").dataset.state !== "reading",
      "the reading state to settle once the file has been read");
    assert.equal(byId(document, "local-results").getAttribute("aria-busy"), "false");
    assert.equal(byId(document, "local-import-state").getAttribute("aria-busy"), "false");
    assert.equal(byId(document, "activate-local-export").disabled, false,
      "the import control must be operable again once the read has finished");
  } finally {
    release();
    // A read that outlives the document reds CI as an unhandled rejection while
    // staying green locally, so the page is not torn down until it has settled.
    await waitFor(() => byId(document, "local-export-activation").dataset.state !== "reading",
      "the in-flight read to settle before teardown").catch(() => {});
    page.restore();
  }
});

test("a change event carrying no file moves nothing on the page", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    const activation = byId(document, "local-export-activation");
    const beforeStatus = shownText(document, "local-export-activation-status");

    chooseFiles(document, []);

    assert.equal(activation.dataset.state, "idle",
      "a cancelled file dialog must not put the panel into a reading state");
    assert.equal(activation.getAttribute("aria-busy"), "false");
    assert.equal(byId(document, "local-results").hidden, true);
    assert.equal(byId(document, "local-file-error").hidden, true,
      "choosing nothing is not an error and must not be reported as one");
    assert.equal(byId(document, "local-finops-files").getAttribute("aria-invalid"), "false");
    assert.equal(shownText(document, "local-export-activation-status"), beforeStatus);
  } finally {
    page.restore();
  }
});

test("a reader recovers from an unsupported file by choosing a good one, with no reload", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    chooseFiles(document, [UNSUPPORTED_FORMAT]);
    await refused(document);
    assert.equal(byId(document, "local-finops-files").getAttribute("aria-invalid"), "true");

    // Same tab, same control, no reload: the reader does what the recovery
    // sentence beside the picker told them to do.
    chooseFiles(document, [{ name: "openai-supported.csv", text: VALID_EXPORT }]);
    await analysisRendered(document);

    assert.equal(byId(document, "local-finops-files").getAttribute("aria-invalid"), "false",
      "the corrected file must clear the previous file's invalid state");
    assert.equal(byId(document, "local-file-error").hidden, true,
      "the refusal sentence must not survive the file that fixed it");
    assert.equal(shownText(document, "local-file-error"), "");
    assert.equal(byId(document, "local-export-activation").dataset.state, "ready");
    assert.equal(visible(byId(document, "local-trust-evidence")), true,
      "the recovered analysis must carry the same trust evidence a first-try import does");
  } finally {
    page.restore();
  }
});

test("a reader recovers from an incomplete file the same way, and the refusal leaves nothing behind",
  async () => {
    const page = await openFinopsTab();
    const { document } = page;
    try {
      chooseFiles(document, [{ name: "anthropic-missing-required.csv", text: INCOMPLETE_EXPORT }]);
      await refused(document);
      const refusalText = shownText(document, "local-export-activation-status");

      chooseFiles(document, [{ name: "openai-supported.csv", text: VALID_EXPORT }]);
      await analysisRendered(document);

      assert.notEqual(shownText(document, "local-export-activation-status"), refusalText,
        "the previous file's refusal must not stand over the result that replaced it");
      assert.equal(byId(document, "local-finops-files").getAttribute("aria-invalid"), "false");
      assert.equal(byId(document, "local-results").hidden, false);
      assert.equal(byId(document, "local-results").dataset.dataset, "user");
      assert.equal(visible(byId(document, "local-trust-evidence")), true);
      assert.equal(byId(document, "local-trust-evidence-facts").children.length, 5);
    } finally {
      page.restore();
    }
  });
