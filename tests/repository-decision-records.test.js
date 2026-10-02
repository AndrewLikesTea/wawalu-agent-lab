// Shiplog's own decisions, in Shiplog's own log (#2695).
//
// The home page's log used to hold nothing but invented examples, which left a
// buyer with no way to see the product used on a real history. Three of this
// repository's merged decisions are seeded alongside them now, and the point of
// this file is that they are a THIRD CLASS rather than examples wearing a
// different badge: counted separately, marked separately, citable to the pull
// request that merged them, and never attached to an invented release.
//
// Determinism: no network. loadPage throws on any request, and the PR links are
// built from a constant, so nothing here reaches github.com.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  countRecordProvenance,
  initDecisionLog,
  isRepositoryRecord,
  provenanceSplitLine,
  recordProvenance,
  REPOSITORY_VIEW_NOTE,
  selectHistory,
  STORAGE_KEY,
  toHistoryRecords,
} from "../src/app.js";
import { REPOSITORY_ONLY_LABEL, REPOSITORY_ONLY_VALUE } from "../src/history-filters.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import {
  EXAMPLE_LABEL,
  REPOSITORY_DECISIONS,
  REPOSITORY_LABEL,
  REPOSITORY_RELEASE_ABSENT,
  REPOSITORY_URL,
  SEED_DECISIONS,
  SEED_EXAMPLE_COUNT,
  SEED_RECORD_COUNT,
  SEED_RELEASES,
  pullRequestUrl,
} from "../src/seed-records.js";
import { loadPage, parseHtml, pressSpace, pressTab, tabSequence, textOf } from "./support/browser.js";

const HOME_PAGE = new URL("../src/index.html", import.meta.url);
const REPOSITORY_COUNT = REPOSITORY_DECISIONS.length;

async function openHome(t, { decisions = [], releases = [] } = {}) {
  const page = await loadPage(HOME_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(decisions),
      [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
    },
  });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage);
  assert.equal(page.document.documentElement.dataset.shiplog, "ready");
  return page;
}

// `.history-card` is the card ANCHOR, and the row's relationship lines are its
// siblings inside the article that wraps it — so a claim about the whole row
// has to be read off the article. The harness rejects descendant selectors, so
// the article is reached by walking up from the card rather than by a query.
const cards = (page) => page.document.querySelector("#decision-list").querySelectorAll(".history-card");
const rows = (page) => cards(page).map((card) => card.parentNode);
const repositoryRows = (page) =>
  rows(page).filter((row) => row.querySelectorAll(".badge-repository").length === 1);
const rowFor = (page, id) =>
  repositoryRows(page).find((row) => row.getAttribute("id") === `decision-${id}`);

// --- the data, and the one place the class is decided ----------------------

test("every repository record carries its own provenance and is in the seeded log", () => {
  assert.ok(REPOSITORY_COUNT >= 1, "no repository records are seeded");

  for (const record of REPOSITORY_DECISIONS) {
    assert.ok(SEED_DECISIONS.includes(record), `${record.id} is not in the seeded log`);
    // Provenance is DATA on the record, not a pattern in its title. A title is
    // copy and someone will reword it; this field is what the badge, the count
    // and the release rule all read.
    assert.equal(typeof record.repository?.pullRequest, "number");
    assert.ok(record.repository.pullRequest > 0);
    // Nothing is filled in: a record with no recorded context, alternatives or
    // owner must not be seeded at all.
    for (const field of ["title", "context", "alternatives", "owner", "status", "createdAt"]) {
      assert.equal(typeof record[field], "string", `${record.id} has no ${field}`);
      assert.notEqual(record[field].trim(), "", `${record.id} has an empty ${field}`);
    }
    assert.ok(!Number.isNaN(Date.parse(record.createdAt)), `${record.id} has an unparseable date`);
  }

  // Distinct records, distinct pull requests.
  const numbers = REPOSITORY_DECISIONS.map(({ repository }) => repository.pullRequest);
  assert.equal(new Set(numbers).size, REPOSITORY_COUNT, "two records cite the same pull request");
  const ids = REPOSITORY_DECISIONS.map(({ id }) => id);
  assert.equal(new Set(ids).size, REPOSITORY_COUNT);
});

