import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createShiplogArchive, serializeShiplogArchive, handleArchiveRequest, ARCHIVE_MAX_BYTES } from "../src/shiplog-archive.js";
import { onRequest } from "../functions/api/shiplog-archive.js";
import { initShiplogArchive } from "../src/shiplog-archive-page.js";
import { STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";

const generatedAt = "2026-07-15T09:00:00.000Z";
const decision = id => ({ id, title: "Choose queues", context: "Retry jobs", alternatives: "Polling", owner: "Rowan", status: "accepted", createdAt: generatedAt });
const release = (id, decisionIds = []) => ({ id, version: "v1", createdAt: generatedAt, decisionIds });
const populated = () => ({ decisions: [decision("z"), decision("a")], releases: [release("r-z"), release("r-a", ["z", "a"])] });
const request = (value, options = {}) => new Request("https://shiplog.test/api/shiplog-archive", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value), ...options,
});

test("complete archive has required fields, metadata, sorted records and relationships, and no unrelated fields", () => {
  const input = populated();
  input.customer = "excluded";
  input.decisions[0].customer = "excluded";
  input.decisions[0].finopsCommitment = { unrelated: true };
  const original = structuredClone(input);
  const body = serializeShiplogArchive(input, { generatedAt });
  const archive = JSON.parse(body);
  assert.deepEqual(Object.keys(archive), ["schemaVersion", "generatedAt", "decisions", "releases"]);
  assert.equal(archive.schemaVersion, 1);
  assert.equal(archive.generatedAt, generatedAt);
  assert.deepEqual(archive.decisions, [decision("a"), decision("z")]);
  assert.deepEqual(archive.releases, [release("r-a", ["a", "z"]), release("r-z")]);
  assert.doesNotMatch(body, /customer|finopsCommitment/);
  assert.deepEqual(input, original);
  input.decisions.reverse(); input.releases.reverse(); input.releases[1].decisionIds.reverse();
  assert.equal(serializeShiplogArchive(input, { generatedAt }), body);
});

test("legacy alternatives and unlinked releases remain explicit; unresolved identifiers are preserved", () => {
  const d = decision("a"); delete d.alternatives;
  const archive = createShiplogArchive({ decisions: [d], releases: [{ id: "r" }, release("s", ["missing", "a", "a"])] }, { generatedAt });
  assert.equal(archive.decisions[0].alternatives, "");
  assert.deepEqual(archive.releases[0].decisionIds, []);
  assert.deepEqual(archive.releases[1].decisionIds, ["a", "missing"]);
});

test("empty archive is valid and timestamp injection is mandatory", () => {
  const empty = { decisions: [], releases: [] };
  assert.deepEqual(JSON.parse(serializeShiplogArchive(empty, { generatedAt })), { schemaVersion: 1, generatedAt, ...empty });
  for (const stamp of [undefined, "yesterday", "2026-02-30T00:00:00.000Z"]) {
    assert.throws(() => createShiplogArchive(empty, { generatedAt: stamp }), /timestamp/);
  }
  for (const field of ["id", "context", "owner", "status"]) {
    const d = decision("a"); delete d[field];
    assert.throws(() => createShiplogArchive({ decisions: [d], releases: [] }, { generatedAt }));
  }
  assert.throws(() => createShiplogArchive({ decisions: [decision("a"), decision("a")], releases: [] }, { generatedAt }), /duplicate/);
});

test("server download serializes the contract with a controlled clock, filename and MIME", async () => {
  const response = await handleArchiveRequest(request(populated()), { now: () => new Date(generatedAt) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="shiplog-archive-2026-07-15.json"');
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), serializeShiplogArchive(populated(), { generatedAt }));
  const empty = await onRequest({ request: request({ decisions: [], releases: [] }) });
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).releases, []);
});

test("API rejects malformed, oversized, cross-origin and unsupported requests", async () => {
  for (const [req, status] of [
    [new Request("https://shiplog.test/api/shiplog-archive"), 405],
    [request({}), 400],
    [request({}, { body: "{" }), 400],
    [request({}, { headers: { "content-type": "text/plain" } }), 415],
    [request({}, { headers: { "content-type": "application/json", origin: "https://other.test" } }), 403],
    [request({}, { body: " ".repeat(ARCHIVE_MAX_BYTES + 1) }), 413],
  ]) assert.equal((await handleArchiveRequest(req)).status, status);
});

test("visible action downloads all local records through the server and announces failures", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert.match(html, /<button id="download-shiplog-archive" type="button" aria-describedby="shiplog-archive-note">Download complete Shiplog archive/);
  const entry = await readFile(new URL("../src/shiplog-export-page.js", import.meta.url), "utf8");
  assert.match(entry, /initShiplogArchive\(document, localStorage\)/);
  let click, blob, downloaded, revoked, fail = false;
  const button = { addEventListener(event, handler) { assert.equal(event, "click"); click = handler; } };
  const status = {};
  const document = {
    getElementById: id => id === "download-shiplog-archive" ? button : status,
    body: { append() {} },
    createElement: () => ({ click() { downloaded = this.download; }, remove() {} }),
  };
  const input = populated(); input.decisions[0].customer = "private";
  const values = { [STORAGE_KEY]: JSON.stringify(input.decisions), [RELEASE_STORAGE_KEY]: JSON.stringify(input.releases), unrelated: "private" };
  initShiplogArchive(document, { getItem: key => values[key] ?? null }, {
    fetch: async (url, options) => {
      assert.equal(url, "/api/shiplog-archive");
      assert.equal(options.credentials, "omit");
      assert.doesNotMatch(options.body, /private|customer|unrelated/);
      if (fail) return new Response("Unavailable", { status: 503 });
      return handleArchiveRequest(new Request(`https://shiplog.test${url}`, options), { now: () => new Date(generatedAt) });
    },
    urlApi: { createObjectURL(value) { blob = value; return "blob:archive"; }, revokeObjectURL(value) { revoked = value; } },
  });
  await click();
  assert.deepEqual(JSON.parse(await blob.text()), createShiplogArchive(input, { generatedAt }));
  assert.equal(blob.type, "application/json;charset=utf-8");
  assert.equal(downloaded, "shiplog-archive-2026-07-15.json");
  assert.equal(revoked, "blob:archive");
  assert.match(status.textContent, /downloaded/);
  assert.equal(button.disabled, false);
  fail = true; downloaded = undefined;
  await click();
  assert.equal(downloaded, undefined);
  assert.match(status.textContent, /could not be downloaded/);
  assert.equal(button.disabled, false);
});
