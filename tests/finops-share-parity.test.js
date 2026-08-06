// Before a lead sends a brief: does the link reproduce it on the other side?
//
// WHAT THIS FILE DEFENDS, and why each part is worth a test.
//
//   1. LABELLED FIXTURES WITH PINNED GRADES. Three cases — an ordinary brief, a
//      downgraded billing-only brief, and a refused payload — each carrying the
//      grade it is entitled to as a LITERAL, with the assumption behind that
//      grade written above it. A fixture whose expectation is whatever the code
//      currently computes proves that the code agrees with itself and nothing
//      more, and is exactly the artifact a director whose team it grades is
//      entitled to throw out.
//   2. SENDER AND RECIPIENT GRADE THE SAME. For every graded fixture, the grade
//      the sender reads and the grade rebuilt from the decoded token are equal
//      to each other AND to the pinned literal. Two of the three assertions
//      would pass on a broken codec; all three together will not.
//   3. AN UNSUPPORTED SCHEMA VERSION IS NAMED AND NOTHING IS RENDERED. The
//      declared version appears in the sentence, and no decoded field escapes
//      into the result to be read as current.
//   4. THE TOKEN IS DETERMINISTIC. Same analysis, same bytes — including when
//      the record's own keys are built in a different order, which is where an
//      incidentally-stable serializer would fail.
//   5. THE VERDICT IS ON THE PAGE, in the open, in the share control's own
//      block, and it names the diverging fields in visible text.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import {
  PARITY_FIELDS, PARITY_REASON, SUPPORTED_SCHEMA_RANGE, checkSharedBriefingParity,
} from "../src/finops-share-parity.js";
import {
  SHARED_BRIEFING_SCHEMA, encodeSharedBriefing,
} from "../src/finops-shared-briefing-link.js";
import { SHARE_LINK_IDS, applyShareLink } from "../src/finops-share-link-control.js";
import { FINOPS_CONSENT } from "../src/finops-workspace.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const ORIGIN = "https://labs.wawalu.org";

/**
 * One retained period, built in-test. `derivedAt` is a FIXED instant in every
 * fixture below and is never read from a clock: it is a field of the payload,
 * so a clock in this file would make the determinism assertion untestable and
 * the token unreproducible for the reader disputing it.
 */
function period(month, overrides = {}) {
  return {
    periodId: `user:${month}`,
    period: month,
    dataset: "user",
    briefingContractVersion: "finops-briefing/1.0.0",
    derivedAt: "2026-08-01T00:00:00.000Z",
    analyzedSpendMinor: 15_450_000,
    attributedSpendMinor: 12_000_000,
    recoverableScenarioMinor: 3_141_500,
    recordsTotal: 900,
    recordsAnalyzed: 880,
    coverageRatioPpm: 977_777,
    confidence: "high",
    topDepartmentId: "dept-atlas-platform",
    ...overrides,
  };
}

/**
 * The scoring fixtures. `expectedGrade` is the pinned expectation and the whole
 * point of the file; the line above each one is the assumption it rests on, so a
 * reviewer can dispute the assumption rather than the number.
 */
const FIXTURES = Object.freeze([
  // ORDINARY BRIEF — assumption: three gapless months of the lead's OWN import,
  // 880 of 900 records joined (0.978, over the 0.9 high bar) and no required
  // input missing, so nothing applies a ceiling: neither the benchmark ceiling
  // (three periods make the trailing baseline eligible) nor the dataset ceiling
  // (dataset is "user", not a demonstration). High is what a full-coverage own
  // import is entitled to, and this fixture exists to catch a build that starts
  // handing it out for less.
  Object.freeze({
    label: "ordinary brief",
    expectedGrade: "high",
    periods: Object.freeze(["2026-04", "2026-05", "2026-06"].map((month) => period(month))),
  }),
  // DOWNGRADED BILLING-ONLY BRIEF — assumption: a billing export carries spend
  // and no query sample, so no org unit is ranked from it (`ranked_departments`
  // is a missing required input, and the destination it can name is a billing
  // account rather than a team) and only 410 of 900 records join (0.456, under
  // the 0.6 moderate bar). Either fact alone bars high; both together put the
  // stored grade at low. The executive grade is the WEAKEST rung of the stored
  // grade and the two ceilings, so no benchmark and no dataset can raise it —
  // which is why a downgraded brief stays useful without becoming credible.
  Object.freeze({
    label: "downgraded billing-only brief",
    expectedGrade: "low",
    periods: Object.freeze([period("2026-06", {
      attributedSpendMinor: null,
      recordsAnalyzed: 410,
      confidence: "low",
      missingInputs: Object.freeze(["ranked_departments"]),
      topDepartmentId: "acct-unmapped-billing",
    })]),
  }),
  // REFUSED PAYLOAD — assumption: a record whose allowlisted field carries a
  // value the content contract forbids (here an address where an org unit id
  // belongs, which is precisely what must never leave a browser) is refused
  // WHOLE by the codec rather than scrubbed, so no link is written. With no link
  // there is no recipient, and a brief with no recipient has no grade to pin:
  // the expectation is the ABSENCE of a grade, not a weak one. `insufficient`
  // would be the wrong pin — it would claim a graded brief reached a reader who
  // was never sent anything.
  Object.freeze({
    label: "refused payload",
    expectedGrade: null,
    periods: Object.freeze([period("2026-06", {
      topDepartmentId: "billing-owner@northwind.example",
    })]),
  }),
]);

