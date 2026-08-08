// THE READING ORDER OF THE FIRST-ANALYSIS DECISION, as data (#1394).
//
// The readiness model (finops-analysis-readiness.js) decides what is true. This
// module decides only what a reader meets first, second and third, and it emits
// that as one ordered record so the order lives in one place instead of in the
// order somebody happened to author the markup in. DECISION_ORDER below is the
// order, and tests/finops-first-analysis-decision.test.js asserts the shipped
// document's own children against it — so a node moved in evolution.html
// without moving here is a failing test rather than a silent reflow.
//
// WHY NO CSS `order`, no absolute positioning and no reversed flex is used to
// achieve it: the visual order and the focus order have to be the same
// sequence, and every one of those tools desynchronizes them. The sequence is
// therefore the DOM's, at every width.
//
// COLOUR IS NEVER THE ONLY CARRIER. Every cue this module emits carries a
// `label` and a `value` in words, and a `shape` glyph, before it carries a
// `tone`. Deleting the tone leaves each cue saying the same thing, which is the
// property tests assert rather than the palette.
//
// IT DECIDES NOTHING AND RANKS NOTHING. No figure is computed here, no action
// is chosen here, and no threshold is applied to money except the plausibility
// guard below — which flags a value for the reader and never rewrites it.
export const DECISION_CONTRACT = "finops-first-analysis-decision/1.0.0";

/** The five regions, in the one order a reader meets them. */
export const DECISION_ORDER = Object.freeze([
  "analysis-readiness-scenario",
  "analysis-readiness-finding",
  "analysis-readiness-cues",
  "analysis-readiness-act",
  "analysis-readiness-how-we-know",
]);

export const DECISION_STATE = Object.freeze({
  LOADING: "loading",
  READY: "ready",
  EMPTY: "empty",
  ERROR: "error",
});

// A DEMO SURFACE'S OWN PLAUSIBILITY RANGE, stated so an implausible fixture is
// LABELLED rather than laid out as if it were credible. A bundled scenario that
// models more than a hundred million dollars of recoverable spend in one
// fixture period, or a negative one, is a broken fixture; the reader is told
// so, in words, beside the figure, and the figure is still shown in full.
export const PLAUSIBLE_MAX_USD = 100000000;

const SHAPE = Object.freeze({
  ready: "●", illustrative_only: "◐", insufficient: "○",
  scale: "▰", source: "◇", flag: "▲", pending: "◌",
});

const chip = (id, kind, tone, shape, label, value) => Object.freeze({
  id, kind, tone, shape, label, value,
});

const isReadiness = (value) => typeof value?.version === "string"
  && value.version.startsWith("finops-analysis-readiness/");

/** Band a 0–100 score onto the three tones this page's chips already ship. */
const scoreTone = (value) => (value >= 75 ? "ok" : value >= 50 ? "warn" : "error");

const LEVEL_WORD = Object.freeze({
  ready: "organization-specific",
  illustrative_only: "illustrative only",
  insufficient: "not supported",
});

/**
 * Is this money figure inside the range a bundled demo can plausibly model?
 *
 * Non-finite, negative and absurdly large are all one answer — "do not read
 * this as a credible number" — and all three keep the value on screen.
 */
export function implausibleFigure(value) {
  return !Number.isFinite(value) || value < 0 || value > PLAUSIBLE_MAX_USD;
}

const loading = () => Object.freeze({
  contract: DECISION_CONTRACT, state: DECISION_STATE.LOADING, level: "pending",
  scenario: "Reading one bundled provider-export-shaped scenario.",
  finding: Object.freeze({
    label: "Primary finding", available: false, value: "Not analysed yet",
    basis: "Working out whether the bundled evidence supports a recommendation.",
  }),
  cues: Object.freeze([
    chip("analysis-readiness-level", "signal", "neutral", SHAPE.pending,
      "Readiness", "not scored yet"),
  ]),
  action: Object.freeze({
    label: "Recommended next action",
    text: "No action is quoted until the bundled scenario has been read.",
    basis: "Its evidence is one press down, under “Why we think so”.",
  }),
  limitation: "No conclusion about your organization is supported.",
  detail: Object.freeze({
    figure: "Not read yet.", actionConfidence: "Not read yet.",
    reason: "Not read yet.", provenance: "Bundled synthetic fixture.",
    evidenceConfidence: "Not computed yet.", evidenceHeld: "Not assessed yet.",
  }),
  supporting: Object.freeze(["The bundled scenario has not been read yet."]),
  status: "Reading the bundled scenario.",
});

