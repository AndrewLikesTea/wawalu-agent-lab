import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadPage, DomEvent, pressEnter, textOf } from './support/browser.js';
import { initReleaseDiscussion } from '../src/releases-discussion.js';
import { initSiteFooter, NOTE_GUIDANCE } from '../src/site-footer.js';

async function setup(t, hash = '') {
  const page = await loadPage(new URL('../src/releases.html', import.meta.url));
  t.after(() => page.restore());
  const listeners = {};
  const view = {
    Event: DomEvent,
    location: { hash },
    history: { state: { retained: true }, replaceState(state, _, hash) {
      assert.deepEqual(state, { retained: true });
      view.location.hash = hash;
    } },
    addEventListener(name, fn) { listeners[name] = fn; },
  };
  const calls = [];
  initSiteFooter(page.document, async (_, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ captured: true, created: true, intent: calls.at(-1).intent }), { status: 201 });
  });
  initReleaseDiscussion(page.document, view);
  return { ...page, view, calls, navigate(hash) { view.location.hash = hash; listeners.hashchange(); } };
}

for (const [intent, label] of [['demo', 'Request a demonstration'], ['pilot', 'Discuss a pilot']]) {
  for (const keyboard of [false, true]) {
    test(`${label}: ${keyboard ? 'Enter' : 'click'} selects, focuses and submits the existing topic`, async (t) => {
      const { document, calls, view } = await setup(t);
      const link = document.querySelectorAll('[data-release-discussion]').find((link) => textOf(link) === label);
      assert.equal(link.getAttribute('href'), `#site-footer-intent-${intent}`);
      link.focus();
      if (keyboard) pressEnter(document); else link.click();
      const radio = document.getElementById(`site-footer-intent-${intent}`);
      assert.equal(document.activeElement, radio);
      assert.equal(radio.checked, true);
      assert.equal(radio.hidden, false);
      assert.equal(document.querySelectorAll('input[name="intent"]').filter((item) => item.checked).length, 1);
      assert.equal(view.location.hash, '', 'selection must not replace the previous history entry before native navigation');
      if (intent === 'pilot') assert.equal(textOf(document.getElementById('site-footer-message-guidance')), NOTE_GUIDANCE.pilot);
      document.getElementById('site-footer-email').value = 'buyer@example.com';
      document.getElementById('site-footer-form').dispatchEvent(new DomEvent('submit'));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(calls[0].intent, intent);
      assert.equal(calls[0].purpose, 'follow_up_releases');
      // A new choice reopens the receipt through the footer's existing control.
      link.click();
      assert.equal(document.getElementById('site-footer-form').hidden, false);
      assert.equal(document.activeElement, radio);
    });
  }
}

test('direct fragments and Back/Forward hash changes restore the visible topic and focus', async (t) => {
  const { document, navigate, view } = await setup(t, '#site-footer-intent-demo');
  const demo = document.getElementById('site-footer-intent-demo');
  const pilot = document.getElementById('site-footer-intent-pilot');
  assert.equal(demo.checked, true);
  assert.equal(document.activeElement, demo);
  navigate('#site-footer-intent-pilot');
  assert.equal(pilot.checked, true);
  assert.equal(demo.checked, false);
  navigate('#site-footer-intent-demo');
  assert.equal(document.activeElement, demo);
  pilot.click();
  assert.equal(view.location.hash, '#site-footer-intent-pilot');
  navigate('#unknown');
  assert.equal(pilot.checked, true);
});

test('release surface wires navigation, explains the boundary early and retains request-only availability/pricing', async () => {
  const html = await readFile(new URL('../src/releases.html', import.meta.url), 'utf8');
  assert.match(html, /src="\/releases-discussion-page.js"/);
  assert.ok(html.indexOf('id="releases-demo-boundary"') < html.indexOf('id="record-release-link"'));
  assert.match(html, /Records you add stay in this browser only\. This is a demo workflow, not a customer result\./);
  assert.match(html, /Whether Shiplog is available for your team and what it would cost are both answered on request\./);
  assert.ok(html.indexOf('id="release-discussion-actions"') > html.indexOf('id="real-deployment"'));
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.hero-actions\s*\{[^}]*flex-wrap:wrap/);
});

test('modified clicks keep native new-tab behavior and do not change the current form', async (t) => {
  const { document } = await setup(t);
  const link = document.querySelector('[data-release-discussion]');
  const event = new DomEvent('click', { bubbles: true });
  event.ctrlKey = true;
  link.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  assert.equal(document.querySelectorAll('input[name="intent"]').some((radio) => radio.checked), false);
});

test('the shipped entry wires the footer and a direct-linked topic independently of release loading', async (t) => {
  const page = await loadPage(new URL('../src/releases.html', import.meta.url), {
    location: { hash: '#site-footer-intent-pilot' },
  });
  t.after(() => page.restore());
  window.Event = DomEvent;
  const { importPageModule } = await import('./support/page-module.js');
  await importPageModule('/releases-discussion-page.js');
  const radio = page.document.getElementById('site-footer-intent-pilot');
  assert.equal(radio.checked, true);
  assert.equal(page.document.activeElement, radio);
  assert.equal(textOf(page.document.getElementById('site-footer-message-guidance')), NOTE_GUIDANCE.pilot);
});
