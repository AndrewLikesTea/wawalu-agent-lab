import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadPage, tabSequence } from './support/browser.js';
import { releaseSummarySentence } from '../src/releases.js';
import { bindDeploymentArrival } from '../src/releases-bootstrap.js';

const url = new URL('../src/releases.html', import.meta.url);

test('the complete release workspace precedes supporting evidence, sales, demo and coverage', async (t) => {
  const page = await loadPage(url);
  t.after(() => page.restore());
  const ids = ['releases-title', 'release-search', 'release-copy-link', 'release-list-status',
    'release-list', 'record-release', 'real-deployment', 'ask-about-shiplog',
    'shiplog-proof', 'repository-proof', 'evaluation-path', 'reasoning-proof'];
  const actual = page.document.querySelectorAll(ids.map(id => `#${id}`).join(','))
    .map(node => node.id);
  assert.deepEqual(actual, ids);
  assert.equal(page.document.querySelector('#record-release-link').getAttribute('href'), '#record-release');
  assert.equal(page.document.querySelector('#deployment-summary-link').getAttribute('href'), '#deployment-status-title');
  const html = await readFile(url, 'utf8');
  for (const href of ['/release.html?id=demo-r-1-3-0', '/releases.html?focus=demo-r-1-3-0#shiplog-proof']) {
    assert.ok(html.includes(`href="${href}"`), href);
  }
});

for (const id of ['main-content', 'releases-title', 'record-release', 'shipped-build',
  'deployment-status-title', 'shiplog-proof', 'evaluation-path', 'reasoning-proof']) {
  test(`fragment arrival and repeated activation focus #${id} without adding a tab stop`, async (t) => {
    const page = await loadPage(url);
    t.after(() => page.restore());
    const link = page.document.createElement('a');
    link.setAttribute('href', `#${id}`);
    page.document.body.append(link);
    const view = { location: { hash: `#${id}` }, addEventListener() {} };
    bindDeploymentArrival(page.document, view);
    const target = page.document.querySelector(`#${id}`);
    assert.equal(page.document.activeElement?.id, id);
    assert.equal(target.getAttribute('tabindex'), '-1');
    assert.ok(!tabSequence(page.document).includes(target));
    link.focus();
    link.click();
    assert.equal(page.document.activeElement?.id, id);
  });
}

test('large count text and column filters use resilient product sizing and focus rules', async () => {
  const css = await readFile(new URL('../src/releases-proof.css', import.meta.url), 'utf8');
  assert.match(css, /#release-count[^}]*min-width:0; overflow-wrap:anywhere/);
  assert.match(css, /max-width:520px[^\n]*release-decision-id-filter\{flex-basis:auto/);
  assert.match(css, /\[tabindex="-1"\]:focus[^}]*outline:3px solid var\(--focus-ring\)/);
  assert.doesNotMatch(css, /(?:^|[;{])\s*order\s*:/);
});

 test('very large result counts remain complete, including filtered totals', async (t) => {
  const page = await loadPage(url);
  t.after(() => page.restore());
  const count = page.document.querySelector('#release-count');
  count.textContent = releaseSummarySentence(123456789, 987654321);
  assert.equal(count.textContent, 'Showing 123456789 of 987654321 releases, newest first.');
  assert.equal(count.getAttribute('aria-live'), 'polite');
});
