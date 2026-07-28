// The executive figures, filled from a leader's own import.
//
// WHY THIS MODULE EXISTS. `finops-panel-contract.js` decided which executive
// panels may show a figure after an import, and `finops-panel-contract-view.js`
// stopped the page from removing the ones that may not. Neither of them writes a
// number, and until this module nothing did: a leader who imported a provider
// export and a query sample was left looking at the hero grade, the KPI row and
// the spend mix of the BUNDLED SAMPLE, marked "Computed", under a provenance
// line reading "Your data — openai-usage-export.csv". The panels survived the
// import; the figures in them belonged to somebody else.
//
// So this module owns one job: given the reader's own graded corpus and their
// own analysis, produce the strings for the hero card, the four KPI cards and
// the query mix — and, where the import genuinely cannot answer, the words that
// say so rather than a stale figure.
//
// WHAT IT DECIDES, AND WHAT IT ONLY REPEATS.
//   * Decides nothing about eligibility. Whether a letter may be published at
//     all is `imported-corpus-grade.js`'s answer, and whether the panel around
//     it may show figures is the panel contract's. This module reads both.
//   * Repeats no threshold. Every number below is either handed in or read off
//     the corpus result, including the floor a refusal names.
//   * Invents no confidence score. The named level and its arithmetic travel on
//     the corpus result and are shown as published.
//
// PRIVACY. The inputs are counts, ratios, letters and file names. No prompt
// text, cell value or customer record can reach here: `gradeImportedCorpus`
// redacts by allowlist upstream, and nothing below reads an imported record.
// Every node is written with textContent; no markup string is assembled.

import { QUERY_CATEGORIES, formatCount, formatPercent, formatUsd } from "./evolution.js";
import { CORPUS_NOT_GRADEABLE } from "./imported-corpus-grade.js";

export const IMPORTED_EXECUTIVE_VIEW_VERSION = "imported-executive-view/1.0.0";

/**
 * The short label and the one next step behind each published refusal code.
 *
 * The long sentence is already authored beside the code in
 * `CORPUS_NOT_GRADEABLE_RULE` and is shown verbatim under the card. What is
 * added here is what a reader does about it, which the grading module has no
 * opinion about because it does not know there is an import panel above.
 */
export const CORPUS_REFUSAL_COPY = Object.freeze({
  [CORPUS_NOT_GRADEABLE.noSourceRecords]: Object.freeze({
    label: "No graded sample yet",
    action: "Add a query sample export in the import panel above. A provider invoice prices the "
      + "work; only a query sample says what the work was.",
  }),
  [CORPUS_NOT_GRADEABLE.noneClassified]: Object.freeze({
    label: "Needs review · no scored records",
    action: "Fill `category`, or a prompt excerpt, on the query sample rows. Every row was read "
      + "and none carried something this rubric scores.",
  }),
  [CORPUS_NOT_GRADEABLE.belowFloor]: Object.freeze({
    label: "Not graded · sample below the declared floor",
    action: "Add more scored queries to the sample. The floor is published on this page and the "
      + "count you are at is beside it.",
  }),
});

/** The words a KPI card carries when this import cannot fill it. */
const UNMEASURED = "Not in this import";

const PEER_NOTE = "No anonymized peer cohort can be built from your own files, and none ships for "
  + "imported data.";

const NO_PROVIDER_NOTE = "No provider period export in this import, so no spend total was computed.";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function setText(doc, id, text) {
  const node = byId(doc, id);
  if (node) node.textContent = text;
  return node;
}

function show(doc, id, visible) {
  const node = byId(doc, id);
  if (node) node.hidden = !visible;
  return node;
}

const finite = (value) => (Number.isFinite(value) ? value : null);

/**
 * The hero card, from the corpus grade and nothing else.
 *
 * The three things a leader asks of a letter — what it is, how confident it is,
 * and off how many records — are on the card together, because a letter whose
 * qualifier lives in a disclosure is a letter that gets quoted without it.
 */
