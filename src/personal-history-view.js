// The personal AI-history workflow, drawn.
//
// It renders the report `personal-history-report.js` builds and decides nothing:
// every figure, threshold, sentence, and refusal arrives on the model or on the
// contract module, so a reader disputing a number reads one document rather than
// a branch in here. `createElement` and `textContent` only — never a markup
// string, and never an assignment of HTML into the document.
//
// READING ORDER IS THE DESIGN
// ---------------------------
// A reader reads five things, in this order, and can stop after any of them:
//
//   1. the question this page answers, and the move that answers it;
//   2. the one material figure — what that move is worth across their history,
//      and how much of their history it reaches;
//   3. how far to trust it — the named confidence level and its arithmetic;
//   4. where it came from — the shape read, the coverage, and the boundary;
//   5. the one thing to do next, written as a ready-to-edit rewrite.
//
// Everything that supports the claim rather than making it — the coverage
// breakdown, the runner-up it beat, the ranking rule, and the list of things
// this workflow never reads — sits behind two labelled disclosures.
//
// ONE FIGURE, NOT A DASHBOARD. The report carries a dozen honest numbers and
// exactly one of them changes what a reader does on Monday. The rest are
// evidence for it, so they are drawn as evidence: below it, behind a control,
// and never as a second headline competing with the first.
//
// NEVER A COMPARISON. `PERSONAL_BASIS` says this is a reading of one person at a
// population of one. Nothing here prints a percentile, a peer, a cohort, a team,
// or an average, and the refusal sentence is drawn beside the figure rather than
// left in a contract nobody opens.
//
// DISCLOSURES ARE BUTTONS, NOT <details>. Same reason the executive briefing
// gives: a `hidden` panel behind a button is hidden by an ordinary UA rule, so
// the state is legible to assistive technology through `aria-expanded` and the
// panel is reachable in the tab order only when it is open.
//
// NO PROMPT TEXT REACHES THIS MODULE. There is none in a report to render: the
// contract's field list is closed and `FORBIDDEN_REPORT_KEYS` refuses the field
// names that would carry one. This layer additionally never echoes a file name,
// so a screen share of a result says nothing about the file behind it.

import {
  PERSONAL_BASIS, PERSONAL_BOUNDARY, PERSONAL_ELIGIBILITY, PERSONAL_EXPORT_SHAPES,
  PERSONAL_HISTORY_EXCLUSIONS, PERSONAL_HISTORY_QUESTION, PERSONAL_METRIC_DEFINITIONS,
  PERSONAL_RANKING_RULE, PERSONAL_READER_LIMITS, PERSONAL_REPORT_STATE, PERSONAL_REQUIRED_FIELDS,
} from "/personal-history-contract.js";
import {
  PERSONAL_FILE_KINDS, PERSONAL_RUN_KIND, personalStageProgress,
} from "/personal-history-entry.js";
// The comparison is read into a finding — is the habit actually moving? — before
// it is drawn, because a signed number is not a trajectory. The rule that
// decides which of the six findings applies lives in the model module; this
// layer draws whichever one comes back.
import { buildTrajectory } from "/personal-history-trajectory.js";
import { renderHandoff, renderTrajectory } from "/personal-history-trajectory-view.js";

/* -------------------------------- helpers -------------------------------- */

const COUNT = new Intl.NumberFormat("en-US");

const count = (value) => (Number.isFinite(value) ? COUNT.format(value) : "—");
/** A raw ratio as a whole-number percentage. Null reads as an absent denominator. */
const percent = (ratio) => (Number.isFinite(ratio) ? `${Math.round(ratio * 100)}%` : "not measurable");
const plural = (value, one, many) => `${count(value)} ${value === 1 ? one : many}`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function line(parent, className, ...parts) {
  const node = el("p", className);
  for (const part of parts) node.append(typeof part === "string" ? document.createTextNode(part) : part);
  parent.append(node);
  return node;
}

const shapeLabel = (id) => PERSONAL_EXPORT_SHAPES.find((shape) => shape.id === id)?.label ?? "an unrecognized shape";

/* ---------------------------- the standing copy ---------------------------- */

export const BOUNDARY_CONTAINER_ID = "personal-history-boundary";
export const ELIGIBILITY_CONTAINER_ID = "personal-history-eligibility";
export const STATUS_ID = "personal-history-status";
export const RESULT_ID = "personal-history-result";

