import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  commitShiplogImport,
  formatImportSummary,
  formatRestoreAction,
  initShiplogImport,
  mergeImport,
  parseImport,
  prepareShiplogImport,
} from "../src/shiplog-import.js";
import { buildShiplogExport, createShiplogExport } from "../src/shiplog-export.js";
import { STORAGE_KEY, loadDecisions, renderDecisions } from "../src/app.js";
import { RELEASE_STORAGE_KEY, loadReleases } from "../src/releases.js";
import { byClass, installDocument, walk } from "./support/dom.js";

installDocument();

const GENERATED_AT = "2026-07-26T18:30:00.000Z";

const decisionA = {
  id: "d-queue", title: "Use a durable queue", context: "Jobs were lost",
  alternatives: "Database polling", owner: "Rowan", status: "accepted",
  createdAt: "2026-07-25T10:00:00.000Z",
};
const decisionB = {
  id: "d-cache", title: "Cache at the edge", context: "Latency was high",
  alternatives: "Regional proxy", owner: "Mina", status: "approved",
  createdAt: "2026-07-24T10:00:00.000Z",
};
const releaseA = {
  id: "r-1", version: "v1.0.0", title: "Queue launch",
  createdAt: "2026-07-26T10:00:00.000Z",
  decisionIds: ["d-queue", "d-cache"],
};

function exportFile(overrides = {}) {
  return JSON.stringify({
    schema: "shiplog-history",
    version: 1,
    generatedAt: GENERATED_AT,
    decisions: [decisionA, decisionB],
    releases: [releaseA],
    ...overrides,
  });
}

// A storage double with the same surface the app uses: getItem/setItem, values
// held as the JSON strings the real store holds.
function memoryStorage(values = {}) {
  const data = { ...values };
  return {
    data,
    getItem(key) { return data[key] ?? null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; },
  };
}

function seeded() {
  return memoryStorage({
    [STORAGE_KEY]: JSON.stringify([decisionA, decisionB]),
    [RELEASE_STORAGE_KEY]: JSON.stringify([releaseA]),
  });
}

const messages = (parsed) => parsed.rejected.map((entry) => entry.message);

// --------------------------------------------------------------------------
// parseImport: the pure contract
// --------------------------------------------------------------------------

test("a valid export file parses into its records with no rejections", () => {
  const parsed = parseImport(exportFile());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.error, null);
  assert.deepEqual(parsed.decisions, [decisionA, decisionB]);
  assert.deepEqual(parsed.releases, [releaseA]);
  assert.deepEqual(parsed.rejected, []);
  assert.deepEqual(parsed.droppedAssociations, []);
});

test("malformed JSON fails the whole file with a specific reason", () => {
  const parsed = parseImport("{ not json");
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /^file: expected JSON, got a parse error \(/);
  assert.deepEqual(parsed.decisions, []);
  assert.deepEqual(parsed.releases, []);
  assert.equal(parsed.rejected.length, 1);
});

test("an unrecognizable top-level shape fails the file and names the field", () => {
  assert.match(parseImport("[]").error, /^file: expected a Shiplog export object, got array$/);
  assert.match(parseImport("null").error, /^file: expected a Shiplog export object, got null$/);
  assert.match(
    parseImport(JSON.stringify({ schema: "notes", version: 1, decisions: [], releases: [] })).error,
    /^schema: expected "shiplog-history", got "notes"$/,
  );
  assert.match(
    parseImport(exportFile({ version: 2 })).error,
    /^version: expected 1, got 2$/,
  );
  assert.match(
    parseImport(JSON.stringify({ schema: "shiplog-history", version: 1, releases: [] })).error,
    /^decisions: expected array, got undefined$/,
  );
  assert.match(
    parseImport(JSON.stringify({ schema: "shiplog-history", version: 1, decisions: [], releases: {} })).error,
    /^releases: expected array, got object$/,
  );
  assert.match(parseImport(undefined).error, /^file: expected text, got undefined$/);
});

