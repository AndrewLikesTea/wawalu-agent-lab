// The third briefing source, its precedence, and the control that mints it.
//
// WHAT THIS FILE HOLDS.
//
//   1. THE PRECEDENCE IS SHARED, THEN WORKSPACE, THEN SAMPLE — the documented
//      order and the real one, asserted against each other rather than restated.
//      A reader who followed a colleague's link asked for that colleague's
//      figures; briefing them on their own months would answer a question they
//      did not ask under an identical heading.
//   2. A LINK THIS BUILD CANNOT READ IS NEVER SWALLOWED. The fallback still
//      happens — a reader is owed a readable page — but the named refusal
//      travels with it, so a synthetic sample can never be mistaken for what the
//      sender sent.
//   3. RESOLVING A LINK IS READ-ONLY. The reader's retained records are
//      byte-identical afterwards, and the store records no write of any kind.
//   4. PREVIOUSLY SHARED DEEP LINKS STILL RESOLVE WHERE THEY DID. The concrete
//      pre-existing shapes are pinned below so a later codec change cannot
//      quietly retarget them.
//   5. THE CONTROL SHIPS WIRED, and is absent — not merely inert — when there is
//      nothing of the reader's own to share.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, tabSequence, textOf } from "./support/browser.js";
import {
  BRIEFING_SOURCE, BRIEFING_SOURCE_PRECEDENCE, SHARED_ORIGIN, chooseBriefingSource,
} from "../src/executive-briefing-source.js";
import {
  SHARE_DECODE_REASON, encodeSharedBriefing, sharedBriefingHref,
} from "../src/finops-shared-briefing-link.js";
import { FINOPS_CONSENT } from "../src/finops-workspace.js";
import {
  SHARE_LINK_IDS, SHARE_LINK_LABEL, SHARE_LINK_PATH, applyShareLink, bindShareLink,
  shareableBriefingLink,
} from "../src/finops-share-link-control.js";
import { COPY_MESSAGE, COPY_METHOD } from "../src/coaching-summary.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const ORIGIN = "https://labs.wawalu.org";

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
    recoverableScenarioMinor: 3_141_500 + index,
    recordsTotal: 900,
    recordsAnalyzed: 880,
    coverageRatioPpm: 977_777,
    confidence: "moderate",
    topDepartmentId: "dept-atlas-platform",
    ...overrides,
  };
}

/** A workspace read that reports `periods` as granted and complete. */
const granted = (periods) => () => ({
  access: "ok",
  document: { consent: { state: FINOPS_CONSENT.granted }, periods },
  dropped: 0,
});

/** A storage double that records every call it receives. */
function recordingStorage(entries = {}) {
  const store = new Map(Object.entries(entries));
  const calls = [];
  return {
    calls,
    snapshot: () => JSON.stringify([...store.entries()].sort()),
    getItem(key) {
      calls.push(["getItem", key]);
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      calls.push(["setItem", key, value]);
      store.set(key, value);
    },
    removeItem(key) {
      calls.push(["removeItem", key]);
      store.delete(key);
    },
  };
}

const sharedHash = (periods) => `#brief=${encodeSharedBriefing(periods).token}`;

/** Let an async click handler run to completion. */
const settle = () => new Promise((resolve) => { setImmediate(resolve); });

/* ------------------------------ precedence -------------------------------- */

test("the documented precedence is shared, then workspace, then sample", () => {
  assert.deepEqual([...BRIEFING_SOURCE_PRECEDENCE],
    [BRIEFING_SOURCE.shared, BRIEFING_SOURCE.workspace, BRIEFING_SOURCE.sample]);

  const own = [period(0, { recoverableScenarioMinor: 111 })];
  const theirs = [period(1, { recoverableScenarioMinor: 999 })];
  const storage = recordingStorage();

  // Rank 1 beats rank 2: a link wins over the reader's own retained months.
  const first = chooseBriefingSource(storage, { hash: sharedHash(theirs), read: granted(own) });
  assert.equal(first.source, BRIEFING_SOURCE.shared);
  assert.equal(first.periods[0].recoverableScenarioMinor, 999);
  assert.equal(first.origin, SHARED_ORIGIN);

  // Rank 2 beats rank 3: with no link, the reader's own months still win.
  const second = chooseBriefingSource(storage, { hash: "", read: granted(own) });
  assert.equal(second.source, BRIEFING_SOURCE.workspace);
  assert.equal(second.periods[0].recoverableScenarioMinor, 111);

  // Rank 3 is the floor.
  const third = chooseBriefingSource(storage, { hash: "", read: granted([]) });
  assert.equal(third.source, BRIEFING_SOURCE.sample);

  // The order the module publishes is the order it just demonstrated.
  assert.deepEqual([first.source, second.source, third.source], [...BRIEFING_SOURCE_PRECEDENCE]);
});

