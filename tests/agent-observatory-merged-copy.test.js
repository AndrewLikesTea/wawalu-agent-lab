// Handing the observatory's one real number over as text (#1835).
//
// THE DEFECT THIS EXISTS TO CATCH. The merged-pull-request count is the only
// figure on this site that was counted rather than invented, so it is the only
// one worth forwarding — and a figure retyped into an email arrives without
// anything that made it checkable. What this file holds is that the control
// cannot offer the number WITHOUT the rest: what those merges are, which
// repositories they are in, whether the figure is this response's own or the
// last count this browser took, and the absolute address of the page that
// published it.
//
// It also holds the boundary in the other direction. `loading` and
// `unavailable` are states with no figure, and a control that is pressable over
// an absence is a control that puts an unsourced claim on somebody's clipboard.
// So the never-counted case below asserts that there is nothing to press.
//
// The number is read off the rendered element every time, never typed here: a
// literal would pass this file while the page showed something else, which is
// exactly the drift the control exists to prevent.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SOURCE_REPOSITORIES } from "../src/public-merges.js";
import { RETAINED_COUNT_KEY, RETAINED_COUNT_SCHEMA } from "../src/merged-count-retention.js";
import { loadActivity } from "../src/agents.js";
import {
  MERGED_COPY_FEEDBACK,
  MERGED_COPY_IDS,
  MERGED_COPY_LABEL,
  MERGED_COPY_MEANING,
  OBSERVATORY_ORIGIN,
  bindMergedCountCopy,
  buildMergedCountCopy,
  observatoryUrl,
} from "../src/merged-count-copy.js";
import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";

const PAGE_URL = new URL("../src/agents.html", import.meta.url);
const RESPONSE_DATE = "Sun, 16 Aug 2026 14:32:00 GMT";
const RETAINED_AT = "2026-08-09T07:05:00.000Z";
const OBSERVATORY_URL = `${OBSERVATORY_ORIGIN}/agents.html`;

function mergeEvent(number) {
  return {
    id: String(number),
    type: "PullRequestEvent",
    created_at: "2026-08-16T14:00:00Z",
    payload: { action: "closed", pull_request: { number, merged: true, title: `Pull request ${number}` } },
  };
}

const MERGES = [mergeEvent(11), mergeEvent(12), mergeEvent(13), mergeEvent(14)];

const okResponse = (payload) => ({
  ok: true,
  status: 200,
  headers: { get: (name) => (name.toLowerCase() === "date" ? RESPONSE_DATE : null) },
  json: async () => payload,
});

// One feed carries the fixture, so a doubled payload cannot double the count,
// and the published record is unreadable here — every fallback in this file is
// therefore either this browser's retained count or the never-counted state.
const githubFetcher = (payload) => async (url) => (url.includes("/repos/")
  ? okResponse(url.includes("paint-lab") ? payload : [])
  : { ok: false, status: 404, json: async () => ({}) });

const offlineFetcher = async () => { throw new Error("offline"); };

const retained = (count) => ({
  [RETAINED_COUNT_KEY]: JSON.stringify({
    schemaVersion: RETAINED_COUNT_SCHEMA, count, takenAt: RETAINED_AT,
  }),
});

/** The shipped observatory, wired as the page wires it, settled onto one state. */
async function settled(t, { fetcher, storage = {}, clipboard } = {}) {
  const page = await loadPage(PAGE_URL, { storage });
  t.after(() => page.restore());
  bindMergedCountCopy(page.document, clipboard);
  await loadActivity(page.document, fetcher, page.storage);
  return page.document;
}

const block = (document) => document.querySelector(`#${MERGED_COPY_IDS.block}`);
const button = (document) => document.querySelector(`#${MERGED_COPY_IDS.button}`);
const status = (document) => document.querySelector(`#${MERGED_COPY_IDS.status}`);

/** The digit the page is showing, read off the element that shows it. */
const renderedCount = (document) => textOf(document.querySelector(".merged-figure-count"));

/** Press the control the way a keyboard user does, and let the write settle. */
async function pressCopy(document, clipboard) {
  const control = button(document);
  assert.ok(tabSequence(document).includes(control),
    `"${MERGED_COPY_LABEL}" is not reachable by Tab`);
  control.focus();
  pressEnter(document);
  await new Promise((resolve) => { setImmediate(resolve); });
  return clipboard.written;
}

/** A clipboard that records, or refuses. Read at press time, as a browser's is. */
function testClipboard({ refuse = false } = {}) {
  const written = [];
  return {
    written,
    writeText: async (value) => {
      if (refuse) throw new Error("denied");
      written.push(value);
    },
  };
}

// --- the summary -----------------------------------------------------------

