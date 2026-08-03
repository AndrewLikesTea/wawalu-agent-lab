// A corrected, derived brief survives the round trip through its own JSON file.
//
// THE FAULT THIS PINS. The briefing file used to carry the figures and leave the
// words behind: reopen one and every unit came back as `Department …atlas0`,
// because the readable name was derived from a column in a CSV the file does not
// contain — and a name the reader had corrected was gone with it. A brief that
// cannot say what its own units are called, or that a name was derived and then
// corrected, is not self-sufficient.
//
// WHAT IS REAL HERE. Everything on the path under test: the shipped delimited
// reader, the shipped analysis, the shipped naming derivation, the shipped
// correction call the name field makes, the shipped writer, the shipped reader,
// and the shipped render into the markup out of src/evolution.html. The only
// hand-authored thing is the CSV, which is what a reader drops.
//
// Assertions are on counts, text and attributes. Never on element identity, and
// never through a descendant selector — the harness rejects both.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHtml, textOf } from "./support/browser.js";
import { parseDelimitedFinopsFile } from "../src/finops-tabular-import.js";
import { deriveOrgUnitNames } from "../src/finops-export-unit-names.js";
import { normalizeLocalFinops, localFinopsJsonExport } from "../src/local-finops.js";
import { buildFinopsBriefing } from "../src/finops-briefing-contract.js";
import { withOrgUnitDisplayLabel, NO_ORG_UNIT_LABELS } from "../src/org-unit-display-label.js";
import {
  BRIEFING_EXPORT_SCHEMA_VERSION, briefingFile, buildBriefing,
} from "../src/finops-briefing-export.js";
import {
  NAMING_PROVENANCE_ABSENT_NOTE, parseSavedBriefing, savedExportSchemaVersion,
} from "../src/finops-briefing-restore.js";
import { applyBriefing, applyRestoredBriefing, briefingLines } from "../src/local-import-flow.js";
import {
  BRIEFING_RETENTION_KEY, forgetRetainedBriefing, readRetainedBriefing, retainedBriefingPayload,
  writeRetainedBriefing,
} from "../src/finops-briefing-retention.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

/** A fresh document every time: a restore is only a restore into a clean state. */
async function freshPage() {
  return parseHtml(await readFile(PAGE, "utf8"));
}

// Fixed, because a fixture that reads the clock grades a different brief
// tomorrow. Same reason `exportedAt` below is a constant.
const GENERATED_AT = "2026-07-26T09:00:00.000Z";
const EXPORTED_AT = "2026-07-26T09:30:00.000Z";

// One month of one provider's billing export, naming its teams in a `project`
// column — the first file a finance lead drops, and the case the naming
// derivation exists for.
const EXPORT_CSV = [
  "date,project_name,model,n_context_tokens_total,n_generated_tokens_total,amount,currency",
  "2026-06-02,Atlas Platform,gpt-4o,1840000,214000,412.75,USD",
  "2026-06-05,Atlas Platform,gpt-4o,1620000,198000,366.40,USD",
  "2026-06-09,Boreal Support,gpt-4o,910000,102000,204.15,USD",
  "2026-06-14,Atlas Platform,gpt-4o,1240000,151000,281.60,USD",
  "2026-06-18,Boreal Support,gpt-4o-mini,880000,74000,28.90,USD",
  "2026-06-23,Cinder Research,gpt-4o,540000,66000,121.05,USD",
  "",
].join("\n");

/**
 * The reader drops the file: parsed, analyzed, and named from its own labels.
 *
 * The naming derivation takes header-keyed row objects — the same projection
 * `rowObjects()` on the page makes out of a reading — so the fixture's own rows
 * are keyed here rather than reaching into the parser's internal shape.
 */
function importTheExport() {
  const parsed = parseDelimitedFinopsFile(EXPORT_CSV, "june-2026-billing.csv", {
    generatedAt: GENERATED_AT,
  });
  assert.equal(parsed.ok, true, "the fixture must parse as an ordinary provider export");
  const result = normalizeLocalFinops({ provider: parsed.parsed });
  const [header, ...body] = EXPORT_CSV.trim().split("\n");
  const columns = header.split(",");
  const naming = deriveOrgUnitNames({
    columns,
    rows: body.map((line) => Object.fromEntries(
      line.split(",").map((cell, index) => [columns[index], cell]))),
    unitColumn: "project_name",
  });
  return { naming, result };
}

