// Entry for /workspace.html. The page is one surface with one module: read this
// browser, draw the state, and wire the four controls.
import { initLocalWorkspace } from "/local-workspace-view.js";
import {
  FINOPS_LABELS_KEY,
  FINOPS_PROHIBITED_CLASSES,
  FINOPS_WORKSPACE_KEY,
  FINOPS_WORKSPACE_VERSION,
  serializeFinopsWorkspacePreview,
} from "/finops-workspace-contract.js";

initLocalWorkspace(document, localStorage);

const preview = document.querySelector("#finops-workspace-preview");
if (preview) {
  preview.querySelector("#finops-contract-version").textContent = FINOPS_WORKSPACE_VERSION;
  preview.querySelector("#finops-preview-json").textContent = serializeFinopsWorkspacePreview();
  preview.querySelector("#finops-never-stored").replaceChildren(
    ...FINOPS_PROHIBITED_CLASSES.map(({ label, detail }) => {
      const item = document.createElement("li");
      const name = document.createElement("strong");
      name.textContent = `${label}: `;
      item.append(name, detail);
      return item;
    }),
  );
  preview.querySelector("#finops-erase-copy").textContent =
    `Complete FinOps erasure removes ${FINOPS_WORKSPACE_KEY} and ${FINOPS_LABELS_KEY}, then reads `
    + "both keys back to verify they are empty. It returns FinOps consent to never asked. Shiplog "
    + "decisions and releases, and any JSON file you already downloaded, are left alone.";
}
