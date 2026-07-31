// Corrections that survive a reload, and the proof that nothing else does.
//
// Six claims, every page-driven one made against the shipped markup and the
// shipped entry module rather than against a re-implementation of the wiring:
//
//   1. The stored artifact is one key holding four fields, and the values that
//      identify the reader's export — the org unit, the model, the date — are
//      not in the serialized string. The forbidden strings are read out of the
//      fixture the page actually analyzed, so a regression in the shape fails
//      here rather than passing against a guess.
//   2. Label, reload, same export: the labels come back and the coverage figure
//      the region publishes reflects them.
//   3. Label, reload, a store written for a different export — or for clusters
//      this corpus does not have, or by the other hash mode: ignored, the
//      figure is the uncorrected one, and the stored key is still there,
//      because only the reader's own control deletes anything.
//   4. The whole path opens no request and reaches no new origin.
//   5. Storage that throws on read, and storage that throws on write: the
//      correction still moves the figure and the panel says it will not last.
//   6. The clear control empties the key, resets the figure and announces it.
//
// The harness's `<select>` accepts values a real one would refuse, so every
// assertion below is on state a reader would see — the coverage sentence, the
// panel's text, the bytes under the key — and never on "the handler ran".

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { DomEvent, loadPage, pressEnter, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  HASH_MODE, OVERRIDE_CLEARED_ANNOUNCEMENT, OVERRIDE_CLEAR_LABEL, OVERRIDE_RETENTION_TEXT,
  OVERRIDE_UNAVAILABLE_NOTICE, QUERY_OVERRIDE_KEY, QUERY_OVERRIDE_SCHEMA,
  fallbackDigest, hashText, readOverrides, writeOverrides,
} from "../src/query-override-store.js";
import {
  ORG_COACHING_BODY_ID, ORG_COACHING_LIVE_ID, ORG_COACHING_RESIDUE_ID, RESIDUE_CLEAR_ID,
  panelId, residueControlId, toggleId,
} from "../src/org-query-decision-view.js";
import { loadExampleOrgQuerySample } from "../src/org-query-example.js";
import { orgQuerySampleResult } from "../src/org-query-source.js";
import { PROMPT_LITERACY_RUBRIC } from "../src/prompt-literacy-scoring.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const FIRST_CLASS = PROMPT_LITERACY_RUBRIC.categories[0].key;
const CLASS_KEYS = new Set(PROMPT_LITERACY_RUBRIC.categories.map((category) => category.key));

/** The corpus the page grades on this path, read here for the forbidden strings. */
const EXAMPLE_RECORDS = orgQuerySampleResult(loadExampleOrgQuerySample()).records;

/** The coverage the bundled example earns with no label on it. */
const UNASSISTED = "96.4%";
/** …and with the first residue cluster labelled. */
const ASSISTED = "99.4%";

/* -------------------------------- the module -------------------------------- */

test("one text digests to one string, in whichever mode the origin allows", async () => {
  const first = await hashText("Billed model · acme-sonnet-1");
  const again = await hashText("Billed model · acme-sonnet-1");
  assert.equal(first.mode, HASH_MODE.digest);
  assert.match(first.hex, /^[0-9a-f]{64}$/);
  assert.equal(first.hex, again.hex, "the same text must digest to the same string");
  assert.notEqual(first.hex, (await hashText("Billed model · acme-opus-1")).hex);

  // An insecure origin has no `crypto.subtle`. The digest is still stable, still
  // one-way in the sense that matters here, and — critically — carries a
  // different mode, so a store written by one is never read by the other.
  const insecure = await hashText("Billed model · acme-sonnet-1", { scope: { crypto: {} } });
  assert.equal(insecure.mode, HASH_MODE.fallback);
  assert.equal(insecure.hex, fallbackDigest("Billed model · acme-sonnet-1"));
  assert.notEqual(insecure.hex, first.hex);
  // A refusing SubtleCrypto is the same situation, and must not reject.
  const refusing = await hashText("x", { scope: { crypto: { subtle: {
    digest: () => Promise.reject(new Error("insecure origin")),
  } } } });
  assert.equal(refusing.mode, HASH_MODE.fallback);
});

