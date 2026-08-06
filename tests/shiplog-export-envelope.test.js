// The export file describes itself, and the importer holds it to that.
//
// tests/shiplog-export.test.js owns what the exporter writes and
// tests/shiplog-import.test.js owns what the importer accepts. This file owns
// the contract *between* them: a file states its schema, its instant, the
// surface that wrote it, and how many records of each kind it carries — and a
// file whose claims disagree with its own records is refused whole, with the
// browser's existing records left exactly as they were.
//
// The refusals are asserted on counts, text, and attributes. Nothing here
// asserts that a queried node is null.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EXPORT_SOURCES,
  SHIPLOG_EXPORT_SCHEMA,
  SHIPLOG_EXPORT_VERSION,
  buildShiplogExport,
  createShiplogExport,
  shiplogExportFilename,
} from "../src/shiplog-export.js";
import {
  commitShiplogImport,
  formatImportSummary,
  initShiplogImport,
  parseImport,
  prepareShiplogImport,
} from "../src/shiplog-import.js";
import { shiplogExportViolations } from "../src/shiplog-export-schema.js";
import { STORAGE_KEY, loadDecisions } from "../src/app.js";
import { RELEASE_STORAGE_KEY, loadReleases } from "../src/releases.js";
import { installDocument } from "./support/dom.js";

installDocument();

const GENERATED_AT = "2026-07-26T18:30:00.000Z";

const DECISIONS = [
  {
    id: "d-queue", title: "Use a durable queue", context: "Jobs were lost",
    alternatives: "Database polling", owner: "Rowan", status: "accepted",
    createdAt: "2026-07-23T10:00:00.000Z",
  },
  {
    id: "d-cache", title: "Cache at the edge", context: "Latency was high",
    alternatives: "Regional proxy", owner: "Mina", status: "approved",
    createdAt: "2026-07-24T10:00:00.000Z",
  },
  {
    id: "d-tokens", title: "Rotate to short-lived tokens", context: "Static keys never expire",
    alternatives: "Manual rotation", owner: "Priya", status: "proposed",
    createdAt: "2026-07-25T10:00:00.000Z",
  },
];

// The order inside `decisionIds` is content the release recorded, and it is the
// thing the round trip has to preserve: "cache then queue" is not "queue then
// cache" to anybody reading the release.
const RELEASES = [
  {
    id: "r-1-0-0", version: "v1.0.0", title: "Queue launch",
    createdAt: "2026-07-26T09:00:00.000Z",
    decisionIds: ["d-cache", "d-queue"],
  },
  {
    id: "r-1-1-0", version: "v1.1.0", owner: "Priya", status: "planned",
    createdAt: "2026-07-26T10:00:00.000Z",
    decisionIds: ["d-tokens"],
  },
];

function memoryStorage(values = {}) {
  const data = { ...values };
  return {
    data,
    getItem(key) { return data[key] ?? null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; },
  };
}

const populated = () => memoryStorage({
  [STORAGE_KEY]: JSON.stringify(DECISIONS),
  [RELEASE_STORAGE_KEY]: JSON.stringify(RELEASES),
});

const exportedFile = (overrides = {}) => JSON.stringify({
  ...createShiplogExport(populated(), { generatedAt: GENERATED_AT }),
  ...overrides,
});

// The associations a store holds, as `releaseId -> [decisionId…]` in recorded
// order. The comparison the round trip is actually about.
function associationsOf(releases) {
  return Object.fromEntries(releases.map((release) => [release.id, [...release.decisionIds]]));
}

// --------------------------------------------------------------------------
// The envelope
// --------------------------------------------------------------------------

