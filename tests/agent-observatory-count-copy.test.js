// Taking the observatory's one real number away with you.
//
// The figure is the site's proof point, and it was only ever readable where it
// is rendered: forwarded by hand it arrived as a bare digit with no repositories
// behind it, no moment it was taken, and no address to check it at. The control
// pinned here copies the whole claim as plain text.
//
// What the cases below are actually about is that the clipboard cannot outrun
// the page. The copied number is the rendered number, the copied time is the
// rendered figure's own time, a previous count says in the pasted text that it
// is a previous one, and a page with no figure on it hands over nothing at all —
// not a stale string, not a zero, and not a sentence with a digit in it.
//
// The browser harness reflects `disabled` and refuses to click a disabled
// control, so the refusal is asserted twice: once on the control as it ships,
// and once with the control forced back open, which is the only way to prove the
// refusal is the handler's and not the styling's.

import assert from "node:assert/strict";
import test from "node:test";
import {
  MERGED_COUNT_COPY,
  OBSERVATORY_PATH,
  buildMergedCountCopy,
  observatoryUrl,
} from "../src/merged-count-copy.js";
import { SOURCE_REPOSITORIES } from "../src/public-merges.js";
import { RETAINED_COUNT_KEY, RETAINED_COUNT_SCHEMA } from "../src/merged-count-retention.js";
import { EVENTS_URLS, bindMergedCountCopy, loadActivity } from "../src/agents.js";
import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";

const PAGE_URL = new URL("../src/agents.html", import.meta.url);
const RESPONSE_DATE = "Wed, 30 Jul 2025 14:32:00 GMT";
const RETAINED = { count: 412, takenAt: "2026-07-14T09:03:00.000Z" };
const OBSERVATORY_URL = "https://labs.wawalu.org/agents.html";

const flush = () => new Promise((done) => { setImmediate(done); });

function pullRequestEvent(number, merged) {
  return {
    id: String(number),
    type: "PullRequestEvent",
    created_at: "2025-07-30T14:00:00Z",
    payload: { action: "closed", pull_request: { number, merged, title: `Pull request ${number}` } },
  };
}

/** `merges` merged pull requests, and one push that is not one of them. */
const feedOf = (merges) => [
  ...Array.from({ length: merges }, (unused, index) => pullRequestEvent(100 + index, true)),
  pullRequestEvent(900, false),
];

const okResponse = (payload) => ({
  ok: true,
  status: 200,
  headers: { get: (name) => (name.toLowerCase() === "date" ? RESPONSE_DATE : null) },
  json: async () => payload,
});

const RATE_LIMITED = { ok: false, status: 403 };

/**
 * One fetcher for both destinations the page reads, so no case here can be green
 * because a request silently reached the other one — or the network. The
 * published record is refused throughout: this file is about the live count and
 * about what this browser itself retained.
 */
function observatoryFetcher(github) {
  return async (url) => {
    const target = String(url);
    if (target.includes("merged-pull-request-count")) return { ok: false, status: 404 };
    assert.ok(EVENTS_URLS.includes(target), `unexpected request in a test: ${target}`);
    return typeof github === "function" ? github(target) : github;
  };
}

const feed = (payload) => (url) => okResponse(url.includes("paint-lab") ? payload : []);

/** The retained count as this browser would actually have written it. */
const retainedStorage = (record = RETAINED) => ({
  [RETAINED_COUNT_KEY]: JSON.stringify({ schemaVersion: RETAINED_COUNT_SCHEMA, ...record }),
});

/**
 * The shipped page, wired the way agents.js wires it on load, with a clipboard
 * this test can read back.
 */
async function openObservatory(t, { storage = {} } = {}) {
  const page = await loadPage(PAGE_URL, { storage });
  t.after(() => page.restore());
  const copied = [];
  const clipboard = { writeText: async (value) => { copied.push(value); } };
  bindMergedCountCopy(page.document, clipboard);
  return { document: page.document, copied };
}

const control = (document) => document.querySelector("#copy-merged-count");
const statusOf = (document) => textOf(document.querySelector("#merged-figure-copy-status"));

/* ----------------------------- the served page ---------------------------- */

test("the control sits in the figure, names what it copies, and ships refused", async (t) => {
  const { document } = await openObservatory(t);
  const button = control(document);

  // Inside the block whose number it copies, not beside it: a reader who found
  // the figure has found the control.
  assert.equal(document.querySelector("#merged-figure").querySelectorAll("#copy-merged-count").length, 1);
  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.getAttribute("type"), "button");
  // The label names the thing, not the gesture. "Copy" alone leaves a reader
  // guessing which of the figure, the links, or the page is about to be taken.
  assert.equal(textOf(button), MERGED_COUNT_COPY.label);
  assert.match(textOf(button), /count/i);
  assert.match(textOf(button), /sources/i);

  // The served page holds no count, so the control holds nothing, and the reason
  // is on the page rather than in a tooltip or a title.
  assert.ok(button.disabled, "a page with no figure on it may not offer one");
  assert.equal(statusOf(document), MERGED_COUNT_COPY.nothing);
  assert.equal(button.getAttribute("aria-describedby"), "merged-figure-copy-status");
  assert.equal(tabSequence(document).includes(button), false, "a refused control is not a tab stop");

  // One live region in the figure, still: the readout is the announcement, and
  // the copy status is a status region without a second aria-live on it.
  assert.equal(document.querySelector("#merged-figure").querySelectorAll("[aria-live]").length, 1);
  assert.equal(document.querySelector("#merged-figure-copy-status").getAttribute("role"), "status");
});

