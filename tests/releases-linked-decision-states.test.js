// Issue #2457, the half of it that was not already shipped: the Releases page's
// LINKED-DECISIONS control drawing loading, empty and failed as three distinct
// states, and the release log's filtered-empty sentence naming the filter that
// emptied it.
//
// What this file exists to catch. `loadDecisions()` swallows a store that
// refuses the read and returns an empty array, so the picker drew a failure as
// "No decisions to link yet." — a first-run sentence, under a link offering to
// record a decision into a log that could not be read. The four states of the
// release log itself (loading, empty, no-match, failed) already shipped and are
// held in tests/releases-list-states.test.js; only their filtered-empty wording
// is touched here.
//
// Determinism: no network and no timers. Every test seeds its own storage and
// drives the refusal through a double, so "the decision log is unreadable" is a
// condition the test sets rather than a state it waits for.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STORAGE_KEY, readDecisions } from "../src/app.js";
import { RELEASE_STORAGE_KEY, releaseFilterSummary, releaseListStateCopy } from "../src/releases.js";
import {
  DECISION_PICKER_FAILED_BODY,
  DECISION_PICKER_FAILED_STATUS_TEXT,
  DECISION_PICKER_FAILED_TEXT,
  DECISION_PICKER_LOADING_STATUS_TEXT,
  DECISION_PICKER_LOADING_TEXT,
  DECISION_PICKER_RETRYING_BODY,
  DECISION_PICKER_RETRY_LABEL,
} from "../src/release-form.js";
import { initReleasesPage } from "../src/releases-page.js";
import { DomEvent, loadPage, tabSequence, textOf, typeText } from "./support/browser.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const NO_SEED = { decisions: [], releases: [] };

const DECISION = {
  id: "d-queue",
  title: "Adopt a durable queue",
  context: "Retries were lost on restart.",
  owner: "Kai",
  status: "accepted",
  createdAt: "2026-01-02T09:00:00.000Z",
};
const STORED = [
  { id: "r-one", version: "v1.0.0", title: "First", description: "One.", owner: "Kai", status: "completed", createdAt: "2026-02-01T00:00:00.000Z", decisionIds: [] },
  { id: "r-two", version: "v1.1.0", title: "Second", description: "Two.", owner: "Ari", status: "completed", createdAt: "2026-03-01T00:00:00.000Z", decisionIds: ["d-queue"] },
];

const byId = (page, id) => page.document.querySelector(`#${id}`);
const summaryNode = (page) => byId(page, "release-decisions-summary");
const summaryText = (page) => textOf(summaryNode(page));
const picker = (page) => byId(page, "release-decisions");
const retry = (page) => page.document.querySelector(".decision-picker-retry-action");
const count = (page, selector) => page.document.querySelectorAll(selector).length;
const activeId = (page) => page.document.activeElement?.getAttribute?.("id") ?? null;
const logBody = (page) => textOf(byId(page, "release-list-status").querySelector("p"));
const change = (control, value) => {
  control.value = value;
  control.dispatchEvent(new DomEvent("change", { bubbles: true }));
};

// `control.refuse` makes the decision key's read throw, as a blocked store does.
// Every read of that key is recorded together with what the control's live
// region was saying at that moment, so "the wait was announced before the read"
// is an observation rather than an inference from the settled state.
async function openPage(t, { refuse = false, decisions = [DECISION], releases = STORED } = {}) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(decisions),
      [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
    },
  });
  t.after(() => page.restore());
  const { getItem } = page.storage;
  const control = { refuse, heard: [] };
  page.storage.getItem = (key) => {
    if (key === STORAGE_KEY) {
      control.heard.push(summaryText(page));
      if (control.refuse) throw new Error("storage refused the decision read");
    }
    return getItem(key);
  };
  initReleasesPage(page.document, page.storage, { seed: NO_SEED });
  return { page, control };
}

// --- the read that makes the two states tellable apart ----------------------

