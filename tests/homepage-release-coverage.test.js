// The releases page's two coverage figures, on the front door (#2605).
//
// WHAT IS PINNED HERE, in the order the acceptance criteria are written:
//
//   * both figures are on the home page, in a sentence that says what each one
//     counts, with the two disqualifiers stated after it;
//   * the numbers are derived from the loaded log and nothing else — change the
//     fixture and both move;
//   * the denominator is every release loaded, never the filtered view;
//   * while the log is still being read the block says it is counting, and a
//     refused read says so rather than reporting an empty log;
//   * the block sits with the section's other evidence and above the record and
//     search panels, and adds no tab stop to a section whose stops are pinned;
//   * the home page and the releases page, given one browser's records, paint
//     the same sentence byte for byte.
//
// Determinism: no network and no timers. Each test seeds its own storage and
// refuses the health probe the deployment band beside this block makes.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { HISTORY_UNREAD_ANNOUNCEMENT, STORAGE_KEY, initDecisionLog } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initReleasesPage } from "../src/releases-page.js";
import {
  RELEASE_COVERAGE_COUNTING,
  RELEASE_COVERAGE_HEADING,
  RELEASE_COVERAGE_IDS,
  RELEASE_COVERAGE_LEAD,
  RELEASE_COVERAGE_RULE,
  RELEASE_COVERAGE_SCOPE,
  releaseCoverageLines,
  releaseCoverageUnread,
} from "../src/homepage-release-coverage.js";
import {
  COVERAGE_DEFINITION,
  REASONING_PROOF_HEADING,
  REASONING_PROOF_SCOPE,
  reasoningKeptSentence,
} from "../src/release-reasoning-proof.js";
import { loadPage, parseHtml, tabSequence, textOf, typeText } from "./support/browser.js";

const HOME_PAGE = new URL("../src/index.html", import.meta.url);
const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const NO_SEED = { decisions: [], releases: [] };

/* ----------------------------- the fixtures ------------------------------ */

const decision = (id, title) => ({
  id,
  title,
  context: `Why ${title} was decided.`,
  alternatives: "Doing nothing.",
  owner: "Kai",
  status: "accepted",
  createdAt: "2026-01-02T09:00:00.000Z",
});

const release = (id, version, decisionIds, day = "01") => ({
  id,
  version,
  title: `Release ${version}`,
  description: `What ${version} shipped.`,
  owner: "Ari",
  status: "completed",
  notes: "",
  createdAt: `2026-03-${day}T00:00:00.000Z`,
  decisionIds,
});

const QUEUE = decision("d-queue", "Adopt a durable queue");
const CACHE = decision("d-cache", "Cache the read path");

// One release per outcome the rule has to tell apart: linked and present,
// linked and absent from the log, and linked to nothing at all.
const KEPT = release("r-kept", "v1.0.0", ["d-queue"], "01");
const DANGLING = release("r-dangling", "v1.1.0", ["d-gone"], "02");
const BARE = release("r-bare", "v1.2.0", [], "03");

/* ---------------------------- the pure builder ---------------------------- */

test("the two lines are the releases page's sentence and the site's provenance note", () => {
  const lines = releaseCoverageLines({
    releases: [KEPT, DANGLING, BARE],
    decisions: [QUEUE, CACHE],
    exampleIds: new Set(["r-kept"]),
  });

  // Byte for byte the sentence the releases page paints, from the same counter.
  assert.equal(lines.claim,
    reasoningKeptSentence({ total: 3, preserved: 1 }));
  assert.equal(lines.claim,
    "1 of 3 releases in this release log links at least one decision the decision log holds.");
  assert.equal(lines.provenance, "Counted here: 1 example record and 2 you added.");
});

test("a different log produces different numbers, with no figure carried over", () => {
  const one = releaseCoverageLines({ releases: [KEPT], decisions: [QUEUE] });
  const three = releaseCoverageLines({
    releases: [KEPT, release("r-two", "v2.0.0", ["d-cache"], "04"), BARE],
    decisions: [QUEUE, CACHE],
  });

  assert.equal(one.claim,
    "1 of 1 release in this release log links at least one decision the decision log holds.");
  assert.equal(three.claim,
    "2 of 3 releases in this release log link at least one decision the decision log holds.");
  assert.notEqual(one.claim, three.claim, "the sentence did not follow the log");
});

