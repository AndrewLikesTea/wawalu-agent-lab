// One URL per AI FinOps destination, and the department it was opened on (#1522).
//
// WHAT THESE ASSERTIONS ARE FOR.
//
//   * A LINK CARRIES THE READING, NOT JUST THE SCREEN. The defect was that a
//     lead who drilled into Backend and sent the link sent "the departments
//     screen"; the recipient landed on whichever department ranked first. The
//     deep-link case here fails if the selection does not come back.
//   * BACK AND FORWARD ARE A VIEW SWITCH. Walking destinations must not disturb
//     the earned grade or the committed-action state, which the FinOps
//     persistence layer owns and the address bar has no business holding. That
//     case runs the whole walk with a `localStorage` that throws on contact, so
//     a router that reached for the store fails rather than passing quietly.
//   * A BAD ADDRESS RESOLVES TO SOMETHING. Unknown, unsupported and malformed
//     all land on the answer, and the two this router can prove are its own are
//     corrected off the URL so a reload does not re-trigger them.
//   * THE PURE HALF IS EXERCISED PURELY. Parse and serialize are asserted over
//     every slug and every selection id the #1521 map holds, with no document in
//     the room — cheaper than the DOM harness and sharper about what broke.
//
// No clock, no network, no sleeps, and no page boot: every case here drives the
// modules directly against the shipped markup.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml } from "./support/browser.js";
import {
  DESTINATION_REGIONS, destinationSelections,
} from "../src/finops-destination-regions.js";
import { DESTINATION_FRAGMENT, WORKSPACE_DESTINATION } from "../src/finops-workspace-nav.js";
import {
  FALLBACK_SLUG, SCREEN_ROUTE_STATUS, SELECTION_PARAM,
  createScreenRouter, parseScreenRoute, screenRoute, screenRouteAddress,
  serializeScreenRoute,
} from "../src/finops-destination-router.js";
import {
  SELECTION_LIST_ID, applyScreenRoute, currentWorkspaceDestination, initWorkspaceShell,
  workspaceRegions,
} from "../src/finops-workspace-shell.js";
import { loadWorkspaceDestinations } from "../src/finops-destination-contract.js";

const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
const loaded = loadWorkspaceDestinations();
const DEPARTMENT = WORKSPACE_DESTINATION.department;
const SELECTIONS = destinationSelections(DEPARTMENT);

const activeKeys = (doc) => new Set(workspaceRegions(doc)
  .filter((region) => region.dataset.workspaceActive === "true")
  .map((region) => region.dataset.workspaceRegion));

/* ------------------------------ the pure half ------------------------------ */

test("the map is the only source of slugs and selections", () => {
  assert.ok(DESTINATION_REGIONS.length >= 5,
    `only ${DESTINATION_REGIONS.length} destinations are declared`);
  assert.ok(SELECTIONS.length >= 7, "the department screen declares no selections to address");
  // Exactly one destination is read per department. The other four answer a
  // question about the whole org, and an address may not qualify them.
  const qualified = DESTINATION_REGIONS.filter((entry) => entry.selectionIds.length > 0);
  assert.deepEqual(qualified.map((entry) => entry.slug), [DEPARTMENT]);
  // Every declared slug owns a fragment, or it has no URL to be given.
  for (const entry of DESTINATION_REGIONS) {
    assert.equal(typeof DESTINATION_FRAGMENT[entry.slug], "string",
      `${entry.slug} is declared but owns no fragment`);
  }
});

test("parse and serialize are inverse over every destination", () => {
  for (const entry of DESTINATION_REGIONS) {
    const address = serializeScreenRoute({ slug: entry.slug });
    assert.equal(address, DESTINATION_FRAGMENT[entry.slug]);
    const route = parseScreenRoute(address);
    assert.equal(route.status, SCREEN_ROUTE_STATUS.ok, `${address} did not resolve`);
    assert.equal(route.slug, entry.slug);
    assert.equal(route.selection, null);
    assert.equal(route.correct, false, `${address} asked to be rewritten`);
    // Idempotent over its own output, so a round trip is a fixed point rather
    // than a value that drifts one encoding per hop.
    assert.equal(serializeScreenRoute(route), address);
  }
});

