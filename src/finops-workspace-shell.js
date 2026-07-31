// The workspace shell: one destination on screen at a time, and the answer first.
//
// WHAT THIS FIXES. `finops-workspace-nav.js` named the parts of this page and
// marked which one the reader was standing in, and it said in as many words that
// it would not hide anything. That was the right call for a rail on its own — a
// wayfinding list that also removes content is a rail nobody can trust — but it
// left the underlying defect where it was: this document is fifteen hundred lines
// of markup, every panel of it rendered at once, and "focused" was a claim made
// entirely by a heading. A FinOps lead who came to check the evidence behind one
// figure still had to scroll past a department drill-down, a spend mix, a savings
// portfolio, and a coaching hand-off to reach it, and had no way to say which of
// those four things they were doing.
//
// So this module does the part the rail declined: it makes the page a workspace.
// Exactly one destination is on screen, the answer is the default, and every
// panel that used to be in the monolith belongs to exactly one destination.
//
// THE FOUR DESTINATIONS ARE THE RAIL'S FOUR, deliberately reused rather than
// re-declared. A shell with its own vocabulary would give a reader two sets of
// names for one page. `WORKSPACE_DESTINATION` is imported, not copied, and the
// order and the fragments below are derived from `SCREEN_CONTRACT` — the
// executable form of docs/executive-answer-screen-contract.md — rather than
// re-typed.
//
// AND SINCE #819 THE CONTROL IS THE RAIL'S, TOO. This module used to author a
// second list of the same four destinations — the "Working area" switcher — with
// its own doors, its own current mark, its own state word and its own live
// region. Two controls for one set of screens is two tab stops per screen, two
// entries per screen in a screen reader's link list, and two marks that can
// disagree about where the reader is. The switcher is deleted. This module now
// renders destinations and marks the rail; the rail is the only way between
// them.
//
// WHAT DOES NOT MOVE. The hero, the one complete decision brief, the load status,
// the rail, and this shell's own controls are the workspace *frame*: they carry
// the page heading, the answer, and the way between destinations, so hiding them
// would be hiding the thing the destinations exist to act on. Marked in the
// markup as `data-workspace-frame`, so a test can assert the split rather than
// infer it.
//
// AND THE FIGURES A LEADER MUST NOT LOSE. Impact, confidence, provenance, the
// benchmark, and why it matters are the five things every destination is being
// judged against. They are authored once, in the brief, so the shell carries a
// compact restatement of them — from the same bundled destination record the rail
// and the ranked door read — in every destination except the answer, where the
// brief itself is on screen and a second copy would be a second summary.
//
// HISTORY, WITHOUT A SERVER ROUTE. Each destination owns one fragment. The
// controls are ordinary anchors pointing at those fragments, so activation is
// what a browser already does: the address bar ends up holding a link the reader
// can copy, the entry lands in session history, and back and forward walk it. The
// shell adds only the derivation — hash in, destination out — and listens for
// `hashchange` and `popstate` so a step back repaints rather than stranding the
// reader on content the URL no longer describes. Nothing is intercepted, nothing
// is pushed behind the browser's back, and no route is claimed on the origin.
//
// UNKNOWN FRAGMENTS CHANGE NOTHING. A fragment this page does not own and cannot
// resolve to a panel leaves the selected destination exactly as it was. A shared
// link with a stale or invented hash is a link to this page, not an instruction
// to empty it.

import {
  DEFAULT_DESTINATION, WORKSPACE_DESTINATION, currentDestination, setCurrentDestination,
} from "./finops-workspace-nav.js";
import { SCREEN_CONTRACT } from "./finops-screen-contract.js";
import { DESTINATION_LOAD_STATE, createDestinationLoader } from "./finops-destination-loader.js";
// The page's one status vocabulary. Reused, never extended: a destination that
// is still fetching its module is a panel in a state this module already draws.
import { PANEL_STATUS, applyPanelStatus } from "./panel-status-view.js";

/** The ids the shipped markup carries, in one place so a test can name them. */
export const WORKSPACE_SHELL_IDS = Object.freeze({
  context: "finops-workspace-context",
  contextList: "finops-workspace-context-list",
});

/**
 * The fragment each destination owns.
 *
 * Named for the destination rather than for a panel inside it: a panel can be
 * renamed, merged, or moved to another destination, and a link a reader saved to
 * "the evidence" should survive all three. These four are the only fragments this
 * shell answers to; every other in-page fragment is resolved by looking up what
 * region actually contains it, so the page's existing deep links keep working.
 */
