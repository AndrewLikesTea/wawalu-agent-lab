// The department lead's workflow: one question, one number, one next action —
// and everything else behind a control the reader chooses to press.
//
// It paints `department-fix-pack.js`'s pack, which arrives on the evidence
// model as `fixPack`. IT DECIDES NOTHING. Every recommendation, dollar figure,
// confidence level and piece of evidence on this surface is read off that pack
// verbatim; the only things authored here are the question, the slot labels and
// the reading order. If a figure looks wrong the argument is with the model, and
// the provenance rows carry the versions that say which model produced it.
//
// WHY A HANDOUT ALLOW-LIST
// ------------------------
// Everything painted — screen and paper alike — is built from `fixPackHandout`,
// an explicit projection of the pack's known fields. A view that walked the pack
// freely would print whatever a future field happened to carry; this one cannot,
// because a field that is not named in the projection is never read. Prompt text
// therefore cannot reach the sheet even if a caller hangs it on the pack, and
// `tests/department-fix-pack-view.test.js` proves that by searching the
// serialized handout and the painted DOM for sentinel prompt markers.
//
// THE PRINTABLE HANDOUT
// ---------------------
// Same idiom as the executive briefing: a real `<button>` drawn from script, a
// described note, a `role="status"` line for the engine that cannot print, and
// `beforeprint`/`afterprint` for the reader who uses the browser's own command
// instead. Both routes expand the disclosures first, because a handout that
// drops its evidence is a handout nobody can check. Unlike the briefing, the
// disclosure panels here are built on expand rather than merely hidden, so the
// expansion is a repaint and not only a CSS rule — the print stylesheet opens
// what is there, and this code makes sure it is there.
//
// `createElement` and `textContent` only. No markup string, no innerHTML.

import { formatPercent, formatUsd } from "./evolution.js";
import { sanitizeDepartmentLabel } from "./department-intervention-scoring.js";

export const FIX_PACK_SECTION_ID = "department-fix-pack";
export const FIX_PACK_BODY_ID = "department-fix-pack-body";
export const FIX_PACK_LIVE_ID = "department-fix-pack-live";
export const FIX_PACK_EVIDENCE_TOGGLE_ID = "department-fix-pack-evidence-toggle";
export const FIX_PACK_EVIDENCE_PANEL_ID = "department-fix-pack-evidence-panel";
export const FIX_PACK_MORE_TOGGLE_ID = "department-fix-pack-more-toggle";
export const FIX_PACK_MORE_PANEL_ID = "department-fix-pack-more-panel";
export const FIX_PACK_PRINT_ID = "department-fix-pack-print";
export const FIX_PACK_PRINT_NOTE_ID = "department-fix-pack-print-note";
export const FIX_PACK_PRINT_STATUS_ID = "department-fix-pack-print-status";

/** The flag the print stylesheet keys on to isolate the handout on paper. */
export const PRINTING_FLAG = "departmentHandout";

export const PRINT_CONTROL_LABEL = "Print department handout";
export const PRINT_CONTROL_NOTE =
  "Opens your browser's print dialog with this department on one page. The sheet "
  + "carries aggregate pattern descriptors only — counts, shares and dollars — and "
  + "no prompt text.";
export const PRINT_UNAVAILABLE_MESSAGE =
  "This browser did not offer a print dialog. Use your browser's own print command; "
  + "the sheet is the same.";

/**
 * What the reader is here to settle. One question, and it names the department
 * so a printed sheet cannot be filed against the wrong one.
 */
export const leadQuestion = (department) =>
  `What should ${department} change first about its AI spend?`;

/** The kinds, in the words a lead uses rather than the model's enum keys. */
const KIND_WORD = Object.freeze({
  routing: "Gateway routing change",
  rewrite: "Prompt template",
  training: "Training programme",
});

/**
 * Why a pack carries no action, in a sentence. The code is always printed
 * beside the sentence: an unmapped code from a newer model must still read as
 * something rather than disappear into a default.
 */
const REASON_SENTENCE = Object.freeze({
  no_department_selected: "No department has been chosen yet.",
  department_not_graded:
    "This department is below the grading floor, so no action can be prioritized "
    + "from it. Import more of its prompts and it becomes gradeable.",
  signal_did_not_fire:
    "None of the three fix-pack signals fired for this department: there is no "
    + "over-provisioning, re-prompt or intent-framing pattern to act on.",
  insufficient_evidence:
    "The evidence behind this department is too thin to prioritize an action.",
});

/** Why one action carries no dollar figure. Model codes, in words. */
const UNPRICED_SENTENCE = Object.freeze({
  no_monthly_spend_basis: "no monthly spend basis was supplied for this department",
  no_routing_analysis: "no routing analysis was run for this department",
  routing_insufficient_data: "the routing rule had insufficient data",
  no_recoverable_spend: "no recoverable spend was found",
});

