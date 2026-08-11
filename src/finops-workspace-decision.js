// The one question the returning FinOps lead's surface answers, and the single
// action that follows from the answer.
//
// THE QUESTION
// ------------
// "Do I have enough prior-period evidence to judge last month's commitment?"
// Everything else on that surface is subordinate to this answer. This module
// decides it; the page renders it and decides nothing.
//
// THE DEFINITIONS, WRITTEN SO TWO ENGINEERS COMPUTE THEM IDENTICALLY
// ------------------------------------------------------------------
//   RETAINED PERIOD — a stored period record carrying a period identifier, an
//   actual-spend figure, and a committed-spend figure, both numeric and
//   non-null. Actual spend is the period's own `analyzedSpendMinor`. Committed
//   spend is `claim.projectedMonthlyCostMinor` from the retained commitment
//   filed under the same `periodId` — the monthly cost that month was committed
//   to. A period missing either figure is not retained; it is an INCOMPLETE
//   record, and so is one whose committed spend is zero or negative, because a
//   utilization divided by it is not a large number, it is not a number.
//
//   MINIMUM EVIDENCE — `MINIMUM_EVIDENCE_PERIODS` retained periods that are
//   CONSECUTIVE calendar months from the same dataset, the later of which is
//   the month under judgement (the newest retained month). Two retained months
//   with a gap between them do not satisfy it, and no absent month is estimated
//   to close one.
//
//   MOVEMENT — the material benchmark shown once evidence is sufficient.
//   Utilization for a period is actual ÷ committed, as a percentage of
//   committed spend; movement is the later utilization minus the earlier one,
//   in percentage points, rounded to one decimal place. Spending a smaller
//   share of what was committed is `improved`, a larger share is `worsened`,
//   and a rounded movement under `UNCHANGED_MOVEMENT_POINTS` is `unchanged`.
//
//   PORTABLE-RECORD AVAILABILITY — an explicit input, never inferred from a
//   period count: whether a versioned portable FinOps record is present and
//   importable in this browser session. The page supplies it from the portable
//   record it holds this session, validated by `parseFinopsPortableRecord`.
//
// ORDER IS THE CONTRACT
// ---------------------
// Candidates are built in precedence order and the first is primary, so there
// is exactly one primary action per state and the rest are visibly subordinate.
// Import outranks adding a month whenever a portable record is available beside
// any other gap — a record already held closes several months in one press,
// where adding a month closes one.
//
// Deliberately excluded: forecasts, causal attribution, realized invoice
// savings, and any provenance beyond period identifiers and declared source
// labels. Prompts, credentials, and customer data have no field here.

export const WORKSPACE_DECISION_QUESTION =
  "Do I have enough prior-period evidence to judge last month’s commitment?";

/** Exactly this many retained periods, and they must be consecutive months. */
export const MINIMUM_EVIDENCE_PERIODS = 2;

/** Movement below this many percentage points reads as unchanged, not as noise. */
export const UNCHANGED_MOVEMENT_POINTS = 0.1;

const MONTH = /^\d{4}-\d{2}$/;

/** Months as a single comparable integer, so "consecutive" survives a year end. */
const monthIndex = (month) => (MONTH.test(String(month))
  ? Number(String(month).slice(0, 4)) * 12 + Number(String(month).slice(5, 7)) - 1
  : null);

/** `dataset:YYYY-MM` — the prefix a comparison is never allowed to cross. */
const datasetOf = (periodId) => (typeof periodId === "string" && periodId.includes(":")
  ? periodId.slice(0, periodId.indexOf(":")) : null);

const finite = (value) => value !== null && value !== undefined && Number.isFinite(value);

const plural = (count, noun) => `${count} ${count === 1 ? noun : `${noun}s`}`;

const percent = (value) => `${(Math.round(value * 10) / 10).toFixed(1)}%`;

/** Split the stored document into retained periods and incomplete records. */
function classify(document) {
  const committed = new Map();
  for (const commitment of document?.commitments ?? []) {
    const minor = commitment?.claim?.projectedMonthlyCostMinor;
    if (typeof commitment?.periodId === "string" && finite(minor)) {
      committed.set(commitment.periodId, minor);
    }
  }
  const retained = [];
  const incomplete = [];
  for (const period of document?.periods ?? []) {
    const committedMinor = committed.get(period?.periodId);
    const entry = Object.freeze({
      periodId: period?.periodId ?? null,
      period: period?.period ?? null,
      dataset: period?.dataset ?? datasetOf(period?.periodId),
      month: monthIndex(period?.period),
      actualMinor: finite(period?.analyzedSpendMinor) ? period.analyzedSpendMinor : null,
      committedMinor: finite(committedMinor) ? committedMinor : null,
    });
    const complete = entry.month !== null && entry.actualMinor !== null && entry.committedMinor > 0;
    (complete ? retained : incomplete).push(entry);
  }
  retained.sort((left, right) => left.month - right.month);
  return { retained, incomplete };
}

