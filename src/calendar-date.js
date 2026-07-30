// One rule for "is this string a real day", for every contract that reads a
// date off an imported export.
//
// It exists because the lenient answer is silently wrong. `Date.parse` accepts
// "2026-02-29" and hands back the first of March, so a period nobody can have
// billed for becomes a period with a length, a total, and a place in a ratio.
// Two contracts had already written this check by hand and a third had not,
// which is the shape of defect a shared rule removes rather than documents.
//
// No clock, no locale, no `Date`. A calendar is arithmetic.

/** Shape only. `calendarDate` is the answer to whether the day exists. */
export const CALENDAR_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

const MONTH_LENGTHS = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

/** Proleptic Gregorian, which is the calendar every provider export bills on. */
export const leapYear = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/**
 * The date, unchanged, when it is an ISO-8601 calendar date that exists — and
 * `null` when it is not. Never a corrected date: a caller that wanted February
 * 29th of a common year has misread its input, and the repair belongs in the
 * export, not here.
 */
export function calendarDate(value) {
  if (typeof value !== "string" || !CALENDAR_DATE_SHAPE.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) return null;
  const length = month === 2 && leapYear(year) ? 29 : MONTH_LENGTHS[month - 1];
  return day > length ? null : value;
}

/** The same question as a predicate, for callers that only branch on it. */
export const isCalendarDate = (value) => calendarDate(value) !== null;

/**
 * Whole days between two calendar dates, or `null` when either is not a real
 * day. Computed from the civil-day count rather than from a timestamp, so no
 * zone, leap second, or DST rule can move it.
 */
export function calendarDayDifference(start, end) {
  if (!isCalendarDate(start) || !isCalendarDate(end)) return null;
  return dayNumber(end) - dayNumber(start);
}

/** Days since 1970-01-01 for a validated calendar date. */
function dayNumber(value) {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  // Shift the year so leap days land at the end of it, then count.
  const era = Math.floor((month <= 2 ? year - 1 : year) / 400);
  const yearOfEra = (month <= 2 ? year - 1 : year) - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100)
    + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}
