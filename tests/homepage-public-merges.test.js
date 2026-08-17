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
import {
  COUNTED_SUBJECT_SENTENCE,
  EVENTS_URLS,
  SOURCE_REPOSITORIES,
  UNAVAILABLE_REASONS,
  feedLinkText,
  unavailableSentence,
} from "../src/public-merges.js";
import { RETAINED_COUNT_KEY, RETAINED_COUNT_SCHEMA } from "../src/merged-count-retention.js";
import { loadPublicMerges, renderPublicMergeSources } from "../src/public-merges-view.js";
import { loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";
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

  // A number is worth what a reader can check it against, so the figure never
  // arrives alone: the feeds it was counted from are beside it, each named by
  // the repository it belongs to.
  const links = anchorsIn(page.document.querySelector("#public-merges-sources"));
  assert.deepEqual(links.map((link) => link.getAttribute("href")), EVENTS_URLS);
  assert.deepEqual(links.map((link) => textOf(link)), SOURCE_REPOSITORIES.map(feedLinkText));
  for (const [index, link] of links.entries()) {
    assert.match(textOf(link), new RegExp(SOURCE_REPOSITORIES[index].replace("/", "\\/")),
      "the link does not say whose merges it goes to");
  }
});

test("the count's verification links are the observatory's, and the feeds it was counted from", async (t) => {
  const page = await loadPage(HOME_URL, {});
  t.after(() => page.restore());
  renderPublicMergeSources(page.document);

  const painted = anchorsIn(page.document.querySelector("#public-merges-sources"))
    .map((link) => link.getAttribute("href"));
  assert.deepEqual(painted, EVENTS_URLS, "the home page links somewhere the count did not come from");

  const observatory = parseHtml(await readFile(OBSERVATORY_URL, "utf8"));
  const observed = anchorsIn(observatory.querySelector(".merged-figure-sources"));
  assert.deepEqual(observed.map((link) => link.getAttribute("href")), painted,
    "the two pages send a reader to different feeds to check one number");
  // The observatory's anchors are typed into its markup and the home page's are
  // built from public-merges.js. Both sides are pinned to that one source here,
  // so editing either page's wording alone reds this rather than shipping two
  // descriptions of one feed.
  const words = SOURCE_REPOSITORIES.map(feedLinkText);
  assert.deepEqual(anchorsIn(page.document.querySelector("#public-merges-sources")).map(textOf), words);
  assert.deepEqual(observed.map(textOf), words,
    "the two pages describe the same feed in different words");
  // Read out of context — a link list, a screen reader, no sentence before it —
  // each one still says what there is to count and where.
  for (const text of words) {
    assert.match(text, /merged pull requests/);
    assert.doesNotMatch(text, /\b(click here|see more|read more|this|here)\b/i);
  }
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
    // `baseline: null` is the build whose recorder has never had an answer, so
    // these cases keep asserting the never-counted wording rather than the
    // shipped baseline figure. See tests/merged-count-cold-start.test.js for
    // what a build WITH a recorded baseline shows on the same failures.
    const result = await loadPublicMerges(page.document, fetcher, undefined, { baseline: null });

    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    const section = page.document.querySelector("#public-merges");
    assert.equal(section.dataset.state, "unavailable");
    // Two sentences, both announced by the live region: the absence, and then
    // what was being counted. A reader must not be left with the absence alone.
    const said = page.document.querySelector("#public-merges-readout").querySelectorAll("p").map(textOf);
    assert.deepEqual(said, [unavailableSentence(reason), COUNTED_SUBJECT_SENTENCE]);
    assert.match(said[1], /merged pull requests/, `${what} did not say what was being counted`);
    for (const repository of SOURCE_REPOSITORIES) assert.ok(said[1].includes(repository));

    // And the way to check it yourself is still on the page, unchanged: same
    // feeds, same words, whether or not a number ever arrived.
    const links = anchorsIn(page.document.querySelector("#public-merges-sources"));
    assert.deepEqual(links.map((link) => link.getAttribute("href")), EVENTS_URLS,
      `${what} took the verification links away with the count`);
    assert.deepEqual(links.map(textOf), SOURCE_REPOSITORIES.map(feedLinkText));

    // No zero, no dash standing in for a digit, no remembered figure: the whole
    // block, links and boundary included, holds no numeral.
    assert.doesNotMatch(textOf(section), /\d/, `${what} left something a reader could read as a count`);
  });
}

