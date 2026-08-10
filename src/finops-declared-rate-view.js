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
// What a browser is allowed to remember of the two facts only this reader
// established, and the only way in or out of it (#1484).
import {
  RETAINED_REASON, clearRetainedState, loadRetainedState, retainedProvenanceLine,
  saveRetainedState,
} from "./finops-retained-state.js";

/** The slots this region authors. */
export const DECLARED_RATE_IDS = Object.freeze({
  form: "declared-rates-form",
  input: "declared-rates-input",
  clear: "declared-rates-clear",
  status: "declared-rates-status",
  attribution: "declared-rates-attribution",
});

/**
 * The retention slots. The provenance line is the only one on the FIRST SCREEN,
 * and it is a paragraph and not a control: the first screen has no spare tab
 * stop, so what a reader must SEE is up there beside the figure it explains and
 * what they must PRESS is down here beside the form that wrote it.
 */
export const RETAINED_STATE_IDS = Object.freeze({
  line: "finops-retained-state",
  reset: "retained-state-reset",
  confirm: "retained-state-confirm",
  status: "retained-state-status",
});

/** The reset copy, stated once so the confirm step and the status cannot drift. */
export const RETAINED_RESET_COPY = Object.freeze({
  arm: "This removes the retained declared rates and scored coverage from this browser and "
    + "returns the figures above to their unretained baseline. Press Forget retained state again "
    + "to cancel.",
  idle: "Nothing is retained in this browser.",
  kept: "The copy retained in this browser is kept. Use Forget retained state to remove it.",
});

/** The state with no declaration, restated so the clear path cannot drift from it. */
export const NO_DECLARATION_STATUS =
  "No contracted rates declared. The figure above stays priced at the published list.";

/** The declaration this tab is holding, and nothing else holds. */
let declaration = null;

/** What this module last painted, so a test can assert on the same record. */
let painted = null;

/** How this tab reaches retained state, and what it stamps a write with. */
let retention = { storage: undefined, scoredCoverageOf: () => null, now: () => new Date() };

/** The last store outcome painted, so a test asserts on the same record. */
let retained = null;

export const currentRateDeclaration = () => declaration;
export const currentDeclaredProvenance = () => painted;
export const currentRetainedState = () => retained;

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

