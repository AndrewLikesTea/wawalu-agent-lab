// Every word the briefing and evidence panels say when they have no figure.
//
// A panel with an answer in it is written by the module that computed the
// answer. A panel *without* one used to be written wherever the branch happened
// to be — a `setText(… "Unavailable")` in `evolution-page.js`, a ternary in
// `local-import-flow.js` — and the result was three different vocabularies for
// the same nothing, plus a bare "Unavailable" that tells a reader neither what
// is missing nor what to do about it.
//
// This module is the one place those sentences live. Three rules hold for every
// string in it:
//
//   1. **Name the missing input.** Not "Unavailable" — "the bundled sample file
//      could not be read". A reader has to be able to tell a fetch that failed
//      from a period with no departments in it from a file they never imported.
//   2. **Give exactly one next action, and name the control by its label.** The
//      retry button on this page reads "Retry bundled analysis", so the copy
//      says that, not "try again".
//   3. **Partial coverage names who is missing.** A grade over some of the
//      spend is a different claim from a grade over all of it, and a reader
//      cannot judge it without knowing which departments sat outside the
//      sample.
//
// Everything here is plain text. Nothing in this module builds a node, and no
// caller may hand a string from it to `innerHTML` — the appliers below write
// through `textContent` for exactly that reason.

/**
 * The three states the local briefing has before it has an answer.
 *
 * `local-import-flow.js` re-exports this so its own callers are unchanged; the
 * copy itself is owned here.
 */
export const BRIEFING_STATE_MESSAGE = Object.freeze({
  loading: "Computing this briefing from the records in this tab…",
  empty: "No provider export is imported, so there is no briefing yet. "
    + "Import a provider export above to produce the headline finding and prioritized action.",
  error: "This briefing could not be computed from the imported records. "
    + "Nothing was uploaded. Check the column mapping above and analyze again.",
});

/** The page-level bundled-analysis lifecycle copy. */
export const BUNDLED_LOAD_STATE = Object.freeze({
  loading: Object.freeze({
    title: "Loading bundled analysis…",
    detail: "Previously rendered content stays visible while the synthetic fixture is refreshed.",
  }),
  firstFailure: Object.freeze({
    title: "Bundled analysis unavailable",
    detail: "The bundled sample file could not be loaded. "
      + "Press “Retry bundled analysis” to load it again.",
  }),
  refreshFailure: Object.freeze({
    title: "Bundled analysis unavailable",
    detail: "The bundled sample refresh failed. The last successful synthetic analysis remains visible. "
      + "Press “Retry bundled analysis” to refresh it.",
  }),
});

/**
 * The confidence chip beside a briefing that has no figure yet. "Pending" and
 * "unavailable" are different claims: one is still coming, the other is not.
 */
export const BRIEFING_CONFIDENCE_LABEL = Object.freeze({
  loading: "Confidence pending",
  empty: "Confidence pending",
  error: "Confidence unavailable",
});

/** The score slot when the rubric produced no score. Never "Unavailable". */
export const NOT_GRADED = "Not graded";

/**
 * The department detail panel — heading, score, and sampling line — in each
 * state where there is no department result to show.
 *
 * `loading` is also the copy authored into `evolution.html`, so the shipped
 * markup and the first repaint say the same thing.
 */
export const DEPARTMENT_DETAIL_STATE = Object.freeze({
  loading: Object.freeze({
    name: "Reading the bundled sample…",
    score: "–",
    sample: "No department is selected until the bundled sample has been read.",
  }),
  noDepartments: Object.freeze({
    name: "No department in this period",
    score: NOT_GRADED,
    sample: "This bundled period contains no department records, so there is nothing to grade. "
      + "Import a provider export above to grade your own departments.",
  }),
  bundleUnavailable: Object.freeze({
    name: "Bundled sample not loaded",
    score: NOT_GRADED,
    sample: "The bundled sample file could not be read, so no department result is available. "
      + "Press “Retry bundled analysis” above to load it again.",
  }),
});

/** The one-line reason under the department list, in the same two states. */
export const DEPARTMENT_LIST_MESSAGE = Object.freeze({
  noDepartments: "This bundled period contains no department records. "
    + "Import a provider export above to analyze your own departments.",
  bundleUnavailable: "The bundled sample file could not be read, so no department list is available. "
    + "Press “Retry bundled analysis” above to load it again.",
});

/** The rationale a prioritized action shows when there is no action to show. */
export const ACTION_UNAVAILABLE_REASON = Object.freeze({
  noDepartments: "No department records are available in this bundled period, "
    + "so no intervention can be prioritized. "
    + "Import a provider export above to prioritize an intervention for your own departments.",
  bundleUnavailable: "The bundled sample file could not be read, so no intervention was prioritized. "
    + "Press “Retry bundled analysis” above to load it again.",
});

/**
 * The measurement slots of an unavailable action. Each names the figure that is
 * missing rather than repeating one word four times, so a reader scanning the
 * list can tell an unestimated action from an unsimulated one.
 */
export const ACTION_UNAVAILABLE_FIELD = Object.freeze({
  status: "Result unavailable",
  title: "No prioritized intervention available",
  impact: "Not estimated",
  confidence: "Not assessed",
  owner: "Unassigned",
  provenance: "Bundled static fixture · no live fallback",
  baseline: "No baseline",
  target: "No target",
  estimate: "Not estimated",
  realized: "Not simulated",
});

/**
 * The equal-period comparison rows, when there is no comparable period.
 *
 * "Unavailable" told a reader nothing about which half of the comparison was
 * missing; "No comparable period" names it, and the row beside it already
 * carries the dates.
 */
export const NO_COMPARABLE_PERIOD = "No comparable period";

