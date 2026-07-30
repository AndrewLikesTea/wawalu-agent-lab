// The multi-provider local intake contract: which provider exports may be read
// side by side in one analysis, on what terms, and what happens to the ones that
// may not.
//
// WHY THIS EXISTS. The shipped intake already reads an OpenAI, an Anthropic, and
// a Bedrock-style export one at a time. Selecting two of them together did not
// fail — it did something worse. Every delimited import declares the same
// translation-layer source instance, so two exports covering the same month
// looked like one period supplied twice, and the reconciler quarantined the
// second as `duplicate_period`. A reader who dropped in January from two
// providers was shown one provider's spend under a message telling them to
// remove a duplicate they did not have.
//
// So the question "are these two exports the same period, or two providers'
// halves of one period?" is answered here, by contract, before the reconciler
// sees anything. Two exports are the same period only if the same *adapter*
// produced both. Different adapters covering the identical billing window are
// two halves of one period and are merged into it.
//
// WHAT AN ADAPTER IS. A versioned declaration about one provider's local export:
// which delimited shape and dialect profile read it, which normalized provider
// it becomes, what its cost column means, which fields of it are never read, and
// what this product does when the file is partial, stale, malformed, reordered,
// incomplete, or priced in another currency. An adapter is data. Nothing below
// branches on a provider name; a fourth provider is an entry in this list plus a
// shape in `finops-tabular-import.js`, never an `if`.
//
// WHAT THIS MODULE NEVER DOES. No fetch, no storage, no credential, no clock, no
// randomness. It is handed documents another module already parsed and validated
// in the reader's own tab, and every string it emits names a provider, a code, a
// period, an export id, or a count — never a cell value, and never prompt text.
//
// SCHEMA VERSIONS.
//   Contract       `wawalu.integration.multi-provider-intake/1.0` (this module).
//   Adapters       Each carries its own `adapterVersion`, bumped when what it
//                  declares about a provider's export changes meaning. A stored
//                  reading is interpreted by the adapter version that produced
//                  it, so a bump is never a silent re-reading of old evidence.
//   Documents      Merged periods are emitted at the highest
//                  provider-usage-billing version present in the merge, with the
//                  older records upgraded through `ABSENT_USAGE_DETAIL` — the
//                  contract's own representation of "this export did not carry
//                  that field", never a zero.

import { normalizeColumnName } from "./dialect-profiles.js";
import {
  ABSENT_USAGE_DETAIL, PROVIDER_USAGE_CONTRACT_KIND, USAGE_DETAIL_KEYS,
} from "./provider-usage-record.js";

/** The contract's own identity. Consumers allowlist the exact version. */
export const MULTI_PROVIDER_INTAKE_KIND = "wawalu.integration.multi-provider-intake";
export const MULTI_PROVIDER_INTAKE_VERSION = "1.0";
export const MULTI_PROVIDER_INTAKE_CONTRACT_ID =
  `${MULTI_PROVIDER_INTAKE_KIND}/${MULTI_PROVIDER_INTAKE_VERSION}`;

/**
 * The source instance a merged period declares. It is what the merge is: one
 * translation layer over several providers' exports, not any provider's billing
 * system. Stamping it keeps the reconciler's same-source rule meaningful — the
 * rule still holds *within* each adapter, checked below — while stopping a
 * combined period from being quarantined for belonging to more than one source.
 */
export const MULTI_PROVIDER_SOURCE_INSTANCE_ID = "psn_multi_provider_intake_v1_0001";

/**
 * The one currency a combined analysis adds up. Converting would require a rate
 * this product cannot obtain locally, and a converted total nobody can reproduce
 * is worse than a refusal that names the file.
 */
export const INTAKE_CURRENCY = "USD";

/** Every reason an export can be held out of a combined analysis. */
export const INTAKE_CODES = Object.freeze({
  DUPLICATE_EXPORT: "duplicate_export",
  DUPLICATE_PERIOD: "duplicate_period",
  MISALIGNED_PERIOD: "misaligned_period",
  UNSUPPORTED_CURRENCY: "unsupported_currency",
  INCOMPATIBLE_SOURCE: "incompatible_source",
  SENSITIVE_FIELD_PRESENT: "sensitive_field_present",
});

