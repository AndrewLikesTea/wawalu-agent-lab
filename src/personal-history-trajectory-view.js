// The trajectory finding, drawn, and the handoff that follows it.
//
// It renders what `personal-history-trajectory.js` decides and decides nothing:
// every sentence, threshold, and figure arrives on the model. `createElement`
// and `textContent` only — never a markup string, and never an assignment of
// HTML into the document.
//
// WHAT A READER READS, IN THIS ORDER
// ----------------------------------
//   1. the finding, in one sentence, and whether it is a direction at all;
//   2. the two readings side by side, each labelled with which one it is —
//      because "before and after" is the only shape in which a person can check
//      a claim about their own history against their own memory of it;
//   3. how far to trust the comparison, with the caveat in the same paragraph
//      as the direction rather than under a fold;
//   4. what this does not claim, beside what it does;
//   5. everything that supports it, behind one labelled button.
//
// SIX STATES, ALL DRAWN. A section that appeared only when a comparison worked
// would leave a reader unable to tell "nothing moved" from "the earlier reading
// was discarded", and those are different facts about their own history. The
// three non-directional states get the same heading, the same shape, and the
// same weight as the three directional ones.
//
// RESPONSIVE BY STRUCTURE. The two readings are a pair of definition lists in
// one container; the stylesheet places them side by side where there is room and
// stacks them where there is not. Neither the reading order nor the tab order
// changes with the layout, so a narrow viewport is a different arrangement of
// the same document rather than a different document.
//
// NO PROMPT TEXT REACHES THIS MODULE. There is none in a report or a comparison
// to render, and the handoff brief is built from rubric copy and this
// repository's own identifiers.

import { COPY_METHOD, copySummaryText } from "/coaching-summary.js";
import {
  TRAJECTORY_HANDOFF, TRAJECTORY_MATERIALITY, trajectoryHandoff,
} from "/personal-history-trajectory.js";

/* -------------------------------- helpers -------------------------------- */

const COUNT = new Intl.NumberFormat("en-US");
const count = (value) => (Number.isFinite(value) ? COUNT.format(value) : "—");
const percent = (ratio) => (Number.isFinite(ratio) ? `${Math.round(ratio * 100)}%` : "not measurable");
const plural = (value, one, many) => `${count(value)} ${value === 1 ? one : many}`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function line(parent, className, text) {
  const node = el("p", className, text);
  parent.append(node);
  return node;
}

/* ------------------------------ the finding ------------------------------ */

export const TRAJECTORY_TOGGLE_ID = "ph-toggle-trajectory";
export const TRAJECTORY_PANEL_ID = "ph-panel-trajectory";

export const HANDOFF_COPY_ID = "ph-handoff-copy";
export const HANDOFF_STATUS_ID = "ph-handoff-status";
export const HANDOFF_TEXT_ID = "ph-handoff-text";
export const HANDOFF_FALLBACK_ID = "ph-handoff-fallback";
const HANDOFF_LEAD_ID = "ph-handoff-lead";

/** Which reading a side is, said as a person would say it. */
const SIDE_LABEL = Object.freeze({ previous: "Your last reading", current: "This reading" });

/**
 * One side of the before/after, as a definition list.
 *
 * Every row is a figure the other side also has, in the same order, so the two
 * lists read as a comparison down the page as well as across it — which is the
 * arrangement a narrow viewport falls back to.
 */
function readingSide(which, side) {
  const block = el("div", "ph-reading");
  block.dataset.side = which;
  const heading = el("h5", "ph-reading-title", SIDE_LABEL[which]);
  heading.id = `ph-reading-${which}`;
  block.append(heading);

  if (!side) {
    line(block, "ph-reading-absent", which === "previous"
      ? "There is no earlier reading in this browser to place here."
      : "This reading named no move, so it has no cost per request to place here.");
    return block;
  }

  const list = el("dl", "ph-reading-facts");
  list.setAttribute("aria-labelledby", heading.id);
  const row = (term, value) => {
    list.append(el("dt", "ph-reading-term", term));
    list.append(el("dd", "ph-reading-value", value));
  };
  row("Reading", `#${count(side.reading)}`);
  row("Cost per request", `${side.pointsPerScoredPrompt} points`);
  row("Prompts scored", count(side.scoredPrompts));
  row("Distinct days", count(side.distinctDays));
  row("Coverage", percent(side.coverage));
  row("Confidence", side.confidence);
  block.append(list);
  return block;
}

/** The two readings, in one container, in reading order. */
function beforeAfter(trajectory) {
  const pair = el("div", "ph-readings");
  pair.append(readingSide("previous", trajectory.readings.previous));
  // Decoration, and only decoration: the two lists are already labelled "your
  // last reading" and "this reading", so the arrow adds direction for a sighted
  // reader and nothing at all for anyone else.
  const arrow = el("p", "ph-readings-arrow", "→");
  arrow.setAttribute("aria-hidden", "true");
  pair.append(arrow);
  pair.append(readingSide("current", trajectory.readings.current));
  return pair;
}

