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
 * Paint one panel state.
 *
 * Returns the node that was painted so a caller can assert on the state it
 * asked for rather than on the DOM it got.
 */
export function applyPanelState(doc, state) {
  const panel = byId(doc, state.elementId);
  if (!panel) return null;
  // The whole point: a declared panel stays on the page in every state.
  panel.hidden = false;
  panel.dataset.panelId = state.id;
  panel.dataset.panelState = state.available ? "available" : "unavailable";
  for (const figureId of state.figures) {
    const figure = byId(doc, figureId);
    if (figure) figure.hidden = !state.available;
  }
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
    element(doc, "span", `${NOTE_CLASS}-need`,
      `Needed next · ${message.needLabel}: ${message.need}`),
  ];
  if (message.rest) children.push(element(doc, "span", `${NOTE_CLASS}-rest`, message.rest));
  note.replaceChildren(...children);
  note.hidden = false;
  return panel;
}

/** Paint every panel state, in contract order. */
export function applyPanelContract(doc, states = []) {
  return states.map((state) => applyPanelState(doc, state)).filter(Boolean);
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
      : "These four numbers are hand-written demonstration data, not live analysis, customer data, "
        + "or realized savings."),
  );
  return marker;
}
