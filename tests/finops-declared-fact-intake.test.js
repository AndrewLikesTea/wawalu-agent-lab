// Five declared facts in, one headline out — with no file, no request, and no
// stored answer (#1103).
//
// WHAT THIS FILE HOLDS THE INTAKE TO:
//   1. KEYBOARD ALONE COMPLETES IT. Every control is reachable by Tab in
//      reading order, fillable with typing and the arrow keys, and submittable
//      with Enter. No pointer appears anywhere below.
//   2. THE SPINE IS THREE SENTENCES. The figure with its quartile, the modelled
//      recoverable amount, one next action — every one of them carrying the
//      word "estimated", because a figure quoted without its marker is the way
//      a modelled number becomes a promised one.
//   3. REVISING RE-ANSWERS. Changing an answer repaints the headline with no
//      navigation, and clearing puts the region back to the bundled example a
//      first-time visitor meets.
//   4. NOTHING LEAVES THE BROWSER. Asserted on the form's own attributes and on
//      a submit run with `fetch` and both storages instrumented, not on a
//      comment saying so.
//   5. THE ARITHMETIC IS NOT REIMPLEMENTED. Every figure is the estimator's, and
//      no coefficient or quartile boundary appears in the intake's source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { DomEvent, parseHtml, pressKey, pressTab, tabSequence, textOf } from "./support/browser.js";
import {
  INTAKE_IDS, INTAKE_LEGEND, INDUSTRY_CHOICES, MIX_CHOICES, NEXT_ACTION, SIZE_CHOICES,
  currentDeclaredFacts, intakeHeadline, intakeNextAction, intakeRecoverable, mixChoiceFor,
  readDeclaredFacts, setDeclaredFacts,
} from "../src/finops-declared-fact-intake.js";
import {
  applyDeclaredFactIntake, applyDeclaredFactIntakeFromControls, bindDeclaredFactIntake,
  declaredFactsFromControls, resetDeclaredFactIntake,
} from "../src/finops-declared-fact-intake-view.js";
import {
  CONFIDENCE_TIER, PLAUSIBLE_ENGINEER_HEADCOUNT, PLAUSIBLE_MONTHLY_SPEND_USD,
  estimateFromDeclaredFacts,
} from "../src/finops-declared-fact-estimate.js";
import { EXAMPLE_DECLARED_FACTS } from "../src/finops-declared-fact-fixtures.js";
import { ORG_SIZE_BAND, PEER_INDUSTRY } from "../src/peer-cost-cohorts.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");

const byId = (doc, id) => {
  const node = doc.getElementById(id);
  assert.ok(node, `#${id} is not on the page`);
  return node;
};

/** A fresh page with the intake bound, and the shared facts back at the example. */
function intakePage() {
  setDeclaredFacts(EXAMPLE_DECLARED_FACTS);
  const document = parseHtml(html);
  bindDeclaredFactIntake(document);
  return document;
}

const headlineOf = (doc) => textOf(byId(doc, INTAKE_IDS.headline));

/** Type into a field the way a visitor does: clear it, then key by key. */
function replaceValue(document, id) {
  const field = byId(document, id);
  field.focus();
  field.value = "";
  return field;
}

function typeInto(document, id, text) {
  const field = replaceValue(document, id);
  for (const character of String(text)) {
    field.value = `${field.value}${character}`;
    field.dispatchEvent(new DomEvent("input", { bubbles: true }));
  }
  return field;
}

// --- the five facts, as a group ---------------------------------------------

