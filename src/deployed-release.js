// The one release record on this site that is not invented.
//
// WHY THIS EXISTS. The Agent observatory tells a visitor that merged pull
// requests "built and changed the pages of this site" and offers to show them
// the releases those pull requests shipped. The log at the other end of that
// link held nothing but demonstration records, so the promise landed on a page
// whose only framing was that nothing on it was real. This module is the record
// that closes that gap: it is derived from src/build-stamp.js, which the build
// rewrites with the commit the artifact was built from, so the record names a
// commit a visitor can open in the public repository and check.
//
// THE RECORD IS NEVER INVENTED. `deployedReleaseRecord` returns null when the
// stamp carries no commit — a tarball checkout, a shallow export, a build with
// no git metadata. There is no fallback record and no placeholder sha: a
// deployment that cannot name itself gets no real record, and the surfaces
// above say so rather than showing one.
//
// WHY `version` IS THE FULL SHA. `/healthz` reports the running deployment as
// `version: BUILD_STAMP.commitSha` (src/health-contract.js). The deployment
// check compares the reported version against this record's `version`, so the
// two must be the same string for the comparison to mean anything. A prettier
// label here would be a comparison that never matched.
//
// Everything below is pure: no DOM, no network, no storage, no clock.

/**
 * The public repository this site is built from.
 *
 * Not guessed: it is the `origin` remote of this checkout, and the same
 * host-and-owner path src/agents.js already puts in front of a reader when it
 * links the commits behind a merge.
 */
export const REPOSITORY_URL = "https://github.com/AndrewLikesTea/wawalu-agent-lab";

/** The id this record is known by wherever it is named. */
export const DEPLOYED_RELEASE_ID = "deployed-build";

/**
 * THE TWO MARKINGS, and the reason they are exported from one place.
 *
 * Every release record a reader meets carries exactly one of them. They have to
 * be unmistakable at a glance and impossible to read as near-synonyms of each
 * other, so they are constants rather than literals repeated per surface, and a
 * test pins that they share no wording.
 *
 * REAL_LABEL is this record. EXAMPLE_LABEL (src/seed-records.js) is every
 * demonstration record, and is deliberately untouched by this change: the
 * invented marking gets louder by contrast, never quieter.
 */
export const REAL_LABEL = "Real record of this deployment";

/** What the marking reads when the build is unstamped and there is no record. */
export const NO_RECORD_LABEL = "This deployment records no commit";

/**
 * How the deployment check names the record it compared against.
 *
 * It is REAL_LABEL in lower case on purpose: the sentence a reader gets in the
 * verdict names the same thing the badge beside the record names, in the same
 * words, so "which record was this compared against?" needs no interpretation.
 */
export const REAL_RECORD_NAME = "the real record of this deployment";

// Git's own default abbreviation is 7; the stamp writes the full 40. Anything
// that is not hexadecimal in that range is not a commit and gets no link.
const SHA = /^[0-9a-f]{7,40}$/;

/** A commit sha, trimmed and lowercased, or "" when the value is not one. */
export function normalizeCommitSha(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return SHA.test(normalized) ? normalized : "";
}

/**
 * The public page for one commit, or null when the sha is not one.
 *
 * The shape is GitHub's commit permalink under the repository above. Both
 * halves are checked rather than assumed: the repository is this checkout's
 * `origin`, and the sha is only ever the one the build wrote from
 * `git rev-parse HEAD`, which is a commit that reached the default branch.
 */
export function commitUrl(sha) {
  const commit = normalizeCommitSha(sha);
  return commit ? `${REPOSITORY_URL}/commit/${commit}` : null;
}

/** The first 12 characters — enough to recognise, short enough to read. */
export function shortCommit(sha) {
  const commit = normalizeCommitSha(sha);
  return commit ? commit.slice(0, 12) : "";
}

/**
 * How a link to that commit names itself, wherever it is offered.
 *
 * Two surfaces now carry the link — the releases page's real record and the
 * front door's deployment check — and they go to the same commit, so they say
 * the same words. It is a function here rather than a literal on each page so
 * the two names cannot drift apart, and it names the commit rather than the act
 * ("verify this") because the reader is the one who decides what opening it
 * proves. Empty when the sha is not one: a link with no commit is not offered.
 */
export function commitLinkText(sha) {
  const commit = shortCommit(sha);
  return commit ? `Open commit ${commit} in the public repository` : "";
}

/**
 * A link into this same site, or "" when the value is anything else.
 *
 * `detailHref` is the one href on the real-record block that is read off the
 * record rather than composed character by character, and two things now
 * consume it: an anchor a visitor clicks and a URL a visitor copies. A single
 * leading slash and a conservative alphabet is the whole rule. It rejects
 * protocol-relative "//host", every scheme (http:, data:, javascript:),
 * backslashes, whitespace and "../" traversal — so no record can point either
 * consumer off this site, and in particular the clipboard cannot be handed a
 * foreign address under a label that says "real release link". The same check
 * src/social.js applies to an image path, for the same reason.
 */
export function sameSiteHref(value) {
  if (typeof value !== "string") return "";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("..")) return "";
  return /^\/[A-Za-z0-9._~\-/?#=&%]*$/.test(value) ? value : "";
}

/**
 * The real record of this deployment, or null when the build is unstamped.
 *
 * Release-record shaped, so every surface that already knows how to read a
 * release record can read this one. Three fields are additions the seed records
 * do not carry:
 *
 *   sourceUrl     the public commit a visitor opens to check the record
 *   detailHref    where "open this record" goes. This record does not live in
 *                 the visitor's log, so /release.html?id=… would resolve to
 *                 nothing; it is rendered in its own region on the releases
 *                 page, and that is where the link points.
 *   actionLabel / actionTarget
 *                 the one next action for the state where the running
 *                 deployment and this record disagree. That state is not a
 *                 release to reconcile — it means the page in front of the
 *                 reader and the deployment answering /healthz came from
 *                 different builds — so it gets its own words.
 */
export function deployedReleaseRecord(stamp) {
  const commitSha = normalizeCommitSha(stamp?.commitSha);
  const builtAt = typeof stamp?.builtAt === "string" ? stamp.builtAt.trim() : "";
  if (!commitSha || !builtAt || Number.isNaN(Date.parse(builtAt))) return null;
  return Object.freeze({
    id: DEPLOYED_RELEASE_ID,
    version: commitSha,
    title: "The build this site is running",
    description: "The commit this artifact was built from, written by the build that produced this page.",
    status: "completed",
    owner: "Wawalu",
    createdAt: builtAt,
    commitSha,
    sourceUrl: commitUrl(commitSha),
    detailHref: "/releases.html#shipped-build",
    actionLabel: "Open the real record of this deployment",
    actionTarget: "The page you are reading and the deployment answering the health check name different builds. Reload this page; if they still disagree, they came from different builds and the newer one has not finished replacing the older.",
    decisionIds: Object.freeze([]),
  });
}
