// What a forwarded link to the observatory is worth in its first four seconds,
// and on a network where neither the published demo file nor GitHub will ever
// answer.
//
// The other observatory files pin each region's own behaviour. This one pins the
// page as a visitor meets it: that the sentence saying what this page shows is
// in the served markup rather than painted by a request that may never land,
// that all three data regions settle onto a named state instead of parking on
// "Loading…", that the two feeds a reader can count the merged pull requests in
// themselves are reachable when GitHub has not answered, and that the retry each
// missing state offers replaces that state with content in place.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EVENTS_URLS,
  RECORDED_COUNT_URL,
  loadActivity,
  refreshDemoData,
  wireActivityControls,
  wireDemoDataControls,
} from "../src/agents.js";
import { loadPage, parseHtml, pressEnter, tabSequence, textOf } from "./support/browser.js";

const OBSERVATORY = new URL("../src/agents.html", import.meta.url);

// The regions a request can replace. Nothing a visitor needs in order to know
// what this page is may live inside one of them.
const REPLACEABLE = [
  "persona-status", "persona-list", "activity-status", "activity-list",
  "trace-status", "prompt-trace", "merged-figure-readout",
];

const REGIONS = [
  { name: "Personas", panel: ".team-panel", status: "#persona-status", content: "#persona-list" },
  { name: "Recent activity", panel: ".activity-panel", status: "#activity-status", content: "#activity-list" },
  { name: "Published prompt trace", panel: ".prompt-panel", status: "#trace-status", content: "#prompt-trace" },
];

// Descendant selectors are not available here, so containment is read upward
// from the node itself.
function ancestorIds(node) {
  const ids = [];
  for (let walk = node?.parentNode; walk; walk = walk.parentNode) if (walk.id) ids.push(walk.id);
  return ids;
}

const settle = async () => { for (let tick = 0; tick < 4; tick += 1) await Promise.resolve(); };

// Generated here rather than committed: what matters is the shape of the file,
// not which run it happens to describe.
const demoPayload = (personas = 3) => ({
  personas: Array.from({ length: personas }, (unused, index) => ({
    name: `Persona ${index + 1}`,
    role: "Engineer",
    summary: `What persona ${index + 1} is responsible for.`,
    prompt: `The Qwen persona prompt for persona ${index + 1}.`,
  })),
  run: {
    personaName: "Mina",
    personaRole: "Frontend engineer",
    scenarioTitle: "Arrive on a page that already says what it is",
    worker: "Claude",
    qwenPlanningPrompt: "Plan the arrival states.",
    qwenHandoff: "Hand the plan to the worker.",
    workerPrompt: "Implement the arrival states.",
    qwenReview: "Review the arrival states.",
  },
});

const ok = (payload) => ({ ok: true, json: async () => payload });
const refused = { ok: false, status: 503, json: async () => ({}) };

// One answer per read, the last one repeating: `calls` is the proof a retry
// re-ran the request rather than redrawing the previous answer.
function reader(...answers) {
  const calls = [];
  return {
    calls,
    fetcher: async (url) => {
      calls.push(url);
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
      if (answer === "offline") throw new Error("network unreachable");
      return answer;
    },
  };
}

// The public feed, with the same-origin record refused: this test is about what
// GitHub itself does or does not say.
function githubReader(...responses) {
  const calls = [];
  return {
    calls,
    fetcher: async (url) => {
      if (url === RECORDED_COUNT_URL) return { ok: false, status: 404 };
      calls.push(url);
      const answer = responses[Math.min(calls.length - 1, responses.length - 1)];
      if (answer === "offline") throw new Error("network unreachable");
      return { ok: true, json: async () => answer };
    },
  };
}

const pushEvent = (message) => ({
  type: "PushEvent",
  created_at: new Date().toISOString(),
  payload: { ref: "refs/heads/agent/fullstack/observatory", commits: [{ message }] },
});

/* ------------------------- before anything has answered -------------------- */

