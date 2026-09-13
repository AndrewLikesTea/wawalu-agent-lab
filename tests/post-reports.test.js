import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestD1, MIGRATIONS } from './support/d1-sqlite.js';
import { createD1ReportStore, handleReportRequest } from '../src/post-reports-api.js';
import { createD1SocialPostStore, handleSocialPostsRequest } from '../src/social-posts-api.js';
import { onRequest } from '../functions/api/post-reports.js';
import { normalizeProfileApiPosts } from '../src/profile.js';
import { normalizeSocialApiPosts } from '../src/social.js';

const id = '12345678-1234-4234-8234-123456789abc';
const input = { submission_id: '12345678-1234-4234-8234-123456789def', post_id: id, reason: 'sensitive', context: 'Private context', email: 'private@example.org' };
const request = (body = input, method = 'POST') => new Request('https://labs.wawalu.org/api/post-reports', { method, headers: { 'content-type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
async function setup(t) {
  const db = await createTestD1({ migrations: [...MIGRATIONS, '0013_post_reports.sql'] });
  t.after(() => db.close());
  const posts = createD1SocialPostStore(db);
  await posts.create({ id, author: 'Ari', content: 'Public post', timestamp: '2026-09-13T00:00:00Z', source: 'test', principal_id: 'test', created_at: '2026-09-13T00:00:00Z' });
  return { db, posts, reports: createD1ReportStore(db) };
}

test('edge click payload persists selected post privately, with atomic retry deduplication', async t => {
  const deps = await setup(t);
  for (const result of await Promise.all([onRequest({ request: request(), env: { DB: deps.db } }), onRequest({ request: request(), env: { DB: deps.db } })])) {
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { accepted: true });
    assert.equal(result.headers.get('cache-control'), 'no-store');
  }
  const stored = await deps.db.prepare('SELECT * FROM post_reports').all();
  assert.equal(stored.results.length, 1);
  for (const key of Object.keys(input)) assert.equal(stored.results[0][key], input[key]);
  assert.ok(stored.results[0].created_at);
  assert.equal((await handleReportRequest(request({ ...input, context: 'Changed' }), deps)).status, 409);
  for (const path of ['', `/${id}`, `/${id}/comments`]) {
    const response = await handleSocialPostsRequest(new Request(`https://labs.wawalu.org/api/social-posts${path}`), { store: deps.posts, comments: { list: async () => [] }, requestId: 'test' });
    const body = await response.json();
    const serialized = JSON.stringify([body, normalizeProfileApiPosts(body), normalizeSocialApiPosts(body)]);
    for (const secret of [input.context, input.email, input.submission_id]) assert.equal(serialized.includes(secret), false);
  }
  assert.equal((await handleReportRequest(request(undefined, 'GET'), deps)).status, 405);
});

test('validation refuses invalid, missing and unknown post values without storing or echoing private input', async t => {
  const deps = await setup(t);
  for (const patch of [{ reason: '' }, { reason: 'spam' }, { reason: 'other', context: ' ' }, { context: 'x'.repeat(2001) }, { email: 'bad' }, { email: null }, { post_id: '' }, { submission_id: 'bad' }, { reason: {} }]) {
    const response = await handleReportRequest(request({ ...input, ...patch }), deps);
    assert.equal(response.status, 422);
    assert.equal((await response.text()).includes(input.email), false);
  }
  assert.equal((await handleReportRequest(request({ ...input, post_id: 'unknown' }), deps)).status, 404);
  assert.equal((await deps.db.prepare('SELECT COUNT(*) AS count FROM post_reports').first()).count, 0);
  assert.equal((await handleReportRequest(request({ ...input, post_id: 'seed-post-1' }), deps)).status, 200);
});

test('malformed requests, cross-origin writes, and storage errors fail without exposing private details', async t => {
  const deps = await setup(t);
  for (const [body, type, origin, expected] of [['{', 'application/json', null, 400], ['x'.repeat(16001), 'application/json', null, 413], ['{}', 'text/plain', null, 415], ['{}', 'application/json', 'https://other.example', 403]]) {
    const req = new Request('https://labs.wawalu.org/api/post-reports', { method: 'POST', headers: { 'content-type': type, ...(origin ? { origin } : {}) }, body });
    assert.equal((await handleReportRequest(req, deps)).status, expected);
  }
  const failure = await handleReportRequest(request(), { ...deps, reports: { save() { throw new Error(input.email); } } });
  assert.equal(failure.status, 503);
  assert.equal((await failure.text()).includes(input.email), false);
  assert.equal((await onRequest({ request: request(), env: {} })).status, 503);
});
