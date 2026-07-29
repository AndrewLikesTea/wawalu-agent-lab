// The package layer above the column layer: what a reader actually downloads.
//
// Everything this repository already declares about provider exports starts at
// the header row. `dialect-profiles.js` says which columns an OpenAI usage
// export carries; `finops-tabular-import.js` says what those columns become.
// Neither says the thing a reader asks first — *where do I get that file, what
// will it arrive as, and what do I have to take out of it before I open it in
// somebody's product?* That question was answered in prose scattered across a
// panel, a help sentence, and an error message, which is another way of saying
// it was answered three times and versioned zero.
//
// This module is the one answer, versioned. It is a contract document —
// `manifest_version`, `kind`, and a frozen body — plus the accessors the
// importer and the import panel read it through. The committed bytes under
// `contracts/integrations/provider-export-package/v1/manifest.json` are
// `contractDocument()` serialized, asserted byte-for-byte by
// `tests/provider-export-package.test.js`, so the shipped contract, the parser's
// behaviour, and the sentence on the page cannot drift apart.
//
// Three rules hold:
//
//   1. Every package entry states its own intake terms. A provider is added by
//      adding an entry here, not by branching in the parser or writing a second
//      sentence into the markup.
//   2. Nothing in here reaches a provider. There is no endpoint, no credential,
//      no token, no redirect: the reader downloads their own export from their
//      own console and picks the file. The guidance describes their console; the
//      product never touches it.
//   3. An unsupported package is a described path, not a dead end. A `.zip` is
//      the *normal* delivery for several of these vendors, so being handed one
//      is an expected event with a stated next step, not an error to apologise
//      for.
//
// No DOM, no I/O, no imports. Pure data plus accessors.

/** The contract's own identity. Consumers allowlist the exact version. */
export const PROVIDER_EXPORT_PACKAGE_KIND = "wawalu.integration.provider-export-package";
export const PROVIDER_EXPORT_PACKAGE_VERSION = "1.0";

/**
 * What is true of every intake, stated once so no package entry can quietly
 * weaken it. These are properties of the shipped code — the parser performs no
 * I/O of any kind and the never-render rule is enforced by the conversation
 * contract's coercions — not aspirations printed on a page.
 */
const INTAKE = Object.freeze({
  processing: "reader's own browser tab",
  uploads: false,
  network_calls: false,
  credentials: false,
  prompt_storage: false,
  prompt_rendering: false,
  browser_storage: "opt-in workspace only, and never a raw file or a cell value",
  retained_from_a_file: Object.freeze([
    "column headers",
    "aggregate totals per day, org unit, and model",
    "pseudonymous org-unit and model identifiers",
  ]),
  never_retained: Object.freeze([
    "the file itself",
    "any cell value, including in an error message",
    "prompt, completion, or any free-text column",
    "any per-person or per-request row",
  ]),
});

/** Formats the local importer parses. Extensions and media types, once. */
const ACCEPTED_FORMATS = Object.freeze([
  Object.freeze({
    id: "csv",
    label: "Comma-separated values",
    extensions: Object.freeze([".csv"]),
    media_types: Object.freeze(["text/csv", "application/csv", "application/vnd.ms-excel", ""]),
    encoding: "utf-8",
  }),
  Object.freeze({
    id: "tsv",
    label: "Tab-separated values",
    extensions: Object.freeze([".tsv"]),
    media_types: Object.freeze(["text/tab-separated-values", "text/plain", ""]),
    encoding: "utf-8",
  }),
  Object.freeze({
    id: "delimited-text",
    label: "Delimited text with a declared delimiter",
    extensions: Object.freeze([".txt"]),
    media_types: Object.freeze(["text/plain", ""]),
    encoding: "utf-8",
  }),
  Object.freeze({
    id: "v1-envelope",
    label: "Wawalu v1 provider-usage or HRIS-org JSON envelope",
    extensions: Object.freeze([".json"]),
    media_types: Object.freeze(["application/json", ""]),
    encoding: "utf-8",
  }),
]);

