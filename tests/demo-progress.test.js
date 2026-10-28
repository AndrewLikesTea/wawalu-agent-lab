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
  DEMO_PROGRESS_DONE_ANNOUNCEMENT,
  DEMO_PROGRESS_STATUS,
  demoProgress,
  demoProgressSteps,
} from "../src/demo-progress.js";
import { DEMO_VISIT_KEY, demoVisit, demoEvidence } from "../src/demo-evidence.js";
import { initReleaseDetail } from "../src/release-page.js";
import { recordsChanged } from "../src/shiplog-records.js";
import { DomEvent, loadPage, pressEnter, pressTab, tabSequence, textOf, typeText } from "./support/browser.js";

const HOME = new URL("../src/index.html", import.meta.url);
// The steps as this page states them: the home page's own wording, which says
// of each action whether it happens on this page or on Releases (#2727).
const STEPS = demoProgressSteps("home");
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

async function openHome(t, { decisions = [], releases = [], visit = demoVisit(decisions[0], releases[0]) } = {}) {
  const page = await loadPage(HOME, {
    storage: {
      [DEMO_VISIT_KEY]: visit,
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
  assert.deepEqual(currentSteps(page), [STEPS[0]]);

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
  assert.deepEqual(currentSteps(page), [STEPS[1]]);

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

// The finished demo (#3033): a decision and a release that links it, both in
// this browser, is the whole proof, and the home page answers it with the two
// asks and the evaluation kit instead of one more step.
const done = (page) => byId(page, "evaluation-path-done");
const DONE_LINKS = [
  "evaluation-path-pilot",
  "evaluation-path-demonstration",
  "evaluation-path-brief",
  "evaluation-path-scorecard",
];

test("opening a release linked to that decision finishes the demo on the home page", async (t) => {
  const page = await openHome(t, { decisions: [DECISION], releases: [RELEASE] });

  // (a) All four steps say done, none is the one to do, and no link is left in
  // the next-action region.
  assert.deepEqual(statuses(page), [1, 2, 3, 4].map((n) => `Step ${n} of 4 · ${DEMO_PROGRESS_STATUS.done}`));
  assert.deepEqual(currentSteps(page), []);
  assert.doesNotMatch(textOf(byId(page, "evaluation-path-steps")), new RegExp(DEMO_PROGRESS_STATUS.current));
  assert.equal(actionCount(page), 0);
  assert.ok(!done(page).hidden, "the finished state is still hidden");
  assert.equal(textOf(byId(page, "evaluation-path-done-lead")), "All four steps are done.");

  assert.match(textOf(byId(page, "evaluation-path-evidence")), /Recorded decision “Adopt a durable job queue” is linked to recorded release “v1.3.0 — Throughput and latency”/);

  // (c) Both asks are the availability section's own pair, byte for byte: the
  // same address, topic key, description and words.
  for (const [id, heroId] of [["evaluation-path-pilot", "discuss-pilot"], ["evaluation-path-demonstration", "ask-about-shiplog"]]) {
    const link = byId(page, id);
    const hero = byId(page, heroId);
    for (const name of ["href", "data-buyer-intent", "aria-describedby", "class"]) {
      assert.equal(link.getAttribute(name), hero.getAttribute(name), `${id} differs from #${heroId} on ${name}`);
    }
    assert.equal(textOf(link), textOf(hero));
  }
  assert.equal(byId(page, "evaluation-path-pilot").getAttribute("data-buyer-intent"), "pilot");
  assert.equal(byId(page, "evaluation-path-demonstration").getAttribute("data-buyer-intent"), "demo");

  // (d) The evaluation kit, at the sections this page already carries.
  assert.equal(byId(page, "evaluation-path-brief").getAttribute("href"), "#shiplog-evaluation-brief");
  assert.equal(textOf(byId(page, "evaluation-path-brief")), "Shiplog evaluation brief");
  assert.equal(byId(page, "evaluation-path-scorecard").getAttribute("href"), "#shiplog-pilot-scorecard");
  assert.equal(textOf(byId(page, "evaluation-path-scorecard")), "Blank pilot scorecard");
  assert.equal(page.document.querySelectorAll("#shiplog-evaluation-brief").length, 1);
  assert.equal(page.document.querySelectorAll("#shiplog-pilot-scorecard").length, 1);

  // (e) The demo caveat stays in view, and the new block adds no number and no
  // testimonial or result claim.
  assert.ok(!byId(page, "evaluation-path-scope").hidden);
  assert.match(textOf(byId(page, "evaluation-path-scope")), /This is a demo workflow, not a customer result\./);
  const block = textOf(done(page));
  assert.match(block, /not a customer outcome, benchmark, or testimonial/);
  assert.equal(done(page).querySelectorAll("a").length, DONE_LINKS.length + 2);
});

test("the finished state's links are reached by Tab in reading order and follow with Enter", async (t) => {
  const page = await openHome(t, { decisions: [DECISION], releases: [RELEASE] });
  const targets = DONE_LINKS.map((id) => byId(page, id));

  // (f) Bounded by the page's own tab stops: pressTab restarts at stop zero.
  const sequence = tabSequence(page.document);
  let reached = null;
  for (let press = 0; press < sequence.length && reached !== targets[0]; press += 1) {
    reached = pressTab(page.document);
  }
  assert.ok(reached === targets[0], "the pilot link is not reachable by Tab");
  for (const target of targets.slice(1)) {
    assert.ok(pressTab(page.document) === target, `Tab did not move on to #${target.getAttribute("id")}`);
  }
  for (const target of targets) assert.equal(target.tagName, "A");
});

test("before the demo is finished its block is hidden and out of the tab order", async (t) => {
  for (const records of [{}, { decisions: [DECISION] }, { decisions: [DECISION], releases: [{ ...RELEASE, decisionIds: [] }] }]) {
    const page = await openHome(t, records);
    assert.ok(done(page).hidden, "the finished state shows before the demo is finished");
    const sequence = tabSequence(page.document);
    for (const id of DONE_LINKS) {
      assert.equal(sequence.filter((node) => node.getAttribute("id") === id).length, 0, `#${id} is a tab stop`);
    }
    // The tracker itself is unchanged: one step is still the one to do.
    assert.equal(currentSteps(page).length, 1);
    assert.match(textOf(byId(page, "evaluation-path-steps")), new RegExp(DEMO_PROGRESS_STATUS.current));
    page.restore();
  }
});

test("finishing the demo without a reload announces it politely", async (t) => {
  const page = await openHome(t, { decisions: [DECISION] });
  assert.ok(done(page).hidden);
  page.storage.setItem(RELEASE_STORAGE_KEY, JSON.stringify([RELEASE]));
  page.storage.setItem(DEMO_VISIT_KEY, demoVisit(DECISION, RELEASE));
  recordsChanged(page.document);

  assert.ok(!done(page).hidden, "the finished state did not appear");
  assert.equal(announced(page), DEMO_PROGRESS_DONE_ANNOUNCEMENT);
  assert.equal(actionCount(page), 0);
});

test("on Releases a linked release still leaves step four as the one to do", () => {
  const progress = demoProgress({ decisions: [DECISION], releases: [RELEASE], surface: "releases" });
  assert.equal(progress.complete, false);
  assert.equal(progress.currentIndex, 3);
  assert.equal(progress.steps[3].status, DEMO_PROGRESS_STATUS.current);
});

test("a release linked to no stored decision leaves the path on step two", async (t) => {
  // Recording an unlinked release is not the step the path is asking for, and
  // reporting it as progress would tell a visitor the demo is done when the
  // link — the whole point of it — was never made.
  const unlinked = { ...RELEASE, id: "r-unlinked", decisionIds: [] };
  const page = await openHome(t, { decisions: [DECISION], releases: [unlinked] });

  assert.deepEqual(currentSteps(page), [STEPS[1]]);
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
  assert.deepEqual(currentSteps(page), [STEPS[1]]);
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

  assert.deepEqual(currentSteps(page), [STEPS[1]]);
  assert.match(announced(page), /^Demo progress: step 2 of 4\./);
  assert.match(announced(page), /Continue to Releases with that decision ready to link\./);
});

test("a refused save leaves the indicator on step one and announces nothing", async (t) => {
  const page = await openHome(t);
  // Every required field is empty, so the recorder refuses the entry.
  byId(page, "decision-form").querySelector('button[type="submit"]').click();

  assert.deepEqual(currentSteps(page), [STEPS[0]]);
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
  assert.deepEqual(currentSteps(page), [STEPS[0]]);
  assert.equal(actionCount(page), 0, "a seeded example was counted as a recorded decision");
});

test("completion is derived from current records and their saved detail visit", async () => {
  // The derivation, without a document: the same two lists always give the same
  // step, which is what makes a revisit restore what the last visit left.
  assert.equal(demoProgress({}).currentIndex, 0);
  assert.equal(demoProgress({ decisions: [DECISION] }).currentIndex, 1);
  assert.equal(demoProgress({ decisions: [DECISION], releases: [RELEASE], visit: demoVisit(DECISION, RELEASE) }).complete, true);

  // A newer decision recorded after the demo was finished does not walk the
  // reader back: the tracked decision is the newest one that has a release.
  const later = { ...DECISION, id: "d-cache", title: "Cache the read path" };
  const finished = demoProgress({ decisions: [later, DECISION], releases: [RELEASE], visit: demoVisit(DECISION, RELEASE) });
  assert.equal(finished.complete, true);
  assert.equal(finished.release.id, RELEASE.id);
  assert.equal(finished.decision.id, DECISION.id);

  // On the home page the opened linked pair is the finish: every step is done
  // and none is current. Releases keeps step four current (tested above).
  assert.deepEqual(finished.steps.map((step) => step.status), Array(4).fill(DEMO_PROGRESS_STATUS.done));
  assert.equal(finished.steps.filter((step) => step.current).length, 0);
  assert.equal(finished.action, null);
});

test("evidence requires the exact opened pair, never an unvisited, stale or malformed state", async (t) => {
  for (const visit of [null, "true", "{bad", "{}", demoVisit(DECISION, { ...RELEASE, title: "Old release" }),
    demoVisit({ ...DECISION, title: "Old decision" }, RELEASE)]) {
    const page = await openHome(t, { decisions: [DECISION], releases: [RELEASE], visit });
    assert.ok(done(page).hidden);
    assert.equal(byId(page, "evaluation-path-evidence").querySelectorAll("button").length, 0);
    assert.deepEqual(currentSteps(page), [STEPS[3]]);
    page.restore();
  }
});

test("opening the actual local release persists completion; examples do not", async (t) => {
  const page = await loadPage(new URL("../src/release.html", import.meta.url), {
    storage: { [STORAGE_KEY]: JSON.stringify([DECISION]), [RELEASE_STORAGE_KEY]: JSON.stringify([RELEASE]) },
    location: { search: `?id=${RELEASE.id}` },
  });
  t.after(() => page.restore());
  initReleaseDetail();
  const visit = page.storage.getItem(DEMO_VISIT_KEY);
  assert.equal(visit, demoVisit(DECISION, RELEASE));
  page.restore();
  const home = await openHome(t, { decisions: [DECISION], releases: [RELEASE], visit });
  assert.ok(!done(home).hidden);
  const links = byId(home, "evaluation-path-evidence").querySelectorAll("a");
  for (const [index, href] of [`/release.html?id=${RELEASE.id}`, `/decision.html?id=${DECISION.id}`].entries()) {
    assert.equal(links[index].getAttribute("href"), href);
    links[index].focus();
    pressEnter(home.document);
    assert.equal(home.navigations.at(-1), href);
  }
});

test("copy uses the rendered model, announces success, and preserves focus", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  t.after(() => original ? Object.defineProperty(globalThis, "navigator", original) : delete globalThis.navigator);
  let copied;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: {
    async writeText(text) { copied = text; },
  } } });
  const page = await openHome(t, { decisions: [DECISION], releases: [RELEASE] });
  const box = byId(page, "evaluation-path-evidence");
  const button = box.querySelector("button");
  button.focus();
  pressEnter(page.document);
  await Promise.resolve();
  assert.equal(copied, demoEvidence(DECISION, RELEASE).text);
  assert.match(copied, /not a customer outcome, benchmark, or testimonial/);
  assert.match(copied, /Recorded decision “Adopt a durable job queue” is linked to recorded release/);
  assert.match(copied, /stay in the evaluator's browser/);
  assert.doesNotMatch(copied, /\.html|https?:/, "the copy shares links its reader cannot open");
  assert.match(textOf(box.querySelector('[role="status"]')), /copied/);
  assert.ok(page.document.activeElement === button);
});

test("clipboard rejection or absence offers manual text with live feedback and focus", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  t.after(() => original ? Object.defineProperty(globalThis, "navigator", original) : delete globalThis.navigator);
  for (const clipboard of [undefined, { async writeText() { throw new Error("Denied"); } }]) {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard } });
    const page = await openHome(t, { decisions: [DECISION], releases: [RELEASE] });
    const box = byId(page, "evaluation-path-evidence");
    box.querySelector("button").click();
    await Promise.resolve();
    const status = box.querySelector('[role="status"]');
    assert.equal(status.getAttribute("aria-live"), "polite");
    assert.match(textOf(status), /Could not copy automatically/);
    const field = box.querySelector("textarea");
    assert.ok(!field.hidden);
    assert.equal(field.value, demoEvidence(DECISION, RELEASE).text);
    assert.ok(page.document.activeElement === field);
    page.storage.setItem(RELEASE_STORAGE_KEY, "[]");
    recordsChanged(page.document);
    assert.ok(done(page).hidden);
    assert.ok(page.document.activeElement === byId(page, "evaluation-path-title"));
    page.restore();
  }
});

