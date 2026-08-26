// Linking a release to the decision that governs it (issue #694).
//
// Three layers, matching how src/releases.js is split and how the page boots.
// The pure core — the rationale preview, which association governs, and the
// decision filter's query-string round trip — is asserted directly. The
// rendered release view is checked through the element stub. The parts a
// keyboard user feels are driven through the shipped markup: choosing the
// governing decision in the recorder, narrowing the releases to one decision
// with the arrow keys, and reopening that narrowed view from a URL.
//
// Determinism: no network, no timers, no sleeps. Every test seeds its own
// fixtures; nothing depends on the shipped example records.

import test from "node:test";
import assert from "node:assert/strict";
import { STORAGE_KEY } from "../src/app.js";
import {
  ALL_DECISIONS_FILTER,
  DECISION_FILTER_PARAM,
  GOVERNING_DECISION_HEADING,
  GOVERNING_DECISION_MISSING_TEXT,
  NO_RATIONALE_TEXT,
  RATIONALE_PREVIEW_LENGTH,
  RELEASE_STORAGE_KEY,
  decisionFilterSearch,
  decisionIdFilter,
  decisionRationalePreview,
  filterReleases,
  governingAssociation,
  matchesDecisionId,
  readDecisionFilter,
  releaseFiltersActive,
  renderReleaseDetail,
  resolveReleaseDetail,
} from "../src/releases.js";
import { selectionSummaryText } from "../src/release-form.js";
import { initReleasesPage } from "../src/releases-page.js";
import { createElement, first, byClass, installDocument } from "./support/dom.js";
import { DomEvent, loadPage, pressKey, pressSpace, textOf } from "./support/browser.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);

const DECISIONS = [
  {
    id: "d-queue",
    title: "Adopt a durable job queue",
    context: "Background work was lost on every deploy, and the retry story was a runbook step nobody ran.",
    alternatives: "Database polling.",
    owner: "Kai",
    status: "accepted",
    createdAt: "2026-02-01T00:00:00.000Z",
  },
  {
    id: "d-flags",
    title: "Ship behind feature flags",
    context: "Rollbacks were manual.",
    owner: "Priya",
    status: "proposed",
    createdAt: "2026-03-01T00:00:00.000Z",
  },
  { id: "d-bare", title: "Retire the cron runner", context: "Two schedulers drifted.", owner: "Ari", status: "pending", createdAt: "2026-04-01T00:00:00.000Z" },
];

const RELEASES = [
  { id: "r-queue", version: "v2.0.0", owner: "Ari", status: "completed", createdAt: "2026-06-01T00:00:00.000Z", decisionIds: ["d-queue", "d-flags"] },
  { id: "r-flags", version: "v1.9.0", owner: "Ari", status: "completed", createdAt: "2026-05-01T00:00:00.000Z", decisionIds: ["d-flags"] },
  // Governed by a decision this log does not hold: the dangling reference an
  // export/import round trip leaves behind.
  { id: "r-ghost", version: "v1.8.0", owner: "Ari", status: "completed", createdAt: "2026-04-01T00:00:00.000Z", decisionIds: ["d-gone", "d-queue"] },
  { id: "r-bare", version: "v1.7.0", owner: "Ari", status: "completed", createdAt: "2026-03-01T00:00:00.000Z", decisionIds: [] },
];

const NO_SEED = { decisions: [], releases: [] };

const detailFor = (id) => {
  const container = createElement("div");
  renderReleaseDetail(container, resolveReleaseDetail(RELEASES, DECISIONS, id), { id });
  return container;
};

// --- the rationale preview -------------------------------------------------