test("the export file says what it is, when it was written, and how much it carries", () => {
  const payload = createShiplogExport(populated(), { generatedAt: GENERATED_AT });

  assert.equal(payload.schema, SHIPLOG_EXPORT_SCHEMA);
  assert.equal(payload.version, SHIPLOG_EXPORT_VERSION);
  assert.equal(payload.generatedAt, GENERATED_AT);
  assert.equal(payload.source, EXPORT_SOURCES.history);

  // Counts are the arrays that were written, not a second reading of the store.
  assert.equal(payload.decision_count, 3);
  assert.equal(payload.release_count, 2);
  assert.equal(payload.decision_count, payload.decisions.length);
  assert.equal(payload.release_count, payload.releases.length);
  assert.equal(payload.record_count, payload.decisions.length + payload.releases.length);
  assert.deepEqual(shiplogExportViolations(payload), []);

  // The filename carries the same day the envelope stamps, from the same value,
  // so two exports on two days cannot land on one name.
  assert.equal(shiplogExportFilename(payload), "shiplog-history-2026-07-26T18-30-00Z.json");
  assert.ok(shiplogExportFilename(payload).includes(payload.generatedAt.slice(0, 10)));
  assert.equal(
    shiplogExportFilename({ ...payload, generatedAt: "2026-08-02T01:00:00.000Z" }),
    "shiplog-history-2026-08-02T01-00-00Z.json",
  );

  // The workspace backup writes the same schema and names itself, so a reader
  // holding only the file can tell the two surfaces apart.
  const backup = createShiplogExport(populated(), {
    generatedAt: GENERATED_AT, source: EXPORT_SOURCES.workspace,
  });
  assert.equal(backup.source, EXPORT_SOURCES.workspace);
  assert.deepEqual(shiplogExportViolations(backup), []);
  assert.throws(
    () => createShiplogExport(populated(), { generatedAt: GENERATED_AT, source: "somewhere-else" }),
    TypeError,
  );
});

// --------------------------------------------------------------------------
// Round trip
// --------------------------------------------------------------------------

test("export then re-import restores every record and every association, in order", () => {
  const before = populated();
  const file = exportedFile();

  // A different browser: nothing stored, so every id in the file has to resolve
  // against the file itself.
  const after = memoryStorage();
  const plan = prepareShiplogImport(after, file);
  assert.equal(plan.ok, true, plan.parsed?.error ?? "");
  assert.equal(plan.parsed.rejected.length, 0);
  assert.equal(plan.parsed.droppedAssociations.length, 0);
  assert.equal(plan.merged.summary.decisionsFound, 3);
  assert.equal(plan.merged.summary.releasesFound, 2);

  // Found against claimed, both stated to the visitor.
  assert.equal(plan.merged.summary.decisionsClaimed, 3);
  assert.equal(plan.merged.summary.releasesClaimed, 2);
  assert.match(
    formatImportSummary(plan.merged.summary),
    /Found 3 decisions and 2 releases in this file\. Its envelope claims 3 decisions and 2 releases, which is what the file contains\./,
  );

  commitShiplogImport(after, plan);

  assert.equal(loadDecisions(after).length, 3);
  assert.equal(loadReleases(after).length, 2);
  assert.deepEqual(
    associationsOf(loadReleases(after)),
    associationsOf(loadReleases(before)),
    "a release lists different decisions, or lists them in a different order, after the round trip",
  );
  assert.deepEqual(loadReleases(after)[0].decisionIds, ["d-cache", "d-queue"]);

  // Every id a release names resolves to a decision that came back with it.
  const restored = new Set(loadDecisions(after).map((decision) => decision.id));
  for (const release of loadReleases(after)) {
    for (const id of release.decisionIds) {
      assert.equal(restored.has(id), true, `release ${release.id} names decision ${id}, which did not survive`);
    }
  }

  // Re-exporting the restored browser produces the same file: a fixed point,
  // counts and all.
  const again = createShiplogExport(after, { generatedAt: GENERATED_AT });
  assert.deepEqual(again, JSON.parse(file));
});

test("a release link to a decision the file does not carry is named, not silently dropped", () => {
  // A hand-edited file: the release still names a decision that is not in it.
  const damaged = exportedFile({
    decisions: JSON.parse(exportedFile()).decisions.filter((d) => d.id !== "d-tokens"),
    decision_count: 2,
    record_count: 4,
    associations: undefined,
  });
  const parsed = parseImport(damaged);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.droppedAssociations.length, 1);
  assert.match(parsed.droppedAssociations[0].message, /dropped link to unknown decision "d-tokens"/);
  assert.equal(parsed.droppedAssociations[0].decisionId, "d-tokens");
  assert.equal(parsed.droppedAssociations[0].releaseId, "r-1-1-0");
});

