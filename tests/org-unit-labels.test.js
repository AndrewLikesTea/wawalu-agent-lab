// The one org-unit lookup: what a unit is called, where the name lives, and
// what happens when the store refuses to cooperate.
//
// The rendering tests live in model-overspend-finding-view.test.js; what is
// pinned here is the decision itself, because every render site depends on it
// giving the same answer.

import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOrgUnitLabelsToText, clearOrgUnitLabels, MAX_ORG_UNIT_LABEL_LENGTH, orgUnitDisplay,
  ORG_UNIT_LABEL_STORAGE_KEY, readOrgUnitLabels, renderOrgUnit, writeOrgUnitLabel,
} from "../src/org-unit-labels.js";
import { parseHtml } from "./support/browser.js";

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
    values,
  };
}

test("a label written in this browser is read back for that unit alone", () => {
  const store = storage();
  const labels = writeOrgUnitLabel(store, "seg-atlas", "  Payments platform  ");
  assert.deepEqual({ ...labels }, { "seg-atlas": "Payments platform" });
  assert.deepEqual({ ...readOrgUnitLabels(store) }, { "seg-atlas": "Payments platform" });
  assert.equal(orgUnitDisplay(readOrgUnitLabels(store), "seg-borealis", "Borealis Research").label,
    "Borealis Research");
});

test("an empty or whitespace label removes the alias rather than blanking the unit", () => {
  const store = storage();
  writeOrgUnitLabel(store, "4f2a", "Payments");
  const after = writeOrgUnitLabel(store, "4f2a", "   ");
  assert.deepEqual({ ...after }, {});
  // No analysis name for this unit, so what comes back is the identifier the
  // export carried — never an empty cell.
  assert.equal(orgUnitDisplay(after, "4f2a", null).label, "4f2a");
  assert.equal(orgUnitDisplay(after, "4f2a", "Ops").label, "Ops");
});

test("an unknown id renders as itself, and a nameless unrenamed unit as its identifier", () => {
  const display = orgUnitDisplay({}, "cost-centre-9917", null);
  assert.equal(display.label, "cost-centre-9917");
  assert.equal(display.renamed, false);
  assert.equal(display.secondary, null);
});

test("the raw identifier stays discoverable once the unit is renamed", () => {
  const display = orgUnitDisplay({ "seg-atlas": "Payments" }, "seg-atlas", "Atlas Platform");
  assert.equal(display.label, "Payments");
  assert.equal(display.secondary, "seg-atlas");
  const doc = parseHtml("<!doctype html><html><body></body></html>");
  const node = renderOrgUnit(doc, display);
  assert.equal(node.dataset.orgUnitId, "seg-atlas");
  assert.equal(node.dataset.renamed, "true");
  assert.match(node.title, /seg-atlas/);
  assert.match(node.textContent, /Payments/);
  assert.match(node.textContent, /seg-atlas/);
});

test("a label longer than the ceiling, or a store holding junk, yields no alias", () => {
  const store = storage();
  writeOrgUnitLabel(store, "seg-atlas", "x".repeat(MAX_ORG_UNIT_LABEL_LENGTH + 1));
  assert.deepEqual({ ...readOrgUnitLabels(store) }, {});
  for (const junk of ["not json", "[1,2]", JSON.stringify({ "seg-a": 7 }), JSON.stringify(null)]) {
    store.values.set(ORG_UNIT_LABEL_STORAGE_KEY, junk);
    assert.deepEqual({ ...readOrgUnitLabels(store) }, {}, junk);
  }
});

test("a store that throws costs the alias, never the render", () => {
  const hostile = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  assert.deepEqual({ ...readOrgUnitLabels(hostile) }, {});
  assert.deepEqual({ ...writeOrgUnitLabel(hostile, "seg-atlas", "Payments") }, {});
  assert.deepEqual({ ...clearOrgUnitLabels(hostile) }, {});
  assert.deepEqual({ ...readOrgUnitLabels(undefined) }, {});
  assert.equal(orgUnitDisplay(readOrgUnitLabels(hostile), "seg-atlas", "Atlas Platform").label,
    "Atlas Platform");
});

test("clearing drops every alias through the one storage key", () => {
  const store = storage();
  writeOrgUnitLabel(store, "seg-atlas", "Payments");
  writeOrgUnitLabel(store, "seg-borealis", "Research");
  assert.equal(store.values.size, 1);
  clearOrgUnitLabels(store);
  assert.equal(store.values.has(ORG_UNIT_LABEL_STORAGE_KEY), false);
  assert.deepEqual({ ...readOrgUnitLabels(store) }, {});
});

test("contract prose picks up an alias, and only for a unit that was renamed", () => {
  const units = [
    { id: "seg-atlas", analysisLabel: "Atlas Platform" },
    { id: "seg-borealis", analysisLabel: "Borealis Research" },
  ];
  const text = "Atlas Platform spent 8000.00 USD; Borealis Research spent 3600.00 USD.";
  assert.equal(applyOrgUnitLabelsToText(text, {}, units), text);
  assert.equal(
    applyOrgUnitLabelsToText(text, { "seg-atlas": "Payments" }, units),
    "Payments spent 8000.00 USD; Borealis Research spent 3600.00 USD.",
  );
  // A one-character analysis name is never substituted: it would chew through
  // unrelated words in a sentence this UI did not write.
  assert.equal(
    applyOrgUnitLabelsToText("A spent money on a model.", { a: "Payments" },
      [{ id: "a", analysisLabel: "A" }]),
    "A spent money on a model.",
  );
});
