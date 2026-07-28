// Entry for /workspace.html. The page is one surface with one module: read this
// browser, draw the state, and wire the four controls.
import { initLocalWorkspace } from "/local-workspace-view.js";

initLocalWorkspace(document, localStorage);
