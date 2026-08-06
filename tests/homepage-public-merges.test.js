// The front door's one checkable number.
//
// Everything else this page states is invented and says so. This figure is
// counted from public GitHub, and the Agent observatory counts the same thing
// from the same response — so what has to be pinned is that the two cannot
// disagree, that the links beside the number are the responses it came from,
// and that a GitHub which does not answer leaves no digit behind on either the
// painted page or the document a visitor is served.
//
// Every fetcher here is a stub. Nothing in this file reaches GitHub, and
// loadPage's own fetch throws on any request a test did not declare.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadActivity } from "../src/agents.js";
import { EVENTS_URLS, UNAVAILABLE_REASONS, unavailableSentence } from "../src/public-merges.js";
import { loadPublicMerges, renderPublicMergeSources } from "../src/public-merges-view.js";
import { loadPage, parseHtml, textOf } from "./support/browser.js";
import { createElement, first, installDocument } from "./support/dom.js";

installDocument();

const HOME_URL = new URL("../src/index.html", import.meta.url);
const OBSERVATORY_URL = new URL("../src/agents.html", import.meta.url);
const RESPONSE_DATE = "Wed, 30 Jul 2025 14:32:00 GMT";

const pullRequestEvent = ({ number, merged, action = "closed" }) => ({
  id: String(number),
  type: "PullRequestEvent",
  created_at: "2025-07-30T14:00:00Z",
  payload: {
    action,
    pull_request: {
      number, merged, title: `Pull request ${number}`,
      html_url: `https://github.com/AndrewLikesTea/paint-lab/pull/${number}`,
      head: { ref: "agent/fullstack/count" },
    },
  },
});

// Five live events, three of them merges: a close that merged is a merge, a
// close that did not is not, and an open carrying a `merged` flag is not either.
const LIVE_EVENTS = [
  pullRequestEvent({ number: 101, merged: true }),
  pullRequestEvent({ number: 102, merged: true }),
  pullRequestEvent({ number: 103, merged: false }),
  pullRequestEvent({ number: 104, merged: false, action: "opened" }),
  pullRequestEvent({ number: 105, merged: true }),
];

const okResponse = (payload) => ({
  ok: true,
  status: 200,
  headers: { get: (name) => (name.toLowerCase() === "date" ? RESPONSE_DATE : null) },
  json: async () => payload,
});

// One feed carries the fixture and the other is empty, so a doubled payload
// cannot quietly double either page's count. Anything that is not a GitHub feed
// — the observatory's published record, for one — is simply not found, which is
// the situation this file is about.
const githubFetcher = (payload) => async (url) => (
  url.includes("api.github.com")
    ? okResponse(url.includes("paint-lab") ? payload : [])
    : { ok: false, status: 404 }
);

function observatoryRoot() {
  const nodes = {
    "#activity-list": createElement("ol"),
    "#activity-status": createElement("div"),
    ".signal-card": createElement("div"),
    "#connection-label": createElement("strong"),
    "#last-updated": createElement("span"),
    "#refresh-activity": createElement("button"),
    "#merged-figure": createElement("section"),
    "#merged-figure-readout": createElement("div"),
  };
  nodes["#activity-list"].querySelector = () => null;
  return { nodes, querySelector: (selector) => nodes[selector] ?? null };
}

const anchorsIn = (node) => [...node.querySelectorAll("a")];

test("one GitHub response produces one number, on the home page and in the observatory", async (t) => {
  const fetcher = githubFetcher(LIVE_EVENTS);

  const observatory = observatoryRoot();
  await loadActivity(observatory, fetcher);
  assert.equal(observatory.nodes["#merged-figure"].dataset.state, "live");
  const observed = first(observatory.nodes["#merged-figure-readout"], "merged-figure-count").textContent;

  const page = await loadPage(HOME_URL, {});
  t.after(() => page.restore());
  await loadPublicMerges(page.document, fetcher);

  const section = page.document.querySelector("#public-merges");
  const readout = page.document.querySelector("#public-merges-readout");
  assert.equal(section.dataset.state, "live");
  // Three merges among five closes and opens, read the same way twice.
  assert.equal(observed, "3");
  const [digit] = [...readout.querySelectorAll("strong")];
  assert.equal(digit.textContent, observed, "the two pages disagree about one response");
  // The unit is the observatory's own, so one count is never two labels.
  assert.match(textOf(readout), /^3 merged pull requests/);
  assert.match(textOf(readout), /Counted from public GitHub activity in AndrewLikesTea\/paint-lab and AndrewLikesTea\/wawalu-agent-lab/);
});

test("the count's verification links are the observatory's, and the feeds it was counted from", async (t) => {
  const page = await loadPage(HOME_URL, {});
  t.after(() => page.restore());
  renderPublicMergeSources(page.document);

  const painted = anchorsIn(page.document.querySelector("#public-merges-sources"))
    .map((link) => link.getAttribute("href"));
  assert.deepEqual(painted, EVENTS_URLS, "the home page links somewhere the count did not come from");

  const observatory = parseHtml(await readFile(OBSERVATORY_URL, "utf8"));
  const linked = anchorsIn(observatory.querySelector(".merged-figure-sources"))
    .map((link) => link.getAttribute("href"));
  assert.deepEqual(linked, painted, "the two pages send a reader to different feeds to check one number");
});

