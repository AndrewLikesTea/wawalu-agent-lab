import { loadSavingsActionCenter } from "/savings-action-center.js";
import {
  renderSavingsActionCenter, renderSavingsActionCenterError,
} from "/savings-action-center-view.js";

const root = document.getElementById("savings-action-center");

try {
  const model = await loadSavingsActionCenter();
  root.replaceChildren(renderSavingsActionCenter(model));
} catch (error) {
  console.error("savings_action_center_unavailable", {
    error: error?.message ?? String(error),
  });
  root.replaceChildren(renderSavingsActionCenterError());
} finally {
  root.setAttribute("aria-busy", "false");
}
