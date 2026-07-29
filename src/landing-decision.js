// The one decision summary the front door carries.
//
// WHY THIS MODULE EXISTS
// ----------------------
// The landing page leads with AI FinOps, and a surface that leads with a
// decision has to show one. Not a promise of one, not four cards that each
// hold a fragment of one, and not a spinner over a fetch: one complete
// summary, on arrival, carrying the six things a decision is made of — the
// question it answers, the material benchmark, the prioritized action, the
// impact, the confidence, and the provenance.
//
// EVERY FIGURE IS REBUILT, NONE IS AUTHORED
// -----------------------------------------
// The summary is `buildExecutiveBriefing()` applied to the three synthetic
// periods `executive-briefing-sample.js` carries, which are field-for-field
// the canonical fixture's own `input.retainedPeriods`. So the landing page
// draws the published briefing rather than a hand-copied summary of it: a
// contract that moves under this module fails loudly here and in
// `scripts/verify-build.mjs`, instead of leaving a stale number on the one
// screen every visitor sees first.
//
// The composition is total. A contract violation resolves to the
// `unavailable` state with the violation in it rather than throwing, because
// the hero's two ways on sit outside this region and a region that vanishes
// takes the reader's next step with it.
//
// NOTHING OF THE READER'S IS TOUCHED. This module reads no storage, makes no
// request, reads no clock, draws no random value, and writes nothing back —
// which is why the same three periods produce the same summary on every load.
// The reader's *own* retained periods are briefed on a page of their own, at
// /executive-briefing.html, and this module deliberately does not reach for
// them: the front door's first screen is the same for everyone, and a summary
// that silently switched sources would be two claims wearing one heading.
//
// Every string below is plain text. This module builds no nodes;
// `executive-briefing-view.js` owns the DOM.

import {
  buildExecutiveBriefing, validateExecutiveBriefing,
} from "./executive-finops-briefing.js";
import {
  SAMPLE_DISCLOSURE, SAMPLE_LABEL, SAMPLE_PROVENANCE_NOTE, sampleRetainedPeriods,
} from "./executive-briefing-sample.js";
import { scanRetainedContent } from "./finops-workspace.js";

/** Bump when a slot, a state word, or a label changes meaning. */
export const LANDING_DECISION_VERSION = "landing-decision-summary/1.0.0";

/** The element ids this module's page entry owns. Nothing else writes them. */
export const LANDING_DECISION_IDS = Object.freeze({
  region: "landing-decision",
  mount: "landing-decision-summary",
  actions: "landing-decision-actions",
});

/** The two states the composition resolves into. It never throws. */
export const LANDING_DECISION_STATE = Object.freeze({
  ready: "ready",
  unavailable: "unavailable",
});

/**
 * Where the figures came from, in the masthead rather than in a footnote.
 *
 * A reader deciding whether a number is theirs must not have to open anything
 * to find out, so the sentence travels with the document — on screen and on
 * paper both.
 */
export const LANDING_DECISION_ORIGIN =
  "Rebuilt on this page from the synthetic periods this site ships, by the contract that builds the "
  + "same briefing from your own imported figures. Nothing was fetched, uploaded, or stored.";

/**
 * The six things this summary is required to carry, named once so the region,
 * its tests, and anyone reading this file hold one list rather than three.
 * Each names the briefing field that answers it.
 */
export const LANDING_DECISION_SLOTS = Object.freeze([
  Object.freeze({ id: "question", field: "questions", label: "The question it answers" }),
  Object.freeze({ id: "impact", field: "recoverable", label: "How much is indicated" }),
  Object.freeze({ id: "benchmark", field: "benchmark", label: "Material benchmark" }),
  Object.freeze({ id: "action", field: "nextAction", label: "Prioritized action" }),
  Object.freeze({ id: "confidence", field: "confidence", label: "Confidence" }),
  Object.freeze({ id: "provenance", field: "provenance", label: "Provenance" }),
]);

/** What the region says when the shipped contract and its sample disagree. */
export const LANDING_DECISION_UNAVAILABLE = Object.freeze({
  summary: "The example decision failed its own contract",
  remedy: "No figure is shown, because a summary that fails the contract it declares cannot be quoted. "
    + "Analyzing your own export in AI FinOps is unaffected, and nothing of yours was read.",
});

