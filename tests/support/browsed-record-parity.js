// Field-for-field parity between the record a reader is *looking at* and the
// record the download actually carried.
//
// tests/support/export-parity.js compares an export against a fixture object.
// This module compares an export against the **rendered DOM** — the detail page
// a reader opens, read back the way a reader reads it — so a field that the
// history renders but the file drops (or the other way round) is caught even
// when the fixture and the exporter agree with each other.
//
// THE FAILURE MESSAGE IS THE DELIVERABLE. Every violation names the record and
// the field and prints both sides:
//
//   record "browsed-d-cache": field context differs — browsed "…", exported "…"
//
// Never a whole-payload dump, never a bare `expected true to be false`.
//
// --- what is normalized, and why -------------------------------------------
//
// Normalization is the *documented display rule*, applied once here, to the
// exported side only, so that both sides speak the rendered vocabulary. It is
// deliberately narrow: nothing is lower-cased, nothing is stripped of
// punctuation, and no empty value is folded into a non-empty one. Three rules,
// and the reason each exists:
//
//   1. WHITESPACE. The DOM collapses runs of whitespace when it renders text,
//      and textOf() reproduces that. So the exported string is collapsed the
//      same way before comparison. A changed word, a dropped clause, or a
//      different value still differs.
//   2. THE LEGACY DECISION STATUS. A browser can still hold decisions written
//      under the retired word "approved"; every surface reads that as
//      "accepted" (src/decision-status.js) while the file keeps the stored
//      word. That one mapping is applied to the exported status. It is spelled
//      out here rather than imported from the product so a change to the
//      product's mapping fails these tests instead of moving with them. Any
//      other pair of differing words is a difference.
//   3. A RELEASE WITH NO STORED STATUS. `status` is optional on a stored
//      release (src/releases.js: isRelease), the file omits the key entirely,
//      and releaseStatus() renders a documented default. So an *absent*
//      exported status is compared against that default. A release that does
//      carry a status is compared verbatim — a stored "planned" rendered as
//      "completed" is a real difference and still fails.
//
// Nothing here touches the DOM APIs the product uses, the clock, or the
// network: the readers take a rendered container, the normalizers take a parsed
// JSON object, and the checkers take the two plain results.

import { textOf } from "./browser.js";

// Rule 2, stated by this module rather than imported from the product.
const LEGACY_STATUS_DISPLAY = Object.freeze({ approved: "accepted" });
// Rule 3, likewise: the word src/releases.js renders for a release whose store
// holds no status at all.
const RELEASE_STATUS_WHEN_UNSET = "completed";

// Rule 1. Applied to the exported side so it reads the way the DOM rendered it.
const collapse = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const show = (value) => JSON.stringify(value);

// --- reading the rendered record -------------------------------------------

/**
 * The value beside a label in a rendered `.detail-meta` list.
 *
 * Both detail pages build the same `dt`/`dd` pair (src/decision-detail.js and
 * src/releases.js), so one reader serves both.
 */
export function renderedMetaValue(container, label) {
  const row = container.querySelectorAll(".detail-meta-row")
    .find((candidate) => textOf(candidate.querySelector(".detail-meta-label")) === label);
  if (!row) return null;
  return textOf(row.querySelector(".detail-meta-value"));
}

/**
 * The rendered decision detail page, as the four fields under test.
 *
 * `alternatives` is a collection: the view renders one card per alternative
 * (src/decision-detail.js: normalizeAlternatives turns the stored string into a
 * single "Recorded alternative" card, and renders none at all when the string
 * is empty). Reading the cards rather than a joined blob is what makes a
 * dropped or reordered alternative visible.
 */
export function renderedDecision(container) {
  const context = container.querySelector(".decision-context");
  return {
    context: context ? textOf(context.querySelector("p")) : null,
    alternatives: container.querySelectorAll(".alternative-summary").map(textOf),
    owner: renderedMetaValue(container, "Owner"),
    status: renderedMetaValue(container, "Status"),
  };
}

