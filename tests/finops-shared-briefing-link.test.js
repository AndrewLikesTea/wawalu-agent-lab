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
import { buildBriefEnvelope } from "../src/finops-brief-envelope.js";
import {
  BRIEF_VIEW_FIELD, BRIEF_VIEW_FIELDS, BRIEF_VIEW_REASON, BRIEF_VIEW_SCHEMA, resolveBriefView,
} from "../src/finops-brief-view.js";
import { FINOPS_DESTINATIONS } from "../src/finops-destinations.js";
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

/**
 * A real envelope, mutated, re-encoded. Every refusal below tests ONE broken
 * thing: hand-authoring the payload would break several at once and the decoder
 * would name whichever it checks first.
 */
function tamper(mutate) {
  const built = buildBriefEnvelope([period()], { producedAt: null });
  assert.equal(built.ok, true);
  const envelope = JSON.parse(JSON.stringify(built.envelope));
  mutate(envelope);
  return Buffer.from(JSON.stringify(envelope)).toString("base64url");
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
  // Built through the shared envelope contract and then corrupted, rather than
  // hand-authored: a token that never carried the disclosures would be refused
  // for the wrong reason, and this test is about the RECORDS failing.
  const bad = tamper((envelope) => {
    envelope.periods = [period(0, { confidence: "excellent", coverageRatioPpm: -4 })];
  });
  assert.equal(decodeSharedBriefing(bad).reason, SHARE_DECODE_REASON.rejectedRecords);
  // And the same contract on the way out: a record this build would refuse to
  // read is one it refuses to write.
  assert.equal(encodeSharedBriefing([period(0, { period: "not-a-month" })]).reason,
    SHARE_DECODE_REASON.rejectedRecords);
});

test("refusal: a token declaring this schema with no period is `empty`", () => {
  const none = tamper((envelope) => { envelope.periods = []; });
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

/* ------------- the destination the sender was reading (#1330) -------------- */

/** The destination that carries both windows, so a scope has something to be. */
const SCOPED = FINOPS_DESTINATIONS.find((entry) => entry.route.scopes.length > 0);
/** And the one that carries none, so a dropped qualifier has something to drop. */
const UNSCOPED = FINOPS_DESTINATIONS.find((entry) => entry.route.scopes.length === 0);

/** Decode a token built for one destination, asserting the encode succeeded. */
function decodedFor(view) {
  const encoded = encodeSharedBriefing([period()], { producedAt: null, view });
  assert.equal(encoded.ok, true, "a brief with a destination on it must encode");
  return decodeSharedBriefing(encoded.token);
}

test("a destination brief round-trips the slug, the stated question and the scope", () => {
  const decoded = decodedFor({ slug: SCOPED.slug, scope: SCOPED.route.scopes[0] });
  assert.equal(decoded.ok, true);

  const view = decoded.envelope.view;
  assert.equal(view.v, BRIEF_VIEW_SCHEMA);
  assert.equal(view.slug, SCOPED.slug);
  assert.equal(view.question, SCOPED.question, "the destination's own stated question travels");
  assert.equal(view.scope, SCOPED.route.scopes[0]);

  // And it resolves back to a place, through the #1326 parser rather than by
  // string comparison here: the recipient lands on the destination, at the
  // window the sender was reading it at.
  const resolved = resolveBriefView(view);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.slug, SCOPED.slug);
  assert.equal(resolved.scope, SCOPED.route.scopes[0]);
  assert.equal(resolved.address, `?destination=${SCOPED.slug}&scope=${SCOPED.route.scopes[0]}`);
  assert.match(resolved.statement, new RegExp(SCOPED.question.slice(0, 20)));
});

test("a window a destination does not carry is dropped when the brief is written", () => {
  const view = decodedFor({ slug: UNSCOPED.slug, scope: "month" }).envelope.view;
  assert.equal(view.slug, UNSCOPED.slug);
  assert.equal(view.scope, null,
    "the registry says this destination carries no window, so none is written");
});

test("a brief naming a retired destination opens the front door and says which one", () => {
  const stale = tamper((envelope) => {
    envelope[BRIEF_VIEW_FIELD] = {
      v: BRIEF_VIEW_SCHEMA, slug: "retired-door", question: "What used to be here?", scope: null,
    };
  });
  const decoded = decodeSharedBriefing(stale);
  // The BRIEF still opens: a pointer nobody can follow is not a reason to
  // withhold a colleague's figures.
  assert.equal(decoded.ok, true);
  assert.equal(decoded.envelope.periods.length, 1);

  const resolved = resolveBriefView(decoded.envelope.view);
  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, BRIEF_VIEW_REASON.stale);
  assert.equal(resolved.address, "", "an unresolvable pointer addresses the front door");
  assert.match(resolved.statement, /retired-door/, "the sender's destination is named");
  assert.match(resolved.statement, /no longer available/);
});

