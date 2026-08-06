// One owner for the AI FinOps answer: which source it came from, and what it says.
//
// THE PROBLEM THIS SOLVES. The headline, the prioritized action, the peer
// position and the department drill-down were already composed correctly by
// `finops-stand.js` — but WHICH source composed them was decided at three
// separate call sites in evolution-page.js, each holding its own `eligibility`
// and each free to paint a different one. Nothing on the page owned the
// sentence "the answer you are reading came from your export." A reader whose
// import failed halfway through could be left with a headline from their file
// and a drill-down from the bundled example, and no module could be pointed at
// as the one that was wrong.
//
// So this module is the single place that holds the answer, and the page reads
// it rather than choosing a source per surface.
//
// ---------------------------------------------------------------------------
// WHAT THIS MODULE MAY AND MAY NOT DO
// ---------------------------------------------------------------------------
//
// 1. IT COMPOSES NOTHING AND COMPUTES NO FIGURE. Every number is read off
//    `buildStandHeadline` / `standHeadlineForImport`, which in turn read
//    `resolveCostPosition`, `recoverableShare`, `leadingFinding`,
//    `prioritizedDestination` and `validateCohortAttribution`. There is no
//    second arithmetic path here, so the imported answer and the bundled one
//    cannot drift: they are the same computation with a different input.
//
// 2. THE SYNTHETIC EXAMPLE IS NOT A SPECIAL CASE. It flows through the same
//    projection as an import and produces a structurally identical object. The
//    only difference a caller may observe is `getSource()`.
//
// 3. A REJECTED IMPORT CHANGES NOTHING. `setImport` validates first, then
//    computes the WHOLE new answer, and only then commits both fields. A
//    classification failure or a throw inside the composer leaves the previously
//    held answer — imported or synthetic — exactly as it was. There is no path
//    that publishes a half-updated answer.
//
// 4. NO STORAGE AND NO NETWORK. State lives in this closure for the life of the
//    page. Nothing here reads or writes localStorage, opens a request, or keeps
//    a row of the reader's export beyond the composed answer.
//
// 5. NOTHING BELOW BUILDS A NODE. `finops-stand-view.js` still owns the DOM;
//    `getHeadline()` hands it the same composed record this answer was
//    projected from, so the painted region and the bounded answer can never
//    describe two different computations.

import {
  STAND_DISCLOSURE, buildStandHeadline, sharedStandHeadline, standHeadlineForImport,
} from "./finops-stand.js";
import { gradeRecoverableConfidence } from "./finops-recoverable-confidence.js";

/** Bump when a key of the answer object or a rejection message changes meaning. */
export const ANSWER_STATE_VERSION = "finops-answer-state/1.1.0";

/**
 * The three sources, in this module's own words. Never the composer's names.
 *
 * PRECEDENCE, DECIDED HERE AND NOWHERE ELSE (#1206):
 *
 *   1. `shared` — a fragment-carried analysis wins on load over everything
 *      below it, because the reader clicked a link to a specific set of
 *      figures. Opening it on the bundled example would answer a question
 *      nobody asked.
 *   2. `imported` — the reader's own export, adopted while the tab is open. It
 *      outranks a shared link only because adopting one is a later, explicit
 *      act by the reader at the control that does it.
 *   3. `synthetic` — the bundled example, which is the default and never a
 *      silent stand-in: the marker says so in three channels.
 *
 * A fragment that fails to decode does NOT reach this module. The page keeps
 * the default and prints the decode reason, so the bundled company never
 * stands in for a shared analysis as if nothing had gone wrong.
 */
export const ANSWER_SOURCE = Object.freeze({
  synthetic: "synthetic",
  imported: "imported",
  shared: "shared",
});

/** How an input failed. `valid` is the only one that commits. */
export const IMPORT_CLASSIFICATION = Object.freeze({
  valid: "valid",
  empty: "empty",
  malformed: "malformed",
  wrongShape: "wrong-shape",
  /**
   * Not a validation class: the input passed every check and the composer threw
   * anyway. It is stated separately because the remedy is different — nothing
   * about the reader's file is known to be wrong.
   */
  unreadable: "unreadable",
});

/**
 * One recoverable sentence per failure class.
 *
 * Each says three things in this order: what happened, that the answer on
 * screen did not change, and one concrete step. None of them names a file, a
 * path, or any value read out of the export.
 */