const failed = (error) => {
  const code = typeof error?.code === "string" ? error.code : "analysis_failed";
  const message = typeof error?.message === "string" && error.message.trim()
    ? error.message.trim()
    : "The bundled scenario registry refused this request.";
  return Object.freeze({
    contract: DECISION_CONTRACT, state: DECISION_STATE.ERROR, level: "insufficient",
    scenario: `No scenario was analysed${error?.scenarioId ? ` (asked for ${error.scenarioId})` : ""}.`,
    finding: Object.freeze({
      label: "Primary finding", available: false,
      value: "The analysis did not complete",
      basis: message,
    }),
    cues: Object.freeze([
      chip("analysis-readiness-level", "signal", "error", SHAPE.flag,
        "Analysis", `failed · ${code}`),
      chip("analysis-readiness-provenance-cue", "classification", "neutral", SHAPE.source,
        "Provenance", "no bundled scenario was read"),
    ]),
    action: Object.freeze({
      label: "Recommended next action",
      text: "None. A failed analysis recommends nothing.",
      basis: "Choose a registered bundled scenario and read the analysis again.",
    }),
    limitation: "No conclusion about your organization, and none about the"
      + " bundled scenario either: nothing was analysed.",
    detail: Object.freeze({
      figure: "No figure: the analysis did not complete.",
      actionConfidence: "No action confidence: no action was derived.",
      reason: message, provenance: `Refusal code ${code}.`,
      evidenceConfidence: "No evidence confidence: no dataset was read.",
      evidenceHeld: "No evidence categories were assessed.",
    }),
    supporting: Object.freeze([message]),
    status: `The first analysis did not complete: ${message}`,
  });
};

/**
 * Shape one first-analysis outcome into the page's reading order.
 *
 * Accepts what the page already has: the bundled-scenario envelope
 * (`{ ok, readiness, scenarioId }`), a bare readiness model, or nothing at all
 * — which is the loading state, and is what the document ships authored.
 */
