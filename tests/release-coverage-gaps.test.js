// THE COVERAGE GAP AS A REVIEWABLE WORKLIST (#2630).
//
// The figure above the release log says how many releases keep their reasoning.
// This file is about the releases it is short BY: that they can be revealed, that
// each one says WHICH of the two kinds of gap it has in words, that each one
// carries the one next step that applies to it, and that every number on screen
// comes from the list actually rendered rather than from a figure handed in.
//
// The pure half is asserted directly, because the words and the counting rule are
// the product. The painted half is driven through the shipped src/releases.html,
// booted the way the page boots it, and read back out of the DOM: "the reveal
// filters the log" is only true if the rows change, and the only way to know is
// to press it and count them.
//
// Determinism: no network, no timers, storage seeded per test.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
// The definition of "covered" and "uncovered" lives with the figure it is the
// rule for, in the coverage block above this list (#2712).
import { COVERAGE_DEFINITION, countReasoningKept } from "../src/release-reasoning-proof.js";
import {
  COVERAGE_GAP_HEADING,
  COVERAGE_GAP_MEMBERSHIP,
  NO_LINKED_DECISION_REASON,
  SHOW_ALL_RELEASES_LABEL,
  coverageGapAnnouncement,
  coverageGapCount,
  coverageGapLead,
  coverageGapNextStep,
  coverageGapView,
  coverageGaps,
  coverageStatusChip,
  revealGapsLabel,
} from "../src/release-coverage-gaps.js";
import { initReleasesPage } from "../src/releases-page.js";
import { loadPage, tabSequence, textOf, pressEnter, pressSpace } from "./support/browser.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const CSS = new URL("../src/releases-proof.css", import.meta.url);
const NO_SEED = { decisions: [], releases: [] };

const QUEUE = {
  id: "d-queue",
  title: "Adopt a durable queue",
  context: "Retries.",
  alternatives: "Nothing.",
  owner: "Kai",
  status: "accepted",
  createdAt: "2026-01-02T09:00:00.000Z",
};

const release = (id, version, decisionIds, day) => ({
  id,
  version,
  title: version,
  description: `What ${version} did.`,
  owner: "Kai",
  status: "completed",
  createdAt: `2026-03-0${day}T00:00:00.000Z`,
  decisionIds,
});

// KEPT resolves its one link; MIXED resolves one of two, so it is covered and the
// dangling half is the row's own business, not this worklist's; DANGLING resolves
// none of the links it recorded; BARE recorded none at all.
const KEPT = release("r-kept", "v1.0.0", ["d-queue"], 1);
const MIXED = release("r-mixed", "v1.1.0", ["d-queue", "d-gone"], 2);
const DANGLING = release("r-dangling", "v1.2.0", ["d-gone"], 3);
const BARE = release("r-bare", "v1.3.0", [], 4);
const ALL = [KEPT, MIXED, DANGLING, BARE];

// --- the counting and the words ----------------------------------------------

test("both kinds of gap are in the list, and a release that kept one link is not", () => {
  const gaps = coverageGaps(ALL, [QUEUE]);

  // Newest first, the order the log draws: BARE (the 4th) before DANGLING.
  assert.deepEqual(gaps.map((gap) => gap.id), ["r-bare", "r-dangling"]);
  assert.deepEqual(gaps.map((gap) => gap.kind), ["unlinked", "dangling"]);

  // The reason is the row's own sentence, not a colour and not a chip.
  assert.equal(gaps[0].reason, NO_LINKED_DECISION_REASON);
  assert.equal(gaps[0].reason, "No linked decision");
  assert.equal(gaps[1].reason, "Linked decision not found in the log: d-gone");
  // The dangling reference itself is surfaced, because it is the thing to check.
  assert.deepEqual(gaps[1].refs, ["d-gone"]);
  assert.deepEqual(gaps[0].refs, []);

  // The list is exactly what the figure above the log is short by, by
  // construction: it reads the same resolution the figure counts.
  const counts = countReasoningKept(ALL, [QUEUE]);
  assert.equal(gaps.length, counts.total - counts.preserved);
  assert.equal(counts.preserved, 2, "the fixture no longer covers a mixed release");
});

