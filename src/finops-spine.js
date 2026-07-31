// The AI FinOps answer spine: ONE question, ONE metric, ONE action, ONE
// artifact — declared as data, in one place, with no rendering in it.
//
// WHY THIS EXISTS. /evolution.html answers a real question, but a first-time
// FinOps lead used to meet several regions that each looked like the answer:
// a headline asking "where do we stand?", a front door asking "are we wasting
// money?", a next-step region asking "where do I start?", a journey region
// asking "what do I do next?", and a destinations region asking "where do I go
// next to act on this?". Five near-identical questions at the same visual
// weight is not five answers. It is one answer the reader has to assemble.
//
// src/finops/answer-spine-view.js already declares what each top-level region
// is FOR and audits that against the shipped document. It is the region census.
// What it does not say — and what four issues in a row have re-argued — is what
// the PAGE's one answer is: the question, the number that answers it, the thing
// to do about it, and the thing to forward. That is this file.
//
// THIS FILE IS DATA. It imports nothing, reads no dataset, paints nothing, and
// holds no figure. Importing nothing is deliberate and load-bearing: the
// decision contract, the region census, and the headline view all read this
// module, and two of them are already in each other's import graph. A leaf
// cannot close a cycle.
//
// The region census and this spine are two lists of the same regions, so
// tests/finops-spine.test.js asserts they agree — same ids, and a role here for
// every role there — rather than either one importing the other.

/** Bump when the question, the metric rule, or a classification changes meaning. */
export const FINOPS_SPINE_VERSION = "finops-spine/1.0.0";

/**
 * The three things a top-level region of this page can be.
 *
 * `answer`   The one region that carries the spine: the question, the metric,
 *            the action, the artifact. There is exactly one, and the validator
 *            refuses a second.
 * `evidence` A region that supports the answer. It may hold a figure, a
 *            control, or wayfinding; it may not present itself as the page's
 *            complete answer.
 * `removed`  A region that no longer earns a place at this level. Removed means
 *            gone from the document, not hidden inside it.
 */
export const REGION_CLASS = Object.freeze({
  answer: "answer",
  evidence: "evidence",
  removed: "removed",
});

/** Attributes the page stamps from this module. Inert: nothing styles on them. */
export const SPINE_CLASS_ATTRIBUTE = "data-spine-class";
export const SPINE_STATE_ATTRIBUTE = "data-spine-state";
export const SPINE_EVIDENCE_RANK_ATTRIBUTE = "data-spine-evidence-rank";

/** The two states this page can truthfully be in. */
export const SPINE_STATE = Object.freeze({
  preImport: "pre-import",
  postImport: "post-import",
});

/** Half-up to `places`, so 0.8455 → 0.846 rather than 0.845. */
function roundHalfUp(value, places) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round((value * factor).toPrecision(15) * 1) / factor;
}

/**
 * The headline metric, computed the one way this product computes it.
 *
 * Returns a record rather than a number so a caller never has to decide what an
 * absent value means: `available` is false and `unavailableReason` says why. It
 * never throws, never guesses a denominator, and never returns 0 for "unknown".
 *
 * @param {{recoverableUsd?: number, spendUsd?: number, period?: object}|null} data
 *   An analysis record as `src/finops-stand.js` and `src/finops-first-run.js`
 *   already produce one. No other shape is read.
 */
function computeRecoverableShare(data) {
  const recoverableUsd = Number(data?.recoverableUsd);
  const spendUsd = Number(data?.spendUsd);
  const window = Object.freeze({
    start: data?.period?.start ?? null,
    end: data?.period?.end ?? null,
  });
  const base = { recoverableUsd: null, spendUsd: null, share: null, window };

  if (!Number.isFinite(spendUsd) || spendUsd <= 0) {
    return Object.freeze({
      ...base,
      available: false,
      unavailableReason: "no_analyzed_spend_total",
    });
  }
  if (!Number.isFinite(recoverableUsd) || recoverableUsd < 0) {
    return Object.freeze({
      ...base,
      spendUsd,
      available: false,
      unavailableReason: "no_recoverable_total",
    });
  }
  return Object.freeze({
    recoverableUsd,
    spendUsd,
    share: roundHalfUp(recoverableUsd / spendUsd, 4),
    window,
    available: true,
    unavailableReason: null,
  });
}

