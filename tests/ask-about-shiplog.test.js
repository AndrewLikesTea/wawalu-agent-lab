// The in-page route to the follow-up form: followed on the two pages whose own
// modules are cheap to run here, and read as shipped markup on all six that
// carry it.
//
// Issue #2458: a visitor who has decided to ask about Shiplog should not have to
// scroll a long page looking for the form. The route is deliberately a link and
// not a button — the address it carries is the one the evaluation brief
// publishes — so these tests read the painted DOM rather than the markup, and
// press the control rather than trusting the href.
//
// What is pinned here, and why each one:
//
//   1. The route exists after the page's own module ran, is named exactly, and
//      points at a container that exists on that page. A route to a fragment
//      nothing answers is a scroll to the bottom of the document.
//   2. Following it moves FOCUS, not only the scroll position. This harness
//      models no layout, so a scroll cannot be observed and a focus move can:
//      that is also the half a keyboard or screen-reader visitor depends on.
//   3. Neither page grew a second follow-up form. The route's whole point is
//      that the form already exists.
//   4. The availability and pricing sentences the ask leads to are unchanged.
//      A route that arrives at a softer answer is worse than no route.
//
// Counts and attributes throughout, never `assert.equal(node, null)`: comparing
// a harness element stringifies the whole parsed page and outlives the timeout.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { initDecisionLog, STORAGE_KEY } from "../src/app.js";
import {
  ASK_ABOUT_SHIPLOG_DESCRIPTION, ASK_ABOUT_SHIPLOG_DESCRIPTION_ID,
  ASK_ABOUT_SHIPLOG_HREF, ASK_ABOUT_SHIPLOG_ID, ASK_ABOUT_SHIPLOG_LABEL,
} from "../src/ask-about-shiplog.js";
import { FOLLOW_UP_REPLY } from "../src/lead-capture.js";
import { initReleasesPage } from "../src/releases-page.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { OFFER } from "../src/site-footer.js";
import { loadPage, parseHtml, pressEnter, tabSequence, textOf } from "./support/browser.js";

const PANEL_ID = ASK_ABOUT_SHIPLOG_HREF.slice(1);

async function openHome(t) {
  const page = await loadPage(new URL("../src/index.html", import.meta.url), {
    storage: { [STORAGE_KEY]: "[]", [RELEASE_STORAGE_KEY]: "[]" },
  });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage);
  return page;
}

async function openReleases(t) {
  const page = await loadPage(new URL("../src/releases.html", import.meta.url));
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, {
    location: { pathname: "/releases.html", origin: "https://labs.wawalu.org", search: "", hash: "" },
    history: { replaceState() {} },
  });
  return page;
}

const CARRIERS = [["the home page", openHome], ["the Releases page", openReleases]];

/** Counted rather than fetched by id, so "renders twice" fails instead of
 * silently returning the first one. */
const describedBy = (root) => root.querySelectorAll("p")
  .filter((node) => node.getAttribute("id") === ASK_ABOUT_SHIPLOG_DESCRIPTION_ID);

