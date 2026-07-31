// One answer change, one announcement — heard, not seen.
//
// WHAT THESE ASSERTIONS ARE FOR. /evolution.html carries twenty-four polite
// live regions. Nine of them were repainted on the tick a reader's own export
// landed, so importing a file produced nine utterances: the answer, the page
// status strip, the journey rail, the partial-evidence note, the import panel's
// status, the result notice, the headline rail and the delivery comparison, in
// paint order. A sighted reader saw one page settle. Everyone else was read a
// queue, and the sentence that answered their question was somewhere inside it.
//
// So the four things held here:
//
//   1. EXACTLY ONE REGION SPEAKS. Not "the answer speaks first" — one. The
//      count below is over regions whose text changed AND whose `aria-live` is
//      still announcing, so silencing a region by emptying it, hiding it, or
//      never painting it does not pass this test; only taking its voice does.
//   2. THE SENTENCE IS THE ANSWER. Question, then the headline metric with its
//      unit, then the one prioritized next action — in that order, in one
//      string, from the same slots the visible region is painted from.
//   3. FOCUS LANDS SOMEWHERE THE READER CAN ACT FROM. On the answer when the
//      answer changed; on the file picker when a file was rejected or the
//      import was cleared. Never on `<body>`, never on a node being removed.
//   4. THE PROVENANCE MARKER IS TRUE. It shipped saying every figure on the
//      page was invented and it never changed, so a lead read their own
//      recoverable spend under it. Word, shape, and tint now move together.
//
// Determinism: no clock, no sleeps, no network beyond the two bundled fixtures
// the page itself fetches.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { DomEvent, loadPage, parseHtml, pressEnter, pressSpace, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  STAND_DISCLOSURE_ORDER, STAND_DISCLOSURE_SUMMARY, STAND_IDS, STAND_QUESTION,
  STAND_SAMPLE_MARKER,
} from "../src/finops-stand.js";
import { standDisclosureIds } from "../src/finops-stand-view.js";
import {
  ANSWER_ANNOUNCER_ID, ECHOED_LIVE_REGION_IDS, announceAnswer, answerAnnouncement,
  importFailureAnnouncement, silenceEchoedRegions,
} from "../src/finops-answer-announcement.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const DEMO_DATA = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const FIXTURES = new URL("../contracts/integrations/tabular-dialects/v1/fixtures/", import.meta.url);
// The shipped example export with two project labels respelled to match the
// roster, so the join actually attributes and the answer has a figure in it.
const PROVIDER_EXPORT = (await readFile(new URL("openai-usage-export.csv", FIXTURES), "utf8"))
  .replace(/atlas-platform/g, "Atlas Platform").replace(/boreal-support/g, "Boreal Support");
const ORG_ROSTER = await readFile(new URL("generic-hris-roster.csv", FIXTURES), "utf8");

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));

