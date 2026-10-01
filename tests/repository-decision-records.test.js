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
  STORAGE_KEY,
  toHistoryRecords,
} from "../src/app.js";
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
import { loadPage, tabSequence, textOf } from "./support/browser.js";

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
