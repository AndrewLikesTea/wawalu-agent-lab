import test from "node:test";
import assert from "node:assert/strict";
import { byClass, createElement, first, installDocument } from "./support/dom.js";

installDocument();
const { renderFeedStatus } = await import("../src/feed-status.js");

test("loading is one labelled status with no invented keyboard stop", () => {
  const container = createElement("div");
  const status = renderFeedStatus(container, {
    state: "loading", label: "Social feed loading", text: "Posts are loading. Select “Write a post” to publish.",
  });

  assert.equal(container.children.length, 1);
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-label"), "Social feed loading");
  assert.equal(status.textContent, "Posts are loading. Select “Write a post” to publish.");
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
