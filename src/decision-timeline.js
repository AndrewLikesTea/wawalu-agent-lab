// What happened to a decision after it was recorded: which release carried it,
// how long that took, and which accepted decision has been waiting longest.
// Pure arithmetic over the history records the list already holds — no DOM, no
// clock of its own, no storage, no fetch. The drawing layer
// (decision-timeline-view.js) turns the numbers below into pixels and can be
// removed entirely without changing a single sentence a reader gets.
//
// THE LOG RECORDS ONE DATE PER DECISION. A decision carries `createdAt` and a
// current `status`; nothing in the store timestamps the transition into that
// status. So the span reported here is recorded → release, and it is named that
// way in every sentence. Calling it "acceptance → release" would attach a date
// to an event the log never wrote down, and a figure that invents a timestamp is
// worse than no figure.
//
// CALENDAR DAYS, UTC. The same basis the From/To filters and the trend chart
// read. A decision recorded at 23:00 and released at 01:00 the next morning is
// one day, not zero: the reader's unit is days on a calendar, not 24-hour
// windows since a wall-clock instant.

import { formatFilterDate } from "./history-filters.js";

const DAY_MS = 86_400_000;

/**
 * How many strips are drawn per render.
 *
 * This figure sits ABOVE the record list, so every strip pushes the list the
 * reader came for further down the page. Five is roughly a third of a screen at
 * the default type size, which is the most this can take before it stops being a
 * preface to the list and starts being the page. The draw cost is not what caps
 * it — five strips is about fifty canvas operations, far inside one frame — so
 * the cap is stated here as the layout trade-off it actually is, and the summary
 * line says how many decisions were left undrawn.
 */
export const MAX_TIMELINE_STRIPS = 5;

/**
 * The backing store is never sized past 2× CSS pixels.
 *
 * A strip is a line, three marks, and no text: at 2× every edge already lands on
 * a device pixel on the displays that report 2, and 3× on a phone would triple
 * the bitmap for a picture whose finest feature is a 2px rule. The ceiling is
 * a memory decision, not a sharpness one — five strips at 3× is a megabyte of
 * bitmap for no visible gain. Ratios below 1 clamp up to 1 rather than shrinking
 * the store: a browser zoomed out still gets a full-resolution strip.
 */
export const MAX_STRIP_RATIO = 2;

/** The strip's CSS box. Device pixels are this times the clamped ratio. */
export const STRIP_CSS_WIDTH = 320;
export const STRIP_CSS_HEIGHT = 28;

// Geometry constants, in CSS pixels, scaled once by stripGeometry.
const STRIP_INSET = 10;
const TRACK_HEIGHT = 2;
const CAP_WIDTH = 2;
const CAP_HEIGHT = 12;
const MARK_RADIUS = 4;
const DASH_LENGTH = 4;
const DASH_GAP = 3;
const OPEN_DASHES = 3;

const dayNumber = (instant) => {
  const at = Date.parse(instant);
  return Number.isFinite(at) ? Math.floor(at / DAY_MS) : null;
};

/** The UTC calendar day an instant falls on, as `YYYY-MM-DD`, or `""`. */
export function dayOf(instant) {
  const day = dayNumber(instant);
  return day === null ? "" : new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Whole calendar days from `from` to `to`, or `null` when either end is
 * unreadable. The result can be negative: a decision linked to a release dated
 * before it was recorded is a real thing the log can hold, and reporting it as
 * zero would launder a data problem into a fast delivery.
 */
export function elapsedDays(from, to) {
  const start = dayNumber(from);
  const end = dayNumber(to);
  if (start === null || end === null) return null;
  return end - start;
}

const dayPhrase = (days) => `${days} ${Math.abs(days) === 1 ? "day" : "days"}`;

const releaseOf = (record, releasesById) => {
  for (const link of record?.links ?? []) {
    if (link?.type !== "release") continue;
    const release = releasesById.get(link.id);
    // A named-but-unreadable release still proves the decision shipped, so the
    // link is kept and only its date is missing.
    if (release || link.label) return { id: link.id, label: link.label || "an unnamed release", at: release?.createdAt ?? null };
  }
  return null;
};

/**
 * One decision's outcome, or `null` when the record has no outcome to draw.
 *
 * Two shapes qualify, and only two: a decision some release carries (a closed
 * span), and an accepted decision no release carries (an open one). A proposed
 * or pending decision without a release has not started the span this figure
 * measures, and a superseded one ended somewhere else entirely.
 */
export function decisionOutcome(record, { releasesById = new Map(), now = Date.now() } = {}) {
  if (record?.type !== "decision") return null;
  const recordedOn = dayOf(record.createdAt);
  if (!recordedOn) return null;
  const release = releaseOf(record, releasesById);
  const open = !release && record.status === "accepted";
  if (!release && !open) return null;
  const releasedOn = release?.at ? dayOf(release.at) : "";
  const days = elapsedDays(record.createdAt, release ? release.at : new Date(now).toISOString());
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    recordedOn,
    release: release ? { id: release.id, label: release.label, on: releasedOn } : null,
    releasedOn,
    // Closed: recorded → release. Open: recorded → now. `null` when the release
    // is linked but its date could not be read.
    days: releasedOn || open ? days : null,
    open,
  };
}

