import assert from "node:assert/strict";
import test from "node:test";
import { createElement, first, installDocument, tags } from "./support/dom.js";

installDocument();
const { renderState } = await import("../src/state-ui.js");

test("loading state announces text and hides its high-contrast spinner", () => {
  const container = createElement("div");
  const panel = renderState(container, { state: "loading", title: "Loading recent activity…" });

  assert.equal(panel.getAttribute("role"), "status");
  assert.equal(first(panel, "state-spinner").getAttribute("aria-hidden"), "true");
  assert.equal(first(panel, "state-title").textContent, "Loading recent activity…");
});

test("empty state gives a named value, guidance, and action", () => {
  const container = createElement("div");
  const panel = renderState(container, {
    state: "empty",
    label: "Feed status",
    value: "No posts yet.",
    description: "Share the first update to start the feed.",
    action: { label: "Write an update", href: "#post-body" },
  });

  assert.match(panel.textContent, /Feed status:.*No posts yet.*Share the first update.*Write an update/);
  assert.equal(tags(panel, "A")[0].href, "#post-body");
});

test("error state exposes labels and values without relying on color", () => {
  const container = createElement("ol");
  let retries = 0;
  const panel = renderState(container, {
    state: "error",
    item: true,
    label: "Activity error",
    value: "Repository activity unavailable.",
    description: "Retry the public request.",
    action: { label: "Retry activity", onClick: () => { retries += 1; } },
  });

  assert.equal(panel.tagName, "LI");
  assert.equal(first(panel, "state-label").textContent, "Activity error:");
  assert.equal(first(panel, "state-value").textContent, "Repository activity unavailable.");
  tags(panel, "BUTTON")[0].dispatch("click");
  assert.equal(retries, 1);
});
