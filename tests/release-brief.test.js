// The copyable buyer brief on the Releases page (issue #2213).
//
// Two surfaces, tested separately because they can fail separately:
//
//   * `buildReleaseBrief` is pure — record in, plain string out — so the words a
//     reader pastes into a mail or a board pack are asserted directly rather
//     than read back out of rendered markup. This is where the truthfulness
//     lines live, and where they are held.
//   * the shipped src/releases.html is driven through the control itself: a row
//     is expanded, the button is pressed with an injected clipboard, and the
//     status line is read for both outcomes. The writer is injected through
//     `initReleasesPage`, not monkeypatched onto a global, so nothing here
//     depends on the order the tests happen to run in.
//
// Determinism: no network, no timers, no sleeps, no shipped seed. Every test
// supplies its own fixtures and its own clipboard.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  NO_SUMMARY_TEXT,
  RELEASE_BRIEF_BROWSER_LINE,
  RELEASE_BRIEF_BUTTON_LABEL,
  RELEASE_BRIEF_COPIED_STATUS,
  RELEASE_BRIEF_COPY_FAILED_STATUS,
  RELEASE_BRIEF_EXAMPLE_LINE,
  RELEASE_STORAGE_KEY,
  buildReleaseBrief,
  summarizeReleases,
} from "../src/releases.js";
import { STORAGE_KEY } from "../src/app.js";
import { initReleasesPage } from "../src/releases-page.js";
import { loadPage, textOf, typeText } from "./support/browser.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);

const DECISIONS = [
  { id: "d-queue", title: "Adopt a durable queue", context: "Retries are required.", owner: "Kai", status: "accepted", createdAt: "2026-01-02T09:00:00.000Z" },
  { id: "d-cache", title: "Cache the read path", context: "Read latency spikes.", owner: "Ari", status: "pending", createdAt: "2026-01-03T09:00:00.000Z" },
  { id: "d-flags", title: "Ship behind feature flags", context: "Staged rollout.", owner: "Priya", status: "proposed", createdAt: "2026-01-04T09:00:00.000Z" },
];

// One release the visitor recorded in this browser, and one shipped example.
const RECORDED = {
  id: "r-read",
  version: "v1.2.0",
  title: "Read path",
  description: "Caching went out behind the flag.",
  status: "completed",
  owner: "Ari",
  createdAt: "2026-03-01T00:00:00.000Z",
  decisionIds: ["d-cache", "d-queue"],
};
const SEEDED = {
  id: "r-sample",
  version: "v0.9.0",
  title: "Sample rollout",
  description: "An invented release, for the tour.",
  status: "planned",
  owner: "Rowan",
  createdAt: "2026-02-01T00:00:00.000Z",
  decisionIds: ["d-flags"],
};

const briefFor = (release, options) => buildReleaseBrief(release, DECISIONS, options);

// --- the words ------------------------------------------------------------

test("a brief carries the release's own fields, each on its own line", () => {
  const brief = briefFor(RECORDED);
  assert.match(brief, /^Release brief: v1\.2\.0 — Read path$/m, "the version and the title head the brief");
  assert.match(brief, /^Release date: 2026-03-01$/m, "a calendar day, not a locale-formatted one");
  assert.match(brief, /^Status: Completed$/m);
  assert.match(brief, /^Owner: Ari$/m);
  assert.match(brief, /^Summary: Caching went out behind the flag\.$/m);
});

test("a record with several linked decisions names every one of them, with its status", () => {
  const brief = briefFor(RECORDED);
  assert.match(brief, /^Linked decisions \(2\):$/m, "the log's one term for these, and the count of them");
  // Association order, which is the order the recorder ticked them in.
  assert.match(brief, /^- Cache the read path — Pending$/m);
  assert.match(brief, /^- Adopt a durable queue — Accepted$/m);
  assert.ok(
    brief.indexOf("Cache the read path") < brief.indexOf("Adopt a durable queue"),
    "the brief must keep the order the release recorded, not re-sort it",
  );
});

