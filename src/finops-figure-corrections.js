// Correcting a derived name or figure in place, on the line it is read (#1026).
//
// WHAT WAS MISSING. #1025 and #1051 put a marker on every figure in the bundled
// example brief that this page worked out rather than read, and #1050 made the
// confidence sentence say how much of the brief that covers. A reader who spots
// a derived name or figure that is simply WRONG still had nothing to do about
// it: the marker told them the page had inferred the value and then left them
// holding it. This module is the missing half — the correction happens on the
// same line as the marker, and the three things that speak for the brief (its
// headline sentence, the table of names and figures, and the confidence
// sentence) are re-rendered from one state object rather than patched.
//
// ONE STATE, ONE RENDER. `createCorrectionState` is the only place a value
// lives. Every control routes through `applyCorrection` / `revertCorrection` /
// `openEditor` / `closeEditor`, all of which return a NEW state, and
// `renderFigureCorrections` paints all three regions from it. There is no path
// that writes a value to one region and not the others, which is what keeps the
// headline, the table, and the derived share from disagreeing.
//
// A CORRECTION IS SUPPLIED, NOT DERIVED, and the arithmetic says so. The derived
// share in the confidence sentence counts values still standing on this page's
// own inference; a corrected one has left that set, so the share goes DOWN on a
// correction and back UP on a revert. A brief that kept claiming a value was
// derived after a reader typed over it would make the confidence sentence lie in
// the reader's favour, which is the one direction it must not lie in.
//
// THE DERIVED VALUE IS KEPT, NEVER RECOVERED FROM THE PAGE. `unit.derived` holds
// what this page inferred for the life of the state; revert reads it from there.
// Re-deriving it from rendered text would mean a second correction over the
// first could never be undone, and would make the DOM the source of truth for a
// figure — the exact inversion this module exists to prevent.
//
// NOTHING TYPED HERE BECOMES MARKUP. Every reader value reaches the page through
// `textContent`, `createTextNode`, or `input.value`, including the headline, the
// table cell, the confidence sentence, the polite announcement, and the spoken
// half of every control's accessible name. There is no `innerHTML` on this path
// and no reader value in an `href`, a `style`, or an event attribute.
//
// No clock, no storage, no request. A correction lives in this tab, in this
// page's memory, and goes when the tab does.

import { FIGURE_SOURCE, PROVENANCE_MARKERS } from "./finops-brief-provenance.js";
import {
  EXAMPLE_FIGURE_SOURCES, EXAMPLE_SOURCE, exampleSourceMarker,
} from "./finops-example-figure-sources.js";

/** Bump when a state, a marker word, or the arithmetic behind the share changes. */
export const FIGURE_CORRECTION_VERSION = "finops-figure-corrections/1.0.0";

/** The authored slots this module paints. `live` is the region's EXISTING polite
 *  region — a second one on the same region would announce twice. */
export const CORRECTION_IDS = Object.freeze({
  region: "finops-figure-corrections",
  headline: "finops-figure-corrections-headline",
  table: "finops-figure-corrections-table",
  rows: "finops-figure-corrections-rows",
  confidence: "finops-figure-corrections-confidence",
  live: "finops-first-run-live",
});

/**
 * The two correctable halves of one row.
 *
 * A reader who spots a wrong NAME and a reader who spots a wrong FIGURE are
 * doing the same thing to different words, so both go through one path rather
 * than two that could drift on focus handling or on the share arithmetic.
 */
export const CORRECTION_FIELDS = Object.freeze(["name", "figure"]);

const FIELD_WORDS = Object.freeze({
  name: Object.freeze({ noun: "name", column: "What the figure is called" }),
  figure: Object.freeze({ noun: "figure", column: "What it says" }),
});

/**
 * The marker a corrected value wears.
 *
 * It reuses the FILLED silhouette `finops-brief-provenance.js` already ships, on
 * the same reasoning the imported brief uses it: filled is the value that came
 * from a person's own hand, outline is a static classification this page made.
 * The words carry the whole meaning on their own, so no reader depends on
 * telling a solid outline from a filled one, and no new hue enters the page.
 */
