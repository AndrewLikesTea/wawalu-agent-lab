// End-to-end regression for recording a release and linking decisions to it.
//
// Every test drives the shipped releases page — the real markup from
// src/releases.html, booted the way the page boots it — and asserts only on
// what a user can see or what the browser is left holding: the ticked options,
// the rendered rows, the announcement, the stored record, and the detail page
// that record then opens.
//
// Determinism: no network (the harness throws on an undeclared request), no
// timers, no sleeps. Each test parses a fresh page and seeds its own storage.
// Generated ids and timestamps are asserted by shape, never by value.

import test from "node:test";
import assert from "node:assert/strict";
import { STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initReleasesPage } from "../src/releases-page.js";
import { initReleaseDetail } from "../src/release-page.js";
import { buildShiplogExport } from "../src/shiplog-export.js";
import { shiplogExportViolations } from "../src/shiplog-export-schema.js";
import { loadPage, pressSpace, pressTab, textOf, typeText } from "./support/browser.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const RELEASE_DETAIL_PAGE = new URL("../src/release.html", import.meta.url);

const QUEUE_DECISION = {
  id: "seed-queue",
  title: "Adopt a durable job queue",
  context: "Background work was lost on deploys.",
  alternatives: "Database polling.",
  owner: "Kai",
  status: "accepted",
  createdAt: "2026-01-02T09:00:00.000Z",
};

const CACHE_DECISION = {
  id: "seed-cache",
  title: "Cache the read path",
  context: "Read latency spikes under load.",
  alternatives: "Query tuning alone.",
  owner: "Ari",
  status: "pending",
  createdAt: "2026-01-03T09:00:00.000Z",
};

// The example records are a module constant the page composes in, not a fetch,
// so a test that wants a log containing only its own fixtures hands the page an
// empty seed. tests/demo-path.test.js is the one that exercises the real seed.
const NO_DEMO_DATA = { decisions: [], releases: [] };

async function openReleases(t, { decisions = [], releases = [], demo = NO_DEMO_DATA } = {}) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(decisions),
      [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
    },
  });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, { seed: demo });
  // Wait on state, not on time: the page marks itself ready once it rendered.
  assert.equal(page.document.documentElement.dataset.shiplogReleases, "ready");
  return page;
}

const stored = (page) => JSON.parse(page.storage.getItem(RELEASE_STORAGE_KEY) ?? "[]");
const optionLabels = (page) => page.document.querySelectorAll(".decision-picker-label").map(textOf);
const summaryText = (page) => textOf(page.document.querySelector("#release-decisions-summary"));

// The checkbox a user would reach for, found the way they find it: by the
// decision's title, through the label that names it.
function optionFor(page, title) {
  const label = page.document.querySelectorAll(".decision-picker-label")
    .find((candidate) => textOf(candidate) === title);
  assert.ok(label, `no linkable decision is titled "${title}"`);
  const input = page.document.getElementById(label.getAttribute("for"));
  assert.ok(input, `the option for "${title}" has no control`);
  return input;
}

function fill(page, id, value) {
  const control = page.document.querySelector(`#${id}`);
  assert.ok(control, `the form has no #${id} field`);
  control.focus();
  typeText(page.document, value);
  return control;
}

function submit(page) {
  page.document.querySelectorAll("button").find((button) => textOf(button) === "Record release").click();
}

// The fields issue #533 requires beyond the linked decisions. Filled through
// one helper so a test that is about the picker does not restate the form.
function fillRequired(page, { version, owner = "Priya", releasedOn = "2026-07-02", description = "The durable queue shipped." } = {}) {
  fill(page, "release-version", version);
  fill(page, "release-owner", owner);
  fill(page, "release-released-on", releasedOn);
  fill(page, "release-description", description);
}

const formError = (page) => page.document.querySelector("#release-form-error");

