// Wawalu Evolution — AI FinOps and efficacy scoring.
//
// Pure, dependency-free scoring and aggregation for the executive view. All
// rendering lives in evolution-page.js so these rules stay unit-testable and
// so the grading model can be argued about in review without touching the DOM.
//
// Demo boundary (PRODUCT.md): this module never sees prompt text. It consumes
// pre-aggregated category counts produced upstream by the scoring pipeline, so
// no customer content, credential, or PII can reach the browser. `redactForScoring`
// documents the redaction contract the future gateway must satisfy before a
// prompt is shown to any judge model.

/** The four query classes from the product brief, in cost-severity order. */
export const QUERY_CATEGORIES = [
  {
    key: "highValue",
    label: "High-value",
    description: "Well-structured, context-rich engineering and analytical prompts.",
    systemAction: "Counted as productive spend; raises the team literacy score.",
    // Fraction of this slice's spend that is realistically recoverable.
    recoverableShare: 0,
    // Credit toward the literacy score, 0–100.
    scoreWeight: 100,
    tone: "good",
  },
  {
    key: "overProvisioned",
    label: "Over-provisioned",
    description: "Simple tasks — formatting, renaming, boilerplate — sent to a frontier model.",
    // Down-routing recovers most, not all, of the slice: a cheaper model still bills.
    systemAction: "Candidate for automated down-routing to a cheaper model.",
    recoverableShare: 0.7,
    scoreWeight: 55,
    tone: "warn",
  },
  {
    key: "inefficient",
    label: "Inefficient",
    description: "Repeated, chained re-prompts that circle the same unanswered question.",
    // Training compresses the retry chain; it does not remove the underlying task.
    systemAction: "Surfaced as a training gap for that team.",
    recoverableShare: 0.4,
    scoreWeight: 35,
    tone: "warn",
  },
  {
    key: "outOfScope",
    label: "Out-of-scope",
    description: "Non-business queries: hobbies, personal errands, nonsense.",
    systemAction: "Tagged as cost leakage and excluded from productivity metrics.",
    recoverableShare: 1,
    scoreWeight: 0,
    tone: "bad",
  },
];

const CATEGORY_KEYS = QUERY_CATEGORIES.map((category) => category.key);
const GRADES = [[90, "A"], [80, "B"], [70, "C"], [60, "D"]];

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * Coerce a raw mix into four non-negative shares that sum to 1.
 *
 * Upstream counts arrive from independent judge batches, so they routinely
 * arrive as raw counts, drift a fraction of a percent from 1, or omit a
 * category entirely. Normalizing here keeps every downstream number — score,
 * recoverable spend, chart width — consistent with a single denominator.
 */
export function normalizeMix(mix = {}) {
  const values = CATEGORY_KEYS.map((key) => toFiniteNumber(mix[key]));
  const total = values.reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(CATEGORY_KEYS.map((key, index) => [
    key,
    total === 0 ? 0 : values[index] / total,
  ]));
}

/** Weighted 0–100 AI literacy score for a normalized or raw mix. */
export function literacyScore(mix) {
  const shares = normalizeMix(mix);
  const score = QUERY_CATEGORIES.reduce(
    (sum, category) => sum + shares[category.key] * category.scoreWeight, 0,
  );
  return Math.round(score);
}

/** Letter grade for a 0–100 score, so the headline reads in one glance. */
export function letterGrade(score) {
  const value = Number.isFinite(Number(score)) ? Number(score) : 0;
  return GRADES.find(([floor]) => value >= floor)?.[1] ?? "F";
}

/** Spend attributable to one category, in whole dollars. */
export function categorySpendUsd(department, key) {
  const shares = normalizeMix(department?.mix);
  return Math.round(toFiniteNumber(department?.spendUsd) * (shares[key] ?? 0));
}

/**
 * Spend a CTO could plausibly reclaim: leakage in full, plus the recoverable
 * share of each remediable category. Deliberately conservative — an executive
 * number that oversells the saving loses the room the first time finance checks.
 */
export function recoverableSpendUsd(department) {
  const shares = normalizeMix(department?.mix);
  const spend = toFiniteNumber(department?.spendUsd);
  const recoverable = QUERY_CATEGORIES.reduce(
    (sum, category) => sum + shares[category.key] * category.recoverableShare, 0,
  );
  return Math.round(spend * recoverable);
}

/** High-value queries delivered per $1,000 of AI spend — the value-per-dollar metric. */
export function valuePerThousandUsd(department) {
  const spend = toFiniteNumber(department?.spendUsd);
  if (spend === 0) return 0;
  const highValue = toFiniteNumber(department?.queries) * normalizeMix(department?.mix).highValue;
  return Math.round((highValue / spend) * 1000);
}

/** Where a team sits against its external cohort. */
export function quartileLabel(percentile) {
  const value = Number(percentile);
  if (!Number.isFinite(value)) return "Unranked";
  if (value >= 75) return "Top quartile";
  if (value >= 50) return "Second quartile";
  if (value >= 25) return "Third quartile";
  return "Bottom quartile";
}

