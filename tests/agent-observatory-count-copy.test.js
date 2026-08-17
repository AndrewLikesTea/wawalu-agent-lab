// The observatory's one real number, on somebody else's clipboard.
//
// A prospect who reads "3 merged pull requests" and wants to put it in a note
// retypes the digit and leaves everything that made it checkable behind: the
// feeds it was counted from, the moment it was counted, and the page that will
// count it again. So the block offers the whole thing, and this file holds it to
// the one rule that makes the offer safe — THE CLIPBOARD MAY NOT SAY ANYTHING
// THE BLOCK IS NOT SAYING.
//
// That rule has four halves here. The digit in the payload is the digit in the
// readout, so a changed fixture changes both or neither (there is no literal
// count anywhere below that is not read back off the page). The freshness clause
// is the one painted under the figure, in the page's own time format, so a
// retained count cannot be pasted as today's. A browser that has never had a
// count is offered nothing to press. And nothing derived — no rate, no trend, no
// percentage — travels with any of it, because the page does not state one.
//
// The harness has no clipboard of its own, so the write is injected at the seam
// `bindMergedCountCopy` already exposes and the exact string is asserted.

import assert from "node:assert/strict";
import test from "node:test";

import { RETAINED_COUNT_KEY, RETAINED_LEAD } from "../src/merged-count-retention.js";
import { EVENTS_URLS, feedLinkText } from "../src/public-merges.js";
import {
  MERGED_COUNT_COPY_FEEDBACK,
  MERGED_COUNT_COPY_LABEL,
  MERGED_COUNT_SUBJECT,
  SOURCE_REPOSITORIES,
  bindMergedCountCopy,
  loadActivity,
} from "../src/agents.js";
import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";

const PAGE_URL = new URL("../src/agents.html", import.meta.url);
const RESPONSE_DATE = "Wed, 30 Jul 2025 14:32:00 GMT";
const PAGE_ADDRESS = "https://labs.wawalu.org/agents.html";
// A count this browser took before, dated in the past so it can never be read as
// the response the live request would have returned.
const RETAINED_AT = "2025-07-14T09:05:00.000Z";

function mergeEvent(number, merged = true) {
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
        head: { ref: "agent/fullstack/count" },
      },
    },
  };
}

const okResponse = (payload) => ({
  ok: true,
  status: 200,
  headers: { get: (name) => (name.toLowerCase() === "date" ? RESPONSE_DATE : null) },
  json: async () => payload,
});

// Only the first feed carries the fixture, and the published record is
// unreadable here, so every count below comes from exactly one response.
const githubFetcher = (events) => async (url) => {
  if (!EVENTS_URLS.includes(url)) throw new Error(`no record: ${url}`);
  return okResponse(url.includes("paint-lab") ? events : []);
};
const offlineFetcher = async () => { throw new Error("offline"); };

/**
 * The shipped page, its clipboard, and whatever the copy control wrote to it.
 *
 * `writeText` is handed to the module rather than stubbed onto a global: it is
 * the seam the page entry already passes nothing to, so a test that reaches it
 * is exercising the same call a browser makes.
 */
async function observatory(t, { storage = {}, refuse = false } = {}) {
  const page = await loadPage(PAGE_URL, { storage });
  t.after(() => page.restore());
  const copied = [];
  bindMergedCountCopy(page.document, {
    writeText: async (value) => {
      if (refuse) throw new Error("denied");
      copied.push(value);
      return undefined;
    },
  });
  return { document: page.document, copied };
}

const retainedStorage = (count, takenAt = RETAINED_AT) => ({
  [RETAINED_COUNT_KEY]: JSON.stringify({ schemaVersion: 1, count, takenAt }),
});

const control = (document) => document.querySelector("#merged-figure-copy-button");
const block = (document) => document.querySelector("#merged-figure-copy");
const status = (document) => document.querySelector("#merged-figure-copy-status");

/** Press it the way a keyboard would, and let the write settle. */
async function press(document) {
  control(document).focus();
  pressEnter(document);
  await new Promise((resolve) => setImmediate(resolve));
}

/* --------------------------- a count taken just now ------------------------ */

