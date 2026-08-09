// Does /healthz prove that the build serving traffic is the build the release
// log says shipped — and does the page say the same thing, in the same words?
//
// Every case here is driven from a committed fixture
// (tests/fixtures/release-build-match.json), never from the commit that happens
// to be checked out: the four answers (matched, mismatched, empty log, missing
// stamp) have to be provable on demand, not observable once a release. Nothing
// opens a socket, reads a clock, or shells out to git — the D1 binding is a
// two-line double and the git call is injected.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initReleasesPage } from "../src/releases-page.js";
import {
  UNKNOWN_REASONS,
  VERDICTS,
  newestReleaseRecord,
  normalizeSha,
  releaseBuildMatch,
  releaseBuildMatchLine,
  releaseBuildStatus,
  shasMatch,
  shortSha,
} from "../src/release-build-match.js";
import { onRequest, releaseBuildFields } from "../functions/healthz.js";
import { headCommitSha, stampSource, writeBuildStamp } from "../scripts/write-build-stamp.mjs";
import { loadPage } from "./support/browser.js";
import { waitFor } from "./support/page-module.js";

const FIXTURE = JSON.parse(
  await readFile(new URL("./fixtures/release-build-match.json", import.meta.url), "utf8"),
);
const { stamp, unstampedBuild, matchingRelease, mismatchingRelease, olderRelease } = FIXTURE;

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const NO_SEED = { decisions: [], releases: [] };
const NOW = "2026-08-06T12:00:00.000Z";

// Written as escapes so this source file stays plain text: a right-to-left
// override in a release id must not survive into an operator's next action.
const BIDI_OVERRIDE = String.fromCharCode(0x202e);
const INVISIBLE = new RegExp("[\\u0000-\\u001f\\u007f\\u202a-\\u202e\\u2066-\\u2069]", "u");

// The binding the probe is allowed to depend on, and the only one. A store that
// answers its one read is the whole environment these tests need.
const workingDb = { prepare() { return { async first() { return { healthy: 1 }; } }; } };

function healthRequest() {
  return new Request("https://test.invalid/healthz", { headers: { "cf-ray": "release-build-match" } });
}

/** Drive the shipped handler with fixture inputs and hand back the parsed body. */
async function probe({ stamp: injectedStamp, releases }) {
  return {
    response: { status: 200 },
    body: { status: "healthy", storage: "available", ...releaseBuildFields(injectedStamp, releases) },
  };
}

/** The releases page, booted the way the browser boots it, with no network. */
async function openReleases(t, releases) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: { [STORAGE_KEY]: JSON.stringify([]), [RELEASE_STORAGE_KEY]: JSON.stringify(releases) },
  });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, {
    seed: NO_SEED,
    buildStamp: stamp,
    readHealth: async () => ({ status: "ok" }),
    now: () => NOW,
  });
  await waitFor(
    () => page.document.documentElement.dataset.shiplogDeployment === "ready",
    "the deployment status band never finished its comparison",
  );
  return page;
}

test("the comparison is over shas, tolerant of abbreviation and nothing else", () => {
  assert.equal(normalizeSha("  9F2C1AB4D7E60355  "), "9f2c1ab4d7e60355");
  // A version tag, a short hex run, and a non-string are all "no sha", never a
  // weak match: a record edited by hand must not compare as if it were a commit.
  for (const value of ["v1.4.0", "9f2c1a", "", "  ", null, 42, {}]) {
    assert.equal(normalizeSha(value), "", `${JSON.stringify(value)} must not read as a sha`);
  }
  assert.equal(shasMatch(stamp.commitSha, matchingRelease.commitSha), true, "an abbreviated record sha matches the full build sha");
  assert.equal(shasMatch(stamp.commitSha, mismatchingRelease.commitSha), false);
  assert.equal(shasMatch(stamp.commitSha, "v2.1.0"), false);
  assert.equal(shasMatch(null, null), false, "two absent shas are not a match");
  assert.equal(shortSha(stamp.commitSha), "9f2c1ab4d7e6");
  assert.equal(shortSha(null), "unknown");
});