/**
 * Every top-level region of /evolution.html, classified.
 *
 * The ids are the ones authored in src/evolution.html and declared in
 * src/finops/answer-spine-view.js — none is invented here. Declaration order is
 * the document's order, which is what makes a diff of this map readable beside
 * a diff of the markup.
 */
const REGIONS = Object.freeze({
  "finops-stand": REGION_CLASS.answer,
  "finops-hero": REGION_CLASS.evidence,
  "finops-first-run": REGION_CLASS.evidence,
  // Two of the three "this month" regions are top-level as their DISCLOSURE,
  // not as their section: #742 folded each into the page's `support-disclosure`
  // idiom so an evidence region no longer opens at the answer's weight. The
  // section keeps its own id and its own view; the wrapper is what the document
  // holds at this level, so it is the id classified here.
  // `finops-destinations` is deliberately NOT folded: its rank-1 door must stay
  // in the tab order without a reader opening anything first.
  "disclosure-next-step": REGION_CLASS.evidence,
  "disclosure-journey": REGION_CLASS.evidence,
  "finops-destinations": REGION_CLASS.evidence,
  "finops-workspace-nav": REGION_CLASS.evidence,
  "finops-workspace-switch": REGION_CLASS.removed,
  "finops-workspace-context": REGION_CLASS.evidence,
  "finops-first-run-conversion": REGION_CLASS.removed,
  "finops-load-state": REGION_CLASS.evidence,
  "score-card": REGION_CLASS.evidence,
  "finops-portfolio-brief": REGION_CLASS.evidence,
  "guided-result": REGION_CLASS.evidence,
  "local-import": REGION_CLASS.evidence,
  "prompt-coaching": REGION_CLASS.evidence,
  "finops-contact": REGION_CLASS.evidence,
  "finops-proof-point": REGION_CLASS.evidence,
  "finops-headline": REGION_CLASS.evidence,
  "classifier-agreement": REGION_CLASS.evidence,
  "disclosure-grade-comparisons": REGION_CLASS.evidence,
  "graded-sample": REGION_CLASS.evidence,
  "org-coaching": REGION_CLASS.evidence,
  "spend-per-delivery": REGION_CLASS.evidence,
  "department-evidence": REGION_CLASS.evidence,
  "department-fix-pack": REGION_CLASS.evidence,
  "monthly-department-decision": REGION_CLASS.evidence,
  "disclosure-spend-and-recovery": REGION_CLASS.evidence,
  "disclosure-department-priority": REGION_CLASS.evidence,
  "disclosure-spend-mix": REGION_CLASS.evidence,
  "disclosure-savings-portfolio": REGION_CLASS.evidence,
  "disclosure-recommendation-evidence": REGION_CLASS.evidence,
  "finops-privacy": REGION_CLASS.evidence,
});

/**
 * The evidence, in layers, in the order a lead needs them.
 *
 * This is a PRIORITY, not the document's source order. The markup order is
 * `REGIONS` above; this says which follow-up question each group of regions
 * answers and which follow-up comes first. The page stamps each evidence region
 * with its rank in this flattened order, so a later collapse or progressive-
 * disclosure pass has a declared order to act on instead of an argument.
 *
 * Every evidence region appears in exactly one layer. The validator enforces
 * both halves of that: no region in two layers, no evidence region in none.
 */
const EVIDENCE_LAYERS = Object.freeze([
  Object.freeze({
    id: "what-this-page-is",
    question: "What can this page tell me, and what does it need from me?",
    regionIds: Object.freeze(["finops-hero", "finops-load-state"]),
  }),
  Object.freeze({
    id: "the-decision-record",
    question: "What is the complete answer behind that headline, and how far do you stand behind it?",
    regionIds: Object.freeze(["finops-first-run", "guided-result", "finops-portfolio-brief"]),
  }),
  Object.freeze({
    id: "what-to-do-this-month",
    question: "What do I do first, and what will tell me it worked?",
    regionIds: Object.freeze([
      "disclosure-next-step", "disclosure-journey", "finops-destinations",
      "monthly-department-decision",
    ]),
  }),
  Object.freeze({
    id: "where-the-money-goes",
    question: "Which spend is driving that number, and which department owns it?",
    regionIds: Object.freeze([
      "disclosure-spend-and-recovery", "disclosure-spend-mix", "spend-per-delivery",
      "disclosure-savings-portfolio", "disclosure-department-priority",
      "department-evidence", "department-fix-pack", "org-coaching",
    ]),
  }),
  Object.freeze({
    id: "run-it-on-my-own-numbers",
    question: "Can I run this on my own export without uploading it anywhere?",
    regionIds: Object.freeze(["local-import", "finops-privacy"]),
  }),
  Object.freeze({
    id: "how-it-was-worked-out",
    question: "How was this worked out, and can someone else repeat it?",
    regionIds: Object.freeze([
      "score-card", "finops-headline", "classifier-agreement",
      "disclosure-grade-comparisons", "graded-sample",
      "disclosure-recommendation-evidence", "prompt-coaching", "finops-proof-point",
      "finops-contact",
    ]),
  }),
  Object.freeze({
    id: "getting-around",
    question: "Which part of this workspace am I in, and how do I get to another?",
    regionIds: Object.freeze([
      "finops-workspace-nav", "finops-workspace-context",
    ]),
  }),
]);

