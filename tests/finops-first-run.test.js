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
  buildFirstRunResult, composeFirstRunResult, FIRST_RUN_ACTIONS,
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

test("the peer slot states where the spend ranks, against a named cohort", () => {
  const result = buildFirstRunResult();
  // The bundled example declares its two cohort attributes and one published
  // synthetic cohort matches them, so this slot answers its one question rather
  // than reporting that it cannot. `peer-cost-position.test.js` owns the metric,
  // the band boundaries, and the five withholding reasons; what is pinned here
  // is that the answer card carries the resolved position.
  assert.equal(result.peer.available, true);
  assert.match(result.peer.value, /^Bottom quartile · \$\d+\.\d{2} per successful task$/);
  assert.ok(result.peer.detail.length > 0, "the cohort it was compared against is named");
  assert.notEqual(result.peer.value, UNAVAILABLE_VALUE,
    "the bare word Unavailable is never this slot's answer");
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
  assert.equal(FIRST_RUN_UNAVAILABLE.notComposed,
    "No Bundled synthetic example analysis was produced, so no figure is shown here.");
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
  // Over the page status and over the score card, not under them. Both of those
  // wait on /evolution-demo-data.json and this block does not, so a fetch that
  // is slow or fails must not put "Reading the bundled example…", "Not scored
  // yet", or a retry button ahead of a result the page already holds. "Are
  // these numbers mine?" is still answered first — by this block's own sample
  // line, in the same region as the figures it qualifies.
  for (const later of ['id="finops-load-state"', 'id="score-card"']) {
    assert.ok(html.indexOf(`id="${FIRST_RUN_IDS.region}"`) < html.indexOf(later),
      `#${FIRST_RUN_IDS.region} is authored after ${later}`);
  }
  // And still under the h1: the page leads with what it is.
  assert.ok(html.indexOf('id="page-title"') < html.indexOf(`id="${FIRST_RUN_IDS.region}"`));
});

test("the invented-sample sentence is true before any script runs", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const sample = byId(document, FIRST_RUN_IDS.sample);
  const authored = textOf(sample);
  assert.match(authored, /Bundled synthetic example/);
  assert.match(authored, /invented data/);
  assert.match(authored, /not your spend/i);
  assert.match(authored, /No file is needed/);
  assert.match(authored, /not your spend/);
  assert.match(authored, /not .*realized savings/);
  // It sits above the figures, not under them: a reader decides what kind of
  // number they are looking at before they read the number.
  const region = byId(document, FIRST_RUN_IDS.region);
  const order = region.querySelectorAll("p").map((node) => node.id).filter(Boolean);
  assert.ok(order.indexOf(FIRST_RUN_IDS.sample) < order.indexOf(FIRST_RUN_IDS.benchmarkValue),
    "the sample label must be authored before the headline figure");
});

test("the peer position is authored directly before the recommended action", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const region = byId(document, FIRST_RUN_IDS.region);
  // Position and action are read together or not at all — and the position goes
  // first, because it is the evidence the action rests on. Read linearly, an
  // action ahead of its evidence is an instruction with nothing behind it.
  // Direct element children only: the slots nested inside each block are not
  // blocks, and the whitespace between them is not either.
  // By class membership, not by the whole `class` string: these blocks also
  // carry `pre-analysis-withheld`, the marker that keeps them out of the tree
  // until they have figures in them.
  const blocks = [...region.children].filter((node) => node.nodeType === 1);
  const at = (name) => blocks.findIndex((node) => node.classList.contains(name));
  const action = at("first-run-recommendation");
  const position = at("first-run-support");
  assert.ok(action >= 0 && position >= 0);
  assert.equal(action, position + 1, "the action block follows the position block directly");

  // The authored default is the same complete bundled result as the runtime
  // composition, so the first render never waits on JavaScript to become useful.
  const value = byId(document, FIRST_RUN_IDS.peerValue);
  assert.equal(value.dataset.available, "true");
  assert.equal(textOf(value), buildFirstRunResult().peer.value);
  assert.equal(value.closest("[hidden]"), null);
});