for (const [name, open] of CARRIERS) {
  test(`${name} paints one route named "${ASK_ABOUT_SHIPLOG_LABEL}" at the follow-up form`, async (t) => {
    const page = await open(t);
    const { document } = page;

    const routes = document.querySelectorAll("a")
      .filter((link) => link.getAttribute("id") === ASK_ABOUT_SHIPLOG_ID);
    assert.equal(routes.length, 1, `${name}: the page paints ${routes.length} routes, not one`);
    const [route] = routes;

    // The accessible name is the visible text: no aria-label saying something
    // else, and no icon standing in for the words.
    assert.equal(textOf(route), ASK_ABOUT_SHIPLOG_LABEL);
    assert.equal(route.getAttribute("aria-label"), null);
    assert.equal(route.getAttribute("href"), ASK_ABOUT_SHIPLOG_HREF);
    assert.equal(route.tagName, "A", "the route must be a real link, so a page with no script still arrives");

    // And the fragment it names is answered on this page.
    assert.equal(document.querySelectorAll(`#${PANEL_ID}`).length, 1,
      `${name}: the route points at #${PANEL_ID}, which this page does not carry`);

    // Reachable by Tab alone, like every other route on these pages.
    assert.ok(tabSequence(document).includes(route), `${name}: the route is not in the tab order`);

    // And the label is not on its own: the painted page carries the line saying
    // where the route goes and what the form asks for (#2556). Painted, because
    // a page whose modules rewrite its introduction would otherwise ship the
    // sentence to a test and not to a reader.
    const described = describedBy(document);
    assert.equal(described.length, 1, `${name}: the description is painted ${described.length} times`);
    assert.equal(textOf(described[0]), ASK_ABOUT_SHIPLOG_DESCRIPTION);
    assert.equal(tabSequence(document).filter((node) => node === described[0]).length, 0,
      `${name}: the description became a tab stop`);
  });

  test(`${name} lands the route on the form, not merely at its scroll position`, async (t) => {
    const page = await open(t);
    const { document } = page;
    const panel = document.getElementById(PANEL_ID);

    // Focusable as a target and not as a stop: the panel takes focus when the
    // route is followed, and nothing joined the tab order to make that work.
    assert.equal(panel.getAttribute("tabindex"), "-1");
    assert.equal(tabSequence(document).filter((node) => node === panel).length, 0,
      `${name}: the form's container became a tab stop of its own`);

    const route = document.getElementById(ASK_ABOUT_SHIPLOG_ID);
    route.focus();
    pressEnter(document);
    assert.equal(document.activeElement?.getAttribute("id"), PANEL_ID,
      `${name}: following the route left focus outside the follow-up form`);

    // What is in view on arrival: the band's own heading above the panel, the
    // sentence that invites the request, and the work-email field itself.
    assert.equal(panel.querySelectorAll("#site-footer-email").length, 1,
      `${name}: the work-email field is not inside the container the route lands on`);
    const band = document.getElementById("site-footer");
    assert.equal(textOf(band.querySelector("#site-footer-title")), "About Shiplog");
    assert.match(textOf(band.querySelector(".site-footer-invitation")), /follow-up request/);

    // The fragment is still reached, so the arrival stays shareable and the back
    // button undoes it: the focus move is added to the navigation, not put in
    // its place. Nothing left the page.
    assert.deepEqual(document.navigations, [ASK_ABOUT_SHIPLOG_HREF]);
  });

  test(`${name} still carries exactly one follow-up form`, async (t) => {
    const page = await open(t);
    const { document } = page;

    // Counted by what makes a form a follow-up form on this site — the submit
    // the Wawalu team receives — rather than by element identity. Its words are
    // deliberately untouched: a renamed submit enrols the form in the byte-exact
    // follow-up privacy and topic contracts.
    const asking = document.querySelectorAll("form").filter((form) => form
      .querySelectorAll("button")
      .some((button) => textOf(button) === "Request a follow-up"));
    assert.equal(asking.length, 1, `${name}: the page carries ${asking.length} follow-up forms`);
    assert.equal(asking[0].getAttribute("id"), "site-footer-form");
    assert.equal(document.querySelectorAll("#site-footer-email").length, 1);
  });

  test(`${name} still states what asking gets, unchanged`, async (t) => {
    const page = await open(t);
    const answer = textOf(page.document.getElementById("main-content"))
      + textOf(page.document.getElementById("site-footer"));

    // The two claims, sliced out of the shipped sentence rather than retyped, so
    // a rewrite of either half fails here instead of drifting quietly. One page
    // states them in its own product section and the other inside the form; both
    // must state them somewhere a reader following this route passes.
    for (const claim of OFFER.split(". ").map((part) => part.replace(/\.$/, ""))) {
      const shared = claim.slice(claim.indexOf("available") >= 0 ? claim.indexOf("available") : 0);
      assert.ok(answer.includes(shared), `${name}: the page no longer says "${shared}"`);
    }
    assert.match(answer, /no self-serve signup/);
    assert.match(answer, /answered on request/);
    // And no softer promise arrived with the route.
    for (const overreach of [/\bfree trial\b/i, /\bsign up\b/i, /\bstart now\b/i, /\bpricing page\b/i]) {
      assert.doesNotMatch(answer, overreach, `${name}: the route brought a claim this site cannot make`);
    }
  });
}

/* ---------------- what the label does not say, said once ------------------ */

// #2556. "Ask about Shiplog" is a errand with no destination in it: a reader
// who had not already scrolled to the foot of the page could reasonably expect
// a mail client, a pricing page, or a new tab. The line below the label says
// where it goes, what the form there asks for, and what comes back — and it is
// the same line, from one constant, on all six pages that carry the route.
const CARRYING_PAGES = [
  "index.html", "releases.html", "coach.html", "social.html", "profile.html", "agents.html",
];

const readPage = async (file) => parseHtml(
  await readFile(new URL(`../src/${file}`, import.meta.url), "utf8"));

