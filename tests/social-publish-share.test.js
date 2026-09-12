// What a visitor can do with the post they just published, without leaving the
// page they published it on.
//
// The receipt already named the post and linked to it (tests/social-publish-
// confirmation.test.js pins that). What it did not do was hand the address over:
// to pass the post on, a visitor had to find their own card in the feed, open
// it, and press the copy control that has always been on /post.html. This file
// is about closing that gap with the control that already exists rather than a
// second one — same words, same success and failure lines, same address.
//
// The address is the load-bearing claim, so it is asserted against the permalink
// page's own builder (postPermalink, src/post-share.js) rather than against a
// string written out here: one helper, two surfaces, nothing that can drift.
//
// Harness notes: assertions are on counts and attribute values, never on element
// identity; the harness reflects no properties to attributes, so `type` is read
// as a property; and the origin a page is served from is the harness's own
// (https://labs.wawalu.org), which is what makes an absolute permalink testable.

import test from "node:test";
import assert from "node:assert/strict";
import { PERMALINK_UNAVAILABLE_NOTE, mountSocialFeed } from "../src/social.js";
import { POST_COPY_LABEL, postPermalink } from "../src/post-share.js";
import { SHARE_COPIED_STATUS, SHARE_COPY_FAILED_STATUS } from "../src/share-link.js";
import { postDetailHref } from "../src/social-links.js";
import { loadPage, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const ORIGIN = "https://labs.wawalu.org";
const NOW = Date.parse("2026-09-02T10:00:00.000Z");
// A real UUID: /post.html only asks the API for an id shaped like one.
const SAVED_ID = "5b91d0c4-2f7a-4c31-9b6e-1d0a7c4e8f22";

// The sentence the composer has always carried about what publishing costs. It
// is authored in src/social.html, said exactly once, and this file's stake in it
// is only that nothing here quietly moved or reworded it.
const CONSEQUENCE = "Anyone who visits Shiplog can read your post, its image, and the display name you publish it with. You cannot edit or delete a post after you publish it, so post nothing you would not put on a public page. Do not include customer or production data.";

// The composer on the shipped markup, with the API and the clipboard replaced by
// values the test owns. `saved` is what the publish response resolves to — the
// row the server made — because everything the receipt offers is derived from
// it, and the id is the part this file is about.
async function composer(t, { clipboard, saved = (post) => ({ ...post, id: SAVED_ID, createdAt: new Date(NOW).toISOString() }), image = null } = {}) {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  const document = page.document;
  let media = image;
  const feed = mountSocialFeed(document, {
    posts: [],
    state: "ready",
    storage: page.storage,
    clipboard,
    getMedia: () => (media ? { ...media, alt: document.querySelector("#post-image-alt").value.trim() } : null),
    clearMedia: () => { media = null; },
    create: async (post) => saved(post),
  });
  feed.description.setAttached(Boolean(media));
  feed.composer.open();

  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return {
    page,
    document,
    notice: () => document.querySelector("#social-notice"),
    settle,
    async publish({ body, author, description }) {
      document.querySelector("#post-body").value = body;
      document.querySelector("#post-author").value = author;
      if (description !== undefined) document.querySelector("#post-image-alt").value = description;
      document.querySelector("#post-submit").click();
      await settle();
    },
  };
}

const copyButtons = (region) => region.querySelectorAll(".share-button");
const copyStatus = (region) => region.querySelector("#publish-copy-status");

test("the receipt hands over the same address the permalink page copies", async (t) => {
  const copied = [];
  const harness = await composer(t, { clipboard: { writeText: async (value) => { copied.push(value); } } });
  t.after(() => harness.page.restore());

  await harness.publish({ body: "Published straight from the composer.", author: "Remy" });

  const region = harness.notice();
  assert.equal(region.hidden, false);

  // The link, unchanged in shape: relative, and carrying the display name
  // /post.html reads while its own lookup is in flight.
  const links = region.querySelectorAll("a");
  assert.equal(links.length, 1, "one link — the post itself");
  assert.equal(links[0].getAttribute("href"), postDetailHref(SAVED_ID, "Remy"));

  // The control, and only one of it.
  const buttons = copyButtons(region);
  assert.equal(buttons.length, 1, "one copy control, not a row of them");
  assert.equal(textOf(buttons[0]), POST_COPY_LABEL);
  assert.equal(textOf(buttons[0]), "Copy link to this post");
  assert.equal(buttons[0].type, "button", "read as a property: the harness reflects nothing to attributes");
  assert.equal(buttons[0].getAttribute("aria-label"), null, "the visible words are the accessible name");
  assert.equal(buttons[0].getAttribute("aria-describedby"), "publish-copy-status");
  assert.ok(tabSequence(harness.document).includes(buttons[0]), "the control is keyboard reachable");

  // Rendering copies nothing: the clipboard is written under an activation.
  assert.deepEqual(copied, []);
  assert.equal(textOf(copyStatus(region)), "");

  buttons[0].click();
  await harness.settle();

  // The claim: byte for byte what /post.html's own control would copy for this
  // post, built by the same helper rather than assembled a second time here.
  assert.deepEqual(copied, [postPermalink(SAVED_ID, ORIGIN)]);
  assert.deepEqual(copied, [`${ORIGIN}/post.html?id=${SAVED_ID}`]);
  // And the link on screen is an address for that same post — the provenance
  // parameter aside, which is how one reader arrived and not part of the post.
  const offered = new URL(links[0].getAttribute("href"), ORIGIN);
  const canonical = new URL(copied[0]);
  assert.equal(offered.pathname, canonical.pathname);
  assert.equal(offered.searchParams.get("id"), canonical.searchParams.get("id"));

  // Reported in the site's existing words, not a second wording of them.
  assert.equal(textOf(copyStatus(region)), SHARE_COPIED_STATUS);
  assert.equal(textOf(copyStatus(region)), "Link copied to clipboard.");
  assert.equal(copyStatus(region).getAttribute("role"), "status");
  assert.equal(copyStatus(region).getAttribute("aria-live"), "polite");
  assert.equal(buttons[0].disabled, false, "pressable again once it has reported");

  // And the receipt still says the two things it said before.
  assert.match(textOf(region), /^Published “Published straight from the composer\.” as Remy\./);
  assert.equal(textOf(links[0]), "Open the post’s permalink");
});

test("a browser that refuses the clipboard is reported, in the words the site already uses", async (t) => {
  const harness = await composer(t, { clipboard: { writeText: async () => { throw new Error("denied"); } } });
  t.after(() => harness.page.restore());

  await harness.publish({ body: "The clipboard says no.", author: "Remy" });
  const region = harness.notice();
  copyButtons(region)[0].click();
  await harness.settle();

  assert.equal(textOf(copyStatus(region)), SHARE_COPY_FAILED_STATUS);
  assert.match(textOf(copyStatus(region)), /Could not copy the link\. Copy it from the address bar\./);
  assert.equal(copyButtons(region)[0].disabled, false, "a refusal is not a dead control");
  // A failure to copy is not a failure to publish: the receipt still stands.
  assert.match(textOf(region), /^Published “The clipboard says no\.” as Remy\./);
});

// The one case where the receipt cannot do what this file is about. It is
// decided from the response, not from a thrown error: this publish succeeded.
test("a response with no usable id is still confirmed, and offers nothing to open", async (t) => {
  for (const [name, id] of [["missing", undefined], ["empty", ""], ["blank", "   "], ["not a string", 42]]) {
    const harness = await composer(t, {
      clipboard: { writeText: async () => {} },
      saved: (post) => ({ ...post, id, createdAt: new Date(NOW).toISOString() }),
    });
    const region = harness.notice();

    await harness.publish({ body: "This one landed without an address.", author: "Remy" });

    assert.equal(region.hidden, false, `${name}: the publish is still announced`);
    assert.match(textOf(region), /^Published “This one landed without an address\.” as Remy\./,
      `${name}: a publish that landed is still news`);
    assert.match(textOf(region), new RegExp(PERMALINK_UNAVAILABLE_NOTE),
      `${name}: and the receipt says where the post is instead`);

    // Nothing to press and nothing to follow — counted, never compared to null.
    assert.equal(region.querySelectorAll("a").length, 0, `${name}: a link with nowhere to go`);
    assert.equal(copyButtons(region).length, 0, `${name}: a control with nothing to copy`);
    assert.equal(region.querySelectorAll(".share-status").length, 0, `${name}: a report with nothing to report`);
    assert.equal(region.querySelectorAll("[href]").length, 0, `${name}: no empty or "#" href survived`);
    assert.equal(textOf(region).includes(POST_COPY_LABEL), false, `${name}: the label outlived its control`);

    harness.page.restore();
  }
});

// End to end, along the link the receipt actually offers: the href is read off
// the confirmation, handed to /post.html as its query string, and the API is
// asked for the row the publish created. What comes back has to be the post the
// visitor just wrote — its words, its image, and the name they published under.
test("the link the receipt offers opens that post on the shared post page", async (t) => {
  const image = { content_type: "image/png", data: "iVBORw0KGgo=", width: 640, height: 480, preview: "data:image/png;base64,carried" };
  const harness = await composer(t, { clipboard: { writeText: async () => {} }, image });
  const description = "A release row with a green check beside it.";
  const published = { body: "The row landed green.", author: "Remy Ilesanmi" };

  await harness.publish({ ...published, description });
  const href = harness.notice().querySelector("a").getAttribute("href");
  // Done with the composer's page before another one takes the globals.
  harness.page.restore();

  const post = await loadPage(new URL("../src/post.html", import.meta.url), {
    location: { search: href.slice(href.indexOf("?")) },
  });
  t.after(() => post.restore());
  globalThis.fetch = async (url) => {
    if (String(url) === `/api/social-posts/${SAVED_ID}`) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          post: {
            id: SAVED_ID,
            author: published.author,
            content: published.body,
            timestamp: new Date(NOW).toISOString(),
            source: "shiplog-web",
            image_url: "/media/release-row.png",
            image_alt: description,
            image_width: image.width,
            image_height: image.height,
          },
        }),
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  await importPageModule("/post-page.js");
  await waitFor(() => post.document.documentElement.dataset.shiplogPostDetail === "ready",
    "the shared post page settled");

  const panel = post.document.querySelector("#post-detail");
  // Real content, not the wait: the placeholder carries the same containers.
  assert.equal(panel.querySelectorAll(".detail-skeleton").length, 0, "the page is past its skeleton");
  assert.match(textOf(panel), /The row landed green\./, "the post's own words");
  assert.match(textOf(panel), /Remy Ilesanmi/, "the display name it was published under");
  const images = panel.querySelectorAll("img");
  assert.equal(images.length, 1, "the image published with it");
  // Read as properties: the harness reflects nothing to attributes.
  assert.equal(images[0].alt, description, "described in the words the composer required");
  assert.equal(images[0].src, "/media/release-row.png");

  // And the page the reader arrived on offers the same act the receipt did, for
  // the same address — which is the whole reason the receipt could stop being
  // the only way to get there.
  const copy = panel.querySelectorAll(".share-button");
  assert.equal(copy.length, 1);
  assert.equal(textOf(copy[0]), POST_COPY_LABEL);
});

test("the composer still says, once, what publishing costs", async (t) => {
  const harness = await composer(t, { clipboard: { writeText: async () => {} } });
  t.after(() => harness.page.restore());

  await harness.publish({ body: "Nothing here reworded the warning.", author: "Remy" });

  const document = harness.document;
  // Still on screen: a publish that succeeds deliberately leaves the composer
  // open, and this sentence is inside it.
  assert.equal(document.querySelector("#post-compose-panel").hidden, false);
  const consequence = document.querySelector("#post-consequence");
  assert.equal(textOf(consequence), CONSEQUENCE);
  assert.match(textOf(consequence), /You cannot edit or delete a post after you publish it/);
  assert.ok(document.querySelector("#post-submit").getAttribute("aria-describedby").split(/\s+/).includes("post-consequence"));
  // Once. The receipt does not restate it beside the link it now offers.
  assert.equal(textOf(harness.notice()).includes("You cannot edit or delete a post"), false);
});
