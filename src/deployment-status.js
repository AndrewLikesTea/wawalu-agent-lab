// Does what is running match what the log says shipped?
//
// This module is the whole answer to that question and it is pure: it takes a
// `/healthz` reading (or the reason there is none), the newest release record,
// and the current time, and returns a verdict object. No DOM, no fetch, no
// storage, no clock of its own. deployment-status-view.js renders the object and
// releases-page.js supplies the reading; both of those are replaceable, this is
// the part that must be right.
//
// READ ONLY, DELIBERATELY. Nothing here — or in the view — deploys, rolls back,
// or writes to the release log. A drift verdict names a record to reconcile and
// links to it; the reconciling happens on the recorder a person operates, which
// is the existing form on this same page. Least privilege: a status view that
// could also act is a status view that can be wrong twice.
//
// WHICH RECORD IT COMPARES AGAINST. The real record of this deployment
// (src/deployed-release.js), and nothing else. It used to be the newest record
// in the log, which on the shipped page was an invented demonstration record —
// so the band said it had checked the running deployment against something that
// never shipped. The record is supplied by the caller, and the verdict names it
// in the same words the page marks it with, so "what was this compared against?"
// has a visible answer. Recording "the last time the comparison agreed" would
// need a write path, and this view is not allowed one — so the degraded path
// reports the comparison it can still make (the recorded build, its record, and
// when it was written) rather than inventing a checkpoint.
//
// WHAT THE DURATION MEASURES. Time since the newest release record was written,
// because that is the only timestamp either side of the comparison carries. It
// is the age of the state, stated as such in the metric's own words ("recorded
// N ago"), not a claim about when a drift began — which nothing on this page
// could know without persisting past verdicts.

import { REAL_RECORD_NAME, sameSiteHref } from "./deployed-release.js";
import { releaseDetailHref } from "./releases.js";

// The fields a health response may name its build in, in order. `/healthz`
// answers `{ status, storage }` today and names no build at all, which is
// exactly the `unknown` case below rather than a special one: this view reports
// what the probe says, and adding a build stamp to the probe is a change to the
// deployment pipeline, not to a read-only page.
export const HEALTH_BUILD_FIELDS = Object.freeze(["build", "version", "buildId"]);

export const DEPLOYMENT_STATES = Object.freeze(["match", "drift", "unknown"]);

// Why the answer is unknown, in plain language and never as an error object: a
// reader gets a sentence, not a stack trace.
export const UNKNOWN_REASONS = Object.freeze({
  unreachable: "The health check could not be reached.",
  timeout: "The health check did not answer in time.",
  "unexpected-shape": "The health check answered in a shape this page does not recognise.",
  "no-build": "The health check answered, but it named no build identifier.",
  "no-record": "There is no real record of this deployment to compare the running deployment against.",
});

const FALLBACK_REASON = UNKNOWN_REASONS.unreachable;

