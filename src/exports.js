import {
  linkShiplogRecords,
  snapshotDecisions,
  snapshotReleases,
} from "./shiplog-snapshot.js";

// Still "1". Every change the linked snapshot made to this payload is additive
// (`links`, `metadata.counts`, `metadata.unresolvedLinks`) or narrowing (only
// declared fields, canonical order, no dangling reference). A reader written
// against version 1 keeps working on both counts, and bumping the number would
// only invalidate stored exports to buy nothing.
export const EXPORT_VERSION = "1";

const EXPORT_PATH =
  /^\/api\/exports(?:\/(decisions|releases|portfolio|reconciliation))?\/?$/;

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
  // Both logs in one file is the only case where an association can be
  // resolved, so it is the only case that carries `links`. A single-table
  // export still gets the allowlist and the canonical order; it just leaves
  // each release's `decisionIds` as the release recorded them, because there
  // are no decisions in the file to check them against.
  if (records.decisions !== undefined && records.releases !== undefined) {
    const snapshot = linkShiplogRecords(records.decisions, records.releases);
    payload.metadata.counts = snapshot.counts;
    payload.metadata.unresolvedLinks = snapshot.unresolvedLinks;
    payload.decisions = snapshot.decisions;
    payload.releases = snapshot.releases;
    payload.links = snapshot.links;
  } else {
    if (records.decisions !== undefined) payload.decisions = snapshotDecisions(records.decisions);
    if (records.releases !== undefined) payload.releases = snapshotReleases(records.releases);
  }
  if (records.portfolio !== undefined) payload.portfolio = structuredClone(records.portfolio);
  if (records.reconciliation !== undefined) {
    payload.reconciliation = structuredClone(records.reconciliation);
  }
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
    if (type === "portfolio") {
      records = { portfolio: await deps.listPortfolio() };
    } else if (type === "reconciliation") {
      records = { reconciliation: await deps.listReconciliation() };
    } else if (type === "all" && typeof deps.store.listAll === "function") {
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

// Deterministic at the query, not only in the handler. SQLite is free to return
// rows in any order it likes and will change that order as soon as a query plan
// changes; naming the order here means the rows arrive in the same sequence the
// snapshot writes them in, so a paged or truncated read can never silently
// reshuffle the file. `createdAt` is not unique, hence the id tiebreak — the
// same total order shiplog-export-schema.js defines for the browser export.
const EXPORT_ORDER = "ORDER BY createdAt ASC, id ASC";

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
    await database.prepare(`SELECT * FROM ${table} ${EXPORT_ORDER}`).all(),
    table,
  );
  return Object.freeze({
    listDecisions: () => list("decisions"),
    listReleases: async () => (await list("releases")).map(parseDecisionIds),
    async listAll() {
      if (typeof database.batch !== "function") {
        throw new Error("The database does not support transactional batch exports.");
      }
      // One batch, so both logs are read from the same point in time: a release
      // recorded between two separate reads would otherwise export a link to a
      // decision the file does not carry.
      const [decisionResult, releaseResult] = await database.batch([
        database.prepare(`SELECT * FROM decisions ${EXPORT_ORDER}`),
        database.prepare(`SELECT * FROM releases ${EXPORT_ORDER}`),
      ]);
      return {
        decisions: readResult(decisionResult, "decisions"),
        releases: readResult(releaseResult, "releases").map(parseDecisionIds),
      };
    },
  });
}
