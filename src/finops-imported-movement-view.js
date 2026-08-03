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
//   * Hide the sentence, or the window it was computed over. The movement line,
//     the window label under it and the next-action message that replaces the
//     figure when there is no movement are paragraphs in the region itself,
//     never inside a collapsed disclosure: a closed details element keeps the
//     one sentence a reader came for off the screen, and the harness these
//     tests run under reads text straight through it, so a green test would not
//     catch it. What IS behind the disclosure is the per-month working — one
//     row per month with the value used for it — which is what a reader opens
//     to check the figure rather than to read it (#1006).
//   * Announce. The stand region already owns this page's single live region
//     for an import; a second one is a queue a reader hears instead of an
//     answer.
//   * Touch the example path. Passing null takes the block off screen and
//     leaves every node the bundled example owns exactly as it was.

import {
  comparisonWindow, importedPeriodSeries, mergePeriodSeries, movementSentence,
  periodMovement, periodRowLabel, seriesSentence,
} from "./finops-imported-period-series.js";

import { FIGURE_SOURCE, mountProvenance } from "./finops-brief-provenance.js";

const REGION_ID = "finops-imported-movement";
const ANSWER_ID = "finops-imported-movement-answer";
const WINDOW_ID = "finops-imported-movement-window";
const BASIS_ID = "finops-imported-movement-basis";
const DETAIL_ID = "finops-imported-movement-detail";
const SUMMARY_ID = "finops-imported-movement-summary";
const COUNT_ID = "finops-imported-movement-count";
const SERIES_ID = "finops-imported-movement-series";
const PROVENANCE_ID = "finops-imported-movement-provenance";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

/**
 * Mirror the disclosure's own state into `data-disclosure` and `aria-expanded`,
 * exactly as the completeness working beside it does. The listener is attached
 * once — a second one would fire twice per toggle. Nothing here opens or closes
 * it: collapsed is the shipped default and only the reader changes it.
 */
function mountDisclosure(doc) {
  const details = byId(doc, DETAIL_ID);
  if (!details || details.dataset.mounted === "true") return;
  details.dataset.mounted = "true";
  const paint = () => {
    const open = details.hasAttribute("open");
    details.dataset.disclosure = open ? "expanded" : "collapsed";
    byId(doc, SUMMARY_ID)?.setAttribute("aria-expanded", String(open));
  };
  details.addEventListener?.("toggle", paint);
  paint();
}

/**
 * The window label: first month compared, last month compared, how many months.
 *
 * The arrow is decoration and carries `aria-hidden`, with the word "to" beside
 * it visually hidden — the same split the provenance marker uses for its mark —
 * so a screen reader hears "Mar 2026 to Jun 2026, 4 months" rather than the name
 * of a glyph. One month names itself instead: there is no range to draw.
 */
function paintWindow(doc, node, comparison) {
  node.replaceChildren();
  node.dataset.monthCount = String(comparison.monthCount);
  node.hidden = comparison.monthCount === 0;
  if (comparison.monthCount === 0) return;
  const months = `${comparison.monthCount} month${comparison.monthCount === 1 ? "" : "s"}`;
  if (comparison.monthCount === 1) {
    node.textContent = `${comparison.lastLabel} only, ${months}`;
    return;
  }
  node.append(doc.createTextNode(comparison.firstLabel));
  const spoken = doc.createElement("span");
  spoken.className = "visually-hidden";
  spoken.textContent = " to ";
  node.append(spoken);
  const arrow = doc.createElement("span");
  arrow.className = "stand-imported-window-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "→";
  node.append(arrow);
  node.append(doc.createTextNode(` ${comparison.lastLabel}, ${months}`));
}

/**
 * The series and its movement for one import, painted.
 *
 * @param input null on the bundled example or after a clear, otherwise
 *   `{ exports, acceptedExportIds, retainedPeriods }` — the raw parsed exports
 *   in hand, the reconciler's accepted export IDs, and the period totals this
 *   browser had already retained.
 * @returns `{ series, movement, window }`, including the empty one; `window` is
 *   the comparison window the label states.
 */
export function applyImportedMovement(doc, input = null) {
  const inFile = input
    ? importedPeriodSeries(input.exports ?? [],
      { acceptedExportIds: input.acceptedExportIds ?? null })
    : [];
  const series = input ? mergePeriodSeries(input.retainedPeriods ?? [], inFile) : [];
  const summary = periodMovement(series);
  const comparison = comparisonWindow(series);
  const region = byId(doc, REGION_ID);
  const host = byId(doc, SERIES_ID);
  const detail = byId(doc, DETAIL_ID);
  if (host) host.replaceChildren();
  if (!region) return Object.freeze({ series, movement: summary, window: comparison });
  mountDisclosure(doc);

  // No import at all: the bundled example, or a clear. The block goes off
  // screen whole, because there is no file for it to be about.
  if (!input) {
    region.hidden = true;
    region.dataset.state = "unavailable";
    region.dataset.periodCount = "0";
    delete region.dataset.direction;
    const answer = byId(doc, ANSWER_ID);
    if (answer) answer.textContent = "";
    const basis = byId(doc, BASIS_ID);
    if (basis) basis.textContent = "";
    const label = byId(doc, WINDOW_ID);
    if (label) paintWindow(doc, label, comparison);
    if (detail) detail.hidden = true;
    const count = byId(doc, COUNT_ID);
    if (count) count.textContent = "not analyzed";
    return Object.freeze({ series, movement: summary, window: comparison });
  }

  region.hidden = false;
  // Three states, every one of them a result: a comparison, one named month, or
  // an import no dated month could be read from. There is no state in which
  // this region blames the reader for the file they have, and none in which a
  // figure is printed for a comparison that was never made — fewer than two
  // months renders the sentence that names the next step, in the figure's own
  // place, so nothing below it moves.
  region.dataset.state = summary.available ? "movement"
    : summary.periodCount === 1 ? "single-period" : "no-period";
  region.dataset.periodCount = String(summary.periodCount);
  region.dataset.direction = summary.direction ?? "none";
  const answer = byId(doc, ANSWER_ID);
  if (answer) answer.textContent = movementSentence(summary);
  // Which months that figure was computed from, beneath the figure and outside
  // every disclosure: a reader cannot check a number whose window is a fold away.
  const label = byId(doc, WINDOW_ID);
  if (label) paintWindow(doc, label, comparison);
  const basis = byId(doc, BASIS_ID);
  if (basis) basis.textContent = series.length === 0 ? "" : seriesSentence(series);
  // The per-month working, and the count in the control's own name so a reader
  // knows what is behind it before pressing it. An import with no dated month
  // has nothing to disclose, so the control is not offered.
  if (detail) detail.hidden = series.length === 0;
  const count = byId(doc, COUNT_ID);
  if (count) {
    count.textContent = series.length === 0 ? "none read"
      : `${series.length} month${series.length === 1 ? "" : "s"}`;
  }
  if (series.length === 0) return Object.freeze({ series, movement: summary, window: comparison });
  // Every month in this series came off rows in the reader's own export — the
  // ones this browser retained came off an earlier one. So the marker is the
  // file state, and it sits above the disclosure holding the per-month rows it
  // qualifies rather than inside it, where a collapsed panel would take the
  // claim about whose data this is off the screen with the rows.
  mountProvenance(doc, {
    region, id: PROVENANCE_ID, source: FIGURE_SOURCE.file, before: detail ?? host,
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
  return Object.freeze({ series, movement: summary, window: comparison });
}

/** Take the block off screen. The example path is left untouched. */
export function clearImportedMovement(doc) {
  return applyImportedMovement(doc, null);
}
