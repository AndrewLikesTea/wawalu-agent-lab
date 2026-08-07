// The committed plan, carried inside the shared-brief envelope (#1291).
//
// THE PROBLEM THIS SOLVES. A shared brief carries a DIAGNOSIS: how much of the
// sender's spend is recoverable, where to start, and how far to trust it. What a
// recipient cannot see is the thing the sender actually decided — which moves
// they committed to, at what scope, and what that adds up to. Without it a
// recipient reads $31,415 recoverable and has no way to tell a plan that commits
// most of it from a plan that commits none of it, and both look identical.
//
// THIS IS NOT A SECOND PAYLOAD FORMAT. There is exactly one envelope,
// `finops-brief-envelope.js`, and this is an OPTIONAL block on it: `plan`. The
// envelope's schema version does not move, because every field the existing
// contract requires is unchanged and every reader that predates this block drops
// it the way it drops any key it was not promised — the envelope rebuilds field
// by field and never spreads. An old build therefore opens a new brief and
// renders the analysis, which is the "no committed plan" state, correctly.
//
// ABSENCE IS THE SIGNAL. A sender with no committed move writes NO `plan` key.
// There is no empty block, no zeroed total and no `committed: false` flag: a plan
// nobody made and a plan of zero dollars are different claims, and `plan-scope.js`
// already refuses to conflate them.
//
// ---------------------------------------------------------------------------
// THE SCHEMA. Field names, types, units, and what is required.
// ---------------------------------------------------------------------------
//
//   plan.v                 integer, required. This block's own version, 1.
//   plan.planVersion       string, required. `PLAN_SCOPE_VERSION` — which build's
//                          definition of "planned savings" produced the total.
//   plan.currency          string, required, and exactly "USD". The planning
//                          surface computes in US dollars and formats with one
//                          formatter; a second currency here would be a claim
//                          nothing on that surface can make.
//   plan.plannedMonthlyUsd number, required. WHOLE US DOLLARS PER MONTH — not
//                          minor units, unlike `figure.valueMinor` on the
//                          envelope around it, because `plan-scope.js` truncates
//                          each move's contribution to whole dollars before it
//                          sums them. A reader comparing the two converts, and
//                          the recipient view does exactly that, in one place.
//   plan.grade             object, required: `{ tier, marker, label }`, and the
//                          triple must be one of `CONFIDENCE_TIERS` verbatim.
//                          That is the ladder the planning surface grades with;
//                          an unknown triple is refused rather than shown.
//   plan.committedCount    integer, required, >= 1, and equal to `moves.length`.
//   plan.moves             array, required, 1..MAX_BRIEF_PLAN_MOVES entries.
//     move.id              string, required. `planMoveKey()`'s own key — the
//                          stable identifier both sides of the planning surface
//                          already derive, never a new one coined here.
//     move.name            string, required. `moveName()`'s display name.
//     move.plannedMonthlyUsd  number, required, whole US dollars per month. This
//                          move's contribution to the total.
//     move.scope           array, required, EXACTLY the three `PLAN_LEVERS` keys
//                          in the order that module declares them, each entry
//                          `{ key, stated, value }`: which scope facts the sender
//                          stated, and the number they stated. `stated: false`
//                          with `value: 0` is silence carrying its documented
//                          default, not a stated zero.
//   plan.excluded          array, required, possibly empty. Per committed move
//                          that stated exclusions: `{ move, name, workloads }`,
//                          `workloads` being the COUNT the sender stated.
//   plan.refused           array, required, possibly empty. Per committed move a
//                          team refused: `{ move, name, team }`, `team` being the
//                          move's own org unit — `plan-scope-levers.js` states
//                          that a slate rule names exactly one, so that unit IS
//                          the team with the standing to refuse it.
//
// WHAT DELIBERATELY DOES NOT TRAVEL, and why. The NAMES a lead typed into the
// excluded-workloads field. They are free text entered by a person, a brief is a
// file that gets forwarded, and a workload name is the one field on this surface
// that can carry a customer's name. `plan-scope.js`'s own model does not keep
// them either — it keeps counts — so what travels is the count each move stated,
// which is what the shipped grade requirement actually turns on. Also absent: any
// rate card (the envelope already carries `rateBasis`), any owner's name, any
// model output, and any credential-shaped key. The serializer below constructs
// every field by name from the plan model; it spreads nothing and JSON-copies
// nothing, so a key nobody wrote here cannot appear in a payload.
//
// SIZE CEILING. `MAX_BRIEF_PLAN_BYTES`, measured on the block's own serialized
// bytes. A link's whole token has a ceiling of its own already; this one bounds
// the part a recipient must validate before it can render anything, and it is
// refused as OVER LENGTH rather than as corrupt so a reader knows the difference.
//
// ALL OR NOTHING, AND NEVER THE WHOLE BRIEF. A malformed or oversized block is
// refused ENTIRE — no partial plan, no rendered subtotal — but the refusal is
// scoped to the block: the brief still opens and the analysis still renders. The
// two failures are named separately in `BRIEF_PLAN_REASON` because "too large"
// and "corrupt" send a reader to two different remedies.
//
// PURE. No DOM, no clock, no storage, no network, no randomness.

