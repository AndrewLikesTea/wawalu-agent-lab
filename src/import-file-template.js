// A blank CSV template and a worked CSV sample per pinned intake adapter
// (#1167), so a platform lead can check the shape of the file they owe before
// they go and export real data.
//
// THE CONTRACT IS THE DELIVERABLE; THE FILES ARE DERIVED. Not one header string
// is typed in this module. The columns come from the shape the pinned adapter
// declares in `finops-tabular-import.js`, reached through the adapter list in
// `multi-provider-intake.js` — the same two facts `import-recipes.js` reads to
// print "Columns read" on the surface, and the same shape `detectShape` binds a
// dropped file against. Renaming a column in the contract renames it in the
// template, in the sample, and on the row, in one edit. A template that has
// gone stale against the contract is not a state this module can reach.
//
// The sample ROWS are keyed by the shape's own canonical field name — `date`,
// `orgUnit`, `model`, `amount` — never by position. A required column added to
// a shape therefore throws here at build and at boot, naming the field it has
// no synthetic value for, rather than silently shifting every cell one place
// left and shipping a sample that imports into the wrong columns.
//
// WHAT IS IN THE ROWS. Nothing real, and nothing that could be mistaken for
// something real: `example-dept-*` and `example-workspace-*` units, `example-
// model-*` identifiers, two calendar days in a period that is plainly a
// placeholder. No account id, no ARN, no key reference, no email, no prompt
// text, no customer-derived anything. `tests/import-file-template.test.js`
// enforces that as a rule rather than a reading.
//
// WHAT IT NEVER DOES. No fetch, no server route, no credential, no storage, no
// clock, no randomness. The caller serializes in the reader's own tab and hands
// the text to the page's existing local blob download, which revokes its object
// URL as soon as the click is dispatched. The same call returns byte-identical
// text on every machine on every day.
//
// WHY IT IS NOT IN THE PAGE'S STATIC GRAPH. /evolution.html's initial payload is
// budgeted (`config/evolution-size-budget.json`). Rows a reader needs only once
// they ask for a file are not initial payload, so this module is reached by
// `await import(...)` from the download handler and stays out of the entry
// graph. The one fact a lead reads BEFORE downloading — what the sample adds up
// to — is published in `import-recipes.js` instead, which already ships.
//
// PARTIAL, STALE, MALFORMED, REORDERED. Stated already, per adapter, and not
// restated here: each entry below republishes its adapter's own
// `failureBehavior` block from `multi-provider-intake.js` — the contract that
// the delimited importer actually implements. Reading a template's
// `failureBehavior.reordered` is reading the importer's answer, not a second
// opinion about it.

import { PROVIDER_ADAPTERS } from "./multi-provider-intake.js";
import { SHAPES } from "./finops-tabular-import.js";
import { IMPORT_RECIPES, SAMPLE_ROW_COUNT } from "./import-recipes.js";

/** This module's own identity, independent of the contracts it reads. */
export const IMPORT_FILE_TEMPLATE_VERSION = "import-file-template/1.0.0";

/** The two artifacts. There is no third, and neither one is optional. */
export const TEMPLATE_KINDS = Object.freeze({ blank: "blank", sample: "sample" });

/** RFC 4180 for both artifacts: the format every one of these consoles emits. */
export const TEMPLATE_MEDIA_TYPE = "text/csv";
const LINE_ENDING = "\r\n";

/**
 * The worked rows, keyed by the shape's canonical field rather than by column
 * position, and per adapter rather than shared — a control that painted one
 * adapter's figure over another adapter's rows is exactly the wiring mistake
 * the executable-fixture test has to be able to see.
 *
 * The amounts carry cents and the totals do not, because the figure documented
 * beside the control is printed by the page's whole-dollar money formatter.
 */
const SAMPLE_ROWS = Object.freeze({
  "openai-usage": Object.freeze([
    Object.freeze({ date: "2026-03-01", orgUnit: "example-dept-platform", model: "example-model-large", amount: "1240.00" }),
    Object.freeze({ date: "2026-03-01", orgUnit: "example-dept-support", model: "example-model-small", amount: "310.50" }),
    Object.freeze({ date: "2026-03-02", orgUnit: "example-dept-platform", model: "example-model-large", amount: "980.25" }),
    Object.freeze({ date: "2026-03-02", orgUnit: "example-dept-data", model: "example-model-embed", amount: "64.25" }),
  ]),
  "anthropic-usage": Object.freeze([
    Object.freeze({ date: "2026-03-01", orgUnit: "example-workspace-platform", model: "example-model-large", amount: "880.40" }),
    Object.freeze({ date: "2026-03-01", orgUnit: "example-workspace-support", model: "example-model-small", amount: "215.60" }),
    Object.freeze({ date: "2026-03-02", orgUnit: "example-workspace-platform", model: "example-model-large", amount: "742.00" }),
    Object.freeze({ date: "2026-03-02", orgUnit: "example-workspace-data", model: "example-model-embed", amount: "38.00" }),
  ]),
  "bedrock-cost-and-usage": Object.freeze([
    Object.freeze({ date: "2026-03-01", orgUnit: "example-dept-platform", model: "example-model-large", amount: "1502.30" }),
    Object.freeze({ date: "2026-03-01", orgUnit: "example-dept-support", model: "example-model-small", amount: "96.20" }),
    Object.freeze({ date: "2026-03-02", orgUnit: "example-dept-platform", model: "example-model-large", amount: "611.45" }),
    Object.freeze({ date: "2026-03-02", orgUnit: "example-dept-data", model: "example-model-embed", amount: "25.05" }),
  ]),
});

