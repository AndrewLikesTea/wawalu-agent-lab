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

import { FIRST_RUN_ACTIONS, FIRST_RUN_IDS, SLOT_LABEL } from "./finops-first-run.js";
import { EXAMPLE_BRIEFING_CTA, EXAMPLE_BRIEFING_HREF } from "./finops-example-briefing.js";
import { DISCLOSURE_SPEC, disclosureStateLabel } from "./finops-decision-interaction.js";
// The `.pre-analysis-withheld` idiom is defined once, in the view that owns the
// answer region above this one, because both regions share the first screen and
// therefore have to withhold and reveal on the same rule.
import { revealWithheld } from "./finops-stand-view.js";

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
 * Paint a band chip: the glyph, the word, and the state the stylesheet keys off.
 *
 * Four channels, and the tint is the last of them. The glyph is `aria-hidden`
 * because it is a shape beside a word rather than the word itself — the chip's
 * accessible name is the label, which is also the text a speech-control user
 * says and the text that survives a greyscale print. `data-band` and
 * `data-silhouette` carry the state to CSS so no rule has to parse a colour.
 *
 * A slot with no band descriptor is one that never carries a position; its chip
 * is hidden rather than emptied, because an empty chip is a shape that means
 * nothing.
 */
function paintBand(doc, bandId, slot) {
  const chip = byId(doc, bandId);
  if (!chip) return null;
  const band = slot?.band;
  if (!band?.label) {
    chip.hidden = true;
    chip.removeAttribute("data-band");
    chip.replaceChildren();
    return chip;
  }
  chip.hidden = false;
  chip.dataset.band = band.state;
  chip.dataset.silhouette = band.silhouette;
  const shape = doc.createElement("span");
  shape.className = "first-run-band-shape";
  shape.setAttribute("aria-hidden", "true");
  shape.textContent = band.shape;
  const word = doc.createElement("span");
  word.className = "first-run-band-label";
  word.textContent = band.label;
  chip.replaceChildren(shape, doc.createTextNode(" "), word);
  return chip;
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
 * Paint the evidence into the disclosure, into its print sibling, and the state
 * chip that counts it — one function, because the example path and the imported
 * drill-down put different entries behind the SAME control and a second copy of
 * this would be a second way for the two to diverge.
 *
 * The print sibling is the same evidence a second time, outside the disclosure.
 * See PRINT_SPEC: it is what actually reaches paper, because no rule in any
 * cascade origin can suppress a block that is not inside a `details` at all. It
 * is `aria-hidden` and holds nothing focusable — the disclosure above is the
 * copy the accessibility tree reads.
 */
function paintMethod(doc, entries, heading) {
  const method = byId(doc, FIRST_RUN_IDS.methodList);
  if (method) method.replaceChildren(...entries.map((entry) => definition(doc, entry)));
  const print = byId(doc, FIRST_RUN_IDS.methodPrint);
  if (print) {
    const list = doc.createElement("dl");
    list.className = "first-run-method-list";
    list.replaceChildren(...entries.map((entry) => definition(doc, entry)));
    const title = doc.createElement("p");
    title.className = "first-run-method-print-heading";
    title.textContent = heading;
    print.replaceChildren(title, list);
  }
  return paintDisclosureState(doc, entries.length);
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
 * REPAINT, NEVER REPLACE. Every slot below is written through `textContent` or
 * `replaceChildren` on a node authored in evolution.html, and nothing here
 * removes or re-creates a focusable element. That is what keeps a reader who is
 * standing on the evidence disclosure standing on it when a fresh position
 * lands: the `<summary>` they focused is the same node afterwards, so the
 * browser never moves them and `open` never resets. The guard below restores
 * focus anyway if a caller ever repaints a subtree that did hold it — a
 * regression here should cost a frame, not a reader's place on the page.
 *
 * `announce` is off by default and deliberately so. The live region exists to
 * say that a number CHANGED; firing it on the first paint reads the whole
 * headline aloud at page load, over the top of whatever the reader was already
 * being told. The boot path leaves it off; the import path turns it on.
 *
 * @returns the region, so a caller can assert on the state it asked for.
 */
export function applyFirstRunResult(doc, result, { announce = false } = {}) {
  const region = byId(doc, FIRST_RUN_IDS.region);
  if (!region || !result) return null;
  // The slots, the support pair, the recommendation, the confidence line, and
  // this region's copy of the sample marker are all authored `hidden`: a
  // first-time visitor with nothing composed meets one empty state rather than
  // six metric-shaped boxes reading "Not yet measured". A result exists on this
  // line, so they are revealed before anything is painted into them.
  revealWithheld(region);
  const presentation = result.presentation ?? {};
  // Captured before the first write, restored after the last one.
  const focused = doc.activeElement;
  const wasInRegion = Boolean(focused && region.contains?.(focused));

  region.dataset.state = presentation.state ?? "pending";
  region.dataset.tone = presentation.tone ?? "neutral";
  // A figure that was refused travels as a flag on the region as well as a
  // sentence in the slot, so a printed page, a screenshot, and a test all agree
  // that this result is holding something it would not draw.
  region.dataset.figures = (result.notices?.length ?? 0) > 0 ? "out-of-range" : "in-range";
  setText(doc, FIRST_RUN_IDS.shape, presentation.shape ?? "○");
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
  // The band chip is painted before the value it bands, matching the DOM order
  // the region authors: a reader meets "Bottom quartile" and then the figure
  // that put them there, in that order, in speech and on screen alike.
  paintBand(doc, FIRST_RUN_IDS.peerBand, result.peer);
  paintSlot(doc, FIRST_RUN_IDS.peerValue, FIRST_RUN_IDS.peerDetail, result.peer);
  // The internal drill-down of the position above, painted through the same
  // helper and into the same slot shape: a suppressed finding is a sentence in
  // the value, never an empty panel and never a console warning.
  paintBand(doc, FIRST_RUN_IDS.internalBand, result.internal);
  paintSlot(doc, FIRST_RUN_IDS.internalValue, FIRST_RUN_IDS.internalDetail, result.internal);

  const action = setText(doc, FIRST_RUN_IDS.action, result.action?.value ?? "");
  if (action) action.dataset.available = result.action?.available ? "true" : "false";
  const role = setText(doc, FIRST_RUN_IDS.role, result.action?.detail ?? "");
  if (role) role.hidden = !result.action?.detail;

  paintSlot(doc, FIRST_RUN_IDS.confidenceValue, FIRST_RUN_IDS.confidenceDetail, result.confidence);

  const entries = result.method ?? [];
  paintMethod(doc, entries, DISCLOSURE_SPEC.heading);

  // Spoken once, and only what a reader who cannot see the region would need to
  // decide whether to read it: what kind of numbers these are and what they say.
  //
  // The band travels with it, because a reader who is told a figure changed and
  // not which side of the cohort it landed on has been told half the update.
  // Politely, and only on a repaint: `aria-live="polite"` queues behind whatever
  // the reader is hearing and never moves the focus ring.
  const live = byId(doc, FIRST_RUN_IDS.live);
  if (live && announce) {
    const position = result.peer?.band?.label ? `${result.peer.band.label}. ` : "";
    live.textContent = result.benchmark?.available
      ? `${result.sample.badge}. ${position}${result.answer?.value ?? result.benchmark.value}. ${result.action?.value ?? ""}`
      : `${result.sample.badge}. ${position}${result.reason ?? ""}`;
  }

  // Put the reader back where they were standing. `preventScroll`, because a
  // repaint they did not ask for should not also move the page under them.
  if (wasInRegion && doc.activeElement !== focused && focused?.isConnected !== false) {
    focused?.focus?.({ preventScroll: true });
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
 * Withhold — or restore — the example's own summary inside this region.
 *
 * THE ONE-SUMMARY RULE. An import paints its headline into
 * `#finops-imported-headline`. If this region kept its example answer,
 * benchmark, impact, peer position and confidence beside it, a reader would be
 * looking at two summaries of two different companies. So exactly those blocks
 * are withheld and exactly one is kept: the drill-down slot.
 *
 * `hidden` and not a class — the attribute is what a screen reader, a print
 * stylesheet and a test already agree on. The `[hidden]` rules added to
 * evolution.css only restore what `hidden` already means, because each of these
 * blocks sets an author `display` that would otherwise beat the UA rule.
 */
function withholdExampleFigures(doc, withheld) {
  const region = byId(doc, FIRST_RUN_IDS.region);
  if (!region) return null;
  for (const id of [FIRST_RUN_IDS.answer, FIRST_RUN_IDS.answerDetail]) {
    const node = byId(doc, id);
    if (node) node.hidden = withheld;
  }
  for (const slot of region.querySelectorAll?.(".first-run-slot") ?? []) {
    // The drill-down slot is the one this region keeps. It is found by the id it
    // paints into rather than by position, so re-ordering the slots cannot
    // silently withhold the wrong one.
    const kept = Boolean(slot.querySelector?.(`#${FIRST_RUN_IDS.internalValue}`));
    slot.hidden = withheld && !kept;
  }
  for (const block of region.querySelectorAll?.(
    ".first-run-recommendation,.first-run-confidence") ?? []) {
    block.hidden = withheld;
  }
  return region;
}

/**
 * Hand the region to the reader's own export.
 *
 * The region is NOT retired — see `applyFirstRunSupersession` for what it used
 * to do and why that was only half right. The example's summary is withheld,
 * the eyebrow, question and provenance line are reworded to say whose numbers
 * these now are, and the drill-down slot and its disclosure are repainted from
 * the imported ranking.
 *
 * The headline number stays OUTSIDE the disclosure, in the slot's own value: a
 * reader who never opens the evidence has still read which group carries the
 * money and how much. The disclosure holds the full ranking.
 *
 * @returns the region, so a caller can assert on the state it asked for.
 */
export function applyImportedDrilldown(doc, drilldown) {
  const region = byId(doc, FIRST_RUN_IDS.region);
  if (!region || !drilldown) return null;
  region.hidden = false;
  region.dataset.superseded = "false";
  region.dataset.source = "imported";
  region.dataset.state = drilldown.available ? "ready" : "empty";
  withholdExampleFigures(doc, true);

  setText(doc, FIRST_RUN_IDS.shape, drilldown.available ? "▣" : "◇");
  setText(doc, FIRST_RUN_IDS.word, drilldown.word);
  setText(doc, FIRST_RUN_IDS.question, drilldown.question);
  // ◆ and not ◇: the filled diamond is this page's mark for a reader's own
  // data, the outline one for the bundled invention. The provenance sentence is
  // repainted rather than left standing, because the authored one says every
  // figure below is invented and after this call none of them is.
  const sample = byId(doc, FIRST_RUN_IDS.sample);
  if (sample) {
    const shape = doc.createElement("span");
    shape.className = "sample-marker-shape";
    shape.setAttribute("aria-hidden", "true");
    shape.textContent = "◆";
    const badge = doc.createElement("strong");
    badge.textContent = drilldown.word;
    sample.replaceChildren(shape, badge, doc.createTextNode(` ${drilldown.provenance}`));
  }

  setText(doc, FIRST_RUN_IDS.internalHeading, drilldown.slotLabel);
  paintBand(doc, FIRST_RUN_IDS.internalBand, drilldown);
  paintSlot(doc, FIRST_RUN_IDS.internalValue, FIRST_RUN_IDS.internalDetail, {
    available: drilldown.available,
    value: drilldown.headline,
    // The grouping sentence is visible text beside the figure, not evidence
    // behind the control: a reader whose export carried no department column has
    // to be told what they are looking at instead, whether or not they open
    // anything.
    detail: drilldown.grouping.statement,
  });
  setText(doc, FIRST_RUN_IDS.methodTitle, drilldown.heading);
  paintMethod(doc, drilldown.entries ?? [], drilldown.heading);
  return region;
}

/**
 * Give the region back to the bundled example.
 *
 * Reachable without a reload: a reader can import their own export and then
 * press "Try the Bundled synthetic example", or clear the import entirely. A
 * one-way hand-over would leave the example's own figures withheld behind an
 * example headline, which is a worse state than the one this change replaced.
 *
 * `result` may be a function so a caller can avoid recomposing the example on
 * every panel sync: it is called only when a hand-back is actually happening.
 */
export function restoreFirstRunExample(doc, result = null) {
  const region = byId(doc, FIRST_RUN_IDS.region);
  if (!region) return null;
  if (region.dataset.source !== "imported") return region;
  region.dataset.source = "example";
  withholdExampleFigures(doc, false);
  setText(doc, FIRST_RUN_IDS.internalHeading, SLOT_LABEL.internal);
  setText(doc, FIRST_RUN_IDS.methodTitle, DISCLOSURE_SPEC.heading);
  const composed = typeof result === "function" ? result() : result;
  return composed ? applyFirstRunResult(doc, composed) : region;
}

/**
 * Retire the region once the page holds an analysis of its own.
 *
 * A first-run result is an answer to "what would this tell me?", and that
 * question is closed the moment the example is loaded into every panel below:
 * the same synthetic figures would then be stated twice on one screen.
 *
 * IT IS NO LONGER WHAT AN IMPORT DOES (#979). Retiring the region on import
 * threw away the drill-down along with the synthetic headline, and left the
 * reader who had supplied real data with less structure than the visitor who
 * had supplied none. `applyImportedDrilldown` above withholds the competing
 * summary and repopulates the drill-down instead; this function still owns the
 * example-into-every-panel case, unchanged.
 *
 * There is no longer a conversion aside to retire alongside it: the answer
 * spine retired that region, and #finops-contact — which is not
 * first-run-specific and stays on screen — carries the ask.
 */
export function applyFirstRunSupersession(doc, superseded, { focusFallbackId = null } = {}) {
  const region = byId(doc, FIRST_RUN_IDS.region);
  if (!region) return null;
  const retired = Boolean(superseded);
  // Hiding the element a reader is standing on drops focus to `<body>`, which
  // for a keyboard user means the next Tab starts again at the top of the
  // document — they imported a file and lost their place on the page. So when
  // this region is retired out from under the focus ring, focus is moved
  // deliberately to the surface that replaced it rather than dropped.
  const focused = doc.activeElement;
  const heldFocus = retired && !region.hidden && Boolean(focused && region.contains?.(focused));
  region.dataset.superseded = retired ? "true" : "false";
  region.hidden = retired;
  if (heldFocus) {
    const fallback = (focusFallbackId ? byId(doc, focusFallbackId) : null)
      ?? doc.querySelector?.("main");
    fallback?.focus?.({ preventScroll: true });
  }
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
export function bindFirstRunActions(doc) {
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

  // The third binding here used to be the conversion button, which opened
  // #finops-contact's form from a duplicate ask two thousand lines above it.
  // The ask is retired; the form it opened is unchanged and still the only
  // place on this page an email address is typed.
  return {
    demo: delegate(FIRST_RUN_IDS.demo, FIRST_RUN_ACTIONS.demo.targetId),
    import: delegate(FIRST_RUN_IDS.import, FIRST_RUN_ACTIONS.import.targetId),
  };
}
