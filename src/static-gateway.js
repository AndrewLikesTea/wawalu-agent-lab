import { inspectIntegrationFixtures } from "./integration-contracts.js";
import { STATIC_GATEWAY_FIXTURES } from "./static-gateway-fixtures.js";

const SOURCE_TYPE = "bundled static contract fixtures";
const FIXTURE_CLOCK = "2026-07-25T12:00:00Z";

function metadataFor(fixtures, failureState = "none") {
  const snapshot = fixtures?.provider?.snapshot ?? {};
  const generatedAt = snapshot.generated_at ?? null;
  const ageHours = generatedAt
    ? Math.max(0, (Date.parse(FIXTURE_CLOCK) - Date.parse(generatedAt)) / 3_600_000)
    : Number.POSITIVE_INFINITY;
  return Object.freeze({
    sourceType: SOURCE_TYPE,
    sampleWindow: snapshot.period_start && snapshot.period_end
      ? `${snapshot.period_start} to ${snapshot.period_end}` : "unavailable",
    freshness: ageHours <= 24 ? "current" : ageHours <= 72 ? "stale" : "degraded",
    generatedAt,
    failureState,
  });
}

function frozenState(status, fixtures, inspection = null, failureState = "none") {
  return Object.freeze({
    status,
    inspection,
    metadata: metadataFor(fixtures, failureState),
  });
}

/**
 * Deterministic browser-local async gateway. The scheduler is injectable for
 * tests; the default zero-delay task lets the browser paint the pending state
 * without network requests, clocks in the result, or nondeterministic input.
 */
export function createStaticGateway({
  fixtures = STATIC_GATEWAY_FIXTURES,
  schedule = () => new Promise((resolve) => setTimeout(resolve, 0)),
} = {}) {
  let state = frozenState("unavailable", fixtures, null, "not_started");
  const listeners = new Set();
  const publish = (next) => {
    state = next;
    for (const listener of listeners) listener(state);
  };

  return Object.freeze({
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    async refresh() {
      publish(frozenState("pending", fixtures));
      try {
        await schedule();
      } catch {
        publish(frozenState("unavailable", fixtures, null, "gateway_processing_failed"));
        return state;
      }
      try {
        const inspection = inspectIntegrationFixtures(fixtures.hris, fixtures.provider);
        publish(frozenState("completed", fixtures, inspection));
      } catch {
        publish(frozenState("unavailable", fixtures, null, "fixture_validation_failed"));
      }
      return state;
    },
  });
}
