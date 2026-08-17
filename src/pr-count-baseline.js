// The counted figure a browser that has never been here still gets.
//
// WHY THIS FILE EXISTS. The site's one non-invented number is counted in the
// reader's own browser from the public GitHub events feeds, unauthenticated. A
// first-time visitor is routinely rate-limited, has nothing in local storage,
// and until now met a sentence where the proof was supposed to be. This record
// is the floor under that: it ships inside the JavaScript bundle, so it costs no
// request, cannot be rate-limited, and is already on screen before the live
// request resolves.
//
// WHAT IT IS ALLOWED TO CONTAIN. A count somebody actually took from the two
// public feeds this site links to, and the instant they took it. Nothing here is
// estimated, extrapolated, rounded, or carried forward from a previous value: if
// a fresh count cannot be taken, this file is left exactly as it is rather than
// updated with a guess. That is what makes the date rendered beside the figure
// mean what it says, and it is the same rule scripts/record-merged-count.mjs is
// held to for the published record it writes.
//
// HOW THE NUMBERS BELOW WERE TAKEN. Both feeds were requested at `countedAt`:
//
//   https://api.github.com/repos/AndrewLikesTea/paint-lab/events?per_page=30
//   https://api.github.com/repos/AndrewLikesTea/wawalu-agent-lab/events?per_page=30
//
// and the merges in each response were counted with the same rule the page
// counts with — a PullRequestEvent GitHub reported as merged. `total` is the sum
// of the per-repository counts and is never typed independently of them; a test
// re-adds it, so a hand-edited total reds the suite rather than shipping.
//
// THE SCOPE IS A WINDOW, NOT A HISTORY. The events endpoint returns recent
// events, so each per-repository count is the merges among that repository's
// `eventsPerFeed` most recent public events at that instant — not every pull
// request the repository has ever merged. A reader who opens the feeds later
// sees a different window, which is why the figure is always rendered with the
// moment it was taken rather than as a standing total.
//
// REFRESHING IT is a deliberate, manual edit: re-request both feeds, count the
// merges, and replace all four fields together. There is no build step that
// writes this file, because a build must not depend on a third-party API.

/** The version of this record's shape. Bumped when a field changes meaning. */
export const PR_COUNT_BASELINE_SCHEMA = 1;

export const PR_COUNT_BASELINE = Object.freeze({
  schemaVersion: PR_COUNT_BASELINE_SCHEMA,
  // How many of each feed's most recent events the counts below were taken over.
  eventsPerFeed: 30,
  // Merged pull requests per repository, keyed by the repository the feed
  // belongs to, so a reader checking one feed can check one number.
  repositories: Object.freeze({
    "AndrewLikesTea/paint-lab": 2,
    "AndrewLikesTea/wawalu-agent-lab": 2,
  }),
  total: 4,
  // ISO-8601, UTC, from the `Date` header GitHub stamped the responses with.
  countedAt: "2026-08-17T08:22:59.000Z",
});

/**
 * The baseline as a dated count record, or `null` if it was never populated.
 *
 * The same two halves every other figure on this site is held to — a whole
 * non-negative count and an instant that parses — because a number the page
 * cannot date is a number it may not show. An unpopulated baseline is `null`
 * rather than a zero: zero is a real answer GitHub can give about merges, and
 * "nobody has counted yet" is not that answer.
 */
export function baselineCountRecord(baseline = PR_COUNT_BASELINE) {
  const count = baseline?.total;
  if (!Number.isInteger(count) || count < 0) return null;
  if (typeof baseline?.countedAt !== "string") return null;
  const takenAt = new Date(baseline.countedAt);
  return Number.isNaN(takenAt.getTime()) ? null : { count, takenAt };
}
