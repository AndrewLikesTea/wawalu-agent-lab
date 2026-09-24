// What "Copy link to this view" carries, said before the link is sent.
//
// THE MISTAKE THESE TESTS EXIST TO PREVENT. Shiplog keeps a visitor's records in
// their own browser. The share link carries the search and the filters and
// nothing else, so a prospect who narrows the history, copies the link and
// sends it to a colleague has sent a view of the colleague's own log — often an
// empty one. Nothing on the page used to say so until after the press, and even
// then it only said the link "opens this filtered view", which is true and
// reads like a promise about the records.
//
// So two things are pinned here. The explanation is on screen *before* any copy
// happens — a warning that only arrives with the confirmation arrives after the
// decision to share — and it points at the panel that does carry records rather
// than leaving the reader to hunt for it. The confirmation then repeats the
// half that is easy to forget once the link is already on the clipboard.
//
// The wording is the releases page's, word for word in its first two sentences
// (tests/release-filter-url.test.js pins the same two there), with "records"
// for "releases" because that is the noun this list counts in its own summary.
// Two pages answering the same question differently is how a reader learns to
// distrust both.
//
// WHAT IS DELIBERATELY NOT CLAIMED. Neither pointer describes the export file.
// The export panel states its own scope — it follows the history filters by
// default, and a control there switches it to everything stored — and a second
// description beside the copy button could drift out of step with it. These
// tests therefore assert the pointer names the section and resolves to it, and
// that the scope line beside the button is exactly three sentences long.
//
// Determinism: the page is the shipped markup, the history is two hand-authored
// records with fixed ids and fixed past timestamps, the clipboard is a local
// stub, and the harness throws on any network request.

import test from "node:test";
import assert from "node:assert/strict";

import { initDecisionLog, STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { COPY_LINK_SUCCESS } from "../src/history-filter-view.js";
import { loadPage, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";

const PAGE = new URL("../src/index.html", import.meta.url);
const NO_DEMO_DATA = { decisions: [], releases: [] };

const DECISIONS = [
  {
    id: "scope-d-queue",
    title: "Adopt a durable queue",
    context: "Retries are required.",
    alternatives: "Poll the database.",
    owner: "Ari",
    status: "accepted",
    createdAt: "2026-02-10T09:00:00.000Z",
  },
];

const RELEASES = [
  {
    id: "scope-r-1-4-0",
    version: "v1.4.0",
    title: "Queue rollout",
    description: "The durable queue shipped.",
    owner: "Ari",
    status: "completed",
    createdAt: "2026-03-10T09:00:00.000Z",
    decisionIds: ["scope-d-queue"],
  },
];

// The scope line, in full. Written out here rather than assembled from the two
// pages' constants: this file is where a reviewer reads what the page says.
const SCOPE_LINE = "The link keeps your search and filters."
  + " Whoever opens it sees the records saved in their own browser."
  + " To send someone the records themselves, use Export history.";

// The id the pointer targets, and the heading that id belongs to.
const EXPORT_TARGET = "export-title";

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

// Open the shipped decisions page and boot the history, the way a visitor
// arrives at it. `copied` collects what the clipboard was handed, so a test can
// tell a real write from a message that lies about one.
async function openHistory(t, { search = "", clipboard } = {}) {
  const copied = [];
  const page = await loadPage(PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(DECISIONS),
      [RELEASE_STORAGE_KEY]: JSON.stringify(RELEASES),
    },
    location: { search, pathname: "/" },
  });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage, {
    seed: NO_DEMO_DATA,
    announceDelay: 0,
    location: { search, pathname: "/", origin: "https://labs.wawalu.org", hash: "" },
    clipboard: clipboard ?? { writeText: async (value) => { copied.push(String(value)); } },
  });
  assert.equal(page.document.documentElement.dataset.shiplog, "ready", "the history never finished rendering");
  return { page, copied };
}

const byId = (page, id) => page.document.getElementById(id);

test("the share control says what the link carries before anything is copied", async (t) => {
  const { page, copied } = await openHistory(t);

  const scope = byId(page, "history-share-scope");
  assert.ok(scope, "the copy control has no scope line at all");
  assert.equal(textOf(scope), SCOPE_LINE);

  // Nothing has been pressed: this is the state a reader is in while deciding
  // whether to send the link, which is the only moment the warning can still
  // change what they do.
  assert.deepEqual(copied, [], "the page copied something on its own");
  assert.equal(textOf(byId(page, "history-copy-status")), "");

  // Associated with the control, not merely near it: the page describes its
  // filter controls this way (#filter-status-hint, #filter-release-hint), and a
  // screen reader user who lands on the button hears the scope with the name.
  assert.equal(byId(page, "copy-history-link").getAttribute("aria-describedby"), "history-share-scope");

  // Three sentences, and no fourth describing the export file. The export panel
  // states its own scope; a second statement here is a second thing to keep
  // true. Counted rather than pattern-matched, so an added claim fails here
  // whatever words it uses.
  assert.equal(SCOPE_LINE.split(". ").length, 3);
  for (const overreach of [/everything/i, /all (of )?your/i, /complete/i, /full history/i]) {
    assert.doesNotMatch(textOf(scope), overreach, `the scope line claims ${overreach} about the export`);
  }
});

