// The way out of the observatory's one no-number state.
//
// The block already refused to invent a figure: a failed request, an error
// status, and a response with nothing countable in it all settle onto the same
// sentence with no digit in it, and tests/agent-observatory-merged-figure.test.js
// pins that. What a reader met there was a dead end — the only control that
// could ask GitHub again sat in the activity panel further down the page, under
// a label about the event list rather than about the count.
//
// So the block now carries its own retry, and what has to hold is that the
// control is honest about when it is worth pressing: it is on screen in exactly
// the states a second request could fix, it is gone while a request is still in
// flight and once a count has arrived, it issues a real new request every time it
// is pressed, and pressing it twice after two failures leaves it usable a third
// time. The evidence beside it — both feed links, and the scope sentence on a
// success — survives all of that.
//
// Harness notes: assertions are on counts, attributes, and rendered text; the
// control's `type` is read as a property because the harness does not reflect it
// to an attribute.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { RETAINED_LEAD } from "../src/merged-count-retention.js";
import { feedLinkText } from "../src/public-merges.js";
import {
  EVENTS_URLS,
  MERGED_FIGURE_RETRY_LABEL,
  SOURCE_REPOSITORIES,
  wireActivityControls,
} from "../src/agents.js";
import { installDocument } from "./support/dom.js";
import { loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";

installDocument();

const PAGE_URL = new URL("../src/agents.html", import.meta.url);
const RESPONSE_DATE = "Wed, 30 Jul 2025 14:32:00 GMT";
const LOADING_LINE = "Loading the merged pull request count";

// Enough turns for both feed requests, the JSON reads, and the render that
// follows them to have happened.
const settle = async () => { for (let turn = 0; turn < 8; turn += 1) await Promise.resolve(); };

function pullRequestEvent(number, merged) {
  return {
    id: String(number),
    type: "PullRequestEvent",
    created_at: "2025-07-30T14:00:00Z",
    payload: {
      action: "closed",
      pull_request: {
        number,
        merged,
        title: `Pull request ${number}`,
        html_url: `https://github.com/AndrewLikesTea/paint-lab/pull/${number}`,
        head: { ref: "agent/fullstack/count-retry" },
      },
    },
  };
}

// Four live events, three of them merges, so a rendered count is a number this
// fixture can account for rather than any digit at all.
const LIVE_EVENTS = [
  pullRequestEvent(201, true),
  pullRequestEvent(202, true),
  pullRequestEvent(203, false),
  pullRequestEvent(204, true),
];

const okResponse = (payload) => ({
  ok: true,
  status: 200,
  headers: { get: (name) => (name.toLowerCase() === "date" ? RESPONSE_DATE : null) },
  json: async () => payload,
});

/**
 * One GitHub the test drives by hand, and a request counter.
 *
 * The published record is answered 404 so nothing in this file can reach a
 * recorded count it did not put there itself, and only one feed carries the
 * fixture so a doubled payload cannot quietly double the count.
 */
function githubStub(mode = "unreachable") {
  const state = { mode, requests: 0 };
  const fetcher = async (url) => {
    const target = String(url);
    if (target.includes("merged-pull-request-count.json")) return { ok: false, status: 404 };
    state.requests += 1;
    if (state.mode === "unreachable") throw new Error("offline");
    if (state.mode === "status") return { ok: false, status: 503 };
    if (state.mode === "empty") return okResponse([]);
    return okResponse(target.includes("paint-lab") ? LIVE_EVENTS : []);
  };
  return { state, fetcher };
}

async function observatory(mode) {
  const page = await loadPage(PAGE_URL);
  const github = githubStub(mode);
  const load = wireActivityControls(page.document, github.fetcher);
  return { page, document: page.document, github, load };
}

const figureOf = (document) => ({
  figure: document.querySelector("#merged-figure"),
  readout: document.querySelector("#merged-figure-readout"),
  actions: document.querySelector("#merged-figure-actions"),
  control: document.querySelector("#retry-merged-figure"),
});

/** Press it the way a reader does, and wait for the request it starts. */
async function pressRetry(document) {
  document.querySelector("#retry-merged-figure").click();
  await settle();
}

test("the served page offers no retry, because nothing has failed yet", async () => {
  const document = parseHtml(await readFile(PAGE_URL, "utf8"));
  const { figure, readout, actions, control } = figureOf(document);

  assert.equal(figure.dataset.state, "loading");
  assert.match(textOf(readout), new RegExp(LOADING_LINE));
  assert.doesNotMatch(textOf(readout), /\d/, "the served page holds no number");

  // Present in the markup so it keeps one listener for the life of the page, but
  // hidden, so a request still in flight asks nothing of the reader.
  assert.equal(actions.hidden, true);
  assert.equal(textOf(control), MERGED_FIGURE_RETRY_LABEL);
  assert.equal(tabSequence(document).filter((node) => node.id === "retry-merged-figure").length, 0,
    "a control for a failure that has not happened is a tab stop for nothing");
});

test("every way the request can produce no count reaches the same offered retry", async (t) => {
  // The three settled failures the block has to survive: nothing answered, an
  // error status, and a response that parsed and carried nothing to count.
  for (const mode of ["unreachable", "status", "empty"]) {
    const { page, document, load } = await observatory(mode);
    try {
      await load();
      const { figure, readout, actions, control } = figureOf(document);

      assert.equal(figure.dataset.state, "unavailable", `${mode}: the slot did not settle`);
      assert.doesNotMatch(textOf(readout), new RegExp(LOADING_LINE),
        `${mode}: the loading line is still painted`);
      assert.match(textOf(readout), /Public GitHub activity unavailable/,
        `${mode}: the reader is not told the count could not be retrieved`);
      assert.doesNotMatch(textOf(readout), /\d/,
        `${mode}: a failure rendered a digit — an empty response is not a zero`);

      assert.equal(actions.hidden, false, `${mode}: no way to ask again`);
      assert.equal(textOf(control), MERGED_FIGURE_RETRY_LABEL, `${mode}: the control is mislabelled`);
      // The harness does not reflect `type`, so the property is the fact.
      assert.equal(control.type, "button", `${mode}: the control would submit something`);
      assert.equal(tabSequence(document).filter((node) => node.id === "retry-merged-figure").length, 1,
        `${mode}: the retry is not keyboard-reachable`);

      // Counting it by hand stays possible in exactly the state where it is the
      // only thing left: both feeds, the same words, the same responses.
      const links = document.querySelector(".merged-figure-sources").querySelectorAll("a");
      assert.deepEqual(links.map((link) => link.getAttribute("href")), EVENTS_URLS, `${mode}: a feed link moved`);
      assert.deepEqual(links.map(textOf), SOURCE_REPOSITORIES.map(feedLinkText), `${mode}: a feed link was reworded`);
    } finally {
      page.restore();
    }
  }
  t.diagnostic("three failure paths, one rendered state");
});

test("the retry issues a fresh request and can reach the count", async (t) => {
  const { page, document, github, load } = await observatory("unreachable");
  t.after(() => page.restore());

  await load();
  assert.equal(document.querySelector("#merged-figure").dataset.state, "unavailable");
  const failedRequests = github.state.requests;

  github.state.mode = "ok";
  await pressRetry(document);

  assert.ok(github.state.requests > failedRequests, "the retry asked GitHub nothing");
  const { figure, readout, actions } = figureOf(document);
  assert.equal(figure.dataset.state, "live");
  assert.equal(textOf(document.querySelector(".merged-figure-count")), "3");

  // The success path is unchanged: the count still arrives with the sentence
  // naming what it was counted out of and for which repositories.
  const source = textOf(document.querySelector(".merged-figure-source"));
  // Four events came back and three of them merged, so the scope line counts the
  // response and the figure counts the merges in it.
  assert.match(source, /Counted from 4 public GitHub events returned for/);
  for (const repository of SOURCE_REPOSITORIES) {
    assert.ok(source.includes(repository), `${repository} is not named beside the count`);
  }
  assert.match(source, /not an all-time total/);

  // And the way out is put away again: there is nothing to retry about a number
  // this response returned.
  assert.equal(actions.hidden, true, "a recovered count still offers a retry");
  assert.doesNotMatch(textOf(readout), new RegExp(LOADING_LINE));
});

test("two failures leave the control usable a third time", async (t) => {
  const { page, document, github, load } = await observatory("unreachable");
  t.after(() => page.restore());

  await load();
  const attempts = [github.state.requests];
  for (let press = 0; press < 2; press += 1) {
    await pressRetry(document);
    const { figure, readout, actions } = figureOf(document);
    assert.equal(figure.dataset.state, "unavailable", `press ${press + 1}: the slot left the settled state`);
    assert.doesNotMatch(textOf(readout), new RegExp(LOADING_LINE), `press ${press + 1}: parked on the loading line`);
    assert.doesNotMatch(textOf(readout), /\d/, `press ${press + 1}: a failed retry rendered a digit`);
    assert.equal(actions.hidden, false, `press ${press + 1}: the control was taken away`);
    assert.equal(tabSequence(document).filter((node) => node.id === "retry-merged-figure").length, 1,
      `press ${press + 1}: the control stopped being keyboard-reachable`);
    attempts.push(github.state.requests);
  }

  // Each press is its own request, not a repaint of the last answer.
  for (let step = 1; step < attempts.length; step += 1) {
    assert.ok(attempts[step] > attempts[step - 1], `press ${step} issued no request`);
  }

  // The third press still works, which is the whole claim.
  github.state.mode = "ok";
  await pressRetry(document);
  assert.equal(document.querySelector("#merged-figure").dataset.state, "live");
});

test("pressing the retry moves the reader to the readout that answers it", async (t) => {
  const { page, document, load } = await observatory("unreachable");
  t.after(() => page.restore());

  await load();
  const control = document.querySelector("#retry-merged-figure");
  control.focus();
  assert.equal(document.activeElement, control);

  await pressRetry(document);
  // The press hides the button the reader was standing on, so focus lands on the
  // block that now holds this attempt's answer rather than on nothing.
  assert.equal(document.activeElement.id, "merged-figure-readout");
});

test("the retry is announced through the block's one live region, from outside it", async (t) => {
  const { page, document, load } = await observatory("unreachable");
  t.after(() => page.restore());

  await load();
  const { figure, readout, control } = figureOf(document);

  // One live region, still the readout, still the observatory's convention — so
  // a settled state is announced once and the control does not announce itself.
  assert.equal(figure.querySelectorAll("[aria-live]").length, 1);
  assert.equal(readout.getAttribute("role"), "status");
  assert.equal(readout.getAttribute("aria-live"), "polite");
  assert.equal(readout.querySelectorAll("#retry-merged-figure").length, 0,
    "a control inside the live region is re-announced by every render");
  assert.equal(control.parentNode.id, "merged-figure-actions");
  assert.equal(control.parentNode.parentNode.id, "merged-figure");

  // Its description is the sentence saying why it is being offered, and that
  // sentence survives the repaint that offered it.
  assert.equal(control.getAttribute("aria-describedby"), "merged-figure-source");
  assert.equal(readout.querySelectorAll("#merged-figure-source").length, 1);

  // Nothing about this state is folded away behind a disclosure.
  assert.equal(figure.querySelectorAll("details").length, 0);
});

test("a retry that fails after a count shows the earlier one dated, never an undated digit", async (t) => {
  const { page, document, github, load } = await observatory("ok");
  t.after(() => page.restore());

  await load();
  assert.equal(document.querySelector("#merged-figure").dataset.state, "live");

  github.state.mode = "unreachable";
  await pressRetry(document);

  // The decision: the count this response did not return is not held over as if
  // it were live. This browser's retained count is shown instead, in the state
  // that says in words that GitHub did not answer and prints the date it was
  // taken — so the digit on screen is never one without a time attached to it.
  const { figure, readout, actions } = figureOf(document);
  assert.equal(figure.dataset.state, "recorded");
  assert.match(textOf(readout), new RegExp(RETAINED_LEAD.trim()));
  assert.equal(readout.querySelectorAll("time").length, 1, "a kept number with no date on it");
  assert.equal(textOf(document.querySelector(".merged-figure-count")), "3");

  // It is still a request that failed, so the way to ask again is still offered.
  assert.equal(actions.hidden, false);
  assert.equal(tabSequence(document).filter((node) => node.id === "retry-merged-figure").length, 1);
});
