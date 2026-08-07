// Browser-local memory for exactly one committed plan, so a reload does not
// discard what a lead filed (#1290).
//
// WHAT IS KEPT, and nothing beyond it: the move key of each committed move, the
// three scope answers the lead typed for it (share, excluded workloads, refusal),
// the dollars that were filed for it, and two fingerprints — one over the
// analysis the plan was filed against, one over the rate card that priced it.
// A schema version rides along so a later shape change is DETECTED rather than
// misread as a valid record.
//
// WHAT IS NOT KEPT: no credential, no customer row, no prompt text, no provider
// payload, no free-text analysis output, no headline, no confidence claim and no
// clock reading. There is no field for any of them here: `projectPlanRecord()`
// enumerates every key it writes, so the record cannot pick up a field by being
// handed a bigger object than it asked for.
//
// THE FINGERPRINTS ARE DERIVED, NOT FETCHED. Both are FNV-1a digests, taken by
// `sourceFingerprint()` — the page's own digest, already shipped — over values
// the page has already rendered: the slate's own moves and their modelled
// dollars, and the resolved rate card's per-model rates. Nothing is requested to
// compute them. They are one-way and short: they say "this is a different
// analysis" and cannot be turned back into the analysis.
//
// IT RESTORES, IT DOES NOT RE-PRICE. `filedPlan()` overlays the dollars that
// were filed onto today's model, so a restored plan shows the figures the lead
// actually committed to rather than what those moves would be worth now. Which
// of the two a reader is looking at is stated on the page by the staleness
// notice, not inferred.
//
// PURE, apart from the two storage calls, both of which are total: a browser
// with storage disabled throws on the accessor itself, so every entry point here
// treats a throw as "no plan", never as an exception for the load path to carry.

import { resolveRateCard } from "./finops-rate-card-contract.js";
import { sourceFingerprint } from "./finops-workspace.js";
import { PLAN_SCOPE_VERSION, planMoveKey } from "./plan-scope.js";

/** One versioned key. A shape change takes a new key or a new schema version. */
export const PLAN_SCOPE_KEY = "shiplog.finops.plan-scope.v1";

/** The record shape. Bump when a field is added, removed or re-meant. */
export const PLAN_SCOPE_RECORD_VERSION = "finops-plan-scope/1.0.0";

/** A plan with more committed moves than this is not a plan; it is a corruption. */
export const MAX_FILED_MOVES = 50;

/** How long a typed scope answer may be before the record is refused. */
export const MAX_SCOPE_TEXT = 500;

/** What a read of the store found. `missing` is the ordinary first visit. */
export const PLAN_READ = Object.freeze({
  restored: "restored",
  missing: "missing",
  unreadable: "unreadable",
});

/**
 * Said when a stored plan was found and could not be trusted. It states the
 * fact, what was done about it, and where that leaves the reader — a message
 * that only says "error" leaves them wondering whether their plan is still there.
 */
export const PLAN_UNREADABLE_MESSAGE =
  "A saved plan could not be read from this browser, so this plan starts empty. What was "
  + "stored has been discarded rather than partly restored; file the plan again to keep it.";

/** The one prioritized action on the staleness notice. */
export const PLAN_RECOMPUTE_LABEL = "Recompute this plan against today's analysis";

/** The other option: leave the filed numbers exactly as they are. */
export const PLAN_KEEP_FILED_LABEL = "Keep the plan as filed";

/** The way out of the store, from the page. */
export const PLAN_CLEAR_LABEL = "Clear this plan from this browser";

/** What each changed input is called on screen. No new word for "stale". */
const CHANGED_NAMES = Object.freeze({
  analysis: "The analysis",
  rateCard: "The rate card",
  both: "The analysis and the rate card",
});

/**
 * The notice, naming the input that changed rather than a coined status word.
 * The second sentence is the part that matters operationally: it says which of
 * two possible sets of numbers the reader is looking at.
 */
export function stalenessNotice(changed = []) {
  if (!changed.length) return "";
  const subject = changed.length === 2 ? CHANGED_NAMES.both : CHANGED_NAMES[changed[0]];
  const verb = changed.length === 2 ? "have both changed" : "has changed";
  return `${subject} ${verb} since this plan was filed. The moves, scopes and total below are `
    + "the ones that were filed, not what they would be worth against today's figures.";
}