/**
 * Containers a reader will genuinely be handed, each with the one step that
 * turns it into something this page reads. `do_instead` is the sentence the
 * rejection carries, so the refusal and the contract are the same words.
 */
const UNSUPPORTED_CONTAINERS = Object.freeze([
  Object.freeze({
    extensions: Object.freeze([".zip"]),
    label: "ZIP archive",
    why: "Several consoles deliver the export as an archive; this page reads one text file at a time.",
    do_instead: "Open the archive on your own machine and choose the CSV member named by the package below.",
  }),
  Object.freeze({
    extensions: Object.freeze([".gz", ".tgz", ".bz2"]),
    label: "Compressed file",
    why: "A compressed export is not decompressed here; nothing is written to disk by this page.",
    do_instead: "Decompress it on your own machine, then choose the CSV inside it.",
  }),
  Object.freeze({
    extensions: Object.freeze([".xlsx", ".xls", ".numbers", ".ods"]),
    label: "Spreadsheet workbook",
    why: "A workbook carries formatting, formulas, and sheets this contract does not declare.",
    do_instead: "Save the usage sheet as CSV, then choose that file.",
  }),
  Object.freeze({
    extensions: Object.freeze([".pdf", ".html", ".htm"]),
    label: "Rendered invoice or report",
    why: "An invoice is a picture of a total, not the daily rows the analysis needs.",
    do_instead: "Request the usage or cost export instead of the invoice; the packages below name where.",
  }),
  Object.freeze({
    extensions: Object.freeze([".ndjson", ".jsonl", ".xml", ".parquet", ".avro"]),
    label: "Undeclared record format",
    why: "This contract declares CSV, TSV, delimited text, and the v1 JSON envelope, and nothing else.",
    do_instead: "Re-export as CSV, or convert it yourself before choosing the file.",
  }),
]);

/**
 * One entry per supported package. `dialect_id` binds the package to the column
 * profile that reads it, and `shape_id` to the normalizer where one exists —
 * both asserted against the live registries by the contract test, so a renamed
 * profile breaks the build rather than silently orphaning this guidance.
 *
 * `console_path` describes the vendor's own console as of this contract version.
 * A console gets rearranged; that is a documentation bump here, not a code
 * change anywhere, and a reader who cannot find the menu still has the archive
 * and format rows to recognise the right file by.
 */