/**
 * Every drawable outcome in the view, newest recording first, capped.
 *
 * The order matches the list's default sort so the strips and the rows below
 * them read in the same direction. `total` counts every outcome the view holds,
 * including the ones the cap dropped, because the summary line has to say what
 * is not on screen.
 */
export function decisionOutcomes(records = [], { now = Date.now(), max = MAX_TIMELINE_STRIPS, releases } = {}) {
  const releasesById = new Map();
  // Release dates are looked up in the WHOLE log by default, not in the filtered
  // view: a filter that hides the release rows changes which decisions are
  // listed, and must not turn a decision's own release date into "unreadable".
  for (const record of releases ?? records) {
    if (record?.type === "release") releasesById.set(record.id, record);
  }
  const outcomes = [];
  for (const record of records) {
    const outcome = decisionOutcome(record, { releasesById, now });
    if (outcome) outcomes.push(outcome);
  }
  outcomes.sort((left, right) => (left.recordedOn < right.recordedOn ? 1 : left.recordedOn > right.recordedOn ? -1 : 0));
  return { shown: outcomes.slice(0, Math.max(0, max)), total: outcomes.length };
}

/**
 * The one accepted decision that has been waiting longest for a release, or
 * `null`. Ties break on the earlier recording, which for equal waits is the same
 * decision either way — the rule exists so the callout cannot flicker between
 * two rows on consecutive renders.
 */
export function longestOpenOutcome(outcomes = []) {
  let longest = null;
  for (const outcome of outcomes) {
    if (!outcome.open || outcome.days === null) continue;
    if (!longest || outcome.days > longest.days
      || (outcome.days === longest.days && outcome.recordedOn < longest.recordedOn)) longest = outcome;
  }
  return longest;
}

const spanPhrase = (outcome) => {
  if (outcome.days === null) return "the release date could not be read";
  if (outcome.days < 0) return `dated ${dayPhrase(-outcome.days)} before the decision was recorded`;
  return `${dayPhrase(outcome.days)} from recorded to release`;
};

/**
 * The whole figure in one sentence — the visible caption, and the same facts the
 * drawing carries. Every date, the status, the release, and the span: a reader
 * who never sees the strip is not reading a shorter story.
 */
export function timelineCaption(outcome) {
  const opening = `“${outcome.title}” — recorded ${formatFilterDate(outcome.recordedOn)}, ${outcome.status}`;
  if (outcome.open) {
    return `${opening}, no release linked yet, open ${dayPhrase(outcome.days ?? 0)}.`;
  }
  const on = outcome.releasedOn ? ` on ${formatFilterDate(outcome.releasedOn)}` : "";
  return `${opening}, shipped in ${outcome.release.label}${on}, ${spanPhrase(outcome)}.`;
}

/**
 * The drawing's accessible name. It says what the picture is before it says what
 * it shows, because a reader who lands on it out of context needs to know it is
 * a timeline; the caption below repeats the facts as visible text.
 */
export function timelineName(outcome) {
  return `Timeline: ${timelineCaption(outcome)}`;
}

