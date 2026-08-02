// The render layer for the imported export's period series and its movement.
//
// It takes the document rather than reading a global, like the view modules
// beside it, so a test drives the shipped markup of evolution.html. Every node
// is built with createElement and textContent: no markup string, no innerHTML.
//
// WHAT IT WILL NOT DO.
//
//   * Decide anything. Which months the file covers, what a repeat sums to,
//     which two periods are compared and what the movement reads are
//     `finops-imported-period-series.js`'s answers. This layer paints rows.
//   * Hide the sentence. The movement line is a paragraph in the region itself,
//     never inside a collapsed disclosure: a closed details element keeps the
//     one sentence a reader came for off the screen, and the harness these
//     tests run under reads text straight through it, so a green test would not
//     catch it. The per-period rows sit beside it in the open too.
//   * Announce. The stand region already owns this page's single live region
//     for an import; a second one is a queue a reader hears instead of an
//     answer.
//   * Touch the example path. Passing null takes the block off screen and
//     leaves every node the bundled example owns exactly as it was.

import {
  importedPeriodSeries, mergePeriodSeries, movementSentence, periodMovement,
  periodRowLabel, seriesSentence,
} from "./finops-imported-period-series.js";

import { FIGURE_SOURCE, mountProvenance } from "./finops-brief-provenance.js";

const REGION_ID = "finops-imported-movement";
const ANSWER_ID = "finops-imported-movement-answer";
const BASIS_ID = "finops-imported-movement-basis";
const SERIES_ID = "finops-imported-movement-series";
const PROVENANCE_ID = "finops-imported-movement-provenance";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

/**
 * The series and its movement for one import, painted.
 *
 * @param input null on the bundled example or after a clear, otherwise
 *   `{ exports, acceptedExportIds, retainedPeriods }` — the raw parsed exports
 *   in hand, the reconciler's accepted export IDs, and the period totals this
 *   browser had already retained.
 * @returns `{ series, movement }`, including the empty one.
 */
export function applyImportedMovement(doc, input = null) {
  const inFile = input
    ? importedPeriodSeries(input.exports ?? [],
      { acceptedExportIds: input.acceptedExportIds ?? null })
    : [];
  const series = input ? mergePeriodSeries(input.retainedPeriods ?? [], inFile) : [];
  const summary = periodMovement(series);
  const region = byId(doc, REGION_ID);
  const host = byId(doc, SERIES_ID);
  if (host) host.replaceChildren();
  if (!region) return Object.freeze({ series, movement: summary });

  if (series.length === 0) {
    region.hidden = true;
    region.dataset.state = "unavailable";
    region.dataset.periodCount = "0";
    delete region.dataset.direction;
    const answer = byId(doc, ANSWER_ID);
    if (answer) answer.textContent = "";
    const basis = byId(doc, BASIS_ID);
    if (basis) basis.textContent = "";
    return Object.freeze({ series, movement: summary });
  }

  region.hidden = false;
  // Two states, both of them a result: a comparison, or one named period. There
  // is no state in which this region blames the reader for the file they have.
  region.dataset.state = summary.available ? "movement" : "single-period";
  region.dataset.periodCount = String(summary.periodCount);
  region.dataset.direction = summary.direction ?? "none";
  const answer = byId(doc, ANSWER_ID);
  if (answer) answer.textContent = movementSentence(summary);
  const basis = byId(doc, BASIS_ID);
  if (basis) basis.textContent = seriesSentence(series);
  // Every month in this series came off rows in the reader's own export — the
  // ones this browser retained came off an earlier one. So the marker is the
  // file state, and it sits above the per-period rows it qualifies rather than
  // after them.
  mountProvenance(doc, {
    region, id: PROVENANCE_ID, source: FIGURE_SOURCE.file, before: host,
    qualifies: "Period-over-period movement",
    detail: `${series.length} month${series.length === 1 ? "" : "s"} read from your export`,
  });
  if (host) {
    for (const entry of series) {
      const row = doc.createElement("li");
      row.className = "stand-imported-period";
      row.dataset.period = entry.period;
      row.textContent = periodRowLabel(entry);
      host.append(row);
    }
  }
  return Object.freeze({ series, movement: summary });
}

/** Take the block off screen. The example path is left untouched. */
export function clearImportedMovement(doc) {
  return applyImportedMovement(doc, null);
}