test("a live count is copied with what was counted, when, and where to check it", async (t) => {
  const { document, copied } = await observatory(t);
  await loadActivity(document, githubFetcher([mergeEvent(101), mergeEvent(102), mergeEvent(103)]));

  assert.equal(document.querySelector("#merged-figure").dataset.state, "live");
  assert.equal(block(document).hidden, false, "a figure on screen is a figure worth copying");
  // Reachable by keyboard from the block it belongs to, and read after the two
  // links that let a reader check the figure by hand rather than before them.
  const sequence = tabSequence(document);
  const feeds = document.querySelector(".merged-figure-sources").querySelectorAll("a");
  assert.ok(sequence.includes(control(document)), MERGED_COUNT_COPY_LABEL);
  assert.ok(sequence.indexOf(feeds[1]) < sequence.indexOf(control(document)));
  assert.ok(sequence.indexOf(control(document)) < sequence.indexOf(document.querySelector("#refresh-activity")));
  await press(document);

  // Read off the screen, not typed here: the digit in the readout and the clock
  // in the provenance line are what the payload has to be built from.
  const shown = textOf(document.querySelector(".merged-figure-count"));
  const clock = textOf(document.querySelector(".merged-figure-time"));
  assert.equal(shown, "3");
  assert.deepEqual(copied, [[
    `${shown} merged pull requests.`,
    `Counted from 3 public GitHub events in ${SOURCE_REPOSITORIES.join(" and ")}, as of ${clock}.`,
    MERGED_COUNT_SUBJECT,
    PAGE_ADDRESS,
  ].join("\n")]);

  // The four things a pasted count has to carry, named one at a time so a
  // failure says which one went missing.
  const [payload] = copied;
  assert.ok(payload.includes(`${shown} merged pull requests`), "the figure as rendered");
  assert.ok(payload.includes("built and changed the pages of this site"), "what these merges are");
  for (const repository of SOURCE_REPOSITORIES) {
    assert.ok(payload.includes(repository), `${repository} is not named in the copy`);
  }
  assert.ok(payload.includes(PAGE_ADDRESS), "the absolute address of the page it came from");
  assert.equal(textOf(status(document)), MERGED_COUNT_COPY_FEEDBACK.copied);
});

test("the copied figure follows the response rather than a literal", async (t) => {
  const { document, copied } = await observatory(t);
  // One merge, not three, and the unit follows the quantity in both places.
  await loadActivity(document, githubFetcher([mergeEvent(201), mergeEvent(202, false)]));
  await press(document);

  assert.equal(textOf(document.querySelector(".merged-figure-count")), "1");
  assert.equal(copied.length, 1);
  assert.ok(copied[0].startsWith("1 merged pull request.\n"),
    `the copy did not follow the count down to one: ${copied[0]}`);
  assert.doesNotMatch(copied[0], /\b3 merged\b/, "a count from another fixture survived in the payload");
});

/* ------------------- the last count this browser took ---------------------- */

test("a restored last-known count is copied as the earlier count it is", async (t) => {
  const { document, copied } = await observatory(t, { storage: retainedStorage(12) });
  await loadActivity(document, offlineFetcher);

  assert.equal(document.querySelector("#merged-figure").dataset.state, "recorded");
  assert.equal(block(document).hidden, false, "a dated earlier count is still copyable");
  await press(document);

  // The page's own sentence for a count that is not this response's, and the
  // page's own date and clock format — not a second way of saying either.
  assert.deepEqual(copied, [[
    "12 merged pull requests.",
    `${RETAINED_LEAD}2025-07-14 at 09:05 UTC.`,
    MERGED_COUNT_SUBJECT,
    PAGE_ADDRESS,
  ].join("\n")]);
  assert.ok(copied[0].includes("this is the last count taken"),
    "a pasted earlier count that does not say it is earlier is a live count to whoever reads it");
  // The date on the clipboard is the date on the screen, character for character.
  assert.ok(copied[0].includes(textOf(document.querySelector(".merged-figure-recorded-date"))));
});

test("a live response replaces the earlier count on the clipboard and retires the confirmation", async (t) => {
  const { document, copied } = await observatory(t, { storage: retainedStorage(12) });
  await loadActivity(document, offlineFetcher);
  await press(document);
  assert.equal(textOf(status(document)), MERGED_COUNT_COPY_FEEDBACK.copied);

  // A second load that GitHub does answer. "Copied." over a figure that has been
  // replaced would describe a clipboard nobody holds any more.
  await loadActivity(document, githubFetcher([mergeEvent(301), mergeEvent(302)]));
  assert.equal(textOf(status(document)), "", "the confirmation outlived the figure it described");
  await press(document);

  assert.equal(copied.length, 2);
  assert.ok(copied[1].startsWith("2 merged pull requests.\n"));
  assert.ok(!copied[1].includes(RETAINED_LEAD), "the live copy still calls itself an earlier count");
});

/* ---------------------- nothing counted, nothing copied -------------------- */

