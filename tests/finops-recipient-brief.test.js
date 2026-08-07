// A colleague's brief, read-only, in the AI FinOps answer region (#1208).
//
// WHAT THESE ASSERTIONS ARE FOR.
//
//   1. THE FIGURE IS THE SENDER'S, AND SO IS THE GRADE. A recipient who reads a
//      number under this page's own heading and a grade computed from their own
//      empty workspace has been misled by a page that was never wrong about any
//      one fact. The grade beside the figure has to be the one in the payload.
//   2. EVERY DISCLOSURE SURVIVES THE TRIP. The region ships exactly one, with
//      three parts. All three must still be openable and must be populated from
//      the brief. The harness reads text through a SHUT disclosure, so opening
//      is asserted on the `open` attribute after a real keypress, not on the
//      text being findable.
//   3. ABSENT IS NOT ZERO. A part the brief did not carry says so in words.
//   4. NO PAYLOAD AND NO USABLE PAYLOAD BOTH LEAVE THE PAGE ALONE. Asserted on
//      markers of the NORMAL region — its authored figure and its "Illustrative"
//      chip — rather than on the absence of the recipient view, because an
//      empty shell would satisfy the second and fail a reader.
//   5. READ-ONLY. No button, input or write-back control appears in the region,
//      and the state adds no tab stop to the one the served page already has.
//
// No clock, no network, no sleeps: the stamps are read out of the payload.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, pressEnter, textOf } from "./support/browser.js";
import { validateBriefEnvelope } from "../src/finops-brief-envelope.js";
import { encodeSharedBriefing } from "../src/finops-shared-briefing-link.js";
import { openSharedBriefFile } from "../src/finops-open-shared-brief.js";
import {
  NOT_INCLUDED, RECIPIENT_BRIEF_IDS, SHARED_MARKER, applyRecipientBrief,
  recipientBriefSections, renderRecipientBrief, sharedPeriodLabel,
} from "../src/finops-recipient-brief.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const FIXTURE = JSON.parse(
  await readFile(new URL("./fixtures/finops-shared-brief.json", import.meta.url), "utf8"));

const doc = () => parseHtml(html);
const byId = (document, id) => document.getElementById(id);

/** The validated envelope the fixture carries. Every render reads this shape. */
const SHARED = validateBriefEnvelope(FIXTURE);
assert.ok(SHARED.ok, "the checked-in shared-brief fixture must validate");

/** A link carrying the fixture's own periods, encoded by the shipped codec. */
const LINKED = encodeSharedBriefing(FIXTURE.periods, { producedAt: FIXTURE.producedAt });
assert.ok(LINKED.ok, "the fixture's periods must encode into a shareable token");

/** Ancestor walk rather than a descendant selector, which this harness rejects. */
const within = (node, ancestor) => {
  for (let walk = node; walk; walk = walk.parentNode) if (walk === ancestor) return true;
  return false;
};

/** The `dd` stated under a given `dt` inside the region's one disclosure. */
function partBody(document, part) {
  const disclosure = byId(document, RECIPIENT_BRIEF_IDS.disclosure);
  const list = [...disclosure.children].find((child) => child.tagName === "DL");
  for (const row of list.children) {
    const term = [...row.children].find((child) => child.tagName === "DT");
    if (term && textOf(term) === part) {
      return [...row.children].find((child) => child.tagName === "DD") ?? null;
    }
  }
  return null;
}

const focusables = (node) => node.querySelectorAll("a,button,input,select,textarea,summary,[tabindex]");

// ---------------------------------------------------------------------------
// 1. The lead: the sender's figure, the sender's destination, the sender's grade.
// ---------------------------------------------------------------------------

test("the confidence grade beside the figure is the one in the shared payload", () => {
  const document = doc();
  const region = renderRecipientBrief(document, SHARED.envelope);
  assert.ok(region, "the answer region takes the recipient state");

  const grade = byId(document, RECIPIENT_BRIEF_IDS.grade);
  assert.equal(textOf(grade), `Confidence: ${SHARED.envelope.confidence.level}`);
  assert.equal(grade.dataset.grade, SHARED.envelope.confidence.level);

  // Beside the money, not folded away with the evidence: a grade inside a shut
  // disclosure is a grade nobody is told, and this harness reads through one.
  assert.equal(within(grade, byId(document, RECIPIENT_BRIEF_IDS.disclosure)), false,
    "the shared grade must not be inside the disclosure");
});

test("the lead states the shared figure, its label and the one destination", () => {
  const document = doc();
  renderRecipientBrief(document, SHARED.envelope);

  assert.equal(textOf(byId(document, RECIPIENT_BRIEF_IDS.value)), "$31,415");
  assert.equal(textOf(byId(document, RECIPIENT_BRIEF_IDS.label)), SHARED.envelope.figure.label);
  assert.equal(textOf(byId(document, RECIPIENT_BRIEF_IDS.marker)), SHARED_MARKER);
  assert.equal(textOf(byId(document, RECIPIENT_BRIEF_IDS.destination)),
    `Start here: ${SHARED.envelope.destination.statement}`);
});

