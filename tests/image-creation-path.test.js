// The route from browsing an image to making one.
//
// tests/paint-social-handoff.test.js covers the return leg — a finished drawing
// arriving at the Social composer. This covers the outbound one, which had no
// signposting at all: a visitor scrolling the Social feed or the People grid had
// only a nav item reading "Paint", which names a destination without saying what
// it is for, and the composer's own image button sat several screens above them.
//
// One action, one name: every route into Paint from either page is labelled
// "Create an image in Paint", opens a new tab, and says so in its own text.
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
// "Social offers Paint exactly once" below.
const NEARBY_INVITATION = { People: documents.People };

/** Every anchor on a page that points at the Paint editor. */
const paintLinks = (document) => document.querySelectorAll("a")
  .filter((anchor) => opensPaint(anchor.href));

/** The in-flow control: the composer's media picker offers exactly one link. */
const composerPaintLink = () => documents.Social.querySelector("#post-image-steps").querySelector("a");

/**
 * Social's Paint entry points: every route into Paint except the site's two
 * directories. The header nav lists every destination, and so does the footer's
 * site map — neither is an invitation this page extends, and counting them
 * would make "how many times does Social offer Paint" a question about the
 * frame rather than about the page.
 *
 * Asked of the nav as a whole rather than of a link's parent: the row groups its
 * destinations now (#1537), so a nav link's parent is its list item, and a
 * parent-only test would have started counting the frame's Paint door as one of
 * this page's invitations.
 */
const entryPointsOn = (name) => paintLinks(documents[name])
  .filter((anchor) => !anchor.closest(".site-nav") && !anchor.closest("#site-footer"));
const socialEntryPoints = () => entryPointsOn("Social");

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

    // The destination, then the two linked steps that reach it. It used to read
    // "return to this tab, then publish it on Social", which sent the reader
    // back to the page they were already on — People has no composer — and then
    // named Social in plain text, leaving the nav as the only way to it. Both
    // steps are now links, so "return to this tab" describes nothing the reader
    // has to do and must not come back.
    assert.doesNotMatch(sentence, /return to this tab/,
      `${name}'s helper still routes the reader back to a page with no composer`);
    assert.doesNotMatch(sentence, /publish it on this page|publish it here/i,
      `${name}'s helper asks the reader to publish on the page they are reading`);
    // Named before the steps, not after them: the reader is told what publishing
    // does before being asked to open two tools, and the paragraph opens on a
    // sentence rather than on a link with nothing in front of it.
    assert.match(sentence.trim(),
      /^A published post with an image appears on People, under the display name you publish it with\./,
      `${name}'s helper does not open by naming where a published image lands: ${sentence.trim()}`);
    assert.equal(sentence.trim().endsWith("and publish it."), true,
      `${name}'s helper does not end on the publishing step: ${sentence.trim()}`);
  });

  test(`${name} offers the publishing step as a link that names it and reaches the composer`, () => {
    const invitation = document.querySelector(".feed-create");
    // Named with Social's own control label, so the words on this link and the
    // words on the button it lands next to are the same words.
    const toSocial = invitation.querySelectorAll("a")
      .filter((anchor) => (anchor.getAttribute("href") ?? "").startsWith("/social.html"));
    assert.equal(toSocial.length, 1, `${name}'s helper names Social without linking it, or links it twice`);
    assert.equal(textOf(toSocial[0]), "Write a post on Social");
    // The composer, not the top of the feed: src/social-page.js reveals the
    // collapsed panel for this hash, so the reader lands on the field.
    assert.equal(toSocial[0].getAttribute("href"), `${SOCIAL_COMPOSER_PATH}#post-form`);
    assert.equal(documents.Social.querySelectorAll("#post-form").length, 1,
      "the fragment the helper links to resolves to nothing on Social");
    // Same tab: this step is on this site, so it carries none of the new-tab
    // apparatus the Paint link needs.
    assert.equal(toSocial[0].getAttribute("target"), null);
    assert.ok(tabSequence(document).includes(toSocial[0]),
      `${name}'s route to the composer is not keyboard reachable`);
    // And it comes after the editor it depends on, in the order the steps happen.
    const order = invitation.querySelectorAll("a");
    assert.equal(order[0].getAttribute("id"), "profile-paint-route");
    assert.equal(order[1].getAttribute("id"), "profile-publish-route");
  });

  test(`${name} keeps the Paint route in the keyboard sequence, after the browsing panel`, () => {
    const sequence = tabSequence(document);
    const link = document.querySelector(".feed-create").querySelector("a");
    assert.ok(sequence.includes(link), `${name}'s Paint route is not keyboard reachable`);

    // Under the browsing region rather than over it (#2142). The invitation used
    // to stand between the heading that names the images and the images
    // themselves, so a reader — and a keyboard reader in particular — was asked
    // to go and make a picture before being shown a single one of the ones that
    // are already here. The images are what this panel answers with; the route
    // to making another is the step after them.
    assert.ok(document.getElementById(BROWSING_PANEL[name]),
      `${name} has no ${BROWSING_PANEL[name]} region`);
    assert.ok(sources[name].indexOf(`id="${BROWSING_PANEL[name]}"`)
      < sources[name].indexOf('class="feed-create'),
    `${name} authors its Paint route above the images it is meant to follow`);
  });
}

