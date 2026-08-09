// The declared-rate intake, on the page (#1481).
//
// THE CONTROLS ARE AUTHORED, NOT BUILT, exactly as the five-fact intake above
// it is: the textarea, its visible label, both buttons and the two answer
// paragraphs ship in evolution.html, so a visitor whose script never ran still
// meets a complete, labelled, keyboard-operable form. This module binds it and
// repaints slots; it creates no node.
//
// WHERE IT SITS, AND WHY NOT BESIDE THE FIGURE. The provenance this changes is
// painted at the top of the page, and the first screen has no spare tab stop —
// tests/finops-first-viewport.test.js holds the page to meeting no control
// before its first answer. So the control lives below the first-run region,
// inside the "bring your own exports" panel where every other control on this
// page already lives, and the three slots it moves are the ones the answer
// region already ships. Nothing new is authored above the fold.
//
// NOTHING LEAVES THE BROWSER. The form has no action and no method, submit is
// prevented, and the parsed declaration is held in one module value for as long
// as the tab is open and written nowhere else — no request, no storage, no
// cookie. The contract under it refuses credential-shaped and contact-shaped
// text outright rather than holding it.
//
// EVERY STRING GOES THROUGH textContent. No node here is built from markup and
// no declared value is interpolated into one: every sentence is composed by
// finops-declared-rate-contract.js out of its own copy, an enum, and figures.

import { analysisDateOf } from "./finops-pricing-provenance.js";
import { applyPricingProvenance } from "./finops-pricing-provenance-view.js";
import { applyRateCardLadder } from "./finops-rate-card-view.js";
import { parseRateDeclaration, recomputeProvenance } from "./finops-declared-rate-contract.js";

/** The slots this region authors. */
export const DECLARED_RATE_IDS = Object.freeze({
  form: "declared-rates-form",
  input: "declared-rates-input",
  clear: "declared-rates-clear",
  status: "declared-rates-status",
  attribution: "declared-rates-attribution",
});

/** The state with no declaration, restated so the clear path cannot drift from it. */
export const NO_DECLARATION_STATUS =
  "No contracted rates declared. The figure above stays priced at the published list.";

/** The declaration this tab is holding, and nothing else holds. */
let declaration = null;

/** What this module last painted, so a test can assert on the same record. */
let painted = null;

export const currentRateDeclaration = () => declaration;
export const currentDeclaredProvenance = () => painted;

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function setStatus(doc, state, message) {
  const node = byId(doc, DECLARED_RATE_IDS.status);
  if (!node) return null;
  node.dataset.state = state;
  node.textContent = message;
  return node;
}

/**
 * Repaint the pricing-provenance surface from a declaration.
 *
 * One path for all three states: an absent or rejected declaration recomputes
 * against no card, which is the published-list reference card, which is what the
 * page was already showing. So the no-declaration render is byte-identical to
 * the render before this module existed.
 *
 * @returns the recomputed record, so a caller can assert on the same figures.
 */
export function applyDeclaredRates(doc, { asOf = null, destinations } = {}) {
  const result = recomputeProvenance({
    declaration,
    asOf,
    ...(destinations ? { destinations } : {}),
  });
  // The same two surfaces the page already paints, from the card this
  // declaration built rather than from a second scale invented here.
  applyPricingProvenance(doc, result.verdict);
  applyRateCardLadder(doc, result.confidence);
  const attribution = byId(doc, DECLARED_RATE_IDS.attribution);
  if (attribution) attribution.textContent = result.attribution;
  painted = result;
  return result;
}

/** Read the textarea, parse it, and either apply it or hand every problem back. */
export function submitRateDeclaration(doc, { asOf = null, destinations } = {}) {
  const raw = byId(doc, DECLARED_RATE_IDS.input)?.value ?? "";
  const parsed = parseRateDeclaration(raw);
  if (!parsed.valid) {
    declaration = null;
    const result = applyDeclaredRates(doc, { asOf, destinations });
    setStatus(doc, parsed.errors.length > 0 ? "rejected" : "empty",
      parsed.errors.length > 0
        // Every problem in one announcement: a reader fixes the paste once.
        ? `${parsed.errors.length} of these lines were refused, so none were applied. `
          + parsed.errors.map((error) => error.message).join(" ")
        : NO_DECLARATION_STATUS);
    return result;
  }
  declaration = parsed;
  const result = applyDeclaredRates(doc, { asOf, destinations });
  setStatus(doc, "accepted",
    `${parsed.records.length} declared rates applied. Pricing provenance is now ${result.label} — `
    + `${result.score.toFixed(1)} of 100.`);
  return result;
}

/** Drop the declaration and return the page to the published-list state. */
export function clearRateDeclaration(doc, { asOf = null, destinations } = {}) {
  declaration = null;
  const input = byId(doc, DECLARED_RATE_IDS.input);
  if (input) input.value = "";
  const result = applyDeclaredRates(doc, { asOf, destinations });
  setStatus(doc, "empty", NO_DECLARATION_STATUS);
  return result;
}

/**
 * Bind the authored form. Total: a document missing the region is left alone
 * rather than throwing through the boot of a page this control is not on.
 *
 * @param period the analysis's own stated period. The effective dates are judged
 *   against the LAST date in it — never a clock — so the score does not change on
 *   a page left open overnight.
 */
export function bindDeclaredRateIntake(doc, { period = null, destinations } = {}) {
  const form = byId(doc, DECLARED_RATE_IDS.form);
  if (!form) return null;
  const asOf = analysisDateOf(period);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitRateDeclaration(doc, { asOf, destinations });
  });
  byId(doc, DECLARED_RATE_IDS.clear)?.addEventListener("click", () => {
    clearRateDeclaration(doc, { asOf, destinations });
  });
  return form;
}
