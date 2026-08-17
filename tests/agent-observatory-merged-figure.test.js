// The observatory's one real number.
//
// Every other figure this site shows is invented and labelled as such. This one
// is counted from the public GitHub events response the page already fetches,
// so what has to be pinned is not that it renders — it is that it can only ever
// be honest: the label agrees with what was counted, the provenance is the
// response's own arrival time, the verification links are the exact responses
// the count came from, and an unanswered request leaves no undated digit behind.
//
// The fetchers below answer only the GitHub feeds, so the published record is
// unreadable in this file and every fallback lands on the never-recorded
// sentence. The recorded count, its date, and the recorder that writes it have
// their own file: tests/agent-observatory-recorded-count.test.js.
//
// The browser harness is permissive about control values, so everything here is
// asserted on rendered text and DOM structure.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { UNAVAILABLE_REASONS, feedLinkText, unavailableSentences } from "../src/public-merges.js";
import {
  EVENTS_URLS,
  MERGED_FIGURE_COPY,
  REPRESENTATIVE_ACTIVITY,
  SOURCE_REPOSITORIES,
  SYNTHETIC_FALLBACK_DATA,
  countMergedPullRequests,
  liveGithubEvents,
  loadActivity,
  renderMergedFigure,
  responseTimestamp,
} from "../src/agents.js";
import { createElement, first, installDocument, tags } from "./support/dom.js";
import { loadPage, tabSequence, textOf } from "./support/browser.js";

installDocument();

const PAGE_URL = new URL("../src/agents.html", import.meta.url);
const DEMO_DATA_URL = new URL("../src/agent-demo-data.json", import.meta.url);
const RESPONSE_DATE = "Wed, 30 Jul 2025 14:32:00 GMT";

function pullRequestEvent({ number, merged, action = "closed" }) {
  return {
    id: String(number),
    type: "PullRequestEvent",
    created_at: "2025-07-30T14:00:00Z",
    payload: {
      action,
      pull_request: {
        number,
        merged,
        title: `Pull request ${number}`,
        html_url: `https://github.com/AndrewLikesTea/paint-lab/pull/${number}`,
        head: { ref: "agent/frontend/observatory" },
      },
    },
  };
}

// Six live events, three of them merges: a close that merged is a merge, a close
// that did not is not, and an open with a `merged` flag still on the payload is
// not either.
const LIVE_EVENTS = [
  pullRequestEvent({ number: 101, merged: true }),
  pullRequestEvent({ number: 102, merged: true }),
  pullRequestEvent({ number: 103, merged: false }),
  pullRequestEvent({ number: 104, merged: false, action: "opened" }),
  pullRequestEvent({ number: 105, merged: true }),
  { id: "9", type: "PushEvent", created_at: "2025-07-30T13:00:00Z", payload: { ref: "refs/heads/main", commits: [{ message: "Ship it" }] } },
];

const okResponse = (payload) => ({
  ok: true,
  status: 200,
  headers: { get: (name) => (name.toLowerCase() === "date" ? RESPONSE_DATE : null) },
  json: async () => payload,
});

// The page requests one feed per repository. Only one of them carries the
// fixture, so a doubled payload cannot quietly double the count.
const githubFetcher = (payload) => async (url) => okResponse(url.includes("paint-lab") ? payload : []);

// The committed baseline count is taken away wherever this file asserts that a
// failed request leaves NO digit: the shipped page carries one, so the state
// with nothing at all is reachable here only by removing it. That the baseline
// is what a real first visit gets instead is tests/merged-count-baseline.test.js.
const NO_BASELINE = { baseline: null };

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

test("a public GitHub response produces the headline count, its unit, and its source line", async () => {
  const root = observatoryRoot();
  await loadActivity(root, githubFetcher(LIVE_EVENTS));
  const readout = root.nodes["#merged-figure-readout"];

  assert.equal(root.nodes["#merged-figure"].dataset.state, "live");
  assert.equal(first(readout, "merged-figure-count").textContent, "3");
  // The label names exactly what was counted: closes that merged, not closes.
  assert.equal(first(readout, "merged-figure-unit").textContent, "merged pull requests");

  const source = first(readout, "merged-figure-source").textContent;
  assert.match(source, /public GitHub/, "the source line names public GitHub activity");
  assert.match(source, /Counted from 6 public GitHub events/, "the scope counted over is stated, not implied");
  for (const repository of SOURCE_REPOSITORIES) assert.ok(source.includes(repository), `${repository} is named`);
  assert.match(source, /as of/);

  const [time] = tags(readout, "TIME");
  assert.equal(time.dateTime, new Date(RESPONSE_DATE).toISOString(), "the as-of time is this response's own");
  assert.ok(source.includes(time.textContent), "the readable time is part of the source sentence");
  // The status card beside it reports the same response, in the same format.
  assert.equal(root.nodes["#last-updated"].textContent, `Updated ${time.textContent}`);
});

