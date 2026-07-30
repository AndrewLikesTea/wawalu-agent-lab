// What the observatory's persona and prompt-trace panels say while the published
// demo file is pending, empty, or unreachable.
//
// Both panels read one file, and both used to answer a failed read with the same
// sentence — "Refresh the page to retry the static demo data" — which was two
// copies of one fact and an instruction that threw away the live activity feed
// beside them. Each panel now keeps its heading and carries one compact status
// block with its own words, and a failed read is the only state that offers a
// button, because it is the only one a second attempt could change.

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMO_DATA_PANELS,
  DEMO_DATA_STATES,
  isRecoverableDemoDataState,
  refreshDemoData,
  renderDemoDataState,
  wireDemoDataControls,
} from "../src/agents.js";
import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";

const OBSERVATORY = new URL("../src/agents.html", import.meta.url);

// Generated here rather than committed: the panels care about the shape of the
// published file, not about which run it happens to describe.
const demoPayload = (personas = 2) => ({
  personas: Array.from({ length: personas }, (unused, index) => ({
    name: `Persona ${index + 1}`,
    role: "Engineer",
    summary: `What persona ${index + 1} is responsible for.`,
    prompt: `The Qwen persona prompt for persona ${index + 1}.`,
  })),
  run: {
    personaName: "Mina",
    personaRole: "Frontend engineer",
    scenarioTitle: "Preserve page hierarchy while data is pending",
    worker: "Claude",
    qwenPlanningPrompt: "Plan the state work.",
    qwenHandoff: "Hand the plan to the worker.",
    workerPrompt: "Implement the states.",
    qwenReview: "Review the states.",
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

const settle = async () => { for (let tick = 0; tick < 3; tick += 1) await Promise.resolve(); };

async function observatory(t) {
  const page = await loadPage(OBSERVATORY, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;
  const panelOf = (key) => {
    const panel = DEMO_DATA_PANELS.find((entry) => entry.key === key);
    return {
      status: document.querySelector(panel.status),
      actions: document.querySelector(panel.actions),
      control: document.querySelector(panel.control),
      content: document.querySelector(panel.content),
      get title() { return textOf(document.querySelector(panel.status).querySelector(".activity-state-title")); },
      get detail() { return textOf(document.querySelector(panel.status).querySelector(".activity-state-detail")); },
      get chip() { return textOf(document.querySelector(panel.status).querySelector(".activity-state-chip")); },
      get shape() { return document.querySelector(panel.status).querySelector(".activity-state-icon").dataset.shape; },
    };
  };
  return { document, personas: panelOf("personas"), trace: panelOf("trace") };
}

/* --------------------------- pending, with the page intact ----------------- */

test("a pending read keeps every heading, and each panel says so where it sits", async (t) => {
  const page = await observatory(t);
  const { document } = page;

  // The page's own hierarchy is untouched while its data is pending.
  assert.equal(textOf(document.querySelector("#page-title")), "Agent observatory");
  assert.equal(textOf(document.querySelector("#persona-title")), "Personas");
  assert.equal(textOf(document.querySelector("#prompt-title")), "Published prompt trace");
  assert.ok(document.querySelector(".site-nav").querySelectorAll("a").length >= 5,
    "the navigation is still there to leave by");
  assert.ok(document.querySelector(".trace-link"), "the safe action beside the pending panel is kept");

  renderDemoDataState(document, "loading");

  for (const panel of [page.personas, page.trace]) {
    assert.equal(panel.status.dataset.state, "loading");
    assert.equal(panel.status.getAttribute("role"), "status");
    assert.equal(panel.status.getAttribute("aria-live"), "polite", "a wait that ends is announced politely");
    assert.equal(panel.status.hidden, false);
    assert.equal(panel.content.getAttribute("aria-busy"), "true");
    assert.equal(panel.chip, DEMO_DATA_STATES.loading.chip);
    assert.equal(panel.shape, "loading");
    // Nothing promises a recovery from a failure that has not happened.
    assert.equal(panel.actions.hidden, true);
    assert.equal(panel.control.dataset.recovery, "none");
  }

  // Status comes after the heading it belongs to and before the content it
  // describes, in both panels.
  const order = (container) => document.querySelector(container).childElements.map((child) => child.id);
  const team = order(".team-panel");
  assert.ok(team.indexOf("persona-status") < team.indexOf("persona-actions"),
    "the status is read before the control that acts on it");
  assert.ok(team.indexOf("persona-actions") < team.indexOf("persona-list"),
    "the control comes before the content it recovers");
  const prompt = order(".prompt-panel");
  assert.ok(prompt.indexOf("trace-status") < prompt.indexOf("trace-actions"));
  assert.ok(prompt.indexOf("trace-actions") < prompt.indexOf("prompt-trace"));
});

/* ------------------------------ empty is not broken ------------------------ */

test("a file that answered with nothing is empty, and is offered no retry", async (t) => {
  const page = await observatory(t);
  const { calls, fetcher } = reader(ok({ personas: [], run: null }));
  await refreshDemoData(page.document, fetcher);

  assert.equal(calls.length, 1);
  for (const panel of [page.personas, page.trace]) {
    assert.equal(panel.status.dataset.state, "empty");
    // A successful read never interrupts: it is read where it sits.
    assert.equal(panel.status.getAttribute("role"), "status");
    assert.equal(panel.chip, DEMO_DATA_STATES.empty.chip);
    assert.equal(panel.shape, "empty");
    assert.equal(panel.content.getAttribute("aria-busy"), "false");
    assert.equal(panel.actions.hidden, true, "nothing failed, so nothing is retried");
  }
  assert.equal(isRecoverableDemoDataState("empty"), false);
  assert.match(page.personas.detail, /nothing failed/i);
  assert.equal(page.personas.content.dataset.source, "synthetic-fallback");
  assert.equal(page.personas.content.querySelectorAll("li").length, 4,
    "the empty file still leaves a useful synthetic team summary");
  assert.equal(page.trace.content.dataset.source, "synthetic-fallback");
  assert.equal(page.trace.content.querySelectorAll(".prompt-step").length, 4,
    "the empty file still leaves a representative synthetic handoff");
});

/* ------------------------------- error, with a way out --------------------- */

test("a failed read names each panel's own loss and offers an explicit retry", async (t) => {
  const page = await observatory(t);
  const { fetcher } = reader(refused);
  await refreshDemoData(page.document, fetcher);

  for (const panel of [page.personas, page.trace]) {
    assert.equal(panel.status.dataset.state, "error");
    assert.equal(panel.status.getAttribute("role"), "alert", "a failed read is worth interrupting for");
    assert.equal(panel.chip, DEMO_DATA_STATES.error.chip);
    assert.equal(panel.shape, "error");
    assert.equal(panel.actions.hidden, false);
    assert.equal(panel.control.dataset.recovery, "retry");
    assert.equal(panel.control.type, "button");
    // The sentence explaining the state is the button's description, so a reader
    // who tabs straight onto it hears why it is being offered.
    assert.equal(panel.control.getAttribute("aria-describedby"),
      panel.status.querySelector(".activity-state-detail").id);
    assert.doesNotMatch(panel.detail, /refresh the page/i);
  }
  assert.equal(isRecoverableDemoDataState("error"), true);

  // One fact, said once per panel, in each panel's own words.
  assert.notEqual(page.personas.title, page.trace.title);
  assert.notEqual(page.personas.detail, page.trace.detail);
  assert.match(page.personas.title, /[Pp]ersona/);
  assert.match(page.trace.title, /prompt trace/);
  assert.match(page.personas.detail, /not customer or private-repository activity/i);
  assert.match(page.trace.detail, /not customer or private-repository activity/i);
  assert.equal(page.personas.content.dataset.source, "synthetic-fallback");
  assert.equal(page.personas.content.getAttribute("aria-label"), "Synthetic fallback persona summary");
  assert.equal(page.personas.content.querySelectorAll("li").length, 4);
  assert.equal(page.trace.content.dataset.source, "synthetic-fallback");
  assert.equal(page.trace.content.getAttribute("aria-label"), "Synthetic fallback representative handoff");
  assert.equal(page.trace.content.querySelectorAll(".prompt-step").length, 4);
});

test("a thrown request is the same failure as a refused one", async (t) => {
  const page = await observatory(t);
  const { fetcher } = reader("offline");
  await refreshDemoData(page.document, fetcher);
  assert.equal(page.personas.status.dataset.state, "error");
  assert.equal(page.trace.status.dataset.state, "error");
});

test("empty and error never share a sentence, and no state relies on colour", async (t) => {
  const page = await observatory(t);
  const words = new Set();
  const shapes = new Set();
  const sentences = new Set();

  for (const [state, answer] of [["loading", null], ["empty", ok({ personas: [], run: null })], ["error", refused]]) {
    if (answer === null) renderDemoDataState(page.document, "loading");
    else await refreshDemoData(page.document, reader(answer).fetcher);
    assert.equal(page.personas.status.dataset.state, state);
    words.add(page.personas.chip);
    shapes.add(page.personas.shape);
    sentences.add(page.personas.detail);
    sentences.add(page.trace.detail);
  }

  assert.equal(words.size, 3, "each state needs its own word");
  assert.equal(shapes.size, 3, "each state needs its own glyph geometry");
  assert.equal(sentences.size, 6, "each panel explains each state in its own words");
});

/* ---------------------------- retry, on the keyboard ----------------------- */

test("the retry the keyboard reaches re-reads the file and restores both panels", async (t) => {
  const page = await observatory(t);
  const { calls, fetcher } = reader(refused, ok(demoPayload(3)));
  const reload = wireDemoDataControls(page.document, fetcher);

  await reload();
  assert.equal(calls.length, 1);
  assert.equal(page.personas.status.dataset.state, "error");

  const retry = tabSequence(page.document).find((node) => node.id === "retry-personas");
  assert.ok(retry, "the retry must be in the page's tab sequence while it is offered");
  retry.focus();
  pressEnter(page.document);
  await settle();

  assert.equal(calls.length, 2, "Enter must re-run the read");
  assert.equal(page.personas.content.querySelectorAll("li").length, 3, "the personas arrived");
  assert.ok(page.trace.content.querySelectorAll(".prompt-step").length >= 4, "the trace arrived");

  // The data is its own answer, so the status block steps out of the populated
  // page rather than adding a fourth box saying "loaded".
  for (const panel of [page.personas, page.trace]) {
    assert.equal(panel.status.hidden, true);
    assert.equal(panel.status.dataset.state, "ready");
    assert.equal(panel.actions.hidden, true);
    assert.equal(panel.content.getAttribute("aria-busy"), "false");
  }
  // The control the reader was standing on is gone, so focus lands on what
  // replaced it rather than at the top of the document.
  assert.equal(page.document.activeElement, page.personas.content);
  assert.equal(tabSequence(page.document).some((node) => node.id === "retry-personas"), false,
    "a hidden retry is out of the tab sequence too");
});

test("a retry that fails again keeps its control and focus in the panel used", async (t) => {
  const page = await observatory(t);
  const { calls, fetcher } = reader(refused);
  const reload = wireDemoDataControls(page.document, fetcher);
  await reload();

  page.trace.control.focus();
  pressEnter(page.document);
  await settle();

  assert.equal(calls.length, 2);
  assert.equal(page.trace.status.dataset.state, "error");
  assert.equal(page.trace.actions.hidden, false, "a read that could still succeed keeps its retry");
  assert.equal(page.document.activeElement, page.trace.status,
    "focus lands on the local state that explains itself, never another panel");
});