test("the fixture import derives a name for every unit, from the export's own column", () => {
  const { naming } = importTheExport();
  assert.equal(naming.available, true);
  assert.equal(naming.unitCount, 3);
  assert.equal(naming.derivedCount, 3);
  assert.deepEqual([...naming.sources], ["project_name"]);
  assert.deepEqual([...naming.units].map((unit) => unit.name).sort(),
    ["Atlas Platform", "Boreal Support", "Cinder Research"]);
});

test("a derived name corrected by a reader reopens as derived-and-corrected", async () => {
  const { naming, result } = importTheExport();
  const briefing = buildFinopsBriefing(result);

  // The correction, through the call the name field in the drill-down makes.
  const corrected = [...naming.units].find((unit) => unit.name === "Atlas Platform");
  assert.ok(corrected, "the fixture must derive the name this test corrects");
  const readerLabels = withOrgUnitDisplayLabel(
    NO_ORG_UNIT_LABELS, corrected.unitId, "Platform Engineering");

  // WHAT WAS ON SCREEN BEFORE THE EXPORT. The live brief, rendered through the
  // shipped painter into the shipped markup.
  const live = await freshPage();
  applyBriefing(live, briefing);
  const before = {
    coverage: textOf(live.getElementById("local-lead-coverage")),
    derived: textOf(live.getElementById("local-lead-derived")),
    grade: live.getElementById("local-lead-grade").dataset.confidence,
    gradeValue: textOf(live.getElementById("local-lead-grade-value")),
    question: textOf(live.getElementById("local-lead-question")),
  };
  assert.match(before.question, /\S/);
  assert.match(before.derived, /derived here rather than supplied by your files/);

  // THE FILE. Written by the shipped writer, with the naming and the correction
  // the page is holding.
  const file = briefingFile(result, {
    dataset: "user", exportedAt: EXPORTED_AT, readerLabels, unitNaming: naming,
  });
  const payload = JSON.parse(file.text);
  assert.equal(payload.exportSchemaVersion, BRIEFING_EXPORT_SCHEMA_VERSION);
  // The confidence the sentence is computed from travels in the contract's own
  // object rather than in a second copy under a second name.
  assert.equal(payload.briefing.coverage.provenance.score,
    briefing.coverage.provenance.score);
  assert.deepEqual([...payload.briefing.coverage.provenance.derived],
    [...briefing.coverage.provenance.derived]);

  // REOPENED, IN A FRESH STATE. Nothing of the import above is in scope for the
  // reader: it gets the file's bytes and nothing else.
  const outcome = parseSavedBriefing(file.text);
  assert.equal(outcome.ok, true, `the written file must reopen, got ${outcome.code}`);
  const saved = outcome.saved;
  assert.equal(saved.exportSchemaVersion, BRIEFING_EXPORT_SCHEMA_VERSION);
  assert.equal(saved.unitNaming.provenanceAvailable, true);
  assert.equal(saved.unitNaming.unitCount, 3);
  assert.equal(saved.unitNaming.correctedCount, 1);
  // The corrected unit keeps BOTH names: the one the export was read as, and the
  // one the reader typed. Collapsing to the second is the defect.
  const restoredUnit = saved.unitNaming.units.find((unit) => unit.unitId === corrected.unitId);
  assert.equal(restoredUnit.derived, true);
  assert.equal(restoredUnit.derivedName, "Atlas Platform");
  assert.equal(restoredUnit.sourceColumn, "project_name");
  assert.equal(restoredUnit.correction.name, "Platform Engineering");
  assert.equal(restoredUnit.correction.replacedDerivedName, "Atlas Platform");
  assert.equal(saved.unitLabels[corrected.unitId], "Platform Engineering");

  // RENDERED, into a document that has never seen the live analysis.
  const reopened = await freshPage();
  applyRestoredBriefing(reopened, { saved, delta: null });
  const section = reopened.getElementById("restored-briefing");
  assert.equal(section.hidden, false);
  assert.equal(section.dataset.exportSchemaVersion, String(BRIEFING_EXPORT_SCHEMA_VERSION));

  // The four values that must match what was on screen before the export.
  const lines = briefingLines(saved.briefing);
  assert.equal(textOf(reopened.getElementById("restored-briefing-question")), before.question);
  assert.equal(textOf(reopened.getElementById("restored-briefing-coverage")), before.coverage);
  assert.equal(textOf(reopened.getElementById("restored-briefing-derived")), before.derived);
  assert.equal(lines.grade.level, before.grade);
  assert.equal(lines.grade.value, before.gradeValue);

  // And the correction attribution, as text and as an attribute.
  const list = reopened.getElementById("restored-briefing-names");
  assert.equal(list.hidden, false);
  assert.equal(list.dataset.count, "3");
  assert.equal(list.children.length, 3);
  const items = [...list.children];
  const correctedItem = items.find((item) => item.dataset.unitId === corrected.unitId);
  assert.ok(correctedItem, "the corrected unit must have a line of its own");
  assert.equal(correctedItem.dataset.provenance, "corrected");
  assert.equal(correctedItem.dataset.sourceField, "project");
  assert.match(textOf(correctedItem),
    /“Atlas Platform”, derived from this export's “project_name” column, then corrected by a reader to “Platform Engineering”\./);
  // The two units nobody corrected still say where their names came from.
  assert.equal(items.filter((item) => item.dataset.provenance === "derived").length, 2);
  const naminghLine = reopened.getElementById("restored-briefing-naming");
  assert.equal(naminghLine.hidden, false);
  assert.equal(naminghLine.dataset.corrected, "1");
  assert.equal(naminghLine.dataset.derived, "3");
  assert.match(textOf(reopened.getElementById("restored-briefing-naming-contract")),
    /Recognized name columns, in precedence order/);
  // Nothing claims this file lacks provenance, because it does not.
  assert.equal(reopened.getElementById("restored-briefing-naming-note").hidden, true);
});

test("two exports of one corrected brief are the same bytes", () => {
  const { naming, result } = importTheExport();
  const readerLabels = withOrgUnitDisplayLabel(
    NO_ORG_UNIT_LABELS, [...naming.units][0].unitId, "Platform Engineering");
  const options = { dataset: "user", exportedAt: EXPORTED_AT, readerLabels, unitNaming: naming };
  assert.equal(briefingFile(result, options).text, briefingFile(result, options).text);
});

test("a name the briefing contract forbids is withheld, and the file is still written", () => {
  const { naming, result } = importTheExport();
  const unit = [...naming.units][0];
  // A project label that reads as an address. Refusing the whole briefing over
  // one odd cell would cost the reader their brief for a name they did not pick.
  const payload = buildBriefing(result, {
    dataset: "user",
    exportedAt: EXPORTED_AT,
    readerLabels: { [unit.unitId]: "billing@example.com" },
    unitNaming: naming,
  });
  const written = payload.unitNaming.units.find((entry) => entry.unitId === unit.unitId);
  assert.equal(written.correction, null, "an address-shaped correction is not written");
  assert.equal(written.derivedName, unit.name, "the derived name it replaced still is");
  assert.equal(payload.unitNaming.correctedCount, 0);
});

test("a briefing written before this change reopens complete, and says it lacks provenance", async () => {
  // The legacy writer, which is what produced every file already on a reader's
  // disk: no schema version, no naming block, no provenance.
  const { result } = importTheExport();
  const legacy = localFinopsJsonExport(result);
  const raw = JSON.parse(legacy);
  assert.equal(raw.exportSchemaVersion, undefined, "the legacy file carries no version");
  assert.equal(raw.unitNaming, undefined, "and no naming");
  assert.equal(savedExportSchemaVersion(raw), 0, "a missing version reads as version 0");

  const outcome = parseSavedBriefing(legacy);
  assert.equal(outcome.ok, true, `a legacy briefing must still open, got ${outcome.code}`);
  const saved = outcome.saved;
  assert.equal(saved.exportSchemaVersion, 0);
  assert.equal(saved.unitNaming.provenanceAvailable, false);
  assert.equal(saved.unitNaming.unitCount, 0);
  assert.deepEqual(saved.unitLabels, {});

  const doc = await freshPage();
  applyRestoredBriefing(doc, { saved, delta: null });
  // COMPLETE. Every slot the brief is read from holds text, none of it blank.
  for (const id of ["captured", "question", "metric", "coverage", "derived", "action"]) {
    assert.match(textOf(doc.getElementById(`restored-briefing-${id}`)), /\S/,
      `restored-briefing-${id} must not be blank for a legacy file`);
  }
  assert.equal(doc.getElementById("restored-briefing").dataset.exportSchemaVersion, "0");
  // LABELLED. Visible text in the brief, in plain words.
  const note = doc.getElementById("restored-briefing-naming-note");
  assert.equal(note.hidden, false);
  assert.equal(textOf(note), NAMING_PROVENANCE_ABSENT_NOTE);
  assert.match(textOf(note), /carries no name provenance/);
  // And nothing is invented to fill the gap.
  assert.equal(doc.getElementById("restored-briefing-names").dataset.count, "0");
  assert.equal(doc.getElementById("restored-briefing-names").hidden, true);
  assert.equal(doc.getElementById("restored-briefing-naming").hidden, true);
});

test("a file claiming a version this build does not know takes the legacy branch", () => {
  const { naming, result } = importTheExport();
  const raw = JSON.parse(briefingFile(result, {
    dataset: "user", exportedAt: EXPORTED_AT, unitNaming: naming,
  }).text);
  raw.exportSchemaVersion = BRIEFING_EXPORT_SCHEMA_VERSION + 1;
  const outcome = parseSavedBriefing(JSON.stringify(raw));
  assert.equal(outcome.ok, true, "a newer briefing is still a briefing");
  // The naming is not read under rules this build is guessing at, and the reader
  // is told so rather than shown a silently empty list.
  assert.equal(outcome.saved.unitNaming.provenanceAvailable, false);
  assert.equal(outcome.saved.unitNaming.note, NAMING_PROVENANCE_ABSENT_NOTE);
});

test("closing a reopened brief takes its names, its provenance and its note with it", async () => {
  const { naming, result } = importTheExport();
  const readerLabels = withOrgUnitDisplayLabel(
    NO_ORG_UNIT_LABELS, [...naming.units][0].unitId, "Platform Engineering");
  const doc = await freshPage();
  const outcome = parseSavedBriefing(briefingFile(result, {
    dataset: "user", exportedAt: EXPORTED_AT, readerLabels, unitNaming: naming,
  }).text);
  applyRestoredBriefing(doc, { saved: outcome.saved, delta: null });
  applyRestoredBriefing(doc, null);

  assert.equal(doc.getElementById("restored-briefing").hidden, true);
  for (const id of ["derived", "naming", "naming-contract", "naming-note"]) {
    const slot = doc.getElementById(`restored-briefing-${id}`);
    assert.equal(slot.textContent, "", `restored-briefing-${id} still holds text after closing`);
    assert.equal(slot.hidden, true);
  }
  const list = doc.getElementById("restored-briefing-names");
  assert.equal(list.children.length, 0);
  assert.equal(list.dataset.count, "0");
  assert.equal(list.hidden, true);
});

// ---------------------------------------------------------------------------
// Privacy and forget
// ---------------------------------------------------------------------------

/** A localStorage stand-in that can be read back key by key after a forget. */
function memoryStorage() {
  const entries = new Map();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, String(value)); },
    removeItem: (key) => { entries.delete(key); },
  };
}

