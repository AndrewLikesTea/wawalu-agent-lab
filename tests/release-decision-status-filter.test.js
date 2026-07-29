// Filtering the shipping history by the status of the decisions a release
// carried (issue #584).
//
// Two layers, matching how src/releases.js is split. The pure core — the filter
// vocabulary, the selection, the one count, and the prioritised follow-up — is
// asserted directly. The rendered result is driven through the shipped
// src/releases.html with the keyboard, so what is pinned is what a user can
// reach: the radio group's single tab stop, the arrow keys, the marked
// selection, the count, the follow-up and what it says it opens, the disclosure
// that carries the evidence, and each empty state's next step.
//
// Determinism: no network, no timers, no sleeps. Every test seeds its own
// fixtures; nothing depends on the shipped example records.

import test from "node:test";
import assert from "node:assert/strict";
import { DECISION_STATUSES } from "../src/decision-status.js";
import { STORAGE_KEY } from "../src/app.js";
import {
  MISSING_DECISION_FILTER,
  RELEASE_ATTENTION_KINDS,
  RELEASE_DECISION_STATUS_FILTERS,
  RELEASE_STORAGE_KEY,
  decisionStatusFilter,
  filterReleases,
  matchesDecisionStatus,
  normalizeReleaseFilters,
  releaseCountText,
  releaseFiltersActive,
  releaseFollowUp,
  releaseAttentionKind,
  renderReleaseFollowUp,
  renderReleaseList,
  summarizeReleases,
} from "../src/releases.js";
import { initReleasesPage } from "../src/releases-page.js";
import { createElement, first, installDocument } from "./support/dom.js";
import { loadPage, pressKey, pressTab, tabSequence, textOf } from "./support/browser.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);

// One decision per state the filter offers, so a single fixture exercises the
// whole vocabulary including the retired "approved" spelling of accepted.
const DECISIONS = [
  { id: "d-queue", title: "Adopt a durable queue", context: "Retries are required.", owner: "Kai", status: "accepted", createdAt: "2026-01-02T09:00:00.000Z" },
  { id: "d-cache", title: "Cache the read path", context: "Read latency spikes.", owner: "Ari", status: "pending", createdAt: "2026-01-03T09:00:00.000Z" },
  { id: "d-flags", title: "Ship behind feature flags", context: "Staged rollout.", owner: "Priya", status: "proposed", createdAt: "2026-01-04T09:00:00.000Z" },
  { id: "d-csv", title: "Sunset the CSV export", context: "Replaced by JSON.", owner: "Mina", status: "superseded", createdAt: "2026-01-05T09:00:00.000Z" },
];

// Newest first once sorted: flags, repair, read path, queue. "repair" links a
// decision this log does not hold, which is the dangling reference an import
// round trip leaves behind.
const RELEASES = [
  { id: "r-queue", version: "v1.1.0", title: "Queue work", description: "The durable queue shipped.", status: "completed", owner: "Kai", createdAt: "2026-02-01T00:00:00.000Z", decisionIds: ["d-queue"] },
  { id: "r-read", version: "v1.2.0", title: "Read path", description: "Caching went out.", status: "completed", owner: "Ari", createdAt: "2026-03-01T00:00:00.000Z", decisionIds: ["d-cache"] },
  { id: "r-repair", version: "v1.3.0", title: "Import repair", description: "Imported records reconnected.", status: "completed", owner: "Rowan", createdAt: "2026-04-01T00:00:00.000Z", decisionIds: ["d-queue", "d-gone"] },
  { id: "r-flags", version: "v1.4.0", title: "Flag rollout", description: "Flags landed.", status: "completed", owner: "Priya", createdAt: "2026-05-01T00:00:00.000Z", decisionIds: ["d-flags", "d-csv"] },
];

const ids = (resolved) => resolved.map((release) => release.id);

// --- the filter vocabulary -------------------------------------------------

