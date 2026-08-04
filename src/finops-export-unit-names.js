// Naming a reader's own org units from labels the dropped export already carries.
//
// ===========================================================================
// THE DERIVATION CONTRACT
// ===========================================================================
//
// A finance lead drops one provider usage export and the analysis names their
// teams `Department …atlas0` — correct, because `unit-pseudonym.js` keys every
// unit on an opaque digest, and unreadable, because the lead knows that unit as
// Platform Engineering. The readable words are usually sitting in the same file,
// in a column the analysis never looked at. This module reads them, and states
// exactly which column it read.
//
// 1. RECOGNIZED LABEL FIELDS, IN PRECEDENCE ORDER. Closed list, no heuristics:
//
//      1. project      — `project`, `project name`, `project id`, `workspace`,
//                        `workspace name`
//      2. tag          — a `tags`/`labels` map column, or a `tag:<key>` /
//                        `label:<key>` / `resourceTags/user:<key>` column
//      3. description  — `description`, `line item description`, `item
//                        description`, `usage description`
//      4. cost center  — `cost center`, `cost centre`, `cost center name`,
//                        `business unit`, `department name`
//
//    Header matching is `normalizeHeader`'s rule and only that rule: case
//    folded, and every run of non-alphanumerics collapsed to one space, so
//    `Project Name`, `project_name` and `project-name` are one column and
//    nothing else is. A column not on the list above is NOT a label source —
//    there is no fuzzy match, no scoring, and no "looks like a name" guess. An
//    export that names its teams in a column this list does not carry keeps its
//    identifiers, and says so.
//
//    The column the org unit was BOUND to is a label source of last resort. It
//    is frequently one of the fields above — `project` on an OpenAI export —
//    and the pseudonym is hiding words that column already carried, so reading
//    it back is the point. But where a second recognized column exists, that
//    one wins whatever the precedence order says: a column that produced the
//    identity cannot be the more informative name for it.
//
// 2. VERSIONING. `LABEL_DERIVATION_CONTRACT_VERSION` is 1. Adding a field,
//    removing one, or reordering the precedence above is a VERSION BUMP: it
//    changes what a reader sees for a file that has not changed, which is the
//    one kind of change a reader cannot detect for themselves.
//
// 3. IMPERFECT DATA, per unit, stated and implemented:
//
//    * NO USABLE LABEL → the unit keeps the opaque identifier the analysis
//      already published, flagged `derived: false`. Never a blank, never a
//      placeholder string, never a neighbouring unit's name.
//    * EMPTY, WHITESPACE-ONLY, OR MALFORMED → absent, and absent falls through
//      to the next field in precedence. Malformed is a closed definition too:
//      longer than `MAX_DERIVED_UNIT_NAME`, or carrying a control character —
//      a name the display layer would refuse anyway is not a name here.
//    * CONFLICTING LABELS FOR ONE UNIT → resolved deterministically, never by
//      luck of row order. The higher-precedence FIELD wins outright. Inside one
//      field, the value carried by the most rows wins; ties break by first
//      appearance, scanning that field's columns in file order and each column's
//      rows in file order. A unit whose winning field held more than one
//      distinct value is flagged `conflicted: true`, so the provenance line can
//      say the rows disagreed rather than quietly picking.
//    * PARTIAL COVERAGE → per unit, always. A file where three units carry a
//      project and one does not names the three and leaves the fourth opaque.
//      Nothing about this derivation fails wholesale.
//
// 4. PRECEDENCE AGAINST READER-TYPED NAMES. This module does not resolve display
//    names and must not: `orgUnitDisplayName()` in org-unit-display-label.js is
//    the one resolver. What this produces is a `{ [unitId]: name }` map that the
//    page merges UNDER the reader's own labels — reader-typed beats derived,
//    derived beats the pseudonym, and the pseudonym beats nothing. A reader who
//    clears their own name for a unit falls back to the derived name, not to the
//    identifier.
//
// WHAT IT NEVER DOES. No request, no storage, no clock, no node, and no cell
// value retained anywhere but the returned name — which is a label the reader
// already has, about their own organization, held in this tab for this tab.

