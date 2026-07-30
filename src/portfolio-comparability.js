// The portfolio comparability contract: may these providers' delivery records be
// combined into one portfolio figure yet, and if not, what single thing recovers
// it.
//
// WHY THIS EXISTS. `multi-provider-intake.js` answers a question about *files*:
// which exports may be read side by side, and what happens to the ones that may
// not. It answers it while a reader is choosing files. A FinOps lead asks a
// question one level up, before and after that step:
//
//     Can I responsibly combine this portfolio now?
//
// That is not the same question. An intake can accept three exports happily and
// still leave a portfolio uncombinable — because the fourth provider the lead
// pays was never in the selection at all, because one export covers a fortnight
// that straddles the month everyone else reported, or because one is priced in
// another currency. None of those is a parse failure. Each one makes a combined
// figure a claim nobody can defend, and the reader has to be told so in those
// words, not shown three green rows and left to notice the absence.
//
// So this module states the judgment as data: a yes/no/not-yet verdict, the
// share of the expected portfolio that is comparable, the evidence behind both,
// and exactly one next action.
//
// WHAT IT REFUSES TO READ AT ALL. The input shape is a *closed* field set —
// `PORTFOLIO_SAMPLE_FIELDS` — and a portfolio carrying any field outside it is
// refused whole, before a single value is read, with the offending key named and
// nothing else about it reported. That is not tidiness. This contract's privacy
// claim is that it holds counts, windows, currency codes, and a provenance label
// and nothing else; an undeclared field is unbounded input, and a credential, a
// prompt, or a customer would ride into the result and onto the page through it.
// A closed contract that silently tolerates extra keys is not closed, so the
// tolerance is the defect and the refusal is the feature.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT DO. It does not aggregate cost, and it
// carries no money field of any kind. It does not rank providers — a portfolio
// is not a league table, and the question is whether the set is combinable, not
// who is worst. It opens no adapter and reads no credential: the evaluation unit
// is a count of delivered requests and a provenance *label*. The contract is
// shaped so a later aggregation layer or a live adapter can consume it
// unchanged; neither is implemented here.
//
// WHAT THIS MODULE NEVER DOES. No fetch, no storage, no credential, no clock, no
// randomness. Calendar arithmetic is done on ISO-8601 date strings by hand — a
// fixed-width `YYYY-MM-DD` sorts chronologically under ordinary string
// comparison — so nothing here can read the current time even by accident.
//
// SCHEMA VERSION. `wawalu.finops.portfolio-comparability/1.1`. Bump when a
// field, a state, a remediation tier, or a metric definition changes meaning: a
// stored verdict is only interpretable by the version that produced it. 1.1
// enforces the closed field set that 1.0 only declared.

/** The contract's own identity. Consumers allowlist the exact version. */
export const PORTFOLIO_COMPARABILITY_KIND = "wawalu.finops.portfolio-comparability";
export const PORTFOLIO_COMPARABILITY_VERSION = "1.1";
export const PORTFOLIO_COMPARABILITY_CONTRACT_ID =
  `${PORTFOLIO_COMPARABILITY_KIND}/${PORTFOLIO_COMPARABILITY_VERSION}`;

/**
 * The four questions this contract answers, in the order a leader asks them.
 * The order is the product decision: a coverage percentage read before the
 * yes/no invites a reader to combine an 80%-covered portfolio, and an action
 * read before the evidence is an instruction with no argument behind it.
 */
export const PORTFOLIO_QUESTIONS = Object.freeze([
  Object.freeze({ id: "combine", order: 1, question: "Can I responsibly combine this portfolio now?" }),
  Object.freeze({ id: "coverage", order: 2, question: "How much of the expected portfolio is comparable?" }),
  Object.freeze({ id: "trust", order: 3, question: "Why should I trust or question this?" }),
  Object.freeze({ id: "action", order: 4, question: "What single action should I take next?" }),
]);

