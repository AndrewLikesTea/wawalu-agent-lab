// What a recipient reads when they open a shared brief (#1208).
//
// WHAT THESE ASSERTIONS ARE FOR. A colleague opens the link a lead sent them.
// The page they land on paints the bundled synthetic example on a cold load, so
// without this state they read an invented company's figures under the sender's
// sentence about ours — and nothing on screen is wrong, which is why the failure
// is silent. These tests hold the recipient state to four things:
//
//   1. THE THREE FACTS LEAD, AND THEY ARE THE SENDER'S. The figure, the
//      destination and the confidence grade come out of the payload and are
//      readable without opening anything.
//   2. AUTHORSHIP IS STATED IN THE OPEN. The reporting period and the
//      produced-at stamp are the payload's own — no clock is read, so the same
//      link renders the same bytes twice — and the view says plainly that the
//      figures came from a shared brief.
//   3. READ-ONLY IS STRUCTURAL. The region exposes no button, no field and no
//      control that could write a sender's number into the reader's workspace.
//   4. NO BRIEF, NO CHANGE. A visit with no fragment, and a visit with one the
//      codec refuses, both read the ordinary page: same figure, same marker,
//      same authored disclosure, and the authorship line still hidden.
//
// No clock, no network, no sleeps. The payload is built in-test.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml, pressEnter, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { encodeSharedBriefing } from "../src/finops-shared-briefing-link.js";
import {
  NOT_INCLUDED, SHARED_BRIEF_ACTION_HREF, SHARED_BRIEF_IDS, SHARED_BRIEF_MARKER,
  SHARED_BRIEF_REASON, applySharedBrief, sharedBrief,
} from "../src/finops-shared-brief-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const SOURCE = await readFile(PAGE, "utf8");
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const AUTHORED_FIGURE = "$62,400";
const DISCLOSURE_ID = "finops-recoverable-how-we-know";
const SUMMARY_ID = "finops-recoverable-how-we-know-summary";