test("a rationale is previewed as text, clipped at a word boundary, and never invented", () => {
  assert.equal(decisionRationalePreview(DECISIONS[1]), "Rollbacks were manual.");
  // Nothing recorded is stated, not filled in from a neighbouring field. A
  // stored decision always carries a context, but an imported or seeded one is
  // only checked at its own boundary, so the view must survive an absent field.
  assert.equal(decisionRationalePreview({ id: "d-none", title: "No why", alternatives: "Some other thing." }), NO_RATIONALE_TEXT);
  assert.equal(decisionRationalePreview({ context: "   " }), NO_RATIONALE_TEXT);
  assert.equal(decisionRationalePreview(undefined), NO_RATIONALE_TEXT);
  // Newlines and runs of spaces collapse: a preview is one line of prose.
  assert.equal(decisionRationalePreview({ context: " Two\n\nreasons.  Both real. " }), "Two reasons. Both real.");

  const long = `${"word ".repeat(80)}end`;
  const preview = decisionRationalePreview(long ? { context: long } : {});
  assert.ok(preview.length <= RATIONALE_PREVIEW_LENGTH + 1, `preview ran to ${preview.length} characters`);
  assert.ok(preview.endsWith("…"), "a clipped preview does not say that it was clipped");
  assert.ok(!preview.endsWith(" …"), "the clip left a trailing space before the ellipsis");
  assert.ok(long.startsWith(preview.slice(0, -1)), "the preview is not a prefix of the rationale");

  // A single unbroken run has no word boundary worth honouring, so it is cut
  // rather than thrown away back to the first space.
  const unbroken = { context: `short ${"x".repeat(400)}` };
  assert.ok(decisionRationalePreview(unbroken).length > RATIONALE_PREVIEW_LENGTH * 0.6);
});

// --- which decision governs ------------------------------------------------

test("the governing decision is the first one linked, resolved or not", () => {
  const queue = resolveReleaseDetail(RELEASES, DECISIONS, "r-queue");
  assert.equal(governingAssociation(queue).id, "d-queue");
  assert.equal(governingAssociation(queue).missing, false);

  const ghost = resolveReleaseDetail(RELEASES, DECISIONS, "r-ghost");
  assert.equal(governingAssociation(ghost).id, "d-gone");
  assert.equal(governingAssociation(ghost).missing, true, "a dangling governing reference was read as resolved");

  // A release with nothing linked has no governing decision to claim.
  assert.equal(governingAssociation(resolveReleaseDetail(RELEASES, DECISIONS, "r-bare")), null);
  assert.equal(governingAssociation(null), null);
});

// --- the release view ------------------------------------------------------

test("the release view shows the linked decision's title, status, owner, and rationale preview", (t) => {
  installDocument();
  t.after(() => { delete globalThis.document; });

  const governing = first(detailFor("r-queue"), "detail-governing");
  assert.ok(governing, "the release view does not state which decision governs it");
  assert.equal(textOf(first(governing, "detail-governing-name")), "Adopt a durable job queue");
  assert.equal(textOf(first(governing, "detail-governing-meta")), "Status accepted Owner Kai");
  assert.ok(textOf(first(governing, "detail-governing-rationale"))
    .startsWith("Rationale Background work was lost on every deploy"));

  // The path to the full record: a real anchor, at the canonical location, on
  // the node that carries the label — not a button and not a bare filename.
  const link = first(governing, "detail-governing-link");
  assert.equal(link.tagName, "A");
  assert.equal(link.href, "/decision.html?id=d-queue");
  assert.equal(link.getAttribute("href"), "/decision.html?id=d-queue");
  assert.ok(textOf(link).startsWith("Open the full decision record"));
  // The link is a sibling of the clipped preview, never inside it, so nothing
  // about the truncation can take the way to the rest of the rationale with it.
  assert.equal(link.parent, governing);
  assert.equal(
    link.getAttribute("aria-describedby"),
    first(governing, "detail-governing-target").id,
    "the link is not described by the sentence naming where it goes",
  );

  // Every linked decision carries the same preview in the evidence list below.
  const rows = byClass(detailFor("r-queue"), "detail-decision-rationale").map(textOf);
  assert.deepEqual(rows, [
    "Rationale Background work was lost on every deploy, and the retry story was a runbook step nobody ran.",
    "Rationale Rollbacks were manual.",
  ]);
});

