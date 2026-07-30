// The partial-evidence finding, painted from the policy.
//
// Three slots in one order — state, one material figure, one action — each
// under a named heading, with the confidence in that finding stated between the
// figure and the action. Then the peer line, then one native disclosure holding
// every exclusion, every review gap, and the provenance labels. A reader who
// stops after the third slot has the whole decision; a reader who opens the
// disclosure can check it.
//
// The region's order on the page and its live region are both authored in
// evolution.html. This module paints into what it is given and never moves a
// section: where a result sits relative to the panels around it is a fact about
// the page, readable without running it.
//
// This module authors no product wording. Every sentence comes from the frozen
// result, so a change of judgment cannot leave a stale claim in the markup.
// Every node is built with createElement and textContent: the site policy
// forbids executing user-generated markup and nothing here assembles a string
// of it.
//
// The partial stamp is a word, never only a tint or a shape. "Partial floor" is
// the difference between a defensible figure and a misleading one, so it is
// carried in text a screen reader reaches.

import { ACTION_CODE, FINDING_STATE, PARTIAL_EVIDENCE_QUESTION } from "./partial-evidence.js";

export const PARTIAL_EVIDENCE_SECTION_ID = "partial-evidence";
export const PARTIAL_EVIDENCE_BODY_ID = "partial-evidence-body";
export const PARTIAL_EVIDENCE_TITLE_ID = "partial-evidence-title";
export const PARTIAL_EVIDENCE_DISCLOSURE_ID = "partial-evidence-disclosure";
export const PARTIAL_EVIDENCE_LIVE_ID = "partial-evidence-live";

/** A word and a shape. The word carries the meaning; the shape is decoration. */
const STATE_WORD = Object.freeze({
  [FINDING_STATE.supported]: "Supported",
  [FINDING_STATE.partial]: "Partial support",
  [FINDING_STATE.insufficient]: "Not yet supported",
});

const STATE_SHAPE = Object.freeze({
  [FINDING_STATE.supported]: "✓",
  [FINDING_STATE.partial]: "◐",
  [FINDING_STATE.insufficient]: "○",
});

/**
 * A named confidence, derived only from the policy's state—not a new score.
 *
 * `level` is the stable key and `label` is the sentence. The attribute a
 * reviewer or a test reads carries the key, so rewording the label is an
 * editorial change and not a broken selector.
 */
const CONFIDENCE = Object.freeze({
  [FINDING_STATE.supported]: {
    level: "high",
    label: "High confidence",
    reason: "Every considered export is admissible and no review gap is open.",
  },
  [FINDING_STATE.partial]: {
    level: "limited",
    label: "Limited confidence",
    reason: "The finding is usable as a floor, but excluded evidence or an open review gap can move it.",
  },
  [FINDING_STATE.insufficient]: {
    level: "none",
    label: "No finding confidence",
    reason: "No material finding is published because the import has no admissible evidence.",
  },
});

/** Which control an action wants, when it wants one at all. */
const ACTION_TARGET = Object.freeze({
  files: { id: "local-finops-files", label: "Choose provider files again" },
  roster: { id: "local-finops-files", label: "Add the org roster export" },
});

const byId = (doc, id) => doc.getElementById(id);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The name of a slot, as a heading rather than a styled paragraph.
 *
 * A reader who navigates by heading is the reader this region is hardest for:
 * they arrive at the section title — the question — and then need to reach the
 * finding, the confidence, the action and the peer claim without listening to
 * the whole thing. `h4` under the section's `h3` is what makes that a jump
 * rather than a scroll, and it is the level the disclosure headings already use.
 */
const slotLabel = (doc, text) => element(doc, "h4", "pe-slot-label", text);

/** Slot two: exactly one figure, and what kind of figure it is. */
function materialBlock(doc, material) {
  const block = element(doc, "div", "pe-material");
  block.dataset.kind = material.kind;
  block.dataset.metric = material.id;
  block.dataset.partial = String(material.partial);
  block.append(element(doc, "p", "pe-material-label", material.label));
  const figure = element(doc, "p", "pe-material-figure", material.display);
  block.append(figure);
  if (material.partial) {
    // Never only a tint. A reader who cannot see colour must not be the one who
    // quotes this number as a total.
    const stamp = element(doc, "p", "pe-material-partial",
      `Partial floor. ${material.partialReason}`);
    stamp.dataset.stamp = "partial";
    block.append(stamp);
  }
  block.append(element(doc, "p", "pe-material-basis", material.basis));
  return block;
}

