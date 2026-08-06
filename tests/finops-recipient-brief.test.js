// The recipient's read-only view of somebody else's brief (#1208).
//
// WHAT THESE ASSERTIONS ARE FOR. A CFO opens a link a FinOps lead sent them.
// Four things have to be true of what they meet, and each one is a way the page
// could mislead them instead:
//
//   1. IT IS THE SENDER'S FIGURE. The money, the grade, the month and the
//      produced-at stamp are the ones in the link, and the region says so where
//      the reader meets the number rather than only inside a disclosure.
//   2. THE QUALIFICATION IS STILL ONE PRESS AWAY, in the disclosure the region
//      already ships — same summary, same three parts — and it is still
//      openable. The harness reads text through a shut disclosure, so "is it
//      disclosed" is asserted on the `open` attribute and the structure, never
//      on whether a string is readable.
//   3. NOTHING OFFERS TO ADOPT THE FIGURES. The region carries one anchor and
//      no button, field or box, before and after the recipient paint.
//   4. A LINK THIS BUILD CANNOT READ COSTS THE READER NOTHING. No payload and a
//      refused payload each leave the served answer exactly as authored; the
//      refusal adds one sentence and takes nothing away.
//
// No clock, no network, no sleeps: the token is built in-test through the codec
// #1206 already ships, and the page is the shipped document.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, pressEnter, textOf } from "./support/browser.js";
import { encodeSharedBriefing } from "../src/finops-shared-briefing-link.js";
import {
  BRIEF_STATE, RECIPIENT_IDS, applyRecipientBrief, reportingPeriod,
} from "../src/finops-recipient-brief-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const SOURCE = await readFile(PAGE, "utf8");
const doc = () => parseHtml(SOURCE);

/** One valid retained period, built in-test rather than committed as a fixture. */
const period = (overrides = {}) => ({
  periodId: "user:2026-06",
  period: "2026-06",
  dataset: "user",
  briefingContractVersion: "finops-briefing/1.0.0",
  derivedAt: "2026-07-02T09:41:00.000Z",
  analyzedSpendMinor: 15_450_000,
  attributedSpendMinor: 12_000_000,
  recoverableScenarioMinor: 4_820_000,
  recordsTotal: 900,
  recordsAnalyzed: 880,
  coverageRatioPpm: 977_777,
  confidence: "high",
  topDepartmentId: "dept-boreal-support",
  ...overrides,
});

/** The address a recipient actually opens: this page, with #1206's own token. */
function sharedHash(periods) {
  const encoded = encodeSharedBriefing(periods);
  assert.equal(encoded.ok, true, "the fixture periods must survive the shared-brief codec");
  return `#brief=${encoded.token}`;
}

const byId = (document, id) => document.getElementById(id);

/** Ancestor walk rather than a descendant selector, which this harness rejects. */
const within = (node, ancestor) => {
  for (let walk = node; walk; walk = walk.parentNode) if (walk === ancestor) return true;
  return false;
};

const hasDisclosureAncestor = (node) => {
  for (let walk = node?.parentNode; walk; walk = walk.parentNode) {
    if (walk.tagName === "DETAILS") return true;
  }
  return false;
};

/**
 * Every disclosure the region ships, enumerated from the document rather than
 * from memory, so one added to the answer region later is one this test starts
 * holding the recipient state to.
 */
const disclosuresIn = (document) => {
  const region = byId(document, RECIPIENT_IDS.region);
  return document.querySelectorAll("details").filter((node) => within(node, region));
};

// ---------------------------------------------------------------------------
// 1. The sender's figures, in the slots the reader meets first.
// ---------------------------------------------------------------------------

test("the shared brief's figure, grade and first move lead the answer region", () => {
  const document = doc();
  const painted = applyRecipientBrief(document, { hash: sharedHash([period()]) });

  assert.equal(painted.state, BRIEF_STATE.shared);
  assert.equal(byId(document, RECIPIENT_IDS.region).dataset.brief, BRIEF_STATE.shared);

  // The money is the sender's, and it is the shared MONTH's rather than a year's.
  assert.equal(textOf(byId(document, RECIPIENT_IDS.value)), "$48,200");
  assert.match(textOf(byId(document, RECIPIENT_IDS.label)), /shared period/i);
  assert.doesNotMatch(textOf(byId(document, RECIPIENT_IDS.label)), /annual/i,
    "a month's figure is labelled as an annual one");

  // The grade is the payload's, in words and in the DOM.
  const grade = byId(document, RECIPIENT_IDS.grade);
  assert.equal(textOf(grade), "Confidence: High");
  assert.equal(grade.dataset.grade, "high");

  // One prioritized destination, naming the org unit the sender's brief ranked.
  const action = byId(document, RECIPIENT_IDS.action);
  assert.match(textOf(action), /dept-boreal-support/);
  assert.equal(action.getAttribute("href"), "/savings-action-center.html",
    "the recipient's one control was re-targeted rather than retitled");

  // All three are outside every disclosure: a headline fact folded away is a
  // fact nobody is told, and this harness would read it either way.
  for (const id of [RECIPIENT_IDS.value, RECIPIENT_IDS.grade, RECIPIENT_IDS.action]) {
    assert.equal(hasDisclosureAncestor(byId(document, id)), false,
      `#${id} is inside a disclosure in the recipient state`);
  }
});

