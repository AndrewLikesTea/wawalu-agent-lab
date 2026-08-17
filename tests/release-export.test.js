// Exporting the release log a visitor is looking at, as JSON (issue #1760).
//
// The property under test is that the two halves agree: whatever the search and
// the filters left on screen is exactly what lands in the file, with the same
// linked decisions and the same example labelling the rows carry. So the pure
// builder is asserted directly, and then the shipped src/releases.html is driven
// through the control with real filter changes and the resulting download is
// parsed back and compared against the rendered rows.
//
// Determinism: no network, no timers, no sleeps. Every test seeds its own
// fixtures and passes its own clock; nothing depends on the shipped examples.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EXAMPLE_RECORDS_NOTICE,
  RELEASE_EXPORT_BUTTON_LABEL,
  RELEASE_EXPORT_FAILED,
  RELEASE_EXPORT_SCHEMA,
  RELEASE_EXPORT_SCOPE_SENTENCE,
  RELEASE_EXPORT_VERSION,
  buildReleaseExport,
  downloadReleaseExport,
  releaseExportFilename,
  releaseExportStatusText,
} from "../src/release-export.js";
import { RELEASE_STORAGE_KEY, filterReleases, summarizeReleases } from "../src/releases.js";
import { STORAGE_KEY } from "../src/app.js";
import { initReleasesPage } from "../src/releases-page.js";
import { loadPage, textOf, typeText } from "./support/browser.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const HOME_PAGE = new URL("../src/index.html", import.meta.url);
const NO_SEED = { decisions: [], releases: [] };
const AT = "2026-08-15T18:30:00.000Z";

const DECISIONS = [
  { id: "d-queue", title: "Adopt a durable queue", context: "Retries are required.", alternatives: "Polling.", owner: "Kai", status: "accepted", createdAt: "2026-01-02T09:00:00.000Z" },
  { id: "d-cache", title: "Cache the read path", context: "Read latency spikes.", alternatives: "Query tuning.", owner: "Ari", status: "pending", createdAt: "2026-01-03T09:00:00.000Z" },
  { id: "d-flags", title: "Ship behind feature flags", context: "Staged rollout.", alternatives: "Release branches.", owner: "Priya", status: "proposed", createdAt: "2026-01-04T09:00:00.000Z" },
];

// Newest first once sorted: flags, repair, read path, queue. "repair" links a
// decision this log does not hold — the dangling reference an import leaves.
const RELEASES = [
  { id: "r-queue", version: "v1.1.0", title: "Queue work", description: "The durable queue shipped.", status: "completed", owner: "Kai", createdAt: "2026-02-01T00:00:00.000Z", decisionIds: ["d-queue"] },
  { id: "r-read", version: "v1.2.0", title: "Read path", description: "Caching went out.", status: "completed", owner: "Ari", createdAt: "2026-03-01T00:00:00.000Z", decisionIds: ["d-cache"] },
  { id: "r-repair", version: "v1.3.0", title: "Import repair", description: "Imported records reconnected.", status: "planned", owner: "Rowan", createdAt: "2026-04-01T00:00:00.000Z", decisionIds: ["d-queue", "d-gone"] },
  { id: "r-flags", version: "v1.4.0", title: "Flag rollout", description: "Flags landed.", status: "completed", owner: "Priya", createdAt: "2026-05-01T00:00:00.000Z", decisionIds: ["d-flags"] },
];

const shownFor = (filters) => filterReleases(RELEASES, DECISIONS, filters);
const idsOf = (payload) => payload.releases.map((release) => release.id);

// --- the payload -----------------------------------------------------------

test("the file carries the filtered releases, in the order they are shown", () => {
  const payload = buildReleaseExport(shownFor({ query: "" }), { generatedAt: AT });
  assert.deepEqual(idsOf(payload), ["r-flags", "r-repair", "r-read", "r-queue"]);

  // Narrowed by release status: only the planned one, and never the other three.
  const planned = buildReleaseExport(shownFor({ status: "planned" }), { generatedAt: AT });
  assert.deepEqual(idsOf(planned), ["r-repair"]);
  assert.equal(planned.release_count, 1);

  // Narrowed by search: the selection, in the same newest-first order the list
  // draws, rather than in the order storage happened to hold it.
  const searched = buildReleaseExport(shownFor({ query: "the" }), { generatedAt: AT });
  assert.deepEqual(idsOf(searched), ["r-read", "r-queue"]);
});