/** Non-blocking findings: the export is read, and the combined figure is bounded. */
export const INTAKE_NOTES = Object.freeze({
  PARTIAL_EXPORT: "partial_export",
  PROVISIONAL_EXPORT: "provisional_export",
});

/**
 * How a sensitive column is handled.
 *
 * `reject`  The file is refused before a single value is read. Reserved for
 *           columns that carry what a person wrote or what a model answered:
 *           there is no aggregate of prompt text this product wants.
 * `redact`  The column is never mapped to a normalized field, never sampled in
 *           the mapping review, and never reaches the DOM or an export artifact.
 *           The value is dropped at the parse boundary, not filtered later.
 */
export const SENSITIVITY_POLICY = Object.freeze({ reject: "reject", redact: "redact" });

const sensitive = (name, policy, why, aliases = []) =>
  Object.freeze({ name, policy, why, aliases: Object.freeze(aliases) });

// Content columns. Identical across the three adapters because the rule is
// identical: a billing export that carries message bodies is refused, whoever
// exported it. Declared per adapter anyway, because a provider that stops
// emitting one must be able to say so without changing the other two.
const CONTENT_COLUMNS = Object.freeze([
  sensitive("prompt", SENSITIVITY_POLICY.reject,
    "A usage export carrying prompt bodies is refused; spend is answered from counts.",
    ["prompt_text", "input_text", "request_body", "message", "messages", "user_message"]),
  sensitive("completion", SENSITIVITY_POLICY.reject,
    "A usage export carrying model output is refused; spend is answered from counts.",
    ["completion_text", "output_text", "response_body", "response_text", "assistant_message"]),
]);

/**
 * The three adapters this build reads. Declared order is the tie-break order
 * everywhere below, so two selections of the same files always plan identically.
 */
