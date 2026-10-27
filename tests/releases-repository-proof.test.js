// The Releases page's real repository record (#2908), driven through the
// shipped src/releases.html. The pair comes from the home page's own
// repositoryReleasePair over REPOSITORY_DECISIONS and the recorded #2547 stamp,
// so the fixtures below are those wire shapes, not a parallel invention.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initReleasesPage } from "../src/releases-page.js";
import { bootReleases } from "../src/releases-bootstrap.js";
import {
  LAST_VERIFIED_BUILD, LAST_VERIFIED_ON, LAST_VERIFIED_STAMP_COMMIT, REPOSITORY_PROOF_FAILED, REPOSITORY_PROOF_LOADED, REPOSITORY_PROOF_NOT_LIVE, repositoryProofPair,
} from "../src/releases-repository-proof.js";
import { REPOSITORY_DECISIONS } from "../src/seed-records.js";
import { SHIPPED_BUILD_FAILED_NOTE } from "../src/deployed-release-view.js";
import { loadPage, pressTab, tabSequence, textOf } from "./support/browser.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const NO_SEED = { decisions: [], releases: [] };
const REPO = "https://github.com/AndrewLikesTea/wawalu-agent-lab";

async function openPage(t, options = {}) {
  const page = await loadPage(RELEASES_PAGE, { storage: {} });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, { seed: NO_SEED, readHealth: () => new Promise(() => {}), ...options });
  return page;
}
const byId = (page, id) => page.document.querySelector(`#${id}`);

test("the real record names the decision, its status and owner, the recorded build and both sources", async (t) => {
  const page = await openPage(t);
  const section = byId(page, "repository-proof");
  const text = textOf(section);
  assert.equal(section.dataset.state, "loaded");
  assert.equal(textOf(byId(page, section.getAttribute("aria-labelledby"))), "Real record from the Shiplog repository");
  assert.match(text, /Real record/);
  assert.ok(section.classList.contains("shiplog-real"));
  assert.equal(section.classList.contains("shiplog-demo"), false);
  for (const value of [
    "DecisionMark every record row with whose record it is",
    "Decision statusAccepted",
    "Decision ownerMina",
    "Source repositoryAndrewLikesTea/wawalu-agent-lab on GitHub",
    "Recorded buildCommit 28b2398ff49c, which merged pull request #2547",
    "Last verified 25 September 2026.",
    REPOSITORY_PROOF_NOT_LIVE,
  ]) assert.ok(text.includes(value), value);
  assert.equal(REPOSITORY_PROOF_NOT_LIVE, "This describes a recorded build, not the deployment running now.");
  assert.doesNotMatch(text, /uncovered|example|customer result[^.]*confirmed|is live/i);

  const status = byId(page, "repository-proof-status");
  assert.equal(textOf(status), REPOSITORY_PROOF_LOADED);
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.doesNotMatch(textOf(section), /customer/i);

  const links = byId(page, "repository-proof-record").querySelectorAll("a");
  assert.deepEqual(links.map((link) => [link.getAttribute("href"), textOf(link)]), [
    [`${REPO}/pull/2547`, "Open pull request #2547, the source of this decision, on GitHub"],
    [`${REPO}/commit/28b2398ff49c1026182305c85b8a2ed715069ab6`, "Open commit 28b2398ff49c, the recorded build, on GitHub"],
    [`${REPO}/blob/${LAST_VERIFIED_STAMP_COMMIT}/src/build-stamp.js`, "Inspect the recorded build stamp on GitHub"],
  ]);
  const stops = tabSequence(page.document);
  const start = stops.indexOf(links[0]);
  assert.ok(start > 0, "source links are reachable from the preceding control");
  stops[start - 1].focus();
  for (const link of links) assert.ok(pressTab(page.document) === link);
  assert.notEqual(page.document.activeElement?.getAttribute?.("id"), "repository-proof");
});

