// What this browser keeps of the two things only the lead established (#1484):
// the contracted rates they declared (#1481) and the scored coverage the graded
// floor was taken at (#1482). One key, one payload, one version, one way in —
// the view beside the form asks here and never touches `localStorage` itself,
// because hydrating, saying so, and forgetting are only holdable together if one
// module owns the read and the write.
//
// THE PAYLOAD CARRIES ITS VERSION; THE KEY DOES NOT. The other stores on this
// origin version their key (`…workspace.v1`), which makes an old entry
// unreadable rather than carrying it forward — a later build never looks at the
// old key and the reader's declaration is silently gone. Here the key is stable
// and the payload states an integer `version`, so an older entry is WALKED to
// the current shape through a declared chain, one named step at a time, or
// refused by name. There is no third answer: a payload whose version is unknown,
// newer than this build, or missing a step is discarded, never read field by
// field for what looks familiar.
//
// EVERY REFUSAL HAS A CODE AND A SENTENCE. A caller gets `{ retained, payload,
// reason, message }` — never a half-migrated object, never a coerced rate. The
// unretained baseline is a reason like any other, so one render path serves
// every outcome.
//
// NOTHING THROWS AND NOTHING LEAVES THE BROWSER. The accessor itself is what
// raises on an origin with site data disabled, so it is wrapped rather than the
// call after it; quota, a disabled store and an absent `localStorage` all
// degrade to the baseline with a reason. No fetch, no DOM, no clock unless one
// is passed in.
//
// WHAT MAY BE RETAINED IS CLOSED. Five declared-rate fields and a coverage ratio
// with the department ids it was taken over. Intake already refuses
// credential-shaped and contact-shaped text, and the validator below rebuilds a
// record from the five known fields rather than keeping what it was handed.

import {
  DECLARED_RATE_UNITS, RATE_MAX,
} from "./finops-declared-rate-contract.js";
import { isCalendarDate } from "./finops-rate-card-contract.js";

/** One key, stable across versions. The payload states which version it is. */
export const RETAINED_STATE_KEY = "shiplog.finops.retained-state";

/** The shape this build writes. Bump with a migration, never on its own. */
export const RETAINED_STATE_VERSION = 2;

/** Bounds, so a tampered or runaway entry cannot become a render cost. */
export const RETAINED_LIMITS = Object.freeze({
  rates: 200, departments: 500, text: 200,
});

/** Machine-readable outcomes. The page writes these into a data attribute. */
export const RETAINED_REASON = Object.freeze({
  retained: "retained",
  unretained: "unretained",
  cleared: "cleared",
  storageUnavailable: "storage_unavailable",
  readFailed: "read_failed",
  unparsableJson: "unparsable_json",
  unsupportedVersion: "unsupported_version",
  incompleteMigration: "incomplete_migration",
  invalidShape: "invalid_shape",
  nothingToRetain: "nothing_to_retain",
  writeFailed: "write_failed",
});

/** The sentence a reader is shown for each outcome. One per code, no defaults. */
export const RETAINED_MESSAGE = Object.freeze({
  [RETAINED_REASON.retained]: "Retained declared rates and scored coverage were read from this "
    + "browser.",
  [RETAINED_REASON.unretained]: "Nothing is retained in this browser, so the figures are the "
    + "page's own unretained baseline.",
  [RETAINED_REASON.cleared]: "The retained declared rates and scored coverage were removed from "
    + "this browser.",
  [RETAINED_REASON.storageUnavailable]: "This browser offers no site storage, so nothing can be "
    + "retained and the figures are the unretained baseline.",
  [RETAINED_REASON.readFailed]: "This browser refused to be read for retained state, so the "
    + "figures are the unretained baseline.",
  [RETAINED_REASON.unparsableJson]: "The retained entry is not readable JSON, so it was discarded "
    + "and the figures are the unretained baseline.",
  [RETAINED_REASON.unsupportedVersion]: "The retained entry states a version this build cannot "
    + "read, so it was discarded rather than guessed at.",
  [RETAINED_REASON.incompleteMigration]: "The retained entry cannot be carried forward to the "
    + "shape this build reads, so it was discarded rather than part-applied.",
  [RETAINED_REASON.invalidShape]: "The retained entry failed validation — a field is missing, "
    + "wrongly typed, or out of range — so it was discarded rather than corrected.",
  [RETAINED_REASON.nothingToRetain]: "There is no declared rate to retain, so nothing was written.",
  [RETAINED_REASON.writeFailed]: "This browser refused the write, so nothing is retained and the "
    + "figures stay the unretained baseline.",
});

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The region an entry says it was captured at, if it says one.
 *
 * NOT A PAYLOAD FIELD, and deliberately not one. `validateRetainedPayload`
 * rebuilds a record from the closed list of fields this build derives figures
 * from, and a region id derives no figure — it is wayfinding. So it is read off
 * the RAW parsed entry, bounded, and handed back beside the payload rather than
 * inside it: the closed shape stays closed, an entry written by a build that
 * recorded no region is not invalid for the omission, and a pointer at a region
 * this build merged away cannot become a reason to discard a reader's rates.
 *
 * It is returned as it was written. Resolving it to a region this page actually
 * carries is `canonicalAnchorTarget`'s, in the view that has a document — this
 * module reads no DOM.
 */