export function firstAnalysisDecision(outcome, { scenarioIds = [] } = {}) {
  if (!outcome) return loading();
  if (outcome.ok === false) return failed(outcome.error);
  const readiness = isReadiness(outcome) ? outcome : outcome.readiness;
  if (!isReadiness(readiness)) return loading();

  const step = readiness.recommendation;
  const scenarioId = typeof outcome.scenarioId === "string" ? outcome.scenarioId : null;
  const index = scenarioId ? scenarioIds.indexOf(scenarioId) : -1;
  const format = outcome.providerExportShape?.format;
  // REGION 1 — the scenario choice, named rather than implied. It says which of
  // the bundled scenarios this analysis read, so a reader can tell a figure
  // that moved because the evidence changed from one that moved because the
  // scenario did. It names no vendor the registry has not already published,
  // and it asks for nothing.
  const scenario = [
    index >= 0 ? `Bundled scenario ${index + 1} of ${scenarioIds.length}` : "Bundled scenario",
    scenarioId, format ? `${format} provider-export shape` : null,
    "sanitized invented records; no customer data",
  ].filter(Boolean).join(" · ") + ".";

  const level = readiness.level;
  const cues = [
    chip("analysis-readiness-level", "signal",
      level === "ready" ? "ok" : level === "illustrative_only" ? "warn" : "error",
      SHAPE[level] ?? SHAPE.pending, "Readiness",
      `${LEVEL_WORD[level] ?? level} · ${readiness.score.value}/100`
      + ` · ${readiness.score.numerator} of ${readiness.score.denominator} categories`),
    chip("analysis-readiness-evidence-cue", "signal", scoreTone(readiness.confidence.value),
      SHAPE.scale, "Evidence confidence", `${readiness.confidence.value}/100`),
    chip("analysis-readiness-action-cue", "signal",
      step ? (Number.isFinite(step.confidence) ? scoreTone(step.confidence) : "neutral") : "error",
      SHAPE.scale, "Action confidence",
      !step ? "no action to score"
        : Number.isFinite(step.confidence) ? `${step.confidence}/100`
          : "not published by the fixture"),
    chip("analysis-readiness-provenance-cue", "classification", "neutral", SHAPE.source,
      "Provenance", step ? "bundled synthetic fixture" : "bundled synthetic fixture; no action"),
  ];

  if (!step) {
    return Object.freeze({
      contract: DECISION_CONTRACT, state: DECISION_STATE.EMPTY, level, scenario,
      finding: Object.freeze({
        label: "Primary finding", available: false,
        value: "No finding met the eligibility rule",
        basis: readiness.supportedConclusion,
      }),
      cues: Object.freeze(cues),
      action: Object.freeze({
        label: "Recommended next action",
        text: "None. A scenario with no eligible finding recommends nothing.",
        basis: "The evidence categories that would produce one are listed under"
          + " “Assumptions, and what later evidence would enable”.",
      }),
      limitation: readiness.limitation,
      detail: Object.freeze({
        figure: "No figure: no eligible bundled action.",
        actionConfidence: "No action confidence: no action was derived.",
        reason: "No eligible bundled action.",
        provenance: "Bundled synthetic fixture.",
        evidenceConfidence: `${readiness.confidence.value}/100. ${readiness.confidence.rule}`,
        evidenceHeld: readiness.currentEvidence,
      }),
      supporting: Object.freeze(upgradeLines(readiness)),
      status: `Zero findings: ${readiness.supportedConclusion}`,
      figureFlagged: false,
    });
  }

  // REGION 2 — the one primary finding, at the top of this surface's type
  // scale. The money and the department it belongs to are ONE string so a
  // screen reader speaks them together, and the department name is never
  // shortened: a name too long for its column wraps, because a truncated
  // department is a finding about a department nobody can identify.
  const flagged = implausibleFigure(step.figure?.value);
  if (flagged) {
    cues.splice(1, 0, chip("analysis-readiness-figure-cue", "signal", "warn", SHAPE.flag,
      "Figure", step.figure?.value < 0
        ? "negative recoverable spend — implausible for a demo scenario"
        : "outside the plausible demo range — implausible fixture"));
  }

  return Object.freeze({
    contract: DECISION_CONTRACT, state: DECISION_STATE.READY, level, scenario,
    finding: Object.freeze({
      label: "Primary finding", available: true,
      value: `${step.figure.text} recoverable in ${step.department}`,
      basis: readiness.supportedConclusion,
    }),
    cues: Object.freeze(cues),
    // REGION 4 — what to do, in its own marked block, distinct from the
    // evidence for it. It names the page's ONE operable action control rather
    // than shipping a second copy of it: #1020 closed the defect where several
    // regions each answered "what first?" with a ranking of their own.
    action: Object.freeze({
      label: "Recommended next action · rank 1",
      text: `${step.action} in ${step.department}`,
      basis: "Act on it with this page's one action control, at the top of the"
        + " page; its evidence is one press down, under “Why we think so”.",
    }),
    limitation: readiness.limitation,
    detail: Object.freeze({
      figure: `${step.figure.text} of ${step.figure.metricName} over ${step.figure.period}.`,
      actionConfidence: Number.isFinite(step.confidence)
        ? `${step.confidence}/100, from the quoted fixture action.`
        : "Not published by the fixture.",
      reason: step.reason,
      provenance: step.provenance,
      evidenceConfidence: `${readiness.confidence.value}/100. ${readiness.confidence.rule}`,
      evidenceHeld: readiness.currentEvidence,
    }),
    supporting: Object.freeze(upgradeLines(readiness)),
    status: `${readiness.supportedConclusion} Recommended next action:`
      + ` ${step.action} in ${step.department}.`,
    figureFlagged: flagged,
  });
}

/** The assumptions the surface must state, then what later evidence would add. */
function upgradeLines(readiness) {
  const upgrades = (readiness.upgrades ?? []).map((upgrade) =>
    `${upgrade.category} — reduces ${upgrade.reduces}; enables ${upgrade.enables}.`);
  return [
    "Assumption: every value here is an invented, sanitized fixture record.",
    `Assumption: ${readiness.limitation}`,
    ...(upgrades.length ? upgrades
      : ["Every required evidence category is already sufficient for this scenario."]),
  ];
}
