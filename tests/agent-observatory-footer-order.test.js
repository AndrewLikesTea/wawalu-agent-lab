// The observatory's footer, in the order Social, People, Prompt coach and
// Releases already give it (#2470): About Shiplog ending on its evaluation-brief
// link, then the follow-up block, then the folded map of destinations last.
//
// It used to read About → nine open destination links → form, because its row
// in FOOTER_VARIANT (tests/site-footer.test.js) carried every task-page flag but
// `collapsedDemos`. That table and tests/footer-directory-order.test.js now hold
// the shape; this file holds it on the page as painted, after the observatory's
// own loaders and the footer wiring have run, so a runtime move would show here.
//
// HARNESS NOTES: nothing is compared against an element node; text nodes sit in
// `children`, so walks keep only nodes with getAttribute; a closed details
// element's rows stay in tabSequence, so they are dropped by a parentNode walk.

import assert from "node:assert/strict";
import test from "node:test";
import { loadActivity, refreshDemoData } from "../src/agents.js";
import {
  ASSETS_DESCRIPTION, ASSETS_LINK_LABEL, DEMOS, DIRECTORY_SUMMARY, INVITATION, initSiteFooter,
} from "../src/site-footer.js";
import { loadPage, pressTab, tabSequence, textOf } from "./support/browser.js";

const OBSERVATORY = new URL("../src/agents.html", import.meta.url);
const settle = async () => { for (let tick = 0; tick < 4; tick += 1) await Promise.resolve(); };

// Byte-exact on purpose: the topic and the intents are a two-sided contract with
// the endpoint, and moving the block must not have touched a character of them.
const TOPIC_SENTENCE = "This request is sent about the Agent observatory page — watch a synthetic engineering team build and review work.";
const INTENTS = ["Availability or pricing", "A product demonstration", "A pilot evaluation", "Security or data handling"];

async function paintedObservatory(t) {
  const page = await loadPage(OBSERVATORY, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;
  initSiteFooter(document);
  // Every route is refused, so both loaders settle onto their error states.
  await refreshDemoData(document);
  await loadActivity(document);
  await settle();
  return document;
}

// Every element of the band, in document order.
function bandElements(document) {
  const out = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (typeof child.getAttribute !== "function") continue;
      out.push(child);
      walk(child);
    }
  };
  walk(document.querySelector(".site-footer-inner"));
  return out;
}

function insideDirectory(node) {
  const from = node?.tagName === "SUMMARY" ? node.parentNode : node;
  for (let current = from?.parentNode; current; current = current.parentNode) {
    if (current.getAttribute?.("id") === "site-footer-directory") return true;
  }
  return false;
}

const isDestination = (node) => node.tagName === "A" && DEMOS.some((demo) => demo.href === node.getAttribute("href"))
  && insideDirectory(node);

test("the observatory reads About, then the follow-up form, then the destinations", async (t) => {
  const document = await paintedObservatory(t);
  const band = bandElements(document);
  const indexOf = (predicate) => band.findIndex(predicate);

  const assets = indexOf((node) => node.getAttribute("id") === "site-footer-assets");
  const invitation = indexOf((node) => node.getAttribute("class") === "site-footer-invitation");
  const panel = indexOf((node) => node.getAttribute("id") === "site-footer-panel");
  const submit = indexOf((node) => node.tagName === "BUTTON" && textOf(node) === "Request a follow-up");
  const summary = indexOf((node) => node.getAttribute("id") === "site-footer-directory-summary");
  const links = band.map((node, index) => (isDestination(node) ? index : -1)).filter((index) => index >= 0);

  assert.equal(textOf(band[assets]), ASSETS_LINK_LABEL, "the About block's last link changed");
  // (a) The follow-up block is the very next thing after the About block. Since
  // #2540 that link is followed by the one sentence saying what the two
  // documents hold, which is part of the About block and not of the form.
  assert.equal(textOf(band[assets + 1]), ASSETS_DESCRIPTION,
    "the sentence describing the brief and the scorecard left the link it belongs to");
  assert.equal(invitation, assets + 2, "something sits between the About block and the follow-up block");
  assert.equal(textOf(band[invitation]), INVITATION);
  assert.equal(panel, invitation + 1);
  assert.equal(band.slice(assets, panel).filter((node) => node.tagName === "A").length, 1,
    "a destination link still sits between the About block and the form");
  // (b) The heading and its nine links come after the submit control.
  assert.ok(submit > panel, "the submit control left the panel");
  assert.ok(summary > submit, "the destinations heading is read before the follow-up action");
  assert.equal(links.length, DEMOS.length, "the map lost or gained a destination");
  assert.ok(links.every((index) => index > summary), "a destination link sits above its heading");
  assert.deepEqual(links.map((index) => textOf(band[index])), DEMOS.map((demo) => demo.label));
  assert.equal(document.querySelectorAll(".site-footer-demos").length, 1, "two destination lists");
  // (c) The list has the heading the other four pages give it.
  assert.equal(textOf(band[summary]), DIRECTORY_SUMMARY);
  assert.equal(textOf(band[summary]), `Where else to go on Shiplog — all ${DEMOS.length} destinations`);
});

test("moving the block left the observatory's request contract byte for byte", async (t) => {
  const document = await paintedObservatory(t);
  const form = document.querySelector("#site-footer-form");
  // (d) The same topic, sentence, four intents and work-email field.
  assert.equal(form.getAttribute("data-follow-up-type"), "follow_up_agents");
  assert.equal(form.getAttribute("data-follow-up-topic"),
    "Agent observatory page — watch a synthetic engineering team build and review work");
  assert.equal(textOf(document.querySelector("#site-footer-topic-note")), TOPIC_SENTENCE);
  const radios = Array.from(document.querySelectorAll('input[name="intent"]'));
  assert.deepEqual(radios.map((radio) => textOf(document.querySelector(`label[for="${radio.getAttribute("id")}"]`))), INTENTS);
  const email = document.querySelector("#site-footer-email");
  assert.equal(email.getAttribute("type"), "email");
  assert.equal(email.getAttribute("name"), "email");
  assert.equal(textOf(document.querySelector('label[for="site-footer-email"]')), "Work email for your follow-up");
  assert.equal(document.querySelectorAll('input[type="email"]').length, 1, "a second work-email field appeared");
});

test("Tab from the evaluation-brief link lands in the form before any destination", async (t) => {
  const document = await paintedObservatory(t);
  // (e) As a browser gives it: a closed details element's rows are no stops.
  const directory = document.querySelector("#site-footer-directory");
  assert.ok(!directory.open, "the destinations must ship folded, like the other four pages");
  const stops = tabSequence(document).filter((stop) => !insideDirectory(stop));
  const assets = stops.findIndex((stop) => stop.getAttribute("id") === "site-footer-assets");
  assert.ok(assets >= 0, "the evaluation-brief link is not a tab stop");
  assert.equal(stops[assets + 1].getAttribute("id"), "site-footer-intent-availability_pricing",
    "the next stop after the About block is not the form's first control");

  document.querySelector("#site-footer-assets").focus();
  assert.equal(pressTab(document).getAttribute("id"), "site-footer-intent-availability_pricing",
    "Tab from the About block's last link skipped the form");
  const submit = stops.findIndex((stop) => stop.tagName === "BUTTON" && textOf(stop) === "Request a follow-up");
  const summary = stops.findIndex((stop) => stop.getAttribute("id") === "site-footer-directory-summary");
  assert.ok(assets < submit && submit < summary, "the destinations are reached before the follow-up action");
  assert.equal(summary, stops.length - 1, "the destinations heading is not the page's last stop");
});
