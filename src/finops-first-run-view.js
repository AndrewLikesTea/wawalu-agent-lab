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
import { EXAMPLE_BRIEFING_CTA, EXAMPLE_BRIEFING_HREF } from "./finops-example-briefing.js";
import { DISCLOSURE_SPEC, disclosureStateLabel } from "./finops-decision-interaction.js";

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

/** One `<dt>`/`<dd>` pair, built rather than assigned. */
function definition(doc, entry) {
  const item = doc.createElement("div");
  const term = doc.createElement("dt");
  term.textContent = entry.term;
  const detail = doc.createElement("dd");
  detail.textContent = entry.detail;
  item.append(term, detail);
  return item;
}

/**
 * Write the disclosure's state into the three channels it is owed: the
 * accessible name, the `aria-expanded` mirror, and the visible word beside the
 * summary. A chevron that only rotates is a state a reader cannot hear, cannot
 * print, and cannot see in greyscale.
 *
 * The count travels with the state — "Show evidence · 6" says how much is
 * behind the control, which is the difference between a disclosure a reader
 * opens and one they scroll past.
 */
export function paintDisclosureState(doc, entryCount = null) {
  const details = byId(doc, FIRST_RUN_IDS.method);
  const summary = byId(doc, FIRST_RUN_IDS.methodSummary);
  if (!details || !summary) return null;
  const open = Boolean(details.open ?? details.hasAttribute?.("open"));
  const spec = open ? DISCLOSURE_SPEC.expanded : DISCLOSURE_SPEC.collapsed;
  summary.setAttribute("aria-expanded", open ? "true" : "false");
  details.dataset.disclosure = open ? "expanded" : "collapsed";
  const state = byId(doc, FIRST_RUN_IDS.methodState);
  if (state) {
    state.dataset.disclosure = open ? "expanded" : "collapsed";
    // The glyph is decoration beside a word, never the word itself, so it is
    // hidden from the name the visible text composes.
    const shape = doc.createElement("span");
    shape.className = "first-run-method-shape";
    shape.setAttribute("aria-hidden", "true");
    shape.textContent = spec.shape;
    state.replaceChildren(shape, doc.createTextNode(` ${disclosureStateLabel(open, entryCount)}`));
  }
  return summary;
}

/**
 * Keep the three state channels in step with the element's own `open`.
 *
 * Bound to `toggle`, which fires for a click, for Enter, for Space, and for a
 * programmatic `open` — so the keyboard path and the pointer path go through
 * one piece of code rather than two that can disagree. Nothing here intercepts
 * a key: the native control already handles every one of them, and re-handling
 * them is how a disclosure stops being operable in the browser's own way.
 */
export function bindFirstRunDisclosure(doc) {
  const details = byId(doc, FIRST_RUN_IDS.method);
  if (!details) return null;
  const count = () => byId(doc, FIRST_RUN_IDS.methodList)?.querySelectorAll?.("dt")?.length ?? null;
  details.addEventListener("toggle", () => paintDisclosureState(doc, count()));
  paintDisclosureState(doc, count());
  return details;
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
  // A figure that was refused travels as a flag on the region as well as a
  // sentence in the slot, so a printed page, a screenshot, and a test all agree
  // that this result is holding something it would not draw.
  region.dataset.figures = (result.notices?.length ?? 0) > 0 ? "out-of-range" : "in-range";
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

  // The answer, immediately under the question it answers. A reader who stops
  // here has still read a decision; everything below sizes and checks it.
  paintSlot(doc, FIRST_RUN_IDS.answer, FIRST_RUN_IDS.answerDetail, result.answer);

  paintSlot(doc, FIRST_RUN_IDS.benchmarkValue, FIRST_RUN_IDS.benchmarkDetail, result.benchmark);
  paintSlot(doc, FIRST_RUN_IDS.impactValue, FIRST_RUN_IDS.impactDetail, result.impact);
  paintSlot(doc, FIRST_RUN_IDS.peerValue, FIRST_RUN_IDS.peerDetail, result.peer);
  // The internal drill-down of the position above, painted through the same
  // helper and into the same slot shape: a suppressed finding is a sentence in
  // the value, never an empty panel and never a console warning.
  paintSlot(doc, FIRST_RUN_IDS.internalValue, FIRST_RUN_IDS.internalDetail, result.internal);

  const action = setText(doc, FIRST_RUN_IDS.action, result.action?.value ?? "");
  if (action) action.dataset.available = result.action?.available ? "true" : "false";
  const role = setText(doc, FIRST_RUN_IDS.role, result.action?.detail ?? "");
  if (role) role.hidden = !result.action?.detail;

  paintSlot(doc, FIRST_RUN_IDS.confidenceValue, FIRST_RUN_IDS.confidenceDetail, result.confidence);

  const entries = result.method ?? [];
  const method = byId(doc, FIRST_RUN_IDS.methodList);
  if (method) method.replaceChildren(...entries.map((entry) => definition(doc, entry)));

  // The same evidence, a second time, outside the disclosure. See PRINT_SPEC:
  // this sibling is what actually reaches paper, because no rule in any cascade
  // origin can suppress a block that is not inside a `details` at all. It is
  // `aria-hidden` and holds nothing focusable — the disclosure above is the
  // copy the accessibility tree reads.
  const print = byId(doc, FIRST_RUN_IDS.methodPrint);
  if (print) {
    const list = doc.createElement("dl");
    list.className = "first-run-method-list";
    list.replaceChildren(...entries.map((entry) => definition(doc, entry)));
    const heading = doc.createElement("p");
    heading.className = "first-run-method-print-heading";
    heading.textContent = DISCLOSURE_SPEC.heading;
    print.replaceChildren(heading, list);
  }

  paintDisclosureState(doc, entries.length);

  // Spoken once, and only what a reader who cannot see the region would need to
  // decide whether to read it: what kind of numbers these are and what they say.
  const live = byId(doc, FIRST_RUN_IDS.live);
  if (live) {
    live.textContent = result.benchmark?.available
      ? `${result.sample.badge}. ${result.answer?.value ?? result.benchmark.value}. ${result.action?.value ?? ""}`
      : `${result.sample.badge}. ${result.reason ?? ""}`;
  }
  return region;
}

/**
 * Repaint the executive-briefing hand-off from the module that owns it.
 *
 * The anchor, its heading, its href, and its note are all authored in
 * evolution.html, so the way out of this region works before any script runs and
 * survives a copy-paste into the address bar. This does not create it — it
 * proves the authored copy and the module's copy are the same words, the same
 * way the sample label above is repainted rather than assumed. A drift becomes a
 * visible change on the page rather than two sentences nobody compared.
 *
 * @returns the anchor, so a caller can assert on what it points at.
 */
export function applyExampleBriefingCta(doc) {
  const link = byId(doc, FIRST_RUN_IDS.briefing);
  if (!link) return null;
  setText(doc, FIRST_RUN_IDS.briefingHeading, EXAMPLE_BRIEFING_CTA.heading);
  link.textContent = EXAMPLE_BRIEFING_CTA.label;
  link.setAttribute("href", EXAMPLE_BRIEFING_HREF);
  // The note is the accessible description, not a second name: the link's own
  // text already says where it goes and whose figures are on the other end.
  link.setAttribute("aria-describedby", FIRST_RUN_IDS.briefingNote);
  setText(doc, FIRST_RUN_IDS.briefingNote, EXAMPLE_BRIEFING_CTA.note);
  return link;
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
