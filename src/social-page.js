// Page wiring for the social feed. This is the only layer that knows where data
// comes from, keeping social.js reusable and unit-testable. It composes:
//   1. posts created in this browser (localStorage), plus
//   2. a small static seed from social-demo-data.json so the feed renders
//      meaningfully in review before anyone has posted.
// Browser posts take precedence and are merged ahead of the demo seed; the seed
// is deduped by id so a saved post never appears twice.
//
// Demo only (PRODUCT.md): the seed is static, hand-authored sample content and
// no customer or production data is read here.

import { loadPosts, mountSocialFeed } from "/social.js";

async function fetchDemoPosts() {
  try {
    const response = await fetch("/social-demo-data.json", { cache: "no-store" });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.posts) ? data.posts : [];
  } catch {
    return [];
  }
}

function dedupeById(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

async function init() {
  const root = document;
  if (!root.querySelector("#post-feed")) return;

  const demo = await fetchDemoPosts();
  const posts = dedupeById([...loadPosts(localStorage), ...demo]);

  mountSocialFeed(root, { posts, storage: localStorage });
  document.documentElement.dataset.shiplogSocial = "ready";
}

init();
