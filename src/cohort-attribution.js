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
// PARTIAL, STALE, MALFORMED, REORDERED
// ------------------------------------
//   partial    a declaration may appear on the first data row, on every row, or
//              on a roster beside the usage export. All three resolve the same.
//   malformed  a declared value the contract does not publish is reported as
//              UNRECOGNIZED_*, quoting the value back, never silently dropped
//              to MISSING_* — "you wrote something we do not accept" and "you
//              wrote nothing" are different instructions to the reader.
//   reordered  attributes are resolved by first non-empty value across the
//              projected rows, and across sources in selection order, so a file
//              whose first row happens to be blank still resolves.
//   stale      `asOf` is supplied by the caller — the analysed period's own end
//              — and recorded. Nothing here reads a clock.
//
// WHO DECLARED IT
// ---------------
// An attribute can reach this module two ways, and they are not the same fact.
// A column in the reader's export is FILE-DERIVED. A value the reader chose in
// this tab, because their export carries no such column, is READER-DECLARED.
// Both select a cohort; only one of them is in the file, so `COHORT_FACT_SOURCE`
// travels on the result per attribute and on the position as a whole, and every
// surface reads that discriminator rather than guessing from context. A
// reader-declared position is never presented as file-derived.
//
// The reader fills SILENCE, never CONTRADICTION: a declared value is consulted
// only where the file left the column empty. A file that wrote a value this
// contract does not publish still gets UNRECOGNIZED_*, because overwriting it
// would answer a question the reader was never asked.

import {
  PEER_COHORT_PROVENANCE, PEER_INDUSTRY, selectPeerCohort,
} from "./peer-cohort-contract.js";

/** Bump when a projection, an accepted value, or a published reason changes. */
export const COHORT_ATTRIBUTION_VERSION = "import-cohort-attribution/1.1.0";

/**
 * Where one cohort attribute came from.
 *
 * A discriminator rather than a boolean, and carried rather than inferred: a
 * surface that works out "this must have been declared by hand because the
 * export has no such column" is one file format away from labelling a position
 * wrongly, and the label is a claim about whose statement it is.
 */
export const COHORT_FACT_SOURCE = Object.freeze({
  /** A column in the reader's own export or roster carried it. */
  file: "file-derived",
  /** The reader chose it in this tab because no column carried it. */
  reader: "reader-declared",
});

