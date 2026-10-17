import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  verifyRepositoryReleasePair, RELEASE_PAIR_LOADED, RELEASE_PAIR_UNAVAILABLE, initDecisionLog, renderRepositoryEvidence,
  renderRepositoryReleasePair, repositoryReleasePair, STORAGE_KEY,
} from "../src/app.js";
import { bootHomepage } from "../src/homepage-bootstrap.js";
import { BUILD_STAMP } from "../src/build-stamp.js";
import { REPOSITORY_DECISIONS, SEED_DECISIONS, pullRequestUrl } from "../src/seed-records.js";
import { loadPage, textOf, tabSequence } from "./support/browser.js";

const home = new URL(`../${process.env.SHIPLOG_E2E_BUILD_ROOT || "src"}/index.html`, import.meta.url);

const disclaimer = "These decisions document this repository’s own development. This is neither an invented example nor a customer result.";

function assertDisclaimer(block) {
  const copy = block.querySelector("p");
  assert.equal(textOf(copy), disclaimer);
  assert.ok(block.children.indexOf(copy) < block.children.indexOf(block.querySelector("#repository-evidence-records")));
  assert.equal(copy.hidden, false);
}

test("homepage shows loading copy while the app is pending", async (t) => {
  const page = await loadPage(home);
  t.after(() => page.restore());
  let finish;
  const pending = bootHomepage(page.document, () => new Promise((resolve) => { finish = resolve; }));
  const block = page.document.getElementById("repository-evidence");
  const target = block.querySelector("#repository-evidence-records");
  assert.equal(textOf(target), "Loading repository-backed decisions.");
  assert.doesNotMatch(textOf(target), /unavailable|failed|could not/i);
  assertDisclaimer(block);
  const html = await readFile(home, "utf8");
  assert.match(html, /src="\/homepage-bootstrap\.js"/);
  finish();
  await pending;
});

test("failed app load gives the existing browse route; a successful retry removes failure copy", async (t) => {
  const page = await loadPage(home);
  t.after(() => page.restore());
  const fail = () => Promise.reject(new Error("Module could not load"));
  await bootHomepage(page.document, fail);
  const block = page.document.getElementById("repository-evidence");
  const target = block.querySelector("#repository-evidence-records");
  assert.equal(textOf(target), "Repository-backed decisions could not be loaded. Use the ‘Browse all repository-backed Shiplog decisions’ link below to try again.");
  assert.doesNotMatch(textOf(target), /Loading repository-backed decisions/);
  const browse = block.querySelector("a");
  assert.equal(textOf(browse), "Browse all repository-backed Shiplog decisions");
  assert.equal(browse.getAttribute("href"), "/?source=repository#record-history");
  assert.ok(tabSequence(page.document).includes(browse));
  assertDisclaimer(block);
  await bootHomepage(page.document, () => initDecisionLog(page.document, page.storage));
  assert.equal(target.querySelectorAll("a").length, 1);
  assert.doesNotMatch(textOf(target), /Loading repository-backed decisions|could not be loaded|unavailable/i);
  assertDisclaimer(block);
  const loaded = textOf(target);
  await bootHomepage(page.document, fail);
  assert.equal(textOf(target), loaded, "a later failure must not overwrite loaded evidence");
});

test("homepage renders canonical repository evidence near the opening proposition", async (t) => {
  const page = await loadPage(home, { storage: { [STORAGE_KEY]: JSON.stringify([
    { ...REPOSITORY_DECISIONS[0], id: "imitation", title: "Customer success invented locally" },
  ]) } });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage);
  const block = page.document.getElementById("repository-evidence");
  assert.equal(textOf(block.querySelector("h3")), "Repository-backed product evidence");
  assert.equal(block.getAttribute("aria-labelledby"), block.querySelector("h3").id);
  assertDisclaimer(block);
  assert.doesNotMatch(textOf(block.querySelector("#repository-evidence-records")), /Loading repository-backed decisions|could not be loaded|unavailable/i);
  assert.doesNotMatch(textOf(block), /Customer success invented locally|saved|adoption|performance improvement/i);
  const links = block.querySelectorAll("a");
  // Pinned to the rule the renderer states — the newest repository decision —
  // and not to "any of the three". Accepting any member let the one record a
  // buyer reads first change silently with the seed order or the default sort,
  // which is exactly the question a sceptical reader would ask of this block.
  const [newest] = [...REPOSITORY_DECISIONS].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  assert.equal(textOf(links[0]), `${newest.title} — public pull request #${newest.repository.pullRequest}`);
  assert.equal(links[0].getAttribute("href"), pullRequestUrl(newest.repository.pullRequest));
  assert.equal(textOf(links[1]), "Browse all repository-backed Shiplog decisions");
  assert.equal(links[1].getAttribute("href"), "/?source=repository#record-history");
  for (const link of links) assert.ok(tabSequence(page.document).includes(link));
  const html = await readFile(home, "utf8");
  assert.ok(html.indexOf('id="repository-evidence"') > html.indexOf('id="home-log-title"'));
  assert.ok(html.indexOf('id="repository-evidence"') < html.indexOf('id="featured-decision"'));
});

