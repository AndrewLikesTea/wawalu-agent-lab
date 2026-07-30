// ONE DECISIVE FINDING, not a stack of peer alerts.
//
// This panel used to paint two independent disclosure stacks — a "why was this
// classified this way" details inside the finding box, and a "how this is
// counted" details under the action — plus a loose caveat list. Three controls,
// three vocabularies, and a reader who wanted the release count had to guess
// which one held it. A leader reading a ratio has one question ("is AI spend
// keeping pace with what we shipped, and can I trust it?") and needs one answer
// with one place to check it.
//
// So the body is now a single evidence-backed finding:
//
//     the question (the section heading)
//     the answer, one sentence
//     the figure, or the reason a figure is withheld
//     the prior-period comparison
//     the classification and its priority
//     confidence
//     the non-causal framing
//     the one prioritized next action
//     one disclosure group — six named topics, in the order a dispute travels
//
// Nothing was dropped in the consolidation: every list the two old disclosures
// rendered now sits under the topic it belongs to, and `SPEND_PER_DELIVERY_
// DISCLOSURES` is the one declaration of what those topics are, so the view and
// its tests cannot hold two lists.
//
// STATES. Four, and the section can only be in one: `loading` while local
// records are being read, `error` when the read failed, the derivation's own
// reading states (eligible / insufficient / mismatched) when there is something
// to say, and `absent` when nothing has been read. Loading and error never blank
// a reading that is already on screen — they caption it — because a leader who
// loses the figure they were reading assumes the product broke.
//
// ACCESSIBILITY. Every disclosure is a native `details`/`summary`: keyboard
// operable, expanded state exposed, no tabindex and no role added on top of one.
// Headings are real headings, so a heading list is a table of contents. Colour
// never carries meaning alone — every shape is `aria-hidden` and repeated by a
// word. The status line is `role="status"` while loading and `role="alert"` on
// failure only; a withheld ratio is a finished, honest answer and does not
// interrupt anyone. Nodes are built with createElement and textContent.

import { deliveryEfficiencyFinding } from "./delivery-efficiency-finding.js";
import {
  MINIMUM_BASELINE_PERIODS, MINIMUM_DELIVERIES, MINIMUM_PERIOD_DAYS,
  SPEND_PER_DELIVERY_RULES, SPEND_PER_DELIVERY_STATE,
} from "./spend-per-delivery.js";

export const SPEND_PER_DELIVERY_SECTION_ID = "spend-per-delivery";
export const SPEND_PER_DELIVERY_BODY_ID = "spend-per-delivery-body";
export const SPEND_PER_DELIVERY_LIVE_ID = "spend-per-delivery-live";
export const SPEND_PER_DELIVERY_DETAIL_ID = "spend-per-delivery-detail";

/** The two phases that are not a reading. `ready` is the absence of both. */
export const SPEND_PER_DELIVERY_PHASE = Object.freeze({
  loading: "loading", error: "error", ready: "ready",
});

/**
 * The disclosure group, in reading order, declared once.
 *
 * The order is the order a dispute travels: a reader who doubts the figure asks
 * *which period is this* first, then *what was counted*, then *what was left
 * out*, then *where did it come from*, then *how sure is this*, and only then
 * *what may I not conclude*. Each key is stable — it is on the element as
 * `data-disclosure`, so a test and a stylesheet name the same section the panel
 * does.
 */
export const SPEND_PER_DELIVERY_DISCLOSURES = Object.freeze([
  Object.freeze({
    key: "period-alignment",
    summary: "Which period this covers, and whether the two sides align",
  }),
  Object.freeze({
    key: "release-counts",
    summary: "How many releases were counted, and against which floors",
  }),
  Object.freeze({
    key: "excluded-records",
    summary: "What was excluded from these counts, and why",
  }),
  Object.freeze({
    key: "provenance",
    summary: "Where these figures came from",
  }),
  Object.freeze({
    key: "confidence",
    summary: "How this was classified, and how far to trust it",
  }),
  Object.freeze({
    key: "limits",
    summary: "What this cannot tell you",
  }),
]);

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shape(doc, glyph) {
  const node = element(doc, "span", "spd-shape", glyph);
  node.setAttribute("aria-hidden", "true");
  return node;
}

