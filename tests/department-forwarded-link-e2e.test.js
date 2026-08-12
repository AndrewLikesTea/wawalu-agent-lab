// A forwarded `?department=` link, opened cold in a browser that has never seen
// this site (#1633).
//
// WHAT THIS FILE IS FOR. Four shipped pieces have to keep agreeing with each
// other for one everyday act to work — a FinOps lead pastes a department link
// into a fresh browser and reads the answer: the department screen and its
// address (#1621), the pointers that keep already-forwarded links working after
// the move off /evolution.html (#1622), verdict and confidence parity with the
// organization-wide review (#1624), and the provider and HRIS source
// declarations beside the figure (#1626). Each of those has its own unit-level
// file. NONE of them opens the whole shipped page on an empty browser and walks
// the act end to end, which is the only way the four can be proved to still
// agree. That walk is this file.
//
// A COLD OPEN, PRECISELY. Empty storage, no prior boot, no earlier department
// left in the process, and the address bar as the only input. Both module
// scripts departments.html ships are imported, in document order, exactly as a
// browser loads them — a page entry left out of a "whole page" test is a paint
// this suite would never see.
//
// THREE SETTLE SIGNALS, NOT ONE. `await module.ready` alone returns with a
// paint still in flight: it is the load promise, not the screen's own statement
// that it has finished. This file waits on the entry's promise, then on
// `aria-busy` going false, then on the answer region leaving the pending state,
// before any assertion runs. Waiting on `ready` alone is green locally and reds
// CI as an unhandled rejection.
//
// EVERY EXPECTED VALUE COMES FROM THE COMMITTED FIXTURE. The verdict and
// confidence are read from the organization-wide review's OWN function over the
// bundled analysis, so a drift between the two screens fails here rather than
// two hard-coded literals agreeing with each other forever. The source
// declarations are read from the analysis document's own `organization` and
// `provenance` blocks. A handful of literals are pinned alongside the derived
// values as a tripwire, so an empty string can never satisfy an equality with
// another empty string. Nothing here reaches the network, a clock, or a
// credential: one same-origin route serving a committed JSON file.
//
// HARNESS DISCIPLINE. This is a DOM double: no assertion is handed a parsed node
// (comparing one walks the whole document and outlives the test timeout), no
// `*` selector and no descendant selector (both throw at parse time), `!node
// .open` for a shut disclosure, properties rather than reflected attributes, and
// `?.` on anything walking `children`, where text nodes have no `dataset`.
// `textOf` reads straight through a closed disclosure, so wherever a claim is
// about what a reader SEES, the element state that decides visibility is
// asserted too.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { DEPARTMENT_SCREEN_STATE, departmentSlugFrom } from "../src/department-screen.js";
import { scoreDepartmentIntervention } from "../src/department-intervention-scoring.js";
import { interventionActionFields } from "../src/department-intervention-view.js";
import { formatUsd, recoverableSpendUsd } from "../src/evolution.js";

const PAGE = new URL("../src/departments.html", import.meta.url);
const ORG_PAGE = new URL("../src/evolution.html", import.meta.url);
const DATA_URL = "/evolution-demo-data.json";

const dataset = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const orgHtml = await readFile(ORG_PAGE, "utf8");

const byId = (document, id) => document.getElementById(id);
const shown = (document, id) => textOf(byId(document, id));
const stateOf = (document) => byId(document, "department-answer").getAttribute("data-state");
const recordFor = (slug) => dataset.departments.find((entry) => entry.id === slug);

/** The organization-wide review's own answer for one department record. */
const orgReview = (record) =>
  interventionActionFields(scoreDepartmentIntervention(record), record);

/**
 * Open the shipped department screen at one address, in a browser that holds
 * nothing, and return once the whole page has settled.
 *
 * Every write this boot makes to storage is recorded rather than blocked, so a
 * screen that quietly started depending on session state is a failure here and
 * not a surprise on somebody's second visit.
 */
