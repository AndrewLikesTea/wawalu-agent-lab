// The counted figure, taken away.
//
// The observatory's one real number is the thing a reader is most likely to
// quote somewhere else, and a quoted number is only worth anything if what
// makes it checkable travels with it. So what is pinned here is not that a
// button exists — it is that the payload can only ever be honest:
//
//   • the digit in the clipboard is the digit on the screen, read off the same
//     paint rather than re-derived, re-fetched, or written down;
//   • a live count says when it was counted, and a retained one says in words
//     that it is a previous count and when THAT was taken;
//   • a browser with no count offers nothing to copy at all, and says why;
//   • the payload is plain text, and asserts nothing the block does not.
//
// The wording, the provenance sentence, and the two verification links the
// block already carried are pinned here too, byte for byte, because this
// change was allowed to add a control beside them and nothing else.

import assert from "node:assert/strict";
import test from "node:test";
import {
  EVENTS_URLS, SOURCE_REPOSITORIES, feedLinkText, mergedCountUnit,
} from "../src/public-merges.js";
import { RETAINED_COUNT_KEY, RETAINED_COUNT_SCHEMA } from "../src/merged-count-retention.js";
import { loadActivity } from "../src/agents.js";
import {
  MERGED_COPY_FEEDBACK, MERGED_COPY_IDS, MERGED_COPY_LABEL, MERGED_COPY_NOTE, MERGED_COPY_NO_COUNT,
  PUBLISHED_ORIGIN, buildMergedCountCopy, bindMergedCountCopy, observatoryUrl,
} from "../src/merged-figure-copy.js";
import { installDocument } from "./support/dom.js";
import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";

installDocument();

const PAGE_URL = new URL("../src/agents.html", import.meta.url);
const RESPONSE_DATE = "Wed, 30 Jul 2025 14:32:00 GMT";
const RESPONSE_STAMP = "2025-07-30 at 14:32 UTC";
const RETAINED_ISO = "2025-07-14T09:05:00.000Z";
const RETAINED_STAMP = "2025-07-14 at 09:05 UTC";
const HARNESS_ORIGIN = "https://labs.wawalu.org";

const merge = (number) => ({
  id: String(number),
  type: "PullRequestEvent",
  created_at: "2025-07-30T14:00:00Z",
  payload: {
    action: "closed",
    pull_request: { number, merged: true, title: `Pull request ${number}`, head: { ref: "agent/frontend/x" } },
  },
});
const LIVE_EVENTS = [merge(101), merge(102), merge(103)];

const okResponse = (payload) => ({
  ok: true,
  status: 200,
  headers: { get: (name) => (name.toLowerCase() === "date" ? RESPONSE_DATE : null) },
  json: async () => payload,
});

// The published record file is simply absent in this file, so the only count a
// failed request can fall back to is the one the browser retained.
const answering = async (url) => (url.includes("api.github.com")
  ? okResponse(url.includes("paint-lab") ? LIVE_EVENTS : [])
  : { ok: false, status: 404 });
const rateLimited = async (url) => (url.includes("api.github.com")
  ? { ok: false, status: 403 }
  : { ok: false, status: 404 });

const retainedJson = (count = 412, takenAt = RETAINED_ISO) =>
  JSON.stringify({ schemaVersion: RETAINED_COUNT_SCHEMA, count, takenAt });

const clipboardOf = (writes) => ({ writeText: async (value) => { writes.push(value); } });

/** The observatory, with the control wired to a clipboard the test can read. */
async function openObservatory(t, { writes = [], storage = {}, clipboard } = {}) {
  const page = await loadPage(PAGE_URL, { storage });
  t.after(() => page.restore());
  bindMergedCountCopy(page.document, clipboard ?? clipboardOf(writes));
  return page;
}

const button = (document) => document.getElementById(MERGED_COPY_IDS.button);
const status = (document) => document.getElementById(MERGED_COPY_IDS.status);
const flush = () => new Promise((resolve) => setImmediate(resolve));

// --- the payload, on its own ------------------------------------------------