export const CORRECTED_MARKER = Object.freeze({
  source: "corrected",
  label: "Corrected by reader",
  marked: true,
  silhouette: PROVENANCE_MARKERS[FIGURE_SOURCE.file].silhouette,
  tone: PROVENANCE_MARKERS[FIGURE_SOURCE.file].tone,
});

/** The longest correction this page will take. Longer is REFUSED, never cut: a
 *  silently truncated name is a name the reader did not write. */
export const MAX_CORRECTION_LENGTH = 160;

/** Deterministic control ids, so focus can be restored by id after a repaint
 *  rather than through a node reference the repaint has already thrown away. */
export const correctionControlId = (unitId, field, part) =>
  `finops-figure-correction-${unitId}-${field}-${part}`;

/** A control character in a typed name is a paste accident, not a name. Written
 *  as a code-point test rather than a character class so this file carries no
 *  control byte of its own. */
const hasControlCharacter = (text) => [...text].some((character) => {
  const code = character.codePointAt(0);
  return code < 0x20 || code === 0x7f;
});

/** A value this page will accept as a correction, or "". */
export function acceptedCorrection(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || trimmed.length > MAX_CORRECTION_LENGTH) return "";
  if (hasControlCharacter(trimmed)) return "";
  return trimmed;
}

/** Whether the derived value is a bare number, which decides the input type. */
export const isNumericValue = (value) =>
  typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim());

/**
 * The state every region on this block is painted from.
 *
 * `derived` is what this page inferred and never changes. `corrected` is what a
 * reader typed over it, or null. `editing` names the one value in the editing
 * state — one, because two open editors is two half-finished claims about the
 * same brief and no way to say which the reader meant.
 */
export function createCorrectionState(entries = EXAMPLE_FIGURE_SOURCES) {
  return Object.freeze({
    units: Object.freeze((entries ?? []).map((entry) => Object.freeze({
      id: entry.id,
      source: entry.source,
      derived: Object.freeze({ name: entry.qualifies, figure: entry.value }),
      corrected: Object.freeze({ name: null, figure: null }),
    }))),
    editing: null,
  });
}

/** What one field currently says: the reader's correction, else the derivation. */
export const unitValue = (unit, field) => unit?.corrected?.[field] ?? unit?.derived?.[field] ?? "";

/** Whether a reader stands behind this value. */
export const isCorrected = (unit, field) => typeof unit?.corrected?.[field] === "string";

/** One unit by id, or null. Nothing in this module is positional. */
export const correctionUnit = (state, unitId) =>
  (state?.units ?? []).find((unit) => unit.id === unitId) ?? null;

/** The marker for one field — corrected first, then whatever the page inferred. */
export const fieldMarker = (unit, field) =>
  (isCorrected(unit, field) ? CORRECTED_MARKER : exampleSourceMarker(unit?.source));

/** Only a value this page inferred is correctable. A value read straight out of
 *  the files is not this module's to argue with. */
export const isCorrectable = (unit, field) =>
  isCorrected(unit, field) || Boolean(exampleSourceMarker(unit?.source).marked);

function withUnit(state, unitId, change) {
  return Object.freeze({
    ...state,
    units: Object.freeze(state.units.map((unit) => (unit.id === unitId ? change(unit) : unit))),
  });
}

/** Put one value into the editing state. Opening a second closes the first with
 *  nothing committed — an abandoned edit is not a correction. */
export const openEditor = (state, unitId, field) => Object.freeze({
  ...state,
  editing: CORRECTION_FIELDS.includes(field) && correctionUnit(state, unitId)
    ? Object.freeze({ unitId, field }) : null,
});

/** Leave the editing state, discarding whatever was typed. */
export const closeEditor = (state) => Object.freeze({ ...state, editing: null });

/** Write a reader's correction into state. A refused value leaves the value as
 *  it was, which is the derivation, not an empty cell. */
