// Can a buyer take the front door's record counts away with them? (#2582)
//
// The home page already ships an evaluation brief, but that brief is fixed
// editorial text and carries no figures. These tests pin the block that does:
// the decision total, the release total, the example/added split on each, the
// reasoning-completeness figure the releases page quotes, and the two
// provenance sentences — derived from the loaded log, previewed on screen, and
// copied byte-for-byte from the same builder the preview renders.
//
// The clipboard is injected everywhere, so this suite writes to no real one.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { STORAGE_KEY, initDecisionLog } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import {
  EVALUATION_SUMMARY_COPIED_STATUS,
  EVALUATION_SUMMARY_COPY_FAILED_STATUS,
  EVALUATION_SUMMARY_COPY_LABEL,
  EVALUATION_SUMMARY_EXAMPLE_CAVEAT,
  EVALUATION_SUMMARY_HEADING,
  EVALUATION_SUMMARY_IDS,
  EVALUATION_SUMMARY_PROVENANCE,
  EVALUATION_SUMMARY_TITLE,
  EVALUATION_SUMMARY_UNREAD,
  buildEvaluationSummary,
  evaluationSummaryCounts,
  evaluationSummaryLines,
} from "../src/evaluation-summary.js";
import { REASONING_PROOF_RULE } from "../src/release-reasoning-proof.js";
import { loadPage, parseHtml, tabSequence, textOf, typeText } from "./support/browser.js";
import { waitFor } from "./support/page-module.js";

const HOME_PAGE = new URL("../src/index.html", import.meta.url);
const NO_SEED = { decisions: [], releases: [] };

/* ----------------------------- the fixtures ------------------------------ */

const decision = (id, overrides = {}) => ({
  id,
  title: `Decision ${id}`,
  context: "Context for the decision.",
  alternatives: "The alternatives that were weighed.",
  owner: "Tess",
  status: "accepted",
  createdAt: "2026-09-01T12:00:00.000Z",
  ...overrides,
});

const release = (id, decisionIds, overrides = {}) => ({
  id,
  version: `v1.0.${id.slice(-1)}`,
  title: `Release ${id}`,
  description: "What shipped.",
  status: "completed",
  notes: "",
  owner: "Tess",
  createdAt: "2026-09-02T12:00:00.000Z",
  decisionIds,
  ...overrides,
});

// Two seeded examples and one release that links a decision the log holds, so
// the reasoning figure has something to say on the example half.
const SEED = {
  decisions: [decision("seed-d-1")],
  releases: [release("seed-r-1", ["seed-d-1"])],
};

/* ------------------------- the pure builder alone ------------------------- */

test("the summary states both totals, both splits, the reasoning figure, and its provenance", () => {
  const lines = evaluationSummaryLines({
    unread: false,
    decisions: { total: 4, examples: 3, added: 1 },
    releases: { total: 3, examples: 2, added: 1 },
    reasoning: { total: 3, preserved: 2, examples: 2, added: 1 },
  });

  assert.equal(lines[0], EVALUATION_SUMMARY_TITLE);
  // (1) the decision total with its split, in the site's own split wording.
  assert.equal(lines[1], "4 decisions loaded. Counted here: 3 example records and 1 you added.");
  // (2) the release total, in the same shape, so the two lines compare.
  assert.equal(lines[2], "3 releases loaded. Counted here: 2 example records and 1 you added.");
  // (3) the reasoning-completeness proof point, and (4) the rule behind it —
  // both quoted from release-reasoning-proof.js rather than reworded here.
  assert.equal(lines[3],
    "Reasoning kept: 2 of 3 releases in this release log link at least one decision that is in the decision log.");
  assert.equal(lines[4], REASONING_PROOF_RULE);
  // (5) and (6) the two provenance sentences a pasted figure travels without.
  assert.equal(lines[5], EVALUATION_SUMMARY_PROVENANCE);
  assert.match(lines[5], /counted from the decisions and releases loaded in this browser/);
  assert.match(lines[5], /search and filters do not change it/);
  assert.equal(lines[6], EVALUATION_SUMMARY_EXAMPLE_CAVEAT);
  assert.match(lines[6], /invented to demonstrate Shiplog and are not customer results/);
  assert.equal(lines.length, 7);

  // The payload is the same lines and nothing else.
  assert.equal(buildEvaluationSummary({
    unread: false,
    decisions: { total: 4, examples: 3, added: 1 },
    releases: { total: 3, examples: 2, added: 1 },
    reasoning: { total: 3, preserved: 2, examples: 2, added: 1 },
  }), lines.join("\n"));
});

