// Content-based provider detection for AI FinOps billing exports (#957). Pure
// and side-effect free: the text of one export in, one verdict out. No DOM, no
// network, no storage, no clock, no locale-sensitive comparison, and no
// randomness. The same text produces the same provider, the same confidence and
// the same reason on every run, in every tab, on every machine.
//
// WHY IT EXISTS: the import paths on /evolution.html each read ONE provider, and
// the reader had to name the provider before any of them would look at the file.
// A reader holding an export knows which console it came from and never knows
// which of our contracts it satisfies, so asking them to name it moves our
// problem onto them. This decides from the bytes.
//
// THE WHOLE RULE, so a verdict can be recomputed by hand from the file's header:
//   1. Empty or whitespace-only text is its own named failure. Nothing else runs.
//   2. Collect the file's column tokens: the header row of a delimited file, or
//      the object keys of a JSON or JSONL file. Both the full path and its last
//      segment are collected, so a declared `sku.model_id` matches a nested key
//      and a flat `model_id` column alike.
//   3. Score every provider in PROVIDER_ORDER — a fixed list, never iteration
//      over a map or a Set — with integer weights. A signature column is worth
//      more than a role column because it is what NAMES the provider.
//   4. AWS and Bedrock are adjudicated EXPLICITLY, by awsFamilyVerdict below. A
//      Bedrock export is a valid AWS Cost and Usage Report, so a score cannot
//      separate them and is not asked to.
//   5. The winner is the highest confidence; equal confidences resolve by
//      PROVIDER_ORDER position, which is the documented tie rule. A winner that
//      has not cleared the runner-up by AMBIGUITY_MARGIN is not a winner — that
//      is the ambiguous failure, reported with the candidate it could not beat.
//   6. EVERY failure names the closest candidate and its score, so a reader
//      learns which importer their file is nearest to rather than only that it
//      was refused.
//
// Nothing here throws for an unrecognized file: an unrecognized file is an
// ordinary return value carrying `provider: null` and a named reason.

import { FIELD_ROLES, contractById } from "./browser-compat-contracts.js";

/**
 * The enumerated failure codes, in one place. A caller switches on these; the
 * message beside them is for a human and is not a stable interface.
 */
export const DETECTION_CODES = Object.freeze({
  DETECTED: "provider_detected",
  EMPTY_EXPORT: "empty_export",
  NO_COST_COLUMN: "no_cost_column",
  NO_SIGNATURE_MATCH: "no_signature_match",
  AMBIGUOUS_PROVIDERS: "ambiguous_providers",
});

// ASSUMPTION: a signature column is worth twice a role column because it is the
// only thing that names a provider — a date, a cost and a currency column are
// carried by every billing export ever exported and identify nobody.
export const SIGNATURE_WEIGHT = 20;
export const ROLE_WEIGHT = 10;

// ASSUMPTION for 5: confidences are normalized to 0-100 out of a per-provider
// maximum, so five points is half a role column. Below that the two candidates
// are separated by less evidence than one column's presence, and picking either
// would be picking the order this file happens to list them in.
export const AMBIGUITY_MARGIN = 5;

// Token collection stops here. A billing export's header is in its first bytes;
// reading the whole of an eight-megabyte file to find it is unbounded work for
// no extra signal. Row counting still reads the whole file — that is one pass
// over lines, not a per-key scan.
export const SCAN_LIMIT = 262_144;

// ---------------------------------------------------------------- providers

const roleMap = (fields) => {
  const roles = {};
  for (const field of fields) if (!roles[field.role]) roles[field.role] = field.path;
  return Object.freeze(roles);
};

// The three published contracts are READ from the manifest rather than restated
// here, so a column name has exactly one home and a contract revision reaches
// this module without editing it.
const fromContract = (provider) => {
  const contract = contractById(provider);
  return Object.freeze({
    provider,
    displayName: contract.displayName,
    format: contract.exportShape.format,
    signature: contract.exportShape.signatureFields,
    roles: roleMap(contract.requiredFields),
  });
};

