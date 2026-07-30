// "Where do we stand?" — the one answer the AI FinOps view leads with.
//
// THE PROBLEM THIS SOLVES. The peer position was already computed, already
// correct, and already on the page — in a supporting slot, the fourth card of a
// grid whose four cards all looked equally important. A FinOps lead who opens
// this view is not asking "what are our figures"; they are asking where they
// stand, and a wall of equal-weight cards makes them assemble that answer
// themselves out of four labelled boxes.
//
// So this module composes ONE headline out of figures other modules already
// produce, and publishes everything else as disclosure entries:
//
//   * the peer position, with the metric it is a position ON and its quartile
//     boundaries inline — never a bare band with no denominator,
//   * the recoverable figure beside it, not in a card of its own,
//   * exactly one named lagging team,
//   * exactly one prioritized next action.
//
// ---------------------------------------------------------------------------
// WHAT THIS MODULE MAY AND MAY NOT DO
// ---------------------------------------------------------------------------
//
// 1. IT COMPOSES; IT NEVER RECOMPUTES. Every figure is read off a result some
//    other module owns: `resolveCostPosition` for the position and its band,
//    `leadingFinding` for the lagging department, `prioritizedDestination` for
//    the rank-1 action, `validateCohortAttribution` for import eligibility and
//    the anonymization note, `buildFinopsBriefing` for the rubric and coverage.
//    There is no second arithmetic path here and no place to inject one.
//
// 2. THE WITHHELD POSITION IS A PATH, NOT A LABEL. When a position cannot be
//    shown, this module never emits the bare word "Unavailable". It emits what
//    specifically is missing and one concrete step that would resolve it —
//    verbatim from the eligibility result for an import, and from the table
//    below for the bundled path, where `peer-cost-position.js` publishes the
//    reason but no remedy. Those strings are copy for reasons that module
//    already decided; no eligibility RULE is restated here.
//
// 3. THE BUNDLED EXAMPLE IS THE DEFAULT, NOT A MODE. `buildStandHeadline()`
//    takes no arguments, reads no storage, opens no network, and needs no
//    import. First load with cleared storage is the path that runs here.
//
// 4. NOTHING BELOW BUILDS A NODE. Every value is plain text;
//    `finops-stand-view.js` owns the DOM.

import {
  EXAMPLE_ORG_COHORT_PROFILE, EXAMPLE_TASK_LEDGER, loadExampleDataset,
} from "./example-dataset.js";
import { buildFinopsBriefing } from "./finops-briefing-contract.js";
import { loadCanonicalDecision } from "./finops-decision-contract.js";
import { leadingFinding } from "./finops-leading-finding.js";
import { recoverableShare } from "./finops-first-run.js";
import { validateCohortAttribution } from "./cohort-attribution.js";
import {
  COST_BAND_DIRECTION, COST_METRIC, COST_POSITION_WITHHELD, PEER_COST_COHORTS,
  PEER_COST_PROVENANCE, PEER_COST_SNAPSHOT_ID, displayCostPerSuccessfulTask,
  resolveCostPosition,
} from "./peer-cost-position.js";
import {
  loadWorkspaceDestinations, prioritizedDestination, supportingDestinations,
} from "./finops-destination-contract.js";
import {
  evaluatePositionReproducibility, reproducibilityEntries, reproducibilityNote,
} from "./finops-position-reproducibility.js";

/** Bump when a headline slot, a disclosure, or a withheld sentence changes meaning. */
export const STAND_VERSION = "finops-stand-headline/1.0.0";

/** The lead's own question, in the lead's own words. It is the region's heading. */
export const STAND_QUESTION = "Where do we stand on AI spend?";

/** The element ids the view owns. Nothing else writes them. */
export const STAND_IDS = Object.freeze({
  region: "finops-stand",
  label: "finops-stand-label",
  question: "finops-stand-question",
  answer: "finops-stand-answer",
  positionValue: "finops-stand-position-value",
  positionBasis: "finops-stand-position-basis",
  recoverableValue: "finops-stand-recoverable-value",
  recoverableBasis: "finops-stand-recoverable-basis",
  team: "finops-stand-team",
  teamName: "finops-stand-team-name",
  teamDetail: "finops-stand-team-detail",
  action: "finops-stand-action",
  actionBasis: "finops-stand-action-basis",
  /** The lead line inside the existing comparison disclosure, not a panel of its own. */
  reproducibility: "finops-stand-disclosure-cohort-note",
  withheld: "finops-stand-withheld",
  withheldMissing: "finops-stand-withheld-missing",
  withheldAction: "finops-stand-withheld-action",
  withheldNext: "finops-stand-withheld-next",
  disclosures: "finops-stand-disclosures",
  live: "finops-stand-live",
});