const PACKAGES = Object.freeze([
  Object.freeze({
    id: "openai-usage-export",
    label: "OpenAI organization usage export",
    provider: "openai",
    kind: "usage",
    dialect_id: "openai-usage-export",
    shape_id: "openai_usage",
    provider_patterns: Object.freeze(["openai", "gpt", "o\\d-", "davinci"]),
    export_request: Object.freeze({
      requested_by: "an organization owner or billing member",
      console_path: "Settings → Organization → Usage, then Export for one billing period",
      ask_for: "the cost and usage export, grouped by project and model",
      not: "the invoice PDF, and not a per-user activity report",
    }),
    archive: Object.freeze({
      delivery: "downloads in your browser",
      lands_in: "your own download folder — this page never looks there; you choose the file",
      container: "single file",
      member: null,
      expected_content: "one row per day, project, and model, with a cost column",
    }),
    accepted_formats: Object.freeze(["csv", "tsv", "delimited-text"]),
    redaction: Object.freeze({
      before_import: Object.freeze([
        "Do not request the per-user breakdown; department-level rows are what the analysis reads.",
        "Delete any column naming an individual account before you choose the file.",
      ]),
      never_read: Object.freeze([
        "user", "user email", "api key", "prompt", "completion", "request id",
      ]),
      pseudonymized_on_read: Object.freeze(["project name", "model"]),
    }),
  }),
  Object.freeze({
    id: "anthropic-usage-export",
    label: "Anthropic Console usage export",
    provider: "anthropic",
    kind: "usage",
    dialect_id: "anthropic-usage-export",
    shape_id: "anthropic_usage",
    provider_patterns: Object.freeze(["anthropic", "claude"]),
    export_request: Object.freeze({
      requested_by: "a workspace admin or billing contact",
      console_path: "Console → Usage, filtered to one period, then Export CSV",
      ask_for: "usage and cost by workspace and model",
      not: "the conversation or audit export, which carries prompt text and has its own contract",
    }),
    archive: Object.freeze({
      delivery: "downloads in your browser",
      lands_in: "your own download folder; nothing is fetched from the console by this page",
      container: "single file",
      member: null,
      expected_content: "one row per day, workspace, and model, with input and output token columns",
    }),
    accepted_formats: Object.freeze(["csv", "tsv", "delimited-text"]),
    redaction: Object.freeze({
      before_import: Object.freeze([
        "Export usage, not conversations; a conversation export is read under the never-render rule instead.",
        "Remove any API-key label column — a key name identifies a person on small teams.",
      ]),
      never_read: Object.freeze([
        "prompt", "message", "content", "api key", "user email",
      ]),
      pseudonymized_on_read: Object.freeze(["workspace", "model"]),
    }),
  }),
  Object.freeze({
    id: "aws-cost-and-usage-report",
    label: "AWS Cost and Usage Report (Bedrock lines)",
    provider: "aws",
    kind: "usage",
    dialect_id: "aws-cost-and-usage-report",
    shape_id: "bedrock_usage",
    provider_patterns: Object.freeze(["bedrock", "aws", "amazon", "titan", "nova"]),
    export_request: Object.freeze({
      requested_by: "the payer-account owner or a FinOps engineer with Cost Explorer access",
      console_path: "Billing → Data Exports → Standard data export, scoped to the Bedrock product code",
      ask_for: "daily granularity with the cost-allocation tag that carries your cost centre",
      not: "the full unfiltered CUR for every service, which is large and mostly irrelevant here",
    }),
    archive: Object.freeze({
      delivery: "written to an S3 bucket you own",
      lands_in: "your bucket; download one period yourself and choose that file",
      container: "zip or gzip archive",
      member: "the CSV part file inside the report folder for the period",
      expected_content: "line items with usage start date, unblended cost, and your cost-centre tag column",
    }),
    accepted_formats: Object.freeze(["csv", "tsv", "delimited-text"]),
    redaction: Object.freeze({
      before_import: Object.freeze([
        "Decompress and, if the report is split into parts, choose one part per import.",
        "Drop resource-id and account-id columns; the cost-centre tag is the only grouping this reads.",
      ]),
      never_read: Object.freeze([
        "lineitem resourceid", "bill payeraccountid", "identity lineitemid", "lineitem description",
      ]),
      pseudonymized_on_read: Object.freeze(["cost centre tag value", "product code"]),
    }),
  }),
  Object.freeze({
    id: "google-cloud-billing-export",
    label: "Google Cloud billing export (Vertex AI lines)",
    provider: "google",
    kind: "usage",
    dialect_id: "google-cloud-billing-export",
    shape_id: null,
    provider_patterns: Object.freeze(["google", "gemini", "vertex", "palm"]),
    export_request: Object.freeze({
      requested_by: "a billing-account administrator",
      console_path: "Billing → Cost table, filtered to the Vertex AI service, then Download CSV",
      ask_for: "daily cost by project and SKU for one month",
      not: "the BigQuery detailed export, which carries far more than this contract declares",
    }),
    archive: Object.freeze({
      delivery: "downloads in your browser",
      lands_in: "your own download folder; the billing account is never contacted from this page",
      container: "single file",
      member: null,
      expected_content: "one row per day, project, and SKU, with a cost column in the billing currency",
    }),
    accepted_formats: Object.freeze(["csv", "tsv", "delimited-text"]),
    redaction: Object.freeze({
      before_import: Object.freeze([
        "Export one billing currency at a time; rows in a second currency are quarantined, not converted.",
        "Remove label columns that carry a person's name or address.",
      ]),
      never_read: Object.freeze(["labels", "system labels", "credits", "project number"]),
      pseudonymized_on_read: Object.freeze(["project", "sku"]),
    }),
    support: "columns recognized; no normalizer shape yet, so this package reaches the manual column-mapping step",
  }),
  Object.freeze({
    id: "azure-cost-management-export",
    label: "Azure Cost Management export (Azure OpenAI lines)",
    provider: "azure",
    kind: "usage",
    dialect_id: "azure-cost-management-export",
    shape_id: null,
    provider_patterns: Object.freeze(["azure", "microsoft"]),
    export_request: Object.freeze({
      requested_by: "a subscription owner or cost-management contributor",
      console_path: "Cost Management → Exports → new daily export, scoped to the Azure OpenAI service",
      ask_for: "actual cost, daily, with the tag that carries your cost centre",
      not: "amortized and actual in one file; pick one basis and stay on it across periods",
    }),
    archive: Object.freeze({
      delivery: "written to a storage account you own",
      lands_in: "your storage container; download one period yourself and choose that file",
      container: "single file per period, sometimes zipped",
      member: "the CSV for the period, if the download is an archive",
      expected_content: "one row per day, resource, and meter, with a cost column and your tag column",
    }),
    accepted_formats: Object.freeze(["csv", "tsv", "delimited-text"]),
    redaction: Object.freeze({
      before_import: Object.freeze([
        "Keep one cost basis per import; mixing actual and amortized rows double-counts a period.",
        "Drop resource-id and subscription-id columns before choosing the file.",
      ]),
      never_read: Object.freeze(["resourceid", "subscriptionid", "tags", "publishername"]),
      pseudonymized_on_read: Object.freeze(["cost centre tag value", "meter name"]),
    }),
    support: "columns recognized; no normalizer shape yet, so this package reaches the manual column-mapping step",
  }),
  Object.freeze({
    id: "generic-hris-roster",
    label: "HRIS org roster",
    provider: null,
    kind: "roster",
    dialect_id: "generic-hris-roster",
    shape_id: "org_roster",
    provider_patterns: Object.freeze([]),
    export_request: Object.freeze({
      requested_by: "an HRIS administrator or the people-operations partner who owns the org tree",
      console_path: "your HRIS reporting section: a unit report, not a worker report",
      ask_for: "unit id, parent unit, unit type, and whether the unit is active",
      not: "a worker list — no person-level row is needed, accepted, or read",
    }),
    archive: Object.freeze({
      delivery: "downloads in your browser, or arrives from your HRIS partner",
      lands_in: "wherever you saved it; you choose it alongside the provider period",
      container: "single file",
      member: null,
      expected_content: "one row per organizational unit, with its parent",
    }),
    accepted_formats: Object.freeze(["csv", "tsv", "delimited-text", "v1-envelope"]),
    redaction: Object.freeze({
      before_import: Object.freeze([
        "Send units, never people: delete name, email, title, manager, compensation, and location columns.",
        "A unit smaller than the declared minimum group size is still a unit here; it is suppressed downstream.",
      ]),
      never_read: Object.freeze([
        "name", "email", "employee id", "job title", "manager", "compensation", "location",
      ]),
      pseudonymized_on_read: Object.freeze(["unit id", "unit name", "parent unit"]),
    }),
  }),
]);

