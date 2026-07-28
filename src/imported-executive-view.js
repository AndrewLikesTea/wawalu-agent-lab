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
// TWO INVARIANTS, HELD PER VALUE RATHER THAN PER PANEL.
//   * Every published figure carries its own provenance: how many of the
//     reader's records are behind it, in that figure's own unit, which period
//     they cover, and what fraction of the period's dollars resolved to an org
//     unit. A fact this import did not establish is null and is listed in
//     `missing`; it is never 0, because a zero a reader cannot distinguish from
//     an absence is worse than a stated gap.
//   * Every absent figure carries a reason code, and for a missing input that
//     code and its sentence are the PANEL CONTRACT's, read off the same
//     requirement list that decided the panel. This module authors a code only
//     for the two refusals the contract has no fact for — a total outside the
//     supported display range, and an answerable panel the analysis published
//     no figure for, which is a defect and is reported as one.
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
import { MIN_SCORED_PROMPTS, PANELS_BY_ID, panelState } from "./finops-panel-contract.js";

export const IMPORTED_EXECUTIVE_VIEW_VERSION = "imported-executive-view/1.2.0";

/** The panels whose figures this module writes, named once. */
export const VALUE_PANEL = Object.freeze({
  hero: "hero-grade",
  spend: "spend-and-recovery",
  highValue: "high-value-share",
  peer: "peer-benchmark",
  mix: "spend-mix",
});

/**
 * The three facts every published figure carries, and the code for each one
 * this import could not establish.
 *
 * A figure without them is a number a director cannot audit: how many of their
 * own records are behind it, which period those records cover, and how much of
 * the period's money resolved to an org unit. All three are stated per value,
 * because they differ per value — the money cards count provider rows and the
 * corpus cards count scored queries, and one shared footnote would be wrong for
 * one of them.
 *
 * An absent fact is `null` and is listed in `missing`. It is never 0: a zero
 * source count under a published dollar figure is a lie a reader cannot detect.
 */
export const PROVENANCE_GAP = Object.freeze({
  sourceRecords: "no_source_record_count",
  period: "no_covered_period",
  attributedShare: "attributed_share_undefined",
});

/**
 * The refusals this view owns, as opposed to the ones the panel contract owns.
 *
 * Both are missing-input refusals in the reader's eyes, but only the contract's
 * name an input a reader can supply. These two say the inputs arrived and the
 * figure still cannot be published, which is a defect report, not a next step —
 * so they are declared here rather than borrowed from the contract.
 */
export const DISPLAY_REFUSAL = Object.freeze({
  outsideRange: "totals_outside_supported_range",
  noFigure: "no_figure_published_by_analysis",
});

/** The unit one source record is counted in, per panel. */
const SOURCE_UNIT = Object.freeze({
  providerRow: "provider row",
  scoredQuery: "scored query",
});

/**
 * The provenance of one published value.
 *
 * @param sourceRecords how many of the reader's own records were summed or
 *   scored to produce the value. Null when the caller cannot say.
 * @param period the period those records cover, as the analysis published it.
 * @param attributedShare the dollar-weighted attributed fraction in [0,1], or
 *   null when no spend was read and the fraction is therefore undefined rather
 *   than zero.
 */
export function valueProvenance({
  sourceRecords = null, unit = SOURCE_UNIT.providerRow, period = null, attributedShare = null,
} = {}) {
  const records = Number.isFinite(sourceRecords) && sourceRecords >= 0 ? Math.trunc(sourceRecords) : null;
  const covered = typeof period === "string" && period.trim() ? period.trim() : null;
  const share = Number.isFinite(attributedShare) && attributedShare >= 0 && attributedShare <= 1
    ? attributedShare : null;
  const missing = [];
  if (records === null) missing.push(PROVENANCE_GAP.sourceRecords);
  if (covered === null) missing.push(PROVENANCE_GAP.period);
  if (share === null) missing.push(PROVENANCE_GAP.attributedShare);
  return Object.freeze({
    sourceRecords: records,
    unit,
    period: covered,
    attributedShare: share,
    // Formatted here so no caller reaches for `formatPercent(null)`, which
    // renders an undefined fraction as "0%".
    attributedSharePercent: share === null ? null : formatPercent(share),
    complete: missing.length === 0,
    missing: Object.freeze(missing),
  });
}

/**
 * Why a value is absent, in the contract's own words, from the contract's own
 * requirement list.
 *
 * The blocking requirement is the panel contract's decision, not this module's:
 * the same gap that hides the panel's figures names the reason a card in it
 * carries. Returns null when the contract says the panel is answerable, so a
 * caller can distinguish "an input is missing" from "the analysis published no
 * figure for an answerable panel", which is a defect and reported as one.
 */
