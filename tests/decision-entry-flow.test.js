// The decision-entry workflow on the history view, driven the way a person
// drives it: the shipped markup from src/index.html, booted through
// initDecisionLog, operated by focus and keystrokes.
//
// Every assertion is something a visitor can perceive — a visible message, a
// marked control, where focus went, which rows are listed, what reached storage.
// No module state is read and no internal helper produces an expectation.
//
// Determinism: no network (the harness throws on an undeclared request), no
// sleeps, no clock thresholds. Each test parses a fresh page with its own
// storage, so order never matters.

import test from "node:test";
import assert from "node:assert/strict";
import { STORAGE_KEY, initDecisionLog } from "../src/app.js";
import { DECISION_ENTRY_ERRORS } from "../src/decision-entry.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import {
  DomEvent,
  loadPage,
  pressEnter,
  pressKey,
  pressTab,
  tabSequence,
  textOf,
  typeText,
} from "./support/browser.js";

const DECISIONS_PAGE = new URL("../src/index.html", import.meta.url);
// The examples are a module constant, so a test that wants a history holding
// only its own records hands the page an empty seed rather than stubbing a fetch.
const NO_DEMO_DATA = { decisions: [], releases: [] };

const ENTRY = {
  title: "Adopt a durable job queue",
  context: "Background work was lost on deploys; move to an at-least-once queue.",
  alternatives: "Database polling and in-process retries.",
  owner: "Tess",
  status: "accepted",
};

const REQUIRED_TEXT_FIELDS = ["title", "context", "alternatives", "owner"];

async function openHistory(t, { decisions = [], releases = [] } = {}) {
  const page = await loadPage(DECISIONS_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(decisions),
      [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
    },
  });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage, {
    seed: NO_DEMO_DATA,
    location: { pathname: "/", search: "", hash: "" },
    history: { replaceState() {} },
  });
  assert.equal(page.document.documentElement.dataset.shiplog, "ready", "the history never rendered");
  return page;
}

const byId = (page, id) => {
  const node = page.document.querySelector(`#${id}`);
  assert.ok(node, `the recorder has no #${id}`);
  return node;
};
const fieldError = (page, field) => byId(page, `${field}-error`);
const rowTitles = (page) => byId(page, "decision-list")
  .querySelectorAll(".history-card").map((card) => textOf(card.querySelector("h3")));
const stored = (page) => JSON.parse(page.storage.getItem(STORAGE_KEY) ?? "[]");
const submitButton = (page) => byId(page, "decision-form").querySelector('button[type="submit"]');

// Filling a field the way a user does: focus it, then type. Never by assigning
// `.value`, so the page sees the same `input` events a keyboard produces.
function fill(page, values) {
  for (const [field, value] of Object.entries(values)) {
    const control = byId(page, field);
    if (control.tagName === "SELECT") {
      control.value = value;
      continue;
    }
    control.focus();
    typeText(page.document, value);
  }
}

// The fields that are currently reporting a failure, in document order, as the
// visitor sees them: a visible paragraph with text in it.
function shownErrors(page) {
  return ["title", "context", "alternatives", "owner", "status"]
    .filter((field) => fieldError(page, field).hidden === false)
    .map((field) => ({ field, message: textOf(fieldError(page, field)) }));
}

test("a complete entry is recorded, listed immediately, and reported once", async (t) => {
  const page = await openHistory(t);

  fill(page, ENTRY);
  submitButton(page).click();

  assert.deepEqual(rowTitles(page), [ENTRY.title], "the recorded decision is not in the history");
  assert.deepEqual(shownErrors(page), [], "a successful entry left an error on a field");
  assert.equal(byId(page, "decision-form-error").hidden, true, "the failure count survived a success");
  assert.equal(
    textOf(byId(page, "decision-record-status")),
    "Recorded “Adopt a durable job queue” as accepted. It is in the history below.",
    "the recorder did not say what it just did",
  );

  const [record] = stored(page);
  assert.equal(record.title, ENTRY.title, "the record did not reach this browser's storage");
  assert.equal(record.alternatives, ENTRY.alternatives);
  assert.equal(record.status, "accepted");

  // The form is empty and focused, ready for the next one.
  assert.equal(byId(page, "title").value, "", "the form kept the entry it just recorded");
  assert.equal(page.document.activeElement, byId(page, "title"), "focus did not return to the form");
});