/**
 * What this workflow does and does not do with a file, painted *before* anybody
 * chooses one.
 *
 * Drawn from `PERSONAL_BOUNDARY` and `PERSONAL_HISTORY_EXCLUSIONS` rather than
 * authored here, so the promise on the page and the promise the tests assert
 * mechanically are the same sentences. The markup carries a shorter static
 * version of the same claim, because a reader deciding whether to hand over
 * their history cannot rely on a promise that only appears once a script runs.
 */
export function renderBoundaryGuidance() {
  const section = el("div", "ph-boundary-body");

  const summary = el("ul", "ph-boundary-list");
  for (const [field, value] of Object.entries(PERSONAL_BOUNDARY)) {
    const item = el("li");
    item.append(el("span", "ph-boundary-field", BOUNDARY_LABEL[field] ?? field));
    item.append(el("span", "ph-boundary-value", String(value)));
    summary.append(item);
  }
  section.append(summary);

  const exclusions = el("dl", "ph-exclusions");
  for (const exclusion of PERSONAL_HISTORY_EXCLUSIONS) {
    const term = el("dt", "ph-exclusion-term", exclusion.label);
    term.dataset.exclusion = exclusion.id;
    exclusions.append(term, el("dd", "ph-exclusion-claim", exclusion.claim));
  }
  section.append(exclusions);
  return section;
}

/** The boundary fields, in a reader's words rather than the contract's key names. */
const BOUNDARY_LABEL = Object.freeze({
  readIn: "Read in",
  analysisCode: "Analysed by",
  sentForAnalysis: "Sent anywhere for analysis",
  uploaded: "Uploaded",
  persisted: "Stored or persisted",
  retainsPromptText: "Keeps your prompt text",
  attachmentsRead: "Opens your attachments",
  providerAccountsConnected: "Accounts connected",
  integrationsContacted: "Integrations contacted",
});

/**
 * Which files this reader accepts and what it needs to find in them, before a
 * reader spends five minutes exporting the wrong thing.
 *
 * Every shape, field, floor, and ceiling is the contract's own, so a file that
 * matches this list is a file the reader will recognize.
 */
export function renderEligibilityGuide() {
  const section = el("div", "ph-eligibility-body");

  const shapes = el("ul", "ph-shapes");
  for (const shape of PERSONAL_EXPORT_SHAPES) {
    const kind = PERSONAL_FILE_KINDS.find((entry) => entry.id === shape.id);
    const item = el("li", "ph-shape");
    item.dataset.shape = shape.id;
    item.append(el("h3", "ph-shape-label", shape.label));
    item.append(el("p", "ph-shape-extensions", `Usually ends in ${kind?.extensions.join(", ") ?? "a text extension"}`));
    item.append(el("p", "ph-shape-detect", shape.detect));
    shapes.append(item);
  }
  section.append(shapes);

  const fields = el("ul", "ph-required-fields");
  for (const field of PERSONAL_REQUIRED_FIELDS) {
    const item = el("li");
    item.append(el("span", "ph-field-name", field.field));
    item.append(el("span", "ph-field-why", field.why));
    fields.append(item);
  }
  section.append(el("h3", "ph-eligibility-subhead", "Both of these have to be in the file"));
  section.append(fields);

  const floors = el("ul", "ph-floors");
  floors.append(el("li", null, `At least ${PERSONAL_ELIGIBILITY.minScoredPrompts} of your prompts have to `
    + "score. Below that floor one message is more than a twentieth of the evidence."));
  floors.append(el("li", null, `Those prompts have to fall on at least ${PERSONAL_ELIGIBILITY.minDistinctDays} `
    + "distinct days. Fewer than that is a session, not a habit."));
  floors.append(el("li", null, `The reading grades at most ${count(PERSONAL_READER_LIMITS.maxPromptEntries)} `
    + "prompts, because the whole of it happens in this tab. A longer history is not refused and "
    + "not cut short at the beginning: every nth prompt is read, evenly across the whole export, "
    + "and the report says so."));
  section.append(el("h3", "ph-eligibility-subhead", "And it has to clear these floors"));
  section.append(floors);
  return section;
}

/* --------------------------------- states --------------------------------- */

