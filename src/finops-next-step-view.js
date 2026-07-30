// The one recommendation, drawn into the AI FinOps briefing's answer region.
//
// It decides nothing. `selectNextStep` picked the state, the record, the figure
// and the words; this paints them in the order a leader reads them and adds no
// number of its own. `createElement` and `textContent` only — never a markup
// string, and never an assignment of HTML into the document.
//
// WHAT IS ON THE FIRST SCREEN, AND WHY IT IS NOT BEHIND A DISCLOSURE
// ------------------------------------------------------------------
// The recommendation, its one primary action, the impact, the confidence, the
// provenance and the evidence boundary are all painted unconditionally, with no
// interaction. They are the trust surface: a figure whose provenance is one
// click away is a figure a leader has to decide whether to trust before they
// are allowed to see why. Detail is what goes behind a disclosure; the grounds
// for the number are not detail.
//
// WHAT THE DISCLOSURE HOLDS, AND WHAT IT DELIBERATELY DOES NOT
// -----------------------------------------------------------
// Exactly three things: which journey state matched, the priority rule that
// made it win, and how many candidates it outranked. No chart, no metric tile,
// no second call to action, no export, and no runner-up list. A runner-up that
// cannot change what the lead does next does not get a widget — naming the
// count is what an executive needs to know the answer was contested; naming the
// contestants is what makes a screen a dashboard.
//
// It reuses the disclosure this journey already ships — a `<details>` with a
// `<summary>` over a definition list, the same shape as the recurring review's
// panels — rather than inventing a second one on the same page.

import { CONFIDENCE, JOURNEY_STATE, PRIMARY_ACTION } from "./finops-next-step.js";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0,
});

export const NEXT_STEP_IDS = Object.freeze({
  region: "finops-next-step",
  body: "finops-next-step-body",
  headline: "finops-next-step-headline",
  action: "finops-next-step-action",
  impact: "finops-next-step-impact",
  confidence: "finops-next-step-confidence",
  provenance: "finops-next-step-provenance",
  boundary: "finops-next-step-boundary",
  details: "finops-next-step-details",
  unknowns: "finops-next-step-unknowns",
});

/**
 * Where each of the four actions goes on this page. The contract names the
 * kind; routing is a property of the surface, so it lives here and not there.
 */
export const ACTION_TARGET = Object.freeze({
  [PRIMARY_ACTION.collectEvidence]: "#local-import-title",
  [PRIMARY_ACTION.startReview]: "#local-import-title",
  [PRIMARY_ACTION.resumeReview]: "/savings-action-center.html",
  [PRIMARY_ACTION.verifyAction]: "/savings-action-center.html",
});

/** A word beside the shape, so the state survives greyscale and a screen reader. */
const CONFIDENCE_SHAPE = Object.freeze({
  [CONFIDENCE.high]: "●", [CONFIDENCE.medium]: "◐", [CONFIDENCE.low]: "○",
});

const CONFIDENCE_MEANING = Object.freeze({
  [CONFIDENCE.high]:
    "every required input is present, captured within 35 days, and the figure comes from locally recorded amounts",
  [CONFIDENCE.medium]:
    "every required input is present, but the capture is 36–90 days old or the figure rests on a published benchmark ratio rather than recorded amounts",
  [CONFIDENCE.low]:
    "a required input is missing, unreadable, older than 90 days, or an incomplete line item had to be excluded",
});

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
  return detail;
}

/**
 * The impact sentence. `stated:false` means the contract refused to publish a
 * figure, and this says so in words rather than printing a zero or a dash that
 * a reader would take for a measurement.
 */
function impactText(recommendation) {
  const { impact, state } = recommendation;
  if (!impact.stated) {
    return state === JOURNEY_STATE.evidenceInsufficient
      ? "Not stated. The evidence behind a figure is not all here, so no figure is claimed."
      : "Not stated. Nothing priced is attached to this step yet.";
  }
  return `${USD.format(impact.monthlyUsd)} per month · ${USD.format(impact.annualizedUsd)} annualized (monthly × 12, no growth assumed)`;
}

