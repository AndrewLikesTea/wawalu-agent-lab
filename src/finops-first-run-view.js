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

import { FIRST_RUN_ACTIONS, FIRST_RUN_IDS } from "./finops-first-run.js";
import { EXAMPLE_BRIEFING_CTA, EXAMPLE_BRIEFING_HREF } from "./finops-example-briefing.js";
import { DISCLOSURE_SPEC, disclosureStateLabel } from "./finops-decision-interaction.js";
import { DRILLDOWN_HEADING, DRILLDOWN_QUESTION } from "./finops-imported-departments.js";
// The ceiling on a reader-supplied name. It is the import module's constant
// because that is where the label layer is defined; this view only enforces it
// on the control so the field cannot accept what the resolver would discard.
import { MAX_ORG_UNIT_DISPLAY_LABEL } from "./org-unit-display-label.js";
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

/**
 * How many of the ranked rows offer a name field.
 *
 * Five, because that is the span a lead actually recognizes and renames; past
 * it the disclosure becomes a data-entry form rather than an answer. A row
 * without a field is unchanged — it still reads under its pseudonym.
 */
export const ORG_UNIT_LABEL_FIELD_LIMIT = 5;

/** The field ids, deterministic so a repaint restores focus to the same one. */
export const orgUnitLabelFieldId = (rank) => `finops-unit-label-${rank}`;

/**
 * The inline "call this unit something I recognize" field for one ranked row.
 *
 * IT IS BUILT HERE AND NOT AUTHORED IN evolution.html ON PURPOSE. The fields
 * sit inside a disclosure that already ships closed, so they are not first-
 * screen answer content; shipping five of them as static markup would spend the
 * document's initial-payload budget on a control nobody has opened yet. The
 * disclosure itself is already interactive, so building its contents in script
 * is the same enhancement the ranked rows beside them already are.
 *
 * OPERATION IS THE REPO'S EXISTING RENAME IDIOM: a real field with a real
 * `label for`, and an explicit Save beside it. Enter commits from inside the
 * field. Nothing commits on blur, so tabbing THROUGH the disclosure never
 * repaints under a keyboard reader's focus ring.
 *
 * NOTHING TYPED HERE LEAVES THE PAGE. The value goes to `onLabel`, which is
 * page state and nothing else — no request, no storage, no export field.
 */
function labelField(doc, entry, onLabel) {
  const box = doc.createElement("p");
  box.className = "first-run-unit-label";
  const id = orgUnitLabelFieldId(entry.rank);
  const name = doc.createElement("label");
  name.className = "first-run-unit-label-name";
  name.setAttribute("for", id);
  // The accessible name says which unit, because five fields called "Name" are
  // five fields a screen-reader user cannot tell apart. The pseudonym is the
  // one string that identifies the unit no matter what it has been renamed to.
  name.textContent = `Your name for ${entry.pseudonym}`;
  const input = doc.createElement("input");
  input.id = id;
  input.className = "first-run-unit-label-input";
  input.setAttribute("type", "text");
  input.setAttribute("maxlength", String(MAX_ORG_UNIT_DISPLAY_LABEL));
  input.dataset.unitId = entry.unitId;
  input.value = entry.label ?? "";
  input.placeholder = entry.pseudonym;
  const save = doc.createElement("button");
  save.className = "first-run-unit-label-save";
  save.setAttribute("type", "button");
  // The unit is in the VISIBLE text, never in an attribute a reader cannot see,
  // so the name a speech-control user says is the name they can read and five
  // Save buttons are five distinguishable ones. It is the rule this whole view
  // is already held to, and tests/finops-decision-interaction.js pins it.
  save.textContent = `Save ${entry.pseudonym}`;
  const help = doc.createElement("span");
  help.className = "first-run-unit-label-help";
  help.textContent = `Stays on this page. Clear it to go back to ${entry.pseudonym}.`;

  const commit = () => {
    // The field the reader is standing in, remembered across the repaint the
    // commit triggers. Losing the ring here would send them back to the top of
    // the document for the price of naming one team.
    const region = byId(doc, FIRST_RUN_IDS.region);
    if (region) region.dataset.focusTarget = id;
    onLabel(entry.unitId, input.value);
  };
  // `click`, and nothing else. This view intercepts no key at all — the native
  // button already answers Enter and Space, and a handler here would be the
  // second thing in this file deciding what a key means, which is exactly what
  // tests/finops-decision-interaction.js forbids of the disclosure around it.
  save.addEventListener("click", commit);
  box.append(name, input, save, help);
  return box;
}