test("each exported release carries its linked decisions, not just their ids", () => {
  const payload = buildReleaseExport(shownFor({ status: "planned" }), { generatedAt: AT });
  const [repair] = payload.releases;
  // The linkage in association order, with the fields the row shows.
  assert.deepEqual(repair.decisions.map((decision) => decision.id), ["d-queue"]);
  assert.equal(repair.decisions[0].title, "Adopt a durable queue");
  assert.equal(repair.decisions[0].status, "accepted");
  assert.equal(repair.decisions[0].owner, "Kai");
  // The ids stay too, so a consumer can see that the release recorded two links
  // and that one of them names a decision this browser no longer holds.
  assert.deepEqual(repair.decisionIds, ["d-queue", "d-gone"]);
  assert.deepEqual(repair.missingDecisionIds, ["d-gone"]);
});

test("the envelope labels the data as example records, in the page's own words", () => {
  const payload = buildReleaseExport(shownFor({}), { generatedAt: AT });
  assert.equal(payload.schema, RELEASE_EXPORT_SCHEMA);
  assert.equal(payload.version, RELEASE_EXPORT_VERSION);
  assert.equal(payload.generatedAt, AT);
  assert.equal(payload.notice, EXAMPLE_RECORDS_NOTICE);
  assert.match(payload.notice, /no customer or production data/);
  assert.equal(payload.release_count, payload.releases.length);
});

// The exported file mixes the visitor's own releases with the seeded examples,
// so the notice stays the "Includes example records" phrasing the home page
// prints over that same composed log. The Releases page states the narrower
// fact about its one worked example instead, and no longer carries this one.
test("the notice is the sentence the record log already prints", async () => {
  const html = await readFile(HOME_PAGE, "utf8");
  assert.ok(
    html.includes(EXAMPLE_RECORDS_NOTICE),
    "the file's disclaimer is a second phrasing of the page's, which is how the two drift apart",
  );
});

test("a release the visitor has not taken over is flagged as an example", () => {
  const payload = buildReleaseExport(shownFor({}), {
    generatedAt: AT,
    exampleIds: new Set(["r-flags"]),
  });
  const flagged = payload.releases.filter((release) => release.example).map((release) => release.id);
  assert.deepEqual(flagged, ["r-flags"], "the badge a row carries is a field on the record");
  assert.equal(payload.releases.find((release) => release.id === "r-queue").example, false);
});

test("the file writes declared fields only, not the renderer's resolution artifacts", () => {
  const [release] = buildReleaseExport(shownFor({ status: "planned" }), { generatedAt: AT }).releases;
  assert.deepEqual(Object.keys(release), [
    "id", "version", "title", "description", "owner", "status", "createdAt", "decisionIds",
    "example", "decisions", "missingDecisionIds",
  ]);
  // `associations` and `counts` are things the list computes to draw a row; a
  // file that carried them would be exporting the view's internals.
  assert.equal(release.associations, undefined);
  assert.equal(release.counts, undefined);
});

test("filters matching nothing export an empty record set, never the whole log", () => {
  const none = shownFor({ query: "nothing matches this" });
  assert.equal(none.length, 0, "the fixture really does select nothing");
  const payload = buildReleaseExport(none, { generatedAt: AT });
  assert.deepEqual(payload.releases, []);
  assert.equal(payload.release_count, 0);
  // Same envelope, same labelling: an empty file is still a Shiplog file that
  // says what it is, and it is not silently the unfiltered log.
  assert.equal(payload.schema, RELEASE_EXPORT_SCHEMA);
  assert.equal(payload.version, RELEASE_EXPORT_VERSION);
  assert.equal(payload.notice, EXAMPLE_RECORDS_NOTICE);
});

test("the builder is pure: no DOM, no clock of its own, no second filter", () => {
  const shown = shownFor({});
  const before = JSON.stringify(shown);
  const payload = buildReleaseExport(shown, { generatedAt: AT });
  assert.equal(JSON.stringify(shown), before, "the rendered selection is not mutated");
  // Handed a selection, it exports that selection — it does not go looking for
  // the releases it was not given.
  assert.deepEqual(idsOf(buildReleaseExport(summarizeReleases([RELEASES[0]], DECISIONS), { generatedAt: AT })), ["r-queue"]);
  assert.deepEqual(idsOf(buildReleaseExport([], { generatedAt: AT })), []);
  assert.equal(payload.releases.length, 4);
});

test("a malformed selection degrades rather than throwing", () => {
  assert.equal(buildReleaseExport(undefined, { generatedAt: AT }).release_count, 0);
  assert.equal(buildReleaseExport(null, { generatedAt: AT }).release_count, 0);
  const [bare] = buildReleaseExport([{ id: "r-bare", version: "v0", createdAt: AT, decisionIds: [] }], { generatedAt: AT }).releases;
  assert.deepEqual(bare.decisions, []);
  assert.deepEqual(bare.missingDecisionIds, []);
});

