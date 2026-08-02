// The import-side cohort attribution contract.
//
// A FinOps lead wants the one thing the peer panel cannot give an ordinary
// import: a ranked position against organizations like theirs. Selecting a
// cohort needs two attributes — an organization size band and an industry — and
// no provider or HRIS export in the v1 contracts carries either. So the reader
// declares them in their own file, and this module decides whether what they
// declared is enough to select a cohort, or says exactly why it is not.
//
// WHAT MAY BE READ
// ----------------
// Two projections, both fixed allowlists, both applied before anything is
// counted:
//
//   a roster row  → department_key, unit_type, active     (ROSTER_COLUMNS_READ)
//   a usage row   → department_key, org_size_band, industry (USAGE_COLUMNS_READ)
//
// A real HRIS roster carries full names, work emails, job titles and manager
// identifiers in the same file. None of them reach this module's output, and
// none of them can: the projection copies the allowlisted fields out rather
// than deleting the rest, so a column nobody anticipated is dropped by default
// instead of surviving until someone remembers to strip it.
//
// WHAT IS NOT DECIDED HERE
// ------------------------
// The eligibility rule for a cohort is `selectPeerCohort`'s, unchanged. This
// module supplies the segment inputs it already takes and reports its answer;
// it does not fork the band boundaries, re-rank members, or publish a second
// idea of what "comparable" means. A position withheld here is withheld with a
// code and a sentence, never with an inferred attribute.
//
// TWO PROVENANCE SOURCES, ONE DECISION (#978)
// -------------------------------------------
// A cohort attribute may now arrive two ways, and every record says which:
//
//   file             a column in the imported export carried it
//   reader_declared  the reader named it in the page, because their export
//                    carries no such column and no export in the v1 dialect
//                    contracts ever will
//
// The two are never interchangeable to a consumer. `COHORT_ATTRIBUTE_SOURCE`
// travels on the resolved declaration per attribute AND on the position as one
// discriminator, so a surface labels a placement without inferring anything
// from which fields happen to be empty. FILE WINS: if the export carries the
// column at all — even carrying a value this contract does not publish — the
// file's answer is the answer, and a reader-declared value for that attribute
// is not consulted. That keeps every export that ranks today ranking today's
// way, and keeps the UNRECOGNIZED_* instruction ("fix the value in your file")
// from being silently satisfied behind the reader's back.
//
// PARTIAL, STALE, MALFORMED, REORDERED
// ------------------------------------
//   partial    a declaration may appear on the first data row, on every row, or
//              on a roster beside the usage export. All three resolve the same.
//              A reader who declares one of the two attributes and not the
//              other has declared nothing usable: the absent attribute reports
//              its own MISSING_* and no position is published.
//   malformed  a declared value the contract does not publish is reported as
//              UNRECOGNIZED_*, quoting the value back, never silently dropped
//              to MISSING_* — "you wrote something we do not accept" and "you
//              wrote nothing" are different instructions to the reader. A
//              reader-declared value outside the published enumeration is
//              refused here, in the model, with the accepted options named —
//              never only in the control, which anything can bypass.
//   reordered  attributes are resolved by first non-empty value across the
//              projected rows, and across sources in selection order, so a file
//              whose first row happens to be blank still resolves.
//   stale      `asOf` is supplied by the caller — the analysed period's own end
//              — and recorded. Nothing here reads a clock.

import {
  PEER_COHORT_PROVENANCE, PEER_INDUSTRY, selectPeerCohort,
} from "./peer-cohort-contract.js";

/** Bump when a projection, an accepted value, or a published reason changes. */
export const COHORT_ATTRIBUTION_VERSION = "import-cohort-attribution/1.1.0";

/**
 * Where one cohort attribute came from.
 *
 * A named field on the record, never an inferred flag: a consumer must not have
 * to guess "the file must have carried this, since something did".
 */
