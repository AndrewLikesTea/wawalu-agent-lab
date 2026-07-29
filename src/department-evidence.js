// The reading model behind one department's grade: what a skeptical reader is
// shown, in what order, and what is deliberately not shown at all.
//
// It computes nothing. Every figure below is read off two results that already
// exist — a per-department row from `conversation-literacy.js` (Rowan) and the
// eligibility verdict from `prompt-grading-eligibility.js` (Noor) — and turned
// into the strings and states a view paints. Where one of them has no answer,
// this module says so; it never fills a slot to make a layout look finished.
//
// THE READING ORDER, decided here and not by CSS:
//
//   1. impact      what this is and how big it is, with the letter
//   2. confidence  how much of the file the letter rests on
//   3. provenance  whose data it is — the reader's own, or the bundled sample
//   4. why         what acting on it (or not) means
//   5. action      the one named next step
//
// A screen reader is handed the same five in the same order, because the view
// builds them in DOM order rather than positioning them.
//
// WHAT IS NEVER IN THIS MODEL. No prompt text, no excerpt, no character count,
// no conversation identifier, no actor. A prompt reaches this surface as four
// values from `conversation-literacy.js` — a length band, an intent class, a
// model tier, a signal key — every one of them a key from a table in this
// repository. That is enforced upstream (the parse never puts a prompt body on
// a record) and asserted downstream (`tests/department-evidence.test.js` walks
// the whole model for sentinel strings).

import {
  MAX_SKETCH_SIGNATURES, PROMPT_LENGTH_BANDS,
} from "./conversation-literacy.js";
import { MIN_JOINED_RECORDS_FOR_GRADE } from "./query-literacy.js";
import { departmentFixPack } from "./department-fix-pack.js";

/** Bump when a state, a field, or the reading order changes meaning. */
export const DEPARTMENT_EVIDENCE_VERSION = "department-evidence/1.0.0";

/**
 * The one promise this surface makes, in one place.
 *
 * Persistent, not a tooltip and not a toast: the view renders it in every
 * state, disclosure open or closed, so there is no moment in which a reader is
 * looking at prompt-derived evidence without the sentence that says what it is
 * made of.
 */
export const NO_PROMPT_TEXT_STATEMENT =
  "No prompt text is shown here, and none is stored. Each row below is a shape "
  + "only: how long the prompt was, the class it scored in, the model tier it "
  + "was routed to, and the rubric signal it fired.";

/** The short form, for the chip that repeats the promise beside each sketch. */
export const REDACTED_CHIP_LABEL = "text withheld by design";

/**
 * The panel's states. `partial` is Noor's, kept as its own state rather than
 * folded into `graded`: a grade with named gaps is a different thing to read
 * than a grade without them, and it is not a failure.
 */
export const EVIDENCE_STATE = Object.freeze({
  loading: "loading",
  empty: "empty",
  error: "error",
  withheld: "withheld",
  partial: "partial",
  graded: "graded",
});

/**
 * How each state announces itself: a word, a shape, and a tone. The tone drives
 * only tint; the word and the shape are what a monochrome screenshot and a
 * screen reader get, so no state is distinguishable by hue alone.
 *
 * `withheld` and `error` are deliberately different shapes as well as different
 * words: "we did not have enough to grade this" and "we could not read your
 * file" are two different conversations, and a reader who conflates them fixes
 * the wrong thing.
 */
export const EVIDENCE_STATE_MARK = Object.freeze({
  [EVIDENCE_STATE.loading]: Object.freeze({ word: "reading", shape: "◌", tone: "neutral" }),
  [EVIDENCE_STATE.empty]: Object.freeze({ word: "nothing imported", shape: "◇", tone: "neutral" }),
  [EVIDENCE_STATE.error]: Object.freeze({ word: "not read", shape: "✕", tone: "error" }),
  [EVIDENCE_STATE.withheld]: Object.freeze({ word: "grade withheld", shape: "◇", tone: "warn" }),
  [EVIDENCE_STATE.partial]: Object.freeze({ word: "partial", shape: "◑", tone: "warn" }),
  [EVIDENCE_STATE.graded]: Object.freeze({ word: "graded", shape: "●", tone: "ready" }),
});