test("parse and serialize are inverse over every selection the map holds", () => {
  for (const selection of SELECTIONS) {
    const address = serializeScreenRoute({ slug: DEPARTMENT, selection });
    assert.equal(address, `?${SELECTION_PARAM}=${selection}${DESTINATION_FRAGMENT[DEPARTMENT]}`);
    const route = parseScreenRoute(address);
    assert.equal(route.status, SCREEN_ROUTE_STATUS.ok);
    assert.equal(route.slug, DEPARTMENT);
    assert.equal(route.selection, selection);
    assert.equal(serializeScreenRoute(route), address);
  }
});

test("an ordinary open is the answer, and is not an error", () => {
  for (const input of ["", null, undefined, { hash: "", search: "" }, "/evolution.html"]) {
    const route = parseScreenRoute(input);
    assert.equal(route.status, SCREEN_ROUTE_STATUS.absent, `${JSON.stringify(input)} was read as an error`);
    assert.equal(route.slug, FALLBACK_SLUG);
    assert.equal(route.correct, false, "an ordinary open asked to be rewritten");
    assert.equal(route.owned, true);
  }
});

test("an unknown slug and a malformed fragment both land on the answer", () => {
  // Slug-shaped, absent from the map, and not resolvable to anything on this
  // page. It resolves to the answer, which is what a cold load already shows.
  const unknown = parseScreenRoute("#workspace-retired-destination");
  assert.equal(unknown.slug, FALLBACK_SLUG);
  assert.equal(unknown.status, SCREEN_ROUTE_STATUS.foreign);
  assert.equal(unknown.requestedSlug, "#workspace-retired-destination");
  // …but it is not rewritten, because this router cannot prove it owns it: every
  // in-page deep link this page has ever shipped is also a fragment it does not
  // own, and correcting those away would break saved links.
  assert.equal(unknown.correct, false);
  assert.equal(unknown.owned, false);

  for (const input of ["nonsense", "department", 42, true, {}, [], "?dept=%E0%A4%A#workspace-departments"]) {
    const route = parseScreenRoute(input);
    assert.equal(route.status, SCREEN_ROUTE_STATUS.malformed,
      `${JSON.stringify(input)} was not read as malformed`);
    assert.equal(route.slug, FALLBACK_SLUG);
    assert.equal(route.correct, true, "a malformed address was left on the URL");
  }
});

test("a selection the destination does not accept falls back and is dropped", () => {
  const unknownId = parseScreenRoute(`?${SELECTION_PARAM}=not-a-department${DESTINATION_FRAGMENT[DEPARTMENT]}`);
  assert.equal(unknownId.status, SCREEN_ROUTE_STATUS.unsupportedSelection);
  assert.equal(unknownId.slug, FALLBACK_SLUG);
  assert.equal(unknownId.selection, null);
  assert.equal(unknownId.requestedSelection, "not-a-department");
  assert.equal(unknownId.correct, true);

  // A real department id at a destination that is not read per department is the
  // same answer: both address a reading this page cannot show.
  const wrongScreen = parseScreenRoute(
    `?${SELECTION_PARAM}=${SELECTIONS[0]}${DESTINATION_FRAGMENT[WORKSPACE_DESTINATION.evidence]}`);
  assert.equal(wrongScreen.status, SCREEN_ROUTE_STATUS.unsupportedSelection);
  assert.equal(wrongScreen.slug, FALLBACK_SLUG);

  // And a route object carrying one serializes without it rather than emitting
  // an address nothing can open.
  assert.equal(serializeScreenRoute({ slug: WORKSPACE_DESTINATION.evidence, selection: SELECTIONS[0] }),
    DESTINATION_FRAGMENT[WORKSPACE_DESTINATION.evidence]);
  assert.deepEqual(screenRoute({ slug: "invented", selection: SELECTIONS[0] }),
    { slug: FALLBACK_SLUG, selection: null });
});