export const PROVIDER_ADAPTERS = Object.freeze([
  Object.freeze({
    id: "openai-usage",
    adapterVersion: "1.0",
    label: "OpenAI organization usage export",
    provider: "openai",
    shapes: Object.freeze(["openai_usage"]),
    dialects: Object.freeze(["openai-usage-export"]),
    packageId: "openai-usage-export",
    billingCurrency: INTAKE_CURRENCY,
    billingGrain: "project-day",
    groupingUnit: "project",
    comparability: Object.freeze({
      costBasis: "billed_amount",
      usageUnit: "tokens",
      periodBasis: "usage_date",
      note: "Per-project daily billed USD. Console amounts already have credits applied, "
        + "so they are comparable with another provider's billed cost, not with list price.",
    }),
    sensitiveFields: Object.freeze([
      ...CONTENT_COLUMNS,
      sensitive("user_email", SENSITIVITY_POLICY.redact,
        "Per-person identity is never read; spend is attributed by project.",
        ["user_id", "openai_user_email", "user_name"]),
      sensitive("api_key_id", SENSITIVITY_POLICY.redact,
        "A key identifier is a credential reference and is never retained.",
        ["api_key", "api_key_name", "key_id", "secret"]),
    ]),
    failureBehavior: Object.freeze({
      partial: "A console export truncated mid-period is read; the period is marked partial and named.",
      stale: "An export generated before the period closed is read as provisional, never as settled spend.",
      malformed: "A row whose date or amount cannot be read is located and skipped; the file still imports.",
      reordered: "Columns are matched by header name, so any column order imports identically.",
      incomplete: "A missing optional column is absent in the record, never zero.",
      mixedCurrency: "A non-USD row is quarantined; a wholly non-USD export is held out of the combined total.",
    }),
    remediation: Object.freeze({
      unsupported_currency: "Re-export this OpenAI period with USD billing, or analyze it on its own.",
      misaligned_period: "Re-export the OpenAI usage page for the same billing window as the other providers.",
      sensitive_field_present: "Export the usage page without the message columns; only counts are read here.",
      incompatible_source: "Choose OpenAI exports from one organization, or analyze each organization separately.",
    }),
  }),
  Object.freeze({
    id: "anthropic-usage",
    adapterVersion: "1.0",
    label: "Anthropic Console usage export",
    provider: "anthropic",
    shapes: Object.freeze(["anthropic_usage"]),
    dialects: Object.freeze(["anthropic-usage-export"]),
    packageId: "anthropic-usage-export",
    billingCurrency: INTAKE_CURRENCY,
    billingGrain: "workspace-day",
    groupingUnit: "workspace",
    comparability: Object.freeze({
      costBasis: "billed_amount",
      usageUnit: "tokens",
      periodBasis: "usage_date",
      note: "Per-workspace daily billed USD. Cached-input rows are billed rows, so the total "
        + "is comparable with another provider's billed cost without a discount adjustment.",
    }),
    sensitiveFields: Object.freeze([
      ...CONTENT_COLUMNS,
      sensitive("user_email", SENSITIVITY_POLICY.redact,
        "Per-person identity is never read; spend is attributed by workspace.",
        ["actor_email", "member_email", "workspace_member_email"]),
      sensitive("api_key", SENSITIVITY_POLICY.redact,
        "A key alias is a credential reference and is never retained.",
        ["api_key_id", "key_alias", "api_key_name"]),
    ]),
    failureBehavior: Object.freeze({
      partial: "A workspace missing from the export leaves its spend unattributed rather than assumed.",
      stale: "An export generated before the period closed is read as provisional, never as settled spend.",
      malformed: "A row whose date or cost cannot be read is located and skipped; the file still imports.",
      reordered: "Columns are matched by header name, so any column order imports identically.",
      incomplete: "An absent output-token column leaves the split absent, never zero.",
      mixedCurrency: "A non-USD row is quarantined; a wholly non-USD export is held out of the combined total.",
    }),
    remediation: Object.freeze({
      unsupported_currency: "Re-export this Anthropic period in USD, or analyze it on its own.",
      misaligned_period: "Re-export Console usage for the same billing window as the other providers.",
      sensitive_field_present: "Export usage without the conversation columns; only counts are read here.",
      incompatible_source: "Choose Anthropic exports from one organization, or analyze each one separately.",
    }),
  }),
  Object.freeze({
    id: "bedrock-cost-and-usage",
    adapterVersion: "1.0",
    label: "Bedrock line items in an AWS Cost and Usage Report",
    provider: "aws",
    shapes: Object.freeze(["bedrock_usage"]),
    dialects: Object.freeze(["aws-cost-and-usage-report"]),
    packageId: "aws-cost-and-usage-report",
    billingCurrency: INTAKE_CURRENCY,
    billingGrain: "line-item",
    groupingUnit: "tag",
    comparability: Object.freeze({
      costBasis: "unblended_cost",
      usageUnit: "provider-units",
      periodBasis: "line_item_usage_start_date",
      note: "Unblended cost per line item. It excludes savings-plan and credit adjustments that "
        + "land on separate CUR rows, so a combined total reads slightly high against an invoice.",
    }),
    sensitiveFields: Object.freeze([
      ...CONTENT_COLUMNS,
      sensitive("line_item_resource_id", SENSITIVITY_POLICY.redact,
        "A resource ARN carries an account identifier and is never retained.",
        ["lineitem resourceid", "resource_id", "arn"]),
      sensitive("bill_payer_account_id", SENSITIVITY_POLICY.redact,
        "The payer account is billing identity, not attribution, and is never retained.",
        ["bill payeraccountid", "payer_account_id"]),
    ]),
    failureBehavior: Object.freeze({
      partial: "A CUR delivered mid-month is read; the period is marked partial and named.",
      stale: "AWS restates a CUR after the month closes; an export generated inside the period is provisional.",
      malformed: "A line item whose timestamp or cost cannot be read is located and skipped.",
      reordered: "Columns are matched by header name, so any column order imports identically.",
      incomplete: "A line item with no cost-allocation tag is attributed to the account, never guessed.",
      mixedCurrency: "A non-USD line item is quarantined; a wholly non-USD CUR is held out of the total.",
    }),
    remediation: Object.freeze({
      unsupported_currency: "Configure the CUR in USD, or analyze this report on its own.",
      misaligned_period: "Export the CUR for the same billing window as the other providers.",
      sensitive_field_present: "Deselect the message columns in the CUR definition; only counts are read here.",
      incompatible_source: "Choose CUR deliveries from one payer account, or analyze each payer separately.",
    }),
  }),
]);

