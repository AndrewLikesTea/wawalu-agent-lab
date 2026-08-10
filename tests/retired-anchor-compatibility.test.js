import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  CONSOLIDATED_REGION_ALIAS, REGION_ALIAS, RETIRED_ANCHOR_TARGETS,
  canonicalRegionId, forwardRetiredAnchor,
} from "../src/retired-anchor-compatibility.js";
import { ANSWER_SPINE, ROLE } from "../src/finops/answer-spine-view.js";
import { WORKSPACE_DESTINATION } from "../src/finops-workspace-nav.js";
import { destinationForFragment } from "../src/finops-workspace-shell.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const DEMO = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url)));
const EVALUATION = JSON.parse(await readFile(
  new URL("../src/finops-evaluation-fixtures.json", import.meta.url)));

test("every retired summary-region anchor maps to its live successor", () => {
  const retired = ANSWER_SPINE.filter((entry) => entry.role === ROLE.retired);
  assert.ok(retired.length > 0);
  assert.deepEqual(RETIRED_ANCHOR_TARGETS,
    Object.fromEntries(retired.map((entry) => [entry.id, entry.supersededBy])));
  for (const entry of retired) {
    const win = { location: { hash: `#${entry.id}` }, history: { replaceState(_state, _title, hash) {
      win.location.hash = hash;
    } } };
    assert.equal(forwardRetiredAnchor(win), entry.supersededBy);
    assert.equal(win.location.hash, `#${entry.supersededBy}`);
  }
});

test("a cold deep link is forwarded by the shipped evolution entry", async (t) => {
  const page = await loadPage(PAGE, {
    location: { hash: "#finops-first-run-conversion" },
    routes: {
      "/evolution-demo-data.json": DEMO,
      "/finops-evaluation-fixtures.json": EVALUATION,
    },
  });
  t.after(page.restore);
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready", "page ready");
  await waitFor(() => page.document.getElementById("finops-evaluation-result")
    .getAttribute("aria-busy") === "false", "evaluation settled");
  await waitFor(() => page.document.getElementById("integration-contract-provenance")
    .textContent.trim().startsWith("Gateway completed"), "static gateway settled");
  assert.equal(window.location.hash, "#finops-contact");
  assert.ok(page.document.getElementById("finops-contact"));
});

test("unknown fragments are left untouched", () => {
  const win = { location: { hash: "#local-import" } };
  assert.equal(forwardRetiredAnchor(win), null);
  assert.equal(win.location.hash, "#local-import");
});

// ---------------------------------------------------------------------------
// #1500. A link saved BEFORE the FinOps consolidation.
//
// The consolidation merged three sibling readiness disclosures into one and
// folded the readiness region inside the canonical answer. Nothing the answer
// spine calls a region was deleted, so the manifest-derived map above says
// nothing about any of it — which is why the alias below is written out by hand
// rather than inferred. These tests hold the map to the shipped document: a key
// that is still authored on the page is not retired, and a value that is not
// authored on the page is a link to nowhere with extra steps.
// ---------------------------------------------------------------------------

test("every consolidation alias names markup that is gone and one that is not", () => {
  assert.ok(Object.keys(CONSOLIDATED_REGION_ALIAS).length > 0,
    "the map is declared because the consolidation retired ids; keep it honest");
  assert.deepEqual(Object.keys(CONSOLIDATED_REGION_ALIAS),
    [...Object.keys(CONSOLIDATED_REGION_ALIAS)].sort(),
    "the map is declared sorted so a later addition lands where a reader looks");

  const document = parseHtml(html);
  for (const [retired, surviving] of Object.entries(CONSOLIDATED_REGION_ALIAS)) {
    assert.equal(html.includes(`id="${retired}"`), false,
      `${retired} is aliased away but is still authored in evolution.html`);
    assert.ok(document.getElementById(surviving),
      `${retired} points at #${surviving}, which is not on the page`);
    // One indirection only. A value that is itself a key would make the two
    // entry points disagree about how many hops to take.
    assert.equal(canonicalRegionId(surviving), null,
      `#${surviving} is both an alias target and an alias key`);
  }
  // The manifest's retirements are still in the merged map the callers read.
  for (const [retired, surviving] of Object.entries(RETIRED_ANCHOR_TARGETS)) {
    assert.equal(REGION_ALIAS[retired], surviving);
  }
});

test("a pre-consolidation share link resolves to the canonical answer region", () => {
  const document = parseHtml(html);
  for (const retired of Object.keys(CONSOLIDATED_REGION_ALIAS)) {
    // Entry point one: the share-link/hash target path. Before this map the
    // fragment named no element, so the shell read it as "not ours" and left
    // the reader on whatever screen they were already looking at.
    assert.equal(destinationForFragment(document, `#${retired}`),
      WORKSPACE_DESTINATION.answer,
      `#${retired} does not open the canonical answer`);

    // Entry point two: the restore path. A reload of that same address rewrites
    // it to the surviving id in place, so the deep-link disclosure that runs
    // after it lands the reader on a region that exists.
    const win = { location: { hash: `#${retired}` }, history: { replaceState(_s, _t, hash) {
      win.location.hash = hash;
    } } };
    assert.equal(forwardRetiredAnchor(win), CONSOLIDATED_REGION_ALIAS[retired]);
    assert.equal(win.location.hash, `#${CONSOLIDATED_REGION_ALIAS[retired]}`);
    // Idempotent: the rewritten address is not itself rewritten again.
    assert.equal(forwardRetiredAnchor(win), null);
  }
});

test("an unknown or garbage id falls back cleanly instead of throwing", () => {
  const document = parseHtml(html);
  const junk = ["", "#", "#not-a-region-anyone-shipped", "#%E0%A4%A", "#../../etc/passwd",
    "#constructor", "#__proto__", "#toString"];
  for (const hash of junk) {
    assert.equal(destinationForFragment(document, hash), null,
      `${hash} was read as a destination`);
    const win = { location: { hash }, history: { replaceState() {
      throw new Error("an unknown fragment must not be rewritten");
    } } };
    assert.equal(forwardRetiredAnchor(win), null, `${hash} was forwarded somewhere`);
    assert.equal(win.location.hash, hash, `${hash} was rewritten`);
  }
  // Not a string, and the prototype chain is not a lookup table.
  for (const value of [null, undefined, 0, {}, []]) {
    assert.equal(canonicalRegionId(value), null);
  }
});

test("the answer a pre-consolidation link lands on still carries the three "
  + "figures a reload has to preserve", () => {
  const document = parseHtml(html);
  // Step 4 of #1500 is a confirmation, not machinery: the consolidation kept
  // all three, so this asserts they are still authored inside the canonical
  // answer that an aliased link now opens, next to the one canonical figure.
  const survivors = {
    "retained period": "finops-track-record",
    "declared pricing provenance": "finops-recoverable-provenance",
    "earned grade": "finops-recoverable-grade",
    "the canonical figure they qualify": "finops-recoverable-value",
  };
  for (const [what, id] of Object.entries(survivors)) {
    assert.ok(document.getElementById(id), `${what} lost #${id} in the consolidation`);
  }
  // And the region every one of them is read against is the destination an
  // aliased fragment resolves to, so "it survived" and "the reader can see it"
  // are the same statement.
  for (const id of Object.values(survivors)) {
    assert.equal(destinationForFragment(document, `#${id}`), WORKSPACE_DESTINATION.answer,
      `#${id} is no longer read on the canonical answer screen`);
  }
});