test("a release is recorded from the page with the decisions it carried", async (t) => {
  const page = await openReleases(t, { decisions: [QUEUE_DECISION, CACHE_DECISION] });

  // The picker offers the decisions in this log, with the status and owner a
  // reader needs to pick the right one.
  assert.deepEqual(optionLabels(page), [QUEUE_DECISION.title, CACHE_DECISION.title]);
  assert.equal(summaryText(page), "No decisions linked yet. 2 available.");

  // Keyboard only: reach the option and link it with Space, the way a native
  // checkbox works.
  optionFor(page, QUEUE_DECISION.title).focus();
  pressSpace(page.document);
  assert.equal(optionFor(page, QUEUE_DECISION.title).checked, true);
  assert.equal(summaryText(page), "1 of 2 decisions linked. “Adopt a durable job queue” governs this release.");

  fillRequired(page, { version: "v1.4.0" });
  fill(page, "release-title", "Throughput work");
  submit(page);

  assert.equal(stored(page).length, 1, "the release was not saved in this browser");
  const [release] = stored(page);
  assert.equal(release.version, "v1.4.0");
  assert.equal(release.owner, "Priya");
  assert.equal(release.title, "Throughput work");
  assert.equal(release.description, "The durable queue shipped.");
  assert.equal(release.status, "completed");
  // The date the user typed, not the moment they pressed the button.
  assert.equal(release.createdAt, "2026-07-02T00:00:00.000Z");
  assert.deepEqual(release.decisionIds, [QUEUE_DECISION.id], "the linked decision's id was not submitted");
  assert.match(release.id, /\S/);

  // The new release is in the history immediately, with its linked decision
  // summarised the same way every other row is.
  const rows = page.document.querySelectorAll(".release-toggle");
  assert.match(textOf(rows[0]), /Throughput work/);
  assert.match(textOf(rows[0]), /1 decision · 1 accepted/);
  assert.equal(textOf(page.document.querySelector("#release-count")), "1 of 1 release");
  assert.equal(
    textOf(page.document.querySelector("#release-record-status")),
    "Recorded v1.4.0 with 1 linked decision.",
  );

  // The form is ready for the next release rather than still holding the last.
  assert.equal(page.document.querySelector("#release-version").value, "");
  assert.equal(page.document.querySelector("#release-released-on").value, "");
  assert.equal(page.document.querySelector("#release-description").value, "");
  assert.equal(optionFor(page, QUEUE_DECISION.title).checked, false);
  assert.equal(summaryText(page), "No decisions linked yet. 2 available.");
});

test("more than one decision can be linked, in the order they were picked", async (t) => {
  const page = await openReleases(t, { decisions: [QUEUE_DECISION, CACHE_DECISION] });

  optionFor(page, QUEUE_DECISION.title).click();
  optionFor(page, CACHE_DECISION.title).click();
  // The first tick is the governing decision, and the summary says which.
  assert.equal(summaryText(page), "2 of 2 decisions linked. “Adopt a durable job queue” governs this release.");
  fillRequired(page, { version: "v2.0.0" });
  submit(page);

  assert.deepEqual(stored(page)[0].decisionIds, [QUEUE_DECISION.id, CACHE_DECISION.id]);
  // Unlinking is the same control again, and the next release records what is
  // ticked now rather than what was ticked before.
  optionFor(page, CACHE_DECISION.title).click();
  optionFor(page, QUEUE_DECISION.title).click();
  optionFor(page, QUEUE_DECISION.title).click();
  fillRequired(page, { version: "v2.0.1", releasedOn: "2026-07-09" });
  submit(page);
  assert.deepEqual(stored(page)[0].decisionIds, [CACHE_DECISION.id]);
  assert.equal(stored(page).length, 2);
});

test("a rejected submit keeps the linked decisions and writes nothing", async (t) => {
  const page = await openReleases(t, { decisions: [QUEUE_DECISION, CACHE_DECISION] });

  optionFor(page, CACHE_DECISION.title).click();
  // Version is required and empty, so the browser refuses the submit.
  fill(page, "release-owner", "Priya");
  fill(page, "release-released-on", "2026-07-02");
  fill(page, "release-description", "The cache shipped.");
  submit(page);

  assert.deepEqual(stored(page), [], "an invalid release was written anyway");
  assert.equal(optionFor(page, CACHE_DECISION.title).checked, true, "the selection was lost with the rejected submit");
  assert.equal(summaryText(page), "1 of 2 decisions linked. “Cache the read path” governs this release.");
  assert.equal(page.document.querySelector("#release-owner").value, "Priya", "the typed owner was lost");
  assert.equal(page.document.querySelector("#release-released-on").value, "2026-07-02", "the typed date was lost");

  // Completing the record recovers, and the selection made before the failure
  // is the selection that is stored.
  fill(page, "release-version", "v1.4.1");
  submit(page);
  assert.deepEqual(stored(page)[0].decisionIds, [CACHE_DECISION.id]);
});