export function importedHeroFigures(grade) {
  const records = grade?.records ?? { source: 0, scored: 0, unclassified: 0 };
  const counted = `${formatCount(records.scored)} of ${formatCount(records.source)} imported `
    + `record${records.source === 1 ? "" : "s"} scored`;
  if (!grade?.gradeable) {
    const copy = CORPUS_REFUSAL_COPY[grade?.reason] ?? CORPUS_REFUSAL_COPY[CORPUS_NOT_GRADEABLE.noSourceRecords];
    return Object.freeze({
      available: false,
      composite: null,
      letter: "!",
      // The floor is stated as the arithmetic a reader can check, never as a
      // bare "not enough data".
      value: copy.label,
      coverage: `${counted} · floor ${formatCount(grade?.eligibility?.minScoredRecords ?? 0)}`,
      action: copy.action,
      actionAvailable: true,
      rule: grade?.reasonRule ?? "",
    });
  }
  const basis = grade.confidence.basis;
  return Object.freeze({
    available: true,
    composite: grade.composite,
    letter: grade.grade,
    value: `${grade.composite} / 100 · grade ${grade.grade}`,
    coverage: `${counted} · ${grade.confidence.label}`,
    // The one next step a graded corpus still has, and it is arithmetic rather
    // than encouragement: how many more scored records buy the next named
    // confidence level. At the top level there is nothing left to ask for, and
    // saying so is more useful than a standing suggestion.
    action: nextConfidenceAction(grade),
    actionAvailable: grade.confidence.level !== "high",
    rule: `${grade.version} · ${grade.rubricVersionId} · ${basis.arithmetic}`,
  });
}

/**
 * How many more scored records the next confidence level costs.
 *
 * Derived from the two integers the corpus result already publishes — the
 * scored count and the declared floor — so no tier table is copied here.
 */
function nextConfidenceAction(grade) {
  const { scoredRecords, minScoredRecords, floorMultiple } = grade.confidence.basis;
  if (grade.confidence.level === "high") {
    return "None needed. The sample is deep enough that no single query can move the letter.";
  }
  const target = floorMultiple >= 2 ? 4 : 2;
  const needed = Math.max(1, Math.ceil(minScoredRecords * target) - scoredRecords);
  return `Add ${formatCount(needed)} more scored quer${needed === 1 ? "y" : "ies"} to reach `
    + `${formatCount(minScoredRecords * target)} and raise the confidence this letter carries.`;
}

/**
 * The four KPI cards.
 *
 * Spend and recoverable are the analysis's own figures and are repeated, never
 * recomputed: the page already decided whether the totals are plausible and
 * whether attribution withheld the recoverable number, and a second opinion
 * here is how two numbers on one screen disagree.
 */
export function importedKpiFigures(grade, {
  spendUsd = null, recoverableUsd = null, departments = 0, period = null,
  plausible = true, recoverableWithheld = false, withheldReason = "",
} = {}) {
  const spend = finite(spendUsd);
  const recoverable = finite(recoverableUsd);
  const scored = grade?.records?.scored ?? 0;
  const highValue = grade?.score?.categories?.find((category) => category.key === "highValue") ?? null;
  const share = spend !== null && recoverable !== null && spend > 0 ? recoverable / spend : null;
  // Three states, kept apart on purpose. "No provider export in this import" is
  // a missing input; "needs review" is an accusation against a file that is
  // present. Collapsing them tells a leader to inspect an export they never
  // selected.
  return Object.freeze([
    Object.freeze({
      key: "spend",
      available: plausible && spend !== null,
      value: spend === null ? UNMEASURED : plausible ? formatUsd(spend) : "Needs review",
      note: spend === null ? NO_PROVIDER_NOTE
        : plausible
          ? `${formatCount(scored)} scored quer${scored === 1 ? "y" : "ies"} · `
            + `${formatCount(departments)} ranked department${departments === 1 ? "" : "s"}`
            + (period ? ` · ${period}` : "")
          : "A total is outside the supported display range; inspect the source export.",
    }),
    Object.freeze({
      key: "recoverable",
      available: plausible && !recoverableWithheld && recoverable !== null,
      value: recoverable === null ? UNMEASURED
        : recoverableWithheld ? "Not shown"
          : plausible ? formatUsd(recoverable) : "Needs review",
      note: recoverable === null ? NO_PROVIDER_NOTE
        : recoverableWithheld
          ? (withheldReason || "Attribution is below the published floor, so no ranked figure is shown.")
          : plausible && share !== null
            ? `${formatPercent(share)} of the attributed spend — bounded down-routing scenario`
            : "Recoverable spend must not exceed observed spend.",
    }),
    Object.freeze({
      key: "productive",
      available: Boolean(highValue) && scored > 0,
      value: highValue && scored > 0 ? formatPercent(highValue.share, { digits: 1 }) : UNMEASURED,
      note: highValue && scored > 0
        ? `${formatCount(highValue.records)} of ${formatCount(scored)} scored queries were high-value`
        : "No query sample in this import carried a category the rubric scores.",
    }),
    // Never available for an import, and it says the same thing the panel's own
    // sentence says: this one is not a step the reader can complete.
    Object.freeze({ key: "peer", available: false, value: UNMEASURED, note: PEER_NOTE }),
  ]);
}