test("each gap carries the one next step that applies to it", () => {
  // Nothing linked, and decisions exist to link: link an existing one. The page
  // cannot edit a recorded release, so this is labelled guidance with no control.
  const linkable = coverageGaps([BARE], [QUEUE])[0].step;
  assert.equal(linkable.kind, "link-existing");
  assert.equal(linkable.href, null, "guidance was rendered as an operable control");
  assert.match(linkable.text, /^Next step: link an existing decision\./);
  assert.match(linkable.text, /1 decision to link/);

  // Nothing linked and nothing to link: record a decision first. This one is a
  // real destination, so it is the only step that gets a control.
  const first = coverageGaps([BARE], [])[0].step;
  assert.equal(first.kind, "record-decision");
  assert.equal(first.href, "/#decision-form");
  assert.equal(first.label, "Record a decision");
  assert.match(first.text, /record a decision first/);

  // A dangling reference: inspect it. Named in the step as well as in the reason.
  const dangling = coverageGaps([DANGLING], [QUEUE])[0].step;
  assert.equal(dangling.kind, "inspect-reference");
  assert.equal(dangling.href, null);
  assert.match(dangling.text, /inspect the missing reference/);
  assert.match(dangling.text, /d-gone/);

  // Exactly one step per gap, never a menu of all three.
  for (const step of [linkable, first, dangling]) {
    assert.equal(typeof step.kind, "string");
    assert.equal(Object.keys(step).sort().join(","), "href,kind,label,text");
  }
  // And the plural agrees with the count it names.
  assert.match(coverageGapNextStep({ kind: "unlinked" }, { linkableDecisions: 2 }).text, /2 decisions to link/);
});

test("the label, the announcement, the lead and the chip all name real values", () => {
  assert.equal(revealGapsLabel(4), "Review 4 uncovered releases");
  assert.equal(revealGapsLabel(1), "Review 1 uncovered release");
  assert.equal(SHOW_ALL_RELEASES_LABEL, "Show all releases");
  assert.equal(
    coverageGapAnnouncement({ count: 4, total: 19, uncoveredOnly: true }),
    "Showing 4 of 19 releases: uncovered only.",
  );
  assert.equal(coverageGapAnnouncement({ count: 4, total: 19 }), "Showing all 19 releases.");
  // The lead uses the word the block above defines rather than restating the
  // rule a third time, and it agrees with itself about how many releases it is
  // talking about.
  assert.match(coverageGapLead({ count: 2, total: 4 }), /^2 of 4 releases in this log are uncovered\./);
  assert.match(coverageGapLead({ count: 1, total: 4 }), /^1 of 4 releases in this log is uncovered\./);
  assert.doesNotMatch(coverageGapLead({ count: 2, total: 4 }), /no decision this log can show/);

  // The one filled chip. Its colour is never the message: the text says which
  // state it is and carries both values, so it reads the same in greyscale.
  assert.deepEqual(coverageStatusChip({ linked: 19, total: 19 }), {
    text: "All linked: 19 of 19",
    className: "badge badge-accepted",
  });
  assert.deepEqual(coverageStatusChip({ linked: 15, total: 19 }), {
    text: "Uncovered: 4 of 19",
    className: "badge badge-missing",
  });
  // An empty log has no coverage status to state.
  assert.equal(coverageStatusChip({ linked: 0, total: 0 }), null);
});

test("a supplied count larger than the log is discarded and the three numbers agree", () => {
  // The oversized-count clamp at unit level: 40 uncovered releases claimed, four
  // releases present, two of them actually uncovered.
  const view = coverageGapView(ALL, [QUEUE], { reported: 40 });

  assert.equal(view.count, 2);
  assert.equal(view.total, 4);
  assert.equal(view.gaps.length, 2, "the rendered rows disagree with the count");
  assert.equal(revealGapsLabel(view.count), "Review 2 uncovered releases");
  assert.equal(
    coverageGapAnnouncement({ ...view, uncoveredOnly: true }),
    "Showing 2 of 4 releases: uncovered only.",
  );
  assert.match(coverageGapLead(view), /^2 of 4 releases/);
  // The figure above the block and this one cannot disagree either.
  assert.equal(view.linked, countReasoningKept(ALL, [QUEUE]).preserved);

  // Clamped to the releases present even if the gap list itself were longer than
  // the log, which is the only way the row count could exceed the total.
  assert.equal(coverageGapCount([1, 2, 3], [1, 2], 99), 2);
  assert.equal(coverageGapCount([], [1, 2], 7), 0);
  // No log, no claim: there is nothing to be short of.
  const empty = coverageGapView([], [], { reported: 12 });
  assert.equal(empty.count, 0);
  assert.equal(empty.actionable, false);
});

// --- the painted page ---------------------------------------------------------