async function coldOpen(search, { routes = { [DATA_URL]: dataset } } = {}) {
  const page = await loadPage(PAGE, { storage: {}, routes, location: { search } });
  const writes = [];
  const { setItem, removeItem } = page.storage;
  page.storage.setItem = (key, value) => { writes.push(key); setItem(key, value); };
  page.storage.removeItem = (key) => { writes.push(key); removeItem(key); };
  page.writes = writes;

  // Both entries the page ships, in document order, as the browser loads them.
  const module = await importPageModule("/department-screen-page.js");
  await importPageModule("/site-footer-page.js");

  // Signal one: the entry's own load promise. Signal two: the region stops
  // saying it is busy. Signal three: it leaves the state it was authored in.
  await module.ready;
  await waitFor(() => byId(page.document, "department-answer").getAttribute("aria-busy") === "false",
    `the department screen at "${search}" to stop reporting itself busy`);
  await waitFor(() => stateOf(page.document) !== DEPARTMENT_SCREEN_STATE.pending,
    `the department screen at "${search}" to leave the pending state`);
  return { ...page, module };
}

/** Every element under `node` that is not inside something hidden. Never uses `*`. */
function visibleElements(node) {
  let total = 0;
  for (const child of node.children ?? []) {
    if (child.nodeType !== 1 || child.hidden) continue;
    total += 1 + visibleElements(child);
  }
  return total;
}

/** Assert that nothing between `id` and the document root folds it away. */
function assertOutsideEveryDisclosure(document, id, why) {
  for (let node = byId(document, id).parentNode; node; node = node.parentNode) {
    assert.notEqual(node.tagName, "DETAILS", `${why}: #${id} is folded inside a disclosure`);
  }
}

/* -------------------------- 1. the cold open itself ------------------------- */

test("a forwarded department link opens in a browser holding nothing and settles into the answer", async () => {
  const page = await coldOpen("?department=quality");
  try {
    const { document } = page;

    // Settled, and settled into the answer rather than into the failure state.
    assert.equal(stateOf(document), DEPARTMENT_SCREEN_STATE.resolved,
      "a forwarded link to a department this analysis holds did not resolve");
    assert.equal(byId(document, "department-answer").getAttribute("aria-busy"), "false");
    assert.ok(!byId(document, "department-resolved").hidden,
      "the screen settled with the answer still hidden");
    assert.ok(byId(document, "department-unavailable").hidden,
      "a settled answer is showing the failure state as well");

    // The figure, derived from the bundled analysis by the organization-wide
    // recoverability rule rather than restated here, and pinned beside it.
    const expected = formatUsd(recoverableSpendUsd(recordFor("quality")));
    assert.equal(expected, "$4,530", "the committed fixture's recoverable figure moved");
    assert.equal(shown(document, "department-metric-value"), expected,
      "the cold-opened screen states a figure the shared recoverability rule does not");
    assert.match(shown(document, "department-subject"), /^QA & Release/,
      "the settled screen does not name the department the link asked for");

    // Cold means cold: nothing was needed from this browser, and nothing was
    // left in it. A link that only works on a second visit is the defect this
    // whole file exists to catch.
    assert.equal(page.storage.length, 0,
      "the cold open left state behind in this browser");
    assert.deepEqual(page.writes, [],
      `the department screen wrote to storage on a cold open: ${page.writes.join(", ")}`);
  } finally {
    page.restore();
  }
});

test("a cold open reaches the same settled screen whichever department was read before it", async () => {
  // Two boots in one process, the second addressed to a different department.
  // A module that memoized the first department, or a slot the view forgot to
  // repaint, shows up as the first answer surviving into the second screen.
  const first = await coldOpen("?department=quality");
  let firstVerdict = "";
  try {
    firstVerdict = shown(first.document, "department-verdict-value");
  } finally {
    first.restore();
  }

  const second = await coldOpen("?department=security");
  try {
    const { document } = second;
    assert.equal(stateOf(document), DEPARTMENT_SCREEN_STATE.resolved);
    assert.equal(shown(document, "department-verdict-value"), orgReview(recordFor("security")).title,
      "the second cold open does not state its own department's verdict");
    assert.ok(!textOf(byId(document, "main-content")).includes("QA & Release"),
      "the previously read department is still on the cold-opened screen");
    assert.notEqual(firstVerdict, "", "the first cold open painted no verdict to compare against");
  } finally {
    second.restore();
  }
});

/* --------------------- 2. verdict and confidence parity --------------------- */