// ---------------------------------------------------------------------------
// 2. The disclosure: still one, still shut, still openable, now the sender's.
// ---------------------------------------------------------------------------

test("the provenance disclosure is shut, opens on Enter, and holds the sender's provenance", () => {
  const document = doc();
  renderRecipientBrief(document, SHARED.envelope);

  const disclosure = byId(document, RECIPIENT_BRIEF_IDS.disclosure);
  assert.equal(disclosure.hasAttribute("open"), false,
    "the recipient state keeps the region's collapsed default");
  assert.equal(disclosure.tagName, "DETAILS", "the same element type the normal region uses");

  const summary = [...disclosure.children].find((child) => child.tagName === "SUMMARY");
  assert.equal(textOf(summary), "▸ How we know this", "the same summary phrasing");
  summary.focus();
  pressEnter(document);
  assert.equal(disclosure.hasAttribute("open"), true, "Enter on the summary opens it");

  const provenance = textOf(partBody(document, "Provenance"));
  assert.match(provenance, /Dataset: user\./);
  assert.match(provenance, new RegExp(SHARED.envelope.provenance.periodIds[0]));
  assert.match(provenance, /Derived at 2026-08-01T00:00:00\.000Z/);
});

test("basis and limits are populated from the payload, under the same three terms", () => {
  const document = doc();
  renderRecipientBrief(document, SHARED.envelope);

  assert.match(textOf(partBody(document, "Basis")), /3 retained period\(s\), 2026-01 to 2026-03/);

  const limits = textOf(partBody(document, "Limits"));
  for (const entry of SHARED.envelope.limits) assert.match(limits, new RegExp(entry.statement.slice(0, 40)));
  // The grade's meaning keeps the slot the region already declares for it.
  const meaning = byId(document, RECIPIENT_BRIEF_IDS.confidenceDetail);
  assert.equal(textOf(meaning), SHARED.envelope.confidence.meaning);
  assert.equal(within(meaning, byId(document, RECIPIENT_BRIEF_IDS.disclosure)), true);
});

// ---------------------------------------------------------------------------
// 3. Absent is not zero.
// ---------------------------------------------------------------------------

test("a part the brief did not carry says so rather than disappearing", () => {
  const sections = recipientBriefSections({});
  for (const part of ["Provenance", "Basis", "Limits"]) {
    assert.equal(sections[part], NOT_INCLUDED, `${part} must state its own absence`);
  }

  // …and through the whole validated path: an envelope may legally carry a null
  // figure value and a null destination statement, and both slots must say so.
  const thin = validateBriefEnvelope({
    ...FIXTURE,
    figure: { ...FIXTURE.figure, valueMinor: null },
    destination: { orgUnitId: null, statement: null },
  });
  assert.ok(thin.ok, "an envelope with a null figure and destination still validates");
  const document = doc();
  renderRecipientBrief(document, thin.envelope);
  assert.equal(textOf(byId(document, RECIPIENT_BRIEF_IDS.value)), NOT_INCLUDED);
  assert.equal(textOf(byId(document, RECIPIENT_BRIEF_IDS.destination)), `Start here: ${NOT_INCLUDED}`);
});

// ---------------------------------------------------------------------------
// 4. The stamps are the sender's, and they are stated.
// ---------------------------------------------------------------------------

test("the sender's period and produced-at stamps are named in the view", () => {
  const document = doc();
  renderRecipientBrief(document, SHARED.envelope);

  const origin = byId(document, RECIPIENT_BRIEF_IDS.origin);
  const stated = textOf(origin);
  assert.equal(sharedPeriodLabel(SHARED.envelope), "2026-01 to 2026-03");
  assert.match(stated, /period 2026-01 to 2026-03/);
  assert.match(stated, /produced 2026-08-06T09:30:00\.000Z/);
  assert.match(stated, /came from a brief somebody shared with you/);
  // Read before the evidence, not inside it.
  assert.equal(within(origin, byId(document, RECIPIENT_BRIEF_IDS.disclosure)), false);
});

// ---------------------------------------------------------------------------
// 5. Both transports, one view.
// ---------------------------------------------------------------------------

test("a fragment link paints the recipient state into the answer region", () => {
  const document = doc();
  const read = applyRecipientBrief(document, { hash: `#brief=${LINKED.token}` });
  assert.ok(read.ok, "the shipped codec's own token decodes");

  const region = byId(document, RECIPIENT_BRIEF_IDS.region);
  assert.equal(region.dataset.sharedBrief, "true");
  assert.equal(textOf(byId(document, RECIPIENT_BRIEF_IDS.marker)), SHARED_MARKER);
  assert.equal(textOf(byId(document, RECIPIENT_BRIEF_IDS.grade)),
    `Confidence: ${read.envelope.confidence.level}`);
  assert.match(textOf(byId(document, RECIPIENT_BRIEF_IDS.origin)), /produced 2026-08-06T09:30:00\.000Z/);
});