import { CONFIDENCE_TIERS } from "./finops-rate-card-contract.js";
import { scanRetainedContent } from "./finops-workspace.js";
import { PLAN_LEVERS, PLAN_SCOPE_VERSION, moveName, planMoveKey } from "./plan-scope.js";

/** The envelope key this block travels under. Optional on every schema. */
export const BRIEF_PLAN_FIELD = "plan";

/** The block's own version. Bump when a field, unit or meaning changes. */
export const BRIEF_PLAN_SCHEMA = 1;

/** The currency the planning surface computes in, and the only one accepted. */
export const BRIEF_PLAN_CURRENCY = "USD";

/** The block's required fields, in the order the contract states them above. */
export const BRIEF_PLAN_FIELDS = Object.freeze([
  "v", "planVersion", "currency", "plannedMonthlyUsd", "grade", "committedCount", "moves",
  "excluded", "refused",
]);

/** One move's required fields. */
export const BRIEF_PLAN_MOVE_FIELDS = Object.freeze([
  "id", "name", "plannedMonthlyUsd", "scope",
]);

/**
 * The scope vocabulary, taken from the planning surface rather than restated:
 * the same three lever keys, in the same order, so a recipient reading a scope
 * entry and a lead moving a lever are talking about one thing.
 */
export const BRIEF_PLAN_SCOPE_KEYS = Object.freeze(PLAN_LEVERS.map((lever) => lever.key));

/** The lever names, keyed, so a recipient can say what a scope entry IS. */
const LEVER_NAMES = Object.freeze(Object.fromEntries(
  PLAN_LEVERS.map((lever) => [lever.key, lever.name])));

/** Every grade a plan block may declare: the shipped ladder, and nothing else. */
export const BRIEF_PLAN_GRADES = CONFIDENCE_TIERS;

/** How many committed moves one block may carry. The slate ranks far fewer. */
export const MAX_BRIEF_PLAN_MOVES = 12;

/**
 * The ceiling on the block's own serialized bytes.
 *
 * Twelve moves of this shape serialize to roughly 2.5 KB, so this is headroom
 * over the largest plan the surface can produce rather than a limit a real plan
 * meets. It exists to bound what a recipient validates before rendering, and to
 * give a hand-made or foreign block a named refusal instead of a slow page.
 */
export const MAX_BRIEF_PLAN_BYTES = 4096;

/** Every way a plan block fails to travel. A closed set; each has its own copy. */
export const BRIEF_PLAN_REASON = Object.freeze({
  absent: "no_committed_plan",
  malformed: "plan_block_malformed",
  oversize: "plan_block_over_ceiling",
});

/**
 * What each state says. The absent one is NOT an error and is worded as the
 * ordinary fact it is; the two refusals say what is true of the block, what that
 * means for this page, and the one thing the reader can do.
 */