test("the pair is the home page's own: the canonical decision citing the stamp's pull request", () => {
  const pair = repositoryProofPair();
  assert.equal(pair.decision, REPOSITORY_DECISIONS.find((decision) => decision.id === "shiplog-pr-2547"));
  assert.equal(pair.release.commitSha, LAST_VERIFIED_BUILD.commitSha);
  assert.equal(repositoryProofPair([]), null, "no decision cites the build: no pair");
  assert.equal(repositoryProofPair(REPOSITORY_DECISIONS, { ...LAST_VERIFIED_BUILD, builtAt: "not a date" }), null);
});

// The record as text plus every link's href, so two states compare by value.
// Whitespace is dropped: authored markup indents where rendered nodes do not.
const recordOf = (page) => {
  const record = byId(page, "repository-proof-record");
  return [textOf(record).replace(/\s+/g, ""), record.querySelectorAll("a").map((link) => `${link.getAttribute("href")} ${textOf(link)}`)];
};
const LAST_VERIFIED_RECORD = [
  "Mark every record row with whose record it is",
  "AndrewLikesTea/wawalu-agent-lab",
  "pull request #2547",
  `Last verified ${LAST_VERIFIED_ON}.`,
];

test("releases.html authors the last-verified record itself, with its repository links", async () => {
  const html = await readFile(RELEASES_PAGE, "utf8");
  const section = html.slice(html.indexOf('id="repository-proof"'), html.indexOf("</section>", html.indexOf('id="repository-proof"')));
  assert.equal(LAST_VERIFIED_ON, "25 September 2026");
  for (const value of [...LAST_VERIFIED_RECORD, `href="${REPO}/pull/2547"`, `href="${REPO}/commit/${LAST_VERIFIED_BUILD.commitSha}"`]) {
    assert.ok(section.includes(value), value);
  }
  assert.doesNotMatch(section, /customer|uncovered/i);
});

test("with no script yet, or a refresh still pending, the authored record is already shown", async (t) => {
  const page = await loadPage(RELEASES_PAGE, { storage: {} });
  t.after(() => page.restore());
  assert.equal(byId(page, "repository-proof").dataset.state, "loading");
  const [text, links] = recordOf(page);
  for (const value of LAST_VERIFIED_RECORD) assert.ok(text.includes(value.replace(/\s+/g, "")), value);
  assert.equal(links.length, 3);
  assert.equal(textOf(byId(page, "repository-proof-status")), "Checking this last-verified record against the repository record.");
});

test("a confirmed refresh renders exactly the authored record and no failure label", async (t) => {
  const page = await loadPage(RELEASES_PAGE, { storage: {} });
  t.after(() => page.restore());
  const authored = recordOf(page);
  initReleasesPage(page.document, page.storage, { seed: NO_SEED, readHealth: () => new Promise(() => {}) });
  assert.equal(byId(page, "repository-proof").dataset.state, "loaded");
  assert.deepEqual(recordOf(page), authored, "markup and LAST_VERIFIED_BUILD cannot drift");
  assert.doesNotMatch(textOf(byId(page, "repository-proof")), /failed/i);
});

test("a refresh that cannot prove the pairing keeps the last-verified record and labels the failure", async (t) => {
  const page = await loadPage(RELEASES_PAGE, { storage: {} });
  t.after(() => page.restore());
  const authored = recordOf(page);
  initReleasesPage(page.document, page.storage, { seed: NO_SEED, readHealth: () => new Promise(() => {}), repositoryProof: repositoryProofPair([]) });
  const section = byId(page, "repository-proof");
  assert.equal(section.dataset.state, "failed");
  assert.equal(textOf(byId(page, "repository-proof-status")), REPOSITORY_PROOF_FAILED);
  assert.equal(REPOSITORY_PROOF_FAILED, "Refreshing this record from the repository failed, so it shows the proof last verified on 25 September 2026.");
  assert.deepEqual(recordOf(page), authored);
  assert.doesNotMatch(textOf(section), /customer/i);
});

