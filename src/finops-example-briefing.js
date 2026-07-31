// The hand-off from the bundled AI FinOps example to the executive briefing.
//
// THE PROBLEM THIS SOLVES. The AI FinOps landing surface already composes a
// complete synthetic result on first paint — recoverable share, routing
// scenario, ranked action, confidence verdict — and the executive briefing
// already renders a printable one-page artifact. There was no way between them.
// A reader who had just read "33% of analyzed AI spend is recoverable" and
// wanted the sheet they would take into a meeting had two bad options: the
// footer link to /executive-briefing.html, which drops the example and briefs on
// whatever this browser happens to hold, or nothing.
//
// So this module owns three things and nothing else:
//
//   1. THE LINK. One href, one query parameter, one value, authored once. The
//      CTA in evolution.html carries it as a real anchor, so it is operable,
//      copy-pasteable, and correct before any script runs.
//
//   2. THE CONTEXT. `readExampleContext` answers one question — "was this page
//      opened from the bundled example?" — and answers it from a string, so it
//      is testable without a browser and total for anything a URL can carry.
//
//   3. THE SAME FIGURES. `exampleBriefingPeriods()` does not re-state the
//      example's numbers; it re-derives them. The bundled dataset's monthly
//      provider exports are run through the same translator, the same analysis,
//      and the same briefing contract a reader's own file walks through, and
//      each month is then projected into the retained-period shape the executive
//      briefing reads. The recoverable share on the briefing sheet is therefore
//      the same arithmetic as the share in the landing brief, not a second copy
//      of it that can drift.
//
// WHAT IT REFUSES TO DO. It never touches storage, never reads the reader's own
// retained periods, and never writes one. Pinning the example means the reader's
// own figures are deliberately left out, and the notice below says so in words
// rather than letting a reader assume a briefing labelled "example" might have
// quietly mixed their months into it.
//
// Every figure that reaches a screen through here is invented. The labelling is
// the one this page family already uses — `SAMPLE_LABEL` is imported rather than
// restated, so the sentence a reader meets on the landing brief is the same
// sentence they meet on the sheet.

import { loadExampleDatasetInputs } from "./example-dataset.js";
import { normalizeLocalFinopsHistory } from "./local-finops.js";
import { buildFinopsBriefing } from "./finops-briefing-contract.js";
import { projectRetainedPeriod } from "./finops-workspace.js";
import { SAMPLE_LABEL } from "./finops-first-run.js";

/** Bump when the link, the parameter, or the derivation changes meaning. */
export const EXAMPLE_BRIEFING_VERSION = "finops-example-briefing/1.0.0";

/** The one parameter that pins the briefing to the bundled example. */
export const EXAMPLE_CONTEXT_PARAM = "example";
export const EXAMPLE_CONTEXT_VALUE = "ai-finops-bundled";

/** Where the CTA goes, authored once so markup and module cannot disagree. */
export const EXAMPLE_BRIEFING_HREF =
  `/executive-briefing.html?${EXAMPLE_CONTEXT_PARAM}=${EXAMPLE_CONTEXT_VALUE}`;

/** And the way back, to the region the reader left. */
export const EXAMPLE_RETURN_HREF = "/evolution.html#finops-first-run";

/**
 * The dataset name these periods are filed under.
 *
 * Not "user", and the difference is load-bearing: the executive contract lowers
 * its confidence ceiling to `low` and adds its `example_dataset` limitation for
 * any dataset that is not the reader's own import. Naming the dataset honestly
 * is what makes the sheet say "this evidences nothing about your spend" without
 * this module having to write that sentence itself.
 */
export const EXAMPLE_BRIEFING_DATASET = "example";

/** Three consecutive months: one reporting period and the two priors a baseline needs. */
export const EXAMPLE_BRIEFING_MONTHS = 3;

/**
 * The first-screen CTA, in the words it ships.
 *
 * The label names the destination and the data in one line, because a link that
 * says only "executive briefing" leaves a reader guessing whose figures they are
 * about to read. The note carries the promise; the heading gives the block a
 * real place in the region's heading outline rather than a floating link.
 */
export const EXAMPLE_BRIEFING_CTA = Object.freeze({
  heading: "Read this example as an Executive FinOps briefing",
  label: "Open the Executive FinOps briefing for this example",
  note: "Opens the printable one-page sheet on this same Bundled synthetic example, with the same "
    + "recoverable share and scenario. Invented figures, not your spend; nothing of yours is read, "
    + "uploaded, or stored.",
});

/** How the briefing masthead names where these figures came from. */
export const EXAMPLE_BRIEFING_ORIGIN =
  "The Bundled synthetic example from AI FinOps — invented figures for an invented company, rebuilt "
  + "in this tab; not your spend, not an import, and no visitor data.";

