// The workspace destination rail: four doors, one of them marked as where you are.
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
// WHAT THE RAIL WILL NOT DO. It does not hide the rest of the page. A focused
// workspace on a document this long is a tempting place to put a tab-panel
// switcher, and it would be the wrong one: every panel here is legitimate
// reading material, several are printed together, and hiding nine of them behind
// a control means a reader who scrolls past the rail can no longer find what
// they came for. So "focused" is achieved by naming the parts, marking the
// current one, and moving the keyboard — never by removing content from the
// page. Every door is a real anchor with a real href, so it works before this
// module runs, survives a copy-paste into the address bar, and needs no script
// to be operable at all.

import { DESTINATION_ROLE, prioritizedDestination } from "./finops-destination-contract.js";
import { revealFragmentTarget } from "./deep-link-disclosure.js";
import { SCREEN_CONTRACT } from "./finops-screen-contract.js";

/** The ids the shipped markup carries. Kept in one place so a test can name them. */
export const WORKSPACE_NAV_IDS = Object.freeze({
  nav: "finops-workspace-nav",
  title: "finops-workspace-nav-title",
  list: "finops-workspace-nav-list",
  live: "finops-workspace-nav-live",
  detail: "finops-workspace-nav-detail",
  detailSummary: "finops-workspace-nav-detail-summary",
  detailState: "finops-workspace-nav-detail-state",
  detailList: "finops-workspace-nav-detail-list",
});

/** The four destination keys, and the only four. */
export const WORKSPACE_DESTINATION = Object.freeze({
  answer: "answer",
  evidence: "evidence",
  department: "department",
  actAndVerify: "act-and-verify",
});

/**
 * The order, read off the screen contract rather than re-typed here.
 *
 * `SCREEN_CONTRACT` (issue #818) is the one place the four destinations are
 * named and sequenced. This module authors the rail and the shell renders the
 * screens, and both derive from that list, so a rename or a reorder there moves
 * the markup, the control, and the router together instead of leaving one of
 * them saying something the other three do not. A test asserts the two key
 * vocabularies above and below agree.
 */
export const DESTINATION_ORDER = Object.freeze(
  SCREEN_CONTRACT.map((screen) => screen.shellDestination),
);

/**
 * The address of each destination — the URL a reader can copy, forward, or open
 * cold, and the one the single control's doors point at.
 *
 * Named for the contract's own key, so `#workspace-departments` reads the way
 * the contract says "departments" even though the shell key stayed `department`
 * to keep fragments already in address bars resolving.
 */
export const DESTINATION_URL = Object.freeze(Object.fromEntries(
  SCREEN_CONTRACT.map((screen) => [screen.shellDestination, `#workspace-${screen.key}`]),
));

/** The destination one of those addresses names, or null for anything else. */
export function destinationForUrl(url) {
  const raw = String(url ?? "");
  return DESTINATION_ORDER.find((key) => DESTINATION_URL[key] === raw) ?? null;
}

/**
 * Where a reader is standing when the page opens.
 *
 * The brief is the first thing in the content region and the one region marked
 * `data-decision-summary="complete"`, so on a cold load with no fragment the
 * honest answer to "where am I?" is the answer.
 */
export const DEFAULT_DESTINATION = WORKSPACE_DESTINATION.answer;

/**
 * The visible state words. Text, never a colour and never a glyph alone: the
 * shapes beside them are `aria-hidden` decoration, so a reader in greyscale, on
 * paper, or in a screen reader gets the same three words a sighted reader does.
 */
export const DESTINATION_STATE_LABEL = Object.freeze({
  current: "Current",
  recommended: "Recommended first",
  // Act and verify is a destination *on this page* now that one control both
  // names the parts and opens them — its commitment loop was unreachable while
  // the rail's door left for the Savings Action Center. The centre is still
  // there, linked from inside the destination, and the chip says so rather than
  // letting a reader think the door leaves.
  alsoOffPage: "Also its own page",
});

/** Collapsed and expanded, for the rail's one disclosure. */
export const NAV_DISCLOSURE_LABEL = Object.freeze({
  collapsed: { shape: "▸", word: "Show detail" },
  expanded: { shape: "▾", word: "Hide detail" },
});

