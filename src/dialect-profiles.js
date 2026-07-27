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
  // An AI-assistant conversation or audit export. `prompt_signals` is the whole
  // of what a prompt body becomes: counts, never text. There is deliberately no
  // field in this vocabulary a raw message body could land in, so "never render
  // the prompt" is a property of the schema rather than a rule downstream code
  // is trusted to remember.
  // `model` is the one string-valued passthrough the rubric's `redaction` block
  // already sanctions, and it is declared here rather than sniffed downstream:
  // which column names the model is a property of the export format, so a
  // consumer that matched a header spelling of its own would decide a rubric
  // signal by accident.
  conversation: Object.freeze([
    "conversation_id", "actor_id", "department", "occurred_at", "prompt_signals", "model",
  ]),
});

/**
 * The contract-level sensitivity flag. One name, used consistently: a column
 * carrying `sensitivity: NEVER_RENDER` may never have its cell value written to
 * a DOM node, an export payload, a storage entry, or a message. Downstream code
 * reads this flag; it never hardcodes a field name.
 */
export const NEVER_RENDER = "never-render";

/**
 * Coercions that answer *about* a cell without returning it. A never-render
 * column must declare one of these, and only a never-render column may — that
 * pairing is checked in `assertProfileRegistry`, so a profile cannot mark a
 * column sensitive and then map it through a coercion that hands the text back.
 */
export const DERIVING_COERCIONS = Object.freeze(["promptSignals"]);

/** The bucket a conversation row lands in when no department column exists. */
export const UNGROUPED_DEPARTMENT = "(ungrouped)";

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

/**
 * THE PRECEDENCE ORDER. One ranked list, used by every dialect, so a tie is
 * resolved identically whatever the vendor and whatever order the columns
 * happen to appear in the file. Index 0 wins.
 *
 * The criterion is *the most specific attribution unit a finance lead would
 * recognize as "a team's spend"* — specific and recognizable, not merely
 * specific. That is why this is not simply "narrowest first":
 *
 *   1. tag             A cost-allocation tag is the only unit on this list the
 *                      customer authored *for chargeback*. If a `CostCenter`
 *                      tag is on the rows, finance has already decided that is
 *                      the attribution key, and no inference beats a decision.
 *   2. project         The project a team owns, and the default team boundary
 *                      in every AI provider console. Named by humans, stable.
 *   3. workspace       The same tier of meaning as `project` under a different
 *                      vendor's spelling; ranked below it only so the order is
 *                      total, since no shipped dialect carries both.
 *   4. resource_group  A team-shaped grouping, but an infrastructure artifact:
 *                      one team often owns several, and platform groups are
 *                      shared. Below a project, above a key.
 *   5. api_key         Narrower than a project and yet *less* recognizable: a
 *                      key alias names an application or a service, keys rotate,
 *                      and plenty of them are unnamed. Specificity alone does
 *                      not make `sk-prod-billing-svc` a team.
 *   6. account         Linked or usage account. Coarsest: frequently one per
 *                      company, so it attributes everything to one unit and
 *                      answers nothing. Last resort, never a tie-break winner.
 *
 * Column order in the file is irrelevant by construction: candidates are
 * matched by name and then sorted by this list, never by position.
 */
export const GROUPING_UNIT_PRECEDENCE = Object.freeze([
  "tag", "project", "workspace", "resource_group", "api_key", "account",
]);

/**
 * One candidate grouping column, declared on a profile.
 *
 *   unit     Which member of `PROVIDER_GROUPING_UNITS` this column carries.
 *   source   The vendor's own header spelling.
 *   aliases  Other headers that mean the same unit. Case, separator style, and
 *            camelCase are folded by `normalizeColumnName`, so only genuinely
 *            different *names* are listed here — `ResourceGroup`,
 *            `resource_group` and `RESOURCE GROUP` are one entry, not three.
 */
const groupingCandidate = (unit, source, aliases = []) => Object.freeze({
  unit, source, aliases: Object.freeze(aliases),
});

