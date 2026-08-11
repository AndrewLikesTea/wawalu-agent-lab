// Every legacy FinOps department anchor still lands a reader on the answer.
//
// WHY THIS FILE EXISTS
// --------------------
// #1613 moved the per-department answer off /evolution.html onto its own screen
// at /departments.html. The anchors it moved away from did not go anywhere: the
// seven region ids the department destination owns are addresses that saved
// links, shared URLs and this repository's own contracts already carry, and the
// screen contract says so out loud — "renaming it would move a fragment already
// in address bars". So the ids stay, and each one carries a visible link that
// states the move and forwards the department.
//
// A pointer is only worth anything if its destination is real. This file walks
// the whole promise on the tree that ships: the anchor id is in the document,
// the pointer beside it is an ordinary link rather than a script or a hidden
// node, the page it names exists, the slug on its query string is one the
// destination declares AND one the bundled dataset actually holds, and the
// department screen's own parser reads that slug back out. Rename the page,
// rename a slug, drop a region id, or turn a pointer into a redirect, and one
// of these fails by name.
//
// IT NEVER FETCHES AND IT NEVER SKIPS. Filesystem, string matching, and the
// shipped modules imported directly: no network, no credential, no live
// integration, no customer data, and no browser harness. `npm test` runs it
// against `src` for fast feedback; `npm run test:e2e:production` sets
// SHIPLOG_E2E_BUILD_ROOT=dist and runs the same assertions against the
// deployable tree, which is the run that decides whether the artifact a reader
// receives keeps the promise.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const BUILD_ROOT = process.env.SHIPLOG_E2E_BUILD_ROOT || "src";
const artifact = (path) => new URL(`../${BUILD_ROOT}/${path}`, import.meta.url);

const readArtifact = (path) => readFile(artifact(path), "utf8");
const isFile = async (path) => {
  try {
    return (await stat(artifact(path))).isFile();
  } catch {
    return false;
  }
};

// The registries, imported from the build root rather than from `src`, so a
// module that is renamed or dropped by the build fails here instead of passing
// against a copy that is not the one being served.
const { destinationRegions, destinationSelections } =
  await import(artifact("finops-destination-regions.js"));
const { DEPARTMENT_SCREEN_PATH, departmentScreenHref, departmentSlugFrom } =
  await import(artifact("department-screen.js"));
const { DESTINATION_FRAGMENT } = await import(artifact("finops-workspace-nav.js"));

const evolutionHtml = await readArtifact("evolution.html");
const departmentsHtml = await readArtifact("departments.html");
const dataset = JSON.parse(await readArtifact("evolution-demo-data.json"));

/** The anchors under test, read from the module that declares them. */
const LEGACY_ANCHORS = destinationRegions("department")?.regionIds ?? [];

/** The slugs an address is allowed to carry at that destination. */
const DECLARED_SLUGS = destinationSelections("department");

const idsIn = (html) => new Set(
  [...html.matchAll(/\sid="([^"]+)"/g)].map(([, value]) => value));

/**
 * The one pointer authored for an anchor, as its raw opening tag.
 *
 * Matched on the marker attribute rather than by walking the markup, because
 * the element children of the main content are a declared spine: the pointer is
 * visible copy INSIDE its region, not a loose node between two of them, and the
 * placement test below is what holds it there.
 */
function pointerTagFor(anchorId) {
  const pattern = new RegExp(
    `<([a-z]+)([^>]*\\sdata-department-screen-pointer="${anchorId}"[^>]*)>`, "g");
  const found = [...evolutionHtml.matchAll(pattern)];
  assert.equal(found.length, 1,
    `exactly one pointer must be authored for the legacy anchor #${anchorId}`);
  const [, tagName, attributes] = found[0];
  return { tagName, attributes };
}

const attribute = (attributes, name) =>
  attributes.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;

test("the legacy department anchor inventory is the one the page declares", () => {
  // Seven regions, named here as well as read above, so a region silently
  // leaving the declaration is a failure rather than a smaller loop that still
  // passes. This list is the inventory the pointers below are held to.
  assert.deepEqual([...LEGACY_ANCHORS], [
    "destination-load-department",
    "finops-guided-department",
    "department-evidence",
    "department-fix-pack",
    "monthly-department-decision",
    "disclosure-department-priority",
    "disclosure-spend-mix",
  ]);
  assert.deepEqual([...DECLARED_SLUGS],
    ["data-ml", "backend", "frontend", "sre", "mobile", "quality", "security"]);
});

test("every legacy department anchor id is still in the served document", () => {
  const ids = idsIn(evolutionHtml);
  for (const anchorId of LEGACY_ANCHORS) {
    assert.ok(ids.has(anchorId),
      `#${anchorId} is an address already in circulation and must stay in evolution.html`);
  }
});

test("every legacy department anchor carries a real, visible link out", () => {
  for (const anchorId of LEGACY_ANCHORS) {
    const { tagName, attributes } = pointerTagFor(anchorId);
    // An ordinary anchor with an href: in the tab order by construction, and
    // reachable without a script. A button, a span with a listener, or a
    // meta-refresh would all read the same in a diff and none of them is a link.
    assert.equal(tagName, "a", `the pointer at #${anchorId} must be an anchor element`);
    assert.match(attributes, /\shref="\//,
      `the pointer at #${anchorId} must forward through its href, not through a script`);
    // Visible, and announced to everybody: a pointer that is hidden from the
    // page or hidden from assistive technology is not a pointer.
    assert.doesNotMatch(attributes, /\shidden(\s|=|$)/,
      `the pointer at #${anchorId} must not be hidden`);
    assert.doesNotMatch(attributes, /\saria-hidden="true"/,
      `the pointer at #${anchorId} must not be hidden from assistive technology`);
    assert.doesNotMatch(attributes, /\sclass="[^"]*visually-hidden/,
      `the pointer at #${anchorId} must be visible, not announced only`);
    assert.doesNotMatch(attributes, /\stabindex="-1"/,
      `the pointer at #${anchorId} must stay in the tab order`);
  }
});