test("the served markup already says what the observatory shows, outside every region a request can replace", async () => {
  const document = parseHtml(await readFile(OBSERVATORY, "utf8"));

  // The standing description: in the block that carries the page heading, the
  // paragraph that is not the eyebrow label.
  const hero = document.querySelector(".observatory-hero");
  const lead = hero.childElements.find((child) => child.querySelectorAll("#page-title").length === 1);
  assert.ok(lead, "the hero still leads with the page heading");
  const standing = lead.querySelectorAll("p").filter((node) => !node.classList.contains("eyebrow"));
  assert.equal(standing.length, 1, "one standing sentence, not a set of competing ones");
  const description = textOf(standing[0]);
  assert.ok(description.length > 60, "a sentence about the page, not a label");
  assert.match(description, /synthetic engineering team/i);
  assert.match(description, /public GitHub activity/i);
  assert.match(description, /prompt/i);

  // The demo boundary, which says what the page does not touch.
  const boundary = document.querySelector(".privacy-note");
  assert.equal(boundary.tagName, "P");
  assert.match(textOf(boundary), /does not access customer data/i);

  for (const [what, node] of [["the standing description", standing[0]], ["the demo boundary", boundary]]) {
    const inside = ancestorIds(node).filter((id) => REPLACEABLE.includes(id));
    assert.deepEqual(inside, [], `${what} must not sit inside a region a load or error state replaces`);
    assert.ok(!node.hidden, `${what} is shown, not held back for a request`);
  }

  // Present in the raw HTML, so a blocked module or a dead network still leaves
  // both sentences on screen.
  const served = await readFile(OBSERVATORY, "utf8");
  assert.ok(served.includes(standing[0].textContent.trim()), "the standing sentence is served, not scripted");
  assert.ok(served.includes("Demo boundary"), "the demo boundary is served, not scripted");
});

/* ---------------- a network where nothing will ever answer ----------------- */