function list(doc, className, items) {
  const node = element(doc, "ul", className);
  for (const item of items) node.append(element(doc, "li", null, item));
  return node;
}

/** The shapes are redundant with the words beside them, never a substitute. */
const DIRECTION_SHAPE = Object.freeze({ higher: "▲", lower: "▼", level: "—" });
const CONFIDENCE_SHAPE = Object.freeze({
  high: "●●●", medium: "●●○", low: "●○○", none: "○○○",
});

function held(section) {
  if (!section.__spendPerDelivery) {
    // `open` is a set of disclosure keys and not one boolean: the reader who
    // opened "excluded records" is not asking for the whole group back.
    section.__spendPerDelivery = { model: null, open: new Set() };
  }
  return section.__spendPerDelivery;
}

/**
 * Write the live region only when the sentence actually changed. A repaint of the
 * same reading is not news, and rewriting a status region re-announces it.
 */
function announce(doc, text) {
  const node = byId(doc, SPEND_PER_DELIVERY_LIVE_ID);
  if (!node || node.textContent === text) return node;
  node.textContent = text;
  return node;
}

const usd = (value) => `${value.toLocaleString("en-US", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})} USD`;

function figureBlock(doc, state) {
  const { metric, window } = state;
  const wrap = element(doc, "p", "spd-figure");
  wrap.append(element(doc, "span", "spd-figure-value", usd(metric.spendPerDeliveryUsd)));
  wrap.append(element(doc, "span", "spd-figure-unit", "per completed release"));
  // The arithmetic, beside the result. Both operands and the window are named, so
  // the figure can be recomputed from the line that displays it.
  wrap.append(element(doc, "span", "spd-figure-basis",
    `${usd(metric.spendUsd)} of recorded AI spend ÷ ${metric.deliveries} completed`
    + ` release${metric.deliveries === 1 ? "" : "s"}, ${window.start} to ${window.end}`
    + ` (end exclusive, ${window.days} days).`));
  return wrap;
}

function comparisonBlock(doc, state) {
  const { comparison } = state;
  const wrap = element(doc, "p", "spd-comparison");
  if (comparison.available) {
    wrap.dataset.direction = comparison.direction;
    wrap.append(shape(doc, DIRECTION_SHAPE[comparison.direction] ?? "—"));
    wrap.append(element(doc, "span", "spd-delta",
      `${comparison.deltaPercent > 0 ? "+" : ""}${comparison.deltaPercent.toFixed(1)}%`
      + ` vs baseline · ${comparison.direction}`));
  }
  wrap.append(element(doc, "span", "spd-comparison-text", comparison.interpretation));
  return wrap;
}

/** Repeated by the classification word beside it, never a substitute for it. */
const CLASSIFICATION_SHAPE = Object.freeze({
  material_ratio_increase: "▲", material_ratio_decrease: "▼", stable_ratio: "—",
  insufficient_evidence: "○", invalid_period_alignment: "✕",
});

/**
 * The classified finding, reduced to what it is: the word, where it ranks, and
 * the one sentence a reader who reads nothing else reads.
 *
 * The rationale, the thresholds and the caveats that used to hang off this block
 * in a disclosure of its own now live in the group below, under the topics they
 * answer. They are not optional there — the group is rendered in every state —
 * so the classification is still disputable from the screen, from one control
 * set rather than two.
 */
function findingBlock(doc, finding) {
  const wrap = element(doc, "div", "spd-finding");
  wrap.dataset.classification = finding.classification;
  wrap.dataset.priorityRank = String(finding.priority.rank);
  const head = element(doc, "p", "spd-finding-head");
  head.append(shape(doc, CLASSIFICATION_SHAPE[finding.classification] ?? "○"));
  head.append(element(doc, "span", "spd-finding-class",
    finding.classification.replace(/_/g, " ")));
  head.append(element(doc, "span", "spd-finding-priority",
    `Priority ${finding.priority.rank}: ${finding.priority.band.replace(/_/g, " ")}`));
  wrap.append(head);
  wrap.append(element(doc, "p", "spd-finding-headline", finding.headline));
  return wrap;
}

