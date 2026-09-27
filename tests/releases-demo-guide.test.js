// The four-step demo guide on Releases (issue #2578): the same guide the home
// page carries, the same module behind it, and the next action named in the
// words of controls this page already ships.
//
// Driven through the shipped src/releases.html, booted with initReleasesPage and
// read back as text a person can perceive: a status word in an item, an
// attribute a screen reader acts on, the address a link carries, what Tab
// reaches. Nothing here reads module state.
//
// The property this file exists to hold is that there is ONE step model. The
// four sentences are compared against the home page's own shipped markup rather
// than against a copy written here, so a wording change on either page that did
// not land on both fails here.
//
// Determinism: no network, no clock, no sleeps. Each test parses its own page
// with its own storage, and the seeded examples are switched off, so what the
// guide reports can only have come from the store the test wrote.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STORAGE_KEY } from "../src/app.js";
import { DETAIL_LINK_TEXT, RELEASE_STORAGE_KEY, releaseDetailLinkLabel } from "../src/releases.js";
import { initReleasesPage } from "../src/releases-page.js";
import {
  DEMO_PROGRESS_PREREQUISITE,
  DEMO_PROGRESS_PREREQUISITE_ACTION,
  DEMO_PROGRESS_SCOPE,
  DEMO_PROGRESS_STATUS,
  DEMO_PROGRESS_STEPS,
  LINKED_DECISIONS_CONTROL,
  LINKED_DECISIONS_HREF,
} from "../src/demo-progress.js";
import { loadPage, pressEnter, pressSpace, pressTab, tabSequence, textOf, typeText } from "./support/browser.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const HOME_PAGE = new URL("../src/index.html", import.meta.url);
const CSS = new URL("../src/releases-proof.css", import.meta.url);
// The seeded examples are a read-through layer nobody in this browser recorded,
// so a guide reporting what THIS browser holds is handed an empty seed.
const NO_SEED = { decisions: [], releases: [] };

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

async function openReleases(t, { decisions = [], releases = [], seed = NO_SEED, boot = true } = {}) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(decisions),
      [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
    },
  });
  t.after(() => page.restore());
  if (boot) {
    initReleasesPage(page.document, page.storage, {
      seed,
      location: { pathname: "/releases.html", search: "", hash: "" },
      history: { replaceState() {} },
      readHealth: async () => { throw new Error("no network in tests"); },
    });
    assert.equal(page.document.documentElement.dataset.shiplogReleases, "ready", "the page never rendered");
  }
  return page;
}

const byId = (page, id) => {
  const node = page.document.querySelector(`#${id}`);
  assert.ok(node, `the releases page has no #${id}`);
  return node;
};
const items = (page) => byId(page, "evaluation-path-steps").querySelectorAll("li");
const statuses = (page) => items(page).map((item) => textOf(item.querySelector(".evaluation-path-status")));
const stepTexts = (page) => items(page).map((item) => textOf(item.querySelector(".evaluation-path-step")));
const currentSteps = (page) => items(page)
  .filter((item) => item.getAttribute("aria-current") === "step")
  .map((item) => textOf(item.querySelector(".evaluation-path-step")));
// Counted, never compared against null: asserting equality on a harness element
// walks the whole parsed page and takes minutes to say what a count says now.
const actionCount = (page) => byId(page, "evaluation-path-next").querySelectorAll("a").length;
const action = (page) => byId(page, "evaluation-path-action");
const lead = (page) => textOf(byId(page, "evaluation-path-next-lead"));
const announced = (page) => textOf(byId(page, "evaluation-path-announce"));

// The legend's own words, read off the control rather than restated: a fieldset
// takes its accessible name from its legend, and the optional marking is a span
// inside that legend, so it is part of the name.
function linkedDecisionsName(page) {
  const field = byId(page, "release-decisions-field");
  const legend = field.children.find((child) => child.tagName === "LEGEND");
  assert.ok(legend, "the linked-decisions control has no legend");
  return textOf(legend);
}

function fill(page, id, value) {
  const control = byId(page, id);
  control.focus();
  control.value = "";
  typeText(page.document, value);
}

function recordRelease(page, { link = null } = {}) {
  fill(page, "release-version", "v1.3.0");
  fill(page, "release-owner", "Tess");
  fill(page, "release-released-on", "2026-05-20");
  fill(page, "release-description", "The queue work, shipped.");
  if (link) {
    const check = page.document.querySelectorAll(".decision-picker-check")
      .find((node) => node.getAttribute("value") === link);
    assert.ok(check, `the recorder offered no option for ${link}`);
    check.focus();
    pressSpace(page.document);
  }
  byId(page, "release-form").querySelector('button[type="submit"]').click();
}

// --- criterion 1: the same four steps, and the current one is programmatic ---

