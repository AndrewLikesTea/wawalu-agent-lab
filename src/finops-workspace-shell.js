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
// names for one page. `WORKSPACE_DESTINATION` is imported, not copied.
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
  DEFAULT_DESTINATION, DESTINATION_ORDER, DESTINATION_URL, WORKSPACE_DESTINATION,
  WORKSPACE_NAV_IDS, announceDestination as announceOnRail, destinationForUrl,
  setCurrentDestination,
} from "./finops-workspace-nav.js";
// The three heavy per-destination datasets, reached only through the memo below.
import { loadExampleDataset } from "./example-dataset.js";
import { buildFinopsBriefing } from "./finops-briefing-contract.js";
import { leadingFinding } from "./finops-leading-finding.js";
import { loadWorkspaceDestinations } from "./finops-destination-contract.js";

/**
 * The ids the shipped markup carries, in one place so a test can name them.
 *
 * The shell owns no control of its own any more. `#finops-workspace-switch` and
 * its live region are gone: the page had two lists of the same four names, one
 * of which said "Current" and the other "Showing", and a reader had no way to
 * know which one meant what was on screen. The rail is the single control, so
 * these ids point at the rail's markup and the shell paints through it.
 */
export const WORKSPACE_SHELL_IDS = Object.freeze({
  nav: WORKSPACE_NAV_IDS.nav,
  navList: WORKSPACE_NAV_IDS.list,
  live: WORKSPACE_NAV_IDS.live,
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
export const DESTINATION_FRAGMENT = DESTINATION_URL;

/**
 * The mid-page anchors this page shipped before it had addresses, and the
 * destination each one now opens.
 *
 * Enumerated rather than derived, because that is the promise being kept: a
 * link a FinOps lead pasted into a ticket last month has to open something, and
 * a table a test can read is the only way to know none of them was missed. It
 * is a floor, not the whole rule — `destinationForFragment` resolves any other
 * in-page anchor through the region that contains it, and anything left over
 * falls back to the answer.
 */
export const LEGACY_ANCHOR = Object.freeze({
  "#finops-first-run": WORKSPACE_DESTINATION.answer,
  "#finops-destinations": WORKSPACE_DESTINATION.answer,
  "#finops-stand": WORKSPACE_DESTINATION.answer,
  "#local-import": WORKSPACE_DESTINATION.answer,
  "#guided-result": WORKSPACE_DESTINATION.answer,
  "#finops-workspace-nav": WORKSPACE_DESTINATION.answer,
  "#score-card": WORKSPACE_DESTINATION.evidence,
  "#finops-headline": WORKSPACE_DESTINATION.evidence,
  "#recommendation-evidence": WORKSPACE_DESTINATION.evidence,
  "#graded-sample": WORKSPACE_DESTINATION.evidence,
  "#spend-per-delivery": WORKSPACE_DESTINATION.evidence,
  "#finops-privacy": WORKSPACE_DESTINATION.evidence,
  "#department-decision-panel": WORKSPACE_DESTINATION.department,
  "#department-evidence": WORKSPACE_DESTINATION.department,
  "#department-fix-pack": WORKSPACE_DESTINATION.department,
  "#spend-mix-panel": WORKSPACE_DESTINATION.department,
  "#savings-portfolio-panel": WORKSPACE_DESTINATION.actAndVerify,
  "#prompt-coaching": WORKSPACE_DESTINATION.actAndVerify,
  "#finops-contact": WORKSPACE_DESTINATION.actAndVerify,
});

/** The five figures carried into every destination but the answer. */
export const CONTEXT_TERMS = Object.freeze([
  "Benchmark", "Impact", "Confidence", "Why this matters", "Provenance",
]);

const DESTINATION_KEYS = DESTINATION_ORDER;

const byId = (doc, id) => doc?.getElementById?.(id) ?? null;
const isDestination = (key) => DESTINATION_KEYS.includes(key);
const usd = (value) => (typeof value === "number" && Number.isFinite(value)
  ? `${Math.round(value).toLocaleString("en-US")} USD`
  : "unavailable");

// ---------------------------------------------------------------------------
// The per-destination datasets, computed on first open.
// ---------------------------------------------------------------------------
//
// Each destination's dataset is a computation over the bundled fixture that only
// that destination has any use for: the evidence panels read the briefing, the
// department drill-down reads the leading finding, and the act-and-verify loop
// reads the workspace-destination record. Composing all three on boot meant a
// reader who never left the answer paid for all three.
//
// THE CACHE IS A MAP AND NOTHING ELSE. Keyed by destination key, scoped to this
// module, and filled once per key for the life of the page. No invalidation, no
// window global, no reactive wrapper, and no eviction: every loader below is a
// pure read of a fixture generated in this process, so a second computation
// could only ever produce an equal value, and a repeated open therefore returns
// the same object identity. A loader that throws caches `null` rather than
// throwing on every open — the destination still opens; it just has no dataset.

/** The shared fixture read. Not a destination's dataset — it is every one's input. */
let bundledAnalysisMemo;

function bundledAnalysis() {
  if (bundledAnalysisMemo === undefined) {
    try {
      bundledAnalysisMemo = loadExampleDataset();
    } catch {
      bundledAnalysisMemo = null;
    }
  }
  return bundledAnalysisMemo;
}

/**
 * One loader per destination, and each one independent: nothing here reads
 * another destination's entry, so opening evidence computes the briefing and
 * neither of the other two. The answer has no entry on purpose — it is the
 * default destination, and the figure it prints is precomputed in
 * src/finops-answer-summary.js rather than composed on open.
 */
const DESTINATION_DATASET_SOURCE = Object.freeze({
  [WORKSPACE_DESTINATION.evidence]: () => buildFinopsBriefing(bundledAnalysis()),
  [WORKSPACE_DESTINATION.department]: () => leadingFinding(bundledAnalysis()),
  [WORKSPACE_DESTINATION.actAndVerify]: () => loadWorkspaceDestinations(),
});

const DESTINATION_DATASETS = new Map();

/**
 * One destination's dataset, computed on the first call and read from the memo
 * on every call after it. Null for a key with no dataset and for a loader that
 * threw; never throws.
 */
export function destinationDataset(key) {
  if (DESTINATION_DATASETS.has(key)) return DESTINATION_DATASETS.get(key);
  const load = DESTINATION_DATASET_SOURCE[key];
  if (!load) return null;
  let dataset = null;
  try {
    dataset = load();
  } catch {
    dataset = null;
  }
  DESTINATION_DATASETS.set(key, dataset);
  return dataset;
}

/**
 * Which destinations have computed their dataset, in first-open order.
 *
 * The memo is observable rather than inferred: a test asserts that opening one
 * destination left the other two uncomputed, and a support conversation can ask
 * the same question of a live page without guessing from a timing profile.
 */
export function computedDestinationDatasets() {
  return [...DESTINATION_DATASETS.keys()];
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
  const owned = destinationForUrl(raw);
  if (owned) return owned;
  const legacy = LEGACY_ANCHOR[raw];
  if (legacy) return legacy;

  const target = byId(doc, raw.slice(1));
  if (!target) return null;
  const region = target.closest?.("[data-workspace-region]") ?? null;
  const key = region?.dataset?.workspaceRegion ?? null;
  if (isDestination(key)) return key;
  return target.closest?.("[data-workspace-frame]") ? DEFAULT_DESTINATION : null;
}

/** Whether a fragment is one of the four addresses this shell owns. */
export function ownsFragment(hash) {
  return destinationForUrl(hash) !== null;
}

/**
 * The destination an address names, always. Never null and never a throw.
 *
 * THE URL IS THE STATE, so an address that resolves to nothing has to resolve
 * to *something*: an unknown fragment, a malformed one, and a bare URL with no
 * fragment at all are all the answer. This is the rule the page ships with,
 * replacing the older one where an unresolvable fragment left whatever was on
 * screen in place — that was defensible while a second control owned the
 * switching, but with one control the address bar and the screen have to agree,
 * and "the reader is somewhere the URL does not describe" is the state a
 * forwarded link must never open in. The fallback renders; it never redirects,
 * so there is no loop to get into.
 */
export function destinationForAddress(doc, hash) {
  return destinationForFragment(doc, hash) ?? DEFAULT_DESTINATION;
}

/** The destination now on screen, read back off the markup rather than a variable. */
export function currentWorkspaceDestination(doc) {
  const marked = navDoors(doc).find((door) => door.getAttribute("aria-current") === "true");
  return marked?.dataset?.destinationKey ?? null;
}

const navDoors = (doc) =>
  [...(byId(doc, WORKSPACE_SHELL_IDS.navList)?.querySelectorAll?.("[data-destination-key]") ?? [])];

const doorFor = (doc, key) =>
  navDoors(doc).find((door) => door.dataset.destinationKey === key) ?? null;

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
export function applyWorkspaceDestination(doc, key, { announce = false } = {}) {
  if (!isDestination(key)) return null;
  const regions = workspaceRegions(doc);
  if (regions.length === 0) return null;
  const previous = currentWorkspaceDestination(doc);

  for (const region of regions) {
    region.dataset.workspaceActive = region.dataset.workspaceRegion === key ? "true" : "false";
  }

  // The one control is the rail, and the rail already knows how to say where the
  // reader is — `aria-current`, the word "Current", and the thickened left rule.
  // The shell asks it rather than painting a second state of its own.
  setCurrentDestination(doc, key, { announce: false });

  // The carried figures are a restatement, so they retire the moment the region
  // they restate is on screen.
  const context = byId(doc, WORKSPACE_SHELL_IDS.context);
  if (context) context.hidden = key === DEFAULT_DESTINATION;

  // FIRST OPEN COMPUTES, every open after it reads the memo. It is deliberately
  // after the regions are marked and the doors repainted: the destination is on
  // screen whether or not its dataset resolves, and this call cannot throw.
  destinationDataset(key);

  // One live region, and the rail owns it. A destination reached with the
  // keyboard is announced by the door that was pressed; this path is for the
  // ones no control was pressed for — back, forward, and an edited address —
  // where nothing else would say the page had changed underneath the reader.
  const door = doorFor(doc, key);
  if (announce && door && previous !== key) announceOnRail(doc, door, 0);
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
export function initWorkspaceShell(doc, { win = null, loaded = null } = {}) {
  if (workspaceRegions(doc).length === 0) return null;
  // Seed rather than recompute: the entry already loaded this record for the
  // rail, so the first open of act-and-verify must not read the fixture twice.
  if (loaded && !DESTINATION_DATASETS.has(WORKSPACE_DESTINATION.actAndVerify)) {
    DESTINATION_DATASETS.set(WORKSPACE_DESTINATION.actAndVerify, loaded);
  }
  paintWorkspaceContext(doc, loaded);

  // The browser's own scroll restoration works on one long document; this page
  // is four, and it would put the reader at last week's offset in a destination
  // that is no longer on screen. The shell restores from its own history state.
  if (win?.history && "scrollRestoration" in win.history) win.history.scrollRestoration = "manual";

  const scrollOf = () => (typeof win?.scrollY === "number" ? win.scrollY : 0);
  const stateFor = (key, scrollY) => ({ workspaceDestination: key, scrollY });

  /**
   * Stamp how far down the destination being left was read.
   *
   * `replaceState` on the *outgoing* entry, before the new one is pushed: that
   * is the only moment the offset and the entry that owns it are both current,
   * and it is what makes back return a reader to the paragraph they were on
   * rather than to the top of a screen they have already read.
   */
  const stampDeparture = () => {
    const key = currentWorkspaceDestination(doc) ?? DEFAULT_DESTINATION;
    win?.history?.replaceState?.(stateFor(key, scrollOf()), "");
  };

  const select = (hash, { announce }) =>
    applyWorkspaceDestination(doc, destinationForAddress(doc, hash), { announce });

  const onClick = (event) => {
    const link = event.target?.closest?.("a");
    const href = link?.getAttribute?.("href");
    if (!href || !href.startsWith("#")) return;
    const key = destinationForAddress(doc, href);

    // A door onto a destination is routed here so the entry carries state; every
    // other in-page link keeps the browser's own behaviour, and so does a
    // middle-click, a modified click, and a click something else already
    // handled — those are a reader asking for a new tab or a new window, and a
    // router that swallowed them would be taking the page hostage.
    const routable = ownsFragment(href) && win?.history?.pushState && !event.defaultPrevented
      && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
      && (event.button === undefined || event.button === 0);
    if (routable) {
      event.preventDefault();
      stampDeparture();
      // `pushState` is what moves the address bar; the fragment reaches
      // `location.hash` through it, which is why nothing here assigns the hash
      // and pushes a second entry for one press.
      win.history.pushState(stateFor(key, 0), "", href);
      win.scrollTo?.(0, 0);
    }
    // Announced by the rail, which says the same thing with more in it: the
    // destination, where the keyboard landed, and what it had to unfold to put
    // it there. Two live regions describing one press is how a screen-reader
    // user learns to ignore both.
    applyWorkspaceDestination(doc, key, { announce: false });
  };

  // Back and forward. The destination comes from the address — the URL is the
  // state — and the offset comes from the entry's own state, so a step back
  // lands where the reader left off. Focus is deliberately not moved: a reader
  // who pressed back asked for the previous page, not for the keyboard to jump.
  const onPopState = (event) => {
    const key = select(win?.location?.hash ?? "", { announce: true });
    const restored = Number((event?.state ?? win?.history?.state ?? null)?.scrollY);
    if (Number.isFinite(restored)) win?.scrollTo?.(0, restored);
    return key;
  };

  const onHashChange = () => select(win?.location?.hash ?? "", { announce: true });

  doc.addEventListener?.("click", onClick, true);
  win?.addEventListener?.("hashchange", onHashChange);
  win?.addEventListener?.("popstate", onPopState);

  // The cold open. A destination address opens that destination; one of today's
  // mid-page anchors opens the destination it now lives in, with the anchor left
  // in the address bar so the page's deep-link handler can still unfold and
  // reveal the panel it names; anything else opens the answer. No focus is
  // moved and nothing is announced — the reader asked for this page, and a page
  // that announces itself on load is one that talks over its own heading.
  const hash = win?.location?.hash ?? "";
  const opened = select(hash, { announce: false });
  win?.history?.replaceState?.(stateFor(opened, scrollOf()), "");

  return {
    destination: opened,
    dispose() {
      doc.removeEventListener?.("click", onClick, true);
      win?.removeEventListener?.("hashchange", onHashChange);
      win?.removeEventListener?.("popstate", onPopState);
    },
  };
}
