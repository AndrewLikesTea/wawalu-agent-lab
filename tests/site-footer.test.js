// One footer, on every page, with one way to reach a person.
//
// Two halves, for two different failure modes:
//
//   1. Table-driven markup, the same discipline tests/site-nav.test.js applies
//      to the navigation. A page that carries a site nav must render exactly
//      what src/site-footer.js produces, and a new page cannot ship a footer of
//      its own invention or quietly ship none at all.
//   2. Behaviour, driven through tests/support/browser.js and the shipped page
//      entry — the same level as tests/finops-contact.test.js, and using that
//      suite's mocking pattern exactly: POST /api/leads is taken over, every
//      other request keeps going to the page's own fixture router, and nothing
//      in here can reach a network.
//
// The claim the copy makes ("this form sends one thing") is asserted against the
// outgoing request body, not against the sentence, for the same reason it is
// there: the sentence is only true because `postLeadEmail` builds the whole body
// from one argument.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  DEMOS, FOLLOW_UP_REDIRECT, IDENTITY, INVITATION, PITCH, PITCH_HREF, PITCH_LINK,
  REPOSITORY_LINK_LABEL, siteFooterMarkup,
} from "../src/site-footer.js";
import { REPOSITORY_URL } from "../src/repository-url.js";
import { FOLLOW_UP_TOPICS } from "../src/leads.js";
import { FOLLOW_UP_PRIVACY } from "../src/lead-capture.js";
import { SITE_NAV } from "../src/site-nav.js";
import { loadPage, parseHtml, pressEnter, tabSequence, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

// Every page of the site. Kept in the same order and to the same rule as
// tests/site-nav.test.js: if a page carries the site navigation it is a page of
// the site, and a page of the site carries the footer.
const PAGES = [
  "index.html", "decision.html", "workspace.html", "social.html", "post.html", "profile.html", "releases.html",
  "release.html", "evolution.html", "coach.html", "personal-history.html", "savings-action-center.html", "savings-commitment.html",
  "executive-briefing.html", "departments.html",
  "agents.html", "agent-trace.html",
];

const pageUrl = (file) => new URL(`../src/${file}`, import.meta.url);
const read = (file) => readFile(pageUrl(file), "utf8");

const TYPED_EMAIL = "director@example.com";

// The recovery paragraph, in the order a person needs it: what happened, what is
// still safe, then what the control below it does. Pinned whole rather than by
// fragment — the order of the three sentences is the point, and a substring
// match would not see it.
//
// It names no other page. A request that failed here is retried here: sending a
// reader to the executive briefing's form abandoned the page they were reading
// and left a first-time visitor unable to tell whether anything had been sent.
const RECOVERY_COPY = "We could not send your follow-up request. "
  + "Your email address is still in the field above, and nothing else on this page changed. "
  + "Retry sends the same request again from this page; if it keeps failing, wait a few minutes and retry.";

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));
const describedBy = (document) => byId(document, "site-footer-email").getAttribute("aria-describedby");

/* ------------------------------- the markup ------------------------------- */

// The pages whose footer points at a follow-up form of their own instead of
// carrying the generic one. Kept here rather than inferred from the page, so a
// page cannot quietly drop the contact affordance: dropping it is a decision
// this table has to record, and src/site-footer.js has to offer copy for.
//
// `statedTopic` is the second shape a fixed topic takes: the pages a visitor
// cannot choose a topic on say what the request is about in prose instead of in
// a read-only control, so the block gains a sentence and no tab stop.
const FOOTER_VARIANT = new Map([
  ["executive-briefing.html", { redirect: FOLLOW_UP_REDIRECT.briefing }],
  ["coach.html", { followUpType: "follow_up_coach", followUpTopic: FOLLOW_UP_TOPICS.follow_up_coach }],
  ["post.html", {
    followUpType: "follow_up_social", followUpTopic: FOLLOW_UP_TOPICS.follow_up_social, statedTopic: true,
  }],
  ["releases.html", {
    followUpType: "follow_up_releases", followUpTopic: FOLLOW_UP_TOPICS.follow_up_releases, statedTopic: true,
  }],
  ["social.html", { followUpType: "follow_up_social", followUpTopic: FOLLOW_UP_TOPICS.follow_up_social }],
  ["profile.html", { followUpType: "follow_up_people", followUpTopic: FOLLOW_UP_TOPICS.follow_up_people }],
  ["agents.html", { followUpType: "follow_up_agents", followUpTopic: FOLLOW_UP_TOPICS.follow_up_agents }],
]);

test("every page of the site renders the footer, byte for byte from src/site-footer.js", async () => {
  for (const file of PAGES) {
    const html = await read(file);
    assert.ok(
      html.includes(siteFooterMarkup("    ", FOOTER_VARIANT.get(file))),
      `${file} footer markup has drifted from src/site-footer.js`,
    );
    // One footer, not two, and the behaviour that drives it is wired in.
    assert.equal((html.match(/<footer/g) ?? []).length, 1, `${file} renders more than one footer`);
    assert.match(html, /<script type="module" src="\/site-footer-page\.js"><\/script>/, `${file} never loads the footer entry`);
  }
});

test("a page with its own follow-up form ships one work-email form, and its footer points at it", async () => {
  // The executive briefing ends on a decision, and its own form arrives attached
  // to it. A second generic form on the same screen would ask a reader who has
  // just decided something to choose between two identical fields.
  const html = await read("executive-briefing.html");
  const page = await loadPage(pageUrl("executive-briefing.html"));
  const { document } = page;
  try {
    assert.equal(byId(document, "site-footer-form"), null, "the briefing page ships a second contact form");
    assert.equal(byId(document, "site-footer-open"), null, "the briefing page ships a second contact disclosure");
    assert.equal(document.querySelectorAll('input[type="email"]').length, 1,
      "exactly one work-email field on the page a reader decides from");
    assert.ok(byId(document, "briefing-contact-form"), "the briefing's own form must be the one that stays");

    // The footer still names who runs Shiplog, and still offers a route to a
    // person — as a real link, so it works with no script at all.
    assert.match(textOf(byId(document, "site-footer")), /Wawalu/);
    const link = document.querySelector(".site-footer-redirect-link");
    assert.equal(link.tagName, "A");
    assert.equal(link.getAttribute("href"), "#briefing-contact");
    assert.ok(tabSequence(document).includes(link), "the footer must stay keyboard reachable");
    assert.ok(byId(document, "briefing-contact"), "the footer points at a section that exists");

    // The link is the whole pointer. It used to be preceded by a paragraph
    // explaining that the page carries its own form and which of the two to
    // use; a clear label does that job, and the paragraph must not come back.
    assert.equal(textOf(link), "Request a follow-up", "the pointer carries the site's one follow-up label");
    assert.equal(document.querySelector(".site-footer-redirect"), null,
      "the About block must explain the link with the link, not with a paragraph");
    assert.doesNotMatch(textOf(byId(document, "site-footer")), /carries its own follow-up form/);

    // And every other page keeps the generic form: this is one page's exception,
    // not a site-wide removal.
    for (const other of PAGES.filter((file) => !FOOTER_VARIANT.has(file))) {
      assert.match(await read(other), /id="site-footer-form"/, `${other} lost its contact form`);
    }
    assert.doesNotMatch(html, /id="site-footer-form"/);
  } finally {
    page.restore();
  }
});