import { normalizeHeader } from "./finops-tabular-import.js";
import { orgUnitPseudonym } from "./unit-pseudonym.js";

/** Bump when the recognized-field set or the precedence order changes. */
export const LABEL_DERIVATION_CONTRACT_VERSION = 1;

/** The ceiling `org-unit-display-label.js` renders under. Longer is malformed. */
export const MAX_DERIVED_UNIT_NAME = 60;

/**
 * The closed, ordered set. `aliases` match a whole normalized header; `prefixes`
 * match `tag:<key>` style columns, where the key is the tag's own name and only
 * the prefix is declared. `map` marks a column whose cell is a `key=value` list
 * rather than one label.
 */
export const LABEL_SOURCE_FIELDS = Object.freeze([
  Object.freeze({
    id: "project",
    label: "project",
    aliases: Object.freeze(["project", "project name", "project id", "workspace",
      "workspace name"]),
  }),
  Object.freeze({
    id: "tag",
    label: "tag",
    aliases: Object.freeze(["tags", "labels", "resource tags", "user tags"]),
    map: true,
    prefixes: Object.freeze(["tag", "label", "resource tags user", "resourcetags user",
      "user tag"]),
  }),
  Object.freeze({
    id: "description",
    label: "description",
    aliases: Object.freeze(["description", "line item description", "item description",
      "usage description"]),
  }),
  Object.freeze({
    id: "cost_center",
    label: "cost center",
    aliases: Object.freeze(["cost center", "cost centre", "cost center name",
      "business unit", "department name"]),
  }),
]);

/** The precedence, in the words the page prints. */
export const LABEL_DERIVATION_PRECEDENCE = Object.freeze(
  LABEL_SOURCE_FIELDS.map((field) => field.label));

/** The sentence that states the contract to a reader. Painted outside any fold. */
export const LABEL_DERIVATION_PRECEDENCE_STATEMENT =
  `Recognized name columns, in precedence order: ${LABEL_DERIVATION_PRECEDENCE.join(", ")}. `
  + `Unlisted columns are never read as names. Derivation contract v${LABEL_DERIVATION_CONTRACT_VERSION}.`;

/** No delimited reading to derive from — a JSON envelope, or a failed read. */
export const NO_DERIVED_UNIT_NAMES = Object.freeze({
  contractVersion: LABEL_DERIVATION_CONTRACT_VERSION,
  available: false,
  names: Object.freeze({}),
  byUnit: Object.freeze({}),
  units: Object.freeze([]),
  sources: Object.freeze([]),
  unitCount: 0,
  derivedCount: 0,
  conflictedCount: 0,
  statement: "",
  precedenceStatement: LABEL_DERIVATION_PRECEDENCE_STATEMENT,
});

const text = (value) => (typeof value === "string" ? value : "");

/** Trim, and refuse what the display layer would refuse. See rule 3. */
function cleanName(value) {
  const label = text(value).trim();
  if (!label || label.length > MAX_DERIVED_UNIT_NAME) return "";
  // A control character in a billing cell is a broken export, not a team name.
  if (/[\u0000-\u001f\u007f]/.test(label)) return "";
  return label;
}

/**
 * One cell of a `tags`/`labels` map column, as a label.
 *
 * `team=Platform Engineering;env=prod` is the value of its first pair, because
 * a map column has no declared key and picking the first one the file wrote is
 * the only rule that does not depend on this module guessing which key a
 * customer means. A cell with no `=` in it is already a label.
 */
function readMapCell(value) {
  const raw = text(value).trim();
  if (!raw.includes("=")) return raw;
  const pair = raw.split(/[;,]/).find((entry) => entry.includes("="));
  return pair === undefined ? "" : pair.slice(pair.indexOf("=") + 1).trim();
}

/**
 * Every recognized label column in this header, grouped by field in precedence
 * order and, inside a field, in the file's own column order.
 */
