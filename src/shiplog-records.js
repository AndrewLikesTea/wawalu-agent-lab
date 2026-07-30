// One notification, from the surface that writes records to the surfaces that
// count them.
//
// THE DEFECT THIS CLOSES. The export panel read the store once, at page load,
// and then never again. A visitor who recorded a decision was offered "Ready to
// export 0 decisions" beside a button that downloaded one — the button was right
// and the sentence beside it was wrong, which is the worse half to get wrong.
//
// Why not a DOM event: the panel and the recorder are separate module scripts on
// one page, so they need a channel, but a `CustomEvent` on `document` would put a
// page-lifetime listener on a shared node for a fact that is not an interaction.
// The subscription is keyed to the root each surface was mounted against
// instead — a `WeakMap`, so a discarded document takes its listeners with it and
// two surfaces mounted on two documents never hear each other's writes.

const subscribers = new WeakMap();

/**
 * Run `handler` whenever this root's stored records change.
 *
 * @returns an unsubscribe function.
 */
export function onRecordsChanged(root, handler) {
  if (!root || typeof handler !== "function") return () => {};
  if (!subscribers.has(root)) subscribers.set(root, new Set());
  subscribers.get(root).add(handler);
  return () => { subscribers.get(root)?.delete(handler); };
}

/**
 * Say that this root's stored records changed.
 *
 * Called after a write lands, never before: every subscriber re-reads the store,
 * so announcing an intention would advertise a count the file would not carry.
 */
export function recordsChanged(root) {
  for (const handler of [...(subscribers.get(root) ?? [])]) handler();
}
