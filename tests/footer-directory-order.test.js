// The repeated destination directory, folded and demoted on the five task pages
// (#2250).
//
// THE PROBLEM. Every page's "About Shiplog" band rendered all nine destinations,
// open, above the follow-up block. On the five pages a visitor is on to do one
// thing — read a shared post, read the feed, pick a display name, grade a
// prompt, scan the releases — that put a site map the header already offers
// between the page's own content and the page's own follow-up action.
//
// WHAT IS PINNED HERE, on every one of the five:
//   1. Reading order. The follow-up block's heading line and its submit control
//      come before the disclosure, in the document, on all five. This is the
//      whole point of the change and it is asserted by index, per page.
//   2. One disclosure, named the same way everywhere: same id, same summary
//      sentence, same caption class. "Consistently named" is a claim about all
//      five pages at once, so it is asserted across them rather than on one.
//   3. Nothing was dropped. Every row of DEMOS survives with its label and its
//      href, and every one of them is a tab stop once the disclosure is open.
//   4. Keyboard operation. Enter and Space both toggle it, focus stays on the
//      summary across the toggle, and the stops that appear are the rows — a
//      disclosure that moved focus, or trapped it, would fail here.
//   5. The pages that must NOT fold. The twelve remaining pages keep the open
//      list, so this is a decision about task pages, not a site-wide deletion.
//
// WHAT IS NOT PINNED HERE, and why. This harness models no layout at all: it has
// no viewport, no box model and no computed style, so a 390px shim would assert
// only itself. Clipping and touch-target size are therefore checked by reading
// the product stylesheet — the rules and the token, below — and were confirmed
// visually by rule inspection rather than by rendering. The PR body says so.
//
// HARNESS NOTES: a closed details answers `undefined` for `open`, so first paint
// asserts `!node.open`; text nodes appear in `children` with a truthy tagName,
// so every walk filters on nodeType; descendant selectors throw, so "is it
// inside the disclosure" is a parentNode walk; and nothing is compared against
// an element node, because a failed node assertion serialises the whole page.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEMOS, DIRECTORY_SUMMARY, INVITATION } from "../src/site-footer.js";
import { parseHtml, pressEnter, pressSpace, pressTab, tabSequence, textOf } from "./support/browser.js";

const SRC = new URL("../src/", import.meta.url);

// The five, named. A page joins or leaves this list only by a reviewer reading
// the line — the same hand-kept discipline FOOTER_VARIANT follows in
// tests/site-footer.test.js, which holds the generated markup to it.
const TASK_PAGES = ["social.html", "profile.html", "post.html", "coach.html", "releases.html"];

// Three of the twelve that keep the directory open, spread across the kinds of
// page they are: the home page, the AI FinOps answer, the observatory.
const OPEN_PAGES = ["index.html", "evolution.html", "agents.html"];

const read = (file) => readFile(new URL(file, SRC), "utf8");
const parse = async (file) => parseHtml(await read(file));

const elementChildren = (node) => node.children.filter((child) => child.nodeType === 1);

// Is this element inside the directory disclosure? The summary is the handle on
// it, not something it hides, so the walk starts above what it opens.
function insideDirectory(node) {
  const from = node?.tagName === "SUMMARY" ? node.parentNode : node;
  for (let current = from?.parentNode; current; current = current.parentNode) {
    if (current.getAttribute?.("id") === "site-footer-directory") return true;
  }
  return false;
}

// A closed disclosure's contents are still in this harness's tab sequence — a
// stated gap in tests/support/browser.js — so they are dropped here, which is
// the order a browser actually gives.
function browserTabSequence(document) {
  const directory = document.querySelector("#site-footer-directory");
  const closed = directory && !directory.hasAttribute("open");
  return tabSequence(document).filter((stop) => !(closed && insideDirectory(stop)));
}

/* ---------------------------- the reading order --------------------------- */

test("on every task page the follow-up block is read before the directory", async () => {
  for (const file of TASK_PAGES) {
    const document = await parse(file);
    const band = elementChildren(document.querySelector(".site-footer-inner"));
    const indexOf = (predicate) => band.findIndex(predicate);

    const invitation = indexOf((node) => (node.getAttribute("class") ?? "") === "site-footer-invitation");
    const panel = indexOf((node) => node.getAttribute("id") === "site-footer-panel");
    const directory = indexOf((node) => node.getAttribute("id") === "site-footer-directory");

    assert.ok(invitation >= 0, `${file}: the follow-up block lost its heading line`);
    assert.ok(panel >= 0, `${file}: the follow-up block lost its panel`);
    assert.ok(directory >= 0, `${file}: the directory is not a child of the band`);
    assert.ok(invitation < directory, `${file}: the directory is read before the follow-up heading`);
    assert.ok(panel < directory, `${file}: the directory is read before the follow-up form`);
    // Last, not merely late: nothing of the band follows the map.
    assert.equal(directory, band.length - 1, `${file}: something was added after the directory`);
    assert.equal(textOf(band[invitation]), INVITATION, `${file}: the follow-up heading line changed`);
  }
});

