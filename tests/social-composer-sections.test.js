import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, textOf, tabSequence } from './support/browser.js';
import { mountSocialFeed } from '../src/social.js';

test('composer sections preserve visible warnings, associations and reading order', async t => {
  const page = await loadPage(new URL('../src/social.html', import.meta.url), {});
  t.after(() => page.restore());
  mountSocialFeed(page.document, { posts: [], state: 'ready', storage: page.storage });
  const id = name => page.document.querySelector(`#${name}`);
  id('post-compose-open').click();
  const form = id('post-form');
  const sections = form.querySelectorAll('section');
  assert.deepEqual(sections.map(section => textOf(id(section.getAttribute('aria-labelledby')))),
    ['Post content', 'Publisher identity', 'Publishing consequences', 'Removal and reporting guidance']);
  for (const section of sections) {
    assert.equal(id(section.getAttribute('aria-labelledby')).tagName, 'H3');
    assert.equal(section.getAttribute('tabindex'), null);
    assert.equal(section.hidden, false);
  }
  const order = [];
  const visit = node => { for (const child of node.children) { order.push(child); visit(child); } };
  visit(form);
  const submitIndex = order.indexOf(id('post-submit'));
  const warnings = [
    ['post-author-hint', /Display names are not verified/],
    ['post-storage-scope', /Anyone can read a published post/],
    ['post-consequence', /cannot be edited or deleted/],
    ['post-consequence', /Do not include customer or production data/],
  ];
  for (const [name, text] of warnings) {
    const node = id(name);
    assert.match(textOf(node), text);
    assert.ok(order.indexOf(node) < submitIndex);
    for (let ancestor = node; ancestor && ancestor !== form; ancestor = ancestor.parentElement) {
      assert.equal(ancestor.hidden, false);
      assert.notEqual(ancestor.tagName, 'DETAILS', 'essential warnings must not be collapsed');
    }
  }
  assert.ok(order.indexOf(id('post-author-hint')) < order.indexOf(id('post-storage-scope')));
  assert.ok(order.indexOf(id('post-storage-scope')) < order.indexOf(id('post-consequence')));
  for (const name of ['post-body', 'post-image', 'post-image-alt', 'post-author']) {
    assert.ok(form.querySelectorAll('label').some(label => label.getAttribute('for') === name));
    for (const description of id(name).getAttribute('aria-describedby').split(/\s+/)) {
      assert.ok(id(description), `${name} has a missing description: ${description}`);
    }
  }
  assert.equal(id('post-body').hasAttribute('required'), true);
  assert.ok(id('post-submit').getAttribute('aria-describedby').split(' ').includes('post-consequence'));
  const stops = tabSequence(page.document).filter(node => order.includes(node));
  assert.ok(stops.indexOf(id('post-body')) < stops.indexOf(id('post-author')));
  assert.ok(stops.indexOf(id('post-author')) < stops.indexOf(id('post-submit')));
  assert.equal(form.querySelectorAll('details').length, 0, 'all policy remains visible without disclosure controls');
});
