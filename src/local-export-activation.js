// Focused entry state for the existing browser-local import machinery.
// This module never reads a file. It only turns one answer into one next action;
// evolution-page.js remains the sole owner of parsing, validation, and results.

export const LOCAL_EXPORT_CHOICE = Object.freeze({ READY: "ready", EXAMPLE: "example" });

export function activationState(choice = LOCAL_EXPORT_CHOICE.READY) {
  if (choice === LOCAL_EXPORT_CHOICE.EXAMPLE) return Object.freeze({
    choice, label: "Use the Bundled synthetic example",
    note: "Start with invented data now. You can switch to your own export at any time.",
    targetId: "try-example-dataset",
  });
  return Object.freeze({
    choice: LOCAL_EXPORT_CHOICE.READY, label: "Choose a provider export",
    note: "CSV, TSV, or a v1 JSON envelope. It will be processed only in this browser tab.",
    targetId: "local-finops-files",
  });
}

export function applyActivationState(document, state) {
  const region = document.getElementById("local-export-activation");
  const action = document.getElementById("local-export-next-action");
  const note = document.getElementById("local-export-next-note");
  if (!region || !action || !note) return false;
  region.dataset.choice = state.choice;
  action.textContent = state.label;
  action.dataset.target = state.targetId;
  note.textContent = state.note;
  return true;
}

export function mountLocalExportActivation(document) {
  const region = document.getElementById("local-export-activation");
  const action = document.getElementById("local-export-next-action");
  if (!region || !action) return false;
  const choices = [...region.querySelectorAll('input[name="local-export-ready"]')];
  const select = (value) => applyActivationState(document, activationState(value));
  for (const choice of choices) choice.addEventListener("change", () => {
    if (choice.checked) select(choice.value);
  });
  action.addEventListener("click", () => {
    const target = document.getElementById(action.dataset.target);
    target?.focus?.();
    target?.click?.();
  });
  select(choices.find((choice) => choice.checked)?.value);
  return true;
}
