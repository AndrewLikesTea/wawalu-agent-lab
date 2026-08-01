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
//   retired           A region that no longer earns its place. Every retired
//                     entry names the live region that took its question in
//                     `supersededBy`, and the validator refuses a pointer that
//                     does not resolve to a region still on the page. That is
//                     what makes the deletion mechanical: the person doing it
//                     never has to decide where the question went.
//
// Declaring a region retired is a product judgement, not an observation that
// nothing paints it. Exactly one region is retired today
// (`finops-first-run-conversion`, whose ask is `finops-contact`'s ask), and the
// role exists so the next one is declared here rather than argued about in a
// review thread.
//
// ---------------------------------------------------------------------------
// RETIREMENT IS DELETION, AND THE MANIFEST IS WHAT ENFORCES IT
// ---------------------------------------------------------------------------
//
// A retired entry used to be held to the same rule as a live one — "declared
// here, therefore it must be on the page" — which meant flipping a role to
// `retired` changed precisely nothing. The role was a label on a region that
// went on shipping. It is now the opposite rule, and it is the one mechanism
// this file offers a deletion pass:
//
//   * a LIVE entry must be a top-level region of the shipped page;
//   * a RETIRED entry must NOT be. Hiding it with `hidden`, demoting its
//     heading, or moving it inside another region all still fail, because the
//     check is over `renderedRegionIds(doc)` — the document's actual top-level
//     children — and not over anything the markup asserts about itself.
//
// So `renderedRegionIds(doc)` equals `liveRegionIds(manifest)`, in order, and
// flipping one entry to `retired` turns the suite red until the markup, the
// code that paints it, and the rules that style it are gone. The retired entry
// stays here afterwards as a tombstone: it is the record of where the question
// went, and `supersededBy` keeps that record checkable.
//
// NOTED BACK TO NOOR — regions this manifest would retire that were kept.
// `finops-destinations` is a step, not a retirement, and it stays a step. Its
// ranked doors — three destinations, one per role, exactly one promoted with
// the named clause that promoted it — have no equivalent anywhere else on the
// page. `finops-workspace-nav` renders the same three doors but takes their
// order FROM this region's contract rather than producing one, so retiring the
// region would delete the ranking and leave a rail with nothing to rank by.
// A retirement whose behaviour is orphaned is a deletion of behaviour, and this
// file will not launder one as a move.
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
import { FINOPS_SPINE, REGION_CLASS, regionClass } from "../finops-spine.js";

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
  // THE ANSWER IS STEP ONE, AND IT IS FIRST IN THE DOCUMENT.
  // The hero held this place until #727. A leader who opens this page opens it
  // with a question, and met a full screen of what the page is for before the
  // page answered it — so the headline is now the first region of `main`, which
  // makes it the first thing announced, the first thing read, and the first
  // thing reached by Tab, all from one source order rather than from `order` or
  // a positive `tabindex`. The hero follows it as orientation.
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
    id: "finops-hero",
    role: ROLE.step,
    question: "What can this page tell me, and what does it need from me?",
    headingId: "page-title",
    entitledToAssert:
      "What the page will name once it has read something, and the one input it "
      + "needs. It carries no figure, so it cannot compete with the headline above it.",
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
    // ONE STEP, NOT TWO (#832). #742 folded each "this month" section into the
    // page's `support-disclosure` idiom, so the element `main` held at this
    // level was the wrapper — but there were two wrappers asking two questions
    // a stranger reads as one, between the answer and the way out of it. They
    // are one group now. Both sections are inside it, unchanged: same ids, same
    // headings, same views. What the manifest lost is a second entry in the
    // reading order, which is exactly what a reader lost from the page.
    //
    // `headingId` is null for the same reason it is on
    // `disclosure-grade-comparisons`: the element `main` holds is a `details`,
    // and the question is on its `summary`, which is not a heading. The two
    // headings inside it name the two sections, not the group.
    id: "disclosure-this-month",
    role: ROLE.step,
    question: "If I only do one thing this month, is it the right one — and what will tell me it worked?",
    headingId: null,
    entitledToAssert:
      "The single highest-ranked action out of what this browser is already "
      + "holding and the confidence it was ranked at, then the phase those same "
      + "records put the reader in and the check that would close it. A list is "
      + "not an answer here, and no claim about anyone else's progress.",
  },
  {
    // Not folded into a disclosure with the two layers above it: the rank-1
    // door has to stay in the tab order without a reader opening anything.
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
  // One per destination whose module is fetched on demand (#821). Each is on
  // screen only while that module is in flight or after it failed, and each
  // answers for its own destination — a shared region would make "which one
  // failed?" a question the reader had to work out.
  {
    id: "destination-load-evidence",
    role: ROLE.detail,
    question: "Is the Evidence destination still opening?",
    headingId: "destination-load-evidence-title",
  },
  {
    id: "destination-load-department",
    role: ROLE.detail,
    question: "Is the Departments destination still opening?",
    headingId: "destination-load-department-title",
  },
  {
    id: "destination-load-act-and-verify",
    role: ROLE.detail,
    question: "Is the Act and verify destination still opening?",
    headingId: "destination-load-act-and-verify-title",
  },
  {
    id: "finops-workspace-context",
    role: ROLE.detail,
    question: "What did I carry here from the answer?",
    headingId: "finops-workspace-context-title",
  },
  // The two wrappers #832 consolidated, kept as the record of where their
  // questions went. Neither question was dropped: both sections are inside
  // `disclosure-this-month`, and the group's summary asks the one question the
  // two were circling. What was retired is the wrapper and the second ask.
  {
    id: "disclosure-next-step",
    role: ROLE.retired,
    question: "Where do I start this month?",
    headingId: "finops-next-step-question",
    supersededBy: "disclosure-this-month",
    entitledToAssert:
      "The single highest-ranked action out of what this browser is already "
      + "holding, and the confidence it was ranked at. Still asserted, by "
      + "#finops-next-step, which is now the first layer inside the group.",
  },
  {
    id: "disclosure-journey",
    role: ROLE.retired,
    question: "What do I do next, and what will tell me it worked?",
    headingId: "finops-journey-question",
    supersededBy: "disclosure-this-month",
    entitledToAssert:
      "The phase this browser's own records put the reader in, and the check "
      + "that would close it. Still asserted, by #finops-journey, which is now "
      + "the second layer inside the same group.",
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
    id: "classifier-agreement",
    role: ROLE.detail,
    question: "How often does the classifier agree with a human reviewer?",
    headingId: "classifier-agreement-title",
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

/** Entries with an id and a role, in declaration order. Bad rows are the validator's. */
const usableEntries = (manifest) => (Array.isArray(manifest) ? manifest : [])
  .filter((entry) => typeof entry?.id === "string" && entry.id !== "");

/**
 * The regions that must be on the page, in reading order.
 *
 * This is the set `renderedRegionIds` is held to. It is DERIVED from the roles
 * above rather than hand-authored beside them: a second list of "the regions
 * that ship" is a second thing to keep true, and the first thing to go stale.
 */
export function liveRegionIds(manifest = ANSWER_SPINE) {
  return usableEntries(manifest).filter((entry) => entry.role !== ROLE.retired).map((entry) => entry.id);
}

/** The regions that must NOT be on the page. Absent is the passing state. */
export function retiredRegionIds(manifest = ANSWER_SPINE) {
  return usableEntries(manifest).filter((entry) => entry.role === ROLE.retired).map((entry) => entry.id);
}

/**
 * A question reduced to what it asks, so two spellings of one question compare
 * equal. Case, punctuation, and run-together whitespace are not the difference
 * between two questions; nothing else is folded, because "where do I start" and
 * "where do I go" are genuinely two.
 */
export function normalizeQuestion(text) {
  return String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

/**
 * Containers a region's own naming heading is never inside. A heading in a
 * disclosure labels the disclosure, and a heading in a nested landmark labels
 * that landmark; neither is the question the top-level region asks.
 */
const OPAQUE_TAGS = new Set(["DETAILS", "SUMMARY", "SECTION", "NAV", "ASIDE", "ARTICLE"]);

/** Hidden to everyone, or hidden to sighted readers. Either way, not visible copy. */
function invisible(node) {
  if (node?.hasAttribute?.("hidden")) return true;
  const classes = String(node?.getAttribute?.("class") ?? "").split(/\s+/);
  return classes.includes("visually-hidden");
}

/** The first visible heading a region owns, not counting anything it delegates. */
function ownHeading(node) {
  for (const child of [...(node?.children ?? [])]) {
    if (child?.nodeType !== 1 || invisible(child)) continue;
    if (HEADING_TAGS.has(child.tagName)) return child;
    if (OPAQUE_TAGS.has(child.tagName)) continue;
    const nested = ownHeading(child);
    if (nested) return nested;
  }
  return null;
}

/**
 * The heading that names a region, or null when it is named by something that
 * is not a heading — an eyebrow paragraph, an `aria-label`. A region with no
 * heading asks no question in the reading order, so it cannot collide with one.
 */
export function namingHeading(region, doc) {
  const labelled = String(region?.getAttribute?.("aria-labelledby") ?? "").trim().split(/\s+/)[0];
  if (labelled) {
    const node = doc?.getElementById?.(labelled) ?? null;
    if (node && HEADING_TAGS.has(node.tagName) && !invisible(node)) return node;
  }
  return ownHeading(region);
}

/** Enough of an element to find it in the markup when the audit names it. */
function describe(region) {
  if (region?.id) return `"${region.id}"`;
  const classes = String(region?.getAttribute?.("class") ?? "").trim();
  return `<${String(region?.tagName ?? "element").toLowerCase()}${classes ? ` class="${classes}"` : ""}>`;
}

/** Every `h1` under a node, counted by walking rather than by selector. */
function countH1(node) {
  let total = 0;
  for (const child of [...(node?.children ?? [])]) {
    if (child?.nodeType !== 1) continue;
    if (child.tagName === "H1") total += 1;
    total += countH1(child);
  }
  return total;
}

/**
 * Audit the page a reader actually gets.
 *
 * `validateAnswerSpine` checks a LIST of ids against the manifest, which is
 * exactly as good as the list it was handed. This walks the document instead:
 * every element child of `#main-content`, whether or not it has an id, whether
 * or not anything declared it. That is the difference that matters — a section
 * nobody declared is invisible to a check that iterates the declarations, and
 * an undeclared section carrying an answer-shaped heading is the specific way
 * this page grew a second headline three times.
 *
 * It reports:
 *   * a top-level region the manifest gives no role to, id or no id;
 *   * a region the manifest retired that is still in the document;
 *   * two visible region headings asking the same question;
 *   * an `h1` count other than one.
 *
 * Returns problems as sentences and never throws.
 */
export function auditPageStructure(doc, manifest = ANSWER_SPINE, mainId = MAIN_REGION_ID) {
  const main = doc?.getElementById?.(mainId) ?? null;
  if (!main) return [`There is no "#${mainId}", so the page has no top-level regions to audit.`];

  const problems = [];
  const declared = new Map(usableEntries(manifest).map((entry) => [entry.id, entry]));
  const askedBy = new Map();

  for (const region of [...(main.children ?? [])]) {
    if (region?.nodeType !== 1) continue;
    const entry = region.id ? declared.get(region.id) : null;
    if (!entry) {
      problems.push(`A top-level region ${describe(region)} is on the page but the answer spine `
        + "gives it no role. Every region a reader meets is declared, or it is not shipped.");
    } else if (entry.role === ROLE.retired) {
      problems.push(`Region "${region.id}" is declared retired but is still on the page. `
        + "Retirement here is deletion: the markup, the code that paints it, and the rules that "
        + "style it all go.");
    }

    const heading = namingHeading(region, doc);
    const asked = String(heading?.textContent ?? "").trim();
    const key = normalizeQuestion(asked);
    if (!key) continue;
    const owner = askedBy.get(key);
    if (owner) {
      problems.push(`Two visible headings ask the same question ("${asked}"): ${owner} and `
        + `${describe(region)}. A reader cannot tell which one is the answer.`);
    } else {
      askedBy.set(key, describe(region));
    }
  }

  const h1s = countH1(main);
  if (h1s !== 1) problems.push(`The page's main content carries ${h1s} h1 elements; it must carry exactly one.`);

  return problems;
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
 * @param {{rendered?: ReadonlyArray<string>|null, spine?: object}} options
 *   `rendered` — the page's actual top-level region ids, from
 *   `renderedRegionIds`. Omit it to check the manifest on its own.
 *   `spine` — the answer spine this census must agree with.
 * @returns {string[]} problems, in the order they were found
 */
export function validateAnswerSpine(manifest = ANSWER_SPINE,
  { rendered = null, spine = FINOPS_SPINE } = {}) {
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

    // THE CENSUS AND THE SPINE ARE ONE DECISION IN TWO FILES. This file says
    // what each region is for; src/finops-spine.js says which of them is the
    // answer, which are evidence beneath it, and which are gone. Neither
    // imports the other's list, so this is where they are held to each other:
    // a role added here with no classification there is a region nobody
    // decided about.
    const expectedClass = entry.role === ROLE.retired
      ? REGION_CLASS.removed
      : (entry.role === ROLE.headline ? REGION_CLASS.answer : REGION_CLASS.evidence);
    const classified = regionClass(id, spine);
    if (!classified) {
      problems.push(`Region "${id}" is declared here but the answer spine classifies it as `
        + "nothing. Every region is answer, evidence, or removed.");
    } else if (classified !== expectedClass) {
      problems.push(`Region "${id}" has role "${entry.role}" here but is classified `
        + `"${classified}" by the answer spine; it should be "${expectedClass}".`);
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

  // Two regions that ask one question are the defect this manifest exists to
  // catch, and the manifest is where it is cheapest to catch: a duplicate here
  // fails before the second heading is ever authored.
  const askedBy = new Map();
  for (const entry of entries) {
    if (typeof entry?.id !== "string" || entry.id === "" || entry.role === ROLE.retired) continue;
    const key = normalizeQuestion(entry.question);
    if (!key) continue;
    const owner = askedBy.get(key);
    if (owner) {
      problems.push(`Regions "${owner}" and "${entry.id}" ask the same question `
        + `("${entry.question}"). One question, one region.`);
    } else {
      askedBy.set(key, entry.id);
    }
  }

  if (Array.isArray(rendered)) {
    // The live set, not the declared set: a retired entry stays declared as the
    // record of where its question went, and must be gone from the document.
    const live = new Set(liveRegionIds(entries));
    for (const id of rendered) {
      if (!seen.has(id)) {
        problems.push(`Region "${id}" is rendered on the page but is not declared here; every region needs a role.`);
      } else if (!live.has(id)) {
        problems.push(`Region "${id}" is declared retired but is still on the page. Retirement here is `
          + "deletion: remove the markup, the code that paints it, and the rules that style it.");
      }
    }
    for (const id of live) {
      if (!rendered.includes(id)) problems.push(`Region "${id}" is declared here but is not on the page.`);
    }
    const declaredAndRendered = [...live].filter((id) => rendered.includes(id));
    const renderedAndDeclared = rendered.filter((id) => live.has(id));
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
    // A retired entry is a tombstone, not an instruction to paint anything. It
    // is skipped rather than reported missing: its absence is the requirement,
    // and `validateAnswerSpine` is what fails when it is still there.
    if (entry?.role === ROLE.retired) continue;
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
