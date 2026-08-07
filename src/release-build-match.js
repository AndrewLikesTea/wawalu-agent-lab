// Is the build serving this traffic the one the release log says shipped?
//
// WHY THIS EXISTS. Answering that question used to mean opening a deploy log in
// one tab, the release log in another, and comparing two commit shas by eye.
// That comparison is the first thing an on-call operator does and the easiest
// one to get wrong at 3am, so it is computed here once and read from two
// places: `/healthz` (functions/healthz.js) and the release log page
// (src/releases-page.js). One function, one rule — the endpoint and the page
// cannot disagree about the same two shas.
//
// Everything here is pure. No DOM, no network, no storage, no clock: it takes
// the build stamp the build wrote (src/build-stamp.js) and one release record,
// and returns plain data. Nothing in it throws — a malformed stamp, a missing
// record, or a log edited outside the recorder degrades to `unknown` with a
// reason that names which input was missing, because a probe that throws is a
// 500 and a 500 tells an operator nothing about what shipped.

/** The three answers, so callers compare against a constant rather than a literal. */
export const VERDICTS = Object.freeze({
  matched: "matched",
  mismatched: "mismatched",
  unknown: "unknown",
});

// The shortest abbreviation this comparison will accept as identifying a
// commit. Git's own default abbreviation is 7 characters; anything shorter is
// not evidence, so it is treated as no sha at all rather than as a weak match.
export const MINIMUM_SHA_LENGTH = 7;

const SHA = /^[0-9a-f]{7,40}$/;

// The invisible controls a record edited outside the recorder can carry. Same
// rule as src/shipped-releases.js: an id ends up in a text node and in an
// operator's next action, so it is stripped of anything unprintable. Built
// through RegExp from escapes so this source file stays plain text.
const UNSAFE_DISPLAY_CHARACTERS = new RegExp("[\\u0000-\\u001f\\u007f\\u202a-\\u202e\\u2066-\\u2069]", "gu");

/**
 * A commit sha, trimmed and lowercased, or "" when the value is not one.
 *
 * Only hexadecimal of at least MINIMUM_SHA_LENGTH survives. That rejects the
 * two things a hand-edited record actually contains — an empty string and a
 * version tag such as "v1.4.0" — instead of comparing them as if they were
 * shas.
 */
export function normalizeSha(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return SHA.test(normalized) && normalized.length >= MINIMUM_SHA_LENGTH ? normalized : "";
}

/**
 * THE COMPARISON RULE. Two shas match when the shorter one is a prefix of the
 * longer one — that is, they are compared over the shorter of the two lengths
 * after trimming and lowercasing.
 *
 * The reason is that the two sides are written down by different tools: a
 * release record may carry the abbreviated sha a person copied out of `git log`
 * (7-12 characters) while the build stamp carries the full 40 from
 * `git rev-parse`. Comparing those for equality would report `mismatched` for a
 * build that is in fact exactly the one the release names, and a false alarm on
 * this probe costs more than the vanishingly small chance of a shared prefix
 * between two different commits of the same repository.
 */
export function shasMatch(left, right) {
  const a = normalizeSha(left);
  const b = normalizeSha(right);
  if (!a || !b) return false;
  const length = Math.min(a.length, b.length);
  return a.slice(0, length) === b.slice(0, length);
}

