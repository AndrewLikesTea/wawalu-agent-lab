import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  COMPLETENESS_SCORERS, COMPLETENESS_SLOTS, COMPLETE_ACTION, COMPLETE_SENTENCE,
  SLOT_INPUT_STATE, assessOwnDataCompleteness, bindOwnDataCompleteness,
  focusCompletenessTarget, renderCompletenessScorers, renderOwnDataCompleteness,
} from "../src/own-data-completeness.js";
import { createElement } from "./support/dom.js";

const page = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");

// The own-data path is the local-import panel. Its top-level questions are the
// h3 headings inside it: everything under one of those is that question's own
// supporting evidence.
const ownDataPath = page.slice(page.indexOf('id="local-import"'), page.indexOf('id="prompt-coaching"'));

const OWN_DATA_QUESTIONS = [
  "What still needs to happen before this brief is CFO-ready?",
  "Will your hyperscaler export work here?",
  "Which model in your export costs the most per thousand billed units?",
  "What happens to the file you choose",
  "What is the strongest finding my imported evidence supports right now?",
  "Providers in this analysis",
  "Can I responsibly combine this portfolio now?",
  "Delivery history read from a Shiplog export",
  "Check what each of your columns became.",
  "Which structural columns your export actually carries.",
  "FinOps briefing",
  "Reopened FinOps briefing (read-only)",
  "What this browser remembered",
];

// A stub built from the ids the shipped page actually carries, so an id renamed
// on one side and not the other fails here instead of blanking a region.
function pageDocument(extraIds = []) {
  const authored = [...ownDataPath.matchAll(/id="(own-data-completeness[a-z-]*)"/g)].map(([, id]) => id);
  const nodes = Object.fromEntries([...new Set([...authored, ...extraIds])]
    .map((id) => [id, Object.assign(createElement("div"), { id })]));
  return {
    nodes,
    document: {
      createElement,
      createTextNode: (text) => { const n = createElement("#text"); n.textContent = text; return n; },
      getElementById: (id) => nodes[id] ?? null,
    },
  };
}

const allFilled = Object.fromEntries(COMPLETENESS_SLOTS.map((slot) => [slot.id, SLOT_INPUT_STATE.filled]));

test("the own-data path asks one question about completeness, and the heading set is pinned", () => {
  const headings = [...ownDataPath.matchAll(/<h3[^>]*>([^<]*)</g)].map(([, text]) => text.trim());
  assert.equal(headings.length, OWN_DATA_QUESTIONS.length);
  assert.deepEqual(headings, OWN_DATA_QUESTIONS);
  // Exactly one of them is about what is missing. A seventh completeness
  // section reappearing here fails this line.
  assert.equal(headings.filter((text) => /missing|complete|confiden|ready|preflight/i.test(text)).length, 1);
});