test("one invalid record is rejected on its own and the valid records still import", () => {
  const parsed = parseImport(exportFile({
    decisions: [decisionA, { ...decisionB, owner: 42 }],
    releases: [releaseA],
  }));

  assert.equal(parsed.ok, true, "a bad record never fails the file");
  assert.deepEqual(parsed.decisions, [decisionA]);
  assert.deepEqual(messages(parsed), ["decisions[1].owner: expected string, got number"]);
  assert.deepEqual(parsed.rejected[0], {
    collection: "decisions",
    index: 1,
    id: "d-cache",
    message: "decisions[1].owner: expected string, got number",
  });
});

test("every rejection names the offending record index and field", () => {
  const parsed = parseImport(exportFile({
    decisions: [
      { ...decisionA, id: "" },
      { ...decisionA, id: "d-2", title: undefined },
      { ...decisionA, id: "d-3", status: "shipped" },
      { ...decisionA, id: "d-4", createdAt: "yesterday" },
      { ...decisionA, id: "d-5", context: "x".repeat(1001) },
      { ...decisionA, id: "d-6", alternatives: 7 },
      null,
    ],
    releases: [
      { ...releaseA, id: "r-2", version: 3 },
      { ...releaseA, id: "r-3", decisionIds: "d-queue" },
      { ...releaseA, id: "r-4", decisionIds: ["d-queue", 9] },
      { ...releaseA, id: "r-5", createdAt: undefined },
    ],
  }));

  assert.deepEqual(messages(parsed), [
    'decisions[0].id: expected a non-empty string, got ""',
    "decisions[1].title: required, got undefined",
    "decisions[2].status: expected one of pending, approved, proposed, accepted, superseded, got \"shipped\"",
    'decisions[3].createdAt: expected an ISO date string, got "yesterday"',
    "decisions[4].context: expected at most 1000 characters, got 1001",
    "decisions[5].alternatives: expected string, got number",
    "decisions[6]: expected object, got null",
    "releases[0].version: expected string, got number",
    "releases[1].decisionIds: expected array, got string",
    "releases[2].decisionIds[1]: expected string, got number",
    "releases[3].createdAt: required, got undefined",
  ]);
  assert.deepEqual(parsed.decisions, []);
  assert.deepEqual(parsed.releases, []);
});

test("unknown top-level keys and a bad generatedAt are reported without blocking the import", () => {
  const parsed = parseImport(exportFile({ generatedAt: "soon", exportedBy: "someone" }));
  assert.equal(parsed.ok, true);
  assert.deepEqual(messages(parsed), [
    "file.exportedBy: unknown top-level key, not imported",
    'generatedAt: expected an ISO date string, got "soon"',
  ]);
  assert.deepEqual(parsed.decisions, [decisionA, decisionB]);
});

test("a release link to a decision missing from the file and the store is dropped and reported", () => {
  const parsed = parseImport(exportFile({
    decisions: [decisionA],
    releases: [{ ...releaseA, decisionIds: ["d-queue", "d-gone", "d-known"] }],
  }), { existingDecisionIds: ["d-known"] });

  assert.deepEqual(parsed.releases[0].decisionIds, ["d-queue", "d-known"]);
  assert.deepEqual(parsed.droppedAssociations, [{
    releaseId: "r-1",
    releaseIndex: 0,
    decisionId: "d-gone",
    reason: "unknown",
    message: 'releases[0].decisionIds[1]: dropped link to unknown decision "d-gone"',
  }]);
});

test("a link to a decision rejected by validation is dropped, not written dangling", () => {
  const parsed = parseImport(exportFile({
    decisions: [{ ...decisionA, status: "shipped" }],
    releases: [releaseA],
  }));
  assert.deepEqual(parsed.releases[0].decisionIds, []);
  assert.equal(parsed.droppedAssociations.length, 2);
  assert.deepEqual(
    parsed.droppedAssociations.map((entry) => entry.decisionId),
    ["d-queue", "d-cache"],
  );
});

