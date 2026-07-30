// Paint the "where do we stand?" headline into the slots evolution.html authors.
//
// The markup ships in its pending state and is never replaced: the region, its
// heading, its five headline slots, and all six disclosure controls are in the
// document before any script runs. A reader whose JavaScript failed still meets
// a coherent region with operable, keyboard-reachable disclosures rather than an
// empty box — which for native `details` costs nothing, because the browser
// already implements every part of the interaction.
//
// Nothing here assigns markup. Every string arrives through `textContent` and
// every node is built with `createElement`, because these strings include
// department names and reason sentences taken out of a reader's own import.

import { STAND_DISCLOSURE_ORDER, STAND_IDS, STAND_RESOLUTION_ACTION } from "./finops-stand.js";

/** The state chip, in the same two channels the rest of this page uses. */
export const STAND_DISCLOSURE_STATE = Object.freeze({
  expanded: Object.freeze({ shape: "▾", action: "Hide" }),
  collapsed: Object.freeze({ shape: "▸", action: "Show" }),
});

/** The ids of one disclosure, derived from its key. Authored the same way in HTML. */
export function standDisclosureIds(key) {
  const root = `finops-stand-disclosure-${key}`;
  return Object.freeze({
    details: root, summary: `${root}-summary`, heading: `${root}-heading`,
    state: `${root}-state`, list: `${root}-list`,
  });
}

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function setText(doc, id, text) {
  const node = byId(doc, id);
  if (node && typeof text === "string") node.textContent = text;
  return node;
}

/** One `<dt>`/`<dd>` pair, built rather than assigned. */
function definition(doc, item) {
  const row = doc.createElement("div");
  const term = doc.createElement("dt");
  term.textContent = item.term;
  const detail = doc.createElement("dd");
  detail.textContent = item.detail;
  row.append(term, detail);
  return row;
}

/**
 * Write one disclosure's state into the three channels it is owed: the
 * `aria-expanded` mirror assistive technology reads, the `data-disclosure`
 * attribute the stylesheet and the tests read, and the visible word beside the
 * summary. A chevron that only rotates is a state a reader cannot hear, cannot
 * print, and cannot see in greyscale — so the word is always there, and the
 * count travels with it.
 */
export function paintStandDisclosureState(doc, key) {
  const ids = standDisclosureIds(key);
  const details = byId(doc, ids.details);
  const summary = byId(doc, ids.summary);
  if (!details || !summary) return null;
  const open = Boolean(details.open ?? details.hasAttribute?.("open"));
  const spec = open ? STAND_DISCLOSURE_STATE.expanded : STAND_DISCLOSURE_STATE.collapsed;
  summary.setAttribute("aria-expanded", open ? "true" : "false");
  details.dataset.disclosure = open ? "expanded" : "collapsed";
  const state = byId(doc, ids.state);
  if (state) {
    state.dataset.disclosure = open ? "expanded" : "collapsed";
    const count = byId(doc, ids.list)?.querySelectorAll?.("dt")?.length ?? 0;
    const shape = doc.createElement("span");
    shape.className = "stand-disclosure-shape";
    // Decoration beside a word, never the word itself, so it stays out of the
    // name the visible text composes.
    shape.setAttribute("aria-hidden", "true");
    shape.textContent = spec.shape;
    state.replaceChildren(shape,
      doc.createTextNode(` ${spec.action}${count > 0 ? ` · ${count}` : ""}`));
  }
  return summary;
}

/**
 * Keep every disclosure's state channels in step with its own `open`.
 *
 * Bound to `toggle`, which fires for a click, for Enter, for Space, and for a
 * programmatic open — so the keyboard path and the pointer path go through one
 * piece of code rather than two that can disagree. Nothing here intercepts a
 * key: the native control already handles all of them, and re-handling them is
 * how a disclosure stops being operable in the browser's own way.
 */
export function bindStandDisclosures(doc) {
  const bound = [];
  for (const key of STAND_DISCLOSURE_ORDER) {
    const details = byId(doc, standDisclosureIds(key).details);
    if (!details) continue;
    details.addEventListener("toggle", () => paintStandDisclosureState(doc, key));
    paintStandDisclosureState(doc, key);
    bound.push(details);
  }
  return bound;
}