/** The KPI value slots when the bundled analysis never arrived. */
export const KPI_NOT_LOADED = "Not loaded";

/** The KPI value slot when a figure loaded but failed its plausibility check. */
export const KPI_NEEDS_REVIEW = "Needs review";

/** The headline card when the bundled analysis never arrived. */
export const HEADLINE_BUNDLE_UNAVAILABLE = Object.freeze({
  score: "Score unavailable",
  peer: "No score is inferred from a sample that did not load.",
  provenance: "Bundled sample not loaded. Press “Retry bundled analysis” above; "
    + "local import and the inspectable evaluation below still work.",
  portfolioCount: "No actions loaded",
  portfolioReason: "The bundled sample file could not be read, so no action portfolio is available. "
    + "Press “Retry bundled analysis” above to load it again.",
});

/**
 * The imported briefing's supporting slots, when the import cannot fill them.
 *
 * A department slot that says "Unavailable" reads as a broken product. The
 * import simply carried no department column, and saying that is both truer and
 * shorter.
 */
export const IMPORTED_BRIEFING_EMPTY = Object.freeze({
  department: "No department attributed",
  benchmarkAnswer: "No benchmark comparison",
  benchmarkSummary: "No compatible peer cohort for this import",
});

/** The scored-evidence list under one department, when it holds nothing. */
export const EVIDENCE_LIST_MESSAGE = Object.freeze({
  /** The department was never graded, so there is no evidence to have kept. */
  ungraded: (reason) => `${NOT_GRADED}, so there is no scored evidence to show. `
    + `${sentence(reason) || "The rubric reported no eligible sample for this period."} `
    + "Import a provider export with eligible sampling metadata to grade this department.",
  /** The department was graded, but the fixture retained no per-query rows. */
  noneRetained: "This department was graded, but the bundled sample retains no per-query evidence rows. "
    + "Import a provider export above to see evidence from your own queries.",
});

/** The inspectable evaluation panel when its bundled fixture does not load. */
export const EVALUATION_BUNDLE_UNAVAILABLE = "The bundled evaluation fixture could not be loaded, "
  + "so no recommendation score was produced. Reload the page to read the fixture again; "
  + "no live provider or customer record was contacted.";

/** How many ungraded departments are named before the list is summarized. */
export const UNGRADED_NAME_LIMIT = 3;

/**
 * Name the departments that sat outside the scored sample.
 *
 * A partial grade that hides who is missing is the dishonest one: a leader can
 * accept "37.5% of spend scored" and still not know their two largest teams are
 * the unscored part. The list is capped rather than unbounded — a sentence that
 * names forty departments is not read by anybody — and the overflow is counted
 * so the total is never understated.
 *
 * @param names department names, already ordered by whatever the caller ranks by
 * @returns the plain-text list, or "" when nothing is ungraded
 */
export function ungradedDepartmentList(names = [], limit = UNGRADED_NAME_LIMIT) {
  const clean = (Array.isArray(names) ? names : [])
    .map((name) => (typeof name === "string" ? name.trim() : ""))
    .filter(Boolean);
  if (!clean.length) return "";
  if (clean.length <= limit) return clean.join(", ");
  const rest = clean.length - limit;
  return `${clean.slice(0, limit).join(", ")}, and ${rest} more`;
}

/**
 * The sentence that turns a coverage percentage into a claim a reader can size.
 *
 * It names the ungraded departments and then says what their absence costs:
 * the grade describes the scored spend only. That is the confidence limitation
 * in words, beside the number, rather than a tier word a reader has to decode.
 */
export function ungradedCoverageNote(names = [], limit = UNGRADED_NAME_LIMIT) {
  const list = ungradedDepartmentList(names, limit);
  if (!list) return "";
  return `Not graded: ${list}. Their spend was not scored, so this grade describes the scored `
    + "spend only and cannot be read as a verdict on the whole organization.";
}

/**
 * The full sampled-spend coverage line for the score card.
 *
 * @param coverageText the formatted percentage, or "" when there is no
 *   denominator at all — the tier label already says so in that case.
 * @param label the eligibility tier label, owned by `grade-eligibility.js`.
 * @param ungradedNames departments the rubric did not score.
 */
export function sampledCoverageLine({ coverageText = "", label = "", ungradedNames = [] } = {}) {
  const head = coverageText ? `${coverageText} of spend scored · ${label}` : String(label);
  const note = ungradedCoverageNote(ungradedNames);
  return note ? `${head}. ${note}` : head;
}

/** Trim a reason and make sure it ends as a sentence. Empty stays empty. */
function sentence(text) {
  const clean = typeof text === "string" ? text.trim() : "";
  if (!clean) return "";
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

// --- appliers ---------------------------------------------------------------
//
// The panels keep their headings, their landmarks and their ids: a state with
// no figure in it is the same region, saying a different sentence. Nothing is
// unmounted, so a reader who was reading a heading still has it.

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function write(doc, id, text) {
  const node = byId(doc, id);
  // textContent, never innerHTML: these strings are plain text and stay that
  // way even when a reason travels in from a fixture.
  if (node) node.textContent = text;
  return node;
}

/**
 * Paint the department detail panel in one of its no-result states.
 *
 * @param key a key of `DEPARTMENT_DETAIL_STATE`.
 * @returns the copy that was painted, or null when the key or document is not
 *   one this module knows — so a caller asserts on the state it asked for.
 */
export function applyDepartmentDetailState(doc, key) {
  const copy = DEPARTMENT_DETAIL_STATE[key];
  if (!copy || !doc?.getElementById) return null;
  write(doc, "detail-name", copy.name);
  write(doc, "detail-score", copy.score);
  write(doc, "detail-sample", copy.sample);
  return copy;
}
