// The one-click example dataset.
//
// A visitor who has never produced a provider export cannot use the import
// panel at all: it can only ask for a file they do not have. This module is the
// answer to that — a synthetic organisation, six consecutive complete months,
// emitted in the *raw* shape of the v1 provider-usage and HRIS-org contracts.
//
// It is deliberately a fixture generator rather than a committed result. The
// bytes below go through `parseLocalFinopsFile` and `normalizeLocalFinopsHistory`
// exactly like an uploaded file: same translator, same envelope, same analysis.
// There is no bypass branch, and no pre-computed number is stored anywhere. If
// the translator's contract tightens, this dataset fails with everything else,
// which is the point — it doubles as the translation regression fixture.
//
// Everything here is invented. There is no real company, customer, account,
// resource, or provider identifier in this file; the opaque ids follow the
// contract's pseudonym pattern and their readable tails are made-up words.

import { parseLocalFinopsFile, normalizeLocalFinopsHistory } from "./local-finops.js";
import { PROVIDER_USAGE_SCHEMA_VERSION, usageDetail } from "./provider-usage-record.js";
import { classifyQuerySample, parseQuerySample } from "./query-sample-contract.js";
import {
  COST_METRIC, COST_POSITION_VERSION, costPerSuccessfulTask, countSuccessfulTasks,
  displayCostPerSuccessfulTask, ORG_SIZE_BAND, PEER_COST_SNAPSHOT_ID, PEER_INDUSTRY,
  TASK_OUTCOME, TASK_NON_TERMINAL_OUTCOME,
} from "./peer-cost-position.js";
import { RUBRIC_VERSION_ID } from "./prompt-literacy-scoring.js";

// Six consecutive complete calendar months, and the arithmetic that turns one
// into a half-open window. Both moved to `analyzed-period.js` so the homepage
// takeaway can name the span these figures cover without loading this file's
// import graph, and so there is one list rather than two that drift.
import { EXAMPLE_MONTHS as MONTHS, nextMonth } from "./analyzed-period.js";

const PROVIDER_SOURCE = "psn_example_provider_00001";
const HRIS_SOURCE = "psn_example_hris_00000001";
const COMPANY_UNIT = "psn_example_unit_hqroot";

// Monthly spend in whole USD, one entry per month in MONTHS order. The shape is
// the point of the dataset: Atlas is an unambiguous single driver of the most
// recent increase, Boreal is flat and Cinder is declining, so the leading
// finding is a real discrimination rather than the only non-zero row.
//
// `model` is the SKU the invented provider names on this unit's token-billed
// text-generation rows, and it is what the query sample below joins to: the
// rubric scores a department only where a sampled query and a billed row agree
// on (department, model). The SKUs are the invented company's own, the same
// three `example-conversation-corpus.js` writes its prompts against, chosen
// only so the shipped tier table reads them as premium, standard and economy.
const DEPARTMENTS = Object.freeze([
  Object.freeze({
    unitId: "psn_example_unit_atlas0",
    model: "invented-ultra-1",
    monthlyUsd: Object.freeze([40_000, 41_500, 42_000, 43_000, 44_500, 79_000]),
    mix: Object.freeze([
      Object.freeze(["openai", "text-generation", 55]),
      Object.freeze(["anthropic", "text-generation", 30]),
      Object.freeze(["aws", "storage", 15]),
    ]),
  }),
  Object.freeze({
    unitId: "psn_example_unit_boreal",
    model: "invented-pro-1",
    monthlyUsd: Object.freeze([22_000, 22_000, 22_000, 22_000, 22_000, 22_000]),
    mix: Object.freeze([
      Object.freeze(["anthropic", "text-generation", 40]),
      Object.freeze(["google", "embedding", 35]),
      Object.freeze(["azure", "storage", 25]),
    ]),
  }),
  Object.freeze({
    unitId: "psn_example_unit_cinder",
    model: "invented-pro-1",
    monthlyUsd: Object.freeze([30_000, 29_000, 28_000, 27_000, 26_000, 24_500]),
    mix: Object.freeze([
      Object.freeze(["openai", "text-generation", 60]),
      Object.freeze(["openai", "image-generation", 25]),
      Object.freeze(["aws", "storage", 15]),
    ]),
  }),
  Object.freeze({
    unitId: "psn_example_unit_quartz",
    model: "invented-pro-1",
    monthlyUsd: Object.freeze([12_000, 12_500, 13_000, 13_500, 14_000, 18_000]),
    mix: Object.freeze([
      Object.freeze(["google", "text-generation", 50]),
      Object.freeze(["google", "embedding", 30]),
      Object.freeze(["azure", "other", 20]),
    ]),
  }),
  Object.freeze({
    unitId: "psn_example_unit_ember0",
    model: "invented-mini-1",
    monthlyUsd: Object.freeze([8_000, 8_200, 8_400, 8_600, 8_800, 11_000]),
    mix: Object.freeze([
      Object.freeze(["anthropic", "text-generation", 45]),
      Object.freeze(["openai", "image-generation", 35]),
      Object.freeze(["aws", "storage", 20]),
    ]),
  }),
]);

