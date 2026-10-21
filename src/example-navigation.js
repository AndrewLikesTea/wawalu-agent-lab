// Keep the read-only fixture route across the existing record-detail links.
// No storage access: even a stored record with the same id cannot replace it.
export function renderExampleNavigation(container) {
  for (const link of container.querySelectorAll("a")) {
    const href = link.getAttribute("href");
    if (/^\/(decision|release)\.html\?/.test(href ?? "")) {
      link.setAttribute("href", `${href}&example=1`);
    }
  }
  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = "Invented examples only. These records use no customer or production data. Exploring them does not save any records.";
  const back = document.createElement("a");
  back.className = "text-link";
  back.setAttribute("href", "/#title");
  back.textContent = "Record your own decision →";
  container.append(note, back);
}