test("a release keeps its associations, in the file's order, when every link resolves", () => {
  const parsed = parseImport(exportFile({
    decisions: [decisionB, decisionA],
    releases: [{ ...releaseA, decisionIds: ["d-cache", "d-queue"] }],
  }));

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.releases[0].decisionIds, ["d-cache", "d-queue"]);
  assert.deepEqual(parsed.droppedAssociations, []);
});

// createRelease writes `[...new Set(values.decisionIds)]`, so a release this app
// authored can never name the same decision twice. The import holds the same
// invariant rather than letting a hand-edited or drifted file write a shape the
// form cannot produce: the first occurrence keeps its position, the repeat is
// dropped and reported.
test("a repeated release link is collapsed to its first occurrence and reported", () => {
  const parsed = parseImport(exportFile({
    decisions: [decisionB, decisionA],
    releases: [{ ...releaseA, decisionIds: ["d-cache", "d-queue", "d-cache"] }],
  }));

  assert.deepEqual(parsed.releases[0].decisionIds, ["d-cache", "d-queue"]);
  assert.deepEqual(parsed.droppedAssociations, [{
    releaseId: "r-1",
    releaseIndex: 0,
    decisionId: "d-cache",
    reason: "duplicate",
    position: 2,
    firstPosition: 0,
    message: 'releases[0].decisionIds[2]: dropped repeat link to decision "d-cache", '
      + "already associated at position 0",
  }]);
});

test("a repeat of an unknown link is reported per position as an unknown link, not a duplicate", () => {
  const parsed = parseImport(exportFile({
    decisions: [decisionA],
    releases: [{ ...releaseA, decisionIds: ["d-gone", "d-queue", "d-gone"] }],
  }));

  assert.deepEqual(parsed.releases[0].decisionIds, ["d-queue"]);
  assert.ok(parsed.droppedAssociations.every((entry) => entry.reason === "unknown"));
  assert.deepEqual(parsed.droppedAssociations.map((entry) => entry.message), [
    'releases[0].decisionIds[0]: dropped link to unknown decision "d-gone"',
    'releases[0].decisionIds[2]: dropped link to unknown decision "d-gone"',
  ]);
});

test("de-duplicated associations are what reaches storage, and the counts say so", () => {
  const storage = memoryStorage();
  const plan = prepareShiplogImport(storage, exportFile({
    decisions: [decisionA, decisionB],
    releases: [{ ...releaseA, decisionIds: ["d-queue", "d-queue", "d-cache", "d-gone"] }],
  }));

  assert.equal(plan.ok, true);
  assert.equal(plan.merged.summary.droppedAssociations, 2);
  assert.deepEqual(
    plan.parsed.droppedAssociations.map((entry) => entry.reason),
    ["duplicate", "unknown"],
  );
  commitShiplogImport(storage, plan);
  assert.deepEqual(loadReleases(storage)[0].decisionIds, ["d-queue", "d-cache"]);
});

// --------------------------------------------------------------------------
// mergeImport: duplicates and the record set that gets written
// --------------------------------------------------------------------------

test("records already in the store are skipped, never overwritten or double-added", () => {
  const parsed = parseImport(exportFile({
    decisions: [{ ...decisionA, title: "Rewritten by the file" }, decisionB],
    releases: [releaseA],
  }));
  const merged = mergeImport(parsed, { decisions: [decisionA], releases: [releaseA] });

  assert.deepEqual(merged.decisions, [decisionA, decisionB], "existing record wins and is kept once");
  assert.deepEqual(merged.releases, [releaseA]);
  assert.equal(merged.summary.duplicateDecisions, 1);
  assert.equal(merged.summary.duplicateReleases, 1);
  assert.equal(merged.summary.newDecisions, 1);
  assert.equal(merged.summary.newReleases, 0);
  assert.equal(merged.summary.restorable, 1);
});