// The two providers with no published browser-compat contract are declared
// here, in the same shape. They are detected but NOT adapted: naming the file
// correctly and saying so is worth more to a reader than a silent no-match.
const AWS_COST_AND_USAGE = Object.freeze({
  provider: "aws",
  displayName: "AWS Cost and Usage Report",
  format: "csv",
  // The billing-period column is what a Cost and Usage Report carries and a
  // hand-cut Bedrock slice usually does not, so it is signature rather than role.
  signature: ["bill/BillingPeriodStartDate", "lineItem/UsageAccountId", "lineItem/UnblendedCost"],
  roles: Object.freeze({
    [FIELD_ROLES.TIMESTAMP]: "lineItem/UsageStartDate",
    // A generic report names a SERVICE, not a model: that is the whole reason
    // it is a different provider verdict from Bedrock below.
    [FIELD_ROLES.MODEL]: "lineItem/ProductCode",
    [FIELD_ROLES.UNITS]: "lineItem/UsageAmount",
    [FIELD_ROLES.COST]: "lineItem/UnblendedCost",
    [FIELD_ROLES.CURRENCY]: "lineItem/CurrencyCode",
    [FIELD_ROLES.SCOPE]: "lineItem/UsageAccountId",
  }),
});

const OPENAI_COSTS = Object.freeze({
  provider: "openai",
  displayName: "OpenAI",
  format: "csv",
  signature: ["organization_id", "amount_value"],
  roles: Object.freeze({
    [FIELD_ROLES.TIMESTAMP]: "timestamp",
    [FIELD_ROLES.MODEL]: "model",
    [FIELD_ROLES.UNITS]: "n_context_tokens_total",
    // A usage-only export carrying no amount column is deliberately a
    // no_cost_column failure rather than a low-confidence OpenAI verdict: there
    // is no money in it, so there is no FinOps answer to be had from it.
    [FIELD_ROLES.COST]: "amount_value",
    [FIELD_ROLES.CURRENCY]: "amount_currency",
    [FIELD_ROLES.SCOPE]: "project_id",
  }),
});

/**
 * The one ordered list. Detection iterates THIS and nothing else, so no verdict
 * can depend on object key order, Set insertion order, or the order the file
 * listed its columns in. The order is also the documented tie rule: the more
 * specific member of a family sits ahead of the general one, so a tie that
 * survives adjudication resolves towards the narrower reading.
 */
export const PROVIDER_ORDER = Object.freeze([
  fromContract("azure-openai"),
  fromContract("vertex-ai"),
  fromContract("bedrock"),
  AWS_COST_AND_USAGE,
  OPENAI_COSTS,
]);

export const DETECTABLE_PROVIDER_IDS = Object.freeze(PROVIDER_ORDER.map((entry) => entry.provider));

// The AWS/Bedrock discriminator, named so it can be argued with. A Cost and
// Usage Report sliced to Bedrock is a valid Cost and Usage Report, so the two
// are separated by ONE question with a yes/no answer rather than by which of
// them happened to score higher.
export const BEDROCK_MARKER_COLUMN = "product/model_id";
export const BEDROCK_MARKER_TOKEN = "bedrock";
const AWS_FAMILY = Object.freeze(["bedrock", "aws"]);

// ---------------------------------------------------------------- tokens

const lastSegment = (path) => String(path).split(/[./]/).pop().toLowerCase();

const DELIMITERS = Object.freeze([",", "\t", ";"]);

/** Fixed-order max: a tie between two delimiters resolves to the earlier one. */
function delimiterFor(line) {
  let best = DELIMITERS[0];
  let count = 0;
  for (const candidate of DELIMITERS) {
    const hits = line.split(candidate).length - 1;
    if (hits > count) {
      count = hits;
      best = candidate;
    }
  }
  return best;
}

