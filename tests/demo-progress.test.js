// How far this browser got through the decision-to-release demo (#2500),
// driven the way a visitor drives it: the shipped markup from src/index.html,
// booted through initDecisionLog, read back as text a person can perceive.
//
// Nothing here reads module state. Every expectation is a status word on the
// page, an attribute a screen reader acts on, the address a link carries, or
// what Tab reaches. The 390px behaviour is asserted against the stylesheet
// rule, because the harness models no layout and a faked viewport would be
// asserting only itself.
//
// Determinism: no network, no clock, no sleeps. Each test parses its own page
// with its own storage, so order never matters.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STORAGE_KEY, initDecisionLog } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import {
  DEMO_PROGRESS_STATUS,
  DEMO_PROGRESS_STEPS,
  demoProgress,
} from "../src/demo-progress.js";
import { DomEvent, loadPage, pressEnter, pressTab, tabSequence, textOf, typeText } from "./support/browser.js";

const HOME = new URL("../src/index.html", import.meta.url);
const CSS = new URL("../src/landing-decision.css", import.meta.url);
// The seeded examples are a read-through layer nobody recorded, so a page that
// wants to show what THIS browser holds is handed an empty seed.
const NO_DEMO_DATA = { decisions: [], releases: [] };

const ENTRY = {
  title: "Adopt a durable job queue",
  context: "Background work was lost on deploys; move to an at-least-once queue.",
  alternatives: "Database polling and in-process retries.",
  owner: "Tess",
  status: "accepted",
};

const DECISION = {
  id: "d-queue",
  title: "Adopt a durable job queue",
  context: "Background work was lost on deploys.",
  alternatives: "Database polling.",
  owner: "Tess",
  status: "accepted",
  createdAt: "2026-05-02T09:00:00.000Z",
};

const RELEASE = {
  id: "r-1-3-0",
  version: "v1.3.0",
  title: "Throughput and latency",
  description: "The queue work, shipped.",
  owner: "Tess",
  status: "completed",
  releasedOn: "2026-05-20",
  createdAt: "2026-05-20T09:00:00.000Z",
  decisionIds: [DECISION.id],
};

async function openHome(t, { decisions = [], releases = [] } = {}) {
  const page = await loadPage(HOME, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(decisions),
      [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
    },
  });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage, {
    seed: NO_DEMO_DATA,
    location: { pathname: "/", search: "", hash: "" },
    history: { replaceState() {} },
  });
  assert.equal(page.document.documentElement.dataset.shiplog, "ready", "the page never rendered");
  return page;
}

const byId = (page, id) => {
  const node = page.document.querySelector(`#${id}`);
  assert.ok(node, `the home page has no #${id}`);
  return node;
};
const items = (page) => byId(page, "evaluation-path-steps").querySelectorAll("li");
const statuses = (page) => items(page).map((item) => textOf(item.querySelector(".evaluation-path-status")));
const currentSteps = (page) => items(page)
  .filter((item) => item.getAttribute("aria-current") === "step")
  .map((item) => textOf(item.querySelector(".evaluation-path-step")));
// Counted, never compared against null: asserting equality on a harness element
// walks the whole parsed page and takes minutes to say what a count says now.
const actionCount = (page) => byId(page, "evaluation-path-next").querySelectorAll("a").length;
const action = (page) => byId(page, "evaluation-path-action");
const announced = (page) => textOf(byId(page, "evaluation-path-announce"));

function fill(page, values) {
  for (const [field, value] of Object.entries(values)) {
    const control = byId(page, field);
    if (control.tagName === "SELECT") {
      control.value = value;
      control.dispatchEvent(new DomEvent("change", { bubbles: true }));
      continue;
    }
    control.focus();
    control.value = "";
    typeText(page.document, value);
  }
}

test("a browser with no records is on step one, and the other three say so", async (t) => {
  const page = await openHome(t);

  assert.deepEqual(statuses(page), [
    `Step 1 of 4 · ${DEMO_PROGRESS_STATUS.current}`,
    `Step 2 of 4 · ${DEMO_PROGRESS_STATUS.todo}`,
    `Step 3 of 4 · ${DEMO_PROGRESS_STATUS.todo}`,
    `Step 4 of 4 · ${DEMO_PROGRESS_STATUS.todo}`,
  ]);
  // Exactly one step is the current one, and it is the one to do.
  assert.deepEqual(currentSteps(page), [DEMO_PROGRESS_STEPS[0]]);

  // The action for step one is the form below, so the path offers no link and
  // costs the first screen no tab stop.
  assert.equal(actionCount(page), 0, "the first state offered a link instead of the form");
  const lead = textOf(byId(page, "evaluation-path-next-lead"));
  assert.match(lead, /Nothing is recorded in this browser yet/);
  // Arriving is not a change, so nothing is announced on the first paint.
  assert.equal(announced(page), "");
});