test("People's nearby helper links to the editor without repeating the empty-state choices", () => {
  const invitation = documents.People.querySelector(".feed-create");
  const hrefs = invitation.querySelectorAll("a").map((anchor) => anchor.href);
  // The two steps the sentence names, and nothing else. The empty state offers
  // the same two destinations under different labels, for the reader who has no
  // posts to browse; this paragraph is for the one who does.
  assert.deepEqual(hrefs, ["/paint/?from=profile", `${SOCIAL_COMPOSER_PATH}#post-form`]);
});

/* ---------------------------- the primary route ---------------------------- */
// The invitation above covers a reader already scrolling the feed. Social's own
// route is the composer's, and it is the only one: the page used to lead with a
// hero button carrying the same four words, which offered one action a screen
// before the field it attaches to.

test("Social's route into Paint is the composer's control, and there is no second one", () => {
  const composer = composerPaintLink();
  assert.equal(composer.tagName, "A", "the route is not an anchor");
  assert.ok(opensPaint(composer.href), `Social's route does not open Paint: ${composer.href}`);
  // Making an image, in words. "Paint" alone repeats the nav item beside it, an
  // arrow alone names nothing, and a colour alone names nothing a reader can
  // act on. It stops at the act: the empty state says where the image goes.
  assert.match(textOf(composer), /^Create or open an image in Paint/);
  assert.doesNotMatch(textOf(composer), /then (publish|post)/i,
    "the composer's control restates the publishing path the empty state already gives");
  // With the composer open: it ships collapsed behind the hero's Write a post
  // control, so a collapsed panel holding no tab stop is the point, not a bug.
  const panel = documents.Social.getElementById("post-compose-panel");
  panel.hidden = false;
  try {
    assert.ok(tabSequence(documents.Social).includes(composer), "the route is not keyboard reachable");
  } finally {
    panel.hidden = true;
  }

  // The hero's duplicate is gone. Counted, never compared against null: a
  // surviving element sends assert.equal through the whole parsed page.
  assert.equal(documents.Social.querySelectorAll("#social-paint-cta").length, 0,
    "Social's hero offers Paint a second time again");
  // The hero still has its one route into the composer. It reveals the panel
  // now rather than jumping to it, so it is a disclosure trigger and not a
  // link — and it is the only control the hero offers.
  const heroControls = documents.Social.querySelector(".hero-actions")
    .querySelectorAll("a,button");
  assert.equal(heroControls.length, 1);
  assert.equal(heroControls[0].getAttribute("id"), "post-compose-open");
  assert.equal(heroControls[0].getAttribute("aria-controls"), "post-compose-panel");
});

test("People routes to Social from its entry point and to Paint beside its grid", () => {
  // The way back to the whole feed is in the page's opening section, in the
  // sentence that says what this view leaves out. The way into Paint is one
  // paragraph above the grid, beside the pictures that prompt it. Each is a
  // visible link that names its destination, and neither is offered twice: the
  // hero used to carry a second Paint control with the same four words on it.
  const hero = documents.People.querySelector(".hero");
  const toSocial = hero.querySelectorAll("a").filter((anchor) => anchor.href.startsWith("/social.html"));
  assert.equal(toSocial.length, 1, "People's entry point offers no single way back to Social");
  assert.match(textOf(toSocial[0]), /Social/);

  const toPaint = entryPointsOn("People");
  assert.equal(toPaint.length, 1, "People offers Paint more than once again");
  assert.match(textOf(toPaint[0]), /^Create an image in Paint/);
  assert.equal(documents.People.querySelectorAll("#profile-paint-cta").length, 0,
    "People's hero offers Paint a second time again");

  const sequence = tabSequence(documents.People);
  for (const link of [toPaint[0], toSocial[0]]) {
    assert.ok(sequence.includes(link), `${textOf(link)} is not keyboard reachable`);
  }
  // The surviving control carries the provenance, so Paint's back link returns
  // here rather than to Social.
  assert.equal(paintReturnContext(toPaint[0].href.slice(PAINT_PATH.length)).label, "Back to People");
});