function actionBlock(doc, state) {
  const { nextAction } = state;
  const wrap = element(doc, "div", "spd-action");
  wrap.append(element(doc, "h3", "spd-action-title", "Do this next"));
  wrap.append(element(doc, "p", "spd-action-text", nextAction.text));
  if (nextAction.href) {
    const link = element(doc, "a", "spd-action-link", "Open the release log");
    link.setAttribute("href", nextAction.href);
    wrap.append(link);
  }
  wrap.append(element(doc, "p", "spd-action-owner", `Accountable: ${nextAction.owner}`));
  wrap.append(element(doc, "p", "spd-action-why", nextAction.why));
  return wrap;
}

/* ---------------------------- the disclosure group --------------------------- */

const heading = (doc, text) => element(doc, "h4", "spd-detail-heading", text);

/** Which period, and whether the two sides of the ratio describe it. */
function periodAlignmentContent(doc, state) {
  const aligned = state.state === SPEND_PER_DELIVERY_STATE.eligible;
  const nodes = [element(doc, "p", "spd-detail-line", state.window
    ? `Billing period ${state.window.start} to ${state.window.end}: ${state.window.days} days,`
      + " start inclusive and end exclusive."
    : "No billing period was read in this tab, so there is no window to align to.")];
  const verdict = element(doc, "p", "spd-alignment");
  verdict.dataset.aligned = String(aligned);
  verdict.append(shape(doc, aligned ? "✓" : "✕"));
  verdict.append(element(doc, "span", "spd-alignment-text", aligned
    ? "Aligned: the spend window and the releases counted against it describe the same period."
    : `Not aligned: this reading is held at "${(state.reasonCode ?? "no reading")
      .replace(/_/g, " ")}", so no window pairs the two sides yet.`));
  nodes.push(verdict);
  nodes.push(element(doc, "p", "spd-rule", SPEND_PER_DELIVERY_RULES.window));
  nodes.push(element(doc, "p", "spd-rule", SPEND_PER_DELIVERY_RULES.headlinePeriod));
  return nodes;
}

/** What was counted, and the floors the counts were checked against. */
function releaseCountContent(doc, state) {
  const nodes = [heading(doc, "What was counted"), list(doc, "spd-evidence", state.evidence)];
  nodes.push(element(doc, "p", "spd-detail-line",
    `Floors this reading is checked against: at least ${MINIMUM_PERIOD_DAYS} days in the billing`
    + ` period, and at least ${MINIMUM_DELIVERIES} releases recorded as completed inside it.`
    + " Below either floor a per-release figure describes those releases rather than the period,"
    + " so none is published."));
  if (state.comparison.baselinePeriods !== null) {
    nodes.push(element(doc, "p", "spd-detail-line",
      `Trailing baseline: ${state.comparison.baselinePeriods} earlier billing`
      + ` period${state.comparison.baselinePeriods === 1 ? "" : "s"} cleared the same floor;`
      + ` ${MINIMUM_BASELINE_PERIODS} are needed before a comparison is published.`));
  }
  return nodes;
}

/**
 * What was left out. Every entry is a structured fact rather than a re-reading
 * of the counts above: periods the baseline refused, local fields nothing
 * declared, and the source text this panel will not carry at any length.
 */
function excludedRecordContent(doc, state, finding) {
  const items = [];
  // Rendered at zero too. "Nothing was excluded" is the answer a reader opening
  // this disclosure came for, and omitting it leaves them unable to tell a clean
  // baseline from one this panel forgot to mention.
  const dropped = state.comparison.baselineExcludedPeriods;
  if (dropped !== null) {
    items.push(dropped === 0
      ? "No earlier billing period was excluded from the trailing baseline: every one read here"
        + " cleared the same floor as this reading."
      : `${dropped} earlier billing period${dropped === 1 ? " was" : "s were"} excluded from the`
        + " trailing baseline for failing the same floor as this one, and none was counted as"
        + " zero.");
  }
  if (state.provenance.missingFields.length) {
    items.push(`These local fields did not back this figure and lower its confidence:`
      + ` ${state.provenance.missingFields.join(", ")}.`);
  }
  items.push("Free text from a provider file or a release form is never carried into this"
    + ` finding: ${finding.redaction.excludedFields.join(", ")}.`
    + ` ${finding.redaction.excludedReason}`);
  const nodes = [list(doc, "spd-excluded", items)];
  nodes.push(element(doc, "p", "spd-detail-line",
    "Release records the counts above name as uncounted — outside the window, or carrying an"
    + " unreadable completion date — are listed there rather than repeated here."));
  return nodes;
}