/* --------------------------- the pinned fixtures ---------------------------- */

for (const fixture of FIXTURES) {
  test(`${fixture.label}: sender and recipient read the pinned grade`, () => {
    const parity = checkSharedBriefingParity(fixture.periods);

    if (fixture.expectedGrade === null) {
      // Nothing was encodable, so nothing is claimed: no token, no sender-side
      // grade shown beside a link that does not exist, and no recipient at all.
      assert.equal(parity.ok, false);
      assert.equal(parity.reason, PARITY_REASON.notEncodable);
      assert.equal(parity.sender, null);
      assert.equal(parity.recipient, null);
      assert.equal(parity.token, "");
      assert.match(parity.statement, /no figure and no grade is claimed/i);
      return;
    }

    assert.equal(parity.ok, true, `expected parity, got ${parity.reason}: ${parity.statement}`);
    // The three-way assertion. Sender equals recipient equals the literal.
    assert.equal(parity.sender.confidenceGrade, fixture.expectedGrade);
    assert.equal(parity.recipient.confidenceGrade, fixture.expectedGrade);
    assert.equal(parity.sender.confidenceGrade, parity.recipient.confidenceGrade);
    // …and the other two fields a recipient acts on survive the round trip.
    assert.equal(parity.recipient.headlineFigureMinor, parity.sender.headlineFigureMinor);
    assert.equal(parity.recipient.destinationOrgUnitId, parity.sender.destinationOrgUnitId);
    assert.equal(parity.recipient.schemaVersion, SHARED_BRIEFING_SCHEMA);
    assert.deepEqual(parity.mismatches, []);
  });
}

test("the comparison is a named list, not a deep equality over two objects", () => {
  const names = PARITY_FIELDS.map((field) => field.name);
  for (const required of ["schemaVersion", "headlineFigureMinor", "destinationOrgUnitId",
    "confidenceGrade"]) {
    assert.equal(names.includes(required), true, `${required} must be compared by name`);
  }
  // Every compared field carries the words the failure sentence names it with.
  for (const field of PARITY_FIELDS) {
    assert.equal(typeof field.label, "string");
    assert.notEqual(field.label, "");
  }
  const parity = checkSharedBriefingParity(FIXTURES[0].periods);
  assert.deepEqual(parity.fields, names);
});

/* ------------------------------- divergence -------------------------------- */

test("a link built from other figures fails and names the fields in the sentence", () => {
  const other = encodeSharedBriefing([period("2026-06", {
    recoverableScenarioMinor: 9_000_000,
    topDepartmentId: "dept-orion-research",
    confidence: "moderate",
  })]);
  assert.equal(other.ok, true);

  const parity = checkSharedBriefingParity(FIXTURES[0].periods, { token: other.token });
  assert.equal(parity.ok, false);
  assert.equal(parity.reason, PARITY_REASON.diverged);
  const diverged = parity.mismatches.map((entry) => entry.field);
  assert.equal(diverged.includes("headlineFigureMinor"), true);
  assert.equal(diverged.includes("destinationOrgUnitId"), true);
  assert.equal(diverged.includes("confidenceGrade"), true);
  // Named in the VISIBLE text, with both sides' values, rather than in a console
  // message a lead about to press Copy will never see.
  assert.match(parity.statement, /headline recoverable figure/);
  assert.match(parity.statement, /confidence grade/);
  assert.match(parity.statement, /you: high, recipient: moderate/);
  for (const entry of parity.mismatches) {
    assert.notEqual(entry.sender, entry.recipient);
  }
});

test("a link that drops the sender's reporting period fails on the sender's own data", () => {
  // The reachable production case, and the reason this check is not ceremony.
  // The codec carries the most recent SIX records by store order, and the store
  // appends — so a lead who re-imports six older months after their newest one
  // pushes that newest month out of the link. The sender's page still leads with
  // August; the recipient's brief leads with June. Nothing is corrupt, both
  // pages look right, and the figure has changed.
  const august = period("2026-08", {
    recoverableScenarioMinor: 7_250_000,
    topDepartmentId: "dept-orion-research",
  });
  const backfilled = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]
    .map((month) => period(month));

  const parity = checkSharedBriefingParity([august, ...backfilled]);
  assert.equal(parity.ok, false);
  assert.equal(parity.reason, PARITY_REASON.diverged);
  assert.equal(parity.sender.reportingPeriod, "2026-08");
  assert.equal(parity.recipient.reportingPeriod, "2026-06");
  assert.equal(parity.mismatches.map((entry) => entry.field).includes("headlineFigureMinor"), true);
  assert.match(parity.statement, /Do not send this link yet/);
});

/* --------------------------- unsupported version ---------------------------- */

