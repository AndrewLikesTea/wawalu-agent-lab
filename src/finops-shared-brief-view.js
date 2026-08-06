// The recipient's side of a shared brief, read in the answer region itself.
//
// THE PROBLEM THIS SOLVES. #1206 put a sender's own retained periods into a
// link's fragment and #1210 checked, before the send, that the link reproduces
// their brief. Neither told the person who OPENS that link on /evolution.html
// what they are looking at. This page paints the bundled synthetic example on a
// cold load — same question, same headings, same layout, an invented company's
// figures — so a recipient whose browser has retained nothing reads the example
// and quotes it back as the sender's analysis. Nothing on screen is false and
// the reader is still misled, which is the failure mode a shared link creates
// and cannot fix from the sender's side.
//
// So the answer region is repainted from the token, in place, and says whose
// figures it is holding. SIX RULES.
//
//   1. ONE PAYLOAD AND ONE VALIDATOR. The token is read by
//      `readSharedBriefingFragment` and the figures are built by
//      `buildExecutiveBriefing` — the codec and the builder that already ship.
//      This module decodes nothing, validates nothing, and holds no threshold,
//      so it cannot disagree with the parity check the sender was shown.
//
//   2. READ-ONLY, AND STRUCTURALLY SO. Nothing here imports storage. The one
//      focusable in the region is the region's own anchor, and in this state it
//      is repointed at the reader's own import panel: there is no apply, no
//      adopt, no save, and no input bound to a shared value, so the state
//      cannot write a sender's number into a reader's workspace.
//
//   3. SILENT FALLBACK. An address with no brief on it, or one the codec
//      refuses, paints NOTHING: `applySharedBrief` returns the refusal and
//      leaves the ordinary page exactly as it was served. A half-painted answer
//      region — the sender's figure beside the example's basis — is the one
//      outcome worse than not rendering at all.
//
//   4. NO NEW TAB STOP AND NOTHING FOLDED THAT SPEAKS. Every slot written here
//      is authored in evolution.html; this state adds no focusable, and the
//      figure, the destination, the grade and the authorship line are all
//      OUTSIDE the disclosure. Only the qualifying detail goes inside it, into
//      the one "how we know this" disclosure the region already ships.
//
//   5. WHAT THE BRIEF DOES NOT CARRY IS NAMED. A field the payload lacks is
//      rendered as `NOT_INCLUDED` in the place it would have gone, never
//      dropped and never left blank: a gap where a fingerprint should be reads
//      as an oversight, and "not included in this brief" reads as a fact.
//
//   6. NO CLOCK. The produced-at stamp is the payload's own `derivedAt`. A
//      shared brief that dated itself from the reader's wall clock would claim
//      to be as current as the moment it was opened.
//
// Every string reaches the DOM through `textContent`. A period record came out
// of somebody else's browser, so an org unit id in it is untrusted text.

import { announceAnswer } from "./finops-answer-announcement.js";
import { buildExecutiveBriefing } from "./executive-finops-briefing.js";
import { readSharedBriefingFragment } from "./finops-shared-briefing-link.js";

/** The authored slots this state writes. All of them already ship. */
export const SHARED_BRIEF_IDS = Object.freeze({
  region: "finops-recoverable-answer",
  value: "finops-recoverable-value",
  marker: "finops-recoverable-marker",
  grade: "finops-recoverable-grade",
  destination: "finops-recoverable-confidence",
  origin: "finops-recoverable-origin",
  action: "finops-recoverable-action",
  provenance: "finops-recoverable-provenance-detail",
  basis: "finops-recoverable-basis-detail",
  limits: "finops-recoverable-limits-detail",
  confidenceDetail: "finops-recoverable-confidence-detail",
});

/** The chip that replaces "Illustrative" beside the figure. */
export const SHARED_BRIEF_MARKER = "Shared brief";

/** What a field the payload does not carry is called, wherever it is missing. */
export const NOT_INCLUDED = "not included in this brief";

/** The authorship sentence, in the open. Never only inside the disclosure. */
export const SHARED_BRIEF_ORIGIN =
  "These figures came from a shared brief: they are the sender's own analysis, carried in this link, "
  + "not an analysis this browser ran.";

