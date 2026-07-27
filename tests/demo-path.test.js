// The cold-visitor demo path, end to end.
//
// Everything here starts from empty browser storage — the state of a private
// window that has never opened the site. That is the state the demo path used
// to fail in: the record list said "0 records" under a caption promising
// examples, and the sample decision link landed on "Loading decision".
//
// Determinism: no network at all. loadPage throws on any request, so a test
// that passes here proves the examples reached the page without one.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { initDecisionLog, STORAGE_KEY } from "../src/app.js";
import { loadDecisionDetail, initDecisionDetail } from "../src/decision-page.js";
import { initReleaseDetail } from "../src/release-page.js";
import { loadReleaseData } from "../src/releases-data.js";
import { RELEASE_STORAGE_KEY, resolveReleaseDetail } from "../src/releases.js";
import {
  EXAMPLE_LABEL,
  SAMPLE_DECISION_ID,
  SAMPLE_RELEASE_ID,
  SEED_RECORD_COUNT,
} from "../src/seed-records.js";
import { loadPage, textOf } from "./support/browser.js";

const HOME_PAGE = new URL("../src/index.html", import.meta.url);
const DECISION_PAGE = new URL("../src/decision.html", import.meta.url);
const RELEASE_PAGE = new URL("../src/release.html", import.meta.url);

// A decision this visitor recorded themselves. Nothing about it overlaps the
// example ids, so both sets must survive together.
const OWN_DECISION = {
  id: "own-observability",
  title: "Budget for tracing",
  context: "We cannot explain tail latency without spans.",
  alternatives: "Sampling logs only.",
  owner: "Devi",
  status: "approved",
  createdAt: "2020-01-01T00:00:00.000Z",
};

const emptyStorage = () => ({
  data: new Map(),
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; },
  setItem(key, value) { this.data.set(key, String(value)); },
});

const storageWith = (decisions = [], releases = []) => {
  const store = emptyStorage();
  store.setItem(STORAGE_KEY, JSON.stringify(decisions));
  store.setItem(RELEASE_STORAGE_KEY, JSON.stringify(releases));
  return store;
};

// --- data layer -----------------------------------------------------------

test("with empty storage the composed history already holds decisions and releases", () => {
  const { decisions, releases, exampleDecisionIds, exampleReleaseIds } = loadReleaseData(emptyStorage());

  assert.ok(decisions.length > 0, "a cold visitor must see at least one decision");
  assert.ok(releases.length > 0, "a cold visitor must see at least one release");
  assert.equal(decisions.length + releases.length, SEED_RECORD_COUNT);
  assert.ok(decisions.some(({ id }) => id === SAMPLE_DECISION_ID));
  assert.ok(releases.some(({ id }) => id === SAMPLE_RELEASE_ID));
  // Every one of them is an example for this visitor: they recorded nothing.
  assert.equal(exampleDecisionIds.size + exampleReleaseIds.size, SEED_RECORD_COUNT);
});

test("the sample decision id resolves to a complete record with empty storage", () => {
  const result = loadDecisionDetail(SAMPLE_DECISION_ID, emptyStorage());

  assert.equal(result.state, "available");
  assert.equal(result.example, true);
  const { decision } = result;
  assert.equal(decision.title, "Adopt a durable job queue");
  assert.ok(decision.context.length > 0, "the sample decision must carry its context");
  assert.ok(Array.isArray(decision.alternatives) && decision.alternatives.length >= 2,
    "the sample decision must carry comparable alternatives");
  assert.equal(decision.owner, "Kai");
  assert.equal(decision.status, "accepted");
});

test("the sample decision and its release link to each other in both directions", () => {
  const storage = emptyStorage();
  const { decisions, releases } = loadReleaseData(storage);

  // decision -> release
  const { linkedReleases } = loadDecisionDetail(SAMPLE_DECISION_ID, storage);
  assert.deepEqual(linkedReleases.map(({ id }) => id), [SAMPLE_RELEASE_ID]);

  // release -> decision
  const resolved = resolveReleaseDetail(releases, decisions, SAMPLE_RELEASE_ID);
  assert.ok(resolved, "the sample release must resolve");
  assert.ok(
    resolved.decisions.some(({ id }) => id === SAMPLE_DECISION_ID),
    "the sample release must list the sample decision",
  );
});

test("an unknown id is a not-found record, never a pending one", () => {
  assert.equal(loadDecisionDetail("no-such-decision", emptyStorage()).state, "not-found");
  assert.equal(loadDecisionDetail("", emptyStorage()).state, "empty");
  const { decisions, releases } = loadReleaseData(emptyStorage());
  assert.equal(resolveReleaseDetail(releases, decisions, "no-such-release"), null);
});

test("a visitor's own record joins the examples instead of replacing them", () => {
  const { decisions, exampleDecisionIds } = loadReleaseData(storageWith([OWN_DECISION]));

  assert.ok(decisions.some(({ id }) => id === OWN_DECISION.id), "the visitor's record is missing");
  assert.ok(decisions.some(({ id }) => id === SAMPLE_DECISION_ID), "the examples were dropped");
  assert.equal(decisions.length, SEED_RECORD_COUNT - 4 + 1);
  // Their own record is theirs: it is never badged as an example.
  assert.equal(exampleDecisionIds.has(OWN_DECISION.id), false);
  assert.equal(exampleDecisionIds.has(SAMPLE_DECISION_ID), true);
});

// --- the shipped home page ------------------------------------------------

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

const rows = (page) => page.document.querySelector("#decision-list").querySelectorAll(".history-card");
const countText = (page) => textOf(page.document.querySelector("#decision-count"));

