// Does the build serving traffic match what the release log says shipped?
//
// The question an on-call operator opens `/healthz` to answer. These tests
// drive the four cases — matched, mismatched, empty log, unstamped build —
// through BOTH readers of the answer: the pure function
// (src/release-build-match.js) and the endpoint handler (functions/healthz.js),
// plus the page line for the two cases a reader can act on.
//
// Determinism: every input comes from tests/fixtures/release-build-match.json.
// Nothing here reads the git checkout, runs a build, or touches the network, so
// the four cases are provable on any machine rather than observable on the one
// day production happens to be in that state.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { onRequest as healthz, releaseBuildFields } from "../functions/healthz.js";
import {
  VERDICTS,
  newestReleaseRecord,
  releaseBuildMatchLine,
  releaseBuildStatus,
  shasMatch,
} from "../src/release-build-match.js";
import { headCommitSha, stampSource } from "../scripts/write-build-stamp.mjs";
import { initReleasesPage } from "../src/releases-page.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { STORAGE_KEY } from "../src/app.js";
import { loadPage, textOf } from "./support/browser.js";

const FIXTURE = JSON.parse(await readFile(new URL("./fixtures/release-build-match.json", import.meta.url), "utf8"));
const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);

// A D1 double that answers the liveness read. The verdict must never depend on
// storage, and storage must never depend on the verdict.
const healthyDb = { prepare() { return { async first() { return { healthy: 1 }; } }; } };

const probe = (overrides) => healthz(
  { request: new Request("https://shiplog.test/healthz", { headers: { "cf-ray": "verdict-test" } }), env: { DB: healthyDb } },
  overrides,
);

// Every case asserts this: the probe still answers 200 and still carries the
// liveness signal a rollout and a rollback smoke-test it for.
async function bodyOfProbe(overrides) {
  const response = await probe(overrides);
  assert.equal(response.status, 200, "the verdict must never change the probe's status code");
  const body = await response.json();
  assert.equal(body.status, "ok", "the existing liveness field survived");
  assert.equal(body.storage, "available", "the existing storage field survived");
  return body;
}

test("a build stamped with the commit the newest release records reads as matched", async () => {
  const result = releaseBuildStatus(FIXTURE.stampedBuild, FIXTURE.matchedLog);
  assert.equal(result.verdict, VERDICTS.matched);
  assert.equal(result.releaseId, "fix-r-2-1-0");
  assert.equal(result.buildSha, FIXTURE.stampedBuild.commitSha);
  assert.equal(result.builtAt, FIXTURE.stampedBuild.builtAt);
  assert.equal("action" in result, false, "a matched build has no next action");
  assert.equal("reason" in result, false);

  const body = await bodyOfProbe({ stamp: FIXTURE.stampedBuild, releases: FIXTURE.matchedLog });
  assert.equal(body.verdict, "matched");
  assert.equal(body.build_sha, FIXTURE.stampedBuild.commitSha);
  assert.equal(body.release_id, "fix-r-2-1-0");
  assert.equal("action" in body, false);
});

test("an abbreviated sha in the log still matches the full sha in the stamp", () => {
  // The comparison rule: compare over the shorter of the two lengths. The
  // fixture's newest matched record carries 12 characters of a 40-character
  // stamp, which is what a person copies out of `git log`.
  assert.equal(FIXTURE.matchedLog[0].commitSha.length, 12);
  assert.equal(FIXTURE.stampedBuild.commitSha.length, 40);
  assert.equal(shasMatch(FIXTURE.stampedBuild.commitSha, FIXTURE.matchedLog[0].commitSha), true);
  // Case and surrounding whitespace are normalized; a version tag is not a sha.
  assert.equal(shasMatch("  4B1D9CA7F0E3  ", FIXTURE.stampedBuild.commitSha), true);
  assert.equal(shasMatch("v2.1.0", FIXTURE.stampedBuild.commitSha), false);
  assert.equal(shasMatch("4b1d9c", FIXTURE.stampedBuild.commitSha), false, "six characters is not evidence");
});

test("a newer release the build does not carry reads as mismatched and names the release to open", async () => {
  const result = releaseBuildStatus(FIXTURE.stampedBuild, FIXTURE.mismatchedLog);
  assert.equal(result.verdict, VERDICTS.mismatched);
  assert.equal(result.releaseId, "fix-r-2-2-0", "the newest record by createdAt, not the first in the list");
  assert.match(result.action, /fix-r-2-2-0/, "the next action names the release to open in the log");
  assert.equal("reason" in result, false);

  const body = await bodyOfProbe({ stamp: FIXTURE.stampedBuild, releases: FIXTURE.mismatchedLog });
  assert.equal(body.verdict, "mismatched");
  assert.match(body.action, /fix-r-2-2-0/);
  assert.equal(body.release_sha, FIXTURE.mismatchedLog[0].commitSha);
});