async function openPage(t, { releases = ALL, decisions = [QUEUE], refuse = false, options = {} } = {}) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(decisions),
      [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
    },
  });
  t.after(() => page.restore());
  const { getItem } = page.storage;
  const control = { refuse, refuseDecisions: false, seen: [] };
  page.storage.getItem = (key) => {
    if (key === STORAGE_KEY && control.refuseDecisions) throw new Error("decision read refused");
    if (key === RELEASE_STORAGE_KEY) {
      control.seen.push({
        loadingText: textOf(page.document.querySelector("#coverage-gap-result")),
        busy: page.document.querySelector("#reasoning-proof").getAttribute("aria-busy"),
        revealHidden: page.document.querySelector("#coverage-gap-toggle").hidden,
        chipHidden: page.document.querySelector("#coverage-gap-chip").hidden,
      });
      if (control.refuse) throw new Error("storage refused the read");
    }
    return getItem(key);
  };
  initReleasesPage(page.document, page.storage, { seed: NO_SEED, ...options });
  return { page, control };
}

const byId = (page, id) => page.document.querySelector(`#${id}`);
const rowIds = (page) => page.document
  .querySelectorAll(".release-toggle")
  .map((node) => node.getAttribute("data-release-id"));
const gapItems = (page) => byId(page, "coverage-gap-list")
  .children
  .filter((node) => node.getAttribute?.("data-gap-kind"));
const activeId = (page) => page.document.activeElement?.getAttribute?.("id") ?? null;

test("incomplete coverage offers a real button naming the derived count", async (t) => {
  const { page } = await openPage(t);
  const toggle = byId(page, "coverage-gap-toggle");

  assert.equal(toggle.tagName, "BUTTON");
  assert.equal(toggle.getAttribute("type"), "button");
  assert.equal(toggle.hidden, false, "the reveal never appeared for an incomplete log");
  assert.equal(textOf(toggle), "Review 2 uncovered releases");
  assert.equal(toggle.getAttribute("aria-label"), null, "the visible label is not the accessible name");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(toggle.getAttribute("aria-controls"), "coverage-gap-worklist");
  assert.equal(toggle.getAttribute("tabindex"), null, "the reveal carries a tabindex of its own");
  assert.ok(tabSequence(page.document).includes(toggle), "the reveal is not reachable by Tab");

  // The live coverage status: one filled chip, colour plus the same words and
  // values it would be read by with no colour at all.
  const chip = byId(page, "coverage-gap-chip");
  assert.equal(chip.hidden, false);
  assert.equal(textOf(chip), "Uncovered: 2 of 4");
  assert.equal(chip.className, "badge badge-missing");

  // Nothing is announced before anything has changed.
  assert.equal(textOf(byId(page, "coverage-gap-status")), "");
  assert.equal(byId(page, "coverage-gap-worklist").hidden, true);
  assert.equal(byId(page, "reasoning-proof").getAttribute("aria-busy"), "false");
});

test("the reveal filters the log to the uncovered rows, moves focus, and announces both numbers", async (t) => {
  const { page } = await openPage(t);
  const toggle = byId(page, "coverage-gap-toggle");
  assert.deepEqual(rowIds(page), ["r-bare", "r-dangling", "r-mixed", "r-kept"]);

  toggle.click();

  // Exactly the uncovered releases, in the log's own order.
  assert.deepEqual(rowIds(page), ["r-bare", "r-dangling"]);
  assert.equal(gapItems(page).length, 2, "the worklist and the rows disagree");
  assert.equal(activeId(page), "coverage-gap-worklist", "focus stayed on the control");
  assert.equal(byId(page, "coverage-gap-worklist").getAttribute("tabindex"), "-1");
  assert.equal(byId(page, "coverage-gap-worklist").hidden, false);
  assert.equal(textOf(byId(page, "coverage-gap-worklist-title")), COVERAGE_GAP_HEADING);

  // Expansion is exposed; reviewing again keeps the count-bearing action.
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(textOf(toggle), "Review 2 uncovered releases");

  // Both numbers, in a polite region that is in the normal flow of the block.
  const status = byId(page, "coverage-gap-status");
  assert.equal(textOf(status), "Showing 2 of 4 releases: uncovered only.");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(status.getAttribute("role"), "status");
  // Not tucked inside a disclosure, which would silence it in a real browser.
  for (let node = status.parentNode; node; node = node.parentNode) {
    assert.notEqual(node.tagName, "DETAILS", "the announcement sits inside a disclosure");
  }
  // The log's own count sentence states the same two numbers rather than a third.
  assert.equal(textOf(byId(page, "release-count")), "Showing 2 of 4 releases, newest first.");

  byId(page, "coverage-gap-reset").click();
  assert.equal(activeId(page), "coverage-gap-toggle");
  assert.deepEqual(rowIds(page), ["r-bare", "r-dangling", "r-mixed", "r-kept"]);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(textOf(toggle), "Review 2 uncovered releases");
  assert.equal(textOf(status), "Showing all 4 releases.");
  assert.equal(byId(page, "coverage-gap-worklist").hidden, true);
});