test("a grade the local rubric has no word for is still named", () => {
  const document = doc();
  applyRecipientBrief(document, { hash: sharedHash([period({ confidence: "insufficient" })]) });
  assert.equal(textOf(byId(document, RECIPIENT_IDS.grade)), "Confidence: Insufficient");
  assert.equal(byId(document, RECIPIENT_IDS.grade).dataset.grade, "insufficient");
});

test("the newest shared month is the one the region states", () => {
  const periods = [period(), period({
    periodId: "user:2026-07", period: "2026-07", recoverableScenarioMinor: 6_000_000,
  })];
  assert.equal(reportingPeriod(periods).period, "2026-07");
  // Reversed in the token, because the region must not state a different month
  // for the same six periods depending on the order they were pasted in.
  const document = doc();
  applyRecipientBrief(document, { hash: sharedHash([...periods].reverse()) });
  assert.equal(textOf(byId(document, RECIPIENT_IDS.value)), "$60,000");
});

// ---------------------------------------------------------------------------
// 2. Whose analysis it is, said in the open.
// ---------------------------------------------------------------------------

test("the sender's period and produced-at stamp are stated where the figure is", () => {
  const document = doc();
  applyRecipientBrief(document, { hash: sharedHash([period()]) });

  const marker = textOf(byId(document, RECIPIENT_IDS.marker));
  assert.match(marker, /Shared brief/, "the marker no longer says whose figures these are");
  assert.match(marker, /2026-06/, "the sender-supplied period is not beside the figure");

  const hedge = textOf(byId(document, RECIPIENT_IDS.hedge));
  assert.match(hedge, /someone else/i, "the hedge does not say these are not the reader's figures");
  assert.match(hedge, /2026-07-02/, "the produced-at stamp is not stated");

  for (const id of [RECIPIENT_IDS.marker, RECIPIENT_IDS.hedge]) {
    assert.equal(hasDisclosureAncestor(byId(document, id)), false,
      `#${id} states whose figures these are from inside a disclosure`);
  }
});

// ---------------------------------------------------------------------------
// 3. The same progressive disclosure, with the sender's words in it.
// ---------------------------------------------------------------------------

test("every disclosure the answer region ships is still there and still openable", () => {
  const document = doc();
  const before = disclosuresIn(document).map((node) => node.id);
  assert.ok(before.length >= 1, "the answer region ships no disclosure to hold this state to");

  applyRecipientBrief(document, { hash: sharedHash([period()]) });
  assert.deepEqual(disclosuresIn(document).map((node) => node.id), before,
    "the recipient state added or dropped a disclosure");

  for (const details of disclosuresIn(document)) {
    assert.equal(details.hasAttribute("open"), false,
      `#${details.id} ships open, so the qualification arrives as a disclaimer`);
    const summary = details.querySelector("summary");
    assert.equal(summary.tagName, "SUMMARY", `#${details.id} has no summary to operate`);
    summary.focus();
    pressEnter(document);
    assert.equal(details.hasAttribute("open"), true,
      `#${details.id} did not open from the keyboard in the recipient state`);
  }
});

test("the disclosure states the shared brief's provenance, basis and limits", () => {
  const document = doc();
  applyRecipientBrief(document, { hash: sharedHash([period()]) });

  const provenance = textOf(byId(document, RECIPIENT_IDS.provenance));
  assert.match(provenance, /the link you opened/i, "provenance still describes some other source");
  assert.doesNotMatch(provenance, /bundled synthetic example/i,
    "the shared figures are attributed to this page's own invented company");
  assert.match(provenance, /2026-06/, "provenance does not name the month it is stating");

  const basis = textOf(byId(document, RECIPIENT_IDS.basis));
  assert.match(basis, /\$48,200/, "the basis does not restate the figure it explains");
  assert.match(basis, /\$154,500/, "the analyzed spend the figure is taken over is missing");
  assert.match(basis, /98% coverage/, "the coverage the sender stored is missing");

  const limits = textOf(byId(document, RECIPIENT_IDS.limits));
  assert.match(limits, /not your figures/i);
  assert.match(limits, /who sent it/i, "the limits do not say a link proves nothing about the sender");

  // #1186's own slot inside Limits survives, and says the grade came with the
  // brief rather than having been computed here.
  const detail = byId(document, RECIPIENT_IDS.confidenceDetail);
  assert.equal(within(detail, byId(document, RECIPIENT_IDS.limits)), true,
    "the grade's explanation left the Limits part it belongs to");
  assert.match(textOf(detail), /not recomputed here/i);
});

