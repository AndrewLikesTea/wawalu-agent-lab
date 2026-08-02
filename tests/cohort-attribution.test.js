// The import-side cohort attribution contract.
//
// Every eligibility test below drives a fixture through the boundary the page
// actually takes — `projectCohortSource` → `mergeCohortSources` →
// `validateCohortAttribution` — rather than handing `validateCohortAttribution`
// a hand-authored row list. That distinction is the whole point of this file:
// the projection layer resolves the declaration, and a validation that reads a
// declaration differently from the way the projection wrote it is a defect no
// direct-call test can see. The one thing that is hand-built is the CSV text,
// and it is read with the shipped delimited reader.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readDelimitedText } from "../src/delimited-text.js";
import {
  ACCEPTED_INDUSTRIES, ACCEPTED_ORG_SIZE_BANDS, COHORT_ATTRIBUTION_REASON, COHORT_FACT_SOURCE,
  INDUSTRY_OPTIONS, ORG_SIZE_BAND_OPTIONS, ROSTER_COLUMNS_READ,
  mergeCohortSources, normalizeKey, pick, projectCohortSource, readCohortDeclaration,
  readDepartmentRoster, validateCohortAttribution, validateDeclaredCohortFacts,
} from "../src/cohort-attribution.js";

// --- the harness: exactly what the page does with a confirmed delimited file --

/** One file's data rows as header-keyed objects, as `mountLocalFinopsImport` builds them. */
function objectsFrom(csv) {
  const reading = readDelimitedText(csv, { maxBytes: 8_000_000, maxRows: 50_000 });
  assert.equal(reading.ok, true, "fixture must be readable by the shipped delimited reader");
  return reading.rows.map((row) => Object.fromEntries(
    reading.header.map((name, index) => [name, row.values[index] ?? ""])));
}

/** The production boundary, start to finish. */
const decide = (...files) => validateCohortAttribution({
  ...mergeCohortSources(files.map((csv) => projectCohortSource({ objects: objectsFrom(csv) }))),
  asOf: "2026-06-30",
});

// --- fixtures, generated here rather than committed ------------------------

const usageExport = ({ units = 6, orgSizeBand = "scaling", industry = "saas",
  declareOnFirstRowOnly = false, extraColumns = {} } = {}) => {
  const extras = Object.keys(extraColumns);
  const header = ["usage_date", "model", "department_key", "amount", "org_size_band", "industry",
    ...extras];
  const rows = Array.from({ length: units }, (_, index) => {
    const declared = declareOnFirstRowOnly && index > 0 ? ["", ""] : [orgSizeBand, industry];
    return ["2026-06-05", "gpt-4o", `unit-${index + 1}`, String(100 + index), ...declared,
      ...extras.map((column) => extraColumns[column])];
  });
  return [header, ...rows].map((row) => row.join(",")).join("\n");
};

/** The same export with the declaration absent from the first data row only. */
const usageExportDeclaringLater = ({ units = 6 } = {}) => {
  const header = ["usage_date", "department_key", "amount", "org_size_band", "industry"];
  const rows = Array.from({ length: units }, (_, index) => [
    "2026-06-05", `unit-${index + 1}`, String(100 + index),
    index === 0 ? "" : "scaling", index === 0 ? "" : "saas",
  ]);
  return [header, ...rows].map((row) => row.join(",")).join("\n");
};

const rosterExport = ({ units = 6, unitType = "internal", active = "Active",
  orgSizeBand = "", industry = "" } = {}) => {
  const header = ["employee_id", "full_name", "work_email", "job_title", "department_key",
    "manager_employee_id", "unit_type", "active", "org_size_band", "industry"];
  const rows = Array.from({ length: units }, (_, index) => [
    `emp-${1000 + index}`, `Ada Fern ${index}`, `person${index}@example.invalid`, "Staff Engineer",
    `unit-${index + 1}`, "emp-999", unitType, active, orgSizeBand, industry,
  ]);
  return [header, ...rows].map((row) => row.join(",")).join("\n");
};

// --- the units the boundary is built from ---------------------------------

test("column names are matched by shape, not by spelling", () => {
  assert.equal(normalizeKey(" Org Size Band "), "org_size_band");
  assert.equal(normalizeKey("org-size-band"), "org_size_band");
  assert.equal(pick({ "Org Size Band": " scaling " }, ["org_size_band"]), "scaling");
  // The first non-empty value across an ordered list — the rule behind both
  // "first source wins" and "a declaration may repeat on every row".
  assert.equal(pick([{ industry: "" }, { industry: "saas" }], ["industry"]), "saas");
});

