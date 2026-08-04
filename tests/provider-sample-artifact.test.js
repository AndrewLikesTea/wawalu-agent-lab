// The provider samples, checked on the tree that gets served (#1067).
//
// WHAT THIS FILE IS AND IS NOT
// ----------------------------
// #1062 does not ship five static sample files. Every sample is GENERATED in the
// reader's tab: the download control hands `serializeProviderSample(provider)` to
// a local Blob under `provider.sampleFilename`, so there is no href to a file on
// the origin and no request to make. That is the design, and it is why the
// obvious check — "GET each sample href, assert 200" — has nothing to address.
//
// So the artifact this test proves exists is the one the artifact actually
// carries: the module that emits the bytes. For every provider the contract
// advertises, it asserts that module is present in the build output and
// non-empty, then emits that provider's sample FROM THE BUILT MODULE and proves
// the bytes are a real export — non-empty, parseable by the artifact's own
// recognition parser, and carrying exactly the columns the built contract told
// the reader that provider requires.
//
// It never fetches. Filesystem plus parse, on artifacts.
//
// It also never skips. `npm test` runs it against `src` for fast feedback;
// `npm run test:e2e:production` sets SHIPLOG_E2E_BUILD_ROOT=dist and runs the
// same assertions against the deployable tree. A missing root, a missing module,
// or an empty one is a failure here, not a quiet pass — the whole value of a
// build-output check is that it cannot be satisfied by not running.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const BUILD_ROOT = process.env.SHIPLOG_E2E_BUILD_ROOT || "src";
const artifact = (path) => new URL(`../${BUILD_ROOT}/${path}`, import.meta.url);

// The files that have to be in the artifact for a reader to receive a sample at
// all: the contract that emits it, the recognition source both the sample and the
// column list are derived from, and the page entry that binds the control.
const SAMPLE_MODULES = [
  "provider-readiness-contract.js",
  "export-provider-detection.js",
  "browser-compat-eligibility.js",
  "evolution-page.js",
  "evolution.html",
];

async function readArtifact(path) {
  const url = artifact(path);
  let info = null;
  try {
    info = await stat(url);
  } catch (error) {
    // Loud, and with the resolved path in it: the common cause of this failing is
    // a production run against a dist/ that was never built.
    throw new Error(`the build output has no ${path} at ${fileURLToPath(url)} `
      + `(SHIPLOG_E2E_BUILD_ROOT=${BUILD_ROOT}): ${error.code ?? error.message}`);
  }
  assert.ok(info.isFile(), `${path} must be a file in the build output`);
  assert.ok(info.size > 0, `${path} must not be empty in the build output`);
  return readFile(url, "utf8");
}

// Loaded from the BUILD ROOT, never from `../src`: importing the source copy here
// would make a production run assert on files it is not serving.
const [{ PROVIDER_READINESS, serializeProviderSample, LOCAL_PROCESSING_STATEMENT },
  { parseExportText }] = await Promise.all([
  import(artifact("provider-readiness-contract.js")),
  import(artifact("browser-compat-eligibility.js")),
]);

test("every module a provider sample is emitted from ships in the build output", async () => {
  for (const path of SAMPLE_MODULES) await readArtifact(path);
  // Present is not the same as wired: the entry has to be the thing that turns
  // the contract into a download, or the artifact carries a generator nothing
  // calls and five cards with a dead button on them.
  const entry = await readArtifact("evolution-page.js");
  for (const wiring of ["serializeProviderSample", "sampleFilename", "sampleMediaType"]) {
    assert.ok(entry.includes(wiring),
      `the built AI FinOps entry no longer hands ${wiring} to the download control`);
  }
  assert.ok(PROVIDER_READINESS.length > 0,
    "the built readiness contract must advertise at least one provider");
});

test("each advertised provider emits a non-empty sample whose columns are the contract's", () => {
  for (const provider of PROVIDER_READINESS) {
    // Resolved exactly as the page emits it: the same call, the same filename.
    const filename = provider.sampleFilename;
    const sample = serializeProviderSample(provider);
    assert.equal(typeof sample, "string", `${provider.id} must emit sample text`);
    assert.ok(sample.trim().length > 0,
      `${provider.id} is advertised but its sample artifact ${filename} is empty`);
    assert.match(filename, new RegExp(`\\.${provider.sampleFormat}$`),
      `${provider.id} must name its sample by the format it is in`);

    const parsed = parseExportText(sample, filename);
    assert.equal(parsed.ok, true,
      `${filename} must parse as ${provider.sampleFormat}: ${parsed.problem ?? "unreadable"}`);
    assert.ok(parsed.records.length > 0, `${filename} must carry at least one usage row`);

    // Parsed columns, never the header string: quoting and ordering are the
    // serializer's business, and the set is what a reader's importer reads.
    const columns = parsed.fieldNames.map(String);
    const declared = [...provider.requiredColumns, ...provider.optionalColumns];
    assert.deepEqual(provider.requiredColumns.filter((column) => !columns.includes(column)), [],
      `${filename} is missing a column the ${provider.id} card says is required`);
    assert.deepEqual(columns.filter((column) => !declared.includes(column)), [],
      `${filename} carries a column the ${provider.id} card never declared`);
  }
});

test("the built import section carries the in-browser statement from the contract", async () => {
  // The constant travels in the artifact, and the module that renders it is the
  // artifact's own. Whether it reaches the page as visible text is asserted by
  // driving the page in tests/export-check-boundary.test.js; what only a
  // build-output check can say is that the built copy still carries the words.
  assert.equal(typeof LOCAL_PROCESSING_STATEMENT, "string");
  assert.ok(LOCAL_PROCESSING_STATEMENT.trim().length > 0);
  const check = await readArtifact("finops-export-check.js");
  assert.ok(check.includes("LOCAL_PROCESSING_STATEMENT"),
    "the built export-check zone no longer renders the contract's boundary statement");
});