test("the three classes are derived from one predicate, and only one applies to a record", () => {
  const [repositoryRecord] = REPOSITORY_DECISIONS;

  // `repository` wins over `example`, which a seeded record also carries: the
  // extra class is a finer answer inside the not-this-browser's set, so a
  // repository record must never also be counted as an example.
  assert.equal(recordProvenance({ repository: repositoryRecord.repository, example: true }), "repository");
  assert.equal(recordProvenance({ example: true }), "example");
  assert.equal(recordProvenance({}), "added");
  assert.equal(recordProvenance(), "added");
  assert.equal(isRepositoryRecord({ repository: repositoryRecord.repository }), true);
  assert.equal(isRepositoryRecord({ example: true }), false);

  // The split is exhaustive: no record falls outside the three, at any mix.
  const split = countRecordProvenance([
    { example: true },
    { example: true },
    { repository: { pullRequest: 1 }, example: true },
    {},
  ]);
  assert.deepEqual(split, { total: 4, examples: 2, repository: 1, added: 1 });
  assert.equal(split.examples + split.repository + split.added, split.total);
});

// --- the three-way count line ---------------------------------------------

test("the record-count summary counts the three classes separately", async (t) => {
  const page = await openHome(t);
  const split = textOf(page.document.querySelector("#decision-provenance"));

  assert.equal(
    split,
    `· ${SEED_EXAMPLE_COUNT} example records · ${REPOSITORY_COUNT} from this repository · none you added`,
  );
  // The three numbers are the rows on screen, not a written-down constant.
  assert.equal(rows(page).length, SEED_RECORD_COUNT);
  assert.equal(SEED_EXAMPLE_COUNT + REPOSITORY_COUNT, SEED_RECORD_COUNT);
  assert.equal(repositoryRows(page).length, REPOSITORY_COUNT);
  assert.equal(
    rows(page).filter((row) => textOf(row).includes(EXAMPLE_LABEL)).length,
    SEED_EXAMPLE_COUNT,
    "a repository row is being counted as an example",
  );

  // The static first paint says the same thing, so the split is right before a
  // script runs rather than gaining a class after the log settles.
  const html = await readFile(HOME_PAGE, "utf8");
  const parsed = (await import("./support/browser.js")).parseHtml(html);
  assert.equal(textOf(parsed.querySelector("#decision-provenance")), split);
});

test("the repository class is named only when the counted set holds one", () => {
  // This is what keeps the release-coverage sentence and the releases page's
  // reasoning figure byte-identical: both count releases, no release is a
  // repository record, so neither ever grows a third clause.
  assert.equal(
    provenanceSplitLine([{ example: true }, {}]),
    "· 1 example record · 1 you added",
  );
  assert.equal(
    provenanceSplitLine([{ example: true }, { repository: { pullRequest: 1 } }]),
    "· 1 example record · 1 from this repository · none you added",
  );
  assert.equal(provenanceSplitLine([]), "");
});

// --- the pull request link -------------------------------------------------

test("a repository row names its pull request and links it in the public repository", async (t) => {
  const page = await openHome(t);

  assert.equal(repositoryRows(page).length, REPOSITORY_COUNT);
  for (const record of REPOSITORY_DECISIONS) {
    const row = rowFor(page, record.id);
    assert.ok(row, `${record.id} did not render a repository row`);

    // Textually distinct from an example record, and marked as a word rather
    // than by colour: the badge is in the row's accessible description.
    const badge = row.querySelectorAll(".badge-repository")[0];
    assert.equal(textOf(badge), REPOSITORY_LABEL);
    assert.equal(badge.tagName, "SPAN");
    assert.doesNotMatch(textOf(row), new RegExp(EXAMPLE_LABEL));

    const link = row.querySelectorAll(".record-source-link")[0];
    assert.ok(link, `${record.id} carries no link to its pull request`);
    // Names the PR it came from, and opens that same PR: the number in the text
    // and the number in the href are both read off the record.
    assert.match(textOf(link), new RegExp(`Pull request #${record.repository.pullRequest}\\b`));
    assert.equal(link.getAttribute("href"), `${REPOSITORY_URL}/pull/${record.repository.pullRequest}`);
    assert.equal(link.getAttribute("href"), pullRequestUrl(record.repository.pullRequest));
    assert.equal(link.tagName, "A");
  }

  // No example row borrows the citation.
  const sourced = rows(page).filter((row) => row.querySelectorAll(".record-source-link").length > 0);
  assert.equal(sourced.length, REPOSITORY_COUNT);
});