/**
 * Three verdicts, and the difference between the last two is the whole point.
 *
 * `yes`      Every required provider is covered on the same window in one
 *            currency, with nothing duplicated or overlapping.
 * `not_yet`  The declaration is answerable and the answer is currently no. A
 *            different set of records fixes it, and `nextAction` names the one
 *            to fetch.
 * `no`       The declaration itself cannot support a judgment — no required
 *            providers, no valid period, no portfolio currency, or a field this
 *            contract does not declare. No record supplied later fixes that; the
 *            question has to be re-asked.
 */
export const COMPARABILITY_VERDICT = Object.freeze({
  yes: "yes",
  notYet: "not_yet",
  no: "no",
});

/** Why a provider is not contributing, or that it is. */
export const PROVIDER_STATE = Object.freeze({
  covered: "covered",
  missing: "missing",
  duplicate: "duplicate",
  overlapping: "overlapping",
  misaligned: "misaligned",
  incompatibleCurrency: "incompatible_currency",
  unreadableCount: "unreadable_count",
  undeclared: "undeclared",
});

/** Every finding this contract can raise about a provider. */
export const FINDING_CODE = Object.freeze({
  MISSING_PROVIDER: "missing_provider",
  DUPLICATE_RECORD: "duplicate_record",
  OVERLAPPING_PERIOD: "overlapping_period",
  MISALIGNED_PERIOD: "misaligned_period",
  INCOMPATIBLE_CURRENCY: "incompatible_currency",
  UNREADABLE_COUNT: "unreadable_count",
  UNDECLARED_PROVIDER: "undeclared_provider",
});

/**
 * The remediation tiers, in priority order. Exactly one action is ever offered,
 * and this list plus required-provider declaration order is the whole rule: the
 * first tier with any provider in it wins, and within a tier the
 * earliest-declared provider wins. Two engineers, two implementations, same
 * action.
 *
 * The order is not arbitrary. A missing provider is the only fault that changes
 * the size of the portfolio, so it outranks faults that change its shape. A
 * window fault outranks a currency fault because re-exporting the right window
 * often fixes the currency too — a provider's export tool usually emits one
 * currency per account, and the wrong window is the more common mistake.
 * `undeclared_provider` is deliberately absent: it is never an action, because
 * the fix is to change the declaration, which is the reader's decision and not
 * this contract's to recommend.
 */
export const REMEDIATION_TIERS = Object.freeze([
  Object.freeze([FINDING_CODE.MISSING_PROVIDER]),
  Object.freeze([
    FINDING_CODE.DUPLICATE_RECORD,
    FINDING_CODE.OVERLAPPING_PERIOD,
    FINDING_CODE.MISALIGNED_PERIOD,
  ]),
  Object.freeze([FINDING_CODE.INCOMPATIBLE_CURRENCY]),
  Object.freeze([FINDING_CODE.UNREADABLE_COUNT]),
]);

/** The action offered when nothing is wrong. */
export const NO_ACTION_CODE = "none";

/** How many decimal places a stored ratio carries. Rounded half-up. */
export const RATIO_PRECISION = 4;

// --- the closed field set ---------------------------------------------------

/**
 * Every field a portfolio, a record, and a provenance block may carry. Closed,
 * and enforced below rather than described: a key outside this set refuses the
 * portfolio whole.
 *
 * Adding a field here is a deliberate widening of what this product accepts into
 * a judgment, so it is a contract-version decision and a review conversation —
 * which is exactly what silently ignoring unknown keys would have avoided
 * having.
 */
export const PORTFOLIO_SAMPLE_FIELDS = Object.freeze({
  portfolio: Object.freeze([
    "portfolioId", "currencyCode", "requiredPeriodStart", "requiredPeriodEnd",
    "requiredProviders", "records",
  ]),
  record: Object.freeze([
    "providerId", "periodStart", "periodEnd", "currencyCode", "deliveryCount", "provenance",
  ]),
  provenance: Object.freeze(["label"]),
});

/** Why a portfolio was refused before any of its values were read. */
export const SAMPLE_DEFECT_CODE = Object.freeze({
  UNKNOWN_PORTFOLIO_FIELD: "unknown_portfolio_field",
  UNKNOWN_RECORD_FIELD: "unknown_record_field",
  UNKNOWN_PROVENANCE_FIELD: "unknown_provenance_field",
  MALFORMED_SAMPLE: "malformed_sample",
});