test("a store from another export, schema, or hash mode reads as no entries and is kept", () => {
  const stored = {
    v: QUERY_OVERRIDE_SCHEMA,
    hash: HASH_MODE.digest,
    export: "a".repeat(64),
    labels: { ["b".repeat(64)]: FIRST_CLASS },
  };
  const storage = { getItem: () => JSON.stringify(stored), setItem() {}, removeItem() {} };
  assert.equal(readOverrides(storage, { fingerprint: "a".repeat(64), mode: HASH_MODE.digest })
    .entries.size, 1);
  for (const [reason, scope] of [
    ["other_export", { fingerprint: "c".repeat(64), mode: HASH_MODE.digest }],
    ["other_hash_mode", { fingerprint: "a".repeat(64), mode: HASH_MODE.fallback }],
  ]) {
    const outcome = readOverrides(storage, scope);
    assert.equal(outcome.reason, reason);
    assert.equal(outcome.entries.size, 0, `${reason} must yield nothing`);
    assert.equal(outcome.available, true, "a mismatch is not a broken store");
  }
  // A read that throws is reported, not raised, and reports as unavailable.
  const blocked = readOverrides({ getItem() { throw new Error("partitioned"); } }, {});
  assert.equal(blocked.available, false);
  assert.equal(blocked.entries.size, 0);
  // A write with no fingerprint is refused rather than stored unscoped.
  assert.equal(writeOverrides(storage, { mode: HASH_MODE.digest, entries: [] }).ok, false);
  // A full quota is an outcome, not an exception.
  assert.equal(writeOverrides({ setItem() { throw new Error("quota"); } }, {
    fingerprint: "a".repeat(64), mode: HASH_MODE.digest, entries: [],
  }).reason, "storage_refused");
});

/* -------------------------------- the page ---------------------------------- */

const body = (document) => document.getElementById(ORG_COACHING_BODY_ID);
const live = (document) => document.getElementById(ORG_COACHING_LIVE_ID);
const residueToggle = (document) => document.getElementById(toggleId(ORG_COACHING_RESIDUE_ID));
const residuePanel = (document) => document.getElementById(panelId(ORG_COACHING_RESIDUE_ID));
const coverageText = (document) =>
  textOf(body(document).querySelector(".org-coaching-coverage-text"));
const retentionBlock = (document) =>
  residuePanel(document)?.querySelector(".org-coaching-residue-retention") ?? null;

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

/** Grade the bundled query sample and open the review the labels are made in. */
function openReview(document) {
  document.getElementById("grade-example-org-query-sample").click();
  const toggle = residueToggle(document);
  if (toggle.getAttribute("aria-expanded") === "false") toggle.click();
  return residuePanel(document);
}

function labelFirstCluster(document, value = FIRST_CLASS) {
  const select = document.getElementById(residueControlId(1));
  select.value = value;
  select.dispatchEvent(new DomEvent("change", { bubbles: true }));
  return select;
}

/** Label one cluster on a fresh tab and hand back what this browser kept. */
async function storedAfterOneCorrection() {
  const page = await openFinopsTab();
  openReview(page.document);
  labelFirstCluster(page.document);
  assert.equal(coverageText(page.document).startsWith(ASSISTED), true,
    `the label must move the figure before anything is stored: ${coverageText(page.document)}`);
  const raw = await waitFor(() => page.storage.getItem(QUERY_OVERRIDE_KEY),
    "the correction to reach this browser's storage");
  page.restore();
  return raw;
}

test("what is stored is four fields of digests, and none of the export's own values", async () => {
  const raw = await storedAfterOneCorrection();
  const payload = JSON.parse(raw);
  assert.deepEqual(Object.keys(payload).sort(), ["export", "hash", "labels", "v"]);
  assert.equal(payload.v, QUERY_OVERRIDE_SCHEMA);
  assert.equal(payload.hash, HASH_MODE.digest);
  assert.match(payload.export, /^[0-9a-f]{64}$/);
  const labels = Object.entries(payload.labels);
  assert.equal(labels.length, 1);
  for (const [key, label] of labels) {
    assert.match(key, /^[0-9a-f]{64}$/, "a stored key is a digest and nothing else");
    assert.ok(CLASS_KEYS.has(label), "a stored value is a rubric class the reader chose");
  }

  // The negative half, read out of the corpus the page just graded rather than
  // guessed: the org unit, the model and the date are what a leaked row would be
  // recognizable by, and none of them may appear anywhere in the string.
  const forbidden = new Set();
  for (const record of EXAMPLE_RECORDS) {
    for (const value of [record.orgUnitId, record.model, record.queryDate, record.promptExcerpt]) {
      if (typeof value === "string" && value.length > 2) forbidden.add(value);
    }
    // Spend-proportional figures: the only numbers this corpus carries.
    for (const value of [record.inputTokens, record.outputTokens]) {
      if (Number.isFinite(value)) forbidden.add(String(value));
    }
  }
  assert.ok(forbidden.size > 10, "the fixture must actually supply values to look for");
  for (const value of forbidden) {
    // Token counts are short digit runs that a hex digest can contain by
    // coincidence, so they are checked against the digest-free part of the
    // payload. The digests themselves are already pinned to /^[0-9a-f]{64}$/.
    const searched = /^\d+$/.test(value)
      ? JSON.stringify({ v: payload.v, hash: payload.hash, labels: Object.values(payload.labels) })
      : raw;
    assert.equal(searched.includes(value), false, `the stored payload leaked ${value}`);
  }
});

