// Where a FinOps lead goes next, and which one place they go first.
//
// THE PROBLEM THIS SOLVES. `finops-decision-contract.js` decides what the front
// door *answers*: "Are we wasting money?" — one benchmark, one ranked action,
// one confidence, one provenance. A leader who has read that answer then has a
// second question, and until now the page had no place that answered it:
//
//     Where do I go next to act on this?
//
// The page has the destinations. It has an in-page evidence panel, a department
// drill-down, and a monthly act-and-verify loop on its own surface. What it did
// not have was a ranking. All three were authored a thousand lines apart — the
// act-and-verify links sit inside a collapsed supporting disclosure near the
// bottom — so choosing between them meant scanning the monolith and guessing.
// Three equally-presented doors is not a recommendation; it hands the routing
// decision back to the reader after telling them the page had already made it.
//
// This module states the choice once, as data, for the bundled local demo:
// three allowed destinations, exactly one prioritized, and a named rule that
// says why that one and not the other two.
//
// ---------------------------------------------------------------------------
// THE FIVE FIELDS A WORKSPACE-DESTINATION RECORD MUST CARRY
// ---------------------------------------------------------------------------
//
//   question       The leader question this record routes. Fixed; see
//                  `DESTINATION_QUESTION`. A record that answers a different
//                  question is a different record.
//   benchmark      The material comparison that makes going anywhere worth a
//                  leader's hour, plus the materiality test it passed. A
//                  benchmark with no threshold is a number with an opinion.
//   rankedAction   The single rank-1 next action, its accountable role, its
//                  spend cap, and the deterministic ordering it won.
//   finding        ONE consolidated evidence-backed finding: the statement,
//                  why it matters, the confidence with its basis, the
//                  provenance, and the disclosed evidence behind it. An object
//                  and never an array — a list of findings is a reading task.
//   destinations   The three allowed destinations, one per role, ranked. Rank 1
//                  is the prioritized one and carries the clause that promoted
//                  it.
//
// ---------------------------------------------------------------------------
// EXACT METRIC AND RANKING SEMANTICS
// ---------------------------------------------------------------------------
//
// Stated so that two engineers compute the same values.
//
// * MEASUREMENT WINDOW. A half-open interval [start, end): `start` inclusive,
//   `end` exclusive, both RFC-3339 instants in UTC. Same rule, same shape, and
//   in the shipped fixture the same window as the decision contract's, because
//   a destination ranked from a different month than the answer above it would
//   be routing off a figure the reader cannot see.
//
// * BENCHMARK COMPARISON. `comparisonShare = observedUsd ÷ baselineUsd`, where
//   `baselineUsd` is analyzed AI spend in USD over the window and `observedUsd`
//   is modelled recoverable spend in USD over the same window. The quotient is
//   stored rounded half-up to 4 decimal places, by way of `recoverableShare`
//   from the decision contract, so the two surfaces cannot round differently.
//   Null — never 0 — when there is no positive baseline.
//
// * MATERIALITY. Two tests, both required, evaluated on unrounded inputs
//   against the stored share:
//
//       material = comparisonShare >= MATERIALITY.minShare        (0.05)
//                  AND observedUsd  >= MATERIALITY.minObservedUsd (10000)
//
//   Both, deliberately. A share test alone calls 20% of a 400 USD baseline
//   material; a dollar test alone calls 10,000 USD of a 50,000,000 USD
//   baseline material. Neither is worth a leader's meeting, and a leader who is
//   sent to a destination over an immaterial figure stops trusting the ranking.
//   The thresholds are authored product decisions, not measurements — they are
//   published here so a reader can disagree with the number rather than with a
//   verdict whose rule is invisible. `material` is stored in the record and
//   recomputed by the validator, so it cannot drift from the rule.
//
// * ACTION RANKING (deterministic, total). Departments are ordered by modelled
//   recoverable spend in USD over the window, descending. Ties — equal to the
//   cent — break on the department pseudonym ascending, compared by UTF-16 code
//   unit. That second key is what makes the order total rather than merely
//   sorted: two departments with identical scenarios would otherwise rank by
//   whatever order the input file happened to carry, and the "rank 1" a leader
//   was shown would depend on a row order nobody chose. Rank 1 only is carried
//   here; see `RANKING_BASIS`.
//
// * DESTINATION PRIORITY (deterministic, first match wins). Ranking a
//   destination is not a taste question, so it is not left to one. The clauses
//   in `PRIORITY_CLAUSES` are evaluated in declared order against the record's
//   own finding and ranked action, and the first that matches promotes its role
//   to rank 1:
//
//     1. `unchecked_basis`   — the finding's confidence carries at least one
//                              limit, or its band is `low`/`insufficient`.
//                              → evidence. Nobody should commit a spend cap
//                              against a figure whose basis was not checked.
//     2. `unscoped_action`   — the rank-1 action names no department scope.
//                              → department-detail. An action with no owner
//                              unit cannot be started, only discussed.
//     3. `ready_to_commit`   — otherwise. → act-and-verify.
//
//   The clauses are mutually exclusive by construction (first match wins) and
//   the third is unconditional, so exactly one always fires. The two roles the
//   clause did not promote take ranks 2 and 3 in `ROLE_ORDER`, so the whole
//   ordering is a pure function of the record: no clock, no storage, no reader
//   state, and the same three doors in the same three positions on every open.
//
// ---------------------------------------------------------------------------
// THE BOUNDARY
// ---------------------------------------------------------------------------
//
// A workspace-destination record is a local-demo artifact. Every destination it
// may name is a surface of this same origin — an in-page fragment or a
// root-relative path — and `validateDestinationRecord` rejects anything else.
// That rule is the one that keeps this module from quietly becoming a place to
// declare a live integration, a vendor console, or a customer's tenant URL. The
// record inherits the decision contract's privacy walk unchanged, so a
// credential, an address, a stored prompt, or a remote endpoint anywhere in it
// is a validation failure rather than something a caller has to remember to
// strip.