test("a link this build cannot read falls back, but never silently", () => {
  const storage = recordingStorage();
  const chosen = chooseBriefingSource(storage, { hash: "#brief=!!!not-a-token", read: granted([]) });
  assert.equal(chosen.source, BRIEFING_SOURCE.sample);
  assert.equal(chosen.sharedFailure.code, SHARE_DECODE_REASON.malformed);
  assert.match(chosen.sharedFailure.summary, /\S/);
  assert.match(chosen.sharedFailure.remedy, /\S/);

  // A workspace fallback reports it too — the reader must not read their own
  // months believing they are the sender's.
  const onWorkspace = chooseBriefingSource(storage, {
    hash: "#brief=!!!not-a-token", read: granted([period()]),
  });
  assert.equal(onWorkspace.source, BRIEFING_SOURCE.workspace);
  assert.equal(onWorkspace.sharedFailure.code, SHARE_DECODE_REASON.malformed);
});

test("an ordinary anchor fragment is not reported as a failed shared link", () => {
  const storage = recordingStorage();
  for (const hash of ["", "#local-import", "#trend-title", "#recommendation-evidence"]) {
    const chosen = chooseBriefingSource(storage, { hash, read: granted([period()]) });
    assert.equal(chosen.source, BRIEFING_SOURCE.workspace, `${hash} should not change the source`);
    assert.equal(chosen.sharedFailure, null, `${hash} must not be reported as a broken link`);
  }
});

/* ------------------------------- read-only -------------------------------- */

test("resolving a shared link leaves the reader's retained records byte-identical", () => {
  const retained = JSON.stringify({
    schemaVersion: "finops-workspace/1.1.0",
    consent: { state: FINOPS_CONSENT.granted, decidedAt: "2026-07-01T00:00:00.000Z" },
    periods: [period(3)],
    commitments: [],
    meta: { lastWriteAt: "2026-07-01T00:00:00.000Z" },
  });
  const storage = recordingStorage({ "shiplog.finops.workspace.v1": retained });
  const before = storage.snapshot();

  const chosen = chooseBriefingSource(storage, { hash: sharedHash([period(1)]) });
  assert.equal(chosen.source, BRIEFING_SOURCE.shared);

  assert.equal(storage.snapshot(), before, "the reader's retained records were rewritten");
  const writes = storage.calls.filter(([name]) => name !== "getItem");
  assert.deepEqual(writes, [], `resolving a link wrote to storage: ${JSON.stringify(writes)}`);
  // On the shared path the store is not even read: the branch returns first.
  assert.deepEqual(storage.calls, []);
});

/* ------------------------- pre-existing link shapes ------------------------ */

test("previously shared deep links resolve exactly where they did before", () => {
  const storage = recordingStorage();
  // Pinned literals, not constructed ones: a future codec change that started
  // claiming one of these fragments would fail here rather than in production.
  const PINNED = [
    "/executive-briefing.html?payload=bundled",
    "/executive-briefing.html?example=ai-finops-bundled",
    "/evolution.html#local-finops-files",
    "/evolution.html#trend-title",
    "/evolution.html#recommendation-evidence",
  ];
  for (const href of PINNED) {
    const url = new URL(href, ORIGIN);
    const chosen = chooseBriefingSource(storage, { hash: url.hash, read: granted([]) });
    assert.equal(chosen.source, BRIEFING_SOURCE.sample, `${href} changed source`);
    assert.equal(chosen.sharedFailure, null, `${href} is now reported as a broken shared link`);
    // The query string is what those links are branched on, and it is untouched.
    assert.equal(url.search, new URL(href, ORIGIN).search);
  }
  // `?payload=bundled` in particular is still the only thing in its own query.
  assert.equal(new URL(PINNED[0], ORIGIN).searchParams.get("payload"), "bundled");
});

/* ----------------------------- the control -------------------------------- */

test("the shareable link points at the printable briefing, payload in the fragment", () => {
  const link = shareableBriefingLink(recordingStorage(), ORIGIN);
  // Nothing retained: nothing to offer.
  assert.equal(link.ok, false);
  assert.equal(link.reason, SHARE_DECODE_REASON.empty);
  assert.equal(link.url, "");

  const built = sharedBriefingHref(new URL(SHARE_LINK_PATH, ORIGIN).href, [period()]);
  assert.equal(built.ok, true);
  const url = new URL(built.url);
  assert.equal(url.pathname, SHARE_LINK_PATH);
  assert.equal(url.search, "");
  assert.equal(url.hash.startsWith("#brief="), true);
});

test("with nothing retained the control is absent from the page, with a named reason", () => {
  const document = parseHtml(html);
  const link = applyShareLink(document, recordingStorage(), { origin: ORIGIN });
  const block = document.getElementById(SHARE_LINK_IDS.block);
  assert.equal(link.ok, false);
  assert.equal(block.hidden, true);
  assert.equal(block.dataset.reason, SHARE_DECODE_REASON.empty);
  // Absent, not merely inert: the button is out of the tab order with the block.
  assert.equal(tabSequence(document).filter((id) => id === SHARE_LINK_IDS.button).length, 0);
});