test("every page that carries a site nav is covered by the table", async () => {
  const listed = new Set(PAGES);
  const files = (await readdir(new URL("../src/", import.meta.url), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => entry.name);

  for (const file of files) {
    const html = await read(file);
    if (!html.includes('class="site-nav"')) continue;
    assert.ok(listed.has(file), `${file} is a page of the site but is missing from PAGES`);
  }
});

test("the footer is a contentinfo landmark with an accessible name, after the content in document order", async () => {
  // A detail page and a list page, so this is not asserted on one layout. Every
  // page now uses the .page-wrapped frame — issue 378 converted the last of the
  // bare-<main> ones — and the footer stays outside it, scoped to the document.
  for (const file of ["index.html", "post.html", "social.html", "agents.html"]) {
    const html = await read(file);
    const page = await loadPage(pageUrl(file));
    const { document } = page;
    try {
      const footers = document.querySelectorAll("footer");
      assert.equal(footers.length, 1, `${file}: exactly one contentinfo landmark`);
      const [footer] = footers;

      // A <footer> is only a contentinfo landmark when it is scoped to the
      // document rather than nested in an article or a section.
      assert.equal(footer.parentNode.tagName, "BODY", `${file}: the footer must be scoped to the document`);

      const name = footer.getAttribute("aria-labelledby");
      assert.ok(name, `${file}: the landmark needs an accessible name`);
      assert.equal(textOf(byId(document, name)), "About Shiplog", `${file}: the name must be a real heading`);

      // After the content region, in the document — not merely painted below it.
      assert.ok(html.indexOf("</main>") < html.indexOf('<footer class="site-footer"'), `${file}: the footer precedes the content`);
      // And nothing in it borrows tab order: no positive tabindex anywhere.
      for (const node of footer.querySelectorAll("a,button,input,select,textarea")) {
        const tabindex = node.getAttribute("tabindex");
        assert.ok(tabindex === null || Number(tabindex) <= 0, `${file}: ${node.id} carries tabindex="${tabindex}"`);
      }
    } finally {
      page.restore();
    }
  }
});

test("the footer says what a visitor can do here before it says what Shiplog is", async () => {
  // The band used to open by defining Shiplog as a decision and release log,
  // which is not what this site leads with: the home page's title, heading, and
  // first call to action are all AI FinOps. A visitor who reads only this block
  // has to come away knowing what they can do, not just what to call it.
  const page = await loadPage(pageUrl("index.html"));
  const { document } = page;
  try {
    const identity = textOf(document.querySelector(".site-footer-identity"));
    const [opening] = identity.split(". ");
    assert.match(opening, /^On this site you can /, "the first sentence must name what a visitor can do");
    assert.ok(!opening.includes("Shiplog is"), "the definition must not be the opening sentence");
    // The three things it promises are the three things the demo list points at.
    for (const verb of ["analyze your own AI spend", "check a prompt", "decisions and releases"])
      assert.ok(identity.includes(verb), `the opening must name "${verb}"`);
  } finally {
    page.restore();
  }
});

// A reader who arrives on a deep link — a release, a post, a profile — reads the
// page they asked for and then this band. Before #1734 the band told them what
// they could do here and who runs it, but never whose problem Shiplog solves,
// and the one page that shows it working was a row in the list like any other.
test("the About block says who Shiplog is for, and reaches the worked decision in one click", async () => {
  // The five surfaces #1734 names, plus the home page, which ships the same
  // string from the same source rather than a variant of its own.
  for (const file of ["releases.html", "social.html", "profile.html", "coach.html", "agents.html", "index.html"]) {
    const html = await read(file);
    const page = await loadPage(pageUrl(file));
    const { document } = page;
    try {
      const pitches = document.querySelectorAll(".site-footer-pitch");
      assert.equal(pitches.length, 1, `${file}: one pitch, not two`);
      const [pitch] = pitches;
      assert.equal(pitch.tagName, "P");
      assert.equal(textOf(pitch), `${PITCH} See ${PITCH_LINK}.`, `${file} sells Shiplog in its own words`);

      // It names the audience and it points. It does not re-answer the question
      // the home page answers: no amount, no percentage, no recommended action.
      assert.match(PITCH, /engineering teams/, "the pitch must say who Shiplog is for");
      for (const restated of [/\d/, /%/, /\$/, /recoverable/i, /Pilot lower-cost routing/i, /Atlas Platform/i]) {
        assert.doesNotMatch(textOf(pitch), restated, `${file}: the pitch restates the answer it should point at`);
      }
      // And no claim the site cannot show — the same bar the identity keeps.
      for (const claim of [/customers?\b/i, /\bclients?\b/i, /trusted by/i, /uptime/i, /\brevenue\b/i, /teams like yours/i]) {
        assert.doesNotMatch(textOf(pitch), claim, `${file}: the pitch claims ${claim}`);
      }

      // One click to the worked decision, by the name the home page's own call
      // to action uses for it, at the address the site forwards for that figure.
      const link = pitch.querySelectorAll("a")[0];
      assert.ok(Boolean(link), `${file}: the pitch must link the worked decision`);
      assert.equal(link.tagName, "A");
      assert.equal(textOf(link), PITCH_LINK);
      assert.equal(link.getAttribute("href"), PITCH_HREF);
      assert.equal(pitch.querySelectorAll("a").length, 1, `${file}: one pointer, not a second site map`);
      assert.ok(tabSequence(document).includes(link), `${file}: the pointer must be keyboard reachable`);
      assert.ok(html.includes(`<a href="${PITCH_HREF}">`), `${file}: the pointer must carry the answer's fragment`);

      // After the heading, before the list: it sells, then it directs. Asserted
      // on the document's own order, which is what a reader and a screen reader
      // both receive.
      const at = (needle) => html.indexOf(needle);
      assert.ok(at('class="site-footer-title"') < at("site-footer-pitch"), `${file}: the pitch precedes the About heading`);
      assert.ok(at('class="site-footer-identity"') < at("site-footer-pitch"), `${file}: the pitch displaces the identity paragraph`);
      assert.ok(at("site-footer-pitch") < at("site-footer-demos"), `${file}: the pitch follows the destination list`);
      // It is a paragraph of the band, not a row of the map.
      assert.equal(pitch.parentNode.getAttribute("class"), "site-footer-inner", `${file}: the pitch is nested somewhere new`);

      // The list is untouched: eight destinations, the same links, in the same
      // order, and the provenance sentence still renders word for word.
      const items = document.querySelector(".site-footer-demos").querySelectorAll("li");
      assert.equal(items.length, DEMOS.length, `${file}: the destination list changed length`);
      for (const [index, demo] of DEMOS.entries()) {
        assert.equal(textOf(items[index].querySelectorAll("a")[0]), demo.label, `${file}: destination ${index} changed`);
      }
      assert.equal(textOf(document.querySelector(".site-footer-identity")), IDENTITY, `${file}: the identity paragraph changed`);
      assert.match(textOf(document.querySelector(".site-footer-identity")),
        /Shiplog is a demonstration product, built and operated by Wawalu/,
        `${file}: the provenance sentence must survive`);
    } finally {
      page.restore();
    }
  }
});

test("the pitch is one sentence and a pointer, in the words the site already uses", async () => {
  // Two sentences at most, and the first is the home page's framing said
  // shorter: the footer points, the home page explains. A footer that repeated
  // the hero would print the same sentence twice on the page that carries both.
  assert.equal(PITCH.split(/(?<=\.)\s+/).length, 1, "the pitch is one sentence");
  assert.ok(PITCH.split(/\s+/).length <= 20, `the pitch runs to ${PITCH.split(/\s+/).length} words`);
  assert.doesNotMatch(PITCH, /powerful|seamless|unlock|leverage|central hub|best-in-class|simply/i, "the pitch uses filler");

  const hero = textOf(parseHtml(await read("index.html")).querySelector(".hero-finops"));
  assert.ok(hero.includes(PITCH_LINK), "the pitch must name the worked decision the way the home page names it");
  assert.ok(!hero.includes(PITCH), "the pitch must not be the home page's hero sentence pasted into the footer");
  assert.ok(PITCH.split(/\s+/).length < hero.split(/\s+/).length, "the footer points, the home page explains");
});

test("the footer is a site map: every destination the navigation offers, each one a link", async () => {
  const page = await loadPage(pageUrl("index.html"));
  const { document } = page;
  try {
    const list = document.querySelector(".site-footer-demos");
    assert.equal(list.tagName, "UL", "the destinations must be a real list, so a screen reader gets the count");
    const items = [...list.querySelectorAll("li")];
    assert.equal(items.length, DEMOS.length, "one row per destination");

    // Every door the navigation offers, named exactly once. This band is the
    // only directory on the pages whose body carries none, so a surface missing
    // here is a surface a visitor has to guess at.
    const navLabels = SITE_NAV.map((link) => link.label);
    const sorted = (labels) => [...labels].sort();
    assert.deepEqual(sorted(DEMOS.map((demo) => demo.label)), sorted(navLabels),
      "the band must name each navigation destination exactly once, by the name the navigation uses");

    // One door per name. src/site-footer.js repeats the hrefs rather than
    // importing src/site-nav.js — that file is 6 KB and this module is in every
    // page's initial payload — so the two tables are compared here instead,
    // where it costs a visitor nothing.
    for (const demo of DEMOS) {
      const destination = SITE_NAV.find((link) => link.label === demo.label);
      assert.equal(demo.href, destination.href,
        `the footer sends "${demo.label}" somewhere the navigation does not`);
      // Root-relative, the convention every cross-page link in src/site-nav.js
      // uses: this band ships on every page, and a bare relative path would
      // resolve against a page in a subdirectory instead of against the site.
      assert.ok(demo.href.startsWith("/"), `"${demo.label}" must resolve from any page depth`);
    }

    // Every row is a link, and every link is reachable from the keyboard: a
    // name a reader cannot follow is a name they have to go and find in the
    // header for themselves.
    const stops = tabSequence(document);
    // One link per destination, plus one for each page named beneath a
    // destination rather than beside it — see `also` in src/site-footer.js.
    const nested = DEMOS.filter((demo) => demo.also);
    assert.equal(list.querySelectorAll("a").length, DEMOS.length + nested.length,
      "every destination must be followable");
    for (const [index, demo] of DEMOS.entries()) {
      const link = items[index].querySelector("a");
      assert.equal(textOf(link), demo.label, `${demo.label} must be the linked text, and named first in its row`);
      assert.equal(link.getAttribute("href"), demo.href);
      assert.ok(stops.includes(link), `${demo.label} must be keyboard reachable`);
    }
    assert.match(textOf(items[0]), /start here/i, "the list must say where to start");
    assert.match(textOf(items[0]), /^AI FinOps/, "the site leads with AI FinOps, so the list does too");

    // A site map, not an essay. The rule used to be a flat eight-word cap, which
    // said "shorter" by picking a number; it is stated against the thing it
    // actually protects now — the footer points, the home page explains, so a
    // row may never be longer than the home page's sentence for that surface.
    // Two rows carry more words than they used to because the facts they had
    // dropped belong in both maps: where Paint's PNG goes, and what order
    // People's posts come in. The marker on the first row is the order signal,
    // not purpose copy, so it is counted separately.
    const guideRows = [...document.querySelector(".site-guide").querySelectorAll("li")];
    const guideSentence = (demo) => {
      const row = guideRows.find((entry) => entry.querySelector(`a[href="${demo.href}"]`));
      assert.ok(row, `the home page's directory is missing ${demo.label}`);
      return textOf(row).slice(demo.label.length).trim();
    };
    for (const demo of DEMOS) {
      const words = demo.purpose.split(/\s+/).length;
      const explained = guideSentence(demo).split(/\s+/).length;
      assert.ok(words <= explained,
        `"${demo.label}" runs to ${words} words against the home page's ${explained}`);
      assert.ok(words <= 16, `"${demo.label}" runs to ${words} words of purpose`);
      assert.doesNotMatch(demo.purpose, /powerful|seamless|unlock|leverage|central hub/i, `"${demo.label}" uses filler`);
    }

    // Every row a fragment. Rows used to be word for word the home page's
    // sentence for that surface, so the home page printed the same eight
    // sentences twice and every other page carried an essay. Social used to be
    // the standing exception — it carried a whole sentence, opening by naming
    // the destination its own link had just named — and it is a fragment like
    // the rest now. People is the deliberate exception: its card used to add "The
    // picker is on the page", which describes the page's furniture rather than
    // what a visitor does there, so the card now says exactly what this band
    // says.
    const SHARED = ["People"];
    for (const demo of DEMOS) {
      assert.doesNotMatch(demo.purpose, /[.!?]$/, `"${demo.label}" is written as a sentence`);
      if (SHARED.includes(demo.label)) {
        assert.equal(asFragment(guideSentence(demo)), demo.purpose,
          `${demo.label}'s home page card and this band describe it in different words`);
        continue;
      }
      const repeats = textOf(items.find((row) => textOf(row).startsWith(demo.label))).includes(guideSentence(demo));
      assert.ok(!repeats, `${demo.label} repeats the home page's sentence in the footer`);
    }

    // And it is the same list on every page, including the one whose footer
    // swaps the contact form for a pointer.
    for (const file of PAGES) {
      const html = await read(file);
      for (const demo of DEMOS) {
        assert.ok(html.includes(`<a href="${demo.href}">${demo.label}</a> — `), `${file} is missing "${demo.label}"`);
      }
      assert.ok(html.includes('<li><a href="/evolution.html">AI FinOps</a>'), `${file} is missing the way in`);
    }

    // Neither surface may sell the analysis without saying where it happens.
    // The AI FinOps row is a fragment now, but this clause is a promise about
    // where a visitor's export is read, so it survives the trim on both.
    const guideRow = guideRows.find((row) => row.querySelector('a[href="/evolution.html"]'));
    for (const row of [items[0], guideRow])
      assert.match(textOf(row), /provider export in this browser tab/,
        "the AI FinOps destination must preserve its local-analysis disclosure");
    // The home page's own row still names the action; the footer points, and
    // the page it points at does the promising.
    assert.match(textOf(guideRow), /where to act first on your AI spend/,
      "the home page's directory must name the action AI FinOps gives a visitor");
  } finally {
    page.restore();
  }
});

// The site had two maps of itself — this band and the home page's "Where
// everything is" directory — and they disagreed about what a destination was
// for, not merely about how to say it. Paint's band row dropped the reason Paint
// exists; People's dropped the display name and the order; Social was described
// three different ways on four surfaces. These two tests assert the invariant
// rather than the eight strings: the strings are copy and may be rewritten, but
// a reader must never meet two answers to the same question.
test("the About Shiplog band reads the same on every page of the site", async () => {
  // Rendered text, not markup: that is what a reader receives, and the band is
  // hand-embedded in sixteen static documents, which is exactly how a wording
  // lands on one page and not the fifteen others. The contact half is not
  // compared — one page swaps it for a pointer at its own form, by design.
  const rendered = [];
  for (const file of PAGES) {
    const document = parseHtml(await read(file));
    rendered.push([file, [
      textOf(document.querySelector(".site-footer-identity")),
      textOf(document.querySelector(".site-footer-pitch")),
      textOf(document.querySelector(".site-footer-demos")),
    ].join(" ")]);
  }
  const [[first, expected]] = rendered;
  for (const [file, text] of rendered) {
    assert.equal(text, expected, `${file} describes the site differently from ${first}`);
  }
  // And it is the band, not an empty one that trivially matches everywhere.
  for (const demo of DEMOS) assert.ok(expected.includes(demo.purpose), `the band lost "${demo.label}"`);
  assert.ok(expected.includes(PITCH), "the band lost the sentence that says who Shiplog is for");
});

// The description a fragment and a card may differ in, and nothing else: the
// band lists fragments, the home page's directory lists sentences.
const asFragment = (text) => text.replace(/\.$/, "").replace(/^./, (first) => first.toLowerCase());

test("Social's homepage directory explains publishing, while a permalink explains the specific post", async () => {
  // The homepage explains publishing; the compact site-wide band points to the
  // feed. The permalink identifies the specific item a visitor opened.
  const PURPOSE = DEMOS.find((demo) => demo.label === "Social").purpose;

  // A verb first, and never the destination's own name: the link says "Social"
  // one character earlier on every surface this text lands on.
  assert.match(PURPOSE, /^read /, "the Social row must open with what a visitor does");
  assert.doesNotMatch(PURPOSE, /^social\b/i, "the Social row repeats the name of the link beside it");

  const guide = parseHtml(await read("index.html")).querySelector(".site-guide");
  const card = [...guide.querySelectorAll("li")].find((row) => row.querySelector('a[href="/social.html"]'));
  assert.ok(Boolean(card), "the home page's directory must name Social");
  const cardText = textOf(card).slice("Social".length).trim();
  assert.doesNotMatch(cardText, /^Social\b/, "the home page's card repeats the name of the link beside it");
  assert.equal(cardText, "Read posts and images, or publish your own post under a display name.");

  // The permalink's standing copy is post-specific and does not repeat the
  // generic feed description beside it.
  const permalink = parseHtml(await read("post.html")).querySelector("#main-content");
  assert.ok(textOf(permalink).includes("Shared links like this one open a single post from Social’s shared demo feed."));
  assert.equal(textOf(permalink).includes(PURPOSE), false,
    "the post permalink repeats the generic Social description beside the post-specific explanation");

  // The band, on the page a reader is most likely to meet it cold.
  const band = parseHtml(await read("social.html")).querySelector(".site-footer-demos");
  assert.ok(textOf(band).includes(PURPOSE), "the band states what a visitor does on Social");

  // Social's own intro is not a directory row and keeps its own sentences: a
  // first-time visitor still learns the feed is shared, the posts are short,
  // the images are optional, and when to open People instead. It no longer
  // calls the feed a "demo" one — the eyebrow and the demo-data sentence carry
  // that, and this paragraph sat between them saying it a third time.
  // Third paragraph in the hero: eyebrow, then the one-line tagline, then this.
  const intro = textOf(parseHtml(await read("social.html")).querySelector(".hero-social").querySelectorAll("p")[2]);
  for (const fact of ["shared feed", "short posts", "images optional", "People"]) {
    assert.ok(intro.includes(fact), `Social's intro no longer tells a first-time visitor about ${fact}`);
  }

  // But it says it once per page. The band used to carry that intro sentence
  // byte for byte, so Social's own page printed it twice, one screen apart.
  const PASTED = "is a shared feed of short posts about what the team ships";
  for (const file of PAGES) {
    const times = (await read(file)).split(PASTED).length - 1;
    assert.ok(times <= 1, `${file} carries the same Social sentence ${times} times`);
  }
  assert.equal((await read("social.html")).split(PASTED).length - 1, 1,
    "Social's own page must still say what the feed is, once");

  // The wordings this replaces, retired everywhere rather than left in a corner.
  for (const file of PAGES) {
    const html = await read(file);
    for (const retired of [
      "read short demo posts, images optional", "the team's shared demo feed",
      "crop or draw, then export a PNG", "hand it to a Social post yourself",
      "about the work the team ships",
    ]) assert.ok(!html.includes(retired), `${file} still says "${retired}"`);
  }
});

test("a page named beneath a destination is named there, by the name the rest of the site uses", async () => {
  // Personal AI history has no door of its own: src/site-nav.js files it under
  // Prompt coach's section. Before this it was named on the home page alone, so
  // a reader who had left that page could not find it again by name.
  const page = await loadPage(pageUrl("index.html"));
  const { document } = page;
  try {
    for (const parent of DEMOS.filter((demo) => demo.also)) {
      const { also } = parent;
      const row = [...document.querySelector(".site-footer-demos").querySelectorAll("li")]
        .find((item) => textOf(item).startsWith(parent.label));
      const link = [...row.querySelectorAll("a")].find((node) => node.getAttribute("href") === also.href);
      // Boolean, never the node: a failed assert on a parsed element inspects
      // the whole page and takes the suite with it.
      assert.ok(Boolean(link), `"${also.label}" must be followable from the ${parent.label} row`);
      // Character for character the name the home page and the page's own title
      // use. One name per concept, everywhere.
      assert.equal(textOf(link), also.label);
      assert.ok(tabSequence(document).includes(link), `${also.label} must be keyboard reachable`);
      // Named after the destination it sits beneath, never before it.
      assert.ok(textOf(row).indexOf(parent.label) < textOf(row).indexOf(also.label),
        `${also.label} must read as a page beneath ${parent.label}, not ahead of it`);

      // Same rules as a row of its own: a fragment, not a sentence, and no filler.
      assert.ok(also.purpose.split(/\s+/).length <= 8, `"${also.label}" runs long`);
      assert.doesNotMatch(also.purpose, /[.!?]$/, `"${also.label}" is written as a sentence`);
      assert.doesNotMatch(also.purpose, /powerful|seamless|unlock|leverage|central hub/i, `"${also.label}" uses filler`);
      // And it must not repeat the home page's sentence for that surface.
      assert.ok(!textOf(row).includes("It runs the same rubric over that export"),
        `${also.label} repeats the home page's sentence in the footer`);
    }

    // The name the site uses for it, on the page itself and on the home page.
    const historyLinks = [...document.querySelectorAll('a[href="/personal-history.html"]')];
    assert.ok(historyLinks.some((node) => textOf(node).includes("Personal AI history")),
      "the home page must name the surface the footer names");
    assert.match(await read("personal-history.html"), /<title>Personal AI history · Shiplog<\/title>/,
      "the page must carry the name the footer sends a reader to");

    // The reassurance is the AI FinOps row's, one line away: a reader is told
    // where their export is read before they hand one over.
    for (const file of PAGES) {
      assert.ok((await read(file)).includes(
        '<a href="/personal-history.html">Personal AI history</a> grades your assistant export in this browser tab'),
      `${file} is missing "Personal AI history"`);
    }
  } finally {
    page.restore();
  }
});

// The same words for the same file, different words for a different one.
//
// The band names two files a visitor might hand over, one line apart: AI FinOps
// reads a provider billing export, Personal AI history reads a personal
// assistant export. Both clauses used to end "your export in this browser tab",
// so the two surfaces read as one feature wanting one file. The pages disagree —
// personal-history.html asks for "your own assistant export" and refuses a file
// that is neither a conversation export nor a prompt log — and this band is the
// site's most repeated prose, so it is where a first-time visitor picks the
// wrong idea up. The rule is the invariant, not the string: no two clauses may
// name the file they read with the same words.
test("the About Shiplog band names a different file for each surface that reads one", async () => {
  const history = DEMOS.find((demo) => demo.also?.label === "Personal AI history").also;
  assert.doesNotMatch(history.purpose, /your export/,
    "the Personal AI history clause names its file the way AI FinOps names a different one");
  assert.match(history.purpose, /in this browser tab$/,
    "the clause must keep the promise its neighbour makes, in its neighbour's words");
  // What it does with the file, not merely that it opens one.
  assert.doesNotMatch(history.purpose, /^reads /,
    "the clause must say what Personal AI history does with what it reads");

  // Rendered, on the five surfaces the report names and every other page too:
  // the band is hand-embedded per document, which is how one page keeps an old
  // wording. The file phrase is the two words in front of the shared promise.
  const FILE = /(\w+ \w+) in this browser tab/g;
  const surfaces = new Set(["social.html", "profile.html", "post.html", "coach.html", "releases.html", ...PAGES]);
  for (const file of surfaces) {
    const band = textOf(parseHtml(await read(file)).querySelector(".site-footer-demos"));
    const named = [...band.matchAll(FILE)].map(([, phrase]) => phrase);
    assert.ok(named.length >= 2, `${file} lost a clause that says where a file is read`);
    assert.equal(new Set(named).size, named.length,
      `${file} calls two different files "${named.join('" and "')}"`);
    assert.ok(band.includes(history.purpose), `${file} is missing the Personal AI history clause`);
  }
});

test("the footer says who runs Shiplog and where, and claims nothing it cannot show", async () => {
  const page = await loadPage(pageUrl("index.html"));
  const { document } = page;
  try {
    const identity = shownText(document, "site-footer");
    assert.match(identity, /Wawalu/, "the footer must name the organisation that operates Shiplog");
    assert.match(identity, /labs\.wawalu\.org/, "the footer must name where this is hosted");
    assert.match(identity, /demonstration/, "the footer must say this is a demonstration product");
    assert.equal(textOf(document.querySelector(".site-footer-identity")), IDENTITY);

    // The proof-point gap is a different piece of work. This band invents none
    // of it: no customer, no usage, no funding, no result, no number at all.
    for (const claim of [
      /customers?\b/i, /\bclients?\b/i, /trusted by/i, /\bfunding\b/i, /\brevenue\b/i,
      /teams like yours/i, /\d+\s*%/, /\$\s*\d/, /\b\d[\d,]{2,}\b/,
    ]) assert.doesNotMatch(identity, claim, `the footer must not make this claim: ${claim}`);
  } finally {
    page.restore();
  }
});

test("the footer form says what submitting asks for, on the page that carries both work-email forms", async () => {
  const page = await loadPage(pageUrl("index.html"));
  const { document } = page;
  try {
    // One sentence between the field and the button — the site's, not this
    // footer's. Pinned whole: a substring match would pass on any prose.
    const note = textOf(byId(document, "site-footer-note"));
    assert.equal(note, FOLLOW_UP_PRIVACY);
    // It names what is sent, who receives it, and that nothing else goes.
    assert.match(note, /work email address you type here/);
    assert.match(note, /Wawalu team that operates Shiplog/);
    assert.match(note, /nothing else on this page is sent/);

    // The control the visitor presses says the same thing the note does.
    const submit = byId(document, "site-footer-panel").querySelector('button[type="submit"]');
    assert.equal(textOf(submit), "Request a follow-up");
    assert.equal(textOf(byId(document, "site-footer-email").labels?.[0]
      ?? document.querySelector('label[for="site-footer-email"]')), "Work email for your follow-up");

    // The button carries no page-specific qualification, so the line outside the
    // panel is what says a follow-up about what — and it is readable before the
    // visitor opens anything.
    assert.equal(textOf(document.querySelector(".site-footer-invitation")), INVITATION);
    assert.match(INVITATION, /Shiplog/);

    // And nothing in this form reads as the field-note sign-up a few sections up.
    const footer = textOf(byId(document, "site-footer"));
    assert.doesNotMatch(footer, /field note|subscrib/i,
      "the contact form must never describe itself as a subscription");
  } finally {
    page.restore();
  }
});

/* ------------------------------ the behaviour ----------------------------- */

/**
 * Stand up a page with its footer wired the way the browser wires it. The two
 * files driven below are the home page and a detail page; neither needs a
 * fixture route, because the footer is the only module imported.
 */
async function openFooterPage(file) {
  const page = await loadPage(pageUrl(file));
  await importPageModule("/site-footer-page.js");
  return page;
}

/**
 * Take over POST /api/leads and record exactly what the page hands the network.
 * Lifted from tests/finops-contact.test.js so both forms are pinned the same way.
 */
function interceptLeads(reply) {
  const passthrough = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    if (url !== "/api/leads") return passthrough(url, options);
    calls.push({ url, options });
    return reply(calls.length);
  };
  return calls;
}

