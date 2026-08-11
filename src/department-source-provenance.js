// Which declared sources one department's figure rests on.
//
// WHAT THIS IS. A projection, not a second provenance model. The analysis
// document this repository ships already declares its two integrations once, at
// the top, and /evolution.html reads them there: `provenance.billingSource` and
// `organization.providers` are the provider usage and billing export, and
// `organization.hrisSource` is the HRIS org mapping the headcounts come from.
// This file narrows that one declaration to ONE DEPARTMENT and says whether it
// actually covers it. Nothing here re-declares a source, invents a source name,
// or opens a second format.
//
// WHY A DEPARTMENT NEEDS ITS OWN ANSWER. The declarations are document-level;
// coverage is not. A department the provider export carries no spend rows for
// has no cost behind its figure, and a department the HRIS mapping does not
// carry has no headcount — so the same two declarations are complete for one
// department and partial for the one below it. A director forwarded a deep link
// is judging the recoverable figure on this screen alone, and "the org page
// declares an HRIS source" is not the same claim as "this department is in it".
//
// PURE, AND NO CONNECTION OF ANY KIND. Declarations in, data out. No endpoint,
// no token, no credential, no provider call, no HRIS call, no network, no
// storage and no clock: `now` is the caller's, exactly as every dated figure in
// this repository takes it. A missing declaration, a department this analysis
// does not hold, and an empty declaration block are three different states and
// each one says which is missing. None of them throws, and none of them is
// coerced into a complete-looking answer.
//
// FRESHNESS IS THE ORG ANSWER'S OWN STRING. /evolution.html prints
// `provenance.generatedAt` as the day it is written in the data, so this does
// too — it adds no second date format. The only arithmetic is the shared
// calendar rule, used to say how far before the caller's own date that day is.

import { calendarDate, calendarDayDifference } from "./calendar-date.js";

/** Bump when a field, a status, or what one means changes. */
export const DEPARTMENT_SOURCE_VERSION = "department-source-provenance/1.0.0";

/** Complete, partial, or nothing declared. Never a fourth, quieter state. */
export const SOURCE_COMPLETENESS = Object.freeze({
  complete: "complete",
  partial: "partial",
  unavailable: "unavailable",
});

/** Why an answer is not complete, in stable codes the surface may reword. */
export const SOURCE_ABSENCE = Object.freeze({
  noProvider: "no-provider-export",
  noHris: "no-hris-source",
  noneDeclared: "no-declarations",
  unknownDepartment: "unknown-department",
});

/** The reader-facing name of each source, written once. */
export const SOURCE_NAME = Object.freeze({
  provider: "provider usage and billing export",
  hris: "HRIS headcount source",
});

/** A declared name, bounded, or null. Never a number, an object, or prose. */
function declared(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= 160 ? text : null;
}

/** The provider export's name, with the providers it aggregates when declared. */
function providerExportOf(provenance, organization) {
  const name = declared(provenance?.billingSource);
  if (!name) return null;
  const providers = (Array.isArray(organization?.providers) ? organization.providers : [])
    .map(declared).filter(Boolean);
  return providers.length ? `${name} (${providers.join(", ")})` : name;
}

/** "as of <day>", and how far before the caller's own date that is. */
function freshnessOf(asOf, now) {
  if (!asOf) return "as of an unrecorded date";
  const days = calendarDayDifference(asOf, calendarDate(now));
  if (days === null) return `as of ${asOf}`;
  if (days === 0) return `as of ${asOf}, the date this screen was read for`;
  const direction = days > 0 ? "before" : "after";
  const size = Math.abs(days);
  return `as of ${asOf}, ${size} day${size === 1 ? "" : "s"} ${direction} the date this screen was read for`;
}

/**
 * One department's provenance, from the declarations the org answer already reads.
 *
 * @param input.organization the analysis's `organization` block, or null.
 * @param input.provenance the analysis's `provenance` block, or null.
 * @param input.departments the analysed departments, as the document publishes them.
 * @param input.departmentId which department to answer for.
 * @param input.period the period already selected for that department, when the
 *   caller resolved one. Never re-derived here.
 * @param input.now an ISO calendar date the caller supplies, or null. This
 *   module reads no clock of its own.
 * @returns a frozen plain object. Never throws.
 */