// --- the words themselves (#2635) --------------------------------------------

/**
 * The page's own words, with the deployment record and the check that quotes it
 * left out.
 *
 * Those two blocks print a git commit subject, which this page neither writes
 * nor bounds — and the commit that landed the definition below is itself titled
 * `Define "uncovered" on Releases` (#2636). So after any build, the first
 * "uncovered" on the page came from the deployment record, and the order check
 * reported a control using the word before the definition when no control did.
 * The claim under test is about the page's vocabulary: the chip, the reveal's
 * label and the worklist. tests/shiplog-proof.test.js excludes rendered record
 * text from its caveat walk for the same reason.
 *
 * Excluded text is blanked rather than cut, so every index still refers to the
 * same position in the painted page.
 */
const RECORD_REGIONS = ["real-deployment", "deployment-status"];

function pageVocabulary(document) {
  let said = textOf(document.body);
  for (const id of RECORD_REGIONS) {
    const region = document.getElementById(id);
    if (!region) continue;
    const recited = textOf(region);
    if (recited) said = said.replace(recited, " ".repeat(recited.length));
  }
  return said;
}

test("the page says what covered and uncovered mean before either word is used", async (t) => {
  const { page } = await openPage(t);
  assert.equal(textOf(byId(page, "coverage-gap-definition")), COVERAGE_DEFINITION);

  // RENDERED order, not source order: the definition has to reach the screen
  // ahead of the chip and the reveal's label, both of which are written by
  // script after the log loads. Read off the painted body for that reason.
  const said = pageVocabulary(page.document);
  const defined = said.indexOf(COVERAGE_DEFINITION);
  assert.ok(defined >= 0, "the definition never rendered on the page");
  const firstUse = said.search(/uncovered/i);
  assert.ok(firstUse > defined, "a control says “uncovered” before the page defines it");
  assert.ok(
    firstUse < defined + COVERAGE_DEFINITION.length,
    "the first “uncovered” on the page is not the one in the definition",
  );
  // The three places the word is a label, all of them below it.
  for (const later of ["Uncovered: 2 of 4", "Review 2 uncovered releases"]) {
    assert.ok(said.indexOf(later) > defined, `“${later}” stands above the definition`);
  }
  // It is authored, not written by script: a reader who arrives before the log
  // loads still meets the word's meaning.
  const cold = await loadPage(RELEASES_PAGE, { storage: {} });
  t.after(() => cold.restore());
  assert.equal(textOf(cold.document.querySelector("#coverage-gap-definition")), COVERAGE_DEFINITION);
});

test("the worklist is named by the defined word, and states both ways in", async (t) => {
  const { page } = await openPage(t);
  assert.equal(COVERAGE_GAP_HEADING, "Uncovered releases");

  byId(page, "coverage-gap-toggle").click();
  assert.equal(textOf(byId(page, "coverage-gap-worklist-title")), COVERAGE_GAP_HEADING);
  const said = textOf(page.document.body);
  assert.ok(said.includes(COVERAGE_GAP_HEADING), "the worklist heading never rendered");
  assert.ok(said.indexOf(COVERAGE_GAP_HEADING) > said.indexOf(COVERAGE_DEFINITION));

  // Both ways a release gets here, in one authored sentence directly under the
  // heading: nothing linked, or every link pointing at a record this log lost.
  // Authored, because it is true of the list before any of it is drawn.
  assert.equal(textOf(byId(page, "coverage-gap-worklist-rule")), COVERAGE_GAP_MEMBERSHIP);
  assert.match(COVERAGE_GAP_MEMBERSHIP, /links no decision at all/);
  assert.match(COVERAGE_GAP_MEMBERSHIP, /this log does not hold\.$/);
  assert.ok(
    said.indexOf(COVERAGE_GAP_HEADING) < said.indexOf(COVERAGE_GAP_MEMBERSHIP),
    "the membership sentence renders above the heading it belongs to",
  );
  assert.ok(
    said.indexOf(COVERAGE_GAP_MEMBERSHIP) < said.indexOf(textOf(byId(page, "coverage-gap-worklist-lead"))),
    "the membership sentence renders below the count it introduces",
  );
  // It leaves the defined word to the heading, so the definition above stays the
  // page's first use of it.
  assert.doesNotMatch(COVERAGE_GAP_MEMBERSHIP, /uncovered/i);

  // Nothing on the page still names this region with a sentence of its own,
  // including the two headings this one replaced.
  assert.doesNotMatch(said, /no decision this log can show/i);
  assert.doesNotMatch(said, /Releases with no linked decision in this log/i);
  const markup = await readFile(RELEASES_PAGE, "utf8");
  assert.ok(markup.includes(COVERAGE_GAP_MEMBERSHIP), "the membership sentence is written by script, not authored");
  assert.equal(
    markup.includes("Releases with no linked decision in this log"),
    false,
    "src/releases.html still ships the retired worklist heading",
  );
  assert.equal(
    textOf(byId(page, "coverage-gap-worklist-lead")),
    "2 of 4 releases in this log are uncovered. Each one states why below, with the next step for that reason.",
  );
  // The filter option below is a separate piece of wording and is untouched.
  assert.match(said, /Decision not in this log/);
});