test("the address keeps every parameter belonging to somebody else", () => {
  const location = {
    pathname: "/evolution.html",
    search: `?brief=AbC-123&${SELECTION_PARAM}=frontend&utm_source=slack`,
    hash: DESTINATION_FRAGMENT[DEPARTMENT],
  };
  const next = screenRouteAddress(location, { slug: DEPARTMENT, selection: "sre" });
  assert.equal(next,
    `/evolution.html?${SELECTION_PARAM}=sre&brief=AbC-123&utm_source=slack${DESTINATION_FRAGMENT[DEPARTMENT]}`);
  // Leaving the destination drops our parameter and touches nothing else.
  assert.equal(screenRouteAddress(location, { slug: WORKSPACE_DESTINATION.evidence }),
    `/evolution.html?brief=AbC-123&utm_source=slack${DESTINATION_FRAGMENT[WORKSPACE_DESTINATION.evidence]}`);
});

/* -------------------------------- the router ------------------------------- */

const split = (url) => {
  const cut = url.indexOf("#");
  const hash = cut >= 0 ? url.slice(cut) : "";
  const head = cut >= 0 ? url.slice(0, cut) : url;
  const mark = head.indexOf("?");
  return {
    pathname: mark >= 0 ? head.slice(0, mark) : head,
    search: mark >= 0 ? head.slice(mark) : "",
    hash,
  };
};

/**
 * A session history a test can walk, with a Location that moves with it.
 *
 * `pushState` does not fire `popstate` and `back` does, which is what a browser
 * does — a double that fired on the push would make a router that never listened
 * look like one that did.
 */
function fakeAddressBar(url = "/evolution.html") {
  const location = split(url);
  const stack = [url];
  const listeners = new Map();
  let index = 0;
  const go = (next) => Object.assign(location, split(next));
  const fire = (type) => { for (const handler of [...(listeners.get(type) ?? [])]) handler(); };
  const win = {
    location,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== handler));
    },
    back() {
      if (index === 0) return false;
      index -= 1; go(stack[index]); fire("popstate"); return true;
    },
    forward() {
      if (index >= stack.length - 1) return false;
      index += 1; go(stack[index]); fire("popstate"); return true;
    },
    get url() { return stack[index]; },
    get depth() { return stack.length; },
  };
  const history = {
    pushState(state, title, next) {
      stack.splice(index + 1); stack.push(next); index = stack.length - 1; go(next);
    },
    replaceState(state, title, next) { stack[index] = next; go(next); },
  };
  return {
    win, history, location,
    get url() { return win.url; },
    get depth() { return win.depth; },
  };
}

test("subscribe fires on the initial load and on every history move", () => {
  const bar = fakeAddressBar(`/evolution.html${DESTINATION_FRAGMENT[WORKSPACE_DESTINATION.evidence]}`);
  const router = createScreenRouter({ history: bar.history, location: bar.location, target: bar.win });
  const seen = [];
  const stop = router.subscribe((route) => seen.push(`${route.slug}/${route.selection ?? "-"}`));

  assert.deepEqual(seen, ["evidence/-"], "a cold load did not reach the listener");
  router.navigate({ slug: DEPARTMENT, selection: "backend" });
  assert.equal(bar.url, `/evolution.html?${SELECTION_PARAM}=backend${DESTINATION_FRAGMENT[DEPARTMENT]}`);
  assert.equal(bar.depth, 2, "one destination change wrote more than one history entry");

  // Navigating to the address already showing writes no entry, and still tells
  // the listener: "apply this route" is true whether or not the URL moved.
  assert.equal(router.navigate({ slug: DEPARTMENT, selection: "backend" }), false);
  assert.equal(bar.depth, 2);

  bar.win.back();
  assert.deepEqual(seen, ["evidence/-", "department/backend", "department/backend", "evidence/-"]);
  assert.equal(router.current().slug, WORKSPACE_DESTINATION.evidence);

  stop();
  bar.win.forward();
  assert.equal(seen.length, 4, "an unsubscribed listener was still called");
  router.dispose();
});