/** The supporting detail, behind one button, shut by default. */
function evidenceDisclosure(trajectory) {
  const section = el("section", "ph-disclosure ph-trajectory-disclosure");
  section.dataset.level = "trajectory";

  const heading = el("h5", "ph-disclosure-heading");
  const button = el("button", "ph-toggle");
  button.setAttribute("type", "button");
  button.id = TRAJECTORY_TOGGLE_ID;
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", TRAJECTORY_PANEL_ID);
  button.append(el("span", "ph-toggle-mark", "+"));
  button.append(el("span", "ph-toggle-label", "How this comparison was drawn"));
  button.append(el("span", "ph-toggle-hint",
    "The compared figure, what a period is, when a difference counts as movement, and where each "
    + "side came from"));
  heading.append(button);
  section.append(heading);

  const panel = el("div", "ph-panel");
  panel.id = TRAJECTORY_PANEL_ID;
  panel.hidden = true;

  const body = el("div", "ph-panel-body");
  body.append(el("h6", "ph-panel-subhead", "The compared figure"));
  line(body, "ph-trajectory-metric", trajectory.metric.definition);
  line(body, "ph-trajectory-metric-excludes", `Excluded: ${trajectory.metric.excludes}`);

  body.append(el("h6", "ph-panel-subhead", "What a period is"));
  line(body, "ph-trajectory-period", trajectory.period.rule);
  line(body, "ph-trajectory-period-why", trajectory.period.why);

  body.append(el("h6", "ph-panel-subhead", "When a difference counts as movement"));
  line(body, "ph-trajectory-materiality", TRAJECTORY_MATERIALITY.rule);
  line(body, "ph-trajectory-materiality-assumption", TRAJECTORY_MATERIALITY.assumption);
  line(body, "ph-trajectory-materiality-why", TRAJECTORY_MATERIALITY.why);
  if (trajectory.movement) {
    line(body, "ph-trajectory-threshold",
      `This comparison moved ${trajectory.movement.magnitude} points per scored prompt`
      + `${trajectory.movement.share === null ? "" : ` (${percent(trajectory.movement.share)} of the `
        + "earlier figure)"}, against a threshold of ${trajectory.movement.threshold} points — `
      + `${trajectory.movement.material ? "enough to report a direction" : "not enough to report a direction"}.`);
  }

  body.append(el("h6", "ph-panel-subhead", "Where each side came from"));
  line(body, "ph-trajectory-provenance-previous", trajectory.provenance.previous);
  line(body, "ph-trajectory-provenance-current", trajectory.provenance.current);
  line(body, "ph-trajectory-provenance-neither", trajectory.provenance.neither);

  panel.append(body);
  section.append(panel);
  return section;
}

/**
 * The whole finding.
 *
 * The container keeps `ph-carry` and `data-carry` alongside the new names: the
 * carry-forward state is still the thing a test of the storage seam wants to
 * assert, and the trajectory state is a reading of it rather than a replacement
 * for it.
 *
 * @param {object} trajectory from `buildTrajectory`.
 * @returns {Element} a section, or null when there is no trajectory to draw.
 */
export function renderTrajectory(trajectory) {
  if (!trajectory) return null;
  const section = el("section", "ph-carry ph-trajectory");
  section.dataset.carry = trajectory.carryState;
  section.dataset.trajectory = trajectory.state;
  if (trajectory.movement) section.dataset.direction = trajectory.movement.direction;
  section.dataset.material = trajectory.movement?.material ? "true" : "false";

  const heading = el("h4", "ph-section-title", "Against your last reading");
  heading.id = "ph-trajectory-title";
  section.setAttribute("aria-labelledby", heading.id);
  section.append(heading);

  // One headline, and it is the finding's own sentence. Where a direction was
  // drawn the headline *is* the direction — a second line restating it in other
  // words would read as two findings, and a reader counting findings on a page
  // about their own habits is counting things that were never measured.
  line(section, trajectory.movement ? "ph-trajectory-headline ph-carry-direction" : "ph-trajectory-headline",
    trajectory.finding.headline);

  if (trajectory.movement) {
    // The arithmetic sits directly under the sentence it produced: a reader who
    // disputes the claim is one line away from the two numbers behind it rather
    // than one disclosure away.
    line(section, "ph-carry-arithmetic", `${trajectory.movement.arithmetic}. `
      + `This reading scored ${plural(trajectory.readings.current.scoredPrompts, "prompt", "prompts")} `
      + `across ${plural(trajectory.readings.current.distinctDays, "day", "days")}; the last scored `
      + `${plural(trajectory.readings.previous.scoredPrompts, "prompt", "prompts")}.`);
    if (trajectory.movement.rule) line(section, "ph-trajectory-rule", trajectory.movement.rule);
  } else {
    // The carry-forward module's own sentence, unedited. It is the answer to
    // "why is there no comparison", and it is the only place that answer is
    // written down.
    line(section, "ph-carry-reason", trajectory.reasonRule);
  }

  section.append(beforeAfter(trajectory));

  const confidence = el("div", "ph-trajectory-confidence");
  confidence.dataset.confidence = trajectory.confidence.level;
  confidence.append(el("h5", "ph-reading-title", "How far to trust this comparison"));
  line(confidence, "ph-trajectory-confidence-level",
    `Held at ${trajectory.confidence.level} — ${trajectory.confidence.heldAt}.`);
  if (trajectory.confidence.caveat) {
    line(confidence, "ph-trajectory-confidence-caveat", trajectory.confidence.caveat);
  }
  section.append(confidence);

  line(section, "ph-trajectory-claims", trajectory.finding.claims);
  line(section, "ph-trajectory-refuses", trajectory.finding.refuses);
  line(section, "ph-carry-basis", trajectory.basis.refusal);

  section.append(evidenceDisclosure(trajectory));
  return section;
}

/* ------------------------------- the handoff ------------------------------- */

/**
 * The one move, prepared for the surface that can act on it in a minute.
 *
 * Drawn inside "Do this next" rather than as a section of its own, because it is
 * not a second answer: it is the same answer, with the next press attached. A
 * reading that named no move draws nothing here at all.
 *
 * @param {object} report a report from `buildPersonalHistoryReport`.
 * @returns {Element|null}
 */
export function renderHandoff(report) {
  const handoff = trajectoryHandoff(report);
  if (!handoff.available) return null;

  const block = el("div", "ph-handoff");
  block.dataset.handoff = "available";
  block.dataset.moveId = handoff.moveId;

  block.append(el("h5", "ph-action-subhead", TRAJECTORY_HANDOFF.title));
  const lead = line(block, "ph-handoff-lead", TRAJECTORY_HANDOFF.lead);
  lead.id = HANDOFF_LEAD_ID;

  const actions = el("div", "ph-handoff-actions");
  const copy = el("button", "ph-handoff-copy", handoff.starter
    ? "Copy the prompt to start from"
    : "Copy this move");
  copy.setAttribute("type", "button");
  copy.id = HANDOFF_COPY_ID;
  copy.setAttribute("aria-describedby", `${HANDOFF_LEAD_ID} ${HANDOFF_STATUS_ID}`);
  actions.append(copy);

  const link = el("a", "ph-handoff-link", TRAJECTORY_HANDOFF.linkLabel);
  link.setAttribute("href", TRAJECTORY_HANDOFF.href);
  actions.append(link);
  block.append(actions);

  const status = el("p", "ph-handoff-status");
  status.id = HANDOFF_STATUS_ID;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  block.append(status);

  // The brief lives in the field the copy reads from, so the clipboard and the
  // fallback can never disagree about what was carried. Hidden until a copy
  // fails: a readonly box nobody needs is a tab stop nobody wants.
  const fallback = el("div", "ph-handoff-fallback");
  fallback.id = HANDOFF_FALLBACK_ID;
  fallback.hidden = true;
  const label = el("label", "ph-handoff-label", "Copy this yourself");
  label.setAttribute("for", HANDOFF_TEXT_ID);
  const box = el("textarea", "ph-handoff-text");
  box.id = HANDOFF_TEXT_ID;
  box.setAttribute("rows", "9");
  box.setAttribute("readonly", "readonly");
  box.setAttribute("spellcheck", "false");
  box.value = handoff.brief;
  fallback.append(label, box);
  block.append(fallback);

  line(block, "ph-handoff-boundary", TRAJECTORY_HANDOFF.boundary);
  return block;
}

/**
 * Wire the copy control, once per rendered report.
 *
 * The clipboard is read at press time rather than at wiring time: a page entry
 * runs before a reader has granted anything, and the object available at load is
 * not necessarily the one available at the press.
 *
 * @param {Element} root the rendered report.
 * @param {Document} doc the document holding it.
 * @param {{clipboard?: object}} deps injected for tests.
 * @returns {Element|null} the button, or null when no handoff was drawn.
 */
export function wireHandoff(root, doc = globalThis.document, deps = {}) {
  const button = root?.querySelector?.(`#${HANDOFF_COPY_ID}`) ?? null;
  if (!button || button.dataset.wired === "true") return button;
  button.dataset.wired = "true";

  button.addEventListener("click", async () => {
    const box = root.querySelector(`#${HANDOFF_TEXT_ID}`);
    const status = root.querySelector(`#${HANDOFF_STATUS_ID}`);
    const fallback = root.querySelector(`#${HANDOFF_FALLBACK_ID}`);
    // Disabled and labelled for the duration: a second press mid-copy races two
    // writes at one clipboard, and a control that goes quiet reads as broken.
    button.disabled = true;
    if (status) {
      status.textContent = "Copying…";
      status.dataset.outcome = "pending";
    }

    const clipboard = "clipboard" in deps ? deps.clipboard : globalThis.navigator?.clipboard;
    const outcome = await copySummaryText(box?.value ?? "", { clipboard, doc });

    button.disabled = false;
    if (status) {
      status.textContent = outcome.message;
      status.dataset.outcome = outcome.ok ? "copied" : "manual";
    }
    if (!fallback) return;
    fallback.hidden = outcome.ok;
    if (outcome.method === COPY_METHOD.manual) {
      // Focus follows the instruction: the status line has just told the reader
      // to press a key, so the thing that copies has to be what is selected.
      box?.focus?.();
      box?.select?.();
    }
  });

  return button;
}
