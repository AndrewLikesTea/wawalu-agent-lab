// Import evidence, composed for a decision (#931). Pure and side-effect free:
// parsed exports in, one ordered finding per export out. No DOM, no network, no
// storage, no clock, no locale-sensitive formatting, and no randomness, so the
// same export produces the same finding — and the same reading order — on every
// run.
//
// This module composes what already exists rather than re-deciding it. The score
// and its evidence come from export-recognition.js (#928); the provider shapes
// come from browser-compat-contracts.js (#927); the fixtures come from
// export-recognition-fixtures.js. What is new here is the ORDER a reader meets
// the parts in, and the two parts a recognition result does not carry:
//
//   provider → confidence → benchmark → impact → provenance → action
//
// Impact and action are the two the surface makes largest, so they are computed
// here rather than left to the view: money at stake is the reason a reader is
// on this page, and the action is what they leave with.
//
// Nothing in a finding is a string that came out of a reader's file. Every value
// below is an integer count, a literal in this module, contract-published
// vocabulary, or a number parsed out of the contract-declared cost column.

import { BROWSER_COMPAT_MANIFEST, FIELD_ROLES } from "./browser-compat-contracts.js";
import {
  ACCEPTED_MIN_CONFIDENCE, MAX_CONFIDENCE, RECOGNITION_BANDS,
  recognizeExport, redactFileToken,
} from "./export-recognition.js";
import { RECOGNITION_FIXTURES, recognitionFixtureById } from "./export-recognition-fixtures.js";

/** The three statuses a reader has to be able to sort a list by, and no more. */
export const EVIDENCE_STATUS = Object.freeze({
  TRUSTED: "trusted",
  AMBIGUOUS: "ambiguous",
  REJECTED: "rejected",
});

/**
 * How each status is drawn when colour is not available: a word, a glyph, and a
 * silhouette. The silhouette rule is the one in
 * design-system/claude-design/review-08-foundations.html — a filled wash is a
 * dynamic signal, an outline is a static classification. A status is measured
 * from the file every time it is read, so all three are washes; the chip that
 * classifies where a finding CAME FROM is the outline one, below.
 *
 * The glyphs are distinct silhouettes rather than three tints of one mark: a
 * disc, a half-filled disc, and a cross survive greyscale, print, and a
 * monochrome display, which is the whole point of carrying them.
 */
export const STATUS_PRESENTATION = Object.freeze({
  [EVIDENCE_STATUS.TRUSTED]: Object.freeze({
    label: "Trusted", shape: "●", silhouette: "wash",
    meaning: "Recognized against a published contract and usable as it is.",
  }),
  [EVIDENCE_STATUS.AMBIGUOUS]: Object.freeze({
    label: "Ambiguous", shape: "◐", silhouette: "wash",
    meaning: "Recognized, but not settled enough to use until the action below is done.",
  }),
  [EVIDENCE_STATUS.REJECTED]: Object.freeze({
    label: "Rejected", shape: "✕", silhouette: "wash",
    meaning: "Not usable here. Nothing from this file reaches the briefing.",
  }),
});

/** The source class chip: a static classification, so an outline. */
export const SOURCE_PRESENTATION = Object.freeze({
  example: Object.freeze({ label: "Bundled example", shape: "◇", silhouette: "outline" }),
  file: Object.freeze({ label: "Your file", shape: "▣", silhouette: "outline" }),
});

/** The reading order, in the DOM and therefore in the tab and print order. */
export const FINDING_ORDER = Object.freeze([
  "provider", "confidence", "benchmark", "impact", "provenance", "action",
]);

/** The two parts that have to survive a squint test. Asserted, not assumed. */
export const EMPHASIZED_PARTS = Object.freeze(["impact", "action"]);

/** Every state the surface draws. `loading` and `empty` are states, not blanks. */
export const EVIDENCE_STATE = Object.freeze({
  LOADING: "loading",
  EMPTY: "empty",
  PARTIAL: "partial",
  COMPLETE: "complete",
  ERROR: "error",
});

/** What a status announcement is about, so a caller can branch on it. */
export const ANNOUNCEMENT_KIND = Object.freeze({
  LOADING: "loading",
  EMPTY: "empty",
  COMPLETE: "complete",
  PARTIAL: "partial",
  REJECTED: "rejected",
  ERROR: "error",
});

