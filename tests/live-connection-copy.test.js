// The connection line on Social and on People: three states, three sentences,
// one wording for both pages (#1652).
//
// THE DEFECT. The line said "Connecting to live updates…" while the feed was
// loading, "Live · updated 14:32" once it had answered, and one of two telegraph
// fragments when it had not. None of them told a first-time visitor what the
// connection was for, "live updates" named a mechanism the product defines
// nowhere, and the connecting line ran as a SECOND in-progress message beside
// the one that already said the feed was loading — two claims about the same
// wait, on screen and in the announcement order.
//
// WHAT IS PINNED HERE. For each page and each of the three states: the sentence
// a reader actually sees, that the connecting frame carries exactly one
// connection status line, and the two negatives the rewrite exists for — the
// line never says "live updates" and never says the feed is loading. The
// sentences come from src/social.js for both pages, so a reworded state cannot
// drift between Social and People without reddening this file.
//
// HARNESS NOTES. The DOM double models no layout and reads text straight
// through a closed disclosure, so a green textOf() is not on its own proof a
// reader can see the line: each connecting test also walks the status node's
// ancestors and asserts none of them is a <details>. Counting walks `children`
// (which holds text nodes, hence the nodeType guard) because the universal and
// descendant selectors both throw here, and nothing asserts equality against an
// element node.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { FEED_LOADING_LINE, connectionStatusLine } from "../src/social.js";
import { loadingSummaryText, mountProfile, profileConnectionLine } from "../src/profile.js";

const SOCIAL_PAGE = new URL("../src/social.html", import.meta.url);
const PEOPLE_PAGE = new URL("../src/profile.html", import.meta.url);
const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";

const STATES = ["connecting", "live", "degraded"];

const POST = {
  id: "p-01",
  author: "Iris Vale",
  content: "A drawing landed.",
  body: "A drawing landed.",
  timestamp: "2026-07-01T09:00:00.000Z",
  createdAt: "2026-07-01T09:00:00.000Z",
  source: "demo",
  likes: 0,
  comments: 0,
  image: { src: "/media/iris.svg", alt: "A drawing signed Iris Vale", width: 1200, height: 900 },
};

/** Every element under `root`, in reading order. `children` also holds text. */
function elements(root) {
  const found = [];
  const visit = (node) => {
    for (const child of node.children ?? []) {
      if (child.nodeType !== 1) continue;
      found.push(child);
      visit(child);
    }
  };
  visit(root);
  return found;
}

/**
 * How many places on the page say one of the connection sentences.
 *
 * Only elements with no element children count: an ancestor's textContent
 * carries its child's sentence, so counting every element would report the
 * status node once per wrapper around it.
 */
function connectionLineCount(document, sentences) {
  return elements(document)
    .filter((node) => node.children.every((child) => child.nodeType !== 1))
    .filter((node) => sentences.includes(textOf(node)))
    .length;
}

/** Is the status inside a disclosure? The harness reads through a closed one. */
function foldedAway(node) {
  for (let walk = node; walk; walk = walk.parentNode) {
    if (walk.tagName === "DETAILS") return true;
  }
  return false;
}

/** Collect the refresh timer so a test can drive the second fetch itself. */
function captureInterval(t) {
  const saved = globalThis.setInterval;
  const handles = [];
  let callback = null;
  globalThis.setInterval = (fn, ...rest) => {
    callback = fn;
    const handle = saved(() => {}, ...rest);
    handles.push(handle);
    return handle;
  };
  t.after(() => {
    for (const handle of handles) clearInterval(handle);
    globalThis.setInterval = saved;
  });
  return () => callback?.();
}

/* ---------------------------- the sentences ---------------------------- */

