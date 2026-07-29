// One leadership question, answered from a local organizational query sample.
//
// WHAT THIS IS. `org-query-scoring.js` publishes a literacy model: per-unit
// grades, the query mix behind them, a confidence with the factor that capped it,
// the coaching gap, and the provenance a dispute needs. That model is evidence,
// and a leader with fourteen fields in front of them has to assemble the decision
// themselves. This module assembles it: one question, one answer, the grade and
// benchmark it rests on, the confidence, the provenance, one prioritized action —
// and four ordered disclosures for the reader who wants to check any of it.
//
// It is display selection and nothing else. Not one number here is computed:
// every figure is read off the model, and every threshold quoted in a sentence is
// the model's own. A weight this module invented would be a weight nobody could
// find, so there are none.
//
// THE REDACTION BOUNDARY IS UPSTREAM AND THIS MODULE STAYS BEHIND IT. The
// literacy model is built from classified records whose eight keys are an
// allowlist; there is no prompt text in its input, so there is none in this
// output either. `redactionRows` below states that to the reader rather than
// claiming it in a comment nobody reads.
//
// THREE STATES, AND NO FOURTH.
//   absent      — no local sample. The bundled example surface is left alone.
//   ungradeable — a sample arrived and no unit's letter may be published. It
//                 says which floor it missed and what to bring; it publishes no
//                 grade, no benchmark, and no priority order.
//   graded      — at least one unit carries a letter. Everything above is filled.
//
// Determinism: no clock, no randomness, no I/O. Same model in, same state out.

import {
  ORG_QUERY_REDACTION_STATEMENT, ORG_QUERY_SCORING_CODES, ORG_CLASSIFIED_RECORD_KEYS,
} from "./org-query-scoring.js";
import { safeDisplayFileName } from "./import-limits.js";

export const ORG_QUERY_DECISION_VERSION = "org-query-decision/1.0.0";

/** The question this whole surface exists to answer. Authored once. */
export const COACHING_QUESTION = "Which department needs coaching now?";

export const ORG_QUERY_DECISION_STATE = Object.freeze({
  absent: "absent", ungradeable: "ungradeable", graded: "graded",
});

/**
 * How the answer is ordered, stated on the surface rather than implied.
 *
 * Not this module's rule: `coachingGap` ranks by recoverable prompt-points from
 * the recoverability table in `conversation-literacy.js`. It is quoted here so a
 * leader reading "coach this unit first" can see it is not "who looks worst".
 */
export const COACHING_RANK_RULE =
  "Ranked by recoverable prompt-points — how much of the gap an AI-literacy programme can move — "
  + "not by the lowest letter.";

/** Why a sample produced no publishable letter. One sentence and one next step. */
const UNGRADEABLE = Object.freeze({
  [ORG_QUERY_SCORING_CODES.NO_RECORDS]: Object.freeze({
    label: "No query rows were read from this selection.",
    detail: "Nothing in the chosen file validated as an organizational query row, so there is "
      + "nothing to grade and no unit is named.",
    action: "Check that the file carries an organization-unit column and one row per query, then "
      + "choose it again.",
  }),
  [ORG_QUERY_SCORING_CODES.NO_CLASSIFIED_RECORDS]: Object.freeze({
    label: "No row could be placed in a rubric category.",
    detail: "Every row read carried neither a declared category nor an excerpt the local "
      + "classifier would place, so the sample has a size but no literacy content.",
    action: "Re-export with the category column filled, or with a short prompt excerpt per row.",
  }),
  [ORG_QUERY_SCORING_CODES.NO_GRADEABLE_UNIT]: Object.freeze({
    label: "No department has enough classified queries to be graded.",
    detail: "The sample was read and classified, but every unit in it sits under the letter "
      + "floor, so publishing a letter would describe the sample rather than the department.",
    action: "Widen the export — more queries per department, over more days — and choose it again.",
  }),
  [ORG_QUERY_SCORING_CODES.SOURCE_DOES_NOT_GRADE]: Object.freeze({
    label: "This source is not graded for prompt literacy.",
    detail: "It carries attribution and volume, which answers where the queries came from and "
      + "how many there were. It carries no category or excerpt, so it cannot carry a grade.",
    action: "Bring a gateway log or prompt batch alongside it if you need the literacy reading.",
  }),
});