test("a browser that has never had a count is offered nothing to copy", async (t) => {
  const { document, copied } = await observatory(t, { storage: {} });
  await loadActivity(document, offlineFetcher);

  assert.equal(document.querySelector("#merged-figure").dataset.state, "unavailable");
  assert.equal(block(document).hidden, true, "a control that could only copy an empty payload is offered");
  assert.equal(tabSequence(document).some((node) => node.id === "merged-figure-copy-button"), false,
    "the withdrawn control is still a tab stop");

  // Genuinely non-actionable, not merely out of sight: pressing it writes
  // nothing at all, so there is no state in which a placeholder reaches anyone.
  control(document).click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(copied, []);
  assert.equal(textOf(status(document)), "");
  // And the block asserts no figure anywhere a reader or a paste could find one.
  assert.doesNotMatch(textOf(document.querySelector("#merged-figure-readout")), /\d/);
});

test("the served page offers nothing before anything has answered", async (t) => {
  const { document } = await observatory(t);

  assert.equal(block(document).hidden, true, "the loading state offers a count to copy");
  assert.equal(textOf(control(document)), MERGED_COUNT_COPY_LABEL);
  assert.equal(control(document).tagName, "BUTTON");
  assert.equal(control(document).type, "button");
});

/* ------------------------- plain text, and no more ------------------------- */

test("the payload is plain text and claims nothing the page does not", async (t) => {
  const { document, copied } = await observatory(t);
  await loadActivity(document, githubFetcher([mergeEvent(401), mergeEvent(402)]));
  await press(document);
  const [payload] = copied;

  // No markup, no Markdown, no characters that imply either.
  assert.doesNotMatch(payload, /[<>]/, "the payload carries markup");
  assert.doesNotMatch(payload, /^\s*[-*••]/m, "the payload carries bullet markers");
  assert.doesNotMatch(payload, /\*\*|__|^#{1,6}\s|\[[^\]]*\]\(/m, "the payload carries Markdown");
  assert.doesNotMatch(payload, /&[a-z]+;|&#\d+;/i, "the payload carries HTML entities");

  // Nothing derived. The page states a count and when it was taken; a rate, a
  // trend or a share would be a claim invented for the clipboard alone.
  assert.doesNotMatch(payload, /%|per day|per week|per month|average|trend|up |down |growth|since/i);
  // And no hedging the figure does not need: this is the one number on the site
  // that is not an example, and it travels as one.
  assert.doesNotMatch(payload, /synthetic|illustrative|invented|representative|example/i);
});

test("a clipboard that refuses says so and claims nothing", async (t) => {
  const { document, copied } = await observatory(t, { refuse: true });
  await loadActivity(document, githubFetcher([mergeEvent(501)]));
  await press(document);

  assert.deepEqual(copied, []);
  assert.equal(textOf(status(document)), MERGED_COUNT_COPY_FEEDBACK.failed);
  assert.equal(status(document).getAttribute("role"), "status");
  assert.equal(status(document).getAttribute("aria-live"), "polite");
});

/* ----------------- what the control was not allowed to change -------------- */

test("the count wording, the provenance sentence and both verification links are untouched", async (t) => {
  const { document } = await observatory(t);
  const note = document.querySelector("#merged-figure-note");
  const feeds = document.querySelector(".merged-figure-sources").querySelectorAll("a");
  const before = {
    note: textOf(note),
    hrefs: feeds.map((link) => link.getAttribute("href")),
    labels: feeds.map(textOf),
  };

  // The sentence the copy repeats is the sentence the page already prints, so
  // there is one wording of it and not two to keep in step.
  assert.ok(before.note.startsWith(MERGED_COUNT_SUBJECT),
    `the note and the copied subject have drifted apart: ${before.note}`);
  assert.deepEqual(before.hrefs, EVENTS_URLS);
  assert.deepEqual(before.labels, SOURCE_REPOSITORIES.map(feedLinkText));

  await loadActivity(document, githubFetcher([mergeEvent(601)]));
  await press(document);

  // Every state the block can reach leaves all three exactly where they were,
  // including the one where a reader most needs to go and count by hand.
  assert.equal(textOf(note), before.note);
  assert.equal(textOf(document.querySelector(".merged-figure-unit")), "merged pull request");
  const after = document.querySelector(".merged-figure-sources").querySelectorAll("a");
  assert.deepEqual(after.map((link) => link.getAttribute("href")), before.hrefs);
  assert.deepEqual(after.map(textOf), before.labels);
  assert.ok(tabSequence(document).includes(after[0]), "a feed link stopped being keyboard-reachable");
});