/**
 * The four doors as this page authors them.
 *
 * No `shape`. The rail used to draw ● ◇ ◈ ◆ beside the four names, and at the
 * 11px those marks ship at they are one silhouette with the detail sanded off —
 * the reader was disambiguating four near-identical diamonds to learn something
 * the four words already say. The names are the vocabulary now, "Current" is the
 * state, and the thick left rule CSS draws is the non-colour cue for it.
 *
 * `role` is the contract role this door corresponds to, or null for the page's
 * own answer. `fallbackHref` is what the door points at when the bundled record
 * fails its own contract: the destinations are *places*, and a place does not
 * stop existing because a ranking could not be computed, so the rail stays
 * operable and only the recommendation retires. The three fallbacks are the same
 * three the fixture carries, and `destinationHrefDrift` below is what keeps that
 * duplication honest rather than a second source of truth nobody checks.
 */
const AUTHORED_BY_KEY = Object.freeze({
  [WORKSPACE_DESTINATION.answer]: Object.freeze({
    role: null,
    fallbackHref: "#finops-first-run",
    landingId: "finops-first-run",
    answers: "Are we wasting money, how much of the spend is recoverable, and what is the one ranked action?",
    doesNotAnswer: "It does not show the workings behind the figure, and it commits to nothing.",
  }),
  [WORKSPACE_DESTINATION.evidence]: Object.freeze({
    role: DESTINATION_ROLE.evidence,
    fallbackHref: "#recommendation-evidence",
    landingId: "recommendation-evidence",
  }),
  [WORKSPACE_DESTINATION.department]: Object.freeze({
    role: DESTINATION_ROLE.departmentDetail,
    fallbackHref: "#department-decision-panel",
    landingId: "department-decision-panel",
  }),
  [WORKSPACE_DESTINATION.actAndVerify]: Object.freeze({
    role: DESTINATION_ROLE.actAndVerify,
    // The contract points this role at the Savings Action Center, and that is
    // still where `destinationHrefDrift` holds it. The door opens the in-page
    // destination; `landingId` is where the keyboard lands inside it, and the
    // link to the centre ships in the panel it lands on.
    fallbackHref: "/savings-action-center.html",
    landingId: "savings-portfolio-panel",
  }),
});

/** The names and the order come from the contract; everything else is authored. */
const AUTHORED_DESTINATIONS = Object.freeze(SCREEN_CONTRACT.map((screen) => Object.freeze({
  key: screen.shellDestination,
  name: screen.name,
  url: DESTINATION_URL[screen.shellDestination],
  ...AUTHORED_BY_KEY[screen.shellDestination],
})));

const byId = (doc, id) => doc?.getElementById?.(id) ?? null;
const collapse = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
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
      // `offPage` describes the contract's target, not the door: every door
      // opens a destination on this page now. It is what puts the "Also its own
      // page" chip on act-and-verify and nothing else.
      offPage: !isInPage(href),
      targetId: isInPage(href) ? href.slice(1) : authored.landingId ?? null,
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

