// Synthetic, in-process fixtures for the import execution paths.
//
// Nothing large is committed: the biggest export any test uses is generated
// here, deterministically, from the reviewed v1 fixtures. The generator only
// varies fields the contract declares — it never invents a shape the shipped
// validator would have to be relaxed to accept.

import { readFile } from "node:fs/promises";

const FIXTURES = new URL("../../contracts/integrations/", import.meta.url);

export async function contractFixture(path) {
  return JSON.parse(await readFile(new URL(path, FIXTURES), "utf8"));
}

export const validProvider = () => contractFixture("provider-usage-billing/v1/fixtures/valid.json");
export const validHris = () => contractFixture("hris-org/v1/fixtures/valid.json");

/** A `File` over UTF-8 JSON, the same object the file input hands the runner. */
export function jsonFile(document, name = "export.json") {
  return new File([JSON.stringify(document)], name, { type: "application/json" });
}

const PROVIDERS = ["openai", "anthropic", "google", "aws", "azure"];
const CATEGORIES = ["text-generation", "image-generation", "embedding", "storage"];

/**
 * A provider export with `rows` records spread over `units` org units. Amounts,
 * providers, and categories cycle deterministically, so two runs of the same
 * call produce byte-identical JSON and therefore identical aggregates.
 */
export function syntheticProvider(base, { rows, units = 24, exportId }) {
  const records = [];
  for (let index = 0; index < rows; index += 1) {
    records.push({
      aggregate_id: `psn_synthetic_aggregate_${String(index).padStart(9, "0")}`,
      revision: 1,
      usage_date: base.snapshot.period_start,
      org_unit_id: `psn_unit_demo_${String((index % units) + 1).padStart(8, "0")}`,
      provider: PROVIDERS[index % PROVIDERS.length],
      service_category: CATEGORIES[index % CATEGORIES.length],
      usage: { quantity: 1000 + (index % 997), unit: "tokens" },
      cost: { amount_minor: 100 + (index % 8191), currency: "USD", status: "final" },
    });
  }
  return {
    ...base,
    export_id: exportId ?? base.export_id,
    snapshot: { ...base.snapshot, issues: [] },
    records,
  };
}

/** An HRIS roster covering the units `syntheticProvider` attributes spend to. */
export function syntheticHris(base, { units = 24 } = {}) {
  const records = [{
    unit_id: "psn_unit_demo_00000001",
    revision: 1,
    operation: "upsert",
    effective_at: base.snapshot.generated_at,
    parent_unit_id: null,
    unit_type: "company",
    active: true,
  }];
  for (let index = 2; index <= units; index += 1) {
    records.push({
      unit_id: `psn_unit_demo_${String(index).padStart(8, "0")}`,
      revision: 1,
      operation: "upsert",
      effective_at: base.snapshot.generated_at,
      parent_unit_id: "psn_unit_demo_00000001",
      unit_type: "department",
      active: true,
    });
  }
  return { ...base, records };
}

/**
 * An in-process stand-in for a Web Worker: the same `addEventListener` /
 * `postMessage` / `terminate` surface, delivering messages asynchronously, and
 * driven by the real worker module so the contract under test is the shipped
 * one rather than a copy of it.
 */
let instances = 0;

export async function fakeWorkerFactory({ failBeforeSpeaking = false, dieAfterFirstMessage = false } = {}) {
  // The worker module registers its listener on `self` at import time.
  const listeners = { message: [], error: [], messageerror: [] };
  const host = {
    addEventListener(type, handler) { (listeners[type] ??= []).push(handler); },
    postMessage: null,
  };
  const previousSelf = globalThis.self;
  globalThis.self = host;
  try {
    // A fresh module instance per stand-in: the registry would otherwise hand
    // back the first evaluation, whose listener is bound to a stale `self`.
    instances += 1;
    await import(`../../src/finops-import-worker.js?instance=${instances}`);
  } finally {
    globalThis.self = previousSelf;
  }
  const workerListener = listeners.message.at(-1);

  return () => {
    const client = { message: [], error: [], messageerror: [] };
    let dead = false;
    let spoke = false;
    const worker = {
      addEventListener(type, handler) { (client[type] ??= []).push(handler); },
      terminate() { dead = true; },
      postMessage(data) {
        if (dead) return;
        if (failBeforeSpeaking) {
          queueMicrotask(() => { for (const handler of client.error) handler(new Error("boom")); });
          return;
        }
        host.postMessage = (message) => {
          if (dead) return;
          if (dieAfterFirstMessage && spoke) {
            dead = true;
            for (const handler of client.error) handler(new Error("boom"));
            return;
          }
          spoke = true;
          for (const handler of client.message) handler({ data: message });
        };
        queueMicrotask(() => workerListener({ data }));
      },
    };
    return worker;
  };
}
