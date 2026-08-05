// The five-fact intake, on the page (#1103).
//
// THE CONTROLS ARE AUTHORED, NOT BUILT. Every field, its visible label, its
// option list, and the three answer sentences ship in evolution.html, filled
// with the bundled example's own declared facts. So a visitor whose script
// never ran still meets a complete, labelled, keyboard-operable group and a
// coherent answer beside it; this module repaints the same slots, which is what
// proves the authored copy and the module's copy have not drifted.
//
// NOTHING LEAVES THE BROWSER. The form has no action and no method, submit is
// prevented, and the five declared facts are held in one module value for as
// long as the tab is open and written nowhere else — no request, no storage, no
// cookie. The estimator underneath reads no clock and makes no request either.
//
// EVERY STRING GOES THROUGH textContent. No node here is built from markup and
// no declared value is interpolated into one: the sentences are composed by
// `finops-declared-fact-intake.js` out of figures and authored words.

import { applyDeclaredFactEstimate } from "./finops-first-run-view.js";
import { EXAMPLE_DECLARED_FACTS } from "./finops-declared-fact-fixtures.js";
import {
  INTAKE_IDS, currentDeclaredFacts, intakeHeadline, intakeNextAction, intakeRecoverable,
  mixChoiceFor, readDeclaredFacts, setDeclaredFacts,
} from "./finops-declared-fact-intake.js";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function setText(doc, id, text) {
  const node = byId(doc, id);
  if (node && typeof text === "string") node.textContent = text;
  return node;
}

function setValue(doc, id, value) {
  const node = byId(doc, id);
  if (node) node.value = String(value ?? "");
  return node;
}

/** The five control values, mapped into the estimator's input shape. */
export function declaredFactsFromControls(doc) {
  return readDeclaredFacts({
    monthlySpendUsd: byId(doc, INTAKE_IDS.spend)?.value,
    mixChoice: byId(doc, INTAKE_IDS.mix)?.value,
    engineers: byId(doc, INTAKE_IDS.engineers)?.value,
    sizeBand: byId(doc, INTAKE_IDS.size)?.value,
    industry: byId(doc, INTAKE_IDS.industry)?.value,
  });
}

/**
 * Paint the answer spine, and the estimate block above it, from one set of
 * declared facts.
 *
 * THE SPINE IS THREE SENTENCES AND NOTHING ELSE: the headline with the figure
 * and its quartile, the modelled recoverable amount, and one next action. The
 * echoed inputs, the cohort basis, and the arithmetic are already behind the
 * estimate's own disclosure — the same details element this region has always
 * used — and `applyDeclaredFactEstimate` repaints them from these same facts,
 * so no second disclosure idiom enters the page.
 *
 * @returns the estimate it painted, so a caller can assert on it.
 */
export function applyDeclaredFactIntake(doc, facts = EXAMPLE_DECLARED_FACTS) {
  setDeclaredFacts(facts);
  const estimate = applyDeclaredFactEstimate(doc, facts);
  if (!estimate) return null;
  const block = byId(doc, INTAKE_IDS.answer);
  if (block) {
    block.dataset.provenance = estimate.provenance;
    block.dataset.tier = estimate.confidence.tier;
  }
  setText(doc, INTAKE_IDS.headline, intakeHeadline(estimate));
  setText(doc, INTAKE_IDS.recoverable, intakeRecoverable(estimate));
  setText(doc, INTAKE_IDS.action, intakeNextAction(estimate));
  return estimate;
}

/** Repaint from whatever the five controls currently hold. */
export function applyDeclaredFactIntakeFromControls(doc) {
  return applyDeclaredFactIntake(doc, declaredFactsFromControls(doc));
}

/**
 * Put the five controls back to the bundled example's declared facts and
 * repaint from the example itself.
 *
 * Repainting from `EXAMPLE_DECLARED_FACTS` rather than from the controls it just
 * filled is deliberate: the state this restores is the one a first-time visitor
 * meets, and reading it back out of the controls would make that claim depend on
 * the fill above having been exact.
 */
export function resetDeclaredFactIntake(doc) {
  fillControls(doc, EXAMPLE_DECLARED_FACTS);
  const estimate = applyDeclaredFactIntake(doc, EXAMPLE_DECLARED_FACTS);
  announce(doc, estimate);
  return estimate;
}

/** Put one set of declared facts into the five controls. */
function fillControls(doc, facts) {
  setValue(doc, INTAKE_IDS.spend, facts.monthlySpendUsd);
  setValue(doc, INTAKE_IDS.mix, mixChoiceFor(facts.providerMix));
  setValue(doc, INTAKE_IDS.engineers, facts.engineers);
  setValue(doc, INTAKE_IDS.size, facts.sizeBand);
  setValue(doc, INTAKE_IDS.industry, facts.industry);
}

/** Speak the headline once, on a deliberate act. */
function announce(doc, estimate) {
  if (estimate) setText(doc, INTAKE_IDS.live, intakeHeadline(estimate));
}

/**
 * Bind the intake.
 *
 * SUBMIT IS PREVENTED and repaints in place: this page navigates nowhere and
 * sends nothing. `input` and `change` are both bound because a number field
 * reports a keystroke on one and a select reports a choice on the other; a
 * browser that fires both simply repaints the same sentences twice, which is
 * why the paint is a repaint of authored slots rather than a rebuild.
 *
 * Nothing here intercepts a key. Enter inside a field is the browser's own
 * implicit submission, Enter and Space on either button are the button's, and
 * the arrow keys inside a select are the select's.
 */
export function bindDeclaredFactIntake(doc) {
  const form = byId(doc, INTAKE_IDS.form);
  if (!form) return null;
  form.addEventListener("submit", (event) => {
    event?.preventDefault?.();
    announce(doc, applyDeclaredFactIntakeFromControls(doc));
  });
  const revise = () => applyDeclaredFactIntakeFromControls(doc);
  form.addEventListener("input", revise);
  form.addEventListener("change", revise);
  byId(doc, INTAKE_IDS.clear)?.addEventListener("click", () => resetDeclaredFactIntake(doc));
  // The controls are filled from the facts the region is estimating from rather
  // than left to the authored `selected` attributes alone. The authored ones are
  // what a visitor whose script never ran gets, and they say the same thing;
  // setting them here means the value this module reads back is the value it
  // wrote, on every engine, instead of whatever a defaulting rule decided.
  fillControls(doc, currentDeclaredFacts());
  return form;
}