test("each revealed release states its reason in words and its own next step", async (t) => {
  const { page } = await openPage(t);
  byId(page, "coverage-gap-toggle").click();
  const items = gapItems(page);
  assert.equal(items.length, 2);

  // Both classes of gap are in the revealed view, each as a sentence.
  const said = items.map((item) => textOf(item));
  assert.match(said[0], /^v1\.3\.0No linked decisionNext step: link an existing decision\./);
  assert.match(said[1], /^v1\.2\.0Linked decision not found in the log: d-goneNext step: /);
  assert.match(said[1], /Look for d-gone in the decision log/);

  // The distinction is never carried by colour or fill: no chip inside a row.
  for (const item of items) {
    const classes = [];
    const walk = (node) => {
      for (const child of node.children ?? []) {
        if (!child.getAttribute) continue;
        classes.push(child.className ?? "");
        walk(child);
      }
    };
    walk(item);
    for (const name of classes) assert.doesNotMatch(name, /badge/, "a reason is drawn as a chip");
  }

  // One step per row, and the step matches the reason it follows.
  assert.deepEqual(items.map((item) => item.getAttribute("data-gap-kind")), ["unlinked", "dangling"]);
  const stepKinds = items.map((item) => item.children
    .filter((node) => node.getAttribute?.("data-gap-step"))
    .map((node) => node.getAttribute("data-gap-step")));
  assert.deepEqual(stepKinds, [["link-existing"], ["inspect-reference"]]);

  // Neither of those two is wired to anything, so neither is rendered as a
  // control: nothing here can be pressed to no effect.
  assert.equal(byId(page, "coverage-gap-list").querySelectorAll("a").length, 0);
});

test("with nothing to link, the applicable step is the one real destination", async (t) => {
  const { page } = await openPage(t, { releases: [BARE], decisions: [] });
  byId(page, "coverage-gap-toggle").click();
  const links = byId(page, "coverage-gap-list").querySelectorAll("a");

  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute("href"), "/#decision-form");
  assert.equal(textOf(links[0]), "Record a decision");
  assert.match(textOf(gapItems(page)[0]), /record a decision first/);
});

// --- the five states ---------------------------------------------------------

test("while the log is unknown there is no reveal, and the coverage block says it is busy", async (t) => {
  const { page, control } = await openPage(t);

  // Observed at the moment of every read of the release key, which is the only
  // moment the page is in its loading state.
  assert.ok(control.seen.length > 0, "the release log was never read");
  for (const seen of control.seen) {
    assert.equal(seen.busy, "true", "the coverage block did not state its wait");
    assert.equal(seen.revealHidden, true, "a reveal was offered while the data was unknown");
    assert.equal(seen.chipHidden, true, "a coverage status was claimed before the log loaded");
  }
  // The skeleton is the block's wait for the eye, and it is decorative: the log's
  // status region is the page's one voice for the wait.
  const skeleton = byId(page, "coverage-gap-skeleton");
  assert.equal(skeleton.getAttribute("aria-hidden"), "true");
  assert.equal(textOf(skeleton), "");
  // And the authored page — before any module runs — is already in that state.
  const markup = await readFile(RELEASES_PAGE, "utf8");
  assert.match(markup, /id="reasoning-proof" aria-labelledby="reasoning-proof-title" aria-busy="true"/);
  assert.match(markup, /id="coverage-gap-toggle"[^>]*hidden/);
  assert.match(markup, /id="coverage-gap-worklist"[^>]*hidden/);
});

