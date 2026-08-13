// The workspace navigation: four destinations, one of them marked as where you are.
//
// #819. THIS IS NOW THE PAGE'S ONE NAVIGATION CONTROL. It used to be half of one:
// this rail listed the four destinations and pointed each door at a *panel* inside
// them, and `finops-workspace-shell.js` shipped a second list — the "Working area"
// switcher — naming the same four and pointing at the *destination*. Every
// destination was named twice and only one copy changed what was on screen. There
// is one list now, here; the shell reads its doors rather than authoring a rival
// set. `data-destination-target` survives as the panel a door's *contract* names,
// which keeps the landmark marking and the drift check honest.
//
// WHAT THIS FIXES, AND WHY IT IS NOT THE REGION ABOVE IT.
//
// `finops-destination-contract.js` decides *which* door a leader should take
// first and `finops-destination-view.js` draws that recommendation. Neither of
// them is navigation: the recommendation names one door, deliberately, and a
// reader who wants a different part of this page is back to scrolling a
// fifteen-hundred-line document whose panels are folded inside collapsed
// disclosures a thousand lines apart. Two specific consequences, both of which
// this module exists to end:
//
//   1. There was no statement of *where the reader is*. The site nav says "AI
//      FinOps" and stops; inside the page, position was carried by scroll offset
//      and nothing else. A keyboard or screen-reader user tabbing through this
//      document had no way to ask "which part am I in?" and no way to move
//      between parts except by walking every control in between.
//   2. The two in-page destinations the contract names — the recommendation
//      evidence and the department drill-down — are both authored *inside*
//      closed `details` elements. A fragment link to a collapsed target used to
//      resolve to nothing at all; `deep-link-disclosure.js` fixed the resolution
//      and this rail reuses it rather than growing a second copy of that rule.
//
// THE FOUR DOORS, and why four rather than the contract's three. The contract
// enumerates the three places a leader goes *after* reading the answer, so the
// answer itself is not one of them — correctly, because a destination record is
// a recommendation and "stay where you are" is not one. A wayfinding rail has
// the opposite requirement: it has to be able to say where the reader is, and on
// this page that is the decision brief. So the answer door is authored here, as
// this page's own default destination, and the other three are read from the
// contract by role. A fourth *contract* role would still be a product decision;
// this is not one.
//
// EVERY DOOR IS A REAL ANCHOR with a real href, so it works before this module
// runs, survives a copy-paste into the address bar, and needs no script to be
// operable at all. What the doors no longer do is announce: one press changes one
// screen, and the shell — which owns the screen, its heading and its question —
// says so once, in one live region. Two regions describing one press is how a
// screen-reader user learns to ignore both.

import { DESTINATION_ROLE, prioritizedDestination } from "./finops-destination-contract.js";
// The destination names and their reading order, from the executable screen
// contract rather than re-typed here. A rail that spelled "Departments" itself
// would be the second place this page decides what a destination is called.
import { SCREEN_CONTRACT } from "./finops-screen-contract.js";

/** The ids the shipped markup carries. Kept in one place so a test can name them. */
export const WORKSPACE_NAV_IDS = Object.freeze({
  nav: "finops-workspace-nav",
  title: "finops-workspace-nav-title",
  list: "finops-workspace-nav-list",
  detail: "finops-workspace-nav-detail",
  detailSummary: "finops-workspace-nav-detail-summary",
  detailState: "finops-workspace-nav-detail-state",
  detailList: "finops-workspace-nav-detail-list",
});

/** The workspace destination keys. The first four preserve the original screens. */
export const WORKSPACE_DESTINATION = Object.freeze({
  answer: "answer",
  evidence: "evidence",
  department: "department",
  actAndVerify: "act-and-verify",
  monthlyReview: "monthly-review",
});

/**
 * Where a reader is standing when the page opens.
 *
 * The brief is the first thing in the content region and the one region marked
 * `data-decision-summary="complete"`, so on a cold load with no fragment the
 * honest answer to "where am I?" is the answer.
 */
export const DEFAULT_DESTINATION = WORKSPACE_DESTINATION.answer;