/** Fallback remediation for a code an adapter says nothing special about. */
const DEFAULT_REMEDIATION = Object.freeze({
  unsupported_currency: "Export one currency at a time; totals are never converted for you.",
  misaligned_period: "Choose exports covering the identical billing window, or analyze each period separately.",
  duplicate_period: "Remove the repeated period for this provider; the first export in id order is kept.",
  duplicate_export: "Remove the repeated file; the same export was chosen twice.",
  incompatible_source: "Choose exports from one source instance per provider, or analyze each separately.",
  sensitive_field_present: "Re-export without the message columns; this import reads counts, never content.",
});

/** Every header spelling any adapter marks sensitive, at either policy. */
export const SENSITIVE_INTAKE_HEADERS = Object.freeze(PROVIDER_ADAPTERS
  .flatMap((adapter) => adapter.sensitiveFields)
  .flatMap((field) => [field.name, ...field.aliases]));

/** The subset a file is refused for carrying at all. */
export const REJECTED_INTAKE_HEADERS = Object.freeze(PROVIDER_ADAPTERS
  .flatMap((adapter) => adapter.sensitiveFields)
  .filter((field) => field.policy === SENSITIVITY_POLICY.reject)
  .flatMap((field) => [field.name, ...field.aliases]));

// One header-matching rule for the whole product, imported rather than
// re-implemented: `promptText`, `prompt text`, and `prompt_text` are one column.
const REJECTED_HEADER_KEYS = new Set(REJECTED_INTAKE_HEADERS.map(normalizeColumnName));

/**
 * Which columns of a header row this contract refuses to read.
 *
 * Called at the parse boundary, before a value is touched. The returned columns
 * are the reader's own header names — the one thing this product does retain
 * from a delimited file — so a diagnostic can say which column to drop.
 */
export function screenSensitiveColumns(columns = []) {
  const rejected = [...columns]
    .filter((column) => REJECTED_HEADER_KEYS.has(normalizeColumnName(column)));
  return Object.freeze({
    ok: rejected.length === 0,
    rejected: Object.freeze(rejected),
    code: INTAKE_CODES.SENSITIVE_FIELD_PRESENT,
  });
}

export function adapterForProvider(provider) {
  return PROVIDER_ADAPTERS.find((adapter) => adapter.provider === provider) ?? null;
}

export function adapterForShape(shapeId) {
  return PROVIDER_ADAPTERS.find((adapter) => adapter.shapes.includes(shapeId)) ?? null;
}

export function adapterRemediation(adapter, code) {
  return adapter?.remediation?.[code] ?? DEFAULT_REMEDIATION[code]
    ?? "Choose a supported provider export and try again.";
}

/** The provider label a message uses when no adapter claims the export. */
const UNDECLARED_LABEL = "An export from more than one provider";

function labelFor(adapter, providerId) {
  return adapter?.label ?? (providerId === "mixed"
    ? UNDECLARED_LABEL : `A ${providerId} export`);
}

// --- reading one document --------------------------------------------------

const documentOf = (entry) => entry?.document ?? entry;

function periodKeyOf(document) {
  return `${document.snapshot.period_start}:${document.snapshot.period_end}`;
}

/**
 * Which provider an export is, read off its own records rather than off the file
 * name or the shape that produced it. A file whose rows name more than one
 * provider is `mixed`: it is already a combined export, it is passed through
 * untouched, and it is never merged with anything.
 */