/** The region's one anchor, in this state. It goes to the reader's own import. */
export const SHARED_BRIEF_ACTION = "Analyze your own provider export — go to the import panel";
export const SHARED_BRIEF_ACTION_HREF = "#local-import";

/** Why a brief was not painted, beyond the codec's own named refusals. */
export const SHARED_BRIEF_REASON = Object.freeze({
  rendered: "shared_brief_rendered",
  noPeriod: "no_eligible_period",
  unreadable: "brief_not_readable",
});

// The headline slot is authored as "$62,400" — whole dollars, because a cent on
// an annual ceiling is precision the figure does not have.
const USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0,
});
const usd = (minor) => (Number.isFinite(minor) ? USD.format(minor / 100) : null);
const share = (ppm) => (Number.isFinite(ppm) ? `${(ppm / 10_000).toFixed(1)}%` : NOT_INCLUDED);

/** One word beside the figure, matching the grade chip the region already uses. */
const GRADE_WORD = Object.freeze({
  high: "High", moderate: "Moderate", low: "Low", insufficient: "Insufficient",
});

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

/** Write text into an authored slot, or do nothing if the document lacks it. */
function write(doc, id, text) {
  const node = byId(doc, id);
  if (node) node.textContent = text;
  return node;
}

const stated = (value) => (value === null || value === undefined || value === "" ? NOT_INCLUDED : String(value));

/**
 * Read whatever a location fragment carries, and build the brief behind it.
 *
 * Total: every path returns a frozen result and none throws, because this runs
 * inside the boot of a page that has to render with or without a brief on it.
 *
 * @returns `{ ok, reason, briefing, periodCount }`. `briefing` is null on every
 *   refusal, so a caller cannot paint half a state by mistake.
 */
export function sharedBrief(hash) {
  let decoded;
  try {
    decoded = readSharedBriefingFragment(hash);
  } catch {
    return Object.freeze({ ok: false, reason: SHARED_BRIEF_REASON.unreadable, briefing: null, periodCount: 0 });
  }
  if (!decoded.ok) {
    return Object.freeze({ ok: false, reason: decoded.reason, briefing: null, periodCount: 0 });
  }
  let briefing;
  try {
    briefing = buildExecutiveBriefing(decoded.periods);
  } catch {
    return Object.freeze({ ok: false, reason: SHARED_BRIEF_REASON.unreadable, briefing: null, periodCount: 0 });
  }
  // A token whose periods all fail the briefing's own eligibility rules decodes
  // but names no reporting period, and a brief with no period behind it has no
  // figure, no destination and no grade to lead with.
  if (!briefing.reportingPeriod) {
    return Object.freeze({ ok: false, reason: SHARED_BRIEF_REASON.noPeriod, briefing: null, periodCount: 0 });
  }
  return Object.freeze({
    ok: true,
    reason: SHARED_BRIEF_REASON.rendered,
    briefing,
    periodCount: decoded.periods.length,
  });
}

/**
 * The one sentence the recipient state is announced as, composed from the same
 * strings the visible slots are painted from so the two cannot drift.
 */
export function sharedBriefAnnouncement(briefing) {
  const figure = usd(briefing?.recoverable?.valueMinor);
  const unit = briefing?.primaryFinding?.orgUnitId ?? null;
  const grade = GRADE_WORD[briefing?.confidence?.level] ?? "not graded";
  return [
    "You are reading a shared brief.",
    `Recoverable AI spend: ${figure ?? NOT_INCLUDED}.`,
    `Start here: ${unit === null ? NOT_INCLUDED : unit}.`,
    `Confidence: ${grade}.`,
    `Sender's reporting period ${stated(briefing?.reportingPeriod?.period)}, `
      + `produced at ${stated(briefing?.reportingPeriod?.derivedAt)}.`,
  ].join(" ");
}

/**
 * Paint the recipient state into the answer region.
 *
 * @param hash the address fragment, defaulting to this browser's own.
 * @returns the state that was painted, or the refusal that left the ordinary
 *   page alone. Never throws: a reader who arrives with a broken link is owed
 *   the working page, not a stack trace in place of it.
 */