/**
 * The fragment each destination owns, and the href each door carries.
 *
 * It lives here rather than in the shell because the doors are authored here and
 * a control cannot point at a vocabulary it does not hold; the shell re-exports
 * it, so there is still exactly one list of the four fragments. Named for the
 * destination rather than for a panel inside it: a panel can be renamed, merged,
 * or moved to another destination, and a link a reader saved to "the evidence"
 * should survive all three.
 */
export const DESTINATION_FRAGMENT = Object.freeze({
  [WORKSPACE_DESTINATION.answer]: "#workspace-answer",
  [WORKSPACE_DESTINATION.evidence]: "#workspace-evidence",
  [WORKSPACE_DESTINATION.department]: "#workspace-departments",
  [WORKSPACE_DESTINATION.actAndVerify]: "#workspace-act-and-verify",
  [WORKSPACE_DESTINATION.monthlyReview]: "#workspace-monthly-review",
});

/**
 * The visible state words. Text, never a colour and never a glyph alone: the
 * shapes beside them are `aria-hidden` decoration, so a reader in greyscale, on
 * paper, or in a screen reader gets the same two words a sighted reader does.
 *
 * "Opens another page" is gone with the door that carried it: act-and-verify is
 * an in-page destination now, and the Savings Action Center it also has a page
 * for is still linked from the ranked door above this control.
 */
export const DESTINATION_STATE_LABEL = Object.freeze({
  current: "Current",
  recommended: "Recommended first",
});

/** Collapsed and expanded, for the rail's one disclosure. */
export const NAV_DISCLOSURE_LABEL = Object.freeze({
  collapsed: { shape: "▸", word: "Show detail" },
  expanded: { shape: "▾", word: "Hide detail" },
});

/**
 * What each door needs beyond its name, keyed by the destination it belongs to.
 *
 * The NAME AND THE ORDER ARE NOT HERE. They are `SCREEN_CONTRACT`'s, read below,
 * because a destination's name is a published product decision and a control that
 * spelled it a second time is a control that can disagree with the screen it
 * opens. What is here is the plumbing the contract has no opinion about.
 *
 * `role` is the workspace-destination contract role this door corresponds to, or
 * null for the page's own answer. `fallbackHref` is the panel that contract
 * points its role at when the bundled record fails validation: the destinations
 * are *places*, and a place does not stop existing because a ranking could not be
 * computed. The three fallbacks are the same three the fixture carries, and
 * `destinationHrefDrift` below is what keeps that duplication honest rather than a
 * second source of truth nobody checks.
 */
const DOOR_PLUMBING = Object.freeze({
  [WORKSPACE_DESTINATION.answer]: Object.freeze({
    role: null,
    fallbackHref: "#finops-first-run",
    answers: "How much analyzed AI spend is recoverable, and what is the one ranked action?",
    doesNotAnswer: "It does not show the workings behind the figure, and it commits to nothing.",
  }),
  [WORKSPACE_DESTINATION.evidence]: Object.freeze({
    role: DESTINATION_ROLE.evidence,
    fallbackHref: "#recommendation-evidence",
  }),
  [WORKSPACE_DESTINATION.department]: Object.freeze({
    role: DESTINATION_ROLE.departmentDetail,
    fallbackHref: "#department-decision-panel",
  }),
  [WORKSPACE_DESTINATION.actAndVerify]: Object.freeze({
    role: DESTINATION_ROLE.actAndVerify,
    fallbackHref: "/savings-action-center.html",
  }),
  [WORKSPACE_DESTINATION.monthlyReview]: Object.freeze({
    role: null,
    fallbackHref: "#monthly-review-projection",
    answers: "What changed against the retained month, and what is the next action?",
    doesNotAnswer: "It does not claim that a prior action caused the observed change.",
  }),
});

/**
 * The four doors, in the screen contract's own order and under its own names.
 *
 * `shellDestination` is the join: the contract says "departments" where the
 * fragment already in readers' address bars says "department", and it publishes
 * both so neither has to move.
 */
const AUTHORED_DESTINATIONS = Object.freeze(SCREEN_CONTRACT.map((screen) => Object.freeze({
  key: screen.shellDestination,
  name: screen.name,
  fragment: DESTINATION_FRAGMENT[screen.shellDestination],
  ...DOOR_PLUMBING[screen.shellDestination],
})));