test("a missing linked decision is reported, never quietly dropped", () => {
  const brief = briefFor({ ...RECORDED, decisionIds: ["d-queue", "d-gone"] });
  assert.match(brief, /^Linked decisions \(2\):$/m);
  // The words the Releases page's expanded row and its filter option use.
  assert.match(brief, /^- Linked decision d-gone is missing\.$/m);
  assert.doesNotMatch(brief, /this log/);
});

test("a release with nothing linked still produces a whole, honest brief", () => {
  const brief = briefFor({ ...RECORDED, decisionIds: [] });
  assert.ok(brief.trim() !== "", "an unlinked release is still a release");
  assert.match(brief, /^Release brief: v1\.2\.0 — Read path$/m);
  assert.match(brief, /^Owner: Ari$/m);
  // The sentence the collapsed row and the detail view already use.
  assert.match(brief, /^No decisions linked to this release\.$/m);
  assert.doesNotMatch(brief, /^Linked decisions/m, "there is no count to state");
  assert.match(brief, /not a shared hosted record/, "the disclosure is not conditional on having decisions");
});

test("missing fields are stated rather than left blank or invented", () => {
  const bare = briefFor({ id: "r-bare", version: "v0.0.1", createdAt: "not a date", decisionIds: [] });
  assert.match(bare, /^Release brief: v0\.0\.1$/m, "a release with no title of its own is named once, not twice");
  assert.match(bare, /^Release date: Unknown$/m);
  assert.match(bare, /^Owner: Unknown$/m);
  assert.match(bare, new RegExp(`^Summary: ${NO_SUMMARY_TEXT}$`, "m"));
  // A record with no status is the log's default, not an empty word.
  assert.match(bare, /^Status: Completed$/m);
});

// --- the two disclosures ---------------------------------------------------

test("a sample record says it is demonstration data and not a customer result", () => {
  const brief = briefFor(SEEDED, { example: true });
  assert.ok(brief.includes(RELEASE_BRIEF_EXAMPLE_LINE), "the example line must be on the brief verbatim");
  assert.match(brief, /not a customer result/);
  assert.match(brief, /demonstrate Shiplog/);
  // An invented record is not something the visitor wrote, so the brief must
  // not claim their browser is where it lives.
  assert.ok(!brief.includes(RELEASE_BRIEF_BROWSER_LINE), "a seeded example is not a record stored in this browser");
  assert.doesNotMatch(brief, /stored only in this browser/);
});

test("a record made in this browser says so, and claims nothing about customers", () => {
  const brief = briefFor(RECORDED);
  assert.ok(brief.includes(RELEASE_BRIEF_BROWSER_LINE), "the browser-local line must be on the brief verbatim");
  assert.match(brief, /stored only in this browser/);
  // Not Social's wording: those posts are hosted and public, these are not.
  assert.match(brief, /not a shared hosted record/);
  assert.ok(!brief.includes(RELEASE_BRIEF_EXAMPLE_LINE));
  // The one word a brief about a visitor's own release must not imply.
  assert.doesNotMatch(brief, /customer/i, "a real record must not be labelled — or unlabelled — as a customer result");
});

test("exactly one disclosure, and it is the last thing the brief says", () => {
  for (const [release, expected] of [[RECORDED, RELEASE_BRIEF_BROWSER_LINE], [SEEDED, RELEASE_BRIEF_EXAMPLE_LINE]]) {
    const brief = buildReleaseBrief(release, DECISIONS, { example: release === SEEDED });
    const lines = brief.split("\n");
    assert.equal(lines.at(-1), expected, "the provenance is where a reader stops reading");
    assert.equal(
      lines.filter((line) => line === RELEASE_BRIEF_BROWSER_LINE || line === RELEASE_BRIEF_EXAMPLE_LINE).length,
      1,
      "two provenance lines on one record is two claims about one record",
    );
  }
});

// --- the shape of the function --------------------------------------------

test("the builder is pure: no clock, no DOM, no mutation of what it was handed", () => {
  const release = { ...RECORDED, decisionIds: [...RECORDED.decisionIds] };
  const before = JSON.stringify({ release, DECISIONS });
  assert.equal(buildReleaseBrief(release, DECISIONS), buildReleaseBrief(release, DECISIONS));
  assert.equal(JSON.stringify({ release, DECISIONS }), before, "the record and the log are left as they were");
});