test("a singular log is worded singularly and an empty one names the absence", () => {
  const one = evaluationSummaryLines({
    unread: false,
    decisions: { total: 1, examples: 0, added: 1 },
    releases: { total: 1, examples: 1, added: 0 },
    reasoning: { total: 1, preserved: 1, examples: 1, added: 0 },
  });
  assert.equal(one[1], "1 decision loaded. Counted here: no example records and 1 you added.");
  assert.equal(one[2], "1 release loaded. Counted here: 1 example record and none you added.");

  // Zero is an absence, not a figure: "0 decisions loaded" reads as a count
  // somebody took, and both halves of the split at zero would say nothing.
  const none = evaluationSummaryLines({
    unread: false,
    decisions: { total: 0, examples: 0, added: 0 },
    releases: { total: 0, examples: 0, added: 0 },
    reasoning: { total: 0, preserved: 0, examples: 0, added: 0 },
  });
  assert.equal(none[1], "No decisions are loaded here, so there are none to count.");
  assert.equal(none[2], "No releases are loaded here, so there are none to count.");
  assert.equal(none[3], "Reasoning kept: No releases are loaded here, so there are none to count.");
});

test("an unreadable log is its own state and never reports zero", () => {
  const lines = evaluationSummaryLines(evaluationSummaryCounts({ unread: true }));
  assert.equal(lines[0], EVALUATION_SUMMARY_TITLE);
  assert.equal(lines[1], EVALUATION_SUMMARY_UNREAD);
  assert.equal(lines.length, 2);
  // A refused read must not be dressed as an empty log: no figure, and the
  // recovery is named.
  assert.doesNotMatch(lines[1], /\d/);
  assert.match(lines[1], /Retry/);
});

test("the counts are read off the composed stream, never re-derived", () => {
  const counts = evaluationSummaryCounts({
    records: [
      { type: "decision", id: "a", example: true },
      { type: "decision", id: "b", example: false },
      { type: "release", id: "r", example: true },
    ],
    decisions: [decision("a"), decision("b")],
    releases: [release("r", ["a"])],
    exampleIds: new Set(["a", "r"]),
  });
  assert.deepEqual(counts.decisions, { total: 2, examples: 1, added: 1 });
  assert.deepEqual(counts.releases, { total: 1, examples: 1, added: 0 });
  // A link that resolves counts; the example/added halves come from the same
  // exampleIds set the rows are badged from.
  assert.deepEqual(counts.reasoning, { total: 1, preserved: 1, examples: 1, added: 0 });
});

test("a release linking a decision the log does not hold is not counted as preserved", () => {
  const counts = evaluationSummaryCounts({
    records: [{ type: "release", id: "r", example: false }],
    decisions: [],
    releases: [release("r", ["gone"])],
    exampleIds: new Set(),
  });
  assert.equal(counts.reasoning.preserved, 0);
  // Quoted verbatim from release-reasoning-proof.js, including the fact that it
  // agrees its verb with the preserved count rather than the total ("1 release …
  // link"). That sentence is pinned on the releases page; rewording it here
  // would give the site two wordings for one figure, which is the whole reason
  // this block borrows it instead of writing its own.
  assert.equal(evaluationSummaryLines(counts)[3],
    "Reasoning kept: 0 of 1 release in this release log link at least one decision that is in the decision log.");
});

/* --------------------------- the shipped markup --------------------------- */