/**
 * What the intake does with a delivery that is not clean. Each entry names the
 * observable behaviour, not an intention; every one is asserted by a test that
 * drives the real parser.
 */
const DELIVERY_BEHAVIOUR = Object.freeze({
  partial: Object.freeze({
    situation: "Some rows are unreadable — a bad date, a negative amount, a short row.",
    behaviour: "The readable rows import and every rejected row is reported with a code, a row number, "
      + "and a column name. Partial success is the normal case, not a failure.",
    never: "A rejected row is never silently dropped and never repaired by guessing.",
  }),
  stale: Object.freeze({
    situation: "The chosen file is an older period, or one already imported.",
    behaviour: "It imports. A delimited export carries no delivery sequence, so freshness is the reader's "
      + "own file-picking decision; overlapping periods from one source reconcile by date, and the "
      + "provenance label states the period that was read.",
    never: "A stale file never silently replaces a newer period's totals under a fresh-looking label.",
  }),
  malformed: Object.freeze({
    situation: "The file is not the shape it claims — an unclosed quoted field, a header with no data, "
      + "a row count that disagrees with the header.",
    behaviour: "The import is refused whole, with one code and one located coordinate. A ceiling breach "
      + "(size or rows) is likewise a whole-file refusal, never a truncation.",
    never: "No partial total is ever shown, because a short total is indistinguishable from a real one.",
  }),
  reordered: Object.freeze({
    situation: "Rows arrive out of date order, or periods are chosen in the wrong order.",
    behaviour: "Accepted. Every aggregate is derived from the date column, so row order changes no figure, "
      + "and multi-file selections are ordered by their declared periods rather than by pick order.",
    never: "Row order is never treated as chronology.",
  }),
  duplicated: Object.freeze({
    situation: "The same period is chosen twice, or a file contains repeated rows.",
    behaviour: "Identical aggregate rows collapse; a repeated period from the same source is reconciled "
      + "rather than summed twice, and the count the reader sees is the reconciled one.",
    never: "A duplicate is never added into a total on the quiet.",
  }),
});