test("all six previously surfaced scorers stay reachable from inside the block", () => {
  const { document, nodes } = pageDocument();
  renderCompletenessScorers(document);
  const list = nodes["own-data-completeness-scorer-list"];
  assert.deepEqual(list.children.map((item) => item.dataset.scorer), [
    "evidence-preflight", "recognition-confidence", "intake-confidence",
    "gradability", "brief-completeness", "circulation-readiness",
  ]);
  // Every link targets an id the shipped page carries, and every link is an
  // anchor with an href, so it is reachable and operable from the keyboard.
  for (const scorer of COMPLETENESS_SCORERS) {
    assert.ok(page.includes(`id="${scorer.target}"`), `${scorer.target} is not on the page`);
  }
  for (const item of list.children) {
    const link = item.children[0];
    assert.equal(link.tagName, "A");
    assert.match(link.getAttribute("href"), /^#[a-z-]+$/);
  }
});

test("filled of total renders the expected integers for a fixture with three gaps", () => {
  const model = assessOwnDataCompleteness({
    ...allFilled,
    "department-mapping": SLOT_INPUT_STATE.unrecognized,
    "cohort-facts": SLOT_INPUT_STATE.absent,
    "comparison-period": SLOT_INPUT_STATE.absent,
  });
  assert.equal(model.total, 6);
  assert.equal(model.filled, 3);
  const { document, nodes } = pageDocument();
  renderOwnDataCompleteness(document, model);
  // The integers are in the DOM text, not only in a bar width.
  assert.equal(nodes["own-data-completeness-filled"].textContent, "3");
  assert.equal(nodes["own-data-completeness-total"].textContent, "6");
  assert.equal(nodes["own-data-completeness"].dataset.filled, "3");
  assert.equal(nodes["own-data-completeness"].dataset.state, "incomplete");
});

test("total is the slot list's length and does not shrink as slots fill", () => {
  assert.equal(assessOwnDataCompleteness({}).total, COMPLETENESS_SLOTS.length);
  assert.equal(assessOwnDataCompleteness(allFilled).total, COMPLETENESS_SLOTS.length);
  // Deduplicated by the input: no slot id appears twice however many scorers
  // read it.
  assert.equal(new Set(COMPLETENESS_SLOTS.map((slot) => slot.id)).size, COMPLETENESS_SLOTS.length);
});

test("an unrecognized input is unfilled and says so in the reader's words", () => {
  const model = assessOwnDataCompleteness({
    ...allFilled, "department-classification": SLOT_INPUT_STATE.unrecognized,
  });
  assert.equal(model.filled, 5);
  const [gap] = model.unfilled;
  assert.equal(gap.word, "unrecognized");
  assert.match(gap.gap, /unclassified/);
});

test("the prioritized action is exactly one, ranked by blocking and not by slot order", () => {
  // Cohort facts sit above the comparison period in the slot list AND both are
  // missing; the conversation export outranks both because it withholds the
  // whole literacy half of the brief.
  const model = assessOwnDataCompleteness({
    ...allFilled,
    "conversation-export": SLOT_INPUT_STATE.absent,
    "cohort-facts": SLOT_INPUT_STATE.absent,
    "comparison-period": SLOT_INPUT_STATE.absent,
  });
  assert.equal(model.action.slotId, "conversation-export");
  const { document, nodes } = pageDocument();
  renderOwnDataCompleteness(document, model);
  const link = nodes["own-data-completeness-action-link"];
  assert.match(link.textContent, /Conversation export/);
  assert.equal(link.getAttribute("href"), "#local-finops-files");
  assert.ok(page.includes(`id="${model.action.control}"`));
  // One action, never a list.
  assert.equal(nodes["own-data-completeness-action"].dataset.state, "incomplete");
});

test("a blocking gap outranks every gap that merely weakens the brief", () => {
  const model = assessOwnDataCompleteness({ "cohort-facts": SLOT_INPUT_STATE.filled });
  assert.equal(model.action.slotId, "spend-export");
  assert.equal(model.filled, 1);
});

test("the department-classification action targets the control #1008 landed", () => {
  const model = assessOwnDataCompleteness({
    ...allFilled, "department-classification": SLOT_INPUT_STATE.absent,
  });
  assert.equal(model.action.control, "score-classify");
  assert.ok(page.includes('id="score-classify"'));
});

test("following the action moves focus to the control, not merely near it", () => {
  const select = createElement("select");
  const container = createElement("div");
  container.append(select);
  const { document, nodes } = pageDocument(["score-classify"]);
  nodes["score-classify"] = container;
  const focused = focusCompletenessTarget(document, "score-classify");
  assert.equal(focused, select);
  assert.equal(select.focused, 1);

  // And the block's own delegated listener does it on a click, once bound.
  renderOwnDataCompleteness(document, assessOwnDataCompleteness({
    ...allFilled, "department-classification": SLOT_INPUT_STATE.absent,
  }));
  assert.equal(bindOwnDataCompleteness(document), true);
  assert.equal(bindOwnDataCompleteness(document), false, "binding is idempotent");
  let defaultPrevented = false;
  nodes["own-data-completeness"].dispatch("click", {
    target: nodes["own-data-completeness-action-link"],
    preventDefault() { defaultPrevented = true; },
  });
  assert.equal(defaultPrevented, true);
  assert.equal(select.focused, 2);
});

test("a target with no control of its own is made focusable rather than skipped", () => {
  const { document, nodes } = pageDocument(["briefing-readiness-question"]);
  const focused = focusCompletenessTarget(document, "briefing-readiness-question");
  assert.equal(focused, nodes["briefing-readiness-question"]);
  assert.equal(focused.getAttribute("tabindex"), "-1");
  assert.equal(focused.focused, 1);
  assert.equal(focusCompletenessTarget(document, "not-on-this-page"), null);
});

test("the complete state states completion, names one action, and renders no gap list", () => {
  const model = assessOwnDataCompleteness(allFilled);
  assert.equal(model.complete, true);
  assert.equal(model.filled, 6);
  assert.deepEqual(model.unfilled, []);
  assert.equal(model.action, COMPLETE_ACTION);
  const { document, nodes } = pageDocument();
  renderOwnDataCompleteness(document, model);
  assert.equal(nodes["own-data-completeness"].dataset.state, "complete");
  assert.equal(nodes["own-data-completeness-lead"].textContent, COMPLETE_SENTENCE);
  assert.equal(nodes["own-data-completeness-action-link"].textContent, COMPLETE_ACTION.text);
  // No empty checklist, and no next-action link to nowhere.
  assert.equal(nodes["own-data-completeness-gaps"].children.length, 0);
  assert.equal(nodes["own-data-completeness-gaps"].hidden, true);
  assert.equal(nodes["own-data-completeness-gaps-detail"].hidden, true);
  assert.ok(page.includes(`id="${COMPLETE_ACTION.control}"`));
});

test("the block ships no figure and the scorer regions it folded in are inside it", () => {
  const block = ownDataPath.slice(ownDataPath.indexOf('id="own-data-completeness"'));
  const closed = block.slice(0, block.indexOf('class="privacy-boundary"'));
  for (const id of ["own-data-evidence-preflight", "export-recognition", "intake-confidence"]) {
    assert.ok(closed.includes(`id="${id}"`), `${id} is no longer inside the consolidated block`);
  }
  // The two integers are painted, never authored as a count anybody could act
  // on: the document ships zeroes and the module writes the real pair.
  assert.match(closed, /id="own-data-completeness-filled">0</);
  assert.match(closed, /id="own-data-completeness-total">0</);
});