const FALLBACK_UNGRADEABLE = Object.freeze({
  label: "This sample cannot be graded.",
  detail: "The scorer published no letter for any unit and named no reason this surface "
    + "recognizes, so nothing is claimed about any department.",
  action: "Choose the file again, or bring a wider export.",
});

/**
 * Confidence as three channels, never a tint alone: a word, a shape, and the
 * sentence the factor itself carries. The words are the model's three levels.
 */
const CONFIDENCE_WORDS = Object.freeze({
  high: Object.freeze({ word: "High confidence", shape: "●" }),
  medium: Object.freeze({ word: "Medium confidence", shape: "◐" }),
  low: Object.freeze({ word: "Low confidence", shape: "◇" }),
});

const FACTOR_LABELS = Object.freeze({
  prompts_per_unit: "Queries per department",
  classified_share: "Share of the sample classified",
  history_window_days: "Days the sample spans",
});

export const DISCLOSURE_IDS = Object.freeze({
  mix: "query-mix",
  evidence: "department-evidence",
  sampling: "sampling-limits",
  redaction: "redaction-provenance",
});

/** The order the disclosures are offered in, and the questions they answer. */
export const DISCLOSURE_ORDER = Object.freeze([
  Object.freeze({ id: DISCLOSURE_IDS.mix, question: "What was the AI actually asked to do?" }),
  Object.freeze({
    id: DISCLOSURE_IDS.evidence,
    question: "What is behind each department's grade?",
  }),
  Object.freeze({
    id: DISCLOSURE_IDS.sampling,
    question: "What are the limits of this sample?",
  }),
  Object.freeze({
    id: DISCLOSURE_IDS.redaction,
    question: "What was read, what was never read, and by which versions?",
  }),
]);

const percent = (share) => `${Math.round((Number(share) || 0) * 100)}%`;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * The whole decision state for one local sample.
 *
 * @param literacy an `orgQueryDepartmentLiteracy` model, or null/undefined when
 *   the reader has brought no query sample. Null is the `absent` state, not an
 *   error: the bundled example surface owns the page until a sample arrives.
 * @param origin `"import"` for the reader's own file, `"example"` for the
 *   bundled synthetic sample. It changes provenance and the announcement, and
 *   nothing else — an example graded as the reader's own would be exactly the
 *   mislabelling the per-panel provenance exists to end.
 */
export function orgQueryCoachingDecision(literacy, { origin = "import", fileNames = [] } = {}) {
  if (!literacy) return Object.freeze({
    version: ORG_QUERY_DECISION_VERSION,
    state: ORG_QUERY_DECISION_STATE.absent,
    question: COACHING_QUESTION,
    origin,
  });
  const confidence = confidenceOf(literacy);
  const provenance = provenanceOf(literacy, origin, fileNames);
  const disclosures = disclosuresOf(literacy);
  return literacy.gradeable
    ? graded(literacy, { confidence, provenance, disclosures, origin })
    : ungradeable(literacy, { confidence, provenance, disclosures, origin });
}