test("the intake declares five facts, each with a visible label, inside one named group", () => {
  const document = parseHtml(html);
  const form = byId(document, INTAKE_IDS.form);
  assert.equal(form.tagName.toLowerCase(), "form");

  const group = form.querySelectorAll("fieldset");
  assert.equal(group.length, 1, "the five facts are one announceable group, not five loose fields");
  const legend = byId(document, INTAKE_IDS.legend);
  assert.equal(legend.tagName.toLowerCase(), "legend");
  assert.equal(textOf(legend), INTAKE_LEGEND);

  // Five controls, in reading order, each with a label pointing at it.
  const fields = [INTAKE_IDS.spend, INTAKE_IDS.mix, INTAKE_IDS.engineers, INTAKE_IDS.size,
    INTAKE_IDS.industry];
  // The roster file control (#1105) is an ALTERNATIVE way to answer the third
  // fact, not a sixth fact, so it is left out of this list and covered on its
  // own terms in hris-headcount-roster.test.js. It is asserted to sit directly
  // after the field it stands in for, which is where it is read.
  const authored = form.querySelectorAll("input,select").map((node) => node.id);
  assert.equal(authored.indexOf(INTAKE_IDS.roster), authored.indexOf(INTAKE_IDS.engineers) + 1);
  assert.deepEqual(authored.filter((id) => id !== INTAKE_IDS.roster), fields,
    "the five controls are not in the intended reading order");
  for (const id of fields) {
    const labels = form.querySelectorAll("label").filter((label) => label.getAttribute("for") === id);
    assert.equal(labels.length, 1, `#${id} has no single visible label bound to it`);
    assert.ok(textOf(labels[0]).length > 0, `#${id}'s label is empty`);
  }

  // No free text anywhere: two bounded numbers and three published lists. The
  // roster control is a file picker, which carries no typed text either — what
  // it accepts is bounded by a published contract instead of by min and max.
  assert.equal(form.querySelectorAll("textarea").length, 0);
  for (const node of form.querySelectorAll("input")) {
    assert.equal(node.getAttribute("type"), node.id === INTAKE_IDS.roster ? "file" : "number",
      "a free-text field entered the intake");
  }
  assert.equal(byId(document, INTAKE_IDS.spend).getAttribute("min"),
    String(PLAUSIBLE_MONTHLY_SPEND_USD.min));
  assert.equal(byId(document, INTAKE_IDS.spend).getAttribute("max"),
    String(PLAUSIBLE_MONTHLY_SPEND_USD.max));
  assert.equal(byId(document, INTAKE_IDS.engineers).getAttribute("min"),
    String(PLAUSIBLE_ENGINEER_HEADCOUNT.min));
  assert.equal(byId(document, INTAKE_IDS.engineers).getAttribute("max"),
    String(PLAUSIBLE_ENGINEER_HEADCOUNT.max));
});

test("every offered option is a published value, with the published words on it", () => {
  const document = parseHtml(html);
  const offered = (id) => byId(document, id).querySelectorAll("option")
    .map((option) => ({ value: option.getAttribute("value"), label: textOf(option) }));
  assert.deepEqual(offered(INTAKE_IDS.mix),
    MIX_CHOICES.map((choice) => ({ value: choice.value, label: choice.label })));
  assert.deepEqual(offered(INTAKE_IDS.size), SIZE_CHOICES.map((choice) =>
    ({ value: choice.value, label: choice.label })));
  assert.deepEqual(offered(INTAKE_IDS.industry), INDUSTRY_CHOICES.map((choice) =>
    ({ value: choice.value, label: choice.label })));

  // The state a first-time visitor lands on IS the bundled example's five facts,
  // so the clear control has a defined state to restore and the estimate above
  // the intake and the answer below it describe one company. Authored as the
  // chosen option, for the visit where no script runs...
  const chosen = (id) => byId(document, id).querySelectorAll("option")
    .filter((option) => option.hasAttribute("selected")).map((option) => option.getAttribute("value"));
  assert.deepEqual(chosen(INTAKE_IDS.mix), [MIX_CHOICES[0].value]);
  assert.deepEqual(chosen(INTAKE_IDS.size), [EXAMPLE_DECLARED_FACTS.sizeBand]);
  assert.deepEqual(chosen(INTAKE_IDS.industry), [EXAMPLE_DECLARED_FACTS.industry]);
  // ...and read back as the same five facts once the intake is bound.
  bindDeclaredFactIntake(document);
  assert.deepEqual(declaredFactsFromControls(document), {
    monthlySpendUsd: EXAMPLE_DECLARED_FACTS.monthlySpendUsd,
    engineers: EXAMPLE_DECLARED_FACTS.engineers,
    providerMix: MIX_CHOICES[0].mix,
    sizeBand: EXAMPLE_DECLARED_FACTS.sizeBand,
    industry: EXAMPLE_DECLARED_FACTS.industry,
  });
  assert.equal(mixChoiceFor(EXAMPLE_DECLARED_FACTS.providerMix), MIX_CHOICES[0].value);
});

