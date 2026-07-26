// Who "you" are in a demo with no accounts.
//
// Shiplog has no human sign-in — browser writes are identified at the edge by a
// hashed address the client never sees (src/social-edge.js). The profile view
// still needs a subject, so it uses the display name this browser last posted
// under: self-asserted, local-only, and never sent anywhere it is not already
// going as a byline. It is a UI convenience, not an identity claim, which is why
// nothing downstream trusts it.
//
// Storage access is wrapped because `localStorage` throws outright in some
// privacy modes; a browser that refuses it gets the default name, not a broken
// page.

export const AUTHOR_STORAGE_KEY = "shiplog.social.author";
export const MAX_AUTHOR_LENGTH = 60;
export const DEFAULT_AUTHOR = "Guest";

export function readStoredAuthor(storage) {
  try {
    const value = storage?.getItem(AUTHOR_STORAGE_KEY);
    const name = typeof value === "string" ? value.trim() : "";
    return name && name.length <= MAX_AUTHOR_LENGTH ? name : null;
  } catch {
    return null;
  }
}

export function rememberAuthor(storage, name) {
  const value = String(name ?? "").trim();
  if (!value || value.length > MAX_AUTHOR_LENGTH) return null;
  try {
    storage?.setItem(AUTHOR_STORAGE_KEY, value);
  } catch {
    // A full or blocked store costs the convenience, never the post.
  }
  return value;
}
