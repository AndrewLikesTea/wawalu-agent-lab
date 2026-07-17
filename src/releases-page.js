// Page wiring for the releases LIST view. Data sourcing is delegated to
// releases-data.js (shared with the detail view); this layer only binds the
// composed data to the DOM so releases.js stays reusable and unit-testable.

import { mountReleaseList } from "/releases.js";
import { loadReleaseData } from "/releases-data.js";

async function init() {
  const container = document.querySelector("#release-list");
  const count = document.querySelector("#release-count");
  const search = document.querySelector("#release-search");
  const status = document.querySelector("#release-status");
  if (!container) return;

  const { decisions, releases } = await loadReleaseData(localStorage);

  const view = mountReleaseList(container, { releases, decisions });
  const update = () => {
    const filters = { query: search?.value ?? "", status: status?.value ?? "all" };
    const shown = view.render({ releases, decisions }, filters);
    if (count) count.textContent = `${shown.length} of ${releases.length} ${releases.length === 1 ? "release" : "releases"}`;
  };
  search?.addEventListener("input", update);
  status?.addEventListener("change", update);
  update();
  document.documentElement.dataset.shiplogReleases = "ready";
}

init();
