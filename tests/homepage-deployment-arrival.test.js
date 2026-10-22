import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bindDeploymentArrival, bootReleases } from '../src/releases-bootstrap.js';
import { initDeploymentStatus } from '../src/deployment-status-view.js';
import { loadPage, textOf, tabSequence } from './support/browser.js';

const fragment = '#deployment-status-title';
const sha = '0123456789abcdef0123456789abcdef01234567';
const buildStamp = { schemaVersion: 1, commitSha: sha, builtAt: '2026-08-17T08:00:00.000Z' };
async function open(t, hash = fragment) {
  const page = await loadPage(new URL('../src/releases.html', import.meta.url));
  t.after(() => page.restore());
  const listeners = [];
  const view = { location: { hash }, addEventListener(name, fn) {
    assert.equal(name, 'hashchange'); listeners.push(fn);
  } };
  bindDeploymentArrival(page.document, view);
  return { ...page, view, listeners, heading: page.document.querySelector(fragment) };
}

test('homepage repository evidence offers a semantic link distinguishing history from live verification', async (t) => {
  const page = await loadPage(new URL('../src/index.html', import.meta.url));
  t.after(() => page.restore());
  const link = page.document.querySelector('#repository-evidence').querySelector('#repository-deployment-check');
  assert.equal(link.tagName, 'A');
  assert.equal(link.getAttribute('href'), `/releases.html${fragment}`);
  assert.equal(textOf(link), 'Verify the running build in the Releases deployment check');
  assert.match(textOf(link.parentNode), /^Repository history records what was built, not which build this site serves now\. /);
  assert.ok(tabSequence(page.document).includes(link));
  assert.equal(link.getAttribute('target'), null);
});

for (const hash of ['', '#shipped-build', '#unrelated', '#deployment-status-title-bogus']) {
  test(`ordinary or unrelated visit (${hash}) preserves focus; later check navigation focuses once`, async (t) => {
    const { document, heading, view, listeners } = await open(t, hash);
    assert.notEqual(document.activeElement, heading);
    view.location.hash = fragment;
    listeners[0]();
    assert.equal(document.activeElement, heading);
    assert.equal(heading.getAttribute('tabindex'), '-1');
    assert.ok(!tabSequence(document).includes(heading));
    bindDeploymentArrival(document, view);
    assert.equal(listeners.length, 1);
  });
}

for (const [name, health, state] of [
  ['match', { status: 'healthy', version: sha }, 'match'],
  ['different build', { status: 'healthy', version: 'other-build' }, 'drift'],
  ['malformed', ['healthy'], 'unknown'],
  ['missing', null, 'unknown'],
  ['unavailable', undefined, 'unknown'],
]) {
  test(`deep-linked check uses the existing ${name} verdict without stealing focus on completion`, async (t) => {
    const { document, heading } = await open(t);
    assert.equal(document.activeElement, heading);
    let answer;
    const result = initDeploymentStatus(document, { buildStamp,
      readHealth: () => new Promise((resolve, reject) => { answer = () => health === undefined ? reject(new Error('offline')) : resolve(health); }),
    });
    const panel = document.querySelector('#deployment-status');
    assert.equal(panel.dataset.deploymentState, 'loading');
    assert.match(textOf(document.querySelector('#deployment-verdict')), /Checking/);
    assert.equal(document.activeElement, heading);
    const copy = document.querySelector('#deployment-evidence-summary');
    copy.focus();
    answer();
    const verdict = await result;
    assert.equal(verdict.state, state);
    assert.equal(panel.dataset.deploymentState, state);
    assert.equal(document.activeElement, copy);
    const sentence = textOf(document.querySelector('#deployment-verdict'));
    if (state === 'match') assert.match(sentence, /^Confirmed:.*matching the recorded build/);
    if (state === 'drift') assert.match(sentence, /^Not a match:/);
    if (state === 'unknown') assert.match(sentence, /cannot confirm|did not complete/i);
  });
}

test('bootstrap binds arrival before loading modules and the focus target survives failure', async (t) => {
  const { document, heading } = await open(t);
  await bootReleases(document, async () => { throw new Error('module unavailable'); });
  assert.equal(document.activeElement, heading);
  assert.match(textOf(document.querySelector('#shipped-build-note')), /could not load/);
  const source = await readFile(new URL('../src/releases-bootstrap.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf('bindDeploymentArrival(root);') < source.indexOf('await load();'));
  const css = await readFile(new URL('../src/releases-proof.css', import.meta.url), 'utf8');
  assert.match(css, /#deployment-status-title:focus\s*\{[^}]*outline:3px solid var\(--focus-ring\)/);
});
