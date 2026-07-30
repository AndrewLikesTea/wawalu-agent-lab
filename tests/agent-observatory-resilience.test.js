import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  loadActivity,
  renderPromptTrace,
  renderRepresentativeActivity,
} from "../src/agents.js";
import { loadPublishedTrace } from "../src/agent-trace.js";
import { byClass, createElement, installDocument, tags } from "./support/dom.js";

installDocument();

function activityRoot() {
  const nodes = {
    "#activity-list": createElement("ol"),
    "#activity-status": createElement("div"),
    ".signal-card": createElement("div"),
    "#connection-label": createElement("strong"),
    "#last-updated": createElement("span"),
    "#refresh-activity": createElement("button"),
  };
  nodes["#activity-list"].querySelector = (selector) => {
    const items = byClass(nodes["#activity-list"], "activity-item");
    return selector.includes(":not")
      ? items.find((item) => !item.classes.includes("activity-item-representative")) ?? null
      : items[0] ?? null;
  };
  return { nodes, querySelector: (selector) => nodes[selector] ?? null };
}

test("representative activity is clearly labelled and contains no live links", () => {
  const list = createElement("ol");
  renderRepresentativeActivity(list);

  assert.equal(list.getAttribute("aria-label"), "Synthetic example activity");
  assert.equal(list.getAttribute("aria-busy"), "false");
  assert.equal(byClass(list, "activity-item-representative").length, 4);
  assert.equal(tags(list, "A").length, 0);
  assert.match(list.textContent, /Plan/);
  assert.match(list.textContent, /Protected checks/);
});

// Four unlabelled synthetic rows look exactly like a product with nothing in
// it. A stalled request, an unreachable service, and a live feed that carried
// no matching events are three different facts, and none of them is "empty" —
// so the fallback now leads with a banner that says which one it is.
test("the fallback names why the live feed is missing, distinctly per reason", () => {
  const seen = new Set();
  for (const reason of ["loading", "unavailable", "empty"]) {
    const list = createElement("ol");
    renderRepresentativeActivity(list, { reason });

    assert.equal(list.dataset.feed, "representative", `${reason}: the list must mark itself as not live`);
    const [note] = byClass(list, "activity-fallback");
    assert.ok(note, `${reason}: the fallback must carry a banner`);
    assert.equal(note.dataset.reason, reason);
    assert.equal(byClass(note, "activity-fallback-shape").length, 1, `${reason}: a shape, not colour alone`);
    assert.match(note.textContent, /synthetic example/i, `${reason}: the rows must be disclosed as examples`);
    assert.equal(byClass(list, "activity-item-representative").length, 4, `${reason}: the examples still render`);
    assert.equal(tags(note, "A").length, 0, `${reason}: the banner offers no live link`);

    const chip = byClass(note, "activity-fallback-chip")[0].textContent;
    assert.equal(seen.has(chip), false, `"${chip}" is used for more than one reason`);
    seen.add(chip);
  }
  // "Waiting", "unavailable", and "no matching events" must not all read as the
  // same sentence, and none of them may read as an empty product.
  assert.equal(seen.size, 3);
  for (const chip of seen) assert.doesNotMatch(chip, /^no activity yet$/i);
});

test("live events clear the fallback marking from the list itself", async () => {
  const root = activityRoot();
  await loadActivity(root, async () => ({
    ok: true,
    json: async () => [{
      type: "PushEvent",
      created_at: new Date().toISOString(),
      payload: { ref: "refs/heads/agent/frontend/x", commits: [{ message: "Ship it" }] },
    }],
  }));

  const list = root.nodes["#activity-list"];
  assert.equal(list.dataset.feed, "live");
  assert.equal(byClass(list, "activity-fallback").length, 0);
});

