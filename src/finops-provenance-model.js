// Whose numbers is each headline panel showing?
//
// The AI FinOps page used to answer that once, globally: a chip said "Example
// data" or "Local import" and every figure below it inherited the claim. That is
// wrong in the ordinary case. A visitor who imports a usage export and a prompt
// sample owns the KPI row and the grade, and still has no peer cohort of their
// own — so one badge has to describe four different provenances, and it picks
// one and lies about three.
//
// This module is the single derived view-model the whole surface reads. Four
// panels resolve their source here, independently, from one input; the render
// layer swaps a label because this object says `source: "user"`, never because
// something imperatively rewrote a paragraph.
//
// ---------------------------------------------------------------------------
// THE REDACTION BOUNDARY
// ---------------------------------------------------------------------------
//
// `promptImportFacts` below is the only function in this file that is handed
// anything derived from a visitor's file, and it reads exactly four things off
// it: how many records parsed, how many the classifier set aside, which
// *canonical contract field* those issues named, and the file's own name. It
// never touches `promptExcerpt`, never copies a cell value, and never echoes a
// header string back — a header is compared against the contract's field list
// and the canonical name is emitted, so a mis-mapped column carrying prose
// cannot ride out on the label.
//
// Past that function every value in this model is a number, a file name, a
// department name, or a phrase authored in this repository. The render layer is
// handed this object and nothing else, so there is no prompt text for it to
// leak even by accident.
//
// ---------------------------------------------------------------------------
// Deliberate omissions
// ---------------------------------------------------------------------------
//
// * No per-panel flags. A panel does not get to decide it is "mostly" the
//   reader's. `panels` is derived once, and a mid-import or failed state forces
//   every panel back to the sample together rather than half-swapping.
// * No second metric on the headline. Noor's three states each answer one
//   question with one number and one action; a second figure beside it would be
//   the surface this page keeps rebuilding away from.
// * No persistence. Nothing here reads or writes storage, the URL, or a clock.

import { formatCount } from "./evolution.js";
import {
  PROMPT_GRADING_STATE, PROMPT_GRADING_THRESHOLDS,
} from "./prompt-grading-eligibility.js";

/** Bump this when a `source`, a `state`, or a panel key changes meaning. */
export const FINOPS_PROVENANCE_VERSION = "finops-panel-provenance/1.0.0";

/**
 * The label a sample-fed panel carries, verbatim as the page has always shipped
 * it. Authored once so the markup, this model, and the tests cannot hold three
 * versions of one sentence.
 */
export const SAMPLE_LABEL =
  "Example data — bundled synthetic sample, replaced by your figures only after a local import.";

/** The word beside the shape. Neither one is a tint; both survive monochrome. */
export const SAMPLE_WORD = "Example data";
export const USER_WORD = "Your data";
const SAMPLE_SHAPE = "◇";
const USER_SHAPE = "▣";

/** The four panels that resolve their source independently. */
export const FINOPS_PANEL = Object.freeze({
  headline: "headline",
  kpis: "kpis",
  cohort: "cohort",
  coaching: "coaching",
});

/**
 * What one row of each panel's data *is*, so the provenance line can state a
 * count in the panel's own unit rather than in a unit borrowed from its
 * neighbour. "412 rows" under a grade drawn from 300 classified prompts is the
 * leak this file exists to prevent.
 */
const PANEL_UNIT = Object.freeze({
  headline: "classified prompt",
  kpis: "row",
  cohort: "cohort member",
  coaching: "classified prompt",
});

/**
 * Why a panel is still the sample's. Stable codes; the surface may reword the
 * sentence beside them freely.
 */
export const SAMPLE_REASON = Object.freeze({
  noImport: "no_import",
  notGradeable: "import_below_grading_floor",
  noUserCohort: "no_user_cohort",
  importPending: "import_pending",
  importFailed: "import_failed",
});

/**
 * The cohort panel can never be the reader's, and that is a property of the
 * product rather than of any one import: a local, in-tab analysis has no peer
 * organizations in it to compare against. Stated here so the surface does not
 * have to re-derive "there is no user cohort" from an absence.
 */
