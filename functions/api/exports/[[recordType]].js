import { createD1ExportStore, handleExportRequest } from "../../../src/exports.js";
import { createSavingsPortfolio } from "../../../src/savings-portfolio.js";
import savingsPortfolioFixture from "../../../src/savings-portfolio-fixture.json" with { type: "json" };
import { createMonthlySavingsReconciliation } from "../../../src/monthly-savings-reconciliation.js";
import reconciliationFixture from "../../../src/monthly-savings-reconciliation-fixture.json" with { type: "json" };

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
  const onError = (error, context) => {
    console.error("JSON export failed", { ...context, message: error?.message });
  };
  // Both static contracts export from bundled fixtures, with no database,
  // credential, or network call of their own.
  const staticPath = new URL(request.url).pathname.replace(/\/+$/, "");
  if (staticPath === "/api/exports/portfolio") return handleExportRequest(request, {
    store: {},
    requestId,
    listPortfolio: () => createSavingsPortfolio(savingsPortfolioFixture),
    onError,
  });
  if (staticPath === "/api/exports/reconciliation") return handleExportRequest(request, {
    store: {},
    requestId,
    listReconciliation: () => createMonthlySavingsReconciliation(
      reconciliationFixture, createSavingsPortfolio(savingsPortfolioFixture),
    ),
    onError,
  });
  if (!env?.DB || typeof env.DB.prepare !== "function") return unavailable(requestId);
  return handleExportRequest(request, {
    store: createD1ExportStore(env.DB),
    requestId,
    onError,
  });
}