test("the sentence itself says where, what is asked, and what comes back — and promises nothing else", () => {
  // Two sentences, no more: this is a caption under a link, not a section.
  assert.equal((ASK_ABOUT_SHIPLOG_DESCRIPTION.match(/[.!?]/g) ?? []).length, 2);
  assert.ok(ASK_ABOUT_SHIPLOG_DESCRIPTION.startsWith(ASK_ABOUT_SHIPLOG_LABEL),
    "it must name the control it describes, because it reads below a row that may hold two");

  // Where the route goes: down this page, to the form — not out of the page.
  assert.match(ASK_ABOUT_SHIPLOG_DESCRIPTION, /follow-up form at the foot of this page/);

  // What that form asks for, in the order the form asks it and in words a
  // reader will recognise when they get there.
  for (const asked of ["a work email address", "what you want to discuss", "an optional note"]) {
    assert.ok(ASK_ABOUT_SHIPLOG_DESCRIPTION.includes(asked),
      `the description does not say the form asks for ${asked}`);
  }

  // What comes back is the form's own sentence, byte for byte, rather than a
  // paraphrase of it. A reader who follows the route meets the same words
  // above the button; two wordings would be two promises to reconcile.
  assert.ok(ASK_ABOUT_SHIPLOG_DESCRIPTION.endsWith(FOLLOW_UP_REPLY),
    `the reply window has drifted from the form's own sentence: ${FOLLOW_UP_REPLY}`);

  // And nothing this site cannot answer here. Availability and price are
  // answered on request, which is what the form is for.
  for (const overreach of [
    /\bprice|pricing|\$\d|\bquote\b|\bcost\b/i,
    /\bsign ?up\b|\bfree trial\b|\bstart now\b/i,
    /\bemail us\b|\bnew tab\b/i,
  ]) {
    assert.doesNotMatch(ASK_ABOUT_SHIPLOG_DESCRIPTION, overreach,
      `the description makes a claim the route cannot keep: ${overreach}`);
  }
});

test("all six pages that offer the route carry that sentence, once, at the label", async () => {
  for (const file of CARRYING_PAGES) {
    const document = await readPage(file);

    const described = describedBy(document);
    assert.equal(described.length, 1, `${file}: the description ships ${described.length} times`);
    assert.equal(textOf(described[0]), ASK_ABOUT_SHIPLOG_DESCRIPTION);

    // At the entry point and nowhere else. Beside the form it would be a
    // caption for a destination the reader has already arrived at.
    const route = document.getElementById(ASK_ABOUT_SHIPLOG_ID);
    assert.ok(route, `${file}: the page no longer carries the route this line describes`);
    assert.ok(described[0].parentNode === route.parentNode,
      `${file}: the description is not in the row the label sits in`);
    assert.equal(route.getAttribute("aria-describedby"), ASK_ABOUT_SHIPLOG_DESCRIPTION_ID,
      `${file}: a screen-reader user hears the label without the line explaining it`);
    assert.equal(document.getElementById("site-footer")
      .querySelectorAll(`#${ASK_ABOUT_SHIPLOG_DESCRIPTION_ID}`).length, 0,
      `${file}: the description is repeated beside the form it points at`);

    // Static text, not a second control: every page here is at or near its
    // tab-stop budget, and a focusable above the first screen reds a test on
    // another page. Counted three ways rather than trusted.
    assert.equal(described[0].tagName, "P");
    assert.equal(described[0].getAttribute("tabindex"), null);
    assert.equal(described[0].querySelectorAll("a").length, 0, `${file}: the description drew a link`);
    assert.equal(described[0].querySelectorAll("button").length, 0, `${file}: the description drew a button`);

    // And the destination it names is on this page, in one copy, with the
    // work-email field inside it — so "at the foot of this page" is true.
    assert.equal(document.querySelectorAll(ASK_ABOUT_SHIPLOG_HREF).length, 1,
      `${file}: the route names a panel this page does not carry`);
    assert.equal(route.getAttribute("href"), ASK_ABOUT_SHIPLOG_HREF);
    assert.equal(document.getElementById(PANEL_ID).querySelectorAll("#site-footer-email").length, 1,
      `${file}: the work-email field the line promises is not inside the landing target`);

    // No new rule paid for it: the line reuses the site's existing hint style.
    assert.equal(described[0].getAttribute("class"), "hint",
      `${file}: the description introduced a class of its own`);
  }
});

// The action pair, checked as CSS rather than as a faked viewport: no module on
// either page reads matchMedia or innerWidth and this harness models no layout,
// so a viewport shim would assert only itself.
test("the row the route sits in wraps rather than overflowing at narrow widths", async () => {
  const sheet = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const rule = (selector) => sheet
    .match(new RegExp(`(?:^|[\\n{,])${selector.replace(/[.>]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

  const row = rule(".hero-actions");
  assert.match(row, /display:\s*flex/, ".hero-actions must lay the pair out as a row");
  assert.match(row, /flex-wrap:\s*wrap/, "the pair must wrap instead of overflowing");
  assert.doesNotMatch(row, /width:/, "a fixed width on the row is what would overflow");

  // And the narrow-width rule stacks that row full width, so neither control is
  // cut off on a 360px screen. Read out of the media block rather than assumed.
  const narrow = sheet.slice(sheet.indexOf("@media"));
  assert.match(narrow, /\.hero-actions\{[^}]*flex-direction:column/,
    "the narrow-width rule must stack the action row");

  // The route itself carries no width of its own to overflow with.
  assert.doesNotMatch(rule(".text-link"), /width:/);
});