test("on every task page the submit control precedes the disclosure in the tab order", async () => {
  for (const file of TASK_PAGES) {
    const document = await parse(file);
    const stops = browserTabSequence(document);
    const summary = stops.findIndex((stop) => stop.getAttribute("id") === "site-footer-directory-summary");
    const submit = stops.findIndex((stop) => stop.tagName === "BUTTON"
      && textOf(stop) === "Request a follow-up");

    assert.ok(submit >= 0, `${file}: the follow-up action is not a tab stop`);
    assert.ok(summary >= 0, `${file}: the disclosure is not a tab stop`);
    assert.ok(submit < summary, `${file}: a reader meets the site map before the follow-up action`);
    // Closed, the whole map costs one stop rather than nine.
    assert.equal(stops.filter(insideDirectory).length, 0, `${file}: a folded map still costs tab stops`);
    assert.equal(summary, stops.length - 1, `${file}: the summary is not the last stop on the page`);
  }
});

/* --------------------------- one, named the same -------------------------- */

test("the five pages ship one disclosure, closed, named the same way on each", async () => {
  for (const file of TASK_PAGES) {
    const document = await parse(file);

    assert.equal(document.querySelectorAll("#site-footer-directory").length, 1,
      `${file}: a page ships one directory or none, never two`);
    const directory = document.querySelector("#site-footer-directory");
    assert.equal(directory.tagName, "DETAILS", `${file}: the control must be a native disclosure`);
    // `undefined` here, never `false`: equality against false would pass on a
    // page that ships the disclosure open.
    assert.ok(!directory.open, `${file}: the directory must ship collapsed`);
    assert.equal(directory.getAttribute("open"), null, `${file}: the directory ships expanded`);

    const summary = document.querySelector("#site-footer-directory-summary");
    assert.equal(summary.tagName, "SUMMARY", `${file}: the handle must be a summary`);
    assert.equal(summary.parentNode.getAttribute("id"), "site-footer-directory",
      `${file}: a summary that is not the disclosure's own child is not its control`);
    // The accessible name, explicit and identical on all five: what is behind it
    // and how much of it, so opening is not the only way to learn the size.
    assert.equal(textOf(summary), DIRECTORY_SUMMARY, `${file}: the disclosure is named differently here`);
    assert.match(textOf(summary), new RegExp(`\\b${DEMOS.length}\\b`), `${file}: the count is not stated`);
    // The band's existing caption role, not a style of its own.
    assert.equal(summary.getAttribute("class"), "site-footer-note", `${file}: a new type role appeared`);
    // The list is inside it, and it is the only one on the page.
    assert.equal(document.querySelectorAll(".site-footer-demos").length, 1, `${file}: two destination lists`);
    assert.equal(insideDirectory(document.querySelector(".site-footer-demos")), true,
      `${file}: the list is not the thing the disclosure hides`);
  }
});

test("no destination was dropped, merged or renamed on any of the five", async () => {
  for (const file of TASK_PAGES) {
    const document = await parse(file);
    const rows = document.querySelector(".site-footer-demos").querySelectorAll("li");
    assert.equal(rows.length, DEMOS.length, `${file}: the directory lost or gained a row`);
    for (const [index, demo] of DEMOS.entries()) {
      const link = rows[index].querySelectorAll("a")[0];
      assert.equal(textOf(link), demo.label, `${file}: destination ${index} was renamed`);
      assert.equal(link.getAttribute("href"), demo.href, `${file}: destination ${index} changed address`);
    }
  }
});

/* ----------------------------- the keyboard ------------------------------- */

