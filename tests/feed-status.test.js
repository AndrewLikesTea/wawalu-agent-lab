import test from "node:test";
import assert from "node:assert/strict";
import { byClass, createElement, first, installDocument } from "./support/dom.js";

installDocument();
const { renderFeedStatus, feedPresence } = await import("../src/feed-status.js");

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

/* ------------------------------ presence ------------------------------ */
// A line that is only true once a fetch has answered leaves the document while
// the fetch is open, then has to come back where the author put it. What is
// pinned here is the coming back, against a stub whose `children` holds elements
// and nothing else — the shape a browser has.

// A panel of named blocks, in the order People's results region ships them.
const panel = (...names) => {
  const host = createElement("div");
  const blocks = Object.fromEntries(names.map((name) => {
    const block = createElement("p");
    block.className = name;
    return [name, block];
  }));
  host.append(...names.map((name) => blocks[name]));
  return { host, blocks, order: () => host.children.map((child) => child.className) };
};

test("a line that leaves while a fetch is open comes back where it shipped", () => {
  const { host, blocks, order } = panel("connection", "status", "grid", "invitation", "caveat");
  const connection = feedPresence(blocks.connection);
  const invitation = feedPresence(blocks.invitation);

  // The load: both lines go, and go absent rather than hidden.
  connection.present(false);
  invitation.present(false);
  assert.deepEqual(order(), ["status", "grid", "caveat"]);

  // The answer: both come back, and the caveat still closes the panel. A slot
  // remembered as a bare index puts the invitation past the end here and appends
  // it under the caveat instead — People's invitation into Paint moved below the
  // grid in #1854, which is what made two absent lines at once possible.
  invitation.present(true);
  connection.present(true);
  assert.deepEqual(order(), ["connection", "status", "grid", "invitation", "caveat"]);

  // Idempotent in both directions: asking for the state it is already in neither
  // duplicates the node nor drops it.
  invitation.present(true);
  connection.present(true);
  assert.deepEqual(order(), ["connection", "status", "grid", "invitation", "caveat"]);
  assert.equal(host.children.length, 5, "a restore duplicated a line");
});

test("a line whose neighbours are all absent appends, and the ones after it find it again", () => {
  const { host, blocks, order } = panel("grid", "invitation", "trailer");
  const invitation = feedPresence(blocks.invitation);
  const trailer = feedPresence(blocks.trailer);

  trailer.present(false);
  invitation.present(false);
  assert.deepEqual(order(), ["grid"]);

  // Nothing that followed the invitation is on the page, so it goes last — and
  // the trailer, restored after it, still lands behind it rather than in front.
  invitation.present(true);
  assert.deepEqual(order(), ["grid", "invitation"]);
  trailer.present(true);
  assert.deepEqual(order(), ["grid", "invitation", "trailer"]);
  assert.equal(host.children.length, 3, "a restore duplicated a line");
});