test("a release with no decision linked is refused, explained, and returns focus to the group", async (t) => {
  const page = await openReleases(t, { decisions: [QUEUE_DECISION, CACHE_DECISION] });

  // Every native field is complete; the only thing missing is the association
  // that makes this a release log entry rather than a note.
  fillRequired(page, { version: "v3.0.0" });
  submit(page);

  assert.deepEqual(stored(page), [], "a release with no linked decision was written");
  const error = formError(page);
  assert.equal(error.hidden, false, "the refusal was silent");
  assert.equal(error.getAttribute("role"), "alert", "the refusal is not announced");
  assert.match(textOf(error), /must link at least one decision/);
  // The group is marked invalid and focus lands inside it, so the fix is the
  // next keystroke rather than a hunt back up the form.
  const group = page.document.querySelector("#release-decisions-field");
  assert.equal(group.getAttribute("aria-invalid"), "true");
  assert.equal(page.document.activeElement, optionFor(page, QUEUE_DECISION.title));

  // Acting on the complaint clears it immediately rather than at next submit.
  pressSpace(page.document);
  assert.equal(error.hidden, true, "the alert outlived the problem it reported");
  assert.equal(group.hasAttribute("aria-invalid"), false);

  // Nothing typed was lost, so resubmitting records the release.
  submit(page);
  assert.equal(stored(page).length, 1);
  assert.deepEqual(stored(page)[0].decisionIds, [QUEUE_DECISION.id]);
  assert.equal(stored(page)[0].createdAt, "2026-07-02T00:00:00.000Z");
});

test("a failed save is reported and preserves the release for retry", async (t) => {
  const page = await openReleases(t, { decisions: [QUEUE_DECISION] });
  page.storage.setItem = () => { throw new Error("quota"); };

  optionFor(page, QUEUE_DECISION.title).click();
  fillRequired(page, { version: "v1.5.0" });
  submit(page);

  const notice = page.document.querySelector("#release-storage-notice");
  assert.equal(notice.hidden, false, "a failed save was silent");
  assert.match(textOf(notice), /could not be saved in this browser/);
  assert.equal(notice.getAttribute("role"), "alert");
  assert.deepEqual(stored(page), [], "a failed write appeared to persist");
  const rows = page.document.querySelectorAll(".release-toggle");
  assert.equal(rows.length, 0, "history contains a phantom release that will disappear on reload");
  assert.equal(page.document.querySelector("#release-version").value, "v1.5.0");
  assert.equal(page.document.querySelector("#release-owner").value, "Priya");
  assert.equal(optionFor(page, QUEUE_DECISION.title).checked, true);
  assert.equal(summaryText(page), "1 of 1 decision linked. “Adopt a durable job queue” governs this release.");
  assert.equal(textOf(page.document.querySelector("#release-record-status")), "");
});

test("with no decisions to link, the picker says so and offers the way out", async (t) => {
  const page = await openReleases(t);

  const empty = page.document.querySelector(".decision-picker-empty");
  assert.ok(empty, "the picker rendered no empty state for a log with no decisions");
  assert.match(textOf(empty), /No decisions to link yet\./);
  assert.equal(summaryText(page), "No decisions are available to link yet.");
  const action = page.document.querySelector(".decision-picker-empty-action");
  assert.match(textOf(action), /Record a decision first/);
  // The action is a real link to the decision recorder, not a dead end.
  action.click();
  assert.deepEqual(page.navigations, ["/#decision-form"]);

  // With nothing to link, no release can be recorded: the refusal names the
  // reason and the empty state above it names the way out, so this is a
  // signposted dead end rather than a silent one.
  fillRequired(page, { version: "v0.1.0", owner: "Mina" });
  submit(page);
  assert.deepEqual(stored(page), [], "a release was recorded with no decision to link");
  assert.match(textOf(formError(page)), /must link at least one decision/);
  assert.equal(textOf(page.document.querySelector("#release-record-status")), "");
});

test("the picker is a keyboard-reachable group inside the form's tab order", async (t) => {
  const page = await openReleases(t, { decisions: [QUEUE_DECISION, CACHE_DECISION] });

  page.document.querySelector("#release-description").focus();
  // Every option is its own tab stop, in the order they are listed, and the
  // submit button follows the group.
  const reached = [];
  for (let step = 0; step < 3; step += 1) reached.push(pressTab(page.document));
  assert.deepEqual(
    reached.slice(0, 2).map((element) => element.id),
    [optionFor(page, QUEUE_DECISION.title).id, optionFor(page, CACHE_DECISION.title).id],
    "the decision options are not the next tab stops after the form's fields",
  );
  assert.ok(
    reached.some((element) => element.tagName === "BUTTON" && textOf(element) === "Record release"),
    "the submit button is not reachable from the picker",
  );
});