test("a resolved declaration keeps the raw string beside the resolved key", () => {
  const declared = readCohortDeclaration({ org_size_band: "Scaling", industry: "Rocket Surgery" });
  assert.equal(declared.orgSizeBand, "scaling");
  assert.equal(declared.orgSizeBandRaw, "Scaling");
  // Unrecognized: the key is null and the value survives verbatim, because the
  // reader has to be shown what they wrote.
  assert.equal(declared.industry, null);
  assert.equal(declared.industryRaw, "Rocket Surgery");
});

test("a roster is projected to three columns and carries nothing else out", () => {
  const roster = readDepartmentRoster(objectsFrom(rosterExport({ units: 2 })));
  assert.equal(roster.length, 2);
  assert.deepEqual(Object.keys(roster[0]).sort(), ["active", "departmentKey", "unitType"]);
  assert.deepEqual([...ROSTER_COLUMNS_READ], ["department_key", "unit_type", "active"]);
  const serialized = JSON.stringify(roster);
  for (const identifying of ["Ada Fern", "example.invalid", "Staff Engineer", "emp-1000", "emp-999"]) {
    assert.equal(serialized.includes(identifying), false,
      `${identifying} must not survive the roster projection`);
  }
});

// --- the boundary the page takes ------------------------------------------

test("a declared export earns a ranked position through the merge path", () => {
  const decision = decide(usageExport({ units: 6 }), rosterExport({ units: 6 }));
  assert.equal(decision.eligible, true);
  assert.equal(decision.reason, null);
  assert.equal(decision.position.industry, "saas");
  assert.equal(decision.position.orgUnits, 6);
  assert.equal(decision.position.cohortId, "industry-saas");
  assert.ok(decision.position.memberCount >= 8);
  // The note travels with the position rather than with a template, and it
  // carries the cohort contract's own provenance statement.
  assert.equal(decision.note.label, "What this comparison read");
  assert.match(decision.note.text, /Names, email addresses/);
  assert.deepEqual(decision.note.fieldsRead.includes("department_key"), true);
  assert.equal(decision.note.provenance.label, "Published synthetic peer cohorts");
  // The caller's own evaluation date, never a clock read.
  assert.equal(decision.note.asOf, "2026-06-30");
  // Nothing identifying reaches the result, roster included.
  const serialized = JSON.stringify(decision);
  for (const identifying of ["Ada Fern", "example.invalid", "Staff Engineer", "emp-1000", "gpt-4o"]) {
    assert.equal(serialized.includes(identifying), false,
      `${identifying} must not cross the cohort boundary`);
  }
});

test("an unrecognized industry is reported as declared, through the merge path", () => {
  const decision = decide(usageExport({ industry: "Rocket Surgery" }));
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, COHORT_ATTRIBUTION_REASON.unrecognizedIndustry);
  // The value the reader wrote, quoted back to them verbatim.
  assert.equal(decision.reasonText,
    'This import declares an industry of "Rocket Surgery", which is not a value this cohort '
    + "contract publishes.");
  // And the instruction is to change the value, not to add a column the file
  // already has: `industry` is right there in the header.
  assert.match(decision.nextStep, /Change the declared industry value to one of: saas, financial_services/);
  assert.match(decision.nextStep, /already in the file/);
  assert.equal(decision.declared.industryRaw, "Rocket Surgery");
  assert.equal(decision.position, null);
  for (const accepted of ACCEPTED_INDUSTRIES) assert.match(decision.nextStep, new RegExp(accepted));
});

test("an unrecognized org size band is reported as declared, through the merge path", () => {
  const decision = decide(usageExport({ orgSizeBand: "gigantic" }));
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, COHORT_ATTRIBUTION_REASON.unrecognizedOrgSizeBand);
  assert.equal(decision.reasonText,
    'This import declares an organization size band of "gigantic", which is not a value this '
    + "cohort contract publishes.");
  assert.match(decision.nextStep, /already in the file/);
  for (const accepted of ACCEPTED_ORG_SIZE_BANDS) assert.match(decision.nextStep, new RegExp(accepted));
  assert.equal(decision.declared.orgSizeBandRaw, "gigantic");
});