test("the unit agrees with the quantity when a single pull request merged", async () => {
  const root = observatoryRoot();
  await loadActivity(root, githubFetcher([pullRequestEvent({ number: 7, merged: true })]));
  const readout = root.nodes["#merged-figure-readout"];

  assert.equal(first(readout, "merged-figure-count").textContent, "1");
  assert.equal(first(readout, "merged-figure-unit").textContent, "merged pull request");
});

test("the as-of time is the response's own, never a clock read at render time", () => {
  const receivedAt = new Date("2025-07-30T15:00:00Z");
  const stamped = responseTimestamp([{ headers: { get: () => RESPONSE_DATE } }], receivedAt);
  assert.equal(stamped.toISOString(), new Date(RESPONSE_DATE).toISOString());

  // No usable header: the arrival time taken on the fetch path, not a new one.
  assert.equal(responseTimestamp([{}], receivedAt), receivedAt);
  assert.equal(responseTimestamp([{ headers: { get: () => "nonsense" } }], receivedAt), receivedAt);
  assert.equal(responseTimestamp([], receivedAt), receivedAt);
});

test("the count reads live public events only — never bundled, demo, or persona records", async () => {
  const demo = JSON.parse(await readFile(DEMO_DATA_URL, "utf8"));
  const synthetic = [
    ...REPRESENTATIVE_ACTIVITY,
    ...SYNTHETIC_FALLBACK_DATA.personas,
    SYNTHETIC_FALLBACK_DATA.run,
    ...demo.personas,
    demo.run,
    // A bundled record dressed as a merge. Structure alone must not admit it.
    { ...pullRequestEvent({ number: 1, merged: true }), persona: "Sam · Manager" },
  ];

  assert.deepEqual(liveGithubEvents(synthetic), [], "no synthetic record is countable");
  assert.equal(countMergedPullRequests(synthetic), 0);

  const live = pullRequestEvent({ number: 42, merged: true });
  assert.deepEqual(liveGithubEvents([...synthetic, live]), [live]);
  assert.equal(countMergedPullRequests([...synthetic, live]), 1);

  // Merges only, and nothing at all out of nothing.
  assert.equal(countMergedPullRequests([pullRequestEvent({ number: 7, merged: false })]), 0);
  assert.equal(countMergedPullRequests([pullRequestEvent({ number: 7, merged: true, action: "opened" })]), 0);
  assert.equal(countMergedPullRequests([]), 0);
  assert.equal(countMergedPullRequests("not a list"), 0);
});

test("a merge public GitHub reports as \"merged\" is a merge, and a close is still not one", () => {
  // The feeds these repositories publish now send `action: "merged"` with the
  // slim pull-request payload, which carries no `merged` flag at all — so a rule
  // that read only that flag counted none of today's merges and the live figure
  // was structurally zero. Both shapes are the API's own word for a merge and
  // both count; a close that merged nothing still counts for nothing.
  const merged = { ...pullRequestEvent({ number: 201, merged: undefined }), payload: { action: "merged", number: 201, pull_request: { number: 201 } } };
  const closed = { ...pullRequestEvent({ number: 202, merged: false }) };
  assert.equal(countMergedPullRequests([merged]), 1);
  assert.equal(countMergedPullRequests([closed]), 0);
  assert.equal(countMergedPullRequests([merged, closed, pullRequestEvent({ number: 203, merged: true })]), 2);
});

test("the synthetic rows the page falls back to never reach the headline slot", async () => {
  const root = observatoryRoot();
  await loadActivity(root, async () => ({ ok: false, status: 503 }), null, NO_BASELINE);

  // The four representative rows are on screen — and the figure is still empty.
  assert.equal(root.nodes["#activity-list"].textContent.includes("Scope the observatory fallback"), true);
  assert.equal(first(root.nodes["#merged-figure-readout"], "merged-figure-count"), null);
});