test("the newest record by recorded time is the one compared", () => {
  assert.equal(newestReleaseRecord([olderRelease, matchingRelease])?.id, matchingRelease.id);
  assert.equal(newestReleaseRecord([matchingRelease, olderRelease])?.id, matchingRelease.id);
  assert.equal(newestReleaseRecord([]), null);
  for (const notALog of [null, undefined, "releases", 7, { id: "r-1" }]) {
    assert.equal(newestReleaseRecord(notALog), null, "anything that is not a list of records is an empty log");
  }
  // An undated record is still a record, and never displaces a dated one.
  const undated = { ...matchingRelease, id: "r-undated", createdAt: null };
  assert.equal(newestReleaseRecord([undated, olderRelease])?.id, olderRelease.id);
  assert.equal(newestReleaseRecord([undated])?.id, "r-undated");
});

test("/healthz answers 200 with matched and no action when the shas agree", async () => {
  const { response, body } = await probe({ stamp, releases: [olderRelease, matchingRelease] });
  assert.equal(response.status, 200);
  // The liveness signal is unchanged and still first.
  assert.equal(body.status, "healthy");
  assert.equal(body.storage, "available");
  assert.equal(body.verdict, VERDICTS.matched);
  assert.equal(body.build_sha, stamp.commitSha);
  assert.equal(body.built_at, stamp.builtAt);
  assert.equal(body.release_sha, matchingRelease.commitSha);
  assert.equal(body.release_id, matchingRelease.id);
  // No action text at all on a matched verdict: the key is absent, not empty.
  assert.equal("action" in body, false, "a matched build must emit no next action");
  assert.equal("reason" in body, false);
});

test("/healthz answers 200 with mismatched and exactly one action naming the release", async () => {
  const { response, body } = await probe({ stamp, releases: [olderRelease, mismatchingRelease] });
  assert.equal(response.status, 200);
  assert.equal(body.status, "healthy");
  assert.equal(body.verdict, VERDICTS.mismatched);
  assert.equal(body.release_id, mismatchingRelease.id);
  assert.equal(typeof body.action, "string", "one action, not a list of them");
  assert.ok(body.action.includes(mismatchingRelease.id), "the action must name the release id to open in the log");
  assert.ok(body.action.includes(shortSha(mismatchingRelease.commitSha)));
  assert.ok(body.action.includes(shortSha(stamp.commitSha)));
  assert.equal("reason" in body, false);
});

test("/healthz answers 200 with unknown and a machine-readable reason for each degraded case", async () => {
  const empty = await probe({ stamp, releases: [] });
  assert.equal(empty.response.status, 200);
  assert.equal(empty.body.status, "healthy", "an empty release log never touches the liveness signal");
  assert.equal(empty.body.verdict, VERDICTS.unknown);
  assert.equal(empty.body.reason, UNKNOWN_REASONS.emptyReleaseLog);
  assert.equal(empty.body.build_sha, stamp.commitSha, "an empty log still names the running build");
  assert.equal(empty.body.release_id, null);
  assert.equal("action" in empty.body, false);

  const unstamped = await probe({ stamp: unstampedBuild, releases: [matchingRelease] });
  assert.equal(unstamped.response.status, 200);
  assert.equal(unstamped.body.status, "healthy");
  assert.equal(unstamped.body.verdict, VERDICTS.unknown);
  assert.equal(unstamped.body.reason, UNKNOWN_REASONS.noBuildStamp);
  assert.equal(unstamped.body.build_sha, null);
  assert.equal("action" in unstamped.body, false);

  // The two degraded cases need different responses, so they must never read as
  // the same word: one is a build that cannot name itself, the other a log with
  // nothing in it.
  assert.notEqual(empty.body.reason, unstamped.body.reason);
  for (const degraded of [empty.body, unstamped.body]) {
    assert.match(degraded.reason, /^[a-z_]+$/, "the reason is a code an alert rule can match, not prose");
    assert.equal(typeof degraded.reason_detail, "string");
  }

  // A record that names no commit is its own reason, and still not a 500.
  const withoutSha = { ...matchingRelease };
  delete withoutSha.commitSha;
  const noSha = await probe({ stamp, releases: [withoutSha] });
  assert.equal(noSha.response.status, 200);
  assert.equal(noSha.body.verdict, VERDICTS.unknown);
  assert.equal(noSha.body.reason, UNKNOWN_REASONS.releaseHasNoCommitSha);
});