export function applySharedBrief(doc, hash = globalThis.location?.hash ?? "") {
  const region = byId(doc, SHARED_BRIEF_IDS.region);
  const state = sharedBrief(hash);
  if (!region || !state.ok) return state;

  const briefing = state.briefing;
  const period = briefing.reportingPeriod;
  const recoverable = briefing.recoverable;
  const provenance = briefing.provenance;
  const producedAt = stated(period.derivedAt);
  const reportingPeriod = stated(period.period);

  // (a) The money, (b) what to change first, (c) how far to trust it — all
  // three outside every disclosure, in the region's own authored slots.
  write(doc, SHARED_BRIEF_IDS.value, usd(recoverable?.valueMinor) ?? NOT_INCLUDED);
  write(doc, SHARED_BRIEF_IDS.marker, SHARED_BRIEF_MARKER);

  const grade = byId(doc, SHARED_BRIEF_IDS.grade);
  if (grade) {
    grade.textContent = `Confidence: ${GRADE_WORD[briefing.confidence?.level] ?? "not graded"}`;
    grade.dataset.grade = briefing.confidence?.level ?? "ungraded";
  }

  const unit = briefing.primaryFinding?.orgUnitId ?? null;
  write(doc, SHARED_BRIEF_IDS.destination, unit === null
    ? `Where to start is ${NOT_INCLUDED}: it carries no named org unit to act in first.`
    : `Start here: ${unit}. ${briefing.primaryFinding.statement}`);

  // Whose numbers these are, in the open. A reader who never presses anything
  // still learns that the figure above is somebody else's and when it was made.
  const origin = write(doc, SHARED_BRIEF_IDS.origin,
    `${SHARED_BRIEF_ORIGIN} Sender's reporting period: ${reportingPeriod}. Produced at: ${producedAt}.`);
  if (origin) origin.hidden = false;

  // The region's one focusable, repointed at the reader's OWN analysis. It
  // carries no shared value and writes nothing; it is the way back to the
  // ordinary page rather than a way to adopt the sender's figures.
  const action = byId(doc, SHARED_BRIEF_IDS.action);
  if (action) {
    action.textContent = SHARED_BRIEF_ACTION;
    action.setAttribute("href", SHARED_BRIEF_ACTION_HREF);
  }

  // Disclosure parity: the same three parts, in the same order, from the brief.
  write(doc, SHARED_BRIEF_IDS.provenance,
    `A shared brief, composed in the sender's browser from ${stated(provenance.dataset)} data and carried `
    + `in this link. Reporting period ${reportingPeriod}, produced at ${producedAt}. Periods in the link: `
    + `${provenance.retainedPeriodCount}. Records analyzed: ${stated(provenance.recordsAnalyzed)} of `
    + `${stated(provenance.recordsTotal)}. Source fingerprint: ${stated(provenance.sourceFingerprint)}. `
    + "Nothing was read from this browser, and nothing from the link was stored in it.");

  write(doc, SHARED_BRIEF_IDS.basis,
    `${usd(recoverable?.valueMinor) ?? NOT_INCLUDED} recoverable against `
    + `${usd(recoverable?.analyzedSpendMinor) ?? NOT_INCLUDED} of analyzed spend for ${reportingPeriod}, `
    + `which is ${share(recoverable?.sharePpm)} of it. ${briefing.method.note}`);

  write(doc, SHARED_BRIEF_IDS.limits, briefing.limitations.map((entry) => entry.statement).join(" "));
  write(doc, SHARED_BRIEF_IDS.confidenceDetail,
    `${briefing.confidence.meaning} It is the grade the sender's own retained coverage carried; this `
    + "browser recomputed nothing from the link. What holds the grade down: "
    + `${briefing.confidence.ceilingReason ?? "nothing this brief carries caps it"}.`);

  // The state a test can name rather than infer from the painted strings.
  region.dataset.sharedBrief = state.reason;

  // The page's ONE announcer, which is neither in this region nor inside any
  // disclosure. Written with `announce: false` for the same reason the boot
  // paint of the ordinary answer is: this is the first thing the reader is
  // handed, not a change to something they were already reading.
  announceAnswer(doc, sharedBriefAnnouncement(briefing), { announce: false });
  return state;
}