test("a cold-opened department screen states the organization-wide review's own verdict and confidence", async () => {
  for (const record of dataset.departments) {
    const page = await coldOpen(`?department=${record.id}`);
    try {
      const { document } = page;
      const org = orgReview(record);

      assert.equal(stateOf(document), DEPARTMENT_SCREEN_STATE.resolved,
        `${record.id}: the cold open never resolved`);

      // The shared value on both sides, not two literals that happen to match.
      assert.notEqual(org.title, "", `${record.id}: the org review states no verdict at all`);
      assert.equal(shown(document, "department-verdict-value"), org.title,
        `${record.id}: the cold-opened screen and the org review state different verdicts`);

      assert.notEqual(org.confidence, "", `${record.id}: the org review states no confidence at all`);
      assert.equal(shown(document, "department-verdict-confidence"), `Confidence: ${org.confidence}`,
        `${record.id}: the cold-opened screen's confidence is not the org review's`);
      assert.match(shown(document, "department-verdict-confidence"),
        /^Confidence: (High|Medium|Low|Not scored)\b/,
        `${record.id}: the confidence line names no level a reader can act on`);

      // Both are read at a glance, so neither may be behind a fold. `textOf`
      // would read them either way; the ancestry is what decides.
      assertOutsideEveryDisclosure(document, "department-verdict-value", record.id);
      assertOutsideEveryDisclosure(document, "department-verdict-confidence", record.id);
    } finally {
      page.restore();
    }
  }
});

test("the parity assertion is pinned, so two empty strings can never satisfy it", async () => {
  // The tripwire under the loop above. If the verdict path stopped producing a
  // verdict, every equality there would still hold, on both sides, forever.
  const page = await coldOpen("?department=quality");
  try {
    assert.equal(shown(page.document, "department-verdict-value"), "Automated down-routing");
    assert.match(shown(page.document, "department-verdict-confidence"),
      /^Confidence: Medium · capped by sample: 180 scored prompts\b/);
    assert.match(shown(page.document, "department-verdict-evidence"),
      /^180 scored prompts stand behind this verdict/);
    assert.equal(shown(page.document, "department-verdict-basis"),
      "Scored against the spend-intervention rubric, version 1.");
  } finally {
    page.restore();
  }
});

/* ------------------------- 3. the source declarations ----------------------- */

test("a cold-opened department screen declares both the provider export and the HRIS source", async () => {
  const provider = dataset.provenance.billingSource;
  const hris = dataset.organization.hrisSource;
  assert.notEqual(provider, "", "the committed analysis declares no provider export");
  assert.notEqual(hris, "", "the committed analysis declares no HRIS source");

  for (const record of dataset.departments) {
    const page = await coldOpen(`?department=${record.id}`);
    try {
      const { document } = page;
      const line = shown(document, "department-sources-line");

      // At a glance, outside every disclosure: a director who expands nothing
      // still learns what the figure rests on.
      assert.ok(line.includes(provider),
        `${record.id}: the at-a-glance basis does not name the provider export: "${line}"`);
      assert.ok(line.includes(hris),
        `${record.id}: the at-a-glance basis does not name the HRIS source: "${line}"`);
      assert.ok(line.includes(dataset.provenance.generatedAt),
        `${record.id}: the at-a-glance basis states no freshness: "${line}"`);
      assertOutsideEveryDisclosure(document, "department-sources-line", record.id);

      // The per-source detail, folded on arrival — `open` is undefined on a shut
      // disclosure in this harness, so it is asserted with `!`.
      const disclosure = byId(document, "department-sources");
      assert.equal(disclosure.tagName, "DETAILS", `${record.id}: the source detail is not a disclosure`);
      assert.ok(!disclosure.open, `${record.id}: the source detail is open on arrival`);
      assert.equal(shown(document, "department-sources-hris"), hris,
        `${record.id}: the HRIS row is not the analysis document's declaration`);
      assert.ok(shown(document, "department-sources-provider").startsWith(provider),
        `${record.id}: the provider row is not the analysis document's declaration`);
      for (const name of dataset.organization.providers) {
        assert.ok(shown(document, "department-sources-provider").includes(name),
          `${record.id}: the provider row omits the declared provider ${name}`);
      }
      assert.equal(shown(document, "department-sources-period"), record.period,
        `${record.id}: the period covered is not this record's own`);
      assert.ok(shown(document, "department-sources-freshness").includes(dataset.provenance.generatedAt),
        `${record.id}: the freshness row does not state the declaration's day`);
    } finally {
      page.restore();
    }
  }
});

