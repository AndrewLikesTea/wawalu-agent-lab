// Inspecting the decisions linked to one release (issue #612).
//
// Three layers, matching how src/releases.js is split and how the page boots.
// The pure core — which decision is chased next and why — is asserted directly.
// The rendered detail view is checked through the element stub. The parts a
// keyboard user feels are driven through the shipped markup: entering a release
// from the history with Enter, and reaching the follow-up and the evidence from
// the detail page's tab sequence.
//
// Determinism: no network, no timers, no sleeps. Every test seeds its own
// fixtures; nothing depends on the shipped example records.

import test from "node:test";
import assert from "node:assert/strict";
import { STORAGE_KEY } from "../src/app.js";
import {
  RECORD_DECISION_HREF,
  RELEASE_STORAGE_KEY,
  decisionOwner,
  releaseDecisionFollowUp,
  releaseDecisionReadinessText,
  releaseLinkPhrase,
  renderReleaseDetail,
  renderReleaseDetailError,
  resolveReleaseDetail,
} from "../src/releases.js";
import { RECORD_DECISION_HREF as FORM_RECORD_DECISION_HREF } from "../src/release-form.js";
import { initReleasesPage } from "../src/releases-page.js";
import { initReleaseDetail } from "../src/release-page.js";
import { createElement, first, byClass, installDocument } from "./support/dom.js";
import { loadPage, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const RELEASE_DETAIL_PAGE = new URL("../src/release.html", import.meta.url);

const DECISIONS = [
  { id: "d-queue", title: "Adopt a durable job queue", context: "Work was lost on deploys.", owner: "Kai", status: "accepted", createdAt: "2026-02-01T00:00:00.000Z" },
  { id: "d-flags", title: "Ship behind feature flags", context: "Rollbacks were manual.", owner: "Priya", status: "proposed", createdAt: "2026-03-01T00:00:00.000Z" },
  { id: "d-cache", title: "Cache the read path", context: "Reads were slow.", status: "pending", createdAt: "2026-04-01T00:00:00.000Z" },
  { id: "d-csv", title: "Sunset the CSV export", context: "Two exporters drifted.", owner: "Mina", status: "superseded", createdAt: "2026-01-05T00:00:00.000Z" },
];

const RELEASES = [
  // Carries one decision of every unsettled kind, so the priority order is
  // exercised by a single record rather than by hand-built counts.
  { id: "r-mixed", version: "v2.0.0", owner: "Ari", status: "completed", createdAt: "2026-06-01T00:00:00.000Z", decisionIds: ["d-csv", "d-cache", "d-flags", "d-queue"] },
  { id: "r-ghost", version: "v1.9.0", owner: "Ari", status: "completed", createdAt: "2026-05-01T00:00:00.000Z", decisionIds: ["d-flags", "ghost"] },
  { id: "r-late", version: "v1.8.0", owner: "Ari", status: "completed", createdAt: "2026-04-15T00:00:00.000Z", decisionIds: ["d-csv", "d-cache"] },
  { id: "r-settled", version: "v1.7.0", owner: "Ari", status: "completed", createdAt: "2026-03-20T00:00:00.000Z", decisionIds: ["d-queue"] },
  { id: "r-bare", version: "v1.6.0", owner: "Ari", status: "completed", createdAt: "2026-02-20T00:00:00.000Z", decisionIds: [] },
];

// The renderer's own date format, computed rather than spelled out, so the
// assertion holds in whatever timezone the suite runs in.
const mediumDate = (iso) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));

const followUpFor = (id) => releaseDecisionFollowUp(resolveReleaseDetail(RELEASES, DECISIONS, id));

// --- which decision is chased next -----------------------------------------

test("a dangling reference outranks every unsettled decision on the release", () => {
  const followUp = followUpFor("r-ghost");
  assert.equal(followUp.kind, "missing");
  assert.equal(followUp.decisionId, "ghost");
  assert.equal(followUp.status, "missing");
  // The record is absent, so nothing can be claimed about who owns it.
  assert.equal(followUp.owner, "Unknown");
  assert.match(followUp.reason, /not in this log/);
  // The one action that exists for a record this log does not hold.
  assert.equal(followUp.href, RECORD_DECISION_HREF);
  assert.equal(followUp.action, "Record the missing decision");
});

