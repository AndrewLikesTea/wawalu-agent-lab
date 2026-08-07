// A destination on /evolution.html is an address.
//
// The parser and the serializer are exercised as pure functions over EVERY slug
// the registry holds — iterated, never listed here, because a parallel list is
// exactly the drift #1326 was written to prevent. The document-facing half is
// driven through a History double rather than the DOM harness wherever it can
// be: the harness models no layout and reflects no properties, so an assertion
// about scroll or about `node.hidden` reflected to an attribute would be an
// assertion about the double.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DROP_REASON, FRONT_DOOR_QUERY, MAX_REQUESTED_SLUG_LENGTH, ROUTE_STATUS,
  canonicalQuery, isResolvedRoute, parseDestinationRoute, routeFailureMessage,
  serializeDestinationRoute,
} from "../src/destination-route.js";
import {
  FINOPS_DEPARTMENT_IDS, FINOPS_DESTINATIONS, FINOPS_SCOPES,
} from "../src/finops-destinations.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/** Every qualified address this registry can express, generated from it. */
function addressesFor(destination) {
  const scopes = destination.route.scopes;
  const departments = destination.route.departments;
  const combinations = [{ slug: destination.slug, scope: null, department: null }];
  for (const scope of scopes) {
    combinations.push({ slug: destination.slug, scope, department: null });
    for (const department of departments) {
      combinations.push({ slug: destination.slug, scope, department });
    }
  }
  for (const department of departments) {
    combinations.push({ slug: destination.slug, scope: null, department });
  }
  return combinations;
}

// ---------------------------------------------------------------------------
// The registry is the only list
// ---------------------------------------------------------------------------

test("every destination declares what an address for it may say", () => {
  for (const destination of FINOPS_DESTINATIONS) {
    assert.ok(destination.route, `${destination.slug} declares a route block`);
    assert.deepEqual(Object.keys(destination.route).sort(), ["departments", "scopes"],
      `${destination.slug} declares exactly the two qualifiers, even when empty`);
    for (const scope of destination.route.scopes) {
      assert.ok(FINOPS_SCOPES.includes(scope),
        `${destination.slug} may only carry a scope the page has`);
    }
    for (const id of destination.route.departments) {
      assert.ok(FINOPS_DEPARTMENT_IDS.includes(id),
        `${destination.slug} may only carry a department the seed holds`);
    }
  }
});

test("the registry's department ids are the ids the bundled seed actually carries", async () => {
  const seed = JSON.parse(await read("src/evolution-demo-data.json"));
  const ids = seed.departments.map((department) => department.id);
  assert.deepEqual([...FINOPS_DEPARTMENT_IDS], ids,
    "an addressable department the analysis does not hold is a link to an empty drill-down");
});

// ---------------------------------------------------------------------------
// Round trips, over the whole registry
// ---------------------------------------------------------------------------

test("parse → serialize → parse is stable for every registered address", () => {
  let checked = 0;
  for (const destination of FINOPS_DESTINATIONS) {
    for (const request of addressesFor(destination)) {
      const query = serializeDestinationRoute(request);
      const parsed = parseDestinationRoute(query);
      assert.equal(parsed.status, ROUTE_STATUS.ok, `${query} resolves`);
      assert.equal(parsed.slug, request.slug);
      assert.equal(parsed.scope, request.scope);
      assert.equal(parsed.department, request.department);
      assert.deepEqual([...parsed.droppedParams], [],
        `${query} drops nothing it was given`);

      // Idempotent: the second serialization is byte-identical to the first.
      assert.equal(serializeDestinationRoute(parsed), query);
      const again = parseDestinationRoute(serializeDestinationRoute(parsed));
      assert.deepEqual(
        { s: again.slug, c: again.scope, d: again.department },
        { s: parsed.slug, c: parsed.scope, d: parsed.department });
      checked += 1;
    }
  }
  assert.ok(checked >= FINOPS_DESTINATIONS.length,
    "at least one address per registered destination was round-tripped");
});