test("the strict decision read throws on a refused store and tolerates a readable one", () => {
  const refusing = { getItem: () => { throw new Error("storage is blocked"); } };
  assert.throws(() => readDecisions(refusing), /storage is blocked/);

  // Read but unusable is not a failure: the same tolerance loadDecisions has.
  assert.deepEqual(readDecisions({ getItem: () => "not json" }), []);
  assert.deepEqual(readDecisions({ getItem: () => null }), []);
  assert.deepEqual(readDecisions({ getItem: () => JSON.stringify([DECISION]) }), [DECISION]);
});

// --- the linked-decisions control: three states, one at a time --------------

test("an unread decision log draws the failure, with its own words and no empty state", async (t) => {
  const { page } = await openPage(t, { refuse: true });

  // Exactly one of the three panels, and it is the failure.
  assert.equal(count(page, ".decision-picker-failed"), 1);
  assert.equal(count(page, ".decision-picker-loading"), 0);
  assert.equal(count(page, ".decision-picker-options"), 0, "the failure left options on screen");
  assert.equal(count(page, ".decision-picker-check"), 0, "a failed control still offered decisions to tick");

  const panel = page.document.querySelector(".decision-picker-failed");
  assert.equal(textOf(panel.querySelector(".decision-picker-empty-title")), DECISION_PICKER_FAILED_TEXT);
  assert.equal(textOf(panel.querySelector(".decision-picker-empty-title")), "Couldn’t load decisions to link");
  assert.equal(textOf(panel.querySelector(".decision-picker-failed-body")), DECISION_PICKER_FAILED_BODY);
  // The failure says the stored records are untouched, and does not blame the
  // reader for having recorded nothing.
  assert.match(textOf(panel), /Your saved decisions have not been changed/);
  assert.doesNotMatch(textOf(panel), /No decisions to link yet/);
  assert.doesNotMatch(textOf(panel), /storage refused the decision read/, "the raw exception reached the page");
});

test("an empty decision log keeps the first-run state, which never implies a failure", async (t) => {
  const { page } = await openPage(t, { decisions: [] });

  assert.equal(count(page, ".decision-picker-failed"), 0);
  assert.equal(count(page, ".decision-picker-loading"), 0);
  const empty = page.document.querySelector(".decision-picker-empty");
  assert.match(textOf(empty), /No decisions to link yet\./);
  assert.doesNotMatch(textOf(empty), /could not be read/);
  assert.doesNotMatch(textOf(empty), /Couldn’t/);
  assert.equal(summaryText(page), "No decisions are available to link yet.");
});

test("a readable decision log offers its decisions and disables nothing", async (t) => {
  const { page } = await openPage(t);

  assert.equal(count(page, ".decision-picker-failed"), 0);
  assert.equal(count(page, ".decision-picker-loading"), 0);
  assert.equal(count(page, ".decision-picker-check"), 1);
  assert.equal(picker(page).getAttribute("aria-disabled"), null);
});

test("the loading state ships in the markup and is the only wait the control states", async () => {
  const markup = await readFile(RELEASES_PAGE, "utf8");
  // One copy, so a reader is not told to wait twice, and it is the sentence the
  // module keeps using — the retrying panel reuses this exact string.
  assert.equal(markup.match(/Loading decisions to link…/g).length, 1);
  assert.match(markup, /class="decision-picker-empty decision-picker-loading" aria-hidden="true"/);
  assert.equal(DECISION_PICKER_LOADING_TEXT, "Loading decisions to link…");
  // The three states are three different sentences. None of them is a prefix
  // dressed up as another, so a reader can tell which one they are in.
  const settled = [DECISION_PICKER_LOADING_STATUS_TEXT, DECISION_PICKER_FAILED_STATUS_TEXT, "No decisions are available to link yet."];
  assert.equal(new Set(settled).size, 3);
});

// --- the choices are genuinely unavailable, not merely greyed ---------------

test("while the control is unavailable it renders no options and says so in the tree", async (t) => {
  const { page } = await openPage(t, { refuse: true });

  assert.equal(picker(page).getAttribute("aria-disabled"), "true");
  assert.equal(count(page, ".decision-picker-check"), 0);
  // Nothing to tick means nothing to submit: the selection is empty rather than
  // carrying a value a hidden control could still hold.
  assert.equal(count(page, ".decision-picker-option"), 0);

  // And the only focusable thing the control offers is the way out of the state.
  const stops = tabSequence(page.document).map((node) => node.className ?? "");
  const inside = stops.filter((className) => className.includes("decision-picker"));
  assert.deepEqual(inside, ["empty-action decision-picker-empty-action decision-picker-retry-action"]);
});