test("a governing decision that no longer resolves degrades to text and says what to do", (t) => {
  installDocument();
  t.after(() => { delete globalThis.document; });

  const container = detailFor("r-ghost");
  const governing = first(container, "detail-governing");
  assert.ok(governing.classes.includes("detail-governing-missing"));
  assert.equal(textOf(first(governing, "detail-governing-name")), "missing Linked decision d-gone is not in this log.");
  assert.equal(textOf(first(governing, "detail-governing-note")), GOVERNING_DECISION_MISSING_TEXT);
  assert.equal(first(governing, "detail-governing-link"), null, "a decision that is not in this log was offered as a link");
  // The rest of the page still renders: the resolved decision below is intact.
  assert.equal(byClass(container, "detail-decision").length, 1);
});

test("markup in a decision title or rationale renders as text in the release view", (t) => {
  installDocument();
  t.after(() => { delete globalThis.document; });

  const hostile = [{
    id: "d-xss",
    title: "<img src=x onerror=alert(1)>Adopt <b>queues</b>",
    context: "<script>alert('rationale')</script> Because work was lost.",
    owner: "<em>Kai</em>",
    status: "accepted",
    createdAt: "2026-02-01T00:00:00.000Z",
  }];
  const releases = [{ id: "r-xss", version: "v3.0.0", owner: "Ari", status: "completed", createdAt: "2026-07-01T00:00:00.000Z", decisionIds: ["d-xss"] }];
  const container = createElement("div");
  renderReleaseDetail(container, resolveReleaseDetail(releases, hostile, "r-xss"), { id: "r-xss" });

  const governing = first(container, "detail-governing");
  // Text, not structure: the angle brackets survive as characters and no
  // element was created from them.
  assert.equal(textOf(first(governing, "detail-governing-name")), hostile[0].title);
  assert.equal(byClass(governing, "detail-governing-name")[0].children.length, 0);
  assert.ok(textOf(first(governing, "detail-governing-rationale")).includes("<script>alert('rationale')</script>"));
  assert.equal(textOf(first(governing, "detail-governing-meta")), "Status accepted Owner <em>Kai</em>");
  assert.equal(container.querySelector("SCRIPT"), null, "stored text was turned into an element");
  assert.equal(container.querySelector("IMG"), null, "stored text was turned into an element");
  // The described-by sentence quotes the title, and it is one text node too.
  assert.ok(textOf(first(governing, "detail-governing-target")).includes(hostile[0].title));
});

// --- the shipping-history filter -------------------------------------------

test("filtering the history by one decision selects every release associated with it", () => {
  const resolved = (filters) => filterReleases(RELEASES, DECISIONS, filters).map(({ id }) => id);

  assert.deepEqual(resolved({ decisionId: "d-queue" }), ["r-queue", "r-ghost"]);
  assert.deepEqual(resolved({ decisionId: "d-flags" }), ["r-queue", "r-flags"]);
  // A dangling reference is still an association, so a decision that was later
  // deleted still finds the releases that named it.
  assert.deepEqual(resolved({ decisionId: "d-gone" }), ["r-ghost"]);
  assert.deepEqual(resolved({ decisionId: ALL_DECISIONS_FILTER }), ["r-queue", "r-flags", "r-ghost", "r-bare"]);
  assert.deepEqual(resolved({}), ["r-queue", "r-flags", "r-ghost", "r-bare"]);
  // Composes with the other filters rather than replacing them.
  assert.deepEqual(resolved({ decisionId: "d-queue", query: "v1.8" }), ["r-ghost"]);

  assert.equal(matchesDecisionId(null, "d-queue"), false);
  assert.equal(matchesDecisionId(null, ALL_DECISIONS_FILTER), true);
  assert.equal(decisionIdFilter("  "), ALL_DECISIONS_FILTER);
  assert.equal(decisionIdFilter(7), ALL_DECISIONS_FILTER);
  // The narrowed view is a filtered view, so its empty state offers a reset.
  assert.equal(releaseFiltersActive({ decisionId: "d-queue" }), true);
  assert.equal(releaseFiltersActive({ decisionId: ALL_DECISIONS_FILTER }), false);
});

