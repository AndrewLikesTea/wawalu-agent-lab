import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SHIPLOG_EXPORT_SCHEMA,
  SHIPLOG_EXPORT_VERSION,
  createShiplogExport,
  formatShiplogExportCounts,
  initShiplogExport,
} from "../src/shiplog-export.js";
import { STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";

const GENERATED_AT = "2026-07-26T18:30:00.000Z";
const decision = {
  id: "d-queue", title: "Use a durable queue", context: "Jobs were lost",
  alternatives: "Database polling", owner: "Rowan", status: "accepted",
  createdAt: "2026-07-25T10:00:00.000Z",
};
const release = {
  id: "r-1", version: "v1.0.0", title: "Queue launch",
  createdAt: "2026-07-26T10:00:00.000Z",
  decisionIds: ["d-queue", "d-preserved-but-missing"],
};

function storage(values = {}) {
  return { getItem(key) { return values[key] ?? null; } };
}

function populatedStorage(extra = {}) {
  return storage({
    [STORAGE_KEY]: JSON.stringify([decision]),
    [RELEASE_STORAGE_KEY]: JSON.stringify([release]),
    ...extra,
  });
}

test("populated browser export has an explicit portable contract and only Shiplog history", () => {
  const payload = createShiplogExport(populatedStorage({
    "shiplog.social.author": "Customer Name",
    "unrelated.state": JSON.stringify({ secret: true }),
  }), { generatedAt: GENERATED_AT });

  assert.deepEqual(payload, {
    schema: SHIPLOG_EXPORT_SCHEMA,
    version: SHIPLOG_EXPORT_VERSION,
    generatedAt: GENERATED_AT,
    decisions: [decision],
    releases: [release],
  });
  assert.equal(JSON.parse(JSON.stringify(payload)).generatedAt, GENERATED_AT);
  assert.equal(payload["unrelated.state"], undefined);
});

test("empty browser history exports an explicitly empty valid record", () => {
  assert.deepEqual(createShiplogExport(storage(), { generatedAt: GENERATED_AT }), {
    schema: SHIPLOG_EXPORT_SCHEMA,
    version: SHIPLOG_EXPORT_VERSION,
    generatedAt: GENERATED_AT,
    decisions: [],
    releases: [],
  });
});

test("release decision associations preserve their order and dangling ids", () => {
  const payload = createShiplogExport(populatedStorage(), { generatedAt: GENERATED_AT });
  assert.deepEqual(payload.releases[0].decisionIds, [
    "d-queue",
    "d-preserved-but-missing",
  ]);
});

test("export UI shows local counts before download and downloads one record", () => {
  const listeners = {};
  const button = { addEventListener(type, listener) { listeners[type] = listener; } };
  const counts = { textContent: "" };
  const status = { textContent: "" };
  const elements = {
    "#export-shiplog": button,
    "#export-shiplog-counts": counts,
    "#export-shiplog-status": status,
  };
  const downloads = [];

  initShiplogExport({
    querySelector(selector) { return elements[selector] ?? null; },
  }, populatedStorage(), {
    now: () => new Date(GENERATED_AT),
    download(payload) { downloads.push(payload); },
  });

  assert.equal(counts.textContent, "Ready to export 1 decision and 1 release stored in this browser.");
  assert.equal(downloads.length, 0, "counts are visible before the user starts the download");
  listeners.click();
  assert.equal(downloads.length, 1);
  assert.deepEqual(downloads[0].releases[0].decisionIds, release.decisionIds);
  assert.equal(status.textContent, "Shiplog history exported.");
});

test("count copy uses explicit zero and plural labels", () => {
  assert.equal(
    formatShiplogExportCounts({ decisions: 0, releases: 0 }),
    "Ready to export 0 decisions and 0 releases stored in this browser.",
  );
});

test("decision page exposes and initializes the pre-download export summary", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert.match(html, /id="export-shiplog-counts"/);
  assert.match(html, /id="export-shiplog"/);
  assert.match(html, /src="\/shiplog-export-page\.js"/);
});