/** Each shell state gets its own word, its own shape and its own sentence. */
const SHELL = Object.freeze({
  loading: Object.freeze({
    word: "Reading", shape: "◔",
    title: "Working out what this department can act on",
    body: "The fix pack is still being built from the imported prompts.",
  }),
  unavailable: Object.freeze({
    word: "No department", shape: "◇",
    title: "No department is selected",
    body: "Choose a department to see the actions ranked for it.",
  }),
  withheld: Object.freeze({
    word: "Insufficient evidence", shape: "▨",
    title: "Not enough evidence to prioritize an action",
    body: "Nothing is recommended for this department, and nothing is guessed.",
  }),
  empty: Object.freeze({
    word: "No action applies", shape: "○",
    title: "No intervention applies to this department",
    body: "The pack was built and came back with nothing to do, which is a result.",
  }),
});

/** The pack states this surface knows how to draw. `ready` is the fifth. */
const KNOWN_STATES = new Set([...Object.keys(SHELL), "ready"]);

const NO_FIGURE = "No dollar figure";
const MAX_INTERVENTIONS = 3;
const MAX_EXCLUDED = 3;
const MAX_MODELS = 24;
const MAX_CONFIDENCE_REASONS = 12;
const MAX_PROVENANCE_KEYS = 16;
const SAFE_DESCRIPTOR = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/;

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A shape channel. Hidden from assistive tech: the word beside it is the fact. */
function shapeSpan(doc, glyph) {
  const shape = element(doc, "span", "evidence-shape", glyph);
  shape.setAttribute("aria-hidden", "true");
  return shape;
}

const chip = (doc, text) => element(doc, "span", "evidence-chip", text);

const countText = (value) =>
  (Number.isFinite(value) ? Math.round(value) : 0).toLocaleString("en-US");

/** A dollar figure, or the refusal. `null` is never formatted as `$0`. */
const money = (usd) => (Number.isFinite(usd) ? formatUsd(usd) : NO_FIGURE);

const share = (value) => (Number.isFinite(value) ? formatPercent(value) : "—");

/* ------------------------------ the allow-list ------------------------------ */

const list = (value) => (Array.isArray(value) ? value : []);
const limited = (value, maximum) => list(value).slice(0, maximum);
const safeDescriptors = (value, maximum) => Object.freeze(
  limited(value, maximum)
    .filter((entry) => typeof entry === "string" && SAFE_DESCRIPTOR.test(entry)),
);

function reasonRow(reason) {
  return Object.freeze({
    code: String(reason?.code ?? "unspecified"),
    detail: reason?.detail ?? null,
    effect: reason?.effect ?? null,
  });
}

function modelRow(row) {
  return Object.freeze({
    model: row?.model ?? null,
    tier: row?.tier ?? null,
    proposedTier: row?.proposedTier ?? null,
    recoverableUsd: Number.isFinite(row?.recoverableUsd) ? row.recoverableUsd : null,
  });
}

/**
 * One intervention, reduced to the fields this surface is allowed to show.
 *
 * Nothing is computed: every value is copied across. The projection exists so
 * that a field nobody here has read cannot be painted or printed.
 */
function interventionRow(intervention) {
  const signal = intervention?.signal ?? {};
  const savings = intervention?.savings ?? {};
  const confidence = intervention?.confidence ?? {};
  const provenance = intervention?.provenance ?? {};
  return Object.freeze({
    rank: intervention?.rank ?? null,
    actionId: intervention?.action?.id ?? intervention?.actionId ?? null,
    kind: intervention?.action?.kind ?? null,
    name: intervention?.action?.name ?? null,
    summary: intervention?.action?.summary ?? null,
    rationale: intervention?.rationale ?? null,
    monthlySavingsUsd: Number.isFinite(intervention?.monthlySavingsUsd)
      ? intervention.monthlySavingsUsd : null,
    savings: Object.freeze({
      basis: savings.basis ?? null,
      windowSavingsUsd: Number.isFinite(savings.windowSavingsUsd)
        ? savings.windowSavingsUsd : null,
      periodMonths: savings.periodMonths ?? null,
      unpricedReasonCode: savings.unpricedReasonCode ?? null,
      models: Object.freeze(limited(savings.models, MAX_MODELS).map(modelRow)),
    }),
    confidence: Object.freeze({
      level: confidence.level ?? null,
      reasons: Object.freeze(
        limited(confidence.reasons, MAX_CONFIDENCE_REASONS).map(reasonRow)),
      inheritedReasons: Object.freeze(
        limited(confidence.inheritedReasons, MAX_CONFIDENCE_REASONS).map(reasonRow)),
    }),
    signal: Object.freeze({
      key: signal.key ?? null,
      label: signal.label ?? null,
      axis: signal.axis ?? null,
      category: signal.category ?? null,
      numerator: Number.isFinite(signal.numerator) ? signal.numerator : null,
      denominator: Number.isFinite(signal.denominator) ? signal.denominator : null,
      share: Number.isFinite(signal.share) ? signal.share : null,
      recoverability: Number.isFinite(signal.recoverability) ? signal.recoverability : null,
      recoverablePromptPoints: Number.isFinite(signal.recoverablePromptPoints)
        ? signal.recoverablePromptPoints : null,
    }),
    provenance: Object.freeze({
      fixPackVersion: provenance.fixPackVersion ?? null,
      rubricVersion: provenance.rubricVersion ?? null,
      classifierVersion: provenance.classifierVersion ?? null,
      routingRuleVersion: provenance.routingRuleVersion ?? null,
      source: provenance.source ?? null,
      department: provenance.department ?? null,
      unitLabel: provenance.unitLabel ?? null,
      // Evidence is a list of aggregate provenance keys, never a free-text
      // channel. Reject anything that does not look like a version/key token.
      evidence: safeDescriptors(provenance.evidence, MAX_PROVENANCE_KEYS),
    }),
  });
}

