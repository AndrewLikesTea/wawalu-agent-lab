// Complete archive contract. No storage, ambient clock, or application state.
export const ARCHIVE_SCHEMA_VERSION = 1;
export const ARCHIVE_MAX_BYTES = 5 * 1024 * 1024;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const ARCHIVE_DECISION_FIELDS = ["id", "title", "context", "alternatives", "owner", "status", "createdAt", "supersedes"];
export const ARCHIVE_RELEASE_FIELDS = ["id", "version", "title", "description", "notes", "owner", "author", "status", "createdAt"];

function records(rows, fields, required) {
  if (!Array.isArray(rows) || rows.length > 10000) throw new TypeError("Invalid archive collection.");
  const ids = new Set();
  return rows.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new TypeError("Invalid archive record.");
    const record = {};
    for (const field of fields) {
      // Older decisions legitimately predate alternatives.
      const value = field === "alternatives" ? row[field] ?? "" : row[field];
      if (value === undefined && !required.includes(field)) continue;
      if (typeof value !== "string") throw new TypeError(`Invalid archive field: ${field}.`);
      record[field] = value;
    }
    if (!record.id || ids.has(record.id)) throw new TypeError("Invalid or duplicate archive identifier.");
    ids.add(record.id);
    return record;
  }).sort((a, b) => compare(a.id, b.id));
}

export function createShiplogArchive(input, { generatedAt } = {}) {
  if (typeof generatedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(generatedAt)
    || !Number.isFinite(Date.parse(generatedAt)) || new Date(generatedAt).toISOString() !== generatedAt) {
    throw new TypeError("Archive generatedAt must be an explicit UTC ISO timestamp.");
  }
  const decisions = records(input?.decisions, ARCHIVE_DECISION_FIELDS, ["id", "context", "alternatives", "owner", "status"]);
  const releases = records(input?.releases, ARCHIVE_RELEASE_FIELDS, ["id"]);
  const originals = new Map(input.releases.map(row => [row.id, row]));
  for (const release of releases) {
    const ids = originals.get(release.id).decisionIds ?? [];
    if (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !id)) {
      throw new TypeError("Invalid release decision identifiers.");
    }
    // Preserve even unresolved identifiers: a complete archive must not lose
    // an association merely because its decision is no longer stored.
    release.decisionIds = [...new Set(ids)].sort(compare);
  }
  return { schemaVersion: ARCHIVE_SCHEMA_VERSION, generatedAt, decisions, releases };
}

export function serializeShiplogArchive(input, options) {
  return JSON.stringify(createShiplogArchive(input, options), null, 2) + "\n";
}

export async function handleArchiveRequest(request, { now = () => new Date() } = {}) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  const error = (status, message) => new Response(JSON.stringify({ error: message }), { status, headers });
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST to archive browser records." }), {
      status: 405, headers: { ...headers, allow: "POST" },
    });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return error(403, "Cross-origin archive requests are not allowed.");
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return error(415, "Use application/json.");
  if (Number(request.headers.get("content-length")) > ARCHIVE_MAX_BYTES) return error(413, "Archive exceeds 5 MiB.");
  // Bound actual streamed bytes, not just a caller-controlled Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return error(400, "Archive records are required.");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > ARCHIVE_MAX_BYTES) {
        await reader.cancel();
        return error(413, "Archive exceeds 5 MiB.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const generatedAt = now().toISOString();
    const body = serializeShiplogArchive(input, { generatedAt });
    return new Response(body, { headers: {
      ...headers,
      "content-disposition": `attachment; filename="shiplog-archive-${generatedAt.slice(0, 10)}.json"`,
    } });
  } catch {
    return error(400, "Invalid Shiplog archive records or timestamp.");
  } finally {
    reader.releaseLock();
  }
}
