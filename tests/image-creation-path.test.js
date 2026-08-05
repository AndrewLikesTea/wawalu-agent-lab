// The route from browsing an image to making one.
//
// tests/paint-social-handoff.test.js covers the return leg — a finished drawing
// arriving at the Social composer. This covers the outbound one, which had no
// signposting at all: a visitor scrolling the Social feed or the People grid had
// only a nav item reading "Paint", which names a destination without saying what
// it is for, and the composer's own "Create in Paint" button sat several screens
// above them.
//
// What is pinned is what a keyboard user actually gets: a real anchor, in
// document order, inside the panel where the browsing happens, carrying a text
// label that says both the tool and the outcome — never an icon alone.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";
import { SOCIAL_COMPOSER_PATH } from "../src/paint-handoff.js";
import { initPaint, paintReturnContext } from "../src/paint/paint.js";
import { mountProfile, profilePaintHref } from "../src/profile.js";

const PAINT_PATH = "/paint/";
/** The editor, with or without the provenance the origin surface writes on it. */
const opensPaint = (href) => href === PAINT_PATH || href.startsWith(`${PAINT_PATH}?`);

const PAGES = {
  Social: new URL("../src/social.html", import.meta.url),
  People: new URL("../src/profile.html", import.meta.url),
};

/** The browsing panel on each page: the feed, and the image grid. */
const BROWSING_PANEL = { Social: "post-feed", People: "profile-grid" };

const sources = Object.fromEntries(await Promise.all(
  Object.entries(PAGES).map(async ([name, url]) => [name, await readFile(url, "utf8")])));
const documents = Object.fromEntries(
  Object.entries(sources).map(([name, html]) => [name, parseHtml(html)]));

// The nearby invitation is People's alone now. People has no composer, so the
// link beside its grid is the only route out of it; Social had three offers of
// the same feature in three voices, and this was the third — see
// "Social offers Paint exactly twice" below.
const NEARBY_INVITATION = { People: documents.People };

/** Every anchor on a page that points at the Paint editor. */
const paintLinks = (document) => document.querySelectorAll("a")
  .filter((anchor) => opensPaint(anchor.href));

/** The in-flow control: the composer's media picker offers exactly one link. */
const composerPaintLink = () => documents.Social.querySelector(".media-source-actions").querySelector("a");

/**
 * Social's Paint entry points: every route into Paint except the site's two
 * directories. The header nav lists every destination, and so does the footer's
 * site map — neither is an invitation this page extends, and counting them
 * would make "how many times does Social offer Paint" a question about the
 * frame rather than about the page.
 */
const socialEntryPoints = () => paintLinks(documents.Social)
  .filter((anchor) => !anchor.parentNode?.classList?.contains("site-nav") && !anchor.closest("#site-footer"));

for (const [name, document] of Object.entries(NEARBY_INVITATION)) {
  test(`${name} offers a labelled way to create an image, beside the images it shows`, () => {
    const invitation = document.querySelector(".feed-create");
    assert.ok(invitation, `${name} has no route from browsing an image to making one`);

    const link = invitation.querySelector("a");
    assert.equal(link.tagName, "A", "the route is not an anchor, so it is not open-in-new-tab-able");
    assert.ok(opensPaint(link.href), `${name}'s route does not open Paint: ${link.href}`);
    // The label names the tool in words. "↗" alone names nothing, and the
    // sentence around it is what makes "Paint" mean something — so that
    // sentence has to name what the route produces, not just point at it.
    assert.match(textOf(link), /Paint/);
    assert.doesNotMatch(textOf(link), /^[^A-Za-z]*$/, "the label carries no words");
    assert.match(textOf(invitation), /picture|image/i);

    // Both steps, in the order they happen. This used to be the empty state's
    // sentence alone, and the helper was pinned against repeating it — but the
    // empty state only renders for a name with no image posts, so a reader
    // looking at a full grid was told "Open Paint" and nothing about what
    // actually puts a picture in it. Paint publishes nothing, so naming the
    // editor without naming the publishing step is the defect now.
    const sentence = textOf(invitation);
    assert.match(sentence, /publish/i,
      `${name}'s helper stops at the editor and never says the image has to be published`);
    assert.ok(sentence.indexOf("Paint") < sentence.indexOf("Social"),
      `${name}'s helper names the two steps out of order`);
  });

  test(`${name} keeps the Paint route in the keyboard sequence, before the browsing panel`, () => {
    const sequence = tabSequence(document);
    const link = document.querySelector(".feed-create").querySelector("a");
    assert.ok(sequence.includes(link), `${name}'s Paint route is not keyboard reachable`);

    // Ahead of the browsing region it introduces: a reader tabbing through the
    // feed meets the invitation before the images, not after however many of
    // them there happen to be.
    assert.ok(document.getElementById(BROWSING_PANEL[name]),
      `${name} has no ${BROWSING_PANEL[name]} region`);
    assert.ok(sources[name].indexOf('class="feed-create')
      < sources[name].indexOf(`id="${BROWSING_PANEL[name]}"`),
    `${name} authors its Paint route after the images it is meant to introduce`);
  });
}