function providerIdentity(document) {
  const providers = new Set(document.records.map((record) => record.provider));
  if (providers.size === 1) return [...providers][0];
  return providers.size === 0 ? "other" : "mixed";
}

function currenciesOf(document) {
  return [...new Set(document.records.map((record) => record.cost.currency))].sort();
}

function readEntry(entry) {
  const document = documentOf(entry);
  const providerId = providerIdentity(document);
  const start = Date.parse(`${document.snapshot.period_start}T00:00:00Z`);
  const end = Date.parse(`${document.snapshot.period_end}T00:00:00Z`);
  const generatedAt = Date.parse(document.snapshot.generated_at);
  return {
    entry,
    document,
    providerId,
    adapter: adapterForProvider(providerId),
    exportId: document.export_id,
    periodKey: periodKeyOf(document),
    periodStart: document.snapshot.period_start,
    periodEnd: document.snapshot.period_end,
    start,
    end,
    generatedAt,
    // An export generated before its own period closed describes a window that
    // was still open. It is read, and the combined figure says so.
    provisional: Number.isFinite(generatedAt) && Number.isFinite(end) && generatedAt < end,
    completeness: document.snapshot.completeness,
    currencies: currenciesOf(document),
    sourceInstanceId: document.snapshot.source_instance_id,
  };
}

// Deterministic everywhere: adapter declared order first, then export id.
function compareReadings(left, right) {
  const rank = (reading) => {
    const index = PROVIDER_ADAPTERS.findIndex((adapter) => adapter.id === reading.adapter?.id);
    return index < 0 ? PROVIDER_ADAPTERS.length : index;
  };
  return rank(left) - rank(right)
    || left.providerId.localeCompare(right.providerId)
    || left.exportId.localeCompare(right.exportId);
}

function rejection(reading, code, message) {
  return Object.freeze({
    code,
    provider: reading.providerId,
    providerLabel: labelFor(reading.adapter, reading.providerId),
    adapterId: reading.adapter?.id ?? null,
    exportId: reading.exportId,
    period: reading.periodKey,
    message,
    action: adapterRemediation(reading.adapter, code),
  });
}

// --- merging one billing window --------------------------------------------

function upgradeRecord(record, schemaVersion) {
  if (schemaVersion !== "1.1") return record;
  return USAGE_DETAIL_KEYS.every((key) => key in record)
    ? record : { ...record, ...ABSENT_USAGE_DETAIL };
}

/**
 * Fold several providers' exports for the identical billing window into one
 * document the reconciler reads exactly as it reads a single-provider period.
 *
 * The merged snapshot states the *weakest* claim any input made: the oldest
 * generation time, "partial" if any input was partial, the summed omitted-record
 * count, and the smallest declared group-size floor. A merge never improves a
 * claim, because nothing about combining two files makes either more complete.
 */
