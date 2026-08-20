// The releases log says which of its records are real and which are invented,
// per record — and the deployment check names the real one.
//
// WHY THIS FILE EXISTS (#1819). The Agent observatory tells a visitor that
// merged pull requests "built and changed the pages of this site" and links
// "Read the releases these pull requests shipped". That link used to land on a
// page whose only framing was that every record on it was invented and that no
// such release shipped. The observatory promised proof; the log said nothing on
// it was real.
//
// Every case below drives the shipped page: the real markup from
// src/releases.html, booted through initReleasesPage the way the browser boots
// it. Nothing opens a socket — the health read and the build stamp are both
// injected, so the stamped and unstamped paths each cost one object.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initReleasesPage } from "../src/releases-page.js";
import { BUILD_STAMP } from "../src/build-stamp.js";
import { EXAMPLE_LABEL } from "../src/seed-records.js";
import {
  DEPLOYED_RELEASE_ID,
  NO_RECORD_LABEL,
  REAL_LABEL,
  REAL_RECORD_NAME,
  REPOSITORY_URL,
  commitUrl,
  deployedReleaseRecord,
} from "../src/deployed-release.js";
import { UNSTAMPED_NOTE } from "../src/deployed-release-view.js";
import { loadPage, textOf } from "./support/browser.js";
import { waitFor } from "./support/page-module.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const OBSERVATORY_PAGE = new URL("../src/agents.html", import.meta.url);

const NOW = "2026-08-17T12:00:00.000Z";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const STAMPED = Object.freeze({ schemaVersion: 1, commitSha: SHA, builtAt: "2026-08-17T08:00:00.000Z" });
const UNSTAMPED = Object.freeze({ schemaVersion: 1, commitSha: null, builtAt: null });

// The endpoint answers `{ status, version }` where version IS the commit sha
// (src/health-contract.js), so a match here is the same comparison production
// makes rather than a friendlier one invented for the test.
const answers = (body) => async () => body;

async function open(t, { buildStamp = STAMPED, readHealth = answers({ status: "healthy", version: SHA }) } = {}) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: { [STORAGE_KEY]: JSON.stringify([]), [RELEASE_STORAGE_KEY]: JSON.stringify([]) },
  });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, {
    location: { pathname: "/releases.html", origin: "https://labs.wawalu.org", search: "", hash: "" },
    history: { replaceState() {} },
    buildStamp,
    readHealth,
    now: () => NOW,
  });
  await waitFor(
    () => page.document.documentElement.dataset.shiplogDeployment === "ready",
    "the deployment status band never finished its comparison",
  );
  return page;
}

const marking = (page) => textOf(page.document.querySelector("#shipped-build-marking"));
const verdictText = (page) => textOf(page.document.querySelector("#deployment-verdict"));

/* --------------------------- the record itself ---------------------------- */

test("the record is derived from the build stamp, and is null when the build names no commit", () => {
  const record = deployedReleaseRecord(STAMPED);
  assert.equal(record.id, DEPLOYED_RELEASE_ID);
  // The version IS the sha: `/healthz` reports the running deployment as its
  // commit sha, and a prettier label here would be a comparison that never
  // matched.
  assert.equal(record.version, SHA);
  assert.equal(record.commitSha, SHA);
  assert.equal(record.createdAt, STAMPED.builtAt);
  assert.equal(record.sourceUrl, `${REPOSITORY_URL}/commit/${SHA}`);

  // No stamp, no record. There is no placeholder sha and no fallback record:
  // a deployment that cannot name itself gets nothing rather than a fiction.
  assert.equal(deployedReleaseRecord(UNSTAMPED), null);
  assert.equal(deployedReleaseRecord(null), null);
  assert.equal(deployedReleaseRecord({ commitSha: "v1.4.0", builtAt: STAMPED.builtAt }), null);
  assert.equal(deployedReleaseRecord({ commitSha: SHA, builtAt: "not a date" }), null);
  assert.equal(commitUrl("v1.4.0"), null);
});

test("the two markings are distinct strings that cannot be read as each other", () => {
  assert.equal(REAL_LABEL, "Real record of this deployment");
  assert.equal(EXAMPLE_LABEL, "Example record");
  assert.notEqual(REAL_LABEL, EXAMPLE_LABEL);
  // Neither contains the other, and they share no word: "real" and "example"
  // are not near-synonyms a reader has to weigh against each other.
  assert.equal(REAL_LABEL.includes(EXAMPLE_LABEL), false);
  assert.equal(EXAMPLE_LABEL.includes(REAL_LABEL), false);
  const words = (label) => new Set(label.toLowerCase().split(/\W+/).filter(Boolean));
  const shared = [...words(REAL_LABEL)].filter((word) => words(EXAMPLE_LABEL).has(word) && word !== "record");
  assert.deepEqual(shared, [], "the two markings share wording beyond the noun they both name");
  // The marking the badge carries and the name the verdict uses are the same
  // words, so "which record was this compared against?" needs no translation.
  assert.equal(REAL_RECORD_NAME, `the ${REAL_LABEL.toLowerCase()}`);
});

