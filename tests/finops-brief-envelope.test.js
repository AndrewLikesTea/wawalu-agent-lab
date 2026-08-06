// One envelope, two transports, and every way a file is refused.
//
// WHAT THIS FILE HOLDS.
//
//   1. THE LINK AND THE FILE CARRY THE SAME OBJECT, field for field, for the
//      same brief. That is the acceptance criterion the whole change rests on:
//      a second parallel shape is how a disclosure goes missing on one side.
//   2. THE CHECKED-IN FIXTURE IS THE ONE THE READER SHIPS AGAINST. The tests
//      open `tests/fixtures/finops-shared-brief.json` through the same
//      `readBriefEnvelopeText` the page control calls, so the worked sample
//      cannot drift from the code that reads it.
//   3. EVERY REFUSAL CLASS HAS ITS OWN TEST, and each asserts BOTH the named
//      reason and that nothing was rendered.
//   4. OPENING A BRIEF WRITES NOTHING. Asserted against a byte-identical
//      workspace export, not against a paragraph promising it.
//   5. THE FILE IS HOSTILE. Markup in a string stays text, and an unknown field
//      never reaches a caller.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  BRIEF_ENVELOPE_DISCLOSURE_FIELDS, BRIEF_ENVELOPE_FIELDS, BRIEF_ENVELOPE_REASON,
  BRIEF_ENVELOPE_SCHEMA, MAX_BRIEF_PERIODS, buildBriefEnvelope, readBriefEnvelopeText,
  serializeBriefEnvelope, validateBriefEnvelope,
} from "../src/finops-brief-envelope.js";
import { decodeSharedBriefing, encodeSharedBriefing } from "../src/finops-shared-briefing-link.js";
import {
  OPEN_BRIEF_IDS, announceSharedBrief, bindOpenSharedBrief, openSharedBriefFile,
} from "../src/finops-open-shared-brief.js";
import { FINOPS_CONSENT, finopsWorkspaceFile, retainFinopsPeriod, setFinopsConsent }
  from "../src/finops-workspace.js";
import { parseHtml } from "./support/browser.js";

const FIXTURE = new URL("./fixtures/finops-shared-brief.json", import.meta.url);
const PAGE = new URL("../src/executive-briefing.html", import.meta.url);
const STAMP = "2026-08-06T09:30:00.000Z";

/** One valid retained period. Built in-test; the committed fixture is separate. */
function period(index = 0, overrides = {}) {
  const month = `2026-0${index + 1}`;
  return {
    periodId: `user:${month}`,
    period: month,
    dataset: "user",
    briefingContractVersion: "finops-briefing/1.0.0",
    derivedAt: "2026-08-01T00:00:00.000Z",
    analyzedSpendMinor: 15_450_000 + index * 10_000,
    attributedSpendMinor: 12_000_000,
    recoverableScenarioMinor: 3_141_500,
    recordsTotal: 900,
    recordsAnalyzed: 880,
    coverageRatioPpm: 977_777,
    confidence: "moderate",
    topDepartmentId: "dept-atlas-platform",
    ...overrides,
  };
}

const periods = (count = 3) => Array.from({ length: count }, (_, index) => period(index));

/** A real envelope as plain JSON, ready to be broken one field at a time. */
function envelopeJson(count = 1, { producedAt = STAMP } = {}) {
  const built = buildBriefEnvelope(periods(count), { producedAt });
  assert.equal(built.ok, true, built.summary ?? "");
  return JSON.parse(JSON.stringify(built.envelope));
}

/** A minimal in-memory `localStorage`, recording every write it is asked for. */
function storageDouble() {
  const map = new Map();
  const writes = [];
  return {
    writes,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { writes.push(key); map.set(key, String(value)); },
    removeItem: (key) => { writes.push(key); map.delete(key); },
  };
}

/* ------------------- the acceptance criterion: one envelope ---------------- */

test("the link-encoded object and the file-serialized object are field-for-field equal", () => {
  const analysis = periods(MAX_BRIEF_PERIODS);

  const link = encodeSharedBriefing(analysis, { producedAt: STAMP });
  assert.equal(link.ok, true);
  const fromLink = decodeSharedBriefing(link.token);
  assert.equal(fromLink.ok, true);

  const built = buildBriefEnvelope(analysis, { producedAt: STAMP });
  assert.equal(built.ok, true);
  const fromFile = readBriefEnvelopeText(serializeBriefEnvelope(built.envelope, { pretty: true }));
  assert.equal(fromFile.ok, true);

  // Not "both are truthy" and not a spot check of three fields: the whole
  // object, both ways round. A field one transport dropped fails here.
  assert.deepEqual(
    JSON.parse(JSON.stringify(fromLink.envelope)),
    JSON.parse(JSON.stringify(fromFile.envelope)),
  );
  // And the bytes agree once the whitespace is taken out of it, so the two are
  // the same envelope rather than two objects that happen to compare equal.
  assert.equal(serializeBriefEnvelope(fromLink.envelope), serializeBriefEnvelope(fromFile.envelope));
});