export const BRIEF_PLAN_COPY = Object.freeze({
  [BRIEF_PLAN_REASON.absent]: Object.freeze({
    summary: "The sender shared an analysis without a committed plan",
    statement: "This brief carries the analysis above and no plan block: at the moment they shared "
      + "it, the sender had committed to no move at any scope. That is a normal state, not a "
      + "failure to read the file.",
    remedy: "Nothing is missing from what you were sent. Ask the sender which moves they intend to "
      + "commit, and at what share, if you need a planned figure.",
  }),
  [BRIEF_PLAN_REASON.malformed]: Object.freeze({
    summary: "The committed plan in this brief could not be read",
    statement: "The brief carries a plan block, but it is not the shape this build reads — a "
      + "required field is missing, a total is not a number, a grade is not one this page knows, or "
      + "a move does not state its scope.",
    remedy: "No planned figure is shown, because half a plan reads like a smaller plan. The rest of "
      + "the brief above is unaffected. Ask the sender to export it again.",
  }),
  [BRIEF_PLAN_REASON.oversize]: Object.freeze({
    summary: "The committed plan in this brief is too large to read",
    statement: `The plan block is longer than the ${MAX_BRIEF_PLAN_BYTES} bytes this build reads, so `
      + "it was refused whole rather than read in part. It is oversized, not corrupt: what is in it "
      + "may be perfectly correct, and there is simply more of it than this page accepts.",
    remedy: "No planned figure is shown and the rest of the brief above is unaffected. Ask the "
      + "sender to share a plan with fewer committed moves.",
  }),
});

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** A non-empty string, or null. Never a number coerced, never an object stringified. */
const readText = (value) => (typeof value === "string" && value.trim() !== "" ? value : null);

/** A whole, finite, non-negative count of dollars or of things. Nothing else. */
const readWhole = (value) => (typeof value === "number" && Number.isFinite(value)
  && Number.isInteger(value) && value >= 0 ? value : null);

/** Is this triple one of the shipped grades, field for field? */
const knownGrade = (grade) => BRIEF_PLAN_GRADES.some((tier) => tier.tier === grade?.tier
  && tier.marker === grade?.marker && tier.label === grade?.label);