test("the declared sources on a cold-opened screen are the committed fixture's, word for word", async () => {
  // Pinned, for the same reason the verdict is: a projection that returned
  // nothing would satisfy every `includes` above if the fixture were empty too.
  const page = await coldOpen("?department=quality");
  try {
    assert.match(shown(page.document, "department-sources-line"),
      /^Sources: hand-authored provider aggregate fixture \(OpenAI, Anthropic, AWS Bedrock, GitHub Copilot\) and Workday · demo sync — 25 Jun–25 Jul 2026, as of 2026-07-25\. Both declared sources cover this department/);
    assert.equal(shown(page.document, "department-sources-hris"), "Workday · demo sync");
    assert.equal(shown(page.document, "department-sources-period"), "25 Jun–25 Jul 2026");
  } finally {
    page.restore();
  }
});

/* ---------------- 4. a link that names nothing this analysis holds ---------- */

test("an unknown and an empty ?department= each land on an inspectable screen, not a blank one", async () => {
  const cases = [
    {
      search: "?department=marketing",
      subject: "No department called “marketing” is in this analysis",
      back: "/evolution.html?department=marketing#workspace-answer",
    },
    // The empty VALUE, which is what a truncated paste or a stripped tracking
    // parameter produces — distinct from an address that carries no parameter.
    { search: "?department=", subject: "No department is named in this link", back: "/evolution.html#workspace-answer" },
    { search: "?department=%20", subject: "No department is named in this link", back: "/evolution.html#workspace-answer" },
    // A parameter that is present twice: the first value is the one a browser
    // hands a page, and a reader who forwarded a doubled link still gets an
    // answer rather than a blank screen.
    { search: "?department=quality&department=security", resolved: true },
  ];

  for (const expected of cases) {
    const page = await coldOpen(expected.search);
    try {
      const { document } = page;
      const main = byId(document, "main-content");

      if (expected.resolved) {
        assert.equal(stateOf(document), DEPARTMENT_SCREEN_STATE.resolved,
          `"${expected.search}": a doubled parameter left the reader with no answer`);
        assert.match(shown(document, "department-subject"), /^QA & Release/,
          `"${expected.search}": the first value in the address is not the one answered`);
        continue;
      }

      assert.equal(stateOf(document), DEPARTMENT_SCREEN_STATE.unavailable,
        `"${expected.search}": an address naming no known department resolved anyway`);
      assert.equal(shown(document, "department-subject"), expected.subject,
        `"${expected.search}": the screen does not name what went wrong`);
      assert.notEqual(shown(document, "department-status"), "",
        `"${expected.search}": the screen's one announcement is empty`);

      // Not blank — and asserted on the FALLBACK REGION rather than on the page,
      // because the static chrome above it would satisfy a whole-page count on
      // its own and hide an empty fallback completely. Counts and text only,
      // never a parsed node handed to an assertion.
      assert.ok(!byId(document, "department-unavailable").hidden,
        `"${expected.search}": the failure state is not on screen`);
      assert.ok(byId(document, "department-resolved").hidden,
        `"${expected.search}": a screen with no answer is painting one`);
      const fallback = byId(document, "department-unavailable");
      assert.ok(visibleElements(fallback) >= 2,
        `"${expected.search}": the fallback region a reader lands on is empty`);
      assert.ok(textOf(fallback).length > 40,
        `"${expected.search}": the fallback region says almost nothing: "${textOf(fallback)}"`);
      assert.ok(visibleElements(main) > 5,
        `"${expected.search}": the screen a reader lands on is effectively blank`);
      assert.ok(textOf(main).length > 200,
        `"${expected.search}": the screen a reader lands on says almost nothing`);

      // And one door out, in the tab order, carrying whatever selection there
      // was — a named dead end with no way forward is still a dead end.
      const back = byId(document, "department-unavailable-org-answer");
      assert.equal(back.getAttribute("href"), expected.back,
        `"${expected.search}": the way back does not carry the reader's selection`);
      assert.notEqual(textOf(back), "", `"${expected.search}": the way back has no label`);
      assert.ok(tabSequence(document).includes(back),
        `"${expected.search}": the way back is not reachable from a keyboard`);
    } finally {
      page.restore();
    }
  }
});

