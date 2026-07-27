// One lookup for "what does this org unit get called on screen".
//
// A provider export names its org units the way the provider's billing system
// does: `seg-atlas`, `4f2a`, a cost-centre number. A leader reading a finding
// knows those units by their own names, so this module lets them rename one and
// have the rename show up at *every* place the unit is drawn — because a label
// that only applies where it was typed is worse than no label at all.
//
// Three properties this holds, and the reason each one matters:
//
//   1. **One lookup, one renderer.** `orgUnitDisplay()` decides the words and
//      `renderOrgUnit()` draws them. Any surface that renders an org-unit
//      identifier goes through them; nothing formats an id inline. A second
//      code path is how "applies everywhere" quietly stops being true.
//   2. **Browser-local, never sent.** The labels live in this browser's
//      `localStorage` under one key, wrapped exactly like
//      `src/social-identity.js` wraps it, because `localStorage` throws outright
//      in some privacy modes and a refused store must cost the convenience and
//      not the page. Nothing here is serialized into an export, a request, or a
//      URL: a leader's internal team names are their business.
//   3. **The raw id survives the rename.** The identifier a leader has to type
//      into the provider console stays on the element as its `title` and, once
//      renamed, as visible secondary text. A label is an alias, never a
//      replacement for the thing the export actually said.

export const ORG_UNIT_LABEL_STORAGE_KEY = "shiplog.finops.orgUnitLabels";
export const MAX_ORG_UNIT_LABEL_LENGTH = 60;
// A ceiling on how many aliases one browser keeps, so a scripted page cannot
// grow the entry without bound. Far above the number of org units a human
// renames by hand.
export const MAX_ORG_UNIT_LABELS = 200;

const EMPTY = Object.freeze({});

function cleanLabel(value) {
  const label = typeof value === "string" ? value.trim() : "";
  return label && label.length <= MAX_ORG_UNIT_LABEL_LENGTH ? label : "";
}

function cleanId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  return id && id.length <= MAX_ORG_UNIT_LABEL_LENGTH * 2 ? id : "";
}

/**
 * Every alias this browser holds, as a frozen `{ [orgUnitId]: label }`.
 *
 * A store that is blocked, absent, unparseable, or holding something other than
 * an object of strings yields no aliases rather than an error: the finding still
 * renders, with the identifiers the export actually carried.
 */
export function readOrgUnitLabels(storage) {
  let raw = null;
  try {
    raw = storage?.getItem(ORG_UNIT_LABEL_STORAGE_KEY);
  } catch {
    return EMPTY;
  }
  if (typeof raw !== "string" || !raw) return EMPTY;
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return EMPTY;
  const labels = {};
  for (const [key, value] of Object.entries(parsed).slice(0, MAX_ORG_UNIT_LABELS)) {
    const id = cleanId(key);
    const label = cleanLabel(value);
    if (id && label) labels[id] = label;
  }
  return Object.freeze(labels);
}

/**
 * Set or remove one alias, and return the whole set as it now stands.
 *
 * An empty or whitespace-only label is a removal, not a blank name: the unit
 * goes back to showing the identifier the export carried. That is the only
 * sensible reading of clearing the field, and it means a leader never has to
 * find a separate "reset this one" control.
 */
export function writeOrgUnitLabel(storage, orgUnitId, label) {
  const id = cleanId(orgUnitId);
  if (!id) return readOrgUnitLabels(storage);
  const next = { ...readOrgUnitLabels(storage) };
  const clean = cleanLabel(label);
  if (clean) {
    if (!(id in next) && Object.keys(next).length >= MAX_ORG_UNIT_LABELS) return Object.freeze(next);
    next[id] = clean;
  } else {
    delete next[id];
  }
  try {
    storage?.setItem(ORG_UNIT_LABEL_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A full or blocked store costs the alias, never the finding. What comes
    // back is what a reader would actually get on the next paint, so the
    // surface cannot show a name that did not survive the write.
    return readOrgUnitLabels(storage);
  }
  return Object.freeze(next);
}

/**
 * This browser's store, or nothing where it is refused outright.
 *
 * Acquiring it lives here rather than in the page: `localStorage` is a getter
 * that throws in some embedded contexts, and the aliases are the only thing on
 * the FinOps page that is written down at all — so exactly one module reaches
 * for it, and every page module stays free of storage entirely.
 */
export function browserOrgUnitLabelStorage(scope = globalThis) {
  try {
    return scope?.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Drop every alias. Wired into the page's existing reset, not a second button. */
export function clearOrgUnitLabels(storage) {
  try {
    storage?.removeItem(ORG_UNIT_LABEL_STORAGE_KEY);
  } catch {
    // Nothing to recover from: the aliases are a convenience with no downstream
    // reader, so a store that refuses the delete only keeps them one more visit.
  }
  return EMPTY;
}

/**
 * The single decision about what an org unit is called on screen.
 *
 * Precedence: this browser's alias, then the name the analysis carried, then the
 * raw identifier. An id nobody has renamed and the analysis has no name for
 * renders as itself — an unknown unit is a plain string, never an error and
 * never a blank cell.
 */
export function orgUnitDisplay(labels, orgUnitId, analysisLabel) {
  const id = cleanId(orgUnitId);
  const alias = id ? cleanLabel(labels?.[id]) : "";
  const source = cleanLabel(analysisLabel);
  const fallback = source || id;
  return Object.freeze({
    id,
    label: alias || fallback || "Unknown org unit",
    analysisLabel: source || null,
    renamed: Boolean(alias),
    // What the raw identifier is worth showing next to the alias: the string a
    // leader has to paste into their provider console to cross-reference.
    secondary: alias && id ? id : null,
  });
}

/**
 * The one renderer. `<span class="org-unit">` carrying the display words, the
 * raw identifier as a `title`, and — once renamed — the identifier again as
 * visible secondary text so it stays cross-referenceable.
 *
 * Everything is `textContent`; an org-unit name out of a customer file is a
 * string in a cell, never markup.
 */
export function renderOrgUnit(doc, display) {
  const node = doc.createElement("span");
  node.className = "org-unit";
  if (display.id) node.dataset.orgUnitId = display.id;
  node.dataset.renamed = display.renamed ? "true" : "false";
  const name = doc.createElement("span");
  name.className = "org-unit-name";
  name.textContent = display.label;
  node.append(name);
  if (display.secondary) {
    const raw = doc.createElement("span");
    raw.className = "org-unit-id";
    raw.textContent = display.secondary;
    node.append(raw);
  }
  if (display.id) {
    node.title = display.renamed
      ? `Your label “${display.label}” for org unit ${display.id}`
      : `Org unit ${display.id}`;
  }
  return node;
}

/**
 * Apply the aliases to a sentence the analysis composed.
 *
 * The finding contract writes its own headline and action text with the org-unit
 * name already inside it, and this UI does not get to rewrite the contract. What
 * it can honestly do is swap one whole name for the alias a leader chose for the
 * same unit, so the sentence above the table agrees with the table. Guarded to
 * names of two characters or more and to units that were actually renamed, so a
 * one-letter name can never chew through unrelated words.
 */
export function applyOrgUnitLabelsToText(text, labels, units) {
  if (typeof text !== "string" || !text) return text;
  let out = text;
  for (const unit of units ?? []) {
    const display = orgUnitDisplay(labels, unit?.id, unit?.analysisLabel);
    if (!display.renamed || !display.analysisLabel || display.analysisLabel.length < 2) continue;
    out = out.split(display.analysisLabel).join(display.label);
  }
  return out;
}