test("a page script that fails to load keeps the record and says the refresh failed", async (t) => {
  const page = await loadPage(RELEASES_PAGE, { storage: {} });
  t.after(() => page.restore());
  const authored = recordOf(page);
  await bootReleases(page.document, () => Promise.reject(new Error("offline")));
  assert.equal(byId(page, "repository-proof").dataset.state, "failed");
  assert.equal(textOf(byId(page, "repository-proof-status")), REPOSITORY_PROOF_FAILED, "bootstrap repeats the module's sentence");
  assert.deepEqual(recordOf(page), authored);
  assert.doesNotMatch(textOf(byId(page, "repository-proof")), /customer/i);
});

// --- each region fails on its own (#3028) ------------------------------------

const throwing = (key) => Object.defineProperty({}, key, { get() { throw new Error(`${key} unreadable`); } });
const logState = (page) => byId(page, "release-list-status").getAttribute("class");

test("a pairing that throws mid-render fails only the repository block, which keeps its heading and record", async (t) => {
  const page = await loadPage(RELEASES_PAGE, { storage: {} });
  t.after(() => page.restore());
  const authored = recordOf(page);
  initReleasesPage(page.document, page.storage, { seed: NO_SEED, readHealth: () => new Promise(() => {}), repositoryProof: throwing("decision") });
  assert.equal(byId(page, "repository-proof").dataset.state, "failed");
  assert.equal(textOf(byId(page, "repository-proof-title")), "Real record from the Shiplog repository");
  assert.equal(textOf(byId(page, "repository-proof-status")), REPOSITORY_PROOF_FAILED);
  assert.match(REPOSITORY_PROOF_FAILED, /this record from the repository failed/);
  assert.deepEqual(recordOf(page), authored, "a half-built refresh replaced the last-verified record");
  // Its neighbours settled: the log on its first-run state, the record painted.
  assert.equal(logState(page), "list-state list-state-empty");
  assert.equal(byId(page, "shipped-build").dataset.shippedBuild, "real");
});

test("a deployment record that throws says so in its own block and stalls nothing else", async (t) => {
  const page = await openPage(t, { deployedRelease: throwing("commitSha") });
  const panel = byId(page, "shipped-build");
  assert.equal(panel.dataset.shippedBuild, "failed");
  assert.equal(textOf(byId(page, "shipped-build-title")), "Deployment record");
  assert.equal(textOf(byId(page, "shipped-build-note")), SHIPPED_BUILD_FAILED_NOTE);
  assert.equal(byId(page, "shipped-build-note").getAttribute("role"), "status");
  // Reload, not Retry: the stamp is baked into this build.
  assert.match(SHIPPED_BUILD_FAILED_NOTE, /^The deployment record could not load\. Reload this page/);
  assert.equal(byId(page, "shipped-build-marking").hidden, true, "a failed record kept its Real marking");
  assert.equal(byId(page, "shipped-build-copy").hidden, true);
  assert.equal(byId(page, "shipped-build-facts").children.length, 0);
  assert.equal(page.document.activeElement === panel, false, "a failure moved focus");
  // The page script failing to load says the very same sentence.
  const html = await readFile(new URL("../src/releases-bootstrap.js", import.meta.url), "utf8");
  assert.ok(html.includes(`"${SHIPPED_BUILD_FAILED_NOTE}"`));
  // Neighbours booted rather than staying on their loading lines.
  assert.equal(logState(page), "list-state list-state-empty");
  assert.equal(byId(page, "repository-proof").dataset.state, "loaded");
  assert.equal(page.document.querySelectorAll(".decision-picker-loading").length, 0);
  assert.equal(byId(page, "deployment-status").dataset.checkState, "loading", "the deployment check never started");
});

test("the invented story beside it keeps its Example label and stays apart from the real record", async (t) => {
  const page = await openPage(t);
  const demo = byId(page, "shiplog-proof");
  assert.equal(textOf(demo.querySelector(".badge-example")), "Example records");
  assert.match(textOf(demo), /These example records are invented/);
  assert.equal(demo.classList.contains("shiplog-real"), false);
  assert.equal(demo.querySelectorAll("#repository-proof").length, 0);
  const ids = [...demo.parentNode.children].filter((node) => node.getAttribute).map((node) => node.getAttribute("id"));
  assert.equal(ids[ids.indexOf("shiplog-proof") + 1], "repository-proof", "the real record stands right beside the story");
});
