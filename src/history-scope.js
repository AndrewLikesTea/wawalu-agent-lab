// What the visitor is currently browsing, published from the history to the
// surfaces that act on it.
//
// THE DEFECT THIS CLOSES. The export button always wrote the whole stored
// history. A visitor who narrowed the history to two accepted decisions and
// pressed Download JSON received seven records, including the ones they had just
// filtered away — and nothing on the button said so. The file was a superset of
// what the visitor was looking at, which is the harder direction to notice: the
// extra records only turn up later, in whatever the file was handed to.
//
// So the history states its selection and the export follows it. Same shape as
// shiplog-records.js on purpose — a WeakMap keyed by the root each surface was
// mounted against, so a discarded document takes its listeners with it and two
// documents in one test run never hear each other. A DOM event would put a
// page-lifetime listener on a shared node for a fact that is not an interaction.
//
// The scope carries ids, not predicates: the history owns filtering (it composes
// examples, resolves supersedes, and reads the controls), and the export must not
// re-derive that rule from the store or the two would drift.

const subscribers = new WeakMap();
const scopes = new WeakMap();

/** An unfiltered scope: every stored record is in view. */
export const FULL_HISTORY_SCOPE = Object.freeze({
  filtered: false,
  decisionIds: Object.freeze([]),
  releaseIds: Object.freeze([]),
});

const idList = (value) => (Array.isArray(value) ? value.filter((id) => typeof id === "string" && id !== "") : []);

/**
 * Normalize a published scope.
 *
 * `filtered: false` keeps the id lists but marks them as "everything the store
 * holds", which is what lets a reader tell "the visitor hid five records" apart
 * from "the store only has two". A malformed scope degrades to the full history:
 * exporting more than the visitor expected is a defect, but exporting nothing
 * because a caller passed rubbish would lose their data.
 */
export function normalizeHistoryScope(scope) {
  if (!scope || typeof scope !== "object") return FULL_HISTORY_SCOPE;
  return Object.freeze({
    filtered: scope.filtered === true,
    decisionIds: Object.freeze(idList(scope.decisionIds)),
    releaseIds: Object.freeze(idList(scope.releaseIds)),
  });
}

/** Say what the visitor can currently see under `root`. */
export function publishHistoryScope(root, scope) {
  if (!root) return;
  scopes.set(root, normalizeHistoryScope(scope));
  for (const handler of [...(subscribers.get(root) ?? [])]) handler(scopes.get(root));
}

/**
 * The scope last published under `root`, or the full history when no surface has
 * published one — a page with no history on it exports everything, as before.
 */
export function readHistoryScope(root) {
  return (root && scopes.get(root)) || FULL_HISTORY_SCOPE;
}

/**
 * Run `handler(scope)` whenever the browsed scope changes.
 *
 * @returns an unsubscribe function.
 */
export function onHistoryScopeChanged(root, handler) {
  if (!root || typeof handler !== "function") return () => {};
  if (!subscribers.has(root)) subscribers.set(root, new Set());
  subscribers.get(root).add(handler);
  return () => { subscribers.get(root)?.delete(handler); };
}

/**
 * Keep only the records the scope lists, in the order they were given.
 *
 * An unfiltered scope returns the input untouched rather than intersecting it,
 * so a record the history never listed (an example it composes in, a record
 * written after the last render) can never be dropped from an unfiltered export.
 */
export function withinHistoryScope(records, ids, { filtered = true } = {}) {
  if (!filtered) return records;
  const allowed = new Set(ids);
  return records.filter((record) => allowed.has(record?.id));
}