/**
 * The query mix over the reader's own scored records.
 *
 * A query sample carries no per-query cost, so the shares below are a share of
 * QUERIES and the basis line says so beside them. Returns null when there is
 * nothing scored, because four zero-width segments are a chart of nothing.
 */
export function importedMixFigures(grade) {
  const scored = grade?.records?.scored ?? 0;
  const rows = grade?.score?.categories ?? [];
  if (!scored || !rows.length) return null;
  const shares = {};
  const captions = {};
  for (const category of QUERY_CATEGORIES) {
    const row = rows.find((entry) => entry.key === category.key);
    shares[category.key] = row?.share ?? 0;
    captions[category.key] = `${formatCount(row?.records ?? 0)} of ${formatCount(scored)} scored queries`;
  }
  return Object.freeze({
    shares: Object.freeze(shares),
    captionFor: (category) => captions[category.key] ?? "",
    basis: `Share of the ${formatCount(scored)} queries the rubric scored in your import. `
      + "A query sample carries no per-query cost, so this is a query mix, not a spend mix.",
  });
}

/** Everything above, assembled once. */
export function importedExecutiveFigures(grade, analysis = {}) {
  return Object.freeze({
    version: IMPORTED_EXECUTIVE_VIEW_VERSION,
    hero: importedHeroFigures(grade),
    kpis: importedKpiFigures(grade, analysis),
    mix: importedMixFigures(grade),
  });
}

/**
 * Write the hero card and the KPI row.
 *
 * The mix is handed back rather than painted here: the page owns one mix
 * renderer and paints the bundled seed through it too, and a second painter for
 * the same three nodes is how two shapes of the same chart start drifting.
 *
 * @returns the figures that were written, so a caller asserts on the state it
 *   asked for rather than on the DOM it got.
 */
export function applyImportedExecutive(doc, figures, { band = () => "review" } = {}) {
  if (!doc || !figures) return null;
  const { hero } = figures;
  const card = byId(doc, "score-card");
  if (card) {
    card.dataset.band = hero.available ? band(hero.composite) : "review";
    card.dataset.metricState = hero.available ? "available" : "needs-review";
    card.dataset.gradeSource = "import";
  }
  setText(doc, "score-grade", hero.letter);
  setText(doc, "score-value", hero.value);
  setText(doc, "score-coverage", hero.coverage);
  setText(doc, "score-action", hero.action);
  const action = byId(doc, "score-action");
  if (action) action.dataset.available = String(hero.actionAvailable);
  setText(doc, "score-peer", hero.rule);

  for (const kpi of figures.kpis) {
    const slot = `kpi-${kpi.key}`;
    setText(doc, `${slot}-value`, kpi.value);
    setText(doc, `${slot}-note`, kpi.note);
    const node = byId(doc, slot);
    if (node) node.dataset.available = String(kpi.available);
    // The "unmeasured" marker is a word and a shape, not only a dashed edge, so
    // a card the import could not fill still reads as unfilled in monochrome.
    show(doc, `${slot}-flag`, !kpi.available);
  }
  // The bundled-sample caption above the row is no longer true of these four
  // numbers. The reader's own provenance line beside it was already painted by
  // the graded surface; leaving both up says the row is two things at once.
  show(doc, "headline-basis", false);
  const row = byId(doc, "kpi-row");
  if (row) row.dataset.source = "import";
  return figures;
}

/** Hand the row's caption back when the page returns to the bundled sample. */
export function clearImportedExecutive(doc) {
  show(doc, "headline-basis", true);
  const row = byId(doc, "kpi-row");
  if (row) row.dataset.source = "sample";
  const card = byId(doc, "score-card");
  if (card) delete card.dataset.gradeSource;
  for (const key of ["spend", "recoverable", "productive", "peer"]) {
    show(doc, `kpi-${key}-flag`, false);
    const node = byId(doc, `kpi-${key}`);
    if (node) delete node.dataset.available;
  }
  return null;
}