// --- the status line and the filename --------------------------------------

test("the status line states the count that landed, zero included", () => {
  assert.equal(releaseExportStatusText(1), "Exported 1 release to a JSON file, matching what the filters are showing.");
  assert.equal(releaseExportStatusText(4), "Exported 4 releases to a JSON file, matching what the filters are showing.");
  assert.equal(releaseExportStatusText(0), "Exported 0 releases to a JSON file, matching what the filters are showing.");
});

test("the filename names the instant and never needs escaping", () => {
  assert.equal(releaseExportFilename({ generatedAt: AT }), "shiplog-releases-2026-08-15T18-30-00Z.json");
  assert.equal(releaseExportFilename({ generatedAt: "not a date" }), "shiplog-releases.json");
  assert.equal(releaseExportFilename({}), "shiplog-releases.json");
});

// --- the download side effect ----------------------------------------------

test("the download no-ops where Blob or createObjectURL are missing", () => {
  const payload = buildReleaseExport(shownFor({}), { generatedAt: AT });
  const documentRef = { createElement: () => ({ click() {} }) };
  const urlApi = { createObjectURL: () => "blob:x", revokeObjectURL() {} };
  assert.equal(downloadReleaseExport(payload, { document: documentRef, urlApi: {}, Blob: class {} }), false);
  assert.equal(downloadReleaseExport(payload, { document: {}, urlApi, Blob: class {} }), false);

  // And with no Blob in the environment at all: the guard is a capability check
  // rather than an argument check, so a browser without one gets a stated
  // failure instead of a click handler that throws.
  const saved = Object.getOwnPropertyDescriptor(globalThis, "Blob");
  try {
    Object.defineProperty(globalThis, "Blob", { value: undefined, configurable: true, writable: true });
    assert.equal(downloadReleaseExport(payload, { document: documentRef, urlApi }), false);
  } finally {
    Object.defineProperty(globalThis, "Blob", saved);
  }
});

test("a download that could not be written is said out loud, not swallowed", async (t) => {
  const page = await loadPage(RELEASES_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(DECISIONS),
      [RELEASE_STORAGE_KEY]: JSON.stringify(RELEASES),
    },
  });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, { seed: NO_SEED, download: () => false });

  exportButton(page).click();
  assert.equal(page.downloads.length, 0);
  assert.equal(exportStatus(page), RELEASE_EXPORT_FAILED);
  assert.match(exportStatus(page), /Nothing on this page changed/);
});

test("the download revokes the object URL it created", () => {
  const payload = buildReleaseExport(shownFor({}), { generatedAt: AT });
  const created = [];
  const revoked = [];
  const link = { click() { link.clicked = true; } };
  const written = downloadReleaseExport(payload, {
    document: { createElement: () => link },
    Blob: class { constructor(parts) { created.push(parts.join("")); } },
    urlApi: { createObjectURL: () => "blob:release-export", revokeObjectURL: (href) => revoked.push(href) },
  });
  assert.equal(written, true);
  assert.equal(link.clicked, true);
  assert.equal(link.download, "shiplog-releases-2026-08-15T18-30-00Z.json");
  assert.deepEqual(revoked, ["blob:release-export"], "an object URL left alive is a leaked reference to the file");
  assert.deepEqual(idsOf(JSON.parse(created[0])), ["r-flags", "r-repair", "r-read", "r-queue"]);
});

// --- the shipped page ------------------------------------------------------

async function bootedReleases(t) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(DECISIONS),
      [RELEASE_STORAGE_KEY]: JSON.stringify(RELEASES),
    },
  });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, { seed: NO_SEED, now: () => new Date(AT) });
  assert.equal(page.document.documentElement.dataset.shiplogReleases, "ready");
  return page;
}

const exportButton = (page) => page.document.querySelector("#release-export");
const exportStatus = (page) => textOf(page.document.querySelector("#release-export-status"));
const rowIds = (page) => page.document.querySelectorAll(".release-toggle").map((node) => node.dataset.releaseId);

test("the control is a button whose own label says it writes JSON", async (t) => {
  const page = await bootedReleases(t);
  const button = exportButton(page);
  assert.equal(button.tagName, "BUTTON", "an anchor would need its keyboard behaviour rebuilt by hand");
  assert.equal(button.type, "button", "a bare button inside a form region would submit it");
  assert.equal(textOf(button), RELEASE_EXPORT_BUTTON_LABEL);
  assert.match(textOf(button), /JSON/, "the label itself states the format the press produces");
  assert.equal(button.disabled, false, "the control is operable before anything has been filtered");
});

