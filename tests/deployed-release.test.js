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
  REAL_RECORD_LINK_LABEL,
  REAL_RECORD_NAME,
  REPOSITORY_URL,
  commitUrl,
  deployedReleaseRecord,
  sameSiteHref,
} from "../src/deployed-release.js";
import { NO_RECORD_TITLE, UNSTAMPED_NOTE, renderShippedBuild } from "../src/deployed-release-view.js";
import { healthContract } from "../src/health-contract.js";
import { parseHealthBody } from "../src/deployment-status-view.js";
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

// `settle: false` boots the page and stops at the state a visitor meets while
// the probe is outstanding: the list has rendered, the band has not answered.
async function open(
  t,
  { buildStamp = STAMPED, readHealth = answers({ status: "healthy", version: SHA }), settle = true } = {},
) {
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
    () => page.document.documentElement.dataset[settle ? "shiplogDeployment" : "shiplogReleases"] === "ready",
    settle ? "the deployment status band never finished its comparison" : "the releases page never finished rendering",
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
  assert.match(textOf(panel), /OwnerWawalu/);
  assert.match(textOf(panel), /SummaryThe commit this artifact was built from/);

  const source = page.document.querySelector("#shipped-build-source");
  assert.equal(source.getAttribute("href"), `${REPOSITORY_URL}/commit/${SHA}`);
  assert.equal(source.hidden, false);
  // Named by the commit it opens, not by an adjective about it.
  assert.equal(textOf(source), "Open commit 0123456789ab in the public repository");
  assert.doesNotMatch(textOf(panel), /proven|verified|guaranteed|trusted/i);
});

test("the real record's address is handed over by the one control that offers it", async (t) => {
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

  assert.equal(page.document.querySelectorAll("#shipped-build").length, 1);
  // The block no longer anchors to its own address: that anchor read the same
  // words as the deployment check's record link and went to the same place, so
  // a link list offered one destination twice. The button is what hands the
  // address over now, and it names the record the way everything else does.
  const copy = page.document.querySelector("#shipped-build-copy");
  assert.equal(textOf(copy), `Copy link to ${REAL_RECORD_NAME}`);
  assert.equal(page.document.querySelectorAll("#shipped-build-detail").length, 0);

  copy.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(copied, "https://labs.wawalu.org/releases.html#shipped-build");
  assert.equal(
    textOf(page.document.querySelector("#shipped-build-copy-status")),
    `Link to ${REAL_RECORD_NAME} copied to clipboard.`,
  );
});

// The permalink above is the first value on this block read off the record
// rather than composed from the stamp, and it feeds the clipboard. So the
// hostile version is driven, not reasoned about: a record naming somewhere
// other than this site must never reach it.
test("sameSiteHref accepts this record's own link and refuses every value that leaves the site", () => {
  assert.equal(sameSiteHref("/releases.html#shipped-build"), "/releases.html#shipped-build");
  for (const value of [
    "javascript:navigator.clipboard.writeText('x')",
    "data:text/html,<p>hi</p>",
    "//evil.example/releases.html",
    "https://evil.example/releases.html",
    "/../../etc/passwd",
    "\\releases.html",
    " /releases.html",
    "",
    null,
  ]) assert.equal(sameSiteHref(value), "", `accepted ${String(value)}`);
});

test("a record naming somewhere off this site gets no copy button and writes no clipboard", async (t) => {
  let copied = null;
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
    deployedRelease: { ...deployedReleaseRecord(STAMPED), detailHref: "https://evil.example/releases.html" },
    clipboard: { writeText: async (value) => { copied = value; } },
  });

  // The hostile address never reaches the DOM, on any control.
  const links = page.document.querySelectorAll("a")
    .filter((node) => (node.getAttribute("href") ?? "").includes("evil.example"));
  assert.equal(links.length, 0);
  const copy = page.document.querySelector("#shipped-build-copy");
  assert.equal(copy.hidden, true);
  copy.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(copied, null);
});