/** The action code a contract defect carries. Never a provider's fault. */
export const SAMPLE_DEFECT_ACTION_CODE = "sample_contract_defect";

const PORTFOLIO_KEYS = new Set(PORTFOLIO_SAMPLE_FIELDS.portfolio);
const RECORD_KEYS = new Set(PORTFOLIO_SAMPLE_FIELDS.record);
const PROVENANCE_KEYS = new Set(PORTFOLIO_SAMPLE_FIELDS.provenance);

const plainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * A defect names the *key* and never the value. An undeclared field is exactly
 * the place a credential or a customer's name would arrive, so quoting it back
 * to the reader — or into the DOM — would leak the thing the refusal exists to
 * stop. `field` is a key the caller already wrote; `where` locates it.
 */
const defect = (code, where, field, statement) =>
  Object.freeze({ code, where, field, statement });

const undeclaredStatement = (where, field) =>
  `${where} carries the undeclared field "${field}". Remove it: this contract reads `
  + "only its declared fields, and an undeclared one is unbounded input.";

/** Unknown keys of one object, alphabetically, so two runs report one order. */
const unknownKeys = (value, allowed) =>
  Object.keys(value).filter((key) => !allowed.has(key)).sort();

/**
 * Screen a portfolio against the closed field set.
 *
 * Called before evaluation, and callable on its own so a fixture author can ask
 * "is this sample admissible?" without producing a verdict.
 *
 * @returns frozen `{ ok, defects }`. `defects` is ordered: the portfolio's own
 *   undeclared fields first, then each record in supplied order, so the single
 *   action below is the same one every time.
 */
export function screenPortfolioSample(portfolio) {
  const defects = [];
  if (!plainObject(portfolio)) {
    defects.push(defect(SAMPLE_DEFECT_CODE.MALFORMED_SAMPLE, "This portfolio", null,
      "This portfolio is not an object, so there is no declaration to read."));
    return Object.freeze({ ok: false, defects: Object.freeze(defects) });
  }
  for (const field of unknownKeys(portfolio, PORTFOLIO_KEYS)) {
    defects.push(defect(SAMPLE_DEFECT_CODE.UNKNOWN_PORTFOLIO_FIELD, "This portfolio", field,
      undeclaredStatement("This portfolio", field)));
  }
  const records = portfolio.records;
  if (records !== undefined && !Array.isArray(records)) {
    defects.push(defect(SAMPLE_DEFECT_CODE.MALFORMED_SAMPLE, "This portfolio", "records",
      "This portfolio's \"records\" field is not a list of delivery records."));
    return Object.freeze({ ok: false, defects: Object.freeze(defects) });
  }
  for (const [index, entry] of (records ?? []).entries()) {
    const where = `Record ${index + 1}`;
    if (!plainObject(entry)) {
      defects.push(defect(SAMPLE_DEFECT_CODE.MALFORMED_SAMPLE, where, null,
        `${where} is not a delivery record object.`));
      continue;
    }
    for (const field of unknownKeys(entry, RECORD_KEYS)) {
      defects.push(defect(SAMPLE_DEFECT_CODE.UNKNOWN_RECORD_FIELD, where, field,
        undeclaredStatement(where, field)));
    }
    // A provenance block may be the bare label string or `{ label }`. Anything
    // else — a nested source document, a file handle — is refused.
    const provenance = entry.provenance;
    if (provenance === undefined || typeof provenance === "string") continue;
    if (!plainObject(provenance)) {
      defects.push(defect(SAMPLE_DEFECT_CODE.MALFORMED_SAMPLE, where, "provenance",
        `${where} carries a provenance that is neither a label nor { label }.`));
      continue;
    }
    for (const field of unknownKeys(provenance, PROVENANCE_KEYS)) {
      defects.push(defect(SAMPLE_DEFECT_CODE.UNKNOWN_PROVENANCE_FIELD,
        `${where}'s provenance`, field,
        undeclaredStatement(`${where}'s provenance`, field)));
    }
  }
  return Object.freeze({ ok: defects.length === 0, defects: Object.freeze(defects) });
}