/**
 * The shape's required columns, as `{ field, header }` in the shape's declared
 * order — the order the importer's own alias table declares, so a template's
 * column order is the contract's column order by construction.
 */
function requiredFieldsOf(adapter) {
  const shape = SHAPES.find((entry) => entry.id === adapter.shapes[0]);
  if (!shape) throw new Error(`import-file-template: no shape for adapter ${adapter.id}`);
  return Object.freeze(Object.entries(shape.columns)
    .filter(([, spec]) => spec.required)
    .map(([field, spec]) => Object.freeze({ field, header: spec.aliases[0] })));
}

/** One cell, quoted only where RFC 4180 requires it. */
function csvCell(value) {
  const text = String(value ?? "");
  return /["\r\n,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A CSV document with a trailing terminator, as every console emits one. */
function csvFrom(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join(LINE_ENDING) + LINE_ENDING;
}

function artifact(kind, adapterId, text) {
  return Object.freeze({
    kind,
    // Stable and provider-named: two downloads from two rows never collide in a
    // downloads folder, and a lead can say which file they are holding.
    fileName: `${adapterId}-${kind === TEMPLATE_KINDS.blank ? "blank-template" : "worked-sample"}.csv`,
    mediaType: TEMPLATE_MEDIA_TYPE,
    text,
  });
}

function templateFor(adapter) {
  const fields = requiredFieldsOf(adapter);
  const rows = SAMPLE_ROWS[adapter.id];
  if (!rows) throw new Error(`import-file-template: no worked sample for pinned adapter ${adapter.id}`);
  const headers = fields.map((entry) => entry.header);
  const cells = rows.map((row) => fields.map(({ field }) => {
    if (!(field in row)) {
      throw new Error(`import-file-template: the ${adapter.id} sample has no value for the `
        + `contract's ${field} column`);
    }
    return row[field];
  }));
  const recipe = IMPORT_RECIPES.find((entry) => entry.adapter === adapter.id);
  return Object.freeze({
    adapter: adapter.id,
    label: adapter.label,
    templateVersion: IMPORT_FILE_TEMPLATE_VERSION,
    adapterVersion: adapter.adapterVersion,
    columns: Object.freeze(headers),
    sampleRowCount: rows.length,
    // The documented figure, read from the recipe contract rather than restated.
    sampleTotalMinor: recipe?.sampleTotalMinor ?? null,
    // The importer's stated answer for a partial, stale, malformed or
    // column-reordered file, republished rather than paraphrased.
    failureBehavior: adapter.failureBehavior,
    blank: artifact(TEMPLATE_KINDS.blank, adapter.id, csvFrom([headers])),
    sample: artifact(TEMPLATE_KINDS.sample, adapter.id, csvFrom([headers, ...cells])),
  });
}

/**
 * One template pair per pinned adapter, in the intake contract's declared
 * order. Derived from the adapter list rather than hand-listed, so a fourth
 * adapter with no synthetic rows throws on import — the build fails — rather
 * than shipping a download control for a file nobody wrote a sample for.
 */
export const IMPORT_FILE_TEMPLATES = Object.freeze(PROVIDER_ADAPTERS.map(templateFor));

/** The template pair for a pinned adapter id, or null. */
export function templateForAdapter(adapterId) {
  return IMPORT_FILE_TEMPLATES.find((entry) => entry.adapter === adapterId) ?? null;
}

/**
 * The one artifact a download control asks for: `{ kind, fileName, mediaType,
 * text }`, or null when the id or the kind names nothing this build publishes.
 * Null rather than a throw, because an unknown control is a caller's bug and a
 * reader should get no file rather than an unhandled rejection in their tab.
 */
export function importFileTemplateArtifact(adapterId, kind) {
  const entry = templateForAdapter(adapterId);
  if (!entry || !Object.hasOwn(TEMPLATE_KINDS, kind)) return null;
  return entry[kind];
}

/** Rows per worked sample, republished so a caller needs one import. */
export { SAMPLE_ROW_COUNT };