const unquote = (cell) => cell.trim().replace(/^"(.*)"$/s, "$1").trim();

const nonEmptyLines = (text) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

/**
 * csv, tsv, jsonl or json, decided from the text and never from a file name.
 * The name is not an input to this module at all: a correct export saved under
 * the wrong extension is still a correct export.
 */
export function formatOf(text) {
  const lines = nonEmptyLines(text);
  if (!lines.length) return "";
  const first = lines[0];
  if (first.startsWith("{") || first.startsWith("[")) {
    return lines.length > 1 && lines.every((line) => line.startsWith("{")) ? "jsonl" : "json";
  }
  return delimiterFor(first) === "\t" ? "tsv" : "csv";
}

const JSON_KEY = /"([^"\\]{1,120})"\s*:/g;

/**
 * Every column token the file offers, lowercased, with each token's last path
 * segment added beside it. A Set is correct here BECAUSE nothing iterates it:
 * it is only ever asked whether it holds a declared name, and the declared
 * names are visited in PROVIDER_ORDER.
 */
export function columnTokens(text, format) {
  const scan = text.length > SCAN_LIMIT ? text.slice(0, SCAN_LIMIT) : text;
  const tokens = new Set();
  const add = (raw) => {
    const token = String(raw).trim().toLowerCase();
    if (!token) return;
    tokens.add(token);
    tokens.add(lastSegment(token));
  };
  if (format === "json" || format === "jsonl") {
    for (const match of scan.matchAll(JSON_KEY)) add(match[1]);
    return tokens;
  }
  const [header = ""] = nonEmptyLines(scan);
  for (const cell of header.split(delimiterFor(header))) add(unquote(cell));
  return tokens;
}

const holds = (tokens, path) =>
  tokens.has(String(path).toLowerCase()) || tokens.has(lastSegment(path));

// ---------------------------------------------------------------- scoring

const ROLE_ORDER = Object.freeze([
  FIELD_ROLES.TIMESTAMP, FIELD_ROLES.MODEL, FIELD_ROLES.UNITS,
  FIELD_ROLES.COST, FIELD_ROLES.CURRENCY, FIELD_ROLES.SCOPE,
]);

/**
 * One provider's score against one file. Integers throughout, summed in a fixed
 * order, so there is no accumulation whose result depends on visit order.
 */
function scoreProvider(entry, tokens) {
  const matchedSignature = entry.signature.filter((path) => holds(tokens, path));
  const columns = {};
  let matchedRoles = 0;
  for (const role of ROLE_ORDER) {
    const path = entry.roles[role] ?? null;
    const present = Boolean(path) && holds(tokens, path);
    columns[role] = present ? path : null;
    if (present) matchedRoles += 1;
  }
  const possible = entry.signature.length * SIGNATURE_WEIGHT + ROLE_ORDER.length * ROLE_WEIGHT;
  const score = matchedSignature.length * SIGNATURE_WEIGHT + matchedRoles * ROLE_WEIGHT;
  return Object.freeze({
    provider: entry.provider,
    displayName: entry.displayName,
    format: entry.format,
    score,
    possible,
    // One integer division of two integers, never a running float sum: the same
    // two integers produce the same quotient on every machine.
    confidence: Math.round((score * 100) / possible),
    matchedSignature: Object.freeze(matchedSignature),
    missingRoles: Object.freeze(ROLE_ORDER.filter((role) => !columns[role])),
    columns: Object.freeze(columns),
  });
}

/**
 * The AWS/Bedrock discriminator, in one place and covered by its own test.
 *
 * A file is Bedrock when it carries a per-model column — a Cost and Usage
 * Report has no model identity in it, that is the difference — or when the
 * Bedrock service token appears in its text, which is how a report sliced to
 * one service names that service in its own rows. Otherwise it is the general
 * report. The loser of this question is REMOVED from the candidates rather than
 * left to be beaten on points, so the ambiguity check below never sees a pair
 * that this rule has already settled.
 */