/**
 * Diagnostics that may cross the composition boundary.
 *
 * Retained records are aggregate-only by contract, but every value is still
 * treated as untrusted. Validator and exception messages can quote the value
 * they rejected, so they are useful in a developer log and unsafe in a
 * judge-facing or executive-facing result. Only a bounded machine code and a
 * structural path survive here; the rejected value and raw message do not.
 */
const SAFE_DIAGNOSTIC_TOKEN = /^[a-z0-9_.[\]-]{1,120}$/i;
const WITHHELD_DIAGNOSTIC = "Contract validation failed; rejected values and raw messages were withheld.";

export function safeLandingDecisionViolations(violations, fallbackCode = "contract_invalid") {
  const source = Array.isArray(violations) && violations.length
    ? violations : [{ code: fallbackCode, path: "" }];
  return Object.freeze(source.map((violation) => Object.freeze({
    code: SAFE_DIAGNOSTIC_TOKEN.test(String(violation?.code ?? ""))
      ? String(violation.code) : fallbackCode,
    path: SAFE_DIAGNOSTIC_TOKEN.test(String(violation?.path ?? ""))
      ? String(violation.path) : "",
    detail: WITHHELD_DIAGNOSTIC,
  })));
}

/**
 * Which of the six slots this briefing actually filled.
 *
 * A slot is present when the briefing carries the field that answers it. The
 * summary is only worth leading a page with when all six are — anything less
 * is a partial answer wearing a decision's heading — so the page entry and its
 * tests check this rather than counting nodes.
 */
export function landingDecisionSlots(briefing) {
  const filled = (id) => {
    if (!briefing) return false;
    switch (id) {
      case "question": return Boolean(briefing.questions?.[0]?.question);
      case "impact": return Boolean(briefing.recoverable);
      case "benchmark": return Boolean(briefing.benchmark?.eligible);
      case "action": return Boolean(briefing.nextAction?.statement);
      case "confidence": return Boolean(briefing.confidence?.level);
      case "provenance": return Boolean(briefing.provenance?.dataset);
      default: return false;
    }
  };
  return Object.freeze(LANDING_DECISION_SLOTS.map((slot) => Object.freeze({ ...slot, present: filled(slot.id) })));
}

/**
 * Build the one summary this page draws.
 *
 * @returns `{ state, briefing, slots, violations, render }` — `render` is the
 *   option bag `renderExecutiveBriefingPreview` takes, so the entry module
 *   decides nothing about labelling either. On the unavailable path `briefing`
 *   is null and `violations` names what broke.
 */
export function composeLandingDecision(retainedPeriods = sampleRetainedPeriods()) {
  // Scan before derivation. A contract that simply ignores an unknown `prompt`
  // field would otherwise appear safe only because it happened not to copy the
  // value; judge inputs must be rejected or redacted before any scoring step,
  // not cleaned out of the result afterwards.
  const inputScan = scanRetainedContent(retainedPeriods, "retainedPeriods");
  if (!inputScan.ok) {
    return Object.freeze({
      state: LANDING_DECISION_STATE.unavailable,
      briefing: null,
      slots: landingDecisionSlots(null),
      violations: safeLandingDecisionViolations(inputScan.violations, "input_refused"),
      render: null,
    });
  }

  let briefing = null;
  try {
    briefing = buildExecutiveBriefing(retainedPeriods);
  } catch {
    return Object.freeze({
      state: LANDING_DECISION_STATE.unavailable,
      briefing: null,
      slots: landingDecisionSlots(null),
      violations: safeLandingDecisionViolations(null, "build_failed"),
      render: null,
    });
  }

  const verdict = validateExecutiveBriefing(briefing);
  if (!verdict.valid) {
    return Object.freeze({
      state: LANDING_DECISION_STATE.unavailable,
      briefing: null,
      slots: landingDecisionSlots(null),
      violations: safeLandingDecisionViolations(verdict.violations),
      render: null,
    });
  }

  return Object.freeze({
    state: LANDING_DECISION_STATE.ready,
    briefing,
    slots: landingDecisionSlots(briefing),
    violations: [],
    render: Object.freeze({
      origin: LANDING_DECISION_ORIGIN,
      provenanceNote: SAMPLE_PROVENANCE_NOTE,
      synthetic: Object.freeze({ label: SAMPLE_LABEL, disclosure: SAMPLE_DISCLOSURE }),
    }),
  });
}