/**
 * Provenance ranks, and the type role each one earns.
 *
 * A grade computed from the reader's own export outranks the bundled sample,
 * and it does so in type scale, weight and spacing — `rank: "primary"` is the
 * page's stat-numeral role, `rank: "secondary"` is a card-title role one step
 * down. Tint is not part of the distinction, because a reader who cannot see
 * the tint still has to be able to tell whose data this is.
 */
export const EVIDENCE_PROVENANCE = Object.freeze({
  own: Object.freeze({
    kind: "own_import", rank: "primary", label: "Your import",
  }),
  sample: Object.freeze({
    kind: "bundled_sample", rank: "secondary", label: "Bundled sample",
  }),
});

/**
 * The sentence per next-action kind. Noor's verdict returns the action as data
 * — a kind, a subject, a shortfall — and refuses to author copy, so the copy is
 * authored here, once per kind, and composed with her numbers.
 */
const ACTION_COPY = Object.freeze({
  import_conversation_export: (action) =>
    `Import a conversation export of your own: ${countText(action.target)} classified `
    + "prompts in one department is the floor for a grade.",
  classify_more_prompts: (action) =>
    `Classify ${countText(action.shortfall)} more prompt${action.shortfall === 1 ? "" : "s"}: `
    + "widen the export's date range or include the columns the classifier reads.",
  extend_history_window: (action) =>
    `Extend the export to ${countText(action.target)} days: `
    + `it currently spans ${countText(action.observed)}.`,
  cover_department: (action) =>
    `Cover ${action.department ?? "the department below the floor"}: `
    + `${countText(action.shortfall)} more classified prompt${action.shortfall === 1 ? "" : "s"} grades it.`,
  coach_department: (action) => (action.department
    ? `Coach ${action.department} first: it is the weakest department this file grades.`
    : "Coach the weakest graded department first."),
});

/** Thousands separators, one implementation, no locale surprises. */
export function countText(value) {
  const count = Number.isFinite(value) ? Math.round(value) : 0;
  return count.toLocaleString("en-US");
}

/** A share in [0,1] as whole-number percent. Rounded once, here. */
export function percentText(share) {
  const value = Number.isFinite(share) ? share : 0;
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
}

const BAND_LABELS = new Map(PROMPT_LENGTH_BANDS.map((band) => [band.key, band.label]));

/**
 * How a model tier is worded on this surface.
 *
 * Three of the four are the tier table's own words. `null` is not a tier at
 * all: it is the export having named no model on that row, and saying "model
 * not named in the export" is the difference between a gap in the file and a
 * claim about routing.
 */
export function modelTierText(tier) {
  if (tier === null || tier === undefined) return "model not named in the export";
  if (tier === "unrecognized") return "model named, tier unrecognized";
  return `${tier} tier`;
}

const isRow = (value) => Boolean(value) && typeof value === "object";

/**
 * Build the panel's model.
 *
 * @param {{status?: string, department?: object|null, grading?: object|null,
 *   provenance?: string, minimumPrompts?: number}} input
 *   `department` is one row of `aggregateConversationLiteracy().departments`;
 *   `grading` is a `promptGradingEligibility` verdict, or null when the caller
 *   has not run it. `status` is `"ready"`, `"loading"` or `"error"` — the two
 *   states no result can describe, because there is no result yet.
 *   `routing` and `basis` are `department-fix-pack.js`'s inputs, both optional:
 *   without them the fix pack still publishes its actions, unpriced and saying so.
 * @returns the frozen view model, or a loading/empty/error model.
 */