/**
 * THE HANDOUT. The one page a lead takes into a meeting, and the only thing this
 * module ever paints.
 *
 * @param {object|null} pack a `departmentFixPack` result, or null.
 * @param {{status?: string}} [options] `status: "loading"` when the panel above
 *   is still filling and there is no pack to describe yet.
 * @returns a frozen projection: known fields only, copied verbatim.
 */
export function fixPackHandout(pack, { status = "ready" } = {}) {
  const usable = Boolean(pack) && typeof pack === "object";
  // An unknown state from a newer model reads as `unavailable` rather than as a
  // half-painted result: this surface would not know which of its states to draw.
  const state = status === "loading" ? "loading"
    : usable && KNOWN_STATES.has(pack.state) ? pack.state
      : "unavailable";
  const totals = (usable ? pack.totals : null) ?? {};
  const basis = (usable ? pack.basis : null) ?? {};
  // Only a ready pack has actions to read. A withheld, empty or unrecognised
  // state that still carried rows would paint a recommendation the model has
  // just refused to make.
  const interventions = state === "ready"
    ? limited(pack.interventions, MAX_INTERVENTIONS).map(interventionRow) : [];
  const department = (usable && typeof pack.department === "string" && pack.department)
    ? sanitizeDepartmentLabel(pack.department) : null;

  return Object.freeze({
    version: usable ? pack.version ?? null : null,
    state,
    reasonCode: usable ? pack.reasonCode ?? null : null,
    department,
    question: leadQuestion(department ?? "this department"),
    totals: Object.freeze({
      monthlySavingsUsd: Number.isFinite(totals.monthlySavingsUsd)
        ? totals.monthlySavingsUsd : null,
      pricedCount: Number.isFinite(totals.pricedCount) ? totals.pricedCount : 0,
      unpricedCount: Number.isFinite(totals.unpricedCount) ? totals.unpricedCount : 0,
      recoverablePromptPoints: Number.isFinite(totals.recoverablePromptPoints)
        ? totals.recoverablePromptPoints : null,
      unpricedReasonCodes: safeDescriptors(totals.unpricedReasonCodes, MAX_INTERVENTIONS),
      complete: totals.complete === true,
    }),
    lead: interventions[0] ?? null,
    others: Object.freeze(interventions.slice(1)),
    excluded: Object.freeze((usable ? limited(pack.excluded, MAX_EXCLUDED) : [])
      .map((row) => Object.freeze({
      actionId: row?.actionId ?? null,
      kind: row?.kind ?? null,
      name: row?.name ?? null,
      reasonCode: row?.reasonCode ?? null,
      }))),
    basis: Object.freeze({
      spendUsd: Number.isFinite(basis.spendUsd) ? basis.spendUsd : null,
      periodMonths: Number.isFinite(basis.periodMonths) ? basis.periodMonths : null,
      source: typeof basis.source === "string" ? basis.source : null,
    }),
    redaction: Object.freeze({
      // The privacy promise is authored by this view below. Copying a model
      // string here would turn that promise into a prompt-text side channel.
      droppedInputFields: safeDescriptors(
        usable ? pack.redaction?.droppedInputFields : [], MAX_PROVENANCE_KEYS),
    }),
  });
}

/**
 * The handout as one ordered sentence, for the live region and for a test that
 * would rather assert the reading order as a string than walk the DOM.
 */
export function fixPackWorkflowAnnouncement(handout) {
  if (handout.state !== "ready" || !handout.lead) {
    return `${handout.question} ${SHELL[handout.state]?.title ?? "No answer available"}.`;
  }
  const total = handout.totals.pricedCount > 0
    ? `${money(handout.totals.monthlySavingsUsd)} a month is prioritized for this department.`
    : "No dollar figure is claimed for this department.";
  const unpriced = handout.totals.complete ? ""
    : ` ${countText(handout.totals.unpricedCount)} further action`
      + `${handout.totals.unpricedCount === 1 ? " carries" : "s carry"} no dollar figure.`;
  return `${handout.question} ${total}${unpriced} Do this first: ${handout.lead.name}`
    + ` — ${money(handout.lead.monthlySavingsUsd)} a month, confidence `
    + `${handout.lead.confidence.level ?? "unstated"}.`;
}

