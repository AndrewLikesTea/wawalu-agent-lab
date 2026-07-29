// The AI FinOps landing surface, for the visitor who arrives with no file.
//
// The regression this exists to catch is the page reverting to what it was: a
// first viewport that stated only what it did not have. So most of what is
// pinned here is a property of the *shipped markup and the booted page* rather
// than of a helper — the block is authored above the guided result, it carries
// the invented-sample sentence before any script runs, it holds four populated
// or explicitly-labelled slots after one, and both next steps are real buttons
// that reach the controls that already own them.
//
// The other half is honesty under failure. A synthetic figure must never read
// as an outcome, an absent figure must never read as a zero, and a broken
// fixture, a broken contract, or a throwing dataset must each leave the region
// labelled rather than either blank or confidently wrong.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, parseHtml, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  buildFirstRunResult, composeFirstRunResult, FIRST_RUN_ACTIONS, FIRST_RUN_CONVERSION,
  FIRST_RUN_IDS, FIRST_RUN_STATE, FIRST_RUN_UNAVAILABLE, recoverableShare, SAMPLE_LABEL,
  UNAVAILABLE_VALUE,
} from "../src/finops-first-run.js";
import {
  applyFirstRunResult, applyFirstRunSupersession, bindFirstRunActions,
} from "../src/finops-first-run-view.js";
import { loadExampleDataset } from "../src/example-dataset.js";
import { buildFinopsBriefing } from "../src/finops-briefing-contract.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const ROUTES = {
  "/evolution-demo-data.json": DEMO_DATA,
  "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
};

const byId = (document, id) => document.getElementById(id);

// The page starts three things on its own. Waiting for all of them is not
// pedantry: `restore()` pulls the globals out from under any request still in
// flight, and the rejection then surfaces in whichever test runs next.
async function settle(document) {
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready"
    || byId(document, "finops-load-state")?.dataset.state === "error",
  "the page never settled into a resolved load state");
  await waitFor(() => byId(document, "integration-contract-provenance")
    ?.textContent.trim().startsWith("Gateway completed"), "the static contract gateway to settle");
  await waitFor(() => byId(document, "finops-evaluation-result")
    ?.getAttribute("aria-busy") === "false", "the evaluation panel to settle");
}

async function bootedPage({ routes = ROUTES } = {}) {
  const page = await loadPage(PAGE, { routes });
  await importPageModule("/evolution-page.js");
  await settle(page.document);
  return page;
}

// --- the composition -------------------------------------------------------

test("the bundled example composes a complete, populated result", () => {
  const result = buildFirstRunResult();

  assert.equal(result.presentation.state, FIRST_RUN_STATE.ready.state);
  // (1) a populated headline benchmark: a share, not a total, so a reader can
  // hold it against their own number before they have run anything.
  assert.equal(result.benchmark.available, true);
  assert.match(result.benchmark.value, /^\d+% of analyzed AI spend$/);
  // Both operands travel with the ratio, so it can be checked rather than taken.
  assert.match(result.benchmark.detail, /\$[\d,]+ of \$[\d,]+ analyzed/);
  assert.match(result.benchmark.detail, /\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/);

  // (3) a quantified synthetic impact, and the sentence that stops it reading
  // as money anyone has saved.
  assert.equal(result.impact.available, true);
  assert.match(result.impact.value, /^\$[\d,]+ in the reporting period$/);
  assert.match(result.impact.detail, /not a realized, invoiced, or promised saving/);

  // (2) one recommended action, with the role accountable for it.
  assert.equal(result.action.available, true);
  assert.ok(result.action.value.length > 20, "the ranked action is a sentence, not a label");
  assert.match(result.action.detail, /^Accountable role: /);
});

test("the peer slot is labelled unavailable rather than filled in or zeroed", () => {
  const result = buildFirstRunResult();
  // The bundled sample genuinely ships no comparable cohort. That is the point:
  // an unavailable value is a state this surface can render honestly.
  assert.equal(result.peer.available, false);
  assert.equal(result.peer.value, UNAVAILABLE_VALUE);
  assert.ok(result.peer.detail.length > 0, "an unavailable slot names why");
  assert.doesNotMatch(result.peer.value, /\$|%|\b0\b|—/,
    "an unavailable value must not be a number, a dash, or a zero");
});