test("the decision filter round-trips through the query string without clobbering it", () => {
  assert.equal(readDecisionFilter("?decision=d-queue"), "d-queue");
  assert.equal(readDecisionFilter("?focus=r-queue"), ALL_DECISIONS_FILTER);
  assert.equal(readDecisionFilter(""), ALL_DECISIONS_FILTER);
  assert.equal(readDecisionFilter("?decision="), ALL_DECISIONS_FILTER);

  assert.equal(decisionFilterSearch("", "d-queue"), `?${DECISION_FILTER_PARAM}=d-queue`);
  assert.equal(decisionFilterSearch("?focus=r-queue", "d-queue"), "?focus=r-queue&decision=d-queue");
  // Turning it off removes only this parameter.
  assert.equal(decisionFilterSearch("?focus=r-queue&decision=d-queue", ALL_DECISIONS_FILTER), "?focus=r-queue");
  assert.equal(decisionFilterSearch("?decision=d-queue", ALL_DECISIONS_FILTER), "");
  // Ids needing encoding survive the trip in both directions.
  const encoded = decisionFilterSearch("", "d/one two");
  assert.equal(readDecisionFilter(encoded), "d/one two");
});

// --- the shipped page ------------------------------------------------------

async function openReleases(t, { search = "" } = {}) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(DECISIONS),
      [RELEASE_STORAGE_KEY]: JSON.stringify(RELEASES),
    },
    location: { pathname: "/releases.html", search },
  });
  t.after(() => page.restore());
  const replaced = [];
  initReleasesPage(page.document, page.storage, {
    seed: NO_SEED,
    location: { pathname: "/releases.html", search, hash: "" },
    history: { replaceState: (_state, _title, url) => replaced.push(url) },
  });
  return { page, replaced };
}

const versions = (page) => [...page.document.querySelectorAll(".release-version")].map(textOf);

test("the history filter is a labelled select of this log's decisions, operable by keyboard", async (t) => {
  const { page, replaced } = await openReleases(t);
  const select = page.document.querySelector("#release-decision");

  // Programmatically labelled and described, so what it filters is announced
  // with it rather than only shown beside it.
  const label = [...page.document.querySelectorAll("label")].find((node) => node.getAttribute("for") === "release-decision");
  assert.equal(textOf(label), "Linked decision");
  assert.equal(
    textOf(page.document.getElementById(select.getAttribute("aria-describedby"))),
    "Shows only the releases associated with the chosen decision.",
  );

  // One option per decision this log holds, named by its title, plus the
  // default. The stored title is text: the option carries no child elements.
  assert.deepEqual(select.options.map((option) => option.value), ["all", "d-queue", "d-flags", "d-bare"]);
  assert.deepEqual(select.options.map(textOf), [
    "All decisions",
    "Adopt a durable job queue",
    "Ship behind feature flags",
    "Retire the cron runner",
  ]);

  assert.deepEqual(versions(page), ["v2.0.0", "v1.9.0", "v1.8.0", "v1.7.0"]);

  // Keyboard alone: focus the select and move to the next option. The platform
  // reports the change, the list narrows, and the count follows it.
  select.focus();
  pressKey(page.document, "ArrowDown");
  assert.equal(select.value, "d-queue", "the selection did not move with the keyboard");
  assert.deepEqual(versions(page), ["v2.0.0", "v1.8.0"]);
  assert.equal(textOf(page.document.querySelector("#release-count")), "Showing 2 of 4 releases, newest first.");

  // ...and the narrowed view is addressable, so it can be shared or reloaded.
  assert.equal(replaced.at(-1), "/releases.html?decision=d-queue");
});