export const DESTINATION_FRAGMENT = Object.freeze(Object.fromEntries(
  SCREEN_CONTRACT.map((screen) => [screen.shellDestination, `#workspace-${screen.key}`]),
));

/** The five figures carried into every destination but the answer. */
export const CONTEXT_TERMS = Object.freeze([
  "Benchmark", "Impact", "Confidence", "Why this matters", "Provenance",
]);

/** The four keys in the contract's reading order, and the only four. */
export const DESTINATION_KEYS = Object.freeze(
  SCREEN_CONTRACT.map((screen) => screen.shellDestination));

/** A destination's visible name, from the contract the rail's doors are built from. */
const screenName = (key) =>
  SCREEN_CONTRACT.find((screen) => screen.shellDestination === key)?.name ?? key;

const byId = (doc, id) => doc?.getElementById?.(id) ?? null;
const isDestination = (key) => DESTINATION_KEYS.includes(key);
const usd = (value) => (typeof value === "number" && Number.isFinite(value)
  ? `${Math.round(value).toLocaleString("en-US")} USD`
  : "unavailable");

// ---------------------------------------------------------------------------
// The per-destination modules, fetched on first open.
// ---------------------------------------------------------------------------
//
// Each destination's dataset is a computation over the bundled fixture that only
// that destination has any use for: the evidence panels read the briefing, the
// department drill-down reads the leading finding, and the act-and-verify loop
// reads the workspace-destination record. Composing all three on boot meant a
// reader who never left the answer paid for all three.
//
// THE OPEN WAS ALREADY LAZY; THE PAYLOAD WAS NOT. These three were static
// imports of this module until #821, so a browser fetched, parsed and evaluated
// all three before the answer block could paint, no matter which destination the
// reader wanted. They are `import()` calls now — the native form, which the
// served origin already supports and `scripts/check-size-budget.mjs` already
// declines to count, so nothing here needs a bundler plugin, a build step, or a
// dependency. The cache, the in-flight state and the retry-after-failure rule
// all live in src/finops-destination-loader.js; this file only says which module
// each destination needs and paints what the loader is doing.
//
// The answer has no source on purpose. It is the default destination and the
// figure it prints is precomputed in src/finops-answer-summary.js, so the answer
// screen renders with none of the three below ever fetched.

/**
 * One dynamic import per destination, each one independent: nothing here reads
 * another destination's module, so opening evidence fetches the briefing
 * contract and neither of the other two.
 *
 * The specifiers are literals rather than a computed string so a reader — and
 * any tool that walks this file — can see exactly which three modules left the
 * initial payload and what brings each one back.
 */
export const DESTINATION_MODULE_SOURCE = Object.freeze({
  [WORKSPACE_DESTINATION.evidence]: async () => {
    const [{ buildFinopsBriefing }, { loadExampleDataset }] = await Promise.all([
      import("./finops-briefing-contract.js"),
      import("./example-dataset.js"),
    ]);
    return buildFinopsBriefing(loadExampleDataset());
  },
  [WORKSPACE_DESTINATION.department]: async () => {
    const [{ leadingFinding }, { loadExampleDataset }] = await Promise.all([
      import("./finops-leading-finding.js"),
      import("./example-dataset.js"),
    ]);
    return leadingFinding(loadExampleDataset());
  },
  [WORKSPACE_DESTINATION.actAndVerify]: async () => {
    const { loadWorkspaceDestinations } = await import("./finops-destination-contract.js");
    return loadWorkspaceDestinations();
  },
});

/** The page's loader. A test passes its own through `loader` instead. */
export const destinationLoader = createDestinationLoader(DESTINATION_MODULE_SOURCE);

/**
 * The promise for the open now in flight for one destination, so a caller that
 * did not start it — a test, or the retry control's own handler — can wait for
 * the paint rather than for the fetch and then guess at the ordering.
 */
const OPENING = new Map();

export function destinationOpening(key) {
  return OPENING.get(key) ?? null;
}

/**
 * One destination's dataset once it has loaded, and null before that.
 *
 * A memo read, never a fetch: nothing on the synchronous paint path may start a
 * network request as a side effect of being asked a question.
 */