test("the drill-down and the literacy letter share the peer position's area", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const support = document.querySelectorAll(".first-run-support")[0];
  assert.ok(support, "the drill-down lives in the peer position's own area");
  const values = support.querySelectorAll(".first-run-value").map((node) => node.id);
  // A DELIBERATE CONTRACT CHANGE, and the exactness is the point of keeping it.
  // This area shipped two supporting figures and now ships three: #994 fills the
  // literacy slot that used to read "no scored query sample", and it belongs
  // here rather than beside the headline because it qualifies the org-level
  // answer in the same way the internal gap does. The list stays exact so a
  // fourth figure cannot arrive unannounced, and the ORDER is the reading order
  // — the org's position, then inside it, then how well its people prompt.
  assert.deepEqual(values,
    [FIRST_RUN_IDS.peerValue, FIRST_RUN_IDS.internalValue, FIRST_RUN_IDS.literacyValue],
    "the internal gap follows the org-level position it drills into, and the letter follows both");

  // And the new member is a letter with its rubric attached, not a placeholder
  // that happened to take a slot: the grade, the score, and the rubric label a
  // disputed score has to be argued against are on one line.
  const literacy = byId(document, FIRST_RUN_IDS.literacyValue);
  assert.equal(literacy.dataset.available, "true");
  assert.match(textOf(literacy), /^[A-F] · \d{1,3} of 100 · literacy-mix\/\d+\.\d+\.\d+$/);
  assert.equal(textOf(literacy), buildFirstRunResult().literacy.value);

  // The same slot idiom as its neighbour, down to the heading level: an h3 under
  // the region's h2, a value, and a detail that is hidden until it has content.
  const heading = support.querySelectorAll("h3")[1];
  assert.equal(textOf(heading), "Internal drill-down · widest department gap");
  const value = byId(document, FIRST_RUN_IDS.internalValue);
  assert.equal(value.className, "first-run-value");
  assert.equal(value.dataset.available, "true");
  assert.match(textOf(value), /Invented Department/);
  assert.match(textOf(value), /full band behind/);
  assert.equal(byId(document, FIRST_RUN_IDS.internalDetail).hasAttribute("hidden"), false);
  // No new control, so no new tab stop and no new focus trap in this area.
  assert.equal(support.querySelectorAll("button").length, 0);
  assert.equal(support.querySelectorAll("a").length, 0);
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

test("a visitor with no files meets five resolved slots and one ranked action", async () => {
  const page = await bootedPage();
  const { document } = page;
  try {
    const region = byId(document, FIRST_RUN_IDS.region);
    assert.equal(region.dataset.state, "ready");
    assert.equal(region.hidden, false, "the block is visible before anything is imported");

    assert.equal(byId(document, FIRST_RUN_IDS.benchmarkValue).dataset.available, "true");
    assert.match(textOf(byId(document, FIRST_RUN_IDS.benchmarkValue)), /% of analyzed AI spend/);
    assert.match(textOf(byId(document, FIRST_RUN_IDS.impactValue)), /^\$[\d,]+ in the reporting period$/);
    assert.match(textOf(byId(document, FIRST_RUN_IDS.peerValue)),
      /^Bottom quartile · \$\d+\.\d{2} per successful task$/);
    assert.equal(byId(document, FIRST_RUN_IDS.peerValue).dataset.available, "true");
    assert.ok(textOf(byId(document, FIRST_RUN_IDS.peerDetail)).length > 0);
    // The fifth resolved slot. It is a letter, a score, a rubric label, and the
    // coverage that qualifies all three — never a dash, which is what this slot
    // held before #994 bundled a synthetic prompt corpus to score.
    const literacy = byId(document, FIRST_RUN_IDS.literacyValue);
    assert.equal(literacy.dataset.available, "true");
    assert.match(textOf(literacy), /^[A-F] · \d{1,3} of 100 · literacy-mix\/\d+\.\d+\.\d+$/);
    const literacyDetail = textOf(byId(document, FIRST_RUN_IDS.literacyDetail));
    assert.match(literacyDetail, /^\$[\d,]+ of \$[\d,]+ in-scope invented spend was scored/);
    assert.match(literacyDetail, /(high|moderate|provisional|insufficient) coverage/);
    assert.match(literacyDetail, /\d+ of \d+ synthetic prompts classified/);
    assert.match(literacyDetail, /not customer behaviour and not realized savings/);

    assert.equal(byId(document, FIRST_RUN_IDS.action).dataset.available, "true");
    assert.match(textOf(byId(document, FIRST_RUN_IDS.role)), /Accountable role: /);
    assert.equal(byId(document, FIRST_RUN_IDS.confidenceValue).dataset.available, "true");
    assert.match(textOf(byId(document, FIRST_RUN_IDS.confidenceValue)),
      /^0\.\d{2} of 1\.00 · (low|moderate|high)$/i);
    assert.match(textOf(byId(document, FIRST_RUN_IDS.confidenceDetail)),
      /bundled example records were analyzed/i);
    assert.match(textOf(byId(document, FIRST_RUN_IDS.sample)), /Bundled synthetic example/);
    assert.match(textOf(byId(document, FIRST_RUN_IDS.sample)), /not .*realized savings/i);

    // The method disclosure is painted from the briefing, not from the markup.
    const terms = byId(document, FIRST_RUN_IDS.methodList)
      .querySelectorAll("dt").map((node) => textOf(node));
    // A DELIBERATE CONTRACT CHANGE. "AI literacy" is a new evidence entry, and
    // its POSITION is asserted rather than its mere presence: it sits after
    // "Coverage", which states how much of the example was analyzed, and before
    // "Limits", which is the closing caveat and now names the literacy letter as
    // one of the things that is synthetic. Evidence read after the caveat that
    // qualifies it is evidence a reader has already been told to discount.
    assert.deepEqual(terms,
      ["Inputs", "Path", "Arithmetic", "Coverage", "AI literacy", "Limits", "Internal gap", "Where it ran"]);
    const literacyEntry = byId(document, FIRST_RUN_IDS.methodList).querySelectorAll("div")
      .find((node) => textOf(node.querySelectorAll("dt")[0]) === "AI literacy");
    assert.match(textOf(literacyEntry.querySelectorAll("dd")[0]),
      /^[A-F] · \d{1,3} of 100 · literacy-mix\/\d+\.\d+\.\d+ · \$[\d,]+ of \$[\d,]+ in-scope invented spend/,
      "the evidence entry must carry the letter, the score, and the rubric it came from");

    // The live region is armed and SILENT on the first paint. A polite region
    // that is filled during page load reads the whole headline aloud over the
    // top of the page title a reader is still hearing; it exists to say that a
    // figure changed, and on load nothing has. The repaint path fills it.
    const live = byId(document, FIRST_RUN_IDS.live);
    assert.equal(live.getAttribute("aria-live"), "polite");
    assert.equal(textOf(live), "", "the live region does not announce on initial load");
  } finally {
    page.restore();
  }
});

test("the internal department gap renders in the drill-down area of the booted page", async () => {
  const page = await bootedPage();
  const { document } = page;
  try {
    // The bundled example, with no import at all, produces a real internal
    // finding — a module with no consuming surface is the failure mode this
    // pins. `internal-cost-gap.test.js` owns the rubric; what is pinned here is
    // that the answer reaches the slot a reader can see.
    const value = byId(document, FIRST_RUN_IDS.internalValue);
    assert.equal(value.dataset.available, "true");
    assert.match(textOf(value),
      /^.+ is (a full band|\d+ full bands) behind .+ on cost per successful task\.$/);

    // Both sides' record counts, and the provenance, in the detail beside it.
    const detail = byId(document, FIRST_RUN_IDS.internalDetail);
    assert.equal(detail.hidden, false);
    const text = textOf(detail);
    assert.equal(text.match(/successful tasks across \d+ records/g)?.length, 2,
      "each side states how many records it was computed over");
    assert.match(text, /Lower cost per successful task is better\./);
    assert.match(text, /cost_per_successful_task · finops-cost-position\//);
    assert.match(text, /\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}\.$/);

    // And the same provenance in the evidence disclosure, where this surface
    // already surfaces comparable evidence, in a form a later pass can recompute.
    const entries = byId(document, FIRST_RUN_IDS.methodList).querySelectorAll("div");
    const gapEntry = entries.find((node) => textOf(node.querySelectorAll("dt")[0]) === "Internal gap");
    assert.ok(gapEntry, "the internal gap publishes its provenance with the rest of the evidence");
    assert.match(textOf(gapEntry.querySelectorAll("dd")[0]),
      /orgUnitId in \S+, \S+ · \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}\. Recompute from these and compare\./);
  } finally {
    page.restore();
  }
});