test("no figure in the result is authored — every one comes from the analysis", () => {
  const analysis = loadExampleDataset();
  const briefing = buildFinopsBriefing(analysis);
  const result = composeFirstRunResult({ analysis, briefing });

  // The figures are the contract's, recomputed here from the same envelope.
  const share = Math.round((analysis.recoverableUsd / analysis.spendUsd) * 100);
  assert.equal(result.benchmark.value, `${share}% of analyzed AI spend`);
  assert.match(result.action.value,
    /^Pilot lower-cost routing in the top-spend invented department\./);
  assert.match(result.action.value, new RegExp(
    `Cap the pilot at \\$${Math.round(briefing.materialMetric.value).toLocaleString("en-US")}`));
  assert.equal(result.action.detail, `Accountable role: ${briefing.rankedAction.accountableRole}`);
  // And the method disclosure is built from the briefing, so the sentence a
  // reader checks the figure against cannot drift from the figure.
  const method = Object.fromEntries(result.method.map((entry) => [entry.term, entry.detail]));
  assert.equal(method.Arithmetic, briefing.arithmeticInputs.operation);
  assert.match(method.Path, new RegExp(briefing.contractVersion.replace(/[/.]/g, "\\$&")));
  assert.match(method.Coverage, /\d+ of \d+ example records analyzed · confidence \w+\./);
  assert.match(method.Limits, /modelled ceiling, not a realized saving/);
});

test("the sample label and both next steps survive every unavailable state", () => {
  const cases = [
    ["nothing composed", composeFirstRunResult({})],
    ["a malformed envelope", composeFirstRunResult({ analysis: { spendUsd: "x" }, briefing: {} })],
    ["a briefing that fails its contract", composeFirstRunResult({
      analysis: loadExampleDataset(),
      briefing: { ...buildFinopsBriefing(loadExampleDataset()), coverage: null },
    })],
    ["a dataset that throws", buildFirstRunResult(() => { throw new Error("contract moved"); })],
  ];
  for (const [name, result] of cases) {
    assert.equal(result.presentation.state, FIRST_RUN_STATE.unavailable.state, name);
    assert.equal(result.benchmark.value, UNAVAILABLE_VALUE, name);
    assert.equal(result.benchmark.available, false, name);
    assert.ok(result.reason, `${name} names why`);
    // The two ways on are what makes the failure recoverable, so they are part
    // of the state rather than something painted over it.
    assert.equal(result.sample.statement, SAMPLE_LABEL.statement, name);
    assert.equal(result.actions.demo.targetId, "try-example-dataset", name);
    assert.equal(result.actions.import.targetId, "local-finops-files", name);
  }
  assert.equal(buildFirstRunResult(() => { throw new Error("x"); }).reason, FIRST_RUN_UNAVAILABLE.failed);
});

test("a share of nothing is unknown, never zero", () => {
  assert.equal(recoverableShare(0, 100), 0);
  assert.equal(recoverableShare(50, 0), null);
  assert.equal(recoverableShare(50, -1), null);
  assert.equal(recoverableShare(-5, 100), null);
  assert.equal(recoverableShare(Number.NaN, 100), null);
  assert.equal(recoverableShare(50, undefined), null);
  // A denominator the analysis never produced degrades the whole region rather
  // than showing a headline computed from a number that is not there.
  const analysis = { ...loadExampleDataset(), spendUsd: null };
  const composed = composeFirstRunResult({ analysis, briefing: buildFinopsBriefing(analysis) });
  assert.equal(composed.presentation.state, FIRST_RUN_STATE.unavailable.state);
});

// --- the shipped markup ----------------------------------------------------

test("the block is authored above every panel it is meant to replace", async () => {
  const html = await readFile(PAGE, "utf8");
  for (const later of ['id="guided-result"', 'id="local-import-title"', 'id="kpi-row"',
    'class="proof-point"', 'id="finops-contact"']) {
    assert.ok(html.indexOf(`id="${FIRST_RUN_IDS.region}"`) < html.indexOf(later),
      `#${FIRST_RUN_IDS.region} is authored after ${later}`);
  }
  // Under the page status, not over it: "are these numbers mine?" is still the
  // first thing answered, and this block is the answer to what they say.
  assert.ok(html.indexOf('id="finops-load-state"') < html.indexOf(`id="${FIRST_RUN_IDS.region}"`));
  // And the conversion moment follows the result rather than preceding it.
  assert.ok(html.indexOf(`id="${FIRST_RUN_IDS.region}"`) < html.indexOf('id="finops-first-run-conversion"'));
});

test("the invented-sample sentence is true before any script runs", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const sample = byId(document, FIRST_RUN_IDS.sample);
  const authored = textOf(sample);
  assert.match(authored, /Invented sample data/);
  assert.match(authored, /not your spend/);
  assert.match(authored, /not .*realized savings/);
  // It sits above the figures, not under them: a reader decides what kind of
  // number they are looking at before they read the number.
  const region = byId(document, FIRST_RUN_IDS.region);
  const order = region.querySelectorAll("p").map((node) => node.id).filter(Boolean);
  assert.ok(order.indexOf(FIRST_RUN_IDS.sample) < order.indexOf(FIRST_RUN_IDS.benchmarkValue),
    "the sample label must be authored before the headline figure");
});

