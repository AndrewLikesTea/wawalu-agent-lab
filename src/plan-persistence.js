// A lead's committed plan, kept across a reload, and told plainly when the
// analysis under it has moved (#1290).
//
// WHAT IS STORED, AND NOTHING ELSE: the moves that are in the plan, the three
// scope levers each was committed at, the total those levers produced, and two
// fingerprints — of the analysis and of the rate card — as they stood when the
// plan was filed. No credential, no customer record, no prompt, no analysis
// narrative, no source row. Widening it past that is how a browser store becomes
// a place customer data leaks to.
//
// ONE KEY, ONE VERSION. Everything lives under `finops-plan-v1`, so forgetting
// the plan is one `removeItem` and a shape change is a new key rather than a
// migration nobody can test. An entry this module cannot read is DELETED and
// reported, never repaired: a half-understood plan rendered as a whole one is
// worse than an empty page, because the lead cannot see which half is missing.
//
// IT NEVER THROWS AT THE CALLER. A blocked browser, a full quota and a corrupted
// value all resolve to a stated outcome — an exception escaping here is a blank
// analysis page. Pure apart from the four storage calls, and the fingerprints
// are exported pure functions so a test can call them directly.

import { sourceFingerprint } from "./finops-workspace.js";
import { emptyMoveScope } from "./plan-scope-levers.js";
import { planMoveKey } from "./plan-scope.js";

/** The one key. Bump the suffix rather than migrating a stored shape in place. */
export const PLAN_STORAGE_KEY = "finops-plan-v1";

/** The version inside the record. A mismatch is discarded, never coerced. */
export const PLAN_RECORD_VERSION = "finops-plan/1";

/** A slate this page paints is a handful of rules; anything longer is not one. */
export const MAX_STORED_MOVES = 50;

/** Excluded workloads are a short list of names, not a document. */
export const MAX_EXCLUDED_TEXT = 240;

/** What happened when the page asked this browser for a plan. */
export const PLAN_READ = Object.freeze({
  EMPTY: "empty",
  RESTORED: "restored",
  UNREADABLE: "unreadable",
});

/**
 * Said once, in the open, when a stored plan could not be read. It states what
 * the page did instead, because a reader whose plan vanished needs to know they
 * are looking at an empty plan rather than at their own.
 */
export const PLAN_RESTORE_FAILED =
  "The plan saved in this browser could not be read, so it has been removed and this page has "
  + "started from an empty plan. Nothing else on the page changed.";

/** The one prioritised action on the staleness notice. */
export const PLAN_RECOMPUTE_LABEL = "Recompute against today's analysis";

/** The other way out of it: the filed plan stands, untouched. */
export const PLAN_KEEP_LABEL = "Keep the plan as filed";

/** What changed under a filed plan, in the words this page already uses. */
const CHANGED_NAMES = Object.freeze({
  analysis: "the analysis",
  "rate card": "the rate card",
  both: "the analysis and the rate card",
});

/**
 * Every scalar in a value, keyed by its path and sorted, so two structurally
 * equal inputs hash the same however their keys were ordered.
 */
export function stableParts(value, path = "", out = []) {
  if (value === null || typeof value !== "object") {
    out.push(`${path}=${String(value)}`);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => stableParts(entry, `${path}[${index}]`, out));
    return out;
  }
  for (const key of Object.keys(value).sort()) {
    stableParts(value[key], path ? `${path}.${key}` : key, out);
  }
  return out;
}

/** FNV-1a over those parts, reusing the workspace's own digest rather than a second one. */
export const fingerprintOf = (value) => sourceFingerprint(stableParts(value));

/**
 * The analysis, as far as a plan is concerned: the moves it offered and what
 * each was modelled at. Those are the figures the plan's own arithmetic
 * multiplies, so a change in either is a change a lead has to be told about.
 */
export const analysisFingerprint = (slate) => fingerprintOf(
  (slate?.rules ?? []).map((rule) => ({
    move: planMoveKey(rule),
    modelledMonthlyUsd: Number(rule?.expectedMonthlyUsd),
  })));

/**
 * The declared rate card, whole. Every field is hashed rather than a chosen few:
 * a price this page renders and this fingerprint ignores is a repricing a filed
 * plan would silently absorb.
 */
export const rateCardFingerprint = (card) => fingerprintOf(card ?? null);

/** Both, together, because the notice has to name which one moved. */
export const planFingerprints = (slate, card) => Object.freeze({
  analysis: analysisFingerprint(slate),
  rateCard: rateCardFingerprint(card),
});

const shareOf = (value) => (typeof value === "number" && Number.isFinite(value)
  && value >= 0 && value <= 100 ? value : null);