test("nothing an operator can feed the probe turns it into a 500", async () => {
  // Every one of these is a shape the module is documented to survive: a
  // rollout and a rollback both smoke-test this endpoint.
  const hostile = [
    { stamp: null, releases: null },
    { stamp: undefined, releases: undefined },
    { stamp: { commitSha: 12345, builtAt: {} }, releases: "not a log" },
    { stamp, releases: [null, "release", 7] },
    { stamp, releases: [{ ...matchingRelease, id: `r-${BIDI_OVERRIDE}2-1-0` }] },
    { stamp, releases: [{ ...matchingRelease, id: "x".repeat(400) }] },
  ];
  for (const inputs of hostile) {
    const { response, body } = await probe(inputs);
    assert.equal(response.status, 200, "every degraded input must still answer 200");
    assert.equal(body.status, "healthy");
    assert.ok(Object.values(VERDICTS).includes(body.verdict), "one of exactly three verdicts");
    if (typeof body.release_id === "string") {
      assert.ok(body.release_id.length <= 120, "a bounded id, so a record cannot flood the response");
      assert.doesNotMatch(body.release_id, INVISIBLE, "no invisible control reaches an operator's next action");
    }
  }
  // A comparison that somehow threw is still a 200 with a stated reason.
  const thrown = releaseBuildFields(
    { get commitSha() { throw new Error("stamp unreadable"); } },
    [matchingRelease],
  );
  assert.equal(thrown.verdict, VERDICTS.unknown);
  assert.match(thrown.reason_detail, /stamp unreadable/);
});

test("the page line and the probe are the same computation, not two copies of one sentence", async (t) => {
  const releases = [olderRelease, mismatchingRelease];
  const page = await openReleases(t, releases);

  const line = page.document.querySelector("#deployment-build-match");
  const expected = releaseBuildMatchLine(releaseBuildStatus(stamp, releases));
  // The rendered line IS the shared function's output for the same inputs. Not
  // "contains the same words" — the same string, so a change to the rule moves
  // the page and the probe together, or moves neither.
  assert.equal(line.textContent, expected);

  const { body } = await probe({ stamp, releases });
  assert.equal(body.verdict, VERDICTS.mismatched);
  assert.ok(line.textContent.includes(body.action), "the page carries the probe's next action verbatim");
  assert.ok(line.textContent.includes(mismatchingRelease.id));

  // It lives inside the deployment status band that already answers this
  // question, rather than in a new component of its own. Walked upward, because
  // the harness has no descendant selectors.
  let ancestor = line.parentNode;
  while (ancestor && ancestor.id !== "deployment-status") ancestor = ancestor.parentNode;
  assert.equal(ancestor?.id, "deployment-status", "the line belongs to the status surface that already exists");
  assert.equal(page.document.querySelectorAll("#deployment-build-match").length, 1, "exactly one such line");
});

test("a matched page says so and offers no next action", async (t) => {
  const releases = [olderRelease, matchingRelease];
  const page = await openReleases(t, releases);

  const text = page.document.querySelector("#deployment-build-match").textContent;
  assert.equal(text, releaseBuildMatchLine(releaseBuildStatus(stamp, releases)));
  assert.ok(text.includes(shortSha(stamp.commitSha)));
  assert.ok(text.includes(matchingRelease.id));
  const { body } = await probe({ stamp, releases });
  assert.equal("action" in body, false);
  assert.doesNotMatch(text, /Open release/, "a matched verdict names nothing to do");
});