/* --------------------------------- painting --------------------------------- */

function sectionState(section) {
  if (!section.__departmentFixPack) {
    section.__departmentFixPack = { handout: null, scope: null };
  }
  return section.__departmentFixPack;
}

function announce(doc, text) {
  const node = byId(doc, FIX_PACK_LIVE_ID);
  if (!node || node.textContent === text) return node;
  node.textContent = text;
  return node;
}

/**
 * Paint one department's fix pack into the shipped markup.
 *
 * @param {Document} doc the document holding `#department-fix-pack`.
 * @param {object|null} pack a `departmentFixPack` result, or null when there is
 *   none — a loading, empty or unreadable panel has no actions to describe.
 * @param {{status?: string, scope?: object}} [options] `scope` is the object
 *   carrying `print`, `addEventListener` — the window, in every real caller.
 * @returns the handout that was painted, so a caller can assert on what it asked
 *   for rather than on the DOM it got.
 */
export function applyDepartmentFixPack(doc, pack, { status = "ready", scope } = {}) {
  const section = byId(doc, FIX_PACK_SECTION_ID);
  if (!section) return null;
  const state = sectionState(section);
  state.handout = fixPackHandout(pack, { status });
  state.scope = scope ?? state.scope ?? doc?.defaultView ?? globalThis;
  if (section.dataset.evidenceExpanded !== "true") section.dataset.evidenceExpanded = "false";
  if (section.dataset.moreExpanded !== "true") section.dataset.moreExpanded = "false";
  paint(doc, section);
  // Once per section, never per repaint: the reader who prints with the
  // browser's own command gets the same expanded sheet as the button gives.
  if (!state.printingWired) {
    state.printingWired = true;
    state.unwirePrinting = wireFixPackPrinting(doc, { scope: state.scope });
  }
  return state.handout;
}

/** Hand the section back empty. Nothing this module wrote survives. */
export function clearDepartmentFixPack(doc) {
  const section = byId(doc, FIX_PACK_SECTION_ID);
  if (!section) return null;
  const state = sectionState(section);
  state.unwirePrinting?.();
  state.unwirePrinting = null;
  state.printingWired = false;
  state.handout = null;
  section.hidden = true;
  section.dataset.state = "unavailable";
  section.dataset.evidenceExpanded = "false";
  section.dataset.moreExpanded = "false";
  section.removeAttribute("aria-busy");
  byId(doc, FIX_PACK_BODY_ID)?.replaceChildren();
  const live = byId(doc, FIX_PACK_LIVE_ID);
  if (live) live.textContent = "";
  return null;
}

function paint(doc, section) {
  const state = sectionState(section);
  const handout = state.handout;
  const body = byId(doc, FIX_PACK_BODY_ID);
  if (!handout || !body) return;

  section.dataset.state = handout.state;
  section.setAttribute("aria-busy", handout.state === "loading" ? "true" : "false");
  // A reader with nothing selected meets no panel at all, exactly as the
  // evidence panel above it behaves. Every other state is worth a reading.
  section.hidden = handout.state === "unavailable" && !handout.department;

  if (handout.state !== "ready" || !handout.lead) {
    body.replaceChildren(shellBlock(doc, handout), redactionBlock(doc, handout));
  } else {
    body.replaceChildren(
      leadBlock(doc, handout),
      evidenceDisclosure(doc, section, handout),
      moreDisclosure(doc, section, handout),
      redactionBlock(doc, handout),
      printControl(doc, section, handout),
    );
  }
  announce(doc, fixPackWorkflowAnnouncement(handout));

  const focusId = section.dataset.focusTarget;
  if (focusId) {
    delete section.dataset.focusTarget;
    // Focus returns to the control the reader pressed, so opening or closing a
    // panel never drops a keyboard user at the top of the document.
    byId(doc, focusId)?.focus?.();
  }
}

/* ---------------------------- loading and refusals --------------------------- */