test("a genuinely absent column is a different answer from an unaccepted value", () => {
  // No industry column at all: the instruction is to add one, and it is the
  // only state in which that instruction is correct.
  const noIndustry = [
    "usage_date,department_key,amount,org_size_band",
    "2026-06-05,unit-1,100,scaling",
    "2026-06-05,unit-2,120,scaling",
    "2026-06-05,unit-3,140,scaling",
    "2026-06-05,unit-4,160,scaling",
    "2026-06-05,unit-5,180,scaling",
  ].join("\n");
  const decision = decide(noIndustry);
  assert.equal(decision.reason, COHORT_ATTRIBUTION_REASON.missingIndustry);
  assert.match(decision.nextStep, /Add an industry column/);
  assert.equal(decision.declared.industryRaw, "");
  assert.notEqual(decision.reason, COHORT_ATTRIBUTION_REASON.unrecognizedIndustry);
});

test("a declaration that starts on a later row still resolves to a position", () => {
  // The contract allows the declaration to repeat on every usage row. An export
  // whose first data row leaves both columns empty declares them all the same.
  const decision = decide(usageExportDeclaringLater({ units: 6 }));
  assert.equal(decision.reason, null);
  assert.equal(decision.eligible, true);
  assert.equal(decision.position.orgSizeBand, "scaling");
  assert.equal(decision.position.industry, "saas");
});

test("a declaration on the first row only is still read", () => {
  const decision = decide(usageExport({ declareOnFirstRowOnly: true }));
  assert.equal(decision.eligible, true);
  assert.equal(decision.position.cohortId, "industry-saas");
});

test("a usage export carrying a type column is not mistaken for a roster", () => {
  // `type` is a billing line type here. Only `unit_type` classifies a source,
  // so these rows stay usage rows and the export still ranks.
  const source = projectCohortSource({
    objects: objectsFrom(usageExport({ extraColumns: { type: "committed_use" } })),
  });
  assert.equal(source.kind, "usage");
  assert.equal(source.rows.length, 6);
  const decision = decide(usageExport({ extraColumns: { type: "committed_use" } }));
  assert.equal(decision.reason, null);
  assert.equal(decision.eligible, true);
});

test("a roster declares itself with unit_type and contributes no usage rows", () => {
  const source = projectCohortSource({ objects: objectsFrom(rosterExport({ units: 3 })) });
  assert.equal(source.kind, "roster");
  assert.equal(source.rows.length, 0);
  assert.equal(source.roster.length, 3);
});

test("the first source wins per declared attribute", () => {
  const decision = decide(
    usageExport({ units: 6, industry: "financial_services" }),
    rosterExport({ units: 6, orgSizeBand: "enterprise", industry: "saas" }),
  );
  assert.equal(decision.position.industry, "financial_services");
  assert.equal(decision.position.orgSizeBand, "scaling");
});

test("an export with no org unit column ranks nothing and says which column is missing", () => {
  const noKey = [
    "usage_date,model,amount,org_size_band,industry",
    "2026-06-05,gpt-4o,100,scaling,saas",
  ].join("\n");
  const decision = decide(noKey);
  assert.equal(decision.reason, COHORT_ATTRIBUTION_REASON.noValidRows);
  assert.match(decision.nextStep, /department_key/);
  assert.equal(decision.position, null);
});

test("a roster marking every unit external withholds the position over the internal gap", () => {
  // The usage rows are fine; the roster says none of these units are the
  // reader's own teams, so none of them count toward organization size.
  const decision = decide(
    usageExport({ units: 6 }),
    rosterExport({ units: 6, unitType: "contractor" }),
  );
  assert.equal(decision.reason, COHORT_ATTRIBUTION_REASON.noActiveOrgUnits);
  assert.equal(decision.observed.externalUnits, 6);
  assert.equal(decision.observed.orgUnits, 0);
});

test("a declared band that disagrees with the counted units is reported, not trusted", () => {
  const decision = decide(usageExport({ units: 6, orgSizeBand: "focused" }));
  assert.equal(decision.reason, COHORT_ATTRIBUTION_REASON.orgSizeBandMismatch);
  assert.match(decision.reasonText, /carries 6 attributed org units/);
  assert.match(decision.nextStep, /Declare "scaling"/);
});