const byId = (doc, id) => doc?.getElementById?.(id) ?? null;
const isInPage = (href) => String(href ?? "").startsWith("#");

/**
 * The four doors, merged with the loaded record.
 *
 * A record that failed validation contributes nothing: no href is overwritten,
 * no door is recommended, and `ranked` is false. Half a ranking would be worse
 * than none, because a reader cannot tell which half is missing.
 */
export function workspaceDestinations(loaded = null) {
  const record = loaded?.valid ? loaded.record : null;
  const primary = prioritizedDestination(record);
  const fromContract = new Map(
    (record?.destinations ?? []).filter((entry) => entry?.role).map((entry) => [entry.role, entry]),
  );
  return Object.freeze(AUTHORED_DESTINATIONS.map((authored) => {
    const contract = authored.role ? fromContract.get(authored.role) ?? null : null;
    const href = contract?.href ?? authored.fallbackHref;
    return Object.freeze({
      ...authored,
      href,
      offPage: !isInPage(href),
      targetId: isInPage(href) ? href.slice(1) : null,
      answers: contract?.answers ?? authored.answers ?? null,
      doesNotAnswer: contract?.doesNotAnswer ?? authored.doesNotAnswer ?? null,
      recommended: Boolean(primary && contract && primary.role === contract.role),
      rank: contract?.rank ?? null,
    });
  }));
}

/**
 * Every authored door whose href disagrees with the contract's for its role.
 *
 * Exported for the regression test rather than used at runtime: the markup is
 * authored so the rail works with no script, the contract is the source of
 * truth, and this is the function that fails loudly when the two drift instead
 * of silently sending a reader to a fragment that moved.
 */
export function destinationHrefDrift(loaded = null) {
  const record = loaded?.valid ? loaded.record : null;
  if (!record) return [];
  const drift = [];
  for (const entry of workspaceDestinations(loaded)) {
    if (!entry.role) continue;
    const authored = AUTHORED_DESTINATIONS.find((door) => door.key === entry.key);
    if (authored.fallbackHref !== entry.href) {
      drift.push({ key: entry.key, authored: authored.fallbackHref, contract: entry.href });
    }
  }
  return drift;
}

function stateChip(doc, className, word, shape = null) {
  const chip = doc.createElement("span");
  chip.className = className;
  if (shape) {
    const glyph = doc.createElement("span");
    glyph.className = "workspace-nav-detail-shape";
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = shape;
    chip.append(glyph);
  }
  chip.append(doc.createTextNode(shape ? ` ${word}` : word));
  return chip;
}

// Spread rather than used directly: a browser hands back a NodeList, which has
// no `find`, and the harness hands back an array. One shape for both.
const doorLinks = (doc) =>
  [...(byId(doc, WORKSPACE_NAV_IDS.list)?.querySelectorAll?.("[data-destination-key]") ?? [])];

const doorFor = (doc, key) =>
  doorLinks(doc).find((link) => link.dataset.destinationKey === key) ?? null;

/** The key currently marked, read back off the markup rather than from a variable. */
export function currentDestination(doc) {
  const marked = doorLinks(doc).find((link) => link.getAttribute("aria-current") === "true");
  return marked?.dataset?.destinationKey ?? null;
}

/**
 * The rail's own statement of where the reader is, in words.
 *
 * `aria-current="true"` AND NOT `"page"`. This rail moves between parts of ONE
 * document — every door is a fragment on /evolution.html — so "page" would tell
 * a screen-reader user they had arrived somewhere they have not left. `"true"`
 * is the unqualified form for a within-page structure, it is what
 * `setCurrentDestination` has always written, and it is what the front door's
 * doors next door already carry, so the page speaks one dialect.
 *
 * Read off the marked door rather than kept in a variable, so the invariant
 * #1328 exists to hold — the rail's label, the destination on the address, and
 * the visible screen heading agree — is checked against what the markup actually
 * says at that moment and not against what a handler believes it wrote.
 */
export function currentDestinationLabel(doc) {
  const marked = doorLinks(doc).find((link) => link.getAttribute("aria-current") === "true");
  if (!marked) return null;
  return String(marked.dataset?.destinationName ?? "").trim()
    || AUTHORED_DESTINATIONS.find((door) => door.key === marked.dataset?.destinationKey)?.name
    || null;
}