/** Load the tab and boot its real entry, exactly as the page tag does. */
async function openFinopsTab() {
  const page = await loadPage(PAGE, {
    storage: {},
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  // Everything else the page starts on its own, so nothing is still in flight
  // when a test restores the globals out from under it.
  await waitFor(() => textOf(byId(document, "integration-contract-provenance"))
    .startsWith("Gateway completed"), "the static contract gateway to settle");
  await waitFor(() => byId(document, "finops-evaluation-result").getAttribute("aria-busy") === "false",
    "the evaluation panel to settle");
  return page;
}

/**
 * Every region that would actually SPEAK, and what it holds right now.
 *
 * A region is announcing when it carries a live-region role or an `aria-live`
 * and that `aria-live` is not `off`. Reading the attribute rather than a list
 * of ids is the point: a tenth echo added later is caught by this test.
 */
function announcingRegions(document) {
  const live = document.querySelectorAll("[aria-live]");
  return new Map(live.filter((node) => node.getAttribute("aria-live") !== "off")
    .map((node) => [node.id || node.className, textOf(node)]));
}

/**
 * The ids of the announcing regions whose text changed between two reads.
 *
 * A region that went EMPTY is not counted: an emptied live region has nothing
 * to announce, and the mapping step's own status is blanked when that step
 * closes behind a confirmed import. Anything that gained words is counted.
 */
function spoke(before, after) {
  return [...after].filter(([id, text]) => before.get(id) !== text && text !== "").map(([id]) => id);
}

function chooseFiles(document, files) {
  const input = byId(document, "local-finops-files");
  input.files = files.map(({ name, text }) => ({
    name, type: "text/csv", text: async () => text,
  }));
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

/** Walk the two-file mapping review to a rendered result. */
async function importExampleExport(document) {
  chooseFiles(document, [
    { name: "openai-usage-export.csv", text: PROVIDER_EXPORT },
    { name: "generic-hris-roster.csv", text: ORG_ROSTER },
  ]);
  await waitFor(() => !byId(document, "import-mapping").hidden, "the mapping step to open");
  byId(document, "import-mapping-confirm").click();
  await waitFor(() => shownText(document, "import-mapping-file") === "generic-hris-roster.csv",
    "the roster's mapping step to open");
}

// ---------------------------------------------------------------------------
// 1. The successful import.
// ---------------------------------------------------------------------------

test("importing an export announces the answer once, and stands the reader on it", async (t) => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importExampleExport(document);
    const before = announcingRegions(document);
    byId(document, "import-mapping-confirm").click();
    await waitFor(() => !byId(document, "local-results").hidden, "the decision brief to appear");

    await t.test("exactly one region announces the change", () => {
      const announced = spoke(before, announcingRegions(document));
      assert.deepEqual(announced, [ANSWER_ANNOUNCER_ID],
        `${announced.length} regions announced this import; a reader hears a queue, not an answer`);
    });

    await t.test("the one sentence carries the question, the metric, and the action", () => {
      const said = shownText(document, ANSWER_ANNOUNCER_ID);
      assert.ok(said.startsWith(STAND_QUESTION),
        `the announcement does not open with the question the page answers: "${said}"`);
      // The metric, with its unit, and the action — in that reading order.
      const metric = said.indexOf("Recoverable spend:");
      const action = said.indexOf("Do this next:");
      assert.ok(metric > 0, `no headline metric in the announcement: "${said}"`);
      assert.ok(action > metric, "the next action is announced before the metric it sizes");
      assert.match(said.slice(metric, action), /\$[\d,.]+/,
        "the headline metric is announced without its unit");
      // …and whose figures they are, last.
      assert.match(said, /Source: Your own export · analyzed in this browser\.$/);
      // Nothing out of the reader's file reaches the announcement: not the file
      // name, not a path, not a parser's own words.
      assert.doesNotMatch(said, /openai-usage-export|\.csv|generic-hris/i,
        "the announcement echoes the reader's own file name");
    });

    await t.test("focus lands on the answer, and the answer is not in the tab order", () => {
      assert.equal(document.activeElement?.id, "finops-stand",
        "the reader was moved somewhere other than the answer they just changed");
      assert.equal(byId(document, "finops-stand").getAttribute("tabindex"), "-1",
        "the answer region is reachable by Tab, so every reader now tabs through it");
    });

    await t.test("the provenance marker says Imported, in a word and a shape", () => {
      const marker = byId(document, STAND_IDS.sample);
      assert.equal(marker.dataset.source, "import");
      assert.match(textOf(marker), /^●\s?Imported\b/,
        "the marker still claims every figure in the answer is invented");
      assert.match(textOf(marker), /computed in this browser from the export you selected/);
      assert.doesNotMatch(textOf(marker), /Bundled synthetic example/);
    });
  } finally {
    page.restore?.();
  }
});

// ---------------------------------------------------------------------------
// 2. The rejected file, and the clear.
// ---------------------------------------------------------------------------

test("a rejected file is announced once, from a control the reader can act from", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    const before = announcingRegions(document);
    // A file the intake contract cannot read at all: no header a dialect knows.
    chooseFiles(document, [{ name: "notes.csv", text: "hello\nthere\n" }]);
    await waitFor(() => shownText(document, ANSWER_ANNOUNCER_ID).startsWith("This file was not"),
      "the rejection to be announced");

    const announced = spoke(before, announcingRegions(document));
    assert.deepEqual(announced, [ANSWER_ANNOUNCER_ID],
      `${announced.length} regions announced this rejection`);
    const said = shownText(document, ANSWER_ANNOUNCER_ID);
    assert.match(said, /This file was not analyzed\./, "the announcement does not say what happened");
    assert.ok(said.length > "This file was not analyzed.".length + 20,
      `the announcement says what went wrong but not what to do about it: "${said}"`);
    assert.match(said, /The answer on screen did not change\.$/);
    assert.doesNotMatch(said, /notes\.csv/, "the announcement echoes the reader's own file name");

    assert.equal(document.activeElement?.id, "local-finops-files",
      "focus was left on nothing a reader can act from after a rejected file");
  } finally {
    page.restore?.();
  }
});