/** Normalized fields a record may omit. Everything else must be produced. */
export const OPTIONAL_NORMALIZED_FIELDS = Object.freeze({
  usage: Object.freeze([]),
  roster: Object.freeze(["manager_id"]),
  // `department` is optional by contract: an export without it still imports,
  // and every row lands in `UNGROUPED_DEPARTMENT` instead. Each conversation
  // profile declares that as a `whenAbsent` default, so the degradation is data.
  // `model` is optional for the same reason in the other direction: an audit log
  // that never names a model still imports, and the rules that need a model tier
  // abstain rather than guessing one.
  conversation: Object.freeze(["department", "model"]),
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
  /**
   * A point in time, not a day: a conversation export timestamps turns, and two
   * turns on one day are two events. Accepts ISO 8601 with or without a clock
   * and with or without a zone (absent means UTC, stated rather than guessed),
   * and normalizes to `YYYY-MM-DDTHH:MM:SSZ` so ordering is lexicographic.
   * Nothing else parses: a vendor format we have not declared is a malformed
   * row, never a date this layer invents from a lenient `Date` constructor.
   */
  instant(raw) {
    const value = String(raw ?? "").trim();
    const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*(Z|[+-]\d{2}:?\d{2})?)?$/
      .exec(value);
    if (!match) throw new RangeError("is not an ISO 8601 timestamp");
    const [, day, clock = "00:00:00", zone = "Z"] = match;
    const parsed = new Date(`${day}T${clock.length === 5 ? `${clock}:00` : clock}${zone === "Z" ? "Z" : zone}`);
    if (Number.isNaN(parsed.getTime())) throw new RangeError("is not a real date and time");
    return `${parsed.toISOString().slice(0, 19)}Z`;
  },
  /**
   * The only thing a prompt body is ever turned into. Returns counts and never
   * the text, so a never-render column has nothing to leak even if a caller
   * forgets what it is holding. `token_estimate` is a declared four-characters-
   * per-token approximation, not a tokenizer: it sizes a conversation, and the
   * contract says so rather than implying a provider's own count.
   */
  promptSignals(raw) {
    const value = String(raw ?? "");
    const chars = value.trim().length;
    return Object.freeze({
      chars, token_estimate: Math.ceil(chars / 4), empty: chars === 0,
    });
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
  // null for every column that carries no contract-level handling rule, which
  // is every column of every usage and roster profile.
  sensitivity: options.sensitivity ?? null,
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
    groupingCandidates: Object.freeze([
      groupingCandidate("project", "project", ["project_name", "project_id"]),
      groupingCandidate("api_key", "api_key_name", ["api_key_id", "api_key", "key_name"]),
    ]),
    groupingPrecedence: null,
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
    groupingCandidates: Object.freeze([
      groupingCandidate("workspace", "workspace", ["workspace_name", "workspace_id"]),
      groupingCandidate("api_key", "api_key", ["api_key_name", "key_alias", "api_key_id"]),
    ]),
    groupingPrecedence: null,
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
    // A CUR carries the linked account on every row, so `account` is always
    // available — which is exactly why it is ranked last. A cost-allocation tag
    // is the thing a CUR is usually *read* by.
    groupingCandidates: Object.freeze([
      groupingCandidate("tag", "resourceTags/user:CostCenter", [
        "resourceTags/user:Team", "resourceTags/user:Project",
        "resource_tags_user_cost_centre",
      ]),
      groupingCandidate("account", "line_item_usage_account_id", [
        "line_item_usage_account_name",
      ]),
    ]),
    groupingPrecedence: null,
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
    groupingCandidates: Object.freeze([
      groupingCandidate("tag", "CostCenter", ["Tags/CostCenter"]),
      groupingCandidate("resource_group", "ResourceGroup", ["ResourceGroupName"]),
      groupingCandidate("account", "SubscriptionId", ["SubscriptionGuid", "SubscriptionName"]),
    ]),
    groupingPrecedence: null,
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
    groupingCandidates: Object.freeze([
      groupingCandidate("tag", "labels.team", ["labels.cost_center", "project.labels.team"]),
      groupingCandidate("project", "project.id", ["project.name", "project.number"]),
      groupingCandidate("account", "billing_account_id", []),
    ]),
    groupingPrecedence: null,
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
    // A roster is not billed, so it groups no spend and declares no unit. It is
    // the *enrichment* side of the contract: it maps a grouping unit to a
    // department, and carries no candidate of its own.
    groupingUnit: null,
    groupingCandidates: Object.freeze([]),
    groupingPrecedence: null,
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

/**
 * A conversation column carrying a prompt body. One helper, one flag name, so
 * every consumer asks the schema which column is sensitive instead of matching
 * a header spelling of its own.
 */
const promptColumn = (source, aliases = []) =>
  column(source, "prompt_signals", "promptSignals", { aliases, sensitivity: NEVER_RENDER });

/** The optional department column, with the ungrouped degradation declared. */
const departmentColumn = (source, aliases = []) => column(source, "department", "string", {
  aliases, required: false, whenAbsent: { mode: "default", value: UNGROUPED_DEPARTMENT },
});

/**
 * The column naming the model that answered a turn. Omitted rather than
 * defaulted when absent: there is no honest stand-in for "which model ran this",
 * and a rule that needs a tier abstains on an unknown one already.
 */
const modelColumn = (source, aliases = []) => column(source, "model", "string", {
  aliases, required: false, whenAbsent: { mode: "omit" },
});

/**
 * AI-assistant conversation and audit exports.
 *
 * They are a separate registry, not extra entries in `DIALECT_PROFILES`, for one
 * reason that is a contract statement rather than a filing convenience: the
 * vendor fixtures behind `DIALECT_PROFILES` are asserted to carry no
 * content-bearing column at all, and a conversation export is *defined* by
 * carrying one. Mixing the two would retire that guarantee for the billing
 * dialects, which still deserve it. Detection is the same code either way —
 * `detectDialect` takes the registry as an argument, and `ALL_DIALECT_PROFILES`
 * is the union a surface that accepts both hands it — so nothing about how a
 * usage or roster file is recognized changes by adding these.
 *
 * TIE-BREAKING. No two conversation profiles share a required column name, and
 * each names the others' identifier columns in `match.forbidden`, so a file
 * shaped like two vendors at once is excluded from both rather than resolved by
 * declaration order. Where that is not enough, `detectDialect`'s existing rule
 * still applies unchanged: an exact confidence tie is `unidentified`, and an
 * unidentified file falls through to manual mapping.
 */
export const CONVERSATION_DIALECT_PROFILES = Object.freeze([
  Object.freeze({
    id: "chatgpt-enterprise-conversation-export",
    label: "ChatGPT Enterprise conversation export",
    kind: "conversation",
    groupingUnit: null,
    groupingCandidates: Object.freeze([]),
    groupingPrecedence: null,
    version: 1,
    changelog: Object.freeze([
      Object.freeze({ version: 1, note: "Initial mapping: admin conversation export, one row per message." }),
    ]),
    constants: Object.freeze({}),
    match: Object.freeze({
      minColumns: 5,
      forbidden: Object.freeze(["conversation_uuid", "interaction_id", "event_id"]),
    }),
    columns: Object.freeze([
      column("conversation_id", "conversation_id", "string", { aliases: ["thread_id"] }),
      column("user_email", "actor_id", "emailAddress", { aliases: ["member_email"] }),
      column("created_at", "occurred_at", "instant", { aliases: ["message_created_at"] }),
      promptColumn("message_text", ["message_content"]),
      departmentColumn("department", ["workspace_group"]),
      signal("role"),
      modelColumn("model"),
    ]),
  }),
  Object.freeze({
    id: "claude-enterprise-conversation-export",
    label: "Claude Enterprise conversation export",
    kind: "conversation",
    groupingUnit: null,
    groupingCandidates: Object.freeze([]),
    groupingPrecedence: null,
    version: 1,
    changelog: Object.freeze([
      Object.freeze({ version: 1, note: "Initial mapping: organization conversation export, one row per human turn." }),
    ]),
    constants: Object.freeze({}),
    match: Object.freeze({
      minColumns: 5,
      forbidden: Object.freeze(["conversation_id", "interaction_id", "event_id"]),
    }),
    columns: Object.freeze([
      column("conversation_uuid", "conversation_id", "string", { aliases: ["chat_uuid"] }),
      column("account_email", "actor_id", "emailAddress", { aliases: ["member_email"] }),
      column("started_at", "occurred_at", "instant", { aliases: ["turn_started_at"] }),
      promptColumn("prompt_text", ["human_message"]),
      departmentColumn("organization_group", ["group"]),
      signal("sender"),
      modelColumn("model_slug"),
    ]),
  }),
  Object.freeze({
    id: "copilot-conversation-export",
    label: "Copilot interaction export",
    kind: "conversation",
    groupingUnit: null,
    groupingCandidates: Object.freeze([]),
    groupingPrecedence: null,
    version: 1,
    changelog: Object.freeze([
      Object.freeze({ version: 1, note: "Initial mapping: assistant interaction export, one row per interaction." }),
    ]),
    constants: Object.freeze({}),
    match: Object.freeze({
      minColumns: 5,
      forbidden: Object.freeze(["conversation_id", "conversation_uuid", "event_id"]),
    }),
    columns: Object.freeze([
      column("interaction_id", "conversation_id", "string", { aliases: ["turn_id"] }),
      column("user_principal_name", "actor_id", "emailAddress", { aliases: ["upn"] }),
      column("interaction_time", "occurred_at", "instant", { aliases: ["interaction_timestamp"] }),
      promptColumn("prompt_body", ["user_prompt"]),
      departmentColumn("cost_center", ["group_name"]),
      signal("app_host"),
      signal("client_type"),
    ]),
  }),
  Object.freeze({
    id: "workspace-audit-conversation-export",
    label: "Workspace assistant audit export",
    kind: "conversation",
    groupingUnit: null,
    groupingCandidates: Object.freeze([]),
    groupingPrecedence: null,
    version: 1,
    changelog: Object.freeze([
      Object.freeze({ version: 1, note: "Initial mapping: workspace audit log of assistant events." }),
    ]),
    constants: Object.freeze({}),
    match: Object.freeze({
      minColumns: 5,
      forbidden: Object.freeze(["conversation_id", "conversation_uuid", "interaction_id"]),
    }),
    columns: Object.freeze([
      column("event_id", "conversation_id", "string", { aliases: ["record_id"] }),
      column("actor_email", "actor_id", "emailAddress", { aliases: ["actor_user"] }),
      column("event_time", "occurred_at", "instant", { aliases: ["event_timestamp"] }),
      promptColumn("prompt_content", ["query_text"]),
      departmentColumn("org_unit_path", ["organizational_unit"]),
      signal("event_name"),
      signal("application"),
    ]),
  }),
]);

/**
 * Every profile a surface that accepts both families detects against. The order
 * is billing dialects first, unchanged, then conversation dialects — but order
 * decides nothing: `detectDialect` scores every profile and refuses a tie.
 */
export const ALL_DIALECT_PROFILES = Object.freeze([
  ...DIALECT_PROFILES, ...CONVERSATION_DIALECT_PROFILES,
]);

/** The never-render column of a profile, or null. Read the flag, not the name. */
export function neverRenderColumns(profile) {
  return (profile?.columns ?? []).filter((entry) => entry.sensitivity === NEVER_RENDER);
}

const BY_ID = new Map(ALL_DIALECT_PROFILES.map((profile) => [profile.id, profile]));

/** The profile with this id, or undefined. Ids are stable and never reused. */
export function profileById(id) {
  return BY_ID.get(id);
}

/** Every accepted header spelling for one column entry, normalized. */
export function columnNames(entry) {
  return [entry.source, ...entry.aliases].map(normalizeColumnName);
}

/**
 * The precedence list this profile resolves ties with: its own declared
 * override, or the global order. A profile may override only where the dialect's
 * semantics genuinely differ, and the override is declared *here*, in the
 * profile, so the detector stays free of per-vendor branches.
 */
export function groupingPrecedenceFor(profile) {
  return profile?.groupingPrecedence ?? GROUPING_UNIT_PRECEDENCE;
}

/**
 * A profile's candidate grouping columns, sorted by its precedence list and
 * annotated with the rank. Sorting happens here, on the declared data, so the
 * detector never has to know the order and column position never enters into it.
 */
export function rankedGroupingCandidates(profile) {
  const order = groupingPrecedenceFor(profile);
  return Object.freeze([...(profile?.groupingCandidates ?? [])]
    .map((candidate) => Object.freeze({ ...candidate, rank: order.indexOf(candidate.unit) }))
    .sort((left, right) => left.rank - right.rank));
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
 * The grouping half of the registry self-check, split out only for length.
 *
 * A candidate list that names an unknown unit, ranks the same unit twice, or
 * claims one header for two units is a silent mis-attribution waiting to happen,
 * so it is a registry error rather than a runtime surprise.
 */
function assertGroupingCandidates(profile, where) {
  const candidates = profile.groupingCandidates;
  if (!Array.isArray(candidates)) throw new Error(`${where}: groupingCandidates must be an array`);
  if (profile.kind !== "usage") {
    if (candidates.length) throw new Error(`${where}: a ${profile.kind} profile groups nothing`);
    if (profile.groupingPrecedence !== null) {
      throw new Error(`${where}: a ${profile.kind} profile must declare groupingPrecedence: null`);
    }
    return;
  }
  if (!candidates.length) throw new Error(`${where}: a usage profile needs a grouping candidate`);
  const order = groupingPrecedenceFor(profile);
  if (profile.groupingPrecedence !== null) {
    const ranked = new Set(profile.groupingPrecedence);
    if (ranked.size !== profile.groupingPrecedence.length
      || profile.groupingPrecedence.some((unit) => !PROVIDER_GROUPING_UNITS.includes(unit))) {
      throw new Error(`${where}: groupingPrecedence must rank known units, each at most once`);
    }
  }
  const units = new Set();
  const headers = new Set();
  for (const candidate of candidates) {
    if (!PROVIDER_GROUPING_UNITS.includes(candidate.unit)) {
      throw new Error(`${where}: grouping candidate unit ${candidate.unit} is not a known unit`);
    }
    if (units.has(candidate.unit)) {
      throw new Error(`${where}: two grouping candidates claim the unit ${candidate.unit}`);
    }
    units.add(candidate.unit);
    if (!order.includes(candidate.unit)) {
      throw new Error(`${where}: grouping candidate ${candidate.unit} is unranked`);
    }
    for (const name of columnNames(candidate)) {
      if (!name) throw new Error(`${where}: grouping candidate ${candidate.unit} has a blank header`);
      if (headers.has(name)) {
        throw new Error(`${where}: grouping header ${name} is claimed twice`);
      }
      headers.add(name);
    }
  }
  if (!units.has(profile.groupingUnit)) {
    throw new Error(`${where}: declared groupingUnit ${profile.groupingUnit} has no candidate column`);
  }
}

/**
 * Registry self-check. Run by the suite so a malformed or drifting profile
 * fails at the registry rather than at some vendor's file months later.
 */
export function assertProfileRegistry(profiles = DIALECT_PROFILES) {
  // The one ordering must rank every unit exactly once, or two dialects could
  // resolve the same pair of candidates differently.
  if (GROUPING_UNIT_PRECEDENCE.length !== PROVIDER_GROUPING_UNITS.length
    || PROVIDER_GROUPING_UNITS.some((unit) => !GROUPING_UNIT_PRECEDENCE.includes(unit))) {
    throw new Error("GROUPING_UNIT_PRECEDENCE must rank every provider grouping unit exactly once");
  }
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
    assertGroupingCandidates(profile, where);
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
      // The never-render pairing, both ways. A sensitive column must be mapped
      // through a coercion that cannot return its text, and a coercion that
      // exists only to avoid returning text may not be used anywhere else —
      // otherwise a later edit could quietly turn either half into decoration.
      if (entry.sensitivity !== null && entry.sensitivity !== NEVER_RENDER) {
        throw new Error(`${where}: unknown sensitivity ${entry.sensitivity} on ${entry.source}`);
      }
      if (entry.sensitivity === NEVER_RENDER && !DERIVING_COERCIONS.includes(entry.coerce)) {
        throw new Error(`${where}: never-render column ${entry.source} must use a deriving coercion`);
      }
      if (DERIVING_COERCIONS.includes(entry.coerce) && entry.sensitivity !== NEVER_RENDER) {
        throw new Error(`${where}: ${entry.source} uses a deriving coercion without the never-render flag`);
      }
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
    // A conversation export exists to carry prompt bodies. Exactly one column
    // may say so — two would mean two rules to enforce, and none would mean the
    // profile is reading something else.
    if (profile.kind === "conversation" && neverRenderColumns(profile).length !== 1) {
      throw new Error(`${where}: a conversation profile needs exactly one never-render column`);
    }
  }
  return profiles;
}