test("People's route into Paint follows the profile actually being read", async () => {
  const page = await loadPage(PAGES.People);
  try {
    const profile = mountProfile(page.document, { posts: [], author: "Ari" });
    profile.setAuthor("Mina O'Neil");
    const link = page.document.getElementById("profile-paint-route");
    assert.ok(link, "#profile-paint-route is missing from People");
    assert.equal(link.href, profilePaintHref("Mina O'Neil"), "#profile-paint-route still points at the default persona");
    assert.equal(paintReturnContext(link.href.slice(PAINT_PATH.length)).href, "/profile.html?author=Mina%20O'Neil");
  } finally {
    page.restore();
  }
});

test("the composer's own Paint control carries the same label as every other route", () => {
  const composer = composerPaintLink();
  assert.equal(composer.href, PAINT_PATH);
  // It used to read "Create in Paint" — the same act under a second name, two
  // screens from the hero that named it first.
  assert.match(textOf(composer), /^Create or open an image in Paint/);
});

/* -------------------- one feature, offered exactly once -------------------- */
// Social used to make the same offer three times in three voices: the hero's
// "Create an image in Paint", the composer's "Create in Paint", and a third
// paragraph beside the feed reading "Open Paint". They were brought to one name
// and then to one placement — the in-flow control, beside the field the image
// is attached to — and this is the assertion that keeps a second from growing
// back.

test("Social offers Paint exactly once: the composer's in-flow control", () => {
  // Three anchors in the page, and two of them are the site's directories — the
  // header nav's item and the footer site map's row. Paint is a destination on
  // this site, and every page lists it twice for that reason. The one that is an
  // invitation is the one counted here.
  assert.equal(paintLinks(documents.Social).length, 3, "the number of routes into Paint from Social changed");
  const entryPoints = socialEntryPoints();
  assert.equal(entryPoints.length, 1, "Social offers Paint more than once again");
  assert.equal(entryPoints[0], composerPaintLink(), "the composer's control is not the offer");

  // One feature, one placement, one name.
  for (const link of entryPoints) assert.match(textOf(link), /^Create or open an image in Paint/);

  // The removed third invitation named the destination alone. Nothing outside
  // the site nav may go back to naming it that way.
  const feedInvitations = documents.Social.querySelectorAll(".feed-create").length;
  assert.equal(feedInvitations, 0, "Social grew a third Paint invitation beside its feed again");
});

// People used to make the same offer with no disclosure at all — "Create an
// image in Paint →", which promised a same-tab move the site does not make — and
// its helper sentence named the tool without saying the tab would change. Both
// pages hand off to Paint the same way, so both say the same thing about it.
test("every route into Paint on Social and People says in words that it opens a new tab", () => {
  // Counted first, so a filter that stops matching a page's links fails here
  // rather than passing an empty loop: one offer on each page. People made it
  // twice — a hero button and the invitation beside the grid, four identical
  // words apart — until the invitation was left to make it alone.
  for (const [name, count] of [["Social", 1], ["People", 1]]) {
    assert.equal(entryPointsOn(name).length, count, `${name} offers Paint a different number of times`);
    for (const link of entryPointsOn(name)) {
      // The behaviour first: the tab really does change, so the disclosure is a
      // fact rather than decoration, and `noopener` comes with it.
      assert.equal(link.getAttribute("target"), "_blank", `${name}: ${textOf(link)} does not open a new tab`);
      assert.match(link.getAttribute("rel") ?? "", /noopener/);

      // Then the disclosure, in the accessible name — real text, not a title
      // attribute and not the glyph. Same five words on both pages.
      assert.match(textOf(link), /\(opens in a new tab\)/, `${name}: ${textOf(link)} hides the new tab from its name`);
    }
    assert.match(sources[name], /<span class="new-tab-note">\(opens in a new tab\)<\/span>/);
  }
});

// ↗ means "this leaves the tab you are in"; → means "this moves you inside it".
// The site's every other arrow is a → on a same-tab route, and People's Paint
// button used to carry one while Social's carried ↗ for the identical action.
// That button is gone — it was People's second offer of the same route — so
// what is left to check is the composer's, and the rule it has to follow.
test("the button-shaped routes into Paint carry one arrow, and it is the leaves-this-tab one", () => {
  const buttons = ["Social", "People"].flatMap((name) => entryPointsOn(name))
    .filter((link) => /button-link|secondary-button/.test(link.className ?? ""));
  assert.equal(buttons.length, 1, "the number of button-shaped routes into Paint changed");

  for (const link of buttons) {
    // The arrow is decoration on top of the disclosure: hidden from assistive
    // technology so it is not read as punctuation, and never the only signal.
    const glyphs = link.querySelectorAll("span").filter((span) => /[↗→]/.test(textOf(span)));
    assert.equal(glyphs.length, 1, `${textOf(link)} does not carry exactly one glyph`);
    assert.equal(textOf(glyphs[0]), "↗", `${textOf(link)} points → at a route that leaves this tab`);
    assert.equal(glyphs[0].getAttribute("aria-hidden"), "true", "the glyph is read as punctuation");
  }
});