/** A token this build did not write, declaring a schema it does not read. */
function tokenDeclaring(version) {
  const payload = JSON.stringify({ periods: [period("2026-06")], v: version });
  return btoa(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

test("an unsupported schema version fails loudly and renders no decoded field", () => {
  const parity = checkSharedBriefingParity(FIXTURES[0].periods, { token: tokenDeclaring(3) });

  assert.equal(parity.ok, false);
  assert.equal(parity.reason, PARITY_REASON.unsupportedVersion);
  assert.equal(parity.statement.includes("Unsupported schema version 3"), true);
  assert.equal(parity.statement.includes(`this page reads ${SUPPORTED_SCHEMA_RANGE}`), true);
  // Not one decoded field survives onto a surface. This is the defect the
  // requirement names: stale fields rendered beside current ones look current.
  assert.equal(parity.sender, null);
  assert.equal(parity.recipient, null);
  assert.deepEqual(parity.mismatches, []);
});

test("a token that is not decodable at all is refused by its own name", () => {
  const parity = checkSharedBriefingParity(FIXTURES[0].periods, { token: "not-a-token" });
  assert.equal(parity.ok, false);
  // A cut-short link declares no version, so it is named as unreadable rather
  // than blamed on a schema nobody wrote.
  assert.equal(parity.reason, PARITY_REASON.notDecodable);
  assert.equal(parity.recipient, null);
  assert.match(parity.statement, /could not be decoded/i);
});

/* ------------------------------- determinism -------------------------------- */

test("the same analysis encodes to the same token, twice", () => {
  const first = checkSharedBriefingParity(FIXTURES[0].periods);
  const second = checkSharedBriefingParity(FIXTURES[0].periods);
  assert.equal(first.token, second.token);
  assert.notEqual(first.token, "");
  // The verdict is reproducible too, which is what makes it quotable in a
  // dispute: same input, same reason, same sentence.
  assert.equal(first.reason, second.reason);
  assert.equal(first.statement, second.statement);
});

test("key insertion order does not change a single byte of the token", () => {
  // The same period, built back to front. The serializer sorts keys, so this is
  // an assertion about explicit ordering rather than about incidental stability
  // of `Object.keys`. `derivedAt` is held at the same fixed instant on both
  // sides — the payload carries it, and a clock here would be the one source of
  // nondeterminism this check cannot rule out.
  const straight = period("2026-06");
  const reversed = Object.fromEntries(Object.entries(straight).reverse());
  assert.notDeepEqual(Object.keys(straight), Object.keys(reversed));

  const a = encodeSharedBriefing([straight]);
  const b = encodeSharedBriefing([reversed]);
  assert.equal(a.ok, true);
  assert.equal(a.token, b.token);
});

/* ------------------------------- on the page -------------------------------- */

function retainedStorage(periods) {
  const value = JSON.stringify({
    schemaVersion: "finops-workspace/1.1.0",
    consent: { state: FINOPS_CONSENT.granted, decidedAt: "2026-07-01T00:00:00.000Z" },
    periods,
    commitments: [],
    meta: { lastWriteAt: "2026-07-01T00:00:00.000Z" },
  });
  return { getItem: (key) => (key === "shiplog.finops.workspace.v1" ? value : null) };
}

test("the verdict ships empty, in the open, and is painted beside the share control", () => {
  const document = parseHtml(html);
  const line = document.getElementById(SHARE_LINK_IDS.parity);

  // Empty on load: this page allows one voice per change, and with nothing
  // retained there is no link for a verdict to be about.
  assert.equal(textOf(line), "");
  assert.equal(line.getAttribute("role"), "status");
  assert.equal(line.getAttribute("aria-live"), "polite");

  // In the open. The harness reads through a shut disclosure and a real browser
  // does not, so this walks the ancestors rather than trusting the text — and
  // it also proves the line is inside the share control's own block.
  let insideShareBlock = false;
  for (let node = line.parentNode; node; node = node.parentNode) {
    assert.notEqual(String(node.tagName ?? "").toLowerCase(), "details",
      "the parity verdict is folded inside a disclosure and would be silent");
    if (node.getAttribute?.("id") === SHARE_LINK_IDS.block) insideShareBlock = true;
  }
  assert.equal(insideShareBlock, true, "the verdict must sit where the share control lives");

  // With a period retained, the control appears and states the verdict.
  const painted = applyShareLink(document, retainedStorage([...FIXTURES[0].periods]), {
    origin: ORIGIN,
  });
  assert.equal(painted.ok, true, `expected an offer, got ${painted.reason}`);
  assert.equal(document.getElementById(SHARE_LINK_IDS.block).hidden, false);
  assert.equal(line.dataset.parity, PARITY_REASON.match);
  assert.match(textOf(line), /same headline figure/);
  assert.match(textOf(line), /same confidence grade/);
});

test("with nothing to share the verdict claims nothing about a link", () => {
  const document = parseHtml(html);
  const painted = applyShareLink(document, { getItem: () => null }, { origin: ORIGIN });
  assert.equal(painted.ok, false);
  const line = document.getElementById(SHARE_LINK_IDS.parity);
  assert.equal(textOf(line), "");
  assert.equal(line.dataset.parity, undefined);
});
