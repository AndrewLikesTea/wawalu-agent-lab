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
import { RELEASE_EXPORT_BUTTON_LABEL } from "../src/release-export.js";
import { initReleasesPage } from "../src/releases-page.js";
import { initReleaseDetail } from "../src/release-page.js";
import { buildShiplogExport } from "../src/shiplog-export.js";
import { shiplogExportViolations } from "../src/shiplog-export-schema.js";
import { loadPage, pressEnter, pressSpace, pressTab, textOf, typeText } from "./support/browser.js";

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
  assert.equal(summaryText(page), "1 of 2 decisions linked. “Adopt a durable job queue” is the first linked decision.");

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
  assert.equal(textOf(page.document.querySelector("#release-count")), "Showing 1 release, newest first.");
  assert.equal(
    textOf(page.document.querySelector("#release-record-status")),
    "Recorded “Throughput work” as a completed release, with 1 linked decision.",
  );

  // The form is ready for the next release rather than still holding the last.
  assert.equal(page.document.querySelector("#release-version").value, "");
  assert.equal(page.document.querySelector("#release-released-on").value, "");
  assert.equal(page.document.querySelector("#release-description").value, "");
  assert.equal(optionFor(page, QUEUE_DECISION.title).checked, false);
  assert.equal(summaryText(page), "No decisions linked yet. 2 available.");
});

// --- the ending a recorded release gets (issue #2220) -----------------------
//
// The recorder used to stop at one announced sentence, which left the demo's
// last step — record a release — with no verifiable end: nothing named the
// status that was chosen, nothing offered the record that was written, and
// nothing said where it had gone. These tests hold that ending to the record
// actually stored, not to a string, so the success state cannot claim a
// release, a status, or a destination the browser is not holding.

const successRegion = (page) => page.document.querySelector("#release-record-next");
const successDetailLink = (page) => page.document.querySelector("#release-record-detail");

test("a recorded release is announced by name and status, and the record is offered", async (t) => {
  const page = await openReleases(t, { decisions: [QUEUE_DECISION] });

  // Before anything is recorded there is no ending to show.
  assert.equal(successRegion(page).hidden, true, "the success state is painted before anything was recorded");
  assert.equal(textOf(page.document.querySelector("#release-record-status")), "");

  optionFor(page, QUEUE_DECISION.title).click();
  fillRequired(page, { version: "v4.0.0" });
  fill(page, "release-title", "Queue rollout");
  submit(page);

  // The sentence names this release the way the log names it — by its title,
  // since one was given — and states the status it was filed under.
  const [saved] = stored(page);
  assert.equal(saved.status, "completed");
  assert.equal(
    textOf(page.document.querySelector("#release-record-status")),
    "Recorded “Queue rollout” as a completed release, with 1 linked decision.",
  );

  // The ending is on screen, and the control it offers opens *this* record: the
  // address carries the id that was stored, not a page-level guess.
  assert.equal(successRegion(page).hidden, false, "a stored release left no success state");
  const link = successDetailLink(page);
  assert.equal(link.getAttribute("href"), `/release.html?id=${saved.id}`);
  assert.equal(link.getAttribute("aria-label"), "View release details for Queue rollout");
  assert.equal(textOf(link), "View release details→");
  // By id, not by node. `assert.equal` over two parsed elements makes the
  // harness stringify both subtrees when they differ, so the regression this
  // guards would hang the run past its timeout instead of naming itself.
  assert.equal(page.document.activeElement?.getAttribute("id"), "release-record-detail",
    "success focuses the saved release, not the empty form");
  pressEnter(page.document);
  assert.deepEqual(page.navigations, [`/release.html?id=${saved.id}`], "the success control opened somewhere else");
});

test("the announced status is the one submitted, not the one the form opened on", async (t) => {
  const page = await openReleases(t);

  // Planned, and no title: the sentence falls back to the version the same way
  // every row on this page does.
  page.document.querySelector("#release-form-status").value = "planned";
  fillRequired(page, { version: "v5.0.0", description: "The queue rewrite is scheduled." });
  submit(page);

  assert.equal(stored(page)[0].status, "planned", "the submitted status was not stored");
  assert.equal(
    textOf(page.document.querySelector("#release-record-status")),
    "Recorded “v5.0.0” as a planned release, with no linked decisions.",
    "the announcement told a planned release it had shipped",
  );
  // And the row the visitor can now see agrees with the sentence they were told.
  assert.match(textOf(page.document.querySelectorAll(".release-toggle")[0]), /planned/);
});

