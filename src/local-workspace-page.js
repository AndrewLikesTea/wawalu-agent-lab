// Entry for /workspace.html. The page is one surface with two stores: Shiplog's
// records, kept by default, and AI FinOps' derived figures, kept only after an
// explicit yes. Each has its own module; neither reads the other's key.
import { initLocalWorkspace } from "/local-workspace-view.js";
import { initFinopsWorkspace } from "/finops-workspace-view.js";
import {
  FINOPS_LABELS_KEY,
  FINOPS_PROHIBITED_CLASSES,
  FINOPS_WORKSPACE_KEY,
  FINOPS_WORKSPACE_VERSION,
  serializeFinopsWorkspacePreview,
} from "/finops-workspace-contract.js";

initLocalWorkspace(document, localStorage);
initFinopsWorkspace(document, localStorage);

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
    + "every key back to verify it is empty. It returns FinOps consent to never asked. Shiplog "
    + "decisions and releases, and any JSON file you already downloaded, are left alone.";
}
