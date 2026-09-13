// POST /api/post-reports against the real migrations (#2343): a report is
// stored privately, refused without a trace when it is wrong, and never readable
// through any public Social or People response.

import test from "node:test";
import assert from "node:assert/strict";
import { createTestD1 } from "./support/d1-sqlite.js";
import { onRequest as reportRequest } from "../functions/api/post-reports.js";
import { onRequest as postsRequest } from "../functions/api/social-posts/[[route]].js";
import { createMemoryRateLimiter } from "../src/social-posts-api.js";
import { createD1PostReportStore, handlePostReportRequest } from "../src/post-reports-api.js";
import { REPORT_REASONS } from "../src/post-report.js";
import { normalizeSocialApiPosts } from "../src/social.js";
import { normalizeProfileApiPosts } from "../src/profile.js";

const ORIGIN = "https://labs.wawalu.org";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const EMAIL = "reporter.private@example.org";
const CONTEXT = "It shows my neighbour's street address";
const VALID = { post_id: POST_ID, reason: "personal_information", context: CONTEXT, email: EMAIL };

const reportRequestFor = (body) => new Request(`${ORIGIN}/api/post-reports`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

async function setup(t) {
  const db = await createTestD1();
  t.after(() => db.close());
  // Stored with a `source`: both feed readers drop a post that has none, and a
  // leak check over an empty feed would pass for the wrong reason.
  await db.prepare("INSERT INTO social_posts (id, author, content, timestamp, source, principal_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(POST_ID, "Ari", "Shipped the focus rings.", "2026-09-01T09:00:00.000Z", "shiplog-web", "human:ari", "2026-09-01T09:00:00.000Z").run();
  return {
    db,
    report: (body) => reportRequest({ request: reportRequestFor(body), env: { DB: db } }),
    read: async (path) => (await postsRequest({ request: new Request(`${ORIGIN}${path}`), env: { DB: db } })).text(),
    count: async () => (await db.prepare("SELECT COUNT(*) AS n FROM social_post_reports").first()).n,
  };
}

test("a report writes one private row, answers with only an id and a status, and leaves the post alone", async (t) => {
  const { db, report, read, count } = await setup(t);
  const before = await read(`/api/social-posts/${POST_ID}`);

  const response = await report(VALID);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["id", "status"]);
  assert.equal(body.status, "received");

  const row = { ...await db.prepare("SELECT * FROM social_post_reports").first() };
  assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual({ ...row, created_at: "" }, {
    id: body.id, post_id: POST_ID, reason: "personal_information", context: CONTEXT, reporter_email: EMAIL, created_at: "", status: "open",
  });
  assert.equal(await read(`/api/social-posts/${POST_ID}`), before, "reporting changed what the post says");

  // A retry whose first answer was lost is the same report, not a second row.
  const retry = await report(VALID);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).id, body.id);
  assert.equal(await count(), 1);
});

test("every reason the form offers is one the table accepts", async (t) => {
  const { report, count } = await setup(t);
  for (const [index, reason] of REPORT_REASONS.entries()) {
    const response = await report({ post_id: POST_ID, reason: reason.value, email: `r${index}@example.org` });
    assert.equal(response.status, 201, reason.value);
  }
  assert.equal(await count(), REPORT_REASONS.length);
});

test("an unknown post, reason or email is refused and writes nothing", async (t) => {
  const { report, count } = await setup(t);
  for (const [name, body, status] of [
    ["unknown post", { ...VALID, post_id: "44444444-4444-4444-8444-444444444444" }, 404],
    ["bundled sample id", { ...VALID, post_id: "seed-post-1" }, 404],
    ["unknown reason", { ...VALID, reason: "boring" }, 422],
    ["bad email", { ...VALID, email: "not-an-email" }, 422],
    ["missing email", { post_id: POST_ID, reason: "spam" }, 400],
    ["note over the limit", { ...VALID, context: "x".repeat(501) }, 422],
    ["a field the form never sends", { ...VALID, status: "reviewed" }, 400],
  ]) {
    const response = await report(body);
    assert.equal(response.status, status, name);
    assert.equal((await response.text()).includes(EMAIL), false, `${name}: the refusal echoed the email`);
  }
  assert.equal(await count(), 0);
});

test("after a report, no Social, People or permalink read carries the email or the note", async (t) => {
  const { report, read } = await setup(t);
  assert.equal((await report(VALID)).status, 201);

  const feed = await read("/api/social-posts?limit=100");
  const permalink = await read(`/api/social-posts/${POST_ID}`);
  const comments = await read(`/api/social-posts/${POST_ID}/comments`);
  const social = normalizeSocialApiPosts(JSON.parse(feed));
  const people = normalizeProfileApiPosts(JSON.parse(feed));
  const single = normalizeSocialApiPosts({ posts: [JSON.parse(permalink).post] });
  // Not vacuous: the reported post is really in each read.
  assert.deepEqual([social.length, people.length, single.length], [1, 1, 1]);

  for (const [name, text] of Object.entries({
    feed, permalink, comments,
    social: JSON.stringify(social), people: JSON.stringify(people), single: JSON.stringify(single),
  })) {
    assert.equal(text.includes(EMAIL), false, `${name} carries the reporter's email`);
    assert.equal(text.includes(CONTEXT), false, `${name} carries the reporter's note`);
  }
});

test("a connection past its report budget is refused, and a storage failure copies nothing typed", async (t) => {
  const { db } = await setup(t);
  const deps = {
    store: createD1PostReportStore(db),
    identify: async () => ({ id: "human:one" }),
    rateLimit: createMemoryRateLimiter({ limit: 1 }),
  };
  assert.equal((await handlePostReportRequest(reportRequestFor({ ...VALID, email: "a@example.org" }), deps)).status, 201);
  const limited = await handlePostReportRequest(reportRequestFor({ ...VALID, email: "b@example.org" }), deps);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);

  const broken = await handlePostReportRequest(reportRequestFor(VALID), {
    store: { postExists: async () => true, save: async () => { throw new Error(`constraint failed for ${EMAIL}`); } },
  });
  assert.equal(broken.status, 500);
  assert.equal((await broken.text()).includes(EMAIL), false);
  assert.equal((await reportRequest({ request: reportRequestFor(VALID), env: {} })).status, 503);
});
