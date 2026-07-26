import { renderPromptTrace } from "./agents.js";
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
    trace.setAttribute("aria-busy", "false");
    renderState(trace, {
      state: "error",
      label: "Trace unavailable",
      value: "The published representative trace could not be loaded.",
      description: "Return to the observatory or retry this static demo request.",
      action: { label: "Retry trace", onClick: () => loadPublishedTrace(root, fetcher) },
    });
  }
}

if (typeof document !== "undefined" && document.querySelector("#published-trace")) {
  loadPublishedTrace();
}