// --- the release link rule -------------------------------------------------

test("a repository record never links a release, and says the release is not in this log", async (t) => {
  const page = await openHome(t);
  const exampleReleaseIds = new Set(SEED_RELEASES.map(({ id }) => id));

  for (const row of repositoryRows(page)) {
    // No release link at all. Every release in this log is invented, so there
    // is none that genuinely shipped these — and an example release must never
    // be presented as the thing that shipped a real decision.
    for (const link of row.querySelectorAll("a")) {
      const href = link.getAttribute("href") ?? "";
      assert.doesNotMatch(href, /^\/release\.html/, "a repository row links a release in this log");
      for (const id of exampleReleaseIds) {
        assert.ok(!href.includes(id), `a repository row links the example release ${id}`);
      }
    }
    // And the absence is stated, in its own words. "Not yet shipped" would be
    // false of a decision that shipped in a pull request this row links.
    assert.match(textOf(row), new RegExp(REPOSITORY_RELEASE_ABSENT));
    assert.doesNotMatch(textOf(row), /Not yet shipped/);
  }

  // The rule is structural, not incidental: it holds even when an invented
  // release does name a repository record's id, which is the case a future
  // edit to the examples could otherwise introduce silently.
  const [record] = REPOSITORY_DECISIONS;
  const composed = toHistoryRecords(
    [record],
    [{ id: "demo-r-9-9-9", version: "v9.9.9", status: "completed", createdAt: "2026-01-01T00:00:00.000Z", decisionIds: [record.id] }],
    { exampleIds: new Set([record.id, "demo-r-9-9-9"]) },
  );
  const decision = composed.find((entry) => entry.type === "decision");
  assert.equal(decision.links.length, 0, "an example release was allowed to claim a repository record");
  assert.equal(decision.shipped.state, "none");
  assert.equal(isRepositoryRecord(decision), true);
});

// --- keyboard parity ------------------------------------------------------

test("a repository record reaches focus and opens its record page like an example does", async (t) => {
  const page = await openHome(t);
  const [record] = REPOSITORY_DECISIONS;
  const row = rowFor(page, record.id);
  assert.ok(row, `${record.id} did not render a repository row`);
  const card = row.querySelectorAll(".decision-card")[0];

  // Same card anchor, same route, same arrow-key class as every example row.
  assert.equal(card.tagName, "A");
  assert.equal(card.getAttribute("href"), `/decision.html?id=${record.id}`);
  // Same arrow-key class as every other row, so list navigation is unchanged.
  assert.ok(card.classList.contains("history-card"));

  // Reachable by Tab, with the citation link as a stop of its own.
  const stops = tabSequence(page.document);
  assert.ok(stops.includes(card), "a repository row's card is not a tab stop");
  const link = row.querySelectorAll(".record-source-link")[0];
  assert.ok(stops.includes(link), "the pull request link is not a tab stop");

  // An example row is reached the same way, which is the parity claim.
  const exampleCard = cards(page).find((node) => node.querySelectorAll(".badge-example").length === 1);
  assert.ok(exampleCard, "no example row rendered");
  assert.ok(stops.includes(exampleCard), "an example row's card is not a tab stop");
});