test("a refused read names the failure and its recovery instead of an empty log", () => {
  const unread = releaseCoverageLines({ releases: [], decisions: [], unread: true });
  assert.equal(unread.claim, releaseCoverageUnread());
  assert.equal(unread.provenance, "", "a log nobody read has no records to attribute");

  // The distinguishing property: it must not be the sentence a genuinely empty
  // log gets, and it must not report a zero as a finding.
  assert.notEqual(unread.claim, releaseCoverageLines({ releases: [], decisions: [] }).claim);
  assert.doesNotMatch(unread.claim, /\d/, "a refused read reported a figure nobody counted");
  // It defers to the recovery the history already owns rather than inventing one.
  assert.ok(unread.claim.endsWith(HISTORY_UNREAD_ANNOUNCEMENT));
});

/* ---------------------------- the shipped bytes --------------------------- */

test("the block ships its caveats, its wait, and no counted figure", async () => {
  const html = await readFile(HOME_PAGE, "utf8");
  const document = parseHtml(html);
  const region = document.getElementById(RELEASE_COVERAGE_IDS.region);
  assert.ok(region, "the home page must carry the release-coverage block");
  assert.equal(region.getAttribute("aria-labelledby"), RELEASE_COVERAGE_IDS.heading);
  assert.equal(textOf(document.getElementById(RELEASE_COVERAGE_IDS.heading)),
    RELEASE_COVERAGE_HEADING);
  // The same name the releases page gives the same block, one level down: this
  // section already owns the page's h2.
  assert.equal(RELEASE_COVERAGE_HEADING, REASONING_PROOF_HEADING);
  assert.equal(document.getElementById(RELEASE_COVERAGE_IDS.heading).tagName, "H3");

  // What each figure counts, said before either of them arrives.
  const lead = textOf(document.getElementById(RELEASE_COVERAGE_IDS.lead));
  assert.equal(lead, RELEASE_COVERAGE_LEAD);
  assert.match(lead, /link at least one decision the decision log holds/);
  assert.match(lead, /out of how many were loaded/);

  // And the rule after it, which is the releases page's definition of "covered"
  // and "uncovered" byte for byte (#2712): one sentence naming both halves,
  // where this block used to carry two exclusions and define the word by
  // neither of them.
  assert.equal(textOf(document.getElementById(RELEASE_COVERAGE_IDS.rule)), COVERAGE_DEFINITION);
  assert.equal(RELEASE_COVERAGE_RULE, COVERAGE_DEFINITION);
  assert.match(textOf(document.getElementById(RELEASE_COVERAGE_IDS.rule)), /^A release is covered when/);
  assert.match(textOf(document.getElementById(RELEASE_COVERAGE_IDS.rule)), /every other release is uncovered\.$/);
  assert.equal(textOf(document.getElementById(RELEASE_COVERAGE_IDS.scope)), REASONING_PROOF_SCOPE);
  assert.equal(RELEASE_COVERAGE_SCOPE, REASONING_PROOF_SCOPE);

  // The two exclusions are gone from the whole page, not moved: the block below
  // that previews the evaluation summary quoted the same sentence.
  assert.doesNotMatch(textOf(document.body), /does not count/,
    "an exclusion survived somewhere on the home page");
  // And both the rule and the scope are stated once each in the served bytes.
  const said = textOf(document.body);
  assert.equal(said.split(COVERAGE_DEFINITION).length - 1, 1, "the definition is stated twice on the home page");
  assert.equal(said.split(REASONING_PROOF_SCOPE).length - 1, 1, "the scope note is stated twice on the home page");

  // No figure is authored: a number in the served bytes is a number nobody
  // counted, and it would still be on screen after a failed read.
  const claim = document.getElementById(RELEASE_COVERAGE_IDS.claim);
  assert.equal(textOf(claim), RELEASE_COVERAGE_COUNTING);
  assert.match(textOf(claim), /Still counting/);
  assert.doesNotMatch(textOf(claim), /\d/, "no count may be authored into the figure");
  assert.doesNotMatch(textOf(claim), /—|--/, "a wait is a sentence here, not a placeholder glyph");
  // Live from the first paint: a region inserted with its text is announced by
  // nothing, and these numbers move when a release is recorded.
  assert.equal(claim.getAttribute("role"), "status");
  assert.equal(claim.getAttribute("aria-live"), "polite");
  assert.equal(textOf(document.getElementById(RELEASE_COVERAGE_IDS.provenance)), "");

  // The section already states the example-records caveat once, in the panel
  // above; this block must not restate it in a second set of words.
  const section = textOf(document.getElementById("shiplog-entry"));
  assert.equal((section.match(/no customer or production data/g) ?? []).length, 1);
});

