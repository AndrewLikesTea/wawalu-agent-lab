import { BriefingProjectionError } from "./executive-briefing-projection.js";

const put = (root, id, value) => {
  const node = root.getElementById(id);
  if (node) node.textContent = value;
};

export function renderExecutiveBriefingProjection(root, result) {
  const region = root.getElementById("executive-briefing-projection");
  if (!region) return null;
  region.dataset.state = "ready";
  put(root, "executive-briefing-projection-status",
    `Briefing generated locally · ${result.schemaVersion} · ${result.generatedAt}`);
  put(root, "executive-briefing-projection-payload", JSON.stringify(result, null, 2));
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