test("each connection state is one plain sentence, in one wording for both pages", () => {
  assert.equal(connectionStatusLine("connecting"), "New posts will appear here on their own.");
  assert.equal(connectionStatusLine("live"), "New posts appear here without reloading the page.");
  assert.equal(connectionStatusLine("degraded"),
    "New posts will not appear here, so reload the page to see the latest.");

  // People differs in the noun and nowhere else, so a reader who walks from one
  // page to the other reads the same three facts.
  for (const state of STATES) {
    assert.equal(profileConnectionLine(state), connectionStatusLine(state, "image posts"));
    assert.equal(profileConnectionLine(state), connectionStatusLine(state).replace("New posts", "New image posts"));
  }

  for (const state of STATES) {
    for (const sentence of [connectionStatusLine(state), profileConnectionLine(state)]) {
      // The jargon this rewrite removes, and not swapped for another name for
      // the same mechanism: the sentence states an outcome, not a subsystem.
      assert.doesNotMatch(sentence, /live updates/i, `${state} still names the mechanism`);
      assert.doesNotMatch(sentence, /\b(loading|connecting|fetching|retrying|syncing|realtime|real-time|streaming)\b/i,
        `${state} describes machinery a reader cannot act on`);
      // One sentence: one full stop, at the end of it.
      assert.match(sentence, /^[^.]+\.$/, `${state} is not one sentence`);
      assert.doesNotMatch(sentence, /…/, `${state} is written as still in progress`);
    }
  }

  // The settled state is settled: no ellipsis, and it names the thing a reader
  // would otherwise do by hand.
  for (const sentence of [connectionStatusLine("live"), profileConnectionLine("live")]) {
    assert.match(sentence, /without reloading the page/);
  }
  // The failed state carries both halves — what a reader loses, and what to do.
  for (const sentence of [connectionStatusLine("degraded"), profileConnectionLine("degraded")]) {
    assert.match(sentence, /will not appear/);
    assert.match(sentence, /reload the page/);
  }
});

/* -------------------------------- Social -------------------------------- */

test("Social's connecting frame carries one connection line, and it is not a second loading message", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, { routes: {} });
  t.after(() => page.restore());
  const { document } = page;

  const status = document.querySelector("#feed-status");
  assert.equal(textOf(status), connectionStatusLine("connecting"));
  assert.equal(foldedAway(status), false, "the connection line ships inside a disclosure a reader may not have opened");

  // The page's one statement that the feed is loading is the feed's own line;
  // the connection line beside it says what the connection is for instead.
  assert.equal(textOf(document.querySelector("#feed-state")), FEED_LOADING_LINE);
  assert.doesNotMatch(textOf(status), /live updates/i);
  assert.doesNotMatch(textOf(status), /loading|connecting/i, "two lines are reporting the same wait");

  const sentences = STATES.map((state) => connectionStatusLine(state));
  assert.equal(connectionLineCount(document, sentences), 1, "the connecting frame renders more than one connection status line");
});

test("Social's settled feed states what the connection gives the reader", async (t) => {
  const tick = captureInterval(t);
  const routes = { [SEED_ROUTE]: { posts: [] }, [LIVE_ROUTE]: { posts: [POST] } };
  const page = await loadPage(SOCIAL_PAGE, { routes });
  t.after(() => page.restore());
  const { document } = page;

  await importPageModule("/social-page.js");
  await waitFor(() => document.documentElement.dataset.shiplogSocial === "ready", "the Social feed answered");

  const status = document.querySelector("#feed-status");
  assert.equal(textOf(status), "New posts appear here without reloading the page.");
  assert.equal(foldedAway(status), false);
  assert.equal(connectionLineCount(document, STATES.map((state) => connectionStatusLine(state))), 1);

  // A connection that drops after it worked is the same news as one that never
  // connected, and gets the same sentence.
  delete routes[LIVE_ROUTE];
  await tick();
  await waitFor(() => textOf(status) !== connectionStatusLine("live"), "the dropped connection was reported");
  assert.equal(textOf(status), "New posts will not appear here, so reload the page to see the latest.");
});

