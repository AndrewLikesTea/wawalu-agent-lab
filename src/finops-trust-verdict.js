// The post-import trust verdict.
//
// The import panel already computes a decision brief. What it never answered
// first is the question a leader actually asks before acting on any of it:
// *can I trust this number?* This module answers exactly three questions, in
// this order, and refuses to answer a fourth:
//
//   1. Can I trust this number?      → attributed spend coverage
//   2. If not, what is wrong and     → a small ranked set of findings
//      how much is it worth?
//   3. What do I do next?            → exactly one action
//
// It reads the same structures the import flow already holds — the parsed
// provider exports, the parsed HRIS roster, and the export IDs reconciliation
// quarantined — and builds no second copy of the import state.
//
// ---------------------------------------------------------------------------
// Metric definitions. Two engineers reading these must produce the same number.
// ---------------------------------------------------------------------------
//
//   Imported dataset   every provider cost row that survived `parseLocalFinopsFile`,
//                      after per-export revision reconciliation (the same
//                      `reconcileRecords` the analysis uses, so the verdict's
//                      denominator and the brief's total cannot disagree).
//                      Rows in quarantined exports are still in the dataset:
//                      the money is in the user's file, and the whole point of
//                      this readout is to say it did not reach the number.
//
//   total_spend        sum of `cost.amount_minor` over every row in the dataset,
//                      including rows with no resolved org unit. A row whose
//                      amount is missing or non-integer contributes 0 and is
//                      counted in `unparseableAmountRows`.
//
//   attributed         a row is attributed if and only if its `org_unit_id`
//                      resolves to exactly one roster entry AND that entry meets
//                      the confirmation rule the mapping step already uses:
//                      `operation === "upsert" && active === true`. Unmatched,
//                      unconfirmed, and dropped-period rows are not attributed.
//                      The join is by exact opaque id against a Map, so a row
//                      can match at most one entry; multi-match is structurally
//                      impossible on this contract rather than merely absent.
//
//   attributed_spend   sum of `cost.amount_minor` over attributed rows.
//
//   coverage           attributed_spend / total_spend, as a percentage. Always
//                      dollar-weighted — never a row-count ratio. A total of 0
//                      has no percentage: it is not 0%, and nothing is printed.
//
// All arithmetic is in integer minor units, so a hundred thousand rows sum
// without float drift. Division and rounding happen once, at the display
// boundary, to one decimal place for the percentage and two for money.
//
// ---------------------------------------------------------------------------
// Deliberate omissions
// ---------------------------------------------------------------------------
//
// * A separate "unjoined org identifiers" finding is not emitted. It would carry
//   the same dollars as the unresolved-rows finding in a list ranked by dollars,
//   which is the double-count the ranking exists to prevent. The roster-gap view
//   is preserved where it is useful and unambiguous: the distinct identifier
//   count, its examples, and the roster-shaped next action all live on the
//   unresolved finding itself.
// * No numeric confidence score is invented. The v1 mapping is an exact-id join
//   with a boolean confirmation rule, so `confidence` is a three-value enum with
//   a documented rule per category and nothing more.

import { reconcileRecords } from "./local-finops.js";

/** Ranked findings tie-break on this order last, so ranking is total. */
const CATEGORY_ORDER = Object.freeze(["unresolved", "dropped_periods", "unconfirmed_units"]);

const CATEGORY_TITLE = Object.freeze({
  unresolved: "Unresolved rows",
  dropped_periods: "Dropped periods",
  unconfirmed_units: "Unconfirmed org units",
});

// Why each category's classification carries the confidence it does. These are
// claims about the *classification*, not about the money.
const CATEGORY_CONFIDENCE = Object.freeze({
  unresolved: Object.freeze({
    level: "certain",
    reason: "The identifier is absent from the roster outright; there is nothing to be uncertain about.",
  }),
  dropped_periods: Object.freeze({
    level: "certain",
    reason: "Period reconciliation quarantined the whole export, so none of its rows reached the number.",
  }),
  unconfirmed_units: Object.freeze({
    level: "uncertain",
    reason: "The identifier is in the roster but the roster does not mark it active, so whether the spend "
      + "belongs to it is a judgement the imported files cannot settle.",
  }),
});

const CATEGORY_COLUMNS = Object.freeze({
  unresolved: Object.freeze(["provider records[].org_unit_id", "provider records[].cost.amount_minor"]),
  dropped_periods: Object.freeze(["provider snapshot.period_start", "provider snapshot.period_end"]),
  unconfirmed_units: Object.freeze(["provider records[].org_unit_id", "HRIS records[].active", "HRIS records[].operation"]),
});