test("every legacy department pointer is authored inside the anchor it forwards from", () => {
  // Inside, and near the top of, the region it belongs to. A pointer authored
  // between two regions would be an undeclared top-level region — the answer
  // spine audit in tests/finops-page-structure.test.js fails that — and a
  // pointer parked at the far end of a long region is one the reader who
  // arrived at the anchor never sees.
  for (const anchorId of LEGACY_ANCHORS) {
    const opening = evolutionHtml.indexOf(`id="${anchorId}"`);
    const pointer = evolutionHtml.indexOf(`data-department-screen-pointer="${anchorId}"`);
    assert.ok(opening >= 0 && pointer > opening,
      `the pointer for #${anchorId} must be authored inside that region`);
    assert.ok(pointer - opening < 1024,
      `the pointer for #${anchorId} must sit at the head of that region, not buried in it`);
  }
});

test("every legacy department pointer states the move in its own words", () => {
  for (const anchorId of LEGACY_ANCHORS) {
    const text = evolutionHtml
      .match(new RegExp(`data-department-screen-pointer="${anchorId}"[^>]*>([^<]+)<`))?.[1] ?? "";
    assert.match(text, /moved/,
      `the link text at #${anchorId} must say the destination moved`);
    assert.match(text, /screen/,
      `the link text at #${anchorId} must name where it moved to`);
  }
});

test("every legacy department pointer resolves on the built tree", async () => {
  assert.ok(await isFile("departments.html"),
    "the department screen the pointers name must exist in the build output");
  const departmentIds = new Set(dataset.departments.map((entry) => entry.id));

  for (const anchorId of LEGACY_ANCHORS) {
    const href = attribute(pointerTagFor(anchorId).attributes, "href");
    const [path, query] = href.split("?");

    // The page. Named by the module that owns the screen, so moving the screen
    // and forgetting a pointer cannot pass here.
    assert.equal(path, DEPARTMENT_SCREEN_PATH,
      `the pointer at #${anchorId} must name the department screen`);
    assert.ok(await isFile(path.replace(/^\//, "")),
      `the pointer at #${anchorId} must land on a page the build actually ships`);

    // The slug. Read back with the screen's OWN parser rather than with a
    // second copy of the rule, then checked against both authorities: the
    // destination's declaration of what an address may carry, and the dataset
    // the screen reads its figures out of.
    const slug = departmentSlugFrom(query);
    assert.ok(slug, `the pointer at #${anchorId} must carry a department`);
    assert.ok(DECLARED_SLUGS.includes(slug),
      `#${anchorId} forwards "${slug}", which this destination does not declare`);
    assert.ok(departmentIds.has(slug),
      `#${anchorId} forwards "${slug}", which the bundled analysis does not hold`);
    assert.equal(href, departmentScreenHref(slug),
      `the pointer at #${anchorId} must be the address the screen composes`);
  }
});

test("the department screen's way back resolves on the built tree", () => {
  // The other half of the round trip. A forward that lands on a screen whose
  // only door is broken has moved the dead end rather than removed it.
  const ids = idsIn(evolutionHtml);
  const scriptOwned = new Set(
    Object.values(DESTINATION_FRAGMENT).map((fragment) => fragment.slice(1)));
  const back = [...departmentsHtml.matchAll(/href="\/evolution\.html([^"]*)"/g)]
    .map(([, tail]) => tail);

  assert.ok(back.length > 0, "the department screen must keep a way back");
  for (const tail of back) {
    const fragment = tail.includes("#") ? tail.slice(tail.indexOf("#") + 1) : "";
    if (fragment === "") continue;
    assert.ok(ids.has(fragment) || scriptOwned.has(fragment),
      `the way back names #${fragment}, which /evolution.html does not answer to`);
  }
});