export const NO_USER_COHORT_REASON =
  "A local import carries no peer organizations, so the comparison stays the bundled cohort's.";

const COACHING_SAMPLE_ANSWER =
  "The bundled example's lowest-scoring team, drawn from synthetic prompts.";

/** The three processing states the panels have to survive without a half-swap. */
export const FINOPS_IMPORT_STATUS = Object.freeze({
  ready: "ready", pending: "pending", failed: "failed",
});

const PENDING_MESSAGE =
  "Reading your file in this tab. The panels below are still the bundled example.";

const FAILED_MESSAGE =
  "Your file was not analyzed, so every panel below is the bundled example again. "
  + "Nothing you selected was uploaded or stored.";

function samplePanel(panel, reason) {
  return Object.freeze({
    panel,
    source: "sample",
    word: SAMPLE_WORD,
    shape: SAMPLE_SHAPE,
    label: SAMPLE_LABEL,
    detail: "",
    fileName: null,
    count: null,
    unit: PANEL_UNIT[panel],
    reason,
  });
}

function userPanel(panel, { fileName, count }) {
  const unit = PANEL_UNIT[panel];
  return Object.freeze({
    panel,
    source: "user",
    word: USER_WORD,
    shape: USER_SHAPE,
    label: `${USER_WORD} — ${fileName}`,
    // The count is this panel's own, in this panel's own unit, and it says so.
    // Nothing here is summed across panels.
    detail: `${formatCount(count)} ${unit}${count === 1 ? "" : "s"} from this file fed this panel. `
      + "Nothing was uploaded or stored.",
    fileName,
    count,
    unit,
    reason: null,
  });
}

// ---------------------------------------------------------------------------
// The copy deck for Noor's three states.
//
// `prompt-grading-eligibility.js` returns its next action as data — a kind, a
// named subject, and the size of the gap — and says the headline that reads it
// owns the sentence. These are those sentences. Each state renders exactly one
// question, exactly one metric, and exactly one action; there is no branch below
// that adds a second of any of them.
// ---------------------------------------------------------------------------

const T = PROMPT_GRADING_THRESHOLDS;

function headlineFor(verdict, facts) {
  const file = facts?.fileName ?? "your export";
  if (!verdict || verdict.state === PROMPT_GRADING_STATE.sampleOnly) {
    return Object.freeze({
      state: PROMPT_GRADING_STATE.sampleOnly,
      question: "Is this grade yours?",
      metric: Object.freeze({
        label: "Prompts of yours behind this grade",
        // The one number that decides the question, against the floor it is
        // measured against. Not a second metric: it is one ratio.
        value: `${formatCount(verdict?.totalPrompts ?? 0)} imported · `
          + `${formatCount(T.minPromptsPerDepartment)} needed in one department`,
      }),
      action: Object.freeze({
        kind: verdict?.nextAction?.kind ?? "import_conversation_export",
        text: "Import a prompt export to grade your own departments. "
          + "Until then every panel on this page is the bundled example.",
      }),
    });
  }
  if (verdict.state === PROMPT_GRADING_STATE.ownGrade) {
    const worst = verdict.nextAction?.department ?? null;
    return Object.freeze({
      state: PROMPT_GRADING_STATE.ownGrade,
      question: "Which team needs coaching first?",
      metric: Object.freeze({
        label: "Departments graded from your own prompts",
        value: `${formatCount(verdict.departmentsCovered)} of `
          + `${formatCount(verdict.detail.departmentsPresent)} in ${file}`,
      }),
      action: Object.freeze({
        kind: "coach_department",
        text: worst
          ? `Coach ${worst} first: it scores lowest of the departments ${file} graded.`
          : `Coach the lowest-scoring department in ${file} first.`,
        department: worst,
      }),
    });
  }
  return Object.freeze({
    state: PROMPT_GRADING_STATE.partial,
    question: "Which part of this grade is yours?",
    metric: Object.freeze({
      label: "Departments graded from your own prompts",
      value: `${formatCount(verdict.departmentsCovered)} of `
        + `${formatCount(verdict.detail.departmentsPresent)} in ${file}`,
    }),
    action: partialAction(verdict, facts, file),
  });
}