const jsonReply = (body, status = 201) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

/** Type an address into the form and submit it from the keyboard. */
function submitEmail(document, value) {
  const field = byId(document, "site-footer-email");
  field.value = "";
  field.focus();
  typeText(document, value);
  pressEnter(document);
}

const settled = (document) => waitFor(
  () => ["success", "error"].includes(byId(document, "site-footer-form").dataset.state),
  "the footer submission to settle");

test("the footer initially renders one email field and one request action, with no outcome UI", async () => {
  const page = await openFooterPage("index.html");
  const { document } = page;
  try {
    assert.equal(byId(document, "site-footer-panel").hidden, false);
    // `== null` rather than assert.equal: see tests/follow-up-cta-label.test.js.
    assert.ok(byId(document, "site-footer-open") == null);
    assert.equal(byId(document, "site-footer-form").querySelectorAll('input[type="email"]').length, 1);
    const visibleSubmits = [...byId(document, "site-footer-form").querySelectorAll('button[type="submit"]')]
      .filter((button) => !button.hidden);
    assert.equal(visibleSubmits.length, 1);
    assert.equal(textOf(visibleSubmits[0]), "Request a follow-up");
    assert.ok(tabSequence(document).includes(byId(document, "site-footer-email")));

    assert.equal(byId(document, "site-footer-error").hidden, true);
    assert.equal(byId(document, "site-footer-recovery").hidden, true);
    assert.equal(shownText(document, "site-footer-status"), "");
    assert.equal(byId(document, "site-footer-form").dataset.state, undefined);
    assert.equal(describedBy(document), "site-footer-note");
    assert.equal(byId(document, "site-footer-email").getAttribute("aria-invalid"), null);
  } finally {
    page.restore();
  }
});