test("an analysis this browser cannot read says so and still offers the way forward", async () => {
  // The other empty account: a cold open where the bundled analysis never
  // arrives. The screen must not sit on its pending sentence forever.
  const page = await coldOpen("?department=quality", { routes: {} });
  try {
    const { document } = page;
    assert.equal(stateOf(document), DEPARTMENT_SCREEN_STATE.unavailable);
    assert.equal(byId(document, "department-answer").getAttribute("aria-busy"), "false",
      "the screen is still reporting itself busy after the analysis failed to load");
    assert.equal(shown(document, "department-subject"), "This department’s figures could not be read");
    assert.ok(!byId(document, "department-unavailable").hidden);
    assert.equal(byId(document, "department-unavailable-org-answer").getAttribute("href"),
      "/evolution.html?department=quality#workspace-answer");
    assert.ok(textOf(byId(document, "main-content")).length > 200,
      "a failed load left the reader with an effectively blank screen");
  } finally {
    page.restore();
  }
});

/* -------------------- 5. the link shapes already in circulation ------------- */

/** Every legacy pointer authored on /evolution.html, as `{ anchorId, href }`. */
const LEGACY_POINTERS = [...orgHtml.matchAll(
  /<a\s+data-department-screen-pointer="([^"]+)"\s+href="([^"]+)"/g)]
  .map(([, anchorId, href]) => ({ anchorId, href }));