export function departmentSourceProvenance({
  organization = null, provenance = null, departments = null,
  departmentId = null, period = null, now = null,
} = {}) {
  const list = Array.isArray(departments) ? departments : [];
  const slug = String(departmentId ?? "").trim().toLowerCase();
  const department = slug
    ? list.find((entry) => String(entry?.id ?? "").toLowerCase() === slug) ?? null
    : null;

  const providerExport = providerExportOf(provenance, organization);
  const hrisSource = declared(organization?.hrisSource) ?? declared(provenance?.orgSource);
  // Coverage, not existence. A declared export that carries no spend row for
  // this department stands behind nothing on this screen, and a declared HRIS
  // mapping that carries no headcount for it did not supply one.
  const spend = Number(department?.spendUsd);
  const headcount = Number(department?.headcount);
  const providerCovers = Boolean(providerExport) && Number.isFinite(spend) && spend > 0;
  const hrisCovers = Boolean(hrisSource) && Number.isFinite(headcount) && headcount > 0;

  const asOf = calendarDate(declared(provenance?.generatedAt));
  const covered = declared(period) ?? declared(department?.period)
    ?? declared(organization?.period);
  const freshness = freshnessOf(asOf, now);

  const absent = [];
  if (!providerCovers) absent.push(SOURCE_NAME.provider);
  if (!hrisCovers) absent.push(SOURCE_NAME.hris);
  const status = absent.length === 0 ? SOURCE_COMPLETENESS.complete
    : absent.length === 1 ? SOURCE_COMPLETENESS.partial
      : SOURCE_COMPLETENESS.unavailable;

  const reason = !department ? SOURCE_ABSENCE.unknownDepartment
    : status === SOURCE_COMPLETENESS.complete ? null
      : status === SOURCE_COMPLETENESS.unavailable ? SOURCE_ABSENCE.noneDeclared
        : providerCovers ? SOURCE_ABSENCE.noHris : SOURCE_ABSENCE.noProvider;

  return Object.freeze({
    version: DEPARTMENT_SOURCE_VERSION,
    departmentId: slug || null,
    status,
    reason,
    providerExport: providerCovers ? providerExport : null,
    hrisSource: hrisCovers ? hrisSource : null,
    period: covered,
    asOf,
    freshness,
    absent: Object.freeze(absent),
    // The one line a director reads without opening anything. The named absent
    // source is IN it, not only in the disclosure below it: a basis that is
    // incomplete has to say so where the figure is, or the reader who never
    // expands has been shown a complete-looking number.
    line: glanceLine({ status, reason, providerExport, hrisSource, covered, freshness }),
    rows: Object.freeze([
      row("Provider export", providerCovers ? providerExport : absentDetail(SOURCE_NAME.provider)),
      row("HRIS headcount source", hrisCovers ? hrisSource : absentDetail(SOURCE_NAME.hris)),
      row("Period covered", covered ?? "No period is stated for this department."),
      row("Freshness", `${freshness[0].toUpperCase()}${freshness.slice(1)}.`),
    ]),
  });
}

const row = (term, detail) => Object.freeze({ term, detail });

const absentDetail = (name) =>
  `None. No ${name} is declared for this department, and none is assumed in its place.`;

/** The at-a-glance sentence, one per state. Nothing here quotes an address bar. */
function glanceLine({ status, reason, providerExport, hrisSource, covered, freshness }) {
  const when = `${covered ?? "an unstated period"}, ${freshness}`;
  if (status === SOURCE_COMPLETENESS.complete) {
    return `Sources: ${providerExport} and ${hrisSource} — ${when}. `
      + "Both declared sources cover this department, and no live connection was used.";
  }
  if (reason === SOURCE_ABSENCE.unknownDepartment) {
    return "Sources: none. This analysis holds no department under the name in this "
      + "link, so no provider or HRIS source is declared for it and no figure rests on one.";
  }
  if (status === SOURCE_COMPLETENESS.unavailable) {
    return "Sources: incomplete. Neither a provider usage and billing export nor an HRIS "
      + "headcount source is declared for this department, so nothing on this screen states "
      + "what its figure rests on.";
  }
  if (reason === SOURCE_ABSENCE.noHris) {
    return `Sources: incomplete — no ${SOURCE_NAME.hris} is declared for this department. `
      + `The figure rests on ${providerExport} alone — ${when} — so it is spend only, `
      + "and nothing on this screen is per person.";
  }
  return `Sources: incomplete — no ${SOURCE_NAME.provider} is declared for this department. `
    + `Only ${hrisSource} covers it — ${when} — so no provider cost stands behind the figure.`;
}