test("collection route opens the complete repository-only history", async (t) => {
  const page = await loadPage(home, { location: { search: "?source=repository", hash: "#record-history" } });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage);
  const list = page.document.getElementById("decision-list");
  assert.equal(list.querySelectorAll(".history-card").length, REPOSITORY_DECISIONS.length);
  for (const record of REPOSITORY_DECISIONS) assert.ok(textOf(list).includes(record.title));
  assert.equal(list.querySelectorAll(".badge-example").length, 0);
});

test("evidence excludes unmarked examples and missing or malformed PR citations", async (t) => {
  const page = await loadPage(home);
  t.after(() => page.restore());
  const target = page.document.getElementById("repository-evidence-records");
  for (const records of [[], SEED_DECISIONS.filter((record) => !record.repository),
    [ { ...REPOSITORY_DECISIONS[0], repository: {} } ],
    [ { ...REPOSITORY_DECISIONS[0], repository: { pullRequest: "javascript:alert(1)" } } ],
    // Without a date there is no "newest", so the block has no rule left to
    // explain its pick and shows nothing rather than an arbitrary one.
    [ { ...REPOSITORY_DECISIONS[0], createdAt: "whenever" } ]]) {
    renderRepositoryEvidence(page.document, records);
    assert.equal(textOf(target), "No repository-backed decisions are available in this log.");
    assert.equal(target.querySelectorAll("a").length, 0);
  }
  renderRepositoryEvidence(page.document);
  assert.equal(target.querySelectorAll("a").length, 1);
  renderRepositoryEvidence(page.document, []);
  assert.equal(target.querySelectorAll("a").length, 0, "stale evidence is removed");
});

// Wrapping, width and the focus ring come from `.release-followup-lead` and the
// global `a:focus-visible`, both already carried by the deployment-check block
// beside this one. There is no per-id CSS here to assert, and asserting that
// styles.css still contains rules this change never touched would be a test
// that cannot fail from this feature. What this change can break is the hand-off
// to that class, so that is what is pinned here instead of a CSS string.
test("every paragraph in the block carries the shared proof-copy class", async (t) => {
  const page = await loadPage(home);
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage);
  const block = page.document.getElementById("repository-evidence");
  const paragraphs = block.querySelectorAll("p");
  assert.ok(paragraphs.length >= 3, `expected the copy, the record and the route, got ${paragraphs.length}`);
  for (const paragraph of paragraphs) {
    assert.equal(paragraph.getAttribute("class"), "release-followup-lead");
  }
});

/* ------------- the one decision and the release that shipped it ------------- */

const SHA = "0123456789abcdef0123456789abcdef01234567";
const stampFor = (subject, overrides = {}) => ({
  schemaVersion: 1, commitSha: SHA, commitSubject: subject, builtAt: "2026-10-12T09:00:00.000Z", ...overrides,
});
const cited = REPOSITORY_DECISIONS.find((record) => record.repository.pullRequest === 2547);
const pairFields = (target) => target.querySelectorAll("div")
  .map((row) => [textOf(row.querySelector("dt")), textOf(row.querySelector("dd"))]);