export function awsFamilyVerdict(tokens, text) {
  const markerColumn = holds(tokens, BEDROCK_MARKER_COLUMN);
  const markerToken = text.toLowerCase().includes(BEDROCK_MARKER_TOKEN);
  return Object.freeze({
    provider: markerColumn || markerToken ? "bedrock" : "aws",
    markerColumn,
    markerToken,
  });
}

// Confidence descending, then PROVIDER_ORDER position — never the input order,
// and never the sort's own stability. Equal confidences resolve to the earlier
// entry in PROVIDER_ORDER, which IS the documented tie rule.
function rank(candidates) {
  return [...candidates].sort((left, right) => {
    if (right.confidence !== left.confidence) return right.confidence - left.confidence;
    return DETECTABLE_PROVIDER_IDS.indexOf(left.provider)
      - DETECTABLE_PROVIDER_IDS.indexOf(right.provider);
  });
}

// ---------------------------------------------------------------- result

const REASONS = Object.freeze({
  [DETECTION_CODES.EMPTY_EXPORT]:
    "This file has no content: it is empty or contains only blank space, so there is no "
    + "header row and no column to read a provider from.",
  [DETECTION_CODES.NO_COST_COLUMN]:
    "No cost or amount column was found. Every supported provider's export names the money "
    + "in a column of its own, so a file without one cannot be read as billing data.",
  [DETECTION_CODES.NO_SIGNATURE_MATCH]:
    "No provider signature column was found. The file carries billing-shaped columns, but "
    + "none of the columns that identify which console the export came from.",
  [DETECTION_CODES.AMBIGUOUS_PROVIDERS]:
    "Two providers scored too close to separate. This file carries the identifying columns "
    + "of more than one export shape, so attributing it to either would be a guess.",
});

const closestOf = (candidate) => (candidate ? Object.freeze({
  provider: candidate.provider,
  displayName: candidate.displayName,
  score: candidate.score,
  confidence: candidate.confidence,
}) : null);

const hintOf = (options, provider) => {
  const given = options?.providerHint ?? null;
  if (given === null || given === undefined || given === "") return null;
  return Object.freeze({ given: String(given), agreed: String(given) === provider });
};

function result({ provider = null, displayName = null, confidence = 0, code, detail = "",
  projection = null, closest = null, options }) {
  return Object.freeze({
    provider,
    displayName,
    confidence,
    normalizedProjection: projection,
    reason: Object.freeze({
      code,
      message: code === DETECTION_CODES.DETECTED ? detail : `${REASONS[code]}${detail}`,
    }),
    closestCandidate: closest,
    // A cross-check and never a selector: this field is the ONLY thing a hint
    // can change, and the provider above is identical with it, without it, and
    // against it.
    hint: hintOf(options, provider),
  });
}

function recordCount(text, format, costColumn) {
  const lines = nonEmptyLines(text);
  if (format === "jsonl") return lines.length;
  if (format === "json") {
    const key = lastSegment(costColumn ?? "");
    if (!key) return 0;
    return (text.toLowerCase().match(new RegExp(`"[^"\\\\]*${key}"\\s*:`, "g")) ?? []).length;
  }
  return Math.max(0, lines.length - 1);
}

const nearestSentence = (closest) => (closest
  ? ` The closest supported importer is ${closest.displayName}, which this file matched at `
    + `${closest.confidence} of 100 (${closest.score} points).`
  : " No supported importer matched this file at all.");

// ---------------------------------------------------------------- entry point

/**
 * Decide, from the content alone, which provider one billing export came from.
 *
 * @param text     the already-parsed file text. Never a file name, never a
 *                 handle, never a fetch.
 * @param options  `{ providerHint }` — a cross-check only. When the hint
 *                 disagrees with the content the CONTENT WINS and the
 *                 disagreement is reported on `hint`. Detection behaves
 *                 identically whether or not a hint is supplied.
 * @returns a frozen `{ provider, confidence, normalizedProjection, reason }`,
 *          plus `closestCandidate`, `displayName` and `hint`. An unrecognized
 *          file returns `provider: null` and a named reason. Nothing throws.
 */