test("Social's failed first load names the consequence and the action", async (t) => {
  captureInterval(t);
  // No live route: the harness refuses the request, which is the failure the
  // page's own catch handles.
  const page = await loadPage(SOCIAL_PAGE, { routes: { [SEED_ROUTE]: { posts: [] } } });
  t.after(() => page.restore());
  const { document } = page;

  await importPageModule("/social-page.js");
  await waitFor(() => document.documentElement.dataset.shiplogSocial === "ready", "the failed first load settled");

  const status = document.querySelector("#feed-status");
  assert.equal(textOf(status), "New posts will not appear here, so reload the page to see the latest.");
  assert.doesNotMatch(textOf(status), /live updates/i);
  assert.equal(connectionLineCount(document, STATES.map((state) => connectionStatusLine(state))), 1);
});

/* -------------------------------- People -------------------------------- */

test("People's connecting frame says Social's sentence with People's noun", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, { routes: {} });
  t.after(() => page.restore());
  const { document } = page;

  const status = document.querySelector("#profile-status");
  assert.equal(textOf(status), "New image posts will appear here on their own.");
  assert.equal(foldedAway(status), false, "the connection line ships inside a disclosure a reader may not have opened");
  assert.equal(textOf(document.querySelector("#profile-feed-status")), loadingSummaryText("Ari"));
  assert.doesNotMatch(textOf(status), /live updates/i);
  assert.doesNotMatch(textOf(status), /loading|connecting/i, "two lines are reporting the same wait");

  const sentences = STATES.map((state) => profileConnectionLine(state));
  assert.equal(connectionLineCount(document, sentences), 1, "the connecting frame renders more than one connection status line");

  // And the module writes the same sentence the markup ships, so hydration in a
  // still-loading state does not reintroduce a second wording. Emptied first,
  // or this would pass on the markup alone.
  status.textContent = "";
  mountProfile(document, { posts: [], author: "Ari", state: "loading" });
  assert.equal(textOf(status), "New image posts will appear here on their own.");
  assert.equal(connectionLineCount(document, sentences), 1);
});

test("People states the settled and the dropped connection in the same two sentences", async (t) => {
  const tick = captureInterval(t);
  const routes = { [SEED_ROUTE]: { posts: [POST] }, [LIVE_ROUTE]: { posts: [POST] } };
  const page = await loadPage(PEOPLE_PAGE, { storage: {}, routes });
  t.after(() => page.restore());
  const { document } = page;

  await importPageModule("/profile-page.js");
  await waitFor(() => document.documentElement.dataset.shiplogProfile === "ready", "People finished its first load");

  const status = document.querySelector("#profile-status");
  assert.equal(textOf(status), "New image posts appear here without reloading the page.");
  assert.equal(foldedAway(status), false);
  assert.equal(connectionLineCount(document, STATES.map((state) => profileConnectionLine(state))), 1);

  delete routes[LIVE_ROUTE];
  await tick();
  await waitFor(() => textOf(status) !== profileConnectionLine("live"), "the dropped connection was reported");
  assert.equal(textOf(status), "New image posts will not appear here, so reload the page to see the latest.");
  assert.doesNotMatch(textOf(status), /live updates/i);
});

test("People's failed first load names the consequence and the action", async (t) => {
  captureInterval(t);
  const page = await loadPage(PEOPLE_PAGE, { storage: {}, routes: { [SEED_ROUTE]: { posts: [POST] } } });
  t.after(() => page.restore());
  const { document } = page;

  await importPageModule("/profile-page.js");
  await waitFor(() => document.documentElement.dataset.shiplogProfile === "ready", "the failed first load settled");

  const status = document.querySelector("#profile-status");
  assert.equal(textOf(status), "New image posts will not appear here, so reload the page to see the latest.");
  assert.equal(connectionLineCount(document, STATES.map((state) => profileConnectionLine(state))), 1);
});