/**
 * The partial state's one action, naming the gap and the thing that closes it.
 *
 * "Incomplete data" is not an action. Every branch below names either a
 * department or a contract field, and the file it would be added to, because
 * that is what the reader has to go and change. The kind and the shortfall come
 * from Noor's verdict unchanged; only the sentence is written here.
 */
function partialAction(verdict, facts, file) {
  const action = verdict.nextAction ?? {};
  if (action.kind === "classify_more_prompts") {
    // The field the classifier reported against, when the import told us which
    // one — otherwise the contract's own name for it. Never the reader's own
    // header string.
    const field = facts?.gapField ?? "category";
    const present = facts?.gapFieldPresent === true;
    return Object.freeze({
      kind: action.kind,
      field,
      text: present
        ? `Fill the ${field} column in ${file}: ${formatCount(action.shortfall ?? 0)} more `
          + "prompts must classify before this grade covers your file."
        : `Add a ${field} column to ${file}: ${formatCount(action.shortfall ?? 0)} more `
          + "prompts must classify before this grade covers your file.",
    });
  }
  if (action.kind === "extend_history_window") {
    return Object.freeze({
      kind: action.kind,
      field: "query_date",
      text: `Extend ${file} by ${formatCount(action.shortfall ?? 0)} more days: its query_date column `
        + `spans ${formatCount(action.observed ?? 0)} of the ${formatCount(action.target ?? 0)} days a grade needs.`,
    });
  }
  const department = action.department ?? null;
  return Object.freeze({
    kind: action.kind ?? "cover_department",
    field: "org_unit_id",
    department,
    text: department
      ? `Add ${formatCount(action.shortfall ?? 0)} more ${department} prompts to ${file}: `
        + `its org_unit_id column carries ${formatCount(action.observed ?? 0)} of the `
        + `${formatCount(action.target ?? 0)} that department needs.`
      : `Name every prompt's department in the org_unit_id column of ${file}.`,
  });
}

// ---------------------------------------------------------------------------
// The strip boundary.
// ---------------------------------------------------------------------------

/**
 * The four facts a provenance line needs about a prompt import, read off the
 * parsed and classified results and nothing else carried forward.
 *
 * @param entries `[{ fileName, parsed, classified }]` — `parseQuerySample` output
 *   paired with its `classifyQuerySample` result, exactly as the page holds them.
 * @param contractFields the canonical field names a gap may be reported against.
 *   An issue naming anything outside this list is reported as `category`, so a
 *   value that reached the `field` slot by accident cannot become label text.
 * @returns `{ fileName, files, classified, gapField, gapFieldPresent }` — five
 *   values, none of which is a cell.
 */
export function promptImportFacts(entries = [], contractFields = []) {
  const list = Array.isArray(entries) ? entries : [];
  const allowed = new Set(contractFields.length ? contractFields : ["category"]);
  const files = list.map((entry) => entry?.fileName).filter(Boolean);
  if (!files.length) return null;
  let classified = 0;
  const fieldCounts = new Map();
  const headers = new Set();
  for (const entry of list) {
    classified += entry?.classified?.records?.length ?? 0;
    for (const issue of entry?.classified?.unclassified ?? []) {
      const field = allowed.has(issue?.field) ? issue.field : "category";
      fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
    }
    // Header names are compared, never kept. What survives this loop is a
    // boolean per canonical field name, so nothing a header contained can be
    // rendered.
    for (const column of entry?.parsed?.columns ?? []) {
      const name = String(column ?? "").trim().toLowerCase();
      if (allowed.has(name)) headers.add(name);
    }
  }
  const gapField = [...fieldCounts.entries()]
    .sort(([leftKey, left], [rightKey, right]) => right - left || leftKey.localeCompare(rightKey))[0]?.[0]
    ?? "category";
  return Object.freeze({
    // One file is named; several are joined, the way the import provenance line
    // on this page already names a multi-file selection.
    fileName: files.join(", "),
    files: Object.freeze([...files]),
    classified,
    gapField,
    gapFieldPresent: headers.has(gapField),
  });
}

