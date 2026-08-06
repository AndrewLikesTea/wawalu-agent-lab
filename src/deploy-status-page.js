// Page wiring for the deploy status view: probe -> compare -> render.
//
// Everything with a decision in it lives in deploy-status.js. This layer only
// supplies the two things that module refuses to reach for itself — the network
// and the clock — and hands the release records in from the shared loader the
// release views already use.
//
// It is read only in the strict sense: one GET at /healthz, one read of the
// records already in this browser, and no request, write, or control of any
// kind after that.

import { compareDeployment, probeHealthz, renderDeployStatus } from "./deploy-status.js";
import { browserReleaseStorage } from "./releases.js";
import { loadReleaseData } from "./releases-data.js";

export async function initDeployStatus({
  fetchImpl = typeof fetch === "function" ? fetch.bind(globalThis) : null,
  now = () => new Date().toISOString(),
} = {}) {
  const container = document.querySelector("#deploy-status");
  if (!container) return;
  container.setAttribute("aria-busy", "true");

  // A store a browser refuses degrades to the shipped example releases rather
  // than to an error: the comparison still has a newest record to name.
  let releases = [];
  try {
    releases = loadReleaseData(browserReleaseStorage()).releases;
  } catch {
    releases = [];
  }

  const probe = await probeHealthz(fetchImpl);
  // No earlier observation is passed: this page records nothing, so the metric
  // says how long the state has held only when a caller can prove it.
  renderDeployStatus(container, compareDeployment({ probe, releases, checkedAt: now() }));
  document.documentElement.dataset.shiplogDeployStatus = "ready";
}

if (typeof document !== "undefined" && document.querySelector("#deploy-status")) {
  initDeployStatus();
}
