/**
 * The executive decision contract for the returning FinOps Workspace.
 *
 * This is configuration consumed by the product, not UI copy parked in a
 * document. It fixes the questions, their order, the evidence threshold, and
 * the things this view must not imply. A view may choose typography; it may not
 * choose a different meaning.
 */
export const TRACK_RECORD_CONTRACT_VERSION = "finops-track-record/1.0.0";

export const TRACK_RECORD_DECISION_CONTRACT = Object.freeze({
  version: TRACK_RECORD_CONTRACT_VERSION,
  views: Object.freeze([
    Object.freeze({
      id: "commitment-verdict",
      order: 1,
      question: "Did what we committed to work?",
      answers: "Whether the retained commitment was met, partially met, or missed.",
      requires: "At least two complete prior monthly periods and a readable retained commitment.",
      leavesOut: "No verdict from estimates, incomplete periods, synthetic examples, or a missing commitment.",
    }),
    Object.freeze({
      id: "period-movement",
      order: 2,
      question: "What changed in the latest complete month?",
      answers: "Absolute and percentage movement from the immediately preceding complete period.",
      requires: "At least two complete prior monthly periods on the agreed cost basis.",
      leavesOut: "No forecast, causal claim, realized-saving claim, or comparison to an incomplete period.",
    }),
    Object.freeze({
      id: "next-action",
      order: 3,
      question: "What should I do next?",
      answers: "One action selected from the evidence and recovery paths available now.",
      requires: "The evidence state and portable-record availability.",
      leavesOut: "No action list and no control that does not resolve the stated evidence gap.",
    }),
  ]),
  metrics: Object.freeze({
    completePeriod: Object.freeze({
      rule: "An imported (not estimated) entry with a canonical YYYY-MM period and finite analyzed spend in USD.",
      minimumForVerdict: 2,
    }),
    movement: Object.freeze({
      costBasis: "analyzed_spend_usd",
      selection: "Sort complete periods ascending; compare the last with the entry immediately before it.",
      absoluteChange: "latest analyzed spend USD minus preceding analyzed spend USD.",
      percentageChange: "absolute change divided by preceding analyzed spend USD, multiplied by 100.",
      rounding: "Keep unrounded values in state; display USD to cents and percentage to one decimal place.",
      unavailableWhen: "Fewer than two complete periods, preceding analyzed spend is zero, or the "
        + "retained periods span more than one provider scope — two sets of books do not sum "
        + "into one movement.",
    }),
  }),
  actions: Object.freeze({
    portable: Object.freeze({
      code: "import-portable-record", label: "Import your portable record",
      href: "#local-lead-portability-import",
      // The one action with a precondition: a surface that ships no portable
      // import path must never offer it. Supplied to the model as the
      // `portableRecordAvailable` input, never sniffed out of the document.
      offeredWhen: "portableRecordAvailable",
    }),
    addMonth: Object.freeze({ code: "add-month", label: "Add a month", href: "#local-import" }),
    startFresh: Object.freeze({ code: "start-fresh", label: "Start fresh", href: "#local-import" }),
  }),
  /**
   * ORDERING IS CONFIGURATION, NOT A BRANCH IN A VIEW.
   *
   * One ordered list per evidence state, most prioritized first; the consumer
   * takes the first entry whose precondition holds. Keyed by the state ids in
   * `finops-track-record.js` — the coupling is pinned by a test rather than an
   * import, because that module reads this file and a cycle helps nobody.
   *
   * The states that are NOT listed here are the ones with sufficient evidence:
   * their next step is the next commitment, which is a different surface's
   * action and not a recovery path from a gap.
   */
  returnActions: Object.freeze({
    rule: "Take the first listed action whose precondition holds. A retained-but-insufficient "
      + "record prioritizes the portable record over adding a month; a browser keeping nothing "
      + "has no record to carry, so it starts fresh.",
    // Nothing but state ids in here, so a consumer can iterate it whole.
    byState: Object.freeze({
      "no-track-record": Object.freeze(["startFresh"]),
      "single-period": Object.freeze(["portable", "addMonth"]),
      "awaiting-actuals": Object.freeze(["portable", "addMonth"]),
    }),
  }),
});

