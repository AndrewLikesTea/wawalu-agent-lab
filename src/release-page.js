// Page wiring for the release DETAIL view. Reads the release id from the query
// string, sources the composed data (shared loader), resolves the one release,
// and renders it. All rendering and resolution logic lives in releases.js; this
// layer only maps URL -> data -> DOM and sets the document title.
//
// Sourcing is synchronous (see releases-data.js), so a direct URL load renders
// the release in the same turn the page boots — the same content in-site
// navigation produces, with no request in between to stall on.

import { resolveReleaseDetail, renderReleaseDetail } from "./releases.js";
import { loadReleaseData } from "./releases-data.js";
import { pageTitle, recordTitle } from "./page-title.js";

export function initReleaseDetail() {
  const container = document.querySelector("#release-detail");
  if (!container) return;

  const id = new URLSearchParams(window.location.search).get("id") ?? "";
  container.setAttribute("aria-busy", "true");
  const { decisions, releases, publicReleaseIds, exampleReleaseIds } = loadReleaseData(localStorage);
  const resolved = id ? resolveReleaseDetail(releases, decisions, id) : null;

  renderReleaseDetail(container, resolved, {
    id,
    shareable: publicReleaseIds.has(id),
    example: exampleReleaseIds?.has(id) === true,
  });
  container.setAttribute("aria-busy", "false");

  if (resolved) {
    document.title = recordTitle(resolved.version, { surface: "Releases", fallback: "Release" });
  } else {
    document.title = pageTitle("Release not found");
  }
  document.documentElement.dataset.shiplogReleaseDetail = "ready";
}

// Guarded so this module can be imported by a test (or another page) without
// booting against a document that is not the release detail page.
if (typeof document !== "undefined" && document.querySelector("#release-detail")) {
  initReleaseDetail();
}
