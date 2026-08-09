export const HEALTH_STATUS = "healthy";

/** A credential-free release probe derived only from the built artifact. */
export function healthContract(stamp) {
  return Object.freeze({
    status: HEALTH_STATUS,
    version: stamp?.commitSha ?? "unstamped",
  });
}

