// Paint the first-run synthetic result into the slots evolution.html authors.
//
// The markup is authored in its pending state and never replaced: the region,
// its headings, its three slot labels, both next actions, and the sample label
// are all in the document before any script runs, so a reader meets a coherent
// block — and, crucially, meets the "invented sample data" sentence — even if
// this module never executes. That is the same rule the local-workspace privacy
// boundary follows: a claim about what a number is has to be true before the
// number is painted, not after.
//
// Nothing here assigns markup. Every string arrives through textContent, and
// every node is built with createElement, because the strings below include a
// contract's own operation line and a department label taken out of an analysis.

import { FIRST_RUN_ACTIONS, FIRST_RUN_CONVERSION, FIRST_RUN_IDS } from "./finops-first-run.js";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function setText(doc, id, text) {
  const node = byId(doc, id);
  if (node && typeof text === "string") node.textContent = text;
  return node;
}

/**
 * Paint one slot: the value, its detail, and the availability flag the
 * stylesheet reads. `data-available` is never the only channel — an unavailable
 * slot says the word "Unavailable" in its value, which is what survives a
 * greyscale screenshot and a screen reader alike.
 */
function paintSlot(doc, valueId, detailId, slot) {
  const value = setText(doc, valueId, slot?.value ?? "");
  if (value) value.dataset.available = slot?.available ? "true" : "false";
  const detail = setText(doc, detailId, slot?.detail ?? "");
  if (detail) detail.hidden = !slot?.detail;
  return value;
}

/**
 * Apply a composed result to the document.
 *
 * @returns the region, so a caller can assert on the state it asked for.
 */
export function applyFirstRunResult(doc, result) {
  const region = byId(doc, FIRST_RUN_IDS.region);
  if (!region || !result) return null;
  const presentation = result.presentation ?? {};

  region.dataset.state = presentation.state ?? "pending";
  region.dataset.tone = presentation.tone ?? "neutral";
  setText(doc, FIRST_RUN_IDS.shape, presentation.shape ?? "◇");
  setText(doc, FIRST_RUN_IDS.word, presentation.word ?? "");

  // The sample label is repainted rather than assumed: the authored copy and
  // the module's copy are the same sentence, and repainting is what proves it.
  const sample = byId(doc, FIRST_RUN_IDS.sample);
  if (sample && result.sample) {
    const shape = doc.createElement("span");
    shape.className = "sample-marker-shape";
    shape.setAttribute("aria-hidden", "true");
    shape.textContent = "◇";
    const badge = doc.createElement("strong");
    badge.textContent = result.sample.badge;
    sample.replaceChildren(shape, badge, doc.createTextNode(` ${result.sample.statement}`));
  }

  // The heading is the decision question. It is authored in the document with
  // the same words, and repainting it is what proves the region and the
  // canonical contract have not drifted apart.
  setText(doc, FIRST_RUN_IDS.question, result.question ?? "");

  paintSlot(doc, FIRST_RUN_IDS.benchmarkValue, FIRST_RUN_IDS.benchmarkDetail, result.benchmark);
  paintSlot(doc, FIRST_RUN_IDS.impactValue, FIRST_RUN_IDS.impactDetail, result.impact);
  paintSlot(doc, FIRST_RUN_IDS.peerValue, FIRST_RUN_IDS.peerDetail, result.peer);

  const action = setText(doc, FIRST_RUN_IDS.action, result.action?.value ?? "");
  if (action) action.dataset.available = result.action?.available ? "true" : "false";
  const role = setText(doc, FIRST_RUN_IDS.role, result.action?.detail ?? "");
  if (role) role.hidden = !result.action?.detail;

  paintSlot(doc, FIRST_RUN_IDS.confidenceValue, FIRST_RUN_IDS.confidenceDetail, result.confidence);

  const method = byId(doc, FIRST_RUN_IDS.methodList);
  if (method) {
    method.replaceChildren(...(result.method ?? []).map((entry) => {
      const item = doc.createElement("div");
      const term = doc.createElement("dt");
      term.textContent = entry.term;
      const detail = doc.createElement("dd");
      detail.textContent = entry.detail;
      item.append(term, detail);
      return item;
    }));
  }

  // Spoken once, and only what a reader who cannot see the region would need to
  // decide whether to read it: what kind of numbers these are and what they say.
  const live = byId(doc, FIRST_RUN_IDS.live);
  if (live) {
    live.textContent = result.benchmark?.available
      ? `${result.sample.badge}. ${result.benchmark.value}. ${result.action?.value ?? ""}`
      : `${result.sample.badge}. ${result.reason ?? ""}`;
  }
  return region;
}

/**
 * Retire the region once the page holds an analysis of its own.
 *
 * A first-run result is an answer to "what would this tell me?", and that
 * question is closed the moment a real result — the reader's import, or the
 * example loaded into every panel — is on screen. Leaving it there would put a
 * second synthetic headline beside a live one, which is the exact confusion
 * this region exists to remove. The conversion aside goes with it: the page's
 * own follow-up form sits under the result the reader is now reading.
 */
export function applyFirstRunSupersession(doc, superseded,
  { conversionId = "finops-first-run-conversion" } = {}) {
  const region = byId(doc, FIRST_RUN_IDS.region);
  if (!region) return null;
  const retired = Boolean(superseded);
  region.dataset.superseded = retired ? "true" : "false";
  region.hidden = retired;
  const conversion = byId(doc, conversionId);
  if (conversion) conversion.hidden = retired;
  return region;
}

/**
 * Delegate each next action to the control that already owns it.
 *
 * Focus first, then the click: if the delegate declines to act — a browser that
 * will not open a file dialog from a synthetic event, say — the reader is left
 * standing on the control that does, rather than on a button that did nothing.
 *
 * The demo action deliberately delegates to `#try-example-dataset` instead of
 * loading the dataset itself: there is exactly one way into the example data on
 * this page, and a second code path would be a second product to keep correct.
 */
export function bindFirstRunActions(doc, { panelId = "finops-contact-panel" } = {}) {
  const delegate = (buttonId, targetId) => {
    const button = byId(doc, buttonId);
    if (!button) return null;
    button.dataset.target = targetId;
    button.addEventListener("click", () => {
      const target = byId(doc, targetId);
      if (!target) return;
      target.focus?.({ preventScroll: true });
      target.click?.();
      target.scrollIntoView?.({ block: "center" });
    });
    return button;
  };

  // The conversion action is not a plain delegate: `#finops-contact-open` is a
  // toggle, so forwarding a click to an already-open panel would close it. A
  // control labelled "ask us" that hides the form is worse than no control.
  const contact = byId(doc, FIRST_RUN_IDS.contact);
  if (contact) {
    contact.dataset.target = FIRST_RUN_CONVERSION.targetId;
    contact.addEventListener("click", () => {
      const trigger = byId(doc, FIRST_RUN_CONVERSION.targetId);
      const panel = byId(doc, panelId);
      if (!trigger) return;
      if (panel?.hidden !== false) trigger.click?.();
      // Focus lands on the field, not the trigger: the reader asked for the
      // form, so the next keystroke should go into it.
      const field = byId(doc, FIRST_RUN_CONVERSION.focusId);
      if (field && !field.disabled) field.focus?.();
      else trigger.focus?.({ preventScroll: true });
    });
  }

  return {
    demo: delegate(FIRST_RUN_IDS.demo, FIRST_RUN_ACTIONS.demo.targetId),
    import: delegate(FIRST_RUN_IDS.import, FIRST_RUN_ACTIONS.import.targetId),
    contact,
  };
}
