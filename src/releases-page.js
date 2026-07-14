// Page wiring for the releases LIST view. Data sourcing is delegated to
// releases-data.js (shared with the detail view); this layer only binds the
// composed data to the DOM so releases.js stays reusable and unit-testable.

import { mountReleaseList } from "/releases.js";
import { loadReleaseData } from "/releases-data.js";

async function init() {
  const container = document.querySelector("#release-list");
  const count = document.querySelector("#release-count");
  if (!container) return;

  const { decisions, releases } = await loadReleaseData(localStorage);

  mountReleaseList(container, { releases, decisions });
  if (count) {
    count.textContent = `${releases.length} ${releases.length === 1 ? "release" : "releases"}`;
  }
  document.documentElement.dataset.shiplogReleases = "ready";
}

init();