const KIND_EYEBROW = Object.freeze({
  [PERSONAL_RUN_KIND.file]: "Your own export · read in this tab",
  [PERSONAL_RUN_KIND.preview]: "Worked example · an invented history, not yours",
});

/**
 * What the workflow is doing right now, as three named stages rather than a
 * spinner. `aria-busy` and the live region are the caller's; this is the panel.
 */
export function renderProgress({ kind = PERSONAL_RUN_KIND.file, stage = "read" } = {}) {
  const panel = el("section", "ph-state ph-progress");
  panel.dataset.state = "processing";
  panel.dataset.stage = stage;
  panel.dataset.kind = kind;

  const stages = personalStageProgress(stage);
  const current = stages.find((entry) => entry.state === "current") ?? stages[0];
  panel.append(el("h3", "ph-state-title", kind === PERSONAL_RUN_KIND.preview
    ? "Building the worked example in this tab…"
    : "Reading your export in this tab…"));
  line(panel, "ph-progress-current", `Step ${current.position} of ${stages.length}: ${current.label}. ${current.detail}`);

  const list = el("ol", "ph-progress-stages");
  for (const entry of stages) {
    const item = el("li", "ph-progress-stage");
    item.dataset.stageState = entry.state;
    if (entry.state === "current") item.setAttribute("aria-current", "step");
    item.append(el("span", "ph-progress-mark", entry.shape));
    item.append(el("span", "ph-progress-label", entry.label));
    item.append(el("span", "ph-progress-status", entry.status));
    list.append(item);
  }
  panel.append(list);
  return panel;
}

/**
 * A refusal a reader can recover from: what happened, what it means, and the one
 * thing to do about it. `role="alert"` because it interrupts a workflow the
 * reader started — and it always restates that nothing left the tab, because
 * "something went wrong" is exactly when a person wonders what was sent.
 */
export function renderEntryError({ code = null, summary, detail, remedy } = {}) {
  const panel = el("section", "ph-state ph-error");
  panel.dataset.state = "error";
  if (code) panel.dataset.code = code;
  panel.setAttribute("role", "alert");

  const heading = el("h3", "ph-state-title");
  heading.append(el("span", "ph-state-label", "Not read: "));
  heading.append(document.createTextNode(summary ?? "This file could not be read"));
  panel.append(heading);
  line(panel, "ph-error-detail", detail ?? "The file was not opened.");
  line(panel, "ph-error-remedy", remedy ?? "Choose a file again. Nothing was uploaded and nothing was kept.");
  line(panel, "ph-error-boundary", "Nothing was uploaded, nothing was stored, and no account was "
    + "connected — a refusal reaches the network no more than a reading does.");
  return panel;
}

/** The empty page a reader is returned to by Clear. Never a stale figure under a new heading. */
export function renderIdle() {
  const panel = el("section", "ph-state ph-idle");
  panel.dataset.state = "idle";
  panel.append(el("h3", "ph-state-title", "Nothing has been read"));
  line(panel, null, "Choose your own export, or build the worked example, and the result appears here. "
    + "Whatever was read before is gone from this tab.");
  return panel;
}

/* ------------------------------- the report ------------------------------- */

const metricDefinition = (name) =>
  PERSONAL_METRIC_DEFINITIONS.find((entry) => entry.metric === name)?.definition ?? "";

/** The one figure. Everything else on the page is evidence for this number. */
function leadSection(report) {
  const { priority, coverage } = report;
  const section = el("section", "ph-lead");
  const heading = el("h4", "ph-section-title ph-lead-heading", "The one move");
  heading.id = "ph-lead-title";
  section.setAttribute("aria-labelledby", heading.id);
  section.append(heading);

  section.append(el("p", "ph-lead-move", priority.title));

  const figure = el("p", "ph-figure");
  figure.append(el("span", "ph-figure-value", String(priority.points)));
  figure.append(el("span", "ph-figure-unit", "composite points"));
  section.append(figure);
  line(section, "ph-figure-caption", metricDefinition("priority_points(move)"));

  line(section, "ph-lead-reach",
    `Available in ${plural(priority.promptsAffected, "prompt", "prompts")} of the `
    + `${count(coverage.scoredPrompts)} this reader scored — ${percent(priority.promptShare)} of them.`);
  const evidence = line(section, "ph-lead-evidence", priority.evidence === "measured"
    ? "Measured: the rubric took points off for this in the prompts above. It is something you did."
    : "Projected: the rubric found points this move could still earn. It is something you could add.");
  evidence.dataset.evidence = priority.evidence;

  // The refusal beside the figure, not in a footnote: a number about one person
  // read as a standard is a number about people who were never measured.
  line(section, "ph-lead-refusal", PERSONAL_BASIS.refusal);
  return section;
}