test("a recorded release opens a detail page listing each linked decision", async (t) => {
  const recorder = await openReleases(t, { decisions: [QUEUE_DECISION, CACHE_DECISION] });
  optionFor(recorder, QUEUE_DECISION.title).click();
  fillRequired(recorder, { version: "v1.6.0" });
  submit(recorder);
  const [saved] = stored(recorder);
  recorder.restore();

  const page = await loadPage(RELEASE_DETAIL_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify([QUEUE_DECISION, CACHE_DECISION]),
      [RELEASE_STORAGE_KEY]: JSON.stringify([saved]),
    },
    location: { search: `?id=${saved.id}` },
  });
  t.after(() => page.restore());
  initReleaseDetail();

  const detail = page.document.querySelector("#release-detail");
  assert.equal(detail.getAttribute("aria-busy"), "false", "the detail view never left its loading state");
  assert.match(textOf(detail.querySelector(".detail-summary")), /1 decision · 1 accepted/);
  assert.match(textOf(detail.querySelector(".detail-notes")), /The durable queue shipped\./);
  // The recorded calendar day is what the detail view dates the release by.
  assert.equal(detail.querySelector(".date").getAttribute("datetime"), "2026-07-02T00:00:00.000Z");

  const linked = detail.querySelectorAll(".detail-decision");
  assert.equal(linked.length, 1);
  assert.equal(textOf(linked[0].querySelector(".detail-decision-title")), QUEUE_DECISION.title);
  assert.equal(textOf(linked[0].querySelector("code")), QUEUE_DECISION.id);
  assert.equal(textOf(linked[0].querySelector(".badge")), "accepted");
  assert.match(textOf(linked[0].querySelector(".detail-decision-owner")), /Kai/);
  assert.equal(linked[0].href, `/decision.html?id=${QUEUE_DECISION.id}`);
});

test("a recorded release exports with its decision associations intact", async (t) => {
  const page = await openReleases(t, { decisions: [QUEUE_DECISION, CACHE_DECISION] });
  optionFor(page, CACHE_DECISION.title).click();
  optionFor(page, QUEUE_DECISION.title).click();
  fillRequired(page, { version: "v1.7.0", description: "Queue and cache shipped together." });
  fill(page, "release-title", "Throughput work");
  submit(page);

  const { payload, unresolvedLinks, droppedFields } = buildShiplogExport(page.storage, {
    generatedAt: "2026-07-03T00:00:00.000Z",
  });

  // Explicit shape: exactly the declared fields, in declaration order, with the
  // association order the user picked. No field the recorder writes is dropped
  // on the way out, and no link goes unresolved.
  assert.equal(payload.releases.length, 1);
  const [exported] = payload.releases;
  assert.deepEqual(Object.keys(exported), ["id", "version", "title", "description", "owner", "status", "createdAt", "decisionIds"]);
  assert.deepEqual(exported.decisionIds, [CACHE_DECISION.id, QUEUE_DECISION.id]);
  assert.equal(exported.createdAt, "2026-07-02T00:00:00.000Z");
  assert.equal(exported.description, "Queue and cache shipped together.");
  assert.deepEqual(unresolvedLinks, []);
  assert.deepEqual(droppedFields, [], "the recorder wrote a field the export schema does not declare");
  // Every association resolves to a decision that travels in the same file.
  const exportedDecisionIds = new Set(payload.decisions.map(({ id }) => id));
  assert.ok(exported.decisionIds.every((id) => exportedDecisionIds.has(id)));
  assert.deepEqual(shiplogExportViolations(payload), []);
});

test("a release whose decision is gone says so instead of dropping it", async (t) => {
  const orphaned = {
    id: "r-orphan",
    version: "v0.9.0",
    owner: "Mina",
    status: "completed",
    createdAt: "2026-02-01T09:00:00.000Z",
    decisionIds: [QUEUE_DECISION.id, "archived-decision"],
  };
  const page = await loadPage(RELEASE_DETAIL_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify([QUEUE_DECISION]),
      [RELEASE_STORAGE_KEY]: JSON.stringify([orphaned]),
    },
    location: { search: `?id=${orphaned.id}` },
  });
  t.after(() => page.restore());
  initReleaseDetail();

  const detail = page.document.querySelector("#release-detail");
  assert.match(textOf(detail.querySelector(".detail-summary")), /2 decisions · 1 accepted, 1 missing/);
  const missing = detail.querySelector(".detail-decision-missing");
  assert.ok(missing, "the dangling reference was dropped rather than reported");
  assert.match(textOf(missing), /archived-decision is not in this log/);
});

test("a release with nothing linked says so on its detail page", async (t) => {
  const page = await loadPage(RELEASE_DETAIL_PAGE, {
    storage: {
      [RELEASE_STORAGE_KEY]: JSON.stringify([{
        id: "r-infra",
        version: "v0.8.0",
        owner: "Mina",
        status: "completed",
        createdAt: "2026-02-02T09:00:00.000Z",
        decisionIds: [],
      }]),
    },
    location: { search: "?id=r-infra" },
  });
  t.after(() => page.restore());
  initReleaseDetail();

  const detail = page.document.querySelector("#release-detail");
  assert.equal(textOf(detail.querySelector(".release-empty")), "No decisions linked to this release.");
  assert.equal(detail.querySelectorAll(".detail-decision").length, 0);
});