test("the envelope carries every field the contract requires, and the link declares its version", () => {
  const built = buildBriefEnvelope(periods(2), { producedAt: STAMP });
  assert.equal(built.ok, true);
  for (const field of BRIEF_ENVELOPE_FIELDS) {
    assert.equal(Object.hasOwn(built.envelope, field), true, `the envelope is missing ${field}`);
  }
  assert.equal(built.envelope.v, BRIEF_ENVELOPE_SCHEMA);
  assert.equal(built.envelope.producedAt, STAMP);
  assert.equal(typeof built.envelope.figure.valueMinor, "number");
  assert.match(built.envelope.destination.orgUnitId, /\S/);
  assert.match(built.envelope.confidence.level, /\S/);
  assert.ok(built.envelope.limits.length > 0);
  for (const entry of built.envelope.limits) {
    assert.match(entry.code, /\S/);
    assert.match(entry.statement, /\S/);
  }
  // A build with no clock is a fact about the producer, not a malformed brief.
  assert.equal(buildBriefEnvelope(periods(1)).envelope.producedAt, null);
});

test("the same analysis encodes to the same token twice; no clock is read in the contract", () => {
  const first = encodeSharedBriefing(periods(3), { producedAt: STAMP });
  const second = encodeSharedBriefing(periods(3), { producedAt: STAMP });
  assert.equal(first.token, second.token);
  assert.equal(encodeSharedBriefing(periods(3)).token, encodeSharedBriefing(periods(3)).token);
});

/* -------------------- the worked sample the reader ships against ----------- */

test("the checked-in fixture opens through the reader the page ships", async () => {
  const text = await readFile(FIXTURE, "utf8");
  const read = readBriefEnvelopeText(text);
  assert.equal(read.ok, true, read.summary ?? "");
  assert.equal(read.envelope.v, BRIEF_ENVELOPE_SCHEMA);
  for (const field of BRIEF_ENVELOPE_FIELDS) {
    assert.equal(Object.hasOwn(read.envelope, field), true, `the fixture is missing ${field}`);
  }
  assert.ok(read.envelope.periods.length > 0);
  assert.ok(read.envelope.limits.length > 0);
  // The fixture is a real product of the builder, not a hand-typed lookalike:
  // rebuilding from its own periods reproduces it. A contract change that the
  // fixture was not regenerated for fails here rather than in a reader's tab.
  const rebuilt = buildBriefEnvelope(read.envelope.periods, {
    producedAt: read.envelope.producedAt,
  });
  assert.equal(rebuilt.ok, true);
  assert.equal(serializeBriefEnvelope(rebuilt.envelope), serializeBriefEnvelope(read.envelope));
});

/* --------------------- one test per refusal class, all-or-nothing ---------- */

/**
 * Feed a file to the page control and report what the recipient view holds.
 *
 * `rendered` counts the brief fields that reached the DOM. Every refusal test
 * asserts it is zero: validation happens before anything is drawn, so a refused
 * brief must leave no figure, no grade and no caveat behind.
 */
async function openInPage(text) {
  const html = await readFile(PAGE, "utf8");
  const document = parseHtml(html);
  const painted = [];
  bindOpenSharedBrief(document, {
    onBrief: (envelope) => painted.push(envelope),
    read: () => Promise.resolve(text),
  });
  const input = document.getElementById(OPEN_BRIEF_IDS.input);
  input.files = [{ name: "brief.json" }];
  await input.dispatchEvent({ type: "change" });
  // The handler reads the file asynchronously and the harness does not await
  // it, so drain the queue before reading the outcome. Snapshotting earlier
  // reads a status the control has not written yet.
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  const status = document.getElementById(OPEN_BRIEF_IDS.status);
  return { document, painted, status, message: status.textContent ?? "" };
}

test("refusal: a file that is not JSON is `notABrief`, and nothing is rendered", async () => {
  assert.equal(readBriefEnvelopeText("not json at all {{{").reason, BRIEF_ENVELOPE_REASON.notABrief);
  const { painted, status, message } = await openInPage("not json at all {{{");
  assert.equal(painted.length, 0);
  assert.equal(status.dataset.outcome, BRIEF_ENVELOPE_REASON.notABrief);
  assert.match(message, /not a shared brief/i);
});

