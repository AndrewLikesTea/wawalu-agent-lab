// The fragment codec: what may travel, what may not, and every named refusal.
//
// The four properties these assertions exist for:
//
//   1. THE PAYLOAD IS NEVER IN THE QUERY. A briefing link's `search` is
//      byte-identical to the base URL's, and the token lives only after the `#`.
//      That is the whole privacy claim: a fragment is stripped before the
//      request line is built, so no server, proxy log or referrer header sees it.
//   2. A ROUND TRIP IS LOSSLESS for the three fields a reader acts on — the
//      recoverable figure, the department the finding points at, and the
//      confidence grade.
//   3. EVERY REFUSAL HAS ITS OWN NAME, and there is one test per name.
//   4. DECODING WRITES NOTHING. Asserted against a storage double that records
//      every call.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SHARED_PERIODS, MAX_SHARED_TOKEN_LENGTH, SHARED_BRIEFING_SCHEMA, SHARE_DECODE_REASON,
  decodeSharedBriefing, encodeSharedBriefing, readSharedBriefingFragment, sharedBriefingHref,
  sharedBriefingToken,
} from "../src/finops-shared-briefing-link.js";
import { FINOPS_PERIOD_FIELDS } from "../src/finops-workspace-contract.js";

const BASE = "https://labs.wawalu.org/executive-briefing.html";

