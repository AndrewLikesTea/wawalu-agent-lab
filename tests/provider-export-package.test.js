// The package contract, its published bytes, and the two surfaces that read it.
//
// Every fixture below is generated here from invented values — no committed
// export, no vendor file, no customer data. What the suite pins is the property
// that makes this a contract rather than a page of prose: the importer's
// behaviour and the panel's words are *derived* from the document, so a change
// to a package changes both, and a package that describes a shape nobody
// normalizes (or a shape nobody documents) fails the build.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHtml, textOf } from "./support/browser.js";
import {
  ACCEPTED_PACKAGE_EXTENSIONS,
  DELIVERY_BEHAVIOUR,
  EXPORT_PACKAGES,
  PACKAGE_INTAKE_SENTENCE,
  PROVIDER_EXPORT_PACKAGE_KIND,
  PROVIDER_EXPORT_PACKAGE_VERSION,
  PROVIDER_PATTERNS,
  UNSUPPORTED_PACKAGE,
  contractDocument,
  exportPackageGuidance,
  matchExportPackage,
  packageById,
  unsupportedContainerFor,
} from "../src/provider-export-package.js";
import {
  ACCEPTED_DELIMITED_EXTENSIONS, SHAPES, TABULAR_CODES,
  parseDelimitedFinopsFile, parseLocalImportFile,
} from "../src/finops-tabular-import.js";
import { ALL_DIALECT_PROFILES } from "../src/dialect-profiles.js";
import { applyExportPackageGuidance, diagnosticFor } from "../src/local-import-flow.js";

const MANIFEST = new URL("../contracts/integrations/provider-export-package/v1/manifest.json",
  import.meta.url);
const PAGE = new URL("../src/evolution.html", import.meta.url);
const GENERATED_AT = "2026-07-29T09:00:00.000Z";

// --- synthetic exports -----------------------------------------------------
//
// One invented OpenAI-shaped period. Every project name, model, and figure is
// made up; the amounts are small round numbers so a total is checkable by hand.

const HEADER = "date,project_name,model,n_context_tokens_total,n_generated_tokens_total,amount,currency";

const ROWS = [
  "2026-07-24,Atlas,gpt-4o,120000,18000,12.00,USD",
  "2026-07-24,Beacon,gpt-4o-mini,90000,11000,3.00,USD",
  "2026-07-25,Atlas,gpt-4o,150000,21000,15.00,USD",
];

const csv = (rows = ROWS, header = HEADER) => [header, ...rows].join("\n");

const parse = (text, fileName = "usage.csv") =>
  parseDelimitedFinopsFile(text, fileName, { generatedAt: GENERATED_AT });

// --- the document ----------------------------------------------------------

test("the contract is versioned, synthetic-only, and carries no live connection", () => {
  const document = contractDocument();
  assert.equal(document.manifest_version, PROVIDER_EXPORT_PACKAGE_VERSION);
  assert.equal(document.kind, PROVIDER_EXPORT_PACKAGE_KIND);
  assert.equal(document.fixture_data, "synthetic-only");

  assert.equal(document.intake.uploads, false);
  assert.equal(document.intake.network_calls, false);
  assert.equal(document.intake.credentials, false);
  assert.equal(document.intake.prompt_storage, false);
  assert.equal(document.intake.prompt_rendering, false);

  // A contract that shipped an endpoint or a credential would be a different
  // kind of object. Neither can appear without this failing.
  const serialized = JSON.stringify(document);
  for (const forbidden of ["http://", "https://", "authorization", "bearer ", "client_secret"]) {
    assert.ok(!serialized.toLowerCase().includes(forbidden),
      `the contract mentions ${forbidden}`);
  }
});

test("the published manifest is the shipped document, byte for byte", async () => {
  const raw = await readFile(MANIFEST, "utf8");
  assert.deepEqual(JSON.parse(raw), contractDocument());
  // Stable serialization, so a regenerated manifest is a no-op diff rather than
  // a reformat that hides a real change inside it.
  assert.equal(raw, `${JSON.stringify(contractDocument(), null, 2)}\n`);
});