/** One live paragraph, by id: the state as a data attribute, the sentence as text. */
function setStatus(doc, id, message, state) {
  const node = byId(doc, id);
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

// ---------------------------------------------------------------------------
// RETAINED STATE (#1484)
// ---------------------------------------------------------------------------

/**
 * Paint the first screen's one retention slot from a store outcome.
 *
 * THREE STATES, ONE SLOT. Retained: the provenance line — when it was captured
 * and what above depends on it. Degraded: the store's own refusal sentence, so a
 * reader is told the figures are the baseline and why. Unretained: empty and
 * `hidden`, which is what keeps a fresh visitor's first screen byte-for-byte the
 * one this page shipped before any of this existed.
 */
function paintRetained(doc, outcome) {
  retained = outcome;
  const line = byId(doc, RETAINED_STATE_IDS.line);
  if (!line) return outcome;
  const reason = outcome?.reason ?? RETAINED_REASON.unretained;
  const text = outcome?.retained
    ? retainedProvenanceLine(outcome.payload)
    : (reason === RETAINED_REASON.unretained ? "" : outcome?.message ?? "");
  line.dataset.state = reason;
  // The LIVE region this retained state explains, already carried through the
  // retirement table by the store (#1500). An entry written before the
  // consolidation named a region this page deleted; stamping what it resolved
  // to is what keeps a restored provenance line attached to the figure it is
  // about instead of to nothing.
  if (outcome?.payload?.region) line.dataset.region = outcome.payload.region;
  line.textContent = text;
  line.hidden = text === "";
  const reset = byId(doc, RETAINED_STATE_IDS.reset);
  // Offered only when there is something to forget: a control that clears
  // nothing teaches a reader that something was kept.
  if (reset) reset.hidden = !outcome?.retained;
  return outcome;
}

/** The coverage the graded floor was taken at, in the two fields the store keeps. */
function coverageToRetain() {
  const floor = retention.scoredCoverageOf?.() ?? null;
  return {
    coverage: typeof floor?.coverage === "number" ? floor.coverage : null,
    departmentIds: Array.isArray(floor?.departmentIds) ? [...floor.departmentIds] : [],
  };
}

/** Write the accepted declaration and today's scored coverage through. */
function retainDeclaration(doc, parsed) {
  const outcome = saveRetainedState({
    declaredRates: parsed.records.map(({ model, unit, rate, effectiveDate, sourceLabel }) => (
      { model, unit, rate, effectiveDate, sourceLabel })),
    scoredCoverage: coverageToRetain(),
    capturedAt: retention.now(),
    ...(retention.storage === undefined ? {} : { storage: retention.storage }),
  });
  paintRetained(doc, outcome);
  setStatus(doc, RETAINED_STATE_IDS.status, outcome.message, outcome.reason);
  return outcome;
}

/**
 * Hydrate the page from retained state, once, at bind time.
 *
 * The retained records are re-parsed through the SAME contract a paste goes
 * through rather than trusted because they were stored: a browser is not a
 * validator, and an entry that no longer passes intake is discarded here exactly
 * as a bad paste is.
 *
 * A load that retains nothing paints nothing and applies nothing, so the served
 * document is what a fresh visitor keeps meeting.
 */
export function hydrateRetainedState(doc, { asOf = null, destinations } = {}) {
  const outcome = loadRetainedState(
    retention.storage === undefined ? {} : { storage: retention.storage });
  if (!outcome.retained) {
    paintRetained(doc, outcome);
    setStatus(doc, RETAINED_STATE_IDS.status,
      outcome.reason === RETAINED_REASON.unretained
        ? RETAINED_RESET_COPY.idle : outcome.message, outcome.reason);
    return outcome;
  }
  const parsed = parseRateDeclaration(outcome.payload.declaredRates);
  if (!parsed.valid) {
    const refused = { ...outcome, retained: false, payload: null,
      reason: RETAINED_REASON.invalidShape, message: parsed.errors[0]?.message
        ?? "The retained declaration no longer passes intake, so it was discarded." };
    paintRetained(doc, refused);
    setStatus(doc, RETAINED_STATE_IDS.status, refused.message, refused.reason);
    return refused;
  }
  declaration = parsed;
  const input = byId(doc, DECLARED_RATE_IDS.input);
  if (input) input.value = "";
  const result = applyDeclaredRates(doc, { asOf, destinations });
  setStatus(doc, DECLARED_RATE_IDS.status, `${parsed.records.length} declared rates restored from `
    + `this browser. Pricing provenance is now ${result.label} — ${result.score.toFixed(1)} of `
    + "100.", "accepted");
  paintRetained(doc, outcome);
  setStatus(doc, RETAINED_STATE_IDS.status, outcome.message, outcome.reason);
  return outcome;
}

/** Forget the retained entry, then return the page to the unretained baseline. */
export function resetRetainedState(doc, { asOf = null, destinations } = {}) {
  const outcome = clearRetainedState(
    retention.storage === undefined ? {} : { storage: retention.storage });
  // Painted before the figures are reset, so the reset's own status line is not
  // the one written for a page that still had something retained.
  paintRetained(doc, { retained: false, payload: null,
    reason: outcome.cleared ? RETAINED_REASON.unretained : outcome.reason,
    message: outcome.message });
  clearRateDeclaration(doc, { asOf, destinations });
  setStatus(doc, RETAINED_STATE_IDS.status, outcome.message, outcome.reason);
  return outcome;
}

/** Read the textarea, parse it, and either apply it or hand every problem back. */
export function submitRateDeclaration(doc, { asOf = null, destinations } = {}) {
  const raw = byId(doc, DECLARED_RATE_IDS.input)?.value ?? "";
  const parsed = parseRateDeclaration(raw);
  if (!parsed.valid) {
    declaration = null;
    const result = applyDeclaredRates(doc, { asOf, destinations });
    setStatus(doc, DECLARED_RATE_IDS.status,
      parsed.errors.length > 0
        // Every problem in one announcement: a reader fixes the paste once.
        ? `${parsed.errors.length} of these lines were refused, so none were applied. `
          + parsed.errors.map((error) => error.message).join(" ")
        : NO_DECLARATION_STATUS,
      parsed.errors.length > 0 ? "rejected" : "empty");
    return result;
  }
  declaration = parsed;
  const result = applyDeclaredRates(doc, { asOf, destinations });
  setStatus(doc, DECLARED_RATE_IDS.status,
    `${parsed.records.length} declared rates applied. Pricing provenance is now ${result.label} — `
    + `${result.score.toFixed(1)} of 100.`, "accepted");
  // Accepted, so it is retained: this is the action that establishes the rates,
  // and a write that waited for a second control would keep a reader's declared
  // card only when they found it.
  retainDeclaration(doc, parsed);
  return result;
}

/**
 * Drop the declaration and return the page to the published-list state.
 *
 * SESSION-LEVEL, and it says so. What this browser retained survives, because
 * "return to list prices" is a question about the figures above and forgetting
 * is a question about the browser — collapsing the two would delete a reader's
 * declaration on a press that never mentioned it.
 */
export function clearRateDeclaration(doc, { asOf = null, destinations } = {}) {
  declaration = null;
  const input = byId(doc, DECLARED_RATE_IDS.input);
  if (input) input.value = "";
  const result = applyDeclaredRates(doc, { asOf, destinations });
  setStatus(doc, DECLARED_RATE_IDS.status, retained?.retained
    ? `${NO_DECLARATION_STATUS} ${RETAINED_RESET_COPY.kept}` : NO_DECLARATION_STATUS, "empty");
  return result;
}

/**
 * Bind the authored form. Total: a document missing the region is left alone
 * rather than throwing through the boot of a page this control is not on.
 *
 * @param period the analysis's own stated period. The effective dates are judged
 *   against the LAST date in it — never a clock — so the score does not change on
 *   a page left open overnight.
 * @param storage the retained store, injected in tests. Omitted on the page, so
 *   the store reaches for the wrapped browser accessor itself.
 * @param scoredCoverageOf reads the graded floor's coverage at the moment a
 *   declaration is accepted. A getter and not a value, because the floor is
 *   recomputed when an import lands.
 * @param now the clock a write is stamped with. Injected so a test is not asked
 *   to assert on the millisecond it ran in.
 */
export function bindDeclaredRateIntake(doc, {
  period = null, destinations, storage, scoredCoverageOf, now,
} = {}) {
  const form = byId(doc, DECLARED_RATE_IDS.form);
  if (!form) return null;
  const asOf = analysisDateOf(period);
  retention = {
    storage,
    scoredCoverageOf: typeof scoredCoverageOf === "function" ? scoredCoverageOf : () => null,
    now: typeof now === "function" ? now : () => new Date(),
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitRateDeclaration(doc, { asOf, destinations });
  });
  byId(doc, DECLARED_RATE_IDS.clear)?.addEventListener("click", () => {
    clearRateDeclaration(doc, { asOf, destinations });
  });
  // TWO PRESSES TO FORGET, and the second one is a control that does not exist
  // until the first is pressed: the same shape as the workspace's confirm pair,
  // and one press cannot be a deletion. Pressing the first again is the cancel,
  // so no third control is authored above a form that already has three.
  const reset = byId(doc, RETAINED_STATE_IDS.reset);
  const confirm = byId(doc, RETAINED_STATE_IDS.confirm);
  reset?.addEventListener("click", () => {
    const arming = confirm ? confirm.hidden : false;
    if (confirm) confirm.hidden = !arming;
    setStatus(doc, RETAINED_STATE_IDS.status,
      arming ? RETAINED_RESET_COPY.arm : (retained?.message ?? RETAINED_RESET_COPY.idle),
      arming ? "arming" : (retained?.reason ?? RETAINED_REASON.unretained));
  });
  confirm?.addEventListener("click", () => {
    confirm.hidden = true;
    resetRetainedState(doc, { asOf, destinations });
    // The pressed control is gone, so focus is put somewhere deliberate rather
    // than dropped to the top of the document.
    reset?.focus?.();
  });
  // Hydrate LAST: every binding above is in place, so the paint this may cause
  // is the same paint a reader's own press would cause.
  hydrateRetainedState(doc, { asOf, destinations });
  return form;
}