test("a resolved release can be passed on its own, and reads the same", () => {
  const [resolved] = summarizeReleases([RECORDED], DECISIONS);
  assert.equal(buildReleaseBrief(resolved), buildReleaseBrief(RECORDED, DECISIONS));
});

test("a malformed record degrades to a stated brief rather than throwing", () => {
  for (const value of [{}, { id: "r-x" }, { id: "r-y", decisionIds: "not an array" }]) {
    const brief = buildReleaseBrief(value, DECISIONS);
    assert.match(brief, /^Release brief: Unknown version$/m);
    assert.match(brief, /^No decisions linked to this release\.$/m);
  }
});

// --- the shipped page ------------------------------------------------------

// Two microtask turns: the handler awaits the clipboard write before it writes
// the status line.
const settle = async () => {
  for (let turn = 0; turn < 3; turn += 1) await Promise.resolve();
};

async function bootedReleases(t, options = {}) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(DECISIONS),
      [RELEASE_STORAGE_KEY]: JSON.stringify([RECORDED]),
    },
  });
  t.after(() => page.restore());
  // The seed is the example half of the log: `r-sample` is not in storage, so
  // the page treats it exactly as it treats the shipped examples.
  initReleasesPage(page.document, page.storage, {
    seed: { decisions: [], releases: [SEEDED] },
    ...options,
  });
  assert.equal(page.document.documentElement.dataset.shiplogReleases, "ready");
  return page;
}

const toggles = (page) => page.document.querySelectorAll(".release-toggle");
const briefButtons = (page) => page.document.querySelectorAll(".release-brief-copy");
const statusAt = (page, index) => page.document.getElementById(`release-brief-status-${index}`);

test("every release record carries one brief control, in the panel expanding reveals", async (t) => {
  const page = await bootedReleases(t);
  assert.equal(toggles(page).length, 2, "the fixture really does render both releases");
  assert.equal(briefButtons(page).length, 2, "exactly one control per record — no more, no fewer");

  // Before expanding, the control is inside a hidden panel: not focusable, not
  // announced, and not offering to copy something nobody has looked at.
  const panel = page.document.getElementById("release-panel-0");
  assert.equal(panel.hidden, true);
  toggles(page)[0].click();
  assert.equal(panel.hidden, false, "expanding must reveal the panel the control sits in");
  assert.equal(toggles(page)[0].getAttribute("aria-expanded"), "true");
  // Still one per record once a record is open.
  assert.equal(briefButtons(page).length, 2);
});

test("the control is a real button, labelled with what pressing it does", async (t) => {
  const page = await bootedReleases(t);
  const [button] = briefButtons(page);
  assert.equal(button.tagName, "BUTTON", "a link or a div would need keyboard activation rebuilt by hand");
  // The property, not the attribute: a bare button inside a form region submits it.
  assert.equal(button.type, "button");
  assert.equal(textOf(button), RELEASE_BRIEF_BUTTON_LABEL);
  assert.equal(button.disabled, false);
  // It says which release it belongs to without being read out of context.
  assert.equal(button.dataset.releaseId, "r-read");

  // The message it writes is its own described-by, so a screen reader hears the
  // outcome as part of this control rather than as a stray sentence.
  const status = statusAt(page, 0);
  assert.equal(button.getAttribute("aria-describedby"), "release-brief-status-0");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(status.getAttribute("aria-atomic"), "true");
  assert.equal(textOf(status), "", "nothing is claimed before the control is pressed");
});

test("a press copies that release's brief and says so on the page", async (t) => {
  const written = [];
  const page = await bootedReleases(t, { clipboard: { writeText: async (text) => { written.push(text); } } });
  toggles(page)[0].click();
  briefButtons(page)[0].click();
  await settle();

  assert.equal(written.length, 1, "one press, one write");
  // The row's own record, not another row's: this is the visitor's release.
  assert.match(written[0], /^Release brief: v1\.2\.0 — Read path$/m);
  assert.match(written[0], /^- Cache the read path — Pending$/m);
  assert.ok(written[0].includes(RELEASE_BRIEF_BROWSER_LINE));
  assert.equal(textOf(statusAt(page, 0)), RELEASE_BRIEF_COPIED_STATUS);
  assert.equal(textOf(statusAt(page, 1)), "", "only the pressed control reports anything");
  assert.equal(briefButtons(page)[0].disabled, false, "the control is operable again once the write settled");
});