test("a submission goes through the shared capture path, and the confirmation says what happens next", async () => {
  const page = await openFooterPage("index.html");
  const { document } = page;
  const calls = interceptLeads((call) => jsonReply({ captured: true, created: call === 1, purpose: "follow_up" }, call === 1 ? 201 : 200));
  try {
    submitEmail(document, TYPED_EMAIL);
    await settled(document);

    // The shared path is /api/leads with a body built from one argument. That is
    // the whole of `postLeadEmail`, and the whole of the claim beside the field.
    assert.equal(calls.length, 1, "one submission must produce exactly one request");
    const [{ url, options }] = calls;
    assert.equal(url, "/api/leads");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { email: TYPED_EMAIL, purpose: "follow_up" });
    assert.deepEqual(Object.keys(JSON.parse(options.body)), ["email", "purpose"]);

    assert.equal(byId(document, "site-footer-form").dataset.state, "success");
    const confirmation = shownText(document, "site-footer-status");
    assert.match(confirmation, /^Request received\./);
    assert.match(confirmation, /Your submitted work email was recorded/);
    // Nothing promised that this demo does not do.
    assert.doesNotMatch(confirmation, /business days?|within \d|hours?\b/i);
    // The live region announces it rather than leaving it to the eye alone.
    assert.equal(byId(document, "site-footer-status").getAttribute("aria-live"), "polite");
    assert.equal(byId(document, "site-footer-status").getAttribute("role"), "status");

    // A repeat submission is still a success, and still claims nothing more —
    // but it has to be asked for: the landed request took the form away.
    byId(document, "site-footer-again").click();
    submitEmail(document, TYPED_EMAIL);
    // It opens on the same three words as the first confirmation: the live
    // region announces this sentence alone, out of the context of the button
    // that was pressed, so it has to name which request succeeded.
    await waitFor(
      () => shownText(document, "site-footer-status")
        .startsWith("Request received. That work email was already recorded"),
      "the already-recorded confirmation");
    assert.equal(calls.length, 2);
  } finally {
    page.restore();
  }
});

