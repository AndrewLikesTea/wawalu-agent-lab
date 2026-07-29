// The observatory's one primary message, and the one control that answers it.
//
// tests/agent-observatory-states.test.js already pins that loading, "the feed
// carried nothing", and "the request failed" read and draw differently. This
// file pins the two things that sit *around* that message: whether the single
// control in the panel is a recovery or an ordinary refresh, and whether the
// synthetic-example disclosure — which must not be removed, because it is the
// only thing telling a reader the four rows below are not real work — stays
// subordinate to the state instead of competing to be read as one.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ACTIVITY_STATES,
  isRecoverableActivityState,
  renderActivityState,
  renderRepresentativeActivity,
} from "../src/agents.js";
import { byClass, createElement, installDocument, tags } from "./support/dom.js";
import { loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";

installDocument();

const PAGE_URL = new URL("../src/agents.html", import.meta.url);
const STATES = ["loading", "live", "empty", "error"];
const HEADING_TAGS = ["H1", "H2", "H3", "H4", "H5", "H6"];

function activityRoot() {
  const nodes = {
    "#activity-status": createElement("div"),
    "#refresh-activity": createElement("button"),
  };
  return { nodes, querySelector: (selector) => nodes[selector] ?? null };
}

const headingsIn = (node) => HEADING_TAGS.flatMap((tag) => tags(node, tag));

test("only a failed public request counts as a recovery", () => {
  assert.deepEqual(STATES.filter(isRecoverableActivityState), ["error"]);
  assert.equal(isRecoverableActivityState("nonsense"), false);

  for (const state of STATES) {
    const root = activityRoot();
    renderActivityState(root, state, { count: 1 });
    const control = root.nodes["#refresh-activity"];

    assert.equal(control.dataset.recovery, state === "error" ? "retry" : "refresh", state);
    assert.equal(control.dataset.state, state);
    // Only the state a second request could actually fix says "Retry". The
    // others are reads that succeeded, and offering to retry them would invite
    // a reader to treat a working feed as a fault.
    assert.equal(/^Retry/.test(control.textContent), state === "error",
      `${state}: the label must agree with whether this is a recovery`);
    assert.equal(control.textContent, ACTIVITY_STATES[state].action);
  }
});

test("the control is described by the sentence that explains the state", () => {
  for (const state of STATES) {
    const root = activityRoot();
    renderActivityState(root, state, { count: 2 });
    const panel = root.nodes["#activity-status"];

    const [detail] = byClass(panel, "activity-state-detail");
    assert.equal(detail.id, "activity-state-detail", `${state}: the sentence is addressable`);
    assert.equal(root.nodes["#refresh-activity"].getAttribute("aria-describedby"), "activity-state-detail",
      `${state}: tabbing straight to the control still hears why it is offered`);
    assert.ok(detail.textContent.length > 40, `${state}: the description is a sentence, not a code`);
  }
});

test("each rendered state carries exactly one heading, so there is one primary message", () => {
  for (const state of STATES) {
    const root = activityRoot();
    renderActivityState(root, state, { count: 3 });
    const headings = headingsIn(root.nodes["#activity-status"]);

    assert.equal(headings.length, 1, `${state}: one heading in the status region`);
    assert.equal(headings[0].tagName, "H3", `${state}: it sits under the panel's own h2`);
    assert.equal(headings[0].className, "activity-state-title");
    // The chip is a word beside the heading, not a second heading.
    assert.equal(byClass(root.nodes["#activity-status"], "activity-state-chip")[0].tagName, "P", state);
  }
});

test("the synthetic-example disclosure is kept, and stays subordinate to the state", () => {
  for (const reason of ["loading", "unavailable", "empty"]) {
    const list = createElement("ol");
    renderRepresentativeActivity(list, { reason });
    const [note] = byClass(list, "activity-fallback");

    // Kept: without this, four unlabelled rows read as real published work.
    assert.match(note.textContent, /synthetic example/i, `${reason}: the disclosure survives`);
    // Subordinate: no heading of its own, so the state's h3 is still the one
    // primary message on the first screen.
    assert.equal(headingsIn(note).length, 0, `${reason}: the disclosure never competes as a heading`);
    assert.equal(byClass(note, "activity-fallback-chip")[0].tagName, "P", reason);
    assert.equal(tags(note, "BUTTON").length, 0, `${reason}: the disclosure offers no rival action`);
  }
});

test("the shipped page reads state, then action, then activity — and says so in the markup", async () => {
  const document = parseHtml(await readFile(PAGE_URL, "utf8"));
  const panel = document.querySelector(".activity-panel");
  const order = panel.childElements.map((child) => child.id || child.className);
  assert.deepEqual(order, ["activity-heading", "activity-status", "activity-actions", "activity-list"]);

  const control = document.querySelector("#refresh-activity");
  assert.equal(control.getAttribute("aria-describedby"), "activity-state-detail");
  assert.equal(control.dataset.recovery, "refresh", "nothing has failed on the served page");
  assert.equal(document.querySelector("#activity-state-detail").className, "activity-state-detail");

  // The demo boundary is a paragraph in the personas column, not a heading and
  // not inside the activity panel: it explains the whole page, and must not be
  // mistaken for this panel's state.
  const boundary = document.querySelector(".privacy-note");
  assert.equal(boundary.tagName, "P");
  assert.match(textOf(boundary), /synthetic examples/i);
  assert.equal(panel.querySelectorAll(".privacy-note").length, 0);
});

test("the escape links a quiet feed offers are met before the refresh control", async (t) => {
  const page = await loadPage(PAGE_URL);
  t.after(() => page.restore());

  // "Nothing recent" is the one state that offers a way onward inside the status
  // region itself. Those links are part of the message, so the keyboard has to
  // meet them with it — before the control that asks the feed again.
  renderActivityState(page.document, "empty");

  const sequence = tabSequence(page.document);
  const control = page.document.querySelector("#refresh-activity");
  const escapes = page.document.querySelector("#activity-status").querySelectorAll("a");

  assert.equal(escapes.length, 2);
  for (const link of escapes) {
    assert.ok(sequence.includes(link), `${textOf(link)} is reachable by keyboard`);
    assert.ok(sequence.indexOf(link) < sequence.indexOf(control),
      `${textOf(link)} is read with the message, before the control`);
  }
  assert.match(textOf(control), /^Check for new activity$/, "a quiet feed is not a fault, so this is not a retry");
});
