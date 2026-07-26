// Contract tests for the versioned dialect-profile layer.
//
// The suite is table-driven over the registry itself, so a profile added
// without a fixture, without a changelog note, or with a mapping that does not
// reproduce its fixture fails here rather than on a reader's file.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DIALECT_PROFILES, NORMALIZED_FIELDS, assertProfileRegistry, normalizeColumnName, profileById,
} from "../src/dialect-profiles.js";
import {
  MIN_CONFIDENCE, applyDialectProfile, detectDialect, normalizeTable, scoreProfile,
} from "../src/dialect-detection.js";
import { readTable, reorderColumns, withoutColumns } from "./support/tabular.js";

const FIXTURES = new URL("../contracts/integrations/tabular-dialects/v1/fixtures/", import.meta.url);

async function fixtureText(profileId) {
  return readFile(new URL(`${profileId}.csv`, FIXTURES), "utf8");
}

async function fixtureTable(profileId) {
  return readTable(await fixtureText(profileId));
}

/**
 * Fixture in -> exact records out, asserted whole. One entry per profile; the
 * anti-drift test below fails if the registry ever grows past this map.
 */
const EXPECTED = {
  "openai-usage-export": {
    confidence: 0.875,
    records: [
      { usage_date: "2026-06-05", sku: "gpt-4o", owner_id: "atlas-platform", usage_quantity: 1840000, usage_unit: "tokens", cost_amount_minor: 41275, cost_currency: "USD" },
      { usage_date: "2026-06-05", sku: "gpt-4o-mini", owner_id: "boreal-support", usage_quantity: 920000, usage_unit: "tokens", cost_amount_minor: 3140, cost_currency: "USD" },
      { usage_date: "2026-06-06", sku: "gpt-4o", owner_id: "cinder-research", usage_quantity: 455000, usage_unit: "tokens", cost_amount_minor: 10205, cost_currency: "USD" },
    ],
  },
  "anthropic-usage-export": {
    confidence: 0.875,
    records: [
      { usage_date: "2026-06-05", sku: "claude-opus-4", owner_id: "atlas-platform", usage_quantity: 2450000, usage_unit: "tokens", cost_amount_minor: 73520, cost_currency: "USD" },
      { usage_date: "2026-06-05", sku: "claude-sonnet-4", owner_id: "boreal-support", usage_quantity: 1180000, usage_unit: "tokens", cost_amount_minor: 8860, cost_currency: "USD" },
      { usage_date: "2026-06-06", sku: "claude-haiku-3-5", owner_id: "ember-design", usage_quantity: 640000, usage_unit: "tokens", cost_amount_minor: 1285, cost_currency: "USD" },
    ],
  },
  "aws-cost-and-usage-report": {
    confidence: 1,
    records: [
      { usage_date: "2026-06-05", sku: "AmazonBedrock", owner_id: "acct-atlas", usage_quantity: 1840, usage_unit: "provider-units", cost_amount_minor: 26410, cost_currency: "USD" },
      { usage_date: "2026-06-05", sku: "AmazonS3", owner_id: "acct-boreal", usage_quantity: 412.5, usage_unit: "provider-units", cost_amount_minor: 1832, cost_currency: "USD" },
      { usage_date: "2026-06-06", sku: "AmazonS3", owner_id: "acct-cinder", usage_quantity: 96.25, usage_unit: "provider-units", cost_amount_minor: 405, cost_currency: "USD" },
    ],
  },
  "azure-cost-management-export": {
    confidence: 1,
    records: [
      { usage_date: "2026-06-05", sku: "gpt-4o Input Tokens", owner_id: "rg-atlas-platform", usage_quantity: 1420000, usage_unit: "provider-units", cost_amount_minor: 31844, cost_currency: "USD" },
      { usage_date: "2026-06-05", sku: "Hot LRS Data Stored", owner_id: "rg-boreal-support", usage_quantity: 820.5, usage_unit: "provider-units", cost_amount_minor: 1428, cost_currency: "USD" },
      { usage_date: "2026-06-12", sku: "gpt-4o Output Tokens", owner_id: "rg-cinder-research", usage_quantity: 264000, usage_unit: "provider-units", cost_amount_minor: 14290, cost_currency: "USD" },
    ],
  },
  "google-cloud-billing-export": {
    confidence: 1,
    records: [
      { usage_date: "2026-06-05", sku: "Gemini 2.0 Flash, Input Tokens", owner_id: "atlas-platform", usage_quantity: 1960000, usage_unit: "tokens", cost_amount_minor: 24415, cost_currency: "USD" },
      { usage_date: "2026-06-05", sku: "Standard Storage US", owner_id: "boreal-support", usage_quantity: 742, usage_unit: "gibibyte month", cost_amount_minor: 1806, cost_currency: "USD" },
      { usage_date: "2026-06-06", sku: "Text Embedding, Input Tokens", owner_id: "quartz-data", usage_quantity: 3120000, usage_unit: "tokens", cost_amount_minor: 3120, cost_currency: "USD" },
    ],
  },
  "generic-hris-roster": {
    confidence: 1,
    records: [
      { person_id: "emp-1001", email: "ada.fern@example.invalid", full_name: "Ada Fern", manager_id: "emp-1000", department: "Atlas Platform", status: "active" },
      { person_id: "emp-1002", email: "bo.larkin@example.invalid", full_name: "Bo Larkin", manager_id: "emp-1000", department: "Boreal Support", status: "suspended" },
      { person_id: "emp-1003", email: "cy.rowan@example.invalid", full_name: "Cy Rowan", manager_id: "emp-1001", department: "Cinder Research", status: "disabled" },
    ],
  },
};

