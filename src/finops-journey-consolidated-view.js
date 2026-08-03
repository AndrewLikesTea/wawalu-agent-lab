// The consolidated journey, drawn into the region both FinOps surfaces ship.
//
// It decides nothing. `consolidateJourney` picked the phase, the figure, the one
// action and the checkpoint; this paints them in the order a lead reads them and
// adds no number of its own. `createElement` and `textContent` only — never a
// markup string, and never an assignment of HTML into the document.
//
// WHAT IS ABOVE THE FOLD, AND WHY IT IS EXACTLY THREE THINGS
// ---------------------------------------------------------
// One answerable question, one material figure that answers it, one prioritized
// action. Nothing else. The supporting evidence, the per-department detail, the
// prior action results and the carried provenance are all real content a lead
// sometimes needs and never needs *first*, so each is a collapsed disclosure on
// this same surface — not another page, and not a link out of the decision.
//
// The verification checkpoint is the one conditional exception. In the
// verification-ready phase it is the answer, so it is painted beside the action
// rather than under a disclosure; in every other phase it is a row inside "What
// remains", where the model already put it.
//
// ACCESSIBILITY CONVENTIONS ARE IRIS'S, NOT NEW ONES
// --------------------------------------------------
// Disclosures are real `<button>`s carrying `aria-expanded` and `aria-controls`
// over a named `role="group"` that is `hidden` when collapsed, so a shut panel
// leaves the tab sequence rather than holding it — the same control the action
// center's journey panels use. Every state word travels beside its glyph, the
// glyph is `aria-hidden`, and no signal is carried by colour alone. Heading
// levels start at the region's own `h2` and step to `h3`; nothing here emits an
// `h4` or skips a level.

import {
  JOURNEY_PHASE, consolidatedJourneyPaintKey,
} from "./finops-journey-consolidated.js";

export const JOURNEY_IDS = Object.freeze({
  region: "finops-journey",
  body: "finops-journey-body",
  question: "finops-journey-question",
  live: "finops-journey-live",
  sample: "finops-journey-sample",
  action: "finops-journey-action",
  metric: "finops-journey-metric",
  checkpoint: "finops-journey-checkpoint",
  examples: "finops-journey-example-controls",
});

/**
 * A shape beside the word, so the phase survives greyscale and a screen reader.
 *
 * The circle ramp, like every other status chip on /evolution.html: fill is how
 * far this journey has got. The two diamonds this used to draw are the page's
 * provenance badges and said nothing about a phase.
 */
const PHASE_SHAPE = Object.freeze({
  [JOURNEY_PHASE.new]: "○",
  [JOURNEY_PHASE.resumed]: "◐",
  [JOURNEY_PHASE.verificationReady]: "●",
  [JOURNEY_PHASE.degraded]: "◔",
});

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fact(doc, list, label, value) {
  list.append(element(doc, "dt", "fjc-term", label),
    element(doc, "dd", "fjc-detail", value));
}

/**
 * One disclosure: a real button over a named group, collapsed by default.
 *
 * The count is in the label so a reader knows the size of the panel before they
 * open it, and the state word changes with the glyph so the control reports
 * itself in words too. Nothing here traps focus — the panel is inline, and a
 * collapsed panel is `hidden`.
 */
function disclosure(doc, id, label, rows) {
  const wrapper = element(doc, "div", "fjc-disclosure");
  wrapper.dataset.disclosure = "collapsed";
  const trigger = element(doc, "button", "fjc-disclosure-trigger");
  trigger.type = "button";
  trigger.id = `${id}-trigger`;
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", `${id}-panel`);
  const shape = element(doc, "span", "fjc-disclosure-shape", "▸");
  shape.setAttribute("aria-hidden", "true");
  const state = element(doc, "span", "fjc-disclosure-state", "Show");
  trigger.append(shape,
    element(doc, "span", "fjc-disclosure-label", `${label} (${rows.length})`), state);

  const panel = element(doc, "div", "fjc-disclosure-panel");
  panel.id = `${id}-panel`;
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-labelledby", trigger.id);
  panel.hidden = true;
  if (rows.length) {
    const list = element(doc, "dl", "fjc-facts");
    for (const [name, value] of rows) fact(doc, list, name, value);
    panel.append(list);
  } else {
    panel.append(element(doc, "p", "fjc-empty",
      "Nothing is recorded here yet. This panel fills in as the review progresses."));
  }

  trigger.addEventListener("click", () => {
    const expanded = trigger.getAttribute("aria-expanded") === "true";
    trigger.setAttribute("aria-expanded", String(!expanded));
    panel.hidden = expanded;
    shape.textContent = expanded ? "▸" : "▾";
    state.textContent = expanded ? "Show" : "Hide";
    wrapper.dataset.disclosure = expanded ? "collapsed" : "expanded";
  });
  wrapper.append(trigger, panel);
  return wrapper;
}

