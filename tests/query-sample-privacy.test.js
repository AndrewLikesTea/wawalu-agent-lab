// The positive privacy assertion.
//
// A test that checks "the result has no `excerpt` key" proves nothing: a leak
// arrives under a different name, nested, or concatenated into a sentence. So
// this runs the whole cycle — import, classify, join, score, benchmark, export —
// with excerpts that each carry a unique sentinel, and then asserts the sentinel
// appears in nothing: no value at any depth of any result, no export payload, no
// storage write, no outbound request.
//
// Storage and network are trapped rather than mocked. Every plausible egress in
// a browser realm is installed as a recorder before the cycle runs, so "no
// outbound request" is observed rather than assumed from the absence of an
// import statement.

import assert from "node:assert/strict";
import test from "node:test";
import {
  localFinopsJsonExport, localFinopsMeetingSummary, normalizeLocalFinopsHistory,
} from "../src/local-finops.js";
import { ingestQuerySample } from "../src/query-sample.js";

const SENTINEL = "ZQX7-PROMPT-LEAK-CANARY-4417";
const UNITS = ["psn_unit_a", "psn_unit_b", "psn_unit_c"];
const MODEL = { psn_unit_a: "gpt-4o", psn_unit_b: "claude-sonnet-4", psn_unit_c: "gpt-4o-mini" };
const BODY = {
  psn_unit_a: "Context: the ledger reconciliation fails. Requirements: idempotent. Expected output: a patch.",
  psn_unit_b: "still not working, try again",
  psn_unit_c: "give me a recipe for a birthday dinner",
};

function sampleRows() {
  return UNITS.flatMap((unit) => Array.from({ length: 6 }, (unused, index) => ({
    department: unit,
    model: MODEL[unit],
    timestamp: `2026-07-0${index + 1}T09:00:00Z`,
    // Every excerpt carries the sentinel, so any survival anywhere is a hit.
    excerpt: `${BODY[unit]} ${SENTINEL}-${unit}-${index}`,
  })));
}

function providerDocument(exportId, periodStart, periodEnd) {
  return {
    schema_version: "1.1",
    kind: "wawalu.integration.provider-usage-billing",
    export_id: exportId,
    snapshot: {
      source_instance_id: "psn_source_privacy_0001",
      sequence: 0,
      generated_at: `${periodStart}T00:00:00Z`,
      period_start: periodStart,
      period_end: periodEnd,
      completeness: "complete",
      omitted_record_count: 0,
      issues: [],
    },
    privacy: {
      aggregation: "daily-org-unit-service",
      minimum_group_size: 10,
      direct_identifiers_included: false,
      content_included: false,
    },
    records: UNITS.map((unit, index) => ({
      aggregate_id: `psn_agg_${exportId}_${index}`,
      revision: 0,
      usage_date: periodStart,
      org_unit_id: unit,
      provider: "openai",
      service_category: "text-generation",
      usage: { quantity: 100_000, unit: "tokens" },
      cost: { amount_minor: 4000 - index * 500, currency: "USD", status: "final" },
      model_raw: MODEL[unit],
      model_tier: null,
      request_count: 100,
      input_tokens: 90_000,
      output_tokens: 10_000,
    })),
  };
}

const HRIS = {
  schema_version: "1.0",
  kind: "wawalu.integration.hris-org",
  export_id: "psn_hris_privacy_0001",
  snapshot: { completeness: "complete", issues: [] },
  privacy: {
    identifier_method: "hmac-sha256-truncated",
    direct_identifiers_included: false,
    salt_scope: "tenant-integration-v1",
  },
  records: UNITS.map((unit) => ({
    unit_id: unit, revision: 0, operation: "upsert",
    effective_at: "2026-06-01T00:00:00Z", parent_unit_id: null,
    unit_type: "department", active: true,
  })),
};

