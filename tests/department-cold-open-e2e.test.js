// A forwarded department link, opened cold, end to end.
//
// THE FLOW UNDER TEST. A CTO pastes `/departments.html?department=…` into a tab
// that has never been to this site — no prior session, no stored state, nothing
// warmed by a visit to the organization-wide answer first. That reader has to
// get: the answer settled rather than the reading sentence; the SAME verdict and
// confidence the organization-wide review states for that department and month;
// the provider export and the HRIS source the figure rests on; a named,
// inspectable dead end if the link points at a department this analysis does not
// hold; and — for the links forwarded before the screen moved (#1613/#1614) —
// the same destination the legacy anchor promises.
//
// WHY IT IS ONE FILE. Those five properties shipped in four separate changes,
// each with its own unit coverage. Nothing until now walked them in ONE cold
// session, in the order a forwarded reader meets them, and that order is exactly
// where a regression hides: a screen that resolves in a warmed process and holds
// the pending sentence in a fresh one still passes every file above.
//
// NOTHING IS HARD-CODED FROM A SCREENSHOT. Every expected string is derived at
// run time, either from the committed analysis document (`evolution-demo-data
// .json`) or from the organization-wide review's OWN functions — the same call
// `evolution-page.js` makes to paint `#action-result`. So a drift on either side
// reds this file by name rather than being copied into it.
//
// NO NETWORK AND NO CLOCK. One declared route serving one committed fixture; the
// harness throws on any other request. Nothing is stored, and the store is
// asserted empty on the way out.
//
// HARNESS. A DOM double, not a browser: no `assert.equal(node, null)` (it walks
// the parsed page for minutes), no `querySelectorAll("*")`, no descendant
// selectors, `!node.open` for a shut disclosure, and properties rather than
// reflected attributes. `textOf` reads straight THROUGH a shut disclosure, so
// the provenance claim below is anchored by walking `parentNode` — not by
// visibility, which this harness cannot judge.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  DEPARTMENT_SCREEN_PATH,
  DEPARTMENT_SCREEN_STATE,
  departmentScreenHref,
  departmentSlugFrom,
} from "../src/department-screen.js";
import { departmentVerdict, periodKeyOf } from "../src/department-verdict.js";
import { scoreDepartmentIntervention } from "../src/department-intervention-scoring.js";
import { interventionActionFields } from "../src/department-intervention-view.js";
import { departmentSourceProvenance } from "../src/department-source-provenance.js";

const PAGE = new URL("../src/departments.html", import.meta.url);
const DATA_URL = "/evolution-demo-data.json";

const dataset = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const evolutionHtml = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");

const shown = (document, id) => textOf(document.getElementById(id));

/**
 * Open the shipped screen in a fresh session and wait for it to SETTLE.
 *
 * Three waits, not one. `ready` is the entry's own load promise; the two waits
 * after it are the state the view writes when the paint has landed. Awaiting
 * only the promise leaves a paint in flight, which lands after the globals are
 * torn down and surfaces as an unhandled rejection — a failure that stays green
 * on a quiet machine and reds a loaded CI box.
 *
 * The session is cold by construction: `loadPage` seeds an empty store and a
 * fetch that serves exactly the one route named here, and nothing in this file
 * primes the process with a previous department first.
 */
async function coldOpen(search, { routes = { [DATA_URL]: dataset } } = {}) {
  const page = await loadPage(PAGE, { storage: {}, routes, location: { search } });
  assert.equal(page.storage.length, 0, "the session under test was not cold");

  const module = await importPageModule("/department-screen-page.js");
  await module.ready;
  const answer = page.document.getElementById("department-answer");
  await waitFor(() => answer.getAttribute("data-state") !== DEPARTMENT_SCREEN_STATE.pending,
    `the screen never left its pending state for "${search}"`);
  await waitFor(() => answer.getAttribute("aria-busy") === "false",
    `the screen never stopped announcing itself busy for "${search}"`);
  return page;
}

/** What the settled screen actually painted, read out of the shipped slots. */
const painted = (document) => ({
  state: document.getElementById("department-answer").getAttribute("data-state"),
  subject: shown(document, "department-subject"),
  status: shown(document, "department-status"),
  metric: shown(document, "department-metric-value"),
  verdict: shown(document, "department-verdict-value"),
  confidence: shown(document, "department-verdict-confidence"),
  evidence: shown(document, "department-verdict-evidence"),
  sourcesLine: shown(document, "department-sources-line"),
  provider: shown(document, "department-sources-provider"),
  hris: shown(document, "department-sources-hris"),
  action: shown(document, "department-action-text"),
});