test("the summary is composed from the figure, and states no figure without one", () => {
  const asOf = new Date(RESPONSE_DATE);
  const live = buildMergedCountCopy("live", { count: 4, asOf });
  assert.equal(live.available, true, `nothing was composed to copy: ${live.reason}`);
  assert.equal(live.lines[0], "4 merged pull requests");
  // The unit follows the quantity, so one merge is never "1 merged pull requests".
  assert.equal(buildMergedCountCopy("live", { count: 1, asOf }).lines[0], "1 merged pull request");
  // A zero is a real answer public GitHub can give about merges, so it copies.
  assert.equal(buildMergedCountCopy("live", { count: 0, asOf }).available, true);

  // Every state and shape with no dated whole count behind it: nothing copyable,
  // and a named reason rather than a silent empty string.
  for (const [state, figure] of [
    ["loading", {}],
    ["unavailable", {}],
    ["nonsense", { count: 4, asOf }],
    ["live", { count: 4 }],
    ["live", { count: 4, asOf: new Date("nonsense") }],
    ["recorded", { count: 4 }],
    ["recorded", { count: -1, takenAt: asOf }],
    ["recorded", { count: 1.5, takenAt: asOf }],
  ]) {
    const summary = buildMergedCountCopy(state, figure);
    assert.equal(summary.available, false, `${state} offered a summary: ${summary.text}`);
    assert.equal(summary.text, "", `${state} left copyable text behind`);
    assert.ok(summary.reason, `${state} has no named reason`);
  }
});

test("the absolute address is built from the origin the page is served from", () => {
  assert.equal(observatoryUrl("https://labs.wawalu.org"), OBSERVATORY_URL);
  assert.equal(observatoryUrl("https://shiplog.test"), "https://shiplog.test/agents.html");
  // A page with no readable origin still hands over an address that resolves.
  for (const missing of [undefined, null, "", "not a url"]) {
    assert.equal(observatoryUrl(missing), OBSERVATORY_URL, `unusable origin: ${missing}`);
  }
});

test("the meaning sentence is the one the block already prints under the figure", async () => {
  // Held against the shipped note rather than retyped beside it: a repository
  // that changed on the page changes in the clipboard, and a sentence reworded
  // in one place fails here rather than forwarding two readings of one claim.
  const page = await readFile(PAGE_URL, "utf8");
  assert.ok(page.includes(MERGED_COPY_MEANING),
    `agents.html does not print the sentence the summary copies: ${MERGED_COPY_MEANING}`);
  for (const repository of SOURCE_REPOSITORIES) {
    assert.ok(MERGED_COPY_MEANING.includes(repository), `${repository} is not named`);
  }
  assert.match(MERGED_COPY_MEANING, /built and changed the pages of this site/);
  assert.doesNotMatch(MERGED_COPY_MEANING, /\d/, "the sentence must read the same with no count behind it");
});

// --- the control on the shipped page ---------------------------------------

test("the served page offers nothing to copy before a count has arrived", async (t) => {
  const page = await loadPage(PAGE_URL);
  t.after(() => page.restore());
  const { document } = page;

  // The document is static, so anything copyable in it would be a claim nothing
  // had counted. The control ships out of the tab sequence and out of the page.
  assert.ok(block(document).hidden, "the control ships pressable over an absence");
  assert.equal(block(document).dataset.reason, "loading");
  assert.equal(tabSequence(document).some((node) => node.id === MERGED_COPY_IDS.button), false,
    "a keyboard reaches a control with no figure behind it");
  assert.equal(textOf(status(document)), "", "the status line speaks before anything was pressed");

  // The figure's one region that speaks on load is still the readout: the copy
  // status announces on press, so it carries role="status" and no second
  // aria-live attribute inside the section.
  assert.equal(status(document).getAttribute("role"), "status");
  assert.equal(document.querySelector("#merged-figure").querySelectorAll("[aria-live]").length, 1);
});

test("a counted figure gives the keyboard a control that names what it copies", async (t) => {
  const clipboard = testClipboard();
  const document = await settled(t, { fetcher: githubFetcher(MERGES), clipboard });

  assert.equal(document.querySelector("#merged-figure").dataset.state, "live");
  assert.equal(block(document).hidden, false, "a counted figure still has nothing to copy");
  assert.equal(block(document).dataset.reason, "live");

  const control = button(document);
  assert.equal(control.tagName, "BUTTON");
  assert.equal(control.type, "button");
  assert.equal(control.disabled, false);
  // The accessible name says what leaves the page, not "Copy".
  assert.equal(textOf(control), MERGED_COPY_LABEL);
  assert.match(MERGED_COPY_LABEL, /count/i);
  assert.match(MERGED_COPY_LABEL, /sources/i);

  const written = await pressCopy(document, clipboard);
  assert.equal(written.length, 1, "the press wrote nothing to the clipboard");
  assert.equal(textOf(status(document)), MERGED_COPY_FEEDBACK.copied);
});