export function departmentEvidenceModel({
  status = "ready",
  department = null,
  grading = null,
  provenance = EVIDENCE_PROVENANCE.sample.kind,
  minimumPrompts = MIN_JOINED_RECORDS_FOR_GRADE,
  routing = null,
  basis = null,
} = {}) {
  const source = provenance === EVIDENCE_PROVENANCE.own.kind
    ? EVIDENCE_PROVENANCE.own : EVIDENCE_PROVENANCE.sample;

  if (status === EVIDENCE_STATE.loading) {
    return shell(EVIDENCE_STATE.loading, source, {
      title: "Reading the import…",
      impact: "No figure is shown until the file has been read.",
      why: "A number drawn on a half-read file is a number nobody measured.",
    });
  }
  if (status === EVIDENCE_STATE.error) {
    return shell(EVIDENCE_STATE.error, source, {
      title: "This export could not be read.",
      impact: "No grade, and no evidence: nothing was classified.",
      why: "Nothing was stored either. Re-export with the prompt column included and try again.",
    });
  }
  if (!isRow(department)) {
    return shell(EVIDENCE_STATE.empty, source, {
      title: "No department to show evidence for.",
      impact: `A department needs ${countText(minimumPrompts)} classified prompts before it is graded.`,
      why: "Nothing here is withheld — there is simply no imported prompt attributed to a department yet.",
    });
  }

  const state = evidenceState(department, grading);
  const mark = EVIDENCE_STATE_MARK[state];
  const prompts = department.prompts ?? { total: 0, classified: 0, unclassified: 0 };
  const gradeable = department.gradeable === true;

  return Object.freeze({
    version: DEPARTMENT_EVIDENCE_VERSION,
    state,
    mark,
    provenance: Object.freeze({
      ...source,
      // The provenance sentence is Noor's when she has one, because she is the
      // module that knows whether the reader's corpus owns the headline.
      detail: grading?.disclosure?.provenance
        ?? (source.kind === EVIDENCE_PROVENANCE.own.kind
          ? `Graded from your file, ${countText(prompts.classified)} classified prompts.`
          : "Graded from the bundled sample. Nothing of yours has been imported."),
    }),
    head: Object.freeze({
      department: department.department,
      // Grade first, and the letter is never published alone: a withheld letter
      // is the word "withheld", not a dash a reader could mistake for a score.
      grade: gradeable ? department.grade : null,
      gradeLine: gradeable
        ? `${department.department} · grade ${department.grade}, `
          + `score ${countText(department.score)} of 100`
        : `${department.department} · no grade published`,
      impact: impactText(department, gradeable, minimumPrompts),
      confidence: Object.freeze({
        word: mark.word,
        shape: mark.shape,
        tone: mark.tone,
        // Noor's label carries this repository's trust vocabulary; keeping it
        // means one wording for "partial" across every surface that has one.
        label: grading?.label ?? confidenceLabel(department, gradeable),
        detail: confidenceDetail(department, prompts),
      }),
      coverage: Object.freeze({
        share: department.coverage ?? 0,
        text: `${percentText(department.coverage)} of this department's `
          + `${countText(prompts.total)} imported prompt${prompts.total === 1 ? "" : "s"} classified`,
        rule: grading?.rule ?? null,
      }),
      why: grading?.disclosure?.whyItMatters ?? whyText(department, gradeable),
      action: actionFor(grading, department, gradeable, minimumPrompts),
    }),
    privacy: Object.freeze({
      statement: NO_PROMPT_TEXT_STATEMENT,
      chip: REDACTED_CHIP_LABEL,
    }),
    detail: detailOf(department, prompts),
    // The loaded result carries its fix pack: the named actions behind the
    // evidence above, ranked and priced by `department-fix-pack.js`. It is on the
    // model rather than fetched by the view so the panel and the actions can never
    // describe two different departments.
    fixPack: departmentFixPack({ department, routing, basis, provenance: source.kind }),
    disclosureLabel: disclosureLabel(department),
    announcement: null,
  });
}

/**
 * The announcement, assembled in the required order: grade, confidence,
 * coverage, then the named next action. Exported separately from the model so a
 * test can assert the order as a string rather than by reading the DOM.
 */
