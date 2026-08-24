// A deadline for a request whose worst failure is silence.
//
// `fetch` has no timeout. A stalled connection, a proxy that accepts and never
// answers, and a worker that hangs are all indistinguishable from "slow" at the
// call site, so a page waiting on one sits in its loading state for as long as
// the reader is willing to look at it. That is the defect issue #1774 fixed for
// the observatory's headline figure (MERGED_FIGURE_SETTLE_MS in src/agents.js),
// and the one Social and People still had: both pages ship a failed state with
// an in-place Retry, and a hung request is the one path that never reaches it.
//
// This invents no state. A read that runs out of time rejects, and the caller's
// existing failure path — the same one a 500 takes — paints the failed state and
// its Retry. One state machine, two ways in, nothing new to review.
//
// Deliberately not an AbortController: nothing here needs to reach into the
// transport, and a discarded response costs a page far less than a cancellation
// path nobody exercises. `Promise.race` attaches a rejection handler to both
// sides, so a request that fails after the deadline has already won is handled
// rather than surfacing as an unhandled rejection.

/**
 * How long a reader may be parked on a spinner before the page says something
 * true instead. The same number the observatory settles its figure on, so the
 * site has one answer rather than three, and comfortably inside the shortest
 * refresh interval any caller polls on (Social, 10s).
 */
export const REQUEST_DEADLINE_MS = 8_000;

export function withDeadline(request, { ms = REQUEST_DEADLINE_MS, message = "The request ran out of time." } = {}) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    // Never the reason a Node process or a test run stays alive.
    timer?.unref?.();
  });
  // Cleared on either outcome: a request that answered in time must not hold a
  // pending timer per poll for the rest of the session.
  return Promise.race([request, deadline]).finally(() => clearTimeout(timer));
}