test("the linked-decision filter offers the shared vocabulary plus a default and missing", () => {
  const values = RELEASE_DECISION_STATUS_FILTERS.map((option) => option.value);
  // The four statuses in lifecycle order, so this control can never drift from
  // the words the rest of the log records and renders.
  assert.deepEqual(values, ["all", ...DECISION_STATUSES, MISSING_DECISION_FILTER]);
  assert.equal(values[0], "all", "the default view is an all-status view");
  for (const option of RELEASE_DECISION_STATUS_FILTERS) {
    assert.match(option.label, /\S/, `${option.value} has a human label`);
  }
});

test("an unknown filter value falls back to the all-status view rather than matching nothing", () => {
  assert.equal(decisionStatusFilter("approved"), "all");
  assert.equal(decisionStatusFilter(undefined), "all");
  assert.equal(decisionStatusFilter(""), "all");
  assert.equal(decisionStatusFilter("pending"), "pending");
});

test("the filter boundary normalizes stale and malformed values once", () => {
  assert.deepEqual(normalizeReleaseFilters({
    status: "retired",
    decisionStatus: "approved",
    query: 42,
  }), {
    status: "all",
    decisionStatus: "all",
    query: "",
  });
  assert.deepEqual(normalizeReleaseFilters({
    status: "completed",
    decisionStatus: "pending",
    query: "  cache  ",
  }), {
    status: "completed",
    decisionStatus: "pending",
    query: "cache",
  });
  assert.deepEqual(normalizeReleaseFilters(null), {
    status: "all",
    decisionStatus: "all",
    query: "",
  });
});

// --- selection -------------------------------------------------------------

test("filtering by linked decision status selects the releases carrying one", () => {
  const select = (decisionStatus) => ids(filterReleases(RELEASES, DECISIONS, { decisionStatus }));
  // Newest first is preserved: filtering never reorders.
  assert.deepEqual(select("all"), ["r-flags", "r-repair", "r-read", "r-queue"]);
  assert.deepEqual(select("proposed"), ["r-flags"]);
  assert.deepEqual(select("pending"), ["r-read"]);
  assert.deepEqual(select("superseded"), ["r-flags"]);
  // A release carrying several decisions matches on each of them.
  assert.deepEqual(select("accepted"), ["r-repair", "r-queue"]);
  assert.deepEqual(select(MISSING_DECISION_FILTER), ["r-repair"]);
});

test("the retired \"approved\" spelling is filtered as accepted", () => {
  const stored = [{ id: "d-old", title: "Old record", context: "c", owner: "Mina", status: "approved", createdAt: "2026-01-01T00:00:00.000Z" }];
  const releases = [{ id: "r-old", version: "v0.9", createdAt: "2026-01-02T00:00:00.000Z", decisionIds: ["d-old"] }];
  assert.deepEqual(ids(filterReleases(releases, stored, { decisionStatus: "accepted" })), ["r-old"]);
  assert.deepEqual(filterReleases(releases, stored, { decisionStatus: "pending" }), []);
});

test("the decision-status filter composes with the release status and the search", () => {
  const planned = [...RELEASES, { id: "r-next", version: "v2.0.0", title: "Next", status: "planned", owner: "Kai", createdAt: "2026-06-01T00:00:00.000Z", decisionIds: ["d-flags"] }];
  assert.deepEqual(
    ids(filterReleases(planned, DECISIONS, { decisionStatus: "proposed", status: "planned" })),
    ["r-next"],
  );
  assert.deepEqual(
    ids(filterReleases(planned, DECISIONS, { decisionStatus: "proposed", query: "flags landed" })),
    ["r-flags"],
  );
});

test("matchesDecisionStatus tolerates a release resolved without counts", () => {
  assert.equal(matchesDecisionStatus({}, "all"), true);
  assert.equal(matchesDecisionStatus({}, "pending"), false);
  assert.equal(matchesDecisionStatus(undefined, MISSING_DECISION_FILTER), false);
});