/* ---------------- the round trip, named where it is taken ---------------- */
// Paint uploads nothing: the visitor exports a PNG and carries it back. The
// feed's invitation names that round trip in order; the composer, where the
// file is actually chosen, names the way into Paint and the rule the file has
// to meet — in the page as served, one fact per sentence.

// #1826: the chosen image answered to two names a line apart — "Image to
// publish" over the picture and "Preview before posting" under it — beneath a
// legend that had already called it an image. One name survives, and it is the
// one that echoes the legend and names the file rather than the act of looking
// at it. The caption element stays, because src/social-page.js writes the
// file's dimensions and size into it, and it ships with nothing in it.
test("the image control and chosen-image state name the action and pending result", () => {
  const control = documents.Social.querySelector('label[for="post-image"]');
  assert.equal(textOf(control), "Choose image");
  assert.equal(textOf(documents.Social.getElementById("compose-media-source")), "Image to publish");
  assert.equal(textOf(documents.Social.getElementById("remove-image")), "Remove image");
  assert.equal(textOf(documents.Social.getElementById("compose-preview-caption")), "");

  // The chosen image is named once in the region that holds it, and the second
  // name is gone from the page entirely — attributes included, so it cannot
  // survive as a stale aria-label.
  const region = textOf(documents.Social.getElementById("compose-media"));
  assert.equal(region.split("Image to publish").length - 1, 1,
    `the chosen image is named more than once: ${region}`);
  assert.equal(textOf(documents.Social.querySelector("body")).split("Preview before posting").length - 1, 0);
  assert.doesNotMatch(sources.Social.replace(/<!--[\s\S]*?-->/g, ""), /Preview before posting/);

  // The preview keeps an accessible name, and it is the surviving noun: a figure
  // is named by its figcaption, and that caption is a measurement now, so the
  // figure points at the heading above it instead.
  const figure = documents.Social.querySelector(".compose-preview");
  assert.equal(figure.getAttribute("aria-labelledby"), "compose-media-source");
  assert.equal(textOf(documents.Social.getElementById(figure.getAttribute("aria-labelledby"))),
    "Image to publish");
});

// #1818: the four steps were one run-on sentence, and it carried the file rule
// besides — so the sequence was unscannable and the constraint a visitor
// actually trips over was the last thing on the screen. The steps are a numbered
// list now, and the rule stands beside the control that takes the file.
test("the composer numbers the round trip and puts the rule beside the control", () => {
  const steps = documents.Social.getElementById("post-image-steps");
  const hint = documents.Social.getElementById("post-image-hint");
  assert.ok(steps, "the composer names no steps at all");

  // (a) The discrete steps, in the order a reader takes them, marked up as an
  // ordered list so the count and the position come from the markup rather than
  // from a reader parsing commas. The list used to stop at the Paint link, which
  // left the reader in a second tab with a drawing and nothing telling them how
  // to get it into this one.
  // #1826 dropped a step reading "Select Choose image", whose whole content was
  // the label on the button beside it. #1869 closes the sequence properly: the
  // list stopped on returning to this tab, which left a reader holding a file
  // with nothing saying it is theirs to attach. The last step names the control
  // and the file, which is the part no label on screen carries.
  assert.equal(steps.tagName, "OL", "the steps are not an ordered list");
  const items = steps.querySelectorAll("li");
  assert.deepEqual(items.map(textOf), [
    "Create or open an image in Paint (opens in a new tab) ↗",
    "Export it as a PNG, then select that PNG in the image picker above",
    "Publish your post",
  ]);
  assert.equal(textOf(documents.Social.querySelector("body")).split("Select Choose image").length - 1, 0,
    "the composer still instructs the reader to select the button beside the instruction");

  // (b) The rule is out of the step list and adjacent to the file control: the
  // element immediately after the one holding Choose image, and never inside the
  // steps. Structure, not pixels — the harness models no layout.
  assert.equal(textOf(hint),
    "PNG, JPEG, GIF, or WebP up to 512 KB Reduce or re-export a larger image before you choose it.");
  const input = documents.Social.getElementById("post-image");
  const control = input.parentNode;
  assert.equal(control.getAttribute("for"), "post-image", "Choose image no longer wraps its own input");
  const field = control.parentNode.parentNode;
  const blocks = field.children.filter((node) => node.dataset);
  // The one element between them is the slot a rejected file is answered in
  // (#1972), which ships empty and hidden — so the first words a reader meets
  // under Choose image are still the rule, and the first words they meet after
  // choosing a file this field will not take are why it will not take it.
  const refusal = documents.Social.getElementById("post-image-error");
  assert.equal(textOf(refusal), "", "the refusal slot ships with words in it");
  assert.equal(blocks.indexOf(refusal), blocks.indexOf(control.parentNode) + 1,
    "the refusal for a rejected file is not the element next to Choose image");
  assert.equal(blocks.indexOf(hint), blocks.indexOf(refusal) + 1,
    "the format and size rule is not the element next to Choose image");
  assert.ok(blocks.indexOf(hint) < blocks.indexOf(steps), "the rule reads after the steps again");
  assert.equal(items.filter((item) => /512 KB|WebP/.test(textOf(item))).length, 0,
    "the rule is back inside the step list");

  assert.equal(textOf(documents.Social.querySelector('label[for="post-image"]')), "Choose image");
  // The rule is a standing classification of what this field takes, so it wears
  // the site's outline chip and never a filled live-state wash.
  const chip = hint.querySelectorAll("span")[0];
  assert.equal(textOf(chip), "PNG, JPEG, GIF, or WebP up to 512 KB");
  assert.equal(chip.getAttribute("class"), "detail-state-chip",
    "the rule is drawn as something other than the outline chip");

  // In the page as served, not folded behind a disclosure widget and not
  // written in by a script after load: a curl has to contain it. (The harness
  // reads text straight through a closed disclosure, so the count below is what
  // actually rules one out.)
  assert.match(sources.Social, /<ol class="hint" id="post-image-steps">/);
  assert.match(sources.Social, /<p class="hint" id="post-image-hint">/);
  assert.equal(documents.Social.querySelectorAll("details").length, 0,
    "Social folded content behind a disclosure widget");
  assert.ok(!steps.getAttribute("hidden"), "the steps ship hidden");
  assert.ok(!hint.getAttribute("hidden"), "the rule ships hidden");
});