test("an empty submit reports every field at once, writes nothing, and focuses the first", async (t) => {
  const page = await openHistory(t);

  submitButton(page).click();

  assert.deepEqual(
    shownErrors(page).map(({ field }) => field),
    REQUIRED_TEXT_FIELDS,
    "an empty submit must report every unanswered field, not the first one only",
  );
  for (const field of REQUIRED_TEXT_FIELDS) {
    assert.equal(
      textOf(fieldError(page, field)),
      DECISION_ENTRY_ERRORS[field].missing,
      `the ${field} field reports the wrong message`,
    );
    assert.equal(
      byId(page, field).getAttribute("aria-invalid"),
      "true",
      `the ${field} control is not marked invalid`,
    );
    assert.equal(
      fieldError(page, field).getAttribute("role"),
      "alert",
      `the ${field} message is not announced`,
    );
    // The message is part of the field's description, so it is read with the
    // control rather than only seen next to it.
    assert.match(
      byId(page, field).getAttribute("aria-describedby") ?? "",
      new RegExp(`\\b${field}-error\\b`),
      `the ${field} control does not name its own error`,
    );
  }

  const summary = byId(page, "decision-form-error");
  assert.equal(summary.hidden, false, "the form-level count is not shown");
  assert.match(textOf(summary), /^4 fields/, "the form-level count is wrong");
  assert.equal(summary.getAttribute("role"), "alert");

  assert.equal(page.document.activeElement, byId(page, "title"), "focus did not land on the first failure");
  assert.deepEqual(stored(page), [], "a refused entry reached storage");
  assert.deepEqual(rowTitles(page), [], "a refused entry reached the history");
  assert.equal(textOf(byId(page, "decision-record-status")), "", "a refused entry was reported as recorded");
});

test("a message clears when its own field is answered, and the count follows", async (t) => {
  const page = await openHistory(t);
  submitButton(page).click();

  fill(page, { title: ENTRY.title });

  assert.equal(fieldError(page, "title").hidden, true, "the message outlived the problem");
  assert.equal(textOf(fieldError(page, "title")), "", "the cleared message is still in the accessible description");
  assert.equal(byId(page, "title").hasAttribute("aria-invalid"), false, "the control is still marked invalid");
  assert.deepEqual(
    shownErrors(page).map(({ field }) => field),
    ["context", "alternatives", "owner"],
    "answering one field cleared another field's message",
  );
  assert.match(
    textOf(byId(page, "decision-form-error")),
    /^3 fields/,
    "the form-level count did not follow the field that was answered",
  );

  // Answering the rest empties the summary rather than leaving a stale count.
  fill(page, { context: ENTRY.context, alternatives: ENTRY.alternatives, owner: ENTRY.owner });
  assert.deepEqual(shownErrors(page), []);
  assert.equal(byId(page, "decision-form-error").hidden, true, "the count survived the last fix");
});

test("alternatives is required, and the message names a way to answer it", async (t) => {
  const page = await openHistory(t);
  const { alternatives, ...withoutAlternatives } = ENTRY;

  fill(page, withoutAlternatives);
  submitButton(page).click();

  assert.deepEqual(
    shownErrors(page).map(({ field }) => field),
    ["alternatives"],
    "a decision with no alternatives was recorded, or the wrong field was blamed",
  );
  assert.match(textOf(fieldError(page, "alternatives")), /None considered/);
  assert.equal(page.document.activeElement, byId(page, "alternatives"), "focus is not on the one field to fix");
  assert.deepEqual(stored(page), []);
  // The hint said what to write when nothing else was weighed; writing it works.
  assert.match(textOf(byId(page, "alternatives-hint")), /None considered/);

  fill(page, { alternatives: "None considered" });
  submitButton(page).click();
  assert.deepEqual(rowTitles(page), [ENTRY.title]);
  assert.equal(stored(page)[0].alternatives, "None considered");
});

test("an over-long paste is refused inline instead of throwing", async (t) => {
  const page = await openHistory(t);

  // maxlength stops typing but not a scripted or pasted value, and the record
  // validator throws on one. The recorder has to answer for it in words.
  fill(page, ENTRY);
  byId(page, "context").value = "x".repeat(1001);
  submitButton(page).click();

  assert.deepEqual(shownErrors(page).map(({ field }) => field), ["context"]);
  assert.equal(textOf(fieldError(page, "context")), DECISION_ENTRY_ERRORS.context.tooLong);
  assert.deepEqual(stored(page), [], "an over-long entry reached storage");
});

