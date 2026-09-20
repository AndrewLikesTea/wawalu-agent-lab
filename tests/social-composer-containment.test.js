// Focus containment in the Social composer (#2456).
//
// The composer already opened onto its heading, returned focus to the exact
// opener on Escape and Close, and listed its refusals in a focusable error
// summary. What it did not do was hold Tab inside itself: from Close, the next
// Tab walked out of the panel into the feed behind it, and Shift+Tab from the
// heading did the same in the other direction.
//
// HARNESS NOTES. This file deliberately does NOT prove containment by tabbing.
// `pressTab` in tests/support/browser.js restarts at stop 0 rather than
// modelling a ring, so a walk that looks contained here would look contained
// against an implementation that does nothing at all. The decision is therefore
// tested as a decision — `nextContainedStop` over a plain list — and the list it
// decides over is tested against the real parsed panel. The flow tests below
// dispatch a Tab keydown at the page and assert where focus actually landed,
// which is the part the handler owns.
//
// Every assertion compares strings, numbers or booleans. An assertion with a
// parsed element as an operand spends minutes inspecting the whole page and
// outlives --test-timeout, so elements are named by id before they reach assert.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { composerFocusables, mountSocialFeed, nextContainedStop } from "../src/social.js";
import { DomEvent, loadPage, textOf } from "./support/browser.js";

async function setup(t) {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const feed = mountSocialFeed(page.document, { posts: [], state: "ready", storage: page.storage });
  const id = (name) => page.document.querySelector(`#${name}`);
  return { ...page, feed, id };
}

// Named by id where there is one and by class where there is not, the same way
// tests/social-composer-keyboard.test.js names the Paint link — the one composer
// control without an id, and the stop a name-list check silently drops.
const nameOf = (node) => (node ? node.id || node.getAttribute("class") || textOf(node).trim() : "nothing");

// DomEvent keeps `key` but not `shiftKey`, so the modifier is set on the event
// after it is built. Returned so a test can ask whether the handler claimed the
// press — a Tab in the middle of the ring must be left to the browser.
function pressTabKey(document, { shift = false } = {}) {
  const target = document.activeElement;
  assert.ok(target, "nothing is focused, so Tab has no target");
  const event = new DomEvent("keydown", { bubbles: true, key: "Tab" });
  event.shiftKey = shift;
  target.dispatchEvent(event);
  return event;
}

// ---------------------------------------------------------------------------
// The wrap decision, over a list that is just strings. No DOM is involved on
// purpose: this is the half that says which way Tab goes at each edge, and it
// is worth being able to read that off without a parsed page in the way.
// ---------------------------------------------------------------------------

test("Tab wraps at both ends of the composer's ring and is left alone in the middle", () => {
  const stops = ["first", "middle", "last"];

  // Forward off the end comes back to the front; backward off the front goes to
  // the end. These two are the containment.
  assert.equal(nextContainedStop(stops, "last", false), "first");
  assert.equal(nextContainedStop(stops, "first", true), "last");

  // Everywhere else the browser's own Tab already lands inside the composer, so
  // the handler declines. `null` is what says "do not preventDefault" — a
  // version of this that returned the next stop everywhere would still look
  // right in a flow test while taking over every press in the form.
  assert.equal(nextContainedStop(stops, "first", false), null);
  assert.equal(nextContainedStop(stops, "middle", false), null);
  assert.equal(nextContainedStop(stops, "middle", true), null);
  assert.equal(nextContainedStop(stops, "last", true), null);

  // The composer's two script-focused nodes — the heading open() lands on and
  // the error summary a refused publish lands on — are focusable but are not
  // stops, so focus sits off the list. Forward from there is the first stop,
  // which is what a browser would have done anyway; backward is the last, which
  // is the direction that would otherwise leave the panel.
  assert.equal(nextContainedStop(stops, "post-form-title", false), "first");
  assert.equal(nextContainedStop(stops, "post-form-title", true), "last");

  // A ring with one stop in it is still a ring.
  assert.equal(nextContainedStop(["only"], "only", false), "only");
  assert.equal(nextContainedStop(["only"], "only", true), "only");

  // Nothing to contain: the handler must not preventDefault a press it cannot
  // answer, or Tab would stop working entirely inside an empty panel.
  assert.equal(nextContainedStop([], "anything", false), null);
  assert.equal(nextContainedStop([], "anything", true), null);
});