test("the control keeps its accessible name and a hint saying why it is unavailable", async (t) => {
  const { page } = await openPage(t, { refuse: true });

  // Named by the fieldset's own legend, which no state render can replace.
  const field = byId(page, "release-decisions-field");
  assert.equal(field.tagName, "FIELDSET");
  assert.match(textOf(field.querySelector("legend")), /^Linked decisions/);
  // And described by the hint and the live status line, in that order.
  assert.equal(field.getAttribute("aria-describedby"), "release-decisions-hint release-decisions-summary");
  assert.equal(summaryText(page), DECISION_PICKER_FAILED_STATUS_TEXT);
  assert.equal(summaryText(page), "No decisions can be linked: the decision log could not be read.");
});

// --- the live region ---------------------------------------------------------

test("the control's live region is polite, persists across every state change, and announces completion", async (t) => {
  const { page, control } = await openPage(t, { refuse: true });
  const node = summaryNode(page);
  assert.equal(node.getAttribute("role"), "status");
  assert.equal(node.getAttribute("aria-live"), "polite");
  assert.notEqual(node.getAttribute("aria-live"), "assertive");
  assert.equal(node.getAttribute("aria-atomic"), "true");
  assert.equal(textOf(node), DECISION_PICKER_FAILED_STATUS_TEXT);

  // The same node through failure, retry and recovery: a live region replaced
  // between states is a live region whose change is never announced.
  control.refuse = false;
  retry(page).click();
  assert.ok(summaryNode(page) === node, "the live region was replaced between states");
  // Completion, not progress: how many can now be linked.
  assert.equal(textOf(node), "No decisions linked yet. 1 available.");
});

test("the log's own live region is polite too, and is the one that announces the log", async (t) => {
  const { page } = await openPage(t);
  const log = byId(page, "release-list-status");
  assert.equal(log.getAttribute("aria-live"), "polite");
  assert.notEqual(log.getAttribute("aria-live"), "assertive");
  // Two regions, two subjects. Neither is nested in the other, so a single
  // change is never announced twice.
  assert.equal(count(page, "#release-list-status"), 1);
  assert.equal(count(page, "#release-decisions-summary"), 1);
});

// --- Retry -------------------------------------------------------------------

test("Retry is a real button in the tab order, and states the wait in place before re-reading", async (t) => {
  const { page, control } = await openPage(t, { refuse: true });
  const button = retry(page);

  assert.equal(button.tagName, "BUTTON");
  // The property, not the attribute: this harness reflects neither back.
  assert.equal(button.type, "button");
  assert.equal(textOf(button), DECISION_PICKER_RETRY_LABEL);
  assert.equal(button.getAttribute("aria-controls"), "release-decisions");
  assert.ok(tabSequence(page.document).includes(button), "Retry is not in the tab order");

  button.focus();
  control.heard.length = 0;
  button.click();

  // (b) the new attempt was announced before the read that answers it.
  assert.ok(control.heard.length > 0, "Retry did not re-read the decision log");
  assert.equal(control.heard[0], DECISION_PICKER_LOADING_STATUS_TEXT,
    "Retry re-read the log without announcing the attempt");
});

test("a retry that fails again keeps the same Retry under the reader's focus", async (t) => {
  const { page } = await openPage(t, { refuse: true });
  const button = retry(page);
  button.focus();
  button.click();

  assert.ok(retry(page) === button, "a failed retry replaced the button it was pressed on");
  assert.ok(page.document.activeElement === button, "a failed retry moved focus off Retry");
  assert.equal(summaryText(page), DECISION_PICKER_FAILED_STATUS_TEXT);
  assert.equal(count(page, ".decision-picker-failed"), 1);
  assert.equal(count(page, ".decision-picker-check"), 0);
});