export function detectAndNormalizeExport(text, options = {}) {
  const source = typeof text === "string" ? text : String(text ?? "");
  if (!source.trim()) {
    return result({ code: DETECTION_CODES.EMPTY_EXPORT, options, closest: null,
      detail: " No supported importer matched this file at all." });
  }

  const format = formatOf(source);
  const tokens = columnTokens(source, format);
  const scored = PROVIDER_ORDER.map((entry) => scoreProvider(entry, tokens));
  const ranked = rank(scored);

  // Reported on every failure below, so "we could not read this" always comes
  // with "and here is the importer you are nearest to".
  const nearest = closestOf(ranked[0]);

  if (!PROVIDER_ORDER.some((entry) => holds(tokens, entry.roles[FIELD_ROLES.COST]))) {
    return result({ code: DETECTION_CODES.NO_COST_COLUMN, options, closest: nearest,
      detail: nearestSentence(nearest) });
  }

  // The explicit AWS/Bedrock question, asked BEFORE any comparison of the two.
  const family = awsFamilyVerdict(tokens, source);
  const contenders = ranked.filter((candidate) =>
    !AWS_FAMILY.includes(candidate.provider) || candidate.provider === family.provider);

  const [winner, runnerUp = null] = contenders;
  if (!winner || winner.matchedSignature.length === 0) {
    return result({ code: DETECTION_CODES.NO_SIGNATURE_MATCH, options, closest: nearest,
      detail: nearestSentence(nearest) });
  }
  if (runnerUp && winner.confidence - runnerUp.confidence < AMBIGUITY_MARGIN) {
    return result({ code: DETECTION_CODES.AMBIGUOUS_PROVIDERS, options, closest: nearest,
      detail: `${nearestSentence(nearest)} ${runnerUp.displayName} scored `
        + `${runnerUp.confidence} of 100, within the ${AMBIGUITY_MARGIN}-point separation this `
        + "check requires. Export one provider's billing period per file and read it again." });
  }

  const cost = winner.columns[FIELD_ROLES.COST];
  return result({
    provider: winner.provider,
    displayName: winner.displayName,
    confidence: winner.confidence,
    code: DETECTION_CODES.DETECTED,
    options,
    closest: closestOf(winner),
    detail: `${winner.displayName} identified from this file's own columns at `
      + `${winner.confidence} of 100: ${winner.matchedSignature.length} of `
      + `${PROVIDER_ORDER.find((entry) => entry.provider === winner.provider).signature.length} `
      + `signature columns and ${ROLE_ORDER.length - winner.missingRoles.length} of `
      + `${ROLE_ORDER.length} billing roles are present.`,
    // Declared vocabulary and integers only. No cell of the reader's file, and
    // no column name they invented, is anywhere in this object.
    projection: Object.freeze({
      provider: winner.provider,
      displayName: winner.displayName,
      format,
      declaredFormat: winner.format,
      rowCount: recordCount(source, format, cost),
      columns: winner.columns,
      matchedSignatureColumns: winner.matchedSignature,
      missingRoles: winner.missingRoles,
      awsFamilyMarker: AWS_FAMILY.includes(winner.provider) ? family : null,
    }),
  });
}

/**
 * The verdict as one sentence for a reader. Kept beside the codes so a surface
 * cannot word a named reason differently from the module that named it.
 */
export function describeDetection(verdict) {
  if (!verdict) return "";
  const disagreement = verdict.hint && !verdict.hint.agreed
    ? " The provider named beside this file was not what its columns say; the file's own"
      + " content decided the verdict."
    : "";
  return `${verdict.reason.message}${disagreement}`;
}
