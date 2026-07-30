// The observatory's three waiting-room states, told apart the way a reader
// tells them apart.
//
// Loading, "the feed answered with nothing", and "the request failed" used to
// share one monospace status line and one set of four synthetic rows. A reader
// who cannot tell which one they are in cannot tell whether to wait, to look
// elsewhere, or to retry — so these tests pin what makes them distinguishable:
// a unique heading, its own sentence, a shape that is not a colour, the way out
// of each one, and the order they are read in.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ACTIVITY_STATES, loadActivity, renderActivityState, wireActivityControls } from "../src/agents.js";
import { byClass, createElement, installDocument, tags } from "./support/dom.js";
import { loadPage, parseHtml, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

installDocument();

const PAGE_URL = new URL("../src/agents.html", import.meta.url);
const DEMO_URL = new URL("../src/agent-demo-data.json", import.meta.url);

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

const PULL_REQUEST_EVENT = {
  type: "PullRequestEvent",
  created_at: new Date().toISOString(),
  payload: { action: "opened", pull_request: { number: 413, title: "Distinct observatory states",
    html_url: "https://github.com/example/repo/pull/413", head: { ref: "agent/frontend/states" } } },
};

const stateOf = (root) => root.nodes["#activity-status"];
const titleOf = (root) => byClass(stateOf(root), "activity-state-title")[0]?.textContent ?? "";

test("loading, no activity, and a failed request each get their own heading and shape", () => {
  const seen = { title: new Set(), chip: new Set(), shape: new Set(), detail: new Set() };
  for (const state of ["loading", "empty", "error"]) {
    const root = activityRoot();
    renderActivityState(root, state);
    const panel = stateOf(root);

    assert.equal(panel.dataset.state, state);
    const [icon] = byClass(panel, "activity-state-icon");
    assert.ok(icon, `${state}: the state carries an icon, not colour alone`);
    assert.equal(icon.getAttribute("aria-hidden"), "true", `${state}: the icon is decorative`);
    const [heading] = byClass(panel, "activity-state-title");
    assert.equal(heading.tagName, "H3", `${state}: the state names itself with a heading`);

    seen.title.add(heading.textContent);
    seen.chip.add(byClass(panel, "activity-state-chip")[0].textContent);
    seen.shape.add(icon.dataset.shape);
    const detail = byClass(panel, "activity-state-detail")[0].textContent;
    seen.detail.add(detail);
    assert.ok(detail.length > 40, `${state}: the state explains itself in words`);
  }
  // Three states, three of everything: no pair of them may read or draw alike.
  for (const [what, values] of Object.entries(seen)) assert.equal(values.size, 3, `two states share a ${what}`);
});

test("each state's shape is drawn distinctly in the stylesheet, not just tinted", async () => {
  const css = await readFile(new URL("../src/agents.css", import.meta.url), "utf8");
  const geometry = new Set();
  for (const shape of ["loading", "empty", "error", "live"]) {
    const rule = css.match(new RegExp(`\\.activity-state-icon\\[data-shape="${shape}"\\] \\{([^}]*)\\}`))?.[1];
    assert.ok(rule, `no stylesheet rule draws the "${shape}" shape`);
    // Strip colours: what is left has to differ, or the shapes are one shape.
    geometry.add(rule.replace(/#[0-9a-f]{3,8}|rgba?\([^)]*\)/gi, "").replace(/\s+/g, " ").trim());
  }
  assert.equal(geometry.size, 4, "two state icons differ only by colour");
  const reduced = css.split("\n").find((line) => line.startsWith("@media(prefers-reduced-motion:reduce)")
    && line.includes("activity-state-icon"));
  assert.match(reduced ?? "", /activity-state-icon\[data-shape="loading"\]\{animation:none/,
    "the loading ring keeps spinning when motion is reduced");
});

test("no recent activity says so and points at the personas and the prompt trace", () => {
  const root = activityRoot();
  renderActivityState(root, "empty");
  const panel = stateOf(root);

  assert.match(panel.textContent, /No recent public GitHub activity/i);
  assert.match(panel.textContent, /nothing failed/i);
  const links = tags(panel, "A");
  assert.deepEqual(links.map((link) => link.href), ["#persona-title", "/agent-trace.html"]);
  assert.match(links[0].textContent, /personas/i);
  assert.match(links[1].textContent, /prompt trace/i);
  assert.equal(root.nodes["#refresh-activity"].textContent, ACTIVITY_STATES.empty.action);
});

test("a failed request keeps the synthetic boundary and offers a labelled retry", async () => {
  const root = activityRoot();
  await loadActivity(root, async () => { throw new Error("offline"); });

  const panel = stateOf(root);
  assert.equal(panel.dataset.state, "error");
  assert.match(titleOf(root), /could not be loaded/i);
  assert.match(panel.textContent, /synthetic example/i, "the fallback rows stay disclosed as synthetic");
  assert.equal(tags(panel, "A").length, 0, "a failed request offers no live link");

  const retry = root.nodes["#refresh-activity"];
  assert.equal(retry.tagName, "BUTTON", "retry is a real button, so Enter and Space already work");
  assert.equal(retry.getAttribute("type") ?? retry.attributes.type ?? "button", "button");
  assert.match(retry.textContent, /^Retry/);
  assert.equal(retry.dataset.state, "error");

  // The demo boundary the error state must not erase.
  assert.equal(byClass(root.nodes["#activity-list"], "activity-item-representative").length, 4);
  assert.equal(byClass(root.nodes["#activity-list"], "activity-fallback")[0].dataset.reason, "unavailable");
});

test("retry runs the same load, and a recovered request reaches the live state", async () => {
  const root = activityRoot();
  let attempt = 0;
  const fetcher = async (url) => {
    attempt += 1;
    if (attempt <= 2) throw new Error("offline");
    // The observatory watches two repositories; only one of them has news.
    return { ok: true, json: async () => (String(url).includes("paint-lab") ? [PULL_REQUEST_EVENT] : []) };
  };

  await loadActivity(root, fetcher);
  assert.equal(stateOf(root).dataset.state, "error");

  const retry = wireActivityControls(root, fetcher) && root.nodes["#refresh-activity"];
  retry.dispatch("click");
  await waitFor(() => stateOf(root).dataset.state === "live", "the retried request reached the live state", 50);

  assert.match(titleOf(root), /Live public GitHub activity/i);
  assert.match(stateOf(root).textContent, /1 recent public GitHub event/);
  assert.equal(byClass(root.nodes["#activity-list"], "activity-item-representative").length, 0);
  assert.equal(root.nodes["#refresh-activity"].textContent, "Refresh");
});

test("a refresh over live events never claims the live rows are synthetic", async () => {
  const root = activityRoot();
  const event = {
    type: "PushEvent", created_at: new Date().toISOString(),
    payload: { ref: "refs/heads/agent/frontend/x", commits: [{ message: "Ship it" }] },
  };
  await loadActivity(root, async () => ({ ok: true, json: async () => [event] }));
  let rejectRefresh;
  const refresh = loadActivity(root, () => new Promise((resolve, reject) => { rejectRefresh = reject; }));

  assert.equal(root.nodes["#connection-label"].textContent, "Checking GitHub",
    "the top-level status must not claim a live signal while a refresh is in flight");
  assert.match(stateOf(root).textContent, /last successful update/i);

  rejectRefresh(new Error("offline"));
  await refresh;

  assert.equal(stateOf(root).dataset.state, "error");
  assert.match(stateOf(root).textContent, /from the last successful update/i);
  assert.doesNotMatch(stateOf(root).textContent, /synthetic example/i);
});

test("status is the first thing after the panel heading, before the control and the list", async () => {
  const document = parseHtml(await readFile(PAGE_URL, "utf8"));
  const panel = document.querySelector(".activity-panel");
  const order = panel.childElements.map((child) => child.id || child.className);

  assert.deepEqual(order.slice(0, 4), ["activity-heading", "activity-status", "activity-actions", "activity-list"]);
  assert.equal(panel.querySelector(".activity-heading").querySelector("h2").id, "activity-title");
  const status = document.querySelector("#activity-status");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(status.dataset.state, "loading", "the served markup is already the loading state");
  assert.match(textOf(status), /Checking public GitHub activity/);
  // The personas link target has to be reachable, and focusable when reached.
  const personas = document.querySelector("#persona-title");
  assert.equal(personas.getAttribute("tabindex"), "-1");
});

async function observatory({ events = [PULL_REQUEST_EVENT] } = {}) {
  const page = await loadPage(PAGE_URL);
  const demo = JSON.parse(await readFile(DEMO_URL, "utf8"));
  const savedInterval = globalThis.setInterval;
  const calls = { activity: 0 };
  let online = false;
  globalThis.setInterval = () => 0; // The page's 90-second poll must not outlive the test.
  globalThis.fetch = async (url) => {
    if (String(url).includes("agent-demo-data")) return { ok: true, json: async () => demo };
    calls.activity += 1;
    if (!online) throw new Error("offline");
    return { ok: true, json: async () => (String(url).includes("paint-lab") ? events : []) };
  };
  await importPageModule("/agents.js");
  return {
    document: page.document,
    calls,
    recover() { online = true; },
    restore() { globalThis.setInterval = savedInterval; page.restore(); },
  };
}

test("the shipped page reaches the error state and recovers through a keyboard retry", async () => {
  const page = await observatory();
  const { document } = page;
  try {
    const status = document.querySelector("#activity-status");
    await waitFor(() => status.dataset.state === "error", "the failed request is reported");
    assert.match(textOf(status), /could not be loaded/i);
    const failedRequests = page.calls.activity;

    const retry = document.querySelector("#refresh-activity");
    assert.ok(tabSequence(document).includes(retry), "retry is reachable by keyboard");
    for (let guard = 0; guard < 40 && document.activeElement !== retry; guard += 1) pressTab(document);
    assert.equal(document.activeElement, retry, "tabbing reaches the retry control");
    assert.match(textOf(retry), /^Retry/);

    page.recover();
    pressEnter(document);
    await waitFor(() => status.dataset.state === "live", "the keyboard retry reached the live state");

    assert.ok(page.calls.activity > failedRequests, "retry issued a new public request");
    const live = document.querySelectorAll(".activity-item")
      .filter((item) => !item.classList.contains("activity-item-representative"));
    assert.equal(live.length, 1);
    assert.match(textOf(document.querySelector("#connection-label")), /Live signal/);
  } finally {
    page.restore();
  }
});