/**
 * Mark one door as the current destination.
 *
 * Three channels, deliberately: `aria-current` for the accessibility tree, the
 * word "Current" for everyone reading the control, and a data attribute for the
 * fill and the rule CSS draws. Nothing here is carried by colour.
 *
 * It says nothing. The shell calls this on every destination change — a door, a
 * forwarded link, a step back — and announces the change once itself, with the
 * screen's name and the question it answers. Marking and announcing are one act
 * now, and one act gets one voice.
 */
export function setCurrentDestination(doc, key) {
  const nav = byId(doc, WORKSPACE_NAV_IDS.nav);
  const door = doorFor(doc, key);
  if (!nav || !door) return null;

  for (const link of doorLinks(doc)) {
    const isCurrent = link === door;
    if (isCurrent) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
    link.dataset.destinationCurrent = isCurrent ? "true" : "false";
    const slot = link.querySelector(".workspace-dest-state");
    if (slot) {
      slot.replaceChildren();
      slot.hidden = !isCurrent;
      if (isCurrent) slot.append(doc.createTextNode(DESTINATION_STATE_LABEL.current));
    }
    // The destination's own landmark carries the same fact, so the rule CSS
    // draws down the side of the region a reader was sent to cannot disagree
    // with the rail that sent them.
    const target = link.dataset.destinationTarget ? byId(doc, link.dataset.destinationTarget) : null;
    if (target) target.dataset.workspaceCurrent = isCurrent ? "true" : "false";
  }
  nav.dataset.current = key;
  return door;
}

/**
 * Keep the disclosure's three state channels in step with its own `open`.
 *
 * Same silhouette as the brief's method disclosure above it, and for the same
 * reason: `aria-expanded` for the accessibility tree, a visible word for
 * everyone else, and a glyph that is decoration beside the word rather than the
 * word itself. Bound to `toggle`, so the pointer path and the keyboard path go
 * through one piece of code instead of two that can disagree — and nothing here
 * intercepts a key, because the native control already handles every one.
 */
export function paintNavDisclosureState(doc) {
  const details = byId(doc, WORKSPACE_NAV_IDS.detail);
  const summary = byId(doc, WORKSPACE_NAV_IDS.detailSummary);
  if (!details || !summary) return null;
  const open = Boolean(details.open ?? details.hasAttribute?.("open"));
  const spec = open ? NAV_DISCLOSURE_LABEL.expanded : NAV_DISCLOSURE_LABEL.collapsed;
  summary.setAttribute("aria-expanded", open ? "true" : "false");
  details.dataset.disclosure = open ? "expanded" : "collapsed";
  const state = byId(doc, WORKSPACE_NAV_IDS.detailState);
  if (state) {
    state.dataset.disclosure = open ? "expanded" : "collapsed";
    state.replaceChildren(stateChip(doc, "workspace-nav-detail-word", spec.word, spec.shape));
  }
  return summary;
}

/**
 * Paint the rail from the loaded record.
 *
 * The four doors are authored in the markup, so this never creates or removes
 * one: it corrects the hrefs from the contract, moves the recommendation to the
 * door the priority clause promoted, fills in what each door answers, and marks
 * where the reader is. A rail that painted itself from scratch would be a rail
 * that is empty until a script runs, on a page whose whole argument is that the
 * answer must not wait on one.
 */