function mergePeriod(readings) {
  const [primary] = readings;
  const schemaVersion = readings
    .map((reading) => reading.document.schema_version)
    .sort()
    .at(-1);
  const records = readings
    .flatMap((reading) => reading.document.records
      .map((record) => upgradeRecord(record, schemaVersion)))
    .sort((left, right) => (left.usage_date < right.usage_date ? -1
      : left.usage_date > right.usage_date ? 1
        : left.org_unit_id.localeCompare(right.org_unit_id)
        || left.provider.localeCompare(right.provider)
        || left.service_category.localeCompare(right.service_category)
        || left.aggregate_id.localeCompare(right.aggregate_id)));
  const snapshots = readings.map((reading) => reading.document.snapshot);
  const document = Object.freeze({
    schema_version: schemaVersion,
    kind: PROVIDER_USAGE_CONTRACT_KIND,
    // The primary's id, in adapter declared order. A merged period does not
    // invent an export id: every id that went into it travels on the plan, and
    // the provenance block below is what a reader audits the total against.
    export_id: primary.document.export_id,
    snapshot: Object.freeze({
      source_instance_id: MULTI_PROVIDER_SOURCE_INSTANCE_ID,
      sequence: Math.max(...snapshots.map((snapshot) => snapshot.sequence)),
      generated_at: snapshots
        .map((snapshot) => snapshot.generated_at).sort().at(0),
      period_start: primary.periodStart,
      period_end: primary.periodEnd,
      completeness: snapshots.every((snapshot) => snapshot.completeness === "complete")
        ? "complete" : "partial",
      omitted_record_count: snapshots
        .reduce((sum, snapshot) => sum + snapshot.omitted_record_count, 0),
      issues: Object.freeze(snapshots.flatMap((snapshot) => snapshot.issues ?? [])),
    }),
    privacy: Object.freeze({
      aggregation: primary.document.privacy.aggregation,
      minimum_group_size: Math.min(...readings
        .map((reading) => reading.document.privacy.minimum_group_size)),
      direct_identifiers_included: false,
      content_included: false,
    }),
    records: Object.freeze(records),
  });
  return {
    document,
    // Per-model rows are analysis input rather than contract content, so they
    // concatenate. The query sample belongs to whichever export sampled it; the
    // primary's is kept rather than interleaving two providers' samples into a
    // corpus neither of them is.
    modelUsage: readings.flatMap((reading) => reading.entry?.modelUsage ?? []),
    querySample: readings.map((reading) => reading.entry?.querySample)
      .find((sample) => sample) ?? null,
    importEvidence: readings.flatMap((reading) => reading.entry?.importEvidence ?? []),
  };
}

// --- the plan --------------------------------------------------------------

function providerSummary(readings) {
  const byProvider = new Map();
  for (const reading of [...readings].sort(compareReadings)) {
    const existing = byProvider.get(reading.providerId) ?? {
      provider: reading.providerId,
      label: labelFor(reading.adapter, reading.providerId),
      adapterId: reading.adapter?.id ?? null,
      adapterVersion: reading.adapter?.adapterVersion ?? null,
      costBasis: reading.adapter?.comparability.costBasis ?? null,
      comparabilityNote: reading.adapter?.comparability.note ?? null,
      currency: reading.currencies.join(", "),
      periods: [],
      exportIds: [],
      complete: true,
      provisional: false,
    };
    existing.periods.push(reading.periodKey);
    existing.exportIds.push(reading.exportId);
    if (reading.completeness !== "complete") existing.complete = false;
    if (reading.provisional) existing.provisional = true;
    byProvider.set(reading.providerId, existing);
  }
  return Object.freeze([...byProvider.values()].map((entry) => Object.freeze({
    ...entry,
    periods: Object.freeze([...new Set(entry.periods)]),
    exportIds: Object.freeze(entry.exportIds),
    state: !entry.complete ? INTAKE_NOTES.PARTIAL_EXPORT
      : entry.provisional ? INTAKE_NOTES.PROVISIONAL_EXPORT : "settled",
  })));
}

const COMPARABILITY_BASIS =
  "Identical billing window, one currency, and each provider's own billed cost.";

function comparabilityOf(providers, accepted, rejections, combined) {
  if (!combined) {
    const held = rejections.length
      ? [`${rejections.length} export${rejections.length === 1 ? " was" : "s were"} held out.`]
      : [];
    return Object.freeze({
      state: "single_provider",
      basis: COMPARABILITY_BASIS,
      message: providers.length === 0
        ? "No provider export was accepted."
        : providers.length === 1
          ? `One provider was read across ${accepted.length} period`
            + `${accepted.length === 1 ? "" : "s"}; nothing is combined.`
          : "The selection already carries more than one provider in one export; "
            + "it is read exactly as it arrived.",
      notes: Object.freeze(held),
    });
  }
  const notes = [
    ...providers.filter((entry) => entry.state === INTAKE_NOTES.PARTIAL_EXPORT)
      .map((entry) => `${entry.label} is a partial export; the combined total is a floor.`),
    ...providers.filter((entry) => entry.state === INTAKE_NOTES.PROVISIONAL_EXPORT)
      .map((entry) => `${entry.label} was generated before its period closed, so it is provisional.`),
    ...providers.filter((entry) => entry.costBasis && entry.costBasis !== "billed_amount")
      .map((entry) => `${entry.label} reports ${entry.costBasis.replace(/_/g, " ")}, `
        + "which is not the same basis as a billed amount."),
  ];
  return Object.freeze({
    state: notes.length ? "combined_bounded" : "combined",
    basis: COMPARABILITY_BASIS,
    message: `${providers.length} providers were combined across ${accepted.length} `
      + `period${accepted.length === 1 ? "" : "s"} on the same billing window and currency.`,
    notes: Object.freeze(notes),
  });
}