test("the figures sit with the section's evidence and above the record and search panels", async () => {
  const html = await readFile(HOME_PAGE, "utf8");
  const document = parseHtml(html);

  // With the worked example and the deployment check, inside the log's entry.
  const ancestors = [];
  for (let node = document.getElementById(RELEASE_COVERAGE_IDS.region); node; node = node.parentNode) {
    const id = node.getAttribute?.("id");
    if (id) ancestors.push(id);
  }
  assert.ok(ancestors.includes("shiplog-entry"),
    "the figures must sit in the section that carries the page's other evidence");

  const at = (marker) => html.indexOf(marker);
  const block = `id="${RELEASE_COVERAGE_IDS.region}"`;
  assert.ok(at('id="featured-decision"') < at(block),
    "the figures must follow the worked decision they describe");
  assert.ok(at('id="deployment-status"') < at(block),
    "the figures must follow the deployment check");
  assert.ok(at(block) < at('id="record-history"'),
    "the figures must be readable before the record and search panels");

  // The list's own filtered line keeps the `release-coverage` id, and this
  // block deliberately does not take it: app.js resolves that node by id in
  // document order, so a block named that above the list would be found first
  // and overwritten with the filtered sentence.
  assert.notEqual(RELEASE_COVERAGE_IDS.region, "release-coverage");
  assert.ok(at('id="release-coverage"') > at('id="record-history"'),
    "the filtered coverage line must stay with the list it describes");
});

test("the block adds no focusable to a section held to its tab stops", async (t) => {
  const page = await loadPage(HOME_PAGE);
  t.after(() => page.restore());
  const region = page.document.getElementById(RELEASE_COVERAGE_IDS.region);

  // Counted, never compared against a node: an equal() on a parsed element
  // stringifies the whole page and the run hangs instead of failing.
  assert.equal(region.querySelectorAll("a,button,input,textarea,select,[tabindex]").length, 0,
    "the figures are static text and may offer no control");

  const sequence = tabSequence(page.document);
  const inside = (node) => {
    for (let walk = node; walk; walk = walk.parentNode) {
      if (walk.getAttribute?.("id") === RELEASE_COVERAGE_IDS.region) return true;
    }
    return false;
  };
  assert.equal(sequence.filter(inside).length, 0, "the block took a tab stop");
});

/* ---------------------------- the booted page ----------------------------- */

async function openHome(t, { decisions = [QUEUE, CACHE], releases = [KEPT, DANGLING, BARE],
  seed = NO_SEED, refuse = false } = {}) {
  const page = await loadPage(HOME_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(decisions),
      [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
    },
    location: { pathname: "/", search: "", hash: "" },
  });
  t.after(() => page.restore());
  const { getItem } = page.storage;
  page.storage.getItem = (key) => {
    if (refuse && key === STORAGE_KEY) throw new Error("storage refused the read");
    return getItem(key);
  };
  await initDecisionLog(page.document, page.storage, {
    seed,
    location: { pathname: "/", search: "", hash: "" },
    history: { replaceState() {} },
    clipboard: { writeText: async () => {} },
  });
  return page;
}

const claimOf = (page) => textOf(page.document.getElementById(RELEASE_COVERAGE_IDS.claim));
const provenanceOf = (page) =>
  textOf(page.document.getElementById(RELEASE_COVERAGE_IDS.provenance));

test("the figures are painted from the loaded log, and a different log moves them", async (t) => {
  const three = await openHome(t);
  // The precondition: a fixture the loader dropped would land the page in an
  // empty log, where a sentence about nothing passes an assertion about nothing.
  assert.equal(three.document.documentElement.dataset.shiplog, "ready", "the log never rendered");
  assert.equal(claimOf(three),
    "1 of 3 releases in this release log links at least one decision the decision log holds.");
  assert.equal(provenanceOf(three), "Counted here: no example records and 3 you added.");

  // Change the records, and both numbers follow. Nothing is hard-coded.
  const two = await openHome(t, {
    decisions: [QUEUE, CACHE],
    releases: [KEPT, release("r-cache", "v2.0.0", ["d-cache"], "04")],
  });
  assert.equal(claimOf(two),
    "2 of 2 releases in this release log link at least one decision the decision log holds.");
  assert.equal(provenanceOf(two), "Counted here: no example records and 2 you added.");
});