/**
 * The spine.
 *
 * One question, one metric, one action, one artifact, and the classification of
 * everything else on the page.
 */
export const FINOPS_SPINE = Object.freeze({
  version: FINOPS_SPINE_VERSION,

  /**
   * The one question this page answers, in the words a lead asks it in.
   *
   * It is the heading of the answer region verbatim, and a test asserts that —
   * a page whose visible heading and whose declared question have drifted apart
   * is answering one question and claiming another.
   */
  question: "Where do we stand on AI spend?",

  /** The region that carries the spine, and what it may delegate. */
  answerRegion: Object.freeze({
    id: "finops-stand",
    headingId: "finops-stand-question",

    /**
     * WHO MAY CLAIM TO BE THE COMPLETE DECISION SUMMARY.
     *
     * The single-summary rule in src/finops-decision-contract.js used to be
     * enforced against whatever a region said about itself in markup: a region
     * that wrote `data-decision-summary="complete"` on itself was a complete
     * summary, and the only check was that no two visible ones existed at once.
     * Entitlement now comes from here — from the answer region's own
     * declaration — and a region that claims `complete` without appearing in
     * this list is a violation the referee reports by name.
     *
     * The order is precedence, most specific first: a lead's own combined
     * portfolio outranks their single-provider result, which outranks the
     * bundled example. `defaultRegionId` is the holder before anything is
     * imported.
     */
    completeSummary: Object.freeze({
      attribute: "data-decision-summary",
      claim: "complete",
      defaultRegionId: "finops-first-run",
      claimants: Object.freeze([
        Object.freeze({
          regionId: "finops-portfolio-brief",
          when: "The reader imported two or more provider exports and the comparability verdict "
            + "allowed them to be combined.",
        }),
        Object.freeze({
          regionId: "guided-result",
          when: "The reader imported their own export and a recommendation was derived from it.",
        }),
        Object.freeze({
          regionId: "finops-first-run",
          when: "Nothing of the reader's has been imported, so the bundled synthetic example "
            + "carries the record and says so.",
        }),
      ]),
    }),
  }),

  /**
   * THE ONE MATERIAL METRIC.
   *
   * Defined here to the point where two engineers compute the same number:
   * numerator field, denominator field, unit, window, rounding, and the
   * accessor itself. Callers use `computeFrom`; nobody re-derives it.
   */
  metric: Object.freeze({
    id: "recoverable-share-of-analyzed-spend",

    /** The label the answer region shows. Rendered from here, not authored twice. */
    name: "Recoverable spend",

    definition:
      "Of the AI spend analyzed in this window, the share this page models as recoverable by "
      + "re-routing work to cheaper models. It is a modelled ceiling on what re-routing could "
      + "save, not an invoiced or realized saving, and it is never presented as one.",

    numerator: Object.freeze({
      field: "recoverableUsd",
      description: "Modelled recoverable spend over the analyzed window, in USD.",
      unit: "usd",
    }),

    denominator: Object.freeze({
      field: "spendUsd",
      description: "Total AI spend the analysis actually read over the same window, in USD. "
        + "Spend the export did not carry is not in it, so the share is over analyzed spend "
        + "and not over the organization's total spend.",
      unit: "usd",
    }),

    /** The quotient's unit, and the unit each side of it is stated in. */
    unit: "ratio_of_analyzed_spend",
    displayUnit: "percent of analyzed spend",
    amountUnit: "usd",

    timeWindow: Object.freeze({
      basis: "period",
      fields: Object.freeze(["period.start", "period.end"]),
      description: "The analysis period the source record declares — the same window on both "
        + "sides of the division. A numerator and a denominator from two windows is not this "
        + "metric.",
    }),

    /** Every field read, so a reviewer can check the accessor against the list. */
    sourceFields: Object.freeze(["recoverableUsd", "spendUsd", "period.start", "period.end"]),

    rounding: "The share is rounded half-up to four decimal places. The USD amounts are not "
      + "rounded here; the view that shows them owns its own display rounding.",

    unavailableWhen: Object.freeze([
      Object.freeze({
        reason: "no_analyzed_spend_total",
        description: "The analysis published no positive spend total, so there is nothing to "
          + "divide by. The metric is withheld — never reported as zero.",
      }),
      Object.freeze({
        reason: "no_recoverable_total",
        description: "The analysis published a spend total but no recoverable figure.",
      }),
    ]),

    computeFrom: computeRecoverableShare,
  }),

  /**
   * THE ONE PRIORITIZED NEXT ACTION, and the condition it is shown under.
   *
   * One action, two conditions — not two actions. Before an import there is
   * exactly one honest thing to ask a lead to do, because every figure on the
   * page belongs to an invented company; after an import the action is whatever
   * the resolver ranked first out of the lead's own data.
   */
  action: Object.freeze({
    id: "one-ranked-action",
    regionId: "finops-stand-action",
    shownWhen: "A ranked action exists for the data currently loaded.",
    condition: Object.freeze({
      requires: "ranked-action-available",
      state: SPINE_STATE.postImport,
    }),
    fallback: Object.freeze({
      id: "import-your-own-export",
      label: "Analyze your own export",
      regionId: "local-import",
      shownWhen: "Nothing of the reader's has been imported yet, so no action can be ranked "
        + "against their spend.",
      condition: Object.freeze({
        requires: "no-reader-import",
        state: SPINE_STATE.preImport,
      }),
    }),
  }),

  /**
   * THE ONE FORWARDABLE ARTIFACT.
   *
   * One page, openable by a link, readable by someone who never opened this
   * workspace. What it carries is listed, and so is what it never carries.
   */
  artifact: Object.freeze({
    id: "executive-finops-briefing",
    name: "Executive FinOps briefing",
    regionId: "finops-first-run-briefing",
    href: "/executive-briefing.html",
    format: "one-page briefing, printable, openable from a link",
    contains: Object.freeze([
      "The headline metric with its window and its basis",
      "The one prioritized action and why it ranked first",
      "The confidence in the answer, and what limits it",
      "Whether the figures came from the reader's own import or from the bundled example",
    ]),
    excludes: Object.freeze([
      "Credentials of any kind",
      "Customer data",
      "Stored prompts",
      "Anything read from a live integration",
    ]),
  }),

  evidenceLayers: EVIDENCE_LAYERS,
  regions: REGIONS,

  /**
   * WHAT THE PAGE MAY TRUTHFULLY CLAIM BEFORE ANYTHING IS IMPORTED.
   *
   * This is the contract the import, collapse, and accessibility work downstream
   * has to satisfy, so it is machine-readable and not a paragraph in a comment.
   * The load-bearing field is `readerDataPresent: false` paired with
   * `metricValue: null`: a page that has read nothing has no number of the
   * lead's to show, and the bundled example's number is not a stand-in for it.
   */
  preImportState: Object.freeze({
    id: SPINE_STATE.preImport,
    readerDataPresent: false,
    headlineSource: "bundled-synthetic-example",
    sourceLabel: "Bundled synthetic example · nothing of yours needed",
    metricAvailable: false,
    metricValue: null,
    metricSource: "bundled-synthetic-example",
    /** The one rule this state exists to hold. Asserted directly by the tests. */
    presentsSyntheticAsReaderData: false,
    claim: "No figure on this page is yours yet. Every number visible now was computed from a "
      + "bundled synthetic example — invented data for an invented company — and is labelled as "
      + "the example's wherever it appears.",
    action: "import-your-own-export",
    artifactAvailable: true,
    artifactScope: "The briefing for the bundled example, labelled as the example's.",
  }),

  /** What changes once the lead imports their own export. */
  postImportState: Object.freeze({
    id: SPINE_STATE.postImport,
    readerDataPresent: true,
    headlineSource: "reader-import",
    sourceLabel: "Your own export · analyzed in this browser",
    metricAvailable: true,
    metricSource: "reader-import",
    presentsSyntheticAsReaderData: false,
    claim: "The headline metric is computed from the export this browser read. It was not "
      + "uploaded, and no figure from the bundled example is mixed into it.",
    action: "one-ranked-action",
    artifactAvailable: true,
    artifactScope: "The briefing for the reader's own imported export.",
  }),
});