test("every package states its request, its archive, its formats, and its redaction", () => {
  assert.ok(EXPORT_PACKAGES.length >= 5);
  const ids = EXPORT_PACKAGES.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "package ids are not unique");

  for (const entry of EXPORT_PACKAGES) {
    assert.ok(entry.export_request.ask_for, `${entry.id} does not say what to ask for`);
    assert.ok(entry.export_request.console_path, `${entry.id} does not say where`);
    assert.ok(entry.export_request.requested_by, `${entry.id} does not say who can ask`);
    assert.ok(entry.export_request.not, `${entry.id} does not say what to ask for instead`);
    assert.ok(entry.archive.container && entry.archive.lands_in && entry.archive.expected_content,
      `${entry.id} does not describe what arrives`);
    assert.ok(entry.accepted_formats.length > 0);
    assert.ok(entry.redaction.before_import.length > 0, `${entry.id} states no redaction`);
    assert.ok(entry.redaction.never_read.length > 0);
    assert.ok(entry.redaction.pseudonymized_on_read.length > 0);
    assert.equal(packageById(entry.id), entry);
  }

  // No usage package may leave prompt-bearing columns unlisted: this contract's
  // whole reason for existing beside the conversation one is that a usage export
  // must not carry that text at all.
  for (const entry of EXPORT_PACKAGES.filter((candidate) => candidate.kind === "usage")) {
    const never = entry.redaction.never_read.join(" ");
    assert.match(never, /prompt|message|content|description|tags|resourceid|labels/,
      `${entry.id} does not refuse any content-bearing column`);
  }

  // The roster asks for units, never people.
  const roster = packageById("generic-hris-roster");
  assert.match(roster.export_request.not, /worker|person|people/i);
  for (const column of ["name", "email", "job title", "compensation"]) {
    assert.ok(roster.redaction.never_read.includes(column), `roster reads ${column}`);
  }
});

test("packages and the registries that read them cannot drift apart", () => {
  const dialects = new Map(ALL_DIALECT_PROFILES.map((profile) => [profile.id, profile]));
  const shapes = new Map(SHAPES.map((shape) => [shape.id, shape]));

  for (const entry of EXPORT_PACKAGES) {
    const dialect = dialects.get(entry.dialect_id);
    assert.ok(dialect, `${entry.id} names a dialect profile that does not exist`);
    assert.equal(dialect.kind, entry.kind);
    if (entry.shape_id) {
      const shape = shapes.get(entry.shape_id);
      assert.ok(shape, `${entry.id} names a normalizer shape that does not exist`);
      assert.equal(shape.packageId, entry.id);
      if (entry.provider) assert.equal(shape.provider, entry.provider);
    } else {
      // A package with no normalizer says so, in the contract, in one field.
      assert.ok(entry.support, `${entry.id} has no shape and no stated support level`);
    }
  }

  // And the other way: no shipped shape may exist without guidance for it.
  for (const shape of SHAPES) {
    assert.ok(shape.packageId, `shape ${shape.id} is bound to no package`);
    assert.ok(packageById(shape.packageId), `shape ${shape.id} names a missing package`);
  }

  // Every usage or roster dialect the product recognizes is documented here.
  for (const profile of ALL_DIALECT_PROFILES.filter((p) => p.kind !== "conversation")) {
    assert.ok(EXPORT_PACKAGES.some((entry) => entry.dialect_id === profile.id),
      `dialect ${profile.id} has no export-request guidance`);
  }
});

// --- what the importer reads out of it -------------------------------------

test("the importer's accepted extensions come from the contract", () => {
  assert.equal(ACCEPTED_DELIMITED_EXTENSIONS, ACCEPTED_PACKAGE_EXTENSIONS);
  assert.deepEqual([...ACCEPTED_DELIMITED_EXTENSIONS], [".csv", ".tsv", ".txt"]);
  // The envelope keeps its own path and is not a delimited extension.
  assert.ok(!ACCEPTED_DELIMITED_EXTENSIONS.includes(".json"));
});

test("provider attribution is the contract's declared patterns, in declared order", () => {
  assert.deepEqual(PROVIDER_PATTERNS.map(([, provider]) => provider),
    ["openai", "anthropic", "aws", "google", "azure"]);

  // Driven through the real parser: a row whose provider column names a vendor
  // is attributed by the contract's patterns, not by the shape it arrived in.
  const result = parse(csv(
    ["2026-07-24,Atlas,gemini-1.5-pro,120000,18000,12.00,USD,Google Vertex AI"],
    `${HEADER},provider`,
  ));
  assert.equal(result.ok, true);
  assert.equal(result.parsed.document.records[0].provider, "google");
});

