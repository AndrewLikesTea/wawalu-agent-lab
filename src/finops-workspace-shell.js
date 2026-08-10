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
// AND THE KEYBOARD GOES WITH IT. A switch that only repaints is a switch a
// sighted reader has already used and everyone else is still looking for: focus
// stayed wherever it was, which after a swap is frequently a control that is no
// longer rendered. So every change the reader made — a door here, a step back, a
// forwarded link onto a screen other than the answer — settles focus on the
// screen's own heading BEFORE the outgoing screen is taken down, and writes the
// destination and the question it answers into a live region that was already in
// the document. The heading is authored markup rather than a node a resolved
// dataset creates, so it is there to receive focus while a screen is loading,
// when it has nothing to draw, and when its module never arrived.
//
// UNKNOWN FRAGMENTS CHANGE NOTHING. A fragment this page does not own and cannot
// resolve to a panel leaves the selected destination exactly as it was. A shared
// link with a stale or invented hash is a link to this page, not an instruction
// to empty it.

import {
  DEFAULT_DESTINATION, DESTINATION_FRAGMENT, DESTINATION_STATE_LABEL, WORKSPACE_DESTINATION,
  setCurrentDestination,
} from "./finops-workspace-nav.js";
// The question each screen answers, from the module the answer block is already
// composed from. Named here rather than re-worded: a destination that announced
// a different question from the one its screen contract publishes would be a
// second source of truth for the same sentence.
import { SCREEN_CONTRACT } from "./finops-screen-contract.js";
import { DESTINATION_LOAD_STATE, createDestinationLoader } from "./finops-destination-loader.js";
// #1326's serializer, consumed rather than re-implemented. This module builds no
// query string of its own and hands no hand-assembled URL to a History: the
// address a destination change writes is `canonicalQuery`'s, so the front door's
// own `?destination=`/`?scope=`/`?department=` route — and every foreign
// parameter on the address — survives a move between workspace destinations
// instead of being dropped by whichever control happened to write the URL last.
import { canonicalQuery, parseDestinationRoute } from "./destination-route.js";
// The page's one status vocabulary. Reused, never extended: a destination that
// is still fetching its module is a panel in a state this module already draws.
import { PANEL_STATUS, applyPanelStatus } from "./panel-status-view.js";
// #1500's one alias map, consumed rather than restated. A link saved before the
// FinOps consolidation names markup that was merged away; the map says which
// surviving region absorbed it, and it is the same map the boot-time address
// rewrite reads, so the two paths cannot disagree about where an old link goes.
import { canonicalRegionId } from "./retired-anchor-compatibility.js";

/**
 * The ids the shipped markup carries, in one place so a test can name them.
 *
 * `switchList` is the NAVIGATION's list, not a second one of this module's own.
 * #819 collapsed the two: the shell used to author four doors beside the rail's
 * four, so every destination on this page was named twice. The doors it drives
 * are the rail's now, and the region that keeps this id is the screen header —
 * which screen is open, and the question it answers.
 */
export const WORKSPACE_SHELL_IDS = Object.freeze({
  switch: "finops-workspace-switch",
  switchList: "finops-workspace-nav-list",
  live: "finops-workspace-switch-live",
  screen: "finops-workspace-screen",
  screenTitle: "finops-workspace-screen-title",
  screenQuestion: "finops-workspace-screen-question",
  context: "finops-workspace-context",
  contextList: "finops-workspace-context-list",
});

/**
 * The screen contract entry behind each shell destination.
 *
 * Keyed by `shellDestination` rather than by the contract's own `key`, because
 * the two disagree on one destination on purpose: the contract says
 * "departments" where the fragment already in readers' address bars says
 * "department", and renaming either would break a saved link or a published
 * question.
 */
const SCREEN_BY_DESTINATION = Object.freeze(Object.fromEntries(
  SCREEN_CONTRACT.map((entry) => [entry.shellDestination, entry])));

