// The read-only recipient view for a shared brief file (#1207).
//
// It takes the document rather than reading a global, like every view module
// beside it, so a test drives the shipped markup of evolution.html instead of a
// fixture authored for the test.
//
// TWO RULES, AND THEY ARE THE POINT OF THE SURFACE.
//
//   1. EVERY VALUE IS WRITTEN WITH textContent. The file is somebody else's,
//      arriving through a picker, and a brief carrying markup must be READ as
//      markup by a person, never parsed as markup by the browser. There is no
//      innerHTML here and no template interpolation, and the envelope handed in
//      has already dropped every field this view does not name.
//   2. A REFUSAL PAINTS NOTHING. `applySharedBrief` clears the region before it
//      looks at the outcome, so a refused file cannot leave the previous brief's
//      figure on screen under the next one's error. The region is hidden and the
//      reason paragraph carries the named sentence.
//
// Nothing here writes to storage, and nothing here imports anything that could.

import { SHARED_BRIEF_LIMIT_IDS } from "./finops-shared-brief-envelope.js";

/** The ids this view owns. Authored in evolution.html, written only here. */
export const SHARED_BRIEF_IDS = Object.freeze({
  input: "finops-open-brief-file",
  region: "shared-brief",
  title: "shared-brief-title",
  produced: "shared-brief-produced",
  figure: "shared-brief-figure",
  action: "shared-brief-action",
  confidence: "shared-brief-confidence",
  provenance: "shared-brief-provenance",
  limits: "shared-brief-limits",
  error: "shared-brief-error",
});

/** What each grade is called on screen. A word before it is ever a tint. */
export const SHARED_BRIEF_GRADE_WORD = Object.freeze({
  high: "High confidence",
  moderate: "Moderate confidence",
  low: "Low confidence",
  insufficient: "Not enough evidence to grade",
});

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

/** Minor units to the sender's currency, without inventing precision. */
export function formatMinor(valueMinor, currency) {
  const whole = Math.trunc(valueMinor / 100);
  const cents = String(valueMinor % 100).padStart(2, "0");
  return `${whole.toLocaleString("en-US")}.${cents} ${currency}`;
}

function write(doc, id, text) {
  const node = byId(doc, id);
  if (node) node.textContent = text;
  return node;
}

/**
 * Paint the region for one read outcome.
 *
 * @param outcome whatever `readSharedBriefText` returned, or null to clear.
 * @returns the region element, so a caller can move focus to it.
 */
export function applySharedBrief(doc, outcome) {
  const region = byId(doc, SHARED_BRIEF_IDS.region);
  if (!region) return null;

  // Cleared FIRST, on every path. See rule 2.
  for (const id of [SHARED_BRIEF_IDS.produced, SHARED_BRIEF_IDS.figure, SHARED_BRIEF_IDS.action,
    SHARED_BRIEF_IDS.confidence, SHARED_BRIEF_IDS.provenance]) {
    write(doc, id, "");
  }
  const limits = byId(doc, SHARED_BRIEF_IDS.limits);
  if (limits) limits.textContent = "";
  region.hidden = true;
  region.dataset.state = "empty";

  const error = byId(doc, SHARED_BRIEF_IDS.error);
  if (error) {
    error.hidden = true;
    error.textContent = "";
    delete error.dataset.reason;
  }
  if (!outcome) return region;

  if (!outcome.ok) {
    if (error) {
      // Three sentences, in the order a reader needs them: what is true, what
      // it means, and what to do. Joined into one paragraph so the reason and
      // its fix are announced together rather than as two separate updates.
      error.textContent = `${outcome.summary}. ${outcome.statement} ${outcome.remedy}`;
      error.dataset.reason = outcome.reason;
      error.hidden = false;
    }
    return region;
  }

  const { brief } = outcome;
  write(doc, SHARED_BRIEF_IDS.produced,
    `Produced ${brief.producedAt} by the sender. This is their analysis, not yours.`);
  write(doc, SHARED_BRIEF_IDS.figure,
    `${brief.figure.label}: ${formatMinor(brief.figure.valueMinor, brief.figure.currency)}`);
  write(doc, SHARED_BRIEF_IDS.action,
    `${brief.destination.action} — worth `
    + `${formatMinor(brief.destination.savingMinor, brief.figure.currency)} a month if it holds.`);
  const confidence = write(doc, SHARED_BRIEF_IDS.confidence,
    `${SHARED_BRIEF_GRADE_WORD[brief.confidence.grade]} — coverage `
    + `${(brief.confidence.coverageRatioPpm / 10_000).toFixed(1)}%`);
  if (confidence) confidence.dataset.grade = brief.confidence.grade;
  write(doc, SHARED_BRIEF_IDS.provenance,
    `${brief.provenance.designation}, ${brief.provenance.analysisPeriod}, `
    + `${brief.provenance.recordCount} records.`);

  if (limits) {
    for (const id of SHARED_BRIEF_LIMIT_IDS) {
      const limit = brief.limits.find((entry) => entry.id === id);
      if (!limit) continue;
      const item = doc.createElement("li");
      item.dataset.limit = id;
      item.textContent = limit.text;
      limits.append(item);
    }
  }
  region.hidden = false;
  region.dataset.state = "open";
  return region;
}