test("the authored answer spine is the estimator's own sentences for the example", () => {
  const document = parseHtml(html);
  const estimate = estimateFromDeclaredFacts(EXAMPLE_DECLARED_FACTS);
  assert.equal(textOf(byId(document, INTAKE_IDS.headline)), intakeHeadline(estimate),
    "the authored headline and the module's headline have drifted");
  assert.equal(textOf(byId(document, INTAKE_IDS.recoverable)), intakeRecoverable(estimate));
  assert.equal(textOf(byId(document, INTAKE_IDS.action)), intakeNextAction(estimate));
  assert.equal(byId(document, INTAKE_IDS.answer).dataset.provenance, "estimated");
});

// --- keyboard alone ---------------------------------------------------------

test("a visitor completes and submits the intake with the keyboard alone", () => {
  const document = intakePage();
  const order = tabSequence(document).map((node) => node.id);
  const positions = [INTAKE_IDS.spend, INTAKE_IDS.mix, INTAKE_IDS.engineers, INTAKE_IDS.size,
    INTAKE_IDS.industry, INTAKE_IDS.submit, INTAKE_IDS.clear].map((id) => order.indexOf(id));
  for (const position of positions) assert.ok(position >= 0, "a control is not keyboard reachable");
  assert.deepEqual([...positions].sort((left, right) => left - right), positions,
    "the intake's tab order must be the five facts in reading order, then submit, then clear");

  // Tab lands on the first field from the control before it, so the group is
  // entered rather than jumped over.
  byId(document, INTAKE_IDS.spend).focus();
  assert.equal(pressTab(document).id, INTAKE_IDS.mix);

  // Typing, then the arrow keys, then Enter. No click anywhere.
  typeInto(document, INTAKE_IDS.spend, "9000");
  byId(document, INTAKE_IDS.mix).focus();
  pressKey(document, "ArrowDown");
  pressKey(document, "ArrowDown");
  assert.equal(byId(document, INTAKE_IDS.mix).value, MIX_CHOICES[2].value);
  typeInto(document, INTAKE_IDS.engineers, "60");
  byId(document, INTAKE_IDS.size).focus();
  pressKey(document, "ArrowUp");
  pressKey(document, "ArrowUp");
  assert.equal(byId(document, INTAKE_IDS.size).value, ORG_SIZE_BAND.small);

  byId(document, INTAKE_IDS.engineers).focus();
  pressKey(document, "Enter");

  const facts = {
    monthlySpendUsd: 9000,
    engineers: 60,
    providerMix: MIX_CHOICES[2].mix,
    sizeBand: ORG_SIZE_BAND.small,
    industry: PEER_INDUSTRY.saas,
  };
  const expected = estimateFromDeclaredFacts(facts);
  assert.equal(headlineOf(document), intakeHeadline(expected));
  assert.equal(textOf(byId(document, INTAKE_IDS.live)), intakeHeadline(expected),
    "a deliberate submit is announced once, in the region's own polite status");
});

// --- the answer spine -------------------------------------------------------