/**
 * The organization-wide review's own answer for one record.
 *
 * The exact call, with the exact arguments, that src/evolution-page.js makes
 * when it paints the org answer — so this is the org path's output rather than
 * a test's restatement of it.
 */
const orgAnswer = (record) =>
  interventionActionFields(scoreDepartmentIntervention(record), record);

/** The source declarations the analysis document itself makes, narrowed to one department. */
const declaredSources = (record) => departmentSourceProvenance({
  organization: dataset.organization,
  provenance: dataset.provenance,
  departments: dataset.departments,
  departmentId: record.id,
  period: record.period ?? null,
});

/* ------------------------------- 1. cold open ------------------------------ */

test("a forwarded link opened in a cold session settles on the answer, not on the reading sentence", async () => {
  const record = dataset.departments[0];
  const page = await coldOpen(departmentScreenHref(record.id).slice(DEPARTMENT_SCREEN_PATH.length));
  try {
    const screen = painted(page.document);
    const { document } = page;

    assert.equal(screen.state, DEPARTMENT_SCREEN_STATE.resolved,
      `a cold-opened link for "${record.id}" did not resolve`);
    assert.equal(document.getElementById("department-answer").getAttribute("aria-busy"), "false");
    assert.ok(!document.getElementById("department-resolved").hidden,
      "the answer stayed hidden after the screen settled");
    assert.ok(document.getElementById("department-unavailable").hidden,
      "a settled answer is showing the failure state as well");

    // Settled means the reading sentence is GONE, replaced by the figure. A
    // screen that resolved its data and left the pending copy on screen is the
    // regression a state flag alone would not catch.
    assert.equal(screen.subject, `${record.name} — one figure, one next move`);
    assert.doesNotMatch(screen.status, /Reading the bundled example analysis/,
      "the pending announcement survived into the settled screen");
    assert.ok(screen.status.includes(record.name),
      `the announcement does not name the department: "${screen.status}"`);
    assert.match(screen.metric, /^\$[\d,]+$/,
      `the headline figure is not a dollar amount: "${screen.metric}"`);

    // Nothing is stored. The screen's own claim, held to on the way out.
    assert.equal(page.storage.length, 0, "the cold session wrote something to the reader's browser");
  } finally {
    page.restore();
  }
});

/* ----------------------------- 2. verdict parity --------------------------- */

for (const record of dataset.departments) {
  test(`a cold-opened ${record.id} states the org review's verdict and confidence for the same month`, async () => {
    const page = await coldOpen(`?department=${record.id}&period=${periodKeyOf(record)}`);
    try {
      const screen = painted(page.document);
      const org = orgAnswer(record);
      const scored = scoreDepartmentIntervention(record);

      assert.equal(screen.state, DEPARTMENT_SCREEN_STATE.resolved);
      assert.equal(screen.verdict, org.title,
        `${record.id}: the cold-opened screen and the org review state different verdicts`);
      assert.equal(screen.confidence, `Confidence: ${org.confidence}`,
        `${record.id}: the cold-opened screen's confidence line is not the org review's`);
      // The machine-readable confidence code and the sentence a reader gets are
      // the same claim: the line has to open with the level the code names.
      const decided = departmentVerdict(record);
      const code = decided.confidence;
      const level = code === "not_scored" ? "Not scored" : `${code[0].toUpperCase()}${code.slice(1)}`;
      assert.ok(screen.confidence.startsWith(`Confidence: ${level}`),
        `${record.id}: the confidence code is "${code}" but the line reads "${screen.confidence}"`);

      // The evidence behind both, as one number derived from the analysis rather
      // than transcribed: it has to be on the screen AND in the org review.
      const sampled = scored.provenance.sampledQueries;
      const counted = sampled.toLocaleString("en-US");
      // A department with nothing scored says so in words rather than printing a
      // zero; it is still the same count, and it still has to agree.
      assert.ok(sampled === 0
        ? screen.evidence.startsWith("No scored prompts")
        : screen.evidence.includes(`${counted} scored prompt`),
      `${record.id}: the screen's evidence count is not ${counted}: "${screen.evidence}"`);
      assert.ok(org.provenance.includes(`${counted} scored prompt`),
        `${record.id}: the org review's evidence count is not ${counted}`);

      // And the next move follows the same decision: where the shared rule
      // prioritized nothing — an unseparated pair, or too little evidence — the
      // forwarded reader is told so rather than handed an intervention the org
      // answer declined to name.
      assert.equal(screen.action, decided.action?.text
        ?? "No next move is prioritized for this department and period.",
      `${record.id}: the screen's next move is not the one the shared rule prioritized`);
    } finally {
      page.restore();
    }
  });
}