/**
 * Delegate the withheld-state action to the control that already owns it.
 *
 * There is exactly one file picker on this page, and this button does not
 * become a second one: it focuses and clicks `#local-finops-files`, the same
 * delegate the first-run import choice uses. Focus moves first, so a browser
 * that declines to open a file dialog from a synthetic event leaves the reader
 * standing on the control that does.
 */
export function bindStandResolution(doc) {
  const button = byId(doc, STAND_IDS.withheldAction);
  if (!button) return null;
  button.dataset.target = STAND_RESOLUTION_ACTION.targetId;
  button.addEventListener("click", () => {
    const target = byId(doc, STAND_RESOLUTION_ACTION.targetId);
    if (!target) return;
    target.focus?.({ preventScroll: true });
    target.click?.();
    target.scrollIntoView?.({ block: "center" });
  });
  return button;
}

/**
 * Apply a composed headline to the document.
 *
 * @returns the region, so a caller can assert on the state it asked for.
 */
export function applyStandHeadline(doc, headline) {
  const region = byId(doc, STAND_IDS.region);
  if (!region || !headline) return null;

  region.dataset.state = headline.available ? "ready" : "partial";
  // The withheld path is a state on the region, not a style: a printed page, a
  // screenshot, and a test all read the same attribute the stylesheet does.
  region.dataset.position = headline.positioned ? "placed" : "withheld";
  region.dataset.source = headline.source ?? "example";

  setText(doc, STAND_IDS.label, headline.label ?? "");
  setText(doc, STAND_IDS.question, headline.question ?? "");
  setText(doc, STAND_IDS.answer, headline.answer ?? "");

  const position = setText(doc, STAND_IDS.positionValue, headline.position?.value ?? "");
  if (position) position.dataset.available = headline.position?.available ? "true" : "false";
  setText(doc, STAND_IDS.positionBasis, headline.position?.basis ?? "");

  const recoverable = setText(doc, STAND_IDS.recoverableValue, headline.recoverable?.value ?? "");
  if (recoverable) recoverable.dataset.available = headline.recoverable?.available ? "true" : "false";
  setText(doc, STAND_IDS.recoverableBasis, headline.recoverable?.basis ?? "");

  // The named team is text in both channels — the name in its own element and
  // the evidence sentence beside it. Nothing about which department it is is
  // carried by colour or by position in a grid.
  const team = byId(doc, STAND_IDS.team);
  if (team) team.dataset.available = headline.team?.available ? "true" : "false";
  setText(doc, STAND_IDS.teamName, headline.team?.name ?? "");
  setText(doc, STAND_IDS.teamDetail, headline.team?.detail ?? "");

  const action = byId(doc, STAND_IDS.action);
  if (action) {
    action.textContent = headline.action?.label ?? "";
    action.hidden = !headline.action?.available;
    if (headline.action?.href) action.setAttribute("href", headline.action.href);
  }
  setText(doc, STAND_IDS.actionBasis, headline.action?.basis ?? "");
  const basis = byId(doc, STAND_IDS.actionBasis);
  if (basis) basis.hidden = !headline.action?.available;

  // The withheld path: what is missing, and one control that resolves it. The
  // bare word "Unavailable" is never painted into this region in any state.
  const withheld = byId(doc, STAND_IDS.withheld);
  if (withheld) withheld.hidden = Boolean(headline.positioned);
  setText(doc, STAND_IDS.withheldMissing, headline.withheld?.missing ?? "");
  setText(doc, STAND_IDS.withheldNext, headline.withheld?.nextStep ?? "");
  setText(doc, STAND_IDS.withheldAction,
    headline.withheld?.actionLabel ?? STAND_RESOLUTION_ACTION.label);

  for (const item of headline.disclosures ?? []) {
    const ids = standDisclosureIds(item.id);
    setText(doc, ids.heading, item.summary ?? "");
    const list = byId(doc, ids.list);
    if (list) list.replaceChildren(...item.entries.map((row) => definition(doc, row)));
    paintStandDisclosureState(doc, item.id);
  }

  // Spoken once, and only what a reader who cannot see the region needs in
  // order to decide whether to read it.
  setText(doc, STAND_IDS.live, `${headline.label}. ${headline.answer}`);
  return region;
}