// (c) The Paint step is still the link it was: same words, same new tab, same
// declaration of it, same arrow. Splitting the sentence must not have quietly
// turned the first step into plain text.
test("the numbered Paint step keeps its new-tab words and its external indication", () => {
  const first = documents.Social.getElementById("post-image-steps").querySelectorAll("li")[0];
  const link = first.querySelector("a");
  assert.equal(link.tagName, "A");
  assert.equal(link.getAttribute("href"), PAINT_PATH);
  assert.equal(link.getAttribute("target"), "_blank");
  assert.match(link.getAttribute("rel") ?? "", /noopener/);
  assert.equal(textOf(link), "Create or open an image in Paint (opens in a new tab) ↗");
  assert.match(textOf(link), /\(opens in a new tab\)/);
  const glyphs = link.querySelectorAll("span").filter((span) => /[↗→]/.test(textOf(span)));
  assert.equal(glyphs.length, 1);
  assert.equal(glyphs[0].getAttribute("aria-hidden"), "true");
  // The step item adds nothing around it, so the list contributes one tab stop
  // here and none anywhere else in it.
  assert.equal(textOf(first), textOf(link));
});

// (d) The numbered list and the relocated rule are text, so the keyboard walks
// the composer in exactly the order it did before #1818.
test("the composer's focusable sequence is unchanged by the numbered steps", async () => {
  const page = await loadPage(PAGES.Social);
  try {
    page.document.getElementById("post-compose-panel").hidden = false;
    page.document.getElementById("compose-media").hidden = false;
    const inForm = (node) => {
      for (let cursor = node; cursor; cursor = cursor.parentNode) if (cursor.id === "post-form") return true;
      return false;
    };
    const stops = tabSequence(page.document).filter(inForm);
    const named = stops.map((node) => node.getAttribute("id") ?? textOf(node));
    assert.deepEqual(named, [
      "post-body",
      "post-image",
      "Create or open an image in Paint (opens in a new tab) ↗",
      "remove-image",
      "post-image-alt",
      "post-author",
      "post-submit",
      "post-compose-cancel",
    ]);
    // Nothing in the list or the rule fakes its position with a tabindex.
    for (const id of ["post-image-steps", "post-image-hint"]) {
      const node = page.document.getElementById(id);
      assert.equal(node.getAttribute("tabindex"), null, `${id} declares a tabindex`);
    }
    assert.equal(page.document.getElementById("post-image-hint").querySelectorAll("a,button,input").length, 0,
      "the rule beside Choose image grew a focusable element");
  } finally {
    page.restore();
  }
});