// ---------------------------------------------------------------------------
// The model itself.
// ---------------------------------------------------------------------------

/**
 * Resolve every panel's source, and the headline's one question, from one input.
 *
 * @param input.status one of `FINOPS_IMPORT_STATUS`. `pending` and `failed` both
 *   force every panel back to the sample: a surface with some panels swapped and
 *   some stale is worse than one that plainly says it is still the example.
 * @param input.promptGrading a `promptGradingEligibility` verdict, or null.
 * @param input.promptFacts a `promptImportFacts` result, or null.
 * @param input.usage `{ fileName, rows }` for the reader's usage/roster import,
 *   or null while the KPI row is still the bundled sample's.
 * @param input.coaching `{ department, score }` when the reader's own prompts
 *   name a team to coach, or null.
 */
export function finopsProvenanceModel({
  status = FINOPS_IMPORT_STATUS.ready,
  promptGrading = null,
  promptFacts = null,
  usage = null,
  coaching = null,
} = {}) {
  const settled = status === FINOPS_IMPORT_STATUS.ready;
  const transientReason = status === FINOPS_IMPORT_STATUS.failed
    ? SAMPLE_REASON.importFailed : SAMPLE_REASON.importPending;

  // Noor's verdict decides whether the *grade* is the reader's; an import that
  // exists but sits under the floor is still the sample's grade, and says so.
  const ownGrade = settled && Boolean(promptGrading?.showOwnGrade) && Boolean(promptFacts);
  const gradeReason = promptGrading?.hasOwnImport
    ? SAMPLE_REASON.notGradeable : SAMPLE_REASON.noImport;
  const ownKpis = settled && Boolean(usage?.fileName);

  const headlinePanel = ownGrade
    ? userPanel(FINOPS_PANEL.headline,
      { fileName: promptFacts.fileName, count: promptGrading.classifiedPrompts })
    : samplePanel(FINOPS_PANEL.headline, settled ? gradeReason : transientReason);
  const kpiPanel = ownKpis
    ? userPanel(FINOPS_PANEL.kpis, { fileName: usage.fileName, count: usage.rows ?? 0 })
    : samplePanel(FINOPS_PANEL.kpis,
      settled ? SAMPLE_REASON.noImport : transientReason);
  // Never the reader's, and not because this import fell short. The reason code
  // differs so a reader is not told to import more of something that would not
  // change it.
  const cohortPanel = samplePanel(FINOPS_PANEL.cohort,
    settled ? SAMPLE_REASON.noUserCohort : transientReason);
  const ownCoaching = ownGrade && Boolean(coaching?.department);
  const coachingPanel = ownCoaching
    ? userPanel(FINOPS_PANEL.coaching,
      { fileName: promptFacts.fileName, count: promptGrading.classifiedPrompts })
    : samplePanel(FINOPS_PANEL.coaching, settled ? gradeReason : transientReason);

  const headline = settled
    ? headlineFor(promptGrading, promptFacts)
    : headlineFor(null, null);
  const panels = Object.freeze({
    headline: headlinePanel, kpis: kpiPanel, cohort: cohortPanel, coaching: coachingPanel,
  });
  const anyUserPanel = Object.values(panels).some((panel) => panel.source === "user");

  return Object.freeze({
    version: FINOPS_PROVENANCE_VERSION,
    status,
    state: headline.state,
    headline,
    panels,
    anyUserPanel,
    cohortAnswer: NO_USER_COHORT_REASON,
    coachingAnswer: ownCoaching
      ? `${coaching.department} first — the lowest-scoring department in your own prompts.`
      : COACHING_SAMPLE_ANSWER,
    /**
     * The way back. Available exactly when there is something to go back from,
     * so the control is not offered against a page that is already the sample.
     */
    returnControl: Object.freeze({
      available: anyUserPanel,
      label: "Show the bundled example data in all four panels",
    }),
    message: settled ? null
      : (status === FINOPS_IMPORT_STATUS.failed ? FAILED_MESSAGE : PENDING_MESSAGE),
  });
}