export function destinationDataset(key, loader = destinationLoader) {
  return loader.value(key);
}

/**
 * Which destinations have loaded their dataset, in first-ready order.
 *
 * The memo is observable rather than inferred: a test asserts that opening one
 * destination left the other two unfetched, and a support conversation can ask
 * the same question of a live page without guessing from a timing profile.
 */
export function computedDestinationDatasets(loader = destinationLoader) {
  return loader.readyKeys();
}

// ---------------------------------------------------------------------------
// What the reader sees while it loads, and when it does not.
// ---------------------------------------------------------------------------

/** The element ids the shipped markup carries for one destination's status. */
export const destinationStatusId = (key) => `destination-load-${key}`;
export const destinationRetryId = (key) => `destination-retry-${key}`;

/**
 * The copy, in the page's existing vocabulary and naming the destination.
 *
 * "Could not load Evidence" and not "Could not compute": the reader pressed a
 * door, and the thing that failed is the one they can name and retry.
 */
export const DESTINATION_LOAD_COPY = Object.freeze({
  loading: (name) => `Opening ${name}. The answer above is already on screen.`,
  error: (name) => `Could not load ${name}. Nothing on the answer above changed,`
    + " and nothing of yours was uploaded or stored.",
  retryAction: (name) => `Press “Retry ${name}” to try again.`,
});

/**
 * Paint one destination's load state into its own status region.
 *
 * Never an empty pane: the region is on screen for the whole of `loading` and
 * `error`, and only retires once the module is in hand. The retry control is
 * authored in the markup and toggled here — the same shape `#finops-data-retry`
 * already has for the bundled fixture, so a reader meets one retry idiom.
 *
 * `announce: false` on the loading line is deliberate. `#finops-load-state` is
 * this page's one narrating region; a second polite region describing a second
 * fetch is how a screen-reader user learns to ignore both. The failure keeps its
 * `role="alert"`, because it is the one state that needs an answer.
 */
export function paintDestinationLoadState(doc, key, state) {
  const panelId = destinationStatusId(key);
  const panel = byId(doc, panelId);
  if (!panel) return null;
  const name = screenName(key);
  const retry = byId(doc, destinationRetryId(key));

  if (state !== DESTINATION_LOAD_STATE.loading && state !== DESTINATION_LOAD_STATE.error) {
    panel.hidden = true;
    if (retry) retry.hidden = true;
    return panel;
  }

  panel.hidden = false;
  const failed = state === DESTINATION_LOAD_STATE.error;
  if (retry) retry.hidden = !failed;
  applyPanelStatus(doc, {
    panelId,
    status: failed ? PANEL_STATUS.error : PANEL_STATUS.loading,
    summary: failed ? DESTINATION_LOAD_COPY.error(name) : DESTINATION_LOAD_COPY.loading(name),
    action: failed ? { label: "Needed next", text: DESTINATION_LOAD_COPY.retryAction(name) } : null,
    announce: failed,
  });
  return panel;
}

/**
 * Open one destination's module: paint the wait, fetch it, paint the outcome.
 *
 * Resolves to the state it painted and never rejects, so the synchronous paint
 * path can start it and walk away. A destination with no module — the answer —
 * resolves immediately and paints nothing.
 */
export function openDestination(doc, key, { loader = destinationLoader } = {}) {
  if (!DESTINATION_MODULE_SOURCE[key]) return Promise.resolve(DESTINATION_LOAD_STATE.idle);
  if (loader.stateOf(key) !== DESTINATION_LOAD_STATE.ready) {
    paintDestinationLoadState(doc, key, DESTINATION_LOAD_STATE.loading);
  }
  const opening = loader.load(key).then((outcome) => {
    const state = outcome.status === DESTINATION_LOAD_STATE.error
      ? DESTINATION_LOAD_STATE.error : DESTINATION_LOAD_STATE.ready;
    paintDestinationLoadState(doc, key, state);
    return state;
  });
  OPENING.set(key, opening);
  return opening;
}

/** Every region the shell may show or hide, in document order. */
export function workspaceRegions(doc) {
  return [...(doc?.querySelectorAll?.("[data-workspace-region]") ?? [])];
}

/** The regions belonging to one destination. */
export function regionsFor(doc, key) {
  return workspaceRegions(doc).filter((region) => region.dataset.workspaceRegion === key);
}

