// The reasoning half of the release brief (issue #2372).
//
// The brief already named a release and the decisions it carried. What a
// manager signing off actually needs is one step further in: who owns each of
// those decisions, and why it was taken. That is what these tests hold —
// directly on `buildReleaseRationale`, which takes a record and returns a
// string, so the words a reader receives are asserted as words rather than read
// back out of rendered markup.
//
// The adapter that resolves a release against the log lives in releases.js and
// is exercised through `buildReleaseBrief` at the bottom of this file, so the
// two halves are held to the same output rather than to each other's shape.
//
// Determinism: no network, no timers, no DOM, no shipped seed.

import test from "node:test";
import assert from "node:assert/strict";
import {
  EXAMPLE_DECISION_NOTE,
  NO_CONTEXT_TEXT,
  NO_SUMMARY_TEXT,
  RELEASE_BRIEF_BROWSER_LINE,
  RELEASE_BRIEF_EXAMPLE_LINE,
  UNRESOLVED_DECISION_NOTE,
  buildReleaseRationale,
} from "../src/release-rationale.js";
import { buildReleaseBrief, summarizeReleases } from "../src/releases.js";

const RELEASE = {
  version: "v1.2.0",
  title: "Read path",
  createdAt: "2026-03-01T00:00:00.000Z",
  status: "completed",
  owner: "Ari",
  summary: "Caching went out behind the flag.",
};

const CACHE = {
  id: "d-cache",
  title: "Cache the read path",
  owner: "Ari",
  status: "pending",
  context: "Read latency spikes at the top of the hour.",
};
const QUEUE = {
  id: "d-queue",
  title: "Adopt a durable queue",
  owner: "Kai",
  status: "accepted",
  context: "Retries are required before the fan-out.",
};

const linked = (decision, example = false) => ({ id: decision.id, decision, missing: false, example });
const dangling = (id) => ({ id, decision: null, missing: true });

// The sub-lines under one decision, in order: everything indented that follows
// its "- " line, up to the next "- " line or the end of the list.
function subLinesUnder(brief, headline) {
  const lines = brief.split("\n");
  const start = lines.findIndex((line) => line === headline);
  assert.notEqual(start, -1, `the brief must carry the line "${headline}"`);
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("  ")) break;
    out.push(line);
  }
  return out;
}

// --- the reasoning, per decision ------------------------------------------

test("each linked decision carries its owner and its context, under its own line", () => {
  const brief = buildReleaseRationale(RELEASE, [linked(CACHE), linked(QUEUE)]);
  assert.match(brief, /^Linked decisions \(2\):$/m);
  assert.deepEqual(subLinesUnder(brief, "- Cache the read path — Pending"), [
    "  Decision owner: Ari",
    "  Context: Read latency spikes at the top of the hour.",
  ]);
  assert.deepEqual(subLinesUnder(brief, "- Adopt a durable queue — Accepted"), [
    "  Decision owner: Kai",
    "  Context: Retries are required before the fan-out.",
  ]);
});

test("the reasoning stays attached to the decision it belongs to, in association order", () => {
  const brief = buildReleaseRationale(RELEASE, [linked(CACHE), linked(QUEUE)]);
  // Kai owns the queue decision and Ari owns the cache one. A reader scanning
  // this brief must not be able to read the pair the other way round, which is
  // the one failure a flat list of owners would produce silently.
  assert.ok(
    brief.indexOf("Decision owner: Ari") < brief.indexOf("Adopt a durable queue"),
    "the cache decision's owner must sit above the next decision's headline",
  );
  assert.ok(brief.indexOf("Decision owner: Kai") > brief.indexOf("Adopt a durable queue"));
});

test("a decision with no owner or context says so rather than leaving a blank line", () => {
  const bare = { id: "d-bare", title: "Bare decision", status: "proposed" };
  assert.deepEqual(subLinesUnder(buildReleaseRationale(RELEASE, [linked(bare)]), "- Bare decision — Proposed"), [
    "  Decision owner: Unknown",
    `  Context: ${NO_CONTEXT_TEXT}`,
  ]);
});

