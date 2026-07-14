// Shared data sourcing for the release views (list and detail). Both pages need
// the same composed picture — decisions recorded in this browser plus the demo
// seed, and recorded releases merged ahead of the seed — so that logic lives
// here once rather than being duplicated per page. This is the "small shared
// module" the note at the top of releases.js anticipated: it is now earned by
// two call sites (releases-page.js and release-page.js).
//
// Keeping it separate from releases.js preserves that module's property of being
// a pure, DOM-and-fetch-free component: data sourcing stays out of the renderer.

import { loadDecisions } from "/app.js";
import { loadReleases } from "/releases.js";

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

// Compose the full data set the release views render from. Recorded records take
// precedence over the demo seed (they are listed first, and dedupeById keeps the
// first occurrence of each id).
export async function loadReleaseData(storage) {
  const demo = await fetchDemoData();
  const decisions = dedupeById([...loadDecisions(storage), ...demo.decisions]);
  const releases = dedupeById([...loadReleases(storage), ...demo.releases]);
  return { decisions, releases };
}