test("a correction survives a reload of the same export and moves the figure again", async () => {
  const raw = await storedAfterOneCorrection();
  const { document } = await openFinopsTab({ [QUERY_OVERRIDE_KEY]: raw });
  openReview(document);
  // The first paint is the uncorrected one — the digest is asynchronous — and
  // the restore lands on top of it. What matters is where the reader ends up.
  await waitFor(() => coverageText(document).startsWith(ASSISTED),
    `the restored label to move the figure back to ${ASSISTED}`);
  assert.equal(document.getElementById(residueControlId(1)).value, FIRST_CLASS,
    "the control shows the class the reader chose, not an empty one");
  const marker = body(document).querySelector(".org-coaching-assist");
  assert.equal(marker.dataset.labelCount, "1");
  assert.match(textOf(marker), /Your export alone: 96\.4%/,
    "the unassisted reading stays recoverable beside the restored one");
});

test("a store written for a different export, corpus or hash mode is ignored, not applied",
  async () => {
    const raw = await storedAfterOneCorrection();
    const payload = JSON.parse(raw);
    const foreignDigest = (await hashText("a-vendor-this-corpus-never-had")).hex;
    const cases = [
      ["another export's fingerprint", { ...payload, export: foreignDigest }],
      ["clusters this corpus does not have", { ...payload, labels: { [foreignDigest]: FIRST_CLASS } }],
      ["the other hash mode", { ...payload, hash: HASH_MODE.fallback }],
      ["a schema this page does not publish", { ...payload, v: QUERY_OVERRIDE_SCHEMA + 1 }],
    ];
    for (const [name, stored] of cases) {
      const serialized = JSON.stringify(stored);
      const page = await openFinopsTab({ [QUERY_OVERRIDE_KEY]: serialized });
      openReview(page.document);
      // Settle every pending digest, then read the figure: a late restore that
      // applied a stale label would have landed by now.
      await waitFor(() => retentionBlock(page.document), "the retention block to paint");
      await waitFor(() => coverageText(page.document).startsWith(UNASSISTED), `${name}: baseline`);
      assert.equal(page.document.getElementById(residueControlId(1)).value, "",
        `${name}: no cluster may show a restored class`);
      assert.equal(body(page.document).querySelectorAll(".org-coaching-assist").length, 0,
        `${name}: no figure may claim a lead-supplied label`);
      // Ignored is not deleted: the reader may go back to the export it belongs to.
      assert.equal(page.storage.getItem(QUERY_OVERRIDE_KEY), serialized,
        `${name}: a mismatched store must be left exactly as it was`);
      page.restore();
    }
  });

test("the correction path opens no request and reaches no new origin", async () => {
  const page = await openFinopsTab();
  const inner = globalThis.fetch;
  const requests = [];
  Object.defineProperty(globalThis, "fetch", {
    value: (...args) => { requests.push(String(args[0])); return inner(...args); },
    writable: true, configurable: true,
  });
  let sockets = 0;
  for (const key of ["XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon"]) {
    Object.defineProperty(globalThis, key, {
      value: function Refused() { sockets += 1; }, writable: true, configurable: true,
    });
  }
  try {
    openReview(page.document);
    labelFirstCluster(page.document);
    await waitFor(() => page.storage.getItem(QUERY_OVERRIDE_KEY), "the correction to be stored");
    page.document.getElementById(RESIDUE_CLEAR_ID).click();
    await waitFor(() => page.storage.getItem(QUERY_OVERRIDE_KEY) === null, "the clear to land");
    assert.deepEqual(requests, [], "correcting and persisting must open no request");
    assert.equal(sockets, 0, "no transport of any kind is constructed on this path");
  } finally {
    Object.defineProperty(globalThis, "fetch", { value: inner, writable: true, configurable: true });
    page.restore();
  }
});