/**
 * Plan a local intake across providers.
 *
 * @param providers parsed provider entries — `{ document, modelUsage?, querySample? }`
 *   or bare documents — already validated by `parseLocalFinopsFile`.
 * @returns `{ accepted, rejections, summary }`. `accepted` is what the
 *   reconciler should read: the original entries untouched when one provider was
 *   selected, and one merged entry per billing window when several were.
 *
 * A single-provider selection is returned byte-for-byte as it arrived. That is
 * the contract's first promise: adding an adapter layer must not change what a
 * reader who imports one provider's periods sees.
 */
export function planMultiProviderIntake({ providers = [] } = {}) {
  const list = (Array.isArray(providers) ? providers : [providers]).filter(Boolean);
  const readings = list.map(readEntry);
  const rejections = [];

  // 1. Currency, first and for every selection. A total nobody can reproduce is
  //    never produced, whether one provider was chosen or three.
  const priced = readings.filter((reading) => {
    const foreign = reading.currencies.filter((code) => code !== INTAKE_CURRENCY);
    if (!foreign.length) return true;
    rejections.push(rejection(reading, INTAKE_CODES.UNSUPPORTED_CURRENCY,
      `${labelFor(reading.adapter, reading.providerId)} is priced in ${foreign.join(", ")}; `
      + `only ${INTAKE_CURRENCY} exports are added together.`));
    return false;
  });

  const distinct = new Set(priced.map((reading) => reading.providerId));
  if (distinct.size <= 1 || distinct.has("mixed")) {
    // One provider, or a file that is already a multi-provider bundle. Nothing
    // to merge and nothing to re-stamp: the existing reconciliation runs on the
    // exact entries it ran on before this contract existed.
    const summaryEntries = providerSummary(priced);
    return Object.freeze({
      contractVersion: MULTI_PROVIDER_INTAKE_CONTRACT_ID,
      accepted: priced.map((reading) => reading.entry),
      rejections: Object.freeze(rejections),
      summary: intakeSummary(summaryEntries, priced, rejections,
        comparabilityOf(summaryEntries, priced, rejections, false)),
    });
  }

  // 2. One source instance per provider. The rule the reconciler enforced across
  //    the whole selection still holds — inside each adapter, where it means
  //    what it always meant: two exports from two OpenAI organizations are not
  //    two halves of one month.
  const bySource = new Map();
  for (const reading of priced) {
    const key = `${reading.providerId}|${reading.sourceInstanceId}`;
    bySource.set(key, [...(bySource.get(key) ?? []), reading]);
  }
  const acceptedSource = new Map();
  for (const [key, group] of [...bySource.entries()].sort((left, right) =>
    right[1].length - left[1].length || left[0].localeCompare(right[0]))) {
    const [provider] = key.split("|");
    if (!acceptedSource.has(provider)) acceptedSource.set(provider, group[0].sourceInstanceId);
  }
  const sourced = priced.filter((reading) => {
    if (acceptedSource.get(reading.providerId) === reading.sourceInstanceId) return true;
    rejections.push(rejection(reading, INTAKE_CODES.INCOMPATIBLE_SOURCE,
      `${labelFor(reading.adapter, reading.providerId)} belongs to a second source instance `
      + "of the same provider."));
    return false;
  });

  // 3. Group by billing window. Within a window, one export per provider: a
  //    second export from the *same* provider is the duplicate the reconciler
  //    always refused, and a second export from a *different* provider is the
  //    other half of the window.
  const windows = new Map();
  for (const reading of [...sourced].sort(compareReadings)) {
    const group = windows.get(reading.periodKey) ?? new Map();
    const held = group.get(reading.providerId);
    if (held) {
      rejections.push(rejection(reading,
        held.exportId === reading.exportId
          ? INTAKE_CODES.DUPLICATE_EXPORT : INTAKE_CODES.DUPLICATE_PERIOD,
        held.exportId === reading.exportId
          ? `${labelFor(reading.adapter, reading.providerId)} was chosen twice.`
          : `${labelFor(reading.adapter, reading.providerId)} supplies period `
            + `${reading.periodKey} more than once.`));
      continue;
    }
    group.set(reading.providerId, reading);
    windows.set(reading.periodKey, group);
  }

  // 4. Overlapping-but-different windows cannot be summed: a January CUR and a
  //    15 Jan – 15 Feb console export share days no arithmetic can separate. The
  //    window carrying more providers wins; ties break by earlier start, then by
  //    the period key, so the same selection always keeps the same window.
  const ranked = [...windows.entries()]
    .map(([key, group]) => ({ key, readings: [...group.values()] }))
    .sort((left, right) => right.readings.length - left.readings.length
      || left.readings[0].start - right.readings[0].start
      || left.key.localeCompare(right.key));
  const kept = [];
  for (const candidate of ranked) {
    const [first] = candidate.readings;
    const overlaps = kept.some((accepted) => {
      const [held] = accepted.readings;
      return first.start < held.end && first.end > held.start;
    });
    if (!overlaps) {
      kept.push(candidate);
      continue;
    }
    for (const reading of candidate.readings) {
      rejections.push(rejection(reading, INTAKE_CODES.MISALIGNED_PERIOD,
        `${labelFor(reading.adapter, reading.providerId)} covers ${reading.periodKey}, which `
        + "overlaps an accepted window without matching it."));
    }
  }

  const accepted = kept
    .sort((left, right) => left.readings[0].start - right.readings[0].start
      || left.key.localeCompare(right.key))
    // Every accepted window, including one only a single provider covered. A
    // combined selection declares one source instance across all of its periods
    // or the reconciler's same-source rule quarantines the odd window out — and
    // "January has two providers, February has one" is an ordinary selection,
    // not a defect.
    .map((candidate) => mergePeriod(candidate.readings));
  const keptReadings = kept.flatMap((candidate) => candidate.readings);
  const summaryEntries = providerSummary(keptReadings);
  return Object.freeze({
    contractVersion: MULTI_PROVIDER_INTAKE_CONTRACT_ID,
    accepted,
    rejections: Object.freeze(rejections),
    summary: intakeSummary(summaryEntries, keptReadings, rejections,
      comparabilityOf(summaryEntries, kept, rejections, summaryEntries.length > 1)),
  });
}

/**
 * What the intake panel paints and what the analysis carries as provenance: who
 * was read, at which adapter version, over which windows, and what was held out
 * with the one action that recovers it.
 */
function intakeSummary(providers, readings, rejections, comparability) {
  return Object.freeze({
    contractVersion: MULTI_PROVIDER_INTAKE_CONTRACT_ID,
    providerCount: providers.length,
    providers,
    comparability,
    rejections: Object.freeze([...rejections]),
    provenance: Object.freeze({
      processing: "browser_local_ephemeral",
      contract: MULTI_PROVIDER_INTAKE_CONTRACT_ID,
      adapters: Object.freeze(providers
        .filter((entry) => entry.adapterId)
        .map((entry) => `${entry.adapterId}/${entry.adapterVersion}`)),
      acceptedExportIds: Object.freeze([...new Set(readings
        .map((reading) => reading.exportId))].sort()),
      sourceInstanceIds: Object.freeze([...new Set(readings
        .map((reading) => reading.sourceInstanceId))].sort()),
      combinedSourceInstanceId: providers.length > 1 ? MULTI_PROVIDER_SOURCE_INSTANCE_ID : null,
    }),
  });
}
