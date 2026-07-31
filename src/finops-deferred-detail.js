// Disclosure-only evidence, fetched on first expand instead of shipped in the
// initial /evolution.html payload.
//
// WHAT THIS IS FOR. The AI FinOps page answers one question above the fold and
// puts everything that supports it behind native `details`. Some of that
// supporting evidence is hand-authored prose that no module composes and no
// figure depends on — it is only ever read by someone who opened the panel. It
// was still parsed, laid out, and paid for by every reader who never opened it.
//
// WHAT IT IS DELIBERATELY NOT. It is not a loader for anything the headline
// rests on. Every figure on this page is still composed eagerly by the modules
// that own it, and the page spine and the single headline finding render with
// no deferred fetch at all. A slot whose value the answer depends on does not
// belong here, and a reader must never have to open something to learn what
// this page decided.
//
// THE MECHANISM IS THE BORING ONE. A `fetch()` of a static JSON fragment that
// the ordinary build already ships out of `src/`. No bundler, no framework, no
// service worker, no new dependency, and nothing written to storage — so
// reverting the commit reverts the feature whole, with no cache or config left
// behind for a rollback to strand.
//
// THE FALLBACK IS THE SERVER-RENDERED STATE, not a state this module paints.
// The plain-text sentence a reader sees when the fetch is slow, fails, or never
// runs because JavaScript is unavailable is authored in `evolution.html` and is
// on screen before this module is even fetched. Success replaces it; failure
// restores it and adds one short line naming what could not be loaded, with a
// direct link to the static file. There is no spinner, because a spinner that
// outlives its request is a worse answer than the sentence it replaced.

/** Bump when a fragment's shape or a panel's contract changes meaning. */
export const DEFERRED_DETAIL_VERSION = "finops-deferred-detail/1.0.0";

/** How long a deferred fragment may take before the panel goes back to prose. */
export const DEFERRED_DETAIL_TIMEOUT_MS = 8000;

export const DEFERRED_STATE = Object.freeze({
  fallback: "fallback",
  loading: "loading",
  loaded: "loaded",
  unavailable: "unavailable",
});

/**
 * The panels whose detail is deferred, and the static file each one reads.
 *
 * `name` is what the failure sentence calls the missing content, in the words a
 * reader would use rather than the file's. It is never a path and never a code.
 */
export const DEFERRED_PANELS = Object.freeze([
  Object.freeze({
    key: "peer-benchmark-method",
    // The `details` whose expansion triggers the load, and the container inside
    // it that holds the server-rendered fallback.
    detailsId: "peer-benchmark-method",
    bodyId: "peer-benchmark-method-body",
    source: "/finops-detail/peer-benchmark-method.json",
    name: "the comparable-peer method",
  }),
]);

const PANELS_BY_KEY = new Map(DEFERRED_PANELS.map((panel) => [panel.key, panel]));

/** The panel record for a key, or null. Callers never index the array. */
export function deferredPanel(key) {
  return PANELS_BY_KEY.get(key) ?? null;
}

/**
 * Reject after `timeoutMs`, so a request that never settles cannot leave a
 * panel claiming it is still loading. The timer is cleared on settle either
 * way: an unref'd pending timer in a page is a leak, and in a test it is a
 * process that will not exit.
 */
