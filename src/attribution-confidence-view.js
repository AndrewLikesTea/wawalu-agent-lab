// Where the confidence treatment becomes something a reader sees.
//
// Four slots, one painter, identical output. The KPI row, the spend-mix panel,
// the findings list, and the recoverable figure each own an authored-empty
// coverage node that sits *before* the number it qualifies in document order —
// not moved there with `order` or absolute positioning, because a screen reader
// and a Tab key both read the DOM, not the paint. The big number still dominates
// visually; it does that with type scale and weight, which is where dominance
// belongs.
//
// Like `finops-attribution-view.js` this takes the document rather than reading
// a global, and builds every node with createElement and textContent. No markup
// string, no innerHTML, nothing interpolated from a file.
//
// The announcer follows the pattern already shipped by
// `model-overspend-finding-view.js` and `graded-sample-view.js`: a small
// `announce(doc, text)` over one authored polite region, rather than a fifth
// mechanism for the same job.

import { CONFIDENCE } from "./finops-attribution-policy.js";
import { confidenceTreatment, coveragePercentText, SURFACES } from "./attribution-confidence.js";

/** Region that carries `data-confidence`, and the coverage node inside it. */
const SURFACE_NODES = Object.freeze({
  [SURFACES.KPI_ROW]: { region: "kpi-recoverable", coverage: "kpi-recoverable-coverage" },
  [SURFACES.SPEND_MIX]: { region: "spend-mix-panel", coverage: "mix-coverage" },
  [SURFACES.FINDINGS_LIST]: {
    region: "local-department-evidence", coverage: "local-departments-coverage",
  },
  [SURFACES.HEADLINE_FIGURE]: { region: "local-impact", coverage: "local-impact-coverage" },
});

const LIVE_ID = "coverage-live";
const RESULT_HEADING_ID = "local-results-title";
const UPGRADE_ID = "coverage-upgrade";
const UPGRADE_ACTION_ID = "coverage-upgrade-action";
const UPGRADE_JUMP_ID = "coverage-upgrade-jump";
const UPGRADE_MORE_ID = "coverage-upgrade-more";
const UPGRADE_REST_ID = "coverage-upgrade-rest";
/** The control an upgrade sends the reader to. One step, one target. */
const IMPORT_CONTROL_ID = "local-finops-files";
/** The attributed/unattributed pair, beside the headline figure it qualifies. */
const SPLIT_ID = "local-attribution-split";
/** What moved on the last recalculation, kept until the next one replaces it. */
const CHANGE_ID = "local-result-change";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The chip. Filled washes are reserved for dynamic signals and outlines for
 * static classification, so this is an outline: a finding's confidence is a
 * classification of the finding, not a live state of the page.
 *
 * The shape is `aria-hidden` and the word is not, so the state survives both a
 * monochrome screenshot and a font that has no glyph for the shape.
 */
export function confidenceChip(doc, confidence) {
  const treatment = confidenceTreatment(confidence);
  const chip = element(doc, "span", "confidence-chip");
  chip.dataset.confidence = treatment.state;
  const shape = element(doc, "span", "confidence-chip-shape", treatment.shape);
  shape.setAttribute("aria-hidden", "true");
  chip.append(shape, element(doc, "span", "confidence-chip-label", treatment.label));
  return chip;
}

/**
 * One surface's coverage line. Full confidence gets the sentence and no chip:
 * it is the baseline, and a success badge on an ordinary number teaches a reader
 * that the unbadged ones are broken. Degraded and suppressed get the chip, and
 * suppressed additionally gets the sentence saying what is withheld and what
 * would release it.
 */