/**
 * The five disclosures, and the sixth the "one action only" rule creates.
 *
 * Every one of them is a SIBLING of the headline. Nothing here may be nested
 * inside another disclosure: "reachable in one step from the headline" is the
 * requirement, and a details inside a details is two.
 */
export const STAND_DISCLOSURE = Object.freeze({
  cohort: "cohort",
  anonymization: "anonymization",
  versions: "versions",
  departments: "departments",
  verification: "verification",
  otherActions: "other-actions",
});

/** The order the disclosures are authored and painted in. */
export const STAND_DISCLOSURE_ORDER = Object.freeze([
  STAND_DISCLOSURE.cohort, STAND_DISCLOSURE.anonymization, STAND_DISCLOSURE.versions,
  STAND_DISCLOSURE.departments, STAND_DISCLOSURE.verification, STAND_DISCLOSURE.otherActions,
]);

/** The visible summary of each disclosure, authored once so markup and module agree. */
export const STAND_DISCLOSURE_SUMMARY = Object.freeze({
  [STAND_DISCLOSURE.cohort]: "How the peer set was built",
  [STAND_DISCLOSURE.anonymization]: "What this comparison read, and what it never reads",
  [STAND_DISCLOSURE.versions]: "Rubric and snapshot versions behind these figures",
  [STAND_DISCLOSURE.departments]: "Every department, ranked",
  [STAND_DISCLOSURE.verification]: "How much of this was verified",
  [STAND_DISCLOSURE.otherActions]: "The other ways on, in priority order",
});

/** The eyebrow above the question, per source. */
export const STAND_LABEL = Object.freeze({
  example: "Bundled synthetic example · nothing of yours needed",
  import: "Your own export · analyzed in this browser",
});

/**
 * The remedy for each way `peer-cost-position.js` can withhold a position.
 *
 * These are COPY, not rules: the module above decides whether a position may be
 * published and publishes the reason; nothing here re-decides eligibility. What
 * it does not publish is a next step, and a reader who is handed a reason with
 * no remedy is being handed a dead label with more words in it.
 */
export const STAND_RESOLUTION = Object.freeze({
  [COST_POSITION_WITHHELD.missingAttributes]:
    "Declare your organization's size band and industry in the export — one column each, on any "
    + "row — and analyze it again.",
  [COST_POSITION_WITHHELD.noMatchingCohort]:
    "Check the declared size band and industry against the published cohorts listed under "
    + `"${STAND_DISCLOSURE_SUMMARY[STAND_DISCLOSURE.cohort]}", then analyze the export again.`,
  [COST_POSITION_WITHHELD.ambiguousMatch]:
    "Declare exactly one size band and one industry across the export, then analyze it again.",
  [COST_POSITION_WITHHELD.noSuccessfulTasks]:
    "Include the task ledger for this window — the rows that carry a terminal outcome — and "
    + "analyze the export again.",
  [COST_POSITION_WITHHELD.snapshotMismatch]:
    `Analyze an export whose window matches cohort snapshot ${PEER_COST_SNAPSHOT_ID}, or wait for `
    + "the next published snapshot.",
  [COST_POSITION_WITHHELD.noSpendTotal]:
    "Include the cost column in the export so a spend total can be attributed, then analyze it "
    + "again.",
});

/** The label on the control that resolves a withheld position. One control, both sources. */
export const STAND_RESOLUTION_ACTION = Object.freeze({
  label: "Choose the export files again",
  /** The page's single file input. There is no second picker on this page. */
  targetId: "local-finops-files",
});

/** What the headline says before anything has been composed into it. */
export const STAND_PENDING = Object.freeze({
  answer: "The bundled example has not been composed on this page yet.",
  position: "Not yet compared",
  recoverable: "Not yet measured",
  team: "No team named yet",
  action: "Not yet ranked",
});

const USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});
const COUNT = new Intl.NumberFormat("en-US");

const usd = (value) => (Number.isFinite(Number(value)) ? USD.format(Number(value)) : null);
const entry = (term, detail) => Object.freeze({ term, detail: String(detail) });
const filled = (value) => typeof value === "string" && value.trim().length > 0;

