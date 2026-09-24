import test from "node:test";
import assert from "node:assert/strict";
import { byClass, createElement, first, installDocument } from "./support/dom.js";

installDocument();
const { renderFeedStatus, feedPresence, holdStatusFocus, settleStatusFocus } = await import("../src/feed-status.js");

/**
 * A panel whose `children` holds elements and nothing else, which is what a
 * browser's HTMLCollection is. Built here rather than taken from the page
 * harness on purpose: that harness keeps whitespace text nodes in `children`, so
 * an index that has drifted by one still lands on the right side of a sibling
 * there and the drift never shows. Named blocks, so a failure reads as an order.
 */
function panelOf(...names) {
  const parent = {
    children: [],
    insertBefore(node, reference) {
      parent.children.splice(parent.children.indexOf(reference), 0, node);
      node.parentNode = parent;
    },
    append(node) {
      parent.children.push(node);
      node.parentNode = parent;
    },
  };
  for (const name of names) {
    const node = {
      name,
      parentNode: parent,
      remove() {
        parent.children = parent.children.filter((child) => child !== node);
        node.parentNode = null;
      },
    };
    parent.children.push(node);
  }
  return parent;
}

const blockNames = (parent) => parent.children.map((node) => node.name);
const blockNamed = (parent, name) => parent.children.find((node) => node.name === name);

// People's results panel (#2142): the invitation to publish an image ships under
// the grid, and the connecting line that also leaves the document while the first
// fetch is open ships above it. Restoring by remembered index alone cannot put
// the invitation back with that line still gone — the panel it counts into is one
// block shorter than the one the index was taken from — so it is anchored to the
// display-name caveat, the one block in the panel that is never removed.
test("a line that ships after another removable line is restored where it shipped", () => {
  const panel = panelOf("heading", "connection", "list", "invitation", "caveat");
  const invitation = feedPresence(blockNamed(panel, "invitation"), blockNamed(panel, "caveat"));
  const connection = feedPresence(blockNamed(panel, "connection"));

  // The open first fetch: both lines are off the page, not hidden on it.
  invitation.present(false);
  connection.present(false);
  assert.deepEqual(blockNames(panel), ["heading", "list", "caveat"]);

  // The answer arrives. The invitation comes back first, into a panel that is
  // still missing the connecting line above it, and it still lands under the
  // list and over the caveat rather than at the end of the panel.
  invitation.present(true);
  assert.deepEqual(blockNames(panel), ["heading", "list", "invitation", "caveat"]);
  connection.present(true);
  assert.deepEqual(blockNames(panel), ["heading", "connection", "list", "invitation", "caveat"]);

  // And presence stays idempotent: a second render of the same phase moves
  // nothing.
  invitation.present(true);
  connection.present(true);
  assert.deepEqual(blockNames(panel), ["heading", "connection", "list", "invitation", "caveat"]);
});

test("loading is one labelled status with no invented keyboard stop", () => {
  const container = createElement("div");
  const status = renderFeedStatus(container, {
    state: "loading", label: "Social feed loading", text: "Loading the Social feed…",
  });

  assert.equal(container.children.length, 1);
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-label"), "Social feed loading");
  assert.equal(status.textContent, "Loading the Social feed…");
  assert.equal(status.tabIndex, undefined);
  assert.equal(byClass(status, "feed-status-action").length, 0);
});

test("status actions only enter the document when they can act", () => {
  const container = createElement("div");
  renderFeedStatus(container, {
    state: "error", label: "Social feed error", text: "Posts could not be loaded.",
    actionLabel: "Retry loading Social posts",
  });
  assert.equal(byClass(container, "feed-status-action").length, 0,
    "a label without a callback must not create a dead tab stop");

  let retries = 0;
  renderFeedStatus(container, {
    state: "error", label: "Social feed error", text: "Posts could not be loaded.",
    detail: "Your filters and composer are unchanged.",
    actionLabel: "Retry loading Social posts", onAction: () => { retries += 1; },
  });
  const retry = first(container, "feed-status-action");
  assert.equal(retry.tagName, "BUTTON");
  assert.equal(retry.type, "button");
  retry.dispatch("click");
  assert.equal(retries, 1);
  assert.match(container.textContent, /filters and composer are unchanged/);
});

