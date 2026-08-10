// Which destination every top-level region of /evolution.html belongs to.
//
// WHAT THIS FIXES. `finops-workspace-shell.js` shows one destination at a time
// and hides the rest, and it decides membership by reading one attribute off
// each region: `data-workspace-region`. That works, and it has one failure mode
// nothing catches — a region shipped WITHOUT the attribute is not hidden by
// anything, so it appears on all five destinations at once. The shell has no
// way to tell "this region belongs everywhere" from "somebody forgot", because
// both look like an absent attribute. That is exactly how a page that spent a
// year being cut back to one question per screen drifts back to a dozen
// equal-weight regions: not in one commit, but one unmarked region at a time.
//
// So the assignment is DECLARED here, in one list, and the shell reads it. A
// region named below is owned by the destination that names it whatever the
// markup says; a region the markup marks and this file does not name is still
// owned by its attribute, so nothing that works today stops working. And the
// coverage test in tests/finops-workspace-shell.test.js asserts the two agree
// in both directions: no top-level region unassigned, none assigned twice, and
// no id declared here that the document does not have.
//
// THE SLUGS AND THE QUESTIONS ARE NOT MINE. They are `SCREEN_CONTRACT`'s, read
// below rather than restated: a second file spelling out what each destination
// asks would be a second source of truth for a published product decision, and
// the shell would then have two lists to disagree about. What is new here is
// the one thing the contract has no opinion about — which regions of the
// document each destination is made of.
//
// DATA ONLY. No DOM, no storage, no network, no clock. It is imported by the
// shell and by the test, and both need it to be the same list.

import { SCREEN_CONTRACT } from "./finops-screen-contract.js";
// The department identifiers the bundled analysis actually holds, pinned against
// src/evolution-demo-data.json by tests/finops-destinations.test.js. Read rather
// than restated: a second list of the same seven ids is a second thing to get
// wrong, and an address that selects a department the seed does not contain is a
// link to an empty drill-down.
import { FINOPS_DEPARTMENT_IDS } from "./finops-destinations.js";

/**
 * The regions that belong to no destination because they carry the page.
 *
 * The hero, the answer, the brief, the readiness loop, the front door, the
 * rail, the shell's own control, the workspace context and the load status are
 * the workspace FRAME: they hold the page heading, the answer itself and the
 * way between destinations, so a destination change may not take them off
 * screen. The markup says the same thing with `data-workspace-frame`; this is
 * the list a check compares that markup against.
 */
export const FRAME_REGION_IDS = Object.freeze([
  "finops-hero",
  "finops-recoverable-answer",
  "finops-stand",
  "finops-first-run",
  "finops-readiness-loop",
  "finops-front-door",
  "finops-workspace-nav",
  "finops-workspace-switch",
  "finops-workspace-context",
  "finops-load-state",
]);

/**
 * The region ids each destination owns, in document order, keyed by the shell
 * destination slug.
 *
 * Ordered by the document rather than by importance on purpose: this list is
 * checked against `evolution.html` region by region, and a reader reconciling a
 * failure reads the two in the same direction.
 */
