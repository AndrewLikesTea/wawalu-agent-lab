// The count a browser that has never been here still has.
//
// WHAT WAS BROKEN. Both surfaces that show the counted merged-pull-request
// figure could only ever get a number from two places, and a first-time visitor
// has neither: the live GitHub request, which is unauthenticated and routinely
// rate-limited, and this browser's own retained count, which a browser that has
// never loaded this site does not have. A cold arrival with a failing or slow
// request therefore met "…so there is no count to show." on the home page and
// "Loading…" on the observatory — the site's one checkable number, missing, on
// the one visit where it is doing all the work.
//
// WHAT THIS IS. A third source, committed to the repository and shipped inside
// the document's own module graph, exactly like ./build-stamp.js. It is a
// STATIC IMPORT on purpose: no fetch, no localStorage, no same-origin file to
// read. Nothing has to answer for it to be on screen, so it is available in the
// very first paint, and it is available identically to every browser.
//
// WHERE THE NUMBER CAME FROM, AND WHAT IT IS NOT. It is a count, taken by hand
// from the same two public event feeds the page requests — the URLs in
// ./public-merges.js — with the same merge rule the page counts by, at the
// instant recorded in `takenAt` (GitHub's own `Date` header on those responses).
// It is not an estimate, not a projection, not a round number, and not a
// placeholder. Nothing in the browser writes it. When it goes stale, the way to
// move it is to take the count again and commit the new one, with its new
// timestamp — that is what `npm run record:merged-count` does for the published
// record, and this file is the same value with no request in front of it.
//
// The events endpoint returns a window of recent activity rather than a
// repository's whole history, so this is a count of the merges in that window
// and the page says so in the same words it uses for every other earlier count.
import { mostRecentRecord, parseCountRecord } from "./merged-count-retention.js";

/** Bumped when the shape below changes, so an old reader simply does not read it. */
export const BASELINE_SCHEMA = 1;

/**
 * The committed count, its per-repository breakdown, and when it was taken.
 *
 * `count` is the total and `repositories` is what that total is made of; a test
 * pins the two together, so a breakdown edited without its total (or the other
 * way round) fails rather than shipping a sum that is nobody's count.
 */
export const MERGED_COUNT_BASELINE = Object.freeze({
  schemaVersion: BASELINE_SCHEMA,
  count: 3,
  repositories: Object.freeze({
    "AndrewLikesTea/paint-lab": 2,
    "AndrewLikesTea/wawalu-agent-lab": 1,
  }),
  takenAt: "2026-08-17T07:33:11.000Z",
});

/**
 * A count record from anything that carries `count` and a moment, or `null`.
 *
 * The three sources this module reconciles hand their moment over in two
 * shapes — a `Date` from a response or a browser store, an ISO string from a
 * committed record — and neither is more trustworthy than the other, so both
 * are accepted and both are held to the one rule in ./merged-count-retention.js:
 * a whole non-negative count AND a timestamp that parses. Half of that is not a
 * record.
 */
export function asCountRecord(value) {
  if (!value) return null;
  const takenAt = value.takenAt ?? value.asOf ?? null;
  if (takenAt instanceof Date) {
    return parseCountRecord({ count: value.count, takenAt: Number.isNaN(takenAt.getTime()) ? null : takenAt.toISOString() });
  }
  return parseCountRecord({ count: value.count, takenAt });
}

/** The committed baseline as a record, or `null` if it was edited into nonsense. */
export const BASELINE_RECORD = asCountRecord(MERGED_COUNT_BASELINE);

/**
 * The one number both surfaces show, and where it came from.
 *
 * ONE ORDERED RULE, one place. A live count wins outright: it is this response,
 * and nothing older can be truer than it. Otherwise the most recently counted of
 * the two earlier sources wins — this browser's retained count and the committed
 * baseline, COMPARED BY TIMESTAMP AND NOT BY ORIGIN, because a browser that last
 * got an answer months ago holds an older number than a baseline committed last
 * week, and the older number is the wrong one to show. The baseline alone is
 * what is left for a browser that has never had an answer, which is the arrival
 * this exists for.
 *
 * Returns `{ count, takenAt, source }` with `source` "live" or "earlier", or
 * `null` when all three inputs are missing or unusable — the state where the
 * page has no number at all, which it still knows how to say in words. It never
 * returns two numbers: the caller renders this record or it renders no digit.
 */
export function resolveMergedCount({ live = null, cached = null, baseline = BASELINE_RECORD } = {}) {
  const liveRecord = asCountRecord(live);
  if (liveRecord) return { ...liveRecord, source: "live" };
  const earlier = mostRecentRecord(asCountRecord(cached), asCountRecord(baseline));
  return earlier ? { ...earlier, source: "earlier" } : null;
}