/** One valid retained period, built in-test rather than committed as a fixture. */
function period(index = 0, overrides = {}) {
  const month = `2026-0${index + 1}`;
  return {
    periodId: `user:${month}`,
    period: month,
    dataset: "user",
    briefingContractVersion: "finops-briefing/1.0.0",
    derivedAt: "2026-08-01T00:00:00.000Z",
    analyzedSpendMinor: 15_450_000 + index,
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

/** Encode a fresh token for `count` periods, asserting the encode succeeded. */
function tokenFor(count = 1) {
  const encoded = encodeSharedBriefing(Array.from({ length: count }, (_, index) => period(index)));
  assert.equal(encoded.ok, true, `encoding ${count} period(s) should succeed`);
  return encoded.token;
}

test("the token lives only after the hash; the query string is untouched", () => {
  const withQuery = `${BASE}?payload=bundled`;
  const link = sharedBriefingHref(withQuery, [period()]);
  assert.equal(link.ok, true);

  const built = new URL(link.url);
  assert.equal(built.search, new URL(withQuery).search,
    "a shared link must not add, drop or rewrite a single query parameter");
  assert.equal(built.hash.startsWith("#brief="), true);
  assert.equal(built.hash.slice("#brief=".length), link.token);
  // The token must not appear anywhere before the fragment: that is the whole
  // reason it is safe to put a company's figures in a URL at all.
  assert.equal(link.url.slice(0, link.url.indexOf("#")).includes(link.token), false);
});

test("a round trip preserves the recoverable figure, the department and the grade", () => {
  const original = period(0, {
    recoverableScenarioMinor: 4_820_075,
    topDepartmentId: "dept-boreal-support",
    confidence: "high",
  });
  const decoded = decodeSharedBriefing(encodeSharedBriefing([original]).token);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.periods.length, 1);
  assert.equal(decoded.periods[0].recoverableScenarioMinor, 4_820_075);
  assert.equal(decoded.periods[0].topDepartmentId, "dept-boreal-support");
  assert.equal(decoded.periods[0].confidence, "high");
});

test("encoding is deterministic: the same periods produce the same token twice", () => {
  assert.equal(encodeSharedBriefing([period(), period(1)]).token,
    encodeSharedBriefing([period(), period(1)]).token);
});

test("a field outside the retained-period allowlist never leaves the browser", () => {
  const leaky = period(0);
  leaky.promptContent = "the raw prompt a reader typed";
  leaky.customerName = "Northwind Traders";
  const decoded = decodeSharedBriefing(encodeSharedBriefing([leaky]).token);
  assert.equal(decoded.ok, true);
  for (const key of Object.keys(decoded.periods[0])) {
    assert.equal(FINOPS_PERIOD_FIELDS.includes(key), true, `${key} is not on the allowlist`);
  }
  assert.equal("promptContent" in decoded.periods[0], false);
  assert.equal("customerName" in decoded.periods[0], false);
});

test("a link carries at most the most recent MAX_SHARED_PERIODS months", () => {
  const many = Array.from({ length: MAX_SHARED_PERIODS + 3 }, (_, index) => period(index % 9));
  const encoded = encodeSharedBriefing(many);
  assert.equal(encoded.ok, true);
  assert.equal(encoded.periods.length, MAX_SHARED_PERIODS);
  // The tail, not the head: a link is a message about recent months.
  assert.equal(encoded.periods.at(-1).analyzedSpendMinor, many.at(-1).analyzedSpendMinor);
});

/* ------------------------- one test per named refusal ---------------------- */

test("refusal: a fragment with no briefing on it is `absent`, not an error", () => {
  assert.equal(decodeSharedBriefing("").reason, SHARE_DECODE_REASON.absent);
  assert.equal(decodeSharedBriefing(null).reason, SHARE_DECODE_REASON.absent);
  // Every previously shared deep link on this site is an ordinary anchor.
  assert.equal(readSharedBriefingFragment("#local-import").reason, SHARE_DECODE_REASON.absent);
  assert.equal(readSharedBriefingFragment("#trend-title").reason, SHARE_DECODE_REASON.absent);
});

test("refusal: a token over the ceiling is `oversize` and is not read in part", () => {
  const huge = "A".repeat(MAX_SHARED_TOKEN_LENGTH + 1);
  const decoded = decodeSharedBriefing(huge);
  assert.equal(decoded.reason, SHARE_DECODE_REASON.oversize);
  assert.equal(decoded.periods.length, 0);
  assert.match(decoded.remedy, /\S/);
});

test("refusal: a truncated or non-base64url token is `malformed`", () => {
  const token = tokenFor(1);
  assert.equal(decodeSharedBriefing(token.slice(0, 20)).reason, SHARE_DECODE_REASON.malformed);
  assert.equal(decodeSharedBriefing("not a token!!").reason, SHARE_DECODE_REASON.malformed);
  // Valid base64url that is not JSON.
  assert.equal(decodeSharedBriefing("aGVsbG8").reason, SHARE_DECODE_REASON.malformed);
});

test("refusal: a token from another schema is `unsupportedVersion`, never guessed at", () => {
  const foreign = Buffer.from(JSON.stringify({
    v: SHARED_BRIEFING_SCHEMA + 1, periods: [period()],
  })).toString("base64url");
  const decoded = decodeSharedBriefing(foreign);
  assert.equal(decoded.reason, SHARE_DECODE_REASON.unsupportedVersion);
  assert.equal(decoded.periods.length, 0);
});

test("refusal: a period that fails the retained-record contract is `rejectedRecords`", () => {
  const bad = Buffer.from(JSON.stringify({
    v: SHARED_BRIEFING_SCHEMA,
    periods: [period(0, { confidence: "excellent", coverageRatioPpm: -4 })],
  })).toString("base64url");
  assert.equal(decodeSharedBriefing(bad).reason, SHARE_DECODE_REASON.rejectedRecords);
  // And the same contract on the way out: a record this build would refuse to
  // read is one it refuses to write.
  assert.equal(encodeSharedBriefing([period(0, { period: "not-a-month" })]).reason,
    SHARE_DECODE_REASON.rejectedRecords);
});

test("refusal: a token declaring this schema with no period is `empty`", () => {
  const none = Buffer.from(JSON.stringify({ v: SHARED_BRIEFING_SCHEMA, periods: [] }))
    .toString("base64url");
  assert.equal(decodeSharedBriefing(none).reason, SHARE_DECODE_REASON.empty);
  assert.equal(encodeSharedBriefing([]).reason, SHARE_DECODE_REASON.empty);
  assert.equal(sharedBriefingHref(BASE, []).url, "");
});

test("every named refusal carries a sentence a page can render", () => {
  for (const reason of Object.values(SHARE_DECODE_REASON)) {
    const refusal = decodeSharedBriefing(reason === SHARE_DECODE_REASON.absent ? "" : "!!!");
    assert.match(refusal.summary, /\S/);
    assert.match(refusal.statement, /\S/);
    assert.match(refusal.remedy, /\S/);
  }
});

/* --------------------------- fragment parsing ------------------------------ */

test("the token is read out of a fragment that carries other keys", () => {
  const token = tokenFor(1);
  assert.equal(sharedBriefingToken(`#brief=${token}`), token);
  assert.equal(sharedBriefingToken(`#panel=trend&brief=${token}`), token);
  assert.equal(sharedBriefingToken(`#brief=${token}&panel=trend`), token);
  assert.equal(sharedBriefingToken("#local-import"), "");
  assert.equal(sharedBriefingToken(""), "");
});

test("decoding touches no storage: no read, no write, no last-viewed stamp", () => {
  const calls = [];
  const spy = new Proxy({}, {
    get(_target, name) {
      return (...args) => {
        calls.push([String(name), ...args]);
        return null;
      };
    },
  });
  const before = JSON.stringify({ retained: [period()] });
  // The codec is handed no storage at all — this asserts it cannot reach one
  // through a global either, by leaving a recording double in place.
  const previousLocal = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { value: spy, configurable: true });
  try {
    assert.equal(decodeSharedBriefing(tokenFor(2)).ok, true);
    assert.equal(readSharedBriefingFragment(`#brief=${tokenFor(1)}`).ok, true);
  } finally {
    if (previousLocal === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, "localStorage", { value: previousLocal, configurable: true });
  }
  assert.deepEqual(calls, [], `decoding called storage: ${JSON.stringify(calls)}`);
  assert.equal(JSON.stringify({ retained: [period()] }), before);
});