export function evidenceAnnouncement(model) {
  if (!model) return "";
  const head = model.head;
  if (!head) return `${model.title}. ${model.impact}`;
  return `${head.gradeLine}. Confidence: ${head.confidence.label}. `
    + `Coverage: ${head.coverage.text}. Next: ${head.action.text}`;
}

// --- states -----------------------------------------------------------------

function evidenceState(department, grading) {
  if (department.gradeable !== true) return EVIDENCE_STATE.withheld;
  // Noor owns "partial": a graded department inside an import with named gaps
  // is still trustworthy, and saying so is the whole point of her state.
  if (grading?.state === "partial") return EVIDENCE_STATE.partial;
  return EVIDENCE_STATE.graded;
}

/** The loading / empty / error models. One shape, so a view has one branch. */
function shell(state, source, copy) {
  const mark = EVIDENCE_STATE_MARK[state];
  return Object.freeze({
    version: DEPARTMENT_EVIDENCE_VERSION,
    state,
    mark,
    provenance: Object.freeze({ ...source, detail: null }),
    head: null,
    title: copy.title,
    impact: copy.impact,
    why: copy.why,
    privacy: Object.freeze({
      statement: NO_PROMPT_TEXT_STATEMENT,
      chip: REDACTED_CHIP_LABEL,
    }),
    detail: null,
    // No department, no result, no fix pack. A loading or unreadable panel with
    // actions beside it would be actions about nothing.
    fixPack: null,
    disclosureLabel: null,
    announcement: null,
  });
}

// --- the head's four sentences ----------------------------------------------

function impactText(department, gradeable, minimumPrompts) {
  const classified = department.prompts?.classified ?? 0;
  if (!gradeable) {
    const short = Math.max(0, minimumPrompts - classified);
    return short > 0
      ? `${countText(classified)} classified prompt${classified === 1 ? "" : "s"} — `
        + `${countText(short)} short of the ${countText(minimumPrompts)} a grade needs.`
      : `${countText(classified)} classified prompt${classified === 1 ? "" : "s"}, `
        + "and no letter: " + (department.reasonText ?? "this department is not gradeable.");
  }
  const driver = department.driver;
  if (!driver) {
    return `${countText(classified)} classified prompts, and no weakness signal fired: `
      + "every scored prompt sits in the reference class.";
  }
  return `${countText(driver.impact)} recoverable prompt-points, `
    + `led by ${driver.label}: ${percentText(driver.share)} of `
    + `${countText(driver.denominator)} classified prompts (${countText(driver.numerator)}).`;
}

function confidenceLabel(department, gradeable) {
  if (!gradeable) return "Withheld · below the grading floor";
  return department.confidence === null
    ? "Graded · classifier confidence unmeasured"
    : `Graded · mean classifier confidence ${percentText(department.confidence)}`;
}

function confidenceDetail(department, prompts) {
  const unclassified = prompts.unclassified ?? 0;
  const attribution = Array.isArray(department.attribution) ? department.attribution : [];
  return `${countText(prompts.classified)} of ${countText(prompts.total)} prompts classified, `
    + `${countText(unclassified)} not`
    + (attribution.length ? ` · attributed by ${attribution.join(" and ")}` : "");
}

function whyText(department, gradeable) {
  if (!gradeable) {
    return department.reasonText
      ?? "A letter drawn from this few prompts would move on one unusual week.";
  }
  return department.driver
    ? "This is the share of prompts an AI-literacy programme could realistically move, "
      + "not the share that scored badly."
    : "There is nothing here for a programme to recover, which is a result, not a gap.";
}

