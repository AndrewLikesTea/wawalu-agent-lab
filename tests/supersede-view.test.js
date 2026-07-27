// The supersede link, from the view side: the banner on the decision that was
// replaced, the disclosure on the one that replaced it, and the history toggle.
//
// The render half runs against the element stub; the history half drives the
// shipped page markup through initDecisionLog, so the toggle, the header count,
// and the query string are asserted the way a user meets them.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { byClass, createElement, first, installDocument, tags, walk } from "./support/dom.js";
// Imported before the stub document is installed, the way the page-flow tests
// do it: app.js self-boots on import when a real document is present.
import { renderDecisionDetail } from "../src/decision-detail.js";
import { STORAGE_KEY, initDecisionLog } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { loadPage, tabSequence, pressTab, textOf } from "./support/browser.js";

installDocument();

const DECISIONS_PAGE = new URL("../src/index.html", import.meta.url);
const DEMO_ROUTE = "/releases-demo-data.json";
const NO_DEMO_DATA = { decisions: [], releases: [] };

const decision = (id, title, month, supersedes) => ({
  id,
  title,
  context: `Why ${id}`,
  alternatives: "",
  owner: "Kai",
  status: "approved",
  createdAt: `2026-0${month}-01T00:00:00.000Z`,
  ...(supersedes ? { supersedes } : {}),
});

const A = decision("a", "Poll the database", 1);
const B = decision("b", "Adopt a durable queue", 2, "a");
const C = decision("c", "Move the queue to the edge", 3, "b");
const CHAIN = [A, B, C];

const squash = (value) => value.replace(/\s+/g, " ").trim();
// The banner formats the successor's date in the reader's locale and zone, so
// the expectation is built the same way rather than pinned to one offset.
const onDate = (record) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(record.createdAt));

function render(target, decisions = CHAIN) {
  const container = createElement("div");
  renderDecisionDetail(container, target, { decisions });
  return container;
}

test("the superseded decision leads with exactly one status banner", () => {
  const container = render(A);
  const banners = byClass(container, "supersede-banner");

  assert.equal(banners.length, 1, "one banner, and no second inline note saying the same thing");
  assert.equal(banners[0].getAttribute("role"), "status");
  assert.equal(
    squash(banners[0].textContent),
    `Superseded by Adopt a durable queue on ${onDate(B)}`,
  );

  // It sits above the recorded context and alternatives, so the reader meets the
  // decision's standing before its reasoning.
  const view = first(container, "decision-detail");
  const order = view.children.map((child) => child.className);
  assert.ok(
    order.indexOf("supersede-banner") < order.indexOf("decision-context"),
    "the banner must precede the context section",
  );
  assert.ok(
    order.indexOf("supersede-banner") < order.indexOf("decision-alternatives"),
    "the banner must precede the alternatives section",
  );
  // Nothing else on the page repeats the announcement.
  assert.equal(
    walk(container, (node) => squash(node.ownText).startsWith("Superseded by")).length,
    1,
  );
});

test("the successor link is a real link to the successor decision", () => {
  const link = first(render(A), "supersede-link");

  // A native anchor with an href is in the tab order and activates on Enter;
  // that is the whole keyboard requirement, and it needs no script.
  assert.equal(link.tagName, "A");
  assert.equal(link.href, "/decision.html?id=b");
  assert.equal(link.textContent, "Adopt a durable queue");
});

test("the superseding decision shows a collapsed, quiet disclosure", () => {
  const container = render(C);

  assert.equal(byClass(container, "supersede-banner").length, 0, "C is current: no banner");
  const disclosure = first(container, "supersede-disclosure");
  assert.equal(disclosure.tagName, "DETAILS", "progressive disclosure, not an always-open panel");
  const summary = first(container, "supersede-disclosure-summary");
  assert.equal(summary.tagName, "SUMMARY");
  assert.equal(summary.textContent, "Replaces Adopt a durable queue");
  assert.equal(summary.getAttribute("aria-expanded"), "false", "it opens closed");
  // Quiet by design: it is not announced as an alert or a status message.
  assert.equal(disclosure.getAttribute("role"), null);
  assert.equal(summary.getAttribute("role"), null);
  assert.equal(first(container, "supersede-disclosure-body").children[0].href, "/decision.html?id=b");

  // Opening it keeps the announced state in step with the native one.
  disclosure.open = true;
  disclosure.dispatch("toggle");
  assert.equal(summary.getAttribute("aria-expanded"), "true");
});