/** The one region classified `answer`. */
export function answerRegionId(spine = FINOPS_SPINE) {
  return spine?.answerRegion?.id ?? null;
}

/** A region's classification, or null when the spine does not classify it. */
export function regionClass(id, spine = FINOPS_SPINE) {
  return Object.prototype.hasOwnProperty.call(spine?.regions ?? {}, id)
    ? spine.regions[id]
    : null;
}

/** Every region with the given classification, in declaration order. */
function regionsClassified(value, spine) {
  return Object.keys(spine?.regions ?? {}).filter((id) => spine.regions[id] === value);
}

/** The regions that support the answer, in declaration (document) order. */
export function evidenceRegionIds(spine = FINOPS_SPINE) {
  return regionsClassified(REGION_CLASS.evidence, spine);
}

/** The regions that must NOT be top-level peers. Absent is the passing state. */
export function removedRegionIds(spine = FINOPS_SPINE) {
  return regionsClassified(REGION_CLASS.removed, spine);
}

/**
 * The evidence regions in the order the layers put them, flattened.
 *
 * This is the reading priority the page stamps, not the markup order.
 */
export function evidenceOrder(spine = FINOPS_SPINE) {
  return (spine?.evidenceLayers ?? []).flatMap((layer) => [...(layer?.regionIds ?? [])]);
}