test("a link forwarded before periods were addressable resolves to the same month", async () => {
  // The address shape forwarded before a period could be named: a department
  // and nothing else. It must
  // resolve to the record it always resolved to, with the same verdict — not to
  // a dead end, and not to a different month under the old month's address.
  const record = dataset.departments[1];
  const withoutPeriod = await coldOpen(`?department=${record.id}`);
  const before = painted(withoutPeriod.document);
  withoutPeriod.restore();

  const withPeriod = await coldOpen(`?department=${record.id}&period=${periodKeyOf(record)}`);
  try {
    const after = painted(withPeriod.document);
    assert.equal(before.state, DEPARTMENT_SCREEN_STATE.resolved,
      "an address carrying no period stopped resolving");
    assert.equal(before.subject, after.subject);
    assert.equal(before.verdict, after.verdict, "the two address shapes state different verdicts");
    assert.equal(before.confidence, after.confidence);
    assert.equal(before.metric, after.metric);
  } finally {
    withPeriod.restore();
  }
});

/* --------------------------- 3. source declarations ------------------------ */

test("a cold-opened screen names the provider export and the HRIS source its figure rests on", async () => {
  const record = dataset.departments[0];
  const page = await coldOpen(`?department=${record.id}`);
  try {
    const screen = painted(page.document);
    const sources = declaredSources(record);

    // Both declarations, from the analysis document's own blocks. The provider
    // export carries the providers it aggregates; the HRIS source is the org
    // block's, not a second name for it.
    assert.ok(dataset.provenance.billingSource && dataset.organization.hrisSource,
      "the committed analysis no longer declares both sources; this test has nothing to prove");
    assert.equal(screen.provider, sources.providerExport,
      "the provider export row is not the projection the screen composes");
    assert.equal(screen.hris, sources.hrisSource,
      "the HRIS row is not the projection the screen composes");
    // Held to the DOCUMENT's declarations as well, not only to the projection:
    // the two above agree with each other even when both read the wrong block.
    assert.ok(screen.provider.includes(dataset.provenance.billingSource),
      `the provider export row does not name the declared export: "${screen.provider}"`);
    assert.ok(screen.hris.includes(dataset.organization.hrisSource),
      `the HRIS row does not name the declared HRIS source: "${screen.hris}"`);
    for (const provider of dataset.organization.providers) {
      assert.ok(screen.provider.includes(provider),
        `the provider export row does not name ${provider}: "${screen.provider}"`);
    }

    // The at-a-glance line carries both names too, because a director who never
    // expands anything must still learn what the figure rests on.
    assert.equal(screen.sourcesLine, sources.line);
    assert.ok(screen.sourcesLine.includes(dataset.provenance.billingSource),
      `the glance line does not name the provider export: "${screen.sourcesLine}"`);
    assert.ok(screen.sourcesLine.includes(dataset.organization.hrisSource),
      `the glance line does not name the HRIS source: "${screen.sourcesLine}"`);

    // The per-source rows sit behind a disclosure that is shut on arrival, and
    // the glance line does NOT. Asserted by walking ancestry rather than by
    // reading text, because this harness reads straight through a shut fold.
    const detail = page.document.getElementById("department-sources");
    assert.equal(detail.tagName, "DETAILS", "the per-source detail is not a disclosure");
    assert.ok(!detail.open, "the per-source disclosure is open on arrival");
    for (let node = page.document.getElementById("department-sources-line")?.parentNode;
      node; node = node.parentNode) {
      assert.notEqual(node.tagName, "DETAILS",
        "the source declarations a director reads at a glance are folded inside a disclosure");
    }
  } finally {
    page.restore();
  }
});

/* -------------------------------- 4. fallback ------------------------------ */

