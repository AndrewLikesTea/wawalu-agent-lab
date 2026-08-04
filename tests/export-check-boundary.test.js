// The promise the import section makes, held to the code that makes it (#1067).
//
// /evolution.html tells a reader that checking an export costs them nothing: it
// happens in their browser, it asks for no credential, it makes no request, and
// the file they drop is not kept. That sentence is the reason somebody drops a
// billing export on a page they have never used before, so it is worth more than
// prose — it is worth a test that would fail if the sentence stopped being true.
//
// This file drives the check-only path with a real dropped file and watches every
// way bytes could leave the tab or outlive it:
//
//   fetch, XMLHttpRequest, navigator.sendBeacon and any form submission are
//   replaced with recorders that also THROW, so a call cannot be swallowed by a
//   handler's catch and pass as silence; and
//
//   localStorage, sessionStorage and indexedDB are replaced with recorders, so a
//   write is caught by its call as well as by its contents. Every stored value is
//   then swept for any sixteen-character run of the dropped file, because a page
//   that keeps a "harmless" fragment of somebody's billing export has still kept
//   part of somebody's billing export.
//
// The dropped file is built here rather than committed, and every cell carries a
// sentinel so a run found in storage cannot be a coincidence.
//
// The statement itself is asserted twice over: as visible text in the import
// section that equals the contract constant exactly — so module and page cannot
// drift — and STRUCTURALLY, with no disclosure anywhere between it and the
// document. The harness reads text through a closed details element, so "the
// words are in the page" is not evidence that a person can see them.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { LOCAL_PROCESSING_STATEMENT } from "../src/provider-readiness-contract.js";
import { EXPORT_CHECK_IDS } from "../src/finops-export-check.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

// A recognizable Bedrock export whose every cell is unmistakably from this test.
// Recognizable on purpose: a refused file is a shorter code path, and the promise
// has to hold on the longer one.
const SENTINEL = "Q7SENTINELQ7";
const HEADER = ["lineItem/UsageStartDate", "product/model_id", "lineItem/UsageAmount",
  "lineItem/UnblendedCost", "lineItem/CurrencyCode", "lineItem/UsageAccountId"];
const ROWS = [
  ["2026-07-20", `anthropic.claude-sonnet-${SENTINEL}-a`, "120000", "4.80", "USD", `9911${SENTINEL}`],
  ["2026-07-21", `anthropic.claude-sonnet-${SENTINEL}-b`, "45000", "0.90", "USD", `9911${SENTINEL}`],
];
const DROPPED_TEXT = `${[HEADER, ...ROWS].map((row) => row.join(",")).join("\n")}\n`;
const DROPPED_NAME = `bedrock-${SENTINEL}.csv`;

/** Every sixteen-character run of the dropped file. Nothing this long is a coincidence. */
const RUN = 16;
function runsOf(text) {
  const runs = [];
  for (let start = 0; start + RUN <= text.length; start += 1) runs.push(text.slice(start, start + RUN));
  return runs;
}

/**
 * One recording store with the shape the page uses, delegating reads to whatever
 * the page already had so replacing it mid-flight changes nothing but visibility.
 */
function recordingStorage(inner = null, writes = []) {
  const values = new Map();
  return {
    writes,
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : inner?.getItem(key) ?? null),
    setItem(key, value) {
      writes.push({ key, value: String(value) });
      values.set(key, String(value));
      inner?.setItem(key, value);
    },
    removeItem(key) { values.delete(key); inner?.removeItem(key); },
    clear() { values.clear(); inner?.clear(); },
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

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

/**
 * Close every exit, AFTER the page has finished its own legitimate boot fixtures.
 * From this call on, any request, beacon, submission or storage write is the
 * check's, and every one of them is recorded before it is refused.
 */
function sealTheTab(page, t) {
  const escapes = [];
  const record = (channel, detail) => { escapes.push(`${channel}: ${detail}`); };
  const saved = {
    fetch: globalThis.fetch,
    XMLHttpRequest: globalThis.XMLHttpRequest,
    navigator: globalThis.navigator,
    sessionStorage: globalThis.sessionStorage,
    indexedDB: globalThis.indexedDB,
    localStorage: globalThis.localStorage,
  };

  const local = recordingStorage(page.storage);
  const session = recordingStorage(null);
  const define = (key, value) => Object.defineProperty(globalThis, key,
    { value, writable: true, configurable: true, enumerable: false });

  define("fetch", async (url) => {
    record("fetch", String(url));
    throw new Error(`the export check requested ${url}`);
  });
  define("XMLHttpRequest", class {
    open(method, url) { record("XMLHttpRequest", `${method} ${url}`); }
    send() { record("XMLHttpRequest", "send"); throw new Error("the export check sent an XHR"); }
    setRequestHeader() {}
  });
  define("navigator", {
    sendBeacon: (url) => { record("navigator.sendBeacon", String(url)); return false; },
  });
  define("localStorage", local);
  define("sessionStorage", session);
  define("indexedDB", {
    open: (name) => { record("indexedDB.open", String(name)); throw new Error("the export check opened a database"); },
    databases: async () => { record("indexedDB.databases", ""); return []; },
    deleteDatabase: (name) => { record("indexedDB.deleteDatabase", String(name)); },
  });

  // The last exit: a form submission navigates, which carries whatever is in the
  // form with it. Nothing in this zone is a form, and this is what says so.
  const onSubmit = (event) => record("form submit", event.target?.id ?? "form");
  page.document.addEventListener("submit", onSubmit);

  t.after(() => {
    page.document.removeEventListener("submit", onSubmit);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else define(key, value);
    }
  });
  return { escapes, local, session };
}

