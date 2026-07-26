import { createD1LeadStore, handleLeadRequest } from "../../src/leads.js";

export function onRequest({ request, env }) {
  if (typeof env?.DB?.prepare !== "function") {
    return new Response(JSON.stringify({ error: "Email signup is temporarily unavailable." }), {
      status: 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  return handleLeadRequest(request, { store: createD1LeadStore(env.DB) });
}