function shellBlock(doc, handout) {
  const shell = SHELL[handout.state] ?? SHELL.unavailable;
  const block = element(doc, "div", "fix-pack-shell");
  block.dataset.state = handout.state;

  const status = element(doc, "p", "fix-pack-shell-status");
  status.append(shapeSpan(doc, shell.shape),
    element(doc, "span", "fix-pack-shell-word", shell.word));

  block.append(
    status,
    element(doc, "h3", "fix-pack-question", handout.question),
    element(doc, "p", "fix-pack-shell-title", shell.title),
    element(doc, "p", "fix-pack-shell-body", shell.body),
  );

  // The model's own reason, always with its code beside it: an unmapped code
  // from a newer model has to read as something rather than vanish.
  if (handout.reasonCode) {
    const reason = element(doc, "p", "fix-pack-reason");
    reason.append(
      element(doc, "span", "fix-pack-reason-text",
        REASON_SENTENCE[handout.reasonCode] ?? "The model declined to prioritize an action."),
      chip(doc, handout.reasonCode),
    );
    block.append(reason);
  }
  // The actions are still named when they are refused. A reader told "nothing
  // applies" and not told what was considered has been given a shrug.
  if (handout.excluded.length) {
    const considered = element(doc, "section", "fix-pack-excluded");
    considered.append(element(doc, "h4", "eyebrow", "Considered and not offered"));
    const items = element(doc, "ul", "fix-pack-excluded-list");
    for (const row of handout.excluded) items.append(excludedItem(doc, row));
    considered.append(items);
    block.append(considered);
  }
  return block;
}

function excludedItem(doc, row) {
  const item = element(doc, "li", "fix-pack-excluded-row");
  item.append(
    element(doc, "span", "fix-pack-excluded-name", row.name ?? row.actionId ?? "Unnamed action"),
    chip(doc, KIND_WORD[row.kind] ?? row.kind ?? "unclassified"),
    element(doc, "span", "fix-pack-excluded-reason",
      REASON_SENTENCE[row.reasonCode] ?? "Not offered for this department."),
    chip(doc, row.reasonCode ?? "unstated"),
  );
  return item;
}

/* ------------------------------- the decision -------------------------------- */
//
// DOM order is the reading order and the announcement order: the question, the
// money, then the one action. Nothing here is placed by CSS order, so what a
// screen reader hears and what an eye reads cannot drift apart.

function leadBlock(doc, handout) {
  const block = element(doc, "div", "fix-pack-lead");
  const lead = handout.lead;

  block.append(element(doc, "h3", "fix-pack-question", handout.question));

  const metric = element(doc, "div", "fix-pack-metric");
  metric.dataset.available = String(handout.totals.pricedCount > 0);
  const figure = element(doc, "p", "fix-pack-metric-figure",
    handout.totals.pricedCount > 0 ? money(handout.totals.monthlySavingsUsd) : NO_FIGURE);
  // The numeral is decorative in the accessibility tree: the line under it says
  // the same thing in words, and a screen reader that read both would say it twice.
  figure.setAttribute("aria-hidden", "true");
  metric.append(
    figure,
    element(doc, "p", "fix-pack-metric-label", handout.totals.pricedCount > 0
      ? `${money(handout.totals.monthlySavingsUsd)} a month across `
        + `${countText(handout.totals.pricedCount)} priced action`
        + `${handout.totals.pricedCount === 1 ? "" : "s"}`
      : "No dollar figure is claimed for this department"),
  );
  if (!handout.totals.complete) {
    const caveat = element(doc, "p", "fix-pack-metric-caveat");
    caveat.append(element(doc, "span", "fix-pack-metric-caveat-text",
      `${countText(handout.totals.unpricedCount)} action`
      + `${handout.totals.unpricedCount === 1 ? " is" : "s are"} not in this total because `
      + `${handout.totals.unpricedReasonCodes
        .map((code) => UNPRICED_SENTENCE[code] ?? code).join("; ")}.`));
    metric.append(caveat);
  }
  block.append(metric);

  const action = element(doc, "div", "fix-pack-action");
  action.dataset.rank = String(lead.rank ?? 1);
  action.dataset.priced = String(lead.monthlySavingsUsd !== null);
  const heading = element(doc, "h4", "fix-pack-action-name");
  heading.append(shapeSpan(doc, "▶"), element(doc, "span", "fix-pack-action-words", lead.name));
  action.append(
    element(doc, "p", "eyebrow", "Do this first"),
    heading,
    chip(doc, KIND_WORD[lead.kind] ?? lead.kind ?? "unclassified"),
    element(doc, "p", "fix-pack-action-summary", lead.summary ?? ""),
    element(doc, "p", "fix-pack-action-value", lead.monthlySavingsUsd === null
      ? "No dollar figure — ranked on recoverable prompt-points alone."
      : `${money(lead.monthlySavingsUsd)} a month`),
    confidenceLine(doc, lead),
  );
  block.append(action);
  return block;
}

/**
 * The confidence field, naming the factor that capped it.
 *
 * A bare "Medium" is the kind of number a lead cannot argue with and therefore
 * does not believe. The count of reasons is printed beside the level and the
 * reasons themselves are one control away, so "what would make this high?" has
 * an answer without the answer crowding the decision.
 */