test("forget leaves no residue of a derived name, a correction, or the naming provenance", () => {
  const { naming, result } = importTheExport();
  const unit = [...naming.units][0];
  const storage = memoryStorage();
  // The one write path a reader who opted in goes through, carrying the
  // correction in the record of the import it is about.
  const written = writeRetainedBriefing(storage, retainedBriefingPayload({
    analysis: result,
    provider: { id: "openai", name: "OpenAI", confidence: 3 },
    capturedAt: EXPORTED_AT,
    context: {
      unitLabels: { [unit.unitId]: "Platform Engineering" },
      departments: {},
      cohort: null,
      editedAt: EXPORTED_AT,
    },
  }));
  assert.equal(written.retained, true, "the fixture must actually be stored before it is forgotten");
  assert.match(storage.getItem(BRIEFING_RETENTION_KEY), /Platform Engineering/,
    "the correction is in the store, so forgetting it is a real assertion");

  forgetRetainedBriefing(storage);

  assert.equal(storage.getItem(BRIEFING_RETENTION_KEY), null);
  assert.equal(readRetainedBriefing(storage).retained, false);
  // Not just that key: nothing anywhere in this browser's store still holds the
  // corrected name, the derived name it replaced, or the column it came from.
  const residue = [...storage.entries.values()].join("\n");
  for (const secret of ["Platform Engineering", unit.name, "project_name", unit.unitId]) {
    assert.equal(residue.includes(secret), false, `forget left ${secret} behind`);
  }
  assert.equal(storage.entries.size, 0);
});

test("nothing on the export path opens a connection or reads a clock", () => {
  // `buildBriefing` is called with no `exportedAt`, so any timestamp in the file
  // would have come from a clock this module is not allowed to read. The naming
  // and the correction are the new fields, and neither one may smuggle one in.
  const { naming, result } = importTheExport();
  const payload = buildBriefing(result, {
    dataset: "user",
    readerLabels: { [[...naming.units][0].unitId]: "Platform Engineering" },
    unitNaming: naming,
  });
  assert.equal(payload.exportedAt, undefined);
  for (const unit of payload.unitNaming.units) {
    assert.equal(Object.keys(unit).sort().join(","),
      "conflicted,correction,derived,derivedName,sourceColumn,sourceField,sourceFieldLabel,unitId,withheld",
      "the unit record is an allowlist; a new key must be added deliberately");
  }
});