/**
 * The two months under judgement, or null.
 *
 * The later month is the newest retained one — "last month" is whatever the
 * store's newest complete record is, not a calendar month this page invents.
 * The earlier one has to be the month immediately before it, in the same
 * dataset: an example month and an imported month are not each other's prior
 * period even when they share a name.
 */
function evidencePair(retained) {
  const later = retained.at(-1);
  if (!later) return null;
  const earlier = retained.find((entry) =>
    entry.month === later.month - 1 && entry.dataset === later.dataset);
  return earlier ? [earlier, later] : null;
}

const utilization = (entry) => (entry.actualMinor / entry.committedMinor) * 100;

function movementOf(earlier, later) {
  const from = utilization(earlier);
  const to = utilization(later);
  const points = Math.round((to - from) * 10) / 10;
  const direction = Math.abs(points) < UNCHANGED_MOVEMENT_POINTS ? "unchanged"
    : points < 0 ? "improved" : "worsened";
  return Object.freeze({
    earlierPeriod: earlier.period,
    laterPeriod: later.period,
    earlierUtilizationPercent: Math.round(from * 10) / 10,
    laterUtilizationPercent: Math.round(to * 10) / 10,
    points,
    direction,
    label: `Commitment utilization ${direction} between ${earlier.period} and ${later.period}`,
    statement: direction === "unchanged"
      ? `Commitment utilization was unchanged between ${earlier.period} and ${later.period}: `
        + `${percent(from)} of committed spend, then ${percent(to)}, a movement under `
        + `${UNCHANGED_MOVEMENT_POINTS} percentage points.`
      : `Commitment utilization ${direction} by ${Math.abs(points).toFixed(1)} percentage points, `
        + `from ${percent(from)} of committed spend in ${earlier.period} to ${percent(to)} in `
        + `${later.period}.`,
    formula: "utilization = actual spend ÷ committed spend, as a percentage of committed spend; "
      + "movement = later utilization − earlier utilization, in percentage points, rounded to one "
      + "decimal place.",
  });
}

/**
 * The candidate actions, in precedence order. The first is primary; the rest
 * are secondary and the page must render them as subordinate to it.
 */
function candidates({ sufficient, portableRecordAvailable, periodCount, movement, evidence }) {
  const list = [];
  if (sufficient) {
    list.push({
      code: "commitment_verdict",
      headline: "Record the decision this movement sizes",
      why: `${movement.statement} Two consecutive retained months are on file, so last month's `
        + "commitment can be judged. Recording it is what gives the movement an owner and an outcome.",
      label: "Record a commitment",
      kind: "link",
      href: "/savings-commitment.html",
    });
  }
  if (portableRecordAvailable) {
    list.push({
      code: "import_portable_record",
      headline: "Import your portable record",
      why: "A versioned FinOps record you already hold is ready to import in this browser. It comes "
        + "first because it can close several months of the gap in one press, where adding a month "
        + "closes one. Nothing is written until you approve the source review.",
      label: "Import your portable record",
      kind: "import",
    });
  }
  if (periodCount > 0) {
    list.push({
      code: "add_month",
      headline: "Add a month",
      why: `${evidence.statement} There is no portable record to import here, so the gap closes one `
        + "month at a time: analyse the missing month on the AI FinOps page and it is kept beside "
        + "the months already here.",
      label: "Open the AI FinOps page",
      kind: "link",
      href: "/evolution.html",
    });
  } else {
    // The first-run wording this page already ships, rather than a second label
    // for the same state.
    list.push({
      code: "first_import",
      headline: "Import a provider export",
      why: "Nothing is kept here yet and no portable record is available to import. The first "
        + "analysis you run on the AI FinOps page is kept as derived monthly figures, and a second "
        + "month beside it is what makes a commitment judgeable.",
      label: "Open the AI FinOps page",
      kind: "link",
      href: "/evolution.html",
    });
  }
  return list;
}

