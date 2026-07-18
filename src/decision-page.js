import { resolveDecisionDetail, renderDecisionDetail } from "/decision-detail.js";
import { loadReleaseData } from "/releases-data.js";

async function init() {
  const container = document.querySelector("#decision-detail");
  if (!container) return;

  const id = new URLSearchParams(window.location.search).get("id") ?? "";
  const { decisions } = await loadReleaseData(localStorage);
  let detailSeeds = [];
  try {
    const response = await fetch("/decision-detail-demo-data.json", { cache: "no-store" });
    const data = response.ok ? await response.json() : {};
    detailSeeds = Array.isArray(data.decisions) ? data.decisions : [];
  } catch {
    // The release seed and browser records remain usable offline.
  }
  // The curated detail seed carries the structured alternatives that drive the
  // comparison view, so it wins when it covers this id; recorded decisions
  // (localStorage first, then the release demo seed via loadReleaseData) resolve
  // anything it does not. This avoids coupling precedence to an id-prefix guess.
  const decision = resolveDecisionDetail(detailSeeds, id) ?? resolveDecisionDetail(decisions, id);
  renderDecisionDetail(container, decision, { id });
  document.title = decision ? `${decision.title} · Decisions · Shiplog` : "Decision not found · Shiplog";
  document.documentElement.dataset.shiplogDecisionDetail = "ready";
}

init();