test("a log that could not be read offers Retry and no coverage claim, and the retry recovers", async (t) => {
  const { page, control } = await openPage(t, { refuse: true });

  assert.equal(rowIds(page).length, 0);
  assert.equal(byId(page, "coverage-gap-toggle").hidden, true, "a reveal was offered for a log that is not there");
  assert.equal(byId(page, "coverage-gap-chip").hidden, true);
  assert.equal(byId(page, "coverage-gap-worklist").hidden, true);
  // The log's own error state, with the one action that can recover the page.
  const status = byId(page, "release-list-status");
  assert.equal(textOf(status.querySelector("h3")), "Couldn’t load releases");
  const retry = status.querySelector("button");
  assert.equal(textOf(retry), "Retry");
  assert.equal(byId(page, "reasoning-proof").getAttribute("aria-busy"), "false");

  // A Retry that loads re-runs the read and brings the reveal with the rows.
  control.refuse = false;
  retry.click();
  assert.equal(rowIds(page).length, 4, "the retry did not recover the log");
  assert.equal(byId(page, "coverage-gap-toggle").hidden, false);
  assert.equal(textOf(byId(page, "coverage-gap-toggle")), "Review 2 uncovered releases");
  assert.equal(textOf(byId(page, "coverage-gap-chip")), "Uncovered: 2 of 4");
});

test("an empty log states that coverage does not apply and offers no reveal at all", async (t) => {
  const { page } = await openPage(t, { releases: [] });

  assert.equal(
    textOf(byId(page, "reasoning-proof-claim")),
    "No releases are loaded here, so there are none to count.",
  );
  // Not "0% covered", and not a disabled control either: the action is absent.
  assert.equal(byId(page, "coverage-gap-toggle").hidden, true);
  assert.equal(byId(page, "coverage-gap-chip").hidden, true);
  assert.equal(textOf(byId(page, "coverage-gap-worklist-lead")), "", "a 0 of 0 finding was stated");
  assert.equal(
    tabSequence(page.document).filter((stop) => stop.getAttribute?.("id") === "coverage-gap-toggle").length,
    0,
  );
  // And the hidden control is stripped, not left holding "Review 0 uncovered
   // releases" for a reader who searches the page for its own text.
  assert.equal(textOf(byId(page, "coverage-gap-toggle")), "");
  // No count and no coverage status anywhere in the block. The definition of
  // the word stays — it is authored, and it is true of an empty log too.
  const block = textOf(byId(page, "reasoning-proof"));
  assert.doesNotMatch(block, /\d+ uncovered/i, "a count was claimed for a log with nothing in it");
  assert.ok(block.includes(COVERAGE_DEFINITION));
  assert.equal(textOf(byId(page, "coverage-gap-result")),
    "Covered: 0. Total: 0. Uncovered: 0. No uncovered releases to review.");
});

test("complete coverage is a positive statement with the real values and no reveal", async (t) => {
  const { page } = await openPage(t, { releases: [KEPT, MIXED] });

  assert.equal(
    textOf(byId(page, "reasoning-proof-claim")),
    "2 of 2 releases in this release log link at least one decision the decision log holds.",
  );
  assert.equal(textOf(byId(page, "coverage-gap-chip")), "All linked: 2 of 2");
  assert.equal(byId(page, "coverage-gap-chip").className, "badge badge-accepted");
  assert.equal(byId(page, "coverage-gap-toggle").hidden, true);
  assert.equal(byId(page, "coverage-gap-worklist").hidden, true);
  assert.equal(gapItems(page).length, 0);
});

test("a supplied uncovered figure never reaches the page", async (t) => {
  // The page is handed a count larger than the whole release array.
  const { page } = await openPage(t, { options: { reportedUncovered: 40 } });
  const toggle = byId(page, "coverage-gap-toggle");

  assert.equal(textOf(toggle), "Review 2 uncovered releases");
  assert.equal(textOf(byId(page, "coverage-gap-chip")), "Uncovered: 2 of 4");
  toggle.click();
  // The three numbers that must always agree: the label, the summary sentence,
  // and the rows actually drawn.
  assert.equal(textOf(toggle), "Review 2 uncovered releases");
  assert.equal(textOf(byId(page, "coverage-gap-status")), "Showing 2 of 4 releases: uncovered only.");
  assert.match(textOf(byId(page, "coverage-gap-worklist-lead")), /^2 of 4 releases/);
  assert.equal(gapItems(page).length, 2);
  assert.equal(rowIds(page).length, 2);
  assert.doesNotMatch(textOf(byId(page, "reasoning-proof")), /40/);
});