test("the profile registry is internally consistent", () => {
  assert.doesNotThrow(() => assertProfileRegistry());
  assert.ok(DIALECT_PROFILES.length >= 6);
});

// --- the anti-drift guard --------------------------------------------------

test("every profile in the registry ships an executable fixture", async () => {
  for (const profile of DIALECT_PROFILES) {
    await assert.doesNotReject(
      () => fixtureText(profile.id),
      `ANTI-DRIFT: profile "${profile.id}" has no fixture. Every profile must ship `
        + `contracts/integrations/tabular-dialects/v1/fixtures/${profile.id}.csv — a mapping `
        + "with no vendor file behind it is a guess, not a contract.",
    );
    assert.ok(
      EXPECTED[profile.id],
      `ANTI-DRIFT: profile "${profile.id}" has no expected-record table in this suite. `
        + "Add its exact normalized records to EXPECTED so the mapping is asserted, not assumed.",
    );
  }
  assert.deepEqual(
    Object.keys(EXPECTED).sort(),
    DIALECT_PROFILES.map((profile) => profile.id).sort(),
    "ANTI-DRIFT: EXPECTED and the registry name different profiles.",
  );
});

// --- per-profile detection and normalization -------------------------------

for (const profile of DIALECT_PROFILES) {
  const expected = EXPECTED[profile.id];
  if (!expected) continue;

  test(`${profile.id} v${profile.version}: detects itself on its own fixture`, async () => {
    const detection = detectDialect(await fixtureTable(profile.id));
    assert.equal(detection.status, "matched");
    assert.equal(detection.profileId, profile.id);
    assert.equal(detection.kind, profile.kind);
    assert.equal(detection.version, profile.version);
    assert.equal(detection.confidence, expected.confidence);
    assert.ok(detection.confidence >= MIN_CONFIDENCE);
  });

  test(`${profile.id} v${profile.version}: fixture normalizes to exact records`, async () => {
    const { detection, normalized } = normalizeTable(await fixtureTable(profile.id));
    assert.equal(detection.profileId, profile.id);
    assert.deepEqual(normalized.issues, []);
    assert.deepEqual(
      normalized.records.map((record) => ({ ...record })),
      expected.records,
    );
    for (const record of normalized.records) {
      for (const field of Object.keys(record)) {
        assert.ok(NORMALIZED_FIELDS[profile.kind].includes(field), `${field} is outside the ${profile.kind} vocabulary`);
      }
    }
  });

  test(`${profile.id} v${profile.version}: reordered columns still map by name`, async () => {
    const table = await fixtureTable(profile.id);
    const reversed = reorderColumns(table, table.columns.map((_, index) => table.columns.length - 1 - index));
    const { detection, normalized } = normalizeTable(reversed);
    assert.equal(detection.profileId, profile.id, "column order must not affect detection");
    assert.equal(detection.confidence, expected.confidence);
    assert.deepEqual(normalized.records.map((record) => ({ ...record })), expected.records);
  });

  test(`${profile.id} v${profile.version}: a missing required column is never forced onto it`, async () => {
    const table = await fixtureTable(profile.id);
    const requiredColumn = table.columns.find((name) => profile.columns.some((entry) =>
      entry.required && entry.field !== null
      && [entry.source, ...entry.aliases].map(normalizeColumnName).includes(normalizeColumnName(name))));
    assert.ok(requiredColumn, "the fixture must carry at least one required column");
    const partial = withoutColumns(table, [requiredColumn]);
    assert.equal(scoreProfile(profile, partial.columns).confidence, 0);
    assert.notEqual(detectDialect(partial).profileId, profile.id);
  });
}