/* --------------------- where a retry leaves the reader --------------------- */

// #2499. Retry is drawn inside the status region that is reporting the failure,
// so pressing it destroys the button under the press. The two helpers below are
// what stops a browser from answering that by dropping focus to <body>, which
// sends the reader's next Tab to the top of the document. The four states the
// region can land in are pinned here; the two pages that use them are walked end
// to end in feed-retry-focus.test.js.
//
// Two things this stub does not model and the helpers read: `parentNode` (the
// stub links a child to its parent through `parent`) and the document's
// `activeElement`. Both are set by hand, and `focus()` here counts rather than
// moving activeElement, so a handover is read off the target's own count.
function standingOnRetry() {
  const region = createElement("div");
  region.setAttribute("id", "feed-state");
  const retry = createElement("button");
  region.append(retry);
  retry.parentNode = region;
  document.activeElement = retry;
  return { region, retry };
}

const handoverTarget = () => createElement("h2");

// The platform's half of a handover. `focus()` on this stub counts the call
// rather than moving activeElement, so the move a browser performs is made here
// — otherwise settleStatusFocus below would decline for the wrong reason (the
// reader appearing to be somewhere else) and every assertion after it would pass
// without the branch under test ever running.
const focusMoved = (node) => { document.activeElement = node; };

test("a retry moves the reader off the button it is about to destroy", () => {
  const { region } = standingOnRetry();
  assert.equal(holdStatusFocus(region), true);
  assert.equal(region.focused, 1, "the region the reader was handed never took focus");
  // Programmatically focusable, not a tab stop: no page's tab budget changes.
  assert.equal(region.getAttribute("tabindex"), "-1");
});

test("a retry fired from outside the region moves no focus at all", () => {
  const region = createElement("div");
  document.activeElement = createElement("a");
  assert.equal(holdStatusFocus(region), false);
  assert.equal(region.focused, 0);
  assert.equal(region.getAttribute("tabindex"), null, "a region nobody was standing in was made focusable");
});

test("a region that still has words for the reader keeps them", () => {
  const { region } = standingOnRetry();
  holdStatusFocus(region);
  focusMoved(region);
  renderFeedStatus(region, { state: "loading", label: "Social feed loading", text: "Loading…", quiet: true });
  const heading = handoverTarget();
  assert.equal(settleStatusFocus(region, heading), false);
  assert.equal(heading.focused, 0, "the reader was moved off the line that was reporting their retry");
});

test("a region that has gone quiet hands the reader on rather than hiding under them", () => {
  const { region } = standingOnRetry();
  holdStatusFocus(region);
  focusMoved(region);
  // The failed refresh beside content that is already on screen: the loading
  // render empties this region and hides it outright, before the re-request has
  // answered anything — and focus on a hidden node is focus lost.
  region.replaceChildren();
  region.hidden = true;
  const heading = handoverTarget();
  assert.equal(settleStatusFocus(region, heading), true);
  assert.equal(heading.focused, 1, "the reader was left standing on a hidden region");
  assert.equal(heading.getAttribute("tabindex"), "-1");
});

test("a reader who moved on during the retry is not dragged back", () => {
  const { region } = standingOnRetry();
  holdStatusFocus(region);
  focusMoved(region);
  document.activeElement = createElement("input");
  region.replaceChildren();
  region.hidden = true;
  const heading = handoverTarget();
  assert.equal(settleStatusFocus(region, heading), false);
  assert.equal(heading.focused, 0, "a retry stole focus back from wherever the reader had gone");
});