test("submitting renders one headline, one recoverable amount, and one next action", () => {
  const document = intakePage();
  const facts = {
    monthlySpendUsd: 120_000,
    engineers: 150,
    providerMix: MIX_CHOICES[1].mix,
    sizeBand: ORG_SIZE_BAND.mid,
    industry: PEER_INDUSTRY.saas,
  };
  const estimate = applyDeclaredFactIntake(document, facts);

  // (a) The headline names the figure and the quartile, in one sentence.
  const headline = headlineOf(document);
  assert.ok(headline.startsWith("Estimated:"), "the headline must say what kind of figure it is");
  assert.ok(headline.includes(estimate.costPerSuccessfulTask.display), "the figure is missing");
  assert.ok(headline.includes(estimate.quartile.label), "the quartile is missing");
  assert.ok(headline.includes("Lower cost per successful task is better."),
    "a quartile without its direction can be read backwards");

  // (b) The recoverable amount, labelled modelled and estimated.
  const recoverable = textOf(byId(document, INTAKE_IDS.recoverable));
  assert.match(recoverable, /^Estimated recoverable: /);
  assert.match(recoverable, /modelled/);
  assert.match(recoverable, /not a measured, invoiced, or realized saving/);

  // (c) Exactly one next action.
  const action = textOf(byId(document, INTAKE_IDS.action));
  assert.equal(action, NEXT_ACTION[estimate.quartile.band]);
  assert.equal(byId(document, INTAKE_IDS.answer).querySelectorAll("p").length, 3,
    "the spine is three sentences; everything else belongs behind the disclosure");

  // The word "estimated" is on every part of the answer, including the working.
  for (const id of [INTAKE_IDS.headline, INTAKE_IDS.recoverable]) {
    assert.match(textOf(byId(document, id)), /Estimated/);
  }
  assert.equal(byId(document, INTAKE_IDS.answer).dataset.provenance, "estimated");
  assert.equal(byId(document, INTAKE_IDS.answer).dataset.tier, CONFIDENCE_TIER.modelled);
  assert.match(textOf(byId(document, "finops-first-run-estimate-value")), /^Estimated · /);
  assert.match(textOf(byId(document, "finops-first-run-estimate-detail")), /Estimated from declared facts/);
});

test("the detail lives behind the disclosure this region already had, and only there", () => {
  const document = intakePage();
  applyDeclaredFactIntake(document, EXAMPLE_DECLARED_FACTS);
  // The intake adds no disclosure of its own: the working is the estimate's
  // details element, still shut, still the one idiom.
  assert.equal(byId(document, INTAKE_IDS.form).querySelectorAll("details").length, 0);
  assert.equal(byId(document, INTAKE_IDS.answer).querySelectorAll("details").length, 0);
  const working = byId(document, "finops-first-run-estimate-source");
  assert.equal(working.tagName.toLowerCase(), "details");
  assert.notEqual(working.open, true, "the working must ship shut");
  assert.equal(working.dataset.disclosure, "collapsed");
  // The echoed inputs are inside it, repainted from the submitted facts.
  const inputs = byId(document, "finops-first-run-estimate-source-detail");
  assert.match(textOf(inputs), /Inputs used/);
  assert.match(textOf(inputs), /\$154,500 declared monthly AI spend/);
});

// --- revise, and clear ------------------------------------------------------

test("changing one answer re-answers the headline in place, with no navigation", () => {
  const document = intakePage();
  const before = headlineOf(document);
  typeInto(document, INTAKE_IDS.spend, "480000");
  const after = headlineOf(document);
  assert.notEqual(after, before, "the headline did not follow the revised answer");
  assert.equal(after, intakeHeadline(estimateFromDeclaredFacts({
    ...EXAMPLE_DECLARED_FACTS, monthlySpendUsd: 480_000,
  })));

  // A select revised with the arrow keys re-answers on the same path.
  byId(document, INTAKE_IDS.industry).focus();
  pressKey(document, "ArrowDown");
  assert.equal(headlineOf(document), intakeHeadline(estimateFromDeclaredFacts({
    ...EXAMPLE_DECLARED_FACTS,
    monthlySpendUsd: 480_000,
    industry: PEER_INDUSTRY.financialServices,
  })));
});