/** How far to trust the move above, in the level word and the arithmetic behind it. */
function confidenceSection(report) {
  const { confidence } = report;
  const section = el("section", "ph-confidence");
  section.dataset.confidence = confidence.level;
  section.append(el("h4", "ph-section-title", "How far to trust it"));
  line(section, "ph-confidence-level", confidence.label);
  line(section, "ph-confidence-rule", confidence.rule);
  if (confidence.basis) {
    line(section, "ph-confidence-arithmetic", confidence.basis.arithmetic);
    if (confidence.basis.downgradedForCoverage) {
      line(section, "ph-confidence-downgrade",
        `Lowered one level: this reader could score ${percent(confidence.basis.coverage)} of your prompt `
        + `entries, under the ${percent(confidence.basis.coverageFloor)} floor. The prompts that scored `
        + "were scored correctly; what is unknown is whether the rest hold a different leading move.");
    }
  }
  return section;
}

/** Where the figure came from, in the reader's own file's terms. */
function provenanceSection(report, { kind }) {
  const section = el("section", "ph-provenance");
  section.append(el("h4", "ph-section-title", "Where this came from"));
  line(section, "ph-provenance-source", kind === PERSONAL_RUN_KIND.preview
    ? "The bundled worked example: an invented person's history, shipped with this page and read by "
      + "exactly the same code your own file would be. No real export, account, or customer data is in it."
    : "The file you chose, read in this tab and gone from memory when you leave the page.");
  line(section, "ph-provenance-shape", `Read as: ${shapeLabel(report.shape)}.`);
  line(section, "ph-provenance-coverage",
    `${count(report.coverage.scoredPrompts)} of ${count(report.coverage.promptEntries)} prompt entries `
    + `scored (${percent(report.coverage.ratio)}), across `
    + `${plural(report.coverage.distinctDays, "day", "days")}.`);
  // Stated beside the coverage figure rather than under a disclosure, because a
  // ratio over a sample and a ratio over a whole export read identically and
  // mean different things.
  if (report.scope.sampled) {
    line(section, "ph-provenance-scope",
      `Sampled: your export carried ${count(report.scope.promptEntriesAvailable)} prompt entries, `
      + `over the ${count(report.scope.ceiling)} this tab grades, so every `
      + `${count(report.scope.stride)}th entry was read — ${count(report.scope.promptEntriesRead)} of `
      + "them, evenly across the whole export. The figures above are that sample's.");
  }
  line(section, "ph-provenance-boundary", report.eligibility.boundary);
  return section;
}

/** The one thing to do next. One, and never a list a reader has to choose from. */
function actionSection(report) {
  const section = el("section", "ph-action");
  section.append(el("h4", "ph-section-title", "Do this next"));
  line(section, "ph-action-guidance", report.priority.guidance);
  if (report.priority.rewrite) {
    section.append(el("h5", "ph-action-subhead", "A rewrite to start from"));
    const rewrite = el("p", "ph-action-rewrite", report.priority.rewrite);
    // Authored rubric copy, not an echo of anything read: the report carries no
    // prompt text to echo. Marked so the stylesheet can set it as an example.
    rewrite.dataset.authored = "rubric";
    section.append(rewrite);
  }
  // The next press, attached to the answer rather than left to the reader to
  // find. It is drawn for the worked example too: somebody deciding whether to
  // hand over their own history is owed the whole of what they would get.
  const handoff = renderHandoff(report);
  if (handoff) section.append(handoff);
  return section;
}

/* ------------------------------- disclosures ------------------------------- */

export const TOGGLE_ID = (level) => `ph-toggle-${level}`;
export const PANEL_ID = (level) => `ph-panel-${level}`;

