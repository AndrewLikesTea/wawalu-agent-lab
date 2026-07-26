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
import { dedupeById, fetchDemoData } from "./demo-data.js";

// Compose the full data set the release views render from. Recorded records take
// precedence over the demo seed (they are listed first, and dedupeById keeps the
// first occurrence of each id).
export async function loadReleaseData(storage) {
  const demo = await fetchDemoData();
  const decisions = dedupeById([...loadDecisions(storage), ...demo.decisions]);
  const releases = dedupeById([...loadReleases(storage), ...demo.releases]);
  return { decisions, releases, unavailable: demo.unavailable === true };
}
