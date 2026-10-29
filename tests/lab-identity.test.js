// The lab's own pages say they are not Shiplog, and still lead back to it (#2864).
//
// Prompt coach, Social with its post page, People and Agent observatory are
// hosted beside Shiplog. Their tabs used to end in "· Shiplog" and nothing near
// their top said otherwise, so a visitor read each one as a Shiplog feature. Each
// now carries the lab's name in its title and one shared sentence, LAB_IDENTITY,
// near its top — with a link to Shiplog's decision log. Shiplog's own pages keep
// Shiplog's name.
//
// Asserted on counts, attributes and text, never on a node against null.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LAB, LAB_IDENTITY, LAB_IDENTITY_HREF, LAB_IDENTITY_TEXT, PRODUCT, labTitle } from "../src/page-title.js";
import { parseHtml, textOf } from "./support/browser.js";

// `before` is the first id the identity line must precede: the page's first
// block of content below its hero. post.html is the exception the page pins
// itself — nothing may stand between its lead and the post, and its routes out
// lead straight into the reporting handle — so there it closes the standing
// frame, and its `after` says so.
//
// `linked: false` is Social: its hero may gain no tab stop above the feed's
// filters (tests/social.test.js), so it carries the same words with no link and
// its route to Shiplog is the header's Decision log link.
const LAB_PAGES = [
  { file: "coach.html", name: "Prompt coach", before: "prompt-coaching" },
  { file: "social.html", name: "Social", before: "feed-title", linked: false },
  { file: "post.html", name: "Social post", after: "post-reporting", before: "site-footer-title" },
  // People's tab says what it holds after its name (#3058).
  { file: "profile.html", name: "People", detail: "public image posts from Social", before: "profile-order" },
  { file: "agents.html", name: "Agent observatory", before: "activity-title" },
];

const SHIPLOG_PAGES = [
  { file: "index.html", title: `${PRODUCT} · decision and release log` },
  { file: "releases.html", title: `Releases · ${PRODUCT}` },
];

const read = (file) => readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
const withoutComments = (html) => html.replace(/<!--[\s\S]*?-->/g, "");
const titleOf = (html) => html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";

test("the lab's pages are titled with the lab's name, not Shiplog's", async () => {
  for (const { file, name, detail } of LAB_PAGES) {
    const title = titleOf(await read(file));
    assert.equal(title, labTitle(name, detail), `${file} title`);
    assert.ok(title.endsWith(` · ${LAB}`), `${file} is titled "${title}"`);
    assert.doesNotMatch(title, /Shiplog/, `${file} still names Shiplog as its product`);
  }
});

test("Shiplog's home page and Releases still identify as Shiplog", async () => {
  for (const { file, title } of SHIPLOG_PAGES) {
    assert.equal(titleOf(await read(file)), title, `${file} title`);
    assert.doesNotMatch(await read(file), /id="lab-identity"/, `${file} is Shiplog and must not say it is not`);
  }
});

test("each lab page says near its top that it is separate from Shiplog, and links to the decision log", async () => {
  assert.match(LAB_IDENTITY, /separate/i);
  // The footer's mark for the same pages, word for word (#2881): one name for
  // the concept. The lab's own name is in each page's title, asserted above.
  assert.match(LAB_IDENTITY, /^A separate lab tool, not part of /);
  assert.doesNotMatch(LAB_IDENTITY, /Wawalu Lab project|tool in the lab/);
  assert.equal(LAB_IDENTITY_HREF, "/#decisions-title");

  for (const { file, before, after, linked = true } of LAB_PAGES) {
    const html = await read(file);
    // One wording, shipped in the markup: these bytes and no paraphrase.
    const sentence = linked ? LAB_IDENTITY : LAB_IDENTITY_TEXT;
    assert.ok(html.includes(`<p class="hint" id="lab-identity">${sentence}</p>`), `${file} must embed the shared sentence`);

    const document = parseHtml(html);
    const lines = document.querySelectorAll("#lab-identity");
    assert.equal(lines.length, 1, `${file} carries the identity line ${lines.length} times`);
    const text = textOf(lines[0]);
    assert.equal(text, LAB_IDENTITY_TEXT, file);
    assert.match(text, /separate/i, file);
    assert.match(text, /separate lab tool/, file);
    assert.ok(titleOf(html).endsWith(` · ${LAB}`), `${file}: the lab's name must still reach the reader`);
    assert.match(text, /not part of Shiplog/, file);

    const links = lines[0].querySelectorAll("a");
    if (linked) {
      assert.equal(links.length, 1, `${file}: one route to Shiplog`);
      assert.equal(links[0].getAttribute("href"), LAB_IDENTITY_HREF, `${file}: the link must open Shiplog's decision log`);
      assert.match(textOf(links[0]), /decision and release log/, `${file}: the link must name Shiplog as the decision and release log`);
      assert.match(textOf(links[0]), /^Shiplog/, `${file}: the link must name Shiplog`);
    } else {
      assert.equal(links.length, 0, `${file}: this line may add no tab stop`);
      const routes = document.querySelectorAll("a").filter((link) => link.getAttribute("href") === LAB_IDENTITY_HREF);
      assert.ok(routes.length >= 1, `${file} keeps no visible route to Shiplog's decision log`);
    }

    // In the page's content, before what follows the hero and well before the
    // About band at its foot.
    const source = withoutComments(html);
    const at = (id) => source.indexOf(`id="${id}"`);
    const line = at("lab-identity");
    assert.ok(at("main-content") >= 0 && at("main-content") < line, `${file}: the line must sit in the page's content`);
    assert.ok(at(before) > line, `${file}: the line must read before #${before}`);
    if (after) assert.ok(at(after) < line, `${file}: the line must read after #${after}`);
    assert.ok(at("site-footer-title") > line, `${file}: the line must read before the About band`);
  }
});