// --------------------------------------------------------------------------
// Refusals: the store is never partly written
// --------------------------------------------------------------------------

// The three ways a file is refused whole, with the phrase each refusal has to
// carry. `records` is what the file claims to hold; the store must not move.
const REFUSALS = [
  {
    name: "malformed JSON",
    text: "{\"schema\": \"shiplog-history\", \"decisions\": [",
    expected: /expected JSON, got a parse error/,
  },
  {
    name: "a file with no schema at all",
    text: JSON.stringify({ decisions: [], releases: [] }),
    expected: /schema: expected "shiplog-history", got undefined/,
  },
  {
    name: "some other product's export",
    text: JSON.stringify({ schema: "notion.export", version: 1, decisions: [], releases: [] }),
    expected: /schema: expected "shiplog-history", got "notion\.export"/,
  },
  {
    name: "a version this reader does not know",
    text: exportedFile({ version: 9 }),
    expected: /version: expected 1, got 9/,
  },
  {
    name: "an envelope that claims more decisions than the file carries",
    text: exportedFile({ decision_count: 7 }),
    expected: /decision_count: envelope claims 7 decisions, file contains 3/,
  },
  {
    name: "an envelope that claims fewer releases than the file carries",
    text: exportedFile({ release_count: 1 }),
    expected: /release_count: envelope claims 1 releases, file contains 2/,
  },
  {
    name: "an envelope whose total disagrees with both arrays",
    text: exportedFile({ record_count: 99 }),
    expected: /record_count: envelope claims 99 records, file contains 5/,
  },
];

test("a file that is not this file is refused whole, and the browser keeps what it had", () => {
  for (const { name, text, expected } of REFUSALS) {
    const storage = populated();
    const before = JSON.stringify(storage.data);

    const plan = prepareShiplogImport(storage, text);
    assert.equal(plan.ok, false, `${name}: the file was accepted`);
    assert.match(plan.parsed.error, expected, name);
    assert.equal(plan.merged, null, `${name}: a rejected file produced a write plan`);
    // The refusal is one whole-file rejection, not a pile of per-record ones.
    assert.equal(plan.parsed.rejected.length, 1, name);
    assert.equal(plan.parsed.decisions.length, 0, name);
    assert.equal(plan.parsed.releases.length, 0, name);

    // Nothing was touched: the same records, the same associations, the same
    // bytes in the store.
    assert.equal(loadDecisions(storage).length, 3, name);
    assert.equal(loadReleases(storage).length, 2, name);
    assert.deepEqual(associationsOf(loadReleases(storage)), associationsOf(RELEASES), name);
    assert.equal(JSON.stringify(storage.data), before, `${name}: the store changed`);

    // And a refused file can never be committed by a caller that ignores `ok`.
    assert.throws(() => commitShiplogImport(storage, plan), TypeError, name);
    assert.equal(JSON.stringify(storage.data), before, `${name}: a refused commit wrote anyway`);
  }
});

// --------------------------------------------------------------------------
// The panel: the refusal is announced, and it is text
// --------------------------------------------------------------------------

function importPanel() {
  const nodes = {};
  const make = (extra = {}) => ({
    textContent: "", hidden: false, disabled: false, value: "", children: [],
    listeners: {},
    addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); },
    async dispatch(type) { for (const listener of this.listeners[type] ?? []) await listener(); },
    replaceChildren() { this.children = []; },
    append(...added) { this.children.push(...added); },
    focus() { nodes.focused = this; },
    ...extra,
  });
  Object.assign(nodes, {
    file: make({ files: [] }),
    panel: make({ hidden: true }),
    headline: make(),
    detail: make(),
    detailToggle: make({ hidden: true }),
    commit: make(),
    cancel: make(),
    status: make(),
  });
  const map = {
    "#import-shiplog-file": nodes.file,
    "#import-shiplog-summary": nodes.panel,
    "#import-shiplog-headline": nodes.headline,
    "#import-shiplog-detail": nodes.detail,
    "#import-shiplog-detail-toggle": nodes.detailToggle,
    "#import-shiplog-commit": nodes.commit,
    "#import-shiplog-cancel": nodes.cancel,
    "#import-shiplog-status": nodes.status,
  };
  nodes.root = { querySelector(selector) { return map[selector] ?? null; } };
  return nodes;
}