/** The five signals, as the chips Iris's contract already describes them as. */
function signalRow(doc, signals) {
  const row = element(doc, "ul", "fjc-signals");
  row.setAttribute("aria-label", "Signals behind this recommendation");
  for (const signal of signals) {
    const item = element(doc, "li", "fjc-signal");
    const chip = element(doc, "span", "fjc-chip");
    chip.dataset.signal = signal.key;
    chip.dataset.tone = signal.tone;
    chip.dataset.known = String(signal.known);
    const shape = element(doc, "span", "fjc-chip-shape", signal.shape);
    shape.setAttribute("aria-hidden", "true");
    chip.append(shape, element(doc, "span", "fjc-chip-label", signal.label),
      element(doc, "span", "fjc-chip-value", signal.value));
    item.append(chip);
    row.append(item);
  }
  return row;
}

function checkpointBlock(doc, journey) {
  const section = element(doc, "section", "fjc-checkpoint");
  section.id = JOURNEY_IDS.checkpoint;
  section.setAttribute("aria-labelledby", "finops-journey-checkpoint-title");
  const title = element(doc, "h3", "fjc-slot-label", "Verification checkpoint");
  title.id = "finops-journey-checkpoint-title";
  section.dataset.known = String(journey.checkpoint.known);
  section.append(title,
    element(doc, "p", "fjc-checkpoint-date", journey.checkpoint.due
      ? `Due ${journey.checkpoint.due}` : "No date scheduled"),
    element(doc, "p", "fjc-checkpoint-note", journey.checkpoint.note));
  if (journey.checkpoint.source) {
    section.append(element(doc, "p", "fjc-checkpoint-source",
      `Read from ${journey.checkpoint.source}. This view derives the date and the expected `
      + "figure from that record; it computes neither."));
  }
  return section;
}

/**
 * The bundled-example picker, beside the journey it loads.
 *
 * Real `<button>`s carrying `aria-pressed`, not a tab set: pressing one swaps
 * which records the region below is composed from, and nothing is shown or
 * hidden by it. The controls are built once and then only their pressed state
 * changes, so a repaint cannot take the keyboard away from the button a reader
 * just pressed. Each button also names what it loads in words — an example is
 * distinguishable from a reader's own records without reading a tint.
 *
 * @param options.choices `[{name, title}]` in reading order.
 * @param options.active the loaded example's name, or null for own records.
 * @param options.onSelect handed the chosen name, or null for own records.
 * @returns the control group, or null on a surface that does not carry one.
 */
export function renderJourneyExamplePicker(doc, { choices, active = null, onSelect }) {
  const group = doc.getElementById(JOURNEY_IDS.examples);
  if (!group) return null;
  if (group.dataset.built !== "true") {
    group.dataset.built = "true";
    for (const { name, title } of [{ name: "", title: "Your own local records" }, ...choices]) {
      const button = element(doc, "button", "fjc-example", title);
      button.type = "button";
      button.dataset.example = name;
      button.addEventListener("click", () => onSelect(name || null));
      group.append(button);
    }
  }
  for (const button of group.children) {
    button.setAttribute("aria-pressed", String((button.dataset.example || null) === active));
  }
  return group;
}

/**
 * Paint one journey into the region the surface ships.
 *
 * @param doc the document holding `#finops-journey`.
 * @param journey a `finops-consolidated-journey/1.0.0` model.
 * @returns the region, or null when this page does not carry one.
 */