test("among unsettled decisions the earliest lifecycle stage is chased first", () => {
  // r-mixed links superseded, pending, proposed and accepted — in that order,
  // so association order alone would pick the wrong one.
  const proposed = followUpFor("r-mixed");
  assert.equal(proposed.kind, "proposed");
  assert.equal(proposed.decisionId, "d-flags");
  assert.equal(proposed.title, "Ship behind feature flags");
  assert.equal(proposed.owner, "Priya");
  assert.equal(proposed.href, "/decision.html?id=d-flags");
  assert.match(proposed.reason, /still proposed/);
  assert.match(proposed.target, /Opens the decision record/);

  // With nothing proposed, the pending decision is next — and an unowned
  // decision says so rather than showing a blank.
  const pending = followUpFor("r-late");
  assert.equal(pending.kind, "pending");
  assert.equal(pending.decisionId, "d-cache");
  assert.equal(pending.owner, "Unassigned");
  assert.equal(pending.action, "Settle “Cache the read path”");

  // Superseded is last: it is settled, but the release now rests on reasoning
  // the log has replaced.
  const superseded = releaseDecisionFollowUp(resolveReleaseDetail(
    [{ id: "r-only", version: "v0.9.0", createdAt: "2026-01-10T00:00:00.000Z", decisionIds: ["d-csv"] }],
    DECISIONS,
    "r-only",
  ));
  assert.equal(superseded.kind, "superseded");
  assert.equal(superseded.action, "Review “Sunset the CSV export”");
});

test("a release whose decisions are all accepted has no follow-up", () => {
  assert.equal(followUpFor("r-settled"), null);
  // Neither does one with nothing linked: an empty state is not a follow-up.
  assert.equal(followUpFor("r-bare"), null);
  assert.equal(releaseDecisionFollowUp(null), null);
  assert.equal(releaseDecisionFollowUp(undefined), null);
});

test("the decision-readiness conclusion is exhaustive and does not claim operational readiness", () => {
  assert.equal(
    releaseDecisionReadinessText(resolveReleaseDetail(RELEASES, DECISIONS, "r-settled")),
    "Decision check: Clear — every linked decision is accepted.",
  );
  assert.match(releaseDecisionReadinessText(resolveReleaseDetail(RELEASES, DECISIONS, "r-mixed")), /Follow-up required/);
  assert.match(releaseDecisionReadinessText(resolveReleaseDetail(RELEASES, DECISIONS, "r-bare")), /Unknown/);
});

test("an unaddressable decision is named instead of linked to nowhere", () => {
  const followUp = releaseDecisionFollowUp(resolveReleaseDetail(
    [{ id: "r-partial", version: "v5", createdAt: "2026-06-01T00:00:00.000Z", decisionIds: [""] }],
    [{ id: "", title: "Untitled work", status: "pending", createdAt: "2026-06-01T00:00:00.000Z" }],
    "r-partial",
  ));
  assert.equal(followUp.kind, "pending");
  assert.equal(followUp.href, null);
  assert.equal(followUp.action, null);
  assert.match(followUp.target, /no id/);
});

test("decision attribution accepts the legacy author field and states when there is none", () => {
  assert.equal(decisionOwner({ owner: "Mina", author: "Old value" }), "Mina");
  assert.equal(decisionOwner({ author: "Kai" }), "Kai");
  assert.equal(decisionOwner({ owner: "   " }), "Unassigned");
  assert.equal(decisionOwner(undefined), "Unassigned");
  // The recorder link is declared in releases.js to avoid an import cycle with
  // release-form.js; the two must not drift.
  assert.equal(RECORD_DECISION_HREF, FORM_RECORD_DECISION_HREF);
});

// --- the rendered detail view ----------------------------------------------

function renderDetail(id) {
  installDocument();
  const container = createElement("div");
  renderReleaseDetail(container, resolveReleaseDetail(RELEASES, DECISIONS, id), { id });
  return container;
}

test("the detail view leads with the prioritised follow-up, named and explained", () => {
  const container = renderDetail("r-mixed");
  assert.match(first(container, "detail-readiness").textContent, /Follow-up required/);
  const panel = first(container, "detail-followup");
  assert.ok(panel, "the callout is rendered");
  assert.equal(panel.tagName, "SECTION");

  const heading = first(panel, "detail-followup-title");
  assert.equal(heading.tagName, "H2");
  assert.equal(panel.getAttribute("aria-labelledby"), heading.id);
  assert.equal(first(panel, "detail-followup-decision").textContent, "Ship behind feature flags");

  // Status and owner are the two facts a lead needs before deciding to chase
  // it, and they are a real definition list rather than loose text.
  const meta = first(panel, "detail-followup-meta");
  assert.equal(meta.tagName, "DL");
  const labels = byClass(meta, "detail-meta-label").map((node) => node.textContent);
  assert.deepEqual(labels, ["Status", "Owner"]);
  assert.equal(first(meta, "badge-proposed").textContent, "proposed");
  assert.match(textOf(meta), /Priya/);
  assert.match(first(panel, "detail-followup-reason").textContent, /has no recorded decision to stand behind/);

  const action = first(panel, "detail-followup-action");
  assert.equal(action.tagName, "A", "the action is a real link, not a styled span");
  assert.equal(action.href, "/decision.html?id=d-flags");
  const target = first(panel, "detail-followup-target");
  assert.equal(action.getAttribute("aria-describedby"), target.id);
  assert.match(target.textContent, /Opens the decision record/);
});