test("a retry visibly switches the panel to its loading text while the read runs", async (t) => {
  const { page, control } = await openPage(t, { refuse: true });
  // Read what the panel is showing at the moment the log is read, which is the
  // one point at which the retrying state is on screen.
  const seen = [];
  const { getItem } = page.storage;
  page.storage.getItem = (key) => {
    if (key === STORAGE_KEY) {
      const panel = page.document.querySelector(".decision-picker-failed");
      seen.push([
        textOf(panel.querySelector(".decision-picker-empty-title")),
        textOf(panel.querySelector(".detail-state-chip")),
        textOf(panel.querySelector(".decision-picker-failed-body")),
      ]);
      if (control.refuse) throw new Error("storage refused the decision read");
    }
    return getItem(key);
  };

  retry(page).click();
  assert.deepEqual(seen[0], [DECISION_PICKER_LOADING_TEXT, "Retrying", DECISION_PICKER_RETRYING_BODY]);
  // And it is over once the attempt settles: the wait is not left standing.
  assert.equal(textOf(page.document.querySelector(".decision-picker-empty-title")), DECISION_PICKER_FAILED_TEXT);
});

test("a retry that loads hands the control back, with the decisions it recovered", async (t) => {
  const { page, control } = await openPage(t, { refuse: true });
  assert.equal(count(page, ".decision-picker-check"), 0);
  // The log's own filter never lost the decision it already knew about.
  assert.equal(count(page, "#release-decision"), 1);

  control.refuse = false;
  retry(page).click();

  assert.equal(count(page, ".decision-picker-failed"), 0, "the failure survived the retry that loaded");
  assert.equal(count(page, ".decision-picker-loading"), 0);
  assert.equal(count(page, ".decision-picker-check"), 1);
  assert.equal(picker(page).getAttribute("aria-disabled"), null);
  assert.equal(summaryText(page), "No decisions linked yet. 1 available.");
  // Focus lands on the first decision the control can now offer, which is what
  // the press was for, rather than on a button that no longer exists.
  assert.equal(activeId(page), "release-decision-0");
  // The filter's options are not doubled by the second fill.
  const options = [...byId(page, "release-decision").children].filter((child) => child.getAttribute);
  assert.equal(options.filter((option) => option.getAttribute("value") === "d-queue").length, 1);
});

test("a decision linked after a retry is accepted, not rejected against the list the failure left", async (t) => {
  const { page, control } = await openPage(t, { refuse: true });
  control.refuse = false;
  retry(page).click();

  const check = page.document.querySelector(".decision-picker-check");
  check.checked = true;
  check.dispatchEvent(new DomEvent("change", { bubbles: true }));

  const fill = (id, value) => { byId(page, id).focus(); typeText(page.document, value); };
  fill("release-version", "v2.0.0");
  fill("release-owner", "Priya");
  fill("release-released-on", "2026-07-02");
  fill("release-description", "The queue shipped.");
  page.document.querySelectorAll("button").find((node) => textOf(node) === "Record release").click();

  assert.equal(byId(page, "release-form-error").hidden, true, "the recorder rejected a decision the retry restored");
  assert.match(textOf(byId(page, "release-record-status")), /with 1 linked decision\./);
});

// --- chips -------------------------------------------------------------------