/**
 * A digest of the moves this plan could be filed against, and what each was
 * modelled at. It changes exactly when a move appears, disappears, is re-ranked
 * or is re-priced — which is exactly when a filed dollar figure stops matching
 * the analysis on screen.
 */
export function analysisFingerprint(slate) {
  const rules = slate?.rules ?? [];
  return sourceFingerprint([
    String(rules.length),
    ...rules.map((rule) => `${planMoveKey(rule)}@${rule?.expectedMonthlyUsd}`),
  ]);
}

/**
 * A digest of the card the analysis was priced at, resolved the same way the
 * page resolves it — so an undeclared card fingerprints as the reference card
 * rather than as nothing, and declaring a card is therefore a CHANGE.
 */
export function rateCardFingerprint(card) {
  const resolved = resolveRateCard(card ?? null);
  const models = (resolved.card?.models ?? [])
    .map((entry) => [
      entry?.model, entry?.contractedInputRate, entry?.contractedOutputRate, entry?.currency,
      entry?.effectiveDate, entry?.committedUseDiscountPct, entry?.permitted,
    ].join(","))
    .sort();
  return sourceFingerprint([
    resolved.declared ? "declared" : "reference",
    String(resolved.cardId ?? ""),
    ...models,
  ]);
}

const FINGERPRINT = /^[0-9a-f]{8}$/;
const wholeUsd = (value) => Number.isInteger(value) && value >= 0;
const scopeText = (value) => typeof value === "string" && value.length <= MAX_SCOPE_TEXT;

function validateFiledMove(move, index, errors) {
  const at = `moves[${index}]`;
  if (!move || typeof move !== "object" || Array.isArray(move)) {
    errors.push(`${at}: expected an object`);
    return;
  }
  if (!scopeText(move.key) || move.key.length === 0) errors.push(`${at}.key: invalid`);
  if (move.sharePct !== null
    && !(Number.isInteger(move.sharePct) && move.sharePct >= 0 && move.sharePct <= 100)) {
    errors.push(`${at}.sharePct: invalid`);
  }
  if (!scopeText(move.excludedText)) errors.push(`${at}.excludedText: invalid`);
  if (typeof move.refuses !== "boolean") errors.push(`${at}.refuses: invalid`);
  if (!wholeUsd(move.plannedMonthlyUsd)) errors.push(`${at}.plannedMonthlyUsd: invalid`);
  if (!Number.isFinite(move.modelledMonthlyUsd) || move.modelledMonthlyUsd < 0) {
    errors.push(`${at}.modelledMonthlyUsd: invalid`);
  }
}

/**
 * The whole contract, in one place, so the writer and the reader cannot drift.
 * `planVersion` is checked too: the filed dollars mean what `plan-scope.js` said
 * they meant when they were filed, and a record written under a different
 * definition of "planned savings" is unreadable rather than merely old.
 */
