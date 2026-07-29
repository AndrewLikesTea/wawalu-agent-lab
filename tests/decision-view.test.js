import test from "node:test";
import assert from "node:assert/strict";
import {
  selectDecisions,
  uniqueOwners,
  nextFocusIndex,
  DEFAULT_SORT,
  SORTS,
  focusLinkedDecision,
  handleDecisionListKeydown,
  renderDecisions,
  enterDecisionRecorder,
  exitDecisionRecorder,
} from "../src/app.js";
import { byClass, createElement, installDocument, tags } from "./support/dom.js";

installDocument();

// Fixtures deliberately vary title, owner, status, and date so a single set
// exercises every filter and sort path. Ids double as ordering assertions.
const sample = [
  { id: "zebra",  title: "Zebra queue",  context: "c", owner: "Kai", status: "proposed",   createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "alpha",  title: "Alpha cache",  context: "c", owner: "Ari", status: "accepted",   createdAt: "2026-03-01T00:00:00.000Z" },
  { id: "middle", title: "Middle plan",  context: "c", owner: "Kai", status: "accepted",   createdAt: "2026-02-01T00:00:00.000Z" },
  { id: "sunset", title: "sunset flag",  context: "c", owner: "ari", status: "superseded", createdAt: "2026-04-01T00:00:00.000Z" },
  { id: "approve", title: "Approve edge cache", context: "Reduce latency", alternatives: "Regional proxy", owner: "Mina", status: "approved", createdAt: "2026-05-01T00:00:00.000Z" },
  { id: "pending", title: "Queue selection", context: "Retries are required", alternatives: "Poll the database", owner: "Mina", status: "pending", createdAt: "2026-06-01T00:00:00.000Z" },
];

const ids = (decisions) => decisions.map((decision) => decision.id);

test("defaults to newest-first ordering with no filters", () => {
  assert.deepEqual(ids(selectDecisions(sample)), ["pending", "approve", "sunset", "alpha", "middle", "zebra"]);
});

test("filters by status", () => {
  assert.deepEqual(selectDecisions(sample, { status: "proposed" }).length, 1);
  assert.deepEqual(ids(selectDecisions(sample, { status: "pending" })), ["pending"]);
  // "approved" is retired from every control but a browser can still hold a
  // record the old form wrote, so it is read as accepted — and the record is
  // returned by the accepted filter rather than stranded behind a word no
  // control offers any more.
  assert.deepEqual(ids(selectDecisions(sample, { status: "accepted" })), ["approve", "alpha", "middle"]);
  assert.deepEqual(ids(selectDecisions(sample, { status: "approved" })), ["approve", "alpha", "middle"]);
});

test("searches title, context, and alternatives case-insensitively", () => {
  assert.deepEqual(ids(selectDecisions(sample, { query: "queue" })), ["pending", "zebra"]);
  assert.deepEqual(ids(selectDecisions(sample, { query: "LATENCY" })), ["approve"]);
  assert.deepEqual(ids(selectDecisions(sample, { query: "regional proxy" })), ["approve"]);
  assert.equal(selectDecisions(sample, { query: "  " }).length, sample.length);
});

test("search composes with status and owner and ignores unknown status state", () => {
  assert.deepEqual(ids(selectDecisions(sample, { query: "retries", status: "pending", owner: "Mina" })), ["pending"]);
  assert.equal(selectDecisions(sample, { status: "corrupt" }).length, sample.length);
});

test("filters by owner (exact, case-sensitive value from the control)", () => {
  assert.deepEqual(ids(selectDecisions(sample, { owner: "Kai" })), ["middle", "zebra"]);
  assert.deepEqual(ids(selectDecisions(sample, { owner: "ari" })), ["sunset"]);
});

test("combines status and owner filters", () => {
  assert.deepEqual(ids(selectDecisions(sample, { status: "accepted", owner: "Kai" })), ["middle"]);
});

test("'all' sentinels and empty view are pass-through", () => {
  assert.equal(selectDecisions(sample, { status: "all", owner: "all" }).length, sample.length);
  assert.equal(selectDecisions(sample, {}).length, sample.length);
});

test("sorts by title alphabetically, case-insensitively", () => {
  assert.deepEqual(ids(selectDecisions(sample, { sort: "title" })), ["alpha", "approve", "middle", "pending", "sunset", "zebra"]);
});

test("sorts by owner, breaking ties with newest-first", () => {
  // Ari/ari sort together; within the Kai group the Feb entry precedes the Jan one.
  assert.deepEqual(ids(selectDecisions(sample, { sort: "owner" })), ["sunset", "alpha", "middle", "zebra", "pending", "approve"]);
});

