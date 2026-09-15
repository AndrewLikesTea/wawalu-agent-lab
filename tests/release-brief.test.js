// The copyable release rationale on the Releases page (issue #2372), which
// replaced the per-row release brief (#2213) in the same place; the file keeps
// the brief's name because it tests the same control.
//
// Two surfaces, tested separately because they can fail separately:
//
//   * `buildReleaseRationale` is pure — record in, plain string out — so the
//     words a manager pastes are asserted directly rather than read back out of
//     rendered markup. This is where "nothing invented" is held.
//   * the shipped src/releases.html is driven through the control itself: a row
//     is expanded, the button is pressed with an injected clipboard, and the
//     clipboard, the text box and the status line are read for both outcomes.
//
// Determinism: no network, no timers, no sleeps, no shipped seed. Every test
// supplies its own fixtures and its own clipboard.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  NOT_RECORDED_TEXT,
  RATIONALE_EXAMPLE_HEADER,
  RATIONALE_EXAMPLE_LINE,
  RELEASE_RATIONALE_BUTTON_LABEL,
  RELEASE_RATIONALE_COPIED_STATUS,
  RELEASE_RATIONALE_COPY_FAILED_STATUS,
  RELEASE_RATIONALE_TEXT_LABEL,
  RELEASE_STORAGE_KEY,
  buildReleaseRationale,
  summarizeReleases,
} from "../src/releases.js";
import { STORAGE_KEY } from "../src/app.js";
import { initReleasesPage } from "../src/releases-page.js";
import { loadPage, textOf, typeText } from "./support/browser.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);

const DECISIONS = [
  { id: "d-queue", title: "Adopt a durable queue", context: "Retries are required.", owner: "Kai", status: "accepted", createdAt: "2026-01-02T09:00:00.000Z" },
  { id: "d-cache", title: "Cache the read path", context: "Read latency spikes.", owner: "Ari", status: "pending", createdAt: "2026-01-03T09:00:00.000Z" },
];
// A shipped example decision: in the seed, never in storage.
const SAMPLE_DECISION = { id: "d-sample", title: "Try a sample queue", context: "Invented for the tour.", owner: "Rowan", status: "proposed", createdAt: "2026-01-05T09:00:00.000Z" };

// One release the visitor recorded in this browser, and one shipped example
// that links the example decision and an id no log holds.
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
  decisionIds: ["d-sample", "d-gone"],
};

const RECORDED_RATIONALE = [
  "Release rationale",
  "",
  "Version: v1.2.0",
  "Status: Completed",
  "Owner: Ari",
  "Summary: Caching went out behind the flag.",
  "",
  "Linked decisions (2):",
  "1. Title: Cache the read path",
  "   Owner: Ari",
  "   Status: Pending",
  "   Context: Read latency spikes.",
  "2. Title: Adopt a durable queue",
  "   Owner: Kai",
  "   Status: Accepted",
  "   Context: Retries are required.",
].join("\n");

// --- the words ------------------------------------------------------------

test("found decisions carry their title, owner, status and context, in the release's own order", () => {
  assert.equal(buildReleaseRationale(RECORDED, DECISIONS), RECORDED_RATIONALE);
});

test("a linked id the log does not hold is one stated line, with nothing reconstructed", () => {
  // Nothing about any other record may leak into the unavailable entry.
  const text = buildReleaseRationale({ ...RECORDED, decisionIds: ["d-queue", "d-gone"] }, DECISIONS);
  const lines = text.split("\n");
  const at = lines.indexOf("2. Decision d-gone is unavailable in this log.");
  assert.ok(at > 0, text);
  assert.equal(at, lines.length - 1, "no field lines follow the unavailable entry");
  assert.equal(lines.filter((line) => /^\s*(\d+\. )?Title:/.test(line)).length, 1, "only the found decision has a title");
  assert.equal(lines.filter((line) => /^\s+Context:/.test(line)).length, 1, "only the found decision has a context");
  assert.match(text, /^Linked decisions \(2\):$/m, "the unavailable id still counts as linked");
});

