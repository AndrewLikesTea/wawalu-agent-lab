// The answer spine: what each region of the AI FinOps page is FOR, declared
// once, in reading order, and checkable against the shipped document.
//
// THE PROBLEM THIS SOLVES. A first-time FinOps lead opens /evolution.html and
// meets thirty-two top-level regions. Several of them are titled like an
// answer, several are evidence for an answer given somewhere above, a rail and
// a status line are neither, and at least one is a leftover that a newer region
// already replaced. Nothing in the repository said which was which. So every
// change to the page re-litigated the same argument — "is this a headline or is
// this support?" — from scratch, and the reader paid for the ambiguity by
// having to read all thirty-two to find the one that answers their question.
//
// This module states the classification once. It is a manifest, a validator,
// and a very small painter. It computes no figure, reads no dataset, and owns
// no copy that a reader sees in the ordinary case: the FinOps computation
// modules keep every number they already own.
//
// ---------------------------------------------------------------------------
// THE FOUR ROLES
// ---------------------------------------------------------------------------
//
//   headline          The single region that answers the page's opening
//                     question on its own, above everything. There is exactly
//                     one, it is `finops-stand`, and a second one fails the
//                     build. This is the rule the page kept breaking: a second
//                     region that reads like "the" answer is the defect, not a
//                     styling preference.
//
//   step-of-spine     A region that carries the next question in the top-level
//                     reading order. Steps are numbered in declaration order,
//                     the headline included, so "where does this sit in the
//                     answer?" has a number rather than an opinion.
//
//   disclosure-detail A region a reader reaches FROM a step: supporting
//                     evidence, a control, wayfinding, or status. It introduces
//                     no new question into the reading order. A region whose
//                     answer lives on another page is a detail here, not a
//                     step — the handoff is support for the step above it.
//
//   retired           A region that no longer earns its place, kept only until
//                     a deletion pass removes it. Every retired entry names the
//                     live region that superseded it in `supersededBy`, and the
//                     validator refuses a pointer that does not resolve to a
//                     region still on the page. That is what makes the deletion
//                     mechanical: the person doing it never has to decide where
//                     the question went.
//
// Declaring a region retired is a product judgement, not an observation that
// nothing paints it. Exactly one region is retired today
// (`finops-first-run-conversion`, whose ask is `finops-contact`'s ask), and the
// role exists so the next one is declared here rather than argued about in a
// review thread.
//
// ---------------------------------------------------------------------------
// WHAT A REGION IS ENTITLED TO ASSERT
// ---------------------------------------------------------------------------
//
// Every region in the reading order carries an `entitledToAssert` line: the
// claim it may make and the basis it may make it on. This is the field that
// stops a demo surface from growing a measured-sounding claim it cannot
// support. Two rules are enforced mechanically:
//
//   * `MEASURED_BENCHMARK_LANGUAGE` — wording that asserts a measured
//     population ("industry average", "benchmarked against", …) may not appear
//     anywhere in this manifest. This page ships invented data.
//
//   * `SYNTHETIC_COHORT_BASIS` — any entry that mentions a peer, a cohort, or a
//     percentile must carry, verbatim, the sentence saying that peer cohort
//     boundaries are hand-authored synthetic fixtures. The peer position is the
//     single most borrowable-sounding figure on the page; the disclosure
//     travels with the claim in the manifest, not only in the markup.
//
// ---------------------------------------------------------------------------
// LIVE COLLECTIONS
// ---------------------------------------------------------------------------
//
// This module runs first in `init()`, so anything it throws takes the whole
// page down with it. `Element.children` is a live `HTMLCollection` in a real
// browser: iterable, indexable, and with none of `Array.prototype` on it. The
// test harness in tests/support/browser.js hands out a plain Array there, so a
// green suite is not evidence that this file is browser-safe.
//
// The rule in here, and in anything this file reaches: never call an array
// method on `children`, `childNodes`, `querySelectorAll`, `classList`,
// `attributes`, or a `NamedNodeMap`. Read `.length`, or normalize with
// `[...collection]` first — spreading is safe because the collection is
// iterable. `tests/finops-answer-spine.test.js` drives this module against a
// heading whose `children` is a genuine browser-shaped collection, so the
// assertion fails rather than the deployment.

import { STAND_IDS, STAND_QUESTION } from "../finops-stand.js";

/** Bump when a role changes meaning or the manifest's contract changes. */
export const ANSWER_SPINE_VERSION = "finops-answer-spine/1.0.0";

