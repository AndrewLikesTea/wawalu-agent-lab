// Land a forwarded `/evolution.html?department=<slug>` on the department it
// names: open, selected, focused — or on a stated reason it could not.
//
// WHAT IT DOES NOT DO. It computes nothing. Every figure and every sentence it
// writes is `departmentViewModel()`'s, from src/finops-department-view-model.js,
// which is pure and testable without a page. This file is the DOM half and only
// the DOM half: which node the sentence goes in, which disclosure opens, which
// control is pressed, and where the keyboard ends up.
//
// IT ADDS NO REGION. The status sentence is a paragraph INSIDE the department
// decision panel the page already ships, so the top-level region census in
// src/finops-destination-regions.js, tests/finops-spine.test.js and
// tests/finops-workspace-shell.test.js is unchanged. A forwarded link needs a
// resolved department, not a new place to put one.
//
// IT ADDS NO TAB STOP. Focus is moved to `#department-decision-panel`, which is
// already `tabindex="-1"` because the workspace rail already hands it the
// keyboard. Nothing focusable is created anywhere, which matters most on the
// first screen, where the tab order is asserted by other files.
//
// THE SENTENCE IS NOT A LIVE REGION, AND THE DISCLOSURE IS OPENED FOR IT. The
// panel lives inside a collapsed `details`, which is not rendered, so a live
// region inside one announces to nobody while the harness reads its text anyway —
// exactly the drift tests/finops-how-we-know.test.js refuses. So the slot is
// ordinary content of the panel, and on every path where this file has something
// a reader must see — a resolved department, or a link naming a department this
// analysis does not hold — the disclosure is opened and the panel is where the
// reader ends up. On the paths where the address asked for nothing, nothing is
// opened and nothing is stolen: the page a reader typed for is the page they get.

import { DEPARTMENT_FALLBACK } from "./finops-department-view-model.js";
// The shell owns which destination is on screen and which ranked choice is
// pressed. This file asks it rather than re-implementing either: a second opinion
// about what is visible is how a workspace ends up showing two screens at once.
import { applyScreenRoute } from "./finops-workspace-shell.js";

/** The authored paragraph the resolution sentence is written into. */
export const FORWARDED_STATUS_ID = "department-forwarded-status";

/** The disclosure that holds the department decision, and the panel inside it. */
export const DEPARTMENT_DISCLOSURE_ID = "disclosure-department-priority";
export const DEPARTMENT_PANEL_ID = "department-decision-panel";

/** The shell destination the department decision belongs to. */
export const DEPARTMENT_DESTINATION = "department";

/**
 * The two fallbacks that mean somebody sent a link that does not work.
 *
 * They are opened and the other two are not, and the difference is whose mistake
 * it was: a reader who typed `/evolution.html` asked for the organization answer
 * and gets it undisturbed, while a reader who followed a forwarded link that
 * named `atlas-platfrom` is owed the reason without having to go looking for it.
 */
const OPENING_FALLBACKS = Object.freeze([
  DEPARTMENT_FALLBACK.malformedSlug, DEPARTMENT_FALLBACK.unknownSlug,
]);

/**
 * Put a resolved department on screen, or state why there is not one.
 *
 * @param {Document} doc the page.
 * @param {object} model a `departmentViewModel()` result.
 * @returns {object} what was actually done — `applied` is false when this page
 *   carries no status slot at all, so a caller can tell "nothing to do" from
 *   "nothing done". Never throws on a partial document.
 */
export function applyForwardedDepartment(doc, model, { showScreen = applyScreenRoute } = {}) {
  const status = doc?.getElementById?.(FORWARDED_STATUS_ID) ?? null;
  const reason = model?.resolved ? DEPARTMENT_FALLBACK.none
    : (model?.fallback?.reason ?? DEPARTMENT_FALLBACK.noSlug);
  const result = {
    applied: Boolean(status), resolved: Boolean(model?.resolved), reason,
    opened: false, selected: false, focused: false,
  };
  if (!status) return Object.freeze(result);

  // The department regions are hidden while another destination is on screen, so
  // the screen change comes FIRST: a sentence written into a hidden region is a
  // sentence nobody reads, and a disclosure opened inside one opens nothing.
  if (model?.resolved) {
    const shown = showScreen?.(doc, { slug: DEPARTMENT_DESTINATION, selection: model.slug });
    result.selected = shown?.selectionApplied === true;
  }

  status.textContent = model?.statusText ?? "";
  status.dataset.departmentResolved = model?.resolved ? "true" : "false";
  status.dataset.fallbackReason = reason;
  // Only a slug-shaped value is ever put on the document — the model already
  // refused to echo anything else, and this reads its decision rather than
  // taking a second one.
  if (model?.requestedSlug) status.dataset.requestedDepartment = model.requestedSlug;
  else delete status.dataset.requestedDepartment;
  status.hidden = reason === DEPARTMENT_FALLBACK.noSlug;

  const disclosure = doc.getElementById?.(DEPARTMENT_DISCLOSURE_ID) ?? null;
  if (disclosure && (model?.resolved || OPENING_FALLBACKS.includes(reason))) {
    disclosure.open = true;
    result.opened = true;
  }
  if (!model?.resolved) return Object.freeze(result);

  const panel = doc.getElementById?.(DEPARTMENT_PANEL_ID) ?? null;
  if (panel?.focus) {
    // No scroll argument and no `scrollIntoView`: the rail already owns how this
    // page moves, and a second opinion about it fights the first.
    panel.focus();
    result.focused = true;
  }
  return Object.freeze(result);
}