test("the disclosure opens and closes from the keyboard without moving focus", async () => {
  for (const file of TASK_PAGES) {
    const document = await parse(file);
    const directory = document.querySelector("#site-footer-directory");
    const summary = document.querySelector("#site-footer-directory-summary");

    summary.focus();
    pressEnter(document);
    assert.ok(directory.hasAttribute("open"), `${file}: Enter did not open the disclosure`);
    assert.equal(document.activeElement.getAttribute("id"), "site-footer-directory-summary",
      `${file}: opening the disclosure moved focus somewhere the reader did not ask for`);

    // Every row is reachable now, in the order the band declares them, and the
    // first Tab from the handle lands on the first of them — no trap, no skip.
    const reachable = browserTabSequence(document).filter(insideDirectory);
    assert.deepEqual(reachable.map(textOf), DEMOS.map((demo) => demo.label),
      `${file}: an expanded directory must offer every destination, in order`);
    assert.equal(textOf(pressTab(document)), DEMOS[0].label, `${file}: Tab skipped past the first destination`);

    // Shift+Tab comes straight back out to the handle: nothing holds a reader in.
    assert.equal(textOf(pressTab(document, { shift: true })), DIRECTORY_SUMMARY,
      `${file}: a reader cannot get back out of the disclosure`);

    // Space closes it again, on the same control, with focus still there.
    pressSpace(document);
    assert.ok(!directory.hasAttribute("open"), `${file}: Space did not close the disclosure`);
    assert.equal(document.activeElement.getAttribute("id"), "site-footer-directory-summary",
      `${file}: closing the disclosure moved focus`);
  }
});

/* ------------------------ the pages that stay open ------------------------ */

test("the pages a reader arrives at from inside the site keep the open list", async () => {
  for (const file of OPEN_PAGES) {
    const document = await parse(file);
    assert.equal(document.querySelectorAll("#site-footer-directory").length, 0,
      `${file}: folded its directory away too`);
    const rows = document.querySelector(".site-footer-demos").querySelectorAll("li");
    assert.equal(rows.length, DEMOS.length, `${file}: lost a destination`);
  }
});

/* -------------------- layout claims, read off the rules ------------------- */

// This harness has no viewport and no box model, so the 390px and desktop
// criteria are asserted against the shipped stylesheet: the rules that keep the
// label and the rows from clipping, the tap target on the one new control, and
// the focus token the band already uses. Verified by rule inspection, not by
// rendering — stated plainly here and in the PR body.
test("the disclosure's size, wrapping and focus rules are in product CSS", async () => {
  const css = await readFile(new URL("styles.css", SRC), "utf8");

  // Focus: the band's own ring token, covering the one control in it that is
  // neither a link, a button nor a field.
  assert.match(css, /\.site-footer summary:focus-visible[^{]*\{ outline:3px solid var\(--focus-ring\)/,
    "the disclosure must take the band's focus ring");

  // Tap target: the summary carries the band's 12px caption type, so its own
  // line box is under 20px. The padding below takes it past 44px without
  // inventing a chip, a border or a colour.
  const summaryRule = css.match(/\.site-footer summary \{([^}]*)\}/);
  assert.ok(summaryRule, "the summary rule is gone");
  const padding = summaryRule[1].match(/padding:(\d+)px 0/);
  assert.ok(padding, "the summary must reserve vertical padding for a tap target");
  assert.ok(Number(padding[1]) * 2 + 19 >= 44,
    `a ${padding[1]}px pad on a 12px/1.55 line is under a 44px target`);
  assert.match(summaryRule[1], /cursor:pointer/, "the handle must read as a control under a pointer");

  // No clipping at any width: the list is a grid with a reading measure and no
  // fixed height, so the label and every row wrap rather than overflow, and the
  // band's inner measure is already viewport-relative at 390px.
  const demos = css.match(/\.site-footer-demos \{([^}]*)\}/);
  assert.ok(demos, "the destination list lost its rule");
  assert.match(demos[1], /max-width:66ch/, "the rows must wrap at a reading measure");
  assert.doesNotMatch(demos[1], /(?:^|[;\s])(?:max-)?height:|overflow:|white-space:nowrap/,
    "nothing here may clip a wrapped row");
  // Row spacing, so two adjacent link targets are not within a 24px circle of
  // each other once the disclosure is open.
  const gap = demos[1].match(/gap:(\d+)px/);
  assert.ok(gap && Number(gap[1]) >= 9, `a ${gap?.[1]}px row gap crowds adjacent link targets`);
  assert.match(css, /\.site-footer-inner \{[^}]*width:min\(1180px,calc\(100% - 40px\)\)/,
    "the band's measure must stay viewport-relative");

  // And the disclosure still buys no rule of its own: this change adds no new
  // colour, type or spacing value to the design system.
  assert.doesNotMatch(css, /site-footer-directory/, "the disclosure grew a rule of its own");
});
