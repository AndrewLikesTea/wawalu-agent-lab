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

// ONE CONTROL. This module used to author a second list of the same four
// destinations — the "working area" switcher — beside the rail that already
// named them. Two controls, two vocabularies, two live regions for one press,
// and two different answers for act-and-verify. #819 retired the switcher: the
// rail in `finops-workspace-nav.js` is now the only control, this module shows
// and hides behind it, and marking and announcing the current destination is
// delegated to the rail rather than duplicated here.

import {
  DEFAULT_DESTINATION, WORKSPACE_DESTINATION, currentDestination, setCurrentDestination,
} from "./finops-workspace-nav.js";

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
export const DESTINATION_FRAGMENT = Object.freeze({
  [WORKSPACE_DESTINATION.answer]: "#workspace-answer",
  [WORKSPACE_DESTINATION.evidence]: "#workspace-evidence",
  [WORKSPACE_DESTINATION.department]: "#workspace-departments",
  [WORKSPACE_DESTINATION.actAndVerify]: "#workspace-act-and-verify",
});

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

  const target = fragmentTarget(doc, raw.slice(1));
  if (!target) return null;
  const region = target.closest?.("[data-workspace-region]") ?? null;
  const key = region?.dataset?.workspaceRegion ?? null;
  if (isDestination(key)) return key;
  return target.closest?.("[data-workspace-frame]") ? DEFAULT_DESTINATION : null;
}

/**
 * The element a fragment names, or null.
 *
 * `location.hash` is whatever was typed, pasted, or mangled by a mail client on
 * the way to the reader — `#%%%` is a legal hash and an illegal escape sequence.
 * A destination that cannot be resolved is a fallback, never a thrown error, so
 * the decode and the lookup are both allowed to fail into "no such target".
 */
function fragmentTarget(doc, id) {
  try {
    return byId(doc, decodeURIComponent(id));
  } catch {
    return null;
  }
}

/** Whether a fragment is one of the four this shell owns. */
export function ownsFragment(hash) {
  return Object.values(DESTINATION_FRAGMENT).includes(String(hash ?? ""));
}

/**
 * The destination now on screen, read back off the markup rather than a variable.
 *
 * The rail's marked door *is* that record — there is one control, so there is
 * one place the answer can come from.
 */
export const currentWorkspaceDestination = currentDestination;

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

  for (const region of regions) {
    region.dataset.workspaceActive = region.dataset.workspaceRegion === key ? "true" : "false";
  }

  // The rail owns the marking and the announcement — `aria-current`, the word
  // "Current", the thickened rule, and one polite sentence when the destination
  // actually changes. Calling it here rather than repainting a second control is
  // what makes the two agree by construction instead of by convention.
  setCurrentDestination(doc, key, { announce });

  // The carried figures are a restatement, so they retire the moment the region
  // they restate is on screen.
  const context = byId(doc, WORKSPACE_SHELL_IDS.context);
  if (context) context.hidden = key === DEFAULT_DESTINATION;

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
  const record = loaded?.valid ? loaded.record : null;
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
  paintWorkspaceContext(doc, loaded);

  const select = (hash, { announce }) => {
    const raw = String(hash ?? "");
    // A bare or empty fragment is the answer — the same destination a cold load
    // of the bare URL opens — so stepping back to it never leaves the address
    // bar describing one destination while another is on screen.
    const key = raw.length > 1 ? destinationForFragment(doc, raw) : DEFAULT_DESTINATION;
    // A fragment this page does not own names something it cannot show. The
    // reader stays exactly where they were: on a cold load that is the answer,
    // because the caller below falls back to it, and mid-session it is the
    // destination they were already working in rather than an empty shell.
    if (!key) return null;
    return applyWorkspaceDestination(doc, key, { announce });
  };

  const onClick = (event) => {
    const link = event.target?.closest?.("a");
    const href = link?.getAttribute?.("href");
    if (!href || !href.startsWith("#")) return;
    // Never announced from here. The rail's own handler runs on the way back up
    // from this capture-phase listener and says what it did — including where it
    // put the keyboard, which this listener does not know.
    select(href, { announce: false });
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
