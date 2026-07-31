// One loader for the modules a destination needs and the answer screen does not.
//
// WHAT THIS FIXES. `finops-workspace-shell.js` composed each destination's
// dataset on first open, which was the right lifecycle — but it reached those
// computations through STATIC imports, so the modules themselves were fetched,
// parsed and evaluated before the answer block could paint. The open was lazy;
// the payload was not. A reader who never leaves the answer still paid for the
// briefing contract, the leading finding, and the destination record.
//
// So the shell hands this module a thunk per destination, each one a native
// `import()`, and this module owns the four things that turns into: when it
// runs, what happens while it is in flight, what happens when it fails, and
// what a retry after a failure is allowed to do.
//
// THE CACHE IS A MAP OF PROMISES AND NOTHING ELSE. No bundler plugin, no build
// step, no dependency, no window global, no reactive wrapper. `import()` is
// what the served origin already supports and what `scripts/check-size-budget.mjs`
// already declines to count, which is what makes the deferral measurable rather
// than claimed.
//
// A FAILED LOAD IS NOT CACHED. This is the whole point of the module and the
// one rule worth stating twice: the cache entry is deleted BEFORE the failed
// result is handed back, so the retry a reader presses from the error state
// re-invokes the import instead of being handed the same failure forever. A
// network that recovers is the ordinary case — a page that has to be reloaded
// to notice is the defect.
//
// A SUCCESSFUL LOAD IS CACHED FOREVER. No invalidation and no eviction: every
// thunk is a pure read of a fixture bundled in this build, so a second call
// could only ever produce an equal value, and a second open therefore returns
// the same object identity.
//
// IT NEVER REJECTS. `load()` resolves to a result record in every case,
// including failure. A destination open is fire-and-forget from the shell's
// synchronous paint path, and a promise that rejects there is an unhandled
// rejection in a reader's console for a state the page has already drawn.

/** The four states one destination's module can be in. There is no fifth. */
export const DESTINATION_LOAD_STATE = Object.freeze({
  idle: "idle",
  loading: "loading",
  ready: "ready",
  error: "error",
});

/**
 * The result of one `load()`. `absent` is a destination with no module to
 * fetch — the answer — and it is a resolution, not a failure.
 */
const result = (key, status, value, error) =>
  Object.freeze({ key, status, value: value ?? null, error: error ?? null });

/**
 * Build a loader over a map of `key -> () => Promise<value>`.
 *
 * A factory rather than a module singleton so a test can drive the failure and
 * retry paths with a thunk it controls, and so two surfaces could hold
 * independent caches without one clearing the other's.
 */
export function createDestinationLoader(sources = {}) {
  /** key -> the promise for a load that is in flight or has succeeded. */
  const held = new Map();
  /** key -> the resolved value, in first-ready order. */
  const values = new Map();
  /** key -> DESTINATION_LOAD_STATE. Absent means idle. */
  const states = new Map();
  /** key -> how many times this key's thunk has actually been invoked. */
  const invocations = new Map();

  function load(key) {
    const source = sources[key];
    if (typeof source !== "function") return Promise.resolve(result(key, "absent"));
    const inFlight = held.get(key);
    if (inFlight) return inFlight;

    states.set(key, DESTINATION_LOAD_STATE.loading);
    invocations.set(key, (invocations.get(key) ?? 0) + 1);
    // `Promise.resolve().then(source)` rather than calling `source()` inline:
    // a thunk that throws synchronously would otherwise reach the rejection
    // handler BEFORE `held.set` below had run, and the delete-on-failure would
    // clear nothing — leaving a permanently rejected promise in the cache and
    // a retry control that cannot work. Deferring the first call by one
    // microtask makes the two orders the same order.
    const promise = Promise.resolve().then(source).then(
      (value) => {
        values.set(key, value ?? null);
        states.set(key, DESTINATION_LOAD_STATE.ready);
        return result(key, DESTINATION_LOAD_STATE.ready, value);
      },
      (error) => {
        held.delete(key);
        states.set(key, DESTINATION_LOAD_STATE.error);
        return result(key, DESTINATION_LOAD_STATE.error, null, error);
      },
    );
    held.set(key, promise);
    return promise;
  }

  return {
    load,

    /** The state of one key, without starting anything. */
    stateOf(key) {
      return states.get(key) ?? DESTINATION_LOAD_STATE.idle;
    },

    /** The loaded value for one key, or null while it is unloaded or failed. */
    value(key) {
      return values.get(key) ?? null;
    },

    /**
     * Which keys have a loaded value, in first-ready order. Observable rather
     * than inferred: a test asserts that opening one destination left the other
     * two unfetched, and a support conversation can ask a live page the same
     * question without reading a timing profile.
     */
    readyKeys() {
      return [...values.keys()];
    },

    /**
     * How many times a key's thunk has been invoked. This is what makes "a
     * second open does not re-fetch" and "a retry after a failure does" two
     * assertions rather than two hopes.
     */
    invocations(key) {
      return invocations.get(key) ?? 0;
    },

    /**
     * Record a value the caller already holds, without invoking its thunk.
     *
     * The page entry loads the destination record for the wayfinding rail
     * before the shell exists, and reading the same fixture a second time on
     * the first open would be a second copy of an object the page is already
     * holding. Seeding never overwrites a load that has already resolved.
     */
    seed(key, value) {
      if (held.has(key) || value === undefined || value === null) return false;
      values.set(key, value);
      states.set(key, DESTINATION_LOAD_STATE.ready);
      held.set(key, Promise.resolve(result(key, DESTINATION_LOAD_STATE.ready, value)));
      return true;
    },
  };
}