/** One valid retained period, built in-test rather than committed as a fixture. */
function period(overrides = {}) {
  return {
    periodId: "user:2026-01",
    period: "2026-01",
    dataset: "user",
    briefingContractVersion: "finops-briefing/1.0.0",
    derivedAt: "2026-01-31T09:15:00.000Z",
    sourceFingerprint: "sha256:9f21",
    analyzedSpendMinor: 15_450_000,
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

/** The fragment a recipient's address bar carries, for the given periods. */
function fragment(periods = [period()]) {
  const encoded = encodeSharedBriefing(periods);
  assert.equal(encoded.ok, true, "the payload under test must encode");
  return `#brief=${encoded.token}`;
}

const shownText = (document, id) => textOf(document.getElementById(id));

/** A document with the shared brief painted into it, and its painted state. */
function recipientPage(periods) {
  const document = parseHtml(SOURCE);
  const state = applySharedBrief(document, fragment(periods));
  return { document, state };
}

/** Ancestor walk rather than a descendant selector, which this harness rejects. */
function ancestorIds(node) {
  const chain = [];
  for (let walk = node?.parentNode; walk; walk = walk.parentNode) {
    if (walk.id) chain.push(walk.id);
  }
  return chain;
}

// ---------------------------------------------------------------------------
// 1. The three facts a recipient acts on, from the sender's payload.
// ---------------------------------------------------------------------------

test("the shared figure, the destination and the grade lead the region", () => {
  const { document, state } = recipientPage();
  assert.equal(state.ok, true);
  assert.equal(state.reason, SHARED_BRIEF_REASON.rendered);

  // (a) the money: 3,141,500 usd_minor, whole dollars, as the slot is authored.
  assert.equal(shownText(document, SHARED_BRIEF_IDS.value), "$31,415");
  assert.equal(shownText(document, SHARED_BRIEF_IDS.marker), SHARED_BRIEF_MARKER);

  // (b) what to change first: the org unit the sender's finding points at.
  assert.match(shownText(document, SHARED_BRIEF_IDS.destination), /dept-atlas-platform/);

  // (c) how far to trust it.
  const grade = document.getElementById(SHARED_BRIEF_IDS.grade);
  assert.equal(textOf(grade), "Confidence: Moderate");
  assert.equal(grade.dataset.grade, "moderate");
});

test("all three lead facts are outside every disclosure", () => {
  const { document } = recipientPage();
  for (const id of [SHARED_BRIEF_IDS.value, SHARED_BRIEF_IDS.grade,
    SHARED_BRIEF_IDS.destination, SHARED_BRIEF_IDS.origin]) {
    assert.equal(ancestorIds(document.getElementById(id)).includes(DISCLOSURE_ID), false,
      `#${id} is folded into the disclosure, so a recipient who presses nothing does not read it`);
  }
});

// ---------------------------------------------------------------------------
// 2. Authorship, in the open, from the payload and never from a clock.
// ---------------------------------------------------------------------------

test("the view names the sender's period and produced-at stamp, and says the figures are shared", () => {
  const { document } = recipientPage();
  const origin = document.getElementById(SHARED_BRIEF_IDS.origin);
  assert.equal(origin.hidden, false, "the authorship line must be visible in the recipient state");

  const sentence = textOf(origin);
  assert.match(sentence, /came from a shared brief/);
  assert.match(sentence, /2026-01/, "the sender-supplied reporting period must be named");
  assert.match(sentence, /2026-01-31T09:15:00\.000Z/, "the produced-at stamp must be the payload's own");
});

test("the same link renders the same bytes twice — nothing is read off a clock", () => {
  const first = recipientPage();
  const second = recipientPage();
  for (const id of [SHARED_BRIEF_IDS.value, SHARED_BRIEF_IDS.origin, SHARED_BRIEF_IDS.provenance]) {
    assert.equal(shownText(first.document, id), shownText(second.document, id),
      `#${id} differs between two renders of one link`);
  }
});

test("a payload with no produced-at stamp never reaches a reader", () => {
  // The retained-record contract requires `derivedAt`, so a brief that carries
  // no stamp is refused by the codec rather than rendered undated. Pinned here
  // because the authorship line above depends on it: there is no path where a
  // recipient reads a shared figure with no time attached to it.
  const encoded = encodeSharedBriefing([period({ derivedAt: null })]);
  assert.equal(encoded.ok, false);
});

// ---------------------------------------------------------------------------
// 3. Disclosure parity, and what the brief does not carry.
// ---------------------------------------------------------------------------

test("the region's one disclosure renders from the payload and opens on Enter", () => {
  const { document } = recipientPage();
  const details = document.getElementById(DISCLOSURE_ID);
  assert.equal(details.hasAttribute("open"), false, "the disclosure must still ship shut");

  const provenance = shownText(document, SHARED_BRIEF_IDS.provenance);
  assert.match(provenance, /shared brief/);
  assert.match(provenance, /2026-01-31T09:15:00\.000Z/);
  assert.match(provenance, /sha256:9f21/);
  assert.match(shownText(document, SHARED_BRIEF_IDS.basis), /\$31,415/);
  assert.ok(shownText(document, SHARED_BRIEF_IDS.limits).length > 40,
    "the Limits part must be rendered from the shared brief's own limitations");

  document.getElementById(SUMMARY_ID).focus();
  pressEnter(document);
  assert.equal(details.hasAttribute("open"), true, "the disclosure must be openable with the payload");
});

test("a field the payload lacks is named inside the disclosure, not dropped", () => {
  const { document, state } = recipientPage([period({ sourceFingerprint: undefined })]);
  assert.equal(state.ok, true, "an optional field's absence must not refuse the whole brief");
  const provenance = shownText(document, SHARED_BRIEF_IDS.provenance);
  assert.equal(provenance.split(NOT_INCLUDED).length - 1, 1,
    `the absent fingerprint must read "${NOT_INCLUDED}" in the place it would have gone`);
  assert.match(provenance, /Source fingerprint: not included in this brief/);
  // …and the disclosure it is in is still openable, rather than dropped for
  // want of one field.
  document.getElementById(SUMMARY_ID).focus();
  pressEnter(document);
  assert.equal(document.getElementById(DISCLOSURE_ID).hasAttribute("open"), true);
});

// ---------------------------------------------------------------------------
// 4. Read-only. The region offers nothing that writes.
// ---------------------------------------------------------------------------

test("the recipient state exposes no control that writes the shared figures anywhere", () => {
  const { document } = recipientPage();
  const region = document.getElementById(SHARED_BRIEF_IDS.region);
  for (const tag of ["button", "input", "textarea", "select", "form"]) {
    assert.equal(region.querySelectorAll(tag).length, 0,
      `a <${tag}> in the recipient state is a way to write a sender's figure into a reader's workspace`);
  }

  // The region's one anchor is the way back to the reader's OWN analysis, and
  // it carries no shared value: re-running your own import stays available.
  const links = region.querySelectorAll("a");
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute("href"), SHARED_BRIEF_ACTION_HREF);
  assert.equal(textOf(links[0]).includes("$31,415"), false,
    "the way out must not carry the sender's figure into the reader's own analysis");
});

test("the recipient state adds no tab stop to the answer region", () => {
  const plain = parseHtml(SOURCE);
  const before = tabSequence(plain).length;
  const { document } = recipientPage();
  assert.equal(tabSequence(document).length, before,
    "the recipient state must reuse the region's existing focusables, not add one");
});

// ---------------------------------------------------------------------------
// 5. The announcement lives in the page's one live region, unfolded.
// ---------------------------------------------------------------------------

test("the recipient's answer text is announced from the page's one live region", () => {
  const { document } = recipientPage();
  const live = document.getElementById("finops-stand-live");
  assert.equal(live.getAttribute("aria-live"), "polite");
  assert.equal(ancestorIds(live).includes(DISCLOSURE_ID), false);
  const spoken = textOf(live);
  assert.match(spoken, /shared brief/);
  assert.match(spoken, /\$31,415/);
  assert.match(spoken, /dept-atlas-platform/);
});

// ---------------------------------------------------------------------------
// 6. No brief, no change. Both fallbacks read the ordinary page.
// ---------------------------------------------------------------------------

test("an address with no shared brief leaves the ordinary page exactly as served", () => {
  const document = parseHtml(SOURCE);
  const state = applySharedBrief(document, "");
  assert.equal(state.ok, false);
  assert.equal(shownText(document, SHARED_BRIEF_IDS.value), AUTHORED_FIGURE);
  assert.equal(document.getElementById(SHARED_BRIEF_IDS.origin).hidden, true);
  assert.equal(document.getElementById(SHARED_BRIEF_IDS.region).dataset.sharedBrief, undefined);
});

test("a refused payload falls back to the ordinary page rather than a half-painted one", () => {
  for (const hash of ["#brief=not-a-token!!", "#brief=", "#recommendation-evidence",
    `#brief=${Buffer.from(JSON.stringify({ v: 9, periods: [period()] })).toString("base64url")}`]) {
    const document = parseHtml(SOURCE);
    const state = applySharedBrief(document, hash);
    assert.equal(state.ok, false, `${hash} must not paint a recipient state`);
    assert.equal(shownText(document, SHARED_BRIEF_IDS.value), AUTHORED_FIGURE);
    assert.equal(shownText(document, SHARED_BRIEF_IDS.marker), "Illustrative");
    assert.equal(document.getElementById(SHARED_BRIEF_IDS.origin).hidden, true);
  }
});

test("a decodable brief whose periods name no reporting period is refused by name", () => {
  // A period the briefing contract will not report on decodes and then selects
  // nothing, which must be a named refusal rather than a blank figure.
  const state = sharedBrief(fragment([period({ dataset: "example", analyzedSpendMinor: 0 })]));
  assert.equal(state.briefing, null);
  assert.equal(typeof state.reason, "string");
});

// ---------------------------------------------------------------------------
// 7. The wiring. The shipped page entry paints this state on a shared link.
// ---------------------------------------------------------------------------

test("the shipped /evolution.html entry paints the recipient state from the address", async () => {
  const page = await loadPage(PAGE, {
    location: { hash: fragment() },
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  try {
    await importPageModule("/evolution-page.js");
    const { document } = page;
    await waitFor(() => document.getElementById(SHARED_BRIEF_IDS.region).dataset.sharedBrief
      === SHARED_BRIEF_REASON.rendered, "the recipient state to paint on the shipped page");
    // Settled before the globals are torn down, so the page's own async work
    // cannot outlive the test it belongs to.
    await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
      "the bundled analysis to finish rendering");
    await waitFor(() => textOf(document.getElementById("integration-contract-provenance"))
      .startsWith("Gateway completed"), "the static contract gateway to settle");
    await waitFor(() => document.getElementById("finops-evaluation-result")
      .getAttribute("aria-busy") === "false", "the evaluation panel to settle");
    assert.equal(shownText(document, SHARED_BRIEF_IDS.value), "$31,415");
    assert.equal(document.getElementById(SHARED_BRIEF_IDS.origin).hidden, false);
  } finally {
    page.restore();
  }
});
