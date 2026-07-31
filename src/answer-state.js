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
  STAND_DISCLOSURE, buildStandHeadline, standHeadlineForImport,
} from "./finops-stand.js";

/** Bump when a key of the answer object or a rejection message changes meaning. */
export const ANSWER_STATE_VERSION = "finops-answer-state/1.0.0";

/** The two sources, in this module's own words. Never the composer's "example"/"import". */
export const ANSWER_SOURCE = Object.freeze({
  synthetic: "synthetic",
  imported: "imported",
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

/**
 * One composed headline, projected onto the bounded answer both sources share.
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
    departments: departmentsFrom(headline),
    withheld: withheldFrom(headline?.withheld),
  });
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

    /** Discard the import and fall back to the bundled synthetic example. */
    clearImport() {
      return toSynthetic();
    },

    /** The bounded answer: headline metric, action, position, departments. */
    getAnswer() {
      return held();
    },

    /** `'imported'` or `'synthetic'`. The only observable difference between them. */
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
