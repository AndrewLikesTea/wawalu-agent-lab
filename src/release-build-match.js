// Is the build serving this traffic the build the release log says shipped?
//
// WHY THIS EXISTS. Answering that used to mean opening a deploy log in one tab,
// the release log in another, and comparing two commit shas by eye. That is the
// first comparison an on-call operator makes and the easiest one to get wrong at
// 3am, so it is computed here once and read from two places: `/healthz`
// (functions/healthz.js) and the deployment status band on the release log page
// (src/releases-page.js). One function, one rule — the probe and the page cannot
// disagree about the same two shas, because there is only one comparison.
//
// Everything here is pure: no DOM, no network, no storage, no clock. It takes
// the stamp the build wrote (src/build-stamp.js) and the release records the
// caller already holds, and returns plain data. Nothing in it throws. A
// malformed stamp, an empty log, or a record edited outside the recorder
// degrades to `unknown` with a reason CODE naming which input was missing —
// because a probe that throws is a 500, and a 500 tells an operator nothing
// about what shipped.

/** The three answers, so callers compare against a constant, not a literal. */
export const VERDICTS = Object.freeze({
  matched: "matched",
  mismatched: "mismatched",
  unknown: "unknown",
});

/**
 * Why the answer is unknown, as machine-readable codes.
 *
 * These are the field an alert rule matches on, so they are stable identifiers
 * and never prose. The two degraded cases the probe must distinguish are
 * `no_build_stamp` (the running build cannot name itself) and
 * `empty_release_log` (there is nothing to compare it against); they need
 * different responses, so they must never collapse into one word.
 * `release_has_no_commit_sha` is the third: the log holds a record, but that
 * record does not say which commit it shipped, which is a gap in the record
 * rather than in the build.
 */
export const UNKNOWN_REASONS = Object.freeze({
  noBuildStamp: "no_build_stamp",
  emptyReleaseLog: "empty_release_log",
  releaseHasNoCommitSha: "release_has_no_commit_sha",
});

// The shortest abbreviation this comparison accepts as identifying a commit.
// Git's own default abbreviation is 7 characters; anything shorter is not
// evidence, so it is treated as no sha at all rather than as a weak match.
export const MINIMUM_SHA_LENGTH = 7;

const SHA = /^[0-9a-f]{7,40}$/;

// The invisible controls a record edited outside the recorder can carry. Same
// rule as the rest of this codebase: an id ends up in a text node and in an
// operator's next action, so it is stripped of anything unprintable. Built
// through RegExp from escapes so this source file stays plain text.
const UNSAFE_DISPLAY_CHARACTERS = new RegExp("[\\u0000-\\u001f\\u007f\\u202a-\\u202e\\u2066-\\u2069]", "gu");

/**
 * A commit sha, trimmed and lowercased, or "" when the value is not one.
 *
 * Only hexadecimal of at least MINIMUM_SHA_LENGTH survives. That rejects the
 * two things a hand-edited record actually contains — an empty string and a
 * version tag such as "v1.4.0" — instead of comparing them as if they were shas.
 */
export function normalizeSha(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return SHA.test(normalized) && normalized.length >= MINIMUM_SHA_LENGTH ? normalized : "";
}