/** Where the middle mark comes from, said once so no reader has to guess. */
export const STATUS_MARK_NOTE = "The middle mark on each strip is the status the decision reached."
  + " The log records no date for that transition, so it sits at the midpoint of the span rather than on a date.";

/** The line above the strips: how many outcomes there are, and how many are drawn. */
export function timelineSummary({ shown = 0, total = 0 } = {}) {
  if (total === 0) return "No decision in this view has a release outcome yet.";
  const noun = total === 1 ? "decision" : "decisions";
  if (shown >= total) return `${total} ${noun} with a release outcome.`;
  return `Showing the ${shown} most recently recorded of ${total} ${noun} with a release outcome.`;
}

/** The one prioritized action above the list, or `""` when nothing is open. */
export function nextActionSentence(outcome) {
  if (!outcome) return "";
  return `Settle “${outcome.title}” — accepted, recorded ${formatFilterDate(outcome.recordedOn)},`
    + ` and open ${dayPhrase(outcome.days)}, the longest wait of any accepted decision without a release.`;
}

/**
 * The clamped backing-store scale for a reported device pixel ratio.
 *
 * A ratio that is not a finite number is a browser that did not tell us, and the
 * safe answer there is 1: an oversized store is wasted memory, an undersized one
 * is a blurry strip, and 1 is the only value that can be wrong in neither
 * direction when the truth is unknown.
 */
export function stripRatio(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return Math.min(MAX_STRIP_RATIO, Math.max(1, ratio));
}

/**
 * The strip in device pixels: the backing-store size, the track, the marks, and
 * the dashes that end an open strip.
 *
 * EVERY NUMBER BELOW IS A DEVICE PIXEL. The CSS box stays `cssWidth × cssHeight`
 * and the store is that box times the clamped ratio, which is the pair that
 * makes a canvas sharp on a retina display: size the bitmap in device pixels,
 * size the element in CSS pixels, and never let one of them imply the other.
 * Positions are rounded to whole device pixels so a 2px rule is a 2px rule and
 * not a 3px smear across a boundary — the opposite of the trend chart's rule,
 * because that one is resampled vector and this one is rasterized once.
 *
 * The open strip is told from the closed one by shape, not colour: it has no end
 * cap, it stops short, and it trails off in dashes.
 */
export function stripGeometry(outcome, { ratio = 1, width = STRIP_CSS_WIDTH, height = STRIP_CSS_HEIGHT } = {}) {
  const scale = stripRatio(ratio);
  const px = (value) => Math.round(value * scale);
  const deviceWidth = px(width);
  const deviceHeight = px(height);
  const middle = px(height / 2);
  const left = px(STRIP_INSET);
  const right = deviceWidth - px(STRIP_INSET);
  const open = Boolean(outcome?.open);
  // An open strip's rule stops before the inset and the dashes carry on past it,
  // so the eye reads "continues" rather than "ends here without a mark".
  const trackEnd = open ? Math.round((left + right) / 2) : right;
  const capHeight = px(CAP_HEIGHT);
  const marks = [
    { kind: "recorded", shape: "cap", x: left, width: px(CAP_WIDTH), height: capHeight, y: middle - Math.round(capHeight / 2) },
    { kind: "status", shape: "dot", x: Math.round((left + right) / 2), y: middle, radius: px(MARK_RADIUS) },
  ];
  if (!open) {
    marks.push({ kind: "released", shape: "cap", x: right - px(CAP_WIDTH), width: px(CAP_WIDTH), height: capHeight, y: middle - Math.round(capHeight / 2) });
  }
  const dashes = [];
  if (open) {
    for (let index = 0; index < OPEN_DASHES; index += 1) {
      const start = trackEnd + px(DASH_GAP) + index * px(DASH_LENGTH + DASH_GAP);
      if (start + px(DASH_LENGTH) > deviceWidth) break;
      dashes.push({ x: start, width: px(DASH_LENGTH) });
    }
  }
  return {
    scale,
    cssWidth: width,
    cssHeight: height,
    deviceWidth,
    deviceHeight,
    track: { x: left, y: middle - Math.round(px(TRACK_HEIGHT) / 2), width: trackEnd - left, height: px(TRACK_HEIGHT) },
    marks,
    dashes,
    open,
  };
}