/** What the reader is owed about how the sheet was produced. */
export const EXAMPLE_BRIEFING_PROVENANCE_NOTE =
  "Rebuilt in this tab from the last three months of the Bundled synthetic example. Each month was "
  + "analyzed by the same translator, analysis, and briefing contract your own provider export walks "
  + "through, then projected into the retained-period shape this briefing reads — so the recoverable "
  + "share here is the same arithmetic as the one on the AI FinOps page, not a second copy of it. No "
  + "clock, no random value, no network request, and no server took part.";

/**
 * The notice at the top of the pinned briefing.
 *
 * Shaped like the workspace-absence notices this page already draws — summary,
 * statement, remedy — because a reader should meet one idiom for "these are not
 * your figures, and here is why" rather than two. The remedy says what was left
 * out and how to get it, since a reader whose browser *does* hold retained
 * periods is entitled to know they were skipped on purpose.
 */
export const EXAMPLE_BRIEFING_NOTICE = Object.freeze({
  code: "ai_finops_bundled_example",
  summary: "You opened the Bundled synthetic example from AI FinOps",
  statement: "Every figure below is rebuilt in this tab from the same Bundled synthetic example the "
    + "AI FinOps page briefs on — its last three months of invented figures, run through the same "
    + "contract your own "
    + "export would walk through. It is not your spend, not an import, and not a realized saving.",
  remedy: "Any FinOps periods this browser holds of its own were deliberately left out, so the example "
    + "stays the example and nothing of yours is mixed into it. Open this page without the example "
    + "link to brief on your own retained periods instead.",
  returnLabel: "Back to the Bundled synthetic example on AI FinOps",
  returnHref: EXAMPLE_RETURN_HREF,
});

/** The sample labelling, taken from the landing brief rather than restated. */
export const EXAMPLE_BRIEFING_SYNTHETIC = Object.freeze({
  label: SAMPLE_LABEL.badge,
  disclosure: SAMPLE_LABEL.statement,
});

/**
 * Was this page opened from the bundled example?
 *
 * Total. A missing search, a malformed one, a repeated parameter, and a value
 * this build does not know all answer "no" — a link that cannot be read is not a
 * link that pins anything, and guessing at it would put the example's figures in
 * front of a reader who asked for their own.
 *
 * @param search a query string (`"?example=…"` or `"example=…"`), a
 *   `URLSearchParams`, or a `location`-shaped object.
 */
export function readExampleContext(search) {
  const params = toParams(search);
  const value = params?.get?.(EXAMPLE_CONTEXT_PARAM) ?? null;
  return Object.freeze({
    pinned: value === EXAMPLE_CONTEXT_VALUE,
    value: typeof value === "string" ? value : null,
    version: EXAMPLE_BRIEFING_VERSION,
  });
}

function toParams(search) {
  if (!search) return null;
  if (typeof search.get === "function" && typeof search.append === "function") return search;
  const text = typeof search === "string" ? search : search.search;
  if (typeof text !== "string" || text === "") return null;
  try {
    return new URLSearchParams(text.startsWith("?") ? text.slice(1) : text);
  } catch {
    return null;
  }
}

/** "2026-06-01 to 2026-07-01" → "2026-07-01". Null for anything else. */
function windowEnd(period) {
  const match = /\bto\s+(\d{4}-\d{2}-\d{2})\b/.exec(String(period ?? ""));
  return match ? match[1] : null;
}

/**
 * Derive the retained periods the executive briefing is built from.
 *
 * One analysis per month, each run over the example's exports *up to* that month
 * — which is what a workspace accumulating a month at a time actually holds, and
 * what makes the trailing baseline in the sheet a real comparison rather than a
 * slice of one analysis presented three ways.
 *
 * `derivedAt` comes from each period's own window end, never from a clock: the
 * same three months must produce the same sheet on every load, in every browser,
 * forever, exactly as the published sample does.
 *
 * @returns an array of `EXAMPLE_BRIEFING_MONTHS` period records, oldest first.
 */
export function exampleBriefingPeriods({
  inputs = loadExampleDatasetInputs(),
  months = EXAMPLE_BRIEFING_MONTHS,
} = {}) {
  const providers = Array.isArray(inputs?.providers) ? inputs.providers : [];
  const wanted = Math.max(1, Math.min(Number(months) || 0, providers.length));
  const periods = [];
  for (let end = providers.length - wanted + 1; end <= providers.length; end += 1) {
    const analysis = normalizeLocalFinopsHistory({
      providers: providers.slice(0, end), hris: inputs?.hris ?? null,
    });
    const briefing = buildFinopsBriefing(analysis);
    const closed = windowEnd(analysis?.period);
    const record = projectRetainedPeriod({
      briefing,
      analysis,
      dataset: EXAMPLE_BRIEFING_DATASET,
      now: new Date(`${closed}T09:00:00Z`),
    });
    if (record) periods.push(record);
  }
  return periods;
}