function graded(literacy, { confidence, provenance, disclosures, origin }) {
  const gap = literacy.coachingGap ?? {};
  const rows = literacy.departments.filter((row) => row.gradeable === true);
  // The named unit is the coaching gap's, because that is the ranking the rule
  // above states. A graded sample whose every weakness is in the reference class
  // names no gap, and the lowest letter is then the honest second-best answer —
  // said as what it is rather than dressed as the same ranking.
  const named = rows.find((row) => row.department === gap.department)
    ?? [...rows].sort((left, right) => left.score - right.score
      || left.department.localeCompare(right.department))[0];
  const byImpact = gap.department === named.department;
  return Object.freeze({
    version: ORG_QUERY_DECISION_VERSION,
    state: ORG_QUERY_DECISION_STATE.graded,
    question: COACHING_QUESTION,
    origin,
    answer: `${named.department} — coach this department first.`,
    rule: byImpact ? COACHING_RANK_RULE
      : "No recoverable gap could be ranked, so the lowest graded letter is named instead.",
    benchmark: Object.freeze({
      grade: named.grade,
      score: named.score,
      scoreText: `${named.score}/100`,
      label: `Prompt-literacy grade ${named.grade}, ${named.score} of 100`,
      rubricVersion: literacy.provenance.rubricVersion,
      companyGrade: literacy.company?.showGrade ? literacy.company.grade : null,
      companyScore: literacy.company?.showGrade ? literacy.company.score : null,
      text: literacy.company?.showGrade
        ? `Grade ${named.grade} (${named.score}/100) against the sampled organization's `
          + `${literacy.company.grade} (${literacy.company.score}/100), both on `
          + `${literacy.provenance.rubricVersion}.`
        : `Grade ${named.grade} (${named.score}/100) on ${literacy.provenance.rubricVersion}. `
          + "No organization-wide roll-up is published for this sample.",
      // Stated, not implied: there is no peer cohort on this path and a reader
      // must not read the roll-up above as an external comparison.
      rule: "The comparator is this sample's own roll-up on the published rubric. No peer cohort "
        + "is read, and no cost is stated: a query sample carries no money.",
      coverageText: literacy.company?.rule ?? null,
    }),
    confidence,
    provenance,
    action: Object.freeze({
      available: true,
      title: gap.signalLabel
        ? `Run a prompt clinic with ${named.department} on ${gap.signalLabel}.`
        : `Review ${named.department}'s query mix with its lead.`,
      detail: gap.text ?? `${named.department} carries the lowest published letter in this sample.`,
      basis: gap.signalLabel
        ? `${plural(gap.numerator ?? 0, "classified query", "classified queries")} of `
          + `${gap.denominator ?? named.prompts.classified} show weak ${gap.signalLabel}, worth `
          + `${gap.impact} recoverable prompt-points.`
        : "Ranked by letter only; no single signal carried the gap.",
      // The one figure this surface will not invent. Every money claim on this
      // page comes from a provider export, and this path has none.
      money: "No savings figure is stated. This sample carries no cost, and none is apportioned "
        + "from token counts.",
    }),
    disclosures,
    announcement: `${originPrefix(origin)} ${named.department} needs coaching first, `
      + `grade ${named.grade}, ${confidence.word.toLowerCase()}. ${gap.signalLabel
        ? `Prioritized action: prompt clinic on ${gap.signalLabel}.`
        : "Prioritized action: review the query mix with its lead."}`,
  });
}

function ungradeable(literacy, { confidence, provenance, disclosures, origin }) {
  const reason = UNGRADEABLE[literacy.reasonCode] ?? FALLBACK_UNGRADEABLE;
  return Object.freeze({
    version: ORG_QUERY_DECISION_VERSION,
    state: ORG_QUERY_DECISION_STATE.ungradeable,
    question: COACHING_QUESTION,
    origin,
    // The answer to the question is that it cannot be answered yet. Saying so in
    // the answer slot is the point: an empty slot reads as a page that broke.
    answer: "No department can be named yet.",
    reason: Object.freeze({ code: literacy.reasonCode, ...reason }),
    confidence,
    provenance,
    action: Object.freeze({
      available: false,
      title: reason.action,
      detail: reason.detail,
      basis: `${plural(literacy.prompts.total, "row", "rows")} read, `
        + `${literacy.prompts.classified} classified, across `
        + `${plural(literacy.summary.orgUnitCount, "organization unit", "organization units")}.`,
      money: "No savings figure is stated, and none would be even with a grade: this sample "
        + "carries no cost.",
    }),
    disclosures,
    announcement: `${originPrefix(origin)} ${reason.label} ${reason.action}`,
  });
}

const originPrefix = (origin) => (origin === "example"
  ? "Bundled synthetic example graded."
  : "Your imported query sample was read.");