// --- negative paths --------------------------------------------------------

test("a file matching no profile is unidentified and keeps its columns and rows", () => {
  const table = readTable([
    "ledger_ref,posted_on,team,net_amount",
    "LR-1,2026-06-05,Atlas,412.75",
    "LR-2,2026-06-06,Boreal,88.60",
  ].join("\n"));
  const { detection, normalized } = normalizeTable(table);
  assert.equal(detection.status, "unidentified");
  assert.equal(detection.profileId, null);
  assert.equal(normalized, null);
  // The manual mapping path is unchanged: everything parsed is still here.
  assert.deepEqual(detection.columns, ["ledger_ref", "posted_on", "team", "net_amount"]);
  assert.equal(detection.rows.length, 2);
  assert.deepEqual(detection.rows[0], ["LR-1", "2026-06-05", "Atlas", "412.75"]);
  assert.deepEqual(detection.candidates, []);
  assert.match(detection.reason, /no profile/);
});

test("required columns alone fall below the confidence threshold", async () => {
  const table = await fixtureTable("openai-usage-export");
  const bare = withoutColumns(table, ["n_generated_tokens_total", "api_key_name"]);
  const score = scoreProfile(profileById("openai-usage-export"), bare.columns);
  assert.equal(score.confidence, 0.625);
  assert.ok(score.confidence < MIN_CONFIDENCE);
  const detection = detectDialect(bare);
  assert.equal(detection.status, "unidentified");
  assert.match(detection.reason, /below the 0\.7 threshold/);
  assert.deepEqual(detection.candidates.map((candidate) => candidate.profileId), ["openai-usage-export"]);
});

test("an exact tie resolves to unidentified rather than an arbitrary pick", () => {
  const entry = (source, field, required) => ({ source, aliases: [], field, coerce: "string", required, whenAbsent: null });
  const twin = (id, optionalColumn) => ({
    id, label: id, kind: "usage", version: 1, changelog: [],
    constants: {}, match: { minColumns: 2, forbidden: [] },
    columns: [entry("shared_a", "sku", true), entry("shared_b", "owner_id", true), entry(optionalColumn, null, false)],
  });
  const profiles = [twin("twin-left", "only_left"), twin("twin-right", "only_right")];
  const detection = detectDialect(
    readTable("shared_a,shared_b,only_left,only_right\nx,y,1,2"),
    profiles,
  );
  assert.equal(detection.status, "unidentified");
  assert.equal(detection.profileId, null);
  assert.equal(detection.candidates[0].confidence, detection.candidates[1].confidence);
  assert.match(detection.reason, /ambiguous between twin-left and twin-right/);
});

test("a forbidden column excludes a profile that would otherwise be a candidate", async () => {
  const table = await fixtureTable("anthropic-usage-export");
  const profile = profileById("anthropic-usage-export");
  assert.equal(scoreProfile(profile, table.columns).confidence, 0.875);
  const shadowed = { ...table, columns: [...table.columns, "usage_date"] };
  const score = scoreProfile(profile, shadowed.columns);
  assert.equal(score.confidence, 0);
  assert.match(score.reason, /excludes/);
});

// --- the match never blocks manual mapping ---------------------------------

test("a detected profile pre-maps columns and every mapping stays overridable", async () => {
  const table = await fixtureTable("openai-usage-export");
  const detection = detectDialect(table);
  const owner = detection.mapping.find((step) => step.field === "owner_id");
  assert.deepEqual(
    { column: owner.column, columnIndex: owner.columnIndex, origin: owner.origin },
    { column: "project", columnIndex: 2, origin: "column" },
  );
  assert.equal(detection.mapping.find((step) => step.field === "cost_currency").origin, "default");
  assert.equal(detection.mapping.find((step) => step.field === "usage_unit").origin, "constant");

  // The reader disagrees: owner_id comes from the API key column instead.
  const overridden = applyDialectProfile(detection.profile, table, { overrides: { owner_id: 6 } });
  assert.deepEqual(overridden.records.map((record) => record.owner_id),
    ["atlas-batch", "boreal-agent", "cinder-eval"]);

  // And a dropped required field is reported, never silently omitted.
  const dropped = applyDialectProfile(detection.profile, table, { overrides: { owner_id: null } });
  assert.deepEqual(dropped.records, []);
  // Dropping a field releases its column back to the manual mapping surface.
  assert.ok(dropped.unmappedColumns.includes("project"));
  assert.equal(dropped.issues.length, table.rows.length);
  assert.deepEqual(dropped.issues[0], {
    row: 0, column: null, field: "owner_id", code: "unmapped_field",
    message: "no column or default supplies owner_id",
  });
});

