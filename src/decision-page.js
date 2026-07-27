import {
  decisionDetailState,
  resolveDecisionDetail,
  renderDecisionDetail,
  renderDecisionDetailState,
} from "./decision-detail.js";
import { loadReleaseData } from "./releases-data.js";
import { dedupeById } from "./demo-data.js";
import { SEED_DECISION_DETAILS } from "./seed-records.js";
import { pageTitle, recordTitle } from "./page-title.js";

// Resolution is synchronous. The example records are module constants and the
// visitor's records come from storage, so an id either resolves now or does not
// exist — there is no pending window, and therefore no loading state to enter
// and no way to be stranded in one. A missing id lands in "not-found", which is
// a real rendered state with a way back, not a spinner that never settles.
export function loadDecisionDetail(id, storage, options = {}) {
  const loadData = options.loadData ?? loadReleaseData;
  const { decisions, releases, publicDecisionIds, exampleDecisionIds } = loadData(storage);
  const detailSeeds = options.detailSeeds ?? SEED_DECISION_DETAILS;

  const decision = resolveDecisionDetail(detailSeeds, id) ?? resolveDecisionDetail(decisions, id);
  const linkedReleases = decision
    ? releases.filter((release) => Array.isArray(release.decisionIds) && release.decisionIds.includes(decision.id))
    : [];
  // The supersede link is derived, so the view needs the surrounding log, not
  // just this record. Seeds win on id, matching how the decision itself resolves.
  const related = dedupeById([...detailSeeds, ...decisions]);
  return {
    state: decisionDetailState({ id, decision }),
    decision,
    decisions: related,
    linkedReleases,
    shareable: publicDecisionIds.has(id) || detailSeeds.some((seed) => seed.id === id),
    // Stated on the detail page as well as the list row: a reader who arrived
    // by a direct URL never saw the list, and must still be told what this is.
    example: exampleDecisionIds?.has(id) === true,
  };
}

export async function initDecisionDetail(options = {}) {
  const container = document.querySelector("#decision-detail");
  if (!container) return;

  const id = new URLSearchParams(window.location.search).get("id") ?? "";
  container.setAttribute("aria-busy", "true");
  try {
    const result = loadDecisionDetail(id, localStorage, options);
    if (result.state === "available") {
      renderDecisionDetail(container, result.decision, {
        id,
        decisions: result.decisions,
        linkedReleases: result.linkedReleases,
        shareable: result.shareable,
        example: result.example,
      });
    } else {
      renderDecisionDetailState(container, result.state);
    }
    // src/decision.html ships titled "Decision · Shiplog", so the tab names this
    // page — not the log it came from — for the whole load. This only ever
    // narrows that to the record actually on screen.
    document.title = result.decision
      ? recordTitle(result.decision.title, { surface: "Decisions", fallback: "Decision" })
      : result.state === "error" ? pageTitle("Decision unavailable") : pageTitle("Decision not found");
  } catch {
    renderDecisionDetailState(container, "error");
    document.title = pageTitle("Decision unavailable");
  } finally {
    container.setAttribute("aria-busy", "false");
    document.documentElement.dataset.shiplogDecisionDetail = "ready";
  }
}

// Guarded so this module can be imported by a test (or another page) without
// booting against a document that is not the decision detail page.
if (typeof document !== "undefined" && document.querySelector("#decision-detail")) {
  initDecisionDetail();
}
