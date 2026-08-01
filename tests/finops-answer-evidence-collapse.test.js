// The answer opens; its evidence does not — and the trajectory is one press away.
//
// WHAT THESE ASSERTIONS ARE FOR.
//
//   * ONE OPEN REGION. src/finops-spine.js classifies exactly one region of
//     /evolution.html `answer` and every other one `evidence`. Until #742 that
//     was a claim the markup did not keep: three of the evidence regions opened
//     at the answer's weight, so a lead met a second and a third question before
//     finishing the first. The answer is first and open; the evidence layers
//     under it ship shut.
//   * SHUT IS NOT HIDDEN. Every layer is a native `details`/`summary`, so the
//     control is focusable, Enter and Space are the browser's, and the state a
//     screen reader announces is the `open` attribute rather than a class.
//   * ONE INTERACTION TO THE TRAJECTORY. The period-over-period comparison is
//     the second question a skeptic asks the headline, and it used to be two
//     presses away — switch destination, then unfold the panel it sits in. One
//     press on the answer's own control now does both, through the shell and
//     deep-link-disclosure.js that already ship, and lands the keyboard on the
//     view rather than beside it.
//
// No clock, no network, no sleeps.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, tabSequence, textOf } from "./support/browser.js";
import { installDeepLinkDisclosure } from "../src/deep-link-disclosure.js";
import { loadWorkspaceDestinations } from "../src/finops-destination-contract.js";
import { WORKSPACE_DESTINATION } from "../src/finops-workspace-nav.js";
import { initWorkspaceShell, workspaceRegions } from "../src/finops-workspace-shell.js";
import { FINOPS_SPINE, REGION_CLASS, answerRegionId } from "../src/finops-spine.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");

const doc = () => parseHtml(html);
const byId = (document, id) => document.getElementById(id);

/** `#main-content`'s own element children with an id, in document order. */
const topLevelIds = (document) => (byId(document, "main-content").children ?? [])
  .filter((node) => node?.nodeType === 1 && node.id).map((node) => node.id);

/** A window with a real listener registry, so a broken wiring cannot pass. */
function fakeWindow(hash = "") {
  const listeners = new Map();
  return {
    location: { hash },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== handler));
    },
  };
}

// ---------------------------------------------------------------------------
// 1. One region answers, and it is the only one open.
// ---------------------------------------------------------------------------

test("the answer follows only the h1 hero and is not itself a disclosure", () => {
  const document = doc();
  const answer = byId(document, answerRegionId());

  assert.deepEqual(topLevelIds(document).slice(0, 2), ["finops-hero", answerRegionId()],
    "the answer is not the first content region after the hero");
  assert.equal(answer.tagName, "SECTION",
    "the answer is behind a disclosure, so the page's one answer has to be asked for");
  assert.equal(answer.closest("details"), null,
    "the answer is nested inside a disclosure somewhere above it");
  assert.equal(answer.dataset.subordinate, undefined,
    "the answer is marked subordinate to something else");
});

test("all answer disclosures and both follow-on questions form one collapsed group", () => {
  const document = doc();
  const group = byId(document, "finops-stand-disclosures");
  assert.equal(group.getAttribute("role"), "group");
  assert.ok(group.getAttribute("aria-label")?.length > 0, "the disclosure group has no name");
  assert.ok(group.closest(`#${answerRegionId()}`), "the group is not attached to the answer region");

  // CONTAINED, NOT `aria-owns`ed. `aria-owns` re-parents a node in the
  // accessibility tree only: a virtual cursor would read the follow-ons inside
  // this group while Tab and the eye still found them a region further down, and
  // that is the announced-order/focus-order split this page refuses everywhere
  // else. So the assertion is DOM containment, and the absence of the shortcut.
  assert.equal(group.getAttribute("aria-owns"), null,
    "the group claims members it does not contain, so reading order leaves focus order behind");
  const members = group.children.filter((node) => node?.nodeType === 1);
  for (const id of ["disclosure-next-step", "disclosure-journey"]) {
    assert.ok(members.some((node) => node.id === id),
      `#${id} is not a member of the answer's one disclosure group`);
  }
  assert.ok(members.length >= 9,
    `the group holds ${members.length} controls; the six evidence disclosures and both follow-ons belong to it`);
  for (const details of members) {
    assert.equal(details.tagName, "DETAILS", `${details.id} in the group is not a native disclosure`);
    assert.equal(details.hasAttribute("open"), false, `${details.id} does not ship collapsed`);
  }
});

test("the group's headings sit under the answer's h2 rather than beside it", () => {
  const document = doc();
  // One h1 on the page, and it is the hero's. Inside the answer region the
  // answer's own question is the h2; every control folded under it — the six
  // evidence disclosures and both follow-ons — is an h3, so consolidating two
  // top-level regions into the answer did not put a second top rung inside it.
  const answer = byId(document, answerRegionId());
  assert.deepEqual(answer.querySelectorAll("h2").map((node) => node.id), ["finops-stand-question"],
    "a second h2 is authored inside the single answer region");
  for (const id of ["finops-next-step-question", "finops-journey-question"]) {
    const heading = byId(document, id);
    assert.equal(heading.tagName, "H3", `#${id} outranks the answer it now sits inside`);
    assert.ok(heading.closest(`#${answerRegionId()}`), `#${id} is not inside the answer region`);
  }
});