test("a duplicate-heavy file adds nothing twice", () => {
  const parsed = parseImport(exportFile({
    decisions: [decisionA, decisionA, decisionB, decisionB, decisionA],
    releases: [releaseA, releaseA, releaseA],
  }));
  const merged = mergeImport(parsed, { decisions: [], releases: [] });

  assert.deepEqual(merged.decisions.map((d) => d.id), ["d-queue", "d-cache"]);
  assert.deepEqual(merged.releases.map((r) => r.id), ["r-1"]);
  assert.equal(merged.summary.duplicateDecisions, 3);
  assert.equal(merged.summary.duplicateReleases, 2);
  assert.equal(merged.summary.restorable, 3);
});

test("importing the same file twice writes nothing the second time", () => {
  const storage = memoryStorage();
  commitShiplogImport(storage, prepareShiplogImport(storage, exportFile()));
  const before = { ...storage.data };

  const summary = commitShiplogImport(storage, prepareShiplogImport(storage, exportFile()));
  assert.deepEqual(storage.data, before);
  assert.equal(summary.restorable, 0);
  assert.equal(summary.duplicateDecisions, 2);
  assert.equal(summary.duplicateReleases, 1);
});

// --------------------------------------------------------------------------
// Commit: one write per store, or none
// --------------------------------------------------------------------------

test("prepareShiplogImport writes nothing before the user confirms", () => {
  const storage = memoryStorage();
  const plan = prepareShiplogImport(storage, exportFile());
  assert.equal(plan.ok, true);
  assert.deepEqual(storage.data, {});
  assert.equal(plan.merged.summary.restorable, 3);
});

test("a failed write leaves storage exactly as it was", () => {
  const storage = seeded();
  const before = { ...storage.data };
  // The release store refuses the write; the decision store has already been
  // written by then. This is the half-written case the rollback exists for.
  storage.setItem = (key, value) => {
    if (key === RELEASE_STORAGE_KEY) throw new Error("quota exceeded");
    storage.data[key] = String(value);
  };

  const plan = prepareShiplogImport(storage, exportFile({
    decisions: [{ ...decisionA, id: "d-new" }],
    releases: [],
  }));
  assert.throws(() => commitShiplogImport(storage, plan), /quota exceeded/);
  assert.deepEqual(storage.data, before, "the first store was rolled back to its previous bytes");
});

test("an unreadable file can never be committed", () => {
  const storage = seeded();
  const plan = prepareShiplogImport(storage, "{ not json");
  assert.equal(plan.ok, false);
  assert.throws(() => commitShiplogImport(storage, plan), /could not be read/);
  assert.deepEqual(loadDecisions(storage), [decisionA, decisionB]);
});

// --------------------------------------------------------------------------
// Round trip
// --------------------------------------------------------------------------

test("export, clear, import, re-export returns the same record set", () => {
  const original = createShiplogExport(seeded(), { generatedAt: GENERATED_AT });
  const file = `${JSON.stringify(original, null, 2)}\n`;

  const cleared = memoryStorage();
  const summary = commitShiplogImport(cleared, prepareShiplogImport(cleared, file));
  assert.equal(summary.rejected, 0);
  assert.equal(summary.droppedAssociations, 0);

  const restored = createShiplogExport(cleared, { generatedAt: GENERATED_AT });

  // Order-insensitive on record order (the store guarantees none) and on object
  // keys (deepEqual on plain objects already ignores key order).
  const byId = (records) => [...records].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(Object.keys(restored).sort(), Object.keys(original).sort());
  assert.deepEqual(byId(restored.decisions), byId(original.decisions));
  assert.deepEqual(byId(restored.releases), byId(original.releases));
  assert.deepEqual(restored.releases[0].decisionIds, original.releases[0].decisionIds);
});

