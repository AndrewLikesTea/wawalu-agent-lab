// The DOM seam for a selected provider export.
//
// The evidence-preflight region already has a render function, a closed
// `data-outcome` vocabulary its stylesheet is keyed on, and a verdict/boundary
// structure. This module therefore paints nothing itself: it restates the
// projection in that contract and hands it to the shipped renderer, so a
// selected export and the bundled example cannot drift into two layouts or two
// sets of outcome names.

import { providerExportPreflight } from "./provider-export-projection.js";
import { renderOwnDataEvidencePreflight } from "./own-data-evidence-preflight-view.js";

/** Paint the existing evidence region from a selected provider export. */
export function renderProviderExportProjection(document, projection) {
  if (!projection?.ok) return false;
  return renderOwnDataEvidencePreflight(document, providerExportPreflight(projection));
}