test("the evidence list carries every linked decision and marks the one being chased", () => {
  const container = renderDetail("r-mixed");
  const rows = byClass(container, "detail-decision");
  assert.equal(rows.length, 4, "all four linked decisions are evidence, not just the follow-up");
  // Association order is preserved, and each row navigates to its own record.
  assert.deepEqual(rows.map((row) => row.href), [
    "/decision.html?id=d-csv",
    "/decision.html?id=d-cache",
    "/decision.html?id=d-flags",
    "/decision.html?id=d-queue",
  ]);
  assert.deepEqual(
    rows.map((row) => first(row, "detail-decision-title").textContent),
    ["Sunset the CSV export", "Cache the read path", "Ship behind feature flags", "Adopt a durable job queue"],
  );
  // Every row states its status, so the list can be triaged without opening it.
  assert.ok(first(rows[0], "badge-superseded"));
  assert.ok(first(rows[3], "badge-accepted"));

  // Exactly one row is tied back to the callout above it, and it is the row the
  // callout named.
  const flags = byClass(container, "detail-decision-flag");
  assert.equal(flags.length, 1);
  assert.equal(flags[0].textContent, "Next follow-up");
  assert.equal(flags[0].parent.href, "/decision.html?id=d-flags");
  // The caption opens with the same phrase the decision detail puts on this
  // release, and the release's date, so the relationship reads identically from
  // either end without opening the other record.
  assert.match(
    first(container, "detail-decisions-caption").textContent,
    new RegExp(`^Shipped in this release · ${mediumDate("2026-06-01T00:00:00.000Z")}\\. Every decision below, in the order it was linked\\.`),
  );
  assert.equal(releaseLinkPhrase("completed"), "Shipped in this release");
});

test("a release that has not shipped says the decisions are referenced, not shipped", () => {
  // Same wording on both sides of the link: a planned or cancelled release only
  // names its decisions, and both detail views say so in the same words.
  assert.equal(releaseLinkPhrase("planned"), "Referenced by this release, not shipped");
  assert.equal(releaseLinkPhrase("cancelled"), "Referenced by this release, not shipped");
  // An unreadable status falls back to the release vocabulary's default, so the
  // phrase can never render as "undefined".
  assert.equal(releaseLinkPhrase("shipped-ish"), "Shipped in this release");

  const planned = { id: "r-plan", version: "v3.0.0", owner: "Ari", status: "planned", createdAt: "2026-07-04T00:00:00.000Z", decisionIds: ["d-queue"] };
  const container = createElement("div");
  renderReleaseDetail(container, resolveReleaseDetail([planned], DECISIONS, "r-plan"));
  assert.match(
    first(container, "detail-decisions-caption").textContent,
    new RegExp(`^Referenced by this release, not shipped · ${mediumDate("2026-07-04T00:00:00.000Z")}\\.`),
  );
});

test("a dangling reference is marked in place and keeps its position in the log", () => {
  const container = renderDetail("r-ghost");
  assert.ok(first(container, "detail-followup-missing"), "the callout carries the missing weighting");
  assert.match(textOf(first(container, "detail-followup-decision")), /Linked decision ghost is not in this log\./);
  const flagged = first(container, "detail-decision-flagged");
  assert.ok(flagged.classes.includes("detail-decision-missing"));
  // Second in the association order, exactly where the release author put it.
  assert.equal(byClass(container, "detail-decision-list")[0].children[1], flagged);
});

test("a settled release renders no callout and no stale marker", () => {
  const container = renderDetail("r-settled");
  assert.equal(first(container, "detail-followup"), null);
  assert.equal(first(container, "detail-decision-flag"), null);
  assert.equal(byClass(container, "detail-decision").length, 1);
});

