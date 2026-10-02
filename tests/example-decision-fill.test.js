// Step one of the four-step demo, without inventing a record (#2725).
//
// The home page displays one example decision above its log and then asks a
// visitor evaluating Shiplog to think of a decision of their own, write its
// context and its alternatives, and type all of it in before step two — the
// release link — can be tried at all. The control under test loads the example
// the page is already showing into the recorder's five fields, so step two is
// one press away.
//
// WHAT IS PINNED HERE, and why each one is a contract and not a detail:
//
//   • ONE SOURCE OF TRUTH. The values written into the fields and the values
//     the page displays as its example are the same seed record. The drift
//     guard below reads the shipped markup and the module and compares them, so
//     a copy edit to the shown example that forgets the fill fails here rather
//     than shipping a button that types text nobody can see on the page.
//   • IT FILLS AND NOTHING ELSE. Nothing is recorded, the form is not
//     submitted, the history does not move, and every field is left as
//     editable, clearable and overwritable as one somebody typed.
//   • THE RECORD IS ACCEPTED. Pressing Record decision with exactly the filled
//     values passes the recorder's own validation, advances the tracker to step
//     two, and replaces the "Nothing is recorded in this browser yet" line. A
//     control that produces a record the form then refuses is worse than none.
//   • THE CAVEAT SURVIVES. The example records are invented and use no customer
//     or production data, and filling the form neither adds nor removes an
//     occurrence of that sentence.
//
// Driven the way a visitor drives it: the shipped markup from src/index.html,
// booted through initDecisionLog, read back as text and attributes a person can
// perceive. The seeded examples are left in place, because that is what ships.
//
// Determinism: no network, no clock, no sleeps. Each test parses its own page
// with its own storage, so order never matters.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STORAGE_KEY, initDecisionLog } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import {
  DECISION_ENTRY_FIELDS,
  DECISION_ENTRY_STATUSES,
  validateDecisionEntry,
} from "../src/decision-entry.js";
import { SAMPLE_DECISION_ID, SEED_DECISIONS, exampleDecisionFormValues } from "../src/seed-records.js";
import {
  DEMO_PROGRESS_EMPTY_LEAD,
  DEMO_PROGRESS_STATUS,
  DEMO_PROGRESS_STEPS,
} from "../src/demo-progress.js";
import {
  DomEvent,
  loadPage,
  parseHtml,
  pressEnter,
  pressTab,
  tabSequence,
  textOf,
  typeText,
} from "./support/browser.js";

const HOME = new URL("../src/index.html", import.meta.url);

const FILL_ID = "fill-example-decision";
const FILL_LABEL = "Fill this form with the example decision";
const CAVEAT = "no customer or production data";

async function openHome(t, { decisions = [], releases = [] } = {}) {
  const page = await loadPage(HOME, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(decisions),
      [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
    },
  });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage, {
    location: { pathname: "/", search: "", hash: "" },
    history: { replaceState() {} },
  });
  assert.equal(page.document.documentElement.dataset.shiplog, "ready", "the page never rendered");
  return page;
}

const byId = (page, id) => {
  const node = page.document.querySelector(`#${id}`);
  assert.ok(node, `the home page has no #${id}`);
  return node;
};
const fillControl = (page) => byId(page, FILL_ID);
const submitButton = (page) => byId(page, "decision-form").querySelector('button[type="submit"]');
const fieldValues = (page) =>
  Object.fromEntries(DECISION_ENTRY_FIELDS.map((field) => [field, byId(page, field).value]));
const stored = (page) => JSON.parse(page.storage.getItem(STORAGE_KEY) ?? "[]");
const statuses = (page) => byId(page, "evaluation-path-steps")
  .querySelectorAll("li")
  .map((item) => textOf(item.querySelector(".evaluation-path-status")));
const currentSteps = (page) => byId(page, "evaluation-path-steps")
  .querySelectorAll("li")
  .filter((item) => item.getAttribute("aria-current") === "step")
  .map((item) => textOf(item.querySelector(".evaluation-path-step")));
