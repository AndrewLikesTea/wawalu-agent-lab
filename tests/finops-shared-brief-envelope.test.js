// The shared-brief envelope (#1207): one shape, two doors.
//
// What only this file can catch: that the link path and the file path produce
// the SAME envelope for the same brief (the fork this module exists to prevent),
// that the checked-in sample is the builder's own output rather than a hand-kept
// copy of it, and that each named refusal class refuses whole.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  MAX_SHARED_BRIEF_BYTES, SHARED_BRIEF_LIMIT_IDS, SHARED_BRIEF_REASON,
  SHARED_BRIEF_SCHEMA_VERSION, readSharedBriefText, sharedBriefFileText,
  sharedBriefFromPeriods, validateSharedBrief,
} from "../src/finops-shared-brief-envelope.js";
import { decodeSharedBriefing, encodeSharedBriefing } from "../src/finops-shared-briefing-link.js";

const SAMPLE_PATH = new URL("../src/finops-shared-brief-sample.json", import.meta.url);

/**
 * One retained period, exactly as the workspace keeps them — built in-test
 * rather than committed, like the codec's own fixture beside it. The SAMPLE
 * FILE is committed, because a recipient has to be able to open something.
 */
const PERIOD = Object.freeze({
  periodId: "user:2026-06",
  period: "2026-06",
  dataset: "user",
  briefingContractVersion: "finops-briefing/1.0.0",
  derivedAt: "2026-07-01T09:12:00.000Z",
  analyzedSpendMinor: 412_800,
  attributedSpendMinor: 301_400,
  recoverableScenarioMinor: 74_600,
  recordsTotal: 5120,
  recordsAnalyzed: 4894,
  coverageRatioPpm: 955_900,
  confidence: "moderate",
  topDepartmentId: "dept-atlas-platform",
});

const briefFile = () => sharedBriefFileText(sharedBriefFromPeriods([PERIOD]));

test("a link payload and a file payload for the same brief carry identical fields", () => {
  // The file door: bytes in, envelope out, through the reader.
  const fromFile = readSharedBriefText(briefFile());
  assert.equal(fromFile.ok, true, fromFile.summary);

  // The link door: the #1206 token in, through the SAME builder.
  const token = encodeSharedBriefing([PERIOD]);
  assert.equal(token.ok, true, token.reason);
  const decoded = decodeSharedBriefing(token.token);
  assert.equal(decoded.ok, true, decoded.reason);
  const fromLink = sharedBriefFromPeriods(decoded.periods);

  // Not "compatible" and not "overlapping" — identical. A field added to one
  // door and not the other reds here, which is the whole point of the module.
  assert.deepEqual(JSON.parse(JSON.stringify(fromFile.brief)),
    JSON.parse(JSON.stringify(fromLink)));
  assert.deepEqual(Object.keys(fromLink).sort(), Object.keys(fromFile.brief).sort());
});

test("the checked-in sample is the builder's own output, and it validates", async () => {
  const text = await readFile(SAMPLE_PATH, "utf8");
  // Byte-identical, so the sample cannot drift into describing a shape the
  // product no longer writes. Regenerate it from this period when it does.
  assert.equal(text, briefFile());
  const read = readSharedBriefText(text);
  assert.equal(read.ok, true, read.summary);
  assert.equal(read.brief.schemaVersion, SHARED_BRIEF_SCHEMA_VERSION);
  assert.deepEqual(read.brief.limits.map((limit) => limit.id), [...SHARED_BRIEF_LIMIT_IDS]);
});

test("malformed JSON is refused whole, by name", () => {
  const read = readSharedBriefText('{"schemaVersion": 1, "figure":');
  assert.equal(read.ok, false);
  assert.equal(read.reason, SHARED_BRIEF_REASON.malformed);
  assert.equal(read.brief, null);
  assert.match(read.statement, /not JSON this build can parse/);
});

test("a newer schemaVersion is refused, and the sentence names the version", () => {
  const brief = { ...sharedBriefFromPeriods([PERIOD]), schemaVersion: 2 };
  const read = validateSharedBrief(brief);
  assert.equal(read.ok, false);
  assert.equal(read.reason, SHARED_BRIEF_REASON.unsupportedVersion);
  assert.equal(read.brief, null);
  assert.match(read.statement, /declares schemaVersion 2/);
  assert.match(read.statement, new RegExp(`reads schemaVersion ${SHARED_BRIEF_SCHEMA_VERSION}`));
});

test("a missing Limits disclosure is refused, and the sentence names the disclosure", () => {
  const built = sharedBriefFromPeriods([PERIOD]);
  for (const dropped of SHARED_BRIEF_LIMIT_IDS) {
    const read = validateSharedBrief({
      ...built, limits: built.limits.filter((limit) => limit.id !== dropped),
    });
    assert.equal(read.ok, false, `${dropped} was accepted as absent`);
    assert.equal(read.reason, SHARED_BRIEF_REASON.missingField);
    assert.equal(read.brief, null);
    assert.match(read.summary, new RegExp(`"${dropped}" Limits disclosure`));
    assert.match(read.remedy, /export the brief again/);
  }
});

test("every other required field refuses by its own name", () => {
  const built = sharedBriefFromPeriods([PERIOD]);
  for (const field of ["producedAt", "figure", "destination", "confidence", "provenance"]) {
    const candidate = { ...built };
    delete candidate[field];
    const read = validateSharedBrief(candidate);
    assert.equal(read.ok, false, `${field} was accepted as absent`);
    assert.equal(read.reason, SHARED_BRIEF_REASON.missingField);
    assert.equal(read.field, field);
    assert.match(read.summary, new RegExp(field));
  }
});

test("unknown fields are dropped rather than carried through", () => {
  const built = sharedBriefFromPeriods([PERIOD]);
  const read = validateSharedBrief({
    ...built,
    senderEmail: "lead@example.com",
    figure: { ...built.figure, internalAccountId: "acct-99" },
  });
  assert.equal(read.ok, true, read.summary);
  assert.equal("senderEmail" in read.brief, false);
  assert.equal("internalAccountId" in read.brief.figure, false);
});

test("a file over the ceiling is refused before it is parsed", () => {
  const read = readSharedBriefText("{}", { byteSize: MAX_SHARED_BRIEF_BYTES + 1 });
  assert.equal(read.ok, false);
  assert.equal(read.reason, SHARED_BRIEF_REASON.oversize);
  assert.equal(read.brief, null);
});

test("markup and scheme URLs fail the whole file rather than being escaped later", () => {
  const built = sharedBriefFromPeriods([PERIOD]);
  for (const action of ["<img src=x onerror=alert(1)>", "javascript:alert(1)"]) {
    const read = validateSharedBrief({ ...built, destination: { ...built.destination, action } });
    assert.equal(read.ok, false, `${action} was accepted`);
    assert.equal(read.field, "destination");
    assert.equal(read.brief, null);
  }
});

test("no period means no brief, and no throw", () => {
  assert.equal(sharedBriefFromPeriods([]), null);
  assert.equal(sharedBriefFromPeriods(null), null);
  assert.equal(sharedBriefFromPeriods([{ period: "2026-06-01 to 2026-07-01" }]), null);
});