/** Opaque ids never reach the DOM whole; the page's convention is a six-character tail. */
function label(id) {
  const text = String(id ?? "");
  return text ? `…${text.slice(-6)}` : "(no identifier)";
}

function moneyText(minor, currency) {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

function countText(value, singular, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function documentOf(entry) {
  return entry?.document ?? entry;
}

/**
 * Every parsed provider row, reconciled per export exactly as the analysis
 * reconciles it, tagged with the export it came from and that export's period.
 */
function datasetRows(providers, quarantined) {
  const rows = [];
  for (const entry of providers) {
    const document = documentOf(entry);
    if (!document?.snapshot || !Array.isArray(document.records)) continue;
    const exportId = document.export_id;
    const period = `${document.snapshot.period_start} to ${document.snapshot.period_end}`;
    const dropped = quarantined.has(exportId);
    for (const record of reconcileRecords(document.records, "aggregate_id", exportId).records) {
      rows.push({
        unitId: record.org_unit_id ?? "",
        // A non-integer amount is not coerced or guessed: it contributes zero
        // and is counted, so the denominator can never quietly absorb a defect.
        amountMinor: Number.isInteger(record.cost?.amount_minor) ? record.cost.amount_minor : null,
        currency: typeof record.cost?.currency === "string" ? record.cost.currency : null,
        exportId,
        period,
        dropped,
      });
    }
  }
  return rows;
}

/** The roster, and the subset of it the mapping step treats as confirmed. */
function roster(hris) {
  const document = documentOf(hris);
  const known = new Map();
  const confirmed = new Map();
  if (!document || !Array.isArray(document.records)) return { known, confirmed };
  for (const unit of reconcileRecords(document.records, "unit_id", document.export_id).records) {
    known.set(unit.unit_id, unit);
    if (unit.operation === "upsert" && unit.active === true) confirmed.set(unit.unit_id, unit);
  }
  return { known, confirmed };
}

/**
 * Group a category's rows by the identifier (or period) that produced them.
 * Called only from a finding's `detail()`, never while building the verdict —
 * the collapsed default must not pay for a list nobody has expanded.
 */
function groupDetail(rows, currency, byPeriod) {
  const groups = new Map();
  for (const row of rows) {
    const key = byPeriod ? row.period : row.unitId;
    const group = groups.get(key) ?? { key, rows: 0, impactMinor: 0 };
    group.rows += 1;
    group.impactMinor += row.amountMinor ?? 0;
    groups.set(key, group);
  }
  return Object.freeze([...groups.values()]
    .sort((left, right) => right.impactMinor - left.impactMinor
      || right.rows - left.rows
      || String(left.key).localeCompare(String(right.key)))
    // The grouping key is dropped here on purpose: a full opaque unit id or
    // export id is source content, and the six-character tail is the only form
    // of it this product ever puts on screen.
    .map((group) => Object.freeze({
      label: byPeriod ? group.key : label(group.key),
      rows: group.rows,
      impactMinor: group.impactMinor,
      impact: moneyText(group.impactMinor, currency),
    })));
}

function provenanceText(category, rows, identifiers, currency, impactMinor) {
  const columns = CATEGORY_COLUMNS[category].join(", ");
  const examples = identifiers.slice(0, 3);
  if (category === "dropped_periods") {
    return `${countText(rows, "row")} worth ${moneyText(impactMinor, currency)} came from `
      + `${countText(identifiers.length, "quarantined provider export")} in your upload. `
      + `Read from ${columns}.`;
  }
  const identifierPhrase = `${countText(identifiers.length, "distinct org identifier")} in your upload`;
  const suffix = examples.length ? ` For example ${examples.map(label).join(", ")}.` : "";
  if (category === "unresolved") {
    return `${countText(rows, "row")} carrying ${identifierPhrase} matched no roster entry. `
      + `Read from ${columns}.${suffix}`;
  }
  return `${countText(rows, "row")} carrying ${identifierPhrase} matched a roster entry that is not `
    + `marked active. Read from ${columns}.${suffix}`;
}

/**
 * The one action, derived from the top-ranked finding. It names the recoverable
 * amount and the step that closes it. Where the product genuinely cannot close
 * the gap, it says so instead of linking to a step that would not fix anything.
 */
function nextActionFor(finding, currency) {
  if (!finding) return null;
  const amount = moneyText(finding.impactMinor, currency);
  if (finding.id === "unresolved") {
    return Object.freeze({
      available: true,
      step: "roster",
      control: "local-finops-files",
      recoverableMinor: finding.impactMinor,
      recoverable: amount,
      text: `Import an HRIS org mapping that contains the ${countText(finding.identifierCount, "identifier")} `
        + `listed under “${finding.title}”. That would attribute ${amount}.`,
    });
  }
  if (finding.id === "unconfirmed_units") {
    return Object.freeze({
      available: true,
      step: "roster",
      control: "local-finops-files",
      recoverableMinor: finding.impactMinor,
      recoverable: amount,
      text: `Re-export the HRIS org mapping with the ${countText(finding.identifierCount, "unit")} `
        + `listed under “${finding.title}” marked active, or accept that ${amount} is not attributable.`,
    });
  }
  return Object.freeze({
    available: false,
    step: null,
    control: null,
    recoverableMinor: finding.impactMinor,
    recoverable: amount,
    text: `${amount} sits in provider exports that period reconciliation quarantined — a malformed or `
      + "duplicated period, or a different provider source instance. This product cannot repair a period "
      + "boundary or merge two source instances in files it did not produce. Open the data-quality "
      + "warnings for the exact reason, then select a clean set of periods.",
  });
}

const QUESTION = "Can I trust this number?";

function empty(reason) {
  return Object.freeze({
    state: "empty",
    currency: null,
    question: QUESTION,
    answer: reason,
    headline: Object.freeze({
      available: false, coveragePercent: null, coverageText: null,
      attributedMinor: 0, totalMinor: 0, attributed: null, total: null,
      attributedRows: 0, totalRows: 0, unparseableAmountRows: 0,
    }),
    findings: Object.freeze([]),
    nextAction: null,
  });
}

/**
 * @param {object} input
 * @param {Array} input.providers parsed provider files, as `parseLocalFinopsFile` returns them.
 * @param {object} input.hris the parsed HRIS roster.
 * @param {Array<string>} input.quarantinedExportIds export ids reconciliation dropped.
 * @returns the trust verdict: one headline, a ranked finding set, one action.
 */
export function trustVerdict({ providers = [], hris = null, quarantinedExportIds = [] } = {}) {
  const list = Array.isArray(providers) ? providers : [providers];
  const quarantined = new Set(quarantinedExportIds ?? []);
  const rows = datasetRows(list.filter(Boolean), quarantined);
  if (!rows.length) {
    return empty("No cost rows survived parsing, so there is no number to trust yet. "
      + "Select a provider export and an HRIS org mapping.");
  }

  // Mixing currencies would make every figure below a fiction. The v1 contract
  // rejects non-USD at parse time, so this is a guard rather than a state the
  // shipped importer can reach — but a silent sum is the one failure this
  // readout must never produce, so it blocks here too.
  const currencies = [...new Set(rows.map((row) => row.currency).filter(Boolean))].sort();
  const currency = currencies[0] ?? "USD";
  if (currencies.length > 1) {
    return Object.freeze({
      state: "mixed_currency",
      currency: null,
      currencies: Object.freeze(currencies),
      question: QUESTION,
      answer: `No. The upload mixes ${currencies.join(" and ")}, and no exchange rate came with it. `
        + "Adding these together would produce a total that is not any real amount of money.",
      headline: Object.freeze({
        available: false, coveragePercent: null, coverageText: null,
        attributedMinor: 0, totalMinor: 0, attributed: null, total: null,
        attributedRows: 0, totalRows: rows.length, unparseableAmountRows: 0,
      }),
      findings: Object.freeze([Object.freeze({
        id: "mixed_currency",
        title: "Mixed currencies",
        blocking: true,
        impactMinor: 0,
        impact: "Not summable",
        rows: rows.length,
        identifierCount: currencies.length,
        confidence: "certain",
        confidenceReason: "The currency codes are read directly from the rows; they differ.",
        provenance: `${countText(rows.length, "row")} across ${countText(currencies.length, "currency", "currencies")} `
          + `(${currencies.join(", ")}). Read from provider records[].cost.currency.`,
        detail: () => Object.freeze(currencies.map((code) => {
          const matching = rows.filter((row) => row.currency === code);
          return Object.freeze({
            label: code,
            rows: matching.length,
            impactMinor: matching.reduce((sum, row) => sum + (row.amountMinor ?? 0), 0),
            impact: moneyText(matching.reduce((sum, row) => sum + (row.amountMinor ?? 0), 0), code),
          });
        })),
      })]),
      nextAction: Object.freeze({
        available: false,
        step: null,
        control: null,
        recoverableMinor: 0,
        recoverable: null,
        text: "Import one currency at a time. This product holds no exchange rate and will not invent one, "
          + "so there is no conversion it could offer instead.",
      }),
    });
  }

  const { known, confirmed } = roster(hris);
  const buckets = new Map(CATEGORY_ORDER.map((id) => [id, []]));
  let totalMinor = 0;
  let attributedMinor = 0;
  let attributedRows = 0;
  let unparseableAmountRows = 0;
  for (const row of rows) {
    if (row.amountMinor === null) unparseableAmountRows += 1;
    totalMinor += row.amountMinor ?? 0;
    if (row.dropped) buckets.get("dropped_periods").push(row);
    else if (row.unitId && confirmed.has(row.unitId)) {
      attributedMinor += row.amountMinor ?? 0;
      attributedRows += 1;
    } else if (row.unitId && known.has(row.unitId)) buckets.get("unconfirmed_units").push(row);
    else buckets.get("unresolved").push(row);
  }

  const findings = CATEGORY_ORDER
    .map((id) => {
      const bucket = buckets.get(id);
      const impactMinor = bucket.reduce((sum, row) => sum + (row.amountMinor ?? 0), 0);
      const byPeriod = id === "dropped_periods";
      const keys = [...new Set(bucket.map((row) => (byPeriod ? row.exportId : row.unitId)))];
      return {
        id,
        title: CATEGORY_TITLE[id],
        blocking: false,
        impactMinor,
        impact: moneyText(impactMinor, currency),
        rows: bucket.length,
        identifierCount: keys.length,
        confidence: CATEGORY_CONFIDENCE[id].level,
        confidenceReason: CATEGORY_CONFIDENCE[id].reason,
        provenance: provenanceText(id, bucket.length, keys, currency, impactMinor),
        // Lazy on purpose: an expand affordance is the only thing that pays for
        // grouping, so a collapsed verdict over a large import costs one pass.
        detail: () => groupDetail(bucket, currency, byPeriod),
      };
    })
    // Zero-impact categories are not rendered as empty rows; they are not
    // findings at all.
    .filter((finding) => finding.impactMinor > 0)
    .sort((left, right) => right.impactMinor - left.impactMinor
      || right.rows - left.rows
      || CATEGORY_ORDER.indexOf(left.id) - CATEGORY_ORDER.indexOf(right.id))
    .map(Object.freeze);

  const coveragePercent = totalMinor === 0 ? null : (attributedMinor / totalMinor) * 100;
  const coverageText = coveragePercent === null ? null : `${coveragePercent.toFixed(1)}%`;
  const headline = Object.freeze({
    available: coveragePercent !== null,
    coveragePercent,
    coverageText,
    attributedMinor,
    totalMinor,
    attributed: moneyText(attributedMinor, currency),
    total: moneyText(totalMinor, currency),
    attributedRows,
    totalRows: rows.length,
    unparseableAmountRows,
  });

  // Zero spend is not 100% coverage and not an empty import. There is data and
  // there is no money in it, and saying either of the other two would be false.
  if (totalMinor === 0) {
    return Object.freeze({
      state: "zero_spend",
      currency,
      question: QUESTION,
      answer: `There is no spend to attribute: ${countText(rows.length, "parsed row")} total `
        + `${moneyText(0, currency)}. No coverage percentage exists.`,
      headline,
      findings: Object.freeze([]),
      nextAction: null,
    });
  }

  if (!findings.length && attributedMinor === totalMinor) {
    // Rows carrying no spend can sit outside the attributed set without moving
    // a dollar. Coverage is still 100%, and the sentence says which it is
    // rather than claiming every row resolved when some did not.
    const unattributedRows = rows.length - attributedRows;
    return Object.freeze({
      state: "all_clear",
      currency,
      question: QUESTION,
      answer: `Yes. All ${moneyText(totalMinor, currency)} of parsed spend resolved to exactly one `
        + `confirmed org unit. ${unattributedRows === 0
          ? `Every one of ${countText(rows.length, "parsed row")} is attributed.`
          : `${countText(unattributedRows, "row")} carries no spend and moves no total.`}`,
      headline,
      findings: Object.freeze([]),
      nextAction: null,
    });
  }

  const unattributedMinor = totalMinor - attributedMinor;
  return Object.freeze({
    state: "findings",
    currency,
    question: QUESTION,
    answer: `${coverageText} of ${moneyText(totalMinor, currency)} is attributed to a confirmed org unit. `
      + `${moneyText(unattributedMinor, currency)} is not, for the reasons below.`,
    headline,
    findings: Object.freeze(findings),
    nextAction: nextActionFor(findings[0], currency),
  });
}