// #1758: Paint opened in a second tab and the composer stopped talking. A
// first-time visitor finished a drawing and had nothing on either page telling
// them the file has to be exported and carried back by hand.
test("the composer names the round trip in the order it is taken, once", () => {
  const steps = textOf(documents.Social.getElementById("post-image-steps"));

  // Each step in the sentence, and each one after the step it depends on.
  const at = (fragment) => {
    const index = steps.indexOf(fragment);
    assert.ok(index >= 0, `the composer never says "${fragment}": ${steps}`);
    return index;
  };
  assert.ok(at("Create or open an image in Paint") < at("Export it as a PNG"),
    "the composer asks for the export before the drawing");
  assert.ok(at("Export it as a PNG") < at("select that PNG in the image picker above"),
    "the composer asks for the file before it has been exported");
  assert.ok(at("select that PNG in the image picker above") < at("Publish your post"),
    "the composer asks the visitor to publish before selecting the file");
  // The sequence identifies the picker without repeating the control's label.
  assert.doesNotMatch(steps, /Choose image/,
    "the steps repeat the control's instruction");
  assert.equal(textOf(documents.Social.querySelector('label[for="post-image"]')), "Choose image");

  // Once, in the field where the file is chosen — not restated elsewhere.
  const page = textOf(documents.Social.querySelector("main"));
  assert.equal(page.split("Export it as a PNG").length - 1, 1,
    "the export step is stated more than once on Social");
});

/* --------------------- #1869: finishing the step list --------------------- */
// The list walked a visitor out to Paint, through the export, and back — and
// then stopped, one step short of the only thing that gets the file into the
// post. What it left open is the inference a first-time visitor is most likely
// to make: that Paint handed the file over on the way. It did not. These pin the
// closing step, and the second price of attaching an image, in the words the
// controls themselves use.

/** The image section of the composer: the fieldset the file control lives in. */
const inMediaPicker = (node) => {
  for (let cursor = node; cursor; cursor = cursor.parentNode) {
    if (cursor.getAttribute?.("class")?.includes("media-picker")) return true;
  }
  return false;
};

test("the image section holds exactly one step list, and it is the Paint one", () => {
  // Counted by walking up from every list on the page rather than with a
  // descendant selector, which this harness rejects. An older three-step list
  // left behind beside the finished one would show up here as a second list.
  const lists = [...documents.Social.querySelectorAll("ol"), ...documents.Social.querySelectorAll("ul")]
    .filter(inMediaPicker);
  assert.equal(lists.length, 1, `the image section offers ${lists.length} step lists`);
  assert.equal(lists[0].getAttribute("id"), "post-image-steps");
  assert.equal(documents.Social.querySelectorAll("#post-image-steps").length, 1);

  // Four steps at most, one action each, and no step splits into two sentences.
  const items = lists[0].querySelectorAll("li");
  assert.ok(items.length <= 4, `the round trip is told in ${items.length} steps`);
  for (const item of items) {
    assert.doesNotMatch(textOf(item), /\.\s/, `a step carries more than one sentence: ${textOf(item)}`);
  }
});

test("the sequence names the image picker and ends with publishing", () => {
  const items = documents.Social.getElementById("post-image-steps").querySelectorAll("li");
  const last = textOf(items[items.length - 1]);

  // The label remains on the control, while the sequence names the picker and
  // the exact exported file without repeating that label.
  const label = textOf(documents.Social.querySelector('label[for="post-image"]'));
  assert.equal(label, "Choose image");
  assert.doesNotMatch(textOf(items[1]), /Choose image/);
  assert.match(textOf(items[1]), /that PNG in the image picker above/);
  assert.equal(last, "Publish your post");

  // It is prose in the list, not a second route to the same control: the tab
  // sequence through this field is unchanged.
  const item = items[items.length - 1];
  assert.equal(item.querySelectorAll("a,button,input").length, 0,
    "the closing step grew a focusable element");
});

// #1967: the sentence a picture costs an Image description used to stand before
// the file picker, where it had to spend half of itself saying where the field it
// named would turn up — a rule about a control that was not on the screen, read
// before the reader had decided whether it applied to them. It is one sentence at
// the field now, revealed with the preview, which is the moment the rule binds.
const ALT_REQUIREMENT = "A post with an image will not publish until you fill this in.";

/** Text a reader cannot reach yet: something above it carries `hidden`. */
const foldedAway = (node) => {
  for (let cursor = node; cursor; cursor = cursor.parentNode) {
    if (cursor.getAttribute?.("hidden") !== null && cursor.getAttribute) return true;
  }
  return false;
};