test("a recorded value is rendered as text everywhere, never as markup", async (t) => {
  const page = await openHistory(t);
  const hostile = '<img src=x onerror="alert(1)">Queue';

  fill(page, { ...ENTRY, title: hostile });
  submitButton(page).click();

  // The row: the title is one piece of text, and no element came out of it.
  assert.deepEqual(rowTitles(page), [hostile], "the recorded title was not rendered verbatim as text");
  assert.equal(
    byId(page, "decision-list").querySelectorAll("img").length,
    0,
    "a recorded title produced an element",
  );
  // The status line interpolates the title, so it is the other place a stored
  // value could have reached markup.
  const status = byId(page, "decision-record-status");
  assert.ok(textOf(status).includes(hostile), "the status line did not quote the title");
  assert.equal(status.childElements.length, 0, "the status line built elements out of a stored value");
});

test("the whole entry works with the keyboard alone, failures included", async (t) => {
  const page = await openHistory(t);
  const { document } = page;

  // Tab to the submit button and press it with nothing filled in: the failure
  // has to be reachable and fixable without a pointer, so focus must move to
  // the first unanswered field.
  const stops = tabSequence(document).length + 1;
  for (let step = 0; step < stops && document.activeElement !== submitButton(page); step += 1) {
    pressTab(document);
  }
  assert.equal(document.activeElement, submitButton(page), "the record button is not reachable by keyboard");
  pressEnter(document);
  assert.equal(document.activeElement, byId(page, "title"), "a keyboard submit left focus on the button");
  assert.match(textOf(byId(page, "decision-form-error")), /^4 fields/);

  // Now answer it from where focus already is, tabbing forward through the form.
  typeText(document, ENTRY.title);
  pressTab(document);
  assert.equal(document.activeElement, byId(page, "context"), "Tab does not reach the context field");
  typeText(document, ENTRY.context);
  pressTab(document);
  assert.equal(document.activeElement, byId(page, "alternatives"), "Tab does not reach the alternatives field");
  typeText(document, ENTRY.alternatives);
  pressTab(document);
  assert.equal(document.activeElement, byId(page, "owner"), "Tab does not reach the owner field");
  typeText(document, ENTRY.owner);
  pressTab(document);
  assert.equal(document.activeElement, byId(page, "status"), "Tab does not reach the status control");
  pressKey(document, "ArrowDown");
  assert.equal(document.activeElement.value, "accepted", "the status cannot be set with the arrow keys");

  // Every message cleared as its field was answered, so nothing false is left.
  assert.deepEqual(shownErrors(page), []);
  assert.equal(byId(page, "decision-form-error").hidden, true);

  // Implicit submission from a text field, the way Enter works in a form.
  byId(page, "owner").focus();
  pressEnter(document);
  assert.deepEqual(rowTitles(page), [ENTRY.title], "the keyboard-recorded decision is not in the history");
  assert.equal(stored(page).length, 1);
});

test("a decision that could not be saved is not announced as recorded", async (t) => {
  const page = await openHistory(t);
  // A full or disabled store. The decision still shows for this session — that
  // behaviour is unchanged — but the recorder must not claim it was kept.
  page.storage.setItem = () => { throw new Error("QuotaExceededError"); };

  fill(page, ENTRY);
  submitButton(page).click();

  assert.deepEqual(rowTitles(page), [ENTRY.title], "the decision was dropped instead of shown for the session");
  const notice = byId(page, "storage-notice");
  assert.equal(notice.hidden, false, "the failed save was silent");
  assert.match(textOf(notice), /could not be saved in this browser/);
  assert.equal(
    textOf(byId(page, "decision-record-status")),
    "",
    "an unsaved decision was announced as recorded, contradicting the notice",
  );
});

test("a record the active filters hide is reported as hidden, not as listed", async (t) => {
  const page = await openHistory(t);

  // The visitor is looking at accepted decisions only; the next thing they
  // record is pending. Nothing resets their filter, so the row is not on screen.
  const filter = byId(page, "filter-status");
  filter.value = "accepted";
  filter.dispatchEvent(new DomEvent("change", { bubbles: true }));

  fill(page, { ...ENTRY, status: "pending" });
  submitButton(page).click();

  assert.deepEqual(rowTitles(page), [], "the filter stopped applying after a record was written");
  assert.match(
    textOf(byId(page, "decision-record-status")),
    /clear the filters to see it/,
    "the recorder claimed a filtered-away record was in the history",
  );
  assert.equal(stored(page).length, 1, "the record was not written");
});