// --- focus order, and what the CSS is asked to do ----------------------------

test("the reveal takes its place in reading order and adds one tab stop", async (t) => {
  const { page } = await openPage(t);
  const sequence = tabSequence(page.document);
  const at = (id) => sequence.findIndex((stop) => stop.getAttribute?.("id") === id);

  // Coverage status, then the reveal, then the log: the chip is not focusable, so
  // the reveal is the block's first stop and it stands before every control the
  // log has. Nothing existing moved.
  assert.equal(at("coverage-gap-toggle") >= 0, true, "the reveal is not reachable");
  assert.ok(at("coverage-gap-toggle") < at("reasoning-proof-copy"));
  assert.ok(at("reasoning-proof-copy") < at("release-search"));
  assert.ok(at("release-search") < at("release-status"));
  assert.equal(
    sequence.filter((stop) => stop.getAttribute?.("id") === "coverage-gap-toggle").length,
    1,
    "the reveal is more than one tab stop",
  );
  // The worklist is focusable only by script, so revealing it reorders nothing.
  byId(page, "coverage-gap-toggle").click();
  assert.equal(
    tabSequence(page.document).filter((stop) => stop.getAttribute?.("id") === "coverage-gap-worklist").length,
    0,
    "the worklist took a tab stop",
  );
  assert.equal(byId(page, "coverage-gap-chip").getAttribute("tabindex"), null);
});

