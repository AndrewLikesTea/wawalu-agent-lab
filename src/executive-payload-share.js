import { validatePayload } from "./executive-payload-briefing-view.js";

export const EXECUTIVE_PAYLOAD_FRAGMENT = "payload";
export const MAX_EXECUTIVE_PAYLOAD_TOKEN = 16384;

function base64url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unbase64url(token) {
  const padded = token.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (value) => value.charCodeAt(0)));
}

export function executivePayloadToken(payload) {
  const errors = validatePayload(payload);
  if (errors.length) throw new TypeError(`Cannot share malformed executive briefing: ${errors.join(", ")}`);
  const token = base64url(JSON.stringify(payload));
  if (token.length > MAX_EXECUTIVE_PAYLOAD_TOKEN) throw new RangeError("Executive briefing share token is too long");
  return token;
}

export function readExecutivePayloadFragment(hash) {
  try {
    const token = new URLSearchParams(String(hash ?? "").replace(/^#/, "")).get(EXECUTIVE_PAYLOAD_FRAGMENT);
    if (!token || token.length > MAX_EXECUTIVE_PAYLOAD_TOKEN || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
    const payload = JSON.parse(unbase64url(token));
    return validatePayload(payload).length === 0 ? payload : null;
  } catch {
    return null;
  }
}

export function executivePayloadHref(payload, base = "/executive-briefing.html?payload=bundled") {
  return `${base}#${EXECUTIVE_PAYLOAD_FRAGMENT}=${executivePayloadToken(payload)}`;
}