test("an undeclared package is refused before it is parsed, with its own next step", () => {
  const cases = [
    ["provider-export.zip", /archive/i, "ZIP archive"],
    ["usage-2026-07.csv.gz", /decompress/i, "Compressed file"],
    ["usage.xlsx", /CSV/, "Spreadsheet workbook"],
    ["invoice.pdf", /invoice/i, "Rendered invoice or report"],
    ["usage.parquet", /re-export as CSV/i, "Undeclared record format"],
  ];

  for (const [fileName, expected, container] of cases) {
    assert.equal(unsupportedContainerFor(fileName)?.label, container);
    const routed = matchExportPackage({ fileName });
    assert.equal(routed.status, "unsupported");
    assert.equal(routed.code, TABULAR_CODES.UNSUPPORTED_FORMAT);
    assert.match(routed.message, expected);
    assert.throws(() => parseLocalImportFile("anything", fileName),
      (error) => error.code === TABULAR_CODES.UNSUPPORTED_FORMAT
        && error.container === container
        && expected.test(error.message));
  }

  // Anything else gets the general sentence rather than an invented one.
  const unknown = matchExportPackage({ fileName: "export.rdf" });
  assert.equal(unknown.container, null);
  assert.match(unknown.message, /Choose a \.json, \.csv, \.tsv, or \.txt export/);

  // A media type outside the declared set is refused on the same code.
  const mistyped = matchExportPackage({ fileName: "usage.csv", mediaType: "application/zip" });
  assert.equal(mistyped.status, "unsupported");
  assert.match(mistyped.message, /not a declared delimited-text type/);
  // …and the delimited formats share one set on purpose.
  assert.equal(matchExportPackage({ fileName: "usage.tsv", mediaType: "text/plain" }).status,
    "supported");
  assert.equal(matchExportPackage({ fileName: "usage.csv", mediaType: "" }).status, "supported");
});

test("the recovery a reader is offered is the contract's own", () => {
  const diagnostic = diagnosticFor({
    code: TABULAR_CODES.UNSUPPORTED_FORMAT,
    message: "Spreadsheet workbook: …",
  });
  assert.equal(diagnostic.recovery, UNSUPPORTED_PACKAGE.recovery);
  assert.match(diagnostic.recovery, /archive/i);
});

// --- partial, stale, malformed, reordered ----------------------------------

test("partial data imports the readable rows and locates every rejected one", () => {
  const result = parse(csv([
    ...ROWS,
    "not-a-date,Atlas,gpt-4o,1000,100,1.00,USD",
    "2026-07-25,Beacon,gpt-4o,1000,100,not-an-amount,USD",
  ]));

  assert.equal(result.ok, true);
  assert.equal(result.acceptedRows, 3);
  assert.equal(result.skippedRows, 2);
  const located = result.problems.filter((problem) => problem.row);
  assert.deepEqual(located.map((problem) => problem.code).sort(),
    [TABULAR_CODES.INVALID_AMOUNT, TABULAR_CODES.UNPARSEABLE_DATE].sort());
  // Never carrying the cell that failed — the reader is looking at their own
  // file while they read the coordinate.
  for (const problem of result.problems) {
    assert.ok(!JSON.stringify(problem).includes("not-an-amount"));
  }
  assert.match(DELIVERY_BEHAVIOUR.partial.behaviour, /readable rows import/i);
});

test("malformed data is a whole-file refusal, never a partial total", () => {
  const broken = parse(csv(['2026-07-24,"Atlas,gpt-4o,1,1,1.00,USD']));
  assert.equal(broken.ok, false);
  assert.equal(broken.parsed, null);
  assert.ok(broken.problems.length > 0);
  assert.match(DELIVERY_BEHAVIOUR.malformed.never, /No partial total/i);

  // A header with no data rows is refused on its own code, not returned empty.
  const headerOnly = parse(csv([]));
  assert.equal(headerOnly.ok, false);
  assert.ok(headerOnly.problems.some((problem) =>
    problem.code === TABULAR_CODES.EMPTY_FILE || problem.code === TABULAR_CODES.NO_USABLE_ROWS));
});