test("inactive units are excluded from the count the cohort is selected on", () => {
  const decision = decide(
    usageExport({ units: 6 }),
    // Five active internal units, one terminated.
    [rosterExport({ units: 5 }), rosterExport({ units: 6, active: "Terminated" }).split("\n")[6]]
      .join("\n"),
  );
  assert.equal(decision.observed.inactiveUnits, 1);
  assert.equal(decision.observed.orgUnits, 5);
  assert.equal(decision.eligible, true);
});

test("no selection at all is an empty merge rather than a thrown error", () => {
  const decision = validateCohortAttribution({ ...mergeCohortSources([]), asOf: null });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, COHORT_ATTRIBUTION_REASON.noValidRows);
  assert.equal(decision.note.asOf, null);
});

// --- what a reader declares in the tab, and how it is labelled -------------
//
// The control that collects these values cannot prove the refusal below. A
// browser's own select refuses a value that is not one of its options; the test
// harness's does not — tests/support/browser.js takes any assignment to `value`
// — so a control-level test would pass on a build that accepted free text.
// These call the contract directly for exactly that reason.

/** The boundary again, with facts the reader declared in the tab. */
const decideWithDeclared = (declared, ...files) => validateCohortAttribution({
  ...mergeCohortSources(files.map((csv) => projectCohortSource({ objects: objectsFrom(csv) }))),
  asOf: "2026-06-30",
  readerDeclared: declared,
});

/** An export with real usage rows and neither cohort column in it. */
const undeclaredExport = ({ units = 6 } = {}) => [
  ["usage_date", "department_key", "amount"].join(","),
  ...Array.from({ length: units }, (_, index) =>
    ["2026-06-05", `unit-${index + 1}`, String(100 + index)].join(",")),
].join("\n");

test("free text is refused by the contract, with the accepted values named", () => {
  const refused = validateDeclaredCohortFacts({
    orgSizeBand: "about two hundred people", industry: "Rocket Surgery",
  });
  assert.equal(refused.accepted, false);
  assert.equal(refused.facts, null);
  assert.match(refused.message, /"about two hundred people" is not an organization size band/);
  assert.match(refused.message, /"Rocket Surgery" is not an industry/);
  // The message has to be actionable on its own: it names every value that
  // would be accepted instead, in the contract's own spelling.
  for (const accepted of [...ACCEPTED_ORG_SIZE_BANDS, ...ACCEPTED_INDUSTRIES]) {
    assert.equal(refused.message.includes(accepted), true, `${accepted} must be named`);
  }
});

test("an empty choice is refused as a choice not made, not as an unaccepted value", () => {
  const refused = validateDeclaredCohortFacts({ orgSizeBand: "", industry: "" });
  assert.equal(refused.accepted, false);
  assert.match(refused.message, /Choose an organization size band/);
  assert.match(refused.message, /Choose an industry/);
  assert.equal(refused.message.includes("is not an"), false);
});

test("a published value is accepted and comes back tagged reader-declared", () => {
  const accepted = validateDeclaredCohortFacts({ orgSizeBand: "scaling", industry: "saas" });
  assert.equal(accepted.accepted, true);
  assert.deepEqual({ ...accepted.facts }, {
    orgSizeBand: "scaling", industry: "saas", source: COHORT_FACT_SOURCE.reader,
  });
});

test("declared facts place an export whose columns cannot, and the position says so", () => {
  const { facts } = validateDeclaredCohortFacts({ orgSizeBand: "scaling", industry: "saas" });
  const withheld = decideWithDeclared(null, undeclaredExport());
  assert.equal(withheld.eligible, false);
  assert.equal(withheld.reason, COHORT_ATTRIBUTION_REASON.missingOrgSizeBand);
  assert.equal(withheld.note.positionSource, null,
    "nothing was declared, so there is no statement to attribute to anyone");

  const placed = decideWithDeclared(facts, undeclaredExport());
  assert.equal(placed.eligible, true);
  assert.equal(placed.position.source, COHORT_FACT_SOURCE.reader);
  assert.equal(placed.position.sourceLabel, "reader-declared");
  assert.equal(placed.position.orgSizeBandSource, COHORT_FACT_SOURCE.reader);
  assert.equal(placed.position.industrySource, COHORT_FACT_SOURCE.reader);
  assert.equal(placed.note.positionSource, COHORT_FACT_SOURCE.reader);
  assert.match(placed.note.text,
    /declared by the reader in this tab rather than read from a column/);
  // The count is still the export's own. A declared band is a claim about the
  // organization, never a substitute for what the file carries.
  assert.equal(placed.position.orgUnits, 6);
});

