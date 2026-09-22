import { normalizeReleaseFilters } from "./releases.js";
import { copyRecordUrl } from "./share-link.js";

// Every line this control writes names "this view", the words on its button.
// This page carries three other copy buttons — the real deployment record, the
// example release, the deployment check — and a bare "Link copied." could be
// any of them. It used to borrow the decisions history's sentence word for
// word; on that page it is the only copy control, here it is one of four.
// A copy with no filters set does not open a filtered view, so it says what it
// does open, and the failure line points at the field this control reveals,
// fills and focuses rather than at the address bar.
const COPY_SUCCESS = "Link to this view copied. It keeps your search and filters.";
const COPY_ALL_SUCCESS = "Link to this view copied. No search or filters are set, so it opens the full release log.";
const COPY_FAILURE = "Could not copy the link to this view. Copy it from the field below instead.";

const PARAMETERS = { query: "q", status: "status", decisionStatus: "decision-status", decisionId: "decision" };

export function readReleaseFilters(search = "", knownDecisionIds) {
  const params = new URLSearchParams(search);
  const filters = normalizeReleaseFilters(Object.fromEntries(
    Object.entries(PARAMETERS).map(([key, param]) => [key, params.get(param)]),
  ));
  if (knownDecisionIds && !knownDecisionIds.has(filters.decisionId)) filters.decisionId = "all";
  return filters;
}

export function releaseFilterSearch(search = "", input = {}) {
  const params = new URLSearchParams(search);
  const filters = normalizeReleaseFilters(input);
  for (const [key, param] of Object.entries(PARAMETERS)) {
    const value = filters[key];
    if (value === (key === "query" ? "" : "all")) params.delete(param);
    else params.set(param, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

// URL writes happen only on user changes; hydration never pushes history.
export function bindReleaseFilterUrl({ root, search, statusFilter, decisionFilter, decisionStatusInputs,
  knownDecisionIds, location, history, navigation, update, clipboard }) {
  let queryString = location?.search ?? "";
  const button = root.querySelector("#release-copy-link");
  const feedback = root.querySelector("#release-copy-status");
  const fallback = root.querySelector("#release-copy-fallback");
  const linkField = root.querySelector("#release-copy-url");
  const controls = () => ({
    query: search?.value ?? "", status: statusFilter?.value ?? "all",
    decisionId: decisionFilter?.value ?? "all",
    decisionStatus: decisionStatusInputs.find((input) => input.checked)?.value ?? "all",
  });
  let revision = 0;
  const clearFeedback = () => {
    revision += 1;
    if (feedback) feedback.textContent = "";
    if (fallback) fallback.hidden = true;
  };
  const sync = (method) => {
    const next = releaseFilterSearch(queryString, controls());
    if (next === queryString) return;
    queryString = next;
    const target = `${location?.pathname ?? "/releases.html"}${next}${location?.hash ?? ""}`;
    try { (history?.[method] ?? history?.replaceState)?.call(history, history?.state ?? null, "", target); } catch {}
  };
  const hydrate = () => {
    queryString = location?.search ?? "";
    const filters = readReleaseFilters(queryString, knownDecisionIds);
    if (search) search.value = filters.query;
    if (statusFilter) statusFilter.value = filters.status;
    if (decisionFilter) decisionFilter.value = filters.decisionId;
    for (const input of decisionStatusInputs) input.checked = input.value === filters.decisionStatus;
    clearFeedback();
    sync("replaceState");
    update();
  };
  const change = () => { clearFeedback(); sync("pushState"); update(); };
  search?.addEventListener("input", change);
  for (const control of [statusFilter, decisionFilter, ...decisionStatusInputs]) control?.addEventListener("change", change);
  navigation?.addEventListener?.("popstate", hydrate);
  const clearButton = root.querySelector("#release-clear-filters");
  if (clearButton) clearButton.disabled = false;
  clearButton?.addEventListener("click", () => {
    if (search) search.value = "";
    if (statusFilter) statusFilter.value = "all";
    if (decisionFilter) decisionFilter.value = "all";
    for (const input of decisionStatusInputs) input.checked = input.value === "all";
    change();
  });
  if (button && feedback && fallback && linkField) {
    button.disabled = false;
    button.addEventListener("click", async () => {
      clearFeedback();
      const started = revision;
      const filters = normalizeReleaseFilters(controls());
      const filtered = Object.entries(filters).some(([key, value]) => value !== (key === "query" ? "" : "all"));
      let url = "";
      try { url = new URL(`${location?.pathname ?? "/releases.html"}${releaseFilterSearch(queryString, filters)}${location?.hash ?? ""}`, location?.origin).href; } catch {}
      button.disabled = true;
      const copied = await copyRecordUrl(clipboard, url);
      button.disabled = false;
      if (started !== revision) return;
      if (copied) feedback.textContent = filtered ? COPY_SUCCESS : COPY_ALL_SUCCESS;
      else {
        feedback.textContent = COPY_FAILURE;
        linkField.value = url;
        fallback.hidden = false;
        linkField.focus?.();
        linkField.select?.();
      }
    });
  }
  hydrate();
  return change;
}