test("reordered rows change no figure, and the period still derives from the dates", () => {
  const ordered = parse(csv(ROWS));
  const shuffled = parse(csv([...ROWS].reverse()));

  assert.equal(shuffled.ok, true);
  assert.equal(shuffled.totals.amountMinor, ordered.totals.amountMinor);
  assert.equal(shuffled.parsed.document.snapshot.period_start,
    ordered.parsed.document.snapshot.period_start);
  assert.equal(shuffled.parsed.document.snapshot.period_end,
    ordered.parsed.document.snapshot.period_end);
  assert.match(DELIVERY_BEHAVIOUR.reordered.never, /never treated as chronology/i);
});

test("a stale period imports and discloses itself rather than claiming freshness", () => {
  // An older period, chosen after a newer one. It parses on the same terms and
  // carries its own dates; nothing in the envelope claims it is current.
  const stale = parse(csv([
    "2026-06-01,Atlas,gpt-4o,1000,100,1.00,USD",
    "2026-06-02,Atlas,gpt-4o,1000,100,1.00,USD",
  ]));
  assert.equal(stale.ok, true);
  assert.equal(stale.parsed.document.snapshot.period_start, "2026-06-01");
  assert.equal(stale.parsed.document.snapshot.period_end, "2026-06-03");
  // The contract says why it cannot do more than that: a CSV has no sequence.
  assert.match(DELIVERY_BEHAVIOUR.stale.behaviour, /no delivery sequence/i);
  assert.match(DELIVERY_BEHAVIOUR.duplicated.never, /never added into a total/i);
});

// --- the surface -----------------------------------------------------------

test("the import panel paints its guidance from the contract, not from the markup", async () => {
  const html = await readFile(PAGE, "utf8");
  const doc = parseHtml(html);

  const painted = applyExportPackageGuidance(doc);
  assert.equal(painted, EXPORT_PACKAGES.length);

  const list = doc.getElementById("export-package-guidance");
  const names = list.children.filter((node) => node.tagName === "DT").map((node) => textOf(node));
  assert.deepEqual(names, EXPORT_PACKAGES.map((entry) => entry.label));

  const details = list.children.filter((node) => node.tagName === "DD").map((node) => textOf(node));
  for (const term of ["Ask for:", "Arrives as:", "Accepted here:", "Take out first:"]) {
    assert.equal(details.filter((text) => text.startsWith(term)).length, EXPORT_PACKAGES.length,
      `every package should carry one “${term}” row`);
  }
  // A package with no normalizer says so where the reader is choosing a file.
  assert.equal(details.filter((text) => text.startsWith("Support:")).length,
    EXPORT_PACKAGES.filter((entry) => entry.support).length);

  const promise = doc.getElementById("export-package-promise");
  assert.equal(textOf(promise), PACKAGE_INTAKE_SENTENCE);
  assert.match(PACKAGE_INTAKE_SENTENCE, /nothing is uploaded/i);
  assert.match(PACKAGE_INTAKE_SENTENCE, /no prompt text is stored/i);

  // The markup is slots: no vendor name, console path, or format list is
  // authored into the page, so adding a package cannot leave stale copy.
  for (const entry of EXPORT_PACKAGES) {
    assert.ok(!html.includes(entry.label), `evolution.html hardcodes ${entry.label}`);
    assert.ok(!html.includes(entry.export_request.console_path));
  }
  // The panel points at the published contract for the rest.
  assert.match(html, /href="\/docs\/provider-export-package-contract\.md"/);
});

test("guidance rows are the same four questions for every package", () => {
  for (const entry of EXPORT_PACKAGES) {
    const rows = exportPackageGuidance(entry);
    assert.deepEqual(rows.map((row) => row.term),
      ["Ask for", "Arrives as", "Accepted here", "Take out first"]);
    assert.ok(rows.every((row) => row.detail.trim().length > 0));
    // Redaction guidance always names both halves: what the reader removes and
    // what the parser refuses regardless.
    assert.match(rows[3].detail, /Never read:/);
    assert.match(rows[3].detail, /Pseudonymized on read:/);
  }
  assert.deepEqual(exportPackageGuidance(null), []);
});
