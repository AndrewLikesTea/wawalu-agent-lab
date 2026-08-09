// The DOM seam for a selected provider export.
//
// The evidence-preflight region already has a render function, a closed
// `data-outcome` vocabulary its stylesheet is keyed on, and a verdict/boundary
// structure. This module therefore paints nothing itself: it restates the
// projection in that contract and hands it to the shipped renderer, so a
// selected export and the bundled example cannot drift into two layouts or two
// sets of outcome names.

import { providerExportPreflight } from "./provider-export-projection.js";
import {
  renderOwnDataEvidencePreflight, retireDowngradedTier,
} from "./own-data-evidence-preflight-view.js";
import { renderModelOverspendFinding } from "./model-overspend-finding-view.js";

/** The word every downgraded figure carries, so no figure can be read as a full-import one. */
const TIER_MARK = "downgraded tier";
const WITHHELD = Object.freeze({
  malformed_source_rows: ["The producer supplied unreadable rows; no savings were estimated.",
    "Correct the producer rows named in validation, then import a new export."],
  conflicting_revisions: ["The producer supplied conflicting aggregate revisions.",
    "Export one authoritative revision per aggregate, then import it again."],
  unsafe_aggregate: ["The accepted values cannot be safely aggregated.",
    "Correct out-of-range request or cost values, then import the export again."],
  no_source_rows: ["No provider usage rows support a model finding.",
    "Export usage rows with month, workload, model, request count, and cost, then import again."],
});

function node(doc, tag, className, text) {
  const item = doc.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

function importSource(doc, projection) {
  const p = projection?.provenance;
  if (!p) return null;
  const block = node(doc, "div", "model-overspend-import-source");
  block.setAttribute("role", "note");
  block.setAttribute("aria-label", "Import source provenance");
  const accepted = p.acceptedRows ?? p.sourceRows ?? 0;
  const total = p.sourceRows ?? accepted;
  block.append(node(doc, "p", "model-overspend-import-source-label", "Import source"),
    node(doc, "p", "model-overspend-import-source-summary",
      `Selected provider export · ${accepted} of ${total} rows accepted · `
      + `${p.rejectedRows ?? total - accepted} rejected · ${p.supersededRows ?? 0} superseded`),
    node(doc, "p", "model-overspend-import-source-boundary",
      "Computed in browser memory only; no upload or external lookup."));
  return block;
}

/**
 * Render an imported finding or its producer-evidence refusal in the same result
 * article, and in both cases say which export the article was built from.
 *
 * The eligible path hands the source block to the finding renderer as a builder
 * rather than appending it afterwards, because that renderer owns the body and
 * rebuilds it on every disclosure toggle and rename. Appending here would put
 * the provenance on screen until the reader's first click and no longer — the
 * decision-relevant path is exactly the one that loses it.
 */
export function renderImportedModelOverspendProjection(doc, projection, { storage = null } = {}) {
  const section = doc.getElementById("model-overspend");
  if (!section || !projection) return null;
  if (projection.finding) {
    return renderModelOverspendFinding(doc, projection.finding,
      { storage, importSource: (target) => importSource(target, projection) }) ?? section;
  }
  const body = doc.getElementById("model-overspend-body");
  if (!body) return null;
  const [reason, actionText] = WITHHELD[projection.withholding?.[0]?.code]
    ?? WITHHELD.no_source_rows;
  section.hidden = false;
  section.dataset.status = "unavailable";
  section.dataset.expanded = "false";
  const question = doc.getElementById("model-overspend-question");
  if (question) {
    question.textContent = "What evidence is needed for a model down-routing finding?";
  }
  const status = node(doc, "p", "model-overspend-state");
  status.dataset.status = "unavailable";
  const shape = node(doc, "span", "status-shape", "○");
  shape.setAttribute("aria-hidden", "true");
  status.append(shape, node(doc, "span", "model-overspend-state-word",
    "Finding withheld — insufficient evidence"));
  const metric = node(doc, "div", "model-overspend-metric");
  metric.dataset.available = "false";
  metric.append(node(doc, "p", "model-overspend-metric-label", "Recoverable monthly spend"),
    node(doc, "p", "model-overspend-metric-withheld", "Withheld"),
    node(doc, "p", "model-overspend-metric-reason", reason));
  const action = node(doc, "p", "model-overspend-action");
  action.dataset.available = "false";
  action.append(node(doc, "span", "model-overspend-action-label", "Do this next"),
    node(doc, "span", "model-overspend-action-text", actionText));
  // No control in this body calls back into a repaint, so the source block is
  // appended directly here rather than through the builder seam above.
  body.replaceChildren(...[status, metric, action, importSource(doc, projection)].filter(Boolean));
  return section;
}

function line(document, parts, data) {
  const item = document.createElement("li");
  Object.assign(item.dataset, data);
  item.append(...parts.map(([tag, text]) => {
    const part = document.createElement(tag);
    part.textContent = text;
    return part;
  }));
  return item;
}

/**
 * Paint the downgraded tier's two lists into the region's own block.
 *
 * The renderer does not decide what is missing: it reads `computed` and
 * `withheld` off the assessment, one list item per entry, in the order the
 * preflight published them. A withheld line reads as three parts — the figure,
 * the field that is missing, the export that supplies it — rather than as one
 * sentence a reader has to parse to find the column name.
 */
function paintDowngradedTier(document, assessment) {
  const block = retireDowngradedTier(document);
  const computed = document.getElementById("own-data-preflight-computed");
  const withheld = document.getElementById("own-data-preflight-withheld");
  if (!block || !computed || !withheld || !assessment.tier) return;
  block.hidden = false;
  block.dataset.tier = assessment.tier;
  computed.replaceChildren(...assessment.computed.map((entry) => line(document, [
    ["strong", entry.label], ["span", entry.display], ["span", TIER_MARK],
  ], { figure: entry.id, tier: entry.tier })));
  withheld.replaceChildren(...assessment.withheld.map((entry) => line(document, [
    ["strong", entry.figure], ["span", `missing field: ${entry.field}`],
    ["span", `supplied by: ${entry.recipeLabel}`],
  ], { figure: entry.id, field: entry.field, recipe: entry.recipe, tier: entry.tier })));
}

/** Paint the existing evidence region from a selected provider export. */
export function renderProviderExportProjection(document, projection) {
  if (!projection?.ok) return false;
  const assessment = providerExportPreflight(projection);
  if (!renderOwnDataEvidencePreflight(document, assessment)) return false;
  paintDowngradedTier(document, assessment);
  return true;
}