// ASSUMPTION: one period export over a million in billing currency is outside
// anything the bundled examples describe and outside most single-period AI
// spend. It is not refused and not hidden — the reader may genuinely have it —
// it is marked so the layout can give the digits their own line rather than
// letting them push the action off the side of a narrow screen.
export const OUTSIZED_IMPACT_MINIMUM = 1000000;

export const IMPACT_SCALE = Object.freeze({
  UNKNOWN: "unknown", CREDIT: "credit", ZERO: "zero", ORDINARY: "ordinary", OUTSIZED: "outsized",
});

/**
 * The bundled set the import panel draws with no file chosen.
 *
 * Five, chosen so the shipped page shows the PARTIAL state rather than the one
 * that demos well: two providers that are usable as they are, one that is
 * recognized but contested, one that carries conversation bodies and is refused,
 * and one file no published contract claims at all. A reader meets the mixed
 * outcome before they have anything at stake in it.
 */
export const DEMO_IMPORT_SET = Object.freeze([
  "bedrock-recognized", "vertex-ai-recognized", "azure-openai-ambiguous",
  "bedrock-incompatible", "none-incompatible",
]);

// ---------------------------------------------------------------- formatting

const GROUPED = /\B(?=(\d{3})+(?!\d))/g;

/**
 * A grouped, two-decimal figure with no currency symbol and no locale lookup.
 *
 * No symbol on purpose: the currency CODE in a provider export is a cell of the
 * reader's file, and this module never paints a cell. The label beside the
 * figure names it as the export's own billing currency instead of claiming a
 * currency this code cannot verify.
 */
export function formatImpactAmount(value) {
  if (!Number.isFinite(value)) return "not computed";
  const fixed = Math.abs(value).toFixed(2);
  const [whole, cents] = fixed.split(".");
  return `${value < 0 ? "−" : ""}${whole.replace(GROUPED, ",")}.${cents}`;
}

const scaleOf = (amount) => {
  if (!Number.isFinite(amount)) return IMPACT_SCALE.UNKNOWN;
  if (amount < 0) return IMPACT_SCALE.CREDIT;
  if (amount === 0) return IMPACT_SCALE.ZERO;
  return amount >= OUTSIZED_IMPACT_MINIMUM ? IMPACT_SCALE.OUTSIZED : IMPACT_SCALE.ORDINARY;
};

// ---------------------------------------------------------------- composition

const contractFor = (providerId) => BROWSER_COMPAT_MANIFEST.contracts
  .find((entry) => entry.providerId === providerId) ?? null;

const pathForRole = (contract, role) =>
  contract?.requiredFields.find((field) => field.role === role)?.path ?? null;

const numeric = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim();
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

const statusFor = (band) => {
  if (band === RECOGNITION_BANDS.ACCEPTED) return EVIDENCE_STATUS.TRUSTED;
  if (band === RECOGNITION_BANDS.ATTENTION) return EVIDENCE_STATUS.AMBIGUOUS;
  return EVIDENCE_STATUS.REJECTED;
};

const IMPACT_EFFECT = Object.freeze({
  [EVIDENCE_STATUS.TRUSTED]: "enters the briefing",
  [EVIDENCE_STATUS.AMBIGUOUS]: "waits on the action below",
  [EVIDENCE_STATUS.REJECTED]: "stays out of the briefing",
});

/** The money the finding puts at stake, summed from the contract's cost column. */
function impactOf(status, contract, records) {
  const path = pathForRole(contract, FIELD_ROLES.COST);
  const amounts = path ? records.map((record) => numeric(record?.[path])).filter((value) => value !== null) : [];
  const known = Boolean(path) && amounts.length > 0;
  const amount = known ? amounts.reduce((total, value) => total + value, 0) : null;
  const scale = scaleOf(known ? amount : NaN);
  const effect = IMPACT_EFFECT[status];
  return Object.freeze({
    known, amount, scale, rows: amounts.length,
    display: known ? formatImpactAmount(amount) : "Not computed",
    // A zero and a credit are figures, not absences, and each says so in its own
    // words: a blank here reads as "nothing at stake" for both.
    sentence: !known
      ? "No cost column was recognized in this file, so nothing can be said about the money in it."
      : scale === IMPACT_SCALE.ZERO
        ? `Nets to zero across ${amounts.length} priced records, so this export moves no money either way.`
        : scale === IMPACT_SCALE.CREDIT
          ? `A net credit across ${amounts.length} priced records, and it ${effect}.`
          : `Across ${amounts.length} priced records, and it ${effect}.`,
  });
}