test("the static markup already states the count a cold visitor will see", async () => {
  const html = await readFile(HOME_PAGE, "utf8");
  const before = textOf(
    (await import("./support/browser.js")).parseHtml(html).querySelector("#decision-count"),
  );

  // The number in the served HTML is the number the seed produces, so the first
  // paint is right rather than counting up from zero after a load settles.
  assert.equal(before, `${SEED_RECORD_COUNT} records`);
  assert.doesNotMatch(before, /^0 records$/);

  // And the hero's demo call to action lands on the list that shows them.
  assert.match(html, /href="#record-history">Explore the live demo/);
  assert.match(html, /id="record-history"/);
  // The sample links agree with the ids the seed data uses.
  assert.ok(html.includes(`href="/decision.html?id=${SAMPLE_DECISION_ID}"`));
  assert.ok(html.includes(`href="/release.html?id=${SAMPLE_RELEASE_ID}"`));
});

test("a cold home page renders a non-zero count with decisions and releases in it", async (t) => {
  const page = await openHome(t);

  assert.equal(countText(page), `${SEED_RECORD_COUNT} records`);
  assert.equal(rows(page).length, SEED_RECORD_COUNT);
  assert.ok(rows(page).some((row) => row.classList.contains("decision-card")), "no decision row rendered");
  assert.ok(rows(page).some((row) => row.classList.contains("release-card")), "no release row rendered");
  assert.equal(page.document.querySelector("#decision-list").querySelectorAll(".list-state-empty").length, 0);
  // Every rendered row says what it is.
  assert.equal(
    rows(page).filter((row) => textOf(row).includes(EXAMPLE_LABEL)).length,
    SEED_RECORD_COUNT,
  );
});

test("recording a decision keeps both the visitor's record and the examples, visitor first", async (t) => {
  const page = await openHome(t, { decisions: [OWN_DECISION] });

  const titles = rows(page).map((row) => textOf(row.querySelector("h3")));
  assert.equal(titles[0], OWN_DECISION.title, "the visitor's record must lead the list");
  assert.ok(titles.includes("Adopt a durable job queue"), "the examples were dropped");
  assert.equal(countText(page), `${SEED_RECORD_COUNT + 1} records`);

  // The visitor's own record carries no example badge; the examples all do.
  const own = rows(page).find((row) => textOf(row.querySelector("h3")) === OWN_DECISION.title);
  assert.doesNotMatch(textOf(own), new RegExp(EXAMPLE_LABEL));
  assert.equal(
    rows(page).filter((row) => textOf(row).includes(EXAMPLE_LABEL)).length,
    SEED_RECORD_COUNT,
  );
  // The examples are read-through only: nothing was written to storage.
  assert.deepEqual(JSON.parse(page.storage.getItem(STORAGE_KEY)), [OWN_DECISION]);
  assert.deepEqual(JSON.parse(page.storage.getItem(RELEASE_STORAGE_KEY)), []);
});

// --- direct URL loads -----------------------------------------------------

test("pasting the sample decision URL into a fresh window renders the decision", async (t) => {
  const page = await loadPage(DECISION_PAGE, {
    storage: {},
    location: { search: `?id=${SAMPLE_DECISION_ID}` },
  });
  t.after(() => page.restore());

  await initDecisionDetail();

  const detail = page.document.querySelector("#decision-detail");
  const rendered = textOf(detail);
  assert.equal(page.document.documentElement.dataset.shiplogDecisionDetail, "ready");
  assert.equal(detail.querySelectorAll(".detail-state-loading").length, 0, "the page stayed on its loading state");
  assert.doesNotMatch(rendered, /Loading decision/);
  assert.doesNotMatch(rendered, /could not be loaded|unavailable/i);

  assert.match(rendered, /Adopt a durable job queue/);
  assert.match(rendered, /at-least-once delivery/);
  assert.match(rendered, /Managed durable queue/);
  assert.match(rendered, /Kai/);
  assert.match(rendered, /accepted/);
  assert.ok(rendered.includes(EXAMPLE_LABEL), "the detail page must say this is an example");

  // The link on to the release it informed.
  const releaseLink = detail.querySelectorAll("a")
    .find((link) => link.getAttribute("href") === `/release.html?id=${SAMPLE_RELEASE_ID}`);
  assert.ok(releaseLink, "the decision must link to the release it informed");
});

test("following that link renders a release that lists the decision back", async (t) => {
  const page = await loadPage(RELEASE_PAGE, {
    storage: {},
    location: { search: `?id=${SAMPLE_RELEASE_ID}` },
  });
  t.after(() => page.restore());

  initReleaseDetail();

  const detail = page.document.querySelector("#release-detail");
  const rendered = textOf(detail);
  assert.equal(page.document.documentElement.dataset.shiplogReleaseDetail, "ready");
  assert.equal(detail.querySelectorAll(".list-state-loading").length, 0, "the page stayed on its loading state");
  assert.match(rendered, /v1\.3\.0/);
  assert.match(rendered, /Adopt a durable job queue/);
  assert.ok(rendered.includes(EXAMPLE_LABEL), "the release detail must say this is an example");
});

test("a decision URL with an unknown id renders a not-found state, not a spinner", async (t) => {
  const page = await loadPage(DECISION_PAGE, {
    storage: {},
    location: { search: "?id=not-a-real-decision" },
  });
  t.after(() => page.restore());

  await initDecisionDetail();

  const detail = page.document.querySelector("#decision-detail");
  assert.equal(detail.querySelectorAll(".detail-state-loading").length, 0);
  assert.doesNotMatch(textOf(detail), /Loading decision/);
  assert.equal(page.document.title, "Decision not found · Shiplog");
});