test("a context written over several lines is flattened, so it stays one field", () => {
  const wordy = { ...CACHE, context: "Read latency spikes.\n\nThe cache is the cheapest fix.  " };
  assert.deepEqual(subLinesUnder(buildReleaseRationale(RELEASE, [linked(wordy)]), "- Cache the read path — Pending"), [
    "  Decision owner: Ari",
    "  Context: Read latency spikes. The cache is the cheapest fix.",
  ]);
});

// --- an id the log cannot resolve ------------------------------------------

test("an unresolved id is named, and what is unknown about it is stated", () => {
  const brief = buildReleaseRationale(RELEASE, [linked(QUEUE), dangling("d-gone")]);
  assert.match(brief, /^Linked decisions \(2\):$/m, "the count is of what the release recorded, not of what resolved");
  assert.match(brief, /^- Linked decision d-gone is not in this log\.$/m);
  assert.deepEqual(subLinesUnder(brief, "- Linked decision d-gone is not in this log."), [
    `  ${UNRESOLVED_DECISION_NOTE}`,
  ]);
});

test("an unresolved id is never invented, inferred, or quietly dropped", () => {
  const brief = buildReleaseRationale(RELEASE, [dangling("d-gone")]);
  // Nothing is claimed about it beyond the lookup's own reach: the note says
  // this browser holds no such decision, which is all a local log can know.
  assert.match(brief, /this browser holds no decision with that id/);
  assert.doesNotMatch(brief, /does not exist/, "a local lookup cannot rule a decision out of existence");
  // And none of the fields a resolved decision gets are guessed for it.
  assert.doesNotMatch(brief, /^ {2}Decision owner:/m);
  assert.doesNotMatch(brief, /^ {2}Context:/m);
  assert.doesNotMatch(brief, /No decisions linked to this release\./, "one unresolved link is still a link");
});

// --- what is invented, said so ---------------------------------------------

test("a seeded release says it is a demonstration and not a customer result", () => {
  const brief = buildReleaseRationale(RELEASE, [linked(QUEUE)], { example: true });
  assert.equal(brief.split("\n").at(-1), RELEASE_BRIEF_EXAMPLE_LINE, "provenance is where a reader stops reading");
  assert.match(brief, /not a customer result/);
  assert.ok(!brief.includes(RELEASE_BRIEF_BROWSER_LINE));
});

test("a real release that links an invented decision labels that decision too", () => {
  const brief = buildReleaseRationale(RELEASE, [linked(CACHE), linked(QUEUE, true)]);
  // The release is the visitor's own, so it keeps the browser-local line…
  assert.equal(brief.split("\n").at(-1), RELEASE_BRIEF_BROWSER_LINE);
  // …and the one decision it borrowed from the sample log carries its own note,
  // beside the context that would otherwise read as something real.
  assert.deepEqual(subLinesUnder(brief, "- Adopt a durable queue — Accepted"), [
    "  Decision owner: Kai",
    "  Context: Retries are required before the fan-out.",
    `  ${EXAMPLE_DECISION_NOTE}`,
  ]);
  assert.deepEqual(subLinesUnder(brief, "- Cache the read path — Pending"), [
    "  Decision owner: Ari",
    "  Context: Read latency spikes at the top of the hour.",
  ], "a real decision is not labelled as an example");
});

test("nothing invented is phrased as something a customer did", () => {
  const brief = buildReleaseRationale(RELEASE, [linked(QUEUE, true)], { example: true });
  for (const sentence of brief.split("\n").filter((line) => /customer/i.test(line))) {
    // Every mention of the word is a denial. "no customer data", "not a
    // customer result" — never "a customer chose", "customers saved".
    assert.match(sentence, /\b(no|not)\b[^.]*customer/i, `"${sentence.trim()}" reads as a customer outcome`);
  }
  assert.match(brief, /not a customer result/);
  assert.equal(EXAMPLE_DECISION_NOTE.includes("not a customer result"), true);
});

// --- the whole record ------------------------------------------------------