export function validatePlanRecord(record) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return Object.freeze({ ok: false, errors: Object.freeze(["record: expected an object"]) });
  }
  if (record.schemaVersion !== PLAN_SCOPE_RECORD_VERSION) errors.push("schemaVersion: unsupported");
  if (record.planVersion !== PLAN_SCOPE_VERSION) errors.push("planVersion: unsupported");
  if (!FINGERPRINT.test(String(record.analysisFingerprint ?? ""))) {
    errors.push("analysisFingerprint: invalid");
  }
  if (!FINGERPRINT.test(String(record.rateCardFingerprint ?? ""))) {
    errors.push("rateCardFingerprint: invalid");
  }
  if (!wholeUsd(record.plannedMonthlyUsd)) errors.push("plannedMonthlyUsd: invalid");
  if (!Array.isArray(record.moves) || record.moves.length === 0
    || record.moves.length > MAX_FILED_MOVES) {
    errors.push("moves: invalid");
  } else {
    record.moves.forEach((move, index) => validateFiledMove(move, index, errors));
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

/**
 * Project what is on screen into the record, or null when there is nothing to
 * file. An empty plan is not stored as an empty record — the caller clears the
 * key instead, so "no plan" has exactly one representation in the store.
 */
export function projectPlanRecord({ model, scopes, analysis, rateCard }) {
  const moves = (model?.moves ?? [])
    .filter((move) => move.committed)
    .map((move) => {
      const scope = scopes?.get?.(move.key) ?? null;
      return {
        key: move.key,
        sharePct: Number.isInteger(scope?.sharePct) ? scope.sharePct : null,
        excludedText: String(scope?.excludedText ?? "").slice(0, MAX_SCOPE_TEXT),
        refuses: Boolean(scope?.refuses),
        plannedMonthlyUsd: move.plannedMonthlyUsd,
        modelledMonthlyUsd: move.modelledMonthlyUsd,
      };
    });
  if (!moves.length) return null;
  const record = {
    schemaVersion: PLAN_SCOPE_RECORD_VERSION,
    planVersion: PLAN_SCOPE_VERSION,
    analysisFingerprint: String(analysis ?? ""),
    rateCardFingerprint: String(rateCard ?? ""),
    plannedMonthlyUsd: model.plannedMonthlyUsd,
    moves,
  };
  return validatePlanRecord(record).ok ? Object.freeze(record) : null;
}

/**
 * Total read. Absent is `missing`; anything that will not parse, will not
 * validate, or was written at a shape this build does not know is `unreadable`
 * — one outcome, because the page's answer to all three is the same and a
 * reader is owed one sentence rather than three flavours of failure.
 */
export function readPlanRecord(storage) {
  try {
    const raw = storage?.getItem?.(PLAN_SCOPE_KEY) ?? null;
    if (raw === null) return Object.freeze({ status: PLAN_READ.missing, record: null });
    const record = JSON.parse(raw);
    const check = validatePlanRecord(record);
    if (!check.ok) {
      return Object.freeze({ status: PLAN_READ.unreadable, record: null, errors: check.errors });
    }
    return Object.freeze({ status: PLAN_READ.restored, record: Object.freeze(record) });
  } catch {
    return Object.freeze({ status: PLAN_READ.unreadable, record: null });
  }
}

/** Write, and say whether it took. A quota or a blocked store is a false, never a throw. */
export function writePlanRecord(storage, record) {
  if (!record) return false;
  try {
    storage?.setItem?.(PLAN_SCOPE_KEY, JSON.stringify(record));
    return readPlanRecord(storage).status === PLAN_READ.restored;
  } catch {
    return false;
  }
}

/** Remove it. Used by the clear control and by the corrupt-record path. */
export function clearPlanRecord(storage) {
  try {
    storage?.removeItem?.(PLAN_SCOPE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Which of the two inputs moved under the filed plan. Order is fixed —
 * analysis, then rate card — so the notice reads the same way every time.
 */
export function planStaleness(record, { analysis, rateCard } = {}) {
  const changed = [];
  if (record?.analysisFingerprint !== analysis) changed.push("analysis");
  if (record?.rateCardFingerprint !== rateCard) changed.push("rateCard");
  return Object.freeze({
    stale: changed.length > 0,
    changed: Object.freeze(changed),
    notice: stalenessNotice(changed),
  });
}

/** The filed record back in the lever shape, so the controls repaint as filed. */
export function restoredScopes(record) {
  const scopes = new Map();
  for (const move of record?.moves ?? []) {
    scopes.set(move.key, {
      inPlan: true,
      sharePct: move.sharePct,
      excludedText: move.excludedText,
      refuses: move.refuses,
    });
  }
  return scopes;
}

/**
 * Today's model wearing the dollars that were filed.
 *
 * Only the money is overlaid: the levers, the rationale and the grade still come
 * from `plan-scope.js` reading the restored scopes, which are the scopes that
 * were filed, so they agree by construction. A move the analysis no longer
 * carries has no row to overlay and simply is not shown — the total still says
 * what was filed, and the notice above it says the analysis changed.
 */
export function filedPlan(model, record) {
  if (!record) return model;
  const filed = new Map(record.moves.map((move) => [move.key, move]));
  const moves = model.moves.map((move) => {
    const entry = filed.get(move.key);
    if (!entry) return move;
    return Object.freeze({
      ...move,
      modelledMonthlyUsd: entry.modelledMonthlyUsd,
      plannedMonthlyUsd: entry.plannedMonthlyUsd,
    });
  });
  return Object.freeze({
    ...model,
    moves: Object.freeze(moves),
    plannedMonthlyUsd: record.plannedMonthlyUsd,
  });
}
