import { renderPromptTrace, SYNTHETIC_FALLBACK_DATA } from "./agents.js";
import { renderState } from "./state-ui.js";

const DATA_URL = "/agent-demo-data.json";

export async function loadPublishedTrace(root = document, fetcher = fetch) {
  const trace = root.querySelector("#published-trace");
  renderState(trace, { state: "loading", title: "Loading representative prompt trace…" });
  trace.setAttribute("aria-busy", "true");
  try {
    const response = await fetcher(DATA_URL);
    if (!response.ok) throw new Error(`Demo data returned ${response.status}`);
    renderPromptTrace(trace, await response.json(), { full: true });
  } catch {
    renderPromptTrace(trace, SYNTHETIC_FALLBACK_DATA, { full: true });
    trace.dataset.source = "synthetic-fallback";
    trace.setAttribute("aria-busy", "false");
    const status = document.createElement("div");
    status.className = "trace-fallback-status";
    renderState(status, {
      state: "error",
      label: "Published trace unavailable",
      value: "Showing a built-in synthetic handoff.",
      description: "This fallback is not customer activity, private-repository activity, or hidden instructions. You can retry the published static demo request.",
      action: { label: "Retry trace", onClick: () => loadPublishedTrace(root, fetcher) },
    });
    trace.prepend(status);
  }
}

if (typeof document !== "undefined" && document.querySelector("#published-trace")) {
  loadPublishedTrace();
}