async function choose(ui, text) {
  ui.file.files = [{ text: async () => text }];
  await ui.file.dispatch("change");
}

test("the panel states the count mismatch as text, offers no restore, and writes nothing", async () => {
  const storage = populated();
  const before = JSON.stringify(storage.data);
  const ui = importPanel();
  initShiplogImport(ui.root, storage);

  await choose(ui, exportedFile({ decision_count: 7 }));

  assert.equal(ui.panel.hidden, false);
  assert.equal(
    ui.headline.textContent,
    "This file could not be read as a Shiplog export. "
    + "decision_count: envelope claims 7 decisions, file contains 3",
  );
  assert.equal(ui.commit.hidden, true, "a refused file still offered a restore button");
  assert.equal(ui.focused, ui.headline, "focus did not land on the message the reader must read");
  assert.equal(JSON.stringify(storage.data), before, "the store changed on a refused import");

  // The reason is written as text, one item, never as markup.
  assert.equal(ui.detail.children.length, 1);
  assert.match(ui.detail.children[0].textContent, /envelope claims 7 decisions, file contains 3/);
  assert.equal(ui.detail.children[0].innerHTML, undefined);

  // A good file after a refused one still imports: the refusal left no state.
  await choose(ui, exportedFile());
  assert.equal(ui.commit.hidden, false);
  assert.match(ui.headline.textContent, /^Found 3 decisions and 2 releases in this file\./);
});

test("the import status output is announced and is not folded away", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");

  // The live region the panel writes its result and its refusals into, and the
  // headline the panel moves focus to. Both sit above the collapsible notes, so
  // neither is inside a folded container that a real browser would not announce.
  assert.match(html, /<p id="import-shiplog-status" class="notice" role="status" aria-live="polite">/);
  assert.match(html, /<p class="hint" id="import-shiplog-headline" tabindex="-1" role="status">/);
  const summaryStart = html.indexOf('id="import-shiplog-summary"');
  // Searched from the import summary, not from the top of the document. The
  // disclosure class is shared with the export panel above, so an unanchored
  // search measures that panel's notes and says nothing about this headline.
  const detailStart = html.indexOf("import-detail", summaryStart);
  assert.ok(html.indexOf('id="import-shiplog-status"') < summaryStart, "the status region sits inside the summary");
  assert.ok(html.indexOf('id="import-shiplog-headline"') < detailStart, "the headline sits inside the collapsible notes");

  // The control that opens the file dialog is a label bound to a real file
  // input, so it is reachable and operable from the keyboard alone.
  assert.match(html, /<label class="secondary-button file-button" for="import-shiplog-file">/);
  assert.match(html, /<input id="import-shiplog-file" type="file"[^>]*aria-describedby="import-shiplog-help"/);
});

test("no export or import module assigns imported text into markup", async () => {
  for (const file of ["shiplog-export.js", "shiplog-export-schema.js", "shiplog-import.js"]) {
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML/, `${file} writes HTML strings`);
  }
});

test("the export panel and the workspace backup both write the source they came from", async () => {
  const panel = buildShiplogExport(populated(), { generatedAt: GENERATED_AT });
  assert.equal(panel.payload.source, EXPORT_SOURCES.history);

  const view = await readFile(new URL("../src/local-workspace-view.js", import.meta.url), "utf8");
  assert.match(view, /source: EXPORT_SOURCES\.workspace/,
    "the workspace backup writes files that claim to be history-panel exports");
});