// ---------------------------------------------------------------------------
// 4. Nothing here writes the sender's figures into the reader's own workspace.
// ---------------------------------------------------------------------------

test("the recipient state renders no control that could adopt the shared figures", () => {
  const document = doc();
  const region = byId(document, RECIPIENT_IDS.region);
  const controls = () => region.querySelectorAll("button,input,textarea,select,form")
    .map((node) => node.id ?? node.tagName);
  assert.deepEqual(controls(), [], "the answer region ships a control this test did not expect");

  applyRecipientBrief(document, { hash: sharedHash([period()]) });
  assert.deepEqual(controls(), [],
    "the recipient state added a control that could write the sender's figures somewhere");

  // The one anchor is the authored one, unmoved: a second would hand the reader
  // a ranking decision, and a re-targeted one would carry the shared figures off
  // this page.
  assert.deepEqual(region.querySelectorAll("a").map((link) => link.id),
    [RECIPIENT_IDS.action]);
});

test("a shared brief that names no org unit still says so rather than inventing one", () => {
  const document = doc();
  applyRecipientBrief(document, {
    hash: sharedHash([period({ topDepartmentId: undefined })]),
  });
  const action = byId(document, RECIPIENT_IDS.action);
  assert.match(textOf(action), /names no first move/i);
  assert.equal(action.dataset.available, "false");
});

// ---------------------------------------------------------------------------
// 5. No payload, and a payload this build refuses, each render the normal page.
// ---------------------------------------------------------------------------

/** The four slots a reader acts on, as the served document authors them. */
const authored = (document) => ({
  value: textOf(byId(document, RECIPIENT_IDS.value)),
  marker: textOf(byId(document, RECIPIENT_IDS.marker)),
  hedge: textOf(byId(document, RECIPIENT_IDS.hedge)),
  action: textOf(byId(document, RECIPIENT_IDS.action)),
  provenance: textOf(byId(document, RECIPIENT_IDS.provenance)),
});

for (const [name, hash] of [
  ["an address with no fragment at all", ""],
  ["the nav's own anchor into this region", "#finops-recoverable-answer"],
]) {
  test(`${name} leaves the answer region exactly as served`, () => {
    const document = doc();
    const before = authored(document);
    assert.equal(applyRecipientBrief(document, { hash }), null,
      "a page with no shared brief on it reported a state anyway");
    assert.deepEqual(authored(document), before);
    assert.equal(byId(document, RECIPIENT_IDS.region).dataset.brief, undefined);
    assert.equal(byId(document, RECIPIENT_IDS.note).hidden, true);
  });
}

test("a payload the codec refuses leaves the normal page and adds one sentence", () => {
  const document = doc();
  const before = authored(document);
  const painted = applyRecipientBrief(document, { hash: "#brief=not-a-briefing-token" });

  assert.equal(painted.state, BRIEF_STATE.refused);
  assert.equal(painted.reason, "token_not_decodable");
  // The whole answer is still the answer: no blank figure, no error-only screen.
  assert.deepEqual(authored(document), before);

  const note = byId(document, RECIPIENT_IDS.note);
  assert.equal(note.hidden, false, "the reader is told nothing about the link they followed");
  assert.match(textOf(note), /could not be decoded/i);
  assert.match(textOf(note), /Ask the sender/i, "the note states no remedy");
  assert.equal(hasDisclosureAncestor(note), false, "the refusal is folded into a disclosure");
  assert.equal(byId(document, RECIPIENT_IDS.region).dataset.briefReason, "token_not_decodable");
});

test("a token from a build with a different schema is refused by name, not read in part", () => {
  // A version this build does not know, encoded the way a token is encoded.
  const envelope = JSON.stringify({ v: 99, periods: [period()] });
  const token = Buffer.from(envelope, "utf8").toString("base64url");
  const document = doc();
  const painted = applyRecipientBrief(document, { hash: `#brief=${token}` });
  assert.equal(painted.reason, "unsupported_token_version");
  assert.equal(textOf(byId(document, RECIPIENT_IDS.value)), "$62,400",
    "a token this build cannot read still changed the figure on screen");
});