/**
 * A store that refuses one operation on one key, which is what a partitioned or
 * a full `localStorage` looks like from inside the page. Only this feature's key
 * is refused, so the failure under test is this feature's and not the page's.
 */
function refuse(page, operation) {
  const inner = page.storage[operation].bind(page.storage);
  page.storage[operation] = (key, value) => {
    if (key === QUERY_OVERRIDE_KEY) throw new Error(`${operation} refused`);
    return inner(key, value);
  };
}

for (const operation of ["getItem", "setItem"]) {
  test(`storage throwing on ${operation}: the correction holds and the panel says why`,
    async () => {
      const page = await loadPage(PAGE, {
        routes: {
          "/evolution-demo-data.json": DEMO_DATA,
          "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
        },
      });
      refuse(page, operation);
      await importPageModule("/evolution-page.js");
      const { document } = page;
      await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
        "the bundled analysis to finish rendering");

      openReview(document);
      labelFirstCluster(document);
      // The correction is a correction whatever storage did with it.
      assert.equal(coverageText(document).startsWith(ASSISTED), true,
        `the figure must still move: ${coverageText(document)}`);
      await waitFor(() => retentionBlock(document)?.dataset.storage === "unavailable",
        "the panel to report that this browser would not keep the corrections");
      const notice = retentionBlock(document).querySelector(".org-coaching-residue-retention-notice");
      assert.equal(textOf(notice), OVERRIDE_UNAVAILABLE_NOTICE);
      assert.equal(notice.getAttribute("role"), "note", "a notice, not an interruption");
      // Non-blocking: the control the reader was using is still there and usable.
      assert.equal(residuePanel(document).hidden, false);
      assert.equal(document.getElementById(residueControlId(1)).value, FIRST_CLASS);
      page.restore();
    });
}

test("the panel states what is kept, and the clear control empties it from the keyboard",
  async () => {
    const raw = await storedAfterOneCorrection();
    const page = await openFinopsTab({ [QUERY_OVERRIDE_KEY]: raw });
    const { document } = page;
    openReview(document);
    await waitFor(() => coverageText(document).startsWith(ASSISTED), "the restored figure");

    // One panel, not two: the claim and the control are at the foot of the same
    // disclosure the labels are made in.
    const block = retentionBlock(document);
    assert.equal(document.querySelectorAll(".org-coaching-residue-retention").length, 1);
    const text = textOf(block.querySelector(".org-coaching-residue-retention-text"));
    assert.equal(text, OVERRIDE_RETENTION_TEXT);
    assert.match(text, /one-way hash/, "it must say what is kept");
    assert.match(text, /in this browser only/, "it must say what browser keeps it");
    assert.match(text, /never (?:written|sent) anywhere|ever sent anywhere/,
      "it must say it never leaves the browser");
    assert.match(text, /query text[^.]*never written/, "it must say prompt text is never written");
    assert.match(text, /spend figures/, "it must say spend figures are never written");
    assert.equal(block.dataset.storage, "available");

    const clear = document.getElementById(RESIDUE_CLEAR_ID);
    assert.equal(clear.tagName, "BUTTON", "a real button, keyboard-operable because it is one");
    assert.equal(clear.getAttribute("type"), "button");
    assert.equal(textOf(clear), OVERRIDE_CLEAR_LABEL);

    clear.focus();
    pressEnter(document);

    assert.equal(page.storage.getItem(QUERY_OVERRIDE_KEY), null, "the key is emptied");
    assert.equal(coverageText(document).startsWith(UNASSISTED), true,
      `the figure returns to the uncorrected reading: ${coverageText(document)}`);
    assert.equal(body(document).querySelectorAll(".org-coaching-assist").length, 0,
      "no figure still claims a lead-supplied label");
    assert.equal(document.getElementById(residueControlId(1)).value, "");
    // Announced where every other recompute on this region is announced.
    assert.match(live(document).textContent, /cleared from this browser/);
    assert.ok(live(document).textContent.includes(OVERRIDE_CLEARED_ANNOUNCEMENT));
    // And the keyboard is where the reader left it.
    assert.equal(document.activeElement?.id, RESIDUE_CLEAR_ID);
    page.restore();
  });
