// The Releases page's real repository record (#2908), driven through the
// shipped src/releases.html. The pair comes from the home page's own
// repositoryReleasePair over REPOSITORY_DECISIONS and the recorded #2547 stamp,
// so the fixtures below are those wire shapes, not a parallel invention.

import test from "node:test";
import assert from "node:assert/strict";
import { initReleasesPage } from "../src/releases-page.js";
import { bootReleases } from "../src/releases-bootstrap.js";
import {
  LAST_VERIFIED_BUILD, LAST_VERIFIED_STAMP_COMMIT, REPOSITORY_PROOF_FAILED, REPOSITORY_PROOF_LOADED, REPOSITORY_PROOF_NOT_LIVE, repositoryProofPair,
} from "../src/releases-repository-proof.js";
import { REPOSITORY_DECISIONS } from "../src/seed-records.js";
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
  assert.equal(byId(page, "repository-proof-repo").hidden, true);

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
  assert.equal(stops.includes(byId(page, "repository-proof-repo")), false);
  assert.notEqual(page.document.activeElement?.getAttribute?.("id"), "repository-proof");
});

test("the pair is the home page's own: the canonical decision citing the stamp's pull request", () => {
  const pair = repositoryProofPair();
  assert.equal(pair.decision, REPOSITORY_DECISIONS.find((decision) => decision.id === "shiplog-pr-2547"));
  assert.equal(pair.release.commitSha, LAST_VERIFIED_BUILD.commitSha);
  assert.equal(repositoryProofPair([]), null, "no decision cites the build: no pair");
  assert.equal(repositoryProofPair(REPOSITORY_DECISIONS, { ...LAST_VERIFIED_BUILD, builtAt: "not a date" }), null);
});

test("a record that cannot load says so honestly, links the repository and shows no figure", async (t) => {
  const page = await openPage(t, { repositoryProof: repositoryProofPair([]) });
  const section = byId(page, "repository-proof");
  assert.equal(section.dataset.state, "failed");
  assert.equal(textOf(byId(page, "repository-proof-status")), REPOSITORY_PROOF_FAILED);
  const repo = byId(page, "repository-proof-repo");
  assert.equal(repo.hidden, false);
  assert.equal(repo.getAttribute("href"), REPO);
  assert.ok(tabSequence(page.document).includes(repo), "failure recovery stays keyboard reachable");
  assert.equal(textOf(repo), "Open the public Shiplog repository on GitHub");
  assert.equal(byId(page, "repository-proof-record").children.length, 0);
  assert.doesNotMatch(textOf(section), /\d/, "no number, date or commit from the fixture");
  assert.doesNotMatch(textOf(section), /Mark every record row|Mina|Accepted|Last verified/);
});

test("a page script that fails to load leaves the same honest failure, not a stuck loading line", async (t) => {
  const page = await loadPage(RELEASES_PAGE, { storage: {} });
  t.after(() => page.restore());
  assert.equal(textOf(byId(page, "repository-proof-status")), "Loading the repository record.");
  assert.equal(byId(page, "repository-proof-repo").getAttribute("href"), null, "main authors no repository link");
  await bootReleases(page.document, () => Promise.reject(new Error("offline")));
  assert.equal(textOf(byId(page, "repository-proof-status")), REPOSITORY_PROOF_FAILED);
  assert.equal(byId(page, "repository-proof-repo").hidden, false);
  assert.equal(byId(page, "repository-proof-repo").getAttribute("href"), REPO);
  assert.doesNotMatch(textOf(byId(page, "repository-proof")), /\d/);
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