function paintSurface(doc, surface, model) {
  const ids = SURFACE_NODES[surface];
  if (!ids) return null;
  const region = byId(doc, ids.region);
  const node = byId(doc, ids.coverage);
  if (region) region.dataset.confidence = model ? model.treatment.state : "";
  if (!node) return null;
  if (!model) {
    node.replaceChildren();
    node.hidden = true;
    node.dataset.confidence = "";
    return null;
  }
  const { treatment } = model;
  node.dataset.confidence = treatment.state;
  const parts = [element(doc, "span", "coverage-lead-figure", model.statement)];
  // The statement already ends in the confidence word, so the chip repeats it on
  // purpose: the word travels with the shape wherever the chip is scanned
  // separately from the sentence, and the sentence stands alone in a screen
  // reader's line-by-line read. Full confidence ships the word once, in the
  // sentence, and no chip at all.
  if (treatment.decorated) parts.push(confidenceChip(doc, model.confidence));
  if (model.reason) parts.push(element(doc, "span", "coverage-lead-reason", model.reason));
  node.replaceChildren(...parts);
  node.hidden = false;
  return model;
}

/**
 * The single upgrade affordance: one action, the file it names, and the coverage
 * it would buy. Everything else that could still be supplied goes behind one
 * disclosure, closed. Nothing is offered that would add no coverage, so a result
 * already at 100% shows no action rather than an invitation to reach 100%.
 */
export function applyCoverageUpgrade(doc, upgrade) {
  const region = byId(doc, UPGRADE_ID);
  if (!region) return null;
  const action = byId(doc, UPGRADE_ACTION_ID);
  const jump = byId(doc, UPGRADE_JUMP_ID);
  const more = byId(doc, UPGRADE_MORE_ID);
  const rest = byId(doc, UPGRADE_REST_ID);
  const top = upgrade?.top ?? null;
  const others = (upgrade?.rest ?? []).filter(Boolean);
  if (!top && !others.length) {
    region.hidden = true;
    region.dataset.state = "none";
    if (action) action.textContent = "";
    if (jump) jump.hidden = true;
    if (more) more.hidden = true;
    if (rest) rest.replaceChildren();
    return null;
  }
  region.hidden = false;
  region.dataset.state = top ? "available" : "precision-only";
  if (action) {
    action.textContent = top ? top.text : others[0].text;
    action.dataset.upgrade = top ? top.id : others[0].id;
  }
  if (jump) {
    jump.hidden = false;
    jump.setAttribute("aria-label",
      `${jump.textContent} — moves focus to the file control that adds this input`);
    if (!jump.dataset.bound) {
      jump.dataset.bound = "true";
      jump.addEventListener("click", () => byId(doc, IMPORT_CONTROL_ID)?.focus?.());
    }
  }
  // With a primary action shown, the disclosure holds the remainder. Without
  // one, the first precision entry has already been promoted into the action
  // slot above, so it is not repeated inside.
  const disclosed = top ? others : others.slice(1);
  if (rest) {
    rest.replaceChildren(...disclosed.map((entry) => {
      const item = element(doc, "li", "coverage-upgrade-rest-item", entry.text);
      item.dataset.upgrade = entry.id;
      return item;
    }));
  }
  if (more) more.hidden = disclosed.length === 0;
  return top ?? others[0];
}

/**
 * Paint all four surfaces and the upgrade action from one model. Passing null
 * clears every slot, which is what an unloaded or cleared analysis needs: a
 * stale "covers 68% of spend" left beside an empty figure is worse than no
 * sentence at all.
 */
export function applyCoverageTreatment(doc, model) {
  for (const surface of Object.values(SURFACES)) {
    paintSurface(doc, surface, model?.surfaces?.[surface] ?? null);
  }
  applyCoverageUpgrade(doc, model?.upgrade ?? null);
  return model ?? null;
}

/**
 * The attributed share and the unattributed bucket, beside the headline figure.
 *
 * A partially attributed result is a real result over the attributed part, and
 * the way to make it read that way is to put both halves next to the number in
 * document order — not to caption the number with a warning. Both halves carry
 * their money and their share, so 68% never has to be taken on trust.
 *
 * @param {object} doc the document.
 * @param {object|null} split a `coverageSplit` result, or null to clear.
 * @param {{formatMoney?: (value: number) => string}} [options]
 */