test("People's nearby helper links to the editor without repeating the empty-state choices", () => {
  const invitation = documents.People.querySelector(".feed-create");
  const hrefs = invitation.querySelectorAll("a").map((anchor) => anchor.href);
  assert.deepEqual(hrefs, ["/paint/?from=profile"]);
});

/* ---------------------------- the primary route ---------------------------- */
// The invitation above covers a reader already scrolling the feed. This covers
// the reader who has just arrived: the publishing path has to be on screen and
// stated as an outcome before any scrolling happens, because "Paint" in the nav
// names a destination without saying that it is how an image gets published.

/** The page's leading call to action: the primary control in its hero. */
const heroCta = (document) => document.querySelector(".hero-actions").querySelector("a");

test("Social leads with a call to action that names the act, not the destination alone", () => {
  const cta = heroCta(documents.Social);
  assert.equal(cta.tagName, "A", "the primary route is not an anchor");
  assert.ok(opensPaint(cta.href), `Social's primary route does not open Paint: ${cta.href}`);
  // Making an image, in words. "Paint" alone repeats the nav item beside it, an
  // arrow alone names nothing, and a colour alone names nothing a reader can
  // act on. It stops at the act: the empty state says where the image goes.
  assert.match(textOf(cta), /^Create an image in Paint/);
  assert.doesNotMatch(textOf(cta), /then (publish|post)/i,
    "the hero restates the publishing path the empty state already gives");
  assert.ok(tabSequence(documents.Social).includes(cta), "the primary route is not keyboard reachable");

  // Above the composer and the feed, in the source, so it is the first route a
  // reader meets rather than one more control inside the form.
  const html = sources.Social;
  assert.ok(html.indexOf('id="social-paint-cta"') < html.indexOf('id="post-form"'));
  assert.ok(html.indexOf('id="social-paint-cta"') < html.indexOf('id="post-feed"'));
});

test("People offers distinct Social and Paint routes from its entry point", () => {
  // Two distinct visible links in the page's opening section: back to every post
  // on Social, and on to the editor. Neither depends on an icon or a colour, and
  // each says which destination it goes to.
  const hero = documents.People.querySelector(".hero");
  const links = hero.querySelectorAll("a");
  const toPaint = links.filter((anchor) => opensPaint(anchor.href));
  const toSocial = links.filter((anchor) => anchor.href.startsWith("/social.html"));
  assert.equal(toPaint.length, 1, "People's entry point offers no single way into Paint");
  assert.equal(toSocial.length, 1, "People's entry point offers no single way back to Social");
  assert.match(textOf(toPaint[0]), /^Create an image in Paint/);
  assert.match(textOf(toSocial[0]), /Social/);

  const sequence = tabSequence(documents.People);
  for (const link of [toPaint[0], toSocial[0]]) {
    assert.ok(sequence.includes(link), `${textOf(link)} is not keyboard reachable`);
  }
  // The primary control carries the provenance, so Paint's back link returns
  // here rather than to Social.
  assert.equal(paintReturnContext(toPaint[0].href.slice(PAINT_PATH.length)).label, "Back to People");
});

test("both of People's routes into Paint follow the profile actually being read", async () => {
  const page = await loadPage(PAGES.People);
  try {
    const profile = mountProfile(page.document, { posts: [], author: "Ari" });
    profile.setAuthor("Mina O'Neil");
    for (const id of ["profile-paint-cta", "profile-paint-route"]) {
      const link = page.document.getElementById(id);
      assert.ok(link, `#${id} is missing from People`);
      assert.equal(link.href, profilePaintHref("Mina O'Neil"), `#${id} still points at the default persona`);
      assert.equal(paintReturnContext(link.href.slice(PAINT_PATH.length)).href, "/profile.html?author=Mina%20O'Neil");
    }
  } finally {
    page.restore();
  }
});

test("the composer's own Paint control is unchanged and still labelled in words", () => {
  const composer = composerPaintLink();
  assert.equal(composer.href, PAINT_PATH);
  assert.match(textOf(composer), /^Create in Paint/);
});

/* ------------------- one feature, offered exactly twice ------------------- */
// Social used to make the same offer three times in three voices: the hero's
// "Create an image in Paint", the composer's "Create in Paint", and a third
// paragraph beside the feed reading "Open Paint". Two of them are the feature —
// the standing invitation and the in-flow control — and this is the assertion
// that keeps a third from growing back.