test("a live payload carries the count, what it counts, when, and where to check it", () => {
  const summary = buildMergedCountCopy("live", { count: 3, asOf: new Date(RESPONSE_DATE) }, HARNESS_ORIGIN);

  assert.equal(summary.available, true);
  assert.equal(summary.reason, "live");
  // The figure exactly as the readout renders it: the digit, then its unit.
  assert.equal(summary.lines[0], `3 ${mergedCountUnit(3)}`);
  assert.equal(summary.lines[1], MERGED_COPY_NOTE);
  for (const repository of SOURCE_REPOSITORIES) {
    assert.ok(summary.text.includes(repository), `${repository} is not named in the payload`);
  }
  // When it was counted, from the response's own arrival time.
  assert.ok(summary.text.includes(`Counted from public GitHub activity in `
    + `${SOURCE_REPOSITORIES.join(" and ")}, as of ${RESPONSE_STAMP}.`), summary.text);
  assert.doesNotMatch(summary.text, /previous count/, "a live count must not describe itself as an earlier one");
  // The proof: the exact responses the count was computed from, each named the
  // way the link beside it is named, and this page's own absolute address.
  for (const [index, url] of EVENTS_URLS.entries()) {
    assert.ok(summary.text.includes(`${feedLinkText(SOURCE_REPOSITORIES[index])}: ${url}`), summary.text);
  }
  assert.ok(summary.text.includes(`${HARNESS_ORIGIN}/agents.html`), "the observatory's absolute URL is missing");
  assert.doesNotMatch(summary.text, /\/agents\.html(?!$)[^\s]/);
});

