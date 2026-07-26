import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createManifest, verifyArtifact } from "../scripts/verify-build.mjs";

test("product has a health endpoint and accessible title", async () => {
  assert.equal((await readFile(new URL("../src/healthz", import.meta.url), "utf8")).trim(), "ok");
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>Shiplog/);
  assert.match(html, /<main>/);
  assert.match(html, /<label for="title">Title<\/label>/);
  assert.match(html, /<label for="context">Context<\/label>/);
  assert.match(html, /<label for="owner">Owner<\/label>/);
  assert.match(html, /<label for="status">Status<\/label>/);
  assert.match(html, /<label for="filter-status">Filter by status:<\/label>\s*<select id="filter-status">\s*<option value="all">all<\/option>/);
  assert.match(html, /<label for="filter-owner">Filter by owner:<\/label>\s*<select id="filter-owner">\s*<option value="all">all<\/option>/);
});

test("homepage explains the decision-to-release value and links to live examples", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");

  assert.match(html, /Know why it shipped\./);
  assert.match(html, /record decisions and track the releases/);
  assert.match(html, /id="decision-to-release"/);
  assert.match(html, /Keep reasoning with the work/);
  assert.match(html, /data-proof-point="decision-to-release"/);
  assert.match(html, /data-conversion-slot="hero"/);
  assert.match(html, /href="\/decision\.html\?id=demo-queue"/);
  assert.match(html, /href="\/release\.html\?id=demo-r-1-3-0"/);
});

test("security headers ship with the site", async () => {
  const headers = await readFile(new URL("../src/_headers", import.meta.url), "utf8");
  assert.match(headers, /Content-Security-Policy:.*script-src 'self'/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /connect-src 'self' https:\/\/api\.github\.com/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
});

test("build manifest is reproducible and detects artifact mutation", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-artifact-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await cp(new URL("../src", import.meta.url), directory, { recursive: true });

  const first = await createManifest(directory);
  const firstBytes = await readFile(resolve(directory, "build-manifest.json"), "utf8");
  const second = await createManifest(directory);
  assert.deepEqual(second, first);
  assert.equal(await readFile(resolve(directory, "build-manifest.json"), "utf8"), firstBytes);
  await verifyArtifact(directory);

  await writeFile(resolve(directory, "social.js"), "tampered\n");
  await assert.rejects(verifyArtifact(directory), /does not match build manifest/);
});
