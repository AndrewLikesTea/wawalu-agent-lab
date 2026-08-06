import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHtml, tabSequence, textOf } from "./support/browser.js";
import {
  bindLocalExportActivation, LOCAL_EXPORT_ACTIVATION_STATE, renderLocalExportActivation,
  settleLocalExportActivation,
} from "../src/local-export-activation.js";
import { assessOwnDataEvidence } from "../src/own-data-evidence-preflight.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const CSS = new URL("../src/evolution.css", import.meta.url);

async function page() {
  return parseHtml(await readFile(PAGE, "utf8"));
}

test("the focused local-export action operates the real chooser by keyboard", async () => {
  const document = await page();
  const choose = document.getElementById("activate-local-export");
  const input = document.getElementById("local-finops-files");
  const order = tabSequence(document);
  assert.ok(order.indexOf(choose) < order.indexOf(input));
  assert.equal(choose.tagName, "BUTTON");
  let opened = 0;
  input.click = () => { opened += 1; };
  bindLocalExportActivation(document, {
    onChoose: () => { input.focus(); input.click(); },
    onReturn: () => {},
  });
  choose.click();
  assert.equal(document.activeElement, input);
  assert.equal(opened, 1);
});

test("activation states give local feedback and a no-reload return", async () => {
  const document = await page();
  const region = document.getElementById("local-export-activation");
  const status = document.getElementById("local-export-activation-status");
  const choose = document.getElementById("activate-local-export");
  const reset = document.getElementById("return-to-bundled-example");

  renderLocalExportActivation(document, LOCAL_EXPORT_ACTIVATION_STATE.READING);
  assert.equal(region.getAttribute("aria-busy"), "true");
  assert.equal(choose.disabled, true);
  assert.match(textOf(status), /in this browser tab.*Nothing is being uploaded/i);

  renderLocalExportActivation(document, LOCAL_EXPORT_ACTIVATION_STATE.ERROR);
  assert.match(textOf(status), /bundled example is still active/i);
  assert.match(textOf(choose), /corrected export/i);

  renderLocalExportActivation(document, LOCAL_EXPORT_ACTIVATION_STATE.READY);
  assert.equal(reset.hidden, false);
  let returned = 0;
  bindLocalExportActivation(document, { onChoose: () => {}, onReturn: () => { returned += 1; } });
  reset.click();
  assert.equal(returned, 1, "return is an in-page state transition, not navigation or reload");
});

// Reading disables the chooser, and most selections never reach a projection:
// a CSV goes to the mapping review, an org mapping or delivery history carries
// no provider period, a cancelled read paints nothing. Each of those left the
// only control that reopens the picker disabled under a permanent "reading…".
test("a read that ends without a verdict hands the primary action back", async () => {
  const document = await page();
  const region = document.getElementById("local-export-activation");
  const choose = document.getElementById("activate-local-export");
  const status = document.getElementById("local-export-activation-status");

  renderLocalExportActivation(document, LOCAL_EXPORT_ACTIVATION_STATE.READING);
  assert.equal(choose.disabled, true);
  assert.equal(settleLocalExportActivation(document, LOCAL_EXPORT_ACTIVATION_STATE.IDLE), true);
  assert.equal(choose.disabled, false, "the picker is reachable again without a reload");
  assert.equal(region.getAttribute("aria-busy"), "false");

  // A verdict the import already computed outranks the settle; otherwise every
  // accepted export would be relabelled back to the example a moment later.
  renderLocalExportActivation(document, LOCAL_EXPORT_ACTIVATION_STATE.READY);
  assert.equal(settleLocalExportActivation(document, LOCAL_EXPORT_ACTIVATION_STATE.IDLE), false);
  assert.match(textOf(status), /Your provider export is active/i);
});

// Two surfaces make the same promise about which files are readable. The lead
// is the one a first-time reader acts on, so it may not be narrower than the
// contract the field actually enforces.
test("the activation states the same file contract the field enforces", async () => {
  const document = await page();
  const accept = document.getElementById("local-finops-files").getAttribute("accept");
  const lead = textOf(document.querySelector(".local-export-activation-lead"));
  for (const format of ["CSV", "TSV", "JSON"]) {
    assert.ok(accept.includes(`.${format.toLowerCase()}`), `${format} is accepted by the field`);
    assert.match(lead, new RegExp(format), `${format} is named in the primary action's promise`);
  }
});