test("every legacy department address still has both halves of its forward", () => {
  // The pre-migration link shape is `/evolution.html#<region id>`: the answer
  // used to be AT that anchor. #1622 kept each id and authored one ordinary link
  // beside it. This asserts the shape rather than assuming it — the ids and the
  // pointer hrefs both come out of the served document.
  assert.ok(LEGACY_POINTERS.length >= 7,
    `only ${LEGACY_POINTERS.length} legacy department pointers are authored`);
  const ids = new Set([...orgHtml.matchAll(/\sid="([^"]+)"/g)].map(([, value]) => value));
  for (const { anchorId, href } of LEGACY_POINTERS) {
    assert.ok(ids.has(anchorId),
      `#${anchorId} is an address already in circulation and left evolution.html`);
    assert.ok(href.startsWith("/departments.html?department="),
      `the pointer at #${anchorId} forwards to "${href}", which is not the department screen`);
    assert.notEqual(departmentSlugFrom(href.slice(href.indexOf("?"))), null,
      `the pointer at #${anchorId} forwards no department`);
  }
});

test("a legacy forwarded link resolves to the same settled department screen it always did", async () => {
  // The whole chain a saved link walks: the old anchor, the pointer authored
  // beside it, and the screen that address lands on — settled, with the
  // department the old link was about, and agreeing with the org review.
  const addresses = [...new Set(LEGACY_POINTERS.map(({ href }) => href))];
  assert.ok(addresses.length >= 1, "no legacy address to follow");

  for (const href of addresses) {
    const search = href.slice(href.indexOf("?"));
    const slug = departmentSlugFrom(search);
    const record = recordFor(slug);
    assert.ok(record, `a legacy pointer forwards "${slug}", which the bundled analysis does not hold`);

    const page = await coldOpen(search);
    try {
      const { document } = page;
      assert.equal(stateOf(document), DEPARTMENT_SCREEN_STATE.resolved,
        `${href}: a legacy forwarded link did not reach a settled answer`);
      assert.ok(!byId(document, "department-resolved").hidden, `${href}: the answer is hidden`);
      assert.ok(shown(document, "department-subject").startsWith(record.name),
        `${href}: the legacy link landed on a screen about someone else`);
      assert.equal(shown(document, "department-verdict-value"), orgReview(record).title,
        `${href}: a legacy forwarded link states a verdict the org review does not`);
      assert.equal(shown(document, "department-metric-value"), formatUsd(recoverableSpendUsd(record)),
        `${href}: a legacy forwarded link states a figure the shared rule does not`);
    } finally {
      page.restore();
    }
  }
});

test("a link forwarded before periods were addressable still answers, for the month it names", async () => {
  // Two shapes are in circulation: the original `?department=` alone, and the
  // `?department=&period=` shape added when a verdict became per-period (#1624).
  // The older shape must keep resolving — it names no period, so it gets that
  // department's record exactly as it always did — and the newer shape must
  // answer for the month it names rather than for whichever came first.
  const record = recordFor("quality");
  const withoutPeriod = await coldOpen("?department=quality");
  try {
    assert.equal(stateOf(withoutPeriod.document), DEPARTMENT_SCREEN_STATE.resolved,
      "a link forwarded before periods were addressable stopped answering");
    assert.equal(shown(withoutPeriod.document, "department-verdict-value"), orgReview(record).title);
    assert.equal(shown(withoutPeriod.document, "department-sources-period"), record.period,
      "the screen does not say which month it answered for");
  } finally {
    withoutPeriod.restore();
  }

  // The same department addressed by the month it actually holds, spelled the
  // way the record spells it. Same answer, and the month is stated.
  const spelled = record.period.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const withPeriod = await coldOpen(`?department=quality&period=${spelled}`);
  try {
    assert.equal(stateOf(withPeriod.document), DEPARTMENT_SCREEN_STATE.resolved,
      "a link naming the month this analysis holds did not answer");
    assert.equal(shown(withPeriod.document, "department-verdict-value"), orgReview(record).title,
      "addressing the month changed the verdict for that month");
    assert.equal(shown(withPeriod.document, "department-sources-period"), record.period);
  } finally {
    withPeriod.restore();
  }
});

test("a month this analysis does not hold is refused rather than answered with a different month", async () => {
  // The half of #1624 that is right, and worth holding: a CTO forwarded a link
  // to May must never be shown June under May's address. Both an unheld month
  // and an unparseable one stop at the failure state with a way forward.
  for (const search of ["?department=quality&period=2026-05", "?department=quality&period=not-a-period"]) {
    const page = await coldOpen(search);
    try {
      assert.equal(stateOf(page.document), DEPARTMENT_SCREEN_STATE.unavailable,
        `"${search}": a month this analysis does not hold was answered anyway`);
      assert.ok(!textOf(byId(page.document, "main-content")).includes("$4,530"),
        `"${search}": another month's figure was shown under this month's address`);
      assert.equal(byId(page.document, "department-unavailable-org-answer").getAttribute("href"),
        "/evolution.html?department=quality#workspace-answer",
        `"${search}": the way back lost the department the reader asked for`);
    } finally {
      page.restore();
    }
  }
});

// --------------------------------------------------------------------------
// A LANDED FAILING TEST, not a fixed one.
//
// The refusal above is correct. The SENTENCE it refuses with is not: a link
// naming a real department and a month this analysis does not hold is answered
// with "No department called “quality” is in this analysis", which is untrue —
// the department is in the analysis, the month is not. A FinOps lead who
// forwards a link carrying last quarter's month is told their department was
// dropped from the analysis, and the one thing they could do about it (ask for
// the month they can read) is the one thing the screen never says.
//
// The cause is in src/department-screen.js: an unheld period falls into
// `DEPARTMENT_SCREEN_REASON.unknownDepartment`, which owns that wording. This is
// #1624's surface and its owner's call to make — a new reason and its sentence
// is application copy, not something a regression suite should quietly patch —
// so the expectation is recorded here as a todo rather than silently repaired.
// Remove `{ todo: true }` when the sentence names the month.
// --------------------------------------------------------------------------

test("a month this analysis does not hold says so, instead of denying the department exists",
  { todo: true }, async () => {
    const page = await coldOpen("?department=quality&period=2026-05");
    try {
      const subject = shown(page.document, "department-subject");
      const status = shown(page.document, "department-status");
      assert.doesNotMatch(subject, /No department called/,
        `a link to a month this analysis does not hold denies the department exists: "${subject}"`);
      assert.match(`${subject} ${status}`, /period|month/i,
        "the screen never names the month as the thing it does not hold");
    } finally {
      page.restore();
    }
  });