test("the success state says the record is browser-only and names the way out", async (t) => {
  const page = await openReleases(t);
  fillRequired(page, { version: "v6.0.0" });
  submit(page);

  const kept = page.document.querySelector("#release-record-kept");
  assert.equal(successRegion(page).hidden, false);
  assert.equal(
    textOf(kept),
    "This release is stored in this browser only. “Export releases as JSON” above takes it with you.",
  );
  // Its own sentence, not the pre-submit scope line reprinted: that one is a
  // promise about any release this form takes, this one is a fact about the
  // record that now exists, and the panel should not say either one twice.
  assert.notEqual(textOf(kept), RECORD_SCOPE);
  assert.equal(
    textOf(page.document.querySelector("#record-release")).split(RECORD_SCOPE).length - 1,
    1,
    "the recorder states where a release is kept twice in the same words",
  );
  // The way out is the control this page actually offers, named in the words on
  // its face rather than a synonym this sentence invented for it.
  const exportButton = page.document.querySelector("#release-export");
  assert.equal(textOf(exportButton), RELEASE_EXPORT_BUTTON_LABEL);
  assert.ok(
    textOf(kept).includes(`“${textOf(exportButton)}”`),
    "the success state names an export control the page does not show",
  );
  // The claim is checked against the behaviour: the record is in this browser's
  // one storage key, and the run completed — an upload would have thrown.
  assert.equal(stored(page).length, 1);
  assert.equal(JSON.parse(page.storage.getItem(RELEASE_STORAGE_KEY))[0].version, "v6.0.0");
  // No promise beyond the storage.
  assert.doesNotMatch(textOf(kept), /account|sign in|sync|back(ed)? up|backup|forever|permanent|always/i);
});

test("a submit the browser refuses leaves an error and no success state", async (t) => {
  const page = await openReleases(t, { decisions: [QUEUE_DECISION] });

  // Everything except the required version, so the form is refused rather than
  // rejected by createRelease.
  fill(page, "release-owner", "Priya");
  fill(page, "release-released-on", "2026-07-02");
  fill(page, "release-description", "The queue shipped.");
  submit(page);

  assert.deepEqual(stored(page), [], "an invalid release was written anyway");
  assert.equal(successRegion(page).hidden, true, "a refused submit painted the success state");
  assert.equal(textOf(page.document.querySelector("#release-record-status")), "");
  // Visible and actionable: it says nothing was recorded and what to do next.
  assert.equal(formError(page).hidden, false, "a refused submit was silent");
  assert.equal(
    textOf(formError(page)),
    "This release was not recorded. Complete every required field in the format its hint describes,"
      + " then record the release again.",
  );
  assert.equal(formError(page).getAttribute("role"), "alert");
});

test("a later invalid submit withdraws the previous release's success state", async (t) => {
  const page = await openReleases(t, { decisions: [QUEUE_DECISION] });

  fillRequired(page, { version: "v7.0.0" });
  submit(page);
  assert.equal(successRegion(page).hidden, false);
  const [first] = stored(page);
  assert.equal(successDetailLink(page).getAttribute("href"), `/release.html?id=${first.id}`);

  // Composing the next release withdraws the last one's ending on the first
  // keystroke, before any submit — which is what a browser that refuses an
  // invalid form outright would otherwise leave standing.
  fill(page, "release-owner", "Mina");
  assert.equal(successRegion(page).hidden, true, "the previous release's success state survived the next keystroke");
  assert.equal(textOf(page.document.querySelector("#release-record-status")), "");

  // And the refused submit that follows adds an error rather than restoring it.
  fill(page, "release-released-on", "2026-07-09");
  fill(page, "release-description", "The cache shipped.");
  submit(page);
  assert.equal(successRegion(page).hidden, true, "a refused submit re-showed the previous release's ending");
  assert.equal(stored(page).length, 1, "the refused submit wrote a second release");
  assert.equal(formError(page).hidden, false);

  // Completing it gives the *new* release its own ending, pointing at the new
  // record rather than the one before it.
  fill(page, "release-version", "v7.0.1");
  submit(page);
  assert.equal(stored(page).length, 2);
  const [second] = stored(page);
  assert.equal(successRegion(page).hidden, false);
  assert.equal(successDetailLink(page).getAttribute("href"), `/release.html?id=${second.id}`);
  assert.equal(
    textOf(page.document.querySelector("#release-record-status")),
    "Recorded “v7.0.1” as a completed release, with no linked decisions.",
  );
  assert.equal(formError(page).hidden, true, "the error from the refused submit outlived the record that fixed it");
});