test("the control ships wired into the page, named, and announcing in the open", () => {
  const document = parseHtml(html);
  const button = document.getElementById(SHARE_LINK_IDS.button);
  assert.equal(textOf(button), SHARE_LINK_LABEL);
  assert.equal(button.getAttribute("type"), "button");

  const status = document.getElementById(SHARE_LINK_IDS.status);
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  // Empty on load: this page allows one voice per change.
  assert.equal(textOf(status), "");
  // NOT inside a disclosure. The harness reads through a shut `details` and a
  // real browser does not, so this is checked by walking up the ancestors.
  for (let node = status.parentNode; node; node = node.parentNode) {
    assert.notEqual(String(node.tagName ?? "").toLowerCase(), "details",
      "the announcement is folded inside a disclosure and would be silent");
  }
  // The button names the lead, the egress caution (#1209) and the status as its
  // description, in reading order: what the link is, what sending it costs, then
  // what happened. tests/finops-sharing-legibility.test.js owns the caution.
  assert.equal(button.getAttribute("aria-describedby"),
    `${SHARE_LINK_IDS.lead} ${SHARE_LINK_IDS.egress} ${SHARE_LINK_IDS.status}`);
});

test("a retained period unhides the control and puts the link in the box", () => {
  const document = parseHtml(html);
  const storage = recordingStorage();
  const link = applyShareLink(document, storage, {
    origin: ORIGIN,
    // The store is read through the module's own reader; injecting the read
    // keeps this test about the control rather than about storage plumbing.
  });
  assert.equal(link.ok, false, "an empty store offers nothing");

  // Now with a real retained document behind the same reader.
  const retained = JSON.stringify({
    schemaVersion: "finops-workspace/1.1.0",
    consent: { state: FINOPS_CONSENT.granted, decidedAt: "2026-07-01T00:00:00.000Z" },
    periods: [period(2)],
    commitments: [],
    meta: { lastWriteAt: "2026-07-01T00:00:00.000Z" },
  });
  const held = recordingStorage({ "shiplog.finops.workspace.v1": retained });
  const offered = applyShareLink(document, held, { origin: ORIGIN });
  assert.equal(offered.ok, true, `expected an offer, got ${offered.reason}`);
  const block = document.getElementById(SHARE_LINK_IDS.block);
  assert.equal(block.hidden, false);
  assert.equal(block.dataset.reason, "encoded");
  // The box holds exactly what the clipboard would get, before anything is
  // pressed — which is what makes the copy checkable rather than promised.
  assert.equal(document.getElementById(SHARE_LINK_IDS.text).value, offered.url);
  assert.equal(document.getElementById(SHARE_LINK_IDS.fallback).hidden, false);
  // Painting the control wrote nothing.
  assert.deepEqual(held.calls.filter(([name]) => name !== "getItem"), []);
});

test("a refused clipboard says so and leaves the link selectable", async () => {
  const document = parseHtml(html);
  const retained = JSON.stringify({
    schemaVersion: "finops-workspace/1.1.0",
    consent: { state: FINOPS_CONSENT.granted, decidedAt: "2026-07-01T00:00:00.000Z" },
    periods: [period(2)],
    commitments: [],
    meta: { lastWriteAt: "2026-07-01T00:00:00.000Z" },
  });
  bindShareLink(document, {
    clipboard: { writeText: async () => { throw new Error("denied"); } },
  });
  const offered = applyShareLink(document, recordingStorage({
    "shiplog.finops.workspace.v1": retained,
  }), { origin: ORIGIN });
  assert.equal(offered.ok, true);

  const button = document.getElementById(SHARE_LINK_IDS.button);
  const status = document.getElementById(SHARE_LINK_IDS.status);
  button.click();
  await settle();

  assert.equal(status.dataset.outcome, "manual");
  assert.equal(textOf(status), COPY_MESSAGE[COPY_METHOD.manual]);
  assert.equal(button.disabled, false, "the control is usable again after a refusal");
  // The link is still on the page, in full, for a reader to select by hand.
  assert.equal(document.getElementById(SHARE_LINK_IDS.text).value, offered.url);
});

test("a granted clipboard reports the copy and gets the link, not a summary", async () => {
  const document = parseHtml(html);
  const written = [];
  bindShareLink(document, { clipboard: { writeText: async (text) => { written.push(text); } } });
  const offered = applyShareLink(document, recordingStorage({
    "shiplog.finops.workspace.v1": JSON.stringify({
      schemaVersion: "finops-workspace/1.1.0",
      consent: { state: FINOPS_CONSENT.granted, decidedAt: "2026-07-01T00:00:00.000Z" },
      periods: [period(2)],
      commitments: [],
      meta: { lastWriteAt: "2026-07-01T00:00:00.000Z" },
    }),
  }), { origin: ORIGIN });

  document.getElementById(SHARE_LINK_IDS.button).click();
  await settle();
  assert.deepEqual(written, [offered.url]);
  assert.equal(document.getElementById(SHARE_LINK_IDS.status).dataset.outcome, "copied");
  assert.equal(new URL(written[0]).search, "", "the figures must never enter the query string");
});
