// Painting the executive panel contract.
//
// This module owns one decision and no others: given the panel states
// `finops-panel-contract.js` computed, which nodes carry a figure and which
// carry the sentence that replaces it. It never decides eligibility, never
// reads an imported file, and never writes a number.
//
// THE RULE IT ENFORCES. A panel is never removed and never hidden. An import
// that cannot answer a question leaves the question on screen with the one
// input that would answer it named underneath. A leader who imports one invoice
// should be able to read the page and know what to bring next; a page that
// silently drops six panels teaches them only that the import broke something.
//
// Every node is built with createElement and textContent. The site policy
// forbids executing user-generated markup and nothing here assigns any.

import { EXECUTIVE_PANELS } from "./finops-panel-contract.js";
import {
  PANEL_STATUS, applyPanelStatus, panelProvenance,
} from "./panel-status-view.js";

const NOTE_CLASS = "panel-unavailable";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The panel's own note node, created once and reused.
 *
 * It is inserted before the panel's first figure so the sentence is read where
 * the number would have been, rather than after a heading that promises one.
 */
function noteFor(doc, panel, state) {
  const id = `${state.id}-unavailable`;
  let note = byId(doc, id);
  if (note && note.parentNode === panel) return note;
  note = element(doc, "p", NOTE_CLASS);
  note.id = id;
  note.setAttribute("role", "note");
  note.setAttribute("aria-label", `${state.question} — unavailable`);
  const anchor = state.figures
    .map((figureId) => byId(doc, figureId))
    .find((node) => node && node.parentNode === panel);
  if (anchor) panel.insertBefore(note, anchor);
  else panel.append(note);
  return note;
}

/**
 * The contract's two-valued answer, translated into the six-state reading
 * vocabulary the whole page shares.
 *
 * The contract owns eligibility and says only available or not; whether an
 * available panel is fully computed, partly attributed, or answered by zero rows
 * is a property of the provenance record beside it. Read here rather than
 * decided here — this function branches on values other modules published and
 * invents none of its own.
 */
export function panelStatusFor(state, record = null) {
  if (record?.status === PANEL_STATUS.loading) return PANEL_STATUS.loading;
  if (record?.status === PANEL_STATUS.error) return PANEL_STATUS.error;
  if (!state.available) return PANEL_STATUS.unavailable;
  if (Number.isFinite(record?.records) && record.records === 0) return PANEL_STATUS.empty;
  const coverage = record?.coverage;
  if (Number.isFinite(coverage) && coverage > 0 && coverage < 1) return PANEL_STATUS.partial;
  return PANEL_STATUS.computed;
}

/**
 * Paint one panel state.
 *
 * Returns the node that was painted so a caller can assert on the state it
 * asked for rather than on the DOM it got.
 *
 * @param options.provenance the raw provenance record for this panel, in
 *   whatever shape the analysis layer holds it. Optional: a panel that publishes
 *   no counts still gets its status chip, because "we cannot say how many rows"
 *   is not a reason to also stop saying which state the panel is in.
 * @param options.priority "primary" when this is the one panel the page leads
 *   with. At most one panel on the page is ever handed it.
 */