/** The path for a package this contract does not support. */
const UNSUPPORTED_PACKAGE = Object.freeze({
  code: "unsupported_format",
  headline: "This file is not one of the declared packages.",
  recovery: "Choose a .csv/.tsv provider usage export or org roster, or a .json v1 envelope. "
    + "If your console delivered an archive, open it and choose the CSV inside.",
  behaviour: "The file is refused before it is parsed. Nothing about it is read, kept, or reported "
    + "beyond its extension and media type.",
  never: "An unrecognized package is never partially parsed to see what it might have been.",
});

const CONTRACT = Object.freeze({
  manifest_version: PROVIDER_EXPORT_PACKAGE_VERSION,
  kind: PROVIDER_EXPORT_PACKAGE_KIND,
  published_at: "2026-07-29T00:00:00Z",
  fixture_data: "synthetic-only",
  intake: INTAKE,
  accepted_formats: ACCEPTED_FORMATS,
  unsupported_containers: UNSUPPORTED_CONTAINERS,
  packages: PACKAGES,
  unsupported_package: UNSUPPORTED_PACKAGE,
  delivery_behaviour: DELIVERY_BEHAVIOUR,
});

export { CONTRACT as PROVIDER_EXPORT_PACKAGE_CONTRACT, PACKAGES as EXPORT_PACKAGES };
export { DELIVERY_BEHAVIOUR, UNSUPPORTED_PACKAGE };

/** The document as plain JSON — the committed manifest is exactly these bytes. */
export function contractDocument() {
  return JSON.parse(JSON.stringify(CONTRACT));
}

export function packageById(id) {
  return PACKAGES.find((entry) => entry.id === id) ?? null;
}

/** Extensions the delimited path accepts, derived from the declared formats. */
export const ACCEPTED_PACKAGE_EXTENSIONS = Object.freeze(
  ACCEPTED_FORMATS.filter((format) => format.id !== "v1-envelope")
    .flatMap((format) => format.extensions),
);

/** Media types the delimited path accepts, deduplicated, empty string included
 * because a browser hands over `""` for a file it cannot type. */
export const ACCEPTED_PACKAGE_MEDIA_TYPES = Object.freeze([...new Set(
  ACCEPTED_FORMATS.filter((format) => format.id !== "v1-envelope")
    .flatMap((format) => format.media_types),
)]);

/**
 * Provider identification, compiled from the packages in declared order. The
 * importer had this list inline; it lives here now so the vendor a package
 * describes and the vendor its rows are attributed to are one statement.
 */
export const PROVIDER_PATTERNS = Object.freeze(
  PACKAGES.filter((entry) => entry.provider && entry.provider_patterns.length)
    .map((entry) => Object.freeze([new RegExp(entry.provider_patterns.join("|"), "i"), entry.provider])),
);

function extensionOf(fileName) {
  const name = String(fileName ?? "").toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot);
}

