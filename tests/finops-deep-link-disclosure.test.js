// Deep links into the AI FinOps page's progressive disclosure.
//
// The page now keeps benchmark, department, spend-mix, savings, and
// recommendation evidence behind native `details` blocks, and the guided-result
// index links straight into each one. That composition has exactly one way to
// go wrong for a reader, and it is the reason this file exists: a fragment
// whose target sits inside a closed disclosure resolves to something the
// browser is not rendering, so a copied `#recommendation-evidence` lands the
// reader at the top of the page with the evidence still collapsed.
//
// Three moments are covered because the browser treats them as three different
// things and only one of them is a click: a cold load with the fragment already
// in the address bar, a `hashchange` from a pasted URL or a back button, and an
// in-page link activation. The guided-flow assertions after them pin the
// composition those links navigate: one primary import choice, one clearly
// synthetic alternative, and every supporting panel behind a disclosure in the
// rank order the contract declares.
//
// Markup is the shipped page, and every fixture is built here rather than
// committed.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  enclosingDisclosures, fragmentId, installDeepLinkDisclosure, revealFragmentTarget,
} from "../src/deep-link-disclosure.js";
import { SUPPORT_DISCLOSURES } from "../src/finops-guided-result.js";
import { PANELS_BY_ID } from "../src/finops-panel-contract.js";
import { applyDisclosureRoles } from "../src/finops-guided-result-view.js";
import { DomEvent, parseHtml, tabSequence } from "./support/browser.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

async function page() {
  return parseHtml(await readFile(PAGE, "utf8"));
}

/**
 * A window with a real listener registry.
 *
 * The page harness ships a no-op `addEventListener`, which would let a broken
 * wiring pass silently. This is the smallest thing that cannot: a hash, a
 * registry, and a `hashchange` that actually calls what registered for it.
 */
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
    /** Move the address bar and fire what a browser would fire. */
    navigateTo(next) {
      this.location.hash = next;
      for (const handler of [...(listeners.get("hashchange") ?? [])]) handler();
    },
    listenerCount(type) { return (listeners.get(type) ?? []).length; },
  };
}

/** Record scrolls without a layout engine: the harness stub reports nothing. */
function watchScroll(node) {
  const calls = [];
  node.scrollIntoView = (options) => calls.push(options ?? null);
  return calls;
}

// ---------------------------------------------------------------------------
// The rule itself.
// ---------------------------------------------------------------------------

test("a fragment names an element, or honestly names nothing", () => {
  assert.equal(fragmentId("#recommendation-evidence"), "recommendation-evidence");
  assert.equal(fragmentId("recommendation-evidence"), "recommendation-evidence");
  assert.equal(fragmentId("#spend%2Dmix-panel"), "spend-mix-panel");
  for (const empty of ["", "#", null, undefined]) assert.equal(fragmentId(empty), null);
  // A hand-typed escape that cannot be decoded is a fragment, not a crash: the
  // rest of the page still has to boot.
  assert.equal(fragmentId("#100%"), "100%");
});

test("enclosing disclosures are reported outermost first", async () => {
  const doc = await page();
  const outer = doc.createElement("details");
  const inner = doc.createElement("details");
  const leaf = doc.createElement("p");
  leaf.id = "nested-leaf";
  outer.append(inner);
  inner.append(leaf);
  doc.getElementById("main-content").append(outer);

  assert.deepEqual(enclosingDisclosures(leaf), [outer, inner]);
  assert.deepEqual(enclosingDisclosures(outer), []);
});