/**
 * What the invented organization declares about itself.
 *
 * The two cohort attributes are DECLARED, not inferred: a size band derived
 * from the invoice would make the peer cohort a function of the very number the
 * cohort exists to judge. The snapshot identifier is the published cost-cohort
 * reference data's own, so the bundled example and the reference table are
 * comparable by construction and a future snapshot bump on either side is
 * caught rather than silently compared across.
 *
 * These attributes belong to the invented company in this file and to nothing
 * else. A reader's own import declares no size band or industry, so it is
 * withheld with a reason rather than borrowing this one.
 */
export const EXAMPLE_ORG_COHORT_PROFILE = Object.freeze({
  sizeBand: ORG_SIZE_BAND.enterprise,
  industry: PEER_INDUSTRY.saas,
  snapshotId: PEER_COST_SNAPSHOT_ID,
});

/**
 * The invented task ledger for the reporting month — the denominator's source.
 *
 * One row per department per outcome, as a tally rather than as thousands of
 * individual task objects: the rule the denominator turns on is which outcome a
 * row carries, and a tally states that exactly as well as a list while staying
 * readable. `countSuccessfulTasks` treats a row with no `count` as one task, so
 * a test can hand it individual records and get the same rule.
 *
 * Every outcome the metric distinguishes is present on purpose. The failed and
 * abandoned rows are what make the metric mean something for this example: their
 * spend stays in the numerator and they contribute nothing to the denominator.
 * The running rows are not yet terminal at the snapshot boundary and are
 * excluded from both, so they can be deleted from this fixture without moving
 * the published figure — which is the property a test pins.
 *
 * Successes total 4,000 for the reporting month.
 */
const taskRows = (unitId, success, failed, abandoned, running) => [
  Object.freeze({ groupId: `${unitId}-success`, orgUnitId: unitId, outcome: TASK_OUTCOME.success, count: success }),
  Object.freeze({ groupId: `${unitId}-failed`, orgUnitId: unitId, outcome: TASK_OUTCOME.failed, count: failed }),
  Object.freeze({ groupId: `${unitId}-abandoned`, orgUnitId: unitId, outcome: TASK_OUTCOME.abandoned, count: abandoned }),
  Object.freeze({ groupId: `${unitId}-running`, orgUnitId: unitId, outcome: TASK_NON_TERMINAL_OUTCOME.running, count: running }),
];

export const EXAMPLE_TASK_LEDGER = Object.freeze([
  ...taskRows("psn_example_unit_atlas0", 1_500, 260, 90, 140),
  ...taskRows("psn_example_unit_boreal", 900, 110, 40, 60),
  ...taskRows("psn_example_unit_cinder", 780, 150, 55, 70),
  ...taskRows("psn_example_unit_quartz", 520, 80, 30, 45),
  ...taskRows("psn_example_unit_ember0", 300, 60, 25, 30),
]);