/** The words each source is named by, everywhere a position surfaces. */
export const COHORT_FACT_SOURCE_LABEL = Object.freeze({
  [COHORT_FACT_SOURCE.file]: "file-derived",
  [COHORT_FACT_SOURCE.reader]: "reader-declared",
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
 * The same two enumerations, as choosable options.
 *
 * A control that offers cohort values reads THESE rather than restating them.
 * A duplicated literal list in a view is a fourth band away from offering a
 * value this contract refuses, and the reader would meet that disagreement as
 * "the page let me choose it and then would not accept it".
 */
// The visible label names the published key as well as its meaning: the
// refusals below quote keys back, and an option a reader picked by its prose
// alone leaves them matching "Financial services" against `financial_services`.
const options = (entries) => Object.freeze(entries.map((entry) =>
  Object.freeze({ value: entry.key, label: `${entry.key} — ${entry.label}` })));

export const ORG_SIZE_BAND_OPTIONS = options(ORG_SIZE_BANDS);
export const INDUSTRY_OPTIONS = options(INDUSTRIES);

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
 * The file's reading of the two attributes, with the reader's filling its gaps.
 *
 * Per attribute, and per attribute a SOURCE, because a file that names the
 * industry and no size band produces a position that is half one and half the
 * other. The whole position takes the reader's label as soon as either half
 * does: a placement one of whose two selectors was typed in this tab is not a
 * placement the export supports, and calling it file-derived because the other
 * half was in a column is exactly the mislabelling this discriminator exists
 * to prevent.
 *
 * @param fromFile a `readCohortDeclaration` result over the file's own rows.
 * @param readerDeclared accepted reader facts, or null.
 */
export function mergeDeclaredSources(fromFile, readerDeclared = null) {
  const reader = isObject(readerDeclared) ? readerDeclared : null;
  const fill = (raw, resolved, declaredValue) => {
    if (raw) return { raw, key: resolved, source: COHORT_FACT_SOURCE.file };
    const value = text(declaredValue);
    if (value) return { raw: value, key: value, source: COHORT_FACT_SOURCE.reader };
    return { raw: "", key: null, source: null };
  };
  const band = fill(fromFile.orgSizeBandRaw, fromFile.orgSizeBand, reader?.orgSizeBand);
  const industry = fill(fromFile.industryRaw, fromFile.industry, reader?.industry);
  const sources = [band.source, industry.source].filter(Boolean);
  return Object.freeze({
    orgSizeBandRaw: band.raw,
    orgSizeBand: band.key,
    orgSizeBandSource: band.source,
    industryRaw: industry.raw,
    industry: industry.key,
    industrySource: industry.source,
    /**
     * The one discriminator every surface labels a position from. Null until
     * something was declared at all, reader as soon as either half was.
     */
    positionSource: sources.includes(COHORT_FACT_SOURCE.reader)
      ? COHORT_FACT_SOURCE.reader
      : (sources[0] ?? null),
  });
}

/**
 * What a reader declared in this tab, accepted or refused.
 *
 * This is the WHOLE refusal rule, and it lives here rather than in the control
 * for a reason a test harness makes concrete: a browser's own select refuses a
 * value that is not one of its options, and a test double for one does not. A
 * control-level test therefore cannot prove that free text or an unpublished
 * value is refused. This function can be called with either directly, and
 * `tests/cohort-attribution.test.js` does exactly that.
 *
 * Values resolve through the same `resolveBand`/`resolveIndustry` the file path
 * uses, so this contract has one reading of a value rather than a second,
 * stricter one that would refuse a published alias the imported file accepts.
 *
 * @returns a frozen outcome: `accepted`, the resolved `facts` (or null), and a
 *   `message` that quotes an unpublished value back and names what is accepted.
 */
export function validateDeclaredCohortFacts({ orgSizeBand = "", industry = "" } = {}) {
  const bandRaw = text(orgSizeBand);
  const industryRaw = text(industry);
  const resolvedBand = resolveBand(bandRaw);
  const resolvedIndustry = resolveIndustry(industryRaw);
  const refusals = [];
  if (!bandRaw) {
    refusals.push("Choose an organization size band. Accepted: "
      + `${listed(ACCEPTED_ORG_SIZE_BANDS)}.`);
  } else if (!resolvedBand) {
    refusals.push(`"${bandRaw}" is not an organization size band this cohort contract publishes. `
      + `Accepted: ${listed(ACCEPTED_ORG_SIZE_BANDS)}.`);
  }
  if (!industryRaw) {
    refusals.push(`Choose an industry. Accepted: ${listed(ACCEPTED_INDUSTRIES)}.`);
  } else if (!resolvedIndustry) {
    refusals.push(`"${industryRaw}" is not an industry this cohort contract publishes. `
      + `Accepted: ${listed(ACCEPTED_INDUSTRIES)}.`);
  }
  if (refusals.length) {
    return Object.freeze({ accepted: false, facts: null, message: refusals.join(" ") });
  }
  return Object.freeze({
    accepted: true,
    facts: Object.freeze({
      orgSizeBand: resolvedBand.key,
      industry: resolvedIndustry.key,
      source: COHORT_FACT_SOURCE.reader,
    }),
    message: `Declared in this tab: organization size band ${resolvedBand.key}, industry `
      + `${resolvedIndustry.key}. This position is labelled `
      + `${COHORT_FACT_SOURCE_LABEL[COHORT_FACT_SOURCE.reader]} wherever it appears.`,
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
});

// ---------------------------------------------------------------------------
// THE CONTROLS A WITHHELD POSITION POINTS AT, quoted by the exact label each one
// carries in src/evolution.html. A next step that names no control is a next
// step a reader cannot take, and a next step that invents a label sends them
// looking for a button this page does not have. Every string below is the
// visible text of a control that ships in the markup:
//
//   * "Choose your export files"            — the file input's label, line 1386.
//   * "Change column mapping"               — line 1500. Delimited imports only,
//     which is why the sentence that quotes it also says what a JSON export does
//     instead.
//   * "Run the analysis with this mapping"  — line 1677.
//   * the two choosers and their submit     — lines 1822-1824, offered on exactly
//     the two reasons `declareHere` is used for.
//   * the cohort disclosure summary         — line 464.
// ---------------------------------------------------------------------------

/** The page's single file input. There is no second picker on this page. */
const FILE_PICKER_LABEL = "Choose your export files";
const MAPPING_STEP_ACTION = "Change column mapping";
const MAPPING_RUN_ACTION = "Run the analysis with this mapping";
const BAND_CHOOSER_LABEL = "Organization size band";
const INDUSTRY_CHOOSER_LABEL = "Industry";
const DECLARE_SUBMIT_LABEL = "Place this import with these values";
const COHORT_DISCLOSURE_LABEL = "How the organizations you are compared with were chosen";
/** The heading over the panel that holds the two choosers, so the step is findable. */
const COHORT_PANEL_LABEL = "Where does this organization rank against its peers?";

/**
 * The one next step for a fact the file never carried: type it in, here, now.
 *
 * The reader does not have to edit and re-export anything — the position is
 * recomputed from the import already open — so the sentence says so rather than
 * sending them back to a spreadsheet. Used on exactly the two reasons that put
 * the choosers on screen.
 */
const declareHere = (accepts) =>
  `Under "${COHORT_PANEL_LABEL}", choose "${BAND_CHOOSER_LABEL}" and "${INDUSTRY_CHOOSER_LABEL}", `
  + `then press "${DECLARE_SUBMIT_LABEL}". ${accepts} The file is not opened again: the position `
  + "is recomputed from the import already in this tab.";

const EXTERNAL_UNIT_TYPES = new Set(["contractor", "vendor", "external", "agency", "partner"]);

/**
 * What left the boundary to produce this answer, and what could not.
 *
 * Attached to the result rather than to a template: a surface that forgets to
 * render a note authored in its own markup ships a comparison with no statement
 * of what it read, and this note is part of the answer.
 */
const anonymizationNote = (asOf, positionSource) => Object.freeze({
  label: "What this comparison read",
  text: "This position was selected from two declared attribute values — organization size band "
    + "and industry — and one count of attributed org units. Names, email addresses, employee or "
    + "account identifiers, and prompt text are never read into it: a roster is projected to "
    + `${listed(ROSTER_COLUMNS_READ)} and a usage row to ${listed(USAGE_COLUMNS_READ)} before `
    + "anything is counted. Nothing was uploaded, stored, or transmitted — the cohorts are "
    + "bundled with this page and the comparison ran in this tab."
    // Whose statement the two attributes are is part of what was read.
    + (positionSource === COHORT_FACT_SOURCE.reader
      ? " At least one of the two attributes was declared by the reader in this tab rather than "
        + "read from a column, so this position is reader-declared."
      : ""),
  fieldsRead: Object.freeze([...new Set([...ROSTER_COLUMNS_READ, ...USAGE_COLUMNS_READ])]),
  provenance: PEER_COHORT_PROVENANCE,
  /**
   * The discriminator, for a surface that labels rather than narrates. Null
   * when neither attribute was supplied at all — nothing was placed, so there
   * is no statement to attribute to anyone.
   */
  positionSource: positionSource ?? null,
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
 * @param input.asOf the caller's evaluation date, recorded on the note.
 * @param input.readerDeclared an accepted `validateDeclaredCohortFacts` fact
 *   set, or null. Consulted only where the file left a column EMPTY, so a value
 *   the file did write — including one this contract does not publish — is
 *   still what the reader is answered about.
 * @returns a frozen decision. `eligible` is the only branch a surface needs;
 *   every other state carries a code, a sentence, and one next step.
 */
export function validateCohortAttribution({
  rows = [], roster = [], declaration = null, asOf = null, readerDeclared = null,
} = {}) {
  const rowList = (Array.isArray(rows) ? rows : []).filter(isObject);
  const rosterList = (Array.isArray(roster) ? roster : []).filter(isObject);
  // The declaration first, rows behind it. `pick` takes the first non-empty
  // value across the list, so a declaration that resolved nothing falls through
  // to the rows without a second code path deciding when it should.
  const declared = mergeDeclaredSources(
    readCohortDeclaration([declaration, ...rowList]), readerDeclared);
  const note = anonymizationNote(asOf, declared.positionSource);

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
  const facts = { declared, observed, note };

  if (!keys.length) {
    return withheld(COHORT_ATTRIBUTION_REASON.noValidRows,
      "No row in this import names an org unit, so there is no count to select an organization "
      + "size band from.",
      `Press "${MAPPING_STEP_ACTION}", point the column that names the org unit at `
      + `department_key, then press "${MAPPING_RUN_ACTION}". A JSON export has no mapping step: `
      + "re-export it with a department_key field instead.", facts);
  }
  if (!counted.length) {
    return withheld(COHORT_ATTRIBUTION_REASON.noActiveOrgUnits,
      `Every org unit in this import — ${keys.length} of them — is marked inactive or as an `
      + "external unit type in the roster, so none of them count toward organization size.",
      `Under "${FILE_PICKER_LABEL}", add a roster whose active internal units cover these org `
      + "units, or choose the usage export on its own.", facts);
  }
  if (!declared.orgSizeBandRaw) {
    return withheld(COHORT_ATTRIBUTION_REASON.missingOrgSizeBand,
      "This import declares no organization size band, and no column in it carries one. A cohort "
      + "is never selected from a band this page guessed.",
      declareHere(`The bands on offer are ${listed(ACCEPTED_ORG_SIZE_BANDS)}.`), facts);
  }
  if (!declared.orgSizeBand) {
    return withheld(COHORT_ATTRIBUTION_REASON.unrecognizedOrgSizeBand,
      `This import declares an organization size band of "${declared.orgSizeBandRaw}", which is `
      + "not a value this cohort contract publishes.",
      `Change the org_size_band value in the file to one of: ${listed(ACCEPTED_ORG_SIZE_BANDS)} — `
      + `the column is already there — then choose the file again under "${FILE_PICKER_LABEL}".`,
      facts);
  }
  if (!declared.industryRaw) {
    return withheld(COHORT_ATTRIBUTION_REASON.missingIndustry,
      "This import declares no industry, and no column in it carries one. Without one the "
      + "comparison would be against every organization of this size rather than against "
      + "organizations like this one.",
      declareHere(`The industries on offer are ${listed(ACCEPTED_INDUSTRIES)}.`), facts);
  }
  if (!declared.industry) {
    return withheld(COHORT_ATTRIBUTION_REASON.unrecognizedIndustry,
      `This import declares an industry of "${declared.industryRaw}", which is not a value this `
      + "cohort contract publishes.",
      `Change the industry value in the file to one of: ${listed(ACCEPTED_INDUSTRIES)} — the `
      + `column is already there — then choose the file again under "${FILE_PICKER_LABEL}".`,
      facts);
  }
  const declaredBand = ORG_SIZE_BANDS.find((entry) => entry.key === declared.orgSizeBand);
  if (observed.orgUnits < declaredBand.min || observed.orgUnits > declaredBand.max) {
    const fits = ORG_SIZE_BANDS.find((entry) =>
      observed.orgUnits >= entry.min && observed.orgUnits <= entry.max);
    // Named by whoever said it. A band the reader chose in this tab reported as
    // something "this import declares" sends them looking for a column that was
    // never in the file.
    const declarer = declared.orgSizeBandSource === COHORT_FACT_SOURCE.reader
      ? "You declared the" : "This import declares the";
    return withheld(COHORT_ATTRIBUTION_REASON.orgSizeBandMismatch,
      `${declarer} "${declaredBand.key}" band (${declaredBand.label}) and this import carries `
      + `${observed.orgUnits} attributed org unit${observed.orgUnits === 1 ? "" : "s"}.`,
      fits
        ? `Set the org_size_band value in the file to "${fits.key}" — the band that contains `
          + `${observed.orgUnits} attributed org units — then choose the file again under `
          + `"${FILE_PICKER_LABEL}".`
        : `Under "${FILE_PICKER_LABEL}", choose an export whose attributed org units fall inside `
          + "a published band.", facts);
  }
  const cohort = selectPeerCohort({ orgUnits: observed.orgUnits, industry: declared.industry });
  if (!cohort) {
    return withheld(COHORT_ATTRIBUTION_REASON.noPublishedCohort,
      `No published cohort covers ${observed.orgUnits} attributed org units in `
      + `${declared.industry}. Nothing in this export can select one.`,
      `Open "${COHORT_DISCLOSURE_LABEL}" to read which cohorts are published. There is nothing `
      + "to fix in the file, and every other figure in this brief still stands.", facts);
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
      industry: declared.industry,
      snapshotDate: cohort.snapshotDate,
      /**
       * Whose statement the two selectors are. Read by every surface that
       * shows this position; never re-derived from the shape of the export.
       */
      orgSizeBandSource: declared.orgSizeBandSource,
      industrySource: declared.industrySource,
      source: declared.positionSource,
      sourceLabel: COHORT_FACT_SOURCE_LABEL[declared.positionSource],
    }),
    ...facts,
  });
}