/* ------------------------- markings on the page --------------------------- */

test("every rendered release record carries exactly one of the two markings", async (t) => {
  const page = await open(t);
  const records = [
    page.document.querySelector("#shipped-build"),
    ...page.document.querySelectorAll(".release-item"),
  ];
  assert.ok(records.length > 1, "the page rendered no release records to mark");
  for (const record of records) {
    const text = textOf(record);
    const real = text.includes(REAL_LABEL);
    const example = text.includes(EXAMPLE_LABEL);
    assert.ok(real || example, "a release record carries neither marking");
    assert.equal(real && example, false, "a release record carries both markings at once");
  }
  // One record is real and the rest are invented, and the real one is not one
  // of the demonstration rows.
  assert.equal(marking(page), REAL_LABEL);
  assert.equal(page.document.querySelector("#shipped-build").dataset.shippedBuild, "real");
  for (const row of page.document.querySelectorAll(".release-item")) {
    assert.match(textOf(row), new RegExp(EXAMPLE_LABEL));
    assert.doesNotMatch(textOf(row), /Real record/);
  }
});

test("the real record names the deployed version and links a public commit a visitor can open", async (t) => {
  const page = await open(t);
  const panel = page.document.querySelector("#shipped-build");
  assert.match(textOf(panel), new RegExp(SHA));
  assert.match(textOf(panel), new RegExp(STAMPED.builtAt));

  const source = page.document.querySelector("#shipped-build-source");
  assert.equal(source.getAttribute("href"), `${REPOSITORY_URL}/commit/${SHA}`);
  assert.equal(source.hidden, false);
  // Named by the commit it opens, not by an adjective about it.
  assert.equal(textOf(source), "Open commit 0123456789ab in the public repository");
  assert.doesNotMatch(textOf(panel), /proven|verified|guaranteed|trusted/i);
});

test("the real record precedes the invented example, so the observatory link lands on it", async (t) => {
  const page = await open(t);
  const blocks = page.document.getElementById("main-content").children
    .map((node) => node.getAttribute?.("id"))
    .filter(Boolean);
  assert.ok(
    blocks.indexOf("shipped-build") < blocks.indexOf("shiplog-proof"),
    "the invented example is rendered above the real record",
  );

  // The observatory's link points at the record, not at the top of the page.
  const observatory = await readFile(OBSERVATORY_PAGE, "utf8");
  assert.match(observatory, /href="\/releases\.html#shipped-build">Read the releases these pull requests shipped<\/a>/);
  assert.equal(page.document.querySelectorAll("#shipped-build").length, 1, "the fragment resolves to one block");
});

test("an unstamped build shows no record and withdraws the real marking", async (t) => {
  const page = await open(t, { buildStamp: UNSTAMPED });
  const panel = page.document.querySelector("#shipped-build");
  assert.equal(panel.dataset.shippedBuild, "unstamped");
  assert.equal(marking(page), NO_RECORD_LABEL);
  assert.doesNotMatch(textOf(panel), new RegExp(REAL_LABEL));
  assert.equal(textOf(page.document.querySelector("#shipped-build-note")), UNSTAMPED_NOTE);
  assert.equal(page.document.querySelector("#shipped-build-facts").children.length, 0);
  assert.equal(page.document.querySelector("#shipped-build-source").hidden, true);
  // And the check says it has nothing real to compare against rather than
  // falling back to an invented record.
  assert.match(verdictText(page), /The check did not complete/);
  assert.match(verdictText(page), /no real record of this deployment/);
});

/* ---------------------- the check names a real record --------------------- */

// What the band says before the probe answers (#1910). The waiting line is
// static markup in src/releases.html — deployment-status-view.js overwrites the
// slot only once the check settles — so this asserts the promise the line makes
// rather than a copy of its bytes: which identifier is being fetched, what that
// identifier is compared with, and the line this page draws around it. Reword
// it freely; leave a waiting visitor able to answer "what am I waiting for, and
// what will it be measured against". The front door carries the same block with
// a shorter waiting line of its own (tests/deployment-status.test.js) — these
// two sentences are deliberately not the same sentence.
test("the check says what it is retrieving and what it compares, before it answers", async (t) => {
  const page = await loadPage(RELEASES_PAGE);
  t.after(() => page.restore());
  const waiting = verdictText(page);

  assert.match(waiting, /version or commit identifier/, "the waiting line names no identifier to wait for");
  assert.match(waiting, /compare/, "the waiting line does not say the identifier gets compared with anything");
  assert.match(waiting, /real record of this deployment/, "the waiting line does not name what it compares against");
  assert.match(waiting, /invented example records/, "the waiting line lets the real record read as one of the examples");

  // And it claims no comparison. Every verdict sentence is the renderer's; one
  // copied into the cold document would be an answer nobody ran the check for.
  assert.doesNotMatch(waiting, /Confirmed:|Not a match:|The check did not complete/);
});