test("an opened brief file paints the same state through the same reader", async () => {
  const file = { text: async () => JSON.stringify(FIXTURE) };
  const opened = await openSharedBriefFile(file);
  assert.ok(opened.ok, "the file reader accepts the fixture");

  const document = doc();
  renderRecipientBrief(document, opened.envelope);
  assert.equal(textOf(byId(document, RECIPIENT_BRIEF_IDS.grade)),
    `Confidence: ${opened.envelope.confidence.level}`);
  assert.equal(textOf(byId(document, RECIPIENT_BRIEF_IDS.value)), "$31,415");
});

// ---------------------------------------------------------------------------
// 6. Graceful absence: the normal page, whole, on every unusable payload.
// ---------------------------------------------------------------------------

test("no payload leaves the normal answer region exactly as the page ships it", () => {
  const document = doc();
  const read = applyRecipientBrief(document, { hash: "#finops-recoverable-answer" });
  assert.equal(read.ok, false);
  assert.equal(read.reason, "no_shared_briefing");

  // Markers of the NORMAL region, not the absence of the recipient one.
  assert.equal(textOf(byId(document, RECIPIENT_BRIEF_IDS.value)), "$62,400");
  assert.equal(textOf(byId(document, RECIPIENT_BRIEF_IDS.marker)), "Illustrative");
  assert.match(textOf(partBody(document, "Provenance")), /bundled synthetic example/);
  assert.equal(byId(document, RECIPIENT_BRIEF_IDS.action).hidden, false);
  assert.equal(byId(document, RECIPIENT_BRIEF_IDS.region).dataset.sharedBrief, undefined);
  assert.equal(document.querySelectorAll(`#${RECIPIENT_BRIEF_IDS.origin}`).length, 0);
  assert.equal(document.querySelectorAll(`#${RECIPIENT_BRIEF_IDS.notice}`).length, 0);
});

test("a refused payload states why and leaves the normal region functional", () => {
  const document = doc();
  const read = applyRecipientBrief(document, { hash: "#brief=this-is-not-base64url!!" });
  assert.equal(read.ok, false);

  const notice = byId(document, RECIPIENT_BRIEF_IDS.notice);
  assert.equal(notice.dataset.outcome, read.reason);
  assert.match(textOf(notice), /could not be decoded/);
  // A paragraph in the open, above the region, and never a folded-away one.
  assert.equal(within(notice, byId(document, RECIPIENT_BRIEF_IDS.region)), false);

  assert.equal(textOf(byId(document, RECIPIENT_BRIEF_IDS.value)), "$62,400");
  assert.equal(textOf(byId(document, RECIPIENT_BRIEF_IDS.marker)), "Illustrative");
  assert.equal(byId(document, RECIPIENT_BRIEF_IDS.region).dataset.sharedBrief, undefined);

  // …and the region's own disclosure still opens, on the page's own content.
  const disclosure = byId(document, RECIPIENT_BRIEF_IDS.disclosure);
  const summary = [...disclosure.children].find((child) => child.tagName === "SUMMARY");
  summary.focus();
  pressEnter(document);
  assert.equal(disclosure.hasAttribute("open"), true);
});

test("a brief refused by the shared validation paints no part of itself", () => {
  const document = doc();
  // A real token whose envelope lost its Limits disclosures: decodable, and
  // refused whole by the contract both transports share.
  const stripped = { ...FIXTURE, limits: [] };
  const token = Buffer.from(JSON.stringify(stripped)).toString("base64url");
  const read = applyRecipientBrief(document, { hash: `#brief=${token}` });
  assert.equal(read.ok, false);
  assert.equal(read.reason, "missing_limits_disclosures");

  assert.equal(textOf(byId(document, RECIPIENT_BRIEF_IDS.value)), "$62,400");
  assert.equal(byId(document, RECIPIENT_BRIEF_IDS.region).dataset.sharedBrief, undefined);
  assert.equal(document.querySelectorAll(`#${RECIPIENT_BRIEF_IDS.origin}`).length, 0);
});

// ---------------------------------------------------------------------------
// 7. Read-only, and no wider than the tab budget the region already has.
// ---------------------------------------------------------------------------

test("the recipient state offers no control over the shared figures", () => {
  const document = doc();
  const before = focusables(byId(document, RECIPIENT_BRIEF_IDS.region)).length;
  const region = renderRecipientBrief(document, SHARED.envelope);

  assert.equal(region.querySelectorAll("button,input,select,textarea,form").length, 0,
    "nothing in this state writes the sender's figures anywhere");
  const after = focusables(region).filter((node) => !node.hidden);
  assert.ok(after.length <= before,
    `the recipient state adds tab stops: ${before} before, ${after.length} after`);
  for (const node of after) {
    assert.equal(node.tagName, "SUMMARY", "the only focusable left is the disclosure's own summary");
  }
  // The reader's own next-step anchor is out of the tree, not relabelled with
  // somebody else's move.
  assert.equal(byId(document, RECIPIENT_BRIEF_IDS.action).hidden, true);
});