test("no number survives a GitHub failure, whatever the failure is", async () => {
  // Each failure gets the clause it actually earned, from the shared module the
  // home page reads its own empty state out of — so a reader is told what went
  // wrong rather than one sentence covering five different things, and the two
  // surfaces cannot describe one outcome differently. A payload that is not a
  // list of events carries nothing to count, which is the empty answer.
  const failures = {
    "a network failure": [async () => { throw new Error("offline"); }, UNAVAILABLE_REASONS.unreachable],
    "a non-OK status": [async () => ({ ok: false, status: 503 }), UNAVAILABLE_REASONS.errorStatus],
    "rate limiting": [async () => ({ ok: false, status: 403 }), UNAVAILABLE_REASONS.rateLimited],
    "a malformed payload": [async () => okResponse({ message: "Not Found" }), UNAVAILABLE_REASONS.empty],
    "an empty payload": [async () => okResponse([]), UNAVAILABLE_REASONS.empty],
  };

  for (const [name, [fetcher, reason]] of Object.entries(failures)) {
    const root = observatoryRoot();
    await loadActivity(root, fetcher, null, NO_BASELINE);
    const readout = root.nodes["#merged-figure-readout"];

    assert.equal(root.nodes["#merged-figure"].dataset.state, "unavailable", name);
    assert.equal(first(readout, "merged-figure-count"), null, `${name}: no figure element`);
    assert.doesNotMatch(readout.textContent, /\d/, `${name}: no digit may stand in the headline slot`);
    assert.deepEqual(tags(readout, "P").map((node) => node.textContent), unavailableSentences(reason),
      `${name}: it says what happened, and then what was being counted`);
    assert.doesNotMatch(readout.textContent, /Loading/, `${name}: a failure is not still loading`);
  }
});

test("the figure names its source the way the rest of the observatory names it", () => {
  // tests/agent-observatory-copy.test.js holds this rule for the page's own
  // copy: "public" only ever introduces GitHub, so a reader meets one name for
  // one source. The figure's sentences are rendered onto that page, so they
  // keep the same rule.
  for (const copy of Object.values(MERGED_FIGURE_COPY)) {
    for (const sentence of [copy.value, copy.source]) {
      assert.doesNotMatch(sentence, /\bpublic\b(?! GitHub)/i, sentence);
      assert.doesNotMatch(sentence, /\d/, `${sentence}: no state without a live response carries a number`);
    }
  }
});

test("loading says it is loading, without a number and without claiming failure", () => {
  const root = observatoryRoot();
  renderMergedFigure(root, "loading");
  const readout = root.nodes["#merged-figure-readout"];

  assert.equal(root.nodes["#merged-figure"].dataset.state, "loading");
  assert.match(readout.textContent, /Loading/);
  assert.doesNotMatch(readout.textContent, /\d/, "loading may say so, but must not show a number");
  assert.doesNotMatch(readout.textContent, /did not answer/i);
});

test("a count that cannot be sourced is not rendered as a number", () => {
  for (const options of [{ count: 4 }, { count: 4, asOf: new Date("nonsense") }, { count: 4, asOf: "14:32" }]) {
    const root = observatoryRoot();
    renderMergedFigure(root, "live", options);

    assert.equal(root.nodes["#merged-figure"].dataset.state, "unavailable");
    assert.equal(first(root.nodes["#merged-figure-readout"], "merged-figure-count"), null);
  }
  // An unrecognised state falls the same way: to the empty slot, never a number.
  const root = observatoryRoot();
  renderMergedFigure(root, "nonsense", { count: 4, asOf: new Date(RESPONSE_DATE) });
  assert.equal(root.nodes["#merged-figure"].dataset.state, "unavailable");
});

test("a failed refresh clears the previous count instead of keeping a stale one", async () => {
  const root = observatoryRoot();
  await loadActivity(root, githubFetcher(LIVE_EVENTS));
  assert.equal(first(root.nodes["#merged-figure-readout"], "merged-figure-count").textContent, "3");

  await loadActivity(root, async () => ({ ok: false, status: 500 }), null, NO_BASELINE);
  assert.doesNotMatch(root.nodes["#merged-figure-readout"].textContent, /\d/,
    "a previous response's count must not outlive the response");
});

// What the counted merges are, and where to read what they shipped. The claim is
// about what the two repositories hold, never about the digit beside it, so it is
// authored in agents.html rather than rendered — the readout is the only thing a
// response replaces, and a reader who never gets a number needs this sentence most.
const NOTE_PHRASE = /built and changed the pages of this site/;
const RELEASES_LABEL = "Read the releases these pull requests shipped";