/** The four roles a top-level region may play. */
export const ROLE = Object.freeze({
  headline: "headline",
  step: "step-of-spine",
  detail: "disclosure-detail",
  retired: "retired",
});

/** The one region allowed to carry the headline role. */
export const HEADLINE_REGION_ID = STAND_IDS.region;

/** The element whose element children are the page's top-level regions. */
export const MAIN_REGION_ID = "main-content";

/** Attributes this module writes. All inert: no other module reads them. */
export const ROLE_ATTRIBUTE = "data-answer-role";
export const STEP_ATTRIBUTE = "data-answer-step";
export const SUPERSEDED_BY_ATTRIBUTE = "data-answer-superseded-by";

/**
 * The sentence that must travel with any peer, cohort, or percentile claim.
 *
 * Verbatim, because a paraphrase is how "hand-authored" becomes "modelled"
 * becomes "measured" over three changes that each looked harmless.
 */
export const SYNTHETIC_COHORT_BASIS =
  "Peer cohort boundaries are hand-authored synthetic fixtures, not a measured population.";

/** Words that would claim a measured population. None may appear below. */
export const MEASURED_BENCHMARK_LANGUAGE = Object.freeze([
  "industry average",
  "industry benchmark",
  "industry standard",
  "market average",
  "peer average",
  "peer benchmark",
  "benchmarked against",
  "measured against",
  "real organizations",
  "real companies",
  "actual organizations",
  "survey of",
]);

/** Terms that make an entry a peer claim and so require the basis sentence. */
const PEER_CLAIM_TERMS = Object.freeze(["peer", "cohort", "percentile"]);

/**
 * Every top-level region of /evolution.html, in document order.
 *
 * Declaration order is the reading order, and the validator checks it against
 * the shipped page: a region added, removed, or moved in the markup without a
 * matching change here fails the build. That is deliberate. The cost of keeping
 * this list current is one entry; the cost of not having it is the argument
 * this module exists to end.
 *
 *   id                 The region's element id. Four ids were added to
 *                      previously unidentified sections to make this list
 *                      complete: finops-hero, local-import, finops-proof-point,
 *                      finops-privacy. Nothing was renamed.
 *   role               One of ROLE.
 *   question           The question a leader is asking when they reach here —
 *                      their words, not the widget's title. Where the region's
 *                      heading is already that question, the two match.
 *   headingId          The element that names the region, or null.
 *   entitledToAssert   Required for the headline and every step: the claim this
 *                      region may make, and on what basis.
 *   supersededBy       Retired entries only: the live region that took over.
 */