test("a build whose commit merged a repository decision's pull request renders the whole pair", async (t) => {
  const page = await loadPage(home, { location: { search: "?source=repository" } });
  t.after(() => page.restore());
  const subject = "Agent: Mina — Mark every record row with whose record it is (#2547)";
  await initDecisionLog(page.document, page.storage, { buildStamp: stampFor(subject) });
  await verifyRepositoryReleasePair(page.document, { buildStamp: stampFor(subject), readHealth: async () => ({ status: "healthy", version: SHA }) });
  const status = page.document.getElementById("repository-release-pair-status");
  const target = page.document.getElementById("repository-release-pair");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(textOf(status), RELEASE_PAIR_LOADED);
  assert.equal(target.querySelectorAll("dl").length, 1);
  assert.deepEqual(pairFields(target), [
    ["Decision", cited.title],
    ["Release", "Deployed build 0123456789ab"],
    ["Status", "Accepted"],
    ["Owner", cited.owner],
    ["What shipped", `Commit 0123456789ab merged pull request #2547, “${subject}”, and this page was built from it.`],
  ]);
  const links = target.querySelectorAll("a");
  assert.deepEqual(links.map((link) => link.getAttribute("href")), [
    "/?source=repository#decision-shiplog-pr-2547",
    "/releases.html#shipped-build",
    `https://github.com/AndrewLikesTea/wawalu-agent-lab/commit/${SHA}`,
  ]);
  assert.deepEqual(links.map((link) => textOf(link)), [
    `Read the full decision record: ${cited.title}`,
    "Open the deployment record for build 0123456789ab on the Releases page",
    "Open commit 0123456789ab, which merged pull request #2547, in the public repository",
  ]);
  for (const link of links) assert.ok(tabSequence(page.document).includes(link));
  // The decision link lands on a row the repository-only history really draws.
  const list = page.document.getElementById("decision-list");
  assert.equal(list.querySelectorAll("article").filter((card) => card.id === "decision-shiplog-pr-2547").length, 1);
});

