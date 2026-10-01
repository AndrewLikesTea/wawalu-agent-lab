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
import { FOLLOW_UP_INTENTS, FOLLOW_UP_REPLY } from "../src/lead-capture.js";
import { initReleasesPage } from "../src/releases-page.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { OFFER } from "../src/site-footer.js";
import { importPageModule } from "./support/page-module.js";
import { loadPage, parseHtml, pressEnter, tabSequence, textOf } from "./support/browser.js";

const HOME_LABEL = "Request a demonstration";
// Since #2623 this line describes two controls that DO the errand rather than
// one that names it, so it says what activating either one does — the shape the
// other five pages already use — instead of instructing a reader to go and use
// the form themselves. It names what is shown, never what is sent: the topic
// stays on this page, and the sentence beside the field says so too.
const HOME_DESCRIPTION = "Both actions move you to the follow-up form at the foot of this page and name your chosen topic above its field. The form sends your work email address and nothing else.";

const PANEL_ID = ASK_ABOUT_SHIPLOG_HREF.slice(1);

async function openHome(t) {
  const page = await loadPage(new URL("../src/index.html", import.meta.url), {
    storage: { [STORAGE_KEY]: "[]", [RELEASE_STORAGE_KEY]: "[]" },
  });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage);
  await importPageModule("/homepage-buyer-intent.js");
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
  test(`${name} paints one named route to the follow-up form`, async (t) => {
    const page = await open(t);
    const { document } = page;

    const routes = document.querySelectorAll("a")
      .filter((link) => link.getAttribute("id") === ASK_ABOUT_SHIPLOG_ID);
    assert.equal(routes.length, 1, `${name}: the page paints ${routes.length} routes, not one`);
    const [route] = routes;

    // The accessible name is the visible text: no aria-label saying something
    // else, and no icon standing in for the words.
    assert.equal(textOf(route), name === "the home page" ? HOME_LABEL : ASK_ABOUT_SHIPLOG_LABEL);
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
    assert.equal(textOf(described[0]), name === "the home page" ? HOME_DESCRIPTION : ASK_ABOUT_SHIPLOG_DESCRIPTION);
    assert.equal(tabSequence(document).filter((node) => node === described[0]).length, 0,
      `${name}: the description became a tab stop`);

    // #2689: and the caption does not make the promise the form it points at
    // already makes. Painted, and counted across the whole page: the footer
    // here is drawn by site-footer.js, so the one surviving copy is the one a
    // reader meets beside the work-email field.
    const replies = document.querySelectorAll("p").filter((node) => textOf(node) === FOLLOW_UP_REPLY);
    assert.equal(replies.length, 1, `${name}: the reply promise is painted ${replies.length} times`);
    assert.equal(replies[0].getAttribute("id"), "site-footer-reply",
      `${name}: the surviving copy is not the form's own`);
  });

  test(`${name} lands the route on the form, not merely at its scroll position`, async (t) => {
    const page = await open(t);
    const { document } = page;
    const panel = document.getElementById(PANEL_ID);

    // Focusable as a target and not as a stop: the panel takes focus when the
    // route is followed, and nothing joined the tab order to make that work.
    assert.equal(panel.getAttribute("tabindex"), name === "the home page" ? null : "-1");
    assert.equal(tabSequence(document).filter((node) => node === panel).length, 0,
      `${name}: the form's container became a tab stop of its own`);

    const route = document.getElementById(ASK_ABOUT_SHIPLOG_ID);
    route.focus();
    pressEnter(document);
    assert.equal(document.activeElement?.getAttribute("id"), name === "the home page" ? "site-footer-email" : PANEL_ID,
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
// where it goes and what the form there asks for — and it is the same line,
// from one constant, on all six pages that carry the route. What comes back is
// promised at the form and only there, which is what #2689 counts below.
const CARRYING_PAGES = [
  "index.html", "releases.html", "coach.html", "social.html", "profile.html", "agents.html",
];

const readPage = async (file) => parseHtml(
  await readFile(new URL(`../src/${file}`, import.meta.url), "utf8"));

test("the sentence itself says where and what is asked — and promises nothing else", () => {
  // One sentence, no more: this is a caption under a link, not a section.
  assert.equal((ASK_ABOUT_SHIPLOG_DESCRIPTION.match(/[.!?]/g) ?? []).length, 1);
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

  // What comes back is NOT said here. #2689: the caption used to end on
  // FOLLOW_UP_REPLY byte for byte, and the form it points at renders the same
  // sentence above its button, so a reader met one promise twice inside a
  // scroll. It is made once, where it is made: at the form.
  assert.ok(!ASK_ABOUT_SHIPLOG_DESCRIPTION.includes(FOLLOW_UP_REPLY),
    "the caption repeats the promise the form makes beside its own button");
  assert.doesNotMatch(ASK_ABOUT_SHIPLOG_DESCRIPTION, /\breplie?s?\b|working days/i,
    "a paraphrase of the reply window is the same duplicate in other words");

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

test("all six pages carry their follow-up description once at the label", async () => {
  for (const file of CARRYING_PAGES) {
    const document = await readPage(file);

    const described = describedBy(document);
    assert.equal(described.length, 1, `${file}: the description ships ${described.length} times`);
    assert.equal(textOf(described[0]), file === "index.html" ? HOME_DESCRIPTION : ASK_ABOUT_SHIPLOG_DESCRIPTION);

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

    // And the promise the form makes is made once on the whole page, at the
    // form. #2689: the caption ended on the same sentence, so these pages said
    // it twice within one scroll — once describing a destination and once at
    // it. Counted across the document rather than inside the caption, so
    // putting the duplicate back anywhere fails here.
    const replies = document.querySelectorAll("p").filter((node) => textOf(node) === FOLLOW_UP_REPLY);
    assert.equal(replies.length, 1, `${file}: the reply promise ships ${replies.length} times`);
    assert.equal(replies[0].getAttribute("id"), "site-footer-reply",
      `${file}: the surviving copy is not the one beside the work-email field`);

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

/* ------------- what each of the two offers is, said before the ask --------- */

// #2606. The home page's label offers a demonstration or a pilot and the page
// never said what either one is, so a first-time visitor had to raise their hand
// to find out. The two topics are named in full lower down the page, but only as
// the pair of controls homepage-buyer-intent.js draws, which is below the story
// and below the coach. The line pinned here says who does what in each one, in
// the row where the ask is made.
const OFFERS_ID = "ask-about-shiplog-offers";
const HOME_OFFERS = "“A product demonstration” is a walkthrough: the Wawalu team that"
  + " operates Shiplog shows you the log and answers your questions. “A pilot evaluation”"
  + " is your own team trying Shiplog and scoring it on the blank pilot scorecard further"
  + " down this page.";

/** Counted rather than fetched by id, so "renders twice" fails here. */
const offersIn = (root) => root.querySelectorAll("p")
  .filter((node) => node.getAttribute("id") === OFFERS_ID);

test("the home page says what each of the two offers is, at the ask", async (t) => {
  const { document } = await openHome(t);

  const painted = offersIn(document);
  assert.equal(painted.length, 1, `the line is painted ${painted.length} times, not once`);
  assert.equal(textOf(painted[0]), HOME_OFFERS);

  // The two topics are quoted in the words the five footer forms render for
  // them, byte for byte from the one map, so a reader can match each sentence to
  // the option they will pick rather than translating between two wordings.
  for (const intent of ["demo", "pilot"]) {
    assert.ok(textOf(painted[0]).includes(`“${FOLLOW_UP_INTENTS[intent]}”`),
      `the line does not quote "${FOLLOW_UP_INTENTS[intent]}" as the form names it`);
  }

  // Each label is followed by who does the work in it: the team that operates
  // Shiplog in one, the evaluating team in the other.
  assert.match(textOf(painted[0]),
    /“A product demonstration” is a walkthrough: the Wawalu team that operates Shiplog/);
  assert.match(textOf(painted[0]), /“A pilot evaluation” is your own team trying Shiplog/);

  // It reads above the line that says how the request is sent: what you are
  // asking for, then how to ask for it.
  const row = painted[0].parentNode;
  const order = row.querySelectorAll("p").map((node) => node.getAttribute("id"));
  assert.deepEqual(order, [OFFERS_ID, ASK_ABOUT_SHIPLOG_DESCRIPTION_ID],
    "the row must explain the two offers before it explains how to send the request");
  assert.ok(row.getAttribute("class").includes("hero-actions"),
    "the line must sit in the row the ask is made in");
});

test("the scorecard the pilot sentence names is on this page, under that name", async (t) => {
  const { document } = await openHome(t);

  // Named the way the page already names it, in one copy, and the words point
  // down the page at it rather than at a destination that would have to exist.
  const scorecards = document.querySelectorAll("#shiplog-pilot-scorecard");
  assert.equal(scorecards.length, 1, "the home page no longer carries the pilot scorecard");
  assert.equal(textOf(document.getElementById("shiplog-pilot-scorecard-title")),
    "Shiplog pilot scorecard");
  const offer = document.getElementById("shiplog-entry");
  assert.match(textOf(offer), /blank pilot scorecard further down this page/,
    "the pilot sentence must name and place the scorecard");

  // And the route to it is the one this section already published, two
  // sentences above: no second link to the same material.
  assert.equal(offer.querySelectorAll('a[href="#shiplog-evaluation-brief"]').length, 1,
    "the section's existing route to the brief and blank scorecard is gone or doubled");
  assert.equal(offer.querySelectorAll('a[href="#shiplog-pilot-scorecard"]').length, 0,
    "a second route to the scorecard would publish one address twice in one region");
});

test("the line costs no control, and the ask still says how the request is sent", async (t) => {
  const { document } = await openHome(t);
  const [line] = offersIn(document);

  // Prose, three ways: this page is at its tab-stop budget and a focusable added
  // above the first screen reds tests on other pages.
  assert.equal(line.tagName, "P");
  assert.equal(line.getAttribute("class"), "hint", "the line introduced a class of its own");
  assert.equal(line.getAttribute("tabindex"), null);
  assert.equal(line.querySelectorAll("a").length, 0, "the line drew a link");
  assert.equal(line.querySelectorAll("button").length, 0, "the line drew a button");
  assert.equal(tabSequence(document).filter((node) => node === line).length, 0,
    "the line became a tab stop");

  // The row still carries what it carried: the form the request goes through.
  // What comes back is not promised here — #2689 left that sentence at the
  // form, and the page-wide count above pins it to one copy.
  const row = textOf(line.parentNode);
  assert.match(row, /follow-up form at the foot of this page/);
  assert.ok(!row.includes(FOLLOW_UP_REPLY),
    `the row promises a reply the form below already promises: ${FOLLOW_UP_REPLY}`);

  // And the answer above it is said once, not twice: the offer paragraph states
  // the signup and price position, and the new line does not restate it.
  const section = textOf(document.getElementById("shiplog-entry"));
  assert.equal(section.split("no self-serve signup").length - 1, 1,
    "the no-signup sentence is stated twice in one section");
  assert.doesNotMatch(textOf(line), /self-serve signup|published price|answered on request/,
    "the line repeats the availability answer the paragraph above already gives");
});

test("the line promises no schedule, price, customer or result", () => {
  for (const overreach of [
    /\d/,
    /\bprice|pricing|\$|\bcost\b|\bquote\b|\bfree\b|\btrial\b/i,
    /\bweeks?\b|\bdays?\b|\bhours?\b|\bminutes?\b|\bsoon\b|\bschedule\b|\bbook\b/i,
    /\bcustomers?\b|\bclients?\b|\bcase study\b|\bused by\b|\bsaved\b|\bfaster\b/i,
    /\bguarantee|\bwe['’]ll\b|\bsign ?up\b|\bavailable\b/i,
  ]) {
    assert.doesNotMatch(HOME_OFFERS, overreach,
      `the line makes a claim this page cannot keep: ${overreach}`);
  }
  // Two sentences, one per offer: this is a caption in an action row.
  assert.equal((HOME_OFFERS.match(/[.!?]/g) ?? []).length, 2);
});

test("only the home page carries it, because only the home page carries the scorecard", async () => {
  for (const file of CARRYING_PAGES) {
    const document = await readPage(file);
    assert.equal(offersIn(document).length, file === "index.html" ? 1 : 0,
      `${file}: the line describes a scorecard this page does not carry`);
    if (file !== "index.html") continue;
    // Shipped in the markup and not painted in: a reader whose script never ran
    // still learns what the two offers are before following the route.
    assert.equal(textOf(offersIn(document)[0]), HOME_OFFERS);
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