function disclosure({ level, title, hint }, body) {
  const section = el("section", "ph-disclosure");
  section.dataset.level = String(level);

  const heading = el("h4", "ph-disclosure-heading");
  const button = el("button", "ph-toggle");
  button.setAttribute("type", "button");
  button.id = TOGGLE_ID(level);
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", PANEL_ID(level));
  button.append(el("span", "ph-toggle-mark", "+"));
  button.append(el("span", "ph-toggle-label", title));
  button.append(el("span", "ph-toggle-hint", hint));
  heading.append(button);
  section.append(heading);

  const panel = el("div", "ph-panel");
  panel.id = PANEL_ID(level);
  panel.hidden = true;
  panel.append(body);
  section.append(panel);
  return section;
}

export function setDisclosureExpanded(button, expanded, doc = document) {
  button.setAttribute("aria-expanded", expanded ? "true" : "false");
  const panel = doc.getElementById(button.getAttribute("aria-controls"));
  if (panel) panel.hidden = !expanded;
  const mark = button.querySelector(".ph-toggle-mark");
  if (mark) mark.textContent = expanded ? "−" : "+";
  return expanded;
}

/** Give every disclosure in a rendered report its behaviour. Idempotent per render. */
export function wireDisclosures(root, doc = document) {
  const buttons = [...root.querySelectorAll(".ph-toggle")];
  for (const button of buttons) {
    button.addEventListener("click", () => {
      setDisclosureExpanded(button, button.getAttribute("aria-expanded") !== "true", doc);
    });
  }
  return buttons;
}

/** Level 2: every count the claim rests on, and the move it beat. */
function evidencePanel(report) {
  const body = el("div", "ph-panel-body");
  const { coverage, priority } = report;

  const table = el("dl", "ph-counts");
  const row = (term, value, note) => {
    const dt = el("dt", "ph-count-term", term);
    const dd = el("dd", "ph-count-value", value);
    if (note) dd.append(el("span", "ph-count-note", note));
    table.append(dt, dd);
  };
  if (report.scope.sampled) {
    row("Prompt entries in your export", count(report.scope.promptEntriesAvailable),
      `every ${count(report.scope.stride)}th one read, across the whole export`);
  }
  row("Prompt entries found", count(coverage.promptEntries), "the coverage denominator");
  row("Scored", count(coverage.scoredPrompts));
  row("Dropped: empty after trimming", count(coverage.dropped.empty));
  row("Dropped: no date this reader could parse", count(coverage.dropped.undated));
  row("Dropped: nothing the rubric could read", count(coverage.dropped.unreadable));
  row("Attachments skipped", count(coverage.attachmentsSkipped), "counted, never opened");
  row("Distinct days", count(coverage.distinctDays));
  body.append(el("h5", "ph-panel-subhead", "What was read, and what was not"));
  body.append(table);
  line(body, "ph-identity", `These reconcile: ${coverage.identity}.`);

  if (priority.runnerUp) {
    body.append(el("h5", "ph-panel-subhead", "The move it beat"));
    line(body, "ph-runner-up", `${priority.runnerUp.title} — worth ${priority.runnerUp.points} points `
      + `across the same prompts, against ${priority.points} for the move above. The leader is ahead by `
      + `${percent(priority.leadMargin)} of its own points.`);
    if (priority.leadMargin !== null && priority.leadMargin < 0.1) {
      line(body, "ph-runner-up-close", "That is close enough that the runner-up is an equally "
        + "reasonable place to start.");
    }
  } else if (priority.available) {
    body.append(el("h5", "ph-panel-subhead", "The move it beat"));
    line(body, "ph-runner-up", "Nothing else scored points across your history, so this move had no "
      + "runner-up to beat.");
  }

  body.append(el("h5", "ph-panel-subhead", "How the ranking was decided"));
  line(body, "ph-ranking-primary", `Ranked by ${PERSONAL_RANKING_RULE.primary}.`);
  const ties = el("ol", "ph-ranking-ties");
  for (const rule of PERSONAL_RANKING_RULE.tieBreaks) ties.append(el("li", null, rule));
  body.append(ties);
  return body;
}

/** Level 3: the standing refusals, restated beside a result rather than only before one. */
function boundaryPanel() {
  const body = el("div", "ph-panel-body");
  const list = el("dl", "ph-exclusions");
  for (const exclusion of PERSONAL_HISTORY_EXCLUSIONS) {
    const term = el("dt", "ph-exclusion-term", exclusion.label);
    term.dataset.exclusion = exclusion.id;
    const claim = el("dd", "ph-exclusion-claim", exclusion.claim);
    claim.append(el("span", "ph-exclusion-verify", `Checkable: ${exclusion.verify}`));
    list.append(term, claim);
  }
  body.append(list);
  line(body, "ph-basis", `${PERSONAL_BASIS.claim} ${PERSONAL_BASIS.refusal}`);
  return body;
}

