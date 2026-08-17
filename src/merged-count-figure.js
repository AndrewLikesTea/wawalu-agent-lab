// Which counted figure a surface shows, decided in one place for both of them.
//
// The home page's counted-figure block and the Agent observatory's headline
// figure are the same claim about the same number. They previously reached that
// claim through two different lists of sources — the observatory read the
// published record, the home page did not — so a cold visitor could be shown a
// dated number on one page and "there is no count to show" on the other. That is
// the defect this module exists to make unrepresentable: both surfaces pass the
// same sources to `resolveCountedFigure`, and neither of them decides anything
// about precedence on its own.
//
// PRECEDENCE IS TOTAL AND NOTHING IS MERGED. Exactly one source wins and the
// rest are not displayed:
//
//   live       what public GitHub returned during this page load
//   cached     the last count THIS browser saw GitHub return
//   published  the record served from this origin
//   baseline   the record compiled into the site at build time
//
// `published` and `baseline` are the same record by construction — one run of
// scripts/record-merged-count.mjs writes both, and a test asserts they are equal
// — so their order relative to each other cannot change what a reader sees. It
// is written down anyway, because a rule that holds by accident is not a rule.
//
// EVERY SOURCE IS SHAPE-GUARDED SEPARATELY, and a source that fails its guard is
// discarded rather than rendered: this is the module that must never let a digit
// nothing counted onto a page. A count of 0 is a real answer public GitHub can
// give, so presence and shape are what is tested here, never truthiness.
import { MERGED_COUNT_BASELINE } from "./merged-count-baseline.js";

/** The order one figure is chosen in. First usable source wins, outright. */
export const COUNTED_SOURCE_ORDER = Object.freeze(["live", "cached", "published", "baseline"]);

// The keys a record can carry its instant under: `asOf` is what a live response
// is read as, `takenAt` what storage and the published record hold, `countedAt`
// what the compiled baseline holds. One of them, parseable, is required.
const INSTANT_KEYS = Object.freeze(["asOf", "takenAt", "countedAt"]);

/**
 * A candidate as a figure, or `null`.
 *
 * Missing, not an object, a non-integer or negative count, no instant at all, or
 * an instant that does not parse — all of them are the same answer, and none of
 * them reaches a page.
 */
export function guardCountedRecord(candidate, source) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const { count } = candidate;
  if (!Number.isInteger(count) || count < 0) return null;
  const key = INSTANT_KEYS.find((name) => name in candidate);
  if (key === undefined) return null;
  const raw = candidate[key];
  const countedAt = raw instanceof Date ? raw : typeof raw === "string" ? new Date(raw) : null;
  if (countedAt === null || Number.isNaN(countedAt.getTime())) return null;
  return { count, countedAt, source };
}

/** The record compiled into this build, or `null` when nothing was ever counted. */
export const SHIPPED_BASELINE = guardCountedRecord(MERGED_COUNT_BASELINE, "baseline");

/**
 * The one figure to show, or `null` when no source has ever produced a count.
 *
 * `baseline` defaults to what this build shipped and is accepted explicitly so a
 * caller can say "in a build where nothing was ever recorded" by passing `null`,
 * which is a real configuration and not a test fixture.
 */
export function resolveCountedFigure({ baseline = SHIPPED_BASELINE, ...sources } = {}) {
  const candidates = { ...sources, baseline };
  for (const source of COUNTED_SOURCE_ORDER) {
    const figure = guardCountedRecord(candidates[source], source);
    if (figure) return figure;
  }
  return null;
}

/** The published record's path on this origin, which cannot be rate-limited. */
export const RECORDED_COUNT_URL = "/merged-pull-request-count.json";

/**
 * Read the published record. Never throws and never rejects: this is a path that
 * exists because another one failed, so its own failure is simply "no record".
 * Both surfaces read it, which is the half the home page used to be missing.
 */
export async function readRecordedCount(fetcher = fetch) {
  try {
    const response = await fetcher(RECORDED_COUNT_URL);
    if (!response?.ok) return null;
    return guardCountedRecord(await response.json(), "published");
  } catch {
    return null;
  }
}

/**
 * A resolved figure in the shape the two renderers already speak.
 *
 * They were written against `{count, takenAt}` records, and translating here
 * rather than at each call site is what keeps one figure from being reshaped two
 * ways on its way to two pages.
 */
export const asDatedRecord = (figure) => (figure ? { count: figure.count, takenAt: figure.countedAt } : null);