test("the privacy sentence beside the field is what the request body actually does", async () => {
  const page = await openFooterPage("evolution.html");
  const { document } = page;
  const calls = interceptLeads(() => jsonReply({ captured: true, created: true, purpose: "follow_up" }));
  try {
    assert.equal(shownText(document, "site-footer-note"), FOLLOW_UP_PRIVACY);

    submitEmail(document, TYPED_EMAIL);
    await settled(document);

    // The AI FinOps tab is the page with the most on it to leak. Nothing from
    // the page reaches the wire by any route — body, headers, or query string.
    const [{ url, options }] = calls;
    const transmitted = `${url} ${JSON.stringify(options.headers)} ${options.body}`;
    for (const secret of ["evolution", "savings", "7,430", "5,200", "760", "baseline"]) {
      assert.ok(!transmitted.includes(secret), `"${secret}" is page state and must never be in the request`);
    }
  } finally {
    page.restore();
  }
});

test("an obviously invalid address is diagnosed at the field and never reaches the network", async () => {
  const page = await openFooterPage("index.html");
  const { document } = page;
  const calls = interceptLeads(() => jsonReply({ captured: true, created: true, purpose: "follow_up" }));
  try {
    const field = byId(document, "site-footer-email");

    submitEmail(document, "");
    assert.equal(calls.length, 0, "an empty address must not reach the network");
    assert.equal(shownText(document, "site-footer-error"), "Enter your work email to request a Shiplog follow-up.");
    assert.equal(byId(document, "site-footer-error").hidden, false);
    assert.equal(field.getAttribute("aria-invalid"), "true");
    assert.match(describedBy(document), /site-footer-error/,
      "the diagnostic must be associated with the input, not merely near it");
    assert.equal(document.activeElement, field, "focus must stay on the field the visitor has to fix");
    // A validation failure is not a submission failure: no recovery copy.
    assert.equal(byId(document, "site-footer-recovery").hidden, true);

    submitEmail(document, "director at example");
    assert.equal(calls.length, 0, "a malformed address must not reach the network");
    assert.equal(shownText(document, "site-footer-error"), "Enter a valid work email address to request a Shiplog follow-up.");
    assert.equal(field.value, "director at example", "the field must keep what the visitor typed");

    // Editing retracts the diagnostic and its association.
    field.focus();
    typeText(document, "x");
    assert.equal(byId(document, "site-footer-error").hidden, true);
    assert.equal(describedBy(document), "site-footer-note");
    assert.equal(field.getAttribute("aria-invalid"), null);
  } finally {
    page.restore();
  }
});

