import { BriefingProjectionError } from "./executive-briefing-projection.js";
import { executivePayloadHref } from "./executive-payload-share.js";

const put = (root, id, value) => {
  const node = root.getElementById(id);
  if (node) node.textContent = value;
};

/**
 * The status line without its instant.
 *
 * Split out so the build can seed this region with a true sentence and no
 * clock: scripts/seed-first-screen.mjs writes this prefix into the shipped
 * document, and the paint below completes it with the moment the payload was
 * regenerated in the reader's own browser. One string, one file, no drift.
 */
export const PROJECTION_STATUS_PREFIX = (schemaVersion) =>
  "Briefing claims generated locally";

export function renderExecutiveBriefingProjection(root, result) {
  const region = root.getElementById("executive-briefing-projection");
  if (!region) return null;
  region.dataset.state = "ready";
  put(root, "executive-briefing-projection-status",
    `${PROJECTION_STATUS_PREFIX()} · ${result.generatedAt}`);
  put(root, "executive-briefing-projection-payload", JSON.stringify(result, null, 2));
  const open = root.getElementById("executive-briefing-projection-open");
  if (open?.setAttribute) open.setAttribute("href", executivePayloadHref(result));
  else if (open) open.href = executivePayloadHref(result);
  return region;
}

export function renderExecutiveBriefingProjectionError(root, error) {
  const region = root.getElementById("executive-briefing-projection");
  if (!region) return null;
  region.dataset.state = "error";
  const detail = error instanceof BriefingProjectionError
    ? `${error.code}: ${error.paths.join(", ")}`
    : "unexpected-generation-failure";
  put(root, "executive-briefing-projection-status", `Briefing not generated · ${detail}`);
  put(root, "executive-briefing-projection-payload", "");
  return region;
}