function confidenceOf(literacy) {
  const level = literacy.confidence?.level ?? "low";
  const words = CONFIDENCE_WORDS[level] ?? CONFIDENCE_WORDS.low;
  const factors = literacy.confidence?.factors ?? [];
  // The capping factor, named. "Medium confidence" with three factors listed
  // below it makes a reader find the weak one; this hands it to them.
  const capping = factors.find((factor) => factor.level === level) ?? null;
  return Object.freeze({
    level,
    word: words.word,
    shape: words.shape,
    rule: literacy.confidence?.rule ?? "the weakest of the three factors, never their average",
    cappedBy: capping ? FACTOR_LABELS[capping.key] ?? capping.key : null,
    text: capping
      ? `${words.word}, capped by ${(FACTOR_LABELS[capping.key] ?? capping.key).toLowerCase()}: `
        + capping.detail
      : `${words.word}. No factor was measured for this sample.`,
    factors: Object.freeze(factors.map((factor) => Object.freeze({
      key: factor.key,
      label: FACTOR_LABELS[factor.key] ?? factor.key,
      level: factor.level,
      capping: factor === capping,
      detail: factor.detail,
    }))),
  });
}

function provenanceOf(literacy, origin, fileNames) {
  const source = literacy.sources?.[0] ?? null;
  // File names are OS-controlled input too. The page import path normalizes them
  // before parsing, but this public selector also gets called directly by tests
  // and other views. Keep the boundary here as well so bidi controls cannot make
  // a provenance label visually lie about an extension.
  const files = (Array.isArray(fileNames) ? fileNames : [])
    .filter((name) => name !== null && name !== undefined && String(name).trim())
    .map((name) => safeDisplayFileName(name));
  return Object.freeze({
    label: origin === "example"
      ? "Bundled synthetic organizational query sample"
      : `Your file, read in this tab — ${source?.sourceLabel ?? "organizational query sample"}`,
    detail: `${literacy.provenance.registryContract ?? "org-query-source"} · `
      + `${literacy.provenance.scorerVersion} · ${literacy.provenance.rubricVersion} · `
      + `${literacy.provenance.classifierVersion} · digest ${literacy.provenance.inputDigest}`,
    digest: literacy.provenance.inputDigest,
    files: Object.freeze(files),
    local: "Parsed, classified, and graded in this browser tab. Nothing was uploaded and nothing "
      + "is stored.",
  });
}

function disclosuresOf(literacy) {
  const rows = Object.freeze({
    [DISCLOSURE_IDS.mix]: mixRows(literacy),
    [DISCLOSURE_IDS.evidence]: evidenceRows(literacy),
    [DISCLOSURE_IDS.sampling]: samplingRows(literacy),
    [DISCLOSURE_IDS.redaction]: redactionRows(literacy),
  });
  const counts = Object.freeze({
    [DISCLOSURE_IDS.mix]: `${literacy.prompts.classified} classified`,
    [DISCLOSURE_IDS.evidence]: plural(literacy.departments.length, "department", "departments"),
    [DISCLOSURE_IDS.sampling]: plural((literacy.confidence?.factors ?? []).length,
      "limit", "limits"),
    [DISCLOSURE_IDS.redaction]: `${ORG_CLASSIFIED_RECORD_KEYS.length} fields read`,
  });
  return Object.freeze(DISCLOSURE_ORDER.map((entry) => Object.freeze({
    id: entry.id,
    question: entry.question,
    chip: counts[entry.id],
    rows: rows[entry.id],
  })));
}

/** The query mix: the rubric's own categories over classified records. */
function mixRows(literacy) {
  const classified = literacy.prompts.classified;
  const rows = (literacy.mix ?? []).map((entry) => Object.freeze({
    term: entry.label,
    detail: classified > 0
      ? `${percent(entry.share)} — ${plural(entry.count, "classified query", "classified queries")}`
      : `Not measured — no classified query in this sample`,
  }));
  return Object.freeze([...rows, Object.freeze({
    term: "Not classified",
    detail: `${plural(literacy.prompts.unclassified, "row", "rows")} carried neither a declared `
      + `category nor an excerpt the local classifier would place. They stay in each unit's `
      + `denominator and are never guessed at. ${literacy.prompts.declared} of the classified `
      + `rows carried a category the source itself declared.`,
  })]);
}