function withTimeout(promise, timeoutMs, timers) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = timers.setTimeout(() => {
      reject(new Error(`deferred detail timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const settle = (settleWith) => (value) => {
      timers.clearTimeout(timer);
      settleWith(value);
    };
    promise.then(settle(resolve), settle(reject));
  });
}

function validEntries(payload) {
  const entries = Array.isArray(payload?.entries) ? payload.entries : null;
  if (!entries || entries.length === 0) throw new Error("deferred detail carried no entries");
  return entries.map((entry) => {
    const term = String(entry?.term ?? "").trim();
    const detail = String(entry?.detail ?? "").trim();
    if (!term || !detail) throw new Error("deferred detail entry is missing a term or a detail");
    return { term, detail };
  });
}

/**
 * One loader per page, holding the in-memory cache.
 *
 * The cache holds the in-flight PROMISE, not the resolved value, and it is
 * stored before the first `await`. That is what makes two expands of the same
 * panel in the same tick share one request rather than race two, and what makes
 * a second expand after a success return the cached entries with no network at
 * all.
 *
 * A rejection is evicted. A reader who opens a panel, meets the failure
 * sentence, and opens it again is asking to try again; caching the failure
 * would answer them with a result from a network condition that is over.
 * Nothing is written outside this object, so it dies with the tab.
 */
export function createDeferredDetailLoader({
  fetchImpl,
  timeoutMs = DEFERRED_DETAIL_TIMEOUT_MS,
  timers = { setTimeout, clearTimeout },
} = {}) {
  const cache = new Map();
  let requests = 0;
  return {
    /** Requests issued, so a test can prove the second expand did not refetch. */
    get requestCount() { return requests; },
    load(panel) {
      const cached = cache.get(panel.source);
      if (cached) return cached;
      requests += 1;
      const pending = withTimeout(Promise.resolve()
        .then(() => fetchImpl(panel.source))
        .then((response) => {
          if (!response?.ok) throw new Error(`deferred detail request failed for ${panel.source}`);
          return response.json();
        })
        .then(validEntries), timeoutMs, timers)
        .catch((error) => {
          cache.delete(panel.source);
          throw error;
        });
      cache.set(panel.source, pending);
      return pending;
    },
  };
}

function fallbackNode(body) {
  return body?.querySelector?.(`[data-role="deferred-fallback"]`) ?? null;
}

/**
 * Paint the loaded entries as a definition list, replacing the fallback prose.
 *
 * The fallback element is kept in the DOM and hidden rather than removed, so a
 * later failure can restore the exact sentence the document was authored with
 * instead of a copy this module would have to keep in step with it.
 */
export function renderDeferredEntries(document, body, entries) {
  const list = document.createElement("dl");
  list.className = "deferred-detail-list";
  for (const entry of entries) {
    const group = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = entry.term;
    const detail = document.createElement("dd");
    detail.textContent = entry.detail;
    group.append(term);
    group.append(detail);
    list.append(group);
  }
  const existing = body.querySelector(`[data-role="deferred-list"]`);
  if (existing) existing.remove();
  list.setAttribute("data-role", "deferred-list");
  body.append(list);
  const fallback = fallbackNode(body);
  if (fallback) fallback.hidden = true;
  body.dataset.deferredState = DEFERRED_STATE.loaded;
}

/**
 * Put the panel back to readable prose and say, in one sentence, what is
 * missing and where to read it.
 *
 * The link is to the static file itself, because it exists as one: a reader who
 * cannot be given the rendered evidence is owed the source rather than an
 * apology. `role="status"` is deliberately absent — this region is inside a
 * disclosure the reader just opened, so they are already looking at it, and a
 * live announcement here would talk over the panel they opened.
 */
export function renderDeferredFailure(document, body, panel) {
  const list = body.querySelector(`[data-role="deferred-list"]`);
  if (list) list.remove();
  const fallback = fallbackNode(body);
  if (fallback) fallback.hidden = false;
  let message = body.querySelector(`[data-role="deferred-error"]`);
  if (!message) {
    message = document.createElement("p");
    message.className = "deferred-detail-error";
    message.setAttribute("data-role", "deferred-error");
    body.append(message);
  }
  message.hidden = false;
  message.textContent = `${panel.name} could not be loaded. Read it directly: `;
  const link = document.createElement("a");
  link.setAttribute("href", panel.source);
  link.textContent = panel.source;
  message.append(link);
  body.dataset.deferredState = DEFERRED_STATE.unavailable;
}

function isOpen(details) {
  return Boolean(details?.hasAttribute?.("open") || details?.open);
}

/**
 * Bind every deferred panel in this document.
 *
 * Binding is on the `details`' own `toggle`, which is the element's native
 * state change: no key handler to get wrong, no `aria-expanded` to keep in
 * step, and the control stays operable whether or not the fetch ever succeeds.
 * A panel whose markup is not in this document is skipped rather than throwing
 * — this is called from the page entry, where anything that throws takes the
 * rest of the boot with it.
 *
 * Returns a teardown, and the loader, so a test can drive one panel directly.
 */
export function installDeferredDetails(document, {
  fetchImpl = typeof fetch === "function" ? fetch : null,
  timeoutMs = DEFERRED_DETAIL_TIMEOUT_MS,
  panels = DEFERRED_PANELS,
  timers = { setTimeout, clearTimeout },
} = {}) {
  const loader = createDeferredDetailLoader({ fetchImpl, timeoutMs, timers });
  const bound = [];
  const settled = [];
  if (!document || !fetchImpl) return { loader, teardown() {}, settled };

  for (const panel of panels) {
    const details = document.getElementById(panel.detailsId);
    const body = document.getElementById(panel.bodyId);
    if (!details || !body) continue;
    const open = () => {
      if (!isOpen(details) || body.dataset.deferredState === DEFERRED_STATE.loaded) return;
      body.dataset.deferredState = DEFERRED_STATE.loading;
      const done = loader.load(panel).then(
        (entries) => renderDeferredEntries(document, body, entries),
        () => renderDeferredFailure(document, body, panel),
      );
      settled.push(done);
    };
    details.addEventListener("toggle", open);
    bound.push(() => details.removeEventListener?.("toggle", open));
    // A fragment deep-linked into an already-open panel: the toggle has already
    // happened by the time this runs, so the first read is taken here.
    if (isOpen(details)) open();
  }

  return {
    loader,
    settled,
    teardown() { for (const off of bound) off(); },
  };
}