export function renderConsolidatedJourney(doc, journey) {
  const region = doc.getElementById(JOURNEY_IDS.region);
  const body = doc.getElementById(JOURNEY_IDS.body);
  if (!region || !body || !journey) return null;

  // Both surfaces repaint whenever anything else on them moves. An unchanged
  // journey is left standing so a repaint cannot close the disclosures a reader
  // opened and take the keyboard with them.
  const key = consolidatedJourneyPaintKey(journey);
  if (region.dataset.journeyKey === key) return region;
  const previousPhase = region.dataset.phase;
  region.dataset.journeyKey = key;
  region.dataset.phase = journey.phase;
  region.dataset.source = journey.source;
  // Whose records these are, as an attribute for a stylesheet and as words in
  // the sample line and the carried-detail panel below. A data attribute is not
  // read to anyone, so it is never the only place this is said.
  region.dataset.provenance = journey.provenance?.kind ?? "own-records";
  body.replaceChildren();

  const question = doc.getElementById(JOURNEY_IDS.question);
  if (question) question.textContent = journey.question;
  const sample = doc.getElementById(JOURNEY_IDS.sample);
  if (sample && journey.sample) sample.textContent = journey.sample;

  // The phase, as a shape and a word before any tint is read.
  const phase = element(doc, "p", "fjc-phase");
  const phaseShape = element(doc, "span", "fjc-phase-shape",
    PHASE_SHAPE[journey.phase] ?? "○");
  phaseShape.setAttribute("aria-hidden", "true");
  phase.append(phaseShape, element(doc, "span", "fjc-phase-word", journey.phaseLabel),
    element(doc, "span", "fjc-phase-copy", journey.phaseCopy));
  body.append(phase, element(doc, "p", "fjc-headline", journey.headline));

  // 1 — the material figure that answers the question.
  const metric = element(doc, "section", "fjc-metric");
  metric.id = JOURNEY_IDS.metric;
  metric.dataset.known = String(journey.metric.known);
  metric.setAttribute("aria-labelledby", "finops-journey-metric-title");
  const metricTitle = element(doc, "h3", "fjc-slot-label", journey.metric.label);
  metricTitle.id = "finops-journey-metric-title";
  metric.append(metricTitle,
    element(doc, "strong", "fjc-metric-value", journey.metric.value),
    element(doc, "p", "fjc-metric-comparison", journey.metric.comparison));
  body.append(metric);

  // 2 — the one prioritized action. A real anchor, so it is operable by keyboard
  // before any of this module runs a second time, correct in the address bar,
  // and correct when copied.
  const decision = element(doc, "section", "fjc-decision");
  decision.setAttribute("aria-labelledby", "finops-journey-decision-title");
  const decisionTitle = element(doc, "h3", "fjc-decision-title", journey.action.label);
  decisionTitle.id = "finops-journey-decision-title";
  const link = element(doc, "a", "fjc-action", journey.action.label);
  link.id = JOURNEY_IDS.action;
  link.href = journey.action.href;
  link.dataset.primaryAction = journey.action.kind;
  decision.append(element(doc, "p", "fjc-kicker", "Do this next · priority 1"),
    decisionTitle, link, element(doc, "p", "fjc-rationale", journey.action.rationale));
  body.append(decision);

  // 3 — and, only where it is the answer, the checkpoint that will judge it.
  // The bundled-example phase joins it for the reason the question exists: a
  // step with no stated way to tell whether it worked is half an answer, and
  // the example schedules its own checkpoint (#1020).
  if (journey.phase === JOURNEY_PHASE.verificationReady
    || journey.phase === JOURNEY_PHASE.bundledExample) {
    body.append(checkpointBlock(doc, journey));
  }

  if (journey.notice) {
    const notice = element(doc, "p", "fjc-notice", journey.notice);
    notice.dataset.notice = "carried";
    body.append(notice);
  }

  // Everything below is support. It is on this surface, one press away, and
  // collapsed — not on another page and not gone.
  const support = element(doc, "section", "fjc-support");
  support.setAttribute("aria-labelledby", "finops-journey-support-title");
  const supportTitle = element(doc, "h3", "fjc-support-title", "Supporting evidence");
  supportTitle.id = "finops-journey-support-title";
  support.append(supportTitle, element(doc, "p", "fjc-support-note",
    "Everything in this group supports the step above. None of it is the decision."));
  if (journey.signals.length) support.append(signalRow(doc, journey.signals));
  support.append(
    disclosure(doc, "finops-journey-decided", "What was already decided", journey.decided),
    disclosure(doc, "finops-journey-remaining", "What remains", journey.remaining),
    disclosure(doc, "finops-journey-prior", "Prior action results carried here",
      journey.priorResults),
    disclosure(doc, "finops-journey-department", "Department detail", journey.departments),
  );
  body.append(support);

  // Said once, and only when the phase actually moved. A live region that speaks
  // on every repaint is one a reader learns to ignore.
  const live = doc.getElementById(JOURNEY_IDS.live);
  if (live && previousPhase && previousPhase !== journey.phase) {
    live.textContent = `${journey.phaseLabel}. ${journey.headline}`;
  }
  return region;
}
