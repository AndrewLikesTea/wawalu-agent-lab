// The one number on this site that is not invented.
//
// Every other figure Shiplog shows belongs to a bundled synthetic example. This
// one is counted from the public GitHub events feed, and two surfaces show it:
// the Agent observatory's headline figure and the home page's counted-figure
// block. Two surfaces showing one number must not be able to disagree, so the
// feeds that are requested, what counts as a merge, when a response may be
// counted at all, and the words an unanswered request gets are all written here
// once. Neither page keeps a copy of any of it.
//
// It says "merged pull requests" because the response can actually tell a merge
// apart: a PullRequestEvent closed with `pull_request.merged === true` is a
// merge, and a close without it is not.
//
// The team now iterates on an external product (paint-lab); the lab repo still
// carries runner and process activity, so both surfaces watch both. The URLs are
// exported because the verification links beside each figure have to be the
// exact responses the count came from, rather than a string retyped next to it.
export const EVENTS_URLS = [
  "https://api.github.com/repos/AndrewLikesTea/paint-lab/events?per_page=30",
  "https://api.github.com/repos/AndrewLikesTea/wawalu-agent-lab/events?per_page=30",
];

/** The repositories the figure is counted from, read off the URLs we request. */
export const SOURCE_REPOSITORIES = EVENTS_URLS.map(
  (url) => new URL(url).pathname.split("/").slice(2, 4).join("/"),
);

// Persona, run, and representative-step records carry these keys; a GitHub event
// carries none of them. The observatory can reach synthetic records that were
// fetched rather than authored, so identity alone would not catch them.
const SYNTHETIC_RECORD_KEYS = ["persona", "prompt", "phase", "personaName", "scenarioTitle"];
const NOTHING_EXCLUDED = new Set();

/**
 * The records from a batch that are live public GitHub events.
 *
 * A countable record has to be an event GitHub sent — an object with an event
 * `type` and a `created_at` — and must be none of the synthetic material a
 * caller names in `excluded`. The home page reaches no synthetic records at all
 * and passes none; the observatory passes every one it can reach.
 */
export function liveGithubEvents(records = [], excluded = NOTHING_EXCLUDED) {
  const batch = Array.isArray(records) ? records : [];
  return batch.filter((record) => (
    record !== null && typeof record === "object"
    && !excluded.has(record)
    && !SYNTHETIC_RECORD_KEYS.some((key) => key in record)
    && typeof record.type === "string" && Boolean(record.created_at)
  ));
}

/** Merged pull requests among live public GitHub events. Merges only. */
export function countMergedPullRequests(records = [], excluded = NOTHING_EXCLUDED) {
  return liveGithubEvents(records, excluded).filter((event) => (
    event.type === "PullRequestEvent"
    && event.payload?.action === "closed"
    && event.payload?.pull_request?.merged === true
  )).length;
}

/** The words that go beside the digit, so one count is never two labels. */
export const mergedCountUnit = (count) => `merged pull ${count === 1 ? "request" : "requests"}`;

/**
 * The invitation beside one feed, in words that stand on their own.
 *
 * A screen-reader user tabbing a page's link list hears this with no sentence
 * before it, so it has to say both what there is to count and where — never
 * "check the count", whose subject is a paragraph the listener did not get.
 * Both surfaces spell their links this way: the home page builds them from
 * here, and a case in tests/homepage-public-merges.test.js pins the
 * observatory's typed anchors to the same words.
 */
export const feedLinkText = (repository) =>
  `Count the merged pull requests yourself in the ${repository} public GitHub event feed`;

/**
 * What the block counts, for the state where no count arrived.
 *
 * The unavailable sentence says only that there is no number, which leaves a
 * reader holding an absence. This says what the missing figure would have been
 * a count of, in which repositories, and that the feeds to count it in are
 * linked right here — so the block still hands over something checkable when
 * GitHub hands over nothing. IT CONTAINS NO DIGIT, for the reason the
 * unavailable reasons contain none.
 */
export const COUNTED_SUBJECT_SENTENCE = `This block counts merged pull requests in `
  + `${SOURCE_REPOSITORIES.join(" and ")}, and links the public GitHub event feeds it counts them from.`;

/**
 * When the response the figure was computed from arrived.
 *
 * GitHub stamps every response with its own `Date` header; when it is there,
 * that is the response's time and beats ours. `receivedAt` is read once on the
 * fetch path, the moment the responses resolved — never at render time, so a
 * repaint cannot quietly age the figure's provenance.
 */