// The one documented divergence from byte-identical round tripping: a link with
// no decision behind it is dropped rather than restored dangling, so a store
// that already carried one comes back without it. Both sides now hold that
// rule — the exporter drops the link on the way out (link integrity: every id
// in the file resolves inside the file), so by the time the importer sees the
// file there is nothing dangling left for rule 2 to drop. Pinned here so the
// tradeoff cannot regress silently at either end.
test("a pre-existing dangling link does not survive the round trip, by design", () => {
  const source = memoryStorage({
    [STORAGE_KEY]: JSON.stringify([decisionA]),
    [RELEASE_STORAGE_KEY]: JSON.stringify([{ ...releaseA, decisionIds: ["d-queue", "d-never-existed"] }]),
  });
  const exported = buildShiplogExport(source, { generatedAt: GENERATED_AT });
  assert.deepEqual(exported.payload.releases[0].decisionIds, ["d-queue"]);
  assert.deepEqual(exported.unresolvedLinks, [
    { releaseId: releaseA.id, decisionId: "d-never-existed", position: 1 },
  ]);
  const file = JSON.stringify(exported.payload);

  const cleared = memoryStorage();
  const plan = prepareShiplogImport(cleared, file);
  commitShiplogImport(cleared, plan);

  assert.deepEqual(loadReleases(cleared)[0].decisionIds, ["d-queue"]);
  assert.equal(plan.merged.summary.droppedAssociations, 0,
    "the export already resolved the link, so the importer has nothing to drop");
});

// --------------------------------------------------------------------------
// Summary copy
// --------------------------------------------------------------------------

test("the summary states every count the user needs before confirming", () => {
  const parsed = parseImport(exportFile({
    decisions: [decisionA, decisionB, { ...decisionA, id: "d-bad", status: "shipped" }],
    releases: [{ ...releaseA, decisionIds: ["d-queue", "d-bad"] }],
  }));
  const merged = mergeImport(parsed, { decisions: [decisionA], releases: [] });

  assert.equal(
    formatImportSummary(merged.summary),
    "Found 2 decisions and 1 release in this file. 2 records new, 1 already in this browser and skipped. 1 record rejected, 1 release link dropped.",
  );
  assert.equal(formatRestoreAction(merged.summary), "Restore 2 records");
  assert.equal(formatRestoreAction({ restorable: 1 }), "Restore 1 record");
});

// --------------------------------------------------------------------------
// UI: nothing is written until the user confirms
// --------------------------------------------------------------------------

function importPanel() {
  const nodes = {};
  const make = (extra = {}) => {
    const node = {
      textContent: "", hidden: false, disabled: false, value: "", children: [],
      listeners: {},
      addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); },
      async dispatch(type) { for (const listener of this.listeners[type] ?? []) await listener(); },
      replaceChildren() { this.children = []; },
      append(...added) { this.children.push(...added); },
      focus() { nodes.focused = this; },
      ...extra,
    };
    return node;
  };
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

test("the import panel summarises before writing and only writes on confirm", async () => {
  const storage = memoryStorage();
  const ui = importPanel();
  initShiplogImport(ui.root, storage);

  await choose(ui, exportFile());

  assert.equal(ui.panel.hidden, false);
  assert.equal(
    ui.headline.textContent,
    "Found 2 decisions and 1 release in this file. 3 records new, 0 already in this browser and skipped. 0 records rejected, 0 release links dropped.",
  );
  assert.equal(ui.commit.textContent, "Restore 3 records");
  assert.equal(ui.focused, ui.commit, "focus lands on the action the user must take");
  assert.deepEqual(storage.data, {}, "nothing is written before the user confirms");

  await ui.commit.dispatch("click");
  assert.deepEqual(loadDecisions(storage).map((d) => d.id), ["d-queue", "d-cache"]);
  assert.deepEqual(loadReleases(storage).map((r) => r.id), ["r-1"]);
  assert.equal(ui.status.textContent, "Restored 3 records. Reload to see them in your history.");
  assert.equal(ui.panel.hidden, true, "the plan is cleared once it is spent");
  assert.equal(ui.focused, ui.file);
});

