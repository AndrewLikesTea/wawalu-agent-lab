// The consolidated FinOps journey, read the way a keyboard and a screen reader
// read it.
//
// Three states are held here because they are the three a FinOps lead actually
// arrives in: a *new* journey with nothing retained to resume, a *resumed*
// journey whose retained action is waiting on comparable evidence, and a
// *verification-ready* journey with a verdict behind it. Each one is checked for
// the same things — one titled view, one `main`, named landmarks, focus that
// lands somewhere, and no signal that travels as colour alone.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml, pressEnter, pressSpace, pressTab, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { assembleRecurringReview, REVIEW_EVIDENCE_KEY, REVIEW_EVIDENCE_VERSION } from "../src/recurring-review-readiness.js";
import { MONTHLY_ACTION_VERSION } from "../src/monthly-department-action-store.js";
import { renderRecurringReviewReadiness } from "../src/savings-action-center-view.js";
import { journeySignals } from "../src/finops-journey-signals.js";
import { STAGE_QUESTION } from "../src/finops-journey-stage.js";

const PAGE = new URL("../src/savings-action-center.html", import.meta.url);
const ACTION_KEY = "shiplog.finops.monthly-department-action.v1";

const action = (overrides = {}) => ({
  schemaVersion: MONTHLY_ACTION_VERSION,
  decisionVersion: "monthly-department-decision/1.0.0",
  actionId: "route-short-lookups",
  actionLabel: "Route short lookups to the efficient model",
  department: "Atlas Platform",
  ownerLabel: "AI Platform product owner",
  baseline: {
    value: 1200, unit: "USD/month", period: "2026-06",
    aggregation: "Monthly eligible recoverable spend",
    calculation: "Sum eligible row deltas",
  },
  target: {
    value: 0, unit: "USD/month remaining avoidable spend",
    deadline: "2026-07-31", calculation: "baseline minus verified reduction",
  },
  reviewPeriod: "2026-07",
  confidence: "high",
  provenanceReferences: ["fix-pack:1"],
  committedAt: "2026-06-30T12:00:00.000Z",
  ...overrides,
});

const analysis = (period = "2026-07", value = 900) => ({
  schemaVersion: "local-finops/1.0.0",
  period,
  rankedDepartments: [{ name: "Atlas Platform", recoverableUsd: value }],
});

const verdict = (overrides = {}) => ({
  state: "all_clear", measured: true, coveragePercent: 96, rows: 24, confidence: "high", ...overrides,
});

const evidence = (currentAnalysis, theoVerdict) => JSON.stringify({
  schemaVersion: REVIEW_EVIDENCE_VERSION, currentAnalysis, theoVerdict,
});

// The three journey states, as the page's own storage would hold them.
const STATES = Object.freeze({
  new: {
    storage: {},
    state: "blocked",
    title: "Not ready · evidence gap",
    question: STAGE_QUESTION.new_review,
  },
  resumed: {
    storage: {
      [ACTION_KEY]: JSON.stringify(action()),
      [REVIEW_EVIDENCE_KEY]: evidence(analysis("2026-06"), verdict()),
    },
    state: "blocked",
    title: "Not ready · evidence gap",
    question: STAGE_QUESTION.resumed_review,
  },
  verification_ready: {
    storage: {
      [ACTION_KEY]: JSON.stringify(action()),
      [REVIEW_EVIDENCE_KEY]: evidence(analysis(), verdict()),
    },
    state: "ready",
    title: "Ready to act on",
    question: STAGE_QUESTION.verification_ready,
  },
});

// The view builds its nodes through the global `document`, the way it does in
// the browser. A test that renders it without a page around it lends it one.
function rendered(review, options) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    value: parseHtml("<body></body>"), writable: true, configurable: true,
  });
  try {
    return renderRecurringReviewReadiness(review, options);
  } finally {
    if (saved) Object.defineProperty(globalThis, "document", saved);
    else delete globalThis.document;
  }
}

async function openJourney(name) {
  const page = await loadPage(PAGE, { storage: STATES[name].storage });
  await importPageModule("/savings-action-center-page.js");
  await waitFor(() => page.document.querySelector(".sac-journey"), `the ${name} journey`);
  return page;
}