test("with the published file and GitHub both blocked, all three regions settle onto a named state", async (t) => {
  const page = await loadPage(OBSERVATORY, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;

  // loadPage's fetch throws for every route a test did not declare, which is
  // exactly the network this page has to survive.
  await refreshDemoData(document);
  await loadActivity(document);
  await settle();

  for (const region of REGIONS) {
    const status = document.querySelector(region.status);
    const content = document.querySelector(region.content);
    assert.equal(status.dataset.state, "error", `${region.name}: settled onto a named state`);
    assert.equal(status.hidden, false, `${region.name}: the named state is on screen`);
    assert.equal(status.querySelectorAll(".activity-state-title").length, 1,
      `${region.name}: the state names itself`);
    assert.ok(textOf(status.querySelector(".activity-state-detail")).length > 40,
      `${region.name}: a full sentence, not a code`);
    assert.equal(content.getAttribute("aria-busy"), "false", `${region.name}: nothing is still busy`);
    assert.doesNotMatch(textOf(document.querySelector(region.panel)), /Loading/,
      `${region.name}: a settled page never still reads "Loading"`);
  }

  // The causes are told apart honestly. The published file failing is a fact
  // about a file served with this page; it is not a fact about GitHub.
  const personas = textOf(document.querySelector("#persona-status"));
  const trace = textOf(document.querySelector("#trace-status"));
  const activity = textOf(document.querySelector("#activity-status"));
  for (const [name, text] of [["Personas", personas], ["Published prompt trace", trace]]) {
    assert.match(text, /published demo file is unavailable/i, `${name}: it names the file that did not load`);
    assert.doesNotMatch(text, /GitHub/i, `${name}: this panel never asked GitHub for anything`);
  }
  assert.match(activity, /request for public GitHub activity failed/i);
  assert.doesNotMatch(activity, /GitHub answered/i, "a request that failed must not be told as an answer");
  assert.notEqual(personas, trace, "one fact, said once per panel, in each panel's own words");

  // The hero card settles too, rather than holding the arrival spinner.
  assert.equal(textOf(document.querySelector("#connection-label")), "GitHub check failed");
  assert.equal(textOf(document.querySelector("#last-updated")), "Not updated");

  // And the standing text is still the page's answer to "what is this".
  assert.match(textOf(document.querySelector(".privacy-note")), /does not access customer data/i);
});

test("the two feeds a reader can count the merges in are usable when GitHub has not answered", async (t) => {
  const page = await loadPage(OBSERVATORY, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;
  const figure = document.querySelector("#merged-figure");

  await loadActivity(document, githubReader("offline").fetcher);
  await settle();

  // The links live beside the readout, not inside it, so the state the failed
  // request paints cannot take them away.
  const links = figure.querySelector(".merged-figure-sources").querySelectorAll("a");
  assert.deepEqual(links.map((link) => link.href), EVENTS_URLS);
  for (const link of links) {
    assert.deepEqual(ancestorIds(link).filter((id) => REPLACEABLE.includes(id)), [],
      `${textOf(link)} must not sit inside anything a response replaces`);
  }

  const sequence = tabSequence(document);
  for (const link of links) {
    assert.ok(sequence.includes(link), `${textOf(link)} stays keyboard-reachable after a failed request`);
    assert.match(textOf(link), /public GitHub event feed$/, "the link text says where it goes");
  }
});

/* ------------------- retry, from the named state, in place ----------------- */

test("retrying the published file replaces the named state with content, with no reload", async (t) => {
  const page = await loadPage(OBSERVATORY, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;
  const { calls, fetcher } = reader(refused, ok(demoPayload(3)));
  const read = wireDemoDataControls(document, fetcher);

  await read();
  assert.equal(calls.length, 1);

  // Both retries are present and operable from the missing state.
  for (const id of ["#persona-actions", "#trace-actions"]) {
    assert.equal(document.querySelector(id).hidden, false, `${id} stays offered while the read can still succeed`);
  }
  const retry = tabSequence(document).find((node) => node.id === "retry-trace");
  assert.ok(retry, "Retry the prompt trace is in the tab sequence while it is offered");
  assert.equal(textOf(retry), "Retry the prompt trace");

  retry.focus();
  pressEnter(document);
  await settle();

  assert.equal(calls.length, 2, "Enter re-ran the read rather than redrawing the last answer");
  assert.equal(document.querySelector("#persona-list").querySelectorAll("li").length, 3);
  assert.equal(document.querySelector("#prompt-trace").querySelectorAll(".prompt-step").length, 4);
  assert.equal(document.navigations.length, 0, "the content arrives in place, without a page load");

  // Replaced, not appended beside: the sentence for a failure that has been
  // recovered is gone from the live region rather than parked behind `hidden`.
  for (const region of ["#persona-status", "#trace-status"]) {
    const status = document.querySelector(region);
    assert.equal(status.dataset.state, "ready", region);
    assert.equal(status.hidden, true, region);
    assert.equal(status.querySelectorAll(".activity-state-title").length, 0, `${region}: the named state is cleared`);
    assert.equal(textOf(status), "", `${region}: no stale failure text survives the recovery`);
    assert.equal(status.getAttribute("role"), "status", `${region}: nothing is left interrupting`);
  }
});

test("retrying public GitHub activity replaces the failed state with live events", async (t) => {
  const page = await loadPage(OBSERVATORY, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;
  const { calls, fetcher } = githubReader("offline", [pushEvent("Ship the arrival states")]);
  wireActivityControls(document, fetcher);

  await loadActivity(document, fetcher);
  await settle();
  const control = document.querySelector("#refresh-activity");
  assert.equal(document.querySelector("#activity-status").dataset.state, "error");
  assert.equal(textOf(control), "Retry public GitHub activity");
  assert.equal(control.dataset.recovery, "retry");
  assert.ok(tabSequence(document).includes(control), "the retry is reachable from the failed state");

  const failed = calls.length;
  control.focus();
  pressEnter(document);
  await settle();

  assert.ok(calls.length > failed, "the control asked GitHub again");
  const list = document.querySelector("#activity-list");
  assert.equal(list.dataset.feed, "live");
  assert.equal(list.querySelectorAll(".activity-fallback").length, 0, "the synthetic example is replaced, not joined");
  assert.equal(document.querySelector("#activity-status").dataset.state, "live");
  assert.equal(textOf(document.querySelector("#connection-label")), "Live signal");
  assert.doesNotMatch(textOf(document.querySelector(".activity-panel")), /Loading/);
  assert.equal(document.navigations.length, 0, "the events arrive in place, without a page load");
});