/* ------------------------------- a live count ----------------------------- */

test("a live count is copyable by keyboard, and confirms in words that it was copied", async (t) => {
  const { document, copied } = await openObservatory(t);
  await loadActivity(document, observatoryFetcher(feed(feedOf(3))));
  const button = control(document);

  assert.equal(document.querySelector("#merged-figure").dataset.state, "live");
  assert.equal(textOf(document.querySelector(".merged-figure-count")), "3");
  assert.equal(button.disabled, false, "a painted figure is a copyable figure");
  // The reason is withdrawn with the refusal: nothing on the page still says
  // there is nothing to copy while the control is offering something.
  assert.equal(statusOf(document), "");

  assert.ok(tabSequence(document).includes(button), "the control is reachable by Tab alone");
  button.focus();
  pressEnter(document);
  await flush();

  assert.equal(copied.length, 1, "one activation copies once");
  assert.equal(statusOf(document), MERGED_COUNT_COPY.copied);
  assert.match(statusOf(document), /copied/i);
});

test("the copied text carries the rendered number, both repositories, and this page's address", async (t) => {
  const { document, copied } = await openObservatory(t);
  await loadActivity(document, observatoryFetcher(feed(feedOf(3))));
  control(document).click();
  await flush();

  const [payload] = copied;
  assert.equal(payload.startsWith("3 merged pull requests"), true, `the count does not lead: ${payload}`);
  assert.ok(payload.includes(textOf(document.querySelector(".merged-figure-count"))),
    "the copied figure is the rendered figure");
  // Why the number is worth forwarding, in one sentence with no digit in it.
  assert.ok(payload.includes("These merged pull requests built and changed the pages of this site."));
  for (const repository of SOURCE_REPOSITORIES) {
    assert.ok(payload.includes(repository), `${repository} is not named in the copied text`);
  }
  assert.ok(payload.includes(OBSERVATORY_URL), `the copied text carries no absolute address: ${payload}`);
  // Nothing beyond what the page shows: no rate, no trend, no per-day figure,
  // and no percentage a reader could quote back as this block's claim.
  assert.doesNotMatch(payload, /%|per day|per week|per month|average|trend|faster|growth/i);
});

test("the copied text follows the number, rather than repeating one it was written with", async (t) => {
  const payloads = [];
  for (const merges of [3, 7, 1]) {
    const { document, copied } = await openObservatory(t);
    await loadActivity(document, observatoryFetcher(feed(feedOf(merges))));
    control(document).click();
    await flush();
    assert.equal(textOf(document.querySelector(".merged-figure-count")), String(merges));
    payloads.push(copied[0]);
  }

  assert.ok(payloads[0].startsWith("3 merged pull requests"));
  assert.ok(payloads[1].startsWith("7 merged pull requests"));
  // One merge is one request. The unit comes from the count, the way the
  // rendered unit does, so the pasted text cannot be off by a plural.
  assert.ok(payloads[2].startsWith("1 merged pull request,"), `a single merge reads oddly: ${payloads[2]}`);
  assert.equal(new Set(payloads).size, 3, "three different figures produced three different strings");
});

test("a live count says in the copied text when it was counted", async (t) => {
  const { document, copied } = await openObservatory(t);
  await loadActivity(document, observatoryFetcher(feed(feedOf(3))));
  control(document).click();
  await flush();

  // The response's own arrival time, in the ISO date and UTC clock the block
  // prints elsewhere, so the pasted stamp and the rendered stamp are one stamp.
  const taken = new Date(RESPONSE_DATE);
  assert.ok(copied[0].includes(`counted on ${taken.toISOString().slice(0, 10)} at `
    + `${taken.toISOString().slice(11, 16)} UTC`), `the count is undated: ${copied[0]}`);
  // A fresh count is not hedged as an old one.
  assert.doesNotMatch(copied[0], /previous count|did not answer/);
});

/* --------------------------- a last-known count --------------------------- */

