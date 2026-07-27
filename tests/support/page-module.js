// Load a shipped page entry module the way the browser loads it.
//
// tests/support/browser.js parses the page's markup; this loads the script tag
// that brings it to life. A page entry (`src/evolution-page.js`) imports its
// dependencies by root-absolute specifier — `/local-finops.js` — because that is
// what the served origin resolves. Node resolves the same specifier against the
// filesystem root, so the module cannot simply be imported, and a flow test that
// re-implemented the page's wiring would be testing the test rather than the
// page.
//
// So the origin's mapping is taught to the resolver instead: `/x.js` means
// `src/x.js`, exactly as the deployed site serves it. Nothing about the module
// under test changes — the wiring is the shipped wiring, and a page entry whose
// imports stop resolving fails here, with its own file path in the stack.

import { registerHooks } from "node:module";

const SOURCE_ROOT = new URL("../../src/", import.meta.url);

// Root-absolute specifiers only. Everything else — bare, relative, node: — is
// left to the ordinary resolver, so this cannot quietly change how any other
// test's imports resolve.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("/")) return nextResolve(specifier, context);
    return { url: new URL(specifier.slice(1), SOURCE_ROOT).href, shortCircuit: true };
  },
});

let instance = 0;

/**
 * Import a page entry module by its served path (`/evolution-page.js`), with the
 * browser globals a caller has already installed through `loadPage`.
 *
 * Every call evaluates a fresh instance, because a page entry mounts itself on
 * import: without that, the second test in a file would drive the first test's
 * discarded document.
 */
export async function importPageModule(servedPath) {
  instance += 1;
  const url = new URL(String(servedPath).replace(/^\//, ""), SOURCE_ROOT);
  return import(`${url.href}?instance=${instance}`);
}

/**
 * Wait for a condition the page itself produces. Every wait in a flow test is on
 * observable state — never on elapsed time — so a slow machine cannot fail a
 * spec and a fast one cannot hide a missing step. Each turn drains the microtask
 * queue and one macrotask, so a pending `await` chain inside the page settles.
 */
export async function waitFor(condition, description, turns = 500) {
  for (let turn = 0; turn < turns; turn += 1) {
    const value = condition();
    if (value) return value;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`The page never reached this state: ${description}`);
}