function actionFor(grading, department, gradeable, minimumPrompts) {
  const action = grading?.nextAction ?? null;
  const copy = action && ACTION_COPY[action.kind];
  if (copy) {
    return Object.freeze({
      kind: action.kind,
      available: action.available !== false,
      text: copy(action),
    });
  }
  if (!gradeable) {
    const short = Math.max(0, minimumPrompts - (department.prompts?.classified ?? 0));
    return Object.freeze({
      kind: "cover_department",
      available: true,
      text: `Cover ${department.department}: ${countText(short)} more classified `
        + `prompt${short === 1 ? "" : "s"} publishes a letter for it.`,
    });
  }
  return Object.freeze({
    kind: department.driver ? "coach_signal" : "hold",
    available: Boolean(department.driver),
    text: department.driver
      ? `Take ${department.department}'s ${department.driver.label} to the next workshop: `
        + `${department.driver.text.replace(/^Support: /, "")}.`
      : `Hold: no weakness signal fired for ${department.department}.`,
  });
}

// --- what sits behind the disclosure ----------------------------------------

function disclosureLabel(department) {
  const signatures = department.sketches?.shownCount ?? 0;
  return `Show the evidence behind ${department.department}'s grade — counts, `
    + `rubric signals, score distribution and ${countText(signatures)} redacted `
    + `prompt sketch${signatures === 1 ? "" : "es"}`;
}

function detailOf(department, prompts) {
  const sketches = department.sketches ?? {
    represented: 0, signatureCount: 0, shownCount: 0, shownPrompts: 0, signatures: [],
  };
  return Object.freeze({
    counts: Object.freeze([
      Object.freeze({ label: "Prompts imported", value: countText(prompts.total) }),
      Object.freeze({ label: "Classified", value: countText(prompts.classified) }),
      Object.freeze({ label: "Not classified", value: countText(prompts.unclassified) }),
      Object.freeze({
        label: "Mean confidence",
        value: department.confidence === null ? "unmeasured" : percentText(department.confidence),
      }),
    ]),
    signals: Object.freeze((department.signals ?? []).map((signal) => Object.freeze({
      key: signal.key,
      label: signal.label,
      // Numerator and denominator both, always: a share on its own invites a
      // reader to imagine a denominator, and 3 of 4 is not 300 of 400.
      countText: `${countText(signal.numerator)} of ${countText(signal.denominator)}`,
      shareText: percentText(signal.share),
      impactText: `${countText(signal.impact)} recoverable prompt-points`,
      evidence: signal.text,
      fired: signal.numerator > 0,
    }))),
    distribution: Object.freeze((department.distribution ?? []).map((row) => Object.freeze({
      key: row.key,
      label: row.label,
      countText: countText(row.count),
      shareText: percentText(row.share),
      share: row.share,
      scoreText: `${countText(row.scorePoints)} of 100`,
    }))),
    sketches: Object.freeze({
      represented: sketches.represented,
      signatureCount: sketches.signatureCount,
      shownCount: sketches.shownCount,
      // Stated, never silent: a reader looking at eight rows out of thirty is
      // told so, in the same block as the rows.
      truncationText: sketches.signatureCount > sketches.shownCount
        ? `Showing the ${countText(sketches.shownCount)} most common of `
          + `${countText(sketches.signatureCount)} shapes, covering `
          + `${countText(sketches.shownPrompts)} of ${countText(sketches.represented)} prompts.`
        : `${countText(sketches.signatureCount)} shape`
          + `${sketches.signatureCount === 1 ? "" : "s"} cover `
          + `all ${countText(sketches.represented)} prompt`
          + `${sketches.represented === 1 ? "" : "s"} behind this finding.`,
      emptyText: sketches.represented === 0
        ? "No prompt in this department fired a weakness signal, so there is nothing to sketch."
        : null,
      rows: Object.freeze((sketches.signatures ?? []).map((row) => Object.freeze({
        key: row.key,
        countText: `${countText(row.count)} prompt${row.count === 1 ? "" : "s"}`,
        shareText: percentText(row.share),
        lengthText: BAND_LABELS.get(row.lengthBand) ?? row.lengthBandLabel ?? row.lengthBand,
        intentText: row.intentClassLabel ?? row.intentClass,
        modelText: modelTierText(row.modelTier),
        signalText: `signal: ${row.signalLabel ?? row.signal}`,
      }))),
      cap: MAX_SKETCH_SIGNATURES,
    }),
  });
}
