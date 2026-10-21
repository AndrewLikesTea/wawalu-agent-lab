// The observatory's ask follows its proof (#2884): a visitor meets the "Merged
// pull requests" figure and both "Count the merged pull requests yourself"
// links before "Request a Shiplog demonstration" and "Discuss a Shiplog pilot".
// The row used to sit in the introduction, directly under the hero copy.
//
// HARNESS NOTES: no descendant, comma or `*` selectors, so order is read off a
// children walk that keeps only nodes with getAttribute (text nodes sit in
// `children` too); nothing is compared against an element node with
// assert.equal; the harness models no layout, so order is DOM order.

import assert from "node:assert/strict";
import test from "node:test";
import { loadActivity, refreshDemoData } from "../src/agents.js";
import { ASK_ABOUT_SHIPLOG_ACTIONS } from "../src/ask-about-shiplog.js";
import { FOLLOW_UP_TOPICS } from "../src/leads.js";
import { initSiteFooter } from "../src/site-footer.js";
import { importPageModule } from "./support/page-module.js";
import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";

const OBSERVATORY = new URL("../src/agents.html", import.meta.url);
const COUNT_LINK = /^Count the merged pull requests yourself in the AndrewLikesTea\/[\w-]+ public GitHub event feed$/;
const settle = async () => { for (let tick = 0; tick < 4; tick += 1) await Promise.resolve(); };

// Every element on the page, in document order.
function elementsInOrder(document) {
  const out = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (typeof child.getAttribute !== "function") continue;
      out.push(child);
      walk(child);
    }
  };
  walk(document.body);
  return out;
}

// The page as painted: both loaders settled (every route refused) and the
// footer wired, so a runtime move of the row would show here.
async function paintedObservatory(t) {
  const page = await loadPage(OBSERVATORY, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;
  initSiteFooter(document);
  await refreshDemoData(document);
  await loadActivity(document);
  await settle();
  return document;
}

test("the merged pull request figure and its count links come before the ask row, which comes once before About Shiplog", async (t) => {
  const document = await paintedObservatory(t);
  const order = elementsInOrder(document);
  const at = (id) => order.findIndex((node) => node.getAttribute("id") === id);

  const counts = order.filter((node) => node.tagName === "A" && COUNT_LINK.test(textOf(node)));
  assert.equal(counts.length, 2, `${counts.length} count-it-yourself links`);
  const rows = order.filter((node) => node.getAttribute("id") === "ask-about-shiplog-actions");
  assert.equal(rows.length, 1, `the ask row is painted ${rows.length} times`);
  for (const intent of Object.keys(ASK_ABOUT_SHIPLOG_ACTIONS)) {
    assert.equal(order.filter((node) => node.getAttribute("data-follow-up-intent") === intent).length, 1,
      `the ${intent} action is painted more than once`);
  }

  const row = at("ask-about-shiplog-actions");
  const lastCount = Math.max(...counts.map((link) => order.indexOf(link)));
  assert.ok(at("merged-figure") < row, "the figure is read after the ask");
  assert.equal(textOf(document.querySelector("#merged-figure-title")), "Merged pull requests");
  assert.ok(lastCount < row, "a count-it-yourself link is read after the ask");
  assert.ok(row < at("ask-about-shiplog-demo") && row < at("ask-about-shiplog-pilot"));

  // Inside <main>, straight after the figure's hero, before the activity and
  // well before the footer's About Shiplog band.
  let landmark = rows[0].parentNode;
  while (landmark && landmark.tagName !== "MAIN") landmark = landmark.parentNode;
  assert.equal(landmark?.getAttribute("id"), "main-content", "the ask row left <main>");
  assert.equal(rows[0].parentNode.getAttribute("id"), "main-content");
  assert.equal(document.querySelector(".observatory-hero").querySelectorAll("#ask-about-shiplog").length, 0,
    "the ask is still in the introduction");
  assert.ok(row < order.findIndex((node) => node.classList?.contains("observatory-grid")),
    "the ask follows the remaining evidence instead of the number");
  assert.equal(textOf(document.querySelector("#site-footer-title")), "About Shiplog");
  assert.ok(row < at("site-footer-title"), "the ask is read after the About Shiplog band");
});

test("the hero still reads eyebrow, title, lab identity, as one contiguous block", async (t) => {
  const page = await loadPage(OBSERVATORY);
  t.after(() => page.restore());
  const title = page.document.querySelector("#page-title");
  const lead = title.parentNode.children.filter((node) => typeof node.getAttribute === "function");
  assert.deepEqual(lead.map((node) => node.tagName), ["P", "H1", "P", "P"],
    "something now sits inside the hero's block beside the heading");
  assert.equal(textOf(lead[0]), "Synthetic engineering team");
  assert.equal(textOf(lead[1]), "Agent observatory");
  assert.equal(lead[3].getAttribute("id"), "lab-identity");
  assert.equal(textOf(lead[3]), "A separate lab tool, not part of Shiplog, the decision and release log.");
});

test("Tab reaches both count links before the demonstration and pilot actions", async (t) => {
  const document = await paintedObservatory(t);
  const sequence = tabSequence(document);
  const counts = sequence.filter((node) => node.tagName === "A" && COUNT_LINK.test(textOf(node)));
  assert.equal(counts.length, 2, "the count links are not both tab stops");
  const stop = (id) => sequence.findIndex((node) => node.getAttribute("id") === id);
  const route = stop("ask-about-shiplog");
  assert.ok(route >= 0, "the ask route is not a tab stop");
  assert.deepEqual([stop("ask-about-shiplog-demo"), stop("ask-about-shiplog-pilot")], [route + 1, route + 2],
    "the demonstration and pilot actions no longer follow the route");
  for (const link of counts) {
    assert.ok(sequence.indexOf(link) < route, `${textOf(link)} is reached after the ask`);
  }
});

for (const [intent, label] of Object.entries(ASK_ABOUT_SHIPLOG_ACTIONS)) {
  for (const activation of ["keyboard", "click"]) {
    test(`"${label}" by ${activation}, from its new place, lands in the follow-up form about this page`, async (t) => {
      const page = await loadPage(OBSERVATORY);
      t.after(() => page.restore());
      const { document } = page;
      await importPageModule("/ask-about-shiplog-page.js");
      initSiteFooter(document, async () => new Response("{}", { status: 201 }));

      const action = document.getElementById(`ask-about-shiplog-${intent}`);
      assert.equal(textOf(action), label);
      action.focus();
      if (activation === "keyboard") pressEnter(document);
      else action.click();

      const form = document.getElementById("site-footer-form");
      // #2962: the answer is preselected; focus goes to the field left to fill.
      assert.equal(document.activeElement?.getAttribute("id"), "site-footer-email");
      const checked = form.querySelectorAll('input[name="intent"]').filter((radio) => radio.checked);
      assert.deepEqual(checked.map((radio) => radio.value), [intent]);
      assert.equal(form.dataset.followUpTopic, FOLLOW_UP_TOPICS.follow_up_agents);
      assert.equal(textOf(document.querySelector("#site-footer-topic-note")),
        `This request is sent about the ${FOLLOW_UP_TOPICS.follow_up_agents}.`);
    });
  }
}