/** Install a recorder over every egress a browser realm would offer. */
function trapEgress() {
  const writes = [];
  const requests = [];
  const store = () => ({
    setItem: (key, value) => writes.push(`${key}=${value}`),
    getItem: () => null,
    removeItem: () => {},
    key: () => null,
    clear: () => {},
    length: 0,
  });
  const traps = {
    localStorage: store(),
    sessionStorage: store(),
    indexedDB: { open: (...args) => { writes.push(JSON.stringify(args)); return {}; } },
    fetch: (...args) => { requests.push(JSON.stringify(args)); return Promise.resolve({}); },
    XMLHttpRequest: class { open(...a) { requests.push(JSON.stringify(a)); } send(b) { requests.push(String(b)); } },
    WebSocket: class { constructor(...a) { requests.push(JSON.stringify(a)); } },
    navigator: { sendBeacon: (...a) => { requests.push(JSON.stringify(a)); return true; } },
  };
  const restore = [];
  for (const [name, value] of Object.entries(traps)) {
    const had = Object.getOwnPropertyDescriptor(globalThis, name);
    restore.push([name, had]);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  return {
    writes,
    requests,
    release() {
      for (const [name, descriptor] of restore) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

/** Every string reachable from a value, at any depth, keys included. */
function allStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const entry of value) allStrings(entry, out);
  else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      out.push(key);
      allStrings(entry, out);
    }
  }
  return out;
}

test("a full import to export cycle leaks no excerpt to storage, output, or network", async () => {
  const trap = trapEgress();
  let result;
  let json;
  let summary;
  try {
    const rows = sampleRows();
    const sample = await ingestQuerySample(rows, { chunkRows: 5 });
    assert.equal(sample.counts.total, 18);
    assert.equal(sample.counts.classified, 18, "the cycle really did classify the excerpts");

    result = normalizeLocalFinopsHistory({
      providers: [
        { document: providerDocument("psn_export_0001", "2026-06-01", "2026-07-01") },
        { document: providerDocument("psn_export_0002", "2026-07-01", "2026-08-01"), querySample: sample },
      ],
      hris: { document: HRIS },
    });
    json = localFinopsJsonExport(result);
    summary = localFinopsMeetingSummary(result);
  } finally {
    trap.release();
  }

  // The cycle produced real grades — otherwise this test would pass by doing
  // nothing at all.
  assert.equal(result.benchmark.eligible, true);
  assert.equal(result.benchmark.cohort.size, 3);
  const graded = result.decisionInputs.departmentComparisons
    .filter((entry) => entry.performance.eligible);
  assert.equal(graded.length, 3);
  assert.ok(graded.every((entry) => Number.isFinite(entry.performance.score)));

  // Nothing was written and nothing was sent, sentinel or otherwise.
  assert.deepEqual(trap.writes, []);
  assert.deepEqual(trap.requests, []);

  // The sentinel survives nowhere: not in the result at any depth, not in either
  // export payload, and not in a key name.
  for (const string of allStrings(result)) {
    assert.ok(!string.includes(SENTINEL), `sentinel found in result: ${string.slice(0, 80)}`);
  }
  assert.ok(!json.includes(SENTINEL));
  assert.ok(!summary.includes(SENTINEL));
  // Nor does any other fragment of an excerpt, under any field name.
  for (const fragment of ["reconciliation fails", "still not working", "recipe"]) {
    assert.ok(!json.includes(fragment), `excerpt fragment leaked: ${fragment}`);
    assert.ok(!summary.includes(fragment));
  }
});

test("the sentinel test would fail if an excerpt did survive", () => {
  // Guards the guard: `allStrings` really does reach nested and keyed values, so
  // a green run above means absence rather than a search that looked nowhere.
  const planted = { a: [{ b: { c: `text ${SENTINEL}` } }] };
  assert.ok(allStrings(planted).some((entry) => entry.includes(SENTINEL)));
  assert.ok(allStrings({ [`k${SENTINEL}`]: 1 }).some((entry) => entry.includes(SENTINEL)));
});