test("the payload is plain text and claims nothing the block does not", () => {
  const live = buildMergedCountCopy("live", { count: 3, asOf: new Date(RESPONSE_DATE) }, HARNESS_ORIGIN);
  const recorded = buildMergedCountCopy("recorded", { count: 412, takenAt: new Date(RETAINED_ISO) }, HARNESS_ORIGIN);

  for (const summary of [live, recorded]) {
    // No markup, at all: this is what a paste into a plain-text field gets.
    assert.doesNotMatch(summary.text, /[<>]|&[a-z]+;|\*\*|\[.*\]\(/,
      `the payload carries markup: ${summary.text}`);
    // No rate, no trend, no per-day figure, no percentage. The block states a
    // count and a time; a payload that states a velocity states something
    // nobody counted.
    assert.doesNotMatch(summary.text, /%|per day|per week|per month|a day\b|rate\b|trend|average|faster|growing/i,
      `the payload asserts something the block does not: ${summary.text}`);
    // "public" only ever introduces GitHub, the way the rest of the page does.
    assert.doesNotMatch(summary.text, /\bpublic\b(?! GitHub)/i, summary.text);
  }
});

test("a retained payload says it is a previous count, and says when it was taken", () => {
  const summary = buildMergedCountCopy("recorded", { count: 412, takenAt: new Date(RETAINED_ISO) }, HARNESS_ORIGIN);

  assert.equal(summary.available, true);
  assert.equal(summary.reason, "recorded");
  assert.equal(summary.lines[0], `412 ${mergedCountUnit(412)}`);
  assert.match(summary.text, /This is a previous count, not a live one\./);
  assert.ok(summary.text.includes(RETAINED_STAMP), `the payload drops the time it was taken: ${summary.text}`);
  // The freshness is the block's own, not a second vocabulary for it.
  assert.match(summary.text, /did not answer just now, so this is the last count taken from/);
});

test("nothing without a dated whole count is copyable", () => {
  const asOf = new Date(RESPONSE_DATE);
  const cases = {
    "a loading slot": ["loading", { count: 3, asOf }],
    "an unavailable slot": ["unavailable", { count: 3, asOf }],
    "a state nothing recognises": ["nonsense", { count: 3, asOf }],
    "a live count with no response time": ["live", { count: 3 }],
    "a live count with an unusable response time": ["live", { count: 3, asOf: new Date("nonsense") }],
    "a retained count with no time": ["recorded", { count: 3 }],
    // A live slot has no `takenAt`, and a retained slot has no `asOf`: neither
    // may borrow the other's stamp to look dated.
    "a live count dated by a retained stamp": ["live", { count: 3, takenAt: new Date(RETAINED_ISO) }],
    "a retained count dated by a response": ["recorded", { count: 3, asOf }],
    "no count at all": ["live", { asOf }],
    "a fractional count": ["live", { count: 3.5, asOf }],
    "a negative count": ["live", { count: -1, asOf }],
    "nothing whatever": ["live", undefined],
  };

  for (const [what, [state, values]] of Object.entries(cases)) {
    const summary = buildMergedCountCopy(state, values, HARNESS_ORIGIN);
    assert.equal(summary.available, false, what);
    assert.equal(summary.text, "", `${what}: a payload was composed anyway`);
    assert.deepEqual(summary.lines, [], what);
  }
  // A zero is an answer public GitHub can give about merges, so it is copyable.
  const zero = buildMergedCountCopy("live", { count: 0, asOf }, HARNESS_ORIGIN);
  assert.equal(zero.available, true);
  assert.equal(zero.lines[0], "0 merged pull requests");
});

test("the observatory URL is absolute, whatever the caller knows about origins", () => {
  assert.equal(observatoryUrl("https://preview.example"), "https://preview.example/agents.html");
  // No origin, an unusable one, or none at all: the published address, never a
  // relative path that resolves against wherever the paste lands.
  for (const missing of [undefined, null, "", "   not a url   "]) {
    assert.equal(observatoryUrl(missing), `${PUBLISHED_ORIGIN}/agents.html`, String(missing));
  }
});

// --- the shipped page -------------------------------------------------------

test("the served page offers no copyable figure, and says why", async (t) => {
  const page = await openObservatory(t);
  const { document } = page;
  const control = button(document);

  // Nothing has been counted, so nothing may be copied. The reason is on the
  // page as text — not a tooltip, not a title, not an aria-only description.
  assert.equal(document.getElementById(MERGED_COPY_IDS.block).dataset.state, "no_count");
  assert.equal(control.disabled, true);
  assert.equal(textOf(document.getElementById(MERGED_COPY_IDS.reason)), MERGED_COPY_NO_COUNT);
  assert.ok(!document.getElementById(MERGED_COPY_IDS.reason).hidden);
  assert.equal(tabSequence(document).includes(control), false,
    "a control with nothing to copy is not a tab stop a reader can land on and press");
  // The label names what would be copied, and the block is where it names it.
  assert.equal(textOf(control), MERGED_COPY_LABEL);
  assert.equal(control.parentNode.parentNode.id, "merged-figure");
  assert.equal(textOf(status(document)), "");
});

test("a settled request with nothing behind it leaves the control off", async (t) => {
  const writes = [];
  const page = await openObservatory(t, { writes, storage: {} });
  await loadActivity(page.document, rateLimited, page.storage);

  assert.equal(page.document.querySelector("#merged-figure").dataset.state, "unavailable");
  const control = button(page.document);
  assert.equal(control.disabled, true);
  assert.equal(control.dataset.copyText, "");
  assert.equal(textOf(page.document.getElementById(MERGED_COPY_IDS.reason)), MERGED_COPY_NO_COUNT);

  // A disabled control takes no press at all, so nothing reaches the clipboard
  // and nothing is announced: the state with no count says one thing, once.
  control.click();
  await flush();
  assert.deepEqual(writes, [], "a browser with no count must not put a figure on the clipboard");
  assert.equal(textOf(status(page.document)), "");
});

test("a press with no payload behind it reports a failure rather than an empty clipboard", async (t) => {
  // The belt to the disabled button's braces: whatever puts a press through to
  // the handler, an empty payload is never written over what a reader is
  // holding, and is never reported as a copy.
  const writes = [];
  const page = await openObservatory(t, { writes, storage: {} });
  await loadActivity(page.document, rateLimited, page.storage);
  const control = button(page.document);
  control.disabled = false;
  control.click();
  await flush();

  assert.deepEqual(writes, []);
  assert.equal(textOf(status(page.document)), MERGED_COPY_FEEDBACK.failed);
});

test("the keyboard-operable control copies the number that is on the screen", async (t) => {
  const writes = [];
  const page = await openObservatory(t, { writes, storage: {} });
  const { document } = page;
  await loadActivity(document, answering, page.storage);

  const control = button(document);
  assert.equal(document.querySelector("#merged-figure").dataset.state, "live");
  assert.equal(control.disabled, false);
  assert.equal(control.type, "button");
  assert.ok(tabSequence(document).includes(control), "the copy control is keyboard-reachable");

  control.focus();
  pressEnter(document);
  await flush();

  assert.equal(writes.length, 1, "one press, one clipboard write");
  const [payload] = writes;
  // THE CONTRACT. The rendered digit and the copied digit are one value: the
  // number is read off the paint, so there is no second figure to disagree.
  const rendered = textOf(document.querySelector(".merged-figure-count"));
  const unit = textOf(document.querySelector(".merged-figure-unit")).trim();
  assert.equal(rendered, "3");
  assert.ok(payload.startsWith(`${rendered} ${unit}\n`), `the payload does not open on the rendered figure: ${payload}`);
  assert.ok(payload.includes(RESPONSE_STAMP), "the copied count is undated");
  assert.ok(payload.includes(`${HARNESS_ORIGIN}/agents.html`));
  for (const url of EVENTS_URLS) assert.ok(payload.includes(url), `${url} is not in the payload`);
  assert.equal(textOf(status(document)), MERGED_COPY_FEEDBACK.copied);
  assert.equal(status(document).dataset.outcome, "copied");
});

test("a retained figure is copied as a previous count, dated when it was taken", async (t) => {
  const writes = [];
  const page = await openObservatory(t, { writes, storage: { [RETAINED_COUNT_KEY]: retainedJson() } });
  const { document } = page;
  await loadActivity(document, rateLimited, page.storage);

  assert.equal(document.querySelector("#merged-figure").dataset.state, "recorded");
  button(document).click();
  await flush();

  const [payload] = writes;
  const rendered = textOf(document.querySelector(".merged-figure-count"));
  assert.equal(rendered, "412");
  assert.ok(payload.startsWith(`${rendered} merged pull requests\n`), payload);
  assert.match(payload, /This is a previous count, not a live one\./);
  assert.ok(payload.includes(RETAINED_STAMP), `the retained payload drops its own date: ${payload}`);
  // The freshness the payload states is the freshness the block states, read
  // off the same render — never a second notion of how old this number is.
  assert.ok(textOf(document.querySelector(".merged-figure-source")).includes("2025-07-14"));
});

test("a later paint takes the earlier payload and its confirmation with it", async (t) => {
  const writes = [];
  const page = await openObservatory(t, { writes, storage: {} });
  const { document } = page;
  await loadActivity(document, answering, page.storage);
  button(document).click();
  await flush();
  assert.equal(textOf(status(document)), MERGED_COPY_FEEDBACK.copied);

  // A refresh that fails clears the count on screen, so the payload behind the
  // control goes with it: "Copied." standing over a figure that is no longer
  // rendered is the one way this control could lie. The storage stub keeps
  // nothing, so this is the browser that has never held a count.
  const forgetful = { getItem: () => null, setItem: () => {} };
  await loadActivity(document, rateLimited, forgetful);
  assert.equal(document.querySelector("#merged-figure").dataset.state, "unavailable");
  assert.equal(button(document).disabled, true);
  assert.equal(button(document).dataset.copyText, "");
  assert.equal(textOf(status(document)), "");
  assert.equal(writes.length, 1, "nothing was copied by a repaint");
});

test("a live count that falls back to a retained one retires the earlier confirmation", async (t) => {
  const writes = [];
  const page = await openObservatory(t, { writes, storage: {} });
  const { document } = page;
  await loadActivity(document, answering, page.storage);
  const live = button(document).dataset.copyText;
  button(document).click();
  await flush();
  assert.equal(textOf(status(document)), MERGED_COPY_FEEDBACK.copied);

  // The same figure, now as the count this browser retained: a different claim
  // about how fresh it is, so a different payload and no stale confirmation.
  await loadActivity(document, rateLimited, page.storage);
  assert.equal(document.querySelector("#merged-figure").dataset.state, "recorded");
  assert.equal(button(document).disabled, false);
  assert.notEqual(button(document).dataset.copyText, live);
  assert.match(button(document).dataset.copyText, /This is a previous count, not a live one\./);
  assert.equal(textOf(status(document)), "");
});

test("a refused clipboard says so, and never reports a copy that did not happen", async (t) => {
  const page = await openObservatory(t, {
    storage: {}, clipboard: { writeText: async () => { throw new Error("denied"); } },
  });
  await loadActivity(page.document, answering, page.storage);
  page.document.getElementById(MERGED_COPY_IDS.button).click();
  await flush();

  const line = status(page.document);
  assert.equal(textOf(line), MERGED_COPY_FEEDBACK.failed);
  assert.equal(line.dataset.outcome, "manual");
  assert.equal(line.getAttribute("role"), "status");
  assert.equal(line.getAttribute("aria-live"), "polite");
  // The recovery it names is on the page, so a refusal is a nuisance and not a
  // dead end: the count, its date, and its feeds are all still rendered.
  assert.match(textOf(page.document.querySelector(".merged-figure-source")), /Counted from/);
});

// --- what the control was not allowed to disturb -----------------------------

test("the count wording, the provenance sentence, and both feed links are unchanged", async (t) => {
  const page = await openObservatory(t, { storage: {} });
  const { document } = page;

  // The note the payload repeats, byte for byte, so the copy cannot say
  // something the page does not.
  const note = textOf(document.querySelector("#merged-figure-note"));
  assert.ok(note.startsWith(MERGED_COPY_NOTE), `the block's own sentence has moved: ${note}`);
  assert.ok(note.includes("Read the releases these pull requests shipped"));

  // Both verification links, in their order, with their exact words and hrefs.
  const links = document.querySelector(".merged-figure-sources").querySelectorAll("a");
  assert.deepEqual(links.map((link) => link.getAttribute("href")), EVENTS_URLS);
  assert.deepEqual(links.map(textOf), SOURCE_REPOSITORIES.map(feedLinkText));

  // And the provenance sentence a live response paints, still the shared one.
  await loadActivity(document, answering, page.storage);
  const clock = textOf(document.querySelector(".merged-figure-time"));
  assert.equal(textOf(document.querySelector(".merged-figure-source")),
    `Counted from 3 public GitHub events in ${SOURCE_REPOSITORIES.join(" and ")}, as of ${clock}`);
  assert.equal(document.querySelector(".merged-figure-time").dateTime, new Date(RESPONSE_DATE).toISOString());
  const sequence = tabSequence(document);
  for (const link of links) {
    assert.ok(sequence.indexOf(link) < sequence.indexOf(document.querySelector("#refresh-activity")),
      `${textOf(link)} is still read with the leading content`);
  }
});