// ---------------------------------------------------------------------------
// THE COMPANY'S OWN VOCABULARY — one naming scheme for the whole example brief.
//
// The bytes above carry opaque `psn_example_unit_*` identifiers, because that is
// what a real provider export carries and this fixture is not allowed to be
// easier to read than the thing it stands in for. `local-finops.js` therefore
// labels each unit `Department …atlas0` from its own id tail, which is correct
// for an imported file nobody has named — and wrong for the *example*, where the
// company is invented and its teams already have names in this repository
// (`contracts/integrations/tabular-dialects/v1/fixtures/generic-hris-roster.csv`
// staffs Atlas Platform, Boreal Support, and Cinder Research by hand).
//
// The result before this table existed was a brief that named the same five
// teams two ways: a peer-position line reading "Department …atlas0 is a full
// band behind Department …boreal" beside panels naming human teams. Two naming
// schemes on one screen read as two datasets stitched together, which is exactly
// what the example must not look like.
//
// So the names are published HERE, beside the units they belong to, and the
// brief renders them. The identifier stays the key — it is what the provider
// console and every downstream export still say — and never the visible text.
// ---------------------------------------------------------------------------

/** What the invented company calls each invented unit. Keys are the wire ids. */
export const EXAMPLE_DEPARTMENT_NAMES = Object.freeze({
  psn_example_unit_atlas0: "Atlas Platform",
  psn_example_unit_boreal: "Boreal Support",
  psn_example_unit_cinder: "Cinder Research",
  psn_example_unit_quartz: "Quartz Analytics",
  psn_example_unit_ember0: "Ember Studio",
});

/**
 * Every name this example may put on a screen.
 *
 * Published as a set so a surface can be checked against it rather than against
 * a second list: a rendered department name that is not in here did not come
 * from this company, which is the property `tests/finops-example-one-company.test.js`
 * asserts across all three blocks of the brief.
 */
export const EXAMPLE_DEPARTMENT_NAME_SET = Object.freeze(
  Object.values(EXAMPLE_DEPARTMENT_NAMES));

/**
 * The pseudonym tail each name belongs to.
 *
 * `local-finops.js` publishes a unit's label as `Department …${id.slice(-6)}`,
 * so the tail is a function of the wire id and nothing else — this is still
 * keyed on identity, reached through the one string the translator derives from
 * that identity. A tail is six characters; a shorter `…0001` from some other
 * dataset cannot collide with one.
 */
const EXAMPLE_UNIT_TAIL_NAMES = Object.freeze(Object.fromEntries(
  Object.entries(EXAMPLE_DEPARTMENT_NAMES).map(([id, name]) => [id.slice(-6), name])));

/** The three shapes the translator prints an elided unit in, and only those. */
const ELIDED_UNIT = /(?:Department|Active unit|unit) …([a-z0-9]{6})/g;

/** One published sentence or label, in this company's vocabulary. */
function speak(text) {
  return text.replace(ELIDED_UNIT, (whole, tail) => EXAMPLE_UNIT_TAIL_NAMES[tail] ?? whole);
}

/** The same value with every string in it spoken. Frozen on the way out. */
function spoken(value) {
  if (typeof value === "string") return speak(value);
  if (Array.isArray(value)) return Object.freeze(value.map(spoken));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, spoken(item)])));
  }
  return value;
}

/**
 * The same envelope, with this company's own names on it.
 *
 * Applied at the brief's composition layer rather than inside the translator, on
 * purpose: the analysis envelope is what every export, snapshot, and stored
 * period is built from, and renaming units in there would rewrite records that
 * are supposed to say what the file said. What a *reader* is shown is a display
 * decision, and this is the one place the example makes it.
 *
 * WHY IT IS A PASS OVER THE WHOLE ENVELOPE AND NOT A FIELD LIST (#1017). The
 * ranked departments were the only thing this renamed, and the elided label is
 * in thirty-six places: `topDepartment`, each unit's `unit.label`, the
 * down-routing candidates' `unitLabel`, the literacy roster, the widen-the-sample
 * next action, and `action` — the derived sentence the canonical decision record
 * is built from, which is how "Department …atlas0" reached the circulation
 * block. A field list is a list the next field is missing from, so the rule is
 * stated once and applied everywhere instead: any string the analysis published
 * that names a unit by its elided tail names it by the company's word for it.
 * Identifiers carry no ellipsis and are untouched, so every export, digest and
 * stored period still says exactly what the file said.
 *
 * Total. A null envelope, a missing ranking, and a unit this table has no name
 * for all come back unchanged rather than blank.
 */