import {
  confidenceBand, privacyViolations, recoverableShare,
} from "./finops-decision-contract.js";
import CANONICAL_DESTINATIONS from "./finops-destination-fixture.json" with { type: "json" };

/** Bump when a field, a threshold, or a ranking rule changes meaning. */
export const DESTINATION_CONTRACT_VERSION = "finops-workspace-destinations/1.0.0";

/** Bump independently when a priority clause is added, reordered, or reworded. */
export const PRIORITY_RULE_VERSION = "destination-priority/1.0.0";

/**
 * The one question this record routes.
 *
 * Deliberately not "Are we wasting money?" — that one is answered above this
 * region by the decision contract, and a second region answering it would be a
 * second summary. This one starts where that answer ends.
 */
export const DESTINATION_QUESTION = "Where do I go next to act on this?";

/** The five fields a complete record must carry. */
export const REQUIRED_FIELDS = Object.freeze([
  "question", "benchmark", "rankedAction", "finding", "destinations",
]);

/**
 * The three roles a destination may play, and the only three.
 *
 * A fourth role is a product decision, not a config change: it means the page
 * claims a leader has four next steps, which is the scanning problem this
 * module exists to end.
 */
export const DESTINATION_ROLE = Object.freeze({
  evidence: "evidence",
  departmentDetail: "department-detail",
  actAndVerify: "act-and-verify",
});

/**
 * The tie-break order for the two roles a clause did not promote.
 *
 * Check the number, then find the unit, then commit and verify: it is the order
 * a leader would work in anyway, so it is the order the unpromoted doors keep.
 */
export const ROLE_ORDER = Object.freeze([
  DESTINATION_ROLE.evidence,
  DESTINATION_ROLE.departmentDetail,
  DESTINATION_ROLE.actAndVerify,
]);

/**
 * The priority clauses, in evaluation order. First match wins.
 *
 * `code` is what the record stores and the page displays, so the reason a door
 * came first is legible to the reader and assertable by a test.
 */
export const PRIORITY_CLAUSES = Object.freeze([
  Object.freeze({
    code: "unchecked_basis",
    role: DESTINATION_ROLE.evidence,
    because: "Part of the basis for this figure was not checked, so the evidence"
      + " comes before the commitment.",
  }),
  Object.freeze({
    code: "unscoped_action",
    role: DESTINATION_ROLE.departmentDetail,
    because: "The ranked action names no department scope, so the unit that owns"
      + " it has to be identified before it can be started.",
  }),
  Object.freeze({
    code: "ready_to_commit",
    role: DESTINATION_ROLE.actAndVerify,
    because: "The figure's basis is checked and the action is scoped to a"
      + " department, so the next step is committing to it and verifying it.",
  }),
]);