test("unknown sort key falls back to the default order", () => {
  assert.deepEqual(
    ids(selectDecisions(sample, { sort: "nope" })),
    ids(selectDecisions(sample, { sort: DEFAULT_SORT })),
  );
});

test("does not mutate the input array or its order", () => {
  const before = ids(sample);
  selectDecisions(sample, { sort: "title", status: "accepted" });
  assert.deepEqual(ids(sample), before);
});

test("filtering an empty list yields an empty list", () => {
  assert.deepEqual(selectDecisions([], { status: "accepted", owner: "Kai" }), []);
});

test("true-empty history renders the recording workflow action", () => {
  const container = createElement("div");
  const count = createElement("span");
  renderDecisions(container, count, [], { query: "ignored because there are no records" });

  assert.equal(count.textContent, "0 records");
  assert.match(container.textContent, /No decisions yet/);
  assert.match(container.textContent, /title, context, owner, and status/);
  assert.match(container.textContent, /link it to a release/);
  const [action] = byClass(container, "decision-empty-action");
  assert.equal(action.tagName, "BUTTON");
  assert.equal(action.type, "button");
  assert.equal(action.getAttribute("aria-controls"), "decision-form");
  assert.equal(action.dataset.action, "record-decision");
});

test("populated history with no filter matches does not show the first-decision action", () => {
  const container = createElement("div");
  const count = createElement("span");
  renderDecisions(container, count, sample, { query: "not present in any decision" });

  assert.equal(count.textContent, `0 of ${sample.length} records`);
  assert.match(container.textContent, /No records match your filters/);
  assert.equal(byClass(container, "decision-empty-action").length, 0);
  assert.equal(tags(container, "OL").length, 0);
});

test("uniqueOwners returns distinct owners sorted case-insensitively", () => {
  assert.deepEqual(uniqueOwners(sample), ["Ari", "ari", "Kai", "Mina"]);
  assert.deepEqual(uniqueOwners([]), []);
});

test("every advertised sort option has a comparator", () => {
  for (const key of ["newest", "title", "owner"]) {
    assert.equal(typeof SORTS[key]?.compare, "function");
  }
});

test("nextFocusIndex moves within bounds and leaves activation to Enter", () => {
  assert.equal(nextFocusIndex(0, "ArrowDown", 3), 1);
  assert.equal(nextFocusIndex(2, "ArrowDown", 3), 2); // clamps at last
  assert.equal(nextFocusIndex(1, "ArrowUp", 3), 0);
  assert.equal(nextFocusIndex(0, "ArrowUp", 3), 0); // clamps at first
  assert.equal(nextFocusIndex(-1, "ArrowDown", 3), 0); // nothing focused yet
  assert.equal(nextFocusIndex(1, "Enter", 3), 1); // Enter selects; it does not move focus
  assert.equal(nextFocusIndex(1, "Home", 3), 0);
  assert.equal(nextFocusIndex(1, "End", 3), 2);
  assert.equal(nextFocusIndex(1, "Tab", 3), 1); // unhandled key is a no-op
  assert.equal(nextFocusIndex(0, "ArrowDown", 0), -1); // empty list
});

test("focusLinkedDecision ignores malformed and unrelated fragments", () => {
  const root = { getElementById: () => null };
  assert.equal(focusLinkedDecision(root, "#elsewhere"), false);
  assert.equal(focusLinkedDecision(root, "#decision-%E0%A4%A"), false);
  assert.equal(focusLinkedDecision(root, "#decision-missing"), false);
});

function keyboardFixture() {
  const calls = { prevented: 0, selected: 0, focused: [] };
  const cards = [0, 1, 2].map((index) => ({
    focus: () => calls.focused.push(index),
    click: () => { calls.selected += 1; },
  }));
  const list = { querySelectorAll: () => cards };
  const event = (key, target = cards[1]) => ({
    key,
    target: Object.assign(target, { closest: () => cards[1] }),
    preventDefault: () => { calls.prevented += 1; },
  });
  return { calls, cards, list, event };
}

test("decision card Enter selects its existing detail action without moving focus", () => {
  const { calls, list, event } = keyboardFixture();
  assert.equal(handleDecisionListKeydown(event("Enter"), list), true);
  assert.equal(calls.selected, 1);
  assert.deepEqual(calls.focused, []);
  assert.equal(calls.prevented, 1);
});

test("decision card arrows move focus and nested controls retain native keys", () => {
  const { calls, cards, list, event } = keyboardFixture();
  assert.equal(handleDecisionListKeydown(event("ArrowDown"), list), true);
  assert.deepEqual(calls.focused, [2]);

  const link = { closest: () => cards[1] };
  assert.equal(handleDecisionListKeydown(event("Enter", link), list), false);
  assert.equal(calls.selected, 0);
  assert.equal(calls.prevented, 1);
});