// Counted, never compared against null: asserting equality on a harness element
// walks the whole parsed page and takes minutes to say what a count says now.
const shownErrors = (page) => DECISION_ENTRY_FIELDS
  .filter((field) => byId(page, `${field}-error`).hidden !== true)
  .map((field) => field);
const occurrences = (text, needle) => text.split(needle).length - 1;

// --- one source of truth ----------------------------------------------------

test("the filled values are the seed record the page's example is drawn from", () => {
  const values = exampleDecisionFormValues();
  const seed = SEED_DECISIONS.find(({ id }) => id === SAMPLE_DECISION_ID);
  assert.ok(seed, "the home page's example decision fixture must exist");

  assert.deepEqual(values, {
    title: seed.title,
    context: seed.context,
    alternatives: seed.alternatives,
    owner: seed.owner,
    status: seed.status,
  });
  // Replaces is the one optional field, and the example replaces nothing: a
  // fill that named a target would claim a relationship this record has not got.
  assert.deepEqual(Object.keys(values).sort(), ["alternatives", "context", "owner", "status", "title"]);
  // A fresh object each press, so a handler that mutated what it wrote cannot
  // poison the next fill or the record list reading the same frozen seed.
  assert.notEqual(exampleDecisionFormValues(), values);
});

test("the example the page displays is the example the form is filled with", async () => {
  // THE DRIFT GUARD. The shown example is authored markup and the filled text
  // comes from the module; this is what holds the two to one record. A copy edit
  // to either one that forgets the other fails here.
  const markup = await readFile(HOME, "utf8");
  const proof = markup.slice(markup.indexOf('id="featured-decision"'));
  const values = exampleDecisionFormValues();
  const capitalised = `${values.status[0].toUpperCase()}${values.status.slice(1)}`;

  const document = parseHtml(proof.slice(0, proof.indexOf("</article>")));
  const facts = document.querySelector(".hero-proof-facts").querySelectorAll("dd").map((dd) => textOf(dd));
  const reasoning = document.querySelector(".featured-decision-reasoning")
    .querySelectorAll("dd").map((dd) => textOf(dd));

  assert.equal(facts[0], `${values.title} · ${capitalised}`, "the displayed decision is not the filled one");
  assert.equal(facts[2], values.owner, "the displayed owner is not the filled one");
  assert.equal(reasoning[0], values.context, "the displayed context is not the filled one");
  assert.equal(reasoning[1], values.alternatives, "the displayed alternatives are not the filled ones");
});

test("the recorder accepts the filled values exactly as they are", () => {
  // A control that produces a record the form then refuses is worse than no
  // control, so the example text and the validator are held to each other.
  assert.deepEqual(
    validateDecisionEntry(exampleDecisionFormValues(), { statuses: DECISION_ENTRY_STATUSES }),
    [],
  );
});

// --- the control ------------------------------------------------------------

test("the control ships inside the form, next to Record decision, and never submits", async (t) => {
  const markup = await readFile(HOME, "utf8");
  const form = markup.slice(markup.indexOf('<form id="decision-form"'), markup.indexOf("</form>"));
  assert.ok(form.includes(`id="${FILL_ID}"`), "the fill control is not inside the decision form");
  // Against the submit button's own markup, not the words "Record decision":
  // the rationale comment above the control names it too.
  assert.ok(form.indexOf(`id="${FILL_ID}"`) < form.indexOf('<button type="submit">Record decision'),
    "the two presses are not offered in the order they are done");

  const page = await openHome(t);
  const control = fillControl(page);
  // The authored attribute, which is what keeps Enter in a text field going to
  // Record decision rather than to this button.
  assert.equal(control.getAttribute("type"), "button");
  assert.equal(textOf(control), FILL_LABEL);
  // The label says the fields receive the example; the sentence read with it
  // says the text stays editable and that nothing is recorded by this press.
  assert.equal(control.getAttribute("aria-describedby"), `${FILL_ID}-hint`);
  const hint = textOf(byId(page, `${FILL_ID}-hint`));
  assert.match(hint, /fields stay editable/);
  assert.match(hint, /nothing is recorded until you press “Record decision”/);
  // No focus trap and no second control: one press, one effect.
  assert.equal(byId(page, "decision-form").querySelectorAll("button").length, 3);
});