export const ANSWER_SPINE = Object.freeze([
  {
    id: "finops-hero",
    role: ROLE.step,
    question: "What can this page tell me, and what does it need from me?",
    headingId: "page-title",
    entitledToAssert:
      "What the page will name once it has read something, and the one input it "
      + "needs. It carries no figure, so it cannot compete with the headline below it.",
  },
  {
    id: HEADLINE_REGION_ID,
    role: ROLE.headline,
    question: STAND_QUESTION,
    headingId: STAND_IDS.question,
    entitledToAssert:
      "A peer position on analyzed AI spend with its quartile boundaries, the "
      + "recoverable figure beside it, one named lagging department, and one "
      + "ranked action — every one of them from the bundled synthetic example "
      + `unless the reader's own import replaced it. ${SYNTHETIC_COHORT_BASIS}`,
  },
  {
    id: "finops-first-run",
    role: ROLE.step,
    question: "Are we wasting money?",
    headingId: "finops-first-run-title",
    entitledToAssert:
      "The canonical complete decision summary of src/finops-decision-contract.js: "
      + "one benchmark, one prioritized action, one estimated impact, one bounded "
      + "confidence score with its basis. Estimated, never invoiced.",
  },
  {
    id: "finops-next-step",
    role: ROLE.step,
    question: "Where do I start this month?",
    headingId: "finops-next-step-question",
    entitledToAssert:
      "The single highest-ranked action out of what this browser is already "
      + "holding, and the confidence it was ranked at. A list is not an answer here.",
  },
  {
    id: "finops-journey",
    role: ROLE.step,
    question: "What do I do next, and what will tell me it worked?",
    headingId: "finops-journey-question",
    entitledToAssert:
      "The phase this browser's own records put the reader in, and the check that "
      + "would close it. No claim about anyone else's progress.",
  },
  {
    id: "finops-destinations",
    role: ROLE.step,
    question: "Where do I go next to act on this?",
    headingId: "finops-destinations-title",
    entitledToAssert:
      "One prioritized destination and the reason it ranked first, from the "
      + "bundled destination contract. It promises a place to go, not an outcome.",
  },
  {
    id: "finops-workspace-nav",
    role: ROLE.detail,
    question: "Which part of this workspace am I in, and how do I get to another?",
    headingId: "finops-workspace-nav-title",
  },
  {
    id: "finops-workspace-switch",
    role: ROLE.detail,
    question: "Which working area is on screen?",
    headingId: "finops-workspace-switch-title",
  },
  {
    id: "finops-workspace-context",
    role: ROLE.detail,
    question: "What did I carry here from the answer?",
    headingId: "finops-workspace-context-title",
  },
  {
    id: "finops-first-run-conversion",
    role: ROLE.retired,
    question: "Can someone help me with my own analysis?",
    headingId: "finops-first-run-conversion-title",
    supersededBy: "finops-contact",
    entitledToAssert:
      "Nothing this page does not already ask below. It is the same follow-up "
      + "request as #finops-contact, split off from the form and the privacy line "
      + "that make the ask answerable, so a reader meets the conversion twice and "
      + "the second copy is the complete one.",
  },
  {
    id: "finops-load-state",
    role: ROLE.detail,
    question: "Is the page still reading something?",
    headingId: "finops-load-label",
  },
  {
    id: "score-card",
    role: ROLE.detail,
    question: "What letter did the example data earn?",
    headingId: "score-card-title",
  },
  {
    id: "finops-portfolio-brief",
    role: ROLE.step,
    question: "Across the providers we combined, where is the money going?",
    headingId: "finops-portfolio-brief-question",
    entitledToAssert:
      "A split of the reader's own combined provider exports, and only once the "
      + "comparability verdict allowed those exports to be combined at all.",
  },
  {
    id: "guided-result",
    role: ROLE.step,
    question: "What should we do now?",
    headingId: "guided-result-question",
    entitledToAssert:
      "The recommendation derived from the reader's own import, with the evidence "
      + "that produced it. Withheld, with the missing input named, when it cannot be derived.",
  },
  {
    id: "local-import",
    role: ROLE.step,
    question: "Can I run this on my own numbers without uploading them?",
    headingId: "local-import-title",
    entitledToAssert:
      "That the analysis runs in this browser and that no file leaves it. The "
      + "claim is about where the work happens, not about what the result will say.",
  },
  {
    id: "prompt-coaching",
    role: ROLE.detail,
    question: "Would a model answer one of our prompts well?",
    headingId: "coach-handoff-title",
  },
  {
    id: "finops-contact",
    role: ROLE.detail,
    question: "Who do I ask about this result?",
    headingId: "finops-contact-title",
  },
  {
    id: "finops-proof-point",
    role: ROLE.detail,
    question: "What does one of these actions actually look like?",
    headingId: "proof-point-title",
  },
  {
    id: "finops-headline",
    role: ROLE.detail,
    question: "Is this grade mine, or the example's?",
    headingId: "finops-headline-question",
  },
  {
    id: "disclosure-grade-comparisons",
    role: ROLE.detail,
    question: "How does this grade compare — against a cohort, and against the team that needs coaching?",
    headingId: null,
    entitledToAssert:
      `A comparison against the bundled peer set and nothing wider. ${SYNTHETIC_COHORT_BASIS}`,
  },
  {
    id: "graded-sample",
    role: ROLE.detail,
    question: "Which of my prompts produced this grade?",
    headingId: "graded-sample-title",
  },
  {
    id: "org-coaching",
    role: ROLE.detail,
    question: "Which department needs coaching now?",
    headingId: "org-coaching-title",
  },
  {
    id: "spend-per-delivery",
    role: ROLE.detail,
    question: "Is AI spend keeping pace with shipped delivery?",
    headingId: "spend-per-delivery-title",
  },
  {
    id: "department-evidence",
    role: ROLE.detail,
    question: "What is the evidence behind this department's grade?",
    headingId: "department-evidence-title",
  },
  {
    id: "department-fix-pack",
    role: ROLE.detail,
    question: "What should this department do first?",
    headingId: "department-fix-pack-title",
  },
  {
    id: "monthly-department-decision",
    role: ROLE.detail,
    question: "Which department action should I take this month?",
    headingId: "monthly-department-decision-title",
  },
  {
    id: "disclosure-spend-and-recovery",
    role: ROLE.detail,
    question: "What did we spend this period, and how much of it is recoverable?",
    headingId: null,
  },
  {
    id: "disclosure-department-priority",
    role: ROLE.detail,
    question: "Which department needs help first, and how is it trending?",
    headingId: null,
  },
  {
    id: "disclosure-spend-mix",
    role: ROLE.detail,
    question: "Where does the money go — what was the spend actually asked to do?",
    headingId: null,
  },
  {
    id: "disclosure-savings-portfolio",
    role: ROLE.detail,
    question: "Are projected savings turning into verified savings?",
    headingId: null,
  },
  {
    id: "disclosure-recommendation-evidence",
    role: ROLE.detail,
    question: "How did a recommendation earn the score it was given?",
    headingId: null,
  },
  {
    id: "finops-privacy",
    role: ROLE.detail,
    question: "What does this page read, and what does it never read?",
    headingId: "privacy-title",
  },
]);