test("the block ships its wait, an empty preview, and a disabled control", async () => {
  const document = parseHtml(await readFile(new URL("../src/index.html", import.meta.url), "utf8"));
  const region = document.getElementById(EVALUATION_SUMMARY_IDS.region);
  assert.ok(region, "the home page must carry the evaluation summary block");
  assert.equal(textOf(document.getElementById(EVALUATION_SUMMARY_IDS.heading)),
    EVALUATION_SUMMARY_HEADING);
  assert.equal(region.getAttribute("aria-labelledby"), EVALUATION_SUMMARY_IDS.heading);

  // No figure is authored here: a number in the served bytes is a number nobody
  // counted, and it would still be on screen after a failed read.
  const preview = document.getElementById(EVALUATION_SUMMARY_IDS.preview);
  assert.equal(preview.getAttribute("aria-busy"), "true");
  assert.doesNotMatch(textOf(preview), /\d/, "no count may be authored into the preview");
  assert.match(textOf(preview), /once the decision and release log has loaded/);

  // A control that does nothing without the module is worse than no control.
  const button = document.getElementById(EVALUATION_SUMMARY_IDS.copy);
  assert.equal(button.getAttribute("type"), "button");
  assert.notEqual(button.getAttribute("disabled"), null, "the control must ship disabled");
  // Named by what it produces, not by the gesture.
  assert.equal(textOf(button), EVALUATION_SUMMARY_COPY_LABEL);
  assert.match(textOf(button), /evaluation summary/);

  // The success line is a polite live region that ships empty and in the
  // accessibility tree — never inside a disclosure, which the harness reads
  // through and a real browser silences.
  const status = document.getElementById(EVALUATION_SUMMARY_IDS.status);
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(textOf(status), "");
  assert.equal(button.getAttribute("aria-describedby"), EVALUATION_SUMMARY_IDS.status);
  for (let node = status; node; node = node.parentNode) {
    assert.notEqual(node.tagName, "DETAILS", "the status must not sit inside a disclosure");
    assert.notEqual(node.hidden, true);
  }
});

/* ---------------------------- the booted page ----------------------------- */

async function openHome(t, { decisions = [], releases = [], seed = SEED, writeText } = {}) {
  const copied = [];
  const page = await loadPage(HOME_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(decisions),
      [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
    },
    location: { pathname: "/", search: "", hash: "" },
  });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage, {
    seed,
    location: { pathname: "/", search: "", hash: "" },
    history: { replaceState() {} },
    clipboard: {
      writeText: writeText ?? (async (value) => { copied.push(value); }),
    },
  });
  assert.equal(page.document.documentElement.dataset.shiplog, "ready", "the log never rendered");
  return { page, copied };
}

const previewLines = (page) => page.document
  .getElementById(EVALUATION_SUMMARY_IDS.preview)
  .querySelectorAll("li")
  .map((item) => textOf(item));

const statusText = (page) => textOf(page.document.getElementById(EVALUATION_SUMMARY_IDS.status));

test("the preview is painted from the loaded log and the copy matches it exactly", async (t) => {
  const { page, copied } = await openHome(t, {
    decisions: [decision("mine-1")],
    releases: [release("mine-r", ["mine-1"])],
  });

  const preview = page.document.getElementById(EVALUATION_SUMMARY_IDS.preview);
  assert.equal(preview.getAttribute("aria-busy"), "false", "the block never left its wait");

  // Two decisions (one seeded, one this browser holds) and two releases, the
  // same way — derived, not authored.
  const lines = previewLines(page);
  assert.equal(lines[1], "2 decisions loaded. Counted here: 1 example record and 1 you added.");
  assert.equal(lines[2], "2 releases loaded. Counted here: 1 example record and 1 you added.");
  assert.equal(lines[3],
    "Reasoning kept: 2 of 2 releases in this release log link at least one decision that is in the decision log.");
  assert.equal(lines[5], EVALUATION_SUMMARY_PROVENANCE);
  assert.equal(lines[6], EVALUATION_SUMMARY_EXAMPLE_CAVEAT);

  // One press, one write, and the clipboard receives the preview and nothing
  // else: the figures and the provenance a reader was shown.
  page.document.getElementById(EVALUATION_SUMMARY_IDS.copy).click();
  await waitFor(() => statusText(page) !== "", "the copy never reported back");
  assert.equal(copied.length, 1, "one press, one write");
  assert.equal(copied[0], lines.join("\n"));
  assert.equal(statusText(page), EVALUATION_SUMMARY_COPIED_STATUS);
});