test("revealing a target opens every disclosure enclosing it, outermost first", async () => {
  const doc = await page();
  const target = doc.getElementById("recommendation-evidence");
  const wrapper = doc.getElementById("disclosure-recommendation-evidence");
  assert.ok(wrapper, "the recommendation evidence panel ships behind a disclosure");
  assert.equal(wrapper.hasAttribute("open"), false, "it ships closed");
  const scrolls = watchScroll(target);

  const revealed = revealFragmentTarget(doc, "#recommendation-evidence");

  assert.equal(revealed.target, target);
  assert.deepEqual(revealed.opened, [wrapper]);
  assert.equal(wrapper.hasAttribute("open"), true, "the disclosure is open in the markup, not only in a property");
  assert.equal(doc.activeElement, target, "the reader's focus lands on what they were sent to");
  assert.equal(scrolls.length, 1, "and the page scrolls there, because the browser already failed to");
});

test("a nested target opens the whole chain and a second reveal is a no-op", async () => {
  const doc = await page();
  const outer = doc.createElement("details");
  const inner = doc.createElement("details");
  const leaf = doc.createElement("section");
  leaf.id = "buried-evidence";
  outer.append(inner);
  inner.append(leaf);
  doc.getElementById("main-content").append(outer);

  const first = revealFragmentTarget(doc, "#buried-evidence");
  assert.deepEqual(first.opened, [outer, inner]);

  // Idempotent: opening what is already open would fight a reader who closed
  // an inner block on purpose and then re-clicked the same link.
  const second = revealFragmentTarget(doc, "#buried-evidence");
  assert.deepEqual(second.opened, []);
  assert.equal(second.target, leaf);
});

test("a hidden panel is revealed by state, never by a fragment", async () => {
  const doc = await page();
  const guided = doc.getElementById("guided-result");
  assert.equal(guided.hidden, true, "the guided result ships hidden until it is composed");

  const revealed = revealFragmentTarget(doc, "#guided-result");

  assert.equal(revealed.target, guided);
  assert.equal(guided.hidden, true,
    "a fragment must not force an empty panel on screen and call it a result");
});

test("an unknown fragment is not an error", async () => {
  const doc = await page();
  assert.equal(revealFragmentTarget(doc, "#no-such-panel"), null);
  assert.equal(revealFragmentTarget(doc, ""), null);
  assert.equal(revealFragmentTarget(null, "#kpi-row"), null);
});

test("a focusable target keeps its own focus behaviour and no stray tab stop appears", async () => {
  const doc = await page();
  const before = tabSequence(doc).length;

  revealFragmentTarget(doc, "#kpi-row");

  const panel = doc.getElementById("kpi-row");
  assert.equal(panel.getAttribute("tabindex"), "-1",
    "a section is made programmatically focusable, the standard skip-target idiom");
  assert.equal(tabSequence(doc).length, before,
    "and tabindex=-1 keeps it out of the sequential tab order");
});

// ---------------------------------------------------------------------------
// The three moments a browser resolves a fragment.
// ---------------------------------------------------------------------------

test("an initial load with a fragment opens the disclosure before scrolling", async () => {
  const doc = await page();
  const win = fakeWindow("#savings-portfolio-panel");
  const wrapper = doc.getElementById("disclosure-savings-portfolio");
  const scrolls = watchScroll(doc.getElementById("savings-portfolio-panel"));

  installDeepLinkDisclosure(doc, win);

  assert.equal(wrapper.hasAttribute("open"), true,
    "a reload with the fragment already in the address bar reveals its target");
  assert.equal(scrolls.length, 1);
  assert.equal(win.listenerCount("hashchange"), 1);
});

test("an initial load with no fragment opens nothing", async () => {
  const doc = await page();
  installDeepLinkDisclosure(doc, fakeWindow(""));
  for (const wrapper of doc.querySelectorAll("details.support-disclosure")) {
    assert.equal(wrapper.hasAttribute("open"), false,
      `${wrapper.id} must stay closed when nothing asked for it`);
  }
});

