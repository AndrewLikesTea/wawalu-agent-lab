// Versioned dialect profiles for vendor-native tabular exports.
//
// A dialect profile is *data*, not code: it says which columns a given vendor's
// export carries, what each one means in our normalized vocabulary, and how the
// raw cell text is coerced. The detector in `dialect-detection.js` reads only
// this data — it contains no per-vendor branch, so adding a vendor is adding a
// profile here and a fixture in `dialect-fixtures.js`, never an `if`.
//
// THE SCHEMA
//
//   id          Stable slug. Never reused, never renamed — it is what a saved
//               mapping and a test assertion refer to.
//   label       Human name shown in the import panel.
//   kind        "usage" | "roster". Selects the normalized field set below.
//   version     Integer, starts at 1. Bump it whenever a mapping changes; a
//               shipped mapping is never silently mutated, because a stored
//               mapping from a previous import would then mean something else.
//   changelog   One entry per version: { version, note }. Append, never edit.
//   constants   Normalized fields the profile knows without reading a column
//               (e.g. the provider identity, or a unit the vendor never emits).
//   match       Header-shape hints that are *not* derivable from `columns`:
//               minColumns, and forbidden columns that rule the profile out.
//               The required/optional column-name signals are derived from
//               `columns` (see `matchSignals`) so the two can never drift.
//   columns     The authoritative mapping list. One entry per vendor column:
//                 source      Primary vendor header, as the vendor emits it.
//                 aliases     Accepted header variants for the same meaning.
//                             Where a vendor's exact header is uncertain, the
//                             variants we support are encoded here rather than
//                             guessed into `source`.
//                 field       Normalized field, or null for a signal-only
//                             column: it counts toward detection and is not
//                             emitted. Header matching is by name, never by
//                             position, so a reordered export still maps.
//                 coerce      Declared coercion (see COERCIONS). Never inferred
//                             from the cell at runtime.
//                 required    true  -> the column must be present or the
//                                      profile is not a candidate at all.
//                             false -> see whenAbsent.
//                 whenAbsent  Behaviour for an absent optional column, as data:
//                             { mode: "omit" }            field left unset, or
//                             { mode: "default", value }  field set to value.
//
// Values here are vendor-native: a profile maps `Cost Center` to `department`,
// it does not pseudonymize. Turning `owner_id` into the contract's `psn_`
// opaque id is a separate downstream step and deliberately not this layer's job.

/**
 * The closed normalized vocabulary. A profile may only target these fields, so
 * a new vendor cannot quietly widen what the rest of the import flow consumes.
 * `usage` mirrors the provider-usage-billing contract's aggregate; `roster` is
 * defined here for the first time, in the same style, for person-level exports.
 */
export const NORMALIZED_FIELDS = Object.freeze({
  usage: Object.freeze([
    "usage_date", "sku", "owner_id", "usage_quantity", "usage_unit",
    "cost_amount_minor", "cost_currency",
  ]),
  roster: Object.freeze([
    "person_id", "email", "full_name", "manager_id", "department", "status",
  ]),
});

/**
 * The provider-native unit an export is grouped by, as a closed vocabulary.
 *
 * A `usage` profile declares exactly one; a `roster` profile declares none,
 * because a roster is not billed and groups nothing. This is a *declaration*,
 * not an inference: which unit a vendor bills by is a property of the export
 * format, so reading it off a header at runtime would make a downstream join
 * key depend on how one column happened to be spelled.
 *
 * `owner_id` carries this unit's value in every usage profile. The pair
 * (`groupingUnit`, `owner_id`) is therefore the whole answer to "what is this
 * export grouped by, and which column says so" — see `detectDialect`, which
 * republishes it so a consumer never re-derives it from a profile id.
 */
export const PROVIDER_GROUPING_UNITS = Object.freeze([
  "project", "workspace", "account", "resource_group", "api_key", "tag",
]);

/** Normalized fields a record may omit. Everything else must be produced. */
export const OPTIONAL_NORMALIZED_FIELDS = Object.freeze({
  usage: Object.freeze([]),
  roster: Object.freeze(["manager_id"]),
});

/**
 * Header matching is name-based and tolerant of the casing and separator noise
 * vendors differ on, and on nothing else. `CostInBillingCurrency`,
 * `Cost In Billing Currency` and `cost_in_billing_currency` are one column;
 * `cost` and `unblended_cost` are two.
 */