/** The ids entitled to carry the complete-summary claim, in precedence order. */
export function completeSummaryClaimantIds(spine = FINOPS_SPINE) {
  return (spine?.answerRegion?.completeSummary?.claimants ?? []).map((entry) => entry.regionId);
}

/** The holder of the complete-summary claim before anything is imported. */
export function defaultCompleteSummaryId(spine = FINOPS_SPINE) {
  return spine?.answerRegion?.completeSummary?.defaultRegionId ?? null;
}

/** The state record for a page that has, or has not, read the reader's export. */
export function spineStateFor({ imported = false } = {}, spine = FINOPS_SPINE) {
  return imported ? spine.postImportState : spine.preImportState;
}

/** The headline metric for an analysis record. The only accessor callers use. */
export function computeHeadlineMetric(data, spine = FINOPS_SPINE) {
  return spine.metric.computeFrom(data);
}

/**
 * Check the spine, and optionally check it against the shipped page.
 *
 * Returns every problem as a plain sentence and never throws — the caller
 * decides whether a problem is fatal. Nothing on the paint path calls this; it
 * is for the tests and for anyone auditing the page.
 *
 * @param {object} spine
 * @param {{rendered?: ReadonlyArray<string>|null}} options
 *   `rendered` — the page's actual top-level region ids, in document order.
 */