/** Where the two sides came from, and whether every required field was there. */
function provenanceContent(doc, state) {
  const nodes = [element(doc, "p", "spd-provenance", state.provenance.source)];
  nodes.push(element(doc, "p", "spd-provenance-fields", state.provenance.complete
    ? "Every local field this comparison requires was present."
    : `Missing local fields: ${state.provenance.missingFields.join(", ")}.`));
  nodes.push(element(doc, "p", "spd-detail-line", state.provenance.origin === "example"
    ? "Origin: the bundled synthetic example dataset. These are invented records, not your spend."
    : "Origin: files you chose in this tab and this browser's own release log. Nothing was"
      + " uploaded, and nothing is stored after the tab closes."));
  nodes.push(element(doc, "p", "spd-detail-line",
    `Local fields declared behind this reading: ${state.provenance.declaredFields.length
      ? state.provenance.declaredFields.join(", ") : "none"}.`));
  return nodes;
}

/** How far to trust it, and every rule that produced the classification. */
function confidenceContent(doc, state, finding) {
  const nodes = [element(doc, "p", "spd-detail-line",
    `Confidence is ${state.confidence.level}. ${state.confidence.basis}`)];
  nodes.push(element(doc, "p", "spd-rule", SPEND_PER_DELIVERY_RULES.confidence));
  nodes.push(heading(doc, "Rules applied, in order"));
  nodes.push(list(doc, "spd-finding-rationale", finding.rationale.map((step) => step.text)));
  nodes.push(heading(doc, "Thresholds, and the assumption behind each"));
  nodes.push(list(doc, "spd-finding-thresholds", [
    `Material change: ${finding.thresholds.materialChangePercent.value}%`
    + ` (${finding.thresholds.materialChangePercent.unit}). `
    + finding.thresholds.materialChangePercent.assumption,
    `Single-release sensitivity: ${finding.thresholds.singleReleaseSensitivity.value}. `
    + finding.thresholds.singleReleaseSensitivity.assumption,
    `Priority. ${finding.priority.rule} ${finding.priority.assumption}`,
  ]));
  return nodes;
}

/**
 * The limits, stated as limits and not as a footnote.
 *
 * The framing sentence has its own paragraph in the body above and is dropped
 * from the caveat list here, so the reader is not told the same thing twice.
 */
function limitContent(doc, state, finding) {
  const nodes = [heading(doc, "What can move this ratio with no change in delivery")];
  nodes.push(list(doc, "spd-confounders", state.confounders));
  nodes.push(heading(doc, "Read this only with"));
  nodes.push(list(doc, "spd-finding-caveats",
    finding.requiredCaveats.filter((caveat) => caveat !== finding.framing.statement)));
  return nodes;
}

const DISCLOSURE_CONTENT = Object.freeze({
  "period-alignment": (doc, state) => periodAlignmentContent(doc, state),
  "release-counts": (doc, state) => releaseCountContent(doc, state),
  "excluded-records": (doc, state, finding) => excludedRecordContent(doc, state, finding),
  provenance: (doc, state) => provenanceContent(doc, state),
  confidence: (doc, state, finding) => confidenceContent(doc, state, finding),
  limits: (doc, state, finding) => limitContent(doc, state, finding),
});

/**
 * One group, six native disclosures, each remembering whether this reader opened
 * it. The group is a labelled region rather than a bare div so a screen-reader
 * user landing in it is told what these six controls are for.
 */