export function applyAttributionSplit(doc, split, { formatMoney = String } = {}) {
  const region = byId(doc, SPLIT_ID);
  if (!region) return null;
  if (!split || !(split.total > 0)) {
    region.replaceChildren();
    region.hidden = true;
    region.dataset.state = "unmeasured";
    return null;
  }
  const attributedShare = split.attributed / split.total;
  const unattributed = Math.max(0, split.total - split.attributed);
  const parts = [
    { id: "attributed", term: "Attributed", cost: split.attributed, share: attributedShare },
    { id: "unattributed", term: "Not attributed", cost: unattributed, share: 1 - attributedShare },
  ];
  region.dataset.state = unattributed > 0 ? "partial" : "complete";
  // `dt`/`dd` straight into the grouping div the markup already declares: the
  // region sits inside the finding's own definition list, so the two halves are
  // name/value pairs there rather than a second list nested in it. The shape
  // lives inside the term because only `dt` and `dd` belong here.
  region.replaceChildren(...parts.flatMap((part) => {
    const shape = element(doc, "span", "attribution-split-shape",
      part.id === "attributed" ? "◤" : "◇");
    shape.setAttribute("aria-hidden", "true");
    const term = element(doc, "dt", "attribution-split-term");
    term.dataset.part = part.id;
    term.append(shape, element(doc, "span", "attribution-split-term-text", part.term));
    // Share and money together: the percentage says how much of the result this
    // is, the amount says what it is worth, and neither alone is enough to
    // decide whether the headline can be acted on.
    const value = element(doc, "dd", "attribution-split-value",
      `${coveragePercentText(part.share)} · ${formatMoney(part.cost)}`);
    value.dataset.part = part.id;
    return [term, value];
  }));
  region.hidden = false;
  return Object.freeze({ attributedShare, attributed: split.attributed, unattributed });
}

/**
 * What moved when the reader added a file, kept on the page rather than spoken
 * and gone. Each row names the figure it is about and both of its values, so the
 * summary can be re-read after the live region has been forgotten.
 *
 * @param {object} doc the document.
 * @param {object|null} summary a `coverageChangeSummary` result, or null to clear.
 */
export function applyChangeSummary(doc, summary) {
  const region = byId(doc, CHANGE_ID);
  if (!region) return null;
  if (!summary || !summary.items.length) {
    region.replaceChildren();
    region.hidden = true;
    region.dataset.state = "none";
    return null;
  }
  region.dataset.state = "changed";
  const list = element(doc, "ul", "result-change-list");
  list.setAttribute("aria-label", "Figures that moved");
  list.replaceChildren(...summary.items.map((item) => {
    const row = element(doc, "li", "result-change-item");
    row.dataset.figure = item.id;
    row.append(
      element(doc, "span", "result-change-label", item.label),
      element(doc, "span", "result-change-move", `${item.from} → ${item.to}`),
    );
    return row;
  }));
  region.replaceChildren(
    element(doc, "p", "result-change-headline", summary.headline),
    list,
  );
  region.hidden = false;
  return summary;
}

/** The polite region. Same shape as the other announcers on this page. */
export function announce(doc, text) {
  const live = byId(doc, LIVE_ID);
  if (!live) return null;
  live.textContent = text ?? "";
  return live.textContent || null;
}

/**
 * Announce a recalculated coverage and put the caret somewhere that still
 * exists. Focus moves to the result heading — already `tabindex="-1"` — rather
 * than to the control that triggered the change, because that control may have
 * been the file input for a file the reader has now supplied.
 *
 * Focus moves only when there is something to announce. An initial render has no
 * previous model, so `coverageChangeAnnouncement` returns null and this is inert;
 * an unrelated re-render produces the same percentage and the same
 * classifications, so it is inert there too.
 */
export function announceCoverageChange(doc, text, { moveFocus = true } = {}) {
  if (!text) return null;
  announce(doc, text);
  if (moveFocus) byId(doc, RESULT_HEADING_ID)?.focus?.();
  return text;
}

/**
 * The confidence word for one surface, as text. Exported for callers that need
 * the state in an accessible name rather than in a live region — persistent
 * state has to be readable from the elements themselves, and an announcement
 * that has already been spoken is not readable at all.
 */
export function confidenceLabelFor(model) {
  return confidenceTreatment(model?.confidence ?? CONFIDENCE.SUPPRESSED).label;
}