/** Slot three: one action, as a control when there is something to operate. */
function actionBlock(doc, result, { onAct } = {}) {
  const target = ACTION_TARGET[result.nextAction.focus];
  const statement = element(doc, "p", "pe-action", result.nextAction.statement);
  statement.dataset.actionCode = result.nextAction.code;
  if (!target || result.nextAction.code === ACTION_CODE.recordTheDecision) return [statement];
  const button = element(doc, "button", "pe-action-jump", target.label);
  button.id = "partial-evidence-action-jump";
  button.setAttribute("type", "button");
  button.dataset.actionCode = result.nextAction.code;
  button.setAttribute("aria-label", `${target.label}. ${result.nextAction.statement}`);
  button.addEventListener("click", () => {
    byId(doc, target.id)?.focus?.();
    onAct?.(result.nextAction);
  });
  return [statement, button];
}

function exclusionRow(doc, entry) {
  const item = element(doc, "li", "pe-exclusion");
  item.dataset.code = entry.code;
  item.dataset.origin = entry.origin;
  item.append(
    element(doc, "span", "pe-evidence-kind", "Excluded evidence"),
    element(doc, "span", "pe-exclusion-label", entry.label),
    element(doc, "span", "pe-exclusion-reason", entry.reason),
  );
  return item;
}

function usableRow(doc, entry) {
  const item = element(doc, "li", "pe-usable");
  item.dataset.record = entry.id;
  item.append(
    element(doc, "span", "pe-evidence-kind", "Analyzed evidence"),
    element(doc, "span", "pe-usable-label", entry.label),
    element(doc, "span", "pe-usable-window", `${entry.periodStart} to ${entry.periodEnd}`),
    // The label, never the source. What a record is attributed to is evidence;
    // the material behind it is not this product's to hold or to show.
    element(doc, "span", "pe-usable-provenance", entry.provenanceLabel ?? "No named source"),
  );
  return item;
}

function disclosure(doc, result) {
  const details = element(doc, "details", "pe-disclosure");
  details.id = PARTIAL_EVIDENCE_DISCLOSURE_ID;
  details.append(element(doc, "summary", undefined,
    result.evidence.excludedCount > 0
      ? `Evidence details: ${result.evidence.admissible} analyzed, `
        + `${result.evidence.excludedCount} excluded`
      : `Evidence details: ${result.evidence.admissible} analyzed, none excluded`));

  if (result.evidence.excluded.length) {
    details.append(element(doc, "h4", "pe-disclosure-heading", "Excluded from the figure"));
    const list = element(doc, "ul", "pe-exclusion-list");
    list.setAttribute("aria-label", "Every export held out of this finding and why");
    list.append(...result.evidence.excluded.map((entry) => exclusionRow(doc, entry)));
    details.append(list);
  }

  if (result.evidence.usable.length) {
    details.append(element(doc, "h4", "pe-disclosure-heading", "Counted in the figure"));
    const list = element(doc, "ul", "pe-usable-list");
    list.setAttribute("aria-label", "Every export counted in this finding");
    list.append(...result.evidence.usable.map((entry) => usableRow(doc, entry)));
    details.append(list);
  }

  if (result.review.gaps.length) {
    details.append(element(doc, "h4", "pe-disclosure-heading", "Open review gaps"));
    const gaps = element(doc, "ul", "pe-review-gaps");
    gaps.setAttribute("aria-label", "Review gaps this finding is still carrying");
    gaps.append(...result.review.gaps.map((gap) => {
      const item = element(doc, "li", null, gap.message);
      item.dataset.code = gap.code;
      return item;
    }));
    details.append(gaps);
  }

  if (result.contractErrors.length) {
    const errors = element(doc, "ul", "pe-contract-errors");
    errors.setAttribute("aria-label", "Why this evidence cannot be judged");
    errors.append(...result.contractErrors.map((error) => element(doc, "li", null, error)));
    details.append(errors);
  }

  details.append(element(doc, "h4", "pe-disclosure-heading", "Eligibility score"));
  details.append(element(doc, "p", "pe-eligibility-score",
    `${result.eligibility.score} of 100 · aggregate threshold `
    + `${result.eligibility.threshold}. ${result.eligibility.rule}`));
  const dimensions = element(doc, "ul", "pe-eligibility-dimensions");
  dimensions.setAttribute("aria-label", "Eligibility weights and assumptions");
  dimensions.append(...result.eligibility.dimensions.map((entry) =>
    element(doc, "li", null,
      `${entry.id.replace(/_/g, " ")}: ${entry.earned} of ${entry.weight}. ${entry.assumption}`)));
  details.append(dimensions);

  details.append(element(doc, "p", "pe-definition", result.material.definition));
  if (result.material.arithmetic) {
    details.append(element(doc, "p", "pe-arithmetic", result.material.arithmetic));
  }
  details.append(element(doc, "p", "pe-provenance",
    `${result.evidence.period} · ${result.evidence.currency} · `
    + `${result.provenance.labels.length
      ? result.provenance.labels.join("; ")
      : "no named source"} · Processed ${result.provenance.processing.replace(/_/g, " ")} · `
    + `Judged by ${result.provenance.policy}.`));
  return details;
}