/** The check zone's own drop target — not the page-wide one, which commits. */
function dropOnCheckZone(document, file) {
  const event = new DomEvent("drop", { bubbles: true });
  event.dataTransfer = { files: [file] };
  document.getElementById(EXPORT_CHECK_IDS.zone).dispatchEvent(event);
}

// Descendant selectors throw in this harness, so ancestry is walked, never queried.
function ancestors(node) {
  const chain = [];
  for (let current = node.parentNode; current && current.nodeType === 1; current = current.parentNode) {
    chain.push(current);
  }
  return chain;
}

test("checking a dropped export sends nothing and keeps nothing", async (t) => {
  const page = await openFinopsTab();
  const { document } = page;
  const { escapes, local, session } = sealTheTab(page, t);

  dropOnCheckZone(document, {
    name: DROPPED_NAME,
    type: "text/csv",
    text: async () => DROPPED_TEXT,
  });
  await waitFor(() => document.getElementById(EXPORT_CHECK_IDS.zone).dataset.check === "recognized",
    "the dropped export to be recognized by the check-only path");

  // The verdict really was produced from this file, so the silence below is the
  // silence of a check that ran — not of one that never started.
  assert.match(textOf(document.getElementById(EXPORT_CHECK_IDS.answer)), /this export will analyze/i);
  assert.equal(document.getElementById(EXPORT_CHECK_IDS.continue).hidden, false);

  assert.deepEqual(escapes, [],
    `the check reached outside this tab: ${escapes.join(" | ")}`);
  assert.equal(page.navigations.length, 0, "the check must not navigate");
  assert.equal(page.downloads.length, 0, "the check must not hand back a file");

  // Nothing was written at all…
  assert.deepEqual(local.writes, [],
    `the check wrote to localStorage: ${local.writes.map(({ key }) => key).join(", ")}`);
  assert.deepEqual(session.writes, [],
    `the check wrote to sessionStorage: ${session.writes.map(({ key }) => key).join(", ")}`);

  // …and nothing anywhere in either store carries a run of the dropped file,
  // which is the claim that survives a future page deciding to keep a preference.
  const stored = [...local.values.entries(), ...session.values.entries()]
    .map(([key, value]) => `${key} ${value}`);
  for (const run of runsOf(DROPPED_TEXT)) {
    const held = stored.find((entry) => entry.includes(run));
    assert.equal(held, undefined, `browser storage retained "${run}" from the dropped file`);
  }
  assert.equal(stored.filter((entry) => entry.includes(SENTINEL)).length, 0,
    "browser storage retained a value carrying the dropped file's sentinel");
  assert.equal(stored.filter((entry) => entry.includes(DROPPED_NAME)).length, 0,
    "browser storage retained the dropped file's name");
});

test("the import section states the boundary in the open, in the contract's own words", async () => {
  const { document } = await openFinopsTab();
  const statement = document.getElementById(EXPORT_CHECK_IDS.boundary);

  // Word for word: a page that reworded the promise would drift from the module
  // that makes it, and only one of the two would be reviewed.
  assert.equal(textOf(statement), LOCAL_PROCESSING_STATEMENT);
  // And what it has to say, so a future edit to the constant cannot quietly drop
  // one of the three claims this section is trusted on.
  assert.match(LOCAL_PROCESSING_STATEMENT, /no network request/i);
  assert.match(LOCAL_PROCESSING_STATEMENT, /no credential/i);
  assert.match(LOCAL_PROCESSING_STATEMENT, /not retained/i);

  // Visible page text of the import section, not a node in isolation.
  assert.ok(textOf(document.getElementById("local-import")).includes(LOCAL_PROCESSING_STATEMENT),
    "the statement must read as part of the import section");

  const chain = ancestors(statement);
  assert.equal(chain.filter(({ tagName }) => tagName === "DETAILS" || tagName === "SUMMARY").length, 0,
    "the statement must never sit inside a disclosure");
  assert.equal(chain.filter((node) => node.hidden === true).length, 0,
    "nothing above the statement may hide it");
  assert.equal(statement.hidden, false, "the statement itself must never ship hidden");
  assert.equal(statement.getAttribute("aria-hidden"), null,
    "the statement must be readable by assistive technology too");
  assert.equal(statement.getAttribute("title"), null, "the statement must not be a tooltip");
  // In the import section, and inside the check zone it describes.
  assert.equal(chain.filter(({ id }) => id === EXPORT_CHECK_IDS.zone).length, 1);
  assert.equal(chain.filter(({ id }) => id === "local-import").length, 1);
});