test("the guide lists the home page's four steps, in its order and its words", async (t) => {
  const page = await openReleases(t, { decisions: [DECISION] });
  const home = await loadPage(HOME_PAGE, { storage: {} });
  t.after(() => home.restore());

  // The home page's shipped sentences, taken off the home page. Two divergent
  // copies of the step model is the failure this issue exists to prevent, so
  // neither side of the comparison is a literal written in this file.
  const homeSteps = home.document.querySelector("#evaluation-path-steps")
    .querySelectorAll("li")
    .map((item) => textOf(item.querySelector(".evaluation-path-step")));
  assert.deepEqual(stepTexts(page), homeSteps);
  assert.deepEqual(stepTexts(page), [...DEMO_PROGRESS_STEPS]);
  assert.equal(byId(page, "evaluation-path-steps").tagName, "OL", "the steps are not an ordered list");

  // Identified programmatically, and completed steps say so in words: no
  // colour, no icon, nothing that needs a stylesheet to be legible.
  assert.deepEqual(statuses(page), [
    `Step 1 of 4 · ${DEMO_PROGRESS_STATUS.done}`,
    `Step 2 of 4 · ${DEMO_PROGRESS_STATUS.done}`,
    `Step 3 of 4 · ${DEMO_PROGRESS_STATUS.current}`,
    `Step 4 of 4 · ${DEMO_PROGRESS_STATUS.todo}`,
  ]);
  assert.deepEqual(currentSteps(page), [DEMO_PROGRESS_STEPS[2]]);
  assert.equal(items(page).filter((item) => item.getAttribute("aria-current")).length, 1);

  // Standing on Releases IS step two, so it is not offered as the thing to do.
  assert.equal(statuses(page)[1], `Step 2 of 4 · ${DEMO_PROGRESS_STATUS.done}`);
});

test("the guide is a named region of its own, and names nothing twice", async (t) => {
  const page = await openReleases(t);
  const region = byId(page, "evaluation-path");
  assert.equal(region.tagName, "SECTION");
  assert.equal(region.getAttribute("aria-labelledby"), "evaluation-path-title");
  const title = byId(page, "evaluation-path-title");
  assert.equal(textOf(title), "Try the whole demo in four steps");
  // An h2 like the blocks either side of it, not a level skipped to match a
  // different page's nesting.
  assert.equal(title.tagName, "H2");
  // One region with this name, and no second main landmark.
  assert.equal(page.document.querySelectorAll("#evaluation-path-title").length, 1);
  assert.equal(page.document.querySelectorAll("main").length, 1);
  // It stands after the checkable deployment record and the example records,
  // and before the log and the recorder it directs a reader into.
  const blocks = page.document.getElementById("main-content").children
    .map((node) => node.getAttribute?.("id") ?? "")
    .filter(Boolean);
  assert.ok(blocks.indexOf("real-deployment") < blocks.indexOf("evaluation-path"));
  assert.ok(blocks.indexOf("shiplog-proof") < blocks.indexOf("evaluation-path"));
});

// --- criterion 4: no decision recorded is its own branch ----------------------

test("with no decision recorded the guide states the prerequisite and links to the form", async (t) => {
  const page = await openReleases(t);

  // Not a hidden guide: the four steps are still the map, and every status word
  // says the demo has not started.
  assert.equal(items(page).length, 4);
  assert.deepEqual(currentSteps(page), [DEMO_PROGRESS_STEPS[0]]);
  assert.equal(statuses(page)[0], `Step 1 of 4 · ${DEMO_PROGRESS_STATUS.current}`);

  // Its own copy, which says what is missing and where the step lives, and does
  // not offer the release recorder below as if step three were reachable.
  assert.equal(lead(page), DEMO_PROGRESS_PREREQUISITE);
  assert.match(lead(page), /No decision is recorded in this browser yet/);
  assert.match(lead(page), /decision form on the Home page/);
  assert.equal(actionCount(page), 1, "the prerequisite state offered more than one way out");
  assert.equal(textOf(action(page)), DEMO_PROGRESS_PREREQUISITE_ACTION);
  // The decision form's actual page, and the fragment the form itself carries.
  assert.equal(action(page).getAttribute("href"), "/index.html#decision-form");
  const home = await readFile(HOME_PAGE, "utf8");
  assert.match(home, /<form id="decision-form"/, "the link points at a fragment the home page does not carry");
  assert.equal(action(page).getAttribute("aria-describedby"), "evaluation-path-next-lead");
});

test("the prerequisite state is what the page ships before any module runs", async (t) => {
  // A reader whose scripts never ran holds no records this page could have read,
  // so the authored state is the prerequisite — not the home page's "the form
  // below", which on this page is the release recorder.
  const page = await openReleases(t, { boot: false });
  assert.equal(lead(page), DEMO_PROGRESS_PREREQUISITE);
  assert.deepEqual(stepTexts(page), [...DEMO_PROGRESS_STEPS]);
  assert.deepEqual(currentSteps(page), [DEMO_PROGRESS_STEPS[0]]);
  assert.equal(action(page).getAttribute("href"), "/index.html#decision-form");
});

