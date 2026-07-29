// The coaching surface as a keyboard and screen-reader user meets it.
//
// Every test drives the shipped markup of src/evolution.html — never a fixture
// authored for the test — and the last two boot the real page entry, so the claim
// "the front door renders this state" is checked against the wiring that ships
// rather than against a call this file made itself.
//
// Nothing here transcribes a grade or a share: the expectations come from the
// state the shipped selector produced for the sample under test.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { DomEvent, loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  DISCLOSURE_IDS, ORG_QUERY_DECISION_STATE, orgQueryCoachingDecision,
} from "../src/org-query-decision.js";
import {
  ORG_COACHING_BODY_ID, ORG_COACHING_LIVE_ID, ORG_COACHING_SECTION_ID,
  applyOrgQueryDecision, clearOrgQueryDecision, panelId, toggleId,
} from "../src/org-query-decision-view.js";
import {
  exampleOrgQuerySampleText, loadExampleOrgQuerySample,
} from "../src/org-query-example.js";
import { exampleDepartmentUnitIds, loadExampleQuerySample } from "../src/query-sample-example.js";
import { orgQuerySampleResult } from "../src/org-query-source.js";
import { orgQueryDepartmentLiteracy } from "../src/org-query-scoring.js";
import { parseQuerySample } from "../src/query-sample-contract.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const STYLESHEET = new URL("../src/evolution.css", import.meta.url);
const DEMO_DATA = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const SENTINEL = "zzq-coaching-view-sentinel";

const literacyOf = (parsed) => orgQueryDepartmentLiteracy({
  results: [orgQuerySampleResult(parsed)],
});
const gradedState = (options = {}) =>
  orgQueryCoachingDecision(literacyOf(loadExampleOrgQuerySample()), options);
const ungradeableState = () => orgQueryCoachingDecision(literacyOf(loadExampleQuerySample()));

async function openPage() {
  const page = await loadPage(PAGE);
  return page;
}

const section = (document) => document.getElementById(ORG_COACHING_SECTION_ID);
const body = (document) => document.getElementById(ORG_COACHING_BODY_ID);
const live = (document) => document.getElementById(ORG_COACHING_LIVE_ID);
const toggle = (document, id) => document.getElementById(toggleId(id));
const panel = (document, id) => document.getElementById(panelId(id));

/* --------------------------------- the lead ---------------------------------- */

test("the shipped markup ships this section empty, hidden, and labelled", async () => {
  const { document } = await openPage();
  const node = section(document);
  assert.ok(node, "evolution.html does not ship the coaching section");
  assert.equal(node.hidden, true);
  assert.equal(node.dataset.state, ORG_QUERY_DECISION_STATE.absent);
  assert.equal(textOf(body(document)), "");
  // The section is named by its own heading, and the heading is the question.
  const heading = document.getElementById(node.getAttribute("aria-labelledby"));
  assert.match(textOf(heading), /which department needs coaching now\?/i);
  // The live region reserves its row before anything is painted into it.
  assert.equal(live(document).getAttribute("aria-live"), "polite");
});

test("the graded lead answers first, then the grade, confidence, and provenance", async () => {
  const { document } = await openPage();
  const state = gradedState({ origin: "example" });

  assert.equal(applyOrgQueryDecision(document, state), state);
  assert.equal(section(document).hidden, false);
  assert.equal(section(document).dataset.state, ORG_QUERY_DECISION_STATE.graded);
  assert.equal(section(document).dataset.origin, "example");

  const text = textOf(body(document));
  // Reading order is the decision order: the answer, then what it rests on.
  const positions = [state.answer, state.benchmark.text, state.confidence.text,
    state.provenance.label, state.action.title].map((needle) => text.indexOf(needle));
  for (const [index, at] of positions.entries()) {
    assert.notEqual(at, -1, `slot ${index} is missing from the painted lead`);
    if (index > 0) assert.ok(at > positions[index - 1], `slot ${index} is out of reading order`);
  }
  // The 56px letter is decorative: the benchmark sentence repeats it in words,
  // and a screen reader that read both would say the grade twice.
  const letter = body(document).querySelector(".org-coaching-letter");
  assert.equal(textOf(letter), state.benchmark.grade);
  assert.equal(letter.getAttribute("aria-hidden"), "true");
  // Confidence is not a tint: the level is on the block, a shape is beside the
  // sentence, and the word is inside the sentence itself.
  const confidence = body(document).querySelector(".org-coaching-confidence");
  assert.equal(confidence.dataset.level, state.confidence.level);
  assert.equal(textOf(confidence.querySelector(".org-coaching-shape")), state.confidence.shape);
  assert.ok(textOf(confidence).includes(state.confidence.word));
  const provenance = body(document).querySelector(".org-coaching-provenance");
  assert.equal(provenance.getAttribute("role"), "note");
});

