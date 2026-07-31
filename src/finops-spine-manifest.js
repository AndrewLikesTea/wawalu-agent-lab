// Which region of the AI FinOps page is the headline, and what a claim in it
// may assert.
//
// WHY THIS EXISTS. Four issues in a row have re-decided what the headline of
// this page is allowed to say (#717 made "where do we stand?" the headline,
// #718 gave it its keyboard and screen-reader shape, #721 put a reproducibility
// gate in front of its ranking claim, #729 rewrote its wording). That decision
// was distributed across a composer, a view, and a page script, so a new
// candidate for the headline had nowhere to be checked against it.
//
// This module is that one place. It is a MANIFEST, not a computation: it names
// the headline region, the claim kinds that region may assert, the unit each
// kind must state its impact in, the directions that unit admits, and the
// threshold above which a kind is material. It reads nothing, computes nothing,
// and holds no figures. `finops-finding-resolver.js` consumes it; nothing here
// consumes anything.
//
// Adding a claim kind is an edit to the table below and nowhere else. A signal
// whose kind is not in the table cannot reach the headline — that is the point.

/** Bump when a region role, a claim kind, a unit, or a threshold changes meaning. */
export const SPINE_MANIFEST_VERSION = "finops-spine-manifest/1.0.0";

/** The roles a spine region can hold. Exactly one region holds `headline`. */
export const SPINE_ROLE = Object.freeze({
  headline: "headline",
  supporting: "supporting",
});

/** The claim kinds this page knows how to assert. Stable strings; stored ids. */
export const SPINE_CLAIM_KIND = Object.freeze({
  peerPosition: "peer_position",
  spendTrend: "spend_trend",
  departmentGap: "department_gap",
  departmentDriver: "department_driver",
  recoverableSpend: "recoverable_spend",
});

/**
 * The units an impact may be stated in.
 *
 * A headline claim carries a number, and a number with no declared unit is not
 * checkable. Two of these are money and two are ordinal distances in quartiles,
 * and the resolver never compares across units — each kind declares the one it
 * must use, and the manifest declares when that number is material.
 */
export const SPINE_UNIT = Object.freeze({
  usdPerMonth: "usd_per_month",
  usdPerSuccessfulTask: "usd_per_successful_task",
  quartilesFromCheapest: "quartiles_from_cheapest",
  quartilesBehind: "quartiles_behind",
});

/** The directions a claim may assert. A direction is a word, never a colour. */
export const SPINE_DIRECTION = Object.freeze({
  worseThanPeers: "worse_than_peers",
  atPeers: "at_peers",
  betterThanPeers: "better_than_peers",
  increase: "increase",
  decrease: "decrease",
  flat: "flat",
  behind: "behind",
  recoverable: "recoverable",
});

/**
 * The headline's claim table, in priority order.
 *
 * `priority` is the position in this array and is written out rather than
 * implied, because it is a ranking input and a reader of the ranking rules
 * should not have to count array indices to check one. It is the order a FinOps
 * lead needs the answers in: where we stand first (the region's own question),
 * then which way spend moved, then the widest internal gap, then the department
 * driving it, then what could be recovered.
 *
 * `majorAt` is the absolute value of `impact.value`, in `unit`, at or above
 * which a finding is material. It is a threshold for RANKING only. It never
 * suppresses a finding and never changes a number.
 */
const HEADLINE_CLAIM_KINDS = Object.freeze([
  Object.freeze({
    kind: SPINE_CLAIM_KIND.peerPosition,
    priority: 0,
    unit: SPINE_UNIT.quartilesFromCheapest,
    directions: Object.freeze([SPINE_DIRECTION.worseThanPeers, SPINE_DIRECTION.atPeers,
      SPINE_DIRECTION.betterThanPeers]),
    /** One quartile off the cheapest quarter is material. */
    majorAt: 1,
  }),
  Object.freeze({
    kind: SPINE_CLAIM_KIND.spendTrend,
    priority: 1,
    unit: SPINE_UNIT.usdPerMonth,
    directions: Object.freeze([SPINE_DIRECTION.increase, SPINE_DIRECTION.decrease,
      SPINE_DIRECTION.flat]),
    majorAt: 5000,
  }),
  Object.freeze({
    kind: SPINE_CLAIM_KIND.departmentGap,
    priority: 2,
    unit: SPINE_UNIT.quartilesBehind,
    directions: Object.freeze([SPINE_DIRECTION.behind]),
    majorAt: 1,
  }),
  Object.freeze({
    kind: SPINE_CLAIM_KIND.departmentDriver,
    priority: 3,
    unit: SPINE_UNIT.usdPerMonth,
    directions: Object.freeze([SPINE_DIRECTION.increase, SPINE_DIRECTION.decrease]),
    majorAt: 5000,
  }),
  Object.freeze({
    kind: SPINE_CLAIM_KIND.recoverableSpend,
    priority: 4,
    unit: SPINE_UNIT.usdPerMonth,
    directions: Object.freeze([SPINE_DIRECTION.recoverable]),
    majorAt: 10000,
  }),
]);

/**
 * The spine.
 *
 * `regionId` is the element id `finops-stand.js` publishes as its region. The
 * two agree, and a test asserts they agree rather than either one importing the
 * other: the manifest may not depend on a composer it constrains.
 */
export const FINOPS_SPINE_MANIFEST = Object.freeze({
  version: SPINE_MANIFEST_VERSION,
  headline: Object.freeze({
    regionId: "finops-stand",
    role: SPINE_ROLE.headline,
    /** The headline asserts one claim. Runners-up are disclosure, not headline. */
    maxClaims: 1,
    /**
     * And it asserts it in at most three sentences: the position, what it is
     * worth, and who is driving it. A fourth sentence is a paragraph, and a
     * paragraph is not a headline a lead can repeat.
     */
    maxSentences: 3,
    claimKinds: HEADLINE_CLAIM_KINDS,
  }),
});

/** The claim-kind record, or null when the headline may not assert this kind. */
export function headlineClaimKind(kind, manifest = FINOPS_SPINE_MANIFEST) {
  const kinds = manifest?.headline?.claimKinds ?? [];
  return kinds.find((entry) => entry.kind === kind) ?? null;
}

/**
 * The declared priority of a claim kind. A kind the manifest does not declare
 * sorts after every kind it does, rather than throwing into a comparator.
 */
export function headlineKindPriority(kind, manifest = FINOPS_SPINE_MANIFEST) {
  return headlineClaimKind(kind, manifest)?.priority ?? Number.MAX_SAFE_INTEGER;
}