/**
 * The destination a fragment selects, or null when it selects none.
 *
 * Three cases, in order:
 *   1. A fragment this shell owns names its destination outright.
 *   2. Any other fragment is resolved through the element it points at: whatever
 *      region contains that element is the destination. This is what keeps the
 *      rail's doors, the page's own cross-panel links, and every link a reader
 *      saved before this module existed pointing somewhere real.
 *   3. A fragment inside the frame — the hero, the brief, the status strip —
 *      selects the default, because the frame belongs to the answer.
 *
 * Anything else returns null, which callers read as "leave the selection alone".
 */
export function destinationForFragment(doc, hash) {
  const raw = String(hash ?? "");
  if (!raw.startsWith("#") || raw.length < 2) return null;
  const owned = Object.keys(DESTINATION_FRAGMENT)
    .find((key) => DESTINATION_FRAGMENT[key] === raw);
  if (owned) return owned;

  const target = byId(doc, raw.slice(1));
  if (!target) return null;
  const region = target.closest?.("[data-workspace-region]") ?? null;
  const key = region?.dataset?.workspaceRegion ?? null;
  if (isDestination(key)) return key;
  return target.closest?.("[data-workspace-frame]") ? DEFAULT_DESTINATION : null;
}

/** Whether a fragment is one of the four this shell owns. */
export function ownsFragment(hash) {
  return Object.values(DESTINATION_FRAGMENT).includes(String(hash ?? ""));
}

/**
 * The destination now on screen, read back off the rail rather than a variable.
 *
 * One marked control, one answer. Before #819 this read a second control's own
 * mark, which is exactly the state two controls can disagree about.
 */
export function currentWorkspaceDestination(doc) {
  return currentDestination(doc);
}

/**
 * Show one destination and hide the other three.
 *
 * Hiding is a data attribute the stylesheet turns into `display:none`, not the
 * `hidden` property: several of these regions manage their own `hidden` — a panel
 * that has nothing to show yet is hidden by the module that owns it — and a shell
 * that wrote the same property would either be overwritten by the next import or
 * would overwrite a panel's own empty state. One attribute per concern keeps both
 * true at once, and the print rules read the shell's attribute so a printed page
 * is still the whole page.
 */
export function applyWorkspaceDestination(doc, key, { announce = false, loader = destinationLoader } = {}) {
  if (!isDestination(key)) return null;
  const regions = workspaceRegions(doc);
  if (regions.length === 0) return null;

  for (const region of regions) {
    region.dataset.workspaceActive = region.dataset.workspaceRegion === key ? "true" : "false";
  }

  // The one control is marked here rather than repainted here: `aria-current`,
  // the word "Current", and the thick left rule are all the rail's, in the
  // rail's vocabulary. This module says which door; it does not say it twice in
  // words of its own.
  setCurrentDestination(doc, key, { announce });

  // The carried figures are a restatement, so they retire the moment the region
  // they restate is on screen.
  const context = byId(doc, WORKSPACE_SHELL_IDS.context);
  if (context) context.hidden = key === DEFAULT_DESTINATION;

  // FIRST OPEN FETCHES, every open after it reads the memo. It is deliberately
  // after the regions are marked and the doors repainted: the destination is on
  // screen whether or not its module ever arrives. Started and walked away from
  // — the loader never rejects, and a destination whose module is still in
  // flight is a region showing the wait, not a paint this one has to block on.
  openDestination(doc, key, { loader });
  return key;
}

/**
 * The five figures, carried from the bundled destination record.
 *
 * Read from the record rather than scraped off the brief: the brief is painted
 * asynchronously by several modules, and a strip that copied its text would go
 * stale the first time one of them repainted. A record that failed its own
 * contract paints a labelled unavailable state — the shell will not carry a
 * figure it could not validate into three destinations.
 */