test("an ungradeable sample publishes no letter and keeps its disclosures", async () => {
  const { document } = await openPage();
  const state = ungradeableState();

  applyOrgQueryDecision(document, state);

  assert.equal(section(document).dataset.state, ORG_QUERY_DECISION_STATE.ungradeable);
  assert.equal(body(document).querySelector(".org-coaching-letter"), null,
    "a sample with no publishable letter drew one anyway");
  assert.equal(body(document).querySelector(".org-coaching-lead").dataset.gradeStatus,
    "ungradeable");
  const text = textOf(body(document));
  assert.ok(text.includes(state.reason.label));
  assert.ok(text.includes(state.reason.detail));
  // The next step is a control-free sentence, and it is marked unavailable in a
  // second channel so the dashed edge is not the only signal.
  const action = body(document).querySelector(".org-coaching-action");
  assert.equal(action.dataset.available, "false");
  assert.ok(textOf(action).includes(state.action.title));
  assert.equal(body(document).querySelectorAll(".org-coaching-disclosure").length,
    state.disclosures.length);
});

/* ---------------------------- progressive disclosure -------------------------- */

test("each disclosure is a real button that owns its panel and starts closed", async () => {
  const { document } = await openPage();
  const state = gradedState();

  applyOrgQueryDecision(document, state);

  for (const disclosure of state.disclosures) {
    const control = toggle(document, disclosure.id);
    assert.equal(control.tagName, "BUTTON");
    assert.equal(control.getAttribute("type"), "button");
    assert.equal(control.getAttribute("aria-expanded"), "false");
    assert.equal(control.getAttribute("aria-controls"), panelId(disclosure.id));
    assert.ok(textOf(control).includes(disclosure.question));
    assert.ok(textOf(control).includes(disclosure.chip));
    const region = panel(document, disclosure.id);
    assert.equal(region.hidden, true);
    assert.equal(region.getAttribute("role"), "region");
    assert.equal(region.getAttribute("aria-label"), disclosure.question);
    // A closed panel holds nothing: forty hidden rows are forty nodes an element
    // search still walks past.
    assert.equal(textOf(region), "");
  }
});

test("opening a disclosure paints its rows, keeps focus, and closing puts it back", async () => {
  const { document } = await openPage();
  const state = gradedState();
  applyOrgQueryDecision(document, state);
  const mix = state.disclosures.find((entry) => entry.id === DISCLOSURE_IDS.mix);

  toggle(document, DISCLOSURE_IDS.mix).click();

  assert.equal(toggle(document, DISCLOSURE_IDS.mix).getAttribute("aria-expanded"), "true");
  assert.equal(panel(document, DISCLOSURE_IDS.mix).hidden, false);
  const opened = textOf(panel(document, DISCLOSURE_IDS.mix));
  for (const row of mix.rows) {
    assert.ok(opened.includes(row.term) && opened.includes(row.detail));
  }
  // The repaint rebuilds the block, so focus has to be put back deliberately:
  // without it, Enter twice drops a keyboard reader at the top of the page.
  assert.equal(document.activeElement?.id, toggleId(DISCLOSURE_IDS.mix));
  // Every other panel is untouched by one being opened.
  assert.equal(panel(document, DISCLOSURE_IDS.evidence).hidden, true);

  toggle(document, DISCLOSURE_IDS.mix).click();

  assert.equal(toggle(document, DISCLOSURE_IDS.mix).getAttribute("aria-expanded"), "false");
  assert.equal(panel(document, DISCLOSURE_IDS.mix).hidden, true);
  assert.equal(textOf(panel(document, DISCLOSURE_IDS.mix)), "");
});

test("the four toggles are keyboard-reachable in the painted order and open with Enter", async () => {
  const { document } = await openPage();
  const state = gradedState();
  applyOrgQueryDecision(document, state);

  const ids = state.disclosures.map((entry) => toggleId(entry.id));
  const reached = tabSequence(document).map((node) => node.id).filter((id) => ids.includes(id));
  assert.deepEqual(reached, ids, "the disclosures are not in the tab sequence in painted order");

  toggle(document, DISCLOSURE_IDS.sampling).focus();
  pressEnter(document);

  assert.equal(panel(document, DISCLOSURE_IDS.sampling).hidden, false);
  // Two panels open at once is allowed and expected: a reader comparing the
  // sampling limits against the department rows should not have to choose.
  toggle(document, DISCLOSURE_IDS.evidence).focus();
  pressEnter(document);
  assert.equal(panel(document, DISCLOSURE_IDS.sampling).hidden, false);
  assert.equal(panel(document, DISCLOSURE_IDS.evidence).hidden, false);
});