test("the denominator is every release loaded, so a filter does not move it", async (t) => {
  const page = await openHome(t);
  const before = claimOf(page);
  assert.match(before, /of 3 releases/, "the fixtures did not all reach the count");

  // The search box is the narrowest filter on the page, and the scope sentence
  // beside the figures promises it changes neither number.
  const search = page.document.getElementById("decision-search");
  search.focus();
  typeText(page.document, "nothing will match this");
  assert.equal(claimOf(page), before,
    "a filter moved a figure the block promises filters do not move");
});

test("recording a release moves the figures without a reload", async (t) => {
  const page = await openHome(t, { releases: [KEPT], decisions: [QUEUE] });
  assert.equal(claimOf(page),
    "1 of 1 release in this release log links at least one decision the decision log holds.");

  for (const [field, value] of Object.entries({
    title: "Cache the read path everywhere",
    context: "Reads were slow on the hot path.",
    alternatives: "Leaving it alone.",
    owner: "Kai",
  })) {
    const control = page.document.getElementById(field);
    control.focus();
    typeText(page.document, value);
  }
  page.document.getElementById("status").value = "accepted";
  page.document.getElementById("decision-form").querySelector('button[type="submit"]').click();

  // The decision log grew, so the dangling half of the rule is what moved: the
  // sentence is re-derived on every data change rather than read once at boot.
  assert.match(claimOf(page), /of 1 release in this release log/);
  assert.equal(provenanceOf(page), "Counted here: no example records and 1 you added.");
});

test("an unreadable log says so here instead of reporting zero releases", async (t) => {
  const page = await openHome(t, { refuse: true });
  assert.equal(claimOf(page), releaseCoverageUnread());
  assert.doesNotMatch(claimOf(page), /\d/, "a refused read painted a figure nobody counted");
  assert.equal(provenanceOf(page), "");
  // And it is not the sentence an empty-but-readable log gets.
  assert.notEqual(claimOf(page),
    releaseCoverageLines({ releases: [], decisions: [] }).claim);
});

/* --------------------------- the two pages agree -------------------------- */

test("the home page and the releases page count one browser's log identically", async (t) => {
  const storage = {
    [STORAGE_KEY]: JSON.stringify([QUEUE, CACHE]),
    [RELEASE_STORAGE_KEY]: JSON.stringify([KEPT, DANGLING, BARE]),
  };

  const home = await loadPage(HOME_PAGE, { storage, location: { pathname: "/", search: "", hash: "" } });
  t.after(() => home.restore());
  await initDecisionLog(home.document, home.storage, {
    seed: NO_SEED,
    location: { pathname: "/", search: "", hash: "" },
    history: { replaceState() {} },
    clipboard: { writeText: async () => {} },
  });

  const releasesPage = await loadPage(RELEASES_PAGE, { storage });
  t.after(() => releasesPage.restore());
  initReleasesPage(releasesPage.document, releasesPage.storage, {
    seed: NO_SEED,
    location: { pathname: "/releases.html", origin: "https://labs.wawalu.org", search: "", hash: "" },
    history: { replaceState() {} },
    readHealth: async () => { throw new Error("no network in tests"); },
  });

  const onReleases = textOf(releasesPage.document.getElementById("reasoning-proof-claim"));
  assert.match(onReleases, /of 3 releases/, "the releases page never painted its figure");
  // The criterion that protects against drift: the two painted sentences are
  // equal because they are one sentence from one counter, not two copies.
  assert.equal(claimOf(home), onReleases);
  assert.equal(
    textOf(home.document.getElementById(RELEASE_COVERAGE_IDS.provenance)),
    textOf(releasesPage.document.getElementById("reasoning-proof-provenance")),
  );
  // Both pages state the same rule beside it, word for word: one definition of
  // "covered" and "uncovered", wherever a visitor meets it (#2712).
  assert.equal(
    textOf(home.document.getElementById(RELEASE_COVERAGE_IDS.rule)),
    textOf(releasesPage.document.getElementById("coverage-gap-definition")),
  );
});