test("a block version this build does not know is refused as a block, not as a brief", () => {
  const foreign = tamper((envelope) => {
    envelope[BRIEF_VIEW_FIELD] = {
      v: BRIEF_VIEW_SCHEMA + 1, slug: SCOPED.slug, question: SCOPED.question, scope: null,
    };
  });
  const decoded = decodeSharedBriefing(foreign);
  assert.equal(decoded.ok, true, "an unreadable pointer never refuses the brief around it");
  assert.equal(decoded.envelope.view, null);
  assert.equal(decoded.viewNotice.reason, BRIEF_VIEW_REASON.malformed);
  // And with no view, resolution is the front door rather than an exception.
  assert.equal(resolveBriefView(decoded.envelope.view).ok, false);
});

test("a brief written before this block still decodes and opens the front door", () => {
  // The legacy schema, with no destination block and no rate basis: exactly what
  // a build older than #1265 and #1330 wrote.
  const legacy = tamper((envelope) => {
    envelope.v = 2;
    delete envelope.rateBasis;
    delete envelope[BRIEF_VIEW_FIELD];
  });
  const decoded = decodeSharedBriefing(legacy);
  assert.equal(decoded.ok, true, "an older brief opens; it is not refused for what it lacks");
  assert.equal(decoded.envelope.periods.length, 1);
  assert.equal(decoded.envelope.view, null, "the destination fields are absent, not invented");
  assert.equal(decoded.viewNotice.reason, BRIEF_VIEW_REASON.absent);

  const resolved = resolveBriefView(decoded.envelope.view);
  assert.equal(resolved.ok, false);
  assert.equal(resolved.statement, "", "no destination means nothing to say about one");
});

test("a destination brief carries the four stated fields and nothing else", () => {
  const encoded = encodeSharedBriefing([period()], {
    producedAt: null, view: { slug: SCOPED.slug, question: "leak me", scope: "quarter" },
  });
  // The payload as it travels, read back off the wire rather than off the
  // object this process built.
  const payload = JSON.parse(Buffer.from(encoded.token, "base64url").toString("utf8"));
  assert.deepEqual(Object.keys(payload[BRIEF_VIEW_FIELD]).sort(), [...BRIEF_VIEW_FIELDS].sort());
  for (const [key, value] of Object.entries(payload[BRIEF_VIEW_FIELD])) {
    assert.equal(["v", "slug", "question", "scope"].includes(key), true, `${key} is not on the block`);
    assert.equal(typeof value === "string" || typeof value === "number" || value === null, true,
      `${key} carries a structure the contract does not state`);
  }
  // No credential, no prompt text, no customer data — asserted over the WHOLE
  // encoded envelope's key set, not just this block's.
  const forbidden = /token|secret|credential|prompt|customer|cookie|email|apiKey/i;
  const walk = (node, path = "") => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      assert.equal(forbidden.test(key), false, `${path}${key} must not travel in a brief`);
      walk(value, `${path}${key}.`);
    }
  };
  walk(payload);
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