export function applyCorrection(state, unitId, field, value) {
  const accepted = acceptedCorrection(value);
  if (!accepted || !CORRECTION_FIELDS.includes(field) || !correctionUnit(state, unitId)) {
    return closeEditor(state);
  }
  return closeEditor(withUnit(state, unitId, (unit) => Object.freeze({
    ...unit,
    corrected: Object.freeze({ ...unit.corrected, [field]: accepted }),
  })));
}

/** Put the derived value back, from state and never from the rendered page. */
export function revertCorrection(state, unitId, field) {
  if (!CORRECTION_FIELDS.includes(field) || !correctionUnit(state, unitId)) return closeEditor(state);
  return closeEditor(withUnit(state, unitId, (unit) => Object.freeze({
    ...unit,
    corrected: Object.freeze({ ...unit.corrected, [field]: null }),
  })));
}

/**
 * How much of this block is still the page's own inference.
 *
 * Counted over FIELDS rather than rows, because a row with a corrected name and
 * a derived figure is half supplied and a row count cannot say so.
 */
export function correctionCounts(state) {
  let total = 0;
  let derivedCount = 0;
  let correctedCount = 0;
  for (const unit of state?.units ?? []) {
    for (const field of CORRECTION_FIELDS) {
      total += 1;
      if (isCorrected(unit, field)) correctedCount += 1;
      else if (unit.source === EXAMPLE_SOURCE.derived) derivedCount += 1;
    }
  }
  return {
    total,
    derivedCount,
    correctedCount,
    derivedShare: total === 0 ? 0 : Math.round((derivedCount / total) * 100),
  };
}

/** The block's headline: the lead figure in its own words, then how much of what
 *  follows this page worked out for itself. */
export function headlineText(state) {
  const lead = state?.units?.[0] ?? null;
  const { derivedCount, total } = correctionCounts(state);
  const opening = lead ? `${unitValue(lead, "name")}: ${unitValue(lead, "figure")}. ` : "";
  return `${opening}${derivedCount} of the ${total} names and figures below were `
    + "derived on this page rather than read from the example's export files.";
}

/** The confidence sentence, recomputed honestly on every correction. */
export function confidenceText(state) {
  const { derivedShare, derivedCount, total, correctedCount } = correctionCounts(state);
  const supplied = correctedCount === 0
    ? "Nothing below has been corrected by a reader yet."
    : `${correctedCount} of them ${correctedCount === 1 ? "has" : "have"} been corrected by a `
      + "reader and now counts as supplied, not derived.";
  return "Confidence in this brief is bounded by how much of it was derived: "
    + `${derivedShare}% of it still is (${derivedCount} of ${total}). ${supplied}`;
}

/** What the polite region says once, after a correction or a revert. */
export function correctionAnnouncement(state, unitId, field, { reverted = false } = {}) {
  const unit = correctionUnit(state, unitId);
  const { derivedShare } = correctionCounts(state);
  const noun = FIELD_WORDS[field]?.noun ?? "value";
  const name = unitValue(unit, "name");
  const opening = reverted
    ? `Reverted the ${noun} for ${name} to the derived value ${unit?.derived?.[field] ?? ""}.`
    : `Corrected the ${noun} for ${name} to ${unitValue(unit, field)}.`;
  return `${opening} The brief is now ${derivedShare}% derived.`;
}

// ---------------------------------------------------------------------------
// PAINTING. Nodes are built, never assigned as markup.
// ---------------------------------------------------------------------------

const byId = (doc, id) => doc.getElementById?.(id) ?? null;

/** A control whose visible words say what it does and whose spoken name says
 *  which value it does it to. */
function control(doc, { id, visible, spoken, onClick }) {
  const button = doc.createElement("button");
  button.id = id;
  button.className = "figure-corrections-control";
  button.setAttribute("type", "button");
  const suffix = doc.createElement("span");
  suffix.className = "visually-hidden";
  suffix.textContent = ` ${spoken}`;
  button.replaceChildren(doc.createTextNode(visible), suffix);
  if (onClick) button.addEventListener("click", onClick);
  return button;
}