test("two distinct next steps, both real buttons, neither a scroll hint", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const demo = byId(document, FIRST_RUN_IDS.demo);
  const chooseOwn = byId(document, FIRST_RUN_IDS.import);
  for (const button of [demo, chooseOwn]) {
    assert.equal(button.tagName.toLowerCase(), "button");
    assert.equal(button.getAttribute("type"), "button");
    assert.equal(button.hasAttribute("disabled"), false);
    // Each names what it does in its own words, and each is described by the
    // note that says what it will and will not do with a file.
    assert.ok(textOf(button).length > 8);
    assert.ok(byId(document, button.getAttribute("aria-describedby")),
      "each choice points at a note that exists");
  }
  assert.notEqual(textOf(demo), textOf(chooseOwn));
  assert.equal(textOf(demo), FIRST_RUN_ACTIONS.demo.label);
  assert.equal(textOf(chooseOwn), FIRST_RUN_ACTIONS.import.label);

  // Prominence is a style fact, so it is pinned as one: the filled accent
  // belongs to the demo, and the reader's own path is the dashed alternative.
  const styles = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
  assert.match(styles, /\.first-run-primary \{[^}]*background:var\(--import-accent\)/);
  assert.match(styles, /\.first-run-secondary \{[^}]*background:transparent/);
  // An unavailable value is never carried by a tint alone.
  assert.match(styles, /\.first-run-value\[data-available="false"\]/);
});

test("the method disclosure is a native details hanging off the headline", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const method = byId(document, "finops-first-run-method");
  assert.equal(method.tagName.toLowerCase(), "details");
  const summary = method.querySelectorAll("summary")[0];
  // Never a bare chevron and never "More": the summary says what it reveals.
  assert.match(textOf(summary), /How this example was calculated/);
  assert.match(textOf(summary), /what it cannot tell you/);
  assert.ok(byId(document, FIRST_RUN_IDS.methodList));
});

// --- the booted page -------------------------------------------------------

test("a visitor with no files meets four resolved slots and one ranked action", async () => {
  const page = await bootedPage();
  const { document } = page;
  try {
    const region = byId(document, FIRST_RUN_IDS.region);
    assert.equal(region.dataset.state, "ready");
    assert.equal(region.hidden, false, "the block is visible before anything is imported");

    assert.equal(byId(document, FIRST_RUN_IDS.benchmarkValue).dataset.available, "true");
    assert.match(textOf(byId(document, FIRST_RUN_IDS.benchmarkValue)), /% of analyzed AI spend/);
    assert.match(textOf(byId(document, FIRST_RUN_IDS.impactValue)), /^\$[\d,]+ in the reporting period$/);
    assert.equal(textOf(byId(document, FIRST_RUN_IDS.peerValue)), UNAVAILABLE_VALUE);
    assert.equal(byId(document, FIRST_RUN_IDS.peerValue).dataset.available, "false");
    assert.ok(textOf(byId(document, FIRST_RUN_IDS.peerDetail)).length > 0);
    assert.equal(byId(document, FIRST_RUN_IDS.action).dataset.available, "true");
    assert.match(textOf(byId(document, FIRST_RUN_IDS.role)), /Accountable role: /);

    // The method disclosure is painted from the briefing, not from the markup.
    const terms = byId(document, FIRST_RUN_IDS.methodList)
      .querySelectorAll("dt").map((node) => textOf(node));
    assert.deepEqual(terms, ["Inputs", "Path", "Arithmetic", "Coverage", "Limits", "Where it ran"]);

    // One announcement, carrying what a reader who cannot see the block needs
    // to decide whether to read it: what kind of numbers, and what they say.
    const live = byId(document, FIRST_RUN_IDS.live);
    assert.equal(live.getAttribute("aria-live"), "polite");
    assert.match(textOf(live), /^Invented sample data\./);
    assert.match(textOf(live), /% of analyzed AI spend/);
  } finally {
    page.restore();
  }
});