test("a hashchange opens the newly targeted disclosure", async () => {
  const doc = await page();
  const win = fakeWindow("");
  installDeepLinkDisclosure(doc, win);

  win.navigateTo("#department-decision-panel");
  assert.equal(doc.getElementById("disclosure-department-priority").hasAttribute("open"), true);

  // Back-and-forth between two fragments leaves both open rather than closing
  // the one the reader just read.
  win.navigateTo("#spend-mix-panel");
  assert.equal(doc.getElementById("disclosure-spend-mix").hasAttribute("open"), true);
  assert.equal(doc.getElementById("disclosure-department-priority").hasAttribute("open"), true);
});

test("a hashchange into a saved-briefing control still reaches it behind the import disclosure", async () => {
  const doc = await page();
  const win = fakeWindow("");
  installDeepLinkDisclosure(doc, win);

  win.navigateTo("#reopen-briefing-file");

  assert.equal(doc.getElementById("import-alternatives").hasAttribute("open"), true,
    "reopening a saved briefing survives being moved behind the disclosure");
  assert.equal(doc.activeElement.id, "reopen-briefing-file");
});

test("clicking an in-page link reveals the target and still navigates", async () => {
  const doc = await page();
  const win = fakeWindow("");
  installDeepLinkDisclosure(doc, win);

  const link = doc.querySelector(".proof-point-link");
  assert.equal(link.getAttribute("href"), "#recommendation-evidence");
  link.click();

  assert.equal(doc.getElementById("disclosure-recommendation-evidence").hasAttribute("open"), true,
    "the disclosure opens before the browser navigates, not after");
  assert.deepEqual(doc.navigations, ["#recommendation-evidence"],
    "the default is never prevented: the address bar must hold the link a reader copies");
});

test("a link out of the page is left entirely alone", async () => {
  const doc = await page();
  const win = fakeWindow("");
  installDeepLinkDisclosure(doc, win);

  const away = doc.querySelector(".nav-social");
  away.click();

  assert.deepEqual(doc.navigations, ["/social.html"]);
  for (const wrapper of doc.querySelectorAll("details.support-disclosure")) {
    assert.equal(wrapper.hasAttribute("open"), false);
  }
});

test("teardown removes every handler it added", async () => {
  const doc = await page();
  const win = fakeWindow("");
  const teardown = installDeepLinkDisclosure(doc, win);
  teardown();

  win.navigateTo("#spend-mix-panel");
  assert.equal(win.listenerCount("hashchange"), 0);
  assert.equal(doc.getElementById("disclosure-spend-mix").hasAttribute("open"), false);
});

test("a window without listeners is survivable rather than fatal", async () => {
  const doc = await page();
  assert.doesNotThrow(() => installDeepLinkDisclosure(doc, {})());
});

// ---------------------------------------------------------------------------
// The guided flow those links navigate.
// ---------------------------------------------------------------------------

test("the import panel offers one primary choice and one synthetic alternative", async () => {
  const doc = await page();
  const controls = doc.querySelector(".local-import-controls");
  const alternatives = doc.getElementById("import-alternatives");
  assert.ok(alternatives, "the other ways to start ship behind one disclosure");
  assert.equal(alternatives.hasAttribute("open"), false);

  // Every control a visitor meets before they have imported anything, ignoring
  // the ones the flow reveals afterwards — the remap and return-to-example
  // buttons, and the two file-error recovery actions, all ship hidden.
  const onScreen = (node) => {
    for (let entry = node; entry?.nodeType === 1; entry = entry.parentNode) {
      if (entry.hidden) return false;
    }
    return true;
  };
  const firstStep = controls.querySelectorAll("input,button,select")
    .filter((node) => onScreen(node) && !enclosingDisclosures(node).length);
  const ids = firstStep.map((node) => node.id);
  assert.deepEqual(ids, ["local-finops-files", "try-example-dataset"],
    "exactly one import choice, plus the labelled way in for a visitor with no export");

  const example = doc.getElementById("try-example-dataset");
  assert.match(example.textContent, /Bundled synthetic example/,
    "the synthetic path says what it is in the control, not only in a note beside it");

  // The three starters that used to compete with the picker are all still here,
  // and all still reachable.
  for (const id of ["download-query-sample-example", "download-conversation-example", "reopen-briefing-file"]) {
    const node = doc.getElementById(id);
    assert.ok(node, `${id} must survive the recomposition`);
    assert.deepEqual(enclosingDisclosures(node).map((entry) => entry.id), ["import-alternatives"]);
  }
});