/**
 * The position line: a band, the metric it is a band ON, and the two quartile
 * boundaries that give the band a denominator.
 *
 * Never a bare rank. "Bottom quartile" on its own is a word a reader cannot
 * check; "Bottom quartile of 4 published cohorts · $38.63 per successful task,
 * against boundaries $18.40 and $31.50" is a claim they can.
 */
function positionSlot(position) {
  if (!position?.available) return null;
  const { cohort } = position;
  return Object.freeze({
    available: true,
    label: "Peer position",
    value: `${position.bandLabel} · ${position.valueDisplay} per successful task`,
    band: position.band,
    basis: `${COST_METRIC.label} against the published cohort ${cohort.label} — quartile `
      + `boundaries ${displayCostPerSuccessfulTask(cohort.p25)} and `
      + `${displayCostPerSuccessfulTask(cohort.p75)} per successful task, over `
      + `${COUNT.format(position.successfulTasks)} successful tasks. ${COST_BAND_DIRECTION} `
      + `This organization sits in the ${position.bandMeaning}.`,
  });
}

/** The recoverable figure, beside the position rather than in a card of its own. */
function recoverableSlot(analysis) {
  const amount = usd(analysis?.recoverableUsd);
  const analyzed = usd(analysis?.spendUsd);
  const share = recoverableShare(analysis?.recoverableUsd, analysis?.spendUsd);
  if (!amount || !analyzed || share === null) {
    return Object.freeze({
      available: false,
      label: "Modelled recoverable",
      value: STAND_PENDING.recoverable,
      basis: "This analysis published no spend total to divide, so no recoverable share is claimed.",
    });
  }
  return Object.freeze({
    available: true,
    label: "Modelled recoverable",
    value: `${amount} · ${Math.round(share * 100)}% of analyzed spend`,
    basis: `${amount} of ${analyzed} analyzed. A modelled routing ceiling, not a realized saving.`,
  });
}

/**
 * Exactly one named team, and the evidence for naming it.
 *
 * The name comes from `leadingFinding` — the same driver the department panels
 * already rank — so the headline and the breakdown can never name two different
 * departments. Runners-up are not in the headline at all; they are in the
 * ranked-departments disclosure, which is where a reader who wants a list goes.
 */
function teamSlot(finding) {
  const name = finding?.driver?.name;
  if (!finding?.available || !filled(name)) {
    return Object.freeze({
      available: false,
      label: "Lagging team",
      name: STAND_PENDING.team,
      detail: finding?.reason
        ?? "No department increased its spend against the prior month, so none is named here.",
    });
  }
  return Object.freeze({
    available: true, label: "Lagging team", name, detail: finding.driverSentence,
  });
}

/**
 * One action. The rank-1 destination and nothing else.
 *
 * The rank is the destination contract's own — `prioritizedDestination` reads
 * the record's `rank === 1` and the record carries the clause that promoted it.
 * This module does not re-rank, and the destinations it did not pick are put
 * behind the "other ways on" disclosure rather than dropped.
 */
function actionSlot(record) {
  const top = prioritizedDestination(record);
  if (!top || !filled(top.label) || !filled(top.href)) {
    return Object.freeze({
      available: false, label: STAND_PENDING.action, href: null,
      basis: "No destination is ranked first in the published record, so none is offered here.",
    });
  }
  return Object.freeze({
    available: true,
    label: top.callToAction ?? top.label,
    href: top.href,
    basis: `${top.answers} ${top.selectionBasis}`,
  });
}