function labelColumns(columns, unitColumn) {
  const normalized = columns.map((name) => normalizeHeader(name));
  const matches = (field, index) => {
    const header = normalized[index];
    if (field.aliases.includes(header)) return true;
    return (field.prefixes ?? []).some((prefix) => header.startsWith(`${prefix} `));
  };
  const groups = LABEL_SOURCE_FIELDS.map((field) => ({
    field,
    columns: columns.map((name, index) => ({ name, index }))
      .filter(({ name, index }) => name !== unitColumn && matches(field, index)),
  })).filter((group) => group.columns.length > 0);
  // THE ORG-UNIT COLUMN IS THE LAST RESORT, and it is a resort. It is often one
  // of the recognized fields itself — an OpenAI export groups on `project`, and
  // the pseudonym is hiding the readable words that column already carried, so
  // reading it back is the whole point. But a column that produced the identity
  // cannot be more informative about that identity than a different column is:
  // where the file carries both, the other column wins whatever the precedence
  // order says. Hence appended, after every group above.
  const own = columns.indexOf(unitColumn);
  const ownField = own >= 0
    ? LABEL_SOURCE_FIELDS.find((field) => matches(field, own)) : undefined;
  if (ownField) groups.push({ field: ownField, columns: [{ name: unitColumn, index: own }] });
  return groups;
}

/**
 * WHICH COLUMNS IN THIS HEADER COULD NAME A UNIT, in precedence order (#1065).
 *
 * The same `labelColumns` above, flattened to the column names it matched, so a
 * surface that has only the HEADER of an export — the preflight check, which
 * reads no cells and imports nothing — can answer "would this file name my
 * departments?" through this module's rule rather than a second copy of it.
 *
 * It reads no cell and derives no name: an empty result means no recognized
 * name column is present, which is why the derivation would fall back to the
 * pseudonym. A non-empty result means the INPUT is there; whether any cell in
 * it carries a usable value is `deriveOrgUnitNames`' answer and not this one's.
 */
export function labelSourceColumns(columns, unitColumn = null) {
  const header = Array.isArray(columns) ? columns.map(text) : [];
  if (header.length === 0) return Object.freeze([]);
  return Object.freeze(labelColumns(header, text(unitColumn).trim())
    .flatMap((group) => group.columns.map((column) => column.name)));
}

/**
 * The one unit's name, or null. Rule 3's resolution, in one place: fields in
 * precedence order, and inside the winning field the value on the most rows,
 * ties to first appearance in file order.
 */
function resolveUnit(rows, groups) {
  for (const group of groups) {
    const tally = new Map();
    let order = 0;
    for (const column of group.columns) {
      for (const row of rows) {
        order += 1;
        const cell = row?.[column.name];
        const value = cleanName(group.field.map ? readMapCell(cell) : cell);
        if (!value) continue;
        const seen = tally.get(value);
        if (seen) seen.count += 1;
        else tally.set(value, { count: 1, order, column: column.name });
      }
    }
    if (tally.size === 0) continue;
    const [name, winner] = [...tally.entries()]
      .sort((left, right) => right[1].count - left[1].count || left[1].order - right[1].order)[0];
    return {
      name,
      field: group.field.id,
      fieldLabel: group.field.label,
      column: winner.column,
      conflicted: tally.size > 1,
    };
  }
  return null;
}

const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * The reader-facing provenance sentence, composed from the resolved units and
 * nothing else. It names COLUMNS, because "names were derived" is not something
 * a reader can check and `“project” column` is.
 */
function composeStatement(units) {
  const derived = units.filter((unit) => unit.derived);
  if (derived.length === 0) {
    return "No recognized name column in this export carried a usable label, so every unit "
      + "keeps the identifier the export used.";
  }
  const bySource = new Map();
  for (const unit of derived) {
    bySource.set(unit.sourceColumn, (bySource.get(unit.sourceColumn) ?? 0) + 1);
  }
  const sources = [...bySource.entries()]
    .map(([column, count]) => `“${column}” column (${plural(count, "unit")})`)
    .join(", ");
  const opaque = units.length - derived.length;
  const conflicted = derived.filter((unit) => unit.conflicted).length;
  return `Unit names come from this export's ${sources}.`
    + (opaque > 0
      ? ` ${plural(opaque, "unit")} carried no usable label and keeps the identifier the export used.`
      : "")
    + (conflicted > 0
      ? ` ${plural(conflicted, "unit")} had rows that disagreed; the value on the most rows won.`
      : "");
}