test("the deployment check's verdict names a record the page marks as real", async (t) => {
  const page = await open(t);
  assert.equal(
    verdictText(page),
    `Confirmed: this site is running ${SHA}, the version ${REAL_RECORD_NAME} names.`,
  );
  // The record the verdict names is the one carrying the real marking, in the
  // same words — and it is never one of the invented rows.
  assert.ok(verdictText(page).includes(REAL_RECORD_NAME));
  assert.equal(marking(page), REAL_LABEL);
  assert.doesNotMatch(verdictText(page), /newest release record/);
  for (const version of ["v1.4.0", "v1.3.0", "v1.2.1", "v1.2.0"]) {
    assert.doesNotMatch(verdictText(page), new RegExp(version.replace(/\./g, "\\.")),
      "the check named an invented demonstration record");
  }
  assert.match(textOf(page.document.querySelector("#deployment-metric")), new RegExp(`^Running ${SHA} · Real record ${SHA} ·`));
});

test("a page and a deployment built from different commits read as a mismatch with one action", async (t) => {
  const other = "fedcba9876543210fedcba9876543210fedcba98";
  const page = await open(t, { readHealth: answers({ status: "healthy", version: other }) });
  assert.equal(page.document.querySelector("#deployment-status").dataset.deploymentState, "drift");
  assert.equal(
    verdictText(page),
    `Not a match: this site is running ${other}, but ${REAL_RECORD_NAME} names ${SHA}.`,
  );
  const actions = page.document.querySelectorAll("[data-deployment-action]");
  assert.equal(actions.length, 1, "drift must name exactly one next action");
  // Pointed at the record on this page, not at a detail route that would
  // resolve to nothing: this record does not live in the visitor's log.
  assert.equal(actions[0].getAttribute("href"), "/releases.html#shipped-build");
  assert.equal(textOf(actions[0]), "Open the real record of this deployment");
});

test("the build-sha line compares the running build against the real record", async (t) => {
  const page = await open(t);
  const line = textOf(page.document.querySelector("#deployment-build-match"));
  assert.match(line, /^Running build 0123456789ab is the build release deployed-build says shipped/);
  // Never against an invented record, which shipped no commit at all.
  assert.doesNotMatch(line, /demo-r-/);
});

/* -------------------- the invented example still works -------------------- */

test("the invented example keeps its marking, its controls, and the link they copy", async (t) => {
  let copied = "";
  const page = await loadPage(RELEASES_PAGE, {
    storage: { [STORAGE_KEY]: JSON.stringify([]), [RELEASE_STORAGE_KEY]: JSON.stringify([]) },
  });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, {
    location: { pathname: "/releases.html", origin: "https://labs.wawalu.org", search: "", hash: "" },
    history: { replaceState() {} },
    buildStamp: STAMPED,
    readHealth: answers({ status: "healthy", version: SHA }),
    now: () => NOW,
    clipboard: { writeText: async (value) => { copied = value; } },
  });

  const proof = page.document.querySelector("#shiplog-proof");
  // Its own words are untouched: nothing about this change may let a reader
  // take an invented record for a real deployment.
  assert.match(textOf(proof), /These invented records demonstrate Shiplog\. They use no customer or production data, and no such decision or release shipped\./);
  assert.match(textOf(proof), /Example records/);
  assert.doesNotMatch(textOf(proof), new RegExp(REAL_LABEL));

  // Exactly one element wears the class the copy control reads its URL from,
  // and it is the example's own link: the real record's link has its own class
  // so it can never take that URL over.
  const links = page.document.querySelectorAll(".shiplog-proof-link");
  assert.equal(links.length, 1, "a second element claimed the example's link class");
  assert.equal(textOf(links[0]), "Open this example");
  assert.equal(links[0].getAttribute("href"), "/releases.html?focus=demo-r-1-3-0#shiplog-proof");

  const copy = page.document.querySelector("#shiplog-proof-copy");
  assert.equal(textOf(copy), "Copy link to this example");
  copy.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(copied, "https://labs.wawalu.org/releases.html?focus=demo-r-1-3-0#shiplog-proof");
  assert.equal(textOf(page.document.querySelector("#shiplog-proof-copy-status")), "Example link copied to clipboard.");
});

/* ------------------------- the shipped build stamp ------------------------ */

test("the committed stamp is either a real commit sha or the explicit unstamped marker", () => {
  // The one thing that would make this whole path a lie: a stamp carrying
  // something that is neither a commit nor the null the build writes when git
  // cannot answer.
  const { commitSha } = BUILD_STAMP;
  assert.ok(commitSha === null || /^[0-9a-f]{40}$/.test(commitSha), "the build stamp holds something that is not a commit sha");
  const record = deployedReleaseRecord(BUILD_STAMP);
  if (record) assert.equal(record.sourceUrl, `${REPOSITORY_URL}/commit/${commitSha}`);
});
