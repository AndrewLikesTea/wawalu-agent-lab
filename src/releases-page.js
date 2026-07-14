// Page wiring for the releases view. This is the only layer that knows where
// data comes from, keeping releases.js reusable and unit-testable. It composes:
//   1. decisions recorded in this browser (reused loader from app.js), plus
//   2. seed decisions/releases from releases-demo-data.json so the view renders
//      meaningfully in review while "record a release" remains a future task.
// Recorded releases (once a form exists) take precedence and are merged ahead of
// the demo seed; associations resolve against recorded + demo decisions.

import { loadDecisions } from "/app.js";
import { loadReleases, mountReleaseList } from "/releases.js";

async function fetchDemoData() {
  try {
    const response = await fetch("/releases-demo-data.json", { cache: "no-store" });
    if (!response.ok) return { decisions: [], releases: [] };
    const data = await response.json();
    return {
      decisions: Array.isArray(data.decisions) ? data.decisions : [],
      releases: Array.isArray(data.releases) ? data.releases : [],
    };
  } catch {
    return { decisions: [], releases: [] };
  }
}

function dedupeById(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

async function init() {
  const container = document.querySelector("#release-list");
  const count = document.querySelector("#release-count");
  if (!container) return;

  const demo = await fetchDemoData();
  const decisions = [...loadDecisions(localStorage), ...demo.decisions];
  const releases = dedupeById([...loadReleases(localStorage), ...demo.releases]);

  mountReleaseList(container, { releases, decisions });
  if (count) {
    count.textContent = `${releases.length} ${releases.length === 1 ? "release" : "releases"}`;
  }
  document.documentElement.dataset.shiplogReleases = "ready";
}

init();