/** Bytes of the block as it will travel. Keys sorted, so the count is stable. */
export function briefPlanBytes(block) {
  const sort = (key, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const sorted = {};
    for (const name of Object.keys(value).sort()) sorted[name] = value[name];
    return sorted;
  };
  try {
    return new TextEncoder().encode(JSON.stringify(block, sort)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const refusal = (reason) => Object.freeze({
  ok: false,
  reason,
  plan: null,
  block: null,
  notice: Object.freeze({ reason, ...BRIEF_PLAN_COPY[reason] }),
});

/** One lever's state on one move, copied out by name from the plan model. */
function projectScope(move) {
  return BRIEF_PLAN_SCOPE_KEYS.map((key) => {
    const lever = (move?.levers ?? []).find((entry) => entry?.key === key) ?? null;
    return {
      key,
      stated: lever?.stated === true,
      value: readWhole(lever?.value) ?? 0,
    };
  });
}

/**
 * Build the block for one plan model.
 *
 * FIELD BY FIELD, never spread and never JSON-copied. The argument is
 * `planScope()`'s frozen model, and a caller that hands over a polluted plan
 * state — an extra key that looks like a credential, a stray note, anything —
 * cannot get it into the payload, because nothing here reads a key it does not
 * name. `tests/finops-brief-plan.test.js` asserts that with a polluted model.
 *
 * @param model `planScope()`'s own model, or null when the page has no plan.
 * @returns `{ ok, reason, block, notice }`, frozen. `ok: false` with reason
 *   `absent` is the ordinary "nothing committed" answer, and the caller writes
 *   NO key at all for it.
 */
export function buildBriefPlanBlock(model) {
  const moves = (model?.moves ?? []).filter((move) => move?.committed === true);
  if (moves.length === 0) return refusal(BRIEF_PLAN_REASON.absent);

  const named = moves.map((move) => ({
    // Derived here from the slate's own fields rather than read off the model, so
    // the identifier in a payload is the one the planning surface computes and
    // cannot be something a caller attached to the object.
    id: planMoveKey(move),
    name: moveName(move),
    plannedMonthlyUsd: readWhole(move.plannedMonthlyUsd) ?? 0,
    scope: projectScope(move),
    // Not part of the block: kept only to compose the two lists below.
    unit: readText(move.unit),
  }));

  const block = {
    v: BRIEF_PLAN_SCHEMA,
    planVersion: readText(model?.version) ?? PLAN_SCOPE_VERSION,
    currency: BRIEF_PLAN_CURRENCY,
    plannedMonthlyUsd: readWhole(model?.plannedMonthlyUsd) ?? 0,
    grade: knownGrade(model?.grade)
      ? { tier: model.grade.tier, marker: model.grade.marker, label: model.grade.label }
      : null,
    committedCount: named.length,
    moves: named.map((move) => ({
      id: move.id,
      name: move.name,
      plannedMonthlyUsd: move.plannedMonthlyUsd,
      scope: move.scope.map((entry) => ({ ...entry })),
    })),
    excluded: named
      .filter((move) => scopeValue(move.scope, "excludedWorkloads") > 0)
      .map((move) => ({
        move: move.id, name: move.name, workloads: scopeValue(move.scope, "excludedWorkloads"),
      })),
    refused: named
      .filter((move) => scopeValue(move.scope, "refusingTeams") > 0)
      .map((move) => ({ move: move.id, name: move.name, team: move.unit ?? move.id })),
  };

  // Built and then read back through the READER'S own validator rather than
  // trusted because this module wrote it. A producer that can emit a block its
  // own reader refuses is the defect, and it belongs on the sender's side.
  const read = readBriefPlanBlock(block);
  if (!read.ok) return refusal(read.reason);
  return Object.freeze({ ok: true, reason: "planned", block, notice: null });
}

/** A stated lever value on a projected scope, or 0 when it was not stated. */
function scopeValue(scope, key) {
  const entry = scope.find((item) => item.key === key);
  return entry?.stated === true ? entry.value : 0;
}

/** One supplied scope array, or null when it is not exactly the three levers. */
function readScope(value) {
  if (!Array.isArray(value) || value.length !== BRIEF_PLAN_SCOPE_KEYS.length) return null;
  const scope = [];
  for (const [index, key] of BRIEF_PLAN_SCOPE_KEYS.entries()) {
    const entry = value[index];
    if (!isPlainObject(entry) || entry.key !== key) return null;
    if (typeof entry.stated !== "boolean") return null;
    const amount = readWhole(entry.value);
    if (amount === null) return null;
    scope.push(Object.freeze({ key, name: LEVER_NAMES[key], stated: entry.stated, value: amount }));
  }
  return Object.freeze(scope);
}

/** One supplied move, or null. Every field copied out by name. */
function readMove(value) {
  if (!isPlainObject(value)) return null;
  for (const field of BRIEF_PLAN_MOVE_FIELDS) {
    if (!Object.hasOwn(value, field)) return null;
  }
  const id = readText(value.id);
  const name = readText(value.name);
  const planned = readWhole(value.plannedMonthlyUsd);
  const scope = readScope(value.scope);
  if (id === null || name === null || planned === null || scope === null) return null;
  return Object.freeze({ id, name, plannedMonthlyUsd: planned, scope });
}

/** One supplied `{ move, name, count-or-team }` row, or null. */
function readRow(value, field, read) {
  if (!isPlainObject(value)) return null;
  const move = readText(value.move);
  const name = readText(value.name);
  const extra = read(value[field]);
  if (move === null || name === null || extra === null) return null;
  return Object.freeze({ move, name, [field]: extra });
}

/**
 * Read a supplied plan block into the contract's own projection.
 *
 * TOTAL, and it never throws. The verdict is for the WHOLE block: a caller gets
 * either every field or none, and the returned plan is a fresh frozen object
 * built key by key, so an unknown key on a hostile file reaches no renderer.
 *
 * @param value whatever sat under `plan` on a supplied envelope — including
 *   `undefined`, which is the ordinary "no committed plan" answer.
 * @returns `{ ok, reason, plan, notice }`, frozen. `notice` is always present and
 *   always says which of the three states this is, so a view has one thing to
 *   render rather than an absence to interpret.
 */
export function readBriefPlanBlock(value) {
  if (value === undefined || value === null) return refusal(BRIEF_PLAN_REASON.absent);
  if (!isPlainObject(value)) return refusal(BRIEF_PLAN_REASON.malformed);
  // Size before shape: a block too large to read is refused as too large, and a
  // reader is told that rather than being sent looking for a corrupt field.
  if (briefPlanBytes(value) > MAX_BRIEF_PLAN_BYTES) return refusal(BRIEF_PLAN_REASON.oversize);
  for (const field of BRIEF_PLAN_FIELDS) {
    if (!Object.hasOwn(value, field)) return refusal(BRIEF_PLAN_REASON.malformed);
  }
  if (value.v !== BRIEF_PLAN_SCHEMA) return refusal(BRIEF_PLAN_REASON.malformed);
  if (value.currency !== BRIEF_PLAN_CURRENCY) return refusal(BRIEF_PLAN_REASON.malformed);
  const planVersion = readText(value.planVersion);
  const planned = readWhole(value.plannedMonthlyUsd);
  if (planVersion === null || planned === null) return refusal(BRIEF_PLAN_REASON.malformed);
  if (!knownGrade(value.grade)) return refusal(BRIEF_PLAN_REASON.malformed);
  if (!Array.isArray(value.moves) || value.moves.length === 0) {
    return refusal(BRIEF_PLAN_REASON.malformed);
  }
  if (value.moves.length > MAX_BRIEF_PLAN_MOVES) return refusal(BRIEF_PLAN_REASON.oversize);
  const moves = value.moves.map(readMove);
  if (moves.some((move) => move === null)) return refusal(BRIEF_PLAN_REASON.malformed);
  if (readWhole(value.committedCount) !== moves.length) return refusal(BRIEF_PLAN_REASON.malformed);
  // The one arithmetic check: the parts must add up to the total they are shown
  // beside. A block whose moves sum to something else is not a weaker plan, it is
  // an unreadable one — and rendering it would put a total on screen that no row
  // under it accounts for.
  if (moves.reduce((sum, move) => sum + move.plannedMonthlyUsd, 0) !== planned) {
    return refusal(BRIEF_PLAN_REASON.malformed);
  }
  if (!Array.isArray(value.excluded) || !Array.isArray(value.refused)) {
    return refusal(BRIEF_PLAN_REASON.malformed);
  }
  const excluded = value.excluded.map((row) => readRow(row, "workloads", readWhole));
  const refused = value.refused.map((row) => readRow(row, "team", readText));
  if (excluded.some((row) => row === null) || refused.some((row) => row === null)) {
    return refusal(BRIEF_PLAN_REASON.malformed);
  }
  // The same content scan this repository holds its own retained records to, run
  // over somebody else's block: a credential-shaped key or an address-shaped
  // value is refused here rather than rendered beside a colleague's money.
  if (!scanRetainedContent(value, BRIEF_PLAN_FIELD).ok) return refusal(BRIEF_PLAN_REASON.malformed);

  return Object.freeze({
    ok: true,
    reason: "planned",
    plan: Object.freeze({
      v: value.v,
      planVersion,
      currency: value.currency,
      plannedMonthlyUsd: planned,
      grade: Object.freeze({
        tier: value.grade.tier, marker: value.grade.marker, label: value.grade.label,
      }),
      committedCount: moves.length,
      moves: Object.freeze(moves),
      excluded: Object.freeze(excluded),
      refused: Object.freeze(refused),
    }),
    notice: null,
  });
}