test("a failed save leaves no success state to open a record that was not written", async (t) => {
  const page = await openReleases(t);

  fillRequired(page, { version: "v8.0.0" });
  submit(page);
  assert.equal(successRegion(page).hidden, false);

  page.storage.setItem = () => { throw new Error("quota"); };
  fill(page, "release-version", "v8.0.1");
  fill(page, "release-released-on", "2026-07-09");
  fill(page, "release-description", "The retry shipped.");
  fill(page, "release-owner", "Priya");
  submit(page);

  assert.equal(page.document.querySelector("#release-storage-notice").hidden, false);
  assert.equal(successRegion(page).hidden, true, "a release that failed to save was offered as a record");
  assert.equal(textOf(page.document.querySelector("#release-record-status")), "");
  assert.equal(stored(page).length, 1, "the failed write appeared to persist");
});

// Where a recorded release goes, and how to take it elsewhere. Asserted on the
// painted page rather than the bytes, and on the order a visitor reads: a
// sentence about the button is only doing its job if it is on screen above the
// button. The claim is checked against the behaviour in the same test — a
// release is recorded and has to land in this browser's storage and nowhere
// else, which the harness enforces by throwing on any undeclared request.
const RECORD_SCOPE = "A release you record here is kept in this browser, on this device:"
  + " it is not sent to the Wawalu team, and a teammate on another browser or device"
  + " will not see it. Use “Export releases as JSON” above to take your releases elsewhere.";

test("the recorder says where a recorded release is kept, above the button that records it", async (t) => {
  const page = await openReleases(t, { decisions: [QUEUE_DECISION] });

  const scope = page.document.querySelector("#release-record-scope");
  assert.ok(scope, "the recorder says nothing about where a recorded release is kept");
  assert.equal(textOf(scope), RECORD_SCOPE);

  // Painted above the submit control, in the form's own reading order.
  const order = page.document.querySelector("#release-form").querySelectorAll("p,button");
  const scopeIndex = order.indexOf(scope);
  const submitIndex = order.findIndex((node) => node.tagName === "BUTTON" && textOf(node) === "Record release");
  assert.ok(submitIndex >= 0, "the recorder has no “Record release” button");
  assert.ok(scopeIndex >= 0 && scopeIndex < submitIndex, "the storage line is painted below the button it is about");

  // The way out is the control the log actually offers, named in the words on
  // its face — not a synonym this sentence invented for it.
  const exportButton = page.document.querySelector("#release-export");
  assert.equal(textOf(exportButton), RELEASE_EXPORT_BUTTON_LABEL);
  assert.ok(
    textOf(scope).includes(`“${textOf(exportButton)}”`),
    "the sentence names the export control by a label the page does not show",
  );
  // And that control is above the recorder, where the sentence says it is.
  const buttons = page.document.querySelectorAll("button");
  assert.ok(
    buttons.indexOf(exportButton) < buttons.indexOf(order[submitIndex]),
    "the export control is not above the recorder the sentence points up at",
  );

  // No claim beyond the storage: nothing about accounts, sync, backup, or how
  // long a record survives.
  assert.doesNotMatch(textOf(scope), /account|sign in|sync|back(ed)? up|backup|forever|permanent|always/i);

  // The claim itself. Recording writes the release into this browser's storage
  // under the one key, and the run completes — an upload would have thrown.
  fillRequired(page, { version: "v1.4.0" });
  submit(page);
  assert.equal(stored(page).length, 1, "the release was not kept in this browser");
  assert.equal(page.storage.getItem(RELEASE_STORAGE_KEY) === null, false);
});