/** True for the roles that occupy a numbered place in the reading order. */
function inReadingOrder(role) {
  return role === ROLE.headline || role === ROLE.step;
}

/** Every string an entry carries, for the wording guards. */
function entryText(entry) {
  return [entry?.question, entry?.entitledToAssert].filter(Boolean).join(" ");
}

/**
 * The ids of the page's top-level regions, in document order.
 *
 * Only element children with an id: a region with no id cannot be linked to,
 * cannot be classified, and is not something this manifest can hold an opinion
 * about. `[...]` rather than a direct array method, because `main.children` is
 * a live `HTMLCollection` in a browser — see the note at the top of this file.
 */
export function renderedRegionIds(doc, mainId = MAIN_REGION_ID) {
  const main = doc?.getElementById?.(mainId) ?? null;
  if (!main) return [];
  return [...(main.children ?? [])]
    .filter((node) => node?.nodeType === 1 && node.id)
    .map((node) => node.id);
}

/**
 * Check the manifest, and optionally check it against the shipped page.
 *
 * Returns the FULL list of problems as plain sentences, never throws, and never
 * stops at the first one. A build that fails on violation number one sends
 * whoever fixes it back around the loop for number two; a caller that wants an
 * exception can throw on a non-empty list.
 *
 * @param {ReadonlyArray<object>} manifest
 * @param {{rendered?: ReadonlyArray<string>|null}} options
 *   `rendered` — the page's actual top-level region ids, from
 *   `renderedRegionIds`. Omit it to check the manifest on its own.
 * @returns {string[]} problems, in the order they were found
 */
