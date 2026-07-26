// Shared, dependency-free clipboard behavior for public proof records.
// URLs are built from the record type and id rather than the current query
// string, so unrelated search params and fragments never enter a shared link.

const RECORD_PATHS = {
  decision: "/decision.html",
  release: "/release.html",
};

export function recordHref(type, id) {
  const path = RECORD_PATHS[type];
  if (!path || typeof id !== "string" || id === "") return "";
  return `${path}?id=${encodeURIComponent(id)}`;
}

export function recordUrl(origin, type, id) {
  const href = recordHref(type, id);
  if (!href) return "";
  try {
    return new URL(href, origin).href;
  } catch {
    return "";
  }
}

export async function copyRecordUrl(clipboard, url) {
  if (!url || typeof clipboard?.writeText !== "function") return false;
  try {
    await clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

export function createShareControl({
  type,
  id,
  origin = globalThis.location?.origin,
  clipboard = globalThis.navigator?.clipboard,
} = {}) {
  const url = recordUrl(origin, type, id);
  if (!url) return null;

  const group = document.createElement("div");
  group.className = "share-control";
  const button = document.createElement("button");
  button.className = "share-button";
  button.type = "button";
  button.textContent = "Copy link";
  button.setAttribute("aria-describedby", "share-status");
  const status = document.createElement("span");
  status.className = "share-status";
  status.id = "share-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "";
    const copied = await copyRecordUrl(clipboard, url);
    status.textContent = copied
      ? "Link copied to clipboard."
      : "Could not copy the link. Copy it from the address bar.";
    button.disabled = false;
  });
  group.append(button, status);
  return group;
}