// --- isolating Shiplog's own decisions (#2710) -----------------------------
//
// A buyer who wants to see the product used on a REAL history had to find the
// three repository rows among thirteen. The filter bar carries a toggle for them
// now, and the claims below are read off the rendered page after operating that
// control — including once with the keyboard alone, because a toggle whose
// handler works and whose button cannot be reached is not a control.

const toggle = (page) => page.document.querySelector("#filter-repository-only");
const sourceNote = (page) => page.document.querySelector("#history-source-note");
const splitText = (page) => textOf(page.document.querySelector("#decision-provenance"));
const countText = (page) => textOf(page.document.querySelector("#decision-count"));
// The rows a reader can actually see. A placeholder carries the same card class
// as a real row everywhere this harness is used, so the suffix is excluded here
// rather than trusted to be absent — a count that includes one reads as a
// settled list that is still loading.
const visibleRows = (page) =>
  rows(page).filter((row) => row.querySelectorAll(".history-card")
    .every((card) => !(card.getAttribute("class") ?? "").includes("-skeleton")));
const exampleRows = (page) =>
  visibleRows(page).filter((row) => row.querySelectorAll(".badge-repository").length === 0);
const occurrences = (text, phrase) => text.split(phrase).length - 1;
const COLD_SPLIT = `· ${SEED_EXAMPLE_COUNT} example records · ${REPOSITORY_COUNT} from this repository · none you added`;

test("the toggle ships as a named, keyboard-operable control with its state exposed", async () => {
  const parsed = parseHtml(await readFile(HOME_PAGE, "utf8"));
  const control = parsed.querySelector("#filter-repository-only");
  assert.ok(control, "the filter bar carries no repository-records control");

  // A native button, so Tab reaches it and Enter and Space both activate it. Not
  // a div with a click handler, and not a mouse-only affordance.
  assert.equal(control.tagName, "BUTTON");
  assert.equal(control.getAttribute("type"), "button");
  // Its accessible name is the label constant, byte for byte, so the control,
  // its chip and the glossary of filter words cannot drift apart.
  assert.equal(textOf(control), REPOSITORY_ONLY_LABEL);
  // Pressed-ness is the state assistive tech reports, and it ships unpressed:
  // the default view is the whole log.
  assert.equal(control.getAttribute("aria-pressed"), "false");
  assert.equal(control.getAttribute("aria-describedby"), "filter-repository-hint");
  assert.equal(parsed.querySelectorAll("#filter-repository-hint").length, 1);

  // It sits in the record list's own filter bar — after the search field and
  // before Clear filters — and nowhere near the hero. The first screen of this
  // page is held to its tab stops by other files (the hero's own count, and
  // tests/prompt-coach-destination.test.js), and a filter belongs with the
  // filters anyway: it is the bar's own reset that has to drop it.
  const html = await readFile(HOME_PAGE, "utf8");
  assert.ok(html.indexOf('id="decision-search"') < html.indexOf('id="filter-repository-only"'),
    "the toggle was added above the record list's filter bar");
  assert.ok(html.indexOf('id="filter-repository-only"') < html.indexOf('id="clear-decision-filters"'),
    "the toggle must be inside the filter bar that Clear filters resets");
  // The sentence's slot ships empty: the default view is not the provenance view.
  const note = parsed.querySelector("#history-source-note");
  assert.ok(note, "the summary panel has no slot for the provenance sentence");
  assert.equal(textOf(note), "");
});