export function validateAnswerSpine(manifest = ANSWER_SPINE, { rendered = null } = {}) {
  const problems = [];
  const entries = Array.isArray(manifest) ? manifest : [];
  if (entries.length === 0) problems.push("The answer spine is empty; every region must be declared.");

  const seen = new Set();
  const byId = new Map();
  const roles = new Set(Object.values(ROLE));

  for (const entry of entries) {
    const id = entry?.id;
    if (typeof id !== "string" || id === "") {
      problems.push("An entry has no region id.");
      continue;
    }
    if (seen.has(id)) problems.push(`Region "${id}" is declared more than once.`);
    seen.add(id);
    byId.set(id, entry);

    if (!roles.has(entry.role)) {
      problems.push(`Region "${id}" has role "${entry.role}", which is not one of: ${[...roles].join(", ")}.`);
    }
    if (typeof entry.question !== "string" || entry.question.trim() === "") {
      problems.push(`Region "${id}" declares no question. A region that answers nothing should be retired, not shipped.`);
    }
    if (inReadingOrder(entry.role)
      && (typeof entry.entitledToAssert !== "string" || entry.entitledToAssert.trim() === "")) {
      problems.push(`Region "${id}" is in the reading order but does not say what it is entitled to assert.`);
    }
    if (entry.role === ROLE.retired && !entry.supersededBy) {
      problems.push(`Region "${id}" is retired but names no region that superseded it, so its deletion is not mechanical.`);
    }
    if (entry.role !== ROLE.retired && entry.supersededBy) {
      problems.push(`Region "${id}" names a superseding region but is not retired.`);
    }

    const text = entryText(entry).toLowerCase();
    for (const phrase of MEASURED_BENCHMARK_LANGUAGE) {
      if (text.includes(phrase)) {
        problems.push(`Region "${id}" uses measured-benchmark wording ("${phrase}"). This page ships synthetic data.`);
      }
    }
    if (PEER_CLAIM_TERMS.some((term) => text.includes(term))
      && !String(entry.entitledToAssert ?? "").includes(SYNTHETIC_COHORT_BASIS)) {
      problems.push(`Region "${id}" makes a peer claim without the synthetic-cohort basis sentence, verbatim.`);
    }
  }

  const headlines = entries.filter((entry) => entry?.role === ROLE.headline).map((entry) => entry.id);
  if (headlines.length !== 1) {
    problems.push(`The page must declare exactly one headline region; it declares ${headlines.length}`
      + `${headlines.length ? ` (${headlines.join(", ")})` : ""}.`);
  } else if (headlines[0] !== HEADLINE_REGION_ID) {
    problems.push(`The headline must be "${HEADLINE_REGION_ID}", not "${headlines[0]}".`);
  }

  for (const entry of entries) {
    const target = entry?.supersededBy;
    if (!target) continue;
    const replacement = byId.get(target);
    if (!replacement) {
      problems.push(`Region "${entry.id}" points at "${target}", which is not a declared region.`);
    } else if (replacement.role === ROLE.retired) {
      problems.push(`Region "${entry.id}" points at "${target}", which is itself retired.`);
    } else if (Array.isArray(rendered) && !rendered.includes(target)) {
      problems.push(`Region "${entry.id}" points at "${target}", which is not on the page.`);
    }
  }

  if (Array.isArray(rendered)) {
    for (const id of rendered) {
      if (!seen.has(id)) {
        problems.push(`Region "${id}" is rendered on the page but is not declared here; every region needs a role.`);
      }
    }
    for (const id of seen) {
      if (!rendered.includes(id)) problems.push(`Region "${id}" is declared here but is not on the page.`);
    }
    const declaredAndRendered = [...seen].filter((id) => rendered.includes(id));
    const renderedAndDeclared = rendered.filter((id) => seen.has(id));
    if (declaredAndRendered.join(">") !== renderedAndDeclared.join(">")) {
      problems.push("The declaration order does not match the page's reading order.");
    }
  }

  return problems;
}

/**
 * Stamp every declared region with its role and its place in the reading order.
 *
 * Attributes only: this writes no copy a reader sees, moves nothing, and hides
 * nothing. What it buys is that the classification is legible in the shipped
 * DOM — a reviewer, a test, or a stylesheet can ask a region what it is for
 * instead of inferring it from where it happens to sit.
 *
 * The one exception is a heading that arrived empty. A listed region with an
 * unlabelled heading is a blank block in the reading order, and the manifest
 * already knows what that region answers, so the question goes in. A heading
 * that already has text, or that another module composed out of element markup,
 * is never touched.
 *
 * Safe to call on a document that is missing regions: the ids it cannot find
 * come back in `missing` and nothing throws. It runs before every paint, so
 * throwing here would cost the whole page.
 *
 * @returns {{applied: string[], missing: string[], headline: string|null, steps: number}}
 */
export function applyAnswerSpine(doc, manifest = ANSWER_SPINE) {
  const applied = [];
  const missing = [];
  let headline = null;
  let step = 0;

  for (const entry of Array.isArray(manifest) ? manifest : []) {
    const ordered = inReadingOrder(entry?.role);
    if (ordered) step += 1;

    const region = doc?.getElementById?.(entry?.id) ?? null;
    if (!region) {
      missing.push(entry?.id);
      continue;
    }

    region.setAttribute(ROLE_ATTRIBUTE, entry.role);
    if (ordered) region.setAttribute(STEP_ATTRIBUTE, String(step));
    else region.removeAttribute?.(STEP_ATTRIBUTE);
    if (entry.supersededBy) region.setAttribute(SUPERSEDED_BY_ATTRIBUTE, entry.supersededBy);
    if (entry.role === ROLE.headline) headline = entry.id;

    const heading = entry.headingId ? (doc?.getElementById?.(entry.headingId) ?? null) : null;
    // `heading.children` is a live HTMLCollection in a browser. Reading its
    // length is safe; calling an array method on it is the crash this file's
    // header is about. "Composed" means another module built this heading out
    // of element markup — spans, a state chip — and owns its contents.
    const composed = (heading?.children?.length ?? 0) > 0;
    if (heading && !composed && String(heading.textContent ?? "").trim() === "") {
      heading.textContent = entry.question;
    }

    applied.push(entry.id);
  }

  return { applied, missing, headline, steps: step };
}