test("more than one decision can be linked, in the order they were picked", async (t) => {
  const page = await openReleases(t, { decisions: [QUEUE_DECISION, CACHE_DECISION] });

  optionFor(page, QUEUE_DECISION.title).click();
  optionFor(page, CACHE_DECISION.title).click();
  // The first tick is the governing decision, and the summary says which.
  assert.equal(summaryText(page), "2 of 2 decisions linked. “Adopt a durable job queue” is the first linked decision.");
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
  assert.equal(summaryText(page), "1 of 2 decisions linked. “Cache the read path” is the first linked decision.");
  assert.equal(page.document.querySelector("#release-owner").value, "Priya", "the typed owner was lost");
  assert.equal(page.document.querySelector("#release-released-on").value, "2026-07-02", "the typed date was lost");

  // Completing the record recovers, and the selection made before the failure
  // is the selection that is stored.
  fill(page, "release-version", "v1.4.1");
  submit(page);
  assert.deepEqual(stored(page)[0].decisionIds, [CACHE_DECISION.id]);
});

test("a release with no decision linked is recorded with an explicit empty association", async (t) => {
  const page = await openReleases(t, { decisions: [QUEUE_DECISION, CACHE_DECISION] });

  // Every native field is complete; the only thing missing is the association
  // that makes this a release log entry rather than a note.
  fillRequired(page, { version: "v3.0.0" });
  submit(page);

  assert.equal(stored(page).length, 1);
  assert.deepEqual(stored(page)[0].decisionIds, []);
  assert.equal(textOf(page.document.querySelector("#release-record-status")), "Recorded “v3.0.0” as a completed release, with no linked decisions.");
  const group = page.document.querySelector("#release-decisions-field");
  assert.equal(group.hasAttribute("aria-invalid"), false);
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
  assert.equal(summaryText(page), "1 of 1 decision linked. “Adopt a durable job queue” is the first linked decision.");
  assert.equal(textOf(page.document.querySelector("#release-record-status")), "");
});

// The frame before the boot: the recorder as a visitor first sees it, with the
// picker still loading. Two elements state that wait — the visible placeholder
// inside the picker and the status line beside it — and they used to state it
// in the same words, stacking one sentence twice in the form.
test("the loading recorder states the wait once, in two different sentences", async (t) => {
  const page = await loadPage(RELEASES_PAGE, { storage: {} });
  t.after(() => page.restore());

  const recorder = textOf(page.document.querySelector("#record-release"));
  assert.equal(recorder.split("Loading decisions to link…").length - 1, 1,
    "the recorder paints the same loading sentence twice");
  assert.match(textOf(page.document.querySelector(".decision-picker-loading")), /Loading decisions to link…/);
  assert.equal(summaryText(page), "No decisions can be linked until the list loads.");
});

// The required date is one field for three statuses, so its hint has to name
// all three days a recorder might be holding — and name the cancelled one
// without saying that release shipped. Asserted on the booted page, because
// the hint a visitor reads is whatever survives the page's own render.
test("the date hint names the day to enter for each status, in the stated format", async (t) => {
  const page = await openReleases(t);

  const field = page.document.querySelector("#release-released-on");
  assert.equal(field.getAttribute("aria-describedby"), "release-released-on-hint");
  const hint = textOf(page.document.querySelector("#release-released-on-hint"));
  assert.equal(hint,
    "The calendar day this release shipped, is planned to ship, or was cancelled, written as YYYY-MM-DD.");
  // Each status the form offers is answered by the hint: shipped, planned, and
  // cancelled, with the format the field is validated against still stated.
  assert.match(hint, /shipped/);
  assert.match(hint, /planned to ship/);
  assert.match(hint, /was cancelled/);
  assert.match(hint, /YYYY-MM-DD/);
  // The one reading it must not permit: a cancelled release having shipped.
  assert.doesNotMatch(hint, /cancelled release shipped/i);
  assert.doesNotMatch(hint, /shipped or is planned/,
    "the hint still leaves a cancelled release with no date to enter");
});

// The Summary is the second field standing for three statuses, and nothing on
// the page rewrites its hint when the status changes — so the one sentence
// authored here is what every recorder reads, and it has to answer all three
// without telling a planned or cancelled release that it shipped.
test("the Summary hint says what to write for each release status", async (t) => {
  const page = await openReleases(t);

  const field = page.document.querySelector("#release-description");
  assert.equal(field.getAttribute("aria-describedby"), "release-description-hint");
  const hint = textOf(page.document.querySelector("#release-description-hint"));
  assert.equal(hint,
    "What shipped, what is planned to ship, or why the release was cancelled, in a sentence or two.");
  // Each status the form offers is answered: the completed release's work, the
  // planned release's intent, and the cancelled release's reason.
  assert.match(hint, /What shipped/);
  assert.match(hint, /planned to ship/);
  assert.match(hint, /why the release was cancelled/);
  // The reading the issue exists to remove: every summary being what shipped.
  assert.doesNotMatch(hint, /^What shipped, in a sentence or two\.$/,
    "a planned or cancelled release is still asked to summarise what shipped");
  // The field a recorder is asked to fill keeps the name the guidance assumes.
  assert.equal(textOf(page.document.querySelector('label[for="release-description"]')), "Summary (required)");
});

