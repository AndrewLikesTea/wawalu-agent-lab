// Bringing a lead's committed plan back after a reload, and saying plainly when
// it was filed against an older analysis or an older rate card (#1290).
//
// WHAT IS KEPT, AND NOTHING ELSE. One versioned key holds one flat record: the
// moves the lead put in the plan, the scope they declared for each, the total
// `plan-scope.js` computed for exactly those, and two fingerprints. No prompt,
// no credential, no customer identifier, no free-text note, no source row, no
// file name and no analysis payload has a field here. The excluded-workload
// names are the one lead-typed value that is kept — they ARE the declared scope,
// and a restored plan that dropped them would be a different plan — so they pass
// a deliberately narrow gate on the way in and on the way out: at most
// MAX_EXCLUDED names, at most EXCLUDED_NAME_MAX characters each, and only word
// characters, spaces and `. _ - /`. A record carrying anything else is not
// written and, if it somehow arrives, is not read.
//
// THE STORED VALUE IS UNTRUSTED INPUT. It was last written by this page, but the
// thing that hands it back is a store any script on this origin can write. So
// every read validates shape and type before a single field is used, an
// unreadable record NEVER throws and never half-restores, and every string that
// survives is handed to the view as text for `textContent`. Nothing here builds
// a node or a markup string.
//
// THE FINGERPRINTS ARE CHANGE DETECTION, not security digests, and they are
// taken from identifiers this page already publishes rather than coined here:
// the analysis's own schema version, period and headline figures, and the
// resolved rate card's id, its declared/reference state and its per-model rates.
// `digestOf` is the FNV-1a the input-provenance disclosure already ships, so
// there is one hash on this page and not two. A fingerprint says two inputs
// DIFFER; it is not a claim that a third party could not construct a collision,
// and nothing on the surface treats it as one.
//
// PURE APART FROM THE STORE. No clock, no randomness, no DOM. Every storage call
// is total: a browser with site data disabled throws on the accessor, not on the
// call, and the caller has already turned that into a null store.

import { digestOf } from "./finops-input-digest.js";
import { resolveRateCard } from "./finops-rate-card-contract.js";

/** One key, versioned in its own name, so a schema change cannot alias an old one. */
export const PLAN_STATE_KEY = "shiplog.finops.plan-scope.v1";

/** Bump when a field below changes meaning. An unrecognised version is not read. */
export const PLAN_STATE_VERSION = "plan-scope-state/1.0.0";

/** Bounds on the one lead-typed value kept. Small on purpose. */
export const MAX_STORED_MOVES = 20;
export const MAX_EXCLUDED = 20;
export const EXCLUDED_NAME_MAX = 60;

const EXCLUDED_NAME = /^[\w][\w .\-/]*$/;
const MOVE_KEY_MAX = 200;

/**
 * What the reader is told when a saved plan could not be read. It says what
 * happened, what state they are in, and that nothing they do now is affected —
 * no error code, no apology, no alarm.
 */
export const PLAN_UNREADABLE_NOTICE =
  "A plan was saved in this browser, but it could not be read, so this section starts empty. "
  + "Enter the moves again and it will be kept.";

/** The words on the control that forgets the plan, and what it promises. */
export const PLAN_CLEAR_LABEL = "Clear this plan from this browser";
export const PLAN_CLEARED_NOTE =
  "Cleared. This browser now holds no plan, and this section is back to nothing committed.";

/** The prioritized action on the staleness notice, and the one way to decline it. */
export const PLAN_RECOMPUTE_LABEL = "Recompute this plan against today's analysis";
export const PLAN_KEEP_LABEL = "Keep the plan as filed";

/** What changed, named in concrete terms rather than as "data". */
const CHANGED_PHRASE = Object.freeze({
  analysis: "the analysis under it has been re-run",
  rateCard: "the rate card it was priced at has changed",
});

const cents = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
};

const text = (value, max) =>
  typeof value === "string" && value.length > 0 && value.length <= max;

/** A hex digest of exactly the values named, joined with a separator no value carries. */
const fingerprint = (values) => digestOf(values.map((value) => String(value ?? "")).join(""));

/**
 * The two fingerprints a filed plan is compared against.
 *
 * Both are computed from what the analysis already carries. The rate-card side
 * goes through the shipped resolver, so a plan filed with no declared card is
 * compared against the published-list reference card rather than against the
 * absence of one — otherwise declaring a card and then withdrawing it would read
 * as "nothing changed".
 */
export function planFingerprints({ analysis = null } = {}) {
  const resolved = resolveRateCard(analysis?.rateCard ?? null);
  const models = (resolved.card?.models ?? [])
    .map((model) => [model?.model, model?.contractedInputRate, model?.contractedOutputRate,
      model?.currency, model?.effectiveDate, model?.committedUseDiscountPct, model?.permitted]
      .map((value) => String(value ?? "")).join(""))
    .sort();
  return Object.freeze({
    analysis: fingerprint([analysis?.schemaVersion, analysis?.period,
      cents(analysis?.spendUsd), cents(analysis?.recoverableUsd),
      (analysis?.departments ?? []).length]),
    rateCard: fingerprint([resolved.cardId, resolved.declared, ...models]),
  });
}

/** The excluded names a scope declared, gated, or null when the lever is silent. */
function storableExcluded(names) {
  if (names === null || names === undefined) return null;
  if (!Array.isArray(names) || names.length > MAX_EXCLUDED) return undefined;
  return names.every((name) => text(name, EXCLUDED_NAME_MAX) && EXCLUDED_NAME.test(name))
    ? [...names]
    : undefined;
}

