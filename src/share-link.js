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

// What a copy control says once it has been pressed, in the two outcomes it can
// have. The failure line names the next step rather than the cause: every page
// that carries one of these controls is the page whose address is being copied,
// so the address bar is a real fallback. The post copy control in post-share.js
// is built out of copyRecordUrl below but says its own lines, because the page
// it sits on is not always the post's address.
export const SHARE_COPIED_STATUS = "Link copied to clipboard.";
export const SHARE_COPY_FAILED_STATUS = "Could not copy the link. Copy it from the address bar.";

/**
 * Write one string to the clipboard, and report whether it was written.
 *
 * The rule this holds is the capability check: a browser — or an embedded view,
 * or an insecure origin — without `navigator.clipboard` gets a stated `false`
 * rather than a click handler that throws, and the write is awaited so the
 * caller's status line reports what actually happened rather than what was
 * attempted. A rejected write is the same answer as a missing API, because the
 * reader's clipboard is empty either way.
 *
 * Generic because the second thing this site copies is not an address: the
 * release log's brief (see buildReleaseBrief in releases.js) is a paragraph of
 * record text. Two spellings of "guard, await, report" is how one of them stops
 * guarding, so there is one, and `copyRecordUrl` below is its URL-shaped name.
 */
export async function copyText(clipboard, text) {
  if (!text || typeof clipboard?.writeText !== "function") return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// The URL-shaped name for the same rule. Deliberately not an `async` wrapper:
// awaiting the delegate would add a microtask turn to every existing copy
// control, so this hands back copyText's own promise and the callers settle in
// exactly the number of turns they always did.
export function copyRecordUrl(clipboard, url) {
  return copyText(clipboard, url);
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
    status.textContent = copied ? SHARE_COPIED_STATUS : SHARE_COPY_FAILED_STATUS;
    button.disabled = false;
  });
  group.append(button, status);
  return group;
}