function confidenceLine(doc, intervention) {
  const { level, reasons } = intervention.confidence;
  const line = element(doc, "p", "confidence-chip fix-pack-confidence");
  line.dataset.level = String(level ?? "unstated").toLowerCase();
  line.append(
    element(doc, "span", "confidence-chip-label", `Confidence ${level ?? "unstated"}`),
    element(doc, "span", "fix-pack-confidence-detail", reasons.length
      ? `${countText(reasons.length)} factor${reasons.length === 1 ? "" : "s"} lowered it — see the pattern evidence`
      : "Nothing lowered it"),
  );
  return line;
}

/* --------------------------- progressive disclosure -------------------------- */
//
// Real buttons, not `<details>`: each says what it expands, owns its region by
// id, reports its own state, starts closed, and takes focus back after the
// repaint. A control that opens onto nothing is a control that lies, so where
// there is nothing behind one, a sentence is drawn instead of a button.

function disclosure(doc, section, { flag, toggleId, panelId, label, ariaLabel, children }) {
  const expanded = section.dataset[flag] === "true";
  const wrap = element(doc, "div", "evidence-disclosure-block fix-pack-disclosure");
  const toggle = element(doc, "button", "evidence-disclosure-toggle");
  toggle.id = toggleId;
  toggle.setAttribute("type", "button");
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggle.setAttribute("aria-controls", panelId);
  toggle.textContent = `${expanded ? "Hide" : "Show"} ${label}`;
  toggle.addEventListener("click", () => {
    section.dataset[flag] = expanded ? "false" : "true";
    section.dataset.focusTarget = toggleId;
    paint(doc, section);
  });

  const panel = element(doc, "div", "evidence-disclosure-panel fix-pack-panel");
  panel.id = panelId;
  panel.hidden = !expanded;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", ariaLabel);
  if (expanded) panel.append(...children());
  wrap.append(toggle, panel);
  return wrap;
}

function evidenceDisclosure(doc, section, handout) {
  return disclosure(doc, section, {
    flag: "evidenceExpanded",
    toggleId: FIX_PACK_EVIDENCE_TOGGLE_ID,
    panelId: FIX_PACK_EVIDENCE_PANEL_ID,
    label: "the pattern behind this action",
    ariaLabel: `Pattern evidence behind ${handout.lead.name}`,
    children: () => [
      patternBlock(doc, handout.lead),
      savingsBlock(doc, handout),
      confidenceBlock(doc, handout.lead),
      provenanceBlock(doc, handout),
    ],
  });
}

function moreDisclosure(doc, section, handout) {
  const count = handout.others.length + handout.excluded.length;
  if (!count) {
    return element(doc, "p", "evidence-note fix-pack-note",
      "No other intervention was ranked or refused for this department.");
  }
  return disclosure(doc, section, {
    flag: "moreExpanded",
    toggleId: FIX_PACK_MORE_TOGGLE_ID,
    panelId: FIX_PACK_MORE_PANEL_ID,
    label: `${countText(count)} other intervention${count === 1 ? "" : "s"}`,
    ariaLabel: "Other interventions for this department",
    children: () => {
      const blocks = [];
      if (handout.others.length) {
        const ranked = element(doc, "section", "fix-pack-others");
        ranked.append(element(doc, "h4", "eyebrow", "Also ranked"));
        const items = element(doc, "ol", "fix-pack-other-list");
        for (const row of handout.others) items.append(otherItem(doc, row));
        ranked.append(items);
        blocks.push(ranked);
      }
      if (handout.excluded.length) {
        const refused = element(doc, "section", "fix-pack-excluded");
        refused.append(element(doc, "h4", "eyebrow", "Considered and not offered"));
        const items = element(doc, "ul", "fix-pack-excluded-list");
        for (const row of handout.excluded) items.append(excludedItem(doc, row));
        refused.append(items);
        blocks.push(refused);
      }
      return blocks;
    },
  });
}

function otherItem(doc, row) {
  const item = element(doc, "li", "fix-pack-other");
  item.dataset.rank = String(row.rank ?? "");
  item.dataset.priced = String(row.monthlySavingsUsd !== null);
  item.append(
    element(doc, "span", "fix-pack-other-rank", `Rank ${countText(row.rank)}`),
    element(doc, "span", "fix-pack-other-name", row.name ?? row.actionId ?? "Unnamed action"),
    chip(doc, KIND_WORD[row.kind] ?? row.kind ?? "unclassified"),
    element(doc, "span", "fix-pack-other-value", row.monthlySavingsUsd === null
      ? `${NO_FIGURE} — ${UNPRICED_SENTENCE[row.savings.unpricedReasonCode]
        ?? row.savings.unpricedReasonCode ?? "unstated"}`
      : `${money(row.monthlySavingsUsd)} a month`),
    element(doc, "span", "fix-pack-other-confidence",
      `Confidence ${row.confidence.level ?? "unstated"}`),
    element(doc, "span", "fix-pack-other-pattern", patternSentence(row)),
  );
  return item;
}