test("clearing an import announces the synthetic baseline once, and leaves focus on the picker", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    await importExampleExport(document);
    byId(document, "import-mapping-confirm").click();
    await waitFor(() => !byId(document, "local-results").hidden, "the decision brief to appear");

    const before = announcingRegions(document);
    byId(document, "clear-local-analysis").click();

    const announced = spoke(before, announcingRegions(document));
    assert.deepEqual(announced, [ANSWER_ANNOUNCER_ID],
      `${announced.length} regions announced this clear`);
    const said = shownText(document, ANSWER_ANNOUNCER_ID);
    assert.ok(said.startsWith(STAND_QUESTION), "the cleared page re-states the question it answers");
    assert.match(said, /Source: Bundled synthetic example · nothing of yours needed\.$/,
      `a cleared import must say the page is back on the synthetic baseline: "${said}"`);
    assert.equal(document.activeElement?.id, "local-finops-files",
      "focus was dropped rather than placed on the control that starts the next import");

    // …and the marker went back with it, in both channels.
    const marker = byId(document, STAND_IDS.sample);
    assert.equal(marker.dataset.source, "example");
    assert.match(textOf(marker), /^◇\s?Bundled synthetic example\b/);
  } finally {
    page.restore?.();
  }
});

// ---------------------------------------------------------------------------
// 3. The announcer itself.
// ---------------------------------------------------------------------------

test("a success immediately followed by a clear leaves one message, not two", () => {
  const document = parseHtml(html);
  announceAnswer(document, "First message.");
  announceAnswer(document, "Second message.");
  assert.equal(shownText(document, ANSWER_ANNOUNCER_ID), "Second message.",
    "the announcer stacked two states a reader passed through");
});

test("the same sentence announced twice is written twice, blanked in between", () => {
  const document = parseHtml(html);
  const region = byId(document, ANSWER_ANNOUNCER_ID);
  const writes = [];
  // The blank-then-set is what makes a repeat import announce at all. Recording
  // every write proves it happens once per announcement rather than per region.
  Object.defineProperty(region, "textContent", {
    get: () => writes[writes.length - 1] ?? "",
    set: (value) => writes.push(value),
    configurable: true,
  });
  announceAnswer(document, "Same sentence.");
  announceAnswer(document, "Same sentence.");
  assert.deepEqual(writes, ["", "Same sentence.", "", "Same sentence."],
    "a repeated announcement is not blanked first, so an identical sentence is never re-read");
});

test("every echoing region is silenced, and the announcer is not among them", () => {
  const document = parseHtml(html);
  const silenced = silenceEchoedRegions(document);
  assert.ok(silenced.length >= 8, `only ${silenced.length} echoing regions were found on the page`);
  assert.ok(!ECHOED_LIVE_REGION_IDS.includes(ANSWER_ANNOUNCER_ID),
    "the page's one announcer is on the list of regions to silence");
  for (const id of silenced) {
    assert.equal(byId(document, id).getAttribute("aria-live"), "off", `${id} still announces`);
    assert.ok(textOf(byId(document, id)) !== null,
      `${id} was emptied rather than silenced; a sighted reader lost it`);
  }
  // Silencing is what the answer's own announcer buys, so it must survive.
  assert.equal(byId(document, ANSWER_ANNOUNCER_ID).getAttribute("aria-live"), "polite");
});

test("an implausible extreme is announced whole rather than truncated", () => {
  const question = `Where do we stand on AI spend across ${"every one of our departments, ".repeat(12)}?`;
  const action = `Move ${"the very long name of a department ".repeat(10)}off the premium model`;
  const said = answerAnnouncement({
    question,
    label: "Your own export · analyzed in this browser",
    recoverable: { available: true, label: "Recoverable spend", value: "$9,999,999,999.00 · 99% of analyzed spend" },
    action: { available: true, label: action },
  });
  assert.ok(said.includes(question), "a very long question is cut short in the announcement");
  assert.ok(said.includes(action), "a very long action is cut short in the announcement");
  assert.match(said, /\$9,999,999,999\.00/, "an extreme figure loses its unit or its digits");
});