/** How the score stands against the published bar for using an export as it is. */
function benchmarkOf(confidence) {
  const delta = confidence - ACCEPTED_MIN_CONFIDENCE;
  return Object.freeze({
    bar: ACCEPTED_MIN_CONFIDENCE, value: confidence, delta,
    display: `${confidence} against a bar of ${ACCEPTED_MIN_CONFIDENCE}`,
    sentence: delta >= 0
      ? `${delta} point${delta === 1 ? "" : "s"} clear of the published bar for using an export as it is.`
      : `${-delta} point${delta === -1 ? "" : "s"} short of the published bar for using an export as it is.`,
  });
}

/** Counts and contract vocabulary only — never a column name a reader invented. */
function provenanceOf(parsed, contract, impact) {
  const names = new Set((parsed?.fieldNames ?? []).map((name) => String(name)));
  const signature = contract?.exportShape.signatureFields ?? [];
  const matched = signature.filter((path) => names.has(path)).length;
  const rows = [
    { label: "Declared format", value: redactFileToken(String(parsed?.format ?? "")) },
    { label: "Columns in the file", value: String(names.size) },
    { label: "Records read", value: String((parsed?.records ?? []).length) },
    {
      label: "Signature columns matched",
      value: contract ? `${matched} of ${signature.length}` : "no contract matched",
    },
    { label: "Records carrying a parseable cost", value: String(impact.rows) },
    { label: "Contract matched", value: contract ? contract.providerId : "none" },
  ];
  return Object.freeze({
    rows: Object.freeze(rows.map((row) => Object.freeze(row))),
    count: rows.length,
  });
}

/**
 * One finding, in the order it is read.
 *
 * @param id          stable key for the finding, used for element ids.
 * @param label       what this export is, in the surface's own words.
 * @param sourceClass "example" or "file".
 * @param parsed      { ok, format, fieldNames, records } — the adapters' shape.
 * @param error       optional { message } when the file could not be read at all.
 */
export function buildImportFinding({ id, label, sourceClass = "example", parsed, error = null }) {
  const result = recognizeExport(parsed ?? { ok: false, fieldNames: [], records: [] });
  const status = error ? EVIDENCE_STATUS.REJECTED : statusFor(result.band);
  const contract = contractFor(result.providerId);
  const records = Array.isArray(parsed?.records) ? parsed.records : [];
  const impact = impactOf(status, contract, error ? [] : records);
  const matched = result.evidence.filter((entry) => entry.contribution > 0);
  const reasons = result.evidence.filter((entry) => entry.contribution <= 0);
  return Object.freeze({
    id: String(id),
    label: String(label),
    status,
    presentation: STATUS_PRESENTATION[status],
    source: SOURCE_PRESENTATION[sourceClass] ?? SOURCE_PRESENTATION.example,
    error: error ? Object.freeze({ message: String(error.message) }) : null,
    provider: Object.freeze({
      known: Boolean(result.displayName),
      // Named, never guessed: an unattributed file says so rather than being
      // filed under the nearest-looking provider.
      name: result.displayName ?? "No provider recognized",
    }),
    confidence: Object.freeze({
      known: !error,
      value: error ? 0 : result.confidence,
      max: MAX_CONFIDENCE,
      band: result.band,
      display: `${error ? 0 : result.confidence} of ${MAX_CONFIDENCE}`,
    }),
    benchmark: benchmarkOf(error ? 0 : result.confidence),
    impact,
    provenance: provenanceOf(parsed ?? {}, contract, impact),
    signals: Object.freeze({ matched: Object.freeze(matched), count: matched.length }),
    reasons: Object.freeze({ entries: Object.freeze(reasons), count: reasons.length }),
    // One action, never a menu, and never absent: an errored file's action is
    // what to do about the error.
    action: Object.freeze({
      sentence: error ? `${error.message} Choose the file again, or choose a different export.`
        : result.nextAction,
      required: status !== EVIDENCE_STATUS.TRUSTED,
    }),
  });
}