export const IMPORT_REJECTION = Object.freeze({
  [IMPORT_CLASSIFICATION.empty]:
    "That export was read, but it contains no usage rows to analyze. The answer on screen is "
    + "unchanged. Choose an export that covers at least one full billing period.",
  [IMPORT_CLASSIFICATION.malformed]:
    "That file could not be read as a provider usage export. The answer on screen is unchanged. "
    + "Export it again from the provider console and choose the new file.",
  [IMPORT_CLASSIFICATION.wrongShape]:
    "That file was read, but it is not a provider usage export: the analyzed spend total and the "
    + "per-department breakdown are missing. The answer on screen is unchanged. Choose the usage "
    + "or cost export rather than an invoice or a seat roster.",
  [IMPORT_CLASSIFICATION.unreadable]:
    "That export could not be analyzed in this browser. The answer on screen is unchanged. "
    + "Nothing is known to be wrong with the file; choosing it again is worth one try.",
});

/** The message a caller may show for a valid input: there is none. */
export const IMPORT_ACCEPTED = "";

/**
 * The analysis fields the composer divides by or ranks over.
 *
 * Deliberately short. This is not a second schema for the import parser — that
 * validation already ran and is not repeated here. It is the minimum that makes
 * `standHeadlineForImport` produce an answer rather than a withheld husk.
 */
export const REQUIRED_ANALYSIS_FIELDS = Object.freeze(["spendUsd", "rankedDepartments"]);

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const rejection = (classification, missing = []) => Object.freeze({
  classification,
  valid: false,
  message: IMPORT_REJECTION[classification],
  missing: Object.freeze(missing),
});

const accepted = () => Object.freeze({
  classification: IMPORT_CLASSIFICATION.valid,
  valid: true,
  message: IMPORT_ACCEPTED,
  missing: Object.freeze([]),
});

/**
 * Classify a parsed export. Pure: no state is read, no state is written.
 *
 * AN ELIGIBILITY DECISION IS ITSELF AN ANSWER. A selection whose rows could not
 * be analyzed may still have declared its cohort attributes, and the placement
 * contract publishes its own sentence and its own next step for that case —
 * "your export declares an industry we do not publish" is a true statement
 * about the reader's file that the page already shows, and dropping them back
 * to the bundled example would take it away. So an input carrying an
 * eligibility decision is valid whether or not an analysis came with it; only
 * an input carrying neither is empty.
 *
 * @param parsedExport `{ analysis, eligibility }` — the pre-import contract the
 *   page already holds. Both fields are optional, not both.
 */
export function classifyImport(parsedExport) {
  if (parsedExport === null || parsedExport === undefined) {
    return rejection(IMPORT_CLASSIFICATION.empty);
  }
  if (!isObject(parsedExport)) return rejection(IMPORT_CLASSIFICATION.malformed);
  const analysis = parsedExport.analysis ?? null;
  const placed = isObject(parsedExport.eligibility);
  if (analysis === null) return placed ? accepted() : rejection(IMPORT_CLASSIFICATION.empty);
  if (!isObject(analysis)) return rejection(IMPORT_CLASSIFICATION.malformed);
  const missing = REQUIRED_ANALYSIS_FIELDS.filter((field) => (field === "spendUsd"
    ? !Number.isFinite(analysis.spendUsd)
    : !Array.isArray(analysis.rankedDepartments)));
  if (missing.length) return rejection(IMPORT_CLASSIFICATION.wrongShape, missing);
  // Correctly shaped and genuinely empty: a header row and nothing under it.
  if (!analysis.rankedDepartments.length && !placed) {
    return rejection(IMPORT_CLASSIFICATION.empty);
  }
  return accepted();
}

// ---------------------------------------------------------------------------
// The projection.
//
// Fixed keys, normalized slot by slot. The composer's own slots differ between
// sources in ways the renderer should never have to know about — a placed
// bundled position carries a `perTask` field an imported placement has no task
// ledger to produce, and a withheld headline carries `withheld: null` where a
// placed one carries an object. Normalizing here is what makes "one contract
// for the renderer" true rather than aspirational.
// ---------------------------------------------------------------------------

const text = (value) => (typeof value === "string" ? value : "");

const metricFrom = (slot) => Object.freeze({
  available: Boolean(slot?.available),
  label: text(slot?.label),
  value: text(slot?.value),
  basis: text(slot?.basis),
});

const actionFrom = (slot) => Object.freeze({
  available: Boolean(slot?.available),
  label: text(slot?.label),
  href: typeof slot?.href === "string" ? slot.href : null,
  basis: text(slot?.basis),
});

const positionFrom = (slot) => Object.freeze({
  available: Boolean(slot?.available),
  label: text(slot?.label),
  value: text(slot?.value),
  band: slot?.band ?? null,
  basis: text(slot?.basis),
});

/** Always an object, never null: a caller reads `available` rather than a type. */
const withheldFrom = (slot) => Object.freeze({
  available: Boolean(slot),
  reasonCode: slot?.reasonCode ?? null,
  missing: text(slot?.missing),
  nextStep: text(slot?.nextStep),
  actionLabel: text(slot?.actionLabel),
});