/** The pattern in one line: counts and shares, which is all this surface holds. */
function patternSentence(row) {
  const signal = row.signal;
  return `${countText(signal.numerator)} of ${countText(signal.denominator)} classified `
    + `prompts (${share(signal.share)}) fired ${signal.label ?? signal.key ?? "this signal"}`;
}

function definitionList(doc, className, rows) {
  const list_ = element(doc, "dl", className);
  for (const [term, value] of rows) {
    list_.append(element(doc, "dt", undefined, term), element(doc, "dd", undefined, value));
  }
  return list_;
}

function patternBlock(doc, lead) {
  const signal = lead.signal;
  const block = element(doc, "section", "fix-pack-pattern");
  block.append(element(doc, "h4", "eyebrow", "The pattern"));
  block.append(definitionList(doc, "fix-pack-detail-list", [
    ["Signal", signal.label ?? signal.key ?? "unnamed"],
    ["Prompt category", signal.category ?? "unclassified"],
    ["Rubric axis", signal.axis ?? "unstated"],
    ["Prompts in the pattern", `${countText(signal.numerator)} of ${countText(signal.denominator)} classified`],
    ["Share of classified prompts", share(signal.share)],
    ["Share a programme can move", share(signal.recoverability)],
    ["Recoverable prompt-points", signal.recoverablePromptPoints === null
      ? "unmeasured" : String(signal.recoverablePromptPoints)],
  ]));
  block.append(element(doc, "p", "fix-pack-rationale", lead.rationale ?? ""));
  return block;
}

function savingsBlock(doc, handout) {
  const lead = handout.lead;
  const rows = [
    ["Savings basis", lead.savings.basis ?? "unstated"],
    ["Monthly value", money(lead.monthlySavingsUsd)],
    ["Value over the window", money(lead.savings.windowSavingsUsd)],
    ["Window", lead.savings.periodMonths === null ? "unstated"
      : `${countText(lead.savings.periodMonths)} month${lead.savings.periodMonths === 1 ? "" : "s"}`],
    ["Spend basis", handout.basis.spendUsd === null
      ? (handout.basis.source ?? "none supplied")
      : `${money(handout.basis.spendUsd)} · ${handout.basis.source ?? "source unstated"}`],
  ];
  if (lead.savings.unpricedReasonCode) {
    rows.push(["Why there is no figure",
      UNPRICED_SENTENCE[lead.savings.unpricedReasonCode] ?? lead.savings.unpricedReasonCode]);
  }
  const block = element(doc, "section", "fix-pack-savings");
  block.append(element(doc, "h4", "eyebrow", "Where the money comes from"),
    definitionList(doc, "fix-pack-detail-list", rows));
  if (lead.savings.models.length) {
    const models = element(doc, "ul", "fix-pack-model-list");
    for (const row of lead.savings.models) {
      const item = element(doc, "li", "fix-pack-model");
      item.append(
        chip(doc, row.model ?? "unrecognized"),
        element(doc, "span", "fix-pack-model-move",
          `${row.tier ?? "unstated"} → ${row.proposedTier ?? "unstated"}`),
        element(doc, "span", "fix-pack-model-value", money(row.recoverableUsd)),
      );
      models.append(item);
    }
    block.append(models);
  }
  return block;
}

function confidenceBlock(doc, lead) {
  const block = element(doc, "section", "fix-pack-confidence-detail-block");
  block.append(element(doc, "h4", "eyebrow",
    `Confidence ${lead.confidence.level ?? "unstated"} · what lowered it`));
  const reasons = [
    ...lead.confidence.reasons.map((reason) => ({ ...reason, inherited: false })),
    ...lead.confidence.inheritedReasons.map((reason) => ({ ...reason, inherited: true })),
  ];
  if (!reasons.length) {
    block.append(element(doc, "p", "evidence-note",
      "Nothing lowered this action's confidence."));
    return block;
  }
  const items = element(doc, "ul", "fix-pack-confidence-list");
  for (const reason of reasons) {
    const item = element(doc, "li", "fix-pack-confidence-reason");
    item.dataset.inherited = String(reason.inherited);
    item.append(
      chip(doc, reason.code),
      element(doc, "span", "fix-pack-confidence-reason-text",
        reason.detail ?? "No detail was published for this factor."),
      element(doc, "span", "fix-pack-confidence-reason-effect",
        reason.inherited ? "inherited from the routing rule" : (reason.effect ?? "lowered one tier")),
    );
    items.append(item);
  }
  block.append(items);
  return block;
}