export function applyPanelState(doc, state, { provenance = null, priority = null } = {}) {
  const panel = byId(doc, state.elementId);
  if (!panel) return null;
  // The whole point: a declared panel stays on the page in every state.
  panel.hidden = false;
  panel.dataset.panelId = state.id;
  panel.dataset.panelState = state.available ? "available" : "unavailable";
  panel.dataset.nextAction = priority === "primary" ? "primary" : "secondary";
  for (const figureId of state.figures) {
    const figure = byId(doc, figureId);
    if (figure) figure.hidden = !state.available;
  }

  // The at-a-glance layer: which state this panel is in, and what it was
  // computed from, read before the figure rather than under it. The panel's own
  // question is the summary, so a reader scanning only the chips still meets
  // every question the page claims to answer.
  applyPanelStatus(doc, {
    panelId: state.elementId,
    status: panelStatusFor(state, provenance),
    summary: state.question,
    provenance: provenance ? panelProvenance(provenance) : null,
  });

  const note = noteFor(doc, panel, state);
  if (state.available) {
    note.replaceChildren();
    note.hidden = true;
    return panel;
  }
  const { message } = state;
  const children = [
    element(doc, "strong", `${NOTE_CLASS}-headline`, message.headline),
    element(doc, "span", `${NOTE_CLASS}-question`, message.question),
  ];
  // One panel on the page says "start here", and it says it in words rather than
  // in weight alone: a reader on a monochrome print, or one who meets the page
  // through a screen reader, gets the same ranking a sighted reader gets from
  // the rule and the type.
  if (priority === "primary") {
    children.push(element(doc, "span", `${NOTE_CLASS}-priority`,
      "Start here — this is the input that unblocks the most of this page."));
  }
  children.push(element(doc, "span", `${NOTE_CLASS}-need`,
    `Needed next · ${message.needLabel}: ${message.need}`));
  if (message.rest) children.push(element(doc, "span", `${NOTE_CLASS}-rest`, message.rest));
  note.replaceChildren(...children);
  note.hidden = false;
  return panel;
}

/**
 * Paint every panel state, in contract order.
 *
 * Priority is contract order and not severity. The panels are declared in the
 * order a leader meets them, so the first unanswerable one is the file that
 * unblocks the most reading; marking a second would be a backlog, and a board
 * reader with two "start here" labels starts at neither.
 *
 * @param options.provenance panel id → the raw provenance record for that panel.
 *   Absent keys are fine and common: a panel whose counts nobody publishes yet
 *   still gets its state, just without the four facts beneath it.
 */
export function applyPanelContract(doc, states = [], { provenance = {} } = {}) {
  const first = states.findIndex((state) => !state.available);
  return states
    .map((state, index) => applyPanelState(doc, state, {
      provenance: provenance?.[state.id] ?? null,
      priority: index === first ? "primary" : "secondary",
    }))
    .filter(Boolean);
}

/**
 * The two states no fact record can express: the fetch is still running, or it
 * failed.
 *
 * The contract answers "can this panel be computed from what was imported"; it
 * has nothing to say about a bundled fixture that has not arrived. Without this
 * the page's first paint is nine panels drawn as `awaiting input` — which is a
 * lie for about a second, and the wrong lie, because it tells a leader to go and
 * find a file when the answer is to wait.
 *
 * No panel alerts. The page owns one load-state region with the retry control in
 * it, and that is the announcement; these blocks are read in place.
 */
export function applyPanelLifecycle(doc, status) {
  return EXECUTIVE_PANELS
    .map((panel) => applyPanelStatus(doc, {
      panelId: panel.elementId, status, summary: panel.question, announce: false,
    }))
    .filter(Boolean);
}

/**
 * The static proof point's basis marker.
 *
 * The article is a hand-written recommendation with hand-written figures. Under
 * the bundled example that is one synthetic number beside others; above a
 * leader's own thinner import it is a $5,200/month claim sitting over their
 * real, smaller one. It is not removed — it is the worked example the page
 * links to — but when an import is on screen its figures are marked
 * illustrative before they are read, not in a note beneath them.
 */
export function applyProofPointBasis(doc, { imported = false } = {}) {
  const marker = byId(doc, "proof-point-illustrative");
  const article = doc?.querySelector ? doc.querySelector(".proof-point") : null;
  if (article) article.dataset.basis = imported ? "illustrative-over-import" : "illustrative";
  if (!marker) return null;
  marker.dataset.basis = imported ? "illustrative-over-import" : "illustrative";
  marker.replaceChildren(
    element(doc, "strong", undefined, "Illustrative figures · invented sample"),
    element(doc, "span", undefined, imported
      ? "These four numbers are hand-written demonstration data. They are not your import, they are "
        + "larger than the result computed from your own file below, and the two must not be compared."
      : "These figures use invented example data. They are not your spend or realized savings."),
  );
  return marker;
}