test("an example release and an example decision each say so beside themselves, with one header", () => {
  const text = buildReleaseRationale(SEEDED, [SAMPLE_DECISION], {
    exampleReleaseIds: new Set(["r-sample"]),
    exampleDecisionIds: ["d-sample"],
  });
  const lines = text.split("\n");
  assert.equal(lines[1], RATIONALE_EXAMPLE_HEADER, "the header is read before any record");
  assert.equal(lines.filter((line) => line === RATIONALE_EXAMPLE_HEADER).length, 1);
  assert.equal(lines[lines.indexOf("Summary: An invented release, for the tour.") + 1], RATIONALE_EXAMPLE_LINE);
  assert.equal(lines[lines.indexOf("   Context: Invented for the tour.") + 1], `   ${RATIONALE_EXAMPLE_LINE}`);
  assert.match(RATIONALE_EXAMPLE_LINE, /^Example record — invented for demonstration/);
  // The unavailable id is not an example; the log cannot say what it is.
  assert.equal(lines.at(-1), "2. Decision d-gone is unavailable in this log.");

  const outsideDisclaimers = lines.filter((line) => line.trim() !== RATIONALE_EXAMPLE_LINE).join("\n");
  assert.doesNotMatch(outsideDisclaimers, /customer outcome/i);
  assert.doesNotMatch(outsideDisclaimers, /customer|outcome|impact/i, "no outcome wording the data does not hold");
});

test("an example decision alone still raises the header; a real record carries no example wording", () => {
  const onlyDecision = buildReleaseRationale({ ...RECORDED, decisionIds: ["d-sample"] }, [SAMPLE_DECISION], {
    exampleDecisionIds: new Set(["d-sample"]),
  });
  assert.equal(onlyDecision.split("\n")[1], RATIONALE_EXAMPLE_HEADER);
  assert.equal(onlyDecision.split("\n").filter((line) => line.trim() === RATIONALE_EXAMPLE_LINE).length, 1);

  const real = buildReleaseRationale(RECORDED, DECISIONS, { exampleReleaseIds: ["r-sample"], exampleDecisionIds: ["d-sample"] });
  assert.doesNotMatch(real, /example|invented|customer/i);
});

test("missing and blank fields read Not recorded, never a default the record did not hold", () => {
  const text = buildReleaseRationale(
    { id: "r-bare", version: "  ", status: "", decisionIds: ["d-bare"] },
    [{ id: "d-bare", title: "", owner: " ", context: "\n" }],
  );
  assert.equal(text, [
    "Release rationale",
    "",
    `Version: ${NOT_RECORDED_TEXT}`,
    `Status: ${NOT_RECORDED_TEXT}`,
    `Owner: ${NOT_RECORDED_TEXT}`,
    `Summary: ${NOT_RECORDED_TEXT}`,
    "",
    "Linked decisions (1):",
    `1. Title: ${NOT_RECORDED_TEXT}`,
    `   Owner: ${NOT_RECORDED_TEXT}`,
    `   Status: ${NOT_RECORDED_TEXT}`,
    `   Context: ${NOT_RECORDED_TEXT}`,
  ].join("\n"));
});

test("old records keep their author and notes aliases", () => {
  const text = buildReleaseRationale(
    { id: "r-old", version: "v0.1.0", author: "Lee", notes: "From an old export.", decisionIds: ["d-old"] },
    [{ id: "d-old", title: "Old call", author: "Sam", status: "accepted", context: "Kept." }],
  );
  assert.match(text, /^Owner: Lee$/m);
  assert.match(text, /^Summary: From an old export\.$/m);
  assert.match(text, /^ {3}Owner: Sam$/m);
});