test("the block pays for its rules in the page's own sheet and wraps at a phone width", async () => {
  const css = await readFile(CSS, "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  // Nothing on this page reads matchMedia or innerWidth, so the narrow-width
  // behaviour is asserted here, against the rules that produce it.
  assert.match(css, /@media\(max-width:520px\) \{ \.coverage-gap-reveal\{align-items:stretch;flex-direction:column\}/);
  assert.match(css, /\.coverage-gap-reveal \.empty-action\{width:100%/, "the reveal does not fill the column at 390px");
  assert.match(css, /\.coverage-gap-worklist \{[^}]*min-width:0/, "a long title can widen the page");
  assert.match(css, /\.coverage-gap-worklist \{[^}]*overflow-wrap:anywhere/, "a raw reference cannot break");
  // The wait ends when the log answers, and the announcement is never collapsed:
  // a live region that appears with its first text is announced by nothing.
  assert.match(css, /#reasoning-proof\[aria-busy="false"\] \.coverage-gap-skeleton \{ display:none; \}/);
  assert.doesNotMatch(css, /#coverage-gap-status:empty/);
  // The programmatic focus target shows a ring, like the other one on the site.
  assert.match(css, /\.coverage-gap-worklist:focus \{ outline:3px solid var\(--focus-ring\)/);
  // The measured stylesheet gained nothing: every class reused is already in it.
  assert.doesNotMatch(styles, /coverage-gap/, "the measured stylesheet gained a rule for this block");
  for (const selector of [".badge ", ".badge-missing ", ".badge-accepted ", ".empty-action ", ".text-link "]) {
    assert.ok(styles.includes(`${selector}{`), `${selector}is no longer in the sheet this block reuses`);
  }
});

// The contrast of every pair this block puts on screen, computed from the token
// values themselves rather than eyeballed: the harness models no layout and no
// cascade, so a ratio is the only thing a test can honestly check here.
const luminance = (hex) => {
  const channel = (pair) => {
    const value = parseInt(pair, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

test("every pair this block draws clears the contrast floor", () => {
  const pairs = [
    ["the reason sentence", "#3f4b45", "#ffffff", 4.5],
    ["the next step", "#555550", "#ffffff", 4.5],
    ["the uncovered chip", "#8a2b2b", "#f6dede", 4.5],
    ["the all-linked chip", "#205d2b", "#dcefdc", 4.5],
    ["the next-step link", "#1f70c1", "#ffffff", 4.5],
    ["the reveal's label", "#171713", "#ffffff", 4.5],
    // Non-text: the reveal's border and the focus ring, against the block's wash.
    ["the reveal's border", "#7a7a74", "#eef6f2", 3],
    ["the focus ring", "#155f9e", "#ffffff", 3],
  ];
  for (const [name, ink, ground, floor] of pairs) {
    const ratio = contrast(ink, ground);
    assert.ok(ratio >= floor, `${name}: ${ink} on ${ground} is ${ratio.toFixed(2)}:1, under ${floor}:1`);
  }
  // The computation itself, against a pair with a known answer.
  assert.equal(Math.round(contrast("#000000", "#ffffff")), 21);
});


test("keyboard review reveals and scrolls the existing worklist, including with conflicting filters", async (t) => {
  const { page } = await openPage(t);
  const search = byId(page, "release-search");
  search.value = "not a matching release";
  search.dispatchEvent({ type: "input", bubbles: true });
  const target = byId(page, "coverage-gap-worklist");
  let scrolls = 0;
  target.scrollIntoView = (options) => {
    assert.equal(target.hidden, false);
    assert.equal(activeId(page), target.id);
    assert.equal(options.behavior, "instant");
    scrolls++;
  };
  const review = byId(page, "coverage-gap-toggle");
  review.focus();
  pressEnter(page.document);
  assert.equal(scrolls, 1);
  assert.deepEqual(rowIds(page), ["r-bare", "r-dangling"]);
  assert.equal(gapItems(page).length, 2);
  assert.match(textOf(target), /v1.3.0/);
  assert.match(textOf(target), /v1.2.0/);
  review.focus();
  pressSpace(page.document);
  assert.equal(scrolls, 2, "reviewing again must navigate, not hide the destination");
  assert.equal(target.hidden, false);
});

test("coverage retry exposes loading and keyboard recovery without focus on passive updates", async (t) => {
  const { page, control } = await openPage(t, { refuse: true });
  const result = byId(page, "coverage-gap-result");
  assert.match(textOf(result), /Couldn’t count coverage/);
  const retry = byId(page, "coverage-gap-retry");
  retry.focus();
  pressSpace(page.document);
  assert.equal(activeId(page), "coverage-gap-retry");
  assert.equal(retry.hidden, false);
  control.refuse = false;
  control.seen.length = 0;
  pressEnter(page.document);
  assert.ok(control.seen.some((seen) => seen.busy === "true" && seen.revealHidden && seen.loadingText === "Counting releases…"));
  assert.equal(textOf(result), "Covered: 2. Total: 4. Uncovered: 2.");
  assert.equal(activeId(page), "coverage-gap-toggle");
  const search = byId(page, "release-search");
  search.focus();
  search.dispatchEvent({ type: "input", bubbles: true });
  assert.equal(activeId(page), "release-search");
});

test("complete coverage explicitly states all three counts", async (t) => {
  const { page } = await openPage(t, { releases: [KEPT] });
  assert.equal(textOf(byId(page, "coverage-gap-result")),
    "Covered: 1. Total: 1. Uncovered: 0. No uncovered releases to review.");
  assert.equal(byId(page, "coverage-gap-toggle").hidden, true);
});


test("an unread decision log fails coverage and retries both stores", async (t) => {
  const { page, control } = await openPage(t, { refuse: true });
  control.refuse = false;
  control.refuseDecisions = true;
  const retry = byId(page, "coverage-gap-retry");
  retry.focus();
  pressEnter(page.document);
  assert.match(textOf(byId(page, "coverage-gap-result")), /Couldn’t count coverage/);
  assert.equal(byId(page, "coverage-gap-toggle").hidden, true);
  assert.equal(activeId(page), "coverage-gap-retry");
  control.refuseDecisions = false;
  pressEnter(page.document);
  assert.equal(textOf(byId(page, "coverage-gap-result")), "Covered: 2. Total: 4. Uncovered: 2.");
});


test("initial counting leaves keyboard focus alone", async (t) => {
  const page = await loadPage(RELEASES_PAGE, { storage: {} });
  t.after(() => page.restore());
  const search = byId(page, "release-search");
  search.focus();
  assert.equal(textOf(byId(page, "coverage-gap-result")), "Counting releases…");
  initReleasesPage(page.document, page.storage, { seed: NO_SEED });
  assert.equal(activeId(page), "release-search");
});

test("long count labels retain the value and the controls allow wrapping", async () => {
  assert.equal(revealGapsLabel(123456789012345), "Review 123456789012345 uncovered releases");
  const css = await readFile(CSS, "utf8");
  assert.match(css, /\.coverage-gap-reveal \.empty-action \{[^}]*min-width:0;[^}]*white-space:normal;[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.coverage-gap-reveal \.badge \{[^}]*white-space:normal/);
});