test("copy rechecks storage and removes evidence if the link changed silently", async (t) => {
  const page = await openHome(t, { decisions: [DECISION], releases: [RELEASE] });
  const button = byId(page, "evaluation-path-evidence").querySelector("button");
  page.storage.setItem(RELEASE_STORAGE_KEY, JSON.stringify([{ ...RELEASE, decisionIds: [] }]));
  button.focus();
  button.click();
  assert.ok(done(page).hidden);
  assert.ok(page.document.activeElement === byId(page, "evaluation-path-title"));
});

test("erasing browser records also erases the saved detail visit", async (t) => {
  const { eraseWorkspace } = await import("../src/local-workspace.js");
  const page = await openHome(t, { decisions: [DECISION], releases: [RELEASE] });
  assert.equal(eraseWorkspace(page.storage).ok, true);
  assert.equal(page.storage.getItem(DEMO_VISIT_KEY), null);
});

test("missing records, mismatched links and duplicate ids cannot reuse a saved visit", async (t) => {
  for (const records of [
    { decisions: [], releases: [RELEASE] },
    { decisions: [DECISION], releases: [] },
    { decisions: [DECISION], releases: [{ ...RELEASE, decisionIds: ["other"] }] },
    { decisions: [DECISION], releases: [{ ...RELEASE, decisionIds: [] }, RELEASE] },
  ]) {
    const page = await openHome(t, { ...records, visit: demoVisit(DECISION, RELEASE) });
    assert.ok(done(page).hidden);
    assert.equal(byId(page, "evaluation-path-evidence").querySelectorAll("button").length, 0);
    page.restore();
  }
});

test("an example-only detail route never records completion", async (t) => {
  const page = await loadPage(new URL("../src/release.html", import.meta.url), {
    storage: { [STORAGE_KEY]: JSON.stringify([DECISION]), [RELEASE_STORAGE_KEY]: JSON.stringify([RELEASE]) },
    location: { search: "?id=demo-r-1-3-0&example=1" },
  });
  t.after(() => page.restore());
  initReleaseDetail();
  assert.equal(page.storage.getItem(DEMO_VISIT_KEY), null);
});