test("the scope of the export is stated in visible text beside the control", async (t) => {
  const page = await bootedReleases(t);
  const scope = page.document.querySelector("#release-export-scope");
  assert.equal(textOf(scope), RELEASE_EXPORT_SCOPE_SENTENCE);
  assert.match(textOf(scope), /not the whole log/);
  // Named by the control, so a screen reader hears the scope with the button.
  assert.equal(exportButton(page).getAttribute("aria-describedby"), "release-export-scope");
  // Visible markup, not a collapsed disclosure: the sentence has no ancestor
  // that folds it away or hides it.
  for (let node = scope; node; node = node.parentNode) {
    assert.ok(!node.hidden, `${node.tagName} hides the scope sentence`);
    assert.notEqual(node.tagName, "DETAILS", "a disclosure would hide the scope until it is opened");
  }
});

test("the status region is a polite live region that starts empty", async (t) => {
  const page = await bootedReleases(t);
  const status = page.document.querySelector("#release-export-status");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(textOf(status), "", "nothing is claimed before a press");
});

test("pressing the control downloads the rendered releases and says how many", async (t) => {
  const page = await bootedReleases(t);
  assert.deepEqual(rowIds(page), ["r-flags", "r-repair", "r-read", "r-queue"]);

  exportButton(page).click();
  assert.equal(page.downloads.length, 1, "the control produced no download");
  assert.equal(page.downloads[0].filename, "shiplog-releases-2026-08-15T18-30-00Z.json");

  const payload = JSON.parse(page.downloads[0].text);
  assert.deepEqual(idsOf(payload), rowIds(page), "the file is not what the page is showing");
  assert.equal(payload.release_count, rowIds(page).length);
  assert.equal(payload.notice, EXAMPLE_RECORDS_NOTICE);
  assert.equal(exportStatus(page), releaseExportStatusText(4));
  assert.match(exportStatus(page), /4 releases/);
});

test("a narrowed view exports only what it is showing, and counts it the same", async (t) => {
  const page = await bootedReleases(t);
  page.document.querySelector("#release-search").focus();
  typeText(page.document, "caching");
  assert.deepEqual(rowIds(page), ["r-read"], "the search really did narrow the list");
  assert.equal(textOf(page.document.querySelector("#release-count")), "Showing 1 of 4 releases, newest first.");

  exportButton(page).click();
  const payload = JSON.parse(page.downloads.at(-1).text);
  assert.deepEqual(idsOf(payload), ["r-read"]);
  assert.equal(payload.release_count, 1);
  assert.equal(payload.releases[0].decisions[0].title, "Cache the read path");
  assert.equal(exportStatus(page), releaseExportStatusText(1));
  assert.match(exportStatus(page), /1 release to a JSON file/);
});

test("the export follows a filter changed after the page loaded", async (t) => {
  const page = await bootedReleases(t);
  exportButton(page).click();
  assert.equal(JSON.parse(page.downloads.at(-1).text).release_count, 4);

  // Narrow to the releases carrying a pending decision, through the control a
  // visitor would use rather than by calling the filter directly.
  page.document.querySelector("#release-decision-status-pending").click();
  assert.deepEqual(rowIds(page), ["r-read"]);

  exportButton(page).click();
  assert.deepEqual(idsOf(JSON.parse(page.downloads.at(-1).text)), ["r-read"]);
  assert.equal(exportStatus(page), releaseExportStatusText(1));
});

test("filters matching nothing write the empty envelope and say zero, not the log", async (t) => {
  const page = await bootedReleases(t);
  page.document.querySelector("#release-search").focus();
  typeText(page.document, "zzz no release says this");
  assert.deepEqual(rowIds(page), []);
  assert.equal(textOf(page.document.querySelector("#release-count")), "");

  // Enabled, and the press is not silent: it writes the empty record set with
  // the same envelope and states the zero.
  assert.equal(exportButton(page).disabled, false);
  exportButton(page).click();
  const payload = JSON.parse(page.downloads.at(-1).text);
  assert.deepEqual(payload.releases, []);
  assert.equal(payload.release_count, 0);
  assert.equal(payload.notice, EXAMPLE_RECORDS_NOTICE);
  assert.equal(payload.schema, RELEASE_EXPORT_SCHEMA);
  assert.equal(exportStatus(page), releaseExportStatusText(0));
  assert.match(exportStatus(page), /Exported 0 releases/);
});
