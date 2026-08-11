// A forwarded `?department=<slug>` link, applied to /evolution.html (#1612).
//
// The parsing and the five figures are next door in
// src/finops-department-view-model.js and stay pure. Everything here touches a
// document, and only this document: it opens the department decision region,
// presses the department the address named, hands that region the reader's
// attention, and writes ONE sentence saying which answer is on screen and why.
//
// NO NEW TOP-LEVEL REGION. The sentence is created with `createElement` and
// appended INSIDE `#department-decision-panel`, which is already declared in the
// spine census and assigned to the `department` destination in
// src/finops-destination-regions.js. Those are hand-kept tables: a status
// paragraph parked beside the panel would be an undeclared region and three
// tests would say so, correctly. It is a child, so there is nothing to register
// and nothing to drift — and the document ships no new markup at all, which
// keeps this change off /evolution.html's byte budget.
//
// IT NEVER REDIRECTS AND NEVER SUBSTITUTES. An unknown, empty or malformed slug
// leaves the page exactly as it was and states the org-level answer's reason in
// the same voice src/destination-route.js already uses for a destination that
// did not resolve. The requested slug came off the URL and is
// attacker-controllable, so it reaches the document through `textContent` and
// never through markup.

import { revealFragmentTarget } from "./deep-link-disclosure.js";
import {
  BUNDLED_ANALYSIS_RECORD, DEPARTMENT_RESOLUTION, departmentViewModel,
} from "./finops-department-view-model.js";

/** The query parameter, the region it addresses, and the list it presses. */
export const FORWARDED_DEPARTMENT_PARAM = "department";
export const DEPARTMENT_PANEL_ID = "department-decision-panel";
const DEPARTMENT_LIST_ID = "department-priority";
const PROVENANCE_ID = "decision-provenance";

/** The one paragraph this module owns. Created on demand, never authored. */
export const FORWARDED_DEPARTMENT_NOTE_ID = "department-forward-note";

/**
 * The raw `?department=` value, or `undefined` when the address carries none.
 *
 * Raw pairs, values decoded one at a time: this page puts base64url shared-brief
 * payloads on the same query string elsewhere, and refusing the whole address
 * because a neighbouring parameter will not decode is a new way to lose one. A
 * value whose own escape is broken is handed back as it arrived rather than
 * dropped, so the reader is told what their link asked for.
 */
export function readForwardedDepartment(search) {
  const text = String(search ?? "").replace(/^[?#]/, "");
  for (const chunk of text.split("&")) {
    if (chunk === "") continue;
    const eq = chunk.indexOf("=");
    const name = eq < 0 ? chunk : chunk.slice(0, eq);
    if (name !== FORWARDED_DEPARTMENT_PARAM) continue;
    const raw = eq < 0 ? "" : chunk.slice(eq + 1);
    try {
      return decodeURIComponent(raw.replace(/\+/g, " "));
    } catch {
      return raw;
    }
  }
  return undefined;
}

/**
 * The sentence, placed directly under the region's provenance line so it is read
 * before any figure it qualifies. `.decision-provenance` is a class this page
 * already ships, so no stylesheet rule moves for this.
 *
 * `role="status"` is set on creation and the node then stays in the tree,
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
  node.setAttribute("data-forwarded-department", "true");
  const provenance = document.getElementById?.(PROVENANCE_ID);
  if (provenance?.parentNode === panel && provenance.nextSibling) {
    panel.insertBefore?.(node, provenance.nextSibling);
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
 * detail keeps one path into the drill-down — the click handler is what records
 * the selection on the address bar and repaints the panel.
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
 * The sentence a reader gets. Resolved names the department; every other branch
 * is the view model's own reason, which is already written in the page's voice.
 */
export function forwardedDepartmentMessage(viewModel) {
  if (viewModel?.reasonCode === DEPARTMENT_RESOLUTION.resolved) {
    return `Showing ${viewModel.name}, the department this link named.`;
  }
  return viewModel?.reason ?? "";
}

/**
 * Apply a forwarded department link to the page.
 *
 * Returns what it did rather than a boolean, so a caller — and a test — can tell
 * "resolved and pressed" apart from "resolved, but the drill-down has not
 * painted its controls yet". That second case is ordinary: the bundled seed
 * arrives long after boot, so /evolution.html calls this twice and the second
 * call presses. Applying an already-applied link presses nothing.
 *
 * `move` is false on the second call: a reader who has started reading must not
 * be thrown back up the page by a late fixture.
 */
export function applyForwardedDepartment(document, {
  search, record = BUNDLED_ANALYSIS_RECORD, move = true,
} = {}) {
  const requested = readForwardedDepartment(search);
  if (requested === undefined) {
    return Object.freeze({ requested: null, viewModel: null, message: "", pressed: false, revealed: false });
  }
  const viewModel = departmentViewModel(record, requested);
  const message = forwardedDepartmentMessage(viewModel);
  const note = noteNode(document);
  if (note) {
    // textContent, never markup: the slug inside this sentence is URL text.
    note.textContent = message;
    note.setAttribute("data-department-resolution", viewModel.reasonCode);
    note.hidden = message === "";
  }
  const panel = document?.getElementById?.(DEPARTMENT_PANEL_ID);
  panel?.setAttribute?.("data-forwarded-department", viewModel.slug ?? "");
  const pressed = viewModel.resolved ? pressDepartment(document, viewModel.slug) : false;
  // The region is opened and focused whichever way the slug resolved: a reader
  // who followed a department link is owed the department screen and the reason
  // their department is not the one on it, in that order and in one place.
  const revealed = move
    ? Boolean(revealFragmentTarget(document, `#${DEPARTMENT_PANEL_ID}`, { scroll: true, focus: true }))
    : false;
  return Object.freeze({
    requested: viewModel.requestedSlug,
    viewModel,
    message,
    pressed,
    revealed,
  });
}