/**
 * The record for a plan as it stands, or null when there is nothing to keep.
 *
 * `entries` is what the view holds for the moves the lead put IN the plan: the
 * move's own key, the last accepted share, the excluded names it parsed, and
 * whether a team refused. A move out of the plan contributes nothing and is not
 * filed — the session still remembers it, this browser does not.
 *
 * Returns null rather than a partial record when anything fails the gate, so a
 * caller cannot write half a plan and call it a filing.
 */
export function projectPlanState(entries, { plannedMonthlyUsd = 0, fingerprints = null } = {}) {
  if (!Array.isArray(entries) || !entries.length || entries.length > MAX_STORED_MOVES) return null;
  const moves = [];
  for (const entry of entries) {
    const excluded = storableExcluded(entry?.excluded ?? null);
    if (excluded === undefined || !text(entry?.move, MOVE_KEY_MAX)) return null;
    const share = entry?.sharePct;
    if (share !== null && !(Number.isInteger(share) && share >= 0 && share <= 100)) return null;
    moves.push({ move: entry.move, sharePct: share, excluded, refuses: Boolean(entry?.refuses) });
  }
  const record = {
    schemaVersion: PLAN_STATE_VERSION,
    analysisFingerprint: String(fingerprints?.analysis ?? ""),
    rateCardFingerprint: String(fingerprints?.rateCard ?? ""),
    plannedMonthlyUsd: Math.trunc(Number(plannedMonthlyUsd) || 0),
    moves,
  };
  return validatePlanState(record).ok ? record : null;
}

/** Shape and types, checked before one field is used. Every failure is named. */
export function validatePlanState(record) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return Object.freeze({ ok: false, errors: Object.freeze(["record: expected an object"]) });
  }
  if (record.schemaVersion !== PLAN_STATE_VERSION) errors.push("schemaVersion: unsupported");
  if (typeof record.analysisFingerprint !== "string") errors.push("analysisFingerprint: invalid");
  if (typeof record.rateCardFingerprint !== "string") errors.push("rateCardFingerprint: invalid");
  if (!Number.isInteger(record.plannedMonthlyUsd) || record.plannedMonthlyUsd < 0) {
    errors.push("plannedMonthlyUsd: invalid");
  }
  if (!Array.isArray(record.moves) || !record.moves.length
    || record.moves.length > MAX_STORED_MOVES) {
    errors.push("moves: invalid");
  } else {
    for (const move of record.moves) {
      if (!move || typeof move !== "object" || !text(move.move, MOVE_KEY_MAX)) {
        errors.push("moves[].move: invalid");
      } else if (storableExcluded(move.excluded ?? null) === undefined) {
        errors.push("moves[].excluded: invalid");
      } else if (move.sharePct !== null
        && !(Number.isInteger(move.sharePct) && move.sharePct >= 0 && move.sharePct <= 100)) {
        errors.push("moves[].sharePct: invalid");
      } else if (typeof move.refuses !== "boolean") {
        errors.push("moves[].refuses: invalid");
      }
    }
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

/**
 * Read the filed plan. Total: a missing key, unparseable JSON, an unsupported
 * schema version and a payload that fails the shape check all land in the same
 * place — no record, and a status the caller renders in words.
 */
export function readPlanState(storage) {
  try {
    const raw = storage?.getItem?.(PLAN_STATE_KEY) ?? null;
    if (raw === null) return Object.freeze({ status: "missing", record: null });
    const record = JSON.parse(raw);
    const check = validatePlanState(record);
    if (!check.ok) return Object.freeze({ status: "unreadable", record: null, errors: check.errors });
    return Object.freeze({ status: "restored", record: Object.freeze(record) });
  } catch {
    return Object.freeze({ status: "unreadable", record: null, errors: Object.freeze(["parse"]) });
  }
}

/** File the plan. A record that would not pass its own read is not written. */
export function writePlanState(storage, record) {
  if (!record || !validatePlanState(record).ok) return Object.freeze({ ok: false, code: "not_saved" });
  try {
    storage?.setItem?.(PLAN_STATE_KEY, JSON.stringify(record));
    return Object.freeze({ ok: readPlanState(storage).status === "restored", code: "filed" });
  } catch {
    return Object.freeze({ ok: false, code: "not_saved" });
  }
}

/** Forget the plan. A store that refuses is reported, never thrown from. */
export function clearPlanState(storage) {
  try {
    storage?.removeItem?.(PLAN_STATE_KEY);
    return Object.freeze({ ok: true });
  } catch {
    return Object.freeze({ ok: false });
  }
}

/**
 * Whether a filed plan still stands on the figures it was filed against, and —
 * when it does not — which of the two moved, said in the page's own terms.
 *
 * With no fingerprints to compare against (a caller that supplies none), nothing
 * is claimed to have changed. Silence is not evidence of a change.
 */
export function planStaleness(record, fingerprints = null) {
  if (!record || !fingerprints) {
    return Object.freeze({ stale: false, changed: Object.freeze([]), notice: "" });
  }
  const changed = [];
  if (record.analysisFingerprint !== String(fingerprints.analysis ?? "")) changed.push("analysis");
  if (record.rateCardFingerprint !== String(fingerprints.rateCard ?? "")) changed.push("rateCard");
  if (!changed.length) {
    return Object.freeze({ stale: false, changed: Object.freeze([]), notice: "" });
  }
  const what = changed.map((key) => CHANGED_PHRASE[key]).join(", and ");
  return Object.freeze({
    stale: true,
    changed: Object.freeze(changed),
    notice: `You filed this plan earlier in this browser, and ${what} since. The moves and `
      + "scopes below are the ones you filed. The total beside them is worked out on today's "
      + "figures, so it is not the total you filed.",
  });
}