/**
 * The record to file: the committed moves with their levers, the total those
 * levers produced, and today's two fingerprints.
 *
 * @param {object} model the model `planScope()` just produced and the page painted.
 * @param {Map<string, object>} scopes what the lead stated, keyed by move key.
 */
export function projectPlanRecord(model, scopes, fingerprints) {
  const moves = [];
  for (const move of model?.moves ?? []) {
    const scope = scopes?.get?.(move.key);
    if (!scope?.inPlan || moves.length >= MAX_STORED_MOVES) continue;
    moves.push({
      key: String(move.key),
      sharePct: shareOf(scope.sharePct),
      excludedText: String(scope.excludedText ?? "").slice(0, MAX_EXCLUDED_TEXT),
      refuses: Boolean(scope.refuses),
    });
  }
  return {
    version: PLAN_RECORD_VERSION,
    plannedMonthlyUsd: Number(model?.plannedMonthlyUsd) || 0,
    analysisFingerprint: String(fingerprints?.analysis ?? ""),
    rateCardFingerprint: String(fingerprints?.rateCard ?? ""),
    moves,
  };
}

/** One stored move, or `null` — which fails the whole record rather than the row. */
function validMove(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.key !== "string" || entry.key === "") return null;
  if (entry.sharePct !== null && shareOf(entry.sharePct) === null) return null;
  if (typeof entry.excludedText !== "string") return null;
  if (typeof entry.refuses !== "boolean") return null;
  return entry;
}

/**
 * A parsed value, or `null` when it is not a plan this version wrote. Every
 * field is checked: a record that passed on its version alone would put a
 * half-shaped plan through the renderer, which is the broken page this guards.
 */
export function validatePlanRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.version !== PLAN_RECORD_VERSION) return null;
  if (!Number.isFinite(Number(value.plannedMonthlyUsd))) return null;
  if (typeof value.analysisFingerprint !== "string") return null;
  if (typeof value.rateCardFingerprint !== "string") return null;
  if (!Array.isArray(value.moves) || value.moves.length > MAX_STORED_MOVES) return null;
  return value.moves.every(validMove) ? value : null;
}

/**
 * Read the filed plan.
 *
 * @returns `{status, record}`. `empty` is the ordinary first visit and is not an
 *   error. `unreadable` means the key was present, unusable, and has been
 *   removed — the caller says so on screen and starts from an empty plan.
 */
export function readStoredPlan(storage) {
  try {
    const raw = storage?.getItem?.(PLAN_STORAGE_KEY) ?? null;
    if (raw === null || raw === "") return { status: PLAN_READ.EMPTY, record: null };
    const record = validatePlanRecord(JSON.parse(raw));
    if (record) return { status: PLAN_READ.RESTORED, record };
  } catch {
    // Blocked storage, unparseable JSON, a hostile value — all one outcome.
  }
  clearStoredPlan(storage);
  return { status: PLAN_READ.UNREADABLE, record: null };
}

/** File the plan. `false` when this browser refused it; the page keeps working. */
export function writeStoredPlan(storage, record) {
  try {
    storage?.setItem?.(PLAN_STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** Forget it. One key, so there is nothing left behind to find later. */
export function clearStoredPlan(storage) {
  try {
    storage?.removeItem?.(PLAN_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * The filed record as the view's own scope state, so a restored plan is painted
 * by the live controls rather than by a second renderer. A move the current
 * slate no longer offers simply never gets looked up.
 */
export function restoredScopes(record) {
  const scopes = new Map();
  for (const move of record?.moves ?? []) {
    scopes.set(move.key, {
      ...emptyMoveScope(),
      inPlan: true,
      sharePct: shareOf(move.sharePct),
      excludedText: String(move.excludedText ?? ""),
      refuses: Boolean(move.refuses),
    });
  }
  return scopes;
}

/**
 * What moved under the filed plan, if anything. Matching fingerprints are the
 * ordinary case and produce no notice at all.
 *
 * @returns `{stale, changed, sentence}` — `changed` is `analysis`, `rate card`,
 *   `both`, or `null` when nothing moved.
 */
export function planStaleness(record, fingerprints) {
  const analysisMoved = String(record?.analysisFingerprint ?? "")
    !== String(fingerprints?.analysis ?? "");
  const cardMoved = String(record?.rateCardFingerprint ?? "")
    !== String(fingerprints?.rateCard ?? "");
  if (!analysisMoved && !cardMoved) {
    return { stale: false, changed: null, sentence: "" };
  }
  const changed = analysisMoved && cardMoved ? "both" : (analysisMoved ? "analysis" : "rate card");
  return {
    stale: true,
    changed,
    sentence: `This plan was filed before ${CHANGED_NAMES[changed]} changed. The moves and scopes `
      + "below are the ones you filed, so recompute them against today's figures, or keep the "
      + "plan as filed.",
  };
}