test("every supporting capability sits behind a disclosure, in declared rank order", async () => {
  const doc = await page();
  const wrappers = doc.querySelectorAll("details.support-disclosure");
  assert.ok(wrappers.length >= SUPPORT_DISCLOSURES.length - 3,
    "each supporting panel, or the block it shares, ships behind a disclosure");

  for (const wrapper of wrappers) {
    assert.equal(wrapper.hasAttribute("open"), false, `${wrapper.id} ships closed`);
    const summary = wrapper.querySelector("summary");
    assert.ok(summary, `${wrapper.id} has a summary`);
    // A word, not only a triangle: the step and the question are both text.
    assert.ok(summary.querySelector(".support-disclosure-step"));
    assert.match(summary.querySelector(".support-disclosure-question").textContent, /\S/);
  }

  // The reading order of the page and the opening order the guided index
  // publishes are the same order. They are allowed to disagree in exactly one
  // way — a panel whose card lives inside another panel's block.
  const declared = [...SUPPORT_DISCLOSURES].sort((left, right) => left.rank - right.rank);
  const ranked = declared
    .map((entry) => doc.querySelector(`[data-panel-id="${entry.panelId}"]`))
    .filter(Boolean);
  const documentOrder = wrappers.filter((wrapper) => ranked.includes(wrapper));
  assert.deepEqual(ranked.map((node) => node.id), documentOrder.map((node) => node.id),
    "supporting disclosures appear in the order the contract says to open them");
});

test("the declared rank is painted onto the block that owns it", async () => {
  const doc = await page();
  const disclosures = [...SUPPORT_DISCLOSURES]
    .sort((left, right) => left.rank - right.rank)
    .map((entry) => ({
      ...entry,
      elementId: PANELS_BY_ID[entry.panelId].elementId,
      question: PANELS_BY_ID[entry.panelId].question,
      permitted: true,
      unavailable: null,
    }));

  applyDisclosureRoles(doc, disclosures);

  const kpi = doc.getElementById("disclosure-spend-and-recovery");
  assert.equal(kpi.dataset.disclosureRank, "1");
  assert.equal(kpi.querySelector(".support-disclosure-step").textContent, "Step 1 of 8",
    "the KPI block wears the rank of the panel that owns it, not of the last card inside it");
  assert.equal(doc.getElementById("disclosure-recommendation-evidence").dataset.disclosureRank, "7");
  // The panels themselves keep the roles they already carried.
  assert.equal(doc.getElementById("kpi-row").dataset.panelRole, "support");
  assert.equal(doc.getElementById("score-card").dataset.panelRole, "primary");
});

test("an unanswerable supporting panel stays listed and stays openable", async () => {
  const doc = await page();
  applyDisclosureRoles(doc, [{
    rank: 7,
    panelId: "recommendation-evidence",
    elementId: "recommendation-evidence",
    question: PANELS_BY_ID["recommendation-evidence"].question,
    permitted: false,
    unavailable: { reason: "no evaluation records", need: "Recommendation evaluation records" },
  }]);

  const wrapper = doc.getElementById("disclosure-recommendation-evidence");
  assert.equal(wrapper.dataset.disclosurePermitted, "false");
  assert.equal(wrapper.hidden, false, "the question exists even when it cannot be answered");
  // And the deep link into it still works, which is the whole point of listing it.
  assert.ok(revealFragmentTarget(doc, "#recommendation-evidence"));
  assert.equal(wrapper.hasAttribute("open"), true);
});