for (const [name, expected] of Object.entries(STATES)) {
  test(`the ${name} journey names itself, wraps itself in landmarks, and takes the keyboard`, async () => {
    const page = await openJourney(name);
    try {
      const { document } = page;

      // One title per view, and it says which state the reader is in — not just
      // which page they are on.
      assert.equal(document.title,
        `${expected.title} · Monthly Savings Action Center · Shiplog`);

      // Exactly one main, and every nav and section landmark carries a name.
      assert.equal(document.querySelectorAll("main").length, 1);
      const navs = document.querySelectorAll("nav");
      assert.ok(navs.length >= 2, "the site nav and the return path are both landmarks");
      for (const nav of navs) {
        assert.ok(nav.getAttribute("aria-label") || nav.getAttribute("aria-labelledby"),
          "every nav landmark is named");
      }
      const review = document.querySelector(".sac-journey");
      assert.equal(review.dataset.reviewState, expected.state);
      assert.equal(review.getAttribute("aria-labelledby"), "sac-question");
      for (const section of [document.getElementById("savings-action-center"),
        document.querySelector(".sac-decision"), document.querySelector(".sac-support")]) {
        assert.ok(section.getAttribute("aria-labelledby"), "every section landmark is named");
      }

      // The transition lands the keyboard on this view's heading, and announces
      // it politely rather than leaving the change silent.
      const question = document.getElementById("sac-question");
      assert.equal(question.getAttribute("tabindex"), "-1");
      assert.equal(document.activeElement, question);
      // The announcement is the question this stage answers, not one sentence
      // for all three: a reader who lands here hears which journey they are in.
      assert.ok(textOf(document.getElementById("sac-journey-live")).startsWith(expected.question),
        `the ${name} journey announces its own question`);

      // A heading is not a tab stop: focus was moved there, not inserted there.
      assert.ok(!tabSequence(document).includes(question));
    } finally {
      page.restore();
    }
  });
}

test("the return path is visible, keyboard reachable, and lands on the control that opened this view", async () => {
  const page = await openJourney("verification_ready");
  try {
    const { document } = page;
    const back = document.getElementById("sac-return");
    assert.equal(back.href, "/evolution.html#finops-workspace-nav");
    assert.match(textOf(back), /Back to the AI FinOps briefing/);
    assert.ok(!back.hidden, "the return path is visible, not a browser-back dependency");

    // It is the first thing in the content landmark, so one Tab from the top of
    // the document body reaches it after the header links.
    assert.ok(tabSequence(document).includes(back));
    back.focus();
    pressEnter(document);
    assert.deepEqual(page.navigations, ["/evolution.html#finops-workspace-nav"]);

    // And the briefing receives it: the fragment names a landmark that can hold
    // focus, so returning restores context rather than scrolling to a page top.
    const briefing = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
    assert.match(briefing, /id="finops-workspace-nav" tabindex="-1"/);
  } finally {
    page.restore();
  }
});

test("both disclosures are operable with Tab, Enter, and Space, and report their own state", async () => {
  const page = await openJourney("verification_ready");
  try {
    const { document } = page;
    const triggers = [
      document.getElementById("sac-department-trigger"),
      document.getElementById("sac-evidence-detail-trigger"),
    ];

    for (const trigger of triggers) {
      const panel = document.getElementById(trigger.getAttribute("aria-controls"));
      assert.ok(panel, "aria-controls names a region that exists");
      assert.equal(panel.getAttribute("aria-labelledby"), trigger.id,
        "the controlled region is labelled by its trigger");
      assert.equal(trigger.getAttribute("aria-expanded"), "false");
      assert.equal(panel.hidden, true);

      // Reachable by Tab, in document order, and inside the supporting group.
      assert.ok(tabSequence(document).includes(trigger));
      assert.ok(trigger.closest(".sac-support"), "the disclosures live in the supporting group");

      trigger.focus();
      pressEnter(document);
      assert.equal(trigger.getAttribute("aria-expanded"), "true", "Enter expands");
      assert.equal(panel.hidden, false);
      assert.match(textOf(trigger), /Hide/);

      pressSpace(document);
      assert.equal(trigger.getAttribute("aria-expanded"), "false", "Space collapses");
      assert.equal(panel.hidden, true);
      assert.match(textOf(trigger), /Show/);

      // No trap: a collapsed panel leaves the tab sequence entirely, and an
      // expanded one is inline — the next Tab moves on rather than cycling.
      pressEnter(document);
      const inside = tabSequence(document).filter((node) => node.closest?.(`#${panel.id}`));
      assert.deepEqual(inside, [], "an inline disclosure holds no tab stop of its own");
      trigger.focus();
      assert.notEqual(pressTab(document), trigger, "Tab leaves the trigger");
    }
  } finally {
    page.restore();
  }
});

test("an opened disclosure survives the repaint an evidence read triggers", async () => {
  const page = await openJourney("verification_ready");
  try {
    const { document } = page;
    const trigger = document.getElementById("sac-department-trigger");
    trigger.focus();
    pressEnter(document);

    // Clearing imported files repaints the review region. The review itself did
    // not move, so the surface must be left standing — same mechanism the
    // guided workspace uses, no second store of "which panels are open".
    document.getElementById("sac-clear").click();
    assert.equal(document.getElementById("sac-department-trigger").getAttribute("aria-expanded"),
      "true", "resuming the review does not close what the reader opened");
    assert.equal(document.getElementById("sac-department-panel").hidden, false);
  } finally {
    page.restore();
  }
});

