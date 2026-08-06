// Opening a shared brief on /evolution.html (#1207), driven through the real
// page entry. Nothing between the file and the read-only region is stubbed.
//
// What only this file can catch: that the SHIPPED sample opens in the SHIPPED
// markup, that each of the three refusal classes shows its named reason and
// leaves NO brief content on screen, that a brief carrying markup is read as
// text, and that opening somebody else's brief writes nothing into the
// recipient's own retained records.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { SHARED_BRIEF_IDS } from "../src/finops-shared-brief-view.js";
import { FINOPS_WORKSPACE_KEY, FINOPS_WORKSPACE_VERSION } from "../src/finops-workspace-contract.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));
/** The file a recipient is actually handed: the one checked into the product. */
const SAMPLE = await readFile(new URL("../src/finops-shared-brief-sample.json", import.meta.url), "utf8");

async function openFinopsTab(storage = {}) {
  const page = await loadPage(PAGE, {
    storage,
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

/** Hand the shared-brief picker one file. The browser's File API, nothing else. */
function chooseBrief(document, text) {
  const input = document.getElementById(SHARED_BRIEF_IDS.input);
  input.files = [{
    name: "shared-brief.json", type: "application/json", size: text.length,
    text: async () => text,
  }];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

const shown = (document, id) => textOf(document.getElementById(id));

/** Wait for the region to settle on one state, so no read is mid-flight. */
const settles = (document, state) =>
  waitFor(() => document.getElementById(SHARED_BRIEF_IDS.region).dataset.state === state,
    `the shared brief region to reach "${state}"`);

/**
 * Nothing of a brief is on screen. Counted and read, never compared to null:
 * a null comparison against this harness's elements walks the whole page.
 */
function nothingRendered(document) {
  const region = document.getElementById(SHARED_BRIEF_IDS.region);
  assert.equal(region.hidden, true, "a refused brief must not leave its region on screen");
  assert.equal(region.dataset.state, "empty");
  for (const id of [SHARED_BRIEF_IDS.produced, SHARED_BRIEF_IDS.figure, SHARED_BRIEF_IDS.action,
    SHARED_BRIEF_IDS.confidence, SHARED_BRIEF_IDS.provenance]) {
    assert.equal(shown(document, id), "", `${id} still carries a refused brief's content`);
  }
  assert.equal(document.getElementById(SHARED_BRIEF_IDS.limits).querySelectorAll("li").length, 0);
}

test("the sample brief shipped with the product opens read-only in the page", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  chooseBrief(document, SAMPLE);
  await settles(document, "open");

  assert.equal(document.getElementById(SHARED_BRIEF_IDS.region).hidden, false);
  // The figure, the action, the grade, the provenance, and every Limit.
  assert.match(shown(document, SHARED_BRIEF_IDS.figure), /Analyzed AI spend: 4,128\.00 USD/);
  assert.match(shown(document, SHARED_BRIEF_IDS.action), /Route the identified workload/);
  assert.match(shown(document, SHARED_BRIEF_IDS.action), /746\.00 USD a month/);
  assert.match(shown(document, SHARED_BRIEF_IDS.confidence), /Moderate confidence — coverage 95\.6%/);
  assert.equal(document.getElementById(SHARED_BRIEF_IDS.confidence).dataset.grade, "moderate");
  assert.match(shown(document, SHARED_BRIEF_IDS.provenance), /sender's own analyzed export, 2026-06, 4894 records/);
  assert.match(shown(document, SHARED_BRIEF_IDS.produced), /their analysis, not yours/);

  const limits = document.getElementById(SHARED_BRIEF_IDS.limits).querySelectorAll("li");
  assert.deepEqual(limits.map((node) => node.dataset.limit), ["locality", "coverage", "attribution"]);
  assert.match(textOf(limits[0]), /read in your browser only/);
  // And the recipient is told, in the label, that this is not their record.
  const label = document.querySelectorAll("label")
    .find((node) => node.getAttribute("for") === SHARED_BRIEF_IDS.input);
  assert.match(textOf(label), /Open a shared brief someone sent you/);
});

test("malformed JSON is refused by name, with nothing of a brief rendered", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  chooseBrief(document, '{"schemaVersion": 1, "figure":');
  await waitFor(() => !document.getElementById(SHARED_BRIEF_IDS.error).hidden,
    "the refusal to be shown");

  const error = document.getElementById(SHARED_BRIEF_IDS.error);
  assert.equal(error.dataset.reason, "not_readable_json");
  assert.match(textOf(error), /not readable as a shared brief/);
  assert.match(textOf(error), /send the brief file again/);
  nothingRendered(document);
});

test("a newer schemaVersion is refused, and the reason names the version", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  chooseBrief(document, JSON.stringify({ ...JSON.parse(SAMPLE), schemaVersion: 9 }));
  await waitFor(() => !document.getElementById(SHARED_BRIEF_IDS.error).hidden,
    "the refusal to be shown");

  const error = document.getElementById(SHARED_BRIEF_IDS.error);
  assert.equal(error.dataset.reason, "unsupported_schema_version");
  assert.match(textOf(error), /declares schemaVersion 9/);
  assert.match(textOf(error), /reads schemaVersion 1/);
  assert.match(textOf(error), /after the site next updates|export the brief again/);
  nothingRendered(document);
});

test("a missing Limits disclosure is refused, and the reason names the disclosure", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  const brief = JSON.parse(SAMPLE);
  chooseBrief(document, JSON.stringify({
    ...brief, limits: brief.limits.filter((limit) => limit.id !== "attribution"),
  }));
  await waitFor(() => !document.getElementById(SHARED_BRIEF_IDS.error).hidden,
    "the refusal to be shown");

  const error = document.getElementById(SHARED_BRIEF_IDS.error);
  assert.equal(error.dataset.reason, "required_field_missing");
  assert.match(textOf(error), /missing the "attribution" Limits disclosure/);
  nothingRendered(document);
});

test("markup-shaped text is read as characters, and an unknown field is not rendered", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  const brief = JSON.parse(SAMPLE);
  chooseBrief(document, JSON.stringify({
    ...brief,
    senderNote: "a field this build does not know",
    // Real tag syntax is refused OUTRIGHT by the envelope — asserted in
    // tests/finops-shared-brief-envelope.test.js — so what reaches the view is
    // the lookalike, and the view still has to hand it over as characters.
    figure: { ...brief.figure, label: "Analyzed AI spend [b]big[/b] & co" },
  }));
  await settles(document, "open");

  // Verbatim, whole string: nothing was parsed, nothing was unescaped.
  assert.equal(shown(document, SHARED_BRIEF_IDS.figure),
    "Analyzed AI spend [b]big[/b] & co: 4,128.00 USD");
  // The unknown field was dropped by the validator; nothing on screen quotes it.
  assert.doesNotMatch(textOf(document.getElementById(SHARED_BRIEF_IDS.region)),
    /a field this build does not know/);
});

test("opening a shared brief leaves the reader's own retained records untouched", async () => {
  const seeded = JSON.stringify({
    schemaVersion: FINOPS_WORKSPACE_VERSION,
    consent: {
      state: "granted", decidedAt: "2026-07-28T09:00:00.000Z",
      grantedAgainst: FINOPS_WORKSPACE_VERSION,
    },
    periods: [], commitments: [],
    meta: { lastWriteAt: "2026-07-28T09:00:00.000Z" },
  });
  const page = await openFinopsTab({ [FINOPS_WORKSPACE_KEY]: seeded });
  const { document } = page;
  // The recipient's own retained records, exported the way the workspace holds
  // them, plus the count of keys so a NEW key would show up too.
  const exported = () => `${page.storage.length} ${page.storage.getItem(FINOPS_WORKSPACE_KEY)}`;
  const before = exported();

  chooseBrief(document, SAMPLE);
  await settles(document, "open");
  assert.equal(exported(), before,
    "opening somebody else's brief wrote into this browser's own records");

  // A refusal writes nothing either.
  chooseBrief(document, "{ not json");
  await waitFor(() => !document.getElementById(SHARED_BRIEF_IDS.error).hidden,
    "the refusal to be shown");
  assert.equal(exported(), before);
});