test("releaseFiltersActive distinguishes a narrowed view from the default one", () => {
  assert.equal(releaseFiltersActive({}), false);
  assert.equal(releaseFiltersActive({ status: "all", decisionStatus: "all", query: "  " }), false);
  assert.equal(releaseFiltersActive({ decisionStatus: "pending" }), true);
  assert.equal(releaseFiltersActive({ status: "planned" }), true);
  assert.equal(releaseFiltersActive({ query: "queue" }), true);
  assert.equal(releaseFiltersActive({ status: "retired", decisionStatus: "approved", query: 42 }), false);
  assert.equal(releaseFiltersActive(null), false);
});

// --- the one count ---------------------------------------------------------

test("one count states the matching releases against the whole history", () => {
  assert.equal(releaseCountText(1, 4), "1 of 4 releases");
  assert.equal(releaseCountText(0, 4), "0 of 4 releases");
  assert.equal(releaseCountText(1, 1), "1 of 1 release");
});

// --- the follow-up ---------------------------------------------------------

test("attention is ranked so a broken reference outranks an unsettled decision", () => {
  assert.deepEqual(RELEASE_ATTENTION_KINDS, [MISSING_DECISION_FILTER, "proposed", "pending", "superseded"]);
  const [flags, repair, read, queue] = summarizeReleases(RELEASES, DECISIONS);
  assert.equal(releaseAttentionKind(repair), MISSING_DECISION_FILTER, "missing outranks the accepted decision beside it");
  assert.equal(releaseAttentionKind(flags), "proposed", "proposed outranks the superseded decision beside it");
  assert.equal(releaseAttentionKind(read), "pending");
  assert.equal(releaseAttentionKind(queue), null, "an all-accepted release needs nothing");
});

test("one follow-up is derived for the visible releases, most urgent first", () => {
  const all = releaseFollowUp(summarizeReleases(RELEASES, DECISIONS));
  assert.equal(all.kind, MISSING_DECISION_FILTER);
  assert.equal(all.releaseId, "r-repair");
  assert.equal(all.href, "/release.html?id=r-repair");
  assert.match(all.lead, /Import repair/);
  // The action explains its target rather than leaving "→" to imply it.
  assert.match(all.target, /Opens the release detail for Import repair/);
  assert.match(all.target, /decision id/);
});

test("the follow-up follows the filter and names the decision it opens", () => {
  const pending = releaseFollowUp(filterReleases(RELEASES, DECISIONS, { decisionStatus: "pending" }));
  assert.equal(pending.kind, "pending");
  assert.equal(pending.decisionId, "d-cache");
  assert.equal(pending.href, "/decision.html?id=d-cache");
  assert.match(pending.action, /Cache the read path/);
  assert.match(pending.target, /Opens the decision detail for “Cache the read path”/);

  // Filtering to accepted still surfaces the broken reference on a matching
  // release: the callout describes the rows on screen, not the whole log.
  const accepted = releaseFollowUp(filterReleases(RELEASES, DECISIONS, { decisionStatus: "accepted" }));
  assert.equal(accepted.kind, MISSING_DECISION_FILTER);
  assert.equal(accepted.releaseId, "r-repair");
});

test("nothing outstanding produces no follow-up at all", () => {
  const settled = [{ id: "r-only", version: "v2", createdAt: "2026-06-01T00:00:00.000Z", decisionIds: ["d-queue"] }];
  assert.equal(releaseFollowUp(summarizeReleases(settled, DECISIONS)), null);
  assert.equal(releaseFollowUp([]), null);
  assert.equal(releaseFollowUp(), null);
});

test("a partial linked decision still yields an addressable follow-up", () => {
  // Title absent: the decision is named by the id a reader can match to the log.
  const untitled = [{ id: "d-bare", status: "pending", createdAt: "2026-01-01T00:00:00.000Z" }];
  const release = [{ id: "r-bare", version: "v3", createdAt: "2026-06-01T00:00:00.000Z", decisionIds: ["d-bare"] }];
  const named = releaseFollowUp(summarizeReleases(release, untitled));
  assert.equal(named.href, "/decision.html?id=d-bare");
  assert.match(named.action, /d-bare/);

  // No id at all: the decision cannot be addressed, so the follow-up falls back
  // to the release carrying it rather than rendering a link to nowhere.
  const anonymous = [{ title: "Nameless", status: "pending", createdAt: "2026-01-01T00:00:00.000Z" }];
  const fallback = releaseFollowUp(summarizeReleases(
    [{ id: "r-anon", version: "v4", title: "Anon release", createdAt: "2026-06-01T00:00:00.000Z", decisionIds: [undefined] }],
    anonymous,
  ));
  assert.equal(fallback.kind, "pending");
  assert.equal(fallback.decisionId, null);
  assert.equal(fallback.href, "/release.html?id=r-anon", "an unaddressable decision is reached through its release");
  assert.match(fallback.target, /Opens the release detail for Anon release/);
});