test("the middle of a chain shows both sides of its one relationship", () => {
  const container = render(B);

  assert.equal(byClass(container, "supersede-banner").length, 1);
  assert.equal(
    squash(first(container, "supersede-banner").textContent),
    `Superseded by Move the queue to the edge on ${onDate(C)}`,
  );
  assert.equal(first(container, "supersede-disclosure-summary").textContent, "Replaces Poll the database");
});

test("a decision with no link either way renders neither element", () => {
  const container = render(decision("solo", "Stand alone", 1), [decision("solo", "Stand alone", 1)]);
  assert.equal(byClass(container, "supersede-banner").length, 0);
  assert.equal(byClass(container, "supersede-disclosure").length, 0);
});

test("markup in a title renders as text in the banner and the disclosure", () => {
  const hostile = '<script>alert(1)</script><img src=x onerror="alert(2)">';
  const attacker = decision("evil", hostile, 2, "a");
  const container = render(A, [A, attacker]);
  const banner = first(container, "supersede-banner");

  assert.equal(first(container, "supersede-link").textContent, hostile);
  assert.ok(banner.textContent.includes(hostile), "the payload is the visible text, verbatim");
  // Nothing was parsed into elements: no script, no img, anywhere in the render.
  assert.equal(tags(container, "SCRIPT").length, 0);
  assert.equal(tags(container, "IMG").length, 0);

  const replacing = render(attacker, [A, attacker]);
  assert.equal(
    first(replacing, "supersede-disclosure-summary").textContent,
    "Replaces Poll the database",
  );
  const evilPredecessor = render(decision("later", "Later", 3, "evil"), [attacker, decision("later", "Later", 3, "evil")]);
  assert.equal(
    first(evilPredecessor, "supersede-disclosure-summary").textContent,
    `Replaces ${hostile}`,
  );
  assert.equal(tags(evilPredecessor, "SCRIPT").length, 0);
  assert.equal(tags(evilPredecessor, "IMG").length, 0);
});

// The successor title has to stay readable at a narrow width. There is no
// layout engine in this repo's harness, so this asserts the shipped rule rather
// than a measured box: the banner text wraps and nothing clips it.
test("the banner wraps a long successor title instead of truncating it", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const rules = css.split("\n").filter((line) => line.startsWith(".supersede-"));
  assert.ok(rules.length > 0, "the supersede rules are missing from the stylesheet");

  assert.ok(
    rules.some((rule) => rule.startsWith(".supersede-banner-text") && rule.includes("overflow-wrap:anywhere")),
    "the banner text must wrap a long, unbroken title",
  );
  assert.ok(
    rules.some((rule) => rule.startsWith(".supersede-disclosure-summary") && rule.includes("overflow-wrap:anywhere")),
  );
  for (const rule of rules) {
    assert.doesNotMatch(rule, /text-overflow\s*:\s*ellipsis/, `${rule} truncates the title`);
    assert.doesNotMatch(rule, /white-space\s*:\s*nowrap/, `${rule} prevents the title from wrapping`);
  }
});

// --- the history filter, on the shipped page ------------------------------

async function openHistory(t, { decisions = CHAIN, search = "" } = {}) {
  const replaced = [];
  const page = await loadPage(DECISIONS_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(decisions),
      [RELEASE_STORAGE_KEY]: JSON.stringify([]),
    },
    routes: { [DEMO_ROUTE]: NO_DEMO_DATA },
    location: { search },
  });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage, {
    location: { pathname: "/", search, hash: "" },
    history: { replaceState: (state, title, url) => replaced.push(url) },
  });
  assert.equal(page.document.documentElement.dataset.shiplog, "ready");
  return { page, replaced };
}

const rowTitles = (page) => page.document.querySelector("#decision-list")
  .querySelectorAll(".history-card").map((card) => textOf(card.querySelector("h3")));
const toggle = (page) => page.document.querySelector("#filter-current-only");
const summaryText = (page) => textOf(page.document.querySelector("#history-supersede-summary"));

