// The finished demo's teammate handoff (#3091).
//
// The hero promises that a teammate imports the log in their own browser, and
// the four-step demo used to stop one step short of that. This writes the pair
// the demo tracked — and nothing else the browser holds — as an ordinary
// Shiplog history export, so the homepage's own "Choose JSON file" control
// restores it unchanged.
//
// NO NEW FILE FORMAT. The payload is buildShiplogExport's, written by the same
// download path as "Download JSON"; only the store it reads is narrowed to the
// tracked decision and release, with the release's links cut down to that one
// decision, so the derived blocks cannot name a third record either.
// `supersedes` points at a decision outside the pair and is left behind.
//
// WHICH TWO RECORDS. The ones demo-progress.js tracks, by id, read from the
// stored log — which never holds the seeded examples or the repository's own
// decision-to-release proof, both composed in by the page. Never by title.

import { STORAGE_KEY } from "./app.js";
import { RELEASE_STORAGE_KEY } from "./releases.js";
import { buildShiplogExport, downloadShiplogExport, shiplogExportFilename } from "./shiplog-export.js";

export const DEMO_HANDOFF_STATUS = Object.freeze({
  downloaded: "Downloaded the demo decision and its release as one file.",
  failed: "The demo file could not be downloaded. Your browser data was not changed.",
});

/** `shiplog-demo-handoff-2026-07-26T18-30-00Z.json`, in the export's own style. */
export function demoHandoffFilename(payload) {
  return shiplogExportFilename(payload).replace(/^shiplog-history/, "shiplog-demo-handoff");
}

/** The export payload for the tracked pair, or null when the demo is not finished. */
export function demoHandoffExport(progress, options = {}) {
  const { decision, release } = progress ?? {};
  if (!progress?.complete || !decision?.id || !release?.id
    || !release.decisionIds?.includes(decision.id)) return null;
  const { supersedes, ...kept } = decision;
  const { unresolved_decision_ids: unresolved, ...shipped } = release;
  const pair = {
    [STORAGE_KEY]: JSON.stringify([kept]),
    [RELEASE_STORAGE_KEY]: JSON.stringify([{ ...shipped, decisionIds: [decision.id] }]),
  };
  return buildShiplogExport({ getItem: (key) => pair[key] ?? null }, options).payload;
}

/** Wire the finished state's download button; `read` returns the current progress. */
export function initDemoHandoff(root, read, options = {}) {
  const button = root.querySelector?.("#demo-handoff-download");
  const status = root.querySelector?.("#completion-proof-status");
  if (!button) return;
  button.addEventListener("click", () => {
    let message;
    try {
      // Re-read at the press: a pair deleted since the paint writes no file.
      const payload = demoHandoffExport(read(), { generatedAt: options.now?.().toISOString() });
      if (!payload) return;
      (options.download ?? downloadShiplogExport)(payload, { filename: demoHandoffFilename(payload) });
      message = DEMO_HANDOFF_STATUS.downloaded;
    } catch {
      message = DEMO_HANDOFF_STATUS.failed;
    }
    if (status) status.textContent = message;
  });
}
