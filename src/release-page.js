// Page wiring for the release DETAIL view. Reads the release id from the query
// string, sources the composed data (shared loader), resolves the one release,
// and renders it. All rendering and resolution logic lives in releases.js; this
// layer only maps URL -> data -> DOM and sets the document title.

import { resolveReleaseDetail, renderReleaseDetail } from "/releases.js";
import { loadReleaseData } from "/releases-data.js";

async function init() {
  const container = document.querySelector("#release-detail");
  if (!container) return;

  const id = new URLSearchParams(window.location.search).get("id") ?? "";
  const { decisions, releases } = await loadReleaseData(localStorage);
  const resolved = id ? resolveReleaseDetail(releases, decisions, id) : null;

  renderReleaseDetail(container, resolved, { id });

  if (resolved) {
    document.title = `${resolved.version} · Releases · Shiplog`;
  } else {
    document.title = "Release not found · Shiplog";
  }
  document.documentElement.dataset.shiplogReleaseDetail = "ready";
}

init();
