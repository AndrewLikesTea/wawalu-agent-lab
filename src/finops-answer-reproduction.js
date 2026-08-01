// Does the answer still come out the same? — the one line that says so.
//
// #833 put a provenance record beside each published figure: which keys were
// consumed, over how many rows, by what method, and when. That makes the number
// traceable. It does not make it REPRODUCIBLE — a lead who forwarded last week's
// answer still cannot tell whether the scoring bands or the ranking rule moved
// underneath it since. So a pinned synthetic snapshot is fed through the same
// two functions the page calls — gradeExport(), then answerBlock() — and the
// headline metric, the ranked action and the confidence tier are compared field
// by field: tests/finops-answer-reproduction.test.js over the fixture named
// below. This module renders the result of that check as one plain sentence.
//
// THE LINE MAY NOT OUTRUN THE CHECK. Three rules hold it to what ran:
//
// 1. THE DATE IS AN ARTIFACT, NOT A LITERAL. It comes from the stamp file the
//    check itself writes, after every field agreed. Nothing here reads a clock,
//    at import or at call, so the sentence cannot age into a claim on the shelf.
//
// 2. A STAMP THAT DOES NOT VALIDATE IS NO STAMP. Wrong version, malformed date,
//    unrecognisable revision, no figures listed — each returns the unavailable
//    line, which says plainly that this build carries no record of the check. A
//    reader is never reassured by a field nobody could parse.
//
// 3. NOTHING FROM THE FIXTURE REACHES THE PAGE. The sentence is authored here
//    and carries exactly one value out of the artifact: a date that matched
//    `YYYY-MM-DD`. Fixture prose, department names and revision ids are for the
//    test's failure output and stay there; the surface writes this through
//    `textContent` as well, so the boundary is closed twice.
//
// WHAT IT CLAIMS, precisely: that the RULES behind the answer still reproduce a
// pinned example — not that a reader's own imported figure was re-derived, which
// nothing checks and nothing could. Worded that way on purpose, so a reader who
// imported their own export gets the same true sentence.

import STAMP from "./finops-answer-reproduction-stamp.json" with { type: "json" };

/** Bump when a field of the stamp, or what one means, changes. */
export const REPRODUCTION_STAMP_VERSION = "finops-answer-reproduction-stamp/1.0.0";

/** The check and the snapshot it runs, named once so the PR and the page agree. */
export const REPRODUCTION_CHECK = Object.freeze({
  fixture: "tests/fixtures/finops-answer-reproduction.json",
  test: "tests/finops-answer-reproduction.test.js",
});

/** A calendar day and nothing else. A time, an offset, or prose does not pass. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The revision id the stamp and the fixture must agree on. Never rendered. */
const REVISION = /^[A-Za-z][A-Za-z0-9-]*\/\d+$/;

/** The day, in words, from a validated `YYYY-MM-DD`. UTC, so the day cannot slip. */
const DAY = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });

/** What the block says when no usable record of the check shipped. */
export const REPRODUCTION_UNAVAILABLE =
  "This copy of the page carries no record of that check having run, so treat the "
  + "figure above as unchecked rather than confirmed.";

/**
 * Is this a stamp a claim may be built on? Total, and deliberately strict: the
 * four fields the sentence depends on must each be present and well-formed.
 * Returns the parsed day, or null.
 */
export function readReproductionStamp(stamp = STAMP) {
  if (!stamp || typeof stamp !== "object") return null;
  if (stamp.version !== REPRODUCTION_STAMP_VERSION) return null;
  const day = typeof stamp.checkedOn === "string" ? stamp.checkedOn.trim() : "";
  if (!ISO_DAY.test(day)) return null;
  const instant = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(instant.getTime())) return null;
  const revision = typeof stamp.fixtureRevision === "string" ? stamp.fixtureRevision.trim() : "";
  if (!REVISION.test(revision)) return null;
  const figures = Array.isArray(stamp.figuresChecked)
    ? stamp.figuresChecked.filter((name) => typeof name === "string" && name.trim()) : [];
  if (figures.length === 0) return null;
  return Object.freeze({ day, revision, figures: Object.freeze([...figures]), instant });
}

/**
 * The one sentence the answer block renders, and whether it is a claim at all.
 * `available: false` is not an error state — it is the honest one, and its text
 * says so. A caller paints the text either way.
 */
export function reproductionLine(stamp = STAMP) {
  const read = readReproductionStamp(stamp);
  if (!read) {
    return Object.freeze({ available: false, checkedOn: null, text: REPRODUCTION_UNAVAILABLE });
  }
  return Object.freeze({
    available: true,
    checkedOn: read.day,
    text: "Checked: run against a pinned example, the rules behind this answer still produce the "
      + `same number, the same next step, and the same confidence level. Last checked ${DAY.format(read.instant)}.`,
  });
}

/** The line for the stamp this build shipped. One evaluation, at import. No clock. */
export const ANSWER_REPRODUCTION = reproductionLine(STAMP);