test("a release with nothing linked, or a malformed record, still reads whole", () => {
  for (const value of [{ ...RECORDED, decisionIds: [] }, {}, { id: "r-y", decisionIds: "not an array" }]) {
    const text = buildReleaseRationale(value, DECISIONS);
    assert.match(text, /^Release rationale$/m);
    assert.match(text, /^No decisions linked to this release\.$/m);
    assert.doesNotMatch(text, /^Linked decisions/m);
  }
});

test("the builder is pure, and reads the same from an array, a Map, or a resolved release", () => {
  const release = { ...RECORDED, decisionIds: [...RECORDED.decisionIds] };
  const before = JSON.stringify({ release, DECISIONS });
  assert.equal(buildReleaseRationale(release, DECISIONS), buildReleaseRationale(release, DECISIONS));
  assert.equal(JSON.stringify({ release, DECISIONS }), before, "the record and the log are left as they were");
  assert.equal(buildReleaseRationale(release, new Map(DECISIONS.map((d) => [d.id, d]))), RECORDED_RATIONALE);
  const [resolved] = summarizeReleases([RECORDED], DECISIONS);
  assert.equal(buildReleaseRationale(resolved), RECORDED_RATIONALE);
  assert.doesNotMatch(RECORDED_RATIONALE, /\d{4}-\d{2}-\d{2}|\d{2}:\d{2}/, "no date or time in the text");
});

// --- the shipped page ------------------------------------------------------

// The handler awaits the clipboard write before it writes the status line.
const settle = async () => {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
};

async function bootedReleases(t, options = {}) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(DECISIONS),
      [RELEASE_STORAGE_KEY]: JSON.stringify([RECORDED]),
    },
  });
  t.after(() => page.restore());
  // The seed is the example half of the log: neither `r-sample` nor `d-sample`
  // is in storage, so the page treats them exactly as it treats the shipped
  // examples.
  initReleasesPage(page.document, page.storage, {
    seed: { decisions: [SAMPLE_DECISION], releases: [SEEDED] },
    ...options,
  });
  assert.equal(page.document.documentElement.dataset.shiplogReleases, "ready");
  return page;
}

const toggles = (page) => page.document.querySelectorAll(".release-toggle");
const copyButtons = (page) => page.document.querySelectorAll(".release-rationale-copy");
const boxes = (page) => page.document.querySelectorAll(".release-rationale-text");
const statusAt = (page, index) => page.document.getElementById(`release-rationale-status-${index}`);
const recordingClipboard = (written) => ({ writeText: async (text) => { written.push(text); } });

test("every release carries one copy control and one text box, in the panel expanding reveals", async (t) => {
  const page = await bootedReleases(t);
  assert.equal(toggles(page).length, 2, "the fixture really does render both releases");
  assert.equal(copyButtons(page).length, 2, "exactly one control per record");
  assert.equal(boxes(page).length, 2, "exactly one text box per record");

  const panel = page.document.getElementById("release-panel-0");
  assert.equal(panel.hidden, true);
  toggles(page)[0].click();
  assert.equal(panel.hidden, false, "expanding must reveal the panel the control sits in");
  assert.equal(copyButtons(page)[0].parentNode.parentNode === panel, true, "the control is in that release's panel");
});

test("the control is a real button, the box is labelled and read-only, the status is polite", async (t) => {
  const page = await bootedReleases(t);
  const [button] = copyButtons(page);
  const [box] = boxes(page);
  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.type, "button");
  assert.equal(textOf(button), RELEASE_RATIONALE_BUTTON_LABEL);

  assert.equal(box.tagName, "TEXTAREA");
  assert.equal(box.hasAttribute("readonly"), true);
  const labels = page.document.querySelectorAll("label").filter((label) => label.getAttribute("for") === box.id);
  assert.equal(labels.length, 1, "the box has exactly one label");
  assert.equal(textOf(labels[0]), RELEASE_RATIONALE_TEXT_LABEL);

  const status = statusAt(page, 0);
  assert.equal(button.getAttribute("aria-describedby"), status.id);
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(textOf(status), "", "nothing is claimed before the control is pressed");
  // A live region behind a closed disclosure is silent in a real browser.
  for (let node = status; node; node = node.parentNode) assert.notEqual(node.tagName, "DETAILS");
});