test("clearing restores the exact bundled-example state, not a blank region", () => {
  const document = intakePage();
  const authored = {
    headline: headlineOf(document),
    recoverable: textOf(byId(document, INTAKE_IDS.recoverable)),
    action: textOf(byId(document, INTAKE_IDS.action)),
    value: textOf(byId(document, "finops-first-run-estimate-value")),
  };
  typeInto(document, INTAKE_IDS.spend, "980000");
  typeInto(document, INTAKE_IDS.engineers, "4000");
  assert.notEqual(headlineOf(document), authored.headline);

  resetDeclaredFactIntake(document);

  assert.equal(headlineOf(document), authored.headline);
  assert.equal(textOf(byId(document, INTAKE_IDS.recoverable)), authored.recoverable);
  assert.equal(textOf(byId(document, INTAKE_IDS.action)), authored.action);
  assert.equal(textOf(byId(document, "finops-first-run-estimate-value")), authored.value,
    "the estimate above the intake must return with it");
  // The controls come back too, so the next revision starts where a visitor did.
  assert.deepEqual(declaredFactsFromControls(document), {
    monthlySpendUsd: EXAMPLE_DECLARED_FACTS.monthlySpendUsd,
    engineers: EXAMPLE_DECLARED_FACTS.engineers,
    providerMix: MIX_CHOICES[0].mix,
    sizeBand: EXAMPLE_DECLARED_FACTS.sizeBand,
    industry: EXAMPLE_DECLARED_FACTS.industry,
  });
  assert.deepEqual(currentDeclaredFacts(), EXAMPLE_DECLARED_FACTS);
});

test("a repaint of the region cannot revert the estimate under a visitor's own answer", () => {
  const document = intakePage();
  const facts = { ...EXAMPLE_DECLARED_FACTS, monthlySpendUsd: 42_000, engineers: 300 };
  applyDeclaredFactIntake(document, facts);
  const painted = textOf(byId(document, "finops-first-run-estimate-value"));
  // What the bundled example's own repaint does, with no argument: it now reads
  // the facts the region is estimating from rather than resetting to the sample.
  assert.deepEqual(currentDeclaredFacts(), facts);
  assert.equal(painted,
    textOf(byId(document, "finops-first-run-estimate-value")));
  assert.equal(headlineOf(document), intakeHeadline(estimateFromDeclaredFacts(facts)));
});

// --- untrusted answers ------------------------------------------------------

test("a value outside the published list is dropped, and the answer says what that cost", () => {
  const document = intakePage();
  // The harness's select accepts anything, and so does a browser being driven
  // by something other than a person. The validation that matters is in code.
  byId(document, INTAKE_IDS.size).value = "enormous";
  byId(document, INTAKE_IDS.industry).value = "<img src=x>";
  byId(document, INTAKE_IDS.mix).value = "unlisted";
  const estimate = applyDeclaredFactIntakeFromControls(document);

  const read = declaredFactsFromControls(document);
  assert.equal(read.sizeBand, undefined, "an unpublished size band was read as a fact");
  assert.equal(read.industry, undefined, "an unpublished industry was read as a fact");
  assert.equal(read.providerMix, undefined, "an unlisted mix was read as a fact");
  assert.equal(estimate.confidence.tier, CONFIDENCE_TIER.directional,
    "dropping declared facts must cost confidence rather than pass silently");
  assert.equal(estimate.quartile.available, false);
  assert.equal(intakeNextAction(estimate), NEXT_ACTION.noCohort,
    "with no cohort the one action is to declare what is missing");
  // Nothing a visitor typed reaches the page.
  const region = textOf(byId(document, "finops-first-run"));
  assert.ok(!region.includes("<img"), "a declared string reached the rendered region");
  assert.equal(byId(document, INTAKE_IDS.answer).querySelectorAll("img").length, 0);
});