/** Every unit, graded or not, with what its reading rests on. No prompt text. */
function evidenceRows(literacy) {
  if (!literacy.departments.length) {
    return Object.freeze([Object.freeze({
      term: "No organization unit",
      detail: "No row in this sample carried an organization unit, so there is nothing to "
        + "attribute a reading to.",
    })]);
  }
  return Object.freeze(literacy.departments.map((row) => Object.freeze({
    term: row.department,
    detail: row.gradeable
      ? `Grade ${row.grade}, ${row.score}/100 · ${row.prompts.classified} of `
        + `${row.prompts.total} rows classified (${percent(row.coverage)}) · weakest signal `
        + `${row.driver?.label ?? "none in the recoverable set"}`
      : `Not graded — ${row.reasonText ?? "no reason published"} `
        + `(${row.prompts.classified} of ${row.prompts.total} rows classified)`,
    gradeable: row.gradeable === true,
  })));
}

/** What this sample cannot support, said before a reader over-reads it. */
function samplingRows(literacy) {
  const summary = literacy.summary ?? {};
  const factors = (literacy.confidence?.factors ?? []).map((factor) => Object.freeze({
    term: `${FACTOR_LABELS[factor.key] ?? factor.key} — ${factor.level}`,
    detail: factor.detail,
  }));
  return Object.freeze([
    ...factors,
    Object.freeze({
      term: "Sample size",
      detail: `${plural(summary.recordCount ?? 0, "row", "rows")} across `
        + `${plural(summary.orgUnitCount ?? 0, "organization unit", "organization units")} and `
        + `${plural(summary.bucketCount ?? 0, "day bucket", "day buckets")}`
        + `${summary.buckets?.length ? ` (${summary.buckets[0]} to `
          + `${summary.buckets[summary.buckets.length - 1]})` : ""}.`,
    }),
    Object.freeze({
      term: "Two floors, on purpose",
      detail: `A letter is published at ${literacy.provenance.letterFloor} classified queries in `
        + `a unit; ${literacy.provenance.publishableFloor} is the floor this page calls `
        + "publishable to an executive. Showing a unit its own reading and putting that reading "
        + "in a board pack are different acts with different costs of being wrong.",
    }),
    Object.freeze({
      term: "What it cannot answer",
      detail: "No cost, no trend, and no peer comparison. This sample carries token counts and "
        + "categories, so a spend figure would be apportioned rather than measured, and no "
        + "equal-length previous period is read.",
    }),
  ]);
}

/** The redaction boundary and the versions, as rows a reader can check. */
function redactionRows(literacy) {
  return Object.freeze([
    Object.freeze({
      term: "Prompt text",
      detail: literacy.redaction?.statement ?? ORG_QUERY_REDACTION_STATEMENT,
    }),
    Object.freeze({
      term: "Fields carried past the classifier",
      detail: `${(literacy.redaction?.classifiedRecordKeys ?? ORG_CLASSIFIED_RECORD_KEYS)
        .join(", ")}. There is no ninth field, and none of these can be read back toward a `
        + "sentence somebody typed.",
    }),
    Object.freeze({ term: "Basis", detail: literacy.provenance.basis }),
    Object.freeze({
      term: "Versions",
      detail: `${literacy.provenance.registryContract ?? "org-query-source"} · `
        + `${literacy.provenance.scorerVersion} · ${literacy.provenance.rubricVersion} · `
        + `${literacy.provenance.classifierVersion}`,
    }),
    Object.freeze({
      term: "Input digest",
      detail: `${literacy.provenance.inputDigest} — a handle, not a security primitive. Two `
        + "people disputing a grade compare digests and learn in one line whether they are "
        + "arguing about the same sample.",
    }),
    Object.freeze({
      term: "Where it ran",
      detail: "Every step above ran in this browser tab. No credential was used, no service was "
        + "contacted, nothing was uploaded, and nothing was written to browser storage.",
    }),
  ]);
}
