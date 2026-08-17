// Which of the counts a page holds is the one it shows.
//
// Two surfaces render the merged-pull-request figure — the home page's
// counted-figure block and the Agent observatory's headline — and each of them
// can hold up to four counts at once: the live response, this browser's retained
// count, the record published with the site, and the baseline compiled into the
// bundle. Before this module the ordering was written out at each call site,
// which is how two pages come to disagree about one number.
//
// THE ORDER, ONCE, HERE:
//
//   live      the response this page load got. Undated by nothing: it carries
//             the moment it arrived, and it is the only count that may.
//   earlier   a real count taken before this page load — this browser's retained
//             count, or the published record the observatory fetches. Of those
//             two, the later one, because both are responses GitHub returned.
//   baseline  the count committed to the repository, for a browser that has
//             never had an answer from GitHub and cannot reach one now.
//
// EXACTLY ONE OF THEM RENDERS. This function returns one record, never a list,
// so a stale figure cannot be painted beside a live one as a second competing
// number: when the live count arrives it replaces what was there rather than
// joining it.
//
// AND EVERY ONE OF THEM IS DATED. A candidate is admitted only when it carries a
// whole non-negative count and an instant that parses; anything else is not a
// figure and falls to the next tier. `none` is a real outcome and the pages have
// words for it — it is what is left when even the baseline is unpopulated.
import { SOURCE_REPOSITORIES } from "./public-merges.js";
import { mostRecentRecord, parseCountRecord } from "./merged-count-retention.js";

/** The tier a rendered figure came from. One of these, or nothing. */
export const MERGED_COUNT_SOURCES = Object.freeze({
  live: "live",
  earlier: "earlier",
  baseline: "baseline",
  none: "none",
});

/** A candidate is a figure only when it carries both halves. */
const datedRecord = (record) => {
  if (!record) return null;
  const takenAt = record.takenAt ?? record.asOf;
  if (!Number.isInteger(record.count) || record.count < 0) return null;
  if (!(takenAt instanceof Date) || Number.isNaN(takenAt.getTime())) return null;
  return { count: record.count, takenAt };
};

/**
 * The one count a surface shows, and which tier it came from.
 *
 * Every candidate is passed in rather than read from a module-level default, so
 * a render given nothing renders nothing: the fallbacks are a decision the load
 * path makes out loud, not something that happens to a caller that forgot.
 */
export function resolveMergedCount({ live = null, retained = null, published = null, baseline = null } = {}) {
  const answered = datedRecord(live);
  if (answered) return { source: MERGED_COUNT_SOURCES.live, ...answered };
  // Both of these are counts GitHub returned, so neither outranks the other by
  // where it was kept; the later one is the truer one.
  const earlier = mostRecentRecord(datedRecord(retained), datedRecord(published));
  if (earlier) return { source: MERGED_COUNT_SOURCES.earlier, ...earlier };
  const committed = datedRecord(baseline);
  if (committed) return { source: MERGED_COUNT_SOURCES.baseline, ...committed };
  return { source: MERGED_COUNT_SOURCES.none, count: null, takenAt: null };
}

/** A published record, read through the one rule every stored figure is held to. */
export const parseBaselineRecord = parseCountRecord;

/**
 * The words in front of the baseline's date.
 *
 * It has to do three things in one clause a reader gets at a glance: say the
 * number is not live, say where it was counted, and hand over to the date. It is
 * plain text in the status region on both surfaces — never a badge, a tooltip,
 * or a disclosure — because a reader who cannot tell an earlier count from a
 * live one has been shown a number they cannot use.
 */
export const BASELINE_LEAD = "This is not a live count: it is the count published with this site, "
  + `taken from ${SOURCE_REPOSITORIES.join(" and ")}, as of `;