/**
 * The fragment each destination owns.
 *
 * Named for the destination rather than for a panel inside it: a panel can be
 * renamed, merged, or moved to another destination, and a link a reader saved to
 * "the evidence" should survive all three. These four are the only fragments this
 * shell answers to; every other in-page fragment is resolved by looking up what
 * region actually contains it, so the page's existing deep links keep working.
 *
 * It is declared beside the doors that carry it, in the navigation module, and
 * re-exported here: one list of four fragments, read by both.
 */
export { DESTINATION_FRAGMENT };

/**
 * The address one workspace destination resolves to, written through #1326.
 *
 * The fragment names the destination; everything before it is `canonicalQuery`'s
 * answer for the front-door route the address already carried. Two consequences,
 * both of which are the reason this is not a template literal with a `?` in it:
 * a reader who arrived on `?destination=spend-attribution&department=backend`
 * still holds that route after stepping into Evidence, and a parameter belonging
 * to somebody else — a shared brief, a campaign tag — is carried through in its
 * original bytes rather than truncated by a control that only knew about hashes.
 */
export function workspaceRouteAddress(location, key) {
  const fragment = DESTINATION_FRAGMENT[key] ?? String(location?.hash ?? "");
  const route = parseDestinationRoute(location);
  return `${location?.pathname ?? ""}${canonicalQuery(location?.search ?? "", route)}${fragment}`;
}

/**
 * The visible word on the door for the destination now on screen.
 *
 * The navigation's word, not a second one. The shell used to say "Showing" on its
 * own copy of the doors while the rail said "Current" on its copy; with one
 * control there is one word.
 */
export const SHELL_STATE_LABEL = Object.freeze({ current: DESTINATION_STATE_LABEL.current });

/** The five figures carried into every destination but the answer. */
export const CONTEXT_TERMS = Object.freeze([
  "Benchmark", "Impact", "Confidence", "Why this matters", "Provenance",
]);

const DESTINATION_KEYS = Object.freeze(Object.values(WORKSPACE_DESTINATION));

/** Whose `hidden` a region is carrying. Read back off the markup, never remembered. */
export const HIDDEN_BY = Object.freeze({
  shell: "shell",
  panel: "panel",
  none: "none",
});

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