test("the control's state chips are filled washes carrying words, never colour alone", async (t) => {
  const { page, control } = await openPage(t, { refuse: true });
  const chip = page.document.querySelector(".detail-state-chip");
  assert.equal(textOf(chip), "Failed");
  assert.equal(chip.className, "detail-state-chip detail-state-chip-error");

  // The retrying wash is the other dynamic one, and it is also a word.
  control.refuse = true;
  retry(page).click();
  assert.equal(textOf(page.document.querySelector(".detail-state-chip")), "Failed");

  // Filled, per design-system/claude-design/review-08-foundations.html: a
  // dynamic signal takes a wash, a static classification takes an outline only.
  // Both classes already ship in styles.css; this state added none.
  const sheet = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const rule = (selector) => sheet.match(new RegExp(`(?:^|\\n)${selector.replace(/[.>]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  assert.match(rule(".detail-state-chip-error"), /background:#/);
  assert.match(rule(".detail-state-chip-missing"), /background:#/);
  assert.doesNotMatch(rule(".hero-profile>.eyebrow"), /background:/);
  assert.match(rule(".hero-profile>.eyebrow"), /border:1px solid/);
});

// --- the release log's filtered-empty sentence names the filter -------------

test("the filter summary names each narrowing in the reader's own terms", () => {
  const decisions = [DECISION];
  assert.equal(releaseFilterSummary({}, decisions), "");
  assert.equal(releaseFilterSummary({ query: "queue" }, decisions), "your search for “queue”");
  assert.equal(releaseFilterSummary({ status: "cancelled" }, decisions), "release status Cancelled");
  assert.equal(releaseFilterSummary({ decisionId: "d-queue" }, decisions), "the linked decision “Adopt a durable queue”");
  // A decision this log does not hold is still a filter a deep link can set.
  assert.equal(releaseFilterSummary({ decisionId: "d-gone" }, decisions), "the linked decision “d-gone”");
  assert.equal(releaseFilterSummary({ decisionStatus: "missing" }, decisions), "a linked decision this log does not hold");
  assert.equal(releaseFilterSummary({ decisionStatus: "accepted" }, decisions), "linked decision status Accepted");

  assert.equal(releaseFilterSummary({ query: "q", status: "planned" }, decisions),
    "your search for “q” and release status Planned");
  assert.equal(releaseFilterSummary({ query: "q", status: "planned", decisionStatus: "accepted" }, decisions),
    "your search for “q”, release status Planned and linked decision status Accepted");
});

test("the filtered-empty sentence names the filter; the first-run one implies no failure", () => {
  const [noMatchHeading, noMatchBody] = releaseListStateCopy("no-match", { filterSummary: "release status Cancelled" });
  assert.equal(noMatchHeading, "No releases match your search and filters");
  assert.equal(noMatchBody, "The log still holds releases; none of them matches release status Cancelled.");

  const [emptyHeading, emptyBody] = releaseListStateCopy("empty");
  assert.equal(emptyHeading, "No releases recorded yet");
  assert.equal(emptyBody, "Record a release, with or without linked decisions.");
  // The first-run state never reads as a failure, and never as a narrowed view.
  for (const words of [emptyHeading, emptyBody]) {
    assert.doesNotMatch(words, /could not|couldn’t|failed|error|match/i);
  }
});

test("on the page, the narrowed view names the filters that emptied it and nothing else", async (t) => {
  const { page } = await openPage(t);

  change(byId(page, "release-status"), "cancelled");
  assert.equal(logBody(page), "The log still holds releases; none of them matches release status Cancelled.");

  const search = byId(page, "release-search");
  search.focus();
  typeText(page.document, "nothing like this");
  change(byId(page, "release-decision"), "d-queue");
  assert.equal(logBody(page),
    "The log still holds releases; none of them matches your search for “nothing like this”, release status Cancelled and the linked decision “Adopt a durable queue”.");

  // Still one state, not two: the narrowed view is never also the first-run one.
  assert.equal(count(page, ".list-state-empty"), 0);
  assert.equal(count(page, ".list-state-error"), 0);
  assert.equal(count(page, ".list-state-loading"), 0);
  assert.equal(count(page, ".list-state-no-match"), 1);
});

// --- narrow width, by inspection of the rule ---------------------------------

test("at a phone width the failed control's Retry fills its column, per the page's own sheet", async () => {
  const sheet = await readFile(new URL("../src/releases-proof.css", import.meta.url), "utf8");
  assert.match(sheet, /@media\(max-width:520px\) \{ \.decision-picker-failed \.empty-action\{width:100%;line-height:1\.3\} \}/);

  // The rule lives in the releases page's own sheet, which the page links and
  // which is outside the evolution size budget. styles.css gained nothing.
  const markup = await readFile(RELEASES_PAGE, "utf8");
  assert.match(markup, /href="\/releases-proof\.css"/);
  const site = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(site, /decision-picker-failed/);
  assert.doesNotMatch(site, /decision-picker-retry-action/);
});