test("the block says the merges are the work that built this site, and links the releases they shipped", async (t) => {
  const page = await loadPage(PAGE_URL);
  t.after(() => page.restore());
  const { document } = page;
  const note = document.querySelector("#merged-figure-note");

  // Beside the live region, never inside it: that is what makes it survivable.
  assert.equal(note.parentNode.id, "merged-figure");
  assert.equal(document.querySelector("#merged-figure-readout").querySelectorAll("#merged-figure-note").length, 0);

  // It names both repositories the way the page already names them, and holds no
  // digit, so nothing in it depends on a count having arrived.
  for (const repository of SOURCE_REPOSITORIES) {
    assert.ok(textOf(note).includes(repository), `${repository} is not named`);
  }
  assert.doesNotMatch(textOf(note), /\d/, "the sentence must read the same with no count behind it");

  // One link out, to Releases, saying what is at the other end of it.
  const releases = note.querySelectorAll("a");
  assert.equal(releases.length, 1, "one pointer, not a second source list");
  assert.equal(releases[0].getAttribute("href"), "/releases.html");
  assert.equal(textOf(releases[0]), RELEASES_LABEL);
  assert.ok(tabSequence(document).includes(releases[0]), "the releases link is keyboard-reachable");

  // Both settled paths carry it: a counted response, and a request GitHub never
  // answered. The served loading state above is the third.
  assert.match(textOf(note), NOTE_PHRASE);
  await loadActivity(document, githubFetcher(LIVE_EVENTS));
  assert.equal(document.querySelector("#merged-figure").dataset.state, "live");
  assert.match(textOf(document.querySelector("#merged-figure-note")), NOTE_PHRASE);

  // A browser that has never held a count, and a request that never answered:
  // the state with nothing to show is the one this sentence is written for.
  const offline = await loadPage(PAGE_URL, { storage: {} });
  t.after(() => offline.restore());
  await loadActivity(offline.document, async () => { throw new Error("offline"); }, null, NO_BASELINE);
  const settled = offline.document.querySelector("#merged-figure-note");
  assert.equal(offline.document.querySelector("#merged-figure").dataset.state, "unavailable");
  assert.match(textOf(settled), NOTE_PHRASE);
  assert.equal(textOf(settled.querySelectorAll("a")[0]), RELEASES_LABEL);

  // And it took nothing from the feed links: still their own list, still the
  // words the shared module spells them with.
  const feeds = offline.document.querySelector(".merged-figure-sources").querySelectorAll("a");
  assert.deepEqual(feeds.map((link) => link.getAttribute("href")), EVENTS_URLS);
  assert.deepEqual(feeds.map(textOf), SOURCE_REPOSITORIES.map(feedLinkText));
});

test("the figure leads the shipped observatory and is reachable by keyboard", async (t) => {
  const page = await loadPage(PAGE_URL);
  t.after(() => page.restore());
  const { document } = page;
  const figure = document.querySelector("#merged-figure");

  // Leading content: inside the hero landmark, second heading after the h1, and
  // nowhere near the activity list it sits above.
  assert.ok(document.querySelector(".observatory-hero").querySelector("#merged-figure"));
  assert.equal(document.querySelector("#activity-list").querySelectorAll("#merged-figure").length, 0);
  const headings = document.querySelectorAll("h1,h2").map((node) => node.id);
  assert.deepEqual(headings.slice(0, 2), ["page-title", "merged-figure-title"]);
  assert.equal(figure.getAttribute("aria-labelledby"), "merged-figure-title");

  // One live region, following the observatory's own convention, so a load makes
  // one announcement rather than two.
  const readout = document.querySelector("#merged-figure-readout");
  assert.equal(readout.getAttribute("role"), "status");
  assert.equal(readout.getAttribute("aria-live"), "polite");
  assert.equal(figure.querySelectorAll("[aria-live]").length, 1);
  assert.doesNotMatch(textOf(readout), /\d/, "the served page holds no number before GitHub answers");

  // Verification: real anchors, to the exact responses the count is computed
  // from, before the activity panel's control in the tab order.
  const links = figure.querySelector(".merged-figure-sources").querySelectorAll("a");
  const sequence = tabSequence(document);
  const refresh = document.querySelector("#refresh-activity");
  assert.deepEqual(links.map((link) => link.href), EVENTS_URLS);
  for (const link of links) {
    assert.ok(sequence.includes(link), `${textOf(link)} is keyboard-reachable`);
    assert.ok(sequence.indexOf(link) < sequence.indexOf(refresh), `${textOf(link)} is read with the leading content`);
    assert.match(textOf(link), /AndrewLikesTea\/[\w-]+ public GitHub event feed$/, "the link text says where it goes");
  }

  // This is the one figure on the site that is not an example, so it carries
  // none of the synthetic-example hedging the rest of the page needs.
  assert.doesNotMatch(textOf(figure), /synthetic|illustrative|invented|representative|example/i);
});

test("a live response paints the figure on the shipped page without disturbing its links", async (t) => {
  const page = await loadPage(PAGE_URL);
  t.after(() => page.restore());
  const { document } = page;
  const links = document.querySelector(".merged-figure-sources").querySelectorAll("a");

  await loadActivity(document, githubFetcher(LIVE_EVENTS));

  assert.equal(document.querySelector("#merged-figure").dataset.state, "live");
  assert.equal(textOf(document.querySelector(".merged-figure-count")), "3");
  assert.match(textOf(document.querySelector(".merged-figure-source")), /public GitHub/);
  const sequence = tabSequence(document);
  for (const link of links) assert.ok(sequence.includes(link), "the verification links survive the render");
});
