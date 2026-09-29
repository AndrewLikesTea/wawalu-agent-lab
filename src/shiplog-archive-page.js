import { readDecisions } from "./app.js";
import { readReleases } from "./releases.js";
import { ARCHIVE_DECISION_FIELDS, ARCHIVE_RELEASE_FIELDS } from "./shiplog-archive.js";
const project = (row, fields) => Object.fromEntries(fields.filter(key => row[key] !== undefined).map(key => [key, row[key]]));

export function initShiplogArchive(documentRef, storage, { fetch: send = globalThis.fetch, urlApi = URL } = {}) {
  const button = documentRef.getElementById("download-shiplog-archive");
  const status = documentRef.getElementById("shiplog-archive-status");
  if (!button || !status) return;
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "Preparing complete archive…";
    let url;
    let anchor;
    try {
      // Read synchronously from this browser only. Never send arbitrary storage
      // or undeclared record properties across the server boundary.
      const records = {
        decisions: readDecisions(storage).map(row => project(row, ARCHIVE_DECISION_FIELDS)),
        releases: readReleases(storage).map(row => project(row, [...ARCHIVE_RELEASE_FIELDS, "decisionIds"])),
      };
      const response = await send("/api/shiplog-archive", {
        method: "POST", credentials: "omit", headers: { "content-type": "application/json" }, body: JSON.stringify(records),
      });
      if (!response.ok) throw new Error("Archive unavailable");
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="(shiplog-archive-\d{4}-\d\d-\d\d\.json)"/)?.[1];
      if (!filename || !response.headers.get("content-type")?.startsWith("application/json")) throw new Error("Invalid archive response");
      url = urlApi.createObjectURL(await response.blob());
      anchor = documentRef.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      documentRef.body.append(anchor);
      anchor.click();
      status.textContent = "Complete Shiplog archive downloaded.";
    } catch {
      status.textContent = "Archive could not be downloaded. Your records are unchanged. Try again.";
    } finally {
      anchor?.remove();
      if (url) urlApi.revokeObjectURL(url);
      button.disabled = false;
    }
  });
}