test("the current-only toggle hides superseded decisions and says what it hid", async (t) => {
  const { page, replaced } = await openHistory(t);
  assert.deepEqual(rowTitles(page), [
    "Move the queue to the edge",
    "Adopt a durable queue",
    "Poll the database",
  ]);
  assert.equal(toggle(page).getAttribute("aria-pressed"), "false");
  assert.equal(summaryText(page), "", "nothing is hidden yet, so nothing is claimed");

  toggle(page).click();

  assert.deepEqual(rowTitles(page), ["Move the queue to the edge"]);
  assert.equal(toggle(page).getAttribute("aria-pressed"), "true");
  assert.equal(summaryText(page), "1 current, 2 superseded hidden");
  assert.deepEqual(replaced, ["/?current=only"], "the filter is written into the query string");

  toggle(page).click();
  assert.equal(rowTitles(page).length, 3);
  assert.equal(toggle(page).getAttribute("aria-pressed"), "false");
  assert.equal(summaryText(page), "");
  assert.deepEqual(replaced, ["/?current=only", "/"]);
});

test("reopening the page with the filter in the URL restores it", async (t) => {
  const { page } = await openHistory(t, { search: "?current=only" });

  assert.equal(toggle(page).getAttribute("aria-pressed"), "true");
  assert.deepEqual(rowTitles(page), ["Move the queue to the edge"]);
  assert.equal(summaryText(page), "1 current, 2 superseded hidden");
});

test("clearing the filters releases the hidden decisions and the query string", async (t) => {
  const { page, replaced } = await openHistory(t, { search: "?current=only" });

  page.document.querySelector("#clear-decision-filters").click();

  assert.equal(toggle(page).getAttribute("aria-pressed"), "false");
  assert.equal(rowTitles(page).length, 3);
  assert.deepEqual(replaced, ["/"]);
});

test("the toggle is reachable and operable by keyboard alone", async (t) => {
  const { page } = await openHistory(t);
  const control = toggle(page);
  const stops = tabSequence(page.document).length + 1;
  for (let step = 0; step < stops && page.document.activeElement !== control; step += 1) {
    pressTab(page.document);
  }
  assert.equal(page.document.activeElement, control, "the toggle is not reachable by keyboard");
  assert.equal(textOf(control), "Current only");
});

test("a supersede link that no longer exists is refused inline, and nothing is written", async (t) => {
  const { page } = await openHistory(t);
  const form = page.document.querySelector("#decision-form");
  const supersedes = page.document.querySelector("#supersedes");

  // The recorder offers only decisions that exist, so this is the case that can
  // still go wrong: the chosen decision disappeared while the form was open.
  assert.deepEqual(
    supersedes.querySelectorAll("option").map((option) => option.getAttribute("value")),
    ["", "a", "b", "c"],
  );
  supersedes.value = "deleted-in-another-tab";
  page.document.querySelector("#title").value = "A later call";
  page.document.querySelector("#context").value = "Why this happened.";
  page.document.querySelector("#owner").value = "Mina";
  page.document.querySelector("#status").value = "approved";
  form.querySelector('button[type="submit"]').click();

  const error = page.document.querySelector("#supersedes-error");
  assert.equal(error.hidden, false, "the rejection is visible, not silent");
  assert.match(textOf(error), /not in this log/);
  assert.equal(supersedes.getAttribute("aria-invalid"), "true");
  assert.equal(rowTitles(page).length, 3, "the decision was not recorded");
  assert.deepEqual(
    JSON.parse(page.storage.getItem(STORAGE_KEY)).map((record) => record.id),
    ["a", "b", "c"],
    "storage is unchanged",
  );
});

test("recording a decision that replaces an existing one links both directions", async (t) => {
  const { page } = await openHistory(t);
  const form = page.document.querySelector("#decision-form");
  page.document.querySelector("#supersedes").value = "c";
  page.document.querySelector("#title").value = "Run the queue in region";
  page.document.querySelector("#context").value = "Latency across regions.";
  page.document.querySelector("#owner").value = "Mina";
  page.document.querySelector("#status").value = "approved";
  form.querySelector('button[type="submit"]').click();

  assert.equal(page.document.querySelector("#supersedes-error").hidden, true);
  const stored = JSON.parse(page.storage.getItem(STORAGE_KEY));
  const recorded = stored.find((record) => record.title === "Run the queue in region");
  assert.equal(recorded.supersedes, "c");
  // The record it replaced was not rewritten to point back.
  assert.deepEqual(stored.find((record) => record.id === "c"), C);

  toggle(page).click();
  assert.deepEqual(rowTitles(page), ["Run the queue in region"]);
  assert.equal(summaryText(page), "1 current, 3 superseded hidden");
});