/**
 * The rendered release detail page, as the fields under test.
 *
 * `decisionIds` is an ordered collection: the page states it renders "every
 * decision linked to this release, in the order it was linked", so order is
 * part of the contract and is compared, not sorted away.
 */
export function renderedRelease(container) {
  const list = container.querySelector(".detail-decision-list");
  const decisionIds = (list ? list.querySelectorAll("a") : [])
    .map((anchor) => new URL(anchor.getAttribute("href"), "https://labs.wawalu.org").searchParams.get("id"))
    .filter((id) => id !== null);
  return {
    owner: renderedMetaValue(container, "Owner"),
    status: renderedMetaValue(container, "Status"),
    decisionIds,
  };
}

// --- the same fields, read off the exported JSON ----------------------------

export function exportedDecision(record) {
  const alternatives = collapse(record?.alternatives);
  return {
    context: collapse(record?.context),
    // Empty stays empty: a blank stored string is no alternatives, which is the
    // same thing the view renders as no cards.
    alternatives: alternatives === "" ? [] : [alternatives],
    owner: collapse(record?.owner),
    status: LEGACY_STATUS_DISPLAY[record?.status] ?? collapse(record?.status),
  };
}

export function exportedRelease(record) {
  return {
    owner: collapse(record?.owner),
    status: record?.status === undefined ? RELEASE_STATUS_WHEN_UNSET : collapse(record.status),
    decisionIds: Array.isArray(record?.decisionIds) ? [...record.decisionIds] : [],
  };
}

// --- the checkers -----------------------------------------------------------

const differs = (browsed, exported) => (Array.isArray(browsed) || Array.isArray(exported)
  ? show(browsed) !== show(exported)
  : browsed !== exported);

/**
 * Every field on which the rendered record and the exported record disagree.
 *
 * Only fields present on both sides are compared, so a caller asks for exactly
 * the fields its rendered surface shows.
 */
export function recordViolations(id, browsed, exported) {
  const violations = [];
  for (const field of Object.keys(browsed)) {
    if (!(field in exported)) continue;
    if (!differs(browsed[field], exported[field])) continue;
    violations.push(
      `record ${show(id)}: field ${field} differs — `
      + `browsed ${show(browsed[field])}, exported ${show(exported[field])}`,
    );
  }
  return violations;
}

const sorted = (ids) => [...ids].sort();
const idList = (ids) => `[${sorted(ids).map(show).join(", ")}]`;

/**
 * The symmetric difference between the ids on screen and the ids in the file,
 * reported in both directions and naming the ids on each side.
 *
 * A record in the file that the reader cannot see is as much a defect as a
 * record on screen that the file left out, so neither direction is a subset
 * check.
 */
export function idSetViolations(browsedIds, exportedIds, kind = "record") {
  const violations = [];
  const browsed = new Set(browsedIds);
  const exported = new Set(exportedIds);
  const droppedByExport = sorted([...browsed].filter((id) => !exported.has(id)));
  const unseenInBrowse = sorted([...exported].filter((id) => !browsed.has(id)));
  if (droppedByExport.length > 0) {
    violations.push(
      `${droppedByExport.length} ${kind}(s) missing from the export that the browsed history shows: `
      + idList(droppedByExport),
    );
  }
  if (unseenInBrowse.length > 0) {
    violations.push(
      `${unseenInBrowse.length} ${kind}(s) missing from the browsed history that the export carries: `
      + idList(unseenInBrowse),
    );
  }
  // Once each: a record listed twice in the file is a defect the set difference
  // above cannot see.
  const counts = new Map();
  for (const id of exportedIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, count] of counts) {
    if (count > 1) violations.push(`${kind} ${show(id)} appears ${count} times in the export, expected exactly once`);
  }
  return violations;
}
