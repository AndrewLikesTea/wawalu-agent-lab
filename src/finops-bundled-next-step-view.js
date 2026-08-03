// The bundled example's step, drawn into the "Where do I start this month?"
// evidence layer.
//
// It decides nothing: `bundledFirstAction` picked the department, the figure,
// the action and the checkpoint, and this paints them in the order a lead reads
// them and adds no number of its own. `createElement` and `textContent` only —
// never a markup string, never an assignment of HTML into the document.
//
// It writes the SAME slot ids `finops-next-step-view.js` writes, because the
// region is one region: a reader, a test, and a deep link all address the step
// by `#finops-next-step-action` whether it came from the reader's own retained
// records or from the bundled example. What changes with the source is the
// content and the stamped `data-step-source`, not the address.

import { NEXT_STEP_IDS } from "./finops-next-step-view.js";

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fact(doc, list, label, value, id) {
  const term = element(doc, "dt", "next-step-term", label);
  const detail = element(doc, "dd", "next-step-detail", value);
  if (id) detail.id = id;
  list.append(term, detail);
}

/**
 * Paint the bundled example's step into the shipped region.
 *
 * @param doc the document holding `#finops-next-step`.
 * @param recommendation a `finops-bundled-next-step/1.0.0` record.
 * @param options.sample the sample label, which stays the bundled-synthetic one.
 * @returns the region, or null when this page does not carry one, or when
 *   nothing was derived — a caller with no recommendation paints nothing here
 *   rather than a placeholder step.
 */
export function renderBundledNextStep(doc, recommendation, { sample = null } = {}) {
  const region = doc.getElementById(NEXT_STEP_IDS.region);
  const body = doc.getElementById(NEXT_STEP_IDS.body);
  if (!region || !body || !recommendation) return null;

  // Every panel sync repaints this page. Rebuilding a step that has not changed
  // would close a disclosure a reader opened and take the keyboard with it.
  const key = [recommendation.contract, recommendation.actionId, recommendation.figure.text,
    recommendation.checkpoint.due, sample].join("|");
  if (region.dataset.nextStepKey === key) return region;
  region.dataset.nextStepKey = key;
  region.dataset.state = recommendation.state;
  region.dataset.stepSource = recommendation.state;
  region.dataset.confidence = "example";
  body.replaceChildren();

  const headline = element(doc, "p", "next-step-headline", recommendation.headline);
  headline.id = NEXT_STEP_IDS.headline;
  body.append(headline);

  // Exactly one, and it goes where the example's step is actually taken: the
  // import panel, because acting on it means bringing a real export to it.
  const link = element(doc, "a", "next-step-primary", recommendation.actionText);
  link.id = NEXT_STEP_IDS.action;
  link.href = "#local-import-title";
  link.dataset.primaryAction = "collect_evidence";
  body.append(link);

  const trust = element(doc, "dl", "next-step-trust");
  fact(doc, trust, "Department", recommendation.department);
  fact(doc, trust, "Derived figure",
    `${recommendation.figure.text} of ${recommendation.figure.metricName}`
    + `${recommendation.figure.period ? ` over ${recommendation.figure.period}` : ""}`
    + ` (${recommendation.figure.unit})`,
    NEXT_STEP_IDS.impact);
  fact(doc, trust, "Checkpoint",
    recommendation.checkpoint.known
      ? `${recommendation.checkpoint.metricName} over ${recommendation.checkpoint.period},`
        + ` expected ${recommendation.checkpoint.expected} or less`
      : recommendation.checkpoint.note,
    "finops-next-step-checkpoint");
  fact(doc, trust, "Why this one", recommendation.rationale, NEXT_STEP_IDS.provenance);
  fact(doc, trust, "What this does not cover",
    "Invented records for an invented company. Nothing here is your own spend, and no figure "
    + "in it is a realized saving.",
    NEXT_STEP_IDS.boundary);
  body.append(trust);

  if (sample) {
    const marker = doc.getElementById("finops-next-step-sample");
    if (marker) marker.textContent = sample;
  }
  return region;
}