function markerChip(doc, unit, field) {
  const marker = fieldMarker(unit, field);
  if (!marker.marked) return null;
  const chip = doc.createElement("span");
  chip.className = "brief-provenance";
  chip.dataset.provenance = marker.source;
  chip.dataset.silhouette = marker.silhouette;
  chip.dataset.tone = marker.tone;
  // Spoken, not drawn: a screen-reader user landing on the chip is told which
  // value it qualifies before they are told anything about it.
  const scope = doc.createElement("span");
  scope.className = "visually-hidden";
  scope.textContent = `${unitValue(unit, "name")}, ${FIELD_WORDS[field].noun}: `;
  const label = doc.createElement("span");
  label.className = "brief-provenance-label";
  label.textContent = marker.label;
  chip.replaceChildren(scope, label);
  return chip;
}

/**
 * The editing state for one value: a real labelled field, an explicit Apply, and
 * an explicit Cancel.
 *
 * Enter commits and Escape cancels from inside the field, and nothing commits on
 * blur — tabbing through this table must never write a correction a reader was
 * only passing over.
 */
function editorParts(doc, unit, field, handlers) {
  const noun = FIELD_WORDS[field].noun;
  const name = unitValue(unit, "name");
  const inputId = correctionControlId(unit.id, field, "input");
  const label = doc.createElement("label");
  label.className = "visually-hidden";
  label.setAttribute("for", inputId);
  label.textContent = `Corrected ${noun} for ${name}`;
  const input = doc.createElement("input");
  input.id = inputId;
  input.className = "figure-corrections-input";
  input.setAttribute("type", isNumericValue(unit.derived[field]) ? "number" : "text");
  input.setAttribute("maxlength", String(MAX_CORRECTION_LENGTH));
  input.dataset.unitId = unit.id;
  input.dataset.field = field;
  input.value = unitValue(unit, field);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault?.();
      handlers.commit(unit.id, field, input.value);
    } else if (event.key === "Escape") {
      event.preventDefault?.();
      handlers.cancel(unit.id, field);
    }
  });
  return [
    label,
    input,
    control(doc, {
      id: correctionControlId(unit.id, field, "commit"),
      visible: "Apply",
      spoken: `the corrected ${noun} for ${name}`,
      onClick: () => handlers.commit(unit.id, field, input.value),
    }),
    control(doc, {
      id: correctionControlId(unit.id, field, "cancel"),
      visible: "Cancel",
      spoken: `correcting the ${noun} for ${name}`,
      onClick: () => handlers.cancel(unit.id, field),
    }),
  ];
}

/** One value, its marker, and the one or two controls that act on it. */
function fieldCell(doc, state, unit, field, handlers, { tag = "td" } = {}) {
  const cell = doc.createElement(tag);
  cell.className = "figure-corrections-cell";
  cell.dataset.field = field;
  if (tag === "th") cell.setAttribute("scope", "row");
  const corrected = isCorrected(unit, field);
  cell.dataset.provenance = fieldMarker(unit, field).source;
  cell.dataset.corrected = String(corrected);

  const editing = state.editing?.unitId === unit.id && state.editing?.field === field;
  if (editing) {
    cell.dataset.editing = "true";
    cell.replaceChildren(...editorParts(doc, unit, field, handlers));
    return cell;
  }

  const noun = FIELD_WORDS[field].noun;
  const name = unitValue(unit, "name");
  const value = doc.createElement("span");
  value.className = "figure-corrections-value";
  value.textContent = unitValue(unit, field);
  const parts = [value];
  const chip = markerChip(doc, unit, field);
  if (chip) parts.push(chip);
  if (isCorrectable(unit, field)) {
    parts.push(control(doc, {
      id: correctionControlId(unit.id, field, "edit"),
      visible: corrected ? `Edit ${noun}` : `Edit inferred ${noun}`,
      spoken: `for ${name}`,
      onClick: () => handlers.edit(unit.id, field),
    }));
  }
  if (corrected) {
    parts.push(control(doc, {
      id: correctionControlId(unit.id, field, "revert"),
      visible: `Restore derived ${noun}`,
      spoken: `for ${name}`,
      onClick: () => handlers.revert(unit.id, field),
    }));
  }
  cell.replaceChildren(...parts);
  return cell;
}