// --- criterion 2: the named decision, and the control to link it with --------

test("an unlinked decision is named, and the guide points at the Linked decisions control", async (t) => {
  const page = await openReleases(t, { decisions: [DECISION] });

  // The decision's own recorded title, from this browser's store.
  assert.match(lead(page), /“Adopt a durable job queue” is recorded in this browser/);
  assert.match(lead(page), /no release in this log links it yet/);
  assert.match(textOf(action(page)), /Adopt a durable job queue/);

  // The control named in the words on its face: the accessible name its own
  // legend gives it, including the optional marking inside that legend.
  assert.equal(linkedDecisionsName(page), LINKED_DECISIONS_CONTROL);
  assert.ok(lead(page).includes(LINKED_DECISIONS_CONTROL), "the lead does not name the control it directs to");
  assert.ok(textOf(action(page)).includes(LINKED_DECISIONS_CONTROL));
  assert.equal(actionCount(page), 1);
  assert.equal(action(page).getAttribute("href"), LINKED_DECISIONS_HREF);
  assert.equal(action(page).getAttribute("href"), "#release-decisions-field");

  // And the control is really there, offering that decision to tick.
  const ticks = page.document.querySelectorAll(".decision-picker-check");
  assert.equal(ticks.filter((node) => node.getAttribute("value") === DECISION.id).length, 1);
});

// --- criterion 3: the release-recorded state ends on the shipped action ------

test("a recorded release completes step three and ends on the page's own details action", async (t) => {
  const page = await openReleases(t, { decisions: [DECISION], releases: [RELEASE] });

  assert.deepEqual(statuses(page), [
    `Step 1 of 4 · ${DEMO_PROGRESS_STATUS.done}`,
    `Step 2 of 4 · ${DEMO_PROGRESS_STATUS.done}`,
    `Step 3 of 4 · ${DEMO_PROGRESS_STATUS.done}`,
    `Step 4 of 4 · ${DEMO_PROGRESS_STATUS.current}`,
  ]);
  assert.deepEqual(currentSteps(page), [DEMO_PROGRESS_STEPS[3]]);

  // The log's own control, in its words, with the accessible name that control
  // builds for a release — not a fifth way of saying "open the release".
  assert.equal(actionCount(page), 1);
  assert.equal(textOf(action(page)), DETAIL_LINK_TEXT);
  assert.equal(action(page).getAttribute("aria-label"), releaseDetailLinkLabel(RELEASE));
  assert.equal(action(page).getAttribute("href"), `/release.html?id=${RELEASE.id}`);
  // The same words the page already ships on its per-record control.
  assert.equal(textOf(byId(page, "release-record-detail")), `${DETAIL_LINK_TEXT}→`);
  assert.match(lead(page), /Release v1\.3\.0 is recorded in this browser and links “Adopt a durable job queue”/);
});

test("recording the release here moves the guide and announces the move once", async (t) => {
  const page = await openReleases(t, { decisions: [DECISION] });
  const live = byId(page, "evaluation-path-announce");
  assert.equal(live.getAttribute("role"), "status");
  assert.equal(live.getAttribute("aria-live"), "polite");
  // Not folded into a disclosure: the harness reads through a closed details
  // element, so a status inside one would pass here and go silent in a browser.
  for (let cursor = live; cursor; cursor = cursor.parentNode) {
    assert.notEqual(cursor.tagName, "DETAILS", "the live region sits inside a disclosure");
  }
  // Arriving is not a change, so the first paint announces nothing.
  assert.equal(announced(page), "");

  recordRelease(page, { link: DECISION.id });

  assert.deepEqual(currentSteps(page), [DEMO_PROGRESS_STEPS[3]]);
  assert.equal(textOf(action(page)), DETAIL_LINK_TEXT);
  assert.match(announced(page), /^Demo progress: step 4 of 4\./);
  assert.match(announced(page), /Open the release you recorded/);
});

test("a release recorded without linking the decision leaves the guide on step three", async (t) => {
  const page = await openReleases(t, { decisions: [DECISION] });
  recordRelease(page);

  // The link is the whole point of the demo, so an unlinked release is not the
  // step being asked for, and the guide must not report it as one.
  assert.deepEqual(currentSteps(page), [DEMO_PROGRESS_STEPS[2]]);
  assert.equal(action(page).getAttribute("href"), LINKED_DECISIONS_HREF);
  // Nothing moved, so nothing is announced.
  assert.equal(announced(page), "");
});

// --- criterion 5: every name and number is this browser's, and labelled ------