export function nameExampleDepartments(analysis) {
  const ranked = analysis?.rankedDepartments;
  if (!analysis || typeof analysis !== "object" || !Array.isArray(ranked)) return analysis;
  const said = spoken(analysis);
  return Object.freeze({
    ...said,
    rankedDepartments: Object.freeze(said.rankedDepartments.map((department) => {
      const name = EXAMPLE_DEPARTMENT_NAMES[department?.id];
      return name ? Object.freeze({ ...department, name }) : department;
    })),
  });
}

/** How many peers a cohort position needs before it is a position at all. */
export const EXAMPLE_COHORT_MINIMUM_PEERS = 2;

/**
 * What the peer block says when the dataset cannot support one, and what would
 * unblock it.
 *
 * Two sentences, never a dash, an empty list, or a hidden block — the idiom this
 * page already uses for a withheld finding. The first names what is missing; the
 * second names the input that would produce it, because a reader who is told
 * only "unavailable" has nothing to do next.
 */
export const EXAMPLE_COHORT_UNAVAILABLE = Object.freeze({
  tooFewPeers: {
    reason: `No peer position: fewer than ${EXAMPLE_COHORT_MINIMUM_PEERS} departments in this `
      + "example produced a cost per successful task, so there is no cohort to place one inside.",
    needed: "Two or more departments must carry both attributed spend and at least one successful "
      + "task in the reporting period before a peer position can be stated.",
  },
  noMedian: {
    reason: "No peer position: the departments in this example produced no median cost per "
      + "successful task, so there is no midpoint to compare any of them against.",
    needed: "A department's spend and its successful-task count must both be present for the "
      + "median to be computable.",
  },
});