test("every evidence layer folded into a disclosure ships closed, and none is open", () => {
  const document = doc();
  const wrappers = document.querySelectorAll("details.support-disclosure");
  assert.ok(wrappers.length >= 8,
    `only ${wrappers.length} supporting layers ship as disclosures`);

  for (const wrapper of wrappers) {
    assert.equal(wrapper.hasAttribute("open"), false,
      `${wrapper.id} is open on load, so the answer is not the only open region`);
  }

  // The layers #742 folded, named rather than counted: a later pass that
  // silently unfolds one of them fails here rather than in a screenshot.
  for (const id of ["disclosure-next-step", "disclosure-journey"]) {
    const wrapper = byId(document, id);
    assert.ok(wrapper, `${id} is no longer on the page`);
    assert.equal(wrapper.tagName, "DETAILS", `${id} is not a native disclosure`);
    assert.equal(wrapper.hasAttribute("open"), false, `${id} ships open`);
    assert.equal(wrapper.dataset.spineClass ?? REGION_CLASS.evidence, REGION_CLASS.evidence);
    assert.equal(FINOPS_SPINE.regions[id], REGION_CLASS.evidence,
      `${id} is on the page but the spine does not classify it as evidence`);
  }
});

test("each folded layer names what a skeptic opens it to check, not a section label", () => {
  const document = doc();
  for (const id of ["disclosure-next-step", "disclosure-journey"]) {
    const summary = byId(document, id).querySelector("summary");
    const question = summary.querySelector(".support-disclosure-question");
    assert.ok(question, `${id} has no question on its control`);
    assert.match(textOf(question), /\?$/,
      `${id} opens on a label rather than a question: "${textOf(question)}"`);
    // The accessible name of the control is its own visible text, and the
    // control is the summary itself — no button inside it to steal the focus.
    // A native `summary` is focusable and Enter/Space-operable with no script,
    // and it stays that way only while nothing takes it out of the tab order.
    assert.equal(summary.querySelector("button"), null,
      `${id} puts a button inside its summary, so Enter and Space stop being the browser's`);
    assert.equal(summary.tagName, "SUMMARY");
    assert.equal(summary.getAttribute("tabindex"), null,
      `${id}'s control was taken out of the natural tab order`);
    assert.equal(summary.hidden, false, `${id}'s control is hidden`);
  }
});

test("a folded layer keeps its own synthetic marker, and the answer carries one above every number", () => {
  const document = doc();
  const marker = byId(document, "finops-stand-sample");

  assert.ok(marker, "the answer carries no synthetic-data marker");
  assert.ok(marker.closest(`#${answerRegionId()}`), "the marker is not on the answer region");
  assert.match(textOf(marker), /Bundled synthetic example/);
  // Above every number in the answer: source order is reading order here, so
  // the marker is authored before the first figure slot rather than beside it.
  assert.ok(html.indexOf('id="finops-stand-sample"')
    < html.indexOf('id="finops-stand-position-value"'),
    "a reader meets the first figure before the disclaimer that qualifies it");

  // And a reader who opens a layer lands inside it, so the layer keeps its own.
  for (const [id, markerId] of [["disclosure-next-step", "finops-next-step-sample"],
    ["disclosure-journey", "finops-journey-sample"]]) {
    assert.equal(byId(document, markerId).closest(`#${id}`)?.id, id,
      `${id} lost the marker that says whose figures it holds`);
  }
});

// ---------------------------------------------------------------------------
// 2. The trajectory view, one press from the answer.
// ---------------------------------------------------------------------------

test("the trajectory control lives on the answer and is a real anchor with a real href", () => {
  const document = doc();
  const control = byId(document, "finops-stand-trajectory");

  assert.ok(control, "the answer carries no route to the period comparison");
  assert.equal(control.tagName, "A");
  assert.equal(control.getAttribute("href"), "#trend-title",
    "the control does not point at the trajectory view this page already ships");
  assert.equal(control.closest(`#${answerRegionId()}`)?.id, answerRegionId(),
    "the trajectory control is not on the answer region");
  assert.ok(tabSequence(document).includes(control),
    "the trajectory control is not reachable by keyboard");
  assert.ok(byId(document, "trend-title"), "the trajectory view is no longer on the page");
});

test("one press on the answer's trajectory control opens the view and lands the keyboard in it", () => {
  const document = doc();
  const win = fakeWindow("");
  // Exactly the order the shipped entry uses: the shell first, so the
  // destination is on screen before anything moves focus into it.
  initWorkspaceShell(document, { win, loaded: loadWorkspaceDestinations() });
  installDeepLinkDisclosure(document, win);

  const trajectory = byId(document, "trend-title");
  const panel = byId(document, "disclosure-department-priority");
  assert.equal(panel.hasAttribute("open"), false, "the panel was already open before the press");

  byId(document, "finops-stand-trajectory").click();

  // One interaction did all three: the destination that owns the view, the
  // disclosure it sits inside, and the keyboard.
  const active = workspaceRegions(document)
    .filter((region) => region.dataset.workspaceActive === "true")
    .map((region) => region.dataset.workspaceRegion);
  assert.deepEqual([...new Set(active)], [WORKSPACE_DESTINATION.department],
    "the press did not bring up the destination that owns the trajectory view");
  assert.equal(panel.hasAttribute("open"), true,
    "the press left the trajectory view folded inside a closed disclosure");
  assert.equal(document.activeElement, trajectory,
    "the press did not land the keyboard on the trajectory view");
});