test("re-rendering the block leaves one copy handler, pointed at the record now on screen", async (t) => {
  const writes = [];
  const page = await loadPage(RELEASES_PAGE, {
    storage: { [STORAGE_KEY]: JSON.stringify([]), [RELEASE_STORAGE_KEY]: JSON.stringify([]) },
  });
  t.after(() => page.restore());
  const options = {
    location: { origin: "https://labs.wawalu.org" },
    clipboard: { writeText: async (value) => { writes.push(value); } },
  };
  const record = deployedReleaseRecord(STAMPED);
  renderShippedBuild(page.document, record, options);
  renderShippedBuild(page.document, { ...record, detailHref: "/releases.html?id=later#shipped-build" }, options);

  page.document.querySelector("#shipped-build-copy").click();
  await Promise.resolve();
  await Promise.resolve();
  // One write, not one per past render, and it names the second record.
  assert.deepEqual(writes, ["https://labs.wawalu.org/releases.html?id=later#shipped-build"]);
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
  // The heading is the record's name, so it goes with the record: with none to
  // show, the block is not headed as though there were one.
  assert.equal(textOf(page.document.querySelector("#shipped-build-title")), NO_RECORD_TITLE);
  assert.doesNotMatch(textOf(panel), new RegExp(REAL_LABEL));
  assert.equal(textOf(page.document.querySelector("#shipped-build-note")), UNSTAMPED_NOTE);
  assert.equal(page.document.querySelector("#shipped-build-facts").children.length, 0);
  assert.equal(page.document.querySelector("#shipped-build-source").hidden, true);
  assert.equal(page.document.querySelector("#shipped-build-copy").hidden, true);
  // And the check says it has nothing real to compare against rather than
  // falling back to an invented record.
  assert.match(verdictText(page), /The check did not complete/);
  assert.match(verdictText(page), /no real record of this deployment/);
  assert.equal(
    textOf(page.document.querySelector("#deployment-identifiers")),
    "Running build version: 0123456789abcdef0123456789abcdef01234567. Real deployment-record version: not available.",
  );
  assert.equal(page.document.querySelector("#deployment-release-record").hidden, true);
  // With no commit and no record there is nothing to link, so the ruled row the
  // two links share goes with them instead of painting an empty divider.
  assert.equal(page.document.querySelector("#deployment-proof-links").hidden, true);
  assert.doesNotMatch(verdictText(page), /^Confirmed:/);
});

/* ---------------------- the check names a real record --------------------- */

// The line the band shows before the probe answers (#1910). Composed from
// REAL_RECORD_NAME rather than quoted whole: the waiting line and the settled
// verdict below name one record, so renaming it has to move both or fail here.
const WAITING_LINE = "Retrieving the running build’s version…"
  + ` That version is compared with ${REAL_RECORD_NAME}, not with the invented example records.`;

test("the check names the identifier it is retrieving and the record it compares, while it waits", async (t) => {
  // A probe that never answers: the state a visitor on a slow network meets,
  // and the one a visitor whose /healthz never returns stays in.
  const page = await open(t, { readHealth: () => new Promise(() => {}), settle: false });

  assert.notEqual(
    page.document.documentElement.dataset.shiplogDeployment,
    "ready",
    "the band answered, so this asserts a settled state and not the waiting one",
  );
  assert.equal(verdictText(page), WAITING_LINE);
  // Announced when it is replaced by the verdict, not read as a heading.
  assert.equal(page.document.querySelector("#deployment-verdict").getAttribute("role"), "status");
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
  assert.equal(textOf(actions[0]), REAL_RECORD_LINK_LABEL);
  assert.equal(
    textOf(page.document.querySelector("#deployment-identifiers")),
    `Running build version: ${other}. Real deployment-record version: ${SHA}.`,
  );
  assert.equal(page.document.querySelector("#deployment-release-record").hidden, false);
});

test("the proof names both compared version values and offers the record once", async (t) => {
  const page = await open(t);
  assert.equal(
    textOf(page.document.querySelector("#deployment-identifiers")),
    `Running build version: ${SHA}. Real deployment-record version: ${SHA}.`,
  );
  const record = page.document.querySelector("#deployment-release-record");
  // The link names the record, and the identifiers line above states its id.
  assert.equal(textOf(record), REAL_RECORD_LINK_LABEL);
  assert.equal(record.getAttribute("href"), "/releases.html#shipped-build");
  // The commit is offered by the record block above, once. This band used to
  // repeat that link — same commit, same words — so one screen offered one
  // destination twice; the front door, where the check stands alone, keeps its
  // own copy of it.
  assert.equal(page.document.querySelectorAll("#deployment-commit").length, 0);
  assert.equal(
    page.document.querySelector("#shipped-build-source").getAttribute("href"),
    `${REPOSITORY_URL}/commit/${SHA}`,
  );
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

test("the body the endpoint really serves is one this band reads, and it resolves to the real record's version", async (t) => {
  // Every other case here hands the band a body written by hand to look like
  // the endpoint's. This one takes the endpoint's own object — functions/healthz.js
  // answers `healthContract(BUILD_STAMP)` — and puts it through the wire the
  // browser reads it over, so the whole path is pinned end to end: serialise,
  // parse, find the build field, compare against the real record.
  //
  // Without this, renaming that field leaves the deployed page permanently
  // saying the check did not complete while every fixture-driven test above
  // stays green. It is not a hypothetical rename: `releaseBuildFields`, in the
  // same endpoint file, already names the same value `build_sha`.
  const served = parseHealthBody(JSON.stringify(healthContract(STAMPED)));
  const page = await open(t, { readHealth: answers(served) });

  assert.equal(
    textOf(page.document.querySelector("#deployment-identifiers")),
    `Running build version: ${SHA}. Real deployment-record version: ${SHA}.`,
  );
  assert.equal(page.document.querySelector("#deployment-status").dataset.deploymentState, "match");
  assert.match(verdictText(page), /^Confirmed: this site is running [0-9a-f]{40}, the version/);
  // And the copy a buyer takes away carries the same two values, from the same
  // check, rather than a second reading of it.
  assert.equal(
    page.document.querySelector("#deployment-copy").dataset.copyText,
    `Deployment check verdict: ${verdictText(page)}\nRunning build version: ${SHA}. Real deployment-record version: ${SHA}.`,
  );
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