// The retained state pins its figure and its hrefs in
// tests/merged-count-retention.test.js. What it did not pin is the half this
// block exists for: that the links a reader checks the number against are still
// there, still named by repository, when the number beside them is the earlier
// one rather than a live one. A repository name dropped from a link's text
// there would leave two indistinguishable destinations beside a stale figure.
test("a previously taken count keeps both feed links, each still naming its repository", async (t) => {
  const page = await loadPage(HOME_URL, {
    storage: { [RETAINED_COUNT_KEY]: JSON.stringify({
      schemaVersion: RETAINED_COUNT_SCHEMA, count: 412, takenAt: "2026-07-14T09:05:00.000Z",
    }) },
  });
  t.after(() => page.restore());
  const result = await loadPublicMerges(page.document, async () => ({ ok: false, status: 403 }), page.storage,
    { baseline: null });

  assert.equal(result.ok, false, "nothing in this run reached a live count");
  const section = page.document.querySelector("#public-merges");
  assert.equal(section.dataset.state, "retained");
  // The number is the remembered one, and it is dated and named as such.
  const readout = page.document.querySelector("#public-merges-readout");
  assert.match(textOf(readout), /^412 merged pull requests/);
  assert.match(textOf(readout), /did not answer just now/);

  const links = anchorsIn(page.document.querySelector("#public-merges-sources"));
  assert.deepEqual(links.map((link) => link.getAttribute("href")), EVENTS_URLS,
    "a stale count kept the figure and lost the way to check it");
  assert.deepEqual(links.map(textOf), SOURCE_REPOSITORIES.map(feedLinkText));
  for (const [index, link] of links.entries()) {
    assert.ok(textOf(link).includes(SOURCE_REPOSITORIES[index]),
      "the link beside a stale count does not say whose merges it goes to");
  }
});

test("the feed links are real anchors a keyboard reaches, after the sentence that sends a reader to them", async (t) => {
  const page = await loadPage(HOME_URL, {});
  t.after(() => page.restore());
  await loadPublicMerges(page.document, async () => ({ ok: false, status: 403 }));

  const links = anchorsIn(page.document.querySelector("#public-merges-sources"));
  assert.equal(links.length, EVENTS_URLS.length);
  for (const link of links) {
    // An anchor with an href, not a span a script listens to: the destination
    // is in the markup, so it survives with no JavaScript running on it.
    assert.equal(link.tagName, "A");
    assert.match(link.getAttribute("href"), /^https:\/\/api\.github\.com\/repos\//);
    // Nothing borrows tab order from the document: no tabindex at all, so the
    // focus order here is the reading order.
    assert.equal(link.getAttribute("tabindex"), null);
  }

  // And they are genuinely in the page's tab sequence, in the order the block
  // reads them out — not merely present in the DOM.
  const tabbed = tabSequence(page.document)
    .filter((node) => EVENTS_URLS.includes(node.getAttribute("href")));
  assert.deepEqual(tabbed.map((node) => node.getAttribute("href")), EVENTS_URLS,
    "a reader tabbing the page does not arrive at both feeds in order");

  // The links follow the readout, so a reader meets the absence and then what
  // to do about it, rather than the other way round. Text nodes sit in
  // `children` here and carry no id, hence the guard.
  const order = [...page.document.querySelector("#public-merges").children].map((node) => node?.id);
  assert.ok(order.indexOf("public-merges-sources") > order.indexOf("public-merges-readout"),
    "the way to count it yourself comes before the sentence explaining it");
});

test("a response still in flight shows the reason, never a placeholder digit", async (t) => {
  const page = await loadPage(HOME_URL, {});
  t.after(() => page.restore());
  let answer;
  const held = new Promise((resolve) => { answer = resolve; });
  const slow = async (url) => {
    await held;
    return okResponse(url.includes("paint-lab") ? LIVE_EVENTS : []);
  };

  const loading = loadPublicMerges(page.document, slow, undefined, { baseline: null });
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
  assert.deepEqual(document.querySelector("#public-merges-readout").querySelectorAll("p").map(textOf),
    [unavailableSentence(UNAVAILABLE_REASONS.pending), COUNTED_SUBJECT_SENTENCE],
    "the shipped sentences and the painted ones must be the same sentences");
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
  // Read off this block rather than off the hero: the hero's lead now says the
  // example is synthetic in three words and once (#1767), so the full sentence
  // is pinned where the counted figure needs the contrast drawn.
  assert.match(boundary, /belongs to a bundled synthetic example, computed from invented data for an invented company/);
  assert.match(html, /<strong>Example records<\/strong>/);
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