/** Milliseconds for a record's timestamp, or null when it cannot be read. */
function recordedAt(record) {
  const value = record?.createdAt;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * The newest release the log holds, by recorded time.
 *
 * A record whose timestamp cannot be read is still a record — it never
 * displaces a dated one, but a log made entirely of undated records still
 * answers with its first entry instead of with "empty". Anything that is not a
 * list of objects is an empty log.
 */
export function newestReleaseRecord(releases) {
  if (!Array.isArray(releases)) return null;
  let newest = null;
  let newestTime = null;
  for (const record of releases) {
    if (!record || typeof record !== "object") continue;
    const time = recordedAt(record);
    if (newest === null) {
      newest = record;
      newestTime = time;
      continue;
    }
    if (time === null) continue;
    if (newestTime === null || time > newestTime) {
      newest = record;
      newestTime = time;
    }
  }
  return newest;
}

/** The id a record can be opened by, bounded and free of invisible controls. */
function releaseIdOf(record) {
  const value = record?.id;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(UNSAFE_DISPLAY_CHARACTERS, "");
  return normalized ? normalized.slice(0, 120) : null;
}

/** The build timestamp, or null. Kept as written; it is never invented here. */
function builtAtOf(stamp) {
  const value = stamp?.builtAt;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The one verdict, from the running build's stamp and the newest release record.
 *
 * Returns:
 *   verdict    "matched" | "mismatched" | "unknown"
 *   buildSha   the running build's commit sha, or null
 *   builtAt    when that build was stamped, or null
 *   releaseSha the commit the newest release record says shipped, or null
 *   releaseId  that record's id, or null
 *   action     ONLY when mismatched: the single next thing to do, naming the
 *              release to open in the log
 *   reason     ONLY when unknown: which input was missing
 */
export function releaseBuildMatch(stamp, record) {
  const buildSha = normalizeSha(stamp?.commitSha) || null;
  const builtAt = builtAtOf(stamp);
  const releaseId = releaseIdOf(record);
  const releaseSha = normalizeSha(record?.commitSha) || null;
  const base = { buildSha, builtAt, releaseSha, releaseId };

  if (!buildSha) {
    return {
      ...base,
      verdict: VERDICTS.unknown,
      reason: "The running build is unstamped: src/build-stamp.js records no commit sha, so the build serving this traffic cannot be named.",
    };
  }
  if (!record || !releaseId) {
    return {
      ...base,
      verdict: VERDICTS.unknown,
      reason: "The release log holds no release record to compare the running build against.",
    };
  }
  if (!releaseSha) {
    return {
      ...base,
      verdict: VERDICTS.unknown,
      reason: `Release ${releaseId} records no commit sha, so there is nothing to compare the running build against.`,
    };
  }
  if (shasMatch(buildSha, releaseSha)) {
    return { ...base, verdict: VERDICTS.matched };
  }
  return {
    ...base,
    verdict: VERDICTS.mismatched,
    action: `Open release ${releaseId} in the release log and compare its commit ${releaseSha} with the running build ${buildSha}; roll back or record the release that actually shipped.`,
  };
}

/** The first 12 characters of a sha — enough to recognise, short enough to read. */
export function shortSha(sha) {
  return typeof sha === "string" && sha ? sha.slice(0, 12) : "unknown";
}

/**
 * The same verdict as one sentence, for a page to put in a text node.
 *
 * The endpoint and the page read this from the same result object, so the
 * sentence a reader sees and the JSON an operator curls are the same answer,
 * including the next action when they disagree.
 */
export function releaseBuildMatchLine(result) {
  if (!result || typeof result !== "object") return "";
  if (result.verdict === VERDICTS.matched) {
    return `Running build ${shortSha(result.buildSha)} matches release ${result.releaseId}`
      + `${result.builtAt ? `, built ${result.builtAt}` : ""}.`;
  }
  if (result.verdict === VERDICTS.mismatched) {
    return `Running build ${shortSha(result.buildSha)} does not match release ${result.releaseId}. ${result.action}`;
  }
  return `Running build not checked against the release log. ${result.reason ?? ""}`.trim();
}

/**
 * Everything the two surfaces need, from the two inputs they each already hold.
 *
 * Both callers pass the release records they have — `/healthz` the shipped log,
 * the page the log as this browser holds it — and get the same computation over
 * them.
 */
export function releaseBuildStatus(stamp, releases) {
  return releaseBuildMatch(stamp, newestReleaseRecord(releases));
}
