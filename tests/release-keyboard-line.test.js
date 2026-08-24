// The keyboard line above the release list, pinned to the keys the list
// actually answers (issue #1204).
//
// The line is copy, but what makes it true or false is behaviour, so every key
// it names is pressed through the shipped src/releases.html before the sentence
// is asserted: the arrows and Home/End against which row holds focus, Enter and
// Space against what each one leaves behind. A key that stops working, or a
// second key quietly bound to the same action, fails here rather than turning
// the sentence into a promise the page does not keep.
//
// Determinism: no network, no timers, no sleeps. The fixtures are local and the
// page is handed an empty example seed, so nothing depends on the shipped
// demo records.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initReleasesPage } from "../src/releases-page.js";
import { loadPage, pressKey, pressTab, textOf } from "./support/browser.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const NO_SEED = { decisions: [], releases: [] };

const DECISIONS = [
  { id: "d-queue", title: "Adopt a durable queue", context: "Retries are required.", owner: "Kai", status: "accepted", createdAt: "2026-01-02T09:00:00.000Z" },
];

// Three releases, newest first once sorted: flags, read, queue. Three is the
// smallest list where "move" and "jump" are different answers.
const RELEASES = [
  { id: "r-queue", version: "v1.1.0", title: "Queue work", description: "The durable queue shipped.", status: "completed", owner: "Kai", createdAt: "2026-02-01T00:00:00.000Z", decisionIds: ["d-queue"] },
  { id: "r-read", version: "v1.2.0", title: "Read path", description: "Caching went out.", status: "completed", owner: "Ari", createdAt: "2026-03-01T00:00:00.000Z", decisionIds: ["d-queue"] },
  { id: "r-flags", version: "v1.4.0", title: "Flag rollout", description: "Flags landed.", status: "completed", owner: "Priya", createdAt: "2026-05-01T00:00:00.000Z", decisionIds: ["d-queue"] },
];

async function bootedReleases(t) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(DECISIONS),
      [RELEASE_STORAGE_KEY]: JSON.stringify(RELEASES),
    },
  });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, { seed: NO_SEED });
  return page;
}

// Tab forward until the wanted control has focus, so every key below is pressed
// from where a keyboard user would actually be standing.
function tabTo(page, selector) {
  const wanted = page.document.querySelector(selector);
  assert.ok(wanted, `${selector} is not on the page`);
  for (let step = 0; step < 200; step += 1) {
    if (page.document.activeElement === wanted) return wanted;
    pressTab(page.document);
  }
  assert.fail(`${selector} is not reachable by keyboard`);
}

// Which release row holds focus, by its visible version, rather than by index
// into a node list the assertion would have to re-derive.
function focusedRelease(page) {
  const active = page.document.activeElement;
  return active?.className?.includes("release-toggle") ? textOf(active.querySelector(".release-version")) : null;
}

const HINT = "Use ↑ and ↓ to move between releases, Home and End to jump to the first and last release, and Enter or Space to expand a release in place. Use the detail link inside an expanded row to open its page.";

test("the release list answers ↑ ↓ Home and End by moving focus between rows", async (t) => {
  const page = await bootedReleases(t);
  const toggles = page.document.querySelectorAll(".release-toggle");
  assert.equal(toggles.length, 3, "the fixture did not render three release rows");

  tabTo(page, ".release-toggle");
  assert.equal(focusedRelease(page), "Flag rollout", "Tab did not land on the first release row");

  pressKey(page.document, "ArrowDown");
  assert.equal(focusedRelease(page), "Read path", "↓ did not move to the next release");
  pressKey(page.document, "ArrowUp");
  assert.equal(focusedRelease(page), "Flag rollout", "↑ did not move back to the previous release");

  pressKey(page.document, "End");
  assert.equal(focusedRelease(page), "Queue work", "End did not jump to the last release");
  pressKey(page.document, "Home");
  assert.equal(focusedRelease(page), "Flag rollout", "Home did not jump to the first release");

  // The ends clamp rather than wrap, so the line can promise "move" and "jump"
  // without a reader discovering the list also loops.
  pressKey(page.document, "ArrowUp");
  assert.equal(focusedRelease(page), "Flag rollout", "↑ wrapped past the first release");
  assert.deepEqual(page.navigations, [], "moving between rows navigated away from the list");
});

test("Space and Enter both expand the focused release in place", async (t) => {
  const page = await bootedReleases(t);
  const toggle = tabTo(page, ".release-toggle");
  assert.equal(toggle.getAttribute("aria-expanded"), "false", "the release row did not start collapsed");

  // Space: the panel this row controls opens, and the page stays put.
  pressKey(page.document, " ");
  const panel = page.document.getElementById(toggle.getAttribute("aria-controls"));
  assert.equal(toggle.getAttribute("aria-expanded"), "true", "Space did not expand the release row");
  assert.equal(panel.hidden, false, "Space left the release's decisions hidden");
  assert.deepEqual(page.navigations, [], "Space navigated away from the list");

  pressKey(page.document, " ");
  assert.equal(toggle.getAttribute("aria-expanded"), "false", "Space did not collapse the release row again");

  // Enter is the other native activation key for the same disclosure button.
  pressKey(page.document, "Enter");
  assert.deepEqual(page.navigations, [], "Enter navigated away from the disclosure");
  assert.equal(toggle.getAttribute("aria-expanded"), "true", "Enter did not expand the release row");
});

test("the keyboard line names one action per key, and only keys the list answers", async (t) => {
  const page = await bootedReleases(t);
  const hint = textOf(page.document.querySelector(".release-hint"));
  assert.equal(hint, HINT);

  // Every key the sentence names is exercised above. Nothing else may be
  // named: a key in this line that the list ignores is a promise the page
  // cannot keep.
  const named = ["↑", "↓", "Home", "End", "Space", "Enter"];
  for (const key of named) {
    assert.ok(hint.includes(key), `the keyboard line stopped naming ${key}`);
  }
  for (const unanswered of ["←", "→", "Escape", "Page"]) {
    assert.equal(hint.includes(unanswered), false, `the keyboard line names ${unanswered}, which the release list ignores`);
  }

  // One name per concept: opening a release in place is "expand" here and
  // "expand" in the paragraph introducing the log, so the page has one verb
  // for it. The intro paragraph carries no class of its own, so it is read
  // from the shipped markup rather than reached by a descendant selector.
  const markup = await readFile(RELEASES_PAGE, "utf8");
  assert.match(markup, /Expand a release to review each linked decision and its status\./);
  assert.match(hint, /Space to expand a release in place/);
});