// ---------------------------------------------------------------------------
// The list, over the real parsed panel.
// ---------------------------------------------------------------------------

test("the composer's ring is its visible, enabled controls in layout order", async (t) => {
  const { id } = await setup(t);
  id("post-compose-open").click();

  // With no image chosen, #compose-media ships hidden — and BOTH Remove image
  // and the image description live inside it, because with no image there is
  // nothing to remove and nothing to describe. A control in a hidden subtree is
  // not a stop, and walking into that subtree anyway is the mistake this
  // asserts against: it would put two dead stops in the ring and make Tab from
  // Choose image land on a field nobody can see.
  assert.deepEqual(composerFocusables(id("post-compose-panel")).map(nameOf), [
    "post-body", "secondary-button paint-link", "post-image",
    "post-author", "post-submit", "post-compose-cancel",
  ]);

  // The image arrives and both join the ring, in the place the visual layout
  // puts them: after the picker, and the description after the control it is
  // about.
  id("compose-media").hidden = false;
  assert.deepEqual(composerFocusables(id("post-compose-panel")).map(nameOf), [
    "post-body", "secondary-button paint-link", "post-image", "remove-image",
    "post-image-alt", "post-author", "post-submit", "post-compose-cancel",
  ]);

  // This is the order the shipped tab sequence walks
  // (tests/social-composer-keyboard.test.js), which is the point: containment
  // must not invent an order of its own for the ring's two ends.
  const stops = composerFocusables(id("post-compose-panel")).map(nameOf);
  assert.equal(stops[0], "post-body");
  assert.equal(stops[stops.length - 1], "post-compose-cancel");
});

test("a disabled Publish post leaves the ring, and the heading and error summary are never in it", async (t) => {
  const { id } = await setup(t);
  id("post-compose-open").click();
  const names = () => composerFocusables(id("post-compose-panel")).map(nameOf);

  // Publish post is disabled while a rejected file is still selected
  // (src/social-page.js setSelectionProblem), so this is a state the ring really
  // enters. A real browser skips a disabled control; this harness never blurs
  // one, which is why the list — not activeElement — is what gets asserted.
  assert.equal(names().includes("post-submit"), true);
  id("post-submit").disabled = true;
  assert.equal(names().includes("post-submit"), false);
  assert.equal(names()[names().length - 1], "post-compose-cancel");
  id("post-submit").disabled = false;

  // Both carry tabindex="-1": script focuses them, Tab never reaches them.
  // Revealed first, so this is about the tabindex rule and not about `hidden`
  // answering for free.
  id("post-error-summary").hidden = false;
  assert.equal(names().includes("post-error-summary"), false);
  assert.equal(names().includes("post-form-title"), false);

  // And nothing in the ring carries a positive tabindex, so the ring's order is
  // the document's order.
  for (const node of composerFocusables(id("post-compose-panel"))) {
    const declared = node.getAttribute("tabindex");
    assert.ok(declared === null || Number(declared) <= 0, `${nameOf(node)} declares tabindex ${declared}`);
  }
});

// ---------------------------------------------------------------------------
// The handler, at the page.
// ---------------------------------------------------------------------------

test("Tab from the last control returns to the first instead of leaving the composer", async (t) => {
  const { document, id } = await setup(t);
  id("post-compose-open").click();
  id("compose-media").hidden = false;

  id("post-compose-cancel").focus();
  const event = pressTabKey(document);
  assert.equal(event.defaultPrevented, true, "the press was left to the browser and would have left the panel");
  assert.equal(document.activeElement?.id, "post-body");
});

