// The lead's own class labels, kept across a reload — as hashes, and nothing else.
//
// WHAT IS STORED, EXACTLY. One key, one JSON object, four fields:
//
//   { "v": 1, "hash": "sha-256", "export": "<hex>", "labels": { "<hex>": "class" } }
//
// `labels` maps a one-way digest of the cluster's identity to the class the lead
// chose. There is no query text in it, no spend figure, no department, no
// provider name, and no timestamp taken off a row — a reviewer can open this key
// in devtools and read the whole artifact in one line. That is the point of the
// shape: the claim the panel makes in prose is checkable against the bytes.
//
// WHY A HASH AND NOT THE KEY ITSELF. A residue cluster is keyed by the row's
// vendor, model or org unit — a provider string. Writing it down would put the
// reader's own vendor names in this browser's storage for the sake of a
// convenience feature, so the key is digested on the way in and the lookup runs
// the same digest over the corpus that is on screen. An entry that matches
// nothing is ignored; nothing is ever fuzzy-matched.
//
// TWO HASH MODES, NEVER MIXED. `crypto.subtle` does not exist on an insecure
// origin, so there is a deterministic non-cryptographic fallback. A store
// carries the mode that wrote it and a reader in the other mode treats it as a
// different store — not as a store to reinterpret. The two digests of one string
// are different strings, and reading one as the other would silently relabel
// whatever it collided with.
//
// NOTHING HERE THROWS. `localStorage` throws on the accessor when site data is
// disabled and on `setItem` when the quota is full, and both are ordinary states
// on this page rather than errors. Every entry point catches and reports; a
// caller degrades to memory and says so in the panel.

/** The one key this module reads or writes. Namespaced like the workspace record. */
export const QUERY_OVERRIDE_KEY = "shiplog.finops.query-overrides.v1";

/** Bump when a field below changes meaning. An older or newer store is ignored. */
export const QUERY_OVERRIDE_SCHEMA = 1;

/** Which digest wrote a store. A store written by one is invisible to the other. */
export const HASH_MODE = Object.freeze({ digest: "sha-256", fallback: "fnv1a-64" });

/**
 * The most entries kept. The control offers five clusters per corpus, so this is
 * a quota bound rather than a product limit: past it the extra keys are dropped
 * rather than growing an unbounded object in a store that can refuse a write.
 */
export const MAX_STORED_OVERRIDES = 100;

/** What the panel states, authored once so the prose and the bytes agree. */
export const OVERRIDE_RETENTION_TEXT =
  "Kept in this browser only: a one-way hash of each cluster's identity and the class you "
  + "chose. Your query text, your spend figures, your department names and your provider names "
  + "are never written, and nothing here is ever sent anywhere.";

/** Shown when this browser refused the read or the write. Not an error state. */
export const OVERRIDE_UNAVAILABLE_NOTICE =
  "This browser would not store your corrections, so they apply to the figures on screen but "
  + "will not survive a reload. Nothing else about this analysis changed.";

/** The clear control's name, and the sentence its result is announced with. */
export const OVERRIDE_CLEAR_LABEL = "Clear my corrections";
export const OVERRIDE_CLEARED_ANNOUNCEMENT =
  "Your corrections were cleared from this browser. The figures are back to what your export "
  + "earned on its own.";

/** A stored key is a digest this module produced, and nothing else is read. */
const HEX_KEY = /^[0-9a-f]{16,64}$/;

/** The longest label kept. A rubric class key is far shorter; anything else is junk. */
const MAX_LABEL_LENGTH = 64;

const FNV_OFFSET_BASIS = 0x81_1c_9d_c5;
const FNV_ALTERNATE_BASIS = 0x9d_c5_81_1c;
const FNV_PRIME = 0x01_00_01_93;

function fnv1a(text, basis) {
  let hash = basis >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash ^ text.charCodeAt(index)) >>> 0;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

const hex32 = (value) => (value >>> 0).toString(16).padStart(8, "0");

/**
 * The insecure-origin digest: two FNV-1a passes from different bases, 64 bits of
 * hex. Integer arithmetic only, so two engines agree bit for bit. It is not a
 * cryptographic hash and is not labelled as one — `HASH_MODE.fallback` is
 * written into the store precisely so it can never be read as one.
 */
export function fallbackDigest(text) {
  const value = String(text ?? "");
  return `${hex32(fnv1a(value, FNV_OFFSET_BASIS))}${hex32(fnv1a(value, FNV_ALTERNATE_BASIS))}`;
}

function subtleOf(scope) {
  try {
    const subtle = scope?.crypto?.subtle;
    if (typeof subtle?.digest !== "function") return null;
    return typeof TextEncoder === "function" ? subtle : null;
  } catch {
    return null;
  }
}