function text(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

// A recognised reading is a JSON object that states a `status`. Anything else —
// an array, a string, HTML from a proxy, null — is an unexpected shape, which is
// a reason to say unknown and never a reason to throw.
export function isHealthShape(health) {
  return health !== null
    && typeof health === "object"
    && !Array.isArray(health)
    && text(health.status) !== null;
}

export function healthBuildId(health) {
  if (!isHealthShape(health)) return null;
  for (const field of HEALTH_BUILD_FIELDS) {
    const found = text(health[field]);
    if (found) return found;
  }
  return null;
}

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Coarse on purpose. The reader needs "minutes or weeks", and a precise figure
// would imply this page watched the whole interval, which it did not.
export function durationText(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "an unknown time";
  if (milliseconds < MINUTE) return "less than a minute";
  const units = [[DAY, "day"], [HOUR, "hour"], [MINUTE, "minute"]];
  for (const [size, name] of units) {
    const count = Math.floor(milliseconds / size);
    if (count >= 1) return `${count} ${name}${count === 1 ? "" : "s"}`;
  }
  return "less than a minute";
}

function elapsed(fromIso, nowIso) {
  const from = Date.parse(fromIso ?? "");
  const now = Date.parse(nowIso ?? "");
  if (Number.isNaN(from) || Number.isNaN(now)) return null;
  return now - from;
}

// The one action a non-matching verdict offers, tied to a specific record. Both
// branches are links to a page a person then operates: this view never submits
// anything itself.
//
// A record may carry its own words for that action. The real record of this
// deployment (src/deployed-release.js) does: it does not live in the visitor's
// log, so the detail route would resolve to nothing, and "reconcile a release"
// is not what a reader should do when the page in front of them and the
// deployment answering the probe name different builds. Every other record
// falls back to the recorder's own wording, unchanged.
/**
 * Where the compared record's own page is — one rule, for both anchors.
 *
 * Two things now offer that destination: the next action a non-matching verdict
 * names, and the standing link beside the metric that keeps the record
 * reachable in the states that have no next action. They are one derivation
 * here so they cannot drift into naming two different places for one record.
 *
 * A record may name its own location — the real record of this deployment does,
 * because it does not live in the visitor's log — but only a location on this
 * site, checked the way deployed-release-view.js checks the same field before
 * putting it in an anchor. Anything else falls back to the log's own route,
 * which is the single derivation of that URL shape (src/releases.js).
 *
 * Empty for a record with no id: there is nothing to open.
 */
export function recordDetailHref(release) {
  if (!release?.id) return "";
  return sameSiteHref(release.detailHref) || releaseDetailHref(release.id);
}

function nextActionFor(release) {
  if (!release?.id) {
    return {
      label: "Record the release that is running",
      href: "/releases.html#record-release",
      target: "There is no real record of this deployment, so there is nothing to compare against yet.",
      releaseId: null,
    };
  }
  const name = text(release.version) ?? release.id;
  return {
    label: text(release.actionLabel) ?? `Reconcile release ${name}`,
    href: recordDetailHref(release),
    target: text(release.actionTarget)
      ?? `Open ${name} and re-record it if what is running is correct, or ship the recorded build if it is not.`,
    releaseId: release.id,
  };
}

/**
 * The comparison, as one pure function.
 *
 * @param reading `{ health }` for a probe that answered, or `{ failure }` where
 *   failure is one of `unreachable`, `timeout`, `unexpected-shape`. An
 *   unrecognised failure name degrades to `unreachable` rather than throwing.
 * @param release the newest release record, or null when the log holds none.
 * @param now ISO timestamp the caller read the clock at.
 * @returns a verdict object the view renders and the tests assert on.
 */
export function deploymentVerdict(reading = {}, release = null, now = new Date().toISOString()) {
  const { health = null, failure = null, checkedAt = now } = reading ?? {};
  const recordedBuild = text(release?.version);
  const recordedAt = text(release?.createdAt);
  const heldMs = elapsed(recordedAt, now);
  const base = {
    deployedBuild: null,
    recordedBuild,
    recordedAt,
    release: release?.id ? { id: release.id, version: recordedBuild } : null,
    heldMs,
    heldFor: durationText(heldMs),
    reason: null,
    nextAction: null,
    checkedAt: text(checkedAt) ?? now,
  };
  const unknown = (reason) => ({
    ...base,
    state: "unknown",
    reason,
    nextAction: nextActionFor(release),
  });

  if (failure) return unknown(UNKNOWN_REASONS[failure] ?? FALLBACK_REASON);
  if (!isHealthShape(health)) return unknown(UNKNOWN_REASONS["unexpected-shape"]);
  const deployedBuild = healthBuildId(health);
  if (!deployedBuild) return { ...unknown(UNKNOWN_REASONS["no-build"]), deployedBuild: null };
  if (!recordedBuild) return { ...unknown(UNKNOWN_REASONS["no-record"]), deployedBuild };
  if (deployedBuild === recordedBuild) {
    return { ...base, state: "match", deployedBuild };
  }
  return { ...base, state: "drift", deployedBuild, nextAction: nextActionFor(release) };
}

// The answer, in one sentence a reader who opens nothing can act on. The page's
// static lead says what the check proves; this says how it came out. Returned as
// a string and written through textContent by the renderer — never assembled
// into markup — because both identifiers originate outside this page.
//
// The three states read as three different sentences on purpose. A check that
// could not run is not a mismatch, and neither of them may be mistaken for the
// match: only the match names a version as the one this site is running.
export function verdictSentence(verdict) {
  const deployed = verdict.deployedBuild ?? "an unreported build";
  const recorded = verdict.recordedBuild ?? "no recorded build";
  const recordId = verdict.release?.id ?? "an unavailable release record";
  if (verdict.state === "match") {
    return `Confirmed: this site is running ${deployed}, the version ${REAL_RECORD_NAME} (record ${recordId}) names.`;
  }
  if (verdict.state === "drift") {
    return `Not a match: this site is running ${deployed}, but ${REAL_RECORD_NAME} (record ${recordId}) names ${recorded}.`;
  }
  return `The check did not complete, so nothing here says which version this site is running. ${verdict.reason}`;
}

// The single headline metric: the running identifier, the exact record id it
// was compared with, that record's build identifier, and its age. The verdict
// remains the line above this one so these facts support rather than bury it.
export function verdictMetricText(verdict) {
  const deployed = verdict.deployedBuild ?? "not reported";
  const recorded = verdict.recordedBuild ?? "none recorded";
  const recordId = verdict.release?.id ?? "none";
  const held = verdict.recordedAt ? `recorded ${verdict.heldFor} ago` : "never recorded";
  return `Running build ${deployed} · Compared release record ${recordId} · Recorded build ${recorded} · ${held}`;
}

// What a matching verdict says instead of offering an action.
export const NO_ACTION_TEXT = `No action is needed: the version running is the one ${REAL_RECORD_NAME} names.`;