test("Social offers Paint exactly twice: the standing invitation and the in-flow control", () => {
  // Four anchors in the page, and two of them are the site's directories — the
  // header nav's item and the footer site map's row. Paint is a destination on
  // this site, and every page lists it twice for that reason. The two that are
  // invitations are the ones counted here.
  assert.equal(paintLinks(documents.Social).length, 4, "the number of routes into Paint from Social changed");
  const entryPoints = socialEntryPoints();
  assert.equal(entryPoints.length, 2, "Social offers Paint more than twice again");
  assert.equal(entryPoints[0].id, "social-paint-cta", "the standing invitation is not the first offer");
  assert.equal(entryPoints[1], composerPaintLink(), "the composer's control is not the second offer");

  // One feature, two placements: both labels are "Create … in Paint", so the
  // two read as one thing offered where a reader is, not as two features.
  for (const link of entryPoints) assert.match(textOf(link), /^Create (an image )?in Paint/);

  // The removed third invitation named the destination alone. Nothing outside
  // the site nav may go back to naming it that way.
  const feedInvitations = documents.Social.querySelectorAll(".feed-create").length;
  assert.equal(feedInvitations, 0, "Social grew a third Paint invitation beside its feed again");
});

test("every Social route into Paint says in words that it opens a new tab", () => {
  for (const link of socialEntryPoints()) {
    // The behaviour first: the tab really does change, so the disclosure is a
    // fact rather than decoration, and `noopener` comes with it.
    assert.equal(link.getAttribute("target"), "_blank", `${textOf(link)} does not open a new tab`);
    assert.match(link.getAttribute("rel") ?? "", /noopener/);

    // Then the disclosure, in the accessible name — real text, not a title
    // attribute and not the glyph.
    assert.match(textOf(link), /\(opens in a new tab\)/, `${textOf(link)} hides the new tab from its name`);
    assert.match(sources.Social, /<span class="new-tab-note">\(opens in a new tab\)<\/span>/);

    // The arrow is decoration on top of that sentence: hidden from assistive
    // technology so it is not read as punctuation, and never the only signal.
    const glyphs = link.querySelectorAll("span").filter((span) => /[↗→]/.test(textOf(span)));
    assert.equal(glyphs.length, 1, `${textOf(link)} does not carry exactly one glyph`);
    assert.equal(glyphs[0].getAttribute("aria-hidden"), "true", "the glyph is read as punctuation");
  }
});

/* ---------------- the round trip, named where it is taken ---------------- */
// Paint uploads nothing: the visitor exports a PNG and carries it back. The
// composer is where that has to be said, in order, in the page as served.

test("the composer names the whole round trip, in order, as an ordered list", () => {
  const steps = documents.Social.getElementById("post-image-steps");
  assert.ok(steps, "the composer names no steps at all");
  assert.equal(steps.tagName, "OL", "the sequence is not structural, only visual");

  const items = steps.querySelectorAll("li");
  assert.equal(items.length, 3, "the round trip is not told in three steps");
  assert.match(textOf(items[0]), /Paint/);
  assert.match(textOf(items[0]), /PNG/);
  assert.match(textOf(items[1]), /this tab/);
  assert.match(textOf(items[2]), /Upload image/);

  // In the page as served, not folded behind a disclosure widget and not
  // written in by a script after load: a curl has to contain it. (The harness
  // reads text straight through a closed disclosure, so the count below is what
  // actually rules one out.)
  const html = sources.Social;
  assert.match(html, /<ol class="hint image-steps" id="post-image-steps">/);
  assert.ok(html.indexOf("export it as a PNG") < html.indexOf("Return to this tab"));
  assert.ok(html.indexOf("Return to this tab") < html.indexOf("Choose Upload image"));
  assert.equal(documents.Social.querySelectorAll("details").length, 0,
    "Social folded content behind a disclosure widget");
  assert.ok(!steps.getAttribute("hidden"), "the steps ship hidden");
});

test("the steps are the image field's own description, so focusing it reads them", () => {
  const input = documents.Social.getElementById("post-image");
  const described = (input.getAttribute("aria-describedby") ?? "").split(/\s+/);
  assert.ok(described.includes("post-image-steps"), "Upload image is not described by the steps");
  // The mechanism the other fields already use, and the order it is read in:
  // the round trip, then the file constraint, then the live status.
  assert.deepEqual(described, ["post-image-steps", "post-image-hint", "post-media-status"]);
});