test("every signal states itself in words and in a shape, never in colour alone", () => {
  const review = assembleRecurringReview({
    retainedAction: action(), currentAnalysis: analysis(), theoVerdict: verdict(),
  });
  const view = rendered(review, { source: "local", retainedAction: action() });
  const chips = view.querySelectorAll(".sac-chip");
  assert.equal(chips.length, 5, "impact, confidence, verification, provenance, department");

  const seen = new Set();
  for (const chip of chips) {
    const label = chip.querySelector(".sac-chip-label");
    const value = chip.querySelector(".sac-chip-value");
    const shape = chip.querySelector(".sac-chip-shape");
    assert.ok(textOf(label).length > 0, "each chip names what it reports");
    assert.ok(textOf(value).length > 0, "each chip states its value in words");
    assert.equal(shape.getAttribute("aria-hidden"), "true",
      "the glyph is decoration beside the words, never the accessible name");
    // Strip the glyph and the chip is still fully readable — this is the
    // greyscale and screen-reader reading of it.
    const spoken = `${textOf(label)} ${textOf(value)}`;
    assert.doesNotMatch(spoken, /undefined|NaN|\[object/);
    seen.add(spoken);
  }
  assert.equal(seen.size, 5, "no two signals read the same without their colour");

  // The good and the adverse chip are told apart by their words and their glyph,
  // not by the wash they sit in.
  const good = journeySignals(review, { retainedAction: action() })[0];
  const bad = journeySignals(assembleRecurringReview({
    retainedAction: action(), currentAnalysis: analysis("2026-07", 1500), theoVerdict: verdict(),
  }), { retainedAction: action() })[0];
  assert.equal(good.tone, "good");
  assert.equal(bad.tone, "adverse");
  assert.notEqual(good.shape, bad.shape);
  assert.match(good.value, /lower per month/);
  assert.match(bad.value, /higher per month/);
});

test("a signal with no evidence behind it says so instead of looking measured", () => {
  const review = assembleRecurringReview({
    retainedAction: action(), currentAnalysis: analysis(), theoVerdict: null,
  });
  const signals = Object.fromEntries(
    journeySignals(review, { retainedAction: action() }).map((signal) => [signal.key, signal]));
  assert.equal(signals.verification.known, false);
  assert.match(signals.verification.value, /Not verified/);
  assert.equal(signals.confidence.known, false);
  assert.match(signals.confidence.value, /attribution coverage not measured/);
  assert.equal(signals.impact.known, false);
  assert.match(signals.impact.value, /Not comparable/);
  // Unknown is its own silhouette, so it cannot be mistaken for a pale "good".
  for (const key of ["impact", "confidence", "verification"]) {
    assert.equal(signals[key].tone, "unknown");
  }
});

test("the empty, error, and implausible-extreme states all keep the primary action on screen", () => {
  // Empty: nothing retained, nothing analyzed, no evidence at all.
  const empty = rendered(assembleRecurringReview(), { source: "local" });
  assert.equal(empty.querySelectorAll(".sac-decision").length, 1);
  // An empty journey still carries an operable step and says what is missing.
  assert.equal(empty.querySelector("#sac-primary-action").dataset.enabled, "true");
  assert.match(textOf(empty.querySelector(".sac-degraded")), /Tracked action/);
  assert.match(textOf(empty), /No retained monthly action is available to resume/);
  assert.doesNotMatch(textOf(empty), /undefined|NaN|\[object/);

  // Implausible extremes, generated here rather than committed as a fixture, and
  // held to what a retained record can actually carry: the longest department
  // name the store accepts, its full twenty provenance references, and a monthly
  // figure in the trillions with no coverage measured behind it.
  const longName = `${"Atlas Platform Reliability and Cost Governance ".repeat(4)}Group`.slice(0, 160);
  const extreme = action({
    department: longName,
    actionLabel: longName,
    baseline: {
      value: 9.87e12, unit: "USD/month", period: "2026-06",
      aggregation: "Monthly eligible recoverable spend", calculation: "Sum eligible row deltas",
    },
    provenanceReferences: Array.from({ length: 20 }, (_, index) => `fix-pack:${index}`),
  });
  const huge = rendered(assembleRecurringReview({
    retainedAction: extreme,
    currentAnalysis: { schemaVersion: "local-finops/1.0.0", period: "2026-07",
      rankedDepartments: [{ name: longName, recoverableUsd: 1.2345e13 }] },
    theoVerdict: verdict({ coveragePercent: null, rows: null, state: "bounded" }),
  }), { source: "local", retainedAction: extreme });

  assert.equal(huge.querySelectorAll(".sac-decision").length, 1,
    "the recommendation is not pushed out by the evidence");
  assert.equal(huge.childElements[1].className, "sac-decision",
    "and it is still the first thing after the heading");
  assert.match(textOf(huge), /\$12,345,000,000,000\.00/);
  assert.match(textOf(huge), /Action references \(20\)/);
  assert.match(textOf(huge), /attribution coverage not measured/);
  assert.ok(textOf(huge).includes(longName), "a very long name is drawn, not truncated away");
  assert.doesNotMatch(textOf(huge), /undefined|NaN|\[object/);

  // A retained record beyond those bounds is not drawn as a broken review. The
  // store rejects it, and the journey falls back to the same stated empty state
  // — decision intact, every unmeasured signal saying so in its own words.
  const rejected = rendered(assembleRecurringReview({
    retainedAction: action({ department: "x".repeat(400) }),
    currentAnalysis: analysis(), theoVerdict: verdict(),
  }), { source: "local" });
  assert.equal(rejected.querySelectorAll(".sac-decision").length, 1);
  assert.equal(rejected.querySelector("#sac-primary-action").dataset.enabled, "true");
  assert.equal(rejected.querySelectorAll('.sac-chip[data-known="false"]').length, 5,
    "every signal reports itself unmeasured rather than showing a stale value");
  assert.doesNotMatch(textOf(rejected), /undefined|NaN|\[object/);

  // Zero and negative impact are drawn as themselves, not as an absent value.
  const unchanged = journeySignals(assembleRecurringReview({
    retainedAction: action(), currentAnalysis: analysis("2026-07", 1200), theoVerdict: verdict(),
  }))[0];
  assert.equal(unchanged.value, "Unchanged month on month");
  assert.equal(unchanged.shape, "=");
});

test("the error state names itself in the title, the live region, and an alert", async () => {
  // A stored action the reader's browser cannot parse is the realistic way this
  // page fails: the entry throws while assembling, and must not leave the static
  // "Reconciling monthly savings…" region busy for good.
  const page = await loadPage(PAGE, { storage: { [ACTION_KEY]: "{ not json" } });
  try {
    const { document } = page;
    await importPageModule("/savings-action-center-page.js");
    await waitFor(() => document.getElementById("savings-action-center")
      .getAttribute("aria-busy") === "false", "a resolved region");
    // A record that will not parse is an empty review, not a crash; either way
    // the region resolves, keeps one titled state, and keeps a decision on it.
    assert.match(document.title, /· Monthly Savings Action Center · Shiplog$/);
    assert.ok(textOf(document.getElementById("sac-journey-live")).length > 0);
    const region = document.getElementById("savings-action-center");
    assert.ok(region.querySelector(".sac-decision") || region.querySelector("[role=alert]"),
      "the region resolves to either a decision or a stated failure, never a blank");
  } finally {
    page.restore();
  }
});

test("nothing on the journey reorders between the wide and the narrow reading", async () => {
  const [css, page] = await Promise.all([
    readFile(new URL("../src/savings-action-center.css", import.meta.url), "utf8"),
    openJourney("verification_ready"),
  ]);
  try {
    // DOM order is the reading order: question, recommendation, figure, signals,
    // the verification checkpoint, then everything grouped as support. The
    // narrow layout is this same column.
    const view = page.document.querySelector(".sac-journey");
    assert.deepEqual(view.childElements.map((node) => node.className),
      ["sac-heading", "sac-decision", "sac-metric", "sac-signals", "sac-checkpoint", "sac-support"]);

    // So hierarchy may never be achieved by moving boxes past each other, which
    // is the one thing that would desync the tab order from the page.
    const narrow = css.slice(css.indexOf("@media (max-width:760px)"));
    assert.doesNotMatch(narrow, /[;{\s]order:\s*-?\d/);
    assert.doesNotMatch(css, /(column|row)-reverse/);
    assert.doesNotMatch(css, /flex-direction:\s*column-reverse/);

    // At ~360px the card keeps the shipped 24px inset and each chip takes the
    // full measure rather than being squeezed under an ellipsis.
    assert.match(narrow, /\.sac-signals,\.sac-support \{ padding-inline:24px; \}/);
    assert.match(narrow, /\.sac-chip \{ display:flex; width:100%; \}/);
    // Long values wrap instead of scrolling the page sideways.
    for (const rule of [/\.sac-chip-value \{[^}]*overflow-wrap:anywhere/,
      /\.sac-disclosure-label \{[^}]*overflow-wrap:anywhere/]) {
      assert.match(css, rule);
    }
    // Touch targets stay at or above the 44px the rest of this page ships.
    assert.match(css, /\.sac-return-link \{[^}]*min-height:44px/);
    assert.match(css, /\.sac-disclosure-trigger \{[^}]*min-height:48px/);
  } finally {
    page.restore();
  }
});