test("a column the file carries is never overwritten by what the reader chose", () => {
  const { facts } = validateDeclaredCohortFacts({ orgSizeBand: "focused", industry: "saas" });
  const placed = decideWithDeclared(facts, usageExport({ units: 6, orgSizeBand: "scaling" }));
  assert.equal(placed.eligible, true);
  assert.equal(placed.position.orgSizeBand, "scaling", "the file's own value stands");
  assert.equal(placed.position.source, COHORT_FACT_SOURCE.file);
  assert.equal(placed.position.sourceLabel, "file-derived");
  assert.equal(placed.note.text.includes("declared by the reader"), false);
});

test("a value the file wrote and this contract refuses is still the reader's answer", () => {
  const { facts } = validateDeclaredCohortFacts({ orgSizeBand: "scaling", industry: "saas" });
  const decision = decideWithDeclared(facts,
    usageExport({ units: 6, industry: "Rocket Surgery" }));
  assert.equal(decision.reason, COHORT_ATTRIBUTION_REASON.unrecognizedIndustry,
    "the reader fills silence, never contradiction");
  assert.match(decision.reasonText, /"Rocket Surgery"/);
});

test("a half-declared position is labelled reader-declared, not file-derived", () => {
  const { facts } = validateDeclaredCohortFacts({ orgSizeBand: "scaling", industry: "saas" });
  const noIndustry = [
    "usage_date,department_key,amount,org_size_band",
    ...Array.from({ length: 6 }, (_, index) =>
      `2026-06-05,unit-${index + 1},${100 + index},scaling`),
  ].join("\n");
  const placed = decideWithDeclared(facts, noIndustry);
  assert.equal(placed.eligible, true);
  assert.equal(placed.position.orgSizeBandSource, COHORT_FACT_SOURCE.file);
  assert.equal(placed.position.industrySource, COHORT_FACT_SOURCE.reader);
  assert.equal(placed.position.source, COHORT_FACT_SOURCE.reader,
    "half a placement typed in this tab is not a placement the export supports");
});

test("a declared band that disagrees with the count is reported as the reader's", () => {
  const { facts } = validateDeclaredCohortFacts({ orgSizeBand: "focused", industry: "saas" });
  const decision = decideWithDeclared(facts, undeclaredExport({ units: 6 }));
  assert.equal(decision.reason, COHORT_ATTRIBUTION_REASON.orgSizeBandMismatch);
  assert.match(decision.reasonText, /^You declared the "focused" band/,
    "a value chosen in this tab must not be reported as something the import declares");
});

// --- the doc and the code offer the same values ---------------------------

test("the contract doc lists exactly the values the enumeration publishes", async () => {
  const doc = await readFile(new URL("../docs/import-cohort-attribution-contract.md",
    import.meta.url), "utf8");
  /** The accepted-values cell of the row naming one declared column. */
  const acceptedFor = (column) => {
    const row = doc.split("\n").find((line) => line.startsWith(`| \`${column}\``));
    assert.ok(row, `the doc must carry a row for ${column}`);
    return (row.split("|")[2].match(/`([^`]+)`/g) ?? []).map((value) => value.slice(1, -1));
  };
  assert.deepEqual(acceptedFor("org_size_band"), [...ACCEPTED_ORG_SIZE_BANDS]);
  assert.deepEqual(acceptedFor("industry"), [...ACCEPTED_INDUSTRIES]);
  // And the control offers those same values, because it reads this constant
  // rather than a list of its own. A view that retyped them would drift here.
  assert.deepEqual(ORG_SIZE_BAND_OPTIONS.map((option) => option.value),
    [...ACCEPTED_ORG_SIZE_BANDS]);
  assert.deepEqual(INDUSTRY_OPTIONS.map((option) => option.value), [...ACCEPTED_INDUSTRIES]);
  // Every option names its published key in the words a reader sees, so the
  // refusal message and the chooser are talking about the same thing.
  for (const option of [...ORG_SIZE_BAND_OPTIONS, ...INDUSTRY_OPTIONS]) {
    assert.equal(option.label.startsWith(`${option.value} — `), true,
      `${option.value} must be named in its own label`);
  }
});