function compose(units) {
  const names = {};
  const byUnit = {};
  for (const unit of units) {
    if (!unit.derived) continue;
    names[unit.unitId] = unit.name;
    byUnit[unit.unitId] = unit;
  }
  const sources = [...new Set(units.filter((unit) => unit.derived)
    .map((unit) => unit.sourceColumn))];
  return Object.freeze({
    contractVersion: LABEL_DERIVATION_CONTRACT_VERSION,
    available: units.length > 0,
    names: Object.freeze(names),
    byUnit: Object.freeze(byUnit),
    units: Object.freeze(units),
    sources: Object.freeze(sources),
    unitCount: units.length,
    derivedCount: Object.keys(names).length,
    conflictedCount: units.filter((unit) => unit.derived && unit.conflicted).length,
    statement: composeStatement(units),
    precedenceStatement: LABEL_DERIVATION_PRECEDENCE_STATEMENT,
  });
}

/**
 * Name every org unit in one delimited reading, per the contract above.
 *
 * @param {{columns?: string[], rows?: object[], unitColumn?: string|null}} input
 *   `rows` are header-keyed row objects — the shape the page already projects
 *   for the cohort contract — and `unitColumn` is the header the analysis bound
 *   its org unit to, so the derived name lands on the same pseudonymous identity
 *   the rest of the page keys on.
 * @returns a frozen naming result. A reading with no unit column, no rows, or no
 *   recognized label column returns `available: false` rather than throwing.
 */
export function deriveOrgUnitNames({ columns = [], rows = [], unitColumn = null } = {}) {
  const header = Array.isArray(columns) ? columns.map(text) : [];
  const records = Array.isArray(rows) ? rows : [];
  const unitHeader = text(unitColumn).trim();
  if (!unitHeader || header.length === 0 || records.length === 0) return NO_DERIVED_UNIT_NAMES;
  const groups = labelColumns(header, unitHeader);

  // One bucket per unit, in first-appearance order, keyed on the SAME pseudonym
  // the import mints — a derived name that landed on a key nothing else uses
  // would name nobody.
  const buckets = new Map();
  for (const row of records) {
    const raw = text(row?.[unitHeader]).trim();
    // A blank grouping cell is the reserved unattributed bucket, not a unit with
    // a missing name. Naming it would invent a department the export never had.
    if (!raw) continue;
    const unitId = orgUnitPseudonym(raw);
    if (!buckets.has(unitId)) buckets.set(unitId, []);
    buckets.get(unitId).push(row);
  }
  if (buckets.size === 0) return NO_DERIVED_UNIT_NAMES;

  const units = [...buckets.entries()].map(([unitId, unitRows]) => {
    const resolved = groups.length > 0 ? resolveUnit(unitRows, groups) : null;
    return Object.freeze({
      unitId,
      name: resolved?.name ?? null,
      derived: resolved !== null,
      conflicted: resolved?.conflicted ?? false,
      sourceField: resolved?.field ?? null,
      sourceFieldLabel: resolved?.fieldLabel ?? null,
      sourceColumn: resolved?.column ?? null,
    });
  });
  return compose(units);
}

/**
 * Fold several readings' namings into one, first import wins per unit.
 *
 * A portfolio import drops more than one file, and the same unit can appear in
 * two of them. First-wins keeps the result independent of how the queue happened
 * to finish: the earlier file in the reader's own selection is the answer, and
 * the statement is recomposed from the units that actually survived rather than
 * being one file's sentence reused for all of them.
 */
export function mergeOrgUnitNamings(namings) {
  const seen = new Map();
  for (const naming of namings ?? []) {
    for (const unit of naming?.units ?? []) {
      const held = seen.get(unit.unitId);
      // A derived name beats an opaque one from another file; between two
      // derived names the earlier file wins.
      if (!held || (!held.derived && unit.derived)) seen.set(unit.unitId, unit);
    }
  }
  if (seen.size === 0) return NO_DERIVED_UNIT_NAMES;
  return compose([...seen.values()]);
}