function disclosure(doc, recommendation) {
  const details = element(doc, "details", "next-step-details");
  details.id = NEXT_STEP_IDS.details;
  details.append(element(doc, "summary", undefined, "Why this one, and what it outranked"));
  const list = element(doc, "dl", "next-step-facts");
  const { rationale } = recommendation;
  fact(doc, list, "Journey state matched", rationale.matchedState);
  fact(doc, list, "Rule that made it win", rationale.rule);
  fact(doc, list, "Candidates it outranked",
    rationale.outrankedCandidates === 0
      ? "None. It was the only candidate in this state."
      : `${rationale.outrankedCandidates}, ranked below it by monthly impact and then by record id.`);
  details.append(list);
  return details;
}

/**
 * Paint the recommendation into the shipped region.
 *
 * @param doc the document holding `#finops-next-step`.
 * @param recommendation a `finops-next-step/1.0.0` result.
 * @param options.sample the sample label when the figures are the bundled
 *   synthetic example rather than the reader's own records.
 * @returns the region, or null when this page does not carry one.
 */
export function renderNextStep(doc, recommendation, { sample = null } = {}) {
  const region = doc.getElementById(NEXT_STEP_IDS.region);
  const body = doc.getElementById(NEXT_STEP_IDS.body);
  if (!region || !body || !recommendation) return null;

  // Every panel sync repaints this page. Rebuilding a recommendation that has
  // not changed would close the disclosure a reader opened and take the
  // keyboard with it, so an unchanged one is left standing.
  const key = [
    recommendation.state, recommendation.headline, recommendation.primaryAction.label,
    recommendation.impact.monthlyUsd, recommendation.confidence, recommendation.provenance,
    recommendation.evidenceBoundary, recommendation.rationale.outrankedCandidates, sample,
  ].join("|");
  if (region.dataset.nextStepKey === key) return region;
  region.dataset.nextStepKey = key;
  region.dataset.state = recommendation.state;
  region.dataset.confidence = recommendation.confidence;
  body.replaceChildren();

  const headline = element(doc, "p", "next-step-headline", recommendation.headline);
  headline.id = NEXT_STEP_IDS.headline;
  body.append(headline);

  // Exactly one. The four kinds are mutually exclusive by construction in the
  // contract, and a second call to action here would put the reader back in the
  // position this screen exists to get them out of.
  const link = element(doc, "a", "next-step-primary", recommendation.primaryAction.label);
  link.id = NEXT_STEP_IDS.action;
  link.href = ACTION_TARGET[recommendation.primaryAction.kind] ?? "#local-import-title";
  link.dataset.primaryAction = recommendation.primaryAction.kind;
  body.append(link);

  const trust = element(doc, "dl", "next-step-trust");
  fact(doc, trust, "Impact", impactText(recommendation), NEXT_STEP_IDS.impact);
  fact(doc, trust, "Confidence",
    `${CONFIDENCE_SHAPE[recommendation.confidence]} ${recommendation.confidence} — ${CONFIDENCE_MEANING[recommendation.confidence]}`,
    NEXT_STEP_IDS.confidence);
  fact(doc, trust, "Provenance", recommendation.provenance, NEXT_STEP_IDS.provenance);
  fact(doc, trust, "What this does not cover", recommendation.evidenceBoundary,
    NEXT_STEP_IDS.boundary);
  body.append(trust);

  if (recommendation.unknowns.length) {
    const unknowns = element(doc, "section", "next-step-unknowns");
    unknowns.id = NEXT_STEP_IDS.unknowns;
    unknowns.append(element(doc, "h3", "next-step-unknowns-title", "What is not known here"));
    const list = element(doc, "ul", "next-step-unknown-list");
    for (const gap of recommendation.unknowns) {
      list.append(element(doc, "li", undefined, gap));
    }
    unknowns.append(list);
    body.append(unknowns);
  }

  body.append(disclosure(doc, recommendation));
  if (sample) {
    const marker = doc.getElementById("finops-next-step-sample");
    if (marker) marker.textContent = sample;
  }
  return region;
}
