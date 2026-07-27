// Shared data sourcing for the release views (list and detail) and the decision
// detail view. All of them need the same composed picture — decisions recorded
// in this browser plus the example seed, and recorded releases merged ahead of
// the seed — so that logic lives here once rather than being duplicated per
// page.
//
// This function is synchronous by design. It used to await a fetch of the seed
// JSON, which meant every detail page had a real pending window and could sit
// on its loading state forever if the request never settled. Reading storage
// and a module constant has no such window: a decision or release id either
// resolves now or does not exist.
//
// Keeping it separate from releases.js preserves that module's property of being
// a pure, DOM-and-fetch-free component: data sourcing stays out of the renderer.

import { loadDecisions } from "./app.js";
import { loadReleases } from "./releases.js";
import { dedupeById } from "./demo-data.js";
import { SEED_DECISIONS, SEED_RELEASES, exampleIdsFor } from "./seed-records.js";

// Compose the full data set the record views render from. Recorded records take
// precedence over the example seed (they are listed first, and dedupeById keeps
// the first occurrence of each id).
export function loadReleaseData(storage) {
  const recordedDecisions = loadDecisions(storage);
  const recordedReleases = loadReleases(storage);
  const recordedIds = new Set([...recordedDecisions, ...recordedReleases].map(({ id }) => id));
  const examples = exampleIdsFor(recordedIds);
  return {
    decisions: dedupeById([...recordedDecisions, ...SEED_DECISIONS]),
    releases: dedupeById([...recordedReleases, ...SEED_RELEASES]),
    publicDecisionIds: new Set(SEED_DECISIONS.map(({ id }) => id)),
    publicReleaseIds: new Set(SEED_RELEASES.map(({ id }) => id)),
    // The same ids narrowed to the ones this visitor has not taken over, so a
    // detail page only badges a record the visitor does not own.
    exampleDecisionIds: new Set(SEED_DECISIONS.map(({ id }) => id).filter((id) => examples.has(id))),
    exampleReleaseIds: new Set(SEED_RELEASES.map(({ id }) => id).filter((id) => examples.has(id))),
    // Retained so callers keep their "the examples could not be loaded" branch,
    // but it can no longer be true: the seed is compiled in, not fetched.
    unavailable: false,
  };
}
