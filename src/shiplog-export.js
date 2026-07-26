import { loadDecisions } from "./app.js";
import { loadReleases } from "./releases.js";

export const SHIPLOG_EXPORT_SCHEMA = "shiplog-history";
export const SHIPLOG_EXPORT_VERSION = 1;

export function createShiplogExport(storage, options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new TypeError("Export generatedAt must be an ISO date.");
  }

  return {
    schema: SHIPLOG_EXPORT_SCHEMA,
    version: SHIPLOG_EXPORT_VERSION,
    generatedAt,
    decisions: structuredClone(loadDecisions(storage)),
    releases: structuredClone(loadReleases(storage)),
  };
}

export function shiplogExportCounts(storage) {
  return {
    decisions: loadDecisions(storage).length,
    releases: loadReleases(storage).length,
  };
}

export function formatShiplogExportCounts({ decisions, releases }) {
  const decisionLabel = decisions === 1 ? "decision" : "decisions";
  const releaseLabel = releases === 1 ? "release" : "releases";
  return `Ready to export ${decisions} ${decisionLabel} and ${releases} ${releaseLabel} stored in this browser.`;
}

export function downloadShiplogExport(payload, options = {}) {
  const documentRef = options.document ?? document;
  const urlApi = options.urlApi ?? URL;
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: "application/json",
  });
  const href = urlApi.createObjectURL(blob);
  const link = documentRef.createElement("a");
  link.href = href;
  link.download = `shiplog-history-${payload.generatedAt.slice(0, 10)}.json`;
  link.click();
  urlApi.revokeObjectURL(href);
}

export function initShiplogExport(root, storage, options = {}) {
  const button = root.querySelector("#export-shiplog");
  const counts = root.querySelector("#export-shiplog-counts");
  const status = root.querySelector("#export-shiplog-status");
  if (!button || !counts) return;

  counts.textContent = formatShiplogExportCounts(shiplogExportCounts(storage));
  button.addEventListener("click", () => {
    try {
      const payload = createShiplogExport(storage, {
        generatedAt: options.now?.().toISOString(),
      });
      (options.download ?? downloadShiplogExport)(payload);
      if (status) status.textContent = "Shiplog history exported.";
    } catch {
      if (status) {
        status.textContent = "Shiplog history could not be exported. Your browser data was not changed.";
      }
    }
  });
}