/** The declared container for an extension we refuse, or `null`. */
export function unsupportedContainerFor(fileName) {
  const extension = extensionOf(fileName);
  if (!extension) return null;
  return UNSUPPORTED_CONTAINERS.find((entry) => entry.extensions.includes(extension)) ?? null;
}

/**
 * The refusal sentence for a file this contract does not declare. A recognized
 * container gets its own next step; anything else gets the general one. No cell
 * value and no file name is ever interpolated — the reader is looking at their
 * own file while they read this.
 */
export function unsupportedPackageMessage(fileName) {
  const container = unsupportedContainerFor(fileName);
  if (!container) {
    return "Choose a .json, .csv, .tsv, or .txt export; other formats are not declared.";
  }
  return `${container.label}: ${container.why} ${container.do_instead}`;
}

/**
 * Route a selected file against the contract. `supported` means the format is
 * declared and the importer will attempt it; the column layer still decides
 * which package it actually is, from the header rather than from the name.
 */
export function matchExportPackage({ fileName = "", mediaType = "" } = {}) {
  const extension = extensionOf(fileName);
  const format = ACCEPTED_FORMATS.find((entry) => entry.extensions.includes(extension));
  if (!format) {
    return Object.freeze({
      status: "unsupported",
      code: UNSUPPORTED_PACKAGE.code,
      format: null,
      container: unsupportedContainerFor(fileName),
      message: unsupportedPackageMessage(fileName),
      recovery: UNSUPPORTED_PACKAGE.recovery,
    });
  }
  // The delimited formats share one media-type set on purpose: a browser types
  // a `.tsv` as `text/plain` as readily as a `.txt`, and the dialect is decided
  // by sniffing the header, never by the name or the type. Only the envelope,
  // which routes to a different validator entirely, is checked against its own.
  const declared = format.id === "v1-envelope" ? format.media_types : ACCEPTED_PACKAGE_MEDIA_TYPES;
  if (mediaType && !declared.includes(mediaType)) {
    return Object.freeze({
      status: "unsupported",
      code: UNSUPPORTED_PACKAGE.code,
      format: format.id,
      container: null,
      message: `The file media type “${mediaType}” is not a declared delimited-text type.`,
      recovery: UNSUPPORTED_PACKAGE.recovery,
    });
  }
  return Object.freeze({
    status: "supported",
    code: null,
    format: format.id,
    container: null,
    message: "",
    recovery: "",
  });
}

/**
 * The guidance rows the import panel paints, one package at a time. Terms are
 * fixed and ordered so the panel is a table of the same four questions for
 * every vendor rather than a paragraph per vendor.
 */
export function exportPackageGuidance(entry) {
  if (!entry) return [];
  const request = entry.export_request;
  const archive = entry.archive;
  const formats = entry.accepted_formats
    .map((id) => ACCEPTED_FORMATS.find((format) => format.id === id))
    .filter(Boolean)
    .flatMap((format) => format.extensions)
    .join(", ");
  return Object.freeze([
    Object.freeze({
      term: "Ask for",
      detail: `${request.ask_for} — ${request.console_path}. Requested by ${request.requested_by}. `
        + `Not ${request.not}.`,
    }),
    Object.freeze({
      term: "Arrives as",
      detail: `${archive.container}, ${archive.delivery}, ${archive.lands_in}. `
        + `${archive.member ? `Choose ${archive.member}. ` : ""}Expect ${archive.expected_content}.`,
    }),
    Object.freeze({ term: "Accepted here", detail: formats }),
    Object.freeze({
      term: "Take out first",
      detail: `${entry.redaction.before_import.join(" ")} Never read: `
        + `${entry.redaction.never_read.join(", ")}. Pseudonymized on read: `
        + `${entry.redaction.pseudonymized_on_read.join(", ")}.`,
    }),
  ]);
}

/** The promise every package makes, written once, painted wherever guidance is. */
export const PACKAGE_INTAKE_SENTENCE =
  "Every file below is read in this browser tab: nothing is uploaded, no credential is used, "
  + "no console is contacted, and no prompt text is stored or drawn on this page.";