test("a URL, a location, a query string and a hash string all parse the same", () => {
  const slug = FINOPS_DESTINATIONS[0].slug;
  const expected = { status: ROUTE_STATUS.ok, slug };
  for (const input of [
    new URL(`https://labs.wawalu.org/evolution.html?destination=${slug}`),
    { search: `?destination=${slug}`, pathname: "/evolution.html" },
    `?destination=${slug}`,
    `destination=${slug}`,
    `#destination=${slug}`,
    `https://labs.wawalu.org/evolution.html?destination=${slug}#finops-stand`,
  ]) {
    const parsed = parseDestinationRoute(input);
    assert.equal(parsed.status, expected.status, `${input} resolves`);
    assert.equal(parsed.slug, expected.slug);
  }
});

// ---------------------------------------------------------------------------
// The failure statuses
// ---------------------------------------------------------------------------

test("no destination parameter is an ordinary open, not an error", () => {
  for (const input of ["", "?", { search: "" }, null, undefined, "?brief=abc"]) {
    const parsed = parseDestinationRoute(input);
    assert.equal(parsed.status, ROUTE_STATUS.absent, `${JSON.stringify(input)} is absent`);
    assert.equal(parsed.slug, null);
    assert.equal(routeFailureMessage(parsed), "",
      "an ordinary open says nothing about destinations nobody asked for");
    assert.equal(serializeDestinationRoute(parsed), FRONT_DOOR_QUERY);
  }
});

test("a syntactically fine slug the registry does not hold is unknown", () => {
  const parsed = parseDestinationRoute("?destination=retired-door&scope=month");
  assert.equal(parsed.status, ROUTE_STATUS.unknown);
  assert.equal(parsed.requestedSlug, "retired-door");
  assert.equal(parsed.slug, null, "an unknown slug never resolves to a destination");
  assert.deepEqual(parsed.droppedParams.map((drop) => [drop.name, drop.reason]),
    [["scope", DROP_REASON.unresolvedDestination]]);
  assert.equal(isResolvedRoute(parsed), false);
  assert.match(routeFailureMessage(parsed), /retired-door/,
    "the message names what was asked for");
  assert.match(routeFailureMessage(parsed), /no longer exists/);
  assert.equal(serializeDestinationRoute(parsed), FRONT_DOOR_QUERY,
    "an unknown slug serializes to the front door, not to an address nothing opens");
});

test("an empty, badly encoded or non-slug destination is malformed and never throws", () => {
  const cases = [
    ["?destination=", ""],
    ["?destination=%E0%A4%A", "%E0%A4%A"],
    ["?destination=../../etc/passwd", "../../etc/passwd"],
    ["?destination=Spend Attribution", "Spend Attribution"],
    ["?destination=<script>", "<script>"],
  ];
  for (const [input, requested] of cases) {
    const parsed = parseDestinationRoute(input);
    assert.equal(parsed.status, ROUTE_STATUS.malformed, `${input} is malformed`);
    assert.equal(parsed.requestedSlug, requested);
    assert.equal(parsed.slug, null);
    assert.equal(serializeDestinationRoute(parsed), FRONT_DOOR_QUERY);
    assert.ok(routeFailureMessage(parsed).length > 0, "the reader is told something");
  }
  // A structure that is not an address at all.
  for (const input of ["nonsense", 42, true, {}]) {
    assert.equal(parseDestinationRoute(input).status, ROUTE_STATUS.malformed);
  }
});

test("a requested slug is bounded before it can reach a sentence", () => {
  const parsed = parseDestinationRoute(`?destination=${"a".repeat(4000)}`);
  assert.equal(parsed.status, ROUTE_STATUS.unknown);
  assert.equal(parsed.requestedSlug.length, MAX_REQUESTED_SLUG_LENGTH);
  assert.ok(routeFailureMessage(parsed).length < 400,
    "a kilobyte of URL is still one sentence a person can read");
});