test("both surfaces import the one comparison module and neither writes its own", async () => {
  const endpoint = await readFile(new URL("../functions/healthz.js", import.meta.url), "utf8");
  const surface = await readFile(new URL("../src/releases-page.js", import.meta.url), "utf8");
  assert.match(endpoint, /from "\.\.\/src\/release-build-match\.js"/);
  assert.match(surface, /from "\.\/release-build-match\.js"/);
  // Neither file may decide the verdict itself: the words below exist in one
  // module, so the page and the probe are structurally incapable of disagreeing.
  // Comments are where these files are allowed to name the verdict; code is not.
  const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const [name, source] of [["functions/healthz.js", endpoint], ["src/releases-page.js", surface]]) {
    assert.doesNotMatch(code(source), /mismatched/, `${name} must not author a verdict of its own`);
    assert.doesNotMatch(code(source), /Open release /, `${name} must not author a next action of its own`);
  }
  // And the shared result object is the single source of both, field for field.
  const result = releaseBuildMatch(stamp, mismatchingRelease);
  const fields = releaseBuildFields(stamp, [mismatchingRelease]);
  assert.deepEqual(
    { verdict: fields.verdict, sha: fields.build_sha, id: fields.release_id, action: fields.action },
    { verdict: result.verdict, sha: result.buildSha, id: result.releaseId, action: result.action },
  );
  assert.ok(releaseBuildMatchLine(result).includes(result.action));
});

test("the stamp is written from git, and a checkout without git is stamped unknown", async () => {
  const sha = "9f2c1ab4d7e60355a1c8b0d9e7f4a2b6c8d3e5f7";
  assert.equal(await headCommitSha({ git: async () => ({ stdout: `${sha.toUpperCase()}\n` }) }), sha);
  // Anything that is not a full sha — an error, an empty answer, a tag, junk —
  // is no sha at all. The build never invents one.
  for (const git of [
    async () => { throw new Error("not a git repository"); },
    async () => ({ stdout: "" }),
    async () => ({ stdout: "v2.1.0\n" }),
    async () => ({ stdout: `${sha}extra\n` }),
  ]) {
    assert.equal(await headCommitSha({ git }), null);
  }

  const source = stampSource({ commitSha: sha, builtAt: "2026-08-06T09:15:00.000Z" });
  assert.match(source, /GENERATED by scripts\/write-build-stamp\.mjs/);
  const stamped = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  assert.deepEqual({ ...stamped.BUILD_STAMP }, { schemaVersion: 1, commitSha: sha, builtAt: "2026-08-06T09:15:00.000Z" });

  const unstampedModule = await import(`data:text/javascript,${encodeURIComponent(stampSource({ commitSha: null, builtAt: null }))}`);
  assert.equal(unstampedModule.BUILD_STAMP.commitSha, null);
  // The absence of git is a handled case, not a crash: the file is still
  // written, the build carries on, and /healthz says `no_build_stamp`.
  assert.equal(
    releaseBuildStatus(unstampedModule.BUILD_STAMP, [matchingRelease]).reason,
    UNKNOWN_REASONS.noBuildStamp,
  );
});

test("writeBuildStamp writes exactly one importable file and reports what it wrote", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-build-stamp-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = resolve(directory, "build-stamp.js");
  const sha = "abcdef1234567890abcdef1234567890abcdef12";

  const stamped = await writeBuildStamp({
    path,
    git: async () => ({ stdout: `${sha}\n` }),
    now: () => new Date("2026-08-06T09:15:00.000Z"),
  });
  assert.deepEqual(stamped, { commitSha: sha, builtAt: "2026-08-06T09:15:00.000Z", path });
  const written = await import(`file://${path}`);
  assert.equal(written.BUILD_STAMP.commitSha, sha);
  assert.equal(releaseBuildStatus(written.BUILD_STAMP, [{ ...matchingRelease, commitSha: sha }]).verdict, VERDICTS.matched);

  // A checkout with no git metadata still produces a file, so the build's next
  // step — copying src/ into the artifact — has something to copy.
  const unstampedPath = resolve(directory, "unstamped.js");
  const unstamped = await writeBuildStamp({
    path: unstampedPath,
    git: async () => { throw new Error("no git here"); },
  });
  assert.deepEqual(unstamped, { commitSha: null, builtAt: null, path: unstampedPath });
  assert.equal((await import(`file://${unstampedPath}`)).BUILD_STAMP.commitSha, null);
});