test("the export pointer resolves to the page's own Export history section", async (t) => {
  const { page } = await openHistory(t);

  const scope = byId(page, "history-share-scope");
  const links = scope.querySelectorAll("a");
  assert.equal(links.length, 1, "the scope line must offer exactly one way on");
  const [pointer] = links;
  assert.equal(textOf(pointer), "Export history");
  assert.equal(pointer.getAttribute("href"), `#${EXPORT_TARGET}`);

  // The target exists, so following the link lands somewhere rather than
  // scrolling nowhere. Asserted as a resolved element, not as a label that
  // looks like a link.
  const target = byId(page, EXPORT_TARGET);
  assert.ok(target, `#${EXPORT_TARGET} is not on the page, so the pointer goes nowhere`);
  assert.equal(target.tagName, "H2");
  assert.equal(textOf(target), "Export your Shiplog records");

  // …and what it lands on is the section the link names. The panel is labelled
  // by that heading and carries the download control, so "Export history" is
  // the reader's own name for where they arrived.
  let panel = target.parentNode;
  while (panel && !(panel.className ?? "").includes("export-panel")) panel = panel.parentNode;
  assert.ok(panel, "the export heading is not inside an export panel");
  assert.equal(panel.getAttribute("aria-labelledby"), EXPORT_TARGET);
  const eyebrows = panel.querySelectorAll(".eyebrow");
  assert.equal(textOf(eyebrows[0]), "Export history", "the link's words are not the section's own");
  assert.equal(panel.querySelectorAll("#export-shiplog").length, 1, "the section the pointer names has no export control");
});

test("copying the link confirms that it carries the view and not the records", async (t) => {
  const { page, copied } = await openHistory(t, { search: "?type=decision" });

  const button = byId(page, "copy-history-link");
  button.click();
  await settle();

  assert.equal(copied.length, 1, "the press wrote nothing to the clipboard");
  const status = byId(page, "history-copy-status");
  assert.equal(textOf(status), COPY_LINK_SUCCESS);
  // The two halves, asserted as what a reader has to come away with rather than
  // as the sentence's exact shape: it copied, and the thing copied is the view.
  assert.match(textOf(status), /^Link copied\./);
  assert.match(textOf(status), /carries the view, not the records/);

  // One announcement channel, not two. The confirmation goes to the region that
  // already existed; the record count keeps its own, and no third live region
  // was added beside the button for this message.
  const live = byId(page, "history-copy-status").parentNode.children
    .filter((child) => child.getAttribute?.("role") === "status");
  assert.equal(live.length, 1, "a second live region now competes with the copy confirmation");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(textOf(byId(page, "history-announcement")), "Showing 1 of 2 records.");
});

test("the copy control keeps its label and its keyboard operation", async (t) => {
  const { page, copied } = await openHistory(t);

  const button = byId(page, "copy-history-link");
  assert.equal(textOf(button), "Copy link to this view");
  // Nothing overrides the visible label, so what is heard is what is read.
  assert.equal(button.getAttribute("aria-label"), null);
  assert.equal(button.getAttribute("title"), null);
  assert.equal(button.type, "button");

  // Still a tab stop, and the pointer that now follows it is the next one — the
  // explanation sits beside the control in reading and tab order rather than
  // ahead of it.
  const sequence = tabSequence(page.document);
  const at = sequence.indexOf(button);
  assert.ok(at >= 0, "the copy control is not reachable by keyboard");
  const pointer = byId(page, "history-share-scope").querySelectorAll("a")[0];
  assert.equal(sequence.indexOf(pointer), at + 1, "the export pointer does not follow the control it describes");

  // Reached by pressing Tab, not by reading the list, and operated from the
  // keyboard alone. Bounded by the page's own stops: a fixed count would turn
  // every link added above the history into a failure of this test.
  let reached = null;
  for (let press = 0; press < sequence.length && reached !== button; press += 1) reached = pressTab(page.document);
  assert.ok(reached === button, "Tab never reaches the copy control");
  pressEnter(page.document);
  await settle();
  assert.equal(copied.length, 1, "Enter on the focused control copied nothing");
  assert.match(textOf(byId(page, "history-copy-status")), /carries the view, not the records/);
});