/**
 * THE COMPARISON RULE. Two shas match when the shorter is a prefix of the
 * longer — they are compared over the shorter of the two lengths, after
 * trimming and lowercasing.
 *
 * The two sides are written down by different tools: a release record carries
 * the abbreviated sha a person copied out of `git log` (7-12 characters) while
 * the build stamp carries the full 40 from `git rev-parse`. Comparing those for
 * strict equality would report `mismatched` for a build that is exactly the one
 * the release names, and a false alarm on this probe costs more than the
 * vanishingly small chance of a shared 7-character prefix between two commits.
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
 * A record whose timestamp cannot be read is still a record: it never displaces
 * a dated one, but a log made entirely of undated records still answers with its
 * first entry instead of with "empty". Anything that is not a list of objects is
 * an empty log.
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

/** The build timestamp, as written. It is never invented here. */
function builtAtOf(stamp) {
  const value = stamp?.builtAt;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The label a person recognises a release by: its version, else its id. */
function releaseNameOf(record, releaseId) {
  const version = typeof record?.version === "string" ? record.version.trim().replace(UNSAFE_DISPLAY_CHARACTERS, "") : "";
  return version ? version.slice(0, 60) : releaseId;
}

/**
 * THE ONE VERDICT, from the running build's stamp and the newest release record.
 *
 * Returns:
 *   verdict     "matched" | "mismatched" | "unknown"
 *   buildSha    the running build's commit sha, or null
 *   builtAt     when that build was stamped, or null
 *   releaseSha  the commit the newest release record says shipped, or null
 *   releaseId   that record's id, or null
 *   action      ONLY when mismatched: the single next thing to do, naming the
 *               release id to open in the log
 *   reason      ONLY when unknown: a machine-readable code from UNKNOWN_REASONS
 *   reasonText  ONLY when unknown: the same thing as one sentence for a reader
 *
 * `action` is absent — not empty — on a matched verdict. A matched build has no
 * next action, and an empty string is a thing an operator can still read as one.
 */
export function releaseBuildMatch(stamp, record) {
  const buildSha = normalizeSha(stamp?.commitSha) || null;
  const builtAt = builtAtOf(stamp);
  const releaseId = releaseIdOf(record);
  const releaseSha = normalizeSha(record?.commitSha) || null;
  const base = { buildSha, builtAt, releaseSha, releaseId };
  const unknown = (reason, reasonText) => ({ ...base, verdict: VERDICTS.unknown, reason, reasonText });

  if (!buildSha) {
    return unknown(
      UNKNOWN_REASONS.noBuildStamp,
      "The running build is unstamped: it records no commit sha, so the build serving this traffic cannot be named.",
    );
  }
  if (!record || !releaseId) {
    return unknown(
      UNKNOWN_REASONS.emptyReleaseLog,
      "The release log holds no release record to compare the running build against.",
    );
  }
  if (!releaseSha) {
    return unknown(
      UNKNOWN_REASONS.releaseHasNoCommitSha,
      `Release ${releaseId} records no commit sha, so there is nothing to compare the running build against.`,
    );
  }
  if (shasMatch(buildSha, releaseSha)) {
    return { ...base, verdict: VERDICTS.matched };
  }
  const name = releaseNameOf(record, releaseId);
  return {
    ...base,
    verdict: VERDICTS.mismatched,
    action: `Open release ${releaseId} (${name}) in the release log and compare its commit ${shortSha(releaseSha)} with the running build ${shortSha(buildSha)}; roll back to the recorded build, or record the release that actually shipped.`,
  };
}

/** The first 12 characters of a sha — enough to recognise, short enough to read. */
export function shortSha(sha) {
  return typeof sha === "string" && sha ? sha.slice(0, 12) : "unknown";
}

/**
 * The same verdict as one sentence, for a page to put in a text node.
 *
 * The probe and the page read this from the same result object, so the sentence
 * on screen and the JSON an operator curls are the same answer — including the
 * same next action, word for word, when the two shas disagree.
 */
export function releaseBuildMatchLine(result) {
  if (!result || typeof result !== "object") return "";
  if (result.verdict === VERDICTS.matched) {
    return `Running build ${shortSha(result.buildSha)} is the build release ${result.releaseId} says shipped`
      + `${result.builtAt ? `, built ${result.builtAt}` : ""}.`;
  }
  if (result.verdict === VERDICTS.mismatched) {
    return `Running build ${shortSha(result.buildSha)} is not the build release ${result.releaseId} says shipped. ${result.action}`;
  }
  return `Whether the running build is the one the release log says shipped is unknown. ${result.reasonText ?? ""}`.trim();
}

/**
 * Everything both surfaces need, from the two inputs they each already hold.
 *
 * `/healthz` passes the shipped records; the page passes the log as this browser
 * holds it. Same computation, same result object, either way.
 */
export function releaseBuildStatus(stamp, releases) {
  return releaseBuildMatch(stamp, newestReleaseRecord(releases));
}
