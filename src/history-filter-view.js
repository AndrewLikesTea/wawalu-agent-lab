// The filtered view, said out loud: one summary line and one removable chip per
// active filter.
//
// Hierarchy is the point. The summary is the headline of the list — how many of
// the log's records survived the filters, and over what scope — and the chips
// are the secondary row that says which filters produced it and lets any one of
// them go. A wall of equal-weight controls would make a reader work out the
// answer from the controls; this states the answer and keeps the controls
// beneath it.
//
// Everything here is textContent. The free-text query is a visitor's string
// arriving off a query string, and PRODUCT.md rules out executing user-generated
// HTML: a `<img onerror>` typed into the search box is six words on a chip.

import { historyFilterChips, historyFiltersActive, historySummaryLine } from "./history-filters.js";

export const COPY_LINK_SUCCESS = "Link copied. It opens this filtered view.";
export const COPY_LINK_FAILURE = "Could not copy the link automatically. Copy it from the address bar instead.";

/** The headline above the results. */
export function renderHistorySummary(node, { visible = 0, total = 0, filters = {} } = {}) {
  if (!node) return "";
  const line = historySummaryLine(visible, total, filters);
  node.textContent = line;
  node.dataset.filtered = String(historyFiltersActive(filters));
  return line;
}

/**
 * The active filters as individually dismissable chips.
 *
 * Returns the buttons in render order so the caller can put focus somewhere
 * sensible after one of them removes itself — a chip that vanishes under the
 * keyboard must not drop focus to the top of the document.
 */
export function renderHistoryFilterChips(list, filters = {}, { onRemove } = {}) {
  if (!list) return [];
  const chips = historyFilterChips(filters);
  list.replaceChildren();
  list.hidden = chips.length === 0;
  const buttons = [];
  for (const chip of chips) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-chip";
    button.dataset.filter = chip.key;
    // Names the filter it drops. Six buttons all called "Remove" is a list a
    // screen reader user cannot act on.
    button.setAttribute("aria-label", chip.remove);
    const text = document.createElement("span");
    text.className = "filter-chip-text";
    text.textContent = chip.text;
    const dismiss = document.createElement("span");
    dismiss.className = "filter-chip-dismiss";
    // The glyph is decoration: the accessible name above already says "Remove".
    dismiss.setAttribute("aria-hidden", "true");
    dismiss.textContent = "×";
    button.append(text, dismiss);
    if (typeof onRemove === "function") {
      button.addEventListener("click", () => onRemove(chip.key, button));
    }
    item.append(button);
    list.append(item);
    buttons.push(button);
  }
  return buttons;
}

/**
 * Put `url` on the clipboard and say what happened.
 *
 * Two failures are handled the same way because the recovery is the same: a
 * browser with no clipboard API (an insecure origin, an older engine) and a
 * write the user or the platform refused both leave the link in the address
 * bar. Neither may throw out of a click handler, and neither may be silent —
 * a button that does nothing visible reads as broken.
 */
export async function copyHistoryLink(url, { clipboard } = {}) {
  const target = clipboard ?? globalThis.navigator?.clipboard;
  if (typeof target?.writeText !== "function") return { copied: false, message: COPY_LINK_FAILURE };
  try {
    await target.writeText(String(url));
    return { copied: true, message: COPY_LINK_SUCCESS };
  } catch {
    return { copied: false, message: COPY_LINK_FAILURE };
  }
}
