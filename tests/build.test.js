import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("product has a health endpoint and accessible title", async () => {
  assert.equal((await readFile(new URL("../src/healthz", import.meta.url), "utf8")).trim(), "ok");
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>Shiplog/);
  assert.match(html, /<main>/);
  assert.match(html, /<label for="title">Title<\/label>/);
  assert.match(html, /<label for="context">Context<\/label>/);
  assert.match(html, /<label for="owner">Owner<\/label>/);
  assert.match(html, /<label for="status">Status<\/label>/);
});