// --- the rendered follow-up ------------------------------------------------

test("the follow-up renders as a labelled section whose action describes its target", () => {
  installDocument();
  const slot = createElement("div");
  renderReleaseFollowUp(slot, releaseFollowUp(summarizeReleases(RELEASES, DECISIONS)));

  assert.equal(slot.hidden, false);
  const panel = first(slot, "release-followup");
  assert.ok(panel, "the callout is rendered");
  assert.equal(panel.tagName, "SECTION");
  // Prominence is semantic as well as visual: a heading names the section, and
  // the section is labelled by it.
  const heading = first(panel, "release-followup-title");
  assert.equal(heading.tagName, "H3");
  assert.equal(panel.getAttribute("aria-labelledby"), heading.id);

  const action = first(panel, "release-followup-action");
  assert.equal(action.tagName, "A", "the action is a real link, not a styled span");
  assert.equal(action.href, "/release.html?id=r-repair");
  const target = first(panel, "release-followup-target");
  assert.equal(action.getAttribute("aria-describedby"), target.id);
  assert.match(target.textContent, /Opens the release detail/);
  // The kind is on the panel so the missing case can carry its own weighting.
  assert.ok(panel.classes.includes("release-followup-missing"));
});

test("a linked decision with no usable id is named in the disclosure, not linked to nowhere", () => {
  installDocument();
  const container = createElement("div");
  const partial = [{ status: "accepted", createdAt: "2026-01-01T00:00:00.000Z" }];
  const release = [{ id: "r-partial", version: "v5", createdAt: "2026-06-01T00:00:00.000Z", decisionIds: [undefined] }];
  renderReleaseList(container, summarizeReleases(release, partial));

  const named = first(container, "release-decision-title");
  assert.equal(named.tagName, "SPAN");
  assert.equal(named.textContent, "an untitled decision");
  assert.equal(first(container, "release-decision-link"), null, "no /decision.html?id=undefined link");
  // The release itself is still identified and still opens its detail page.
  assert.equal(first(container, "release-version").textContent, "v5");
  assert.equal(first(container, "release-detail-link").href, "/release.html?id=r-partial");
});

test("rendering no follow-up empties and hides the slot", () => {
  installDocument();
  const slot = createElement("div");
  renderReleaseFollowUp(slot, releaseFollowUp(summarizeReleases(RELEASES, DECISIONS)));
  renderReleaseFollowUp(slot, null);
  assert.equal(slot.hidden, true);
  assert.equal(slot.children.length, 0, "no stale callout survives");
});

// --- the page --------------------------------------------------------------

const NO_SEED = { decisions: [], releases: [] };

async function openReleases(t, { decisions = DECISIONS, releases = RELEASES } = {}) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(decisions),
      [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
    },
  });
  t.after(() => page.restore());
  return page;
}

async function bootedReleases(t, fixtures) {
  const page = await openReleases(t, fixtures);
  initReleasesPage(page.document, page.storage, { seed: NO_SEED });
  assert.equal(page.document.documentElement.dataset.shiplogReleases, "ready");
  return page;
}

const rowTitles = (page) => page.document.querySelectorAll(".release-version").map(textOf);
const countText = (page) => textOf(page.document.querySelector("#release-count"));
const followUp = (page) => page.document.querySelector("#release-followup");
const statusRadio = (page, value) => page.document.querySelector(`#release-decision-status-${value}`);