test("a failed submission keeps the typed address, says it can be retried, and the retry works", async () => {
  const page = await openFooterPage("post.html");
  const { document } = page;
  let failNext = true;
  const calls = interceptLeads(() => (failNext
    ? jsonReply({ error: { code: "storage_unavailable", message: "unreviewed upstream text" } }, 503)
    : jsonReply({ captured: true, created: true, purpose: "follow_up_social" })));
  try {
    const field = byId(document, "site-footer-email");
    const submit = byId(document, "site-footer-panel").querySelector('button[type="submit"]');
    assert.equal(byId(document, "site-footer-recovery").hidden, true, "recovery copy must not exist before an attempt");
    assert.equal(byId(document, "site-footer-retry").hidden, true, "nothing has failed, so there is nothing to retry");
    assert.doesNotMatch(describedBy(document), /site-footer-recovery/);

    submitEmail(document, TYPED_EMAIL);
    await settled(document);

    assert.equal(byId(document, "site-footer-form").dataset.state, "error");
    assert.equal(field.value, TYPED_EMAIL, "a failed submission must not clear the address the visitor typed");
    assert.equal(byId(document, "site-footer-recovery").hidden, false);
    assert.match(describedBy(document), /site-footer-recovery/);
    assert.equal(textOf(byId(document, "site-footer-recovery")), RECOVERY_COPY);
    // Copy this repository owns — never the string the response supplied.
    assert.equal(shownText(document, "site-footer-status"),
      "We didn’t get your request because follow-up requests are temporarily offline.");
    assert.doesNotMatch(shownText(document, "site-footer-status"), /unreviewed upstream text/);
    // The control is usable again, without a reload.
    assert.equal(submit.disabled, false);
    assert.equal(submit.getAttribute("aria-disabled"), null);

    // The second attempt: the same panel, the same value, no page reload.
    failNext = false;
    field.focus();
    pressEnter(document);
    await waitFor(() => byId(document, "site-footer-form").dataset.state === "success",
      "the retry to succeed");
    assert.equal(calls.length, 2, "the retry must make its own request");
    assert.deepEqual(JSON.parse(calls[1].options.body), {
      email: TYPED_EMAIL, purpose: "follow_up_social", topic: FOLLOW_UP_TOPICS.follow_up_social,
    });
    assert.match(shownText(document, "site-footer-status"), /^Request received\./);

    // And the failure is gone, not merely outranked. A page that had failed and
    // then succeeded is the one place both states can end up rendered at once,
    // and a visitor reading "we didn't get your request" beside a receipt cannot
    // tell which one is true — so every artefact of the first attempt is checked
    // off the DOM, not assumed to have been replaced.
    assert.ok(byId(document, "site-footer-confirmation"), "the landed retry leaves a receipt");
    assert.equal(byId(document, "site-footer-form").hidden, true, "the failed form is not still standing");
    assert.equal(byId(document, "site-footer-recovery").hidden, true, "the recovery paragraph is withdrawn");
    assert.equal(byId(document, "site-footer-retry").hidden, true, "nothing is left to retry");
    assert.doesNotMatch(shownText(document, "site-footer-status"), /didn’t get your request/);
    assert.doesNotMatch(describedBy(document), /site-footer-recovery/);
    assert.equal(field.getAttribute("aria-invalid"), null, "the field no longer reads as the one that failed");
  } finally {
    page.restore();
  }
});

/* --------------------- the recovery stays where it failed -------------------- */

// The five surfaces the follow-up form was reviewed on for #1598. They are read
// out of the shared module rather than asserted page by page: every page embeds
// `siteFooterMarkup()` byte for byte (see the first test in this file), so the
// treatment is shipped once and this is what "once" means.
const IN_SCOPE = ["social.html", "profile.html", "post.html", "coach.html", "releases.html"];

test("every in-scope page ships the same in-place recovery, and none of them points at another page's form", async () => {
  const shared = siteFooterMarkup("    ");
  assert.ok(shared.includes(RECOVERY_COPY), "the shared footer must carry the recovery copy");
  assert.ok(shared.includes('<button id="site-footer-retry" type="submit" hidden>Retry your follow-up request</button>'),
    "the shared footer must carry the retry control");

  for (const file of IN_SCOPE) {
    const html = await read(file);
    const page = await loadPage(pageUrl(file));
    try {
      const recovery = byId(page.document, "site-footer-recovery");
      assert.equal(textOf(recovery), RECOVERY_COPY, `${file} words the failure its own way`);
      // No link out at all: the whole point is that the recovery is here.
      assert.equal(recovery.children.filter((child) => child.tagName === "A").length, 0,
        `${file}: the failure copy must not send a reader anywhere`);
      assert.doesNotMatch(textOf(recovery), /briefing/i, `${file}: the failure copy still names the briefing`);
      assert.doesNotMatch(html, /site-footer-recovery[^\n]*executive-briefing/,
        `${file}: the failure copy still links the executive briefing's form`);

      const retry = byId(page.document, "site-footer-retry");
      assert.equal(retry.tagName, "BUTTON");
      assert.equal(retry.type, "submit", `${file}: retry must resubmit this form, not navigate`);
      assert.equal(retry.hidden, true, `${file}: nothing has failed yet`);
      // It belongs to the form it retries, so the value it sends is the value
      // still in the field beside it.
      assert.equal(retry.closest("form")?.id, "site-footer-form");
    } finally {
      page.restore();
    }
  }
});