/**
 * The department drill-down, read off the disclosure the composer already
 * publishes. `departmentEntries` ranked them; nothing is re-sorted here, so the
 * order is the composer's and identical between the two sources.
 */
const departmentsFrom = (headline) => Object.freeze(
  (headline?.disclosures ?? [])
    .find((entry) => entry.id === STAND_DISCLOSURE.departments)?.entries
    ?.map((row) => Object.freeze({ term: text(row.term), detail: text(row.detail) })) ?? []);

/** The named department, as its own slot: a summary states it, a link carries it. */
const teamFrom = (slot) => Object.freeze({
  available: Boolean(slot?.available),
  label: text(slot?.label),
  name: text(slot?.name),
  detail: text(slot?.detail),
});

/**
 * How far this answer stands behind its own figure, as one graded value.
 *
 * The rubric is `finops-recoverable-confidence.js`'s and is consumed whole —
 * there is no second cut point here. It is on the bounded answer because a
 * figure that travels without its grade is a figure that gets quoted as if it
 * were measured.
 */
const gradeFrom = (gradability, carried = null) => {
  // A shared answer carries the grade the SENDER's verdict produced. Re-grading
  // it here would grade the absence of their export, which is not the same fact.
  if (isObject(carried) && typeof carried.grade === "string" && carried.grade !== "") {
    return Object.freeze({
      available: Boolean(carried.available), grade: carried.grade, label: text(carried.label),
    });
  }
  const verdict = gradeRecoverableConfidence(gradability ?? null);
  return Object.freeze({
    available: Boolean(gradability),
    grade: text(verdict?.grade),
    label: text(verdict?.label),
  });
};

/**
 * One composed headline, projected onto the bounded answer every source shares.
 */
export function projectAnswer(headline, source) {
  return Object.freeze({
    version: ANSWER_STATE_VERSION,
    source,
    question: text(headline?.question),
    label: text(headline?.label),
    available: Boolean(headline?.available),
    positioned: Boolean(headline?.positioned),
    /** The headline metric, in the sentence the region asserts. */
    answer: text(headline?.answer),
    /** …and as its own figure: recoverable spend and the share it is of. */
    metric: metricFrom(headline?.recoverable),
    action: actionFrom(headline?.action),
    position: positionFrom(headline?.position),
    /** The department the finding attributes the increase to. */
    team: teamFrom(headline?.team),
    /** …and how far the page stands behind the figure above. */
    grade: gradeFrom(headline?.gradability, headline?.grade ?? null),
    departments: departmentsFrom(headline),
    withheld: withheldFrom(headline?.withheld),
  });
}

// ---------------------------------------------------------------------------
// What may leave this tab in a link.
// ---------------------------------------------------------------------------

/**
 * The bounded answer's fields a shared link may carry. THE ONE LIST.
 *
 * `finops-share-codec.js` encodes exactly these and validates a decoded
 * envelope against exactly these, so there is no second field list to keep in
 * step. Everything the projection above holds that is NOT named here — the
 * department drill-down, the withheld slot, the source — stays in the tab that
 * computed it: aggregates a lead means to send, and nothing else.
 */
export const SHAREABLE_ANSWER = Object.freeze({
  strings: Object.freeze(["question", "label", "answer"]),
  slots: Object.freeze({
    metric: Object.freeze(["label", "value", "basis"]),
    action: Object.freeze(["label", "basis"]),
    position: Object.freeze(["label", "value", "basis"]),
    team: Object.freeze(["label", "name", "detail"]),
    grade: Object.freeze(["grade", "label"]),
  }),
});

const slotOf = (value, fields) => {
  if (!isObject(value)) return null;
  const projected = { available: Boolean(value.available) };
  for (const field of fields) {
    if (value[field] !== undefined && typeof value[field] !== "string") return null;
    projected[field] = text(value[field]);
  }
  return Object.freeze(projected);
};

/**
 * Project one bounded answer onto what a link may carry — and validate one that
 * arrived in a link, through the same code.
 *
 * One function for both directions on purpose: a payload that came off the wire
 * is accepted only if it survives the same projection an outgoing one is built
 * by, so "what this build encodes" and "what this build accepts" cannot drift.
 *
 * @returns the frozen payload, or null when the input is not an object, is
 *   missing a required string, carries a slot of the wrong type, or has no
 *   figure to show. Null is what both callers read as "there is nothing here".
 */
export function shareableAnswer(answer) {
  if (!isObject(answer)) return null;
  const payload = {};
  for (const field of SHAREABLE_ANSWER.strings) {
    if (answer[field] !== undefined && typeof answer[field] !== "string") return null;
    payload[field] = text(answer[field]);
  }
  // The question is what makes the link readable as an answer to something.
  if (payload.question === "") return null;
  for (const [name, fields] of Object.entries(SHAREABLE_ANSWER.slots)) {
    const slot = slotOf(answer[name], fields);
    if (slot === null) return null;
    payload[name] = slot;
  }
  // A link to no figure is a link to nothing. The control reads this as its
  // empty state and offers no link at all.
  if (!payload.metric.available || payload.metric.value === "") return null;
  return Object.freeze(payload);
}

