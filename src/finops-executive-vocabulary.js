// Reader-facing confidence language for the FinOps executive surfaces.
//
// This file owns words, not scoring. A scoring module selects a stable key and
// every first paint, runtime render and destination reads the exact text below.
// Keeping the copy separate makes vocabulary review possible without hiding a
// threshold change inside a prose edit.

export const FINOPS_EXECUTIVE_CONFIDENCE = Object.freeze({
  high: Object.freeze({
    label: "High confidence",
    wording: "The pricing basis is independently checkable and complete enough to support a decision.",
    raise: "Keep the cited source, destination coverage, required fields, and effective dates current.",
  }),
  moderate: Object.freeze({
    label: "Moderate confidence",
    wording: "The pricing basis is usable with a material evidence limitation.",
    raise: "Resolve the largest weighted evidence gap named in the audit disclosure.",
  }),
  limited: Object.freeze({
    label: "Limited confidence",
    wording: "The pricing basis is directional and should be checked before committing spend.",
    raise: "Add a citable price source, then fill the uncovered destinations and required fields.",
  }),
  insufficient: Object.freeze({
    label: "Insufficient confidence",
    wording: "The pricing basis is not supported well enough for an executive decision.",
    raise: "Provide a citable rate card that covers the priced destinations and states its effective dates.",
  }),
});

// Implementation identifiers belong in code and audit evidence, not in the
// executive reading path. Keep the pattern as data so build verification can
// compile a fresh global RegExp for every text node without sharing mutable
// `lastIndex` state with a browser renderer or another test.
export const FINOPS_EXECUTIVE_BANNED_TOKEN_SHAPES = Object.freeze([
  Object.freeze({
    id: "versioned-internal-name",
    pattern: String.raw`\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\/v?\d+\.\d+\.\d+\b`,
    flags: "i",
    replacement: "the published method",
  }),
]);