/** The one sentence a reader who stops at the top has still read. */
function answerSentence(position, recoverable, team) {
  if (!position?.available) return null;
  const parts = [`This organization is in the ${position.band === "bottom_quartile"
    ? "most expensive quarter" : position.bandMeaning ?? "cohort"} of its peer cohort at `
    + `${position.value.split(" · ")[1] ?? position.value}.`];
  if (recoverable?.available) parts.push(`${recoverable.value.split(" · ")[0]} is modelled recoverable.`);
  if (team?.available) parts.push(`${team.name} is the department driving it.`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// The disclosures. Each is a flat list of term/detail pairs, one step from the
// headline, and each is built from a result some other module already produced.
// ---------------------------------------------------------------------------

function cohortEntries(position, reproducibility) {
  const cohort = position?.cohort ?? null;
  const rows = [
    entry("Question answered", COST_METRIC.label),
    entry("Metric definition", COST_METRIC.definition),
    entry("Published cohorts", `${COUNT.format(PEER_COST_COHORTS.length)} cohorts, each keyed on a `
      + "declared organization size band and a declared industry. A cohort is matched, never "
      + "inferred, and a match must be unique."),
  ];
  if (cohort) {
    rows.push(entry("Matched cohort", `${cohort.label} — declared band ${cohort.sizeBandLabel}, `
      + `declared industry ${cohort.industryLabel}.`));
    rows.push(entry("Quartile boundaries", `${displayCostPerSuccessfulTask(cohort.p25)} and `
      + `${displayCostPerSuccessfulTask(cohort.p75)} per successful task. `
      + COST_BAND_DIRECTION));
  }
  rows.push(entry("Where the cohorts come from",
    `${PEER_COST_PROVENANCE.label}. ${PEER_COST_PROVENANCE.statement}`));
  // The reproducibility result belongs in THIS disclosure rather than in a panel
  // of its own: a reader who has opened "how the peer set was built" is already
  // asking whether the comparison holds, and rubric version, snapshot date,
  // confidence and last verification are the four answers to that question. When
  // a refusal is active these rows carry its reason in place of the figure.
  rows.push(...reproducibilityEntries(reproducibility));
  return rows;
}

function anonymizationEntries(note) {
  if (!note) return [entry("Anonymization", "No comparison was run, so nothing was read.")];
  return [
    entry(note.label, note.text),
    entry("Fields read", note.fieldsRead.join(", ")),
    entry(note.provenance.label, note.provenance.statement),
  ];
}

function versionEntries(analysis, briefing, position) {
  return [
    entry("Analysis schema", analysis?.schemaVersion ?? "no analysis schema"),
    entry("Briefing contract", briefing?.contractVersion ?? "no briefing contract"),
    entry("Routing rubric", briefing?.rubricVersion ?? "no rubric"),
    entry("Cohort snapshot", position?.cohort?.snapshotId ?? PEER_COST_SNAPSHOT_ID),
    entry("Position contract", position?.version ?? STAND_VERSION),
    entry("Headline contract", STAND_VERSION),
  ];
}

function departmentEntries(analysis) {
  const ranked = Array.isArray(analysis?.rankedDepartments) ? analysis.rankedDepartments : [];
  if (!ranked.length) return [entry("Departments", "This analysis ranked no departments.")];
  return ranked.map((department, index) => entry(
    `${index + 1}. ${department.name}`,
    `${usd(department.spendUsd) ?? "no spend total"} analyzed spend · `
    + `${usd(department.recoverableUsd) ?? "no modelled recoverable"} modelled recoverable`
    + (Number.isFinite(Number(department.previousSpendUsd))
      ? ` · ${usd(department.previousSpendUsd)} in the prior period.` : ".")));
}

function verificationEntries(decision, briefing) {
  const confidence = decision?.confidence ?? null;
  const coverage = briefing?.coverage ?? null;
  const rows = [];
  if (Number.isFinite(Number(confidence?.score)) && filled(confidence?.basis)) {
    rows.push(entry("Confidence",
      `${Number(confidence.score).toFixed(2)} of 1.00 · ${confidence.band}`));
    rows.push(entry("Basis", confidence.basis));
  } else {
    rows.push(entry("Confidence",
      "No confidence score was published with this analysis, so none is claimed."));
  }
  if (coverage && Number.isFinite(Number(coverage.recordsTotal))) {
    rows.push(entry("Coverage", `${COUNT.format(coverage.recordsAnalyzed ?? 0)} of `
      + `${COUNT.format(coverage.recordsTotal ?? 0)} records analyzed · `
      + `confidence ${coverage.confidence ?? "unknown"}.`));
  }
  for (const limit of confidence?.limits ?? []) {
    rows.push(entry(`Not verified · ${limit.code}`, limit.detail));
  }
  return rows;
}

function otherActionEntries(record) {
  const supporting = supportingDestinations(record);
  if (!supporting.length) {
    return [entry("Other ways on", "The published record ranks no destination below rank 1.")];
  }
  return supporting.map((destination) => entry(
    `Rank ${destination.rank} · ${destination.label}`,
    `${destination.answers} ${destination.doesNotAnswer}`));
}

function disclosure(id, entries) {
  return Object.freeze({
    id, summary: STAND_DISCLOSURE_SUMMARY[id], entries: Object.freeze(entries),
  });
}

// ---------------------------------------------------------------------------
// Composition.
// ---------------------------------------------------------------------------

/**
 * Compose the headline from results other modules produced.
 *
 * Total, like every other composer on this page: an input this cannot read
 * resolves to a withheld headline with a reason and a remedy, because the
 * disclosures and the resolving action stay useful in exactly those cases and a
 * region that vanishes takes them with it.
 *
 * @param position a `resolveCostPosition` result, or null.
 * @param eligibility a `validateCohortAttribution` result, or null. Owns the
 *   anonymization note in both states, and owns the withheld sentence and the
 *   next step whenever the reader is looking at their own import.
 */
export function composeStandHeadline({
  analysis = null, briefing = null, position = null, finding = null, decision = null,
  destinations = null, eligibility = null, source = "example", reproducibility = null,
} = {}) {
  const recoverable = recoverableSlot(analysis);
  const team = teamSlot(finding);
  const action = actionSlot(destinations);
  // A refusal outranks a computed position, and it does so here rather than in
  // the view: the headline sentence, the position slot, the answer a reader
  // repeats in a review, and the disclosure are all composed from `placed`, so
  // dropping it in one place is what makes "no number reaches the executive view"
  // true of every one of them at once.
  const placed = reproducibility?.refused ? null : positionSlot(position);
  const withheld = placed ? null : withheldFrom(position, eligibility, source, reproducibility);
  return Object.freeze({
    version: STAND_VERSION,
    question: STAND_QUESTION,
    source,
    label: STAND_LABEL[source] ?? STAND_LABEL.example,
    positioned: Boolean(placed),
    /** The headline is complete when every one of its five parts is present. */
    available: Boolean(placed && recoverable.available && team.available && action.available),
    answer: answerSentence(placed, recoverable, team)
      ?? withheld?.missing ?? STAND_PENDING.answer,
    position: placed ?? Object.freeze({
      available: false, label: "Peer position", value: STAND_PENDING.position, band: null,
      basis: withheld?.missing ?? STAND_PENDING.answer,
    }),
    recoverable,
    team,
    action,
    withheld,
    /** The inspectable result, and the one line the comparison disclosure leads with. */
    reproducibility,
    reproducibilityNote: reproducibilityNote(reproducibility),
    disclosures: Object.freeze([
      disclosure(STAND_DISCLOSURE.cohort, cohortEntries(position, reproducibility)),
      disclosure(STAND_DISCLOSURE.anonymization, anonymizationEntries(eligibility?.note ?? null)),
      disclosure(STAND_DISCLOSURE.versions, versionEntries(analysis, briefing, position)),
      disclosure(STAND_DISCLOSURE.departments, departmentEntries(analysis)),
      disclosure(STAND_DISCLOSURE.verification, verificationEntries(decision, briefing)),
      disclosure(STAND_DISCLOSURE.otherActions, otherActionEntries(destinations)),
    ]),
  });
}

/**
 * The action-led path for a position that cannot be shown.
 *
 * Two sources, one shape. An import's sentence and remedy are the eligibility
 * result's own, verbatim — that module already decided why the file cannot be
 * placed and what would fix it, and paraphrasing it here would be a second
 * eligibility rule wearing the first one's clothes. The bundled path has no
 * eligibility result, so the reason is the position contract's and the remedy
 * comes from the copy table above.
 */
function withheldFrom(position, eligibility, source, reproducibility = null) {
  // A refusal is checked first and in both sources. It is the only one of these
  // paths that can fire while the position itself computed cleanly — a rubric
  // version mismatch produces perfectly good arithmetic against boundaries that
  // mean something else — so a later branch reading `position.reason` would
  // publish the wrong explanation for a withheld figure.
  if (reproducibility?.refused) {
    return Object.freeze({
      reasonCode: reproducibility.refusal.code,
      missing: reproducibility.refusal.reason,
      nextStep: reproducibility.refusal.nextStep,
      actionLabel: STAND_RESOLUTION_ACTION.label,
    });
  }
  if (source === "import" && eligibility && eligibility.eligible === false) {
    return Object.freeze({
      reasonCode: eligibility.reason,
      missing: eligibility.reasonText,
      nextStep: eligibility.nextStep,
      actionLabel: STAND_RESOLUTION_ACTION.label,
    });
  }
  const code = position?.reasonCode ?? null;
  return Object.freeze({
    reasonCode: code,
    missing: position?.reason
      ?? "No peer position: this view produced no comparison to place this organization in.",
    nextStep: STAND_RESOLUTION[code]
      ?? "Analyze a provider export that declares an organization size band and an industry.",
    actionLabel: STAND_RESOLUTION_ACTION.label,
  });
}

/**
 * The bundled example headline. No arguments, no storage, no network, no import.
 *
 * This is the first-load path, and it is the DEFAULT path: the page calls this
 * on boot before anything has been chosen, so a lead who lands with cleared
 * storage reads the complete headline rather than an invitation to produce one.
 *
 * `loadAnalysis` and `loadDecision` are injectable for tests only. Neither has a
 * caller that passes anything but the shipped default.
 */
export function buildStandHeadline(loadAnalysis = loadExampleDataset,
  loadDecision = loadCanonicalDecision) {
  try {
    const analysis = loadAnalysis();
    const briefing = buildFinopsBriefing(analysis);
    let decision = null;
    try {
      const loaded = loadDecision();
      decision = loaded?.valid ? (loaded.decision ?? null) : null;
    } catch {
      decision = null;
    }
    return composeStandHeadline({
      analysis,
      briefing,
      decision,
      source: "example",
      position: resolveCostPosition({
        org: EXAMPLE_ORG_COHORT_PROFILE,
        spendUsd: Number(analysis?.spendUsd),
        tasks: EXAMPLE_TASK_LEDGER,
      }),
      // The same inputs, run through the guard that decides whether the position
      // above may be published at all. It is computed here rather than inside
      // `composeStandHeadline` because the composer is total over what it is
      // handed and does not know how to re-derive an org's ledger.
      reproducibility: evaluatePositionReproducibility({
        analysis,
        org: EXAMPLE_ORG_COHORT_PROFILE,
        tasks: EXAMPLE_TASK_LEDGER,
      }),
      finding: leadingFinding(analysis),
      destinations: loadWorkspaceDestinations().record,
      // The bundled example imports nothing, so the eligibility result carries
      // no position — but it does carry the anonymization note, which is a
      // statement about what the comparison read and is owed in both states.
      eligibility: validateCohortAttribution({}),
    });
  } catch {
    return composeStandHeadline({ source: "example" });
  }
}

/**
 * The headline for a reader's own import.
 *
 * The eligibility decision is Anya's, unchanged and unreinterpreted: this passes
 * the result through and lets `withheldFrom` read the sentence and the next step
 * off it. When the import IS eligible the cohort it was placed against becomes
 * the position line, because that is the placement the import contract
 * publishes; the quartile band on cost per successful task belongs to the
 * bundled path, which is the only one that ships a task ledger to divide by.
 */
export function standHeadlineForImport({ analysis = null, eligibility = null } = {}) {
  let briefing = null;
  try {
    briefing = buildFinopsBriefing(analysis);
  } catch {
    briefing = null;
  }
  const composed = composeStandHeadline({
    analysis,
    briefing,
    eligibility,
    source: "import",
    finding: analysis ? leadingFinding(analysis) : null,
    destinations: loadWorkspaceDestinations().record,
  });
  if (!eligibility?.eligible || !eligibility.position) return composed;
  const { position } = eligibility;
  const placed = Object.freeze({
    available: true,
    label: "Peer position",
    value: `Compared against ${position.label}`,
    band: null,
    basis: `${COUNT.format(position.memberCount)} organizations in ${position.segmentLabel} · `
      + `declared band ${position.orgSizeBand} · declared industry ${position.industry} · `
      + `${COUNT.format(position.orgUnits)} attributed org unit`
      + `${position.orgUnits === 1 ? "" : "s"} counted from this export · cohort snapshot `
      + `${position.snapshotDate}`,
  });
  return Object.freeze({
    ...composed,
    positioned: true,
    withheld: null,
    position: placed,
    available: Boolean(composed.recoverable.available && composed.team.available
      && composed.action.available),
    answer: `This export is compared against ${position.label}.`
      + (composed.recoverable.available
        ? ` ${composed.recoverable.value.split(" · ")[0]} is modelled recoverable.` : "")
      + (composed.team.available ? ` ${composed.team.name} is the department driving it.` : ""),
  });
}