/* ------------------------------ the refusals ------------------------------ */

/**
 * A report that names no move: either the file did not clear a floor, or it did
 * and the rubric found nothing worth points.
 *
 * It leads with a figure too — how much of the file was read — because a reader
 * told "not enough" is owed the count that decided it, and because a coverage
 * figure is the one thing that tells them whether to fix their export or come
 * back in a fortnight.
 */
function refusalSections(report, { kind }) {
  const sections = [];
  const lead = el("section", "ph-lead ph-lead-refused");
  lead.append(el("h4", "ph-section-title", report.state === PERSONAL_REPORT_STATE.notEligible
    ? "Not enough to answer this yet"
    : "Nothing to prioritize"));

  const figure = el("p", "ph-figure");
  figure.append(el("span", "ph-figure-value", count(report.coverage.scoredPrompts)));
  figure.append(el("span", "ph-figure-unit", "prompts scored"));
  lead.append(figure);
  line(lead, "ph-figure-caption",
    `of ${count(report.coverage.promptEntries)} prompt entries found, across `
    + `${plural(report.coverage.distinctDays, "day", "days")}. The floors are `
    + `${PERSONAL_ELIGIBILITY.minScoredPrompts} scored prompts and `
    + `${PERSONAL_ELIGIBILITY.minDistinctDays} distinct days.`);

  if (report.reasonRule) {
    const reason = line(lead, "ph-reason", report.reasonRule);
    reason.dataset.reason = report.reason;
  } else {
    line(lead, "ph-reason", report.priority.guidance);
  }
  line(lead, "ph-lead-refusal", "No move is named and no grade is shown. A partial answer here would "
    + "be a habit invented out of an afternoon.");
  sections.push(lead);
  sections.push(provenanceSection(report, { kind }));
  return sections;
}

/* -------------------------------- assembly -------------------------------- */

const DISCLOSURES = Object.freeze([
  Object.freeze({
    level: 2,
    title: "The evidence behind this",
    hint: "Every count, the move it beat, and how the ranking was decided",
  }),
  Object.freeze({
    level: 3,
    title: "What this never read",
    hint: "The boundary, restated beside the result, with the check behind each claim",
  }),
]);

/**
 * One report, drawn.
 *
 * @param {object} report a report from `buildPersonalHistoryReport`.
 * @param {{kind?: string, comparison?: object|null}} options `kind` is which
 *   start produced it, so the worked example can never be read as a grade of the
 *   reader's own history. `comparison` is the carry-forward result, in any of its
 *   four states; null draws no section at all, which is the shape of this page
 *   before a reading was ever carried forward.
 */
export function renderReport(report, { kind = PERSONAL_RUN_KIND.file, comparison = null } = {}) {
  const article = el("article", "ph-report");
  article.dataset.state = report.state;
  article.dataset.kind = kind;
  if (report.shape) article.dataset.shape = report.shape;

  const head = el("header", "ph-report-head");
  head.append(el("p", "eyebrow", KIND_EYEBROW[kind] ?? KIND_EYEBROW[PERSONAL_RUN_KIND.file]));
  head.append(el("h3", "ph-report-question", PERSONAL_HISTORY_QUESTION));
  article.append(head);

  if (report.state === PERSONAL_REPORT_STATE.prioritized) {
    article.append(leadSection(report));
    article.append(confidenceSection(report));
    // Only beside a named move, and only for the reader's own export. A
    // comparison has nothing to attach to in the other states, and the worked
    // example is an invented person who is never carried forward.
    const trajectory = buildTrajectory(report, comparison, { kind });
    if (trajectory) article.append(renderTrajectory(trajectory));
    article.append(provenanceSection(report, { kind }));
    article.append(actionSection(report));
  } else {
    for (const section of refusalSections(report, { kind })) article.append(section);
  }

  article.append(disclosure(DISCLOSURES[0], evidencePanel(report)));
  article.append(disclosure(DISCLOSURES[1], boundaryPanel()));
  return article;
}