test("a press copies exactly the text on screen and says so", async (t) => {
  const written = [];
  const page = await bootedReleases(t, { clipboard: recordingClipboard(written) });
  toggles(page)[0].click();
  copyButtons(page)[0].click();
  await settle();

  assert.equal(written.length, 1, "one press, one write");
  assert.equal(written[0], boxes(page)[0].value, "the clipboard and the box hold one string");
  assert.equal(written[0], RECORDED_RATIONALE, "and it is the builder's text for this row's release");
  assert.equal(textOf(statusAt(page, 0)), RELEASE_RATIONALE_COPIED_STATUS);
  assert.equal(textOf(statusAt(page, 1)), "", "only the pressed control reports anything");
});

test("the example row's text marks the invented release and its invented decision", async (t) => {
  const written = [];
  const page = await bootedReleases(t, { clipboard: recordingClipboard(written) });
  assert.deepEqual(toggles(page).map((node) => node.dataset.releaseId), ["r-read", "r-sample"]);
  toggles(page)[1].click();
  copyButtons(page)[1].click();
  await settle();

  assert.equal(written[0], boxes(page)[1].value);
  assert.equal(written[0].split("\n")[1], RATIONALE_EXAMPLE_HEADER);
  assert.equal(written[0].split("\n").filter((line) => line.trim() === RATIONALE_EXAMPLE_LINE).length, 2);
  assert.match(written[0], /^2\. Decision d-gone is unavailable in this log\.$/m);
});

for (const [name, clipboard] of [
  ["refuses", { writeText: async () => { throw new Error("denied"); } }],
  ["has no writeText", {}],
]) {
  test(`a clipboard that ${name} says so, and hands the visitor the selected text`, async (t) => {
    const page = await bootedReleases(t, { clipboard });
    toggles(page)[0].click();
    copyButtons(page)[0].click();
    await settle();

    assert.equal(textOf(statusAt(page, 0)), RELEASE_RATIONALE_COPY_FAILED_STATUS);
    assert.match(RELEASE_RATIONALE_COPY_FAILED_STATUS, /unavailable.*select the release rationale text below/i);
    assert.equal(boxes(page).length, 2, "the box is still there");
    assert.equal(boxes(page)[0].value, RECORDED_RATIONALE, "with the full text in it");
    assert.equal(page.document.activeElement === boxes(page)[0], true, "focus lands in the box to select from");
  });
}

test("the text box takes its own row, from classes the stylesheets already narrow", async (t) => {
  const page = await bootedReleases(t);
  assert.match(copyButtons(page)[0].getAttribute("class"), /(^|\s)share-button(\s|$)/);
  assert.match(boxes(page)[0].parentNode.getAttribute("class"), /(^|\s)filter(\s|$)/);
  const sheet = await readFile(new URL("../src/releases-proof.css", import.meta.url), "utf8");
  assert.match(sheet, /#release-list \.release-rationale-field \{[^}]*flex:1 1 100%/);
});

test("a filter change re-renders the rows and the control still copies the drawn release", async (t) => {
  const written = [];
  const page = await bootedReleases(t, { clipboard: recordingClipboard(written) });
  page.document.querySelector("#release-search").focus();
  typeText(page.document, "Sample rollout");

  assert.equal(copyButtons(page).length, 1, "the narrowed view draws one row and one control");
  copyButtons(page)[0].click();
  await settle();
  assert.match(written[0], /^Version: v0\.9\.0$/m);
  assert.equal(written[0], boxes(page)[0].value);
  assert.equal(textOf(statusAt(page, 0)), RELEASE_RATIONALE_COPIED_STATUS);
});
