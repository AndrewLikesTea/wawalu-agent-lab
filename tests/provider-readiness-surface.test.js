// The readiness contract on the surface that has to use it (#1062): the AI
// FinOps import section on /evolution.html, booted by the real page entry.
//
// A contract module nothing renders ships nothing, and a section a reader has
// to open something to reach is a section they never see. So this file asserts
// placement and visibility as hard as it asserts content: above the picker in
// document order, and with no collapsed container anywhere between it and the
// page — the harness reads text through a closed disclosure, so "the text is
// there" is not evidence that a person can see it.
//
// The download is checked by its BYTES, through the same recognition entry
// point the contract test uses, so the file a reader receives from the button
// and the file the contract claims to produce cannot drift apart.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

import { PROVIDER_READINESS } from "../src/provider-readiness-contract.js";
import { detectAndNormalizeExport } from "../src/export-provider-detection.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

async function openFinopsTab() {
  const page = await loadPage(PAGE, {
    storage: {},
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  return page;
}

// Descendant selectors throw in this harness, so ancestry is walked, never
// queried.
function ancestors(node) {
  const chain = [];
  for (let current = node.parentNode; current && current.nodeType === 1; current = current.parentNode) {
    chain.push(current);
  }
  return chain;
}

test("the five provider errands are painted above the picker, from the contract", async () => {
  const { document } = await openFinopsTab();
  const items = document.querySelectorAll(".provider-readiness-item");
  assert.equal(items.length, PROVIDER_READINESS.length,
    "one card per recognized provider, painted from the contract");

  for (const provider of PROVIDER_READINESS) {
    const card = items.find((item) => item.dataset.provider === provider.id);
    assert.equal(typeof card?.dataset.provider, "string", `${provider.id} must have a card`);
    const text = textOf(card);
    assert.ok(text.includes(provider.displayName), `${provider.id} names the provider`);
    assert.ok(text.includes(provider.consoleLocation), `${provider.id} says where the export lives`);
    assert.ok(text.includes(provider.dateRangeGuidance), `${provider.id} says which period to pull`);
    assert.match(text, /Required columns/);
    assert.match(text, /Optional columns/);
    for (const column of provider.requiredColumns) {
      assert.ok(text.includes(column), `${provider.id} must name its required column ${column}`);
    }
    for (const column of provider.optionalColumns) {
      assert.ok(text.includes(column), `${provider.id} must name its optional column ${column}`);
    }
    assert.match(text, new RegExp(`Download a one-row ${provider.sampleFormat.toUpperCase()} sample`));
  }
});

test("the section stands above the file picker and behind nothing", async () => {
  const { document } = await openFinopsTab();
  const section = document.getElementById("provider-readiness");
  const picker = document.getElementById("local-finops-files");

  // Same import zone, and earlier in it: walk up from the picker to the sibling
  // that shares the section's parent, then compare positions.
  const parent = section.parentNode;
  let branch = picker;
  while (branch && branch.parentNode !== parent) branch = branch.parentNode;
  assert.equal(typeof branch?.tagName, "string",
    "the readiness section and the picker must live in the same import zone");
  const siblings = parent.childElements;
  assert.ok(siblings.indexOf(section) < siblings.indexOf(branch),
    "the provider guidance must be rendered above the file picker");

  // Nothing between this section and the document may fold it away or hide it.
  for (const ancestor of [section, ...ancestors(section)]) {
    assert.notEqual(ancestor.tagName, "DETAILS",
      "provider guidance must never sit inside a disclosure");
    assert.equal(ancestor.hidden, false, `${ancestor.tagName} must not hide the guidance`);
  }
  assert.equal(section.querySelectorAll("details").length, 0,
    "no card may fold its own guidance away");
  assert.equal(section.querySelectorAll("[hidden]").length, 0,
    "nothing inside the section may ship hidden");
});

test("the section says plainly that this is a static demo with nothing connected", async () => {
  const { document } = await openFinopsTab();
  const lead = textOf(document.getElementById("provider-readiness-lead"));
  assert.match(lead, /static demo/i);
  assert.match(lead, /no credential is requested/i);
  assert.match(lead, /no provider account is connected/i);
  assert.match(lead, /no file is transmitted anywhere/i);
});

test("each download hands over a file the shipping recognition code accepts", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  for (const provider of PROVIDER_READINESS) {
    const button = document.querySelectorAll(".provider-readiness-download")
      .find((node) => node.dataset.provider === provider.id);
    button.click();
    const received = page.downloads.at(-1);
    assert.equal(received.filename, provider.sampleFilename);
    // The bytes the reader receives, through the code that reads their real
    // export. Nothing about this file is asserted twice in prose.
    const verdict = detectAndNormalizeExport(received.text);
    assert.equal(verdict.provider, provider.id,
      `the downloaded ${provider.id} sample must be recognized as ${provider.id}`);
  }
  assert.equal(page.downloads.length, PROVIDER_READINESS.length,
    "one click, one file, and no file generated before it was asked for");
});

test("the picker, its recognition, and the brief still behave as they did", async () => {
  const { document } = await openFinopsTab();
  // The existing three-row Bedrock path, unchanged by the section above it.
  const header = ["lineItem/UsageStartDate", "product/model_id", "lineItem/UsageAmount",
    "lineItem/UnblendedCost", "lineItem/CurrencyCode", "lineItem/UsageAccountId"];
  const rows = [["2026-07-20", "anthropic.claude-sonnet", "120000", "4.80", "USD", "000000000001"],
    ["2026-07-21", "anthropic.claude-sonnet", "45000", "0.90", "USD", "000000000001"],
    ["2026-07-22", "anthropic.claude-sonnet", "98000", "3.92", "USD", "000000000001"]];
  const input = document.getElementById("local-finops-files");
  assert.match(input.getAttribute("accept"), /\.csv/, "the picker still accepts the CSV exports");
  input.files = [{
    name: "bedrock-usage.csv",
    type: "text/csv",
    text: async () => `${[header, ...rows].map((row) => row.join(",")).join("\n")}\n`,
  }];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
  await waitFor(() => document.getElementById("local-export-activation").dataset.state === "ready",
    "the Bedrock export to reach the ready state through the unchanged import path");
  assert.match(textOf(document.getElementById("local-export-activation-status")),
    /AWS Bedrock export adapted locally/);
});
