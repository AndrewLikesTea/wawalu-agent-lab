// Wiring for the recorded-decision outcome region on the decision detail page.
//
// The records come from the visitor's own log — the same decisions and releases
// the detail above is rendered from — and nothing here writes to either. The
// later month does not come from storage at all: the AI FinOps page keeps
// nothing, so the refreshed briefing is a file the visitor exported themselves
// and opens in this tab. It is read here and never uploaded.
//
// The file control lives in the page's markup rather than in the render module,
// because this region is replaced on every read and a control replaced while it
// holds focus takes the visitor's place in the document with it.

import { loadReleaseData } from "./releases-data.js";
import { SEED_DECISION_DETAILS } from "./seed-records.js";
import { decisionOutcome, observationFromBriefing } from "./decision-outcome.js";
import { renderDecisionOutcome, renderDecisionOutcomeState } from "./decision-outcome-view.js";
import { readEvidenceFile } from "./savings-evidence.js";

/**
 * The outcome for one decision id, out of the records to hand.
 *
 * Synchronous and pure with respect to storage: the id either resolves now or
 * does not, so there is no pending window to be stranded in. A missing decision
 * is a real state — `no_decision` — with its own sentence and next step.
 */
export function loadDecisionOutcome(id, storage, options = {}) {
  const loadData = options.loadData ?? loadReleaseData;
  const { decisions, releases } = loadData(storage);
  const seeds = options.detailSeeds ?? SEED_DECISION_DETAILS;
  const decision = [...seeds, ...decisions].find((record) => record?.id === id) ?? null;
  return decisionOutcome({
    decision,
    releases,
    observation: options.observation ?? null,
    observationMeta: options.observationMeta ?? null,
  });
}

/**
 * Read one opened briefing into an observation.
 *
 * Total: a file that cannot be read becomes `{ observation: null, message }`
 * carrying the reader's own sentence, never a thrown surprise. The message is
 * the one the file reader wrote, so this module invents no diagnosis of its own.
 */
export function readObservationFile({ name, text, byteSize } = {}) {
  const { opened, rejected } = readEvidenceFile({ name, text, byteSize });
  const entry = opened[0];
  if (!entry) {
    return {
      observation: null,
      observationMeta: null,
      message: `${name}: ${rejected[0]?.message ?? "could not be read as a saved FinOps briefing."}`,
    };
  }
  const observation = observationFromBriefing(entry);
  return {
    observation,
    observationMeta: {
      name: entry.name, month: entry.month, dataset: entry.dataset, savedOn: entry.savedOn,
    },
    message: observation
      ? `Read ${entry.name}: ${entry.periodText}.`
      : `${entry.name} carries no per-route figure for its own leading workload, so it cannot be `
        + "read as an observation of this decision's route.",
  };
}

export function initDecisionOutcome(options = {}) {
  const container = document.querySelector("#decision-outcome");
  if (!container) return null;
  const input = document.querySelector("#dout-file");
  const status = document.querySelector("#dout-file-status");

  const id = new URLSearchParams(window.location.search).get("id") ?? "";
  let opened = { observation: null, observationMeta: null };

  const paint = () => {
    try {
      renderDecisionOutcome(container, loadDecisionOutcome(id, localStorage, { ...options, ...opened }));
    } catch {
      renderDecisionOutcomeState(container, "error");
    } finally {
      document.documentElement.dataset.shiplogDecisionOutcome = "ready";
    }
  };

  renderDecisionOutcomeState(container, "loading");
  paint();

  input?.addEventListener("change", async (event) => {
    const file = event.target?.files?.[0];
    if (!file) return;
    renderDecisionOutcomeState(container, "reading");
    if (status) status.textContent = `Reading ${file.name}…`;
    let text = null;
    try {
      text = await file.text();
    } catch {
      text = null;
    }
    const read = readObservationFile({ name: file.name, text, byteSize: file.size });
    opened = { observation: read.observation, observationMeta: read.observationMeta };
    if (status) status.textContent = read.message;
    paint();
  });

  return container;
}

// Guarded so this module can be imported by a test without booting against a
// document that is not the decision detail page.
if (typeof document !== "undefined" && document.querySelector?.("#decision-outcome")) {
  initDecisionOutcome();
}