const toHex = (bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Digest one string. Pure in the sense that matters here: the same text yields
 * the same `{ mode, hex }` on every reload and in every export, and no part of
 * the input is retained past the call.
 *
 * @param text the cluster identity, or the corpus fingerprint's source string.
 * @param options `{ scope }` — where `crypto` is looked up, so a test can drive
 *   the insecure-origin path without uninstalling a global.
 * @returns a promise that never rejects: a refusing SubtleCrypto falls back.
 */
export async function hashText(text, { scope = globalThis } = {}) {
  const value = typeof text === "string" ? text : String(text ?? "");
  const subtle = subtleOf(scope);
  if (subtle) {
    try {
      const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
      return Object.freeze({ mode: HASH_MODE.digest, hex: toHex(new Uint8Array(digest)) });
    } catch {
      // An origin that exposes `crypto.subtle` and then refuses it is the same
      // situation as one that never had it. Fall through rather than reject.
    }
  }
  return Object.freeze({ mode: HASH_MODE.fallback, hex: fallbackDigest(value) });
}

/**
 * The browser capability, acquired here rather than in the page. Reading the
 * accessor is what throws when site data is disabled, so it is the read that has
 * to be wrapped, not the call after it.
 */
export function browserQueryOverrideStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

const outcome = (available, reason, entries = new Map()) =>
  Object.freeze({ available, matched: reason === "restored", reason, entries });

/**
 * Read the labels this browser holds for one export.
 *
 * @param storage this browser's `localStorage`, or a stand-in, or null.
 * @param options `{ fingerprint, mode }` — the digest of the corpus on screen
 *   and the mode that produced it. A store from a different export, a different
 *   hash mode or a different schema returns no entries AND IS LEFT ALONE: the
 *   lead's clear control is the only path that deletes anything.
 * @returns `{ available, matched, reason, entries }`. `available` is false only
 *   when this browser refused the read, which is what the panel reports.
 */
export function readOverrides(storage, { fingerprint = null, mode = null } = {}) {
  let raw;
  try {
    raw = storage?.getItem(QUERY_OVERRIDE_KEY) ?? null;
  } catch {
    return outcome(false, "storage_unreadable");
  }
  if (raw === null) return outcome(true, "absent");

  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return outcome(true, "unreadable");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return outcome(true, "unreadable");
  if (value.v !== QUERY_OVERRIDE_SCHEMA) return outcome(true, "other_schema");
  if (typeof value.hash !== "string" || (mode && value.hash !== mode)) {
    return outcome(true, "other_hash_mode");
  }
  if (typeof value.export !== "string" || (fingerprint && value.export !== fingerprint)) {
    return outcome(true, "other_export");
  }

  const stored = value.labels && typeof value.labels === "object" && !Array.isArray(value.labels)
    ? value.labels : {};
  const entries = new Map();
  // `Object.entries` on a parsed object can hand back a literal `__proto__` key.
  // It is refused by the hex test rather than by name, because a key that is not
  // a digest this module wrote is not a key this module reads.
  for (const [key, label] of Object.entries(stored)) {
    if (entries.size >= MAX_STORED_OVERRIDES) break;
    if (!HEX_KEY.test(key)) continue;
    if (typeof label !== "string" || !label || label.length > MAX_LABEL_LENGTH) continue;
    entries.set(key, label);
  }
  return outcome(true, "restored", entries);
}

/**
 * Write the labels for one export, replacing whatever was there.
 *
 * @param options `{ fingerprint, mode, entries }` — entries is an iterable of
 *   `[digest, label]`. A missing or malformed fingerprint refuses the write
 *   rather than storing labels no reader could scope.
 * @returns `{ ok, reason }`. Never throws: a full quota is a reported outcome.
 */
export function writeOverrides(storage, { fingerprint = null, mode = null, entries = [] } = {}) {
  if (typeof fingerprint !== "string" || !HEX_KEY.test(fingerprint)) {
    return Object.freeze({ ok: false, reason: "unfingerprinted" });
  }
  if (mode !== HASH_MODE.digest && mode !== HASH_MODE.fallback) {
    return Object.freeze({ ok: false, reason: "unknown_hash_mode" });
  }
  const labels = {};
  let count = 0;
  for (const [key, label] of entries) {
    if (count >= MAX_STORED_OVERRIDES) break;
    if (!HEX_KEY.test(String(key))) continue;
    if (typeof label !== "string" || !label || label.length > MAX_LABEL_LENGTH) continue;
    labels[key] = label;
    count += 1;
  }
  try {
    storage.setItem(QUERY_OVERRIDE_KEY, JSON.stringify({
      v: QUERY_OVERRIDE_SCHEMA, hash: mode, export: fingerprint, labels,
    }));
    return Object.freeze({ ok: true, reason: count ? "written" : "emptied", count });
  } catch {
    return Object.freeze({ ok: false, reason: "storage_refused" });
  }
}

/** Empty the key. The one destructive path, and only the lead's control calls it. */
export function clearOverrides(storage) {
  try {
    storage.removeItem(QUERY_OVERRIDE_KEY);
    return Object.freeze({ ok: true, reason: "cleared" });
  } catch {
    return Object.freeze({ ok: false, reason: "storage_refused" });
  }
}