/** One `<dt>`/`<dd>` pair, built rather than assigned. */
function definition(doc, entry, onLabel) {
  const item = doc.createElement("div");
  const term = doc.createElement("dt");
  term.textContent = entry.term;
  const detail = doc.createElement("dd");
  detail.textContent = entry.detail;
  item.append(term, detail);
  // Only the live disclosure gets fields. The print sibling is a copy of the
  // same evidence and is `aria-hidden`; putting a second input with the same id
  // in it would give the page duplicate ids and a control on paper.
  if (onLabel && entry.unitId && entry.rank <= ORG_UNIT_LABEL_FIELD_LIMIT) {
    detail.append(labelField(doc, entry, onLabel));
  }
  return item;
}

/**
 * Fill the shared evidence disclosure, its print sibling, and its state chip.
 *
 * ONE disclosure, two callers: the example's method entries and the imported
 * drill-down's ranked rows go through this function into the same `details`, so
 * there is no second pattern to keep operable and no second place a heading can
 * drift. The print sibling is the same evidence outside the disclosure — see
 * PRINT_SPEC: it is what reaches paper, because no rule in any cascade origin
 * can suppress a block that is not inside a `details` at all. It is
 * `aria-hidden`; the disclosure is the copy the accessibility tree reads.
 */
function paintEvidence(doc, entries, heading, onLabel = null) {
  setText(doc, FIRST_RUN_IDS.methodTitle, heading);
  const method = byId(doc, FIRST_RUN_IDS.methodList);
  if (method) method.replaceChildren(...entries.map((entry) => definition(doc, entry, onLabel)));
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
  paintDisclosureState(doc, entries.length);
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
  // The literacy letter, through the same helper again. It carries no band chip:
  // its qualifier is a coverage tier stated in words and dollars on the detail
  // line, not a position on a cohort ramp, and borrowing the band vocabulary
  // would say this figure was placed against peers when it was not.
  paintSlot(doc, FIRST_RUN_IDS.literacyValue, FIRST_RUN_IDS.literacyDetail, result.literacy);

  const action = setText(doc, FIRST_RUN_IDS.action, result.action?.value ?? "");
  if (action) action.dataset.available = result.action?.available ? "true" : "false";
  const role = setText(doc, FIRST_RUN_IDS.role, result.action?.detail ?? "");
  if (role) role.hidden = !result.action?.detail;

  paintSlot(doc, FIRST_RUN_IDS.confidenceValue, FIRST_RUN_IDS.confidenceDetail, result.confidence);

  const entries = result.method ?? [];
  paintEvidence(doc, entries, DISCLOSURE_SPEC.heading);

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
 * The parts of the region that speak for the bundled example and only for it.
 * Withheld as wholes in the imported state: a synthetic peer band, routing
 * scenario, or confidence score standing beside a reader's own department
 * ranking is a second answer to the question this region asks.
 */
const EXAMPLE_ONLY_IDS = Object.freeze([
  FIRST_RUN_IDS.sample, FIRST_RUN_IDS.slots,
  FIRST_RUN_IDS.recommendation, FIRST_RUN_IDS.confidence,
]);

/** The text nodes the imported state overwrites, and therefore has to restore. */
const RESTORED_IDS = Object.freeze([
  FIRST_RUN_IDS.word, FIRST_RUN_IDS.shape, FIRST_RUN_IDS.question,
  FIRST_RUN_IDS.answer, FIRST_RUN_IDS.answerDetail,
]);

/**
 * What the example had in those nodes, per document, captured on the way in and
 * put back on the way out. Captured rather than recomposed: clearing an import
 * must leave this region exactly as the example painted it, and rebuilding the
 * example result here would put a composition path in a view whose one rule is
 * that it composes nothing.
 */
const EXAMPLE_COPY = new WeakMap();

/** The disclosure's current entries, read back off the list it painted them into. */
function evidenceEntries(doc) {
  const list = byId(doc, FIRST_RUN_IDS.methodList);
  const terms = [...(list?.querySelectorAll?.("dt") ?? [])];
  const details = [...(list?.querySelectorAll?.("dd") ?? [])];
  return terms.map((term, index) => ({
    term: term.textContent ?? "", detail: details[index]?.textContent ?? "",
  }));
}

/**
 * Refill the region from the reader's own export instead of retiring it.
 *
 * One headline and one disclosure: the drill-down's headline sentence — WITH
 * its figure in it — is painted into the answer slot, outside and above the
 * `details`, so the collapsed state answers "which team is driving this" on its
 * own. The ranked rows are supporting detail and go behind the disclosure the
 * example already uses, which is a native `details` and therefore keyboard
 * reachable and operable in this state exactly as it is in the other one.
 */
function applyOwnDataDrilldown(doc, region, drilldown, onLabel) {
  if (!EXAMPLE_COPY.has(doc)) {
    EXAMPLE_COPY.set(doc, {
      text: RESTORED_IDS.map((id) => [id, byId(doc, id)?.textContent ?? ""]),
      entries: evidenceEntries(doc),
      heading: byId(doc, FIRST_RUN_IDS.methodTitle)?.textContent ?? DISCLOSURE_SPEC.heading,
    });
  }
  for (const id of EXAMPLE_ONLY_IDS) {
    const node = byId(doc, id);
    if (node) node.hidden = true;
  }
  region.dataset.superseded = "own-data";
  region.dataset.source = "imported";
  region.dataset.grouping = drilldown.grouping.id;
  // The state word and its glyph, on the same two channels the example uses:
  // ▣ computed, ▲ could not compute. Never a tint on its own.
  setText(doc, FIRST_RUN_IDS.word, drilldown.available ? "Your export" : "Nothing to rank");
  setText(doc, FIRST_RUN_IDS.shape, drilldown.available ? "▣" : "▲");
  setText(doc, FIRST_RUN_IDS.question, DRILLDOWN_QUESTION);
  paintSlot(doc, FIRST_RUN_IDS.answer, FIRST_RUN_IDS.answerDetail, {
    available: drilldown.available, value: drilldown.headline, detail: drilldown.detail,
  });
  paintEvidence(doc, drilldown.rows.map((entry) => ({
    term: entry.term,
    detail: entry.detail,
    // The identity, not the rank, is what a name is bound to — `rank` only
    // decides which rows are offered a field and which id that field gets.
    unitId: entry.unitId,
    pseudonym: entry.pseudonym,
    rank: entry.rank,
    // The field shows the name that is actually rendering. This view never
    // reads the label map — it reads what the resolver decided, which is the
    // only version of "what is this unit called" the page is allowed to have.
    label: entry.name === entry.pseudonym ? "" : entry.name,
  })), DRILLDOWN_HEADING, onLabel);
  // Put the reader back in the field they committed from. The repaint that
  // followed the commit replaced the node they were standing on, and the ids
  // are deterministic precisely so this can find its way back.
  const focusId = region.dataset.focusTarget;
  if (focusId) {
    delete region.dataset.focusTarget;
    byId(doc, focusId)?.focus?.({ preventScroll: true });
  }
  return region;
}

/** Put the example's own words and slots back when an import is cleared. */
function restoreExampleCopy(doc) {
  const copy = EXAMPLE_COPY.get(doc);
  if (!copy) return;
  EXAMPLE_COPY.delete(doc);
  for (const [id, text] of copy.text) setText(doc, id, text);
  for (const id of EXAMPLE_ONLY_IDS) {
    const node = byId(doc, id);
    if (node) node.hidden = false;
  }
  const detail = byId(doc, FIRST_RUN_IDS.answerDetail);
  if (detail) detail.hidden = false;
  paintEvidence(doc, copy.entries, copy.heading);
}

/**
 * Retire the region, or refill it from the reader's own export.
 *
 * A first-run result is an answer to "what would this tell me?", and the
 * EXAMPLE closes that question the moment it is loaded into every panel below:
 * two synthetic headlines on one page is the confusion this region exists to
 * remove, so that path still retires the block whole.
 *
 * An IMPORT closes it differently. The reader now has a fuller headline of
 * their own above this region, but the question underneath it — which of my
 * teams is that coming from — is the one this block was already shaped to
 * answer, and hiding it took the drill-down that made the example persuasive
 * off the page at exactly the moment it became about real money. So when
 * `ownData` is supplied the region stays, withholds every synthetic figure in
 * it, and is repainted from the import: one headline, one disclosure, no second
 * summary. Without it, nothing about the retirement changes.
 */
export function applyFirstRunSupersession(doc, superseded,
  { focusFallbackId = null, ownData = null, onOrgUnitLabel = null } = {}) {
  const region = byId(doc, FIRST_RUN_IDS.region);
  if (!region) return null;
  const retired = Boolean(superseded);
  if (retired && ownData) {
    region.hidden = false;
    return applyOwnDataDrilldown(doc, region, ownData, onOrgUnitLabel);
  }
  restoreExampleCopy(doc);
  delete region.dataset.source;
  delete region.dataset.grouping;
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