/** The rank an unattended list is read in: what needs a decision, by money. */
const STATUS_RANK = Object.freeze({
  [EVIDENCE_STATUS.AMBIGUOUS]: 0, [EVIDENCE_STATUS.REJECTED]: 1, [EVIDENCE_STATUS.TRUSTED]: 2,
});

/**
 * Findings in the order the reader should act on them: the ones still owed a
 * decision first, largest money at stake first inside each group, then the id so
 * the same set always paints in the same sequence.
 */
export function orderFindings(findings) {
  return [...findings].sort((left, right) => {
    const rank = STATUS_RANK[left.status] - STATUS_RANK[right.status];
    if (rank !== 0) return rank;
    const money = (right.impact.amount ?? -Infinity) - (left.impact.amount ?? -Infinity);
    if (Number.isFinite(money) && money !== 0) return money;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

/** The state of the whole surface, and the counts that justify it. */
export function summarizeImportEvidence(findings, { loading = false } = {}) {
  const counts = {
    total: findings.length,
    trusted: findings.filter((finding) => finding.status === EVIDENCE_STATUS.TRUSTED).length,
    ambiguous: findings.filter((finding) => finding.status === EVIDENCE_STATUS.AMBIGUOUS).length,
    rejected: findings.filter((finding) => finding.status === EVIDENCE_STATUS.REJECTED).length,
    errored: findings.filter((finding) => finding.error).length,
  };
  const state = loading ? EVIDENCE_STATE.LOADING
    : counts.total === 0 ? EVIDENCE_STATE.EMPTY
      : counts.errored > 0 ? EVIDENCE_STATE.ERROR
        : counts.trusted === counts.total ? EVIDENCE_STATE.COMPLETE
          : EVIDENCE_STATE.PARTIAL;
  return Object.freeze({ state, counts: Object.freeze(counts) });
}

/**
 * What the always-rendered status region says. One sentence with the counts in
 * it, so an announcement is useful without the list it describes — a screen
 * reader user hears the outcome, not "updated".
 */
export function announcementFor(summary, findings = []) {
  const { counts } = summary;
  const lead = orderFindings(findings)[0] ?? null;
  const next = lead?.action.required ? ` Next: ${lead.action.sentence}` : "";
  if (summary.state === EVIDENCE_STATE.LOADING) {
    return Object.freeze({
      kind: ANNOUNCEMENT_KIND.LOADING,
      text: "Scoring the selected exports. Findings appear here when the parse finishes.",
    });
  }
  if (summary.state === EVIDENCE_STATE.EMPTY) {
    return Object.freeze({
      kind: ANNOUNCEMENT_KIND.EMPTY,
      text: "No export was recognized, so there are no findings to read. "
        + "Choose an export that matches one of the published provider contracts.",
    });
  }
  if (summary.state === EVIDENCE_STATE.ERROR) {
    return Object.freeze({
      kind: ANNOUNCEMENT_KIND.ERROR,
      text: `Import finished with ${counts.errored} of ${counts.total} exports unreadable.${next}`,
    });
  }
  if (counts.trusted === 0) {
    return Object.freeze({
      kind: ANNOUNCEMENT_KIND.REJECTED,
      text: `Import finished. All ${counts.total} exports were rejected or left ambiguous, `
        + `so nothing has entered the briefing.${next}`,
    });
  }
  if (counts.trusted === counts.total) {
    return Object.freeze({
      kind: ANNOUNCEMENT_KIND.COMPLETE,
      text: `Import finished. All ${counts.total} exports are trusted and have entered the briefing.`,
    });
  }
  return Object.freeze({
    kind: ANNOUNCEMENT_KIND.PARTIAL,
    text: `Import finished. ${counts.trusted} of ${counts.total} exports are trusted; `
      + `${counts.ambiguous} ambiguous and ${counts.rejected} rejected.${next}`,
  });
}

/** The bundled findings the import panel paints before any file is chosen. */
export function buildDemoImportFindings() {
  return orderFindings(DEMO_IMPORT_SET.map((id) => {
    const fixture = recognitionFixtureById(id) ?? RECOGNITION_FIXTURES[0];
    return buildImportFinding({
      id: fixture.id, label: fixture.label, sourceClass: "example", parsed: fixture.parsed,
    });
  }));
}