test("a suppressed internal gap renders its stated reason rather than an empty panel", async () => {
  const analysis = loadExampleDataset();
  // An import that declared no size band or industry: the shared rubric cannot
  // place the org, so it cannot place a department against the same boundaries
  // either. The slot must say so in words.
  const suppressed = composeFirstRunResult({
    analysis, briefing: buildFinopsBriefing(analysis), org: null, tasks: null,
  });
  assert.equal(suppressed.internalGap.status, "suppressed");
  assert.equal(suppressed.internal.available, false);
  assert.match(suppressed.internal.value, /^No internal comparison: /);
  assert.notEqual(suppressed.internal.value, UNAVAILABLE_VALUE,
    "the bare word Unavailable is never this slot's answer");

  // Painted into the real markup, the reason is visible text in the slot — not a
  // console warning, not a blank element, and not a value with no explanation.
  const document = parseHtml(await readFile(PAGE, "utf8"));
  applyFirstRunResult(document, suppressed);
  const value = byId(document, FIRST_RUN_IDS.internalValue);
  assert.equal(value.dataset.available, "false");
  assert.equal(textOf(value), suppressed.internal.value);
  assert.ok(textOf(value).length > 20, "the reason is a sentence, not a dash");
});

test("failed preparation replaces the bundled result instead of sitting beside it", async () => {
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
    assert.equal(region.hidden, true);
    assert.equal(byId(document, "finops-stand").hidden, true);
    assert.equal(byId(document, "finops-load-state").hidden, false);
    assert.match(textOf(byId(document, "finops-load-title")), /could not/i);
    assert.equal(byId(document, "finops-data-retry").hidden, false);
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

// The follow-up ask used to be authored twice: once here as a conversion aside
// that delegated to #finops-contact's trigger, and once in #finops-contact
// itself with the form, the label, and the privacy line. The answer spine
// retired the aside and this pass deleted it, so what is left to assert is that
// the surviving ask still works and that the page still has exactly one place
// an email address is typed.
test("one follow-up ask survives, and it is the one that owns the form", async () => {
  const page = await bootedPage();
  const { document } = page;
  try {
    assert.equal(byId(document, "finops-first-run-contact"), null,
      "the duplicate ask is deleted, not hidden");
    const trigger = byId(document, "finops-contact-open");
    assert.equal(byId(document, "finops-contact-panel").hidden, true);

    trigger.click();
    assert.equal(byId(document, "finops-contact-panel").hidden, false);

    // And the page adds no second place to type an email address.
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
  assert.match(textOf(byId(document, FIRST_RUN_IDS.sample)), /Bundled synthetic example/);
  // Not hidden, not empty: the reason and both next steps are still readable.
  assert.equal(region.hidden, false);
  assert.match(textOf(byId(document, FIRST_RUN_IDS.benchmarkDetail)), /no figure is shown/);
});

test("hostile result strings stay literal text in the promoted first viewport", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const hostile = `<img src=x onerror="globalThis.pwned=true"><script>pwned()</script>`;
  const base = buildFirstRunResult();
  const result = {
    ...base,
    sample: { badge: hostile, statement: hostile },
    benchmark: { available: true, value: hostile, detail: hostile },
    impact: { available: true, value: hostile, detail: hostile },
    // The band label is analysis-derived too — a department name reaches the
    // internal chip — so it goes through the same proof.
    peer: {
      available: false, value: hostile, detail: hostile,
      band: { state: "withheld", label: hostile, shape: "◇", silhouette: "outline" },
    },
    action: { available: true, value: hostile, detail: hostile },
    method: [{ term: hostile, detail: hostile }],
  };

  applyFirstRunResult(document, result, { announce: true });

  assert.match(textOf(byId(document, FIRST_RUN_IDS.peerBand)), /<img src=x on/,
    "the band chip did not preserve the hostile label as text");

  // Every newly prominent slot receives analysis-derived strings. Prove that
  // the hostile version is neutralized instead of trusting the normal sample.
  for (const id of [
    FIRST_RUN_IDS.sample,
    FIRST_RUN_IDS.benchmarkValue,
    FIRST_RUN_IDS.benchmarkDetail,
    FIRST_RUN_IDS.impactValue,
    FIRST_RUN_IDS.impactDetail,
    FIRST_RUN_IDS.peerValue,
    FIRST_RUN_IDS.peerDetail,
    FIRST_RUN_IDS.action,
    FIRST_RUN_IDS.role,
    FIRST_RUN_IDS.live,
  ]) {
    assert.match(textOf(byId(document, id)), /<img src=x on/,
      `#${id} did not preserve the hostile string as text`);
  }
  assert.equal(byId(document, FIRST_RUN_IDS.region).querySelectorAll("script").length, 0);
  assert.equal(byId(document, FIRST_RUN_IDS.region).querySelectorAll("img").length, 0);
  assert.equal(textOf(byId(document, FIRST_RUN_IDS.methodList).querySelectorAll("dt")[0]), hostile);
  assert.equal(textOf(byId(document, FIRST_RUN_IDS.methodList).querySelectorAll("dd")[0]), hostile);

  const viewSource = await readFile(new URL("../src/finops-first-run-view.js", import.meta.url), "utf8");
  assert.doesNotMatch(viewSource, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test("the view is a no-op on a document that has no block in it", () => {
  const document = parseHtml("<html><body><p>nothing here</p></body></html>");
  assert.equal(applyFirstRunResult(document, buildFirstRunResult()), null);
  assert.equal(applyFirstRunSupersession(document, true), null);
  assert.deepEqual(Object.values(bindFirstRunActions(document)), [null, null]);
});

test("supersession is reversible, so a cleared analysis brings the block back", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  applyFirstRunResult(document, buildFirstRunResult());
  applyFirstRunSupersession(document, true);
  assert.equal(byId(document, FIRST_RUN_IDS.region).hidden, true);
  applyFirstRunSupersession(document, false);
  assert.equal(byId(document, FIRST_RUN_IDS.region).hidden, false);
  assert.equal(byId(document, FIRST_RUN_IDS.region).dataset.superseded, "false");
});