/** The accessible name of a destination's landmark, as a reader would hear it. */
export function destinationLandmarkName(doc, targetId) {
  const target = targetId ? byId(doc, targetId) : null;
  if (!target) return null;
  const labelledBy = target.getAttribute("aria-labelledby");
  const label = labelledBy ? byId(doc, labelledBy) : null;
  return collapse(label?.textContent ?? target.getAttribute("aria-label") ?? "") || null;
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
 * Mark one door as the current destination.
 *
 * Three channels, deliberately: `aria-current` for the accessibility tree, the
 * word "Current" for everyone reading the rail, and a data attribute for the
 * fill and the rule CSS draws. Nothing here is carried by colour.
 *
 * Every door is markable now that this is the page's one control: all four
 * open a destination on this document, so there is no door a reader can follow
 * and leave the rail describing a place they are no longer in.
 */
export function setCurrentDestination(doc, key, { announce = false, opened = 0 } = {}) {
  const nav = byId(doc, WORKSPACE_NAV_IDS.nav);
  const door = doorFor(doc, key);
  if (!nav || !door) return null;
  const changed = currentDestination(doc) !== key;

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

  // Announce the *change*, never the state. Re-activating the door you are
  // already standing in repaints nothing and says nothing: a live region that
  // speaks on every press teaches a screen-reader user to tune it out, and then
  // the one announcement that mattered is the one they missed.
  if (announce && changed) announceDestination(doc, door, opened);
  return door;
}

export function announceDestination(doc, door, opened = 0) {
  const live = byId(doc, WORKSPACE_NAV_IDS.live);
  const nav = byId(doc, WORKSPACE_NAV_IDS.nav);
  if (!live) return null;
  const name = destinationLandmarkName(doc, door.dataset.destinationTarget);
  const sentences = [`Current destination: ${collapse(door.dataset.destinationName)}.`];
  if (name) sentences.push(`The keyboard is on “${name}”.`);
  // How much of the page this destination put on screen, counted off the markup
  // the shell just repainted. One live region says the whole thing: what the
  // reader is now in, where the keyboard went, and how much is under it.
  const shown = [...(doc.querySelectorAll?.('[data-workspace-region][data-workspace-active="true"]') ?? [])];
  if (shown.length > 0) {
    sentences.push(shown.length === 1 ? "1 panel is on screen." : `${shown.length} panels are on screen.`);
  }
  // A disclosure this rail opened is a change the reader did not ask for, so it
  // is stated rather than left for them to discover on the way back out.
  if (opened > 0) {
    sentences.push(opened === 1
      ? "The supporting panel it was folded inside is now open."
      : `The ${opened} supporting panels it was folded inside are now open.`);
  }
  live.textContent = sentences.join(" ");
  if (nav) nav.dataset.announcements = String(Number(nav.dataset.announcements ?? 0) + 1);
  return live;
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
export function applyWorkspaceNav(doc, loaded = null, { hash = "" } = {}) {
  const nav = byId(doc, WORKSPACE_NAV_IDS.nav);
  const list = byId(doc, WORKSPACE_NAV_IDS.list);
  if (!nav || !list) return null;

  const destinations = workspaceDestinations(loaded);
  const ranked = destinations.some((entry) => entry.recommended);
  nav.dataset.ranked = ranked ? "true" : "false";

  for (const entry of destinations) {
    const link = doorFor(doc, entry.key);
    if (!link) continue;
    // The door's href is the destination's own address, never a panel's: a
    // panel can be renamed, merged, or moved to another destination, and a link
    // a reader forwarded to "the evidence" should survive all three. The
    // contract's href stays the *landing* — where the keyboard goes once the
    // destination is on screen.
    link.setAttribute("href", entry.url);
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

  // A fragment already in the address bar wins over the default: a reader who
  // arrived on a shared link to the department panel is standing there, and the
  // rail saying "answer" would be the first thing it got wrong. A destination
  // address is read first; one of today's panel anchors is read second; and
  // anything else falls back to the answer rather than marking nothing.
  const arrived = destinationForUrl(hash)
    ?? destinations.find((entry) => entry.targetId && `#${entry.targetId}` === String(hash))?.key
    ?? null;
  setCurrentDestination(doc, arrived ?? DEFAULT_DESTINATION, { announce: false });
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
 * Bind the rail.
 *
 * The links are never intercepted: the default is allowed to run, so the address
 * bar ends up holding the fragment a reader can copy, the back button returns
 * them, and a middle-click or a modifier still opens a new tab. What this adds
 * is the part the browser cannot do — unfolding the disclosure the target is
 * inside, moving the keyboard to it, marking where the reader now is, and saying
 * so once — by way of `revealFragmentTarget`, which is the same rule the page's
 * deep-link handler already applies to every in-page link.
 */
export function bindWorkspaceNav(doc, { reveal = revealFragmentTarget } = {}) {
  const nav = byId(doc, WORKSPACE_NAV_IDS.nav);
  const list = byId(doc, WORKSPACE_NAV_IDS.list);
  if (!nav || !list) return null;

  list.addEventListener("click", (event) => {
    const link = event.target?.closest?.("[data-destination-key]");
    if (!link) return;
    // The landing, not the href: the href is the destination's address and names
    // no element, and what a reader needs revealed and focused is the panel the
    // destination opens on.
    const landing = link.dataset.destinationTarget;
    const revealed = landing ? reveal(doc, `#${landing}`, { scroll: true, focus: true }) : null;
    setCurrentDestination(doc, link.dataset.destinationKey, {
      announce: true,
      opened: revealed?.opened?.length ?? 0,
    });
  });

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