test("refusal: a newer schema is named as a version, never read best-effort", async () => {
  const envelope = envelopeJson();
  envelope.v = BRIEF_ENVELOPE_SCHEMA + 1;
  const text = JSON.stringify(envelope);
  assert.equal(readBriefEnvelopeText(text).reason, BRIEF_ENVELOPE_REASON.unsupportedVersion);
  assert.equal(readBriefEnvelopeText(text).envelope, null);

  const { painted, status, message } = await openInPage(text);
  assert.equal(painted.length, 0);
  assert.equal(status.dataset.outcome, BRIEF_ENVELOPE_REASON.unsupportedVersion);
  assert.match(message, /newer version of this page/i);
});

test("refusal: any absent disclosure is `missingDisclosures`, and no part is shown", async () => {
  for (const field of BRIEF_ENVELOPE_DISCLOSURE_FIELDS) {
    const envelope = envelopeJson();
    delete envelope[field];
    const read = readBriefEnvelopeText(JSON.stringify(envelope));
    assert.equal(read.reason, BRIEF_ENVELOPE_REASON.missingDisclosures,
      `dropping ${field} should be a missing-disclosure refusal`);
    assert.equal(read.envelope, null);
  }
  // An empty Limits list is the same failure as an absent one: a figure with no
  // sentence bounding it reads as more certain than it is.
  const emptied = envelopeJson();
  emptied.limits = [];
  assert.equal(readBriefEnvelopeText(JSON.stringify(emptied)).reason,
    BRIEF_ENVELOPE_REASON.missingDisclosures);

  const dropped = envelopeJson();
  delete dropped.limits;
  const { painted, status, message } = await openInPage(JSON.stringify(dropped));
  assert.equal(painted.length, 0);
  assert.equal(status.dataset.outcome, BRIEF_ENVELOPE_REASON.missingDisclosures);
  assert.match(message, /Limits disclosures/);
});

test("refusal: a period that fails the retained-record contract stops the whole brief", () => {
  const envelope = envelopeJson();
  envelope.periods = [period(0, { confidence: "excellent", coverageRatioPpm: -4 })];
  const read = readBriefEnvelopeText(JSON.stringify(envelope));
  assert.equal(read.reason, BRIEF_ENVELOPE_REASON.rejectedRecords);
  assert.equal(read.periods.length, 0);

  const empty = envelopeJson();
  empty.periods = [];
  assert.equal(readBriefEnvelopeText(JSON.stringify(empty)).reason, BRIEF_ENVELOPE_REASON.empty);
  assert.equal(buildBriefEnvelope([]).reason, BRIEF_ENVELOPE_REASON.empty);
});

test("every named refusal carries three sentences a page can render", () => {
  const broken = {
    [BRIEF_ENVELOPE_REASON.notABrief]: "[",
    [BRIEF_ENVELOPE_REASON.unsupportedVersion]: JSON.stringify({ ...envelopeJson(), v: 99 }),
    [BRIEF_ENVELOPE_REASON.missingDisclosures]: JSON.stringify((() => {
      const value = envelopeJson();
      delete value.confidence;
      return value;
    })()),
    [BRIEF_ENVELOPE_REASON.rejectedRecords]: JSON.stringify({
      ...envelopeJson(), periods: [period(0, { period: "not-a-month" })],
    }),
    [BRIEF_ENVELOPE_REASON.empty]: JSON.stringify({ ...envelopeJson(), periods: [] }),
  };
  for (const [reason, text] of Object.entries(broken)) {
    const read = readBriefEnvelopeText(text);
    assert.equal(read.reason, reason);
    assert.match(read.summary, /\S/);
    assert.match(read.statement, /\S/);
    assert.match(read.remedy, /\S/);
  }
});

test("a file the browser will not hand over is its own named refusal", async () => {
  const result = await openSharedBriefFile({ name: "brief.json" }, {
    read: () => Promise.reject(new Error("denied")),
  });
  assert.equal(result.ok, false);
  assert.equal(result.envelope, null);
  assert.match(result.remedy, /\S/);
});

/* ---------------------------- non-contamination ---------------------------- */

