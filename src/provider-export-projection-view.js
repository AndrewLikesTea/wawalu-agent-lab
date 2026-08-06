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

/** The word every downgraded figure carries, so no figure can be read as a full-import one. */
const TIER_MARK = "downgraded tier";

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