test("the control is reachable by Tab and fills from the keyboard alone", async (t) => {
  const page = await openHome(t);
  const target = fillControl(page);

  // Bounded by the page's own tab stops: pressTab restarts at stop zero, so a
  // fixed count would turn any control added elsewhere into a failure here.
  let reached = null;
  for (let press = 0; press < tabSequence(page.document).length && reached !== target; press += 1) {
    reached = pressTab(page.document);
  }
  assert.ok(reached === target, "the fill control is not reachable by Tab");

  pressEnter(page.document);
  assert.deepEqual(fieldValues(page), exampleDecisionFormValues());
  // Focus lands on the top of the filled form, which is the only announcement a
  // screen reader gets that the press landed: the Title field, read back with
  // the example text in it.
  assert.equal(page.document.activeElement.id, "title");
});

// --- fill only --------------------------------------------------------------

test("filling writes the five fields and records nothing", async (t) => {
  const page = await openHome(t);
  assert.deepEqual(stored(page), [], "the test started with something already recorded");
  const before = textOf(byId(page, "decision-count"));

  fillControl(page).click();

  assert.deepEqual(fieldValues(page), exampleDecisionFormValues());
  // Nothing written, nothing announced, nothing moved.
  assert.deepEqual(stored(page), [], "the fill wrote a record");
  assert.equal(textOf(byId(page, "decision-record-status")), "", "the fill claimed a record was kept");
  assert.equal(textOf(byId(page, "decision-count")), before, "the fill changed the history count");
  assert.deepEqual(shownErrors(page), [], "the fill validated the form it had just filled");
  assert.equal(byId(page, "decision-form-error").hidden, true);

  // The tracker still says step one, because step one is a record and the fill
  // is not one.
  assert.deepEqual(currentSteps(page), [DEMO_PROGRESS_STEPS[0]]);
  assert.equal(statuses(page)[0], `Step 1 of 4 · ${DEMO_PROGRESS_STATUS.current}`);
  assert.equal(textOf(byId(page, "evaluation-path-next-lead")), DEMO_PROGRESS_EMPTY_LEAD);
});

test("every filled field stays editable, clearable and overwritable by hand", async (t) => {
  const page = await openHome(t);
  fillControl(page).click();

  for (const field of DECISION_ENTRY_FIELDS) {
    const control = byId(page, field);
    // The harness reflects no script-set property into an attribute, so the
    // state a fill could have left behind is asserted on the properties the
    // controls actually carry.
    assert.notEqual(control.readOnly, true, `${field} was left read-only`);
    assert.notEqual(control.disabled, true, `${field} was left disabled`);
    assert.equal(control.getAttribute("readonly"), null, `${field} was left read-only`);
    assert.equal(control.getAttribute("disabled"), null, `${field} was left disabled`);
  }

  // Overwrite the title by hand, the way a visitor who wants their own record does.
  const title = byId(page, "title");
  title.focus();
  title.value = "";
  typeText(page.document, "Adopt a durable job queue, with our own words");
  assert.equal(byId(page, "title").value, "Adopt a durable job queue, with our own words");

  // And clear one: the form refuses the entry, which is how we know the field is
  // genuinely empty rather than merely displayed as empty.
  const owner = byId(page, "owner");
  owner.focus();
  owner.value = "";
  owner.dispatchEvent(new DomEvent("input", { bubbles: true }));
  submitButton(page).click();
  assert.deepEqual(shownErrors(page), ["owner"]);
  assert.deepEqual(stored(page), [], "a cleared field was recorded anyway");

  // Pressing fill again restores the example over the visitor's edits, so the
  // control is as repeatable as it looks.
  fillControl(page).click();
  assert.deepEqual(fieldValues(page), exampleDecisionFormValues());
  assert.deepEqual(shownErrors(page), [], "the fill left a message beside a field it had just answered");
});