test("opening a shared brief leaves the reader's own workspace export byte-identical", async () => {
  const storage = storageDouble();
  setFinopsConsent(storage, FINOPS_CONSENT.granted, { now: new Date("2026-07-01T00:00:00.000Z") });
  retainFinopsPeriod(storage, period(0, { periodId: "user:mine", period: "2026-04" }), {
    now: new Date("2026-07-01T00:00:00.000Z"),
  });

  const before = JSON.stringify(finopsWorkspaceFile(storage, { now: new Date("2026-08-06T00:00:00.000Z") }));
  storage.writes.length = 0;

  const text = await readFile(FIXTURE, "utf8");
  const opened = await openSharedBriefFile({ name: "brief.json" }, { read: () => Promise.resolve(text) });
  assert.equal(opened.ok, true);
  // The colleague's periods are genuinely different figures — the assertion
  // below would pass trivially if this brief were the reader's own.
  assert.notEqual(opened.envelope.periods[0].periodId, "user:mine");

  const after = JSON.stringify(finopsWorkspaceFile(storage, { now: new Date("2026-08-06T00:00:00.000Z") }));
  assert.equal(after, before);
  assert.deepEqual(storage.writes, []);
});

/* --------------------------- untrusted input ------------------------------- */

test("markup in a shared brief stays text, and an unknown field never reaches a caller", async () => {
  const envelope = envelopeJson();
  const hostile = "<img src=x onerror=\"alert(1)\"><script>alert(2)</script>";
  envelope.destination.statement = hostile;
  envelope.confidence.meaning = hostile;
  envelope.limits[0].statement = hostile;
  envelope.trackingPixel = "https://example.invalid/beacon.gif";
  envelope.figure.href = "javascript:alert(3)";

  const read = readBriefEnvelopeText(JSON.stringify(envelope));
  assert.equal(read.ok, true, read.summary ?? "");
  // Dropped, not sanitised: the projection copies named fields and nothing else,
  // so an unknown key cannot reach a renderer to be escaped in the first place.
  assert.equal(Object.hasOwn(read.envelope, "trackingPixel"), false);
  assert.equal(Object.hasOwn(read.envelope.figure, "href"), false);
  // The hostile strings survive as VALUES — refusing them would be a second,
  // silent contract — and are rendered as text.
  assert.equal(read.envelope.destination.statement, hostile);

  const { document, painted, status } = await openInPage(JSON.stringify(envelope));
  assert.equal(painted.length, 1);
  assert.equal(painted[0].destination.statement, hostile);
  assert.equal(Object.hasOwn(painted[0], "trackingPixel"), false);
  // The announcement is this build's own sentence, set as text. No element the
  // file's markup named exists in the document.
  assert.equal(status.dataset.outcome, "opened");
  assert.equal(document.querySelectorAll("img").length, 0);
  assert.equal(document.querySelectorAll("script[data-injected]").length, 0);
});

/* --------------------------- the control ships wired ----------------------- */

test("the recipient page carries the control, its status is in the open, and it is wired", async () => {
  const html = await readFile(PAGE, "utf8");
  const document = parseHtml(html);

  const input = document.getElementById(OPEN_BRIEF_IDS.input);
  assert.equal(input.type, "file");
  const label = document.querySelector(`label[for="${OPEN_BRIEF_IDS.input}"]`);
  assert.match(label.textContent, /Open a shared brief/i);

  // Not folded into a disclosure element, which the harness reads through and a
  // real browser does not. Walked by parent, because descendant selectors throw.
  const status = document.getElementById(OPEN_BRIEF_IDS.status);
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.textContent.trim(), "", "the status must ship empty");
  for (let node = status.parentNode; node; node = node.parentNode) {
    assert.notEqual(node.tagName?.toLowerCase(), "details");
  }

  assert.equal(bindOpenSharedBrief(document, { onBrief: () => {} })?.dataset.wired, "true");
  // Wiring twice does not double the handler: the second call is a no-op.
  assert.equal(bindOpenSharedBrief(document, { onBrief: () => {} })?.dataset.wired, "true");

  // The download link ships hidden, with no data URL behind it until the entry
  // has a brief to put there.
  const download = document.getElementById("open-shared-brief-download");
  assert.equal(download.hasAttribute("hidden"), true);
  assert.equal(download.getAttribute("download"), "shiplog-finops-shared-brief.json");
});

test("the announcement is emptied rather than left claiming a brief that is gone", async () => {
  const html = await readFile(PAGE, "utf8");
  const document = parseHtml(html);
  announceSharedBrief(document, validateBriefEnvelope(envelopeJson()));
  const status = document.getElementById(OPEN_BRIEF_IDS.status);
  assert.equal(status.dataset.outcome, "opened");
  announceSharedBrief(document, null);
  assert.equal(status.textContent, "");
  assert.equal(status.dataset.outcome, undefined);
});