test("the composer's Paint link sits between Upload image and Image description", async () => {
  // Source order, which is what the task is: no tabindex anywhere near it.
  const html = sources.Social;
  assert.ok(html.indexOf('id="post-image"') < html.indexOf('class="secondary-button paint-link"'));
  assert.ok(html.indexOf('class="secondary-button paint-link"') < html.indexOf('id="post-image-alt"'));
  assert.ok(!composerPaintLink().getAttribute("tabindex"), "the order is faked with tabindex");

  // And the sequence a keyboard actually walks, with the media panel open —
  // the description field only exists once an image is attached.
  const page = await loadPage(PAGES.Social);
  try {
    page.document.getElementById("compose-media").hidden = false;
    const sequence = tabSequence(page.document);
    const at = (id) => sequence.indexOf(page.document.getElementById(id));
    const paint = sequence.indexOf(page.document.querySelector(".media-source-actions").querySelector("a"));
    assert.ok(at("post-image") >= 0 && paint >= 0 && at("post-image-alt") >= 0,
      "one of the composer's image controls is not keyboard reachable");
    assert.ok(at("post-image") < paint, "the Paint link comes before Upload image");
    assert.ok(paint < at("post-image-alt"), "the Paint link comes after Image description");
  } finally {
    page.restore();
  }
});

test("Image description states its status in the label, like Name and Image do", () => {
  const marker = documents.Social.getElementById("post-image-alt-required");
  assert.ok(marker, "Image description carries no status marker");
  assert.equal(textOf(marker), "(required when you add an image)");
  // Stated in the page as served, in the label itself: the status is read, not
  // inferred from the absence of an "(optional)" the other two fields carry —
  // and it names the condition, because Image above it is optional.
  assert.match(
    sources.Social,
    /<label for="post-image-alt">Image description <span class="label-optional label-required" id="post-image-alt-required">\(required when you add an image\)<\/span><\/label>/,
  );
});

/* ------------------------------ the way back ------------------------------ */
// Paint is a full-screen workspace with no site navigation, so the route out is
// one link. What is pinned here is that taking the outbound route hands Paint
// enough to point that link back at the surface the reader actually left.

test("taking the People route out lands in Paint with a back link to People", () => {
  const link = documents.People.querySelector(".feed-create").querySelector("a");
  const search = link.href.slice(PAINT_PATH.length);
  assert.deepEqual(paintReturnContext(search), {
    href: "/profile.html",
    label: "Back to People",
  });

  // profile.js upgrades the same href with the selected display name, and that
  // returns to the exact profile rather than the default persona.
  const named = paintReturnContext(profilePaintHref("Mina O'Neil").slice(PAINT_PATH.length));
  assert.equal(named.href, "/profile.html?author=Mina%20O'Neil");
  assert.equal(named.label, "Back to People");
});

test("taking a Social route out lands in Paint with a back link to Social", () => {
  for (const link of paintLinks(documents.Social)) {
    const search = link.href.slice(PAINT_PATH.length);
    assert.deepEqual(paintReturnContext(search), {
      href: SOCIAL_COMPOSER_PATH,
      label: "Back to Social",
    });
  }
});

test("Paint ships the return link as a visible, keyboard-reachable anchor in its header", async () => {
  const html = await readFile(new URL("../src/paint/index.html", import.meta.url), "utf8");
  const document = parseHtml(html);
  const back = document.getElementById("paint-return");
  assert.ok(back, "Paint has no return link");
  assert.equal(back.tagName, "A", "the way out is not an anchor");
  assert.ok(tabSequence(document).includes(back), "Paint's return link is not keyboard reachable");

  // Named, and named in words: not an arrow, and not "back" pointing nowhere.
  assert.match(textOf(back), /^Back to (Social|People)$/);
  // It sits in the document actions, ahead of the canvas, so it is reached
  // before the editing surface rather than after everything in it.
  assert.ok(html.indexOf('id="paint-return"') < html.indexOf('id="editor-canvas"'));
  // Nothing hides it at a narrow width — the workspace it escapes is widest
  // exactly where the reader has least room.
  const css = await readFile(new URL("../src/paint/paint.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.return-action \{[^}]*display:\s*none/);
});

// The smallest shell initPaint touches for this: the one link, and the document
// element the theme is written to. Everything else it reaches for is optional.
function paintShell(search) {
  const back = { tagName: "A", href: "/social.html", textContent: "Back to Social" };
  return {
    back,
    root: {
      documentElement: { dataset: {} },
      querySelector: (selector) => (selector === "#paint-return" ? back : null),
    },
    environment: { location: { search } },
  };
}

test("Paint rewrites its one back link to the surface the visitor actually left", () => {
  const fromPeople = paintShell(profilePaintHref("Mina O'Neil").slice(PAINT_PATH.length));
  initPaint(fromPeople.root, fromPeople.environment);
  assert.equal(fromPeople.back.href, "/profile.html?author=Mina%20O'Neil");
  assert.equal(fromPeople.back.textContent, "Back to People");

  // Opened cold — a bookmark, a new tab, the nav — the link still names a
  // destination rather than going missing.
  const cold = paintShell("");
  initPaint(cold.root, cold.environment);
  assert.equal(cold.back.href, "/social.html");
  assert.equal(cold.back.textContent, "Back to Social");
});
