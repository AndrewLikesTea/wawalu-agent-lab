// The address applied to /evolution.html: which door is current, what a stale
// link says, and what the back button does.
//
// Driven against the real document with a History and a Location double. The
// doubles are not a shortcut — the harness has no History at all — but they are
// honest ones: `pushState` appends, `back()` pops and fires `popstate`, and the
// location they write is re-parsed by the shipped parser rather than by the
// test's idea of one.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  applyDestinationRoute, installDestinationRouting, routeAddress, ROUTE_MESSAGE_ID,
} from "../src/destination-route-view.js";
import { parseDestinationRoute, ROUTE_STATUS } from "../src/destination-route.js";
import { FINOPS_DESTINATIONS } from "../src/finops-destinations.js";
import { parseHtml, textOf } from "./support/browser.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const page = await read("src/evolution.html");

const IN_PAGE = FINOPS_DESTINATIONS.find((entry) => entry.href.startsWith("#"));
const AWAY = FINOPS_DESTINATIONS.find((entry) => !entry.href.startsWith("#"));

/**
 * A Location and a History that behave the way a browser's pair does: the
 * history owns the stack, the location is a view of its top entry, and
 * `popstate` is dispatched at the injected target.
 */
function browserDouble(initialSearch = "") {
  const listeners = new Map();
  const target = {
    addEventListener: (type, handler) => {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    emit: (type) => { for (const handler of listeners.get(type) ?? []) handler({ type }); },
  };
  const location = { pathname: "/evolution.html", search: initialSearch, hash: "" };
  const write = (url) => {
    const query = url.indexOf("?");
    location.search = query < 0 ? "" : url.slice(query);
    location.pathname = query < 0 ? url : url.slice(0, query);
  };
  const stack = [`${location.pathname}${location.search}`];
  const history = {
    pushState: (state, _title, url) => { stack.push(url); write(url); },
    replaceState: (state, _title, url) => { stack[stack.length - 1] = url; write(url); },
    back: () => {
      if (stack.length < 2) return false;
      stack.pop();
      write(stack[stack.length - 1]);
      target.emit("popstate");
      return true;
    },
    get length() { return stack.length; },
    get entries() { return [...stack]; },
  };
  return { location, history, target };
}

const doorFor = (document, slug) =>
  [...document.getElementById("finops-front-door-list")
    .querySelectorAll("[data-front-door-slug]")]
    .find((node) => node.dataset?.frontDoorSlug === slug);

const currentSlugs = (document) =>
  [...document.getElementById("finops-front-door-list")
    .querySelectorAll("[data-front-door-slug]")]
    .filter((node) => node.getAttribute("aria-current") === "true")
    .map((node) => node.dataset.frontDoorSlug);

// ---------------------------------------------------------------------------
// Opening the named destination
// ---------------------------------------------------------------------------

test("an address naming a destination marks that door and no other", () => {
  const document = parseHtml(page);
  const applied = applyDestinationRoute(document,
    parseDestinationRoute(`?destination=${AWAY.slug}`));
  assert.equal(applied.status, ROUTE_STATUS.ok);
  assert.equal(applied.slug, AWAY.slug);
  assert.equal(applied.marked, 1, "exactly one door is current");
  assert.deepEqual(currentSlugs(document), [AWAY.slug]);
  assert.equal(doorFor(document, AWAY.slug).getAttribute("data-front-door-active"), "true");
  for (const other of FINOPS_DESTINATIONS.filter((entry) => entry.slug !== AWAY.slug)) {
    assert.equal(doorFor(document, other.slug).getAttribute("data-front-door-active"), "false");
    assert.equal(doorFor(document, other.slug).getAttribute("aria-current"), null,
      "aria-current=false announces nothing and is not written");
  }
  // The door is still the anchor the document shipped: routing never rewrites
  // where a destination goes.
  assert.equal(doorFor(document, AWAY.slug).getAttribute("href"), AWAY.href);
});

test("an ordinary open marks nothing and says nothing", () => {
  const document = parseHtml(page);
  const applied = applyDestinationRoute(document, parseDestinationRoute(""));
  assert.equal(applied.status, ROUTE_STATUS.absent);
  assert.equal(applied.marked, 0);
  assert.equal(applied.message, "");
  assert.equal(document.getElementById(ROUTE_MESSAGE_ID).getAttribute("hidden"), "",
    "the message paragraph exists but is hidden");
});

test("a scope and a department the address carried are recorded on the region", () => {
  const document = parseHtml(page);
  const open = FINOPS_DESTINATIONS.find((entry) => entry.route.departments.length > 0);
  applyDestinationRoute(document, parseDestinationRoute(
    `?destination=${open.slug}&scope=${open.route.scopes[0]}&department=${open.route.departments[0]}`));
  const region = document.getElementById("finops-front-door");
  assert.equal(region.getAttribute("data-route-scope"), open.route.scopes[0]);
  assert.equal(region.getAttribute("data-route-department"), open.route.departments[0]);

  // And they are cleared when the reader moves to a destination that carries
  // neither, rather than left behind describing somewhere else.
  const closed = FINOPS_DESTINATIONS.find((entry) => entry.route.scopes.length === 0);
  applyDestinationRoute(document, parseDestinationRoute(`?destination=${closed.slug}`));
  assert.equal(region.getAttribute("data-route-scope"), null);
  assert.equal(region.getAttribute("data-route-department"), null);
});

// ---------------------------------------------------------------------------
// The failure state
// ---------------------------------------------------------------------------

test("a stale slug lands on the front door with a sentence naming it", () => {
  const document = parseHtml(page);
  const { location, history, target } = browserDouble("?destination=retired-door");
  installDestinationRouting(document, { location, history, target });

  const message = document.getElementById(ROUTE_MESSAGE_ID);
  assert.match(textOf(message), /retired-door/, "the reader is told what they asked for");
  assert.match(textOf(message), /no longer exists/);
  assert.equal(message.getAttribute("data-route-status"), ROUTE_STATUS.unknown);
  assert.equal(message.getAttribute("hidden"), null, "and it is visible");

  // The front door itself is untouched: three doors, still operable.
  const doors = [...document.getElementById("finops-front-door-list")
    .querySelectorAll("[data-front-door-slug]")];
  assert.equal(doors.length, FINOPS_DESTINATIONS.length);
  assert.deepEqual(currentSlugs(document), [], "no door is current");

  // The address is normalized, so a reload is a clean front door and not a
  // second showing of the same message.
  assert.equal(location.search, "");
  assert.equal(history.length, 1, "normalizing replaces; it does not push");
  assert.equal(parseDestinationRoute(location).status, ROUTE_STATUS.absent);
});

test("a slug carrying markup is rendered as text and never as markup", () => {
  const document = parseHtml(page);
  const hostile = "%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E";
  applyDestinationRoute(document, parseDestinationRoute(`?destination=${hostile}`));
  const message = document.getElementById(ROUTE_MESSAGE_ID);
  assert.match(textOf(message), /img src=x onerror=alert\(1\)/,
    "the requested text is quoted back verbatim as text");
  assert.equal(message.children.length, 1,
    "and it produced exactly one text node, not an element");
});

test("a successful selection clears a message an earlier failure left", () => {
  const document = parseHtml(page);
  applyDestinationRoute(document, parseDestinationRoute("?destination=retired-door"));
  assert.notEqual(textOf(document.getElementById(ROUTE_MESSAGE_ID)), "");
  applyDestinationRoute(document, parseDestinationRoute(`?destination=${AWAY.slug}`));
  assert.equal(textOf(document.getElementById(ROUTE_MESSAGE_ID)), "");
  assert.equal(document.getElementById(ROUTE_MESSAGE_ID).getAttribute("hidden"), "");
});

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

test("changing the destination twice and going back lands on the first", () => {
  const document = parseHtml(page);
  const [first, second] = FINOPS_DESTINATIONS;
  const { location, history, target } = browserDouble("");
  const routing = installDestinationRouting(document, { location, history, target });

  routing.select({ slug: first.slug });
  assert.equal(location.search, `?destination=${first.slug}`);
  routing.select({ slug: second.slug });
  assert.equal(location.search, `?destination=${second.slug}`);
  assert.deepEqual(currentSlugs(document), [second.slug]);
  assert.equal(history.length, 3, "one entry per destination change, and no more");

  assert.equal(history.back(), true);
  assert.equal(location.search, `?destination=${first.slug}`);
  assert.deepEqual(currentSlugs(document), [first.slug],
    "popstate re-applies the route the address now names");
  assert.equal(history.length, 2, "restoring state must not itself push an entry");
});

test("selecting the destination already showing pushes nothing", () => {
  const document = parseHtml(page);
  const { location, history, target } = browserDouble(`?destination=${AWAY.slug}`);
  const routing = installDestinationRouting(document, { location, history, target });
  const before = history.length;
  routing.select({ slug: AWAY.slug });
  routing.select({ slug: AWAY.slug });
  assert.equal(history.length, before,
    "an identical address is what makes back appear to unwind scroll");
});

test("a qualifier the destination cannot carry never reaches the address", () => {
  const document = parseHtml(page);
  const closed = FINOPS_DESTINATIONS.find((entry) => entry.route.scopes.length === 0);
  const { location, history, target } = browserDouble("");
  const routing = installDestinationRouting(document, { location, history, target });
  routing.select({ slug: closed.slug, scope: "month", department: "backend" });
  assert.equal(location.search, `?destination=${closed.slug}`);
  assert.equal(parseDestinationRoute(location).scope, null);
});

test("an in-page door is routed rather than followed", () => {
  const document = parseHtml(page);
  const { location, history, target } = browserDouble("");
  installDestinationRouting(document, { location, history, target });
  doorFor(document, IN_PAGE.slug).click();
  assert.equal(location.search, `?destination=${IN_PAGE.slug}`,
    "the destination is on the query, not a bare fragment on the hash");
  assert.equal(location.hash, "", "the hash is left for the shared brief that already owns it");
  assert.deepEqual(currentSlugs(document), [IN_PAGE.slug]);
});

test("the address a route resolves to keeps the hash and the foreign query", () => {
  const location = {
    pathname: "/evolution.html", search: "?utm_source=slack", hash: "#brief=abc",
  };
  const route = parseDestinationRoute(`?destination=${AWAY.slug}`);
  assert.equal(routeAddress(location, route),
    `/evolution.html?destination=${AWAY.slug}&utm_source=slack#brief=abc`);
});
