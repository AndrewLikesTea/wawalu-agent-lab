import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './support/browser.js';
import { waitFor } from './support/page-module.js';
import { mountReportPage } from '../src/report-post-page.js';
import { REPORT_REASONS } from '../src/post-reports-api.js';
import { renderPosts } from '../src/social.js';
import { renderProfileGrid } from '../src/profile.js';
const pageUrl = new URL('../src/report-post.html', import.meta.url);
const post = { id: 'seed-post-1', author: 'Ari', body: 'Selected post', createdAt: '2026-09-13T00:00:00Z', image: { src: '/media/focus-ring.svg', alt: 'Focus ring' } };

test('Social and People render a post-specific report action on every loaded card, including text posts', async t => {
  const page = await loadPage(pageUrl);
  t.after(() => page.restore());
  for (const render of [renderPosts, renderProfileGrid]) {
    const container = document.createElement('div');
    const posts = [post, { ...post, id: 'seed-post-2', image: undefined, body: 'Second post' }];
    render(container, posts);
    const links = container.querySelectorAll('.post-report-link');
    assert.equal(links.length, 2);
    links.forEach((link, index) => {
      assert.equal(link.textContent, 'Report post');
      assert.equal(link.href, `/report-post.html?id=${posts[index].id}`);
      assert.ok(link.getAttribute('aria-describedby'));
      assert.notEqual(link.parentNode.tagName, 'A');
    });
  }
});

test('opened flow names the post and a reason; failures keep entries; retry reuses the ID until entries change, then confirms in-page', async t => {
  const page = await loadPage(pageUrl);
  t.after(() => page.restore());
  const calls = [];
  let settle;
  let ids = 0;
  const fetcher = async (url, options) => {
    if (url === '/social-demo-data.json') return { ok: true, json: async () => ({ posts: [post] }) };
    calls.push(JSON.parse(options.body));
    if (calls.length === 1) return new Promise(resolve => { settle = resolve; });
    // A host error page, not the API's JSON: its parse error must not reach the visitor.
    if (calls.length === 2) return { ok: false, json: async () => { throw new SyntaxError('Unexpected token <'); } };
    return { ok: true, json: async () => ({ accepted: true }) };
  };
  await mountReportPage(document, { search: `?id=${post.id}`, fetcher, uuid: () => `id-${++ids}` });
  const get = id => document.querySelector(`#${id}`);
  const reasons = document.querySelectorAll('input[name="reason"]');
  assert.equal(get('selected-post').textContent, 'You are reporting this post by Ari: “Selected post”');
  assert.deepEqual(reasons.map(radio => radio.value), REPORT_REASONS, 'the form offers exactly the reasons the server stores');
  assert.match(get('report-disclosure').textContent, /email.*random submission ID/);
  assert.match(get('report-disclosure').textContent, /privately/);
  get('report-submit').click();
  assert.equal(calls.length, 0, 'required fields prevent submission');
  get('report-email').value = 'private@example.org';
  get('report-submit').click();
  assert.equal(calls.length, 0, 'a report without a chosen reason is not sent');
  assert.equal(get('report-status').textContent, 'Choose a reason for the report.');
  reasons[1].click();
  get('report-context').value = 'Private context';
  get('report-submit').click();
  get('report-submit').click();
  assert.equal(calls.length, 1);
  assert.equal(get('report-submit').disabled, true);
  settle({ ok: false, json: async () => ({ error: { message: 'Temporarily unavailable.' } }) });
  await waitFor(() => !get('report-submit').disabled, 'submission fails');
  assert.equal(get('report-submit').textContent, 'Retry report');
  assert.equal(get('report-status').textContent, 'Temporarily unavailable. Your entries are still here. Select Retry report.');
  assert.equal(reasons[1].checked, true);
  assert.equal(get('report-context').value, 'Private context');
  assert.equal(get('report-email').value, 'private@example.org');
  get('report-submit').click();
  await waitFor(() => calls.length === 2 && !get('report-submit').disabled, 'unchanged retry fails');
  assert.deepEqual(calls[1], calls[0], 'an unchanged retry resends the same report under the same ID');
  assert.equal(get('report-status').textContent, 'We could not confirm your report was received. Your entries are still here. Select Retry report.');
  get('report-email').value = 'corrected@example.org';
  get('report-submit').click();
  await waitFor(() => get('report-form').hidden, 'confirmation');
  assert.notEqual(calls[2].submission_id, calls[0].submission_id, 'changed entries are a new report, not a conflicting retry');
  assert.equal(calls[0].post_id, post.id);
  assert.equal(calls[0].reason, 'sensitive');
  assert.deepEqual(Object.keys(calls[0]).sort(), ['post_id', 'submission_id', 'reason', 'context', 'email'].sort());
  assert.match(get('report-status').textContent, /received.*team will review.*not been removed/);
  get('report-submit').click();
  assert.equal(calls.length, 3);
  assert.equal(page.storage.length, 0);
});

test('unselected and failed post lookup cannot submit; load retry resolves live selected post', async t => {
  const page = await loadPage(pageUrl);
  t.after(() => page.restore());
  let count = 0;
  const fetcher = async url => {
    assert.equal(url, '/api/social-posts/live-id');
    count++;
    return { ok: count > 1, json: async () => ({ post: { id: 'live-id', author: 'Ari', content: 'Live post' } }) };
  };
  await mountReportPage(document, { search: '?id=live-id', fetcher });
  assert.equal(document.querySelector('#report-form').hidden, true);
  document.querySelector('#load-retry').click();
  await waitFor(() => !document.querySelector('#report-form').hidden, 'live post loaded');
  assert.equal(document.querySelector('#selected-post').textContent, 'You are reporting this post by Ari: “Live post”');
});

test('real form to D1: a lost success response retries into the same private row', async t => {
  const { createTestD1, MIGRATIONS } = await import('./support/d1-sqlite.js');
  const { onRequest } = await import('../functions/api/post-reports.js');
  const db = await createTestD1({ migrations: [...MIGRATIONS, '0013_post_reports.sql'] });
  const page = await loadPage(pageUrl);
  t.after(() => { page.restore(); db.close(); });
  let writes = 0;
  const fetcher = async (url, options) => {
    if (url === '/social-demo-data.json') return { ok: true, json: async () => ({ posts: [post] }) };
    const response = await onRequest({ request: new Request(`https://labs.wawalu.org${url}`, options), env: { DB: db } });
    writes++;
    if (writes === 1) throw new Error('Connection lost after sending.');
    return response;
  };
  await mountReportPage(document, { search: `?id=${post.id}`, fetcher, uuid: () => '12345678-1234-4234-8234-123456789def' });
  document.querySelectorAll('input[name="reason"]')[0].click();
  document.querySelector('#report-email').value = 'followup@example.org';
  const submit = document.querySelector('#report-submit');
  submit.click();
  await waitFor(() => submit.textContent === 'Retry report', 'lost receipt retry');
  assert.doesNotMatch(document.querySelector('#report-status').textContent, /Connection lost/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM post_reports').first()).count, 1);
  submit.click();
  await waitFor(() => document.querySelector('#report-form').hidden, 'idempotent receipt');
  const rows = await db.prepare('SELECT post_id,reason,context,email FROM post_reports').all();
  assert.deepEqual(rows.results.map(row => ({ ...row })), [{ post_id: post.id, reason: 'harmful', context: '', email: 'followup@example.org' }]);
});
