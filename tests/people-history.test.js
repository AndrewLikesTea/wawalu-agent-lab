import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, textOf, tabSequence } from './support/browser.js';
import { importPageModule, waitFor } from './support/page-module.js';
import { renderPosts } from '../src/social.js';
import { profileHref, requestedProfileAuthor } from '../src/social-links.js';
import { normalizeSeedPosts } from '../src/profile.js';

test('an untrimmed name is bounded by the length it renders at, not its trimmed length', () => {
  const padded = { id: 'pad', author: `${' '.repeat(500)}Ann`, body: 'Hi', createdAt: '2026-07-01' };
  assert.deepEqual(normalizeSeedPosts([padded]), []);
});

const hostile = ` <&"' 空 /?#+%= name `;
const posts = [
  { id: 'old', author: hostile, body: 'Old', createdAt: '2026-07-01', image: { src: '/media/a.svg', alt: 'Drawing' } },
  { id: 'new', author: hostile, body: 'New', createdAt: '2026-07-03', image: { src: '/media/a.svg', alt: 'Drawing' } },
  { id: 'other', author: 'Other', body: 'Other', createdAt: '2026-07-02', image: { src: '/media/a.svg', alt: 'Drawing' } },
  { id: 'text', author: hostile, body: 'Text', createdAt: '2026-07-04' },
];

async function open(search) {
  const page = await loadPage(new URL('../src/profile.html', import.meta.url), {
    location: { search },
    routes: { '/social-demo-data.json': { posts }, '/api/social-posts?limit=100': { posts: [] } },
  });
  const interval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  const entries = [search];
  let index = 0;
  let pop;
  window.addEventListener = (type, handler) => { if (type === 'popstate') pop = handler; };
  window.history = { pushState(_state, _title, href) {
    const next = new URL(href, window.location.origin).search;
    entries.splice(++index, entries.length, next);
    window.location.search = next;
  } };
  await importPageModule('/profile-page.js');
  await waitFor(() => page.document.documentElement.dataset.shiplogProfile === 'ready');
  return { ...page, entries,
    navigate(delta) { index += delta; window.location.search = entries[index]; pop(); },
    search: () => window.location.search,
    restore() { globalThis.setInterval = interval; page.restore(); },
  };
}
const ids = (page) => page.document.querySelectorAll('.profile-tile').map(node => node.dataset.postId);
const choose = (page, name) => page.document.querySelector('#profile-author').children
  .find(node => node.dataset?.author === name).click();

test('People restores literal URL names, updates history in place, and handles back, forward and reload', async () => {
  const search = new URL(profileHref(hostile), 'https://example.test').search;
  const page = await open(search);
  let reload;
  try {
    assert.equal(requestedProfileAuthor(search), hostile);
    assert.deepEqual(ids(page), ['new', 'old']);
    assert.ok(page.document.querySelector('#profile-name').textContent.includes(hostile));
    assert.equal(page.document.querySelector('#profile-name').children.filter(node => node.nodeType === 1).length, 0);
    choose(page, 'Other');
    assert.deepEqual(ids(page), ['other']);
    assert.equal(requestedProfileAuthor(page.search()), 'Other');
    assert.equal(page.entries.length, 2);
    page.navigate(-1);
    assert.deepEqual(ids(page), ['new', 'old']);
    page.navigate(1);
    assert.deepEqual(ids(page), ['other']);
    reload = page.search();
  } finally { page.restore(); }
  const reopened = await open(reload);
  try { assert.deepEqual(ids(reopened), ['other']); } finally { reopened.restore(); }
});

test('an unknown literal name has a keyboard accessible clear control and a reloadable all-names view', async () => {
  const name = ` missing ${hostile} `;
  const page = await open(new URL(profileHref(name), 'https://example.test').search);
  let reload;
  try {
    assert.deepEqual(ids(page), []);
    assert.ok(page.document.querySelector('#profile-name').textContent.includes(`${name} has no image posts`));
    const clear = page.document.querySelector('#profile-feed-status').querySelectorAll('button')
      .find(node => textOf(node) === 'Clear selection and show all display names');
    assert.ok(tabSequence(page.document).includes(clear));
    assert.equal(clear.className, 'text-button');
    clear.click();
    assert.deepEqual(ids(page), ['new', 'other', 'old']);
    assert.equal(page.document.activeElement.id, 'grid-title');
    reload = page.search();
    assert.equal(reload, '?author=');
    page.navigate(-1);
    assert.deepEqual(ids(page), []);
  } finally { page.restore(); }
  const reopened = await open(reload);
  try { assert.deepEqual(ids(reopened), ['new', 'other', 'old']); } finally { reopened.restore(); }
});

test('shared posts offer the same literal People link only with an image, alongside unchanged Social exits', async () => {
  for (const post of [posts[0], posts[3]]) {
    const page = await loadPage(new URL('../src/post.html', import.meta.url), {
      location: { search: `?id=${post.id}` },
      routes: { '/social-demo-data.json': { posts } },
    });
    try {
      await importPageModule('/post-page.js');
      await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === 'ready');
      const link = page.document.querySelector('#post-people');
      assert.equal(link.hidden, !post.image);
      if (post.image) {
        assert.equal(link.getAttribute('href'), profileHref(hostile));
        assert.equal(link.textContent, `See ${hostile}’s image posts on People`);
        assert.equal(link.children.filter(node => node.nodeType === 1).length, 0);
        assert.ok(tabSequence(page.document).includes(link));
        assert.equal(link.className, 'detail-back detail-page-back');
      } else {
        assert.equal(tabSequence(page.document).includes(link), false);
        assert.equal(textOf(page.document.querySelector('.detail-body')), 'Text');
      }
      assert.equal(page.document.querySelector('#post-back').getAttribute('href'), '/social.html');
      assert.equal(page.document.querySelector('#post-publish').getAttribute('href'), '/social.html#post-form');
      assert.equal(link.parentNode, page.document.querySelector('#post-back').parentNode);
    } finally { page.restore(); }
  }
});


test('Social renders a safe contextual link after image content and before Report post', async () => {
  const page = await loadPage(new URL('../src/social.html', import.meta.url));
  try {
    const container = page.document.createElement('div');
    renderPosts(container, posts, { onReport() {} });
    const cards = container.querySelectorAll('.post-card');
    for (const card of cards) {
      const post = posts.find(item => item.id === card.dataset.postId);
      const link = card.querySelector('.post-people');
      if (!post.image) {
        assert.equal(Boolean(link), false);
        assert.equal(textOf(card.querySelector('.post-body')), 'Text');
        continue;
      }
      assert.equal(link.getAttribute('href'), profileHref(post.author));
      assert.equal(link.textContent, `See ${post.author}’s image posts on People`);
      assert.equal(link.children.filter(node => node.nodeType === 1).length, 0);
      const order = [];
      const walk = node => { order.push(node); for (const child of node.children) walk(child); };
      walk(card);
      assert.ok(order.indexOf(card.querySelector('.post-caption')) < order.indexOf(link));
      assert.ok(order.indexOf(card.querySelector('img')) < order.indexOf(link));
      assert.ok(order.indexOf(link) < order.indexOf(card.querySelector('.post-report-button')));
    }
  } finally { page.restore(); }
});