test("the pair is labelled as a real repository record, apart from the invented example", async (t) => {
  const page = await loadPage(home);
  t.after(() => page.restore());
  const block = page.document.getElementById("repository-evidence");
  const heading = page.document.getElementById("repository-release-pair-title");
  assert.equal(heading.tagName, "H4");
  assert.equal(page.document.getElementById("repository-release-pair").getAttribute("aria-labelledby"), heading.id);
  assert.match(textOf(block), /Real repository record\. Read from this repository’s recorded builds, unlike the invented example below\./);
  // Before the script runs there is no current result; historical proof is separate.
  assert.equal(textOf(page.document.getElementById("repository-release-pair")), "");
  assert.doesNotMatch(textOf(page.document.getElementById("repository-release-pair-status")), /shipped in|accepted|#\d/i);
  // The invented example keeps its own caveat, word for word.
  assert.match(textOf(page.document.getElementById("featured-decision")),
    /Example records These invented records demonstrate Shiplog\. They use no customer or production data\./);
});

test("anything short of a proven link renders the unavailable sentence and no field values", async (t) => {
  const page = await loadPage(home);
  t.after(() => page.restore());
  const target = page.document.getElementById("repository-release-pair");
  const status = page.document.getElementById("repository-release-pair-status");
  const subject = "Mark every record row (#2547)";
  const cases = [
    ["the committed build", REPOSITORY_DECISIONS, BUILD_STAMP],
    ["no stamp", REPOSITORY_DECISIONS, null],
    ["missing date", REPOSITORY_DECISIONS, stampFor(subject, { builtAt: null })],
    ["invalid schema", REPOSITORY_DECISIONS, stampFor(subject, { schemaVersion: 2 })],
    ["an unstamped build", REPOSITORY_DECISIONS, stampFor(subject, { commitSha: null })],
    ["a subject with no pull request", REPOSITORY_DECISIONS, stampFor("Mark every record row")],
    ["a decision with no linked release", REPOSITORY_DECISIONS, stampFor("Unrelated work (#9999)")],
    ["no decisions", [], stampFor(subject)],
    ["a decision missing its owner", [{ ...cited, owner: " " }], stampFor(subject)],
    ["a decision with an unknown status", [{ ...cited, status: "shipped" }], stampFor(subject)],
    ["two decisions citing one pull request", [cited, { ...cited, id: "twin" }], stampFor(subject)],
  ];
  // The committed stamp is a no-link case only while its subject cites no decision.
  const committedPull = Number(/\(#(\d+)\)\s*$/.exec(BUILD_STAMP.commitSubject ?? "")?.[1]);
  if (REPOSITORY_DECISIONS.some((record) => record.repository.pullRequest === committedPull)) cases.shift();
  for (const [name, decisions, stamp] of cases) {
    renderRepositoryReleasePair(page.document, repositoryReleasePair(decisions, stamp));
    assert.equal(textOf(status), RELEASE_PAIR_UNAVAILABLE, name);
    assert.equal(target.querySelectorAll("dd").length, 0, name);
    assert.equal(target.querySelectorAll("a").length, 0, name);
    assert.equal(textOf(target), "", name);
  }
  renderRepositoryReleasePair(page.document, repositoryReleasePair(REPOSITORY_DECISIONS, stampFor(subject)));
  assert.equal(target.querySelectorAll("dd").length, 5);
  renderRepositoryReleasePair(page.document, null);
  assert.equal(target.querySelectorAll("dd").length, 0, "a stale pair is removed");
  assert.equal(textOf(status), RELEASE_PAIR_UNAVAILABLE);
});

// The harness parses no markup, so escaping is pinned at the source: the
// commit subject is repository text and reaches the page through textContent.
// Narrow widths are the shared classes' job, so their wrapping rules are pinned.
test("the pair renderer writes text, never markup, and wraps through shared classes", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const start = source.indexOf("export function renderRepositoryReleasePair");
  const body = source.slice(start, source.indexOf("\nexport ", start + 1));
  assert.ok(start > 0 && body.includes("textContent"));
  assert.doesNotMatch(body, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.match(body, /"hero-proof-facts"/);
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.hero-proof-facts \{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(150px,1fr\)\)/);
  assert.match(css, /\.hero-proof-facts dd \{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.release-followup-lead \{[^}]*overflow-wrap:anywhere/);
});

test("historical proof survives pending, current, failed and stale requests", async (t) => {
  const page = await loadPage(home);
  t.after(() => page.restore());
  const fallback = page.document.getElementById("repository-last-verified");
  assert.match(textOf(fallback), /Last verified/);
  assert.match(textOf(fallback), /#2547.*28b2398ff49c/);
  assert.equal(fallback.querySelector("time").getAttribute("datetime"), "2026-09-25T09:08:40.330Z");
  const link = fallback.querySelector("a");
  assert.equal(link.getAttribute("href"), "https://github.com/AndrewLikesTea/wawalu-agent-lab/blob/a1dc0a2dd45b24f8c114dfabed2a31f095f75557/src/build-stamp.js");
  assert.ok(tabSequence(page.document).includes(link));
  assert.equal(fallback.getAttribute("role"), "group");
  const original = textOf(fallback);
  const buildStamp = stampFor("Mark every record row (#2547)");
  let finish;
  const request = verifyRepositoryReleasePair(page.document, {
    buildStamp, readHealth: () => new Promise(resolve => { finish = resolve; }),
  });
  await Promise.resolve();
  assert.equal(page.document.getElementById("repository-release-pair").dataset.state, "pending");
  assert.equal(textOf(fallback), original);
  finish({ status: "healthy", version: SHA });
  await request;
  assert.match(textOf(page.document.getElementById("repository-release-pair")), /Current — confirmed by the live site/);
  assert.equal(textOf(fallback), original);
  for (const readHealth of [
    async () => { throw new Error("offline"); },
    ...[null, [], {}, { status: "healthy" }, { version: SHA },
      { status: "unhealthy", version: SHA }, { status: "healthy", version: "different" }]
      .map(value => async () => value),
    () => new Promise(() => {}),
  ]) {
    await verifyRepositoryReleasePair(page.document, { buildStamp, readHealth, timeoutMs: 10 });
    assert.equal(textOf(page.document.getElementById("repository-release-pair-status")), RELEASE_PAIR_UNAVAILABLE);
    assert.equal(page.document.getElementById("repository-release-pair").dataset.state, "failed");
    assert.equal(textOf(fallback), original);
    assert.ok(tabSequence(page.document).includes(link));
  }
  const old = verifyRepositoryReleasePair(page.document, {
    buildStamp, readHealth: () => new Promise(resolve => { finish = resolve; }),
  });
  await Promise.resolve();
  await verifyRepositoryReleasePair(page.document, { readHealth: async () => null });
  finish({ status: "healthy", version: SHA });
  await old;
  assert.equal(textOf(page.document.getElementById("repository-release-pair-status")), RELEASE_PAIR_UNAVAILABLE);
  let rejectOld;
  const staleFailure = verifyRepositoryReleasePair(page.document, {
    buildStamp, readHealth: () => new Promise((_, reject) => { rejectOld = reject; }),
  });
  await Promise.resolve();
  await verifyRepositoryReleasePair(page.document, {
    buildStamp, readHealth: async () => ({ status: "healthy", version: SHA }),
  });
  rejectOld(new Error("late network error"));
  await staleFailure;
  assert.equal(textOf(page.document.getElementById("repository-release-pair-status")), RELEASE_PAIR_LOADED);
  assert.equal(textOf(fallback), original);
});