function contractGap(panel, facts, detail = null) {
  const state = panelState(PANELS_BY_ID[panel], facts ?? {});
  if (!state.blocking) return null;
  return Object.freeze({
    panel,
    reason: state.reason,
    needLabel: state.blocking.label,
    need: state.blocking.need,
    detail,
  });
}

/** One named requirement's account of a refusal a caller has already decided. */
function requirementGap(panel, fact, detail = null) {
  const entry = PANELS_BY_ID[panel].requirements.find((item) => item.fact === fact);
  return Object.freeze({
    panel, reason: entry.reason, needLabel: entry.label, need: entry.need, detail,
  });
}

/** A refusal this view owns. It names no next step, because there is none. */
function displayGap(panel, reason, detail = null) {
  return Object.freeze({ panel, reason, needLabel: null, need: null, detail });
}

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

// The note under the peer card when no benchmark was evaluated at all — the
// caller handed no result over. A benchmark that WAS evaluated and refused says
// so in its own words, from the peer-cohort contract, so a reader is never told
// a generic sentence about a specific refusal.
const PEER_NOTE = "No peer comparison was evaluated for this import.";

const NO_PROVIDER_NOTE = "No provider period export in this import, so no spend total was computed.";

const OUTSIDE_RANGE_NOTE = "A total is outside the supported display range; inspect the source export.";

const NO_SCORED_CATEGORY_NOTE = "No query sample in this import carried a category the rubric scores.";

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
 * A dataset key that is absent when the fact is, so a reader inspecting the DOM
 * cannot mistake "we did not establish this" for an empty string.
 */
function setData(node, key, value) {
  if (!node) return;
  if (value === null || value === undefined) delete node.dataset[key];
  else node.dataset[key] = String(value);
}

/**
 * The provenance and the refusal, written where a browser session, an e2e test,
 * and a bug report can all read them off one element.
 *
 * Neither is copy: the sentences are already beside the figure. These are the
 * machine-readable halves — the reason code a panel refused with, and the three
 * facts behind a figure it published.
 */
function writeValueAttributes(node, { provenance = null, unavailable = null } = {}) {
  if (!node) return node;
  setData(node, "unavailableReason", unavailable?.reason ?? null);
  setData(node, "sourceRecords", provenance?.sourceRecords ?? null);
  setData(node, "sourceUnit", provenance ? provenance.unit : null);
  setData(node, "sourcePeriod", provenance?.period ?? null);
  setData(node, "attributedShare", provenance?.attributedShare ?? null);
  return node;
}

const VALUE_DATA_KEYS = Object.freeze([
  "unavailableReason", "sourceRecords", "sourceUnit", "sourcePeriod", "attributedShare",
]);

/**
 * The hero card, from the corpus grade and nothing else.
 *
 * The three things a leader asks of a letter — what it is, how confident it is,
 * and off how many records — are on the card together, because a letter whose
 * qualifier lives in a disclosure is a letter that gets quoted without it.
 */