/** The midpoint of an ordered list of numbers, or null for an empty one. */
function medianOf(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function cohortWithheld({ reason, needed }, peers) {
  return Object.freeze({
    available: false,
    peers,
    peerNames: Object.freeze(peers.map((peer) => peer.name)),
    medianValue: null,
    medianDisplay: null,
    metricId: COST_METRIC.id,
    rubricVersion: COST_POSITION_VERSION,
    literacyRubricVersion: RUBRIC_VERSION_ID,
    reason,
    needed,
  });
}

/**
 * Where each of this company's departments sits against the others.
 *
 * The peer entries are not a parallel copy of the roster: they are built from
 * the SAME envelope the headline benchmark divides and the SAME task ledger the
 * org-level position counts, relabelled through `nameExampleDepartments`. So a
 * name in the peer line is by construction a name the headline and the literacy
 * letter are talking about, over the same reporting period.
 *
 * The median is derived here and never authored — a hand-written midpoint is a
 * figure that survives the dataset changing under it.
 *
 * @param analysis the example envelope; relabelled here if it was not already.
 * @param tasks the reporting window's task ledger. Defaults to this example's.
 */
export function exampleCohortPosition({ analysis = null, tasks = EXAMPLE_TASK_LEDGER } = {}) {
  const named = nameExampleDepartments(analysis);
  const departments = Array.isArray(named?.rankedDepartments) ? named.rankedDepartments : [];
  const peers = [];
  for (const department of departments) {
    const successfulTasks = countSuccessfulTasks(
      (Array.isArray(tasks) ? tasks : []).filter((row) => row?.orgUnitId === department?.id));
    const value = costPerSuccessfulTask(Number(department?.spendUsd), successfulTasks);
    if (value === null) continue;
    peers.push(Object.freeze({
      id: department.id,
      name: department.name,
      successfulTasks,
      value,
      valueDisplay: displayCostPerSuccessfulTask(value),
    }));
  }
  peers.sort((left, right) => left.value - right.value || left.id.localeCompare(right.id));
  const frozen = Object.freeze(peers);
  if (frozen.length < EXAMPLE_COHORT_MINIMUM_PEERS) {
    return cohortWithheld(EXAMPLE_COHORT_UNAVAILABLE.tooFewPeers, frozen);
  }
  const medianValue = medianOf(frozen.map((peer) => peer.value));
  if (medianValue === null) return cohortWithheld(EXAMPLE_COHORT_UNAVAILABLE.noMedian, frozen);
  return Object.freeze({
    available: true,
    peers: frozen,
    peerNames: Object.freeze(frozen.map((peer) => peer.name)),
    medianValue,
    medianDisplay: displayCostPerSuccessfulTask(medianValue),
    metricId: COST_METRIC.id,
    /** The rubric the band boundaries above were computed under. */
    rubricVersion: COST_POSITION_VERSION,
    /** And the one the literacy letter beside them was graded under. */
    literacyRubricVersion: RUBRIC_VERSION_ID,
    reason: null,
    needed: null,
  });
}

const USAGE_UNIT = Object.freeze({
  "text-generation": "tokens",
  "image-generation": "images",
  embedding: "tokens",
  storage: "byte-hours",
  other: "requests",
});

// Usage is a declared contract field, so it has to be present and plausible. It
// is derived from the cost so the dataset stays internally consistent; no
// analysis in this repo reads it.
const USAGE_PER_MINOR = Object.freeze({
  "text-generation": 340, "image-generation": 0.02, embedding: 900,
  storage: 12, other: 1,
});

/** The day of the month each row in a department's mix is billed on. */
const BILLING_DAYS = Object.freeze(["05", "12", "19"]);

function unitTail(unitId) {
  return unitId.slice(-6);
}

/**
 * Split a month's department total across its service mix in minor units. The
 * shares are integer percentages and every total is a whole multiple of 100 USD,
 * so each slice is exact; the last row still absorbs any remainder so the rows
 * can never fail to sum to the declared total.
 */
function allocate(totalMinor, mix) {
  const amounts = mix.map(([, , share], index) =>
    index === mix.length - 1 ? 0 : Math.floor((totalMinor * share) / 100));
  amounts[amounts.length - 1] = totalMinor - amounts.reduce((sum, value) => sum + value, 0);
  return amounts;
}

function providerRecords(monthIndex) {
  const yearMonth = MONTHS[monthIndex];
  const compact = yearMonth.replace("-", "");
  const records = [];
  for (const department of DEPARTMENTS) {
    const amounts = allocate(department.monthlyUsd[monthIndex] * 100, department.mix);
    department.mix.forEach(([provider, serviceCategory], row) => {
      records.push({
        aggregate_id: `psn_example_agg_${compact}_${unitTail(department.unitId)}_${row + 1}`,
        revision: 1,
        usage_date: `${yearMonth}-${BILLING_DAYS[row]}`,
        org_unit_id: department.unitId,
        provider,
        service_category: serviceCategory,
        usage: {
          quantity: Math.round(amounts[row] * USAGE_PER_MINOR[serviceCategory]),
          unit: USAGE_UNIT[serviceCategory],
        },
        // The v1.1 detail block, every key present. The SKU is carried only on
        // the token-billed text-generation rows, because those are the rows this
        // invented provider names a model on; storage, embedding and image rows
        // carry it as absent rather than as a guessed default.
        ...usageDetail({
          model: serviceCategory === "text-generation" ? department.model : null,
        }),
        cost: { amount_minor: amounts[row], currency: "USD", status: "final" },
      });
    });
  }
  return records;
}

function providerExport(monthIndex) {
  const yearMonth = MONTHS[monthIndex];
  const periodEnd = `${nextMonth(yearMonth)}-01`;
  return {
    schema_version: PROVIDER_USAGE_SCHEMA_VERSION,
    kind: "wawalu.integration.provider-usage-billing",
    export_id: `1e5a0000-0000-4000-8000-${String(monthIndex + 1).padStart(12, "0")}`,
    snapshot: {
      source_instance_id: PROVIDER_SOURCE,
      sequence: monthIndex + 1,
      generated_at: `${periodEnd}T00:00:00Z`,
      period_start: `${yearMonth}-01`,
      period_end: periodEnd,
      completeness: "complete",
      omitted_record_count: 0,
      issues: [],
    },
    privacy: {
      aggregation: "daily-org-unit-service",
      minimum_group_size: 10,
      direct_identifiers_included: false,
      content_included: false,
    },
    records: providerRecords(monthIndex),
  };
}

function hrisExport() {
  const effectiveAt = `${MONTHS[0]}-01T00:00:00Z`;
  return {
    schema_version: "1.0",
    kind: "wawalu.integration.hris-org",
    export_id: "2e5a0000-0000-4000-8000-000000000001",
    snapshot: {
      source_instance_id: HRIS_SOURCE,
      sequence: 1,
      generated_at: `${MONTHS.at(-1)}-30T00:00:00Z`,
      mode: "full",
      completeness: "complete",
      omitted_record_count: 0,
      issues: [],
    },
    privacy: {
      identifier_method: "hmac-sha256-truncated",
      direct_identifiers_included: false,
      salt_scope: "tenant-integration-v1",
    },
    records: [
      {
        unit_id: COMPANY_UNIT,
        revision: 1,
        operation: "upsert",
        effective_at: effectiveAt,
        parent_unit_id: null,
        unit_type: "company",
        active: true,
      },
      ...DEPARTMENTS.map((department) => ({
        unit_id: department.unitId,
        revision: 1,
        operation: "upsert",
        effective_at: effectiveAt,
        parent_unit_id: COMPANY_UNIT,
        unit_type: "department",
        active: true,
      })),
    ],
  };
}

/**
 * The dataset as files, in the byte shape the importer accepts. A test can hand
 * these to the translator directly; the page hands them to the same call the
 * file input uses.
 */
export function exampleDatasetFiles() {
  return [
    ...MONTHS.map((yearMonth, index) => ({
      fileName: `example-provider-${yearMonth}.json`,
      mediaType: "application/json",
      text: JSON.stringify(providerExport(index), null, 2),
    })),
    {
      fileName: "example-hris-org.json",
      mediaType: "application/json",
      text: JSON.stringify(hrisExport(), null, 2),
    },
  ];
}

// ---------------------------------------------------------------------------
// THE SCORED QUERY SAMPLE — what makes the rubric reach this example at all.
//
// Before this, the bundled example was billing and nothing else, so
// `analyzeQueryLiteracy` had no rows to score, every department came back
// `no_sampled_queries`, and the trust panel reported that the rubric had scored
// none of the $154,500 in scope while the panel beside it quoted a modelled
// recoverable over that same spend. The example could not exercise the one gate
// it exists to demonstrate.
//
// WHICH TEAMS ARE SAMPLED, AND WHY NOT ALL OF THEM. Atlas, Boreal, Cinder and
// Quartz route through the invented gateway that emits this sample; Ember does
// not.
//
// Atlas was outside the sample until #1482 and that was the wrong shape. Atlas
// carries $79,000 of the $154,500 in scope — a clear majority — so leaving it
// unscored held sampled-spend coverage at 42%, under the 50% bar
// `export-gradability.js` publishes a grade at. The worked example therefore
// demonstrated the withheld path and nothing else: the graded floor beside the
// modelled figure could never be published, and a first-time reader never saw
// the figure the region exists to show. Scoring the department that drives the
// increase is also the honest shape — it is the one a reader would sample first
// — and it takes coverage to 93%.
//
// EMBER STAYS OUT, DELIBERATELY. A sample covering every team would leave no
// residue to rank, no uncovered cluster for the eligibility verdict to name,
// and nothing for the ungraded-department exclusion in the graded floor to
// exclude. Ember is $11,000 of the total, so the example still teaches that
// coverage is partial without hiding the figure behind a shortfall.
//
// Atlas's own mix is deliberately the weakest of the four — one high-value
// query against two over-provisioned, two inefficient and one out-of-scope —
// because a department whose spend jumped hardest while its prompts stayed
// worst is the finding this example is built to produce. Its score is a
// consequence of that mix and of the published rubric weights; nothing here
// assigns it a number.
//
// Every row is invented, carries a pre-assigned rubric category rather than a
// prompt excerpt — the contract's other accepted shape — and joins a billed
// (department, model) pair from the records above.
const SAMPLE_DAYS = Object.freeze(["15", "16", "17", "18", "19", "20"]);

/** Six sampled queries per sampled team, in `SAMPLE_DAYS` order. */
const SAMPLED_UNITS = Object.freeze([
  Object.freeze({
    unitId: "psn_example_unit_atlas0",
    categories: Object.freeze([
      "overProvisioned", "inefficient", "highValue", "inefficient", "overProvisioned", "outOfScope",
    ]),
  }),
  Object.freeze({
    unitId: "psn_example_unit_boreal",
    categories: Object.freeze([
      "highValue", "highValue", "overProvisioned", "highValue", "inefficient", "highValue",
    ]),
  }),
  Object.freeze({
    unitId: "psn_example_unit_cinder",
    categories: Object.freeze([
      "highValue", "inefficient", "overProvisioned", "inefficient", "outOfScope", "highValue",
    ]),
  }),
  Object.freeze({
    unitId: "psn_example_unit_quartz",
    categories: Object.freeze([
      "highValue", "overProvisioned", "highValue", "inefficient", "highValue", "overProvisioned",
    ]),
  }),
]);

const SAMPLE_HEADER = Object.freeze([
  "org_unit_id", "query_date", "model", "input_tokens", "output_tokens", "prompt_excerpt", "category",
]);

/** The sample as bytes, in the delimited shape the query-sample contract accepts. */
export function exampleQuerySampleText() {
  const modelFor = new Map(DEPARTMENTS.map((department) => [department.unitId, department.model]));
  const lines = [SAMPLE_HEADER.join(",")];
  SAMPLE_DAYS.forEach((day, index) => {
    for (const unit of SAMPLED_UNITS) {
      lines.push([
        unit.unitId, `${MONTHS.at(-1)}-${day}`, modelFor.get(unit.unitId),
        String(900 + index * 40), String(500 + index * 20), "", unit.categories[index],
      ].join(","));
    }
  });
  return `${lines.join("\n")}\n`;
}

/**
 * The sample in the shape `analyzeQueryLiteracy` consumes.
 *
 * The bytes go through `parseQuerySample` and `classifyQuerySample` — the real
 * validator and the real classification pass, no bypass branch — and what comes
 * back is renamed into the record shape the analyzer reads. A row that carried
 * no rubric category never reaches it, because `classifyQuerySample` drops it
 * rather than guessing one.
 */
export function loadExampleQuerySample() {
  const parsed = parseQuerySample(exampleQuerySampleText());
  const classified = classifyQuerySample(parsed);
  const records = Object.freeze(classified.records.map((record) => Object.freeze({
    department: record.orgUnitId, model: record.model, category: record.category, classified: true,
  })));
  const total = parsed.records?.length ?? 0;
  return Object.freeze({
    records,
    counts: Object.freeze({
      total,
      accepted: records.length,
      classified: records.length,
      unclassified: total - records.length,
      rejected: parsed.skippedRowCount ?? 0,
    }),
  });
}

/**
 * Translate the fixture and hand back the parsed inputs, in exactly the shape
 * the file input accumulates them. The page needs these and not only the
 * analysis: the trust verdict is computed from the parsed rows and the roster,
 * so handing it a bare envelope would force it to re-parse the same bytes.
 *
 * The query sample rides on the reporting period's provider entry, which is the
 * period it sampled and the only one the analysis scores.
 */
export function loadExampleDatasetInputs() {
  const providers = [];
  let hris = null;
  for (const file of exampleDatasetFiles()) {
    const parsed = parseLocalFinopsFile(file.text, file.fileName, file.mediaType);
    if (parsed.type === "provider") providers.push(parsed);
    else hris = parsed;
  }
  const reporting = providers.length - 1;
  providers[reporting] = { ...providers[reporting], querySample: loadExampleQuerySample() };
  return { providers, hris };
}

/**
 * Translate the fixture, analyze it, and put this company's own names on it.
 *
 * The same two calls, in the same order, a selected set of files walks through
 * in evolution-page.js — and then the one display decision above, applied HERE
 * rather than at each composer (#1017). Four surfaces read this function: the
 * stand headline, the first-screen answer block, the evidence briefing and the
 * department drill-down. Three of them did not relabel, so the page said
 * "Department …atlas0 is driving the increase" beside panels naming Atlas
 * Platform. A rename every caller has to remember is a rename the next caller
 * forgets; this is the choke point, so there is nowhere left to forget it.
 *
 * Identifiers are untouched, so every export and stored period still says
 * exactly what the file said.
 */
export function loadExampleDataset() {
  return nameExampleDepartments(normalizeLocalFinopsHistory(loadExampleDatasetInputs()));
}