test("a recorded decision completes step one and offers one link to Releases", async (t) => {
  const page = await openHome(t, { decisions: [DECISION] });

  assert.deepEqual(statuses(page).slice(0, 2), [
    `Step 1 of 4 · ${DEMO_PROGRESS_STATUS.done}`,
    `Step 2 of 4 · ${DEMO_PROGRESS_STATUS.current}`,
  ]);
  assert.deepEqual(currentSteps(page), [DEMO_PROGRESS_STEPS[1]]);

  // One action, and it carries the decision to the Releases recorder through
  // the parameter that page already reads (decisionToLink / LINK_DECISION_PARAM).
  assert.equal(actionCount(page), 1, "the indicator offered more than one next action");
  assert.equal(action(page).getAttribute("href"), `/releases.html?link=${DECISION.id}#record-release`);
  assert.match(textOf(action(page)), /Record the release for “Adopt a durable job queue” on Releases/);
  assert.equal(action(page).getAttribute("aria-describedby"), "evaluation-path-next-lead");

  // The sentence read with the link says where the record lives, and claims
  // nothing about it being shared, published, or synced anywhere.
  const lead = textOf(byId(page, "evaluation-path-next-lead"));
  assert.match(lead, /is recorded in this browser/);
  assert.match(lead, /already ticked/);
  assert.doesNotMatch(lead, /publish|shared|synced|uploaded|sent to/i, "the lead claims the record left this browser");
});

test("a release linked to that decision completes step three and opens its details", async (t) => {
  const page = await openHome(t, { decisions: [DECISION], releases: [RELEASE] });

  assert.deepEqual(statuses(page), [
    `Step 1 of 4 · ${DEMO_PROGRESS_STATUS.done}`,
    `Step 2 of 4 · ${DEMO_PROGRESS_STATUS.done}`,
    `Step 3 of 4 · ${DEMO_PROGRESS_STATUS.done}`,
    `Step 4 of 4 · ${DEMO_PROGRESS_STATUS.current}`,
  ]);
  assert.deepEqual(currentSteps(page), [DEMO_PROGRESS_STEPS[3]]);

  assert.equal(actionCount(page), 1);
  assert.equal(action(page).getAttribute("href"), `/release.html?id=${RELEASE.id}`);
  assert.match(textOf(action(page)), /Open release v1\.3\.0 and its linked decision/);
  const lead = textOf(byId(page, "evaluation-path-next-lead"));
  assert.match(lead, /Release v1\.3\.0 is recorded in this browser and links “Adopt a durable job queue”/);
});

test("a release linked to no stored decision leaves the path on step two", async (t) => {
  // Recording an unlinked release is not the step the path is asking for, and
  // reporting it as progress would tell a visitor the demo is done when the
  // link — the whole point of it — was never made.
  const unlinked = { ...RELEASE, id: "r-unlinked", decisionIds: [] };
  const page = await openHome(t, { decisions: [DECISION], releases: [unlinked] });

  assert.deepEqual(currentSteps(page), [DEMO_PROGRESS_STEPS[1]]);
  assert.equal(action(page).getAttribute("href"), `/releases.html?link=${DECISION.id}#record-release`);
});

test("returning to the home page restores the same state from this browser's store", async (t) => {
  // First visit: record a decision through the form, the way a person does.
  const first = await openHome(t);
  fill(first, ENTRY);
  byId(first, "decision-form").querySelector('button[type="submit"]').click();
  const decisions = JSON.parse(first.storage.getItem(STORAGE_KEY) ?? "[]");
  assert.equal(decisions.length, 1, "the decision never reached storage");
  const href = textOf(action(first)) && action(first).getAttribute("href");
  first.restore();

  // Second visit, same browser: the page is parsed again from the shipped
  // markup and arrives on step two rather than on step one.
  const page = await openHome(t, { decisions });
  assert.deepEqual(currentSteps(page), [DEMO_PROGRESS_STEPS[1]]);
  assert.equal(action(page).getAttribute("href"), href, "the restored action points somewhere else");
  assert.equal(statuses(page)[0], `Step 1 of 4 · ${DEMO_PROGRESS_STATUS.done}`);
  // A revisit is an arrival, not a change: the live region says nothing.
  assert.equal(announced(page), "");
});

test("a save moves the indicator without a reload and announces the move politely", async (t) => {
  const page = await openHome(t);
  const live = byId(page, "evaluation-path-announce");
  assert.equal(live.getAttribute("role"), "status");
  assert.equal(live.getAttribute("aria-live"), "polite");
  // Not behind a disclosure: the harness reads through a closed details element,
  // so a status folded into one would pass here and go silent in a browser.
  for (let cursor = live; cursor; cursor = cursor.parentNode) {
    assert.notEqual(cursor.tagName, "DETAILS", "the live region sits inside a disclosure");
  }

  fill(page, ENTRY);
  byId(page, "decision-form").querySelector('button[type="submit"]').click();

  assert.deepEqual(currentSteps(page), [DEMO_PROGRESS_STEPS[1]]);
  assert.match(announced(page), /^Demo progress: step 2 of 4\./);
  assert.match(announced(page), /Continue to Releases with that decision ready to link\./);
});