// --- reading the declaration ------------------------------------------------

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_SHAPE = /^[A-Z]{3}$/;
const MONTH_LENGTHS = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

const leapYear = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/**
 * An ISO-8601 calendar date, or null. Validated by hand rather than by `Date`,
 * so this module reads no clock and a "2026-02-30" is a refusal instead of a
 * silent roll into March.
 */
export function calendarDate(value) {
  if (typeof value !== "string" || !DATE_SHAPE.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) return null;
  const length = month === 2 && leapYear(year) ? 29 : MONTH_LENGTHS[month - 1];
  return day > length ? null : value;
}

const currencyCode = (value) => {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return CURRENCY_SHAPE.test(upper) ? upper : null;
};

/**
 * A non-negative integer count of delivered AI requests, or null. A string that
 * looks like a number is refused rather than coerced: a count this product
 * cannot read is evidence about the export, and quietly parsing "1,204" as 1
 * would be worse than saying so.
 */
export function deliveryCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/** Half-up to `RATIO_PRECISION`, so two implementations store the same digits. */
export function roundRatio(value) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** RATIO_PRECISION;
  return Math.round(value * factor + Number.EPSILON) / factor;
}

/** The provenance *label* and nothing else. Source material never leaves here. */
function provenanceLabel(record) {
  const provenance = record?.provenance;
  const raw = typeof provenance === "string" ? provenance : provenance?.label;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Half-open [start, end) against half-open [start, end). */
const intersects = (record, period) =>
  record.start < period.end && record.end > period.start;

const aligned = (record, period) =>
  record.start === period.start && record.end === period.end;

function periodText(period) {
  return period.valid
    ? `${period.start} to ${period.end} (end exclusive)`
    : "no valid comparison period";
}

/**
 * Read the declaration. Everything that makes the question unanswerable — as
 * opposed to answerable and answered "not yet" — is decided here.
 */
function readDeclaration(portfolio) {
  const errors = [];
  const start = calendarDate(portfolio.requiredPeriodStart);
  const end = calendarDate(portfolio.requiredPeriodEnd);
  if (!start) errors.push("requiredPeriodStart: expected an ISO-8601 calendar date");
  if (!end) errors.push("requiredPeriodEnd: expected an ISO-8601 calendar date");
  if (start && end && !(start < end)) {
    errors.push("requiredPeriodEnd: must be later than requiredPeriodStart");
  }
  const currency = currencyCode(portfolio.currencyCode);
  if (!currency) errors.push("currencyCode: expected a three-letter ISO-4217 code");

  const declared = Array.isArray(portfolio.requiredProviders) ? portfolio.requiredProviders : [];
  const required = [];
  for (const entry of declared) {
    const id = typeof entry === "string" ? entry.trim() : "";
    if (!id) {
      errors.push("requiredProviders: every entry must be a non-empty provider id");
      continue;
    }
    if (required.includes(id)) {
      errors.push(`requiredProviders: ${id} is declared more than once`);
      continue;
    }
    required.push(id);
  }
  // No declaration is not full coverage. A portfolio nobody has described is
  // the one case where "100%" would be a lie with a percentage sign on it.
  if (required.length === 0) {
    errors.push("requiredProviders: declare the providers this portfolio expects");
  }
  const valid = errors.length === 0;
  return {
    valid,
    errors,
    start: start ?? null,
    end: end ?? null,
    currencyCode: currency,
    requiredProviders: required,
  };
}

/** One provider delivery record, read down to the fields this contract needs. */
function readRecord(entry, index) {
  const providerId = typeof entry?.providerId === "string" ? entry.providerId.trim() : "";
  return {
    index,
    providerId,
    start: calendarDate(entry?.periodStart),
    end: calendarDate(entry?.periodEnd),
    currencyCode: currencyCode(entry?.currencyCode),
    deliveryCount: deliveryCount(entry?.deliveryCount),
    provenanceLabel: provenanceLabel(entry),
  };
}

const stateKey = (code) => ({
  [FINDING_CODE.MISSING_PROVIDER]: "missing",
  [FINDING_CODE.DUPLICATE_RECORD]: "duplicate",
  [FINDING_CODE.OVERLAPPING_PERIOD]: "overlapping",
  [FINDING_CODE.MISALIGNED_PERIOD]: "misaligned",
  [FINDING_CODE.INCOMPATIBLE_CURRENCY]: "incompatibleCurrency",
  [FINDING_CODE.UNREADABLE_COUNT]: "unreadableCount",
}[code]);

function stateOf(codes) {
  for (const code of [
    FINDING_CODE.MISSING_PROVIDER, FINDING_CODE.DUPLICATE_RECORD,
    FINDING_CODE.OVERLAPPING_PERIOD, FINDING_CODE.MISALIGNED_PERIOD,
    FINDING_CODE.INCOMPATIBLE_CURRENCY, FINDING_CODE.UNREADABLE_COUNT,
  ]) {
    if (codes.includes(code)) return PROVIDER_STATE[stateKey(code)];
  }
  return null;
}

/**
 * Judge one provider against the declaration.
 *
 * Coverage and comparability are deliberately different tests. A provider with
 * one aligned record *and* a second record straddling the window is covered —
 * the required window is reported exactly once — but the portfolio is not
 * comparable, because the overlapping days cannot be separated by arithmetic.
 * Collapsing the two tests would either hide a real defect behind 100% or
 * report a provider as absent when it is plainly present.
 */
function judgeProvider(providerId, records, period, portfolioCurrency, declared) {
  const touching = records.filter((record) =>
    record.start && record.end && record.start < record.end && intersects(record, period));
  const alignedRecords = touching.filter((record) => aligned(record, period));
  const codes = [];

  if (declared && touching.length === 0) codes.push(FINDING_CODE.MISSING_PROVIDER);
  if (alignedRecords.length > 1) codes.push(FINDING_CODE.DUPLICATE_RECORD);
  else if (touching.length > 1) codes.push(FINDING_CODE.OVERLAPPING_PERIOD);
  if (alignedRecords.length === 0 && touching.length > 0) {
    codes.push(FINDING_CODE.MISALIGNED_PERIOD);
  }
  // Stated of every period-aligned record, declared provider or not: one
  // currency in the window is what makes a later sum addable at all.
  if (alignedRecords.some((record) => record.currencyCode !== portfolioCurrency)) {
    codes.push(FINDING_CODE.INCOMPATIBLE_CURRENCY);
  }
  if (alignedRecords.some((record) => record.deliveryCount === null)) {
    codes.push(FINDING_CODE.UNREADABLE_COUNT);
  }
  if (!declared) codes.push(FINDING_CODE.UNDECLARED_PROVIDER);

  const single = alignedRecords.length === 1 ? alignedRecords[0] : null;
  const covered = Boolean(declared && single
    && single.currencyCode === portfolioCurrency && single.deliveryCount !== null);
  return Object.freeze({
    providerId,
    declared,
    covered,
    // A fault outranks `covered` in the row's own state, even when the provider
    // is counted in coverage: the reason this portfolio cannot be combined has
    // to be visible on the row it belongs to, not only in the verdict above.
    state: stateOf(codes)
      ?? (covered ? PROVIDER_STATE.covered
        : (declared ? PROVIDER_STATE.missing : PROVIDER_STATE.undeclared)),
    recordCount: records.length,
    intersectingCount: touching.length,
    alignedCount: alignedRecords.length,
    deliveryCount: single ? single.deliveryCount : null,
    recordCurrency: single ? single.currencyCode : null,
    periodStart: single ? single.start : (touching[0]?.start ?? null),
    periodEnd: single ? single.end : (touching[0]?.end ?? null),
    provenanceLabel: single ? single.provenanceLabel : null,
    findingCodes: Object.freeze(codes),
  });
}

const REMEDIATION = Object.freeze({
  [FINDING_CODE.MISSING_PROVIDER]: (provider, period) =>
    `Add ${provider.providerId}'s delivery record for ${period.start} to ${period.end}.`,
  [FINDING_CODE.DUPLICATE_RECORD]: (provider, period) =>
    `Remove the duplicate ${provider.providerId} record for ${period.start} to ${period.end}, `
    + "keeping one.",
  [FINDING_CODE.OVERLAPPING_PERIOD]: (provider, period) =>
    `Remove the extra ${provider.providerId} record overlapping ${period.start} to ${period.end}; `
    + "overlapping days cannot be separated by arithmetic.",
  [FINDING_CODE.MISALIGNED_PERIOD]: (provider, period) =>
    `Re-export ${provider.providerId} for exactly ${period.start} to ${period.end}; `
    + "its record covers a different window.",
  [FINDING_CODE.INCOMPATIBLE_CURRENCY]: (provider, period, currency) =>
    `Re-export ${provider.providerId} in ${currency}; this portfolio applies no conversion rate.`,
  [FINDING_CODE.UNREADABLE_COUNT]: (provider) =>
    `Supply a whole, non-negative delivery count for ${provider.providerId}.`,
});

/** The one action, chosen by tier and then by declaration order. */
function chooseAction(providers, period, portfolioCurrency, verdict) {
  if (verdict === COMPARABILITY_VERDICT.no) {
    return Object.freeze({
      code: NO_ACTION_CODE,
      providerId: null,
      statement: "Declare the comparison period, the portfolio currency, and the providers "
        + "this portfolio expects. Until then there is nothing to judge.",
      focus: "declaration",
    });
  }
  for (const tier of REMEDIATION_TIERS) {
    for (const provider of providers) {
      const code = tier.find((candidate) => provider.findingCodes.includes(candidate));
      if (!code) continue;
      return Object.freeze({
        code,
        providerId: provider.providerId,
        statement: REMEDIATION[code](provider, period, portfolioCurrency),
        focus: "files",
      });
    }
  }
  return Object.freeze({
    code: NO_ACTION_CODE,
    providerId: null,
    statement: "No action needed. Every expected provider reports this period once, "
      + "in one currency.",
    focus: "none",
  });
}

const VERDICT_HEADLINE = Object.freeze({
  [COMPARABILITY_VERDICT.yes]: "Yes — combine it",
  [COMPARABILITY_VERDICT.notYet]: "Not yet",
  [COMPARABILITY_VERDICT.no]: "No — the question cannot be answered",
});

function combineDetail(verdict, coverage, blocking) {
  if (verdict === COMPARABILITY_VERDICT.no) {
    return "This portfolio has no answerable declaration, so no verdict is offered. "
      + "A percentage here would be a guess with a number on it.";
  }
  if (verdict === COMPARABILITY_VERDICT.yes) {
    return `All ${coverage.requiredCount} expected providers report the required period `
      + "exactly once, in the portfolio currency. A combined figure is defensible.";
  }
  const nouns = blocking === 1 ? "provider" : "providers";
  return `${blocking} ${nouns} would make a combined figure indefensible. `
    + "A total built now would be wrong in a way nobody downstream could see.";
}

const UNAVAILABLE_COVERAGE = Object.freeze({
  available: false, requiredCount: 0, coveredCount: 0, ratio: null,
});
const UNAVAILABLE_CONFIDENCE = Object.freeze({
  available: false, coveredCount: 0, attributedCount: 0, ratio: null,
});

/**
 * What a refused portfolio answers. Every field of the ordinary result is
 * present and empty, because a consumer must not have to branch on the refusal
 * to read the shape — and the answer to question one is a refusal, not an
 * absence of an answer.
 */
function refusedResult(input, screening) {
  const [first] = screening.defects;
  const evidence = Object.freeze({
    period: "No comparison period was read: the portfolio was refused before any value was.",
    currency: "No currency was read.",
    attribution: "No provider was attributed; nothing in this portfolio was read.",
    provenance: `${screening.defects.length} field${screening.defects.length === 1 ? "" : "s"} `
      + "outside the declared contract. Field names only — no value was read, copied, or shown.",
  });
  const nextAction = Object.freeze({
    code: SAMPLE_DEFECT_ACTION_CODE,
    providerId: null,
    statement: first.statement,
    focus: "contract",
  });
  const answers = Object.freeze(PORTFOLIO_QUESTIONS.map((entry) => {
    if (entry.id === "combine") {
      return Object.freeze({
        ...entry,
        headline: "No — this portfolio was refused",
        detail: "It carries a field this contract does not declare, so it was refused whole "
          + "before any value was read. An undeclared field is unbounded input, and no verdict "
          + "is worth reading from input nobody has bounded.",
      });
    }
    if (entry.id === "coverage") {
      return Object.freeze({
        ...entry,
        headline: "Coverage unavailable",
        detail: "Nothing was measured. A coverage share of a refused portfolio would describe "
          + "records this contract declined to read.",
      });
    }
    if (entry.id === "trust") {
      return Object.freeze({ ...entry, headline: evidence.provenance, detail: evidence.period });
    }
    return Object.freeze({ ...entry, headline: nextAction.statement, detail: evidence.attribution });
  }));
  return Object.freeze({
    contractId: PORTFOLIO_COMPARABILITY_CONTRACT_ID,
    portfolioId: typeof input?.portfolioId === "string" ? input.portfolioId : null,
    verdict: COMPARABILITY_VERDICT.no,
    comparable: false,
    declaration: Object.freeze({
      periodStart: null,
      periodEnd: null,
      currencyCode: null,
      requiredProviders: Object.freeze([]),
      valid: false,
    }),
    coverage: UNAVAILABLE_COVERAGE,
    confidence: UNAVAILABLE_CONFIDENCE,
    providers: Object.freeze([]),
    findings: Object.freeze([]),
    nextAction,
    evidence,
    answers,
    errors: Object.freeze(screening.defects.map((entry) => entry.statement)),
    sampleContract: screening,
    contractDefects: screening.defects,
  });
}

/**
 * Judge a portfolio.
 *
 * @param portfolio `{ portfolioId, currencyCode, requiredPeriodStart,
 *   requiredPeriodEnd, requiredProviders: [id], records: [record] }`, where a
 *   record is `{ providerId, periodStart, periodEnd, currencyCode,
 *   deliveryCount, provenance: { label } }` — and nothing else, at either
 *   level. See `PORTFOLIO_SAMPLE_FIELDS`.
 * @returns a frozen verdict. Never throws: an unreadable input is a `no`
 *   verdict with its reasons listed, because a thrown error at this boundary
 *   would take the panel down rather than tell the reader what is wrong.
 */
export function evaluatePortfolioComparability(portfolio) {
  // The closed field set, first and unconditionally. Screening after reading
  // would mean an undeclared field had already been through a reader.
  const screening = screenPortfolioSample(portfolio);
  if (!screening.ok) return refusedResult(portfolio, screening);

  const input = portfolio;
  const declaration = readDeclaration(input);
  const period = Object.freeze({
    start: declaration.start,
    end: declaration.end,
    valid: Boolean(declaration.start && declaration.end && declaration.start < declaration.end),
  });

  const entries = Array.isArray(input.records) ? input.records : [];
  const records = entries.map(readRecord).filter((record) => record.providerId);
  const byProvider = new Map();
  for (const record of records) {
    if (!byProvider.has(record.providerId)) byProvider.set(record.providerId, []);
    byProvider.get(record.providerId).push(record);
  }

  // Declaration order first — it is the order every deterministic choice below
  // breaks ties on — then any undeclared provider in first-appearance order.
  const undeclared = [...byProvider.keys()]
    .filter((id) => !declaration.requiredProviders.includes(id));
  const providers = period.valid && declaration.currencyCode
    ? [
      ...declaration.requiredProviders.map((id) => judgeProvider(
        id, byProvider.get(id) ?? [], period, declaration.currencyCode, true)),
      ...undeclared.map((id) => judgeProvider(
        id, byProvider.get(id) ?? [], period, declaration.currencyCode, false)),
    ]
    : [];

  const requiredProviders = providers.filter((provider) => provider.declared);
  const coveredProviders = requiredProviders.filter((provider) => provider.covered);
  const coverageAvailable = declaration.valid && requiredProviders.length > 0;
  const coverage = Object.freeze({
    available: coverageAvailable,
    requiredCount: requiredProviders.length,
    coveredCount: coveredProviders.length,
    ratio: coverageAvailable
      ? roundRatio(coveredProviders.length / requiredProviders.length) : null,
  });

  const attributed = coveredProviders.filter((provider) => provider.provenanceLabel);
  const confidence = Object.freeze({
    available: coveredProviders.length > 0,
    coveredCount: coveredProviders.length,
    attributedCount: attributed.length,
    ratio: coveredProviders.length > 0
      ? roundRatio(attributed.length / coveredProviders.length) : null,
  });

  const findings = Object.freeze(providers.flatMap((provider) =>
    provider.findingCodes.map((code) => Object.freeze({ code, providerId: provider.providerId }))));
  const blockingCodes = [
    FINDING_CODE.MISSING_PROVIDER, FINDING_CODE.DUPLICATE_RECORD,
    FINDING_CODE.OVERLAPPING_PERIOD, FINDING_CODE.MISALIGNED_PERIOD,
    FINDING_CODE.INCOMPATIBLE_CURRENCY, FINDING_CODE.UNREADABLE_COUNT,
  ];
  const blockingProviders = providers.filter((provider) =>
    provider.findingCodes.some((code) => blockingCodes.includes(code)));
  const comparable = declaration.valid
    && coverage.available
    && coverage.coveredCount === coverage.requiredCount
    && blockingProviders.length === 0;
  const verdict = !declaration.valid
    ? COMPARABILITY_VERDICT.no
    : (comparable ? COMPARABILITY_VERDICT.yes : COMPARABILITY_VERDICT.notYet);
  const nextAction = chooseAction(providers, period, declaration.currencyCode, verdict);

  const evidence = Object.freeze({
    period: `Comparison period ${periodText(period)}.`,
    currency: declaration.currencyCode
      ? `All figures in ${declaration.currencyCode}; no rate is applied to anything else.`
      : "No portfolio currency is declared.",
    attribution: coverage.available
      ? `${coverage.coveredCount} of ${coverage.requiredCount} expected providers attributed `
        + "to a period-aligned record."
      : "No providers are expected, so nothing is attributed.",
    provenance: confidence.available
      ? `${confidence.attributedCount} of ${confidence.coveredCount} covered providers carry a `
        + "named source. Labels only — no source material is read or shown."
      : "No covered provider, so provenance is unavailable rather than complete.",
  });

  const answers = Object.freeze(PORTFOLIO_QUESTIONS.map((entry) => {
    if (entry.id === "combine") {
      return Object.freeze({
        ...entry,
        headline: VERDICT_HEADLINE[verdict],
        detail: combineDetail(verdict, coverage, blockingProviders.length),
      });
    }
    if (entry.id === "coverage") {
      return Object.freeze({
        ...entry,
        headline: coverage.available
          ? `${coverage.coveredCount} of ${coverage.requiredCount} providers `
            + `· ${(coverage.ratio * 100).toFixed(1)}% comparable`
          : "Coverage unavailable",
        detail: coverage.available
          ? "Covered means one record matching the required period exactly, in the portfolio "
            + "currency, with a readable delivery count."
          : "Coverage is a share of a declared portfolio. With none declared it is unavailable, "
            + "not 100%.",
      });
    }
    if (entry.id === "trust") {
      return Object.freeze({
        ...entry,
        headline: `${evidence.attribution} ${evidence.provenance}`,
        detail: `${evidence.period} ${evidence.currency}`,
      });
    }
    return Object.freeze({ ...entry, headline: nextAction.statement, detail: evidence.period });
  }));

  return Object.freeze({
    contractId: PORTFOLIO_COMPARABILITY_CONTRACT_ID,
    portfolioId: typeof input.portfolioId === "string" ? input.portfolioId : null,
    verdict,
    comparable,
    declaration: Object.freeze({
      periodStart: declaration.start,
      periodEnd: declaration.end,
      currencyCode: declaration.currencyCode,
      requiredProviders: Object.freeze([...declaration.requiredProviders]),
      valid: declaration.valid,
    }),
    coverage,
    confidence,
    providers: Object.freeze(providers),
    findings,
    nextAction,
    evidence,
    answers,
    errors: Object.freeze(declaration.errors),
    sampleContract: screening,
    contractDefects: screening.defects,
  });
}