test("a narrowed history reopens from the URL, and clearing the filters restores it", async (t) => {
  const { page, replaced } = await openReleases(t, { search: "?decision=d-flags" });
  const select = page.document.querySelector("#release-decision");

  // The restored value is on the control as well as in the view, so the
  // selection a screen reader reports matches the rows on screen.
  assert.equal(select.value, "d-flags");
  assert.deepEqual(versions(page), ["v2.0.0", "v1.9.0"]);

  // A decision no release carried lands on the filtered empty state — the one
  // whose single next step is clearing the filters, not recording a release.
  select.value = "d-bare";
  select.dispatchEvent(new DomEvent("change", { bubbles: true }));
  assert.deepEqual(versions(page), []);
  const reset = page.document.querySelector(".release-reset-action");
  assert.ok(reset, "the filtered empty state offers no way back");

  reset.click();
  assert.equal(select.value, ALL_DECISIONS_FILTER);
  assert.deepEqual(versions(page), ["v2.0.0", "v1.9.0", "v1.8.0", "v1.7.0"]);
  // Clearing takes the parameter out of the URL too, so a reload does not
  // restore the filter the visitor just cleared.
  assert.equal(replaced.at(-1), "/releases.html");
});

test("a stale decision in the URL falls back to the whole history rather than emptying it", async (t) => {
  const { page } = await openReleases(t, { search: "?decision=d-deleted" });
  const select = page.document.querySelector("#release-decision");
  assert.equal(select.value, ALL_DECISIONS_FILTER, "a decision this log no longer holds stayed on the control");
  assert.deepEqual(versions(page), ["v2.0.0", "v1.9.0", "v1.8.0", "v1.7.0"]);
});

// One relationship, one name, across every surface that states it. The concept
// used to ship as "governing decision" in the recorder and "linked decision" in
// the summary beside it, which is two names for one thing (issue #2034). The
// half-renamed state is the one that hurts most — a reader is told to expect a
// section the release page does not appear to have — so the three surfaces are
// held together here rather than one at a time in the tests below.
test("the first linked decision is called that on all three surfaces that name it", async (t) => {
  const { page } = await openReleases(t);
  const surfaces = {
    "the recorder's field hint": textOf(page.document.querySelector("#release-decisions-hint")),
    "the recorder's live summary": selectionSummaryText(1, 2, "Adopt a durable job queue"),
    "the release detail heading": GOVERNING_DECISION_HEADING,
  };

  for (const [where, copy] of Object.entries(surfaces)) {
    assert.match(copy, /first linked decision/i, `${where} does not use the one name for this relationship`);
    assert.doesNotMatch(copy, /governing decision/i, `${where} still ships the retired second name`);
  }
});

test("the recorder names the decision that will govern the release as it is chosen", async (t) => {
  const { page } = await openReleases(t);
  const summary = page.document.querySelector("#release-decisions-summary");
  const checks = [...page.document.querySelectorAll(".decision-picker-check")];
  const optionFor = (id) => checks.find((check) => check.getAttribute("value") === id);

  // The hint says the rule before anything is ticked, in the same words the
  // release detail view heads that decision with.
  assert.ok(textOf(page.document.querySelector("#release-decisions-hint"))
    .includes("The release page shows the first linked decision in its own section above the rest."));
  // A live region, so the choice is announced without moving focus out of the
  // group — and it is a region, so it was announced at all.
  assert.equal(summary.getAttribute("role"), "status");
  assert.equal(summary.getAttribute("aria-live"), "polite");

  // Keyboard only: reach an option and link it with Space.
  optionFor("d-flags").focus();
  pressSpace(page.document);
  assert.equal(textOf(summary), "1 of 3 decisions linked. “Ship behind feature flags” is the first linked decision.");

  // A second tick joins the release but does not take the governing seat.
  optionFor("d-queue").focus();
  pressSpace(page.document);
  assert.equal(textOf(summary), "2 of 3 decisions linked. “Ship behind feature flags” is the first linked decision.");

  // Unticking the governing decision promotes the next one in the chosen order.
  optionFor("d-flags").focus();
  pressSpace(page.document);
  assert.equal(textOf(summary), "1 of 3 decisions linked. “Adopt a durable job queue” is the first linked decision.");

  // Each option carries the rationale it is being chosen on, as text.
  const rationale = [...page.document.querySelectorAll(".decision-picker-rationale")].map(textOf);
  assert.deepEqual(rationale, [
    "RationaleBackground work was lost on every deploy, and the retry story was a runbook step nobody ran.",
    "RationaleRollbacks were manual.",
    "RationaleTwo schedulers drifted.",
  ]);
});