test("a failed request offers its retry in place: named, keyboard-reachable, announced, and never stealing focus", async () => {
  const page = await openFooterPage("social.html");
  const { document } = page;
  let failNext = true;
  const calls = interceptLeads(() => (failNext
    ? jsonReply({ error: { code: "storage_error", message: "unreviewed upstream text" } }, 500)
    : jsonReply({ captured: true, created: true, purpose: "follow_up_social" })));

  // Anything that grabs focus from the field a reader is standing in is the
  // defect; the harness would not otherwise show a stolen focus as a failure.
  const focused = [];
  for (const id of ["site-footer-recovery", "site-footer-status", "site-footer-retry"]) {
    const node = byId(document, id);
    node.focus = () => focused.push(id);
  }

  try {
    const field = byId(document, "site-footer-email");
    const submit = byId(document, "site-footer-form").querySelector('button[type="submit"]');

    submitEmail(document, TYPED_EMAIL);
    await settled(document);
    assert.equal(byId(document, "site-footer-form").dataset.state, "error");

    // 1. The failure names the action that failed, in the live region the site
    //    already announces outcomes through — and claims no receipt.
    const status = byId(document, "site-footer-status");
    assert.equal(status.getAttribute("role"), "status");
    assert.equal(status.getAttribute("aria-live"), "polite");
    assert.equal(textOf(status), "We didn’t get your request — something went wrong at our end. Please try again.");
    assert.doesNotMatch(textOf(status), /unreviewed upstream text/);
    // The meaning is in the words, not in a colour: the copy says what failed
    // even with every stylesheet thrown away.
    assert.match(textOf(byId(document, "site-footer-recovery")), /^We could not send your follow-up request\./);

    // 2. The retry is visible, in this region, and it is the primary action of
    //    the row — it stands where the send control was rather than beside it.
    const retry = byId(document, "site-footer-retry");
    assert.equal(retry.hidden, false);
    assert.equal(textOf(retry), "Retry your follow-up request");
    assert.equal(submit.hidden, true, "two primary controls that do the same thing is not a hierarchy");
    assert.equal(retry.disabled, false);

    // 3. Nothing took focus. The reader is left in the field they may want to
    //    correct, and the retry is a tab away at its own place in the form.
    assert.deepEqual(focused, [], "the failure state must not move focus");
    assert.equal(document.activeElement, field);
    assert.equal(retry.getAttribute("autofocus"), null);
    const ids = tabSequence(document).map((node) => node.id);
    for (const [before, after] of [["site-footer-email", "site-footer-retry"]])
      assert.ok(ids.indexOf(before) >= 0 && ids.indexOf(before) < ids.indexOf(after),
        `${before} must come before ${after} in the tab order`);

    // 4. The address survived, and the retry sends that same address again
    //    without the reader typing anything.
    assert.equal(field.value, TYPED_EMAIL, "the failed attempt must leave the address in the field");
    failNext = false;
    retry.click();
    await waitFor(() => byId(document, "site-footer-form").dataset.state === "success", "the retry to land");
    assert.equal(calls.length, 2, "retry must re-attempt the same submission");
    assert.deepEqual(JSON.parse(calls[1].options.body), JSON.parse(calls[0].options.body));
    assert.deepEqual(JSON.parse(calls[1].options.body), {
      email: TYPED_EMAIL, purpose: "follow_up_social", topic: FOLLOW_UP_TOPICS.follow_up_social,
    });
    assert.deepEqual(focused, [], "and the retry must not move focus either");
  } finally {
    page.restore();
  }
});

/* ------------------- the other route out of a failure --------------------- */

// The failure state used to offer exactly one thing to press, and it was the
// thing that had just not worked. #1958 adds one alternative — the public
// repository this site is built from — and the whole of what makes it worth
// anything is checked here: that it is a link and not a sentence about one, that
// it is only ever on the page while a request has actually failed, and that a
// reader who reaches the retry by Tab passes it on the way.
//
// Counted rather than compared against null: asserting a harness element against
// null walks the whole parsed page and does not come back.
const REPOSITORY_ID = "site-footer-repository";
const countOf = (document, id) => document.querySelectorAll(`#${id}`).length;

test("the failure state offers one other route to the team, and offers it only while it has failed", async () => {
  const page = await openFooterPage("social.html");
  const { document } = page;
  let failNext = true;
  interceptLeads(() => (failNext
    ? jsonReply({ error: { code: "storage_error", message: "unreviewed upstream text" } }, 500)
    : jsonReply({ captured: true, created: true, purpose: "follow_up_social" })));

  try {
    const field = byId(document, "site-footer-email");

    // 1. Nothing has failed, so there is nothing to fall back to. The node does
    //    not exist at all — a hidden one is still part of the accessible
    //    description and still read out to a visitor who has typed nothing.
    assert.equal(countOf(document, REPOSITORY_ID), 0,
      "the alternative route must not exist before a request has failed");

    submitEmail(document, TYPED_EMAIL);
    await settled(document);
    assert.equal(byId(document, "site-footer-form").dataset.state, "error");

    // 2. A real link to a real address, named for where it goes and what it does
    //    there — and named nothing like the control beside it.
    assert.equal(countOf(document, REPOSITORY_ID), 1, "one failure, one alternative route");
    const link = byId(document, REPOSITORY_ID);
    assert.equal(link.tagName, "A");
    assert.equal(link.getAttribute("href"), REPOSITORY_URL);
    assert.equal(link.getAttribute("href"), "https://github.com/AndrewLikesTea/wawalu-agent-lab",
      "the destination is the repository the site already publishes, not a second address");
    assert.equal(textOf(link), REPOSITORY_LINK_LABEL);
    assert.equal(textOf(link), "Open an issue on the public GitHub repository");
    const retry = byId(document, "site-footer-retry");
    assert.notEqual(textOf(link), textOf(retry), "two controls, two names");
    assert.doesNotMatch(textOf(link), /retry/i, "the alternative must not read as the retry");
    // No new inbox, channel, or promise about a reply came with it.
    assert.doesNotMatch(textOf(link), /@|email|hours|reply|respond/i);

    // 3. It is on the page, not folded behind anything: it is a tab stop, and it
    //    is the tab stop immediately before the retry — the send control that
    //    sits between them in the markup is hidden for exactly as long as this
    //    link is up.
    const ids = tabSequence(document).map((node) => node.id);
    assert.ok(ids.includes(REPOSITORY_ID), "the alternative route must be keyboard reachable");
    assert.equal(ids.indexOf("site-footer-retry"), ids.indexOf(REPOSITORY_ID) + 1,
      "nothing may be skipped between the alternative route and the retry");
    assert.equal(retry.hidden, false, "the retry stays: this is an addition, not a replacement");
    assert.equal(retry.disabled, false);

    // 4. And the address the visitor typed is still where they left it, so the
    //    retry beside the link still has something to send.
    assert.equal(field.value, TYPED_EMAIL, "the failed attempt must leave the address in the field");

    // 5. A landed request takes it back off the page. Both artefacts of the
    //    failure go: a reader must not meet "open an issue" beside a receipt.
    failNext = false;
    retry.click();
    await waitFor(() => byId(document, "site-footer-form").dataset.state === "success", "the retry to land");
    assert.equal(countOf(document, REPOSITORY_ID), 0, "a landed request leaves no stale fallback");
    assert.ok(byId(document, "site-footer-confirmation"), "the landed retry leaves a receipt");

    // 6. And asking for the form back does not bring it back with it.
    byId(document, "site-footer-again").click();
    assert.equal(byId(document, "site-footer-form").hidden, false, "the form is back");
    assert.equal(countOf(document, REPOSITORY_ID), 0, "the reopened form is not a failed one");
  } finally {
    page.restore();
  }
});

test("a validation refusal is not a failed request, and offers no route out of one", async () => {
  const page = await openFooterPage("coach.html");
  const { document } = page;
  const calls = interceptLeads(() => jsonReply({ captured: true, created: true, purpose: "follow_up_coach" }));
  try {
    submitEmail(document, "director at example");
    assert.equal(calls.length, 0, "a malformed address must not reach the network");
    // Nothing failed to send, so nothing needs a second way to send it.
    assert.equal(countOf(document, REPOSITORY_ID), 0,
      "a rejected address is a correction to make here, not a request that did not land");
    assert.equal(byId(document, "site-footer-recovery").hidden, true);
  } finally {
    page.restore();
  }
});

test("no page ships the alternative route in its markup", async () => {
  // It is built by the module on failure and nowhere else. A node in the source
  // is a node every visitor's screen reader can find before anything has gone
  // wrong, and it would need paying for on seventeen documents besides.
  const shared = siteFooterMarkup("    ");
  assert.ok(!shared.includes(REPOSITORY_URL), "the shared footer markup must not carry the repository link");
  assert.ok(!shared.includes(REPOSITORY_LINK_LABEL));
  for (const file of PAGES) {
    const html = await read(file);
    assert.ok(!html.includes(REPOSITORY_LINK_LABEL), `${file} ships the failure fallback before anything failed`);
    assert.ok(!html.includes(`id="${REPOSITORY_ID}"`), `${file} authors ${REPOSITORY_ID}`);
  }
});

