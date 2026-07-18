import { createD1ExportStore, handleExportRequest } from "../../../src/exports.js";

function unavailable(requestId) {
  return new Response(JSON.stringify({
    error: {
      code: "storage_unavailable",
      message: "The export database (D1 binding 'DB') is not configured.",
      requestId,
    },
  }), {
    status: 503,
    headers: { "content-type": "application/json; charset=utf-8", "x-request-id": requestId },
  });
}

export async function onRequest({ request, env }) {
  const requestId = request.headers.get("cf-ray") ?? globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  if (!env?.DB || typeof env.DB.prepare !== "function") return unavailable(requestId);
  return handleExportRequest(request, {
    store: createD1ExportStore(env.DB),
    requestId,
    onError(error, context) {
      console.error("JSON export failed", { ...context, message: error?.message });
    },
  });
}