test("the copied text carries the rendered number, its meaning, both repositories and this page", async (t) => {
  const clipboard = testClipboard();
  const document = await settled(t, { fetcher: githubFetcher(MERGES), clipboard });
  const [payload] = await pressCopy(document, clipboard);

  // Read from the page, not written down here: the count on the clipboard is the
  // count on the screen, whatever the fixture happens to make it.
  const shown = renderedCount(document);
  assert.match(shown, /^\d+$/, `the page is not showing a number: ${shown}`);
  assert.ok(payload.includes(`${shown} merged pull request`),
    `the copied text does not carry the rendered count ${shown}: ${payload}`);

  assert.ok(payload.includes(MERGED_COPY_MEANING), `the copied text drops what the merges are: ${payload}`);
  for (const repository of SOURCE_REPOSITORIES) {
    assert.ok(payload.includes(repository), `the copied text drops ${repository}`);
  }
  assert.ok(payload.includes(OBSERVATORY_URL), `the copied text drops this page's address: ${payload}`);

  // Plain text: nothing that could arrive in a mail client as markup.
  assert.doesNotMatch(payload, /[<>]/, "the copied text carries markup");
  // And no claim the page does not itself make. A rate, a trend, or a per-day
  // figure would be arithmetic nobody on this page performed.
  assert.doesNotMatch(payload, /per day|per week|per month|%|average|trend|up from|down from/i);
});

test("a live figure says when it was counted", async (t) => {
  const clipboard = testClipboard();
  const document = await settled(t, { fetcher: githubFetcher(MERGES), clipboard });
  const [payload] = await pressCopy(document, clipboard);

  // The response's own arrival time, the instant the block dated the figure by.
  const asOf = new Date(RESPONSE_DATE);
  assert.ok(payload.includes(`Counted from public GitHub activity on ${asOf.toISOString().slice(0, 10)} `
    + `at ${asOf.toISOString().slice(11, 16)} UTC.`),
  `the copied text does not date the live count: ${payload}`);
  // A live count is not a previous one, and must not travel as one.
  assert.doesNotMatch(payload, /previous count|did not answer/);
});

test("a retained figure says it is a previous count and when it was taken", async (t) => {
  const clipboard = testClipboard();
  const document = await settled(t, { fetcher: offlineFetcher, storage: retained(37), clipboard });
  const [payload] = await pressCopy(document, clipboard);

  assert.equal(document.querySelector("#merged-figure").dataset.state, "recorded");
  assert.equal(block(document).dataset.reason, "recorded");
  // The number is the retained one the block painted, read off the page again.
  assert.equal(renderedCount(document), "37");
  assert.ok(payload.includes(`37 merged pull request`), `the retained count is not copied: ${payload}`);

  const takenAt = new Date(RETAINED_AT);
  assert.ok(payload.includes("this is a previous count"),
    `the copied text does not say the figure is not live: ${payload}`);
  assert.ok(payload.includes(`taken on ${takenAt.toISOString().slice(0, 10)} `
    + `at ${takenAt.toISOString().slice(11, 16)} UTC.`),
  `the copied text does not date the previous count: ${payload}`);
  assert.doesNotMatch(payload, /[<>]/, "the copied text carries markup");
  assert.ok(payload.includes(OBSERVATORY_URL), "the retained summary drops this page's address");
});

test("a browser that has never held a count has nothing copyable at all", async (t) => {
  const document = await settled(t, { fetcher: offlineFetcher, storage: {} });

  assert.equal(document.querySelector("#merged-figure").dataset.state, "unavailable");
  assert.ok(block(document).hidden, "the control is pressable with no figure behind it");
  assert.equal(block(document).dataset.reason, "no_count");
  assert.equal(block(document).dataset.payload, "", "an absent figure left copyable text behind");
  assert.equal(tabSequence(document).some((node) => node.id === MERGED_COPY_IDS.button), false,
    "a keyboard reaches a control that would copy no figure");
  // The readout still holds no digit, so nothing on screen or on a clipboard
  // asserts a count in this state.
  assert.doesNotMatch(textOf(document.querySelector("#merged-figure-readout")), /\d/);
});

test("a figure that goes away takes its confirmation and its payload with it", async (t) => {
  const clipboard = testClipboard();
  const page = await loadPage(PAGE_URL, { storage: {} });
  t.after(() => page.restore());
  const { document } = page;
  bindMergedCountCopy(document, clipboard);

  await loadActivity(document, githubFetcher(MERGES), page.storage);
  await pressCopy(document, clipboard);
  assert.equal(textOf(status(document)), MERGED_COPY_FEEDBACK.copied);

  // The live response is remembered, so a failed refresh lands on the retained
  // count — a different figure, so "Copied." may not survive it.
  await loadActivity(document, offlineFetcher, page.storage);
  assert.equal(document.querySelector("#merged-figure").dataset.state, "recorded");
  assert.equal(textOf(status(document)), "", "a stale confirmation outlived the figure it described");
  const [, second] = await pressCopy(document, clipboard);
  assert.ok(second.includes("this is a previous count"),
    `the second copy still describes the live figure: ${second}`);
});

test("a refused clipboard leaves visible recovery guidance and no false confirmation", async (t) => {
  const clipboard = testClipboard({ refuse: true });
  const document = await settled(t, { fetcher: githubFetcher(MERGES), clipboard });

  await pressCopy(document, clipboard);

  assert.equal(clipboard.written.length, 0);
  assert.equal(textOf(status(document)), MERGED_COPY_FEEDBACK.failed);
  assert.doesNotMatch(MERGED_COPY_FEEDBACK.failed, /copied\.$/i);
});
