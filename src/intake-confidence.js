// Deterministic confidence for a normalized provider export. This module sees
// only the validated envelope and aggregate intake evidence: never file text,
// prompt content, raw cells, a clock, storage, or a network connection.

export const INTAKE_CONFIDENCE_VERSION = "intake-confidence/1.0.0";

// Factor definitions, stated so two engineers compute the same number:
// fieldCoverage = present required snapshot keys plus present required record
// keys, over the same slots counted across every record; declared period
// completeness = 1 when the provider declares "complete" with no omitted
// records and no issues, else 0.5 — it grades what the export *attests*, since
// a client holding one export cannot know which rows a provider withheld;
// attributionReadiness = records carrying a non-blank org_unit_id over all
// records; parseClarity = analyzed rows over source rows, or 1 when a validated
// JSON envelope had no detector or skipped-row path to be ambiguous about.
// Weight assumptions (sum = 100): field coverage is 35 because missing billing
// dimensions can change every downstream total; declared period completeness and
// attribution readiness are 25 each because each can invalidate a decision but
// neither changes the parsed spend itself; parse ambiguity is 15 because a
// reviewed mapping can repair it. Threshold assumptions: A >= 90 means no
// material weakness, B >= 75 supports review with a disclosed limitation,
// C >= 60 needs remediation, and D is not decision-ready. These are product
// confidence bands, not provider or industry benchmarks.
export const INTAKE_CONFIDENCE_RUBRIC = Object.freeze({
  weights: Object.freeze({ fieldCoverage: 35, periodCompleteness: 25,
    attributionReadiness: 25, parseClarity: 15 }),
  thresholds: Object.freeze([
    Object.freeze({ floor: 90, grade: "A", label: "Decision-ready" }),
    Object.freeze({ floor: 75, grade: "B", label: "Reviewable with limitations" }),
    Object.freeze({ floor: 60, grade: "C", label: "Remediation required" }),
    Object.freeze({ floor: 0, grade: "D", label: "Low confidence" }),
  ]),
});

const REQUIRED_SNAPSHOT = Object.freeze([
  "source_instance_id", "sequence", "generated_at", "period_start", "period_end",
  "completeness", "omitted_record_count", "issues",
]);
const REQUIRED_RECORD = Object.freeze([
  "usage_date", "org_unit_id", "provider", "service_category", "usage", "cost",
]);
const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().startsWith(value);
};
const ratio = (part, whole) => whole > 0 ? part / whole : 0;
const round = (value) => Math.round(value * 1000) / 1000;
const percent = (value) => `${Math.round(value * 100)}%`;

function provenanceOf(origin) {
  return origin === "bundled_example"
    ? Object.freeze({ kind: "bundled_example", label: "Bundled synthetic example" })
    : Object.freeze({ kind: "locally_selected_file", label: "Locally selected file" });
}

// A non-score, not a low score: when the envelope contradicts itself there is no
// honest denominator to grade against, so the surface says what was rejected and
// what to re-export rather than publishing a number nobody should act on.
function notScored({ provenance, status, benchmark, reason, remediation, period = null }) {
  return Object.freeze({
    version: INTAKE_CONFIDENCE_VERSION, status, score: null, grade: "Not scored",
    benchmark, provenance, period,
    explanation: `Intake confidence was not scored: ${reason} Coverage was not calculated.`,
    remediation, components: Object.freeze([]),
  });
}

const invalidPeriod = (provenance, reason) => notScored({
  provenance, status: "invalid_period", reason,
  benchmark: "Valid ascending period bounds required before scoring",
  remediation: "Re-export with parseable period_start and period_end values where period_end is after period_start.",
});