// --- and then step two ------------------------------------------------------

test("fill, then Record decision, and the tracker is on step two", async (t) => {
  const page = await openHome(t);

  fillControl(page).click();
  submitButton(page).click();

  // The record landed, and it is the example.
  const records = stored(page);
  assert.equal(records.length, 1, "the filled entry was refused by the form that filled it");
  const { title, context, alternatives, owner, status } = records[0];
  assert.deepEqual({ title, context, alternatives, owner, status }, exampleDecisionFormValues());
  assert.deepEqual(shownErrors(page), []);

  // Step one is done and step two is the thing to do.
  assert.equal(statuses(page)[0], `Step 1 of 4 · ${DEMO_PROGRESS_STATUS.done}`);
  assert.equal(statuses(page)[1], `Step 2 of 4 · ${DEMO_PROGRESS_STATUS.current}`);
  assert.deepEqual(currentSteps(page), [DEMO_PROGRESS_STEPS[1]]);

  // The "nothing recorded" line is gone, replaced by one that names the record
  // and offers the one next action.
  const lead = textOf(byId(page, "evaluation-path-next-lead"));
  assert.notEqual(lead, DEMO_PROGRESS_EMPTY_LEAD, "the empty-state lead survived the record");
  assert.doesNotMatch(lead, /Nothing is recorded in this browser yet/);
  assert.equal(byId(page, "evaluation-path-next").querySelectorAll("a").length, 1);
  assert.match(
    byId(page, "evaluation-path-action").getAttribute("href"),
    new RegExp(`^/releases\\.html\\?link=${records[0].id}#record-release$`),
  );
  assert.match(textOf(byId(page, "decision-record-status")), /^Recorded “Adopt a durable job queue” as accepted\./);
});

// --- the caveat -------------------------------------------------------------

test("filling the form neither adds nor removes the invented-records caveat", async (t) => {
  const page = await openHome(t);
  const main = () => textOf(page.document.querySelector("main"));
  const before = occurrences(main(), CAVEAT);
  assert.ok(before > 0, "the page stopped saying the example records use no customer or production data");

  fillControl(page).click();
  assert.equal(occurrences(main(), CAVEAT), before,
    "the fill changed how often the page says the example records use no customer or production data");

  // And after the record, which is the state criterion five is about.
  submitButton(page).click();
  assert.equal(occurrences(main(), CAVEAT), before,
    "recording the filled example changed how often the caveat is stated");
  // The field values are the visitor's own text, not document text, so the
  // caveat cannot ride into the page through them in the first place.
  const filled = Object.values(exampleDecisionFormValues()).join(" ");
  assert.equal(occurrences(filled, CAVEAT), 0);
});

// --- the standing errors it clears ------------------------------------------

test("a fill after a refused submit clears the messages it has just answered", async (t) => {
  const page = await openHome(t);

  // Every required field empty: the recorder refuses and reports all of them.
  submitButton(page).click();
  assert.deepEqual(shownErrors(page), ["title", "context", "alternatives", "owner"]);
  assert.match(textOf(byId(page, "decision-form-error")), /^Title is blocking this save\./);

  fillControl(page).click();
  assert.deepEqual(shownErrors(page), [], "a message was left beside a field the fill answered");
  assert.equal(byId(page, "decision-form-error").hidden, true);
  assert.equal(textOf(byId(page, "decision-form-error")), "");
  for (const field of DECISION_ENTRY_FIELDS) {
    assert.equal(byId(page, field).getAttribute("aria-invalid"), null,
      `${field} is still described as invalid after being filled`);
  }
});