test("unavailable public activity retains the representative fallback and retry", async () => {
  const root = activityRoot();
  await loadActivity(root, async () => ({ ok: false, status: 503 }));

  assert.equal(byClass(root.nodes["#activity-list"], "activity-fallback")[0].dataset.reason, "unavailable");
  assert.equal(byClass(root.nodes["#activity-list"], "activity-item-representative").length, 4);
  assert.equal(root.nodes["#activity-status"].dataset.state, "error");
  assert.match(root.nodes["#activity-status"].textContent, /could not be loaded.*synthetic example/i);
  assert.equal(root.nodes["#connection-label"].textContent, "GitHub check failed");
  assert.equal(root.nodes["#refresh-activity"].textContent, "Retry public GitHub activity");
});

test("live public activity replaces the representative fallback", async () => {
  const root = activityRoot();
  const event = {
    type: "PullRequestEvent",
    created_at: new Date().toISOString(),
    payload: {
      action: "opened",
      pull_request: {
        number: 219,
        title: "Make the observatory resilient",
        html_url: "https://github.com/example/repo/pull/219",
        head: { ref: "agent/frontend/observatory" },
      },
    },
  };
  await loadActivity(root, async () => ({ ok: true, json: async () => [event] }));

  assert.equal(byClass(root.nodes["#activity-list"], "activity-item-representative").length, 0);
  assert.equal(byClass(root.nodes["#activity-list"], "activity-item").length, 2);
  assert.equal(root.nodes["#activity-list"].getAttribute("aria-label"), "Recent public GitHub events");
  assert.equal(root.nodes["#connection-label"].textContent, "Live signal");
});

test("an empty public response uses the labelled representative sequence", async () => {
  const root = activityRoot();
  await loadActivity(root, async () => ({ ok: true, json: async () => [] }));

  assert.equal(byClass(root.nodes["#activity-list"], "activity-fallback")[0].dataset.reason, "empty");
  assert.equal(byClass(root.nodes["#activity-list"], "activity-item-representative").length, 4);
  assert.equal(root.nodes["#activity-status"].dataset.state, "empty");
  assert.match(root.nodes["#activity-status"].textContent, /No recent public GitHub activity/i);
  // GitHub answered; the card says so and still names the rows below it.
  assert.equal(root.nodes["#connection-label"].textContent, "No GitHub events · synthetic example");
  assert.equal(root.nodes[".signal-card"].dataset.connected, "true");
});

test("published trace renders all steps as an end-to-end reading flow", () => {
  const trace = createElement("div");
  const data = {
    run: {
      personaName: "Mina",
      personaRole: "Frontend engineer",
      scenarioTitle: "Resilient observatory",
      worker: "Codex",
      qwenPlanningPrompt: "Plan",
      qwenHandoff: "Handoff",
      workerPrompt: "Implement",
      qwenReview: "Review",
    },
  };
  renderPromptTrace(trace, data, { full: true });

  assert.equal(trace.getAttribute("aria-busy"), "false");
  assert.equal(byClass(trace, "prompt-step").length, 4);
  assert.ok(trace.classes.includes("prompt-trace-full"));
  assert.match(trace.textContent, /1 · Qwen planning prompt.*4 · Marcus \/ Qwen review/);
});

test("trace page exposes semantic navigation, synthetic disclosure, and error boundary", async () => {
  const page = await readFile(new URL("../src/agent-trace.html", import.meta.url), "utf8");
  assert.match(page, /<article.*aria-labelledby="trace-page-title"/);
  assert.match(page, /Synthetic example\./);
  assert.match(page, /not live customer activity, a private repository transcript, or a record of hidden instructions/i);
  assert.match(page, /href="\/agents\.html#prompt-title"/);
  assert.match(page, /aria-label="Representative prompt trace steps"/);

  const trace = createElement("div");
  const root = { querySelector: () => trace };
  await loadPublishedTrace(root, async () => ({ ok: false, status: 500 }));
  assert.equal(trace.getAttribute("aria-busy"), "false");
  assert.equal(trace.dataset.source, "synthetic-fallback");
  assert.match(trace.textContent, /showing a built-in synthetic handoff/i);
  assert.match(trace.textContent, /not customer activity, private-repository activity, or hidden instructions/i);
  assert.equal(byClass(trace, "prompt-step").length, 4,
    "a failed static request leaves the complete representative handoff readable");
  assert.equal(tags(trace, "BUTTON")[0].textContent, "Retry trace");
});