test("a refused save leaves the indicator on step one and announces nothing", async (t) => {
  const page = await openHome(t);
  // Every required field is empty, so the recorder refuses the entry.
  byId(page, "decision-form").querySelector('button[type="submit"]').click();

  assert.deepEqual(currentSteps(page), [DEMO_PROGRESS_STEPS[0]]);
  assert.equal(actionCount(page), 0, "a refused save offered a release to record");
  assert.equal(announced(page), "", "a refused save announced progress");
});

test("the next action is reachable by Tab and opens the address it names", async (t) => {
  const page = await openHome(t, { decisions: [DECISION] });
  const target = action(page);

  // Bounded by the page's own tab stops: pressTab restarts at stop zero, so a
  // fixed count would turn any link added elsewhere into a failure here.
  let reached = null;
  for (let press = 0; press < tabSequence(page.document).length && reached !== target; press += 1) {
    reached = pressTab(page.document);
  }
  assert.ok(reached === target, "the indicator's next action is not reachable by Tab");
  pressEnter(page.document);
  assert.deepEqual(page.navigations, [`/releases.html?link=${DECISION.id}#record-release`]);
});

test("the path wraps down the page at a phone width instead of overflowing", async () => {
  // The harness models no layout and nothing on this page reads matchMedia, so
  // the rule itself is what is pinned rather than a faked 390px viewport.
  const css = await readFile(CSS, "utf8");
  assert.match(css, /\.evaluation-path-status \{[^}]*display:block/);
  assert.match(css, /\.evaluation-path-step \{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.evaluation-path-next \{[^}]*overflow-wrap:anywhere/);
  const narrow = css.match(/@media \(max-width:520px\) \{\s*\.evaluation-path ol \{[^}]*\}\s*\.evaluation-path li \{([^}]*)\}\s*\.evaluation-path-next \.text-link \{([^}]*)\}/);
  assert.ok(narrow, "no narrow-width rule for the evaluation path");
  assert.match(narrow[1], /display:block/);
  assert.match(narrow[2], /overflow-wrap:anywhere/);
  assert.match(narrow[2], /white-space:normal/);
});

test("malformed stored records paint the first state instead of throwing", async (t) => {
  for (const storage of [
    { [STORAGE_KEY]: "{not json", [RELEASE_STORAGE_KEY]: "[{" },
    { [STORAGE_KEY]: JSON.stringify([null, 7, { id: 3 }]), [RELEASE_STORAGE_KEY]: "{}" },
    {},
  ]) {
    const page = await loadPage(HOME, { storage });
    try {
      await initDecisionLog(page.document, page.storage, {
        seed: NO_DEMO_DATA,
        location: { pathname: "/", search: "", hash: "" },
        history: { replaceState() {} },
      });
      assert.equal(items(page).length, 4, `the path did not paint over ${JSON.stringify(storage)}`);
      assert.equal(actionCount(page), 0);
    } finally {
      page.restore();
    }
  }
});

test("the seeded example records are not counted as this browser's progress", async (t) => {
  // The examples are read through at render time and never written, so a first
  // visitor must still be on step one with the demo data on screen.
  const page = await loadPage(HOME, { storage: {} });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage, {
    location: { pathname: "/", search: "", hash: "" },
    history: { replaceState() {} },
  });
  assert.deepEqual(currentSteps(page), [DEMO_PROGRESS_STEPS[0]]);
  assert.equal(actionCount(page), 0, "a seeded example was counted as a recorded decision");
});

test("the state is a function of the records alone", async () => {
  // The derivation, without a document: the same two lists always give the same
  // step, which is what makes a revisit restore what the last visit left.
  assert.equal(demoProgress({}).currentIndex, 0);
  assert.equal(demoProgress({ decisions: [DECISION] }).currentIndex, 1);
  assert.equal(demoProgress({ decisions: [DECISION], releases: [RELEASE] }).currentIndex, 3);

  // A newer decision recorded after the demo was finished does not walk the
  // reader back: the tracked decision is the newest one that has a release.
  const later = { ...DECISION, id: "d-cache", title: "Cache the read path" };
  const finished = demoProgress({ decisions: [later, DECISION], releases: [RELEASE] });
  assert.equal(finished.currentIndex, 3);
  assert.equal(finished.release.id, RELEASE.id);
  assert.equal(finished.decision.id, DECISION.id);

  // Step four is never reported done: nothing in this browser records that a
  // detail page was read, and claiming it would be a fact we cannot observe.
  assert.equal(finished.steps[3].status, DEMO_PROGRESS_STATUS.current);
});