test("a route the router owns and cannot read is corrected off the URL on load", () => {
  const bad = `/evolution.html?brief=keep-me&${SELECTION_PARAM}=not-a-department${DESTINATION_FRAGMENT[DEPARTMENT]}`;
  const bar = fakeAddressBar(bad);
  const router = createScreenRouter({ history: bar.history, location: bar.location, target: bar.win });

  assert.equal(router.current().slug, FALLBACK_SLUG);
  assert.equal(router.current().correctedFrom, SCREEN_ROUTE_STATUS.unsupportedSelection);
  // Replaced, not pushed: back must not walk into the address that failed.
  assert.equal(bar.depth, 1);
  assert.equal(bar.url,
    `/evolution.html?brief=keep-me${DESTINATION_FRAGMENT[FALLBACK_SLUG]}`,
    "the correction dropped a parameter belonging to somebody else");

  // And a reload of the corrected address does not re-trigger the fallback.
  const again = createScreenRouter({ history: bar.history, location: bar.location, target: bar.win });
  assert.equal(again.current().status, SCREEN_ROUTE_STATUS.ok);
  assert.equal(again.current().correct, false);
  router.dispose();
  again.dispose();
});

/* ------------------------------- on the page ------------------------------- */

/**
 * The ranked department choices, painted the way `renderDecisionSurface` paints
 * them: one pressed, the rest not, and each one writing its selection back
 * through the router. Painted by the test because the shipped list comes from a
 * fixture that resolves long after boot — which is the case the route has to
 * survive, not one to work around.
 */
function paintDepartments(document, router, ids = SELECTIONS) {
  const list = document.getElementById(SELECTION_LIST_ID);
  list.replaceChildren();
  ids.forEach((id, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.departmentId = id;
    button.setAttribute("aria-pressed", String(index === 0));
    button.textContent = id;
    button.addEventListener("click", () => {
      for (const peer of list.querySelectorAll("button")) {
        peer.setAttribute("aria-pressed", String(peer === button));
      }
      router?.navigate({ slug: DEPARTMENT, selection: id });
    });
    item.append(button);
    list.append(item);
  });
  return list;
}

const pressed = (document) => document.getElementById(SELECTION_LIST_ID)
  .querySelectorAll("[data-department-id]")
  .filter((node) => node.getAttribute("aria-pressed") === "true")
  .map((node) => node.dataset.departmentId);

/** The shell and the router on one address bar, exactly as the page wires them. */
function opened(url) {
  const document = parseHtml(html);
  const bar = fakeAddressBar(url);
  initWorkspaceShell(document, {
    win: bar.win, loaded, history: bar.history, location: bar.location,
  });
  const router = createScreenRouter({
    history: bar.history, location: bar.location, target: bar.win,
  });
  router.subscribe((route) => applyScreenRoute(document, route));
  return { document, bar, router };
}

test("a department deep link opens that destination with that department selected", () => {
  const url = `/evolution.html?${SELECTION_PARAM}=security${DESTINATION_FRAGMENT[DEPARTMENT]}`;
  const { document, bar, router } = opened(url);

  assert.deepEqual([...activeKeys(document)], [DEPARTMENT], "the deep link did not open its destination");
  assert.equal(currentWorkspaceDestination(document), DEPARTMENT);
  assert.equal(document.getElementById("finops-workspace-screen")
    .getAttribute("data-screen-selection"), "security");
  assert.equal(bar.url, url, "the address was rewritten under a link that was fine");

  // The ranked list arrives late, so the selection is applied when it does. The
  // first choice is pressed by the paint; the route corrects it.
  paintDepartments(document, router);
  assert.deepEqual(pressed(document), [SELECTIONS[0]]);
  const applied = applyScreenRoute(document, router.current());
  assert.equal(applied.selectionApplied, true);
  assert.deepEqual(pressed(document), ["security"], "the addressed department was not selected");

  // Out to the answer — a cold deep link has nothing behind it, so the step back
  // this asserts is the one the reader can actually take.
  router.navigate({ slug: WORKSPACE_DESTINATION.answer });
  assert.deepEqual([...activeKeys(document)], [WORKSPACE_DESTINATION.answer],
    "leaving the deep link did not restore the answer");
  assert.equal(document.getElementById("finops-workspace-screen")
    .getAttribute("data-screen-selection"), null,
    "the selection outlived the destination it belonged to");

  // …and back into it: the destination AND the department both come back, which
  // is the whole of what the address was carrying.
  bar.win.back();
  assert.equal(bar.url, url);
  assert.deepEqual([...activeKeys(document)], [DEPARTMENT], "stepping back lost the destination");
  assert.deepEqual(pressed(document), ["security"], "stepping back lost the department");
  router.dispose();
});