export const COHORT_ATTRIBUTE_SOURCE = Object.freeze({
  file: "file",
  readerDeclared: "reader_declared",
});

/** How a placement may be described. One string per source, authored once. */
export const COHORT_PROVENANCE_LABEL = Object.freeze({
  [COHORT_ATTRIBUTE_SOURCE.file]: "file-derived cohort",
  [COHORT_ATTRIBUTE_SOURCE.readerDeclared]: "reader-declared cohort",
});

/** The same fact as a sentence, for the surfaces that have room for one. */
export const COHORT_PROVENANCE_STATEMENT = Object.freeze({
  [COHORT_ATTRIBUTE_SOURCE.file]:
    "The cohort attributes behind this position were read from the imported export.",
  [COHORT_ATTRIBUTE_SOURCE.readerDeclared]:
    "The cohort attributes behind this position were declared by you on this page. They were not "
    + "read from the imported export, and the position is reader-declared rather than file-derived.",
});

const EMPTY = Object.freeze([]);

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * One column header, reduced to the form the accepted-field lists are written
 * in: lowercase, non-alphanumerics collapsed to a single underscore, edges
 * trimmed. "Org Size Band", "org-size-band" and " ORG_SIZE_BAND " are one key.
 */
export function normalizeKey(key) {
  return String(key ?? "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Values that read as a declared attribute value, reduced the same way. */
const normalizeValue = (value) => normalizeKey(value);

const text = (value) => {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value.trim() : String(value).trim();
};

/**
 * The first non-empty value any accepted field carries, across one object or an
 * ordered list of them.
 *
 * Accepted fields are tried in declaration order inside each candidate, so the
 * canonical name beats an alias in a file that carries both, and candidates are
 * tried in the order given, so "first source wins" and "first non-empty row
 * wins" are the same rule stated once.
 */
export function pick(source, fields = []) {
  const accepted = fields.map(normalizeKey);
  const candidates = Array.isArray(source) ? source : [source];
  for (const candidate of candidates) {
    if (!isObject(candidate)) continue;
    const byKey = new Map();
    for (const [key, value] of Object.entries(candidate)) {
      const normalized = normalizeKey(key);
      if (!byKey.has(normalized)) byKey.set(normalized, value);
    }
    for (const field of accepted) {
      const found = text(byKey.get(field));
      if (found) return found;
    }
  }
  return "";
}

/** The column names each declared attribute may arrive under. */
export const COHORT_DECLARATION_FIELDS = Object.freeze({
  org_size_band: Object.freeze(["org_size_band", "organization_size_band", "size_band"]),
  industry: Object.freeze(["industry", "industry_key", "sector"]),
});

/** The org unit a usage row or roster entry belongs to, under any of its names. */
const DEPARTMENT_KEY_FIELDS = Object.freeze([
  "department_key", "department", "org_unit_id", "org_unit", "cost_center", "project", "team",
]);

/**
 * The roster classification signal, and only it.
 *
 * A roster declares `unit_type`. A usage export that happens to carry a bare
 * `type` column — a billing line type, a resource type — is a usage export, so
 * `type` is read as a unit type *inside* a roster and is never the signal that
 * decides which of the two a file is. Sniffing on `type` classified ordinary
 * provider exports as rosters, which left the analysis with no usage rows at
 * all and reported it as NO_VALID_ROWS.
 */
const ROSTER_SIGNAL_FIELD = "unit_type";
const UNIT_TYPE_FIELDS = Object.freeze(["unit_type", "type"]);
const ACTIVE_FIELDS = Object.freeze(["active", "employment_status", "status", "unit_status"]);

/** Every roster column this module reads. Nothing else is copied out of one. */
export const ROSTER_COLUMNS_READ = Object.freeze(["department_key", "unit_type", "active"]);

/** Every usage column this module reads. Amounts are not among them. */
export const USAGE_COLUMNS_READ = Object.freeze(["department_key", "org_size_band", "industry"]);

// ---------------------------------------------------------------------------
// The accepted declared values.
// ---------------------------------------------------------------------------

const band = (key, label, min, max, aliases) => Object.freeze({
  key, label, min, max, aliases: Object.freeze(aliases.map(normalizeValue)),
});

/**
 * The published organization size bands.
 *
 * The boundaries are the peer cohort selector's own bands, restated as declared
 * values so a reader can name the band their organization is in. They are not a
 * second opinion about cohort membership: the count of attributed org units is
 * still what selects a cohort, and a declared band that disagrees with the
 * count is reported rather than trusted.
 */
export const ORG_SIZE_BANDS = Object.freeze([
  band("focused", "1–4 attributed org units", 1, 4, ["focused", "1-4", "small", "under-5"]),
  band("scaling", "5–14 attributed org units", 5, 14, ["scaling", "5-14", "medium", "mid-market"]),
  band("enterprise", "15 or more attributed org units", 15, 500,
    ["enterprise", "15+", "15-plus", "large"]),
]);

const INDUSTRIES = Object.freeze([
  Object.freeze({
    key: PEER_INDUSTRY.saas,
    label: "Software as a service",
    aliases: Object.freeze(["saas", "software-as-a-service", "software"].map(normalizeValue)),
  }),
  Object.freeze({
    key: PEER_INDUSTRY.financialServices,
    label: "Financial services",
    aliases: Object.freeze(
      ["financial-services", "financial_services", "finance", "banking"].map(normalizeValue)),
  }),
]);

/** The values a reader may write, listed back to them in every next step. */
export const ACCEPTED_ORG_SIZE_BANDS = Object.freeze(ORG_SIZE_BANDS.map((entry) => entry.key));
export const ACCEPTED_INDUSTRIES = Object.freeze(INDUSTRIES.map((entry) => entry.key));

/**
 * The closed enumeration a reader may declare in the page, with its labels.
 *
 * THE SINGLE SOURCE OF TRUTH for the in-page control, the refusal messages, and
 * the accepted-values table in the contract doc. The control renders its options
 * from this and nothing else, so the list a reader is offered, the list the
 * model accepts, and the list the doc publishes cannot drift into three lists —
 * which is the failure a second copy written as string literals in the page
 * would produce on the first band anyone adds.
 */
export const COHORT_DECLARATION_CHOICES = Object.freeze({
  orgSizeBand: Object.freeze(ORG_SIZE_BANDS.map((entry) =>
    Object.freeze({ key: entry.key, label: entry.label }))),
  industry: Object.freeze(INDUSTRIES.map((entry) =>
    Object.freeze({ key: entry.key, label: entry.label }))),
});

/** The two attributes a reader may declare, in the order the control shows. */
export const COHORT_DECLARED_ATTRIBUTES = Object.freeze(["orgSizeBand", "industry"]);

/** What each declared attribute is called in a sentence to the reader. */
const DECLARED_ATTRIBUTE_NOUN = Object.freeze({
  orgSizeBand: "organization size band",
  industry: "industry",
});

const ACCEPTED_DECLARED = Object.freeze({
  orgSizeBand: ACCEPTED_ORG_SIZE_BANDS,
  industry: ACCEPTED_INDUSTRIES,
});

const listed = (values) => values.join(", ");

const resolveBand = (raw) => {
  const normalized = normalizeValue(raw);
  if (!normalized) return null;
  return ORG_SIZE_BANDS.find((entry) =>
    entry.key === normalized || entry.aliases.includes(normalized)) ?? null;
};

const resolveIndustry = (raw) => {
  const normalized = normalizeValue(raw);
  if (!normalized) return null;
  return INDUSTRIES.find((entry) =>
    entry.key === normalized || entry.aliases.includes(normalized)) ?? null;
};

/**
 * One declaration, resolved.
 *
 * @param source a row object, a raw declaration object keyed by accepted field
 *   names, or an ordered list of either. Everything on this path is raw: the
 *   resolved shape below is an output and is never fed back in, because
 *   `orgSizeBandRaw` normalizes to a field name nothing accepts and the
 *   resolved `orgSizeBand` has already dropped the value a reader has to be
 *   shown when it was not recognized.
 * @returns the raw declared strings beside the resolved keys. A raw string with
 *   a null key beside it is the unrecognized-value state, and it carries the
 *   value verbatim so it can be quoted back.
 */
export function readCohortDeclaration(source = null) {
  const orgSizeBandRaw = pick(source, COHORT_DECLARATION_FIELDS.org_size_band);
  const industryRaw = pick(source, COHORT_DECLARATION_FIELDS.industry);
  return Object.freeze({
    orgSizeBandRaw,
    orgSizeBand: resolveBand(orgSizeBandRaw)?.key ?? null,
    industryRaw,
    industry: resolveIndustry(industryRaw)?.key ?? null,
  });
}

/**
 * One reader-declared cohort, checked against the closed enumeration.
 *
 * IN THE MODEL, NOT ONLY IN THE CONTROL. The control offers exactly
 * `COHORT_DECLARATION_CHOICES` and nothing else, but a control is markup: a
 * bypassed one, a replayed handler, or a future caller with its own affordance
 * all arrive here, and they are refused here. Aliases are deliberately NOT
 * accepted on this path — a file may write `mid-market` because a reader typed
 * it into a spreadsheet months ago, but nobody types into this control, so the
 * declared value is either one of the published keys or it is refused.
 *
 * An empty attribute is not a refusal. It is an attribute the reader did not
 * declare, and `validateCohortAttribution` reports the resulting gap with the
 * MISSING_* code it already publishes for it.
 *
 * @returns `{ ok, declaration, refusals }`. `declaration` carries only the
 *   attributes that were declared AND accepted; `refusals` carries one entry
 *   per unaccepted attribute, each naming the accepted options for that field.
 */
export function validateReaderCohortDeclaration(input = null) {
  const declaration = {};
  const refusals = [];
  for (const attribute of COHORT_DECLARED_ATTRIBUTES) {
    const raw = text(isObject(input) ? input[attribute] : "");
    if (!raw) continue;
    const accepted = ACCEPTED_DECLARED[attribute];
    const normalized = normalizeValue(raw);
    if (accepted.includes(normalized)) {
      declaration[attribute] = normalized;
      continue;
    }
    refusals.push(Object.freeze({
      attribute,
      value: raw,
      message: `"${raw}" is not an accepted ${DECLARED_ATTRIBUTE_NOUN[attribute]}. The accepted `
        + `values are: ${listed(accepted)}.`,
    }));
  }
  return Object.freeze({
    ok: refusals.length === 0,
    declaration: Object.freeze(declaration),
    refusals: Object.freeze(refusals),
  });
}

// ---------------------------------------------------------------------------
// Projection.
// ---------------------------------------------------------------------------

const ACTIVE_FALSE = new Set(["false", "no", "n", "0", "inactive", "terminated", "closed", "archived"]);

/**
 * A department roster, projected to the three columns this module reads.
 *
 * The allowlist is applied by copying out, so a roster carrying names, emails,
 * job titles or manager ids yields entries that carry none of them. An entry
 * with no department key is dropped: it cannot join a usage row, and keeping it
 * would only be keeping a row of somebody's personal data.
 */
export function readDepartmentRoster(objects = []) {
  const list = Array.isArray(objects) ? objects.filter(isObject) : [];
  const entries = [];
  for (const object of list) {
    const departmentKey = pick(object, DEPARTMENT_KEY_FIELDS);
    if (!departmentKey) continue;
    const activeRaw = pick(object, ACTIVE_FIELDS);
    entries.push(Object.freeze({
      departmentKey,
      unitType: pick(object, UNIT_TYPE_FIELDS) || null,
      // Absent means active: a roster that does not publish a status is not
      // making a claim that every unit is closed.
      active: activeRaw ? !ACTIVE_FALSE.has(normalizeValue(activeRaw)) : true,
    }));
  }
  return Object.freeze(entries);
}

const hasRosterSignal = (object) =>
  Object.keys(object).some((key) => normalizeKey(key) === ROSTER_SIGNAL_FIELD);

const projectUsageRow = (object) => Object.freeze({
  department_key: pick(object, DEPARTMENT_KEY_FIELDS),
  org_size_band: pick(object, COHORT_DECLARATION_FIELDS.org_size_band),
  industry: pick(object, COHORT_DECLARATION_FIELDS.industry),
});

/**
 * The raw declaration a set of projected objects carries.
 *
 * RAW on purpose, keyed by the accepted field names: it is resolved by
 * `readCohortDeclaration` exactly as a row is, so the projection layer and the
 * validation layer cannot drift into two different readings of one file. The
 * scan runs across every object rather than the first, because the contract
 * allows a declaration to repeat on every usage row — a file whose first data
 * row leaves the columns empty still declares them.
 */
const rawDeclaration = (objects) => Object.freeze({
  org_size_band: pick(objects, COHORT_DECLARATION_FIELDS.org_size_band),
  industry: pick(objects, COHORT_DECLARATION_FIELDS.industry),
});

/**
 * One selected file, projected into what the cohort decision may read.
 *
 * @param input.objects the file's data rows as header-keyed objects.
 * @returns a frozen source: its kind, its projected rows or roster entries, and
 *   its raw declaration.
 */
export function projectCohortSource({ objects = [] } = {}) {
  const list = Array.isArray(objects) ? objects.filter(isObject) : [];
  const roster = list.some(hasRosterSignal);
  return Object.freeze({
    kind: roster ? "roster" : "usage",
    rows: roster ? EMPTY : Object.freeze(list.map(projectUsageRow)),
    roster: roster ? readDepartmentRoster(list) : EMPTY,
    declaration: rawDeclaration(list),
  });
}

/**
 * Every projected source in one selection, folded into one input.
 *
 * First source wins per attribute — a declaration on the usage export is not
 * overwritten by a later roster — and the merged declaration stays RAW, so the
 * validation layer resolves it once and an unrecognized value is still a value
 * that can be quoted back.
 */
export function mergeCohortSources(sources = []) {
  const list = (Array.isArray(sources) ? sources : []).filter(isObject);
  return Object.freeze({
    rows: Object.freeze(list.flatMap((source) => source.rows ?? EMPTY)),
    roster: Object.freeze(list.flatMap((source) => source.roster ?? EMPTY)),
    declaration: rawDeclaration(list.map((source) => source.declaration).filter(isObject)),
  });
}

// ---------------------------------------------------------------------------
// The decision.
// ---------------------------------------------------------------------------

/** Why a ranked position is withheld. One code per instruction to the reader. */
export const COHORT_ATTRIBUTION_REASON = Object.freeze({
  noValidRows: "NO_VALID_ROWS",
  noActiveOrgUnits: "NO_ACTIVE_ORG_UNITS",
  missingOrgSizeBand: "MISSING_ORG_SIZE_BAND",
  unrecognizedOrgSizeBand: "UNRECOGNIZED_ORG_SIZE_BAND",
  missingIndustry: "MISSING_INDUSTRY",
  unrecognizedIndustry: "UNRECOGNIZED_INDUSTRY",
  orgSizeBandMismatch: "ORG_SIZE_BAND_MISMATCH",
  noPublishedCohort: "NO_PUBLISHED_COHORT",
  /** A reader-declared value outside the published enumeration (#978). */
  unacceptedDeclaredValue: "UNACCEPTED_DECLARED_VALUE",
});

const EXTERNAL_UNIT_TYPES = new Set(["contractor", "vendor", "external", "agency", "partner"]);

/**
 * What left the boundary to produce this answer, and what could not.
 *
 * Attached to the result rather than to a template: a surface that forgets to
 * render a note authored in its own markup ships a comparison with no statement
 * of what it read, and this note is part of the answer.
 */
const anonymizationNote = (asOf) => Object.freeze({
  label: "What this comparison read",
  text: "This position was selected from two declared attribute values — organization size band "
    + "and industry — and one count of attributed org units. Names, email addresses, employee or "
    + "account identifiers, and prompt text are never read into it: a roster is projected to "
    + `${listed(ROSTER_COLUMNS_READ)} and a usage row to ${listed(USAGE_COLUMNS_READ)} before `
    + "anything is counted. Nothing was uploaded, stored, or transmitted — the cohorts are "
    + "bundled with this page and the comparison ran in this tab.",
  fieldsRead: Object.freeze([...new Set([...ROSTER_COLUMNS_READ, ...USAGE_COLUMNS_READ])]),
  provenance: PEER_COHORT_PROVENANCE,
  /** The caller's own evaluation date. Nothing here reads a clock. */
  asOf: asOf ?? null,
});

const withheld = (reason, reasonText, nextStep, facts) => Object.freeze({
  version: COHORT_ATTRIBUTION_VERSION,
  eligible: false,
  reason,
  reasonText,
  nextStep,
  position: null,
  ...facts,
});

/**
 * Whether this import may be given a ranked position, and against which cohort.
 *
 * @param input.rows projected usage rows, raw-keyed.
 * @param input.roster projected roster entries, or an empty list.
 * @param input.declaration the merged RAW declaration, or null. Rows are the
 *   fallback: the same attribute declared on every usage row resolves exactly
 *   as one declared in a header block does.
 * @param input.readerDeclaration what the reader declared in the page, or null.
 *   Consulted per attribute ONLY where the export carries no column for it, so
 *   an export that already declares both ranks exactly as it does today.
 * @param input.asOf the caller's evaluation date, recorded on the note.
 * @returns a frozen decision. `eligible` is the only branch a surface needs;
 *   every other state carries a code, a sentence, and one next step.
 */
export function validateCohortAttribution({
  rows = [], roster = [], declaration = null, readerDeclaration = null, asOf = null,
} = {}) {
  const rowList = (Array.isArray(rows) ? rows : []).filter(isObject);
  const rosterList = (Array.isArray(roster) ? roster : []).filter(isObject);
  // The declaration first, rows behind it. `pick` takes the first non-empty
  // value across the list, so a declaration that resolved nothing falls through
  // to the rows without a second code path deciding when it should.
  const fromFile = readCohortDeclaration([declaration, ...rowList]);
  const reader = validateReaderCohortDeclaration(readerDeclaration);
  // WHICH ATTRIBUTES THE EXPORT COULD NOT SUPPLY. Published on every decision,
  // in both branches, because it is what the page gates its declaration control
  // on — and gating on "the position was withheld" would offer the control for
  // a file that carries the columns and merely wrote a value we do not publish.
  const declarable = Object.freeze({
    orgSizeBand: !fromFile.orgSizeBandRaw,
    industry: !fromFile.industryRaw,
  });
  // FILE WINS, per attribute. A column present in the export decides that
  // attribute outright — including deciding it is unrecognized — and the
  // reader-declared value fills only a genuinely absent column.
  const declared = Object.freeze({
    orgSizeBandRaw: fromFile.orgSizeBandRaw || reader.declaration.orgSizeBand || "",
    orgSizeBand: declarable.orgSizeBand
      ? reader.declaration.orgSizeBand ?? null : fromFile.orgSizeBand,
    orgSizeBandSource: declarable.orgSizeBand
      ? (reader.declaration.orgSizeBand ? COHORT_ATTRIBUTE_SOURCE.readerDeclared : null)
      : COHORT_ATTRIBUTE_SOURCE.file,
    industryRaw: fromFile.industryRaw || reader.declaration.industry || "",
    industry: declarable.industry ? reader.declaration.industry ?? null : fromFile.industry,
    industrySource: declarable.industry
      ? (reader.declaration.industry ? COHORT_ATTRIBUTE_SOURCE.readerDeclared : null)
      : COHORT_ATTRIBUTE_SOURCE.file,
  });
  const note = anonymizationNote(asOf);

  // Org units are counted over NORMALIZED keys, and the roster is indexed the
  // same way. A provider export writes `atlas-platform` where the roster writes
  // `Atlas Platform`; counting them as two units would put an organization in a
  // band twice its size, and it is the same join key the rest of this page
  // matches on.
  const keys = [...new Set(rowList
    .map((row) => normalizeValue(pick(row, DEPARTMENT_KEY_FIELDS))).filter(Boolean))];
  const rosterByKey = new Map(rosterList.map(
    (entry) => [normalizeValue(entry.departmentKey), entry]));
  const inactive = keys.filter((key) => rosterByKey.get(key)?.active === false);
  const external = keys.filter((key) => {
    const unitType = rosterByKey.get(key)?.unitType;
    return unitType ? EXTERNAL_UNIT_TYPES.has(normalizeValue(unitType)) : false;
  });
  const counted = keys.filter((key) => !inactive.includes(key) && !external.includes(key));
  const observed = Object.freeze({
    rowsRead: rowList.length,
    orgUnits: counted.length,
    /** Counted, but no roster entry claims them. Reported, never blocking. */
    unmappedUnits: counted.filter((key) => !rosterByKey.has(key)).length,
    inactiveUnits: inactive.length,
    externalUnits: external.length,
  });
  const facts = { declared, declarable, observed, note, refusals: EMPTY };

  // The refusal stands before anything is counted from it: a value outside the
  // published enumeration must never reach `selectPeerCohort`, and a reader who
  // sent one is owed the accepted options for the field they sent it for. Only
  // refusals for attributes the export could not supply are raised — where the
  // file carries the column, the reader-declared value was never consulted.
  const refusals = reader.refusals.filter((refusal) => declarable[refusal.attribute]);
  if (refusals.length) {
    return withheld(COHORT_ATTRIBUTION_REASON.unacceptedDeclaredValue,
      refusals.map((refusal) => refusal.message).join(" "),
      "Declare a value from the accepted list for each field named above. No position is "
      + "published from a value this contract does not publish.",
      { ...facts, refusals: Object.freeze(refusals) });
  }
  if (!keys.length) {
    return withheld(COHORT_ATTRIBUTION_REASON.noValidRows,
      "No row in this import carries an org unit, so there is nothing to count an organization "
      + "size from.",
      "Re-open the mapping step and point the column that identifies the org unit at "
      + "department_key, then import the file again.", facts);
  }
  if (!counted.length) {
    return withheld(COHORT_ATTRIBUTION_REASON.noActiveOrgUnits,
      `Every org unit in this import — ${keys.length} of them — is marked inactive or as an `
      + "external unit type in the roster, so none of them count toward organization size.",
      "Import a roster whose active internal units cover the org units in the usage export, or "
      + "import the usage export on its own.", facts);
  }
  if (!declared.orgSizeBandRaw) {
    return withheld(COHORT_ATTRIBUTION_REASON.missingOrgSizeBand,
      "This import declares no organization size band. A cohort is never selected from an "
      + "inferred attribute, so no position is published.",
      `Add an org_size_band column declaring one of: ${listed(ACCEPTED_ORG_SIZE_BANDS)}. It may `
      + "sit on the first data row or repeat on every row. You can also declare the band on this "
      + "page instead, without re-importing the export.", facts);
  }
  if (!declared.orgSizeBand) {
    return withheld(COHORT_ATTRIBUTION_REASON.unrecognizedOrgSizeBand,
      `This import declares an organization size band of "${declared.orgSizeBandRaw}", which is `
      + "not a value this cohort contract publishes.",
      `Change the declared org_size_band value to one of: ${listed(ACCEPTED_ORG_SIZE_BANDS)}. The `
      + "column is already in the file, so nothing has to be added to it.", facts);
  }
  if (!declared.industryRaw) {
    return withheld(COHORT_ATTRIBUTION_REASON.missingIndustry,
      "This import declares no industry. Without one the comparison would be against every "
      + "organization of this size rather than against organizations like this one.",
      `Add an industry column declaring one of: ${listed(ACCEPTED_INDUSTRIES)}. It may sit on the `
      + "first data row or repeat on every row. You can also declare the industry on this page "
      + "instead, without re-importing the export.", facts);
  }
  if (!declared.industry) {
    return withheld(COHORT_ATTRIBUTION_REASON.unrecognizedIndustry,
      `This import declares an industry of "${declared.industryRaw}", which is not a value this `
      + "cohort contract publishes.",
      `Change the declared industry value to one of: ${listed(ACCEPTED_INDUSTRIES)}. The column is `
      + "already in the file, so nothing has to be added to it.", facts);
  }
  const declaredBand = ORG_SIZE_BANDS.find((entry) => entry.key === declared.orgSizeBand);
  if (observed.orgUnits < declaredBand.min || observed.orgUnits > declaredBand.max) {
    const fits = ORG_SIZE_BANDS.find((entry) =>
      observed.orgUnits >= entry.min && observed.orgUnits <= entry.max);
    return withheld(COHORT_ATTRIBUTION_REASON.orgSizeBandMismatch,
      `This import declares the "${declaredBand.key}" band (${declaredBand.label}) and carries `
      + `${observed.orgUnits} attributed org unit${observed.orgUnits === 1 ? "" : "s"}.`,
      fits
        ? `Declare "${fits.key}" — the band that contains ${observed.orgUnits} attributed org `
          + "units — or import the export whose org units match the band already declared."
        : "Import an export whose attributed org units fall inside a published band.", facts);
  }
  const cohort = selectPeerCohort({ orgUnits: observed.orgUnits, industry: declared.industry });
  if (!cohort) {
    return withheld(COHORT_ATTRIBUTION_REASON.noPublishedCohort,
      `No published cohort covers ${observed.orgUnits} attributed org units in `
      + `${declared.industry}.`,
      "This is a gap in the published cohorts rather than a defect in the export. The rest of "
      + "this briefing is unaffected.", facts);
  }
  return Object.freeze({
    version: COHORT_ATTRIBUTION_VERSION,
    eligible: true,
    reason: null,
    reasonText: null,
    nextStep: null,
    /**
     * The position, in the cohort contract's own words. Nothing here re-labels
     * a cohort or re-counts its members.
     */
    position: Object.freeze({
      cohortId: cohort.cohortId,
      label: cohort.label,
      segmentLabel: cohort.segmentLabel,
      family: cohort.family,
      memberCount: cohort.members.length,
      orgUnits: observed.orgUnits,
      orgSizeBand: declared.orgSizeBand,
      orgSizeBandSource: declared.orgSizeBandSource,
      industry: declared.industry,
      industrySource: declared.industrySource,
      /**
       * ONE discriminator for the whole placement, beside the per-attribute
       * ones. A position is file-derived only when BOTH attributes came out of
       * the export; a single reader-declared attribute makes the placement
       * reader-declared, because that is the weaker of the two claims and a
       * surface that averaged them would present a declared cohort as a
       * measured one.
       */
      provenance: declared.orgSizeBandSource === COHORT_ATTRIBUTE_SOURCE.file
        && declared.industrySource === COHORT_ATTRIBUTE_SOURCE.file
        ? COHORT_ATTRIBUTE_SOURCE.file
        : COHORT_ATTRIBUTE_SOURCE.readerDeclared,
      snapshotDate: cohort.snapshotDate,
    }),
    ...facts,
  });
}
