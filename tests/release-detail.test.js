import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  resolveReleaseDetail,
  releaseDetailHref,
  decisionDetailHref,
  RELEASE_LIST_HREF,
} from "../src/releases.js";

const decisions = [
  { id: "d-queue", title: "Durable queue", context: "c", owner: "Kai",   status: "accepted", createdAt: "2026-05-02T00:00:00.000Z" },
  { id: "d-cache", title: "Read cache",    context: "c", owner: "Ari",   status: "accepted", createdAt: "2026-05-20T00:00:00.000Z" },
  { id: "d-flags", title: "Feature flags", context: "c", owner: "Priya", status: "proposed", createdAt: "2026-06-01T00:00:00.000Z" },
];

const releases = [
  { id: "r-new", version: "v1.3.0", author: "Priya", notes: "n", createdAt: "2026-07-01T00:00:00.000Z", decisionIds: ["d-flags", "d-queue"] },
  { id: "r-mid", version: "v1.2.0", createdAt: "2026-05-25T00:00:00.000Z", decisionIds: ["d-cache", "ghost"] },
  { id: "r-old", version: "v1.0.0", createdAt: "2026-03-15T00:00:00.000Z", decisionIds: [] },
];

test("resolveReleaseDetail finds a release by id and resolves its decisions", () => {
  const resolved = resolveReleaseDetail(releases, decisions, "r-new");
  assert.equal(resolved.version, "v1.3.0");
  assert.equal(resolved.author, "Priya"); // author passes through untouched
  assert.deepEqual(resolved.decisions.map((d) => d.id), ["d-flags", "d-queue"]);
  assert.equal(resolved.counts.linked, 2);
  assert.deepEqual(resolved.missingIds, []);
});

test("resolveReleaseDetail surfaces dangling decision references", () => {
  const resolved = resolveReleaseDetail(releases, decisions, "r-mid");
  assert.deepEqual(resolved.decisions.map((d) => d.id), ["d-cache"]);
  assert.deepEqual(resolved.missingIds, ["ghost"]);
  assert.equal(resolved.counts.missing, 1);
});

test("resolveReleaseDetail preserves association order around missing decisions", () => {
  const resolved = resolveReleaseDetail([
    { id: "mixed", version: "v2", createdAt: "2026-07-01T00:00:00.000Z", decisionIds: ["d-queue", "ghost", "d-cache"] },
  ], decisions, "mixed");
  assert.deepEqual(resolved.associations.map(({ id, missing }) => ({ id, missing })), [
    { id: "d-queue", missing: false },
    { id: "ghost", missing: true },
    { id: "d-cache", missing: false },
  ]);
});

test("resolveReleaseDetail returns null for an unknown or empty id", () => {
  assert.equal(resolveReleaseDetail(releases, decisions, "nope"), null);
  assert.equal(resolveReleaseDetail(releases, decisions, ""), null);
  assert.equal(resolveReleaseDetail(undefined, decisions, "r-new"), null);
});

test("href builders produce stable, encoded routes", () => {
  assert.equal(releaseDetailHref("demo-r-1-4-0"), "/release.html?id=demo-r-1-4-0");
  assert.equal(decisionDetailHref("demo-flags"), "/#decision-demo-flags");
  // Ids are encoded so an unusual id can never break the URL.
  assert.equal(releaseDetailHref("a/b c"), "/release.html?id=a%2Fb%20c");
  assert.equal(decisionDetailHref("a b"), "/#decision-a%20b");
  assert.equal(RELEASE_LIST_HREF, "/releases.html");
});

test("release detail page and its wiring are present and safe", async () => {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [html, wiring, data] = await Promise.all([
    read("src/release.html"), read("src/release-page.js"), read("src/releases-data.js"),
  ]);
  assert.match(html, /<title>Release · Shiplog<\/title>/);
  assert.match(html, /id="release-detail"/);
  assert.match(html, /src="\/release-page\.js"/);
  assert.match(wiring, /resolveReleaseDetail/);
  assert.match(wiring, /URLSearchParams/);
  assert.match(wiring, /Release not found · Shiplog/);
  // No innerHTML anywhere in the detail layers (no user-generated HTML).
  assert.doesNotMatch(`${wiring}\n${data}`, /innerHTML/);
});

test("decisions are addressable for deep links from the detail view", async () => {
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(app, /article\.id = `decision-\$\{decision\.id\}`/);
});

test("the release list links each row to its detail page", async () => {
  const releasesJs = await readFile(new URL("../src/releases.js", import.meta.url), "utf8");
  assert.match(releasesJs, /releaseDetailHref\(release\.id\)/);
});