test("the example row's brief is the one that carries the demonstration line", async (t) => {
  const written = [];
  const page = await bootedReleases(t, { clipboard: { writeText: async (text) => { written.push(text); } } });
  // Newest first, so the recorded release leads and the seeded example follows.
  assert.deepEqual(toggles(page).map((node) => node.dataset.releaseId), ["r-read", "r-sample"]);
  toggles(page)[1].click();
  briefButtons(page)[1].click();
  await settle();

  assert.match(written[0], /^Release brief: v0\.9\.0 — Sample rollout$/m);
  assert.match(written[0], /^Status: Planned$/m);
  assert.ok(written[0].includes(RELEASE_BRIEF_EXAMPLE_LINE), "a seeded record must say it is invented");
  assert.ok(!written[0].includes(RELEASE_BRIEF_BROWSER_LINE));
  assert.equal(textOf(statusAt(page, 1)), RELEASE_BRIEF_COPIED_STATUS);
});

test("a clipboard that refuses is said out loud, not swallowed", async (t) => {
  const page = await bootedReleases(t, {
    clipboard: { writeText: async () => { throw new Error("denied"); } },
  });
  toggles(page)[0].click();
  briefButtons(page)[0].click();
  await settle();

  assert.equal(textOf(statusAt(page, 0)), RELEASE_BRIEF_COPY_FAILED_STATUS);
  assert.match(textOf(statusAt(page, 0)), /Could not copy/);
  assert.equal(briefButtons(page)[0].disabled, false, "a failure must not leave the control stuck");
});

test("a browser with no clipboard at all gets the same stated failure", async (t) => {
  const page = await bootedReleases(t, { clipboard: undefined });
  toggles(page)[0].click();
  briefButtons(page)[0].click();
  await settle();
  assert.equal(textOf(statusAt(page, 0)), RELEASE_BRIEF_COPY_FAILED_STATUS);
});

// The DOM harness models no layout and no matchMedia, so a viewport shim here
// would assert only itself. What can be checked is the thing the claim rests
// on: the control is built from classes styles.css already narrows, so it
// reflows on a phone without a rule of its own and without spending a byte of
// that file's measured size budget.
test("the control reuses the classes styles.css already narrows", async (t) => {
  const page = await bootedReleases(t);
  const [button] = briefButtons(page);
  assert.match(button.getAttribute("class"), /(^|\s)share-button(\s|$)/);
  assert.match(statusAt(page, 0).getAttribute("class"), /(^|\s)share-status(\s|$)/);

  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  // The narrow block that carries these classes, whichever one it is: the
  // stylesheet has several 520px blocks and this test is about one of them.
  const narrow = css.split("@media(max-width:520px)").find((block) => block.includes(".share-control{"));
  assert.ok(narrow, "the share control must be narrowed somewhere below 520px");
  // Stacked rather than side by side, the button full width, and the message
  // free of the 220px cap it wears on a wide screen.
  assert.match(narrow, /\.share-control\{[^}]*flex-direction:column/);
  assert.match(narrow, /\.share-button\{width:100%\}/);
  assert.match(narrow, /\.share-status\{max-width:none\}/);
});

test("a filter change re-renders the rows and the control still works", async (t) => {
  const written = [];
  const page = await bootedReleases(t, { clipboard: { writeText: async (text) => { written.push(text); } } });
  page.document.querySelector("#release-search").focus();
  typeText(page.document, "Sample rollout");

  assert.equal(briefButtons(page).length, 1, "the narrowed view draws one row and one control");
  briefButtons(page)[0].click();
  await settle();
  // The handler is delegated, so it survived the re-render, and it read the
  // release the filtered list actually drew rather than a stale selection.
  assert.match(written[0], /^Release brief: v0\.9\.0 — Sample rollout$/m);
  assert.equal(textOf(statusAt(page, 0)), RELEASE_BRIEF_COPIED_STATUS);
});