test("the block survives a bundled fixture that never arrives", async () => {
  // Only the evaluation fixture is served; the demo-data request throws. The
  // block is composed from a module in the bundle, so it owes that fetch
  // nothing — which is the reason it is composed rather than fetched.
  const page = await loadPage(PAGE, { routes: { "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES } });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  try {
    await settle(document);
    assert.equal(byId(document, "finops-load-state").dataset.state, "error",
      "the bundled fixture request is expected to have failed");
    const region = byId(document, FIRST_RUN_IDS.region);
    assert.equal(region.dataset.state, "ready");
    assert.match(textOf(byId(document, FIRST_RUN_IDS.benchmarkValue)), /% of analyzed AI spend/);
    assert.equal(byId(document, FIRST_RUN_IDS.demo).hasAttribute("disabled"), false);
  } finally {
    page.restore();
  }
});

test("the demo action loads the example through the one control that owns it", async () => {
  const page = await bootedPage();
  const { document } = page;
  try {
    assert.equal(byId(document, FIRST_RUN_IDS.demo).dataset.target, "try-example-dataset");
    byId(document, FIRST_RUN_IDS.demo).click();
    await waitFor(() => !byId(document, "local-results").hidden,
      "the example analysis to render into the page");
    // And the block retires once a fuller result is on screen: two synthetic
    // headlines on one page is the confusion it exists to remove.
    assert.equal(byId(document, FIRST_RUN_IDS.region).hidden, true);
    assert.equal(byId(document, FIRST_RUN_IDS.region).dataset.superseded, "true");
    assert.equal(byId(document, "finops-first-run-conversion").hidden, true);
    // The brief the click produced finishes painting before the globals are
    // pulled out from under it; otherwise its tail surfaces in the next test.
    await waitFor(() => byId(document, "local-results").getAttribute("aria-busy") === "false"
      && !byId(document, "local-lead-finding").hidden, "the imported brief to finish painting");
  } finally {
    page.restore();
  }
});

test("the import action stands the reader on the file input", async () => {
  const page = await bootedPage();
  const { document } = page;
  try {
    assert.equal(byId(document, FIRST_RUN_IDS.import).dataset.target, "local-finops-files");
    byId(document, FIRST_RUN_IDS.import).click();
    assert.equal(document.activeElement?.id, "local-finops-files",
      "the reader is left standing on the control that opens the picker");
    // Nothing was analyzed, so the block stays: the reader has not decided yet.
    assert.equal(byId(document, FIRST_RUN_IDS.region).hidden, false);
  } finally {
    page.restore();
  }
});

test("the conversion moment opens the one follow-up form and never closes it", async () => {
  const page = await bootedPage();
  const { document } = page;
  try {
    const contact = byId(document, FIRST_RUN_IDS.contact);
    assert.equal(contact.dataset.target, FIRST_RUN_CONVERSION.targetId);
    assert.equal(byId(document, "finops-contact-panel").hidden, true);

    contact.click();
    assert.equal(byId(document, "finops-contact-panel").hidden, false);
    assert.equal(document.activeElement?.id, FIRST_RUN_CONVERSION.focusId,
      "focus lands in the field the reader asked for");

    // A second press must not toggle the form shut: a control labelled "ask us"
    // that hides the form is worse than no control.
    contact.click();
    assert.equal(byId(document, "finops-contact-panel").hidden, false);
    // And it adds no second place to type an email address.
    assert.equal(document.querySelectorAll("input")
      .filter((node) => node.getAttribute("type") === "email").length, 2,
    "the page keeps exactly its two authored email fields — the panel's and the footer's");
  } finally {
    page.restore();
  }
});

// --- the view in isolation -------------------------------------------------

test("the view paints an unavailable composition without blanking the block", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const region = applyFirstRunResult(document, composeFirstRunResult({}));

  assert.equal(region.dataset.state, "unavailable");
  assert.equal(region.dataset.tone, "error");
  assert.equal(textOf(byId(document, FIRST_RUN_IDS.word)), FIRST_RUN_STATE.unavailable.word);
  assert.equal(textOf(byId(document, FIRST_RUN_IDS.benchmarkValue)), UNAVAILABLE_VALUE);
  assert.match(textOf(byId(document, FIRST_RUN_IDS.sample)), /Invented sample data/);
  // Not hidden, not empty: the reason and both next steps are still readable.
  assert.equal(region.hidden, false);
  assert.match(textOf(byId(document, FIRST_RUN_IDS.benchmarkDetail)), /no figure is shown/);
});

test("the view is a no-op on a document that has no block in it", () => {
  const document = parseHtml("<html><body><p>nothing here</p></body></html>");
  assert.equal(applyFirstRunResult(document, buildFirstRunResult()), null);
  assert.equal(applyFirstRunSupersession(document, true), null);
  assert.deepEqual(Object.values(bindFirstRunActions(document)), [null, null, null]);
});

test("supersession is reversible, so a cleared analysis brings the block back", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  applyFirstRunResult(document, buildFirstRunResult());
  applyFirstRunSupersession(document, true);
  assert.equal(byId(document, FIRST_RUN_IDS.region).hidden, true);
  applyFirstRunSupersession(document, false);
  assert.equal(byId(document, FIRST_RUN_IDS.region).hidden, false);
  assert.equal(byId(document, FIRST_RUN_IDS.region).dataset.superseded, "false");
  assert.equal(byId(document, "finops-first-run-conversion").hidden, false);
});