export function responseTimestamp(responses = [], receivedAt) {
  for (const response of responses) {
    const stamped = new Date(response?.headers?.get?.("date") ?? NaN);
    if (!Number.isNaN(stamped.getTime())) return stamped;
  }
  return receivedAt;
}

/**
 * Request both feeds and return what GitHub actually said.
 *
 * Throws when GitHub did not answer, carrying the response status when there was
 * one, because "no answer" is a state both surfaces have to render rather than a
 * failure either of them may swallow into a number.
 */
export async function readPublicEvents(fetcher = fetch, excluded = NOTHING_EXCLUDED) {
  const responses = await Promise.all(EVENTS_URLS.map(
    (url) => fetcher(url, { headers: { Accept: "application/vnd.github+json" } }),
  ));
  // The moment this response arrived, taken once here rather than at render.
  const receivedAt = new Date();
  if (!responses.some((response) => response.ok)) {
    const failure = new Error(`GitHub returned ${responses[0].status}`);
    failure.status = responses[0].status;
    throw failure;
  }
  const payloads = await Promise.all(responses.map((response) => (response.ok ? response.json() : [])));
  const events = payloads
    .flatMap((payload) => (Array.isArray(payload) ? payload : []))
    .sort((a, b) => new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0))
    .slice(0, 30);
  return { events, countable: liveGithubEvents(events, excluded), asOf: responseTimestamp(responses, receivedAt) };
}

// Why a request produced no count, in the reader's terms rather than the
// transport's. Each one is a clause the sentence below completes, and NONE OF
// THEM CONTAINS A DIGIT: this is the state where the page has no number, and a
// status code or a retry count rendered where a figure belongs is a digit a
// reader can mistake for the answer.
export const UNAVAILABLE_REASONS = Object.freeze({
  pending: "Public GitHub has not answered yet",
  rateLimited: "Public GitHub is rate limiting this page's unauthenticated requests",
  errorStatus: "Public GitHub answered with an error rather than the event feed",
  malformed: "Public GitHub's response could not be read as event data",
  unreachable: "This page could not reach public GitHub",
  empty: "Public GitHub answered with no events to count",
  undated: "Public GitHub's response carried no time to date a count by",
});

/** The clause for a failure, chosen from what the failure actually was. */
export function unavailableReason(error) {
  const status = error?.status;
  if (status === 403 || status === 429) return UNAVAILABLE_REASONS.rateLimited;
  if (Number.isInteger(status)) return UNAVAILABLE_REASONS.errorStatus;
  if (error?.name === "SyntaxError") return UNAVAILABLE_REASONS.malformed;
  return UNAVAILABLE_REASONS.unreachable;
}

/** One sentence: what happened, and that it left no number behind. */
export const unavailableSentence = (reason) => `${reason}, so there is no count to show.`;

/**
 * The whole of what a surface says when a settled request left no count.
 *
 * Two sentences, in this order, because one of them is not enough to leave a
 * reader with: the honest absence, and then what was being counted, where, and
 * that the feeds to count it in are linked right beside it. Both surfaces render
 * this list rather than composing their own — the home page's counted-figure
 * block and the Agent observatory's headline figure are the same claim about the
 * same response, so they may not describe one outcome in two sets of words.
 * NEITHER SENTENCE CONTAINS A DIGIT, for the reason the reasons do not.
 */
export const unavailableSentences = (reason = UNAVAILABLE_REASONS.unreachable) =>
  [unavailableSentence(reason), COUNTED_SUBJECT_SENTENCE];

/**
 * The count, or the reason there is none. Never throws and never rejects.
 *
 * A response with nothing countable in it is not a zero — a zero is an answer
 * GitHub can give about merges, and "nothing to count from" is not that answer.
 * An undated response is refused for the same reason the observatory refuses
 * one: a number this page cannot say the arrival time of is a number it may not
 * show. Both fall to a reason, and a reason renders no digit.
 */
export async function loadMergedCount(fetcher = fetch, excluded = NOTHING_EXCLUDED) {
  try {
    const { countable, asOf } = await readPublicEvents(fetcher, excluded);
    if (!countable.length) return { ok: false, reason: UNAVAILABLE_REASONS.empty };
    if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
      return { ok: false, reason: UNAVAILABLE_REASONS.undated };
    }
    return { ok: true, count: countMergedPullRequests(countable, excluded), asOf };
  } catch (error) {
    return { ok: false, reason: unavailableReason(error) };
  }
}