/** Score a normalized provider envelope. Identical values produce identical output. */
export function scoreIntakeConfidence({ document, importEvidence = null,
  origin = "locally_selected_file" } = {}) {
  const provenance = provenanceOf(origin);
  const start = document?.snapshot?.period_start;
  const end = document?.snapshot?.period_end;
  if (!validDate(start) || !validDate(end)) {
    return invalidPeriod(provenance, "period_start or period_end is missing or unparsable.");
  }
  if (end <= start) {
    return invalidPeriod(provenance, "period_end is not after period_start.");
  }

  const period = `${start} to ${end}`;
  const records = Array.isArray(document?.records) ? document.records : [];
  // An export with no rows has nothing to grade: every ratio below would be
  // vacuous, and a vacuous 60/100 reads as "mostly fine" for a file that cannot
  // support any finding at all.
  if (records.length === 0) {
    return notScored({ provenance, status: "no_records", period,
      benchmark: "At least one spend record required before scoring",
      reason: "the export declares a period but carries no spend records.",
      remediation: "Re-export the period with its spend records included." });
  }
  // The one period claim a client can check without knowing what the provider
  // withheld: rows must sit inside the half-open period the export declares.
  const strays = records.filter((record) => !(record?.usage_date >= start && record.usage_date < end)).length;
  if (strays > 0) {
    return notScored({ provenance, status: "period_contradiction", period,
      benchmark: "Every record inside the declared half-open period required before scoring",
      reason: `${strays} of ${records.length} records fall outside the declared period ${period}.`,
      remediation: "Re-export so every record's usage_date sits inside the declared period, or correct the declared bounds." });
  }
  const snapshotPresent = REQUIRED_SNAPSHOT.filter((key) => document.snapshot?.[key] !== undefined).length;
  const recordPresent = records.reduce((sum, record) => sum
    + REQUIRED_RECORD.filter((key) => record?.[key] !== undefined).length, 0);
  const fieldCoverage = ratio(snapshotPresent + recordPresent,
    REQUIRED_SNAPSHOT.length + records.length * REQUIRED_RECORD.length);
  const periodCompleteness = document.snapshot.completeness === "complete"
    && document.snapshot.omitted_record_count === 0
    && Array.isArray(document.snapshot.issues) && document.snapshot.issues.length === 0 ? 1 : 0.5;
  const attributed = records.filter((record) => typeof record?.org_unit_id === "string"
    && record.org_unit_id.trim()).length;
  const attributionReadiness = ratio(attributed, records.length);
  // Native intake publishes source/analyzed counts. Validated JSON has no
  // detector or skipped-row path, so its contract validation is clarity 1.
  const sourceRows = Number(importEvidence?.rowCounts?.source);
  const analyzedRows = Number(importEvidence?.rowCounts?.analyzed);
  const parseClarity = Number.isFinite(sourceRows)
    ? ratio(Math.max(0, analyzedRows), Math.max(0, sourceRows)) : 1;
  const values = { fieldCoverage, periodCompleteness, attributionReadiness, parseClarity };
  const score = Math.round(Object.entries(INTAKE_CONFIDENCE_RUBRIC.weights)
    .reduce((sum, [key, weight]) => sum + values[key] * weight, 0));
  const band = INTAKE_CONFIDENCE_RUBRIC.thresholds.find(({ floor }) => score >= floor);
  const components = Object.freeze([
    ["Field coverage", "fieldCoverage"], ["Declared period completeness", "periodCompleteness"],
    ["Attribution readiness", "attributionReadiness"], ["Parse clarity", "parseClarity"],
  ].map(([label, key]) => Object.freeze({ label, value: round(values[key]),
    weight: INTAKE_CONFIDENCE_RUBRIC.weights[key] })));
  const weakest = [...components].sort((a, b) => a.value - b.value || b.weight - a.weight
    || a.label.localeCompare(b.label))[0];
  const remedies = {
    "Field coverage": "Re-export with every required billing metadata and record field present.",
    "Declared period completeness": "Re-export after the provider marks the period complete with no omissions or issues.",
    "Attribution readiness": "Add a stable provider grouping value to every spend row, then export again.",
    "Parse clarity": "Correct or confirm the column mapping so every source row is analyzed.",
  };
  return Object.freeze({
    version: INTAKE_CONFIDENCE_VERSION, status: "scored", score, grade: band.grade,
    benchmark: `${band.label} · grade ${band.grade} begins at ${band.floor}/100`, provenance, period,
    explanation: `Score ${score}/100: ${components.map((item) =>
      `${item.label} ${percent(item.value)} × ${item.weight}%`).join("; ")}.`,
    // A top score must not read as "verified". Period completeness is the
    // provider's own claim, so the one line an executive reads when nothing is
    // flagged is the line that has to say what was never checked.
    remediation: weakest.value === 1
      ? "No intake remediation is prioritized. Period completeness is the provider's own declaration and was not independently verified."
      : remedies[weakest.label],
    components,
  });
}