export function normalizeColumnName(name) {
  return String(name ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const STATUS_SYNONYMS = Object.freeze({
  active: "active", employed: "active", hired: "active", full_time: "active",
  on_leave: "suspended", leave: "suspended", suspended: "suspended",
  terminated: "disabled", offboarded: "disabled", inactive: "disabled",
  disabled: "disabled",
});

/**
 * Declared coercions. Each returns the coerced value, or throws `RangeError`
 * with a reader-facing reason. A coercion never guesses a format: `usDate` is
 * used because Azure emits M/D/YYYY, not because a cell happened to look like
 * one. Cost lands in integer minor units to match the billing contract.
 */
export const COERCIONS = Object.freeze({
  string(raw) {
    const value = String(raw ?? "").trim();
    if (!value) throw new RangeError("is empty");
    return value;
  },
  number(raw) {
    const value = Number(String(raw ?? "").trim().replace(/,/g, ""));
    if (!Number.isFinite(value)) throw new RangeError("is not a number");
    return value;
  },
  currencyMinor(raw) {
    const value = Number(String(raw ?? "").trim().replace(/[,$\s]/g, ""));
    if (!Number.isFinite(value)) throw new RangeError("is not a currency amount");
    return Math.round(value * 100);
  },
  currencyCode(raw) {
    const value = String(raw ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(value)) throw new RangeError("is not a 3-letter currency code");
    return value;
  },
  isoDate(raw) {
    const value = String(raw ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError("is not an ISO date");
    return value;
  },
  timestampDate(raw) {
    const value = String(raw ?? "").trim();
    const match = /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/.exec(value);
    if (!match) throw new RangeError("is not an ISO timestamp");
    return match[1];
  },
  usDate(raw) {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(raw ?? "").trim());
    if (!match) throw new RangeError("is not an M/D/YYYY date");
    const [, month, day, year] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  },
  emailAddress(raw) {
    const value = String(raw ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(value)) throw new RangeError("is not an email address");
    return value;
  },
  accountState(raw) {
    const key = normalizeColumnName(raw);
    const value = STATUS_SYNONYMS[key];
    if (!value) throw new RangeError("is not a recognized employment status");
    return value;
  },
});

const column = (source, field, coerce, options = {}) => Object.freeze({
  source,
  aliases: Object.freeze(options.aliases ?? []),
  field,
  coerce,
  required: options.required !== false,
  whenAbsent: options.whenAbsent ? Object.freeze(options.whenAbsent) : null,
});

/** A column that only votes in detection: never emitted, never coerced. */
const signal = (source, aliases = []) =>
  column(source, null, "string", { aliases, required: false, whenAbsent: { mode: "omit" } });

export const DIALECT_PROFILES = Object.freeze([
  Object.freeze({
    id: "openai-usage-export",
    label: "OpenAI organization usage export",
    kind: "usage",
    // One row per project per day; `project` is the column that says so.
    groupingUnit: "project",
    version: 1,
    changelog: Object.freeze([
      Object.freeze({ version: 1, note: "Initial mapping: per-project daily usage with context tokens and amount." }),
    ]),
    constants: Object.freeze({ usage_unit: "tokens" }),
    match: Object.freeze({ minColumns: 5, forbidden: Object.freeze(["line_item_usage_amount"]) }),
    columns: Object.freeze([
      column("usage_date", "usage_date", "isoDate"),
      column("model", "sku", "string"),
      column("project", "owner_id", "string", { aliases: ["project_name", "project_id"] }),
      column("n_context_tokens_total", "usage_quantity", "number", { aliases: ["input_tokens"] }),
      column("amount", "cost_amount_minor", "currencyMinor", { aliases: ["amount_usd", "cost_usd"] }),
      column("currency", "cost_currency", "currencyCode", {
        required: false, whenAbsent: { mode: "default", value: "USD" },
      }),
      signal("n_generated_tokens_total", ["output_tokens"]),
      signal("api_key_name"),
    ]),
  }),
  Object.freeze({
    id: "anthropic-usage-export",
    label: "Anthropic Console usage export",
    kind: "usage",
    // Console usage is grouped by workspace; `workspace` is the column naming it.
    groupingUnit: "workspace",
    version: 1,
    changelog: Object.freeze([
      Object.freeze({ version: 1, note: "Initial mapping: per-workspace daily usage with input tokens and cost." }),
    ]),
    constants: Object.freeze({ usage_unit: "tokens" }),
    match: Object.freeze({ minColumns: 5, forbidden: Object.freeze(["usage_date"]) }),
    columns: Object.freeze([
      column("date", "usage_date", "isoDate"),
      column("model", "sku", "string"),
      column("workspace", "owner_id", "string", { aliases: ["workspace_name", "workspace_id"] }),
      column("input_tokens", "usage_quantity", "number", { aliases: ["uncached_input_tokens"] }),
      column("cost_usd", "cost_amount_minor", "currencyMinor", { aliases: ["cost", "amount_usd"] }),
      column("currency", "cost_currency", "currencyCode", {
        required: false, whenAbsent: { mode: "default", value: "USD" },
      }),
      signal("output_tokens"),
      signal("api_key"),
    ]),
  }),
  Object.freeze({
    id: "aws-cost-and-usage-report",
    label: "AWS Cost and Usage Report",
    kind: "usage",
    // CUR line items are attributed to the usage account that incurred them.
    groupingUnit: "account",
    version: 1,
    changelog: Object.freeze([
      Object.freeze({ version: 1, note: "Initial mapping: CUR line items, unblended cost, usage account as owner." }),
    ]),
    constants: Object.freeze({ usage_unit: "provider-units" }),
    match: Object.freeze({ minColumns: 6, forbidden: Object.freeze([]) }),
    columns: Object.freeze([
      column("line_item_usage_start_date", "usage_date", "timestampDate"),
      column("line_item_product_code", "sku", "string"),
      column("line_item_usage_account_id", "owner_id", "string", { aliases: ["line_item_usage_account_name"] }),
      column("line_item_usage_amount", "usage_quantity", "number"),
      column("line_item_unblended_cost", "cost_amount_minor", "currencyMinor", {
        aliases: ["line_item_net_unblended_cost"],
      }),
      column("line_item_currency_code", "cost_currency", "currencyCode", {
        required: false, whenAbsent: { mode: "default", value: "USD" },
      }),
      signal("bill_billing_period_start_date"),
      signal("product_region", ["product_region_code"]),
    ]),
  }),
  Object.freeze({
    id: "azure-cost-management-export",
    label: "Azure Cost Management export",
    kind: "usage",
    // The cost export attributes each line to the resource group that owns it.
    groupingUnit: "resource_group",
    version: 1,
    changelog: Object.freeze([
      Object.freeze({ version: 1, note: "Initial mapping: amortized cost export, M/D/YYYY dates, resource group as owner." }),
    ]),
    constants: Object.freeze({ usage_unit: "provider-units" }),
    match: Object.freeze({ minColumns: 6, forbidden: Object.freeze([]) }),
    columns: Object.freeze([
      column("Date", "usage_date", "usDate"),
      column("MeterName", "sku", "string"),
      column("ResourceGroup", "owner_id", "string", { aliases: ["ResourceGroupName"] }),
      column("Quantity", "usage_quantity", "number", { aliases: ["UsageQuantity"] }),
      column("CostInBillingCurrency", "cost_amount_minor", "currencyMinor", {
        aliases: ["Cost", "PreTaxCost"],
      }),
      column("BillingCurrency", "cost_currency", "currencyCode", {
        aliases: ["Currency", "BillingCurrencyCode"],
        required: false, whenAbsent: { mode: "default", value: "USD" },
      }),
      signal("MeterCategory"),
      signal("SubscriptionId", ["SubscriptionGuid"]),
    ]),
  }),
  Object.freeze({
    id: "google-cloud-billing-export",
    label: "Google Cloud billing export",
    kind: "usage",
    // Billing export rows are grouped by the project that ran the workload.
    groupingUnit: "project",
    version: 1,
    changelog: Object.freeze([
      Object.freeze({ version: 1, note: "Initial mapping: BigQuery billing export columns, per-row usage unit." }),
    ]),
    constants: Object.freeze({}),
    match: Object.freeze({ minColumns: 6, forbidden: Object.freeze([]) }),
    columns: Object.freeze([
      // Header normalization already folds `sku.description` and
      // `sku_description` together, so the dotted BigQuery spelling is the only
      // one that needs declaring; aliases here name genuinely different headers.
      column("usage_start_time", "usage_date", "timestampDate"),
      column("sku.description", "sku", "string"),
      column("project.id", "owner_id", "string", { aliases: ["project.name"] }),
      column("usage.amount", "usage_quantity", "number"),
      column("cost", "cost_amount_minor", "currencyMinor"),
      column("usage.unit", "usage_unit", "string", {
        required: false, whenAbsent: { mode: "default", value: "provider-units" },
      }),
      column("currency", "cost_currency", "currencyCode", {
        required: false, whenAbsent: { mode: "default", value: "USD" },
      }),
      signal("service.description"),
    ]),
  }),
  Object.freeze({
    id: "generic-hris-roster",
    label: "Generic HRIS worker roster",
    kind: "roster",
    // A roster is not billed, so it groups no spend and declares no unit.
    groupingUnit: null,
    version: 1,
    changelog: Object.freeze([
      Object.freeze({ version: 1, note: "Initial mapping: worker id, work email, name, manager, department, status." }),
    ]),
    constants: Object.freeze({}),
    match: Object.freeze({ minColumns: 5, forbidden: Object.freeze([]) }),
    columns: Object.freeze([
      column("employee_id", "person_id", "string", { aliases: ["person_id", "worker_id", "associate_id"] }),
      column("work_email", "email", "emailAddress", { aliases: ["email", "email_address", "primary_work_email"] }),
      column("full_name", "full_name", "string", { aliases: ["name", "display_name", "preferred_full_name"] }),
      column("department", "department", "string", { aliases: ["team", "cost_center", "org_unit"] }),
      column("employment_status", "status", "accountState", { aliases: ["status", "worker_status"] }),
      column("manager_employee_id", "manager_id", "string", {
        aliases: ["manager_id", "supervisor_id"],
        required: false, whenAbsent: { mode: "omit" },
      }),
      signal("job_title", ["title"]),
      signal("location", ["work_location"]),
    ]),
  }),
]);

const BY_ID = new Map(DIALECT_PROFILES.map((profile) => [profile.id, profile]));

/** The profile with this id, or undefined. Ids are stable and never reused. */
export function profileById(id) {
  return BY_ID.get(id);
}

/** Every accepted header spelling for one column entry, normalized. */
export function columnNames(entry) {
  return [entry.source, ...entry.aliases].map(normalizeColumnName);
}

/**
 * The detection signals a profile contributes, derived from `columns` so the
 * match data and the mapping data are physically the same data.
 */
export function matchSignals(profile) {
  const required = [];
  const optional = [];
  for (const entry of profile.columns) {
    (entry.required ? required : optional).push(columnNames(entry));
  }
  return { required, optional, forbidden: profile.match.forbidden.map(normalizeColumnName) };
}

/**
 * Registry self-check. Run by the suite so a malformed or drifting profile
 * fails at the registry rather than at some vendor's file months later.
 */
export function assertProfileRegistry(profiles = DIALECT_PROFILES) {
  const seen = new Set();
  for (const profile of profiles) {
    const where = `profile ${profile.id}`;
    if (seen.has(profile.id)) throw new Error(`${where}: duplicate id`);
    seen.add(profile.id);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(profile.id)) throw new Error(`${where}: id is not a slug`);
    if (!NORMALIZED_FIELDS[profile.kind]) throw new Error(`${where}: unknown kind ${profile.kind}`);
    // A usage profile must say what it is grouped by, and a roster must say it
    // is grouped by nothing. Either is a declaration; neither may be absent,
    // because a downstream join that resolved `undefined` would silently fall
    // back to whatever key space it was already using.
    if (profile.kind === "usage") {
      if (!PROVIDER_GROUPING_UNITS.includes(profile.groupingUnit)) {
        throw new Error(`${where}: groupingUnit must be one of ${PROVIDER_GROUPING_UNITS.join(", ")}`);
      }
    } else if (profile.groupingUnit !== null) {
      throw new Error(`${where}: a ${profile.kind} profile must declare groupingUnit: null`);
    }
    if (!Number.isInteger(profile.version) || profile.version < 1) {
      throw new Error(`${where}: version must be an integer >= 1`);
    }
    if (profile.changelog.length !== profile.version) {
      throw new Error(`${where}: needs one changelog note per version, `
        + `has ${profile.changelog.length} for version ${profile.version}`);
    }
    if (profile.changelog.at(-1).version !== profile.version) {
      throw new Error(`${where}: newest changelog entry does not name the current version`);
    }

    const allowed = NORMALIZED_FIELDS[profile.kind];
    const produced = new Set(Object.keys(profile.constants));
    const names = new Set();
    for (const entry of profile.columns) {
      for (const name of columnNames(entry)) {
        if (names.has(name)) throw new Error(`${where}: column name ${name} is claimed twice`);
        names.add(name);
      }
      if (!COERCIONS[entry.coerce]) throw new Error(`${where}: unknown coercion ${entry.coerce}`);
      if (entry.field === null) continue;
      if (!allowed.includes(entry.field)) {
        throw new Error(`${where}: ${entry.field} is not a ${profile.kind} field`);
      }
      if (produced.has(entry.field)) throw new Error(`${where}: ${entry.field} is mapped twice`);
      produced.add(entry.field);
      if (!entry.required && !entry.whenAbsent) {
        throw new Error(`${where}: optional column ${entry.source} must declare whenAbsent`);
      }
    }
    for (const field of allowed) {
      if (OPTIONAL_NORMALIZED_FIELDS[profile.kind].includes(field)) continue;
      if (!produced.has(field)) throw new Error(`${where}: nothing produces required field ${field}`);
    }
    const { required } = matchSignals(profile);
    if (!required.length) throw new Error(`${where}: has no required match signal`);
  }
  return profiles;
}