// ---------------------------------------------------------------------------
// The state.
// ---------------------------------------------------------------------------

/**
 * The page's one answer, and the only thing allowed to change which source it
 * came from.
 *
 * `synthetic` and `imported` are injectable for tests only; no caller passes
 * anything but the shipped composers.
 */
export function createAnswerState({
  synthetic = buildStandHeadline, imported = standHeadlineForImport,
  shared = sharedStandHeadline,
} = {}) {
  // Committed together, always. Two fields rather than one because the view
  // needs the composed record and every other caller needs the bounded answer,
  // and deriving one from the other later would reopen the drift this closes.
  let headline = null;
  let answer = null;
  let source = ANSWER_SOURCE.synthetic;

  /**
   * Compose, project, and commit — in that order, with nothing written until
   * the last line. A throw anywhere above `commit` leaves the previous answer
   * standing, which is the whole reason the composition is not inlined into the
   * assignment.
   */
  const commit = (nextHeadline, nextSource) => {
    const projected = projectAnswer(nextHeadline, nextSource);
    headline = nextHeadline;
    answer = projected;
    source = nextSource;
    return projected;
  };

  const toSynthetic = () => {
    try {
      return commit(synthetic(), ANSWER_SOURCE.synthetic);
    } catch {
      // Even the example could not be composed. The state stays null-safe and
      // the accessors below return a withheld-shaped answer rather than
      // throwing at the renderer.
      return commit(null, ANSWER_SOURCE.synthetic);
    }
  };

  /**
   * The bundled example is the DEFAULT, not a mode: a lead who lands with
   * nothing chosen reads a complete answer rather than an invitation to make
   * one. It is composed on first read rather than in this constructor so that
   * constructing the state at module scope does not parse the example fixture
   * before the page has decided to paint anything.
   */
  const held = () => {
    if (answer === null) toSynthetic();
    return answer;
  };

  return Object.freeze({
    /**
     * Adopt a parsed export as the source of truth.
     *
     * @returns a frozen outcome: `{ committed, classification, message }`.
     *   `committed: false` means the stored answer was not touched.
     */
    setImport(parsedExport) {
      // Held first: a rejection must leave a real previous answer standing, and
      // on the first interaction that previous answer is the synthetic one.
      held();
      const verdict = classifyImport(parsedExport);
      if (!verdict.valid) {
        return Object.freeze({
          committed: false,
          classification: verdict.classification,
          message: verdict.message,
          missing: verdict.missing,
          source,
        });
      }
      try {
        commit(imported({
          analysis: parsedExport.analysis,
          eligibility: parsedExport.eligibility ?? null,
        }), ANSWER_SOURCE.imported);
      } catch {
        return Object.freeze({
          committed: false,
          classification: IMPORT_CLASSIFICATION.unreadable,
          message: IMPORT_REJECTION[IMPORT_CLASSIFICATION.unreadable],
          missing: Object.freeze([]),
          source,
        });
      }
      return Object.freeze({
        committed: true,
        classification: IMPORT_CLASSIFICATION.valid,
        message: IMPORT_ACCEPTED,
        missing: Object.freeze([]),
        source,
      });
    },

    /**
     * Adopt an analysis that arrived in a shared link (#1206).
     *
     * Takes a payload the codec has already decoded and validated — this module
     * does not read a URL, and nothing here writes to storage, so opening a
     * stranger's link cannot touch what this browser kept. A payload that does
     * not survive the allowlist leaves the held answer exactly as it was, on the
     * same rule `setImport` follows.
     *
     * @returns `{ committed, source }`, frozen.
     */
    setShared(payload) {
      held();
      const carried = shareableAnswer(payload);
      if (!carried) return Object.freeze({ committed: false, source });
      try {
        commit(shared(carried), ANSWER_SOURCE.shared);
      } catch {
        return Object.freeze({ committed: false, source });
      }
      return Object.freeze({ committed: true, source });
    },

    /** Discard the import and fall back to the bundled synthetic example. */
    clearImport() {
      return toSynthetic();
    },

    /** The bounded answer: headline metric, action, position, departments. */
    getAnswer() {
      return held();
    },

    /** `'synthetic'`, `'imported'` or `'shared'`. The only observable difference. */
    getSource() {
      return source;
    },

    /**
     * The composed record `finops-stand-view.js` paints, from the same commit
     * `getAnswer()` was projected from. Returned for the renderer only.
     */
    getHeadline() {
      held();
      return headline;
    },
  });
}