/* ------------------------------ screen readers ------------------------------- */

test("one announcement per decision, and a disclosure toggle does not repeat it", async () => {
  const { document } = await openPage();
  const state = gradedState({ origin: "example" });

  applyOrgQueryDecision(document, state);

  assert.equal(textOf(live(document)), state.announcement);
  // It names the department, the grade, the confidence and the action: "updated"
  // would tell a reader something moved and nothing about whether to act.
  assert.ok(state.announcement.includes(state.benchmark.grade));
  const before = live(document).textContent;
  toggle(document, DISCLOSURE_IDS.redaction).click();
  // Rewriting a status region with the same string announces the whole decision
  // again because the reader opened a panel.
  assert.equal(live(document).textContent, before);
});

/* -------------------------------- redaction ---------------------------------- */

test("no prompt text is drawn, even when the chosen file carried excerpts", async () => {
  const { document } = await openPage();
  const units = exampleDepartmentUnitIds();
  const header = "org_unit_id,query_date,model,input_tokens,output_tokens,prompt_excerpt,category";
  const rows = Array.from({ length: 30 }, (_, index) => {
    const day = `2026-06-${String(1 + (index % 20)).padStart(2, "0")}`;
    const excerpt = index < 3 ? `${SENTINEL} summarize this for me` : "";
    return [units[0], day, "acme-opus-1", "800", "400", excerpt,
      excerpt ? "" : ["highValue", "inefficient", "outOfScope"][index % 3]].join(",");
  });
  const parsed = parseQuerySample(`${[header, ...rows].join("\n")}\n`);
  assert.equal(parsed.ok, true);
  const state = orgQueryCoachingDecision(literacyOf(parsed));

  applyOrgQueryDecision(document, state);
  // Every panel opened, because a closed one proves nothing.
  for (const disclosure of state.disclosures) toggle(document, disclosure.id).click();

  assert.ok(!textOf(section(document)).includes(SENTINEL),
    "prompt text was drawn on the coaching surface");
  // And the promise is on screen rather than only in a comment.
  assert.ok(textOf(panel(document, DISCLOSURE_IDS.redaction))
    .includes("never stored, exported, or drawn on this page"));
});

test("hostile labels and filenames are inert text and filename controls are neutralized", async () => {
  const { document } = await openPage();
  const payload = `<img src=x onerror="${SENTINEL}">`;
  const base = gradedState({
    fileNames: [`quarterly\u202Efdp.csv\u0000-${payload}`],
  });
  // Exercise the rendering boundary with a hostile organization label even
  // though the shipped query-sample validator rejects markup long before this
  // point. Defense in depth here is intentionally boring: text nodes only.
  const state = {
    ...base,
    answer: `${payload} — coach this department first.`,
    disclosures: base.disclosures.map((entry) => entry.id === DISCLOSURE_IDS.evidence
      ? { ...entry, rows: [{ term: payload, detail: payload, gradeable: true }] }
      : entry),
  };

  applyOrgQueryDecision(document, state);
  toggle(document, DISCLOSURE_IDS.evidence).click();

  assert.equal(section(document).querySelector("img"), null);
  assert.equal(section(document).querySelector("script"), null);
  assert.ok(textOf(section(document)).includes(payload),
    "hostile text should be shown literally rather than interpreted as markup");
  const provenance = textOf(body(document).querySelector(".org-coaching-provenance"));
  assert.ok(provenance.includes(`quarterly\uFFFDfdp.csv\uFFFD-${payload}`));
  assert.doesNotMatch(provenance,
    /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u);
});

/* ------------------------------- state changes -------------------------------- */

test("the absent state and the clear both hand the section back untouched", async () => {
  const { document } = await openPage();
  applyOrgQueryDecision(document, gradedState());
  assert.equal(section(document).hidden, false);

  assert.equal(clearOrgQueryDecision(document), null);

  assert.equal(section(document).hidden, true);
  assert.equal(section(document).dataset.state, ORG_QUERY_DECISION_STATE.absent);
  assert.equal(textOf(body(document)), "");
  assert.equal(textOf(live(document)), "");
  // The absent state is the same hand-back, so a caller with no sample does not
  // have to know which of the two functions to call.
  applyOrgQueryDecision(document, gradedState());
  applyOrgQueryDecision(document, orgQueryCoachingDecision(null));
  assert.equal(section(document).hidden, true);
  assert.equal(textOf(body(document)), "");
});