test("a link naming a department this analysis does not hold lands on a named, inspectable dead end", async () => {
  const page = await coldOpen("?department=growth-marketing");
  try {
    const { document } = page;
    const screen = painted(document);

    assert.equal(screen.state, DEPARTMENT_SCREEN_STATE.unavailable,
      "an unknown department did not reach the unavailable state");
    assert.equal(screen.subject, "No department called “growth-marketing” is in this analysis");
    assert.match(screen.status, /no figure to state and none is invented/);
    assert.ok(document.getElementById("department-resolved").hidden,
      "an unknown department is still painting a figure");
    assert.ok(!document.getElementById("department-unavailable").hidden,
      "the failure state is not on screen");

    // Inspectable, not blank: a state attribute a monitor can read, a sentence a
    // reader can act on, and a door that keeps the department they asked for.
    assert.ok(screen.status.length > 80, `the dead end says almost nothing: "${screen.status}"`);
    assert.equal(document.getElementById("department-unavailable-org-answer").getAttribute("href"),
      "/evolution.html?department=growth-marketing#workspace-answer");

    // No stale verdict, confidence or source declaration is left standing beside
    // a department that has no figure at all. These are the slots the view
    // rewrites on every state precisely so nothing survives into a dead end.
    for (const field of ["verdict", "confidence", "evidence", "sourcesLine", "provider", "hris"]) {
      assert.equal(screen[field], "", `the dead end still shows a ${field}: "${screen[field]}"`);
    }
    assert.doesNotMatch(screen.metric, /\$/,
      `a dollar figure is on a screen with no department: "${screen.metric}"`);
  } finally {
    page.restore();
  }
});

test("a link naming a month this analysis does not hold says so rather than answering for another one", async () => {
  const record = dataset.departments[0];
  const page = await coldOpen(`?department=${record.id}&period=1999-01`);
  try {
    const screen = painted(page.document);
    assert.equal(screen.state, DEPARTMENT_SCREEN_STATE.unavailable,
      "an unheld month silently fell back to a month the reader did not ask for");
    assert.doesNotMatch(screen.metric, /\$/,
      "a figure was painted for a month this analysis does not hold");
    assert.equal(screen.verdict, "", "a verdict was painted for a month this analysis does not hold");
  } finally {
    page.restore();
  }
});

/* ---------------------------- 5. legacy link shape ------------------------- */

/** Every pre-migration anchor's forward, as authored in the served document. */
const LEGACY_POINTERS = [...evolutionHtml.matchAll(
  /<a([^>]*\sdata-department-screen-pointer="([^"]+)"[^>]*)>/g)]
  .map(([, attributes, anchorId]) => ({
    anchorId,
    href: attributes.match(/\shref="([^"]*)"/)?.[1] ?? "",
  }));

test("every pre-migration department anchor forwards an address this screen can answer", () => {
  assert.ok(LEGACY_POINTERS.length >= 7,
    `only ${LEGACY_POINTERS.length} legacy department anchors still carry a forward`);
  const held = new Set(dataset.departments.map((entry) => entry.id));
  for (const { anchorId, href } of LEGACY_POINTERS) {
    const [path, query] = href.split("?");
    assert.equal(path, DEPARTMENT_SCREEN_PATH,
      `the forward at #${anchorId} does not name the department screen`);
    const slug = departmentSlugFrom(query);
    assert.ok(slug && held.has(slug),
      `#${anchorId} forwards "${slug}", which the bundled analysis does not hold`);
  }
});

test("a previously-forwarded link resolves to the same screen the canonical address does", async () => {
  // The end of the round trip #1613/#1614 promised: the address a saved link
  // already carries, opened cold, lands on the same answer as the address this
  // screen composes today. Distinct addresses only — every anchor is held to the
  // shape above, and opening the identical query seven times proves nothing more.
  const addresses = [...new Set(LEGACY_POINTERS.map((pointer) => pointer.href))];
  assert.ok(addresses.length > 0, "no legacy forward is authored at all");

  for (const href of addresses) {
    const legacy = await coldOpen(href.slice(DEPARTMENT_SCREEN_PATH.length));
    const arrived = painted(legacy.document);
    legacy.restore();

    const slug = departmentSlugFrom(href.split("?")[1]);
    const canonical = await coldOpen(
      departmentScreenHref(slug).slice(DEPARTMENT_SCREEN_PATH.length));
    try {
      const today = painted(canonical.document);
      assert.equal(arrived.state, DEPARTMENT_SCREEN_STATE.resolved,
        `the legacy address ${href} no longer resolves`);
      assert.deepEqual(arrived, today,
        `the legacy address ${href} lands on a different screen than the canonical one`);

      // And it is the org review's verdict on both, so a link forwarded before
      // the move is not reading an older answer.
      const record = dataset.departments.find((entry) => entry.id === slug);
      assert.equal(arrived.verdict, orgAnswer(record).title,
        `${href}: a pre-migration link states a verdict the org review does not`);
    } finally {
      canonical.restore();
    }
  }
});