test("the send/retry swap never hides the control a reader is standing on", async () => {
  // The swap is the one moment this form removes a focused element from the
  // page, and a browser answers that by dropping focus to the top of the
  // document — out of the footer, silently. This harness models no layout, so it
  // would go on reporting the hidden control as focused and show nothing; both
  // directions are pinned here as an explicit move onto the field, which is the
  // one control present on both sides of the swap.
  //
  // The test presses the buttons rather than submitting from the field, because
  // submitting from the field is the path where focus is already safe.
  const page = await openFooterPage("coach.html");
  const { document } = page;
  let failNext = true;
  interceptLeads(() => (failNext
    ? jsonReply({ error: { code: "storage_error", message: "unreviewed upstream text" } }, 500)
    : jsonReply({ captured: true, created: true, purpose: "follow_up_coach" })));
  try {
    const field = byId(document, "site-footer-email");
    const submit = byId(document, "site-footer-form").querySelector('button[type="submit"]');
    const retry = byId(document, "site-footer-retry");

    field.focus();
    typeText(document, TYPED_EMAIL);
    submit.focus();
    pressEnter(document);
    await settled(document);
    assert.equal(submit.hidden, true, "the failure hides the control that was pressed");
    assert.equal(document.activeElement?.id, "site-footer-email",
      "hiding the pressed control must hand focus to the field, not to the document");

    // And back the other way: sending again puts the send control up and takes
    // the retry down, while the reader is standing on the retry.
    failNext = false;
    retry.focus();
    pressEnter(document);
    assert.equal(retry.hidden, true, "the send control stands back up while a retry is in flight");
    assert.equal(document.activeElement?.id, "site-footer-email");

    await waitFor(() => byId(document, "site-footer-form").dataset.state === "success", "the retry to land");
    // Success moves focus on purpose, and it is the receipt that takes it.
    assert.equal(document.activeElement?.id, "site-footer-confirmation");
  } finally {
    page.restore();
  }
});

// The paragraph ships in the markup of every page, so this checks it where a
// visitor actually meets it: two pages, driven to failure through the shipped
// entry rather than read out of the source string.
for (const file of ["agents.html", "decision.html"]) {
  test(`${file} leads its failure state with what happened, not with the reassurance`, async () => {
    const page = await openFooterPage(file);
    const { document } = page;
    interceptLeads(() => { throw new TypeError("network error"); });
    try {
      submitEmail(document, TYPED_EMAIL);
      await settled(document);

      assert.equal(byId(document, "site-footer-form").dataset.state, "error");
      assert.equal(byId(document, "site-footer-recovery").hidden, false);
      assert.equal(shownText(document, "site-footer-recovery"), RECOVERY_COPY);
      assert.ok(shownText(document, "site-footer-recovery").startsWith("We could not send your follow-up request."),
        "the outcome sentence must be the first thing read");
    } finally {
      page.restore();
    }
  });
}

test("the pending state is announced, not merely spun", async () => {
  const page = await openFooterPage("index.html");
  const { document } = page;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const calls = interceptLeads(async () => { await pending; return jsonReply({ captured: true, created: true, purpose: "follow_up" }); });
  try {
    submitEmail(document, TYPED_EMAIL);
    await waitFor(() => byId(document, "site-footer-form").dataset.state === "submitting", "the pending state");

    const submit = byId(document, "site-footer-panel").querySelector('button[type="submit"]');
    assert.equal(submit.disabled, true, "the submit control must be unusable while a request is in flight");
    assert.equal(submit.getAttribute("aria-disabled"), "true");
    assert.equal(shownText(document, "site-footer-status"), "Requesting a follow-up — sending your email address…",
      "the pending state must be in the live region, not only in the button");

    // One address, one request. The form has two submit controls and a field
    // that submits on Enter, so the guard has to be the form's state and not
    // whichever control is currently reachable.
    byId(document, "site-footer-email").focus();
    pressEnter(document);
    assert.equal(calls.length, 1, "a submission while one is in flight must not reach the transport twice");

    release();
    await settled(document);
    // The request landed, so the control does not come back with it: the receipt
    // has taken the form's place, and a second send has to be asked for.
    assert.equal(submit.disabled, true, "a landed request must leave nothing to press again");
    assert.equal(byId(document, "site-footer-form").hidden, true);
    byId(document, "site-footer-again").click();
    assert.equal(submit.disabled, false, "reopening the form must give the control back");
  } finally {
    page.restore();
  }
});

/* -------------------------------- the band -------------------------------- */

test("both stylesheets that the site's pages load style the footer, and agree about the band", async () => {
  // agents.html and agent-trace.html load agents.css alone; the other nine load
  // styles.css. A rule present in one and absent from the other ships an
  // unstyled band on two pages, which is exactly how this went wrong before.
  const sheets = await Promise.all(["styles.css", "agents.css"]
    .map(async (file) => [file, await readFile(new URL(`../src/${file}`, import.meta.url), "utf8")]));

  for (const [file, css] of sheets) {
    for (const selector of [
      ".site-footer", ".site-footer-inner", ".site-footer-trigger", ".site-footer-panel",
      ".site-footer-actions button", ".site-footer-status", ".site-footer-recovery",
      ".site-footer-demos", ".site-footer-demos a",
      // The band's standalone link: the briefing's pointer at its own form, and
      // the repository a failed request offers beside its retry. The failure
      // state reaches every page that ships the form, agents.html among them.
      ".site-footer-redirect-link",
    ]) assert.ok(css.includes(`${selector} {`), `${file} must style ${selector}`);

    // The band's link is keyboard-visible on every page that ships it. This rule
    // covered buttons and inputs alone in agents.css, which was survivable while
    // nothing in the band was a link on those two pages.
    assert.match(css, /\.site-footer a:focus-visible \{/, `${file}: the footer's link has no focus ring`);

    // A collapsed panel is collapsed, not merely transparent.
    assert.match(css, /\.site-footer-panel\[hidden\] \{ display:none; \}/, `${file}: the hidden panel must not occupy the band`);

    // Tap targets. 44px is the floor for the trigger, the two actions, and the
    // field a thumb has to hit on a phone.
    for (const rule of [
      /\.site-footer-trigger \{ min-height:44px;/,
      /\.site-footer-actions button \{ min-height:44px;/,
      /\.site-footer-field input \{ min-height:4[6-9]px;/,
    ]) assert.match(css, rule, `${file}: ${rule} — a tap target is under 44px`);

    // No horizontal overflow at a narrow viewport: the band keeps the page's own
    // gutter rather than a fixed width, and the field may shrink inside its grid.
    assert.match(css, /\.site-footer-inner \{[^}]*width:min\(1180px,calc\(100% - 40px\)\)/, `${file}: the band must not be fixed-width`);
    assert.match(css, /@media\(max-width:520px\) \{ \.site-footer-inner\{width:calc\(100% - 24px\)/, `${file}: no narrow-viewport rule for the band`);
    assert.match(css, /\.site-footer-field input \{[^}]*min-width:0/, `${file}: the field can overflow its grid column`);

    // The disclosure animates only for a visitor who has not asked it not to.
    assert.match(css, /@media\(prefers-reduced-motion:reduce\) \{[\s\S]*?\.site-footer-panel\{animation:none\}/,
      `${file}: the reveal must be silenced under prefers-reduced-motion`);
  }

  // And the band itself is one design, not two: the shared declarations are
  // identical in both files.
  const [[, base], [, observatory]] = sheets;
  for (const selector of [".site-footer", ".site-footer-inner", ".site-footer-panel", ".site-footer-trigger", ".site-footer-demos"]) {
    const rule = (css) => css.match(new RegExp(`^\\${selector} \\{([^}]*)\\}`, "m"))[1];
    assert.equal(rule(observatory), rule(base), `${selector} has drifted between styles.css and agents.css`);
  }
});