test("Shift+Tab from the first control and from the heading both reach Close", async (t) => {
  const { document, id } = await setup(t);
  id("post-compose-open").click();
  id("compose-media").hidden = false;

  id("post-body").focus();
  assert.equal(pressTabKey(document, { shift: true }).defaultPrevented, true);
  assert.equal(document.activeElement?.id, "post-compose-cancel");

  // open() lands on the heading. Backward from there used to walk straight out
  // of the panel and into the page header above it.
  id("post-form-title").focus();
  assert.equal(pressTabKey(document, { shift: true }).defaultPrevented, true);
  assert.equal(document.activeElement?.id, "post-compose-cancel");
});

test("Tab in the middle of the composer is left to the browser", async (t) => {
  const { document, id } = await setup(t);
  id("post-compose-open").click();

  id("post-body").focus();
  const event = pressTabKey(document);
  assert.equal(event.defaultPrevented, false, "the handler took over a press it should have declined");
  // Declined means not moved by us: focus is still where the browser would move
  // it from, because this harness does not act on an un-prevented Tab.
  assert.equal(document.activeElement?.id, "post-body");
});

test("a refused publish leaves focus on the error summary, and Tab from there enters the form", async (t) => {
  const { document, id } = await setup(t);
  id("post-compose-open").click();
  // The shape a refused publish leaves behind: the summary shown and focused
  // (src/social.js). It is not a tab stop, so the ring has to take the press.
  id("post-error-summary").hidden = false;
  id("post-error-summary").focus();

  assert.equal(pressTabKey(document).defaultPrevented, true);
  assert.equal(document.activeElement?.id, "post-body");
});

test("a closed composer contains nothing and Escape still closes it", async (t) => {
  const { document, id } = await setup(t);
  const trigger = id("post-compose-open");
  trigger.focus();
  trigger.click();
  assert.equal(id("post-compose-panel").hidden, false);

  // Regression guard: Escape and Tab now share one keydown listener, and the
  // Escape half is what returns focus to the opener.
  id("post-compose-cancel").focus();
  const escape = new DomEvent("keydown", { bubbles: true, key: "Escape" });
  document.activeElement.dispatchEvent(escape);
  assert.equal(id("post-compose-panel").hidden, true);
  assert.equal(document.activeElement?.id, "post-compose-open");

  // A hidden panel holds no stops, so nothing is contained while it is closed.
  assert.equal(composerFocusables(id("post-compose-panel")).length, 0);
});

// ---------------------------------------------------------------------------
// 390px. No module on this page reads matchMedia or innerWidth, so a viewport
// shim would assert only itself. What decides whether the ring is operable at
// 390px is CSS, so the CSS is what is asserted: the focus ring the contained
// stops paint comes from the shared token, in a width the narrow layout keeps.
// ---------------------------------------------------------------------------

test("the composer's focus indicators come from the shared token and survive a 390px column", async () => {
  const composerCss = await readFile(new URL("../src/social-composer.css", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  // The two script-focused nodes the ring hands off to. Their outline is the
  // product token, not a local colour, so contrast holds in both themes.
  assert.match(composerCss, /#post-form-title:focus-visible, #post-error-summary:focus-visible \{ outline:3px solid var\(--focus-ring\)/);
  // The stops themselves.
  assert.match(css, /input:focus-visible[^{}]+\{ outline:3px solid var\(--focus-ring\); outline-offset:2px;/);
  // A contained ring is only operable if every stop in it can be reached and
  // seen at 390px: nothing in the composer may establish a minimum width that
  // outgrows the column, and a wrapped control still scrolls clear of the edge.
  assert.match(composerCss, /#post-compose-panel, #post-form, #post-form \.field\s*\{ min-width:0;/);
  assert.match(composerCss, /#post-form input, #post-form textarea, #post-form button \{ scroll-margin-block:24px;/);
});