/**
 * Paint the region.
 *
 * @param result a frozen `evaluatePartialEvidence` finding, or null to take the
 *   region off screen — which is the correct state before anything is imported.
 * @param onAct called after focus moves, so a caller can record that the reader
 *   took the action offered.
 */
export function applyPartialEvidence(doc, result, { onAct } = {}) {
  const section = byId(doc, PARTIAL_EVIDENCE_SECTION_ID);
  const body = byId(doc, PARTIAL_EVIDENCE_BODY_ID);
  if (!section || !body) return null;
  if (!result) {
    section.hidden = true;
    section.dataset.state = "absent";
    body.replaceChildren();
    const live = byId(doc, PARTIAL_EVIDENCE_LIVE_ID);
    if (live) live.textContent = "";
    return null;
  }
  section.hidden = false;
  section.dataset.state = result.state;
  section.dataset.source = result.source;
  section.dataset.partial = String(result.partial);
  section.dataset.policyVersion = result.version;
  section.dataset.admissible = String(result.evidence.admissible);
  section.dataset.excluded = String(result.evidence.excludedCount);
  section.dataset.eligibilityScore = String(result.eligibility.score);
  section.dataset.aggregateEligible = String(result.eligibility.aggregateEligible);
  // The peer claim is a fact on the element, not only a sentence inside it, so
  // "was a comparison measured?" is one attribute a reviewer can read.
  section.dataset.peerMeasured = String(result.peer.measured);
  const confidence = CONFIDENCE[result.state] ?? CONFIDENCE[FINDING_STATE.insufficient];
  section.dataset.confidence = confidence.level;

  const headline = element(doc, "p", "pe-headline");
  const shape = element(doc, "span", "pe-headline-shape", STATE_SHAPE[result.state]);
  shape.setAttribute("aria-hidden", "true");
  headline.append(
    shape,
    element(doc, "strong", "pe-headline-word", STATE_WORD[result.state] ?? result.state),
    element(doc, "span", "pe-headline-text", result.headline),
  );

  const peer = element(doc, "p", "pe-peer", `${result.peer.statement} ${result.peer.reason ?? ""}`
    .trim());
  peer.dataset.measured = String(result.peer.measured);

  body.replaceChildren(
    slotLabel(doc, "Strongest evidence-backed finding"),
    headline,
    materialBlock(doc, result.material),
    slotLabel(doc, "Finding confidence"),
    element(doc, "p", "pe-confidence", `${confidence.label}. ${confidence.reason}`),
    slotLabel(doc, "Prioritized next action"),
    ...actionBlock(doc, result, { onAct }),
    slotLabel(doc, result.peer.measured
      ? "Peer comparison available"
      : "Peer comparison unavailable"),
    peer,
    disclosure(doc, result),
  );
  const live = byId(doc, PARTIAL_EVIDENCE_LIVE_ID);
  if (live) {
    live.textContent = `${STATE_WORD[result.state] ?? result.state}. `
      + `${result.material.label}: ${result.material.display}. `
      + `Next action: ${result.nextAction.statement}`;
  }
  return result;
}

/** Take the region off screen. The question it answers has no answer any more. */
export function clearPartialEvidence(doc) {
  return applyPartialEvidence(doc, null);
}

/** The question the shipped markup must carry, so a test can hold it to one. */
export const PARTIAL_EVIDENCE_HEADING = PARTIAL_EVIDENCE_QUESTION;
