// A forwarded `?department=` applied to /evolution.html.
//
// Everything that touches a document is here and the selection is next door, the
// same split src/destination-route-view.js keeps with src/destination-route.js.
//
// WHAT "LANDING ON A DEPARTMENT" MEANS HERE. Three things, and a link that does
// two of them has not arrived:
//
//   1. THE REGION SAYS WHICH DEPARTMENT. The ranked control for the slug is
//      pressed — the page's own control, so the detail beside it is painted by
//      the same code path a click uses and there is no second renderer to drift.
//      The region also carries `data-department-answer`, so what the address
//      asked for is readable off the DOM rather than inferred from a name.
//   2. THE REGION IS OPEN. The panel is folded inside a details element that
//      ships shut. The `open` PROPERTY is set, not a click synthesized: a click
//      on a summary is a thing a reader does, and a page that fakes one races
//      the browser's own toggle. src/deep-link-disclosure.js already opens every
//      enclosing disclosure and focuses the target, so it is called rather than
//      reimplemented.
//   3. THE READER IS PUT THERE. Focus moves to `#department-decision-panel`,
//      which is already `tabindex="-1"` and already named by its own heading
//      through `aria-labelledby`. No new focusable is added, and none is added
//      to the first screen, whose tab budget is full.
//
// THE UNRESOLVED PATH CHANGES NOTHING BUT ONE SENTENCE. A slug this analysis
// does not have leaves the organization answer exactly where it was, leaves
// every department control unpressed, and adds one paragraph saying what the
// link asked for. It never blanks the screen and it never shows a different
// department's numbers under the name that was requested — the two failures that
// make a forwarded figure worse than no figure at all.
//
// WHERE THE SENTENCE GOES, and why not beside the department panel. That panel
// is inside a shut disclosure on the unresolved path, and a live region folded
// into a shut disclosure is silent in a real browser even where a test harness
// reads straight through it. So the paragraph sits in the front-door region,
// above the fold, outside every disclosure, next to the route message that
// answers the same class of question about the same address.

import {
  DEPARTMENT_REFUSAL, departmentAnswer, readDepartmentParam,
} from "./finops-department-answer.js";
import { revealFragmentTarget } from "./deep-link-disclosure.js";

/** The department decision region, authored in src/evolution.html. */
export const DEPARTMENT_REGION_ID = "department-decision-panel";

/**
 * The message paragraph. Created on demand rather than authored, because the
 * front-door markup is compared byte for byte against `frontDoorMarkup()` in
 * tests/finops-destinations.test.js. `.stand-answer` and `role="status"` are
 * what src/destination-route-view.js already uses for the same job, so no
 * stylesheet rule and no second vocabulary is added.
 */
export const DEPARTMENT_MESSAGE_ID = "finops-department-link-message";

const FRONT_DOOR_ID = "finops-front-door";

function messageNode(document) {
  const existing = document?.getElementById?.(DEPARTMENT_MESSAGE_ID);
  if (existing) return existing;
  const region = document?.getElementById?.(FRONT_DOOR_ID);
  if (!region) return null;
  const node = document.createElement("p");
  node.id = DEPARTMENT_MESSAGE_ID;
  node.className = "stand-answer";
  node.setAttribute("role", "status");
  node.setAttribute("data-department-message", "true");
  // Above the figure, because it qualifies everything under it, and after the
  // route message when that one is already there: both describe the address, in
  // the order the address is read.
  const first = region.firstChild ?? null;
  if (first) region.insertBefore?.(node, first);
  else region.append?.(node);
  return node;
}

/**
 * Say what happened to the address, or say nothing.
 *
 * The node is created on the first apply even when there is nothing to say and
 * is emptied rather than removed, for the reason the route message is: a
 * `role="status"` region inserted at the moment it first has text is frequently
 * not announced at all, and a node left holding an old sentence describes a
 * department the reader has since left.
 */
function renderMessage(document, answer) {
  const node = messageNode(document);
  if (!node) return "";
  const text = answer.resolved ? "" : answer.message;
  // textContent, never markup: the requested value is URL text.
  node.textContent = text;
  node.setAttribute("data-department-status",
    answer.resolved ? "resolved" : answer.reason);
  node.hidden = text === "";
  return text;
}

/** Press the page's own ranked control for this slug, if it has been painted. */
function pressControl(document, slug) {
  const control = document?.querySelector?.(`[data-department-id="${slug}"]`);
  if (!control) return false;
  if (control.getAttribute?.("aria-pressed") === "true") return true;
  control.click?.();
  return true;
}

/**
 * Apply a forwarded department address to the document.
 *
 * `search` is the query string (or a Location); `record` is the analysis record
 * the page has loaded. Returns what it did, so a caller — and a test — can tell
 * "opened and focused" apart from "the panel is not on this page".
 *
 * Never throws, on any input. An absent parameter is an ORDINARY OPEN: nothing
 * is pressed, nothing is opened, nothing is announced, and the reader is left
 * exactly where the page put them.
 */
export function applyDepartmentAnswer(document, record, search, { focus = true, scroll = true } = {}) {
  const requested = readDepartmentParam(search);
  const region = document?.getElementById?.(DEPARTMENT_REGION_ID) ?? null;
  if (requested === null) {
    return Object.freeze({
      requested: null, resolved: false, reason: DEPARTMENT_REFUSAL.missing,
      slug: null, message: "", pressed: false, opened: 0, focused: false,
    });
  }
  const answer = departmentAnswer(record, requested);
  const message = renderMessage(document, answer);
  if (!answer.resolved) {
    region?.removeAttribute?.("data-department-answer");
    return Object.freeze({
      requested, resolved: false, reason: answer.reason, slug: null,
      message, pressed: false, opened: 0, focused: false,
    });
  }
  region?.setAttribute?.("data-department-answer", answer.slug);
  const pressed = pressControl(document, answer.slug);
  const revealed = revealFragmentTarget(document, `#${DEPARTMENT_REGION_ID}`, { focus, scroll });
  return Object.freeze({
    requested, resolved: true, reason: null, slug: answer.slug, message,
    pressed, opened: revealed?.opened?.length ?? 0,
    focused: Boolean(focus && revealed),
    department: answer.department,
  });
}