test("a release's own fields head the brief, each on its own line", () => {
  const brief = buildReleaseRationale(RELEASE, [linked(CACHE)]);
  assert.match(brief, /^Release brief: v1\.2\.0 — Read path$/m);
  assert.match(brief, /^Release date: 2026-03-01$/m);
  assert.match(brief, /^Status: Completed$/m);
  assert.match(brief, /^Owner: Ari$/m);
  assert.match(brief, /^Summary: Caching went out behind the flag\.$/m);
});

test("a release with nothing to report still produces a whole, honest brief", () => {
  const brief = buildReleaseRationale({ version: "v0.0.1" }, []);
  assert.match(brief, /^Release brief: v0\.0\.1$/m, "a release with no title is named once, not twice");
  assert.match(brief, /^Release date: Unknown$/m);
  assert.match(brief, /^Owner: Unknown$/m);
  assert.match(brief, new RegExp(`^Summary: ${NO_SUMMARY_TEXT}$`, "m"));
  assert.match(brief, /^No decisions linked to this release\.$/m);
  assert.ok(brief.includes(RELEASE_BRIEF_BROWSER_LINE), "the disclosure is not conditional on having decisions");
});

test("the builder is pure, and leaves what it was handed alone", () => {
  const associations = [linked(CACHE), dangling("d-gone")];
  const before = JSON.stringify({ RELEASE, associations });
  assert.equal(buildReleaseRationale(RELEASE, associations), buildReleaseRationale(RELEASE, associations));
  assert.equal(JSON.stringify({ RELEASE, associations }), before);
});

test("a malformed call degrades to a stated brief rather than throwing", () => {
  for (const value of [undefined, {}, [], "not a record"]) {
    const brief = buildReleaseRationale(value, "not an array");
    assert.match(brief, /^Release brief: Unknown version$/m);
    assert.match(brief, /^No decisions linked to this release\.$/m);
  }
});

// --- the adapter over the real log -----------------------------------------

// The page does not hold associations; it holds a release with `decisionIds`
// and a log. These check that the resolving half hands the builder above the
// same picture, including the half of it that did not resolve.
test("the release adapter resolves ids against the log and passes both halves through", () => {
  const log = [CACHE, QUEUE];
  const release = { id: "r-read", ...RELEASE, description: RELEASE.summary, decisionIds: ["d-cache", "d-gone"] };
  const brief = buildReleaseBrief(release, log);
  assert.match(brief, /^- Cache the read path — Pending$/m);
  assert.match(brief, /^ {2}Decision owner: Ari$/m);
  assert.match(brief, /^ {2}Context: Read latency spikes at the top of the hour\.$/m);
  assert.match(brief, /^- Linked decision d-gone is not in this log\.$/m);
  assert.ok(brief.includes(UNRESOLVED_DECISION_NOTE));
});

test("the adapter labels an example decision from the same ids the page badges rows with", () => {
  const log = [CACHE, QUEUE];
  const release = { id: "r-read", ...RELEASE, description: RELEASE.summary, decisionIds: ["d-cache", "d-queue"] };
  const brief = buildReleaseBrief(release, log, { exampleDecisionIds: new Set(["d-queue"]) });
  assert.deepEqual(subLinesUnder(brief, "- Adopt a durable queue — Accepted"), [
    "  Decision owner: Kai",
    "  Context: Retries are required before the fan-out.",
    `  ${EXAMPLE_DECISION_NOTE}`,
  ]);
  // No flag passed at all is the same as no example decisions, not a crash.
  assert.ok(!buildReleaseBrief(release, log).includes(EXAMPLE_DECISION_NOTE));
});

test("a release already resolved by the list reads the same as one resolved here", () => {
  const log = [CACHE, QUEUE];
  const release = { id: "r-read", ...RELEASE, description: RELEASE.summary, decisionIds: ["d-queue", "d-cache"] };
  const [resolved] = summarizeReleases([release], log);
  assert.equal(buildReleaseBrief(resolved), buildReleaseBrief(release, log));
});