export function importedHeroFigures(grade, { period = null, attributedShare = null } = {}) {
  const records = grade?.records ?? { source: 0, scored: 0, unclassified: 0 };
  const counted = `${formatCount(records.scored)} of ${formatCount(records.source)} imported `
    + `record${records.source === 1 ? "" : "s"} scored`;
  if (!grade?.gradeable) {
    const copy = CORPUS_REFUSAL_COPY[grade?.reason] ?? CORPUS_REFUSAL_COPY[CORPUS_NOT_GRADEABLE.noSourceRecords];
    return Object.freeze({
      available: false,
      composite: null,
      // No provenance on a refusal: there is no published value for it to
      // qualify, and an empty provenance block beside a "!" invites a reader to
      // treat the refusal as a figure.
      provenance: null,
      // A corpus is refused below the same floor the hero panel declares, so the
      // reason is the contract's and the corpus module's rule travels with it.
      unavailable: contractGap(VALUE_PANEL.hero, { scoredPrompts: records.scored },
        grade?.reasonRule ?? null),
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
    provenance: valueProvenance({
      sourceRecords: records.scored, unit: SOURCE_UNIT.scoredQuery, period, attributedShare,
    }),
    unavailable: null,
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
 * The peer card, from this import's own benchmark against a published cohort.
 *
 * The percentile, the quartile, the cohort and both labels are the peer-cohort
 * contract's and are repeated here; nothing is re-ranked. A refused benchmark
 * prints the contract's own reason, so the card and the panel beneath it cannot
 * refuse for two different reasons.
 *
 * The provenance under a published percentile is the import's own scored-query
 * count — the cohort's member count is a property of the published reference
 * data, not evidence about the reader's file, and putting it in the provenance
 * slot would read as "42 of your records".
 */
function peerCard(peer, { scored, period, attributedShare }) {
  if (!peer) {
    return Object.freeze({
      key: "peer",
      available: false,
      value: UNMEASURED,
      note: PEER_NOTE,
      provenance: null,
      finding: null,
      unavailable: requirementGap(VALUE_PANEL.peer, "peerCohortRecords"),
    });
  }
  if (!peer.available) {
    return Object.freeze({
      key: "peer",
      available: false,
      value: UNMEASURED,
      note: peer.unavailable.need,
      provenance: null,
      // A refused comparison has no gap to state and no action to take. The
      // reason and what to supply are already on the card's note.
      finding: null,
      unavailable: Object.freeze({
        panel: VALUE_PANEL.peer,
        reason: peer.unavailable.reason,
        needLabel: peer.unavailable.needLabel,
        need: peer.unavailable.need,
        detail: peer.unavailable.detail ?? null,
      }),
    });
  }
  return Object.freeze({
    key: "peer",
    available: true,
    value: `${peer.headline.percentile}th`,
    note: `${peer.headline.quartileLabel} of ${peer.cohort.label} · ${peer.comparabilityLabel} · `
      + `${peer.confidenceLabel} · ${formatCount(peer.cohort.memberCount)} published synthetic peers`,
    provenance: valueProvenance({
      sourceRecords: scored, unit: SOURCE_UNIT.scoredQuery, period, attributedShare,
    }),
    finding: peerFindingCopy(peer),
    unavailable: null,
  });
}

/**
 * The peer finding, as the three lines the card shows under the percentile.
 *
 * WHY THIS EXISTS. The benchmark has always selected one action and published it
 * on the result; nothing rendered it, so a leader whose import was behind its
 * cohort read a percentile, a quartile and a cohort name — and no next step.
 * The gap answered "where are we" and the panel then stopped one sentence short
 * of "so what do we do", which is the only sentence a briefing is read for.
 *
 * Nothing below is authored here. The gap sentence, the action and the evidence
 * are the finding's own strings; this function decides which of them appear on a
 * card and in what order, and nothing else. A finding that is unavailable — no
 * benchmark, a refused one, or one with no comparable metric — returns null, and
 * the card's note already carries that refusal in the contract's own words.
 */
function peerFindingCopy(peer) {
  const finding = peer?.finding ?? null;
  if (!finding?.available) return null;
  const evidence = [`Accountable: ${finding.action.accountableRole}`, finding.evidenceText]
    .filter(Boolean).join(" · ");
  return Object.freeze({
    standing: finding.standing,
    behind: finding.behind,
    // Always present on an available finding: the action's own metric is one of
    // the comparisons the action was selected from.
    gap: finding.gap?.text ?? "",
    action: finding.action.text,
    // The role that owns the step, then the import's own money behind it — never
    // the cohort's, which is published reference data and not evidence about the
    // reader's file.
    evidence,
  });
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
  facts = null, attributedShare = null, peer = null,
} = {}) {
  const spend = finite(spendUsd);
  const recoverable = finite(recoverableUsd);
  const scored = grade?.records?.scored ?? 0;
  const highValue = grade?.score?.categories?.find((category) => category.key === "highValue") ?? null;
  const share = spend !== null && recoverable !== null && spend > 0 ? recoverable / spend : null;
  // The rows behind the money figures are the rows that carried a cost, which is
  // the count the panel contract already made for its own decision. Null, not
  // zero, when the caller did not hand the fact record over.
  const costedRows = Number.isFinite(facts?.costedRows) ? facts.costedRows : null;
  const moneyProvenance = valueProvenance({
    sourceRecords: costedRows, unit: SOURCE_UNIT.providerRow, period, attributedShare,
  });
  // The corpus cards count scored queries instead of rows — and carry the SAME
  // attributed-spend fraction, because that fraction qualifies the period the
  // queries were asked in, not the arithmetic that scored them. Putting the
  // corpus's own coverage ratio here (or null) would answer a different
  // question than the one the provenance block declares.
  const corpusProvenance = valueProvenance({
    sourceRecords: scored, unit: SOURCE_UNIT.scoredQuery, period, attributedShare,
  });

  // Three states, kept apart on purpose. "No provider export in this import" is
  // a missing input; "needs review" is an accusation against a file that is
  // present. Collapsing them tells a leader to inspect an export they never
  // selected. Each state now also carries the code for the gap, so a consumer
  // that is not a card — a log line, a briefing — reports the same reason.
  const noFigure = (panel) => displayGap(panel, DISPLAY_REFUSAL.noFigure,
    "The panel's declared inputs are present and the analysis published no figure.");
  const spendGap = spend === null
    ? contractGap(VALUE_PANEL.spend, facts) ?? noFigure(VALUE_PANEL.spend)
    : plausible ? null : displayGap(VALUE_PANEL.spend, DISPLAY_REFUSAL.outsideRange, OUTSIDE_RANGE_NOTE);
  const recoverableGap = recoverable === null
    ? contractGap(VALUE_PANEL.spend, facts) ?? noFigure(VALUE_PANEL.spend)
    : recoverableWithheld
      // The withholding decision is the attribution policy's and was made
      // upstream; the sentence a reader gets is the contract's own account of
      // that same floor.
      ? requirementGap(VALUE_PANEL.spend, "attributedShare", withheldReason || null)
      : plausible ? null : displayGap(VALUE_PANEL.spend, DISPLAY_REFUSAL.outsideRange, OUTSIDE_RANGE_NOTE);
  const highValueGap = contractGap(VALUE_PANEL.highValue, { scoredPrompts: scored },
    grade?.reasonRule ?? null)
    ?? (highValue ? null : noFigure(VALUE_PANEL.highValue));
  const floorNote = `${formatCount(scored)} of the ${formatCount(MIN_SCORED_PROMPTS)} scored queries `
    + "this share needs are in this import.";

  return Object.freeze([
    Object.freeze({
      key: "spend",
      available: !spendGap,
      value: spend === null ? UNMEASURED : plausible ? formatUsd(spend) : "Needs review",
      note: spend === null ? NO_PROVIDER_NOTE
        : plausible
          ? `${formatCount(scored)} scored quer${scored === 1 ? "y" : "ies"} · `
            + `${formatCount(departments)} ranked department${departments === 1 ? "" : "s"}`
            + (period ? ` · ${period}` : "")
          : OUTSIDE_RANGE_NOTE,
      provenance: spendGap ? null : moneyProvenance,
      unavailable: spendGap,
    }),
    Object.freeze({
      key: "recoverable",
      available: !recoverableGap,
      value: recoverable === null ? UNMEASURED
        : recoverableWithheld ? "Not shown"
          : plausible ? formatUsd(recoverable) : "Needs review",
      note: recoverable === null ? NO_PROVIDER_NOTE
        : recoverableWithheld
          ? (withheldReason || "Attribution is below the published floor, so no ranked figure is shown.")
          : plausible && share !== null
            ? `${formatPercent(share)} of the attributed spend — bounded down-routing scenario`
            : "Recoverable spend must not exceed observed spend.",
      provenance: recoverableGap ? null : moneyProvenance,
      unavailable: recoverableGap,
    }),
    Object.freeze({
      key: "productive",
      available: !highValueGap,
      value: highValueGap ? UNMEASURED : formatPercent(highValue.share, { digits: 1 }),
      note: !highValueGap
        ? `${formatCount(highValue.records)} of ${formatCount(scored)} scored queries were high-value`
        : scored > 0 ? floorNote : NO_SCORED_CATEGORY_NOTE,
      // The published share is the corpus's, and its provenance carries the
      // import's attributed-spend fraction like every other published value.
      provenance: highValueGap ? null : corpusProvenance,
      unavailable: highValueGap,
    }),
    peerCard(peer, { scored, period, attributedShare }),
  ]);
}

/**
 * The query mix over the reader's own scored records.
 *
 * A query sample carries no per-query cost, so the shares below are a share of
 * QUERIES and the basis line says so beside them.
 *
 * Always an object, never null. An import that cannot fill this panel gets
 * `available: false` and the contract's reason for it: a bare null said only
 * that no chart existed, which left the caller to author its own explanation
 * for a refusal it did not make.
 */
export function importedMixFigures(grade, { period = null, attributedShare = null } = {}) {
  const scored = grade?.records?.scored ?? 0;
  const rows = grade?.score?.categories ?? [];
  const gap = contractGap(VALUE_PANEL.mix, { scoredPrompts: scored }, grade?.reasonRule ?? null)
    ?? (rows.length ? null : displayGap(VALUE_PANEL.mix, DISPLAY_REFUSAL.noFigure,
      "The scored-query floor is met and the rubric published no category rows."));
  if (gap) {
    return Object.freeze({
      available: false,
      shares: null,
      // Four zero-width segments are a chart of nothing, so the caption says
      // what was read rather than printing "0 of 0" over a count that is not 0.
      captionFor: () => `${formatCount(scored)} scored quer${scored === 1 ? "y" : "ies"} `
        + "in this import · no mix published",
      basis: scored > 0
        ? `${formatCount(scored)} of the ${formatCount(MIN_SCORED_PROMPTS)} scored queries a mix `
          + "needs are in this import, so no mix is drawn."
        : "No query in this import carried a category the rubric scores, so there is no mix to draw.",
      provenance: null,
      unavailable: gap,
    });
  }
  const shares = {};
  const captions = {};
  for (const category of QUERY_CATEGORIES) {
    const row = rows.find((entry) => entry.key === category.key);
    shares[category.key] = row?.share ?? 0;
    captions[category.key] = `${formatCount(row?.records ?? 0)} of ${formatCount(scored)} scored queries`;
  }
  return Object.freeze({
    available: true,
    shares: Object.freeze(shares),
    captionFor: (category) => captions[category.key] ?? "",
    basis: `Share of the ${formatCount(scored)} queries the rubric scored in your import. `
      + "A query sample carries no per-query cost, so this is a query mix, not a spend mix.",
    provenance: valueProvenance({
      sourceRecords: scored, unit: SOURCE_UNIT.scoredQuery, period, attributedShare,
    }),
    unavailable: null,
  });
}

/** Everything above, assembled once. */
export function importedExecutiveFigures(grade, analysis = {}) {
  return Object.freeze({
    version: IMPORTED_EXECUTIVE_VIEW_VERSION,
    hero: importedHeroFigures(grade, analysis),
    kpis: importedKpiFigures(grade, analysis),
    mix: importedMixFigures(grade, analysis),
  });
}

/** The three nodes the peer finding is written into, cleared as a set. */
const PEER_FINDING_SLOTS = Object.freeze([
  ["kpi-peer-gap", "gap"], ["kpi-peer-action", "action"], ["kpi-peer-evidence", "evidence"],
]);

/**
 * Write the peer finding under the percentile, or take it down.
 *
 * The block is hidden as a whole rather than emptied in place: three blank
 * paragraphs under a heading that promises a next step read as a step that
 * failed to load. Its text is cleared too, so a stale action from a previous
 * import cannot be read out of the DOM by anything that ignores `hidden`.
 *
 * @returns the finding that was written, or null when there was none.
 */
function applyPeerFinding(doc, card) {
  const finding = card?.finding ?? null;
  const block = byId(doc, "kpi-peer-finding");
  if (block) {
    block.hidden = !finding;
    setData(block, "peerStanding", finding?.standing ?? null);
  }
  for (const [id, key] of PEER_FINDING_SLOTS) setText(doc, id, finding ? finding[key] : "");
  return finding;
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
    writeValueAttributes(card, hero);
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
    if (node) {
      node.dataset.available = String(kpi.available);
      writeValueAttributes(node, kpi);
    }
    // The "unmeasured" marker is a word and a shape, not only a dashed edge, so
    // a card the import could not fill still reads as unfilled in monochrome.
    show(doc, `${slot}-flag`, !kpi.available);
  }
  applyPeerFinding(doc, figures.kpis.find((kpi) => kpi.key === "peer") ?? null);
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
  // The finding was computed from the import's own cohort placement and its own
  // recoverable total. Neither is true of the bundled sample, so it goes with it.
  applyPeerFinding(doc, null);
  const row = byId(doc, "kpi-row");
  if (row) row.dataset.source = "sample";
  const card = byId(doc, "score-card");
  if (card) {
    delete card.dataset.gradeSource;
    for (const key of VALUE_DATA_KEYS) delete card.dataset[key];
  }
  for (const key of ["spend", "recoverable", "productive", "peer"]) {
    show(doc, `kpi-${key}-flag`, false);
    const node = byId(doc, `kpi-${key}`);
    if (node) {
      delete node.dataset.available;
      // The reader's own provenance goes with the reader's own figures. Leaving a
      // row count from a cleared import beside the bundled sample's numbers is
      // the mislabelling this module exists to end, in the other direction.
      for (const dataKey of VALUE_DATA_KEYS) delete node.dataset[dataKey];
    }
  }
  return null;
}