export function validateFinopsSpine(spine = FINOPS_SPINE, { rendered = null } = {}) {
  const problems = [];
  const regions = spine?.regions ?? {};
  const ids = Object.keys(regions);
  const allowed = new Set(Object.values(REGION_CLASS));

  if (ids.length === 0) problems.push("The spine classifies no regions.");
  for (const id of ids) {
    if (!allowed.has(regions[id])) {
      problems.push(`Region "${id}" is classified "${regions[id]}", which is not one of: `
        + `${[...allowed].join(", ")}.`);
    }
  }

  const answers = regionsClassified(REGION_CLASS.answer, spine);
  if (answers.length !== 1) {
    problems.push(`Exactly one region is the answer; the spine classifies ${answers.length}`
      + `${answers.length ? ` (${answers.join(", ")})` : ""}.`);
  } else if (answers[0] !== answerRegionId(spine)) {
    problems.push(`The answer region is declared as "${answerRegionId(spine)}" but "${answers[0]}" `
      + "is the region classified as the answer.");
  }

  // Every evidence region is in exactly one layer, and no layer names a region
  // that is not evidence. A layer list that drifts from the classification is
  // how an evidence region ends up with no declared place to be read.
  const layered = new Map();
  for (const layer of spine?.evidenceLayers ?? []) {
    if (!layer?.id) problems.push("An evidence layer has no id.");
    if (typeof layer?.question !== "string" || layer.question.trim() === "") {
      problems.push(`Evidence layer "${layer?.id}" declares no question.`);
    }
    for (const id of layer?.regionIds ?? []) {
      const owner = layered.get(id);
      if (owner) problems.push(`Region "${id}" is in two evidence layers ("${owner}" and "${layer.id}").`);
      else layered.set(id, layer.id);
      if (regionClass(id, spine) !== REGION_CLASS.evidence) {
        problems.push(`Evidence layer "${layer.id}" names "${id}", which is classified `
          + `"${regionClass(id, spine) ?? "nothing"}".`);
      }
    }
  }
  for (const id of evidenceRegionIds(spine)) {
    if (!layered.has(id)) problems.push(`Evidence region "${id}" is in no evidence layer.`);
  }

  // A claimant that is not on the page cannot hold the claim, and a claimant
  // that is the answer region itself would put the page back where it started.
  for (const id of completeSummaryClaimantIds(spine)) {
    if (regionClass(id, spine) !== REGION_CLASS.evidence) {
      problems.push(`"${id}" is entitled to the complete-summary claim but is not an evidence region.`);
    }
  }
  const fallbackId = defaultCompleteSummaryId(spine);
  if (!completeSummaryClaimantIds(spine).includes(fallbackId)) {
    problems.push(`The default complete summary "${fallbackId}" is not one of the claimants.`);
  }

  if (spine?.preImportState?.readerDataPresent !== false
    || spine?.preImportState?.presentsSyntheticAsReaderData !== false
    || spine?.preImportState?.metricValue !== null) {
    problems.push("The pre-import state must declare that no reader data is present, that no "
      + "synthetic figure is presented as the reader's, and that the metric has no value.");
  }

  if (Array.isArray(rendered)) {
    for (const id of rendered) {
      const role = regionClass(id, spine);
      if (!role) {
        problems.push(`Region "${id}" is on the page but the spine does not classify it.`);
      } else if (role === REGION_CLASS.removed) {
        problems.push(`Region "${id}" is classified removed but is still a top-level region.`);
      }
    }
    for (const id of [...answers, ...evidenceRegionIds(spine)]) {
      if (!rendered.includes(id)) problems.push(`Region "${id}" is classified but is not on the page.`);
    }
  }

  return problems;
}

/**
 * Stamp the document with the spine: the answer region's class and state, and
 * every evidence region's rank in the declared reading priority.
 *
 * Attributes only. This moves nothing, hides nothing, and writes no copy — the
 * one string it renders is the metric's name, into the label the answer region
 * already has for it, so the page shows the metric this module defines rather
 * than a second copy of its title authored in markup.
 *
 * Runs on the paint path, so it tolerates every region being absent and never
 * throws.
 *
 * @returns {{applied: string[], missing: string[], state: string}}
 */
export function applyFinopsSpine(doc, { imported = false, spine = FINOPS_SPINE } = {}) {
  const applied = [];
  const missing = [];
  const state = spineStateFor({ imported }, spine);
  const order = evidenceOrder(spine);

  for (const [id, role] of Object.entries(spine?.regions ?? {})) {
    if (role === REGION_CLASS.removed) continue;
    const region = doc?.getElementById?.(id) ?? null;
    if (!region) {
      missing.push(id);
      continue;
    }
    region.setAttribute(SPINE_CLASS_ATTRIBUTE, role);
    const rank = order.indexOf(id);
    if (rank >= 0) region.setAttribute(SPINE_EVIDENCE_RANK_ATTRIBUTE, String(rank + 1));
    applied.push(id);
  }

  const answer = doc?.getElementById?.(answerRegionId(spine)) ?? null;
  if (answer) {
    answer.setAttribute(SPINE_STATE_ATTRIBUTE, state.id);
    const heading = doc?.getElementById?.(spine?.answerRegion?.headingId) ?? null;
    if (heading && (heading.children?.length ?? 0) === 0) heading.textContent = spine.question;
  }

  const metricLabel = doc?.getElementById?.("finops-stand-metric-label") ?? null;
  if (metricLabel) metricLabel.textContent = spine.metric.name;

  return { applied, missing, state: state.id };
}
