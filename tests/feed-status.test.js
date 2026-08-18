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

// Against this stub rather than the page harness on purpose: `children` here
// holds elements only, the way a real Element.children does, so a restore that
// counts places gets the shifted list a browser gives it. tests/support/browser.js
// keeps whitespace text nodes in `children`, and those silently hold the places
// of the removed elements — the misplacement below is invisible there.
test("a line that left the document comes back above the same content, not at the end", () => {
  const panel = createElement("div");
  const named = (name) => {
    const node = createElement("p");
    node.className = name;
    return node;
  };
  const connection = named("feed-connection");
  const invitation = named("feed-create");
  panel.append(
    named("profile-identity"), named("section-heading"), connection, named("profile-announcer"),
    named("profile-feed-status"), named("profile-grid"), invitation, named("profile-role"),
  );
  const order = () => panel.children.map((child) => child.className);
  const authored = order();

  const invitationLine = feedPresence(invitation);
  const connectionLine = feedPresence(connection);

  // Loading: both lines leave, which is the frame People actually renders —
  // src/profile.js takes the invitation out with the count line and the
  // connection line in the same pass.
  invitationLine.present(false);
  connectionLine.present(false);
  assert.deepEqual(order(), [
    "profile-identity", "section-heading", "profile-announcer",
    "profile-feed-status", "profile-grid", "profile-role",
  ]);

  // Loaded: restored in mount order — the waiting lines first, then the
  // connection line — and each lands exactly where it was authored. A restore
  // by remembered index puts the invitation last here, below the display-name
  // caveat that has to close the panel.
  invitationLine.present(true);
  connectionLine.present(true);
  assert.deepEqual(order(), authored);

  // And the same is true in the other order, so neither line depends on the
  // other coming back first.
  invitationLine.present(false);
  connectionLine.present(false);
  connectionLine.present(true);
  invitationLine.present(true);
  assert.deepEqual(order(), authored);
});