test("a release with no linked decisions offers the one next step it has", () => {
  const container = renderDetail("r-bare");
  assert.equal(first(container, "detail-followup"), null);
  assert.equal(byClass(container, "detail-decision").length, 0);
  const empty = first(container, "detail-decisions-empty");
  assert.ok(empty, "the empty state is a state, not a bare sentence");
  assert.equal(first(empty, "release-empty").textContent, "No decisions linked to this release.");
  assert.match(first(empty, "detail-decisions-empty-body").textContent, /Record the decision behind it/);
  const action = first(empty, "detail-decisions-empty-action");
  assert.equal(action.tagName, "A");
  assert.equal(action.href, RECORD_DECISION_HREF);
});

test("a log that cannot be read says so and keeps the way back", () => {
  installDocument();
  const container = createElement("div");
  renderReleaseDetailError(container);
  assert.equal(container.getAttribute("aria-busy"), "false");
  assert.equal(first(container, "detail-back").href, "/releases.html");
  const panel = first(container, "empty-state-error");
  assert.equal(panel.getAttribute("role"), "alert");
  assert.match(textOf(panel), /could not be loaded/);
  assert.match(textOf(panel), /have not been changed/);
});

// --- the pages -------------------------------------------------------------

const NO_SEED = { decisions: [], releases: [] };

// A *stored* decision always carries an owner (app.js drops one that does not),
// so the page fixtures give the unowned decision one. The "Unassigned" fallback
// above still matters — an imported or seeded record can reach the view without
// attribution — but it is not a state this browser's log can be in.
const PAGE_DECISIONS = DECISIONS.map((decision) => (decision.owner ? decision : { ...decision, owner: "Rowan" }));

const seededStorage = () => ({
  [STORAGE_KEY]: JSON.stringify(PAGE_DECISIONS),
  [RELEASE_STORAGE_KEY]: JSON.stringify(RELEASES),
});

async function openHistory(t) {
  const page = await loadPage(RELEASES_PAGE, { storage: seededStorage() });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, { seed: NO_SEED });
  return page;
}

async function openDetail(t, id) {
  const page = await loadPage(RELEASE_DETAIL_PAGE, {
    storage: seededStorage(),
    location: { search: `?id=${id}` },
  });
  t.after(() => page.restore());
  initReleaseDetail();
  return page;
}

test("a release's decisions are reachable from the history with the keyboard alone", async (t) => {
  const page = await openHistory(t);
  const toggles = page.document.querySelectorAll(".release-toggle");
  assert.equal(toggles[0].tagName, "BUTTON", "each row's control is in the tab sequence natively");
  assert.equal(toggles[0].getAttribute("aria-expanded"), "false");

  // Tab reaches the row control itself, without a roving tabindex to maintain.
  let focused = null;
  for (let step = 0; step < tabSequence(page.document).length; step += 1) {
    focused = pressTab(page.document);
    if (focused === toggles[0]) break;
  }
  assert.equal(focused, toggles[0], "the first release is tabbable");

  // Enter opens that release's decisions; Space still expands them in place.
  pressEnter(page.document);
  assert.deepEqual(page.navigations, ["/release.html?id=r-mixed"]);
});

test("the detail page a keyboard user lands on leads with the follow-up and its evidence", async (t) => {
  const page = await openDetail(t, "r-mixed");
  const detail = page.document.querySelector("#release-detail");
  assert.equal(detail.getAttribute("aria-busy"), "false");
  assert.match(textOf(detail.querySelector(".detail-followup-decision")), /Ship behind feature flags/);

  const action = detail.querySelector(".detail-followup-action");
  // The callout's action comes before the evidence rows in the tab sequence, so
  // the prioritised step is the first thing reachable inside the release.
  const sequence = tabSequence(page.document);
  const rows = detail.querySelectorAll(".detail-decision");
  assert.ok(sequence.includes(action), "the follow-up action is tabbable");
  assert.ok(sequence.indexOf(action) < sequence.indexOf(rows[0]), "the follow-up comes before the evidence");

  action.focus();
  pressEnter(page.document);
  assert.deepEqual(page.navigations, ["/decision.html?id=d-flags"]);

  // Every piece of evidence navigates to the record behind it.
  rows[3].focus();
  pressEnter(page.document);
  assert.deepEqual(page.navigations, ["/decision.html?id=d-flags", "/decision.html?id=d-queue"]);
});

test("a release with nothing linked sends a reader to the recorder from the detail page", async (t) => {
  const page = await openDetail(t, "r-bare");
  const detail = page.document.querySelector("#release-detail");
  assert.equal(detail.querySelectorAll(".detail-followup").length, 0);
  const action = detail.querySelector(".detail-decisions-empty-action");
  assert.ok(tabSequence(page.document).includes(action), "the next step is reachable by keyboard");
  action.focus();
  pressEnter(page.document);
  assert.deepEqual(page.navigations, [RECORD_DECISION_HREF]);
});