/** The materiality thresholds, both required. See the semantics above. */
export const MATERIALITY = Object.freeze({ minShare: 0.05, minObservedUsd: 10000 });

/** The one ordering the ranked action may claim. */
export const RANKING_BASIS = Object.freeze({
  key: "modelled_recoverable_spend_usd",
  direction: "descending",
  tieBreak: "department_pseudonym_ascending",
});

/** The only source a local-demo record may claim. */
export const SYNTHETIC_SOURCE = "synthetic-local";

/** Bands whose figures are not fit to commit money against. */
const WEAK_BANDS = Object.freeze(["low", "insufficient"]);

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/**
 * A destination href this page is allowed to name: an in-page fragment or a
 * root-relative path on this origin. Protocol-relative `//host` is excluded on
 * purpose — it is a remote URL wearing a path's clothes.
 */
const LOCAL_HREF = /^(?:#[A-Za-z][\w:.-]*|\/(?!\/)[\w./-]*)$/;

// ---------------------------------------------------------------------------
// The two computed verdicts.
// ---------------------------------------------------------------------------

/**
 * Both materiality tests, reported separately as well as together.
 *
 * Separately, because "material" with no failing test named is unarguable, and
 * a leader who wants to argue with the threshold needs to know which one bound.
 */
export function materiality(observedUsd, baselineUsd, thresholds = MATERIALITY) {
  const share = recoverableShare(observedUsd, baselineUsd);
  const meetsShare = share !== null && share >= thresholds.minShare;
  const meetsFloor = isFiniteNumber(observedUsd) && observedUsd >= thresholds.minObservedUsd;
  return Object.freeze({
    share,
    meetsShare,
    meetsFloor,
    material: Boolean(meetsShare && meetsFloor),
    minShare: thresholds.minShare,
    minObservedUsd: thresholds.minObservedUsd,
  });
}

/**
 * The clause that promotes a role to rank 1, for a given finding and action.
 *
 * Takes the two things it reads rather than the whole record, so a caller can
 * ask "what would this rank if the limit were cleared?" without building one.
 */
export function priorityClauseFor({ confidence = null, rankedAction = null } = {}) {
  const limits = Array.isArray(confidence?.limits) ? confidence.limits : [];
  const band = String(confidence?.band ?? "");
  if (limits.length > 0 || WEAK_BANDS.includes(band)) return PRIORITY_CLAUSES[0];
  if (!isNonEmptyString(rankedAction?.departmentScope)) return PRIORITY_CLAUSES[1];
  return PRIORITY_CLAUSES[2];
}

/**
 * The three roles in rank order: the promoted one, then the rest in
 * `ROLE_ORDER`. A pure function of the clause, which is a pure function of the
 * record.
 */
export function rankedRoles(clause) {
  const promoted = clause?.role;
  return Object.freeze([promoted, ...ROLE_ORDER.filter((role) => role !== promoted)]);
}

// ---------------------------------------------------------------------------
// Validation. Returns errors; never throws.
// ---------------------------------------------------------------------------

function windowErrors(where, window) {
  const errors = [];
  if (!isRecord(window)) return [`${where}: missing window`];
  if (!INSTANT.test(String(window.start ?? ""))) errors.push(`${where}.start: not a UTC instant`);
  if (!INSTANT.test(String(window.end ?? ""))) errors.push(`${where}.end: not a UTC instant`);
  if (window.endExclusive !== true) errors.push(`${where}.endExclusive: must be true`);
  if (!errors.length && !(String(window.start) < String(window.end))) {
    errors.push(`${where}: start must precede end`);
  }
  return errors;
}

function benchmarkErrors(benchmark) {
  const errors = [];
  if (!isRecord(benchmark)) return ["benchmark: must be an object"];
  if (!isNonEmptyString(benchmark.name)) errors.push("benchmark.name: missing");
  if (!isNonEmptyString(benchmark.baselineName)) errors.push("benchmark.baselineName: missing");
  if (!isFiniteNumber(benchmark.baselineUsd) || benchmark.baselineUsd <= 0) {
    errors.push("benchmark.baselineUsd: must be a positive number");
  }
  if (!isFiniteNumber(benchmark.observedUsd) || benchmark.observedUsd < 0) {
    errors.push("benchmark.observedUsd: must be a non-negative number");
  }
  if (benchmark.currency !== "USD") errors.push("benchmark.currency: must be USD");
  if (!isNonEmptyString(benchmark.basis)) errors.push("benchmark.basis: missing");
  errors.push(...windowErrors("benchmark.window", benchmark.window));

  const verdict = materiality(benchmark.observedUsd, benchmark.baselineUsd);
  if (benchmark.comparisonShare !== verdict.share) {
    errors.push(`benchmark.comparisonShare: expected ${verdict.share}`);
  }
  if (benchmark.materialityMinShare !== MATERIALITY.minShare) {
    errors.push(`benchmark.materialityMinShare: expected ${MATERIALITY.minShare}`);
  }
  if (benchmark.materialityMinObservedUsd !== MATERIALITY.minObservedUsd) {
    errors.push(`benchmark.materialityMinObservedUsd: expected ${MATERIALITY.minObservedUsd}`);
  }
  if (benchmark.material !== verdict.material) {
    errors.push(`benchmark.material: expected ${verdict.material} under ${PRIORITY_RULE_VERSION}`);
  }
  return errors;
}

function rankedActionErrors(action) {
  const errors = [];
  if (!isRecord(action)) return ["rankedAction: must be an object"];
  if (action.rank !== 1) errors.push("rankedAction.rank: must be 1");
  if (!isNonEmptyString(action.statement)) errors.push("rankedAction.statement: missing");
  if (!isNonEmptyString(action.accountableRole)) errors.push("rankedAction.accountableRole: missing");
  if (!isNonEmptyString(action.departmentScope)) errors.push("rankedAction.departmentScope: missing");
  if (!isFiniteNumber(action.capUsd) || action.capUsd <= 0) {
    errors.push("rankedAction.capUsd: must be a positive number");
  }
  if (!isNonEmptyString(action.priorityBasis)) errors.push("rankedAction.priorityBasis: missing");
  const ranking = action.rankingBasis;
  if (!isRecord(ranking)) {
    errors.push("rankedAction.rankingBasis: must be an object");
  } else {
    for (const key of Object.keys(RANKING_BASIS)) {
      if (ranking[key] !== RANKING_BASIS[key]) {
        errors.push(`rankedAction.rankingBasis.${key}: expected ${RANKING_BASIS[key]}`);
      }
    }
  }
  return errors;
}

function findingErrors(finding, action) {
  if (Array.isArray(finding)) {
    return ["finding: must be one consolidated finding, not a list"];
  }
  if (!isRecord(finding)) return ["finding: must be an object"];
  const errors = [];
  if (!isNonEmptyString(finding.id)) errors.push("finding.id: missing");
  if (!isNonEmptyString(finding.statement)) errors.push("finding.statement: missing");
  if (!isNonEmptyString(finding.whyItMatters)) errors.push("finding.whyItMatters: missing");

  const confidence = finding.confidence;
  if (!isRecord(confidence)) {
    errors.push("finding.confidence: must be an object");
  } else {
    const score = confidence.score;
    if (!isFiniteNumber(score) || score < 0 || score > 1) {
      errors.push("finding.confidence.score: must be within [0, 1]");
    }
    if (confidence.scaleMin !== 0 || confidence.scaleMax !== 1) {
      errors.push("finding.confidence: scale must be 0 to 1");
    }
    if (!isNonEmptyString(confidence.basis)) errors.push("finding.confidence.basis: missing");
    if (isFiniteNumber(score) && confidence.band !== confidenceBand(score)) {
      errors.push(`finding.confidence.band: expected ${confidenceBand(score)} for ${score}`);
    }
    if (!Array.isArray(confidence.limits)) {
      errors.push("finding.confidence.limits: must be an array");
    } else {
      confidence.limits.forEach((limit, index) => {
        if (!isNonEmptyString(limit?.code)) errors.push(`finding.confidence.limits[${index}].code: missing`);
        if (!isNonEmptyString(limit?.detail)) errors.push(`finding.confidence.limits[${index}].detail: missing`);
      });
    }
  }

  const provenance = finding.provenance;
  if (!isRecord(provenance)) {
    errors.push("finding.provenance: must be an object");
  } else {
    if (provenance.source !== SYNTHETIC_SOURCE) {
      errors.push(`finding.provenance.source: must be ${SYNTHETIC_SOURCE}`);
    }
    if (!isNonEmptyString(provenance.datasetId)) errors.push("finding.provenance.datasetId: missing");
    if (!isNonEmptyString(provenance.generator)) errors.push("finding.provenance.generator: missing");
    if (!INSTANT.test(String(provenance.generatedAt ?? ""))) {
      errors.push("finding.provenance.generatedAt: not a UTC instant");
    }
    if (!isNonEmptyString(provenance.generatedAtBasis)) {
      errors.push("finding.provenance.generatedAtBasis: missing");
    }
    if (!isNonEmptyString(provenance.executionContext)) {
      errors.push("finding.provenance.executionContext: missing");
    }
  }

  // Evidence supports the finding; it may not be the finding again with a
  // triangle in front of it, and it may not be the ranked action restated.
  const evidence = finding.evidence;
  if (!isRecord(evidence)) {
    errors.push("finding.evidence: must be an object");
  } else {
    if (evidence.disclosure !== "progressive") {
      errors.push("finding.evidence.disclosure: must be progressive");
    }
    if (evidence.distinctFromSummary !== true) {
      errors.push("finding.evidence.distinctFromSummary: must be true");
    }
    const entries = evidence.entries;
    if (!Array.isArray(entries) || entries.length === 0) {
      errors.push("finding.evidence.entries: must hold at least one entry");
    } else {
      const restated = new Set([finding.statement, finding.whyItMatters, action?.statement]
        .filter(isNonEmptyString).map((text) => text.trim()));
      entries.forEach((entry, index) => {
        if (!isNonEmptyString(entry?.term)) errors.push(`finding.evidence.entries[${index}].term: missing`);
        if (!isNonEmptyString(entry?.detail)) errors.push(`finding.evidence.entries[${index}].detail: missing`);
        if (restated.has(String(entry?.detail).trim())) {
          errors.push(`finding.evidence.entries[${index}]: restates the summary`);
        }
      });
    }
  }
  return errors;
}

function destinationErrors(destinations, expectedRoles) {
  if (!Array.isArray(destinations)) return ["destinations: must be an array"];
  const errors = [];
  if (destinations.length !== ROLE_ORDER.length) {
    errors.push(`destinations: expected exactly ${ROLE_ORDER.length} entries`);
  }
  const seenRoles = new Set();
  const seenIds = new Set();
  destinations.forEach((entry, index) => {
    const where = `destinations[${index}]`;
    if (!isRecord(entry)) {
      errors.push(`${where}: must be an object`);
      return;
    }
    if (!isNonEmptyString(entry.id)) errors.push(`${where}.id: missing`);
    else if (seenIds.has(entry.id)) errors.push(`${where}.id: duplicated "${entry.id}"`);
    else seenIds.add(entry.id);

    if (!Object.values(DESTINATION_ROLE).includes(entry.role)) {
      errors.push(`${where}.role: unknown role "${entry.role}"`);
    } else if (seenRoles.has(entry.role)) {
      errors.push(`${where}.role: duplicated "${entry.role}"`);
    } else {
      seenRoles.add(entry.role);
    }

    if (!isNonEmptyString(entry.label)) errors.push(`${where}.label: missing`);
    if (!isNonEmptyString(entry.answers)) errors.push(`${where}.answers: missing`);
    if (!isNonEmptyString(entry.doesNotAnswer)) errors.push(`${where}.doesNotAnswer: missing`);
    if (entry.disclosure !== "progressive") errors.push(`${where}.disclosure: must be progressive`);
    if (!LOCAL_HREF.test(String(entry.href ?? ""))) {
      errors.push(`${where}.href: must be an in-page fragment or a root-relative path`);
    }

    const expectedRank = expectedRoles.indexOf(entry.role) + 1;
    if (expectedRank > 0 && entry.rank !== expectedRank) {
      errors.push(`${where}.rank: expected ${expectedRank} for role ${entry.role}`
        + ` under ${PRIORITY_RULE_VERSION}`);
    }
    if (entry.rank === 1) {
      if (!isNonEmptyString(entry.callToAction)) errors.push(`${where}.callToAction: missing`);
      const clause = PRIORITY_CLAUSES.find((candidate) => candidate.code === entry.priorityClause);
      if (!clause) errors.push(`${where}.priorityClause: unknown clause "${entry.priorityClause}"`);
      else if (clause.role !== entry.role) {
        errors.push(`${where}.priorityClause: ${clause.code} promotes ${clause.role}`);
      }
      if (!isNonEmptyString(entry.selectionBasis)) errors.push(`${where}.selectionBasis: missing`);
    }
  });
  for (const role of ROLE_ORDER) {
    if (!seenRoles.has(role)) errors.push(`destinations: no entry for role ${role}`);
  }
  return errors;
}

/**
 * Validate a workspace-destination record against every rule in this file.
 *
 * @returns `{ valid, errors }`. Never throws: the caller is a page that must
 *   still render a labelled unavailable state rather than an unvalidated claim.
 */
export function validateDestinationRecord(record) {
  if (!isRecord(record)) {
    return Object.freeze({ valid: false, errors: Object.freeze(["record: not an object"]) });
  }
  const errors = [];
  if (record.contractVersion !== DESTINATION_CONTRACT_VERSION) {
    errors.push(`contractVersion: expected ${DESTINATION_CONTRACT_VERSION}`);
  }
  if (record.priorityRuleVersion !== PRIORITY_RULE_VERSION) {
    errors.push(`priorityRuleVersion: expected ${PRIORITY_RULE_VERSION}`);
  }
  for (const field of REQUIRED_FIELDS) {
    if (record[field] === undefined || record[field] === null) errors.push(`${field}: missing`);
  }
  if (record.question !== DESTINATION_QUESTION) {
    errors.push("question: not the canonical destination question");
  }

  errors.push(...benchmarkErrors(record.benchmark));
  errors.push(...rankedActionErrors(record.rankedAction));
  errors.push(...findingErrors(record.finding, record.rankedAction));

  const clause = priorityClauseFor({
    confidence: record.finding?.confidence ?? null,
    rankedAction: record.rankedAction ?? null,
  });
  errors.push(...destinationErrors(record.destinations, rankedRoles(clause)));

  // Every figure in one record covers one window: a destination ranked from a
  // month the benchmark did not measure is routing off a number nobody can see.
  if (isRecord(record.benchmark) && isRecord(record.rankedAction)) {
    const a = record.benchmark.window;
    const b = record.rankedAction.window;
    if (isRecord(b) && isRecord(a) && (a.start !== b.start || a.end !== b.end)) {
      errors.push("rankedAction.window: must be the same window as benchmark.window");
    }
  }

  errors.push(...privacyViolations(record));
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

// ---------------------------------------------------------------------------
// The fixture, and the accessors a surface uses.
// ---------------------------------------------------------------------------

/**
 * The representative local-demo record the front door consumes.
 *
 * A static bundled fixture rather than a first-paint computation, for the same
 * reason the decision fixture is one: the front door must be able to say where
 * a leader should go before any analysis has run, and a demo whose ranking
 * depends on when it was opened is not reproducible. Its figures are the
 * bundled synthetic dataset's, so they agree with the answer above it.
 *
 * @returns `{ record, valid, errors, clause }`. `record` is null when the
 *   fixture fails its own contract.
 */
export function loadWorkspaceDestinations(fixture = CANONICAL_DESTINATIONS) {
  const validation = validateDestinationRecord(fixture);
  return Object.freeze({
    record: validation.valid ? Object.freeze(fixture) : null,
    valid: validation.valid,
    errors: validation.errors,
    clause: priorityClauseFor({
      confidence: fixture?.finding?.confidence ?? null,
      rankedAction: fixture?.rankedAction ?? null,
    }),
  });
}

/** The rank-1 destination, or null when the record does not carry one. */
export function prioritizedDestination(record) {
  const found = (record?.destinations ?? []).find((entry) => entry?.rank === 1);
  return found ?? null;
}

/** The unpromoted destinations, in rank order. Rank 2 first, always. */
export function supportingDestinations(record) {
  return (record?.destinations ?? [])
    .filter((entry) => isFiniteNumber(entry?.rank) && entry.rank > 1)
    .slice()
    .sort((left, right) => left.rank - right.rank);
}