const REGION_IDS = Object.freeze({
  // How much can we recover, and what do we do first. The doors, the guided
  // choice, the portfolio brief, the guided result and the import that starts
  // all of it: everything a reader needs before they have decided to dig.
  answer: Object.freeze([
    "finops-destinations",
    "finops-guided-choice",
    "finops-portfolio-brief",
    "guided-result",
    "local-import",
  ]),
  // What was this computed from. Every panel whose job is to make the headline
  // checkable — the score card, the classifier agreement, the graded sample,
  // the spend-and-recovery working, the privacy boundary the figures were
  // computed inside — and none whose job is to recommend anything.
  evidence: Object.freeze([
    "destination-load-evidence",
    "finops-guided-evidence",
    "score-card",
    "finops-proof-point",
    "finops-evidence-working",
    "finops-headline",
    "classifier-agreement",
    "disclosure-grade-comparisons",
    "graded-sample",
    "org-coaching",
    "spend-per-delivery",
    "disclosure-spend-and-recovery",
    "disclosure-recommendation-evidence",
    "finops-privacy",
  ]),
  // Where the problem is concentrated. Per-team and per-workload breakdowns,
  // including the monthly department decision, which is a department reading
  // taken monthly rather than a monthly review scoped to departments.
  department: Object.freeze([
    "destination-load-department",
    "finops-guided-department",
    "department-evidence",
    "department-fix-pack",
    "monthly-department-decision",
    "disclosure-department-priority",
    "disclosure-spend-mix",
  ]),
  // What I do next and how I will know it worked. The plan, the routing rules
  // proposed and then scored against what they returned, the savings portfolio,
  // and the two hand-offs a lead acts through.
  "act-and-verify": Object.freeze([
    "destination-load-act-and-verify",
    "prompt-coaching",
    "finops-contact",
    "plan-scope",
    "routing-slate",
    "routing-rule-score",
    "disclosure-savings-portfolio",
  ]),
  // What changed against the retained month. One region, because that is the
  // whole destination: it is the retained-period comparison and nothing else.
  "monthly-review": Object.freeze(["monthly-review-projection"]),
});

/**
 * Which destinations are addressable at a SUB-SELECTION, and which values each
 * one accepts (#1522).
 *
 * One entry, because one destination is read that way: the department screen IS
 * the per-department breakdown, and the other four answer a question about the
 * whole org. An absent entry is a deliberate statement — "this destination is
 * not read per anything" — and not an omission, which is the same discipline the
 * `route` declarations in src/finops-destinations.js already keep.
 *
 * It lives here rather than in the router for the reason the region lists do:
 * a router with its own copy of the valid ids would be a second authority for
 * what this page can be addressed at, and the two would disagree the first time
 * a department was added.
 */
const SELECTION_IDS = Object.freeze({
  department: FINOPS_DEPARTMENT_IDS,
});

/**
 * The destinations in reading order, each with the one question it answers, the
 * text its door carries, and the regions it is made of.
 *
 * `slug` is `shellDestination` — the key already on readers' address bars and in
 * the markup — not the contract's own `key`, which says "departments" where the
 * fragment says "department". Joining on the wrong one of those two would move
 * a fragment people have saved.
 */
export const DESTINATION_REGIONS = Object.freeze(SCREEN_CONTRACT.map((screen) => Object.freeze({
  slug: screen.shellDestination,
  question: screen.question,
  label: screen.name,
  regionIds: REGION_IDS[screen.shellDestination] ?? Object.freeze([]),
  selectionIds: SELECTION_IDS[screen.shellDestination] ?? Object.freeze([]),
})));

/** One destination's declaration, or null. Never throws on an unknown slug. */
export function destinationRegions(slug) {
  return DESTINATION_REGIONS.find((entry) => entry.slug === slug) ?? null;
}

/**
 * The selection ids one destination accepts, in ranking order. Empty for a slug
 * this map does not hold and for one that is not read per department, which a
 * caller reads the same way: no address may carry a selection here.
 */
export function destinationSelections(slug) {
  return destinationRegions(slug)?.selectionIds ?? Object.freeze([]);
}

/**
 * The destination that declares a region id, or null when none does.
 *
 * Null is the answer for a frame region and for a region this file has not been
 * told about yet, and the shell reads both the same way: fall back to what the
 * markup says. A declaration is an override, never a gate.
 */
export function destinationForRegion(id) {
  const wanted = String(id ?? "");
  if (wanted === "") return null;
  const owner = DESTINATION_REGIONS.find((entry) => entry.regionIds.includes(wanted));
  return owner?.slug ?? null;
}

/** Every declared region id, across all destinations, in destination order. */
export const DECLARED_REGION_IDS = Object.freeze(
  DESTINATION_REGIONS.flatMap((entry) => [...entry.regionIds]),
);