test("recording a decision moves the preview without a reload", async (t) => {
  const { page, copied } = await openHome(t);
  assert.match(previewLines(page)[1], /^1 decision loaded\./);

  for (const [field, value] of Object.entries({
    title: "Adopt a durable job queue",
    context: "Background work was lost on deploys.",
    alternatives: "Database polling and in-process retries.",
    owner: "Tess",
  })) {
    const control = page.document.getElementById(field);
    control.focus();
    typeText(page.document, value);
  }
  page.document.getElementById("status").value = "accepted";
  page.document.getElementById("decision-form")
    .querySelector('button[type="submit"]').click();

  // The figure grew, and the split says which half grew. No hard-coded number
  // survives a write.
  const lines = previewLines(page);
  assert.equal(lines[1], "2 decisions loaded. Counted here: 1 example record and 1 you added.");
  assert.equal(lines[2], "1 release loaded. Counted here: 1 example record and none you added.");

  // And the clipboard follows the preview rather than the figures at boot.
  page.document.getElementById(EVALUATION_SUMMARY_IDS.copy).click();
  await waitFor(() => statusText(page) !== "", "the copy never reported back");
  assert.equal(copied[0], lines.join("\n"));
  assert.match(copied[0], /2 decisions loaded\./);
});

test("a filter narrows the list and does not move the summary", async (t) => {
  const { page } = await openHome(t, {
    decisions: [decision("mine-1", { owner: "Rhea" })],
    releases: [release("mine-r", ["mine-1"])],
  });
  const before = previewLines(page);

  // The search box is the narrowest filter on the page; the summary states that
  // filters do not change it, so this holds it to its own sentence.
  const search = page.document.getElementById("decision-search");
  search.focus();
  typeText(page.document, "nothing will match this");
  assert.deepEqual(previewLines(page), before,
    "a filter moved a figure the summary promises filters do not move");
});

test("a refused copy names the fallback and leaves the summary on screen", async (t) => {
  const { page } = await openHome(t, {
    writeText: async () => { throw new Error("this message must never reach the page"); },
  });
  const lines = previewLines(page);

  page.document.getElementById(EVALUATION_SUMMARY_IDS.copy).click();
  await waitFor(() => statusText(page) !== "", "a refused copy said nothing at all");
  assert.equal(statusText(page), EVALUATION_SUMMARY_COPY_FAILED_STATUS);
  // The error is reported, not swallowed, and the recovery is the text itself —
  // which is still listed, unchanged, for a reader to select.
  assert.match(statusText(page), /select it to copy it by hand/);
  assert.deepEqual(previewLines(page), lines);

  // The control keeps its place: disabling a focused button blurs it, and a
  // keyboard visitor mid-copy must not be dropped to the top of the document.
  const button = page.document.getElementById(EVALUATION_SUMMARY_IDS.copy);
  assert.equal(button.disabled, false);
});

test("an unreadable log says so here instead of reporting an empty one", async (t) => {
  const page = await loadPage(HOME_PAGE, {
    storage: { [STORAGE_KEY]: JSON.stringify([]), [RELEASE_STORAGE_KEY]: JSON.stringify([]) },
    location: { pathname: "/", search: "", hash: "" },
  });
  t.after(() => page.restore());
  // A blocked or partitioned store, which is the state the log calls unread —
  // not malformed JSON, which the tolerant loaders read as an empty log.
  const { getItem } = page.storage;
  page.storage.getItem = (key) => {
    if (key === STORAGE_KEY) throw new Error("storage refused the read");
    return getItem(key);
  };
  await initDecisionLog(page.document, page.storage, {
    seed: SEED,
    location: { pathname: "/", search: "", hash: "" },
    history: { replaceState() {} },
    clipboard: { writeText: async () => {} },
  });

  const lines = previewLines(page);
  assert.equal(lines.length, 2, "a refused read has no figures to list");
  assert.equal(lines[1], EVALUATION_SUMMARY_UNREAD);
});

test("the control is reachable by keyboard and adds no tabindex", async (t) => {
  const { page } = await openHome(t);
  const button = page.document.getElementById(EVALUATION_SUMMARY_IDS.copy);
  const sequence = tabSequence(page.document);
  // ok(), not equal(): a failing equal() on parsed nodes stringifies the whole
  // page and takes minutes to report what this message already says.
  assert.ok(sequence.includes(button), "the copy control is not in the natural tab order");
  assert.equal(button.getAttribute("tabindex"), null);
  // The block adds exactly one tab stop; the preview is text, and the status is
  // a span.
  const region = page.document.getElementById(EVALUATION_SUMMARY_IDS.region);
  assert.equal(sequence.filter((node) => region.querySelectorAll("button").includes(node)).length, 1);
});