function disclosureGroup(doc, state, finding, store) {
  const group = element(doc, "div", "spd-disclosures");
  group.id = SPEND_PER_DELIVERY_DETAIL_ID;
  group.setAttribute("role", "group");
  const label = element(doc, "h3", "spd-disclosures-title",
    "Check this finding");
  label.id = `${SPEND_PER_DELIVERY_DETAIL_ID}-title`;
  group.setAttribute("aria-labelledby", label.id);
  group.append(label);
  for (const { key, summary } of SPEND_PER_DELIVERY_DISCLOSURES) {
    const details = element(doc, "details", "spd-detail");
    details.dataset.disclosure = key;
    details.open = store.open.has(key);
    details.append(element(doc, "summary", "spd-detail-summary", summary));
    for (const node of DISCLOSURE_CONTENT[key](doc, state, finding)) details.append(node);
    details.addEventListener("toggle", () => {
      if (details.open) store.open.add(key);
      else store.open.delete(key);
    });
    group.append(details);
  }
  return group;
}

/* -------------------------------- the phases --------------------------------- */

const PHASE_PRESENTATION = Object.freeze({
  [SPEND_PER_DELIVERY_PHASE.loading]: Object.freeze({
    glyph: "◌", word: "Reading", role: "status",
    summary: "Reading local spend and release records in this tab…",
  }),
  [SPEND_PER_DELIVERY_PHASE.error]: Object.freeze({
    glyph: "✕", word: "Not read", role: "alert",
    summary: "This comparison could not be read.",
  }),
});

/**
 * Caption the panel with a phase that is not a reading.
 *
 * Neither phase blanks a reading that is already on screen: the status line is
 * inserted above whatever the body holds, and says which of the two situations
 * the reader is in. Losing the figure mid-refresh is the failure this avoids —
 * a leader who watches a number vanish concludes the product broke, which is a
 * worse answer than "the number below is the previous one".
 *
 * @param phase one of `SPEND_PER_DELIVERY_PHASE`; `ready` clears the caption.
 * @param options.detail the one sentence naming what a reader does about it.
 * @param options.announce false when the page already owns the announcement for
 *   this change — a failed bundled fetch is one event with one retry, and the
 *   page has a single load-state region for it. Two alerts for one failure is an
 *   interruption a reader did nothing to earn, so the word, the glyph and the
 *   tone stay and only the live-region role steps down to `note`.
 * @returns the status node, or null when there is nothing to caption.
 */
export function applySpendPerDeliveryPhase(doc, phase, { detail, announce: live = true } = {}) {
  const section = byId(doc, SPEND_PER_DELIVERY_SECTION_ID);
  const body = byId(doc, SPEND_PER_DELIVERY_BODY_ID);
  if (!section || !body) return null;
  const store = held(section);
  const presentation = PHASE_PRESENTATION[phase];
  body.querySelector(".spd-status")?.remove();
  if (!presentation) {
    // Back to a reading. A panel that never held one goes back to hidden rather
    // than to an empty box with a heading over it.
    section.dataset.phase = SPEND_PER_DELIVERY_PHASE.ready;
    section.removeAttribute("aria-busy");
    if (!store.model) section.hidden = true;
    return null;
  }
  const status = element(doc, "div", "spd-status");
  status.dataset.phase = phase;
  const line = element(doc, "p", "spd-status-line");
  line.setAttribute("role", live ? presentation.role : "note");
  line.append(shape(doc, presentation.glyph));
  line.append(element(doc, "span", "spd-status-word", presentation.word));
  line.append(element(doc, "span", "spd-status-summary", presentation.summary));
  status.append(line);
  const sentence = detail ?? (store.model
    ? "The reading below is the previous one and has not been replaced."
    : "No figure is published for this question yet.");
  status.append(element(doc, "p", "spd-status-detail", sentence));
  body.prepend(status);

  section.hidden = false;
  section.dataset.phase = phase;
  if (phase === SPEND_PER_DELIVERY_PHASE.loading) section.setAttribute("aria-busy", "true");
  else section.removeAttribute("aria-busy");
  if (live) announce(doc, `${presentation.summary} ${sentence}`);
  return status;
}