const NO_HANDLERS = Object.freeze({
  edit() {}, commit() {}, cancel() {}, revert() {},
});

/** The column headings, so the authored table and the module agree on them. */
export const CORRECTION_COLUMNS = Object.freeze([
  FIELD_WORDS.name.column, FIELD_WORDS.figure.column,
]);

/**
 * Paint the headline, the table, and the confidence sentence — all three, from
 * one state, on every change. There is no partial repaint.
 *
 * @returns the counts it painted, so a caller can assert on what it asked for.
 */
export function renderFigureCorrections(doc, state, handlers = NO_HANDLERS) {
  const counts = correctionCounts(state);
  const headline = byId(doc, CORRECTION_IDS.headline);
  if (headline) headline.textContent = headlineText(state);

  const rows = byId(doc, CORRECTION_IDS.rows);
  if (rows) {
    rows.replaceChildren(...state.units.map((unit) => {
      const row = doc.createElement("tr");
      row.className = "figure-corrections-row";
      row.dataset.unitId = unit.id;
      row.dataset.source = unit.source;
      row.append(
        fieldCell(doc, state, unit, "name", handlers, { tag: "th" }),
        fieldCell(doc, state, unit, "figure", handlers),
      );
      return row;
    }));
  }
  const table = byId(doc, CORRECTION_IDS.table);
  if (table) table.hidden = state.units.length === 0;

  const confidence = byId(doc, CORRECTION_IDS.confidence);
  if (confidence) {
    confidence.textContent = confidenceText(state);
    confidence.dataset.derivedShare = String(counts.derivedShare);
    confidence.dataset.derived = String(counts.derivedCount);
    confidence.dataset.corrected = String(counts.correctedCount);
  }
  const region = byId(doc, CORRECTION_IDS.region);
  if (region) {
    region.dataset.corrected = String(counts.correctedCount);
    region.dataset.editing = state.editing
      ? `${state.editing.unitId}:${state.editing.field}` : "";
  }
  return counts;
}

/**
 * Mount the block: build the state, paint it, and keep focus where the reader
 * put it across every repaint.
 *
 * FOCUS IS RESTORED BY ID, NEVER BY NODE. A commit re-renders the cell, so the
 * button the reader pressed no longer exists; the control that replaces it
 * carries the same deterministic id, and that is what is focused. Holding the
 * old node would put focus on an element no longer in the document, which in a
 * real browser drops the reader back at the top of the page.
 */
export function mountFigureCorrections(doc, { entries = EXAMPLE_FIGURE_SOURCES } = {}) {
  const region = byId(doc, CORRECTION_IDS.region);
  if (!region) return null;
  let state = createCorrectionState(entries);
  let focusId = null;

  const announce = (text) => {
    const live = byId(doc, CORRECTION_IDS.live);
    if (live) live.textContent = text;
  };
  const paint = () => {
    renderFigureCorrections(doc, state, handlers);
    if (!focusId) return;
    byId(doc, focusId)?.focus?.();
    focusId = null;
  };
  const handlers = Object.freeze({
    edit(unitId, field) {
      state = openEditor(state, unitId, field);
      focusId = correctionControlId(unitId, field, "input");
      paint();
    },
    commit(unitId, field, value) {
      const accepted = acceptedCorrection(value);
      state = applyCorrection(state, unitId, field, value);
      focusId = correctionControlId(unitId, field, "edit");
      paint();
      if (accepted) announce(correctionAnnouncement(state, unitId, field));
    },
    cancel(unitId, field) {
      state = closeEditor(state);
      focusId = correctionControlId(unitId, field, "edit");
      paint();
    },
    revert(unitId, field) {
      state = revertCorrection(state, unitId, field);
      focusId = correctionControlId(unitId, field, "edit");
      paint();
      announce(correctionAnnouncement(state, unitId, field, { reverted: true }));
    },
  });

  paint();
  return Object.freeze({
    get state() { return state; },
    render: paint,
  });
}