/** A destination's visible name, read off its own door so there is one wording. */
function destinationName(doc, key) {
  const door = switchDoors(doc).find((entry) => entry.dataset.shellDestination === key);
  return doorName(door) || key;
}

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
  const name = destinationName(doc, key);
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
 *
 * BETWEEN 2 AND 3, ONE LOOKUP (#1500). A fragment that names no element on this
 * page is checked against the alias map before it is given up on: a link shared
 * before the FinOps consolidation points at markup that was merged into a
 * surviving region, and resolving it here is what makes that link open the
 * canonical answer rather than nothing at all. One indirection only — the map's
 * value is looked up as an element and is never itself re-aliased — so a
 * mistaken pairing cannot become a cycle. An id in neither the document nor the
 * map is still null, and null is still "leave the selection alone".
 */
export function destinationForFragment(doc, hash) {
  const raw = String(hash ?? "");
  if (!raw.startsWith("#") || raw.length < 2) return null;
  const owned = Object.keys(DESTINATION_FRAGMENT)
    .find((key) => DESTINATION_FRAGMENT[key] === raw);
  if (owned) return owned;

  const id = raw.slice(1);
  const alias = canonicalRegionId(id);
  const target = byId(doc, id) ?? (alias ? byId(doc, alias) : null);
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
 * #1328: HIDING IS THE `hidden` ATTRIBUTE NOW, not a stylesheet rule alone. The
 * data attribute said "not on screen" to a sighted reader and to nobody else: a
 * screen-reader user still walked every panel of all five destinations, and Tab
 * still stopped on every control inside them, on a page whose entire argument is
 * that one destination is open at a time. `hidden` is the one mechanism that
 * takes a subtree out of the accessibility tree AND out of sequential
 * navigation, and it does it with no rule in any stylesheet.
 *
 * TWO OWNERS OF ONE PROPERTY, RECONCILED RATHER THAN AVOIDED. The reason this
 * was a data attribute is real: several of these regions manage their own
 * `hidden` for their own empty states — a graded sample nobody imported, a
 * portfolio with no periods on file — and a shell that wrote the same property
 * would show a reader an empty panel and call it a destination. So the shell
 * records WHOSE hiding it is on `data-workspace-hidden`:
 *
 *   shell   this switch hid it, because its destination is not open. Revealed
 *           again the moment that destination is.
 *   panel   the module that owns it hid it, because it has nothing to show. The
 *           shell never reveals one of these; being in the open destination does
 *           not make an empty panel worth reading.
 *   none    on screen, in the open destination.
 *
 * The reading is taken at the moment of the swap rather than remembered, so a
 * panel that painted content while its destination was closed comes back
 * correctly, and one that emptied itself stays empty.
 *
 * `data-workspace-active` is unchanged and still written: it is what the
 * stylesheet draws and what a test names, and it is the one channel that stays
 * true in the window where a module has just unhidden itself in a destination
 * nobody is standing in.
 */
export function applyWorkspaceDestination(doc, key, {
  announce = false, focus = null, loader = destinationLoader,
} = {}) {
  if (!isDestination(key)) return null;
  const regions = workspaceRegions(doc);
  if (regions.length === 0) return null;

  // BEFORE ANYTHING IS TORN DOWN. Two reasons focus is settled first rather than
  // after the swap. One: a reader standing on a control inside the outgoing
  // screen is holding a node this call is about to take out of the layout, and a
  // browser answers that by dropping focus to `<body>` — the next Tab then
  // restarts at the top of a fifteen-hundred-line document. Two: the heading is
  // repainted before it takes the keyboard, so what a screen reader announces on
  // arrival is the screen being opened and not the one being left.
  //
  // `focus` defaults to `announce` because the two describe the same event: a
  // destination the reader chose. A rail door or a deep link passes neither —
  // those hand focus to the panel the fragment names, and a shell that also
  // grabbed it would be the second of two owners fighting over one press.
  const heading = paintWorkspaceScreen(doc, key);
  if (heading && ((focus ?? announce) || focusStrandedBy(doc, key))) {
    heading.focus?.({ preventScroll: true });
  }

  let shown = 0;
  for (const region of regions) {
    const active = region.dataset.workspaceRegion === key;
    region.dataset.workspaceActive = active ? "true" : "false";
    const heldBack = region.getAttribute("data-workspace-hidden") === HIDDEN_BY.shell;
    if (active) {
      shown += 1;
      // Only what this switch hid. A panel holding its own empty state keeps it.
      if (heldBack) region.hidden = false;
      region.setAttribute("data-workspace-hidden",
        region.hidden ? HIDDEN_BY.panel : HIDDEN_BY.none);
    } else {
      region.setAttribute("data-workspace-hidden",
        region.hidden && !heldBack ? HIDDEN_BY.panel : HIDDEN_BY.shell);
      region.hidden = true;
    }
  }

  const group = byId(doc, WORKSPACE_SHELL_IDS.switch);
  if (group) group.dataset.workspaceDestination = key;
  // ONE CONTROL MARKS ITSELF. `setCurrentDestination` puts `aria-current`, the
  // word "Current" and the data attribute the stylesheet reads onto the one door
  // for this destination and takes them off the other three. The shell used to
  // run its own version of that loop over its own copy of the doors; there is one
  // list now, and the module that authors it owns how it is marked.
  setCurrentDestination(doc, key);

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

  if (announce) announceDestination(doc, key, shown);
  return key;
}

/**
 * Say the change once, in the one region the shipped document already carries.
 *
 * THE SINGLE-ANNOUNCEMENT INVARIANT IS STRUCTURAL, not a convention every caller
 * has to remember. There is exactly one live region on this page's switch —
 * `#finops-workspace-switch-live`, authored in the markup — and this is the only
 * function that writes it. The rail's doors announce nothing
 * (`setCurrentDestination` marks and returns), the disclosures announce nothing,
 * and the deep-link opener announces nothing. So a destination change cannot
 * produce two sentences by adding a second speaker; it could only produce two by
 * running the change path twice, which is what `data-announce-count` makes
 * observable and what routing the change through one `select` prevents.
 */
function announceDestination(doc, key, shown) {
  const live = byId(doc, WORKSPACE_SHELL_IDS.live);
  if (!live) return null;
  // One write per change, counted on the region itself. A test asserts the
  // count rather than the identity of a node, and a support conversation can ask
  // a live page the same question.
  live.setAttribute("data-announce-count",
    String(Number(live.getAttribute("data-announce-count") ?? 0) + 1));
  const door = switchDoors(doc).find((entry) => entry.dataset.shellDestination === key);
  const name = doorName(door) || key;
  // The question is last rather than first because the sentence before it is the
  // one a reader who pressed on purpose needs; the question is the confirmation
  // that they landed where they meant to. It is composed from the contract, not
  // from the screen, so it says the same thing while the screen is still loading,
  // when it has nothing to draw, and when its module failed to arrive.
  const question = SCREEN_BY_DESTINATION[key]?.question ?? "";
  live.textContent = `Showing ${name}. ${shown === 1 ? "1 panel" : `${shown} panels`}.`
    + (key === DEFAULT_DESTINATION ? "" : " The answer stays above it.")
    + (question ? ` It answers: ${question}` : "");
  return live;
}

/**
 * Name the screen now on, and hand back the heading focus is moved to.
 *
 * The name and the question are the screen contract's own, so this cannot drift
 * from what the answer block publishes. It never leaves the heading blank: a
 * destination with no contract entry falls back to the word on its own door, and
 * a focus target that announces as nothing is a focus target a reader cannot
 * locate themselves from.
 */
export function paintWorkspaceScreen(doc, key) {
  const screen = byId(doc, WORKSPACE_SHELL_IDS.screen);
  const title = byId(doc, WORKSPACE_SHELL_IDS.screenTitle);
  const question = byId(doc, WORKSPACE_SHELL_IDS.screenQuestion);
  if (!screen || !title || !question) return null;
  const entry = SCREEN_BY_DESTINATION[key] ?? null;
  screen.dataset.destination = key;
  title.textContent = entry?.name || destinationName(doc, key);
  question.textContent = entry?.question ?? "";
  question.hidden = !entry?.question;
  return title;
}

/**
 * Whether the keyboard is standing in a region this switch is about to unrender.
 *
 * Asked of the live document rather than tracked in a variable: focus moves for
 * reasons this module never sees — a reader clicked, a disclosure handler moved
 * it, a browser restored it on back — and the only reading that is true at the
 * moment of the swap is the one taken at the moment of the swap.
 */
function focusStrandedBy(doc, key) {
  const region = doc?.activeElement?.closest?.("[data-workspace-region]") ?? null;
  return Boolean(region) && region.dataset.workspaceRegion !== key;
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
export function initWorkspaceShell(doc, {
  win = null, loaded = null, loader = destinationLoader,
  history = win?.history ?? null, location = win?.location ?? null,
} = {}) {
  if (workspaceRegions(doc).length === 0) return null;
  // Seed rather than re-fetch: the entry already loaded this record for the
  // rail, so the first open of act-and-verify must not read the fixture twice.
  if (loaded) loader.seed(WORKSPACE_DESTINATION.actAndVerify, loaded);
  paintWorkspaceContext(doc, loaded);

  // WHERE THE READER WAS STANDING ON EACH SCREEN. Back and forward move without a
  // reload, so the browser has no new document to restore a scroll offset onto:
  // it repaints under the offset that belonged to the screen being left. The
  // offset is kept per destination instead — the unit the reader experiences —
  // written when one is left and replayed when it is returned to.
  const offsets = new Map();
  const scrollOf = () => (typeof win?.scrollY === "number" ? win.scrollY : 0);

  const select = (hash, { announce, focus = null, restore = false }) => {
    const key = destinationForFragment(doc, hash);
    // Unknown fragment: the reader stays exactly where they were.
    if (!key) return null;
    const leaving = currentWorkspaceDestination(doc);
    if (leaving && leaving !== key) offsets.set(leaving, scrollOf());
    // A change nobody made is not a change to announce. A `popstate` or a
    // `hashchange` that resolves to the destination already open — a link into
    // the screen the reader is standing in, a step back within one destination —
    // repaints and says nothing, which is the other half of "exactly once".
    const opened = applyWorkspaceDestination(doc, key, {
      announce: announce && leaving !== key, focus, loader,
    });
    // Only on a history move. A door press is a reader asking for the top of a
    // screen they chose; a step back is a reader asking for the place they left.
    if (opened && restore && leaving !== key) win?.scrollTo?.(0, offsets.get(key) ?? 0);
    return opened;
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

  /**
   * Write the route for a destination the reader chose, through #1326.
   *
   * One entry, and only when the address would actually change — pushing an
   * identical URL is what makes the back button appear to unwind scroll instead
   * of moving between destinations. `history` is injected, so this is driven by
   * a test double and never reaches for a global.
   *
   * `location.hash` is updated alongside the push because that is what a browser
   * does, and because the derivation below reads the address rather than a
   * variable: leaving the two out of step would make the next `popstate` resolve
   * against a URL the reader is no longer on.
   */
  const pushRoute = (key) => {
    if (!history?.pushState || !location) return false;
    const next = workspaceRouteAddress(location, key);
    const now = `${location.pathname ?? ""}${location.search ?? ""}${location.hash ?? ""}`;
    if (next === now) return false;
    history.pushState({ workspaceDestination: key }, "", next);
    if (typeof location.hash === "string") location.hash = DESTINATION_FRAGMENT[key] ?? "";
    return true;
  };

  const onClick = (event) => {
    if (event.defaultPrevented) return;
    const link = event.target?.closest?.("a");
    const href = link?.getAttribute?.("href");
    if (!href || !href.startsWith("#")) return;
    const key = destinationForFragment(doc, href);
    const changing = Boolean(key) && key !== currentWorkspaceDestination(doc);
    if (ownsFragment(href)) {
      // A DOOR ON THE RAIL. The route is written here rather than left to the
      // anchor, so the browser fires no `hashchange` behind this handler — which
      // is what stopped one press producing two runs of the change path, and two
      // writes into one live region. Focus goes to the screen's heading.
      if (pushRoute(key)) event.preventDefault?.();
      select(href, { announce: changing, focus: changing });
      return;
    }
    // A DEEP LINK. The destination is opened first — a target inside a hidden
    // container cannot take focus — and then the default is allowed to run, so
    // deep-link-disclosure.js still unfolds the panel and lands the reader on
    // the target itself. Announced only when it moved them to another
    // destination, and never focused here: the fragment names where to go.
    select(href, { announce: changing, focus: false });
  };

  const onHashChange = () => select(win?.location?.hash ?? "", { announce: true, restore: true });

  doc.addEventListener?.("click", onClick, true);
  doc.addEventListener?.("click", onRetry);
  win?.addEventListener?.("hashchange", onHashChange);
  win?.addEventListener?.("popstate", onHashChange);

  // A FORWARDED LINK IS A DESTINATION CHANGE the reader did not make on this
  // page, so it gets the same treatment as one they did: the keyboard on the
  // screen's heading and one polite sentence naming it. Only for a fragment this
  // shell owns and only when it is not the default — an ordinary cold open still
  // says nothing and moves nothing, and a deep link into a named panel is still
  // the deep-link handler's to focus.
  const hash = win?.location?.hash ?? "";
  const forwarded = ownsFragment(hash) && destinationForFragment(doc, hash) !== DEFAULT_DESTINATION;
  const opened = select(hash, { announce: forwarded, focus: forwarded })
    ?? applyWorkspaceDestination(doc, DEFAULT_DESTINATION, { announce: false, focus: false });

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
