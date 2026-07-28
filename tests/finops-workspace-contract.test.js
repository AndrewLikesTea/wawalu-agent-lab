import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateRetainedCommitment } from "../src/finops-workspace.js";
import {
  FINOPS_COMMITMENT_ENVELOPE_FIELDS,
  FINOPS_COMMITMENT_PROVENANCE_FIELDS,
  FINOPS_CONSENT_FIELDS,
  FINOPS_LABELS_KEY,
  FINOPS_META_FIELDS,
  FINOPS_PERIOD_FIELDS,
  FINOPS_PROHIBITED_CLASSES,
  FINOPS_WORKSPACE_FIELDS,
  FINOPS_WORKSPACE_KEY,
  FINOPS_WORKSPACE_VERSION,
  SAMPLE_FINOPS_WORKSPACE,
  serializeFinopsWorkspacePreview,
} from "../src/finops-workspace-contract.js";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const PAGE = new URL("../src/workspace.html", import.meta.url);


test("the normative preview is a valid, closed contract fixture", () => {
  assert.equal(SAMPLE_FINOPS_WORKSPACE.schemaVersion, FINOPS_WORKSPACE_VERSION);
  assert.deepEqual(Object.keys(SAMPLE_FINOPS_WORKSPACE).sort(), [...FINOPS_WORKSPACE_FIELDS].sort());
  assert.deepEqual(Object.keys(SAMPLE_FINOPS_WORKSPACE.consent).sort(), [...FINOPS_CONSENT_FIELDS].sort());
  assert.deepEqual(Object.keys(SAMPLE_FINOPS_WORKSPACE.meta).sort(), [...FINOPS_META_FIELDS].sort());

  const period = SAMPLE_FINOPS_WORKSPACE.periods[0];
  assert.ok(Object.keys(period).every((key) => FINOPS_PERIOD_FIELDS.includes(key)));
  assert.equal(period.coverageRatioPpm,
    Math.round(period.recordsAnalyzed / period.recordsTotal * 1_000_000));

  const commitment = SAMPLE_FINOPS_WORKSPACE.commitments[0];
  assert.ok(Object.keys(commitment).every((key) => FINOPS_COMMITMENT_ENVELOPE_FIELDS.includes(key)));
  // Graded against the store's own validator, not the decision block's: a
  // retained commitment carries a deliberately narrower provenance than the
  // Shiplog decision it was recorded as, because source-row identifiers are a
  // prohibited class here and are what the 1.0.0 → 1.1.0 migration removes.
  assert.deepEqual(validateRetainedCommitment(commitment).errors, []);
  assert.deepEqual(
    Object.keys(commitment.provenance).sort(),
    [...FINOPS_COMMITMENT_PROVENANCE_FIELDS].sort(),
  );

  assert.deepEqual(JSON.parse(serializeFinopsWorkspacePreview()), SAMPLE_FINOPS_WORKSPACE);
});

test("the executable contract and its sample contain no transport or prohibited content", async () => {
  const source = await readFile(
    new URL("../src/finops-workspace-contract.js", import.meta.url), "utf8",
  );
  for (const transport of ["fetch(", "XMLHttpRequest", "sendBeacon", "document.cookie", "indexedDB"]) {
    assert.doesNotMatch(source, new RegExp(transport.replace("(", "\\(")));
  }
  assert.equal(FINOPS_PROHIBITED_CLASSES.length, 4);
  assert.doesNotMatch(serializeFinopsWorkspacePreview(), /apiKey|token|prompt|filename|endpoint/i);
});

test("the shipped workspace consumes the contract as an inspectable, non-consenting preview", async () => {
  const page = await loadPage(PAGE);
  await importPageModule("/local-workspace-page.js");
  await waitFor(
    () => textOf(page.document.querySelector("#finops-preview-json")).startsWith("{"),
    "the FinOps contract preview",
  );
  try {
    const preview = page.document.querySelector("#finops-workspace-preview");
    assert.match(textOf(preview), new RegExp(FINOPS_WORKSPACE_VERSION.replaceAll(".", "\\.")));
    assert.match(textOf(preview), new RegExp(FINOPS_WORKSPACE_KEY.replaceAll(".", "\\.")));
    assert.match(textOf(preview), new RegExp(FINOPS_LABELS_KEY.replaceAll(".", "\\.")));
    assert.match(textOf(preview), /Previewing it grants no consent and writes nothing/);
    assert.equal(page.storage.getItem(FINOPS_WORKSPACE_KEY), null);
    assert.equal(page.storage.getItem(FINOPS_LABELS_KEY), null);
  } finally {
    page.restore();
  }
});