test("the page opens on the all-status view with every release and one count", async (t) => {
  const page = await bootedReleases(t);
  assert.deepEqual(rowTitles(page), ["Flag rollout", "Import repair", "Read path", "Queue work"]);
  assert.equal(countText(page), "4 of 4 releases");
  assert.equal(statusRadio(page, "all").checked, true, "the default option is the selected one");

  // Exactly one element on the page states how many releases matched.
  const counts = page.document.querySelectorAll("span,p,div,h1,h2,h3,li,a,button,legend,label")
    .filter((node) => /^\d+ of \d+ releases?$/.test(textOf(node)));
  assert.equal(counts.length, 1, "a second matching-record count would compete with the first");
  assert.equal(counts[0].id, "release-count");
});

test("the list state before the page boots is a loading state", async (t) => {
  const page = await openReleases(t);
  const list = page.document.querySelector("#release-list");
  assert.equal(list.getAttribute("aria-busy"), "true");
  const loading = page.document.querySelector(".list-state-loading");
  assert.ok(loading, "the shipped markup carries a loading state");
  assert.equal(loading.getAttribute("role"), "status");

  initReleasesPage(page.document, page.storage, { seed: NO_SEED });
  assert.equal(list.getAttribute("aria-busy"), "false", "the busy state is cleared once rendered");
});

test("the filter group is one keyboard stop and the arrow keys change the view", async (t) => {
  const page = await bootedReleases(t);
  const group = page.document.querySelectorAll('input[name="release-decision-status"]');
  assert.equal(group.length, RELEASE_DECISION_STATUS_FILTERS.length);

  // Semantics first: a named group, and every option labelled.
  const fieldset = page.document.querySelector(".release-decision-filter");
  assert.equal(fieldset.tagName, "FIELDSET");
  assert.equal(textOf(fieldset.querySelector("legend")), "Linked decision status");
  const hint = page.document.getElementById(fieldset.getAttribute("aria-describedby"));
  assert.ok(hint && textOf(hint) !== "", "the group explains what choosing a status does");
  for (const radio of group) {
    const label = page.document.querySelectorAll("label").find((node) => node.getAttribute("for") === radio.id);
    assert.ok(label && textOf(label) !== "", `${radio.value} is labelled`);
  }

  // One tab stop for the whole group, the way a native radio group behaves.
  const stops = tabSequence(page.document).filter((node) => node.name === "release-decision-status");
  assert.equal(stops.length, 1);

  statusRadio(page, "all").focus();
  pressKey(page.document, "ArrowRight");
  assert.equal(statusRadio(page, "proposed").checked, true);
  assert.equal(page.document.activeElement.value, "proposed", "focus follows the selection");
  assert.deepEqual(rowTitles(page), ["Flag rollout"]);
  assert.equal(countText(page), "1 of 4 releases");
});

test("choosing a linked decision status narrows the list, the count, and the follow-up", async (t) => {
  const page = await bootedReleases(t);
  const pending = statusRadio(page, "pending");
  pending.click();

  assert.deepEqual(rowTitles(page), ["Read path"]);
  assert.equal(countText(page), "1 of 4 releases");

  const callout = followUp(page);
  assert.equal(callout.hidden, false);
  const action = callout.querySelector(".release-followup-action");
  assert.equal(action.getAttribute("href"), "/decision.html?id=d-cache");
  assert.match(textOf(action), /Cache the read path/);
  const target = page.document.getElementById(action.getAttribute("aria-describedby"));
  assert.match(textOf(target), /Opens the decision detail for “Cache the read path”/);

  // Back to the default view: the callout re-derives from what is on screen.
  statusRadio(page, "all").click();
  assert.equal(countText(page), "4 of 4 releases");
  assert.match(textOf(followUp(page)), /Import repair/);
});

