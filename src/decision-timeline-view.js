// The release-outcome strips above the record list: one prioritized next action,
// one line saying how many outcomes there are, and one figure per decision.
//
// THE TEXT IS THE FIGURE. Every strip's facts — both dates, the status, the
// release, the span in days — are in a visible figcaption that is written
// whether or not anything is ever painted. The canvas is an ADDITION to that
// sentence, appended only once a 2D context has actually been obtained, so a
// browser without canvas, a context the GPU refused, and a reader who cannot see
// get the same complete answer with nothing missing and no empty box holding
// space. That is why the caption is written first and the canvas is prepended
// after: the degraded path is the ordinary path with a step skipped.
//
// DEVICE PIXELS ON THE STORE, CSS PIXELS ON THE ELEMENT. The backing store is
// sized with setAttribute — width and height are content attributes, and a strip
// whose store is set as a JS property alone is a value that never reaches the
// markup. The CSS box is set as an inline style from the same geometry, because
// the pair only works when one number is computed from the other; a stylesheet
// rule cannot know the ratio the store was built at.
//
// A REDRAW WITH THE SAME INPUTS PAINTS NOTHING. The signature below covers every
// value that reaches a pixel, the ratio included. A resize that does not change
// the ratio — the common case, since a window resize alone does not move a
// display — returns before touching the DOM or the context.

import {
  STATUS_MARK_NOTE,
  decisionOutcomes,
  nextActionSentence,
  longestOpenOutcome,
  stripGeometry,
  stripRatio,
  timelineCaption,
  timelineName,
  timelineSummary,
} from "./decision-timeline.js";

// sRGB, and the page's own three inks: the muted rule, the text-coloured end
// caps, and the one accent the filter summary already uses. No wide-gamut and no
// colour-only distinction — the open strip differs from the closed one by having
// no end cap and trailing off in dashes, which survives any colour vision.
const TRACK_INK = "#6a6a65";
const MARK_INK = "#26261f";
const STATUS_INK = "#174f84";

export const TIMELINE_EMPTY_LINE = "No decision in this view has a release outcome yet.";

const textElement = (parent, tagName, className, text) => {
  const node = document.createElement(tagName);
  node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
};

/**
 * A 2D context for a fresh canvas, or `null` when this environment has none.
 *
 * Both failures are the same answer: an element with no `getContext` (a document
 * that does not implement canvas) and a `getContext` that returns null or throws
 * (a context the browser declined to allocate) both mean "nothing can be
 * painted", and neither may take the page down.
 */
export function canvasContext() {
  const canvas = document.createElement("canvas");
  if (typeof canvas?.getContext !== "function") return null;
  try {
    const context = canvas.getContext("2d");
    return context ? { canvas, context } : null;
  } catch {
    return null;
  }
}

/** One strip, in device pixels, from a geometry the pure layer computed. */
export function drawStrip(context, geometry) {
  context.clearRect(0, 0, geometry.deviceWidth, geometry.deviceHeight);
  const { track } = geometry;
  context.fillStyle = TRACK_INK;
  context.fillRect(track.x, track.y, track.width, track.height);
  for (const dash of geometry.dashes) context.fillRect(dash.x, track.y, dash.width, track.height);
  for (const mark of geometry.marks) {
    context.fillStyle = mark.kind === "status" ? STATUS_INK : MARK_INK;
    if (mark.shape === "dot") {
      context.beginPath();
      context.arc(mark.x, mark.y, mark.radius, 0, Math.PI * 2);
      context.fill();
      continue;
    }
    context.fillRect(mark.x, mark.y, mark.width, mark.height);
  }
}

const signatureOf = (outcomes, total, scale) => JSON.stringify([
  scale,
  total,
  outcomes.map((outcome) => [
    outcome.id, outcome.status, outcome.recordedOn, outcome.releasedOn, outcome.days, outcome.open, outcome.release?.label ?? "",
  ]),
]);

/**
 * Draw the outcome strips for `records` — the filtered set, the same one the
 * list renders, so the strips can never describe a different view.
 *
 * @returns the outcomes drawn, how many figures were built, and how many of them
 *   were actually painted (`drawn` is 0 on the text-only path and on a no-op
 *   redraw, and `redrawn` tells the two apart).
 */
export function renderDecisionTimelines(node, {
  records = [],
  releases,
  now = Date.now(),
  ratio,
  max,
} = {}) {
  if (!node) return { outcomes: [], total: 0, figures: 0, drawn: 0, redrawn: false };
  const { shown, total } = decisionOutcomes(records, { now, max, releases });
  const scale = stripRatio(ratio ?? globalThis.devicePixelRatio);
  const signature = signatureOf(shown, total, scale);
  // Nothing that reaches a pixel has changed, so nothing is repainted and the
  // DOM is not touched — no reflow, no flash, no re-announced live region.
  if (node.dataset?.timelineKey === signature) {
    return { outcomes: shown, total, figures: shown.length, drawn: 0, redrawn: false };
  }
  if (node.dataset) node.dataset.timelineKey = signature;
  node.replaceChildren();

  const longest = longestOpenOutcome(shown);
  if (longest) {
    // The one thing to do next, above the list and above the strips: a reader
    // who reads nothing else on this panel should still leave knowing which
    // accepted decision has been waiting longest.
    const action = textElement(node, "p", "filter-summary", nextActionSentence(longest));
    action.setAttribute("data-timeline-action", longest.id);
  }
  textElement(node, "p", "hint", total === 0 ? TIMELINE_EMPTY_LINE : timelineSummary({ shown: shown.length, total }));

  let drawn = 0;
  for (const outcome of shown) {
    const figure = document.createElement("figure");
    figure.className = "decision-timeline";
    figure.setAttribute("data-timeline", outcome.open ? "open" : "shipped");
    figure.setAttribute("data-decision", outcome.id);
    // The caption first: it is the answer, and it exists on every path.
    textElement(figure, "figcaption", "hint", timelineCaption(outcome));

    const surface = canvasContext();
    if (surface) {
      const geometry = stripGeometry(outcome, { ratio: scale });
      const { canvas, context } = surface;
      canvas.className = "decision-timeline-strip";
      // The store in device pixels, the box in CSS pixels, both written here
      // from the same geometry so neither can drift from the other.
      canvas.setAttribute("width", String(geometry.deviceWidth));
      canvas.setAttribute("height", String(geometry.deviceHeight));
      if (canvas.style) {
        canvas.style.width = `${geometry.cssWidth}px`;
        canvas.style.height = `${geometry.cssHeight}px`;
      }
      // The figcaption already names the figure. The canvas repeats the same
      // sentence rather than adding a second, shorter one, so a reader on the
      // image and a reader on the caption are told exactly the same facts.
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", timelineName(outcome));
      drawStrip(context, geometry);
      figure.prepend(canvas);
      drawn += 1;
    }
    node.append(figure);
  }

  // Said only where it is true: the note explains a mark, and on the text-only
  // path there is no mark to explain.
  if (drawn > 0) textElement(node, "p", "hint", STATUS_MARK_NOTE);
  return { outcomes: shown, total, figures: shown.length, drawn, redrawn: true };
}