export function applyWorkspaceNav(doc, loaded = null, { hash = "", location = null } = {}) {
  const nav = byId(doc, WORKSPACE_NAV_IDS.nav);
  const list = byId(doc, WORKSPACE_NAV_IDS.list);
  if (!nav || !list) return null;

  const destinations = workspaceDestinations(loaded);
  const ranked = destinations.some((entry) => entry.recommended);
  nav.dataset.ranked = ranked ? "true" : "false";

  for (const entry of destinations) {
    const link = doorFor(doc, entry.key);
    if (!link) continue;
    // The DESTINATION, not the panel. The href is what a reader copies out of the
    // address bar and what the shell resolves back into a screen; the contract's
    // panel href rides along as `data-destination-target`, which is what marks the
    // landmark a door leads to and what `destinationHrefDrift` checks.
    link.setAttribute("href", entry.fragment);
    link.dataset.destinationName = entry.name;
    link.dataset.destinationRole = entry.role ?? "answer";
    if (entry.targetId) link.dataset.destinationTarget = entry.targetId;

    // The recommendation, in the same words and from the same clause as the
    // ranked door above this rail. It is a chip on the door rather than a second
    // recommendation of its own, so the page still makes the point once.
    const slot = link.querySelector(".workspace-dest-recommended");
    if (slot) {
      slot.replaceChildren();
      slot.hidden = !entry.recommended;
      if (entry.recommended) slot.append(doc.createTextNode(DESTINATION_STATE_LABEL.recommended));
    }
  }

  paintNavDetail(doc, destinations);
  paintNavDisclosureState(doc);

  // THE MARK IS DERIVED FROM THE ADDRESS, never from a scroll offset or a
  // remembered variable: a reader who arrived on a shared link to the department
  // panel is standing there, and the rail saying "answer" would be the first
  // thing this page got wrong. `location` is the whole address so the derivation
  // reads the same object the shell routes from; `hash` remains for the callers
  // that only hold one.
  const address = String(location?.hash ?? hash ?? "");
  const arrived = destinations.find((entry) => address === entry.fragment
    || (entry.targetId && `#${entry.targetId}` === address));
  setCurrentDestination(doc, arrived?.key ?? DEFAULT_DESTINATION);
  return destinations;
}

/**
 * What each door answers, and what it will not — behind the one disclosure.
 *
 * Both halves, always. A door labelled only with what it offers is how a reader
 * ends up in the wrong room and blames the page.
 */
function paintNavDetail(doc, destinations) {
  const target = byId(doc, WORKSPACE_NAV_IDS.detailList);
  if (!target) return null;
  target.replaceChildren();
  for (const entry of destinations) {
    const group = doc.createElement("div");
    group.dataset.destinationKey = entry.key;
    const term = doc.createElement("dt");
    term.textContent = entry.name;
    group.append(term);
    if (entry.answers) {
      const answers = doc.createElement("dd");
      answers.className = "workspace-nav-answers";
      answers.textContent = entry.answers;
      group.append(answers);
    }
    if (entry.doesNotAnswer) {
      const limit = doc.createElement("dd");
      limit.className = "workspace-nav-limit";
      limit.textContent = entry.doesNotAnswer;
      group.append(limit);
    }
    target.append(group);
  }
  return target;
}

/**
 * Bind the control's one disclosure.
 *
 * THE DOORS ARE NOT BOUND HERE ANY MORE, and that is the point of the collapse.
 * A door is an ordinary anchor pointing at the destination it opens; the shell
 * listens for the press, swaps the screen, marks this control through
 * `setCurrentDestination`, hands the keyboard to the new screen's heading and
 * says so once. This module used to do a rival version of all four for the same
 * press — unfold the panel the old href named, focus *that*, mark, and announce
 * into a second live region — and the two disagreed about where the keyboard went
 * and what the reader was told. One press, one handler.
 */
export function bindWorkspaceNav(doc) {
  const nav = byId(doc, WORKSPACE_NAV_IDS.nav);
  const list = byId(doc, WORKSPACE_NAV_IDS.list);
  if (!nav || !list) return null;

  const details = byId(doc, WORKSPACE_NAV_IDS.detail);
  details?.addEventListener("toggle", () => paintNavDisclosureState(doc));
  paintNavDisclosureState(doc);
  return nav;
}

/**
 * Retire the ranking when the reader's own analysis replaces the example.
 *
 * The doors stay — they are places, not figures, and a reader who has just
 * imported their own export needs them more than anyone. Only the recommendation
 * goes, because it was computed from invented data, which is exactly the rule
 * `supersedeWorkspaceDestinations` applies to the ranked region above.
 */
export function supersedeWorkspaceNavRanking(doc, superseded) {
  const nav = byId(doc, WORKSPACE_NAV_IDS.nav);
  if (!nav) return null;
  if (!superseded) return nav;
  nav.dataset.ranked = "false";
  for (const link of doorLinks(doc)) {
    const slot = link.querySelector(".workspace-dest-recommended");
    if (!slot) continue;
    slot.replaceChildren();
    slot.hidden = true;
  }
  return nav;
}