function capturedRegion(value) {
  const region = isRecord(value) ? value.region : null;
  if (typeof region !== "string") return null;
  const trimmed = region.trim();
  return trimmed !== "" && trimmed.length <= RETAINED_LIMITS.text ? trimmed : null;
}

/** An outcome with no payload: the unretained baseline, plus why. */
const baseline = (reason) => Object.freeze({
  retained: false, payload: null, region: null, reason, message: RETAINED_MESSAGE[reason],
});

/**
 * This browser's storage, or null.
 *
 * Acquired here rather than at a call site: the accessor itself raises on an
 * origin with site data disabled, and a first screen must not be taken down by
 * the thing that was only ever an optimisation.
 */
export function browserRetainedStorage() {
  try {
    return globalThis.localStorage ?? globalThis.window?.localStorage ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// THE MIGRATION CHAIN
// ---------------------------------------------------------------------------

/**
 * 1 → 2.
 *
 * Version 1 kept scored coverage as a bare ratio, which says how much of the
 * spend was scored and not which departments carried it — so a reader could not
 * check the number against the list beside it. Version 2 keeps the ratio and the
 * ids it was taken over.
 *
 * The ids are NOT invented here. A v1 entry never held them, so it migrates to
 * an empty list and the provenance line says the coverage came from an entry
 * that did not record them. A migration that back-filled ids from today's
 * analysis would be this build claiming the reader captured something they did
 * not.
 */
function upgrade_1_to_2(payload) {
  const coverage = payload.scoredCoverage;
  return {
    ...payload,
    version: 2,
    scoredCoverage: {
      coverage: typeof coverage === "number" ? coverage : null,
      departmentIds: [],
    },
  };
}

/**
 * From-version → the pure function producing the NEXT shape. Every readable
 * version has an entry; a version with none is `incomplete_migration`, which is
 * a refusal and not a fallback.
 */
export const RETAINED_STATE_MIGRATIONS = Object.freeze({
  1: upgrade_1_to_2,
});

/**
 * Walk a parsed entry from its own version up to the current one.
 *
 * @returns `{ payload }` at the current version, or `{ reason }`. Nothing
 *   part-migrated ever leaves this function: a step that does not advance the
 *   version stops the walk rather than looping or half-applying.
 */
export function migrateRetainedPayload(value) {
  if (!isRecord(value)) return { reason: RETAINED_REASON.invalidShape };
  let version = value.version;
  if (!Number.isInteger(version) || version < 1 || version > RETAINED_STATE_VERSION) {
    return { reason: RETAINED_REASON.unsupportedVersion };
  }
  let current = value;
  while (version < RETAINED_STATE_VERSION) {
    const step = RETAINED_STATE_MIGRATIONS[version];
    if (typeof step !== "function") return { reason: RETAINED_REASON.incompleteMigration };
    current = step(current);
    const next = isRecord(current) ? current.version : null;
    if (!Number.isInteger(next) || next <= version || next > RETAINED_STATE_VERSION) {
      return { reason: RETAINED_REASON.incompleteMigration };
    }
    version = next;
  }
  return { payload: current };
}

// ---------------------------------------------------------------------------
// VALIDATION — types and ranges, checked, never coerced
// ---------------------------------------------------------------------------

const filledText = (value, limit = RETAINED_LIMITS.text) =>
  (typeof value === "string" && value.trim() !== "" && value.length <= limit ? value.trim() : null);

/** One declared rate, rebuilt from the five known fields or refused whole. */
function validRate(value) {
  if (!isRecord(value)) return null;
  const model = filledText(value.model);
  const sourceLabel = filledText(value.sourceLabel);
  const { rate, unit, effectiveDate } = value;
  if (!model || !sourceLabel) return null;
  if (!DECLARED_RATE_UNITS.includes(unit)) return null;
  // A number, not a numeric string: a stored "14.00" is an entry written by
  // something other than this build, and coercing it is how a tampered rate
  // becomes a dollar figure on the first screen.
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0 || rate > RATE_MAX) {
    return null;
  }
  if (!isCalendarDate(effectiveDate)) return null;
  return Object.freeze({ model, unit, rate, effectiveDate, sourceLabel });
}

/** The coverage the floor was taken at, and the ids it was taken over. */
function validCoverage(value) {
  if (!isRecord(value)) return null;
  const { coverage, departmentIds } = value;
  const ratio = coverage === null ? null : coverage;
  if (ratio !== null
    && (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 1)) {
    return null;
  }
  if (!Array.isArray(departmentIds) || departmentIds.length > RETAINED_LIMITS.departments) {
    return null;
  }
  const ids = departmentIds.map((id) => filledText(id));
  if (ids.some((id) => id === null)) return null;
  return Object.freeze({ coverage: ratio, departmentIds: Object.freeze(ids) });
}

/** An ISO instant that parses, kept as the string it was written as. */
const validInstant = (value) => (typeof value === "string"
  && value.length <= RETAINED_LIMITS.text
  && !Number.isNaN(new Date(value).getTime()) ? value : null);

/**
 * A current-shape payload, fully validated, or null.
 *
 * The SAME validator guards the read and the write, so this module cannot be the
 * way an entry a read would refuse gets into storage in the first place.
 */
export function validateRetainedPayload(value) {
  if (!isRecord(value) || value.version !== RETAINED_STATE_VERSION) return null;
  const capturedAt = validInstant(value.capturedAt);
  if (!capturedAt) return null;
  const rates = value.declaredRates;
  if (!Array.isArray(rates) || rates.length === 0 || rates.length > RETAINED_LIMITS.rates) {
    return null;
  }
  const declaredRates = rates.map((entry) => validRate(entry));
  if (declaredRates.some((entry) => entry === null)) return null;
  const scoredCoverage = validCoverage(value.scoredCoverage);
  if (!scoredCoverage) return null;
  return Object.freeze({
    version: RETAINED_STATE_VERSION,
    capturedAt,
    declaredRates: Object.freeze(declaredRates),
    scoredCoverage,
  });
}

// ---------------------------------------------------------------------------
// THE THREE OPERATIONS
// ---------------------------------------------------------------------------

/**
 * What this browser retained, or the unretained baseline and why.
 *
 * @param storage injected in tests; the wrapped browser accessor otherwise.
 * @returns a frozen `{ retained, payload, reason, message }`. `payload` is a
 *   fully validated current-shape object or null — never anything between.
 */
export function loadRetainedState({ storage = browserRetainedStorage() } = {}) {
  if (!storage || typeof storage.getItem !== "function") {
    return baseline(RETAINED_REASON.storageUnavailable);
  }
  let raw = null;
  try {
    raw = storage.getItem(RETAINED_STATE_KEY);
  } catch {
    return baseline(RETAINED_REASON.readFailed);
  }
  if (typeof raw !== "string" || raw === "") return baseline(RETAINED_REASON.unretained);
  let parsed = null;
  try {
    // JSON.parse builds data. No eval, no Function, no dynamic import, ever.
    parsed = JSON.parse(raw);
  } catch {
    return baseline(RETAINED_REASON.unparsableJson);
  }
  const migrated = migrateRetainedPayload(parsed);
  if (!migrated.payload) return baseline(migrated.reason);
  const payload = validateRetainedPayload(migrated.payload);
  if (!payload) return baseline(RETAINED_REASON.invalidShape);
  return Object.freeze({
    retained: true, payload, region: capturedRegion(parsed), reason: RETAINED_REASON.retained,
    message: RETAINED_MESSAGE[RETAINED_REASON.retained],
  });
}

/**
 * Retain what the lead established, or say why nothing was.
 *
 * @param capturedAt the instant to stamp. Passed in — a test freezes it, and two
 *   writes in the same millisecond are still two writes with a stated time.
 * @returns the same outcome shape the load returns, so a caller renders one way.
 */
export function saveRetainedState({
  declaredRates = [], scoredCoverage = null, capturedAt = new Date(),
  storage = browserRetainedStorage(),
} = {}) {
  const stamp = capturedAt instanceof Date ? capturedAt.toISOString() : capturedAt;
  const payload = validateRetainedPayload({
    version: RETAINED_STATE_VERSION,
    capturedAt: stamp,
    declaredRates,
    scoredCoverage: scoredCoverage ?? { coverage: null, departmentIds: [] },
  });
  if (!payload) {
    return baseline(Array.isArray(declaredRates) && declaredRates.length === 0
      ? RETAINED_REASON.nothingToRetain : RETAINED_REASON.invalidShape);
  }
  if (!storage || typeof storage.setItem !== "function") {
    return baseline(RETAINED_REASON.storageUnavailable);
  }
  try {
    storage.setItem(RETAINED_STATE_KEY, JSON.stringify(payload));
  } catch {
    // Quota, a disabled store, a private window that accepts the read and
    // refuses the write. All one answer: nothing is retained, and the page says
    // so rather than rendering as though something were.
    return baseline(RETAINED_REASON.writeFailed);
  }
  // No region: this build records where a reader IS from the document, not from
  // the entry, and writing a pointer it never reads back would be a field to
  // keep true for nothing.
  return Object.freeze({
    retained: true, payload, region: null, reason: RETAINED_REASON.retained,
    message: RETAINED_MESSAGE[RETAINED_REASON.retained],
  });
}

/**
 * Remove the entry. Reports which happened; a browser that refuses the removal
 * is not a browser that forgot.
 */
export function clearRetainedState({ storage = browserRetainedStorage() } = {}) {
  if (!storage || typeof storage.removeItem !== "function") {
    const refused = baseline(RETAINED_REASON.storageUnavailable);
    return Object.freeze({ cleared: false, reason: refused.reason, message: refused.message });
  }
  try {
    storage.removeItem(RETAINED_STATE_KEY);
  } catch {
    const refused = baseline(RETAINED_REASON.writeFailed);
    return Object.freeze({ cleared: false, reason: refused.reason, message: refused.message });
  }
  return Object.freeze({
    cleared: true,
    reason: RETAINED_REASON.cleared,
    message: RETAINED_MESSAGE[RETAINED_REASON.cleared],
  });
}

// ---------------------------------------------------------------------------
// WHAT THE FIRST SCREEN SAYS ABOUT IT
// ---------------------------------------------------------------------------

/** The capture instant, stated UTC so a reader in another zone reads the same. */
export const capturedAtLabel = (stamp) => `${stamp.slice(0, 10)} at ${stamp.slice(11, 16)} UTC`;

/**
 * The provenance sentence for a first screen that is using retained state: when
 * it was captured, and which parts of the headline claim above depend on it.
 *
 * Composed here, from the payload, so the page cannot state a capture time or a
 * dependency the entry does not carry.
 */
export function retainedProvenanceLine(payload) {
  if (!payload) return "";
  const count = payload.declaredRates.length;
  const { coverage, departmentIds } = payload.scoredCoverage;
  const parts = [`Retained in this browser: ${count} declared `
    + `${count === 1 ? "rate" : "rates"}, captured ${capturedAtLabel(payload.capturedAt)}.`,
  "The pricing provenance and the confidence grade beside the recoverable figure above are "
    + "computed from them; the recoverable amount itself is not."];
  if (coverage === null) {
    parts.push("No scored coverage was recorded with them.");
  } else {
    const scored = departmentIds.length;
    parts.push(`Scored coverage when they were captured: ${Math.round(coverage * 100)}% of `
      + `analyzed spend${scored === 0 ? ", over departments the entry did not record"
        : ` across ${scored} scored ${scored === 1 ? "department" : "departments"}`}.`);
  }
  return parts.join(" ");
}

/** The notice for a first screen that is NOT using retained state, and why. */
export const retainedNoticeFor = (outcome) => (outcome?.reason === RETAINED_REASON.unretained
  ? "" : outcome?.message ?? "");