test("a count kept from an earlier visit is copied as a previous one, with its own time", async (t) => {
  const { document, copied } = await openObservatory(t, { storage: retainedStorage() });
  await loadActivity(document, observatoryFetcher(() => RATE_LIMITED));
  await flush();

  assert.equal(document.querySelector("#merged-figure").dataset.state, "recorded");
  assert.equal(textOf(document.querySelector(".merged-figure-count")), "412");
  control(document).click();
  await flush();

  const [payload] = copied;
  assert.ok(payload.startsWith("412 merged pull requests."), `the retained figure is not the copied one: ${payload}`);
  // The pasted text may not read as current when the page does not call it
  // current: it says it is an earlier count and dates it, in that order.
  assert.ok(payload.includes("This is a previous count, taken on 2026-07-14 at 09:03 UTC"),
    `the copied text does not date the previous count: ${payload}`);
  assert.ok(payload.includes("public GitHub activity did not answer just now"));
  assert.ok(payload.includes(OBSERVATORY_URL));
  for (const repository of SOURCE_REPOSITORIES) assert.ok(payload.includes(repository));
});

/* ------------------------------ nothing to say ---------------------------- */

test("no count ever taken and no answer from GitHub copies nothing and says why", async (t) => {
  const { document, copied } = await openObservatory(t, { storage: {} });
  await loadActivity(document, observatoryFetcher(() => RATE_LIMITED));
  await flush();

  const button = control(document);
  assert.equal(document.querySelector("#merged-figure").dataset.state, "unavailable");
  assert.ok(button.disabled, "nothing may be offered for copying when there is no figure");
  assert.equal(statusOf(document), MERGED_COUNT_COPY.nothing);
  // The reason carries no digit, for the reason the empty readout carries none.
  assert.doesNotMatch(statusOf(document), /\d/);

  button.click();
  await flush();
  assert.equal(copied.length, 0, "a refused control wrote to the clipboard");

  // And the refusal is the handler's, not the styling's: forced back open, the
  // control still has nothing to hand over and still says so.
  button.disabled = false;
  button.click();
  await flush();
  assert.equal(copied.length, 0, "an enabled-looking control copied a figure the page does not have");
  assert.equal(statusOf(document), MERGED_COUNT_COPY.nothing);
});

test("a refused clipboard leaves visible recovery guidance rather than a silent failure", async (t) => {
  const page = await loadPage(PAGE_URL);
  t.after(() => page.restore());
  const { document } = page;
  bindMergedCountCopy(document, { writeText: async () => { throw new Error("denied"); } });

  await loadActivity(document, observatoryFetcher(feed(feedOf(3))));
  control(document).click();
  await flush();

  assert.equal(statusOf(document), MERGED_COUNT_COPY.failed);
  assert.match(statusOf(document), /copy it manually/);
});

/* ------------------------------- the payload ------------------------------ */

test("the copied payload is plain text: no markup, no markdown, no entity references", () => {
  const payloads = [
    buildMergedCountCopy({ state: "live", count: 3, takenAt: new Date(RESPONSE_DATE) }),
    buildMergedCountCopy({ state: "recorded", count: 412, takenAt: new Date(RETAINED.takenAt) }),
  ];
  for (const payload of payloads) {
    assert.doesNotMatch(payload, /[<>]/, `the payload carries markup: ${payload}`);
    assert.doesNotMatch(payload, /&[A-Za-z][A-Za-z0-9]*;/, `the payload carries an entity reference: ${payload}`);
    // Markdown is markup a reader pastes into a plain-text field and reads raw.
    assert.doesNotMatch(payload, /\*\*|\[[^\]]*\]\(|^#|\n\s*[-*] /m, `the payload carries markdown: ${payload}`);
    assert.equal(payload.trim(), payload, "the payload is trimmed");
  }
});

test("a figure the page could not date, or could not name a state for, is not copyable", () => {
  const takenAt = new Date(RESPONSE_DATE);
  for (const [name, figure] of Object.entries({
    "nothing at all": null,
    "no state": { count: 3, takenAt },
    "a state the page does not paint a figure in": { state: "loading", count: 3, takenAt },
    "an unavailable state": { state: "unavailable", count: 0, takenAt },
    "no timestamp": { state: "live", count: 3 },
    "an unparseable timestamp": { state: "live", count: 3, takenAt: new Date("nonsense") },
    "no count": { state: "recorded", takenAt },
    "a fractional count": { state: "live", count: 3.5, takenAt },
    "a negative count": { state: "live", count: -1, takenAt },
  })) {
    assert.equal(buildMergedCountCopy(figure), null, `${name} produced a copyable claim`);
  }
  // A zero is an answer public GitHub can give about merges, so it is a figure.
  assert.ok(buildMergedCountCopy({ state: "live", count: 0, takenAt })?.startsWith("0 merged pull requests"));
});

test("the address in the copied text is this page, taken from where it is served", () => {
  assert.equal(OBSERVATORY_PATH, "/agents.html");
  assert.equal(observatoryUrl(), OBSERVATORY_URL, "with no origin to read, the canonical address is used");
  assert.equal(observatoryUrl("https://preview.example"), "https://preview.example/agents.html",
    "a preview build pastes its own address rather than a production one");
  assert.equal(observatoryUrl("not a url"), OBSERVATORY_URL, "an unusable origin falls back rather than throwing");
});
