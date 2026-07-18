export const EXPORT_VERSION = "1";

const EXPORT_PATH = /^\/api\/exports(?:\/(decisions|releases))?\/?$/;

function jsonResponse(value, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value, null, 2), { ...init, headers });
}

function errorResponse(status, code, message, requestId) {
  return jsonResponse({ error: { code, message, requestId } }, {
    status,
    headers: { "x-request-id": requestId },
  });
}

export function createExport(records, options = {}) {
  const timestamp = options.timestamp ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(timestamp))) throw new TypeError("Export timestamp must be an ISO date.");

  const payload = {
    metadata: { timestamp, version: EXPORT_VERSION },
  };
  if (records.decisions !== undefined) payload.decisions = structuredClone(records.decisions);
  if (records.releases !== undefined) payload.releases = structuredClone(records.releases);
  return payload;
}

export async function handleExportRequest(request, deps) {
  const requestId = deps.requestId ?? globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  const match = new URL(request.url).pathname.match(EXPORT_PATH);
  if (!match) return errorResponse(404, "not_found", "Export endpoint not found.", requestId);
  if (request.method !== "GET") {
    const response = errorResponse(405, "method_not_allowed", "Exports only support GET requests.", requestId);
    response.headers.set("allow", "GET");
    return response;
  }

  const type = match[1] ?? "all";
  try {
    let records;
    if (type === "all" && typeof deps.store.listAll === "function") {
      records = await deps.store.listAll();
    } else {
      records = {};
      if (type === "all" || type === "decisions") records.decisions = await deps.store.listDecisions();
      if (type === "all" || type === "releases") records.releases = await deps.store.listReleases();
    }
    const timestamp = deps.now?.().toISOString() ?? new Date().toISOString();
    const response = jsonResponse(createExport(records, { timestamp }), {
      headers: {
        "content-disposition": `attachment; filename="shiplog-${type}-${timestamp.slice(0, 10)}.json"`,
        "x-request-id": requestId,
      },
    });
    return response;
  } catch (error) {
    deps.onError?.(error, { requestId, type });
    return errorResponse(503, "export_unavailable", "The export could not be generated.", requestId);
  }
}

function parseDecisionIds(record) {
  if (Array.isArray(record.decisionIds)) return record;
  if (typeof record.decisionIds !== "string") return record;
  try {
    const decisionIds = JSON.parse(record.decisionIds);
    return Array.isArray(decisionIds) ? { ...record, decisionIds } : record;
  } catch {
    return record;
  }
}

export function createD1ExportStore(database) {
  if (!database || typeof database.prepare !== "function") {
    throw new TypeError("A D1-compatible database is required.");
  }
  const readResult = (result, table) => {
    if (!result?.success || !Array.isArray(result.results)) {
      throw new Error(`Could not read ${table} for export.`);
    }
    return result.results;
  };
  const list = async (table) => readResult(
    await database.prepare(`SELECT * FROM ${table}`).all(),
    table,
  );
  return Object.freeze({
    listDecisions: () => list("decisions"),
    listReleases: async () => (await list("releases")).map(parseDecisionIds),
    async listAll() {
      if (typeof database.batch !== "function") {
        throw new Error("The database does not support transactional batch exports.");
      }
      const [decisionResult, releaseResult] = await database.batch([
        database.prepare("SELECT * FROM decisions"),
        database.prepare("SELECT * FROM releases"),
      ]);
      return {
        decisions: readResult(decisionResult, "decisions"),
        releases: readResult(releaseResult, "releases").map(parseDecisionIds),
      };
    },
  });
}
