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

import { DEFAULT_DESTINATION, WORKSPACE_DESTINATION } from "./finops-workspace-nav.js";
// The three heavy per-destination datasets, reached only through the memo below.
import { loadExampleDataset } from "./example-dataset.js";
import { buildFinopsBriefing } from "./finops-briefing-contract.js";
import { leadingFinding } from "./finops-leading-finding.js";
import { loadWorkspaceDestinations } from "./finops-destination-contract.js";

/** The ids the shipped markup carries, in one place so a test can name them. */
export const WORKSPACE_SHELL_IDS = Object.freeze({
  switch: "finops-workspace-switch",
  switchList: "finops-workspace-switch-list",
  live: "finops-workspace-switch-live",
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
export const DESTINATION_FRAGMENT = Object.freeze({
  [WORKSPACE_DESTINATION.answer]: "#workspace-answer",
  [WORKSPACE_DESTINATION.evidence]: "#workspace-evidence",
  [WORKSPACE_DESTINATION.department]: "#workspace-departments",
  [WORKSPACE_DESTINATION.actAndVerify]: "#workspace-act-and-verify",
});

/** The visible word on the control for the destination now on screen. */
export const SHELL_STATE_LABEL = Object.freeze({ current: "Showing" });

/** The five figures carried into every destination but the answer. */
export const CONTEXT_TERMS = Object.freeze([
  "Benchmark", "Impact", "Confidence", "Why this matters", "Provenance",
]);

const DESTINATION_KEYS = Object.freeze(Object.values(WORKSPACE_DESTINATION));

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

/** The destination now on screen, read back off the markup rather than a variable. */
export function currentWorkspaceDestination(doc) {
  const marked = switchDoors(doc).find((door) => door.getAttribute("aria-current") === "true");
  return marked?.dataset?.shellDestination ?? null;
}

const switchDoors = (doc) =>
  [...(byId(doc, WORKSPACE_SHELL_IDS.switchList)?.querySelectorAll?.("[data-shell-destination]") ?? [])];

const doorName = (door) => String(door?.dataset?.shellName ?? "").trim()
  || String(door?.textContent ?? "").replace(/\s+/g, " ").trim();

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

  let shown = 0;
  for (const region of regions) {
    const active = region.dataset.workspaceRegion === key;
    region.dataset.workspaceActive = active ? "true" : "false";
    if (active) shown += 1;
  }

  const group = byId(doc, WORKSPACE_SHELL_IDS.switch);
  if (group) group.dataset.workspaceDestination = key;
  for (const door of switchDoors(doc)) {
    const current = door.dataset.shellDestination === key;
    if (current) door.setAttribute("aria-current", "true");
    else door.removeAttribute("aria-current");
    door.dataset.shellCurrent = current ? "true" : "false";
    // The state is a word, never a fill: this survives greyscale, print, and a
    // screen reader reading the link's name.
    const slot = door.querySelector?.('[data-role="state"]');
    if (slot) {
      slot.replaceChildren();
      slot.hidden = !current;
      if (current) slot.append(doc.createTextNode(SHELL_STATE_LABEL.current));
    }
  }

  // The carried figures are a restatement, so they retire the moment the region
  // they restate is on screen.
  const context = byId(doc, WORKSPACE_SHELL_IDS.context);
  if (context) context.hidden = key === DEFAULT_DESTINATION;

  // FIRST OPEN COMPUTES, every open after it reads the memo. It is deliberately
  // after the regions are marked and the doors repainted: the destination is on
  // screen whether or not its dataset resolves, and this call cannot throw.
  destinationDataset(key);

  if (announce) announceDestination(doc, key, shown);
  return key;
}

function announceDestination(doc, key, shown) {
  const live = byId(doc, WORKSPACE_SHELL_IDS.live);
  if (!live) return null;
  const door = switchDoors(doc).find((entry) => entry.dataset.shellDestination === key);
  const name = doorName(door) || key;
  live.textContent = `Showing ${name}. ${shown === 1 ? "1 panel" : `${shown} panels`}.`
    + (key === DEFAULT_DESTINATION ? "" : " The answer stays above it.");
  return live;
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

  const select = (hash, { announce }) => {
    const key = destinationForFragment(doc, hash);
    // Unknown fragment: the reader stays exactly where they were.
    if (!key) return null;
    return applyWorkspaceDestination(doc, key, { announce });
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
  win?.addEventListener?.("hashchange", onHashChange);
  win?.addEventListener?.("popstate", onHashChange);

  const opened = select(win?.location?.hash ?? "", { announce: false })
    ?? applyWorkspaceDestination(doc, DEFAULT_DESTINATION, { announce: false });

  return {
    destination: opened,
    dispose() {
      doc.removeEventListener?.("click", onClick, true);
      win?.removeEventListener?.("hashchange", onHashChange);
      win?.removeEventListener?.("popstate", onHashChange);
    },
  };
}