test("signal-only columns are reported as unmapped for manual review", async () => {
  const table = await fixtureTable("openai-usage-export");
  const { normalized } = normalizeTable(table);
  assert.deepEqual(normalized.unmappedColumns, ["n_generated_tokens_total", "api_key_name"]);
});

test("a row that fails coercion is isolated, not fatal", async () => {
  const table = await fixtureTable("openai-usage-export");
  const broken = { ...table, rows: [["05/06/2026", "gpt-4o", "atlas", "1000", "10", "1.00", "k"], ...table.rows] };
  const { normalized } = normalizeTable(broken);
  assert.equal(normalized.records.length, 3, "the good rows still normalize");
  assert.deepEqual(normalized.issues, [{
    row: 0, column: "usage_date", field: "usage_date", code: "invalid_value",
    message: "usage_date is not an ISO date",
  }]);
});

test("an optional column present but uncoercible still fails its row", async () => {
  // The field is declared optional as a *column* — the vendor may omit it and
  // take the default — but `cost_currency` is not an optional normalized field,
  // so a present-and-broken cell must not yield a record missing it.
  const table = await fixtureTable("azure-cost-management-export");
  const broken = { ...table, rows: table.rows.map((row, index) =>
    (index === 0 ? row.map((cell, position) => (position === 7 ? "US Dollar" : cell)) : row)) };
  const { normalized } = normalizeTable(broken);
  assert.equal(normalized.records.length, 2, "the two intact rows still normalize");
  assert.deepEqual(normalized.issues, [{
    row: 0, column: "BillingCurrency", field: "cost_currency", code: "invalid_value",
    message: "cost_currency is not a 3-letter currency code",
  }]);
});

// --- content constraints ---------------------------------------------------

// Fixtures are published as examples, so they may only ever contain invented
// organisations and totals. These rules are asserted rather than reviewed so a
// future fixture edit cannot leak something real past a reader's attention.
const FORBIDDEN_CONTENT = [
  ["a non-reserved email domain", /@(?!(?:[a-z0-9-]+\.)*(?:invalid|example|test|localhost)\b)[a-z0-9.-]+\.[a-z]{2,}/i],
  ["a long numeric account identifier", /\b\d{12,}\b/],
  ["a UUID", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ["an API key or token prefix", /\b(?:sk-|AKIA|ASIA|ghp_|xox[bap]-|Bearer\s|AIza)/],
  ["a PEM block", /-----BEGIN /],
];

const CONTENT_BEARING_COLUMNS = [
  "prompt", "completion", "message", "messages", "content", "response",
  "input_text", "output_text", "transcript",
];

test("no fixture carries customer data, credentials, or prompt content", async () => {
  for (const profile of DIALECT_PROFILES) {
    const text = await fixtureText(profile.id);
    for (const [what, pattern] of FORBIDDEN_CONTENT) {
      const found = pattern.exec(text);
      assert.equal(found, null,
        `fixture ${profile.id}.csv contains ${what} (${found?.[0]}). Fixtures are shipped as `
          + "examples and must hold invented organisations and totals only.");
    }
    const { columns } = readTable(text);
    for (const column of columns) {
      assert.ok(!CONTENT_BEARING_COLUMNS.includes(normalizeColumnName(column)),
        `fixture ${profile.id}.csv declares the content-bearing column "${column}"; `
          + "prompt and completion text never enters this repository.");
    }
  }
});

test("the forbidden-content rules actually bite", () => {
  // A rule that cannot fail protects nothing. Each pattern is shown one string
  // it must reject, so a future loosening of the rule fails here first.
  const mustReject = [
    "ada.fern@northwind-traders.com",
    "acct,123456789012,AmazonS3",
    "sub,3f2504e0-4f89-41d3-9a0c-0305e82c3301,rg",
    "key,sk-abcdef0123456789,project",
    "cert,-----BEGIN PRIVATE KEY-----,x",
  ];
  for (const sample of mustReject) {
    assert.ok(
      FORBIDDEN_CONTENT.some(([, pattern]) => pattern.test(sample)),
      `no forbidden-content rule rejects ${sample}`,
    );
  }
  for (const [, pattern] of FORBIDDEN_CONTENT) {
    assert.ok(mustReject.some((sample) => pattern.test(sample)), `${pattern} is never exercised`);
  }
});

test("every fixture email uses the reserved fake domain", async () => {
  const text = await fixtureText("generic-hris-roster");
  const emails = text.match(/[^\s,"]+@[^\s,"]+/g) ?? [];
  assert.equal(emails.length, 3);
  for (const email of emails) assert.match(email, /@example\.invalid$/);
});
