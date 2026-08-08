import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createD1FollowUpStore, createMemoryFollowUpStore, handleFollowUpRequest, normalizeInterest,
} from "../src/follow-ups.js";
import { onRequest } from "../functions/api/follow-ups.js";
import { createTestD1 } from "./support/d1-sqlite.js";

const request = (body, options = {}) => new Request("https://shiplog.test/api/follow-ups", {
  method: options.method ?? "POST",
  headers: options.headers ?? { "content-type": "application/json" },
  body: body === undefined ? undefined : (options.raw ? body : JSON.stringify(body)),
});

test("follow-up accepts exactly email and optional interest", async () => {
  const store = createMemoryFollowUpStore();
  const first = await handleFollowUpRequest(request({ email: " Remy@Example.com " }), { store, requestId: "f1" });
  const second = await handleFollowUpRequest(request({
    email: "remy@example.com", interest: "  Help evaluating Shiplog for releases.  ",
  }), { store, requestId: "f2" });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.deepEqual(store.submissions, [
    { email: "remy@example.com", interest: null },
    { email: "remy@example.com", interest: "Help evaluating Shiplog for releases." },
  ]);
  assert.equal(normalizeInterest("   "), null);
});

test("follow-up rejects extra, malformed, and oversized fields without storage", async () => {
  const store = createMemoryFollowUpStore();
  const cases = [
    request({ email: "remy@example.com", activity: "release viewed" }),
    request({ email: "bad", interest: "hello" }),
    request({ email: "remy@example.com", interest: "x".repeat(501) }),
    request("{", { raw: true }),
  ];
  for (const candidate of cases) assert.ok((await handleFollowUpRequest(candidate, { store })).status >= 400);
  assert.deepEqual(store.submissions, []);
});

test("D1 persists only the two disclosed columns", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  db.raw.exec(await readFile(new URL("../migrations/0008_follow_up_submissions.sql", import.meta.url), "utf8"));
  const store = createD1FollowUpStore(db);
  await store.capture("remy@example.com", "Release guidance");
  assert.deepEqual(
    db.raw.prepare("SELECT email, interest FROM follow_up_submissions").all().map((row) => ({ ...row })),
    [{ email: "remy@example.com", interest: "Release guidance" }],
  );
  assert.deepEqual(
    db.raw.prepare("PRAGMA table_info(follow_up_submissions)").all().map((column) => column.name),
    ["email", "interest"],
  );
});

test("Pages adapter fails closed without the D1 binding", async () => {
  const response = await onRequest({ request: request({ email: "remy@example.com" }), env: {} });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "storage_unavailable");
});

test("migration and adapter ship with the closed storage contract", async () => {
  const [migration, adapter] = await Promise.all([
    readFile(new URL("../migrations/0008_follow_up_submissions.sql", import.meta.url), "utf8"),
    readFile(new URL("../functions/api/follow-ups.js", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /follow_up_submissions/);
  assert.doesNotMatch(migration, /activity|prompt|export|social/i);
  assert.match(adapter, /createD1FollowUpStore/);
});