test("an empty release log reads as unknown, with the reason, and the probe stays green", async () => {
  const result = releaseBuildStatus(FIXTURE.stampedBuild, FIXTURE.emptyLog);
  assert.equal(result.verdict, VERDICTS.unknown);
  assert.match(result.reason, /release log holds no release record/);
  assert.equal(result.releaseId, null);
  assert.equal("action" in result, false, "there is nothing to open");

  const body = await bodyOfProbe({ stamp: FIXTURE.stampedBuild, releases: FIXTURE.emptyLog });
  assert.equal(body.verdict, "unknown");
  assert.match(body.reason, /release log holds no release record/);
  assert.equal(body.build_sha, FIXTURE.stampedBuild.commitSha, "the build is still named");
});

test("a build with no stamp reads as unknown, with the reason, and the probe stays green", async () => {
  const result = releaseBuildStatus(FIXTURE.unstampedBuild, FIXTURE.matchedLog);
  assert.equal(result.verdict, VERDICTS.unknown);
  assert.match(result.reason, /unstamped/);
  assert.equal(result.buildSha, null, "no sha is invented for an unstamped build");

  const body = await bodyOfProbe({ stamp: FIXTURE.unstampedBuild, releases: FIXTURE.matchedLog });
  assert.equal(body.verdict, "unknown");
  assert.equal(body.build_sha, null);
  assert.match(body.reason, /unstamped/);
});

test("no input shape can turn the verdict into a status code or an exception", async () => {
  for (const [stamp, releases] of [
    [null, null],
    [undefined, undefined],
    ["not a stamp", "not a log"],
    [{ commitSha: 12345 }, [null, "row", { id: 7 }]],
    [FIXTURE.stampedBuild, [{ id: "no-date", commitSha: "4b1d9ca7f0e3" }]],
  ]) {
    const result = releaseBuildStatus(stamp, releases);
    assert.equal(typeof result.verdict, "string");
    const body = await bodyOfProbe({ stamp, releases });
    assert.equal(typeof body.verdict, "string");
  }
  // A record with no readable date is still the newest record when it is the
  // only one, rather than being dropped into "the log is empty".
  assert.equal(newestReleaseRecord([{ id: "no-date" }]).id, "no-date");
  assert.equal(newestReleaseRecord("not a log"), null);
});

test("the release log page states the same verdict and next action as the endpoint", async (t) => {
  const open = async (releases, stamp) => {
    const page = await loadPage(RELEASES_PAGE, {
      storage: { [STORAGE_KEY]: "[]", [RELEASE_STORAGE_KEY]: "[]" },
    });
    t.after(() => page.restore());
    initReleasesPage(page.document, page.storage, {
      seed: { decisions: [], releases },
      buildStamp: stamp,
    });
    return textOf(page.document.querySelector("#release-build-match"));
  };

  const matched = await open(FIXTURE.matchedLog, FIXTURE.stampedBuild);
  assert.equal(matched, releaseBuildMatchLine(releaseBuildStatus(FIXTURE.stampedBuild, FIXTURE.matchedLog)));
  assert.match(matched, /matches release fix-r-2-1-0/);

  const mismatched = await open(FIXTURE.mismatchedLog, FIXTURE.stampedBuild);
  const endpoint = await bodyOfProbe({ stamp: FIXTURE.stampedBuild, releases: FIXTURE.mismatchedLog });
  assert.equal(mismatched, releaseBuildMatchLine(releaseBuildStatus(FIXTURE.stampedBuild, FIXTURE.mismatchedLog)));
  assert.match(mismatched, /does not match release fix-r-2-2-0/);
  // The page carries the endpoint's next action word for word: two operators
  // reading two surfaces are told to do the same one thing.
  assert.ok(mismatched.includes(endpoint.action), "the page and the probe state the same next action");
});

test("the build stamp records a sha only when git returned one", async () => {
  // The git double stands in for the three answers a checkout actually gives:
  // a sha, an error (no git metadata), and something that is not a sha.
  const full = "4b1d9ca7f0e3268159acd47b0f2e6a58cd913720";
  assert.equal(await headCommitSha({ git: async () => ({ stdout: `${full.toUpperCase()}\n` }) }), full);
  assert.equal(await headCommitSha({ git: async () => { throw new Error("not a git repository"); } }), null);
  assert.equal(await headCommitSha({ git: async () => ({ stdout: "fatal: ambiguous argument 'HEAD'" }) }), null);

  // stampSource is what lands in the file, so the two branches are asserted on
  // the text rather than by writing to disk.
  const stamped = stampSource({ commitSha: full, builtAt: "2026-08-06T00:00:00.000Z" });
  assert.match(stamped, /commitSha: "4b1d9ca7f0e3268159acd47b0f2e6a58cd913720"/);
  const unstamped = stampSource({ commitSha: null, builtAt: "2026-08-06T00:00:00.000Z" });
  assert.match(unstamped, /commitSha: null/, "an unavailable sha is written as the explicit unknown marker");
  assert.doesNotMatch(unstamped, /[0-9a-f]{40}/, "nothing is fabricated when git cannot answer");

  // The generated module is valid on its own terms: both branches parse and
  // freeze, so a Function importing it cannot fail to boot.
  for (const source of [stamped, unstamped]) {
    const module = await import(`data:text/javascript,${encodeURIComponent(source)}`);
    assert.equal(Object.isFrozen(module.BUILD_STAMP), true);
    assert.equal(module.BUILD_STAMP.schemaVersion, 1);
  }
});