test("the provenance sentence is the home page's, stated once, with no second caveat", async (t) => {
  const page = await openReleases(t, { decisions: [DECISION], releases: [RELEASE] });
  assert.equal(textOf(byId(page, "evaluation-path-scope")), DEMO_PROGRESS_SCOPE);

  const home = await loadPage(HOME_PAGE, { storage: {} });
  t.after(() => home.restore());
  assert.equal(textOf(home.document.querySelector("#evaluation-path-scope")), DEMO_PROGRESS_SCOPE);

  // Reused rather than rewritten, and it deliberately does not repeat the
  // example-records caveat: shiplog-proof.test.js counts that caveat once above
  // the recorder, and a second occurrence in this region would red it.
  const region = byId(page, "evaluation-path");
  assert.doesNotMatch(textOf(region), /no customer or production data/);
  assert.match(textOf(region), /stay in this browser only/);
});

test("the seeded example records are not counted as this browser's progress", async (t) => {
  // The examples are read through at render time and never written, so a first
  // visitor must be shown the prerequisite with the demo records on screen.
  // An empty seed object takes the shipped examples (loadReleaseData falls back
  // to SEED_RELEASES for any half the caller does not name).
  const page = await openReleases(t, { seed: {} });
  assert.ok(page.document.querySelectorAll(".release-toggle").length > 0, "the seeded examples never rendered");
  assert.deepEqual(currentSteps(page), [DEMO_PROGRESS_STEPS[0]]);
  assert.equal(lead(page), DEMO_PROGRESS_PREREQUISITE);
});

test("malformed stored records paint the prerequisite instead of throwing", async (t) => {
  for (const storage of [
    { [STORAGE_KEY]: "{not json", [RELEASE_STORAGE_KEY]: "[{" },
    { [STORAGE_KEY]: JSON.stringify([null, 7, { id: 3 }]), [RELEASE_STORAGE_KEY]: "{}" },
    {},
  ]) {
    const page = await loadPage(RELEASES_PAGE, { storage });
    try {
      initReleasesPage(page.document, page.storage, {
        seed: NO_SEED,
        location: { pathname: "/releases.html", search: "", hash: "" },
        history: { replaceState() {} },
        readHealth: async () => { throw new Error("no network in tests"); },
      });
      assert.equal(items(page).length, 4, `the guide did not paint over ${JSON.stringify(storage)}`);
      assert.equal(lead(page), DEMO_PROGRESS_PREREQUISITE);
    } finally {
      page.restore();
    }
  }
});

// --- keyboard and narrow widths ----------------------------------------------

test("the guide's action is one tab stop, reached in reading order, and it navigates", async (t) => {
  const page = await openReleases(t, { decisions: [DECISION] });
  const sequence = tabSequence(page.document);
  const at = (node) => sequence.indexOf(node);
  assert.equal(sequence.filter((node) => node.getAttribute?.("id") === "evaluation-path-action").length, 1);
  // Reading order is tab order: the guide stands above the log, so its action
  // comes before the log's search and after the example record's own controls.
  assert.ok(at(action(page)) > at(byId(page, "shiplog-proof-copy")), "the action precedes the example record it follows");
  assert.ok(at(action(page)) < at(byId(page, "release-search")), "the action comes after the log it stands above");

  let reached = null;
  for (let press = 0; press < sequence.length && reached !== action(page); press += 1) {
    reached = pressTab(page.document);
  }
  assert.ok(reached === action(page), "the guide's action is not reachable by Tab");
  pressEnter(page.document);
  assert.deepEqual(page.navigations, [LINKED_DECISIONS_HREF]);
});

test("the guide wraps down the page at a phone width instead of truncating", async () => {
  // The harness models no layout and nothing on this page reads matchMedia, so
  // the rules are what is pinned rather than a faked 390px viewport.
  const css = await readFile(CSS, "utf8");
  assert.match(css, /\.evaluation-path-status \{[^}]*display:block/);
  assert.match(css, /\.evaluation-path-step \{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.evaluation-path-next \{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.evaluation-path \{[^}]*overflow-wrap:anywhere/);
  const narrow = css.match(/@media\(max-width:520px\) \{ \.evaluation-path ol\{([^}]*)\}\.evaluation-path li\{([^}]*)\}\.evaluation-path-next \.text-link\{([^}]*)\} \}/);
  assert.ok(narrow, "no narrow-width rule for the demo guide on this page");
  assert.match(narrow[2], /display:block/);
  assert.match(narrow[3], /white-space:normal/);
  assert.match(narrow[3], /overflow-wrap:anywhere/);
  // Nothing here truncates: no ellipsis and no single-line clamp on the steps.
  assert.doesNotMatch(css, /\.evaluation-path[^{]*\{[^}]*text-overflow/);
  assert.doesNotMatch(css, /\.evaluation-path[^{]*\{[^}]*white-space:nowrap/);
});