/**
 * Paint the comparison, or hand the section back when there is nothing to say.
 *
 * Returns the state that was painted so a caller can assert on what it asked for
 * rather than on the DOM it got.
 *
 * The classified finding defaults to the one this state scores to, so there is no
 * way to paint this panel without it: a caller cannot render a ratio while
 * omitting the classification, the priority, or the caveats it may not be read
 * without. The parameter exists so the page can pass the finding it already built
 * rather than scoring the same state twice.
 */
export function applySpendPerDelivery(doc, state, finding) {
  const section = byId(doc, SPEND_PER_DELIVERY_SECTION_ID);
  if (!section || !state) return null;
  if (state.state === SPEND_PER_DELIVERY_STATE.absent) return clearSpendPerDelivery(doc);
  // Scored here when the caller did not, and never skipped. The score is derived
  // from the state, so computing it twice cannot produce two answers.
  const scored = finding ?? deliveryEfficiencyFinding(state);
  const store = held(section);
  // The disclosures the reader opened stay open across a repaint of the same
  // reading, and are closed for a different one: a panel left open would caption
  // the evidence of a window that is no longer on screen.
  const sameReading = store.model?.statement === state.statement
    && store.model?.provenance.source === state.provenance.source;
  if (!sameReading) store.open.clear();
  store.model = state;

  const body = byId(doc, SPEND_PER_DELIVERY_BODY_ID);
  if (!body) return null;
  const children = [element(doc, "p", "spd-answer", state.statement)];
  if (state.state === SPEND_PER_DELIVERY_STATE.eligible) {
    children.push(figureBlock(doc, state));
    children.push(comparisonBlock(doc, state));
  } else {
    // No figure and no baseline. The unit is still named, because a reader has to
    // know which comparison is being withheld.
    children.push(element(doc, "p", "spd-withheld",
      `No figure is published for ${state.metric.unit} in this state.`));
  }
  children.push(findingBlock(doc, scored));
  const confidence = element(doc, "p", "spd-confidence");
  confidence.dataset.level = state.confidence.level;
  confidence.append(shape(doc, CONFIDENCE_SHAPE[state.confidence.level] ?? "○○○"));
  confidence.append(element(doc, "span", "spd-confidence-level",
    `Confidence: ${state.confidence.level}`));
  confidence.append(element(doc, "span", "spd-confidence-basis", state.confidence.basis));
  children.push(confidence);
  children.push(element(doc, "p", "spd-framing", state.framing.statement));
  children.push(actionBlock(doc, state));
  children.push(disclosureGroup(doc, state, scored, store));
  body.replaceChildren(...children);

  section.hidden = false;
  section.dataset.state = state.state;
  section.dataset.phase = SPEND_PER_DELIVERY_PHASE.ready;
  section.removeAttribute("aria-busy");
  section.dataset.origin = state.provenance.origin;
  section.dataset.classification = scored.classification;
  // The one state the issue behind this panel singles out: an analysis exists,
  // and nobody has recorded a release for it to be divided by. It is marked on
  // the section so the page can style and assert it without parsing a sentence.
  if (state.reasonCode === "no_delivery_evidence") section.dataset.deliveryEvidence = "missing";
  else delete section.dataset.deliveryEvidence;
  if (state.reasonCode) section.dataset.reason = state.reasonCode;
  else delete section.dataset.reason;
  announce(doc, `${state.statement} Next: ${state.nextAction.text}`);
  return state;
}

/** Hand the section back: every slot this module wrote is emptied. */
export function clearSpendPerDelivery(doc) {
  const section = byId(doc, SPEND_PER_DELIVERY_SECTION_ID);
  if (!section) return null;
  const store = held(section);
  store.model = null;
  store.open.clear();
  section.hidden = true;
  section.dataset.state = SPEND_PER_DELIVERY_STATE.absent;
  section.dataset.phase = SPEND_PER_DELIVERY_PHASE.ready;
  section.removeAttribute("aria-busy");
  delete section.dataset.origin;
  delete section.dataset.reason;
  delete section.dataset.classification;
  delete section.dataset.deliveryEvidence;
  byId(doc, SPEND_PER_DELIVERY_BODY_ID)?.replaceChildren();
  const live = byId(doc, SPEND_PER_DELIVERY_LIVE_ID);
  if (live) live.textContent = "";
  return null;
}
