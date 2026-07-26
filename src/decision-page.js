import {
  decisionDetailState,
  resolveDecisionDetail,
  renderDecisionDetail,
  renderDecisionDetailState,
} from "/decision-detail.js";
import { loadReleaseData } from "/releases-data.js";

export async function loadDecisionDetail(id, storage, options = {}) {
  const loadData = options.loadData ?? loadReleaseData;
  const fetchImpl = options.fetchImpl ?? fetch;
  const { decisions, releases, publicDecisionIds, unavailable = false } = await loadData(storage);
  let detailSeeds = [];
  try {
    const response = await fetchImpl("/decision-detail-demo-data.json", { cache: "no-store" });
    const data = response.ok ? await response.json() : {};
    detailSeeds = Array.isArray(data.decisions) ? data.decisions : [];
  } catch {
    // Structured alternatives are an enhancement. Base records remain usable.
  }

  const decision = resolveDecisionDetail(detailSeeds, id) ?? resolveDecisionDetail(decisions, id);
  const linkedReleases = decision
    ? releases.filter((release) => Array.isArray(release.decisionIds) && release.decisionIds.includes(decision.id))
    : [];
  return {
    state: decisionDetailState({ id, decision, unavailable: unavailable && !decision }),
    decision,
    linkedReleases,
    shareable: publicDecisionIds.has(id) || detailSeeds.some((seed) => seed.id === id),
  };
}

export async function initDecisionDetail(options = {}) {
  const container = document.querySelector("#decision-detail");
  if (!container) return;

  const id = new URLSearchParams(window.location.search).get("id") ?? "";
  container.setAttribute("aria-busy", "true");
  renderDecisionDetailState(container, "loading");
  try {
    const result = await loadDecisionDetail(id, localStorage, options);
    if (result.state === "available") {
      renderDecisionDetail(container, result.decision, {
        id,
        linkedReleases: result.linkedReleases,
        shareable: result.shareable,
      });
    } else {
      renderDecisionDetailState(container, result.state);
    }
    document.title = result.decision
      ? `${result.decision.title} · Decisions · Shiplog`
      : result.state === "error" ? "Decision unavailable · Shiplog" : "Decision not found · Shiplog";
  } catch {
    renderDecisionDetailState(container, "error");
    document.title = "Decision unavailable · Shiplog";
  } finally {
    container.setAttribute("aria-busy", "false");
    document.documentElement.dataset.shiplogDecisionDetail = "ready";
  }
}

initDecisionDetail();