test("a different sample closes the panels the previous one left open", async () => {
  const { document } = await openPage();
  applyOrgQueryDecision(document, gradedState());
  toggle(document, DISCLOSURE_IDS.evidence).click();
  assert.equal(panel(document, DISCLOSURE_IDS.evidence).hidden, false);

  applyOrgQueryDecision(document, ungradeableState());

  // A panel left open would be captioned for the file it was opened against.
  assert.equal(panel(document, DISCLOSURE_IDS.evidence).hidden, true);
  // Repainting the *same* sample keeps them, so a re-render under the reader's
  // hands does not collapse what they were reading.
  toggle(document, DISCLOSURE_IDS.evidence).click();
  applyOrgQueryDecision(document, ungradeableState());
  assert.equal(panel(document, DISCLOSURE_IDS.evidence).hidden, false);
});

/* -------------------------------- responsive --------------------------------- */

test("the block is single-column by default and only widens at a breakpoint", async () => {
  const css = await readFile(STYLESHEET, "utf8");
  const block = css.slice(css.indexOf(".org-coaching {"), css.indexOf("The one-page department"));
  // Mobile-first: the section and its body are grids with no column template, so
  // every slot stacks in reading order at any width.
  const breakpoint = block.indexOf("@media (min-width:52rem)");
  assert.notEqual(breakpoint, -1, "the block declares no breakpoint at all");
  const narrow = block.slice(0, breakpoint);
  assert.match(narrow, /\.org-coaching \{[^}]*display:grid/);
  assert.match(narrow, /#org-coaching-body \{[^}]*display:grid/);
  assert.ok(!/grid-template-columns/.test(narrow),
    "a column template before the breakpoint cannot fit a phone");
  // One breakpoint, in rem so it moves with the reader's own text size, and it
  // only adds columns.
  const wide = block.slice(breakpoint);
  assert.match(wide, /\.org-coaching-figure \{[^}]*grid-template-columns:minmax\(0,auto\)/);
  assert.match(wide, /\.org-coaching-rows \{[^}]*grid-template-columns:minmax\(0,14rem\)/);
  // Nothing in the block pins a pixel width, which is what stops a long unit id
  // or a translated sentence from overflowing.
  assert.ok(!/[^-]width:\s*\d+px/.test(block), "a fixed pixel width would clip at small sizes");
  // Long, unbroken org-unit pseudonyms have to wrap somewhere.
  assert.match(block, /\.org-coaching-row-term \{[^}]*overflow-wrap:anywhere/);
  assert.match(block, /\.org-coaching-answer \{[^}]*overflow-wrap:anywhere/);
});

/* ------------------------------- the front door ------------------------------- */

async function openFinopsTab() {
  const page = await loadPage(PAGE, {
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  return page;
}

test("the AI FinOps tab grades its bundled example sample on one click", async () => {
  const { document } = await openFinopsTab();
  // Before the click the section is untouched, so a visitor who never asks for
  // the example never meets it.
  assert.equal(section(document).hidden, true);

  document.getElementById("grade-example-org-query-sample").click();

  assert.equal(section(document).dataset.state, ORG_QUERY_DECISION_STATE.graded);
  assert.equal(section(document).dataset.origin, "example");
  const expected = gradedState({ origin: "example" });
  assert.ok(textOf(body(document)).includes(expected.answer));
  // Labelled as the example it is, on the line a reader checks provenance on.
  assert.match(textOf(body(document).querySelector(".org-coaching-provenance")),
    /Bundled synthetic organizational query sample/);
  // The bundled billing seed's own ranked list is untouched: two unrelated
  // synthetic organizations in one comparison is worse than one demonstration.
  assert.ok(textOf(document.getElementById("department-priority")).length > 0);
});

test("a chosen query sample reaches the same surface, labelled as the reader's own", async () => {
  const { document } = await openFinopsTab();
  const input = document.getElementById("local-finops-files");
  input.files = [{
    name: "my-gateway-sample.csv",
    type: "text/csv",
    text: async () => exampleOrgQuerySampleText(),
  }];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));

  await waitFor(() => !section(document).hidden, "the coaching decision to be painted");

  assert.equal(section(document).dataset.state, ORG_QUERY_DECISION_STATE.graded);
  assert.equal(section(document).dataset.origin, "import");
  const provenance = textOf(body(document).querySelector(".org-coaching-provenance"));
  assert.match(provenance, /Your file, read in this tab/);
  // No provider export came with it, so no cost is claimed for the department the
  // surface just named.
  assert.match(textOf(body(document).querySelector(".org-coaching-action-money")),
    /No savings figure is stated/);

  // And the clear takes it away with everything else: a decision outliving the
  // file it was graded from is the mislabelling the clear exists to prevent.
  document.getElementById("clear-local-analysis").click();
  assert.equal(section(document).hidden, true);
});