export function paintWorkspaceContext(doc, loaded = null) {
  const section = byId(doc, WORKSPACE_SHELL_IDS.context);
  const list = byId(doc, WORKSPACE_SHELL_IDS.contextList);
  if (!section || !list) return null;
  // The page entry hands its own loaded record in, because it already holds one
  // for the rail. A caller that does not gets the act-and-verify destination's
  // memo instead — the same load, one copy of it.
  const held = loaded ?? destinationDataset(WORKSPACE_DESTINATION.actAndVerify);
  const record = held?.valid ? held.record : null;
  list.replaceChildren();

  if (!record) {
    section.dataset.state = "unavailable";
    list.append(pair(doc, "Carried figures",
      "Unavailable — the bundled example record did not pass its own contract, so"
      + " nothing is carried. The answer above is unchanged."));
    return section;
  }

  const { benchmark, finding } = record;
  const share = typeof benchmark.comparisonShare === "number"
    ? `${(benchmark.comparisonShare * 100).toFixed(1)}%`
    : "unavailable";
  const confidence = finding.confidence;
  const limits = Array.isArray(confidence.limits) ? confidence.limits.length : 0;

  section.dataset.state = "ready";
  list.append(
    pair(doc, "Benchmark", `${benchmark.name} — ${share} of ${benchmark.baselineName}.`),
    pair(doc, "Impact", `${usd(benchmark.observedUsd)} modelled recoverable of`
      + ` ${usd(benchmark.baselineUsd)} analyzed, over ${benchmark.window.start.slice(0, 10)}`
      + ` to ${benchmark.window.end.slice(0, 10)} (end exclusive).`),
    pair(doc, "Confidence", `${confidence.band} · ${confidence.score} of ${confidence.scaleMax}`
      + (limits === 0 ? " · no stated limit."
        : ` · ${limits === 1 ? "1 stated limit" : `${limits} stated limits`}.`)),
    pair(doc, "Why this matters", finding.whyItMatters),
    pair(doc, "Provenance", finding.provenance.sourceLabel ?? finding.provenance.source),
  );
  return section;
}

function pair(doc, term, detail) {
  const group = doc.createElement("div");
  group.className = "workspace-context-pair";
  const dt = doc.createElement("dt");
  dt.textContent = term;
  const dd = doc.createElement("dd");
  dd.textContent = detail;
  group.append(dt, dd);
  return group;
}

/**
 * Bring the shell up and bind it.
 *
 * The click listener is registered in the capture phase so the destination is on
 * screen before anything else responds to the same click. The rail and the
 * deep-link handler both move focus into the fragment's target, and focus does
 * not land on a region that is still hidden — so the order is not a preference,
 * it is the difference between a door that works and one that silently does not.
 */
export function initWorkspaceShell(doc, { win = null, loaded = null, loader = destinationLoader } = {}) {
  if (workspaceRegions(doc).length === 0) return null;
  // Seed rather than re-fetch: the entry already loaded this record for the
  // rail, so the first open of act-and-verify must not read the fixture twice.
  if (loaded) loader.seed(WORKSPACE_DESTINATION.actAndVerify, loaded);
  paintWorkspaceContext(doc, loaded);

  const select = (hash, { announce }) => {
    const key = destinationForFragment(doc, hash);
    // Unknown fragment: the reader stays exactly where they were.
    if (!key) return null;
    return applyWorkspaceDestination(doc, key, { announce, loader });
  };

  // The retry, on the region that failed. It re-invokes the import rather than
  // reloading the page: the loader dropped the failed cache entry when it
  // failed, so the second attempt is a real second attempt.
  const onRetry = (event) => {
    const button = event.target?.closest?.("[data-destination-retry]");
    const key = button?.dataset?.destinationRetry;
    if (!key) return;
    openDestination(doc, key, { loader });
  };

  const onClick = (event) => {
    const link = event.target?.closest?.("a");
    const href = link?.getAttribute?.("href");
    if (!href || !href.startsWith("#")) return;
    // Announced only for the shell's own controls. A rail door and a deep link
    // both already say what they did, and two live regions describing one press
    // is how a screen-reader user learns to ignore both.
    select(href, { announce: ownsFragment(href) });
  };

  const onHashChange = () => select(win?.location?.hash ?? "", { announce: true });

  doc.addEventListener?.("click", onClick, true);
  doc.addEventListener?.("click", onRetry);
  win?.addEventListener?.("hashchange", onHashChange);
  win?.addEventListener?.("popstate", onHashChange);

  const opened = select(win?.location?.hash ?? "", { announce: false })
    ?? applyWorkspaceDestination(doc, DEFAULT_DESTINATION, { announce: false });

  return {
    destination: opened,
    dispose() {
      doc.removeEventListener?.("click", onClick, true);
      doc.removeEventListener?.("click", onRetry);
      win?.removeEventListener?.("hashchange", onHashChange);
      win?.removeEventListener?.("popstate", onHashChange);
    },
  };
}