// Every way GitHub can fail to answer, and the one thing they must all do:
// state what happened, in words, and render nothing that looks like a figure.
const FAILURES = [
  ["a rate limit", async () => ({ ok: false, status: 403 }), UNAVAILABLE_REASONS.rateLimited],
  ["a server error", async () => ({ ok: false, status: 500 }), UNAVAILABLE_REASONS.errorStatus],
  ["a malformed body", async () => ({
    ok: true, status: 200, headers: { get: () => RESPONSE_DATE },
    json: async () => { throw new SyntaxError("Unexpected token < in JSON"); },
  }), UNAVAILABLE_REASONS.malformed],
  ["a network error", async () => { throw new TypeError("Failed to fetch"); }, UNAVAILABLE_REASONS.unreachable],
  ["a response with nothing to count", async () => okResponse([]), UNAVAILABLE_REASONS.empty],
];

for (const [what, fetcher, reason] of FAILURES) {
  test(`${what} leaves a plain reason and no digit at all`, async (t) => {
    const page = await loadPage(HOME_URL, {});
    t.after(() => page.restore());
    const result = await loadPublicMerges(page.document, fetcher);

    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    const section = page.document.querySelector("#public-merges");
    assert.equal(section.dataset.state, "unavailable");
    assert.equal(textOf(page.document.querySelector("#public-merges-readout")), unavailableSentence(reason));
    // No zero, no dash standing in for a digit, no remembered figure: the whole
    // block, links and boundary included, holds no numeral.
    assert.doesNotMatch(textOf(section), /\d/, `${what} left something a reader could read as a count`);
  });
}

test("a response still in flight shows the reason, never a placeholder digit", async (t) => {
  const page = await loadPage(HOME_URL, {});
  t.after(() => page.restore());
  let answer;
  const held = new Promise((resolve) => { answer = resolve; });
  const slow = async (url) => {
    await held;
    return okResponse(url.includes("paint-lab") ? LIVE_EVENTS : []);
  };

  const loading = loadPublicMerges(page.document, slow);
  const section = page.document.querySelector("#public-merges");
  assert.equal(section.dataset.state ?? section.getAttribute("data-state"), "unavailable");
  assert.doesNotMatch(textOf(section), /\d/, "a slow response flashed a digit a reader could quote");
  // The links are already there, so a reader who gives up waiting can still go
  // and count it themselves.
  assert.equal(anchorsIn(page.document.querySelector("#public-merges-sources")).length, EVENTS_URLS.length);

  answer();
  await loading;
  assert.match(textOf(page.document.querySelector("#public-merges-readout")), /^3 merged pull requests/);
});

test("the document a visitor is served authors no figure and no link of its own", async () => {
  const html = await readFile(HOME_URL, "utf8");
  const document = parseHtml(html);
  const section = document.querySelector("#public-merges");

  assert.equal(section.getAttribute("data-state"), "unavailable",
    "the shipped state must be the one with no number in it");
  assert.equal(textOf(document.querySelector("#public-merges-readout")),
    unavailableSentence(UNAVAILABLE_REASONS.pending),
    "the shipped sentence and the painted one must be the same sentence");
  assert.doesNotMatch(textOf(section), /\d/, "a figure is authored into the markup");
  assert.equal(anchorsIn(document.querySelector("#public-merges-sources")).length, 0,
    "the feed links must be built from the URLs the count is requested from, not typed");
  assert.match(html, /<script type="module" src="\/public-merges-view\.js">/,
    "the home page must load the module that paints the count");

  // The block says which kind of number this is, in the words this page already
  // uses for the invented ones, and the invented ones keep their own labels.
  const boundary = textOf(section);
  assert.match(boundary, /counted from public GitHub activity/i);
  assert.match(boundary, /bundled synthetic example/);
  assert.match(html, /It is a bundled synthetic example, computed from invented data for an invented company/);
  assert.match(html, /<strong>Representative synthetic records<\/strong>/);
});

test("the destination list says the observatory is not entirely invented", async () => {
  const html = await readFile(HOME_URL, "utf8");
  const entry = [...parseHtml(html).querySelector(".site-guide").querySelectorAll("li")]
    .find((item) => item.querySelector("a").getAttribute("href") === "/agents.html");

  assert.ok(entry, "the destination list must still name the Agent observatory");
  assert.match(textOf(entry), /public GitHub/, "a visitor scanning the list learns the observatory is grounded");
  // One number on the page: the list names the grounding, it does not restate
  // the figure.
  assert.doesNotMatch(textOf(entry), /\d/);
});

test("the feeds named in the observatory script are the feeds the shared module requests", async () => {
  // agents.js names both URLs in prose for the locked observatory audit that
  // reads them out of that file. Prose can drift; this is what stops it.
  const script = await readFile(new URL("../src/agents.js", import.meta.url), "utf8");
  const named = [...new Set(script.match(/https:\/\/api\.github\.com\/\S+/g) ?? [])];
  assert.deepEqual(named.sort(), [...EVENTS_URLS].sort());
});