test("pressing the toggle leaves only repository-sourced records, and no example record", async (t) => {
  const page = await openHome(t);
  assert.equal(visibleRows(page).length, SEED_RECORD_COUNT);

  toggle(page).click();

  assert.equal(toggle(page).getAttribute("aria-pressed"), "true");
  assert.equal(visibleRows(page).length, REPOSITORY_COUNT);
  assert.equal(repositoryRows(page).length, REPOSITORY_COUNT);
  // Nothing labelled an example survived — asserted on the badge AND on the
  // label's own words, because the filter reads the provenance field and the
  // badge is what a reader actually sees.
  assert.equal(exampleRows(page).length, 0, "an unsourced row survived the provenance filter");
  for (const row of visibleRows(page)) {
    assert.equal(row.querySelectorAll(".badge-example").length, 0);
    assert.doesNotMatch(textOf(row), new RegExp(EXAMPLE_LABEL));
  }
  // Every seeded repository record is present, by id: the view is the class, not
  // a sample of it.
  assert.deepEqual(
    visibleRows(page).map((row) => row.getAttribute("id")).sort(),
    REPOSITORY_DECISIONS.map(({ id }) => `decision-${id}`).sort(),
  );
  // The filter is the provenance field and nothing else, which is what keeps it
  // honest when a record's copy is reworded: the pure selector agrees.
  assert.equal(
    selectHistory(toHistoryRecords(REPOSITORY_DECISIONS, [], { exampleIds: new Set() }), { repositoryOnly: true })
      .every((record) => isRepositoryRecord(record)),
    true,
  );
  // The view is shareable like every other filter on this page, because it IS
  // one: `?source=repository`. This harness installs no history object, so the
  // round trip is pinned where the rest of the encoding is, in
  // tests/history-url.test.js, and what is read here is the rendered list.
  assert.equal(REPOSITORY_ONLY_VALUE, "repository");
});

// The split beside the figure describes THE ROWS ON SCREEN — that is the rule
// this page has shipped since #2539, pinned by
// tests/demo-path.test.js ("the split follows the search, the filters, and
// Current only"), and this filter is not an exception to it. So the reading
// while the view is active is: all three classes still named, the repository
// count unchanged at its corpus value, the example half correctly at none, and
// the corpus total still stated as the denominator beside it.
test("the count line still names all three classes and the whole log's total", async (t) => {
  const page = await openHome(t);
  assert.equal(countText(page), `${SEED_RECORD_COUNT} records`);
  assert.equal(splitText(page), COLD_SPLIT);

  toggle(page).click();

  // The corpus total is still reported: the figure is "3 of 13 records", so a
  // reader is never shown a narrowed number as a statement about the whole log.
  assert.equal(countText(page), `${REPOSITORY_COUNT} of ${SEED_RECORD_COUNT} records`);
  // All three classes are still named, and the repository count is the same
  // number it was on the unfiltered view.
  const halves = splitText(page).replace(/^· /, "").split(" · ");
  assert.equal(halves.length, 3, "the split stopped naming all three kinds of record");
  assert.equal(halves[1], `${REPOSITORY_COUNT} from this repository`);
  assert.equal(halves[0], "no example records");
  assert.equal(halves[2], "none you added");
  // The classes add up to the rows on screen, which is the arithmetic the line
  // exists to let a reader check.
  assert.equal(
    halves.reduce((sum, half) => sum + Number(half.match(/\d+/)?.[0] ?? 0), 0),
    visibleRows(page).length,
  );
  // The headline above the list carries the same figure and the same split.
  assert.equal(
    textOf(page.document.querySelector("#history-filter-summary")),
    `${REPOSITORY_COUNT} of ${SEED_RECORD_COUNT} records ${splitText(page)}`,
  );
});