/** Period identifiers and declared source labels. Never a figure of anyone's. */
function provenanceOf({ retained, incomplete, pair, sourceDeclarations, portableRecordAvailable }) {
  const named = (entries) => (entries.length
    ? entries.map((entry) => entry.periodId).join(", ") : "none");
  return Object.freeze([
    {
      term: "Periods counted",
      detail: pair
        ? `${named(pair)} — the two consecutive retained months this answer is computed from.`
        : `${named(retained)}. ${MINIMUM_EVIDENCE_PERIODS} consecutive retained months are `
          + "required, so nothing was computed from them yet.",
    },
    {
      term: "Incomplete records",
      detail: incomplete.length
        ? `${named(incomplete)} — kept, but missing an actual or a committed figure, so not counted `
          + "as evidence."
        : "None. Every period kept here carries both an actual and a committed figure.",
    },
    {
      term: "Declared sources",
      detail: sourceDeclarations.length
        ? sourceDeclarations.map((entry) =>
          `${entry.role}: ${entry.contractKind} ${entry.contractVersion} via ${entry.mappingVersion} `
          + `(${String(entry.reuseState).replace(/_/g, " ")})`).join("; ")
        : "No provider or HRIS source is declared in this browser.",
    },
    {
      term: "Portable record",
      detail: portableRecordAvailable
        ? "A versioned portable record is present in this session and can be imported here."
        : "No portable record is present in this session to import.",
    },
  ].map((row) => Object.freeze(row)));
}

const LIMITATIONS = Object.freeze([
  "Utilization compares the analyzed spend kept for a month against the monthly cost committed for "
  + "that same month. It does not prove the commitment caused the movement, and it is not a "
  + "realized invoice saving.",
  "Only two consecutive retained months are compared. A missing month is never estimated, and a "
  + "month without a committed figure is evidence of nothing.",
  "Every figure is read from what this browser already kept. No provider file, prompt, credential, "
  + "or customer record is read to produce this answer, and none is shown behind it.",
]);

/**
 * Build the answer state the returning-lead surface renders.
 *
 * @param options.document the retained workspace document, as `readFinopsDocument`
 *   returns it. Absent or empty is a first-run state, not an error.
 * @param options.portableRecordAvailable whether a versioned portable record is
 *   present and importable in this browser session. A real input: it is never
 *   inferred from how many periods are retained.
 * @param options.sourceDeclarations the provider/HRIS declarations the portable
 *   record preserves, for the provenance disclosure only.
 * @returns a frozen decision. Total: it never throws.
 */
export function buildWorkspaceDecision({
  document = null, portableRecordAvailable = false, sourceDeclarations = [],
} = {}) {
  const available = portableRecordAvailable === true;
  const declarations = Array.isArray(sourceDeclarations) ? sourceDeclarations : [];
  const { retained, incomplete } = classify(document);
  const pair = evidencePair(retained);
  const sufficient = pair !== null;
  const periodCount = retained.length + incomplete.length;

  const evidence = Object.freeze({
    sufficient,
    requiredPeriods: MINIMUM_EVIDENCE_PERIODS,
    retainedPeriodCount: retained.length,
    incompletePeriodCount: incomplete.length,
    periods: Object.freeze(pair ? pair.map((entry) => entry.periodId) : []),
    months: Object.freeze(pair ? pair.map((entry) => entry.period) : []),
    statement: sufficient
      ? `Yes: ${pair[0].period} and ${pair[1].period} are consecutive retained months, and `
        + `${pair[1].period} is the month under judgement.`
      : `Not yet: judging last month's commitment needs ${MINIMUM_EVIDENCE_PERIODS} consecutive `
        + `retained months, and this browser holds ${plural(retained.length, "retained month")}`
        + (incomplete.length
          ? ` beside ${plural(incomplete.length, "incomplete record")}.`
          : "."),
  });

  const movement = sufficient ? movementOf(pair[0], pair[1]) : null;
  const actions = candidates({
    sufficient, portableRecordAvailable: available, periodCount, movement, evidence,
  });

  return Object.freeze({
    question: WORKSPACE_DECISION_QUESTION,
    answer: sufficient ? "yes" : "not_yet",
    evidence,
    movement,
    portableRecordAvailable: available,
    primaryAction: Object.freeze(actions[0]),
    secondaryActions: Object.freeze(actions.slice(1).map((action) => Object.freeze(action))),
    provenance: provenanceOf({
      retained, incomplete, pair, sourceDeclarations: declarations,
      portableRecordAvailable: available,
    }),
    limitations: LIMITATIONS,
  });
}