test("an empty or unreadable number withholds the figure instead of guessing at zero", () => {
  const document = intakePage();
  replaceValue(document, INTAKE_IDS.spend).dispatchEvent(new DomEvent("input", { bubbles: true }));
  const estimate = applyDeclaredFactIntakeFromControls(document);
  assert.equal(estimate.confidence.tier, CONFIDENCE_TIER.insufficient);
  assert.equal(headlineOf(document), intakeHeadline(estimate));
  assert.match(headlineOf(document), /^Estimated: no position yet\./);
  assert.equal(textOf(byId(document, INTAKE_IDS.action)), NEXT_ACTION.noFigure);
  assert.equal(readDeclaredFacts({ monthlySpendUsd: "  ", engineers: "abc" }).monthlySpendUsd,
    undefined);
  assert.equal(readDeclaredFacts({ engineers: "abc" }).engineers, undefined);
});

// --- nothing leaves the browser ---------------------------------------------

test("the form navigates nowhere and the intake writes to no network or storage", () => {
  const document = intakePage();
  const form = byId(document, INTAKE_IDS.form);
  assert.equal(form.getAttribute("action"), null, "a form action would navigate on submit");
  assert.equal(form.getAttribute("method"), null);
  assert.equal(byId(document, INTAKE_IDS.submit).getAttribute("type"), "submit");
  assert.equal(byId(document, INTAKE_IDS.clear).getAttribute("type"), "button",
    "the clear control must not submit the form it sits in");

  // Drive a real submit with everything that could carry a fact off this page
  // instrumented, and with the default counted.
  const writes = [];
  const spy = (label) => new Proxy({}, {
    get: (_target, key) => (...args) => writes.push(`${label}.${String(key)}(${args.join(",")})`),
  });
  const restore = {};
  for (const [key, value] of Object.entries({
    fetch: (...args) => { writes.push(`fetch(${args[0]})`); },
    localStorage: spy("localStorage"),
    sessionStorage: spy("sessionStorage"),
    XMLHttpRequest: function XHR() { writes.push("xhr"); },
    navigator: { sendBeacon: (...args) => writes.push(`beacon(${args[0]})`) },
  })) {
    restore[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key,
      { value, writable: true, configurable: true, enumerable: false });
  }
  try {
    typeInto(document, INTAKE_IDS.spend, "260000");
    const event = new DomEvent("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true, "the submit must be prevented, not navigated");
    assert.deepEqual(writes, [], `the intake wrote a declared fact out of the browser: ${writes}`);
  } finally {
    for (const [key, descriptor] of Object.entries(restore)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
  assert.equal(headlineOf(document), intakeHeadline(estimateFromDeclaredFacts({
    ...EXAMPLE_DECLARED_FACTS, monthlySpendUsd: 260_000,
  })));
});

test("the intake reuses the estimator rather than reimplementing any of it", async () => {
  for (const name of ["finops-declared-fact-intake.js", "finops-declared-fact-intake-view.js"]) {
    const source = await readFile(new URL(`../src/${name}`, import.meta.url), "utf8");
    for (const forbidden of [/\bfetch\s*\(/, /localStorage/, /sessionStorage/, /document\.cookie/,
      /innerHTML/, /sendBeacon/]) {
      assert.doesNotMatch(source, forbidden, `${name} reaches for ${forbidden}`);
    }
    // The estimator's own weights and boundaries appear nowhere here: no task
    // rate, no success rate, no recoverable share, no quartile threshold.
    for (const constant of ["TASKS_ATTEMPTED_PER_ENGINEER_MONTH", "PROVIDER_TIER_SUCCESS_RATE",
      "RECOVERABLE_SHARE_BAND", "p25", "p75"]) {
      assert.ok(!source.includes(constant), `${name} holds a second copy of ${constant}`);
    }
  }
});