test("decision cards are rendered as the single semantic detail link", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/app.js", import.meta.url), "utf8"));
  assert.match(source, /detailLink\.className = "history-card decision-card decision-detail-link"/);
  assert.match(source, /detailLink\.setAttribute\("aria-labelledby", titleId\)/);
  assert.match(source, /detailLink\.setAttribute\("aria-describedby", descriptionId\)/);
  assert.ok(
    source.indexOf('appendTextElement(detailLink, "h3"') < source.indexOf('meta.className = "decision-meta"'),
    "the decision title precedes its metadata in DOM reading order",
  );
  assert.match(source, /appendLabelledValue\(meta, "Status", status/);
  assert.doesNotMatch(source, /article\.tabIndex\s*=/);
});

test("recording workflow entry and exit restore keyboard focus without a trap", () => {
  const calls = [];
  const title = {
    focus: (options) => calls.push(["title-focus", options]),
    scrollIntoView: (options) => calls.push(["title-scroll", options]),
  };
  const history = {
    focus: (options) => calls.push(["history-focus", options]),
    scrollIntoView: (options) => calls.push(["history-scroll", options]),
  };
  const trigger = {
    isConnected: true,
    focus: (options) => calls.push(["trigger-focus", options]),
    scrollIntoView: (options) => calls.push(["trigger-scroll", options]),
  };
  const root = {
    querySelector: (selector) => selector === "#title" ? title : history,
  };

  assert.equal(enterDecisionRecorder(root, trigger), true);
  assert.equal(exitDecisionRecorder(root), true);
  assert.deepEqual(calls.map(([name]) => name), [
    "title-focus", "title-scroll", "trigger-focus", "trigger-scroll",
  ]);
});

test("decision list exposes semantic loading, empty, and error states", async () => {
  const read = (path) => import("node:fs/promises")
    .then((fs) => fs.readFile(new URL(`../${path}`, import.meta.url), "utf8"));
  const [page, source] = await Promise.all([read("src/index.html"), read("src/app.js")]);
  // The list is not a live region: the debounced #history-announcement region
  // carries the result count instead (see the note in index.html).
  assert.match(page, /id="decision-list" aria-busy="true"/);
  assert.doesNotMatch(page, /id="decision-list"[^>]*aria-live/);
  assert.match(page, /id="history-announcement" role="status" aria-live="polite"/);
  assert.match(page, /<h3>Loading decisions<\/h3>/);
  assert.match(page, /<h2 id="decisions-title" tabindex="-1">All records<\/h2>/);
  assert.match(page, /<p>Loading all decisions…<\/p>/);
  assert.match(page, /<h2 id="decision-form-title">Record a decision<\/h2>/);
  assert.match(page, /<button type="submit">Record decision<\/button>/);
  assert.match(page, /id="title-hint">A short name for the decision\.<\/span>/);
  assert.match(page, /id="context-hint">The problem, constraints, and reasoning\.<\/span>/);
  // Alternatives is required, so its hint has to answer "what do I write when
  // there were none?" rather than leaving a required field unanswerable.
  assert.match(
    page,
    /id="alternatives-hint">Other options considered and why they were not chosen\. Write “None considered” if there were none\.<\/span>/,
  );
  assert.match(page, /id="owner-hint">The person responsible for the decision\.<\/span>/);
  // The form's two statuses, and the sentence that names the two it cannot set
  // — the filter offers all four, so the gap is stated rather than discovered.
  assert.match(page, /<option value="pending">Pending<\/option>\s*<option value="accepted">Accepted<\/option>/);
  assert.match(page, /id="status-hint">Set Pending or Accepted\. Records can also read Proposed or Superseded; this form does not set those\.<\/span>/);
  assert.match(page, /id="supersedes-hint">The decision this one replaces, if any\. That decision is marked Superseded by this one, and Current only hides it\.<\/span>/);
  assert.match(source, /panel\.setAttribute\("role", state === "error" \? "alert" : "status"\)/);
  assert.match(source, /container\.setAttribute\("aria-busy", String\(state === "loading"\)\)/);
  assert.match(source, /\["Loading decisions", "Loading all decisions…"\]/);
  assert.match(source, /"No decisions yet"/);
  assert.match(source, /"Record the title, context, owner, and status/);
  assert.match(source, /\["No records match your filters", "No decision or release matches/);
  assert.match(page, /id="exit-decision-recorder" type="button">Back to decision history<\/button>/);
  assert.match(page, /id="decisions-title" tabindex="-1"/);
});