test("the view says whose decisions these are, once, and only while it is active", async (t) => {
  const page = await openHome(t);
  const panel = () => textOf(page.document.querySelector(".filter-summary-panel"));

  // Absent on the default view: a sentence about three records must not stand
  // over a list of thirteen.
  assert.equal(textOf(sourceNote(page)), "");
  assert.equal(occurrences(panel(), REPOSITORY_VIEW_NOTE), 0);

  toggle(page).click();

  assert.equal(textOf(sourceNote(page)), REPOSITORY_VIEW_NOTE);
  // Exactly once in the region that carries it, so it is not also being painted
  // by a second path that would then have to be kept in step.
  assert.equal(occurrences(panel(), REPOSITORY_VIEW_NOTE), 1);
  // What it claims: whose decisions, who recorded them, and that each cites its
  // own pull request.
  assert.match(REPOSITORY_VIEW_NOTE, /Shiplog's own decisions/);
  assert.match(REPOSITORY_VIEW_NOTE, /recorded in Shiplog by the team that operates it/);
  assert.match(REPOSITORY_VIEW_NOTE, /cites the public pull request it came from/);
  // And what it must never claim. These records are this site's own source
  // history; the page cannot stand behind anything about customers, how much
  // the product is used, or what any of these decisions achieved.
  assert.doesNotMatch(REPOSITORY_VIEW_NOTE, /customer|production data|users|visitors|teams use/i);
  assert.doesNotMatch(REPOSITORY_VIEW_NOTE, /faster|saved|improved|reduced|increased|\d+ ?%/i);

  // Withdrawn, not merely hidden, when the view goes: textOf reads through a
  // closed details element, so an unemptied node is still a sentence on the page.
  toggle(page).click();
  assert.equal(textOf(sourceNote(page)), "");
  assert.equal(occurrences(panel(), REPOSITORY_VIEW_NOTE), 0);
});

test("every record in the view cites its own pull request as a real anchor", async (t) => {
  const page = await openHome(t);
  toggle(page).click();

  const names = [];
  for (const row of visibleRows(page)) {
    const links = row.querySelectorAll(".record-source-link");
    assert.equal(links.length, 1, `${row.getAttribute("id")} carries no single pull request link`);
    const [link] = links;
    assert.equal(link.tagName, "A");
    // A real address at a pull request, not a placeholder and not a bare "#".
    const href = link.getAttribute("href");
    assert.match(href, new RegExp(`^${REPOSITORY_URL}/pull/\\d+$`), `${href} is not a pull request address`);
    // The accessible name identifies WHICH pull request. "link" or a repeated
    // "pull request" is a list of links a screen reader user cannot act on.
    const name = textOf(link);
    assert.match(name, /^Pull request #\d+$/);
    assert.equal(href, pullRequestUrl(Number(name.match(/\d+/)[0])));
    names.push(name);
  }
  assert.equal(names.length, REPOSITORY_COUNT);
  assert.equal(new Set(names).size, REPOSITORY_COUNT, "two rows in this view carry the same link name");
});

test("releasing the toggle, and Clear filters, each put the whole log back", async (t) => {
  const page = await openHome(t);

  // Released by pressing the same control again.
  toggle(page).click();
  assert.equal(visibleRows(page).length, REPOSITORY_COUNT);
  toggle(page).click();
  assert.equal(toggle(page).getAttribute("aria-pressed"), "false");
  assert.equal(visibleRows(page).length, SEED_RECORD_COUNT);
  assert.equal(splitText(page), COLD_SPLIT);

  // And dropped by the filter bar's own reset, which needed no new code: the
  // toggle writes the one filter state Clear filters already resets.
  toggle(page).click();
  assert.equal(visibleRows(page).length, REPOSITORY_COUNT);
  page.document.querySelector("#clear-decision-filters").click();
  assert.equal(toggle(page).getAttribute("aria-pressed"), "false");
  assert.equal(visibleRows(page).length, SEED_RECORD_COUNT);
  assert.equal(splitText(page), COLD_SPLIT);
  assert.equal(textOf(sourceNote(page)), "");
});

test("the view is reached and operated with the keyboard alone", async (t) => {
  const page = await openHome(t);
  const target = toggle(page);

  // Tab from the top of the document until the control has focus. Bounded by the
  // sequence length, so a control that is not in the tab order fails here rather
  // than looping.
  let reached = null;
  for (let press = 0; press < tabSequence(page.document).length && reached !== target; press += 1) {
    reached = pressTab(page.document);
  }
  assert.equal(reached, target, "the repository-records toggle is not in the tab order");

  // Space, which is how a native toggle button is activated — not a click
  // dispatched at the handler.
  pressSpace(page.document);
  assert.equal(target.getAttribute("aria-pressed"), "true");
  assert.equal(visibleRows(page).length, REPOSITORY_COUNT);
  assert.equal(exampleRows(page).length, 0);
  assert.equal(textOf(sourceNote(page)), REPOSITORY_VIEW_NOTE);
});
