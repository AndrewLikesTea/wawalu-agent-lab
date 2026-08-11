// A forwarded `?department=<slug>` link, applied to /evolution.html (#1612).
//
// The five figures and the resolution are next door in
// src/finops-department-view-model.js and stay pure. Everything here touches a
// document, and only this one: it opens the department disclosure, presses the
// department the address named, hands that region the reader's attention, and
// writes ONE sentence saying which answer is on screen and why.
//
// NO NEW TOP-LEVEL REGION, DELIBERATELY. The sentence is created with
// `createElement` and appended INSIDE `#department-decision-panel`, which is
// already inside `#disclosure-department-priority` — a region the spine census
// declares and src/finops-destination-regions.js assigns to the department
// destination. Those are hand-kept tables. A status paragraph parked beside the
// disclosure would be a top-level region none of them names, and three
// structural gates would say so, correctly. As a child there is nothing to
// register and nothing to drift, and the document ships no new markup at all,
// which also keeps this change off /evolution.html's byte budget.
//
// IT NEVER REDIRECTS AND NEVER SUBSTITUTES. An unknown, missing or malformed
// slug leaves the ranked list exactly as the page painted it and states the
// org-level reason in one sentence. The requested value came off the URL and is
// attacker-controllable, so it reaches the document through `textContent` and
// never through markup.

import { revealFragmentTarget } from "./deep-link-disclosure.js";
import { DEPARTMENT_RESOLUTION, departmentViewModel } from "./finops-department-view-model.js";

/** The query parameter, the region it addresses, and the list it presses. */
export const FORWARDED_DEPARTMENT_PARAM = "department";
export const DEPARTMENT_PANEL_ID = "department-decision-panel";
const DEPARTMENT_LIST_ID = "department-priority";
const PROVENANCE_ID = "decision-provenance";

/** The one paragraph this module owns. Created on demand, never authored. */
export const FORWARDED_DEPARTMENT_NOTE_ID = "department-forwarded-note";

/**
 * The raw `?department=` value, `undefined` when the address carries none, and
 * an array when it carries more than one.
 *
 * Raw pairs, decoded one value at a time: this page puts base64url shared-brief
 * payloads on the same query string elsewhere, and refusing the whole address
 * because a neighbouring parameter will not decode is a new way to lose a link.
 * A value whose own escape is broken is handed back as it arrived rather than
 * dropped, so the selector can say the name could not be read instead of saying
 * no name was given. Two values are handed back as two: an address that names
 * two departments has named none, and the selector is where that is decided.
 */
export function readForwardedDepartment(search) {
  const text = String(search ?? "").replace(/^[?#]/, "");
  const found = [];
  for (const chunk of text.split("&")) {
    if (chunk === "") continue;
    const eq = chunk.indexOf("=");
    const name = eq < 0 ? chunk : chunk.slice(0, eq);
    if (name !== FORWARDED_DEPARTMENT_PARAM) continue;
    const raw = eq < 0 ? "" : chunk.slice(eq + 1);
    try {
      found.push(decodeURIComponent(raw.replace(/\+/g, " ")));
    } catch {
      found.push(raw);
    }
  }
  if (found.length === 0) return undefined;
  return found.length === 1 ? found[0] : found;
}

/**
 * The sentence's node, placed directly under the region's provenance line so it
 * is read before any figure it qualifies. `.decision-provenance` is a class this
 * page already ships, so no stylesheet rule moves for this.
 *
 * `role="status"` is set at creation and the node then stays in the tree,
 * emptied rather than removed: a live region inserted at the moment it first has
 * text is frequently not announced at all, and a node left holding an old
 * sentence would describe a department the reader has since left.
 */
function noteNode(document) {
  const existing = document?.getElementById?.(FORWARDED_DEPARTMENT_NOTE_ID);
  if (existing) return existing;
  const panel = document?.getElementById?.(DEPARTMENT_PANEL_ID);
  if (!panel) return null;
  const node = document.createElement("p");
  node.id = FORWARDED_DEPARTMENT_NOTE_ID;
  node.className = "decision-provenance";
  node.setAttribute("role", "status");
  // Placed by index rather than by `nextSibling`, so the slot is the same one
  // whether the children collection counts text nodes or not.
  const provenance = document.getElementById?.(PROVENANCE_ID);
  const siblings = [...(panel.children ?? [])];
  const after = provenance ? siblings[siblings.indexOf(provenance) + 1] : null;
  if (provenance && siblings.includes(provenance) && after) {
    panel.insertBefore?.(node, after);
  } else {
    panel.append?.(node);
  }
  return node;
}

/**
 * Press the ranked control for one department, if the drill-down has painted
 * one yet.
 *
 * Scoped to the decision region's own list by walking its children: the same
 * `data-department-id` marker is carried by the imported-finding list further
 * down the page, and a document-wide query would press whichever of the two the
 * markup happened to put first. Pressing the control rather than writing the
 * detail keeps ONE path into the drill-down — the click handler is what records
 * the selection and repaints the panel.
 */
function pressDepartment(document, slug) {
  const list = document?.getElementById?.(DEPARTMENT_LIST_ID);
  if (!list || !slug) return false;
  const walk = (node) => {
    for (const child of node?.children ?? []) {
      if (child?.nodeType !== 1) continue;
      if (child.dataset?.departmentId === slug) return child;
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  const control = walk(list);
  if (!control) return false;
  if (control.getAttribute?.("aria-pressed") !== "true") control.click?.();
  return true;
}

/**
 * Apply a forwarded department link to the page.
 *
 * Returns what it did rather than a boolean, so a caller — and a test — can tell
 * "resolved and pressed" apart from "resolved, but the drill-down has not
 * painted its controls yet". That second case is ordinary: the bundled seed
 * arrives long after boot, so /evolution.html calls this twice and the second
 * call presses.
 *
 * `move` is false on that second call: a reader who has already started reading
 * must not be thrown back up the page by a late fixture.
 */
export function applyForwardedDepartment(document, { search, record, move = true } = {}) {
  const requested = readForwardedDepartment(search);
  const nothing = Object.freeze({
    requested: null, model: null, sentence: "", pressed: false, revealed: false,
  });
  if (requested === undefined) return nothing;

  const model = departmentViewModel(record, requested);
  const note = noteNode(document);
  if (note) {
    // textContent, never markup: the value inside this sentence is URL text.
    note.textContent = model.sentence;
    note.setAttribute("data-department-resolution", model.reasonCode);
  }
  const panel = document?.getElementById?.(DEPARTMENT_PANEL_ID);
  panel?.setAttribute?.("data-forwarded-department", model.slug ?? "");
  const pressed = model.resolved ? pressDepartment(document, model.slug) : false;
  // Opened and focused whichever way the slug resolved: a reader who followed a
  // department link is owed the department region and, if their department is
  // not the one on it, the reason — in that order and in one place. A record
  // that could not be read at all is the exception; there is nothing there to
  // send them to.
  const revealed = move && model.reasonCode !== DEPARTMENT_RESOLUTION.unreadable
    ? Boolean(revealFragmentTarget(document, `#${DEPARTMENT_PANEL_ID}`, { scroll: true, focus: true }))
    : false;
  return Object.freeze({
    requested: model.requestedSlug, model, sentence: model.sentence, pressed, revealed,
  });
}