test("the description requirement is stated once, at the field it is about", () => {
  const note = documents.Social.getElementById("post-image-alt-requirement");
  assert.ok(note, "the composer never mentions the description requirement");
  assert.equal(textOf(note), ALT_REQUIREMENT);

  // One sentence, and it names no field and no location: the label directly
  // above it does both, so a second naming would be the same fact twice.
  assert.equal(textOf(note).split(". ").length, 1, `the requirement runs to two sentences: ${textOf(note)}`);
  assert.doesNotMatch(textOf(note), /appears below|choose an image/i,
    "the requirement still says where the field turns up");

  // At the field: same field group as the label and the textarea it is about.
  const field = documents.Social.querySelector('label[for="post-image-alt"]').parentNode;
  assert.equal(field.querySelectorAll("textarea")[0].getAttribute("id"), "post-image-alt");
  let inField = false;
  for (let cursor = note; cursor; cursor = cursor.parentNode) if (cursor === field) inField = true;
  assert.ok(inField, "the requirement sits outside the field it is about");
  // And read by the field, in the order it is met — the Display name pattern,
  // where a second hint under one input is named by that input as well.
  assert.deepEqual((documents.Social.getElementById("post-image-alt").getAttribute("aria-describedby") ?? "").split(/\s+/),
    ["post-image-alt-hint", "post-image-alt-requirement", "post-image-alt-counter-label", "post-image-alt-counter"]);

  // Said exactly once on the page, in the shipped markup, adding no tab stop and
  // no fifth status marker — the four labels that carry one still carry all of
  // them. The label keeps its own condition marker.
  assert.equal(sources.Social.split(ALT_REQUIREMENT).length - 1, 1);
  assert.equal(textOf(documents.Social.getElementById("post-image-alt-required")), "(required with an image)");
  assert.equal(note.tagName, "P");
  assert.equal(note.getAttribute("class"), "hint");
  for (const tag of ["a", "button", "input"]) assert.equal(note.querySelectorAll(tag).length, 0);
  // Inside the composer, where the four fields are. The footer's follow-up block
  // marks an optional field too, and counting the whole page would turn "the
  // four labels that carry one still carry all of them" into a claim about a
  // number rather than about those four labels.
  assert.equal(documents.Social.getElementById("post-form").querySelectorAll(".label-optional").length, 4);
  assert.match(sources.Social, /<p class="hint" id="post-image-alt-requirement">/);
});

test("with no image chosen, nothing in the composer describes the Image description field", async () => {
  const page = await loadPage(PAGES.Social);
  try {
    const document = page.document;
    // The composer as a reader opens it, with no file chosen: the media region
    // ships hidden, so everything it holds is still folded away.
    document.getElementById("post-compose-panel").hidden = false;
    assert.equal(document.getElementById("compose-media").hidden, true);
    assert.equal(foldedAway(document.getElementById("post-image-alt-requirement")), true,
      "the requirement is readable before there is an image it applies to");

    // No paragraph the reader can reach names the field or restates its rule —
    // the pre-warning is gone, and nothing paraphrases it.
    const reachable = document.getElementById("post-form").querySelectorAll("p")
      .filter((paragraph) => !foldedAway(paragraph));
    for (const paragraph of reachable) {
      assert.doesNotMatch(textOf(paragraph), /image description/i,
        `the composer names Image description before there is an image: ${textOf(paragraph)}`);
      assert.doesNotMatch(textOf(paragraph), /will not publish until/i,
        `the composer restates the description rule early: ${textOf(paragraph)}`);
    }
    assert.equal(sources.Social.split("which appears below once you choose an image").length - 1, 0);

    // Chosen: the state src/social-page.js puts the panel in once a file is in
    // hand. The rule is now on screen, once.
    document.getElementById("compose-media").hidden = false;
    const composer = textOf(document.getElementById("post-form"));
    assert.equal(composer.split(ALT_REQUIREMENT).length - 1, 1,
      `the requirement is stated ${composer.split(ALT_REQUIREMENT).length - 1} times once an image is chosen`);
    assert.equal(foldedAway(document.getElementById("post-image-alt-requirement")), false);
    assert.equal(composer.split("will not publish until").length - 1, 1,
      "a second sentence states the description rule alongside the first");
  } finally {
    page.restore();
  }
});

test("nothing in the image section says Paint delivers the file", () => {
  const section = textOf(documents.Social.querySelector(".media-picker"));
  assert.doesNotMatch(section, /Paint\s+\w*\s*(sends|transfers|hands|attaches|uploads|adds)/i,
    `the image section implies Paint moves the file itself: ${section}`);
  // The visitor is the transport, so the steps stay in the second person and the
  // section never says the file arrives, is attached, or is waiting.
  assert.doesNotMatch(section, /\b(from Paint|your image) is (attached|ready|waiting)\b/i, section);

  // The reassurance about the round trip is untouched: same promise, same words,
  // still covering both the other tab and the closed panel.
  assert.equal(textOf(documents.Social.getElementById("post-draft-note")),
    "Anything you have already typed is kept here while you are in the other tab, and while this panel is closed.");
});

