// The detected-fields summary, painted into the import step of evolution.html.
//
// It takes the document rather than reading a global, exactly like
// import-mapping-view.js, so a test drives the shipped markup instead of a
// fixture. Every string it writes comes from `corpus-structure.js` — a count, an
// authored field label, or a dialect name — so there is no path on which a cell
// of the reader's file reaches a text node here.
//
// Two conventions are the page's, not this module's: the presence of a field is
// carried by a *word* as well as a glyph and a tint, and the announcement goes
// to the same kind of always-present visually-hidden polite region every other
// region on this page announces through.

import { structuralAnnouncement, structuralSummary } from "./corpus-structure.js";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function textNode(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Paint the summary, or clear it when there is nothing to report.
 *
 * @param {Document} doc the page.
 * @param {object|null} result a `parseCorpusStructure` result, or null to clear.
 * @returns {object|null} the rendered summary model, for a caller that wants it.
 */
export function applyCorpusStructure(doc, result) {
  const region = byId(doc, "corpus-structure");
  const live = byId(doc, "corpus-structure-live");
  if (!region) return null;
  if (!result) {
    region.hidden = true;
    byId(doc, "corpus-structure-fields")?.replaceChildren();
    if (live) live.textContent = "";
    return null;
  }

  const summary = structuralSummary(result);
  region.dataset.recognized = String(summary.recognized);
  const dialect = byId(doc, "corpus-structure-dialect");
  if (dialect) dialect.textContent = summary.dialectLine;
  const counts = byId(doc, "corpus-structure-counts");
  if (counts) counts.textContent = summary.countLine;

  const list = byId(doc, "corpus-structure-fields");
  if (list) {
    list.replaceChildren(...summary.fields.map((field) => {
      const item = textNode(doc, "li", "corpus-structure-field");
      item.dataset.field = field.id;
      // The tint reads the attribute; the glyph and the sentence both say it too.
      item.dataset.detected = String(field.detected);
      const shape = textNode(doc, "span", "corpus-structure-shape", field.detected ? "✓" : "○");
      shape.setAttribute("aria-hidden", "true");
      item.append(shape, textNode(doc, "span", "corpus-structure-field-text", field.text));
      return item;
    }));
  }

  const action = byId(doc, "corpus-structure-action");
  if (action) action.textContent = summary.nextAction.text;
  region.hidden = false;
  // Announced last, after the region is in the rendered tree and populated, so
  // one import produces one announcement of the finished summary.
  if (live) live.textContent = structuralAnnouncement(summary);
  return summary;
}
