import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadPage, DomEvent, pressEnter, textOf } from './support/browser.js';
import { initReleaseDiscussion } from '../src/releases-discussion.js';
import { initSiteFooter, NOTE_GUIDANCE } from '../src/site-footer.js';
import { FOLLOW_UP_TOPICS } from '../src/leads.js';

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
    }, pushes: [], pushState(state, _, hash) {
      assert.deepEqual(state, { retained: true });
      view.history.pushes.push(hash);
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

for (const [intent, label] of [['demo', 'Request a Shiplog demonstration'], ['pilot', 'Discuss a Shiplog pilot']]) {
  for (const keyboard of [false, true]) {
    test(`${label}: ${keyboard ? 'Enter' : 'click'} selects, focuses the email and submits the existing topic`, async (t) => {
      const { document, calls, view } = await setup(t);
      const email = document.getElementById('site-footer-email');
      // The link, not the walkthrough summary's button of the same name, which
      // stands above it since #3018.
      const link = document.querySelectorAll('[data-release-discussion]').find((link) => link.tagName === 'A' && textOf(link) === label);
      assert.equal(link.getAttribute('href'), `#site-footer-intent-${intent}`);
      link.focus();
      if (keyboard) pressEnter(document); else link.click();
      const radio = document.getElementById(`site-footer-intent-${intent}`);
      // #2962: the topic is answered, so focus goes to the field still to fill.
      assert.ok(document.activeElement === email, `focus is on ${document.activeElement?.id}`);
      assert.equal(radio.checked, true);
      assert.equal(radio.hidden, false);
      assert.equal(document.querySelectorAll('input[name="intent"]').filter((item) => item.checked).length, 1);
      // The browser would focus the radio it navigates to, so the address is
      // pushed — a new entry, so Back returns — instead of navigated.
      assert.deepEqual(view.history.pushes, [`#site-footer-intent-${intent}`]);
      assert.equal(document.navigations.length, 0);
      if (intent === 'pilot') assert.equal(textOf(document.getElementById('site-footer-message-guidance')), NOTE_GUIDANCE.pilot);
      document.getElementById('site-footer-email').value = 'buyer@example.com';
      document.getElementById('site-footer-form').dispatchEvent(new DomEvent('submit'));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(calls[0].intent, intent);
      assert.equal(calls[0].purpose, 'follow_up_releases');
      // A new choice reopens the receipt through the footer's existing control.
      link.click();
      assert.equal(document.getElementById('site-footer-form').hidden, false);
      assert.ok(document.activeElement === email);
      assert.equal(view.history.pushes.length, 1, 'the same fragment twice is one history entry');
    });
  }
}

test('direct fragments and Back/Forward hash changes restore the visible topic and focus', async (t) => {
  const { document, navigate, view } = await setup(t, '#site-footer-intent-demo');
  const demo = document.getElementById('site-footer-intent-demo');
  const pilot = document.getElementById('site-footer-intent-pilot');
  const email = document.getElementById('site-footer-email');
  assert.equal(demo.checked, true);
  assert.ok(document.activeElement === email);
  navigate('#site-footer-intent-pilot');
  assert.equal(pilot.checked, true);
  assert.equal(demo.checked, false);
  navigate('#site-footer-intent-demo');
  assert.ok(document.activeElement === email);
  pilot.click();
  assert.equal(view.location.hash, '#site-footer-intent-pilot');
  navigate('#unknown');
  assert.equal(pilot.checked, true);
});

test('release surface wires navigation, explains the boundary early and retains request-only availability/pricing', async () => {
  const html = await readFile(new URL('../src/releases.html', import.meta.url), 'utf8');
  assert.match(html, /src="\/releases-discussion-page.js"/);
  // #2941: the hero no longer repeats the storage promise; the demo guide above
  // the recorder states it once (releases-demo-guide.test.js counts it).
  assert.equal(html.includes('id="releases-demo-boundary"'), false);
  assert.ok(html.includes('id="record-release-link"'));
  assert.doesNotMatch(html, /in this browser only\. This is a demo workflow/);
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

// #2962: only an exact radio id counts. Each of these leaves the form with no
// answer chosen and focus where it was, and none of them throws.
const MALFORMED_FRAGMENTS = ['', '#', '#site-footer-intent-', '#site-footer-intent-sales',
  '#site-footer-intent-DEMO', '#site-footer-intent-demo#site-footer-intent-pilot',
  '#site-footer-intent-demo&intent=pilot', '#site-footer-intent-%E0%A4%A', '#site-footer-email', undefined];
for (const hash of MALFORMED_FRAGMENTS) {
  test(`the fragment ${JSON.stringify(hash)} leaves the default topic`, async (t) => {
    const { document, navigate } = await setup(t, hash);
    const radios = document.querySelectorAll('input[name="intent"]');
    assert.equal(radios.filter((radio) => radio.checked).length, 0, 'a topic was chosen on load');
    navigate(hash);
    assert.equal(radios.filter((radio) => radio.checked).length, 0, 'a topic was chosen on hashchange');
    assert.equal(document.activeElement?.id === 'site-footer-email', false, 'focus moved');
  });
}

test('a preselected topic can be changed and the changed one is what is sent', async (t) => {
  const { document, calls } = await setup(t, '#site-footer-intent-demo');
  document.getElementById('site-footer-intent-security_data').click();
  const radios = document.querySelectorAll('input[name="intent"]');
  assert.deepEqual(radios.filter((radio) => radio.checked).map((radio) => radio.value), ['security_data']);
  assert.ok(radios.map((radio) => radio.getAttribute('value')).includes('security_data'));
  document.getElementById('site-footer-email').value = 'buyer@example.com';
  document.getElementById('site-footer-form').dispatchEvent(new DomEvent('submit'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].intent, 'security_data');
  assert.equal(calls[0].purpose, 'follow_up_releases');
  assert.equal(calls[0].topic, FOLLOW_UP_TOPICS.follow_up_releases);
  assert.equal(textOf(document.getElementById('site-footer-topic-note')),
    `This request is sent about the ${FOLLOW_UP_TOPICS.follow_up_releases}.`);
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
  assert.ok(page.document.activeElement === page.document.getElementById('site-footer-email'));
  assert.equal(textOf(page.document.getElementById('site-footer-message-guidance')), NOTE_GUIDANCE.pilot);
});