test("choosing a department writes it to the address, and back walks the choices", () => {
  const { document, bar, router } = opened(`/evolution.html${DESTINATION_FRAGMENT[DEPARTMENT]}`);
  const list = paintDepartments(document, router);

  const choose = (id) => list.querySelectorAll("[data-department-id]")
    .find((node) => node.dataset.departmentId === id).click();

  choose("frontend");
  assert.equal(bar.url, `/evolution.html?${SELECTION_PARAM}=frontend${DESTINATION_FRAGMENT[DEPARTMENT]}`);
  choose("sre");
  assert.equal(bar.url, `/evolution.html?${SELECTION_PARAM}=sre${DESTINATION_FRAGMENT[DEPARTMENT]}`);
  assert.deepEqual(pressed(document), ["sre"]);
  assert.equal(bar.depth, 3, "two choices wrote more than two history entries");

  bar.win.back();
  assert.equal(router.current().selection, "frontend");
  assert.deepEqual(pressed(document), ["frontend"], "back did not restore the department on screen");
  bar.win.forward();
  assert.deepEqual(pressed(document), ["sre"], "forward did not restore the department on screen");
  router.dispose();
});

test("walking destinations restores the view and leaves the durable state alone", () => {
  const { document, bar, router } = opened("/evolution.html");

  // The two things the FinOps persistence layer owns, as they stand before the
  // walk. A destination change is a view switch; these must survive it.
  const stand = document.getElementById("finops-stand").textContent;
  const portfolio = document.getElementById("disclosure-savings-portfolio");
  portfolio.setAttribute("data-committed-action", "signed-2026-08");

  const walk = [
    WORKSPACE_DESTINATION.evidence,
    DEPARTMENT,
    WORKSPACE_DESTINATION.actAndVerify,
  ];

  // …and the store itself refuses to be touched for the whole walk, so a router
  // that reached for it fails here rather than passing quietly.
  const owned = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const refuse = () => { throw new Error("the route touched the FinOps store"); };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: refuse, setItem: refuse, removeItem: refuse, clear: refuse },
  });
  try {
    for (const slug of walk) router.navigate({ slug });
    assert.deepEqual([...activeKeys(document)], [WORKSPACE_DESTINATION.actAndVerify]);

    bar.win.back();
    assert.deepEqual([...activeKeys(document)], [DEPARTMENT], "back did not restore the department screen");
    bar.win.back();
    assert.deepEqual([...activeKeys(document)], [WORKSPACE_DESTINATION.evidence], "back did not restore evidence");
    bar.win.forward();
    assert.deepEqual([...activeKeys(document)], [DEPARTMENT], "forward did not restore the department screen");
    bar.win.back();
    bar.win.back();
    assert.deepEqual([...activeKeys(document)], [WORKSPACE_DESTINATION.answer],
      "walking all the way back did not restore the answer");
  } finally {
    if (owned) Object.defineProperty(globalThis, "localStorage", owned);
    else delete globalThis.localStorage;
  }

  assert.equal(document.getElementById("finops-stand").textContent, stand,
    "moving between destinations rewrote the earned grade");
  assert.equal(portfolio.getAttribute("data-committed-action"), "signed-2026-08",
    "moving between destinations reset the committed-action state");
  router.dispose();
});

test("an address this router does not own leaves the destination to whoever does", () => {
  // A deep link into a panel, which the shell resolves and this router must not
  // rewrite: every saved link on this page is one of these.
  const { document, bar, router } = opened("/evolution.html#recommendation-evidence");

  assert.equal(router.current().status, SCREEN_ROUTE_STATUS.foreign);
  assert.equal(router.current().owned, false);
  assert.equal(bar.url, "/evolution.html#recommendation-evidence",
    "a deep link somebody saved was rewritten off the address bar");
  assert.deepEqual([...activeKeys(document)], [WORKSPACE_DESTINATION.evidence],
    "the router overrode the destination the fragment actually resolves to");
  router.dispose();
});