test("a filtered view with nothing outstanding hides the follow-up entirely", async (t) => {
  const page = await bootedReleases(t, {
    releases: [{ id: "r-only", version: "v1.0.0", title: "Settled", status: "completed", owner: "Kai", createdAt: "2026-02-01T00:00:00.000Z", decisionIds: ["d-queue"] }],
  });
  assert.equal(countText(page), "1 of 1 release");
  assert.equal(followUp(page).hidden, true);
  assert.equal(followUp(page).children.length, 0);
});

test("every displayed release discloses its linked decisions and their status evidence", async (t) => {
  const page = await bootedReleases(t);
  const toggle = page.document.querySelectorAll(".release-toggle")
    .find((button) => button.dataset.releaseId === "r-repair");

  // Collapsed, the row still identifies the release and summarises the link.
  assert.match(textOf(toggle), /Import repair/);
  assert.match(textOf(toggle), /2 decisions · 1 accepted, 1 missing/);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  const panel = page.document.getElementById(toggle.getAttribute("aria-controls"));
  assert.equal(panel.hidden, true);
  assert.equal(panel.getAttribute("aria-labelledby"), toggle.id);

  toggle.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(panel.hidden, false);

  // The association is inspectable: the decision is a link to its own record,
  // beside the status that put this release in the filtered set.
  const link = panel.querySelector(".release-decision-link");
  assert.equal(link.getAttribute("href"), "/decision.html?id=d-queue");
  assert.equal(textOf(link), "Adopt a durable queue");
  assert.match(textOf(panel.querySelector(".release-decision")), /accepted/);
  // The dangling reference is named rather than dropped.
  assert.match(textOf(panel.querySelector(".release-decision-missing")), /d-gone/);
});

test("a no-match view says so and offers a next step that clears the filters", async (t) => {
  const page = await bootedReleases(t, { releases: [RELEASES[0]] });
  statusRadio(page, "superseded").click();

  assert.equal(countText(page), "0 of 1 release");
  assert.equal(followUp(page).hidden, true, "nothing on screen means nothing to follow up");
  const state = page.document.querySelector(".list-state-empty");
  assert.equal(textOf(state.querySelector("h3")), "No matching releases");
  assert.equal(state.getAttribute("role"), "status");

  const reset = state.querySelector(".release-reset-action");
  assert.equal(textOf(reset), "Clear filters");
  assert.equal(reset.getAttribute("aria-controls"), "release-list");
  reset.click();

  assert.equal(statusRadio(page, "all").checked, true);
  assert.equal(countText(page), "1 of 1 release");
  // Focus cannot be left on a button the reset removed from the page.
  assert.equal(page.document.activeElement, statusRadio(page, "all"));
});

test("an empty log offers a different next step from a no-match view", async (t) => {
  const page = await bootedReleases(t, { releases: [] });
  assert.equal(countText(page), "0 of 0 releases");
  const state = page.document.querySelector(".list-state-empty");
  assert.equal(textOf(state.querySelector("h3")), "No releases yet");
  assert.equal(state.querySelector(".release-reset-action"), null, "nothing to clear in a first-run state");

  const record = state.querySelector(".release-empty-action");
  assert.equal(textOf(record), "Record a release");
  assert.equal(record.getAttribute("aria-controls"), "release-form");
  record.click();
  assert.equal(page.document.activeElement, page.document.querySelector("#release-version"));
});

test("a release whose decisions are all missing is still listed and still filterable", async (t) => {
  // The tolerant path: an imported release whose decisions never arrived.
  const page = await bootedReleases(t, {
    decisions: [],
    releases: [{ id: "r-orphan", version: "v9.0.0", title: "Imported", status: "completed", owner: "Rowan", createdAt: "2026-02-01T00:00:00.000Z", decisionIds: ["d-absent"] }],
  });
  assert.deepEqual(rowTitles(page), ["Imported"]);

  statusRadio(page, "missing").click();
  assert.deepEqual(rowTitles(page), ["Imported"]);
  assert.equal(countText(page), "1 of 1 release");
  assert.match(textOf(followUp(page)), /Imported/);

  statusRadio(page, "accepted").click();
  assert.equal(countText(page), "0 of 1 release");
  assert.ok(page.document.querySelector(".release-reset-action"));
});