// The benchmark is the one number this flow shows an executive. It has to
// arrive with both how it is computed and why the threshold sits where it does.
test("the coverage benchmark carries its rule and the assumption behind its weight", () => {
  const { benchmark } = assessOwnDataEvidence({ providerRows: [], querySampleRows: [] });
  assert.equal(benchmark.ratio, 0.9);
  assert.match(benchmark.rule, /Covered spend-record rows ÷ all spend-record rows/);
  assert.match(benchmark.rule, /stated assumption, not a measured constant/);
});

// WHAT A GREEN TEST DOES NOT PROVE (#1170). This harness's textOf reads through
// a closed disclosure, so asserting that the state announcement has text says
// nothing about whether a reader can reach it. These walk `parentNode` from each
// announcing node up to the document and assert that no ancestor is a details
// element — the announcement, the figure the state leads with, the step that
// resolves it, and the downgraded tier's source line all stay in the open.
const detailsAncestors = (node) => {
  let count = 0;
  for (let walk = node?.parentNode; walk; walk = walk.parentNode) {
    if (walk.tagName === "DETAILS") count += 1;
  }
  return count;
};

test("every part of the state announcement sits outside the disclosure", async () => {
  const document = await page();
  const announcing = ["own-data-preflight-status", "own-data-preflight-finding",
    "own-data-preflight-action", "own-data-preflight-confidence",
    "own-data-preflight-downgraded", "own-data-preflight-tier-source",
    "own-data-preflight-computed", "own-data-preflight-withheld"];
  for (const id of announcing) {
    const node = document.getElementById(id);
    assert.equal(node.tagName.length > 0, true, `${id} is missing from the page`);
    assert.equal(detailsAncestors(node), 0, `${id} is inside a disclosure`);
  }
  // Provenance and the boundary rules are the supporting detail, and they are
  // the only part of this region that is allowed to be folded away.
  assert.equal(detailsAncestors(document.getElementById("own-data-preflight-provenance")), 1);

  // The three states are told apart by an attribute and a word, never by color
  // alone: the served document carries the state before any script runs, and
  // the status line keeps its shape glyph beside it.
  const region = document.getElementById("own-data-evidence-preflight");
  assert.equal(region.dataset.state, "pending");
  assert.equal(region.dataset.outcome, "loading");
  assert.equal(document.getElementById("own-data-preflight-status").children
    .filter((child) => child.className === "status-shape").length, 1);

  // The disclosure summary is the region's only tab stop, and it is still the
  // native one: no control was added above the first-run region to reach a state.
  const order = tabSequence(document);
  const stops = order.filter((node) => String(node.id ?? "").startsWith("own-data-preflight"));
  assert.equal(stops.length, 1);
  assert.equal(stops[0].id, "own-data-preflight-disclosure-summary");
  assert.equal(detailsAncestors(stops[0]), 1, "the summary is its disclosure's own control");
});

test("each state's treatment is keyed on the state, not on color alone", async () => {
  const css = await readFile(CSS, "utf8");
  for (const state of ["pending", "partial", "blocked"]) {
    assert.equal(css.includes(`.own-data-preflight[data-state="${state}"] {`), true,
      `${state} has no region treatment`);
  }
  // A blocked region's step carries a heavier rule than a partial one's, so the
  // two are distinguishable in greyscale and to a reader who cannot see hue.
  assert.match(css,
    /\.own-data-preflight\[data-state="blocked"\] \.own-data-preflight-action \{ border-left-width:9px/);
  assert.match(css,
    /\.own-data-preflight\[data-state="partial"\] \.own-data-preflight-verdict \{ font-variant-numeric:tabular-nums/);
});

test("the primary question stays singular and the activation stacks on narrow screens", async () => {
  const document = await page();
  assert.equal(document.querySelectorAll("#own-data-preflight-question").length, 1);
  assert.match(textOf(document.getElementById("own-data-preflight-benchmark")), /90% required/);
  assert.match(textOf(document.querySelector(".own-data-preflight-action")), /Prioritized next action/);
  const css = await readFile(CSS, "utf8");
  assert.match(css, /@media\(max-width:640px\).*\.local-export-activation \{[^}]*flex-direction:column/s);
  assert.match(css, /\.local-export-activation-actions button \{ width:100%/);
});
