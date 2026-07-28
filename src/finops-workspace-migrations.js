// Moving a stored FinOps workspace forward, one declared step at a time.
//
// WHY A MIGRATION CHAIN AND NOT A VERSION CHECK
// ---------------------------------------------
// The store lives in a browser this build does not control. A visitor can meet
// a document written months ago by an older deploy, and the only two honest
// answers to that are "I know this version and here is how it becomes the
// current one" and "I do not know this version, so I will not touch it". A
// third answer — read the fields I recognise and ignore the rest — is how a
// consent record or a retained figure quietly changes meaning across a deploy.
//
// So every readable version is listed, every step between two of them is a
// named function with a stated reason, and anything outside the list is
// `unsupported`: refused, reported, and left in storage exactly as written. A
// visitor who downgrades a tab still has their data when they upgrade again.
//
// WHAT A MIGRATION MAY DO
// -----------------------
// Rewrite shape and drop what the newer contract forbids. It may not invent a
// figure, re-derive one, or grant a consent that was never given: an absent
// field becomes an absent field, never a default that reads as a choice.
//
// This module does no I/O. It takes parsed JSON and returns a plain document;
// `finops-workspace.js` owns the storage keys, the validation, and the write.

import {
  FINOPS_COMMITMENT_PROVENANCE_FIELDS, FINOPS_SUPPORTED_WORKSPACE_VERSIONS,
  FINOPS_WORKSPACE_VERSION, FINOPS_WORKSPACE_VERSION_1_0_0,
} from "./finops-workspace-contract.js";

/** What a migration attempt can conclude. Four answers, never collapsed to two. */
export const MIGRATION_STATUS = Object.freeze({
  current: "current",
  migrated: "migrated",
  unsupported: "unsupported",
  malformed: "malformed",
});

function pick(value, fields) {
  const kept = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return kept;
  for (const field of fields) {
    if (value[field] !== undefined) kept[field] = value[field];
  }
  return kept;
}

/**
 * 1.0.0 → 1.1.0.
 *
 * 1.0.0 described a commitment's provenance with the decision block's own
 * fields, which carry `sourceId` and the `recordIds` of the imported rows the
 * claim was summed over. Source-row identifiers are a prohibited class for this
 * store, so 1.1.0 narrows provenance to designation, period, and a count — and
 * this step is what removes them from a browser that already wrote them.
 *
 * Everything else is carried unchanged: the consent record keeps the version it
 * was granted against, because rewriting it would be this build claiming an
 * agreement it never asked for.
 */
function upgrade_1_0_0_to_1_1_0(document) {
  const commitments = Array.isArray(document.commitments) ? document.commitments : [];
  return {
    ...document,
    schemaVersion: FINOPS_WORKSPACE_VERSION,
    commitments: commitments.map((commitment) => (
      commitment && typeof commitment === "object" && !Array.isArray(commitment)
        ? {
          ...commitment,
          provenance: pick(commitment.provenance, FINOPS_COMMITMENT_PROVENANCE_FIELDS),
        }
        : commitment
    )),
  };
}

/** The chain, in order. Each entry migrates exactly one version to the next. */
export const WORKSPACE_MIGRATIONS = Object.freeze([
  Object.freeze({
    from: FINOPS_WORKSPACE_VERSION_1_0_0,
    to: FINOPS_WORKSPACE_VERSION,
    note: "Narrowed retained commitment provenance to designation, analysis period, and record "
      + "count; dropped the source identifier and the source-row ids a 1.0.0 store could hold.",
    apply: upgrade_1_0_0_to_1_1_0,
  }),
]);

/**
 * Migrate a parsed workspace document to the current version.
 *
 * @param parsed whatever `JSON.parse` returned for the stored text.
 * @returns `{ status, document, from, to, steps }`.
 *   - `current`: already at `FINOPS_WORKSPACE_VERSION`; `document` is `parsed`.
 *   - `migrated`: `document` is at the current version, `steps` names each hop.
 *   - `unsupported`: a version string this build does not know. `document` is
 *     null and the caller must leave the stored text alone.
 *   - `malformed`: not an object, or no version string at all.
 *
 * Total: it never throws. A store is untrusted input even when this build wrote
 * it, because the browser between the two writes is not.
 */
export function migrateFinopsWorkspace(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return Object.freeze({
      status: MIGRATION_STATUS.malformed, document: null, from: null,
      to: FINOPS_WORKSPACE_VERSION, steps: Object.freeze([]),
    });
  }
  const from = typeof parsed.schemaVersion === "string" ? parsed.schemaVersion : null;
  if (from === null) {
    return Object.freeze({
      status: MIGRATION_STATUS.malformed, document: null, from: null,
      to: FINOPS_WORKSPACE_VERSION, steps: Object.freeze([]),
    });
  }
  if (from === FINOPS_WORKSPACE_VERSION) {
    return Object.freeze({
      status: MIGRATION_STATUS.current, document: parsed, from,
      to: FINOPS_WORKSPACE_VERSION, steps: Object.freeze([]),
    });
  }
  if (!FINOPS_SUPPORTED_WORKSPACE_VERSIONS.includes(from)) {
    return Object.freeze({
      status: MIGRATION_STATUS.unsupported, document: null, from,
      to: FINOPS_WORKSPACE_VERSION, steps: Object.freeze([]),
    });
  }

  let document = parsed;
  const steps = [];
  // Bounded by the chain itself: each hop must consume the migration whose
  // `from` matches, so a chain that ever loops cannot spin here.
  for (const migration of WORKSPACE_MIGRATIONS) {
    if (document.schemaVersion !== migration.from) continue;
    document = migration.apply(document);
    steps.push(`${migration.from} → ${migration.to}`);
  }
  if (document.schemaVersion !== FINOPS_WORKSPACE_VERSION) {
    // A supported version with no path to the current one is a gap in this
    // chain, not a document to guess at.
    return Object.freeze({
      status: MIGRATION_STATUS.unsupported, document: null, from,
      to: FINOPS_WORKSPACE_VERSION, steps: Object.freeze([]),
    });
  }
  return Object.freeze({
    status: MIGRATION_STATUS.migrated, document, from,
    to: FINOPS_WORKSPACE_VERSION, steps: Object.freeze(steps),
  });
}
