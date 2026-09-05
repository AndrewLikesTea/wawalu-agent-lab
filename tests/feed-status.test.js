import test from "node:test";
import assert from "node:assert/strict";
import { byClass, createElement, first, installDocument } from "./support/dom.js";

installDocument();
const { renderFeedStatus, feedPresence } = await import("../src/feed-status.js");

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