test("cancelling discards the plan and writes nothing", async () => {
  const storage = memoryStorage();
  const ui = importPanel();
  initShiplogImport(ui.root, storage);

  await choose(ui, exportFile());
  await ui.cancel.dispatch("click");

  assert.equal(ui.panel.hidden, true);
  assert.deepEqual(storage.data, {});
  assert.equal(ui.status.textContent, "Import cancelled. Nothing was changed.");

  await ui.commit.dispatch("click");
  assert.deepEqual(storage.data, {}, "a discarded plan cannot be committed afterwards");
});

test("an unreadable file explains why and offers no restore action", async () => {
  const storage = seeded();
  const ui = importPanel();
  initShiplogImport(ui.root, storage);

  await choose(ui, "{ not json");

  assert.equal(ui.panel.hidden, false);
  assert.match(ui.headline.textContent, /^This file could not be read as a Shiplog export\. file: expected JSON/);
  assert.equal(ui.commit.hidden, true);
  assert.equal(ui.detail.children.length, 1);
  assert.deepEqual(loadDecisions(storage), [decisionA, decisionB], "storage is untouched");
});

test("per-record detail is listed away from the headline summary", async () => {
  const ui = importPanel();
  initShiplogImport(ui.root, memoryStorage());

  await choose(ui, exportFile({
    decisions: [decisionA],
    releases: [{ ...releaseA, decisionIds: ["d-queue", "d-gone"] }],
    exportedBy: "someone",
  }));

  assert.deepEqual(ui.detail.children.map((child) => child.textContent), [
    "file.exportedBy: unknown top-level key, not imported",
    'releases[0].decisionIds[1]: dropped link to unknown decision "d-gone"',
  ]);
  assert.equal(ui.detailToggle.hidden, false);
  assert.equal(ui.detailToggle.textContent, "2 record notes");
  assert.match(ui.headline.textContent, /1 release link dropped\.$/);
});

// --------------------------------------------------------------------------
// Escaping
// --------------------------------------------------------------------------

test("imported markup is stored and rendered as literal text", async () => {
  const payload = "<script>alert(1)</script>";
  const storage = memoryStorage();
  const ui = importPanel();
  initShiplogImport(ui.root, storage);

  await choose(ui, exportFile({
    decisions: [{ ...decisionA, title: payload, context: payload, alternatives: payload, owner: payload }],
    releases: [{ ...releaseA, title: payload, decisionIds: ["d-queue"] }],
  }));
  await ui.commit.dispatch("click");

  const [stored] = loadDecisions(storage);
  assert.equal(stored.title, payload, "the payload round-trips as data, not markup");

  const container = { children: [], attributes: {}, setAttribute() {}, replaceChildren(...nodes) { this.children = nodes; }, append(...nodes) { this.children.push(...nodes); } };
  renderDecisions(container, { textContent: "" }, loadDecisions(storage), {});

  const rendered = walk(container.children[0], () => true);
  const texts = rendered.map((node) => node.ownText).filter(Boolean);
  assert.ok(texts.includes(payload), "the payload appears as one text value");
  assert.equal(byClass(container.children[0], "context")[0].textContent, payload);
  // Nothing in the rendered tree parsed the payload into elements: a SCRIPT tag
  // would only exist if the value had been written as HTML.
  assert.equal(rendered.filter((node) => node.tagName === "SCRIPT").length, 0);
});

test("no render path in the import, history, or detail views assigns innerHTML", async () => {
  for (const file of ["shiplog-import.js", "app.js", "releases.js", "decision-detail.js"]) {
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML/, `${file} writes HTML strings`);
  }
});

test("the history page exposes a keyboard-reachable import control wired to the module", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert.match(html, /<label class="secondary-button file-button" for="import-shiplog-file">/);
  assert.match(html, /<input id="import-shiplog-file" type="file"/);
  assert.match(html, /id="import-shiplog-summary"/);
  assert.match(html, /id="import-shiplog-commit"/);
  assert.match(html, /src="\/shiplog-import-page\.js"/);
});
