import { STATIC_GATEWAY_FIXTURES } from "./static-gateway-fixtures.js";

const PENDING_METADATA = Object.freeze({
  sourceType: "bundled provider contract fixture",
  sampleWindow: "Awaiting deterministic fixture selection",
  freshness: "Pending",
  failureState: "none",
  sampleCount: 0,
});

function snapshot(state, refreshNumber, metadata) {
  return Object.freeze({ state, refreshNumber, ...metadata });
}

/**
 * Deterministic, client-only stand-in for an asynchronous sampling gateway.
 * The injected scheduler makes the asynchronous boundary testable without
 * clocks. A new instance always replays the same bundled fixture sequence.
 */
export function createStaticGatewaySimulator({
  fixtures = STATIC_GATEWAY_FIXTURES,
  schedule = (complete) => setTimeout(complete, 0),
} = {}) {
  if (!Array.isArray(fixtures) || fixtures.length === 0)
    throw new TypeError("At least one static gateway fixture is required.");

  let refreshNumber = 0;
  let current = snapshot("pending", refreshNumber, PENDING_METADATA);

  return Object.freeze({
    current: () => current,
    refresh(onTransition = () => {}) {
      refreshNumber += 1;
      const thisRefresh = refreshNumber;
      current = snapshot("pending", thisRefresh, PENDING_METADATA);
      onTransition(current);

      const fixture = fixtures[(thisRefresh - 1) % fixtures.length];
      const settled = new Promise((resolve) => {
        schedule(() => {
          const result = snapshot(fixture.state, thisRefresh, fixture);
          if (thisRefresh === refreshNumber) {
            current = result;
            onTransition(current);
          }
          resolve(result);
        });
      });
      return Object.freeze({ pending: current, settled });
    },
  });
}

export function gatewayStateCopy(snapshotValue) {
  if (snapshotValue.state === "completed") {
    return {
      label: "Completed",
      summary: `${snapshotValue.sampleCount} deterministic aggregate sample ready.`,
    };
  }
  if (snapshotValue.state === "unavailable") {
    return {
      label: "Unavailable",
      summary: "No new sample was published. Bundled fixture state is shown below.",
    };
  }
  return {
    label: "Pending",
    summary: "Selecting the next bundled fixture. No network request is running.",
  };
}