test("People names the same steps in the same words as the composer", () => {
  const invitation = textOf(documents.People.querySelector(".feed-create")).trim();
  assert.equal(invitation,
    "A published post with an image appears on People, under the display name you publish it with. "
    + "To add yours: Create an image in Paint (opens in a new tab), export the PNG, "
    + "then Write a post on Social, fill in the required image description, and publish it.");

  // The composer refuses a post that carries an image and no description, so the
  // steps that lead a reader to that composer name the field before the step it
  // blocks. Social's term, not a synonym: "caption" and "alt text" are the same
  // field under two more names, and a reader who prepared a "caption" would
  // still be looking for it on a form that asks for an image description.
  const DESCRIPTION_FIELD = "image description";
  assert.ok(invitation.includes(`the required ${DESCRIPTION_FIELD}`),
    `People does not name the description as required: ${invitation}`);
  assert.ok(invitation.indexOf(DESCRIPTION_FIELD) < invitation.indexOf("and publish it."),
    "People names the description after the publishing step it is required for");
  assert.doesNotMatch(invitation, /caption|alt text/i,
    "People invents a second name for the field Social calls the image description");
  const altLabel = documents.Social.querySelectorAll("label")
    .filter((label) => label.getAttribute("for") === "post-image-alt");
  assert.equal(altLabel.length, 1, "the composer has no Image description label");
  assert.ok(textOf(altLabel[0]).toLowerCase().startsWith(DESCRIPTION_FIELD),
    "the composer no longer labels the field with the words People borrows from it");

  // And one wording for the result, not one per page. Social's composer hint
  // already tells a writer where an image post lands and under which name; the
  // helper here says it in the composer's words, so a reader who meets both
  // reads one rule twice rather than two rules that have to be reconciled.
  const RESULT = "appears on People, under the display name you publish it with";
  assert.ok(invitation.includes(RESULT),
    `People states the result in words of its own: ${invitation}`);
  assert.ok(textOf(documents.Social.getElementById("post-form-hint")).includes(RESULT),
    "the composer no longer states the result in the words People borrows from it");

  // One name per concept across the two pages: the same tool, the same export,
  // the same file. People stops at the composer rather than naming Choose image,
  // because the composer is a page away and names it itself.
  const composer = textOf(documents.Social.getElementById("post-image-steps"));
  for (const step of ["Paint", "PNG"]) {
    assert.match(invitation, new RegExp(step, "i"), `People does not name "${step}"`);
    assert.match(composer, new RegExp(step, "i"), `the composer does not name "${step}"`);
  }
  assert.doesNotMatch(invitation, /save|download|upload/i,
    "People invents a second verb for the export the composer already names");
});

test("the steps are the image field's own description, so focusing it reads them", () => {
  const input = documents.Social.getElementById("post-image");
  const described = (input.getAttribute("aria-describedby") ?? "").split(/\s+/);
  assert.ok(described.includes("post-image-steps"), "Choose image is not described by the steps");
  // The mechanism the other fields already use, and the order it is read in —
  // the same order the eye meets it in since #1818: the file constraint standing
  // beside the control, then the round trip, then the live status.
  assert.deepEqual(described, ["post-image-hint", "post-image-steps", "post-media-status"]);
});

test("the composer's Paint link sits between Choose image and Image description", async () => {
  // Source order, which is what the task is: no tabindex anywhere near it.
  const html = sources.Social;
  assert.ok(html.indexOf('id="post-image"') < html.indexOf('class="secondary-button paint-link"'));
  assert.ok(html.indexOf('class="secondary-button paint-link"') < html.indexOf('id="post-image-alt"'));
  assert.ok(!composerPaintLink().getAttribute("tabindex"), "the order is faked with tabindex");

  // And the sequence a keyboard actually walks, with the media panel open —
  // the description field only exists once an image is attached.
  const page = await loadPage(PAGES.Social);
  try {
    page.document.getElementById("post-compose-panel").hidden = false;
    page.document.getElementById("compose-media").hidden = false;
    const sequence = tabSequence(page.document);
    const at = (id) => sequence.indexOf(page.document.getElementById(id));
    const paint = sequence.indexOf(page.document.querySelector("#post-image-steps").querySelector("a"));
    assert.ok(at("post-image") >= 0 && paint >= 0 && at("post-image-alt") >= 0,
      "one of the composer's image controls is not keyboard reachable");
    assert.ok(at("post-image") < paint, "the Paint link comes before Choose image");
    assert.ok(paint < at("post-image-alt"), "the Paint link comes after Image description");
  } finally {
    page.restore();
  }
});

test("Image description states its status in the label, like Name and Image do", () => {
  const marker = documents.Social.getElementById("post-image-alt-required");
  assert.ok(marker, "Image description carries no status marker");
  assert.equal(textOf(marker), "(required with an image)");
  // Stated in the page as served, in the label itself: the status is read, not
  // inferred from the absence of an "(optional)" the other two fields carry —
  // and it names the condition, so it does not contradict the "Image
  // (optional)" legend an inch above it.
  assert.match(
    sources.Social,
    /<label for="post-image-alt">Image description <span class="label-optional label-required" id="post-image-alt-required">\(required with an image\)<\/span><\/label>/,
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