// ---------------------------------------------------------------------------
// Qualifiers the destination does not carry
// ---------------------------------------------------------------------------

test("a scope this destination does not support is dropped and reported", () => {
  const closed = FINOPS_DESTINATIONS.find((entry) => entry.route.scopes.length === 0);
  assert.ok(closed, "the registry has a destination that carries no scope");
  const parsed = parseDestinationRoute(`?destination=${closed.slug}&scope=month`);
  assert.equal(parsed.status, ROUTE_STATUS.ok, "the destination still resolves");
  assert.equal(parsed.scope, null, "the junk value does not survive");
  assert.deepEqual(parsed.droppedParams.map((drop) => [drop.name, drop.value, drop.reason]),
    [["scope", "month", DROP_REASON.notCarried]]);
  assert.equal(serializeDestinationRoute(parsed), `?destination=${closed.slug}`,
    "and it is not written back onto the address");
});

test("an unsupported value for a qualifier the destination does carry is dropped", () => {
  const open = FINOPS_DESTINATIONS.find((entry) => entry.route.departments.length > 0);
  assert.ok(open, "the registry has a destination read per department");
  const parsed = parseDestinationRoute(
    `?destination=${open.slug}&department=legal&scope=fortnight`);
  assert.equal(parsed.status, ROUTE_STATUS.ok);
  assert.equal(parsed.department, null);
  assert.equal(parsed.scope, null);
  assert.deepEqual(parsed.droppedParams.map((drop) => [drop.name, drop.reason]).sort(),
    [["department", DROP_REASON.notSupported], ["scope", DROP_REASON.notSupported]]);
});

test("a broken escape on a qualifier costs the qualifier, not the destination", () => {
  const open = FINOPS_DESTINATIONS.find((entry) => entry.route.departments.length > 0);
  const parsed = parseDestinationRoute(`?destination=${open.slug}&department=%E0%A4%A`);
  assert.equal(parsed.status, ROUTE_STATUS.ok, "the reader still lands somewhere real");
  assert.equal(parsed.department, null);
  assert.deepEqual(parsed.droppedParams.map((drop) => drop.reason),
    [DROP_REASON.malformedValue]);
});

test("values are percent-encoded exactly once and decoded exactly once", () => {
  const open = FINOPS_DESTINATIONS.find((entry) => entry.route.departments.includes("data-ml"));
  assert.ok(open);
  const query = serializeDestinationRoute({ slug: open.slug, department: "data-ml" });
  assert.equal(query, `?destination=${open.slug}&department=data-ml`);
  // A pre-encoded value must not double-encode on the way back out.
  const parsed = parseDestinationRoute(`?destination=${open.slug}&department=data%2Dml`);
  assert.equal(parsed.department, "data-ml");
  assert.equal(serializeDestinationRoute(parsed), query);
});

test("a repeated parameter is not a second opinion — the first wins", () => {
  const [first, second] = FINOPS_DESTINATIONS;
  const parsed = parseDestinationRoute(
    `?destination=${first.slug}&destination=${second.slug}`);
  assert.equal(parsed.slug, first.slug);
});

// ---------------------------------------------------------------------------
// Foreign parameters on the same address
// ---------------------------------------------------------------------------

test("normalizing an address keeps parameters that belong to somebody else", () => {
  const slug = FINOPS_DESTINATIONS[0].slug;
  const search = `?utm_source=slack&destination=${slug}&scope=month&stray=1`;
  const parsed = parseDestinationRoute(search);
  assert.equal(canonicalQuery(search, parsed),
    `?destination=${slug}&scope=month&utm_source=slack&stray=1`);

  // A route that did not resolve leaves the foreign half of the address intact.
  const gone = parseDestinationRoute("?destination=retired-door&utm_source=slack");
  assert.equal(canonicalQuery("?destination=retired-door&utm_source=slack", gone),
    "?utm_source=slack");
  assert.equal(canonicalQuery("?destination=retired-door", gone), FRONT_DOOR_QUERY);
});