/**
 * The single highest-cost problem for a team, and the action that addresses it.
 *
 * A score with no next step is a number an executive cannot act on, so every
 * graded row carries exactly one recommendation, chosen by dollars lost rather
 * than by share — a small team with a bad ratio should not outrank a large team
 * quietly burning ten times as much.
 */
export function recommendationFor(department) {
  const remediable = QUERY_CATEGORIES.filter((category) => category.recoverableShare > 0);
  const ranked = remediable
    .map((category) => ({
      category,
      lostUsd: Math.round(categorySpendUsd(department, category.key) * category.recoverableShare),
    }))
    .sort((first, second) => second.lostUsd - first.lostUsd);
  const top = ranked[0];
  if (!top || top.lostUsd <= 0) {
    return {
      key: "healthy",
      headline: "No material waste detected",
      action: "Hold as the internal reference team for prompt practice.",
      lostUsd: 0,
    };
  }
  // Leakage is fully recoverable and often the largest single line, so it stays
  // in the ranking — but no prompt technique fixes it. It gets a policy action,
  // never coaching, or the recommendation blames the team for the wrong thing.
  const actions = {
    overProvisioned: "Enable automated down-routing for short, low-context prompts.",
    inefficient: `Recommend a prompt engineering workshop for ${department?.name ?? "this team"}.`,
    outOfScope: "Apply acceptable-use routing so personal queries leave the enterprise plan.",
  };
  return {
    key: top.category.key,
    headline: `${top.category.label} spend is the largest recoverable line`,
    action: actions[top.category.key] ?? top.category.systemAction,
    lostUsd: top.lostUsd,
  };
}

/** Roll departments up into the numbers the C-suite header answers with. */
export function summarize(departments = []) {
  const list = Array.isArray(departments) ? departments : [];
  const spendUsd = list.reduce((sum, department) => sum + toFiniteNumber(department.spendUsd), 0);
  const recoverableUsd = list.reduce((sum, department) => sum + recoverableSpendUsd(department), 0);
  const queries = list.reduce((sum, department) => sum + toFiniteNumber(department.queries), 0);
  const headcount = list.reduce((sum, department) => sum + toFiniteNumber(department.headcount), 0);

  // Spend-weighted, not team-weighted: a five-person team with a perfect score
  // must not mask the largest budget in the organization.
  const weighted = list.reduce(
    (sum, department) => sum + literacyScore(department.mix) * toFiniteNumber(department.spendUsd), 0,
  );
  const score = spendUsd === 0 ? 0 : Math.round(weighted / spendUsd);

  const mix = Object.fromEntries(CATEGORY_KEYS.map((key) => [
    key,
    list.reduce((sum, department) => sum + categorySpendUsd(department, key), 0),
  ]));

  return {
    spendUsd, recoverableUsd, queries, headcount, score,
    grade: letterGrade(score),
    mix: normalizeMix(mix),
    recoverableShare: spendUsd === 0 ? 0 : recoverableUsd / spendUsd,
    departments: list.length,
  };
}

/** Departments ordered by the metric an executive is scanning for. */
export function rankDepartments(departments = [], key = "recoverableUsd") {
  const metrics = {
    recoverableUsd: recoverableSpendUsd,
    spendUsd: (department) => toFiniteNumber(department.spendUsd),
    score: (department) => literacyScore(department.mix),
    valuePerThousandUsd,
  };
  const metric = metrics[key] ?? metrics.recoverableUsd;
  // Ascending for score: the teams that need help belong at the top of the list.
  const direction = key === "score" ? 1 : -1;
  return [...(Array.isArray(departments) ? departments : [])]
    .sort((first, second) => direction * (metric(first) - metric(second)));
}

/**
 * The redaction contract: a prompt must survive this transform before any judge
 * model, log line, or score record sees it.
 *
 * Quality signals the judge needs — length, structure, whether the prompt names
 * constraints and acceptance criteria — survive redaction. Identity, secrets,
 * and proprietary identifiers do not. Placeholders keep their shape so the judge
 * can still tell "one email address" from "a pasted customer table".
 */
export function redactForScoring(text = "") {
  return String(text)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/\b(?:sk|pk|ghp|ghs|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/g, "[secret]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi, "[secret]")
    .replace(/\bhttps?:\/\/\S+/g, "[url]")
    // Anchored on a digit at both ends so the separator after the final group is
    // not swallowed — otherwise the redacted prompt loses the word break.
    .replace(/\b\d(?:[ -]?\d){12,18}\b/g, "[card]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[id]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]");
}

export function formatUsd(value, { compact = false } = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
    ...(compact ? { notation: "compact", maximumFractionDigits: 1 } : {}),
  }).format(amount);
}

export function formatPercent(share, { digits = 0 } = {}) {
  const value = Number(share);
  if (!Number.isFinite(value)) return "0%";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(number);
}