test("the answer block wraps an extreme rather than clipping it", async () => {
  const css = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
  // The two slots a reader's own question and figure are painted into. Both are
  // width-bounded, so an unbroken 300-character string has to wrap out of the
  // block rather than be cut off inside it or push the region sideways.
  for (const selector of [".stand-head h2", ".stand-answer"]) {
    const rule = css.split("\n").find((line) => line.startsWith(`${selector} `));
    assert.ok(rule, `${selector} has no rule to check`);
    assert.match(rule, /overflow-wrap:anywhere/,
      `${selector} truncates or overflows an implausibly long string instead of wrapping it`);
    assert.doesNotMatch(rule, /text-overflow:ellipsis|white-space:nowrap/,
      `${selector} clips the answer rather than wrapping it`);
  }
});

test("a withheld metric and an unranked action are announced as what they are", () => {
  const said = answerAnnouncement({
    question: STAND_QUESTION,
    label: "Bundled synthetic example · nothing of yours needed",
    recoverable: { available: false, label: "Recoverable spend", value: "Not yet measured" },
    action: { available: false, label: "Not yet ranked" },
    withheld: { nextStep: "Choose a provider export to rank one." },
  });
  assert.match(said, /Recoverable spend: Not yet measured\./,
    "an unavailable metric is announced as a gap rather than as the reason it is unavailable");
  assert.match(said, /Do this next: Choose a provider export to rank one\./);
});

test("a parser's own words never reach the announcement", () => {
  const said = importFailureAnnouncement({
    // What a diagnostic would carry if a parser leaked into it. `redactDiagnostic`
    // is the shipped filter; this asserts the announcer runs through it too.
    text: "Unexpected token at /Users/lead/Downloads/october-spend.csv line 4",
    recovery: "Export the billing period again and choose it here.",
  });
  assert.doesNotMatch(said, /Users\/lead|Downloads/, "a filesystem path was announced");
  assert.match(said, /Export the billing period again/, "the recovery was dropped");
  assert.match(said, /The answer on screen did not change\.$/);
});

// ---------------------------------------------------------------------------
// 4. The evidence disclosures, named and operable.
// ---------------------------------------------------------------------------

test("every evidence disclosure names its layer and tracks its own state", () => {
  const document = parseHtml(html);
  for (const key of STAND_DISCLOSURE_ORDER) {
    const ids = standDisclosureIds(key);
    const details = byId(document, ids.details);
    // One disclosure is mounted by the view rather than authored; it is bound on
    // the same pass and is covered by tests/finops-headline-accessibility.js.
    if (!details) continue;
    const summary = byId(document, ids.summary);
    assert.equal(summary.tagName, "SUMMARY",
      `${key} is not a real control, so Enter and Space stop being the browser's`);
    assert.equal(summary.getAttribute("tabindex"), null,
      `${key}'s control was patched into or out of the tab order`);
    assert.equal(summary.getAttribute("aria-expanded"), "false",
      `${key} ships claiming an expanded state it is not in`);
    // The accessible name says WHICH evidence layer this is, so a reader tabbing
    // the region hears what they are about to open rather than "Show".
    assert.match(textOf(summary), new RegExp(STAND_DISCLOSURE_SUMMARY[key]
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `${key}'s control does not name the layer it opens`);
  }
});

test("a disclosure opens on Enter and on Space, and aria-expanded follows", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  try {
    for (const [key, press] of [["cohort", pressEnter], ["departments", pressSpace]]) {
      const ids = standDisclosureIds(key);
      const summary = byId(document, ids.summary);
      summary.focus();
      press(document);
      assert.equal(byId(document, ids.details).hasAttribute("open"), true,
        `${key} did not open from the keyboard`);
      assert.equal(summary.getAttribute("aria-expanded"), "true",
        `${key}'s aria-expanded did not follow it open`);
      press(document);
      assert.equal(byId(document, ids.details).hasAttribute("open"), false);
      assert.equal(summary.getAttribute("aria-expanded"), "false",
        `${key}'s aria-expanded did not follow it shut`);
    }
  } finally {
    page.restore?.();
  }
});

test("the marker the document ships and the marker the view paints are the same words", () => {
  const document = parseHtml(html);
  const marker = byId(document, STAND_IDS.sample);
  const authored = textOf(marker);
  assert.ok(authored.includes(STAND_SAMPLE_MARKER.example.word),
    "the authored marker and STAND_SAMPLE_MARKER disagree about the word");
  assert.ok(authored.includes(STAND_SAMPLE_MARKER.example.detail),
    "the authored marker and STAND_SAMPLE_MARKER disagree about the sentence a no-JS reader gets");
  assert.ok(authored.startsWith(STAND_SAMPLE_MARKER.example.shape),
    "the authored marker ships without the shape that carries its state without colour");
});