// The picker's authored markup now opens on "Loading decisions to link…", so
// the one thing that must never happen is the boot leaving that claim standing.
// A browser that refuses storage is the closest a visitor gets to the log not
// being readable, and it has to settle just like an empty one does.
test("a browser that refuses storage still settles the picker off its loading claim", async (t) => {
  const page = await loadPage(RELEASES_PAGE, { storage: {} });
  t.after(() => page.restore());
  page.storage.getItem = () => { throw new Error("storage is blocked"); };
  initReleasesPage(page.document, page.storage, { seed: NO_DEMO_DATA });

  assert.doesNotMatch(summaryText(page), /Loading/, "the picker is still claiming it is loading");
  assert.equal(summaryText(page), "No decisions are available to link yet.");
  assert.equal(page.document.querySelectorAll(".decision-picker-loading").length, 0);
  assert.match(textOf(page.document.querySelector(".decision-picker-empty")), /No decisions to link yet\./);

  // And the recorder is live rather than a dead form: a release is still
  // recordable when the log behind the picker could not be read.
  fillRequired(page, { version: "v0.2.0" });
  submit(page);
  assert.equal(textOf(page.document.querySelector("#release-record-status")), "Recorded “v0.2.0” as a completed release, with no linked decisions.");
});

test("with no decisions to link, the picker says so and offers the way out", async (t) => {
  const page = await openReleases(t);

  const empty = page.document.querySelector(".decision-picker-empty");
  assert.ok(empty, "the picker rendered no empty state for a log with no decisions");
  assert.match(textOf(empty), /No decisions to link yet\./);
  assert.equal(summaryText(page), "No decisions are available to link yet.");
  const action = page.document.querySelector(".decision-picker-empty-action");
  assert.equal(textOf(action), "Record a decision");
  // The action is a real link to the decision recorder, not a dead end.
  action.click();
  assert.deepEqual(page.navigations, ["/#decision-form"]);

  // With nothing to link, the release remains a valid record.
  fillRequired(page, { version: "v0.1.0", owner: "Mina" });
  submit(page);
  assert.equal(stored(page).length, 1);
  assert.deepEqual(stored(page)[0].decisionIds, []);
  assert.equal(textOf(page.document.querySelector("#release-record-status")), "Recorded “v0.1.0” as a completed release, with no linked decisions.");
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


test("the homepage primary demo reaches Releases and a saved, inspectable outcome", async (t) => {
  const home = await loadPage(new URL("../src/index.html", import.meta.url));
  const action = home.document.querySelector("#core-demo-link");
  action.focus();
  pressEnter(home.document);
  const destination = new URL(home.navigations[0], "https://shiplog.test");
  home.restore();
  assert.equal(destination.pathname, "/releases.html");
  const page = await loadPage(new URL(`../src${destination.pathname}`, import.meta.url));
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage);
  assert.ok(page.document.querySelector(destination.hash), "the demo fragment resolves");
  assert.match(textOf(page.document.querySelector(destination.hash)), /Example|example/);
  optionFor(page, "Adopt a durable job queue").click();
  fillRequired(page, { version: "v2219.0.0" });
  submit(page);
  const saved = stored(page)[0];
  assert.equal(saved.decisionIds.length, 1);
  assert.equal(page.document.activeElement?.getAttribute("id"), "release-record-detail");
  pressEnter(page.document);
  const detailUrl = new URL(page.navigations[0], "https://shiplog.test");
  const storage = { [RELEASE_STORAGE_KEY]: page.storage.getItem(RELEASE_STORAGE_KEY) };
  page.restore();
  const detail = await loadPage(new URL(`../src${detailUrl.pathname}`, import.meta.url), {
    storage, location: { search: detailUrl.search },
  });
  t.after(() => detail.restore());
  initReleaseDetail();
  const content = textOf(detail.document.querySelector("#release-detail"));
  assert.match(content, /v2219.0.0/);
  assert.match(content, /Adopt a durable job queue/);
  assert.match(content, /Background work was lost on deploys/);
});