function provenanceBlock(doc, handout) {
  const provenance = handout.lead.provenance;
  const block = element(doc, "section", "fix-pack-provenance");
  block.append(element(doc, "h4", "eyebrow", "Provenance"));
  block.append(definitionList(doc, "fix-pack-detail-list", [
    ["Department", handout.department ?? "withheld"],
    ["Fix pack", provenance.fixPackVersion ?? handout.version ?? "unstated"],
    ["Rubric", provenance.rubricVersion ?? "unstated"],
    ["Classifier", provenance.classifierVersion ?? "unstated"],
    ["Routing rule", provenance.routingRuleVersion ?? "not run"],
    ["Org unit", provenance.unitLabel ?? "not named"],
    ["Source", provenance.source ?? "unstated"],
  ]));
  if (provenance.evidence.length) {
    const keys = element(doc, "p", "fix-pack-evidence-keys");
    for (const entry of provenance.evidence) keys.append(chip(doc, entry));
    block.append(keys);
  }
  if (handout.redaction.droppedInputFields.length) {
    block.append(element(doc, "p", "evidence-note",
      `Dropped unread from the inputs: ${handout.redaction.droppedInputFields.join(", ")}.`));
  }
  return block;
}

/* ---------------------------------- promise --------------------------------- */

function redactionBlock(doc, handout) {
  const block = element(doc, "p", "evidence-privacy fix-pack-privacy");
  block.append(
    shapeSpan(doc, "▨"),
    element(doc, "strong", "evidence-privacy-label", "Prompt text withheld"),
    element(doc, "span", "evidence-privacy-copy",
      "This surface publishes counts, shares and dollars. No prompt text reaches it."),
  );
  return block;
}

/* ------------------------------- the handout -------------------------------- */

/**
 * A real `<button>`, in the tab order, labelled with what it does — and drawn
 * from script, because a print control on a page whose script never ran is a
 * control that does nothing when pressed.
 */
function printControl(doc, section, handout) {
  const wrapper = element(doc, "div", "fix-pack-print-control");
  const button = element(doc, "button", "fix-pack-print-button", PRINT_CONTROL_LABEL);
  button.id = FIX_PACK_PRINT_ID;
  button.setAttribute("type", "button");
  button.setAttribute("aria-describedby", FIX_PACK_PRINT_NOTE_ID);
  const note = element(doc, "p", "fix-pack-print-note", PRINT_CONTROL_NOTE);
  note.id = FIX_PACK_PRINT_NOTE_ID;
  const status = element(doc, "p", "fix-pack-print-status");
  status.id = FIX_PACK_PRINT_STATUS_ID;
  status.setAttribute("role", "status");

  button.addEventListener("click", () => {
    const scope = sectionState(section).scope ?? globalThis;
    const restore = expandForPrint(doc, section);
    const printable = typeof scope.print === "function";
    try {
      if (printable) scope.print();
    } finally {
      restore();
      // Written after the restore, because restoring repaints the section and a
      // message set on the node that was replaced is a message nobody reads.
      if (!printable) {
        const status = byId(doc, FIX_PACK_PRINT_STATUS_ID);
        if (status) status.textContent = PRINT_UNAVAILABLE_MESSAGE;
      }
    }
  });

  wrapper.append(button, note, status);
  // The handout is the section, so the printed sheet and the screen can never
  // describe two different departments. Naming the department on the control
  // keeps that true for a reader who prints from the keyboard.
  wrapper.dataset.department = handout.department ?? "withheld";
  return wrapper;
}

/**
 * Open every disclosure, isolate the section for paper, and hand back the undo.
 *
 * Idempotent in both directions: a level the reader opened stays open
 * afterwards, because the previous flags are what gets restored.
 */
export function expandForPrint(doc, section) {
  const previous = {
    evidence: section.dataset.evidenceExpanded,
    more: section.dataset.moreExpanded,
  };
  section.dataset.evidenceExpanded = "true";
  section.dataset.moreExpanded = "true";
  if (doc?.documentElement) doc.documentElement.dataset[PRINTING_FLAG] = "printing";
  paint(doc, section);
  return () => {
    section.dataset.evidenceExpanded = previous.evidence ?? "false";
    section.dataset.moreExpanded = previous.more ?? "false";
    if (doc?.documentElement) delete doc.documentElement.dataset[PRINTING_FLAG];
    // Focus goes back to the control that was pressed rather than to the top of
    // the document, on the print route as on every other repaint.
    section.dataset.focusTarget = FIX_PACK_PRINT_ID;
    paint(doc, section);
  };
}

/**
 * The keyboard route that does not depend on the button at all: the browser's
 * own print command still gets the whole handout.
 *
 * @returns an unsubscribe function.
 */
export function wireFixPackPrinting(doc, { scope = globalThis } = {}) {
  const section = byId(doc, FIX_PACK_SECTION_ID);
  if (!section || typeof scope?.addEventListener !== "function") return () => {};
  let restore = null;
  const before = () => {
    if (sectionState(section).handout?.state !== "ready") return;
    restore = expandForPrint(doc, section);
  };
  const after = () => {
    restore?.();
    restore = null;
  };
  scope.addEventListener("beforeprint", before);
  scope.addEventListener("afterprint", after);
  return () => {
    scope.removeEventListener?.("beforeprint", before);
    scope.removeEventListener?.("afterprint", after);
  };
}
